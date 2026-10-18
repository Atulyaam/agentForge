/**
 * Deterministic Failure-Injection and Recovery Verification (Workstream 2)
 *
 * Scenarios tested:
 * 1. Provider timeout and simulated rate limits with bounded retries & backoff
 * 2. Malformed structured model output & 1-shot schema repair loop
 * 3. LLM call and token budget exhaustion (BudgetGuard containment)
 * 4. Corrupt or partially written checkpoint recovery (FR-033)
 * 5. Process interruption followed by run resume with input/output parity
 * 6. Packaging validator rejecting invalid output fail-closed
 * 7. Terminal status immutability (state machine protection)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { z } from 'zod';
import {
  executeRun,
  loadCheckpoint,
  appendCheckpoint,
  SubmissionPackager,
} from '@agentforge/orchestrator';
import {
  LLMAdapter,
  MockLLMProvider,
  BudgetGuard,
} from '@agentforge/llm';
import {
  assertValidTransition,
  isValidTransition,
  isRetryable,
  isNonRetryable,
  backoffMs,
} from '@agentforge/policies';
import { AgentForgeError } from '@agentforge/shared';
import type { Config } from '@agentforge/schemas';
import { DemoAdapter } from '../../../apps/cli/src/demo-adapter';

describe('Failure-Injection & Recovery Verification — Workstream 2', () => {
  let tempDir: string;
  let runsDir: string;
  let testConfig: Config;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-fault-test-'));
    runsDir = path.join(tempDir, 'runs');
    fs.mkdirSync(runsDir, { recursive: true });

    testConfig = {
      LLM_PROVIDER: 'mock',
      LLM_MODEL: 'mock-model',
      MAX_RUN_DURATION_SECONDS: 30,
      MAX_TRANSIENT_RETRIES: 2,
      MAX_SCHEMA_CORRECTIONS: 1,
      MAX_REPAIR_ATTEMPTS: 1,
      BATCH_CONCURRENCY: 1,
      MAX_INPUT_CHARS: 50_000,
      MAX_LLM_CALLS_PER_RUN: 20,
    };
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('Scenario 1: Provider Timeout & Simulated Rate Limit', () => {
    it('classifies LLM_TIMEOUT and LLM_RATE_LIMITED as transient retryable', () => {
      expect(isRetryable('LLM_TIMEOUT')).toBe(true);
      expect(isRetryable('LLM_RATE_LIMITED')).toBe(true);
      expect(isRetryable('CONFIG_INVALID')).toBe(false);
      expect(isNonRetryable('BUDGET_EXCEEDED')).toBe(true);
    });

    it('calculates deterministic bounded backoff delay with jitter', () => {
      const delay0 = backoffMs(0, 100);
      const delay1 = backoffMs(1, 100);
      expect(delay0).toBeGreaterThanOrEqual(100);
      expect(delay1).toBeGreaterThanOrEqual(200);
      expect(backoffMs(10, 1000)).toBeLessThanOrEqual(60_000); // capped at 60s
    });

    it('recovers successfully when transient rate limits resolve within retry budget', async () => {
      let callCount = 0;
      const provider = new MockLLMProvider();
      // Fail first attempt with LLM_RATE_LIMITED, succeed on retry
      provider.setDefaultResponse(() => {
        callCount++;
        if (callCount <= 1) {
          throw new AgentForgeError('LLM_RATE_LIMITED', 'Simulated 429 Too Many Requests');
        }
        return JSON.stringify({ sentiment: 'positive', confidence: 0.95, reasoning: 'Recovered' });
      });

      const llm = new LLMAdapter(provider, testConfig);
      const inputPath = path.join(tempDir, 'single.json');
      fs.writeFileSync(inputPath, JSON.stringify([{ id: 'rec-1', text: 'Great service' }]));

      const outputPath = path.join(tempDir, 'output.json');
      const ctx = await executeRun({
        adapter: DemoAdapter,
        llm,
        config: testConfig,
        inputPath,
        outputPath,
        runsDir,
      });

      expect(ctx.status).toBe('succeeded');
      expect(ctx.results[0].status).toBe('passed');
      expect(ctx.results[0].attempts).toBe(2); // 1 initial + 1 retry
      expect(ctx.events.some((e) => e.type === 'record_retried_success')).toBe(true);
    });

    it('marks record failed when transient retries are completely exhausted', async () => {
      const provider = new MockLLMProvider();
      provider.setDefaultResponse(() => {
        throw new AgentForgeError('LLM_TIMEOUT', 'Simulated gateway timeout');
      });

      const llm = new LLMAdapter(provider, testConfig);
      const inputPath = path.join(tempDir, 'timeout-input.json');
      fs.writeFileSync(inputPath, JSON.stringify([{ id: 'rec-timeout', text: 'Hanging request' }]));

      const outputPath = path.join(tempDir, 'timeout-output.json');
      const ctx = await executeRun({
        adapter: DemoAdapter,
        llm,
        config: testConfig,
        inputPath,
        outputPath,
        runsDir,
      });

      expect(ctx.status).toBe('failed');
      expect(ctx.results[0].status).toBe('failed');
      expect(ctx.results[0].error?.category).toBe('LLM_TIMEOUT');
      expect(ctx.results[0].attempts).toBe(3); // 1 initial + 2 retries
    });
  });

  describe('Scenario 2: Malformed Structured Model Output & Schema Repair', () => {
    it('successfully repairs malformed JSON using bounded 1-shot schema correction', async () => {
      let callStep = 0;
      const provider = new MockLLMProvider();
      provider.setDefaultResponse(() => {
        callStep++;
        if (callStep === 1) {
          // First attempt: malformed JSON
          return '{ unquoted_key: missing_quotes';
        }
        // Second attempt: valid schema-compliant JSON
        return JSON.stringify({ sentiment: 'positive', confidence: 0.88, reasoning: 'Repaired JSON' });
      });

      const llm = new LLMAdapter(provider, testConfig);
      const schema = z.object({
        sentiment: z.enum(['positive', 'negative', 'neutral']),
        confidence: z.number(),
        reasoning: z.string(),
      });

      const result = await llm.callStructured({
        schema,
        schemaName: 'SentimentOutput',
        systemPrompt: 'Classify sentiment',
        userPrompt: 'The product was awesome',
        promptVersion: 'v1.0',
      });

      expect(result.data.sentiment).toBe('positive');
      expect(callStep).toBe(2); // 1 initial + 1 correction
    });

    it('throws LLM_INVALID_OUTPUT when correction attempts are exhausted', async () => {
      const provider = new MockLLMProvider('invalid string that never parses as schema');
      const llm = new LLMAdapter(provider, testConfig);
      const schema = z.object({ value: z.number() });

      await expect(
        llm.callStructured({
          schema,
          schemaName: 'NumberSchema',
          systemPrompt: 'Extract number',
          userPrompt: 'Input text',
          promptVersion: 'v1.0',
        }),
      ).rejects.toThrowError(/failed schema validation after 1 correction/);
    });

    it('isolates malformed records so subsequent valid records in batch succeed', async () => {
      let callCount = 0;
      const provider = new MockLLMProvider();
      provider.setDefaultResponse(() => {
        callCount++;
        // Record 1 fails schema validation permanently
        if (callCount <= 2) {
          return 'corrupted non-json output';
        }
        // Record 2 succeeds
        return JSON.stringify({ sentiment: 'negative', confidence: 0.9, reasoning: 'Bad experience' });
      });

      const llm = new LLMAdapter(provider, testConfig);
      const inputPath = path.join(tempDir, 'mixed.json');
      fs.writeFileSync(
        inputPath,
        JSON.stringify([
          { id: 'rec-fail', text: 'Broken record' },
          { id: 'rec-pass', text: 'Terrible customer service' },
        ]),
      );

      const outputPath = path.join(tempDir, 'mixed-output.json');
      const ctx = await executeRun({
        adapter: DemoAdapter,
        llm,
        config: testConfig,
        inputPath,
        outputPath,
        runsDir,
      });

      // Overall run is failed due to row 1, but row 2 processed successfully
      expect(ctx.status).toBe('failed');
      expect(ctx.results).toHaveLength(2);
      expect(ctx.results[0].status).toBe('failed');
      expect(ctx.results[1].status).toBe('passed');
    });

    it('never accepts invalid output just because the model claims success in text', () => {
      const schema = z.object({
        sentiment: z.enum(['positive', 'negative', 'neutral']),
      });

      // Model claims success but output lacks the required enum contract
      const selfClaimedSuccess = '{"status": "success", "message": "completed correctly"}';
      const parsed = JSON.parse(selfClaimedSuccess);
      const validation = schema.safeParse(parsed);

      expect(validation.success).toBe(false);
    });
  });

  describe('Scenario 3: Call & Token Budget Exhaustion', () => {
    it('BudgetGuard prevents unmetered loops by throwing BUDGET_EXCEEDED', () => {
      const guard = new BudgetGuard(2);
      guard.check();
      guard.record({
        content: 'test',
        modelId: 'mock',
        promptVersion: 'v1',
        usage: { latencyMs: 10 },
        cached: false,
      });
      guard.check();
      guard.record({
        content: 'test',
        modelId: 'mock',
        promptVersion: 'v1',
        usage: { latencyMs: 10 },
        cached: false,
      });

      // Third call must be rejected
      expect(() => guard.check()).toThrowError(/LLM call budget exhausted/);
      expect(guard.count).toBe(2);
    });
  });

  describe('Scenario 4: Corrupt or Partially Written Checkpoint Recovery', () => {
    it('safely skips corrupt lines in checkpoint.jsonl and loads valid entries (FR-033)', () => {
      const checkpointFile = path.join(tempDir, 'corrupt-checkpoint.jsonl');
      const validEntry1 = { recordId: 'rec-1', status: 'passed', outputHash: 'hash-1' };
      const validEntry2 = { recordId: 'rec-3', status: 'passed', outputHash: 'hash-3' };

      fs.writeFileSync(
        checkpointFile,
        [
          JSON.stringify(validEntry1),
          '{"recordId": "rec-2", status: TRUNCATED_CORRUPT_JSON', // Corrupted line
          '',
          JSON.stringify(validEntry2),
        ].join('\n'),
      );

      const loaded = loadCheckpoint(checkpointFile);
      expect(loaded.size).toBe(2);
      expect(loaded.has('rec-1')).toBe(true);
      expect(loaded.has('rec-3')).toBe(true);
      expect(loaded.has('rec-2')).toBe(false); // Corrupt record will be safely reprocessed
    });
  });

  describe('Scenario 5: Process Interruption & Run Resume with Parity', () => {
    it('resumes interrupted batch, skipping completed rows with 0 duplicate LLM calls', async () => {
      const inputPath = path.join(tempDir, 'batch-4.json');
      const records = [
        { id: 'rec-1', text: 'Loved it' },
        { id: 'rec-2', text: 'Hated it' },
        { id: 'rec-3', text: 'Neutral opinion' },
        { id: 'rec-4', text: 'Exceptional quality' },
      ];
      fs.writeFileSync(inputPath, JSON.stringify(records));

      let llmCalls = 0;
      const provider = new MockLLMProvider(() => {
        llmCalls++;
        return JSON.stringify({ sentiment: 'positive', confidence: 0.9, reasoning: 'Mock' });
      });

      const initialRunId = 'run_interrupted_001';
      const initialRunDir = path.join(runsDir, initialRunId);
      fs.mkdirSync(initialRunDir, { recursive: true });

      // Simulate interruption: records 1 & 2 completed in checkpoint before crash
      const initialCheckpointPath = path.join(initialRunDir, 'checkpoint.jsonl');
      appendCheckpoint(initialCheckpointPath, {
        recordId: 'rec-1',
        status: 'passed',
        outputHash: 'hash-1',
        output: { id: 'rec-1', sentiment: 'positive' },
      });
      appendCheckpoint(initialCheckpointPath, {
        recordId: 'rec-2',
        status: 'passed',
        outputHash: 'hash-2',
        output: { id: 'rec-2', sentiment: 'positive' },
      });

      // Resume run
      const resumedRunId = 'run_resumed_002';
      const resumedOutputPath = path.join(tempDir, 'resumed-output.json');
      const llm = new LLMAdapter(provider, testConfig);

      const ctx = await executeRun({
        adapter: DemoAdapter,
        llm,
        config: testConfig,
        inputPath,
        outputPath: resumedOutputPath,
        runId: resumedRunId,
        resumeId: initialRunId,
        runsDir,
      });

      expect(ctx.status).toBe('succeeded');
      expect(ctx.results).toHaveLength(4);

      // Records 1 & 2 were skipped with 0 attempts and preserved output
      expect(ctx.results[0].attempts).toBe(0);
      expect(ctx.results[0].evidenceRefs).toContain('checkpoint_resume');
      expect(ctx.results[0].output).toBeDefined();

      expect(ctx.results[1].attempts).toBe(0);
      expect(ctx.results[1].evidenceRefs).toContain('checkpoint_resume');
      expect(ctx.results[1].output).toBeDefined();

      // Only records 3 & 4 triggered LLM calls (2 total calls, 0 duplicate work)
      expect(llmCalls).toBe(2);

      // Verify 1:1 input/output correspondence in written file
      const finalOutputs = JSON.parse(fs.readFileSync(resumedOutputPath, 'utf-8'));
      expect(finalOutputs).toHaveLength(4);
      expect(finalOutputs.map((o: any) => o.id)).toEqual(['rec-1', 'rec-2', 'rec-3', 'rec-4']);
    });
  });

  describe('Scenario 6: Packaging Validator Rejection & Fail-Closed Guard', () => {
    it('fails closed and refuses to generate archive when output is invalid or missing', async () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
      const transMd = path.join(tempDir, 'transcript.md');
      fs.writeFileSync(transMd, '# Authentic Conversation Log');
      const targetZip = path.join(tempDir, 'dist', 'submission.zip');

      const packager = new SubmissionPackager(tempDir, 50, 50);

      // Output file does not exist
      await expect(
        packager.packageSubmission({
          outputFile: path.join(tempDir, 'nonexistent-output.json'),
          transcriptFile: transMd,
          archiveOutPath: targetZip,
          dryRun: false,
        }),
      ).rejects.toThrowError(/Packaging failed closed before archiving/);

      // Ensure no archive was created
      expect(fs.existsSync(targetZip)).toBe(false);
    });
  });

  describe('Scenario 7: State Machine Immutability & Terminal States', () => {
    it('disallows state transitions out of terminal states (succeeded, failed, cancelled)', () => {
      expect(isValidTransition('succeeded', 'running')).toBe(false);
      expect(isValidTransition('failed', 'running')).toBe(false);
      expect(isValidTransition('cancelled', 'running')).toBe(false);
      expect(isValidTransition('running', 'succeeded')).toBe(true);

      expect(() => assertValidTransition('succeeded', 'running')).toThrowError(/Invalid state transition/);
      expect(() => assertValidTransition('failed', 'queued')).toThrowError(/Invalid state transition/);
    });
  });
});
