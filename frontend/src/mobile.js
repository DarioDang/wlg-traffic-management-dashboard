// Mobile app shell: bottom tab bar, one view at a time.
// Only has a visible effect under 760px wide (see styles.css).
(function () {
  const mq = window.matchMedia("(max-width: 760px)");
  const NS = "http://www.w3.org/2000/svg";
  const TABS = [
    { id: "map", label: "Map", d: ["M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z", "M12 8.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z"] },
    { id: "events", label: "Events", d: ["M9 6h11M9 12h11M9 18h11", "M4.5 6h.01M4.5 12h.01M4.5 18h.01"] },
    { id: "changes", label: "Changes", d: ["M3 12h4l3-8 4 16 3-8h4"] },
    { id: "insights", label: "Insights", d: ["M5 20V10M12 20V4M19 20v-7"] },
  ];

  const nav = document.createElement("nav");
  nav.className = "tabbar";
  nav.setAttribute("aria-label", "Sections");
  const buttons = {};

  TABS.forEach((t) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tab";
    b.setAttribute("aria-current", "false");
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    t.d.forEach((d) => {
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", d);
      svg.appendChild(p);
    });
    const span = document.createElement("span");
    span.textContent = t.label;
    b.append(svg, span);
    b.addEventListener("click", () => setTab(t.id));
    buttons[t.id] = b;
    nav.appendChild(b);
  });

  function mark(id) {
    document.body.dataset.tab = id;
    TABS.forEach((t) => buttons[t.id].setAttribute("aria-current", String(t.id === id)));
  }

  function setTab(id) {
    mark(id);
    window.scrollTo(0, 0);
    // The map was hidden; main.js already resizes it on "resize".
    window.dispatchEvent(new Event("resize"));
  }

  mark("map");
  document.body.appendChild(nav);

  // Tapping an event in a list jumps to the map. Capture phase so the tab is
  // visible before the map flies to the event.
  ["event-list", "routes", "timeline"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(
      "click",
      (ev) => {
        if (!mq.matches || document.body.dataset.tab === "map") return;
        if (ev.target.closest("li:not(.skeleton), button, a, [tabindex], [data-id]")) setTab("map");
      },
      true
    );
  });
})();