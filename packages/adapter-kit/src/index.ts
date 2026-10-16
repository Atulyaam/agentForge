/**
 * @agentforge/adapter-kit — ChallengeAdapter interface + contract validators.
 *
 * All task-specific behaviour is a single ChallengeAdapter implementation (FR-028).
 * The core never imports domain code; swapping the adapter requires no core edits.
 */

import type { LLMAdapter } from '@agentforge/llm';
import type { Config } from '@agentforge/schemas';

// ─── Adapter Dependencies (injected, never constructed by the adapter) ───────

export interface AdapterDeps {
  llm: LLMAdapter;
  config: Config;
  log: (event: string, payload?: Record<string, unknown>) => void;
}

// ─── Parse Result ─────────────────────────────────────────────────────────────

export interface ParseResult<TIn> {
  records: TIn[];
  batchErrors: string[];
  recordErrors: Array<{ id?: string; row?: number; message: string }>;
}

// ─── Validation Result ────────────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean;
  problems: string[];
}

// ─── Challenge Adapter Interface (Appendix B) ─────────────────────────────────

export interface ChallengeAdapter<TIn = unknown, TCtx = unknown, TDecision = unknown, TOut = unknown> {
  /** Stable adapter identifier. */
  readonly id: string;
  /** Adapter version string. */
  readonly version: string;

  /**
   * Parse raw input into typed records.
   * Malformed records are reported with record IDs or row numbers. (FR-002)
   * Records are never silently changed, dropped, or reordered.
   */
  parseInput(raw: string | Buffer): ParseResult<TIn>;

  /** Extract the stable record ID. */
  recordId(rec: TIn): string;

  /**
   * Normalize into a stable internal representation.
   * Missing, empty, duplicate, and malformed values have explicit behaviour. (FR-003)
   */
  normalize(rec: TIn): TIn;

  /**
   * Build bounded context from the current input and permitted reference material. (FR-005)
   */
  buildContext(rec: TIn, deps: AdapterDeps): Promise<TCtx>;

  /**
   * Produce the decision/result using an LLM and/or deterministic algorithm. (FR-007)
   * May call LLM only via deps.llm.
   */
  decide(rec: TIn, ctx: TCtx, deps: AdapterDeps): Promise<TDecision>;

  /**
   * Transform the decision into the required output format. (FR-004)
   */
  toOutput(rec: TIn, decision: TDecision): TOut;

  /**
   * Validate the complete output set against the contract. (FR-004)
   * Invalid output is blocked from final submission with a clear validation error.
   */
  validateOutput(outputs: TOut[], inputs: TIn[]): ValidationResult;

  /**
   * Write the validated output to disk. (FR-015)
   * Core wraps this in atomic write + revalidation.
   */
  writeOutput(outputs: TOut[], path: string): Promise<void>;

  /**
   * Optional: evaluate outputs against expected results. (FR-016)
   * Metrics are computed from actual outputs; uncomputable metrics are 'unavailable'.
   */
  evaluate?(outputs: TOut[], expected: unknown): Promise<Record<string, number | 'unavailable'>>;
}

// ─── Contract Validators ──────────────────────────────────────────────────────

/**
 * Verify that outputs match inputs: same count, all IDs present, no duplicates.
 */
export function validateOutputContract<TIn, TOut>(
  adapter: ChallengeAdapter<TIn, unknown, unknown, TOut>,
  inputs: TIn[],
  outputs: TOut[],
): ValidationResult {
  const problems: string[] = [];

  // Count check
  if (outputs.length !== inputs.length) {
    problems.push(`Output count ${outputs.length} ≠ input count ${inputs.length}`);
  }

  // ID correspondence
  const inputIds = new Set(inputs.map((r) => adapter.recordId(r)));
  // (Output IDs would need an outputId method — for now, rely on adapter.validateOutput)

  // Duplicates in inputs
  if (inputIds.size !== inputs.length) {
    problems.push(`Duplicate input IDs detected (${inputs.length} records, ${inputIds.size} unique IDs)`);
  }

  // Delegate to adapter-specific validation
  const adapterResult = adapter.validateOutput(outputs, inputs);
  problems.push(...adapterResult.problems);

  return {
    ok: problems.length === 0,
    problems,
  };
}

// ─── Adapter Registry ─────────────────────────────────────────────────────────

const adapterRegistry = new Map<string, ChallengeAdapter>();

export function registerAdapter(adapter: ChallengeAdapter): void {
  adapterRegistry.set(adapter.id, adapter);
}

export function getAdapter(id: string): ChallengeAdapter | undefined {
  return adapterRegistry.get(id);
}

export function listAdapters(): string[] {
  return [...adapterRegistry.keys()];
}

// ─── Challenge Adapters (S6 Mock Drills) ───────────────────────────────────────
export * from './triage-adapter.js';
export * from './rag-adapter.js';

