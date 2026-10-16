/**
 * Unit tests for @agentforge/policies
 *
 * Tests: retry policy (FR-013), state transitions (Section 7.2),
 * tool allowlist (FR-010), backoff calculation.
 */

import { describe, it, expect } from 'vitest';
import {
  isRetryable,
  isNonRetryable,
  backoffMs,
  isValidTransition,
  assertValidTransition,
  ToolAllowlist,
  retryBudgetFromConfig,
  DEFAULT_UNCERTAINTY_POLICY,
} from './index.js';

describe('Retry Policy (FR-013)', () => {
  it('non-retryable errors are never retried', () => {
    expect(isNonRetryable('CONFIG_INVALID')).toBe(true);
    expect(isNonRetryable('LLM_AUTH_FAILED')).toBe(true);
    expect(isNonRetryable('TOOL_NOT_ALLOWED')).toBe(true);
    expect(isNonRetryable('INPUT_INVALID')).toBe(true);
    expect(isNonRetryable('DUPLICATE_RUN')).toBe(true);
    expect(isNonRetryable('CANCELLED_BY_USER')).toBe(true);
    expect(isNonRetryable('BUDGET_EXCEEDED')).toBe(true);
    expect(isNonRetryable('SANDBOX_UNAVAILABLE')).toBe(true);
  });

  it('transient errors are retryable', () => {
    expect(isRetryable('LLM_TIMEOUT')).toBe(true);
    expect(isRetryable('LLM_RATE_LIMITED')).toBe(true);
    expect(isRetryable('TOOL_FAILED')).toBe(true);
    expect(isRetryable('RETRIEVAL_FAILED')).toBe(true);
  });

  it('non-retryable errors are not retryable', () => {
    expect(isRetryable('CONFIG_INVALID')).toBe(false);
    expect(isRetryable('LLM_AUTH_FAILED')).toBe(false);
  });
});

describe('backoffMs', () => {
  it('increases with attempt number', () => {
    const b0 = backoffMs(0, 100);
    const b1 = backoffMs(1, 100);
    const b2 = backoffMs(2, 100);
    // Exponential growth (with jitter, so check minimums)
    expect(b0).toBeGreaterThanOrEqual(100);
    expect(b1).toBeGreaterThanOrEqual(200);
    expect(b2).toBeGreaterThanOrEqual(400);
  });

  it('is capped at 60 seconds', () => {
    const b = backoffMs(20, 1000);
    expect(b).toBeLessThanOrEqual(60000);
  });
});

describe('State Transitions (Section 7.2)', () => {
  it('allows valid transitions', () => {
    expect(isValidTransition('queued', 'running')).toBe(true);
    expect(isValidTransition('running', 'succeeded')).toBe(true);
    expect(isValidTransition('running', 'failed')).toBe(true);
    expect(isValidTransition('running', 'waiting_for_provider')).toBe(true);
    expect(isValidTransition('running', 'cancelling')).toBe(true);
    expect(isValidTransition('cancelling', 'cancelled')).toBe(true);
  });

  it('rejects transitions from terminal states', () => {
    expect(isValidTransition('succeeded', 'running')).toBe(false);
    expect(isValidTransition('failed', 'running')).toBe(false);
    expect(isValidTransition('blocked', 'running')).toBe(false);
    expect(isValidTransition('cancelled', 'running')).toBe(false);
    expect(isValidTransition('timed_out', 'running')).toBe(false);
  });

  it('assertValidTransition throws on invalid transition', () => {
    expect(() => assertValidTransition('succeeded', 'running')).toThrow();
  });

  it('assertValidTransition does not throw on valid transition', () => {
    expect(() => assertValidTransition('queued', 'running')).not.toThrow();
  });
});

describe('ToolAllowlist (FR-010)', () => {
  it('allows registered tools', () => {
    const allowlist = new ToolAllowlist();
    allowlist.register({
      name: 'search',
      description: 'Search the web',
      permissionLevel: 'read',
      timeoutMs: 5000,
      enabled: true,
    });

    expect(allowlist.isAllowed('search')).toBe(true);
    expect(allowlist.isAllowed('unknown')).toBe(false);
  });

  it('rejects disabled tools', () => {
    const allowlist = new ToolAllowlist();
    allowlist.register({
      name: 'dangerous',
      description: 'Dangerous tool',
      permissionLevel: 'execute',
      timeoutMs: 5000,
      enabled: false,
    });

    expect(allowlist.isAllowed('dangerous')).toBe(false);
  });

  it('lists only enabled tools', () => {
    const allowlist = new ToolAllowlist();
    allowlist.register({ name: 'a', description: '', permissionLevel: 'read', timeoutMs: 1000, enabled: true });
    allowlist.register({ name: 'b', description: '', permissionLevel: 'read', timeoutMs: 1000, enabled: false });

    const enabled = allowlist.listEnabled();
    expect(enabled).toHaveLength(1);
    expect(enabled[0].name).toBe('a');
  });
});

describe('Retry Budget', () => {
  it('derives from config', () => {
    const budget = retryBudgetFromConfig({
      MAX_TRANSIENT_RETRIES: 3,
      MAX_SCHEMA_CORRECTIONS: 2,
      MAX_REPAIR_ATTEMPTS: 1,
    } as any);

    expect(budget.maxTransientRetries).toBe(3);
    expect(budget.maxSchemaCorrections).toBe(2);
    expect(budget.maxRepairAttempts).toBe(1);
  });
});

describe('Uncertainty Policy (FR-011)', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_UNCERTAINTY_POLICY.noEvidence).toBe('abstain');
    expect(DEFAULT_UNCERTAINTY_POLICY.highRisk).toBe('escalate');
    expect(DEFAULT_UNCERTAINTY_POLICY.confidenceThreshold).toBe(0.3);
  });
});
