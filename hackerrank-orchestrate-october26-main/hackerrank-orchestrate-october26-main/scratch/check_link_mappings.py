import csv, os
from datetime import datetime

def parse_iso(ts):
    if not ts: return None
    clean = ts.replace('Z', '+00:00')
    return datetime.fromisoformat(clean)

manifest = {}
with open('dataset/evidence_files.csv', 'r', encoding='utf-8') as f:
    for r in csv.DictReader(f):
        manifest[r['file_id']] = r

with open('dataset/system_activity.csv', 'r', encoding='utf-8') as f:
    links = [r for r in csv.DictReader(f) if r.get('event_type') == 'LINK_RESOURCE_IDENTITY']

print(f"Total LINK_RESOURCE_IDENTITY events: {len(links)}")
for l in links:
    ev_t = parse_iso(l['event_time'])
    best_ev_id = None
    best_diff = 999999
    for fid, ef in manifest.items():
        cap_t = parse_iso(ef['captured_at'])
        diff = abs((ev_t - cap_t).total_seconds())
        if diff < best_diff and diff <= 3600:
            best_diff = diff
            best_ev_id = fid
    ef = manifest[best_ev_id]
    print(f"{l['activity_id']} ({l['target_system']}:{l['resource_id']}) -> {best_ev_id} ({ef['file_path']}) diff={best_diff}s [file_cap={ef['captured_at']} act_time={l['event_time']}]")
