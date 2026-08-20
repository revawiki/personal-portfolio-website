// Animated dot grid behind the hero (see .hero-canvas in index.html and
// .hero::before's static red/black gradient in style.css, which this layers
// on top of). Idle dots are grey. A handful of "snakes" random-walk across
// the grid; the cells they're currently on/just left render dark red, fading
// to grey along a short trail -- CSS gradients/keyframes can't do per-cell
// state like this, so it's a small canvas loop instead.
(function () {
  const canvas = document.querySelector(".hero-canvas");
  const hero = document.querySelector(".hero");
  if (!canvas || !hero) return;

  const ctx = canvas.getContext("2d");
  const SPACING = 28;
  const DOT_RADIUS = 1.4;
  const SNAKE_RADIUS = 2;
  const GREY = "rgba(154, 154, 154, 0.1)";
  const SNAKE_MAX_OPACITY = 0.45;
  const TICK_MS = 320;
  const SNAKE_COUNT = 5;
  const TRAIL_LENGTH = 6;
  const TURN_CHANCE = 0.25;

  const DIRS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  function randomDir(exclude) {
    let options = DIRS;
    if (exclude) {
      options = DIRS.filter((d) => !(d[0] === -exclude[0] && d[1] === -exclude[1]));
    }
    return options[Math.floor(Math.random() * options.length)];
  }

  let cols = 1;
  let rows = 1;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  function makeSnake() {
    return {
      x: Math.floor(Math.random() * cols),
      y: Math.floor(Math.random() * rows),
      dir: randomDir(),
      trail: [],
    };
  }

  const snakes = [];

  function resize() {
    const rect = hero.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.max(1, Math.floor(rect.width / SPACING));
    rows = Math.max(1, Math.floor(rect.height / SPACING));

    if (snakes.length === 0) {
      for (let i = 0; i < SNAKE_COUNT; i++) snakes.push(makeSnake());
    } else {
      snakes.forEach((s) => {
        s.x = Math.min(s.x, cols - 1);
        s.y = Math.min(s.y, rows - 1);
      });
    }
  }

  function step() {
    for (const s of snakes) {
      if (Math.random() < TURN_CHANCE) {
        s.dir = randomDir(s.dir);
      }
      s.x += s.dir[0];
      s.y += s.dir[1];

      if (s.x < 0) s.x = cols - 1;
      if (s.x >= cols) s.x = 0;
      if (s.y < 0) s.y = rows - 1;
      if (s.y >= rows) s.y = 0;

      s.trail.unshift({ x: s.x, y: s.y });
      if (s.trail.length > TRAIL_LENGTH) s.trail.pop();
    }
  }

  function draw() {
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = GREY;
    for (let cx = 0; cx < cols; cx++) {
      for (let cy = 0; cy < rows; cy++) {
        ctx.beginPath();
        ctx.arc(cx * SPACING + SPACING / 2, cy * SPACING + SPACING / 2, DOT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (const s of snakes) {
      s.trail.forEach((pos, i) => {
        const brightness = (1 - i / TRAIL_LENGTH) * SNAKE_MAX_OPACITY;
        ctx.fillStyle = `rgba(149, 7, 6, ${brightness})`;
        ctx.beginPath();
        ctx.arc(pos.x * SPACING + SPACING / 2, pos.y * SPACING + SPACING / 2, SNAKE_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }

  resize();
  window.addEventListener("resize", resize);

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    draw();
    return;
  }

  let last = 0;
  function loop(ts) {
    if (ts - last >= TICK_MS) {
      step();
      draw();
      last = ts;
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
