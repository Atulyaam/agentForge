import os
import sys
import csv
import json

sys.path.insert(0, 'code')
import main as prod_main

repo_root = os.path.abspath(".")
p = prod_main.AuditPipeline(repo_root)

with open('dataset/sample_deletion_requests.csv', 'r', encoding='utf-8') as f:
    sample_requests = list(csv.DictReader(f))

with open('dataset/sample_output.csv', 'r', encoding='utf-8') as f:
    expected_output = {r['case_id']: (r['deletion_status'], json.loads(r['steps_json'])) for r in csv.DictReader(f)}

exact_cases = []
mismatched_cases = []

for req in sample_requests:
    cid = req['case_id']
    exp_status, exp_steps = expected_output[cid]
    res = p.audit_case(req)
    pred_status = res['deletion_status']
    pred_steps = res['steps_json']
    
    if exp_status == pred_status and exp_steps == pred_steps:
        exact_cases.append(cid)
    else:
        mismatched_cases.append((cid, req, exp_status, exp_steps, pred_status, pred_steps))

print(f"=== Public Benchmark Evaluation ===")
print(f"Exact Sequence Matches: {len(exact_cases)} / 32 ({len(exact_cases)/32*100:.1f}%)")
print(f"Non-exact Cases:        {len(mismatched_cases)} / 32 ({len(mismatched_cases)/32*100:.1f}%)")
print(f"Exact Cases List: {exact_cases}\n")

for cid, req, exp_status, exp_steps, pred_status, pred_steps in mismatched_cases:
    print(f"==================================================")
    print(f"CASE: {cid} | Subject: {req['email']} | User: {p.identity_resolver.resolve(req['email'].lower())['user_id']}")
    print(f"Requested: {req['requested_at']} | Reported: {req['reported_at']} ({req['reported_status']}) | Audit: {req['audit_at']}")
    print(f"Status: Expected '{exp_status}' vs Predicted '{pred_status}' (Match: {exp_status == pred_status})")
    print(f"Step Count: Expected {len(exp_steps)} vs Predicted {len(pred_steps)}")
    print(f"--- Steps Diff ---")
    max_steps = max(len(exp_steps), len(pred_steps))
    for i in range(max_steps):
        es = exp_steps[i] if i < len(exp_steps) else None
        ps = pred_steps[i] if i < len(pred_steps) else None
        if es == ps:
            print(f"  [{i+1}] MATCH: {es['phase']} {es['system_id']} {es['resource_id']} {es['operation']} {es['state']} {es.get('evidence_id','')}")
        else:
            print(f"  [{i+1}] MISMATCH:")
            print(f"       EXP:  {es}")
            print(f"       PRED: {ps}")
    print()
