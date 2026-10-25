import csv, json, sys
sys.path.insert(0, 'code')
import main as current_main

manifest = {}
with open('dataset/evidence_files.csv', 'r', encoding='utf-8') as f:
    for r in csv.DictReader(f):
        manifest[r['file_id']] = r

with open('dataset/deletion_requests.csv', 'r', encoding='utf-8') as f:
    requests = {r['case_id']: r for r in csv.DictReader(f)}

with open('dataset/sample_output.csv', 'r', encoding='utf-8') as f:
    samples = {r['case_id']: r for r in csv.DictReader(f)}

print("Checking findings in sample_output.csv:")
for cid, s_row in samples.items():
    req = requests[cid]
    req_t = current_main.parse_iso(req['requested_at'])
    steps = json.loads(s_row['steps_json'])
    for s in steps:
        if s['phase'] == 'FINDING':
            ev_id = s.get('evidence_id')
            cap_t = current_main.parse_iso(manifest[ev_id]['captured_at'])
            if cap_t < req_t:
                print(f"  VIOLATION: {cid} finding {s['resource_id']} has cap_t {cap_t} < req_t {req_t}")

print("Done checking. If no violations above, 100% of sample findings satisfy cap_t >= req_t!")
