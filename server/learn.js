"use strict";
// The desk learns by itself: once the session is over, the day is studied and the record grows.
//
//   WHEN     every trading day from 3:40 PM IST, while Zerodha is connected (checked once a minute; it
//            tries again every ten minutes until the day is done). The first time it runs it also
//            studies the last trading days it has not seen yet (Zerodha keeps about 60 days of
//            1-minute bars), three a run, so the record does not start from nothing.
//   WHAT     for the stocks traded that day, the stocks the flight recorder filmed and the watchlist
//            (30 at most): the day's 1-minute bars are walked once and every test of a level is
//            counted — held or broke, by the kind of level, the time of day, the volume into it,
//            RSI, the Bollinger band and, where the recorder was filming, the order book
//            (trading/levellearn.js). Arithmetic only: no AI model is asked, so learning costs nothing.
//   KEPT     one record per day (learn/levels/DATE.json), the sum of the last 60 days
//            (learn/levels-summary.json) and the log of the runs (learn/runs.json), in the database.
//   USED     the sum is read by the level map (each level shows how often its kind has held), by the
//            AI when it chooses exit levels, and by TradeAI's agent. Its findings are written, in
//            plain words, into the trading-skills file every AI feature reads (the section "What
//            the desk has measured") — replaced each day, so the file always holds the latest count.
//
// It reads the market and the day's records. It never trades, and it lives outside server/ai
// (which holds no timers).

const { studyDay, summarize, holdOf, table, lessons } = require("./trading/levellearn");

const IST = 5.5 * 3600 * 1000;
const INDEX = "learn/index.json";
const SUMMARY = "learn/levels-summary.json";
const RUNS = "learn/runs.json";
const dayDoc = (date) => `learn/levels/${date}.json`;
const WINDOW_DAYS = 60; // trading days the sum covers
const KEEP_DAYS = 120;
const MAX_SYMBOLS = 30;
const BACKFILL = 3; // earlier days studied per run
const SECTION = "## What the desk has measured (written by itself after every close)";
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const minuteOfDay = (ms) => {
  const d = new Date(ms + IST);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const weekday = (date) => {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
};

class LearnWatch {
  /**
   * @param market   the MarketService (1-minute and daily bars, the watchlist)
   * @param flight   the FlightDeck (the day's frames and the record of the AI's levels), optional
   * @param trading  the TradingService (the journal's trades of the day), optional
   * @param playbook the trading-skills file, optional
   */
  constructor({ market, docs, flight = null, trading = null, playbook = null, now = () => Date.now(), log = console }) {
    this.market = market;
    this.docs = docs;
    this.flight = flight;
    this.trading = trading;
    this.playbook = playbook;
    this.now = now;
    this.log = log;
    this.timer = null;
    this.running = null;
    this._sum = null;
    this._tryAt = 0;
  }

  /* -------------------------------------------------------------------------- reading */
  summary() {
    if (!this._sum) this._sum = this.docs.read(SUMMARY, null) || { days: 0, from: null, to: null, symbols: 0, tests: 0, all: {}, bySymbol: {} };
    return this._sum;
  }
  /** How often levels of these kinds have held — for the level map. */
  holdOf(symbol, sources, ctx = {}) {
    return holdOf(this.summary(), symbol, sources, ctx);
  }
  _aiLevels() {
    try {
      const r = this.flight && typeof this.flight.levelsRecord === "function" ? this.flight.levelsRecord() : null;
      return r && r.judged > 0 ? r : null;
    } catch (_) {
      return null;
    }
  }
  /** What has been measured, for a page and for TradeAI. */
  view(symbol = null) {
    const s = this.summary();
    const ai = this._aiLevels();
    if (!s.days) return { available: false, reason: "Nothing has been studied yet: the first study runs after the close of the next trading day (or press Study now).", aiLevels: ai };
    return {
      available: true,
      days: s.days,
      from: s.from,
      to: s.to,
      stocks: s.symbols,
      tests: s.tests,
      symbol: symbol || null,
      note: "Held = the price fell back one step (2.5× the stock's average 1-minute range) before closing half a step beyond the level. pct = held ÷ (held + broke). own = this stock's own record once it has eight tests.",
      levels: table(s, symbol),
      findings: lessons(s, { aiLevels: ai ? `The AI's exit levels on this desk: ${ai.text}` : "" }),
      aiLevels: ai,
    };
  }
  status() {
    const ix = this.docs.read(INDEX, null) || { days: {} };
    const runs = (this.docs.read(RUNS, null) || { items: [] }).items;
    const s = this.summary();
    return { running: Boolean(this.running), watching: Boolean(this.timer), days: s.days, from: s.from, to: s.to, stocks: s.symbols, tests: s.tests, studied: Object.keys(ix.days || {}).length, lastRun: runs[0] || null, runs: runs.slice(0, 10) };
  }

  /* -------------------------------------------------------------------------- studying */
  _symbolsOf(date) {
    const set = new Set();
    try {
      const d = this.flight ? this.flight.day(date) : null;
      if (d && d.available) d.flights.forEach((f) => set.add(f.symbol));
    } catch (_) {
      /* no recording that day */
    }
    try {
      const from = Date.parse(`${date}T00:00:00+05:30`);
      if (this.trading && this.trading.journal) this.trading.journal.trips({ from, to: from + 86400000 }).forEach((t) => (t.exchange === "NSE" || t.exchange === "BSE") && set.add(t.symbol));
    } catch (_) {
      /* no journal */
    }
    try {
      (this.market.watchlist ? this.market.watchlist() : []).forEach((s) => set.add(s));
    } catch (_) {
      /* no watchlist */
    }
    return [...set].filter((s) => /^[A-Z][A-Z0-9&-]{1,19}$/.test(s)).slice(0, MAX_SYMBOLS);
  }

  /** One day studied and kept. @returns { date, symbols, tests } — symbols 0 when the market was shut. */
  async studyDate(date) {
    const open = Date.parse(`${date}T03:45:00Z`);
    const close = Date.parse(`${date}T10:00:00Z`);
    const frames = new Map();
    try {
      const d = this.flight ? this.flight.day(date) : null;
      if (d && d.available) for (const f of d.flights) frames.set(f.symbol, [...(frames.get(f.symbol) || []), ...(f.snaps || [])]);
    } catch (_) {
      /* no frames */
    }
    const out = { date, symbols: {} };
    let tests = 0;
    let failed = 0;
    for (const sym of this._symbolsOf(date)) {
      try {
        const bars = await this.market.minuteBarsBetween(sym, open, close);
        if (!Array.isArray(bars) || bars.length < 60) continue;
        const daily = typeof this.market.daily === "function" ? (await this.market.daily(sym)).candles : [];
        const s = studyDay(bars, daily, { date, frames: frames.get(sym) });
        if (!s) continue;
        out.symbols[sym] = { counts: s.counts, touches: s.touches.length, unit: s.unit };
        tests += s.touches.filter((t) => t.outcome !== "none").length;
      } catch (_) {
        failed += 1; // that stock is left out today
      }
    }
    const n = Object.keys(out.symbols).length;
    if (!n && failed) return { date, symbols: 0, tests: 0, failed: true }; // the bars could not be read: not marked, tried again
    if (n) this.docs.write(dayDoc(date), out);
    const ix = this.docs.read(INDEX, null) || { days: {} };
    ix.days = { ...(ix.days || {}), [date]: n };
    // old days are let go
    const all = Object.keys(ix.days).sort();
    while (all.length > KEEP_DAYS) {
      const old = all.shift();
      this.docs.remove(dayDoc(old));
      delete ix.days[old];
    }
    this.docs.write(INDEX, ix);
    return { date, symbols: n, tests };
  }

  /** The last 60 studied days added up, kept, and written into the skills file. */
  rebuild() {
    const ix = this.docs.read(INDEX, null) || { days: {} };
    const dates = Object.keys(ix.days || {}).filter((d) => ix.days[d] > 0).sort().slice(-WINDOW_DAYS);
    const days = dates.map((d) => this.docs.read(dayDoc(d), null)).filter(Boolean);
    const s = { ...summarize(days), updatedAt: new Date(this.now()).toISOString() };
    this.docs.write(SUMMARY, s);
    this._sum = s;
    const ai = this._aiLevels();
    const lines = lessons(s, { aiLevels: ai ? `The AI's exit levels on this desk: ${ai.text}` : "" });
    let written = 0;
    if (this.playbook && lines.length) {
      try {
        this.playbook.setSection(SECTION, lines.map((l) => `- ${l}`).join("\n"));
        written = lines.length;
      } catch (err) {
        this.log.error(`[learn] the skills file was not updated: ${err.message}`);
      }
    }
    return { summary: s, lessons: written };
  }

  /** The trading days of the last three weeks that have not been studied, newest first. */
  _missing(today, { includeToday }) {
    const ix = this.docs.read(INDEX, null) || { days: {} };
    const out = [];
    const base = Date.parse(`${today}T00:00:00Z`);
    for (let i = includeToday ? 0 : 1; i <= 21; i += 1) {
      const d = new Date(base - i * 86400000).toISOString().slice(0, 10);
      if (weekday(d) && ix.days[d] === undefined) out.push(d);
    }
    return out;
  }

  /**
   * Study what is due: today (once the session is over) and up to three earlier days not yet seen.
   * One at a time. @returns { studied: [{ date, symbols, tests }], days, tests, lessons }
   */
  run({ force = false } = {}) {
    if (this.running) return this.running;
    this.running = this._run({ force }).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  async _run({ force }) {
    const now = this.now();
    const today = istDate(now);
    const over = minuteOfDay(now) >= 15 * 60 + 40 || !weekday(today);
    const missing = this._missing(today, { includeToday: over && weekday(today) });
    // today (once the session is over, or again when asked), then at most three earlier days not yet seen
    const due = [...(over && weekday(today) && (force || missing.includes(today)) ? [today] : []), ...missing.filter((d) => d !== today).slice(0, BACKFILL)];
    const studied = [];
    for (const d of due) studied.push(await this.studyDate(d));
    const { summary, lessons: written } = this.rebuild();
    const rec = { at: new Date(now).toISOString(), studied, days: summary.days, tests: summary.tests, lessons: written, by: force ? "asked" : "itself" };
    const runs = this.docs.read(RUNS, null) || { items: [] };
    runs.items = [rec, ...(runs.items || [])].slice(0, 30);
    this.docs.write(RUNS, runs);
    if (studied.some((x) => x.symbols)) this.log.log(`[learn] studied ${studied.filter((x) => x.symbols).map((x) => `${x.date} (${x.symbols} stocks, ${x.tests} tests)`).join(", ")}; ${summary.tests} tests over ${summary.days} days on record`);
    return rec;
  }

  /* ---------------------------------------------------------------------------- the clock */
  async tick() {
    const now = this.now();
    const today = istDate(now);
    if (!weekday(today) || minuteOfDay(now) < 15 * 60 + 40) return;
    if (now - this._tryAt < 10 * 60000) return;
    const ix = this.docs.read(INDEX, null) || { days: {} };
    if (ix.days[today] !== undefined && !this._missing(today, { includeToday: false }).length) return; // nothing is due
    if (typeof this.market.mode === "function" && this.market.mode() !== "kite") return; // the bars need the Zerodha connection
    this._tryAt = now;
    await this.run();
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.log.error(`[learn] ${err.message}`));
    }, 60000);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { LearnWatch, SECTION };
