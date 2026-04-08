import "./Sidebar.css";

const NAV = [
  {
    group: "OVERVIEW",
    items: [
      { id: "dashboard",  icon: "◈", label: "Command Center" },
    ],
  },
  {
    group: "PROCESSING",
    items: [
      { id: "upload",    icon: "⊕", label: "Document Intake" },
      { id: "fraud",     icon: "◉", label: "Fraud Analysis" },
      { id: "signature", icon: "◎", label: "Signature Verify" },
    ],
  },
  {
    group: "COMPLIANCE",
    items: [
      { id: "audit",  icon: "≡", label: "Audit Log" },
    ],
  },
];

export default function Sidebar({ activePage, setActivePage, collapsed, setCollapsed }) {
  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="logo-mark">
          <span className="logo-icon">⬡</span>
        </div>
        {!collapsed && (
          <div className="logo-text">
            <span className="logo-name">DocuVault</span>
            <span className="logo-sub">INTELLIGENCE</span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="sidebar-nav">
        {NAV.map((group) => (
          <div key={group.group} className="nav-group">
            {!collapsed && <span className="nav-group-label">{group.group}</span>}
            {group.items.map((item) => (
              <button
                key={item.id}
                className={`nav-item ${activePage === item.id ? "active" : ""}`}
                onClick={() => setActivePage(item.id)}
                title={collapsed ? item.label : undefined}
              >
                <span className="nav-icon">{item.icon}</span>
                {!collapsed && <span className="nav-label">{item.label}</span>}
                {activePage === item.id && <span className="nav-active-bar" />}
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* Bottom */}
      <div className="sidebar-footer">
        {!collapsed && (
          <div className="sidebar-user">
            <div className="user-avatar">RB</div>
            <div className="user-info">
              <span className="user-name">Rahul Bajaj</span>
              <span className="user-role">Risk Analyst</span>
            </div>
          </div>
        )}
        <button
          className="collapse-btn"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "▶" : "◀"}
        </button>
      </div>
    </aside>
  );
}