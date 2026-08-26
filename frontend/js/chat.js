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

  // Starter prompts shown as clickable chips whenever the conversation is
  // empty. Clicking one submits it like a typed question.
  const STARTERS = [
    "What do you actually do?",
    "What are you most proud of building?",
    "What's your background?",
    "How do I get in touch?",
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
      reply:
        "Good question. I'm a simplified local version of Reva's assistant, so I'm best on the basics: what he does, his background, his projects, and how to reach him. Try one of those, or email reva.wiki@gmail.com for anything specific.",
    },
  ];

  function localReply(message) {
    const q = message.toLowerCase();
    for (const entry of LOCAL_REPLIES) {
      if (entry.match.length === 0) return entry.reply;
      if (entry.match.some((kw) => q.includes(kw))) return entry.reply;
    }
    return LOCAL_REPLIES[LOCAL_REPLIES.length - 1].reply;
  }

  // .is-open drives the launcher's avatar -> close-icon swap in style.css,
  // so the class has to live on the widget, not just the panel.
  function setOpen(open) {
    panel.classList.toggle("hidden", !open);
    widget?.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close chat" : "Ask me anything");
    if (open) {
      renderStartersIfEmpty();
      input.focus();
    }
  }

  function hasMessages() {
    return log.querySelector(".chat-msg") !== null;
  }

  function renderStartersIfEmpty() {
    if (hasMessages()) return;
    if (log.querySelector(".chat-starters")) return;
    const wrap = document.createElement("div");
    wrap.className = "chat-starters";
    const intro = document.createElement("p");
    intro.className = "chat-starters-intro";
    intro.textContent = "Not sure where to start? Try one of these:";
    wrap.appendChild(intro);
    for (const q of STARTERS) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chat-starter";
      chip.textContent = q;
      chip.addEventListener("click", () => send(q));
      wrap.appendChild(chip);
    }
    log.appendChild(wrap);
  }

  function clearStarters() {
    log.querySelector(".chat-starters")?.remove();
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
    el.textContent = text;
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

    clearStarters();
    appendMessage("user", text);
    input.value = "";

    const typing = appendTyping();

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      typing.remove();
      appendMessage("bot", data.reply);
    } catch (err) {
      // No backend reachable (e.g. local static preview) -- degrade to the
      // built-in simulator instead of showing an error, with a tiny delay so
      // the typing indicator reads as a real reply.
      await new Promise((r) => setTimeout(r, 450));
      typing.remove();
      appendMessage("bot", localReply(text));
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    send(input.value);
  });
})();
