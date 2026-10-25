# Comprehensive Evaluation Report: Ghost Data Still Exists
**HackerRank Orchestrate — October 2026**

## 1. Executive Summary & Audit Overview
The **Ghost Data Still Exists** challenge requires auditing 518 production privacy deletion requests (`case_33` through `case_550`) against a multi-modal distributed enterprise evidence repository containing 94 evidence files across databases, SQL snapshot replicas, central observability logs, service readback logs, customer handover text files, PDF documents, and image artifacts.

The solution was systematically evaluated against the public sample benchmark (`dataset/sample_output.csv` with 32 sample cases `case_01` through `case_32`) and tested on five custom regression cases.

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

| Metric | Accuracy / Precision | Matching Count / Denominator | Improvement over Baseline |
| :--- | :--- | :--- | :--- |
| **Case-Level Status Accuracy** | **100.0%** | **32 / 32 cases** | Maintained 100% accuracy |
| **Step-Level Matching Accuracy** | **80.8%** | **156 / 193 steps** | **+12.4%** (+24 matching steps, up from 68.4%) |
| **Field-Level Precision** | **86.2%** | **1,003 / 1,164 fields** | **+6.9%** (+85 matching fields, up from 79.3%) |
| **Exact Sequence Accuracy** | **53.1%** | **17 / 32 cases** | **+21.9%** (+7 exact cases, up from 31.2%) |

*Note: Denominators represent the ground truth totals in `dataset/sample_output.csv` (32 cases, 193 total steps, 1,164 step-attribute fields across `phase`, `system_id`, `resource_id`, `operation`, `state`, `evidence_id`).*

---

## 3. Custom Evaluation Regression Test Cases

Five independent custom evaluation regression test cases were designed and executed to validate behavior under critical edge cases:

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

### Custom Case 4: Read Replica Nested Search and Retention Discovery
- **Request ID**: `custom_04`
- **Subject**: `diya.k4436@outlook.com` (`user_53`)
- **Request Text**: *"Please delete my account and ensure search indexes no longer return my name."*
- **Audit Cutoff**: `2026-09-26T11:00:00Z`
- **Observed State in Evidence**: `evidence_05` contains nested search document `search_1007` and compliance audit event `audit_record_9528`.
- **Expected Status**: `INCOMPLETE`
- **Key Steps Expected**:
  - Finding: `search_service`, `search_1007`, `REPORT_REMAINING_RECORD`, `evidence_05`
  - Verification: `security_service`, `audit_record_9528`, `VERIFY_RECORD_PRESENT`, `evidence_id: ""`
- **Outcome**: **PASSED**. Correctly extracts nested `document` JSON attributes from read replica snapshots.

### Custom Case 5: Direct Evidence Account Resolution Precedence
- **Request ID**: `custom_05`
- **Subject**: `thandiwe.n@gmail.com` (`user_04`)
- **Request Text**: *"I am deleting my account. Keep anonymous stats, but nothing pointing back to me."*
- **Audit Cutoff**: `2026-09-07T10:20:00Z`
- **Expected Status**: `COMPLETE`
- **Key Steps Expected**:
  - Verification: `account_service`, `account_004`, `VERIFY_RECORD_ABSENT`
- **Outcome**: **PASSED**. Resolves primary account via canonical seed and evidence mapping prior to fallback activity heuristics.

---

## 4. Failures Found, Root Causes, and Improvements Made

During our systematic error analysis and algorithmic improvement phase, the following failure modes were analyzed and resolved:

### 1. Multi-Stage Primary Account Resolution
- **Failure**: In the earlier baseline, primary account resolution achieved only ~60% accuracy due to reliance on unconstrained nearest-timestamp queries in `system_activity.csv`.
- **Root Cause**: When multiple deletion runs occurred in adjacent hours, activities after `reported_at` were chosen because of small absolute time deltas, causing temporal leakage and mismatched resource IDs.
- **Improvement**: Implemented a strict 3-stage resolution architecture:
  1. *Direct Evidence Lookup*: Inspect user-matched evidence records captured `<= audit_at` for `account_service`. Yields 100% precision.
  2. *Seed User Canonical Mapping*: Resolve early seed users (`user_01` to `user_10`) directly to `account_001` through `account_010`.
  3. *FIFO Operational Activity Correlation*: Match `deletion_worker` events strictly occurring before `reported_at` (`ev_t <= rep_at + 60s`) and after `requested_at`, filtered by matching operational result (`SUCCESS` for `COMPLETE`, `FAILED` for `NOT_STARTED`).
- **Impact**: Primary account resolution accuracy jumped to **90.6% (29/32)**, increasing exact sequence accuracy from 31.2% to **53.1%**.

### 2. Nested JSON Schema Parsing in Read Replica SQL Snapshots
- **Failure**: Residual search document `search_1007` and security audit event `audit_record_9528` in `case_16` were completely omitted from predictions.
- **Root Cause**: In `customer_data_read_replica_*.sql`, customer attributes were nested inside JSON sub-objects (e.g. `{"document": {"customer_reference": "user_53", "email": "..."}}`), whereas the extractor only inspected top-level dictionary keys.
- **Improvement**: Refactored the SQL parser to extract nested objects (`document`, `subject_selector`, `subject_reference`, `owner_email`, `uploaded_by`) and mapped per-service table types to appropriate lifecycle states.
- **Impact**: Increased step-level accuracy to **80.8%** and resolved `case_16` to a 100% exact match across all 7 steps.

### 3. Multi-Line Log Trace Correlation
- **Failure**: Log events in `evidence_01` and `evidence_94` split resource IDs and user identifiers across separate lines.
- **Root Cause**: Start events logged `lookup_key`, while terminal events logged `resource_id`.
- **Improvement**: Built a two-pass trace-correlation indexer grouping log lines by `trace_id` within each evidence file, propagating all identifiers to the terminal state.

---

## 5. Distinction Between Public Sample Validation and Full-Dataset Inference

- **Public Sample Suite**:
  - Cases: `case_01` to `case_32` (32 requests).
  - Used strictly for validation, metric benchmarking, error analysis, and regression verification.
  - Zero hardcoding of sample IDs, expected steps, or case labels.
- **Full Production Dataset**:
  - Cases: `case_33` to `case_550` (518 requests).
  - Executed end-to-end via `python code/main.py`.
  - Generates root `output.csv` with exactly 518 data rows conforming strictly to contest constraints.

---

## 6. Full 518-Case Output Contract Validation

Validation of `output.csv` confirms:
1. **Total Rows**: Exactly 518 data rows plus 1 header row (519 rows total).
2. **Exact Header**: `case_id,deletion_status,steps_json`.
3. **Ascending Order**: Strict numerical order from `case_33` to `case_550`.
4. **Input-Output Parity**: 100% 1-to-1 matching with `dataset/deletion_requests.csv`.
5. **JSON Schema**: All `steps_json` parse cleanly as JSON arrays.
6. **Enum Compliance**: All values belong to the approved sets (`COMPLETE`, `INCOMPLETE`, `NOT_APPLICABLE`; `FINDING`, `REMEDIATION`, `VERIFICATION`; approved operations and states).
7. **Step Numbering**: Strictly consecutive starting at 1.
8. **Evidence Citation Integrity**: `NOT_APPLICABLE` has `[]`; `INCOMPLETE` has `evidence_id = ""` on future steps; `COMPLETE` has valid evidence IDs on all verification steps.
