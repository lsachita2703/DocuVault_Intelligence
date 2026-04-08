# DocuVault Intelligence — Full Stack Setup

## Architecture Overview

```
docuvault-backend/          ← Flask REST API (Python)
├── app.py                  ← Entry point, CORS, error handlers
├── start.sh                ← One-command startup with DB seed
├── requirements.txt
├── db/
│   └── database.py         ← SQLite schema + all CRUD operations
├── ml/
│   └── engine.py           ← All 6 ML modules
│       ├── OCR Pipeline    (pytesseract + OpenCV preprocessing)
│       ├── Field Extractor (LayoutLM-sim: regex + heuristics)
│       ├── NER Engine      (BERT-FIN-sim: financial entity recognition)
│       ├── Fraud Scorer    (XGBoost-sim: 8-feature weighted model)
│       ├── SHAP Explainer  (feature contribution calculator)
│       └── Sig. Verifier   (Siamese-sim: pixel + distance metrics)
├── routes/
│   └── api.py              ← 15 REST endpoints (all blueprint)
└── uploads/                ← Uploaded documents stored here

docuvault-frontend-src/     ← React frontend (Vite)
├── App.jsx                 ← Router + shell
├── index.css               ← Design system (CSS variables)
├── services/
│   └── api.js              ← API service layer (fetch wrapper)
├── components/
│   ├── Sidebar.jsx/css
│   └── TopBar.jsx/css
└── pages/
    ├── Dashboard.jsx       ← Live stats, feed, model health
    ├── DocumentUpload.jsx  ← Drag-drop upload + pipeline modal
    ├── FraudAnalysis.jsx   ← Queue + SHAP + human decisions
    ├── SignatureVerification.jsx ← Siamese compare + override
    └── AuditLog.jsx        ← Immutable log + CSV export
```

---

## Backend Setup

### 1. Install dependencies
```bash
cd docuvault-backend
pip3 install flask numpy opencv-python-headless pillow pytesseract scikit-learn scipy
```

### 2. (Optional) Install Tesseract OCR engine for real OCR
```bash
# Ubuntu / Debian
sudo apt-get install tesseract-ocr

# macOS
brew install tesseract

# Windows — download installer from:
# https://github.com/UB-Mannheim/tesseract/wiki
```

### 3. Start the server
```bash
bash start.sh
# or directly:
python3 app.py
```

Server starts on **http://localhost:5000**

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | System health check |
| GET | `/api/dashboard/stats` | KPI stats for dashboard |
| GET | `/api/dashboard/live-feed` | Recent documents |
| GET | `/api/pipeline/status` | ML engine health + latency |
| GET | `/api/documents` | List all documents |
| GET | `/api/documents/<id>` | Single document detail |
| POST | `/api/documents/upload` | Upload document (multipart) |
| POST | `/api/documents/<id>/process` | Run full ML pipeline |
| GET | `/api/fraud/queue` | Fraud review queue |
| GET | `/api/fraud/<id>` | Fraud detail + SHAP |
| POST | `/api/fraud/<id>/decision` | Approve/Reject/Review |
| GET | `/api/signature/queue` | Signature verification queue |
| GET | `/api/signature/<id>` | Signature detail + distances |
| POST | `/api/signature/<id>/override` | Human override decision |
| GET | `/api/audit` | Audit log (search + filter) |
| GET | `/api/audit/stats` | Audit statistics |
| GET | `/api/audit/export/csv` | Download CSV export |

---

## Frontend Setup

```bash
# In your React project root (where package.json is)
npm install
npm run dev
# Frontend starts on http://localhost:5173
```

The frontend auto-connects to backend at `http://localhost:5000/api`.
If backend is offline, it gracefully falls back to realistic mock data — the UI always looks correct.

---

## ML Pipeline Flow

When a document is uploaded and processed (`POST /api/documents/<id>/process`):

```
1. AWS Textract OCR sim    → raw text + word count + confidence
2. LayoutLM Field Extract  → amount, date, account_no, IFSC, PAN, payee...
3. BERT-FIN NER            → typed entities (BANK, AMOUNT, DATE, PAN, IFSC)
4. XGBoost Fraud Score     → risk 0-100 based on 8 weighted features:
   • Amount anomaly         • Submission hour
   • Device/IP risk         • Missing critical fields
   • IFSC validation        • Date validity
   • New beneficiary        • Historical pattern deviation
5. SHAP Explainability     → feature contributions (RBI-mandated)
6. Siamese Sig Verify      → confidence + 6 feature distances
```

All steps are logged to the immutable audit table with SHA-256 hashes.

---

## Human Decision Flow

### Fraud decisions
```
POST /api/fraud/<doc_id>/decision
Body: { "decision": "APPROVED" | "REJECTED" | "REVIEW", "reviewer": "Rahul Bajaj" }
```
- Updates document status
- Creates `HUMAN_OVERRIDE` or `APPROVED`/`REJECTED` audit entry
- Stores reviewer name

### Signature overrides
```
POST /api/signature/<doc_id>/override
Body: { "decision": "GENUINE" | "FORGED" | "UNCERTAIN", "reviewer": "Rahul Bajaj" }
```

---

## Database Schema

**SQLite** at `db/docuvault.db` — WAL mode, foreign keys ON.

Tables: `documents`, `fraud_results`, `signature_results`, `audit_log`, `users`

All audit entries are write-once with SHA-256 hash for RBI compliance.
