import csv
from datetime import datetime

def parse_iso(ts):
    return datetime.fromisoformat(ts.replace('Z', '+00:00'))

with open('dataset/sample_deletion_requests.csv', 'r', encoding='utf-8') as f:
    reqs = list(csv.DictReader(f))

with open('dataset/system_activity.csv', 'r', encoding='utf-8') as f:
    acts = [r for r in csv.DictReader(f) if r['event_type'] == 'ANONYMIZE_RECORD' and r['reported_result'] == 'SUCCESS']

# Build global 1-to-1 FIFO map between (rep_at batch) requests and worker activities
# For each rep_at, find all SUCCESS ANONYMIZE_RECORD activities in [rep_at - 3600s, rep_at]
# And assign them 1-to-1 to requests reported at rep_at in FIFO order of requested_at
batch_map = {}
req_by_rep = {}
for r in reqs:
    req_by_rep.setdefault(r['reported_at'], []).append(r)

for rep, r_list in req_by_rep.items():
    rep_dt = parse_iso(rep)
    matching_acts = [a for a in acts if 0 <= (rep_dt - parse_iso(a['event_time'])).total_seconds() <= 3600]
    matching_acts.sort(key=lambda a: parse_iso(a['event_time']))
    
    # Sort requests by requested_at
    # Filter to requests that are COMPLETE or don't already have analytics finding
    # Let's see:
    r_list_sorted = sorted(r_list, key=lambda r: parse_iso(r['requested_at']))
    for req_obj, act in zip(r_list_sorted, matching_acts):
        batch_map[req_obj['case_id']] = act['resource_id']

import json
with open('dataset/sample_output.csv', 'r', encoding='utf-8') as f:
    sample_out = list(csv.DictReader(f))

for r in sample_out:
    cid = r['case_id']
    steps = json.loads(r['steps_json'])
    gt_ana = [s['resource_id'] for s in steps if s['system_id'] == 'analytics_platform' and s['operation'] == 'VERIFY_RECORD_ANONYMIZED']
    pred_ana = batch_map.get(cid)
    if gt_ana or pred_ana:
        print(f"{cid}: GT = {gt_ana}, PRED = {pred_ana}, Match = {gt_ana == ([pred_ana] if pred_ana else [])}")
