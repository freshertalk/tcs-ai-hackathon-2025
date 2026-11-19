"use strict";
// The automation supervisor: makes sure nothing that should run by itself is left behind.
//
//   WHY      Every learner and forecaster has its own clock (the forecaster learns at 3:40 PM, the set-up lab runs in the
//            evening, the level learner after the close…). A clock only fires if the server is up AND Zerodha is connected
//            at that moment. If either was missing — a restart, a login made late, a weekend deploy — the work was simply
//            skipped until the next day, and one download (the screener's Nifty 500 history) started only when someone
//            opened its page. The supervisor closes those gaps: every minute it asks each DUTY "are you behind?", and runs
//            the first one that is.
//   HOW      A duty is { id, name, what, due(), run() }. `due()` returns a plain reason ("3 sessions not learned yet") or "".
//            One duty runs at a time. Heavy duties wait for quiet hours (outside 8:30–15:35 on a trading day) so they never
//            compete with the live desk for Zerodha's request limits. A duty that fails, or that runs without clearing its
//            own reason (nothing more can be done right now), is tried again later with growing pauses (30 min … 24 h),
//            never in a tight loop.
//   RECORD   what ran, when, why and how it ended is kept (automation/supervisor.json) and shown on /me → Automation.
//
// It only calls the services' own methods: it cannot place an order, and it asks no AI model (the AI stays click-only).

const IST = 5.5 * 3600 * 1000;
const NAME = "automation/supervisor.json";
const KEEP_EVENTS = 60;
const MIN_GAP = 30 * 60000;
const MAX_GAP = 24 * 3600000;

const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const minuteOfDay = (ms) => {
  const d = new Date(ms + IST);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const weekdayOf = (date) => {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
};

class Supervisor {
  /**
   * @param duties        [{ id, name, what, due: () => string, run: async () => any, quietOnly?: boolean, every?: ms }]
   * @param isTradingDay  (YYYY-MM-DD) => boolean (the exchange calendar); weekdays when not given
   */
  constructor({ docs = null, duties = [], isTradingDay = weekdayOf, now = () => Date.now(), log = console } = {}) {
    this.docs = docs;
    this.duties = duties;
    this.isTradingDay = isTradingDay;
    this.now = now;
    this.log = log;
    this.timer = null;
    this.running = null; // { id, since }
    this._s = null;
  }

  /* --------------------------------------------------------------------------- the calendar */
  /** Outside the session (and the half hour before it) on a trading day, and all day otherwise. */
  quiet(now = this.now()) {
    if (!this.isTradingDay(istDate(now))) return true;
    const m = minuteOfDay(now);
    return m < 8 * 60 + 30 || m >= 15 * 60 + 35;
  }

  /** The date of the last session that is over: today after 3:35 PM on a trading day, else the trading day before. */
  lastSession(now = this.now()) {
    let t = now;
    if (!(this.isTradingDay(istDate(t)) && minuteOfDay(t) >= 15 * 60 + 35)) t -= 86400000;
    for (let i = 0; i < 20 && !this.isTradingDay(istDate(t)); i += 1) t -= 86400000;
    return istDate(t);
  }

  /* --------------------------------------------------------------------------- the record */
  _state() {
    if (!this._s) this._s = (this.docs && this.docs.read(NAME, null)) || { duties: {}, events: [] };
    return this._s;
  }
  _save() {
    if (this.docs) this.docs.write(NAME, this._s);
  }
  _event(e) {
    const s = this._state();
    s.events.unshift({ at: new Date(this.now()).toISOString(), ...e });
    s.events = s.events.slice(0, KEEP_EVENTS);
  }

  /* --------------------------------------------------------------------------- one look */
  _reason(d) {
    try {
      return String(d.due() || "");
    } catch (err) {
      return "";
    }
  }

  /** Ask every duty whether it is behind; run the first that is and may run now. @returns the id started, or null */
  async tick() {
    if (this.running) return null;
    const now = this.now();
    const s = this._state();
    const quiet = this.quiet(now);
    for (const d of this.duties) {
      const reason = this._reason(d);
      const rec = s.duties[d.id] || (s.duties[d.id] = { runs: 0, ok: 0, failed: 0, gap: 0 });
      if (!reason) {
        if (rec.gap) {
          rec.gap = 0; // caught up: the next time it falls behind it is tried at once
          rec.lastReason = "";
        }
        continue;
      }
      if (d.quietOnly && !quiet) continue;
      const wait = Math.max(rec.gap || 0, 0);
      if (rec.lastRunAt && now - Date.parse(rec.lastRunAt) < wait) continue;
      await this._run(d, reason, rec);
      return d.id;
    }
    return null;
  }

  async _run(d, reason, rec) {
    const started = this.now();
    this.running = { id: d.id, since: new Date(started).toISOString(), reason };
    rec.runs += 1;
    rec.lastRunAt = new Date(started).toISOString();
    rec.lastReason = reason;
    this._event({ id: d.id, name: d.name, kind: "started", reason });
    this._save();
    let error = "";
    try {
      await d.run();
    } catch (err) {
      error = String(err && err.message ? err.message : err).slice(0, 200);
    }
    const still = error ? reason : this._reason(d);
    const base = d.every || MIN_GAP;
    if (error) {
      rec.failed += 1;
      rec.lastError = error;
      rec.gap = Math.min(MAX_GAP, Math.max(base, (rec.gap || base / 2) * 2));
      this.log.error(`[supervisor] ${d.name}: ${error}`);
    } else {
      rec.ok += 1;
      rec.lastOkAt = new Date(this.now()).toISOString();
      rec.lastError = "";
      // it ran but is still behind for the same reason: nothing more can be done right now — wait longer each time
      rec.gap = still ? Math.min(MAX_GAP, Math.max(base, (rec.gap || base / 2) * 2)) : 0;
      this.log.log(`[supervisor] ${d.name}: done (${reason})${still ? "; still behind, will look again later" : ""}`);
    }
    rec.lastMs = this.now() - started;
    this._event({ id: d.id, name: d.name, kind: error ? "failed" : still ? "partial" : "done", reason, error, ms: rec.lastMs });
    this.running = null;
    this._save();
  }

  /* --------------------------------------------------------------------------- for the screen */
  status() {
    const now = this.now();
    const s = this._state();
    const quiet = this.quiet(now);
    const duties = this.duties.map((d) => {
      const rec = s.duties[d.id] || {};
      const reason = this._reason(d);
      const running = Boolean(this.running && this.running.id === d.id);
      const state = running ? "running" : !reason ? "ok" : rec.lastError ? "failed" : d.quietOnly && !quiet ? "waiting" : "behind";
      const nextAt = reason && !running && rec.lastRunAt && rec.gap ? new Date(Date.parse(rec.lastRunAt) + rec.gap).toISOString() : null;
      return { id: d.id, name: d.name, what: d.what, state, reason, quietOnly: Boolean(d.quietOnly), runs: rec.runs || 0, lastRunAt: rec.lastRunAt || null, lastOkAt: rec.lastOkAt || null, lastError: rec.lastError || "", nextAt };
    });
    return {
      at: new Date(now).toISOString(),
      quiet,
      lastSession: this.lastSession(now),
      running: this.running,
      behind: duties.filter((d) => d.state !== "ok").length,
      duties,
      events: s.events.slice(0, 25),
    };
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.log.error(`[supervisor] ${err.message}`));
    }, 60000);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { Supervisor, NAME };
