// Scroll-spy for the fixed left section rail on the homepage (.section-rail in
// index.html). Highlights whichever section is currently "current": the last
// one (in page order) whose top has scrolled past a fixed reference line near
// the top of the viewport. This is deliberately not an intersection-band
// approach -- an earlier version required a section to be tall enough to span
// a thin middle band, which broke for every short section in turn (hero,
// footer, skills, education, certifications all hit it one at a time as they
// were added/edited). Tracking "last section whose top crossed the line"
// works for a section of any height, including a single short one between two
// others.
(function () {
  const rail = document.querySelector(".section-rail");
  if (!rail) return;

  const links = Array.from(rail.querySelectorAll(".rail-link"));
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

    // Sections are pushed in the same order as the rail links, which matches
    // page order, so the last one to have "activated" is current.
    //
    // A section activates at the scroll position where its top reaches the
    // reference line -- except that sections near the document end can need
    // more scroll than the page actually has. The footer CTA is the live
    // example: its top needs ~7545px of scroll but the page bottoms out at
    // ~7511px, so without the clamp it could never become active at all and
    // the previous section stayed highlighted instead. Clamping to maxScroll
    // makes any such section activate once the page is scrolled as far as it
    // goes, which is the best available answer for anything unreachable.
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

  // Clicking a rail link sets the active state immediately, independent of
  // the native anchor-scroll's timing. The scroll listener above simply
  // re-confirms the same section once the browser finishes scrolling there.
  for (const [id, link] of byId) {
    link.addEventListener("click", () => setActive(id));
  }
})();
