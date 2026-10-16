/**
 * Unit tests for @agentforge/llm
 *
 * Tests: budget guard (FR-034), structured output (FR-008),
 * mock provider, schema correction loop.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  BudgetGuard,
  MockLLMProvider,
  LLMAdapter,
} from './index.js';
import { AgentForgeError } from '@agentforge/shared';
import { ConfigSchema } from '@agentforge/schemas';

const makeConfig = (overrides = {}) =>
  ConfigSchema.parse({
    LLM_API_KEY: 'test-key',
    LLM_MODEL: 'test-model',
    ...overrides,
  });

describe('BudgetGuard (FR-034)', () => {
  it('allows calls within budget', () => {
    const guard = new BudgetGuard(5);
    expect(() => guard.check()).not.toThrow();
  });

  it('throws BUDGET_EXCEEDED when limit reached', () => {
    const guard = new BudgetGuard(2);
    guard.record({ modelId: 'test', promptVersion: 'v1', content: '', usage: { latencyMs: 10 }, cached: false });
    guard.record({ modelId: 'test', promptVersion: 'v1', content: '', usage: { latencyMs: 10 }, cached: false });

    expect(() => guard.check()).toThrow(AgentForgeError);
    try {
      guard.check();
    } catch (error: any) {
      expect(error.category).toBe('BUDGET_EXCEEDED');
    }
  });

  it('records usage in ledger', () => {
    const guard = new BudgetGuard();
    guard.record({
      modelId: 'gpt-4',
      promptVersion: 'v1',
      content: 'test',
      usage: { inputTokens: 100, outputTokens: 50, latencyMs: 200 },
      cached: false,
    });
    expect(guard.usageLedger).toHaveLength(1);
    expect(guard.usageLedger[0].modelId).toBe('gpt-4');
    expect(guard.usageLedger[0].inputTokens).toBe(100);
  });

  it('unlimited budget when no max is set', () => {
    const guard = new BudgetGuard();
    for (let i = 0; i < 100; i++) {
      expect(() => guard.check()).not.toThrow();
      guard.record({ modelId: 'test', promptVersion: 'v1', content: '', usage: { latencyMs: 1 }, cached: false });
    }
  });
});

describe('MockLLMProvider', () => {
  it('returns default response', async () => {
    const provider = new MockLLMProvider('{"result": "hello"}');
    const response = await provider.call({
      promptVersion: 'v1',
      systemPrompt: 'You are helpful.',
      userPrompt: 'Say hello',
    });

    expect(response.content).toBe('{"result": "hello"}');
    expect(response.modelId).toBe('mock-model');
    expect(response.usage.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns prompt-specific response', async () => {
    const provider = new MockLLMProvider();
    provider.setResponse('special', '{"special": true}');

    const response = await provider.call({
      promptVersion: 'special',
      systemPrompt: '',
      userPrompt: '',
    });

    expect(response.content).toBe('{"special": true}');
  });
});

describe('LLMAdapter', () => {
  it('callStructured parses valid JSON', async () => {
    const schema = z.object({
      sentiment: z.enum(['positive', 'negative', 'neutral']),
      confidence: z.number(),
    });

    const provider = new MockLLMProvider(
      JSON.stringify({ sentiment: 'positive', confidence: 0.9 }),
    );
    const adapter = new LLMAdapter(provider, makeConfig());

    const result = await adapter.callStructured({
      schema,
      schemaName: 'TestSchema',
      promptVersion: 'v1',
      systemPrompt: 'test',
      userPrompt: 'test',
    });

    expect(result.data.sentiment).toBe('positive');
    expect(result.data.confidence).toBe(0.9);
  });

  it('callStructured handles JSON in markdown code blocks', async () => {
    const schema = z.object({ value: z.string() });
    const provider = new MockLLMProvider(
      '```json\n{"value": "extracted"}\n```',
    );
    const adapter = new LLMAdapter(provider, makeConfig());

    const result = await adapter.callStructured({
      schema,
      schemaName: 'Test',
      promptVersion: 'v1',
      systemPrompt: '',
      userPrompt: '',
    });

    expect(result.data.value).toBe('extracted');
  });

  it('callStructured throws LLM_INVALID_OUTPUT after failed corrections', async () => {
    const schema = z.object({ value: z.number() });
    const provider = new MockLLMProvider('not valid json');
    const adapter = new LLMAdapter(provider, makeConfig({ MAX_SCHEMA_CORRECTIONS: '1' }));

    await expect(
      adapter.callStructured({
        schema,
        schemaName: 'Test',
        promptVersion: 'v1',
        systemPrompt: '',
        userPrompt: '',
      }),
    ).rejects.toThrow(AgentForgeError);
  });

  it('respects budget guard', async () => {
    const provider = new MockLLMProvider('{}');
    const adapter = new LLMAdapter(provider, makeConfig({ MAX_LLM_CALLS_PER_RUN: '2' }));

    await adapter.call({ promptVersion: 'v1', systemPrompt: '', userPrompt: '' });
    await adapter.call({ promptVersion: 'v1', systemPrompt: '', userPrompt: '' });

    await expect(
      adapter.call({ promptVersion: 'v1', systemPrompt: '', userPrompt: '' }),
    ).rejects.toThrow(AgentForgeError);

    expect(adapter.callCount).toBe(2);
  });

  it('tracks usage ledger', async () => {
    const provider = new MockLLMProvider('{}');
    const adapter = new LLMAdapter(provider, makeConfig());

    await adapter.call({ promptVersion: 'v1', systemPrompt: '', userPrompt: '' });

    expect(adapter.usageLedger).toHaveLength(1);
    expect(adapter.usageLedger[0].promptVersion).toBe('v1');
  });
});
