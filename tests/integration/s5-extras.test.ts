/**
 * S5 Integration Tests — P1 Extras
 *
 * FR-035: Deterministic baseline comparator
 * FR-036: Failure clustering report
 * FR-037: Sample / dry-run mode
 * FR-038: Bounded concurrency pool
 * FR-039: Interview pack scaffold
 * FR-040: Run diff
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  classifySentimentHeuristic,
  runBaselineComparator,
  compareAgentWithBaseline,
  renderBaselineMarkdownTable,
  clusterFailuresByFeatures,
  renderFailureAnalysisMarkdown,
  compareRuns,
  renderRunDiffMarkdown,
  generateInterviewPackMarkdown,
  writeInterviewPack,
} from '@agentforge/evaluation';
import { executeRun } from '@agentforge/orchestrator';
import { MockLLMProvider, LLMAdapter } from '@agentforge/llm';
import { loadConfig } from '@agentforge/schemas';
import { DemoAdapter } from '../../apps/cli/src/demo-adapter.js';

describe('FR-035 — Deterministic Baseline Comparator', () => {
  it('classifies sentiments correctly with heuristic rules', () => {
    expect(classifySentimentHeuristic('This is a great, wonderful and fantastic product!').sentiment).toBe('positive');
    expect(classifySentimentHeuristic('This is a terrible, horrible and bad experience.').sentiment).toBe('negative');
    expect(classifySentimentHeuristic('The shipment arrives on Tuesday.').sentiment).toBe('neutral');
  });

  it('runs baseline comparator over inputs and computes accuracy against ground truth', () => {
    const inputs = [
      { id: '1', text: 'This is great!' },
      { id: '2', text: 'This is terrible!' },
      { id: '3', text: 'Meeting is at 10am.' },
    ];
    const expected = [
      { id: '1', sentiment: 'positive' },
      { id: '2', sentiment: 'negative' },
      { id: '3', sentiment: 'neutral' },
    ];

    const result = runBaselineComparator(inputs, expected);
    expect(result.outputs).toHaveLength(3);
    expect(result.metrics.total).toBe(3);
    expect(result.metrics.accuracy).toBe(1.0);
    expect(result.metrics.durationMs).toBeGreaterThan(0);
  });

  it('computes comparative metrics and lift between agent and baseline', () => {
    const agentMetrics = {
      total: 10,
      succeeded: 10,
      failed: 0,
      accuracy: 0.9,
      durationMs: 400,
    };
    const baselineMetrics = {
      total: 10,
      succeeded: 10,
      failed: 0,
      accuracy: 0.7,
      durationMs: 50,
    };

    const comparison = compareAgentWithBaseline(agentMetrics, baselineMetrics);
    expect(comparison.lift.accuracyLift).toBeCloseTo(0.2, 5);
    expect(comparison.lift.latencyDiffMs).toBe(350);

    const md = renderBaselineMarkdownTable(comparison);
    expect(md).toContain('Baseline vs Agent Comparison');
    expect(md).toContain('+20.0%');
  });
});

describe('FR-036 — Failure Clustering Report', () => {
  it('groups failures by category and input length feature bucket', () => {
    const failures = [
      {
        recordId: 'rec-001',
        category: 'SCHEMA_INVALID' as const,
        message: 'Invalid json',
        inputLength: 30, // short
      },
      {
        recordId: 'rec-002',
        category: 'SCHEMA_INVALID' as const,
        message: 'Invalid enum',
        inputLength: 45, // short
      },
      {
        recordId: 'rec-003',
        category: 'LLM_TIMEOUT' as const,
        message: 'Call timed out',
        inputLength: 250, // long
      },
    ];

    const clusters = clusterFailuresByFeatures(failures, 10);
    expect(clusters.length).toBe(2);

    const topCluster = clusters[0];
    expect(topCluster.category).toBe('SCHEMA_INVALID');
    expect(topCluster.lengthBucket).toBe('short (<50 chars)');
    expect(topCluster.count).toBe(2);
    expect(topCluster.exampleIds).toEqual(['rec-001', 'rec-002']);

    const markdown = renderFailureAnalysisMarkdown(clusters, 3, 10);
    expect(markdown).toContain('Failure Analysis and Clustering Report');
    expect(markdown).toContain('`SCHEMA_INVALID`');
    expect(markdown).toContain('`LLM_TIMEOUT`');
  });
});

describe('FR-037 & FR-038 — Orchestrator Concurrency, Sample, and Dry-Run', () => {
  const testDir = path.join(process.cwd(), 'runs', 'test-s5-orchestrator');
  const inputPath = path.join(process.cwd(), 'fixtures', 'demo.json');
  const outputPath = path.join(testDir, 'output.json');

  const config = loadConfig({
    ...process.env,
    LLM_API_KEY: 'test-key',
    LLM_MODEL: 'test-model',
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('runs in dry-run mode without invoking LLM (FR-037)', async () => {
    const mockProvider = new MockLLMProvider(
      JSON.stringify({ sentiment: 'positive', confidence: 0.9, reasoning: 'ok' }),
    );
    const llm = new LLMAdapter(mockProvider, config);

    const ctx = await executeRun({
      adapter: DemoAdapter,
      llm,
      config,
      inputPath,
      outputPath,
      runId: 'test-s5-orchestrator',
      dryRun: true,
    });

    expect(ctx.status).toBe('succeeded');
    expect(ctx.mode).toBe('DRY_RUN');
    expect(llm.callCount).toBe(0); // 0 LLM calls in dry-run!
    expect(ctx.results.length).toBe(5);
  });

  it('runs with sample parameter processing only N records (FR-037)', async () => {
    const mockProvider = new MockLLMProvider(
      JSON.stringify({ sentiment: 'positive', confidence: 0.9, reasoning: 'ok' }),
    );
    const llm = new LLMAdapter(mockProvider, config);

    const ctx = await executeRun({
      adapter: DemoAdapter,
      llm,
      config,
      inputPath,
      outputPath,
      runId: 'test-s5-orchestrator',
      sample: 2,
    });

    expect(ctx.status).toBe('succeeded');
    expect(ctx.mode).toBe('SAMPLE');
    expect(ctx.results.length).toBe(2);
    expect(llm.callCount).toBe(2);
  });

  it('runs with bounded concurrency pool preserving input order (FR-038)', async () => {
    const mockProvider = new MockLLMProvider(
      JSON.stringify({ sentiment: 'positive', confidence: 0.85, reasoning: 'ok' }),
    );
    const llm = new LLMAdapter(mockProvider, config);

    const ctx = await executeRun({
      adapter: DemoAdapter,
      llm,
      config,
      inputPath,
      outputPath,
      runId: 'test-s5-orchestrator',
      concurrency: 3,
    });

    expect(ctx.status).toBe('succeeded');
    expect(ctx.results.length).toBe(5);

    // Verify ordering matches input exactly
    const rawInput = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
    for (let i = 0; i < rawInput.length; i++) {
      expect(ctx.results[i].recordId).toBe(rawInput[i].id);
    }
  });
});

describe('FR-039 — Interview Pack Scaffold', () => {
  it('generates markdown with all 10 mandatory questions, script, and architecture', () => {
    const md = generateInterviewPackMarkdown();
    expect(md).toContain('# AgentForge — AI Judge Interview Pack');
    expect(md).toContain('Five-Minute Interview Demo Script');
    expect(md).toContain('Q1: What exact problem does the agent solve');
    expect(md).toContain('Q10: Which code was AI-assisted');
    expect(md).toContain('Top Three Limitations');
    expect(md).toContain('Which alternatives were rejected and why?');
  });

  it('writes interview pack file to docs/interview-pack.md', () => {
    const targetFile = path.join(process.cwd(), 'docs', 'test-interview-pack.md');
    writeInterviewPack({ outputPath: targetFile });
    expect(fs.existsSync(targetFile)).toBe(true);
    const content = fs.readFileSync(targetFile, 'utf-8');
    expect(content).toContain('Ten Mandatory Interview Answers');
    fs.unlinkSync(targetFile);
  });
});

describe('FR-040 — Run Diff Comparator', () => {
  const dirA = path.join(process.cwd(), 'runs', 'test-diff-a');
  const dirB = path.join(process.cwd(), 'runs', 'test-diff-b');

  beforeEach(() => {
    fs.mkdirSync(dirA, { recursive: true });
    fs.mkdirSync(dirB, { recursive: true });

    // Run A
    fs.writeFileSync(
      path.join(dirA, 'run.json'),
      JSON.stringify({
        id: 'test-diff-a',
        status: 'succeeded',
        codeVersion: 'v1.0.0',
        createdAt: '2026-10-16T12:00:00Z',
      }),
    );
    fs.writeFileSync(
      path.join(dirA, 'output.json'),
      JSON.stringify([
        { id: '1', sentiment: 'positive', confidence: 0.9 },
        { id: '2', sentiment: 'negative', confidence: 0.8 },
      ]),
    );
    fs.writeFileSync(
      path.join(dirA, 'metrics.json'),
      JSON.stringify({ accuracy: 1.0, durationMs: 200 }),
    );

    // Run B
    fs.writeFileSync(
      path.join(dirB, 'run.json'),
      JSON.stringify({
        id: 'test-diff-b',
        status: 'succeeded',
        codeVersion: 'v1.0.1',
        createdAt: '2026-10-16T12:30:00Z',
      }),
    );
    fs.writeFileSync(
      path.join(dirB, 'output.json'),
      JSON.stringify([
        { id: '1', sentiment: 'positive', confidence: 0.9 },
        { id: '2', sentiment: 'neutral', confidence: 0.5 }, // changed sentiment
        { id: '3', sentiment: 'positive', confidence: 0.95 }, // added record
      ]),
    );
    fs.writeFileSync(
      path.join(dirB, 'metrics.json'),
      JSON.stringify({ accuracy: 0.8, durationMs: 150 }),
    );
  });

  afterEach(() => {
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  });

  it('identifies changed records, additions, and metric deltas', () => {
    const diff = compareRuns(dirA, dirB);
    expect(diff.runIdA).toBe('test-diff-a');
    expect(diff.runIdB).toBe('test-diff-b');
    expect(diff.changedOutputs.length).toBe(1);
    expect(diff.changedOutputs[0].id).toBe('2');
    expect(diff.added.length).toBe(1);
    expect(diff.added[0].id).toBe('3');

    const accDelta = diff.metricDeltas.find((m) => m.metric === 'accuracy');
    expect(accDelta?.delta).toBe(-0.2);

    const md = renderRunDiffMarkdown(diff);
    expect(md).toContain('Run Diff: `test-diff-a` ➔ `test-diff-b`');
    expect(md).toContain('Sentiment shifted');
  });
});
