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




