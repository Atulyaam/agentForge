import os

analytics_ids = ['analytics_5335', 'analytics_4566', 'analytics_4574', 'analytics_6077', 'analytics_9406', 'analytics_1895']

for aid in analytics_ids:
    print(f"\n--- Searching for {aid} ---")
    for root, dirs, files in os.walk('dataset'):
        for file in files:
            if file.endswith(('.csv', '.sql', '.json', '.log', '.txt')) and not file.endswith('sample_output.csv'):
                fpath = os.path.join(root, file)
                try:
                    with open(fpath, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                        if aid in content:
                            print(f"  Found in: {fpath}")
                            # print line
                            for line in content.splitlines():
                                if aid in line:
                                    print(f"    {line.strip()[:150]}")
                except Exception:
                    pass
