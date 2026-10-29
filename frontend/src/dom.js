// Tiny DOM builder. Everything goes through textContent / text nodes,
// so text that came from the API can never inject markup.
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const $ = (id) => document.getElementById(id);

export function clear(el) {
  el.replaceChildren();
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

// Build an inline SVG from a list of [tag, attrs] pairs. Static, trusted markup only.
export function svg(viewBox, shapes, props = {}) {
  const el = document.createElementNS(SVG_NS, "svg");
  el.setAttribute("viewBox", viewBox);
  el.setAttribute("aria-hidden", "true");
  for (const [k, v] of Object.entries(props)) el.setAttribute(k, v);
  for (const [tag, attrs] of shapes) {
    const s = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
    el.append(s);
  }
  return el;
}

// Small status icons so state never relies on colour alone.
export const ICONS = {
  check:   () => svg("0 0 16 16", [["path", { d: "M3 8.5l3.2 3.2L13 4.8", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" }]], { class: "icon" }),
  warn:    () => svg("0 0 16 16", [["path", { d: "M8 2.2l6.3 11H1.7z", fill: "none", stroke: "currentColor", "stroke-width": "1.6", "stroke-linejoin": "round" }], ["path", { d: "M8 6.6v3.2", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round" }], ["circle", { cx: "8", cy: "11.6", r: ".9", fill: "currentColor" }]], { class: "icon" }),
  cross:   () => svg("0 0 16 16", [["path", { d: "M4 4l8 8M12 4l-8 8", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round" }]], { class: "icon" }),
  clock:   () => svg("0 0 16 16", [["circle", { cx: "8", cy: "8", r: "6", fill: "none", stroke: "currentColor", "stroke-width": "1.6" }], ["path", { d: "M8 4.6V8l2.3 1.4", fill: "none", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round" }]], { class: "icon" }),
  refresh: () => svg("0 0 20 20", [["path", { d: "M16 10a6 6 0 1 1-1.8-4.3M16 3.5V6.2h-2.7", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round" }]], { class: "icon" }),
};
