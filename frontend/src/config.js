export const API_BASE = "https://wlg-traffic-api.onrender.com";

// Change these two lines to switch tile provider (e.g. MapTiler) before deploying.
const MAPTILER_KEY = "2px0pMsxQ1vfnRJbdBEj";
export const TILE_URL = `https://api.maptiler.com/maps/streets-v4/256/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`;
export const TILE_ATTRIBUTION =
  '<a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener">&copy; MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">&copy; OpenStreetMap contributors</a>';

export const WELLINGTON = [-41.2865, 174.7762];

// The browser re-checks the API this often (only while the tab is visible).
export const REFRESH_MS = 5 * 60 * 1000;

// Mirrors STALE_AFTER_MINUTES on the API. Past this, the page shows "Data delayed".
export const STALE_AFTER_MIN = 90;

// Shown in the pipeline card. Keep in sync with the cron-job.org schedule.
export const INGEST_EVERY = "30 minutes";

export const REPO_URL = "https://github.com/DarioDang/wlg-traffic-management-dashboard";
