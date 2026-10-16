/**
 * Unit tests for @agentforge/shared
 *
 * Tests: error taxonomy (FR-020), run status (Section 7.1),
 * error → status mapping (Section 7.4), redaction, ID generation.
 */

import { describe, it, expect } from 'vitest';
import {
  RUN_STATUSES,
  TERMINAL_STATUSES,
  ERROR_CATEGORIES,
  CHECK_STATUSES,
  isTerminal,
  errorToRunStatus,
  AgentForgeError,
  redact,
  truncateForLog,
  generateRunId,
} from './index.js';

describe('RunStatus', () => {
  it('has exactly 11 states per Section 7.1', () => {
    expect(RUN_STATUSES).toHaveLength(11);
  });

  it('terminal statuses are a subset of all statuses', () => {
    for (const ts of TERMINAL_STATUSES) {
      expect(RUN_STATUSES).toContain(ts);
    }
  });

  it('isTerminal returns true for terminal statuses', () => {
    expect(isTerminal('succeeded')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('blocked')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('timed_out')).toBe(true);
  });

  it('isTerminal returns false for non-terminal statuses', () => {
    expect(isTerminal('queued')).toBe(false);
    expect(isTerminal('running')).toBe(false);
    expect(isTerminal('waiting_for_provider')).toBe(false);
    expect(isTerminal('repairing')).toBe(false);
    expect(isTerminal('cancelling')).toBe(false);
  });
});

describe('ErrorCategory (FR-020)', () => {
  it('has exactly 18 categories', () => {
    expect(ERROR_CATEGORIES).toHaveLength(18);
  });

  it('every handled failure maps to exactly one category', () => {
    const unique = new Set(ERROR_CATEGORIES);
    expect(unique.size).toBe(ERROR_CATEGORIES.length);
  });
});

describe('errorToRunStatus (Section 7.4)', () => {
  it('blocking errors → blocked', () => {
    expect(errorToRunStatus('CONFIG_INVALID')).toBe('blocked');
    expect(errorToRunStatus('LLM_AUTH_FAILED')).toBe('blocked');
    expect(errorToRunStatus('SANDBOX_UNAVAILABLE')).toBe('blocked');
    expect(errorToRunStatus('BUDGET_EXCEEDED')).toBe('blocked');
  });

  it('cancellation → cancelled', () => {
    expect(errorToRunStatus('CANCELLED_BY_USER')).toBe('cancelled');
  });

  it('timeout → timed_out', () => {
    expect(errorToRunStatus('RUN_TIMED_OUT')).toBe('timed_out');
  });

  it('other errors → failed', () => {
    expect(errorToRunStatus('INPUT_INVALID')).toBe('failed');
    expect(errorToRunStatus('SCHEMA_INVALID')).toBe('failed');
    expect(errorToRunStatus('LLM_INVALID_OUTPUT')).toBe('failed');
    expect(errorToRunStatus('INTERNAL_ERROR')).toBe('failed');
  });
});

describe('AgentForgeError', () => {
  it('carries category and safe message', () => {
    const err = new AgentForgeError('CONFIG_INVALID', 'Missing LLM_API_KEY');
    expect(err.category).toBe('CONFIG_INVALID');
    expect(err.safeMessage).toBe('Missing LLM_API_KEY');
    expect(err.message).toBe('Missing LLM_API_KEY');
    expect(err.name).toBe('AgentForgeError');
  });

  it('preserves cause', () => {
    const cause = new Error('original');
    const err = new AgentForgeError('INTERNAL_ERROR', 'Something failed', cause);
    expect(err.cause).toBe(cause);
  });
});

describe('redact', () => {
  it('redacts API keys', () => {
    const text = 'Error with key sk-abc12345678901234567890';
    expect(redact(text)).toContain('[REDACTED]');
    expect(redact(text)).not.toContain('sk-abc');
  });

  it('redacts Bearer tokens', () => {
    const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test.sig';
    expect(redact(text)).toContain('[REDACTED]');
    expect(redact(text)).not.toContain('eyJ');
  });

  it('does not modify clean text', () => {
    const text = 'This is a normal log message';
    expect(redact(text)).toBe(text);
  });
});

describe('truncateForLog', () => {
  it('does not truncate short strings', () => {
    const text = 'short';
    expect(truncateForLog(text, 100)).toBe(text);
  });

  it('truncates long strings and adds indicator', () => {
    const text = 'x'.repeat(1000);
    const result = truncateForLog(text, 100);
    expect(result.length).toBeLessThan(1000);
    expect(result).toContain('[truncated');
  });
});

describe('generateRunId', () => {
  it('generates unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateRunId());
    }
    expect(ids.size).toBe(100);
  });

  it('starts with run_ prefix', () => {
    expect(generateRunId()).toMatch(/^run_/);
  });
});

describe('CheckStatus', () => {
  it('has exactly 6 values', () => {
    expect(CHECK_STATUSES).toHaveLength(6);
  });

  it('includes all required values', () => {
    expect(CHECK_STATUSES).toContain('passed');
    expect(CHECK_STATUSES).toContain('failed');
    expect(CHECK_STATUSES).toContain('blocked');
    expect(CHECK_STATUSES).toContain('timed_out');
    expect(CHECK_STATUSES).toContain('not_run');
    expect(CHECK_STATUSES).toContain('skipped');
  });
});
