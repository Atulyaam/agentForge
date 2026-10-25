import subprocess, sys

# Get old code/main.py content from git 694f077
cmd = ["git", "show", "694f077:code/main.py"]
old_code = subprocess.check_output(cmd, text=True)

with open('scratch/old_main.py', 'w', encoding='utf-8') as f:
    f.write(old_code)

print("Saved scratch/old_main.py from commit 694f077.")
