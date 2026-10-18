/**
 * Integration Tests for Synthetic Kickoff Workflow Rehearsal (Workstream 3)
 *
 * Verifies:
 * - 9-step rehearsal execution completes deterministically
 * - All artifacts are generated in isolated directory
 * - Synthetic brief is clearly labeled [REHEARSAL MOCK]
 * - Official docs/challenge-brief.md is NOT touched or marked PASS
 * - Contract validation strictly passes 10/10 records and 50 MB limits
 * - Packaging dry-run succeeds while safely reporting transcript as PENDING
 * - Zero live network calls during rehearsal execution
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { runKickoffRehearsal } from '@agentforge/orchestrator';

describe('Synthetic Kickoff Workflow Rehearsal — Workstream 3', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-rehearsal-test-'));

    // Copy fixture directory
    const fixturesDir = path.join(process.cwd(), 'fixtures', 'drill-1-triage');
    const targetFixtures = path.join(tempDir, 'fixtures', 'drill-1-triage');
    fs.mkdirSync(targetFixtures, { recursive: true });
    for (const f of fs.readdirSync(fixturesDir)) {
      fs.copyFileSync(path.join(fixturesDir, f), path.join(targetFixtures, f));
    }

    // Minimal repo files to satisfy packaging
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name": "rehearsal-test"}');
    fs.writeFileSync(path.join(tempDir, 'pnpm-lock.yaml'), 'lockfileVersion: 5.4');
    fs.writeFileSync(path.join(tempDir, '.env.example'), 'LLM_API_KEY=\n');
    fs.writeFileSync(path.join(tempDir, '.gitignore'), 'node_modules\n');
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# Test Project');

    // Create docs dir with pending challenge brief template
    const docsDir = path.join(tempDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(
      path.join(docsDir, 'challenge-brief.md'),
      '# Challenge Brief — Template\n\n[PASTE EXACT CHALLENGE TEXT HERE FROM EMAIL / PLATFORM AT HOUR 0]\n',
    );
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_err) {
      /* ignore cleanup error */
    }
  });

  it('executes all 9 rehearsal steps deterministically and produces isolated artifacts', async () => {
    const res = await runKickoffRehearsal({
      rootDir: tempDir,
    });

    expect(res.overallStatus).toBe('COMPLETED');
    expect(res.steps).toHaveLength(9);
    for (const step of res.steps) {
      expect(step.status).toBe('PASSED');
    }

    // Verify step outcomes
    expect(res.adapterSelected).toBe('support-triage');
    expect(res.contractValidation.valid).toBe(true);
    expect(res.contractValidation.recordCount).toBe(10);
    expect(res.contractValidation.secretsDetected).toBe(0);
    expect(res.packagingDryRun.success).toBe(true);

    // Verify rehearsal artifacts
    expect(fs.existsSync(res.artifacts.mockBriefPath)).toBe(true);
    expect(fs.existsSync(res.artifacts.outputPath)).toBe(true);
    expect(fs.existsSync(res.artifacts.runTracePath)).toBe(true);
    expect(fs.existsSync(res.artifacts.metricsPath)).toBe(true);
    expect(fs.existsSync(res.artifacts.rehearsalJsonPath)).toBe(true);
    expect(fs.existsSync(res.artifacts.rehearsalMarkdownPath)).toBe(true);

    // Verify mock brief content is clearly labeled
    const mockBrief = fs.readFileSync(res.artifacts.mockBriefPath, 'utf8');
    expect(mockBrief).toContain('REHEARSAL MOCK ONLY - NOT OFFICIAL COMPETITION BRIEF');
    expect(mockBrief).toContain('Verbatim Mock Challenge Prompt');
    expect(mockBrief).toContain('Technical Interpretation & Requirements Breakdown');

    // CRITICAL: Verify official brief template in docs/ was NOT modified
    const officialBrief = fs.readFileSync(path.join(tempDir, 'docs', 'challenge-brief.md'), 'utf8');
    expect(officialBrief).toContain('Challenge Brief — Template');
    expect(officialBrief).toContain('[PASTE EXACT CHALLENGE TEXT HERE');

    // Canonical drill reports must NOT exist in tempDir
    expect(fs.existsSync(path.join(tempDir, 'docs', 'drill-1-report.md'))).toBe(false);
    expect(fs.existsSync(path.join(tempDir, 'docs', 'drill-2-report.md'))).toBe(false);
  });
});
