# Challenge Brief — Template (To be completed at Kickoff)

> Authoritative challenge specification for HackerRank Orchestrate October '26.
> Fill this document immediately upon receipt of the challenge email/brief at **Sat 24 Oct 2026, 18:00 IST**.
> Reference: `AgentForge_SSOT_v5.1.md` Section 14 and Appendix D.1.
> **Status:** PENDING_KICKOFF (Expected Sat 24 Oct 2026, 18:00 IST)

---

## 1. Original Challenge Wording (Verbatim)

> Copy and paste the official brief below without editing, omitting, or paraphrasing words.

```text
[PASTE EXACT CHALLENGE TEXT HERE FROM EMAIL / PLATFORM AT HOUR 0]
```

---

## 2. Interpreted Inputs & Datasets

- **Input File Name(s):** (e.g. `input.json`, `data.csv`, `corpus/`)
- **Location in Repo:** `fixtures/challenge/input.json`
- **Format & Encoding:** (e.g. UTF-8 JSON array of objects, CSV with header row)
- **Dataset Size / Volume:**
  - Total records: `[N]` records
  - Sample size for smoke testing: `[e.g. 5–10]` records (`pnpm agentforge run --sample 5`)
  - Maximum row/field character length:
- **Field Inventory:**
  | Field Name | Type | Required | Description / Allowed Values |
  |---|---|---|---|
  | `id` | string | Yes | Unique record identifier |
  | `...` | ... | ... | ... |

---

## 3. Required Outputs & Deliverables

- **Output File Path & Name:** `runs/<runId>/output.json` (or exact specified submission filename)
- **Output Schema & Format:**
  ```json
  [
    {
      "id": "string",
      "result": "..."
    }
  ]
  ```
- **Ordering Constraint:** Strict 1:1 input ordering preserved? (Yes / No)
- **Cardinality Constraint:** Exactly N output records for N input records? (Yes / No)
- **Packaging Format:** (ZIP archive of code + output file + AI transcript)
- **Published Size Limits:** (e.g. max 50MB per file, max 100MB ZIP)

---

## 4. Explicit Constraints & Non-Goals

### Hard Constraints
- **Maximum Execution Time:** (e.g. batch run must complete in under 30 minutes)
- **Allowed LLM Providers / Models:** (e.g. OpenAI GPT-4o, Anthropic Claude 3.5 Sonnet, local/offline)
- **Token / API Call Quota:** (e.g. max 500 calls per run or $5.00 cost limit)
- **Network / Tool Restrictions:** (e.g. offline-only, bounded local retrieval, allowlisted API calls)

### Explicit Non-Goals (What We Intentionally Do NOT Build)
- No unmetered multi-agent open-ended loops.
- No heavy external vector database unless the corpus is > 10,000 documents and lexical retrieval fails.
- No distributed queues (Redis/BullMQ) during the 24h window.

---

## 5. Acceptance Criteria & Evaluation Metrics

- **Primary Judged Metric:** (e.g. F1-score, accuracy, grounded citation rate, execution speed)
- **Optimization Proxy:** (The exact mathematical proxy formula optimized by our adapter)
- **Secondary Quality Targets:**
  - Zero unhandled exceptions (`FR-020` error taxonomy mapping).
  - 100% schema validity after bounded 1-shot repair.
  - Zero fabricated citations on ungrounded questions.

---

## 6. Edge Cases, Adversarial Inputs & Safety Risks

- **Boundary / Malformed Cases:** Missing fields, empty strings, null values, unicode homoglyphs.
- **Uncertainty Policy:** Confidence threshold below which explicit abstention or neutral label is required.
- **Prompt Injection Defense:** Untrusted user input containing instructions (e.g. `SYSTEM OVERRIDE`, `Ignore instructions`).
  - *Enforcement:* Input placed strictly in user prompts; code-level deterministic policy gate overrides LLM if critical security/safety triggers match.

---

## 7. Baseline Approach & Test Strategy

- **Rule-Based / Heuristic Baseline:** (e.g. keyword dictionary matcher, sentence extractor)
- **Comparative Evaluation Command:** `pnpm agentforge eval --baseline`
- **Target Lift:** Agent must demonstrate measurable statistical lift over baseline to justify LLM cost/latency.

---

## 8. Resource Budgets & Configuration Settings

Configure in `.env` before running:
- `MAX_LLM_CALLS_PER_RUN`: `[Calculate: N_records * 1.2]`
- `BATCH_CONCURRENCY`: `[e.g. 4 or 8]`
- `MAX_RUN_DURATION_SECONDS`: `[e.g. 900]`
- `BATCH_MAX_DURATION_SECONDS`: `[e.g. 3600]`
- `MAX_TRANSIENT_RETRIES`: `2`
- `MAX_SCHEMA_CORRECTIONS`: `1`

---

## 9. Ambiguities & Conservative Interpretation Chosen

| Ambiguity in Brief | Interpretation Adopted | Operational Justification |
|---|---|---|
| *e.g. Unclear if missing fields can be dropped* | *Never drop records; emit low-confidence fallback or abstain with record error* | *Preserves 1:1 input-output cardinality* |
| *e.g. Abstract metric definition* | *Use exact harmonic mean F1 across valid labels* | *Aligns with standard evaluation practice* |

---

## 10. Archetype Selection & ADR Link

- **Selected Archetype:** `[Classification/Triage | RAG Q&A with Abstention | Extraction | Planning/Tool | Code]`
- **Mapped Adapter Interface:** `ChallengeAdapter<TInput, TOutput, TContext, TDecision>`
- **ADR Reference:** Logged in `docs/decisions.md` under `ADR-030` (or challenge-specific ID).
- **Associated Challenge Requirements:** `CH-001` through `CH-005` with test files to write.
