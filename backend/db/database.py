"""
DocuVault Database Layer — SQLite with full schema
All tables: documents, fraud_results, signature_results, audit_log, users
"""
import sqlite3
import os
import json
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "docuvault.db")


def get_conn():
    conn = sqlite3.connect(DB_PATH, detect_types=sqlite3.PARSE_DECLTYPES)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    conn = get_conn()
    c = conn.cursor()

    # ── Documents ──────────────────────────────────────────────────
    c.execute("""
    CREATE TABLE IF NOT EXISTS documents (
        id            TEXT PRIMARY KEY,
        type          TEXT NOT NULL,
        bank          TEXT NOT NULL,
        filename      TEXT NOT NULL,
        file_path     TEXT,
        priority      TEXT DEFAULT 'normal',
        client_ref    TEXT,
        ocr_raw       TEXT,
        extracted_fields TEXT,
        processing_ms INTEGER,
        status        TEXT DEFAULT 'queued',
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # ── Fraud Results ───────────────────────────────────────────────
    c.execute("""
    CREATE TABLE IF NOT EXISTS fraud_results (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id        TEXT NOT NULL REFERENCES documents(id),
        risk_score    REAL NOT NULL,
        flags         TEXT,
        shap_values   TEXT,
        ocr_conf      REAL,
        ner_conf      REAL,
        model_version TEXT DEFAULT 'XGBoost-v1.4',
        decision      TEXT,
        reviewer      TEXT,
        reviewed_at   TIMESTAMP,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # ── Signature Results ───────────────────────────────────────────
    c.execute("""
    CREATE TABLE IF NOT EXISTS signature_results (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id            TEXT NOT NULL REFERENCES documents(id),
        confidence        REAL NOT NULL,
        verdict           TEXT NOT NULL,
        feature_distances TEXT,
        model_version     TEXT DEFAULT 'Siamese-v2.1',
        reviewer          TEXT,
        override_decision TEXT,
        created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # ── Audit Log ───────────────────────────────────────────────────
    c.execute("""
    CREATE TABLE IF NOT EXISTS audit_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        audit_id    TEXT UNIQUE NOT NULL,
        doc_id      TEXT NOT NULL,
        action      TEXT NOT NULL,
        actor       TEXT NOT NULL,
        actor_type  TEXT DEFAULT 'system',
        result      TEXT,
        amount      TEXT,
        bank        TEXT,
        doc_type    TEXT,
        hash        TEXT,
        metadata    TEXT,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # ── Users ───────────────────────────────────────────────────────
    c.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        username   TEXT UNIQUE NOT NULL,
        email      TEXT UNIQUE NOT NULL,
        role       TEXT DEFAULT 'analyst',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # ── Seed default user ───────────────────────────────────────────
    c.execute("""
    INSERT OR IGNORE INTO users (username, email, role)
    VALUES ('rahul.bajaj', 'rahul@docuvault.in', 'risk_analyst')
    """)

    conn.commit()
    conn.close()
    print(f"[DB] Initialized at {DB_PATH}")


def row_to_dict(row):
    if row is None:
        return None
    return dict(row)


def rows_to_list(rows):
    return [dict(r) for r in rows]


# ── Document CRUD ───────────────────────────────────────────────────

def insert_document(doc: dict):
    conn = get_conn()
    conn.execute("""
        INSERT OR REPLACE INTO documents
        (id, type, bank, filename, file_path, priority, client_ref, status)
        VALUES (:id, :type, :bank, :filename, :file_path, :priority, :client_ref, :status)
    """, doc)
    conn.commit()
    conn.close()


def get_document(doc_id: str):
    conn = get_conn()
    row = conn.execute("SELECT * FROM documents WHERE id=?", (doc_id,)).fetchone()
    conn.close()
    return row_to_dict(row)


def update_document(doc_id: str, fields: dict):
    fields["updated_at"] = datetime.utcnow().isoformat()
    fields["id"] = doc_id
    sets = ", ".join(f"{k}=:{k}" for k in fields if k != "id")
    conn = get_conn()
    conn.execute(f"UPDATE documents SET {sets} WHERE id=:id", fields)
    conn.commit()
    conn.close()


def list_documents(limit=50, status=None, doc_type=None):
    conn = get_conn()
    q = "SELECT * FROM documents"
    params = []
    filters = []
    if status:
        filters.append("status=?"); params.append(status)
    if doc_type:
        filters.append("type=?"); params.append(doc_type)
    if filters:
        q += " WHERE " + " AND ".join(filters)
    q += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    rows = conn.execute(q, params).fetchall()
    conn.close()
    return rows_to_list(rows)


# ── Fraud CRUD ──────────────────────────────────────────────────────

def insert_fraud_result(fr: dict):
    conn = get_conn()
    conn.execute("""
        INSERT INTO fraud_results
        (doc_id, risk_score, flags, shap_values, ocr_conf, ner_conf, model_version, decision)
        VALUES (:doc_id, :risk_score, :flags, :shap_values, :ocr_conf, :ner_conf, :model_version, :decision)
    """, fr)
    conn.commit()
    conn.close()


def get_fraud_result(doc_id: str):
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM fraud_results WHERE doc_id=? ORDER BY created_at DESC LIMIT 1",
        (doc_id,)
    ).fetchone()
    conn.close()
    return row_to_dict(row)


def list_fraud_queue(status=None):
    conn = get_conn()
    q = """
        SELECT d.*, f.risk_score, f.flags, f.shap_values, f.ocr_conf, f.ner_conf,
               f.decision as fraud_decision, f.id as fraud_id
        FROM documents d
        LEFT JOIN fraud_results f ON d.id = f.doc_id
        WHERE f.risk_score IS NOT NULL
    """
    if status:
        q += f" AND d.status='{status}'"
    q += " ORDER BY f.risk_score DESC LIMIT 50"
    rows = conn.execute(q).fetchall()
    conn.close()
    return rows_to_list(rows)


def update_fraud_decision(doc_id: str, decision: str, reviewer: str):
    conn = get_conn()
    conn.execute("""
        UPDATE fraud_results SET decision=?, reviewer=?, reviewed_at=CURRENT_TIMESTAMP
        WHERE doc_id=?
    """, (decision, reviewer, doc_id))
    conn.execute("UPDATE documents SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                 (decision.lower(), doc_id))
    conn.commit()
    conn.close()


# ── Signature CRUD ──────────────────────────────────────────────────

def insert_signature_result(sr: dict):
    conn = get_conn()
    conn.execute("""
        INSERT INTO signature_results
        (doc_id, confidence, verdict, feature_distances, model_version)
        VALUES (:doc_id, :confidence, :verdict, :feature_distances, :model_version)
    """, sr)
    conn.commit()
    conn.close()


def get_signature_result(doc_id: str):
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM signature_results WHERE doc_id=? ORDER BY created_at DESC LIMIT 1",
        (doc_id,)
    ).fetchone()
    conn.close()
    return row_to_dict(row)


def list_signature_queue():
    conn = get_conn()
    rows = conn.execute("""
        SELECT d.id as doc_id, d.type, d.bank, d.status, d.created_at,
               d.extracted_fields,
               s.confidence, s.verdict, s.feature_distances, s.id as sig_id,
               s.reviewer, s.override_decision
        FROM documents d
        JOIN signature_results s ON d.id = s.doc_id
        ORDER BY s.created_at DESC LIMIT 30
    """).fetchall()
    conn.close()
    return rows_to_list(rows)


# ── Audit CRUD ──────────────────────────────────────────────────────

def insert_audit(entry: dict):
    import hashlib
    raw = f"{entry['audit_id']}::{entry['doc_id']}::{entry['action']}::{entry['actor']}::{entry.get('created_at','')}"
    entry["hash"] = hashlib.sha256(raw.encode()).hexdigest()
    conn = get_conn()
    conn.execute("""
        INSERT OR IGNORE INTO audit_log
        (audit_id, doc_id, action, actor, actor_type, result, amount, bank, doc_type, hash, metadata)
        VALUES (:audit_id, :doc_id, :action, :actor, :actor_type, :result, :amount, :bank, :doc_type, :hash, :metadata)
    """, entry)
    conn.commit()
    conn.close()


def list_audit(limit=100, search=None, actor_type=None):
    conn = get_conn()
    q = "SELECT * FROM audit_log"
    params = []
    filters = []
    if search:
        filters.append("(doc_id LIKE ? OR actor LIKE ? OR bank LIKE ?)")
        s = f"%{search}%"
        params += [s, s, s]
    if actor_type and actor_type != "all":
        filters.append("actor_type=?"); params.append(actor_type)
    if filters:
        q += " WHERE " + " AND ".join(filters)
    q += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    rows = conn.execute(q, params).fetchall()
    conn.close()
    return rows_to_list(rows)


def get_audit_stats():
    conn = get_conn()
    total = conn.execute("SELECT COUNT(*) FROM audit_log").fetchone()[0]
    approved = conn.execute("SELECT COUNT(*) FROM audit_log WHERE action='APPROVED'").fetchone()[0]
    flagged = conn.execute(
        "SELECT COUNT(*) FROM audit_log WHERE action IN ('FRAUD_FLAG','REJECTED','SIG_REJECT')"
    ).fetchone()[0]
    conn.close()
    return {"total": total, "approved": approved, "flagged": flagged}


# ── Dashboard Stats ─────────────────────────────────────────────────

def get_dashboard_stats():
    conn = get_conn()
    today = datetime.utcnow().date().isoformat()

    docs_today = conn.execute(
        "SELECT COUNT(*) FROM documents WHERE date(created_at)=?", (today,)
    ).fetchone()[0]

    fraud_today = conn.execute(
        "SELECT COUNT(*) FROM fraud_results WHERE risk_score >= 70 AND date(created_at)=?",
        (today,)
    ).fetchone()[0]

    avg_ms = conn.execute(
        "SELECT AVG(processing_ms) FROM documents WHERE processing_ms IS NOT NULL"
    ).fetchone()[0]

    sig_rejected = conn.execute(
        "SELECT COUNT(*) FROM signature_results WHERE verdict='FORGED'"
    ).fetchone()[0]

    vol_by_type = conn.execute("""
        SELECT type, COUNT(*) as count FROM documents
        WHERE date(created_at)=?
        GROUP BY type
    """, (today,)).fetchall()

    conn.close()
    return {
        "docs_today": docs_today,
        "fraud_flags": fraud_today,
        "avg_processing_ms": round(avg_ms or 183, 1),
        "sig_rejections": sig_rejected,
        "volume_by_type": rows_to_list(vol_by_type),
    }