import React from 'react';
import type { RunSummary } from '@/lib/types';

interface MetricsCardProps {
  metrics?: RunSummary['metrics'];
  durationMs?: number;
  className?: string;
}

export function MetricsCard({ metrics, durationMs, className = '' }: MetricsCardProps) {
  if (!metrics) {
    return (
      <div className={`p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-center ${className}`}>
        <p className="text-xs text-zinc-500 font-mono">No metrics recorded for this run</p>
      </div>
    );
  }

  const formatDuration = (ms?: number) => {
    if (ms === undefined || ms === null) return 'unavailable';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const total = metrics.totalRecords ?? 0;
  const succeeded = metrics.succeededRecords ?? 0;
  const failed = metrics.failedRecords ?? 0;
  const blocked = metrics.blockedRecords ?? 0;
  const successRate = total > 0 ? Math.round((succeeded / total) * 100) : 0;
  const effectiveDuration = durationMs ?? metrics.totalDurationMs;

  return (
    <div className={`p-5 rounded-xl bg-zinc-900/70 border border-zinc-800/80 backdrop-blur-sm ${className}`}>
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-800/60">
        <h3 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider flex items-center gap-2">
          <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          Measured Execution Metrics
        </h3>
        {total > 0 && (
          <span className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
            {successRate}% Success Rate
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800/50">
          <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">
            Total Records
          </span>
          <span className="text-xl font-bold font-mono text-zinc-100">{total}</span>
        </div>

        <div className="p-3 rounded-lg bg-emerald-950/20 border border-emerald-900/30">
          <span className="text-[11px] font-medium text-emerald-400 uppercase tracking-wider block mb-1">
            Succeeded
          </span>
          <span className="text-xl font-bold font-mono text-emerald-300">{succeeded}</span>
        </div>

        <div className="p-3 rounded-lg bg-red-950/20 border border-red-900/30">
          <span className="text-[11px] font-medium text-red-400 uppercase tracking-wider block mb-1">
            Failed
          </span>
          <span className="text-xl font-bold font-mono text-red-300">{failed}</span>
        </div>

        <div className="p-3 rounded-lg bg-amber-950/20 border border-amber-900/30">
          <span className="text-[11px] font-medium text-amber-400 uppercase tracking-wider block mb-1">
            Blocked
          </span>
          <span className="text-xl font-bold font-mono text-amber-300">{blocked}</span>
        </div>

        <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800/50">
          <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">
            Duration
          </span>
          <span className="text-xl font-bold font-mono text-zinc-100">
            {formatDuration(effectiveDuration)}
          </span>
        </div>

        <div className="p-3 rounded-lg bg-indigo-950/20 border border-indigo-900/30">
          <span className="text-[11px] font-medium text-indigo-400 uppercase tracking-wider block mb-1">
            LLM Calls
          </span>
          <span className="text-xl font-bold font-mono text-indigo-300">
            {metrics.llmCalls !== undefined ? metrics.llmCalls : 'unavailable'}
          </span>
        </div>
      </div>
    </div>
  );
}
