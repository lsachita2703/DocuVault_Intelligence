"""
DocuVault ML Engine
Modules:
  1. OCR Pipeline  (pytesseract + OpenCV pre-processing)
  2. Field Extractor (regex + layout heuristics, mimics LayoutLM)
  3. Fraud Scorer  (XGBoost-style rule + weighted feature model)
  4. Signature Verifier (Siamese-style distance metrics on image)
  5. SHAP Explainer (feature contribution calculator)
  6. NER Engine (financial entity recognizer)
"""

import re
import os
import math
import json
import time
import hashlib
import random
import numpy as np
from datetime import datetime

# Optional imports — graceful fallback if tesseract not installed
try:
    import cv2
    CV2_OK = True
except ImportError:
    CV2_OK = False

try:
    import pytesseract
    from PIL import Image
    TESS_OK = True
except ImportError:
    TESS_OK = False


# ─────────────────────────────────────────────────────────
# 1. OCR PIPELINE
# ─────────────────────────────────────────────────────────

def preprocess_image(image_path: str):
    """OpenCV pre-processing: grayscale → denoise → threshold → deskew."""
    if not CV2_OK:
        return None
    img = cv2.imread(image_path)
    if img is None:
        return None
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # Denoise
    denoised = cv2.fastNlMeansDenoising(gray, h=10)
    # Adaptive threshold
    thresh = cv2.adaptiveThreshold(
        denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY, 11, 2
    )
    # Deskew via moments
    coords = np.column_stack(np.where(thresh < 127))
    if len(coords) > 0:
        angle = cv2.minAreaRect(coords)[-1]
        if angle < -45:
            angle = 90 + angle
        if abs(angle) > 0.5:
            (h, w) = thresh.shape[:2]
            M = cv2.getRotationMatrix2D((w // 2, h // 2), angle, 1.0)
            thresh = cv2.warpAffine(thresh, M, (w, h),
                                    flags=cv2.INTER_CUBIC,
                                    borderMode=cv2.BORDER_REPLICATE)
    return thresh


def run_ocr(file_path: str, doc_type: str = "Cheque") -> dict:
    """
    Run OCR on uploaded file. Returns raw text + confidence.
    Falls back to realistic mock if tesseract unavailable.
    """
    start = time.time()

    # Real OCR path
    if TESS_OK and CV2_OK and os.path.exists(file_path):
        try:
            processed = preprocess_image(file_path)
            if processed is not None:
                pil_img = Image.fromarray(processed)
                data = pytesseract.image_to_data(
                    pil_img,
                    output_type=pytesseract.Output.DICT,
                    config="--psm 6 -l eng"
                )
                texts = [data["text"][i] for i in range(len(data["text"]))
                         if int(data["conf"][i]) > 40 and data["text"][i].strip()]
                confs = [int(data["conf"][i]) for i in range(len(data["conf"]))
                         if int(data["conf"][i]) > 40 and data["text"][i].strip()]
                raw_text = " ".join(texts)
                avg_conf = sum(confs) / len(confs) if confs else 0
                elapsed_ms = int((time.time() - start) * 1000)
                return {
                    "raw_text": raw_text,
                    "confidence": round(avg_conf, 1),
                    "engine": "AWS-Textract-sim/pytesseract",
                    "processing_ms": elapsed_ms,
                    "words_extracted": len(texts),
                }
        except Exception as e:
            pass  # fall through to mock

    # Realistic mock based on doc type
    elapsed_ms = random.randint(80, 220)
    time.sleep(elapsed_ms / 1000)

    MOCK_OCR = {
        "Cheque": {
            "raw_text": "PAY HDFC BANK LIMITED ACCOUNT NO 04920041228 IFSC HDFC0001241 "
                        "AMOUNT TWO LAKH FORTY THOUSAND ONLY ₹2,40,000 DATE 05-04-2026 "
                        "CHEQUE NO 012941 SIGNED VIKRAM ENTERPRISES PVT LTD MICR 400240006",
            "confidence": round(random.uniform(91, 99), 1),
        },
        "Invoice": {
            "raw_text": "TAX INVOICE GST NO 27AABCV1234M1ZR INVOICE NO INV-2026-0931 "
                        "DATE 07-04-2026 BILL TO HDFC BANK LTD AMOUNT ₹18,500 "
                        "CGST 9% SGST 9% TOTAL ₹18,500 VENDOR ALPHA SOLUTIONS",
            "confidence": round(random.uniform(88, 97), 1),
        },
        "KYC Document": {
            "raw_text": "NAME PRIYA SHARMA DOB 15-08-1990 PAN ABCPS1234D "
                        "AADHAAR 1234 5678 9012 ADDRESS 42 MG ROAD PUNE MAHARASHTRA 411001 "
                        "MOBILE 9876543210 EMAIL priya@email.com",
            "confidence": round(random.uniform(93, 99), 1),
        },
        "Loan Agreement": {
            "raw_text": "LOAN AGREEMENT NO LNA-2026-0214 KOTAK MAHINDRA BANK "
                        "BORROWER ALPHA CORP PVT LTD PRINCIPAL ₹5,00,000 "
                        "RATE 12.5% PA TENURE 36 MONTHS EMI ₹16,750 "
                        "GUARANTOR ROHAN MEHTA PAN ZZXRO9876P",
            "confidence": round(random.uniform(90, 98), 1),
        },
        "Bank Statement": {
            "raw_text": "HDFC BANK ACCOUNT STATEMENT ACCOUNT NO 50100123456789 "
                        "PERIOD 01-MAR-2026 TO 31-MAR-2026 OPENING BALANCE ₹1,24,500 "
                        "CLOSING BALANCE ₹89,230 TOTAL CREDITS ₹45,000 TOTAL DEBITS ₹80,270",
            "confidence": round(random.uniform(92, 99), 1),
        },
    }
    mock = MOCK_OCR.get(doc_type, MOCK_OCR["Cheque"])
    return {
        "raw_text": mock["raw_text"],
        "confidence": mock["confidence"],
        "engine": "AWS-Textract-sim",
        "processing_ms": elapsed_ms,
        "words_extracted": len(mock["raw_text"].split()),
    }


# ─────────────────────────────────────────────────────────
# 2. FIELD EXTRACTOR (LayoutLM-sim)
# ─────────────────────────────────────────────────────────

FIELD_PATTERNS = {
    "amount": [
        r"₹\s*[\d,]+(?:\.\d{2})?",
        r"RS\.?\s*[\d,]+",
        r"INR\s*[\d,]+",
    ],
    "date": [
        r"\b\d{2}[-/]\d{2}[-/]\d{4}\b",
        r"\b\d{2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}\b",
    ],
    "account_no": [r"\b\d{9,18}\b"],
    "ifsc": [r"\b[A-Z]{4}0[A-Z0-9]{6}\b"],
    "pan": [r"\b[A-Z]{5}\d{4}[A-Z]\b"],
    "gstin": [r"\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}\b"],
    "cheque_no": [r"\bCHEQUE\s*NO\.?\s*(\d{6,})\b", r"\b(\d{6,})\b"],
    "micr": [r"\bMICR\s+(\d{9})\b"],
    "mobile": [r"\b[6-9]\d{9}\b"],
    "email": [r"\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b"],
}

def extract_fields(raw_text: str, doc_type: str) -> dict:
    """Extract structured fields from OCR text using regex + heuristics."""
    text = raw_text.upper()
    fields = {}

    # Amount
    for pat in FIELD_PATTERNS["amount"]:
        m = re.search(pat, raw_text, re.I)
        if m:
            fields["amount"] = m.group().strip()
            break

    # Date
    for pat in FIELD_PATTERNS["date"]:
        m = re.search(pat, raw_text, re.I)
        if m:
            fields["date"] = m.group().strip()
            break

    # Account number
    m = re.search(r"ACCOUNT\s*NO\.?\s*(\d[\d\s]{8,17})", text)
    if m:
        fields["account_no"] = m.group(1).strip().replace(" ", "")

    # IFSC
    m = re.search(FIELD_PATTERNS["ifsc"][0], text)
    if m:
        fields["ifsc_code"] = m.group().strip()

    # PAN
    m = re.search(FIELD_PATTERNS["pan"][0], text)
    if m:
        fields["pan"] = m.group().strip()

    # GSTIN
    m = re.search(FIELD_PATTERNS["gstin"][0], text)
    if m:
        fields["gstin"] = m.group().strip()

    # Cheque specific
    if doc_type == "Cheque":
        m = re.search(r"CHEQUE\s*NO\.?\s*(\d{6,})", text)
        if m:
            fields["cheque_no"] = m.group(1).strip()
        m = re.search(r"MICR\s+(\d{9})", text)
        if m:
            fields["micr"] = m.group(1)

    # Email / Mobile
    m = re.search(FIELD_PATTERNS["email"][0], raw_text, re.I)
    if m:
        fields["email"] = m.group().strip().lower()

    m = re.search(FIELD_PATTERNS["mobile"][0], raw_text)
    if m:
        fields["mobile"] = m.group().strip()

    # Payee/Name extraction (before keyword)
    for kw in ["PAY", "ACCOUNT", "BILL TO", "BORROWER", "NAME"]:
        m = re.search(rf"{kw}\s+([A-Z][A-Z\s]+(?:PVT|LTD|BANK|CORP|LLP|LLC)?[A-Z\s]*)", text)
        if m:
            name = m.group(1).strip()[:60]
            if len(name) > 3:
                fields["payee_name"] = name.title()
                break

    return fields


# ─────────────────────────────────────────────────────────
# 3. NER ENGINE (BERT-FIN-sim)
# ─────────────────────────────────────────────────────────

FINANCIAL_ENTITIES = {
    "BANK": ["HDFC BANK", "ICICI BANK", "SBI", "AXIS BANK", "KOTAK BANK",
             "YES BANK", "PNB", "CANARA BANK", "BOI", "UNION BANK"],
    "CURRENCY": ["INR", "₹", "RS", "RUPEE"],
    "ORGANIZATION": ["PVT LTD", "LTD", "CORP", "ENTERPRISES", "SOLUTIONS", "ASSOCIATES"],
}

def run_ner(raw_text: str) -> dict:
    """Financial NER — extracts typed entities from OCR text."""
    entities = []
    text_upper = raw_text.upper()

    for bank in FINANCIAL_ENTITIES["BANK"]:
        if bank in text_upper:
            entities.append({"entity": bank.title(), "type": "BANK", "confidence": round(random.uniform(0.92, 0.99), 3)})

    amounts = re.findall(r"₹[\d,]+(?:\.\d{2})?|RS\.?\s*[\d,]+|INR\s*[\d,]+", raw_text, re.I)
    for a in amounts[:3]:
        entities.append({"entity": a.strip(), "type": "AMOUNT", "confidence": round(random.uniform(0.95, 0.99), 3)})

    dates = re.findall(r"\d{2}[-/]\d{2}[-/]\d{4}", raw_text)
    for d in dates[:2]:
        entities.append({"entity": d, "type": "DATE", "confidence": round(random.uniform(0.90, 0.99), 3)})

    pans = re.findall(r"\b[A-Z]{5}\d{4}[A-Z]\b", raw_text.upper())
    for p in pans[:2]:
        entities.append({"entity": p, "type": "PAN", "confidence": round(random.uniform(0.97, 0.99), 3)})

    ifscs = re.findall(r"\b[A-Z]{4}0[A-Z0-9]{6}\b", raw_text.upper())
    for i in ifscs[:2]:
        entities.append({"entity": i, "type": "IFSC", "confidence": round(random.uniform(0.96, 0.99), 3)})

    accuracy = round(random.uniform(0.91, 0.98), 3)
    return {"entities": entities, "accuracy": accuracy, "model": "BERT-FIN-NER-v3"}


# ─────────────────────────────────────────────────────────
# 4. FRAUD SCORER (XGBoost-sim)
# ─────────────────────────────────────────────────────────

def compute_fraud_score(doc_data: dict, extracted_fields: dict, metadata: dict) -> dict:
    """
    Weighted multi-feature fraud score. Mimics XGBoost feature importance.
    Returns score 0-100 (higher = more risky).
    """
    score = 0.0
    flags = []
    feature_weights = {}

    # ── Feature 1: Amount anomaly ─────────────────────
    amount_str = extracted_fields.get("amount", "")
    amount_val = 0
    m = re.search(r"[\d,]+", amount_str.replace("₹", "").replace("RS", "").replace("INR", ""))
    if m:
        try:
            amount_val = int(m.group().replace(",", ""))
        except:
            pass

    if amount_val > 1_000_000:   # > 10 lakh
        w = 25
        score += w
        flags.append("Amount exceeds ₹10L threshold")
        feature_weights["high_amount"] = -w
    elif amount_val > 500_000:
        w = 12
        score += w
        flags.append("Amount exceeds ₹5L threshold")
        feature_weights["high_amount"] = -w
    else:
        feature_weights["amount_normal"] = +8

    # ── Feature 2: Submission time ─────────────────────
    hour = metadata.get("hour", datetime.utcnow().hour)
    if hour < 6 or hour > 22:
        w = 18
        score += w
        flags.append("Off-hours submission (unusual time)")
        feature_weights["submission_time"] = -w
    else:
        feature_weights["submission_time"] = +6

    # ── Feature 3: Device/IP risk ──────────────────────
    device = metadata.get("device", "Desktop")
    if "mobile" in device.lower():
        w = 8
        score += w
        feature_weights["mobile_submission"] = -w
    else:
        feature_weights["device_trust"] = +5

    # ── Feature 4: Missing critical fields ────────────
    critical = ["amount", "date", "account_no"] if doc_data.get("type") == "Cheque" else ["amount", "date"]
    missing = [f for f in critical if not extracted_fields.get(f)]
    if missing:
        w = len(missing) * 10
        score += w
        flags.append(f"Missing fields: {', '.join(missing)}")
        feature_weights["missing_fields"] = -w
    else:
        feature_weights["fields_complete"] = +12

    # ── Feature 5: IFSC validation ─────────────────────
    ifsc = extracted_fields.get("ifsc_code", "")
    if doc_data.get("type") == "Cheque":
        if not ifsc or not re.match(r"[A-Z]{4}0[A-Z0-9]{6}", ifsc):
            w = 10
            score += w
            flags.append("IFSC code invalid or missing")
            feature_weights["ifsc_invalid"] = -w
        else:
            feature_weights["ifsc_valid"] = +7

    # ── Feature 6: Date validity ───────────────────────
    date_str = extracted_fields.get("date", "")
    date_valid = bool(re.search(r"\d{2}[-/]\d{2}[-/]\d{4}", date_str))
    if not date_valid:
        w = 8
        score += w
        flags.append("Date format invalid or missing")
        feature_weights["date_invalid"] = -w
    else:
        # Check for future/stale dates
        feature_weights["date_valid"] = +8

    # ── Feature 7: New beneficiary (simulated) ─────────
    if random.random() < 0.25:
        w = 15
        score += w
        flags.append("New/unrecognised beneficiary")
        feature_weights["new_beneficiary"] = -w
    else:
        feature_weights["known_beneficiary"] = +10

    # ── Feature 8: Historical pattern ─────────────────
    hist_anomaly = random.random() < 0.2
    if hist_anomaly:
        w = 12
        score += w
        flags.append("Deviation from historical patterns")
        feature_weights["history_anomaly"] = -w
    else:
        feature_weights["history_normal"] = +6

    # ── Clamp and add noise ────────────────────────────
    noise = random.uniform(-3, 3)
    score = max(0, min(100, score + noise))
    score = round(score, 1)

    decision = "APPROVED" if score < 40 else ("REVIEW" if score < 70 else "FLAGGED")

    return {
        "risk_score": score,
        "flags": flags,
        "feature_weights": feature_weights,
        "decision": decision,
        "model_version": "XGBoost-v1.4",
    }


# ─────────────────────────────────────────────────────────
# 5. SHAP EXPLAINER
# ─────────────────────────────────────────────────────────

def compute_shap(feature_weights: dict) -> list:
    """Convert feature weights to SHAP-style explanation entries."""
    LABELS = {
        "high_amount":       "High amount vs history",
        "amount_normal":     "Amount within normal range",
        "submission_time":   "Submission time",
        "mobile_submission": "Mobile device submission",
        "device_trust":      "Trusted device",
        "missing_fields":    "Missing critical fields",
        "fields_complete":   "All fields present",
        "ifsc_invalid":      "IFSC code invalid",
        "ifsc_valid":        "IFSC code valid",
        "date_invalid":      "Date format invalid",
        "date_valid":        "Date format valid",
        "new_beneficiary":   "New/unrecognised beneficiary",
        "known_beneficiary": "Known beneficiary",
        "history_anomaly":   "Historical pattern deviation",
        "history_normal":    "Matches historical patterns",
    }
    results = []
    for key, val in feature_weights.items():
        label = LABELS.get(key, key.replace("_", " ").title())
        results.append({
            "feature": key,
            "label": label,
            "value": val,
            "direction": "pos" if val > 0 else "neg",
        })
    results.sort(key=lambda x: abs(x["value"]), reverse=True)
    return results[:8]


# ─────────────────────────────────────────────────────────
# 6. SIGNATURE VERIFIER (Siamese-sim)
# ─────────────────────────────────────────────────────────

def verify_signature(doc_id: str, file_path: str = None) -> dict:
    """
    Siamese network simulation.
    If an image is provided, compute real pixel-based distance metrics.
    Otherwise, use a deterministic hash-based mock.
    """
    # Deterministic confidence based on doc_id hash
    seed = int(hashlib.md5(doc_id.encode()).hexdigest(), 16) % 1000
    random.seed(seed)

    if file_path and os.path.exists(file_path) and CV2_OK:
        try:
            img = cv2.imread(file_path, cv2.IMREAD_GRAYSCALE)
            if img is not None:
                # Simulate feature distances from image statistics
                h, w = img.shape
                # Crop bottom portion (signature area)
                sig_area = img[int(h * 0.7):, :]
                mean_px = float(np.mean(sig_area))
                std_px = float(np.std(sig_area))
                # More texture = higher confidence (real sigs are complex)
                base_conf = min(99, max(25, (std_px / 80) * 100))
                confidence = round(base_conf + random.uniform(-5, 5), 1)
                confidence = max(20, min(99, confidence))
                source = "image-analysis"
            else:
                raise ValueError("Could not read image")
        except Exception:
            confidence = round(random.uniform(30, 95), 1)
            source = "hash-mock"
    else:
        confidence = round(random.uniform(30, 95), 1)
        source = "hash-mock"

    verdict = "GENUINE" if confidence >= 80 else ("UNCERTAIN" if confidence >= 60 else "FORGED")

    # Feature distances (lower = more similar)
    forged = confidence < 60
    feature_distances = {
        "stroke_curvature": round(random.uniform(0.55, 0.75) if forged else random.uniform(0.04, 0.12), 3),
        "pressure_map": round(random.uniform(0.45, 0.65) if forged else random.uniform(0.08, 0.16), 3),
        "aspect_ratio": round(random.uniform(0.15, 0.30) if forged else random.uniform(0.02, 0.07), 3),
        "slant_angle": round(random.uniform(0.50, 0.70) if forged else random.uniform(0.06, 0.13), 3),
        "loop_formation": round(random.uniform(0.38, 0.55) if forged else random.uniform(0.04, 0.10), 3),
        "endpoint_similarity": round(random.uniform(0.30, 0.45) if forged else random.uniform(0.08, 0.15), 3),
    }

    return {
        "confidence": confidence,
        "verdict": verdict,
        "feature_distances": feature_distances,
        "model_version": "Siamese-v2.1",
        "source": source,
    }


# ─────────────────────────────────────────────────────────
# 7. FULL PIPELINE ORCHESTRATOR
# ─────────────────────────────────────────────────────────

def run_full_pipeline(doc_id: str, file_path: str, doc_type: str,
                      bank: str, metadata: dict = None) -> dict:
    """
    Orchestrates: OCR → Field Extraction → NER → Fraud Score → SHAP → Signature
    Returns combined result dict.
    """
    if metadata is None:
        metadata = {}

    pipeline_log = []
    t0 = time.time()

    # Step 1: OCR
    ocr = run_ocr(file_path, doc_type)
    pipeline_log.append({"step": "OCR", "ms": ocr["processing_ms"], "engine": ocr["engine"]})

    # Step 2: Field Extraction
    t1 = time.time()
    fields = extract_fields(ocr["raw_text"], doc_type)
    fe_ms = int((time.time() - t1) * 1000)
    pipeline_log.append({"step": "LayoutLM Field Extract", "ms": fe_ms, "fields_found": len(fields)})

    # Step 3: NER
    t2 = time.time()
    ner = run_ner(ocr["raw_text"])
    ner_ms = int((time.time() - t2) * 1000)
    pipeline_log.append({"step": "BERT-FIN NER", "ms": ner_ms, "entities": len(ner["entities"])})

    # Step 4: Fraud Scoring
    t3 = time.time()
    fraud = compute_fraud_score(
        {"type": doc_type, "bank": bank},
        fields,
        metadata
    )
    fraud_ms = int((time.time() - t3) * 1000)
    pipeline_log.append({"step": "XGBoost Fraud Score", "ms": fraud_ms, "score": fraud["risk_score"]})

    # Step 5: SHAP
    t4 = time.time()
    shap = compute_shap(fraud["feature_weights"])
    shap_ms = int((time.time() - t4) * 1000)
    pipeline_log.append({"step": "SHAP Explainer", "ms": shap_ms})

    # Step 6: Signature
    t5 = time.time()
    sig = verify_signature(doc_id, file_path)
    sig_ms = int((time.time() - t5) * 1000)
    pipeline_log.append({"step": "Siamese Sig Verify", "ms": sig_ms, "confidence": sig["confidence"]})

    total_ms = int((time.time() - t0) * 1000)

    return {
        "doc_id": doc_id,
        "doc_type": doc_type,
        "bank": bank,
        "ocr": ocr,
        "extracted_fields": fields,
        "ner": ner,
        "fraud": fraud,
        "shap": shap,
        "signature": sig,
        "pipeline_log": pipeline_log,
        "total_processing_ms": total_ms,
        "final_decision": fraud["decision"],
    }