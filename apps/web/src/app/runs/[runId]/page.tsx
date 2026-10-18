'use client';

import React, { useState, useEffect, useCallback, useMemo, use } from 'react';
import Link from 'next/link';
import type { RunDetails } from '@/lib/types';
import type { RunEvent } from '@agentforge/shared';
import { Header } from '@/components/Header';
import { StatusBadge } from '@/components/StatusBadge';
import { MetricsCard } from '@/components/MetricsCard';
import { Timeline } from '@/components/Timeline';
import { OutputViewer } from '@/components/OutputViewer';
import { ArtifactsList } from '@/components/ArtifactsList';
import { ConfigSnapshot } from '@/components/ConfigSnapshot';
import { EmptyState } from '@/components/EmptyState';

interface PageProps {
  params: Promise<{ runId: string }>;
}

export default function RunDetailPage({ params }: PageProps) {
  const { runId } = use(params);

  const [run, setRun] = useState<RunDetails | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'output' | 'timeline' | 'artifacts' | 'config'>('output');

  const terminalStatuses = useMemo(
    () => [
      'succeeded',
      'succeeded_with_warnings',
      'failed',
      'blocked',
      'cancelled',
      'timed_out',
    ],
    [],
  );

  const isPolling = Boolean(run && !terminalStatuses.includes(run.status));

  // Load run details
  const loadRunDetails = useCallback(async (quiet = false) => {
    if (!quiet) setIsRefreshing(true);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
      const data = await res.json();
      if (data.ok) {
        setRun(data.data);
        setError(null);
      } else {
        setError(data.message || 'Run not found');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch run details');
    } finally {
      setIsLoading(false);
      if (!quiet) setIsRefreshing(false);
    }
  }, [runId]);

  // Load events
  const loadEvents = useCallback(async (afterSeq = -1) => {
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/events?after=${afterSeq}`);
      const data = await res.json();
      if (data.ok && Array.isArray(data.events)) {
        if (afterSeq === -1) {
          setEvents(data.events);
        } else if (data.events.length > 0) {
          setEvents((prev) => [...prev, ...data.events]);
        }
      }
    } catch {
      // Ignore polling errors
    }
  }, [runId]);

  // Initial load (FR-005: Refresh recovery)
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const res = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.ok) {
          setRun(data.data);
          setError(null);
        } else {
          setError(data.message || 'Run not found');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to fetch run details');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }

      try {
        const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/events?after=-1`);
        const data = await res.json();
        if (!cancelled && data.ok && Array.isArray(data.events)) {
          setEvents(data.events);
        }
      } catch {
        // Ignore polling errors
      }
    };

    void init();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  // Active Polling with backoff for non-terminal runs (FR-UI-003)
  useEffect(() => {
    if (!isPolling) return;

    let pollIntervalMs = 1500;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const poll = async () => {
      await loadRunDetails(true);
      if (cancelled) return;
      const lastSeq = events.length > 0 ? events[events.length - 1].sequence : -1;
      await loadEvents(lastSeq);
      if (cancelled) return;

      // Backoff slightly up to 4s
      pollIntervalMs = Math.min(pollIntervalMs + 500, 4000);
      timer = setTimeout(poll, pollIntervalMs);
    };

    timer = setTimeout(poll, pollIntervalMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isPolling, events, loadRunDetails, loadEvents]);

  const formatTime = (iso?: string) => {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      <Header onRefresh={() => { loadRunDetails(false); loadEvents(); }} isRefreshing={isRefreshing} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Breadcrumb Navigation */}
        <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-2 text-xs font-mono text-zinc-400">
          <Link href="/" className="hover:text-zinc-200 transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 rounded p-0.5">
            Runs
          </Link>
          <span className="text-zinc-600">/</span>
          <span className="text-zinc-200 font-semibold truncate max-w-xs">{runId}</span>
        </nav>

        {isLoading ? (
          <div className="py-24 text-center">
            <div className="inline-flex items-center gap-2 text-xs font-mono text-zinc-400">
              <svg className="w-5 h-5 animate-spin text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              Loading run record {runId}...
            </div>
          </div>
        ) : error || !run ? (
          <EmptyState
            icon="error"
            title="Run Not Found"
            description={error || `Run record "${runId}" does not exist in the runs/ directory.`}
            actionHref="/"
            actionText="Back to Runs Dashboard"
          />
        ) : (
          <div className="space-y-6">
            {/* Top Run Header */}
            <div className="p-6 rounded-2xl bg-zinc-900/70 border border-zinc-800/80 backdrop-blur-md">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <h1 className="text-xl sm:text-2xl font-bold font-mono text-white tracking-tight">
                      {run.id}
                    </h1>
                    <span className="text-xs font-mono font-medium px-2.5 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                      adapter: {run.adapterId}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 text-xs font-mono text-zinc-400 mt-2.5 flex-wrap">
                    <span>Created: <strong className="text-zinc-200">{formatTime(run.createdAt)}</strong></span>
                    {run.startedAt && <span>Started: <strong className="text-zinc-200">{formatTime(run.startedAt)}</strong></span>}
                    {run.finishedAt && <span>Finished: <strong className="text-zinc-200">{formatTime(run.finishedAt)}</strong></span>}
                    {run.durationMs !== undefined && (
                      <span>Duration: <strong className="text-zinc-200">{(run.durationMs / 1000).toFixed(2)}s</strong></span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <StatusBadge status={run.status} size="lg" showMeaning={true} />
                </div>
              </div>

              {/* Error Notice (if failed or blocked) */}
              {run.errorCategory && (
                <div className="mt-4 p-3.5 rounded-xl bg-red-950/40 border border-red-900/60 text-xs font-mono text-red-300 flex items-start gap-3">
                  <svg className="w-4 h-4 text-red-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <circle cx="12" cy="12" r="9" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01" />
                  </svg>
                  <div>
                    <span className="font-bold text-red-200">Taxonomy Category: [{run.errorCategory}]</span>
                    <p className="mt-1 text-red-300/90">{run.errorMessage || 'An error occurred during execution'}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Metrics Overview */}
            <MetricsCard metrics={run.metrics} durationMs={run.durationMs} />

            {/* Navigation Tabs */}
            <div className="border-b border-zinc-800">
              <nav aria-label="Run Sections" className="flex items-center gap-2 overflow-x-auto">
                <button
                  onClick={() => setActiveTab('output')}
                  className={`px-4 py-2.5 text-xs font-medium font-mono rounded-t-lg border-b-2 transition-colors flex items-center gap-2 ${
                    activeTab === 'output'
                      ? 'border-indigo-500 text-white bg-zinc-900/80'
                      : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Output & Evidence
                </button>

                <button
                  onClick={() => setActiveTab('timeline')}
                  className={`px-4 py-2.5 text-xs font-medium font-mono rounded-t-lg border-b-2 transition-colors flex items-center gap-2 ${
                    activeTab === 'timeline'
                      ? 'border-indigo-500 text-white bg-zinc-900/80'
                      : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Timeline ({events.length})
                </button>

                <button
                  onClick={() => setActiveTab('artifacts')}
                  className={`px-4 py-2.5 text-xs font-medium font-mono rounded-t-lg border-b-2 transition-colors flex items-center gap-2 ${
                    activeTab === 'artifacts'
                      ? 'border-indigo-500 text-white bg-zinc-900/80'
                      : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  Artifacts ({run.artifacts.length})
                </button>

                <button
                  onClick={() => setActiveTab('config')}
                  className={`px-4 py-2.5 text-xs font-medium font-mono rounded-t-lg border-b-2 transition-colors flex items-center gap-2 ${
                    activeTab === 'config'
                      ? 'border-indigo-500 text-white bg-zinc-900/80'
                      : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Config Snapshot
                </button>
              </nav>
            </div>

            {/* Tab Panels */}
            {activeTab === 'output' && (
              <OutputViewer output={run.outputSnapshot} runStatus={run.status} />
            )}

            {activeTab === 'timeline' && (
              <Timeline events={events} isPolling={isPolling} />
            )}

            {activeTab === 'artifacts' && (
              <ArtifactsList artifacts={run.artifacts} runId={run.id} />
            )}

            {activeTab === 'config' && (
              <ConfigSnapshot
                config={run.configSnapshot}
                inputHash={run.inputHash}
                codeVersion={run.codeVersion}
              />
            )}
          </div>
        )}
      </main>

      <footer className="border-t border-zinc-900 py-6 text-center text-xs font-mono text-zinc-600">
        AgentForge T1-lite Run Viewer · Authoritative Local State from <code className="text-zinc-500">runs/{runId}/</code>
      </footer>
    </div>
  );
}
