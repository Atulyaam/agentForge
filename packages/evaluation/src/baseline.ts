/**
 * Baseline Comparator (FR-035)
 *
 * Implements a deterministic rules/heuristic baseline for the DemoAdapter task
 * (sentiment classification) and provides comparative metrics evaluation between
 * the LLM agent and the baseline.
 *
 * - Implements the same output contract: { id, text, sentiment, confidence }
 * - Never used as silent fallback for live processing (FR-023)
 * - Computes accuracy, duration, counts, and measurable lift
 */

export interface BaselineRecord {
  id: string;
  text: string;
}

export interface BaselineOutput {
  id: string;
  text: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  confidence: number;
}

export interface ComparativeMetrics {
  agentMetrics: {
    total: number;
    succeeded: number;
    failed: number;
    accuracy: number | 'unavailable';
    durationMs: number;
  };
  baselineMetrics: {
    total: number;
    succeeded: number;
    failed: number;
    accuracy: number | 'unavailable';
    durationMs: number;
  };
  lift: {
    accuracyLift: number | 'unavailable';
    latencyDiffMs: number;
    failureReduction: number;
  };
}

/**
 * Rule-based heuristic sentiment classifier.
 * Inspects positive and negative word frequencies deterministically.
 */
export function classifySentimentHeuristic(text: string): {
  sentiment: 'positive' | 'negative' | 'neutral';
  confidence: number;
} {
  const lower = text.toLowerCase();
  const positiveWords = [
    'good', 'great', 'excellent', 'love', 'happy', 'fast', 'amazing',
    'best', 'positive', 'wonderful', 'stellar', 'fantastic', 'easy',
  ];
  const negativeWords = [
    'bad', 'terrible', 'awful', 'hate', 'sad', 'slow', 'worst',
    'negative', 'broken', 'horrible', 'error', 'fails', 'failing', 'hard',
  ];

  let posCount = 0;
  for (const w of positiveWords) {
    if (lower.includes(w)) posCount++;
  }
  let negCount = 0;
  for (const w of negativeWords) {
    if (lower.includes(w)) negCount++;
  }

  if (posCount > negCount) {
    return {
      sentiment: 'positive',
      confidence: Math.min(0.6 + posCount * 0.1, 0.95),
    };
  } else if (negCount > posCount) {
    return {
      sentiment: 'negative',
      confidence: Math.min(0.6 + negCount * 0.1, 0.95),
    };
  } else {
    return {
      sentiment: 'neutral',
      confidence: 0.5,
    };
  }
}

/**
 * Execute baseline evaluation on a list of input records.
 */
export function runBaselineComparator(
  inputs: BaselineRecord[],
  expected?: Array<{ id: string; sentiment: string }>,
): {
  outputs: BaselineOutput[];
  metrics: {
    total: number;
    succeeded: number;
    failed: number;
    accuracy: number | 'unavailable';
    durationMs: number;
  };
} {
  const startTime = Date.now();
  const outputs: BaselineOutput[] = inputs.map((rec) => {
    const res = classifySentimentHeuristic(rec.text);
    return {
      id: rec.id,
      text: rec.text,
      sentiment: res.sentiment,
      confidence: res.confidence,
    };
  });
  const durationMs = Math.max(1, Date.now() - startTime);

  let accuracy: number | 'unavailable' = 'unavailable';
  if (expected && Array.isArray(expected)) {
    const expMap = new Map(expected.map((e) => [e.id, e.sentiment]));
    let correct = 0;
    let evalCount = 0;
    for (const out of outputs) {
      const exp = expMap.get(out.id);
      if (exp !== undefined) {
        evalCount++;
        if (out.sentiment === exp) correct++;
      }
    }
    if (evalCount > 0) {
      accuracy = correct / evalCount;
    }
  }

  return {
    outputs,
    metrics: {
      total: outputs.length,
      succeeded: outputs.length,
      failed: 0,
      accuracy,
      durationMs,
    },
  };
}

/**
 * Compute comparative metrics and lift between Agent and Baseline.
 */
export function compareAgentWithBaseline(
  agentMetrics: {
    total: number;
    succeeded: number;
    failed: number;
    accuracy: number | 'unavailable';
    durationMs: number;
  },
  baselineMetrics: {
    total: number;
    succeeded: number;
    failed: number;
    accuracy: number | 'unavailable';
    durationMs: number;
  },
): ComparativeMetrics {
  const accuracyLift =
    typeof agentMetrics.accuracy === 'number' && typeof baselineMetrics.accuracy === 'number'
      ? agentMetrics.accuracy - baselineMetrics.accuracy
      : 'unavailable';

  const latencyDiffMs = agentMetrics.durationMs - baselineMetrics.durationMs;
  const failureReduction = baselineMetrics.failed - agentMetrics.failed;

  return {
    agentMetrics,
    baselineMetrics,
    lift: {
      accuracyLift,
      latencyDiffMs,
      failureReduction,
    },
  };
}

/**
 * Render comparison table in Markdown.
 */
export function renderBaselineMarkdownTable(comparison: ComparativeMetrics): string {
  const { agentMetrics, baselineMetrics, lift } = comparison;

  const fmtAcc = (val: number | 'unavailable') =>
    typeof val === 'number' ? `${(val * 100).toFixed(1)}%` : 'unavailable';
  const fmtLift = (val: number | 'unavailable') =>
    typeof val === 'number'
      ? `${val >= 0 ? '+' : ''}${(val * 100).toFixed(1)}%`
      : 'unavailable';

  return [
    '## Baseline vs Agent Comparison (FR-035)',
    '',
    '| Metric | Rule Heuristic Baseline | LLM Agent | Measured Lift |',
    '|---|---|---|---|',
    `| **Accuracy** | ${fmtAcc(baselineMetrics.accuracy)} | ${fmtAcc(agentMetrics.accuracy)} | **${fmtLift(lift.accuracyLift)}** |`,
    `| **Succeeded** | ${baselineMetrics.succeeded} / ${baselineMetrics.total} | ${agentMetrics.succeeded} / ${agentMetrics.total} | ${agentMetrics.succeeded - baselineMetrics.succeeded >= 0 ? '+' : ''}${agentMetrics.succeeded - baselineMetrics.succeeded} |`,
    `| **Failed** | ${baselineMetrics.failed} | ${agentMetrics.failed} | ${lift.failureReduction > 0 ? `-${lift.failureReduction}` : `${lift.failureReduction}`} |`,
    `| **Duration** | ${baselineMetrics.durationMs}ms | ${agentMetrics.durationMs}ms | +${lift.latencyDiffMs}ms |`,
    '',
  ].join('\n');
}
