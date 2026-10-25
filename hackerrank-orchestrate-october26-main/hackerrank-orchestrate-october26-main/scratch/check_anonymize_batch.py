import csv
from datetime import datetime

def parse_iso(ts):
    return datetime.fromisoformat(ts.replace('Z', '+00:00'))

with open('dataset/sample_deletion_requests.csv', 'r', encoding='utf-8') as f:
    reqs = list(csv.DictReader(f))

with open('dataset/system_activity.csv', 'r', encoding='utf-8') as f:
    acts = [r for r in csv.DictReader(f) if r['event_type'] == 'ANONYMIZE_RECORD' and r['reported_result'] == 'SUCCESS']

req_by_rep = {}
for r in reqs:
    rep = r['reported_at']
    req_by_rep.setdefault(rep, []).append(r)

for rep, r_list in sorted(req_by_rep.items()):
    rep_dt = parse_iso(rep)
    matching_acts = [a for a in acts if 0 <= (rep_dt - parse_iso(a['event_time'])).total_seconds() <= 3600]
    if matching_acts:
        cids = [r['case_id'] for r in r_list]
        print(f"Reported At: {rep} ({len(r_list)} requests: {cids})")
        print(f"   Acts ({len(matching_acts)}): {[(a['event_time'], a['resource_id']) for a in matching_acts]}")
