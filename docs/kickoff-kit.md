# AgentForge — Challenge Kickoff Kit & 24-Hour Execution Guide

> Authoritative operational playbook for HackerRank Orchestrate October '26.
> Event kickoff: **Saturday 24 Oct 2026, 18:00 IST** (Build window: 24h, ends Sunday 25 Oct 2026, 18:00 IST).
> Grounded in `AgentForge_SSOT_v5.1.md` Sections 12, 14, and 17.

---

## 1. Hour 0–1 Kickoff Playbook (18:00–19:00 IST)

The goal of Hour 0–1 is strict comprehension and scoping. **Do not write code in Hour 0.**

- [ ] **Step 1: Read the brief twice.** Read the complete brief, supplied datasets, header rows, and sample inputs from start to finish twice before discussing solutions.
- [ ] **Step 2: Create `docs/challenge-brief.md`.**
  - Paste the exact text into Section 1 verbatim.
  - Fill in inputs, dataset size, required output schema, submission filenames, and time/call limits.
- [ ] **Step 3: Identify constraints & non-goals.**
  - Write down what is explicitly forbidden (e.g. external network calls, specific APIs, hard-coded heuristics).
  - Explicitly declare non-goals (e.g. no Redis, no vector DB unless mandatory).
- [ ] **Step 4: Resolve ambiguities conservatively.**
  - If cardinality is unstated, assume strict 1:1 input-output row preservation.
  - If abstention rules are unstated, prefer schema-valid output marked low confidence over dropped rows.
- [ ] **Step 5: Run Archetype Decision Tree (Section 4 below).**
  - Select the closest archetype and log the rationale in `docs/decisions.md` as an ADR.
- [ ] **Step 6: Calibrate runtime budgets (Section 5 below).**
  - Set `MAX_LLM_CALLS_PER_RUN`, `BATCH_CONCURRENCY`, `BATCH_MAX_DURATION_SECONDS` in `.env`.
- [ ] **Step 7: Start immutable AI transcript vault.**
  - Run `pnpm agentforge transcript add <initial_session>` or ensure the session transcript is logging.

---

## 2. First-Three-Hours Plan: Path to Gate G4 (19:00–21:00 IST)

**Gate G4 Exit Criterion:** One real sample record runs end-to-end through the task adapter and produces correctly formatted, schema-validated output.

```
Hour 1 (19:00–20:00): Thinnest Adapter Skeleton
  ├── Define Zod schemas in packages/schemas or adapter: InputSchema, DecisionSchema, OutputSchema
  ├── Implement ChallengeAdapter interface:
  │     parseInput(raw) -> { records, batchErrors, recordErrors }
  │     buildContext(rec) -> assemble prompt context
  │     decide(rec, ctx) -> callStructured with schema
  │     toOutput(rec, dec) -> exact contract format
  └── Register adapter in CLI apps/cli/src/index.ts

Hour 2 (20:00–21:00): Gate G4 Verification
  ├── Run sample record: pnpm agentforge run --input fixtures/challenge-sample.json --sample 1
  ├── Verify output schema: pnpm agentforge validate --output runs/<runId>/output.json
  ├── Verify trace: inspect runs/<runId>/trace.jsonl for stage events
  └── Gate G4 Achieved: Commit as "feat(challenge): Gate G4 achieved - minimal end-to-end slice"
```

---

## 3. Full 24-Hour Time-Budget & Schedule (IST Clock)

| Hour (IST) | Phase & Objectives | Exit Gate & Deliverable | Wellbeing & Checkpoint |
|---|---|---|---|
| **0–1** (18:00–19:00) | **Read & Scope:** Read brief twice, write `docs/challenge-brief.md`, choose archetype, log ADR. | Brief completed, non-goals locked. | Water / tea. |
| **1–3** (19:00–21:00) | **Thin Adapter:** Build minimal `ChallengeAdapter` skeleton; wire Zod schemas; test on 1 record. | **Gate G4:** 1 valid record outputs correct schema. | Dinner break (20 min). |
| **3–7** (21:00–01:00) | **Core Domain Logic:** Domain retrieval, deterministic policy gates, prompt engineering, baseline comparator. | Contract tests pass; baseline comparator implemented. | Focus block. |
| **7–11** (01:00–05:00) | **Full Workload Baseline:** Run full input dataset; save baseline metrics, failure clusters, and traces. | **Gate G5:** Full baseline run saved to `runs/` with error taxonomy. | **Sleep / Rest window** (after G5 is saved and long run queued). |
| **11–15** (05:00–09:00) | **Failure Cluster Hardening:** Address top failure categories in `docs/failure-analysis.md`; add regression tests. | Re-run full workload; verify measured lift over baseline. | Breakfast & coffee. |
| **15–18** (09:00–12:00) | **Safety & Edge Cases:** Adversarial prompt-injection tests, malformed row isolation, timeout & budget bounds. | Controlled failure handling proven; zero unhandled errors. | Walk / stretch (15 min). |
| **18–21** (12:00–15:00) | **Optimization & Evaluation:** Optimize only measured bottlenecks; generate comparative evaluation report. | Final evaluation report generated; lift table verified. | Lunch / snack. |
| **21–23** (15:00–17:00) | **Packaging & Verification:** Clean clone test, run `package` validator, inspect dry-run manifest, check ZIP size. | **Gate G6:** Verified submission package ready. | Final polish. |
| **23–24** (17:00–18:00) | **Feature Freeze & Submission:** Feature freeze (no code changes); upload package; save confirmation. | **Gate G7:** Submission confirmed. | **DONE.** |

---

## 4. Archetype Decision Checklist (SSOT Section 14.2 & Appendix A)

Use this decision table to map the official brief to the existing architectural foundation:

| Challenge Shape in Brief | Closest Archetype | Architectural Strategy | Existing Foundation Asset to Reuse |
|---|---|---|---|
| Categorization, labeling, priority routing, risk flagging | **A.1 Classification / Triage** | Deterministic policy gate + structured LLM decision + heuristic baseline | `TriageAdapter` in `@agentforge/adapter-kit` |
| Document Q&A, knowledge base search, policy lookup | **A.2 RAG Q&A (+ Abstention)** | Bounded lexical BM25 retrieval + mandatory abstention gate + citation verification | `RagAdapter` in `@agentforge/adapter-kit` |
| Form extraction, entity parsing, invoice/log extraction | **A.3 Information Extraction** | Zod schema coercion + multi-field extraction + regex pre-filter | `DemoAdapter` / `TriageAdapter` pattern |
| Multi-step workflow, tool usage, SQL/API calls | **A.4 Planning & Tool Agent** | Finite state machine + allowlisted policy tools + budget guard | `@agentforge/policies` + `@agentforge/orchestrator` |
| Report writing, summarization under rubric constraints | **A.5 Constrained Generation** | Structured output + rubric evaluator + length/format validator | `@agentforge/evaluation` report generator |
| Code repair, syntax fixing, unit test generation | **A.6 Code Agent (T3)** | Safe workspace writer + sandboxed execution + repair loop | Only activate if brief explicitly mandates code building |

### Decision Rules:
1. **Never force an existing drill archetype if the brief asks for something else.** If the brief is Information Extraction, adapt the schemas and extraction logic rather than trying to fit it into ticket triage.
2. **If the brief requires answering questions from reference documents:** Enforce the explicit abstention policy from Drill 2. Never fabricate source citations.
3. **If the brief requires deterministic rules:** Implement them in code as a pre- or post-decision policy gate (`applyPolicyGate`), never solely inside the prompt.

---

## 5. Budget Calibration Worksheet

Before running the full workload, calculate and configure operational parameters in `.env`:

```
Input Workload Size: N = ______ records

1. LLM Call Limit (MAX_LLM_CALLS_PER_RUN):
   Formula: N * (1 + MAX_SCHEMA_CORRECTIONS) * 1.1 safety margin
   Example: 100 records * 2 * 1.1 = 220 calls
   Config setting: MAX_LLM_CALLS_PER_RUN=220

2. Concurrency Pool (BATCH_CONCURRENCY):
   Low token quota / rate limits: BATCH_CONCURRENCY=2
   Standard tier (OpenAI Tier 2+ / Anthropic Tier 2+): BATCH_CONCURRENCY=4 to 8
   Offline / Mock provider: BATCH_CONCURRENCY=8

3. Single-Task Timeout (MAX_RUN_DURATION_SECONDS):
   Formula: Expected latency per record (e.g. 15s) * 3 = 45s to 900s
   Config setting: MAX_RUN_DURATION_SECONDS=900

4. Batch Workload Timeout (BATCH_MAX_DURATION_SECONDS):
   Formula: (N / BATCH_CONCURRENCY) * 15s * 2 safety margin
   Example: (100 / 4) * 15s * 2 = 750 seconds (12.5 minutes)
   Config setting: BATCH_MAX_DURATION_SECONDS=3600
```
