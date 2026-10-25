import csv, json, sys
sys.path.insert(0, 'code')
from main import AuditPipeline

pipeline = AuditPipeline('.')

with open('dataset/sample_deletion_requests.csv', 'r', encoding='utf-8') as f:
    sample_requests = list(csv.DictReader(f))

with open('dataset/sample_output.csv', 'r', encoding='utf-8') as f:
    expected_output = {r['case_id']: r for r in csv.DictReader(f)}

early_cases = ['case_03', 'case_04', 'case_07', 'case_09', 'case_18', 'case_20', 'case_21', 'case_23', 'case_24', 'case_25', 'case_26', 'case_27']

for cid in early_cases:
    req = next(r for r in sample_requests if r['case_id'] == cid)
    exp_r = expected_output[cid]
    exp_steps = json.loads(exp_r['steps_json'])
    pred = pipeline.audit_case(req)
    pred_steps = pred['steps_json']

    print(f"\n==================== {cid} (Exp: {len(exp_steps)}, Pred: {len(pred_steps)}) ====================")
    print("Expected steps:")
    for s in exp_steps:
        print(f"  {s['step_no']}: {s['phase']} | {s['system_id']} | {s['resource_id']} | {s['operation']} | {s['state']} | {s['evidence_id']}")
    print("Predicted steps:")
    for s in pred_steps:
        print(f"  {s['step_no']}: {s['phase']} | {s['system_id']} | {s['resource_id']} | {s['operation']} | {s['state']} | {s['evidence_id']}")
