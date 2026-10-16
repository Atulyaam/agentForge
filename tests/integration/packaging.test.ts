/**
 * Integration Tests for Submission Packaging Validator (Workstream 2)
 *
 * Verifies:
 * - Artifact path validation & size limit enforcement
 * - Archive exclusions (node_modules, dist, .env, runs, raw datasets)
 * - Secret detection and fail-closed security behavior
 * - Pure TypeScript ZIP archive generation & CRC32 integrity
 * - Dry-run mode manifest inspection without writing files
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  SubmissionPackager,
  scanBufferForSecrets,
  computeCrc32,
  createZipArchive,
} from '@agentforge/orchestrator';

describe('Submission Packaging Validator — Workstream 2', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-pack-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('Artifact Validation & Size Limits', () => {
    it('validates existing non-empty file within size limits', () => {
      const filePath = path.join(tempDir, 'valid.json');
      fs.writeFileSync(filePath, JSON.stringify([{ id: 'rec-1', text: 'ok' }]));

      const packager = new SubmissionPackager(tempDir, 10, 50);
      const res = packager.validateArtifact(filePath, 'Test JSON', true);

      expect(res.exists).toBe(true);
      expect(res.validSize).toBe(true);
      expect(res.validContent).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('fails when artifact does not exist', () => {
      const filePath = path.join(tempDir, 'missing.json');
      const packager = new SubmissionPackager(tempDir, 10, 50);
      const res = packager.validateArtifact(filePath, 'Missing File', true);

      expect(res.exists).toBe(false);
      expect(res.errors[0]).toContain('does not exist');
    });

    it('fails when output file contains invalid JSON', () => {
      const filePath = path.join(tempDir, 'corrupt.json');
      fs.writeFileSync(filePath, '{ invalid json');

      const packager = new SubmissionPackager(tempDir, 10, 50);
      const res = packager.validateArtifact(filePath, 'Corrupt Output', true);

      expect(res.exists).toBe(true);
      expect(res.validContent).toBe(false);
      expect(res.errors[0]).toContain('Invalid JSON format');
    });

    it('fails when output JSON array is empty', () => {
      const filePath = path.join(tempDir, 'empty.json');
      fs.writeFileSync(filePath, '[]');

      const packager = new SubmissionPackager(tempDir, 10, 50);
      const res = packager.validateArtifact(filePath, 'Empty Output', true);

      expect(res.validContent).toBe(false);
      expect(res.errors[0]).toContain('Output JSON array is empty');
    });

    it('enforces maximum per-file size limit', () => {
      const filePath = path.join(tempDir, 'large.txt');
      // Create a 2 MB file with limit of 1 MB
      const largeBuf = Buffer.alloc(2 * 1024 * 1024, 'A');
      fs.writeFileSync(filePath, largeBuf);

      const packager = new SubmissionPackager(tempDir, 1.0, 50);
      const res = packager.validateArtifact(filePath, 'Large File', false);

      expect(res.exists).toBe(true);
      expect(res.validSize).toBe(false);
      expect(res.errors[0]).toContain('exceeds limit');
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

      const packager = new SubmissionPackager(tempDir, 50, 100);
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

      const packager = new SubmissionPackager(tempDir, 50, 100);

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

      const packager = new SubmissionPackager(tempDir, 50, 100);
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

    it('generates real submission ZIP on clean project tree', async () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
      fs.writeFileSync(path.join(tempDir, 'README.md'), '# Clean Project');
      const outJson = path.join(tempDir, 'out.json');
      fs.writeFileSync(outJson, JSON.stringify([{ id: '1', val: 'success' }]));
      const transMd = path.join(tempDir, 'transcript.md');
      fs.writeFileSync(transMd, '# Conversation log');
      const targetZip = path.join(tempDir, 'dist', 'submission.zip');

      const packager = new SubmissionPackager(tempDir, 50, 100);
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
    });
  });
});
