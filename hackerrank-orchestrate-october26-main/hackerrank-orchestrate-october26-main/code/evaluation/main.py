"""
Evaluation Runner for HackerRank Orchestrate: Ghost Data Still Exists
Evaluates the deletion audit solution on public sample cases and custom cases.
"""

import os
import sys
import csv
import json

repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
import importlib.util
spec = importlib.util.spec_from_file_location("code_main", os.path.join(repo_root, "code", "main.py"))
code_main = importlib.util.module_from_spec(spec)
spec.loader.exec_module(code_main)
AuditPipeline = code_main.AuditPipeline
parse_iso = code_main.parse_iso


def evaluate_samples():
    pipeline = AuditPipeline(repo_root)
    sample_reqs_path = os.path.join(repo_root, "dataset", "sample_deletion_requests.csv")
    sample_truth_path = os.path.join(repo_root, "dataset", "sample_output.csv")

    with open(sample_reqs_path, 'r', encoding='utf-8') as f:
        requests = list(csv.DictReader(f))

    with open(sample_truth_path, 'r', encoding='utf-8') as f:
        truth = {r['case_id']: (r['deletion_status'], json.loads(r['steps_json'])) for r in csv.DictReader(f)}

    total_cases = len(requests)
    correct_status = 0
    total_steps_truth = 0
    total_steps_pred = 0
    matching_steps = 0
    field_matches = 0
    total_fields = 0
    step_diff_penalty = 0
    sequence_matches = 0

    print(f"=== Evaluating {total_cases} Public Sample Cases ===")
    for req in requests:
        cid = req['case_id']
        exp_status, exp_steps = truth[cid]
        res = pipeline.audit_case(req)
        pred_status = res['deletion_status']
        pred_steps = res['steps_json']

        # Status check
        if pred_status == exp_status:
            correct_status += 1

        # Step check
        total_steps_truth += len(exp_steps)
        total_steps_pred += len(pred_steps)

        # Sequence check
        is_seq_exact = (pred_steps == exp_steps)
        if is_seq_exact:
            sequence_matches += 1

        # Field-level comparison
        min_len = min(len(pred_steps), len(exp_steps))
        for i in range(min_len):
            ps = pred_steps[i]
            es = exp_steps[i]
            step_field_matches = 0
            for fld in ['phase', 'system_id', 'resource_id', 'operation', 'state', 'evidence_id']:
                total_fields += 1
                if ps.get(fld) == es.get(fld):
                    field_matches += 1
                    step_field_matches += 1
            if step_field_matches == 6:
                matching_steps += 1

        # Penalize missing or extra steps in field alignment
        step_diff_penalty += abs(len(pred_steps) - len(exp_steps)) * 6

    gt_total_fields = total_steps_truth * 6
    penalized_field_denom = gt_total_fields + step_diff_penalty
    status_acc = (correct_status / total_cases) * 100
    step_acc = (matching_steps / max(total_steps_truth, 1)) * 100
    field_alignment_acc = (field_matches / max(penalized_field_denom, 1)) * 100
    gt_field_recall = (field_matches / max(gt_total_fields, 1)) * 100
    seq_acc = (sequence_matches / total_cases) * 100

    print(f"Case-Level Status Accuracy: {correct_status}/{total_cases} ({status_acc:.1f}%)")
    print(f"Step-Level Matching Accuracy: {matching_steps}/{total_steps_truth} ({step_acc:.1f}%)")
    print(f"Field-Level Precision / Alignment: {field_matches}/{penalized_field_denom} ({field_alignment_acc:.1f}%) [Denominator = Ground-truth fields ({gt_total_fields}) + Step-diff penalty ({step_diff_penalty})]")
    print(f"Ground-Truth Field Recall: {field_matches}/{gt_total_fields} ({gt_field_recall:.1f}%) [Denominator = 193 ground-truth steps * 6 fields = {gt_total_fields}]")
    print(f"Exact Sequence Accuracy: {sequence_matches}/{total_cases} ({seq_acc:.1f}%)")

    return {
        'total_cases': total_cases,
        'status_accuracy': status_acc,
        'step_accuracy': step_acc,
        'field_alignment_accuracy': field_alignment_acc,
        'gt_field_recall': gt_field_recall,
        'sequence_accuracy': seq_acc
    }

def run_custom_cases():
    print("\n=== Running Custom Evaluation Test Cases ===")
    pipeline = AuditPipeline(repo_root)

    # 1. Custom Case 1: Active Opt-out Request without deletion intent
    case_custom_1 = {
        'case_id': 'custom_01',
        'email': 'optout.user@example.com',
        'requested_at': '2026-08-01T10:00:00Z',
        'reported_status': 'NOT_STARTED',
        'reported_at': '2026-08-01T11:00:00Z',
        'audit_at': '2026-08-05T10:00:00Z',
        'request_text': 'Please unsubscribe me from marketing emails only, leave the account active and do not close the account.'
    }
    res_1 = pipeline.audit_case(case_custom_1)
    print(f"Custom Case 1 (Marketing Opt-out Only): status={res_1['deletion_status']}, steps={res_1['steps_json']}")
    assert res_1['deletion_status'] == 'NOT_APPLICABLE'
    assert res_1['steps_json'] == []

    # 2. Custom Case 2: Incomplete deletion with active data flow
    case_custom_2 = {
        'case_id': 'custom_02',
        'email': 'lucia-torres@gmail.com', # known active data flow data_flow_9846
        'requested_at': '2026-08-21T12:00:00Z',
        'reported_status': 'COMPLETE',
        'reported_at': '2026-08-22T12:00:00Z',
        'audit_at': '2026-09-15T12:00:00Z',
        'request_text': 'I disconnected my account, please close it completely and remove all integrations.'
    }
    res_2 = pipeline.audit_case(case_custom_2)
    print(f"Custom Case 2 (Active Connector Leak): status={res_2['deletion_status']}, steps_count={len(res_2['steps_json'])}")
    assert res_2['deletion_status'] == 'INCOMPLETE'
    assert any(s['operation'] == 'REPORT_ACTIVE_DATA_FLOW' for s in res_2['steps_json'])

    # 3. Custom Case 3: Complete deletion with verified absent account
    case_custom_3 = {
        'case_id': 'custom_03',
        'email': 'amina.elmasri@gmail.com', # case_01 clean deletion
        'requested_at': '2026-08-19T09:12:00Z',
        'reported_status': 'COMPLETE',
        'reported_at': '2026-08-20T16:42:00Z',
        'audit_at': '2026-09-05T14:30:00Z',
        'request_text': 'I am writing to request the permanent deletion of my account and all associated personal data.'
    }
    res_3 = pipeline.audit_case(case_custom_3)
    print(f"Custom Case 3 (Clean Deletion Verification): status={res_3['deletion_status']}, steps_count={len(res_3['steps_json'])}")
    assert res_3['deletion_status'] == 'COMPLETE'
    assert all(s['phase'] == 'VERIFICATION' for s in res_3['steps_json'])

    # 4. Custom Case 4: Read replica nested search and audit record extraction
    case_custom_4 = {
        'case_id': 'custom_04',
        'email': 'diya.k4436@outlook.com',
        'requested_at': '2026-09-05T11:00:00Z',
        'reported_status': 'COMPLETE',
        'reported_at': '2026-09-07T11:00:00Z',
        'audit_at': '2026-09-26T11:00:00Z',
        'request_text': 'Please delete my account and ensure search indexes no longer return my name.'
    }
    res_4 = pipeline.audit_case(case_custom_4)
    print(f"Custom Case 4 (Read Replica Extraction): status={res_4['deletion_status']}, steps_count={len(res_4['steps_json'])}")
    assert res_4['deletion_status'] == 'INCOMPLETE'
    assert any(s['resource_id'] == 'search_1007' and s['operation'] == 'REPORT_REMAINING_RECORD' for s in res_4['steps_json'])
    assert any(s['resource_id'] == 'audit_record_9528' and s['state'] == 'PRESENT' for s in res_4['steps_json'])

    # 5. Custom Case 5: Direct evidence account resolution precedence
    case_custom_5 = {
        'case_id': 'custom_05',
        'email': 'thandiwe.n@gmail.com', # user_04 seed user mapping
        'requested_at': '2026-08-25T12:32:00Z',
        'reported_status': 'COMPLETE',
        'reported_at': '2026-08-27T08:54:00Z',
        'audit_at': '2026-09-07T10:20:00Z',
        'request_text': 'I am deleting my account. Keep anonymous stats, but nothing pointing back to me.'
    }
    res_5 = pipeline.audit_case(case_custom_5)
    print(f"Custom Case 5 (Evidence/Seed Account Resolution): status={res_5['deletion_status']}, steps_count={len(res_5['steps_json'])}")
    assert res_5['deletion_status'] == 'COMPLETE'
    assert any(s['resource_id'] == 'analytics_901' and s['system_id'] == 'analytics_platform' for s in res_5['steps_json'])

    print("ALL CUSTOM EVALUATION TEST CASES PASSED (5/5)!")

if __name__ == '__main__':
    evaluate_samples()
    run_custom_cases()

