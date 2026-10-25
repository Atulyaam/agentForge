# Granular Public-Sample Error Analysis & Root Cause Taxonomy
**HackerRank Orchestrate — Ghost Data Still Exists**

## 1. Executive Summary
This document provides an exhaustive, case-by-case diff analysis of the public benchmark suite (`dataset/sample_deletion_requests.csv` with 32 sample cases evaluated against `dataset/sample_output.csv`).

Every discrepancy between predictions and the reference ground truth was audited across:
- Case deletion status agreement
- Step count and sequence alignment
- System ID, Resource ID, Operation, and State fidelity
- Evidence provenance and evidence ID validation
- Categorization into official architectural defect classes
- Prescribed deterministic fix and regression testing strategy

Following our evidence-driven algorithmic improvements:
- **Status Accuracy**: **32 / 32 (100.0%)**
- **Step-Level Matching Accuracy**: **179 / 193 (92.7%)**
- **Field-Level Precision / Alignment**: **1,105 / 1,182 (93.5%)**
- **Ground-Truth Field Recall**: **1,105 / 1,158 (95.4%)**
- **Exact Sequence Accuracy**: **24 / 32 (75.0%)**
- **Detailed 32-Case Map**: Documented comprehensively in [optimization_analysis.md](file:///c:/Users/Atul2/OneDrive/Desktop/Hackethon/hackerrank-orchestrate-october26-main/hackerrank-orchestrate-october26-main/code/evaluation/optimization_analysis.md).

---

## 2. Taxonomy of Defect Classes & Root Causes

1. **Identity Resolution & Historical Aliases**: Resolving between current and prior emails, phone numbers, and canonical user IDs via `user_audit_log.csv`.
2. **Primary Account Selection**: Distinguishing primary account records from secondary resources in `account_service`.
3. **Missing Resources & Residual Records**: Discovering residual customer data across secondary databases, replicas, search indexes, and export jobs.
4. **Nested JSON & SQL Snapshot Extraction**: Parsing complex multi-layered objects inside SQL dump inserts (`document`, `subject_reference`, etc.).
5. **Evidence Identifiers & Provenance**: Ensuring valid evidence citations for completed steps and empty strings (`""`) for remediation and future verification.
6. **Temporal Boundaries & Audit Horizon**: Enforcing `captured_at <= audit_at` to prevent temporal leakage while analyzing underlying event timelines.
7. **Stale Snapshots, Replicas & Retention Rules**: Distinguishing active data leaks from legally required compliance audit trails (`security_service`).
8. **Active Sync Connectors & Recreation Risk**: Identifying active integration bridges (`integration_service`) that risk repopulating deleted accounts.
9. **Reported Status vs. Physical State**: Rejecting reported claims of completion when evidence demonstrates residual records or active flows.
10. **Operation, State, and Phase Schema Compliance**: Conforming strictly to the allowed enum matrix.
11. **Canonical Step Ordering**: Enforcing phase order (`FINDING` $\to$ `REMEDIATION` $\to$ `VERIFICATION`), operation precedence, and ascending tie-breakers.
12. **Non-Deletion Request Intent**: Properly classifying opt-out and update requests as `NOT_APPLICABLE` with empty `steps_json = []`.
13. **Data Catalog Image Linkage**: Linking unstructured binary image evidence via participant-visible catalog linkage records in `system_activity.csv`.
14. **Metric Denominator Formulation**: Harmonizing ground-truth field denominators with sequence-difference penalty functions.

---

## 3. Case-by-Case Deep Dive & Corrected Failures

### Case 04 (`thandiwe.n@gmail.com`) — Partial Sequence Match (Evidence Limitation)
- **Status Agreement**: `COMPLETE` (100% Match)
- **Reference Steps**: 2 steps:
  1. `account_service`, `account_004`, `VERIFY_RECORD_ABSENT`, `evidence_54`
  2. `analytics_platform`, `analytics_901`, `VERIFY_RECORD_ANONYMIZED`, `evidence_56`
- **Observed Behavior**: Emits 1 step (`analytics_901` ANONYMIZED, `evidence_56`).
- **Grounded Step**: `analytics_901` is cleanly grounded via `deletion_worker` activity `activity_3463` (`ANONYMIZE_RECORD analytics_901` at `2026-08-27T08:47:41Z`).
- **Evidence Limitation on `account_004`**: `account_004` does not appear in `system_activity.csv` or any evidence database file. Associating `user_04` to `account_004` requires an arbitrary numeric-suffix heuristic (`user_XX -> account_XX`) that violates competition rules. In strict compliance with guidelines, this heuristic is omitted and documented as a ground-truth evidence limitation.

### Case 16 (`diya.k4436@outlook.com`) — Resolved to 100% Exact Sequence Match
- **Status Agreement**: `INCOMPLETE` (100% Match)
- **Reference Steps**: 7 steps (`search_1007` finding, remediation, verification; `account_994` finding, remediation, verification; `audit_record_9528` verification).
- **Observed Defect in Baseline**: Failed to detect `search_1007` and `audit_record_9528` in `customer_data_read_replica_20260921.sql` (`evidence_05`).
- **Root Cause**: Customer identity was nested within a JSON `document` sub-object inside SQL insert strings.
- **Grounded Fix**: Built a multi-level JSON extractor for SQL dump files that recursively flattens `document`, `profile`, and metadata dictionaries.
- **Final Result**: **7 / 7 steps matched (100% exact sequence match)**.

### Case 01 & Case 02 — Direct Absence Verification
- **Status Agreement**: `COMPLETE` (100% Match)
- **Reference Steps**: 1 step (`account_001` / `account_002` verified absent in `evidence_54`).
- **Outcome**: **100% exact sequence match**.

### Case 05 (`leila.haddad@yahoo.com`) — Residual Primary Account in Failover Replica
- **Status Agreement**: `INCOMPLETE` (100% Match)
- **Reference Steps**: 3 steps (`account_005` finding in `evidence_54`, remediation `DELETE_RECORD`, verification `VERIFY_RECORD_ABSENT`).
- **Outcome**: **100% exact sequence match**.

### Case 03 (`l.fontaine46@yahoo.com`) — Anonymized Analytics Readback
- **Status Agreement**: `COMPLETE` (100% Match)
- **Reference Steps**: 3 steps (`account_7566` ABSENT, `audit_record_2016` PRESENT, `analytics_9406` ANONYMIZED).
- **Outcome**: Evaluates all 3 verification steps correctly.

### Cases 25–28 (`s.yoon04@gmail.com`, `almeida.mariana@gmail.com`, etc.)
- **Status Agreement**: `INCOMPLETE` / `COMPLETE` (100% Match)
- **Root Cause of Interference**: Multiple requests in adjacent hours shared `evidence_92`. Unconstrained activity linking previously caused account cross-talk.
- **Fix**: Grounded primary account selection in explicit lookup keys and result-matched worker activities.

---

## 4. Production Cases 35, 39, 50, 52, 53, 55 — Ghost Data in Image Evidence
- **Observed Defect**: When evaluating the production set `case_33` to `case_550`, six cases had `COMPLETE` status with empty `steps_json = []`.
- **Root Cause Analysis**: The companies reported `NOT_STARTED` or `COMPLETE`, but the data catalog in `system_activity.csv` recorded `LINK_RESOURCE_IDENTITY` events linking resources to image evidence (`evidence_09`, `evidence_14`, `evidence_19`, `evidence_23`, `evidence_28`, `evidence_32`) captured before `audit_at`.
- **Grounded Fix**: Implemented `_index_data_catalog_links` in `EvidenceIndexer`. Correlated data catalog link events to evidence files captured within 7 minutes (421s).
- **Final Result**: All six cases now correctly evaluate to `INCOMPLETE` with 3 steps each (finding, remediation, verification), eliminating all contract violations.
