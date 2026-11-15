"use strict";
// Notifications that reach the owner when no page is open: a Telegram bot.
//
// The owner creates a bot with Telegram's @BotFather, starts a chat with it, and enters the bot
// token and the chat id on the AI page's "Telegram" card. The token is encrypted on the server
// and never sent back to a browser. Messages are plain text: a price alert that fired, the risk
// guard locking the day, the 3:45 PM day report — each switchable.
//
// Nothing here can trade. Telegram receives only the text of the message.

const NAME = "notify/settings.json";
const KINDS = ["alerts", "risk", "dayReport"];

class NotifyError extends Error {
  constructor(message, code = "invalid", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class Notifier {
  constructor({ docs, secrets, fetchImpl = globalThis.fetch, now = () => Date.now(), log = console }) {
    this.docs = docs;
    this.secrets = secrets;
    this.fetch = fetchImpl;
    this.now = now;
    this.log = log;
  }

  _load() {
    return this.docs.read(NAME, null) || {};
  }

  _token() {
    const d = this._load();
    if (!d.tokenEnc) return "";
    try {
      return this.secrets.decrypt(d.tokenEnc) || "";
    } catch (_) {
      return "";
    }
  }

  /** What the page may see: never the token, only a hint. */
  status() {
    const d = this._load();
    const t = this._token();
    return {
      configured: Boolean(t && d.chatId),
      tokenHint: t ? `${t.slice(0, 4)}…${t.slice(-4)}` : "",
      chatId: d.chatId || "",
      kinds: { alerts: d.kinds ? d.kinds.alerts !== false : true, risk: d.kinds ? d.kinds.risk !== false : true, dayReport: d.kinds ? d.kinds.dayReport !== false : true },
      lastSent: d.lastSent || null,
      lastError: d.lastError || "",
    };
  }

  /** Save the bot token (blank keeps the saved one), the chat id and which messages to send. */
  set({ token, chatId, kinds, remove } = {}) {
    const d = this._load();
    if (remove) {
      this.docs.write(NAME, {});
      return this.status();
    }
    if (token !== undefined && String(token).trim()) {
      const t = String(token).trim();
      // Telegram bot tokens look like 123456789:AA… (digits, a colon, then 30+ safe characters)
      if (!/^\d{5,15}:[A-Za-z0-9_-]{30,60}$/.test(t)) throw new NotifyError("That does not look like a Telegram bot token (it is digits, a colon, then a long code — from @BotFather).");
      d.tokenEnc = this.secrets.encrypt(t);
    }
    if (chatId !== undefined) {
      const c = String(chatId).trim();
      if (c && !/^-?\d{3,20}$|^@[A-Za-z0-9_]{4,40}$/.test(c)) throw new NotifyError("The chat id is a number (for a group it starts with a minus) or a @channelname.");
      d.chatId = c;
    }
    if (kinds && typeof kinds === "object") d.kinds = Object.fromEntries(KINDS.map((k) => [k, kinds[k] !== false]));
    this.docs.write(NAME, d);
    return this.status();
  }

  /** Send one message. Quietly does nothing when it is not set up, or that kind is switched off. */
  async send(text, kind = "alerts") {
    const d = this._load();
    const token = this._token();
    if (!token || !d.chatId) return { sent: false, reason: "not_configured" };
    if (KINDS.includes(kind) && d.kinds && d.kinds[kind] === false) return { sent: false, reason: "switched_off" };
    try {
      const res = await this.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: d.chatId, text: String(text).slice(0, 3900), disable_web_page_preview: true }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j || !j.ok) throw new Error((j && j.description) || `Telegram answered ${res.status}`);
      const d2 = this._load();
      d2.lastSent = new Date(this.now()).toISOString();
      d2.lastError = "";
      this.docs.write(NAME, d2);
      return { sent: true };
    } catch (err) {
      const d2 = this._load();
      d2.lastError = String(err && err.message ? err.message : err).replace(token, "…").slice(0, 200);
      this.docs.write(NAME, d2);
      this.log.log(`[notify] Telegram failed: ${d2.lastError}`);
      return { sent: false, reason: d2.lastError };
    }
  }

  async test() {
    const r = await this.send("Jai Shri Ram 🙏 — Drishti can reach you here. Price alerts, the risk guard and the 3:45 PM report will arrive in this chat.", "test");
    if (!r.sent) throw new NotifyError(r.reason === "not_configured" ? "Save the bot token and the chat id first." : `Telegram did not accept it: ${r.reason}`, "failed", 502);
    return this.status();
  }
}

function mountNotify(app, { notifier, requireSuper, limiter }) {
  const wrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      if (err instanceof NotifyError) return res.status(err.status).json({ error: err.code, message: err.message });
      res.status(500).json({ error: "notify_failed", message: "The notification settings could not be saved." });
    }
  };
  app.get("/api/admin/notify", requireSuper, wrap(async () => notifier.status()));
  app.put("/api/admin/notify", requireSuper, limiter(30, 15 * 60 * 1000), wrap(async (req) => notifier.set(req.body || {})));
  app.post("/api/admin/notify/test", requireSuper, limiter(10, 10 * 60 * 1000), wrap(async () => notifier.test()));
}

module.exports = { Notifier, NotifyError, mountNotify };
