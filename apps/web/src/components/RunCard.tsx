import React from 'react';
import Link from 'next/link';
import type { RunSummary } from '@/lib/types';
import { StatusBadge } from './StatusBadge';

interface RunCardProps {
  run: RunSummary;
}

export function RunCard({ run }: RunCardProps) {
  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const formatDuration = (ms?: number) => {
    if (ms === undefined || ms === null) return null;
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const durationStr = formatDuration(run.durationMs);

  return (
    <Link
      href={`/runs/${encodeURIComponent(run.id)}`}
      className="block p-5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 hover:border-zinc-700/80 hover:bg-zinc-900/90 transition-all group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <span className="font-mono font-semibold text-sm text-zinc-100 group-hover:text-indigo-400 transition-colors">
            {run.id}
          </span>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
            {run.adapterId}
          </span>
        </div>

        <StatusBadge status={run.status} size="sm" />
      </div>

      <div className="flex items-center justify-between text-xs font-mono text-zinc-400 pt-3 border-t border-zinc-800/60">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="flex items-center gap-1.5 text-zinc-500">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {formatTime(run.createdAt)}
          </span>

          {durationStr && (
            <span className="text-zinc-400">
              Duration: <strong className="text-zinc-200">{durationStr}</strong>
            </span>
          )}

          {run.metrics?.totalRecords !== undefined && (
            <span className="text-zinc-400">
              Records: <strong className="text-zinc-200">{run.metrics.succeededRecords ?? 0}/{run.metrics.totalRecords}</strong>
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 text-indigo-400 group-hover:translate-x-0.5 transition-transform">
          <span>View</span>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>

      {run.errorCategory && (
        <div className="mt-3 p-2 rounded bg-red-950/30 border border-red-900/40 text-[11px] font-mono text-red-300 flex items-center gap-2">
          <span className="font-semibold">[{run.errorCategory}]</span>
          <span className="truncate">{run.errorMessage || 'An error terminated this run'}</span>
        </div>
      )}
    </Link>
  );
}
