// DocuVault API Service
// Connects the React frontend to the Flask backend

const BASE = "http://localhost:5000/api";

async function req(path, opts = {}) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json", ...opts.headers },
      ...opts,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  } catch (e) {
    // Network error (backend not running) - return null to trigger mock fallback
    console.warn(`[API] ${path} failed:`, e.message);
    return null;
  }
}

export const API = {
  health: () => req("/health"),

  dashboard: {
    stats: () => req("/dashboard/stats"),
    liveFeed: () => req("/dashboard/live-feed"),
  },

  pipeline: {
    status: () => req("/pipeline/status"),
  },

  documents: {
    list: (params = {}) => req(`/documents?${new URLSearchParams(params)}`),
    get: (id) => req(`/documents/${id}`),
    upload: (formData) =>
      req("/documents/upload", {
        method: "POST",
        headers: {},            // let browser set multipart boundary
        body: formData,
      }),
    process: (id, meta = {}) =>
      req(`/documents/${id}/process`, {
        method: "POST",
        body: JSON.stringify(meta),
      }),
  },

  fraud: {
    queue: (status) => req(`/fraud/queue${status ? `?status=${status}` : ""}`),
    detail: (id) => req(`/fraud/${id}`),
    decide: (id, decision, reviewer = "Rahul Bajaj") =>
      req(`/fraud/${id}/decision`, {
        method: "POST",
        body: JSON.stringify({ decision, reviewer }),
      }),
  },

  signature: {
    queue: () => req("/signature/queue"),
    detail: (id) => req(`/signature/${id}`),
    override: (id, decision, reviewer = "Rahul Bajaj") =>
      req(`/signature/${id}/override`, {
        method: "POST",
        body: JSON.stringify({ decision, reviewer }),
      }),
  },

  audit: {
    list: (params = {}) => req(`/audit?${new URLSearchParams(params)}`),
    stats: () => req("/audit/stats"),
    exportCSV: () => `${BASE}/audit/export/csv`,
  },
};