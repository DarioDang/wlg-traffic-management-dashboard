import L from "leaflet";
import { API_BASE } from "./config.js";
import { h } from "./dom.js";
import { getMap } from "./mapview.js";

const nf = new Intl.NumberFormat("en-NZ");
const MIN_GAP_PX = 24; // counters closer than this on screen collapse into the busiest one

// Smaller dots when zoomed out, growing as the map zooms in.
function radius(v, zoom) {
  const base = 3 + Math.sqrt(v || 0) / 18;
  const scale = zoom <= 10 ? 0.6 : zoom <= 12 ? 0.8 : 1;
  return Math.max(4, Math.min(14, base * scale));
}

function popupContent(s, hidden) {
  const box = h("div", { class: "pop counter-pop" });
  box.append(
    h("div", { class: "pop-head" }, h("span", { class: "pop-type" }, "Traffic counter")),
    h("div", { class: "pop-title" },
      ...(s.highway ? [h("span", { class: "hw" }, `SH ${s.highway}`)] : []),
      s.name || "Counter")
  );
  const meta = h("dl", { class: "pop-meta" });
  const add = (k, v) => { if (v) meta.append(h("dt", {}, k), h("dd", {}, v)); };
  add("Weekday", `${nf.format(s.weekday_avg)} vehicles/day`);
  add("Weekend", `${nf.format(s.weekend_avg)} vehicles/day`);
  if (s.heavy_pct != null) add("Heavy vehicles", `${s.heavy_pct}%`);
  add("Lanes counted", String(s.lanes));
  box.append(meta);
  const note = "28-day average of daily counts. NZTA data runs about 3 days behind.";
  box.append(h("p", { class: "pop-body" },
    hidden > 0 ? `${note} ${hidden} more counter${hidden > 1 ? "s" : ""} nearby: zoom in to see ${hidden > 1 ? "them" : "it"}.` : note));
  return box;
}

// Busiest first; keep a counter only if no kept one is within MIN_GAP_PX on screen.
function declutter(items, map) {
  const z = map.getZoom();
  const sorted = [...items].sort((a, b) => b.weekday_avg - a.weekday_avg);
  const kept = [];
  for (const s of sorted) {
    const p = map.project([s.lat, s.lon], z);
    const near = kept.find((k) => k.p.distanceTo(p) < MIN_GAP_PX);
    if (near) near.hidden += 1;
    else kept.push({ s, p, hidden: 0 });
  }
  return kept;
}

export function initCounters() {
  const map = getMap();
  if (!map) return;

  const layer = L.layerGroup();
  const shown = new Map(); // "lat,lon" -> circleMarker
  let items = [];
  let loaded = false;
  let loading = false;

  const keyOf = (s) => `${s.lat},${s.lon}`;

  function redraw() {
    if (!items.length) return;
    const zoom = map.getZoom();
    const kept = declutter(items, map);
    const keep = new Set(kept.map(({ s }) => keyOf(s)));

    for (const [k, m] of shown) {
      if (!keep.has(k)) {
        layer.removeLayer(m);
        shown.delete(k);
      }
    }
    for (const { s, hidden } of kept) {
      const k = keyOf(s);
      let m = shown.get(k);
      if (!m) {
        m = L.circleMarker([s.lat, s.lon], {
          radius: radius(s.weekday_avg, zoom),
          color: "#1e3a8a",
          weight: 1,
          fillColor: "#3b82f6",
          fillOpacity: 0.4,
          bubblingMouseEvents: false,
        });
        m.bindPopup(popupContent(s, hidden), { className: "rw-popup", maxWidth: 300, autoPan: false });
        m.getPopup()._rwId = "counter"; // not an event id, so the global popupclose guard in select() ends the loop
        m.addTo(layer);
        shown.set(k, m);
      } else {
        m.setPopupContent(popupContent(s, hidden));
      }
      m.setRadius(radius(s.weekday_avg, zoom));
    }
  }

  L.control
    .layers(null, { "Traffic counters <small>(typical daily volume)</small>": layer },
      { position: "topright", collapsed: true })
    .addTo(map);

  async function load() {
    if (loaded || loading) return;
    loading = true;
    try {
      const res = await fetch(`${API_BASE}/api/traffic-sites`);
      if (!res.ok) throw new Error(`traffic-sites ${res.status}`);
      const data = await res.json();
      items = data.items || [];
      loaded = true;
      redraw();
    } catch (err) {
      console.error(err);
      map.removeLayer(layer); // uncheck the toggle so the next tick retries
    } finally {
      loading = false;
    }
  }

  // Fetch only the first time the layer is switched on; redraw if the zoom changed while it was off.
  map.on("overlayadd", (ev) => {
    if (ev.layer !== layer) return;
    if (loaded) redraw();
    else load();
  });
  map.on("zoomend", () => { if (map.hasLayer(layer)) redraw(); });
}