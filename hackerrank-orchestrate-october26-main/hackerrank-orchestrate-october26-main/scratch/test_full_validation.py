import sys, os
sys.path.insert(0, '.')
from scratch.test_batch_pipeline import BatchAwarePipeline

p = BatchAwarePipeline('.', requests_file='dataset/deletion_requests.csv')
out_file = p.run_full('dataset/deletion_requests.csv', 'output_test.csv')
print("Finished run_full, testing validators on output_test.csv...")

sys.path.insert(0, 'code/evaluation')
import validate_output as vo
import validate_evidence_grounding as veg

v1 = vo.validate_output('.', 'output_test.csv')
print("validate_output result:", v1)

v2 = veg.run_evidence_audit('.', 'output_test.csv')
print("validate_evidence_grounding result:", v2)
