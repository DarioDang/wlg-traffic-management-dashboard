import "leaflet/dist/leaflet.css";
import "@fontsource/barlow/latin-400.css";
import "@fontsource/barlow/latin-500.css";
import "@fontsource/barlow/latin-600.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "./styles.css";

import { fetchEvents, fetchStats, fetchHealth, fetchChanges } from "./api.js";
import { REFRESH_MS, ACTIVITY_HOURS } from "./config.js";
import { state, visible } from "./state.js";
import { initMap, renderMap, setSelected, setHover, flyToEvent, refitMap, invalidateMap } from "./mapview.js";
import { hideTip } from "./tooltip.js";
import { $ } from "./dom.js";
import * as ui from "./ui.js";
import { renderDropdowns } from "./dropdowns.js";
import { fetchTrends, fetchInsights } from "./api.js";
import { renderTrends, setTrendsData } from "./trends.js";
import "./reveal.js";
import "./mobile.js";

let first = true;
let loading = false;
let lastLoad = 0;

// ---------- interaction handlers shared by the map, list, timeline and charts ----------

function select(id, { closedId = null } = {}) {
  // A popup closing because another one opened must not clear the new selection.
  if (id == null && closedId != null && state.selectedId !== closedId) return;
  if (id != null && id === state.selectedId) return;
  state.selectedId = id;
  ui.setSelectedUI(id, { scroll: true });
  setSelected(id, { open: true });
  if (id != null) flyToEvent(id);
}

function hover(id) {
  state.hoverId = id;
  setHover(id);
  ui.setHoverUI(id);
}

function applyFilters() {
  hideTip();
  renderAll({ fitMap: true });
}

const handlers = {
  onSelect: select,
  onHover: hover,
  onStatus(v) {
    state.status = v;
    applyFilters();
  },
  onType(key) {
    if (state.types.has(key)) state.types.delete(key);
    else state.types.add(key);
    applyFilters();
  },
  onCategory(cat) {
    if (state.categories.has(cat)) state.categories.delete(cat);
    else state.categories.add(cat);
    applyFilters();
  },
  onClear() {
    state.status = "all";
    state.types.clear();
    state.categories.clear();
    applyFilters();
  },
};

// ---------- rendering ----------

function renderAll({ fitMap = false } = {}) {
  hideTip();
  const list = visible();
  if (state.selectedId != null && !list.some((e) => e.id === state.selectedId)) state.selectedId = null;

  ui.renderFilters(handlers);
  renderDropdowns(handlers);
  ui.renderHero(list);
  ui.renderList(list, handlers, { first });
  ui.renderHighways(list, handlers);
  ui.renderTimeline(list, handlers);
  ui.renderRoutes(list, handlers);
  ui.renderActivity(handlers);
  ui.renderPipeline();
  renderMap(list, { selectedId: state.selectedId, fit: fitMap });
  ui.setSelectedUI(state.selectedId);
  ui.updateLive();
}

// ---------- data loading ----------

async function load() {
  if (loading) return;
  loading = true;
  ui.stripeLoading(true);
  ui.setLive("loading", "Refreshing", "");
  const slow = setTimeout(() => ui.showBanner("Waking the data service. This can take up to a minute."), 4000);
  try {
      const [ev, st, he, ch] = await Promise.all([
        fetchEvents(), fetchStats(), fetchHealth().catch(() => null), fetchChanges(ACTIVITY_HOURS).catch(() => null),
      ]);
    state.events = ev.events;
    state.stats = st;
    state.health = he;
    state.changes = ch;
    ui.showBanner("");
    renderAll({ fitMap: first });
    first = false;
    lastLoad = Date.now();
  } catch (err) {
    console.error(err);
    ui.showBanner(
      first ? "Couldn't reach the data service." : "Couldn't refresh. Showing the last data we have.",
      { retry: load }
    );
    ui.setLive("offline", "Offline", "Retry in a moment");
  } finally {
    clearTimeout(slow);
    loading = false;
    ui.stripeRun(REFRESH_MS);
  }
}

// ---------- trends (dbt analytics marts) ----------
async function loadTrends() {
  const [tr, ins] = await Promise.all([
    fetchTrends(30).catch(() => null),
    fetchInsights().catch(() => null),
  ]);
  setTrendsData(tr, ins);
  renderTrends({ onSelect: select });
}

// ---------- boot ----------

initMap("map", {
  onSelect: (id, opts) => select(id, opts),
  onHover: hover,
});
ui.initTheme(() => renderMap(visible(), { selectedId: state.selectedId }));

$("clear-filters").addEventListener("click", handlers.onClear);
$("refresh").addEventListener("click", load);
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") select(null);
});
window.addEventListener("resize", () => invalidateMap());
$("refit").addEventListener("click", () => refitMap());

load();

{
  const year = $("year");
  if (year) year.textContent = String(new Date().getFullYear());
}

loadTrends();
// The analytics tables change once a night, so a slow refresh is plenty.
setInterval(() => { if (document.visibilityState === "visible") loadTrends(); }, 30 * 60 * 1000);
let trendsResize;
window.addEventListener("resize", () => {
  clearTimeout(trendsResize);
  trendsResize = setTimeout(() => renderTrends({ onSelect: select }), 150);
});

// Only poll while the tab is visible, so an idle background tab never wakes the database.
const stale = () => Date.now() - lastLoad >= REFRESH_MS;
setInterval(() => { if (document.visibilityState === "visible" && stale()) load(); }, 30000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && stale()) load();
});
setInterval(() => { if (state.stats) ui.updateLive(); }, 30000);
