import { h, $, clear, ICONS } from "./dom.js";
import { state, byStatus, filtersActive } from "./state.js";
import {
  TYPE_ORDER, TYPES, typeKey, typeInfo, highwayOf, placeOf, fmtDate, fmtDay, parseWhen,
  timeAgo, daysSince, fmtBytes, plural, reducedMotion,
} from "./labels.js";
import { attachTip } from "./tooltip.js";
import { STALE_AFTER_MIN, INGEST_EVERY } from "./config.js";

const DAY = 86400000;

// ---------- theme ----------

export function initTheme(onChange) {
  const btn = $("theme");
  const root = document.documentElement;
  const sync = () => btn.setAttribute("aria-pressed", String(root.dataset.theme === "dark"));
  sync();
  btn.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("wlg-theme", next); } catch { /* private mode */ }
    sync();
    onChange(next);
  });
}

// ---------- refresh stripe + live pill ----------

export function stripeLoading(on) {
  $("stripe-fill").classList.toggle("loading", on);
}

export function stripeRun(ms) {
  const fill = $("stripe-fill");
  fill.classList.remove("run", "loading");
  void fill.offsetWidth; // restart the animation
  fill.style.setProperty("--dur", `${ms}ms`);
  fill.classList.add("run");
}

export function setLive(name, label, sub = "") {
  $("live").dataset.state = name;
  $("live-label").textContent = label;
  $("live-sub").textContent = sub;
}

export function updateLive() {
  const last = state.stats && state.stats.last_success_at;
  const status = state.health && state.health.status;
  if (!last) return setLive("stale", "No data yet", "");
  const mins = (Date.now() - new Date(last).getTime()) / 60000;
  if (status === "failing") return setLive("stale", "Ingest failing", `Last success ${timeAgo(last)}`);
  if (mins > STALE_AFTER_MIN || status === "stale") return setLive("stale", "Data delayed", `Last ingest ${timeAgo(last)}`);
  setLive("live", "Live", `Updated ${timeAgo(last)}`);
}

// ---------- animated numbers ----------

export function countUp(el, to, ms = 700) {
  const from = Number(el.dataset.v ?? 0);
  el.dataset.v = String(to);
  cancelAnimationFrame(el._raf);
  if (reducedMotion() || from === to) { el.textContent = String(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = String(Math.round(from + (to - from) * eased));
    if (k < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}

// ---------- filters ----------

const STATUS_OPTS = [
  ["all", "All", () => state.events.length],
  ["active", "Active", () => state.events.filter((e) => e.status === "Active").length],
  ["scheduled", "Scheduled", () => state.events.filter((e) => e.status === "Scheduled").length],
  ["cleared", "Cleared", () => state.events.filter((e) => e.status === "Resolved").length],
];

export function renderFilters(hd) {
  const seg = clear($("seg-status"));
  for (const [val, label, count] of STATUS_OPTS) {
    seg.append(
      h("button", {
        type: "button", class: "seg-btn", "aria-pressed": String(state.status === val),
        onclick: () => hd.onStatus(val),
      }, label, h("span", { class: "count" }, String(count())))
    );
  }

  const counts = {};
  for (const e of byStatus()) counts[typeKey(e.closure_type)] = (counts[typeKey(e.closure_type)] || 0) + 1;
  const present = new Set(state.events.map((e) => typeKey(e.closure_type)));

  const chips = clear($("chips"));
  for (const key of TYPE_ORDER) {
    if (!present.has(key)) continue;
    const n = counts[key] || 0;
    const on = state.types.has(key);
    chips.append(
      h("button", {
        type: "button",
        class: `chip${n === 0 && !on ? " is-empty" : ""}`,
        "aria-pressed": String(on),
        style: { "--tc": `var(--c-${key})` },
        onclick: () => hd.onType(key),
      }, h("span", { class: `swatch shape-${TYPES[key].shape}` }), TYPES[key].label, h("span", { class: "count" }, String(n)))
    );
  }
  $("clear-filters").hidden = !filtersActive();
}

// ---------- hero ----------

function whenText(e) {
  if (e.status === "Resolved") return "Cleared";
  const start = parseWhen(e.start_date);
  if (start && start.getTime() > Date.now()) return `Starts ${fmtDay(start.getTime())}`;
  const d = daysSince(e.start_date);
  if (d == null) return "";
  if (d === 0) return "Started today";
  return `${d} ${plural(d, "day")} running`;
}

export function renderHero(list) {
  const n = list.length;
  countUp($("hero-num"), n);
  const prefix = { all: "", active: "active ", scheduled: "scheduled ", cleared: "cleared " }[state.status];
  $("hero-unit").textContent = `${prefix}${plural(n, "event")}`;

  const count = (s) => list.filter((e) => e.status === s).length;
  const parts = [];
  if (count("Active")) parts.push(`${count("Active")} active`);
  if (count("Scheduled")) parts.push(`${count("Scheduled")} scheduled`);
  if (count("Resolved")) parts.push(`${count("Resolved")} cleared`);
  $("hero-sub").textContent = n ? `${parts.join(", ")} on Wellington state highways` : "Nothing matches these filters";

  const of = (t) => list.filter((e) => typeKey(e.closure_type) === t).length;
  countUp($("kpi-closures"), of("road_closure"));
  countUp($("kpi-stopgo"), of("stop_go"));

  let best = null;
  for (const e of list) {
    if (e.status !== "Active") continue;
    const d = daysSince(e.start_date);
    if (d != null && (!best || d > best.d)) best = { d, e };
  }
  $("kpi-longest").textContent = best ? `${best.d} ${plural(best.d, "day")}` : "None";
  $("kpi-longest-note").textContent = best ? `${highwayOf(best.e)} ${placeOf(best.e)}` : "No active works in view";
}

// ---------- event list ----------

const STATUS_RANK = { Active: 0, Scheduled: 1, Resolved: 2 };

export function sortEvents(list) {
  return [...list].sort(
    (a, b) =>
      (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3) ||
      TYPE_ORDER.indexOf(typeKey(a.closure_type)) - TYPE_ORDER.indexOf(typeKey(b.closure_type)) ||
      a.id - b.id
  );
}

export function renderList(list, hd, { first = false } = {}) {
  const ul = clear($("event-list"));
  $("list-count").textContent = `${list.length} ${plural(list.length, "event")}`;
  if (!list.length) {
    ul.append(
      h("li", { class: "empty" },
        h("strong", {}, "No events match these filters"),
        h("span", {}, "Try a different status or event type."),
        h("button", { type: "button", class: "link-btn", onclick: hd.onClear }, "Clear filters"))
    );
    return;
  }
  sortEvents(list).forEach((e, i) => {
    const key = typeKey(e.closure_type);
    const info = typeInfo(key);
    const btn = h("button", {
      type: "button",
      class: `ev${first && i < 12 ? " enter" : ""}`,
      "data-id": String(e.id),
      style: { "--tc": `var(--c-${key})`, "--i": String(i) },
      onclick: () => hd.onSelect(e.id),
      onpointerenter: () => hd.onHover(e.id),
      onpointerleave: () => hd.onHover(null),
    },
      h("span", { class: "ev-top" },
        h("span", { class: "hw" }, highwayOf(e)),
        h("span", { class: "ev-type" }, h("span", { class: `swatch shape-${info.shape}` }), info.label)),
      h("span", { class: "ev-place" }, placeOf(e)),
      h("span", { class: "ev-meta" },
        h("span", { class: `status status-${(e.status || "").toLowerCase()}` }, e.status === "Resolved" ? "Cleared" : e.status),
        h("span", { class: "ev-when" }, whenText(e)))
    );
    ul.append(h("li", {}, btn));
  });
}

// ---------- by highway ----------

export function renderHighways(list, hd) {
  const groups = new Map();
  for (const e of list) {
    const hw = highwayOf(e);
    const g = groups.get(hw) || { hw, total: 0, byType: {} };
    const k = typeKey(e.closure_type);
    g.total += 1;
    g.byType[k] = (g.byType[k] || 0) + 1;
    groups.set(hw, g);
  }
  const rows = [...groups.values()].sort(
    (a, b) => b.total - a.total || a.hw.localeCompare(b.hw, undefined, { numeric: true })
  );
  const max = Math.max(1, ...rows.map((r) => r.total));

  const chart = clear($("hw-chart"));
  const bars = [];
  if (!rows.length) chart.append(h("p", { class: "empty-note" }, "No events in this view."));

  for (const r of rows) {
    const bar = h("div", { class: "hw-bar" });
    for (const key of TYPE_ORDER) {
      const n = r.byType[key];
      if (!n) continue;
      const seg = h("button", {
        type: "button", class: "hw-seg",
        style: { "--tc": `var(--c-${key})`, flex: `${n} 0 0` },
        "aria-label": `${r.hw}: ${n} ${TYPES[key].label}`,
        onclick: () => hd.onType(key),
      });
      attachTip(seg, () => ({ title: r.hw, rows: [[TYPES[key].label, String(n)]] }));
      bar.append(seg);
    }
    bars.push([bar, (r.total / max) * 100]);
    chart.append(h("div", { class: "hw-row" }, h("span", { class: "hw-name" }, r.hw), h("div", { class: "hw-track" }, bar), h("span", { class: "hw-total" }, String(r.total))));
  }
  // Grow the bars on the next frame so the width transition runs.
  requestAnimationFrame(() => requestAnimationFrame(() => bars.forEach(([bar, w]) => { bar.style.width = `${w}%`; })));

  const legend = clear($("hw-legend"));
  const totals = {};
  for (const e of list) totals[typeKey(e.closure_type)] = (totals[typeKey(e.closure_type)] || 0) + 1;
  for (const key of TYPE_ORDER) {
    if (!totals[key]) continue;
    legend.append(h("span", { class: "legend-item", style: { "--tc": `var(--c-${key})` } }, h("span", { class: `swatch shape-${TYPES[key].shape}` }), `${TYPES[key].label} ${totals[key]}`));
  }

  // Table view: every number in the chart, reachable without hover.
  const body = clear($("hw-table-body"));
  for (const r of rows) {
    body.append(h("tr", {}, h("th", { scope: "row" }, r.hw), ...TYPE_ORDER.slice(0, 5).map((k) => h("td", {}, String(r.byType[k] || 0))), h("td", {}, String(r.byType.cleared_no_detail || 0)), h("td", {}, String(r.total))));
  }
}

// ---------- timeline ----------

export function renderTimeline(list, hd) {
  const box = clear($("timeline"));
  const now = Date.now();
  const rows = sortEvents(list)
    .filter((e) => e.status !== "Resolved")
    .map((e) => {
      const s = parseWhen(e.start_date);
      const en = parseWhen(e.end_date) || parseWhen(e.expected_resolution);
      return { e, start: s ? s.getTime() : now, end: en ? en.getTime() : null };
    })
    .sort((a, b) => a.start - b.start);

  $("tl-count").textContent = `${rows.length} ${plural(rows.length, "event")}`;
  if (!rows.length) {
    box.append(h("p", { class: "empty-note" }, "Nothing active or scheduled in this view."));
    return;
  }

  let t0 = Math.max(Math.min(now - 3 * DAY, ...rows.map((r) => r.start)), now - 21 * DAY);
  let t1 = Math.min(Math.max(now + 21 * DAY, ...rows.filter((r) => r.end).map((r) => r.end)), now + 75 * DAY);
  const pct = (t) => Math.min(100, Math.max(0, ((t - t0) / (t1 - t0)) * 100));

  // Pick the tick spacing from the room available, so labels never collide on phones.
  const card = box.closest(".timeline-card");
  const labelPx = parseInt(getComputedStyle(card).getPropertyValue("--tl-label"), 10) || 250;
  const trackPx = Math.max(160, box.clientWidth - 36 - labelPx);
  const spanDays = (t1 - t0) / DAY;
  let step = 7;
  for (const s of [7, 14, 28]) {
    step = s;
    if (trackPx / (spanDays / s) >= 72) break;
  }
  const plot = h("div", { class: "tl-plot", "aria-hidden": "true" });
  const axis = h("div", { class: "tl-axis-track" });
  const firstTick = Math.ceil(t0 / (step * DAY)) * step * DAY;
  for (let t = firstTick; t < t1; t += step * DAY) {
    plot.append(h("span", { class: "tl-grid", style: { left: `${pct(t)}%` } }));
    axis.append(h("span", { class: "tl-tick", style: { left: `${pct(t)}%` } }, fmtDay(t)));
  }
  plot.append(h("span", { class: "tl-now", style: { left: `${pct(now)}%` } }, h("em", {}, "Now")));

  const grid = h("div", { class: "tl", style: { "--rows": String(rows.length + 1) } });
  grid.append(h("div", { class: "tl-axis-spacer" }), axis);

  rows.forEach(({ e, start, end }, i) => {
    const key = typeKey(e.closure_type);
    const open = end == null;
    const left = pct(start);
    const right = open ? 100 : pct(end);
    const width = Math.max(1.2, right - left);
    const label = h("button", {
      type: "button", class: "tl-label", "data-id": String(e.id),
      onclick: () => hd.onSelect(e.id),
      onpointerenter: () => hd.onHover(e.id),
      onpointerleave: () => hd.onHover(null),
    }, h("span", { class: "hw" }, highwayOf(e)), h("span", { class: "tl-place" }, placeOf(e)));

    const bar = h("button", {
      type: "button",
      class: `tl-bar${open ? " open" : ""}`,
      "data-id": String(e.id),
      "aria-label": `${highwayOf(e)} ${placeOf(e)}: ${typeInfo(key).label}`,
      style: { left: `${left}%`, width: `${width}%`, "--tc": `var(--c-${key})`, "--i": String(i) },
      onclick: () => hd.onSelect(e.id),
      onpointerenter: () => hd.onHover(e.id),
      onpointerleave: () => hd.onHover(null),
    });
    attachTip(bar, () => ({
      title: `${highwayOf(e)} ${placeOf(e)}`,
      rows: [
        [typeInfo(key).label, e.status === "Resolved" ? "Cleared" : e.status],
        ["Starts", fmtDate(e.start_date) || "Not stated"],
        ["Ends", fmtDate(e.end_date) || (e.expected_resolution || "").trim() || "Not stated"],
      ],
    }));
    grid.append(label, h("div", { class: "tl-track" }, bar));
  });
  grid.append(plot);
  box.append(grid);
}

// ---------- pipeline ----------

const HEALTH = {
  ok:      { label: "Healthy",  icon: ICONS.check, cls: "good" },
  stale:   { label: "Delayed",  icon: ICONS.warn,  cls: "warn" },
  failing: { label: "Failing",  icon: ICONS.cross, cls: "crit" },
  no_runs: { label: "No runs yet", icon: ICONS.clock, cls: "warn" },
};

export function renderPipeline() {
  const hl = state.health;
  const st = state.stats || {};
  const pill = clear($("pipe-status"));
  const m = hl && HEALTH[hl.status] ? HEALTH[hl.status] : { label: "Unknown", icon: ICONS.clock, cls: "warn" };
  pill.className = `pill pill-${m.cls}`;
  pill.append(m.icon(), m.label);

  const facts = clear($("pipe-facts"));
  const add = (k, v) => v && facts.append(h("dt", {}, k), h("dd", {}, v));
  add("Last ingest", st.last_success_at ? timeAgo(st.last_success_at) : "");
  add("Schedule", `Every ${INGEST_EVERY}`);
  add("Runs recorded", st.total_runs != null ? String(st.total_runs) : "");
  add("Events tracked", st.events_tracked_total != null ? String(st.events_tracked_total) : "");
  add("Database", hl ? fmtBytes(hl.database_bytes) : "");

  const flow = clear($("pipe-flow"));
  const steps = [
    ["NZTA Traffic and Travel API", ["Free public API", "State highways only", "Snapshot of current events"]],
    ["cron-job.org", ["Scheduler", `POST every ${INGEST_EVERY}`, "Free tier"]],
    ["FastAPI on Render", ["Python backend", "Hashes each event", "Keeps only real changes"]],
    ["Neon Postgres", ["Cloud database", "Every version of every event", "Free tier"]],
    ["This dashboard", ["Vanilla JS on Netlify", "Reads the API in your browser", "Refreshes every 5 min"]],
  ];
  steps.forEach(([title, lines], i) => {
    if (i > 0) flow.append(h("li", { class: "pipe-arrow", "aria-hidden": "true" }));
    flow.append(
      h("li", { class: "pipe-step" },
        h("span", { class: "pipe-icon" }, String(i + 1)),
        h("strong", {}, title),
        ...lines.map((l) => h("span", { class: "pipe-line" }, l)))
    );
  });
  $("pipe-note").textContent = `Every ${INGEST_EVERY}: NZTA feed, hash and diff, new versions stored in Neon. The page polls the API every 5 minutes while the tab is open.`;
}

// ---------- selection + hover (list and timeline) ----------

export function setSelectedUI(id, { scroll = false } = {}) {
  document.querySelectorAll("[data-id]").forEach((el) => {
    el.classList.toggle("is-selected", id != null && Number(el.dataset.id) === id);
  });
  if (id != null && scroll) {
    const el = document.querySelector(`.ev[data-id="${id}"]`);
    if (el) el.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }
}

export function setHoverUI(id) {
  document.querySelectorAll("[data-id]").forEach((el) => {
    el.classList.toggle("is-hover", id != null && Number(el.dataset.id) === id);
  });
}

// ---------- status banner ----------

export function showBanner(msg, { retry } = {}) {
  const el = $("banner");
  clear(el);
  if (!msg) { el.hidden = true; return; }
  el.hidden = false;
  el.append(ICONS.warn(), h("span", {}, msg));
  if (retry) el.append(h("button", { type: "button", class: "link-btn", onclick: retry }, "Try again"));
}
