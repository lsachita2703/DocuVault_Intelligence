import { useState, useEffect, useCallback } from "react";
import { API } from "../services/api";
import "./SignatureVerification.css";

/* ── SVG Signature renderer ── */
function SigCanvas({ color, variant, label }) {
  const paths = {
    ref:   "M 20 65 C 40 25, 65 15, 85 45 C 105 68, 125 38, 145 52 C 165 62, 178 46, 200 58",
    match: "M 22 64 C 41 26, 66 16, 86 45 C 106 68, 126 38, 146 52 C 165 62, 179 47, 200 58",
    forge: "M 20 65 C 38 38, 72 12, 95 46 C 115 72, 138 32, 155 54 C 178 60, 192 42, 212 56",
  };
  return (
    <div className="sig-canvas-wrap">
      <div className="sig-canvas-label">{label}</div>
      <div className="sig-canvas">
        <div className="sig-canvas-grid" />
        <svg viewBox="0 0 230 90" width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
          <path d={paths[variant] || paths.ref} fill="none" stroke={color}
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
          <path d={paths[variant] || paths.ref} fill="none" stroke={color}
            strokeWidth="1" strokeLinecap="round" opacity="0.25"
            transform="translate(2,2)" />
        </svg>
      </div>
    </div>
  );
}

/* ── Confidence gauge ── */
function ConfGauge({ value }) {
  const color = value >= 80 ? "var(--accent-green)" : value >= 60 ? "var(--accent-amber)" : "var(--accent-red)";
  const label = value >= 80 ? "GENUINE" : value >= 60 ? "UNCERTAIN" : "FORGED";
  return (
    <div className="conf-gauge">
      <div className="conf-gauge-track">
        <div className="conf-gauge-needle" style={{ left: `${value}%`, borderTopColor: color }} />
      </div>
      <div className="conf-gauge-labels">
        <span style={{ color: "var(--accent-red)" }}>FORGED</span>
        <span style={{ color: "var(--accent-amber)" }}>UNCERTAIN</span>
        <span style={{ color: "var(--accent-green)" }}>GENUINE</span>
      </div>
      <div className="conf-gauge-result" style={{ color }}>
        <span className="mono" style={{ fontSize: 40, fontWeight: 700, lineHeight: 1 }}>{value}%</span>
        <span style={{ fontSize: 13, letterSpacing: "0.12em", fontFamily: "var(--font-display)", fontWeight: 700 }}>{label}</span>
      </div>
    </div>
  );
}

/* ── Mock fallback ── */
const MOCK_QUEUE = [
  { doc_id:"CHQ-2041", sig_id:"SIG-4401", type:"Cheque", bank:"YES Bank",   payee_name:"Vikram Enterprises",  confidence:42, verdict:"FORGED",    status:"rejected",
    feature_distances:{ stroke_curvature:0.71, pressure_map:0.53, aspect_ratio:0.21, slant_angle:0.63, loop_formation:0.45, endpoint_similarity:0.38 }},
  { doc_id:"CHQ-2039", sig_id:"SIG-4400", type:"Cheque", bank:"SBI",        payee_name:"Priya Sharma",        confidence:73, verdict:"UNCERTAIN",  status:"review",
    feature_distances:{ stroke_curvature:0.21, pressure_map:0.18, aspect_ratio:0.09, slant_angle:0.25, loop_formation:0.19, endpoint_similarity:0.13 }},
  { doc_id:"CHQ-2038", sig_id:"SIG-4399", type:"Cheque", bank:"Axis Bank",  payee_name:"Global Tech Pvt Ltd", confidence:31, verdict:"FORGED",    status:"rejected",
    feature_distances:{ stroke_curvature:0.74, pressure_map:0.61, aspect_ratio:0.29, slant_angle:0.68, loop_formation:0.52, endpoint_similarity:0.44 }},
  { doc_id:"CHQ-2037", sig_id:"SIG-4398", type:"Cheque", bank:"HDFC Bank",  payee_name:"Rohan Mehta",         confidence:94, verdict:"GENUINE",   status:"approved",
    feature_distances:{ stroke_curvature:0.06, pressure_map:0.10, aspect_ratio:0.03, slant_angle:0.08, loop_formation:0.06, endpoint_similarity:0.09 }},
  { doc_id:"LNA-0214", sig_id:"SIG-4397", type:"Loan",   bank:"Kotak Bank", payee_name:"Alpha Corp",          confidence:88, verdict:"GENUINE",   status:"approved",
    feature_distances:{ stroke_curvature:0.08, pressure_map:0.11, aspect_ratio:0.04, slant_angle:0.09, loop_formation:0.07, endpoint_similarity:0.10 }},
];

const FEAT_LABELS = {
  stroke_curvature:    "Stroke curvature",
  pressure_map:        "Pressure map",
  aspect_ratio:        "Aspect ratio",
  slant_angle:         "Slant angle",
  loop_formation:      "Loop formation",
  endpoint_similarity: "Endpoint similarity",
};

/* ════════════════════════════════════════════════ */
export default function SignatureVerification() {
  const [queue, setQueue]       = useState(MOCK_QUEUE);
  const [selected, setSelected] = useState(MOCK_QUEUE[0]);
  const [apiOnline, setApiOnline] = useState(false);
  const [overriding, setOverriding] = useState(false);
  const [toast, setToast]       = useState(null);

  const fetchQueue = useCallback(async () => {
    const data = await API.signature.queue();
    if (data?.queue?.length) {
      const q = data.queue.map(item => ({
        ...item,
        feature_distances: typeof item.feature_distances === "string"
          ? JSON.parse(item.feature_distances)
          : (item.feature_distances || {}),
        payee_name: item.payee_name || item.extracted_fields?.payee_name || "—",
      }));
      setQueue(q);
      setSelected(prev => q.find(i => i.doc_id === prev?.doc_id) || q[0]);
      setApiOnline(true);
    }
  }, []);

  useEffect(() => {
    fetchQueue();
    const id = setInterval(fetchQueue, 20000);
    return () => clearInterval(id);
  }, [fetchQueue]);

  const handleOverride = async (decision) => {
    if (!selected) return;
    setOverriding(true);
    const res = await API.signature.override(selected.doc_id, decision);
    if (res) {
      setToast({ msg: `✓ Signature override: ${decision}`, ok: true });
      setQueue(prev => prev.map(q => q.doc_id === selected.doc_id
        ? { ...q, status: decision === "GENUINE" ? "approved" : decision === "FORGED" ? "rejected" : "review" }
        : q));
      setSelected(prev => ({ ...prev,
        status: decision === "GENUINE" ? "approved" : decision === "FORGED" ? "rejected" : "review"
      }));
      setApiOnline(true);
    } else {
      // offline — update locally
      setQueue(prev => prev.map(q => q.doc_id === selected.doc_id
        ? { ...q, verdict: decision, override: true }
        : q));
      setSelected(prev => ({ ...prev, verdict: decision, override: true }));
      setToast({ msg: "Override recorded locally (backend offline)", ok: false });
    }
    setOverriding(false);
    setTimeout(() => setToast(null), 3500);
  };

  const sel = selected || queue[0];
  if (!sel) return null;

  const forged    = sel.verdict === "FORGED" || sel.confidence < 60;
  const uncertain = sel.verdict === "UNCERTAIN" || (sel.confidence >= 60 && sel.confidence < 80);
  const genuine   = sel.verdict === "GENUINE" || sel.confidence >= 80;
  const sigVariant = genuine ? "match" : "forge";
  const confColor  = genuine ? "var(--accent-green)" : uncertain ? "var(--accent-amber)" : "var(--accent-red)";
  const distances  = sel.feature_distances || {};

  return (
    <div className="sig-page">
      {/* Toast */}
      {toast && (
        <div style={{
          position:"fixed", top:80, right:32, zIndex:300,
          background: toast.ok ? "var(--accent-green-dim)" : "var(--accent-amber-dim)",
          border: `1px solid ${toast.ok ? "rgba(16,185,129,0.3)" : "rgba(245,158,11,0.3)"}`,
          color: toast.ok ? "var(--accent-green)" : "var(--accent-amber)",
          padding:"10px 18px", borderRadius:"var(--radius-md)",
          fontSize:13, fontFamily:"var(--font-display)", fontWeight:500,
          animation:"fadeUp 0.2s ease both",
        }}>
          {toast.msg}
        </div>
      )}

      {/* ── Queue ── */}
      <div className="sig-queue-panel">
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", gap: 8 }}>
          <span className="card-title">Verification Queue</span>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: apiOnline ? "var(--accent-green)" : "var(--accent-amber)" }} />
        </div>
        <div className="sig-list">
          {queue.map(item => (
            <div key={item.doc_id}
              className={`sig-list-item ${sel?.doc_id === item.doc_id ? "selected" : ""}`}
              onClick={() => setSelected(item)}>
              <div className="sli-top">
                <span className="mono sli-id">{item.doc_id}</span>
                <span className={`badge ${item.confidence >= 80 ? "badge-green" : item.confidence >= 60 ? "badge-amber" : "badge-red"}`}>
                  {item.confidence}%
                </span>
              </div>
              <div className="sli-sub">{item.payee_name || "—"}</div>
              <div className="sli-bank">{item.bank} · {item.type}</div>
              <div style={{ marginTop: 5 }}>
                <span className={`badge ${item.verdict === "GENUINE" ? "badge-green" : item.verdict === "UNCERTAIN" ? "badge-amber" : "badge-red"}`}
                  style={{ fontSize: 9 }}>
                  {item.verdict || item.status?.toUpperCase()}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Detail ── */}
      <div className="sig-detail">

        {/* Comparison card */}
        <div className="card animate-in">
          <div className="card-header">
            <span className="card-title">Siamese Network — Signature Comparison</span>
            <div style={{ display: "flex", gap: 8 }}>
              <span className="badge badge-purple">Model v2.1</span>
              <span className={`badge ${forged ? "badge-red" : uncertain ? "badge-amber" : "badge-green"}`}>
                {forged ? "FORGERY DETECTED" : uncertain ? "UNCERTAIN — REVIEW" : "SIGNATURE MATCH"}
              </span>
            </div>
          </div>

          <div className="sig-compare-grid">
            <SigCanvas label="Reference Signature (on file)" color="var(--accent-cyan)" variant="ref" />
            <div className="sig-vs">
              <div className="vs-circle">VS</div>
              <div style={{ fontSize: 18, color: "var(--text-tertiary)" }}>→</div>
            </div>
            <SigCanvas label="Submitted Signature (test)" color={confColor} variant={sigVariant} />
          </div>

          <div className="divider" />
          <ConfGauge value={sel.confidence} />
        </div>

        {/* Analysis Row */}
        <div className="sig-analysis-row animate-in animate-in-delay-1">
          {/* Feature Distances */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Feature Distances</span>
              <span className="badge badge-cyan">Threshold: 0.35</span>
            </div>
            <div className="feature-list">
              {Object.entries(distances).map(([key, dist]) => {
                const pct = Math.min(dist * 100, 100);
                const color = dist > 0.40 ? "var(--accent-red)" : dist > 0.20 ? "var(--accent-amber)" : "var(--accent-green)";
                return (
                  <div key={key} className="feature-row">
                    <span className="feature-name">{FEAT_LABELS[key] || key.replace(/_/g, " ")}</span>
                    <div className="progress-bar" style={{ flex: 1 }}>
                      <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
                    </div>
                    <span className="mono feature-dist" style={{ color }}>{dist.toFixed(3)}</span>
                  </div>
                );
              })}
            </div>
            <div className="divider" />
            <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
              Lower distance = more similar · &gt;0.35 = suspicious
            </div>
          </div>

          {/* Context + Actions */}
          <div className="card">
            <div className="card-header"><span className="card-title">Document Context</span></div>
            <div className="meta-list">
              {[
                ["Sig. ID",       sel.sig_id || "—"],
                ["Linked Doc",    sel.doc_id],
                ["Account Holder",sel.payee_name || "—"],
                ["Issuing Bank",  sel.bank],
                ["Reference Sigs","YES — 3 samples"],
                ["Model",         "Siamese-v2.1"],
                ["Threshold",     "≥ 80% Approve"],
                ["Current Conf.", `${sel.confidence}% — ${sel.verdict}`],
              ].map(([k, v]) => (
                <div key={k} className="meta-row">
                  <span className="meta-key">{k}</span>
                  <span className="meta-val mono">{v}</span>
                </div>
              ))}
            </div>

            <div className="divider" />

            {/* Override actions */}
            <div style={{ marginBottom: 6, fontSize: 11, color: "var(--text-tertiary)" }}>
              Human Override — analyst decision supersedes model:
            </div>
            <div className="sig-actions">
              <button className="btn btn-primary btn-sm"
                onClick={() => handleOverride("GENUINE")} disabled={overriding}>
                ✓ Confirm Genuine
              </button>
              <button className="btn btn-danger btn-sm"
                onClick={() => handleOverride("FORGED")} disabled={overriding}>
                ✕ Flag Forgery
              </button>
              <button className="btn btn-ghost btn-sm"
                onClick={() => handleOverride("UNCERTAIN")} disabled={overriding}>
                ⟳ Needs Review
              </button>
            </div>
            {overriding && (
              <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-tertiary)" }}>Recording decision…</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}