import os, json, re

# Find evidence_92 and evidence_94 files
with open('code/main.py', 'r', encoding='utf-8') as f:
    text = f.read()

import sys
sys.path.insert(0, 'code')
import main as prod_main

idx = prod_main.EvidenceIndexer('.')
for ev_id in ['evidence_92', 'evidence_94']:
    ef = idx.manifest[ev_id]
    fpath = os.path.join('.', 'dataset', ef['file_path'])
    print(f"=== {ev_id}: {ef['file_path']} ===")
    with open(fpath, 'r', encoding='utf-8') as f:
        for line in f:
            if 'service="analytics_platform"' in line or 'service=analytics_platform' in line:
                print(line.strip())
