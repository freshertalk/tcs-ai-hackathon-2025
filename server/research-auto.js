"use strict";
// Research that runs by itself: before the open (08:45 IST) and after the close (16:00 IST),
// on weekdays, for the watchlist. It is the listener the desk keeps while nobody is looking —
// prices, history, the measured odds, the stock's habits and the market's state are read and
// weighed into each stock's direction, and the report is waiting when the trader arrives.
//
// Without AI it costs nothing and needs no key. With "AI notes" on, the same run also checks
// company news and the world markets and has the model write a note per stock — that uses
// Anthropic tokens, so it is off until switched on.
//
// It lives outside server/ai on purpose: the AI folder holds no timers (a test enforces it),
// and nothing here can place an order.

const NAME = "research/auto.json";
const IST = 5.5 * 3600 * 1000;
const WINDOWS = {
  pre: { from: 8 * 60 + 45, to: 9 * 60 + 14, label: "08:45" },
  post: { from: 16 * 60, to: 18 * 60, label: "16:00" },
};

function istParts(ms) {
  const d = new Date(ms + IST);
  return { date: d.toISOString().slice(0, 10), dow: d.getUTCDay(), mins: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/** Which run, if any, is due at this moment. Pure, for tests. */
function dueRun(ms, lastRuns = {}) {
  const t = istParts(ms);
  if (t.dow === 0 || t.dow === 6) return null;
  for (const phase of ["pre", "post"]) {
    const w = WINDOWS[phase];
    if (t.mins >= w.from && t.mins <= w.to && lastRuns[phase] !== t.date) return { phase, date: t.date };
  }
  return null;
}

class ResearchAuto {
  constructor({ ai, market, docs, now = () => Date.now(), log = console, isHoliday = () => false }) {
    this.ai = ai;
    this.market = market;
    this.docs = docs;
    this.now = now;
    this.log = log;
    this.isHoliday = isHoliday;
    this.timer = null;
  }

  _state() {
    const d = this.docs.read(NAME, null);
    return { enabled: true, withAi: false, lastRuns: {}, history: [], ...(d && typeof d === "object" ? d : {}) };
  }

  status() {
    const s = this._state();
    return { enabled: s.enabled, withAi: s.withAi, times: { pre: WINDOWS.pre.label, post: WINDOWS.post.label }, lastRuns: s.lastRuns, history: s.history.slice(0, 10), aiConfigured: this.ai.configured() };
  }

  set({ enabled, withAi } = {}) {
    const s = this._state();
    if (typeof enabled === "boolean") s.enabled = enabled;
    if (typeof withAi === "boolean") s.withAi = withAi;
    this.docs.write(NAME, s);
    return this.status();
  }

  /** Called every minute. Starts a run when one is due; never two at once, never twice a day. */
  tick() {
    const s = this._state();
    if (!s.enabled) return null;
    const due = dueRun(this.now(), s.lastRuns);
    if (!due) return null;
    if (this.market.mode() !== "kite") return null; // no live data: nothing worth a report
    if (this.isHoliday(due.date)) {
      s.lastRuns[due.phase] = due.date;
      this.docs.write(NAME, s);
      return null;
    }
    const withAi = s.withAi && this.ai.configured();
    try {
      this.ai.research.start({ phase: due.phase, useAi: withAi, news: withAi, world: withAi && due.phase === "pre" });
    } catch (err) {
      if (err && err.code === "busy") return null; // a run the trader started is going: try next minute
      this.log.log(`[research] automatic ${due.phase}-market run could not start: ${err.message}`);
    }
    s.lastRuns[due.phase] = due.date;
    s.history = [{ at: new Date(this.now()).toISOString(), phase: due.phase, withAi }, ...s.history].slice(0, 30);
    this.docs.write(NAME, s);
    this.log.log(`[research] automatic ${due.phase}-market research started${withAi ? " with AI notes" : " (data and direction)"}`);
    return due;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (err) {
        this.log.log(`[research] ${err.message}`);
      }
    }, 60000);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { ResearchAuto, dueRun, WINDOWS, NAME };
