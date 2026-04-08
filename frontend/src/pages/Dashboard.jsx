import { useState, useEffect, useCallback } from "react";
import { API } from "../services/api";
import "./Dashboard.css";

/* ── Sub-components ─────────────────────────────────────── */
function SparkBar({ values, color }) {
  const max = Math.max(...values, 1);
  return (
    <div className="spark-bar">
      {values.map((v, i) => (
        <div key={i} className="spark-col"
          style={{ height: `${(v / max) * 100}%`, background: color }} />
      ))}
    </div>
  );
}

function ScoreRing({ score, size = 80, color }) {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  return (
    <div className="score-ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="rgba(255,255,255,0.06)" strokeWidth="5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth="5"
          strokeDasharray={`${fill} ${circ}`} strokeLinecap="round" />
      </svg>
      <div className="score-ring-label">
        <span style={{ fontSize: size * 0.22, fontFamily: "var(--font-mono)", fontWeight: 500, color }}>
          {score}%
        </span>
      </div>
    </div>
  );
}

function RiskBadge({ s }) {
  const c = s >= 80 ? "badge-red" : s >= 50 ? "badge-amber" : "badge-green";
  return <span className={`badge ${c}`}>{s >= 80 ? "HIGH" : s >= 50 ? "MED" : "LOW"} {s}</span>;
}
function StatusBadge({ s }) {
  const m = { approved: "badge-green", flagged: "badge-amber", review: "badge-cyan", rejected: "badge-red", processing: "badge-purple" };
  return <span className={`badge ${m[s] || "badge-cyan"}`}>{s?.toUpperCase()}</span>;
}

/* ── Static fallback data ─────────────────────────────────── */
const VOL_COLORS = ["var(--accent-cyan)", "var(--accent-purple)", "var(--accent-green)", "var(--accent-amber)"];

const DEFAULT_STATS = {
  docs_today: 4271, fraud_flags: 38, avg_processing_ms: 183, sig_rejections: 127,
  sparks: {
    docs:    [38, 52, 45, 67, 71, 59, 82, 91, 74, 85, 92, 88],
    fraud:   [12, 18, 14, 22, 19, 28, 21, 15, 17, 12,  9,  8],
    latency: [220,210,198,205,195,191,188,185,184,186,183,182],
    sig_rej: [90,102, 95,111,108,115,119,122,118,124,126,127],
  },
  model_health: [
    { name: "LayoutLM v3",    accuracy: 97.4, label: "Field Extraction",  color: "var(--accent-cyan)"   },
    { name: "Siamese Net v2", accuracy: 94.1, label: "Signature Verify",  color: "var(--accent-purple)" },
    { name: "XGBoost Fraud",  accuracy: 91.8, label: "Fraud Scoring",     color: "var(--accent-amber)"  },
    { name: "BERT-FIN NER",   accuracy: 96.2, label: "Entity Extraction", color: "var(--accent-green)"  },
  ],
  volume_by_type: [
    { type: "Cheque",    count: 2140, pct: 50, color: "var(--accent-cyan)"   },
    { type: "Invoice",   count:  940, pct: 22, color: "var(--accent-purple)" },
    { type: "KYC Doc",   count:  810, pct: 19, color: "var(--accent-green)"  },
    { type: "Loan Agmt", count:  381, pct:  9, color: "var(--accent-amber)"  },
  ],
};

const DEFAULT_FEED = [
  { id: "CHQ-2041", type: "Cheque",         bank: "HDFC Bank",   amount: "₹2,40,000", risk_score: 92, status: "approved",  created_at: "2m ago"  },
  { id: "INV-0931", type: "Invoice",         bank: "ICICI Bank",  amount: "₹18,500",   risk_score: 34, status: "flagged",   created_at: "5m ago"  },
  { id: "KYC-1102", type: "KYC Document",    bank: "Axis Bank",   amount: "—",         risk_score: 8,  status: "approved",  created_at: "9m ago"  },
  { id: "CHQ-2039", type: "Cheque",          bank: "SBI",         amount: "₹85,000",   risk_score: 67, status: "review",    created_at: "12m ago" },
  { id: "LNA-0214", type: "Loan Agreement",  bank: "Kotak Bank",  amount: "₹5,00,000", risk_score: 21, status: "approved",  created_at: "16m ago" },
  { id: "CHQ-2038", type: "Cheque",          bank: "YES Bank",    amount: "₹12,000",   risk_score: 88, status: "rejected",  created_at: "23m ago" },
  { id: "INV-0930", type: "Invoice",         bank: "HDFC Bank",   amount: "₹3,15,000", risk_score: 15, status: "approved",  created_at: "31m ago" },
];

const SHAP_DATA = [
  { label: "Signature confidence", val: -28, dir: "neg" },
  { label: "Amount field present", val:  12, dir: "pos" },
  { label: "Date format valid",    val:   8, dir: "pos" },
  { label: "Historical patterns",  val: -19, dir: "neg" },
  { label: "Device fingerprint",   val:   6, dir: "pos" },
  { label: "Submission time",      val: -11, dir: "neg" },
];

/* ════════════════════════════════════════════════ */
export default function Dashboard({ setActivePage }) {
  const [stats, setStats]         = useState(DEFAULT_STATS);
  const [feed, setFeed]           = useState(DEFAULT_FEED);
  const [apiOnline, setApiOnline] = useState(false);
  const [loading, setLoading]     = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [statsData, feedData, health] = await Promise.all([
      API.dashboard.stats(),
      API.dashboard.liveFeed(),
      API.health(),
    ]);

    setApiOnline(!!health);

    if (statsData) {
      const vol = (statsData.volume_by_type || []).map((v, i) => ({
        ...v, color: VOL_COLORS[i] || "var(--accent-cyan)",
      }));
      const models = (statsData.model_health || []).map((m, i) => ({
        ...m, color: VOL_COLORS[i] || "var(--accent-cyan)",
      }));
      setStats({ ...DEFAULT_STATS, ...statsData, volume_by_type: vol, model_health: models });
    }

    if (feedData?.documents?.length) setFeed(feedData.documents.slice(0, 7));

    setLoading(false);
    setLastRefresh(new Date());
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 15000);
    return () => clearInterval(id);
  }, [fetchAll]);

  /* ── Derived ── */
  const sparks = stats.sparks || DEFAULT_STATS.sparks;

  const STAT_CARDS = [
    { label: "Docs Processed Today",  value: Number(stats.docs_today).toLocaleString(), delta: "+12.4%", dc: "up",  spark: sparks.docs,    sc: "var(--accent-cyan)"   , icon: "◈" },
    { label: "Fraud Flags Raised",    value: String(stats.fraud_flags),                 delta: "-6.2%",  dc: "dg",  spark: sparks.fraud,   sc: "var(--accent-amber)"  , icon: "◉" },
    { label: "Avg. Processing Time",  value: `${stats.avg_processing_ms}ms`,            delta: "-8ms",   dc: "dg",  spark: sparks.latency, sc: "var(--accent-green)"  , icon: "◷" },
    { label: "Signature Rejections",  value: String(stats.sig_rejections),              delta: "+3.1%",  dc: "ub",  spark: sparks.sig_rej, sc: "var(--accent-red)"    , icon: "◎" },
  ];

  const deltaColor = { up: "var(--accent-cyan)", dg: "var(--accent-green)", ub: "var(--accent-red)" };

  return (
    <div className="dashboard">

      {/* ── API status strip ── */}
      <div className="api-strip animate-in">
        <div className="api-strip-left">
          <div className={`api-dot ${apiOnline ? "online" : "offline"}`} />
          <span className={`api-status-text ${apiOnline ? "online" : "offline"}`}>
            {apiOnline ? "Backend connected — live data" : "Backend offline — showing demo data. Run: python3 app.py"}
          </span>
        </div>
        <span className="api-refresh-time">Last sync: {lastRefresh.toLocaleTimeString()}</span>
        <button className="btn btn-ghost btn-sm" onClick={fetchAll} disabled={loading}>
          {loading ? "…" : "↻ Sync"}
        </button>
      </div>

      {/* ── KPI Stats Row ── */}
      <div className="g4">
        {STAT_CARDS.map((s, i) => (
          <div key={s.label} className={`card stat-card animate-in animate-in-delay-${i + 1}`}>
            <div className="stat-top">
              <span className="stat-icon">{s.icon}</span>
              <span style={{ fontFamily:"var(--font-mono)", fontSize:10, padding:"2px 7px", borderRadius:99, background:"rgba(255,255,255,0.04)", color: deltaColor[s.dc] }}>
                {s.delta}
              </span>
            </div>
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">{s.label}</div>
            <div className="stat-sub">vs yesterday</div>
            <SparkBar values={s.spark} color={s.sc} />
          </div>
        ))}
      </div>

      {/* ── Middle Row ── */}
      <div className="dash-mid-row animate-in animate-in-delay-2">

        {/* Live Feed */}
        <div className="card recent-docs-card">
          <div className="card-header">
            <span className="card-title">
              Live Document Feed
              {loading && <span style={{ marginLeft: 8, fontSize: 10, color: "var(--text-tertiary)" }}>updating…</span>}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setActivePage("audit")}>View All</button>
              <button className="btn btn-primary btn-sm" onClick={() => setActivePage("upload")}>+ Intake</button>
            </div>
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Doc ID</th><th>Type</th><th>Bank</th><th>Amount</th>
                  <th>Risk Score</th><th>Status</th><th>Time</th>
                </tr>
              </thead>
              <tbody>
                {feed.map(doc => (
                  <tr key={doc.id} style={{ cursor: "pointer" }}
                    onClick={() => setActivePage(doc.risk_score >= 50 ? "fraud" : "audit")}>
                    <td>
                      <span className="mono" style={{ color: "var(--text-primary)", fontWeight: 500, fontSize: 11 }}>
                        {doc.id}
                      </span>
                    </td>
                    <td>
                      <span className="doc-type-tag">{doc.type}</span>
                    </td>
                    <td style={{ color: "var(--text-primary)" }}>{doc.bank}</td>
                    <td className="mono">{doc.amount || "—"}</td>
                    <td>{doc.risk_score != null ? <RiskBadge s={doc.risk_score} /> : "—"}</td>
                    <td><StatusBadge s={doc.status} /></td>
                    <td style={{ color: "var(--text-tertiary)", fontSize: 11 }}>{doc.created_at || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* SHAP Panel */}
        <div className="card shap-card">
          <div className="card-header">
            <span className="card-title">SHAP Decision</span>
            <span className="badge badge-red">CHQ-2038 Rejected</span>
          </div>
          <p style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 16, lineHeight: 1.8 }}>
            Feature contributions for last flagged cheque:
          </p>
          {SHAP_DATA.map(f => (
            <div key={f.label} className="shap-row">
              <span className="shap-label">{f.label}</span>
              <div className="shap-bar-wrap">
                <div className={`shap-bar ${f.dir}`} style={{ width: `${Math.abs(f.val) * 2.2}%` }} />
              </div>
              <span className={`shap-val ${f.dir}`}>{f.dir === "pos" ? "+" : ""}{f.val}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Bottom Row ── */}
      <div className="dash-bottom-row animate-in animate-in-delay-3">

        {/* Model Health */}
        <div className="card model-health-card">
          <div className="card-header">
            <span className="card-title">ML Model Accuracy</span>
            <span className="badge badge-green">All Nominal</span>
          </div>
          <div className="model-health-grid">
            {stats.model_health.map(m => (
              <div key={m.name} className="model-health-item">
                <ScoreRing score={Math.round(m.accuracy)} size={80} color={m.color} />
                <div className="model-info">
                  <span className="model-name">{m.name}</span>
                  <span className="model-sub">{m.label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Volume */}
        <div className="card volume-card">
          <div className="card-header"><span className="card-title">Today's Volume by Type</span></div>
          <div className="volume-list">
            {stats.volume_by_type.map(v => (
              <div key={v.type} className="volume-row">
                <div className="volume-meta">
                  <span className="volume-type">{v.type}</span>
                  <span className="mono volume-count">{Number(v.count).toLocaleString()}</span>
                </div>
                <div className="progress-bar" style={{ flex: 1 }}>
                  <div className="progress-fill" style={{ width: `${v.pct}%`, background: v.color }} />
                </div>
                <span className="volume-pct" style={{ color: v.color }}>{v.pct}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="card quick-actions-card">
          <div className="card-header"><span className="card-title">Quick Actions</span></div>
          <div className="quick-actions-list">
            {[
              { label: "Upload New Batch",    icon: "⊕", page: "upload",    badge: null,        bc: "var(--accent-cyan)"   },
              { label: "Review Fraud Queue",  icon: "◉", page: "fraud",     badge: `${stats.fraud_flags} pending`, bc: "var(--accent-amber)"  },
              { label: "Verify Signatures",   icon: "◎", page: "signature", badge: `${stats.sig_rejections} queued`, bc: "var(--accent-purple)" },
              { label: "Export Audit Report", icon: "≡", page: "audit",     badge: null,        bc: "var(--accent-green)"  },
            ].map(a => (
              <button key={a.label} className="quick-action-btn" onClick={() => setActivePage(a.page)}>
                <span className="qa-icon">{a.icon}</span>
                <span className="qa-label">{a.label}</span>
                {a.badge && <span className="badge badge-amber qa-badge">{a.badge}</span>}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}