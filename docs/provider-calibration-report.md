# AgentForge — Provider Validation and Calibration Report

**Status:** PENDING (Offline Safe Mode by Default)  
**Date:** 18 October 2026  
**Target Event:** HackerRank Orchestrate (Kickoff: 24 October 2026, 18:00 IST)  
**Branch:** `prep/kickoff-readiness`  

---

## 1. Executive Summary & Verification Boundaries

AgentForge enforces strict boundaries between local deterministic testing, mock regression verification, and live model provider interactions.

- **Offline by Default:** All default builds, unit tests, integration tests, E2E tests, CLI preflight, doctor, and mock challenge drills run 100% offline using `MockLLMProvider` or local heuristic baselines. Zero network calls to frontier providers are permitted during CI or standard test suites.
- **Explicit Live Opt-In:** Live network requests require the explicit `--live` flag and a valid `LLM_API_KEY`. Without both, all live commands return `PENDING` with actionable configuration instructions.
- **Deterministic Budget Controls:** Control-plane `BudgetGuard` ceilings are enforced prior to network dispatch (`--max-calls 1` for smoke tests, `--max-calls 3` per adapter for calibration).
- **Separation of Evidence:** Passing unit tests does not establish live-provider reachability; passing a smoke test does not establish model accuracy; and a 3-record calibration sample is not a benchmark of general model capability.

---

## 2. Readiness Status Matrix

AgentForge maintains separate, honest statuses across all evaluation dimensions. The submission gate (`pnpm agentforge readiness`) evaluates these independently:

| Dimension | Status | Evidence / Verification | Action Required at Kickoff |
| :--- | :---: | :--- | :--- |
| **1. Local Engineering Checks** | **PASS** | 219 unit/integration tests passed; 19 web E2E tests passed; TypeScript compiler passed (`tsc -b`); Web build completed successfully. | Maintain clean tree. |
| **2. Mock Regression Suite** | **PASS** | `drill-1-triage` and `drill-2-rag` executed deterministically; isolated ground-truth verified; traces persisted in `/runs/`. | None. Baseline established. |
| **3. Live Provider Smoke Test** | **PENDING** | Native `LiveHttpLLMProvider` implemented with OpenAI-compatible chat format; structured probe schema validated; credentials unconfigured in CI. | Run `pnpm agentforge provider-smoke --live --max-calls 1` once key is set. |
| **4. Real-Model Calibration** | **PENDING** | Calibration engine implemented for `support-triage` and `policy-rag`; evaluates against separately stored ground truth; pending live execution. | Run `pnpm agentforge calibrate --live --sample 3 --max-calls 3`. |
| **5. Official Challenge Brief** | **PENDING** | Contest brief expected 24 Oct 2026 18:00 IST. Pluggable output format validators (`json`, `jsonl`, `csv`, `text`) ready. | Ingest brief into `fixtures/challenge/`. |
| **6. Authentic Chat Transcript** | **BLOCKED** | Vault ledger (`docs/ai-transcript/INDEX.md`) initialized. Genuine conversation export pending live pairing session. | Register exported session: `pnpm agentforge transcript add <file>`. |
| **7. Final Submission Gate** | **BLOCKED** | Submission gate fails closed: requires all real submission deliverables (valid code ZIP, valid output, authentic transcript, verified limits). | Full clearance after live challenge execution. |

> [!IMPORTANT]
> Final Submission Readiness is reported as **`BLOCKED`**. In accordance with contest integrity and engineering rigor, readiness will not be reported as `READY` until an authentic exported chat transcript is imported and real challenge outputs are produced.

---

## 3. Architecture & Operational Safeguards

### 3.1 Live Provider Adapter (`LiveHttpLLMProvider`)
- **Zero Third-Party SDK Overhead:** Built on native Node `fetch` with standard `AbortController` timeouts (default: 30,000 ms), mapping timeout explicitly to `LLM_TIMEOUT`.
- **OpenAI-Compatible Chat Protocol:** Interoperable with OpenAI, Azure OpenAI, OpenRouter, and local OpenAI-compatible proxies (e.g. vLLM, Ollama) that adhere to the standard `/chat/completions` payload and response contract.
- **Vendor Compatibility & Response-Shape Constraints:**
  - *OpenAI (`https://api.openai.com/v1`):* Fully compliant with standard bearer authentication.
  - *OpenRouter (`https://openrouter.ai/api/v1`):* Supported via `baseUrl` normalization; supports `customHeaders` for ranking/identification (`HTTP-Referer`, `X-Title`).
  - *Azure OpenAI / Custom Gateways:* Supported when configured to expose standard `/chat/completions` endpoints. Note: Gateways requiring custom deployment URL query parameters (`api-version=...`) must specify the full path in `baseUrl`.
  - *Response Shape Guarantee:* The provider requires `choices[0].message.content` (string) and gracefully handles empty choices. Providers omitting `usage` will report token metrics as `'unavailable'`. Non-JSON or HTML gateway error bodies (e.g. Cloudflare 502) are safely intercepted and classified as `LLM_INVALID_OUTPUT` or `INTERNAL_ERROR` with credential redaction.
- **Credential Protection:** Headers use `Authorization: Bearer <key>`. All error responses and log traces scrub keys matching `/sk-[a-zA-Z0-9_-]{20,}/` and other high-entropy token signatures.
- **Accurate Token Reporting:** Directly extracts provider-reported `usage.prompt_tokens` and `usage.completion_tokens`. If the provider omits usage fields, counts are reported as `'unavailable'`—**never** guessed or converted from character counts.

### 3.2 Smoke Test Architecture (`pnpm agentforge provider-smoke`)
- **Probe Design:** Executes a single model invocation requesting structured JSON matching `SmokeProbeSchema`:
  ```json
  {
    "status": "ok",
    "engine": "agentforge-smoke-probe",
    "timestamp": "<iso-timestamp>"
  }
  ```
- **Zero Retries:** Fails fast immediately if network, auth, or schema validation fails.
- **Audit Artifact:** Results are persisted to `runs/smoke/smoke-report.json` with all credentials, authorization headers, and private data fully redacted.

### 3.3 Calibration Engine (`pnpm agentforge calibrate`)
- **Bounded Sample Ceiling:** Defaults to 3 records per adapter (`support-triage` and `policy-rag`), capped strictly at 6 total calls.
- **Isolated Ground Truth:** Evaluates candidate outputs against separately stored expected outcomes (`fixtures/drill-1-triage/tickets-expected.json` and `fixtures/drill-2-rag/questions-expected.json`).
- **Prompt Isolation:** Evaluator-only ground-truth labels and scoring rules are **never** present in runtime prompts, retrieved context, or tool arguments.
- **Defensible Metrics:**
  - Schema validity rate (proportion of records strictly conforming to output Zod schema).
  - Exact-match accuracy against ground-truth labels.
  - Abstention validity (ensuring no hallucinated citations or unsupported answers).
  - Observed per-record latency (ms).
  - Actual provider-reported token consumption.
- **Canonical Drill Report Isolation:** Results are persisted to `docs/calibration-report.md` and `runs/calibration/calibration-report.json`. Canonical mock-drill reports (`docs/drill-1-report.md`, `docs/drill-2-report.md`) remain untouched.

---

## 4. Statistical Boundary Disclosure

> [!WARNING]
> **Sample Size Limitations:** Calibration on a 3-record sample per adapter is solely an operational probe designed to verify:
> 1. Protocol compatibility with the active LLM endpoint.
> 2. Structured JSON compliance under real frontier model inference.
> 3. Execution latency and token accounting under production conditions.
>
> **A 3-record calibration MUST NOT be cited or construed as a statistically significant benchmark or proof of general task accuracy.** No prompts, schemas, or orchestration rules are automatically modified based on small calibration samples.

---

## 5. Operator Runbook: Performing Live Validation

When ready to test live provider connectivity:

### Step 1: Configure Environment Variables
Set real provider credentials in `.env` (or your shell environment):
```bash
export LLM_API_KEY="<your-provider-api-key>"
export LLM_MODEL="gpt-4o"
export LLM_BASE_URL="https://api.openai.com/v1" # Optional, defaults to OpenAI
```

### Step 2: Run Live Provider Smoke Test
```bash
# Exactly 1 call, zero automatic retries, strict timeout
pnpm agentforge provider-smoke --live --max-calls 1
```
*Expected Output:*
- Prints provider & model ID.
- Prints elapsed latency in milliseconds.
- Reports JSON schema conformance.
- Persists redacted report to `runs/smoke/smoke-report.json`.

### Step 3: Run Bounded Calibration
```bash
# Bounded to 3 records per adapter (6 calls total)
pnpm agentforge calibrate --live --sample 3 --max-calls 6
```
*Expected Output:*
- Prints pre-execution call budget ceiling.
- Executes bounded sample against `support-triage` and `policy-rag`.
- Evaluates against isolated ground truth.
- Generates `docs/calibration-report.md` and `runs/calibration/calibration-report.json`.

### Step 4: Verify Readiness
```bash
pnpm agentforge readiness
```
Confirm that:
- `live_smoke` reflects `PASS`.
- `live_calibration` reflects `PASS`.
- `authentic_transcript` reminds operator to import genuine pairing conversation before packaging.
