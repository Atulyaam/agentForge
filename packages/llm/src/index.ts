/**
 * @agentforge/llm — Provider adapter for LLM calls.
 *
 * - One permitted provider behind this adapter (FR-007)
 * - Structured output generation with Zod validation (FR-008)
 * - Schema correction up to MAX_SCHEMA_CORRECTIONS (FR-008)
 * - Keys never reach browser or sandbox (NFR-003)
 * - Prompt versions recorded per call (FR-007)
 * - Usage extraction from provider metadata (FR-034)
 */

import type { z } from 'zod';
import { AgentForgeError } from '@agentforge/shared';
import type { Config } from '@agentforge/schemas';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LLMCallOptions {
  promptVersion: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMResponse {
  content: string;
  modelId: string;
  promptVersion: string;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    latencyMs: number;
  };
  cached: boolean;
}

export interface StructuredLLMOptions<T> extends LLMCallOptions {
  schema: z.ZodType<T>;
  schemaName: string;
}

export interface LLMUsageRecord {
  modelId: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  cached: boolean;
  promptVersion: string;
  timestamp: string;
}

// ─── Provider Interface ───────────────────────────────────────────────────────

export interface LLMProvider {
  call(options: LLMCallOptions): Promise<LLMResponse>;
}

// ─── Budget Guard (FR-034) ────────────────────────────────────────────────────

export class BudgetGuard {
  private callCount = 0;
  private readonly maxCalls: number | undefined;
  public readonly usageLedger: LLMUsageRecord[] = [];

  constructor(maxCalls?: number) {
    this.maxCalls = maxCalls;
  }

  check(): void {
    if (this.maxCalls !== undefined && this.callCount >= this.maxCalls) {
      throw new AgentForgeError(
        'BUDGET_EXCEEDED',
        `LLM call budget exhausted: ${this.callCount}/${this.maxCalls} calls used`,
      );
    }
  }

  record(response: LLMResponse): void {
    this.callCount++;
    this.usageLedger.push({
      modelId: response.modelId,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      latencyMs: response.usage.latencyMs,
      cached: response.cached,
      promptVersion: response.promptVersion,
      timestamp: new Date().toISOString(),
    });
  }

  get count(): number {
    return this.callCount;
  }
}

// ─── Mock Provider (for testing and DemoAdapter) ──────────────────────────────

export type MockResponseHandler = string | ((options: LLMCallOptions) => string);

export class MockLLMProvider implements LLMProvider {
  private responses: Map<string, MockResponseHandler> = new Map();
  private defaultResponse: MockResponseHandler;

  constructor(defaultResponse: MockResponseHandler = '{"result": "mock"}') {
    this.defaultResponse = defaultResponse;
  }

  setResponse(promptVersion: string, response: MockResponseHandler): void {
    this.responses.set(promptVersion, response);
  }

  setDefaultResponse(response: MockResponseHandler): void {
    this.defaultResponse = response;
  }

  async call(options: LLMCallOptions): Promise<LLMResponse> {
    const start = Date.now();
    const handler = this.responses.get(options.promptVersion) ?? this.defaultResponse;
    let content: string;
    if (typeof handler === 'function') {
      try {
        content = (handler as any)(options.userPrompt);
      } catch (err) {
        if (err instanceof AgentForgeError) throw err;
        content = (handler as any)(options);
      }
    } else {
      content = handler;
    }
    return {
      content,
      modelId: 'mock-model',
      promptVersion: options.promptVersion,
      usage: {
        inputTokens: options.systemPrompt.length + options.userPrompt.length,
        outputTokens: content.length,
        latencyMs: Date.now() - start,
      },
      cached: false,
    };
  }
}

// ─── LLM Adapter ──────────────────────────────────────────────────────────────

export class LLMAdapter {
  private readonly provider: LLMProvider;
  private readonly budget: BudgetGuard;
  private readonly config: Config;

  constructor(provider: LLMProvider, config: Config) {
    this.provider = provider;
    this.config = config;
    this.budget = new BudgetGuard(config.MAX_LLM_CALLS_PER_RUN);
  }

  /** Raw LLM call with budget guard. */
  async call(options: LLMCallOptions): Promise<LLMResponse> {
    this.budget.check();
    try {
      const response = await this.provider.call(options);
      this.budget.record(response);
      return response;
    } catch (error) {
      if (error instanceof AgentForgeError) throw error;
      throw new AgentForgeError(
        'INTERNAL_ERROR',
        'LLM call failed unexpectedly',
        error,
      );
    }
  }

  /**
   * Structured output: call LLM, parse and validate with Zod.
   * On validation failure, attempt up to MAX_SCHEMA_CORRECTIONS correction calls.
   * After that, throws LLM_INVALID_OUTPUT. (FR-008)
   */
  async callStructured<T>(options: StructuredLLMOptions<T>): Promise<{ data: T; response: LLMResponse }> {
    const maxCorrections = this.config.MAX_SCHEMA_CORRECTIONS;

    let lastResponse = await this.call(options);
    let lastError: string | undefined;

    // First parse attempt
    const firstResult = this.tryParse(lastResponse.content, options.schema);
    if (firstResult.ok) {
      return { data: firstResult.data, response: lastResponse };
    }
    lastError = firstResult.error;

    // Schema correction attempts
    for (let attempt = 0; attempt < maxCorrections; attempt++) {
      const correctionPrompt = [
        options.userPrompt,
        `\nYour previous response was invalid JSON or did not match the required schema "${options.schemaName}".`,
        `Validation error: ${lastError}`,
        `Please fix your response to match the exact schema.`,
      ].join('\n');

      lastResponse = await this.call({
        ...options,
        userPrompt: correctionPrompt,
        promptVersion: `${options.promptVersion}_correction_${attempt + 1}`,
      });

      const retryResult = this.tryParse(lastResponse.content, options.schema);
      if (retryResult.ok) {
        return { data: retryResult.data, response: lastResponse };
      }
      lastError = retryResult.error;
    }

    throw new AgentForgeError(
      'LLM_INVALID_OUTPUT',
      `LLM output failed schema validation after ${maxCorrections} correction(s): ${lastError}`,
    );
  }

  private tryParse<T>(
    content: string,
    schema: z.ZodType<T>,
  ): { ok: true; data: T } | { ok: false; error: string } {
    try {
      // Try to extract JSON from the response
      let jsonStr = content.trim();
      // Handle markdown code blocks
      const jsonMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }
      const parsed = JSON.parse(jsonStr);
      const validated = schema.parse(parsed);
      return { ok: true, data: validated };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { ok: false, error: msg };
    }
  }

  get usageLedger(): LLMUsageRecord[] {
    return this.budget.usageLedger;
  }

  get callCount(): number {
    return this.budget.count;
  }
}

// ─── Live Provider Adapter (Workstream 1) ─────────────────────────────────────

export * from './live-provider.js';
