import { useState } from "react";
import Dashboard from "./pages/Dashboard";
import DocumentUpload from "./pages/DocumentUpload";
import FraudAnalysis from "./pages/FraudAnalysis";
import SignatureVerification from "./pages/SignatureVerification";
import AuditLog from "./pages/AuditLog";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import "./index.css";

export default function App() {
  const [activePage, setActivePage] = useState("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const pages = {
    dashboard: <Dashboard setActivePage={setActivePage} />,
    upload: <DocumentUpload />,
    fraud: <FraudAnalysis />,
    signature: <SignatureVerification />,
    audit: <AuditLog />,
  };

  return (
    <div className="app-shell">
      <Sidebar
        activePage={activePage}
        setActivePage={setActivePage}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
      />
      <div className={`main-area ${sidebarCollapsed ? "collapsed" : ""}`}>
        <TopBar activePage={activePage} />
        <main className="page-content">{pages[activePage]}</main>
      </div>
    </div>
  );
}