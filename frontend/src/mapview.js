import L from "leaflet";
import { TILE_URL, TILE_ATTRIBUTION, WELLINGTON } from "./config.js";
import { h, svg } from "./dom.js";
import { sevBadge } from "./badges.js";
import {
  typeInfo, typeKey, typeColor, highwayOf, placeOf, fmtDate, reducedMotion, timeAgo, causeOf,
} from "./labels.js";

let map;
let group;
let rebuilding = false;
let handlers = { onSelect() {}, onHover() {} };
const parts = new Map(); // id -> { event, marker, casing, line }

// One white glyph per type. Together with the pin shape this is the secondary
// encoding: type is never carried by colour alone.
const GLYPHS = {
  road_closure:      [["rect", { x: "5", y: "10", width: "14", height: "4", rx: "1", fill: "currentColor" }]],
  stop_go:           [["rect", { x: "7.5", y: "6", width: "3.2", height: "12", rx: "1", fill: "currentColor" }], ["rect", { x: "13.3", y: "6", width: "3.2", height: "12", rx: "1", fill: "currentColor" }]],
  lane_closure:      [["rect", { x: "10.8", y: "4", width: "2.4", height: "4.6", rx: "1", fill: "currentColor" }], ["rect", { x: "10.8", y: "9.7", width: "2.4", height: "4.6", rx: "1", fill: "currentColor" }], ["rect", { x: "10.8", y: "15.4", width: "2.4", height: "4.6", rx: "1", fill: "currentColor" }]],
  speed_restriction: [["rect", { x: "10.8", y: "9", width: "2.4", height: "6", rx: "1", fill: "currentColor" }], ["circle", { cx: "12", cy: "18", r: "1.4", fill: "currentColor" }]],
  other:             [["circle", { cx: "12", cy: "12", r: "3", fill: "currentColor" }]],
  cleared_no_detail: [["path", { d: "M7 12.5l3.2 3.2L17 8.8", fill: "none", stroke: "currentColor", "stroke-width": "2.4", "stroke-linecap": "round", "stroke-linejoin": "round" }]],
};

function pinElement(e) {
  const key = typeKey(e.closure_type);
  const live = key === "road_closure" && e.status === "Active";
  return h(
    "div",
    { class: `pin pin-${key}${live ? " is-live" : ""}`, style: { "--tc": `var(--c-${key})` } },
    svg("0 0 24 24", GLYPHS[key], { class: "pin-glyph" })
  );
}

function popupContent(e) {
  const key = typeKey(e.closure_type);
  const info = typeInfo(key);
  const box = h("div", { class: "pop", style: { "--tc": `var(--c-${key})` } });
  box.append(
    h("div", { class: "pop-head" },
      h("span", { class: `swatch shape-${info.shape}` }),
      h("span", { class: "pop-type" }, info.label),
      h("span", { class: `status status-${(e.status || "").toLowerCase()}` }, e.status === "Resolved" ? "Cleared" : e.status)
    ),
    h("div", { class: "pop-title" }, h("span", { class: "hw" }, highwayOf(e)), placeOf(e)),
    h("div", { class: "pop-badges" }, sevBadge(e), h("span", { class: "pop-cause" }, causeOf(e)))
  );
  if (e.comments) box.append(h("p", { class: "pop-body" }, e.comments.trim()));
  const meta = h("dl", { class: "pop-meta" });
  const add = (k, v) => { if (v) meta.append(h("dt", {}, k), h("dd", {}, v)); };
  add("Started", fmtDate(e.start_date));
  add("Ends", fmtDate(e.end_date) || (e.expected_resolution || "").trim());
  add("Impact", e.impact);
  add("Reported", e.event_created ? `${fmtDate(e.event_created)} (${timeAgo(e.event_created)})` : "");
  add("Updated", e.event_modified ? `${fmtDate(e.event_modified)} (${timeAgo(e.event_modified)})` : "");
  if (e.route) add("Route", [e.route.journey, e.route.leg].filter(Boolean).join(": "));
  if (e.sections && e.sections.length) add("Section", e.sections.join("; "));
  if (e.alternative_route && !/^not applicable$/i.test(e.alternative_route.trim())) {
    add("Detour", e.alternative_route.trim());
  }
  if (meta.children.length) box.append(meta);
  return box;
}

function middle(coords) {
  return coords[Math.floor(coords.length / 2)];
}

export function initMap(elementId, h_) {
  handlers = h_;
  map = L.map(elementId, {
    zoomControl: false,
    zoomAnimation: !reducedMotion(),
    attributionControl: true,
  }).setView(WELLINGTON, 10);
  L.control.zoom({ position: "topright" }).addTo(map);
  L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
  group = L.layerGroup().addTo(map);
  map.on("popupclose", (ev) => {
    if (rebuilding) return;
    handlers.onSelect(null, { closedId: ev.popup && ev.popup._rwId });
  });
  return map;
}

export function renderMap(events, { selectedId = null, fit = false } = {}) {
  rebuilding = true; // clearing layers closes any open popup; that is not a user action
  group.clearLayers();
  parts.clear();
  const bounds = [];

  for (const e of events) {
    if (!e.coords || e.coords.length === 0) continue;
    const key = typeKey(e.closure_type);
    const color = typeColor(key);
    const isLine = e.geometry_type === "line" && e.coords.length > 1;
    let casing = null;
    let line = null;

    if (isLine) {
      casing = L.polyline(e.coords, {
        color: getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#fff",
        weight: 9, opacity: 0.95, lineCap: "round", lineJoin: "round", interactive: false,
      }).addTo(group);
      line = L.polyline(e.coords, {
        color, weight: 5, opacity: 1, lineCap: "round", lineJoin: "round",
        dashArray: key === "stop_go" ? "1 9" : key === "lane_closure" ? "14 8" : null,
      }).addTo(group);
      line.on("click", () => handlers.onSelect(e.id));
      line.on("mouseover", () => handlers.onHover(e.id));
      line.on("mouseout", () => handlers.onHover(null));
    }

    const pos = middle(e.coords);
    const marker = L.marker(pos, {
      icon: L.divIcon({ className: "pin-wrap", html: pinElement(e), iconSize: [30, 30], iconAnchor: [15, 15] }),
      riseOnHover: true,
      keyboard: true,
      title: `${highwayOf(e)} ${placeOf(e)}`,
    }).addTo(group);
    marker.bindPopup(popupContent(e), { className: "rw-popup", maxWidth: 340, autoPan: false, closeButton: true, offset: [0, -10] });
    marker.getPopup()._rwId = e.id;
    marker.on("click", () => handlers.onSelect(e.id));
    marker.on("mouseover", () => handlers.onHover(e.id));
    marker.on("mouseout", () => handlers.onHover(null));

    parts.set(e.id, { event: e, marker, casing, line });
    bounds.push(...e.coords);
  }

  if (fit && bounds.length) {
    map.fitBounds(L.latLngBounds(bounds).pad(0.18), { maxZoom: 13, animate: !reducedMotion(), duration: 0.8 });
  }
  setSelected(selectedId, { open: selectedId != null });
  rebuilding = false;
}

function pinEl(id) {
  const p = parts.get(id);
  return p && p.marker.getElement() && p.marker.getElement().querySelector(".pin");
}

export function setSelected(id, { open = true } = {}) {
  for (const [pid, p] of parts) {
    const el = pinEl(pid);
    if (el) el.classList.toggle("is-selected", pid === id);
    if (p.line) {
      p.line.setStyle({ weight: pid === id ? 8 : 5 });
      p.casing.setStyle({ weight: pid === id ? 12 : 9 });
      if (pid === id) { p.casing.bringToFront(); p.line.bringToFront(); }
    }
  }
  if (id != null && open) {
    const p = parts.get(id);
    if (p) p.marker.openPopup();
  } else if (id == null) {
    map.closePopup();
  }
}

export function setHover(id) {
  for (const pid of parts.keys()) {
    const el = pinEl(pid);
    if (el) el.classList.toggle("is-hover", pid === id);
  }
}

export function flyToEvent(id) {
  const p = parts.get(id);
  if (!p) return;
  const quick = reducedMotion();
  if (p.line) {
    map.flyToBounds(p.line.getBounds().pad(0.7), { maxZoom: 15, duration: quick ? 0 : 0.9 });
  } else {
    map.flyTo(p.marker.getLatLng(), Math.max(map.getZoom(), 14), { duration: quick ? 0 : 0.9 });
  }
}

export function refitMap() {
  const all = [];
  for (const p of parts.values()) all.push(...p.event.coords);
  if (all.length) map.fitBounds(L.latLngBounds(all).pad(0.18), { maxZoom: 13, animate: !reducedMotion(), duration: 0.8 });
}

export function invalidateMap() {
  if (map) map.invalidateSize();
}
