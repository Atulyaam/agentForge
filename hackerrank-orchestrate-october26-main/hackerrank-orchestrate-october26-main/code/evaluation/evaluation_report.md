# Comprehensive Evaluation Report: Ghost Data Still Exists
**HackerRank Orchestrate — October 2026**

## 1. Executive Summary & Audit Overview
The **Ghost Data Still Exists** challenge requires auditing 518 production privacy deletion requests (`case_33` through `case_550`) against a multi-modal distributed enterprise evidence repository containing 94 evidence files across databases, SQL snapshot replicas, central observability logs, service readback logs, customer handover text files, PDF documents, and image artifacts.

The solution was evaluated against the public sample benchmark (`dataset/sample_output.csv` with 32 sample cases `case_01` through `case_32`) and tested on three custom edge cases.

---

## 2. Public Sample Benchmark Evaluation

The public sample suite consists of 32 real-world privacy deletion cases spanning:
- Direct clean deletions (`COMPLETE`)
- Incomplete deletions with residual profile data in search, support, export, or secondary stores (`INCOMPLETE`)
- Active connector synchronizations and data flows (`INCOMPLETE`)
- Unblocked backup restore risks (`INCOMPLETE`)
- Retention of permitted compliance audit records (`COMPLETE` / `INCOMPLETE`)
- Tombstoned identities with unredacted PII (`INCOMPLETE`)

### Exact Evaluation Metrics & Denominators

| Metric | Accuracy / Precision | Matching Count / Denominator | Description |
| :--- | :--- | :--- | :--- |
| **Case-Level Status Accuracy** | **100.0%** | **32 / 32 cases** | Correct classification of `COMPLETE`, `INCOMPLETE`, and `NOT_APPLICABLE` across all sample requests. |
| **Step-Level Matching Accuracy** | **68.4%** | **132 / 193 steps** | Exact step matches across phase, system, resource, operation, state, and evidence citations. |
| **Field-Level Precision** | **79.3%** | **918 / 1,158 fields** | Exact match across all 6 step attributes: `phase`, `system_id`, `resource_id`, `operation`, `state`, `evidence_id`. |
| **Exact Sequence Accuracy** | **31.2%** | **10 / 32 cases** | Full end-to-end identical sequence of steps matching the public reference answers. |

*Note: Denominators represent the ground truth totals in `dataset/sample_output.csv` (32 cases, 193 total steps, 1,158 step-attribute fields).*

---

## 3. Custom Evaluation Test Cases

Three independent custom evaluation test cases were designed and executed to validate behavior under critical edge cases:

### Custom Case 1: Non-Deletion Intent (Marketing Opt-Out Request)
- **Request ID**: `custom_01`
- **Request Text**: *"Please unsubscribe me from marketing emails only, leave the account active and do not close the account."*
- **Audit Cutoff**: `2026-08-05T10:00:00Z`
- **Expected Status**: `NOT_APPLICABLE`
- **Expected Steps**: `[]`
- **Result**: `NOT_APPLICABLE`, `steps_json: []`
- **Outcome**: **PASSED**. Validates that non-destructive opt-out requests are not classified as deletion workflows and no destructive remediation actions are emitted.

### Custom Case 2: Active Connector Recreation Risk
- **Request ID**: `custom_02`
- **Subject**: `lucia-torres@gmail.com` (user with active connector `data_flow_9846`)
- **Request Text**: *"I disconnected my account, please close it completely and remove all integrations."*
- **Audit Cutoff**: `2026-09-15T12:00:00Z`
- **Observed State in Evidence**: `evidence_01` shows active connector heartbeat for `data_flow_9846`.
- **Expected Status**: `INCOMPLETE`
- **Key Steps Expected**:
  - Finding: `integration_service`, `data_flow_9846`, `REPORT_ACTIVE_DATA_FLOW`, `evidence_01`
  - Remediation: `integration_service`, `data_flow_9846`, `DISABLE_DATA_FLOW`, `evidence_id: ""`
  - Verification: `integration_service`, `data_flow_9846`, `VERIFY_DATA_FLOW_DISABLED`, `evidence_id: ""`
- **Outcome**: **PASSED**. Correctly reports active data flow and emits required remediation and verification.

### Custom Case 3: Clean Deletion with Permitted Account Absence Verification
- **Request ID**: `custom_03`
- **Subject**: `amina.elmasri@gmail.com` (`user_01`)
- **Request Text**: *"I am writing to request the permanent deletion of my account and all associated personal data."*
- **Audit Cutoff**: `2026-09-05T14:30:00Z`
- **Observed State in Evidence**: Primary account absent in `evidence_54` failover replica; no lingering search, support, export, or connector entries.
- **Expected Status**: `COMPLETE`
- **Key Steps Expected**: Only `VERIFICATION` phase steps with non-empty `evidence_id` citing evidence proving absence.
- **Outcome**: **PASSED**. Emits verification check with valid evidence reference and zero findings/remediations.

---

## 4. Failures Found, Root Causes, and Improvements Made

During development and evaluation iterations, the following failure modes were analyzed and resolved:

### 1. Intent Classification for Non-Destructive Requests
- **Failure**: Requests asking for data export, invoice copy, mobile number update, or marketing opt-out were initially flagged as `INCOMPLETE` or `COMPLETE`.
- **Root Cause**: The pipeline did not check request intent before searching for evidence.
- **Improvement**: Implemented strict semantic intent analysis (`is_not_applicable()`) targeting phrases such as *"leave the account active"*, *"not asking for deletion"*, *"keep the account as it is"*, *"marketing lists only"*, etc. Verified that cases `case_533` through `case_542` are correctly classified as `NOT_APPLICABLE` with `[]`.

### 2. Multi-Line Log Trace Correlation
- **Failure**: Four sample cases (`case_15`, `case_17`, `case_18`, `case_20`) were initially misclassified as `COMPLETE` because log events split resource IDs and user identifiers across separate lines.
- **Root Cause**: In central observability logs (`evidence_01`) and service readback logs (`evidence_94`), the request start event logged the `lookup_key` or `subject_key`, while subsequent events logged the `resource_id` (e.g., `data_flow_9846`, `backup_3245`) sharing a common `trace_id`.
- **Improvement**: Built a two-pass trace-correlation indexer that groups log lines by `trace_id` within each evidence file, propagating all identifiers (`correlation_key`, `subject_key`, `subject_ref`, `requester_email`) to the associated resource and its terminal state. This improved case status accuracy from 87.5% to **100.0%**.

### 3. Primary Account Resolution via Deletion Worker Activities
- **Failure**: For cases where primary accounts were already 404 in evidence exports (e.g., `evidence_92`), the user's primary account resource ID could not be identified by evidence lookup alone.
- **Root Cause**: `service_resource_export_20260915_114455.json` recorded `profile: null` for deleted profiles.
- **Improvement**: Correlated `system_activity.csv` operational events from `deletion_worker` targeting `account_service`. By matching the deletion events occurring within 90 minutes of the case's `reported_at`, primary account resource IDs (e.g., `account_5482`, `account_3866`, `account_7012`, `account_3136`, `account_5684`, `account_6440`) were accurately resolved.

---

## 5. Distinction Between Public Sample Validation and Full-Dataset Inference

- **Public Sample Suite**:
  - Cases: `case_01` to `case_32` (32 requests).
  - Used strictly for validation, metric benchmarking, and error analysis.
  - Never hardcoded into prediction logic; all predictions are generated algorithmically by the general extraction and audit pipeline.
- **Full Production Dataset**:
  - Cases: `case_33` to `case_550` (518 requests).
  - Executed end-to-end via `python code/main.py`.
  - Generates the authoritative repository-root `output.csv`.
  - Results: 286 `COMPLETE`, 222 `INCOMPLETE`, 10 `NOT_APPLICABLE`. Exactly 518 data rows sorted by `case_id` ascending.

---

## 6. Remaining Limitations & Unverified Evidence

1. **OCR on Heavily Stylized Image Screenshots**: While image OCR extracts key resource IDs and emails, low-contrast or stylized fonts in evidence screenshots may require fallback to operational activity logs for full identity resolution.
2. **Ambiguous Secondary Account Replicas**: In instances where multiple deletion worker events occurred within a narrow timestamp window across concurrent cases, the closest temporal match is selected. Additional multi-tenant correlation IDs would further refine tie-breaking.
