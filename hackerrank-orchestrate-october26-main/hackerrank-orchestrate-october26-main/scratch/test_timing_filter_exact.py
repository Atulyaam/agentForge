import csv, json, sys, os
from datetime import datetime, timedelta

def parse_iso(ts):
    if not ts: return None
    clean = ts.replace('Z', '+00:00')
    return datetime.fromisoformat(clean)

with open('dataset/sample_deletion_requests.csv', 'r', encoding='utf-8') as f:
    sample_requests = list(csv.DictReader(f))

with open('dataset/sample_output.csv', 'r', encoding='utf-8') as f:
    expected_output = {r['case_id']: r for r in csv.DictReader(f)}

sys.path.insert(0, 'code')
import main as prod_main

class TimingFilterPipeline(prod_main.AuditPipeline):
    def audit_case(self, req):
        case_id = req['case_id']
        req_text = req.get('request_text', '')

        # 1. Intent Classification
        if prod_main.is_not_applicable(req_text):
            return {
                'case_id': case_id,
                'deletion_status': 'NOT_APPLICABLE',
                'steps_json': []
            }

        c_email = req['email'].lower()
        u_info = self.identity_resolver.resolve(c_email)
        uid = u_info['user_id']
        audit_at = parse_iso(req['audit_at'])
        req_at = parse_iso(req['requested_at'])
        rep_at = parse_iso(req['reported_at'])

        match_idents = set()
        if uid: match_idents.add(uid.lower())
        match_idents.update(u_info['emails'])
        match_idents.update(u_info['email_hashes'])
        match_idents.update(u_info['phones'])
        match_idents.update(u_info['names'])

        # 2. Correlate worker-anonymized analytics resources for this request
        worker_anonymized_analytics = set()
        for a in self.activities:
            if a['source_system'] == 'deletion_worker' and a['target_system'] == 'analytics_platform' and a['event_type'] == 'ANONYMIZE_RECORD':
                ev_t = parse_iso(a['event_time'])
                if ev_t <= audit_at:
                    diff = (rep_at - ev_t).total_seconds()
                    if 0 <= diff <= 3600:
                        worker_anonymized_analytics.add(a['resource_id'])

        # Match Primary Account
        primary_account = None

        # Stage 1: Check evidence records captured <= audit_at for this user's account_service
        for r in self.evidence_records:
            if parse_iso(r['captured_at']) <= audit_at:
                if r['system_id'] == 'account_service' and (r['identifiers'] & match_idents):
                    primary_account = r['resource_id']
                    break

        # Stage 2: Correlate with deletion_worker activity for account_service
        if not primary_account:
            res_map = {'COMPLETE': 'SUCCESS', 'PARTIALLY_COMPLETE': 'PARTIAL', 'NOT_STARTED': 'FAILED'}
            exp_res = res_map.get(req.get('reported_status'))
            del_candidates = []
            for a in self.activities:
                if a['source_system'] == 'deletion_worker' and a['target_system'] == 'account_service' and a['event_type'] == 'DELETE_RECORD':
                    ev_t = parse_iso(a['event_time'])
                    if ev_t <= audit_at:
                        diff = abs((rep_at - ev_t).total_seconds())
                        if diff <= 7200 and (ev_t - req_at).total_seconds() >= -60:
                            res_match = (a['reported_result'] == exp_res)
                            del_candidates.append((0 if res_match else 1, diff, a['resource_id']))
            if del_candidates:
                del_candidates.sort(key=lambda x: (x[0], x[1]))
                primary_account = del_candidates[0][2]

        user_ev_records = []
        for r in self.evidence_records:
            cap_t = parse_iso(r['captured_at'])
            if cap_t <= audit_at:
                # Key fix: Violations must be captured >= req_at - 60s
                if r['kind'] in ('REMAINING_RECORD', 'EXPOSED_PII', 'ACTIVE_DATA_FLOW', 'RESTORE_RISK'):
                    if cap_t < req_at - timedelta(seconds=60):
                        continue
                if r['identifiers'] & match_idents:
                    user_ev_records.append(r)
                elif primary_account and r['resource_id'] == primary_account:
                    user_ev_records.append(r)
                elif r['system_id'] == 'analytics_platform' and r['resource_id'] in worker_anonymized_analytics:
                    user_ev_records.append(r)

        # Exact grouping and sorting from prod_main
        res_to_rec = {}
        for r in user_ev_records:
            res_id = r['resource_id']
            if res_id not in res_to_rec:
                res_to_rec[res_id] = r
            else:
                curr = res_to_rec[res_id]
                curr_is_viol = curr['kind'] in ('REMAINING_RECORD', 'EXPOSED_PII', 'ACTIVE_DATA_FLOW', 'RESTORE_RISK')
                new_is_viol = r['kind'] in ('REMAINING_RECORD', 'EXPOSED_PII', 'ACTIVE_DATA_FLOW', 'RESTORE_RISK')
                if new_is_viol and not curr_is_viol:
                    res_to_rec[res_id] = r
                elif new_is_viol == curr_is_viol:
                    if parse_iso(r['captured_at']) > parse_iso(curr['captured_at']):
                        res_to_rec[res_id] = r

        # 4. Classify Findings vs Verifications
        findings = []
        remediations = []
        verifications = []
        has_violations = False

        for res_id, r in res_to_rec.items():
            kind = r['kind']
            svc = r['system_id']
            ev_id = r['evidence_id']

            if kind == 'REMAINING_RECORD':
                has_violations = True
                findings.append({'phase': 'FINDING', 'system_id': svc, 'resource_id': res_id, 'operation': 'REPORT_REMAINING_RECORD', 'state': 'PRESENT', 'evidence_id': ev_id})
                remediations.append({'phase': 'REMEDIATION', 'system_id': svc, 'resource_id': res_id, 'operation': 'DELETE_RECORD', 'state': 'ABSENT', 'evidence_id': ''})
                verifications.append({'phase': 'VERIFICATION', 'system_id': svc, 'resource_id': res_id, 'operation': 'VERIFY_RECORD_ABSENT', 'state': 'ABSENT', 'evidence_id': ''})
            elif kind == 'EXPOSED_PII':
                has_violations = True
                findings.append({'phase': 'FINDING', 'system_id': svc, 'resource_id': res_id, 'operation': 'REPORT_EXPOSED_PII', 'state': 'PRESENT', 'evidence_id': ev_id})
                if svc == 'analytics_platform':
                    remediations.append({'phase': 'REMEDIATION', 'system_id': svc, 'resource_id': res_id, 'operation': 'ANONYMIZE_RECORD', 'state': 'ANONYMIZED', 'evidence_id': ''})
                    verifications.append({'phase': 'VERIFICATION', 'system_id': svc, 'resource_id': res_id, 'operation': 'VERIFY_RECORD_ANONYMIZED', 'state': 'ANONYMIZED', 'evidence_id': ''})
                elif svc == 'support_platform':
                    remediations.append({'phase': 'REMEDIATION', 'system_id': svc, 'resource_id': res_id, 'operation': 'REDACT_RECORD', 'state': 'REDACTED', 'evidence_id': ''})
                    verifications.append({'phase': 'VERIFICATION', 'system_id': svc, 'resource_id': res_id, 'operation': 'VERIFY_RECORD_REDACTED', 'state': 'REDACTED', 'evidence_id': ''})
                else:
                    remediations.append({'phase': 'REMEDIATION', 'system_id': svc, 'resource_id': res_id, 'operation': 'REDACT_RECORD', 'state': 'REDACTED', 'evidence_id': ''})
                    verifications.append({'phase': 'VERIFICATION', 'system_id': svc, 'resource_id': res_id, 'operation': 'VERIFY_RECORD_REDACTED', 'state': 'REDACTED', 'evidence_id': ''})
            elif kind == 'ACTIVE_DATA_FLOW':
                has_violations = True
                findings.append({'phase': 'FINDING', 'system_id': svc, 'resource_id': res_id, 'operation': 'REPORT_ACTIVE_DATA_FLOW', 'state': 'ACTIVE', 'evidence_id': ev_id})
                remediations.append({'phase': 'REMEDIATION', 'system_id': svc, 'resource_id': res_id, 'operation': 'DISABLE_DATA_FLOW', 'state': 'DISABLED', 'evidence_id': ''})
                verifications.append({'phase': 'VERIFICATION', 'system_id': svc, 'resource_id': res_id, 'operation': 'VERIFY_DATA_FLOW_DISABLED', 'state': 'DISABLED', 'evidence_id': ''})
            elif kind == 'RESTORE_RISK':
                has_violations = True
                findings.append({'phase': 'FINDING', 'system_id': svc, 'resource_id': res_id, 'operation': 'REPORT_RESTORE_RISK', 'state': 'ACTIVE', 'evidence_id': ev_id})
                remediations.append({'phase': 'REMEDIATION', 'system_id': svc, 'resource_id': res_id, 'operation': 'BLOCK_RESTORE', 'state': 'BLOCKED', 'evidence_id': ''})
                verifications.append({'phase': 'VERIFICATION', 'system_id': svc, 'resource_id': res_id, 'operation': 'VERIFY_RESTORE_BLOCKED', 'state': 'BLOCKED', 'evidence_id': ''})

        status = 'INCOMPLETE' if has_violations else 'COMPLETE'

        steps = []
        if status == 'INCOMPLETE':
            if primary_account and not any(f['resource_id'] == primary_account for f in findings):
                verifications.append({'phase': 'VERIFICATION', 'system_id': 'account_service', 'resource_id': primary_account, 'operation': 'VERIFY_RECORD_ABSENT', 'state': 'ABSENT', 'evidence_id': ''})

            for res_id, r in res_to_rec.items():
                if r['kind'] == 'RETAINED_RECORD':
                    verifications.append({'phase': 'VERIFICATION', 'system_id': 'security_service', 'resource_id': res_id, 'operation': 'VERIFY_RECORD_PRESENT', 'state': 'PRESENT', 'evidence_id': ''})

            steps = prod_main.sort_steps(findings + remediations + verifications)

        else:
            comp_verif = []
            for res_id, r in res_to_rec.items():
                k = r['kind']
                svc = r['system_id']
                ev_id = r['evidence_id']
                if k == 'ABSENT_RECORD':
                    comp_verif.append({'phase': 'VERIFICATION', 'system_id': svc, 'resource_id': res_id, 'operation': 'VERIFY_RECORD_ABSENT', 'state': 'ABSENT', 'evidence_id': ev_id})
                elif k == 'RETAINED_RECORD':
                    comp_verif.append({'phase': 'VERIFICATION', 'system_id': svc, 'resource_id': res_id, 'operation': 'VERIFY_RECORD_PRESENT', 'state': 'PRESENT', 'evidence_id': ev_id})
                elif k == 'REDACTED_RECORD':
                    comp_verif.append({'phase': 'VERIFICATION', 'system_id': svc, 'resource_id': res_id, 'operation': 'VERIFY_RECORD_REDACTED', 'state': 'REDACTED', 'evidence_id': ev_id})
                elif k == 'ANONYMIZED_RECORD':
                    comp_verif.append({'phase': 'VERIFICATION', 'system_id': svc, 'resource_id': res_id, 'operation': 'VERIFY_RECORD_ANONYMIZED', 'state': 'ANONYMIZED', 'evidence_id': ev_id})
                elif k == 'DISABLED_FLOW':
                    comp_verif.append({'phase': 'VERIFICATION', 'system_id': svc, 'resource_id': res_id, 'operation': 'VERIFY_DATA_FLOW_DISABLED', 'state': 'DISABLED', 'evidence_id': ev_id})
                elif k == 'BLOCKED_RESTORE':
                    comp_verif.append({'phase': 'VERIFICATION', 'system_id': svc, 'resource_id': res_id, 'operation': 'VERIFY_RESTORE_BLOCKED', 'state': 'BLOCKED', 'evidence_id': ev_id})

            if primary_account and not any(v['resource_id'] == primary_account for v in comp_verif):
                best_snap = None
                for cap_t, fid in self.account_snaps:
                    if cap_t <= audit_at:
                        best_snap = fid
                    else:
                        break
                if best_snap:
                    comp_verif.append({'phase': 'VERIFICATION', 'system_id': 'account_service', 'resource_id': primary_account, 'operation': 'VERIFY_RECORD_ABSENT', 'state': 'ABSENT', 'evidence_id': best_snap})

            steps = prod_main.sort_steps(comp_verif)

        return {
            'case_id': case_id,
            'deletion_status': status,
            'steps_json': steps
        }

p_test = TimingFilterPipeline('.')

total_cases = len(sample_requests)
status_matches = 0
total_exp_steps = sum(len(json.loads(expected_output[r['case_id']]['steps_json'])) for r in sample_requests)
step_matches = 0
field_matches = 0
total_fields = 0
exact_sequences = 0

for req in sample_requests:
    cid = req['case_id']
    exp_r = expected_output[cid]
    exp_status = exp_r['deletion_status']
    exp_steps = json.loads(exp_r['steps_json'])

    pred = p_test.audit_case(req)
    pred_status = pred['deletion_status']
    pred_steps = pred['steps_json']

    is_status_match = (exp_status == pred_status)
    if is_status_match: status_matches += 1
    is_exact = (is_status_match and exp_steps == pred_steps)
    if is_exact: exact_sequences += 1

    c_step_matches = 0
    c_field_matches = 0
    min_len = min(len(exp_steps), len(pred_steps))
    for i in range(min_len):
        es = exp_steps[i]
        ps = pred_steps[i]
        match_step = True
        for k in ['phase', 'system_id', 'resource_id', 'operation', 'state', 'evidence_id']:
            if es.get(k) == ps.get(k): c_field_matches += 1
            else: match_step = False
        if match_step: c_step_matches += 1

    step_matches += c_step_matches
    field_matches += c_field_matches
    total_fields += len(exp_steps) * 6 + abs(len(pred_steps) - len(exp_steps)) * 6

print(f"=== Timing Filter Pipeline Metrics ===")
print(f"Status Accuracy:      {status_matches}/{total_cases} ({status_matches/total_cases*100:.1f}%)")
print(f"Step Matching:        {step_matches}/{total_exp_steps} ({step_matches/total_exp_steps*100:.1f}%)")
print(f"Field Alignment:      {field_matches}/{total_fields} ({field_matches/total_fields*100:.1f}%)")
print(f"Field Recall:         {field_matches}/1158 ({field_matches/1158*100:.1f}%)")
print(f"Exact Sequences:      {exact_sequences}/{total_cases} ({exact_sequences/total_cases*100:.1f}%)")
