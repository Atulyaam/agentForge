import { describe, it, expect } from 'vitest';
import { GET as getRuns } from '../../apps/web/src/app/api/runs/route';
import { GET as getRunDetail } from '../../apps/web/src/app/api/runs/[runId]/route';
import { GET as getRunEvents } from '../../apps/web/src/app/api/runs/[runId]/events/route';
import { GET as getRunArtifact } from '../../apps/web/src/app/api/runs/[runId]/artifacts/[filename]/route';
import { GET as getHealthLive } from '../../apps/web/src/app/api/health/live/route';
import { GET as getHealthReady } from '../../apps/web/src/app/api/health/ready/route';

describe('Web API Route Handlers (T1-lite)', () => {
  describe('GET /api/runs', () => {
    it('returns a list of runs including demo runs', async () => {
      const response = await getRuns();
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.ok).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data.length).toBeGreaterThanOrEqual(1);

      const demoRun = json.data.find((r: any) => r.id === 'demo-run-001');
      expect(demoRun).toBeDefined();
      expect(demoRun.status).toBe('succeeded');
      expect(demoRun.adapterId).toBe('demo-sentiment');
    });
  });

  describe('GET /api/runs/:runId', () => {
    it('returns authoritative run details for valid run', async () => {
      const req = new Request('http://localhost:3000/api/runs/demo-run-001');
      const response = await getRunDetail(req, {
        params: Promise.resolve({ runId: 'demo-run-001' }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.ok).toBe(true);
      expect(json.data.id).toBe('demo-run-001');
      expect(json.data.status).toBe('succeeded');
      expect(json.data.configSnapshot).toBeDefined();
      expect(json.data.metrics).toBeDefined();
      expect(json.data.outputSnapshot).toBeDefined();
      expect(Array.isArray(json.data.artifacts)).toBe(true);
    });

    it('returns 404 for non-existent run', async () => {
      const req = new Request('http://localhost:3000/api/runs/non-existent-123');
      const response = await getRunDetail(req, {
        params: Promise.resolve({ runId: 'non-existent-123' }),
      });

      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('RUN_NOT_FOUND');
    });

    it('returns 400 for path traversal in runId', async () => {
      const req = new Request('http://localhost:3000/api/runs/..%2fevil');
      const response = await getRunDetail(req, {
        params: Promise.resolve({ runId: '../evil' }),
      });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('INPUT_INVALID');
    });
  });

  describe('GET /api/runs/:runId/events', () => {
    it('returns ordered trace events', async () => {
      const req = new Request('http://localhost:3000/api/runs/demo-run-001/events');
      const response = await getRunEvents(req, {
        params: Promise.resolve({ runId: 'demo-run-001' }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.ok).toBe(true);
      expect(Array.isArray(json.events)).toBe(true);
      expect(json.events.length).toBeGreaterThan(0);
      expect(json.events[0].sequence).toBe(0);
    });

    it('supports after sequence query parameter', async () => {
      const req = new Request('http://localhost:3000/api/runs/demo-run-001/events?after=1');
      const response = await getRunEvents(req, {
        params: Promise.resolve({ runId: 'demo-run-001' }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.ok).toBe(true);
      expect(json.events.every((e: any) => e.sequence > 1)).toBe(true);
    });
  });

  describe('GET /api/runs/:runId/artifacts/:filename (FR-010)', () => {
    it('serves allowed artifact with attachment headers', async () => {
      const req = new Request('http://localhost:3000/api/runs/demo-run-001/artifacts/output.json');
      const response = await getRunArtifact(req, {
        params: Promise.resolve({ runId: 'demo-run-001', filename: 'output.json' }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Disposition')).toContain('attachment; filename="output.json"');
      expect(response.headers.get('Content-Type')).toContain('application/json');

      const text = await response.text();
      expect(text).toContain('demo-001');
    });

    it('rejects path traversal attempts with 400', async () => {
      const req = new Request('http://localhost:3000/api/runs/demo-run-001/artifacts/..%2f..%2fpackage.json');
      const response = await getRunArtifact(req, {
        params: Promise.resolve({ runId: 'demo-run-001', filename: '../../package.json' }),
      });

      expect(response.status).toBe(400);
    });

    it('returns 404 for non-existent artifact file', async () => {
      const req = new Request('http://localhost:3000/api/runs/demo-run-001/artifacts/missing.json');
      const response = await getRunArtifact(req, {
        params: Promise.resolve({ runId: 'demo-run-001', filename: 'missing.json' }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe('Health Check Endpoints (Section 8.2)', () => {
    it('GET /api/health/live returns 200 ok', async () => {
      const response = await getHealthLive();
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.status).toBe('ok');
    });

    it('GET /api/health/ready returns 200 ready', async () => {
      const response = await getHealthReady();
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.status).toBe('ready');
      expect(json.tier).toBe('T1-lite');
    });
  });
});
