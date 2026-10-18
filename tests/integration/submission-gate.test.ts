/**
 * Integration Tests for Submission Readiness Gate (Workstream 3)
 *
 * Verifies:
 * - Reporting separate states: Engineering Health (PASS) vs Submission Readiness (BLOCKED)
 * - Missing genuine transcript immediately blocks submission
 * - INDEX.md supplied as transcript blocks submission with clear diagnostic
 * - Valid authentic transcript fixture registers as PASS
 * - Pending status for unfulfilled challenge brief prior to kickoff
 * - Secret and size limit compliance
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  checkSubmissionReadiness,
  registerAuthenticTranscript,
} from '@agentforge/orchestrator';

describe('Final Submission Readiness Gate — Workstream 3', () => {
  let tempDir: string;
  let runsDir: string;
  let vaultDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-gate-test-'));
    runsDir = path.join(tempDir, 'runs', 'drill-1-triage');
    fs.mkdirSync(runsDir, { recursive: true });
    vaultDir = path.join(tempDir, 'docs', 'ai-transcript');
    fs.mkdirSync(vaultDir, { recursive: true });

    // Minimal repo files to satisfy repo_health
    fs.writeFileSync(path.join(tempDir, 'pnpm-lock.yaml'), 'lockfileVersion: 5.4');
    fs.writeFileSync(path.join(tempDir, '.env.example'), 'LLM_API_KEY=\nLLM_MODEL=');
    fs.writeFileSync(path.join(tempDir, '.gitignore'), '.env\nnode_modules\n');
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# Project');
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name": "test"}');

    // Default output file
    fs.writeFileSync(
      path.join(runsDir, 'output.json'),
      JSON.stringify([{ id: '1', sentiment: 'positive' }]),
    );

    // Default docs/challenge-brief.md (unfulfilled template)
    const docsDir = path.join(tempDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(
      path.join(docsDir, 'challenge-brief.md'),
      '# Challenge Brief\n\nPaste the complete, unaltered challenge problem statement here upon release.\n',
    );
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('marks overall status as BLOCKED when no authentic transcript exists in vault', async () => {
    const report = await checkSubmissionReadiness({
      rootDir: tempDir,
    });

    expect(report.engineeringHealth).toBe('PASS');
    expect(report.submissionReadiness).toBe('BLOCKED');
    expect(report.overallStatus).toBe('BLOCKED');

    const transcriptCheck = report.checks.find((c) => c.id === 'authentic_transcript');
    expect(transcriptCheck?.status).toBe('BLOCKED');
    expect(transcriptCheck?.detail).toMatch(/Authentic AI chat transcript missing|only a metadata ledger/);
  });

  it('marks transcript check as BLOCKED if INDEX.md is supplied as transcript', async () => {
    const indexMd = path.join(vaultDir, 'INDEX.md');
    fs.writeFileSync(indexMd, '# AI Transcript Vault\n| Date | File | SHA-256 |\n');

    const report = await checkSubmissionReadiness({
      rootDir: tempDir,
      transcriptFile: indexMd,
    });

    expect(report.submissionReadiness).toBe('BLOCKED');
    const transcriptCheck = report.checks.find((c) => c.id === 'authentic_transcript');
    expect(transcriptCheck?.status).toBe('BLOCKED');
    expect(transcriptCheck?.detail).toContain('is only a metadata ledger');
  });

  it('marks challenge contract as PENDING when official brief is unfulfilled template', async () => {
    const report = await checkSubmissionReadiness({
      rootDir: tempDir,
    });

    const briefCheck = report.checks.find((c) => c.id === 'challenge_schema');
    expect(briefCheck?.status).toBe('PENDING');
    expect(briefCheck?.detail).toContain('Official challenge brief pending kickoff');
  });

  it('marks transcript as PASS and submission READY when genuine transcript fixture is registered and brief configured', async () => {
    // Register authentic transcript fixture [TEST-ONLY]
    const genuineChat = path.join(tempDir, 'genuine-chat.md');
    fs.writeFileSync(
      genuineChat,
      '# AI Coding Session [TEST-ONLY FIXTURE]\nUser: What is the backoff policy?\nAssistant: Exponential with jitter.',
    );
    registerAuthenticTranscript(genuineChat, { rootDir: tempDir });

    // Fulfill challenge brief
    const briefPath = path.join(tempDir, 'docs', 'challenge-brief.md');
    fs.writeFileSync(
      briefPath,
      '# Official Challenge Problem Statement\n\nTask: Categorize incoming customer support tickets into billing, technical, or general inquiries.\nInput dataset contains 100 rows.\nStrict 1:1 input/output cardinality required.\nDeadline: 24h.\n'.repeat(
        3,
      ),
    );

    const report = await checkSubmissionReadiness({
      rootDir: tempDir,
    });

    expect(report.engineeringHealth).toBe('PASS');
    expect(report.submissionReadiness).toBe('READY');
    expect(report.overallStatus).toBe('READY');

    const transcriptCheck = report.checks.find((c) => c.id === 'authentic_transcript');
    expect(transcriptCheck?.status).toBe('PASS');
    expect(transcriptCheck?.detail).toContain('Authentic conversation transcript verified');

    const briefCheck = report.checks.find((c) => c.id === 'challenge_schema');
    expect(briefCheck?.status).toBe('PASS');
  });

  it('fails secrets_and_limits check when secret key pattern is detected in project file', async () => {
    // Add file with live secret pattern
    fs.writeFileSync(
      path.join(tempDir, 'leaked_service.ts'),
      'export const key = "sk-live-012345678901234567890123456";\n',
    );

    const report = await checkSubmissionReadiness({
      rootDir: tempDir,
    });

    const secretCheck = report.checks.find((c) => c.id === 'secrets_and_limits');
    expect(secretCheck?.status).toBe('FAIL');
    expect(secretCheck?.detail).toMatch(/secrets detected/);
    expect(report.overallStatus).toBe('FAILED');
  });

  it('fails output_file check when output does not match expected format', async () => {
    // Write corrupt JSON to output.json
    fs.writeFileSync(path.join(runsDir, 'output.json'), '{ not valid json');

    const report = await checkSubmissionReadiness({
      rootDir: tempDir,
      outputFormat: 'json',
    });

    const outputCheck = report.checks.find((c) => c.id === 'output_file');
    expect(outputCheck?.status).toBe('FAIL');
    expect(outputCheck?.detail).toContain('Invalid JSON');
  });
});
