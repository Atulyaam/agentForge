# AgentForge — Final Single Source of Truth (SSOT)

**Version:** 5.1 — Hackathon Edition (supersedes v5.0; v5.0 supersedes v4.0)
**Status:** Authoritative. Locked for pre-kickoff build; challenge-specific scope is added at kickoff under `CH-###`.
**Owner:** Solo builder (building with AI assistance)
**Consolidated:** 11 October 2026 · **Revised (v5.1):** 14 October 2026
**Event:** HackerRank Orchestrate October '26 — challenge arrives by email **24 Oct 2026, 6:00 PM IST**, followed by a 24-hour build-and-submit window and an AI-judge interview. *(Re-verify timing and rules on the official page at kickoff; the official rules always win.)*
**Codename:** AgentForge

> **One-line goal:** Before kickoff, build a small, tested, evidence-driven agent foundation (library + CLI + thin web viewer). At kickoff, read the real brief and build the *smallest task-specific agent that solves it*, prove it with real evaluation, and submit exactly what the challenge asks for.

> **Authority rule:** This file is the only requirement list. If code and this file disagree, update this file first and log the reason in the Decision Log (Section 19). Do not keep competing requirement lists elsewhere.

---

## 0. How to Use This Document (Human + AI)

### 0.1 Reading order
1. Sections 1–3 (what/why/decisions) — 10 minutes.
2. Section 4 (architecture) and Section 5 (requirements) — the build contract.
3. Section 13 (AI Build Protocol) — how to drive an AI coding tool sprint by sprint.
4. Section 12 (execution plan) and Section 14 (kickoff playbook) — what to do on which day.

### 0.2 Conventions
- **IDs are stable.** `FR-###` core features, `FR-UI-###` web workspace, `FR-CODE-###` code-building profile, `NFR-###` quality targets, `CH-###` challenge-specific (written at kickoff), `ADR-###` decisions.
- **Priority:** `P0` must work; `P1` add only after all P0 gates pass; `P2` post-hackathon; `PROFILE` required only if that profile is activated.
- **Tier:** `T0` core library + CLI · `T1` web + PostgreSQL · `T2` worker + Redis/BullMQ · `T3` code-building profile. (Defined in 2.2.)
- **Status words:** `Done` only after test/inspection evidence exists. Otherwise `Todo`, `In progress`, `Deferred (reason)`, or `N/A (reason)`.

### 0.3 Conflicts found in v4.0 and how v5.0 resolves them

| # | Conflict in v4.0 | Resolution in v5.0 |
|---|---|---|
| C1 | "Web-first" (Sec 1.4, ADR-003) vs "CLI-first core" (risk table) vs CLI described as optional | **Core-first, adapters-second.** The product is the shared TypeScript packages. **CLI is a mandatory P0 adapter** (evaluators run commands); the web app is a second adapter over the same core. ADR-015. |
| C2 | Redis/BullMQ "optional" (1.4, 25.1) vs required in NFR-007, 10.5, and the module table | Redis/BullMQ is **T2, P1**. Default job runner is an in-process runner behind a `JobRunner` interface. Idempotency and exactly-once finalization are enforced in PostgreSQL, not Redis (FR-026). ADR-016. |
| C3 | Code-building requirements duplicated in Section 8 (FR-CODE) and Section 12; Section 3.4 pointed to the wrong section | **Merged into one section (5.4).** All cross-references re-checked. |
| C4 | Accessibility: FR-UI-008 = P0 but NFR-012 = P1 | Split: keyboard, visible focus, non-colour-only status = **P0** (FR-UI-008); extended items (contrast audit, live-region announcements, reduced motion polish) = **P1**. NFR-012 aligned. |
| C5 | Run states: UI listed "passed/waiting", backend listed `succeeded`/`waiting_for_provider` | **One state vocabulary** with a UI-label mapping table (Section 7.1). |
| C6 | `MAX_RETRIES=1` ambiguous (provider retries? schema corrections?) | Three separate settings: `MAX_TRANSIENT_RETRIES`, `MAX_SCHEMA_CORRECTIONS`, `MAX_REPAIR_ATTEMPTS`. |
| C7 | 900 s max run duration stated as coding-profile default but placed in global env | `MAX_RUN_DURATION_SECONDS=900` applies to single-task runs. Batch runs use `BATCH_MAX_DURATION_SECONDS`, set at kickoff from the remaining time. |
| C8 | `npm run agentforge --` example vs pnpm workspace | pnpm everywhere: `pnpm agentforge <command>`. |
| C9 | FR-001 "non-zero process exit" only makes sense for CLI | Applies to CLI/worker start; web returns a 503 readiness failure with a safe message. |
| C10 | v4.0 P0 list too large for a solo 24 h window | Build **everything P0 before kickoff** (13 days available). During the 24 h window, build **only the challenge adapter** on top of the frozen foundation. Infrastructure work inside the window is forbidden unless a gate fails. |
| C11 | Language lock-in vs a brief that may mandate another entrypoint | Added contingency (2.5): thin shim entrypoint or ADR-approved exception. Decided in Hour 0–1. |
| C12 | SSE "when practical" vs locked stack "native EventSource" | SSE is P0 *if* the web adapter is built; polling with backoff is the accepted fallback. Both read the same ordered events table. |

### 0.4 Changes in v5.1 (14 Oct 2026 review) and why

| # | Change | Where | Reason |
|---|---|---|---|
| R1 | **T1 split into T1-lite (default) and T1-full (P1).** T1-lite = read-only Next.js run viewer over `runs/<runId>/`, polling, artifact download. T1-full = PostgreSQL/Prisma, idempotent `POST /api/runs`, SSE, web-started runs, web cancel. | 2.1, 2.2, 5.1 (FR-024/026), 5.3, 12.1, 12.2, 13.2, 17.1, ADR-021 | Section 1.2 says a feature that improves none of the four judged signals is out of scope. A full web stack in 3 days (17–19 Oct) for a solo builder threatens the mock drills, which matter more. |
| R2 | **Runtime/language verification gate** before freeze: confirm from the official rules how submissions are run and whether Node/pnpm/TypeScript is acceptable. | 2.5, 12.1, 16, ADR-022 | Contingency 2.5 (shim) assumes the evaluator machine can run Node. If not, that is a single point of failure that must be known before 24 Oct, not at Hour 0. |
| R3 | **Start-set of packages** for T0; other packages created only when the shipped slice uses them. | 4.2, 4.4, ADR-023 | 15+ packages is heavy overhead for one person; the document already says "create only modules the shipped slice uses". |
| R4 | **CLI command list normalised** across FR-027, 4.2, 8.1 and 17.1. `diff` and `demo` are P1; `sample` is not a separate command (use `run --sample N`). | 4.2, FR-027, 8.1, ADR-024 | The same list appeared in three places with different contents. |
| R5 | **Hard cut rule and status checkpoint** in the calendar: if G1 is not passed by end of Fri 16 Oct, T1-full is Deferred and T1-lite shrinks to a minimal viewer or is Deferred. | 12.1, 16 | Enforces "never cut T0" mechanically instead of by judgement under pressure. |

---

## 1. Executive Summary

### 1.1 What AgentForge is
An **evidence-driven agent engine**: a small, modular, auditable system that accepts a task, validates inputs, gathers permitted context, reasons with an LLM and/or deterministic logic, validates the result, handles uncertainty and failure explicitly, and produces the required output **plus evidence of how it was produced**.

The differentiator is **not the number of agents**. It is that decisions are constrained by code, outputs are schema-validated, failures are classified, results are evaluated against evidence, and the system never claims work was done when it was not.

### 1.2 What judges actually evaluate (four signals)
1. **Code** — readable, modular, tested, runnable from README.
2. **Agent output** — real output on the full required workload, exact format, measured performance.
3. **AI-tool transcript** — genuine interaction history showing planning, review, debugging, iteration.
4. **AI-judge interview** — you can defend architecture, metrics, trade-offs, failures.

Everything in this SSOT exists to improve one of those four. A feature that improves none of them is out of scope.

### 1.3 Strategy in four steps
1. **Before kickoff (11–24 Oct):** build and rehearse the reusable foundation (Sections 4–8) and a timeboxed mock challenge.
2. **At kickoff (Hour 0–1):** read the brief, write `docs/challenge-brief.md`, pick an archetype playbook (Appendix A), record ADRs.
3. **During the 24 h:** implement the smallest task-specific adapter; evaluate on the full workload; fix by failure category; harden; freeze.
4. **At submission:** run `pnpm agentforge preflight`, submit exact artifacts + genuine transcript, then prepare for the interview.

### 1.4 Honest scope statement
- **Core baseline (P0):** challenge-adaptable agent engine + evaluation + CLI + thin web run viewer.
- **Challenge adapter (P0 after kickoff):** the real task logic; outranks every assumed demo.
- **Code-Building Profile (PROFILE):** the original AgentForge coding workspace (Section 5.4). Active only if the brief asks for a coding agent or you deliberately pursue it post-hackathon.
- **Student attendance dashboard:** golden demo for the Code-Building Profile only.

---

## 2. Locked Decisions

### 2.1 Canonical stack

| Layer | Choice | Rule |
|---|---|---|
| Language | TypeScript, `strict: true` | One language across CLI, API, worker, web, schemas. No parallel JS/TS codebases. |
| Core | Pure TypeScript packages (`packages/*`) | Business logic never lives in route handlers or CLI files. |
| Web | Next.js App Router + React + Tailwind + shadcn/ui | UI visualizes real execution; it never calls the LLM or invents status. |
| Client data | TanStack Query where needed; native `EventSource` for SSE | No ad hoc global stores duplicating server state. |
| API | Next.js Route Handlers | Thin; validate with Zod, delegate to packages. |
| Orchestration | Explicit TypeScript state machine | LLM cannot mutate run state or permissions. |
| Database | PostgreSQL + Prisma (**T1-full only**) | Source of truth for runs, stages, events, artifact metadata, idempotency in T1-full. T0 and T1-lite use the file run directory (`runs/<runId>/`). |
| Queue/cache | Redis + BullMQ (**T2, P1**) | Never the only record of anything. Default is in-process runner. |
| Artifacts | Local filesystem adapter (P0); S3-compatible/MinIO (P2) | Store key, size, SHA-256, content type in PostgreSQL. |
| Validation | Zod | Validate every untrusted boundary, including model output. |
| LLM | One permitted provider behind `packages/llm` adapter | Keys never reach browser or sandbox. |
| Tests | Vitest (+ Testing Library, Supertest); Playwright for one key web flow | Fast and targeted. |
| Logs | Pino structured JSON | Redact secrets; bound log size. |
| Sandbox | Disposable restricted Docker container (T3 only) | Never run generated code on the host. |
| Package manager | pnpm workspaces, lockfile committed | Node.js = current Active LTS, pinned in `.nvmrc`. |

### 2.2 Tier model (the key to solo-builder sanity)

| Tier | Contains | Needed for | Build when |
|---|---|---|---|
| **T0 Core** | Config, schemas, LLM adapter, policy layer, orchestrator, evaluation harness, CLI, file-based run directory, error taxonomy, preflight | Every valid submission | Pre-kickoff, first |
| **T1-lite Web (default)** | Read-only Next.js run viewer over `runs/<runId>/`, polling with backoff, artifact download (run-scoped), explicit empty/error states | Interview demo; debugging; showing evidence | Pre-kickoff, after G1 |
| **T1-full Web (P1)** | Everything in T1-lite plus PostgreSQL/Prisma persistence, idempotent `POST /api/runs`, web-started runs, web cancel, SSE | Brief requires a UI/service, or slack remains after G2-lite | Only if G1 passed on time and ≥ 1 day of slack remains |
| **T2 Scale** | Worker app, Redis, BullMQ, cache, rate limiting | Long-running or high-concurrency tasks | Pre-kickoff only if time remains; otherwise Deferred |
| **T3 Code profile** | Requirements/Architect/Developer/QA agents, workspace writer, sandbox, repair loop, ZIP export | Brief asks for a coding agent | Only on activation |

**Build order (hard rule):** T0 vertical slice → T1-lite → T1-full → T2 → T3. Never start a tier before the previous tier's gate passes (Section 12.2).

### 2.3 Database and storage decisions
- PostgreSQL + Prisma is canonical for the web profile. SQLite is acceptable for isolated unit tests; **T0 CLI runs need no database** (file-based `runs/<runId>/`).
- Redis may be flushed at any time without losing run history.
- pgvector only if retrieval evaluation shows semantic search helps; start with PostgreSQL full-text search or bounded in-memory retrieval.
- MongoDB, multiple providers, a separate vector DB, Kubernetes, microservices beyond web/worker, and heavy agent frameworks are **not** defaults. An ADR can override with challenge evidence.

### 2.4 Complexity rule
Vertical slice first: **create run → execute task agent → validate output → persist evidence → show result.** Then add persistence, queue, cache, UI polish. Infrastructure may be skipped; **truthful state and output validation may not.**

### 2.5 Contingency: brief mandates a different language or entrypoint

**Pre-kickoff gate (added v5.1, deadline Thu 15 Oct):** read the official event page/rules and record in ADR-022 (a) how submissions are executed or reviewed, (b) whether language/runtime is restricted, (c) whether a Node/pnpm toolchain can be assumed. If any answer is unknown or negative, decide *now* between the options below and rehearse the chosen path in a mock drill.
Decide in Hour 0–1 and record an ADR. Options in order of preference:
1. Thin shim at the required entrypoint (e.g. `main.py` or `run.sh`) that calls the TypeScript CLI.
2. Port only the task-specific adapter, using the contracts and fixtures in this repo as the specification.
3. Full exception — only if the brief forbids both.

---

## 3. Product Vision, Users, Principles, Non-Goals

### 3.1 Vision
Agents that behave like disciplined engineers: use evidence, call only permitted tools, validate outputs, detect uncertainty, route risky cases safely, and leave an auditable account.

### 3.2 Users
- **Primary:** the solo builder under a 24 h deadline.
- **Secondary:** evaluators/AI judge who run the code, read the output, and question the design.
- **End user:** defined by the challenge domain at kickoff.

### 3.3 Value proposition
> AgentForge does not ask anyone to trust a model's claim of success. It produces a result, validates it, records evidence, and marks what passed, failed, or could not be verified.

### 3.4 Principles
1. Evidence over assertion. 2. Minimal useful agent architecture (one agent unless more is proven better). 3. Deterministic control plane. 4. Bounded autonomy (caps on tools, loops, time, context, output). 5. Failure containment per record. 6. Reproducibility. 7. Challenge-first. 8. Honest reporting (`failed` ≠ `not_run` ≠ `unverified`). 9. Security by default (all external text is untrusted). 10. Interview readiness (prefer designs you can defend).

### 3.5 Success outcomes
The real task is solved; output matches the exact contract; source data is used rather than guessed; uncertain/unsafe/out-of-scope cases are handled explicitly; results reproduce from one documented command; you can explain every significant decision and limitation.

### 3.6 Non-goals (unless the brief requires them)
General replacement for engineers; support for all languages/frameworks; full web IDE or collaboration; authentication, billing, RBAC, multi-tenancy; automatic deployment/publishing/email/payments; unrestricted shell; agent marketplace; multi-provider routing; vector DB before benchmarks; decorative dashboards; claims of guaranteed correctness or production readiness.

---

## 4. Architecture

### 4.1 System diagram

```mermaid
flowchart TD
    CLI[CLI adapter: pnpm agentforge] --> CORE
    WEB[Browser: Next.js + React] -->|JSON| API[Route Handlers]
    WEB <-->|SSE or polling| API
    API --> GUARD[Zod validation / rate limit / idempotency]
    GUARD --> PG[(PostgreSQL: source of truth)]
    GUARD --> JR[JobRunner: inline default, BullMQ optional]
    JR --> CORE[Core: orchestrator + agents + policies + evaluator]
    JR -.optional T2.-> RD[(Redis: queue, cache, limits)]
    CORE --> LLM[LLM provider adapter]
    CORE --> TOOLS[Allowlisted tools]
    CORE --> SBX[Sandbox - T3 only]
    CORE --> ART[Artifact store: local FS / S3-compatible]
    CORE --> PG
    API --> PG
    API --> ART
```

The browser never calls the model. The API validates and **persists before enqueueing**. Long work never runs inside a request handler. PostgreSQL owns state; Redis only accelerates.

### 4.2 Modules and boundaries

| Package | Responsibility | Must not |
|---|---|---|
| `apps/cli` (or `packages/cli`) | P0: `run`, `eval`, `validate`, `report`, `preflight`, `transcript add`. P1: `diff`, `demo` | Contain business logic |
| `apps/web` | UI + API route handlers | Call the LLM or invent run status |
| `apps/worker` (T2) | Consume jobs, invoke orchestrator | Treat Redis as authoritative |
| `packages/orchestrator` | State machine, stage scheduling, retries, cancellation, final status | Let model output change permissions/state |
| `packages/agents` | Task-specific agent roles + typed contracts | Assume every task needs several agents |
| `packages/llm` | Provider adapter, structured generation, usage extraction, prompt versions | Leak provider APIs elsewhere |
| `packages/schemas` | Zod schemas: requests, agent outputs, events, reports | Trust unvalidated LLM/tool output |
| `packages/policies` | Routing, tool allowlist, retry/abstain/escalate policy | Be overridable by prompt text |
| `packages/evaluation` | Metrics, fixtures, failure categorization, baseline comparator | Use LLM self-scoring as sole metric |
| `packages/adapter-kit` | `ChallengeAdapter` interface + contract validators (Appendix B) | Contain domain logic |
| `packages/db` | Prisma schema, migrations, repositories, transactions | Store large blobs by default |
| `packages/cache` (T2) | Versioned keys, TTLs, safe cache ops, metrics | Cache unsafe or stale execution claims |
| `packages/jobs` | `JobRunner` interface, inline runner, BullMQ runner (T2) | Run unbounded retry loops |
| `packages/artifacts` | Storage interface, checksums, safe exports | Accept arbitrary client paths |
| `packages/sandbox` (T3) | Restricted command runner + workspace lifecycle | Execute arbitrary shell or expose secrets |
| `packages/observability` | Pino logger, event helpers, metrics | Log secrets or unbounded payloads |
| `packages/shared` | Types, constants, safe errors | — |

**T0 start-set (v5.1):** `shared`, `schemas`, `llm`, `policies`, `orchestrator`, `adapter-kit`, `evaluation` (+ `apps/cli`). Until a second agent role is justified by measurement, `agents` logic lives inside the adapter. The atomic writer lives in `orchestrator` and logging helpers in `shared` until `artifacts` / `observability` are needed. `db`, `jobs`, `cache`, `sandbox`, `worker` are created only in the tier that needs them.

### 4.3 Data store responsibilities
- **PostgreSQL:** runs, stages/agent executions, ordered events, artifact metadata, command results, evaluation summaries, idempotency records, audit decisions, usage ledger.
- **File run directory (T0):** `runs/<runId>/{input.json, config.snapshot.json, output.*, trace.jsonl, metrics.json, report.md, checkpoint.jsonl}`.
- **Redis (T2):** queue state, rate-limit counters, short locks, TTL cache. Restart must not erase completed runs.
- **Artifact store:** large files, logs, ZIPs, reports; hash + size recorded.

### 4.4 Repository structure

```text
agentforge/
├── apps/
│   ├── cli/                  # pnpm agentforge <command>
│   ├── web/                  # Next.js UI + API routes
│   └── worker/               # T2 only
├── packages/
│   ├── adapter-kit/  agents/  orchestrator/  llm/  schemas/  policies/
│   ├── evaluation/   db/      jobs/          artifacts/  observability/  shared/
│   ├── cache/                # T2
│   └── sandbox/              # T3
├── prisma/schema.prisma
├── templates/react-vite/     # T3 only
├── tests/{unit,integration,api,e2e,security,fixtures}/
├── fixtures/injection/       # prompt-injection pack (FR-031)
├── docs/
│   ├── challenge-brief.md  architecture.md  decisions.md  threat-model.md
│   ├── failure-analysis.md  demo-script.md  interview-pack.md  preflight-checklist.md
│   └── ai-transcript/        # genuine AI session exports (FR-029)
├── infra/{docker-compose.yml, sandbox/}
├── runs/                     # git-ignored run outputs
├── .env.example  .gitignore  .nvmrc  package.json  pnpm-workspace.yaml  tsconfig.base.json  README.md
```

Create only modules the shipped slice uses (start-set in 4.2). Delete unused scaffolding at the freeze (Phase D).

### 4.5 Environment configuration

```dotenv
NODE_ENV=development
LLM_API_KEY=
LLM_MODEL=
DATABASE_URL=postgresql://agentforge:agentforge@localhost:5432/agentforge
JOB_RUNNER=inline                  # inline | bullmq
REDIS_URL=redis://localhost:6379   # only when JOB_RUNNER=bullmq or CACHE_ENABLED=true
OBJECT_STORAGE_MODE=local
OBJECT_STORAGE_BUCKET=agentforge-artifacts
MAX_TRANSIENT_RETRIES=2            # provider timeouts / 429 / 5xx
MAX_SCHEMA_CORRECTIONS=1           # re-ask after invalid structured output
MAX_REPAIR_ATTEMPTS=2              # T3 code profile only
MAX_RUN_DURATION_SECONDS=900       # single-task runs
BATCH_MAX_DURATION_SECONDS=        # set at kickoff for batch tasks
BATCH_CONCURRENCY=4
MAX_INPUT_CHARS=20000
MAX_CONTEXT_CHARS=30000
MAX_OUTPUT_BYTES=1000000
LOG_MAX_BYTES=200000
MAX_LLM_CALLS_PER_RUN=            # budget guard (FR-034); set at kickoff
CACHE_ENABLED=false                # opt-in, T2
CACHE_DEFAULT_TTL_SECONDS=300
```

Committed values are development placeholders only. Challenge limits override these defaults, subject to security and submission rules. Use only variables for the active tier.

---
## 5. Functional Requirements

Each requirement has a stable ID, tier, priority, and testable acceptance criteria. Kickoff-time requirements use `CH-###` in the same format.

### 5.1 Core Agent Engine (T0 unless stated)

**FR-001 — Configuration loading** (T0 · P0)
Load runtime configuration from documented environment variables and/or a validated config file.
- Missing required config → concise actionable error; CLI/worker exits non-zero; web readiness returns 503 with a safe message.
- Secrets are never printed, logged, or returned.
- Defaults are documented in `.env.example`.
- The effective non-secret configuration is saved with every run (`config.snapshot.json`).

**FR-002 — Task input ingestion** (T0 · P0)
Accept the challenge's input format through a defined adapter.
- Parser validates required fields/columns and types.
- Malformed records are reported with record IDs or row numbers.
- Records are never silently changed, dropped, or reordered unless the contract allows it.
- Batch-level errors and record-level errors are distinguished.

**FR-003 — Input normalization** (T0 · P0)
Normalize into a stable internal representation without losing task-relevant information.
- Rules live in code and are tested.
- Missing, empty, duplicate, and malformed values have explicit behaviour.
- Original identifiers survive to the final output.

**FR-004 — Challenge contract** (T0 · P0 after kickoff)
Implement the exact output contract: fields, enums, filenames, row correspondence, serialization.
- Every required field present; values obey enums.
- Cardinality and ordering match instructions.
- Invalid output is blocked from final submission with a clear validation error.

**FR-005 — Context construction** (T0 · P0 where needed)
Build bounded context from the current input and only permitted reference material.
- Implemented in one inspectable module with documented size limits.
- If a corpus is designated authoritative, it is used instead of model memory.
- Missing evidence is represented as missing, never fabricated.

**FR-006 — Retrieval and evidence grounding** (T0 · P0 when source material is provided, else N/A)
- Retrieval returns traceable source IDs.
- Justifications cite the evidence the task requires.
- No suitable evidence → configured policy (abstain, ask, escalate, or mark unverified).
- Retrieval quality is measured on representative examples before adding embeddings.

**FR-007 — Agent reasoning** (T0 · P0)
Produce the decision/result using an LLM and/or deterministic algorithm.
- Prompts/instructions and model settings are versioned (prompt version ID recorded per call).
- Model receives only permitted context.
- The system never claims a tool ran unless logs confirm it.
- A single agent is the default; extra roles need distinct responsibility and measured value.

**FR-008 — Structured output generation** (T0 · P0)
- Output is parsed and Zod-validated before use.
- Invalid structure gets at most `MAX_SCHEMA_CORRECTIONS` correction attempts (default 1).
- After that the record/run fails clearly; malformed output is never passed on as valid.
- Free-form text never substitutes for a required structure.

**FR-009 — Deterministic policy layer** (T0 · P0)
- Allowed labels, state transitions, tool permissions, retry budgets, and output constraints are enforced in ordinary code.
- The LLM cannot raise its permissions, alter the submission contract, or bypass limits.
- Boundary cases have unit tests.

**FR-010 — Tools and allowlist** (T0 · P0 if tools are used)
- Tools are registered with input schema, output schema, permission level, and timeout.
- Unknown tools are rejected (`TOOL_NOT_ALLOWED`); arguments are validated before execution.
- Results are recorded with status and duration.
- Side-effecting tools are disabled unless the brief requires them and the action is specifically authorized.
- Tool output is untrusted data, never privileged instructions.

**FR-011 — Uncertainty, abstention, escalation** (T0 · P0 when applicable)
- Policy states when to proceed, ask, abstain, or escalate.
- Abstention/escalation is not a shortcut for every hard case; tests cover high-risk cases **and** ordinary valid cases separately.
- Reasons are concise and tied to evidence or a defined policy.

**FR-012 — Workflow orchestration** (T0 · P0)
- Steps and dependencies are documented; each step takes typed input and returns a typed result.
- State transitions are validated; terminal runs cannot silently restart.
- Model-driven routing, if any, runs inside deterministic constraints.
- Parallelism only for independent work with integration tests.

**FR-013 — Bounded retries** (T0 · P0)
- Limits are configurable with safe defaults (`MAX_TRANSIENT_RETRIES`, `MAX_SCHEMA_CORRECTIONS`).
- Non-retryable errors (bad credentials, unsupported tool) are never retried.
- Every retry is logged with its reason; infinite loops are impossible by construction.
- Transient retries use exponential backoff with jitter.

**FR-014 — Timeout and cancellation** (T0 · P0)
- Run, record, and tool timeouts produce distinct statuses.
- Cancellation (CLI `SIGINT`/`SIGTERM`, web API) prevents new stages from starting; active subprocesses are terminated where safe.
- Partial results are preserved and marked incomplete.

**FR-015 — Run output writer** (T0 · P0)
- Output path comes from config/code, never from model output.
- Files are written atomically (temp file + rename).
- Final output is reopened and revalidated before the run is marked complete.
- No success status if any required artifact is missing.

**FR-016 — Evaluation harness** (T0 · P0)
- One documented command (`pnpm agentforge eval`) runs baseline tests and applicable evaluation cases.
- Metrics are computed from actual outputs; uncomputable metrics are reported as `unavailable`.
- Results include counts and failing cases; a baseline is saved **before** optimisation.
- Regression cases are added whenever a failure is understood.

**FR-017 — Failure analysis and iteration** (T0 · P0)
- Errors are grouped (schema, retrieval, classification, hallucination, safety, tool failure, timeout, contract).
- Each change is tied to a measured failure mode or requirement.
- The full regression suite reruns after each significant change.
- Improvements that worsen another critical metric are documented, not hidden.

**FR-018 — Structured execution trace** (T0 · P0)
- Trace includes run ID, timestamps, stage/tool IDs, status, duration, model ID, prompt version, retries, error category, artifact references.
- In batch runs each input record links to its output and evidence.
- Secrets and unnecessary sensitive content are redacted; raw logs are size-bounded.

**FR-019 — Reproducible execution** (T0 · P0)
- Dependency versions pinned; one primary install path.
- Seeds fixed where supported; model nondeterminism acknowledged, never promised away.
- Input hash, code version (git SHA), config, prompt/schema versions, and output are linked to the run.
- The documented command is tested from a clean clone before submission.

**FR-020 — Error taxonomy** (T0 · P0)
Stable categories: `CONFIG_INVALID`, `INPUT_INVALID`, `SCHEMA_INVALID`, `LLM_TIMEOUT`, `LLM_RATE_LIMITED`, `LLM_AUTH_FAILED`, `LLM_INVALID_OUTPUT`, `RETRIEVAL_FAILED`, `TOOL_NOT_ALLOWED`, `TOOL_FAILED`, `OUTPUT_INVALID`, `EVALUATION_FAILED`, `BUDGET_EXCEEDED`, `SANDBOX_UNAVAILABLE`, `DUPLICATE_RUN`, `CANCELLED_BY_USER`, `RUN_TIMED_OUT`, `INTERNAL_ERROR`.
- Every handled failure maps to exactly one category with a safe human message.
- No secrets or raw stack traces reach end users.

**FR-021 — Submission artifact packaging** (T0 · P0)
- Source, README, final output, and evaluation notes are easy to identify and reproduce.
- A required AI transcript is the genuine one (see FR-029); nothing is fabricated or reconstructed as contemporaneous.
- No secrets, unrelated local data, or giant unrequested files.
- A pre-submit checklist verifies names, paths, format, completeness (FR-032).

**FR-022 — Run and record isolation** (T0 · P0)
- Unique run ID; run artifacts in a dedicated directory or namespace.
- A failed run never overwrites the last known-good output until the new output has passed validation.

**FR-023 — Demo / fixture mode** (T0 · P1)
- Fixture results are labelled `FIXTURE` everywhere (CLI banner, report, UI badge, output filename).
- Fixture mode never claims live success; the evaluator path never silently substitutes fixtures for live processing.

**FR-024 — Durable run and artifact persistence** (T1-full · P1; T1-lite reads the run directory)
- Every run, stage, event, and artifact record carries a stable run ID.
- State transitions and finalization are transactional.
- Redis loss cannot erase run records; large bytes are not stored in DB rows.
- Migrations and a documented local setup (`docker compose up`) are included.

**FR-025 — Cache correctness** (T2 · P0 only when caching is enabled)
- Cache keys include normalized input, model ID, prompt version, schema version, generation params, relevant config, and source/retrieval version.
- Explicit TTLs and invalidation policy; cache hits are visible in traces and never masquerade as fresh execution.
- Never trust cached tool side effects, sandbox results, or environment-dependent verification.
- Cache errors degrade to a safe miss.

**FR-026 — Idempotent run creation and finalization** (T1-full · P1 for the web adapter; T0 equivalents apply to CLI and stay P0)
- `POST /api/runs` supports an idempotency key backed by a **PostgreSQL unique constraint** (not Redis).
- Finalization uses a conditional update (`WHERE status NOT IN terminal`) so duplicate delivery cannot finalize twice.
- Event sequence numbers are stable per run; final output is committed only after validation.
- CLI: re-running with the same `--run-id` refuses to overwrite a completed run unless `--force` and the old output is archived.

#### New hackathon features (added in v5.0)

**FR-027 — CLI adapter** (T0 · P0)
`pnpm agentforge <command>` is a thin adapter over the same packages.
- P0 commands: `run`, `eval`, `validate`, `report`, `preflight`, `transcript add`. P1 commands: `diff` (FR-040), `demo` (FR-023, runs `DemoAdapter`, output labelled `FIXTURE`). Sampling is a flag (`run --sample N`, FR-037), not a separate command.
- Each command prints a final line with status, output path, and counts; exit code 0 only on `succeeded`/`succeeded_with_warnings`.
- Only documented flags exist. If the event mandates a specific command, implement it and route it through the same core.

**FR-028 — Challenge Adapter interface** (T0 · P0)
All task-specific behaviour is a single `ChallengeAdapter` implementation (Appendix B).
- Methods: `parseInput`, `normalize`, `buildContext`, `decide`, `validateOutput`, `writeOutput`, `evaluate`.
- The core never imports domain code; swapping the adapter requires no core edits.
- A `DemoAdapter` ships with the foundation as a working reference and test subject.

**FR-029 — AI transcript vault** (T0 · P0 if the event requires a transcript, else P1)
- `docs/ai-transcript/` holds raw, unedited exports of real AI sessions, one file per session, with an `INDEX.md` listing date, tool, purpose.
- A helper (`pnpm agentforge transcript add <file>`) copies an export in, records its SHA-256, and timestamps it.
- The helper never edits content and never generates conversation text.
- Preflight warns if the vault is empty or if files changed after being added (hash mismatch).

**FR-030 — Run report generator** (T0 · P0)
`pnpm agentforge report <runId>` produces `report.md` + `metrics.json`.
- Contents: run ID, status, inputs hash, config snapshot, counts, per-stage durations, error categories, abstention rate, metrics (or `unavailable`), top failures, limitations, `not_run` checks.
- Numbers come from run data only.

**FR-031 — Prompt-injection and adversarial fixture pack** (T0 · P0)
- `fixtures/injection/` contains reusable cases: instruction override in input text, fake system messages, requests to reveal secrets, tool-abuse attempts, output-format hijacks, and homoglyph/encoding tricks.
- A test asserts the agent obeys policy and contract on every case.
- Kickoff adds domain-specific cases (CH-007).

**FR-032 — Preflight / submission checker** (T0 · P0)
`pnpm agentforge preflight` runs the pre-submit checklist (Section 15.3) automatically.
- Checks: required files exist at exact paths; schema valid; row count equals input count; no duplicate IDs; no secrets (pattern scan of repo and outputs); lockfile present; `.env` not committed; README commands parse; transcript vault non-empty and hashes intact; output not marked `FIXTURE`; output newer than last code change.
- Output: PASS/FAIL per check, non-zero exit on any FAIL.

**FR-033 — Checkpoint and resume for batch runs** (T0 · P0 if the task is batch)
- Each completed record is appended to `checkpoint.jsonl` (ID, status, output hash) before the next starts.
- `run --resume <runId>` skips completed records, retries `failed` ones per policy, and never reprocesses `succeeded` records.
- A corrupted checkpoint line is reported and that record is reprocessed; resume cannot duplicate output rows.

**FR-034 — Budget guard and usage ledger** (T0)
- *Guard (P0):* `MAX_LLM_CALLS_PER_RUN` (and optional token cap) stops new calls with `BUDGET_EXCEEDED`; the run ends `blocked` or `succeeded_with_warnings` per policy; partial output is marked incomplete.
- *Ledger (P1):* per-call model, tokens, latency recorded from provider usage metadata; costs shown only when the provider returns usage, otherwise labelled estimate.

**FR-035 — Deterministic baseline comparator** (T0 · P1)
- A rules/heuristic baseline implements the same adapter output contract.
- `eval` reports LLM-agent metrics next to baseline metrics so you can show measured lift in the interview.
- The baseline is never used as a silent fallback for live processing (FR-023).

**FR-036 — Failure clustering report** (T0 · P1)
- `eval` groups failures by error category and by simple features (input length, label, source, missing-evidence flag) and lists top clusters with 3 example IDs each.
- Feeds `docs/failure-analysis.md`.

**FR-037 — Sample / dry-run mode** (T0 · P1)
- `run --sample N` processes a deterministic subset (seeded) and labels the output `SAMPLE`, never final.
- `run --dry-run` validates input, config, and adapter wiring with no LLM calls.

**FR-038 — Bounded concurrency pool** (T0 · P1)
- Batch records run with `BATCH_CONCURRENCY` workers, rate-limit aware (respect `429`/`Retry-After`), output ordering restored to contract order.
- One record failing never cancels others (NFR-005).

**FR-039 — Interview pack scaffold** (T0 · P1)
- `docs/interview-pack.md` template with the ten required answers (Section 15.2), a metrics table filled from `metrics.json`, top three limitations, and rejected alternatives.
- AI may draft; the builder must be able to explain every line unaided.

**FR-040 — Run diff** (T0 · P1)
- `pnpm agentforge diff <runA> <runB>` shows changed records, changed labels, metric deltas, and newly failing records to expose regressions before they are hidden by an aggregate score.

### 5.2 Challenge Adapter (written at kickoff; T0)

These are domain-neutral until the brief arrives. Each becomes a concrete `CH-###` entry with source instruction, implementation, test, and acceptance evidence.

- **CH-001 Brief capture (P0):** `docs/challenge-brief.md` with exact prompt wording, inputs, outputs, schema, execution command, limits, permitted resources, evaluation rules. Interpretation is kept in a separate section.
- **CH-002 Contract tests (P0):** fixtures from supplied examples; tests for fields, enums, order/cardinality, encoding, filenames, edge cases.
- **CH-003 Domain workflow (P0):** only the reasoning/retrieval/tools/decisions the brief requires; each requirement traces to a `CH-###` and a test.
- **CH-004 Dataset integrity (P0 if data supplied):** inspect row counts, schema, duplicates, missing values, encoding, label distribution, corpus coverage. Source data stays read-only; any cleaning is documented.
- **CH-005 Full-workload processing (P0 if batch):** process every required record; verify output row count and ID correspondence; a partial run is marked incomplete and is never a final output.
- **CH-006 Domain evaluation (P0):** implement the official metric or the closest available proxy; never optimise an invented metric in place of the rubric.
- **CH-007 Domain safety (P0 where applicable):** sensitive, adversarial, high-risk, prompt-injection, unsupported, and out-of-scope cases; untrusted task data never overrides policy or contract.
- **CH-008 Final verification (P0):** final command from a clean state, file and count checks, sample and edge-case inspection, honest limitations list.
- **CH-009 Archetype selection (P0):** pick one playbook from Appendix A (classification/triage, RAG Q&A, extraction, planning/tool agent, code agent) and record it as an ADR with the reason.
- **CH-010 Entrypoint decision (P0):** apply the contingency in 2.5 if the event mandates a different command or language.

### 5.3 Web Application and Run Workspace (T1)

Built **before** kickoff. A deliberately small viewer of real execution; it does not replace the challenge's required output.

**v5.1 scope split.** *T1-lite (default):* FR-UI-002, 003 (polling with backoff), 004, 005, 007, 008, 010, reading from `runs/<runId>/`; runs are started and cancelled from the CLI. *T1-full (P1):* FR-UI-001 (web-started runs), FR-UI-006 (web cancel), SSE in FR-UI-003, and PostgreSQL-backed state. FR-UI-009/011/012 stay P1.

- **FR-UI-001 New run screen (P0):** validated form/upload for the active input; shows supported types, required fields, limits, actionable errors. Example prompts are optional and labelled as examples.
- **FR-UI-002 Run status (P0):** states per Section 7.1, read from the backend, never simulated.
- **FR-UI-003 Timeline (P0):** real stages, handoffs, durations, safe errors; SSE with reconnect/replay by sequence ID, polling-with-backoff fallback; no fake percentages.
- **FR-UI-004 Output and evidence view (P0):** final output, validation status, evidence references, metrics, unresolved issues; downloads only for artifacts belonging to the current run.
- **FR-UI-005 Refresh recovery (P0):** reloading a run page restores state, events, artifact metadata from the backend; refresh never creates a duplicate run.
- **FR-UI-006 Cancellation (P0):** user requests cancel; backend records it; UI confirms only after the backend reports the resulting state.
- **FR-UI-007 Error/empty/loading/degraded states (P0):** invalid input, provider failure, infrastructure blocked, missing artifact, timeout, partial result, empty history. Placeholder data is never shown as real output.
- **FR-UI-008 Accessibility baseline (P0):** keyboard operation, visible focus, semantic headings/controls, non-colour-only status cues. Extended items are P1 (NFR-012).
- **FR-UI-009 Run history (P1):** list prior runs with status, time, link.
- **FR-UI-010 Artifact download (P0 where output is a file):** API verifies run/artifact association; archives built from validated manifests, never client paths.
- **FR-UI-011 Evaluation dashboard (P1):** view `metrics.json`, failure clusters, baseline-vs-agent comparison, run diff. Real data only.
- **FR-UI-012 Record inspector (P1, batch tasks):** pick an input record and see input → context → evidence → decision → output → validation in one panel; the best interview demo tool.

### 5.4 Code-Building Profile (T3 · PROFILE)

**Activation rule:** These requirements become P0 only if the brief specifically calls for a code-generating agent, or you explicitly choose the post-hackathon coding workspace. Until then they must not displace the challenge adapter.

#### Workflow
1. User enters a small application brief.
2. Requirements Agent → validated scope and acceptance criteria.
3. Architect Agent → constrained plan, file manifest, test plan.
4. Developer Agent → structured file changes.
5. Deterministic code validates paths/manifest and writes files into a temporary workspace.
6. Restricted sandbox runs predefined checks.
7. QA Agent interprets actual results into structured issues.
8. Orchestrator retries the Developer Agent at most `MAX_REPAIR_ATTEMPTS` (default 2) after the initial attempt, only for repairable failures.
9. Required checks rerun on repaired files.
10. Final report and path-safe ZIP export.

**Golden demo brief:** *Build a student attendance dashboard. Users can add students, mark each student's attendance for a selected date, and view attendance totals. Use React and TypeScript. Store demo data locally. Include tests for adding students and marking attendance.* (Demo only — never a substitute for the real brief.)

#### Requirements
- **FR-CODE-001 App brief input:** validated natural-language request with name and constraints; shows supported stack and scope.
- **FR-CODE-002 Requirements Agent:** summary, in-scope features, non-goals, acceptance criteria, assumptions, blocking questions only when necessary; schema-validated.
- **FR-CODE-003 Architect Agent:** component/module plan, relative file manifest, data model if needed, implementation order, risks, tests mapped to acceptance criteria; no arbitrary dependencies or alternative stack.
- **FR-CODE-004 Developer Agent:** structured file changes plus summary; output is *proposed* content, not proof the code works; repairs use verified failure evidence.
- **FR-CODE-005 Deterministic workspace writer:** validates paths, duplicates, file count/size, total bytes, encoding, entry points; rejects absolute paths, traversal, escaping symlinks.
- **FR-CODE-006 Fixed template:** React + TypeScript + Vite; installed styling only; local/in-memory demo data; pinned lockfile; tests with Vitest + React Testing Library.
- **FR-CODE-007 Restricted command runner:** fixed allowlist (`typecheck`, `lint`, `test`, `build`) in a disposable sandbox; never arbitrary shell strings.
- **FR-CODE-008 Command evidence:** per command — label, whether it ran, exit code, bounded stdout/stderr, duration, timeout flag, truncation flag; blocked/not-run commands never shown as passed.
- **FR-CODE-009 QA Agent:** per-criterion status `passed | failed | not_verified`, structured issues with severity, evidence, affected files, repair guidance; separates product failures from infrastructure failures.
- **FR-CODE-010 Bounded repair loop:** original output and diffs preserved; repair counts only after files are revalidated and checks rerun; credential, quota, and sandbox-infrastructure failures are never treated as code defects.
- **FR-CODE-011 File tree and read-only viewer:** diff view (P1) compares real versions.
- **FR-CODE-012 Final engineering report:** run ID/name, final status, features, per-criterion status with evidence, file list, commands actually run with real results, initial validation and repair history, unresolved issues, checks not run and why, export metadata.
- **FR-CODE-013 Project export:** ZIP from the validated manifest plus report; path-safe; excludes secrets, temp files, unapproved content.
- **FR-CODE-014 Browser preview (P1):** controlled preview only after build and isolation work.
- **Reviewer Agent (P1):** advisory review (maintainability, accessibility, obvious unsafe patterns); never replaces tests.

#### Sandbox security profile (mandatory when code runs)
Non-root user; dedicated temp workspace; no host-wide mount; no Docker socket; no provider keys or host secrets; network off by default; pinned dependencies, no arbitrary installs; fixed command → fixed executable/args; CPU, memory, process, disk, output, and wall-clock limits; timed-out processes killed and workspace cleaned; file count/size caps; path-safe ZIP. If safe isolation cannot be established, generate files, run only non-executing checks, and mark runtime tests `not_run` (`SANDBOX_UNAVAILABLE`).

#### Profile screens (if UI is built)
New Run; Run Workspace (stage status, timeline, artifact viewer); file tree + code viewer; final report with test evidence, unresolved issues, export. States: idle, validating, queued, running, repairing, cancelling, succeeded, succeeded with warnings, failed, blocked, cancelled, timed out. Progress derives from real events only.

---
## 6. Non-Functional Requirements

Targets are **engineering goals, not measured claims**. Change them only through a logged decision.

| ID | Area | Requirement | Pri | Verification |
|---|---|---|---|---|
| NFR-001 | Correctness | Every output submitted as valid passes the task schema validator; IDs and source-to-output correspondence preserved; no required field silently omitted; correctness comes from tests/evaluator, never model confidence | P0 | Schema tests, golden fixtures, record-count checks |
| NFR-002 | Truthfulness | A tool call, test, retrieval, or export is "complete" only with real result evidence; `not_run`, `blocked`, `timed_out`, `failed` are distinct; unverified criteria and limitations are disclosed | P0 | Fault tests: tool failure, missing process, timeout, non-zero exit |
| NFR-003 | Security | Keys from env/secret store only; no secrets in browser, logs, traces, reports, or generated files; all inputs, retrieved text, model output, tool output are untrusted; task text never overrides policy; rate limits + validation on public entry points | P0 | Secret scan, redaction tests, injection fixtures, boundary tests |
| NFR-004 | Execution isolation | Generated code never runs unrestricted on the host; sandbox per 5.4; if isolation is unavailable, execution is disabled and results are `not_run`. N/A for non-executing agents | P0 for T3 | Sandbox smoke test, path-escape tests, timeout cleanup |
| NFR-005 | Reliability | Invalid output, provider failure, bad input, and tool errors yield controlled failures, not crashes; one bad record never stops others unless the contract is all-or-nothing; retry loops terminate; final output never overwritten with incomplete results | P0 | Fault injection per error category; batch test with one bad record |
| NFR-006 | Bounded execution | See performance table below | P0 | Timed integration tests, recorded durations |
| NFR-007 | Resource and cost control | Per-stage context/output limits configurable; send summaries not full traces; every model call logged without secrets (model ID recorded); cost reported only from real usage or labelled estimate; budget guard (FR-034); vector DBs, extra providers, agent frameworks only after evidence | P0 | Inspect call trace; compare before/after an optimisation |
| NFR-008 | Reproducibility | Pinned deps; run records code version, config, prompt/schema versions, seeds, timestamps; deterministic layers repeatable; LLM variance documented | P0 | Run tests twice from clean setup |
| NFR-009 | Auditability | Unique run ID; structured event per major stage (time, stage, status, duration, refs); per-record traceability for batch; bounded logs | P0 | Inspect a full trace input → output |
| NFR-010 | Maintainability | Separate UI, transport, orchestration, provider, policy, validation, evaluation, persistence, queue, artifacts, sandbox; strict TS; Zod at untrusted boundaries; small modules; provider logic behind adapter; no unused abstractions; no unhandled rejections in the tested workflow | P0 | Code review, lint, type check, tests, clean README run |
| NFR-011 | Debuggability | Errors name the failed stage and next action without leaking internals; success vs failure unmistakable; every eval saves machine-readable metrics + human summary; README sufficient for a capable evaluator | P0 | Follow README on a clean machine |
| NFR-012 | Accessibility (extended) | Contrast audit, live-region status announcements, reduced-motion support, responsive layout (mobile usable). Baseline items are FR-UI-008 (P0) | P1 | Keyboard walkthrough, viewport check |
| NFR-013 | Data minimisation | Keep only data needed for task, output, evaluation, trace; never send unrelated files/secrets to the model; temp workspaces cleaned at finish or timeout; supplied datasets stay read-only, derived data stored separately | P0 | File review, cleanup test, source checksum |
| NFR-014 | Portability | Document Node/pnpm versions and OS assumptions; one install path; no dependence on a developer's key, paths, or caches; Docker readiness verified separately if required | P0 | Fresh-environment smoke test |
| NFR-015 | Interview explainability | Builder can explain architecture, model/tool choices, metrics, failures, safety rules, rejected alternatives, weaknesses; repo has decision log and failure analysis; no claimed capability absent from code | P0 | Practice walkthrough using only repo + run artifacts |
| NFR-016 | Submission integrity | Exact paths, names, encodings, schemas; final run completed before submission and distinguishable from stale/fixture outputs; genuine transcript; no placeholder or fabricated numbers | P0 | Preflight, rerun, count checks |

### Performance and bounds (defaults)

| Measure | Initial target |
|---|---|
| Internal non-LLM operation | p95 < 500 ms for in-memory work (excludes DB, object storage, filesystem-heavy work) |
| UI event visibility | ≤ 2 s under local/demo conditions (SSE or polling) |
| Single-task run | ≤ `MAX_RUN_DURATION_SECONDS` (900 s) |
| Batch run | ≤ `BATCH_MAX_DURATION_SECONDS`, set at kickoff; must leave ≥ 3 h for hardening and submission |
| Schema correction | ≤ 1 attempt by default |
| Transient provider retries | ≤ 2 by default, with backoff + jitter |
| Repair attempts (T3) | ≤ 2 after the initial attempt |
| Tool execution | Per-tool timeout mandatory |

Do not promise end-to-end LLM latency; provider speed and workload are external.

---

## 7. Data Contracts, State, and Errors

### 7.1 One run-state vocabulary

| State | Terminal? | Meaning | UI label |
|---|---|---|---|
| `queued` | no | Persisted, waiting to start | Queued |
| `running` | no | Executing stages | Running |
| `waiting_for_provider` | no | Backing off after transient provider error | Waiting (provider) |
| `repairing` | no | T3 repair attempt in progress | Repairing |
| `cancelling` | no | Cancel accepted, stopping | Cancelling |
| `succeeded` | yes | All required checks ran and passed; output written and validated | Succeeded |
| `succeeded_with_warnings` | yes | Required checks passed; only non-blocking findings remain; contract allows warnings | Succeeded with warnings |
| `failed` | yes | Task ran but a required criterion stayed unmet after allowed recovery | Failed |
| `blocked` | yes | Could not complete due to provider, credentials, tool, budget, or infrastructure | Blocked |
| `cancelled` | yes | Cancellation accepted; no more work scheduled | Cancelled |
| `timed_out` | yes | Configured overall deadline exceeded | Timed out |

`not_run` applies to individual checks only, never to a run.

### 7.2 State rules
- A run starts at `queued` and moves only through validated transitions.
- A terminal run cannot return to `running`. A new attempt is a new run ID or an explicit revision.
- Final status is computed from actual results and challenge policy, never copied from an LLM response.
- Tasks with no repair flow skip `repairing`.

### 7.3 Per-stage / per-record result
Every operation records: `run_id`; record/input ID; stage or tool name; `status` ∈ `passed | failed | blocked | timed_out | not_run | skipped` (or a challenge decision); start/end/duration; input/output artifact refs; error category + safe message; retries; provider/model/prompt version.

### 7.4 Error → run-status mapping

| Error category | Typical effect |
|---|---|
| `CONFIG_INVALID`, `LLM_AUTH_FAILED`, `SANDBOX_UNAVAILABLE`, `BUDGET_EXCEEDED` | run `blocked` (record-level: `blocked`) |
| `INPUT_INVALID`, `SCHEMA_INVALID` | record `failed`; batch continues unless all-or-nothing |
| `LLM_TIMEOUT`, `LLM_RATE_LIMITED` | retry with backoff, then record `failed` or run `blocked` |
| `LLM_INVALID_OUTPUT` | one correction, then record `failed` |
| `TOOL_NOT_ALLOWED`, `TOOL_FAILED`, `RETRIEVAL_FAILED` | record `failed` or policy-defined abstention |
| `OUTPUT_INVALID`, `EVALUATION_FAILED` | run `failed`; output not published as final |
| `CANCELLED_BY_USER`, `RUN_TIMED_OUT` | `cancelled`, `timed_out` |
| `DUPLICATE_RUN` | request rejected, existing run returned |
| `INTERNAL_ERROR` | run `failed` with safe message; details only in redacted logs |

---

## 8. Interfaces: CLI, API, Worker

### 8.1 CLI (T0 · P0)

```bash
pnpm agentforge run       --input <path> --output <path> [--config <path>] [--run-id <id>] [--resume <id>] [--sample N] [--dry-run]   # --sample / --dry-run are P1 (FR-037)
pnpm agentforge eval      [--fixtures <dir>] [--baseline]
pnpm agentforge validate  --output <path>
pnpm agentforge report    <runId>
pnpm agentforge preflight
pnpm agentforge transcript add <file>
# P1:
pnpm agentforge diff      <runA> <runB>      # FR-040
pnpm agentforge demo                         # FR-023, output labelled FIXTURE
```

Document only flags that exist. Exit code 0 only for `succeeded` or `succeeded_with_warnings`.

### 8.2 Web API (T1)
- `POST /api/runs` — validate, check idempotency key, persist `queued` run, hand to `JobRunner`, return `runId` + status.
- `GET /api/runs/:runId` — authoritative status, current stage, summary, artifact metadata.
- `GET /api/runs/:runId/events?after=<seq>` — SSE or ordered poll; supports reconnect/replay.
- `POST /api/runs/:runId/cancel` — record cancellation, return recorded state.
- `GET /api/runs/:runId/artifacts/:artifactId` — only after verifying it belongs to the run.
- `GET /api/runs/:runId/export` — validated export if the profile supports it.
- `GET /health/live`, `GET /health/ready` — liveness, readiness; no secrets or topology.

**Behaviour rules:** Zod on requests and responses; consistent error codes with safe messages; rate limits on public entry points; no arbitrary paths or shell commands from the browser; persist before acknowledging; if enqueue fails, return a truthful error and reconcile state; SSE events ordered with sequence IDs; authorize every lookup (document the single-user local-demo assumption rather than faking authentication).

### 8.3 Worker / job runner contract
Consume a run job, load authoritative inputs from PostgreSQL, execute bounded stages, persist events and artifacts, compute final status from evidence, finalize **exactly once**, tolerate duplicate delivery and restart.
- Persist run + idempotency record before acknowledging.
- Queue job ID derives from the run ID.
- Retries are bounded and classified transient vs non-retryable.
- A worker crash leaves the run recoverable (`failed`/`blocked`), never stuck as `running` (heartbeat + stale-run sweeper).
- Cancellation is cooperative first, then process termination.
- Default `JOB_RUNNER=inline` executes in-process but still outside the request handler lifecycle (detached task + persisted state); `bullmq` is the T2 swap.

---

## 9. Cache, Persistence, and Retention

### 9.1 Cache strategy (T2, opt-in)
1. **LLM response cache** — optional; key = normalized request + model + prompt version + schema version + generation params + task config + evidence version; TTL + privacy rules.
2. **Retrieval/context cache** — key = source checksum + query/config fingerprint; invalidate on source change.
3. **API/UI cache** — immutable static assets cached aggressively; run state and sensitive artifacts `no-store`.
4. **Never cache** — side-effectful tool results, sandbox/test/build results as proof of fresh execution, permission decisions, final state transitions.
5. **Fallback** — Redis failure → bypass cache; queue unavailable → fail clearly or use documented inline mode; never pretend a job was queued.
6. **Observability** — record hit/miss/bypass, key version, age; never log raw sensitive keys or private prompts.

| Data / operation | Cache? | Key / invalidation |
|---|---|---|
| Static JS/CSS/images | Yes | Content hash / build version |
| Read-only run summary | Short TTL | Run ID + version marker; invalidate on event |
| Retrieved source chunks | If versioned | Source checksum + retrieval config |
| LLM output | Optional, cautious | Full key above |
| User-private inputs | Only if policy permits | Namespaced, protected, short TTL |
| Side-effect tool calls | **No** | Never replay as executed |
| Test/build/sandbox results | **No** as proof | Rerun for current files |
| Permissions / policy / final state | **No** | Evaluate from current persisted state |

### 9.2 Database growth and retention
- Indexes: `runs(status, createdAt)`, `runEvents(runId, sequence)`, `agentExecutions(runId, createdAt)`, `artifacts(runId, createdAt)`, unique `idempotency(key)`.
- Paginate events and artifacts; never return unbounded logs.
- Large content in the artifact store with checksum and bounded retention.
- TTL for cache and temp workspaces; keep run evidence for the documented period.
- Migrations only; no ad hoc schema edits. Transactions for finalization and artifact metadata.
- Track: request latency, queue wait, job duration, LLM latency/usage, cache hit/miss/bypass, error rate, retries, failed/blocked runs. A cache improvement is claimed only with a measured before/after.

---

## 10. Testing and Evaluation

### 10.1 Unit tests (P0)
Input validation (malformed, wrong types); normalization preserves IDs and handles missing values; structured output rejects missing fields and unknown enums; policy enforces routing, tools, retry limits; error categories and final-state calculation; secret redaction; output writer schema/path/encoding/count; checkpoint resume; budget guard.

### 10.2 Persistence and cache tests (P0 when enabled)
Legal state transitions and stable event order; Redis outage falls back safely; cache key changes with model/prompt/schema/source/config; TTL and invalidation; no stale side-effect or sandbox hits; duplicate API submission with same key creates one run; duplicate delivery cannot finalize twice or overwrite validated output; artifact hash matches content.

### 10.3 Integration tests (P0)
Mocked provider runs input → output end to end; provider timeout/auth/quota → controlled states; invalid model output → one correction or controlled failure; tool allow/reject; output validated after writing; one invalid record leaves others intact; trace links input → stages → evidence → output; **injection fixtures pass** (FR-031).

### 10.4 Domain tests after kickoff (P0)
Official samples become fixtures; include ordinary, boundary, ambiguous, adversarial, out-of-scope, and missing-evidence cases; evaluate the **complete** workload; keep a failure-analysis table; add a regression test for every fixed bug.

### 10.5 Evaluation method
1. Capture a baseline before tuning (and the deterministic baseline, FR-035).
2. Run all available examples with one command.
3. Compute exactly the metrics the brief/judge demands; never rely on one aggregate.
4. Inspect wrong outputs and high-risk decisions by hand.
5. Cluster failures (FR-036); fix the highest-impact cluster.
6. Change one major factor at a time.
7. Rerun the full regression suite after each significant change and `diff` against the previous run (FR-040).
8. Report real numbers with counts and caveats.

### 10.6 Release gates
All unit and integration tests pass · schema/output validation passes on the full output · no unresolved P0 defect · no secrets committed or leaked · main command works from a clean clone · full workload finishes within the deadline or reports an explicit incomplete state · README accurate · output distinguishable from fixtures · `preflight` passes.

---

## 11. Observability, Artifacts, and UX

### 11.1 Metrics (only those supported by real runs)
Completion rate; schema validity rate; task-specific accuracy/quality metrics; per-field correctness; unsafe-decision and false-escalation rates; coverage and abstention rate; evidence/retrieval coverage; provider/tool error rate; repair success rate (T3); run and per-stage duration; calls/tokens/cost only from real usage. Never invent metrics, fabricate counts, or present tiny-sample results as conclusive.

### 11.2 Required run artifacts
Final output in the exact prescribed format · evaluation summary + `metrics.json` · failure analysis and regression cases · redacted run trace · `docs/challenge-brief.md` · `docs/decisions.md` · run/setup README with pinned dependencies · genuine AI transcript if required.

### 11.3 Decision log entry format
Decision ID and timestamp · triggering problem · chosen approach · alternatives considered · supporting evidence · trade-offs and limits.

### 11.4 UX requirements (T1 / when UI exists)
Engineering workspace, not a decorative AI demo: clear hierarchy, compact logs, restrained colour; status by text/icon as well as colour; animate only real state changes; **no fake terminal output, fake activity, or fabricated percentages**; inputs, outputs, failures, evidence, and test results are the focus; escape all user, corpus, model, and tool text before HTML rendering; desktop multi-panel, mobile tabs/stacked; explicit empty, loading, error, blocked, cancelled, timed-out, and completed states.

---
## 12. Execution Plan

### 12.1 Pre-kickoff calendar (11 Oct → 24 Oct 2026)

| Dates | Sprint | Focus | Gate |
|---|---|---|---|
| Sun 11 – Mon 12 Oct | S0, S1 | Repo, pnpm workspace, `.nvmrc`, tsconfig, lint, Vitest; config loader, Zod schemas, error taxonomy, policy skeleton, `DemoAdapter`, CLI `run` on mocked agent | **G0** clean clone → `pnpm test` green |
| Tue 13 – Wed 14 Oct | S2 | LLM adapter, structured output + correction, bounded retries/timeouts, orchestrator state machine, atomic writer, checkpoint/resume, budget guard | — |
| Thu 15 – Fri 16 Oct | S3 | Eval harness, report generator, injection pack, preflight, transcript vault, trace + redaction. **Thu 15: runtime/language rules check → ADR-022 (2.5).** | **G1** T0 complete (below) |
| Sat 17 – Mon 19 Oct | S4 | **T1-lite:** run viewer over `runs/<runId>/`, polling, refresh recovery, artifact download, Playwright smoke. **T1-full** (Prisma, migrations, idempotent API, SSE, web-started runs) **only if G1 passed on time and ≥ 1 day slack** | **G2-lite** (always) / **G2-full** (if attempted) |
| Tue 20 Oct | S5 | P1 extras: baseline comparator, run diff, failure clustering, sample/dry-run, concurrency pool. **T2 (Redis/BullMQ) only if G2 passed with slack; otherwise mark Deferred** | — |
| Wed 21 – Thu 22 Oct | S6 | **Mock challenge drills** (timeboxed 6 h each, different archetypes from Appendix A). Fix foundation bugs only | — |
| Fri 23 Oct | S7 | **Freeze:** clean-clone test, remove unused modules/deps, README, templates, interview-pack scaffold, API key/quota check | **G3** foundation frozen |
| Sat 24 Oct (morning) | — | Rest. Verify event page, internet, Docker, API quota, editor, backups. No code changes after noon | — |
| Sat 24 Oct, 18:00 IST | Kickoff | Section 14 playbook | — |

If a sprint slips, cut P1 items first (S5), then T1-full, then T2, then T1-lite polish. **Never cut T0 or its tests.**

**Hard cut rule (v5.1):** if G1 is not passed by end of Fri 16 Oct, T1-full is `Deferred (G1 late)` automatically and the remaining time goes to T0 fixes and mock drills. Status checkpoint at 14 Oct: S2 (LLM adapter, orchestrator, retries) should be in progress; re-check against this table at the end of each day.

### 12.2 Gates

| Gate | Criteria |
|---|---|
| **G0** | Clean clone installs with one command; `pnpm test` passes; lint + type-check pass |
| **G1** | `pnpm agentforge run` on `DemoAdapter` yields validated output; `eval`, `report`, `preflight` work; fault-injection tests pass for every error category; injection pack passes; output rewrite never destroys last good output |
| **G2-lite** | Viewer lists runs from `runs/`, shows status, stage timeline, output and evidence, survives refresh, downloads run-scoped artifacts, shows explicit empty/error states |
| **G2-full** (only if attempted) | Web creates a run, shows live events, survives refresh, rejects duplicate submissions, downloads artifacts, cancels; PostgreSQL holds all state |
| **G3** | Two timeboxed drills finished; clean-clone run reproduced; unused code removed; README verified by following it literally |
| **G4 (Hour 3)** | One valid example produces correctly formatted output |
| **G5 (Hour 7–11)** | Full workload baseline run saved with metrics and error categories |
| **G6 (Hour 21)** | Fresh clean-clone run passes file-contract checks |
| **G7 (Hour 23)** | `preflight` passes; submission uploaded; confirmation saved |

### 12.3 The 24-hour window (kickoff Sat 24 Oct 18:00 IST → Sun 25 Oct 18:00 IST; confirm against the brief)

| Hour (IST clock) | Objective | Exit gate |
|---|---|---|
| 0–1 (18:00–19:00) | Read brief and data twice; write `challenge-brief.md`; run Section 14 playbook | Contract understood; unknowns listed; ADRs for archetype/entrypoint |
| 1–3 (19:00–21:00) | Inspect data (CH-004); implement the thinnest adapter end to end | **G4** |
| 3–7 (21:00–01:00) | Domain reasoning, retrieval, policies; contract tests | Normal cases pass and are tested |
| 7–11 (01:00–05:00) | Run full workload; save baseline metrics + error categories | **G5** |
| 11–15 (05:00–09:00) | Fix highest-impact failure clusters; add boundary/adversarial handling | Full suite reruns; `diff` shows no hidden regression |
| 15–18 (09:00–12:00) | Harden timeouts, failure handling, completeness, safety | Faults produce controlled, honest results |
| 18–21 (12:00–15:00) | Optimise only measured bottlenecks | Change measured, or decision not to optimise recorded |
| 21–23 (15:00–17:00) | Clean clone, final run, README, trace, transcript, artifacts | **G6**, then run `preflight` |
| 23–24 (17:00–18:00) | **Feature freeze.** Final verification and submit | **G7** |

**Wellbeing as engineering:** fatigue causes bugs. Plan two 20-minute breaks and real meals. If you sleep, do it right after the baseline run is saved (Hours 7–11), since the long evaluation can run meanwhile. Submit by Hour 23, not Hour 24.

### 12.4 Window rules
- No new infrastructure inside the window. If a foundation gap blocks you, fix the smallest piece and log an ADR.
- No dashboard work until a valid end-to-end result exists and G5 is saved.
- Freeze at Hour 23; after the freeze only fixes for contract violations or crashes.
- Commit at least hourly with meaningful messages.

---

## 13. AI Build Protocol (you are developing with AI)

### 13.1 Rules
1. **One sprint at a time.** Give the AI this SSOT's relevant sections and only the FR/NFR IDs for the sprint. Do not paste the whole document into every prompt.
2. **Tests first or together.** No FR is `Done` without a passing test or inspected evidence (Section 18).
3. **You review every diff.** Check for hard-coded outputs, swallowed exceptions, hard-coded keys/paths, invented metrics, fake "success" messages, unused abstractions.
4. **Run it yourself.** Never accept "tests pass" from the AI; run `pnpm test` and read the output.
5. **AI never edits this SSOT unilaterally.** Proposed spec changes are applied by you, with a Decision Log entry.
6. **Commit per sprint** with the FR IDs in the message.
7. **Save genuine transcripts** of every meaningful AI session into `docs/ai-transcript/` (FR-029). Never edit them afterwards.
8. **Understand before you merge.** If you cannot explain a module, simplify or rewrite it before the interview.
9. **Keep the AI inside the stack.** No new frameworks, databases, or providers without an ADR.
10. **Security reflex:** the AI must never be given real secrets; use `.env` locally and keep it out of prompts.

### 13.2 Sprint → deliverables

| Sprint | FR / NFR scope | Deliverable | Acceptance command |
|---|---|---|---|
| S0 | NFR-010, NFR-014, FR-001 | Monorepo, tooling, config loader | `pnpm i && pnpm test` |
| S1 | FR-002–004, 009, 012, 020, 027, 028 | Schemas, policy, error taxonomy, adapter kit, `DemoAdapter`, CLI `run` with mocked agent | `pnpm agentforge run --input fixtures/demo.json --output runs/out.json` |
| S2 | FR-007, 008, 010, 011, 013–015, 022, 033, 034 | LLM adapter, correction loop, retries, timeouts, writer, checkpoint, budget guard | `pnpm test:faults` |
| S3 | FR-016–019, 021, 029–032 | Eval, report, injection pack, preflight, vault, trace | `pnpm agentforge eval && pnpm agentforge preflight` |
| S4 | T1-lite: FR-UI-002–005, 007, 008, 010 · T1-full (P1): FR-024, 026, FR-UI-001, 006 | Run viewer + Playwright smoke; (P1) Prisma, API, idempotency, SSE | `pnpm test:e2e` (+ `pnpm test:api` if T1-full) |
| S5 | FR-035–040, FR-UI-009/011/012, (T2: FR-025) | P1 extras | `pnpm agentforge eval --baseline` |
| S6 | NFR-015 | Two drills + failure analysis docs | Drill reports in `docs/` |
| S7 | NFR-014, NFR-016 | Freeze, README, clean-clone verification | `pnpm agentforge preflight` on a fresh clone |

### 13.3 Master prompt (paste at the start of every AI session)

```text
You are helping me build AgentForge, a TypeScript (strict) evidence-driven agent engine.
Authoritative spec: AgentForge_SSOT_v5.md. Stack: pnpm monorepo, Zod, Vitest, Pino; Next.js + Prisma + PostgreSQL for the web tier.
Today's scope: Sprint <Sx>, requirements <FR ids>.
Rules: (1) implement only these requirements, (2) write tests with the code, (3) no new dependencies without asking,
(4) never hard-code expected outputs, (5) never swallow errors; map them to the FR-020 taxonomy,
(6) never print or log secrets, (7) tell me exactly what you did NOT implement or verify,
(8) end with the commands I should run to verify.
First reply with a short plan and the files you will create or change. Wait for my OK.
```

### 13.4 Per-sprint review checklist
- [ ] Every FR in scope has a test that fails when the behaviour is removed.
- [ ] No `catch {}` that hides errors; every failure maps to one error category.
- [ ] No secrets, absolute local paths, or API keys in code, logs, or fixtures.
- [ ] Output is validated after writing; no success status without validation.
- [ ] No "TODO: implement later" hidden behind a green test.
- [ ] No dependencies added beyond the sprint scope.
- [ ] I can explain the main module in two minutes without reading it.

### 13.5 Known AI failure modes to watch
Hard-coding expected results to pass tests · inventing metrics or sample counts · claiming a command ran when it did not · adding unrequested frameworks · silently truncating inputs · weakening validation to make tests pass · writing tests that only mock the thing under test · duplicating logic across CLI and web instead of using packages.

---

## 14. Kickoff Playbook (Hour 0–1)

### 14.1 Checklist
1. Read the whole brief **twice**; read supplied examples and data headers.
2. Create `docs/challenge-brief.md` (template in Appendix D): exact wording first, interpretation after.
3. List: inputs, outputs (exact filenames, schema, ordering, encoding), run command, constraints (time, tokens, allowed providers/tools/network), evaluation criteria, transcript rules, submission steps.
4. Write down **every ambiguity** and the conservative interpretation you adopt. Ask organizers only if the channel exists and the answer changes the design.
5. Choose the archetype (Appendix A) → ADR (CH-009).
6. Decide entrypoint/language compatibility (CH-010).
7. Pick the metric you will optimise = the official one (CH-006). If none is given, state your proxy explicitly.
8. Set `BATCH_MAX_DURATION_SECONDS`, `MAX_LLM_CALLS_PER_RUN`, `BATCH_CONCURRENCY` from workload size and quota.
9. Create `CH-###` requirements with tests-to-write list.
10. Start the transcript vault with the kickoff AI session.

### 14.2 Archetype decision tree
- Rows of inputs with required labels/fields? → **Classification/Triage** or **Extraction**.
- A document corpus must ground answers? → **RAG Q&A** (+ abstention).
- Multi-step actions via tools/APIs? → **Planning/Tool agent**.
- Free-text output under rules/rubric? → **Constrained generation**.
- Must generate/modify code or apps? → **Code agent (T3)** — activate Section 5.4.
- Mixed? Start with the dominant output contract; add the second as a stage.

### 14.3 Conservative-default rules
- When unsure whether to guess or abstain, follow the brief; otherwise prefer a valid, schema-correct output flagged low-confidence over a missing row.
- Never drop or reorder records.
- Never invent policy or facts absent from the supplied corpus.
- Prefer exact-match deterministic logic where rules are explicit; use the LLM where judgement is genuinely needed.

---

## 15. Submission and Interview Readiness

### 15.1 Four deliverables
1. **Code** — modular, tested, README runs from a clean clone.
2. **Agent output** — real output on the full workload, exact format, measured performance.
3. **AI transcript** — genuine, unedited, complete for the event's requirement.
4. **AI-judge interview** — you explain decisions, metrics, failures, limits.

Re-check weights and required artifacts at kickoff; do not assume them from another edition.

### 15.2 You must be able to answer (without AI help)
1. What exact problem does the agent solve, and what does it intentionally not solve?
2. What are the input and output contracts?
3. Why this model/algorithm/retrieval/tool strategy?
4. Which parts are deterministic and which depend on the model?
5. How is evidence retrieved and tied to decisions?
6. How are malformed output, prompt injection, uncertainty, and high-risk cases handled?
7. What tests and metrics ran, on how much data, with what results?
8. Which important failure remains unresolved?
9. Which alternatives were rejected and why?
10. Which code was AI-assisted and how was it verified?

**Extra drills:** What happens if the provider is down? If the output file is half-written? If a record is duplicated? How do you prevent hard-coded outputs? What would you change with another 24 hours? Why not more agents? How does cost scale with 10× records? Show one failure end to end through the trace.

### 15.3 Pre-submit checklist (automated by `preflight`, then eyeball)
- [ ] Exact required files at exact paths with exact names.
- [ ] Output schema valid; row count equals input count; IDs unique and matching; encoding correct.
- [ ] Output is not labelled `FIXTURE` or `SAMPLE`, and is newer than the last code change.
- [ ] Final command ran from a clean clone on a clean install.
- [ ] No secrets in repo, history, logs, outputs; `.env` not committed; `.env.example` present.
- [ ] Lockfile committed; Node version pinned; README commands verified literally.
- [ ] `docs/decisions.md`, `docs/failure-analysis.md`, metrics, and limitations are honest and current.
- [ ] AI transcript present, genuine, unedited, hashes intact.
- [ ] Submission uploaded; confirmation saved; time margin ≥ 30 minutes.

### 15.4 Five-minute interview demo script
1. 30 s: problem, contract, archetype. 2. 60 s: architecture diagram (control plane vs model). 3. 90 s: trace of one normal and one failure record (record inspector). 4. 60 s: metrics table with baseline vs agent and what the number does **not** show. 5. 60 s: top three limitations and what you would do next.

---

## 16. Risks and Mitigations

| Risk | Consequence | Mitigation |
|---|---|---|
| Task unknown before kickoff | Wasted pre-build | Reusable foundation only; adapter interface; drills across archetypes |
| Framework displaces task quality | Weak score | Thinnest task slice first; infra frozen at G3 |
| Invalid LLM output | Crash or invalid submission | Zod + one correction + controlled failure |
| Hallucinated facts | Wrong/unsafe answers | Grounding, abstention policy, output checks |
| Prompt injection in data | Policy override | Untrusted-text rule, policy in code, injection pack |
| Provider latency/quota/auth | Blocked run | Timeouts, categories, budget guard, no retry on auth failure |
| **API quota exhausted mid-run** | Incomplete output | Budget guard, checkpoint/resume, quota check at Hour −6, cache for repeated calls |
| **Rate limiting (429)** | Slow or failed batch | Backoff + jitter, bounded concurrency pool |
| **Network or Docker outage** | Cannot run | Offline-capable tests with mocked provider; verify environment before kickoff; keep T0 free of Docker |
| Poor retrieval | Wrong output | Measure before adding infrastructure |
| Extra agents add cost, no quality | Missed deadline | Evidence required per extra agent |
| Optimising wrong metric | Weak submission | Use the official rubric; inspect cases |
| Missing/duplicate output rows | Invalid submission | Counts, ID matching, preflight |
| Secrets leak | Security failure | Env secrets, redaction, secret scan in preflight |
| UI/sandbox eats the clock | Task unsolved | Core-first; T1-lite only by default; T1-full gated on G1 + slack; T3 only when relevant |
| **Evaluator cannot run Node/pnpm or mandates another language** | Submission cannot be run or is rejected | ADR-022 check by 15 Oct; decided shim/port path rehearsed in a mock drill (2.5) |
| Final-minute change breaks run | Failed submission | Freeze at Hour 23; clean-clone run |
| **AI hard-codes outputs / fake tests** | Disqualifying integrity issue | Section 13 review checklist; no expected outputs in code paths; own test runs |
| **Fatigue errors** | Bugs, bad decisions | Scheduled breaks; early baseline; submit by Hour 23 |
| **Environment drift on kickoff day** | Setup failure | Lockfile, pinned Node, clean-clone test on Oct 23, no upgrades after |
| Interview cannot explain code | Weak defence | Decision log, interview pack, practice walkthrough |

---

## 17. Scope Freeze and Definition of Done

### 17.1 Must ship in the foundation (before kickoff)
- [ ] T0: config, schemas, policy, orchestrator, LLM adapter, error taxonomy, writer, trace
- [ ] CLI with `run`, `eval`, `validate`, `report`, `preflight`, `transcript add` (`diff`, `demo` are P1)
- [ ] Runtime/language rules verified and recorded in ADR-022
- [ ] `ChallengeAdapter` interface + `DemoAdapter`
- [ ] Injection fixture pack and fault-injection tests
- [ ] Evaluation harness + baseline output + report generator
- [ ] Checkpoint/resume and budget guard
- [ ] T1-lite: read-only run viewer over the run directory (T1-full — PostgreSQL, API, idempotency, SSE — is P1, only if time allows)
- [ ] README, `.env.example`, pinned deps, decision log template, failure-analysis template

### 17.2 Add only if the task benefits
Corpus retrieval/RAG · tool calling · multiple agents/parallel branches · dashboard polish · run history · usage dashboard · pgvector/embeddings · browser automation · T2 Redis/BullMQ.

### 17.3 Code-Building Profile only
Requirements/Architect agents · Developer file generation + safe workspace writer · sandbox with allowlisted commands · QA interpretation + bounded repair loop · file viewer, final report, ZIP export · optional reviewer/preview.

### 17.4 Do not build in the 24 h window
Multi-user collaboration, billing, subscriptions, unrestricted shell, arbitrary package installs, auto-deployment, agent marketplace, enterprise controls, unrelated features.

### 17.5 Definition of Done (ready to submit)
**Contract and function**
- [ ] Exact instructions and artifact paths captured
- [ ] All required inputs processed or clearly reported incomplete
- [ ] Output schema, labels, order, cardinality, encoding validated
- [ ] Normal and relevant edge cases handled
- [ ] Retrieval/tools used only where needed and inspectable

**Reliability and safety**
- [ ] Invalid output cannot silently pass
- [ ] Retries/timeouts terminate within limits
- [ ] Provider/tool failures distinct from task-result failures
- [ ] Uncertain and high-risk cases follow explicit policy
- [ ] No secrets or unapproved artifacts included
- [ ] Generated code, if any, ran only in the sandbox

**Evidence and evaluation**
- [ ] Full workload or required test set ran
- [ ] Metrics computed from real results and labelled accurately
- [ ] Failure analysis exists; regression tests added for fixes
- [ ] Outputs traceable to inputs and evidence
- [ ] No fixture/simulation passed off as a real run

**Delivery and defence**
- [ ] Fresh setup works; final output at exact path with right schema/count
- [ ] Source, README, output, and genuine AI transcript present
- [ ] Limitations and unresolved failures documented
- [ ] I can explain architecture, choices, metrics, failures, trade-offs unaided

---

## 18. Governance

1. Never change P0 behaviour in code without updating this SSOT.
2. Log significant changes in `docs/decisions.md` with rationale and evidence.
3. After kickoff, add a challenge section with `CH-###` entries: source instruction, implementation, test, acceptance evidence.
4. If an official challenge requirement conflicts with a generic feature, the official requirement wins for the submission; **safety, truthful reporting, and no-secrets rules stay mandatory**.
5. Not applicable → `N/A (why)`. Cut → `Deferred (why)`; never delete without a decision record.
6. `Done` requires test or inspection evidence, never AI claims alone.
7. Bump the version and date of this file whenever it changes.

---

## 19. Decision Log

| ID | Decision | Rationale |
|---|---|---|
| ADR-001 | AgentForge is the codename for an evidence-driven agent engine | Keeps identity while serving the contest strategy |
| ADR-002 | The Orchestrate task is not assumed before kickoff | Avoids pre-building the wrong domain |
| ADR-003 | TypeScript, Next.js UI/API, PostgreSQL baseline | Shared types, less duplication, durable state |
| ADR-004 | One strong agent is acceptable; multi-agent is optional | Extra agents only when measured better or required |
| ADR-005 | Deterministic policy/schema/output validation is mandatory | Model never defines its permissions or judges itself |
| ADR-006 | Evaluation and failure analysis are P0 | Observable performance beats architectural size |
| ADR-007 | Coding workspace is a conditional profile | Must not distract from the real task |
| ADR-008 | No unrestricted host execution | Generated code is untrusted |
| ADR-009 | Submission output and transcript must be genuine | Integrity and reproducibility |
| ADR-010 | Final status derives from actual evidence | Prevents false success claims |
| ADR-011 | PostgreSQL is the authoritative database | Transactions and relational integrity |
| ADR-012 | Redis is cache/queue/limits only | Can be flushed without data loss |
| ADR-013 | Cache only safe, versioned, measurable work | No stale or unsafe results as fresh evidence |
| ADR-014 | TypeScript is the canonical language | Shared contracts for a solo builder |
| **ADR-015** | **Core-first: packages are the product; CLI is mandatory P0; web is a second adapter** | Resolves web-first vs CLI-first conflict (C1); evaluators run commands |
| **ADR-016** | **Redis/BullMQ is T2/P1; default `JOB_RUNNER=inline`; idempotency and exactly-once finalization live in PostgreSQL** | Resolves C2; removes infra risk from the critical path |
| **ADR-017** | **Everything P0 is built before kickoff; the 24 h window builds only the challenge adapter** | Resolves C10; protects the solo timeline |
| **ADR-018** | **Separate `MAX_TRANSIENT_RETRIES`, `MAX_SCHEMA_CORRECTIONS`, `MAX_REPAIR_ATTEMPTS`** | Resolves C6 ambiguity |
| **ADR-019** | **Genuine transcript vault with hash verification (FR-029)** | Transcripts are an evaluated signal; tamper evidence supports honesty |
| **ADR-020** | **Preflight checker is mandatory before submission (FR-032)** | Prevents format, count, and secret mistakes at the last minute |
| **ADR-021** | **T1-lite (file-based read-only viewer) is the default web scope; T1-full (PostgreSQL, idempotent API, SSE, web-started runs) is P1. ADR-011 applies to T1-full.** | Scope vs. four judged signals (1.2); protects mock drills. *Revertible if the brief requires a web service.* (14 Oct) |
| **ADR-022** | **Verify official runtime/language rules by 15 Oct and record the outcome** | Shim in 2.5 assumes Node is available to the evaluator (14 Oct) |
| **ADR-023** | **T0 starts with 7 packages (4.2 start-set); others created only when used** | Reduces solo overhead; consistent with "create only modules the slice uses" (14 Oct) |
| **ADR-024** | **One CLI command list: P0 = run, eval, validate, report, preflight, transcript add; P1 = diff, demo; sampling is a flag** | Removes inconsistency across FR-027, 4.2, 8.1 (14 Oct) |

### 19.1 Requirement traceability (fill during build)

| Group | IDs | Tier | Sprint | Test location | Status |
|---|---|---|---|---|---|
| Config/ingest/normalize | FR-001–003 | T0 | S0–S1 | tests/unit | Todo |
| Contract/context/retrieval | FR-004–006 | T0 | S1 / kickoff | tests/unit, fixtures | Todo |
| Reasoning/structure/policy/tools | FR-007–011 | T0 | S1–S2 | tests/unit, integration | Todo |
| Workflow/retry/timeout/writer | FR-012–015, 022 | T0 | S1–S2 | tests/integration, faults | Todo |
| Evaluation/trace/repro/errors/packaging | FR-016–021 | T0 | S3 | tests/unit, e2e | Todo |
| Demo mode | FR-023 | T0 | S5 | tests/unit | Todo |
| Persistence/idempotency | FR-024, 026 | T1 | S4 | tests/api | Todo |
| Cache | FR-025 | T2 | S5 (optional) | tests/integration | Deferred? |
| Hackathon additions | FR-027–040 | T0 | S1–S5 | tests/* | Todo |
| Web workspace | FR-UI-001–012 | T1-lite (default) / T1-full (P1) | S4–S5 | tests/e2e | Todo |
| Code profile | FR-CODE-001–014 | T3 | on activation | tests/security | Deferred |
| Challenge adapter | CH-001–010 | T0 | kickoff | tests/fixtures | At kickoff |

---

## Appendix A — Archetype Playbooks

| Archetype | Pipeline | Key metrics | Common failures | Must-have tests |
|---|---|---|---|---|
| **Classification / triage** | parse → normalize → retrieve policy/context → LLM decision with enum schema → policy gates (high-risk escalation) → validate → write | Per-field accuracy, macro-F1, escalation precision/recall, coverage | Label drift, over-escalation, invented policy | Every enum value, ambiguous cases, injection in text, missing evidence |
| **RAG Q&A** | ingest/chunk → BM25/FTS retrieval → grounded answer with citations → verify citations exist in corpus → abstain if unsupported | Answer correctness, citation accuracy, abstention correctness, hallucination rate | Unsupported claims, wrong chunk, citation to nothing | Out-of-corpus questions, conflicting sources, injected instructions in documents |
| **Extraction / structuring** | schema-first extraction → per-field validators → null/unknown policy → normalize → write | Per-field precision/recall, null-handling accuracy | Hallucinated fields, format drift | Missing fields, multiple values, odd formats |
| **Planning / tool agent** | goal → plan (bounded steps) → allowlisted tool calls → verify each result → final answer + trace | Task success rate, invalid tool call rate, steps used | Loops, unauthorized tools, trusting tool output | Tool failure, tool-output injection, step-budget exhaustion |
| **Constrained generation** | context → draft → rule/rubric checks (length, banned content, groundedness) → bounded revision → validate | Rubric pass rate, groundedness, constraint violations | Ignoring constraints, drifting facts | Boundary lengths, forbidden content, adversarial prompts |
| **Code agent (T3)** | Section 5.4 workflow | Check pass rate, repair success rate | Fake pass claims, sandbox gaps | Path traversal, failing builds, timeout cleanup |

---

## Appendix B — Core Interfaces (TypeScript sketch)

```ts
export type RunStatus =
  | 'queued' | 'running' | 'waiting_for_provider' | 'repairing' | 'cancelling'
  | 'succeeded' | 'succeeded_with_warnings' | 'failed' | 'blocked' | 'cancelled' | 'timed_out';

export type CheckStatus = 'passed' | 'failed' | 'blocked' | 'timed_out' | 'not_run' | 'skipped';

export type ErrorCategory =
  | 'CONFIG_INVALID' | 'INPUT_INVALID' | 'SCHEMA_INVALID' | 'LLM_TIMEOUT' | 'LLM_RATE_LIMITED'
  | 'LLM_AUTH_FAILED' | 'LLM_INVALID_OUTPUT' | 'RETRIEVAL_FAILED' | 'TOOL_NOT_ALLOWED'
  | 'TOOL_FAILED' | 'OUTPUT_INVALID' | 'EVALUATION_FAILED' | 'BUDGET_EXCEEDED'
  | 'SANDBOX_UNAVAILABLE' | 'DUPLICATE_RUN' | 'CANCELLED_BY_USER' | 'RUN_TIMED_OUT' | 'INTERNAL_ERROR';

export interface RecordResult<TOut> {
  recordId: string;
  status: CheckStatus;
  output?: TOut;
  evidenceRefs: string[];
  error?: { category: ErrorCategory; message: string };
  attempts: number;
  durationMs: number;
  modelId?: string;
  promptVersion?: string;
}

export interface ChallengeAdapter<TIn, TCtx, TDecision, TOut> {
  readonly id: string;
  readonly version: string;
  parseInput(raw: string | Buffer): { records: TIn[]; batchErrors: string[]; recordErrors: { id?: string; row?: number; message: string }[] };
  recordId(rec: TIn): string;
  normalize(rec: TIn): TIn;
  buildContext(rec: TIn, deps: AdapterDeps): Promise<TCtx>;
  decide(rec: TIn, ctx: TCtx, deps: AdapterDeps): Promise<TDecision>;   // may call LLM via deps.llm only
  toOutput(rec: TIn, decision: TDecision): TOut;
  validateOutput(outputs: TOut[], inputs: TIn[]): { ok: boolean; problems: string[] };
  writeOutput(outputs: TOut[], path: string): Promise<void>;           // core wraps this in atomic write + revalidation
  evaluate?(outputs: TOut[], expected: unknown): Promise<Record<string, number | 'unavailable'>>;
}

export interface JobRunner {
  enqueue(runId: string): Promise<void>;     // inline runner: detached task; BullMQ runner: queue job with ID = runId
  cancel(runId: string): Promise<void>;
}
```

---

## Appendix C — Prisma Schema Sketch (T1)

```prisma
model Run {
  id            String   @id @default(cuid())
  status        String                       // RunStatus
  adapterId     String
  inputHash     String
  configJson    Json                          // non-secret snapshot
  codeVersion   String                        // git SHA
  idempotencyKey String? @unique
  errorCategory String?
  createdAt     DateTime @default(now())
  startedAt     DateTime?
  finishedAt    DateTime?
  events        RunEvent[]
  stages        StageExecution[]
  artifacts     Artifact[]
  usage         UsageRecord[]
  @@index([status, createdAt])
}

model RunEvent {
  id        String   @id @default(cuid())
  runId     String
  sequence  Int
  type      String
  payload   Json
  createdAt DateTime @default(now())
  run       Run      @relation(fields: [runId], references: [id])
  @@unique([runId, sequence])
}

model StageExecution {
  id String @id @default(cuid())
  runId String
  recordId String?
  stage String
  status String
  errorCategory String?
  attempts Int @default(1)
  durationMs Int?
  modelId String?
  promptVersion String?
  createdAt DateTime @default(now())
  run Run @relation(fields: [runId], references: [id])
  @@index([runId, createdAt])
}

model Artifact {
  id String @id @default(cuid())
  runId String
  kind String
  objectKey String
  sizeBytes Int
  sha256 String
  contentType String
  createdAt DateTime @default(now())
  run Run @relation(fields: [runId], references: [id])
  @@index([runId, createdAt])
}

model UsageRecord {
  id String @id @default(cuid())
  runId String
  modelId String
  inputTokens Int?
  outputTokens Int?
  latencyMs Int
  cacheHit Boolean @default(false)
  createdAt DateTime @default(now())
  run Run @relation(fields: [runId], references: [id])
}
```

Finalization guard (pseudo-SQL): `UPDATE "Run" SET status=$final, "finishedAt"=now() WHERE id=$id AND status NOT IN ('succeeded','succeeded_with_warnings','failed','blocked','cancelled','timed_out')` — proceed only if exactly one row changed.

---

## Appendix D — Templates

### D.1 `docs/challenge-brief.md`
```markdown
# Challenge Brief (written at kickoff)
## 1. Original wording (verbatim, do not paraphrase)
## 2. Inputs (files, formats, sizes)
## 3. Required outputs (exact paths, filenames, schema, order, encoding)
## 4. Run/submit instructions and time limits
## 5. Constraints (providers, tools, network, tokens)
## 6. Evaluation criteria and transcript rules
## 7. Ambiguities and the conservative interpretation chosen
## 8. Archetype (Appendix A) and ADR links
## 9. CH-### requirements with tests to write
```

### D.2 Decision entry (`docs/decisions.md`)
```markdown
## ADR-0xx — <title>   (<date time IST>)
Problem: …
Decision: …
Alternatives: …
Evidence: …
Trade-offs / limits: …
```

### D.3 `docs/failure-analysis.md`
```markdown
| Run | Category | Count | Example IDs | Root cause | Fix | Regression test | Metric delta |
|---|---|---|---|---|---|---|---|
```

### D.4 Run report fields (FR-030)
Run ID · status · input hash · git SHA · config snapshot · counts (total, succeeded, failed, abstained, blocked) · per-stage durations · error categories · metrics (or `unavailable`) · baseline comparison · top failure clusters · checks `not_run` and why · limitations.

---

## Appendix E — References
- [Official HackerRank Orchestrate October '26 page](https://www.hackerrank.com/hackerrank-orchestrate-october26) — event timing and process (last checked by owner 9 Oct 2026; **re-check at kickoff**).
- [HackerRank: Getting better at Orchestrate](https://www.hackerrank.com/blog/getting-better-at-orchestrate/) — preparation guidance (published 24 Jul 2026).
- Supersedes: `AgentForge_Final_Single_Source_of_Truth` v4.0 and `AgentForge_Full_Development_Plan`.

---

**Final product rule:** Build the smallest agent that solves the actual task, prove its behaviour with repeatable evaluation, make failure modes explicit, and submit exactly what the challenge asks for. AgentForge's value is evidence-backed performance — not the number of agents, the size of the architecture, or the polish of a dashboard.
