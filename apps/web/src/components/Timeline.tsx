'use client';

import React, { useState } from 'react';
import type { RunEvent } from '@agentforge/shared';

interface TimelineProps {
  events: RunEvent[];
  isPolling?: boolean;
  className?: string;
}

export function Timeline({ events, isPolling = false, className = '' }: TimelineProps) {
  const [expandedSeq, setExpandedSeq] = useState<number | null>(null);
  const [filterType, setFilterType] = useState<string>('all');

  const toggleExpand = (seq: number) => {
    setExpandedSeq(expandedSeq === seq ? null : seq);
  };

  const eventTypes = ['all', ...Array.from(new Set(events.map((e) => e.type)))];

  const filteredEvents = filterType === 'all'
    ? events
    : events.filter((e) => e.type === filterType);

  const getEventBadge = (type: string) => {
    switch (type) {
      case 'status_change':
        return 'bg-indigo-950/60 text-indigo-300 border-indigo-700/50';
      case 'run_started':
        return 'bg-blue-950/60 text-blue-300 border-blue-700/50';
      case 'run_finished':
        return 'bg-emerald-950/60 text-emerald-300 border-emerald-700/50';
      case 'input_parsed':
      case 'output_validated':
      case 'output_written':
        return 'bg-teal-950/60 text-teal-300 border-teal-700/50';
      case 'record_processed':
        return 'bg-zinc-800/80 text-zinc-300 border-zinc-700/50';
      case 'record_retried_success':
        return 'bg-amber-950/60 text-amber-300 border-amber-700/50';
      case 'record_error':
      case 'run_error':
      case 'output_validation_failed':
        return 'bg-red-950/60 text-red-300 border-red-700/50';
      default:
        return 'bg-zinc-900 text-zinc-400 border-zinc-800';
    }
  };

  const formatTimestamp = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
    } catch {
      return iso;
    }
  };

  return (
    <div className={`rounded-xl bg-zinc-900/70 border border-zinc-800/80 backdrop-blur-sm p-5 ${className}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-zinc-800/60">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider flex items-center gap-2">
            <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Execution Trace & Timeline
          </h3>
          <span className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
            {events.length} events
          </span>
          {isPolling && (
            <span className="inline-flex items-center gap-1.5 text-xs text-blue-400 animate-pulse font-mono">
              <span className="w-2 h-2 rounded-full bg-blue-400"></span>
              Live Polling Active
            </span>
          )}
        </div>

        {eventTypes.length > 2 && (
          <div className="flex items-center gap-2">
            <label htmlFor="event-filter" className="text-xs text-zinc-400">Filter:</label>
            <select
              id="event-filter"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="text-xs bg-zinc-950 border border-zinc-700 rounded-md px-2.5 py-1 text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 font-mono"
            >
              {eventTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {events.length === 0 ? (
        <div className="py-8 text-center text-zinc-500 font-mono text-xs">
          No trace events recorded yet.
        </div>
      ) : (
        <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-zinc-800">
          {filteredEvents.map((event) => {
            const isExpanded = expandedSeq === event.sequence;
            const hasPayload = Object.keys(event.payload || {}).length > 0;

            return (
              <div key={event.sequence} className="relative group">
                <div
                  className={`absolute -left-6 top-1.5 w-2.5 h-2.5 rounded-full border-2 border-zinc-950 ${
                    event.type.includes('error') || event.type.includes('failed')
                      ? 'bg-red-400 ring-2 ring-red-950'
                      : event.type.includes('finished') || event.type.includes('validated')
                      ? 'bg-emerald-400 ring-2 ring-emerald-950'
                      : 'bg-indigo-400'
                  }`}
                />

                <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800/60 hover:border-zinc-700/80 transition-all">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono text-zinc-500">#{event.sequence}</span>
                      <span className={`text-xs font-mono font-medium px-2 py-0.5 rounded border ${getEventBadge(event.type)}`}>
                        {event.type}
                      </span>
                      {event.payload?.recordId ? (
                        <span className="text-xs font-mono text-zinc-400 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
                          {String(event.payload.recordId)}
                        </span>
                      ) : null}
                      {event.payload?.from && event.payload?.to ? (
                        <span className="text-xs font-mono text-zinc-400">
                          {String(event.payload.from)} → <span className="text-zinc-200 font-semibold">{String(event.payload.to)}</span>
                        </span>
                      ) : null}
                      {event.payload?.category ? (
                        <span className="text-xs font-mono text-red-400 font-semibold">
                          [{String(event.payload.category)}]
                        </span>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-2">
                      <time className="text-[11px] font-mono text-zinc-500">
                        {formatTimestamp(event.timestamp)}
                      </time>
                      {hasPayload && (
                        <button
                          onClick={() => toggleExpand(event.sequence)}
                          className="text-[11px] text-zinc-400 hover:text-zinc-200 underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500 font-mono px-1 rounded"
                        >
                          {isExpanded ? 'Hide Payload' : 'View Payload'}
                        </button>
                      )}
                    </div>
                  </div>

                  {event.payload?.message ? (
                    <p className="mt-1.5 text-xs text-red-300 font-mono bg-red-950/30 p-2 rounded border border-red-900/40">
                      {String(event.payload.message)}
                    </p>
                  ) : null}

                  {isExpanded && hasPayload && (
                    <pre className="mt-2.5 p-3 rounded bg-zinc-900/90 border border-zinc-800 text-[11px] font-mono text-zinc-300 overflow-x-auto max-h-64">
                      {JSON.stringify(event.payload, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
