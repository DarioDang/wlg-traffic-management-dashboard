import { API_BASE } from "./config.js";

async function getJSON(path, timeoutMs = 70000) {
  // A cold API can take about a minute to wake, so the timeout is generous.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(API_BASE + path, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export const fetchEvents = () => getJSON("/api/events");
export const fetchStats = () => getJSON("/api/stats");
export const fetchHealth = () => getJSON("/api/health");
