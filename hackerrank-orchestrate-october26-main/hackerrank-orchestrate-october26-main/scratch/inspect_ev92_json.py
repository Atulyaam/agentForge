import os, json

with open('dataset/evidence/records/service_resource_export_20260915_114455.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

for item in data:
    if item.get('service') == 'analytics_platform':
        print(item)
