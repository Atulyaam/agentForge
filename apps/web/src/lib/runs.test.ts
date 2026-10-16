import { describe, it, expect } from 'vitest';
import {
  listRuns,
  getRunDetails,
  getRunEvents,
  resolveArtifactPath,
  validateRunId,
  validateArtifactName,
} from './runs';

describe('Runs Loader (T1-lite)', () => {
  describe('Security validation', () => {
    it('rejects path traversal in runId', () => {
      expect(validateRunId('../evil')).toBe(false);
      expect(validateRunId('..\\evil')).toBe(false);
      expect(validateRunId('/etc/passwd')).toBe(false);
      expect(validateRunId('run;rm -rf')).toBe(false);
      expect(validateRunId('')).toBe(false);
    });

    it('accepts valid runId formats', () => {
      expect(validateRunId('demo-run-001')).toBe(true);
      expect(validateRunId('run_abc123_001')).toBe(true);
      expect(validateRunId('run-123-456')).toBe(true);
    });

    it('rejects path traversal and unsafe characters in artifact names', () => {
      expect(validateArtifactName('../../etc/passwd')).toBe(false);
      expect(validateArtifactName('..\\config.json')).toBe(false);
      expect(validateArtifactName('sub/run.json')).toBe(false);
      expect(validateArtifactName('')).toBe(false);
      expect(validateArtifactName('.env')).toBe(false);
    });

    it('accepts allowed artifact names', () => {
      expect(validateArtifactName('run.json')).toBe(true);
      expect(validateArtifactName('trace.jsonl')).toBe(true);
      expect(validateArtifactName('metrics.json')).toBe(true);
      expect(validateArtifactName('output.json')).toBe(true);
      expect(validateArtifactName('input.json')).toBe(true);
      expect(validateArtifactName('config.snapshot.json')).toBe(true);
      expect(validateArtifactName('report.md')).toBe(true);
    });
  });

  describe('listRuns()', () => {
    it('lists existing runs from runs/ directory', async () => {
      const runs = await listRuns();
      expect(Array.isArray(runs)).toBe(true);
      expect(runs.length).toBeGreaterThanOrEqual(1);

      const demoRun = runs.find((r) => r.id === 'demo-run-001');
      expect(demoRun).toBeDefined();
      expect(demoRun?.status).toBe('succeeded');
      expect(demoRun?.adapterId).toBe('demo-sentiment');
    });
  });

  describe('getRunDetails()', () => {
    it('returns full run details for a valid run', async () => {
      const details = await getRunDetails('demo-run-001');
      expect(details).not.toBeNull();
      expect(details?.id).toBe('demo-run-001');
      expect(details?.status).toBe('succeeded');
      expect(details?.adapterId).toBe('demo-sentiment');
      expect(details?.configSnapshot).toBeDefined();
      expect(details?.metrics).toBeDefined();
      expect(details?.artifacts.length).toBeGreaterThanOrEqual(1);
    });

    it('returns null for non-existent run', async () => {
      const details = await getRunDetails('non-existent-run-xyz');
      expect(details).toBeNull();
    });

    it('returns null for malicious runId', async () => {
      const details = await getRunDetails('../../../etc/passwd');
      expect(details).toBeNull();
    });
  });

  describe('getRunEvents()', () => {
    it('returns parsed events from trace.jsonl', async () => {
      const events = await getRunEvents('demo-run-001');
      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0].sequence).toBe(0);
      expect(events[0].runId).toBe('demo-run-001');
    });

    it('supports sequence filtering with afterSequence', async () => {
      const allEvents = await getRunEvents('demo-run-001');
      if (allEvents.length > 1) {
        const afterSeq = allEvents[0].sequence;
        const subsequentEvents = await getRunEvents('demo-run-001', afterSeq);
        expect(subsequentEvents.every((e) => e.sequence > afterSeq)).toBe(true);
      }
    });

    it('returns empty array for invalid runId', async () => {
      const events = await getRunEvents('../evil');
      expect(events).toEqual([]);
    });
  });

  describe('resolveArtifactPath() (FR-010)', () => {
    it('resolves valid artifact path for demo run', () => {
      const artifact = resolveArtifactPath('demo-run-001', 'run.json');
      expect(artifact).not.toBeNull();
      expect(artifact?.contentType).toBe('application/json');
      expect(artifact?.sizeBytes).toBeGreaterThan(0);
    });

    it('blocks directory traversal attempts', () => {
      const result = resolveArtifactPath('demo-run-001', '../../../package.json');
      expect(result).toBeNull();
    });

    it('returns null for non-existent artifact', () => {
      const result = resolveArtifactPath('demo-run-001', 'non-existent-file.json');
      expect(result).toBeNull();
    });
  });
});
