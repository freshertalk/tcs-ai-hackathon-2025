"use strict";
// The morning call (server/market/morning.js does the arithmetic): for the stock open on the Desk, where it is likely to trade
// from the open to 9:45 AM and through the day, before the market opens and through its first half-hour.
//
//   WHEN    · the evening before and through the morning: an early read for the next session, from the expected open
//             (the opening-price forecast, or the GIFT Nifty's expected gap), the futures build-up and the stock's own days
//           · 9:00 – 9:08, the pre-open auction collects orders: the same, with the auction's order imbalance
//           · 9:08 – 9:15, the auction has set the opening price: the call is made again from that price (sharper)
//           · 9:15 – 9:45: made again at every 5-minute mark (9:15, 9:20 … 9:40) from the session so far
//           · from 9:45 the desk's live call, the 15-minute forecaster and the AI live read lead; the morning call is kept
//             on the page, scored
//   KEPT    one record per stock, session and stage (collection "morning_calls"): the last pre-market call before 9:08, the
//           last call before 9:15, and the call at each 5-minute mark. Every trading morning from 8:30 the watchlist is swept
//           so the record does not depend on a page being open.
//   SCORED  at 9:46 (where the price was at 9:45, the half-hour's high and low, the price 15 minutes after each call) and after
//           the close (the day's high, low and close), from the day's own 5-minute bars.
//   LEARNED every evening, once the stored history has the new session, the model is fitted again on the whole year of NIFTY 100
//           5-minute bars and tested on its newest fifth; after each scored day, the correction for the readings with no stored
//           history (futures build-up, the auction's imbalance, the setup and world leans, the order book) is fitted again and
//           switched on only where it has proved itself. The findings go into the trading-skills file every AI feature reads.
//
// It reads the market. It never trades, and it asks no AI model.

const M = require("./market/morning");
const { sessions: historySessions } = require("./robot/history");
const { sessionFor } = require("./market/session");

const IST = 5.5 * 3600 * 1000;
const COLLECTION = "morning_calls";
const MODEL = "market/morning-model.json";
const SECTION = "## What the desk has measured about the opening half-hour (written by itself after each session)";
const INDEX = "NIFTY 50";
const SWEEP_FROM = 8 * 60 + 30;
const AUCTION = 9 * 60; // the pre-open order collection begins
const DISCOVERED = 9 * 60 + 8; // the auction has set the opening price
const OPEN = 9 * 60 + 15;
const END = 9 * 60 + 45; // the live call, the forecaster and the AI live read lead from here
const SCORE_45 = 9 * 60 + 46;
const CLOSE = 15 * 60 + 30;
const SCORE_DAY = 15 * 60 + 40;
const LEARN_FROM = 16 * 60;
const KEEP_DAYS = 400;
const MAX_AUTO = 30;
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9&._ -]{0,24}$/;
const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const r3 = (x) => (num(x) ? Math.round(x * 1000) / 1000 : null);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const onTick = (x) => (num(x) ? Math.round(x / 0.05) * 0.05 : null);
const tick2 = (x) => r2(onTick(x));
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const minuteOfDay = (ms) => {
  const d = new Date(ms + IST);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const weekday = (date) => {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
};
const clockOf = (min) => `${((Math.floor(min / 60) + 11) % 12) + 1}:${String(min % 60).padStart(2, "0")} ${min >= 720 ? "PM" : "AM"}`;
/** "09:15" → 0, "09:20" → 1 … */
const slotOfClock = (hhmm) => {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return num(h) && num(m) ? Math.round((h * 60 + m - OPEN) / 5) : -1;
};
const imbalance = (b, s) => (num(b) && num(s) && b + s > 0 ? r3((b - s) / (b + s)) : null);
const BUILD_SIGN = { "long build-up": 1, "short covering": 0.5, "long unwinding": -0.5, "short build-up": -1 };

class MorningError extends Error {
  constructor(message, code = "morning", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class Morning {
  /**
   * @param market        the MarketService (daily bars, quotes, the 5-minute tape, the market forecast, the NFO list) — reads only
   * @param docs          the record store
   * @param history       the robot's stored 5-minute history (or a function returning it): record(symbol), bars(symbol), status()
   * @param universe      () => the stocks the history keeps (the NIFTY 100)
   * @param openForecast  the opening-price forecast (its expected open for a stock), optional
   * @param setup         the trade setup (a stock's futures build-up, the market's lean), optional
   * @param guard         the training guard (server/train-guard.js), optional
   * @param playbook      the trading-skills file, optional
   */
  constructor({ market, docs, history = null, universe = () => [], openForecast = null, setup = null, guard = null, playbook = null, isTradingDay = weekday, now = () => Date.now(), log = console }) {
    this.market = market;
    this.docs = docs;
    this.history = history;
    this.universe = universe;
    this.openForecast = openForecast;
    this.setup = setup;
    this.guard = guard;
    this.playbook = playbook;
    this.isTradingDay = isTradingDay;
    this.now = now;
    this.log = log;
    this.timer = null;
    this._map = null;
    this._model = undefined;
    this._rev = 0;
    this._cue = null;
    this._enrich = new Map();
    this._habits = new Map();
    this._training = null;
    this._lastError = "";
    this._sweepAt = 0;
    this._scoreAt = 0;
    this._learnTriedOn = "";
    this._fno = null;
  }

  /* --------------------------------------------------------------------------- the record and the model */
  _recs() {
    if (!this._map) this._map = new Map(this.docs.items(COLLECTION).map((r) => [r.id, r]));
    return this._map;
  }
  _save(rec) {
    this._rev += 1;
    this._recs().set(rec.id, rec);
    this.docs.putItems(COLLECTION, [rec]);
  }
  /** Changes whenever a call is kept or scored, or the model is fitted again (the live hub compares it). */
  fingerprint() {
    const m = this.model();
    return `${this._rev}|${m ? m.trainedAt : ""}|${m && m.soft ? m.soft.at || "" : ""}`;
  }
  model() {
    if (this._model === undefined) {
      const m = this.docs.read(MODEL, null);
      this._model = m && m.version === M.MODEL_VERSION && Array.isArray(m.perK) && m.perK.length === M.CHECKS ? m : null;
    }
    return this._model;
  }
  _store() {
    return typeof this.history === "function" ? this.history() : this.history;
  }
  _connected() {
    return typeof this.market.mode === "function" && this.market.mode() === "kite";
  }
  _nextTradingDay(date) {
    let t = Date.parse(`${date}T00:00:00Z`);
    for (let i = 0; i < 15; i += 1) {
      t += 86400000;
      const d = new Date(t).toISOString().slice(0, 10);
      if (weekday(d) && this.isTradingDay(d)) return d;
    }
    return new Date(t).toISOString().slice(0, 10);
  }

  /** What the model is and how far it has learned, for a page and the health check. */
  status() {
    const m = this.model();
    const store = this._store();
    let hist = null;
    try {
      hist = store && typeof store.status === "function" ? store.status() : null;
    } catch (_) {
      hist = null;
    }
    return {
      trained: Boolean(m),
      trainedAt: m ? m.trainedAt : null,
      trainedTo: m ? m.trainedTo : null,
      sessions: m ? m.sessions : 0,
      testSessions: m ? m.testSessions : 0,
      stocks: m ? m.stocks : 0,
      rows: m ? m.rows : 0,
      busy: Boolean(this._training),
      error: this._lastError,
      history: hist ? { stocks: hist.stocks || 0, sessions: hist.sessions || 0, to: hist.to || null } : null,
      calls: this._recs().size,
    };
  }

  /* --------------------------------------------------------------------------- learning */
  /**
   * Fit the model on the whole stored history and test it on its newest fifth. `trigger` "you asked" is never refused by the
   * training guard; "itself" waits when the guard says so.
   */
  async train({ trigger = "itself" } = {}) {
    if (this._training) return this._training;
    const wait = this.guard ? this.guard.wait("morning-train", trigger) : "";
    if (wait) return { ok: false, reason: `Not now: ${wait}.` };
    const run = (async () => {
      const store = this._store();
      if (!store || typeof store.bars !== "function") throw new MorningError("There is no stored history to learn from yet. It is the NIFTY 100's year of 5-minute bars that Paper trading downloads.", "no_history", 409);
      const symbols = (this.universe() || []).filter((s) => {
        try {
          return Boolean(store.record(s));
        } catch (_) {
          return false;
        }
      });
      const rows = M.rowsFrom(symbols, (s) => store.bars(s), (bars) => historySessions(bars));
      const model = M.train(rows, { now: this.now() });
      if (!model) throw new MorningError(`Too little stored history to learn from: ${rows.dates.length} sessions and ${rows.n} stock-sessions (60 sessions and 500 are needed).`, "too_little", 409);
      model.soft = this._softFit(model);
      this.docs.write(MODEL, model);
      this._model = model;
      this._rev += 1;
      this._lastError = "";
      this._teach();
      this.log.log(`[morning] learned from ${model.sessions} sessions of ${model.stocks} stocks (${model.rows} stock-sessions); tested on the newest ${model.testSessions}`);
      return { ok: true, ...this.status() };
    })();
    const tracked = this.guard ? this.guard.track("morning-train", trigger, run) : run;
    this._training = tracked
      .catch((err) => {
        this._lastError = err.message || String(err);
        throw err;
      })
      .finally(() => {
        this._training = null;
      });
    return this._training;
  }

  /** The correction for the readings with no stored history, from the scored calls. */
  _softFit(model) {
    const recs = [...this._recs().values()].filter((r) => r.y && r.y.cD !== undefined && r.soft && r.pred && r.engine === "model");
    const s = M.softFrom(recs.map((r) => ({ date: r.date, soft: r.soft, pred: r.pred, y: r.y })));
    return { ...s, at: new Date(this.now()).toISOString(), from: model ? model.trainedAt : null };
  }

  /* --------------------------------------------------------------------------- the inputs */
  /** The market's expected gap and the overnight lean (the desk's market forecast), shared for three minutes. */
  async _marketCue(now) {
    if (this._cue && now - this._cue.at < 180000) return this._cue.v;
    let v = { gapPct: null, lean: null, source: "none" };
    try {
      const f = typeof this.market.marketForecast === "function" ? await this.market.marketForecast({}) : null;
      if (f && f.available) v = { gapPct: f.open && num(f.open.gapPct) ? f.open.gapPct : null, lean: f.lean && num(f.lean.score) ? clamp(f.lean.score / 100, -1, 1) : null, source: "GIFT Nifty and overseas markets", label: f.open ? f.open.label || "" : "" };
    } catch (_) {
      /* no cue: the stock's own days still speak */
    }
    this._cue = { at: now, v };
    return v;
  }

  /** Whether a stock has a closing auction (it is in the F&O list) — that sets its square-off time. Unknown = yes (earlier). */
  async _hasAuction(symbol) {
    const today = istDate(this.now());
    if (!this._fno || this._fno.day !== today) {
      try {
        const list = typeof this.market.derivatives === "function" ? await this.market.derivatives() : [];
        this._fno = { day: today, set: list && list.length ? new Set(list.filter((x) => x.y === "FUT").map((x) => x.n)) : null };
      } catch (_) {
        this._fno = { day: today, set: null };
      }
    }
    return this._fno.set ? this._fno.set.has(symbol) : true;
  }

  /** When intraday (MIS) positions are squared off today, for this stock. */
  async squareOff(symbol) {
    const today = istDate(this.now());
    const cas = symbol === INDEX ? true : await this._hasAuction(symbol);
    const s = sessionFor(today, { cas });
    return {
      clock: s.squareOffClock,
      min: s.squareOffMin,
      cas,
      note: `Zerodha squares off intraday (MIS) positions in ${symbol} automatically at ${s.squareOffClock}${cas ? " (a stock in the F&O list, with a closing auction)" : " (a stock with no closing auction)"}, and charges for each order it has to close itself. Be flat before that.${s.unconfirmed ? ` ${s.unconfirmed}` : ""}`,
    };
  }

  /** The previous sessions as day summaries — from the daily bars, with the last hour and the first minutes' volume where the stored history has them. */
  async _prior(symbol, target) {
    const d = await this.market.daily(symbol);
    const candles = ((d && d.candles) || []).filter((c) => String(c.t).slice(0, 10) < target).slice(-70);
    const prior = candles.map(M.fromCandle);
    const key = `${symbol}|${target}`;
    let extra = this._enrich.get(key);
    if (!extra) {
      extra = new Map();
      const store = this._store();
      try {
        if (store && store.record(symbol)) {
          const m = historySessions(store.bars(symbol));
          for (const [date, bars] of m) if (date < target) extra.set(date, M.daySummary(date, bars));
        }
      } catch (_) {
        /* no stored bars for this stock */
      }
      if (this._enrich.size > 80) this._enrich.clear();
      this._enrich.set(key, extra);
    }
    for (const p of prior) {
      const e = extra.get(p.date);
      if (e) {
        p.lastHour = e.lastHour;
        p.firstVol = e.firstVol;
      }
    }
    return prior;
  }

  /** This stock's own first half-hour and day, measured on its recent sessions — for when the model has not learned. */
  async _ownHabits(symbol, atr, target) {
    const key = `${symbol}|${target}`;
    if (this._habits.has(key)) return this._habits.get(key);
    let out = null;
    try {
      let list = [];
      const store = this._store();
      if (store && store.record(symbol)) list = [...historySessions(store.bars(symbol))].filter(([d]) => d < target).slice(-60).map(([date, bars]) => ({ date, bars }));
      if (list.length < 8 && typeof this.market.candles === "function") {
        const c = await this.market.candles(symbol, "5minute", { days: 60 });
        const bars = ((c && c.candles) || []).map((b) => ({ ...b, t: M.msOf(b.t) })).filter((b) => num(b.t));
        list = [...historySessions(bars)].filter(([d]) => d < target).map(([date, b]) => ({ date, bars: b }));
      }
      out = M.ownHabits(list, atr);
    } catch (_) {
      out = null;
    }
    if (this._habits.size > 80) this._habits.clear();
    this._habits.set(key, out);
    return out;
  }

  /** Readings with no stored history, each −1…+1 or absent. */
  _soft(symbol, { cue, q, stage }) {
    const soft = {};
    try {
      if (this.setup && typeof this.setup.forStock === "function") {
        const t = this.setup.forStock(symbol);
        const b = t && (t.live || t.prev);
        if (b && BUILD_SIGN[b.kind] !== undefined) soft.oi = r3(BUILD_SIGN[b.kind] * clamp(Math.abs(b.oiChangePct || 0) / 5, 0.2, 1));
      }
      if (this.setup && typeof this.setup.leanNow === "function") {
        const l = this.setup.leanNow();
        if (num(l) && l !== 0) soft.setup = r3(clamp(l, -1, 1));
      }
    } catch (_) {
      /* the setup is optional */
    }
    if (cue && num(cue.lean)) soft.world = r3(cue.lean);
    if (q && (stage === "preopen" || stage === "auction")) {
      const v = imbalance(q.buyQty, q.sellQty);
      if (num(v)) soft.preImb = v;
    }
    if (q && stage === "opening") {
      const v = imbalance(q.buyQty, q.sellQty);
      if (num(v)) soft.book = v;
    }
    return soft;
  }

  /* --------------------------------------------------------------------------- the call */
  /** The stage of the morning now, and the session it is for. */
  _stage(now) {
    const today = istDate(now);
    const min = minuteOfDay(now);
    const trading = weekday(today) && this.isTradingDay(today);
    const target = trading && min < CLOSE ? today : this._nextTradingDay(today);
    let stage;
    if (target !== today) stage = "next";
    else if (min < AUCTION) stage = "pre";
    else if (min < DISCOVERED) stage = "preopen";
    else if (min < OPEN) stage = "auction";
    else if (min < END) stage = "opening";
    else stage = "handover";
    return { today, target, min, stage, k: stage === "opening" ? clamp(Math.floor((min - OPEN) / 5), 0, M.CHECKS - 1) : 0 };
  }

  /**
   * The call for one stock now.
   * @returns the call (see view) or { reason }
   */
  async _make(symbol, at) {
    const { today, target, min, stage } = at;
    let { k } = at;
    const prior = await this._prior(symbol, target);
    const ctx = M.contextOf(prior.slice(-60));
    if (!ctx) return { reason: "Too little daily history for this stock (21 sessions are needed)." };
    const now = this.now();
    const cue = await this._marketCue(now);
    let qs = {};
    try {
      qs = (await this.market.quotes([symbol, INDEX])).quotes || {};
    } catch (_) {
      qs = {};
    }
    const q = target === today ? qs[symbol] || null : null;
    const qi = target === today ? qs[INDEX] || null : null;
    const prevClose = ctx.prevClose;

    /* the open, and the market's gap */
    let open = null;
    let openSource = "";
    let openBand = null;
    let mktGapPct = cue.gapPct;
    let mktSource = num(cue.gapPct) ? "GIFT Nifty's expected gap" : "no overnight cue";
    let indicative = null;
    if (stage === "next" || stage === "pre" || stage === "preopen") {
      const hint = this.openForecast && typeof this.openForecast.peek === "function" ? this.openForecast.peek(symbol) : null;
      if (hint && hint.date === target && num(hint.predicted)) {
        open = hint.predicted;
        openBand = num(hint.low) && num(hint.high) ? [hint.low, hint.high] : null;
        openSource = "the opening-price forecast";
      } else {
        open = prevClose * (1 + (num(mktGapPct) ? mktGapPct : 0) / 100);
        openSource = num(mktGapPct) ? "the market's expected gap" : "the last close (no overnight cue yet)";
      }
      if (stage === "preopen" && q && num(q.last) && q.last > 0 && Math.abs(q.last - prevClose) > 1e-9) {
        // 9:00 – 9:08: the auction's indicative price is the best estimate of the open there is (it settles at 9:08)
        indicative = q.last;
        open = q.last;
        openSource = "the auction's indicative price (it settles at 9:08)";
      }
    } else if (stage === "auction") {
      const p = q && num(q.last) && q.last > 0 ? q.last : q && num(q.open) && q.open > 0 ? q.open : null;
      if (!num(p)) return { reason: "The auction's price is not in the quote yet." };
      open = p;
      openSource = "the pre-open auction's price (9:08)";
      if (qi && num(qi.last) && num(qi.prevClose) && qi.prevClose > 0 && Math.abs(qi.last - qi.prevClose) > 1e-9) {
        mktGapPct = ((qi.last - qi.prevClose) / qi.prevClose) * 100;
        mktSource = "the Nifty's pre-open price";
      }
    }

    /* the session so far */
    let done = [];
    let last = null;
    let mktMvPct = 0;
    if (stage === "opening" || stage === "handover") {
      let tape = null;
      try {
        tape = await this.market.tape(symbol, 5);
      } catch (_) {
        tape = null;
      }
      const bars = tape && tape.available && tape.tape && tape.tape.today ? tape.tape.bars : [];
      open = q && num(q.open) && q.open > 0 ? q.open : bars.length ? bars[0].o : null;
      if (!num(open)) return { reason: "No trade yet today in this stock." };
      openSource = "today's open";
      last = q && num(q.last) && q.last > 0 ? q.last : bars.length ? bars[bars.length - 1].c : open;
      done = bars.filter((b) => slotOfClock(b.t) >= 0 && slotOfClock(b.t) < k).sort((a, b) => slotOfClock(a.t) - slotOfClock(b.t));
      k = Math.min(k, done.length);
      if (qi && num(qi.open) && qi.open > 0 && num(qi.prevClose) && qi.prevClose > 0) {
        mktGapPct = ((qi.open - qi.prevClose) / qi.prevClose) * 100;
        mktSource = "the Nifty's open";
        if (num(qi.last)) mktMvPct = ((qi.last - qi.open) / qi.open) * 100;
      }
    }

    const soft = this._soft(symbol, { cue, q, stage });
    const x = M.featuresOf(ctx, { open, mktGapPct: num(mktGapPct) ? mktGapPct : 0, k, bars: done, last: k > 0 ? last : open, mktMvPct });
    const L = k > 0 ? last : open;
    const a = ctx.atr;
    const model = this.model();
    let y;
    let engine;
    let chances = null;
    let band45 = null;
    let drivers = [];
    let lean = null;
    let habits = null;
    if (model) {
      const p = M.predict(model, k, x, soft);
      y = p.y;
      band45 = p.band45;
      chances = { up45: p.up45, up15: p.up15, upDay: p.upDay };
      drivers = M.driversOf(model, k, x);
      engine = "model";
    } else {
      habits = await this._ownHabits(symbol, a, target);
      lean = M.ruleLean({ x, soft, k });
      const tilt = lean.score * 0.15; // a small, stated push from the votes: no record is claimed for it
      y = {
        c15: tilt * 0.5,
        c45: tilt,
        u45: habits ? habits.u45 : 0.35,
        d45: habits ? habits.d45 : -0.35,
        cD: tilt * 1.5,
        uD: habits ? habits.uD : 0.6,
        dD: habits ? habits.dD : -0.6,
      };
      if (k > 0) {
        // part of the half-hour has gone: what is left of the usual range is smaller
        const left = Math.sqrt((M.WIN - k) / M.WIN);
        y.u45 *= left;
        y.d45 *= left;
      }
      y.u45 = Math.max(0, y.u45, y.c45);
      y.d45 = Math.min(0, y.d45, y.c45);
      y.uD = Math.max(y.u45, y.uD, y.cD);
      y.dD = Math.min(y.d45, y.dD, y.cD);
      engine = "rules";
    }

    /* the levels, in rupees */
    const lv = (v) => tick2(L + v * a);
    let hiSoFar = null;
    let loSoFar = null;
    if (done.length || stage === "opening") {
      hiSoFar = Math.max(...done.map((b) => b.h), num(last) ? last : -Infinity, open);
      loSoFar = Math.min(...done.map((b) => b.l), num(last) ? last : Infinity, open);
    }
    const first30 = { high: tick2(Math.max(lv(y.u45), num(hiSoFar) ? hiSoFar : -Infinity)), low: tick2(Math.min(lv(y.d45), num(loSoFar) ? loSoFar : Infinity)) };
    const at945 = { price: lv(y.c45), band: band45 ? [lv(band45[0]), lv(band45[1])] : null };
    const dayLv = { high: tick2(Math.max(lv(y.uD), first30.high)), low: tick2(Math.min(lv(y.dD), first30.low)), close: lv(y.cD) };
    const callMin = stage === "opening" ? OPEN + 5 * k : OPEN;
    const next15 = { at: clockOf(Math.max(callMin, stage === "opening" ? min : OPEN) + 15), price: lv(y.c15) };

    /* the lean */
    let side = "none";
    let p45 = null;
    if (engine === "model" && chances.up45) {
      p45 = chances.up45.p;
      side = p45 >= 0.55 ? "up" : p45 <= 0.45 ? "down" : "none";
    } else if (lean) side = lean.side;
    const strength = engine === "model" && num(p45) ? (Math.abs(p45 - 0.5) >= 0.12 ? "strong" : Math.abs(p45 - 0.5) >= 0.05 ? "slight" : "none") : side === "none" ? "none" : "rules";

    const pct = (v) => (num(v) && L > 0 ? r2(((v - L) / L) * 100) : null);
    const call = {
      engine,
      stage,
      k,
      madeAt: new Date(now).toISOString(),
      at: stage === "opening" ? clockOf(callMin) : stage === "auction" ? "9:08 AM" : stage === "preopen" ? "9:00 AM" : stage === "pre" ? "before 9:00 AM" : "for the next session",
      from: { price: r2(L), what: k > 0 ? `the price at ${clockOf(callMin)}` : openSource },
      prevClose: r2(prevClose),
      atr: r2(a),
      open: { price: tick2(open), band: openBand ? openBand.map(tick2) : null, source: openSource, gapPct: r2(((open - prevClose) / prevClose) * 100), indicative: tick2(indicative), known: stage === "opening" || stage === "handover" || stage === "auction" },
      market: { gapPct: r2(mktGapPct), source: mktSource, movePct: stage === "opening" ? r2(mktMvPct) : null },
      side,
      strength,
      chances: chances
        ? {
            up45: chances.up45 ? { p: chances.up45.p, n: chances.up45.n } : null,
            up15: chances.up15 ? { p: chances.up15.p, n: chances.up15.n } : null,
            upDay: chances.upDay ? { p: chances.upDay.p, n: chances.upDay.n } : null,
          }
        : null,
      levels: {
        next15: { ...next15, changePct: pct(next15.price) },
        at945: { ...at945, changePct: pct(at945.price) },
        first30,
        day: dayLv,
        soFar: num(hiSoFar) ? { high: tick2(hiSoFar), low: tick2(loSoFar) } : null,
      },
      pred: Object.fromEntries(M.TARGETS.map((t) => [t, r3(y[t])])),
      soft,
      drivers,
      lean,
      habits: habits ? { n: habits.n } : null,
      plan: planOf({ side, L, open: tick2(open), first30, dayLv, at945, stage, k }),
    };
    return { call, L, open, atr: a, prevClose, x };
  }

  /** Keep the call in the record (only this morning's, only the stages that are scored). */
  _keep(symbol, at, made) {
    const { today, target, stage, min } = at;
    if (target !== today || !["pre", "preopen", "auction", "opening"].includes(stage)) return;
    const c = made.call;
    const key = stage === "pre" || stage === "preopen" ? "pre" : stage === "auction" ? "auction" : `o${c.k}`;
    const id = `${today}|${symbol}|${key}`;
    const had = this._recs().get(id);
    // the pre-market and auction calls are replaced until their stage ends (the last one stands); a 5-minute call stands as first made
    if (had && key.startsWith("o")) return;
    if (had && had.y) return;
    this._save({
      id,
      date: today,
      symbol,
      stage: key,
      k: c.k,
      engine: c.engine,
      madeAt: c.madeAt,
      madeMin: min,
      L: made.L,
      open: made.open,
      atr: made.atr,
      prevClose: made.prevClose,
      openKnown: c.open.known,
      pred: c.pred,
      p45: c.chances && c.chances.up45 ? c.chances.up45.p : null,
      side: c.side,
      band45: c.levels.at945.band,
      levels: { at945: c.levels.at945.price, high30: c.levels.first30.high, low30: c.levels.first30.low, dayHigh: c.levels.day.high, dayLow: c.levels.day.low },
      soFar: c.levels.soFar,
      soft: c.soft,
    });
  }

  /**
   * Everything the Desk shows for one stock: the call for this moment, what has been kept today and how it did, the record by
   * stage and the model's own test, and when MIS positions are squared off.
   */
  async view(symbol) {
    if (!SYMBOL_RE.test(symbol)) throw new MorningError("That is not a valid symbol.", "invalid");
    const at = this._stage(this.now());
    const squareOff = await this.squareOff(symbol).catch(() => null);
    const base = { symbol, stage: at.stage, target: at.target, squareOff, record: this._liveRecord(), model: this._modelCard(), at: new Date(this.now()).toISOString() };
    const todays = this._todays(symbol, at.today);
    if (!this._connected()) return { ...base, available: false, show: false, today: todays, reason: "The morning call needs real prices: connect Zerodha." };
    if (symbol === INDEX) return { ...base, available: false, show: false, today: todays, reason: "The morning call is made for stocks." };
    if (at.stage === "handover") {
      // from 9:45 the live call leads: the morning call stays on the page, scored, until the close
      return { ...base, available: todays.length > 0, show: false, handover: true, today: todays, reason: todays.length ? "" : "The morning call covers 9:00 – 9:45 AM; the live call and the 15-minute forecaster lead now." };
    }
    let made;
    try {
      made = await this._make(symbol, at);
    } catch (err) {
      return { ...base, available: false, show: true, today: todays, reason: err.message || "The morning call could not be made." };
    }
    if (!made || !made.call) return { ...base, available: false, show: true, today: todays, reason: (made && made.reason) || "The morning call could not be made." };
    this._keep(symbol, at, made);
    return { ...base, available: true, show: true, call: made.call, today: this._todays(symbol, at.today), rule: RULE };
  }

  /** A short form for other parts of the desk (the AI's brief, the pulse before 9:35): the call, or null. */
  async peek(symbol) {
    try {
      const v = await this.view(symbol);
      return v && v.available && v.call ? v.call : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * The Live Pulse's shape from the morning call, for the first twenty minutes after the open, when the pulse has fewer than
   * four 5-minute bars to read. The AI live read stands on it from 9:15. Calls "wait" while the desk takes no entries.
   */
  async pulseLike(symbol, day) {
    const min = minuteOfDay(this.now());
    if (min < OPEN || min >= OPEN + 20) return null;
    const c = await this.peek(symbol);
    if (!c) return null;
    const last = num(c.from.price) ? c.from.price : null;
    const a = c.atr;
    const lean = c.side === "up" ? "up" : c.side === "down" ? "down" : "sideways";
    const p = c.chances && c.chances.up45 ? c.chances.up45.p : null;
    const score = num(p) ? Math.round((p - 0.5) * 200) : c.lean ? Math.round(c.lean.score * 100) : 0;
    const confidence = num(p) ? Math.round(Math.abs(p - 0.5) * 200) : 0;
    const entriesOff = !(day && day.session && day.session.entries);
    const plan = (side) => {
      const long = side === "long";
      const stop = long ? Math.min(c.levels.first30.low, last - 0.15 * a) : Math.max(c.levels.first30.high, last + 0.15 * a);
      const dist = clamp(Math.abs(last - stop), 0.12 * a, 0.8 * a);
      return { side, entry: tick2(last), stop: tick2(long ? last - dist : last + dist), targets: [tick2(long ? last + dist : last - dist), tick2(long ? last + 2 * dist : last - 2 * dist)], riskPerShare: r2(dist), riskPct: r2((dist / last) * 100), rewardToRisk: 1, basis: "the morning call's half-hour range, held between 0.12 and 0.8 of a normal day's range; targets at 1R and 2R", matchesEngine: false, engine: null };
    };
    return {
      available: true,
      early: true,
      last,
      call: "wait",
      lean,
      score,
      confidence,
      agreement: confidence,
      headline: `${c.side === "none" ? "No clear lean" : `Leans ${c.side.toUpperCase()}`} — the morning call at ${c.at}${num(p) ? ` (${Math.round(p * 100)}% of similar test sessions rose by 9:45)` : ""}; the opening range is still forming`,
      gates: entriesOff ? ["Opening range forming: no fresh intraday entries before 9:30."] : [],
      components: [{ name: "Morning call", vote: r2(score / 100), weight: 1, reading: `${c.engine === "model" ? "the learned model" : "fixed rules"}: 9:45 near ₹${c.levels.at945.price}, half-hour ${c.levels.first30.low} – ${c.levels.first30.high}` }],
      window: { minutes: 30, typicalMove: r2((c.levels.first30.high - c.levels.first30.low) / 2), low: c.levels.first30.low, high: c.levels.first30.high, basis: "the morning call's expected high and low before 9:45" },
      plans: { long: plan("long"), short: plan("short") },
      you: null,
      patterns: [],
      stats: { dailyAtr: r2(a), atr5: null, m15Pct: null, m30Pct: null, rsi5: null, volumeSurge: null, vsVwapPct: null },
      rule: "Before 9:35 there are too few 5-minute bars for the pulse: the morning call (the learned model of the first half-hour, or fixed rules before it has learned) stands in for it. It calls 'wait' while the opening range forms.",
    };
  }

  /** This stock's calls today, newest first, with how each did. */
  _todays(symbol, today) {
    return [...this._recs().values()]
      .filter((r) => r.symbol === symbol && r.date === today)
      .sort((a, b) => (a.madeAt < b.madeAt ? 1 : -1))
      .map((r) => {
        // what had already traded when the call was made counts toward the half-hour's and the day's high and low
        const hi = (v) => tick2(Math.max(r.L + v * r.atr, r.soFar && num(r.soFar.high) ? r.soFar.high : -Infinity));
        const lo = (v) => tick2(Math.min(r.L + v * r.atr, r.soFar && num(r.soFar.low) ? r.soFar.low : Infinity));
        return {
        stage: r.stage,
        madeAt: r.madeAt,
        engine: r.engine,
        side: r.side,
        p45: r.p45,
        from: r2(r.L),
        levels: r.levels,
        result: r.y45 ? { at945: tick2(r.L + r.y45.c45 * r.atr), high30: hi(r.y45.u45), low30: lo(r.y45.d45), right: r.right45, inBand: r.inBand45 } : null,
        day: r.y && r.y.cD !== undefined ? { high: hi(r.y.uD), low: lo(r.y.dD), close: tick2(r.L + r.y.cD * r.atr) } : null,
      };
      });
  }

  /* --------------------------------------------------------------------------- scoring */
  /** The day's bars for a scored call: today's tape, or the stored history for an earlier day. */
  async _barsOn(symbol, date) {
    const today = istDate(this.now());
    if (date === today) {
      const t = await this.market.tape(symbol, 5);
      if (!t || !t.available || !t.tape || !t.tape.today) return [];
      return t.tape.bars.map((b) => ({ ...b, slot: slotOfClock(b.t) })).sort((a, b) => a.slot - b.slot);
    }
    const store = this._store();
    if (!store || !store.record(symbol)) return [];
    const m = historySessions(store.bars(symbol));
    return (m.get(date) || []).map((b) => ({ ...b, slot: M.slotOf(b.t) }));
  }

  /** Score what has come due: the half-hour from 9:46, the day after the close. @returns how many calls were scored */
  async score() {
    const now = this.now();
    const today = istDate(now);
    const min = minuteOfDay(now);
    const edge = istDate(now - 4 * 86400000);
    const due = [...this._recs().values()].filter((r) => r.date >= edge && !r.void && (!r.y45 || !r.y) && (r.date < today || min >= SCORE_45));
    const bySym = new Map();
    for (const r of due) (bySym.get(`${r.date}|${r.symbol}`) || bySym.set(`${r.date}|${r.symbol}`, []).get(`${r.date}|${r.symbol}`)).push(r);
    let n = 0;
    for (const [key, recs] of bySym) {
      const [date, symbol] = key.split("|");
      let bars;
      try {
        bars = await this._barsOn(symbol, date);
      } catch (_) {
        continue;
      }
      const aligned = bars.length >= M.WIN && bars.slice(0, M.WIN).every((b, i) => b.slot === i);
      const dayDone = date < today || min >= SCORE_DAY;
      for (const r of recs) {
        if (!aligned) {
          if (date < istDate(now - 3 * 86400000)) {
            r.void = "the day's bars could not be read";
            this._save(r);
          }
          continue;
        }
        const y = M.targetsOf(bars, r.k, r.L, r.atr);
        const get = (t) => r3(y[M.TARGETS.indexOf(t)]);
        let changed = false;
        if (!r.y45) {
          r.y45 = { c15: get("c15"), c45: get("c45"), u45: get("u45"), d45: get("d45") };
          const called = r.side === "up" || r.side === "down";
          r.right45 = called && r.y45.c45 !== 0 ? (r.side === "up") === r.y45.c45 > 0 : null;
          const p945 = r.L + r.y45.c45 * r.atr;
          r.inBand45 = Array.isArray(r.band45) && num(r.band45[0]) ? p945 >= r.band45[0] && p945 <= r.band45[1] : null;
          r.scored45At = new Date(now).toISOString();
          changed = true;
        }
        if (dayDone && !r.y && bars.length >= 60) {
          r.y = { c15: get("c15"), c45: get("c45"), u45: get("u45"), d45: get("d45"), cD: get("cD"), uD: get("uD"), dD: get("dD") };
          r.scoredAt = new Date(now).toISOString();
          changed = true;
        }
        if (changed) {
          this._save(r);
          n += 1;
        }
      }
    }
    return n;
  }

  /** Earlier records beyond the keep window are dropped. */
  _prune() {
    const edge = istDate(this.now() - KEEP_DAYS * 86400000);
    const old = [...this._recs().values()].filter((r) => r.date < edge);
    if (!old.length) return;
    for (const r of old) this._recs().delete(r.id);
    if (typeof this.docs.removeItems === "function") this.docs.removeItems(COLLECTION, old.map((r) => r.id));
    this._rev += 1;
  }

  /* --------------------------------------------------------------------------- the record shown */
  /** How the desk's own calls did, by stage, over the last 60 sessions. */
  _liveRecord() {
    const edge = istDate(this.now() - 90 * 86400000);
    const groups = { pre: "Before the auction", auction: "After the auction (9:08)", opening: "9:15 – 9:40" };
    const out = [];
    for (const [g, label] of Object.entries(groups)) {
      const rows = [...this._recs().values()].filter((r) => r.date >= edge && r.y45 && (g === "opening" ? r.stage.startsWith("o") : r.stage === g));
      const called = rows.filter((r) => r.right45 !== null && r.right45 !== undefined);
      const right = called.filter((r) => r.right45).length;
      const banded = rows.filter((r) => r.inBand45 !== null && r.inBand45 !== undefined);
      const hiMiss = rows.length ? rows.reduce((s, r) => s + Math.abs(r.y45.u45 - (r.pred.u45 || 0)), 0) / rows.length : null;
      const loMiss = rows.length ? rows.reduce((s, r) => s + Math.abs(r.y45.d45 - (r.pred.d45 || 0)), 0) / rows.length : null;
      out.push({
        group: g,
        label,
        calls: rows.length,
        sessions: new Set(rows.map((r) => r.date)).size,
        called: called.length,
        right,
        rate: called.length ? r3(right / called.length) : null,
        inBand: banded.length ? r3(banded.filter((r) => r.inBand45).length / banded.length) : null,
        highMissAtr: r3(hiMiss),
        lowMissAtr: r3(loMiss),
      });
    }
    return out;
  }

  /** The model's own test, in short, for the page. */
  _modelCard() {
    const m = this.model();
    if (!m) {
      const st = this.status();
      return {
        trained: false,
        busy: st.busy,
        error: st.error,
        why: st.history && st.history.sessions ? `Learning from the stored history (${st.history.stocks} stocks) happens by itself in the evening; it can also be started now.` : "It learns from the NIFTY 100's stored year of 5-minute bars (Paper trading downloads it). Until then the call uses fixed rules and this stock's own recent sessions, and claims no record.",
      };
    }
    const at = (k) => {
      const s = m.perK[k].stats;
      return {
        k,
        clock: clockOf(OPEN + 5 * k),
        dir45: s.c45.dir,
        dirDay: s.cD.dir,
        skill: { high30: s.u45.skill, low30: s.d45.skill, dayHigh: s.uD.skill, dayLow: s.dD.skill, at945: s.c45.skill },
        band: [s.c45.q15, s.c45.q85],
      };
    };
    return {
      trained: true,
      trainedAt: m.trainedAt,
      trainedTo: m.trainedTo,
      sessions: m.sessions,
      testSessions: m.testSessions,
      testFrom: m.testFrom,
      stocks: m.stocks,
      rows: m.rows,
      checks: [0, 3, 5].map(at),
      soft: m.soft ? { c45: pickSoft(m.soft.c45), cD: pickSoft(m.soft.cD) } : null,
      busy: Boolean(this._training),
    };
  }

  /** The whole picture for a page: the model's test at every checkpoint and the live record. */
  board() {
    const m = this.model();
    return {
      status: this.status(),
      model: this._modelCard(),
      perK: m ? m.perK.map((p) => ({ k: p.k, clock: clockOf(OPEN + 5 * p.k), testSessions: p.test.sessions, stats: Object.fromEntries(Object.entries(p.stats).map(([t, s]) => [t, { mae: s.mae, base: s.base, skill: s.skill, dir: s.dir || null }])) })) : [],
      record: this._liveRecord(),
      lessons: this.lessons(),
      rule: RULE,
    };
  }

  /** The findings in plain words (the trading-skills file, the page). */
  lessons() {
    const m = this.model();
    const out = [];
    if (m) {
      const k0 = m.perK[0].stats;
      const k3 = m.perK[3].stats;
      const pc = (x) => (num(x) ? `${Math.round(x * 100)}%` : "—");
      out.push(`The opening half-hour model learned from ${m.sessions} sessions of ${m.stocks} NIFTY 100 stocks and was tested on the newest ${m.testSessions} it never saw.`);
      if (k0.c45.dir) out.push(`At the open (from the gap, the market's gap and the previous days) the direction to 9:45 was right on ${pc(k0.c45.dir.rate)} of the ${k0.c45.dir.called} test calls that leaned; at 9:30 on ${pc(k3.c45.dir && k3.c45.dir.rate)}.`);
      out.push(`Against simply expecting the usual range, the predicted half-hour high was ${pc(k0.u45.skill)} closer at the open and ${pc(k3.u45.skill)} closer at 9:30; the day's high ${pc(k0.uD.skill)} and low ${pc(k0.dD.skill)} closer at the open.`);
      const top = M.driversOf(m, 0, new Float64Array(M.FEATURES.length).fill(1)).slice(0, 3);
      if (top.length) out.push(`At the open the inputs that move the call most are: ${top.map((d) => d.label.toLowerCase()).join(", ")}.`);
      if (m.soft) {
        const s = m.soft.c45;
        if (s) out.push(`The live readings (futures build-up, the auction's order imbalance, setup and world leans, order book): ${s.on ? `switched on — ${s.why}` : s.why}.`);
      }
    }
    for (const g of this._liveRecord()) if (g.called >= 10) out.push(`Live record ${g.label.toLowerCase()}: the direction to 9:45 was right on ${g.right} of ${g.called} calls that leaned (${Math.round((g.rate || 0) * 100)}%), over ${g.sessions} sessions.`);
    out.push("Use it as one input: the opening half-hour is the noisiest of the day, and the desk's own entries still wait for the 9:15 – 9:30 range to form.");
    return out;
  }

  _teach() {
    if (!this.playbook || typeof this.playbook.setSection !== "function") return;
    try {
      this.playbook.setSection(SECTION, this.lessons().map((l) => `- ${l}`).join("\n"));
    } catch (_) {
      /* the skills file is optional */
    }
  }

  /* --------------------------------------------------------------------------- the clock */
  _universe() {
    const set = new Set();
    try {
      (this.market.watchlist ? this.market.watchlist() : []).forEach((s) => set.add(s));
    } catch (_) {
      /* no watchlist */
    }
    const since = istDate(this.now() - 7 * 86400000);
    for (const r of this._recs().values()) if (r.date >= since) set.add(r.symbol);
    return [...set].filter((s) => SYMBOL_RE.test(s) && s !== INDEX && !/^DEMO/.test(s)).slice(0, MAX_AUTO);
  }

  /** The morning sweep: a call for every followed stock, so the record does not depend on an open page. */
  async sweep() {
    const at = this._stage(this.now());
    if (!["pre", "preopen", "auction", "opening"].includes(at.stage)) return 0;
    let n = 0;
    for (const s of this._universe()) {
      try {
        const made = await this._make(s, at);
        if (made && made.call) {
          this._keep(s, at, made);
          n += 1;
        }
      } catch (_) {
        /* one stock's failure does not stop the rest */
      }
    }
    return n;
  }

  async tick() {
    const now = this.now();
    const today = istDate(now);
    const min = minuteOfDay(now);
    const trading = weekday(today) && this.isTradingDay(today);
    if (trading && this._connected()) {
      // every four minutes before the auction; then at the auction's price and at each 5-minute mark to 9:40
      const every = min < AUCTION ? 4 * 60000 : 60000;
      if (min >= SWEEP_FROM && min < END && now - this._sweepAt >= every) {
        const at = this._stage(now);
        const markDue = at.stage !== "opening" || (min - OPEN) % 5 <= 1;
        if (markDue) {
          this._sweepAt = now;
          const n = await this.sweep();
          if (n) this.log.log(`[morning] ${n} morning calls at ${clockOf(min)}`);
        }
      }
      if (min >= SCORE_45 && now - this._scoreAt >= 3 * 60000) {
        this._scoreAt = now;
        const n = await this.score();
        if (n) {
          this.log.log(`[morning] ${n} morning calls scored`);
          if (min >= SCORE_DAY) this._relearnSoft();
          this._teach();
        }
      }
    }
    // every evening, once the stored history has the new session (or there is no model yet): learn again
    if (min >= LEARN_FROM && this._learnTriedOn !== today && !this._training) {
      const m = this.model();
      const store = this._store();
      let to = null;
      try {
        to = store && typeof store.status === "function" ? store.status().to : null;
      } catch (_) {
        to = null;
      }
      if (to && (!m || to > m.trainedTo)) {
        this._learnTriedOn = today;
        try {
          await this.train({ trigger: "itself" });
        } catch (err) {
          this.log.error(`[morning] ${err.message}`);
        }
        this._prune();
      }
    }
  }

  _relearnSoft() {
    const m = this.model();
    if (!m) return;
    m.soft = this._softFit(m);
    this.docs.write(MODEL, m);
    this._rev += 1;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.log.error(`[morning] ${err.message}`));
    }, 30000);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

const pickSoft = (s) => (s ? { on: Boolean(s.on), sessions: s.sessions, n: s.n, why: s.why } : null);

/** One plain sentence on what to watch, from the levels. */
function planOf({ side, open, first30, dayLv, at945, stage, k }) {
  const rs = (x) => `₹${Number(x).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const before = stage !== "opening";
  const lead = before ? `Expected to open near ${rs(open)}.` : `Open ${rs(open)}.`;
  if (side === "up") return `${lead} Leans up: watch for buyers to hold ${rs(open)}, with the half-hour high near ${rs(first30.high)} and about ${rs(at945.price)} at 9:45; a 5-minute close above the 9:15 – 9:30 high after 9:30 is the desk's long trigger. Day high expected near ${rs(dayLv.high)}${k >= 3 ? "" : " — the first minutes decide more than any forecast"}.`;
  if (side === "down") return `${lead} Leans down: watch for the open to give way, with the half-hour low near ${rs(first30.low)}; a 5-minute close below the 9:15 – 9:30 low after 9:30 is the desk's short trigger (intraday only). Day low expected near ${rs(dayLv.low)}.`;
  return `${lead} No clear lean: expect ${rs(first30.low)} – ${rs(first30.high)} by 9:45 and let the 9:15 – 9:30 range decide; the day's range is expected near ${rs(dayLv.low)} – ${rs(dayLv.high)}.`;
}

const RULE =
  "A ridge regression per 5-minute mark (the open, 9:20 … 9:40), fitted on the NIFTY 100's stored year of 5-minute bars: the previous sessions (range, last day's move and close, last hour, 5- and 20-day trend, 20-day average, high and low, volume), the gap and the market's gap, and from 9:15 the session so far (move, range, place in it, volume against its usual first minutes, VWAP, the market's move). It predicts the price 15 minutes on and at 9:45, the half-hour's high and low, and the day's high, low and close, in units of the stock's daily range. Tested on the newest fifth of the sessions, never seen by the fit; refitted every evening. Futures build-up, the auction's order imbalance, the setup and world leans and the order book enter through a correction learned from the desk's own scored calls, switched on only once both halves of the sessions say it helps. Before 9:08 the open is itself a forecast. Not a promise; not advice.";

module.exports = { Morning, MorningError, COLLECTION, MODEL, SECTION, slotOfClock };
