/**
 * Run Diff Comparator (FR-040)
 *
 * Compares two runs to identify:
 * - Changed record outputs & labels
 * - Metric deltas (accuracy, duration, counts)
 * - Newly failing records (regressions!)
 * - Newly passing records (fixes!)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RunRecord } from '@agentforge/schemas';

export interface RecordDiff {
  id: string;
  outputA?: unknown;
  outputB?: unknown;
  statusA?: string;
  statusB?: string;
  changeType: 'REGRESSION' | 'FIX' | 'CHANGED_OUTPUT' | 'ADDED' | 'REMOVED';
  detail: string;
}

export interface MetricDelta {
  metric: string;
  valueA: number | string;
  valueB: number | string;
  delta?: number;
}

export interface RunDiffResult {
  runIdA: string;
  runIdB: string;
  recordA: RunRecord | null;
  recordB: RunRecord | null;
  regressions: RecordDiff[];
  fixes: RecordDiff[];
  changedOutputs: RecordDiff[];
  added: RecordDiff[];
  removed: RecordDiff[];
  metricDeltas: MetricDelta[];
  totalChangedCount: number;
}

/**
 * Compare two run directories on disk.
 */
export function compareRuns(runDirA: string, runDirB: string): RunDiffResult {
  // 1. Load run.json
  const loadJson = <T>(p: string): T | null => {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch {}
    return null;
  };

  const recordA = loadJson<RunRecord>(path.join(runDirA, 'run.json'));
  const recordB = loadJson<RunRecord>(path.join(runDirB, 'run.json'));

  const outputsA = loadJson<any[]>(path.join(runDirA, 'output.json')) ?? [];
  const outputsB = loadJson<any[]>(path.join(runDirB, 'output.json')) ?? [];

  const metricsA = loadJson<Record<string, any>>(path.join(runDirA, 'metrics.json')) ?? {};
  const metricsB = loadJson<Record<string, any>>(path.join(runDirB, 'metrics.json')) ?? {};

  // Build maps by record ID
  const mapA = new Map<string, any>();
  for (const item of outputsA) {
    if (item && item.id) mapA.set(item.id, item);
  }

  const mapB = new Map<string, any>();
  for (const item of outputsB) {
    if (item && item.id) mapB.set(item.id, item);
  }

  const regressions: RecordDiff[] = [];
  const fixes: RecordDiff[] = [];
  const changedOutputs: RecordDiff[] = [];
  const added: RecordDiff[] = [];
  const removed: RecordDiff[] = [];

  const allIds = new Set([...mapA.keys(), ...mapB.keys()]);

  for (const id of allIds) {
    const itemA = mapA.get(id);
    const itemB = mapB.get(id);

    if (!itemA && itemB) {
      added.push({
        id,
        outputB: itemB,
        changeType: 'ADDED',
        detail: 'Record present in Run B but missing in Run A',
      });
    } else if (itemA && !itemB) {
      removed.push({
        id,
        outputA: itemA,
        changeType: 'REMOVED',
        detail: 'Record present in Run A but missing in Run B',
      });
    } else if (itemA && itemB) {
      const strA = JSON.stringify(itemA);
      const strB = JSON.stringify(itemB);

      if (strA !== strB) {
        // Check if sentiment or status changed
        const sentimentA = itemA.sentiment;
        const sentimentB = itemB.sentiment;

        let isRegression = false;
        let isFix = false;

        // If error or invalid
        if (itemA.error && !itemB.error) isFix = true;
        if (!itemA.error && itemB.error) isRegression = true;

        const diffItem: RecordDiff = {
          id,
          outputA: itemA,
          outputB: itemB,
          changeType: isRegression ? 'REGRESSION' : (isFix ? 'FIX' : 'CHANGED_OUTPUT'),
          detail: sentimentA && sentimentB && sentimentA !== sentimentB
            ? `Sentiment shifted: '${sentimentA}' → '${sentimentB}'`
            : `Output fields changed: confA=${itemA.confidence ?? '?'} confB=${itemB.confidence ?? '?'}`,
        };

        if (isRegression) regressions.push(diffItem);
        else if (isFix) fixes.push(diffItem);
        else changedOutputs.push(diffItem);
      }
    }
  }

  // Compute metric deltas
  const allMetricKeys = new Set([...Object.keys(metricsA), ...Object.keys(metricsB)]);
  const metricDeltas: MetricDelta[] = [];

  for (const key of allMetricKeys) {
    const valA = metricsA[key] ?? 'unavailable';
    const valB = metricsB[key] ?? 'unavailable';

    let delta: number | undefined;
    if (typeof valA === 'number' && typeof valB === 'number') {
      delta = Number((valB - valA).toFixed(3));
    }

    metricDeltas.push({
      metric: key,
      valueA: valA,
      valueB: valB,
      delta,
    });
  }

  const runIdA = recordA?.id ?? path.basename(runDirA);
  const runIdB = recordB?.id ?? path.basename(runDirB);

  return {
    runIdA,
    runIdB,
    recordA,
    recordB,
    regressions,
    fixes,
    changedOutputs,
    added,
    removed,
    metricDeltas,
    totalChangedCount: regressions.length + fixes.length + changedOutputs.length + added.length + removed.length,
  };
}

/**
 * Render Run Diff into a clear Markdown comparison report.
 */
export function renderRunDiffMarkdown(diff: RunDiffResult): string {
  const lines: string[] = [
    `# Run Diff: \`${diff.runIdA}\` ➔ \`${diff.runIdB}\` (FR-040)`,
    '',
    `| Attribute | Run A (\`${diff.runIdA}\`) | Run B (\`${diff.runIdB}\`) |`,
    '|---|---|---|',
    `| **Status** | ${diff.recordA?.status ?? 'unknown'} | ${diff.recordB?.status ?? 'unknown'} |`,
    `| **Created** | ${diff.recordA?.createdAt ?? 'unknown'} | ${diff.recordB?.createdAt ?? 'unknown'} |`,
    `| **Code Version** | ${diff.recordA?.codeVersion ?? 'unknown'} | ${diff.recordB?.codeVersion ?? 'unknown'} |`,
    '',
    '## Metric Deltas',
    '',
    '| Metric | Run A | Run B | Delta |',
    '|---|---|---|---|',
  ];

  if (diff.metricDeltas.length === 0) {
    lines.push('| (None recorded) | - | - | - |');
  } else {
    for (const m of diff.metricDeltas) {
      const deltaStr = m.delta !== undefined
        ? `${m.delta >= 0 ? '+' : ''}${m.delta}`
        : '—';
      lines.push(`| **${m.metric}** | ${m.valueA} | ${m.valueB} | **${deltaStr}** |`);
    }
  }

  lines.push('');
  lines.push('## Record-Level Changes');
  lines.push('');
  lines.push(`- **Regressions (Newly Failing):** ${diff.regressions.length}`);
  lines.push(`- **Fixes (Newly Passing):** ${diff.fixes.length}`);
  lines.push(`- **Changed Outputs:** ${diff.changedOutputs.length}`);
  lines.push(`- **Added Records:** ${diff.added.length}`);
  lines.push(`- **Removed Records:** ${diff.removed.length}`);
  lines.push('');

  if (diff.regressions.length > 0) {
    lines.push('### ⚠️ Regressions Detected');
    lines.push('| Record ID | Change Details |');
    lines.push('|---|---|');
    for (const r of diff.regressions) {
      lines.push(`| \`${r.id}\` | ${r.detail} |`);
    }
    lines.push('');
  }

  if (diff.fixes.length > 0) {
    lines.push('### ✅ Newly Passing / Fixed Records');
    lines.push('| Record ID | Fix Details |');
    lines.push('|---|---|');
    for (const f of diff.fixes) {
      lines.push(`| \`${f.id}\` | ${f.detail} |`);
    }
    lines.push('');
  }

  if (diff.changedOutputs.length > 0) {
    lines.push('### 🔄 Output Variations');
    lines.push('| Record ID | Difference |');
    lines.push('|---|---|');
    for (const c of diff.changedOutputs.slice(0, 10)) {
      lines.push(`| \`${c.id}\` | ${c.detail} |`);
    }
    if (diff.changedOutputs.length > 10) {
      lines.push(`| ... | (${diff.changedOutputs.length - 10} additional changed records omitted) |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
