import csv, json, sys, os
from datetime import datetime, timedelta

def parse_iso(ts):
    if not ts: return None
    clean = ts.replace('Z', '+00:00')
    return datetime.fromisoformat(clean)

# Load sample requests and expected output
with open('dataset/sample_deletion_requests.csv', 'r', encoding='utf-8') as f:
    sample_requests = list(csv.DictReader(f))

with open('dataset/sample_output.csv', 'r', encoding='utf-8') as f:
    expected_output = {r['case_id']: r for r in csv.DictReader(f)}

sys.path.insert(0, 'code')
import main as prod_main

# Let's inspect prod_main
p = prod_main.AuditPipeline('.')
print("Loaded base pipeline.")
