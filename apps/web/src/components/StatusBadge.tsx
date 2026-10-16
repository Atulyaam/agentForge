import React from 'react';
import { getStatusMeta } from '@/lib/status-meta';

interface StatusBadgeProps {
  status: string;
  className?: string;
  showMeaning?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function StatusBadge({
  status,
  className = '',
  showMeaning = false,
  size = 'md',
}: StatusBadgeProps) {
  const meta = getStatusMeta(status);

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5 gap-1.5',
    md: 'text-xs px-2.5 py-1 gap-2',
    lg: 'text-sm px-3 py-1.5 gap-2.5',
  }[size];

  const dotSizes = {
    sm: 'w-1.5 h-1.5',
    md: 'w-2 h-2',
    lg: 'w-2.5 h-2.5',
  }[size];

  // Render SVG icons for accessible non-color status indication (FR-UI-008)
  const renderIcon = () => {
    switch (meta.icon) {
      case 'check':
        return (
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'x-circle':
        return (
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <circle cx="12" cy="12" r="9" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 9l-6 6M9 9l6 6" />
          </svg>
        );
      case 'shield-alert':
        return (
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        );
      case 'loader':
        return (
          <svg className="w-3.5 h-3.5 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        );
      case 'slash':
        return (
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="9" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.93 4.93l14.14 14.14" />
          </svg>
        );
      case 'clock':
      default:
        return (
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="9" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
          </svg>
        );
    }
  };

  return (
    <div className="inline-flex items-center gap-1.5">
      <span
        title={`${meta.label}: ${meta.meaning}`}
        aria-label={`Status: ${meta.label} (${meta.meaning})`}
        className={`inline-flex items-center font-medium rounded-full border ${meta.badgeBg} ${meta.badgeBorder} ${meta.badgeText} ${sizeClasses} ${className}`}
      >
        <span className={`rounded-full shrink-0 ${meta.dotColor} ${dotSizes}`} />
        {renderIcon()}
        <span>{meta.label}</span>
      </span>
      {showMeaning && (
        <span className="text-xs text-zinc-400 hidden sm:inline-block">({meta.meaning})</span>
      )}
    </div>
  );
}
