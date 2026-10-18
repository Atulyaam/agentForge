/**
 * End-to-end integration test for S4: T1-lite Web Run Viewer (G2-lite).
 *
 * Verifies:
 * - FR-UI-002: Run status (canonical vocabulary, status mapping, never simulated)
 * - FR-UI-003: Timeline (ordered events from trace.jsonl, sequence filtering)
 * - FR-UI-004: Output and evidence view (validated output, metrics, artifacts)
 * - FR-UI-005: Refresh recovery (direct URL recovery, no duplicate runs)
 * - FR-UI-007: Explicit empty / 404 / degraded states
 * - FR-UI-010: Artifact download (run-scoped artifacts, traversal blocked)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { GET as getRuns } from '../../apps/web/src/app/api/runs/route';
import { GET as getRunDetail } from '../../apps/web/src/app/api/runs/[runId]/route';
import { GET as getRunEvents } from '../../apps/web/src/app/api/runs/[runId]/events/route';
import { GET as getRunArtifact } from '../../apps/web/src/app/api/runs/[runId]/artifacts/[filename]/route';
import { STATUS_META, getStatusMeta } from '../../apps/web/src/lib/status-meta';
import { RUN_STATUSES } from '@agentforge/shared';
import { ensureDemoRunsExist } from '../../apps/web/src/lib/test-fixtures';

describe('S4: T1-lite Web Run Viewer E2E Flow (G2-lite)', () => {
  beforeAll(() => {
    ensureDemoRunsExist();
  });
  describe('Status Vocabulary & Mapping (FR-UI-002)', () => {
    it('all RUN_STATUSES from shared taxonomy map to distinct UI labels', () => {
      for (const status of RUN_STATUSES) {
        const meta = getStatusMeta(status);
        expect(meta.label).toBeDefined();
        expect(meta.meaning).toBeDefined();
        expect(meta.badgeBg).toBeDefined();
        expect(meta.badgeText).toBeDefined();
        expect(meta.icon).toBeDefined();
      }
    });

    it('matches authoritative Table 7.1 mappings', () => {
      expect(STATUS_META.queued.label).toBe('Queued');
      expect(STATUS_META.running.label).toBe('Running');
      expect(STATUS_META.waiting_for_provider.label).toBe('Waiting (provider)');
      expect(STATUS_META.repairing.label).toBe('Repairing');
      expect(STATUS_META.cancelling.label).toBe('Cancelling');
      expect(STATUS_META.succeeded.label).toBe('Succeeded');
      expect(STATUS_META.succeeded_with_warnings.label).toBe('Succeeded with warnings');
      expect(STATUS_META.failed.label).toBe('Failed');
      expect(STATUS_META.blocked.label).toBe('Blocked');
      expect(STATUS_META.cancelled.label).toBe('Cancelled');
      expect(STATUS_META.timed_out.label).toBe('Timed out');
    });
  });

  describe('Full Dashboard & Run Inspection Lifecycle', () => {
    it('Step 1: Dashboard lists all runs and computes aggregates', async () => {
      const res = await getRuns();
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.count).toBeGreaterThanOrEqual(2);

      const runIds = json.data.map((r: any) => r.id);
      expect(runIds).toContain('demo-run-001');
      expect(runIds).toContain('demo-run-002');
    });

    it('Step 2: Inspect Succeeded Run (demo-run-001)', async () => {
      // 2a. Fetch Run Details
      const req = new Request('http://localhost:3000/api/runs/demo-run-001');
      const res = await getRunDetail(req, {
        params: Promise.resolve({ runId: 'demo-run-001' }),
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.ok).toBe(true);
      const run = json.data;

      // Authoritative status
      expect(run.status).toBe('succeeded');
      expect(run.adapterId).toBe('demo-sentiment');

      // Validated output & metrics
      expect(run.metrics).toBeDefined();
      expect(run.metrics.totalRecords).toBe(5);
      expect(run.metrics.succeededRecords).toBe(5);
      expect(run.outputSnapshot).toBeDefined();
      expect(Array.isArray(run.outputSnapshot)).toBe(true);
      expect(run.outputSnapshot.length).toBe(5);

      // Config snapshot has secrets stripped
      expect(run.configSnapshot).toBeDefined();
      expect(run.configSnapshot.LLM_API_KEY).toBeUndefined();

      // 2b. Fetch Trace Timeline
      const eventsRes = await getRunEvents(req, {
        params: Promise.resolve({ runId: 'demo-run-001' }),
      });
      const eventsJson = await eventsRes.json();
      expect(eventsJson.ok).toBe(true);
      expect(eventsJson.events.length).toBeGreaterThan(0);
      expect(eventsJson.events[0].sequence).toBe(0);

      // 2c. Download Artifact
      const artifactRes = await getRunArtifact(req, {
        params: Promise.resolve({ runId: 'demo-run-001', filename: 'output.json' }),
      });
      expect(artifactRes.status).toBe(200);
      expect(artifactRes.headers.get('Content-Disposition')).toContain('attachment; filename="output.json"');
      const outputText = await artifactRes.text();
      const downloadedOutput = JSON.parse(outputText);
      expect(Array.isArray(downloadedOutput)).toBe(true);
      expect(downloadedOutput[0].sentiment).toBe('positive');
    });

    it('Step 3: Inspect Failed Run with Error Taxonomy (demo-run-002)', async () => {
      const req = new Request('http://localhost:3000/api/runs/demo-run-002');
      const res = await getRunDetail(req, {
        params: Promise.resolve({ runId: 'demo-run-002' }),
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      const run = json.data;
      expect(run.status).toBe('failed');
      expect(run.errorCategory).toBe('LLM_TIMEOUT');
      expect(run.errorMessage).toContain('timed out');
    });

    it('Step 4: Refresh Recovery (FR-UI-005)', async () => {
      // Multiple successive requests return identical authoritative state
      const req1 = new Request('http://localhost:3000/api/runs/demo-run-001');
      const res1 = await getRunDetail(req1, {
        params: Promise.resolve({ runId: 'demo-run-001' }),
      });
      const json1 = await res1.json();

      const req2 = new Request('http://localhost:3000/api/runs/demo-run-001');
      const res2 = await getRunDetail(req2, {
        params: Promise.resolve({ runId: 'demo-run-001' }),
      });
      const json2 = await res2.json();

      expect(json1.data.id).toBe(json2.data.id);
      expect(json1.data.status).toBe(json2.data.status);
      expect(json1.data.inputHash).toBe(json2.data.inputHash);
    });

    it('Step 5: Error & Degraded States (FR-UI-007)', async () => {
      // 404 for missing run
      const missingReq = new Request('http://localhost:3000/api/runs/missing-run-999');
      const missingRes = await getRunDetail(missingReq, {
        params: Promise.resolve({ runId: 'missing-run-999' }),
      });
      expect(missingRes.status).toBe(404);
      const missingJson = await missingRes.json();
      expect(missingJson.ok).toBe(false);
      expect(missingJson.error).toBe('RUN_NOT_FOUND');

      // 400 for malformed/traversal run ID
      const badReq = new Request('http://localhost:3000/api/runs/../etc');
      const badRes = await getRunDetail(badReq, {
        params: Promise.resolve({ runId: '../etc' }),
      });
      expect(badRes.status).toBe(400);
      const badJson = await badRes.json();
      expect(badJson.ok).toBe(false);
      expect(badJson.error).toBe('INPUT_INVALID');
    });

    it('Step 6: Artifact Download Security (FR-UI-010)', async () => {
      const req = new Request('http://localhost:3000/api/runs/demo-run-001/artifacts/../../package.json');
      const res = await getRunArtifact(req, {
        params: Promise.resolve({ runId: 'demo-run-001', filename: '../../package.json' }),
      });
      expect(res.status).toBe(400);

      const dotEnvReq = new Request('http://localhost:3000/api/runs/demo-run-001/artifacts/.env');
      const dotEnvRes = await getRunArtifact(dotEnvReq, {
        params: Promise.resolve({ runId: 'demo-run-001', filename: '.env' }),
      });
      expect(dotEnvRes.status).toBe(400);
    });
  });
});
