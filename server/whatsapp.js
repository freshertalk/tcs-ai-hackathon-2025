"use strict";
const { BRAND } = require("./brand");
// WhatsApp Trading — like WhatsApp banking, for this desk. It runs on the server, so it works with
// the laptop closed and no page open.
//
// Uses Meta's OFFICIAL WhatsApp Business Cloud API (unofficial WhatsApp-web bots break WhatsApp's
// terms and get numbers banned). The owner sets up a WhatsApp Business app, enters the phone-number
// id, the access token, the app secret, a verify token, their own WhatsApp number and a trading PIN
// on the /me card; secrets are encrypted. Meta calls /api/whatsapp/webhook with every message:
//   - the signature (X-Hub-Signature-256, HMAC of the body with the app secret) must match,
//   - only the owner's number is answered; everything else is ignored.
//
// What it does when switched on:
//   - Updates every N minutes in market hours while positions are open: each position's price, P&L,
//     volume, buyers vs sellers, RSI, VWAP, the live call — and the default AI model's advice.
//   - A morning note at 9:20 and a closing note at 3:35; price alerts, the risk-guard lock and the
//     3:45 PM report (through the notifier).
//   - Commands (HELP lists them): STATUS, POS, PNL, QUOTE SBIN, CALL SBIN, ASK …, ALERTS, ALERT SBIN 800,
//     UPDATES ON/OFF, EVERY 15, and — only when "Allow trading from WhatsApp" is on — TRADING ON/OFF,
//     BUY / SELL, EXIT SBIN, EXIT ALL.
//   - Anything that moves money (an order, an exit, TRADING ON) is never done on the first message: the
//     reply states it and asks "YES <code> <PIN>" within 2 minutes. Three wrong PINs lock WhatsApp
//     trading for 30 minutes. Orders then pass every check of the desk (the switch, limits, risk guard,
//     duplicate guard) and are audited as "whatsapp".
//
// WhatsApp only allows free-form messages within 24 hours of the owner's last message; send HI each
// morning (or set an approved template name, used outside that window).

const crypto = require("node:crypto");

const NAME = "whatsapp/settings.json";
const GRAPH = "https://graph.facebook.com/v21.0";
const IST = 5.5 * 3600 * 1000;
const WINDOW_MS = 24 * 3600 * 1000;
const CONFIRM_MS = 2 * 60 * 1000;

class WhatsAppError extends Error {
  constructor(message, code = "invalid", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const ist = (ms) => {
  const d = new Date(ms + IST);
  return { date: d.toISOString().slice(0, 10), mins: d.getUTCHours() * 60 + d.getUTCMinutes(), dow: d.getUTCDay(), hhmm: d.toISOString().slice(11, 16) };
};
const marketOpen = (ms) => {
  const t = ist(ms);
  return t.dow >= 1 && t.dow <= 5 && t.mins >= 555 && t.mins < 930;
};
const inr = (x) => `${x < 0 ? "−" : x > 0 ? "+" : ""}₹${Math.abs(Math.round(Number(x) || 0)).toLocaleString("en-IN")}`;
const px = (x) => (Number.isFinite(Number(x)) ? `₹${Number(x).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—");

/** TradeAI writes Markdown for its page; WhatsApp knows only *bold*, _italic_ and plain lines. */
function toWhatsApp(md) {
  const out = [];
  for (const raw of String(md || "").split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)) continue; // a table's |---| row
    if (/^\s*\|.*\|\s*$/.test(line)) {
      out.push(`• ${line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).filter(Boolean).join(" · ")}`);
      continue;
    }
    const h = line.match(/^\s*#{1,6}\s+(.*)$/);
    out.push(h ? `*${h[1].replace(/\*\*/g, "")}*` : line.replace(/^\s*[-*]\s+/, "• "));
  }
  return out.join("\n").replace(/\*\*([^*]+)\*\*/g, "*$1*").replace(/\n{3,}/g, "\n\n");
}
const big = (v) => (!Number.isFinite(v) ? "—" : v >= 1e7 ? `${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(1)} L` : String(v));
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString("hex");

const HELP = `🙏 Jai Shri Ram — ${BRAND.name} on WhatsApp
*Ask*
STATUS — switch, risk guard, today's P&L
POS — every open position in detail
PNL — today · PNL YESTERDAY · PNL WEEK · PNL MONTH
QUOTE SBIN — price, RSI, VWAP, buyers/sellers, live call
CALL SBIN — the desk's live call and plan
ASK <question> — TradeAI answers (the default AI model)
ALERTS — waiting price alerts · ALERT SBIN 800 · ALERT SBIN BELOW 780
*Updates*
UPDATES ON · UPDATES OFF · EVERY 15 (minutes)
*Trading* (only if allowed on the /me card; each needs YES <code> <PIN>)
TRADING ON · TRADING OFF
BUY 10 SBIN · SELL 5 INFY @ 1500 · BUY 10 SBIN CNC
EXIT SBIN · EXIT ALL
NO — cancel what is waiting`;

class WhatsAppService {
  constructor({ docs, secrets, fetchImpl = globalThis.fetch, now = () => Date.now(), log = console, market, trading, ai, analysis }) {
    Object.assign(this, { docs, secrets, fetch: fetchImpl, now, log, market, trading, ai, analysis });
    this.timer = null;
    this.busy = false;
    this.seen = [];
  }

  /* ------------------------------------------------------------------------ settings */
  _load() {
    return this.docs.read(NAME, null) || {};
  }
  _save(d) {
    this.docs.write(NAME, d);
  }
  _secret(d, k) {
    try {
      return d[k] ? this.secrets.decrypt(d[k]) || "" : "";
    } catch (_) {
      return "";
    }
  }

  status() {
    const d = this._load();
    const token = this._secret(d, "tokenEnc");
    const configured = Boolean(d.phoneNumberId && token && d.owner && d.appSecretEnc && d.verifyTokenEnc);
    return {
      configured,
      enabled: Boolean(d.enabled),
      allowTrading: Boolean(d.allowTrading),
      pinSet: Boolean(d.pinHash),
      phoneNumberId: d.phoneNumberId || "",
      owner: d.owner ? `+${d.owner.slice(0, 2)}…${d.owner.slice(-3)}` : "",
      tokenHint: token ? `${token.slice(0, 4)}…${token.slice(-4)}` : "",
      appSecretSet: Boolean(d.appSecretEnc),
      verifyTokenSet: Boolean(d.verifyTokenEnc),
      template: d.template || null,
      every: d.every || 30,
      updates: d.updates !== false,
      windowOpen: Boolean(d.lastInboundAt && this.now() - Date.parse(d.lastInboundAt) < WINDOW_MS),
      lastInboundAt: d.lastInboundAt || null,
      lastSent: d.lastSent || null,
      lastReceived: d.lastReceived || null,
      lastUpdate: d.lastUpdate || null,
      lastError: d.lastError || "",
      lockedUntil: d.lockedUntil && Date.parse(d.lockedUntil) > this.now() ? d.lockedUntil : null,
    };
  }

  set(b = {}) {
    const d = this._load();
    if (b.remove) {
      this._save({});
      return this.status();
    }
    const enc = (x) => this.secrets.encrypt(String(x).trim());
    if (b.phoneNumberId !== undefined) {
      const v = String(b.phoneNumberId).trim();
      if (v && !/^\d{6,25}$/.test(v)) throw new WhatsAppError("The phone-number id is a long number from the WhatsApp app's API setup page.");
      d.phoneNumberId = v;
    }
    if (b.token && String(b.token).trim()) {
      if (!/^[A-Za-z0-9_-]{40,600}$/.test(String(b.token).trim())) throw new WhatsAppError("That does not look like a WhatsApp Cloud API access token.");
      d.tokenEnc = enc(b.token);
    }
    if (b.appSecret && String(b.appSecret).trim()) {
      if (!/^[a-f0-9]{16,64}$/i.test(String(b.appSecret).trim())) throw new WhatsAppError("The app secret is the hex code from the Meta app's Settings → Basic.");
      d.appSecretEnc = enc(b.appSecret);
    }
    if (b.verifyToken && String(b.verifyToken).trim()) {
      if (!/^[A-Za-z0-9_-]{12,80}$/.test(String(b.verifyToken).trim())) throw new WhatsAppError("The verify token is any phrase of 12–80 letters, digits, - or _ that you also type into Meta's webhook setup.");
      d.verifyTokenEnc = enc(b.verifyToken);
    }
    if (b.owner !== undefined) {
      const v = String(b.owner).replace(/[^\d]/g, "");
      if (v && !/^\d{10,15}$/.test(v)) throw new WhatsAppError("Your WhatsApp number with the country code, e.g. 919876543210.");
      d.owner = v;
    }
    if (b.pin && String(b.pin).trim()) {
      if (!/^\d{4,8}$/.test(String(b.pin).trim())) throw new WhatsAppError("The PIN is 4 to 8 digits.");
      d.pinSalt = crypto.randomBytes(12).toString("hex");
      d.pinHash = hashPin(String(b.pin).trim(), d.pinSalt);
    }
    if (b.template !== undefined) {
      const name = String((b.template && b.template.name) || "").trim();
      d.template = name ? { name: name.slice(0, 60), lang: String((b.template && b.template.lang) || "en").slice(0, 10) } : null;
    }
    if (b.every !== undefined) d.every = Math.min(120, Math.max(10, Math.round(Number(b.every) || 30)));
    if (b.allowTrading !== undefined) {
      if (b.allowTrading && !d.pinHash) throw new WhatsAppError("Set a trading PIN first.");
      d.allowTrading = Boolean(b.allowTrading);
    }
    if (b.enabled !== undefined) d.enabled = Boolean(b.enabled);
    this._save(d);
    return this.status();
  }

  /* ------------------------------------------------------------------------- sending */
  async send(text, { kind = "update" } = {}) {
    const d = this._load();
    const token = this._secret(d, "tokenEnc");
    if (!d.enabled || !token || !d.phoneNumberId || !d.owner) return { sent: false, reason: "not_configured" };
    if (kind !== "reply" && d.updates === false && kind === "update") return { sent: false, reason: "updates_off" };
    const open = d.lastInboundAt && this.now() - Date.parse(d.lastInboundAt) < WINDOW_MS;
    let body;
    if (open || kind === "reply") body = { messaging_product: "whatsapp", to: d.owner, type: "text", text: { body: String(text).slice(0, 4000), preview_url: false } };
    else if (d.template && d.template.name) {
      // outside the 24-hour window only an approved template may start the conversation
      const one = String(text).replace(/\s*\n+\s*/g, " · ").replace(/ {4,}/g, " ").slice(0, 1000);
      body = { messaging_product: "whatsapp", to: d.owner, type: "template", template: { name: d.template.name, language: { code: d.template.lang || "en" }, components: [{ type: "body", parameters: [{ type: "text", text: one }] }] } };
    } else {
      this._note({ lastError: "Not sent: WhatsApp allows messages only within 24 hours of your last message. Send HI to the bot (or set a template)." });
      return { sent: false, reason: "window_closed" };
    }
    try {
      const res = await this.fetch(`${GRAPH}/${d.phoneNumberId}/messages`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error((j && j.error && j.error.message) || `WhatsApp answered ${res.status}`);
      this._note({ lastSent: new Date(this.now()).toISOString(), lastError: "" });
      return { sent: true };
    } catch (err) {
      const msg = String(err && err.message ? err.message : err).replace(token, "…").slice(0, 200);
      this._note({ lastError: msg });
      this.log.log(`[whatsapp] send failed: ${msg}`);
      return { sent: false, reason: msg };
    }
  }

  _note(patch) {
    const d = this._load();
    Object.assign(d, patch);
    this._save(d);
  }

  async test() {
    const r = await this.send(`🙏 Jai Shri Ram — ${BRAND.name} can reach you on WhatsApp. Reply HELP for the commands.`, { kind: "reply" });
    if (!r.sent) throw new WhatsAppError(r.reason === "not_configured" ? "Fill in every field and switch it on first." : `WhatsApp did not accept it: ${r.reason}`, "failed", 502);
    return this.status();
  }

  /* ------------------------------------------------------------------------- webhook */
  /** Meta's one-time check when the webhook is saved. */
  verify(q) {
    const d = this._load();
    const want = this._secret(d, "verifyTokenEnc");
    if (q["hub.mode"] === "subscribe" && want && String(q["hub.verify_token"] || "") === want) return String(q["hub.challenge"] || "");
    return null;
  }

  /** A POST from Meta: true when the signature is right. */
  signed(raw, header) {
    const d = this._load();
    const secret = this._secret(d, "appSecretEnc");
    if (!secret || !raw || !header || !/^sha256=[a-f0-9]{64}$/.test(String(header))) return false;
    const want = Buffer.from(`sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`);
    const got = Buffer.from(String(header));
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  }

  /** The messages in a webhook body, from the owner only (each handled once). */
  async receive(body) {
    const d = this._load();
    const msgs = [];
    for (const e of (body && body.entry) || []) for (const c of e.changes || []) for (const m of (c.value && c.value.messages) || []) msgs.push(m);
    const out = [];
    for (const m of msgs) {
      if (!m || this.seen.includes(m.id)) continue;
      this.seen = [m.id, ...this.seen].slice(0, 300);
      if (!d.owner || String(m.from) !== d.owner) {
        this.log.log("[whatsapp] a message from another number was ignored");
        continue;
      }
      this._note({ lastInboundAt: new Date(this.now()).toISOString(), lastReceived: new Date(this.now()).toISOString() });
      if (!this._load().enabled) continue;
      const text = m.type === "text" && m.text ? String(m.text.body || "") : m.type === "button" && m.button ? String(m.button.text || "") : "";
      // a message from the owner's own number is the owner asking: whatever AI it needs is asked for (AI credit protection, ai/spend.js)
      const asked = () => this.handle(text);
      const reply = await (this.ai && this.ai.guard ? this.ai.guard.run({ click: true, by: "the owner, on WhatsApp", route: "WhatsApp message" }, asked) : asked()).catch((err) => `Sorry — that did not work: ${err.message}`);
      if (reply) await this.send(reply, { kind: "reply" });
      out.push({ text, reply });
    }
    return out;
  }

  /* ------------------------------------------------------------------------ commands */
  async handle(raw) {
    const text = String(raw || "").trim();
    const T = text.toUpperCase().replace(/\s+/g, " ");
    if (!T) return "Reply HELP for the commands.";
    if (/^(HI|HELLO|HEY|START|MENU|HELP|NAMASTE|JAI SHRI RAM|RAM RAM)\b/.test(T)) return HELP;
    if (/^(NO|CANCEL)$/.test(T)) {
      this._note({ pending: null });
      return "Cancelled. Nothing was sent.";
    }
    if (/^YES\b/.test(T)) return this._confirm(T);
    if (T === "STATUS") return this._status();
    if (/^(POS|POSITIONS)$/.test(T)) return (await this.positionsText({ ai: false })) || "No open positions.";
    if (/^P&?L\b|^PNL\b/.test(T)) return this._pnl(T);
    let m = T.match(/^(?:QUOTE|Q)\s+([A-Z0-9&._-]{1,25})$/);
    if (m) return this._quote(m[1]);
    m = T.match(/^(?:CALL|ADVICE)\s+([A-Z0-9&._-]{1,25})$/);
    if (m) return this._call(m[1]);
    m = text.match(/^ask\s+([\s\S]{2,1000})$/i);
    if (m) return this._ask(m[1]);
    if (T === "ALERTS") return this._alerts();
    m = T.match(/^ALERT\s+([A-Z0-9&._-]{1,25})\s+(?:(ABOVE|BELOW|>|<)\s+)?(\d+(?:\.\d+)?)$/);
    if (m) {
      const dir = m[2] === "ABOVE" || m[2] === ">" ? "above" : m[2] === "BELOW" || m[2] === "<" ? "below" : "";
      const r = await this.market.addAlert({ symbol: m[1], price: Number(m[3]), dir }, "whatsapp");
      return `🔔 Alert set: ${r.alert.symbol} ${r.alert.dir} ${px(r.alert.price)}. The server checks it every 15 s in market hours.`;
    }
    if (T === "UPDATES ON" || T === "UPDATES OFF" || T === "STOP") {
      this._note({ updates: T === "UPDATES ON" });
      return T === "UPDATES ON" ? `Updates are on: every ${this._load().every || 30} minutes in market hours while positions are open.` : "Updates are off. Commands still work; UPDATES ON to resume.";
    }
    m = T.match(/^EVERY\s+(\d{1,3})$/);
    if (m) {
      const every = Math.min(120, Math.max(10, Number(m[1])));
      this._note({ every });
      return `Updates every ${every} minutes in market hours.`;
    }
    // trading commands
    if (/^TRADING (ON|OFF)$/.test(T) || /^(BUY|SELL|B|S)\s/.test(T) || /^EXIT\s/.test(T)) return this._trade(T);
    return `I did not understand “${text.slice(0, 60)}”. Reply HELP for the commands, or start with ASK to ask anything.`;
  }

  async _status() {
    const st = this.trading.status();
    let pnl = "—";
    let open = 0;
    let margin = "—";
    if (st.connected) {
      try {
        const { net } = await this.trading.positions();
        open = net.filter((p) => p.quantity !== 0).length;
        pnl = inr(net.reduce((s, p) => s + (Number.isFinite(p.pnl) ? p.pnl : 0), 0));
        const f = await this.trading.funds();
        if (f && f.equity) margin = inr(f.equity.net).replace("+", "");
      } catch (_) {
        /* shown as — */
      }
    }
    const lock = st.riskLock && st.riskLock.day === ist(this.now()).date ? st.riskLock : null;
    return `📊 *Status* ${ist(this.now()).hhmm} IST
Zerodha: ${st.connected ? "connected" : "not connected (log in to Kite each morning)"}
Trading: ${st.enabled ? "ON" : "OFF"} · risk guard ${st.risk && st.risk.enabled ? "on" : "off"}${lock ? ` · LOCKED: ${lock.reason}` : ""}
Today's P&L: ${pnl} · open positions: ${open} · margin left: ${margin}
WhatsApp trading: ${this._load().allowTrading ? "allowed (PIN)" : "not allowed"}`;
  }

  async _facts() {
    const { net } = await this.trading.positions();
    const open = net.filter((p) => p.quantity !== 0);
    const rows = [];
    for (const p of open.slice(0, 8)) {
      const r = { symbol: p.symbol, exchange: p.exchange, product: p.product, side: p.quantity > 0 ? "long" : "short", quantity: Math.abs(p.quantity), average: p.average, last: p.last, pnl: Math.round(p.pnl), pnlPct: p.average ? Math.round(((p.last - p.average) / p.average) * (p.quantity > 0 ? 1 : -1) * 10000) / 100 : null };
      if (p.exchange === "NSE" || p.exchange === "BSE") {
        try {
          const q = (await this.market.quotes([p.symbol])).quotes[p.symbol];
          if (q) Object.assign(r, { volume: q.volume, buyersShare: q.buyQty && q.sellQty ? Math.round((q.buyQty / (q.buyQty + q.sellQty)) * 100) : null, vwap: q.avgPrice, upperCircuit: q.upperCircuit, lowerCircuit: q.lowerCircuit, changePct: q.changePct });
        } catch (_) {
          /* no quote */
        }
        try {
          const v = await Promise.race([this.market.verdict(p.symbol), new Promise((res) => setTimeout(() => res(null), 6000))]);
          if (v && v.day && v.day.available) {
            const mv = v.day.movement || {};
            Object.assign(r, { rsi5: mv.rsi5, call: v.day.headline, callState: v.day.state, stop: v.day.plan && v.day.plan.stop });
          }
          if (v && Array.isArray(v.ladder)) {
            const below = v.ladder.filter((l) => l.price < p.last).sort((a, b) => b.price - a.price)[0];
            const above = v.ladder.filter((l) => l.price > p.last).sort((a, b) => a.price - b.price)[0];
            if (below) r.support = { name: below.label, price: below.price };
            if (above) r.resistance = { name: above.label, price: above.price };
          }
        } catch (_) {
          /* no live call */
        }
      }
      rows.push(r);
    }
    let funds = null;
    try {
      const f = await this.trading.funds();
      if (f && f.equity) funds = { available: f.equity.net };
    } catch (_) {
      funds = null;
    }
    let market = null;
    try {
      const c = await this.market.context();
      if (c && c.available) market = { tide: c.tide && c.tide.label, tideScore: c.tide && c.tide.score, vix: c.vix && c.vix.last };
    } catch (_) {
      market = null;
    }
    return { at: ist(this.now()).hhmm, positions: rows, funds, market, session: marketOpen(this.now()) ? "open" : "closed" };
  }

  /** The positions message: figures for each, and — with ai — the default model's advice. */
  async positionsText({ ai = true } = {}) {
    if (!this.trading.status().connected) return "Zerodha is not connected, so the positions cannot be read. Log in to Kite on the desk.";
    const f = await this._facts();
    if (!f.positions.length) return "";
    let adv = null;
    if (ai && this.ai && this.ai.whatsappAi) {
      try {
        adv = await this.ai.whatsappAi.adviseAll(this.ai, f);
      } catch (_) {
        adv = null;
      }
    }
    const tot = f.positions.reduce((s, p) => s + (p.pnl || 0), 0);
    const lines = [`🙏 *${BRAND.name} update* ${f.at} IST`, `Open: ${f.positions.length} · P&L ${inr(tot)}${f.funds ? ` · margin left ${inr(f.funds.available).replace("+", "")}` : ""}`];
    for (const p of f.positions) {
      lines.push("");
      lines.push(`${p.side === "long" ? "▲" : "▼"} *${p.symbol}* ${p.side} ${p.quantity} @ ${px(p.average)} → ${px(p.last)} (${inr(p.pnl)}${p.pnlPct !== null ? `, ${p.pnlPct > 0 ? "+" : ""}${p.pnlPct}%` : ""}) ${p.product}`);
      const bits = [];
      if (Number.isFinite(p.volume)) bits.push(`vol ${big(p.volume)}`);
      if (p.buyersShare !== null && p.buyersShare !== undefined) bits.push(`buyers ${p.buyersShare}% / sellers ${100 - p.buyersShare}%`);
      if (Number.isFinite(p.rsi5)) bits.push(`RSI(5m) ${Math.round(p.rsi5)}`);
      if (Number.isFinite(p.vwap)) bits.push(`VWAP ${px(p.vwap)}`);
      if (bits.length) lines.push(`  ${bits.join(" · ")}`);
      if (p.call) lines.push(`  Desk: ${p.call}`);
      if (p.support || p.resistance) lines.push(`  Levels: ${p.support ? `support ${px(p.support.price)}` : ""}${p.support && p.resistance ? " · " : ""}${p.resistance ? `resistance ${px(p.resistance.price)}` : ""}`);
      const a = adv && adv.ok && adv.per[p.symbol];
      if (a) lines.push(`  AI: *${a.action.toUpperCase()}* — ${a.note}`);
    }
    if (f.market) lines.push("", `Market: ${f.market.tide || "—"}${Number.isFinite(f.market.tideScore) ? ` (${f.market.tideScore > 0 ? "+" : ""}${f.market.tideScore})` : ""}${Number.isFinite(f.market.vix) ? ` · VIX ${f.market.vix}` : ""}`);
    if (adv && adv.ok && adv.watch) lines.push(`Watch: ${adv.watch}`);
    if (ai && !(adv && adv.ok)) lines.push("", "(The AI did not answer; these are the desk's own figures.)");
    lines.push("", "Reply POS · PNL · QUOTE SBIN · ASK … · HELP. Nothing is traded without your YES and PIN.");
    return lines.join("\n");
  }

  async _pnl(T) {
    if (/YESTERDAY|WEEK|MONTH/.test(T)) {
      const days = this.analysis ? this.analysis.list({}) : [];
      const today = ist(this.now()).date;
      const since = (n) => new Date(Date.parse(today) - n * 86400000).toISOString().slice(0, 10);
      const pick = /YESTERDAY/.test(T) ? days.filter((d) => d.date < today).slice(0, 1) : days.filter((d) => d.date >= since(/WEEK/.test(T) ? 7 : 31) && d.date <= today);
      if (!pick.length) return "No saved Trade Analysis reports for that period yet.";
      const sum = (f) => pick.reduce((s, d) => s + (f(d.summary || {}) || 0), 0);
      const net = sum((s) => s.net);
      return `📒 *P&L ${/YESTERDAY/.test(T) ? `· ${pick[0].date}` : /WEEK/.test(T) ? "· last 7 days" : "· last 31 days"}*
Net ${inr(net)} · profit ${inr(sum((s) => s.grossProfit))} · loss ${inr(-sum((s) => s.grossLoss))} · charges ${inr(-sum((s) => s.charges && s.charges.total))}
${sum((s) => s.trades)} trades on ${pick.length} day(s) · ${sum((s) => s.wins)} won
(From the saved Trade Analysis reports.)`;
    }
    if (!this.trading.status().connected) return "Zerodha is not connected, so today's P&L cannot be read.";
    const { net } = await this.trading.positions();
    const rows = net.filter((p) => p.pnl || p.quantity !== 0);
    const tot = rows.reduce((s, p) => s + (p.pnl || 0), 0);
    return `💰 *Today's P&L* ${inr(tot)}\n${rows.slice(0, 12).map((p) => `${p.symbol} ${p.quantity !== 0 ? `(open ${p.quantity})` : "(closed)"}: ${inr(p.pnl)}`).join("\n") || "No trades today."}`;
  }

  async _quote(symbol) {
    const q = (await this.market.quotes([symbol])).quotes[symbol];
    if (!q) return `No quote for ${symbol}. Is the symbol right, and is Zerodha connected?`;
    let call = "";
    try {
      const v = await Promise.race([this.market.verdict(symbol), new Promise((r) => setTimeout(() => r(null), 6000))]);
      if (v && v.day && v.day.available) call = `\nDesk: ${v.day.headline} (score ${v.day.score})${Number.isFinite(v.day.movement && v.day.movement.rsi5) ? ` · RSI(5m) ${Math.round(v.day.movement.rsi5)}` : ""}`;
      else if (v && v.summary) call = `\nDesk: ${v.summary}`;
    } catch (_) {
      call = "";
    }
    const buyers = q.buyQty && q.sellQty ? Math.round((q.buyQty / (q.buyQty + q.sellQty)) * 100) : null;
    return `📈 *${symbol}* ${px(q.last)} (${q.changePct > 0 ? "+" : ""}${(q.changePct || 0).toFixed(2)}%)
Day ${px(q.low)}–${px(q.high)} · VWAP ${px(q.avgPrice)} · vol ${big(q.volume)}${buyers !== null ? `\nBuyers ${buyers}% / sellers ${100 - buyers}% (order book)` : ""}${q.upperCircuit ? `\nCircuits ${px(q.lowerCircuit)} – ${px(q.upperCircuit)}` : ""}${call}`;
  }

  async _call(symbol) {
    const v = await this.market.verdict(symbol);
    if (!v || v.available === false) return `No reading for ${symbol}: ${(v && v.reason) || "unavailable"}.`;
    const d = v.day || {};
    const plan = d.plan ? `\nPlan: ${d.plan.side || ""} ${px(d.plan.entry)} · stop ${px(d.plan.stop)} · targets ${(d.plan.targets || []).map(px).join(", ")}` : "";
    return `🧭 *${symbol}* ${px(v.last)}
Live call: ${d.available ? `${d.headline} (score ${d.score}, needs ±${d.threshold})` : d.reason || "off"}${plan}
Daily: ${v.summary}
(Rules, not a forecast. Nothing is traded.)`;
  }

  async _ask(q) {
    if (!this.ai || !this.ai.tradeai) return "TradeAI is not available on this server.";
    const r = await this.ai.tradeai.answer(q, { owner: true });
    const acts = (r.actions || []).slice(0, 4).map((a) => `• ${a.kind}: ${a.text}`).join("\n");
    const fc = r.forecast && r.forecast.lean !== "n/a" ? `\nLean (${r.forecast.horizon || "next"}): ${r.forecast.lean}` : "";
    return `🤖 *TradeAI*\n${toWhatsApp(r.answer).slice(0, 2600)}${acts ? `\n\n${acts}` : ""}${fc}\n\n(${r.meta.engineOnly ? "desk's arithmetic" : (r.meta.by || []).join(", ") || "AI"})`;
  }

  _alerts() {
    const w = this.market.alerts().alerts.filter((a) => !a.firedAt);
    return w.length ? `🔔 *Waiting alerts* (${w.length})\n${w.slice(0, 20).map((a) => `${a.symbol} ${a.dir} ${px(a.price)}${a.note ? ` — ${a.note}` : ""}`).join("\n")}` : "No alerts waiting. Set one: ALERT SBIN 800";
  }

  /* ------------------------------------------------- anything that moves money: confirm */
  async _trade(T) {
    const d = this._load();
    if (T === "TRADING OFF") {
      if (!this.trading.status().enabled) return "Trading is already OFF.";
      this.trading.setSwitch(false, "whatsapp");
      return "🛑 Trading is OFF. No order can be sent from the site until it is turned on again.";
    }
    if (!d.allowTrading) return "Trading from WhatsApp is not allowed. Turn on “Allow trading from WhatsApp” on the /me card first (it needs a PIN).";
    if (d.lockedUntil && Date.parse(d.lockedUntil) > this.now()) return `WhatsApp trading is locked until ${new Date(d.lockedUntil).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })} after wrong PINs.`;
    let action = null;
    let summary = "";
    if (T === "TRADING ON") {
      if (this.trading.status().enabled) return "Trading is already ON.";
      action = { kind: "switch-on" };
      summary = "Turn trading ON — real orders can then be sent to your Zerodha account.";
    } else if (T === "EXIT ALL") {
      action = { kind: "exit-all" };
      summary = "EXIT ALL: cancel pending orders, then exit every open position at market (with protection).";
    } else {
      let m = T.match(/^EXIT\s+([A-Z0-9&._-]{1,25})$/);
      if (m) {
        const { net } = await this.trading.positions();
        const p = net.filter((x) => x.symbol === m[1] && x.quantity !== 0);
        if (!p.length) return `No open position in ${m[1]}.`;
        action = { kind: "exit", items: p.map((x) => ({ exchange: x.exchange, symbol: x.symbol, product: x.product })) };
        summary = `Exit ${p.map((x) => `${x.symbol} ${x.product} ${x.quantity > 0 ? "long" : "short"} ${Math.abs(x.quantity)}`).join(", ")} at market (with protection).`;
      }
      m = !action && T.match(/^(BUY|SELL|B|S)\s+(\d{1,7})\s+([A-Z0-9&._-]{1,25})(?:\s+(?:@|AT)\s*(\d+(?:\.\d+)?))?(?:\s+(MIS|CNC))?$/);
      if (m) {
        const side = m[1].startsWith("B") ? "BUY" : "SELL";
        const order = { exchange: "NSE", symbol: m[3], side, quantity: Number(m[2]), type: m[4] ? "LIMIT" : "MARKET", price: m[4] ? Number(m[4]) : undefined, product: m[5] || "MIS" };
        let ref = null;
        try {
          ref = (await this.market.quotes([order.symbol])).quotes[order.symbol];
        } catch (_) {
          ref = null;
        }
        const pre = await this.trading.preview({ ...order, refPrice: ref ? ref.last : undefined }).catch((e) => ({ error: e.message }));
        if (pre.error) return `That order is not valid: ${pre.error}`;
        const failed = (pre.checks || []).filter((c) => !c.ok).map((c) => c.text);
        const warn = (pre.nudges || []).filter((n) => n.level === "warn").map((n) => n.text);
        action = { kind: "order", order: { ...order, refPrice: ref ? ref.last : undefined } };
        summary = `${side} ${order.quantity} ${order.symbol} on NSE ${order.type === "LIMIT" ? `at ${px(order.price)}` : "at market (with protection)"}, ${order.product}${ref ? ` · last ${px(ref.last)}` : ""}${pre.margin ? ` · margin ${inr(pre.margin).replace("+", "")}` : ""}${pre.charges ? ` · charges about ${inr(pre.charges.total).replace("+", "")}` : ""}${failed.length ? `\n⚠ ${failed.join("\n⚠ ")}` : ""}${warn.length ? `\n⚠ ${warn.join("\n⚠ ")}` : ""}`;
      }
    }
    if (!action) return "I did not understand that trading command. Examples: BUY 10 SBIN · SELL 5 INFY @ 1500 · EXIT SBIN · EXIT ALL · TRADING ON";
    const code = String(crypto.randomInt(100000, 1000000));
    this._note({ pending: { code, action, expiresAt: new Date(this.now() + CONFIRM_MS).toISOString() } });
    return `⏳ *Please confirm*\n${summary}\n\nReply *YES ${code} <your PIN>* within 2 minutes to send it, or NO to cancel. This is a real order on your Zerodha account.`;
  }

  async _confirm(T) {
    const d = this._load();
    const p = d.pending;
    const m = T.match(/^YES\s+(\d{6})\s+(\d{4,8})$/);
    if (!p) return "Nothing is waiting for a YES.";
    if (Date.parse(p.expiresAt) < this.now()) {
      this._note({ pending: null });
      return "That confirmation has expired. Send the command again.";
    }
    if (!m || m[1] !== p.code) return `Reply exactly: YES ${p.code} <your PIN>`;
    if (!d.pinHash || hashPin(m[2], d.pinSalt) !== d.pinHash) {
      const fails = (d.pinFails || 0) + 1;
      const lock = fails >= 3;
      this._note({ pinFails: lock ? 0 : fails, pending: lock ? null : p, lockedUntil: lock ? new Date(this.now() + 30 * 60000).toISOString() : d.lockedUntil || null });
      return lock ? "Wrong PIN three times: WhatsApp trading is locked for 30 minutes." : `Wrong PIN (${fails} of 3).`;
    }
    this._note({ pending: null, pinFails: 0 });
    const by = "whatsapp";
    const ref = () => crypto.randomBytes(12).toString("hex");
    const a = p.action;
    try {
      if (a.kind === "switch-on") {
        this.trading.setSwitch(true, by);
        return "✅ Trading is ON. Every order still passes the limits and the risk guard. TRADING OFF to stop.";
      }
      if (a.kind === "order") {
        const r = await this.trading.place({ ...a.order, confirm: true, clientRef: ref() }, by);
        return `✅ Sent to Zerodha: ${a.order.side} ${a.order.quantity} ${a.order.symbol} (order ${r.orderId}). Sent is not filled — reply POS in a moment.`;
      }
      if (a.kind === "exit") {
        const out = [];
        for (const it of a.items) {
          const r = await this.trading.exit({ ...it, confirm: true, clientRef: ref() }, by);
          out.push(`${it.symbol} ${it.product}: ${r.side} ${r.quantity} (order ${r.orderId})`);
        }
        return `✅ Exit sent:\n${out.join("\n")}\nSent is not filled — reply POS in a moment.`;
      }
      if (a.kind === "exit-all") {
        const r = await this.trading.exitAll({ confirm: "EXIT ALL", cancelOpen: true, clientRef: ref() }, by);
        return `✅ Exit all sent:\n${r.results.map((x) => `${x.kind} ${x.symbol}: ${x.ok ? `sent ${x.orderId || ""}` : `failed — ${x.error}`}`).join("\n") || "Nothing was open."}`;
      }
    } catch (err) {
      return `❌ Not sent: ${err.message}`;
    }
    return "Nothing to do.";
  }

  /* --------------------------------------------------------------------------- clock */
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.log.log(`[whatsapp] ${err.message}`));
    }, 60000);
    if (this.timer.unref) this.timer.unref();
  }

  async tick() {
    const d = this._load();
    if (!d.enabled || this.busy || !this.status().configured) return null;
    const t = ist(this.now());
    if (t.dow < 1 || t.dow > 5) return null;
    this.busy = true;
    try {
      if (t.mins >= 560 && t.mins < 575 && d.morning !== t.date) {
        this._note({ morning: t.date });
        const st = await this._status();
        return this.send(`🌅 Good morning — Jai Shri Ram.\n${st}\nUpdates every ${d.every || 30} min while positions are open. Reply HELP for commands.`);
      }
      if (t.mins >= 935 && t.mins < 960 && d.closing !== t.date) {
        this._note({ closing: t.date });
        return this.send(`🔔 Market closed.\n${await this._pnl("PNL")}\nThe Trade Analysis report follows at 3:45 PM.`);
      }
      if (!marketOpen(this.now()) || d.updates === false || !this.trading.status().connected) return null;
      const due = !d.lastUpdate || this.now() - Date.parse(d.lastUpdate) >= (d.every || 30) * 60000;
      if (!due) return null;
      this._note({ lastUpdate: new Date(this.now()).toISOString() });
      const text = await this.positionsText({ ai: true });
      if (!text) return null; // nothing open: no message
      return this.send(text);
    } finally {
      this.busy = false;
    }
  }
}

function mountWhatsApp(app, { whatsapp, requireSuper, limiter }) {
  const wrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      if (err instanceof WhatsAppError) return res.status(err.status).json({ error: err.code, message: err.message });
      res.status(500).json({ error: "whatsapp_failed", message: err && err.message ? err.message : "WhatsApp failed." });
    }
  };
  app.get("/api/admin/whatsapp", requireSuper, wrap(async () => whatsapp.status()));
  app.put("/api/admin/whatsapp", requireSuper, limiter(30, 15 * 60 * 1000), wrap(async (req) => whatsapp.set(req.body || {})));
  app.post("/api/admin/whatsapp/test", requireSuper, limiter(10, 10 * 60 * 1000), wrap(async () => whatsapp.test()));
  app.post("/api/admin/whatsapp/preview", requireSuper, limiter(10, 10 * 60 * 1000), wrap(async () => ({ text: (await whatsapp.positionsText({ ai: true })) || "No open positions right now: no update would be sent." })));
}

module.exports = { WhatsAppService, WhatsAppError, mountWhatsApp, HELP, marketOpen, toWhatsApp };
