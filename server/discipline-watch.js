"use strict";
// The daily goal's watcher: target, stop and profit protection checked with no page open.
//
// Every 15 seconds during NSE hours (Monday–Friday, 9:15 AM – 3:30 PM IST), while Zerodha is
// connected, it asks the trading service for today's standing (server/trading/discipline.js). A new
// reminder — the target reached, the daily stop reached, a green day turning red, half of the day's
// best given back, an open position giving back its gain — goes to Telegram / WhatsApp through the
// service's onDiscipline hook when that is set up, and is repeated while it still holds. An open
// terminal shows the same reminders on its own.
//
// It only reads the account. It never places, changes or cancels an order. It lives outside
// server/ai, which holds no timers.

const { nseOpen } = require("./alert-watch");

const EVERY_MS = 15000;

class DisciplineWatch {
  constructor({ trading, now = () => Date.now(), log = console, every = EVERY_MS }) {
    this.trading = trading;
    this.now = now;
    this.log = log;
    this.every = every;
    this.timer = null;
    this.busy = false;
    this.last = { at: null, state: null, error: "" };
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

  /** One look: returns today's standing, or null when there is nothing to look at. */
  async tick() {
    if (this.busy || !nseOpen(this.now())) return null;
    let st;
    try {
      st = this.trading.status();
    } catch (_) {
      return null;
    }
    if (!st.connected || !this.trading._discipline().enabled) return null;
    this.busy = true;
    try {
      const s = await this.trading.disciplineStatus();
      this.last = { at: new Date(this.now()).toISOString(), state: s && s.state, error: "" };
      return s;
    } catch (err) {
      this.last = { ...this.last, at: new Date(this.now()).toISOString(), error: err && err.message ? err.message : String(err) };
      return null;
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { DisciplineWatch };
