/**
 * Failure Clustering Report (FR-036)
 *
 * Groups failed records by ErrorCategory and feature dimensions (input length,
 * label, missing evidence) and produces structured cluster summaries and
 * docs/failure-analysis.md content.
 */

import type { ErrorCategory, RecordResult } from '@agentforge/shared';

export type LengthBucket = 'short (<50 chars)' | 'medium (50-200 chars)' | 'long (>200 chars)';

export function getLengthBucket(length?: number): LengthBucket {
  if (length === undefined || length < 50) return 'short (<50 chars)';
  if (length <= 200) return 'medium (50-200 chars)';
  return 'long (>200 chars)';
}

export interface FailureItem {
  recordId: string;
  category: ErrorCategory;
  message: string;
  inputLength?: number;
  label?: string;
  hasEvidence?: boolean;
}

export interface RichFailureCluster {
  clusterId: string;
  category: ErrorCategory;
  lengthBucket: LengthBucket;
  count: number;
  percentage: number;
  exampleIds: string[];
  remediationAdvice: string;
}

function getRemediationAdvice(category: ErrorCategory, lengthBucket: LengthBucket): string {
  switch (category) {
    case 'SCHEMA_INVALID':
    case 'LLM_INVALID_OUTPUT':
      return lengthBucket === 'long (>200 chars)'
        ? 'Prompt truncation suspected: enforce structured format early in system prompt or reduce context size.'
        : 'Tighten Zod schema correction prompt and add 1-shot schema demonstration.';
    case 'RUN_TIMED_OUT':
    case 'LLM_TIMEOUT':
      return 'Check downstream LLM latency and review BATCH_CONCURRENCY / timeout boundaries.';
    case 'LLM_RATE_LIMITED':
      return 'Implement exponential backoff with jitter and consider throttling batch concurrency.';
    case 'INPUT_INVALID':
      return 'Add pre-normalization sanitization and strip invalid UTF-8 or malformed characters.';
    case 'OUTPUT_INVALID':
      return 'Re-verify output writer serialization format and check for atomic write corruption.';
    case 'BUDGET_EXCEEDED':
      return 'Cap maximum LLM calls per run or increase token quota allocation.';
    default:
      return 'Review trace events in trace.jsonl to isolate root cause.';
  }
}

/**
 * Cluster failures by error category and feature dimensions.
 */
export function clusterFailuresByFeatures(
  failures: FailureItem[],
  totalRecords = failures.length,
): RichFailureCluster[] {
  if (failures.length === 0) return [];

  const clusterMap = new Map<string, {
    category: ErrorCategory;
    lengthBucket: LengthBucket;
    ids: string[];
  }>();

  for (const item of failures) {
    const bucket = getLengthBucket(item.inputLength);
    const key = `${item.category}::${bucket}`;

    let cluster = clusterMap.get(key);
    if (!cluster) {
      cluster = {
        category: item.category,
        lengthBucket: bucket,
        ids: [],
      };
      clusterMap.set(key, cluster);
    }
    cluster.ids.push(item.recordId);
  }

  const clusters: RichFailureCluster[] = [...clusterMap.entries()].map(([key, data]) => {
    const count = data.ids.length;
    const percentage = totalRecords > 0 ? (count / totalRecords) * 100 : 0;
    return {
      clusterId: key,
      category: data.category,
      lengthBucket: data.lengthBucket,
      count,
      percentage: Number(percentage.toFixed(1)),
      exampleIds: data.ids.slice(0, 3),
      remediationAdvice: getRemediationAdvice(data.category, data.lengthBucket),
    };
  });

  return clusters.sort((a, b) => b.count - a.count);
}

/**
 * Helper to extract FailureItems from RecordResult array.
 */
export function extractFailuresFromResults(
  results: RecordResult[],
  inputLengths?: Map<string, number>,
): FailureItem[] {
  const items: FailureItem[] = [];
  for (const r of results) {
    if (r.status === 'failed' || r.status === 'blocked' || r.error) {
      items.push({
        recordId: r.recordId,
        category: r.error?.category ?? 'INTERNAL_ERROR',
        message: r.error?.message ?? 'Execution failed',
        inputLength: inputLengths?.get(r.recordId),
        hasEvidence: r.evidenceRefs && r.evidenceRefs.length > 0,
      });
    }
  }
  return items;
}

/**
 * Render complete Failure Analysis Markdown report for docs/failure-analysis.md.
 */
export function renderFailureAnalysisMarkdown(
  clusters: RichFailureCluster[],
  totalFailures: number,
  totalRecords: number,
): string {
  const lines: string[] = [
    '# Failure Analysis and Clustering Report (FR-036)',
    '',
    `**Total Workload:** ${totalRecords} records`,
    `**Total Failures:** ${totalFailures} records (${totalRecords > 0 ? ((totalFailures / totalRecords) * 100).toFixed(1) : 0}%)`,
    `**Distinct Clusters Identified:** ${clusters.length}`,
    '',
    '## Ranked Failure Clusters',
    '',
    '| Rank | Category | Feature / Bucket | Count | % of Workload | Sample IDs |',
    '|---|---|---|---|---|---|',
  ];

  if (clusters.length === 0) {
    lines.push('| - | None | - | 0 | 0.0% | None |');
    lines.push('');
    lines.push('🎉 **No failures detected in this workload!**');
    return lines.join('\n');
  }

  clusters.forEach((c, idx) => {
    lines.push(
      `| #${idx + 1} | \`${c.category}\` | ${c.lengthBucket} | ${c.count} | ${c.percentage}% | \`${c.exampleIds.join(', ')}\` |`,
    );
  });

  lines.push('');
  lines.push('## Cluster Diagnostics & Remediation Plan');
  lines.push('');

  clusters.forEach((c, idx) => {
    lines.push(`### #${idx + 1}. \`${c.category}\` (${c.lengthBucket})`);
    lines.push(`- **Frequency:** ${c.count} occurrences`);
    lines.push(`- **Sample Record IDs:** ${c.exampleIds.map((id) => `\`${id}\``).join(', ')}`);
    lines.push(`- **Prescribed Remediation:** ${c.remediationAdvice}`);
    lines.push('');
  });

  return lines.join('\n');
}
