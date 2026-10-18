/**
 * Integration Tests for Submission Packaging Validator (Workstream 1 & 2)
 *
 * Verifies:
 * - Uniform 50 MB limits aligned with HackerRank Orchestrate rules
 * - Boundary conditions (compliant, exactly at limit, 1 byte over limit, missing, unreadable)
 * - Contest mode enforcement preventing silent over-limit disqualifications
 * - Pluggable output format validators (JSON, JSONL, CSV, Text, Any, Custom function)
 * - Pre-archive fast-failure prior to expensive zip deflation
 * - Archive exclusions (node_modules, dist, .next, runs, raw datasets)
 * - Secret detection and fail-closed security behavior
 * - Pure TypeScript ZIP archive generation & CRC32 integrity
 * - Dry-run mode manifest inspection without writing files
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  SubmissionPackager,
  scanBufferForSecrets,
  computeCrc32,
  createZipArchive,
  OFFICIAL_MAX_FILE_SIZE_MB,
  OFFICIAL_MAX_FILE_SIZE_BYTES,
} from '@agentforge/orchestrator';
import { AgentForgeError } from '@agentforge/shared';

describe('Submission Packaging Validator & Compliance', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-pack-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('Official 50 MB Limits & Contest Mode Enforcement', () => {
    it('defaults to 50 MB for both artifact and archive limits', () => {
      const packager = new SubmissionPackager(tempDir);
      expect(OFFICIAL_MAX_FILE_SIZE_MB).toBe(50);
      expect(OFFICIAL_MAX_FILE_SIZE_BYTES).toBe(52428800);
      // Validating a 100-byte file against defaults
      const filePath = path.join(tempDir, 'sample.txt');
      fs.writeFileSync(filePath, 'AgentForge verification');
      const res = packager.validateArtifact(filePath, 'Test File');
      expect(res.maxSizeMb).toBe(50);
      expect(res.maxSizeBytes).toBe(52428800);
    });

    it('enforces contest mode by rejecting configurations > 50 MB with CONFIG_INVALID', () => {
      expect(() => {
        new SubmissionPackager(tempDir, 51, 50, true);
      }).toThrowError(/exceeds official contest ceiling/);

      expect(() => {
        new SubmissionPackager(tempDir, 50, 100, true);
      }).toThrowError(/exceeds official contest ceiling/);
    });

    it('allows customized limits when contestMode is explicitly false', () => {
      const packager = new SubmissionPackager(tempDir, 100, 200, false);
      const filePath = path.join(tempDir, 'sample.txt');
      fs.writeFileSync(filePath, 'Relaxed limits test');
      const res = packager.validateArtifact(filePath, 'Test File');
      expect(res.maxSizeMb).toBe(100);
    });
  });

  describe('Exact Byte Boundary Tests', () => {
    it('passes for compliant file strictly below limit', () => {
      // 0.001 MB limit = 1048 bytes
      const testLimitMb = 0.001;
      const maxBytes = Math.floor(testLimitMb * 1024 * 1024); // 1048 bytes
      const compliantBytes = maxBytes - 100;

      const filePath = path.join(tempDir, 'compliant.bin');
      fs.writeFileSync(filePath, Buffer.alloc(compliantBytes, 0x42));

      const packager = new SubmissionPackager(tempDir, testLimitMb, testLimitMb, false);
      const res = packager.validateArtifact(filePath, 'Compliant', 'any');

      expect(res.exists).toBe(true);
      expect(res.sizeBytes).toBe(compliantBytes);
      expect(res.validSize).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('passes for file exactly at the configured byte limit', () => {
      const testLimitMb = 0.001; // 1048 bytes
      const maxBytes = Math.floor(testLimitMb * 1024 * 1024);

      const filePath = path.join(tempDir, 'exact-boundary.bin');
      fs.writeFileSync(filePath, Buffer.alloc(maxBytes, 0x42));

      const packager = new SubmissionPackager(tempDir, testLimitMb, testLimitMb, false);
      const res = packager.validateArtifact(filePath, 'Exact Boundary', 'any');

      expect(res.exists).toBe(true);
      expect(res.sizeBytes).toBe(maxBytes);
      expect(res.validSize).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('fails for file exactly 1 byte over the configured byte limit', () => {
      const testLimitMb = 0.001; // 1048 bytes
      const maxBytes = Math.floor(testLimitMb * 1024 * 1024);
      const overBytes = maxBytes + 1;

      const filePath = path.join(tempDir, 'over-boundary.bin');
      fs.writeFileSync(filePath, Buffer.alloc(overBytes, 0x42));

      const packager = new SubmissionPackager(tempDir, testLimitMb, testLimitMb, false);
      const res = packager.validateArtifact(filePath, 'Over Boundary', 'any');

      expect(res.exists).toBe(true);
      expect(res.sizeBytes).toBe(overBytes);
      expect(res.validSize).toBe(false);
      expect(res.errors[0]).toContain('exceeds limit');
    });

    it('fails when artifact does not exist', () => {
      const filePath = path.join(tempDir, 'nonexistent-artifact.json');
      const packager = new SubmissionPackager(tempDir, 10, 10);
      const res = packager.validateArtifact(filePath, 'Missing File', 'any');

      expect(res.exists).toBe(false);
      expect(res.validSize).toBe(false);
      expect(res.errors[0]).toContain('does not exist');
    });

    it('handles unreadable files gracefully and marks invalid', () => {
      const dirAsFilePath = path.join(tempDir, 'unreadable-dir');
      fs.mkdirSync(dirAsFilePath);

      const packager = new SubmissionPackager(tempDir, 10, 10);
      const res = packager.validateArtifact(dirAsFilePath, 'Locked File', 'json');

      expect(res.exists).toBe(true);
      expect(res.validContent).toBe(false);
      expect(res.isUnreadable).toBe(true);
      expect(res.errors[0]).toContain('cannot be read');
    });
  });

  describe('Configurable Output Validator Strategies', () => {
    it('validates JSON output (valid, corrupt, empty)', () => {
      const packager = new SubmissionPackager(tempDir, 10, 10);

      const validPath = path.join(tempDir, 'valid.json');
      fs.writeFileSync(validPath, JSON.stringify([{ id: '1', result: 'ok' }]));
      expect(packager.validateArtifact(validPath, 'Out', 'json').validContent).toBe(true);

      const corruptPath = path.join(tempDir, 'corrupt.json');
      fs.writeFileSync(corruptPath, '{ corrupt json');
      const corruptRes = packager.validateArtifact(corruptPath, 'Out', 'json');
      expect(corruptRes.validContent).toBe(false);
      expect(corruptRes.errors[0]).toContain('Invalid JSON format');

      const emptyPath = path.join(tempDir, 'empty.json');
      fs.writeFileSync(emptyPath, '[]');
      const emptyRes = packager.validateArtifact(emptyPath, 'Out', 'json');
      expect(emptyRes.validContent).toBe(false);
      expect(emptyRes.errors[0]).toContain('Output JSON array is empty');
    });

    it('validates JSONL output strategy', () => {
      const packager = new SubmissionPackager(tempDir, 10, 10);

      const validJsonl = path.join(tempDir, 'valid.jsonl');
      fs.writeFileSync(validJsonl, '{"id":1}\n{"id":2}\n');
      expect(packager.validateArtifact(validJsonl, 'Out', 'jsonl').validContent).toBe(true);

      const corruptJsonl = path.join(tempDir, 'corrupt.jsonl');
      fs.writeFileSync(corruptJsonl, '{"id":1}\n{bad json}\n');
      const res = packager.validateArtifact(corruptJsonl, 'Out', 'jsonl');
      expect(res.validContent).toBe(false);
      expect(res.errors[0]).toContain('Invalid JSON at line 2');
    });

    it('validates CSV output strategy', () => {
      const packager = new SubmissionPackager(tempDir, 10, 10);

      const validCsv = path.join(tempDir, 'valid.csv');
      fs.writeFileSync(validCsv, 'id,category,priority\n1,billing,P1\n');
      expect(packager.validateArtifact(validCsv, 'Out', 'csv').validContent).toBe(true);

      const headerOnlyCsv = path.join(tempDir, 'header-only.csv');
      fs.writeFileSync(headerOnlyCsv, 'id,category,priority\n');
      const res = packager.validateArtifact(headerOnlyCsv, 'Out', 'csv');
      expect(res.validContent).toBe(false);
      expect(res.errors[0]).toContain('must contain at least a header row and 1 data row');
    });

    it('validates plain text output strategy', () => {
      const packager = new SubmissionPackager(tempDir, 10, 10);

      const validText = path.join(tempDir, 'valid.txt');
      fs.writeFileSync(validText, 'Predicted output summary\n');
      expect(packager.validateArtifact(validText, 'Out', 'text').validContent).toBe(true);

      const emptyText = path.join(tempDir, 'empty.txt');
      fs.writeFileSync(emptyText, '   \n\t  ');
      const res = packager.validateArtifact(emptyText, 'Out', 'text');
      expect(res.validContent).toBe(false);
      expect(res.errors[0]).toContain('Output text file is empty');
    });

    it('supports custom function validator strategy', () => {
      const packager = new SubmissionPackager(tempDir, 10, 10);
      const customPath = path.join(tempDir, 'custom.tsv');
      fs.writeFileSync(customPath, 'COL_A\tCOL_B\nval1\tval2\n');

      const customValidator = (content: string) => {
        const lines = content.trim().split('\n');
        return {
          valid: lines.length >= 2 && lines[0].includes('\t'),
          errors: lines.length < 2 ? ['Need at least 2 TSV rows'] : [],
        };
      };

      const res = packager.validateArtifact(customPath, 'TSV Out', customValidator);
      expect(res.validContent).toBe(true);
    });
  });

  describe('Pre-Archive Fast Failure & Fail-Closed Guard', () => {
    it('aborts early before archive compression when output file is missing or invalid', async () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
      const transMd = path.join(tempDir, 'transcript.md');
      fs.writeFileSync(transMd, '# Authentic Conversation Log');
      const targetZip = path.join(tempDir, 'dist', 'submission.zip');

      const packager = new SubmissionPackager(tempDir, 50, 50);

      // Point to nonexistent output file
      await expect(
        packager.packageSubmission({
          outputFile: path.join(tempDir, 'nonexistent.json'),
          transcriptFile: transMd,
          archiveOutPath: targetZip,
          dryRun: false,
        }),
      ).rejects.toThrow(/Packaging failed closed before archiving/);

      // Verify no archive was generated
      expect(fs.existsSync(targetZip)).toBe(false);
    });

    it('aborts early before archive compression when transcript file is missing or empty', async () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
      const outJson = path.join(tempDir, 'out.json');
      fs.writeFileSync(outJson, JSON.stringify([{ id: '1' }]));
      const targetZip = path.join(tempDir, 'dist', 'submission.zip');

      const packager = new SubmissionPackager(tempDir, 50, 50);

      // Point to nonexistent transcript file
      await expect(
        packager.packageSubmission({
          outputFile: outJson,
          transcriptFile: path.join(tempDir, 'missing-transcript.md'),
          archiveOutPath: targetZip,
          dryRun: false,
        }),
      ).rejects.toThrow(/Packaging failed closed before archiving/);

      expect(fs.existsSync(targetZip)).toBe(false);
    });
  });

  describe('Archive Exclusion Rules', () => {
    it('strictly excludes node_modules, dist, .next, runs, .env, and build caches', () => {
      // Setup mock repository tree in tempDir
      fs.mkdirSync(path.join(tempDir, 'packages', 'core', 'src'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'node_modules', 'dep'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'dist'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.next'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'runs', 'run-01'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'fixtures', 'challenge', 'raw'), { recursive: true });

      // Create files
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
      fs.writeFileSync(path.join(tempDir, 'packages', 'core', 'src', 'index.ts'), 'export const a = 1;');
      fs.writeFileSync(path.join(tempDir, 'node_modules', 'dep', 'index.js'), 'bad');
      fs.writeFileSync(path.join(tempDir, 'dist', 'index.js'), 'compiled');
      fs.writeFileSync(path.join(tempDir, '.next', 'cache.json'), 'cache');
      fs.writeFileSync(path.join(tempDir, 'runs', 'run-01', 'output.json'), 'run');
      fs.writeFileSync(path.join(tempDir, '.env'), 'SECRET_KEY=123');
      fs.writeFileSync(path.join(tempDir, 'build.tsbuildinfo'), 'info');
      fs.writeFileSync(path.join(tempDir, 'fixtures', 'challenge', 'raw', 'large-corpus.csv'), 'corpus');

      const packager = new SubmissionPackager(tempDir, 50, 50);
      const { included, excluded } = packager.collectFiles(tempDir, true);

      const includedRelPaths = included.map((f) => f.relPath.replace(/\\/g, '/'));
      const excludedRelPaths = excluded.map((f) => f.path.replace(/\\/g, '/'));

      // Verified inclusions
      expect(includedRelPaths).toContain('package.json');
      expect(includedRelPaths).toContain('packages/core/src/index.ts');

      // Verified exclusions
      expect(excludedRelPaths).toContain('node_modules');
      expect(excludedRelPaths).toContain('dist');
      expect(excludedRelPaths).toContain('.next');
      expect(excludedRelPaths).toContain('runs');
      expect(excludedRelPaths).toContain('.env');
      expect(excludedRelPaths).toContain('build.tsbuildinfo');
      expect(excludedRelPaths).toContain('fixtures/challenge/raw');

      // Zero excluded files in included set
      expect(includedRelPaths.some((p) => p.startsWith('node_modules'))).toBe(false);
      expect(includedRelPaths.some((p) => p.startsWith('dist'))).toBe(false);
      expect(includedRelPaths.some((p) => p.includes('.env'))).toBe(false);
    });
  });

  describe('Secret Scanning & Fail-Closed Policy', () => {
    it('detects live API key patterns and private keys', () => {
      const apiKeyContent = 'const key = "sk-abcdef1234567890abcdef1234567890";';
      const violations = scanBufferForSecrets(apiKeyContent, 'src/api.ts');

      expect(violations).toHaveLength(1);
      expect(violations[0].file).toBe('src/api.ts');
      expect(violations[0].line).toBe(1);
    });

    it('returns 0 violations for clean code', () => {
      const cleanContent = 'export function calculateLift(a: number, b: number) { return a - b; }';
      const violations = scanBufferForSecrets(cleanContent, 'src/math.ts');

      expect(violations).toHaveLength(0);
    });

    it('fails closed when candidate archive files contain secrets', async () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
      fs.writeFileSync(path.join(tempDir, 'secret-leak.ts'), 'const leaked = "sk-12345678901234567890abcdef";');
      const outJson = path.join(tempDir, 'out.json');
      fs.writeFileSync(outJson, JSON.stringify([{ id: '1', res: 'ok' }]));
      const transMd = path.join(tempDir, 'transcript.md');
      fs.writeFileSync(transMd, '# Transcript');

      const packager = new SubmissionPackager(tempDir, 50, 50);

      // In non-dry-run mode, must throw AgentForgeError
      await expect(
        packager.packageSubmission({
          outputFile: outJson,
          transcriptFile: transMd,
          dryRun: false,
        }),
      ).rejects.toThrow(/Packaging failed closed/);
    });
  });

  describe('ZIP Archive Creation & CRC32 Integrity', () => {
    it('computes correct standard CRC32 values', () => {
      const data = Buffer.from('123456789', 'utf8');
      const crc = computeCrc32(data);
      // Standard CRC-32 check value for "123456789" is 0xcbf43926 (3421780262)
      expect(crc).toBe(0xcbf43926);
    });

    it('generates valid ZIP buffer with local, central, and EOCD signatures', () => {
      const files = [
        { relativePath: 'README.md', buffer: Buffer.from('# Test Project', 'utf8') },
        { relativePath: 'src/index.ts', buffer: Buffer.from('console.log("hello");', 'utf8') },
      ];

      const zipBuf = createZipArchive(files);

      expect(zipBuf.length).toBeGreaterThan(0);
      // Check PK\x03\x04 signature at offset 0
      expect(zipBuf.readUInt32LE(0)).toBe(0x04034b50);
      // Check that EOCD signature PK\x05\x06 exists near end
      expect(zipBuf.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBe(true);
    });
  });

  describe('End-to-End Dry-Run & Full Packaging Workflow', () => {
    it('dry-run reports full manifest without creating destination archive', async () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
      fs.writeFileSync(path.join(tempDir, 'README.md'), '# Test');
      fs.mkdirSync(path.join(tempDir, 'runs'), { recursive: true });
      const outJson = path.join(tempDir, 'runs', 'out.json');
      fs.writeFileSync(outJson, JSON.stringify([{ id: '1', res: 'ok' }]));
      const transMd = path.join(tempDir, 'transcript.md');
      fs.writeFileSync(transMd, '# Transcript');
      const targetZip = path.join(tempDir, 'dist', 'submission.zip');

      const packager = new SubmissionPackager(tempDir, 50, 50);
      const manifest = await packager.packageSubmission({
        outputFile: outJson,
        transcriptFile: transMd,
        archiveOutPath: targetZip,
        dryRun: true,
      });

      expect(manifest.safeToPackage).toBe(true);
      expect(manifest.dryRun).toBe(true);
      // package.json, README.md, transcript.md (runs/out.json excluded)
      expect(manifest.archiveDetails.includedFilesCount).toBe(3);
      expect(manifest.artifacts.outputFile.exists).toBe(true);
      expect(manifest.artifacts.transcriptFile.exists).toBe(true);
      // Target zip should NOT exist after dry run
      expect(fs.existsSync(targetZip)).toBe(false);
    });

    it('generates real submission ZIP on clean project tree within 50 MB limit', async () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
      fs.writeFileSync(path.join(tempDir, 'README.md'), '# Clean Project');
      const outJson = path.join(tempDir, 'out.json');
      fs.writeFileSync(outJson, JSON.stringify([{ id: '1', val: 'success' }]));
      const transMd = path.join(tempDir, 'transcript.md');
      fs.writeFileSync(transMd, '# Conversation log');
      const targetZip = path.join(tempDir, 'dist', 'submission.zip');

      const packager = new SubmissionPackager(tempDir, 50, 50);
      const manifest = await packager.packageSubmission({
        outputFile: outJson,
        transcriptFile: transMd,
        archiveOutPath: targetZip,
        dryRun: false,
      });

      expect(manifest.safeToPackage).toBe(true);
      expect(manifest.dryRun).toBe(false);
      expect(fs.existsSync(targetZip)).toBe(true);
      expect(fs.statSync(targetZip).size).toBeGreaterThan(50);
      expect(fs.statSync(targetZip).size).toBeLessThan(OFFICIAL_MAX_FILE_SIZE_BYTES);
    });
  });

  describe('Authentic Transcript Submission Integrity & False-Positive Regressions (Workstream 2)', () => {
    it('fails closed when docs/ai-transcript/INDEX.md is supplied as transcript (rehearsal false-positive regression)', async () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
      const outJson = path.join(tempDir, 'out.json');
      fs.writeFileSync(outJson, JSON.stringify([{ id: '1', result: 'ok' }]));

      // Create INDEX.md table
      const vaultDir = path.join(tempDir, 'docs', 'ai-transcript');
      fs.mkdirSync(vaultDir, { recursive: true });
      const indexMd = path.join(vaultDir, 'INDEX.md');
      fs.writeFileSync(
        indexMd,
        '# AI Transcript Vault\n\n| Date | File | SHA-256 |\n|---|---|---|\n',
      );

      const packager = new SubmissionPackager(tempDir);
      const manifest = await packager.packageSubmission({
        outputFile: outJson,
        transcriptFile: indexMd, // The exact false-positive scenario
        dryRun: true,
      });

      expect(manifest.safeToPackage).toBe(false);
      expect(manifest.artifacts.transcriptFile.validContent).toBe(false);
      expect(
        manifest.validationErrors.some((e) =>
          e.includes('is a vault index ledger, not an authentic AI conversation transcript'),
        ),
      ).toBe(true);
    });

    it('fails closed when transcriptFile is omitted and vault contains 0 authentic transcripts', async () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
      const outJson = path.join(tempDir, 'out.json');
      fs.writeFileSync(outJson, JSON.stringify([{ id: '1', result: 'ok' }]));

      // Omit transcriptFile completely and vault has no registered genuine files
      const packager = new SubmissionPackager(tempDir);
      const manifest = await packager.packageSubmission({
        outputFile: outJson,
        dryRun: true,
      });

      expect(manifest.safeToPackage).toBe(false);
      expect(manifest.artifacts.transcriptFile.validContent).toBe(false);
      expect(
        manifest.validationErrors.some((e) =>
          e.includes('No authentic AI conversation transcript registered'),
        ),
      ).toBe(true);
    });

    it('rejects empty or whitespace-only transcript files', async () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
      const outJson = path.join(tempDir, 'out.json');
      fs.writeFileSync(outJson, JSON.stringify([{ id: '1', result: 'ok' }]));

      const emptyTranscript = path.join(tempDir, 'empty-transcript.txt');
      fs.writeFileSync(emptyTranscript, '    \n\t   ');

      const packager = new SubmissionPackager(tempDir);
      const manifest = await packager.packageSubmission({
        outputFile: outJson,
        transcriptFile: emptyTranscript,
        dryRun: true,
      });

      expect(manifest.safeToPackage).toBe(false);
      expect(manifest.artifacts.transcriptFile.validContent).toBe(false);
      expect(
        manifest.validationErrors.some((e) => e.includes('empty or contains only whitespace')),
      ).toBe(true);
    });
  });
});
