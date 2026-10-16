/**
 * @agentforge/shared — Types, constants, safe errors, and logging helpers.
 * 
 * This is the foundation package: no other @agentforge/* package is imported here.
 */

// ─── Run Status (Section 7.1) ─────────────────────────────────────────────────

export const RUN_STATUSES = [
  'queued',
  'running',
  'waiting_for_provider',
  'repairing',
  'cancelling',
  'succeeded',
  'succeeded_with_warnings',
  'failed',
  'blocked',
  'cancelled',
  'timed_out',
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const TERMINAL_STATUSES: readonly RunStatus[] = [
  'succeeded',
  'succeeded_with_warnings',
  'failed',
  'blocked',
  'cancelled',
  'timed_out',
] as const;

export function isTerminal(status: RunStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

// ─── Check Status (per-stage / per-record) ────────────────────────────────────

export const CHECK_STATUSES = [
  'passed',
  'failed',
  'blocked',
  'timed_out',
  'not_run',
  'skipped',
] as const;

export type CheckStatus = (typeof CHECK_STATUSES)[number];

// ─── Error Taxonomy (FR-020) ──────────────────────────────────────────────────

export const ERROR_CATEGORIES = [
  'CONFIG_INVALID',
  'INPUT_INVALID',
  'SCHEMA_INVALID',
  'LLM_TIMEOUT',
  'LLM_RATE_LIMITED',
  'LLM_AUTH_FAILED',
  'LLM_INVALID_OUTPUT',
  'RETRIEVAL_FAILED',
  'TOOL_NOT_ALLOWED',
  'TOOL_FAILED',
  'OUTPUT_INVALID',
  'EVALUATION_FAILED',
  'BUDGET_EXCEEDED',
  'SANDBOX_UNAVAILABLE',
  'DUPLICATE_RUN',
  'CANCELLED_BY_USER',
  'RUN_TIMED_OUT',
  'INTERNAL_ERROR',
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

// ─── Safe Error ───────────────────────────────────────────────────────────────

/**
 * An application error that carries a stable category and a safe human-readable
 * message. Raw stack traces and secrets never reach end users.
 */
export class AgentForgeError extends Error {
  public readonly category: ErrorCategory;
  public readonly safeMessage: string;

  constructor(category: ErrorCategory, safeMessage: string, cause?: unknown) {
    super(safeMessage);
    this.name = 'AgentForgeError';
    this.category = category;
    this.safeMessage = safeMessage;
    if (cause) {
      this.cause = cause;
    }
  }
}

// ─── Error → Run Status mapping (Section 7.4) ────────────────────────────────

const BLOCKING_CATEGORIES: readonly ErrorCategory[] = [
  'CONFIG_INVALID',
  'LLM_AUTH_FAILED',
  'SANDBOX_UNAVAILABLE',
  'BUDGET_EXCEEDED',
];

export function errorToRunStatus(category: ErrorCategory): RunStatus {
  if (BLOCKING_CATEGORIES.includes(category)) return 'blocked';
  if (category === 'CANCELLED_BY_USER') return 'cancelled';
  if (category === 'RUN_TIMED_OUT') return 'timed_out';
  if (category === 'DUPLICATE_RUN') return 'blocked';
  return 'failed';
}

// ─── Record Result ────────────────────────────────────────────────────────────

export interface RecordResult<TOut = unknown> {
  recordId: string;
  status: CheckStatus;
  output?: TOut;
  evidenceRefs: string[];
  error?: { category: ErrorCategory; message: string };
  attempts: number;
  durationMs: number;
  modelId?: string;
  promptVersion?: string;
}

// ─── Run Event ────────────────────────────────────────────────────────────────

export interface RunEvent {
  runId: string;
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  timestamp: string; // ISO 8601
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const DEFAULTS = {
  MAX_TRANSIENT_RETRIES: 2,
  MAX_SCHEMA_CORRECTIONS: 1,
  MAX_REPAIR_ATTEMPTS: 2,
  MAX_RUN_DURATION_SECONDS: 900,
  BATCH_CONCURRENCY: 4,
  MAX_INPUT_CHARS: 20_000,
  MAX_CONTEXT_CHARS: 30_000,
  MAX_OUTPUT_BYTES: 1_000_000,
  LOG_MAX_BYTES: 200_000,
} as const;

// ─── Logging helpers ──────────────────────────────────────────────────────────

/** Patterns that indicate a secret value — used for redaction. */
const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g,
  /key-[a-zA-Z0-9]{20,}/g,
  /Bearer\s+[a-zA-Z0-9._-]+/g,
  /password\s*[:=]\s*\S+/gi,
  /secret\s*[:=]\s*\S+/gi,
];

/** Redact likely secrets from a string for safe logging. */
export function redact(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

/** Truncate a string to a safe length for logs. */
export function truncateForLog(text: string, maxBytes: number = DEFAULTS.LOG_MAX_BYTES): string {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  const truncated = Buffer.from(text).subarray(0, maxBytes).toString('utf-8');
  return truncated + `\n... [truncated, ${Buffer.byteLength(text)} bytes total]`;
}

// ─── ID generation ────────────────────────────────────────────────────────────

let counter = 0;

/** Generate a unique run ID: timestamp + counter for uniqueness. */
export function generateRunId(): string {
  const ts = Date.now().toString(36);
  const c = (counter++).toString(36).padStart(4, '0');
  const rand = Math.random().toString(36).substring(2, 6);
  return `run_${ts}_${c}_${rand}`;
}
