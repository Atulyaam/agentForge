# AgentForge

> Evidence-driven agent engine for the HackerRank Orchestrate October '26 hackathon.
> Authoritative specification: `AgentForge_SSOT_v5.1.md`.

---

## Quick Start

```bash
# Prerequisites: Node.js 20+, pnpm 9+
nvm use            # or ensure Node 20+
pnpm install

# 1. Environment configuration (safe mock simulation active by default)
cp .env.example .env

# 2. Run full verification suite
pnpm test          # 137 unit and integration tests across 11 test suites
pnpm test:e2e      # 19 Playwright/API tests for Web Run Viewer
pnpm typecheck     # Strict TypeScript typechecking across monorepo
pnpm build         # Production build of all packages and web viewer
pnpm agentforge preflight  # Pre-submit security and integrity checklist

# 3. Execute demo workload
pnpm agentforge run --input fixtures/demo.json --output runs/demo-out.json

# 4. Run baseline evaluation
pnpm agentforge eval --baseline

# 5. Run S6 mock challenge drills (Classification & RAG with Abstention)
pnpm agentforge drill all

# 6. Launch Web Run Viewer
pnpm --filter web dev
# Open http://localhost:3000 to inspect runs, event timeline, and artifacts
```

---

## Architecture

```
packages/
  shared/        — Types, constants, safe error taxonomy (FR-020), secret redaction
  schemas/       — Zod schemas for all boundaries + environment config loader
  policies/      — Tool allowlist, retry bounds, state transitions, abstention policy
  llm/           — LLM provider adapter, budget guard, structured output + 1-shot repair
  orchestrator/  — Deterministic state machine, retries, atomic writer, checkpoint/resume, concurrency pool
  adapter-kit/   — ChallengeAdapter interface, DemoAdapter, TriageAdapter, RagAdapter
  evaluation/    — Metrics engine, heuristic baseline comparator, failure clustering, report generator

apps/
  cli/           — CLI adapter (pnpm agentforge <command>)
  web/           — T1-lite Web Run Viewer (Next.js read-only inspector over runs/<runId>/)
```

---

## Ten Engineering Principles

1. Evidence over assertion (no self-reported success without independent proof)
2. Minimal useful agent architecture (no bloated, unmetered multi-agent frameworks)
3. Deterministic control plane (state machine, concurrency pool, retry limits)
4. Bounded autonomy (strict deadlines and token/call budgets)
5. Failure containment per record (row errors never crash the batch)
6. Reproducibility (pinned dependencies, locked schemas, deterministic mock drills)
7. Challenge-first (build only what directly addresses the challenge criteria)
8. Honest reporting (never misrepresent synthetic mocks as live model performance)
9. Security by default (secret redaction, directory traversal blocks, injection resilience)
10. Interview readiness (structured traces, transparent failure analysis, audit packs)

---

## CLI Command Surface

| Command | Description |
|---|---|
| `pnpm agentforge run` | Execute a workload through the active adapter |
| `pnpm agentforge run --sample N` | Run on a small deterministic sample of records |
| `pnpm agentforge run --dry-run` | Validate wiring, input, and context with 0 LLM calls |
| `pnpm agentforge eval` | Run evaluation harness on completed runs |
| `pnpm agentforge eval --baseline` | Compare agent output against deterministic heuristic baseline |
| `pnpm agentforge diff <runA> <runB>` | Compare outputs, metrics, and regressions between two runs |
| `pnpm agentforge drill [1\|2\|all]` | Run S6 mock challenge drills (Triage & RAG Q&A with Abstention) |
| `pnpm agentforge package` | Package & validate submission deliverables (Code ZIP, output, transcript) |
| `pnpm agentforge interview-pack` | Generate 5-minute interview script and audit answers |
| `pnpm agentforge validate` | Validate output against adapter output schema |
| `pnpm agentforge report <runId>` | Generate a markdown report for a run |
| `pnpm agentforge preflight` | Run pre-submission security, lockfile, and integrity checks |
| `pnpm agentforge transcript add <f>` | Add an immutable AI session transcript to the vault |

---

## License

Private — Hackathon project.
