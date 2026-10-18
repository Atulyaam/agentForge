/**
 * Unit tests for LiveHttpLLMProvider (Workstream 1)
 *
 * Verifies:
 * - Proper request serialization matching OpenAI-compatible format
 * - Correct header assembly (Authorization: Bearer <key>)
 * - Safe error handling on 401, 429, 500 without leaking credentials
 * - Accurate latency and token usage extraction
 * - Timeout enforcement via AbortController
 * - Zero live network calls during automated test runs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LiveHttpLLMProvider } from './live-provider.js';
import { AgentForgeError } from '@agentforge/shared';

describe('LiveHttpLLMProvider (Workstream 1)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('rejects initialization with empty apiKey or modelId', () => {
    expect(() => new LiveHttpLLMProvider({ apiKey: '', modelId: 'gpt-4o' })).toThrowError(
      /non-empty apiKey/,
    );
    expect(() => new LiveHttpLLMProvider({ apiKey: 'sk-123', modelId: '' })).toThrowError(
      /non-empty modelId/,
    );
  });

  it('sends structured chat completion request and extracts content and usage', async () => {
    const mockResponsePayload = {
      id: 'chatcmpl-test',
      model: 'gpt-4o-2024-05-13',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: '{"status": "ok", "message": "pong"}',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 42,
        completion_tokens: 15,
        total_tokens: 57,
      },
    };

    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any = null;

    globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
      capturedUrl = url.toString();
      capturedHeaders = init.headers;
      capturedBody = JSON.parse(init.body);

      return new Response(JSON.stringify(mockResponsePayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const provider = new LiveHttpLLMProvider({
      apiKey: 'sk-live-testkey123456789',
      modelId: 'gpt-4o',
    });

    const res = await provider.call({
      promptVersion: 'smoke_v1',
      systemPrompt: 'You are a test probe.',
      userPrompt: 'Hello server',
      temperature: 0.1,
      maxTokens: 50,
    });

    expect(capturedUrl).toBe('https://api.openai.com/v1/chat/completions');
    expect(capturedHeaders['Authorization']).toBe('Bearer sk-live-testkey123456789');
    expect(capturedHeaders['Content-Type']).toBe('application/json');
    expect(capturedBody.model).toBe('gpt-4o');
    expect(capturedBody.messages).toHaveLength(2);

    expect(res.content).toBe('{"status": "ok", "message": "pong"}');
    expect(res.modelId).toBe('gpt-4o-2024-05-13');
    expect(res.usage.inputTokens).toBe(42);
    expect(res.usage.outputTokens).toBe(15);
    expect(res.usage.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('handles 401 Unauthorized safely and redacts credentials', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify({ error: { message: 'Incorrect API key: sk-live-testkey123456789' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const provider = new LiveHttpLLMProvider({
      apiKey: 'sk-live-testkey123456789',
      modelId: 'gpt-4o',
    });

    await expect(
      provider.call({
        promptVersion: 'v1',
        systemPrompt: '',
        userPrompt: '',
      }),
    ).rejects.toThrow(AgentForgeError);

    try {
      await provider.call({
        promptVersion: 'v1',
        systemPrompt: '',
        userPrompt: '',
      });
    } catch (err: any) {
      expect(err.message).toContain('HTTP 401');
      expect(err.message).not.toContain('sk-live-testkey123456789'); // Key must be redacted
      expect(err.message).toContain('[REDACTED]');
    }
  });

  it('handles 429 Rate Limit error', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify({ error: { message: 'Quota exceeded' } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const provider = new LiveHttpLLMProvider({
      apiKey: 'sk-live-key',
      modelId: 'gpt-4o',
    });

    await expect(
      provider.call({
        promptVersion: 'v1',
        systemPrompt: '',
        userPrompt: '',
      }),
    ).rejects.toThrow(/HTTP 429/);
  });

  it('handles network timeout via AbortController and throws LLM_TIMEOUT', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    });

    const provider = new LiveHttpLLMProvider({
      apiKey: 'sk-live-key',
      modelId: 'gpt-4o',
      timeoutMs: 10,
    });

    try {
      await provider.call({
        promptVersion: 'v1',
        systemPrompt: '',
        userPrompt: '',
      });
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(AgentForgeError);
      expect(err.category).toBe('LLM_TIMEOUT');
      expect(err.message).toContain('timed out after 10ms');
    }
  });

  it('handles 500 Internal Server Error and redacts server response', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response('Internal crash on node-7: sk-live-secret-leak-999', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      });
    });

    const provider = new LiveHttpLLMProvider({
      apiKey: 'sk-live-key',
      modelId: 'gpt-4o',
    });

    try {
      await provider.call({
        promptVersion: 'v1',
        systemPrompt: '',
        userPrompt: '',
      });
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(AgentForgeError);
      expect(err.category).toBe('INTERNAL_ERROR');
      expect(err.message).toContain('HTTP 500');
      expect(err.message).not.toContain('sk-live-secret-leak-999');
      expect(err.message).toContain('[REDACTED]');
    }
  });

  it('handles malformed non-JSON response and throws LLM_INVALID_OUTPUT', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response('<html><body>502 Bad Gateway</body></html>', {
        status: 200, // Upstream proxy returning 200 with HTML error page
        headers: { 'Content-Type': 'text/html' },
      });
    });

    const provider = new LiveHttpLLMProvider({
      apiKey: 'sk-live-key',
      modelId: 'gpt-4o',
    });

    try {
      await provider.call({
        promptVersion: 'v1',
        systemPrompt: '',
        userPrompt: '',
      });
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(AgentForgeError);
      expect(err.category).toBe('LLM_INVALID_OUTPUT');
      expect(err.message).toContain('Failed to parse live provider JSON response');
    }
  });

  it('correctly normalizes baseUrl and includes customHeaders', async () => {
    let requestedUrl = '';
    let requestedHeaders: Record<string, string> = {};

    globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
      requestedUrl = url.toString();
      requestedHeaders = init.headers;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'test response' } }],
          model: 'custom-model',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const provider = new LiveHttpLLMProvider({
      apiKey: 'sk-custom-key',
      modelId: 'custom-model',
      baseUrl: 'https://openrouter.ai/api/v1/', // trailing slash
      customHeaders: {
        'HTTP-Referer': 'https://agentforge.dev',
        'X-Title': 'AgentForge-Kickoff',
      },
    });

    const res = await provider.call({
      promptVersion: 'v1',
      systemPrompt: 'System',
      userPrompt: 'User',
    });

    expect(requestedUrl).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(requestedHeaders['HTTP-Referer']).toBe('https://agentforge.dev');
    expect(requestedHeaders['X-Title']).toBe('AgentForge-Kickoff');
    expect(res.content).toBe('test response');
  });

  it('handles empty choices array without runtime exceptions', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const provider = new LiveHttpLLMProvider({
      apiKey: 'sk-custom-key',
      modelId: 'custom-model',
    });

    const res = await provider.call({
      promptVersion: 'v1',
      systemPrompt: '',
      userPrompt: '',
    });

    expect(res.content).toBe('');
    expect(res.modelId).toBe('custom-model');
  });
});
