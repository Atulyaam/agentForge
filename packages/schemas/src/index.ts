/**
 * @agentforge/schemas — Zod schemas for every untrusted boundary.
 *
 * Validates: configuration, run requests, agent outputs, events, reports.
 * Nothing crosses a trust boundary without passing through a schema here.
 */

import { z } from 'zod';
import {
  RUN_STATUSES,
  CHECK_STATUSES,
  ERROR_CATEGORIES,
  DEFAULTS,
} from '@agentforge/shared';

// ─── Configuration Schema (FR-001) ───────────────────────────────────────────

export const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LLM_API_KEY: z.string().min(1, 'LLM_API_KEY is required'),
  LLM_MODEL: z.string().min(1, 'LLM_MODEL is required'),
  JOB_RUNNER: z.enum(['inline', 'bullmq']).default('inline'),
  MAX_TRANSIENT_RETRIES: z.coerce.number().int().min(0).default(DEFAULTS.MAX_TRANSIENT_RETRIES),
  MAX_SCHEMA_CORRECTIONS: z.coerce.number().int().min(0).default(DEFAULTS.MAX_SCHEMA_CORRECTIONS),
  MAX_REPAIR_ATTEMPTS: z.coerce.number().int().min(0).default(DEFAULTS.MAX_REPAIR_ATTEMPTS),
  MAX_RUN_DURATION_SECONDS: z.coerce.number().int().min(1).default(DEFAULTS.MAX_RUN_DURATION_SECONDS),
  BATCH_MAX_DURATION_SECONDS: z.coerce.number().int().min(1).optional(),
  BATCH_CONCURRENCY: z.coerce.number().int().min(1).default(DEFAULTS.BATCH_CONCURRENCY),
  MAX_INPUT_CHARS: z.coerce.number().int().min(1).default(DEFAULTS.MAX_INPUT_CHARS),
  MAX_CONTEXT_CHARS: z.coerce.number().int().min(1).default(DEFAULTS.MAX_CONTEXT_CHARS),
  MAX_OUTPUT_BYTES: z.coerce.number().int().min(1).default(DEFAULTS.MAX_OUTPUT_BYTES),
  LOG_MAX_BYTES: z.coerce.number().int().min(1).default(DEFAULTS.LOG_MAX_BYTES),
  MAX_LLM_CALLS_PER_RUN: z.coerce.number().int().min(1).optional(),
  CACHE_ENABLED: z.preprocess(
    (v) => v === 'true' || v === true,
    z.boolean().default(false),
  ),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Load and validate configuration from environment variables.
 * Missing required config → throws AgentForgeError(CONFIG_INVALID).
 * Secrets are never logged or returned in error messages.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => {
      // Never include the actual value (could be a secret)
      const path = i.path.join('.');
      return `${path}: ${i.message}`;
    });
    // Import at function level to avoid circular — but shared has no deps, so fine
    const { AgentForgeError } = require('@agentforge/shared') as typeof import('@agentforge/shared');
    throw new AgentForgeError(
      'CONFIG_INVALID',
      `Configuration errors:\n  ${issues.join('\n  ')}`,
    );
  }
  return result.data;
}

// ─── Run State Schema ─────────────────────────────────────────────────────────

export const RunStatusSchema = z.enum(RUN_STATUSES);
export const CheckStatusSchema = z.enum(CHECK_STATUSES);
export const ErrorCategorySchema = z.enum(ERROR_CATEGORIES);

// ─── Run Request (for web API — T1-full) ──────────────────────────────────────

export const RunRequestSchema = z.object({
  adapterId: z.string().min(1),
  input: z.unknown(),
  inputPath: z.string().optional(),
  configOverrides: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().optional(),
});

export type RunRequest = z.infer<typeof RunRequestSchema>;

// ─── Run Record (file-based state for T0/T1-lite) ────────────────────────────

export const RunRecordSchema = z.object({
  id: z.string(),
  status: RunStatusSchema,
  adapterId: z.string(),
  inputHash: z.string(),
  configSnapshot: z.record(z.string(), z.unknown()),
  codeVersion: z.string(),
  errorCategory: ErrorCategorySchema.optional(),
  errorMessage: z.string().optional(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  mode: z.enum(['NORMAL', 'SAMPLE', 'DRY_RUN']).optional(),
  metrics: z.record(z.string(), z.union([z.number(), z.literal('unavailable')])).optional(),
});

export type RunRecord = z.infer<typeof RunRecordSchema>;

// ─── Stage Execution ──────────────────────────────────────────────────────────

export const StageExecutionSchema = z.object({
  runId: z.string(),
  recordId: z.string().optional(),
  stage: z.string(),
  status: CheckStatusSchema,
  errorCategory: ErrorCategorySchema.optional(),
  errorMessage: z.string().optional(),
  attempts: z.number().int().min(1).default(1),
  durationMs: z.number().optional(),
  modelId: z.string().optional(),
  promptVersion: z.string().optional(),
  inputRef: z.string().optional(),
  outputRef: z.string().optional(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
});

export type StageExecution = z.infer<typeof StageExecutionSchema>;

// ─── Run Event ────────────────────────────────────────────────────────────────

export const RunEventSchema = z.object({
  runId: z.string(),
  sequence: z.number().int().min(0),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  timestamp: z.string(),
});

export type RunEventRecord = z.infer<typeof RunEventSchema>;

// ─── Record Result Schema ─────────────────────────────────────────────────────

export const RecordResultSchema = z.object({
  recordId: z.string(),
  status: CheckStatusSchema,
  output: z.unknown().optional(),
  evidenceRefs: z.array(z.string()),
  error: z.object({
    category: ErrorCategorySchema,
    message: z.string(),
  }).optional(),
  attempts: z.number().int().min(1),
  durationMs: z.number(),
  modelId: z.string().optional(),
  promptVersion: z.string().optional(),
});

// ─── Report Schema (FR-030) ──────────────────────────────────────────────────

export const ReportSchema = z.object({
  runId: z.string(),
  status: RunStatusSchema,
  inputHash: z.string(),
  codeVersion: z.string(),
  configSnapshot: z.record(z.string(), z.unknown()),
  counts: z.object({
    total: z.number(),
    succeeded: z.number(),
    failed: z.number(),
    blocked: z.number(),
    skipped: z.number(),
    notRun: z.number(),
  }),
  stages: z.array(z.object({
    stage: z.string(),
    durationMs: z.number(),
    status: CheckStatusSchema,
  })),
  errorCategories: z.record(ErrorCategorySchema, z.number()),
  metrics: z.record(z.string(), z.union([z.number(), z.literal('unavailable')])),
  topFailures: z.array(z.object({
    recordId: z.string(),
    errorCategory: ErrorCategorySchema,
    message: z.string(),
  })).max(10),
  limitations: z.array(z.string()),
  notRunChecks: z.array(z.object({
    check: z.string(),
    reason: z.string(),
  })),
});

export type Report = z.infer<typeof ReportSchema>;

// ─── Config snapshot (for run storage — strips secrets) ──────────────────────

export function safeConfigSnapshot(config: Config): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { LLM_API_KEY, ...safe } = config;
  return safe as Record<string, unknown>;
}
