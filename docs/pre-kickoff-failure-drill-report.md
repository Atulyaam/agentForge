# AgentForge — Pre-Kickoff Failure-Injection & Recovery Drill Report

**Document Version:** 1.0.0  
**Date:** October 18, 2026  
**Target Milestone:** Final Reliability Batch (Reproducibility, Recovery, Operator Diagnostics)  
**Branch:** `prep/kickoff-readiness`  
**Test Suite Status:** 186 Unit/Integration Tests Passing | 19 Web E2E Tests Passing | TypeScript Clean  

---

## 1. Executive Summary

This report documents the deterministic failure-injection and recovery verification conducted prior to the October Orchestrate challenge kickoff. Seven critical operational failure scenarios were tested against the orchestrator, policy guards, budget controllers, checkpoint loaders, and submission packaging validators.

All drills were conducted **100% offline** using `MockLLMProvider`, deterministic fixtures, and sandboxed file environments. No live API tokens were consumed and no external network dependencies were invoked.

```
═══════════════════════════════════════════════════════════════════════════════
Scenario                                   Mechanism             Test Outcome
───────────────────────────────────────────────────────────────────────────────
1. Provider Timeout & Rate Limits          Backoff + Retries     ✅ PASSED (2 attempts)
2. Malformed Structured Model Output       Schema Correction     ✅ PASSED (Correction + Fail-Closed)
3. LLM Call Budget Exhaustion              BudgetGuard           ✅ PASSED (BUDGET_EXCEEDED halted)
4. Corrupted Checkpoint Lines              loadCheckpoint        ✅ PASSED (Corrupt skipped, valid kept)
5. Process Interruption & Resume           Resume Parity         ✅ PASSED (Zero duplicate LLM calls)
6. Invalid Output Rejected by Packager     Validator + Packager  ✅ PASSED (Fail-closed <= 50 MB)
7. State Machine Immutability              assertValidTransition ✅ PASSED (Terminal states locked)
═══════════════════════════════════════════════════════════════════════════════
```

---

## 2. Detailed Scenario Verifications

### Scenario 1: Provider Timeout & Simulated Rate Limit (FR-013, FR-014)

- **Verification Command:**
  ```bash
  pnpm vitest run tests/integration/faults/fault-recovery.test.ts -t "Scenario 1"
  ```
- **Test Cases:**
  1. `recovers successfully when transient rate limits resolve within retry budget`
  2. `marks record failed when transient retries are completely exhausted`
- **Root Cause Simulated:**
  Upstream provider returns transient HTTP 429 (`LLM_RATE_LIMITED`) or socket timeout (`LLM_TIMEOUT`).
- **Recovery Behavior:**
  - `isRetryable(category)` identifies transient error types.
  - Backoff delay calculated with exponential multiplier and random jitter (`backoffMs(retry)`), capped at 60s.
  - When provider recovers on retry 1, `record_retried_success` is emitted, record status transitions to `passed`, and final result records `attempts: 2`.
  - When retries are exhausted (exceeding `MAX_TRANSIENT_RETRIES=2`), record transitions to `failed`, error category and sanitized message are recorded, and batch processing proceeds without crashing.
- **Run ID / Artifact:** Isolated run `agentforge-fault-test-*`, `checkpoint.jsonl` logged with passed/failed records.
- **Remaining Limitations:** Unresolvable upstream network outages lasting longer than configured retry budget will result in record failures; overall run status reflects partial failure.

---

### Scenario 2: Malformed Structured Model Output & Schema Repair (FR-008)

- **Verification Command:**
  ```bash
  pnpm vitest run tests/integration/faults/fault-recovery.test.ts -t "Scenario 2"
  ```
- **Test Cases:**
  1. `repairs malformed JSON via iterative schema correction prompt`
  2. `fails closed when schema correction attempts are exhausted`
- **Root Cause Simulated:**
  Model emits syntax-corrupted JSON (e.g. unclosed brackets, markdown formatting, or schema violation such as string confidence instead of float).
- **Recovery Behavior:**
  - `LLMAdapter.callStructured()` detects validation failure via `tryParse()`.
  - Automatically dispatches corrective prompt including the exact validation error message and schema name.
  - Successfully repairs response and parses into validated typed object.
  - If malformed responses persist past `MAX_SCHEMA_CORRECTIONS` (default: 1), throws `AgentForgeError('LLM_INVALID_OUTPUT')`.
  - Fails closed: an invalid model response is **never** accepted simply because the model claimed success.
- **Run ID / Artifact:** Verified with `DemoDecisionSchema` and `ZodError` tracking.
- **Remaining Limitations:** Complex hallucinations requiring multi-step reasoning adjustments require domain-specific repair prompts beyond syntax fixes.

---

### Scenario 3: LLM Call & Token Budget Exhaustion (FR-009, FR-014)

- **Verification Command:**
  ```bash
  pnpm vitest run tests/integration/faults/fault-recovery.test.ts -t "Scenario 3"
  ```
- **Test Cases:**
  1. `BudgetGuard halts execution immediately when call limit is exceeded`
  2. `orchestrator halts batch execution when run budget is exhausted`
- **Root Cause Simulated:**
  Run attempts to make more LLM calls than permitted by `MAX_LLM_CALLS_PER_RUN`.
- **Recovery Behavior:**
  - `BudgetGuard.check()` runs before dispatching requests to provider.
  - Throws non-retryable `AgentForgeError('BUDGET_EXCEEDED')`.
  - `isNonRetryable('BUDGET_EXCEEDED')` ensures zero retry attempts are made, preventing cost overrun.
  - Context status transitions to `failed`, event `run_error` is emitted with sanitized detail.
- **Remaining Limitations:** Records scheduled after budget exhaustion remain in `not_run` state.

---

### Scenario 4: Corrupted or Partially Written Checkpoint Data (FR-033)

- **Verification Command:**
  ```bash
  pnpm vitest run tests/integration/faults/fault-recovery.test.ts -t "Scenario 4"
  ```
- **Test Cases:**
  1. `safely skips corrupt lines in checkpoint.jsonl and loads valid entries`
- **Root Cause Simulated:**
  Abrupt process termination mid-write creating incomplete JSON fragments in `checkpoint.jsonl`.
- **Recovery Behavior:**
  - `loadCheckpoint()` processes line by line with robust JSON parse guards.
  - Corrupt or truncated lines are caught, logged to stderr (`Corrupted checkpoint line, will reprocess: ...`), and skipped.
  - All valid entries prior to and following the corrupted line are parsed and populated into the checkpoint map.
  - Records on corrupted lines are simply scheduled for re-execution upon resume, ensuring no unverified outputs are trusted.
- **Remaining Limitations:** If output on disk is unrecoverable, the record will consume one additional LLM call during replay.

---

### Scenario 5: Process Interruption Followed by Run Resume (FR-033)

- **Verification Command:**
  ```bash
  pnpm vitest run tests/integration/faults/fault-recovery.test.ts -t "Scenario 5"
  ```
- **Test Cases:**
  1. `resumes run without re-executing already completed records and preserves 1:1 parity`
- **Root Cause Simulated:**
  Run interrupted after processing record 1 of 2. Operator issues resume command (`pnpm agentforge run --input ... --resume <runId>`).
- **Recovery Behavior:**
  - Initial run processed `rec-1` (`passed`) before halting.
  - Resumed run initializes with `options.resumeId`.
  - Orchestrator loads checkpoint map and previous `output.json`.
  - `rec-1` is identified as `status: 'passed'`; event `record_skipped` with `reason: 'resume'` is emitted.
  - Existing output and evidence reference (`checkpoint_resume`) are carried over into new run context.
  - Zero duplicate LLM calls made for `rec-1`.
  - `rec-2` is processed normally.
  - Final output JSON contains complete 2-record array preserving input order and ID parity.
- **Run ID / Artifact:** `initial-run` -> `resumed-run`, verified in `tests/integration/faults/fault-recovery.test.ts`.

---

### Scenario 6: Invalid Output Rejected by Packaging Validator (FR-015, Workstream 1)

- **Verification Command:**
  ```bash
  pnpm vitest run tests/integration/faults/fault-recovery.test.ts -t "Scenario 6"
  ```
- **Test Cases:**
  1. `rejects output when records are missing or invalid despite success claims`
  2. `packaging validator rejects non-JSON or invalid deliverables in contest mode`
- **Root Cause Simulated:**
  Agent outputs incomplete records, empty files, or files exceeding official 50 MB limits.
- **Recovery Behavior:**
  - `adapter.validateOutput()` executes strict record count and ID parity checks against raw input.
  - Throws `OUTPUT_INVALID` if output count !== input count.
  - `SubmissionPackager.validateArtifact()` validates file existence, readability, format conformity, and size <= 50 MB.
  - Rejects corrupted or oversized artifacts with `safeToPackage: false`.
  - Code ZIP packaging is aborted prior to archiving.

---

### Scenario 7: State Machine Immutability & Terminal Status Guards (Section 7.2)

- **Verification Command:**
  ```bash
  pnpm vitest run tests/integration/faults/fault-recovery.test.ts -t "Scenario 7"
  ```
- **Test Cases:**
  1. `disallows state transitions out of terminal states (succeeded, failed, cancelled)`
- **Root Cause Simulated:**
  Buggy orchestrator callback attempts to restart or modify a run already marked `succeeded`, `failed`, or `cancelled`.
- **Recovery Behavior:**
  - `assertValidTransition(from, to)` verifies state graph.
  - Disallows `succeeded → running`, `failed → queued`, `cancelled → running`.
  - Throws `AgentForgeError('Invalid state transition: ...')`.

---

## 3. Verification Log & Exact Outcomes

```bash
# 1. Full Monorepo Unit & Integration Suite
$ pnpm test
✓ packages/shared/src/index.test.ts       (21 tests)
✓ tests/integration/demo-adapter.test.ts   (14 tests)
✓ packages/policies/src/index.test.ts     (14 tests)
✓ packages/llm/src/index.test.ts          (11 tests)
✓ apps/web/src/lib/runs.test.ts           (14 tests)
✓ packages/schemas/src/index.test.ts      (13 tests)
✓ tests/integration/doctor.test.ts        (13 tests)
✓ tests/integration/drill-1-triage.test.ts (10 tests)
✓ tests/integration/drill-2-rag.test.ts   (11 tests)
✓ tests/integration/packaging.test.ts     (23 tests)
✓ tests/integration/web-e2e.test.ts       (8 tests)
✓ tests/integration/web-api.test.ts       (11 tests)
✓ tests/integration/s5-extras.test.ts     (10 tests)
✓ tests/integration/faults/fault-recovery.test.ts (13 tests)

Test Files: 14 passed (14)
Tests:      186 passed (186)
Duration:   9.87s

# 2. Web E2E Suite
$ pnpm test:e2e
Test Files: 2 passed (2)
Tests:      19 passed (19)

# 3. TypeScript Typecheck
$ pnpm typecheck
tsc -b (0 errors)

# 4. Monorepo Build
$ pnpm build
All workspaces built successfully (apps/web, packages/*, apps/cli)

# 5. Preflight Checklist
$ pnpm agentforge preflight
✅ All preflight checks passed!

# 6. S6 Mock Drills Execution
$ pnpm agentforge drill all
✅ Drill 1 completed successfully! (drill-1-triage)
✅ Drill 2 completed successfully! (drill-2-rag)

# 7. Packaging Dry Run Validation
$ pnpm agentforge package --dry-run
✅ Code Archive:  0.25 MB (<= 50 MB)
✅ Output File:   0.002 MB (<= 50 MB)
✅ AI Transcript: 0.00 MB (<= 50 MB)
✅ Secret Scan:   PASSED (0 secrets)
✅ Safe to package: true
```

---

## 4. Known Limitations & Unverified Behaviors

1. **Live Provider Reachability:**
   All verifications were executed with `MockLLMProvider` and synthetic fixtures. Connectivity, real-world latency, rate limits, and quota availability of live OpenAI / Anthropic endpoints are **PENDING_KICKOFF**. They will be confirmed during the official kickoff window.
2. **Dynamic Challenge Brief Adaptations:**
   Specific domain logic, schemas, and scoring criteria cannot be implemented until the official challenge brief is published on October 24, 2026, at 6:00 PM IST.
3. **External Job Queues:**
   `JOB_RUNNER=inline` is the frozen default for single-node contest operation. Multi-node Redis/BullMQ clustering is optional and untested in live environments.

---

## 5. Readiness Conclusion

The repository exhibits deterministic fault handling, resilient resume mechanics, trustworthy evidence tracking, and fail-closed submission validation. All reproducible verification commands exit with code 0.
