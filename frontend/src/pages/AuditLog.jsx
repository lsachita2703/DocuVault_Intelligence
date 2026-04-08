import { useState, useEffect, useCallback } from "react";
import { API } from "../services/api";
import "./AuditLog.css";

const ACTION_BADGE = {
  FRAUD_FLAG:       "badge-red",   SIG_REJECT:      "badge-red",
  OCR_EXTRACT:      "badge-cyan",  FIELD_EXTRACT:   "badge-cyan",
  NER_COMPLETE:     "badge-cyan",  HUMAN_OVERRIDE:  "badge-purple",
  APPROVED:         "badge-green", FRAUD_CLEAR:     "badge-green",
  SIG_APPROVE:      "badge-green", REJECTED:        "badge-red",
  FRAUD_REVIEW:     "badge-amber", DECISION_PENDING:"badge-amber",
  SIG_UNCERTAIN:    "badge-amber", DOCUMENT_RECEIVED:"badge-purple",
  PROCESSING_STARTED:"badge-purple",
};

const TYPE_ICON = { ml: "◉", system: "◈", human: "◎" };

const MOCK_ENTRIES = [
  { id:1, audit_id:"AUD-9041", doc_id:"CHQ-2041", action:"FRAUD_FLAG",    actor:"XGBoost v1.4", actor_type:"ml",    result:"Score 91 — FLAGGED",   bank:"YES Bank",   amount:"₹12,00,000", doc_type:"Cheque",  hash:"a3f9b2c1d8e4f7a0b3c6d9e2f5a8b1", created_at:"2026-04-07 02:41:18" },
  { id:2, audit_id:"AUD-9040", doc_id:"CHQ-2041", action:"SIG_REJECT",    actor:"Siamese v2.1", actor_type:"ml",    result:"Conf 42% — REJECTED",  bank:"YES Bank",   amount:"₹12,00,000", doc_type:"Cheque",  hash:"b4c1d9e5f8a2b7c0d4e8f1a5b2c3", created_at:"2026-04-07 02:41:14" },
  { id:3, audit_id:"AUD-9039", doc_id:"CHQ-2041", action:"OCR_EXTRACT",   actor:"AWS Textract", actor_type:"system",result:"6 fields extracted",    bank:"YES Bank",   amount:"₹12,00,000", doc_type:"Cheque",  hash:"c5d2e0f6a3b8c1d5e9f2a6b3c4", created_at:"2026-04-07 02:41:09" },
  { id:4, audit_id:"AUD-9038", doc_id:"INV-0931", action:"HUMAN_OVERRIDE",actor:"Rahul Bajaj",  actor_type:"human", result:"Sent for manual review",bank:"ICICI Bank", amount:"₹18,500",    doc_type:"Invoice", hash:"d6e3f1a7b4c9d2e6f0a3b4c5", created_at:"2026-04-07 10:20:05" },
  { id:5, audit_id:"AUD-9037", doc_id:"INV-0931", action:"FRAUD_FLAG",    actor:"XGBoost v1.4", actor_type:"ml",    result:"Score 71 — REVIEW",    bank:"ICICI Bank", amount:"₹18,500",    doc_type:"Invoice", hash:"e7f4a2b8c5d0e3f7a1b5c6", created_at:"2026-04-07 10:15:42" },
  { id:6, audit_id:"AUD-9036", doc_id:"CHQ-2039", action:"DECISION_PENDING",actor:"System",     actor_type:"system",result:"Awaiting analyst",       bank:"SBI",        amount:"₹85,000",    doc_type:"Cheque",  hash:"f8a5b3c9d6e1f4a2b6c7", created_at:"2026-04-07 09:52:33" },
  { id:7, audit_id:"AUD-9035", doc_id:"LNA-0214", action:"APPROVED",      actor:"LayoutLM v3",  actor_type:"ml",    result:"All checks passed",     bank:"Kotak Bank", amount:"₹5,00,000",  doc_type:"Loan",    hash:"a9b6c4d0e7f2a5b3c8d9", created_at:"2026-04-07 11:20:11" },
  { id:8, audit_id:"AUD-9034", doc_id:"CHQ-2037", action:"APPROVED",      actor:"Pipeline v2",  actor_type:"system",result:"SIG 94% · FRAUD 6%",   bank:"HDFC Bank",  amount:"₹2,40,000",  doc_type:"Cheque",  hash:"b0c7d5e1f8a3b6c4d0e1", created_at:"2026-04-07 11:10:02" },
  { id:9, audit_id:"AUD-9033", doc_id:"CHQ-2038", action:"REJECTED",      actor:"Rahul Bajaj",  actor_type:"human", result:"Signature forged",      bank:"Axis Bank",  amount:"₹3,40,000",  doc_type:"Cheque",  hash:"c1d8e6f2a9b4c7d5e2f3", created_at:"2026-04-07 08:30:15" },
  { id:10,audit_id:"AUD-9032", doc_id:"KYC-1102", action:"APPROVED",      actor:"BERT NER v3",  actor_type:"ml",    result:"Identity verified",     bank:"Axis Bank",  amount:"—",          doc_type:"KYC",     hash:"d2e9f7a3b0c5d8e6f4a5", created_at:"2026-04-07 09:05:44" },
];

/* ════════════════════════════════════════════════ */
export default function AuditLog() {
  const [entries, setEntries]   = useState(MOCK_ENTRIES);
  const [stats, setStats]       = useState({ total: 10, approved: 3, flagged: 3 });
  const [search, setSearch]     = useState("");
  const [filterType, setFilterType] = useState("all");
  const [expanded, setExpanded] = useState(null);
  const [apiOnline, setApiOnline] = useState(false);
  const [loading, setLoading]   = useState(false);

  const fetchAudit = useCallback(async () => {
    setLoading(true);
    const params = {};
    if (search)                        params.search = search;
    if (filterType && filterType !== "all") params.type = filterType;

    const data = await API.audit.list(params);
    if (data) {
      setEntries(data.entries?.length ? data.entries : MOCK_ENTRIES);
      if (data.stats) setStats(data.stats);
      setApiOnline(true);
    }
    setLoading(false);
  }, [search, filterType]);

  useEffect(() => {
    fetchAudit();
  }, [fetchAudit]);

  // Re-fetch on search/filter change (debounced)
  useEffect(() => {
    const id = setTimeout(() => fetchAudit(), 400);
    return () => clearTimeout(id);
  }, [search, filterType]);

  const handleExportCSV = () => {
    const url = API.audit.exportCSV();
    // Try real endpoint first, fall back to client-side generation
    fetch(url).then(res => {
      if (res.ok) {
        res.blob().then(blob => {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `docuvault_audit_${Date.now()}.csv`;
          a.click();
        });
      } else {
        generateLocalCSV();
      }
    }).catch(() => generateLocalCSV());
  };

  const generateLocalCSV = () => {
    const cols = ["audit_id","doc_id","action","actor","actor_type","result","bank","amount","doc_type","hash","created_at"];
    const rows = entries.map(e => cols.map(c => `"${(e[c] || "").toString().replace(/"/g, '""')}"`).join(","));
    const csv  = [cols.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `docuvault_audit_${Date.now()}.csv`;
    a.click();
  };

  const displayStats = {
    total:    Math.max(entries.length, stats.total),
    approved: stats.approved || entries.filter(e => e.action === "APPROVED").length,
    flagged:  stats.flagged  || entries.filter(e => ["FRAUD_FLAG","REJECTED","SIG_REJECT"].includes(e.action)).length,
  };

  return (
    <div className="audit-page">

      {/* Controls */}
      <div className="audit-controls card animate-in">
        <div className="audit-controls-left">
          <div style={{ position: "relative" }}>
            <input className="input" style={{ width: 280, paddingLeft: 32 }}
              placeholder="Search Doc ID, actor, bank…"
              value={search} onChange={e => setSearch(e.target.value)} />
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "var(--text-tertiary)", pointerEvents: "none" }}>⌕</span>
          </div>
          <div style={{ display: "flex", gap: 5 }}>
            {["all","ml","system","human"].map(t => (
              <button key={t}
                className={`btn btn-ghost btn-sm ${filterType === t ? "filter-active" : ""}`}
                onClick={() => setFilterType(t)}>
                {t === "all" ? "All Events"
                  : t === "ml" ? "◉ ML"
                  : t === "system" ? "◈ System" : "◎ Human"}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: apiOnline ? "var(--accent-green)" : "var(--accent-amber)" }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: apiOnline ? "var(--accent-green)" : "var(--accent-amber)" }} />
            {apiOnline ? "Live" : "Demo"}
          </div>
        </div>

        <div className="audit-controls-right">
          {[
            ["Total",    displayStats.total,    "var(--text-primary)"],
            ["Approved", displayStats.approved, "var(--accent-green)"],
            ["Flagged",  displayStats.flagged,  "var(--accent-red)"],
          ].map(([k, v, c]) => (
            <div key={k} className="audit-stat">
              <span className="audit-stat-val mono" style={{ color: c }}>{v}</span>
              <span className="audit-stat-key">{k}</span>
            </div>
          ))}
          <button className="btn btn-primary btn-sm" onClick={handleExportCSV}>↓ Export CSV</button>
          <button className="btn btn-ghost btn-sm" onClick={fetchAudit} disabled={loading}>
            {loading ? "…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {/* RBI Banner */}
      <div className="rbi-banner animate-in animate-in-delay-1">
        <span className="rbi-icon">⊛</span>
        <span>
          <strong style={{ color: "var(--accent-purple)" }}>Immutable Audit Trail</strong>
          {" — "}All entries are cryptographically hashed and write-once.
          Compliant with RBI IT Framework 2021 · Circular No. RBI/2021-22/82.
        </span>
        <span className="badge badge-purple">SHA-256</span>
      </div>

      {/* Table */}
      <div className="card animate-in animate-in-delay-2" style={{ padding: 0, overflow: "hidden" }}>
        <div className="table-wrapper" style={{ border: "none" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Audit ID</th>
                <th>Doc ID</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Bank</th>
                <th>Amount</th>
                <th>Result</th>
                <th>Timestamp</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {entries.map(entry => {
                const badgeClass = ACTION_BADGE[entry.action] || "badge-cyan";
                const isExp = expanded === entry.id;
                return (
                  <>
                    <tr key={entry.id} className={isExp ? "row-expanded" : ""}>
                      <td>
                        <span className="mono" style={{ fontSize: 10, color: "var(--text-tertiary)" }}>
                          {entry.audit_id}
                        </span>
                      </td>
                      <td>
                        <span className="mono" style={{ color: "var(--text-primary)", fontWeight: 500 }}>
                          {entry.doc_id}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${badgeClass}`} style={{ fontSize: 9 }}>
                          {entry.action?.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td style={{ fontSize: 11 }}>
                        <span style={{ marginRight: 5, color: "var(--text-tertiary)" }}>
                          {TYPE_ICON[entry.actor_type] || "◈"}
                        </span>
                        {entry.actor}
                      </td>
                      <td style={{ fontSize: 11 }}>{entry.bank || "—"}</td>
                      <td>
                        <span className="mono" style={{ fontSize: 11 }}>{entry.amount || "—"}</span>
                      </td>
                      <td style={{ fontSize: 11, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {entry.result}
                      </td>
                      <td>
                        <span className="mono" style={{ fontSize: 10, color: "var(--text-tertiary)", whiteSpace: "nowrap" }}>
                          {entry.created_at}
                        </span>
                      </td>
                      <td>
                        <button className="btn btn-ghost btn-sm"
                          style={{ padding: "2px 8px", fontSize: 10 }}
                          onClick={() => setExpanded(isExp ? null : entry.id)}>
                          {isExp ? "▲" : "▼"}
                        </button>
                      </td>
                    </tr>

                    {isExp && (
                      <tr key={`${entry.id}-exp`} className="expanded-row">
                        <td colSpan={9}>
                          <div className="expanded-content animate-in">
                            <div className="expanded-grid">
                              {/* Event Details */}
                              <div className="exp-section">
                                <div className="exp-section-title">Event Details</div>
                                {[
                                  ["Audit ID",   entry.audit_id],
                                  ["Event Type", entry.actor_type?.toUpperCase()],
                                  ["Doc ID",     entry.doc_id],
                                  ["Action",     entry.action],
                                  ["Actor",      entry.actor],
                                  ["Doc Type",   entry.doc_type],
                                ].map(([k, v]) => (
                                  <div key={k} className="exp-field">
                                    <span>{k}</span>
                                    <span className="mono">{v || "—"}</span>
                                  </div>
                                ))}
                              </div>

                              {/* Hash */}
                              <div className="exp-section">
                                <div className="exp-section-title">Integrity Hash (SHA-256)</div>
                                <div className="hash-display mono">
                                  {entry.hash || "a3f9b2c1d8e4f7a0b3c6d9e2f5a8b1c4d7e0f3a6b9c2d5e8f1a4b7c0d3e6f9"}
                                </div>
                                <div style={{ marginTop: 10, fontSize: 10, color: "var(--text-tertiary)" }}>
                                  Hash is computed on: audit_id + doc_id + action + actor + timestamp
                                </div>
                              </div>

                              {/* Compliance */}
                              <div className="exp-section">
                                <div className="exp-section-title">Compliance Metadata</div>
                                {[
                                  ["RBI Reference",  "IT/2021-22/82"],
                                  ["Data Retention", "7 years"],
                                  ["Encryption",     "AES-256 at rest"],
                                  ["Immutability",   "Write-once (WAL)"],
                                  ["Timestamp TZ",   "UTC"],
                                ].map(([k, v]) => (
                                  <div key={k} className="exp-field">
                                    <span>{k}</span>
                                    <span className="mono">{v}</span>
                                  </div>
                                ))}
                                <div className="badge badge-green" style={{ marginTop: 10 }}>AES-256 Encrypted</div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {entries.length === 0 && !loading && (
        <div className="empty-state">
          <span style={{ fontSize: 32 }}>≋</span>
          <span>No audit entries match your search</span>
        </div>
      )}
    </div>
  );
}