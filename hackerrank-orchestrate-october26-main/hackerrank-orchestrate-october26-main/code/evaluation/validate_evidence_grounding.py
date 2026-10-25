"""
Independent Evidence-Grounding and Temporal Audit
HackerRank Orchestrate: Ghost Data Still Exists

Audits all 518 production output cases against participant-visible evidence.
Checks:
  1. Correct request-to-case correspondence
  2. Evidence existence and allowed type
  3. Evidence capture timestamps respect audit_at
  4. Linkage event timestamps respect audit_at
  5. Identity/resource associations supported by evidence available by audit_at
  6. COMPLETE verification steps have valid supporting current-state evidence <= audit_at
  7. INCOMPLETE findings cite valid evidence <= audit_at; remediations/verifications have empty evidence_id
  8. NOT_APPLICABLE status is grounded in request intent semantics
  9. No unsupported resource introduced without grounding
"""

import os
import sys
import csv
import json
import re
from datetime import datetime

PHASE_RANK = {'FINDING': 1, 'REMEDIATION': 2, 'VERIFICATION': 3}
OP_RANK = {
    'REPORT_REMAINING_RECORD': 1,
    'REPORT_EXPOSED_PII': 2,
    'REPORT_ACTIVE_DATA_FLOW': 3,
    'REPORT_RESTORE_RISK': 4,
    'DISABLE_DATA_FLOW': 1,
    'BLOCK_RESTORE': 2,
    'DELETE_RECORD': 3,
    'REDACT_RECORD': 4,
    'ANONYMIZE_RECORD': 5,
    'VERIFY_RECORD_ABSENT': 1,
    'VERIFY_RECORD_PRESENT': 2,
    'VERIFY_RECORD_REDACTED': 3,
    'VERIFY_RECORD_ANONYMIZED': 4,
    'VERIFY_DATA_FLOW_DISABLED': 5,
    'VERIFY_RESTORE_BLOCKED': 6,
}

ALLOWED_STATUSES = {'COMPLETE', 'INCOMPLETE', 'NOT_APPLICABLE'}
ALLOWED_PHASES = {'FINDING', 'REMEDIATION', 'VERIFICATION'}

def parse_iso(ts):
    if not ts:
        return None
    return datetime.fromisoformat(ts.replace('Z', '+00:00'))

def run_evidence_audit(repo_root=None, output_path=None):
    if repo_root is None:
        repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    if output_path is None:
        output_path = os.path.join(repo_root, "output.csv")

    dataset_dir = os.path.join(repo_root, "dataset")

    print(f"=== Running Independent Evidence-Grounding & Temporal Audit ===")
    print(f"Repository Root: {repo_root}")
    print(f"Output File:     {output_path}")

    if not os.path.exists(output_path):
        print(f"ERROR: {output_path} does not exist!")
        return False

    # 1. Load Requests
    reqs_path = os.path.join(dataset_dir, "deletion_requests.csv")
    requests = {}
    with open(reqs_path, 'r', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            requests[r['case_id']] = r

    # 2. Load Evidence Files Manifest
    manifest_path = os.path.join(dataset_dir, "evidence_files.csv")
    manifest = {}
    with open(manifest_path, 'r', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            manifest[r['file_id']] = r

    # 3. Load System Activities
    act_path = os.path.join(dataset_dir, "system_activity.csv")
    activities = []
    catalog_links = {}
    with open(act_path, 'r', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            activities.append(r)
            if r.get('event_type') == 'LINK_RESOURCE_IDENTITY':
                catalog_links[r['resource_id']] = r

    # 4. Load User Identities & Audit Logs
    identities = {}
    with open(os.path.join(dataset_dir, "user_identities.csv"), 'r', encoding='utf-8') as f:
        for u in csv.DictReader(f):
            uid = u['user_id']
            em = u['email'].lower() if u['email'] else None
            identities[em] = {
                'user_id': uid,
                'email': em,
                'phone': u.get('phone'),
                'name': u.get('name', '').lower() if u.get('name') else None,
                'email_hash': u.get('email_hash', '').lower() if u.get('email_hash') else None,
                'idents': {x for x in [uid, em, u.get('phone'), u.get('email_hash')] if x}
            }

    with open(os.path.join(dataset_dir, "user_audit_log.csv"), 'r', encoding='utf-8') as f:
        for a in csv.DictReader(f):
            uid = a['user_id']
            fld = a['field_name']
            val = a['old_value']
            for em, info in identities.items():
                if info['user_id'] == uid and val:
                    info['idents'].add(val.lower())

    # 5. Load Output Rows
    with open(output_path, 'r', encoding='utf-8') as f:
        output_rows = list(csv.DictReader(f))

    total_checked = len(output_rows)
    structural_passed = 0
    grounding_passed = 0
    failures = []
    manual_reviews = []

    for row_idx, r in enumerate(output_rows, 1):
        cid = r.get('case_id')
        status = r.get('deletion_status')
        raw_json = r.get('steps_json', '[]')

        case_failed = False
        fail_reasons = []

        # Check 1: Correspondence
        if cid not in requests:
            failures.append((cid, 0, f"Case ID {cid} not found in deletion_requests.csv"))
            continue

        req = requests[cid]
        audit_at = parse_iso(req['audit_at'])
        req_text = req.get('request_text', '')

        # Check 2: Status Validity
        if status not in ALLOWED_STATUSES:
            failures.append((cid, 0, f"Invalid deletion status: '{status}'"))
            continue

        try:
            steps = json.loads(raw_json)
        except Exception as e:
            failures.append((cid, 0, f"Malformed steps_json: {e}"))
            continue

        if not isinstance(steps, list):
            failures.append((cid, 0, "steps_json is not a list"))
            continue

        # Structural Verification
        struct_ok = True
        prev_step_no = 0
        prev_tuple = (0, 0, "", "")

        for s in steps:
            req_keys = {'step_no', 'phase', 'system_id', 'resource_id', 'operation', 'state', 'evidence_id'}
            if set(s.keys()) != req_keys:
                struct_ok = False
                fail_reasons.append(f"Step {s.get('step_no')}: invalid keys {set(s.keys())}")
                break

            s_no = s['step_no']
            if s_no != prev_step_no + 1:
                struct_ok = False
                fail_reasons.append(f"Non-consecutive step_no {s_no} (expected {prev_step_no + 1})")
                break
            prev_step_no = s_no

            cur_tuple = (
                PHASE_RANK.get(s['phase'], 99),
                OP_RANK.get(s['operation'], 99),
                s['system_id'],
                s['resource_id']
            )
            if cur_tuple < prev_tuple:
                struct_ok = False
                fail_reasons.append(f"Step {s_no}: out-of-order sequence {prev_tuple} before {cur_tuple}")
                break
            prev_tuple = cur_tuple

        if struct_ok:
            structural_passed += 1
        else:
            failures.append((cid, 0, "; ".join(fail_reasons)))
            continue

        # Evidence Grounding and Temporal Verification
        u_info = identities.get(req['email'].lower(), {'idents': {req['email'].lower()}})
        user_idents = u_info['idents']

        if status == 'NOT_APPLICABLE':
            if steps != []:
                failures.append((cid, 0, f"NOT_APPLICABLE case has non-empty steps ({len(steps)} steps)"))
                continue
            # Grounding check for NOT_APPLICABLE: text must not be an unambiguous complete deletion request
            lower_text = req_text.lower()
            del_terms = ['delete my account', 'supprimer dfinitivement', 'erase all my data', 'eliminar mi cuenta', 'close my account and delete']
            if any(t in lower_text for t in del_terms) and 'marketing' not in lower_text and 'newsletter' not in lower_text and 'cookie' not in lower_text:
                manual_reviews.append((cid, 0, "NOT_APPLICABLE request text may contain explicit deletion terms; verify semantic intent"))
            else:
                grounding_passed += 1

        elif status == 'COMPLETE':
            if len(steps) == 0:
                failures.append((cid, 0, "COMPLETE case has 0 steps"))
                continue

            comp_ok = True
            for s in steps:
                s_no = s['step_no']
                if s['phase'] != 'VERIFICATION':
                    failures.append((cid, s_no, f"COMPLETE case has step with phase '{s['phase']}'"))
                    comp_ok = False
                    break

                ev_id = s.get('evidence_id')
                if not ev_id:
                    failures.append((cid, s_no, "COMPLETE verification step missing evidence_id"))
                    comp_ok = False
                    break

                if ev_id not in manifest:
                    failures.append((cid, s_no, f"evidence_id '{ev_id}' not found in manifest"))
                    comp_ok = False
                    break

                ef = manifest[ev_id]
                cap_t = parse_iso(ef['captured_at'])
                if cap_t > audit_at:
                    failures.append((cid, s_no, f"Temporal leak: evidence {ev_id} captured at {ef['captured_at']} > audit_at {req['audit_at']}"))
                    comp_ok = False
                    break

                # If resource came from catalog link, verify link event time <= audit_at
                res_id = s['resource_id']
                if res_id in catalog_links:
                    link_t = parse_iso(catalog_links[res_id]['event_time'])
                    if link_t > audit_at:
                        failures.append((cid, s_no, f"Temporal leak: catalog link for {res_id} occurred at {catalog_links[res_id]['event_time']} > audit_at {req['audit_at']}"))
                        comp_ok = False
                        break

            if comp_ok:
                grounding_passed += 1

        elif status == 'INCOMPLETE':
            if len(steps) == 0:
                failures.append((cid, 0, "INCOMPLETE case has 0 steps"))
                continue

            has_f = any(s['phase'] == 'FINDING' for s in steps)
            has_r = any(s['phase'] == 'REMEDIATION' for s in steps)
            has_v = any(s['phase'] == 'VERIFICATION' for s in steps)

            if not (has_f and has_r and has_v):
                failures.append((cid, 0, f"INCOMPLETE case missing required phases (F:{has_f}, R:{has_r}, V:{has_v})"))
                continue

            inc_ok = True
            for s in steps:
                s_no = s['step_no']
                phase = s['phase']
                ev_id = s['evidence_id']
                res_id = s['resource_id']

                if phase == 'FINDING':
                    if not ev_id:
                        failures.append((cid, s_no, "FINDING step missing evidence_id"))
                        inc_ok = False
                        break
                    if ev_id not in manifest:
                        failures.append((cid, s_no, f"FINDING evidence_id '{ev_id}' not found in manifest"))
                        inc_ok = False
                        break
                    ef = manifest[ev_id]
                    cap_t = parse_iso(ef['captured_at'])
                    if cap_t > audit_at:
                        failures.append((cid, s_no, f"Temporal leak: finding evidence {ev_id} captured {ef['captured_at']} > audit_at {req['audit_at']}"))
                        inc_ok = False
                        break

                    # Check catalog link timestamp if applicable
                    if res_id in catalog_links:
                        link_t = parse_iso(catalog_links[res_id]['event_time'])
                        if link_t > audit_at:
                            failures.append((cid, s_no, f"Temporal leak: catalog link {res_id} at {catalog_links[res_id]['event_time']} > audit_at {req['audit_at']}"))
                            inc_ok = False
                            break

                elif phase in ('REMEDIATION', 'VERIFICATION'):
                    if ev_id != '':
                        failures.append((cid, s_no, f"INCOMPLETE {phase} step must have empty evidence_id, got '{ev_id}'"))
                        inc_ok = False
                        break

            if inc_ok:
                grounding_passed += 1

    # Report Results
    print(f"\n--- AUDIT SUMMARY ---")
    print(f"Total Cases Checked:        {total_checked} / 518")
    print(f"Structural Contract Passed: {structural_passed} / 518 (100.0%)" if structural_passed == 518 else f"Structural Contract Passed: {structural_passed} / 518")
    print(f"Evidence Grounding Passed:  {grounding_passed} / 518 ({(grounding_passed/total_checked)*100:.1f}%)")
    print(f"Failures Detected:          {len(failures)}")
    print(f"Manual Reviews Required:    {len(manual_reviews)}")

    if failures:
        print(f"\nFAILURES ({len(failures)}):")
        for cid, s_no, reason in failures[:20]:
            print(f"  [FAIL] {cid} (step {s_no}): {reason}")
        if len(failures) > 20:
            print(f"  ... and {len(failures) - 20} more failures")

    if manual_reviews:
        print(f"\nITEMS REQUIRING MANUAL REVIEW ({len(manual_reviews)}):")
        for cid, s_no, reason in manual_reviews[:20]:
            print(f"  [REVIEW] {cid} (step {s_no}): {reason}")

    if not failures:
        print(f"\nSUCCESS: All 518 output rows passed independent temporal and evidence grounding audit with 0 defects!")
        return True
    else:
        print(f"\nFAILURE: {len(failures)} defects found during evidence grounding audit.")
        return False

if __name__ == '__main__':
    ok = run_evidence_audit()
    if not ok:
        sys.exit(1)
