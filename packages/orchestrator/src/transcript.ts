/**
 * Authentic AI Chat Transcript Vault & Integrity (Workstream 1 & 2)
 *
 * Requirements:
 * - Accept an explicit file exported or saved from the actual AI coding conversation.
 * - Distinct from docs/ai-transcript/INDEX.md (never treat INDEX.md as the transcript).
 * - Reject absent, unreadable, empty, whitespace-only, or recognized metadata-only files.
 * - Support formats: Markdown (.md), plain text (.txt), exported JSON (.json), JSONL (.jsonl), log (.log).
 * - Record imported transcript's relative path, SHA-256 digest, file size, and truthful metadata.
 * - Zero conversation fabrication: never invent synthetic messages, timestamps, or tool calls.
 * - Secrets scanning: scan transcript file for API keys/secrets and fail closed.
 * - Strict 50 MB limit compliance.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { AgentForgeError } from '@agentforge/shared';
import { OFFICIAL_MAX_FILE_SIZE_BYTES, OFFICIAL_MAX_FILE_SIZE_MB, scanBufferForSecrets } from './packaging.js';

// ─── Known Metadata / Manifest Files ─────────────────────────────────────────

/**
 * File basenames that represent vault ledgers, packaging manifests, or run snapshots.
 * These must NEVER be accepted as authentic AI conversation transcripts.
 */
export const KNOWN_METADATA_FILES = new Set([
  'index.md',
  'packaging-manifest.json',
  'manifest.json',
  'config.snapshot.json',
  'run.json',
  'metrics.json',
  'trace.jsonl',
]);

// ─── Interfaces ───────────────────────────────────────────────────────────────

export type TranscriptFormat = 'markdown' | 'json' | 'jsonl' | 'text' | 'unknown';

export interface TranscriptValidationResult {
  valid: boolean;
  path: string;
  relPath: string;
  fileName: string;
  exists: boolean;
  sizeBytes: number;
  sizeMb: number;
  sha256: string;
  format: TranscriptFormat;
  isMetadataOnly: boolean;
  isEmpty: boolean;
  hasSecrets: boolean;
  errors: string[];
}

export interface RegisteredTranscriptEntry {
  registeredAt: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  sourceTool: string;
  fullPath: string;
  existsOnDisk: boolean;
  hashMatches: boolean;
}

export interface TranscriptResolutionResult {
  resolved: boolean;
  transcriptPath?: string;
  fileName?: string;
  sha256?: string;
  sizeBytes?: number;
  sizeMb?: number;
  format?: TranscriptFormat;
  isRegisteredInVault?: boolean;
  errors: string[];
}

export interface TranscriptAddOptions {
  rootDir?: string;
  sourceTool?: string;
  customVaultDir?: string;
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validates an authentic AI conversation transcript file.
 * Fails closed on missing, empty, whitespace-only, metadata-only, oversized,
 * or secret-bearing files. Never fabricates conversation data.
 */
export function validateTranscriptFile(
  filePath: string,
  options: { rootDir?: string; maxBytes?: number } = {},
): TranscriptValidationResult {
  const rootDir = options.rootDir ?? process.cwd();
  const maxBytes = options.maxBytes ?? OFFICIAL_MAX_FILE_SIZE_BYTES;
  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(rootDir, filePath);
  const relPath = path.relative(rootDir, resolvedPath);
  const fileName = path.basename(resolvedPath);
  const lowerName = fileName.toLowerCase();

  const errors: string[] = [];
  let isMetadataOnly = false;
  let isEmpty = false;
  let hasSecrets = false;

  // 1. Check file existence
  if (!fs.existsSync(resolvedPath)) {
    errors.push(`Transcript file not found: ${resolvedPath}`);
    return {
      valid: false,
      path: resolvedPath,
      relPath,
      fileName,
      exists: false,
      sizeBytes: 0,
      sizeMb: 0,
      sha256: '',
      format: 'unknown',
      isMetadataOnly: false,
      isEmpty: false,
      hasSecrets: false,
      errors,
    };
  }

  // 2. Check if path is a directory
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolvedPath);
  } catch (err: any) {
    errors.push(`Cannot access transcript file: ${err.message}`);
    return {
      valid: false,
      path: resolvedPath,
      relPath,
      fileName,
      exists: true,
      sizeBytes: 0,
      sizeMb: 0,
      sha256: '',
      format: 'unknown',
      isMetadataOnly: false,
      isEmpty: false,
      hasSecrets: false,
      errors,
    };
  }

  if (stat.isDirectory()) {
    errors.push(`Transcript path is a directory, not a file: ${resolvedPath}`);
    return {
      valid: false,
      path: resolvedPath,
      relPath,
      fileName,
      exists: true,
      sizeBytes: 0,
      sizeMb: 0,
      sha256: '',
      format: 'unknown',
      isMetadataOnly: false,
      isEmpty: false,
      hasSecrets: false,
      errors,
    };
  }

  // 3. Reject known metadata ledger/manifest files (the exact false-positive scenario)
  if (KNOWN_METADATA_FILES.has(lowerName)) {
    isMetadataOnly = true;
    errors.push(
      `File "${fileName}" is a metadata ledger/manifest file (INDEX.md), not an authentic AI conversation transcript. Provide the exported conversation file.`,
    );
  }

  // 4. Reject empty files (0 bytes)
  const sizeBytes = stat.size;
  const sizeMb = Number((sizeBytes / (1024 * 1024)).toFixed(3));

  if (sizeBytes === 0) {
    isEmpty = true;
    errors.push(`Transcript file is empty (0 bytes). Authentic conversation history is required.`);
  }

  // 5. Check size limit <= 50 MB
  if (sizeBytes > maxBytes) {
    errors.push(
      `Transcript file size (${sizeBytes} bytes / ${sizeMb} MB) exceeds official 50 MB limit (${maxBytes} bytes / ${OFFICIAL_MAX_FILE_SIZE_MB} MB).`,
    );
  }

  // 6. Read and validate content
  let rawContent = '';
  let sha256 = '';

  if (sizeBytes > 0) {
    try {
      const buffer = fs.readFileSync(resolvedPath);
      sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      rawContent = buffer.toString('utf8');

      // Check whitespace-only
      if (rawContent.trim().length === 0) {
        isEmpty = true;
        errors.push(`Transcript file contains only whitespace. Authentic conversation history is required.`);
      }

      // Check if file content is the vault index table itself
      if (
        rawContent.includes('# AI Transcript Vault') &&
        rawContent.includes('| Date | File |') &&
        rawContent.includes('SHA-256')
      ) {
        isMetadataOnly = true;
        errors.push(
          `Content of "${fileName}" matches the vault index table. An authentic exported AI chat transcript is required.`,
        );
      }

      // Scan for embedded secrets
      const violations = scanBufferForSecrets(rawContent, relPath);
      if (violations.length > 0) {
        hasSecrets = true;
        for (const v of violations) {
          errors.push(`Secret pattern detected in transcript: ${v.pattern}`);
        }
      }
    } catch (err: any) {
      errors.push(`Cannot read transcript content: ${err.message}`);
    }
  }

  // 7. Determine format truthfully without enforcing artificial schemas
  let format: TranscriptFormat = 'unknown';
  const ext = path.extname(lowerName);
  if (ext === '.md') {
    format = 'markdown';
  } else if (ext === '.json') {
    format = 'json';
    try {
      JSON.parse(rawContent);
    } catch {
      errors.push('Transcript has .json extension but contains invalid JSON.');
    }
  } else if (ext === '.jsonl') {
    format = 'jsonl';
  } else if (['.txt', '.log', '.text'].includes(ext)) {
    format = 'text';
  } else if (rawContent.length > 0) {
    format = 'text';
  }

  const valid = errors.length === 0;

  return {
    valid,
    path: resolvedPath,
    relPath,
    fileName,
    exists: true,
    sizeBytes,
    sizeMb,
    sha256,
    format,
    isMetadataOnly,
    isEmpty,
    hasSecrets,
    errors,
  };
}

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * Registers an authentic AI chat transcript in docs/ai-transcript/.
 * Computes SHA-256, copies the artifact, and updates INDEX.md with truthful metadata.
 * Throws AgentForgeError if source file is invalid, empty, or metadata-only.
 */
export function registerAuthenticTranscript(
  sourcePath: string,
  options: TranscriptAddOptions = {},
): {
  destinationPath: string;
  fileName: string;
  sha256: string;
  sizeBytes: number;
  format: TranscriptFormat;
} {
  const rootDir = options.rootDir ?? process.cwd();
  const validation = validateTranscriptFile(sourcePath, { rootDir });

  if (!validation.valid) {
    throw new AgentForgeError(
      'INPUT_INVALID',
      `Cannot register transcript: ${validation.errors.join('; ')}`,
    );
  }

  const vaultDir = options.customVaultDir ?? path.join(rootDir, 'docs', 'ai-transcript');
  if (!fs.existsSync(vaultDir)) {
    fs.mkdirSync(vaultDir, { recursive: true });
  }

  const fileName = validation.fileName;
  const destPath = path.join(vaultDir, fileName);

  // Copy only if source is outside the destination
  if (path.resolve(validation.path) !== path.resolve(destPath)) {
    fs.copyFileSync(validation.path, destPath);
  }

  // Update docs/ai-transcript/INDEX.md with truthful metadata
  const indexPath = path.join(vaultDir, 'INDEX.md');
  const timestamp = new Date().toISOString();
  const sourceTool = options.sourceTool ?? 'Manual Export';
  const entry = `| ${timestamp} | ${fileName} | ${validation.sizeBytes} | ${validation.sha256} | ${sourceTool} |\n`;

  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(
      indexPath,
      `# AI Transcript Vault\n\n| Date | File | Size (Bytes) | SHA-256 | Source |\n|---|---|---|---|---|\n${entry}`,
      'utf8',
    );
  } else {
    const existing = fs.readFileSync(indexPath, 'utf8');
    // Ensure header matches modern schema if initializing or upgrading
    if (!existing.includes('| Size (Bytes) |')) {
      fs.appendFileSync(indexPath, entry, 'utf8');
    } else {
      fs.appendFileSync(indexPath, entry, 'utf8');
    }
  }

  return {
    destinationPath: destPath,
    fileName,
    sha256: validation.sha256,
    sizeBytes: validation.sizeBytes,
    format: validation.format,
  };
}

// ─── Vault Ledger Parsing ─────────────────────────────────────────────────────

/**
 * Reads and validates all transcripts currently registered in the vault ledger.
 */
export function getRegisteredTranscripts(vaultDir: string): RegisteredTranscriptEntry[] {
  const indexPath = path.join(vaultDir, 'INDEX.md');
  if (!fs.existsSync(indexPath)) return [];

  const content = fs.readFileSync(indexPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const entries: RegisteredTranscriptEntry[] = [];

  for (const line of lines) {
    // Matches 5-column format: | Date | File | Size | SHA-256 | Source |
    const match5 = line.match(
      /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*([a-f0-9]{64})\s*\|\s*([^|]+?)\s*\|/i,
    );
    if (match5 && match5[2].trim() !== 'File') {
      const fileName = match5[2].trim();
      const sizeBytes = parseInt(match5[3].trim(), 10);
      const recordedHash = match5[4].trim().toLowerCase();
      const sourceTool = match5[5].trim();
      const fullPath = path.join(vaultDir, fileName);
      const existsOnDisk = fs.existsSync(fullPath);
      let hashMatches = false;

      if (existsOnDisk) {
        try {
          const actualHash = crypto
            .createHash('sha256')
            .update(fs.readFileSync(fullPath))
            .digest('hex')
            .toLowerCase();
          hashMatches = actualHash === recordedHash;
        } catch {}
      }

      entries.push({
        registeredAt: match5[1].trim(),
        fileName,
        sizeBytes,
        sha256: recordedHash,
        sourceTool,
        fullPath,
        existsOnDisk,
        hashMatches,
      });
      continue;
    }

    // Matches legacy 3-column format: | Date | File | SHA-256 |
    const match3 = line.match(
      /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([a-f0-9]{64})\s*\|/i,
    );
    if (match3 && match3[2].trim() !== 'File') {
      const fileName = match3[2].trim();
      const recordedHash = match3[3].trim().toLowerCase();
      const fullPath = path.join(vaultDir, fileName);
      const existsOnDisk = fs.existsSync(fullPath);
      let hashMatches = false;
      let sizeBytes = 0;

      if (existsOnDisk) {
        try {
          const buf = fs.readFileSync(fullPath);
          sizeBytes = buf.length;
          const actualHash = crypto.createHash('sha256').update(buf).digest('hex').toLowerCase();
          hashMatches = actualHash === recordedHash;
        } catch {}
      }

      entries.push({
        registeredAt: match3[1].trim(),
        fileName,
        sizeBytes,
        sha256: recordedHash,
        sourceTool: 'Legacy Export',
        fullPath,
        existsOnDisk,
        hashMatches,
      });
    }
  }

  return entries;
}

// ─── Submission Transcript Resolution ─────────────────────────────────────────

/**
 * Resolves the genuine AI chat transcript artifact for contest submission.
 *
 * Rules:
 * - If explicitPath is supplied: validates that file. If it points to INDEX.md, rejects immediately.
 * - If explicitPath is omitted: inspects docs/ai-transcript/INDEX.md.
 *   - If exactly one valid authentic transcript is registered, resolves to it.
 *   - If zero authentic transcripts exist, fails closed.
 *   - NEVER resolves to INDEX.md itself.
 */
export function resolveSubmissionTranscript(
  explicitPath?: string,
  rootDir: string = process.cwd(),
): TranscriptResolutionResult {
  const vaultDir = path.join(rootDir, 'docs', 'ai-transcript');

  // Case A: Explicit path provided by user/CLI argument
  if (explicitPath && explicitPath.trim().length > 0) {
    const resolvedPath = path.isAbsolute(explicitPath)
      ? explicitPath
      : path.resolve(rootDir, explicitPath);
    const fileName = path.basename(resolvedPath).toLowerCase();

    // Check for INDEX.md false-positive
    if (fileName === 'index.md' || KNOWN_METADATA_FILES.has(fileName)) {
      return {
        resolved: false,
        errors: [
          `Invalid transcript: "${explicitPath}" is a vault index ledger or manifest file, not an authentic AI conversation transcript. Provide the exported chat file.`,
        ],
      };
    }

    const validation = validateTranscriptFile(resolvedPath, { rootDir });
    if (!validation.valid) {
      return {
        resolved: false,
        transcriptPath: resolvedPath,
        fileName: validation.fileName,
        errors: validation.errors,
      };
    }

    // Check if recorded in vault ledger to confirm hash match
    const registered = getRegisteredTranscripts(vaultDir);
    const matchingEntry = registered.find(
      (r) => r.fileName.toLowerCase() === validation.fileName.toLowerCase(),
    );

    let isRegisteredInVault = false;
    if (matchingEntry) {
      isRegisteredInVault = true;
      if (matchingEntry.sha256 !== validation.sha256) {
        return {
          resolved: false,
          transcriptPath: resolvedPath,
          fileName: validation.fileName,
          errors: [
            `Transcript hash mismatch: file content has been altered since registration in INDEX.md (expected ${matchingEntry.sha256.slice(0, 8)}..., got ${validation.sha256.slice(0, 8)}...).`,
          ],
        };
      }
    }

    return {
      resolved: true,
      transcriptPath: resolvedPath,
      fileName: validation.fileName,
      sha256: validation.sha256,
      sizeBytes: validation.sizeBytes,
      sizeMb: validation.sizeMb,
      format: validation.format,
      isRegisteredInVault,
      errors: [],
    };
  }

  // Case B: No explicit path provided — inspect vault registry
  const registered = getRegisteredTranscripts(vaultDir);

  if (registered.length === 0) {
    return {
      resolved: false,
      errors: [
        'No authentic AI conversation transcript registered in docs/ai-transcript/INDEX.md. Supply --transcript <file> or register an authentic export via "pnpm agentforge transcript add <file>".',
      ],
    };
  }

  // Filter out any accidental INDEX.md entries
  const genuineEntries = registered.filter(
    (e) => !KNOWN_METADATA_FILES.has(e.fileName.toLowerCase()),
  );

  if (genuineEntries.length === 0) {
    return {
      resolved: false,
      errors: [
        'docs/ai-transcript/INDEX.md contains zero genuine transcript files. Please export your conversation from the coding environment and run "pnpm agentforge transcript add <file>".',
      ],
    };
  }

  if (genuineEntries.length > 1) {
    return {
      resolved: false,
      errors: [
        `Multiple authentic transcripts registered in vault (${genuineEntries.map((e) => e.fileName).join(', ')}). Specify which transcript to package using: --transcript <path>.`,
      ],
    };
  }

  const singleEntry = genuineEntries[0];
  if (!singleEntry.existsOnDisk) {
    return {
      resolved: false,
      errors: [
        `Registered transcript file "${singleEntry.fileName}" is missing from docs/ai-transcript/. Restore the file or re-add using "pnpm agentforge transcript add <file>".`,
      ],
    };
  }

  if (!singleEntry.hashMatches) {
    return {
      resolved: false,
      errors: [
        `Registered transcript file "${singleEntry.fileName}" has been tampered with or corrupted on disk (SHA-256 does not match vault INDEX.md).`,
      ],
    };
  }

  const validation = validateTranscriptFile(singleEntry.fullPath, { rootDir });
  if (!validation.valid) {
    return {
      resolved: false,
      transcriptPath: singleEntry.fullPath,
      fileName: singleEntry.fileName,
      errors: validation.errors,
    };
  }

  return {
    resolved: true,
    transcriptPath: singleEntry.fullPath,
    fileName: singleEntry.fileName,
    sha256: singleEntry.sha256,
    sizeBytes: singleEntry.sizeBytes,
    sizeMb: validation.sizeMb,
    format: validation.format,
    isRegisteredInVault: true,
    errors: [],
  };
}
