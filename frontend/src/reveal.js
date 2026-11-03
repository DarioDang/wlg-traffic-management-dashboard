// Fade-up cards as they scroll into view. Runs once per card.
// Content is only hidden after this script adds "js-reveal" to <html>,
// so if JS fails the page still shows everything.
(function () {
  if (!("IntersectionObserver" in window)) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const targets = document.querySelectorAll(
    ".timeline-card, .activity-card, .trends-card, .row2 > .card, .pipeline"
  );
  if (!targets.length) return;

  document.documentElement.classList.add("js-reveal");
  targets.forEach((el) => el.classList.add("rv"));

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        io.unobserve(el);
        el.classList.add("rv-in");
        // Hand the element back to its normal styles once the animation is done.
        setTimeout(() => el.classList.remove("rv", "rv-in"), 900);
      });
    },
    { threshold: 0.06, rootMargin: "0px 0px -6% 0px" }
  );

  targets.forEach((el) => io.observe(el));
})();