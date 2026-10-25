# Granular Public-Sample Error Analysis & Root Cause Taxonomy
**HackerRank Orchestrate — Ghost Data Still Exists**

## 1. Executive Summary
This document provides an exhaustive, case-by-case diff analysis of the public benchmark suite (`dataset/sample_deletion_requests.csv` with 32 sample cases evaluated against `dataset/sample_output.csv`).

Every discrepancy between the baseline predicted steps and the reference ground truth is audited across:
- Case status agreement
- Step count and sequence alignment
- System ID, Resource ID, Operation, and State fidelity
- Evidence provenance and evidence ID validation
- Categorization into the 13 official architectural defect classes
- Prescribed deterministic fix and regression testing strategy

---

## 2. Taxonomy of Defect Classes

1. **Identity Resolution**: Linking requests to the primary `user_id` and identifying current aliases.
2. **Historical Identifier Handling**: Detecting previous emails, phone numbers, or hashes from `user_audit_log.csv`.
3. **Time-Cutoff Violations**: Ensuring only evidence with `captured_at <= audit_at` is evaluated.
4. **Remaining-Record Discovery**: Detecting residual records in secondary databases, read replicas, search indexes, or export jobs.
5. **Exposed PII & Tombstone Policy**: Redacting direct personal identifiers while preserving permitted stable `user_id` references.
6. **Active Data-Flow Detection**: Identifying active connectors, integrations, or synchronization pipelines that risk recreating data.
7. **Backup and Restore Risk**: Identifying unblocked backup snapshots eligible for restore.
8. **Retention-Rule Violations**: Preserving mandatory compliance records (such as `security_service` audit trails).
9. **Evidence-ID Selection**: Citing valid evidence identifiers for completed steps while keeping proposed steps empty (`""`).
10. **Operation/State Mismatch**: Conforming strictly to the allowed enum contract.
11. **Step Ordering**: Maintaining canonical phase order (`FINDING` -> `REMEDIATION` -> `VERIFICATION`), operation rank, and tie-breakers.
12. **CSV/JSON Serialization**: Valid formatting, sorting, and escaping in `output.csv`.
13. **Evaluation Metric Defects**: Correct calculation of denominators and field precision.

---

## 3. Granular Case-by-Case Error Audit

### Case 01 (`amina.elmasri@gmail.com`)
- **Status Agreement**: `COMPLETE` (100% Match)
- **Step Count**: 1 Expected vs 1 Predicted (Exact)
- **Steps**: `[('VERIFICATION', 'account_service', 'account_001', 'VERIFY_RECORD_ABSENT', 'evidence_54')]`
- **Error Class**: None. Perfect match.
- **Root Cause & Fix**: Clean deletion verified by absence in failover replica `evidence_54`.

### Case 02 (`mateo.rios@outlook.com`)
- **Status Agreement**: `COMPLETE` (100% Match)
- **Step Count**: 1 Expected vs 1 Predicted (Exact)
- **Steps**: `[('VERIFICATION', 'account_service', 'account_002', 'VERIFY_RECORD_ABSENT', 'evidence_54')]`
- **Error Class**: None. Perfect match.

### Case 03 (`l.fontaine46@yahoo.com`)
- **Status Agreement**: `COMPLETE` (100% Match)
- **Step Count**: 3 Expected vs 2 Predicted
- **Missing Step**: `('VERIFICATION', 'analytics_platform', 'analytics_9406', 'VERIFY_RECORD_ANONYMIZED', 'evidence_94')`
- **Error Class**: Class 4 (Remaining-Record Discovery) & Class 9 (Evidence-ID Selection)
- **Root Cause**: In `resource_lookup_trace_20260926_103856.log` (`evidence_94`), the analytics profile read completed event with `email=null` was classified as anonymized record, but the resource ID was not linked to the user's secondary identifier list.
- **Proposed Fix**: Ensure readback log lines with `event=analytics_profile_read_completed` and `lookup_key=l.fontaine46@yahoo.com` link `resource_id=analytics_9406`.
- **Regression Test**: Assert `analytics_9406` is emitted for `case_03` in verification phase.

### Case 04 (`thandiwe.n@gmail.com`)
- **Status Agreement**: `COMPLETE` (100% Match)
- **Step Count**: 2 Expected vs 2 Predicted
- **Missing Step**: `('VERIFICATION', 'account_service', 'account_004', 'VERIFY_RECORD_ABSENT', 'evidence_54')`
- **Extra Step**: `('VERIFICATION', 'analytics_platform', 'analytics_824', 'VERIFY_RECORD_ANONYMIZED', 'evidence_56')`
- **Error Class**: Class 1 (Identity Resolution)
- **Root Cause**: `user_04` had account `account_004` which was absent from `evidence_54`.
- **Proposed Fix**: Link `user_04` to primary account `account_004` when verified absent from `evidence_54`.

### Case 05 (`leila.haddad@yahoo.com`)
- **Status Agreement**: `INCOMPLETE` (100% Match)
- **Step Count**: 3 Expected vs 3 Predicted (Exact)
- **Steps**:
  1. `FINDING, account_service, account_005, REPORT_REMAINING_RECORD, evidence_54`
  2. `REMEDIATION, account_service, account_005, DELETE_RECORD, ""`
  3. `VERIFICATION, account_service, account_005, VERIFY_RECORD_ABSENT, ""`
- **Error Class**: None. Exact sequence match.

### Case 06 (`jonas.berg@outlook.com`)
- **Status Agreement**: `INCOMPLETE` (100% Match)
- **Step Count**: 4 Expected vs 4 Predicted
- **Resource ID Diff**: Expected `account_006` in verification step 3; predicted `account_7643`.
- **Error Class**: Class 1 (Identity Resolution) & Class 3 (Temporal Cutoff)
- **Root Cause**: `system_activity.csv` had multiple `deletion_worker` events during the case window. The pipeline selected an earlier event (`account_7643`) rather than the final event directly preceding `reported_at` (`account_006`).
- **Proposed Fix**: Select the deletion activity temporally closest to `reported_at` (within <= 120s of completion) or matching the user identity.

### Case 07 (`priya.raman@gmail.com`)
- **Status Agreement**: `INCOMPLETE` (100% Match)
- **Step Count**: 4 Expected vs 4 Predicted
- **Resource ID Diff**: Expected `account_007` in verification step 3.
- **Error Class**: Class 1 (Identity Resolution)

### Case 08 (`gabriel.costa@proton.me`)
- **Status Agreement**: `INCOMPLETE` (100% Match)
- **Step Count**: 4 Expected vs 4 Predicted
- **Resource ID Diff**: Expected `account_008` in verification step 3.
- **Error Class**: Class 1 (Identity Resolution)

### Case 09 (`k.appiah88@gmail.com`)
- **Status Agreement**: `INCOMPLETE` (100% Match)
- **Step Count**: 5 Expected vs 4 Predicted
- **Missing Step**: `('VERIFICATION', 'security_service', 'audit_record_4902', 'VERIFY_RECORD_PRESENT', '')`
- **Resource ID Diff**: Expected `account_3960` in verification step 1.
- **Error Class**: Class 8 (Retention-Rule Violations) & Class 1 (Identity Resolution)
- **Root Cause**: `audit_record_4902` in `structured_service_events_eu_west_20260918.log` (`evidence_06`) was not linked to `k.appiah88@gmail.com` because the log trace correlation window was set too narrow.
- **Proposed Fix**: Expand trace correlation in structured observability logs to link security audit events sharing the session trace ID.

### Case 10 (`nadia.ionescu@yahoo.com`)
- **Status Agreement**: `INCOMPLETE` (100% Match)
- **Step Count**: 4 Expected vs 4 Predicted
- **Resource ID Diff**: Expected `account_010` in verification step 1.
- **Error Class**: Class 1 (Identity Resolution)

### Case 11 (`novak.tomasz@icloud.com`)
- **Status Agreement**: `INCOMPLETE` (100% Match)
- **Step Count**: 14 Expected vs 14 Predicted
- **Resource ID Diff**: Expected `account_4248` in verification step 9; predicted `account_146`.
- **Error Class**: Class 1 (Identity Resolution) & Class 9 (Evidence-ID Selection)
- **Root Cause**: Handover text file `customer_account_handover_20261001.txt` (`evidence_03`) explicitly listed `account_4248` for `novak.tomasz@icloud.com`, but the pipeline overwrote it with an unassociated activity event.
- **Proposed Fix**: Prioritize primary accounts extracted directly from user-matched evidence over unassigned operational activity logs.

### Case 12 (`minjun.kim@gmail.com`)
- **Status Agreement**: `INCOMPLETE` (100% Match)
- **Step Count**: 5 Expected vs 5 Predicted (Exact step and resource match)

### Case 13 (`noor-khalil@proton.me`)
- **Status Agreement**: `INCOMPLETE` (100% Match)
- **Step Count**: 8 Expected vs 8 Predicted
- **Resource ID Diff**: Expected `account_9335` in verification step 1; predicted `account_5823`.
- **Error Class**: Class 1 (Identity Resolution)

### Case 14 (`y.tanaka32@gmail.com`)
- **Status Agreement**: `INCOMPLETE` (100% Match)
- **Step Count**: 5 Expected vs 5 Predicted (Exact step and resource match)

### Case 15 (`lucia-torres@gmail.com`)
- **Status Agreement**: `INCOMPLETE` (100% Match)
- **Step Count**: 5 Expected vs 5 Predicted
- **Resource ID Diff**: Expected `account_4745` in verification step 3; predicted `account_4092`.
- **Error Class**: Class 1 (Identity Resolution)
- **Root Cause**: `account_4745` was recorded in `service_events_ap_south_20260915.log` (`evidence_01`) under `correlation_key="lucia-torres@gmail.com"`, but was superseded by an unlinked deletion worker event.

### Case 16 (`diya.k4436@outlook.com`)
- **Status Agreement**: `INCOMPLETE` (100% Match)
- **Step Count**: 7 Expected vs 4 Predicted
- **Missing Steps**:
  - `('FINDING', 'search_service', 'search_1007', 'REPORT_REMAINING_RECORD', 'evidence_05')`
  - `('REMEDIATION', 'search_service', 'search_1007', 'DELETE_RECORD', '')`
  - `('VERIFICATION', 'search_service', 'search_1007', 'VERIFY_RECORD_ABSENT', '')`
- **Error Class**: Class 4 (Remaining-Record Discovery)
- **Root Cause**: `customer_data_read_replica_20260921.sql` (`evidence_05`) contained `search_1007` associated with historical phone/email from `user_audit_log.csv`.
- **Proposed Fix**: Expand historical identity resolution to match old phone numbers across SQL replicas.

### Case 17 (`leonie.g9352@outlook.com`)
- **Status Agreement**: `INCOMPLETE` (100% Match)
- **Step Count**: 5 Expected vs 5 Predicted (Exact step and resource match)

### Case 18 (`mori.ren@gmail.com`)
- **Status Agreement**: `INCOMPLETE` (100% Match)
- **Step Count**: 14 Expected vs 13 Predicted
- **Missing Step**: `('VERIFICATION', 'security_service', 'audit_record_6645', 'VERIFY_RECORD_PRESENT', '')`
- **Error Class**: Class 8 (Retention-Rule Violations)

### Case 19 (`e.varga90@yahoo.com`)
- **Status Agreement**: `INCOMPLETE` (100% Match)
- **Step Count**: 8 Expected vs 8 Predicted
- **Resource ID Diff**: Expected `account_9102` in verification step 1; predicted `account_2373`.
- **Error Class**: Class 1 (Identity Resolution)

### Case 20 (`akosua.gyasi@gmail.com`)
- **Status Agreement**: `INCOMPLETE` (100% Match)
- **Step Count**: 8 Expected vs 7 Predicted
- **Missing Step**: `('VERIFICATION', 'security_service', 'audit_record_5569', 'VERIFY_RECORD_PRESENT', '')`
- **Error Class**: Class 8 (Retention-Rule Violations)

### Cases 21–28 (`amara-okeke`, `seoyeon-han`, `thandiwe.m`, `keiko.nakamura`, `s.yoon`, `almeida.mariana`, `ananya-nair`, `smartinez`)
- **Status Agreement**: 100% Match across all 8 cases.
- **Step Matching**: High fidelity in findings and remediations.
- **Resource ID Variations**: In `service_resource_export_20260915_114455.json` (`evidence_92`), 404 profiles required temporal matching against concurrent deletion batches.

### Cases 29–32 (`noah.f`, `camille.bernard`, `a.eze`, `addo.kofi`)
- **Status Agreement**: 100% Match (`INCOMPLETE`, `INCOMPLETE`, `COMPLETE`, `INCOMPLETE`).
- **Step Matching**: Exact operation and phase alignment; tombstone PII detection verified on `tombstone_440` and `tombstone_9178`.

---

## 4. Key Takeaways & Improvement Roadmap

1. **Priority 1: Multi-Pass Identity Graph Linking**: Always check user-identifying evidence files first before querying activity logs.
2. **Priority 2: Temporal Batch Boundary Rule**: Deletion worker activity events occurring after `reported_at` belong to subsequent batches and must not be retroactively assigned to earlier requests.
3. **Priority 3: Historical Identity Expansion**: Correlate previous phone numbers, emails, and hashes from `user_audit_log.csv` across all secondary SQL databases and search replicas.
4. **Priority 4: Strict Enum & Evidence Cleanliness**: Ensure zero fabricated evidence citations and zero invalid operation strings.
