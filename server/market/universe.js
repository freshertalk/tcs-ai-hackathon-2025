"use strict";
// The whole NSE cash market, for the screener.
//
// To say what a stock's RSI is "right now" for every stock at once, two things
// are needed: each stock's recent daily closes, and its price this moment.
//
//   • Closes: downloaded once from Zerodha (one request per stock, about a year of
//     daily bars) and kept in one compact file. That first download takes several
//     minutes for ~2,000 stocks because the API allows three requests a second.
//   • After that it rolls forward by itself: every quote carries the previous
//     session's close, so one batch of quotes brings every series up to date with
//     no further downloads.
//   • Price now: a batch quote for the whole list (500 stocks per request).
//
// A series that no longer agrees with the exchange (a split or bonus re-bases
// every past price) is left out of the results and downloaded again in the
// background, rather than shown with a wrong RSI.

const fs = require("fs");
const path = require("path");
const I = require("./indicators");

const num = I.isNum;
const IST = 5.5 * 3600 * 1000;
const DAY = 86400000;
const KEEP = 260; // closes kept per stock: about a year
const HISTORY_DAYS = 420; // calendar days asked for → roughly 285 sessions
const BATCH = 400; // instruments per quote request: the API allows 500, this keeps the request line comfortably short
const MAX_ROWS = 600;
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const r1 = (x) => (num(x) ? Math.round(x * 10) / 10 : null);
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);

// "-BE", "-SM", "-GS", "-N1" … are other series, bonds and gilts; "BAJAJ-AUTO" is a company.
const OTHER_SERIES = /-[A-Z0-9]{2}$/;
const isFund = (symbol, name) => /ETF|BEES$|^LIQUID/i.test(symbol) || /\bETF\b|EXCHANGE TRADED|\bBEES\b|\bLIQUID\b/i.test(name || "");

/** Which instruments are in the screener: NSE cash equities, main series only. */
function membersOf(instruments) {
  return instruments
    .filter((it) => it.k === "EQ" && it.s && !OTHER_SERIES.test(it.s))
    .map((it) => ({ s: it.s, n: it.n || "", t: it.t, fund: isFund(it.s, it.n) }));
}

/**
 * The trading calendar around "now", read from the Nifty's own daily bars.
 *   d0     the session the quotes' "previous close" belongs to
 *   before the session before that
 *   after  true when a session after d0 has begun (so a live price is a new session's price)
 * The Nifty quote's previous close is matched to a bar by value; that is what tells
 * a pre-open morning (previous close = yesterday, nothing traded yet) from a trading day.
 */
function calendarFrom(candles, niftyQuote, today) {
  const dates = candles.map((c) => c.t);
  let i = -1;
  if (niftyQuote && num(niftyQuote.prevClose) && niftyQuote.prevClose > 0) {
    for (let k = candles.length - 1; k >= Math.max(0, candles.length - 6); k -= 1) {
      if (Math.abs(candles[k].c / niftyQuote.prevClose - 1) < 0.0002) {
        i = k;
        break;
      }
    }
  }
  if (i < 0) i = dates[dates.length - 1] === today ? dates.length - 2 : dates.length - 1;
  if (i < 1) return null;
  return { d0: dates[i], before: dates[i - 1], after: i < dates.length - 1, dates: dates.slice(-40) };
}

/**
 * Bring one stored series to "the close of d0", and say whether the live price is a new bar.
 * @param rec { d: date of the last stored close, c: [closes] }
 * @param q   { last, prevClose, time }
 * @returns { base, live, rolled } or { stale: reason }
 */
function resolveSeries(rec, q, cal) {
  let base = rec.c;
  let d = rec.d;
  let rolled = false;
  if (!Array.isArray(base) || base.length < 2 || !d) return { stale: "empty" };

  // bars stored for sessions after d0 (downloaded while today's bar was still forming): the live price replaces them
  if (d > cal.d0) {
    const extra = cal.dates.filter((x) => x > cal.d0 && x <= d).length || 1;
    base = base.slice(0, -extra);
    d = cal.d0;
    if (base.length < 2) return { stale: "empty" };
  }
  const lastClose = base[base.length - 1];
  const prev = num(q.prevClose) && q.prevClose > 0 ? q.prevClose : null;

  if (d === cal.d0) {
    // the stored close for d0 and the exchange's previous close are the same number, unless prices were re-based
    if (prev && Math.abs(lastClose / prev - 1) > 0.03) return { stale: "rebased" };
  } else if (d === cal.before) {
    if (!prev) return { stale: "no-previous-close" };
    // no stock moves more than its 20% band in a session: a bigger jump is a split, a bonus or a demerger
    if (Math.abs(prev / lastClose - 1) > 0.22) return { stale: "rebased" };
    base = [...base, prev];
    rolled = true;
  } else return { stale: "old" };

  const traded = q.time ? String(q.time).slice(0, 10) > cal.d0 : cal.after;
  return { base, live: Boolean(traded), rolled };
}

/** RSI now (with the live price as the newest bar) and at the previous close. */
function rsiNow(base, last, live, period) {
  const series = live ? [...base, last] : base;
  if (series.length <= period + 1) return null;
  const arr = I.rsi(series, period);
  const now = arr[arr.length - 1];
  const prev = live ? arr[arr.length - 2] : null;
  return num(now) ? { now, prev: num(prev) ? prev : null } : null;
}

class Universe {
  /** @param market the MarketService: instruments, quotes, history and the clock all come from it */
  constructor({ dir, market }) {
    this.file = path.join(dir, "universe.json");
    this.market = market;
    this.data = null;
    this.job = { running: false, done: 0, total: 0, failed: 0, error: "", startedAt: null, finishedAt: null };
    this._quotes = null;
    this._healing = false;
  }

  _load() {
    if (this.data) return this.data;
    try {
      const d = JSON.parse(fs.readFileSync(this.file, "utf8"));
      this.data = d && d.symbols ? d : null;
    } catch (_) {
      this.data = null;
    }
    if (!this.data) this.data = { version: 1, syncedAt: null, symbols: {} };
    return this.data;
  }

  _save() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this._load()));
    fs.renameSync(tmp, this.file);
  }

  status() {
    const d = this._load();
    const recs = Object.values(d.symbols);
    // the date most series end on
    const counts = new Map();
    recs.forEach((r) => counts.set(r.d, (counts.get(r.d) || 0) + 1));
    const through = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const j = this.job;
    const perItem = j.running && j.done > 5 ? (this.market.now() - Date.parse(j.startedAt)) / j.done : 400;
    return {
      ready: recs.length > 0,
      symbols: recs.length,
      funds: recs.filter((r) => r.fund).length,
      syncedAt: d.syncedAt,
      through: through ? through[0] : null,
      job: { running: j.running, done: j.done, total: j.total, failed: j.failed, error: j.error, startedAt: j.startedAt, finishedAt: j.finishedAt, etaSeconds: j.running ? Math.round(((j.total - j.done) * perItem) / 1000) : 0 },
    };
  }

  async _history(token) {
    const now = this.market.now();
    // a rate-limit answer is retried after a pause; anything else is the caller's to handle
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.market._call((k) => k.historical(token, "day", new Date(now - HISTORY_DAYS * DAY), new Date(now)));
      } catch (err) {
        if (err && err.status === 429 && attempt < 3) await new Promise((r) => setTimeout(r, this.market.universePauseMs || 2500));
        else throw err;
      }
    }
  }

  _pack(candles, m, today) {
    const tail = candles.slice(-KEEP);
    const last20 = candles.slice(-20);
    const turnover = last20.reduce((s, c) => s + c.c * (c.v || 0), 0) / last20.length / 1e7;
    return { n: m.n, d: tail[tail.length - 1].t, c: tail.map((c) => r2(c.c)), to: r2(turnover), fund: m.fund || undefined, at: today };
  }

  /** Only the stocks the screener covers (the Nifty 100), when the market service sets a list. */
  _scope(members) {
    const set = this.market.indexList ? this.market.indexList.symbols() : null;
    return set ? members.filter((m) => set.has(m.s)) : members;
  }

  /** Start (or report) the background download. It resumes where an interrupted run stopped. */
  start({ force = false } = {}) {
    if (this.job.running) return this.status();
    if (this.market.mode() !== "kite") throw Object.assign(new Error("Connect Zerodha first: the stock list and prices come from it."), { code: "not_connected", status: 409 });
    this.job = { running: true, done: 0, total: 0, failed: 0, error: "", startedAt: new Date(this.market.now()).toISOString(), finishedAt: null, stop: false };
    this._run(force).catch((err) => {
      this.job.running = false;
      this.job.error = err && err.message ? err.message : "The download stopped.";
      this.job.finishedAt = new Date(this.market.now()).toISOString();
    });
    return this.status();
  }

  stop() {
    if (this.job.running) this.job.stop = true;
    return this.status();
  }

  async _run(force) {
    const d = this._load();
    const members = this._scope(membersOf(await this.market.instruments()));
    const job = this.job;
    job.total = members.length;
    const today = istDate(this.market.now());
    let streak = 0; // requests that failed one after another
    for (const m of members) {
      if (job.stop) break;
      const have = d.symbols[m.s];
      // downloaded earlier today: nothing to do (this is what lets an interrupted run resume)
      if (!(have && have.at === today && !force)) {
        try {
          const candles = await this._history(m.t);
          streak = 0;
          if (candles.length >= 20) d.symbols[m.s] = this._pack(candles, m, today);
          else {
            delete d.symbols[m.s]; // too new to have an RSI
            job.failed += 1;
          }
        } catch (err) {
          if (err && (err.code === "not_connected" || err.tokenExpired)) throw new Error("The Kite session ended before the download finished. Log in to Kite and start it again — it carries on from where it stopped.");
          job.failed += 1;
          streak += 1;
          if (streak >= 15) {
            this._save();
            throw new Error("Zerodha stopped answering (15 requests failed in a row). Try again in a few minutes — it carries on from where it stopped.");
          }
        }
      }
      job.done += 1;
      if (job.done % 150 === 0) this._save();
    }
    if (!job.stop) {
      // listings that have left the exchange leave the screener
      const keep = new Set(members.map((m) => m.s));
      for (const s of Object.keys(d.symbols)) if (!keep.has(s)) delete d.symbols[s];
      d.syncedAt = new Date(this.market.now()).toISOString();
    }
    this._save();
    job.running = false;
    job.finishedAt = new Date(this.market.now()).toISOString();
  }

  /** Quotes for every stock in the universe, in batches, shared for 20 seconds. */
  async _liveQuotes(symbols) {
    const now = this.market.now();
    if (this._quotes && now - this._quotes.at < 20000) return this._quotes.map;
    const keys = ["NSE:NIFTY 50", ...symbols.map((s) => `NSE:${s}`)];
    const map = {};
    for (let i = 0; i < keys.length; i += BATCH) {
      const part = await this.market._call((k) => k.quotes(keys.slice(i, i + BATCH)));
      for (const [k, v] of Object.entries(part)) map[k.replace(/^NSE:/, "")] = v;
    }
    this._quotes = { at: now, map };
    return map;
  }

  /** Re-download a few series that no longer agree with the exchange. Runs behind the response. */
  _heal(symbols) {
    if (this._healing || this.job.running || symbols.length === 0) return;
    this._healing = true;
    (async () => {
      const d = this._load();
      const byName = new Map(membersOf(await this.market.instruments()).map((m) => [m.s, m]));
      const today = istDate(this.market.now());
      for (const s of symbols.slice(0, 40)) {
        const m = byName.get(s);
        if (!m) continue;
        try {
          const candles = await this._history(m.t);
          if (candles.length >= 20) d.symbols[s] = this._pack(candles, m, today);
        } catch (_) {
          break; // try again on a later search
        }
      }
      this._save();
    })()
      .catch(() => {})
      .finally(() => {
        this._healing = false;
      });
  }

  /**
   * Every stock whose RSI is inside [min, max] right now.
   * @param opts { min, max, period, minPrice, minTurnover (₹ crore a day, 20-day average), funds }
   */
  async scan({ min = null, max = null, period = 14, minPrice = 0, minTurnover = 0, funds = false } = {}) {
    const d = this._load();
    const set = this.market.indexList ? this.market.indexList.symbols() : null;
    const all = Object.entries(d.symbols).filter(([s]) => !set || set.has(s));
    if (all.length === 0) return { ready: false, rows: [], matched: 0, status: this.status() };

    const quotes = await this._liveQuotes(all.map(([s]) => s));
    const nifty = await this.market.daily("NIFTY 50");
    const cal = calendarFrom(nifty.candles, quotes["NIFTY 50"], istDate(this.market.now()));
    if (!cal) throw new Error("The trading calendar could not be read from the Nifty's history.");

    const rows = [];
    const skipped = { noQuote: 0, outOfDate: 0, tooShort: 0 };
    const mend = [];
    let considered = 0;
    let rolled = 0;
    for (const [s, rec] of all) {
      if (rec.fund && !funds) continue;
      considered += 1;
      const q = quotes[s];
      if (!q || !num(q.last) || q.last <= 0) {
        skipped.noQuote += 1;
        continue;
      }
      const r = resolveSeries(rec, q, cal);
      if (r.stale) {
        skipped.outOfDate += 1;
        mend.push(s);
        continue;
      }
      if (r.rolled) {
        rec.c = r.base.slice(-KEEP);
        rec.d = cal.d0;
        rolled += 1;
      }
      const rsi = rsiNow(r.base, q.last, r.live, period);
      if (!rsi) {
        skipped.tooShort += 1;
        continue;
      }
      if ((min !== null && rsi.now < min) || (max !== null && rsi.now > max)) continue;
      if (q.last < minPrice || (minTurnover > 0 && !(rec.to >= minTurnover))) continue;
      rows.push({
        symbol: s,
        name: rec.n,
        last: r2(q.last),
        changePct: r2(q.changePct),
        rsi: r1(rsi.now),
        rsiPrev: r1(rsi.prev),
        volume: q.volume ?? null,
        avgTurnoverCr: rec.to,
        fund: Boolean(rec.fund),
      });
    }
    if (rolled) this._save();
    this._heal(mend);

    // looking for low readings → lowest first; for high readings → highest first
    const high = min !== null && (max === null || min >= 50);
    rows.sort((a, b) => (high ? b.rsi - a.rsi : a.rsi - b.rsi));
    return {
      ready: true,
      at: new Date(this.market.now()).toISOString(),
      period,
      session: cal.d0,
      live: cal.after,
      considered,
      matched: rows.length,
      truncated: rows.length > MAX_ROWS,
      rows: rows.slice(0, MAX_ROWS),
      skipped,
      mending: mend.length,
      status: this.status(),
    };
  }
}

module.exports = { Universe, membersOf, calendarFrom, resolveSeries, rsiNow, KEEP };
