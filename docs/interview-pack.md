# AgentForge — AI Judge Interview Pack (FR-039)

> Authoritative reference for the HackerRank Orchestrate AI-judge interview.
> Grounded in `AgentForge_SSOT_v5.1.md` Sections 11, 15.2, and live run evidence.
> **Full 30-Minute Mock Interview & Recovery Guide:** See [`docs/interview-rehearsal.md`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/docs/interview-rehearsal.md) for 8 in-depth dimensions, live diagnosis drills, emergency recovery playbooks (provider outages, budget exhaustion, packaging rejections), evidence links, and rapid-fire drills.

---

## 1. Five-Minute Interview Demo Script (SSOT Section 15.4)

| Time | Segment | Focus & Speaking Points | Reproducible Command |
|---|---|---|---|
| **00:00–00:30** (30s) | **Problem & Contract** | Exact problem solved: deterministic parsing, schema-governed decision-making, and atomic output validation. What is intentionally *not* solved: open-ended uncontrolled agent loops. | `pnpm agentforge run --input fixtures/demo.json --output runs/demo-out.json` |
| **00:30–01:30** (60s) | **Architecture** | Control plane vs Model plane: Orchestrator is a deterministic finite state machine with budget guards and timeout deadlines; LLM is an isolated untrusted cognitive worker. | `pnpm agentforge run --dry-run` |
| **01:30–03:00** (90s) | **Trace Walkthrough** | Show a successful record trace and a controlled failure record in `trace.jsonl` or Web Run Inspector. Emphasize error categorization (FR-020 taxonomy) and non-swallowed exceptions. | `pnpm --filter web dev` → Open `http://localhost:3000` |
| **03:00–04:00** (60s) | **Metrics & Lift** | Live metrics table with baseline-vs-agent comparison table (`pnpm agentforge eval --baseline`). Point out measured lift and what the aggregate score does *not* capture. | `pnpm agentforge eval --baseline` |
| **04:00–05:00** (60s) | **Mock Drills & Limitations** | Demonstrate S6 drills: classification policy gates and RAG with explicit abstention. Disclose top 3 honest limitations and synthetic benchmark scope. | `pnpm agentforge drill all` |

---

## 2. Live Run Evidence & Verified Metrics

### Run 1: Foundation Demo (`demo-sentiment`)
- **Run ID:** `demo-run-001`
- **Adapter:** `demo-sentiment` (`DemoAdapter`)
- **Status:** `succeeded`
- **Provider Mode:** `MockLLMProvider` (deterministic simulation; honestly labeled)
- **Verified Record Count:** 5 / 5 records processed with 0 failures

### Run 2: S6 Drill 1 — Classification & Triage (`support-triage`)
- **Run ID:** `drill-1-triage`
- **Adapter:** `support-triage` (`TriageAdapter` v1.0.0)
- **Input Fixture:** `fixtures/drill-1-triage/tickets.json` (10 synthetic tickets)
- **Status:** `succeeded`
- **Provider Mode:** `MockLLMProvider` + Deterministic Policy Gate
- **Key Result:** 100% exact match on synthetic benchmark; adversarial prompt injection (`ticket-008`) successfully blocked by deterministic policy gate.

### Run 3: S6 Drill 2 — RAG Q&A with Explicit Abstention (`policy-rag`)
- **Run ID:** `drill-2-rag`
- **Adapter:** `policy-rag` (`RagAdapter` v1.0.0)
- **Corpus:** `fixtures/drill-2-rag/corpus.json` (4 documents, 8 chunks)
- **Status:** `succeeded`
- **Provider Mode:** `MockLLMProvider` + BM25 Token Retrieval
- **Key Result:** 100% abstention accuracy on out-of-corpus queries; 0% unsupported answer rate; 0 hallucinated citations.

> **Benchmark Scope Note:** Both drills operate on compact synthetic benchmarks. While they verify error isolation, contract adherence, abstention triggers, and prompt-injection defense, they do NOT represent generalized open-domain accuracy or live model performance.

---

## 3. Ten Mandatory Interview Answers (SSOT Section 15.2)

### Q1: What exact problem does the agent solve, and what does it intentionally not solve?
- **Solves:** End-to-end batch classification, triage, and grounded retrieval under strict schema contracts, with bounded retries, deterministic heuristic baselines, full trace provenance, and guaranteed atomic outputs.
- **Intentionally Does Not Solve:** Arbitrary open-ended internet searches, unregulated multi-turn tool loops with unmetered token budgets, or silent fallbacks to heuristics masquerading as model decisions.

### Q2: What are the input and output contracts?
- **Input Contract:** Strictly validated JSON array of structured records, rejected at boundary if malformed before any LLM invocations occur.
- **Output Contract:** Validated JSON array with 1:1 ID correspondence, exact matching schema, verified both in memory and after disk writing.

### Q3: Why this model / algorithm / retrieval / tool strategy?
- **Strategy:** Thinnest possible architecture for the task. Uses structured output enforcement via Zod schema parsers with 1-shot transient schema correction. Heuristic baseline is run alongside to calculate verified lift. Local BM25-style lexical retrieval is used for bounded corpus Q&A without external vector DB dependencies.

### Q4: Which parts are deterministic and which depend on the model?
- **Deterministic:** Config validation, input normalization, context assembly, concurrency pooling, atomic writes, retry budget tracking, error categorization, output revalidation, high-risk policy escalation gates, and abstention thresholding.
- **Model-Dependent:** Semantic extraction, confidence calibration, and contextual reasoning based strictly on user prompt context.

### Q5: How is evidence retrieved and tied to decisions?
- **Evidence Linking:** Every output record carries `evidenceRefs` (or `citations` in RAG) documenting the exact chunk/context slice that informed the decision, serialised to `trace.jsonl` in chronological order. Independent evaluators verify citation validity against the corpus.

### Q6: How are malformed output, prompt injection, uncertainty, and high-risk cases handled?
- **Malformed Output:** Caught by Zod parser, triggers bounded `MAX_SCHEMA_CORRECTIONS` with schema error feedback. If uncorrectable, maps cleanly to `SCHEMA_VIOLATION` without crashing the batch.
- **Prompt Injection:** Untrusted text is strictly isolated in user content blocks and never interpolates into system instructions; verified by `fixtures/injection` suite and Drill 1/2 adversarial cases.
- **Uncertainty & Abstention:** Low-evidence retrieval triggers explicit structured `decision: "abstained"` with empty citations rather than ungrounded guesses.
- **High-Risk Cases:** Handled by deterministic code-level policy gates (`applyTriagePolicyGate`) that override model classification when security or fraud triggers are present.

### Q7: What tests and metrics ran, on how much data, with what results?
- **Verification Suite:** 137 unit and integration tests across 11 test files, plus 19 web E2E tests passing cleanly.
- **Fault Injection:** Every error category in FR-020 (timeout, auth failure, schema violation, budget exceeded, rate limiting) is tested under simulated failures.

### Q8: Which important failure remains unresolved?
- **Unresolved Edge Case:** Complex multi-hop queries where supporting evidence spans multiple disjoint documents with low lexical overlap. Resolved for single-hop and dense lexical queries; multi-hop semantic paraphrasing requires embedding models when live provider keys are configured.

### Q9: Which alternatives were rejected and why?
1. **LangChain / CrewAI / AutoGen:** Rejected due to non-deterministic control flow, bloated dependencies, and unmetered token consumption.
2. **Vector DB (Chroma/Pinecone/Milvus):** Rejected as premature infrastructure complexity for bounded local corpus retrieval.
3. **Redis / BullMQ for T0:** Deferred to T2 per SSOT Table 12.1 to keep the core foundation lean and reproducible on any clean machine.

### Q10: Which code was AI-assisted and how was it verified?
- **Methodology:** Developed in strict accordance with the AI Build Protocol (SSOT Section 13). Every sprint was scoped to exact FRs. Every AI diff was reviewed for swallowed errors and hard-coded mocks, and verified with actual `pnpm test`, `pnpm test:e2e`, and manual live probe execution.

---

## 4. Top Three Limitations

1. **In-Memory Concurrency Pool:** The bounded concurrency pool runs in-process. While it isolates record failures, node crash recovery relies on the checkpoint file rather than distributed queues.
2. **Mock LLM Provider by Default:** When `LLM_API_KEY` is not supplied in environment, execution safely uses deterministic mock/baseline providers; production runs require live keys.
3. **Single Adapter Active per Run:** Each execution run binds to one designated `ChallengeAdapter` at a time rather than dynamic pipeline chaining.

---

## 5. Recovery & Quickstart Guide

### 5.1 Clean Setup (Under 2 Minutes)
```bash
# 1. Install workspace dependencies
pnpm install

# 2. Configure environment (mock mode active by default)
cp .env.example .env

# 3. Verify repository integrity
pnpm agentforge preflight
```

### 5.2 Reproducible Demo Workflow
```bash
# Run baseline-vs-agent evaluation
pnpm agentforge eval --baseline

# Run S6 challenge drills
pnpm agentforge drill all

# Start the Web Run Viewer
pnpm --filter web dev
# Open http://localhost:3000 to inspect runs, timeline events, and artifacts
```

### 5.3 Finding Run IDs & Artifacts
- Run directories are located in `/runs/<runId>/`.
- List recent runs: `pnpm agentforge runs` or inspect the `/runs/` folder.
- Key files per run:
  - `run.json`: Execution metadata, status, duration, record counts.
  - `trace.jsonl`: Append-only chronological event stream with timing and evidence.
  - `output.json`: Atomic validated output array.
  - `eval-report.json`: Evaluator scores and comparative baseline metrics.
  - `config.snapshot.json`: Exact configuration snapshot at execution time.

### 5.4 Common Failures & Triage Steps
| Symptom | Cause | Remedy |
|---|---|---|
| `BUDGET_EXCEEDED` | LLM calls exceeded `MAX_LLM_CALLS_PER_RUN` | Increase limit in `.env` or reduce workload size with `--sample N`. |
| `SCHEMA_VIOLATION` | Model failed to produce valid schema after retry | Inspect `trace.jsonl` for raw response; refine prompt version or schema. |
| `PREFLIGHT_FAIL` | Missing `.env.example` or uncommitted `.env` | Ensure `.env` is listed in `.gitignore` and run `pnpm agentforge preflight`. |
| Port 3000 in use | Another Next.js process running | Run web viewer on another port: `pnpm --filter web dev -- -p 3001`. |
