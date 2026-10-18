/**
 * @agentforge/llm — Live HTTP LLM Provider
 *
 * Implements standard LLMProvider interface over HTTP using native fetch (Node 20+).
 * - Zero third-party SDK dependencies (FR-007, NFR-003)
 * - Safe credential handling: API key is never logged, printed, or exposed in errors
 * - OpenAI-compatible chat completions protocol (/v1/chat/completions)
 * - Explicit timeout via AbortController
 * - Accurate usage (token counts, latency) extraction from provider metadata
 */

import { AgentForgeError, redact } from '@agentforge/shared';
import type { LLMCallOptions, LLMProvider, LLMResponse } from './index.js';

export interface LiveHttpLLMProviderOptions {
  apiKey: string;
  modelId: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export class LiveHttpLLMProvider implements LLMProvider {
  public readonly modelId: string;
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(options: LiveHttpLLMProviderOptions) {
    if (!options.apiKey || options.apiKey.trim().length === 0) {
      throw new AgentForgeError(
        'CONFIG_INVALID',
        'LiveHttpLLMProvider requires a non-empty apiKey.',
      );
    }
    if (!options.modelId || options.modelId.trim().length === 0) {
      throw new AgentForgeError(
        'CONFIG_INVALID',
        'LiveHttpLLMProvider requires a non-empty modelId.',
      );
    }

    this.apiKey = options.apiKey;
    this.modelId = options.modelId;
    this.timeoutMs = options.timeoutMs ?? 30000;

    const base = options.baseUrl ?? 'https://api.openai.com/v1';
    // Normalize endpoint to chat completions
    this.endpoint = base.endsWith('/chat/completions')
      ? base
      : `${base.replace(/\/+$/, '')}/chat/completions`;
  }

  async call(options: LLMCallOptions): Promise<LLMResponse> {
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const body = {
      model: this.modelId,
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: options.userPrompt },
      ],
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 1024,
    };

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err: any) {
      clearTimeout(timer);
      const isAbort = err.name === 'AbortError' || controller.signal.aborted;
      const safeMsg = isAbort
        ? `Live LLM request timed out after ${this.timeoutMs}ms`
        : `Live LLM network request failed: ${redact(err.message ?? String(err))}`;
      throw new AgentForgeError('INTERNAL_ERROR', safeMsg);
    } finally {
      clearTimeout(timer);
    }

    const latencyMs = Date.now() - start;

    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch {}
      const safeBody = redact(errorBody.slice(0, 300));

      if (response.status === 401 || response.status === 403) {
        throw new AgentForgeError(
          'LLM_AUTH_FAILED',
          `Live provider authentication failed (HTTP ${response.status}). Verify LLM_API_KEY. Details: ${safeBody}`,
        );
      }
      if (response.status === 429) {
        throw new AgentForgeError(
          'LLM_RATE_LIMITED',
          `Live provider rate limit or quota exceeded (HTTP 429). Details: ${safeBody}`,
        );
      }
      throw new AgentForgeError(
        'INTERNAL_ERROR',
        `Live provider request failed (HTTP ${response.status}). Details: ${safeBody}`,
      );
    }

    let json: any;
    try {
      json = await response.json();
    } catch (parseErr: any) {
      throw new AgentForgeError(
        'LLM_INVALID_OUTPUT',
        `Failed to parse live provider JSON response: ${parseErr.message}`,
      );
    }

    const choice = json.choices?.[0];
    const content = choice?.message?.content ?? '';

    const inputTokens = typeof json.usage?.prompt_tokens === 'number'
      ? json.usage.prompt_tokens
      : undefined;
    const outputTokens = typeof json.usage?.completion_tokens === 'number'
      ? json.usage.completion_tokens
      : undefined;

    return {
      content,
      modelId: json.model ?? this.modelId,
      promptVersion: options.promptVersion,
      usage: {
        inputTokens,
        outputTokens,
        latencyMs,
      },
      cached: false,
    };
  }
}
