import type { RunStatus } from '@agentforge/shared';

export interface StatusMeta {
  status: RunStatus;
  label: string;
  terminal: boolean;
  meaning: string;
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
  dotColor: string;
  icon: 'check' | 'alert-triangle' | 'x-circle' | 'clock' | 'loader' | 'shield-alert' | 'slash';
}

export const STATUS_META: Record<RunStatus, StatusMeta> = {
  queued: {
    status: 'queued',
    label: 'Queued',
    terminal: false,
    meaning: 'Persisted, waiting to start',
    badgeBg: 'bg-zinc-800/80',
    badgeBorder: 'border-zinc-700',
    badgeText: 'text-zinc-300',
    dotColor: 'bg-zinc-400',
    icon: 'clock',
  },
  running: {
    status: 'running',
    label: 'Running',
    terminal: false,
    meaning: 'Executing stages',
    badgeBg: 'bg-blue-950/60',
    badgeBorder: 'border-blue-600/60',
    badgeText: 'text-blue-300',
    dotColor: 'bg-blue-400 animate-pulse',
    icon: 'loader',
  },
  waiting_for_provider: {
    status: 'waiting_for_provider',
    label: 'Waiting (provider)',
    terminal: false,
    meaning: 'Backing off after transient provider error',
    badgeBg: 'bg-amber-950/60',
    badgeBorder: 'border-amber-600/60',
    badgeText: 'text-amber-300',
    dotColor: 'bg-amber-400 animate-ping',
    icon: 'clock',
  },
  repairing: {
    status: 'repairing',
    label: 'Repairing',
    terminal: false,
    meaning: 'T3 repair attempt in progress',
    badgeBg: 'bg-purple-950/60',
    badgeBorder: 'border-purple-600/60',
    badgeText: 'text-purple-300',
    dotColor: 'bg-purple-400 animate-pulse',
    icon: 'loader',
  },
  cancelling: {
    status: 'cancelling',
    label: 'Cancelling',
    terminal: false,
    meaning: 'Cancel accepted, stopping',
    badgeBg: 'bg-rose-950/60',
    badgeBorder: 'border-rose-600/60',
    badgeText: 'text-rose-300',
    dotColor: 'bg-rose-400 animate-pulse',
    icon: 'slash',
  },
  succeeded: {
    status: 'succeeded',
    label: 'Succeeded',
    terminal: true,
    meaning: 'All required checks ran and passed; output written and validated',
    badgeBg: 'bg-emerald-950/60',
    badgeBorder: 'border-emerald-600/60',
    badgeText: 'text-emerald-300',
    dotColor: 'bg-emerald-400',
    icon: 'check',
  },
  succeeded_with_warnings: {
    status: 'succeeded_with_warnings',
    label: 'Succeeded with warnings',
    terminal: true,
    meaning: 'Required checks passed; only non-blocking findings remain; contract allows warnings',
    badgeBg: 'bg-lime-950/60',
    badgeBorder: 'border-lime-600/60',
    badgeText: 'text-lime-300',
    dotColor: 'bg-lime-400',
    icon: 'alert-triangle',
  },
  failed: {
    status: 'failed',
    label: 'Failed',
    terminal: true,
    meaning: 'Task ran but a required criterion stayed unmet after allowed recovery',
    badgeBg: 'bg-red-950/60',
    badgeBorder: 'border-red-600/60',
    badgeText: 'text-red-300',
    dotColor: 'bg-red-400',
    icon: 'x-circle',
  },
  blocked: {
    status: 'blocked',
    label: 'Blocked',
    terminal: true,
    meaning: 'Could not complete due to provider, credentials, tool, budget, or infrastructure',
    badgeBg: 'bg-orange-950/60',
    badgeBorder: 'border-orange-600/60',
    badgeText: 'text-orange-300',
    dotColor: 'bg-orange-400',
    icon: 'shield-alert',
  },
  cancelled: {
    status: 'cancelled',
    label: 'Cancelled',
    terminal: true,
    meaning: 'Cancellation accepted; no more work scheduled',
    badgeBg: 'bg-zinc-900/80',
    badgeBorder: 'border-zinc-700',
    badgeText: 'text-zinc-400',
    dotColor: 'bg-zinc-500',
    icon: 'slash',
  },
  timed_out: {
    status: 'timed_out',
    label: 'Timed out',
    terminal: true,
    meaning: 'Configured overall deadline exceeded',
    badgeBg: 'bg-amber-950/70',
    badgeBorder: 'border-amber-600/70',
    badgeText: 'text-amber-300',
    dotColor: 'bg-amber-400',
    icon: 'clock',
  },
};

export function getStatusMeta(status: string): StatusMeta {
  const meta = STATUS_META[status as RunStatus];
  if (!meta) {
    return {
      status: 'failed' as RunStatus,
      label: status || 'Unknown',
      terminal: true,
      meaning: 'Unrecognized run state',
      badgeBg: 'bg-zinc-900/80',
      badgeBorder: 'border-zinc-700',
      badgeText: 'text-zinc-400',
      dotColor: 'bg-zinc-500',
      icon: 'alert-triangle',
    };
  }
  return meta;
}
