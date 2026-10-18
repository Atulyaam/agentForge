/**
 * Real-Model Calibration Engine (Workstream 2)
 *
 * Implements bounded, opt-in operational calibration against existing adapters
 * (Customer Support Triage and Policy RAG with Abstention).
 *
 * Key Guarantees:
 * - Requires explicit --live flag; offline/CI runs report PENDING.
 * - Enforces control-plane BudgetGuard (default 3 calls per adapter).
 * - Never includes ground truth labels in prompts, context, or tool arguments.
 * - Evaluates outputs independently against separately stored expected outcomes.
 * - Computes only defensible metrics: exact-match/correctness, schema validity,
 *   justified abstentions, citation precision/recall, latency, and provider token usage.
 * - Missing token counts or costs are marked 'unavailable' (never guessed).
 * - Clearly discloses that small-sample calibration is not a statistical benchmark.
 * - Saves reports to docs/calibration-report.md and runs/calibration/ without
 *   overwriting canonical drill reports.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { AgentForgeError, redact } from '@agentforge/shared';
import { LiveHttpLLMProvider, LLMAdapter } from '@agentforge/llm';
import { ConfigSchema, type Config } from '@agentforge/schemas';
import {
  TriageAdapter,
  RagAdapter,
  type TriageInput,
  type TriageOutput,
  type RagInput,
  type RagOutput,
  type AdapterDeps,
} from '@agentforge/adapter-kit';
import { isPlaceholderKey } from './provider-smoke.js';

export interface CalibrationOptions {
  live?: boolean;
  sampleSize?: number; // Default 3
  maxCalls?: number;   // Default 3 per adapter
  adapterId?: 'all' | 'support-triage' | 'policy-rag';
  rootDir?: string;
  env?: Record<string, string | undefined>;
  customProvider?: any; // For unit testing without network
}

export interface AdapterCalibrationMetric {
  adapterId: string;
  sampleCount: number;
  schemaValidityRate: number; // 0.0 - 1.0
  accuracy: number | 'unavailable';
  avgLatencyMs: number;
  totalTokens: {
    input: number | 'unavailable';
    output: number | 'unavailable';
  };
  additionalMetrics: Record<string, number | 'unavailable'>;
  recordOutcomes: Array<{
    id: string;
    status: 'passed' | 'failed';
    latencyMs: number;
    error?: string;
  }>;
}

export interface CalibrationRunResult {
  status: 'COMPLETED' | 'PENDING' | 'FAILED';
  live: boolean;
  modelId: string;
  sampleSize: number;
  adaptersEvaluated: string[];
  metrics: Record<string, AdapterCalibrationMetric>;
  totalLatencyMs: number;
  reportPath?: string;
  markdownReportPath?: string;
  message: string;
  remediation?: string;
}

/**
 * Execute bounded real-model calibration.
 */
export async function runModelCalibration(
  options: CalibrationOptions = {},
): Promise<CalibrationRunResult> {
  const rootDir = options.rootDir ?? process.cwd();
  const env = options.env ?? process.env;
  const live = options.live === true;
  const sampleSize = options.sampleSize ?? 3;
  const selectedAdapter = options.adapterId ?? 'all';

  const rawKey = env.LLM_API_KEY;
  const rawModel = env.LLM_MODEL ?? 'gpt-4o-mini';

  // 1. Gated Opt-In: Live calls require explicit --live flag
  if (!live) {
    return {
      status: 'PENDING',
      live: false,
      modelId: rawModel,
      sampleSize,
      adaptersEvaluated: [],
      metrics: {},
      totalLatencyMs: 0,
      message:
        'Real-model calibration is PENDING: requires explicit opt-in via --live flag to protect quota.',
      remediation:
        'Run: pnpm agentforge calibrate --live --sample 3 --max-calls 3',
    };
  }

  // 2. Credential Verification
  if (isPlaceholderKey(rawKey)) {
    return {
      status: 'PENDING',
      live: true,
      modelId: rawModel,
      sampleSize,
      adaptersEvaluated: [],
      metrics: {},
      totalLatencyMs: 0,
      message:
        'Real-model calibration is PENDING: LLM_API_KEY is not configured or is a mock placeholder.',
      remediation:
        'Set valid LLM_API_KEY and LLM_MODEL in .env, then rerun with --live.',
    };
  }

  // Target adapters to calibrate
  const runTriage = selectedAdapter === 'all' || selectedAdapter === 'support-triage';
  const runRag = selectedAdapter === 'all' || selectedAdapter === 'policy-rag';

  const maxCallsPerAdapter = options.maxCalls ?? sampleSize;
  const totalBudgetCap = (runTriage ? maxCallsPerAdapter : 0) + (runRag ? maxCallsPerAdapter : 0);

  // 3. Configure Safe LLM Adapter with control-plane BudgetGuard
  const config: Config = ConfigSchema.parse({
    ...env,
    LLM_API_KEY: rawKey,
    LLM_MODEL: rawModel,
    MAX_TRANSIENT_RETRIES: 0,
    MAX_SCHEMA_CORRECTIONS: 1, // Allow 1 schema correction if needed
    MAX_LLM_CALLS_PER_RUN: totalBudgetCap,
  });

  const provider =
    options.customProvider ??
    new LiveHttpLLMProvider({
      apiKey: rawKey!,
      modelId: rawModel,
      timeoutMs: 30000,
    });

  const llm = new LLMAdapter(provider, config);

  const deps: AdapterDeps = {
    llm,
    config,
    log: () => {},
  };

  const metricsMap: Record<string, AdapterCalibrationMetric> = {};
  const adaptersEvaluated: string[] = [];
  const startGlobal = Date.now();

  // ─── 4. Calibrate Triage Adapter (Appendix A.1) ───────────────────────────
  if (runTriage) {
    adaptersEvaluated.push('support-triage');
    const triage = TriageAdapter;

    const inputPath = fs.existsSync(path.join(rootDir, 'fixtures', 'drill-1-triage', 'tickets.json'))
      ? path.join(rootDir, 'fixtures', 'drill-1-triage', 'tickets.json')
      : path.join(rootDir, 'fixtures', 'drill-1-triage', 'tickets-input.json');
    const expectedPath = path.join(rootDir, 'fixtures', 'drill-1-triage', 'tickets-expected.json');

    const rawInput = fs.readFileSync(inputPath, 'utf8');
    const parsed = triage.parseInput(rawInput);
    const calibrationInputs = parsed.records.slice(0, sampleSize);

    const outputs: TriageOutput[] = [];
    const outcomes: Array<{ id: string; status: 'passed' | 'failed'; latencyMs: number; error?: string }> = [];
    let schemaSuccesses = 0;

    for (const rec of calibrationInputs) {
      const recStart = Date.now();
      try {
        const norm = triage.normalize(rec);
        const ctx = await triage.buildContext(norm, deps);
        const decision = await triage.decide(norm, ctx, deps);
        const out = triage.toOutput(norm, decision);
        outputs.push(out);
        schemaSuccesses++;
        outcomes.push({
          id: rec.id,
          status: 'passed',
          latencyMs: Date.now() - recStart,
        });
      } catch (err: any) {
        outcomes.push({
          id: rec.id,
          status: 'failed',
          latencyMs: Date.now() - recStart,
          error: redact(err.message ?? String(err)),
        });
      }
    }

    // Evaluate against separately stored ground truth
    let evaluatedAccuracy: number | 'unavailable' = 'unavailable';
    let additional: Record<string, number | 'unavailable'> = {};

    if (fs.existsSync(expectedPath) && triage.evaluate) {
      try {
        const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
        const evalResults = await triage.evaluate(outputs, expected);
        evaluatedAccuracy = evalResults.overallAccuracy ?? evalResults.categoryAccuracy ?? 'unavailable';
        additional = evalResults;
      } catch {}
    }

    const triageLatencies = outcomes.map((o) => o.latencyMs);
    const avgLatency = triageLatencies.length > 0
      ? Math.round(triageLatencies.reduce((a, b) => a + b, 0) / triageLatencies.length)
      : 0;

    // Aggregate tokens
    const recentLedger = llm.usageLedger;
    const hasInputTokens = recentLedger.some((r) => r.inputTokens !== undefined);
    const hasOutputTokens = recentLedger.some((r) => r.outputTokens !== undefined);

    metricsMap['support-triage'] = {
      adapterId: 'support-triage',
      sampleCount: calibrationInputs.length,
      schemaValidityRate: calibrationInputs.length > 0 ? schemaSuccesses / calibrationInputs.length : 1,
      accuracy: evaluatedAccuracy,
      avgLatencyMs: avgLatency,
      totalTokens: {
        input: hasInputTokens
          ? recentLedger.reduce((sum, r) => sum + (r.inputTokens ?? 0), 0)
          : 'unavailable',
        output: hasOutputTokens
          ? recentLedger.reduce((sum, r) => sum + (r.outputTokens ?? 0), 0)
          : 'unavailable',
      },
      additionalMetrics: additional,
      recordOutcomes: outcomes,
    };
  }

  // ─── 5. Calibrate RAG Adapter (Appendix A.2) ──────────────────────────────
  if (runRag) {
    adaptersEvaluated.push('policy-rag');
    const rag = RagAdapter;

    const inputPath = fs.existsSync(path.join(rootDir, 'fixtures', 'drill-2-rag', 'questions.json'))
      ? path.join(rootDir, 'fixtures', 'drill-2-rag', 'questions.json')
      : path.join(rootDir, 'fixtures', 'drill-2-rag', 'questions-input.json');
    const expectedPath = fs.existsSync(path.join(rootDir, 'fixtures', 'drill-2-rag', 'questions-expected.json'))
      ? path.join(rootDir, 'fixtures', 'drill-2-rag', 'questions-expected.json')
      : path.join(rootDir, 'fixtures', 'drill-2-rag', 'expected-answers.json');

    const rawInput = fs.readFileSync(inputPath, 'utf8');
    const parsed = rag.parseInput(rawInput);
    const calibrationInputs = parsed.records.slice(0, sampleSize);

    const outputs: RagOutput[] = [];
    const outcomes: Array<{ id: string; status: 'passed' | 'failed'; latencyMs: number; error?: string }> = [];
    let schemaSuccesses = 0;

    const ledgerOffset = llm.usageLedger.length;

    for (const rec of calibrationInputs) {
      const recStart = Date.now();
      try {
        const norm = rag.normalize(rec);
        const ctx = await rag.buildContext(norm, deps);
        const decision = await rag.decide(norm, ctx, deps);
        const out = rag.toOutput(norm, decision);
        outputs.push(out);
        schemaSuccesses++;
        outcomes.push({
          id: rec.id,
          status: 'passed',
          latencyMs: Date.now() - recStart,
        });
      } catch (err: any) {
        outcomes.push({
          id: rec.id,
          status: 'failed',
          latencyMs: Date.now() - recStart,
          error: redact(err.message ?? String(err)),
        });
      }
    }

    let evaluatedAccuracy: number | 'unavailable' = 'unavailable';
    let additional: Record<string, number | 'unavailable'> = {};

    if (fs.existsSync(expectedPath) && rag.evaluate) {
      try {
        const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
        const evalResults = await rag.evaluate(outputs, expected);
        evaluatedAccuracy = evalResults.decisionAccuracy ?? 'unavailable';
        additional = evalResults;
      } catch {}
    }

    const ragLatencies = outcomes.map((o) => o.latencyMs);
    const avgLatency = ragLatencies.length > 0
      ? Math.round(ragLatencies.reduce((a, b) => a + b, 0) / ragLatencies.length)
      : 0;

    const ragLedger = llm.usageLedger.slice(ledgerOffset);
    const hasInputTokens = ragLedger.some((r) => r.inputTokens !== undefined);
    const hasOutputTokens = ragLedger.some((r) => r.outputTokens !== undefined);

    metricsMap['policy-rag'] = {
      adapterId: 'policy-rag',
      sampleCount: calibrationInputs.length,
      schemaValidityRate: calibrationInputs.length > 0 ? schemaSuccesses / calibrationInputs.length : 1,
      accuracy: evaluatedAccuracy,
      avgLatencyMs: avgLatency,
      totalTokens: {
        input: hasInputTokens
          ? ragLedger.reduce((sum, r) => sum + (r.inputTokens ?? 0), 0)
          : 'unavailable',
        output: hasOutputTokens
          ? ragLedger.reduce((sum, r) => sum + (r.outputTokens ?? 0), 0)
          : 'unavailable',
      },
      additionalMetrics: additional,
      recordOutcomes: outcomes,
    };
  }

  const totalElapsed = Date.now() - startGlobal;

  // ─── 6. Build Calibration Reports ──────────────────────────────────────────
  const calDir = path.join(rootDir, 'runs', 'calibration');
  if (!fs.existsSync(calDir)) fs.mkdirSync(calDir, { recursive: true });

  const jsonReportPath = path.join(calDir, 'calibration-report.json');
  const markdownReportPath = path.join(rootDir, 'docs', 'calibration-report.md');

  const reportPayload: CalibrationRunResult = {
    status: 'COMPLETED',
    live: true,
    modelId: rawModel,
    sampleSize,
    adaptersEvaluated,
    metrics: metricsMap,
    totalLatencyMs: totalElapsed,
    reportPath: jsonReportPath,
    markdownReportPath,
    message: `Real-model calibration completed across ${adaptersEvaluated.length} adapter(s) using model "${rawModel}".`,
  };

  fs.writeFileSync(jsonReportPath, JSON.stringify(reportPayload, null, 2), 'utf8');

  // Render Markdown report
  const mdContent = renderCalibrationMarkdownReport(reportPayload);
  fs.writeFileSync(markdownReportPath, mdContent, 'utf8');

  return reportPayload;
}

/**
 * Format markdown calibration report with transparent scientific disclaimers.
 */
function renderCalibrationMarkdownReport(report: CalibrationRunResult): string {
  const timestamp = new Date().toISOString();
  const lines: string[] = [
    '# AgentForge — Real-Model Calibration Report (Workstream 2)',
    '',
    `> **Generated:** \`${timestamp}\`  `,
    `> **Model Identifier:** \`${report.modelId}\`  `,
    `> **Sample Size:** \`${report.sampleSize} records per adapter\`  `,
    `> **Execution Mode:** \`LIVE OPT-IN CALIBRATION\`  `,
    '',
    '---',
    '',
    '## ⚠️ Statistical Boundary Disclosure',
    '',
    '> **Important Notice:** The results below represent an operational sanity check and calibration probe across a compact sample. They verify prompt rendering, Zod schema validation, error handling, and latency against a real frontier provider. **They do not constitute a statistically conclusive benchmark or open-domain generalization claim.** No prompts, policies, or adapters were automatically tuned or rewritten based on this small sample.',
    '',
    '---',
    '',
    '## 1. Measured Defensible Metrics',
    '',
    '| Adapter ID | Sample Count | Schema Validity | Accuracy | Avg Latency | Input Tokens | Output Tokens |',
    '|---|---|---|---|---|---|---|',
  ];

  for (const [adapterId, m] of Object.entries(report.metrics)) {
    const schemaPct = `${(m.schemaValidityRate * 100).toFixed(1)}%`;
    const accPct = typeof m.accuracy === 'number' ? `${(m.accuracy * 100).toFixed(1)}%` : m.accuracy;
    const latStr = `${m.avgLatencyMs}ms`;
    const inTokens = m.totalTokens.input;
    const outTokens = m.totalTokens.output;
    lines.push(
      `| \`${adapterId}\` | ${m.sampleCount} | ${schemaPct} | ${accPct} | ${latStr} | ${inTokens} | ${outTokens} |`,
    );
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 2. Per-Adapter Detailed Calibration');
  lines.push('');

  for (const [adapterId, m] of Object.entries(report.metrics)) {
    lines.push(`### Adapter: \`${adapterId}\``);
    lines.push('');
    lines.push('**Additional Metrics:**');
    for (const [k, v] of Object.entries(m.additionalMetrics)) {
      const vStr = typeof v === 'number' ? (v <= 1 ? `${(v * 100).toFixed(1)}%` : v) : v;
      lines.push(`- **${k}:** \`${vStr}\``);
    }
    lines.push('');
    lines.push('**Record Outcomes:**');
    lines.push('| Record ID | Status | Latency | Error Details |');
    lines.push('|---|---|---|---|');
    for (const rec of m.recordOutcomes) {
      const errStr = rec.error ? `\`${rec.error.slice(0, 80)}\`` : 'None';
      lines.push(`| \`${rec.id}\` | \`${rec.status}\` | ${rec.latencyMs}ms | ${errStr} |`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## 3. Operational Observations & Verification');
  lines.push('');
  lines.push('- **Canonical Mock Drills Intact:** Drill 1 and Drill 2 canonical mock reports (`docs/drill-1-report.md`, `docs/drill-2-report.md`) remain untouched.');
  lines.push('- **Zero Secret Leakage:** Provider API keys, authorization headers, and credential strings are strictly redacted from logs and reports.');
  lines.push('- **Control-Plane Call Budget:** Hard BudgetGuard limits were strictly enforced in TypeScript control plane.');
  lines.push('');

  return lines.join('\n');
}
