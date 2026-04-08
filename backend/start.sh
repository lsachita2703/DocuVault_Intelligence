#!/bin/bash
# DocuVault Backend Startup Script
# Usage: bash start.sh

set -e

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   DocuVault Intelligence Backend v1.0        ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Check Python
PYTHON=$(which python3 || which python)
if [ -z "$PYTHON" ]; then
  echo "ERROR: Python 3 not found. Install Python 3.9+ first."
  exit 1
fi

echo "→ Python: $($PYTHON --version)"

# Create uploads dir
mkdir -p uploads

# Initialize + seed database
echo "→ Initializing database..."
$PYTHON -c "
from db.database import init_db, insert_document, insert_fraud_result, insert_signature_result, insert_audit, get_document
import json

init_db()

# Only seed if empty
if not get_document('CHQ-2041'):
    docs = [
        {'id':'CHQ-2041','type':'Cheque','bank':'YES Bank','filename':'chq2041.pdf','file_path':'','priority':'high','client_ref':'','status':'flagged'},
        {'id':'INV-0931','type':'Invoice','bank':'ICICI Bank','filename':'inv0931.pdf','file_path':'','priority':'normal','client_ref':'','status':'review'},
        {'id':'CHQ-2039','type':'Cheque','bank':'SBI','filename':'chq2039.pdf','file_path':'','priority':'normal','client_ref':'','status':'review'},
        {'id':'CHQ-2038','type':'Cheque','bank':'Axis Bank','filename':'chq2038.pdf','file_path':'','priority':'normal','client_ref':'','status':'rejected'},
        {'id':'LNA-0214','type':'Loan Agreement','bank':'Kotak Bank','filename':'lna0214.pdf','file_path':'','priority':'normal','client_ref':'','status':'approved'},
        {'id':'KYC-1102','type':'KYC Document','bank':'Axis Bank','filename':'kyc1102.pdf','file_path':'','priority':'normal','client_ref':'','status':'approved'},
    ]
    for d in docs: insert_document(d)

    frauds = [
        {'doc_id':'CHQ-2041','risk_score':91,'flags':json.dumps(['High amount vs history','New beneficiary','Off-hours submission']),'shap_values':json.dumps([{'label':'High amount vs history','value':-32,'direction':'neg'},{'label':'New beneficiary','value':-18,'direction':'neg'},{'label':'OCR confidence','value':10,'direction':'pos'}]),'ocr_conf':99,'ner_conf':97,'model_version':'XGBoost-v1.4','decision':'FLAGGED'},
        {'doc_id':'INV-0931','risk_score':71,'flags':json.dumps(['GST mismatch','Vendor not KYC verified']),'shap_values':json.dumps([{'label':'GST mismatch','value':-22,'direction':'neg'},{'label':'Amount within range','value':14,'direction':'pos'}]),'ocr_conf':94,'ner_conf':91,'model_version':'XGBoost-v1.4','decision':'REVIEW'},
        {'doc_id':'CHQ-2039','risk_score':58,'flags':json.dumps(['Date discrepancy']),'shap_values':json.dumps([{'label':'Date discrepancy','value':-14,'direction':'neg'},{'label':'Known beneficiary','value':10,'direction':'pos'}]),'ocr_conf':88,'ner_conf':95,'model_version':'XGBoost-v1.4','decision':'REVIEW'},
        {'doc_id':'CHQ-2038','risk_score':84,'flags':json.dumps(['Signature mismatch','Altered amount suspected']),'shap_values':json.dumps([{'label':'Signature mismatch','value':-28,'direction':'neg'},{'label':'Altered amount','value':-20,'direction':'neg'}]),'ocr_conf':77,'ner_conf':93,'model_version':'XGBoost-v1.4','decision':'FLAGGED'},
        {'doc_id':'LNA-0214','risk_score':22,'flags':json.dumps([]),'shap_values':json.dumps([{'label':'All fields present','value':12,'direction':'pos'},{'label':'Known beneficiary','value':10,'direction':'pos'}]),'ocr_conf':98,'ner_conf':99,'model_version':'XGBoost-v1.4','decision':'APPROVED'},
    ]
    for f in frauds: insert_fraud_result(f)

    sigs = [
        {'doc_id':'CHQ-2041','confidence':42,'verdict':'FORGED','feature_distances':json.dumps({'stroke_curvature':0.71,'pressure_map':0.53,'aspect_ratio':0.21,'slant_angle':0.63,'loop_formation':0.45,'endpoint_similarity':0.38}),'model_version':'Siamese-v2.1'},
        {'doc_id':'INV-0931','confidence':88,'verdict':'GENUINE','feature_distances':json.dumps({'stroke_curvature':0.08,'pressure_map':0.12,'aspect_ratio':0.04,'slant_angle':0.09,'loop_formation':0.07,'endpoint_similarity':0.10}),'model_version':'Siamese-v2.1'},
        {'doc_id':'CHQ-2039','confidence':73,'verdict':'UNCERTAIN','feature_distances':json.dumps({'stroke_curvature':0.21,'pressure_map':0.18,'aspect_ratio':0.09,'slant_angle':0.25,'loop_formation':0.19,'endpoint_similarity':0.13}),'model_version':'Siamese-v2.1'},
        {'doc_id':'CHQ-2038','confidence':31,'verdict':'FORGED','feature_distances':json.dumps({'stroke_curvature':0.74,'pressure_map':0.61,'aspect_ratio':0.29,'slant_angle':0.68,'loop_formation':0.52,'endpoint_similarity':0.44}),'model_version':'Siamese-v2.1'},
        {'doc_id':'LNA-0214','confidence':95,'verdict':'GENUINE','feature_distances':json.dumps({'stroke_curvature':0.06,'pressure_map':0.10,'aspect_ratio':0.03,'slant_angle':0.08,'loop_formation':0.06,'endpoint_similarity':0.09}),'model_version':'Siamese-v2.1'},
    ]
    for s in sigs: insert_signature_result(s)

    audits = [
        {'audit_id':'AUD-9041','doc_id':'CHQ-2041','action':'FRAUD_FLAG','actor':'XGBoost v1.4','actor_type':'ml','result':'Score 91 — FLAGGED','amount':'₹12,00,000','bank':'YES Bank','doc_type':'Cheque','metadata':'{}','created_at':'2026-04-07 02:41:18'},
        {'audit_id':'AUD-9040','doc_id':'CHQ-2041','action':'SIG_REJECT','actor':'Siamese v2.1','actor_type':'ml','result':'Conf 42% — REJECTED','amount':'₹12,00,000','bank':'YES Bank','doc_type':'Cheque','metadata':'{}','created_at':'2026-04-07 02:41:14'},
        {'audit_id':'AUD-9039','doc_id':'CHQ-2041','action':'OCR_EXTRACT','actor':'AWS Textract','actor_type':'system','result':'6 fields extracted','amount':'₹12,00,000','bank':'YES Bank','doc_type':'Cheque','metadata':'{}','created_at':'2026-04-07 02:41:09'},
        {'audit_id':'AUD-9038','doc_id':'INV-0931','action':'HUMAN_OVERRIDE','actor':'Rahul Bajaj','actor_type':'human','result':'Sent for manual review','amount':'₹18,500','bank':'ICICI Bank','doc_type':'Invoice','metadata':'{}','created_at':'2026-04-07 10:20:05'},
        {'audit_id':'AUD-9037','doc_id':'INV-0931','action':'FRAUD_FLAG','actor':'XGBoost v1.4','actor_type':'ml','result':'Score 71 — REVIEW','amount':'₹18,500','bank':'ICICI Bank','doc_type':'Invoice','metadata':'{}','created_at':'2026-04-07 10:15:42'},
        {'audit_id':'AUD-9036','doc_id':'CHQ-2039','action':'DECISION_PENDING','actor':'System','actor_type':'system','result':'Awaiting analyst','amount':'₹85,000','bank':'SBI','doc_type':'Cheque','metadata':'{}','created_at':'2026-04-07 09:52:33'},
        {'audit_id':'AUD-9035','doc_id':'LNA-0214','action':'APPROVED','actor':'LayoutLM v3','actor_type':'ml','result':'All checks passed','amount':'₹5,00,000','bank':'Kotak Bank','doc_type':'Loan Agreement','metadata':'{}','created_at':'2026-04-07 11:20:11'},
        {'audit_id':'AUD-9034','doc_id':'CHQ-2038','action':'REJECTED','actor':'Rahul Bajaj','actor_type':'human','result':'Signature forged','amount':'₹3,40,000','bank':'Axis Bank','doc_type':'Cheque','metadata':'{}','created_at':'2026-04-07 08:30:15'},
    ]
    for a in audits: insert_audit(a)
    print('  ✓ Database seeded with demo data')
else:
    print('  ✓ Database already has data, skipping seed')
"

echo ""
echo "→ Starting API server on http://localhost:5000"
echo "   Press Ctrl+C to stop"
echo ""
echo "   Available endpoints:"
echo "   GET  http://localhost:5000/api/health"
echo "   GET  http://localhost:5000/api/dashboard/stats"
echo "   GET  http://localhost:5000/api/fraud/queue"
echo "   GET  http://localhost:5000/api/audit"
echo "   POST http://localhost:5000/api/documents/upload"
echo ""

$PYTHON app.py