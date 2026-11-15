"use strict";
const { BRAND } = require("./brand");
// Price alerts that fire with no page open.
//
// The open terminal already checks alerts on every tick. This watcher does the same on the server,
// every 15 seconds during NSE hours (Monday–Friday, 9:15 AM – 3:30 PM IST) while Zerodha is
// connected and alerts are waiting: it reads the quotes of the waiting alerts' stocks, records a
// crossing once (the same record the page uses, so a second report changes nothing), and sends a
// Telegram message when that is set up. An open page shows it as usual.
//
// It only reads prices. It lives outside server/ai, which holds no timers.

const IST = 5.5 * 3600 * 1000;
const EVERY_MS = 15000;

/** Monday–Friday, 9:15 AM to 3:30 PM IST (exchange holidays are not known here; a holiday simply has no moves). */
function nseOpen(ms) {
  const d = new Date(ms + IST);
  const day = d.getUTCDay();
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  return day >= 1 && day <= 5 && m >= 555 && m < 930;
}

const rs = (x) => `₹${Number(x).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

class AlertWatch {
  constructor({ market, notifier, now = () => Date.now(), log = console, every = EVERY_MS }) {
    this.market = market;
    this.notifier = notifier;
    this.now = now;
    this.log = log;
    this.every = every;
    this.timer = null;
    this.busy = false;
    this.last = { at: null, checked: 0, fired: 0, error: "" };
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch(() => {});
    }, this.every);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  status() {
    return { running: Boolean(this.timer), marketOpen: nseOpen(this.now()), ...this.last };
  }

  /** One look: returns the alerts that fired now. */
  async tick() {
    if (this.busy) return [];
    if (!nseOpen(this.now()) || this.market.mode() !== "kite") return [];
    const waiting = this.market.alerts().alerts.filter((a) => !a.firedAt);
    if (!waiting.length) return [];
    this.busy = true;
    const fired = [];
    try {
      const symbols = [...new Set(waiting.map((a) => a.symbol))].slice(0, 100);
      const q = (await this.market.quotes(symbols)).quotes || {};
      for (const a of waiting) {
        const last = q[a.symbol] && Number(q[a.symbol].last);
        if (!(last > 0)) continue;
        const hit = a.dir === "above" ? last >= a.price : last <= a.price;
        if (!hit) continue;
        const r = this.market.fireAlert(a.id, last);
        if (!r.first) continue; // a page saw it first
        fired.push(r.alert);
        if (this.notifier) {
          const text = `🔔 Price alert: ${a.symbol} is at ${rs(last)} — ${a.dir === "above" ? "at or above" : "at or below"} ${rs(a.price)}${a.note ? `\n${a.note}` : ""}\n(${BRAND.name} · nothing was traded)`;
          await this.notifier.send(text, "alerts");
        }
      }
      this.last = { at: new Date(this.now()).toISOString(), checked: waiting.length, fired: fired.length, error: "" };
    } catch (err) {
      this.last = { ...this.last, at: new Date(this.now()).toISOString(), error: err && err.message ? err.message : String(err) };
    } finally {
      this.busy = false;
    }
    return fired;
  }
}

module.exports = { AlertWatch, nseOpen };
