# Ghost Data Still Exists — Deletion Audit Solution
**HackerRank Orchestrate — October 2026**

## Project Overview

Ghost Data Still Exists is a Python-based deletion audit solution that evaluates deletion requests against participant-provided identity information, system activity, evidence records, snapshots, and deletion policies.

The pipeline determines whether a request is COMPLETE, INCOMPLETE, or NOT_APPLICABLE and generates ordered verification or remediation steps based on the available evidence.

## Technology Stack

- Python (3.10+)
- Python standard library for CSV processing, JSON parsing, timestamps, and file operations
- `pypdf` for PDF evidence extraction

## Setup

Use a supported Python installation. From the repository root, install the required PDF dependency:

```bash
python -m pip install pypdf
```

Keep the supplied `dataset/` directory in the expected repository location when running the solution. The dataset is provided separately and must not be bundled inside `code.zip`.

## Run the Solution

Generate predictions for all production deletion requests:

```bash
python code/main.py
```

The program reads `dataset/deletion_requests.csv` and generates `output.csv` in the repository root.

## Evaluation and Validation

Run the public sample evaluation and custom regression tests:

```bash
python code/evaluation/main.py
```

Validate the output contract:

```bash
python code/evaluation/validate_output.py output.csv
```

Validate evidence references and temporal constraints:

```bash
python code/evaluation/validate_evidence_grounding.py output.csv
```

Run these commands from the repository root, with the supplied dataset available.

## Output Format

The generated `output.csv` uses the exact header:

```csv
case_id,deletion_status,steps_json
```

It contains one row per production deletion request. The `steps_json` column contains a JSON array of ordered steps that follow the challenge's required schema and status-specific rules.

## Approach Overview

The solution uses structured evidence extraction, identity resolution, timestamp-aware evidence filtering, system/resource correlation, deletion-policy reasoning, and deterministic step generation.

The public sample evaluator measures prediction quality. Structural and evidence-grounding validators check additional output requirements. Passing these checks does not guarantee identical performance on hidden evaluation cases.

## Known Limitations

Resource identity may remain ambiguous when the available participant-visible evidence does not establish a reliable relationship. In such situations, the solution should avoid fabricating identifiers or claiming unsupported deletion verification.
