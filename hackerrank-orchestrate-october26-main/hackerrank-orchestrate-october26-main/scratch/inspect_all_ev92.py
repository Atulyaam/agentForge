import json

with open('dataset/evidence/records/service_resource_export_20260915_114455.json', 'r', encoding='utf-8') as f:
    d = json.load(f)

exports = d.get('service_exports', {})
for svc, content in exports.items():
    print(f"\n--- Service: {svc} ---")
    if isinstance(content, dict):
        for k, v in content.items():
            print(f"  Key {k} (len {len(v)}):")
            for item in v[:3]:
                print(f"    {item}")
