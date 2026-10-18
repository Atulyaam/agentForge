/**
 * Live Provider Smoke Test Engine (Workstream 1)
 *
 * Implements safe, opt-in verification of live LLM provider connectivity.
 * - Requires explicit --live flag; default execution is strictly offline.
 * - Defaults to exactly 1 model request, with zero automatic retries.
 * - Enforces control-plane BudgetGuard(1) and timeouts.
 * - Uses a minimal synthetic probe with structured Zod schema validation.
 * - Returns PENDING with actionable remediation when credentials or --live flag are absent.
 * - Strictly redacts secrets and never exposes authorization headers in reports.
 * - Saves run artifact to runs/smoke/smoke-report.json without side-effects.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { AgentForgeError, redact } from '@agentforge/shared';
import { LiveHttpLLMProvider, LLMAdapter } from '@agentforge/llm';
import { ConfigSchema, type Config } from '@agentforge/schemas';

// ─── Synthetic Smoke Probe Schema ─────────────────────────────────────────────

export const SmokeProbeSchema = z.object({
  status: z.literal('ok'),
  engine: z.string().min(1),
  timestamp: z.string().min(1),
});

export type SmokeProbeResponse = z.infer<typeof SmokeProbeSchema>;

export interface ProviderSmokeOptions {
  live?: boolean;
  maxCalls?: number;
  timeoutMs?: number;
  rootDir?: string;
  env?: Record<string, string | undefined>;
  customProvider?: any; // For deterministic unit testing
}

export interface ProviderSmokeResult {
  status: 'PASSED' | 'FAILED' | 'PENDING';
  live: boolean;
  modelId: string;
  configValid: boolean;
  latencyMs?: number;
  schemaValid?: boolean;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  output?: SmokeProbeResponse;
  error?: string;
  message: string;
  remediation?: string;
  reportPath?: string;
}

/** Check whether a configured API key represents a mock/placeholder rather than real credentials */
export function isPlaceholderKey(key?: string): boolean {
  if (!key) return true;
  const k = key.trim().toLowerCase();
  return (
    k.length === 0 ||
    k === 'mock-key' ||
    k === 'test-key' ||
    k === 'dummy' ||
    k === 'placeholder' ||
    k.startsWith('mock')
  );
}

/**
 * Execute the live provider smoke test probe.
 */
export async function runProviderSmokeTest(
  options: ProviderSmokeOptions = {},
): Promise<ProviderSmokeResult> {
  const rootDir = options.rootDir ?? process.cwd();
  const env = options.env ?? process.env;
  const live = options.live === true;
  const maxCalls = options.maxCalls ?? 1;

  const rawKey = env.LLM_API_KEY;
  const rawModel = env.LLM_MODEL ?? 'gpt-4o-mini';

  // 1. Gated Opt-In Check: live calls strictly require --live
  if (!live) {
    return {
      status: 'PENDING',
      live: false,
      modelId: rawModel,
      configValid: !isPlaceholderKey(rawKey),
      message:
        'Live provider test is PENDING: requires explicit opt-in via --live flag to protect token quota and prevent automated provider requests.',
      remediation:
        'Run: pnpm agentforge provider-smoke --live --max-calls 1',
    };
  }

  // 2. Credential Verification Check: ensure live key is actually present
  if (isPlaceholderKey(rawKey)) {
    return {
      status: 'PENDING',
      live: true,
      modelId: rawModel,
      configValid: false,
      message:
        'Live provider test is PENDING: valid LLM_API_KEY is not configured in environment or .env file.',
      remediation:
        'Set valid LLM_API_KEY and LLM_MODEL in .env, then rerun with --live.',
    };
  }

  // 3. Prepare Safe Config with zero retries and strict call budget of 1
  const effectiveConfig: Config = ConfigSchema.parse({
    ...env,
    LLM_API_KEY: rawKey,
    LLM_MODEL: rawModel,
    MAX_TRANSIENT_RETRIES: 0,
    MAX_SCHEMA_CORRECTIONS: 0,
    MAX_LLM_CALLS_PER_RUN: Math.max(1, maxCalls),
  });

  const provider =
    options.customProvider ??
    new LiveHttpLLMProvider({
      apiKey: rawKey!,
      modelId: rawModel,
      timeoutMs: options.timeoutMs ?? 15000,
    });

  const adapter = new LLMAdapter(provider, effectiveConfig);

  const systemPrompt =
    'You are an automated system verification probe. Return valid JSON only with exact keys: "status" (must be "ok"), "engine" (string identifier), "timestamp" (ISO string). Do not wrap in markdown or explanation.';
  const userPrompt = 'Run probe test now. Output JSON only.';

  const start = Date.now();
  let smokeResult: ProviderSmokeResult;

  try {
    const { data, response } = await adapter.callStructured({
      schema: SmokeProbeSchema,
      schemaName: 'SmokeProbeSchema',
      promptVersion: 'provider_smoke_v1',
      systemPrompt,
      userPrompt,
      temperature: 0,
      maxTokens: 100,
    });

    const elapsed = Date.now() - start;

    smokeResult = {
      status: 'PASSED',
      live: true,
      modelId: response.modelId,
      configValid: true,
      latencyMs: response.usage.latencyMs ?? elapsed,
      schemaValid: true,
      usage: {
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
      },
      output: data,
      message: `Live provider verification successful for model "${response.modelId}" (${response.usage.latencyMs ?? elapsed}ms).`,
    };
  } catch (err: any) {
    const elapsed = Date.now() - start;
    const safeError = redact(err.message ?? String(err));
    smokeResult = {
      status: 'FAILED',
      live: true,
      modelId: rawModel,
      configValid: true,
      latencyMs: elapsed,
      schemaValid: false,
      error: safeError,
      message: `Live provider smoke test failed: ${safeError}`,
      remediation:
        'Verify model availability, provider status, API key permissions, and network connectivity.',
    };
  }

  // 4. Save Artifact to runs/smoke/smoke-report.json
  try {
    const smokeDir = path.join(rootDir, 'runs', 'smoke');
    if (!fs.existsSync(smokeDir)) {
      fs.mkdirSync(smokeDir, { recursive: true });
    }
    const reportPath = path.join(smokeDir, 'smoke-report.json');
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          ...smokeResult,
          // Redacted diagnostics guarantee
          envRedacted: {
            LLM_MODEL: rawModel,
            LLM_API_KEY: '[CONFIGURED - REDACTED]',
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    smokeResult.reportPath = reportPath;
  } catch {}

  return smokeResult;
}
