import { h, $, clear } from "./dom.js";
import { state } from "./state.js";
import { highwayOf, placeOf, plural } from "./labels.js";
import { attachTip, hideTip } from "./tooltip.js";

// Trends panel. Reads /api/trends and /api/insights, which come from the dbt
// analytics tables (rebuilt every night). Charts are plain SVG drawn at the
// card's real pixel width, so text stays readable on phones.

const NS = "http://www.w3.org/2000/svg";
const HEIGHT = 190;
const M = { l: 30, r: 10, t: 20, b: 24 };

let trends = null;
let insights = null;
let loaded = false;

export function setTrendsData(tr, ins) {
  trends = tr;
  insights = ins;
  loaded = true;
}

function sv(tag, attrs = {}, text) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text != null) el.textContent = String(text);
  return el;
}

const dayDate = (day) => new Date(`${day}T12:00:00Z`);
const fmtShort = (day) =>
  dayDate(day).toLocaleDateString("en-NZ", { day: "numeric", month: "short", timeZone: "UTC" });
const fmtLong = (day) =>
  dayDate(day).toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

function fmtHours(n) {
  const v = Number(n) || 0;
  if (v >= 48) return `${(v / 24).toFixed(1).replace(/\.0$/, "")} days`;
  return `${Math.round(v)} h`;
}

function niceScale(max) {
  const raw = Math.max(1, max);
  const step = [1, 2, 5, 10, 20, 50, 100].find((s) => raw / s <= 4) || 100;
  const top = Math.ceil(raw / step) * step;
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { top, ticks };
}

// Rounded top corners, square at the baseline.
function barPath(x, y, w, hgt, r) {
  const k = Math.min(r, w / 2, hgt);
  return `M${x},${y + hgt}V${y + k}Q${x},${y} ${x + k},${y}H${x + w - k}Q${x + w},${y} ${x + w},${y + k}V${y + hgt}Z`;
}

function frame(box, items, maxVal, label) {
  const w = Math.max(240, box.clientWidth || 360);
  const { top, ticks } = niceScale(maxVal);
  const plotW = w - M.l - M.r;
  const plotH = HEIGHT - M.t - M.b;
  const y = (v) => M.t + plotH - (v / top) * plotH;
  const band = plotW / items.length;
  const x0 = (i) => M.l + i * band;
  const svg = sv("svg", { viewBox: `0 0 ${w} ${HEIGHT}`, width: w, height: HEIGHT, role: "img", "aria-label": label, class: "tr-svg" });

  for (const t of ticks) {
    svg.append(sv("line", { x1: M.l, x2: w - M.r, y1: y(t), y2: y(t), class: t === 0 ? "tr-base" : "tr-grid" }));
    svg.append(sv("text", { x: M.l - 6, y: y(t) + 4, "text-anchor": "end", class: "tr-axis" }, t));
  }
  // Thin the day labels so they never touch; the newest day is always labelled.
  const every = Math.max(1, Math.ceil(48 / band));
  items.forEach((d, i) => {
    if ((items.length - 1 - i) % every) return;
    svg.append(sv("text", { x: x0(i) + band / 2, y: HEIGHT - 6, "text-anchor": "middle", class: "tr-axis" }, fmtShort(d.day)));
  });
  return { svg, w, y, band, x0, plotH };
}

function tipFor(d) {
  const started = trends && d.day === trends.baseline_day;
  return {
    title: fmtLong(d.day),
    rows: [
      ["Open", String(d.events_open)],
      ["New", started ? "Tracking began" : String(d.new_events)],
      ["Cleared", String(d.cleared_events)],
      ["Updates", String(d.updates)],
    ],
  };
}

// One invisible, keyboard-focusable column per day: bigger than any mark,
// shows a crosshair and one tooltip with every series for that day.
function hitLayer(f, items) {
  items.forEach((d, i) => {
    const g = sv("g", { class: "tr-hit" });
    const cx = f.x0(i) + f.band / 2;
    g.append(sv("line", { x1: cx, x2: cx, y1: M.t, y2: M.t + f.plotH, class: "tr-cross" }));
    const r = sv("rect", {
      x: f.x0(i), y: M.t, width: f.band, height: f.plotH, class: "tr-target", tabindex: 0,
      "aria-label": `${fmtLong(d.day)}: ${d.events_open} open, ${d.new_events} new, ${d.cleared_events} cleared, ${d.updates} updates`,
    });
    attachTip(r, () => tipFor(d));
    g.append(r);
    f.svg.append(g);
  });
}

function drawOpen(box, items) {
  const first = items[0];
  const last = items[items.length - 1];
  const f = frame(
    box, items, Math.max(...items.map((d) => d.events_open)),
    `Events open each day, from ${first.events_open} on ${fmtShort(first.day)} to ${last.events_open} on ${fmtShort(last.day)}`
  );
  const pts = items.map((d, i) => [f.x0(i) + f.band / 2, f.y(d.events_open)]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const base = f.y(0);
  const [lx, ly] = pts[pts.length - 1];
  f.svg.append(sv("path", { d: `${line}L${lx.toFixed(1)},${base}L${pts[0][0].toFixed(1)},${base}Z`, class: "tr-area" }));
  f.svg.append(sv("path", { d: line, class: "tr-line" }));
  f.svg.append(sv("circle", { cx: lx, cy: ly, r: 4, class: "tr-dot" }));
  f.svg.append(sv("text", { x: lx, y: ly - 9, "text-anchor": "middle", class: "tr-value" }, last.events_open));
  hitLayer(f, items);
  box.append(f.svg);
}

function drawFlow(box, items) {
  const started = (d) => trends && d.day === trends.baseline_day;
  const maxVal = Math.max(1, ...items.map((d) => Math.max(started(d) ? 0 : d.new_events, d.cleared_events)));
  const f = frame(box, items, maxVal, `New and cleared events each day, ${fmtShort(items[0].day)} to ${fmtShort(items[items.length - 1].day)}`);
  const gap = 2;
  const bw = Math.max(3, Math.min(24, (f.band * 0.72 - gap) / 2));
  const lastIdx = items.length - 1;
  items.forEach((d, i) => {
    const cx = f.x0(i) + f.band / 2;
    const bars = [
      ["new", started(d) ? 0 : d.new_events, cx - gap / 2 - bw],
      ["cleared", d.cleared_events, cx + gap / 2],
    ];
    for (const [cls, v, x] of bars) {
      if (!v) continue;
      const top = f.y(v);
      f.svg.append(sv("path", { d: barPath(x, top, bw, f.y(0) - top, 4), class: `tr-bar tr-${cls}` }));
      if (i === lastIdx) f.svg.append(sv("text", { x: x + bw / 2, y: top - 5, "text-anchor": "middle", class: "tr-value" }, v));
    }
  });
  hitLayer(f, items);
  box.append(f.svg);
}

function drawStats() {
  const box = clear($("tr-stats"));
  const s = insights && insights.summary;
  if (!s || s.events_tracked == null) return;
  const tile = (value, label, note) =>
    h("div", { class: "tr-stat" }, h("strong", {}, String(value)), h("span", {}, label), note ? h("em", {}, note) : null);
  box.append(
    tile(s.events_tracked, "Events tracked", `${s.in_feed} still in the feed`),
    tile(s.with_extensions, "Had the end date pushed back", `of ${s.events_tracked} tracked`),
    tile(Number(s.avg_changes || 0).toFixed(1), "Updates per event", "average after the first sighting")
  );
}

function drawExtensions(hd) {
  const box = clear($("tr-ext"));
  const list = (insights && insights.most_extended) || [];
  if (!insights) {
    box.append(h("p", { class: "empty-note" }, "Not available right now."));
    return;
  }
  if (!list.length) {
    box.append(h("p", { class: "empty-note" }, "No event has had its end date pushed back yet."));
    return;
  }
  const known = new Set(state.events.map((e) => e.id));
  for (const it of list) {
    const ev = { highway: it.highway_code, location_area: it.location_area };
    const link = known.has(it.event_id) && hd.onSelect;
    const n = it.n_end_date_extensions;
    const props = { class: `tr-row${link ? " is-link" : ""}` };
    if (link) { props.type = "button"; props.onclick = () => hd.onSelect(it.event_id); }
    box.append(
      h(link ? "button" : "div", props,
        h("span", { class: "tr-row-main" }, h("span", { class: "hw" }, highwayOf(ev)), h("span", {}, placeOf(ev))),
        h("span", { class: "tr-row-sub" },
          [it.event_description, it.event_type].filter(Boolean).join(" · "),
          ` · ${it.in_feed ? "Still in the feed" : "Left the feed"}`),
        h("span", { class: "tr-row-hrs" },
          h("strong", {}, `+${fmtHours(it.total_extension_hours)}`),
          h("span", {}, `${n} ${plural(n, "update")}`)))
    );
  }
}

export function renderTrends(hd = {}) {
  if (!loaded) return;
  hideTip();
  const items = trends && Array.isArray(trends.items) ? trends.items : [];
  const note = $("tr-note");
  $("trends-count").textContent = trends ? `Last ${items.length} ${plural(items.length, "day")}` : "";
  drawStats();
  drawExtensions(hd);
  for (const id of ["tr-open", "tr-flow", "tr-legend", "tr-table-body"]) clear($(id));
  note.textContent = "";

  if (!trends) {
    note.textContent = "Trends are not available right now.";
    return;
  }
  if (items.length < 2) {
    note.textContent = "Not enough history yet. The charts appear after two days of tracking.";
    return;
  }

  const key = (cls, label) => h("span", { class: "tr-key" }, h("i", { class: `tr-swatch tr-${cls}` }), label);
  $("tr-legend").append(key("new", "New"), key("cleared", "Cleared"));

  drawOpen($("tr-open"), items);
  drawFlow($("tr-flow"), items);

  const body = $("tr-table-body");
  for (const d of [...items].reverse()) {
    body.append(
      h("tr", {},
        h("th", { scope: "row" }, fmtLong(d.day)),
        h("td", {}, d.day === trends.baseline_day ? "n/a" : String(d.new_events)),
        h("td", {}, String(d.cleared_events)),
        h("td", {}, String(d.events_open)),
        h("td", {}, String(d.updates)))
    );
  }

  const base = trends.baseline_day;
  if (base && items.some((d) => d.day === base)) {
    note.textContent = `Tracking began on ${fmtShort(base)}, so events that were already open that day are not counted as new.`;
  }
}