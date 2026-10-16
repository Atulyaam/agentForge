import React from 'react';

interface ConfigSnapshotProps {
  config?: Record<string, unknown>;
  inputHash?: string;
  codeVersion?: string;
  className?: string;
}

export function ConfigSnapshot({
  config,
  inputHash,
  codeVersion,
  className = '',
}: ConfigSnapshotProps) {
  if (!config) {
    return (
      <div className={`p-5 rounded-xl bg-zinc-900/70 border border-zinc-800/80 backdrop-blur-sm ${className}`}>
        <h3 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider mb-2">
          Configuration Snapshot
        </h3>
        <p className="text-xs text-zinc-500 font-mono">No configuration snapshot recorded</p>
      </div>
    );
  }

  return (
    <div className={`p-5 rounded-xl bg-zinc-900/70 border border-zinc-800/80 backdrop-blur-sm ${className}`}>
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-800/60">
        <h3 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider flex items-center gap-2">
          <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Configuration Snapshot
        </h3>
        <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-amber-950/40 text-amber-300 border border-amber-800/40">
          Secrets Stripped (FR-001)
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 font-mono text-xs">
        {inputHash && (
          <div className="p-2.5 rounded bg-zinc-950/60 border border-zinc-800/60">
            <span className="text-zinc-500 block text-[10px] uppercase">Input Hash</span>
            <span className="text-zinc-200 truncate block mt-0.5" title={inputHash}>
              {inputHash}
            </span>
          </div>
        )}

        {codeVersion && (
          <div className="p-2.5 rounded bg-zinc-950/60 border border-zinc-800/60">
            <span className="text-zinc-500 block text-[10px] uppercase">Code Version (Git)</span>
            <span className="text-zinc-200 block mt-0.5">{codeVersion}</span>
          </div>
        )}

        {Object.entries(config).map(([key, val]) => (
          <div key={key} className="p-2.5 rounded bg-zinc-950/60 border border-zinc-800/60">
            <span className="text-zinc-500 block text-[10px] uppercase truncate">{key}</span>
            <span className="text-zinc-200 block mt-0.5 truncate" title={String(val)}>
              {typeof val === 'boolean' ? (val ? 'true' : 'false') : String(val)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
