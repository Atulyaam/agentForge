import csv, json, sys, os
from datetime import datetime

# Load sample requests and expected output
with open('dataset/sample_deletion_requests.csv', 'r', encoding='utf-8') as f:
    sample_requests = list(csv.DictReader(f))

with open('dataset/sample_output.csv', 'r', encoding='utf-8') as f:
    expected_output = {r['case_id']: r for r in csv.DictReader(f)}

sys.path.insert(0, 'code')
import main as current_main

sys.path.insert(0, 'scratch')
import old_main

p_old = old_main.AuditPipeline('.')
p_curr = current_main.AuditPipeline('.')

def evaluate_pipeline(p, label):
    total_cases = len(sample_requests)
    status_matches = 0
    total_exp_steps = sum(len(json.loads(expected_output[r['case_id']]['steps_json'])) for r in sample_requests)
    step_matches = 0
    field_matches = 0
    total_fields = 0
    exact_sequences = 0
    case_results = {}

    for req in sample_requests:
        cid = req['case_id']
        exp_r = expected_output[cid]
        exp_status = exp_r['deletion_status']
        exp_steps = json.loads(exp_r['steps_json'])

        pred = p.audit_case(req)
        pred_status = pred['deletion_status']
        pred_steps = pred['steps_json']

        is_status_match = (exp_status == pred_status)
        if is_status_match:
            status_matches += 1

        is_exact = (is_status_match and exp_steps == pred_steps)
        if is_exact:
            exact_sequences += 1

        c_step_matches = 0
        c_field_matches = 0
        min_len = min(len(exp_steps), len(pred_steps))
        for i in range(min_len):
            es = exp_steps[i]
            ps = pred_steps[i]
            match_step = True
            for k in ['phase', 'system_id', 'resource_id', 'operation', 'state', 'evidence_id']:
                if es.get(k) == ps.get(k):
                    c_field_matches += 1
                else:
                    match_step = False
            if match_step:
                c_step_matches += 1

        step_matches += c_step_matches
        field_matches += c_field_matches
        total_fields += len(exp_steps) * 6 + abs(len(pred_steps) - len(exp_steps)) * 6
        case_results[cid] = {
            'exact': is_exact,
            'exp_len': len(exp_steps),
            'pred_len': len(pred_steps),
            'step_matches': c_step_matches,
            'field_matches': c_field_matches
        }

    print(f"=== {label} Metrics ===")
    print(f"Status Accuracy:      {status_matches}/{total_cases} ({status_matches/total_cases*100:.1f}%)")
    print(f"Step Matching:        {step_matches}/{total_exp_steps} ({step_matches/total_exp_steps*100:.1f}%)")
    print(f"Field Alignment:      {field_matches}/{total_fields} ({field_matches/total_fields*100:.1f}%)")
    print(f"Field Recall:         {field_matches}/1158 ({field_matches/1158*100:.1f}%)")
    print(f"Exact Sequences:      {exact_sequences}/{total_cases} ({exact_sequences/total_cases*100:.1f}%)")
    return case_results

res_old = evaluate_pipeline(p_old, "Old (694f077)")
print()
res_curr = evaluate_pipeline(p_curr, "Current")

print("\nDifferences per case:")
for cid in sorted(expected_output.keys()):
    ro = res_old[cid]
    rc = res_curr[cid]
    if ro != rc:
        print(f"  {cid}: Old(exact={ro['exact']}, steps={ro['step_matches']}/{ro['exp_len']}) -> Curr(exact={rc['exact']}, steps={rc['step_matches']}/{rc['exp_len']})")
