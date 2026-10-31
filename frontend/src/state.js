import { typeKey } from "./labels.js";

export const state = {
  events: [],
  stats: null,
  health: null,
  status: "all",          // all | active | scheduled | cleared
  types: new Set(),       // empty set = every type
  categories: new Set(),  // empty set = every category
  selectedId: null,
  hoverId: null,
};

const STATUS_VALUE = { active: "Active", scheduled: "Scheduled", cleared: "Resolved" };

export function matchesStatus(e, status = state.status) {
  return status === "all" || e.status === STATUS_VALUE[status];
}

// Events passing the status filter only (used for the type chip counts).
export function byStatus() {
  return state.events.filter((e) => matchesStatus(e));
}

// Events passing every filter. All panels render from this one list.
export function visible() {
    return byStatus().filter(
    (e) =>
      (state.types.size === 0 || state.types.has(typeKey(e.closure_type))) &&
      (state.categories.size === 0 || state.categories.has(e.event_type))
  );
}

export function filtersActive() {
    return state.status !== "all" || state.types.size > 0 || state.categories.size > 0;
}
