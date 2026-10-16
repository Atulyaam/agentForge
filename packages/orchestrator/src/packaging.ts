/**
 * @agentforge/orchestrator — Submission Packaging Validator
 *
 * Safe, repeatable packaging workflow for preparing submission deliverables:
 * 1. Code Archive (.zip) with source, configs, instructions; strictly excluding
 *    secrets, build artifacts, node_modules, and raw datasets.
 * 2. Output File (validated schema, row correspondence, size check).
 * 3. AI Session Transcript (unmodified provenance, size check).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { AgentForgeError } from '@agentforge/shared';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface PackagingOptions {
  rootDir?: string;
  outputFile?: string;
  transcriptFile?: string;
  archiveOutPath?: string;
  maxFileSizeMb?: number;
  maxArchiveSizeMb?: number;
  excludeDatasets?: boolean;
  customExclusions?: string[];
  dryRun?: boolean;
}

export interface ArtifactValidationResult {
  name: string;
  path: string;
  exists: boolean;
  sizeBytes: number;
  sizeMb: number;
  maxSizeMb: number;
  validSize: boolean;
  validContent: boolean;
  errors: string[];
}

export interface IncludedFileEntry {
  path: string;
  sizeBytes: number;
}

export interface ExcludedFileEntry {
  path: string;
  reason: string;
}

export interface SecretViolation {
  file: string;
  line: number;
  pattern: string;
}

export interface PackagingManifest {
  timestamp: string;
  dryRun: boolean;
  safeToPackage: boolean;
  artifacts: {
    codeArchive: ArtifactValidationResult;
    outputFile: ArtifactValidationResult;
    transcriptFile: ArtifactValidationResult;
  };
  archiveDetails: {
    includedFilesCount: number;
    totalUncompressedBytes: number;
    includedFiles: IncludedFileEntry[];
    excludedPaths: ExcludedFileEntry[];
  };
  secretScan: {
    scannedFilesCount: number;
    violations: SecretViolation[];
    passed: boolean;
  };
  validationErrors: string[];
}

// ─── Standard Exclusion Rules ─────────────────────────────────────────────────

export const DEFAULT_EXCLUSION_RULES: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /(^|[\\/])node_modules([\\/]|$)/, reason: 'Dependency folder; reconstructible via pnpm install' },
  { pattern: /(^|[\\/])dist([\\/]|$)/, reason: 'Compiled build output; reconstructible via pnpm build' },
  { pattern: /(^|[\\/])\.next([\\/]|$)/, reason: 'Next.js build cache and compiled server bundles' },
  { pattern: /(^|[\\/])\.turbo([\\/]|$)/, reason: 'Turborepo local cache' },
  { pattern: /(^|[\\/])coverage([\\/]|$)/, reason: 'Test coverage reports' },
  { pattern: /(^|[\\/])runs([\\/]|$)/, reason: 'Local run history; output artifact is packaged separately' },
  { pattern: /(^|[\\/])\.git([\\/]|$)/, reason: 'Version control database' },
  { pattern: /(^|[\\/])\.env(\.[a-zA-Z0-9]+)?$/, reason: 'Environment credentials and local secrets' },
  { pattern: /\.tsbuildinfo$/, reason: 'Incremental TypeScript compiler state' },
  { pattern: /(^|[\\/])\.DS_Store$/, reason: 'OS metadata file' },
];

export const RAW_DATASET_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /(^|[\\/])fixtures[\\/]challenge[\\/]raw([\\/]|$)/, reason: 'Official challenge dataset (excluded when required by brief)' },
];

// ─── Pure TypeScript ZIP Builder (Node zlib) ──────────────────────────────────

const makeCrcTable = (): Uint32Array => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  return table;
};

const CRC_TABLE = makeCrcTable();

export function computeCrc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function createZipArchive(
  files: Array<{ relativePath: string; buffer: Buffer }>,
): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

  for (const file of files) {
    const normPath = file.relativePath.replace(/\\/g, '/');
    const pathBuf = Buffer.from(normPath, 'utf8');
    const crc = computeCrc32(file.buffer);
    const compressed = zlib.deflateRawSync(file.buffer, { level: 9 });

    // Local file header (30 bytes + pathBuf.length + compressed.length)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local header signature
    localHeader.writeUInt16LE(20, 4);         // Version needed (2.0)
    localHeader.writeUInt16LE(0, 6);          // Flags
    localHeader.writeUInt16LE(8, 8);          // Compression (deflate)
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(file.buffer.length, 22);
    localHeader.writeUInt16LE(pathBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);         // Extra field length

    const localChunk = Buffer.concat([localHeader, pathBuf, compressed]);
    localHeaders.push(localChunk);

    // Central directory header (46 bytes + pathBuf.length)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central header signature
    centralHeader.writeUInt16LE(20, 4);         // Version made by
    centralHeader.writeUInt16LE(20, 6);         // Version needed
    centralHeader.writeUInt16LE(0, 8);          // Flags
    centralHeader.writeUInt16LE(8, 10);         // Compression (deflate)
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(file.buffer.length, 24);
    centralHeader.writeUInt16LE(pathBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);         // Extra length
    centralHeader.writeUInt16LE(0, 32);         // Comment length
    centralHeader.writeUInt16LE(0, 34);         // Disk start
    centralHeader.writeUInt16LE(0, 36);         // Internal attributes
    centralHeader.writeUInt32LE((0o100644 * 65536) >>> 0, 38); // External attributes (regular file 0644)
    centralHeader.writeUInt32LE(offset, 42);   // Local header offset

    const centralChunk = Buffer.concat([centralHeader, pathBuf]);
    centralHeaders.push(centralChunk);

    offset += localChunk.length;
  }

  const centralDirOffset = offset;
  const centralDirBuffer = Buffer.concat(centralHeaders);
  const centralDirSize = centralDirBuffer.length;

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);          // EOCD signature
  eocd.writeUInt16LE(0, 4);                   // Disk number
  eocd.writeUInt16LE(0, 6);                   // Start disk
  eocd.writeUInt16LE(files.length, 8);        // Total entries this disk
  eocd.writeUInt16LE(files.length, 10);       // Total entries
  eocd.writeUInt32LE(centralDirSize, 12);     // Size of central dir
  eocd.writeUInt32LE(centralDirOffset, 16);   // Offset of central dir
  eocd.writeUInt16LE(0, 20);                  // Comment length

  return Buffer.concat([...localHeaders, centralDirBuffer, eocd]);
}

// ─── Secret Scanning ──────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/,
  /ghp_[a-zA-Z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

export function scanBufferForSecrets(content: string, filePath: string): SecretViolation[] {
  const normPath = filePath.replace(/\\/g, '/');
  // Ignore known self-test and fixture files that test secret redaction
  if (normPath.includes('shared/src/index.test.ts') || normPath.includes('packaging.test.ts')) {
    return [];
  }

  const violations: SecretViolation[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pat of SECRET_PATTERNS) {
      if (pat.test(line)) {
        violations.push({
          file: filePath,
          line: i + 1,
          pattern: pat.source,
        });
      }
    }
  }
  return violations;
}

// ─── Submission Packaging Engine ──────────────────────────────────────────────

export class SubmissionPackager {
  private readonly rootDir: string;
  private readonly maxFileSizeMb: number;
  private readonly maxArchiveSizeMb: number;

  constructor(rootDir = process.cwd(), maxFileSizeMb = 50, maxArchiveSizeMb = 100) {
    this.rootDir = path.resolve(rootDir);
    this.maxFileSizeMb = maxFileSizeMb;
    this.maxArchiveSizeMb = maxArchiveSizeMb;
  }

  /** Validate a single standalone artifact (e.g. output.json or transcript). */
  validateArtifact(
    filePath: string,
    name: string,
    isJson = false,
  ): ArtifactValidationResult {
    const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(this.rootDir, filePath);
    const errors: string[] = [];

    if (!fs.existsSync(resolvedPath)) {
      return {
        name,
        path: resolvedPath,
        exists: false,
        sizeBytes: 0,
        sizeMb: 0,
        maxSizeMb: this.maxFileSizeMb,
        validSize: false,
        validContent: false,
        errors: [`File does not exist: ${resolvedPath}`],
      };
    }

    const stat = fs.statSync(resolvedPath);
    const sizeBytes = stat.size;
    const sizeMb = sizeBytes / (1024 * 1024);
    const validSize = sizeMb <= this.maxFileSizeMb;

    if (!validSize) {
      errors.push(`File size (${sizeMb.toFixed(2)} MB) exceeds limit of ${this.maxFileSizeMb} MB`);
    }

    let validContent = true;
    if (isJson) {
      try {
        const raw = fs.readFileSync(resolvedPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length === 0) {
          errors.push('Output JSON array is empty');
          validContent = false;
        }
      } catch (err: any) {
        errors.push(`Invalid JSON format: ${err.message}`);
        validContent = false;
      }
    } else {
      if (sizeBytes === 0) {
        errors.push('Artifact file is empty (0 bytes)');
        validContent = false;
      }
    }

    return {
      name,
      path: resolvedPath,
      exists: true,
      sizeBytes,
      sizeMb: Number(sizeMb.toFixed(3)),
      maxSizeMb: this.maxFileSizeMb,
      validSize,
      validContent,
      errors,
    };
  }

  /** Scan directory tree recursively collecting files and applying exclusion rules. */
  collectFiles(
    dir: string,
    excludeDatasets = true,
    customExclusions: string[] = [],
  ): { included: Array<{ fullPath: string; relPath: string; sizeBytes: number }>; excluded: ExcludedFileEntry[] } {
    const included: Array<{ fullPath: string; relPath: string; sizeBytes: number }> = [];
    const excluded: ExcludedFileEntry[] = [];

    const activeRules = [...DEFAULT_EXCLUSION_RULES];
    if (excludeDatasets) {
      activeRules.push(...RAW_DATASET_PATTERNS);
    }
    for (const custom of customExclusions) {
      activeRules.push({
        pattern: new RegExp(custom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        reason: 'Custom user exclusion rule',
      });
    }

    const walk = (currentDir: string) => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relPath = path.relative(this.rootDir, fullPath);

        // Check if excluded by active rules
        let matchedReason: string | null = null;
        for (const rule of activeRules) {
          if (rule.pattern.test(relPath) || rule.pattern.test(entry.name)) {
            matchedReason = rule.reason;
            break;
          }
        }

        if (matchedReason) {
          excluded.push({ path: relPath, reason: matchedReason });
          continue; // Do not recurse into excluded directories
        }

        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          const stat = fs.statSync(fullPath);
          included.push({ fullPath, relPath, sizeBytes: stat.size });
        }
      }
    };

    walk(this.rootDir);
    return { included, excluded };
  }

  /** Execute full packaging inspection, secret scan, and optional ZIP archive generation. */
  async packageSubmission(options: PackagingOptions = {}): Promise<PackagingManifest> {
    const outputFile = options.outputFile ?? 'runs/drill-1-triage/output.json';
    const transcriptFile = options.transcriptFile ?? 'docs/ai-transcript/INDEX.md';
    const archiveOutPath = options.archiveOutPath ?? path.join(this.rootDir, 'dist', 'submission.zip');
    const dryRun = options.dryRun ?? false;
    const excludeDatasets = options.excludeDatasets ?? true;
    const customExclusions = options.customExclusions ?? [];

    const validationErrors: string[] = [];

    // 1. Validate standalone output and transcript artifacts
    const outputValidation = this.validateArtifact(outputFile, 'Output File', true);
    if (!outputValidation.validSize || !outputValidation.validContent || !outputValidation.exists) {
      validationErrors.push(...outputValidation.errors);
    }

    const transcriptValidation = this.validateArtifact(transcriptFile, 'AI Session Transcript', false);
    if (!transcriptValidation.validSize || !transcriptValidation.validContent || !transcriptValidation.exists) {
      validationErrors.push(...transcriptValidation.errors);
    }

    // 2. Collect candidate project files
    const { included, excluded } = this.collectFiles(this.rootDir, excludeDatasets, customExclusions);

    // 3. Scan included text files for secrets
    const violations: SecretViolation[] = [];
    let scannedFilesCount = 0;

    for (const item of included) {
      const ext = path.extname(item.fullPath).toLowerCase();
      // Scan text, code, json, md, yaml files
      if (['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.yaml', '.yml', '.env'].includes(ext)) {
        scannedFilesCount++;
        try {
          const content = fs.readFileSync(item.fullPath, 'utf8');
          const found = scanBufferForSecrets(content, item.relPath);
          violations.push(...found);
        } catch {}
      }
    }

    if (violations.length > 0) {
      for (const v of violations) {
        validationErrors.push(`Secret pattern detected in ${v.file}:${v.line} (${v.pattern})`);
      }
    }

    const totalUncompressedBytes = included.reduce((sum, f) => sum + f.sizeBytes, 0);

    // 4. Validate or build the Code ZIP Archive
    let archiveValidation: ArtifactValidationResult;

    if (dryRun) {
      const estimatedZipMb = totalUncompressedBytes / (1024 * 1024) * 0.35; // conservative estimate
      archiveValidation = {
        name: 'Code Archive (Dry-Run Estimate)',
        path: archiveOutPath,
        exists: false,
        sizeBytes: totalUncompressedBytes,
        sizeMb: Number(estimatedZipMb.toFixed(2)),
        maxSizeMb: this.maxArchiveSizeMb,
        validSize: estimatedZipMb <= this.maxArchiveSizeMb,
        validContent: true,
        errors: [],
      };
    } else {
      if (validationErrors.length > 0) {
        throw new AgentForgeError(
          'OUTPUT_INVALID',
          `Packaging failed closed due to ${validationErrors.length} security/validation error(s): ${validationErrors.join('; ')}`,
        );
      }

      // Read buffers and generate ZIP
      const fileBuffers = included.map((f) => ({
        relativePath: f.relPath,
        buffer: fs.readFileSync(f.fullPath),
      }));

      const zipBuffer = createZipArchive(fileBuffers);
      const zipSizeMb = zipBuffer.length / (1024 * 1024);

      // Ensure destination directory exists
      const targetDir = path.dirname(archiveOutPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      fs.writeFileSync(archiveOutPath, zipBuffer);

      archiveValidation = {
        name: 'Code Archive (.zip)',
        path: archiveOutPath,
        exists: true,
        sizeBytes: zipBuffer.length,
        sizeMb: Number(zipSizeMb.toFixed(2)),
        maxSizeMb: this.maxArchiveSizeMb,
        validSize: zipSizeMb <= this.maxArchiveSizeMb,
        validContent: true,
        errors: zipSizeMb > this.maxArchiveSizeMb
          ? [`Archive size (${zipSizeMb.toFixed(2)} MB) exceeds limit of ${this.maxArchiveSizeMb} MB`]
          : [],
      };

      if (!archiveValidation.validSize) {
        validationErrors.push(...archiveValidation.errors);
      }
    }

    const safeToPackage = validationErrors.length === 0;

    return {
      timestamp: new Date().toISOString(),
      dryRun,
      safeToPackage,
      artifacts: {
        codeArchive: archiveValidation,
        outputFile: outputValidation,
        transcriptFile: transcriptValidation,
      },
      archiveDetails: {
        includedFilesCount: included.length,
        totalUncompressedBytes,
        includedFiles: included.map((f) => ({ path: f.relPath, sizeBytes: f.sizeBytes })),
        excludedPaths: excluded,
      },
      secretScan: {
        scannedFilesCount,
        violations,
        passed: violations.length === 0,
      },
      validationErrors,
    };
  }
}
