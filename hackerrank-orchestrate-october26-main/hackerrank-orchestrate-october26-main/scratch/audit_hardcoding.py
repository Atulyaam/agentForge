import re

with open('code/main.py', 'r', encoding='utf-8') as f:
    lines = f.readlines()

checks = {
    'case_': [],
    'sample_output': [],
    'evidence_': [],
    'hardcoded_user': [],
    'hardcoded_account': [],
}

for i, line in enumerate(lines, 1):
    l = line.strip()
    if 'case_' in l and not l.startswith('#'):
        # Check if it's case_id or a specific case literal like 'case_01'
        m = re.findall(r"['\"]case_\d+['\"]", l)
        if m:
            checks['case_'].append((i, l))
    if 'sample_output' in l and not l.startswith('#'):
        checks['sample_output'].append((i, l))
    if 'evidence_' in l and not l.startswith('#'):
        # Find literals like 'evidence_XX'
        m = re.findall(r"['\"]evidence_\d+['\"]", l)
        if m:
            checks['evidence_'].append((i, l, m))
    m_u = re.findall(r"['\"]user_\d+['\"]", l)
    if m_u and not l.startswith('#'):
        checks['hardcoded_user'].append((i, l, m_u))
    m_a = re.findall(r"['\"]account_\d+['\"]", l)
    if m_a and not l.startswith('#'):
        checks['hardcoded_account'].append((i, l, m_a))

for k, matches in checks.items():
    print(f"=== {k}: {len(matches)} occurrences ===")
    for m in matches[:10]:
        print(f"  Line {m[0]}: {m[1][:120]}")
    if len(matches) > 10:
        print(f"  ... and {len(matches)-10} more")
