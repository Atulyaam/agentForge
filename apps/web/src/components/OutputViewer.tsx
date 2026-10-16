'use client';

import React, { useState } from 'react';

interface OutputViewerProps {
  output: unknown;
  runStatus: string;
  className?: string;
}

export function OutputViewer({ output, runStatus, className = '' }: OutputViewerProps) {
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<'formatted' | 'raw'>('formatted');

  if (output === undefined || output === null) {
    return (
      <div className={`p-6 rounded-xl bg-zinc-900/70 border border-zinc-800/80 backdrop-blur-sm ${className}`}>
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-4 h-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider">
            Final Output & Evidence
          </h3>
        </div>
        <div className="p-8 text-center rounded-lg bg-zinc-950/50 border border-zinc-800/50">
          <p className="text-xs text-zinc-400 font-mono">
            {runStatus === 'running' || runStatus === 'queued'
              ? 'Run is still in progress. Output will appear here upon completion.'
              : 'No output was generated for this run (run ended before output stage).'}
          </p>
        </div>
      </div>
    );
  }

  const outputString = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
  const isArray = Array.isArray(output);

  const handleCopy = () => {
    navigator.clipboard.writeText(outputString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`p-5 rounded-xl bg-zinc-900/70 border border-zinc-800/80 backdrop-blur-sm ${className}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-zinc-800/60">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider flex items-center gap-2">
            <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Validated Run Output
          </h3>
          <span className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-700/60 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Schema Validated
          </span>
          {isArray && (
            <span className="text-xs font-mono text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded border border-zinc-700">
              {output.length} records
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-zinc-700 p-0.5 bg-zinc-950">
            <button
              onClick={() => setViewMode('formatted')}
              className={`text-xs px-2.5 py-1 rounded font-medium transition-colors ${
                viewMode === 'formatted'
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {isArray ? 'Table View' : 'Formatted'}
            </button>
            <button
              onClick={() => setViewMode('raw')}
              className={`text-xs px-2.5 py-1 rounded font-medium transition-colors ${
                viewMode === 'raw'
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Raw JSON
            </button>
          </div>

          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1 text-xs font-mono px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {copied ? (
              <>
                <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Copied
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy
              </>
            )}
          </button>
        </div>
      </div>

      {viewMode === 'formatted' && isArray ? (
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-left text-xs font-mono divide-y divide-zinc-800">
            <thead className="bg-zinc-950/80 text-zinc-400">
              <tr>
                {Object.keys(output[0] || {}).map((key) => (
                  <th key={key} className="px-3.5 py-2.5 font-semibold uppercase tracking-wider">
                    {key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 bg-zinc-950/40 text-zinc-300">
              {output.map((row: any, idx: number) => (
                <tr key={idx} className="hover:bg-zinc-900/40 transition-colors">
                  {Object.keys(output[0] || {}).map((key) => {
                    const val = row[key];
                    const valStr = typeof val === 'object' ? JSON.stringify(val) : String(val);
                    return (
                      <td key={key} className="px-3.5 py-2.5 whitespace-nowrap">
                        {key === 'sentiment' ? (
                          <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                            val === 'positive' ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60' :
                            val === 'negative' ? 'bg-red-950/80 text-red-300 border border-red-800/60' :
                            'bg-zinc-800 text-zinc-300 border border-zinc-700'
                          }`}>
                            {valStr}
                          </span>
                        ) : key === 'confidence' ? (
                          <span className="text-zinc-200 font-semibold">{valStr}</span>
                        ) : (
                          <span className="text-zinc-400 truncate max-w-xs block" title={valStr}>
                            {valStr}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <pre className="p-4 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono text-zinc-300 overflow-x-auto max-h-96">
          {outputString}
        </pre>
      )}
    </div>
  );
}
