# AgentForge — 30-Minute AI Judge Interview Rehearsal Guide

> Authoritative rehearsal companion to `docs/interview-pack.md`.
> Reference: `AgentForge_SSOT_v5.1.md` Sections 11, 15, and live codebase evidence.
> Target: HackerRank Orchestrate October '26 AI Judge Technical Interview.

---

## 1. Thirty-Minute Timed Rehearsal Schedule

| Elapsed Time | Duration | Segment | Core Objective | Primary Evidence Artifact |
|---|---|---|---|---|
| **00:00–04:00** | 4 min | **Problem Framing & Scoping** | Explain the exact problem solved; contrast against uncontrolled multi-agent loops. | [`README.md`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/README.md) & [`docs/challenge-brief.md`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/docs/challenge-brief.md) |
| **04:00–09:00** | 5 min | **Architecture & Orchestration** | Differentiate control plane (deterministic FSM) from model plane (untrusted worker). | [`packages/orchestrator/src/index.ts`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/packages/orchestrator/src/index.ts) |
| **09:00–14:00** | 5 min | **Retrieval, Grounding & Abstention** | Demonstrate zero-DB BM25 retrieval, explicit abstention threshold, and zero hallucinated sources. | [`packages/adapter-kit/src/rag-adapter.ts`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/packages/adapter-kit/src/rag-adapter.ts) & [`docs/drill-2-report.md`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/docs/drill-2-report.md) |
| **14:00–19:00** | 5 min | **Safety, Policy Gates & Injection** | Prove prompt-injection defense with deterministic code-level policy gates. | [`packages/adapter-kit/src/triage-adapter.ts`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/packages/adapter-kit/src/triage-adapter.ts) & [`docs/drill-1-report.md`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/docs/drill-1-report.md) |
| **19:00–24:00** | 5 min | **Evaluation, Baselines & Measured Lift** | Walk through agent-vs-baseline comparative evaluation and error taxonomy. | [`packages/evaluation/src/baseline.ts`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/packages/evaluation/src/baseline.ts) & [`runs/drill-1-triage/eval-report.json`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/runs/drill-1-triage/eval-report.json) |
| **24:00–28:00** | 4 min | **Failure Containment & Traceability** | Walk through a record trace in `trace.jsonl` or Web Inspector; demonstrate non-swallowed errors. | [`runs/drill-1-triage/trace.jsonl`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/runs/drill-1-triage/trace.jsonl) |
| **28:00–30:00** | 2 min | **Limitations & Post-Kickoff Roadmap** | Transparently present top 3 limitations and roadmap without defensive hedging. | [`docs/freeze-checklist.md`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/docs/freeze-checklist.md) |

---

## 2. Eight Core Interview Dimensions

### Dimension 1: Problem Interpretation & Minimal Agent Architecture

1. **Concise Spoken Answer Outline (45s):**
   > *"We approach agent engineering with a strict 'minimal useful architecture' philosophy. Instead of wrapping an LLM in an open-ended multi-agent framework with unpredictable token consumption, AgentForge separates the deterministic control plane from the untrusted model plane. The orchestrator is a strict finite state machine that guarantees 1:1 record ordering, bounded retries, atomic writes, and isolated failure containment. The LLM is used solely as a structured cognitive function bounded by strict Zod schemas."*
2. **Supporting Source Files & Evidence:**
   - Architecture contract: [`AgentForge_SSOT_v5.1.md`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/AgentForge_SSOT_v5.1.md) (Section 4, Architecture)
   - State machine & transitions: [`packages/policies/src/index.ts`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/packages/policies/src/index.ts)
   - Orchestration execution loop: [`packages/orchestrator/src/index.ts`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/packages/orchestrator/src/index.ts)
3. **Potential Judge Follow-Up Question:**
   > *"Why not use an existing agent framework like LangChain, AutoGen, or CrewAI?"*
   > *Response:* *"Those frameworks introduce non-deterministic loops, implicit prompts, hidden retries, and high dependency weight. In a judged competition, determinism, reproducible evaluation, and strict latency/budget bounds are paramount. Our lean TypeScript monorepo boots in milliseconds, runs entirely offline if needed, and has zero black-box control flow."*
4. **Claims to Qualify or Avoid:**
   - **Avoid:** Saying *"our agent can solve any open-ended reasoning problem autonomously."*
   - **Qualify:** State that the architecture is explicitly designed for schema-governed batch operations, triage, extraction, and grounded retrieval.

---

### Dimension 2: Agent Orchestration, Schema Contracts & Tool Permissions

1. **Concise Spoken Answer Outline (45s):**
   > *"All system boundaries are protected by Zod schemas in `@agentforge/schemas`. Model output is parsed into strict typed objects via `callStructured`. If a model returns malformed JSON or invalid enum fields, we do not crash or swallow the error: we trigger a bounded 1-shot repair loop (`MAX_SCHEMA_CORRECTIONS=1`) feeding the exact validation error back to the model. If it still fails, the error is categorized into our FR-020 taxonomy as `SCHEMA_INVALID`, recorded to the trace, and the batch continues without halting."*
2. **Supporting Source Files & Evidence:**
   - Schema correction loop: [`packages/llm/src/index.ts`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/packages/llm/src/index.ts#L180-L230)
   - Boundary schemas: [`packages/schemas/src/index.ts`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/packages/schemas/src/index.ts)
   - Error taxonomy: [`packages/shared/src/index.ts`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/packages/shared/src/index.ts#L52-L75)
3. **Potential Judge Follow-Up Question:**
   > *"What happens if a tool tries to access files outside the workspace or execute unapproved shell commands?"*
   > *Response:* *"Tools operate under a strict allowlist policy (`@agentforge/policies`). Path traversal attempts (`..`, absolute paths, `.env`) are blocked at the router layer and return HTTP 400. In addition, our `BudgetGuard` aborts the run before token quotas are breached."*
4. **Claims to Qualify or Avoid:**
   - **Avoid:** Claiming infinite auto-repair capability.
   - **Qualify:** Explicitly state repair is strictly bounded to 1 attempt to protect latency and token budget.

---

### Dimension 3: Retrieval Strategy & Grounding (Lexical vs. Semantic)

1. **Concise Spoken Answer Outline (45s):**
   > *"For our RAG challenge drill, we deliberately avoided introducing an external vector database like Pinecone or Chroma. For bounded reference documents, external vector databases add operational fragility, cold-start latency, and non-deterministic embeddings. Instead, we implemented an inspectable token-overlap BM25-style lexical retrieval engine with match density scoring. More importantly, we enforce a mandatory abstention gate: if retrieved chunk scores fall below threshold (`score < 1.5`), the adapter immediately abstains without calling the LLM. Furthermore, our evaluator independently verifies source citations against the corpus, rejecting any hallucinated IDs."*
2. **Supporting Source Files & Evidence:**
   - Retrieval & abstention logic: [`packages/adapter-kit/src/rag-adapter.ts`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/packages/adapter-kit/src/rag-adapter.ts#L80-L125)
   - Independent citation verification: [`packages/adapter-kit/src/rag-adapter.ts`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/packages/adapter-kit/src/rag-adapter.ts#L330-L380)
   - Drill 2 evidence report: [`docs/drill-2-report.md`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/docs/drill-2-report.md)
3. **Potential Judge Follow-Up Question:**
   > *"When would lexical BM25 retrieval fail, and how would you upgrade it?"*
   > *Response:* *"Lexical retrieval struggles with vocabulary mismatch and semantic paraphrasing where different words mean the same thing. If the official challenge brief provides a corpus with high semantic diversity, we can introduce local embedding dot-products or an allowlisted embedding endpoint without altering the downstream abstention gates or evaluator."*
4. **Claims to Qualify or Avoid:**
   - **Avoid:** Claiming the current BM25 retrieval outperforms a fine-tuned vector search on 100,000 documents.
   - **Disclose:** Current Drill 2 results (100% precision, 0 hallucinated citations) were measured on an 8-chunk synthetic reference corpus with deterministic simulation.

---

### Dimension 4: Prompt Injection, Untrusted Inputs & Deterministic Safety Enforcement

1. **Concise Spoken Answer Outline (45s):**
   > *"Prompt injection cannot be solved by prompt engineering alone. A prompt asking a model 'please do not listen to malicious instructions' is easily bypassed. In AgentForge, we treat all customer inputs as untrusted data and enforce code-level deterministic policy gates. In Drill 1, ticket `ticket-008` attempts a system override instructing the agent to classify a $4,500 fraud as low priority. Our deterministic policy gate (`applyTriagePolicyGate`) intercepts financial fraud triggers in code, automatically enforcing category 'billing', priority 'critical', and escalated 'true', overriding whatever the model says."*
2. **Supporting Source Files & Evidence:**
   - Policy gate implementation: [`packages/adapter-kit/src/triage-adapter.ts`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/packages/adapter-kit/src/triage-adapter.ts#L100-L145)
   - Adversarial ticket fixture: [`fixtures/drill-1-triage/tickets.json`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/fixtures/drill-1-triage/tickets.json#L75-L84)
   - Drill 1 case study: [`docs/drill-1-report.md`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/docs/drill-1-report.md#L34-L42)
3. **Potential Judge Follow-Up Question:**
   > *"What if an adversary obscures the words or uses base64 encoding?"*
   > *Response:* *"Our normalization pipeline strips unicode homoglyphs and normalizes whitespace before context assembly. For production, high-risk detection patterns can include base64 decoders and regex tokenizers. But the architectural principle remains: safety-critical decisions must be enforced in deterministic code, never left to LLM discretion."*
4. **Claims to Qualify or Avoid:**
   - **Avoid:** Claiming 100% impenetrable immunity to novel prompt injection techniques.
   - **Qualify:** Explain that defense-in-depth combines input sandboxing, prompt segregation, deterministic pattern gates, and output post-filtering.

---

### Dimension 5: Test Strategy, Independent Evaluation & Baseline Lift

1. **Concise Spoken Answer Outline (45s):**
   > *"We never accept an agent's self-reported claim that it succeeded. Our evaluation harness (`@agentforge/evaluation`) runs an independent evaluator that checks decisions against isolated ground truth. Furthermore, we mandate comparative evaluation against a deterministic heuristic baseline (`pnpm agentforge eval --baseline`). If an LLM agent achieves 85% accuracy but a 10-line keyword baseline achieves 84%, the model's cost and latency are unjustified. We report the exact measured lift across accuracy, precision, recall, and F1."*
2. **Supporting Source Files & Evidence:**
   - Baseline comparator engine: [`packages/evaluation/src/baseline.ts`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/packages/evaluation/src/baseline.ts)
   - Baseline lift table in Drill 1: [`docs/drill-1-report.md`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/docs/drill-1-report.md#L21-L32)
   - Test suites: 137 unit/integration tests and 19 E2E tests (`pnpm test`, `pnpm test:e2e`)
3. **Potential Judge Follow-Up Question:**
   > *"How do you prevent data contamination between test fixtures and your adapter logic?"*
   > *Response:* *"Ground truth files (`tickets-expected.json`, `questions-expected.json`) are strictly isolated from runtime inputs (`tickets.json`, `questions.json`). The adapter has zero access to expected labels during execution; labels are only read by the evaluator post-run."*
4. **Claims to Qualify or Avoid:**
   - **Disclose:** The 100% exact match and lift numbers in Drill 1 and Drill 2 reflect a 10-item and 8-item synthetic benchmark. Do not present them as generalized live-model metrics.

---

### Dimension 6: Failure Containment, Retries, Budgets & Observability

1. **Concise Spoken Answer Outline (45s):**
   > *"In batch processing, row failures must never crash the entire workload. The orchestrator isolates each record. If record #5 encounters a timeout or syntax error, that error is recorded in the ledger and the worker pool proceeds to record #6. Retries are strictly bounded: 2 transient retries with exponential backoff for network/429 errors, and 1 schema correction. Every single state change, timestamp, and token count is streamed to an append-only `trace.jsonl` log, which can be inspected via our CLI or the Next.js Web Run Viewer."*
2. **Supporting Source Files & Evidence:**
   - Concurrency pool & row isolation: [`packages/orchestrator/src/index.ts`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/packages/orchestrator/src/index.ts#L400-L460)
   - Budget guard: [`packages/llm/src/index.ts`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/packages/llm/src/index.ts#L60-L95)
   - Web Run Viewer inspector: [`apps/web/src/app/runs/[runId]/page.tsx`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/apps/web/src/app/runs/[runId]/page.tsx)
3. **Potential Judge Follow-Up Question:**
   > *"What happens if the node crashes halfway through a 1,000-record run?"*
   > *Response:* *"We implement atomic checkpointing (`checkpoint.jsonl`). When `pnpm agentforge run --resume <runId>` is invoked, the orchestrator reads the checkpoint file, skips already completed records, and resumes processing remaining records with zero duplicate execution."*
4. **Claims to Qualify or Avoid:**
   - **Avoid:** Saying *"our system never fails."*
   - **Qualify:** State that when failures occur, they fail safely, predictably, and with complete trace provenance.

---

### Dimension 7: Architectural Trade-offs & Rejected Frameworks

1. **Concise Spoken Answer Outline (45s):**
   > *"Every architectural choice was made to maximize reliability under hackathon constraints. We evaluated three major alternatives and deliberately rejected them: First, LangChain/CrewAI: rejected for unmetered token consumption and black-box control flow. Second, Vector DBs: rejected as premature operational complexity for bounded reference documents. Third, Redis/BullMQ: deferred to post-hackathon Tier T2 per SSOT ADR-027, as our in-process concurrency pool with atomic checkpoints fulfills all concurrency requirements without external infrastructure."*
2. **Supporting Source Files & Evidence:**
   - Architectural decisions & ADRs: [`docs/decisions.md`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/docs/decisions.md) (ADR-025 through ADR-029)
   - Hard cut rules: [`AgentForge_SSOT_v5.1.md`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/AgentForge_SSOT_v5.1.md) (Section 12.1)
3. **Potential Judge Follow-Up Question:**
   > *"Doesn't building a custom orchestrator reinvent the wheel?"*
   > *Response:* *"Our orchestrator is under 600 lines of strict TypeScript. It took less time to write, test, and audit than it would take to debug non-deterministic prompt chaining or memory leaks in a 100,000-line third-party framework. We understand every line of our codebase, which is why our test suite runs in 2 seconds."*
4. **Claims to Qualify or Avoid:**
   - **Avoid:** Dismissing third-party frameworks as useless in general.
   - **Qualify:** Frame the rejection around the specific constraints of competition rules, reproducibility, strict latency, and auditability.

---

### Dimension 8: Honest Limitations, Known Edge Cases & Post-Kickoff Roadmap

1. **Concise Spoken Answer Outline (45s):**
   > *"We are completely transparent about what AgentForge currently does and does not do. Our top 3 limitations are: First, our concurrency pool is in-process; distributed clustering across multiple physical nodes is deferred. Second, our drills were executed with `MockLLMProvider` on compact synthetic fixtures; live provider evaluation will happen during the kickoff window. Third, lexical retrieval is optimized for high keyword overlap; multi-hop reasoning across disjoint documents with low lexical similarity remains an open challenge. If we had another 24 hours, we would implement cross-encoder re-ranking and semantic embeddings."*
2. **Supporting Source Files & Evidence:**
   - Limitations section in freeze checklist: [`docs/freeze-checklist.md`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/docs/freeze-checklist.md#L112-L121)
   - Failure analysis log: [`docs/failure-analysis.md`](file:///C:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/docs/failure-analysis.md)
3. **Potential Judge Follow-Up Question:**
   > *"How will you validate performance on the actual challenge data during kickoff?"*
   > *Response:* *"We will immediately run our sample mode (`--sample 5`) to verify the schema contract, then run a full workload baseline to calculate initial metrics, cluster any failures using `@agentforge/evaluation`, and only then optimize the prompt and policy gates against measured bottlenecks."*
4. **Claims to Qualify or Avoid:**
   - **Avoid:** Being defensive about limitations or claiming mock tests equal live production proof.
   - **Emphasize:** Judges score self-awareness and honesty highly; owning your trade-offs shows senior engineering maturity.

---

## 3. Rapid-Fire Question Bank & Emergency Drills

| # | Trap Question | Ideal 15-Second Response |
|---|---|---|
| 1 | *"Can your agent access real-time web search?"* | *"No. Web search was explicitly excluded as a non-goal to prevent unmetered token consumption and non-deterministic evaluation. We operate strictly on supplied inputs and bounded reference corpora."* |
| 2 | *"What if an API returns a 500 server error?"* | *"Transient 5xx errors trigger our exponential backoff retry policy up to 2 times (`MAX_TRANSIENT_RETRIES`). If the provider stays down, the error is categorized as `LLM_TIMEOUT` or `LLM_RATE_LIMITED` and recorded without crashing."* |
| 3 | *"How do you know your output didn't hallucinate dates or prices?"* | *"In our RAG adapter, answers are only allowed if supporting chunk IDs are cited and verified by the independent evaluator. Answers claiming groundedness with zero valid citations are forced to abstain."* |
| 4 | *"How did you verify your submission package is safe?"* | *"We built an automated packaging validator (`pnpm agentforge package --dry-run`) that scans all candidate files for credentials and API keys, strictly excludes `node_modules` and `.env`, and verifies size limits before building the ZIP."* |
| 5 | *"How did you use AI in this project?"* | *"AI was used as a pair programmer under our strict AI Build Protocol (SSOT Section 13). Every sprint was scoped to specific requirements; all generated diffs were reviewed, verified against tests, and logged in our immutable transcript vault."* |
| 6 | *"What if the submission platform has a strict 50 MB limit?"* | *"Our packager enforces the official HackerRank Orchestrate 50 MB ceiling uniformly across Code ZIP, Output file, and AI Transcript. Boundary tests verify exact byte thresholds, and packaging fails closed if any deliverable exceeds 50 MB."* |

---

## 4. Live Troubleshooting & Diagnosis Drill

In a live technical interview, judges frequently request: *"Show me what happens when a record fails, or simulate a malformed response."*

### 4.1 Diagnosis Workflow (4 Steps)
1. **Trace Isolation**:
   - Open `runs/<runId>/trace.jsonl` or navigate to `http://localhost:3000/runs/<runId>` in the Web Viewer.
   - Filter for `record_error`, `schema_correction_failed`, or `output_validation_failed` events.
2. **Error Taxonomy Categorization**:
   - Inspect the `category` attribute according to SSOT Section 4.5:
     - `SCHEMA_INVALID`: Model output failed Zod schema parsing.
     - `LLM_RATE_LIMITED` / `LLM_TIMEOUT`: Transient upstream provider issue.
     - `POLICY_VIOLATION`: Code-level gate blocked unsafe action.
     - `BUDGET_EXHAUSTED`: Run hit token or financial threshold.
3. **Inspect Raw vs Corrected Payloads**:
   - Check `trace.jsonl` payload for the exact unparsed string and the schema correction attempt.
   - Evidence: In [`packages/llm/src/index.ts`](file:///c:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/packages/llm/src/index.ts), `callStructured` captures `rawOutput` and `zodErrors`.
4. **Independent Failure Clustering**:
   - Run `pnpm agentforge eval --baseline` or `clusterFailuresByFeatures` to group errors by input length, category, or vocabulary pattern in [`docs/failure-analysis.md`](file:///c:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/docs/failure-analysis.md).

---

## 5. Emergency Recovery Playbooks

### Playbook A: Provider Outage or Rate Limit Flurry (429 / 500 / 503)
- **Symptom**: Model calls hang or return HTTP 429 rate limit exceptions.
- **Immediate Action**:
  1. In-process retries with exponential backoff (`backoffMs`: 1s, 2s) trigger automatically up to `MAX_TRANSIENT_RETRIES` (2).
  2. If upstream stays unresponsive, the orchestrator writes a clean checkpoint to `runs/<runId>/checkpoint.jsonl` with all passed rows saved.
  3. Swap model provider in `.env` (e.g. switch `LLM_PROVIDER=gemini` or change `LLM_MODEL`).
  4. Run `pnpm agentforge run --input <path> --resume <runId>`. The orchestrator loads the checkpoint, skips processed rows, and completes remaining rows. Zero lost work.
- **Code Evidence**: [`packages/orchestrator/src/index.ts#L325-L338`](file:///c:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/packages/orchestrator/src/index.ts#L325-L338).

### Playbook B: Token or Latency Budget Exhaustion
- **Symptom**: `BudgetGuard` aborts run with `AgentForgeError('BUDGET_EXHAUSTED')`.
- **Immediate Action**:
  1. Inspect `runs/<runId>/metrics.json` for total token count and calls.
  2. Reduce batch concurrency or chunk size: adjust `BATCH_CONCURRENCY=2` or lower `MAX_INPUT_CHARS`.
  3. Switch to `--sample 5` to isolate the highest-density records and calibrate token burn.
  4. Optimize prompt: eliminate preamble, shorten system instructions, or use compact schema keys.
- **Code Evidence**: [`packages/llm/src/index.ts#L60-L95`](file:///c:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/packages/llm/src/index.ts#L60-L95).

### Playbook C: Packaging Rejection or Size Limit Breach
- **Symptom**: `pnpm agentforge package` fails closed with secret leak error or file size violation (> 50 MB).
- **Immediate Action**:
  1. Inspect generated `runs/packaging-manifest.json` for exact list of `validationErrors`.
  2. If secret detected: locate the file and line indicated in `secretScan.violations`, remove hardcoded secret, and re-run secret scan.
  3. If archive size > 50 MB: check for unexcluded raw datasets or test caches. Pass `--custom-exclude <pattern>` or confirm raw datasets are excluded via `--exclude-datasets`.
  4. If output format is rejected: use `--output-format [json|jsonl|csv|text|any]` matching the challenge contract.
- **Code Evidence**: [`packages/orchestrator/src/packaging.ts`](file:///c:/Users/Atul2/OneDrive/Desktop/Hackethon/agentforge/packages/orchestrator/src/packaging.ts).
