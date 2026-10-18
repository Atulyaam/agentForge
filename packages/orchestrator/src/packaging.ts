/**
 * @agentforge/orchestrator — Submission Packaging Validator
 *
 * Safe, repeatable packaging workflow for preparing submission deliverables:
 * 1. Code Archive (.zip) with source, configs, instructions; strictly excluding
 *    secrets, build artifacts, node_modules, and raw datasets.
 * 2. Output File (configurable validator strategy, row correspondence, size check).
 * 3. AI Session Transcript (unmodified provenance, size check).
 *
 * HackerRank Orchestrate Contest Rule:
 * Each of the three submitted files (code ZIP, output, transcript) may be up to 50 MB.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { AgentForgeError } from '@agentforge/shared';
import { resolveSubmissionTranscript } from './transcript.js';

// ─── Constants & Limits ───────────────────────────────────────────────────────

/** Official HackerRank Orchestrate single-file submission ceiling (50 MB). */
export const OFFICIAL_MAX_FILE_SIZE_MB = 50;

/** Exact byte limit: 50 MiB = 52,428,800 bytes. */
export const OFFICIAL_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

// ─── Interfaces & Strategies ──────────────────────────────────────────────────

export type OutputValidatorFn = (
  content: string,
  filePath: string,
) => { valid: boolean; errors: string[] };

export type OutputValidatorStrategy =
  | 'json'
  | 'jsonl'
  | 'csv'
  | 'text'
  | 'any'
  | OutputValidatorFn;

export interface PackagingOptions {
  rootDir?: string;
  outputFile?: string;
  transcriptFile?: string;
  archiveOutPath?: string;
  maxFileSizeMb?: number;      // Default: 50 MB
  maxArchiveSizeMb?: number;   // Default: 50 MB (matches HackerRank 50 MB limit)
  contestMode?: boolean;       // Default: true (prohibits limits > 50 MB)
  outputFormat?: OutputValidatorStrategy; // Default: 'json'
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
  maxSizeBytes: number;
  maxSizeMb: number;
  validSize: boolean;
  validContent: boolean;
  isUnreadable?: boolean;
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
  { pattern: /(^|[\\/])Thumbs\.db$/, reason: 'OS thumbnail cache' },
  { pattern: /\.(pem|key)$/, reason: 'Cryptographic certificates and private keys' },
  { pattern: /(^|[\\/])id_rsa([._-].*)?$/, reason: 'SSH private key file' },
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
  /sk-[a-zA-Z0-9_-]{20,}/,
  /ghp_[a-zA-Z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

export function scanBufferForSecrets(content: string, filePath: string): SecretViolation[] {
  const normPath = filePath.replace(/\\/g, '/');
  // Ignore known self-test and fixture files that test secret redaction
  if (
    normPath.includes('shared/src/index.test.ts') ||
    normPath.includes('packaging.test.ts') ||
    normPath.includes('transcript.test.ts') ||
    normPath.includes('doctor.test.ts') ||
    normPath.includes('submission-gate.test.ts') ||
    normPath.includes('live-provider.test.ts') ||
    normPath.includes('provider-validation.test.ts') ||
    normPath.includes('fixtures/injection/')
  ) {
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
  private readonly contestMode: boolean;
  private readonly outputFormat: OutputValidatorStrategy;

  constructor(
    rootDir = process.cwd(),
    maxFileSizeMb = OFFICIAL_MAX_FILE_SIZE_MB,
    maxArchiveSizeMb = OFFICIAL_MAX_FILE_SIZE_MB,
    contestMode = true,
    outputFormat: OutputValidatorStrategy = 'json',
  ) {
    this.rootDir = path.resolve(rootDir);
    this.contestMode = contestMode;
    this.outputFormat = outputFormat;

    // Prevent silent contest disqualification by enforcing the 50 MB ceiling
    if (this.contestMode) {
      if (maxFileSizeMb > OFFICIAL_MAX_FILE_SIZE_MB || maxArchiveSizeMb > OFFICIAL_MAX_FILE_SIZE_MB) {
        throw new AgentForgeError(
          'CONFIG_INVALID',
          `Configured size limit (${Math.max(maxFileSizeMb, maxArchiveSizeMb)} MB) exceeds official contest ceiling of ${OFFICIAL_MAX_FILE_SIZE_MB} MB. In contest mode, submission files cannot exceed 50 MB.`,
        );
      }
    }

    this.maxFileSizeMb = maxFileSizeMb;
    this.maxArchiveSizeMb = maxArchiveSizeMb;
  }

  /** Validate a single standalone artifact (output file, transcript, etc.). */
  validateArtifact(
    filePath: string,
    name: string,
    strategy: OutputValidatorStrategy = 'any',
    customMaxMb?: number,
  ): ArtifactValidationResult {
    const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(this.rootDir, filePath);
    const effectiveMaxMb = customMaxMb ?? this.maxFileSizeMb;
    const maxSizeBytes = Math.floor(effectiveMaxMb * 1024 * 1024);
    const errors: string[] = [];

    if (!fs.existsSync(resolvedPath)) {
      return {
        name,
        path: resolvedPath,
        exists: false,
        sizeBytes: 0,
        sizeMb: 0,
        maxSizeBytes,
        maxSizeMb: effectiveMaxMb,
        validSize: false,
        validContent: false,
        errors: [`File does not exist: ${resolvedPath}`],
      };
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolvedPath);
    } catch (err: any) {
      return {
        name,
        path: resolvedPath,
        exists: true,
        sizeBytes: 0,
        sizeMb: 0,
        maxSizeBytes,
        maxSizeMb: effectiveMaxMb,
        validSize: false,
        validContent: false,
        isUnreadable: true,
        errors: [`File is unreadable: ${err.message}`],
      };
    }

    const sizeBytes = stat.size;
    const sizeMb = sizeBytes / (1024 * 1024);
    const validSize = sizeBytes <= maxSizeBytes;

    if (!validSize) {
      errors.push(
        `File size (${sizeBytes} bytes / ${sizeMb.toFixed(2)} MB) exceeds limit of ${maxSizeBytes} bytes / ${effectiveMaxMb} MB`,
      );
    }

    let validContent = true;
    let rawContent: string;

    // Check for INDEX.md ledger false-positive when validating a transcript
    if (
      path.basename(resolvedPath).toLowerCase() === 'index.md' &&
      name.toLowerCase().includes('transcript')
    ) {
      errors.push(
        `Invalid transcript: "${path.basename(resolvedPath)}" is a vault index ledger, not an authentic AI conversation transcript. Provide the exported conversation file.`,
      );
      validContent = false;
    }

    try {
      rawContent = fs.readFileSync(resolvedPath, 'utf8');
    } catch (err: any) {
      validContent = false;
      errors.push(`File content cannot be read: ${err.message}`);
      return {
        name,
        path: resolvedPath,
        exists: true,
        sizeBytes,
        sizeMb: Number(sizeMb.toFixed(3)),
        maxSizeBytes,
        maxSizeMb: effectiveMaxMb,
        validSize,
        validContent: false,
        isUnreadable: true,
        errors,
      };
    }

    // Apply validation strategy (with backward-compatible boolean support)
    const effectiveStrategy: OutputValidatorStrategy = typeof strategy === 'boolean'
      ? ((strategy as boolean) ? 'json' : 'any')
      : strategy;

    if (typeof effectiveStrategy === 'function') {
      try {
        const res = effectiveStrategy(rawContent, resolvedPath);
        if (!res.valid) {
          validContent = false;
          errors.push(...res.errors);
        }
      } catch (err: any) {
        validContent = false;
        errors.push(`Custom output validator failed: ${err.message}`);
      }
    } else if (effectiveStrategy === 'json') {
      try {
        if (rawContent.trim().length === 0) {
          errors.push('Output JSON file is empty');
          validContent = false;
        } else {
          const parsed = JSON.parse(rawContent);
          if (Array.isArray(parsed) && parsed.length === 0) {
            errors.push('Output JSON array is empty');
            validContent = false;
          } else if (
            typeof parsed === 'object' &&
            parsed !== null &&
            !Array.isArray(parsed) &&
            Object.keys(parsed).length === 0
          ) {
            errors.push('Output JSON object is empty');
            validContent = false;
          }
        }
      } catch (err: any) {
        errors.push(`Invalid JSON format: ${err.message}`);
        validContent = false;
      }
    } else if (effectiveStrategy === 'jsonl') {
      const lines = rawContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length === 0) {
        errors.push('Output JSONL file has no records');
        validContent = false;
      } else {
        for (let idx = 0; idx < lines.length; idx++) {
          try {
            JSON.parse(lines[idx]);
          } catch (err: any) {
            errors.push(`Invalid JSON at line ${idx + 1}: ${err.message}`);
            validContent = false;
            break;
          }
        }
      }
    } else if (effectiveStrategy === 'csv') {
      const lines = rawContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) {
        errors.push('Output CSV must contain at least a header row and 1 data row');
        validContent = false;
      }
    } else if (effectiveStrategy === 'text') {
      if (rawContent.trim().length === 0) {
        errors.push('Output text file is empty');
        validContent = false;
      }
    } else {
      // 'any' strategy: verify file exists and is non-empty
      if (sizeBytes === 0) {
        errors.push('Artifact file is empty (0 bytes)');
        validContent = false;
      } else if (rawContent.trim().length === 0) {
        errors.push(`${name} is empty or contains only whitespace.`);
        validContent = false;
      }
    }

    return {
      name,
      path: resolvedPath,
      exists: true,
      sizeBytes,
      sizeMb: Number(sizeMb.toFixed(3)),
      maxSizeBytes,
      maxSizeMb: effectiveMaxMb,
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
    const archiveOutPath = options.archiveOutPath ?? path.join(this.rootDir, 'dist', 'submission.zip');
    const dryRun = options.dryRun ?? false;
    const excludeDatasets = options.excludeDatasets ?? true;
    const customExclusions = options.customExclusions ?? [];
    const outputFormat = options.outputFormat ?? this.outputFormat;

    const validationErrors: string[] = [];

    // 1. FAST PRE-CHECKS: Validate standalone output and transcript artifacts BEFORE any archive work
    const outputValidation = this.validateArtifact(outputFile, 'Output File', outputFormat, this.maxFileSizeMb);
    if (!outputValidation.validSize || !outputValidation.validContent || !outputValidation.exists) {
      validationErrors.push(...outputValidation.errors);
    }

    // Resolve authentic transcript (NEVER default to docs/ai-transcript/INDEX.md)
    let transcriptValidation: ArtifactValidationResult;
    if (options.transcriptFile) {
      transcriptValidation = this.validateArtifact(
        options.transcriptFile,
        'AI Session Transcript',
        'any',
        this.maxFileSizeMb,
      );
      if (!transcriptValidation.validSize || !transcriptValidation.validContent || !transcriptValidation.exists) {
        validationErrors.push(...transcriptValidation.errors);
      }
    } else {
      const vaultResolution = resolveSubmissionTranscript(undefined, this.rootDir);
      if (!vaultResolution.resolved || !vaultResolution.transcriptPath) {
        const errMsg = vaultResolution.errors.join('; ');
        validationErrors.push(errMsg);
        transcriptValidation = {
          name: 'AI Session Transcript',
          path: path.join(this.rootDir, 'docs', 'ai-transcript', 'MISSING_AUTHENTIC_TRANSCRIPT'),
          exists: false,
          sizeBytes: 0,
          sizeMb: 0,
          maxSizeBytes: Math.floor(this.maxFileSizeMb * 1024 * 1024),
          maxSizeMb: this.maxFileSizeMb,
          validSize: false,
          validContent: false,
          errors: vaultResolution.errors,
        };
      } else {
        transcriptValidation = this.validateArtifact(
          vaultResolution.transcriptPath,
          'AI Session Transcript',
          'any',
          this.maxFileSizeMb,
        );
        if (!transcriptValidation.validSize || !transcriptValidation.validContent || !transcriptValidation.exists) {
          validationErrors.push(...transcriptValidation.errors);
        }
      }
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
    const maxArchiveSizeBytes = Math.floor(this.maxArchiveSizeMb * 1024 * 1024);

    // 4. Pre-archive check: if raw uncompressed bytes alone are grossly beyond reasonable zip limit, fail fast
    if (totalUncompressedBytes > maxArchiveSizeBytes * 4) {
      validationErrors.push(
        `Total uncompressed project size (${(totalUncompressedBytes / (1024 * 1024)).toFixed(2)} MB) grossly exceeds safe packaging budget. Check for unexcluded large data.`,
      );
    }

    // 5. Fail closed BEFORE expensive compression if any pre-checks failed
    if (!dryRun && validationErrors.length > 0) {
      throw new AgentForgeError(
        'OUTPUT_INVALID',
        `Packaging failed closed before archiving due to ${validationErrors.length} security/validation error(s): ${validationErrors.join('; ')}`,
      );
    }

    // 6. Validate or build the Code ZIP Archive
    let archiveValidation: ArtifactValidationResult;

    if (dryRun) {
      const estimatedZipBytes = Math.floor(totalUncompressedBytes * 0.35);
      const estimatedZipMb = Number((estimatedZipBytes / (1024 * 1024)).toFixed(2));
      const validSize = estimatedZipBytes <= maxArchiveSizeBytes;

      archiveValidation = {
        name: 'Code Archive (Dry-Run Estimate)',
        path: archiveOutPath,
        exists: false,
        sizeBytes: estimatedZipBytes,
        sizeMb: estimatedZipMb,
        maxSizeBytes: maxArchiveSizeBytes,
        maxSizeMb: this.maxArchiveSizeMb,
        validSize,
        validContent: true,
        errors: validSize ? [] : [`Estimated archive size (${estimatedZipMb} MB) exceeds ${this.maxArchiveSizeMb} MB limit`],
      };

      if (!validSize) {
        validationErrors.push(...archiveValidation.errors);
      }
    } else {
      // Read buffers and generate ZIP
      const fileBuffers = included.map((f) => ({
        relativePath: f.relPath,
        buffer: fs.readFileSync(f.fullPath),
      }));

      const zipBuffer = createZipArchive(fileBuffers);
      const zipSizeBytes = zipBuffer.length;
      const zipSizeMb = Number((zipSizeBytes / (1024 * 1024)).toFixed(2));
      const validSize = zipSizeBytes <= maxArchiveSizeBytes;

      // Ensure destination directory exists
      const targetDir = path.dirname(archiveOutPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      if (!validSize) {
        const errorMsg = `Generated archive size (${zipSizeBytes} bytes / ${zipSizeMb} MB) exceeds official limit of ${maxArchiveSizeBytes} bytes / ${this.maxArchiveSizeMb} MB`;
        validationErrors.push(errorMsg);
        throw new AgentForgeError('OUTPUT_INVALID', errorMsg);
      }

      fs.writeFileSync(archiveOutPath, zipBuffer);

      archiveValidation = {
        name: 'Code Archive (.zip)',
        path: archiveOutPath,
        exists: true,
        sizeBytes: zipSizeBytes,
        sizeMb: zipSizeMb,
        maxSizeBytes: maxArchiveSizeBytes,
        maxSizeMb: this.maxArchiveSizeMb,
        validSize: true,
        validContent: true,
        errors: [],
      };
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
