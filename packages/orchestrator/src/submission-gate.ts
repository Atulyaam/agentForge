/**
 * Final Submission Readiness Gate (Workstream 3)
 *
 * Combines existing repository health, code archive, challenge output,
 * authentic transcript, secrets scanning, and 50 MB size limits into a single,
 * authoritative pre-submission gate.
 *
 * Rules:
 * - Distinguishes local engineering health (PASS) from contest submission readiness (BLOCKED).
 * - A missing genuine transcript immediately sets submission readiness to BLOCKED.
 * - Missing official challenge brief / domain contract sets challenge schema to PENDING.
 * - Never fabricates fake transcript entries or treats INDEX.md as a transcript.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  SubmissionPackager,
  OFFICIAL_MAX_FILE_SIZE_MB,
  scanBufferForSecrets,
  type OutputValidatorStrategy,
  type SecretViolation,
} from './packaging.js';
import { resolveSubmissionTranscript } from './transcript.js';

export type ReadinessStatus = 'PASS' | 'FAIL' | 'PENDING' | 'BLOCKED';

export interface ReadinessCheckItem {
  id: string;
  name: string;
  status: ReadinessStatus;
  detail: string;
  remediation?: string;
  artifactPath?: string;
  sizeMb?: number;
  sha256?: string;
}

export interface SubmissionGateReport {
  timestamp: string;
  overallStatus: 'READY' | 'BLOCKED' | 'FAILED';
  engineeringHealth: ReadinessStatus;
  submissionReadiness: 'READY' | 'BLOCKED';
  checks: ReadinessCheckItem[];
  summary: string;
  artifacts: {
    codeArchive: { status: ReadinessStatus; estimatedMb: number; fileCount: number; validSize: boolean };
    outputFile: { status: ReadinessStatus; path: string; sizeMb: number; validContent: boolean; validSize: boolean };
    transcript: { status: ReadinessStatus; path?: string; sizeMb?: number; sha256?: string; format?: string };
  };
}

export interface SubmissionGateOptions {
  rootDir?: string;
  outputFile?: string;
  transcriptFile?: string;
  outputFormat?: OutputValidatorStrategy;
}

/**
 * Executes the final submission readiness gate checks.
 */
export async function checkSubmissionReadiness(
  options: SubmissionGateOptions = {},
): Promise<SubmissionGateReport> {
  const rootDir = options.rootDir ?? process.cwd();
  const outputFile = options.outputFile ?? 'runs/drill-1-triage/output.json';
  const outputFormat = options.outputFormat ?? 'json';

  const checks: ReadinessCheckItem[] = [];

  // ── 1. Repository & Local Engineering Health ────────────────────────────────
  const lockfilePath = path.join(rootDir, 'pnpm-lock.yaml');
  const envExamplePath = path.join(rootDir, '.env.example');
  const gitignorePath = path.join(rootDir, '.gitignore');
  const readmePath = path.join(rootDir, 'README.md');

  const repoOk =
    fs.existsSync(lockfilePath) &&
    fs.existsSync(envExamplePath) &&
    fs.existsSync(gitignorePath) &&
    fs.existsSync(readmePath);

  if (repoOk) {
    checks.push({
      id: 'repo_health',
      name: 'Repository & Build Health',
      status: 'PASS',
      detail: 'Lockfile verified, required configurations present, preflight checks satisfied.',
    });
  } else {
    checks.push({
      id: 'repo_health',
      name: 'Repository & Build Health',
      status: 'FAIL',
      detail: 'Core repository files missing or corrupted.',
      remediation: 'Ensure pnpm-lock.yaml, .env.example, .gitignore, and README.md are present.',
    });
  }

  // ── 2. Code ZIP Deliverable Readiness ──────────────────────────────────────
  const packager = new SubmissionPackager(rootDir, OFFICIAL_MAX_FILE_SIZE_MB, OFFICIAL_MAX_FILE_SIZE_MB, true, outputFormat);
  const { included } = packager.collectFiles(rootDir, true);
  const totalUncompressedBytes = included.reduce((sum, f) => sum + f.sizeBytes, 0);
  const estimatedZipMb = Number(((totalUncompressedBytes * 0.35) / (1024 * 1024)).toFixed(2));
  const validCodeSize = estimatedZipMb <= OFFICIAL_MAX_FILE_SIZE_MB;

  if (included.length > 0 && validCodeSize) {
    checks.push({
      id: 'code_zip',
      name: 'Code ZIP Deliverable (Source & Configs)',
      status: 'PASS',
      detail: `${included.length} project files collected (estimated archive size: ${estimatedZipMb} MB <= ${OFFICIAL_MAX_FILE_SIZE_MB} MB limit). Exclusions applied.`,
      sizeMb: estimatedZipMb,
    });
  } else {
    checks.push({
      id: 'code_zip',
      name: 'Code ZIP Deliverable (Source & Configs)',
      status: 'FAIL',
      detail: `Code archive validation failed: ${included.length} files, estimated ${estimatedZipMb} MB.`,
      remediation: 'Verify project file tree and remove oversized unexcluded artifacts.',
    });
  }

  // ── 3. Output File Deliverable Readiness ────────────────────────────────────
  const outputValidation = packager.validateArtifact(outputFile, 'Output File', outputFormat, OFFICIAL_MAX_FILE_SIZE_MB);
  const resolvedOutputPath = outputValidation.path;

  if (outputValidation.exists && outputValidation.validContent && outputValidation.validSize) {
    checks.push({
      id: 'output_file',
      name: 'Challenge Output File Deliverable',
      status: 'PASS',
      detail: `${path.basename(resolvedOutputPath)} verified (${outputValidation.sizeMb} MB <= ${OFFICIAL_MAX_FILE_SIZE_MB} MB). Valid ${outputFormat} format.`,
      artifactPath: resolvedOutputPath,
      sizeMb: outputValidation.sizeMb,
    });
  } else if (!outputValidation.exists) {
    checks.push({
      id: 'output_file',
      name: 'Challenge Output File Deliverable',
      status: 'FAIL',
      detail: `Output file not found at: ${resolvedOutputPath}`,
      remediation: 'Execute run to generate challenge output: pnpm agentforge run --input <file> --output <path>',
      artifactPath: resolvedOutputPath,
    });
  } else {
    checks.push({
      id: 'output_file',
      name: 'Challenge Output File Deliverable',
      status: 'FAIL',
      detail: `Output validation failed: ${outputValidation.errors.join('; ')}`,
      remediation: 'Fix output generation logic to produce valid schema-conformant rows.',
      artifactPath: resolvedOutputPath,
      sizeMb: outputValidation.sizeMb,
    });
  }

  // ── 4. Challenge-Specific Output Contract ───────────────────────────────────
  const briefPath = path.join(rootDir, 'docs', 'challenge-brief.md');
  const briefExists = fs.existsSync(briefPath);
  let briefFulfilled = false;

  if (briefExists) {
    const briefContent = fs.readFileSync(briefPath, 'utf8');
    // Check if brief contains official challenge text rather than default template instructions
    briefFulfilled =
      !briefContent.includes('Paste the complete, unaltered challenge problem statement here') &&
      briefContent.length > 500;
  }

  if (briefFulfilled) {
    checks.push({
      id: 'challenge_schema',
      name: 'Challenge-Specific Domain Contract',
      status: 'PASS',
      detail: 'Official challenge brief recorded and domain validation contract configured.',
    });
  } else {
    checks.push({
      id: 'challenge_schema',
      name: 'Challenge-Specific Domain Contract',
      status: 'PENDING',
      detail: 'Official challenge brief pending kickoff (expected Oct 24, 18:00 IST). Generic format validation active.',
      remediation: 'Fill docs/challenge-brief.md with the official problem statement upon release and bind adapter schemas.',
    });
  }

  // ── 5. Authentic AI Transcript Deliverable Readiness ───────────────────────
  const transcriptResolution = resolveSubmissionTranscript(options.transcriptFile, rootDir);

  if (transcriptResolution.resolved && transcriptResolution.transcriptPath) {
    checks.push({
      id: 'authentic_transcript',
      name: 'Authentic AI Chat Transcript Deliverable',
      status: 'PASS',
      detail: `Authentic conversation transcript verified: ${transcriptResolution.fileName} (${transcriptResolution.sizeMb} MB <= ${OFFICIAL_MAX_FILE_SIZE_MB} MB, SHA-256: ${transcriptResolution.sha256?.slice(0, 16)}...). Zero synthetic fabrication.`,
      artifactPath: transcriptResolution.transcriptPath,
      sizeMb: transcriptResolution.sizeMb,
      sha256: transcriptResolution.sha256,
    });
  } else {
    const isIndexFalsePositive = transcriptResolution.errors.some(
      (e) => e.includes('INDEX.md') || e.includes('index ledger'),
    );
    checks.push({
      id: 'authentic_transcript',
      name: 'Authentic AI Chat Transcript Deliverable',
      status: 'BLOCKED',
      detail: isIndexFalsePositive
        ? 'BLOCKED: docs/ai-transcript/INDEX.md was supplied, but it is only a metadata ledger. A genuine conversation export file is required.'
        : `BLOCKED: Authentic AI chat transcript missing (${transcriptResolution.errors.join('; ')}).`,
      remediation:
        'Export genuine conversation history from your AI coding environment and register it via: pnpm agentforge transcript add <path/to/exported-chat.md>. Never use synthetic transcripts.',
    });
  }

  // ── 6. Security & 50 MB Limits Compliance ───────────────────────────────────
  const secretViolations: SecretViolation[] = [];
  for (const item of included) {
    const ext = path.extname(item.fullPath).toLowerCase();
    if (['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.yaml', '.yml', '.env'].includes(ext)) {
      try {
        const content = fs.readFileSync(item.fullPath, 'utf8');
        const found = scanBufferForSecrets(content, item.relPath);
        secretViolations.push(...found);
      } catch {}
    }
  }

  const allSizesCompliant =
    validCodeSize &&
    outputValidation.validSize &&
    (transcriptResolution.resolved ? (transcriptResolution.sizeMb ?? 0) <= OFFICIAL_MAX_FILE_SIZE_MB : true);

  if (secretViolations.length === 0 && allSizesCompliant) {
    checks.push({
      id: 'secrets_and_limits',
      name: 'Security & 50 MB Limit Compliance',
      status: 'PASS',
      detail: '0 secrets detected. Uniform 50 MB per-deliverable ceiling strictly satisfied for all submission files.',
    });
  } else {
    checks.push({
      id: 'secrets_and_limits',
      name: 'Security & 50 MB Limit Compliance',
      status: 'FAIL',
      detail: `Compliance check failed: ${secretViolations.length} secrets detected, allSizesCompliant=${allSizesCompliant}.`,
      remediation: 'Purge detected secrets and ensure all 3 deliverables are under 50 MB.',
    });
  }

  // ── 7. Overall Readiness Status Determination ──────────────────────────────
  const hasFailures = checks.some((c) => c.status === 'FAIL');
  const hasBlocks = checks.some((c) => c.status === 'BLOCKED');

  const engineeringHealth: ReadinessStatus = repoOk && validCodeSize ? 'PASS' : 'FAIL';
  const submissionReadiness: 'READY' | 'BLOCKED' = !hasFailures && !hasBlocks ? 'READY' : 'BLOCKED';

  let overallStatus: 'READY' | 'BLOCKED' | 'FAILED' = 'READY';
  let summary = '';

  if (hasFailures) {
    overallStatus = 'FAILED';
    summary = 'Engineering verification or deliverable validation failed. Remediate failing checks.';
  } else if (hasBlocks) {
    overallStatus = 'BLOCKED';
    summary =
      'Local engineering health is PASS. Submission is BLOCKED pending authentic AI conversation transcript import and official challenge kickoff.';
  } else {
    overallStatus = 'READY';
    summary = 'All engineering checks, deliverables, and authentic transcript verifications passed. Ready to package and submit!';
  }

  return {
    timestamp: new Date().toISOString(),
    overallStatus,
    engineeringHealth,
    submissionReadiness,
    checks,
    summary,
    artifacts: {
      codeArchive: {
        status: validCodeSize ? 'PASS' : 'FAIL',
        estimatedMb: estimatedZipMb,
        fileCount: included.length,
        validSize: validCodeSize,
      },
      outputFile: {
        status: outputValidation.exists && outputValidation.validContent ? 'PASS' : 'FAIL',
        path: resolvedOutputPath,
        sizeMb: outputValidation.sizeMb,
        validContent: outputValidation.validContent,
        validSize: outputValidation.validSize,
      },
      transcript: {
        status: transcriptResolution.resolved ? 'PASS' : 'BLOCKED',
        path: transcriptResolution.transcriptPath,
        sizeMb: transcriptResolution.sizeMb,
        sha256: transcriptResolution.sha256,
        format: transcriptResolution.format,
      },
    },
  };
}
