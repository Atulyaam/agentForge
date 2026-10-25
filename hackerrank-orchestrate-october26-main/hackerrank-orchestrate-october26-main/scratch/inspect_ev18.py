import pypdf
reader = pypdf.PdfReader('dataset/evidence/documents/account_history_report_20260718.pdf')
for i, page in enumerate(reader.pages):
    print(f"--- Page {i} ---")
    print(page.extract_text())
