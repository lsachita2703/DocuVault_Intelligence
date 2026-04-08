"""
DocuVault Backend — Main Flask Application
Run: python app.py
API Base: http://localhost:5000/api
"""

import os
import sys
import json
from flask import Flask, jsonify, request
from datetime import datetime

# Add project root to path
sys.path.insert(0, os.path.dirname(__file__))

from db.database import init_db
from routes.api import api

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024  # 25 MB max upload

# ── CORS (manual, no flask-cors dependency) ──────────────
@app.after_request
def add_cors(response):
    origin = request.headers.get("Origin", "*")
    response.headers["Access-Control-Allow-Origin"] = origin
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS, PATCH"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With"
    response.headers["Access-Control-Allow-Credentials"] = "true"
    response.headers["Access-Control-Max-Age"] = "86400"
    return response

@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        resp = app.make_default_options_response()
        return resp

# ── Register blueprints ──────────────────────────────────
app.register_blueprint(api)

# ── Error handlers ───────────────────────────────────────
@app.errorhandler(400)
def bad_request(e):
    return jsonify({"error": "Bad request", "detail": str(e)}), 400

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(413)
def too_large(e):
    return jsonify({"error": "File too large. Max 25MB allowed."}), 413

@app.errorhandler(500)
def server_error(e):
    return jsonify({"error": "Internal server error", "detail": str(e)}), 500

# ── Root ─────────────────────────────────────────────────
@app.route("/")
def root():
    return jsonify({
        "service": "DocuVault Intelligence API",
        "version": "1.0.0",
        "status": "running",
        "docs": "/api/health",
        "endpoints": {
            "health":             "GET  /api/health",
            "dashboard_stats":    "GET  /api/dashboard/stats",
            "live_feed":          "GET  /api/dashboard/live-feed",
            "pipeline_status":    "GET  /api/pipeline/status",
            "documents_list":     "GET  /api/documents",
            "document_get":       "GET  /api/documents/<id>",
            "document_upload":    "POST /api/documents/upload",
            "document_process":   "POST /api/documents/<id>/process",
            "fraud_queue":        "GET  /api/fraud/queue",
            "fraud_detail":       "GET  /api/fraud/<id>",
            "fraud_decision":     "POST /api/fraud/<id>/decision",
            "sig_queue":          "GET  /api/signature/queue",
            "sig_detail":         "GET  /api/signature/<id>",
            "sig_override":       "POST /api/signature/<id>/override",
            "audit_log":          "GET  /api/audit",
            "audit_stats":        "GET  /api/audit/stats",
            "audit_export_csv":   "GET  /api/audit/export/csv",
        }
    })


if __name__ == "__main__":
    print("=" * 60)
    print(" DocuVault Intelligence Backend")
    print(" Initializing database...")
    init_db()
    print(" Starting Flask server on http://0.0.0.0:5000")
    print("=" * 60)
    app.run(host="0.0.0.0", port=5000, debug=True, use_reloader=False)