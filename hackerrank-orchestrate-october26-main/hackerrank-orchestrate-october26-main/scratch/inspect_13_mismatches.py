import sys, json, csv
from scratch.test_batch_pipeline import p_batch, sample_requests, expected_output

mismatches = []
for req in sample_requests:
    cid = req['case_id']
    exp = json.loads(expected_output[cid]['steps_json'])
    pred = p_batch.audit_case(req)['steps_json']
    
    if exp != pred:
        mismatches.append((cid, exp, pred))

print(f"Total mismatched cases: {len(mismatches)}")
for cid, exp, pred in mismatches:
    print(f"\n==================== {cid} ====================")
    print(f"EXP count: {len(exp)}, PRED count: {len(pred)}")
    for i in range(max(len(exp), len(pred))):
        e = exp[i] if i < len(exp) else None
        p = pred[i] if i < len(pred) else None
        match = (e == p)
        print(f"  [{i+1}] {'MATCH' if match else 'DIFF'}")
        if not match:
            print(f"      EXP:  {e}")
            print(f"      PRED: {p}")
