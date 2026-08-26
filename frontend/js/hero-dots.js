// Animated dot grid used behind the hero AND the footer CTA. Idle dots come
// from the site-wide CSS dot background (see body in style.css); this canvas
// only draws the "snakes" -- a handful of random walkers whose current cell
// and short trail render dark red, fading along the trail. CSS gradients and
// keyframes can't do per-cell state like that, so it's a small canvas loop.
//
// Each entry in TARGETS is a { canvas, host } selector pair; every match gets
// its own grid + snakes, all driven by one shared rAF loop.
(function () {
  const TARGETS = [
    { canvas: ".hero-canvas", host: ".hero" },
    { canvas: ".footer-canvas", host: ".site-cta" },
  ];

  const SPACING = 32; // matches the site-wide dot background's 32px tile in style.css
  const SNAKE_RADIUS = 2;
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

  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  function createField(canvas, host) {
    const ctx = canvas.getContext("2d");
    const field = { canvas, host, ctx, cols: 1, rows: 1, snakes: [], offsetX: 0, offsetY: 0 };

    field.resize = function () {
      const rect = host.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = rect.width + "px";
      canvas.style.height = rect.height + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      field.cols = Math.max(1, Math.floor(rect.width / SPACING));
      field.rows = Math.max(1, Math.floor(rect.height / SPACING));

      // The site-wide CSS dot background tiles from the document origin, and
      // radial-gradient() centers each dot in its own 32px tile -- so static
      // dots sit at document coords (16 + 32n). This canvas draws in host-local
      // coords, so unless the host happens to start on a tile boundary (the
      // hero does, at 0,0; the footer does not) the two grids drift apart.
      // Cancel the host's own offset into the tile so local (16 + 32n) lands
      // back on document (16 + 32n).
      const pageX = rect.left + window.scrollX;
      const pageY = rect.top + window.scrollY;
      field.offsetX = ((-pageX % SPACING) + SPACING) % SPACING;
      field.offsetY = ((-pageY % SPACING) + SPACING) % SPACING;

      if (field.snakes.length === 0) {
        for (let i = 0; i < SNAKE_COUNT; i++) {
          field.snakes.push({
            x: Math.floor(Math.random() * field.cols),
            y: Math.floor(Math.random() * field.rows),
            dir: randomDir(),
            trail: [],
          });
        }
      } else {
        field.snakes.forEach((s) => {
          s.x = Math.min(s.x, field.cols - 1);
          s.y = Math.min(s.y, field.rows - 1);
        });
      }
    };

    field.step = function () {
      for (const s of field.snakes) {
        if (Math.random() < TURN_CHANCE) s.dir = randomDir(s.dir);
        s.x += s.dir[0];
        s.y += s.dir[1];

        if (s.x < 0) s.x = field.cols - 1;
        if (s.x >= field.cols) s.x = 0;
        if (s.y < 0) s.y = field.rows - 1;
        if (s.y >= field.rows) s.y = 0;

        s.trail.unshift({ x: s.x, y: s.y });
        if (s.trail.length > TRAIL_LENGTH) s.trail.pop();
      }
    };

    field.draw = function () {
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.clearRect(0, 0, w, h);

      for (const s of field.snakes) {
        s.trail.forEach((pos, i) => {
          const brightness = (1 - i / TRAIL_LENGTH) * SNAKE_MAX_OPACITY;
          ctx.fillStyle = `rgba(149, 7, 6, ${brightness})`;
          ctx.beginPath();
          ctx.arc(
            pos.x * SPACING + SPACING / 2 + field.offsetX,
            pos.y * SPACING + SPACING / 2 + field.offsetY,
            SNAKE_RADIUS,
            0,
            Math.PI * 2
          );
          ctx.fill();
        });
      }
    };

    field.resize();
    return field;
  }

  const fields = [];
  for (const t of TARGETS) {
    const canvas = document.querySelector(t.canvas);
    const host = document.querySelector(t.host);
    if (canvas && host) fields.push(createField(canvas, host));
  }
  if (fields.length === 0) return;

  window.addEventListener("resize", () => fields.forEach((f) => f.resize()));

  // the footer's page position -- and so its tile offset -- depends on every
  // section above it having settled, which may still be pending when this runs
  window.addEventListener("load", () => fields.forEach((f) => f.resize()));

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    fields.forEach((f) => f.draw());
    return;
  }

  let last = 0;
  function loop(ts) {
    if (ts - last >= TICK_MS) {
      fields.forEach((f) => {
        f.step();
        f.draw();
      });
      last = ts;
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
