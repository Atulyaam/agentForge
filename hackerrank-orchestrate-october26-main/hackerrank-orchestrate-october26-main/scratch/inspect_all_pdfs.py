import pypdf, csv

manifest = {}
with open('dataset/evidence_files.csv', 'r', encoding='utf-8') as f:
    for r in csv.DictReader(f):
        manifest[r['file_id']] = r

pdf_files = {k: v for k, v in manifest.items() if v['file_path'].lower().endswith('.pdf')}
for k, v in pdf_files.items():
    print(f"\n==================== {k}: {v['file_path']} ====================")
    reader = pypdf.PdfReader('dataset/' + v['file_path'])
    for i, p in enumerate(reader.pages):
        print(f"--- Page {i+1} ---")
        print(p.extract_text())
