import json

with open('dataset/evidence/records/service_resource_export_20260915_114455.json', 'r', encoding='utf-8') as f:
    d = json.load(f)

profiles = d.get('service_exports', {}).get('analytics_platform', {}).get('profiles', [])
print(f"Total analytics profiles in evidence_92: {len(profiles)}")
for p in profiles:
    if p.get('resource_id') in ['analytics_5335', 'analytics_4566', 'analytics_4574', 'analytics_6077', 'analytics_1895']:
        print(p)
