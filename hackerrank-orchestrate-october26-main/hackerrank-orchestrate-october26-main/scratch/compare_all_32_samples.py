import csv, json, sys
sys.path.insert(0, 'code')
from main import AuditPipeline

pipeline = AuditPipeline('.')

with open('dataset/sample_deletion_requests.csv', 'r', encoding='utf-8') as f:
    sample_requests = list(csv.DictReader(f))

with open('dataset/sample_output.csv', 'r', encoding='utf-8') as f:
    expected_output = {r['case_id']: r for r in csv.DictReader(f)}

print(f"{'Case':<8} {'Exp St':<12} {'Pred St':<12} {'Exp Steps':<10} {'Pred Steps':<10} {'Diffs'}")
print("-" * 80)

for req in sample_requests:
    cid = req['case_id']
    exp_r = expected_output[cid]
    exp_status = exp_r['deletion_status']
    exp_steps = json.loads(exp_r['steps_json'])

    pred = pipeline.audit_case(req)
    pred_status = pred['deletion_status']
    pred_steps = pred['steps_json']

    # check differences
    diffs = []
    if exp_status != pred_status:
        diffs.append(f"Status mismatch: {exp_status} vs {pred_status}")
    if len(exp_steps) != len(pred_steps):
        diffs.append(f"Step count: {len(exp_steps)} vs {len(pred_steps)}")
    else:
        for i, (es, ps) in enumerate(zip(exp_steps, pred_steps), 1):
            for k in ['phase', 'system_id', 'resource_id', 'operation', 'state', 'evidence_id']:
                if es.get(k) != ps.get(k):
                    diffs.append(f"Step {i} {k}: exp={es.get(k)} pred={ps.get(k)}")

    diff_str = "; ".join(diffs) if diffs else "EXACT MATCH"
    print(f"{cid:<8} {exp_status:<12} {pred_status:<12} {len(exp_steps):<10} {len(pred_steps):<10} {diff_str}")
