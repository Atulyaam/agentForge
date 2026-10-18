/**
 * @agentforge/orchestrator — State machine, stage scheduling, retries, atomic writer.
 *
 * FR-012: Workflow orchestration
 * FR-013: Bounded retries with backoff
 * FR-014: Timeout and cancellation
 * FR-015: Run output writer (atomic write + revalidation)
 * FR-018: Structured execution trace
 * FR-022: Run and record isolation
 * FR-033: Checkpoint and resume for batch runs
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {
  type RunStatus,
  type CheckStatus,
  type ErrorCategory,
  type RecordResult,
  type RunEvent,
  AgentForgeError,
  generateRunId,
  isTerminal,
  errorToRunStatus,
  redact,
  truncateForLog,
} from '@agentforge/shared';
import type { Config, RunRecord, StageExecution } from '@agentforge/schemas';
import { safeConfigSnapshot } from '@agentforge/schemas';
import { assertValidTransition, isRetryable, backoffMs } from '@agentforge/policies';
import type { ChallengeAdapter, AdapterDeps } from '@agentforge/adapter-kit';
import type { LLMAdapter } from '@agentforge/llm';

// ─── Run Context ──────────────────────────────────────────────────────────────

export interface RunContext {
  runId: string;
  status: RunStatus;
  adapterId: string;
  config: Config;
  runDir: string;
  events: RunEvent[];
  stages: StageExecution[];
  results: RecordResult[];
  startedAt?: string;
  finishedAt?: string;
  inputHash: string;
  codeVersion: string;
  cancelled: boolean;
  mode?: 'NORMAL' | 'SAMPLE' | 'DRY_RUN';
}

// ─── Orchestrator Options ─────────────────────────────────────────────────────

export interface OrchestratorOptions {
  adapter: ChallengeAdapter;
  llm: LLMAdapter;
  config: Config;
  inputPath: string;
  outputPath: string;
  runId?: string;
  resumeId?: string;
  runsDir?: string;
  sample?: number; // FR-037: Process deterministic subset of size N
  dryRun?: boolean; // FR-037: Validate pipeline without calling LLM
  concurrency?: number; // FR-038: Bounded concurrency pool
}

// ─── Checkpoint (FR-033) ──────────────────────────────────────────────────────

export interface CheckpointEntry {
  recordId: string;
  status: CheckStatus;
  outputHash: string;
  output?: unknown;
}

export function loadCheckpoint(checkpointPath: string): Map<string, CheckpointEntry> {
  const entries = new Map<string, CheckpointEntry>();
  if (!fs.existsSync(checkpointPath)) return entries;

  const lines = fs.readFileSync(checkpointPath, 'utf-8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as CheckpointEntry;
      entries.set(entry.recordId, entry);
    } catch {
      // Corrupted checkpoint line — skip, will reprocess (FR-033)
      console.warn(`Corrupted checkpoint line, will reprocess: ${truncateForLog(line, 100)}`);
    }
  }
  return entries;
}

export function appendCheckpoint(checkpointPath: string, entry: CheckpointEntry): void {
  fs.appendFileSync(checkpointPath, JSON.stringify(entry) + '\n');
}

// ─── Atomic Writer (FR-015) ───────────────────────────────────────────────────

/**
 * Write output atomically: temp file → rename.
 * Output path comes from config/code, never from model output.
 */
async function atomicWrite(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempPath = filePath + `.tmp.${Date.now()}`;
  fs.writeFileSync(tempPath, content, 'utf-8');
  fs.renameSync(tempPath, filePath);
}

// ─── Event Emitter ────────────────────────────────────────────────────────────

function emitEvent(ctx: RunContext, type: string, payload: Record<string, unknown> = {}): void {
  const event: RunEvent = {
    runId: ctx.runId,
    sequence: ctx.events.length,
    type,
    payload: { ...payload },
    timestamp: new Date().toISOString(),
  };
  ctx.events.push(event);

  // Append to trace file
  const tracePath = path.join(ctx.runDir, 'trace.jsonl');
  fs.appendFileSync(tracePath, JSON.stringify(event) + '\n');
}

// ─── Status Transition ────────────────────────────────────────────────────────

function transition(ctx: RunContext, to: RunStatus): void {
  assertValidTransition(ctx.status, to);
  const from = ctx.status;
  ctx.status = to;
  emitEvent(ctx, 'status_change', { from, to });
}

// ─── Input Hashing ────────────────────────────────────────────────────────────

function hashInput(inputPath: string): string {
  const content = fs.readFileSync(inputPath);
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

function getCodeVersion(): string {
  try {
    const { execSync } = require('child_process') as typeof import('child_process');
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

// ─── Main Orchestrator ────────────────────────────────────────────────────────

export async function executeRun(options: OrchestratorOptions): Promise<RunContext> {
  const {
    adapter,
    llm,
    config,
    inputPath,
    outputPath,
  } = options;

  const runId = options.runId ?? generateRunId();
  const runsDir = options.runsDir ?? path.join(process.cwd(), 'runs');
  const runDir = path.join(runsDir, runId);

  // Create run directory (FR-022: dedicated directory per run)
  fs.mkdirSync(runDir, { recursive: true });

  const ctx: RunContext = {
    runId,
    status: 'queued',
    adapterId: adapter.id,
    config,
    runDir,
    events: [],
    stages: [],
    results: [],
    inputHash: hashInput(inputPath),
    codeVersion: getCodeVersion(),
    cancelled: false,
  };

  // Save input snapshot
  fs.copyFileSync(inputPath, path.join(runDir, 'input.json'));

  // Save config snapshot (secrets stripped — FR-001)
  const configSnapshot = safeConfigSnapshot(config);
  await atomicWrite(
    path.join(runDir, 'config.snapshot.json'),
    JSON.stringify(configSnapshot, null, 2),
  );

  // Timeout controller (FR-014)
  const timeoutMs = config.MAX_RUN_DURATION_SECONDS * 1000;
  const deadline = Date.now() + timeoutMs;

  const adapterDeps: AdapterDeps = {
    llm,
    config,
    log: (event, payload) => emitEvent(ctx, event, payload),
  };

  try {
    // ── Stage 1: Parse Input (FR-002) ─────────────────────────────────────
    transition(ctx, 'running');
    ctx.startedAt = new Date().toISOString();
    emitEvent(ctx, 'run_started', { runId, adapterId: adapter.id });

    const stageStart = Date.now();
    const rawInput = fs.readFileSync(inputPath, 'utf-8');

    if (rawInput.length > config.MAX_INPUT_CHARS) {
      throw new AgentForgeError(
        'INPUT_INVALID',
        `Input exceeds maximum size: ${rawInput.length} chars > ${config.MAX_INPUT_CHARS} limit`,
      );
    }

    const parseResult = adapter.parseInput(rawInput);

    if (parseResult.batchErrors.length > 0) {
      throw new AgentForgeError(
        'INPUT_INVALID',
        `Batch parse errors: ${parseResult.batchErrors.join('; ')}`,
      );
    }

    const records = parseResult.records;
    emitEvent(ctx, 'input_parsed', {
      recordCount: records.length,
      recordErrors: parseResult.recordErrors.length,
    });

    ctx.stages.push({
      runId,
      stage: 'parse_input',
      status: 'passed',
      durationMs: Date.now() - stageStart,
      startedAt: new Date(stageStart).toISOString(),
      finishedAt: new Date().toISOString(),
      attempts: 1,
    });

    // ── Mode & Sampling (FR-037) ──────────────────────────────────────────
    const mode: 'NORMAL' | 'SAMPLE' | 'DRY_RUN' = options.dryRun
      ? 'DRY_RUN'
      : (options.sample ? 'SAMPLE' : 'NORMAL');
    ctx.mode = mode;

    let recordsToProcess = records;
    if (options.sample !== undefined && options.sample > 0) {
      recordsToProcess = records.slice(0, options.sample);
      emitEvent(ctx, 'sample_mode', {
        sampleSize: options.sample,
        originalCount: records.length,
      });
    }

    // ── Stage 2: Process Records ──────────────────────────────────────────
    const checkpointPath = path.join(runDir, 'checkpoint.jsonl');
    const checkpoint = options.resumeId
      ? loadCheckpoint(path.join(runsDir, options.resumeId, 'checkpoint.jsonl'))
      : new Map<string, CheckpointEntry>();

    // Load previously written outputs on resume if available
    if (options.resumeId) {
      const prevOutputPath = path.join(runsDir, options.resumeId, 'output.json');
      if (fs.existsSync(prevOutputPath)) {
        try {
          const prevOutputs = JSON.parse(fs.readFileSync(prevOutputPath, 'utf-8'));
          if (Array.isArray(prevOutputs)) {
            for (const out of prevOutputs) {
              const recId = adapter.recordId(out);
              if (recId && checkpoint.has(recId)) {
                const entry = checkpoint.get(recId)!;
                if (!entry.output) entry.output = out;
              }
            }
          }
        } catch {}
      }
    }

    if (options.dryRun) {
      // Dry-run mode: validates input and wiring without calling LLM (FR-037)
      emitEvent(ctx, 'dry_run_started', { recordCount: recordsToProcess.length });
      for (const record of recordsToProcess) {
        const recordId = adapter.recordId(record);
        const normalized = adapter.normalize(record);
        await adapter.buildContext(normalized, adapterDeps);
        const dryRunOutput = adapter.toOutput(normalized, { sentiment: 'neutral', confidence: 1.0, reasoning: 'DRY_RUN' } as any);
        ctx.results.push({
          recordId,
          status: 'passed',
          output: dryRunOutput,
          evidenceRefs: ['dry_run'],
          attempts: 1,
          durationMs: 0,
        });
        ctx.stages.push({
          runId,
          recordId,
          stage: 'process_record_dry_run',
          status: 'passed',
          attempts: 1,
          durationMs: 0,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        });
      }
      emitEvent(ctx, 'dry_run_completed', { recordCount: ctx.results.length });
    } else {
      // Bounded Concurrency Pool (FR-038)
      const concurrency = Math.max(1, options.concurrency ?? config.BATCH_CONCURRENCY ?? 4);
      const workerCount = Math.min(concurrency, recordsToProcess.length);
      emitEvent(ctx, 'concurrency_pool_started', {
        concurrency: workerCount,
        totalRecords: recordsToProcess.length,
      });

      const results: RecordResult[] = new Array(recordsToProcess.length);
      let nextIdx = 0;

      const processRecordAtIndex = async (idx: number): Promise<RecordResult> => {
        const record = recordsToProcess[idx];

        // Check timeout (FR-014)
        if (Date.now() > deadline) {
          throw new AgentForgeError('RUN_TIMED_OUT', 'Run exceeded maximum duration');
        }

        // Check cancellation (FR-014)
        if (ctx.cancelled) {
          throw new AgentForgeError('CANCELLED_BY_USER', 'Run cancelled by user');
        }

        const recordId = adapter.recordId(record);

        // Skip completed records on resume (FR-033)
        const existing = checkpoint.get(recordId);
        if (existing && existing.status === 'passed') {
          emitEvent(ctx, 'record_skipped', { recordId, reason: 'resume' });
          appendCheckpoint(checkpointPath, existing);
          return {
            recordId,
            status: 'passed',
            output: existing.output,
            evidenceRefs: ['checkpoint_resume'],
            attempts: 0,
            durationMs: 0,
          };
        }

        const recordStart = Date.now();
        let recordStatus: CheckStatus = 'not_run';
        let recordOutput: unknown;
        let recordError: { category: ErrorCategory; message: string } | undefined;
        let attempts = 0;

        try {
          // ── Normalize (FR-003) ─────────────────────────────────────────
          const normalized = adapter.normalize(record);

          // ── Build Context (FR-005) ────────────────────────────────────
          const context = await adapter.buildContext(normalized, adapterDeps);

          // ── Decide (FR-007) ───────────────────────────────────────────
          const decision = await adapter.decide(normalized, context, adapterDeps);
          attempts = 1;

          // ── To Output (FR-004) ────────────────────────────────────────
          const output = adapter.toOutput(normalized, decision);
          recordOutput = output;
          recordStatus = 'passed';

          emitEvent(ctx, 'record_processed', { recordId, status: 'passed' });
        } catch (error) {
          attempts++;
          const category: ErrorCategory = error instanceof AgentForgeError
            ? error.category
            : 'INTERNAL_ERROR';
          const message = error instanceof AgentForgeError
            ? error.safeMessage
            : 'An unexpected error occurred';

          // Retry logic (FR-013)
          if (isRetryable(category)) {
            let retried = false;
            for (let retry = 0; retry < config.MAX_TRANSIENT_RETRIES; retry++) {
              if (Date.now() > deadline) break;
              const delay = backoffMs(retry);
              await new Promise((resolve) => setTimeout(resolve, delay));
              attempts++;

              try {
                const normalized = adapter.normalize(record);
                const context = await adapter.buildContext(normalized, adapterDeps);
                const decision = await adapter.decide(normalized, context, adapterDeps);
                recordOutput = adapter.toOutput(normalized, decision);
                recordStatus = 'passed';
                retried = true;
                emitEvent(ctx, 'record_retried_success', { recordId, attempt: attempts });
                break;
              } catch {
                emitEvent(ctx, 'record_retry_failed', { recordId, attempt: attempts });
              }
            }

            if (!retried) {
              recordStatus = 'failed';
              recordError = { category, message };
            }
          } else {
            recordStatus = 'failed';
            recordError = { category, message };
          }

          emitEvent(ctx, 'record_error', {
            recordId,
            category,
            message: redact(message),
          });
        }

        const result: RecordResult = {
          recordId,
          status: recordStatus,
          output: recordOutput,
          evidenceRefs: [],
          error: recordError,
          attempts,
          durationMs: Date.now() - recordStart,
          modelId: llm.usageLedger.length > 0
            ? llm.usageLedger[llm.usageLedger.length - 1].modelId
            : undefined,
        };

        // Save checkpoint (FR-033)
        appendCheckpoint(checkpointPath, {
          recordId,
          status: recordStatus,
          outputHash: recordOutput
            ? crypto.createHash('sha256').update(JSON.stringify(recordOutput)).digest('hex').substring(0, 16)
            : '',
          output: recordOutput,
        });

        ctx.stages.push({
          runId,
          recordId,
          stage: 'process_record',
          status: recordStatus,
          errorCategory: recordError?.category,
          errorMessage: recordError?.message,
          attempts,
          durationMs: Date.now() - recordStart,
          startedAt: new Date(recordStart).toISOString(),
          finishedAt: new Date().toISOString(),
        });

        return result;
      };

      const worker = async () => {
        while (nextIdx < recordsToProcess.length) {
          if (Date.now() > deadline || ctx.cancelled) break;
          const current = nextIdx++;
          if (current >= recordsToProcess.length) break;
          results[current] = await processRecordAtIndex(current);
        }
      };

      await Promise.all(Array.from({ length: workerCount }, () => worker()));
      ctx.results = results.filter(Boolean);
    }

    // ── Stage 3: Validate Output (FR-004, FR-015) ─────────────────────────
    const outputs = ctx.results
      .filter((r) => r.status === 'passed' && r.output !== undefined)
      .map((r) => r.output);

    const validationResult = adapter.validateOutput(outputs as any[], recordsToProcess);

    if (!validationResult.ok) {
      emitEvent(ctx, 'output_validation_failed', { problems: validationResult.problems });
      throw new AgentForgeError(
        'OUTPUT_INVALID',
        `Output validation failed: ${validationResult.problems.join('; ')}`,
      );
    }

    emitEvent(ctx, 'output_validated', { recordCount: outputs.length });

    // ── Stage 4: Write Output (FR-015 — atomic write + revalidation) ─────
    await adapter.writeOutput(outputs as any[], outputPath);
    await atomicWrite(outputPath, fs.readFileSync(outputPath, 'utf-8'));

    // Reopen and revalidate (FR-015)
    const writtenContent = fs.readFileSync(outputPath, 'utf-8');
    const revalidateResult = adapter.parseInput(writtenContent);
    if (revalidateResult.batchErrors.length > 0) {
      throw new AgentForgeError(
        'OUTPUT_INVALID',
        'Output revalidation after writing failed — file may be corrupt',
      );
    }

    emitEvent(ctx, 'output_written', { path: outputPath });

    // ── Compute final status ──────────────────────────────────────────────
    const failedCount = ctx.results.filter((r) => r.status === 'failed').length;
    const blockedCount = ctx.results.filter((r) => r.status === 'blocked').length;

    if (failedCount === 0 && blockedCount === 0) {
      transition(ctx, 'succeeded');
    } else if (failedCount > 0) {
      transition(ctx, 'failed');
    } else {
      transition(ctx, 'blocked');
    }
  } catch (error) {
    const category: ErrorCategory = error instanceof AgentForgeError
      ? error.category
      : 'INTERNAL_ERROR';

    const targetStatus = errorToRunStatus(category);
    if (!isTerminal(ctx.status)) {
      try {
        transition(ctx, targetStatus);
      } catch {
        // If transition is invalid, force to failed
        ctx.status = targetStatus;
      }
    }

    emitEvent(ctx, 'run_error', {
      category,
      message: error instanceof Error ? redact(error.message) : 'Unknown error',
    });
  }

  // ── Finalize ────────────────────────────────────────────────────────────────
  ctx.finishedAt = new Date().toISOString();
  emitEvent(ctx, 'run_finished', { status: ctx.status });

  // Save run record
  const runRecord: RunRecord = {
    id: ctx.runId,
    status: ctx.status,
    adapterId: ctx.adapterId,
    inputHash: ctx.inputHash,
    configSnapshot: safeConfigSnapshot(ctx.config),
    codeVersion: ctx.codeVersion,
    createdAt: ctx.startedAt ?? new Date().toISOString(),
    startedAt: ctx.startedAt,
    finishedAt: ctx.finishedAt,
    mode: ctx.mode ?? 'NORMAL',
  };

  await atomicWrite(
    path.join(ctx.runDir, 'run.json'),
    JSON.stringify(runRecord, null, 2),
  );

  // Save metrics
  const metrics: Record<string, number | 'unavailable'> = {
    totalRecords: ctx.results.length,
    succeededRecords: ctx.results.filter((r) => r.status === 'passed').length,
    failedRecords: ctx.results.filter((r) => r.status === 'failed').length,
    blockedRecords: ctx.results.filter((r) => r.status === 'blocked').length,
    totalDurationMs: ctx.finishedAt && ctx.startedAt
      ? new Date(ctx.finishedAt).getTime() - new Date(ctx.startedAt).getTime()
      : 0,
    llmCalls: llm.callCount,
  };

  await atomicWrite(
    path.join(ctx.runDir, 'metrics.json'),
    JSON.stringify(metrics, null, 2),
  );

  return ctx;
}

// ── Cancel helper ─────────────────────────────────────────────────────────────

export function cancelRun(ctx: RunContext): void {
  ctx.cancelled = true;
}

// ── Packaging & Submission Validator (Workstream 2) ───────────────────────────

export * from './packaging.js';

// ── Operator Readiness Diagnostics (Workstream 3) ─────────────────────────────

export * from './diagnostics.js';
