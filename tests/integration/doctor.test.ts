/**
 * Integration Tests for Safe Operator Readiness Diagnostics (Workstream 3)
 *
 * Verifies:
 * - Missing configuration detection with actionable remediation
 * - Invalid configuration detection without leaking values
 * - Redaction guarantees (secrets never exposed in report)
 * - Offline safety (zero network requests, live provider marked PENDING_KICKOFF)
 * - Usable timeout, retry, and budget guardrails
 * - Filesystem writability probe behavior
 * - Transcript vault SHA-256 integrity and tamper detection (no synthetic fabrication)
 * - Packaging 50 MB official limit compliance
 * - Unavailable or misconfigured optional services (e.g., bullmq without Redis)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { runDiagnostics } from '@agentforge/orchestrator';

describe('Safe Operator Readiness Diagnostics — Workstream 3', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-doctor-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('Configuration Schema & Secrets Redaction', () => {
    it('fails when required configuration variables are missing with actionable remediation', async () => {
      const report = await runDiagnostics({
        rootDir: tempDir,
        env: {
          NODE_ENV: 'test',
          // LLM_API_KEY and LLM_MODEL deliberately omitted
        },
      });

      expect(report.allPassed).toBe(false);
      const configCheck = report.checks.find((c) => c.id === 'config_schema');
      expect(configCheck).toBeDefined();
      expect(configCheck?.status).toBe('failed');
      expect(configCheck?.detail).toContain('[MISSING]');
      expect(configCheck?.remediation).toContain('Configure required variables in .env or environment');
    });

    it('fails when configuration variables have invalid types or negative bounds', async () => {
      const report = await runDiagnostics({
        rootDir: tempDir,
        env: {
          NODE_ENV: 'test',
          LLM_API_KEY: 'test-key',
          LLM_MODEL: 'test-model',
          MAX_RUN_DURATION_SECONDS: '-10', // Invalid: negative
        },
      });

      expect(report.allPassed).toBe(false);
      const configCheck = report.checks.find((c) => c.id === 'config_schema');
      expect(configCheck?.status).toBe('failed');
      expect(configCheck?.detail).toContain('MAX_RUN_DURATION_SECONDS');
    });

    it('strictly redacts secret values and never prints LLM_API_KEY plaintext', async () => {
      const secretKey = 'sk-extremely-confidential-secret-key-1234567890';
      const report = await runDiagnostics({
        rootDir: tempDir,
        env: {
          NODE_ENV: 'test',
          LLM_API_KEY: secretKey,
          LLM_MODEL: 'gpt-4o',
        },
      });

      const serializedReport = JSON.stringify(report);
      // Verify plaintext secret is NEVER present anywhere in the diagnostic report
      expect(serializedReport).not.toContain(secretKey);
      expect(serializedReport).toContain('[CONFIGURED - REDACTED');

      const configCheck = report.checks.find((c) => c.id === 'config_schema');
      expect(configCheck?.status).toBe('passed');
      expect(configCheck?.redacted).toBe(true);
    });
  });

  describe('Provider & Model Diagnostics', () => {
    it('marks mock provider as passed and ready for offline testing', async () => {
      const report = await runDiagnostics({
        rootDir: tempDir,
        env: {
          NODE_ENV: 'test',
          LLM_API_KEY: 'mock-key',
          LLM_MODEL: 'mock-model',
          LLM_PROVIDER: 'mock',
        },
      });

      const providerCheck = report.checks.find((c) => c.id === 'provider_model');
      expect(providerCheck?.status).toBe('passed');
      expect(providerCheck?.detail).toContain('Deterministic Mock Provider active');
    });

    it('marks live provider as PENDING_KICKOFF without making live API calls', async () => {
      const report = await runDiagnostics({
        rootDir: tempDir,
        env: {
          NODE_ENV: 'development',
          LLM_API_KEY: 'sk-prod-key-for-challenge-orchestrate',
          LLM_MODEL: 'claude-3-5-sonnet-20241022',
        },
      });

      const providerCheck = report.checks.find((c) => c.id === 'provider_model');
      expect(providerCheck?.status).toBe('pending');
      expect(providerCheck?.detail).toContain('PENDING_KICKOFF');
      expect(providerCheck?.detail).toContain('zero live API calls made');
      expect(report.allPassed).toBe(true); // Pending status does not fail the overall readiness
    });
  });

  describe('Budget & Guardrail Bounds Usability', () => {
    it('verifies usable limits when configuration provides valid positive bounds', async () => {
      const report = await runDiagnostics({
        rootDir: tempDir,
        env: {
          NODE_ENV: 'test',
          LLM_API_KEY: 'mock-key',
          LLM_MODEL: 'mock-model',
          MAX_RUN_DURATION_SECONDS: '600',
          MAX_TRANSIENT_RETRIES: '3',
          MAX_SCHEMA_CORRECTIONS: '2',
          BATCH_CONCURRENCY: '2',
          MAX_INPUT_CHARS: '15000',
        },
      });

      const budgetCheck = report.checks.find((c) => c.id === 'budgets_and_guards');
      expect(budgetCheck?.status).toBe('passed');
      expect(budgetCheck?.detail).toContain('Run timeout: 600s');
      expect(budgetCheck?.detail).toContain('Retries: 3');
    });
  });

  describe('Filesystem Writability Probe', () => {
    it('successfully probes runs/ and docs/ai-transcript/ directories', async () => {
      const report = await runDiagnostics({
        rootDir: tempDir,
        env: {
          NODE_ENV: 'test',
          LLM_API_KEY: 'mock-key',
          LLM_MODEL: 'mock-model',
        },
      });

      const fsCheck = report.checks.find((c) => c.id === 'directory_writability');
      expect(fsCheck?.status).toBe('passed');
      expect(fs.existsSync(path.join(tempDir, 'runs'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'docs', 'ai-transcript'))).toBe(true);
    });
  });

  describe('AI Transcript Vault Integrity & Non-Fabrication', () => {
    it('warns when INDEX.md does not yet exist without failing overall diagnostics', async () => {
      const report = await runDiagnostics({
        rootDir: tempDir,
        env: {
          NODE_ENV: 'test',
          LLM_API_KEY: 'mock-key',
          LLM_MODEL: 'mock-model',
        },
      });

      const vaultCheck = report.checks.find((c) => c.id === 'transcript_vault');
      expect(vaultCheck?.status).toBe('warning');
      expect(vaultCheck?.detail).toContain('INDEX.md does not yet exist');
    });

    it('verifies genuine registered transcripts and validates SHA-256 match', async () => {
      const vaultDir = path.join(tempDir, 'docs', 'ai-transcript');
      fs.mkdirSync(vaultDir, { recursive: true });

      const transcriptContent = '# Real AI Assistance Transcript\n\nPrompt: How to structure Zod schemas?';
      const transcriptName = 'chat-export-01.md';
      fs.writeFileSync(path.join(vaultDir, transcriptName), transcriptContent);

      const realHash = crypto.createHash('sha256').update(transcriptContent).digest('hex');
      const indexMd = `# AI Transcript Vault\n\n| Date | File | SHA-256 |\n|---|---|---|\n| 2026-10-18T18:00:00Z | ${transcriptName} | ${realHash} |\n`;
      fs.writeFileSync(path.join(vaultDir, 'INDEX.md'), indexMd);

      const report = await runDiagnostics({
        rootDir: tempDir,
        env: {
          NODE_ENV: 'test',
          LLM_API_KEY: 'mock-key',
          LLM_MODEL: 'mock-model',
        },
      });

      const vaultCheck = report.checks.find((c) => c.id === 'transcript_vault');
      expect(vaultCheck?.status).toBe('passed');
      expect(vaultCheck?.detail).toContain('1 authentic transcript(s) registered with tamper-proof SHA-256 hashes');
      expect(vaultCheck?.detail).toContain('Zero synthetic fabrication detected');
    });

    it('fails closed when a registered transcript has been tampered with or corrupted', async () => {
      const vaultDir = path.join(tempDir, 'docs', 'ai-transcript');
      fs.mkdirSync(vaultDir, { recursive: true });

      const genuineContent = '# Genuine Conversation';
      const transcriptName = 'tampered-transcript.md';
      fs.writeFileSync(path.join(vaultDir, transcriptName), genuineContent);

      // Register genuine hash
      const genuineHash = crypto.createHash('sha256').update(genuineContent).digest('hex');
      const indexMd = `| Date | File | SHA-256 |\n|---|---|---|\n| 2026-10-18T18:00:00Z | ${transcriptName} | ${genuineHash} |\n`;
      fs.writeFileSync(path.join(vaultDir, 'INDEX.md'), indexMd);

      // Tamper with file after registration
      fs.writeFileSync(path.join(vaultDir, transcriptName), '# Altered Synthetic Content');

      const report = await runDiagnostics({
        rootDir: tempDir,
        env: {
          NODE_ENV: 'test',
          LLM_API_KEY: 'mock-key',
          LLM_MODEL: 'mock-model',
        },
      });

      expect(report.allPassed).toBe(false);
      const vaultCheck = report.checks.find((c) => c.id === 'transcript_vault');
      expect(vaultCheck?.status).toBe('failed');
      expect(vaultCheck?.detail).toContain('hash mismatch');
      expect(vaultCheck?.remediation).toContain('Re-add untampered transcript files');
    });
  });

  describe('Packaging Submission Compliance (50 MB Rule)', () => {
    it('verifies official 50 MB ceiling is retained and compliant', async () => {
      const report = await runDiagnostics({
        rootDir: tempDir,
        env: {
          NODE_ENV: 'test',
          LLM_API_KEY: 'mock-key',
          LLM_MODEL: 'mock-model',
        },
      });

      const packCheck = report.checks.find((c) => c.id === 'packaging_limits');
      expect(packCheck?.status).toBe('passed');
      expect(packCheck?.detail).toContain('50 MB ceiling strictly retained');
    });
  });

  describe('Optional Background Services (Redis/BullMQ)', () => {
    it('passes when JOB_RUNNER=inline without requiring external services', async () => {
      const report = await runDiagnostics({
        rootDir: tempDir,
        env: {
          NODE_ENV: 'test',
          LLM_API_KEY: 'mock-key',
          LLM_MODEL: 'mock-model',
          JOB_RUNNER: 'inline',
        },
      });

      const serviceCheck = report.checks.find((c) => c.id === 'optional_services');
      expect(serviceCheck?.status).toBe('passed');
      expect(serviceCheck?.detail).toContain('JOB_RUNNER=inline active');
    });

    it('fails when JOB_RUNNER=bullmq is specified but REDIS_URL is missing', async () => {
      const report = await runDiagnostics({
        rootDir: tempDir,
        env: {
          NODE_ENV: 'test',
          LLM_API_KEY: 'mock-key',
          LLM_MODEL: 'mock-model',
          JOB_RUNNER: 'bullmq',
          // REDIS_URL missing
        },
      });

      expect(report.allPassed).toBe(false);
      const serviceCheck = report.checks.find((c) => c.id === 'optional_services');
      expect(serviceCheck?.status).toBe('failed');
      expect(serviceCheck?.remediation).toContain('Set REDIS_URL in .env or switch JOB_RUNNER=inline');
    });
  });
});
