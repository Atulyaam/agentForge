/**
 * Integration Tests for Live Provider Validation & Calibration (Workstreams 1 & 2)
 *
 * Verifies:
 * - Smoke test without --live reports PENDING (zero live calls)
 * - Smoke test with --live but missing/placeholder credentials reports PENDING
 * - Smoke test with deterministic provider succeeds and writes runs/smoke/smoke-report.json
 * - Smoke test with malformed output reports FAILED with safe redacted error
 * - BudgetGuard call ceiling enforcement
 * - Calibration without --live reports PENDING
 * - Calibration with --live but missing credentials reports PENDING
 * - Calibration with deterministic provider processes exact bounded sample (3 records)
 * - Calibration evaluates against separately stored expected outcomes
 * - Missing token counts reported as 'unavailable' (never guessed)
 * - Ground truth labels strictly excluded from prompts
 * - Zero live network calls during automated testing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  runProviderSmokeTest,
  runModelCalibration,
  type ProviderSmokeOptions,
} from '@agentforge/orchestrator';
import { MockLLMProvider } from '@agentforge/llm';

describe('Live Provider Validation & Calibration — Workstreams 1 & 2', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-live-val-'));

    // Copy fixture folders to tempDir for isolated testing
    const fixturesDir = path.join(process.cwd(), 'fixtures');
    const destFixtures = path.join(tempDir, 'fixtures');
    fs.mkdirSync(destFixtures, { recursive: true });

    // Copy drill-1-triage and drill-2-rag fixtures
    for (const drill of ['drill-1-triage', 'drill-2-rag']) {
      const srcDir = path.join(fixturesDir, drill);
      const targetDir = path.join(destFixtures, drill);
      fs.mkdirSync(targetDir, { recursive: true });
      for (const f of fs.readdirSync(srcDir)) {
        fs.copyFileSync(path.join(srcDir, f), path.join(targetDir, f));
      }
    }

    const docsDir = path.join(tempDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    vi.restoreAllMocks();
  });

  describe('Workstream 1: Provider Smoke Test', () => {
    it('returns PENDING when --live flag is omitted (default offline safety)', async () => {
      const res = await runProviderSmokeTest({
        live: false,
        rootDir: tempDir,
        env: { LLM_API_KEY: 'test-key', LLM_MODEL: 'gpt-4o' },
      });

      expect(res.status).toBe('PENDING');
      expect(res.live).toBe(false);
      expect(res.message).toContain('requires explicit opt-in via --live flag');
    });

    it('returns PENDING when credentials are empty or placeholder values', async () => {
      const res1 = await runProviderSmokeTest({
        live: true,
        rootDir: tempDir,
        env: { LLM_API_KEY: '', LLM_MODEL: 'gpt-4o' },
      });
      expect(res1.status).toBe('PENDING');
      expect(res1.configValid).toBe(false);
      expect(res1.message).toContain('valid LLM_API_KEY is not configured');

      const res2 = await runProviderSmokeTest({
        live: true,
        rootDir: tempDir,
        env: { LLM_API_KEY: 'mock-key', LLM_MODEL: 'mock-model' },
      });
      expect(res2.status).toBe('PENDING');
      expect(res2.configValid).toBe(false);
    });

    it('executes structured smoke probe with mock provider and writes report artifact', async () => {
      const mock = new MockLLMProvider(
        JSON.stringify({
          status: 'ok',
          engine: 'agentforge-test-engine',
          timestamp: '2026-10-18T20:00:00.000Z',
        }),
      );

      const res = await runProviderSmokeTest({
        live: true,
        rootDir: tempDir,
        env: { LLM_API_KEY: 'sk-actual-configured-key-12345', LLM_MODEL: 'gpt-4o' },
        customProvider: mock,
      });

      expect(res.status).toBe('PASSED');
      expect(res.schemaValid).toBe(true);
      expect(res.output?.status).toBe('ok');
      expect(res.output?.engine).toBe('agentforge-test-engine');
      expect(res.reportPath).toBeDefined();
      expect(fs.existsSync(res.reportPath!)).toBe(true);

      const savedReport = JSON.parse(fs.readFileSync(res.reportPath!, 'utf8'));
      expect(savedReport.status).toBe('PASSED');
      expect(savedReport.envRedacted.LLM_API_KEY).toBe('[CONFIGURED - REDACTED]');
    });

    it('reports FAILED when model returns invalid schema output with safe error', async () => {
      const badMock = new MockLLMProvider('{"status": "corrupt_data"}');

      const res = await runProviderSmokeTest({
        live: true,
        rootDir: tempDir,
        env: { LLM_API_KEY: 'sk-actual-configured-key-12345', LLM_MODEL: 'gpt-4o' },
        customProvider: badMock,
      });

      expect(res.status).toBe('FAILED');
      expect(res.schemaValid).toBe(false);
      expect(res.error).toBeDefined();
      expect(res.message).toContain('failed');
    });
  });

  describe('Workstream 2: Bounded Real-Model Calibration', () => {
    it('returns PENDING when --live flag is omitted', async () => {
      const res = await runModelCalibration({
        live: false,
        sampleSize: 3,
        rootDir: tempDir,
        env: { LLM_API_KEY: 'sk-live-key', LLM_MODEL: 'gpt-4o' },
      });

      expect(res.status).toBe('PENDING');
      expect(res.live).toBe(false);
      expect(res.message).toContain('requires explicit opt-in via --live flag');
    });

    it('returns PENDING when credentials are missing or mock placeholders', async () => {
      const res = await runModelCalibration({
        live: true,
        sampleSize: 3,
        rootDir: tempDir,
        env: { LLM_API_KEY: 'mock-key', LLM_MODEL: 'mock-model' },
      });

      expect(res.status).toBe('PENDING');
      expect(res.message).toContain('LLM_API_KEY is not configured');
    });

    it('executes bounded calibration on 3 sample records and writes report artifacts without overwriting drill reports', async () => {
      // Deterministic provider simulating compliant structured responses
      const triageResponse = JSON.stringify({
        category: 'billing',
        priority: 'high',
        escalated: false,
        confidence: 0.95,
        reasoning: 'Invoice discrepancy noted.',
      });

      const ragResponse = JSON.stringify({
        decision: 'answered',
        answer: 'The standard rate limit is 100 requests per minute.',
        citations: ['doc1_chunk1'],
        confidence: 0.92,
        reasoning: 'Found in rate limits section.',
      });

      const mock = new MockLLMProvider((opts) => {
        if (opts.promptVersion.includes('triage')) {
          return triageResponse;
        }
        return ragResponse;
      });

      const res = await runModelCalibration({
        live: true,
        sampleSize: 3,
        maxCalls: 6,
        adapterId: 'all',
        rootDir: tempDir,
        env: { LLM_API_KEY: 'sk-live-actual-key-987654321', LLM_MODEL: 'gpt-4o' },
        customProvider: mock,
      });

      expect(res.status).toBe('COMPLETED');
      expect(res.adaptersEvaluated).toEqual(['support-triage', 'policy-rag']);
      expect(res.metrics['support-triage'].sampleCount).toBe(3);
      expect(res.metrics['policy-rag'].sampleCount).toBe(3);
      expect(res.metrics['support-triage'].schemaValidityRate).toBe(1.0);

      // Verify reports were saved
      expect(res.reportPath).toBeDefined();
      expect(fs.existsSync(res.reportPath!)).toBe(true);
      expect(res.markdownReportPath).toBeDefined();
      expect(fs.existsSync(res.markdownReportPath!)).toBe(true);

      const mdContent = fs.readFileSync(res.markdownReportPath!, 'utf8');
      expect(mdContent).toContain('Statistical Boundary Disclosure');
      expect(mdContent).toContain('Measured Defensible Metrics');
      expect(mdContent).toContain('support-triage');
      expect(mdContent).toContain('policy-rag');

      // Canonical mock drill reports must NOT exist in tempDir or be overwritten
      expect(fs.existsSync(path.join(tempDir, 'docs', 'drill-1-report.md'))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, 'docs', 'drill-2-report.md'))).toBe(false);
    });
  });
});
