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

  // Regression 1: Mock contracts pass while official challenge contract remains pending
  it('treats mock drill schemas as benchmark baselines: mock output passes format check while official challenge contract remains PENDING', async () => {
    const report = await checkSubmissionReadiness({
      rootDir: tempDir,
      outputFile: path.join(runsDir, 'output.json'), // runs/drill-1-triage/output.json
    });

    expect(report.engineeringHealth).toBe('PASS');
    expect(report.officialBrief).toBe('PENDING');
    expect(report.officialContract).toBe('PENDING');

    const outputCheck = report.checks.find((c) => c.id === 'output_file');
    expect(outputCheck?.status).toBe('PASS');

    const briefCheck = report.checks.find((c) => c.id === 'official_brief');
    expect(briefCheck?.status).toBe('PENDING');

    const contractCheck = report.checks.find((c) => c.id === 'challenge_schema');
    expect(contractCheck?.status).toBe('PENDING');
    expect(contractCheck?.detail).toContain('Mock drill schemas serve only as offline regression baselines');
  });

  // Regression 2: Missing challenge brief prevents overall readiness
  it('prevents overall readiness when challenge brief is missing or template placeholder (keeps submission BLOCKED)', async () => {
    // Register authentic transcript fixture [TEST-ONLY]
    const genuineChat = path.join(tempDir, 'genuine-chat.md');
    fs.writeFileSync(
      genuineChat,
      '# AI Coding Session [TEST-ONLY FIXTURE]\nUser: What is the backoff policy?\nAssistant: Exponential with jitter.',
    );
    registerAuthenticTranscript(genuineChat, { rootDir: tempDir });

    // Brief is still template in tempDir/docs/challenge-brief.md
    const report = await checkSubmissionReadiness({
      rootDir: tempDir,
    });

    expect(report.officialBrief).toBe('PENDING');
    expect(report.officialContract).toBe('PENDING');
    expect(report.submissionReadiness).toBe('BLOCKED');
    expect(report.overallStatus).toBe('BLOCKED');
    expect(report.summary).toContain('pending receipt and review of the official competition challenge brief');
  });

  // Regression 3: A valid configured challenge contract can pass its own checks
  it('allows a valid configured challenge contract to PASS when brief and validator are satisfied', async () => {
    // Fulfill challenge brief with authentic problem statement
    const briefPath = path.join(tempDir, 'docs', 'challenge-brief.md');
    fs.writeFileSync(
      briefPath,
      '# Official Challenge Problem Statement (Kickoff Delivery)\n\n' +
        'Problem: Classify multi-lingual customer inquiries into billing, account, or tech_support.\n' +
        'Input format: JSON array of 150 items with { id, query, language }.\n' +
        'Output contract: JSON array of 150 items with { id, category, confidence, route }.\n' +
        'Acceptance criteria: Valid JSON, 1:1 cardinality, confidence between 0 and 1, strict latency < 200ms.\n' +
        'Evaluation metric: Weighted F1-score across 3 categories.',
    );

    // Create challenge-specific output
    const challengeRunDir = path.join(tempDir, 'runs', 'challenge');
    fs.mkdirSync(challengeRunDir, { recursive: true });
    const challengeOutputPath = path.join(challengeRunDir, 'output.json');
    fs.writeFileSync(
      challengeOutputPath,
      JSON.stringify([
        { id: '1', category: 'billing', confidence: 0.95, route: 'finance' },
      ]),
    );

    const report = await checkSubmissionReadiness({
      rootDir: tempDir,
      outputFile: challengeOutputPath,
      challengeAdapterId: 'customer-inquiry-router',
      challengeValidator: (content) => {
        const parsed = JSON.parse(content);
        return {
          valid: Array.isArray(parsed) && parsed.length > 0 && !!parsed[0].category,
          errors: [],
        };
      },
    });

    expect(report.officialBrief).toBe('PASS');
    expect(report.officialContract).toBe('PASS');

    const contractCheck = report.checks.find((c) => c.id === 'challenge_schema');
    expect(contractCheck?.status).toBe('PASS');
    expect(contractCheck?.detail).toContain('Official challenge-specific output contract validated and satisfied');
  });

  // Regression 4: Missing authentic transcript keeps overall readiness blocked
  it('keeps overall readiness BLOCKED when authentic transcript is missing, even if brief and contract PASS', async () => {
    // Fulfill challenge brief
    const briefPath = path.join(tempDir, 'docs', 'challenge-brief.md');
    fs.writeFileSync(
      briefPath,
      '# Official Challenge Problem Statement (Kickoff Delivery)\n\n' +
        'Problem: Classify multi-lingual customer inquiries into billing, account, or tech_support.\n' +
        'Input format: JSON array of 150 items with { id, query, language }.\n' +
        'Output contract: JSON array of 150 items with { id, category, confidence, route }.\n' +
        'Acceptance criteria: Valid JSON, 1:1 cardinality, confidence between 0 and 1, strict latency < 200ms.\n' +
        'Evaluation metric: Weighted F1-score across 3 categories.',
    );

    const challengeRunDir = path.join(tempDir, 'runs', 'challenge');
    fs.mkdirSync(challengeRunDir, { recursive: true });
    const challengeOutputPath = path.join(challengeRunDir, 'output.json');
    fs.writeFileSync(
      challengeOutputPath,
      JSON.stringify([{ id: '1', category: 'billing', confidence: 0.95, route: 'finance' }]),
    );

    const report = await checkSubmissionReadiness({
      rootDir: tempDir,
      outputFile: challengeOutputPath,
      challengeAdapterId: 'customer-inquiry-router',
    });

    expect(report.officialBrief).toBe('PASS');
    expect(report.officialContract).toBe('PASS');
    // Still BLOCKED because no authentic transcript has been imported
    expect(report.submissionReadiness).toBe('BLOCKED');
    expect(report.overallStatus).toBe('BLOCKED');
    expect(report.summary).toContain('pending import of genuine AI conversation transcript');
  });

  // Regression 5: All prerequisites pass only when each required evidence artifact is present and valid
  it('marks submission READY and overallStatus READY only when all required evidence artifacts are validly present', async () => {
    // 1. Register authentic transcript fixture [TEST-ONLY]
    const genuineChat = path.join(tempDir, 'genuine-chat.md');
    fs.writeFileSync(
      genuineChat,
      '# AI Coding Session [TEST-ONLY FIXTURE]\nUser: What is the backoff policy?\nAssistant: Exponential with jitter.',
    );
    registerAuthenticTranscript(genuineChat, { rootDir: tempDir });

    // 2. Fulfill challenge brief
    const briefPath = path.join(tempDir, 'docs', 'challenge-brief.md');
    fs.writeFileSync(
      briefPath,
      '# Official Challenge Problem Statement (Kickoff Delivery)\n\n' +
        'Problem: Classify multi-lingual customer inquiries into billing, account, or tech_support.\n' +
        'Input format: JSON array of 150 items with { id, query, language }.\n' +
        'Output contract: JSON array of 150 items with { id, category, confidence, route }.\n' +
        'Acceptance criteria: Valid JSON, 1:1 cardinality, confidence between 0 and 1, strict latency < 200ms.\n' +
        'Evaluation metric: Weighted F1-score across 3 categories.',
    );

    // 3. Fulfill challenge output
    const challengeRunDir = path.join(tempDir, 'runs', 'challenge');
    fs.mkdirSync(challengeRunDir, { recursive: true });
    const challengeOutputPath = path.join(challengeRunDir, 'output.json');
    fs.writeFileSync(
      challengeOutputPath,
      JSON.stringify([{ id: '1', category: 'billing', confidence: 0.95, route: 'finance' }]),
    );

    const report = await checkSubmissionReadiness({
      rootDir: tempDir,
      outputFile: challengeOutputPath,
      challengeAdapterId: 'customer-inquiry-router',
    });

    expect(report.engineeringHealth).toBe('PASS');
    expect(report.officialBrief).toBe('PASS');
    expect(report.officialContract).toBe('PASS');
    expect(report.submissionReadiness).toBe('READY');
    expect(report.overallStatus).toBe('READY');
    expect(report.summary).toContain('Ready to package and submit');

    const transcriptCheck = report.checks.find((c) => c.id === 'authentic_transcript');
    expect(transcriptCheck?.status).toBe('PASS');

    const contractCheck = report.checks.find((c) => c.id === 'challenge_schema');
    expect(contractCheck?.status).toBe('PASS');

    const briefCheck = report.checks.find((c) => c.id === 'official_brief');
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
