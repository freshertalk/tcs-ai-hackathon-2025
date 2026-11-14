"use strict";
// Paper trading: the desk's own live call, followed with play money — never real money.
//
//   • Live market: every 5-minute close today, the live call is asked what it says (the same
//     engine and rules as the Desk and the Debrief: enter on a fresh "in play" call at the bar's
//     close, the call's stop, its first target, out on the opposite call or at the 3:15 PM
//     square-off). Each call becomes a paper trade, sized from the paper capital and the risk
//     per trade, and marked to the latest price while it is open.
//   • History: the same engine replayed over the last N finished sessions for the same stocks,
//     each session judged only on what was known before it.
//   • Auto mode: once switched on it does both by itself — today's paper trades every five
//     minutes in market hours, and after the close a fresh run over history — and keeps count
//     of how many paper trades the current setup has been tested on.
//
// Findings strong enough to trust (findings.js) are written into the trading-skills file, the
// file every AI request reads, so the desk learns from its own measured results.
//
// What it can never do: place, change or cancel an order. It is a separate system: nothing here
// loads the broker or the trading service, and it never reads or changes the real trading switch.
// Real trading on the desk works exactly as it does without it, whether paper mode is on or off.
// It is not advice and it promises nothing: a paper result leaves out slippage, partial fills
// and the feeling of real money.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { findingsOf, stats } = require("./findings");

const NAME = "paper/state.json";
const IST = 5.5 * 3600 * 1000;
const SECTION = "## Paper-test findings (written automatically)";
const MAX_LEDGER = 3000;
const DEFAULTS = { capital: 1000000, riskPct: 1, costPct: 0.1, sessions: 20 };
const LIMITS = { capital: [10000, 1e9], riskPct: [0.1, 5], costPct: [0, 1], sessions: [5, 60] };

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const istParts = (ms) => {
  const d = new Date(ms + IST);
  return { date: d.toISOString().slice(0, 10), dow: d.getUTCDay(), mins: d.getUTCHours() * 60 + d.getUTCMinutes() };
};

/**
 * The current setup's fingerprint: the rule files that decide every call, and the cost assumed.
 * A change to the engine (a deploy) or to the cost starts a new count, so the numbers shown are
 * always for the setup that is running now.
 */
function setupId(costPct) {
  const h = crypto.createHash("sha1");
  for (const f of ["replay.js", "verdict.js", "intraday.js", "analyze.js", "indicators.js"]) {
    try {
      h.update(fs.readFileSync(path.join(__dirname, "..", "market", f)));
    } catch (_) {
      h.update(f);
    }
  }
  h.update(String(costPct));
  return h.digest("hex").slice(0, 8);
}

/** Shares and rupees for one engine trade, from the paper capital and the risk per trade. */
function sizeTrade(t, { capital, riskPct, costPct }) {
  const riskRs = (capital * riskPct) / 100;
  const per = num(t.riskPerShare) && t.riskPerShare > 0 ? t.riskPerShare : null;
  if (!per || !num(t.entry) || t.entry <= 0) return { qty: 0, pnl: null };
  // never more shares than the paper capital can pay for
  const qty = Math.max(1, Math.min(Math.floor(riskRs / per), Math.floor(capital / t.entry)));
  const dir = t.side === "long" ? 1 : -1;
  const pnl = num(t.exit) ? r2((dir * (t.exit - t.entry) - (costPct / 100) * t.entry) * qty) : null;
  return { qty, pnl };
}

/** One line of totals for a list of paper trades. */
function summarize(trades) {
  const done = trades.filter((t) => t.why !== "open" && num(t.netR));
  const s = stats(done.map((t) => t.netR));
  let run = 0;
  let peak = 0;
  let dip = 0;
  for (const t of done) {
    run += t.pnl || 0;
    peak = Math.max(peak, run);
    dip = Math.min(dip, run - peak);
  }
  const wins = done.filter((t) => t.netR > 0);
  const losses = done.filter((t) => t.netR < 0);
  const gain = wins.reduce((a, t) => a + (t.pnl || 0), 0);
  const loss = -losses.reduce((a, t) => a + (t.pnl || 0), 0);
  return {
    trades: trades.length,
    finished: done.length,
    open: trades.length - done.length,
    wins: wins.length,
    losses: losses.length,
    winPct: s.winPct,
    netR: s.sum,
    avgR: s.avg,
    t: s.t,
    pnl: r2(done.reduce((a, t) => a + (t.pnl || 0), 0)),
    profitFactor: loss > 0 ? r2(gain / loss) : null,
    deepestDip: r2(dip),
    target: done.filter((t) => t.why === "target").length,
    stop: done.filter((t) => t.why === "stop").length,
  };
}

class PaperError extends Error {
  constructor(message, code = "invalid", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class PaperService {
  /**
   * @param market    the MarketService (prices, the replay engine) — read only
   * @param playbook  the trading-skills file (server/ai/playbook.js)
   */
  constructor({ market, playbook = null, docs, now = () => Date.now(), log = console, isHoliday = () => false }) {
    this.market = market;
    this.playbook = playbook;
    this.docs = docs;
    this.now = now;
    this.log = log;
    this.isHoliday = isHoliday;
    this.timer = null;
    this.job = null; // the history run in progress
    this._liveAt = 0;
  }

  /* --------------------------------------------------------------- state */

  _state() {
    const d = this.docs.read(NAME, null);
    const s = d && typeof d === "object" ? d : {};
    return {
      auto: false,
      autoSince: null,
      settings: { ...DEFAULTS, ...(s.settings || {}) },
      symbols: Array.isArray(s.symbols) ? s.symbols : null, // null: the watchlist
      day: s.day && s.day.date ? s.day : { date: null, trades: [] },
      ledger: Array.isArray(s.ledger) ? s.ledger : [],
      history: s.history || null,
      findings: s.findings || null,
      lastRuns: s.lastRuns || {},
      log: Array.isArray(s.log) ? s.log : [],
      ...("auto" in s ? { auto: Boolean(s.auto), autoSince: s.autoSince || null } : {}),
    };
  }

  _save(s) {
    this.docs.write(NAME, s);
  }

  _note(s, text) {
    s.log = [{ at: new Date(this.now()).toISOString(), text }, ...s.log].slice(0, 40);
  }

  /** True while auto mode is on. */
  isOn() {
    return this._state().auto;
  }

  _symbols(s) {
    const list = s.symbols && s.symbols.length ? s.symbols : this.market.watchlist();
    return list.slice(0, 15);
  }

  status() {
    const s = this._state();
    const id = setupId(s.settings.costPct);
    const mine = (t) => t.setup === id;
    const live = [...s.ledger.filter(mine), ...s.day.trades.filter(mine)];
    const hist = s.history && s.history.setup === id ? s.history.trades : [];
    return {
      paperOnly: true,
      auto: s.auto,
      autoSince: s.autoSince,
      settings: s.settings,
      symbols: this._symbols(s),
      customSymbols: Boolean(s.symbols && s.symbols.length),
      setup: id,
      connected: this.market.mode() === "kite",
      // how many paper trades the current setup has been tested on, and how they went
      tested: { total: live.length + hist.length, live: summarize(live), history: summarize(hist), all: summarize([...hist, ...live]) },
      today: { date: s.day.date, trades: s.day.trades.slice().reverse(), summary: summarize(s.day.trades) },
      recentLive: s.ledger.filter(mine).slice(-60).reverse(),
      history: s.history
        ? { at: s.history.at, setup: s.history.setup, current: s.history.setup === id, sessions: s.history.sessions, symbols: s.history.symbols, from: s.history.from, to: s.history.to, failures: s.history.failures || [], summary: summarize(s.history.trades), bySymbol: s.history.bySymbol || [], byDay: s.history.byDay || [], trades: s.history.trades.slice(-80).reverse() }
        : null,
      job: this.job ? { running: !this.job.finishedAt, done: this.job.done, total: this.job.total, symbol: this.job.symbol, startedAt: this.job.startedAt, error: this.job.error || "" } : null,
      findings: s.findings,
      lastRuns: s.lastRuns,
      log: s.log.slice(0, 15),
    };
  }

  /* ------------------------------------------------------------ settings */

  setSettings(patch = {}, symbols) {
    const s = this._state();
    for (const k of Object.keys(LIMITS)) {
      if (patch[k] === undefined || patch[k] === null || patch[k] === "") continue;
      const v = Number(patch[k]);
      if (!Number.isFinite(v) || v < LIMITS[k][0] || v > LIMITS[k][1]) throw new PaperError(`"${k}" must be between ${LIMITS[k][0]} and ${LIMITS[k][1]}.`);
      s.settings[k] = k === "sessions" || k === "capital" ? Math.round(v) : r2(v);
    }
    if (symbols !== undefined) {
      const list = Array.isArray(symbols) ? symbols : String(symbols || "").split(/[,\s]+/);
      const clean = [...new Set(list.map((x) => String(x || "").trim().toUpperCase()).filter((x) => /^[A-Z0-9][A-Z0-9&._-]{0,24}$/.test(x)))].slice(0, 15);
      s.symbols = clean.length ? clean : null;
    }
    this._save(s);
    return this.status();
  }

  /**
   * Auto mode on or off. On: today's paper trades start at once if the market is open. It has no
   * effect of any kind on real trading.
   */
  setAuto(on) {
    const s = this._state();
    if (on) {
      s.auto = true;
      s.autoSince = new Date(this.now()).toISOString();
      this._note(s, "Auto mode ON.");
    } else {
      s.auto = false;
      this._note(s, "Auto mode OFF.");
    }
    this._save(s);
    if (on) this.liveStep({ force: true }).catch((err) => this.log.log(`[paper] ${err.message}`));
    return this.status();
  }

  /* ------------------------------------------------------- live market */

  /**
   * Today's paper trades: the live call replayed on today's 5-minute bars so far, for every
   * stock, turned into sized paper trades. Called every few minutes in market hours.
   */
  async liveStep({ force = false } = {}) {
    if (this.market.mode() !== "kite") return { ran: false, reason: "Zerodha is not connected." };
    const now = this.now();
    if (!force && now - this._liveAt < 4 * 60000) return { ran: false, reason: "Ran a moment ago." };
    this._liveAt = now;
    let s = this._state();
    const today = istParts(now).date;
    const id = setupId(s.settings.costPct);
    const fresh = [];
    for (const symbol of this._symbols(s)) {
      try {
        const r = await this.market.replay(symbol, { costPct: s.settings.costPct });
        if (!r.available || r.date !== today) continue;
        for (const t of r.trades) {
          const size = sizeTrade(t, s.settings);
          fresh.push({ ...t, symbol, date: r.date, setup: id, source: "live", qty: size.qty, pnl: size.pnl });
        }
      } catch (err) {
        this.log.log(`[paper] ${symbol}: ${err.message}`);
      }
    }
    s = this._state(); // the record may have changed while the prices were read
    // a new session: the last one's finished paper trades go to the ledger first
    if (s.day.date && s.day.date !== today) this._closeDay(s);
    s.day = { date: today, trades: fresh, at: new Date(now).toISOString() };
    this._save(s);
    return { ran: true, trades: fresh.length };
  }

  /** At the close: today's paper trades are final; they join the ledger. */
  _closeDay(s) {
    if (!s.day.date) return;
    const done = s.day.trades.filter((t) => t.why !== "open");
    const key = (t) => `${t.symbol}|${t.date}|${t.at}|${t.side}`;
    const have = new Set(s.ledger.map(key));
    s.ledger = [...s.ledger, ...done.filter((t) => !have.has(key(t)))].slice(-MAX_LEDGER);
    this._note(s, `${s.day.date}: ${done.length} paper trade${done.length === 1 ? "" : "s"} in the live market, ${summarize(done).pnl ?? 0} rupees on paper.`);
    s.day = { date: null, trades: [] };
  }

  /* ------------------------------------------------------------ history */

  /** Start a run over history (one at a time). The page follows status().job. */
  startHistory({ by = "manual" } = {}) {
    if (this.market.mode() !== "kite") throw new PaperError("Paper trading on history needs the Zerodha connection: the 5-minute bars come from it.", "not_connected", 409);
    if (this.job && !this.job.finishedAt) throw new PaperError("A paper test is already running. Wait for it to finish.", "busy", 409);
    const s = this._state();
    const symbols = this._symbols(s);
    if (!symbols.length) throw new PaperError("Add stocks to the watchlist (or list them here) first.", "invalid");
    this.job = { by, total: symbols.length, done: 0, symbol: "", startedAt: new Date(this.now()).toISOString(), finishedAt: null };
    this._runHistory(symbols, s.settings).catch((err) => {
      this.job.error = err.message;
      this.job.finishedAt = new Date(this.now()).toISOString();
    });
    return this.status();
  }

  async _runHistory(symbols, settings) {
    const job = this.job;
    const id = setupId(settings.costPct);
    const trades = [];
    const failures = [];
    const bySymbol = [];
    const days = new Map();
    for (const symbol of symbols) {
      job.symbol = symbol;
      try {
        const r = await this.market.replayHistory(symbol, { sessions: settings.sessions, costPct: settings.costPct });
        if (!r.available) failures.push(`${symbol}: ${r.reason}`);
        const mine = [];
        for (const sess of r.sessions || []) {
          for (const t of sess.trades) {
            if (t.why === "open") continue;
            const size = sizeTrade(t, settings);
            const row = { ...t, symbol, date: sess.date, setup: id, source: "history", qty: size.qty, pnl: size.pnl };
            mine.push(row);
            const d = days.get(sess.date) || [];
            d.push(row);
            days.set(sess.date, d);
          }
        }
        trades.push(...mine);
        bySymbol.push({ symbol, sessions: (r.sessions || []).length, ...summarize(mine) });
      } catch (err) {
        failures.push(`${symbol}: ${err.message}`);
      }
      job.done += 1;
    }
    trades.sort((a, b) => (a.date + a.at < b.date + b.at ? -1 : 1));
    const byDay = [...days.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, list]) => ({ date, ...summarize(list) }));
    const s = this._state();
    s.history = { at: new Date(this.now()).toISOString(), setup: id, sessions: settings.sessions, symbols, from: byDay.length ? byDay[0].date : null, to: byDay.length ? byDay[byDay.length - 1].date : null, trades, bySymbol, byDay, failures: failures.slice(0, 10) };
    s.lastRuns.history = istParts(this.now()).date;
    this._note(s, `Paper test on history: ${trades.length} trades over ${byDay.length} sessions × ${symbols.length} stocks (setup ${id}).`);
    this._learn(s, id);
    this._save(s);
    job.finishedAt = new Date(this.now()).toISOString();
    this.log.log(`[paper] history run: ${trades.length} paper trades, ${failures.length} failures`);
  }

  /* -------------------------------------------------------------- learn */

  /**
   * Work out what the current setup's paper trades show, and write the findings that pass the
   * bar into the trading-skills file. The section is rewritten each time — never appended to —
   * so it always says what the latest evidence says, and an old finding the data no longer
   * supports disappears.
   */
  _learn(s, id) {
    const all = [...(s.history && s.history.setup === id ? s.history.trades : []), ...s.ledger.filter((t) => t.setup === id)];
    const f = findingsOf(all);
    const date = istParts(this.now()).date;
    s.findings = { at: new Date(this.now()).toISOString(), setup: id, total: f.total, minTrades: f.minTrades, minT: f.minT, slices: f.slices, findings: f.findings, written: false };
    if (!this.playbook || typeof this.playbook.setSection !== "function") return;
    const intro = `Measured by following the desk's live call with paper money — on past sessions and in the live market — under setup ${id}, ${f.total} finished paper trades, results after an assumed ${s.settings.costPct}% cost per round trip. Rewritten after every paper test (${date}); only slices with ${f.minTrades}+ trades and |t| ≥ ${f.minT} appear. Paper results leave out slippage and partial fills.`;
    const lines = f.findings.length ? f.findings.map((x) => `- ${x.text}`) : [`- Nothing measured strongly enough yet (${f.total} finished paper trades). No rule is changed by this test.`];
    try {
      this.playbook.setSection(SECTION, `${intro}\n${lines.join("\n")}`);
      s.findings.written = true;
    } catch (err) {
      s.findings.error = err.message;
    }
  }

  /* --------------------------------------------------------------- auto */

  /** Called every minute. Live paper trades in market hours; after the close, a run over history. */
  tick() {
    const s = this._state();
    if (!s.auto || this.market.mode() !== "kite") return null;
    const t = istParts(this.now());
    if (t.dow === 0 || t.dow === 6 || this.isHoliday(t.date)) return null;
    if (t.mins >= 9 * 60 + 20 && t.mins <= 15 * 60 + 31) {
      this.liveStep().catch((err) => this.log.log(`[paper] ${err.message}`));
      return "live";
    }
    if (t.mins >= 15 * 60 + 40 && t.mins <= 20 * 60) {
      if (s.day.date === t.date && s.lastRuns.closed !== t.date) {
        // one last look at the finished session, then it is final
        this.liveStep({ force: true })
          .then(() => {
            const x = this._state();
            this._closeDay(x);
            x.lastRuns.closed = t.date;
            this._save(x);
          })
          .catch((err) => this.log.log(`[paper] ${err.message}`));
        return "close";
      }
      if (s.lastRuns.history !== t.date && !(this.job && !this.job.finishedAt)) {
        try {
          this.startHistory({ by: "auto" });
          return "history";
        } catch (err) {
          this.log.log(`[paper] ${err.message}`);
        }
      }
    }
    return null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (err) {
        this.log.log(`[paper] ${err.message}`);
      }
    }, 60000);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Forget the paper record (settings stay). */
  reset() {
    const s = this._state();
    s.day = { date: null, trades: [] };
    s.ledger = [];
    s.history = null;
    s.findings = null;
    s.lastRuns = {};
    this._note(s, "Paper record cleared.");
    this._save(s);
    return this.status();
  }
}

module.exports = { PaperService, PaperError, sizeTrade, summarize, setupId, SECTION, DEFAULTS };
