// Text-list sidebar nav for story.html (.section-nav in story.html). Same
// active-tracking algorithm as js/section-rail.js: the active link is the
// last section (in page order) whose top has scrolled past a fixed reference
// line, clamped so a section near the end of the page can still activate
// even if the page can't scroll far enough for its natural crossing point.
// See section-rail.js for the reasoning; kept as a separate file because this
// nav is a different component (always-visible text list, not an icon dock)
// targeting different classes.
(function () {
  const nav = document.querySelector(".section-nav");
  if (!nav) return;

  const links = Array.from(nav.querySelectorAll(".section-nav-link[data-section]"));
  const byId = new Map();
  const sections = [];

  for (const link of links) {
    const id = link.dataset.section;
    const el = document.getElementById(id);
    if (!el) continue;
    byId.set(id, link);
    sections.push(el);
  }
  if (sections.length === 0) return;

  function setActive(id) {
    for (const [key, link] of byId) {
      link.classList.toggle("is-active", key === id);
    }
  }

  const REFERENCE_RATIO = 0.35; // 35% down the viewport

  function updateActive() {
    const scrollY = window.scrollY;
    const referenceY = window.innerHeight * REFERENCE_RATIO;
    const maxScroll = Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight
    );

    let current = sections[0];
    for (const s of sections) {
      const pageTop = s.getBoundingClientRect().top + scrollY;
      const activateAt = Math.min(pageTop - referenceY, maxScroll);
      if (scrollY >= activateAt - 1) {
        current = s;
      } else {
        break;
      }
    }
    if (current && current.id) setActive(current.id);
  }

  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      updateActive();
      ticking = false;
    });
  }

  updateActive(); // run once immediately -- a scroll event never fires on load
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });

  for (const [id, link] of byId) {
    link.addEventListener("click", () => setActive(id));
  }
})();
