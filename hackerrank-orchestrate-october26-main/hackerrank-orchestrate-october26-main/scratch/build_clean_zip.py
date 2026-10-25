import os
import zipfile

repo_root = os.path.abspath(".")
zip_path = os.path.join(repo_root, "code.zip")

print(f"Building clean code.zip at: {zip_path}")
if os.path.exists(zip_path):
    os.remove(zip_path)

files_to_add = []

# Add README.md
readme_path = os.path.join(repo_root, "README.md")
if os.path.exists(readme_path):
    files_to_add.append((readme_path, "README.md"))

# Walk code/ directory
code_dir = os.path.join(repo_root, "code")
for root, dirs, files in os.walk(code_dir):
    # filter out __pycache__ and hidden dirs
    dirs[:] = [d for d in dirs if d != '__pycache__' and not d.startswith('.')]
    for file in files:
        if file.endswith(('.pyc', '.bak')) or file.startswith('.'):
            continue
        full_path = os.path.join(root, file)
        arcname = os.path.relpath(full_path, repo_root).replace('\\', '/')
        files_to_add.append((full_path, arcname))

with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
    for full_path, arcname in sorted(files_to_add, key=lambda x: x[1]):
        print(f"Adding: {arcname}")
        zf.write(full_path, arcname)

print(f"\nSuccessfully built code.zip with {len(files_to_add)} files.")
