// Display order matters: it is the validated colour order in styles.css (--c-*),
// so neighbouring types stay distinguishable in stacked bars and legends.
export const TYPE_ORDER = [
  "road_closure",
  "stop_go",
  "lane_closure",
  "speed_restriction",
  "other",
  "cleared_no_detail",
];

export const TYPES = {
  road_closure:      { label: "Road closure",      shape: "circle" },
  stop_go:           { label: "Stop/go",           shape: "diamond" },
  lane_closure:      { label: "Lane closure",      shape: "square" },
  speed_restriction: { label: "Speed restriction", shape: "triangle" },
  other:             { label: "Other works",       shape: "dot" },
  cleared_no_detail: { label: "Cleared",           shape: "ring" },
};

export const typeKey = (t) => (TYPES[t] ? t : "other");
export const typeInfo = (t) => TYPES[typeKey(t)];

export const cssVar = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const typeColor = (t) => cssVar(`--c-${typeKey(t)}`);

export const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// "058" -> "SH 58". Falls back to the number inside locationArea.
export function highwayOf(e) {
  const n = parseInt(e.highway, 10);
  if (!Number.isNaN(n)) return `SH ${n}`;
  const m = /^SH\s*(\d+)/i.exec(e.location_area || "");
  return m ? `SH ${parseInt(m[1], 10)}` : "SH";
}

// "SH 58 Judgeford, between A and B" -> "Judgeford, between A and B"
export function placeOf(e) {
  const s = (e.location_area || "").trim().replace(/^SH\s*(\d+|N\/A)\s*/i, "");
  return s || "Unknown location";
}

const NZ = "Pacific/Auckland";

export function fmtDate(iso) {
  const d = parseWhen(iso);
  if (!d) return "";
  return d.toLocaleString("en-NZ", { dateStyle: "medium", timeStyle: "short", timeZone: NZ });
}

export function fmtDay(ms) {
  return new Date(ms).toLocaleDateString("en-NZ", { day: "numeric", month: "short", timeZone: NZ });
}

// Returns a Date, or null for missing / non-date text such as "Until further notice".
export function parseWhen(value) {
  if (!value || typeof value !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function timeAgo(iso) {
  const d = parseWhen(iso);
  if (!d) return "never";
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 48 ? `${hrs} h ago` : `${Math.round(hrs / 24)} days ago`;
}

export function daysSince(iso) {
  const d = parseWhen(iso);
  if (!d) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return "";
  return `${(n / 1048576).toFixed(1)} MB`;
}

export const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);
