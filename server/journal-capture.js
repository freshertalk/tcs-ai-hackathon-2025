"use strict";
// The journal fills itself from Kite — no page has to be open and nothing is typed in.
//
// Zerodha's Kite Connect API returns only the CURRENT day's trades (it has no endpoint for past
// trades or past profit and loss), so every trading day's trades must be read on that same day.
// This service reads them every 5 minutes on weekdays from 9:10 AM to midnight IST while Zerodha
// is connected, adds any new fills to the journal (repeats are ignored), marks the day as captured,
// and saves every period's P&L snapshot when something changed. Logging in to Kite later in the
// evening still saves that day. The history before the first capture comes from Zerodha Console's
// tradebook files (see the Journal page).
//
// It only reads the account. It lives outside server/ai, which holds no timers.

const IST = 5.5 * 3600 * 1000;
const EVERY_MS = 5 * 60 * 1000;

/** Monday–Friday, 9:10 AM to 11:59 PM IST (holidays simply have no trades). */
function captureWindow(ms) {
  const d = new Date(ms + IST);
  const day = d.getUTCDay();
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  return day >= 1 && day <= 5 && m >= 550;
}

class JournalCapture {
  constructor({ trading, market, now = () => Date.now(), log = console, every = EVERY_MS }) {
    this.trading = trading;
    this.market = market;
    this.now = now;
    this.log = log;
    this.every = every;
    this.timer = null;
    this.busy = false;
    this.last = { at: null, day: null, trades: 0, added: 0, error: "" };
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch(() => {});
    }, this.every);
    if (this.timer.unref) this.timer.unref();
    // a first look soon after start: a restart in the evening still saves the day
    const first = setTimeout(() => this.tick().catch(() => {}), 20000);
    if (first.unref) first.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  status() {
    return { running: Boolean(this.timer), window: captureWindow(this.now()), connected: Boolean(this.market.kiteAuth && this.market.kiteAuth()), everyMin: Math.round(this.every / 60000), ...this.last };
  }

  /** One read of today's trades. force: outside the window too (a page asked for it). */
  async tick({ force = false } = {}) {
    if (this.busy) return null;
    if (!force && !captureWindow(this.now())) return null;
    if (!this.market.kiteAuth || !this.market.kiteAuth()) return null;
    this.busy = true;
    try {
      const day = new Date(this.now() + IST).toISOString().slice(0, 10);
      const trades = await this.trading.trades();
      const j = this.trading.journal;
      const added = j.ingestKite(trades);
      j.markCaptured(day, trades.length);
      const snap = j.snapshot(this.now());
      this.last = { at: new Date(this.now()).toISOString(), day, trades: trades.length, added, error: "", snapshot: snap.saved };
      if (added) this.log.log(`[journal] captured ${added} new fill${added === 1 ? "" : "s"} from Kite (${trades.length} today)`);
      return this.last;
    } catch (err) {
      this.last = { ...this.last, at: new Date(this.now()).toISOString(), error: err && err.message ? err.message : String(err) };
      return this.last;
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { JournalCapture, captureWindow };
