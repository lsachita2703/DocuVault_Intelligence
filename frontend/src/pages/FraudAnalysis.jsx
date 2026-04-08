import { useState, useEffect, useCallback } from "react";
import { API } from "../services/api";
import "./FraudAnalysis.css";

/* ── Helpers ── */
function MiniBar({ v, color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div className="pbar" style={{ flex: 1 }}>
        <div className="pfill" style={{ width: `${v}%`, background: color }} />
      </div>
      <span className="mono" style={{ fontSize: 10, color, width: 32, textAlign: "right" }}>{v}%</span>
    </div>
  );
}

function RiskGauge({ score }) {
  const color = score >= 80 ? "var(--accent-red)" : score >= 50 ? "var(--accent-amber)" : "var(--accent-green)";
  const fill  = (score / 100) * 150.8;
  return (
    <div style={{ textAlign: "center", flexShrink: 0 }}>
      <svg width="130" height="78" viewBox="0 0 130 80">
        <path d="M12 72 A52 52 0 0 1 118 72" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" strokeLinecap="round" />
        <path d="M12 72 A52 52 0 0 1 118 72" fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${fill} 163.4`} />
      </svg>
      <div className="mono" style={{ fontSize: 28, fontWeight: 700, color, marginTop: -10, lineHeight: 1 }}>{score}</div>
      <div style={{ fontSize: 9, color: "var(--text-tertiary)", letterSpacing: "0.1em", marginTop: 2 }}>RISK SCORE</div>
    </div>
  );
}

function StatusBadge({ s }) {
  const m = { approved: "badge-green", rejected: "badge-red", review: "badge-cyan", pending: "badge-amber", flagged: "badge-red" };
  return <span className={`badge ${m[s] || "badge-cyan"}`}>{s?.toUpperCase()}</span>;
}

/* ── Mock fallback ── */
const MOCK_QUEUE = [
  { id:"CHQ-2041", type:"Cheque",  bank:"YES Bank",   amount:"₹12,00,000", risk_score:91,
    flags:["High amount vs history","New beneficiary","Off-hours submission"],
    sig:42, ocr_conf:99, ner_conf:97, status:"pending", ip:"103.21.58.x", created_at:"07 Apr, 02:41 AM",
    shap_values:[
      {label:"High amount vs history",value:-32,direction:"neg"},{label:"New beneficiary",value:-18,direction:"neg"},
      {label:"Off-hours submission",value:-14,direction:"neg"},{label:"OCR confidence",value:10,direction:"pos"},
      {label:"Device fingerprint",value:-9,direction:"neg"},{label:"IFSC valid",value:7,direction:"pos"},
    ]},
  { id:"INV-0931", type:"Invoice", bank:"ICICI Bank", amount:"₹18,500",   risk_score:71,
    flags:["GST mismatch","Vendor not KYC verified"],
    sig:88, ocr_conf:94, ner_conf:91, status:"pending", ip:"49.204.11.x", created_at:"07 Apr, 10:15 AM",
    shap_values:[
      {label:"GST number mismatch",value:-22,direction:"neg"},{label:"Vendor not KYC",value:-19,direction:"neg"},
      {label:"Amount within range",value:14,direction:"pos"},{label:"OCR confidence",value:12,direction:"pos"},
    ]},
  { id:"CHQ-2039", type:"Cheque",  bank:"SBI",        amount:"₹85,000",   risk_score:58,
    flags:["Date discrepancy","Handwriting confidence 61%"],
    sig:73, ocr_conf:88, ner_conf:95, status:"review",   ip:"27.97.30.x",  created_at:"07 Apr, 09:52 AM",
    shap_values:[
      {label:"Date discrepancy",value:-14,direction:"neg"},{label:"Low handwriting conf",value:-11,direction:"neg"},
      {label:"IFSC valid",value:7,direction:"pos"},{label:"Known beneficiary",value:10,direction:"pos"},
    ]},
  { id:"CHQ-2038", type:"Cheque",  bank:"Axis Bank",  amount:"₹3,40,000", risk_score:84,
    flags:["Signature mismatch","Altered amount field suspected"],
    sig:31, ocr_conf:77, ner_conf:93, status:"rejected", ip:"106.51.90.x", created_at:"07 Apr, 08:10 AM",
    shap_values:[
      {label:"Signature mismatch",value:-28,direction:"neg"},{label:"Altered amount suspected",value:-20,direction:"neg"},
      {label:"Off-hours submission",value:-12,direction:"neg"},{label:"Date valid",value:8,direction:"pos"},
    ]},
  { id:"LNA-0214", type:"Loan",    bank:"Kotak Bank", amount:"₹5,00,000", risk_score:22,
    flags:[],
    sig:95, ocr_conf:98, ner_conf:99, status:"approved", ip:"59.180.22.x", created_at:"07 Apr, 11:20 AM",
    shap_values:[
      {label:"All fields present",value:12,direction:"pos"},{label:"Known beneficiary",value:10,direction:"pos"},
      {label:"Amount within range",value:8,direction:"pos"},{label:"IFSC valid",value:7,direction:"pos"},
    ]},
];

const FILTER_TABS = ["all", "pending", "review", "rejected", "approved"];

/* ════════════════════════════════════════════════ */
export default function FraudAnalysis() {
  const [queue, setQueue]       = useState(MOCK_QUEUE);
  const [selected, setSelected] = useState(MOCK_QUEUE[0]);
  const [filter, setFilter]     = useState("all");
  const [apiOnline, setApiOnline] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [toast, setToast]       = useState(null);

  const fetchQueue = useCallback(async () => {
    const data = await API.fraud.queue();
    if (data?.queue?.length) {
      const q = data.queue.map(item => ({
        ...item,
        flags:       Array.isArray(item.flags)       ? item.flags       : [],
        shap_values: Array.isArray(item.shap_values) ? item.shap_values : [],
        sig:         item.sig ?? item.ocr_conf ?? 70,
      }));
      setQueue(q);
      setSelected(prev => q.find(i => i.id === prev?.id) || q[0]);
      setApiOnline(true);
    }
  }, []);

  useEffect(() => {
    fetchQueue();
    const id = setInterval(fetchQueue, 20000);
    return () => clearInterval(id);
  }, [fetchQueue]);

  /* Decision handler — calls real API */
  const handleDecision = async (decision) => {
    if (!selected) return;
    setDeciding(true);
    const res = await API.fraud.decide(selected.id, decision);
    if (res) {
      setToast({ msg: `✓ ${selected.id} marked as ${decision}`, ok: true });
      setQueue(prev => prev.map(q => q.id === selected.id ? { ...q, status: decision.toLowerCase() } : q));
      setSelected(prev => ({ ...prev, status: decision.toLowerCase() }));
      setApiOnline(true);
    } else {
      // offline mock — update locally
      setQueue(prev => prev.map(q => q.id === selected.id ? { ...q, status: decision.toLowerCase() } : q));
      setSelected(prev => ({ ...prev, status: decision.toLowerCase() }));
      setToast({ msg: `Decision recorded locally (backend offline)`, ok: false });
    }
    setDeciding(false);
    setTimeout(() => setToast(null), 3500);
  };

  const filtered = filter === "all" ? queue : queue.filter(d => d.status === filter);
  const sel = selected || queue[0];
  if (!sel) return null;

  const rc = sel.risk_score >= 80 ? "var(--accent-red)" : sel.risk_score >= 50 ? "var(--accent-amber)" : "var(--accent-green)";
  const shap = sel.shap_values?.length ? sel.shap_values : (MOCK_QUEUE.find(m => m.id === sel.id)?.shap_values || []);
  const canDecide = sel.status === "pending" || sel.status === "review" || sel.status === "flagged";

  return (
    <div className="fraud-page">
      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 80, right: 32, zIndex: 300,
          background: toast.ok ? "var(--accent-green-dim)" : "var(--accent-amber-dim)",
          border: `1px solid ${toast.ok ? "rgba(16,185,129,0.3)" : "rgba(245,158,11,0.3)"}`,
          color: toast.ok ? "var(--accent-green)" : "var(--accent-amber)",
          padding: "10px 18px", borderRadius: "var(--radius-md)",
          fontSize: 13, fontFamily: "var(--font-display)", fontWeight: 500,
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          animation: "fadeUp 0.2s ease both",
        }}>
          {toast.msg}
        </div>
      )}

      {/* ── Queue Panel ── */}
      <div className="fraud-queue-panel">
        <div className="fraud-queue-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="card-title">Fraud Queue</span>
            <div className={`api-dot ${apiOnline ? "online" : "offline"}`}
              style={{ width: 6, height: 6, borderRadius: "50%", background: apiOnline ? "var(--accent-green)" : "var(--accent-amber)" }} />
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {FILTER_TABS.map(f => (
              <button key={f} className={`btn btn-ghost btn-sm ${filter === f ? "filter-active" : ""}`}
                onClick={() => setFilter(f)}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="fraud-list">
          {filtered.map(doc => (
            <div key={doc.id}
              className={`fraud-list-item ${sel?.id === doc.id ? "selected" : ""}`}
              onClick={() => setSelected(doc)}>
              <div className="fli-top">
                <span className="mono fli-id">{doc.id}</span>
                <span className={`badge ${doc.risk_score >= 80 ? "badge-red" : doc.risk_score >= 50 ? "badge-amber" : "badge-green"}`}>
                  {doc.risk_score}
                </span>
              </div>
              <div className="fli-bank">{doc.bank} · {doc.type}</div>
              <div className="fli-amount mono">{doc.amount}</div>
              {(doc.flags || []).length > 0 && (
                <div className="fli-flags">
                  {(doc.flags || []).slice(0, 2).map(f => (
                    <span key={f} className="fli-flag">{f}</span>
                  ))}
                  {(doc.flags || []).length > 2 && (
                    <span className="fli-flag">+{doc.flags.length - 2} more</span>
                  )}
                </div>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-tertiary)", fontSize: 12 }}>
              No documents match this filter
            </div>
          )}
        </div>
      </div>

      {/* ── Detail Panel ── */}
      <div className="fraud-detail-panel animate-in">

        {/* Header card */}
        <div className="card fraud-detail-header-card">
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <span style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800, color: "var(--text-primary)" }}>
                  {sel.id}
                </span>
                <span className="badge badge-cyan">{sel.type}</span>
                <StatusBadge s={sel.status} />
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{sel.bank}</div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 500, color: "var(--text-primary)", marginTop: 6 }}>
                {sel.amount}
              </div>
            </div>
            <RiskGauge score={sel.risk_score} />
          </div>

          <div className="divider" />

          {/* ML Confidence bars */}
          <div className="fraud-conf-grid">
            <div className="fraud-conf-item">
              <span className="conf-label">OCR Confidence</span>
              <MiniBar v={sel.ocr_conf || 90} color="var(--accent-cyan)" />
            </div>
            <div className="fraud-conf-item">
              <span className="conf-label">Sig. Auth.</span>
              <MiniBar v={sel.sig || 70}
                color={(sel.sig || 70) < 60 ? "var(--accent-red)" : "var(--accent-green)"} />
            </div>
            <div className="fraud-conf-item">
              <span className="conf-label">NER Accuracy</span>
              <MiniBar v={sel.ner_conf || 94} color="var(--accent-purple)" />
            </div>
          </div>
        </div>

        {/* Flags + Metadata */}
        <div className="fraud-mid-row">
          <div className="card">
            <div className="card-header"><span className="card-title">Risk Flags</span></div>
            {(sel.flags || []).length === 0 ? (
              <div style={{ color: "var(--accent-green)", fontSize: 12 }}>✓ No anomalies detected</div>
            ) : (
              <div className="flags-list">
                {(sel.flags || []).map(f => (
                  <div key={f} className="flag-row">
                    <span className="flag-icon">⚠</span>
                    <span className="flag-text">{f}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-header"><span className="card-title">Submission Context</span></div>
            <div className="meta-list">
              {[
                ["Submitted",   sel.created_at || "—"],
                ["IP Address",  sel.ip || "—"],
                ["Model Used",  "XGBoost v1.4"],
                ["Doc ID",      sel.id],
              ].map(([k, v]) => (
                <div key={k} className="meta-row">
                  <span className="meta-key">{k}</span>
                  <span className="meta-val mono">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* SHAP */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">SHAP Explanation — Feature Contributions</span>
            <span className="badge badge-purple">RBI Compliant</span>
          </div>
          <p style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 16 }}>
            Positive values lower risk; negative values raise it.
          </p>
          <div className="shap-chart">
            {shap.map(f => (
              <div key={f.label || f.feature} className="shap-chart-row">
                <span className="shap-chart-label">{f.label}</span>
                <div className="shap-chart-bar-wrap">
                  <div className="shap-center-line" />
                  <div className={`shap-chart-bar ${f.direction}`}
                    style={{ width: `${Math.min(Math.abs(f.value), 40)}%` }} />
                </div>
                <span className={`shap-chart-val ${f.direction}`}>
                  {f.direction === "pos" ? "+" : ""}{f.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Decision Actions */}
        {canDecide ? (
          <div className="fraud-actions">
            <button className="btn btn-primary" onClick={() => handleDecision("APPROVED")} disabled={deciding}>
              ✓ Approve Document
            </button>
            <button className="btn btn-ghost" onClick={() => handleDecision("REVIEW")} disabled={deciding}>
              ⟳ Send for Review
            </button>
            <button className="btn btn-danger" onClick={() => handleDecision("REJECTED")} disabled={deciding}>
              ✕ Reject — Flag as Fraud
            </button>
            {deciding && <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>Processing…</span>}
          </div>
        ) : (
          <div className="fraud-actions">
            <span className={`badge ${sel.status === "approved" ? "badge-green" : "badge-red"}`}
              style={{ fontSize: 12, padding: "8px 16px" }}>
              Decision Recorded — {sel.status?.toUpperCase()}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}