import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RunEvent } from '@agentforge/shared';
import { RunRecordSchema, RunEventSchema } from '@agentforge/schemas';
import type { RunSummary, RunDetails, ArtifactInfo } from './types';

// Allowed filenames for artifacts (FR-010: strict run-scoped artifact download)
export const ALLOWED_ARTIFACT_NAMES = new Set([
  'run.json',
  'input.json',
  'output.json',
  'config.snapshot.json',
  'metrics.json',
  'trace.jsonl',
  'checkpoint.jsonl',
  'report.md',
]);

/**
 * Determine the root `runs/` directory.
 * Falls back safely to checking process.cwd(), then upward traversal to find `runs/`.
 */
export function getRunsDirectory(): string {
  if (process.env.RUNS_DIR) {
    return path.resolve(process.env.RUNS_DIR);
  }

  // Check CWD/runs
  const cwdRuns = path.resolve(process.cwd(), 'runs');
  if (fs.existsSync(cwdRuns)) {
    return cwdRuns;
  }

  // In next.js app inside apps/web, root is ../../runs
  const monorepoRuns = path.resolve(process.cwd(), '../../runs');
  if (fs.existsSync(monorepoRuns)) {
    return monorepoRuns;
  }

  // Also check ../runs (if cwd is apps/web/...)
  const parentRuns = path.resolve(process.cwd(), '../runs');
  if (fs.existsSync(parentRuns)) {
    return parentRuns;
  }

  return cwdRuns; // Default
}

/**
 * Validates that runId is safe (no path traversal, alphanumeric + hyphens/underscores).
 */
export function validateRunId(runId: string): boolean {
  if (!runId || typeof runId !== 'string') return false;
  return /^[a-zA-Z0-9_\-]+$/.test(runId);
}

/**
 * Validates that filename is safe (no path traversal, allowlisted or safe name).
 */
export function validateArtifactName(filename: string): boolean {
  if (!filename || typeof filename !== 'string') return false;
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return false;
  }
  if (ALLOWED_ARTIFACT_NAMES.has(filename)) return true;
  // Allow safe json, jsonl, md, txt, csv filenames
  return /^[a-zA-Z0-9_\-]+\.(json|jsonl|md|txt|csv)$/.test(filename);
}

/**
 * List all runs in the runs directory.
 * Returns sorted by createdAt descending.
 */
export async function listRuns(): Promise<RunSummary[]> {
  const runsDir = getRunsDirectory();
  if (!fs.existsSync(runsDir)) {
    return [];
  }

  const entries = fs.readdirSync(runsDir, { withFileTypes: true });
  const summaries: RunSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runId = entry.name;
    if (!validateRunId(runId)) continue;

    const runJsonPath = path.join(runsDir, runId, 'run.json');
    if (!fs.existsSync(runJsonPath)) continue;

    try {
      const rawContent = fs.readFileSync(runJsonPath, 'utf-8');
      const parsedJson = JSON.parse(rawContent);
      const parseResult = RunRecordSchema.safeParse(parsedJson);

      let metrics: RunSummary['metrics'] = undefined;
      const metricsPath = path.join(runsDir, runId, 'metrics.json');
      if (fs.existsSync(metricsPath)) {
        try {
          metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'));
        } catch {
          // ignore corrupted metrics file
        }
      }

      if (parseResult.success) {
        const record = parseResult.data;
        let durationMs: number | undefined = undefined;
        if (record.finishedAt && record.startedAt) {
          durationMs = new Date(record.finishedAt).getTime() - new Date(record.startedAt).getTime();
        } else if (metrics?.totalDurationMs) {
          durationMs = metrics.totalDurationMs;
        }

        summaries.push({
          id: record.id,
          status: record.status,
          adapterId: record.adapterId,
          inputHash: record.inputHash,
          codeVersion: record.codeVersion,
          createdAt: record.createdAt,
          startedAt: record.startedAt,
          finishedAt: record.finishedAt,
          durationMs,
          errorCategory: record.errorCategory,
          errorMessage: record.errorMessage,
          metrics,
        });
      } else {
        // Degraded state: run.json exists but is partially malformed
        summaries.push({
          id: runId,
          status: parsedJson.status ?? 'failed',
          adapterId: parsedJson.adapterId ?? 'unknown',
          inputHash: parsedJson.inputHash ?? 'unknown',
          codeVersion: parsedJson.codeVersion ?? 'unknown',
          createdAt: parsedJson.createdAt ?? new Date().toISOString(),
          startedAt: parsedJson.startedAt,
          finishedAt: parsedJson.finishedAt,
          errorCategory: parsedJson.errorCategory,
          errorMessage: parsedJson.errorMessage,
          metrics,
        });
      }
    } catch {
      // Corrupt or unreadable run.json — skip entry
    }
  }

  // Sort descending by createdAt
  summaries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return summaries;
}

/**
 * Get detailed information for a specific run.
 * Returns null if the run does not exist.
 */
export async function getRunDetails(runId: string): Promise<RunDetails | null> {
  if (!validateRunId(runId)) {
    return null;
  }

  const runsDir = getRunsDirectory();
  const runDir = path.join(runsDir, runId);
  const runJsonPath = path.join(runDir, 'run.json');

  if (!fs.existsSync(runDir) || !fs.existsSync(runJsonPath)) {
    return null;
  }

  try {
    const rawContent = fs.readFileSync(runJsonPath, 'utf-8');
    const parsedJson = JSON.parse(rawContent);
    const parseResult = RunRecordSchema.safeParse(parsedJson);

    const record = parseResult.success
      ? parseResult.data
      : {
          id: runId,
          status: parsedJson.status ?? 'failed',
          adapterId: parsedJson.adapterId ?? 'unknown',
          inputHash: parsedJson.inputHash ?? 'unknown',
          configSnapshot: parsedJson.configSnapshot ?? {},
          codeVersion: parsedJson.codeVersion ?? 'unknown',
          createdAt: parsedJson.createdAt ?? new Date().toISOString(),
          startedAt: parsedJson.startedAt,
          finishedAt: parsedJson.finishedAt,
          errorCategory: parsedJson.errorCategory,
          errorMessage: parsedJson.errorMessage,
        };

    // Read metrics
    let metrics: RunSummary['metrics'] = undefined;
    const metricsPath = path.join(runDir, 'metrics.json');
    if (fs.existsSync(metricsPath)) {
      try {
        metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'));
      } catch {
        // ignore
      }
    }

    // Read output
    let outputSnapshot: unknown = undefined;
    const outputPath = path.join(runDir, 'output.json');
    if (fs.existsSync(outputPath)) {
      try {
        outputSnapshot = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      } catch {
        outputSnapshot = fs.readFileSync(outputPath, 'utf-8');
      }
    }

    // Read input
    let inputSnapshot: unknown = undefined;
    const inputPath = path.join(runDir, 'input.json');
    if (fs.existsSync(inputPath)) {
      try {
        inputSnapshot = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
      } catch {
        inputSnapshot = fs.readFileSync(inputPath, 'utf-8');
      }
    }

    // Read config snapshot
    let configSnapshot: Record<string, unknown> | undefined = record.configSnapshot;
    const configPath = path.join(runDir, 'config.snapshot.json');
    if (fs.existsSync(configPath)) {
      try {
        configSnapshot = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      } catch {
        // fallback to record.configSnapshot
      }
    }

    // Read report if present
    let reportMarkdown: string | undefined = undefined;
    const reportPath = path.join(runDir, 'report.md');
    if (fs.existsSync(reportPath)) {
      reportMarkdown = fs.readFileSync(reportPath, 'utf-8');
    }

    // List artifacts
    const fileEntries = fs.readdirSync(runDir, { withFileTypes: true });
    const artifacts: ArtifactInfo[] = [];

    for (const file of fileEntries) {
      if (!file.isFile()) continue;
      const stat = fs.statSync(path.join(runDir, file.name));
      const ext = path.extname(file.name).toLowerCase();
      let contentType = 'text/plain';
      if (ext === '.json') contentType = 'application/json';
      else if (ext === '.jsonl') contentType = 'application/x-ndjson';
      else if (ext === '.md') contentType = 'text/markdown';

      artifacts.push({
        filename: file.name,
        sizeBytes: stat.size,
        updatedAt: stat.mtime.toISOString(),
        downloadUrl: `/api/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(file.name)}`,
        contentType,
      });
    }

    let durationMs: number | undefined = undefined;
    if (record.finishedAt && record.startedAt) {
      durationMs = new Date(record.finishedAt).getTime() - new Date(record.startedAt).getTime();
    } else if (metrics?.totalDurationMs) {
      durationMs = metrics.totalDurationMs;
    }

    return {
      id: record.id,
      status: record.status,
      adapterId: record.adapterId,
      inputHash: record.inputHash,
      codeVersion: record.codeVersion,
      createdAt: record.createdAt,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      durationMs,
      errorCategory: record.errorCategory,
      errorMessage: record.errorMessage,
      metrics,
      configSnapshot,
      outputSnapshot,
      inputSnapshot,
      reportMarkdown,
      artifacts,
      rawRunRecord: record as any,
    };
  } catch {
    return null;
  }
}

/**
 * Get ordered execution events from trace.jsonl.
 * Supports polling with `afterSequence`.
 */
export async function getRunEvents(runId: string, afterSequence: number = -1): Promise<RunEvent[]> {
  if (!validateRunId(runId)) {
    return [];
  }

  const runsDir = getRunsDirectory();
  const tracePath = path.join(runsDir, runId, 'trace.jsonl');

  if (!fs.existsSync(tracePath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(tracePath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    const events: RunEvent[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const eventResult = RunEventSchema.safeParse(parsed);
        if (eventResult.success) {
          const event = eventResult.data;
          if (event.sequence > afterSequence) {
            events.push({
              runId: event.runId,
              sequence: event.sequence,
              type: event.type,
              payload: event.payload as Record<string, unknown>,
              timestamp: event.timestamp,
            });
          }
        }
      } catch {
        // Skip malformed line
      }
    }

    return events;
  } catch {
    return [];
  }
}

/**
 * Safe artifact resolution.
 * Asserts that the requested file is inside `runs/<runId>/`.
 */
export function resolveArtifactPath(runId: string, filename: string): {
  filePath: string;
  contentType: string;
  sizeBytes: number;
} | null {
  if (!validateRunId(runId) || !validateArtifactName(filename)) {
    return null;
  }

  const runsDir = getRunsDirectory();
  const runDir = path.resolve(runsDir, runId);
  const targetPath = path.resolve(runDir, filename);

  // Security check: ensure targetPath is strictly inside runDir
  if (!targetPath.startsWith(runDir + path.sep)) {
    return null;
  }

  if (!fs.existsSync(targetPath)) {
    return null;
  }

  const stat = fs.statSync(targetPath);
  if (!stat.isFile()) {
    return null;
  }

  const ext = path.extname(filename).toLowerCase();
  let contentType = 'application/octet-stream';
  if (ext === '.json') contentType = 'application/json';
  else if (ext === '.jsonl') contentType = 'application/x-ndjson';
  else if (ext === '.md') contentType = 'text/markdown; charset=utf-8';
  else if (ext === '.txt') contentType = 'text/plain; charset=utf-8';
  else if (ext === '.csv') contentType = 'text/csv; charset=utf-8';

  return {
    filePath: targetPath,
    contentType,
    sizeBytes: stat.size,
  };
}
