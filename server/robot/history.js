"use strict";
// The one-year history store: every NIFTY 100 stock's 5-minute bars for the last year, kept in the database
// (a collection of its own, robot_history, one record per stock) and topped up every evening, so that all the
// robot's learning rests on a year of real sessions rather than the thirty Zerodha lets a single request reach.
//
//   RECORD   one per stock: its bars packed column by column (time, open, high, low, close, volume) and
//            compressed (about 150 KB a stock for a year), the first and last bar, and the session it was
//            last brought up to date for. A stock is saved as soon as it is read, so a download that is
//            interrupted (a restart, Zerodha not reachable) carries on where it stopped.
//   READ     Zerodha's history API gives at most 100 days of 5-minute bars a request, so a year is read in
//            90-day windows, one stock at a time, well inside its limit of three requests a second. Nothing
//            is scraped; the bars come from the owner's own Zerodha connection.
//   KEEP     the last 400 calendar days; older bars are dropped as new ones arrive.
//   TOP UP   every evening the last ten days are read again for each stock and merged by time, so a late
//            correction or a missed day is filled in.
//
// The pure helpers (pack, unpack, merge, sessions) have no network, clock or database; the store takes the
// MarketService's two reads and the docs. It reads the market only: it cannot place an order.

const zlib = require("zlib");

const IST = 5.5 * 3600 * 1000;
const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => Math.round(x * 100) / 100;
const dateOf = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const minOf = (ms) => {
  const d = new Date(ms + IST);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const TABLE = "robot_history";
const KEEP_DAYS = 400;
const YEAR_DAYS = 370; // how far back the first download reaches
const WINDOW_DAYS = 90; // bars read per request (Zerodha allows 100 days of 5-minute bars)
const TOPUP_DAYS = 10;
const MIN_SESSION_BARS = 60; // a whole NSE session has 75 five-minute bars
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const msOf = (t) => {
  if (num(t)) return t;
  const x = String(t || "").replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  return Date.parse(/[+-]\d{2}:\d{2}$|Z$/.test(x) ? x : `${x}+05:30`);
};

/** Bars → { n, from, to, z }: columns, compressed. @param bars [{ t, o, h, l, c, v }] in time order */
function pack(bars) {
  const col = { t: [], o: [], h: [], l: [], c: [], v: [] };
  for (const b of bars) {
    col.t.push(Math.round(b.t / 1000));
    col.o.push(r2(b.o));
    col.h.push(r2(b.h));
    col.l.push(r2(b.l));
    col.c.push(r2(b.c));
    col.v.push(Math.round(b.v || 0));
  }
  return { n: bars.length, from: bars.length ? dateOf(bars[0].t) : null, to: bars.length ? dateOf(bars[bars.length - 1].t) : null, z: zlib.gzipSync(Buffer.from(JSON.stringify(col))).toString("base64") };
}

/** The bars of a record. */
function unpack(rec) {
  if (!rec || !rec.z) return [];
  const col = JSON.parse(zlib.gunzipSync(Buffer.from(rec.z, "base64")).toString("utf8"));
  const out = new Array(col.t.length);
  for (let i = 0; i < col.t.length; i += 1) out[i] = { t: col.t[i] * 1000, o: col.o[i], h: col.h[i], l: col.l[i], c: col.c[i], v: col.v[i] };
  return out;
}

/** Two lists of bars merged by time (the second wins on the same minute), the oldest beyond `keepDays` dropped. */
function merge(a, b, { keepDays = KEEP_DAYS, now = null } = {}) {
  const m = new Map();
  for (const x of a) m.set(x.t, x);
  for (const x of b) m.set(x.t, x);
  let out = [...m.values()].sort((x, y) => x.t - y.t);
  if (out.length && keepDays) {
    const edge = (num(now) ? now : out[out.length - 1].t) - keepDays * 86400000;
    out = out.filter((x) => x.t >= edge);
  }
  return out;
}

/** Whole sessions: Map date → bars, the unfinished ones (too few bars) left out. */
function sessions(bars, { minBars = MIN_SESSION_BARS } = {}) {
  const m = new Map();
  for (const b of bars) {
    const d = dateOf(b.t);
    (m.get(d) || m.set(d, []).get(d)).push(b);
  }
  for (const [d, list] of m) if (list.length < minBars) m.delete(d);
  return m;
}

/** The date of the last session that should be in the record: today after 3:35 PM on a weekday, else the weekday before. */
function expectedSession(now) {
  let d = new Date(now + IST);
  const afterClose = d.getUTCHours() * 60 + d.getUTCMinutes() >= 15 * 60 + 35;
  let day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const wk = (x) => x.getUTCDay() !== 0 && x.getUTCDay() !== 6;
  if (!(wk(day) && afterClose)) {
    do day = new Date(day.getTime() - 86400000);
    while (!wk(day));
  }
  return day.toISOString().slice(0, 10);
}

class HistoryStore {
  /**
   * @param market    the MarketService: instruments(), _instrument(symbol), _call(fn) — reads only
   * @param universe  () → the symbols to keep
   */
  constructor({ docs, market, universe, now = () => Date.now(), log = console, gapMs = 450 }) {
    this.docs = docs;
    this.market = market;
    this.universe = universe;
    this.now = now;
    this.log = log;
    this.gapMs = gapMs;
    this.job = null;
    this.lastError = "";
    this._tries = new Map(); // symbol → { n, at } (a stock that fails is tried again, a few times, ten minutes apart)
  }

  _tbl() {
    return typeof this.docs.items === "function" ? this.docs.items(TABLE) : [];
  }

  record(symbol) {
    return this._tbl().find((r) => r.id === symbol) || null;
  }

  bars(symbol) {
    return unpack(this.record(symbol));
  }

  /** What is stored and how far it reaches. */
  status() {
    const rows = this._tbl();
    const want = this.universe();
    const have = new Map(rows.map((r) => [r.id, r]));
    const expected = expectedSession(this.now());
    const target = dateOf(this.now() - YEAR_DAYS * 86400000);
    const stocks = want.map((s) => have.get(s)).filter(Boolean);
    const current = stocks.filter((r) => r.asOf && r.asOf >= expected).length;
    const deep = stocks.filter((r) => r.from && r.from <= dateOf(Date.parse(`${target}T00:00:00Z`) + 20 * 86400000)).length;
    const bars = stocks.reduce((a, r) => a + (r.n || 0), 0);
    const sess = stocks.length ? Math.max(...stocks.map((r) => r.sessions || 0)) : 0;
    return {
      stocks: stocks.length,
      expected: want.length,
      current,
      deep,
      sessions: sess,
      bars,
      kb: Math.round(stocks.reduce((a, r) => a + (r.z ? r.z.length * 0.75 : 0), 0) / 1024),
      from: stocks.length ? stocks.map((r) => r.from).filter(Boolean).sort()[0] : null,
      to: stocks.length ? stocks.map((r) => r.to).filter(Boolean).sort().pop() : null,
      asOf: expected,
      complete: want.length > 0 && stocks.length === want.length && current === want.length && deep >= Math.floor(want.length * 0.9),
      upToDate: want.length > 0 && current === want.length,
      running: Boolean(this.job && !this.job.finishedAt),
      job: this.job ? { ...this.job } : null,
      error: this.lastError,
    };
  }

  /** The stocks that still need reading, with how (a year, or a top-up). */
  needs() {
    const have = new Map(this._tbl().map((r) => [r.id, r]));
    const expected = expectedSession(this.now());
    const deepEdge = dateOf(Date.parse(`${dateOf(this.now() - YEAR_DAYS * 86400000)}T00:00:00Z`) + 20 * 86400000);
    const out = [];
    for (const s of this.universe()) {
      const r = have.get(s);
      const t = this._tries.get(s);
      if (t && t.n >= 3 && this.now() - t.at < 60 * 60000) continue;
      if (t && this.now() - t.at < 10 * 60000) continue;
      if (!r) out.push({ symbol: s, mode: "year" });
      else if (r.from > deepEdge && !r.shallow) out.push({ symbol: s, mode: "year" });
      else if (!r.asOf || r.asOf < expected) out.push({ symbol: s, mode: "topup" });
    }
    return out;
  }

  async _read(symbol, from, to) {
    const it = await this.market._instrument(symbol);
    const out = [];
    for (let end = to; end > from; end -= WINDOW_DAYS * 86400000) {
      const start = Math.max(from, end - WINDOW_DAYS * 86400000);
      const raw = await this.market._call((k) => k.historical(it.t, "5minute", new Date(start), new Date(end)));
      for (const b of raw || []) {
        const t = msOf(b.t);
        if (num(t) && [b.o, b.h, b.l, b.c].every(num)) out.push({ t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
      }
      if (this.gapMs && end - WINDOW_DAYS * 86400000 > from) await sleep(this.gapMs);
    }
    return out;
  }

  /**
   * Read what is missing for every stock that needs it — a year for one never read, ten days for the rest — and
   * save each stock as soon as it is read. One run at a time. Resolves with { stocks, failed } when done.
   */
  sync({ trigger = "itself", max = Infinity } = {}) {
    if (!this.market) return Promise.reject(new Error("The history needs the market connection."));
    if (this.job && !this.job.finishedAt) return Promise.resolve({ busy: true });
    const todo = this.needs().slice(0, max);
    this.job = { trigger, total: todo.length, done: 0, current: "", error: "", startedAt: new Date(this.now()).toISOString(), finishedAt: null, failed: 0 };
    return this._sync(todo).finally(() => {
      this.job.finishedAt = new Date(this.now()).toISOString();
    });
  }

  async _sync(todo) {
    if (typeof this.market.instruments === "function") await this.market.instruments();
    const now = this.now();
    const expected = expectedSession(now);
    const failed = [];
    let saved = 0;
    for (const x of todo) {
      this.job.current = x.symbol;
      try {
        const old = this.record(x.symbol);
        const from = x.mode === "year" || !old ? now - YEAR_DAYS * 86400000 : now - TOPUP_DAYS * 86400000;
        const fresh = await this._read(x.symbol, from, now);
        const bars = merge(old ? unpack(old) : [], fresh, { now });
        const sess = sessions(bars);
        const p = pack(bars);
        // a stock that only has a short history (a recent listing) is not asked for a year again
        const shallow = x.mode === "year" && fresh.length > 0 && p.from > dateOf(Date.parse(`${dateOf(now - YEAR_DAYS * 86400000)}T00:00:00Z`) + 20 * 86400000);
        this.docs.putItems(TABLE, [{ id: x.symbol, symbol: x.symbol, ...p, sessions: sess.size, asOf: expected, shallow: Boolean(shallow), at: new Date(now).toISOString() }]);
        this._tries.delete(x.symbol);
        saved += 1;
      } catch (err) {
        const t = this._tries.get(x.symbol) || { n: 0, at: 0 };
        this._tries.set(x.symbol, { n: t.n + 1, at: this.now() });
        failed.push({ symbol: x.symbol, error: String(err && err.message ? err.message : err).slice(0, 80) });
        this.job.failed += 1;
        this.lastError = `${x.symbol}: ${err && err.message ? err.message : err}`;
      }
      this.job.done += 1;
      if (this.gapMs) await sleep(this.gapMs);
    }
    if (!failed.length) this.lastError = "";
    if (saved) this.log.log(`[robot] history: ${saved} stock${saved === 1 ? "" : "s"} saved${failed.length ? `, ${failed.length} failed` : ""}`);
    return { stocks: saved, failed };
  }
}

module.exports = { HistoryStore, pack, unpack, merge, sessions, expectedSession, msOf, dateOf, minOf, TABLE, KEEP_DAYS, YEAR_DAYS };
