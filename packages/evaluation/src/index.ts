/**
 * @agentforge/evaluation — Metrics, fixtures, failure categorization.
 *
 * FR-016: Evaluation harness
 * FR-017: Failure analysis and iteration
 * FR-030: Run report generator
 * FR-036: Failure clustering report
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  ErrorCategory,
  RecordResult,
  RunEvent,
} from '@agentforge/shared';
import type { RunRecord, StageExecution, Report } from '@agentforge/schemas';

// ─── Failure Category Counter ─────────────────────────────────────────────────

export function countByErrorCategory(
  results: RecordResult[],
): Partial<Record<ErrorCategory, number>> {
  const counts: Partial<Record<ErrorCategory, number>> = {};
  for (const r of results) {
    if (r.error) {
      counts[r.error.category] = (counts[r.error.category] ?? 0) + 1;
    }
  }
  return counts;
}

// ─── Failure Clustering (FR-036) ──────────────────────────────────────────────

export interface FailureCluster {
  category: ErrorCategory;
  count: number;
  exampleIds: string[];
}

export function clusterFailures(results: RecordResult[], maxExamples = 3): FailureCluster[] {
  const clusters = new Map<ErrorCategory, string[]>();
  for (const r of results) {
    if (r.error) {
      const ids = clusters.get(r.error.category) ?? [];
      ids.push(r.recordId);
      clusters.set(r.error.category, ids);
    }
  }

  return [...clusters.entries()]
    .map(([category, ids]) => ({
      category,
      count: ids.length,
      exampleIds: ids.slice(0, maxExamples),
    }))
    .sort((a, b) => b.count - a.count);
}

// ─── Report Generator (FR-030) ────────────────────────────────────────────────

export interface ReportInput {
  runRecord: RunRecord;
  results: RecordResult[];
  stages: StageExecution[];
  events: RunEvent[];
}

export function generateReport(input: ReportInput): Report {
  const { runRecord, results, stages } = input;

  const counts = {
    total: results.length,
    succeeded: results.filter((r) => r.status === 'passed').length,
    failed: results.filter((r) => r.status === 'failed').length,
    blocked: results.filter((r) => r.status === 'blocked').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    notRun: results.filter((r) => r.status === 'not_run').length,
  };

  const errorCategories = countByErrorCategory(results) as Record<ErrorCategory, number>;

  const topFailures = results
    .filter((r) => r.error)
    .slice(0, 10)
    .map((r) => ({
      recordId: r.recordId,
      errorCategory: r.error!.category,
      message: r.error!.message,
    }));

  const stagesSummary = stages.map((s) => ({
    stage: s.stage,
    durationMs: s.durationMs ?? 0,
    status: s.status,
  }));

  return {
    runId: runRecord.id,
    status: runRecord.status,
    inputHash: runRecord.inputHash,
    codeVersion: runRecord.codeVersion,
    configSnapshot: runRecord.configSnapshot,
    counts,
    stages: stagesSummary,
    errorCategories,
    metrics: runRecord.metrics ?? {},
    topFailures,
    limitations: [],
    notRunChecks: [],
  };
}

// ─── Report Markdown Renderer ─────────────────────────────────────────────────

export function renderReportMarkdown(report: Report): string {
  const lines: string[] = [
    `# Run Report: ${report.runId}`,
    '',
    `**Status:** ${report.status}`,
    `**Input Hash:** ${report.inputHash}`,
    `**Code Version:** ${report.codeVersion}`,
    '',
    '## Counts',
    '',
    `| Metric | Value |`,
    `|---|---|`,
    `| Total | ${report.counts.total} |`,
    `| Succeeded | ${report.counts.succeeded} |`,
    `| Failed | ${report.counts.failed} |`,
    `| Blocked | ${report.counts.blocked} |`,
    `| Skipped | ${report.counts.skipped} |`,
    `| Not Run | ${report.counts.notRun} |`,
    '',
  ];

  if (report.topFailures.length > 0) {
    lines.push('## Top Failures', '');
    lines.push('| Record | Category | Message |');
    lines.push('|---|---|---|');
    for (const f of report.topFailures) {
      lines.push(`| ${f.recordId} | ${f.errorCategory} | ${f.message} |`);
    }
    lines.push('');
  }

  if (report.stages.length > 0) {
    lines.push('## Stages', '');
    lines.push('| Stage | Duration (ms) | Status |');
    lines.push('|---|---|---|');
    for (const s of report.stages) {
      lines.push(`| ${s.stage} | ${s.durationMs} | ${s.status} |`);
    }
    lines.push('');
  }

  if (Object.keys(report.metrics).length > 0) {
    lines.push('## Metrics', '');
    lines.push('| Metric | Value |');
    lines.push('|---|---|');
    for (const [k, v] of Object.entries(report.metrics)) {
      lines.push(`| ${k} | ${v} |`);
    }
    lines.push('');
  }

  if (report.limitations.length > 0) {
    lines.push('## Limitations', '');
    for (const l of report.limitations) {
      lines.push(`- ${l}`);
    }
    lines.push('');
  }

  if (report.notRunChecks.length > 0) {
    lines.push('## Checks Not Run', '');
    lines.push('| Check | Reason |');
    lines.push('|---|---|');
    for (const c of report.notRunChecks) {
      lines.push(`| ${c.check} | ${c.reason} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Load Run Data from Directory ─────────────────────────────────────────────

export function loadRunFromDir(runDir: string): {
  runRecord: RunRecord;
  events: RunEvent[];
} | null {
  const runJsonPath = path.join(runDir, 'run.json');
  const tracePath = path.join(runDir, 'trace.jsonl');

  if (!fs.existsSync(runJsonPath)) return null;

  const runRecord = JSON.parse(fs.readFileSync(runJsonPath, 'utf-8')) as RunRecord;

  const events: RunEvent[] = [];
  if (fs.existsSync(tracePath)) {
    const lines = fs.readFileSync(tracePath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        events.push(JSON.parse(line) as RunEvent);
      } catch {
        // Skip corrupted lines
      }
    }
  }

  return { runRecord, events };
}

// ─── S5 Extras Exports ────────────────────────────────────────────────────────
export * from './baseline.js';
export * from './failure-clustering.js';
export * from './diff.js';
export * from './interview-pack.js';
