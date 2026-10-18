/**
 * Integration Tests for Authentic AI Chat Transcript Vault (Workstream 1)
 *
 * Requirements:
 * - Reject missing, empty, or whitespace-only files
 * - Reject INDEX.md or metadata-only manifests (false-positive regression)
 * - Support Markdown, plain text, and JSON transcript formats
 * - Compute SHA-256 and store truthful metadata
 * - Detect on-disk tampering / hash mismatch
 * - Reject secret patterns in transcript content
 * - Resolve single authentic transcript and require explicit flag if multiple exist
 *
 * NOTE: All test files created here are explicitly labelled TEST-ONLY synthetic fixtures
 * and are isolated in temporary test directories.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import {
  validateTranscriptFile,
  registerAuthenticTranscript,
  getRegisteredTranscripts,
  resolveSubmissionTranscript,
} from '@agentforge/orchestrator';

describe('Authentic AI Chat Transcript Vault — Workstream 1', () => {
  let tempDir: string;
  let vaultDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-transcript-test-'));
    vaultDir = path.join(tempDir, 'docs', 'ai-transcript');
    fs.mkdirSync(vaultDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('Transcript File Validation & Edge Cases', () => {
    it('rejects non-existent transcript files', () => {
      const missingPath = path.join(tempDir, 'does-not-exist.md');
      const res = validateTranscriptFile(missingPath, { rootDir: tempDir });
      expect(res.valid).toBe(false);
      expect(res.exists).toBe(false);
      expect(res.errors[0]).toContain('not found');
    });

    it('rejects empty files (0 bytes)', () => {
      const emptyPath = path.join(tempDir, 'empty-transcript.md');
      fs.writeFileSync(emptyPath, '');
      const res = validateTranscriptFile(emptyPath, { rootDir: tempDir });
      expect(res.valid).toBe(false);
      expect(res.isEmpty).toBe(true);
      expect(res.errors[0]).toContain('empty (0 bytes)');
    });

    it('rejects whitespace-only transcript files', () => {
      const wsPath = path.join(tempDir, 'whitespace-only.txt');
      fs.writeFileSync(wsPath, '   \n\t  \r\n   ');
      const res = validateTranscriptFile(wsPath, { rootDir: tempDir });
      expect(res.valid).toBe(false);
      expect(res.isEmpty).toBe(true);
      expect(res.errors[0]).toContain('whitespace');
    });

    it('rejects INDEX.md ledger file supplied as transcript (false-positive regression)', () => {
      const indexPath = path.join(vaultDir, 'INDEX.md');
      fs.writeFileSync(
        indexPath,
        '# AI Transcript Vault\n\n| Date | File | SHA-256 |\n|---|---|---|\n',
      );

      const res = validateTranscriptFile(indexPath, { rootDir: tempDir });
      expect(res.valid).toBe(false);
      expect(res.isMetadataOnly).toBe(true);
      expect(res.errors.some((e) => e.includes('metadata ledger/manifest'))).toBe(true);
    });

    it('rejects files containing embedded secret keys', () => {
      const secretPath = path.join(tempDir, 'secret-transcript.md');
      fs.writeFileSync(
        secretPath,
        '# AI Conversation [TEST-ONLY]\nUser: Here is my key: sk-live-123456789012345678901234\nAssistant: Thanks',
      );

      const res = validateTranscriptFile(secretPath, { rootDir: tempDir });
      expect(res.valid).toBe(false);
      expect(res.hasSecrets).toBe(true);
      expect(res.errors.some((e) => e.includes('Secret pattern detected'))).toBe(true);
    });

    it('rejects files exceeding 50 MB limit', () => {
      const largePath = path.join(tempDir, 'huge-transcript.txt');
      fs.writeFileSync(largePath, 'valid start');
      // Pass maxBytes constraint of 100 bytes to simulate limit breach without disk bloat
      const res = validateTranscriptFile(largePath, { rootDir: tempDir, maxBytes: 5 });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes('exceeds official 50 MB limit'))).toBe(true);
    });
  });

  describe('Supported Authentic Formats & Truthful Metadata', () => {
    it('accepts and registers valid Markdown conversation transcript [TEST-ONLY FIXTURE]', () => {
      const chatFile = path.join(tempDir, 'genuine-chat.md');
      const content = [
        '# AI Assistance Transcript [TEST-ONLY FIXTURE]',
        '',
        'User: How do we structure the Zod schemas for input validation?',
        'Assistant: Use z.object with strict property definitions.',
      ].join('\n');
      fs.writeFileSync(chatFile, content, 'utf8');

      const expectedHash = crypto.createHash('sha256').update(content).digest('hex');

      const reg = registerAuthenticTranscript(chatFile, {
        rootDir: tempDir,
        sourceTool: 'Antigravity IDE Export',
      });

      expect(reg.fileName).toBe('genuine-chat.md');
      expect(reg.format).toBe('markdown');
      expect(reg.sha256).toBe(expectedHash);
      expect(reg.sizeBytes).toBe(Buffer.byteLength(content));
      expect(fs.existsSync(reg.destinationPath)).toBe(true);

      // Verify INDEX.md entry was created truthfully
      const entries = getRegisteredTranscripts(vaultDir);
      expect(entries).toHaveLength(1);
      expect(entries[0].fileName).toBe('genuine-chat.md');
      expect(entries[0].sha256).toBe(expectedHash);
      expect(entries[0].sourceTool).toBe('Antigravity IDE Export');
      expect(entries[0].hashMatches).toBe(true);
    });

    it('accepts and registers valid JSON exported conversation [TEST-ONLY FIXTURE]', () => {
      const jsonFile = path.join(tempDir, 'exported-session.json');
      const chatJson = {
        tool: 'coding-assistant',
        messages: [
          { role: 'user', content: 'Design the state transition matrix' },
          { role: 'assistant', content: 'Terminal states: succeeded, failed, cancelled' },
        ],
      };
      fs.writeFileSync(jsonFile, JSON.stringify(chatJson, null, 2), 'utf8');

      const reg = registerAuthenticTranscript(jsonFile, {
        rootDir: tempDir,
        sourceTool: 'Web Assistant JSON Export',
      });

      expect(reg.format).toBe('json');
      expect(reg.fileName).toBe('exported-session.json');
      expect(fs.existsSync(reg.destinationPath)).toBe(true);
    });

    it('accepts and registers plain text transcript [TEST-ONLY FIXTURE]', () => {
      const txtFile = path.join(tempDir, 'terminal-chat.txt');
      fs.writeFileSync(txtFile, 'PROMPT: What is the backoff policy?\nRESPONSE: Exponential with jitter.', 'utf8');

      const reg = registerAuthenticTranscript(txtFile, {
        rootDir: tempDir,
        sourceTool: 'Terminal Session Log',
      });

      expect(reg.format).toBe('text');
      expect(reg.fileName).toBe('terminal-chat.txt');
    });
  });

  describe('Tamper Detection & Submission Resolution', () => {
    it('detects on-disk tampering when transcript content is modified after registration', () => {
      const originalPath = path.join(tempDir, 'secure-chat.md');
      fs.writeFileSync(originalPath, 'Original genuine conversation content');

      registerAuthenticTranscript(originalPath, { rootDir: tempDir });

      // Simulate malicious or accidental alteration of file in vault
      const targetInVault = path.join(vaultDir, 'secure-chat.md');
      fs.writeFileSync(targetInVault, 'Tampered synthetic content replacement');

      const entries = getRegisteredTranscripts(vaultDir);
      expect(entries[0].hashMatches).toBe(false);

      const resolution = resolveSubmissionTranscript(undefined, tempDir);
      expect(resolution.resolved).toBe(false);
      expect(resolution.errors[0]).toContain('tampered with or corrupted');
    });

    it('resolves registered authentic transcript automatically when exactly one exists', () => {
      const validPath = path.join(tempDir, 'valid-session.md');
      fs.writeFileSync(validPath, '# Valid Conversation [TEST-ONLY]');
      registerAuthenticTranscript(validPath, { rootDir: tempDir });

      const resolution = resolveSubmissionTranscript(undefined, tempDir);
      expect(resolution.resolved).toBe(true);
      expect(resolution.fileName).toBe('valid-session.md');
      expect(resolution.isRegisteredInVault).toBe(true);
      expect(resolution.errors).toHaveLength(0);
    });

    it('requires explicit --transcript flag when multiple transcripts exist in vault', () => {
      const file1 = path.join(tempDir, 'chat-session-01.md');
      const file2 = path.join(tempDir, 'chat-session-02.md');
      fs.writeFileSync(file1, '# Session 1 [TEST-ONLY]');
      fs.writeFileSync(file2, '# Session 2 [TEST-ONLY]');

      registerAuthenticTranscript(file1, { rootDir: tempDir });
      registerAuthenticTranscript(file2, { rootDir: tempDir });

      const resolution = resolveSubmissionTranscript(undefined, tempDir);
      expect(resolution.resolved).toBe(false);
      expect(resolution.errors[0]).toContain('Multiple authentic transcripts registered in vault');

      // But specifying one explicitly succeeds
      const explicitResolution = resolveSubmissionTranscript('docs/ai-transcript/chat-session-01.md', tempDir);
      expect(explicitResolution.resolved).toBe(true);
      expect(explicitResolution.fileName).toBe('chat-session-01.md');
    });
  });
});
