"use strict";
// The opening-price forecast: for a stock, the most probable price of tomorrow's (or this morning's) open,
// made before the market opens, kept, compared with the real open, and learned from.
//
//   WHAT     server/market/openfc.js does the arithmetic: the expected index gap (GIFT Nifty against the Nifty
//            future and the overseas cues — the desk's own market forecast), how this stock's opens follow the
//            index, what the stock did yesterday, and a tilt from the chart's lean, the last AI research, the
//            option chain (open interest) and the news mood. Four estimates are blended with learned weights.
//   WHEN     · whenever a stock is opened on the Desk (refreshed every few minutes while the market is shut)
//            · by itself every trading morning from 8:30 to 9:00 IST for the watchlist, the index and every
//              stock looked at in the last week, while Zerodha is connected
//            · FINAL at 9:00, when the opening auction starts: nothing made after that is scored as a forecast
//   SCORED   from 9:16 the real opening price is read (the quote's open, or the day's bar) and written beside the
//            forecast: the miss, whether it fell inside the band, and how each of the four estimates did
//   LEARNED  after every scoring the whole record is read again (openfc.learnFrom): the blend's weights, each
//            stock's own bias, the bias of the index cue, the width of the band and how much the soft evidence
//            is worth. The next forecast uses them — so it corrects itself day by day.
//   KEPT     one record per stock per session in the database (collection "open_forecasts"), the learning in
//            "market/open-learn.json", and the findings, in plain words, in the trading-skills file every AI
//            feature reads (the section below) — replaced after every scoring.
//
// It reads the market. It never trades, and it asks no AI model: it uses the AI research that was already run.

const { forecastOpen, walkForward, learnFrom, lessonsOf, emptyLearning } = require("./market/openfc");
const { buildOutlook } = require("./market/outlook");

const IST = 5.5 * 3600 * 1000;
const COLLECTION = "open_forecasts";
const LEARN = "market/open-learn.json";
const INDEX = "NIFTY 50";
const SECTION = "## What the desk has measured about the opening price (written by itself after every open)";
const FREEZE_MIN = 9 * 60; // the auction starts: the forecast is final
const SCORE_MIN = 9 * 60 + 16; // the open is known
const CLOSE_MIN = 15 * 60 + 30;
const SWEEP_FROM = 8 * 60 + 30;
const KEEP_DAYS = 400;
const MAX_AUTO = 40;
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9&._ -]{0,24}$/;
const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const minuteOfDay = (ms) => {
  const d = new Date(ms + IST);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const weekday = (date) => {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
};
function nextWeekday(date) {
  let t = Date.parse(`${date}T00:00:00Z`) + 86400000;
  while (!weekday(new Date(t).toISOString().slice(0, 10))) t += 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
/** The session a forecast made now is for: today until the close on a trading day, else the next weekday. */
function targetOf(nowMs) {
  const today = istDate(nowMs);
  return weekday(today) && minuteOfDay(nowMs) < CLOSE_MIN ? today : nextWeekday(today);
}

class OpenForecastError extends Error {
  constructor(message, code = "open_forecast", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class OpenForecast {
  /**
   * @param market    the MarketService (daily bars, quotes, the market forecast, the option chain, the watchlist)
   * @param docs      the record store
   * @param ai        the AiService (its last research for a stock), optional
   * @param playbook  the trading-skills file, optional
   * @param world     () => the AI's world brief for the market forecast, optional
   */
  constructor({ market, docs, ai = null, playbook = null, world = null, now = () => Date.now(), log = console }) {
    this.market = market;
    this.docs = docs;
    this.ai = ai;
    this.playbook = playbook;
    this.world = world;
    this.now = now;
    this.log = log;
    this.timer = null;
    this._map = null;
    this._learn = null;
    this._cueAt = null;
    this._busy = new Map();
    this._bt = new Map();
    this._sweepAt = 0;
    this._scoreAt = 0;
    this._backfillAt = 0;
  }

  /* --------------------------------------------------------------------------- the record */
  _recs() {
    if (!this._map) this._map = new Map(this.docs.items(COLLECTION).map((r) => [r.id, r]));
    return this._map;
  }
  _save(rec) {
    this._rev = (this._rev || 0) + 1;
    this._recs().set(rec.id, rec);
    this.docs.putItems(COLLECTION, [rec]);
  }
  /** Changes whenever a forecast is made or scored, or the learning is redone (the live hub compares it). */
  fingerprint() {
    return `${this._rev || 0}|${(this._learn && this._learn.updatedAt) || ""}`;
  }
  learned() {
    if (!this._learn) this._learn = this.docs.read(LEARN, null) || emptyLearning();
    return this._learn;
  }
  _of(symbol) {
    return [...this._recs().values()].filter((r) => r.symbol === symbol).sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  /* --------------------------------------------------------------------------- the inputs */
  /** The index's expected gap this morning, from the desk's market forecast. Shared for three minutes. */
  async _cue(now) {
    if (this._cueAt && now - this._cueAt.at < 180000) return this._cueAt.cue;
    let cue = { gapPct: null, source: "none", basis: "No overnight cue for the index (Zerodha not connected, or no GIFT Nifty reading yet)." };
    if (typeof this.market.mode === "function" && this.market.mode() === "kite") {
      try {
        const f = await this.market.marketForecast({ world: this.world ? this.world() : null });
        if (f && f.available && f.open && num(f.open.gapPct)) cue = { gapPct: f.open.gapPct, source: "market forecast", basis: f.open.basis || "", label: f.open.label || "", lean: f.lean ? f.lean.score : null };
      } catch (_) {
        /* no forecast: the stock's own behaviour still speaks */
      }
    }
    this._cueAt = { at: now, cue };
    return cue;
  }

  /** The soft evidence, each −100…+100 or absent. Nothing here costs an AI call. */
  async _soft(symbol, candles, { light }) {
    const soft = {};
    try {
      const o = buildOutlook({ candles, forming: false, edge: null });
      if (o && o.available && num(o.score)) soft.chart = o.score;
    } catch (_) {
      /* too few bars */
    }
    try {
      const last = this.ai && this.ai.ensemble && typeof this.ai.ensemble.last === "function" ? this.ai.ensemble.last("research", symbol) : null;
      // a research run is about the next session: one older than a day and a half is about a session already gone
      if (last && last.final && num(last.final.score) && last.at && this.now() - Date.parse(last.at) < 36 * 3600000) soft.research = last.final.score;
    } catch (_) {
      /* no research on record */
    }
    if (!light && typeof this.market.mode === "function" && this.market.mode() === "kite") {
      try {
        const c = await this.market.optionChain(symbol);
        if (c && c.available && c.bias && num(c.bias.score)) soft.options = c.bias.score;
      } catch (_) {
        /* not an F&O stock */
      }
    }
    try {
      const n = this.market.social ? this.market.social.forSymbol(symbol) : null;
      if (n && n.mentions >= 2 && num(n.sentiment)) soft.news = Math.max(-100, Math.min(100, n.sentiment * 100));
    } catch (_) {
      /* no news */
    }
    return soft;
  }

  /* --------------------------------------------------------------------------- forecasting */
  /**
   * The forecast for the session a stock opens next. Made (or refreshed) only before 9:00 of that session;
   * after that the stored one is final. @returns the record, or null when none could be made
   */
  forecast(symbol, opts = {}) {
    const hit = this._busy.get(symbol);
    if (hit) return hit;
    const p = this._forecast(symbol, opts).finally(() => this._busy.delete(symbol));
    this._busy.set(symbol, p);
    return p;
  }

  async _forecast(symbol, { light = false, force = false } = {}) {
    if (!SYMBOL_RE.test(symbol)) throw new OpenForecastError("That is not a valid symbol.", "invalid");
    const now = this.now();
    const today = istDate(now);
    const target = targetOf(now);
    const id = `${target}|${symbol}`;
    const old = this._recs().get(id) || null;
    const final = (old && old.actual) || (target === today && minuteOfDay(now) >= FREEZE_MIN);
    if (final) return old;
    // the last half hour before the auction moves fastest: refreshed more often then
    const fresh = target === today && minuteOfDay(now) >= SWEEP_FROM ? 3 * 60000 : 10 * 60000;
    if (old && !force && now - Date.parse(old.madeAt) < fresh) return old;
    if (typeof this.market.mode === "function" && this.market.mode() === "demo") return old;

    const d = await this.market.daily(symbol);
    const candles = (d.candles || []).filter((c) => String(c.t).slice(0, 10) < target);
    const isIndex = symbol === INDEX;
    let nifty = null;
    if (!isIndex) {
      const ix = await this.market.index();
      nifty = ix && Array.isArray(ix.candles) ? ix.candles.filter((c) => String(c.t).slice(0, 10) < target) : null;
    }
    const cue = await this._cue(now);
    const soft = await this._soft(symbol, candles, { light });
    const f = forecastOpen({ symbol, daily: candles, nifty, cue, soft, learned: this.learned(), isIndex });
    if (!f.available) return old;
    const at = new Date(now).toISOString();
    const rec = {
      id,
      date: target,
      symbol,
      isIndex,
      madeAt: at,
      firstAt: old ? old.firstAt : at,
      first: old ? old.first : { gapPct: f.gapPct, predicted: f.predicted },
      revisions: old ? old.revisions + 1 : 1,
      stage: target === today ? "morning" : "evening",
      stale: Boolean(d.stale),
      prevClose: f.prevClose,
      prevDate: f.prevDate,
      gapPct: f.gapPct,
      predicted: f.predicted,
      band: f.band,
      experts: f.experts,
      weights: f.weights,
      bias: f.bias,
      cue: f.cue,
      tilt: f.tilt,
      fit: f.fit,
      usualMissPct: f.usualMissPct,
      actual: null,
    };
    this._save(rec);
    return rec;
  }

  /* --------------------------------------------------------------------------- scoring */
  _settle(rec, open, source, now) {
    const gap = (open / rec.prevClose - 1) * 100;
    const errs = {};
    for (const [k, v] of Object.entries(rec.experts || {})) if (num(v)) errs[k] = Math.round(Math.abs(v - gap) * 10000) / 10000;
    const done = {
      ...rec,
      actual: { open, gapPct: Math.round(gap * 10000) / 10000, at: new Date(now).toISOString(), source },
      errPct: Math.round((rec.gapPct - gap) * 10000) / 10000, // + the forecast was too high
      missPct: Math.round(Math.abs(rec.gapPct - gap) * 10000) / 10000,
      inBand: open >= rec.band.low - 1e-9 && open <= rec.band.high + 1e-9,
      expertMiss: errs,
    };
    this._save(done);
    return done;
  }

  /**
   * Write the real opening price beside every forecast that is waiting for one.
   * @returns the number scored (the record is read again and learned from when any were)
   */
  async score() {
    const now = this.now();
    const today = istDate(now);
    const min = minuteOfDay(now);
    const due = [...this._recs().values()].filter((r) => !r.actual && !r.void && (r.date < today || (r.date === today && min >= SCORE_MIN)));
    if (!due.length) return 0;
    let scored = 0;
    const live = typeof this.market.mode === "function" && this.market.mode() === "kite";
    // today's: the quote's open is the auction's price
    const todays = due.filter((r) => r.date === today);
    const left = new Map(due.map((r) => [r.id, r]));
    if (todays.length && live) {
      try {
        for (let i = 0; i < todays.length; i += 80) {
          const part = todays.slice(i, i + 80);
          const q = (await this.market.quotes(part.map((r) => r.symbol))).quotes || {};
          for (const r of part) {
            const x = q[r.symbol];
            const sameDay = !x || !x.time || String(x.time).slice(0, 10) === today;
            if (x && num(x.open) && x.open > 0 && sameDay) {
              this._settle(r, x.open, "quote", now);
              left.delete(r.id);
              scored += 1;
            }
          }
        }
      } catch (_) {
        /* the day's bar will do */
      }
    }
    // anything else (an earlier day, or a quote that did not come): that day's bar
    for (const r of left.values()) {
      try {
        const d = await this.market.daily(r.symbol);
        const bar = (d.candles || []).find((c) => String(c.t).slice(0, 10) === r.date);
        if (bar && num(bar.o) && bar.o > 0) {
          this._settle(r, bar.o, "day bar", now);
          scored += 1;
        } else if ((d.candles || []).some((c) => String(c.t).slice(0, 10) > r.date)) {
          // sessions after it exist but not that day: the market was shut (a holiday) — there was no open to forecast
          this._save({ ...r, void: true });
        }
      } catch (_) {
        /* tried again later */
      }
    }
    if (scored) this.relearn();
    return scored;
  }

  /** Read the whole record again and learn from it; the findings go into the trading-skills file. */
  relearn() {
    const now = this.now();
    const cut = istDate(now - KEEP_DAYS * 86400000);
    const old = [...this._recs().values()].filter((r) => r.date < cut).map((r) => r.id);
    if (old.length) {
      old.forEach((id) => this._recs().delete(id));
      this.docs.removeItems(COLLECTION, old);
    }
    const L = learnFrom([...this._recs().values()], { now });
    this.docs.write(LEARN, L);
    this._learn = L;
    const lines = lessonsOf(L);
    if (this.playbook && lines.length) {
      try {
        this.playbook.setSection(SECTION, lines.map((l) => `- ${l}`).join("\n"));
      } catch (err) {
        this.log.error(`[open] the skills file was not updated: ${err.message}`);
      }
    }
    return L;
  }

  /* --------------------------------------------------------------------------- reading */
  _pub(r) {
    if (!r) return null;
    return {
      date: r.date,
      symbol: r.symbol,
      madeAt: r.madeAt,
      firstAt: r.firstAt,
      first: r.first,
      revisions: r.revisions,
      stage: r.stage,
      stale: Boolean(r.stale),
      prevClose: r.prevClose,
      prevDate: r.prevDate,
      gapPct: r2(r.gapPct),
      predicted: r.predicted,
      band: { low: r.band.low, high: r.band.high, halfPct: r2(r.band.halfPct) },
      usualMissPct: r.usualMissPct,
      experts: Object.fromEntries(Object.entries(r.experts || {}).map(([k, v]) => [k, { gapPct: r2(v), price: num(v) ? Math.round(r.prevClose * (1 + v / 100) * 20) / 20 : null, weight: r.weights && num(r.weights[k]) ? Math.round(r.weights[k] * 100) : 0, missPct: r.expertMiss && num(r.expertMiss[k]) ? r2(r.expertMiss[k]) : null }])),
      bias: r2(r.bias),
      cue: r.cue ? { gapPct: r2(r.cue.gapPct), usedPct: r2(r.cue.usedPct), source: r.cue.source, basis: r.cue.basis } : null,
      tilt: r.tilt,
      fit: r.fit ? { beta: r.fit.beta, sessions: r.fit.n, pattern: r.fit.pattern } : null,
      actual: r.actual ? { open: r.actual.open, gapPct: r2(r.actual.gapPct), at: r.actual.at, source: r.actual.source } : null,
      errPct: r2(r.errPct),
      missPct: r2(r.missPct),
      errRs: r.actual ? r2(r.predicted - r.actual.open) : null,
      inBand: r.actual ? Boolean(r.inBand) : null,
    };
  }

  /** The current forecast in a few fields, without computing anything (for the intraday plan and the AI). */
  peek(symbol) {
    const now = this.now();
    const r = this._recs().get(`${targetOf(now)}|${symbol}`);
    if (!r || r.void) return null;
    return { date: r.date, gapPct: r.gapPct, predicted: r.predicted, low: r.band.low, high: r.band.high, halfPct: r.band.halfPct, usualMissPct: r.usualMissPct, cue: r.cue ? r.cue.source : "none", madeAt: r.madeAt, actual: r.actual ? r.actual.open : null };
  }

  /** Everything the Desk shows for one stock: the forecast, the real open once known, the record and what was learned. */
  async view(symbol) {
    if (!SYMBOL_RE.test(symbol)) throw new OpenForecastError("That is not a valid symbol.", "invalid");
    const now = this.now();
    const today = istDate(now);
    const min = minuteOfDay(now);
    const target = targetOf(now);
    let problem = "";
    try {
      await this.forecast(symbol);
    } catch (err) {
      problem = err.message || "The forecast could not be made.";
    }
    let cur = this._recs().get(`${target}|${symbol}`) || null;
    // the open is known and this forecast is still waiting: score now rather than at the next minute
    if (cur && !cur.actual && target === today && min >= SCORE_MIN && now - this._scoreAt > 30000) {
      this._scoreAt = now;
      try {
        await this.score();
      } catch (_) {
        /* the clock tries again */
      }
      cur = this._recs().get(`${target}|${symbol}`) || cur;
    }
    const mine = this._of(symbol).filter((r) => r.actual);
    const last = mine.find((r) => !cur || r.id !== cur.id) || null;
    const phase = target !== today ? "next" : min < FREEZE_MIN ? "pre" : min < SCORE_MIN ? "auction" : "open";
    // during the auction the exchange shows an indicative price: shown beside the forecast, never scored as one
    let preopen = null;
    let todayOpen = null;
    if (target === today && min >= FREEZE_MIN && typeof this.market.mode === "function" && this.market.mode() === "kite" && !(cur && cur.actual)) {
      try {
        const q = ((await this.market.quotes([symbol])).quotes || {})[symbol];
        if (q && num(q.last) && q.last > 0 && phase === "auction") preopen = { price: q.last, at: new Date(now).toISOString() };
        if (q && num(q.open) && q.open > 0 && phase === "open") todayOpen = q.open;
      } catch (_) {
        /* not essential */
      }
    }
    let backtest = null;
    try {
      const key = `${symbol}|${cur ? cur.prevDate : target}`;
      if (this._bt.has(key)) backtest = this._bt.get(key);
      else if (symbol !== INDEX && cur) {
        const d = await this.market.daily(symbol);
        const ix = await this.market.index();
        backtest = walkForward((d.candles || []).filter((c) => String(c.t).slice(0, 10) < target), ix ? ix.candles.filter((c) => String(c.t).slice(0, 10) < target) : null);
        if (this._bt.size > 60) this._bt.clear();
        this._bt.set(key, backtest);
      }
    } catch (_) {
      backtest = null;
    }
    const L = this.learned();
    const own = (L.bySymbol || {})[symbol] || null;
    return {
      available: Boolean(cur),
      symbol,
      target,
      phase, // "next": for the next session · "pre": this morning, still updating · "auction": final, the auction is on · "open": the open is known
      final: phase === "auction" || phase === "open",
      reason: cur ? "" : problem || (typeof this.market.mode === "function" && this.market.mode() === "demo" ? "The opening forecast needs real prices: demo series have no opening auction. Connect Zerodha." : phase === "open" || phase === "auction" ? "No forecast was made for this stock before today's opening auction (9:00). The next one is made after the close." : "The forecast needs this stock's price history: connect Zerodha."),
      current: this._pub(cur),
      todayOpen,
      preopen,
      last: this._pub(last),
      history: mine.slice(0, 12).map((r) => ({ date: r.date, predicted: r.predicted, open: r.actual.open, gapPct: r2(r.gapPct), actualGapPct: r2(r.actual.gapPct), errPct: r2(r.errPct), inBand: Boolean(r.inBand) })),
      backtest,
      learning: {
        scored: L.n || 0,
        stats: L.stats || null,
        weights: L.weights,
        cue: { biasPct: r2(L.cueBias), missPct: r2(L.cueMae), n: L.cueN || 0 },
        bandScale: L.bandScale,
        softWorth: L.tiltK,
        own: own ? { n: own.n, biasPct: r2(own.bias), missPct: r2(own.mae) } : null,
        updatedAt: L.updatedAt,
      },
      rule:
        "Four estimates are blended: it opens at the previous close; the expected index gap times this stock's measured sensitivity; a regression on what the stock and the index did yesterday; and that plus a tilt from the chart, the last AI research, the option chain and the news. The weights, this stock's own bias, the index cue's bias and the width of the band are learned from every scored forecast. The forecast is final at 9:00 (the opening auction); the real open is written beside it from 9:16. The band aims to hold about 70% of opens. An opening price depends on overnight news nobody has seen: this is the most probable price, not a promise.",
      at: new Date(now).toISOString(),
    };
  }

  /** Forecasts of earlier sessions still waiting for their real open (their scoring was missed). For the supervisor. */
  overdue() {
    const today = istDate(this.now());
    let n = 0;
    for (const r of this._recs().values()) if (!r.actual && !r.void && r.date < today) n += 1;
    return n;
  }

  /** The learning and the latest scored forecasts across stocks, for a page. */
  board() {
    const L = this.learned();
    const scored = [...this._recs().values()].filter((r) => r.actual).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.symbol < b.symbol ? -1 : 1));
    return { learning: { scored: L.n || 0, stats: L.stats || null, weights: L.weights, cue: { biasPct: r2(L.cueBias), missPct: r2(L.cueMae), n: L.cueN || 0 }, bandScale: L.bandScale, softWorth: L.tiltK, updatedAt: L.updatedAt }, lessons: lessonsOf(L), recent: scored.slice(0, 60).map((r) => this._pub(r)), waiting: [...this._recs().values()].filter((r) => !r.actual && !r.void).length };
  }

  /* --------------------------------------------------------------------------- the clock */
  _universe() {
    const set = new Set([INDEX]);
    try {
      (this.market.watchlist ? this.market.watchlist() : []).forEach((s) => set.add(s));
    } catch (_) {
      /* no watchlist */
    }
    const since = istDate(this.now() - 7 * 86400000);
    for (const r of this._recs().values()) if (r.date >= since) set.add(r.symbol);
    return [...set].filter((s) => SYMBOL_RE.test(s) && !/^DEMO/.test(s)).slice(0, MAX_AUTO);
  }

  /** Forecast every stock being followed, the index first. One at a time: Zerodha's limits are shared with the page. */
  async sweep() {
    let made = 0;
    for (const s of this._universe()) {
      try {
        if (await this.forecast(s, { light: true, force: true })) made += 1;
      } catch (_) {
        /* one stock's failure does not stop the rest */
      }
    }
    return made;
  }

  async tick() {
    const now = this.now();
    const today = istDate(now);
    const min = minuteOfDay(now);
    const live = typeof this.market.mode === "function" && this.market.mode() === "kite";
    if (weekday(today) && live) {
      // the morning: every eight minutes from 8:30, and once more in the last five minutes before the auction
      if (min >= SWEEP_FROM && min < FREEZE_MIN && (now - this._sweepAt >= 8 * 60000 || (min >= FREEZE_MIN - 5 && now - this._sweepAt >= 3 * 60000))) {
        this._sweepAt = now;
        const n = await this.sweep();
        if (n) this.log.log(`[open] ${n} opening forecasts made for ${today}`);
      }
      if (min >= SCORE_MIN && min < 16 * 60 && now - this._scoreAt >= 2 * 60000) {
        this._scoreAt = now;
        const n = await this.score();
        if (n) this.log.log(`[open] ${n} opening forecasts scored; ${this.learned().n} on record`);
      }
    }
    // earlier days still waiting (the server was down that morning): from the day bars, once an hour
    if (now - this._backfillAt >= 3600000) {
      this._backfillAt = now;
      if ([...this._recs().values()].some((r) => !r.actual && !r.void && r.date < today)) await this.score();
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.log.error(`[open] ${err.message}`));
    }, 60000);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { OpenForecast, OpenForecastError, targetOf, SECTION, COLLECTION, LEARN };
