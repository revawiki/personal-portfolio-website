// Types/deletes through the role list in the hero subline (#role-typer),
// looping forever. The animated span is aria-hidden -- frontend/index.html
// carries a static .sr-only list of the same roles for screen readers, so
// this loop is purely decorative and never announced.
//
// Each role also lights up its matching domain badge (.badge[data-domain])
// via .badge-active, for the whole time that role is on screen (typing
// through deleting), not just once fully typed.
(function () {
  const el = document.getElementById("role-typer");
  if (!el) return;

  const roles = [
    { text: "AIOps Builder", domain: "aiops" },
    { text: "Cloud Specialist", domain: "cloud" },
    { text: "DevOps Expert", domain: "devops" },
  ];
  const TYPE_MS = 55;
  const DELETE_MS = 30;
  const HOLD_MS = 2200;

  const badges = Array.from(document.querySelectorAll(".badge[data-domain]"));
  function setActiveDomain(domain) {
    badges.forEach((b) => b.classList.toggle("badge-active", b.dataset.domain === domain));
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.textContent = roles[0].text;
    setActiveDomain(roles[0].domain);
    return;
  }

  let roleIndex = 0;
  let charIndex = 0;
  let deleting = false;

  setActiveDomain(roles[roleIndex].domain);

  function step() {
    const word = roles[roleIndex].text;
    el.textContent = word.slice(0, charIndex);

    if (!deleting && charIndex === word.length) {
      setTimeout(() => {
        deleting = true;
        step();
      }, HOLD_MS);
      return;
    }

    if (deleting && charIndex === 0) {
      deleting = false;
      roleIndex = (roleIndex + 1) % roles.length;
      setActiveDomain(roles[roleIndex].domain);
      setTimeout(step, TYPE_MS);
      return;
    }

    charIndex += deleting ? -1 : 1;
    setTimeout(step, deleting ? DELETE_MS : TYPE_MS);
  }

  step();
})();
