"""
Full Output Contract Validator for HackerRank Orchestrate: Ghost Data Still Exists
Validates root output.csv against all competition specification rules.
"""

import os
import sys
import csv
import json
import re
from datetime import datetime

ALLOWED_STATUSES = {'COMPLETE', 'INCOMPLETE', 'NOT_APPLICABLE'}
ALLOWED_PHASES = {'FINDING', 'REMEDIATION', 'VERIFICATION'}

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

# Specification rule:
# "Order steps by phase: findings, remediation, then verification. Within each phase, follow the operation order in the table above, followed by system_id and resource_id in ascending order."



def parse_iso(ts):
    if not ts:
        return None
    return datetime.fromisoformat(ts.replace('Z', '+00:00'))


def validate_output(repo_root=None, output_path=None):
    if repo_root is None:
        repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    if output_path is None:
        output_path = os.path.join(repo_root, "output.csv")

    print(f"=== Validating Output Contract: {output_path} ===")
    if not os.path.exists(output_path):
        print(f"ERROR: {output_path} does not exist!")
        return False

    # Check raw lines
    with open(output_path, 'r', encoding='utf-8') as f:
        raw_lines = [l.strip() for l in f if l.strip()]

    header = raw_lines[0]
    expected_header = "case_id,deletion_status,steps_json"
    if header != expected_header:
        print(f"FAIL: Invalid header: got '{header}', expected '{expected_header}'")
        return False
    print(f"PASS: Exact CSV header: {header}")

    # Exactly 518 data rows
    num_data_rows = len(raw_lines) - 1
    expected_rows = 518
    if num_data_rows != expected_rows:
        print(f"FAIL: Expected {expected_rows} data rows, got {num_data_rows}")
        return False
    print(f"PASS: Exact row count: {num_data_rows} rows")

    # Load production requests for cross-checking
    reqs_path = os.path.join(repo_root, "dataset", "deletion_requests.csv")
    with open(reqs_path, 'r', encoding='utf-8') as f:
        prod_requests = {r['case_id']: r for r in csv.DictReader(f)}

    # Parse CSV with DictReader
    with open(output_path, 'r', encoding='utf-8') as f:
        reader = list(csv.DictReader(f))

    # Check case IDs covering case_33 to case_550 in numerical order
    seen_ids = set()
    prev_num = 32
    for r in reader:
        cid = r['case_id']
        if cid in seen_ids:
            print(f"FAIL: Duplicate case_id: {cid}")
            return False
        seen_ids.add(cid)

        m = re.match(r"^case_(\d+)$", cid)
        if not m:
            print(f"FAIL: Invalid case_id format: {cid}")
            return False
        num = int(m.group(1))
        if num != prev_num + 1:
            print(f"FAIL: Non-consecutive case_id ordering: expected {prev_num+1}, got {num}")
            return False
        prev_num = num

    if prev_num != 550:
        print(f"FAIL: Final case ID was case_{prev_num}, expected case_550")
        return False
    print(f"PASS: Unique, ascending numerical case IDs: case_33 through case_550")

    # Validate each case contract
    status_counts = {'COMPLETE': 0, 'INCOMPLETE': 0, 'NOT_APPLICABLE': 0}
    for row_idx, r in enumerate(reader, 1):
        cid = r['case_id']
        status = r['deletion_status']
        raw_json = r['steps_json']

        if status not in ALLOWED_STATUSES:
            print(f"FAIL: Case {cid}: Invalid status '{status}'")
            return False
        status_counts[status] += 1

        try:
            steps = json.loads(raw_json)
        except Exception as e:
            print(f"FAIL: Case {cid}: Malformed JSON in steps_json: {e}")
            return False

        if not isinstance(steps, list):
            print(f"FAIL: Case {cid}: steps_json is not a JSON array")
            return False

        # Status specific validation
        if status == 'NOT_APPLICABLE':
            if steps != []:
                print(f"FAIL: Case {cid}: NOT_APPLICABLE must have empty steps_json [], got {steps}")
                return False
        elif status == 'COMPLETE':
            if len(steps) == 0:
                print(f"FAIL: Case {cid}: COMPLETE case has empty steps_json")
                return False
            for s in steps:
                if s.get('phase') != 'VERIFICATION':
                    print(f"FAIL: Case {cid}: COMPLETE step has phase '{s.get('phase')}' instead of VERIFICATION")
                    return False
                if not s.get('evidence_id'):
                    print(f"FAIL: Case {cid}: COMPLETE verification step has empty evidence_id")
                    return False
        elif status == 'INCOMPLETE':
            if len(steps) == 0:
                print(f"FAIL: Case {cid}: INCOMPLETE case has empty steps_json")
                return False
            has_finding = any(s.get('phase') == 'FINDING' for s in steps)
            has_remediation = any(s.get('phase') == 'REMEDIATION' for s in steps)
            has_verification = any(s.get('phase') == 'VERIFICATION' for s in steps)
            if not has_finding:
                print(f"FAIL: Case {cid}: INCOMPLETE case missing FINDING phase")
                return False
            if not has_remediation:
                print(f"FAIL: Case {cid}: INCOMPLETE case missing REMEDIATION phase")
                return False
            if not has_verification:
                print(f"FAIL: Case {cid}: INCOMPLETE case missing VERIFICATION phase")
                return False
            for s in steps:
                phase = s.get('phase')
                ev_id = s.get('evidence_id')
                if phase == 'FINDING' and not ev_id:
                    print(f"FAIL: Case {cid}: FINDING step missing evidence_id")
                    return False
                elif phase in ('REMEDIATION', 'VERIFICATION') and ev_id != '':
                    # Remediation and future verification must have empty evidence_id
                    print(f"FAIL: Case {cid}: INCOMPLETE {phase} step must have empty evidence_id, got '{ev_id}'")
                    return False

        # Validate step keys and values
        prev_step_no = 0
        prev_tuple = (0, 0, 0, "")
        for s in steps:
            req_keys = {'step_no', 'phase', 'system_id', 'resource_id', 'operation', 'state', 'evidence_id'}
            if set(s.keys()) != req_keys:
                print(f"FAIL: Case {cid}: Step keys mismatch: {set(s.keys())} != {req_keys}")
                return False

            step_no = s['step_no']
            if step_no != prev_step_no + 1:
                print(f"FAIL: Case {cid}: Non-consecutive step_no: expected {prev_step_no+1}, got {step_no}")
                return False
            prev_step_no = step_no

            phase = s['phase']
            op = s['operation']
            sys_id = s['system_id']
            res_id = s['resource_id']

            p_rank = PHASE_RANK.get(phase, 99)
            o_rank = OP_RANK.get(op, 99)
            cur_tuple = (p_rank, o_rank, sys_id, res_id)
            if cur_tuple < prev_tuple:
                print(f"FAIL: Case {cid}: Steps out of order: {prev_tuple} before {cur_tuple}")
                return False
            prev_tuple = cur_tuple

    print(f"PASS: Status distribution across {num_data_rows} cases:")
    for st, cnt in sorted(status_counts.items()):
        print(f"   {st}: {cnt} ({cnt/num_data_rows*100:.1f}%)")
    print(f"PASS: All 518 production cases fully comply with competition schema and contract rules!")
    return True


if __name__ == '__main__':
    ok = validate_output()
    if not ok:
        sys.exit(1)
