import { h } from "./dom.js";
import { severityOf } from "./labels.js";

export function sevBadge(e) {
  const s = severityOf(e);
  return h("span", { class: `sev sev-${s.cls}` }, s.label);
}