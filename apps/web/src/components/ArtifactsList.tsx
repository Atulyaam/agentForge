import React from 'react';
import type { ArtifactInfo } from '@/lib/types';

interface ArtifactsListProps {
  artifacts: ArtifactInfo[];
  runId: string;
  className?: string;
}

export function ArtifactsList({ artifacts, runId, className = '' }: ArtifactsListProps) {
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  return (
    <div className={`p-5 rounded-xl bg-zinc-900/70 border border-zinc-800/80 backdrop-blur-sm ${className}`}>
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-800/60">
        <h3 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider flex items-center gap-2">
          <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          Run-Scoped Artifacts (FR-UI-010)
        </h3>
        <span className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
          {artifacts.length} files
        </span>
      </div>

      {artifacts.length === 0 ? (
        <p className="text-xs text-zinc-500 font-mono text-center py-4">No artifacts available for this run</p>
      ) : (
        <div className="divide-y divide-zinc-800/60 rounded-lg border border-zinc-800 bg-zinc-950/60">
          {artifacts.map((artifact) => (
            <div
              key={artifact.filename}
              className="flex items-center justify-between p-3.5 hover:bg-zinc-900/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded bg-zinc-900 border border-zinc-800 text-indigo-400">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-medium text-zinc-200">
                      {artifact.filename}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">
                      {artifact.contentType}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-zinc-500 block mt-0.5">
                    {formatBytes(artifact.sizeBytes)}
                  </span>
                </div>
              </div>

              <a
                href={artifact.downloadUrl}
                download={artifact.filename}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium rounded-md bg-indigo-600 hover:bg-indigo-500 text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
