import csv
from datetime import datetime

def parse_iso(ts):
    if not ts: return None
    return datetime.fromisoformat(ts.replace('Z', '+00:00'))

with open('dataset/system_activity.csv', 'r', encoding='utf-8') as f:
    anonymize_acts = [r for r in csv.DictReader(f) if r.get('source_system') == 'deletion_worker' and r.get('target_system') == 'analytics_platform' and r.get('event_type') == 'ANONYMIZE_RECORD']

print(f"Total deletion_worker ANONYMIZE_RECORD events: {len(anonymize_acts)}")
for a in anonymize_acts[:15]:
    print(a['activity_id'], a['event_time'], a['resource_id'], a['reported_result'])

with open('dataset/sample_deletion_requests.csv', 'r', encoding='utf-8') as f:
    sample_reqs = list(csv.DictReader(f))

with open('dataset/sample_output.csv', 'r', encoding='utf-8') as f:
    expected = {r['case_id']: r for r in csv.DictReader(f)}

print("\nMatching sample cases to deletion worker anonymize activities:")
for req in sample_reqs:
    cid = req['case_id']
    rep_at = parse_iso(req['reported_at'])
    audit_at = parse_iso(req['audit_at'])
    req_at = parse_iso(req['requested_at'])
    candidates = []
    for a in anonymize_acts:
        ev_t = parse_iso(a['event_time'])
        if req_at <= ev_t <= audit_at:
            diff = (rep_at - ev_t).total_seconds()
            if 0 <= diff <= 3600:
                candidates.append((diff, a['resource_id'], a['activity_id'], a['event_time']))
    if candidates:
        print(f"  {cid} (rep={req['reported_at']}): {candidates}")
