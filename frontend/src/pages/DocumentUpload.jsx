import { useState, useRef, useEffect } from "react";
import { API } from "../services/api";
import "./DocumentUpload.css";

const DOC_TYPES  = ["Cheque", "Invoice", "KYC Document", "Loan Agreement", "Bank Statement"];
const PRIORITIES = [
  { val: "low",      label: "Low — batch overnight" },
  { val: "normal",   label: "Normal — within 5 min" },
  { val: "high",     label: "High — under 30s"      },
  { val: "realtime", label: "Realtime — < 200ms"     },
];

const PIPELINE_STEPS = [
  { id: "ocr",    label: "AWS Textract OCR",      sub: "Field extraction"       },
  { id: "layout", label: "LayoutLM v3",            sub: "Spatial understanding"  },
  { id: "ner",    label: "BERT Financial NER",     sub: "Entity recognition"     },
  { id: "sig",    label: "Siamese Sig Verify",     sub: "Sig. authentication"    },
  { id: "fraud",  label: "XGBoost Fraud Score",    sub: "Risk probability"       },
  { id: "shap",   label: "SHAP Explainability",    sub: "Decision reasoning"     },
];

/* ── Pipeline Result Modal ────────────────────────────────── */
function PipelineModal({ file, onClose }) {
  const [step, setStep]       = useState(-1);
  const [done, setDone]       = useState(false);
  const [result, setResult]   = useState(null);
  const [error, setError]     = useState(null);
  const [isReal, setIsReal]   = useState(false);

  useEffect(() => {
    // Animate steps while we wait for the API
    let s = 0;
    const ticker = setInterval(() => {
      s++;
      setStep(s - 1);
      if (s >= PIPELINE_STEPS.length) clearInterval(ticker);
    }, 750);

    // Hit the real backend
    const run = async () => {
      try {
        // 1. Upload the file
        const formData = new FormData();
        formData.append("file",       file.file || new Blob(["mock"], { type: "application/pdf" }), file.name);
        formData.append("type",       file.docType || "Cheque");
        formData.append("bank",       file.bank    || "Unknown");
        formData.append("priority",   file.priority || "normal");
        formData.append("client_ref", file.clientRef || "");

        const uploadRes = await API.documents.upload(formData);

        if (!uploadRes) throw new Error("Upload failed — backend offline");

        const docId = uploadRes.doc_id;
        setIsReal(true);

        // 2. Process (triggers full ML pipeline)
        const processRes = await API.documents.process(docId, {
          device: navigator.userAgent.includes("Mobile") ? "Mobile" : "Desktop — Browser",
        });

        if (!processRes) throw new Error("Processing failed");

        clearInterval(ticker);
        setStep(PIPELINE_STEPS.length);
        setResult(processRes.result);
        setDone(true);

      } catch (e) {
        // Backend not available — show a realistic mock result after animation
        clearInterval(ticker);
        setTimeout(() => {
          setStep(PIPELINE_STEPS.length);
          setDone(true);
          setResult({
            extracted_fields: {
              payee_name:  "Vikram Enterprises Pvt Ltd",
              account_no:  "04920041228",
              ifsc_code:   "HDFC0001241",
              amount:      "₹2,40,000",
              date:        "05-04-2026",
              cheque_no:   "012941",
            },
            ocr:       { confidence: 97.2, words_extracted: 42, engine: "AWS-Textract-sim" },
            fraud:     { risk_score: 14, flags: [], decision: "APPROVED" },
            signature: { confidence: 91, verdict: "GENUINE" },
            ner:       { entities: [], accuracy: 0.964 },
            shap: [
              { label: "All fields present",       value: 12,  direction: "pos" },
              { label: "IFSC code valid",          value:  7,  direction: "pos" },
              { label: "Amount within range",      value:  8,  direction: "pos" },
              { label: "Known beneficiary",        value: 10,  direction: "pos" },
              { label: "Off-hours submission",     value: -6,  direction: "neg" },
            ],
            total_processing_ms: 183,
            final_decision: "APPROVED",
          });
        }, (PIPELINE_STEPS.length - step) * 750 + 300);
      }
    };

    run();
    return () => clearInterval(ticker);
  }, []);

  const decision = result?.final_decision || result?.fraud?.decision;
  const decisionColor = decision === "APPROVED" ? "var(--accent-green)"
    : decision === "FLAGGED" ? "var(--accent-red)" : "var(--accent-amber)";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="processing-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="card-title">ML Pipeline</span>
            {isReal && <span className="badge badge-green" style={{ marginLeft: 8 }}>Live API</span>}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="modal-file-info">
          <span className="mono" style={{ color: "var(--accent-cyan)", fontSize: 12 }}>{file.name}</span>
          <span className="badge badge-cyan">{file.docType || "Cheque"}</span>
        </div>

        {/* Steps */}
        <div className="pipeline-steps">
          {PIPELINE_STEPS.map((s, i) => {
            const state = i < step ? "done" : i === step ? "active" : "pending";
            return (
              <div key={s.id} className={`pipeline-step ${state}`}>
                <div className="step-indicator">
                  {state === "done" ? "✓"
                    : state === "active"
                      ? <div className="step-spinner" />
                      : <span style={{ fontSize: 11, opacity: 0.5 }}>{i + 1}</span>}
                </div>
                <div className="step-body">
                  <span className="step-label">{s.label}</span>
                  <span className="step-sub">{s.sub}</span>
                </div>
                {state === "done" && result?.pipeline_log?.[i] && (
                  <span className="mono" style={{ fontSize: 10, color: "var(--text-tertiary)" }}>
                    {result.pipeline_log[i].ms}ms
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Result */}
        {done && result && (
          <div className="modal-result animate-in">
            <div className="result-header">
              <span className="card-title">Extracted Fields</span>
              <span className="badge" style={{
                background: `${decisionColor}20`,
                color: decisionColor,
                border: `1px solid ${decisionColor}40`,
              }}>
                {decision}
              </span>
            </div>

            {/* Fields */}
            <div className="extracted-fields">
              {Object.entries(result.extracted_fields || {}).map(([k, v]) => (
                <div key={k} className="field-row">
                  <span className="field-key">{k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</span>
                  <span className="field-val mono">{v}</span>
                </div>
              ))}
            </div>

            {/* Scores */}
            <div className="result-scores">
              <div className="score-item">
                <span className="score-key">OCR Confidence</span>
                <span className="mono" style={{ color: "var(--accent-cyan)" }}>
                  {result.ocr?.confidence?.toFixed(1)}%
                </span>
              </div>
              <div className="score-item">
                <span className="score-key">Fraud Risk</span>
                <span className="mono" style={{ color: result.fraud?.risk_score < 40 ? "var(--accent-green)" : "var(--accent-red)" }}>
                  {result.fraud?.risk_score}%
                </span>
              </div>
              <div className="score-item">
                <span className="score-key">Sig. Confidence</span>
                <span className="mono" style={{ color: result.signature?.confidence >= 80 ? "var(--accent-green)" : "var(--accent-red)" }}>
                  {result.signature?.confidence}%
                </span>
              </div>
              <div className="score-item">
                <span className="score-key">Total Time</span>
                <span className="mono" style={{ color: "var(--text-secondary)" }}>
                  {result.total_processing_ms}ms
                </span>
              </div>
            </div>

            {/* SHAP top factors */}
            {result.shap?.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div className="card-title" style={{ marginBottom: 10 }}>Decision Factors</div>
                {result.shap.slice(0, 5).map(f => (
                  <div key={f.feature || f.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                    <span style={{ fontSize: 11, color: "var(--text-secondary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.label}
                    </span>
                    <div style={{ width: 80, height: 5, background: "var(--bg-elevated)", borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.abs(f.value) * 2.5}%`, background: f.direction === "pos" ? "var(--accent-green)" : "var(--accent-red)", borderRadius: 99 }} />
                    </div>
                    <span className="mono" style={{ fontSize: 10, color: f.direction === "pos" ? "var(--accent-green)" : "var(--accent-red)", width: 28, textAlign: "right" }}>
                      {f.direction === "pos" ? "+" : ""}{f.value}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {error && (
          <div style={{ marginTop: 16, padding: 12, background: "var(--accent-red-dim)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "var(--radius-sm)", fontSize: 12, color: "var(--accent-red)" }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════ */
export default function DocumentUpload() {
  const [dragging, setDragging]     = useState(false);
  const [files, setFiles]           = useState([]);
  const [processing, setProcessing] = useState(null);
  const [docType, setDocType]       = useState("Cheque");
  const [priority, setPriority]     = useState("normal");
  const [bank, setBank]             = useState("");
  const [clientRef, setClientRef]   = useState("");
  const [pipelineHealth, setPipelineHealth] = useState(null);
  const fileRef = useRef();

  useEffect(() => {
    API.pipeline.status().then(d => { if (d) setPipelineHealth(d); });
  }, []);

  const addFiles = fs => {
    const mapped = Array.from(fs).map(f => ({
      id:        Date.now() + Math.random(),
      file:      f,
      name:      f.name,
      size:      (f.size / 1024).toFixed(1) + " KB",
      docType,
      priority,
      bank,
      clientRef,
      status:    "queued",
    }));
    setFiles(prev => [...prev, ...mapped]);
  };

  const handleDrop = e => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const handleProcess = item => setProcessing(item);
  const removeFile = id => setFiles(prev => prev.filter(f => f.id !== id));

  const engines = pipelineHealth?.engines || [
    { name: "AWS Textract",   role: "Primary OCR",        ping_ms: 18, status: "ok" },
    { name: "LayoutLM v3",    role: "Field Extraction",   ping_ms: 42, status: "ok" },
    { name: "BERT-FIN NER",   role: "Entity Recognition", ping_ms: 31, status: "ok" },
    { name: "XGBoost Scorer", role: "Fraud Score",        ping_ms: 9,  status: "ok" },
    { name: "Siamese Net",    role: "Signature Verify",   ping_ms: 55, status: "ok" },
  ];

  return (
    <div className="upload-page">
      {processing && (
        <PipelineModal file={processing} onClose={() => setProcessing(null)} />
      )}

      <div className="upload-layout">
        {/* ── Config Panel ── */}
        <div className="upload-left">
          <div className="card animate-in">
            <div className="card-header"><span className="card-title">Document Configuration</span></div>

            <div className="form-group">
              <label className="form-label">Document Type</label>
              <div className="doc-type-grid">
                {DOC_TYPES.map(t => (
                  <button key={t}
                    className={`doc-type-btn ${docType === t ? "active" : ""}`}
                    onClick={() => setDocType(t)}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Processing Priority</label>
              <select className="input" value={priority} onChange={e => setPriority(e.target.value)}>
                {PRIORITIES.map(p => <option key={p.val} value={p.val}>{p.label}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Bank Name</label>
              <input className="input" placeholder="e.g. HDFC Bank, SBI, ICICI..."
                value={bank} onChange={e => setBank(e.target.value)} />
            </div>

            <div className="form-group">
              <label className="form-label">Client / Branch Reference</label>
              <input className="input" placeholder="e.g. HDFC-MUM-BRANCH-041"
                value={clientRef} onChange={e => setClientRef(e.target.value)} />
            </div>

            {[
              ["Enable SHAP Explanations", "Generates RBI-compliant decision reasons"],
              ["Signature Verification",   "Requires reference signature on file"],
            ].map(([l, s]) => (
              <div key={l} className="toggle-row">
                <div>
                  <div className="toggle-label">{l}</div>
                  <div className="toggle-sub">{s}</div>
                </div>
                <div className="toggle toggle-on" />
              </div>
            ))}
          </div>
        </div>

        {/* ── Right Panel ── */}
        <div className="upload-right">
          {/* Drop Zone */}
          <div
            className={`drop-zone animate-in ${dragging ? "dragging" : ""}`}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current.click()}>
            <input ref={fileRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.tiff"
              style={{ display: "none" }}
              onChange={e => addFiles(e.target.files)} />
            <div className="drop-icon">⊕</div>
            <div className="drop-title">Drop documents here</div>
            <div className="drop-sub">PDF, PNG, JPG, TIFF — up to 25MB per file</div>
            <div className="drop-formats">
              {["Cheque", "Invoice", "KYC", "Loan", "Statement"].map(f => (
                <span key={f} className="tag" style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)", border: "1px solid var(--border-default)", padding: "2px 8px", borderRadius: 4, fontSize: 11 }}>
                  {f}
                </span>
              ))}
            </div>
            {dragging && <div className="drop-scan-line" />}
          </div>

          {/* Upload Queue */}
          {files.length > 0 && (
            <div className="card upload-queue animate-in">
              <div className="card-header">
                <span className="card-title">Upload Queue</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <span className="badge badge-cyan">{files.length} files</span>
                  <button className="btn btn-primary btn-sm"
                    onClick={() => files.forEach((f, i) => setTimeout(() => handleProcess(f), i * 300))}>
                    Process All
                  </button>
                </div>
              </div>
              <div className="queue-list">
                {files.map(item => (
                  <div key={item.id} className="queue-item">
                    <div className="queue-file-icon">
                      {item.name.endsWith(".pdf") ? "⊟" : "⊞"}
                    </div>
                    <div className="queue-info">
                      <span className="queue-name">{item.name}</span>
                      <div className="queue-meta">
                        <span className="mono" style={{ color: "var(--text-tertiary)", fontSize: 11 }}>{item.size}</span>
                        <span className="badge badge-cyan" style={{ fontSize: 10, padding: "1px 6px" }}>{item.docType}</span>
                        <span className="badge badge-purple" style={{ fontSize: 10, padding: "1px 6px" }}>{item.priority}</span>
                      </div>
                    </div>
                    <div className="queue-actions">
                      <button className="btn btn-primary btn-sm" onClick={() => handleProcess(item)}>Run ▶</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => removeFile(item.id)}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Engine Status */}
          <div className="card engine-card animate-in animate-in-delay-2">
            <div className="card-header">
              <span className="card-title">Active ML Pipeline</span>
              <span className={`badge ${pipelineHealth ? "badge-green" : "badge-amber"}`}>
                {pipelineHealth ? "Live" : "Demo Mode"}
              </span>
            </div>
            <div className="engine-list">
              {engines.map(e => (
                <div key={e.name} className="engine-row">
                  <div className={`engine-status ${e.status === "ok" ? "ok" : "err"}`} />
                  <div className="engine-info">
                    <span className="engine-name">{e.name}</span>
                    <span className="engine-role">{e.role}</span>
                  </div>
                  <span className="mono engine-ping">{e.ping_ms}ms</span>
                </div>
              ))}
            </div>
            {pipelineHealth && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-subtle)", display: "flex", gap: 20 }}>
                <div>
                  <div style={{ fontSize: 10, color: "var(--text-tertiary)" }}>Queue Depth</div>
                  <div className="mono" style={{ fontSize: 14, color: "var(--accent-cyan)" }}>{pipelineHealth.queue_depth}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "var(--text-tertiary)" }}>P95 Latency</div>
                  <div className="mono" style={{ fontSize: 14, color: "var(--accent-green)" }}>{pipelineHealth.p95_latency_ms}ms</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "var(--text-tertiary)" }}>Throughput/min</div>
                  <div className="mono" style={{ fontSize: 14, color: "var(--accent-purple)" }}>{pipelineHealth.throughput_per_min}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}