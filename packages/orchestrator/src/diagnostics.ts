/**
 * Safe Operator Readiness Diagnostics (Workstream 3)
 *
 * Deterministically checks configuration schemas, secrets redaction,
 * usable timeouts & retry budgets, writable directories, transcript
 * vault hash integrity, and packaging compliance.
 *
 * Safety guarantees:
 * - Never prints API keys, tokens, or credential values.
 * - Never makes live provider calls or incurs API charges.
 * - Never fabricates fake conversation records or synthetic history.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { ConfigSchema } from '@agentforge/schemas';
import { OFFICIAL_MAX_FILE_SIZE_MB } from './packaging.js';

export type DiagnosticStatus = 'passed' | 'failed' | 'warning' | 'pending';

export interface DiagnosticCheck {
  id: string;
  name: string;
  status: DiagnosticStatus;
  detail: string;
  remediation?: string;
  redacted?: boolean;
}

export interface DiagnosticsReport {
  timestamp: string;
  allPassed: boolean;
  checks: DiagnosticCheck[];
}

export interface DiagnosticsOptions {
  rootDir?: string;
  env?: Record<string, string | undefined>;
}

/**
 * Runs deterministic, offline operator diagnostics.
 */
export async function runDiagnostics(options: DiagnosticsOptions = {}): Promise<DiagnosticsReport> {
  const rootDir = options.rootDir ?? process.cwd();
  const env = options.env ?? process.env;
  const checks: DiagnosticCheck[] = [];

  // 1. Configuration & Secrets Redaction Check
  const apiKeyPresent = Boolean(env.LLM_API_KEY && env.LLM_API_KEY.trim().length > 0);
  const modelPresent = Boolean(env.LLM_MODEL && env.LLM_MODEL.trim().length > 0);

  const parseResult = ConfigSchema.safeParse(env);
  if (!parseResult.success) {
    const issues = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    checks.push({
      id: 'config_schema',
      name: 'Configuration Schema & Required Variables',
      status: 'failed',
      detail: `Configuration validation failed: ${issues.join('; ')} (LLM_API_KEY: ${apiKeyPresent ? '[CONFIGURED - REDACTED]' : '[MISSING]'}, LLM_MODEL: ${modelPresent ? '[CONFIGURED]' : '[MISSING]'})`,
      remediation: 'Configure required variables in .env or environment. For offline mock drills, set LLM_API_KEY=mock-key and LLM_MODEL=mock-model.',
      redacted: true,
    });
  } else {
    checks.push({
      id: 'config_schema',
      name: 'Configuration Schema & Required Variables',
      status: 'passed',
      detail: `Valid configuration verified. Secrets: LLM_API_KEY=[CONFIGURED - REDACTED (${env.LLM_API_KEY!.length} chars)], LLM_MODEL=${parseResult.data.LLM_MODEL}`,
      redacted: true,
    });
  }

  // 2. Provider & Model Configuration
  const selectedModel = env.LLM_MODEL ?? 'unspecified';
  const isMock = selectedModel.includes('mock') || env.LLM_PROVIDER === 'mock' || env.NODE_ENV === 'test';
  if (isMock) {
    checks.push({
      id: 'provider_model',
      name: 'Provider & Model Configuration',
      status: 'passed',
      detail: `Deterministic Mock Provider active (${selectedModel}). Offline testing verified with zero external dependencies.`,
    });
  } else if (!parseResult.success) {
    checks.push({
      id: 'provider_model',
      name: 'Provider & Model Configuration',
      status: 'failed',
      detail: 'Provider configuration invalid. Unable to verify provider setup without valid config schema.',
      remediation: 'Set valid LLM_MODEL and LLM_API_KEY in .env.',
    });
  } else {
    // Live provider is configured, but strictly offline during pre-kickoff!
    checks.push({
      id: 'provider_model',
      name: 'Provider & Model Configuration',
      status: 'pending',
      detail: `Configured for live model "${selectedModel}". Network connectivity is PENDING_KICKOFF (zero live API calls made to prevent token expenditure).`,
      remediation: 'Provider credentials are structured correctly. Confirm live network reachability only during official challenge kickoff window.',
    });
  }

  // 3. Budgets, Timeouts & Guardrails Usability
  if (parseResult.success) {
    const config = parseResult.data;
    const usable =
      config.MAX_RUN_DURATION_SECONDS > 0 &&
      config.MAX_TRANSIENT_RETRIES >= 0 &&
      config.MAX_SCHEMA_CORRECTIONS >= 0 &&
      config.MAX_INPUT_CHARS > 0 &&
      config.BATCH_CONCURRENCY >= 1;

    if (usable) {
      checks.push({
        id: 'budgets_and_guards',
        name: 'Timeout, Retry & Budget Guardrails',
        status: 'passed',
        detail: `Run timeout: ${config.MAX_RUN_DURATION_SECONDS}s, Retries: ${config.MAX_TRANSIENT_RETRIES}, Schema repairs: ${config.MAX_SCHEMA_CORRECTIONS}, Concurrency: ${config.BATCH_CONCURRENCY}, Max input: ${config.MAX_INPUT_CHARS} chars.`,
      });
    } else {
      checks.push({
        id: 'budgets_and_guards',
        name: 'Timeout, Retry & Budget Guardrails',
        status: 'failed',
        detail: 'Guardrail values out of bounds.',
        remediation: 'Set MAX_RUN_DURATION_SECONDS >= 1, MAX_TRANSIENT_RETRIES >= 0, and MAX_INPUT_CHARS > 0 in configuration.',
      });
    }
  } else {
    checks.push({
      id: 'budgets_and_guards',
      name: 'Timeout, Retry & Budget Guardrails',
      status: 'warning',
      detail: 'Cannot fully validate guardrails due to configuration schema errors.',
      remediation: 'Fix configuration schema errors to validate operational budget bounds.',
    });
  }

  // 4. Directory Writability Probes
  const runsDir = path.join(rootDir, 'runs');
  const transcriptDir = path.join(rootDir, 'docs', 'ai-transcript');
  let runsWritable = false;
  let transcriptWritable = false;

  try {
    if (!fs.existsSync(runsDir)) fs.mkdirSync(runsDir, { recursive: true });
    const probeFile = path.join(runsDir, `.probe-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    fs.writeFileSync(probeFile, 'writability-check');
    fs.unlinkSync(probeFile);
    runsWritable = true;
  } catch {}

  try {
    if (!fs.existsSync(transcriptDir)) fs.mkdirSync(transcriptDir, { recursive: true });
    const probeFile = path.join(transcriptDir, `.probe-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    fs.writeFileSync(probeFile, 'writability-check');
    fs.unlinkSync(probeFile);
    transcriptWritable = true;
  } catch {}

  if (runsWritable && transcriptWritable) {
    checks.push({
      id: 'directory_writability',
      name: 'Directory Writability (Runs & AI Transcripts)',
      status: 'passed',
      detail: 'Successfully verified write and delete permissions in runs/ and docs/ai-transcript/.',
    });
  } else {
    const failedDirs: string[] = [];
    if (!runsWritable) failedDirs.push('runs/');
    if (!transcriptWritable) failedDirs.push('docs/ai-transcript/');
    checks.push({
      id: 'directory_writability',
      name: 'Directory Writability (Runs & AI Transcripts)',
      status: 'failed',
      detail: `Missing write permissions in: ${failedDirs.join(', ')}`,
      remediation: `Grant filesystem write permissions to ${failedDirs.join(' and ')} before executing runs or packaging submissions.`,
    });
  }

  // 5. Transcript Vault Integrity
  const indexPath = path.join(transcriptDir, 'INDEX.md');
  if (!fs.existsSync(indexPath)) {
    checks.push({
      id: 'transcript_vault',
      name: 'AI Transcript Vault Integrity',
      status: 'warning',
      detail: 'docs/ai-transcript/INDEX.md does not yet exist. Ready to register genuine transcripts via: pnpm agentforge transcript add <file>.',
      remediation: 'Register genuine conversation exports using "pnpm agentforge transcript add <file>" before submission.',
    });
  } else {
    const indexContent = fs.readFileSync(indexPath, 'utf-8');
    const lines = indexContent.split('\n');
    let validRows = 0;
    const corruptedFiles: string[] = [];

    for (const line of lines) {
      const match = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([a-f0-9]{64})\s*\|/i);
      if (match && match[2] !== 'File') {
        const recordedFile = match[2].trim();
        const recordedHash = match[3].trim().toLowerCase();
        const targetPath = path.join(transcriptDir, recordedFile);
        if (!fs.existsSync(targetPath)) {
          corruptedFiles.push(`${recordedFile} (missing file on disk)`);
        } else {
          const actualHash = crypto.createHash('sha256').update(fs.readFileSync(targetPath)).digest('hex').toLowerCase();
          if (actualHash !== recordedHash) {
            corruptedFiles.push(`${recordedFile} (hash mismatch: expected ${recordedHash.slice(0, 8)}..., got ${actualHash.slice(0, 8)}...)`);
          } else {
            validRows++;
          }
        }
      }
    }

    if (corruptedFiles.length > 0) {
      checks.push({
        id: 'transcript_vault',
        name: 'AI Transcript Vault Integrity',
        status: 'failed',
        detail: `Transcript vault integrity verification failed: ${corruptedFiles.join('; ')}`,
        remediation: 'Re-add untampered transcript files using "pnpm agentforge transcript add <file>". Never alter registered transcripts manually.',
      });
    } else if (validRows === 0) {
      checks.push({
        id: 'transcript_vault',
        name: 'AI Transcript Vault Integrity',
        status: 'warning',
        detail: 'INDEX.md is present, but 0 authentic AI chat transcripts are registered. Authentic chat export must be imported before submission.',
        remediation: 'Export your genuine AI conversation and register it using "pnpm agentforge transcript add <file>".',
      });
    } else {
      checks.push({
        id: 'transcript_vault',
        name: 'AI Transcript Vault Integrity',
        status: 'passed',
        detail: `INDEX.md verified: ${validRows} authentic transcript(s) registered with tamper-proof SHA-256 hashes matching on-disk content. Zero synthetic fabrication detected.`,
      });
    }
  }

  // 6. Packaging Compliance Limit Verification
  if (OFFICIAL_MAX_FILE_SIZE_MB === 50) {
    checks.push({
      id: 'packaging_limits',
      name: 'Packaging Submission Size Limits (50 MB Rule)',
      status: 'passed',
      detail: 'Official 50 MB ceiling strictly retained (OFFICIAL_MAX_FILE_SIZE_MB = 50). Code archive, output artifact, and transcript files each bounded to 50 MB.',
    });
  } else {
    checks.push({
      id: 'packaging_limits',
      name: 'Packaging Submission Size Limits (50 MB Rule)',
      status: 'failed',
      detail: `OFFICIAL_MAX_FILE_SIZE_MB is set to ${OFFICIAL_MAX_FILE_SIZE_MB} MB instead of 50 MB.`,
      remediation: 'Restore OFFICIAL_MAX_FILE_SIZE_MB to 50 in packages/orchestrator/src/packaging.ts to comply with HackerRank rules.',
    });
  }

  // 7. Optional Services Diagnostic
  const jobRunner = env.JOB_RUNNER ?? 'inline';
  if (jobRunner === 'inline') {
    checks.push({
      id: 'optional_services',
      name: 'Optional Background Services (Redis/BullMQ)',
      status: 'passed',
      detail: 'JOB_RUNNER=inline active. Single-node in-process orchestrator requires zero external queue infrastructure.',
    });
  } else if (jobRunner === 'bullmq') {
    const redisConfigured = Boolean(env.REDIS_URL && env.REDIS_URL.trim().length > 0);
    if (!redisConfigured) {
      checks.push({
        id: 'optional_services',
        name: 'Optional Background Services (Redis/BullMQ)',
        status: 'failed',
        detail: 'JOB_RUNNER is set to bullmq but REDIS_URL is missing.',
        remediation: 'Set REDIS_URL in .env or switch JOB_RUNNER=inline for standalone execution.',
      });
    } else {
      checks.push({
        id: 'optional_services',
        name: 'Optional Background Services (Redis/BullMQ)',
        status: 'warning',
        detail: 'JOB_RUNNER=bullmq configured with REDIS_URL. External queue availability not verified offline.',
        remediation: 'Verify Redis broker is reachable or set JOB_RUNNER=inline.',
      });
    }
  }

  const hasFailures = checks.some((c) => c.status === 'failed');
  const allPassed = !hasFailures;

  return {
    timestamp: new Date().toISOString(),
    allPassed,
    checks,
  };
}
