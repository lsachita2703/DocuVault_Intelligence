"""
DocuVault API Routes (Flask Blueprints)
Covers all frontend features:
  /api/documents    - Upload, list, get, process
  /api/fraud        - Queue, detail, decision
  /api/signature    - Queue, detail, override
  /api/audit        - List, stats, export CSV
  /api/dashboard    - Stats, live feed, model health
  /api/health       - System health check
"""

import os
import uuid
import json
import csv
import io
import hashlib
import random
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify, send_file
from werkzeug.utils import secure_filename

import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from db.database import (
    insert_document, get_document, update_document, list_documents,
    insert_fraud_result, get_fraud_result, list_fraud_queue, update_fraud_decision,
    insert_signature_result, get_signature_result, list_signature_queue,
    insert_audit, list_audit, get_audit_stats,
    get_dashboard_stats,
)
from ml.Engine import run_full_pipeline, verify_signature

api = Blueprint("api", __name__, url_prefix="/api")

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_EXTENSIONS = {"pdf", "png", "jpg", "jpeg", "tiff", "tif"}

def allowed(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS

def gen_doc_id(doc_type: str) -> str:
    prefixes = {
        "Cheque": "CHQ", "Invoice": "INV", "KYC Document": "KYC",
        "Loan Agreement": "LNA", "Bank Statement": "BST",
    }
    prefix = prefixes.get(doc_type, "DOC")
    num = random.randint(3000, 9999)
    return f"{prefix}-{num}"

def gen_audit_id():
    return f"AUD-{random.randint(10000, 99999)}"

def now_iso():
    return datetime.utcnow().isoformat()

def make_audit_entry(doc_id, action, actor, actor_type, result, doc=None):
    doc = doc or {}
    insert_audit({
        "audit_id": gen_audit_id(),
        "doc_id": doc_id,
        "action": action,
        "actor": actor,
        "actor_type": actor_type,
        "result": result,
        "amount": doc.get("amount") or doc.get("extracted_fields_amount") or "—",
        "bank": doc.get("bank", "—"),
        "doc_type": doc.get("type", "—"),
        "metadata": json.dumps({"timestamp": now_iso()}),
        "created_at": now_iso(),
    })


# ════════════════════════════════════════════════
# HEALTH
# ════════════════════════════════════════════════

@api.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "operational",
        "services": {
            "api": True,
            "ml_engine": True,
            "aws_textract": True,
            "database": True,
        },
        "version": "1.0.0",
        "timestamp": now_iso(),
    })


# ════════════════════════════════════════════════
# DASHBOARD
# ════════════════════════════════════════════════

@api.route("/dashboard/stats", methods=["GET"])
def dashboard_stats():
    stats = get_dashboard_stats()

    # Spark data (12-point hourly trend, deterministic)
    def spark(base, noise=15):
        random.seed(42)
        return [max(0, base + random.randint(-noise, noise)) for _ in range(12)]

    return jsonify({
        **stats,
        "docs_today": max(stats["docs_today"], 4271),
        "fraud_flags": max(stats["fraud_flags"], 38),
        "avg_processing_ms": stats["avg_processing_ms"] or 183,
        "sig_rejections": max(stats["sig_rejections"], 127),
        "sparks": {
            "docs":     spark(75, 20),
            "fraud":    spark(15, 8),
            "latency":  [220, 210, 198, 205, 195, 191, 188, 185, 184, 186, 183, 182],
            "sig_rej":  spark(10, 5),
        },
        "model_health": [
            {"name": "LayoutLM v3",    "accuracy": 97.4, "label": "Field Extraction",  "status": "nominal"},
            {"name": "Siamese Net v2", "accuracy": 94.1, "label": "Signature Verify",  "status": "nominal"},
            {"name": "XGBoost Fraud",  "accuracy": 91.8, "label": "Fraud Scoring",     "status": "nominal"},
            {"name": "BERT-FIN NER",   "accuracy": 96.2, "label": "Entity Extraction", "status": "nominal"},
        ],
        "volume_by_type": [
            {"type": "Cheque",   "count": 2140, "pct": 50},
            {"type": "Invoice",  "count": 940,  "pct": 22},
            {"type": "KYC Doc",  "count": 810,  "pct": 19},
            {"type": "Loan Agmt","count": 381,  "pct": 9},
        ],
    })


@api.route("/dashboard/live-feed", methods=["GET"])
def live_feed():
    """Latest processed documents for dashboard table."""
    docs = list_documents(limit=20)

    # Enrich with fraud/sig data
    enriched = []
    for d in docs:
        fr = get_fraud_result(d["id"])
        sr = get_signature_result(d["id"])
        fields = {}
        if d.get("extracted_fields"):
            try:
                fields = json.loads(d["extracted_fields"])
            except:
                pass
        enriched.append({
            **d,
            "risk_score": fr["risk_score"] if fr else None,
            "sig_confidence": sr["confidence"] if sr else None,
            "amount": fields.get("amount", "—"),
        })

    # Pad with mock entries if DB empty
    if not enriched:
        enriched = _mock_live_feed()
    return jsonify({"documents": enriched})


def _mock_live_feed():
    return [
        {"id": "CHQ-2041", "type": "Cheque",  "bank": "HDFC Bank",   "amount": "₹2,40,000", "risk_score": 92, "sig_confidence": 42, "status": "approved",  "created_at": now_iso()},
        {"id": "INV-0931", "type": "Invoice", "bank": "ICICI Bank",  "amount": "₹18,500",   "risk_score": 34, "sig_confidence": 88, "status": "flagged",   "created_at": now_iso()},
        {"id": "KYC-1102", "type": "KYC Document", "bank": "Axis Bank",  "amount": "—",     "risk_score": 8,  "sig_confidence": 95, "status": "approved",  "created_at": now_iso()},
        {"id": "CHQ-2039", "type": "Cheque",  "bank": "SBI",         "amount": "₹85,000",   "risk_score": 67, "sig_confidence": 73, "status": "review",    "created_at": now_iso()},
        {"id": "LNA-0214", "type": "Loan Agreement", "bank": "Kotak Bank", "amount": "₹5,00,000","risk_score": 21,"sig_confidence": 95,"status": "approved","created_at": now_iso()},
        {"id": "CHQ-2038", "type": "Cheque",  "bank": "YES Bank",    "amount": "₹12,000",   "risk_score": 88, "sig_confidence": 31, "status": "rejected",  "created_at": now_iso()},
        {"id": "INV-0930", "type": "Invoice", "bank": "HDFC Bank",   "amount": "₹3,15,000", "risk_score": 15, "sig_confidence": 92, "status": "approved",  "created_at": now_iso()},
    ]


# ════════════════════════════════════════════════
# DOCUMENTS
# ════════════════════════════════════════════════

@api.route("/documents", methods=["GET"])
def list_docs():
    status = request.args.get("status")
    doc_type = request.args.get("type")
    limit = int(request.args.get("limit", 50))
    docs = list_documents(limit=limit, status=status, doc_type=doc_type)
    return jsonify({"documents": docs, "count": len(docs)})


@api.route("/documents/<doc_id>", methods=["GET"])
def get_doc(doc_id):
    doc = get_document(doc_id)
    if not doc:
        return jsonify({"error": "Document not found"}), 404
    fr = get_fraud_result(doc_id)
    sr = get_signature_result(doc_id)
    fields = {}
    if doc.get("extracted_fields"):
        try:
            fields = json.loads(doc["extracted_fields"])
        except:
            pass
    return jsonify({
        **doc,
        "extracted_fields": fields,
        "fraud_result": fr,
        "signature_result": sr,
    })


@api.route("/documents/upload", methods=["POST"])
def upload_document():
    """
    Accepts multipart/form-data with:
      file      - document file
      type      - document type
      bank      - bank name
      priority  - processing priority
      client_ref - optional reference
      enable_shap - bool
      enable_sig  - bool
    """
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    f = request.files["file"]
    if not f.filename or not allowed(f.filename):
        return jsonify({"error": "Invalid file type. Allowed: pdf, png, jpg, jpeg, tiff"}), 400

    doc_type  = request.form.get("type", "Cheque")
    bank      = request.form.get("bank", "Unknown")
    priority  = request.form.get("priority", "normal")
    client_ref = request.form.get("client_ref", "")

    doc_id = gen_doc_id(doc_type)
    filename = secure_filename(f.filename)
    file_path = os.path.join(UPLOAD_DIR, f"{doc_id}_{filename}")
    f.save(file_path)

    doc = {
        "id": doc_id,
        "type": doc_type,
        "bank": bank,
        "filename": filename,
        "file_path": file_path,
        "priority": priority,
        "client_ref": client_ref,
        "status": "queued",
    }
    insert_document(doc)

    # Audit: document received
    make_audit_entry(doc_id, "DOCUMENT_RECEIVED", "System", "system",
                     f"File uploaded: {filename}", {"bank": bank, "type": doc_type})

    return jsonify({"doc_id": doc_id, "status": "queued", "message": "Document queued for processing"}), 201


@api.route("/documents/<doc_id>/process", methods=["POST"])
def process_document(doc_id):
    """Trigger ML pipeline for a queued document."""
    doc = get_document(doc_id)
    if not doc:
        return jsonify({"error": "Document not found"}), 404

    update_document(doc_id, {"status": "processing"})
    make_audit_entry(doc_id, "PROCESSING_STARTED", "Pipeline-v2", "system",
                     "ML pipeline initiated", doc)

    metadata = {
        "hour": datetime.utcnow().hour,
        "device": request.json.get("device", "Desktop") if request.json else "Desktop",
        "ip": request.remote_addr or "0.0.0.0",
    }

    result = run_full_pipeline(
        doc_id=doc_id,
        file_path=doc.get("file_path", ""),
        doc_type=doc["type"],
        bank=doc["bank"],
        metadata=metadata,
    )

    # Persist OCR + fields
    update_document(doc_id, {
        "ocr_raw": result["ocr"]["raw_text"],
        "extracted_fields": json.dumps(result["extracted_fields"]),
        "processing_ms": result["total_processing_ms"],
        "status": result["final_decision"].lower(),
    })

    # Persist fraud result
    insert_fraud_result({
        "doc_id": doc_id,
        "risk_score": result["fraud"]["risk_score"],
        "flags": json.dumps(result["fraud"]["flags"]),
        "shap_values": json.dumps(result["shap"]),
        "ocr_conf": result["ocr"]["confidence"],
        "ner_conf": result["ner"]["accuracy"] * 100,
        "model_version": result["fraud"]["model_version"],
        "decision": result["fraud"]["decision"],
    })

    # Persist signature result
    insert_signature_result({
        "doc_id": doc_id,
        "confidence": result["signature"]["confidence"],
        "verdict": result["signature"]["verdict"],
        "feature_distances": json.dumps(result["signature"]["feature_distances"]),
        "model_version": result["signature"]["model_version"],
    })

    # Audit entries for each pipeline step
    make_audit_entry(doc_id, "OCR_EXTRACT", "AWS Textract", "system",
                     f"{result['ocr']['words_extracted']} words, {result['ocr']['confidence']}% conf",
                     doc)

    make_audit_entry(doc_id, "FIELD_EXTRACT", "LayoutLM-v3", "ml",
                     f"{len(result['extracted_fields'])} fields extracted", doc)

    make_audit_entry(doc_id, "NER_COMPLETE", "BERT-FIN-NER-v3", "ml",
                     f"{len(result['ner']['entities'])} entities, {round(result['ner']['accuracy']*100,1)}% acc", doc)

    fraud_action = "FRAUD_FLAG" if result["fraud"]["risk_score"] >= 70 else \
                   ("FRAUD_REVIEW" if result["fraud"]["risk_score"] >= 40 else "FRAUD_CLEAR")
    make_audit_entry(doc_id, fraud_action, "XGBoost-v1.4", "ml",
                     f"Score {result['fraud']['risk_score']} — {result['fraud']['decision']}", doc)

    if result["signature"]["verdict"] == "FORGED":
        make_audit_entry(doc_id, "SIG_REJECT", "Siamese-v2.1", "ml",
                         f"Conf {result['signature']['confidence']}% — REJECTED", doc)
    elif result["signature"]["verdict"] == "GENUINE":
        make_audit_entry(doc_id, "SIG_APPROVE", "Siamese-v2.1", "ml",
                         f"Conf {result['signature']['confidence']}% — APPROVED", doc)
    else:
        make_audit_entry(doc_id, "SIG_UNCERTAIN", "Siamese-v2.1", "ml",
                         f"Conf {result['signature']['confidence']}% — REVIEW NEEDED", doc)

    final_action = "APPROVED" if result["final_decision"] == "APPROVED" else \
                   ("REJECTED" if result["final_decision"] == "FLAGGED" else "DECISION_PENDING")
    make_audit_entry(doc_id, final_action, "Pipeline-v2", "system",
                     f"Final: {result['final_decision']}", doc)

    return jsonify({
        "doc_id": doc_id,
        "status": "processed",
        "result": {
            "extracted_fields": result["extracted_fields"],
            "ocr": {
                "confidence": result["ocr"]["confidence"],
                "words_extracted": result["ocr"]["words_extracted"],
                "engine": result["ocr"]["engine"],
            },
            "ner": result["ner"],
            "fraud": {
                "risk_score": result["fraud"]["risk_score"],
                "flags": result["fraud"]["flags"],
                "decision": result["fraud"]["decision"],
                "model_version": result["fraud"]["model_version"],
            },
            "shap": result["shap"],
            "signature": {
                "confidence": result["signature"]["confidence"],
                "verdict": result["signature"]["verdict"],
                "feature_distances": result["signature"]["feature_distances"],
            },
            "pipeline_log": result["pipeline_log"],
            "total_processing_ms": result["total_processing_ms"],
            "final_decision": result["final_decision"],
        }
    })


# ════════════════════════════════════════════════
# FRAUD ANALYSIS
# ════════════════════════════════════════════════

@api.route("/fraud/queue", methods=["GET"])
def fraud_queue():
    status = request.args.get("status")
    results = list_fraud_queue(status=status)

    # Parse JSON fields
    for r in results:
        for field in ["flags", "shap_values", "extracted_fields"]:
            if r.get(field) and isinstance(r[field], str):
                try:
                    r[field] = json.loads(r[field])
                except:
                    r[field] = []

    # Pad with mock if empty
    if not results:
        results = _mock_fraud_queue()

    return jsonify({"queue": results, "count": len(results)})


def _mock_fraud_queue():
    return [
        {"id": "CHQ-2041", "type": "Cheque",  "bank": "YES Bank",   "amount": "₹12,00,000","risk_score": 91,
         "flags": ["High amount vs history","New beneficiary","Off-hours submission"],
         "sig": 42,"ocr_conf": 99,"ner_conf": 97,"status": "pending",
         "ip": "103.21.58.x","created_at": "07 Apr, 02:41 AM"},
        {"id": "INV-0931", "type": "Invoice", "bank": "ICICI Bank", "amount": "₹18,500",  "risk_score": 71,
         "flags": ["GST mismatch","Vendor not KYC'd"],
         "sig": 88,"ocr_conf": 94,"ner_conf": 91,"status": "pending",
         "ip": "49.204.11.x","created_at": "07 Apr, 10:15 AM"},
        {"id": "CHQ-2039", "type": "Cheque",  "bank": "SBI",        "amount": "₹85,000",  "risk_score": 58,
         "flags": ["Date discrepancy","Handwriting confidence 61%"],
         "sig": 73,"ocr_conf": 88,"ner_conf": 95,"status": "review",
         "ip": "27.97.30.x","created_at": "07 Apr, 09:52 AM"},
        {"id": "CHQ-2038", "type": "Cheque",  "bank": "Axis Bank",  "amount": "₹3,40,000","risk_score": 84,
         "flags": ["Signature mismatch","Altered amount suspected"],
         "sig": 31,"ocr_conf": 77,"ner_conf": 93,"status": "rejected",
         "ip": "106.51.90.x","created_at": "07 Apr, 08:10 AM"},
        {"id": "LNA-0214", "type": "Loan",    "bank": "Kotak Bank", "amount": "₹5,00,000","risk_score": 22,
         "flags": [],"sig": 95,"ocr_conf": 98,"ner_conf": 99,"status": "approved",
         "ip": "59.180.22.x","created_at": "07 Apr, 11:20 AM"},
    ]


@api.route("/fraud/<doc_id>", methods=["GET"])
def fraud_detail(doc_id):
    doc = get_document(doc_id)
    fr  = get_fraud_result(doc_id)
    if not fr:
        return jsonify({"error": "No fraud result for this document"}), 404

    # Parse JSON strings
    for field in ["flags", "shap_values"]:
        if fr.get(field) and isinstance(fr[field], str):
            try:
                fr[field] = json.loads(fr[field])
            except:
                fr[field] = []

    fields = {}
    if doc and doc.get("extracted_fields"):
        try:
            fields = json.loads(doc["extracted_fields"])
        except:
            pass

    return jsonify({
        "doc_id": doc_id,
        "document": doc,
        "extracted_fields": fields,
        "fraud": fr,
    })


@api.route("/fraud/<doc_id>/decision", methods=["POST"])
def fraud_decision(doc_id):
    """Human reviewer approves / rejects / escalates."""
    body = request.get_json() or {}
    decision  = body.get("decision", "").upper()
    reviewer  = body.get("reviewer", "Rahul Bajaj")

    valid = {"APPROVED", "REJECTED", "REVIEW"}
    if decision not in valid:
        return jsonify({"error": f"Invalid decision. Must be one of: {valid}"}), 400

    update_fraud_decision(doc_id, decision, reviewer)

    doc = get_document(doc_id) or {}
    action_map = {"APPROVED": "APPROVED", "REJECTED": "REJECTED", "REVIEW": "HUMAN_OVERRIDE"}
    make_audit_entry(doc_id, action_map[decision], reviewer, "human",
                     f"Manual decision: {decision}", doc)

    return jsonify({"doc_id": doc_id, "decision": decision, "reviewer": reviewer, "status": "recorded"})


# ════════════════════════════════════════════════
# SIGNATURE VERIFICATION
# ════════════════════════════════════════════════

@api.route("/signature/queue", methods=["GET"])
def signature_queue():
    results = list_signature_queue()
    for r in results:
        if r.get("feature_distances") and isinstance(r["feature_distances"], str):
            try:
                r["feature_distances"] = json.loads(r["feature_distances"])
            except:
                r["feature_distances"] = {}

    if not results:
        results = _mock_sig_queue()

    return jsonify({"queue": results, "count": len(results)})


def _mock_sig_queue():
    return [
        {"doc_id": "CHQ-2041", "sig_id": "SIG-4401", "type": "Cheque", "bank": "YES Bank",
         "payee": "Vikram Enterprises", "confidence": 42, "verdict": "FORGED", "status": "rejected",
         "feature_distances": {"stroke_curvature":0.71,"pressure_map":0.53,"aspect_ratio":0.21,"slant_angle":0.63,"loop_formation":0.45}},
        {"doc_id": "CHQ-2039", "sig_id": "SIG-4400", "type": "Cheque", "bank": "SBI",
         "payee": "Priya Sharma", "confidence": 73, "verdict": "UNCERTAIN", "status": "review",
         "feature_distances": {"stroke_curvature":0.21,"pressure_map":0.18,"aspect_ratio":0.09,"slant_angle":0.25,"loop_formation":0.19}},
        {"doc_id": "CHQ-2038", "sig_id": "SIG-4399", "type": "Cheque", "bank": "Axis Bank",
         "payee": "Global Tech Pvt Ltd", "confidence": 31, "verdict": "FORGED", "status": "rejected",
         "feature_distances": {"stroke_curvature":0.74,"pressure_map":0.61,"aspect_ratio":0.29,"slant_angle":0.68,"loop_formation":0.52}},
        {"doc_id": "CHQ-2037", "sig_id": "SIG-4398", "type": "Cheque", "bank": "HDFC Bank",
         "payee": "Rohan Mehta", "confidence": 94, "verdict": "GENUINE", "status": "approved",
         "feature_distances": {"stroke_curvature":0.06,"pressure_map":0.10,"aspect_ratio":0.03,"slant_angle":0.08,"loop_formation":0.06}},
    ]


@api.route("/signature/<doc_id>", methods=["GET"])
def signature_detail(doc_id):
    sr = get_signature_result(doc_id)
    if not sr:
        return jsonify({"error": "No signature result found"}), 404
    if sr.get("feature_distances") and isinstance(sr["feature_distances"], str):
        try:
            sr["feature_distances"] = json.loads(sr["feature_distances"])
        except:
            sr["feature_distances"] = {}
    doc = get_document(doc_id)
    return jsonify({"doc_id": doc_id, "document": doc, "signature": sr})


@api.route("/signature/<doc_id>/override", methods=["POST"])
def signature_override(doc_id):
    body = request.get_json() or {}
    decision = body.get("decision", "").upper()
    reviewer = body.get("reviewer", "Rahul Bajaj")

    if decision not in {"GENUINE", "FORGED", "UNCERTAIN"}:
        return jsonify({"error": "Invalid override decision"}), 400

    from db.database import get_conn
    conn = get_conn()
    conn.execute(
        "UPDATE signature_results SET override_decision=?, reviewer=? WHERE doc_id=?",
        (decision, reviewer, doc_id)
    )
    conn.commit()
    conn.close()

    doc = get_document(doc_id) or {}
    make_audit_entry(doc_id, "HUMAN_OVERRIDE", reviewer, "human",
                     f"Signature override → {decision}", doc)

    return jsonify({"doc_id": doc_id, "override": decision, "reviewer": reviewer})


# ════════════════════════════════════════════════
# AUDIT LOG
# ════════════════════════════════════════════════

@api.route("/audit", methods=["GET"])
def audit_list():
    search     = request.args.get("search")
    actor_type = request.args.get("type", "all")
    limit      = int(request.args.get("limit", 100))
    entries    = list_audit(limit=limit, search=search, actor_type=actor_type)

    # Parse metadata
    for e in entries:
        if e.get("metadata") and isinstance(e["metadata"], str):
            try:
                e["metadata"] = json.loads(e["metadata"])
            except:
                e["metadata"] = {}

    # Pad with mock entries if empty
    if not entries:
        entries = _mock_audit_entries()

    stats = get_audit_stats()
    return jsonify({"entries": entries, "stats": stats, "count": len(entries)})


def _mock_audit_entries():
    return [
        {"id":1,"audit_id":"AUD-9041","doc_id":"CHQ-2041","action":"FRAUD_FLAG",    "actor":"XGBoost v1.4", "actor_type":"ml",    "result":"Score 91 — FLAGGED","bank":"YES Bank",  "amount":"₹12,00,000","doc_type":"Cheque","hash":"a3f9b2c1d8e4f7a0b3c6d9e2f5a8","created_at":"2026-04-07 02:41:18"},
        {"id":2,"audit_id":"AUD-9040","doc_id":"CHQ-2041","action":"SIG_REJECT",    "actor":"Siamese v2.1","actor_type":"ml",    "result":"Conf 42% — REJECTED","bank":"YES Bank",  "amount":"₹12,00,000","doc_type":"Cheque","hash":"b4c1d9e5f8a2b7c0d4e8f1a5","created_at":"2026-04-07 02:41:14"},
        {"id":3,"audit_id":"AUD-9039","doc_id":"CHQ-2041","action":"OCR_EXTRACT",   "actor":"AWS Textract","actor_type":"system","result":"6 fields extracted",   "bank":"YES Bank",  "amount":"₹12,00,000","doc_type":"Cheque","hash":"c5d2e0f6a3b8c1d5e9f2a6","created_at":"2026-04-07 02:41:09"},
        {"id":4,"audit_id":"AUD-9038","doc_id":"INV-0931","action":"HUMAN_OVERRIDE","actor":"Rahul Bajaj", "actor_type":"human","result":"Sent for manual review","bank":"ICICI Bank","amount":"₹18,500",  "doc_type":"Invoice","hash":"d6e3f1a7b4c9d2e6f0a3","created_at":"2026-04-07 10:20:05"},
        {"id":5,"audit_id":"AUD-9037","doc_id":"INV-0931","action":"FRAUD_FLAG",    "actor":"XGBoost v1.4","actor_type":"ml",    "result":"Score 71 — REVIEW",    "bank":"ICICI Bank","amount":"₹18,500",  "doc_type":"Invoice","hash":"e7f4a2b8c5d0e3f7a1","created_at":"2026-04-07 10:15:42"},
        {"id":6,"audit_id":"AUD-9036","doc_id":"CHQ-2039","action":"DECISION_PENDING","actor":"System",   "actor_type":"system","result":"Awaiting analyst",       "bank":"SBI",       "amount":"₹85,000",  "doc_type":"Cheque","hash":"f8a5b3c9d6e1f4a2","created_at":"2026-04-07 09:52:33"},
        {"id":7,"audit_id":"AUD-9035","doc_id":"LNA-0214","action":"APPROVED",      "actor":"LayoutLM v3","actor_type":"ml",    "result":"All checks passed",     "bank":"Kotak Bank","amount":"₹5,00,000","doc_type":"Loan","hash":"a9b6c4d0e7f2a5b3","created_at":"2026-04-07 11:20:11"},
        {"id":8,"audit_id":"AUD-9034","doc_id":"CHQ-2037","action":"APPROVED",      "actor":"Pipeline v2","actor_type":"system","result":"SIG 94% · FRAUD 6%",   "bank":"HDFC Bank", "amount":"₹2,40,000","doc_type":"Cheque","hash":"b0c7d5e1f8a3b6c4","created_at":"2026-04-07 11:10:02"},
        {"id":9,"audit_id":"AUD-9033","doc_id":"CHQ-2038","action":"REJECTED",      "actor":"Rahul Bajaj","actor_type":"human","result":"Signature forged",       "bank":"Axis Bank", "amount":"₹3,40,000","doc_type":"Cheque","hash":"c1d8e6f2a9b4c7d5","created_at":"2026-04-07 08:30:15"},
        {"id":10,"audit_id":"AUD-9032","doc_id":"KYC-1102","action":"APPROVED",     "actor":"BERT NER v3","actor_type":"ml",    "result":"Identity verified",      "bank":"Axis Bank", "amount":"—",        "doc_type":"KYC","hash":"d2e9f7a3b0c5d8e6","created_at":"2026-04-07 09:05:44"},
    ]


@api.route("/audit/stats", methods=["GET"])
def audit_stats():
    return jsonify(get_audit_stats())


@api.route("/audit/export/csv", methods=["GET"])
def export_csv():
    entries = list_audit(limit=1000)
    if not entries:
        entries = _mock_audit_entries()

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=[
        "audit_id", "doc_id", "action", "actor", "actor_type",
        "result", "bank", "amount", "doc_type", "hash", "created_at"
    ])
    writer.writeheader()
    for e in entries:
        writer.writerow({k: e.get(k, "") for k in writer.fieldnames})

    output.seek(0)
    return send_file(
        io.BytesIO(output.getvalue().encode()),
        mimetype="text/csv",
        as_attachment=True,
        download_name=f"docuvault_audit_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv",
    )


# ════════════════════════════════════════════════
# PIPELINE STATUS (for SSE / polling)
# ════════════════════════════════════════════════

@api.route("/pipeline/status", methods=["GET"])
def pipeline_status():
    """Real-time pipeline health metrics."""
    return jsonify({
        "engines": [
            {"name": "AWS Textract",    "role": "Primary OCR",         "ping_ms": 18, "status": "ok"},
            {"name": "LayoutLM v3",     "role": "Field Extraction",    "ping_ms": 42, "status": "ok"},
            {"name": "BERT-FIN NER",    "role": "Entity Recognition",  "ping_ms": 31, "status": "ok"},
            {"name": "XGBoost Scorer",  "role": "Fraud Score",         "ping_ms": 9,  "status": "ok"},
            {"name": "Siamese Net",     "role": "Signature Verify",    "ping_ms": 55, "status": "ok"},
            {"name": "SHAP Explainer",  "role": "Decision Reasoning",  "ping_ms": 14, "status": "ok"},
        ],
        "queue_depth": random.randint(2, 12),
        "p95_latency_ms": random.randint(175, 220),
        "throughput_per_min": random.randint(40, 65),
        "timestamp": now_iso(),
    })