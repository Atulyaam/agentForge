import csv
from datetime import datetime

def parse_iso(ts):
    if not ts: return None
    return datetime.fromisoformat(ts.replace('Z', '+00:00'))

manifest = {}
with open('dataset/evidence_files.csv', 'r', encoding='utf-8') as f:
    for r in csv.DictReader(f):
        manifest[r['file_id']] = r

account_snaps = []
allowed_origins = (
    'customer_data_inventory_capture',
    'customer_account_failover_replica_capture',
    'customer_data_reporting_replica_capture',
    'customer_data_regional_replicas_capture',
    'records_assurance_snapshot_bundle',
    'service_resource_export',
    'customer_account_service'
)

for fid, ef in manifest.items():
    if ef.get('origin') in allowed_origins:
        account_snaps.append((parse_iso(ef['captured_at']), fid, ef['origin']))

account_snaps.sort(key=lambda x: x[0])
print(f"Total account snapshots: {len(account_snaps)}")
for t, fid, orig in account_snaps:
    print(t, fid, orig)

# Now check all 518 cases in deletion_requests.csv
with open('dataset/deletion_requests.csv', 'r', encoding='utf-8') as f:
    reqs = list(csv.DictReader(f))

missing = []
for r in reqs:
    audit_at = parse_iso(r['audit_at'])
    best_snap = None
    for cap_t, fid, orig in account_snaps:
        if cap_t <= audit_at:
            best_snap = fid
        else:
            break
    if not best_snap:
        missing.append((r['case_id'], r['audit_at']))

print(f"\nCases without any account snapshot <= audit_at: {len(missing)}")
for m in missing:
    print(m)
