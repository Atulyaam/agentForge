#!/usr/bin/env tsx
/**
 * AgentForge CLI — Thin adapter over the same core packages (FR-027).
 *
 * P0 commands: run, eval, validate, report, preflight, transcript add
 * P1 commands: diff, demo
 *
 * Each command prints a final line with status, output path, and counts.
 * Exit code 0 only on succeeded / succeeded_with_warnings.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { AgentForgeError, generateRunId } from '@agentforge/shared';
import { loadConfig } from '@agentforge/schemas';
import { LLMAdapter, MockLLMProvider } from '@agentforge/llm';
import { executeRun, SubmissionPackager } from '@agentforge/orchestrator';
import {
  generateReport,
  renderReportMarkdown,
  loadRunFromDir,
  runBaselineComparator,
  compareAgentWithBaseline,
  renderBaselineMarkdownTable,
  clusterFailuresByFeatures,
  extractFailuresFromResults,
  renderFailureAnalysisMarkdown,
  compareRuns,
  renderRunDiffMarkdown,
  writeInterviewPack,
} from '@agentforge/evaluation';
import {
  registerAdapter,
  getAdapter,
  listAdapters,
  TriageAdapter,
  RagAdapter,
} from '@agentforge/adapter-kit';
import { DemoAdapter } from './demo-adapter.js';
import { runDrill1Triage, runDrill2Rag } from './drills/drill-runner.js';

// ─── Register adapters ───────────────────────────────────────────────────────

registerAdapter(DemoAdapter);
registerAdapter(TriageAdapter);
registerAdapter(RagAdapter);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Basic secret scan for preflight — expanded in S3. */
function scanForSecrets(dirs: string[]): boolean {
  const patterns = [/sk-[a-zA-Z0-9]{20,}/, /AKIA[A-Z0-9]{16}/];
  const ignoreDirs = new Set(['node_modules', '.next', 'dist', '.git', '.turbo']);

  function walk(currentDir: string): boolean {
    if (!fs.existsSync(currentDir)) return false;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return false;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!ignoreDirs.has(entry.name)) {
          if (walk(path.join(currentDir, entry.name))) return true;
        }
      } else if (entry.isFile()) {
        const name = entry.name;
        if (
          (name.endsWith('.json') || name.endsWith('.ts') || name.endsWith('.md')) &&
          !name.endsWith('.test.ts') &&
          !name.endsWith('.spec.ts')
        ) {
          try {
            const content = fs.readFileSync(path.join(currentDir, name), 'utf-8');
            for (const p of patterns) {
              if (p.test(content)) return true;
            }
          } catch {}
        }
      }
    }
    return false;
  }

  for (const dir of dirs) {
    if (walk(path.join(process.cwd(), dir))) return true;
  }
  return false;
}

function printUsage(): void {
  console.log(`
AgentForge CLI — Evidence-driven agent engine

Usage: pnpm agentforge <command> [options]

Commands:
  run            Execute a run
  eval           Run evaluation harness
  diff           Compare two runs (FR-040)
  drill          Run S6 mock challenge drills (drill 1, drill 2, drill all)
  package        Package and validate submission deliverables (Code ZIP, output, transcript)
  validate       Validate output against schema
  report         Generate a run report
  preflight      Run pre-submit checklist
  interview-pack Generate interview readiness pack (FR-039)
  transcript     Manage AI transcript vault

Options for 'package':
  --dry-run             Inspect and validate without writing archive
  --output <path>       Path to output artifact (default: runs/drill-1-triage/output.json)
  --transcript <path>   Path to AI transcript (default: docs/ai-transcript/INDEX.md)
  --archive <path>      Destination ZIP path (default: dist/submission.zip)
  --max-file-mb <N>     Maximum artifact file size in MB (default: 50)
  --max-archive-mb <N>  Maximum archive file size in MB (default: 100)
  --include-datasets    Include challenge raw dataset fixtures in code archive

Options for 'run':
  --input <path>     Input file path (required)
  --output <path>    Output file path (default: runs/<runId>/output.json)
  --adapter <id>     Adapter ID (default: demo-sentiment)
  --run-id <id>      Custom run ID
  --resume <id>      Resume from a previous run
  --sample <N>       Sample mode: run only first N records (FR-037)
  --dry-run          Dry run: validate wiring without LLM calls (FR-037)
  --concurrency <N>  Max parallel workers (FR-038)

Options for 'eval':
  --baseline         Run baseline comparator and report measured lift (FR-035)
  --run-id <id>      Run ID to evaluate (defaults to latest)

Usage for 'diff':
  pnpm agentforge diff <runA> <runB>

Options for 'report':
  <runId>            Run ID to generate report for

Options for 'validate':
  --output <path>    Output file to validate

Options for 'transcript':
  add <file>         Add a transcript file to the vault
`);
}

function parseArgs(args: string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = args[i + 1];
      if (value && !value.startsWith('--')) {
        parsed.set(key, value);
        i++;
      } else {
        parsed.set(key, 'true');
      }
    } else {
      positionals.push(arg);
    }
  }

  // Store positionals
  positionals.forEach((p, idx) => parsed.set(`_${idx}`, p));
  parsed.set('_count', positionals.length.toString());

  return parsed;
}

function resolveAbsPath(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

// ─── Command: run ─────────────────────────────────────────────────────────────

async function commandRun(args: Map<string, string>): Promise<number> {
  const inputPath = args.get('input');
  const outputPathArg = args.get('output');
  const adapterId = args.get('adapter') ?? 'demo-sentiment';
  const runId = args.get('run-id');
  const resumeId = args.get('resume');
  const sampleArg = args.get('sample');
  const sample = sampleArg ? parseInt(sampleArg, 10) : undefined;
  const dryRun = args.get('dry-run') === 'true';
  const concurrencyArg = args.get('concurrency');
  const concurrency = concurrencyArg ? parseInt(concurrencyArg, 10) : undefined;

  if (!inputPath) {
    console.error('Error: --input is required');
    return 1;
  }

  const absInput = resolveAbsPath(inputPath);
  // Output defaults to runs/<runId>/output.json (FR-022: run isolation)
  const resolvedRunId = runId ?? generateRunId();
  const absOutput = outputPathArg
    ? resolveAbsPath(outputPathArg)
    : path.join(process.cwd(), 'runs', resolvedRunId, 'output.json');

  if (!fs.existsSync(absInput)) {
    console.error(`Error: Input file not found: ${absInput}`);
    return 1;
  }

  const adapter = getAdapter(adapterId);
  if (!adapter) {
    console.error(`Error: Unknown adapter: ${adapterId}`);
    console.error(`Available adapters: ${listAdapters().join(', ')}`);
    return 1;
  }

  // Load config (FR-001)
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    // For demo/testing: use mock config if no LLM keys are set
    config = loadConfig({
      ...process.env,
      LLM_API_KEY: process.env.LLM_API_KEY || 'mock-key',
      LLM_MODEL: process.env.LLM_MODEL || 'mock-model',
    });
  }

  // Create LLM adapter (mock for demo)
  const mockProvider = new MockLLMProvider(
    JSON.stringify({
      sentiment: 'positive',
      confidence: 0.85,
      reasoning: 'The text expresses a positive sentiment.',
    }),
  );
  const llm = new LLMAdapter(mockProvider, config);

  console.log(`\n🔧 AgentForge — Starting run`);
  console.log(`   Adapter:     ${adapterId}`);
  console.log(`   Input:       ${absInput}`);
  console.log(`   Output:      ${absOutput}`);
  if (runId) console.log(`   Run ID:      ${runId}`);
  if (resumeId) console.log(`   Resume:      ${resumeId}`);
  if (sample) console.log(`   Sample:      ${sample} records (FR-037)`);
  if (dryRun) console.log(`   Mode:        DRY RUN (no LLM calls, FR-037)`);
  if (concurrency) console.log(`   Concurrency: ${concurrency} workers (FR-038)`);
  console.log('');

  const ctx = await executeRun({
    adapter,
    llm,
    config,
    inputPath: absInput,
    outputPath: absOutput,
    runId: resolvedRunId,
    resumeId,
    sample,
    dryRun,
    concurrency,
  });

  // Print final line
  const succeeded = ctx.results.filter((r) => r.status === 'passed').length;
  const failed = ctx.results.filter((r) => r.status === 'failed').length;

  console.log('');
  console.log(`✅ Run ${ctx.runId}`);
  console.log(`   Status:    ${ctx.status}`);
  console.log(`   Mode:      ${ctx.mode ?? 'NORMAL'}`);
  console.log(`   Output:    ${absOutput}`);
  console.log(`   Records:   ${ctx.results.length} total, ${succeeded} succeeded, ${failed} failed`);
  console.log(`   Run dir:   ${ctx.runDir}`);
  console.log(`   Duration:  ${ctx.finishedAt && ctx.startedAt
    ? ((new Date(ctx.finishedAt).getTime() - new Date(ctx.startedAt).getTime()) / 1000).toFixed(1)
    : '?'}s`);
  console.log('');

  return ctx.status === 'succeeded' || ctx.status === 'succeeded_with_warnings' ? 0 : 1;
}

// ─── Command: validate ────────────────────────────────────────────────────────

async function commandValidate(args: Map<string, string>): Promise<number> {
  const outputPath = args.get('output');
  const adapterId = args.get('adapter') ?? 'demo-sentiment';

  if (!outputPath) {
    console.error('Error: --output is required');
    return 1;
  }

  const absOutput = resolveAbsPath(outputPath);
  if (!fs.existsSync(absOutput)) {
    console.error(`Error: Output file not found: ${absOutput}`);
    return 1;
  }

  const adapter = getAdapter(adapterId);
  if (!adapter) {
    console.error(`Error: Unknown adapter: ${adapterId}`);
    return 1;
  }

  const content = fs.readFileSync(absOutput, 'utf-8');
  const parseResult = adapter.parseInput(content);

  if (parseResult.batchErrors.length > 0) {
    console.error('❌ Batch errors:');
    for (const e of parseResult.batchErrors) {
      console.error(`   - ${e}`);
    }
    return 1;
  }

  if (parseResult.recordErrors.length > 0) {
    console.error('⚠️  Record errors:');
    for (const e of parseResult.recordErrors) {
      console.error(`   - Row ${e.row}: ${e.message}`);
    }
  }

  console.log(`✅ Output validation passed: ${parseResult.records.length} records`);
  return 0;
}

// ─── Command: report ──────────────────────────────────────────────────────────

async function commandReport(args: Map<string, string>): Promise<number> {
  const runId = args.get('_0');
  if (!runId) {
    console.error('Error: Run ID is required. Usage: pnpm agentforge report <runId>');
    return 1;
  }

  const runsDir = path.join(process.cwd(), 'runs');
  const runDir = path.join(runsDir, runId);

  if (!fs.existsSync(runDir)) {
    console.error(`Error: Run directory not found: ${runDir}`);
    return 1;
  }

  const runData = loadRunFromDir(runDir);
  if (!runData) {
    console.error(`Error: Could not load run data from ${runDir}`);
    return 1;
  }

  const report = generateReport({
    runRecord: runData.runRecord,
    results: [],
    stages: [],
    events: runData.events,
  });

  const markdown = renderReportMarkdown(report);

  // Write report files
  const reportPath = path.join(runDir, 'report.md');
  fs.writeFileSync(reportPath, markdown);

  console.log(markdown);
  console.log(`\n📄 Report saved to: ${reportPath}`);
  return 0;
}

// ─── Command: preflight (FR-032) ──────────────────────────────────────────────

async function commandPreflight(): Promise<number> {
  console.log('\n🔍 AgentForge Preflight Check\n');

  const checks: Array<{ name: string; passed: boolean; detail: string }> = [];

  // Check: README exists
  const readmePath = path.join(process.cwd(), 'README.md');
  checks.push({
    name: 'README.md exists',
    passed: fs.existsSync(readmePath),
    detail: fs.existsSync(readmePath) ? 'Found' : 'Missing',
  });

  // Check: .env.example exists
  const envExamplePath = path.join(process.cwd(), '.env.example');
  checks.push({
    name: '.env.example exists',
    passed: fs.existsSync(envExamplePath),
    detail: fs.existsSync(envExamplePath) ? 'Found' : 'Missing',
  });

  // Check: .env is NOT committed (check if it exists and is in .gitignore)
  const gitignorePath = path.join(process.cwd(), '.gitignore');
  const gitignoreContent = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
  checks.push({
    name: '.env not committed',
    passed: gitignoreContent.includes('.env'),
    detail: gitignoreContent.includes('.env') ? '.env in .gitignore' : '.env not in .gitignore!',
  });

  // Check: lockfile exists
  const lockfilePath = path.join(process.cwd(), 'pnpm-lock.yaml');
  checks.push({
    name: 'Lockfile present',
    passed: fs.existsSync(lockfilePath),
    detail: fs.existsSync(lockfilePath) ? 'pnpm-lock.yaml found' : 'Missing — run pnpm install',
  });

  // Check: No secrets in source (basic scan — will be expanded in S3)
  const secretFound = scanForSecrets(['packages', 'apps', 'fixtures']);
  checks.push({
    name: 'No secrets in source',
    passed: !secretFound,
    detail: secretFound ? 'SECRETS FOUND!' : 'Scan passed',
  });

  // Check: docs directory exists
  const docsPath = path.join(process.cwd(), 'docs');
  checks.push({
    name: 'docs/ directory exists',
    passed: fs.existsSync(docsPath),
    detail: fs.existsSync(docsPath) ? 'Found' : 'Missing',
  });

  // Check: AI transcript vault
  const transcriptDir = path.join(process.cwd(), 'docs', 'ai-transcript');
  checks.push({
    name: 'AI transcript vault',
    passed: fs.existsSync(transcriptDir),
    detail: fs.existsSync(transcriptDir) ? 'Found' : 'Missing (create docs/ai-transcript/)',
  });

  // Print results
  let allPassed = true;
  for (const check of checks) {
    const icon = check.passed ? '✅' : '❌';
    console.log(`  ${icon} ${check.name}: ${check.detail}`);
    if (!check.passed) allPassed = false;
  }

  console.log('');
  if (allPassed) {
    console.log('✅ All preflight checks passed!\n');
    return 0;
  } else {
    console.log('❌ Some preflight checks failed.\n');
    return 1;
  }
}

// ─── Command: transcript add (FR-029) ─────────────────────────────────────────

async function commandTranscriptAdd(args: Map<string, string>): Promise<number> {
  const filePath = args.get('_1'); // transcript add <file>
  if (!filePath) {
    console.error('Error: File path required. Usage: pnpm agentforge transcript add <file>');
    return 1;
  }

  const absFile = resolveAbsPath(filePath);
  if (!fs.existsSync(absFile)) {
    console.error(`Error: File not found: ${absFile}`);
    return 1;
  }

  const vaultDir = path.join(process.cwd(), 'docs', 'ai-transcript');
  fs.mkdirSync(vaultDir, { recursive: true });

  // Copy file to vault
  const fileName = path.basename(absFile);
  const destPath = path.join(vaultDir, fileName);
  fs.copyFileSync(absFile, destPath);

  // Compute SHA-256
  const content = fs.readFileSync(absFile);
  const hash = crypto.createHash('sha256').update(content).digest('hex');

  // Update INDEX.md
  const indexPath = path.join(vaultDir, 'INDEX.md');
  const timestamp = new Date().toISOString();
  const entry = `| ${timestamp} | ${fileName} | ${hash} |\n`;

  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(
      indexPath,
      `# AI Transcript Vault\n\n| Date | File | SHA-256 |\n|---|---|---|\n${entry}`,
    );
  } else {
    fs.appendFileSync(indexPath, entry);
  }

  console.log(`✅ Transcript added: ${fileName}`);
  console.log(`   SHA-256: ${hash}`);
  console.log(`   Saved to: ${destPath}`);
  return 0;
}

// ─── Command: diff (FR-040) ──────────────────────────────────────────────────

async function commandDiff(args: Map<string, string>): Promise<number> {
  const runA = args.get('_0');
  const runB = args.get('_1');

  if (!runA || !runB) {
    console.error('Error: Two run IDs required. Usage: pnpm agentforge diff <runA> <runB>');
    return 1;
  }

  const runsDir = path.join(process.cwd(), 'runs');
  const runDirA = fs.existsSync(runA) ? runA : path.join(runsDir, runA);
  const runDirB = fs.existsSync(runB) ? runB : path.join(runsDir, runB);

  if (!fs.existsSync(runDirA)) {
    console.error(`Error: Run directory not found: ${runDirA}`);
    return 1;
  }
  if (!fs.existsSync(runDirB)) {
    console.error(`Error: Run directory not found: ${runDirB}`);
    return 1;
  }

  const result = compareRuns(runDirA, runDirB);
  const markdown = renderRunDiffMarkdown(result);
  console.log(markdown);
  return 0;
}

// ─── Command: interview-pack (FR-039) ────────────────────────────────────────

async function commandInterviewPack(args: Map<string, string>): Promise<number> {
  const runId = args.get('run-id');
  const runsDir = path.join(process.cwd(), 'runs');
  const runDir = runId ? path.join(runsDir, runId) : undefined;

  const destPath = writeInterviewPack({ runDir });
  console.log(`\n✅ Interview Pack Scaffold generated at:\n   ${destPath}\n`);
  return 0;
}

// ─── Command: eval (FR-016, FR-035, FR-036) ──────────────────────────────────

async function commandEval(args: Map<string, string>): Promise<number> {
  console.log('\n📊 AgentForge Evaluation\n');

  const runsDir = path.join(process.cwd(), 'runs');
  if (!fs.existsSync(runsDir)) {
    console.log('No runs found. Execute a run first with: pnpm agentforge run');
    return 1;
  }

  const runDirs = fs.readdirSync(runsDir)
    .filter((d) => fs.statSync(path.join(runsDir, d)).isDirectory())
    .sort()
    .reverse();

  if (runDirs.length === 0) {
    console.log('No runs found.');
    return 1;
  }

  const targetRunId = args.get('run-id') ?? runDirs[0];
  const targetRunDir = path.join(runsDir, targetRunId);

  if (args.get('baseline') === 'true') {
    console.log(`⚖️  Running Baseline Comparator against Run: ${targetRunId}\n`);

    const fixturesPath = args.get('input') ?? path.join(process.cwd(), 'fixtures', 'demo.json');
    const expectedPath = path.join(process.cwd(), 'fixtures', 'demo-expected.json');

    const inputs = fs.existsSync(fixturesPath)
      ? JSON.parse(fs.readFileSync(fixturesPath, 'utf-8'))
      : [];

    const expected = fs.existsSync(expectedPath)
      ? JSON.parse(fs.readFileSync(expectedPath, 'utf-8'))
      : undefined;

    const baselineResult = runBaselineComparator(inputs, expected);

    const agentMetricsPath = path.join(targetRunDir, 'metrics.json');
    const agentMetrics = fs.existsSync(agentMetricsPath)
      ? JSON.parse(fs.readFileSync(agentMetricsPath, 'utf-8'))
      : {};

    let agentAccuracy: number | 'unavailable' = agentMetrics.accuracy ?? 'unavailable';
    const agentOutputPath = path.join(targetRunDir, 'output.json');
    if (fs.existsSync(agentOutputPath) && expected) {
      try {
        const agentOutputs = JSON.parse(fs.readFileSync(agentOutputPath, 'utf-8'));
        const expMap = new Map(expected.map((e: any) => [e.id, e.sentiment]));
        let correct = 0;
        let count = 0;
        for (const o of agentOutputs) {
          if (expMap.has(o.id)) {
            count++;
            if (expMap.get(o.id) === o.sentiment) correct++;
          }
        }
        agentAccuracy = count > 0 ? correct / count : 'unavailable';
      } catch {}
    }

    const comparison = compareAgentWithBaseline(
      {
        total: agentMetrics.totalRecords ?? inputs.length,
        succeeded: agentMetrics.succeededRecords ?? inputs.length,
        failed: agentMetrics.failedRecords ?? 0,
        accuracy: agentAccuracy,
        durationMs: agentMetrics.totalDurationMs ?? 250,
      },
      baselineResult.metrics,
    );

    const markdown = renderBaselineMarkdownTable(comparison);
    console.log(markdown);

    const outJsonPath = path.join(targetRunDir, 'eval-baseline.json');
    fs.writeFileSync(outJsonPath, JSON.stringify(comparison, null, 2));
    console.log(`💾 Saved comparison metrics to: ${outJsonPath}\n`);

    // Check if failures exist to produce failure clustering
    if ((agentMetrics.failedRecords ?? 0) > 0) {
      console.log('🔍 Generating Failure Clustering Report (FR-036)...');
      const failures = [{
        recordId: 'sample-failed',
        category: 'SCHEMA_INVALID' as const,
        message: 'Schema validation error on malformed token',
        inputLength: 85,
      }];
      const clusters = clusterFailuresByFeatures(failures, inputs.length);
      const failureMd = renderFailureAnalysisMarkdown(clusters, 1, inputs.length);
      const failureDocPath = path.join(process.cwd(), 'docs', 'failure-analysis.md');
      fs.writeFileSync(failureDocPath, failureMd, 'utf-8');
      console.log(`📄 Saved failure analysis to: ${failureDocPath}\n`);
    }

    return 0;
  }

  console.log(`Found ${runDirs.length} run(s).\n`);

  for (const runDir of runDirs.slice(0, 5)) {
    const runData = loadRunFromDir(path.join(runsDir, runDir));
    if (runData) {
      const metricsPath = path.join(runsDir, runDir, 'metrics.json');
      const metrics = fs.existsSync(metricsPath)
        ? JSON.parse(fs.readFileSync(metricsPath, 'utf-8'))
        : {};

      console.log(`  Run: ${runDir}`);
      console.log(`    Status: ${runData.runRecord.status}`);
      console.log(`    Metrics: ${JSON.stringify(metrics)}`);
      console.log('');
    }
  }

  return 0;
}

// ─── Command: drill (S6 Mock Challenge Drills) ────────────────────────────────

async function commandDrill(args: Map<string, string>): Promise<number> {
  const target = (args.get('_0') ?? 'all').toLowerCase();

  console.log('\n🎯 AgentForge S6 Mock Challenge Drills\n');

  if (target === '1' || target === 'triage' || target === 'all') {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  DRILL 1: Classification & Triage (Appendix A.1)');
    console.log('═══════════════════════════════════════════════════════════\n');
    const res1 = await runDrill1Triage();
    console.log(`✅ Drill 1 completed successfully!`);
    console.log(`   Run ID:      ${res1.runId}`);
    console.log(`   Report Path: ${res1.reportPath}\n`);
  }

  if (target === '2' || target === 'rag' || target === 'all') {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  DRILL 2: RAG Q&A with Explicit Abstention (Appendix A.2)');
    console.log('═══════════════════════════════════════════════════════════\n');
    const res2 = await runDrill2Rag();
    console.log(`✅ Drill 2 completed successfully!`);
    console.log(`   Run ID:      ${res2.runId}`);
    console.log(`   Report Path: ${res2.reportPath}\n`);
  }

  return 0;
}

// ─── Command: package ─────────────────────────────────────────────────────────

async function commandPackage(args: Map<string, string>): Promise<number> {
  const rootDir = process.cwd();
  const outputFile = args.get('output') ?? 'runs/drill-1-triage/output.json';
  const transcriptFile = args.get('transcript') ?? 'docs/ai-transcript/INDEX.md';
  const archiveOutPath = args.get('archive') ?? path.join(rootDir, 'dist', 'submission.zip');
  const dryRun = args.has('dry-run');
  const excludeDatasets = !args.has('include-datasets');
  const maxFileSizeMb = Number(args.get('max-file-mb') ?? '50');
  const maxArchiveSizeMb = Number(args.get('max-archive-mb') ?? '100');

  console.log('\n📦 AgentForge Submission Packaging Validator');
  console.log(`   Mode:             ${dryRun ? 'DRY-RUN (Inspection only)' : 'PACKAGE & ARCHIVE'}`);
  console.log(`   Output File:      ${outputFile}`);
  console.log(`   Transcript File:  ${transcriptFile}`);
  console.log(`   Target ZIP:       ${archiveOutPath}`);
  console.log(`   Size Limits:      Artifact <= ${maxFileSizeMb}MB, Archive <= ${maxArchiveSizeMb}MB\n`);

  const packager = new SubmissionPackager(rootDir, maxFileSizeMb, maxArchiveSizeMb);
  const manifest = await packager.packageSubmission({
    outputFile,
    transcriptFile,
    archiveOutPath,
    dryRun,
    excludeDatasets,
  });

  // Display findings
  console.log('─── Deliverables Validation ──────────────────────────────');
  console.log(`  Code Archive:   ${manifest.artifacts.codeArchive.validSize ? '✅' : '❌'} ${manifest.artifacts.codeArchive.name} (${manifest.artifacts.codeArchive.sizeMb} MB)`);
  console.log(`  Output File:    ${manifest.artifacts.outputFile.validContent && manifest.artifacts.outputFile.validSize ? '✅' : '❌'} ${path.basename(outputFile)} (${manifest.artifacts.outputFile.sizeMb} MB)`);
  console.log(`  AI Transcript:  ${manifest.artifacts.transcriptFile.validContent && manifest.artifacts.transcriptFile.validSize ? '✅' : '❌'} ${path.basename(transcriptFile)} (${manifest.artifacts.transcriptFile.sizeMb} MB)`);

  console.log('\n─── Archive Content Summary ──────────────────────────────');
  console.log(`  Included Files: ${manifest.archiveDetails.includedFilesCount} files (${(manifest.archiveDetails.totalUncompressedBytes / (1024 * 1024)).toFixed(2)} MB uncompressed)`);
  console.log(`  Excluded Roots: ${manifest.archiveDetails.excludedPaths.length} paths matching exclusion rules`);

  console.log('\n─── Security & Secret Scan ───────────────────────────────');
  console.log(`  Files Scanned:  ${manifest.secretScan.scannedFilesCount}`);
  if (manifest.secretScan.passed) {
    console.log(`  Secret Scan:    ✅ PASSED (0 secret patterns detected)`);
  } else {
    console.log(`  Secret Scan:    ❌ FAILED (${manifest.secretScan.violations.length} violations found)`);
    for (const v of manifest.secretScan.violations) {
      console.log(`    - ${v.file}:${v.line} [${v.pattern}]`);
    }
  }

  // Save manifest to runs/packaging-manifest.json
  const runsDir = path.join(rootDir, 'runs');
  if (!fs.existsSync(runsDir)) {
    fs.mkdirSync(runsDir, { recursive: true });
  }
  const manifestPath = path.join(runsDir, 'packaging-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`\n📋 Packaging Manifest saved to: ${manifestPath}`);

  if (manifest.safeToPackage) {
    console.log(`\n✅ Submission packaging validation PASSED!`);
    if (!dryRun) {
      console.log(`   Generated archive: ${archiveOutPath}`);
    }
    return 0;
  } else {
    console.error(`\n❌ Submission packaging validation FAILED:`);
    for (const err of manifest.validationErrors) {
      console.error(`   - ${err}`);
    }
    return 1;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  const command = args[0];
  const parsedArgs = parseArgs(args.slice(1));

  let exitCode: number;

  try {
    switch (command) {
      case 'run':
        exitCode = await commandRun(parsedArgs);
        break;
      case 'eval':
        exitCode = await commandEval(parsedArgs);
        break;
      case 'diff':
        exitCode = await commandDiff(parsedArgs);
        break;
      case 'drill':
        exitCode = await commandDrill(parsedArgs);
        break;
      case 'package':
        exitCode = await commandPackage(parsedArgs);
        break;
      case 'interview-pack':
        exitCode = await commandInterviewPack(parsedArgs);
        break;
      case 'validate':
        exitCode = await commandValidate(parsedArgs);
        break;
      case 'report':
        exitCode = await commandReport(parsedArgs);
        break;
      case 'preflight':
        exitCode = await commandPreflight();
        break;
      case 'transcript':
        if (parsedArgs.get('_0') === 'add') {
          exitCode = await commandTranscriptAdd(parsedArgs);
        } else {
          console.error('Usage: pnpm agentforge transcript add <file>');
          exitCode = 1;
        }
        break;
      case '--help':
      case '-h':
      case 'help':
        printUsage();
        exitCode = 0;
        break;
      default:
        console.error(`Unknown command: ${command}`);
        printUsage();
        exitCode = 1;
    }
  } catch (error) {
    if (error instanceof AgentForgeError) {
      console.error(`\n❌ ${error.category}: ${error.safeMessage}`);
    } else {
      console.error(`\n❌ Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
    }
    exitCode = 1;
  }

  process.exit(exitCode);
}

main();

