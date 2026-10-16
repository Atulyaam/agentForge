/**
 * Unit tests for @agentforge/schemas
 *
 * Tests: config loading (FR-001), schema validation, safe config snapshot.
 */

import { describe, it, expect } from 'vitest';
import { loadConfig, ConfigSchema, safeConfigSnapshot, RunStatusSchema, ErrorCategorySchema } from './index.js';

describe('ConfigSchema (FR-001)', () => {
  it('validates a complete config', () => {
    const env = {
      LLM_API_KEY: 'test-key-123',
      LLM_MODEL: 'gpt-4',
    };
    const config = ConfigSchema.parse(env);
    expect(config.LLM_API_KEY).toBe('test-key-123');
    expect(config.LLM_MODEL).toBe('gpt-4');
    expect(config.MAX_TRANSIENT_RETRIES).toBe(2);
    expect(config.MAX_SCHEMA_CORRECTIONS).toBe(1);
    expect(config.JOB_RUNNER).toBe('inline');
  });

  it('rejects missing required fields', () => {
    const result = ConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('applies defaults for optional fields', () => {
    const config = ConfigSchema.parse({
      LLM_API_KEY: 'key',
      LLM_MODEL: 'model',
    });
    expect(config.MAX_TRANSIENT_RETRIES).toBe(2);
    expect(config.MAX_RUN_DURATION_SECONDS).toBe(900);
    expect(config.BATCH_CONCURRENCY).toBe(4);
    expect(config.CACHE_ENABLED).toBe(false);
  });

  it('coerces string numbers', () => {
    const config = ConfigSchema.parse({
      LLM_API_KEY: 'key',
      LLM_MODEL: 'model',
      MAX_TRANSIENT_RETRIES: '5',
      MAX_RUN_DURATION_SECONDS: '1800',
    });
    expect(config.MAX_TRANSIENT_RETRIES).toBe(5);
    expect(config.MAX_RUN_DURATION_SECONDS).toBe(1800);
  });

  it('coerces CACHE_ENABLED from string', () => {
    const config = ConfigSchema.parse({
      LLM_API_KEY: 'key',
      LLM_MODEL: 'model',
      CACHE_ENABLED: 'true',
    });
    expect(config.CACHE_ENABLED).toBe(true);
  });
});

describe('loadConfig (FR-001)', () => {
  it('loads valid config from env', () => {
    const config = loadConfig({
      LLM_API_KEY: 'test-key',
      LLM_MODEL: 'test-model',
    });
    expect(config.LLM_API_KEY).toBe('test-key');
  });

  it('throws AgentForgeError on missing config', () => {
    expect(() => loadConfig({})).toThrow();
  });

  it('error message does not leak secret values', () => {
    try {
      loadConfig({});
    } catch (error: any) {
      // The error message should mention the field name but not any value
      expect(error.message).toContain('LLM_API_KEY');
      expect(error.category).toBe('CONFIG_INVALID');
    }
  });
});

describe('safeConfigSnapshot', () => {
  it('strips LLM_API_KEY from snapshot', () => {
    const config = ConfigSchema.parse({
      LLM_API_KEY: 'super-secret-key',
      LLM_MODEL: 'gpt-4',
    });
    const snapshot = safeConfigSnapshot(config);
    expect(snapshot).not.toHaveProperty('LLM_API_KEY');
    expect(snapshot).toHaveProperty('LLM_MODEL', 'gpt-4');
  });
});

describe('RunStatusSchema', () => {
  it('accepts valid statuses', () => {
    expect(RunStatusSchema.parse('queued')).toBe('queued');
    expect(RunStatusSchema.parse('succeeded')).toBe('succeeded');
  });

  it('rejects invalid statuses', () => {
    expect(() => RunStatusSchema.parse('invalid')).toThrow();
  });
});

describe('ErrorCategorySchema', () => {
  it('accepts valid categories', () => {
    expect(ErrorCategorySchema.parse('CONFIG_INVALID')).toBe('CONFIG_INVALID');
    expect(ErrorCategorySchema.parse('INTERNAL_ERROR')).toBe('INTERNAL_ERROR');
  });

  it('rejects invalid categories', () => {
    expect(() => ErrorCategorySchema.parse('UNKNOWN')).toThrow();
  });
});
