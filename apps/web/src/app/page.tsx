'use client';

import React, { useState, useEffect, useCallback } from 'react';
import type { RunSummary } from '@/lib/types';
import { Header } from '@/components/Header';
import { RunCard } from '@/components/RunCard';
import { EmptyState } from '@/components/EmptyState';

export default function DashboardPage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchRuns = useCallback(async (quiet = false) => {
    if (!quiet) setIsRefreshing(true);
    try {
      const res = await fetch('/api/runs');
      const data = await res.json();
      if (data.ok) {
        setRuns(data.data || []);
        setError(null);
      } else {
        setError(data.message || 'Failed to load runs');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error loading runs');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
    // Auto-refresh every 5 seconds to catch newly generated CLI runs
    const interval = setInterval(() => {
      fetchRuns(true);
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchRuns]);

  const filteredRuns = runs.filter((run) => {
    const matchesSearch =
      run.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      run.adapterId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (run.errorMessage && run.errorMessage.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus = statusFilter === 'all' || run.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const succeededCount = runs.filter((r) => r.status === 'succeeded').length;
  const failedCount = runs.filter((r) => r.status === 'failed' || r.status === 'blocked').length;
  const activeCount = runs.filter((r) => !['succeeded', 'succeeded_with_warnings', 'failed', 'blocked', 'cancelled', 'timed_out'].includes(r.status)).length;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      <Header onRefresh={() => fetchRuns(false)} isRefreshing={isRefreshing} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Top Hero / Stats Banner */}
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                Execution Runs
              </h1>
              <p className="text-xs text-zinc-400 font-mono mt-1">
                Authoritative run records loaded directly from <code className="text-zinc-300">runs/&lt;runId&gt;/</code> (SSOT Section 2.2)
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400">
                Auto-syncing every 5s
              </span>
            </div>
          </div>

          {/* Quick Metrics Counter */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mb-6">
            <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80 backdrop-blur-sm">
              <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">
                Total Runs
              </span>
              <span className="text-2xl font-bold font-mono text-zinc-100">{runs.length}</span>
            </div>

            <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-900/30 backdrop-blur-sm">
              <span className="text-[11px] font-medium text-emerald-400 uppercase tracking-wider block mb-1">
                Succeeded
              </span>
              <span className="text-2xl font-bold font-mono text-emerald-300">{succeededCount}</span>
            </div>

            <div className="p-4 rounded-xl bg-red-950/20 border border-red-900/30 backdrop-blur-sm">
              <span className="text-[11px] font-medium text-red-400 uppercase tracking-wider block mb-1">
                Failed / Blocked
              </span>
              <span className="text-2xl font-bold font-mono text-red-300">{failedCount}</span>
            </div>

            <div className="p-4 rounded-xl bg-blue-950/20 border border-blue-900/30 backdrop-blur-sm">
              <span className="text-[11px] font-medium text-blue-400 uppercase tracking-wider block mb-1">
                Active / Running
              </span>
              <span className="text-2xl font-bold font-mono text-blue-300">{activeCount}</span>
            </div>
          </div>

          {/* Search & Filter Controls */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 rounded-xl bg-zinc-900/40 border border-zinc-800/80">
            <div className="relative flex-1">
              <svg
                className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search runs by ID, adapter, or error..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="status-select" className="text-xs text-zinc-400 shrink-0 font-mono">
                Status:
              </label>
              <select
                id="status-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <option value="all">All Statuses</option>
                <option value="succeeded">Succeeded</option>
                <option value="failed">Failed</option>
                <option value="blocked">Blocked</option>
                <option value="running">Running</option>
                <option value="queued">Queued</option>
                <option value="timed_out">Timed out</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>
        </div>

        {/* Runs List / States */}
        {isLoading ? (
          <div className="py-20 text-center">
            <div className="inline-flex items-center gap-2 text-xs font-mono text-zinc-400">
              <svg className="w-4 h-4 animate-spin text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              Loading run records...
            </div>
          </div>
        ) : error ? (
          <EmptyState
            icon="error"
            title="Failed to Load Runs"
            description={error}
            actionHref="/"
            actionText="Retry Loading"
          />
        ) : runs.length === 0 ? (
          <EmptyState
            icon="empty"
            title="No Runs Found"
            description="No run directories exist in runs/. Execute a task using the CLI to generate your first verified run record."
            actionHref="#"
            actionText="pnpm agentforge run --input fixtures/demo.json --output runs/demo.json"
          />
        ) : filteredRuns.length === 0 ? (
          <EmptyState
            icon="search"
            title="No Matching Runs"
            description={`No runs matched your query "${searchQuery}" with status "${statusFilter}".`}
          />
        ) : (
          <div className="space-y-3">
            {filteredRuns.map((run) => (
              <RunCard key={run.id} run={run} />
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-zinc-900 py-6 text-center text-xs font-mono text-zinc-600">
        AgentForge T1-lite Run Viewer · Authoritative Local State from <code className="text-zinc-500">runs/</code>
      </footer>
    </div>
  );
}
