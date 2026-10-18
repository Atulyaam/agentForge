# Decision Log

All significant design decisions are recorded here with rationale and evidence.
See SSOT Section 19 for the full ADR list.

## ADR-025 — Initial build from SSOT v5.1   (14 Oct 2026 12:00 IST)
Problem: No code exists; need to bootstrap the entire T0 foundation.
Decision: Build S0 + S1 combined (repo, config, schemas, error taxonomy, policy, orchestrator, DemoAdapter, CLI) then immediately move to S2.
Alternatives: Build each sprint sequentially over separate days.
Evidence: Calendar shows S2 should be in progress by 14 Oct; combining S0+S1 recovers schedule.
Trade-offs / limits: Dense first commit; may need refactoring once real challenges surface.

## ADR-026 — S4 Gate Closure (G2-lite Verified)   (16 Oct 2026 19:15 IST)
Problem: S4 milestone implementation must be formally validated against Gate G2-lite criteria in SSOT Table 12.2.
Decision: Close Gate G2-lite with full test and manual live probe evidence. T1-lite (file-based Next.js viewer over `runs/<runId>/`) is confirmed operational. T1-full (PostgreSQL/Prisma/SSE) is marked Deferred as allowed by ADR-021 to protect pre-kickoff mock drills.
Alternatives: Implement T1-full (Prisma, PostgreSQL, SSE). Rejected per Section 12.1 hard cut rule and Section 1.2 (avoiding infrastructure overhead that does not advance the judged signals).
Evidence:
- `pnpm test`: 106 tests passed across 8 test suites.
- `pnpm test:e2e`: 19 tests passed across 2 suites.
- `pnpm --filter web build`: compiled production Next.js application cleanly with 0 errors.
- Live HTTP verification: `/api/health/live`, `/api/health/ready`, `/api/runs`, `/api/runs/:runId`, `/api/runs/:runId/events`, and `/api/runs/:runId/artifacts/:filename` returned 200 OK.
- Security: Directory traversal attacks (`..`, absolute paths, `.env`) verified blocked with 400 Bad Request.
- Accessibility: Non-color-only status cues with SVG icons, visible focus rings, semantic HTML.
Trade-offs / limits: Runs are started and cancelled via the CLI adapter; web viewer is read-only over `runs/<runId>/`.

## ADR-027 — Milestone S5 Closure (P1 Extras Verified)   (16 Oct 2026 19:40 IST)
Problem: S5 roadmap scope from SSOT Section 12 (Table 12.1 & 13.2) requires deterministic baseline comparator (FR-035), failure clustering (FR-036), sample/dry-run modes (FR-037), bounded concurrency pool (FR-038), interview pack scaffold (FR-039), and run diff (FR-040).
Decision: Implement all S5 core deliverables in `@agentforge/evaluation`, `@agentforge/orchestrator`, and `apps/cli`. In accordance with SSOT Section 12.1 ("T2 (Redis/BullMQ) only if G2 passed with slack; otherwise mark Deferred"), explicitly mark T2 as Deferred to protect mock drills (S6) and avoid external infrastructure complexity without explicit challenge requirement.
Alternatives:
- Implement T2 Redis/BullMQ queue runner: Rejected per SSOT Table 12.1 and Engineering Constraints (avoiding unrequested Redis infrastructure).
- Skip or mock S5 features: Rejected; all S5 features implemented end-to-end with real execution and tests.
Evidence:
- `pnpm agentforge eval --baseline` (S5 acceptance command): executed successfully, evaluated agent against rule-based heuristic baseline, and wrote comparative metrics table with measured lift to `eval-baseline.json`.
- `pnpm agentforge run --sample 2`: verified processing exactly 2 records with `mode: SAMPLE`.
- `pnpm agentforge run --dry-run`: verified validating wiring and context with 0 LLM calls with `mode: DRY_RUN`.
- `pnpm agentforge diff <runA> <runB>`: verified detecting changed outputs, metric deltas, and newly failing regressions.
- `pnpm agentforge interview-pack`: verified generating `docs/interview-pack.md` with 10 mandatory questions, 5-minute script, and live metrics.
- Concurrency pool: verified running records with `BATCH_CONCURRENCY` workers, isolating record failures, and preserving input-to-output order.
- `pnpm test`: 116 tests passed across 9 test suites (including 10 new integration tests in `s5-extras.test.ts`).
- `pnpm test:e2e`: 19 tests passed across 2 test suites.
- `pnpm agentforge preflight`: all checks passed with exit code 0.
Trade-offs / limits: Bounded concurrency pool operates in-process with checkpoint isolation; multi-node distributed queue deferred to post-hackathon tier T2.

## ADR-028 — Milestone S6 Closure (Mock Challenge Drills Verified)   (16 Oct 2026 20:05 IST)
Problem: S6 requires executing two complete, repeatable challenge drills representing distinct archetypes from SSOT Appendix A: Workstream 1 (Classification/Triage) and Workstream 2 (RAG Q&A with Explicit Abstention), with shared evaluation, baseline comparison, and evidence-backed drill reports (Workstream 3).
Decision:
1. Workstream 1 implemented via `support-triage` adapter (`TriageAdapter` v1.0.0). Evaluates ticket classification, priority assessment, and deterministic escalation policies against ground truth (`fixtures/drill-1-triage/tickets-expected.json`) strictly isolated from runtime inputs. Enforces deterministic high-risk policy gate (`applyTriagePolicyGate`) preventing adversarial prompt injections from overriding critical safety classifications.
2. Workstream 2 implemented via `policy-rag` adapter (`RagAdapter` v1.0.0). Performs local BM25-style keyword retrieval over a bounded 8-chunk local corpus (`fixtures/drill-2-rag/corpus.json`) with stable chunk IDs without external vector databases or network services. Implements mandatory abstention gates when evidence is below threshold, strips hallucinated chunk references in post-decision validation, and independently verifies citations in the evaluator.
3. Workstream 3 implemented via `pnpm agentforge drill [1|2|all]` and npm scripts (`drill:1`, `drill:2`, `drill`), generating comprehensive reports at `docs/drill-1-report.md` and `docs/drill-2-report.md`.
Alternatives:
- Add external vector database (Chroma/Pinecone/Milvus) or external retrieval service: Explicitly rejected per SSOT and constraints; local bounded retrieval satisfies requirements without operational fragility.
- Allow agent to self-claim groundedness without independent verification: Rejected; evaluator independently checks all citations against ground-truth corpus.
Evidence:
- `pnpm agentforge drill all`: ran both drills, persisted complete run directories (`runs/drill-1-triage/` and `runs/drill-2-rag/`) containing run.json, trace.jsonl, input.json, output.json, metrics.json, config.snapshot.json, checkpoint.jsonl, and eval-report.json.
- `docs/drill-1-report.md` & `docs/drill-2-report.md` generated with measured facts, run durations, baseline comparisons, and adversarial injection tests.
- `pnpm test`: 137 tests passed across 11 test files (including 21 new tests in `drill-1-triage.test.ts` and `drill-2-rag.test.ts`).
- `pnpm test:e2e`: 19 tests passed across 2 test files.
- `pnpm typecheck`: `tsc -b` passed with 0 errors.
- `pnpm build`: all packages and web app compiled cleanly.
- `pnpm agentforge preflight`: passed with exit code 0.
Trade-offs / limits: Bounded keyword retrieval is tuned for synthetic benchmark queries; multi-chunk disjoint reasoning with semantic paraphrasing can be extended in production with embedding models.

## ADR-029 — Milestone S7 Closure (Freeze, Audit, and Hackathon Readiness)   (16 Oct 2026 20:30 IST)
Problem: S7 requires a complete pre-kickoff release freeze and audit: clean verification of all gates, full documentation reconciliation, security audit (secret scanning, path traversal, injection defenses), freeze checklist publication, and tag checkpoint creation.
Decision: Close Gate G3 (Foundation Frozen) with GO decision.
1. All core foundation packages, adapters, CLI commands, and T1-lite Web Run Viewer are verified and frozen.
2. Verified that `.gitignore` correctly scopes root `/runs/` without suppressing Next.js web run routes (`apps/web/src/app/runs`).
3. Reconciled all documentation: `README.md`, `docs/interview-pack.md`, `docs/drill-1-report.md`, `docs/drill-2-report.md`, and created `docs/freeze-checklist.md`.
4. Stated explicit boundary disclosure: current 100% metrics reflect deterministic local `MockLLMProvider` simulation on compact synthetic benchmarks; no claims of live model superiority or general production accuracy are made.
Alternatives:
- Add external live LLM benchmarks prior to kickoff: Rejected to conserve quota and avoid non-deterministic network dependency before the real challenge brief is received.
- Expand web tier to T1-full (Prisma/PostgreSQL): Confirmed Deferred as established in ADR-026 to preserve simplicity and zero external database dependencies.
Evidence:
- `pnpm test`: 137 unit and integration tests passed across 11 test suites.
- `pnpm test:e2e`: 19 web E2E and API tests passed across 2 suites.
- `pnpm typecheck`: clean TypeScript compilation with 0 errors.
- `pnpm build`: all packages and web viewer built cleanly.
- `pnpm agentforge preflight`: all 7 security, secret, and structural checks passed.
- `git diff --check`: 0 whitespace errors or conflict markers.
- `pnpm agentforge drill all`: executed and verified.
- `docs/freeze-checklist.md` published and committed with release tag `v0.1.0-s7-freeze`.
Trade-offs / limits: Foundation is frozen for pre-kickoff rest. Live challenge adapter implementation begins at Hour 0 under Milestone S8.

## ADR-030 — Alignment of Submission Artifact Limits with HackerRank Orchestrate Contest Rules (50 MB Uniform Ceiling)   (18 Oct 2026 18:15 IST)
Problem: The initial packaging validator implementation defaulted the code archive limit to 100 MB while output and transcript were set to 50 MB. The official HackerRank Orchestrate instructions mandate that each of the three submitted files—code ZIP, output file, and AI chat transcript—must not exceed 50 MB.
Decision:
1. Align the default size limit for all three deliverables uniformly to 50 MB (`OFFICIAL_MAX_FILE_SIZE_MB = 50`, `OFFICIAL_MAX_FILE_SIZE_BYTES = 52,428,800` bytes).
2. Enforce strict contest mode by default (`contestMode: true`). In contest mode, configurations exceeding 50 MB fail closed with `CONFIG_INVALID` to prevent accidental disqualification.
3. Decouple output file validation from rigid JSON-only assumptions by supporting pluggable validator strategies: `json`, `jsonl`, `csv`, `text`, `any`, and custom validation functions.
4. Execute fast pre-archive checks on standalone output and transcript artifacts prior to triggering zlib archive compression, avoiding expensive CPU cycles on invalid inputs.
5. Provide boundary testing covering: compliant files (< 50 MB), files exactly at the limit (52,428,800 bytes), files 1 byte over the limit, and missing/unreadable files.
Alternatives:
- Keep 100 MB default for code zip: Rejected; creates immediate disqualification risk under official HackerRank Orchestrate submission specifications.
- Hardcode challenge-specific JSON schema: Rejected; official brief has not yet been received. Generic format strategies support whatever tabular or structured output format the live challenge requires.
Evidence:
- `tests/integration/packaging.test.ts`: boundary tests confirm exact byte enforcement, pre-archive fast abort, and strategy validation.
- `pnpm agentforge package`: generated compliant 0.21 MB archive matching all size constraints.
Trade-offs / limits: If an unusually large code base were ever created, 50 MB could constrain assets. However, strict exclusions (`node_modules/`, `dist/`, `.next/`, `runs/`, raw datasets) ensure the clean project tree remains well under 1 MB.

## ADR-031 — Authentic Transcript Vault, Rehearsal False-Positive Remediation, and Final Submission Gate   (18 Oct 2026 20:00 IST)
Problem: The packaging rehearsal previously defaulted `--transcript` to `docs/ai-transcript/INDEX.md`. Because `INDEX.md` is a non-empty ledger table (~195 bytes), the validator treated it as a valid transcript file, falsely claiming `READY` status when no genuine coding-tool conversation had yet been exported or recorded.
Decision:
1. **Decouple Vault Ledger from Transcript Deliverables:** `docs/ai-transcript/INDEX.md` is strictly designated as an immutable ledger recording registered file hashes and source metadata. It is explicitly rejected as a transcript deliverable across packaging, CLI, and readiness gate checks.
2. **Authentic Transcript Import (`registerAuthenticTranscript`):** Users must explicitly import real exported AI coding sessions (`pnpm agentforge transcript add <file>`). Supports Markdown, plain text, and JSON exports. Computes SHA-256 digests, stores truthful metadata, and detects on-disk tampering or corruption.
3. **Strict Zero-Fabrication Integrity Policy:** Conversation history must never be synthetically invented, simulated, or reconstructed from git commits or runtime logs. If the coding environment lacks automated export, manual copying of real conversation history into a markdown/text file is supported and verified honestly.
4. **Final Submission Readiness Gate (`pnpm agentforge readiness` / `gate`):** Provides a single authoritative pre-submission validator that evaluates:
   - `repo_health` (PASS/FAIL)
   - `code_zip` (PASS/FAIL, <= 50 MB)
   - `output_file` (PASS/FAIL, <= 50 MB, format validated)
   - `challenge_schema` (PASS or PENDING prior to kickoff)
   - `authentic_transcript` (PASS or BLOCKED)
   - `secrets_and_limits` (PASS/FAIL, <= 50 MB)
   - `overallStatus` (READY vs BLOCKED)
5. **Separation of Engineering Health from Submission Readiness:** A project with passing tests and valid code archive reports `engineeringHealth: PASS`, but if the genuine transcript is not yet registered or the official challenge brief is pending, `submissionReadiness` reports `BLOCKED`.
Alternatives:
- Generate a synthetic AI transcript to achieve green packaging: Strictly rejected; violates contest integrity and risks immediate disqualification.
- Reconstruct chat from traces or git commit messages: Strictly rejected; dishonest and unrepresentative of genuine human-AI pairing.
- Silently accept INDEX.md: Strictly rejected; fixes the false-positive root cause permanently.
Evidence:
- `tests/integration/transcript.test.ts`: 12 integration tests verifying valid transcript registration, format detection, hash mismatch/tampering, secrets rejection, and 50 MB bounds.
- `tests/integration/packaging.test.ts`: Regression tests verifying explicit rejection of `docs/ai-transcript/INDEX.md` and fail-closed behavior.
- `tests/integration/submission-gate.test.ts`: Integration tests verifying separation of engineering health from submission readiness.
- `pnpm agentforge readiness`: Confirms honest reporting (`Engineering: PASS`, `Submission: BLOCKED`).
Trade-offs / limits: Requires an explicit user export step before final packaging can succeed, which is intentional and guarantees authentic submission compliance.

## ADR-032 — Live Provider Validation, Control-Plane Budget Enforcement, and Operational Calibration Engine   (18 Oct 2026 21:00 IST)
Problem: While AgentForge possessed robust deterministic MockLLMProvider and synthetic challenge drills, real frontier model connectivity and compatibility remained unverified. Uncontrolled live testing could accidentally make network calls during CI, incur unexpected costs, leak API keys into test logs, or claim false benchmark generalization from tiny samples.
Decision:
1. **Explicit Live Opt-In (`--live`):** All live provider interaction requires explicit operator opt-in via `--live`. Without this flag or if credentials (`LLM_API_KEY`) are missing, all commands return `PENDING` with actionable instructions. Zero live network calls are made during CI, default test runs, or local builds.
2. **Native Provider Adapter (`LiveHttpLLMProvider`):** Implemented directly over native Node `fetch` with `AbortController` timeouts (default: 30s), OpenAI-compatible chat completion format, and zero heavy SDK dependencies.
3. **Control-Plane BudgetGuard Enforcement:** Strict invocation ceilings are enforced at the control-plane level before requests are dispatched (`--max-calls 1` for smoke tests, `--max-calls 3` per adapter for calibration).
4. **Structured Probe Smoke Test (`pnpm agentforge provider-smoke`):** Issues a single request validating adherence to `SmokeProbeSchema`, reporting configuration validity, latency, schema conformance, and provider-reported tokens while redacting keys and auth headers.
5. **Bounded Real-Model Calibration (`pnpm agentforge calibrate`):** Runs bounded samples (default 3 records per adapter) against existing `support-triage` and `policy-rag` adapters. Evaluates outputs independently against separately stored ground truth without ever leaking labels to prompts. Missing token metrics are reported as `'unavailable'`.
6. **Separation of Evidence in Submission Gate:** Evaluates independent dimensions (`repo_health`, `mock_regression`, `live_smoke`, `live_calibration`, `challenge_schema`, `authentic_transcript`). Passing local unit tests does not establish live provider readiness, and small-sample calibration is explicitly disclaimed as not a general benchmark.
Alternatives:
- Include live API keys in CI/repo secrets: Strictly rejected; violates zero-leakage security constraints.
- Use heavy vendor SDKs (e.g., openai, @langchain): Rejected; adds dependency bloat and vendor lock-in.
- Infer token counts or monetary cost from character length: Strictly rejected; dishonest metric estimation.
Evidence:
- `packages/llm/src/live-provider.test.ts`: 9 unit tests verifying OpenAI format, token extraction, 401 redaction, 429 rate limit, 500 internal error redaction, malformed JSON, and timeout mapping.
- `tests/integration/provider-validation.test.ts`: 9 integration tests verifying offline `PENDING` states, placeholder credentials never hitting the network, call-cap enforcement, and non-overwriting of canonical drill reports.
- `pnpm agentforge provider-smoke` & `pnpm agentforge calibrate`: return clean `PENDING` states offline and compliant outputs with mock providers.
Trade-offs / limits: Live tests remain `PENDING` until the operator sets a real `LLM_API_KEY`. Calibration on small samples provides operational sanity checking, not statistical benchmark validation.

## ADR-033 — Readiness Gate State Accuracy, Live Provider Contract Audit, and Kickoff Rehearsal Engine   (18 Oct 2026 21:30 IST)
Problem:
1. **Readiness Gate False-Positive:** The readiness gate previously reported `Challenge-Specific Domain Contract: PASS` even though the official challenge brief has not been received. The old check evaluated `briefContent.length > 500` against a template file that lacked the exact string `'Paste the complete, unaltered challenge problem statement here'`, erroneously inferring that the brief had been fulfilled. Furthermore, mock drill outputs (`runs/drill-1-triage/output.json`) were accepted as official challenge deliverables.
2. **Live Provider Contract Hardening:** `LiveHttpLLMProvider` mapped timeouts to generic `INTERNAL_ERROR` rather than canonical `LLM_TIMEOUT`, lacked `customHeaders` support for vendor proxies, and required strengthened mocked-fetch contract tests.
3. **Kickoff Rehearsal Procedure:** The team lacked a repeatable, deterministic CLI command to rehearse the Hour 0–3 kickoff procedure from brief ingestion to packaging dry-run without fabricating official competition artifacts or claiming live performance.

Decision:
1. **Accurate Readiness Gate State Architecture:**
   - Separated `officialBrief` (`PASS` | `PENDING`) and `officialContract` (`PASS` | `PENDING` | `FAIL`) into distinct, independent report dimensions.
   - Implemented `inspectOfficialBrief(rootDir, customPath)`: strictly detects unfulfilled template placeholders (e.g. `[PASTE EXACT CHALLENGE TEXT`, `Challenge Brief — Template`, `PENDING_KICKOFF`) and requires confirmed problem statement (> 200 chars).
   - Implemented `inspectOfficialContract(...)`: strictly treats mock drill schemas (`drill-1-triage`, `drill-2-rag`) as benchmark baselines, keeping the official challenge contract `PENDING` until the official brief is confirmed and a dedicated challenge adapter/validator is bound.
   - Fail-closed submission readiness: `submissionReadiness` is strictly `BLOCKED` if either the official brief is pending, official contract is pending, or authentic transcript is missing. Local engineering health remains `PASS`.
2. **Live Provider Contract Audit & Hardening:**
   - Explicitly mapped `AbortError` / network timeouts to `AgentForgeError('LLM_TIMEOUT', ...)`.
   - Added `customHeaders?: Record<string, string>` to `LiveHttpLLMProviderOptions` to support provider-specific routing headers (e.g. OpenRouter `HTTP-Referer`).
   - Verified URL normalization (stripping trailing slashes before appending `/chat/completions`).
   - Strengthened mocked-fetch contract tests covering: 200 OK with token extraction, 401 Unauthorized with credential redaction, 429 Rate Limited, 500 Internal Error with safe body redaction, malformed non-JSON bodies throwing `LLM_INVALID_OUTPUT`, timeout throwing `LLM_TIMEOUT`, empty choice arrays, and zero network calls when placeholder keys are configured.
3. **Synthetic Kickoff Workflow Rehearsal Engine (`pnpm agentforge rehearsal`):**
   - Implemented `runKickoffRehearsal` in `@agentforge/orchestrator` covering 9 structured steps:
     1. Ingest synthetic brief with verbatim mock prompt and technical interpretation (`runs/kickoff-rehearsal/mock-brief.md`).
     2. Identify input/output contracts, 1:1 cardinality constraints, confidence bounds, and evaluation metrics.
     3. Select existing `support-triage` adapter with explicit architectural justification.
     4. Execute heuristic keyword baseline on synthetic fixtures (`fixtures/drill-1-triage/tickets.json`).
     5. Execute mock adapter pipeline with `executeRun`, persisting execution trace (`run-trace.json`), configuration snapshot, and metrics.
     6. Independently evaluate agent output against isolated ground truth (`fixtures/drill-1-triage/tickets-expected.json`).
     7. Validate mock output contract (10 records, <= 50 MB, 0 secrets).
     8. Execute submission packaging in dry-run mode (`SubmissionPackager` with `dryRun: true`), verifying file collection and fail-closed transcript handling.
     9. Generate rehearsal reports (`runs/kickoff-rehearsal/rehearsal-report.json` and `docs/kickoff-rehearsal-report.md`).
   - All synthetic brief text, outputs, and reports are strictly labeled `[REHEARSAL MOCK DATA]`.
   - The official brief (`docs/challenge-brief.md`) is untouched and remains `PENDING`.
   - Canonical S6 drill reports (`docs/drill-1-report.md`, `docs/drill-2-report.md`) are never overwritten.
   - Deterministic and zero-network: runs reliably in offline CI environments.

Alternatives considered:
- Mark challenge contract PASS based on mock drill output: Rejected; creates false sense of readiness before receiving the competition brief.
- Invent a third mock adapter for rehearsal: Rejected; reuses existing `support-triage` adapter to test the actual kickoff procedure cleanly without bloat.
- Fabricate synthetic transcript to pass packaging during rehearsal: Rejected; strictly violates contest rules and security policies.

Evidence:
- `tests/integration/submission-gate.test.ts`: 9 integration tests verifying mock contract vs official contract separation, missing brief blocking readiness, valid configured contract passing, missing transcript blocking readiness, and all prerequisites passing together.
- `packages/llm/src/live-provider.test.ts`: 9 unit tests verifying complete contract for OpenAI-compatible completions, error codes, timeouts, and redaction.
- `tests/integration/provider-validation.test.ts`: 9 integration tests verifying zero network calls for placeholder keys, 1-call smoke ceiling, and calibration isolation.
- `tests/integration/kickoff-rehearsal.test.ts`: Integration test verifying complete 9-step rehearsal execution.
- `pnpm agentforge rehearsal`: Succeeded with all 9 steps PASSED.
- `pnpm agentforge readiness`: Confirms honest reporting (`Local Engineering: PASS`, `Official Brief: PENDING`, `Official Contract: PENDING`, `Deliverables: BLOCKED`).

Trade-offs / limits: Final contest submission readiness remains blocked until Hour 0 brings the authentic challenge brief and human-AI conversation export. This accurately reflects real competition requirements.
