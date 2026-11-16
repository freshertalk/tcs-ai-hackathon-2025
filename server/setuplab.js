"use strict";
// The set-up lab: every classic intraday set-up (market/setups.js) measured on the NIFTY 100's own
// recent sessions, after costs — so the desk knows which of the textbook's set-ups have actually paid
// here, at what time of day, and which have lost money.
//
//   WHEN    each weekday evening after the close (from 3:45 PM IST) while Zerodha is connected, once a
//           day; once at a quiet hour if it has never run; or on request (Run now).
//   HOW     each NIFTY 100 stock's 5-minute bars for about the last 30 sessions are read from Zerodha's
//           history, one stock at a time, well inside its limit of three requests a second. Every set-up
//           is traded by its rules on those bars — the signal at a bar's close, the entry at the next
//           bar's open, out at the stop (first, when both fall in one bar), the target or 3:15 PM — with
//           Zerodha-style intraday charges on ₹1 lakh taken off. One trade per set-up, side and stock a day.
//   USE     the record per set-up and side (trades, share won, average R after costs, by time of day)
//           weighs each set-up in the live scanner's score; a short summary is written into the
//           trading-skills file every AI feature reads; TradeAI's agent and the scanner's AI review read
//           it. The textbook proposes, the measurement decides.
//
// It reads the market. It never trades. It lives outside server/ai (which holds no timers).

const SU = require("./market/setups");
const SNAP = require("./market/index-snapshots.json");
const { chargeParts } = require("./trading/journal");

/** The round trip's charges in rupees: Zerodha-style intraday equity on NSE (the journal's own calculation). */
function costOf(entry, exit, qty, long) {
  const buy = (long ? entry : exit) * qty;
  const sell = (long ? exit : entry) * qty;
  const p = chargeParts({ exchange: "NSE", turnoverBuy: buy, turnoverSell: sell, intraday: true });
  return p.brokerage + p.stt + p.exchange + p.sebi + p.gst + p.stamp;
}

const LAB = "setups/lab.json";
const SECTION = "## Intraday set-ups measured on this desk (written by itself)";
const DAYS = 45; // calendar days of 5-minute history: about 30 sessions
const GAP_MS = 400;
const MIN_TRADES = 30;
const IST = 5.5 * 3600 * 1000;
const num = (x) => typeof x === "number" && Number.isFinite(x);
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const istMin = (ms) => {
  const d = new Date(ms + IST);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const weekday = (ms) => {
  const d = new Date(ms + IST).getUTCDay();
  return d >= 1 && d <= 5;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class SetupLabError extends Error {
  constructor(message, code = "invalid", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class SetupLab {
  constructor({ market, ai = null, docs, now = () => Date.now(), log = console, universe = null, gapMs = GAP_MS }) {
    this.market = market;
    this.ai = ai;
    this.docs = docs;
    this.now = now;
    this.log = log;
    this.fixedUniverse = universe;
    this.gapMs = gapMs;
    this.job = null; // { at, trigger, done, total, current, error }
    this.timers = [];
    this._edges = null;
  }

  universe() {
    if (Array.isArray(this.fixedUniverse)) return this.fixedUniverse;
    let list = null;
    try {
      list = this.market.indexList ? this.market.indexList.list("nifty100") : null;
    } catch (_) {
      list = null;
    }
    return (list && list.length ? list : SNAP.indices.nifty100 || []).slice(0, 100);
  }

  _live() {
    try {
      return this.market.mode() === "kite" && Boolean(this.market.kiteState().connected);
    } catch (_) {
      return false;
    }
  }

  /** The saved record, or { available: false }. */
  view() {
    const d = this.docs ? this.docs.read(LAB, null) : null;
    const job = this.job ? { ...this.job } : null;
    if (!d) return { available: false, running: Boolean(job && !job.finishedAt), job, reason: "Not measured yet: the lab runs by itself each weekday evening after the close while Zerodha is connected, or on Run now." };
    return { available: true, ...d, running: Boolean(job && !job.finishedAt), job };
  }

  /** Each set-up and side's record ({ "orb:long": { n, winPct, avgR } }), for the live score. */
  edges() {
    const d = this.docs ? this.docs.read(LAB, null) : null;
    if (!d || !d.summary) return null;
    if (this._edges && this._edges.at === d.at) return this._edges.map;
    const map = {};
    for (const r of d.summary.rows || []) map[r.key] = { n: r.n, winPct: r.winPct, avgR: r.avgR };
    this._edges = { at: d.at, map };
    return map;
  }

  /** A short form for the AI (TradeAI's agent, the scanner's review). */
  brief() {
    const d = this.docs ? this.docs.read(LAB, null) : null;
    if (!d || !d.summary) return { available: false };
    return {
      available: true,
      at: d.at,
      basis: d.basis,
      sessions: d.sessions,
      stocks: d.stocks,
      setups: (d.summary.rows || []).filter((r) => r.n >= 10).map((r) => ({ setup: r.name, side: r.side, trades: r.n, wonPct: r.winPct, avgRAfterCosts: r.avgR, costR: r.avgCostR, byTime: r.hours.filter((h) => h.n >= 5).map((h) => `${h.label}: ${h.avgR}R over ${h.n}`) })),
    };
  }

  /** Run the lab now (one run at a time). Resolves when it is done. */
  run({ trigger = "itself" } = {}) {
    if (this.job && !this.job.finishedAt) throw new SetupLabError("The lab is already running.", "busy", 409);
    if (!this._live()) throw new SetupLabError("Connect Zerodha (live data) first: the lab reads its 5-minute history.", "not_connected", 409);
    const uni = this.universe();
    this.job = { at: new Date(this.now()).toISOString(), trigger, total: uni.length, done: 0, current: "", error: "", finishedAt: null };
    const p = this._run(uni).catch((err) => {
      this.job.error = err && err.message ? err.message : String(err);
      this.log.error(`[setuplab] ${this.job.error}`);
    }).finally(() => {
      this.job.finishedAt = new Date(this.now()).toISOString();
    });
    return p;
  }

  async _run(uni) {
    if (typeof this.market.instruments === "function") await this.market.instruments();
    const to = new Date(this.now());
    const from = new Date(this.now() - DAYS * 86400000);
    const trades = [];
    const days = new Set();
    let stocks = 0;
    const failed = [];
    for (const symbol of uni) {
      this.job.current = symbol;
      try {
        const it = await this.market._instrument(symbol);
        const raw = await this.market._call((k) => k.historical(it.t, "5minute", from, to));
        const bars = (raw || []).map((b) => ({ t: msOf(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })).filter((b) => num(b.t));
        // today's unfinished session is left out: only whole sessions are measured
        const today = istDate(this.now());
        const whole = istMin(this.now()) < 930 ? bars.filter((b) => istDate(b.t) !== today) : bars;
        if (whole.length > 200) {
          stocks += 1;
          for (const b of whole) days.add(istDate(b.t));
          for (const t of SU.backtest(whole, { symbol, cost: costOf })) trades.push(t);
        }
      } catch (err) {
        failed.push({ symbol, error: String(err && err.message ? err.message : err).slice(0, 80) });
      }
      this.job.done += 1;
      if (this.gapMs) await sleep(this.gapMs);
    }
    const summary = SU.summarize(trades);
    const sorted = [...days].sort();
    const rec = {
      at: new Date(this.now()).toISOString(),
      trigger: this.job.trigger,
      sessions: sorted.length,
      from: sorted[0] || null,
      to: sorted[sorted.length - 1] || null,
      stocks,
      trades: trades.length,
      failed: failed.slice(0, 20),
      basis: "NIFTY 100, 5-minute bars, the signal at a bar's close, entry at the next bar's open, out at the stop (first when both fall in one bar), the target or 3:15 PM, one trade per set-up, side and stock a day, Zerodha-style intraday charges on ₹1 lakh taken off",
      summary,
      // the best and worst stocks for each set-up are not kept: thirty sessions per stock are too few to rank stocks
    };
    this.docs.write(LAB, rec);
    this._edges = null;
    this._lessons(rec);
    this.log.log(`[setuplab] ${trades.length} trades over ${sorted.length} sessions of ${stocks} stocks`);
    return rec;
  }

  /** What has paid and what has lost, written into the trading-skills file every AI feature reads. */
  _lessons(rec) {
    if (!this.ai || !this.ai.playbook || !rec.summary) return;
    const rows = rec.summary.rows.filter((r) => r.n >= MIN_TRADES);
    if (!rows.length) return;
    const line = (r) => {
      const best = r.hours.filter((h) => h.n >= 10).sort((a, z) => z.avgR - a.avgR)[0];
      return `- ${r.name}, ${r.side}: ${r.n} trades, ${r.winPct}% won, ${r.avgR > 0 ? "+" : ""}${r.avgR}R a trade after costs${best && best.avgR > r.avgR ? ` (best ${best.label}: ${best.avgR > 0 ? "+" : ""}${best.avgR}R)` : ""}.`;
    };
    const paid = rows.filter((r) => r.avgR > 0.03).slice(0, 6);
    const lost = rows.filter((r) => r.avgR < -0.03).sort((a, z) => a.avgR - z.avgR).slice(0, 5);
    const body = [
      `Measured ${istDate(Date.parse(rec.at))} on the NIFTY 100's last ${rec.sessions} sessions (${rec.trades} trades): entry at the next 5-minute bar's open, out at the stop, the target or 3:15 PM, after intraday charges on ₹1 lakh. A guide to what has worked here lately, not a promise.`,
      paid.length ? "Has paid:" : "Nothing has paid after costs over this period.",
      ...paid.map(line),
      ...(lost.length ? ["Has lost money — avoid, or demand much more evidence:", ...lost.map(line)] : []),
    ].join("\n");
    try {
      this.ai.playbook.setSection(SECTION, body);
    } catch (err) {
      this.log.error(`[setuplab] the skills file was not updated: ${err.message}`);
    }
  }

  /** Once a minute: run after the close on a weekday (once a day), or once at a quiet hour if never run. */
  async tick() {
    if (this.job && !this.job.finishedAt) return;
    if (!this._live()) return;
    const now = this.now();
    const m = istMin(now);
    const last = this.docs.read(LAB, null);
    const ranToday = last && istDate(Date.parse(last.at)) === istDate(now);
    const evening = weekday(now) && m >= 945 && m < 1260; // 3:45–9:00 PM
    const quiet = !weekday(now) || m < 540 || m >= 945; // never during the session
    if ((evening && !ranToday) || (!last && quiet)) await this.run({ trigger: "itself" }).catch(() => {});
  }

  start() {
    if (this.timers.length) return;
    const t = setInterval(() => this.tick().catch(() => {}), 60000);
    if (t.unref) t.unref();
    this.timers.push(t);
  }

  stop() {
    this.timers.forEach((t) => clearInterval(t));
    this.timers = [];
  }
}

function msOf(t) {
  if (num(t)) return t;
  const x = String(t || "").replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  return Date.parse(/[+-]\d{2}:\d{2}$|Z$/.test(x) ? x : `${x}+05:30`);
}

module.exports = { SetupLab, SetupLabError, SECTION, LAB, costOf };
