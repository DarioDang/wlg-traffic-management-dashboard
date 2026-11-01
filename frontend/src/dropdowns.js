import { h, $ } from "./dom.js";
import { state, byStatus } from "./state.js";
import { TYPE_ORDER, TYPES, typeKey, CATEGORY_ORDER } from "./labels.js";

// Filter dropdowns for event type and category. They reuse the same state and
// handlers as the old chips, and update in place so keyboard focus is never lost.

const menus = [];
let wired = false;

function setOpen(m, on) {
  m.panel.hidden = !on;
  m.btn.setAttribute("aria-expanded", String(on));
  m.root.classList.toggle("is-open", on);
}

function wireGlobal() {
  if (wired) return;
  wired = true;
  document.addEventListener("click", (ev) => {
    for (const m of menus) if (!m.root.contains(ev.target)) setOpen(m, false);
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    for (const m of menus) {
      if (m.panel.hidden) continue;
      setOpen(m, false);
      m.btn.focus();
    }
  });
}

function makeMenu(host, label) {
  const value = h("span", { class: "dd-value" }, "All");
  const btn = h("button", { type: "button", class: "dd-btn", "aria-haspopup": "true", "aria-expanded": "false" },
    h("span", { class: "dd-label" }, label), value, h("span", { class: "dd-caret", "aria-hidden": "true" }));
  const panel = h("div", { class: "dd-panel", role: "group", "aria-label": label, hidden: true });
  const root = h("div", { class: "dd" }, btn, panel);
  host.replaceChildren(root);
  const m = { root, btn, panel, value, sig: "", opts: new Map() };
  btn.addEventListener("click", () => {
    const willOpen = panel.hidden;
    for (const o of menus) setOpen(o, false);
    setOpen(m, willOpen);
  });
  menus.push(m);
  wireGlobal();
  return m;
}

function sync(m, items, selected, onToggle) {
  const sig = items.map((i) => i.key).join("|");
  if (sig !== m.sig) {
    m.sig = sig;
    m.opts.clear();
    m.panel.replaceChildren();
    for (const it of items) {
      const input = h("input", { type: "checkbox" });
      input.addEventListener("change", () => onToggle(it.key));
      const count = h("span", { class: "count" });
      const label = h("label", { class: "dd-opt", style: it.swatch ? { "--tc": `var(--c-${it.key})` } : null },
        input,
        it.swatch ? h("span", { class: `swatch shape-${it.swatch}` }) : null,
        h("span", { class: "dd-name" }, it.label),
        count);
      m.panel.append(label);
      m.opts.set(it.key, { input, count, label });
    }
  }
  for (const it of items) {
    const o = m.opts.get(it.key);
    const on = selected.has(it.key);
    o.input.checked = on;
    o.count.textContent = String(it.count);
    o.label.classList.toggle("is-empty", it.count === 0 && !on);
  }
  const n = selected.size;
  const first = n === 1 ? items.find((i) => selected.has(i.key)) : null;
  m.value.textContent = n === 0 ? "All" : first ? first.label : `${n} selected`;
  m.btn.classList.toggle("has-value", n > 0);
}

let typeMenu = null;
let catMenu = null;

export function renderDropdowns(hd) {
  if (!typeMenu) typeMenu = makeMenu($("dd-type"), "Event type");
  if (!catMenu) catMenu = makeMenu($("dd-cat"), "Category");

  const shown = byStatus();

  const typeCounts = {};
  for (const e of shown) typeCounts[typeKey(e.closure_type)] = (typeCounts[typeKey(e.closure_type)] || 0) + 1;
  const present = new Set(state.events.map((e) => typeKey(e.closure_type)));
  const typeItems = TYPE_ORDER.filter((k) => present.has(k)).map((k) => ({
    key: k, label: TYPES[k].label, swatch: TYPES[k].shape, count: typeCounts[k] || 0,
  }));
  sync(typeMenu, typeItems, state.types, hd.onType);

  const catCounts = {};
  for (const e of shown) catCounts[e.event_type] = (catCounts[e.event_type] || 0) + 1;
  const seen = [...new Set(state.events.map((e) => e.event_type).filter(Boolean))];
  seen.sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  const catItems = seen.map((c) => ({ key: c, label: c, swatch: null, count: catCounts[c] || 0 }));
  sync(catMenu, catItems, state.categories, hd.onCategory);
}