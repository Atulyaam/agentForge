import csv
from datetime import datetime

def parse_iso(ts):
    if not ts: return None
    return datetime.fromisoformat(ts.replace('Z', '+00:00'))

with open('dataset/system_activity.csv', 'r', encoding='utf-8') as f:
    activities = list(csv.DictReader(f))

# Load all requests from sample and production
all_reqs = []
with open('dataset/sample_deletion_requests.csv', 'r', encoding='utf-8') as f:
    all_reqs.extend(list(csv.DictReader(f)))
with open('dataset/deletion_requests.csv', 'r', encoding='utf-8') as f:
    all_reqs.extend(list(csv.DictReader(f)))

# Group requests by reported_at
reqs_by_rep = {}
for r in all_reqs:
    rep = r['reported_at']
    if rep not in reqs_by_rep:
        reqs_by_rep[rep] = []
    reqs_by_rep[rep].append(r)

res_map = {'COMPLETE': 'SUCCESS', 'PARTIALLY_COMPLETE': 'PARTIAL', 'NOT_STARTED': 'FAILED'}

# For batches on 2026-08-30, 2026-09-02, 2026-09-06
test_dates = ['2026-08-30T12:00:00Z', '2026-09-02T12:00:00Z', '2026-09-06T12:00:00Z']

for rep in test_dates:
    batch_reqs = reqs_by_rep.get(rep, [])
    rep_at = parse_iso(rep)
    # find deletion worker account delete activities in [rep_at - 7200, rep_at]
    batch_acts = []
    for a in activities:
        if a['source_system'] == 'deletion_worker' and a['target_system'] == 'account_service' and a['event_type'] == 'DELETE_RECORD':
            ev_t = parse_iso(a['event_time'])
            diff = (rep_at - ev_t).total_seconds()
            if 0 <= diff <= 7200:
                batch_acts.append(a)
    batch_acts.sort(key=lambda x: x['event_time'])
    print(f"\n==================== Batch {rep} ====================")
    print(f"Requests ({len(batch_reqs)}):")
    for r in batch_reqs:
        print(f"  {r['case_id']}: req={r['requested_at']} status={r['reported_status']} email={r['email']}")
    print(f"Activities ({len(batch_acts)}):")
    for a in batch_acts:
        print(f"  {a['activity_id']}: time={a['event_time']} res={a['resource_id']} result={a['reported_result']}")
