import csv, json
from datetime import datetime

def parse_iso(ts):
    if not ts: return None
    return datetime.fromisoformat(ts.replace('Z', '+00:00'))

manifest = {}
with open('dataset/evidence_files.csv', 'r', encoding='utf-8') as f:
    for r in csv.DictReader(f):
        manifest[r['file_id']] = r

with open('dataset/sample_deletion_requests.csv', 'r', encoding='utf-8') as f:
    requests = {r['case_id']: r for r in csv.DictReader(f)}

with open('dataset/sample_output.csv', 'r', encoding='utf-8') as f:
    samples = list(csv.DictReader(f))

print(f"{'Case':<8} {'Finding Ev':<12} {'Req Time':<22} {'Ev Cap Time':<22} {'Cap >= Req?'}")
print("-" * 75)

for r in samples:
    cid = r['case_id']
    req = requests[cid]
    req_t = parse_iso(req['requested_at'])
    steps = json.loads(r['steps_json'])
    for s in steps:
        if s['phase'] == 'FINDING':
            ev_id = s.get('evidence_id')
            if ev_id in manifest:
                cap_t = parse_iso(manifest[ev_id]['captured_at'])
                is_after_req = cap_t >= req_t
                print(f"{cid:<8} {ev_id:<12} {req['requested_at']:<22} {manifest[ev_id]['captured_at']:<22} {is_after_req}")
