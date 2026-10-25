import csv, json
with open('dataset/sample_output.csv', 'r', encoding='utf-8') as f:
    rows = list(csv.DictReader(f))

for r in rows:
    steps = json.loads(r['steps_json'])
    ana_steps = [s for s in steps if s['system_id'] == 'analytics_platform']
    if ana_steps:
        print(f"{r['case_id']}: {ana_steps}")
