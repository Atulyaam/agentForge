import csv
from datetime import datetime
def parse_iso(ts): return datetime.fromisoformat(ts.replace('Z', '+00:00'))

with open('dataset/sample_deletion_requests.csv', 'r', encoding='utf-8') as f:
    sample_requests = {r['case_id']: r for r in csv.DictReader(f)}

with open('dataset/system_activity.csv', 'r', encoding='utf-8') as f:
    acts = [a for a in csv.DictReader(f) if a['source_system'] == 'deletion_worker' and a['target_system'] == 'account_service']

for cid in ['case_23', 'case_31', 'case_32']:
    r = sample_requests[cid]
    rep_at = parse_iso(r['reported_at'])
    print(f"=== {cid} === rep_at: {r['reported_at']}, status: {r['reported_status']}")
    for a in acts:
        ev_t = parse_iso(a['event_time'])
        diff = (rep_at - ev_t).total_seconds()
        if 0 <= diff <= 7200:
            print(f"  {a['event_time']} {a['resource_id']} {a['reported_result']} diff: {diff}")
