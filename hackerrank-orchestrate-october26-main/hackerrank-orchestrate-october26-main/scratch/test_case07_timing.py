import sys, csv
sys.path.insert(0, 'code')
import main as current_main

p = current_main.AuditPipeline('.')
with open('dataset/sample_deletion_requests.csv', 'r', encoding='utf-8') as f:
    for r in csv.DictReader(f):
        if r['case_id'] == 'case_07':
            req = r

c_email = req['email'].lower()
u_info = p.identity_resolver.resolve(c_email)
match_idents = set([u_info['user_id']] + list(u_info['emails']) + list(u_info['phones']) + list(u_info['names']))
audit_at = current_main.parse_iso(req['audit_at'])
req_at = current_main.parse_iso(req['requested_at'])

print(f"Case 07: req_at={req['requested_at']}, audit_at={req['audit_at']}")
for r in p.evidence_records:
    if r['identifiers'] & match_idents:
        cap_t = current_main.parse_iso(r['captured_at'])
        if cap_t <= audit_at:
            print(f"  Ev: {r['evidence_id']} ({r['system_id']}:{r['resource_id']}) cap={r['captured_at']} kind={r['finding_kind']} (cap >= req? {cap_t >= req_at})")
