// Talks to the /api/chat Lambda (see backend/app/main.py) behind CloudFront's
// /api/* behavior (see infra/infra/site_stack.py).
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
const hasWidget = toggle && panel && log && form && input;

if (hasWidget) {
  toggle.addEventListener("click", () => panel.classList.toggle("hidden"));

  const askMeBtn = document.getElementById("ask-me-btn");
  askMeBtn?.addEventListener("click", () => {
    panel.classList.remove("hidden");
    input.focus();
  });
}

function appendMessage(role, text) {
  const el = document.createElement("div");
  el.className = `chat-msg chat-${role}`;
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

if (hasWidget) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) return;

    appendMessage("user", message);
    input.value = "";

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      appendMessage("bot", data.reply);
    } catch (err) {
      appendMessage("bot", "Sorry, something went wrong.");
      console.error(err);
    }
  });
}
