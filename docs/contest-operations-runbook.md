# AgentForge — Contest Operations Runbook

**Document Version:** 1.0.0  
**Target Event:** October Orchestrate Hackathon (Saturday, 24 October 2026, 18:00 IST)  
**Repository Branch:** `prep/kickoff-readiness`  
**Reference Document (SSOT):** `AgentForge_SSOT_v5.1.md`  
**Status:** AUTHORITATIVE OPERATOR RUNBOOK  

---

## Executive Summary & Core Rules

1. **Evidence Over Assumption:** Every decision and claim must be verified with execution logs, run artifacts, and test outcomes. Never fabricate results, hallucinate benchmarks, or make unverified claims.
2. **Deterministic Offline Default:** Offline commands (`pnpm test`, `preflight`, `drill`, `rehearsal`) make **zero** live API calls. Live provider execution (`--live`) is strictly opt-in and requires valid credentials in a private `.env`.
3. **Three Submission Artifacts (50 MB limit each):**
   - **Code Archive (`code.zip`):** Complete repository source, lockfile, and configurations excluding `node_modules`, `.git`, `runs/`, and secrets. Must be `<= 50 MB`.
   - **Output Deliverable (`output.json`):** Formatted and schema-validated deliverable satisfying the official challenge contract. Must be `<= 50 MB`.
   - **AI Conversation Transcript (`transcript.json` / `.md`):** Authentic coding-tool conversation history exported from the genuine AI assistant session. Never use `docs/ai-transcript/INDEX.md` as the transcript. Must be `<= 50 MB`.
4. **Honest Readiness Statuses:**
   - `PASS`: Requirement definitively satisfied with verified local evidence.
   - `PENDING`: Expected pre-kickoff state for requirements waiting on external inputs (e.g., official problem statement, live API credentials). Not an implementation failure.
   - `BLOCKED`: Critical submission prerequisite missing or non-compliant (e.g., missing authentic transcript, secret violation, oversized artifact).

---

## Phase 0: Before Kickoff (T-60m to T-0m)

### Objectives
- Verify environment sanity, clean Git state, and frozen checkpoints.
- Ensure secrets are stored strictly in `.env` (gitignored).
- Confirm audio/video and contest platform readiness.

### Operational Checklist & Commands

#### 1. Verify Git Branch, Checkpoint Tags, and Lockfile
Verify working tree is on `prep/kickoff-readiness` and frozen tags `v0.1.0-s7-freeze` and `v0.1.0-s7-final` exist.

```bash
# Check working branch and status
git branch --show-current
git status

# Verify frozen tag commit integrity
git rev-parse v0.1.0-s7-freeze v0.1.0-s7-final
```
- **Expected Success Condition:** Branch is `prep/kickoff-readiness`, clean working tree or known review changes, and tags output `1826b02ff9ac0e6f97980ff562aacde991b6b4e1` and `12c384c719943e2a5c43297ef70bab9da42d53be`.
- **Failure Response:** If tags are missing or diverged, inspect `git log` and restore tag pointers. Do not force-push or delete tags.
- **Source Document:** `docs/freeze-checklist.md`, Section 13 of `AgentForge_SSOT_v5.1.md`.

#### 2. Confirm Runtime Toolchains
```bash
node -v
pnpm -v
```
- **Expected Success Condition:** Node.js `>= 20.18.0` (LTS) and pnpm `>= 9.0.0`.
- **Failure Response:** Switch Node versions via `nvm use 20` or update pnpm via `corepack enable && corepack prepare pnpm@latest --activate`.
- **Source Document:** `package.json` (`engines` field).

#### 3. Run Operator Diagnostics & Health Checks
```bash
# Run comprehensive environment doctor check
pnpm agentforge doctor

# Run CLI preflight checks
pnpm agentforge preflight
```
- **Expected Success Condition:** `doctor` reports `System Health Status: HEALTHY`, environment configuration valid, disk space sufficient. `preflight` reports all checks passed.
- **Failure Response:** Resolve flagged missing directories, disk space warnings, or dependency issues.
- **Source Document:** `docs/kickoff-kit.md` Section 3.

#### 4. Run Test Suite & Build Verification
```bash
pnpm build
pnpm test
pnpm test:e2e
```
- **Expected Success Condition:** 229 unit/integration tests and 19 web E2E tests pass cleanly with 0 failures.
- **Failure Response:** Consult Vitest error logs; verify no unbuilt package exports (`tsc -b`).
- **Source Document:** `AgentForge_SSOT_v5.1.md` Section 12.

#### 5. Verify Secrets Hygiene
- Ensure `.env` is gitignored (`git status --ignored` should show `.env`).
- Never paste API keys into code files, prompts, CLI args, markdown reports, or screenshots.
- Required live configuration keys (when ready):
  ```bash
  LLM_API_KEY="your-api-key"
  LLM_MODEL="gemini-1.5-pro" # or contest-specified model
  ```
- **Expected Success Condition:** `.env` exists locally and is ignored by git.
- **Failure Response:** If `.env` is tracked, run `git rm --cached .env` immediately before committing.
- **Source Document:** `docs/kickoff-kit.md` Section 2.

#### 6. AV & Contest Platform Readiness
- Confirm internet connection stability (primary + hotspot backup).
- Verify microphone, webcam, and screen-sharing permissions on HackerRank / contest browser tab.
- Set up quiet environment for the evaluation period.

---

## Phase 1: Hour 0–1 — Problem Ingestion, Archetype Selection & Contract Setup

### Objectives
- Record official challenge statement verbatim in `docs/challenge-brief.md`.
- Distinguish verbatim requirements from team assumptions.
- Select or create the challenge adapter.
- Configure and test the output schema contract.

### Operational Checklist & Commands

#### 1. Ingest Official Brief
Paste the exact challenge text into `docs/challenge-brief.md` under `# Official Problem Statement`.
```bash
# Verify brief structure and absence of template placeholders
pnpm agentforge readiness
```
- **Expected Success Condition:** Readiness output transitions `Official Challenge Brief` from `PENDING` to `PASS`.
- **Failure Response:** If still `PENDING`, verify that template placeholder `[PASTE EXACT CHALLENGE TEXT HERE FROM EMAIL / PLATFORM AT HOUR 0]` was completely replaced by actual text (`>= 100` characters).
- **Source Document:** `docs/challenge-brief.md`.

#### 2. Analyze Requirements & Constraints
Extract the following into `docs/challenge-brief.md`:
- Input format: File type, schema, size, batching rules.
- Output format: Target filename (e.g. `output.json`), required keys, value constraints.
- Evaluation metric: Accuracy, F1 score, latency SLA, abstention penalty.
- Budget constraints: Maximum runtime, maximum LLM calls per run.

#### 3. Select Challenge Adapter Archetype
Compare the ingested requirements against existing adapters:
- **Support Triage Archetype:** Multi-class categorization, priority assignment, sentiment analysis, structured metadata extraction (`packages/adapter-kit/src/adapters/triage.ts`).
- **Policy RAG Archetype:** Query answering with evidence grounding, citation retrieval, and deterministic abstention on unsupported facts (`packages/adapter-kit/src/adapters/rag.ts`).
- **New Adapter (if novel domain):** Implement `ChallengeAdapter` interface in `packages/adapter-kit/src/adapters/<new-adapter>.ts` using `createCustomAdapter` template.
- **Source Document:** `packages/adapter-kit/src/index.ts` and `AgentForge_SSOT_v5.1.md` Appendix B.

#### 4. Configure & Test Output Contract Validator
Ensure the adapter implements `validateOutput(outputs, inputs)`.
```bash
# Test contract validation against sample data
pnpm agentforge validate --adapter <adapter-id> --output <test-output.json>
```
- **Expected Success Condition:** Output format satisfies all schema rules, returns 0 problems.
- **Failure Response:** Review `problems` array in output; adjust adapter's `toOutput()` method.
- **Source Document:** `packages/adapter-kit/src/index.ts`.

---

## Phase 2: Hours 1–3 — Baseline Implementation & Initial Acceptance Gate

### Objectives
- Implement the minimal deterministic heuristic or rules-based baseline.
- Execute an end-to-end run on sample inputs.
- Validate output structure and record the first official run evidence.
- Satisfy the Initial Acceptance Gate (Gate G1).

### Operational Checklist & Commands

#### 1. Run Dry-Run Pipeline Validation
Verify input parsing, normalization, context building, and output writing without LLM costs.
```bash
pnpm agentforge run --adapter <adapter-id> --input <path/to/inputs> --output runs/baseline/output.json --dry-run
```
- **Expected Success Condition:** Run status `succeeded`, pipeline stages execute, output written atomically.
- **Failure Response:** Check adapter `parseInput()` or `normalize()` errors.
- **Source Document:** `packages/orchestrator/src/index.ts` (FR-037).

#### 2. Run Heuristic Baseline on Sample
Execute baseline logic on sample subset (e.g., 5–10 records).
```bash
pnpm agentforge run --adapter <adapter-id> --input <path/to/inputs> --output runs/baseline/output.json --sample 10
```
- **Expected Success Condition:** Run completed within time budget; records outputted to `runs/baseline/output.json`.
- **Failure Response:** Inspect `runs/baseline/run.json` and `events.jsonl` for failure taxonomy.
- **Source Document:** `AgentForge_SSOT_v5.1.md` Section 6.

#### 3. Compare with Baseline & Record First Run ID
```bash
pnpm agentforge report --run runs/baseline
```
- **Expected Success Condition:** Generated report with accuracy metrics, latency stats, and cost breakdown.
- **Record First Run Evidence:** Save Run ID in engineering notes and inspect in Web Viewer:
  ```bash
  pnpm dev
  # Open http://localhost:3000/runs/<runId>
  ```
- **Source Document:** `docs/interview-pack.md`.

---

## Phase 3: Remaining Build — Measured Iteration, Live Provider & Safety Bounds

### Objectives
- Introduce live model integration cautiously with strict call limits.
- Benchmark and calibrate prompt versions against measured failures.
- Preserve genuine AI conversation history continuously.
- Prevent regression with bounded tests.

### Operational Checklist & Commands

#### 1. Live Provider Smoke Verification (1 call strictly bounded)
Before running batch workloads on real API, perform single-call health probe:
```bash
pnpm agentforge provider-smoke --live --max-calls 1
```
- **Expected Success Condition:** `[PASSED] Live Provider Smoke Test`, latency measured, probe schema valid, secrets redacted.
- **Failure Response:** If `[FAILED]`, check `.env` for `LLM_API_KEY` and `LLM_MODEL`. Never commit `.env`.
- **Source Document:** `docs/provider-calibration-report.md`.

#### 2. Real-Model Calibration (Bounded Sample)
Run calibration on a 3-record sample to measure schema compliance and baseline accuracy:
```bash
pnpm agentforge calibrate --live --sample 3 --max-calls 3
```
- **Expected Success Condition:** `[COMPLETED] Real-Model Calibration`, schema validity `100%`, report saved to `runs/calibration/calibration-report.md`.
- **Failure Response:** If schema errors occur, adjust system prompt to enforce strict JSON schemas.
- **Source Document:** `packages/orchestrator/src/calibration.ts`.

#### 3. Bounded Batch Execution
Execute full or sample dataset with strict retry and call bounds:
```bash
pnpm agentforge run --adapter <adapter-id> --input <official-inputs> --output runs/final-run/output.json
```
- Safety guarantees:
  - Max transient retries: 2 (`MAX_TRANSIENT_RETRIES=2`)
  - Max schema repair attempts: 1 (`MAX_SCHEMA_CORRECTIONS=1`)
  - Bounded concurrency pool: 4 workers (`BATCH_CONCURRENCY=4`)
  - Checkpointing: resumes skipped records automatically from `checkpoint.jsonl`.
- **Failure Response:** If run is interrupted, re-run with `--resume <runId>` to resume without reprocessing completed records.
- **Source Document:** `packages/orchestrator/src/index.ts` (FR-013, FR-033).

#### 4. Continuous AI Transcript Archival
During the hackathon, coding assistance interactions must be recorded in real-time.
- Export chat transcripts from IDE / assistant tool as `.json` or `.md`.
- Register the genuine transcript:
  ```bash
  pnpm agentforge transcript add --file path/to/exported-chat.json --tool "Claude Code" --turns 42
  ```
- **Expected Success Condition:** Transcript copied to `docs/ai-transcript/transcript-vault/` and indexed in `vault-index.json`.
- **Critical Rule:** Never use `docs/ai-transcript/INDEX.md` as the transcript artifact.
- **Source Document:** `docs/ai-transcript/README.md`.

---

## Phase 4: Before Submission (T-45m to T-0m)

### Objectives
- Validate output deliverable against official contract.
- Package code, output, and authentic transcript into compliant submission bundle.
- Verify every artifact independently against the official 50 MB limit.
- Scan for secrets and verify final readiness gate.

### Operational Checklist & Commands

#### 1. Output Contract Revalidation
```bash
pnpm agentforge validate --adapter <adapter-id> --output runs/final-run/output.json
```
- **Expected Success Condition:** Output file exists, is valid JSON, contains all expected records, matches schema contract.
- **Failure Response:** Fix output formatting before packaging.

#### 2. Packaging Dry-Run & Secret Scan
```bash
pnpm agentforge package --dry-run
```
- **Expected Success Condition:**
  - `Code Archive`: valid size, `<= 50 MB`
  - `Output Deliverable`: valid size, `<= 50 MB`
  - `AI Transcript`: resolved, `<= 50 MB`
  - `Secrets Scan`: 0 violations
  - Exit code: 0 if all 3 artifacts exist, or nonzero with clear actionable blocker message.
- **Failure Response:** Remove forbidden files (`node_modules`, `.env`) if code archive exceeds 50 MB.
- **Source Document:** `packages/orchestrator/src/packaging.ts`.

#### 3. Execute Real Packaging
```bash
pnpm agentforge package --output-file runs/final-run/output.json
```
- **Expected Success Condition:**
  - Artifacts written to `dist/submission/`:
    1. `code.zip` (Source archive, `< 50 MB`)
    2. `output.json` (Challenge output, `< 50 MB`)
    3. `transcript.<ext>` (Authentic AI conversation, `< 50 MB`)
  - `dist/submission/submission-manifest.json` generated.
- **Failure Response:** Inspect manifest `blockers` array.

#### 4. Run Final Submission Readiness Gate
```bash
pnpm agentforge readiness
```
- **Expected Success Condition:** All required gates report `PASS`.
- **Review Table:**
  | Gate ID | Check Name | Final Target |
  |---|---|---|
  | `brief` | Official Challenge Brief | `PASS` |
  | `contract` | Official Challenge Contract | `PASS` |
  | `live_smoke` | Live Provider Connectivity | `PASS` |
  | `live_calibration`| Real-Model Calibration | `PASS` |
  | `drills` | Core Functional Capabilities | `PASS` |
  | `code_zip` | Clean Code Archive Size (`<= 50 MB`)| `PASS` |
  | `output_artifact` | Valid Output Artifact (`<= 50 MB`) | `PASS` |
  | `transcript` | Authentic AI Chat Transcript (`<= 50 MB`) | `PASS` |
  | `secrets_and_limits`| Security & Limit Compliance | `PASS` |
- **Source Document:** `packages/orchestrator/src/submission-gate.ts`.

---

## Phase 5: AI Judge Interview & Defense

### Objectives
- Present actual architecture and evidence-driven design.
- Explain trade-offs, failures encountered, and how they were resolved.
- Demonstrate separation of mock vs live performance.
- Never claim unverified capabilities.

### Operational Checklist & Key Talking Points

#### 1. Generate Interview Pack
```bash
pnpm agentforge report --run runs/final-run
```
- Inspect `docs/interview-pack.md` and `docs/interview-rehearsal.md`.
- Key talking points:
  1. **Core Architecture:** Modular pipeline (Ingest -> Parse -> Normalize -> Context -> Decide -> Validate -> Output). Domain logic isolated in `ChallengeAdapter`. Core has zero domain dependencies.
  2. **Reliability & Recovery:** State machine transitions enforced with policy gates. Atomic writes prevent partial outputs. Checkpointing allows resuming interrupted runs without duplicated API costs.
  3. **Cost & Rate Control:** Strict budget guard limits LLM calls per run. Exponential backoff handles transient rate limits. Heuristic fallback ensures graceful degradation.
  4. **Evidence-Driven Claims:** Mock rehearsal and drills are clearly documented as mock benchmarks. Live measurements are strictly isolated to authenticated runs.
  5. **Failures Encountered & Remediation:** Refer to failure clusters identified during calibration/iteration and explain concrete prompt or validation repairs made.

#### 2. Live Web Viewer Demonstration (if requested)
```bash
pnpm dev
# Navigate to http://localhost:3000
```
- Show:
  - Run timeline with granular stage transitions and event logs.
  - Metrics overview (latency, success rate, cost).
  - Output validator evidence refs and schema compliance.
  - Configuration snapshot ensuring reproducible provenance.

---

## Quick Reference: Operational Commands Cheat Sheet

| Intent | Command | Expected Outcome |
|---|---|---|
| Environment diagnostics | `pnpm agentforge doctor` | `HEALTHY` system diagnostics |
| CLI preflight check | `pnpm agentforge preflight` | Core requirements passed |
| Run all mock drills | `pnpm agentforge drill all` | 2 drills pass against fixtures |
| Synthetic kickoff rehearsal | `pnpm agentforge rehearsal` | 9-step rehearsal passes |
| Live provider probe | `pnpm agentforge provider-smoke --live --max-calls 1` | Latency measured, secrets redacted |
| Live calibration | `pnpm agentforge calibrate --live --sample 3` | Sample metrics computed |
| Execute run | `pnpm agentforge run --adapter <id> --input <in> --output <out>` | Run completes, output validated |
| Validate output | `pnpm agentforge validate --adapter <id> --output <out>` | Contract verified |
| Check readiness | `pnpm agentforge readiness` | Current readiness report |
| Packaging dry run | `pnpm agentforge package --dry-run` | Manifest verified against 50 MB |
| Full packaging | `pnpm agentforge package --output-file <out>` | 3 artifacts generated in `dist/submission/` |
| Web Run Viewer | `pnpm dev` | Viewer at `http://localhost:3000` |
