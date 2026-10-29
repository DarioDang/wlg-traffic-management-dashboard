import { h } from "./dom.js";

let tip;

function ensure() {
  if (!tip) {
    tip = h("div", { class: "tip", role: "tooltip", hidden: true });
    document.body.append(tip);
  }
  return tip;
}

function fill(content) {
  const t = ensure();
  t.replaceChildren(
    h("strong", { class: "tip-title" }, content.title),
    ...(content.rows || []).map(([k, v]) =>
      h("div", { class: "tip-row" }, h("span", { class: "tip-val" }, v), h("span", { class: "tip-key" }, k))
    )
  );
  return t;
}

function place(t, x, y) {
  t.hidden = false;
  const pad = 12;
  const w = t.offsetWidth;
  const hgt = t.offsetHeight;
  let left = x + 14;
  let top = y + 16;
  if (left + w > window.innerWidth - pad) left = x - w - 14;
  if (top + hgt > window.innerHeight - pad) top = y - hgt - 14;
  t.style.left = `${Math.max(pad, left)}px`;
  t.style.top = `${Math.max(pad, top)}px`;
}

// build() runs on every hover, so the content always reflects current data.
export function attachTip(el, build) {
  const show = (x, y) => place(fill(build()), x, y);
  el.addEventListener("pointerenter", (ev) => show(ev.clientX, ev.clientY));
  el.addEventListener("pointermove", (ev) => place(ensure(), ev.clientX, ev.clientY));
  el.addEventListener("pointerleave", hideTip);
  el.addEventListener("focus", () => {
    const r = el.getBoundingClientRect();
    show(r.left + r.width / 2, r.top);
  });
  el.addEventListener("blur", hideTip);
}

export function hideTip() {
  if (tip) tip.hidden = true;
}
