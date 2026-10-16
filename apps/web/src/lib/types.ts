import type { RunStatus, ErrorCategory } from '@agentforge/shared';
import type { RunRecord } from '@agentforge/schemas';

export interface ArtifactInfo {
  filename: string;
  sizeBytes: number;
  updatedAt: string;
  downloadUrl: string;
  contentType: string;
}

export interface RunSummary {
  id: string;
  status: RunStatus;
  adapterId: string;
  inputHash: string;
  codeVersion: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  errorCategory?: ErrorCategory;
  errorMessage?: string;
  metrics?: {
    totalRecords?: number;
    succeededRecords?: number;
    failedRecords?: number;
    blockedRecords?: number;
    totalDurationMs?: number;
    llmCalls?: number;
  };
}

export interface RunDetails extends RunSummary {
  configSnapshot?: Record<string, unknown>;
  outputSnapshot?: unknown;
  inputSnapshot?: unknown;
  reportMarkdown?: string;
  artifacts: ArtifactInfo[];
  rawRunRecord: RunRecord;
}
