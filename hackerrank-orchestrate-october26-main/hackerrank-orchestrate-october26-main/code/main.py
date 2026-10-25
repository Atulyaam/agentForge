"""
HackerRank Orchestrate - October 2026: Ghost Data Still Exists
Authoritative Deletion-Audit Solution Pipeline

Entry point: code/main.py
Generates: output.csv at repository root
"""

import os
import sys
import csv
import json
import re
from datetime import datetime, timedelta

try:
    from pypdf import PdfReader
except ImportError:
    PdfReader = None


# Ensure utf-8 encoding for standard outputs
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# ---------------------------------------------------------
# CONSTANTS & ENUMS
# ---------------------------------------------------------
PHASE_RANK = {'FINDING': 1, 'REMEDIATION': 2, 'VERIFICATION': 3}

OP_RANK = {
    # Findings
    'REPORT_REMAINING_RECORD': 1,
    'REPORT_EXPOSED_PII': 2,
    'REPORT_ACTIVE_DATA_FLOW': 3,
    'REPORT_RESTORE_RISK': 4,
    # Remediation
    'DISABLE_DATA_FLOW': 1,
    'BLOCK_RESTORE': 2,
    'DELETE_RECORD': 3,
    'REDACT_RECORD': 4,
    'ANONYMIZE_RECORD': 5,
    # Verification
    'VERIFY_RECORD_ABSENT': 1,
    'VERIFY_RECORD_PRESENT': 2,
    'VERIFY_RECORD_REDACTED': 3,
    'VERIFY_RECORD_ANONYMIZED': 4,
    'VERIFY_DATA_FLOW_DISABLED': 5,
    'VERIFY_RESTORE_BLOCKED': 6,
}

NON_DEL_PHRASES = [
    "leave the account active", "not asking for deletion", "keep the account as it is",
    "do not close the account", "without removing any of my records", "marketing lists only",
    "this is an information request, not a request to erase it", "leave my profile and purchase history in place",
    "want to continue using the service", "don't delete or change anything", "do not delete or change anything"
]

def parse_iso(ts):
    if not ts:
        return datetime.min
    ts = ts.replace('Z', '+00:00')
    return datetime.fromisoformat(ts)

def is_not_applicable(req_text):
    if not req_text:
        return False
    txt = req_text.lower()
    for p in NON_DEL_PHRASES:
        if p in txt:
            return True
    return False

def sort_steps(steps):
    def sort_key(s):
        p_r = PHASE_RANK.get(s['phase'], 99)
        o_r = OP_RANK.get(s['operation'], 99)
        return (p_r, o_r, s['system_id'], s['resource_id'])
    
    sorted_s = sorted(steps, key=sort_key)
    for i, s in enumerate(sorted_s, 1):
        s['step_no'] = i
    return sorted_s

# ---------------------------------------------------------
# EVIDENCE EXTRACTION & INDEXING ENGINE
# ---------------------------------------------------------
class EvidenceIndexer:
    def __init__(self, repo_root):
        self.repo_root = repo_root
        self.dataset_dir = os.path.join(repo_root, "dataset")
        self.manifest = {}
        self.all_records = []
        self._load_manifest()

    def _load_manifest(self):
        mpath = os.path.join(self.dataset_dir, "evidence_files.csv")
        with open(mpath, 'r', encoding='utf-8') as f:
            for r in csv.DictReader(f):
                self.manifest[r['file_id']] = r

    def add_rec(self, ev_id, system_id, resource_id, kind, state, idents, details=None, captured_at_override=None):
        if not resource_id or not system_id:
            return
        norm_idents = set()
        for item in idents:
            if item:
                item_str = str(item).strip()
                if item_str and item_str.lower() != 'none' and item_str.lower() != 'null':
                    norm_idents.add(item_str.lower())
        ev_info = self.manifest.get(ev_id, {})
        cap_t = captured_at_override if captured_at_override else ev_info.get('captured_at')
        self.all_records.append({
            'evidence_id': ev_id,
            'captured_at': cap_t,
            'system_id': system_id,
            'resource_id': resource_id,
            'kind': kind,
            'state': state,
            'identifiers': norm_idents,
            'details': details
        })

    def index_all(self):
        self._index_all_evidence_files()
        self._index_trace_correlated_logs()
        self._index_data_catalog_links()
        return self.all_records

    def _index_data_catalog_links(self):
        act_path = os.path.join(self.dataset_dir, "system_activity.csv")
        if not os.path.exists(act_path):
            return
        kind_map = {
            'search_service': ('REMAINING_RECORD', 'PRESENT'),
            'integration_service': ('ACTIVE_DATA_FLOW', 'ACTIVE'),
            'analytics_platform': ('EXPOSED_PII', 'PRESENT'),
            'support_platform': ('EXPOSED_PII', 'PRESENT'),
            'backup_service': ('RESTORE_RISK', 'ACTIVE'),
            'export_service': ('REMAINING_RECORD', 'PRESENT'),
            'account_service': ('REMAINING_RECORD', 'PRESENT'),
            'security_service': ('RETAINED_RECORD', 'PRESENT'),
            'identity_service': ('REDACTED_RECORD', 'REDACTED'),
            'object_storage': ('REMAINING_RECORD', 'PRESENT'),
            'marketing_platform': ('REMAINING_RECORD', 'PRESENT'),
        }
        try:
            with open(act_path, 'r', encoding='utf-8') as f:
                for a in csv.DictReader(f):
                    if a.get('event_type') == 'LINK_RESOURCE_IDENTITY':
                        svc = a.get('target_system')
                        res = a.get('resource_id')
                        ev_t = parse_iso(a.get('event_time'))
                        details = a.get('details', '')
                        m_em = re.findall(r'([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})', details)
                        m_uid = re.findall(r'(user_\d+)', details)
                        idents = set(m_em + m_uid)

                        best_ev_id = None
                        best_diff = 999999
                        for fid, ef in self.manifest.items():
                            cap_t = parse_iso(ef['captured_at'])
                            diff = abs((ev_t - cap_t).total_seconds())
                            if diff < best_diff and diff <= 3600:
                                best_diff = diff
                                best_ev_id = fid

                        if best_ev_id and svc in kind_map:
                            kind, state = kind_map[svc]
                            cap_t = parse_iso(self.manifest[best_ev_id]['captured_at'])
                            eff_time = max(cap_t, ev_t).isoformat()
                            self.add_rec(best_ev_id, svc, res, kind, state, idents, captured_at_override=eff_time)
        except Exception:
            pass

    def _index_all_evidence_files(self):
        # 1. service_resource_export (11 JSON files)
        for ev_id, ef in self.manifest.items():
            if ef['origin'] == 'service_resource_export':
                fpath = os.path.join(self.repo_root, "dataset", ef['file_path'])
                try:
                    with open(fpath, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                except Exception:
                    continue
                exports = data.get('service_exports', {})
                for item in exports.get('account_service', {}).get('profile_lookups', []):
                    res_id = item.get('resource_id')
                    prof = item.get('profile') or {}
                    idents = {prof.get('user_id'), prof.get('email'), prof.get('phone'), prof.get('full_name')}
                    if item.get('status_code') == 404:
                        self.add_rec(ev_id, 'account_service', res_id, 'ABSENT_RECORD', 'ABSENT', idents)
                    else:
                        self.add_rec(ev_id, 'account_service', res_id, 'REMAINING_RECORD', 'PRESENT', idents)
                for item in exports.get('search_service', {}).get('index_queries', []):
                    res_id = item.get('resource_id')
                    query = item.get('query')
                    hits = item.get('hits', {})
                    idents = {query}
                    for doc in hits.get('documents', []):
                        idents.update([doc.get('customer_reference'), doc.get('email'), doc.get('display_name'), doc.get('email_hash'), doc.get('phone')])
                    if hits.get('total', 0) > 0:
                        self.add_rec(ev_id, 'search_service', res_id, 'REMAINING_RECORD', 'PRESENT', idents)
                    else:
                        self.add_rec(ev_id, 'search_service', res_id, 'ABSENT_RECORD', 'ABSENT', idents)
                for item in exports.get('support_platform', {}).get('tickets', []):
                    res_id = item.get('resource_id')
                    email, name, phone, cust_ref = item.get('requester_email'), item.get('requester_name'), item.get('requester_phone'), item.get('customer_reference')
                    idents = {cust_ref, email, name, phone}
                    if email or name or phone:
                        self.add_rec(ev_id, 'support_platform', res_id, 'EXPOSED_PII', 'PRESENT', idents)
                    else:
                        self.add_rec(ev_id, 'support_platform', res_id, 'REDACTED_RECORD', 'REDACTED', idents)
                for item in exports.get('analytics_platform', {}).get('profiles', []):
                    res_id = item.get('resource_id')
                    cust_ref, email, ehash, phone = item.get('customer_reference'), item.get('email'), item.get('email_hash'), item.get('phone')
                    idents = {cust_ref, email, ehash, phone}
                    if email or ehash or phone or cust_ref:
                        self.add_rec(ev_id, 'analytics_platform', res_id, 'EXPOSED_PII', 'PRESENT', idents)
                    else:
                        self.add_rec(ev_id, 'analytics_platform', res_id, 'ANONYMIZED_RECORD', 'ANONYMIZED', idents)
                for item in exports.get('integration_service', {}).get('connectors', []):
                    res_id = item.get('resource_id')
                    idents = {item.get('customer_reference'), item.get('customer_email')}
                    if item.get('enabled'):
                        self.add_rec(ev_id, 'integration_service', res_id, 'ACTIVE_DATA_FLOW', 'ACTIVE', idents)
                    else:
                        self.add_rec(ev_id, 'integration_service', res_id, 'DISABLED_FLOW', 'DISABLED', idents)
                for item in exports.get('backup_service', {}).get('restore_entries', []):
                    res_id = item.get('resource_id')
                    idents = {item.get('customer_reference'), item.get('customer_email')}
                    if item.get('restore_allowed'):
                        self.add_rec(ev_id, 'backup_service', res_id, 'RESTORE_RISK', 'ACTIVE', idents)
                    else:
                        self.add_rec(ev_id, 'backup_service', res_id, 'BLOCKED_RESTORE', 'BLOCKED', idents)
                for item in exports.get('security_service', {}).get('audit_records', []):
                    self.add_rec(ev_id, 'security_service', item.get('resource_id'), 'RETAINED_RECORD', 'PRESENT', {item.get('subject_reference')})
                for item in exports.get('export_service', {}).get('exports', []):
                    self.add_rec(ev_id, 'export_service', item.get('resource_id'), 'REMAINING_RECORD', 'PRESENT', {item.get('customer_reference'), item.get('owner_email'), item.get('owner_phone')})

        # 2. service_readback_logs (11 log files)
        for ev_id, ef in self.manifest.items():
            if ef['origin'] == 'service_readback_logs':
                fpath = os.path.join(self.repo_root, "dataset", ef['file_path'])
                try:
                    with open(fpath, 'r', encoding='utf-8') as f:
                        for line in f:
                            if 'resource_id=' not in line or 'service=' not in line:
                                continue
                            kv = {}
                            for m in re.finditer(r'([a-zA-Z_0-9]+)=([^\s]+)', line):
                                kv[m.group(1)] = m.group(2).strip('"')
                            svc = kv.get('service')
                            res = kv.get('resource_id')
                            lkey = kv.get('lookup_key')
                            idents = {lkey} if lkey and lkey != 'null' else set()
                            if 'customer_reference' in kv and kv['customer_reference'] != 'null': idents.add(kv['customer_reference'])
                            if 'customer_email' in kv and kv['customer_email'] != 'null': idents.add(kv['customer_email'])
                            if 'email' in kv and kv['email'] != 'null': idents.add(kv['email'])
                            if 'requester_email' in kv and kv['requester_email'] != 'null': idents.add(kv['requester_email'])
                            if 'subject_reference' in kv and kv['subject_reference'] != 'null': idents.add(kv['subject_reference'])
                            
                            evt = kv.get('event', '')
                            if svc == 'account_service':
                                if kv.get('http_status') == '404' or kv.get('rows') == '0':
                                    self.add_rec(ev_id, svc, res, 'ABSENT_RECORD', 'ABSENT', idents)
                                elif kv.get('http_status') == '200' or kv.get('rows') == '1':
                                    self.add_rec(ev_id, svc, res, 'REMAINING_RECORD', 'PRESENT', idents)
                            elif svc == 'search_service':
                                if kv.get('result') == 'hit' or kv.get('total_hits', '0') != '0':
                                    self.add_rec(ev_id, svc, res, 'REMAINING_RECORD', 'PRESENT', idents)
                                else:
                                    self.add_rec(ev_id, svc, res, 'ABSENT_RECORD', 'ABSENT', idents)
                            elif svc == 'support_platform':
                                req_em = kv.get('requester_email')
                                if req_em and req_em != 'null':
                                    self.add_rec(ev_id, svc, res, 'EXPOSED_PII', 'PRESENT', idents)
                                else:
                                    self.add_rec(ev_id, svc, res, 'REDACTED_RECORD', 'REDACTED', idents)
                            elif svc == 'analytics_platform':
                                em = kv.get('email')
                                cref = kv.get('customer_reference')
                                if (em and em != 'null') or (cref and cref != 'null'):
                                    self.add_rec(ev_id, svc, res, 'EXPOSED_PII', 'PRESENT', idents)
                                else:
                                    self.add_rec(ev_id, svc, res, 'ANONYMIZED_RECORD', 'ANONYMIZED', idents)
                            elif svc == 'integration_service':
                                if kv.get('enabled') == 'true':
                                    self.add_rec(ev_id, svc, res, 'ACTIVE_DATA_FLOW', 'ACTIVE', idents)
                                else:
                                    self.add_rec(ev_id, svc, res, 'DISABLED_FLOW', 'DISABLED', idents)
                            elif svc == 'backup_service':
                                if kv.get('restore_allowed') == 'true':
                                    self.add_rec(ev_id, svc, res, 'RESTORE_RISK', 'ACTIVE', idents)
                                else:
                                    self.add_rec(ev_id, svc, res, 'BLOCKED_RESTORE', 'BLOCKED', idents)
                            elif svc == 'security_service':
                                self.add_rec(ev_id, svc, res, 'RETAINED_RECORD', 'PRESENT', idents)
                except Exception:
                    continue

        # 3. customer_data_inventory_capture (11 SQL files)
        for ev_id, ef in self.manifest.items():
            if ef['origin'] == 'customer_data_inventory_capture':
                fpath = os.path.join(self.repo_root, "dataset", ef['file_path'])
                try:
                    with open(fpath, 'r', encoding='utf-8') as f:
                        for line in f:
                            if not line.startswith("INSERT INTO"): continue
                            m = re.match(r"INSERT INTO\s+([a-zA-Z_0-9]+)\s+VALUES\s*\((.*)\);", line.strip())
                            if not m: continue
                            tbl = m.group(1)
                            vals_str = m.group(2)
                            parts = []
                            for p in re.split(r",\s*(?=(?:[^']*'[^']*')*[^']*$)", vals_str):
                                p = p.strip().strip("'")
                                parts.append(None if p == 'NULL' else p)
                            
                            if tbl == 'customer_profiles':
                                res_id = parts[0]
                                idents = {parts[1], parts[2], parts[3], parts[4]}
                                self.add_rec(ev_id, 'account_service', res_id, 'REMAINING_RECORD', 'PRESENT', idents)
                            elif tbl == 'customer_analytics_profiles':
                                res_id = parts[0]
                                idents = {parts[1], parts[2], parts[3], parts[4]}
                                has_id = any(p is not None for p in [parts[1], parts[2], parts[3], parts[4]])
                                if has_id:
                                    self.add_rec(ev_id, 'analytics_platform', res_id, 'EXPOSED_PII', 'PRESENT', idents)
                                else:
                                    self.add_rec(ev_id, 'analytics_platform', res_id, 'ANONYMIZED_RECORD', 'ANONYMIZED', idents)
                            elif tbl == 'backup_restore_entries':
                                res_id = parts[0]
                                idents = {parts[1], parts[2]}
                                ra = parts[4]
                                if ra in ('1', 1, 'true', True):
                                    self.add_rec(ev_id, 'backup_service', res_id, 'RESTORE_RISK', 'ACTIVE', idents)
                                else:
                                    self.add_rec(ev_id, 'backup_service', res_id, 'BLOCKED_RESTORE', 'BLOCKED', idents)
                            elif tbl == 'connector_subscriptions':
                                res_id = parts[0]
                                idents = {parts[1], parts[2]}
                                en = parts[4]
                                if en in ('1', 1, 'true', True):
                                    self.add_rec(ev_id, 'integration_service', res_id, 'ACTIVE_DATA_FLOW', 'ACTIVE', idents)
                                else:
                                    self.add_rec(ev_id, 'integration_service', res_id, 'DISABLED_FLOW', 'DISABLED', idents)
                            elif tbl == 'customer_search_documents':
                                res_id = parts[0]
                                idents = {parts[1], parts[2], parts[3]}
                                self.add_rec(ev_id, 'search_service', res_id, 'REMAINING_RECORD', 'PRESENT', idents)
                            elif tbl == 'customer_exports':
                                res_id = parts[0]
                                idents = {parts[1], parts[2]}
                                self.add_rec(ev_id, 'export_service', res_id, 'REMAINING_RECORD', 'PRESENT', idents)
                            elif tbl == 'security_audit_records':
                                res_id = parts[0]
                                idents = {parts[1]}
                                self.add_rec(ev_id, 'security_service', res_id, 'RETAINED_RECORD', 'PRESENT', idents)
                            elif tbl == 'support_records':
                                res_id = parts[0]
                                idents = {parts[1], parts[2], parts[3]}
                                if parts[2] or parts[3]:
                                    self.add_rec(ev_id, 'support_platform', res_id, 'EXPOSED_PII', 'PRESENT', idents)
                                else:
                                    self.add_rec(ev_id, 'support_platform', res_id, 'REDACTED_RECORD', 'REDACTED', idents)
                except Exception:
                    continue

        # 4. records_assurance_snapshot_bundle (12 JSON files)
        for ev_id, ef in self.manifest.items():
            if ef['origin'] == 'records_assurance_snapshot_bundle':
                fpath = os.path.join(self.repo_root, "dataset", ef['file_path'])
                try:
                    with open(fpath, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    for snap in data.get('snapshots', []):
                        coll = snap.get('collection')
                        recs = snap.get('records', [])
                        for r in recs:
                            res_id = r.get('resource_id')
                            if coll == 'customer_profiles':
                                idents = {r.get('user_id'), r.get('email'), r.get('phone'), r.get('name')}
                                self.add_rec(ev_id, 'account_service', res_id, 'REMAINING_RECORD', 'PRESENT', idents)
                            elif coll == 'deleted_customer_references':
                                idents = {r.get('subject_reference'), r.get('email'), r.get('phone'), r.get('name'), r.get('email_hash')}
                                if r.get('email') or r.get('name') or r.get('phone') or r.get('email_hash'):
                                    self.add_rec(ev_id, 'identity_service', res_id, 'EXPOSED_PII', 'PRESENT', idents)
                                else:
                                    self.add_rec(ev_id, 'identity_service', res_id, 'REDACTED_RECORD', 'REDACTED', idents)
                            elif coll == 'security_audit_events':
                                self.add_rec(ev_id, 'security_service', res_id, 'RETAINED_RECORD', 'PRESENT', {r.get('subject_reference')})
                            elif coll == 'support_conversations':
                                idents = {r.get('subject_reference'), r.get('customer_email'), r.get('customer_name')}
                                if r.get('customer_email') or r.get('customer_name'):
                                    self.add_rec(ev_id, 'support_platform', res_id, 'EXPOSED_PII', 'PRESENT', idents)
                                else:
                                    self.add_rec(ev_id, 'support_platform', res_id, 'REDACTED_RECORD', 'REDACTED', idents)
                            elif coll == 'ticket_attachments':
                                idents = {r.get('owner_reference'), r.get('owner_email')}
                                self.add_rec(ev_id, 'support_platform', res_id, 'REMAINING_RECORD', 'PRESENT', idents)
                            elif coll == 'customer_analytics_reports':
                                idents = {r.get('user_id'), r.get('email'), r.get('phone'), r.get('email_hash')}
                                if r.get('email') or r.get('phone') or r.get('email_hash') or r.get('user_id'):
                                    self.add_rec(ev_id, 'analytics_platform', res_id, 'EXPOSED_PII', 'PRESENT', idents)
                                else:
                                    self.add_rec(ev_id, 'analytics_platform', res_id, 'ANONYMIZED_RECORD', 'ANONYMIZED', idents)
                            elif coll == 'customer_search_documents':
                                self.add_rec(ev_id, 'search_service', res_id, 'REMAINING_RECORD', 'PRESENT', {r.get('email'), r.get('user_id')})
                            elif coll == 'customer_export_jobs':
                                self.add_rec(ev_id, 'export_service', res_id, 'REMAINING_RECORD', 'PRESENT', {r.get('owner_email'), r.get('customer_reference')})
                            elif coll == 'backup_catalog':
                                idents = {r.get('customer_reference'), r.get('customer_email')}
                                if r.get('restore_allowed'):
                                    self.add_rec(ev_id, 'backup_service', res_id, 'RESTORE_RISK', 'ACTIVE', idents)
                                else:
                                    self.add_rec(ev_id, 'backup_service', res_id, 'BLOCKED_RESTORE', 'BLOCKED', idents)
                            elif coll == 'connector_configurations':
                                idents = {r.get('customer_reference'), r.get('customer_email')}
                                if r.get('enabled'):
                                    self.add_rec(ev_id, 'integration_service', res_id, 'ACTIVE_DATA_FLOW', 'ACTIVE', idents)
                                else:
                                    self.add_rec(ev_id, 'integration_service', res_id, 'DISABLED_FLOW', 'DISABLED', idents)
                except Exception:
                    continue

        # 5. customer_account_service (evidence_03 handover text)
        for ev_id, ef in self.manifest.items():
            if ef['file_path'].endswith('customer_account_handover_20261001.txt'):
                fpath = os.path.join(self.repo_root, "dataset", ef['file_path'])
                try:
                    with open(fpath, 'r', encoding='utf-8') as f:
                        for line in f:
                            if not line.startswith('- '): continue
                            parts = [p.strip() for p in line[2:].split('|')]
                            if len(parts) >= 6:
                                ts, svc, res_id, cat, status, ident = parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]
                                idents = {ident}
                                if status == 'NOT_FOUND':
                                    self.add_rec(ev_id, svc, res_id, 'ABSENT_RECORD', 'ABSENT', idents)
                                elif status == 'FOUND':
                                    if svc == 'security_service':
                                        self.add_rec(ev_id, svc, res_id, 'RETAINED_RECORD', 'PRESENT', idents)
                                    else:
                                        self.add_rec(ev_id, svc, res_id, 'REMAINING_RECORD', 'PRESENT', idents)
                                elif status == 'IDENTIFIABLE':
                                    self.add_rec(ev_id, svc, res_id, 'EXPOSED_PII', 'PRESENT', idents)
                                elif status == 'ANONYMIZED':
                                    self.add_rec(ev_id, svc, res_id, 'ANONYMIZED_RECORD', 'ANONYMIZED', idents)
                                elif status == 'REDACTED':
                                    self.add_rec(ev_id, svc, res_id, 'REDACTED_RECORD', 'REDACTED', idents)
                                elif status == 'ACTIVE':
                                    if svc == 'backup_service':
                                        self.add_rec(ev_id, svc, res_id, 'RESTORE_RISK', 'ACTIVE', idents)
                                    elif svc == 'integration_service':
                                        self.add_rec(ev_id, svc, res_id, 'ACTIVE_DATA_FLOW', 'ACTIVE', idents)
                                elif status == 'BLOCKED':
                                    self.add_rec(ev_id, svc, res_id, 'BLOCKED_RESTORE', 'BLOCKED', idents)
                                elif status == 'DISABLED':
                                    self.add_rec(ev_id, svc, res_id, 'DISABLED_FLOW', 'DISABLED', idents)
                except Exception:
                    continue

        # 6. customer_accounts_failover_replica_20260902.sql (evidence_54)
        for ev_id, ef in self.manifest.items():
            if ef['file_path'].endswith('customer_accounts_failover_replica_20260902.sql'):
                fpath = os.path.join(self.repo_root, "dataset", ef['file_path'])
                try:
                    with open(fpath, 'r', encoding='utf-8') as f:
                        for line in f:
                            if 'customer_profiles_failover_replica' in line and line.startswith('INSERT INTO'):
                                m = re.findall(r"VALUES\('(.*?)'\);", line)
                                if m:
                                    parts = [p.strip() for p in m[0].split("','")]
                                    res_id = parts[0]
                                    idents = {parts[1], parts[2], parts[3], parts[4]}
                                    self.add_rec(ev_id, 'account_service', res_id, 'REMAINING_RECORD', 'PRESENT', idents)
                except Exception:
                    continue

        # 7. customer_search_primary_20260910.sql (evidence_57)
        for ev_id, ef in self.manifest.items():
            if ef['file_path'].endswith('customer_search_primary_20260910.sql'):
                fpath = os.path.join(self.repo_root, "dataset", ef['file_path'])
                try:
                    with open(fpath, 'r', encoding='utf-8') as f:
                        for line in f:
                            if 'INSERT INTO' in line:
                                m = re.findall(r"VALUES\('(.*?)'\);", line)
                                if m:
                                    parts = [p.strip() for p in m[0].split("','")]
                                    res_id = parts[0]
                                    idents = {parts[1], parts[2], parts[3]}
                                    self.add_rec(ev_id, 'search_service', res_id, 'REMAINING_RECORD', 'PRESENT', idents)
                except Exception:
                    continue

        # 8. customer_export_jobs_20260914.json (evidence_59)
        for ev_id, ef in self.manifest.items():
            if ef['file_path'].endswith('customer_export_jobs_20260914.json'):
                fpath = os.path.join(self.repo_root, "dataset", ef['file_path'])
                try:
                    with open(fpath, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    for r in data.get('records', []):
                        self.add_rec(ev_id, 'export_service', r.get('resource_id'), 'REMAINING_RECORD', 'PRESENT', {r.get('owner_email')})
                except Exception:
                    continue

        # 9. support_replica.log (evidence_61)
        for ev_id, ef in self.manifest.items():
            if ef['file_path'].endswith('support_replica.log'):
                fpath = os.path.join(self.repo_root, "dataset", ef['file_path'])
                traces = {}
                try:
                    with open(fpath, 'r', encoding='utf-8') as f:
                        for line in f:
                            kv = {}
                            for m in re.finditer(r'([a-zA-Z_0-9]+)=([^\s]+)', line):
                                kv[m.group(1)] = m.group(2).strip('"')
                            tid = kv.get('trace_id')
                            if tid:
                                if tid not in traces: traces[tid] = {}
                                traces[tid].update(kv)
                            else:
                                res_id = kv.get('resource_id')
                                lkey = kv.get('lookup_key')
                                if res_id and lkey and kv.get('rows') == '1':
                                    self.add_rec(ev_id, 'support_platform', res_id, 'REMAINING_RECORD', 'PRESENT', {lkey})
                    for tid, tkv in traces.items():
                        res_id = tkv.get('resource_id')
                        lkey = tkv.get('lookup_key')
                        if res_id and lkey:
                            rows = tkv.get('rows', '')
                            mf = tkv.get('marker_found', '')
                            if rows == '1' or mf == 'false':
                                self.add_rec(ev_id, 'support_platform', res_id, 'REMAINING_RECORD', 'PRESENT', {lkey})
                except Exception:
                    continue

        # 10. customer_analytics_report_20260907.json (evidence_56)
        for ev_id, ef in self.manifest.items():
            if ef['file_path'].endswith('customer_analytics_report_20260907.json'):
                fpath = os.path.join(self.repo_root, "dataset", ef['file_path'])
                try:
                    with open(fpath, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    for r in data.get('records', []):
                        res_id = r.get('resource_id')
                        raw_idents = {r.get('user_id'), r.get('email'), r.get('phone'), r.get('email_hash')}
                        clean_idents = {str(x).lower() for x in raw_idents if x and str(x).lower() not in ('none', 'null')}
                        if clean_idents:
                            self.add_rec(ev_id, 'analytics_platform', res_id, 'EXPOSED_PII', 'PRESENT', clean_idents)
                        else:
                            self.add_rec(ev_id, 'analytics_platform', res_id, 'ANONYMIZED_RECORD', 'ANONYMIZED', set())
                except Exception:
                    continue

        # 11. Dynamic PDF Parsing
        for ev_id, ef in self.manifest.items():
            if ef.get('file_path', '').lower().endswith('.pdf'):
                fpath = os.path.join(self.repo_root, "dataset", ef['file_path'])
                if not os.path.exists(fpath):
                    continue
                try:
                    if PdfReader is not None:
                        reader = PdfReader(fpath)
                        txt = ''.join([page.extract_text() or '' for page in reader.pages])
                    else:
                        txt = ''
                    fname = os.path.basename(ef['file_path']).lower()
                    if 'delivery_correction' in fname:
                        m_res = re.search(r"support_(\d+)", txt)
                        if not m_res:
                            continue
                        res_id = f"support_{m_res.group(1)}"
                        m_em = re.search(r"([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})", txt)
                        m_ph = re.search(r"(\+\d[\d\s]+)", txt)
                        idents = set()
                        if m_em: idents.add(m_em.group(1).lower())
                        if m_ph: idents.add(m_ph.group(1).strip())
                        self.add_rec(ev_id, 'support_platform', res_id, 'REMAINING_RECORD', 'PRESENT', idents)
                    elif 'security_retention' in fname:
                        m_res = re.search(r"audit_record_(\d+)", txt)
                        if not m_res:
                            continue
                        res_id = f"audit_record_{m_res.group(1)}"
                        m_uid = re.search(r"(user_\d+)", txt)
                        idents = {m_uid.group(1)} if m_uid else set()
                        self.add_rec(ev_id, 'security_service', res_id, 'RETAINED_RECORD', 'PRESENT', idents)
                except Exception:
                    continue

        # 12. central_observability_export logs (12 files)
        for ev_id, ef in self.manifest.items():
            if ef['origin'] == 'central_observability_export':
                fpath = os.path.join(self.repo_root, "dataset", ef['file_path'])
                try:
                    with open(fpath, 'r', encoding='utf-8') as f:
                        for line in f:
                            if 'resource_id=' not in line or 'service=' not in line: continue
                            kv = {}
                            for m in re.finditer(r'([a-zA-Z_0-9]+)=([^\s]+)', line):
                                kv[m.group(1)] = m.group(2).strip('"')
                            svc = kv.get('service')
                            res = kv.get('resource_id')
                            ckey = kv.get('correlation_key')
                            skey = kv.get('subject_key')
                            lkey = kv.get('lookup_key')
                            mval = kv.get('matched_value')
                            idents = {k for k in [ckey, skey, lkey, mval] if k and k != 'null'}
                            evt = kv.get('event', '')
                            if svc == 'account_service':
                                if kv.get('http_status') == '404' or kv.get('rows') == '0':
                                    self.add_rec(ev_id, svc, res, 'ABSENT_RECORD', 'ABSENT', idents)
                                elif kv.get('http_status') == '200' or kv.get('rows') == '1':
                                    self.add_rec(ev_id, svc, res, 'REMAINING_RECORD', 'PRESENT', idents)
                            elif svc == 'search_service':
                                if kv.get('result') == 'hit':
                                    self.add_rec(ev_id, svc, res, 'REMAINING_RECORD', 'PRESENT', idents)
                                else:
                                    self.add_rec(ev_id, svc, res, 'ABSENT_RECORD', 'ABSENT', idents)
                            elif svc == 'support_platform':
                                if evt == 'message_pii_scan' or 'pii' in evt:
                                    self.add_rec(ev_id, svc, res, 'EXPOSED_PII', 'PRESENT', idents)
                                else:
                                    self.add_rec(ev_id, svc, res, 'REDACTED_RECORD', 'REDACTED', idents)
                            elif svc == 'analytics_platform':
                                if kv.get('rows') == '1' or kv.get('email_opt_in'):
                                    self.add_rec(ev_id, svc, res, 'REMAINING_RECORD', 'PRESENT', idents)
                                else:
                                    self.add_rec(ev_id, svc, res, 'ANONYMIZED_RECORD', 'ANONYMIZED', idents)
                            elif svc == 'integration_service':
                                if kv.get('enabled') == 'true':
                                    self.add_rec(ev_id, svc, res, 'ACTIVE_DATA_FLOW', 'ACTIVE', idents)
                                else:
                                    self.add_rec(ev_id, svc, res, 'DISABLED_FLOW', 'DISABLED', idents)
                            elif svc == 'backup_service':
                                if kv.get('deletion_block') == 'false' or kv.get('eligible') == 'true':
                                    self.add_rec(ev_id, svc, res, 'RESTORE_RISK', 'ACTIVE', idents)
                                else:
                                    self.add_rec(ev_id, svc, res, 'BLOCKED_RESTORE', 'BLOCKED', idents)
                except Exception:
                    continue

        # 13. Read replica SQL files (customer_data_read_replica_*.sql)
        for ev_id, ef in self.manifest.items():
            if ef['origin'] == 'customer_data_read_replica_capture':
                fpath = os.path.join(self.repo_root, "dataset", ef['file_path'])
                try:
                    with open(fpath, 'r', encoding='utf-8') as f:
                        for line in f:
                            if 'customer_data_read_replica' in line and line.startswith('INSERT INTO'):
                                m = re.findall(r"VALUES\('(.*?)'\);", line)
                                if m:
                                    parts = [p.strip() for p in m[0].split("','")]
                                    if len(parts) >= 4:
                                        res_id = parts[0]
                                        svc = parts[1]
                                        tbl = parts[2]
                                        raw_json = parts[3]
                                        try:
                                            jdata = json.loads(raw_json)
                                            doc = jdata.get('document', {}) if isinstance(jdata.get('document'), dict) else {}
                                            idents = set()
                                            for k in ['user_id', 'email', 'phone', 'email_hash', 'customer_reference', 'subject_reference', 'subject_selector', 'owner_email', 'uploaded_by', 'full_name', 'display_name']:
                                                v = jdata.get(k)
                                                if v and v != 'null': idents.add(str(v).lower())
                                                v_doc = doc.get(k)
                                                if v_doc and v_doc != 'null': idents.add(str(v_doc).lower())

                                            if svc == 'account_service':
                                                kind, state = ('REMAINING_RECORD', 'PRESENT')
                                            elif svc == 'search_service':
                                                kind, state = ('REMAINING_RECORD', 'PRESENT')
                                            elif svc == 'analytics_platform':
                                                has_pii = any(jdata.get(k) for k in ['email', 'phone', 'user_id', 'email_hash'])
                                                kind, state = ('EXPOSED_PII', 'PRESENT') if has_pii else ('ANONYMIZED_RECORD', 'ANONYMIZED')
                                            elif svc == 'support_platform':
                                                if tbl == 'ticket_attachments':
                                                    kind, state = ('REMAINING_RECORD', 'PRESENT')
                                                else:
                                                    has_pii = bool(jdata.get('requester_email') or jdata.get('customer_name') or 'pii' in jdata.get('message_text', '').lower())
                                                    kind, state = ('EXPOSED_PII', 'PRESENT') if has_pii else ('REDACTED_RECORD', 'REDACTED')
                                            elif svc == 'integration_service':
                                                en = jdata.get('enabled')
                                                kind, state = ('ACTIVE_DATA_FLOW', 'ACTIVE') if en else ('DISABLED_FLOW', 'DISABLED')
                                            elif svc == 'backup_service':
                                                ra = jdata.get('restore_allowed')
                                                kind, state = ('RESTORE_RISK', 'ACTIVE') if ra else ('BLOCKED_RESTORE', 'BLOCKED')
                                            elif svc in ('security_service', 'legal_service'):
                                                kind, state = ('RETAINED_RECORD', 'PRESENT')
                                                svc = 'security_service'
                                            else:
                                                kind, state = ('REMAINING_RECORD', 'PRESENT')

                                            self.add_rec(ev_id, svc, res_id, kind, state, idents)
                                        except Exception:
                                            pass
                except Exception:
                    continue

    def _index_trace_correlated_logs(self):
        for ev_id, ef in self.manifest.items():
            if ef['origin'] in ('central_observability_export', 'service_readback_logs'):
                fpath = os.path.join(self.repo_root, "dataset", ef['file_path'])
                traces = {}
                try:
                    with open(fpath, 'r', encoding='utf-8') as f:
                        for line in f:
                            if 'trace_id=' not in line: continue
                            kv = {}
                            for m in re.finditer(r'([a-zA-Z_0-9]+)=([^\s]+)', line):
                                kv[m.group(1)] = m.group(2).strip('"')
                            tid = kv.get('trace_id')
                            if tid:
                                if tid not in traces: traces[tid] = {}
                                traces[tid].update(kv)
                except Exception:
                    continue

                for tid, kv in traces.items():
                    svc = kv.get('service')
                    res = kv.get('resource_id')
                    if not svc or not res: continue
                    idents = set()
                    for k in ['subject_key', 'subject_ref', 'lookup_key', 'correlation_key', 'email', 'customer_email', 'customer_reference', 'user_id', 'requester_email']:
                        v = kv.get(k)
                        if v and v != 'null':
                            idents.add(v)
                    
                    evt = kv.get('event', '')
                    res_val = kv.get('result', '')
                    http_st = kv.get('http_status', '')
                    rows = kv.get('rows', '')
                    enabled = kv.get('enabled', '')
                    del_block = kv.get('deletion_block', '')
                    ra = kv.get('restore_allowed', '')
                    eligible = kv.get('eligible', '')

                    if svc == 'account_service':
                        if http_st == '404' or rows == '0':
                            self.add_rec(ev_id, svc, res, 'ABSENT_RECORD', 'ABSENT', idents)
                        elif http_st == '200' or rows == '1':
                            self.add_rec(ev_id, svc, res, 'REMAINING_RECORD', 'PRESENT', idents)
                    elif svc == 'search_service':
                        if res_val == 'hit' or kv.get('total_hits', '0') not in ('0', ''):
                            self.add_rec(ev_id, svc, res, 'REMAINING_RECORD', 'PRESENT', idents)
                        else:
                            self.add_rec(ev_id, svc, res, 'ABSENT_RECORD', 'ABSENT', idents)
                    elif svc == 'support_platform':
                        req_em = kv.get('requester_email')
                        if (req_em and req_em != 'null') or 'pii' in evt:
                            self.add_rec(ev_id, svc, res, 'EXPOSED_PII', 'PRESENT', idents)
                        else:
                            self.add_rec(ev_id, svc, res, 'REDACTED_RECORD', 'REDACTED', idents)
                    elif svc == 'analytics_platform':
                        em = kv.get('email')
                        cref = kv.get('customer_reference')
                        if (em and em != 'null') or (cref and cref != 'null') or kv.get('email_opt_in'):
                            self.add_rec(ev_id, svc, res, 'EXPOSED_PII', 'PRESENT', idents)
                        else:
                            self.add_rec(ev_id, svc, res, 'ANONYMIZED_RECORD', 'ANONYMIZED', idents)
                    elif svc == 'integration_service':
                        if enabled == 'true':
                            self.add_rec(ev_id, svc, res, 'ACTIVE_DATA_FLOW', 'ACTIVE', idents)
                        else:
                            self.add_rec(ev_id, svc, res, 'DISABLED_FLOW', 'DISABLED', idents)
                    elif svc == 'backup_service':
                        if del_block == 'false' or ra == 'true' or eligible == 'true':
                            self.add_rec(ev_id, svc, res, 'RESTORE_RISK', 'ACTIVE', idents)
                        else:
                            self.add_rec(ev_id, svc, res, 'BLOCKED_RESTORE', 'BLOCKED', idents)
                    elif svc == 'security_service':
                        self.add_rec(ev_id, svc, res, 'RETAINED_RECORD', 'PRESENT', idents)


# ---------------------------------------------------------
# IDENTITY RESOLVER
# ---------------------------------------------------------
class IdentityResolver:
    def __init__(self, repo_root):
        self.repo_root = repo_root
        self.user_by_id = {}
        self.email_to_uid = {}
        self._load()

    def _load(self):
        with open(os.path.join(self.repo_root, "dataset", "user_identities.csv"), 'r', encoding='utf-8') as f:
            for u in csv.DictReader(f):
                uid = u['user_id']
                em = u['email'].lower() if u['email'] else None
                eh = u['email_hash'].lower() if u['email_hash'] else None
                ph = u['phone'] if u['phone'] else None
                nm = u['name'].lower() if u['name'] else None
                
                self.user_by_id[uid] = {
                    'user_id': uid, 'name': nm, 'email': em, 'phone': ph, 'email_hash': eh,
                    'emails': {em} if em else set(),
                    'email_hashes': {eh} if eh else set(),
                    'phones': {ph} if ph else set(),
                    'names': {nm} if nm else set(),
                }
                if em:
                    self.email_to_uid[em] = uid

        with open(os.path.join(self.repo_root, "dataset", "user_audit_log.csv"), 'r', encoding='utf-8') as f:
            for a in csv.DictReader(f):
                uid = a['user_id']
                if uid not in self.user_by_id:
                    self.user_by_id[uid] = {
                        'user_id': uid, 'name': None, 'email': None, 'phone': None,
                        'email_hash': None, 'emails': set(), 'email_hashes': set(),
                        'phones': set(), 'names': set()
                    }
                u = self.user_by_id[uid]
                fld = a['field_name']
                old_v = a['old_value']
                new_v = a['new_value']
                if fld == 'email':
                    if old_v:
                        u['emails'].add(old_v.lower())
                        self.email_to_uid[old_v.lower()] = uid
                    if new_v:
                        u['emails'].add(new_v.lower())
                        self.email_to_uid[new_v.lower()] = uid
                elif fld == 'email_hash':
                    if old_v: u['email_hashes'].add(old_v.lower())
                    if new_v: u['email_hashes'].add(new_v.lower())
                elif fld == 'phone':
                    if old_v: u['phones'].add(old_v)
                    if new_v: u['phones'].add(new_v)

    def resolve(self, email):
        em = email.lower().strip()
        uid = self.email_to_uid.get(em)
        if uid and uid in self.user_by_id:
            return self.user_by_id[uid]
        return {
            'user_id': uid, 'name': None, 'email': em, 'phone': None, 'email_hash': None,
            'emails': {em}, 'email_hashes': set(), 'phones': set(), 'names': set()
        }


# ---------------------------------------------------------
# AUDIT PIPELINE ENGINE
# ---------------------------------------------------------
class AuditPipeline:
    def __init__(self, repo_root):
        self.repo_root = repo_root
        self.dataset_dir = os.path.join(repo_root, "dataset")
        self.indexer = EvidenceIndexer(repo_root)
        self.identity_resolver = IdentityResolver(repo_root)
        self.evidence_records = self.indexer.index_all()
        self._load_activities()
        self.req_to_account = {}
        self.req_to_analytics = {}
        for req_fname in ("sample_deletion_requests.csv", "deletion_requests.csv"):
            rfpath = os.path.join(self.dataset_dir, req_fname)
            if os.path.exists(rfpath):
                self.load_request_batches(rfpath)
        self.account_snaps = []
        allowed_origins = (
            'customer_data_inventory_capture',
            'customer_account_failover_replica_capture',
            'customer_data_reporting_replica_capture',
            'customer_data_regional_replicas_capture',
            'records_assurance_snapshot_bundle',
            'service_resource_export',
            'customer_account_service'
        )
        for fid, ef in self.indexer.manifest.items():
            if ef.get('origin') in allowed_origins:
                self.account_snaps.append((parse_iso(ef['captured_at']), fid))
        self.account_snaps.sort(key=lambda x: x[0])

    def _load_activities(self):
        with open(os.path.join(self.dataset_dir, "system_activity.csv"), 'r', encoding='utf-8') as f:
            self.activities = list(csv.DictReader(f))

    def load_request_batches(self, req_path):
        with open(req_path, 'r', encoding='utf-8') as f:
            reqs = list(csv.DictReader(f))
        
        by_rep = {}
        for r in reqs:
            by_rep.setdefault(r['reported_at'], []).append(r)
            
        for rep, r_list in by_rep.items():
            rep_dt = parse_iso(rep)
            
            # Account deletions in [rep_dt - 7200, rep_dt]
            acc_acts = []
            for a in self.activities:
                if a['source_system'] == 'deletion_worker' and a['target_system'] == 'account_service' and a['event_type'] == 'DELETE_RECORD':
                    ev_t = parse_iso(a['event_time'])
                    if 0 <= (rep_dt - ev_t).total_seconds() <= 7200:
                        acc_acts.append(a)
            acc_acts.sort(key=lambda a: parse_iso(a['event_time']))
            
            # Analytics anonymizations in [rep_dt - 3600, rep_dt]
            ana_acts = []
            for a in self.activities:
                if a['source_system'] == 'deletion_worker' and a['target_system'] == 'analytics_platform' and a['event_type'] == 'ANONYMIZE_RECORD' and a['reported_result'] == 'SUCCESS':
                    ev_t = parse_iso(a['event_time'])
                    if 0 <= (rep_dt - ev_t).total_seconds() <= 3600:
                        ana_acts.append(a)
            ana_acts.sort(key=lambda a: parse_iso(a['event_time']))
            
            r_sorted = sorted(r_list, key=lambda r: (int(r['case_id'].split('_')[1]) if '_' in r['case_id'] and r['case_id'].split('_')[1].isdigit() else r['case_id']))
            
            # Helper to check if request has violations
            def req_has_violations(r_obj):
                u_info = self.identity_resolver.resolve(r_obj['email'].lower())
                m_idents = set()
                if u_info['user_id']: m_idents.add(u_info['user_id'].lower())
                m_idents.update(u_info['emails'])
                m_idents.update(u_info['email_hashes'])
                m_idents.update(u_info['phones'])
                m_idents.update(u_info['names'])
                r_at = parse_iso(r_obj['requested_at'])
                a_at = parse_iso(r_obj['audit_at'])
                for ev in self.evidence_records:
                    if parse_iso(ev['captured_at']) <= a_at:
                        if ev['kind'] in ('REMAINING_RECORD', 'EXPOSED_PII', 'ACTIVE_DATA_FLOW', 'RESTORE_RISK'):
                            if parse_iso(ev['captured_at']) >= r_at - timedelta(seconds=60):
                                if ev['identifiers'] & m_idents:
                                    return True
                return False

            res_map = {'COMPLETE': 'SUCCESS', 'PARTIALLY_COMPLETE': 'PARTIAL', 'NOT_STARTED': 'FAILED'}
            used_acc_ids = set()
            for r in r_sorted:
                exp_res = res_map.get(r['reported_status'])
                cand = None
                for a in acc_acts:
                    if a['activity_id'] not in used_acc_ids and a['reported_result'] == exp_res:
                        cand = a
                        break
                if cand:
                    used_acc_ids.add(cand['activity_id'])
                    self.req_to_account[r['case_id']] = cand['resource_id']
                    
            used_ana_ids = set()
            for r in r_sorted:
                if req_has_violations(r):
                    continue
                cand = None
                for a in ana_acts:
                    if a['activity_id'] not in used_ana_ids:
                        cand = a
                        break
                if cand:
                    used_ana_ids.add(cand['activity_id'])
                    self.req_to_analytics[r['case_id']] = cand['resource_id']

    def audit_case(self, req):
        case_id = req['case_id']
        req_text = req.get('request_text', '')

        # 1. Intent Classification
        if is_not_applicable(req_text):
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
        if case_id in getattr(self, 'req_to_analytics', {}):
            worker_anonymized_analytics.add(self.req_to_analytics[case_id])
        else:
            for a in self.activities:
                if a['source_system'] == 'deletion_worker' and a['target_system'] == 'analytics_platform' and a['event_type'] == 'ANONYMIZE_RECORD':
                    ev_t = parse_iso(a['event_time'])
                    if ev_t <= audit_at:
                        diff = (rep_at - ev_t).total_seconds()
                        if 0 <= diff <= 900:
                            worker_anonymized_analytics.add(a['resource_id'])

        # Match Primary Account
        primary_account = None

        # Stage 1: Check evidence records captured <= audit_at for this user's account_service
        for r in self.evidence_records:
            if parse_iso(r['captured_at']) <= audit_at:
                if r['system_id'] == 'account_service' and (r['identifiers'] & match_idents):
                    primary_account = r['resource_id']
                    break

        # Stage 2: Batch correlation or single correlation
        if not primary_account:
            if case_id in getattr(self, 'req_to_account', {}):
                primary_account = self.req_to_account[case_id]
            else:
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

        # 3. Filter master records for this user captured <= audit_at
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

        # Group user evidence by resource_id
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
                else: # support_platform or identity_service
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

        if has_violations:
            status = 'INCOMPLETE'
            if primary_account and not any(f['resource_id'] == primary_account for f in findings):
                if not any(v['resource_id'] == primary_account for v in verifications):
                    verifications.append({'phase': 'VERIFICATION', 'system_id': 'account_service', 'resource_id': primary_account, 'operation': 'VERIFY_RECORD_ABSENT', 'state': 'ABSENT', 'evidence_id': ''})
            
            sec_record_id = None
            for res_id, r in res_to_rec.items():
                if r['kind'] == 'RETAINED_RECORD':
                    sec_record_id = res_id
                    break
            if not sec_record_id:
                for r in self.evidence_records:
                    if r['kind'] == 'RETAINED_RECORD' and (r['identifiers'] & match_idents):
                        sec_record_id = r['resource_id']
                        break
            if sec_record_id:
                verifications.append({'phase': 'VERIFICATION', 'system_id': 'security_service', 'resource_id': sec_record_id, 'operation': 'VERIFY_RECORD_PRESENT', 'state': 'PRESENT', 'evidence_id': ''})

            steps = sort_steps(findings + remediations + verifications)
        else:
            status = 'COMPLETE'
            comp_verif = []
            for res_id, r in res_to_rec.items():
                svc = r['system_id']
                ev_id = r['evidence_id']
                kind = r['kind']
                if kind == 'ABSENT_RECORD':
                    comp_verif.append({'phase': 'VERIFICATION', 'system_id': svc, 'resource_id': res_id, 'operation': 'VERIFY_RECORD_ABSENT', 'state': 'ABSENT', 'evidence_id': ev_id})
                elif kind == 'RETAINED_RECORD':
                    comp_verif.append({'phase': 'VERIFICATION', 'system_id': svc, 'resource_id': res_id, 'operation': 'VERIFY_RECORD_PRESENT', 'state': 'PRESENT', 'evidence_id': ev_id})
                elif kind == 'ANONYMIZED_RECORD':
                    comp_verif.append({'phase': 'VERIFICATION', 'system_id': svc, 'resource_id': res_id, 'operation': 'VERIFY_RECORD_ANONYMIZED', 'state': 'ANONYMIZED', 'evidence_id': ev_id})
                elif kind == 'REDACTED_RECORD':
                    comp_verif.append({'phase': 'VERIFICATION', 'system_id': svc, 'resource_id': res_id, 'operation': 'VERIFY_RECORD_REDACTED', 'state': 'REDACTED', 'evidence_id': ev_id})
                elif kind == 'DISABLED_FLOW':
                    comp_verif.append({'phase': 'VERIFICATION', 'system_id': svc, 'resource_id': res_id, 'operation': 'VERIFY_DATA_FLOW_DISABLED', 'state': 'DISABLED', 'evidence_id': ev_id})
                elif kind == 'BLOCKED_RESTORE':
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

            steps = sort_steps(comp_verif)

        return {
            'case_id': case_id,
            'deletion_status': status,
            'steps_json': steps
        }

    def run_full(self, input_csv=None, output_csv=None):
        if not input_csv:
            input_csv = os.path.join(self.dataset_dir, "deletion_requests.csv")
        if not output_csv:
            output_csv = os.path.join(self.repo_root, "output.csv")

        self.load_request_batches(input_csv)
        print(f"Reading requests from: {input_csv}")
        with open(input_csv, 'r', encoding='utf-8') as f:
            requests = list(csv.DictReader(f))

        print(f"Processing {len(requests)} deletion requests...")
        results = []
        for i, req in enumerate(requests, 1):
            res = self.audit_case(req)
            results.append(res)
            if i % 50 == 0 or i == len(requests):
                print(f"Audited {i}/{len(requests)} cases...")

        results.sort(key=lambda r: int(r['case_id'].split('_')[1]) if '_' in r['case_id'] and r['case_id'].split('_')[1].isdigit() else r['case_id'])

        tmp_output = output_csv + ".tmp"
        with open(tmp_output, 'w', encoding='utf-8', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['case_id', 'deletion_status', 'steps_json'])
            for r in results:
                writer.writerow([r['case_id'], r['deletion_status'], json.dumps(r['steps_json'])])

        with open(tmp_output, 'r', encoding='utf-8') as f:
            lines = [l.strip() for l in f if l.strip()]
        
        expected_rows = len(requests) + 1
        if len(lines) != expected_rows:
            raise ValueError(f"Output row count mismatch: got {len(lines)}, expected {expected_rows}")

        if os.path.exists(output_csv):
            os.remove(output_csv)
        os.rename(tmp_output, output_csv)
        print(f"Successfully generated {output_csv} with {len(results)} evaluated cases.")
        return output_csv


def main():
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    print(f"=== HackerRank Orchestrate: Ghost Data Still Exists ===")
    print(f"Repository Root: {repo_root}")
    pipeline = AuditPipeline(repo_root)
    pipeline.run_full()

if __name__ == "__main__":
    main()
