/**
 * @agentforge/policies — Deterministic policy layer (FR-009).
 *
 * Routing, tool allowlist, retry/abstain/escalate policy.
 * The LLM cannot raise its permissions, alter the submission contract,
 * or bypass limits. Boundary cases have unit tests.
 */

import type { ErrorCategory } from '@agentforge/shared';
import type { Config } from '@agentforge/schemas';

// ─── Tool Allowlist (FR-010) ──────────────────────────────────────────────────

export interface ToolRegistration {
  name: string;
  description: string;
  permissionLevel: 'read' | 'write' | 'execute';
  timeoutMs: number;
  enabled: boolean;
}

export class ToolAllowlist {
  private tools: Map<string, ToolRegistration> = new Map();

  register(tool: ToolRegistration): void {
    this.tools.set(tool.name, tool);
  }

  isAllowed(toolName: string): boolean {
    const tool = this.tools.get(toolName);
    return tool !== undefined && tool.enabled;
  }

  get(toolName: string): ToolRegistration | undefined {
    return this.tools.get(toolName);
  }

  listEnabled(): ToolRegistration[] {
    return [...this.tools.values()].filter((t) => t.enabled);
  }
}

// ─── Retry Policy (FR-013) ───────────────────────────────────────────────────

/** Categories that should never be retried. */
const NON_RETRYABLE: readonly ErrorCategory[] = [
  'CONFIG_INVALID',
  'LLM_AUTH_FAILED',
  'TOOL_NOT_ALLOWED',
  'INPUT_INVALID',
  'DUPLICATE_RUN',
  'CANCELLED_BY_USER',
  'BUDGET_EXCEEDED',
  'SANDBOX_UNAVAILABLE',
];

/** Categories that are transient and may be retried with backoff. */
const TRANSIENT_RETRYABLE: readonly ErrorCategory[] = [
  'LLM_TIMEOUT',
  'LLM_RATE_LIMITED',
  'TOOL_FAILED',
  'RETRIEVAL_FAILED',
];

export function isRetryable(category: ErrorCategory): boolean {
  return !NON_RETRYABLE.includes(category) && TRANSIENT_RETRYABLE.includes(category);
}

export function isNonRetryable(category: ErrorCategory): boolean {
  return NON_RETRYABLE.includes(category);
}

/**
 * Compute backoff delay with jitter for transient retries.
 * base * 2^attempt + random jitter (FR-013)
 */
export function backoffMs(attempt: number, baseMs = 1000): number {
  const exponential = baseMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseMs;
  return Math.min(exponential + jitter, 60_000); // cap at 60s
}

// ─── Retry Budget ─────────────────────────────────────────────────────────────

export interface RetryBudget {
  maxTransientRetries: number;
  maxSchemaCorrections: number;
  maxRepairAttempts: number;
}

export function retryBudgetFromConfig(config: Config): RetryBudget {
  return {
    maxTransientRetries: config.MAX_TRANSIENT_RETRIES,
    maxSchemaCorrections: config.MAX_SCHEMA_CORRECTIONS,
    maxRepairAttempts: config.MAX_REPAIR_ATTEMPTS,
  };
}

// ─── Run State Transitions (Section 7.2) ──────────────────────────────────────

import type { RunStatus } from '@agentforge/shared';
import { isTerminal } from '@agentforge/shared';

/** Valid state transitions. A terminal run cannot return to running. */
const VALID_TRANSITIONS: Record<string, RunStatus[]> = {
  queued: ['running', 'cancelled', 'blocked'],
  running: ['waiting_for_provider', 'repairing', 'cancelling', 'succeeded', 'succeeded_with_warnings', 'failed', 'blocked', 'timed_out'],
  waiting_for_provider: ['running', 'cancelling', 'failed', 'blocked', 'timed_out'],
  repairing: ['running', 'cancelling', 'succeeded', 'succeeded_with_warnings', 'failed', 'blocked', 'timed_out'],
  cancelling: ['cancelled', 'failed'],
};

export function isValidTransition(from: RunStatus, to: RunStatus): boolean {
  if (isTerminal(from)) return false; // Terminal runs cannot transition
  const allowed = VALID_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

export function assertValidTransition(from: RunStatus, to: RunStatus): void {
  if (!isValidTransition(from, to)) {
    throw new Error(
      `Invalid state transition: ${from} → ${to}`,
    );
  }
}

// ─── Abstention / Escalation Policy (FR-011) ──────────────────────────────────

export type UncertaintyAction = 'proceed' | 'abstain' | 'escalate' | 'ask';

export interface UncertaintyPolicy {
  /** What to do when no evidence is found. */
  noEvidence: UncertaintyAction;
  /** What to do for high-risk decisions. */
  highRisk: UncertaintyAction;
  /** Confidence threshold below which to trigger the policy. */
  confidenceThreshold?: number;
}

export const DEFAULT_UNCERTAINTY_POLICY: UncertaintyPolicy = {
  noEvidence: 'abstain',
  highRisk: 'escalate',
  confidenceThreshold: 0.3,
};

// ─── Output Constraints ───────────────────────────────────────────────────────

export interface OutputConstraints {
  maxOutputBytes: number;
  maxInputChars: number;
  maxContextChars: number;
}

export function outputConstraintsFromConfig(config: Config): OutputConstraints {
  return {
    maxOutputBytes: config.MAX_OUTPUT_BYTES,
    maxInputChars: config.MAX_INPUT_CHARS,
    maxContextChars: config.MAX_CONTEXT_CHARS,
  };
}
