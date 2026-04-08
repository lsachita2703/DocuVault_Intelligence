import "./TopBar.css";

const PAGE_META = {
  dashboard:  { title: "Command Center",     sub: "Real-time document intelligence overview" },
  upload:     { title: "Document Intake",    sub: "Upload and queue new documents for processing" },
  fraud:      { title: "Fraud Analysis",     sub: "ML-powered risk scoring and anomaly detection" },
  signature:  { title: "Signature Verify",   sub: "Siamese network-based signature authentication" },
  audit:      { title: "Audit Log",          sub: "Immutable decision trail for RBI compliance" },
};

const now = new Date();
const timeStr = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
const dateStr = now.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default function TopBar({ activePage }) {
  const meta = PAGE_META[activePage] || PAGE_META.dashboard;

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="page-title-wrap">
          <h1 className="page-title">{meta.title}</h1>
          <span className="page-sub">{meta.sub}</span>
        </div>
      </div>

      <div className="topbar-right">
        {/* Live status */}
        <div className="live-chip">
          <span className="live-dot" />
          <span className="live-label">LIVE</span>
        </div>

        {/* System health */}
        <div className="health-chips">
          <div className="health-chip healthy">
            <span className="health-dot" />
            <span>API</span>
          </div>
          <div className="health-chip healthy">
            <span className="health-dot" />
            <span>ML Engine</span>
          </div>
          <div className="health-chip healthy">
            <span className="health-dot" />
            <span>AWS Textract</span>
          </div>
        </div>

        {/* Clock */}
        <div className="topbar-clock">
          <span className="clock-time mono">{timeStr}</span>
          <span className="clock-date">{dateStr}</span>
        </div>

        {/* Notification bell */}
        <button className="notif-btn" title="Alerts">
          <span className="notif-icon">◫</span>
          <span className="notif-badge">3</span>
        </button>
      </div>
    </header>
  );
}