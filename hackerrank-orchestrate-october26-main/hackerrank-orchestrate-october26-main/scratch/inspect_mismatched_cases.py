import csv, json, sys
sys.path.insert(0, 'code')
from main import AuditPipeline

pipeline = AuditPipeline('.')

with open('dataset/sample_deletion_requests.csv', 'r', encoding='utf-8') as f:
    sample_requests = list(csv.DictReader(f))

with open('dataset/sample_output.csv', 'r', encoding='utf-8') as f:
    expected_output = {r['case_id']: r for r in csv.DictReader(f)}

for req in sample_requests:
    cid = req['case_id']
    exp_r = expected_output[cid]
    exp_steps = json.loads(exp_r['steps_json'])
    pred = pipeline.audit_case(req)
    pred_steps = pred['steps_json']

    if exp_steps != pred_steps:
        print(f"\n==================== {cid} (Exp: {len(exp_steps)}, Pred: {len(pred_steps)}) ====================")
        print("Expected steps:")
        for s in exp_steps:
            print(f"  {s['step_no']}: {s['phase']} | {s['system_id']} | {s['resource_id']} | {s['operation']} | {s['state']} | {s['evidence_id']}")
        print("Predicted steps:")
        for s in pred_steps:
            print(f"  {s['step_no']}: {s['phase']} | {s['system_id']} | {s['resource_id']} | {s['operation']} | {s['state']} | {s['evidence_id']}")
