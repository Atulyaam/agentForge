import os
import sys
import shutil
import zipfile
import subprocess
import tempfile
import hashlib

repo_root = os.path.abspath(".")
zip_path = os.path.join(repo_root, "code.zip")
dataset_src = os.path.join(repo_root, "dataset")
expected_output_path = os.path.join(repo_root, "output.csv")

with open(expected_output_path, 'rb') as f:
    expected_hash = hashlib.sha256(f.read()).hexdigest()

print(f"Testing packaged code.zip from {zip_path}")
print(f"Root output.csv SHA-256: {expected_hash}")

with tempfile.TemporaryDirectory() as tmpdir:
    print(f"Clean sandbox temp directory: {tmpdir}")
    
    # Unpack code.zip
    with zipfile.ZipFile(zip_path, 'r') as zf:
        zf.extractall(tmpdir)
    print(f"Unpacked members: {os.listdir(tmpdir)}")
    print(f"Code members: {os.listdir(os.path.join(tmpdir, 'code'))}")

    # Copy dataset into tmpdir (or create directory junction)
    tmp_dataset = os.path.join(tmpdir, "dataset")
    print(f"Copying dataset to {tmp_dataset}...")
    shutil.copytree(dataset_src, tmp_dataset)

    # 1. Run evaluation/main.py
    print("\n--- Running python code/evaluation/main.py ---")
    res1 = subprocess.run([sys.executable, "code/evaluation/main.py"], cwd=tmpdir, capture_output=True, text=True)
    print(res1.stdout)
    if res1.returncode != 0:
        print("ERROR:", res1.stderr)
        sys.exit(1)

    # 2. Run code/main.py
    print("\n--- Running python code/main.py ---")
    res2 = subprocess.run([sys.executable, "code/main.py"], cwd=tmpdir, capture_output=True, text=True)
    print(res2.stdout)
    if res2.returncode != 0:
        print("ERROR:", res2.stderr)
        sys.exit(1)

    # 3. Run code/evaluation/validate_output.py
    print("\n--- Running python code/evaluation/validate_output.py ---")
    res3 = subprocess.run([sys.executable, "code/evaluation/validate_output.py"], cwd=tmpdir, capture_output=True, text=True)
    print(res3.stdout)
    if res3.returncode != 0:
        print("ERROR:", res3.stderr)
        sys.exit(1)

    # 4. Run code/evaluation/validate_evidence_grounding.py
    print("\n--- Running python code/evaluation/validate_evidence_grounding.py ---")
    res4 = subprocess.run([sys.executable, "code/evaluation/validate_evidence_grounding.py"], cwd=tmpdir, capture_output=True, text=True)
    print(res4.stdout)
    if res4.returncode != 0:
        print("ERROR:", res4.stderr)
        sys.exit(1)

    # Check output.csv hash
    gen_out = os.path.join(tmpdir, "output.csv")
    with open(gen_out, 'rb') as f:
        gen_hash = hashlib.sha256(f.read()).hexdigest()
    print(f"\nGenerated output.csv SHA-256: {gen_hash}")
    assert gen_hash == expected_hash, f"Hash mismatch: {gen_hash} != {expected_hash}"
    print("SUCCESS: Packaged execution reproduced identical output.csv hash!")

print("\nALL PACKAGE VERIFICATION CHECKS PASSED!")
