import { fmtDate, parseWhen } from "./labels.js";

const show = (v) => {
  if (v == null || v === "") return "none";
  if (v === "Resolved") return "Cleared";
  return parseWhen(v) ? fmtDate(v) : String(v);
};

export function kindOf(item) {
  if (item.kind === "new") return { label: "New", cls: "new" };
  if (item.kind === "gone") return { label: "Cleared", cls: "gone" };
  const cleared = (item.changes || []).some((c) => c.field === "status" && c.to === "Resolved");
  return cleared ? { label: "Cleared", cls: "gone" } : { label: "Updated", cls: "upd" };
}

export function changeLine(c) {
  switch (c.field) {
    case "geometry":
      return "Mapped location changed";
    case "eventComments":
      return c.to ? `Comment updated: "${c.to}"` : "Comment removed";
    case "endDate": {
      const a = parseWhen(c.from);
      const b = parseWhen(c.to);
      if (a && b) return `End date ${b > a ? "extended" : "brought forward"}: ${show(c.from)} to ${show(c.to)}`;
      return `End date: ${show(c.from)} to ${show(c.to)}`;
    }
    default:
      return `${c.label}: ${show(c.from)} to ${show(c.to)}`;
  }
}

export function itemLines(item) {
  if (item.kind === "new") return ["First reported by NZTA"];
  if (item.kind === "gone") return ["No longer in the NZTA feed"];
  return (item.changes || []).map(changeLine);
}