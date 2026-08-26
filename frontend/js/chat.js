// Talks to the /api/chat Lambda (see backend/app/main.py) behind CloudFront's
// /api/* behavior (see infra/infra/site_stack.py). When that endpoint is
// unreachable -- e.g. running the static site locally with no backend -- it
// falls back to a small keyword-matched local simulator so the widget still
// demos end to end.
//
// Wrapped in an IIFE so nothing leaks to window -- this file is loaded on every
// page, and top-level `const`s would collide if the script is ever evaluated
// twice (e.g. a cache-busted reload during development).
(function () {
  const API_BASE = window.CHAT_API_BASE || "/api";

  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  const toggle = document.getElementById("chat-toggle");
  const panel = document.getElementById("chat-panel");
  const log = document.getElementById("chat-log");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");

  // 404.html (and any future page) loads this script without the chat widget --
  // bail out before wiring anything rather than throwing on a null element.
  if (!(toggle && panel && log && form && input)) return;

  const widget = document.getElementById("chat-widget");

  // Mirror of the backend's input cap (see backend/app/main.py).
  input.maxLength = 1000;

  // Conversation history for the current tab. Sent with each request so the
  // model sees the running conversation, and kept in sessionStorage so the
  // thread survives navigating between pages (but not closing the tab --
  // that's the retention promise privacy.html makes).
  const STORAGE_KEY = "revawiki-chat-v1";
  const MAX_STORED_TURNS = 40;
  let history = [];
  try {
    history = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(history)) history = [];
  } catch {
    history = [];
  }

  function persistHistory() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-MAX_STORED_TURNS)));
    } catch {
      /* storage full or blocked -- the chat still works, it just won't persist */
    }
  }

  function recordTurn(role, content) {
    history.push({ role, content });
    if (history.length > MAX_STORED_TURNS) history = history.slice(-MAX_STORED_TURNS);
    persistHistory();
  }

  // Cost guard, cooldown-style: every CAP_WINDOW_TURNS API-answered messages
  // trigger a short local-only "catching my breath" pause instead of a hard
  // stop. Feels like a personality quirk, works like a rate limit -- and the
  // lock releases itself after CAP_COOLDOWN_MS, so the conversation can
  // always continue.
  const CAP_WINDOW_TURNS = 7;
  const CAP_COOLDOWN_MS = 90 * 1000;
  const CAP_UNTIL_KEY = "revawiki-chat-cap-until";
  const CAP_COUNT_KEY = "revawiki-chat-cap-count";

  const COOLDOWN_REPLIES = [
    "Whew, I need to catch my breath for a minute 😮‍💨 Ask me again shortly, or reach the real Reva below.",
    "My circuits need a quick coffee break ☕ Try me again in a minute or two!",
    "Recharging my brain cells real quick 🔋 Back in a bit, or Reva himself is one click away.",
    "Taking a tiny breather 🧘 Ask me again in a minute, promise I'll be fresh.",
    "Even the AI me needs a stretch break sometimes 🤸 Give me a minute or two!",
    "Brb, defragmenting my thoughts 💾 Try again shortly, or ping the real one below.",
    "I talk a lot, huh 😅 Short pause for me, back in a minute or two.",
    "Cooling my GPUs 🌬️ One minute and I'm all yours again.",
    "Quick pit stop 🏎️ Refueling, back before you know it.",
    "The hamster powering me needs water 🐹 Give it a minute!",
    "Buffering... just kidding, resting 😴 Try me again in a bit.",
    "Reva says I should pace myself 😄 One or two minutes and we continue!",
  ];

  function capState() {
    let until = 0;
    let count = 0;
    try {
      until = Number(sessionStorage.getItem(CAP_UNTIL_KEY)) || 0;
      count = Number(sessionStorage.getItem(CAP_COUNT_KEY)) || 0;
    } catch {
      /* storage blocked -- treat as uncapped */
    }
    return { until, count };
  }

  function capWrite(until, count) {
    try {
      sessionStorage.setItem(CAP_UNTIL_KEY, String(until));
      sessionStorage.setItem(CAP_COUNT_KEY, String(count));
    } catch {
      /* fine */
    }
  }

  function cooldownReply() {
    return COOLDOWN_REPLIES[Math.floor(Math.random() * COOLDOWN_REPLIES.length)];
  }

  // The bot opens the conversation. Rendered as a normal bot bubble, but
  // local-only: it never goes to the API and isn't part of history.
  const GREETING =
    "Hey, you found the AI me 👋 Trained on everything Reva has built and broken. Ask about the work, the projects, or how it all started.";

  // Chat-grade rich rendering for bot bubbles: bold, italic, strikethrough,
  // inline code, markdown links, and bare URLs. Everything is HTML-escaped
  // first; only markup WE generate goes in. Code spans and link URLs are
  // pulled out as placeholders so the emphasis rules can't mangle them.
  function renderRich(text) {
    const slots = [];
    const stash = (html) => `\u0000${slots.push(html) - 1}\u0000`;

    const linkFor = (url, label) => {
      let href = url;
      let external = true;
      try {
        const parsed = new URL(url);
        if (parsed.hostname === "revawiki.io" || parsed.hostname === "www.revawiki.io") {
          href = parsed.pathname + parsed.hash; // same-tab internal link
          external = false;
        }
      } catch {
        /* not a parseable URL -- link it as-is */
      }
      const attrs = external ? ' target="_blank" rel="noopener"' : "";
      // Icon telegraphs behavior: chain = same-tab site page, arrow = new tab.
      const icon = external ? " ↗" : " 🔗";
      return `<a href="${href}"${attrs}>${label}${icon}</a>`;
    };

    let html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // 1. `inline code` -- protected verbatim.
    html = html.replace(/`([^`\n]+)`/g, (_, code) => stash(`<code>${code}</code>`));
    // 2. [label](url) markdown links -- keep the label.
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) =>
      stash(linkFor(url, label))
    );
    // 3. Bare URLs -- shortened to "link".
    html = html.replace(/https?:\/\/[^\s<)]+/g, (raw) => {
      const url = raw.replace(/[.,;:!?]+$/, "");
      const trail = raw.slice(url.length);
      return stash(linkFor(url, "link")) + trail;
    });
    // 4. Emphasis -- bold before single-asterisk italic.
    html = html
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
      .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g, "$1<em>$2</em>")
      .replace(/~~([^~\n]+)~~/g, "<del>$1</del>");

    // 5. Restore protected spans.
    return html.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
  }

  // Quick-ask chips, always visible between the log and the input -- the
  // classic things people ask. Short labels with icons; clicking one submits
  // the full question. (Contact intentionally absent: the direct-contact CTA
  // appears when the bot can't help, which is when contact matters.)
  const STARTERS = [
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z"></path><path d="M19 3v4"></path><path d="M17 5h4"></path></svg>',
      label: "AI Experience",
      q: "Tell me about your AI and AIOps experience",
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"></path><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"></path></svg>',
      label: "Top Projects",
      q: "What are your top projects?",
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
      label: "Why hire him?",
      q: "Why should someone hire you?",
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>',
      label: "His Story",
      q: "What's your story? Where did you start?",
    },
  ];

  // Local fallback "brain": keyword-matched canned answers in Reva's voice, so
  // the widget still responds when the real API isn't reachable. Order matters
  // -- first matching entry wins; the last entry is the catch-all.
  const LOCAL_REPLIES = [
    {
      match: ["proud", "best", "biggest", "favourite", "favorite", "achievement"],
      reply:
        "The Unified L1 Copilot Platform at Tech Mahindra. It pulls monitoring, ITSM, docs and automation into one AIOps engine with a human approval gate, and it cut detection and resolution times several times over. There's a full case study under Projects.",
    },
    {
      match: ["do", "role", "job", "work", "aiops", "devops"],
      reply:
        "Right now I direct AIOps R&D for Indonesia's largest telco cloud operation at Tech Mahindra. Broadly: I build automation so engineers spend less time firefighting and more time building. Cloud infrastructure, IaC, observability, and lately agentic AI.",
    },
    {
      match: ["background", "story", "who", "about", "history", "start", "journey"],
      reply:
        "I started in a small village in Bogor, went the vocational-school route into computer networks, and worked my way up through system administration, DevOps, and now AIOps. There's a longer, more honest version on the Story page.",
    },
    {
      match: ["contact", "reach", "email", "hire", "talk", "touch", "connect"],
      contact: true,
      reply:
        "Easiest is email (reva.wiki@gmail.com) or LinkedIn (linkedin.com/in/revawiki). If you'd rather chat, my WhatsApp is on the homepage under Let's talk.",
    },
    {
      match: ["skill", "stack", "tech", "tool", "language", "aws"],
      reply:
        "Mostly AWS, Terraform, Kubernetes, CI/CD, and observability stacks, with Python as my go-to language. More recently: RAG, MCP servers, and human-in-the-loop agentic systems. I try not to marry any one tool though.",
    },
    {
      match: ["session", "talk", "speak", "community", "event"],
      reply:
        "I speak at community events when I can, most recently AWS Community Day Indonesia on the AWS API MCP Server. The Sessions page has the recaps.",
    },
    {
      match: [],
      deflected: true,
      reply:
        "Good question. I'm a simplified local version of Reva's assistant, so I'm best on the basics: what he does, his background, his projects, and how to reach him. Try one of those, or email reva.wiki@gmail.com for anything specific.",
    },
  ];

  function localReply(message) {
    const q = message.toLowerCase();
    for (const entry of LOCAL_REPLIES) {
      if (entry.match.length === 0) return entry;
      if (entry.match.some((kw) => q.includes(kw))) return entry;
    }
    return LOCAL_REPLIES[LOCAL_REPLIES.length - 1];
  }

  // .is-open drives the launcher's avatar -> close-icon swap in style.css,
  // so the class has to live on the widget, not just the panel.
  function setOpen(open) {
    panel.classList.toggle("hidden", !open);
    widget?.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close chat" : "Ask me anything");
    if (open) {
      restoreLogIfEmpty();
      input.focus();
    }
  }

  // After navigating to another page the log DOM starts empty even though the
  // conversation continues -- re-render the greeting and stored turns once,
  // on first open. The greeting always leads, like a real chat thread.
  function restoreLogIfEmpty() {
    if (hasMessages()) return;
    appendMessage("bot", GREETING);
    for (const turn of history) {
      appendMessage(turn.role === "user" ? "user" : "bot", turn.content);
    }
  }

  function hasMessages() {
    return log.querySelector(".chat-msg") !== null;
  }

  // The quick-ask strip lives OUTSIDE the scrolling log, pinned between it
  // and the input, so the classic questions are always one tap away. It can
  // be minimized (chevron in its header); the choice sticks for the tab.
  const CHIPS_COLLAPSED_KEY = "revawiki-chat-chips-collapsed";

  function buildQuickStrip() {
    const wrap = document.createElement("div");
    wrap.className = "chat-starters";

    const bar = document.createElement("button");
    bar.type = "button";
    bar.className = "chat-starters-bar";
    bar.setAttribute("aria-label", "Toggle quick questions");
    bar.innerHTML =
      '<span>Quick questions</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>';

    const chips = document.createElement("div");
    chips.className = "chat-starters-chips";
    for (const starter of STARTERS) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chat-starter";
      chip.innerHTML = starter.icon;
      chip.appendChild(document.createTextNode(starter.label));
      chip.addEventListener("click", () => send(starter.q));
      chips.appendChild(chip);
    }

    function setCollapsed(collapsed) {
      wrap.classList.toggle("collapsed", collapsed);
      bar.setAttribute("aria-expanded", String(!collapsed));
      try {
        sessionStorage.setItem(CHIPS_COLLAPSED_KEY, collapsed ? "1" : "0");
      } catch {
        /* fine -- just won't persist */
      }
    }
    bar.addEventListener("click", () =>
      setCollapsed(!wrap.classList.contains("collapsed"))
    );

    wrap.appendChild(bar);
    wrap.appendChild(chips);
    log.insertAdjacentElement("afterend", wrap);

    let startCollapsed = false;
    try {
      startCollapsed = sessionStorage.getItem(CHIPS_COLLAPSED_KEY) === "1";
    } catch {
      /* default expanded */
    }
    setCollapsed(startCollapsed);
  }
  buildQuickStrip();

  // Direct-contact CTA. Two triggers: `contact` (hiring/collab intent --
  // render immediately) and `deflected` twice in a row (out-of-scope asks,
  // or questions with no answer).
  let deflectionStreak = 0;

  function maybeRenderCta(deflected, contact) {
    if (contact) {
      renderCta();
      deflectionStreak = 0;
      return;
    }
    if (!deflected) {
      deflectionStreak = 0;
      return;
    }
    deflectionStreak += 1;
    if (deflectionStreak >= 2) renderCta();
  }

  function renderCta() {
    // Re-offer the CTA after every further trigger, but never stack two
    // cards back to back.
    if (log.lastElementChild?.classList.contains("chat-cta")) return;
    log.querySelector(".chat-cta")?.remove();
    const card = document.createElement("div");
    card.className = "chat-cta";
    const title = document.createElement("p");
    title.textContent = "Want to talk directly?";
    const link = document.createElement("a");
    link.href = "mailto:reva.wiki@gmail.com";
    link.className = "chat-cta-btn";
    link.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>reva.wiki@gmail.com';
    card.appendChild(title);
    card.appendChild(link);
    log.appendChild(card);
    log.scrollTop = log.scrollHeight;
  }

  setOpen(false);

  toggle.addEventListener("click", () => setOpen(panel.classList.contains("hidden")));

  const askMeBtn = document.getElementById("ask-me-btn");
  askMeBtn?.addEventListener("click", () => setOpen(true));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.classList.contains("hidden")) setOpen(false);
  });

  function appendMessage(role, text) {
    const el = document.createElement("div");
    el.className = `chat-msg chat-${role}`;
    if (role === "bot") {
      // Bot replies may carry **bold** and URLs; renderRich escapes the
      // text before adding any markup, so nothing from the model executes.
      el.innerHTML = renderRich(text);
    } else {
      el.textContent = text;
    }
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function appendTyping() {
    const el = document.createElement("div");
    el.className = "chat-msg chat-bot chat-typing";
    el.innerHTML = "<span></span><span></span><span></span>";
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  async function send(message) {
    const text = message.trim();
    if (!text) return;

    appendMessage("user", text);
    input.value = "";

    // Cooldown gate: no API call while resting; a fresh window opens once
    // the cooldown expires.
    const now = Date.now();
    const cap = capState();
    if (now < cap.until || cap.count >= CAP_WINDOW_TURNS) {
      if (cap.count >= CAP_WINDOW_TURNS) {
        // Window just filled -- start the cooldown clock, reset the window.
        capWrite(now + CAP_COOLDOWN_MS, 0);
      }
      const reply = cooldownReply();
      appendMessage("bot", reply);
      recordTurn("user", text);
      recordTurn("assistant", reply);
      renderCta();
      return;
    }
    capWrite(cap.until, cap.count + 1);

    const typing = appendTyping();

    // Snapshot before recording the new turn: the backend expects `history`
    // to be the turns BEFORE `message` (it appends message itself).
    const priorTurns = history.slice(-20);

    let res;
    try {
      res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: priorTurns }),
      });
    } catch (err) {
      // Network-level failure: no backend at all (e.g. static-only preview).
      // Degrade to the built-in simulator instead of showing an error, with a
      // tiny delay so the typing indicator reads as a real reply.
      await new Promise((r) => setTimeout(r, 450));
      typing.remove();
      const entry = localReply(text);
      appendMessage("bot", entry.reply);
      recordTurn("user", text);
      recordTurn("assistant", entry.reply);
      maybeRenderCta(Boolean(entry.deflected), Boolean(entry.contact));
      return;
    }

    typing.remove();

    if (!res.ok) {
      // The backend exists but couldn't answer -- surface its message rather
      // than silently pretending with the simulator.
      let detail = "I'm having trouble answering right now. Try again in a moment, or email reva.wiki@gmail.com.";
      try {
        const err = await res.json();
        if (typeof err.detail === "string") detail = err.detail;
      } catch {
        /* non-JSON error body -- keep the default message */
      }
      appendMessage("bot", detail);
      return;
    }

    const data = await res.json();
    appendMessage("bot", data.reply);
    recordTurn("user", text);
    recordTurn("assistant", data.reply);
    maybeRenderCta(Boolean(data.deflected), Boolean(data.contact));
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    send(input.value);
  });
})();
