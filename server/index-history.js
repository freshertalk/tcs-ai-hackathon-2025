"use strict";
// The Indices page's server: NIFTY 50 and SENSEX history, projections, and the ledger that backtests them.
//
//   HISTORY    each index's daily candles from Zerodha (the owner's Kite connection), as far back as Kite
//              keeps them, saved in the database (indices/candles-ID.json) and topped up: every 20 minutes
//              in market hours when the page is open, and once after the close by itself. In demo mode two
//              synthetic series stand in, named as such.
//   ANALYSIS   market/indices.js: years, months, the seasonality of each calendar month, patterns, the
//              desk's projection for the month and the year, and its walk-forward record.
//   LEDGER     every projection is frozen when it is made and scored when its period ends
//              (indices/ledger.json): the desk's projection for each month and year (made from the data up
//              to the end of the period before, so recording it late cannot use what happened since) and
//              each projection of the AI Engine (made at a moment, from the level of that moment). Nothing
//              in the ledger is ever rewritten except to add the actual close and the score.
//   AI         the default model's projection (ai/indexai.js) — by itself on the first weekday of each
//              month for the month and in January for the year (when switched on; never on demo data),
//              or on request. Every answer is checked against the index's own volatility before it is
//              kept: a close beyond what the index can plausibly do in the time left is refused, with the
//              reason; a range narrower than its volatility allows is marked overconfident.
//
// It reads the market. It never trades. It lives outside server/ai (which holds no timers).

const { analyze, compare, scoreRows, MODEL } = require("./market/indices");
const demo = require("./market/demo");

const IST = 5.5 * 3600 * 1000;
const INDICES = {
  NIFTY: { id: "NIFTY", name: "NIFTY 50", exchange: "NSE" },
  SENSEX: { id: "SENSEX", name: "SENSEX", exchange: "BSE" },
};
const candlesDoc = (id) => `indices/candles-${id}.json`;
const LEDGER = "indices/ledger.json";
const SETTINGS = "indices/settings.json";
const DEFAULTS = { aiAuto: true };
const AI_MANUAL_GAP_MS = 3 * 3600000; // one asked projection per index and period kind every three hours
const AI_DAILY_CAP = 12;
const MAX_LEDGER = 800;

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 || 0 : null);
const istIso = (ms) => new Date(ms + IST).toISOString();
const istDate = (ms) => istIso(ms).slice(0, 10);
const minuteOfDay = (ms) => {
  const d = new Date(ms + IST);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const weekday = (ms) => {
  const d = new Date(ms + IST).getUTCDay();
  return d !== 0 && d !== 6;
};
const pctOf = (a, b) => (num(a) && num(b) && b !== 0 ? ((a - b) / b) * 100 : null);

class IndexError extends Error {
  constructor(message, code = "invalid", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class IndexHistory {
  /**
   * @param market the MarketService (indexDaily, mode, marketForecast, social)
   * @param ai     the AiService (ai.indexAi), optional
   */
  constructor({ market, ai = null, docs, now = () => Date.now(), log = console }) {
    this.market = market;
    this.ai = ai;
    this.docs = docs;
    this.now = now;
    this.log = log;
    this.busy = new Map();
    this.cache = new Map(); // id → { key, a } — the analysis of one series, while it is unchanged
    this.timer = null;
    this.asking = new Set();
    this._dayDone = "";
  }

  /* ---------------------------------------------------------------------------- settings */
  settings() {
    const d = this.docs.read(SETTINGS, null) || {};
    const today = istDate(this.now());
    return { aiAuto: d.aiAuto === undefined ? DEFAULTS.aiAuto : Boolean(d.aiAuto), aiToday: d.ai && d.ai.day === today ? d.ai.n : 0, aiDailyCap: AI_DAILY_CAP };
  }
  setSettings(patch = {}) {
    const d = this.docs.read(SETTINGS, null) || {};
    if (patch.aiAuto !== undefined) d.aiAuto = Boolean(patch.aiAuto);
    this.docs.write(SETTINGS, d);
    return this.settings();
  }
  _countAi() {
    const d = this.docs.read(SETTINGS, null) || {};
    const today = istDate(this.now());
    d.ai = d.ai && d.ai.day === today ? { day: today, n: d.ai.n + 1 } : { day: today, n: 1 };
    this.docs.write(SETTINGS, d);
  }

  /* ----------------------------------------------------------------------------- history */
  _mode() {
    try {
      return typeof this.market.mode === "function" ? this.market.mode() : "kite";
    } catch (_) {
      return "none";
    }
  }

  /** Is a saved copy recent enough? In market hours 20 minutes; otherwise until the next close. */
  _fresh(rec) {
    if (!rec || !rec.fetchedAt) return false;
    const now = this.now();
    const at = Date.parse(rec.fetchedAt);
    const age = now - at;
    const live = weekday(now) && minuteOfDay(now) >= 9 * 60 + 15 && minuteOfDay(now) <= 15 * 60 + 35;
    if (live) return age < 20 * 60000;
    // after today's close: a copy fetched before 3:35 PM today misses the closing candle
    const close = Date.parse(`${istDate(now)}T10:05:00Z`);
    if (weekday(now) && now >= close && at < close) return false;
    return age < 12 * 3600000;
  }

  /**
   * The daily candles of one index. @returns { candles, demo, name, source, fetchedAt, stale, staleReason }
   */
  candles(id, { refresh = false } = {}) {
    const key = `${id}|${refresh ? 1 : 0}`;
    if (this.busy.has(key)) return this.busy.get(key);
    const job = this._candles(id, { refresh }).finally(() => this.busy.delete(key));
    this.busy.set(key, job);
    return job;
  }

  async _candles(id, { refresh }) {
    const ix = INDICES[id];
    if (!ix) throw new IndexError("Unknown index: NIFTY or SENSEX.");
    const mode = this._mode();
    const now = this.now();
    if (mode === "demo") {
      const d = demo.INDEX_DEMOS[id];
      return { candles: demo.demoIndexHistory(id, istDate(now)), demo: true, name: d.name, source: "demo", fetchedAt: new Date(now).toISOString(), stale: false, staleReason: "" };
    }
    const rec = this.docs.read(candlesDoc(id), null);
    const out = (r, stale = false, why = "") => ({ candles: r.candles.map((c) => ({ d: c[0], o: c[1], h: c[2], l: c[3], c: c[4] })), demo: false, name: ix.name, source: "kite", fetchedAt: r.fetchedAt, stale, staleReason: why });
    if (rec && Array.isArray(rec.candles) && rec.candles.length && !refresh && this._fresh(rec)) return out(rec);
    if (mode !== "kite") {
      if (rec && Array.isArray(rec.candles) && rec.candles.length) return out(rec, true, `Zerodha is not connected: showing the history saved on ${String(rec.fetchedAt).slice(0, 10)}.`);
      throw new IndexError("The index history needs the Zerodha connection (log in to Kite on the Desk). It is saved after the first read.", "not_connected", 409);
    }
    try {
      const have = rec && Array.isArray(rec.candles) && rec.candles.length ? rec.candles : [];
      // a top-up from ten days before the last saved day; the first read goes back as far as Kite keeps
      const fromMs = have.length ? Date.parse(`${have[have.length - 1][0]}T00:00:00Z`) - 10 * 86400000 : undefined;
      const rows = await this.market.indexDaily(id, { fromMs });
      const by = new Map(have.map((c) => [c[0], c]));
      for (const c of rows) if (num(c.c) && c.c > 0) by.set(c.t, [c.t, r2(c.o), r2(c.h), r2(c.l), r2(c.c)]);
      const candles = [...by.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
      if (!candles.length) throw new IndexError("Zerodha returned no history for the index.", "empty", 502);
      const next = { id, name: ix.name, fetchedAt: new Date(now).toISOString(), from: candles[0][0], candles };
      this.docs.write(candlesDoc(id), next);
      return out(next);
    } catch (err) {
      if (rec && Array.isArray(rec.candles) && rec.candles.length) return out(rec, true, `The history could not be topped up (${err.message}): showing the copy saved on ${String(rec.fetchedAt).slice(0, 10)}.`);
      throw err instanceof IndexError ? err : new IndexError(err.message || "The index history could not be read.", err.code || "failed", err.status || 502);
    }
  }

  /** The analysis of one index (kept while its series is unchanged). */
  async _analysis(id, { refresh = false } = {}) {
    const c = await this.candles(id, { refresh });
    const last = c.candles[c.candles.length - 1];
    const today = istDate(this.now());
    const key = `${c.candles.length}|${last ? `${last.d}|${last.c}` : ""}|${today}|${c.demo}`;
    const hit = this.cache.get(id);
    if (hit && hit.key === key) return { c, a: hit.a };
    const a = analyze(c.candles, { today });
    this.cache.set(id, { key, a });
    return { c, a };
  }

  /* ------------------------------------------------------------------------------ ledger */
  _ledger() {
    const d = this.docs.read(LEDGER, null);
    return d && Array.isArray(d.items) ? d.items : [];
  }
  _saveLedger(items) {
    this.docs.write(LEDGER, { items: items.slice(0, MAX_LEDGER) });
  }

  /** The desk's projection for the current month and year, frozen in the ledger the first time it is seen. */
  _record(id, a, isDemo) {
    if (isDemo) return 0; // demo series are not backtested in the ledger
    const items = this._ledger();
    let added = 0;
    for (const horizon of ["month", "year"]) {
      const pj = a.projections[horizon].start;
      if (!pj || !pj.available) continue;
      const lid = `${id}-${horizon}-${pj.period}-desk`;
      if (items.some((x) => x.id === lid)) continue;
      items.unshift({
        id: lid,
        index: id,
        horizon,
        period: pj.period,
        label: pj.label,
        kind: "desk",
        by: `Desk model (${pj.model})`,
        trigger: "start",
        madeAt: new Date(this.now()).toISOString(),
        asOf: null,
        note: "Made from the data up to the end of the period before: recording it later cannot use what happened since.",
        startLevel: pj.base0,
        base: pj.base0,
        mid: pj.mid,
        low68: pj.low68,
        high68: pj.high68,
        low90: pj.low90,
        high90: pj.high90,
        lean: pj.lean,
        probUp: pj.probUp,
        reasons: pj.reasons,
        status: "open",
      });
      added += 1;
    }
    if (added) this._saveLedger(items);
    return added;
  }

  /** Every open projection of this index whose period has ended gets the actual close and its score. */
  _settle(id, a, isDemo) {
    if (isDemo) return 0;
    const items = this._ledger();
    let n = 0;
    for (const x of items) {
      if (x.index !== id || x.status !== "open") continue;
      const done = x.horizon === "month" ? a.months.find((m) => m.key === x.period && !m.partial) : a.years.find((y) => y.key === x.period && !y.partial);
      if (!done) continue;
      const actual = done.close;
      const up = actual > x.startLevel;
      Object.assign(x, {
        status: "settled",
        settledAt: new Date(this.now()).toISOString(),
        actual,
        actualPct: r2(pctOf(actual, x.startLevel)),
        dirHit: x.lean === "none" ? null : (x.lean === "up") === up && actual !== x.startLevel,
        signHit: Math.sign(x.mid - x.startLevel) === Math.sign(actual - x.startLevel),
        in68: num(x.low68) && num(x.high68) ? actual >= x.low68 && actual <= x.high68 : null,
        in90: num(x.low90) && num(x.high90) ? actual >= x.low90 && actual <= x.high90 : null,
        errPct: r2(pctOf(actual, x.mid)),
        naivePct: r2(pctOf(actual, x.base)),
      });
      n += 1;
    }
    if (n) this._saveLedger(items);
    return n;
  }

  _ledgerView(id) {
    const items = this._ledger().filter((x) => x.index === id);
    const settled = items.filter((x) => x.status === "settled");
    const sc = (rows) => {
      const s = scoreRows(rows.map((x) => ({ ...x, base: x.startLevel, in68: Boolean(x.in68), in90: Boolean(x.in90) })));
      return { ...s, in90Rate: rows.some((x) => x.in90 !== null) ? s.in90Rate : null };
    };
    return {
      items: items.slice(0, 120),
      desk: { month: sc(settled.filter((x) => x.kind === "desk" && x.horizon === "month")), year: sc(settled.filter((x) => x.kind === "desk" && x.horizon === "year")) },
      ai: { month: sc(settled.filter((x) => x.kind === "ai" && x.horizon === "month")), year: sc(settled.filter((x) => x.kind === "ai" && x.horizon === "year")) },
      open: items.filter((x) => x.status === "open").length,
      refused: items.filter((x) => x.status === "refused").length,
    };
  }

  /* ------------------------------------------------------------------------------- views */
  /** Everything the Indices page shows for one index. */
  async view(id, { refresh = false } = {}) {
    if (!INDICES[id]) throw new IndexError("Unknown index: NIFTY or SENSEX.");
    const { c, a } = await this._analysis(id, { refresh });
    if (!a.available) return { available: false, index: INDICES[id], reason: a.reason, demo: c.demo };
    this._record(id, a, c.demo);
    this._settle(id, a, c.demo);
    const { months, ...rest } = a;
    void months;
    return {
      ...rest,
      index: { ...INDICES[id], name: c.demo ? c.name : INDICES[id].name },
      demo: c.demo,
      source: c.source,
      fetchedAt: c.fetchedAt,
      stale: c.stale,
      staleReason: c.staleReason,
      ledger: this._ledgerView(id),
      settings: this.settings(),
      ai: { ready: Boolean(this.ai && this.ai.indexAi && this.ai.indexAi.ready()), model: this._model() },
    };
  }

  /** The two indices side by side. */
  async compare() {
    const [n, s] = await Promise.all([this._analysis("NIFTY"), this._analysis("SENSEX")]);
    if (!n.a.available || !s.a.available) return { available: false, reason: (!n.a.available ? n.a : s.a).reason };
    return { available: true, demo: n.c.demo || s.c.demo, a: { id: "NIFTY", name: n.c.demo ? n.c.name : "NIFTY 50", from: n.a.from, to: n.a.to }, b: { id: "SENSEX", name: s.c.demo ? s.c.name : "SENSEX", from: s.a.from, to: s.a.to }, ...compare(n.a, s.a) };
  }

  /** A short reading for TradeAI's agent: this month and year in history, the projections and their records. */
  async brief(id) {
    if (!INDICES[id]) return null;
    const { c, a } = await this._analysis(id);
    if (!a.available) return { available: false, reason: a.reason };
    const pj = (p) => (p && p.available ? { period: p.label, startLevel: p.base0, level: p.base, expectedClose: p.mid, range68: [p.low68, p.high68], range90: [p.low90, p.high90], chanceUpPct: p.probUp, lean: p.lean, sessionsLeft: p.daysLeft, reasons: p.reasons } : null);
    const ai = this._ledger().filter((x) => x.index === id && x.kind === "ai" && x.status !== "refused");
    const lastAi = (h) => {
      const x = ai.find((e) => e.horizon === h);
      return x ? { period: x.label, madeAt: x.madeAt, by: x.by, close: x.mid, range: [x.low68, x.high68], lean: x.lean, chanceUpPct: x.probUp, status: x.status, actual: x.actual || null } : null;
    };
    const tm = a.thisMonth || {};
    return {
      available: true,
      index: c.demo ? `${c.name} (demo data, not the real index)` : INDICES[id].name,
      history: `${a.from} to ${a.to}`,
      last: a.last,
      monthToDate: a.mtd,
      yearToDate: a.ytd,
      fromAllTimeHigh: a.patterns.drawdowns ? a.patterns.drawdowns.now : null,
      thisCalendarMonthInHistory: tm.n ? { month: tm.name, years: tm.n, rose: tm.up, winRatePct: tm.winRate, avgPct: tm.avgPct, medianPct: tm.medianPct, best: tm.best, worst: tm.worst, last10Years: tm.last10 } : null,
      deskProjection: { month: pj(a.projections.month.live), year: pj(a.projections.year.live) },
      deskWalkForwardRecord: { month: a.backtest.month.summary, year: a.backtest.year.summary },
      aiProjection: { month: lastAi("month"), year: lastAi("year") },
      note: "Projections from the index's own history (seasonality, trend regime, volatility), with their measured record. upShare is the plain 'it rises' base rate to beat. Evidence, not a promise.",
    };
  }

  _model() {
    try {
      const m = this.ai && typeof this.ai.modelChain === "function" ? this.ai.modelChain()[0] : null;
      return m ? m.name : null;
    } catch (_) {
      return null;
    }
  }

  /* ---------------------------------------------------------------------- the AI's projection */
  _snapshot(id, a, horizon, isDemo, world = null) {
    const live = a.projections[horizon].live;
    const tm = a.thisMonth || {};
    const ms = a.monthStats;
    let news = null;
    try {
      const sig = this.market.social ? this.market.social.signal() : null;
      news = sig && sig.mood ? { mood: sig.mood.label, score: sig.mood.score } : null;
    } catch (_) {
      news = null;
    }
    const lastYears = a.years.filter((y) => !y.partial).slice(-10).map((y) => [y.y, y.pct, y.maxDdPct]);
    const last12 = a.heat
      .slice(0, 2)
      .flatMap((r) => r.cells.map((c, i) => (c ? [`${r.y}-${String(i + 1).padStart(2, "0")}`, c.pct, c.partial] : null)))
      .filter(Boolean)
      .sort((p, q) => (p[0] < q[0] ? -1 : 1))
      .slice(-13);
    return {
      index: isDemo ? `a demo index (synthetic data)` : INDICES[id].name,
      horizon,
      period: live.label,
      today: istDate(this.now()),
      level: live.base,
      startLevel: live.base0,
      moveSoFarPct: r2(pctOf(live.base, live.base0)),
      sessionsLeft: live.daysLeft,
      sessionsInPeriod: live.daysTotal,
      oneStandardMoveForTimeLeftPct: live.sigmaPct,
      calendarMonth: horizon === "month" ? { name: tm.name, years: tm.n, rose: tm.up, winRatePct: tm.winRate, avgPct: tm.avgPct, medianPct: tm.medianPct, stdPct: tm.stdPct, best: tm.best, worst: tm.worst, avgBestPointPct: tm.avgUpExcPct, avgWorstPointPct: tm.avgDownExcPct, last10Years: tm.last10, byYear: (tm.years || []).slice(-15).map((x) => [x.y, x.pct]) } : null,
      allMonths: a.overall.months,
      allYears: { ...a.overall.years, cagrPct: a.overall.cagrPct },
      lastMonths: { columns: ["month", "pct", "inProgress"], rows: last12 },
      lastYears: { columns: ["year", "pct", "deepestFallPct"], rows: lastYears },
      averageYearPath: horizon === "year" ? { ytdAtMonthEnd: a.seasonal.rows.map((r) => [r.short, r.avg, r.p25, r.p75]), thisYear: a.seasonal.current } : null,
      monthSeasonality: horizon === "year" ? ms.filter((m) => m.n).map((m) => [m.short, m.winRate, m.avgPct]) : null,
      fromAllTimeHigh: a.patterns.drawdowns ? { ...a.patterns.drawdowns.now, high: a.patterns.drawdowns.ath } : null,
      afterBigMonths: a.patterns.afterMonths,
      deskProjection: { expectedClose: live.mid, range68: [live.low68, live.high68], range90: [live.low90, live.high90], chanceUpPct: live.probUp, lean: live.lean, reasons: live.reasons, parts: live.parts },
      deskRecordWalkForward: a.backtest[horizon].summary,
      newsMood: news,
      nseForecastFromTheWorld: world,
    };
  }

  /** The AI's answer, checked against the index's own volatility before it is kept. */
  _check(r, live) {
    const notes = [];
    if (![r.close, r.low, r.high].every(num)) return { ok: false, notes: ["It did not give a close and a range in numbers."] };
    if (!(r.low <= r.close && r.close <= r.high)) return { ok: false, notes: [`Its range ${r.low}–${r.high} does not contain its own close ${r.close}.`] };
    if (r.close < live.low98 || r.close > live.high98) return { ok: false, notes: [`A close of ${r.close} is beyond what the index's own volatility allows in ${live.daysLeft} sessions (98% range ${live.low98}–${live.high98}).`] };
    let low = r.low;
    let high = r.high;
    if (low < live.low98 || high > live.high98) {
      low = Math.max(low, live.low98);
      high = Math.min(high, live.high98);
      notes.push(`Its range was wider than the index can plausibly move in the time left; it is kept at ${r2(low)}–${r2(high)}.`);
    }
    const deskWidth = live.high68 - live.low68;
    if (deskWidth > 0 && high - low < deskWidth * 0.5) notes.push(`Its range is narrower than half of what the index's volatility allows (${r2(deskWidth)} points for a 68% range): likely overconfident.`);
    if (num(r.probUp) && ((r.lean === "up" && r.probUp < 50) || (r.lean === "down" && r.probUp > 50))) notes.push(`Its lean (${r.lean}) and its chance of an up period (${r.probUp}%) disagree.`);
    return { ok: true, notes, low: r2(low), high: r2(high) };
  }

  /**
   * The AI Engine's projection for one index and period, checked and kept in the ledger.
   * @param horizon "month" | "year"
   */
  async askAi(id, horizon = "month", { auto = false } = {}) {
    if (!INDICES[id]) throw new IndexError("Unknown index: NIFTY or SENSEX.");
    if (!["month", "year"].includes(horizon)) throw new IndexError("The period is month or year.");
    if (!this.ai || !this.ai.indexAi || !this.ai.indexAi.ready()) throw new IndexError("No AI key is saved (the default model is Claude Sonnet 5.5 — save its key on the AI page).", "not_configured", 409);
    const st = this.settings();
    if (st.aiToday >= AI_DAILY_CAP) throw new IndexError(`Today's ${AI_DAILY_CAP} AI index projections are used up.`, "rate_limited", 429);
    const key = `${id}|${horizon}`;
    if (this.asking.has(key)) throw new IndexError("The AI is already working on this projection.", "busy", 409);
    const { c, a } = await this._analysis(id);
    if (!a.available) throw new IndexError(a.reason, "not_ready", 409);
    const live = a.projections[horizon].live;
    if (!live || !live.available) throw new IndexError(live ? live.reason : "No projection can be made yet.", "not_ready", 409);
    if (live.daysLeft <= 0) throw new IndexError("The period is over: its projection can no longer be made.", "not_ready", 409);
    const items = this._ledger();
    const mine = items.filter((x) => x.index === id && x.horizon === horizon && x.kind === "ai");
    if (auto && mine.some((x) => x.period === live.period && x.trigger === "auto")) return null;
    const recent = mine.find((x) => x.trigger === "asked" && this.now() - Date.parse(x.madeAt) < AI_MANUAL_GAP_MS);
    if (!auto && recent) throw new IndexError(`The AI gave its ${horizon} projection for ${INDICES[id].name} at ${istIso(Date.parse(recent.madeAt)).slice(11, 16)}. One every three hours.`, "rate_limited", 429);
    this.asking.add(key);
    try {
      let r;
      try {
        let world = null;
        try {
          const f = !c.demo && typeof this.market.marketForecast === "function" ? await this.market.marketForecast() : null;
          world = f && f.available ? { lean: f.lean, headline: f.headline } : null;
        } catch (_) {
          world = null;
        }
        r = await this.ai.indexAi.project(this._snapshot(id, a, horizon, c.demo, world));
      } catch (err) {
        throw new IndexError(err && err.message ? err.message : "The AI did not answer.", "ai_failed", 502);
      }
      if (!r) throw new IndexError("The AI model did not answer just now.", "ai_failed", 502);
      if (!r.cached) this._countAi();
      const chk = this._check(r, live);
      const entry = {
        id: `${id}-${horizon}-${live.period}-ai-${this.now()}`,
        index: id,
        horizon,
        period: live.period,
        label: live.label,
        kind: "ai",
        by: r.by,
        trigger: auto ? "auto" : "asked",
        madeAt: new Date(this.now()).toISOString(),
        asOf: live.asOf,
        demo: Boolean(c.demo),
        startLevel: live.base0,
        base: live.base,
        mid: r.close,
        low68: chk.ok ? chk.low : r.low,
        high68: chk.ok ? chk.high : r.high,
        low90: null,
        high90: null,
        lean: r.lean === "sideways" ? "none" : r.lean,
        probUp: r.probUp,
        confidence: r.confidence,
        reasons: r.reasons,
        risks: r.risks,
        check: { ok: chk.ok, notes: chk.notes },
        desk: { mid: live.mid, low68: live.low68, high68: live.high68, probUp: live.probUp, lean: live.lean },
        status: chk.ok ? (c.demo ? "demo" : "open") : "refused",
      };
      const all = this._ledger();
      all.unshift(entry);
      this._saveLedger(all);
      return entry;
    } finally {
      this.asking.delete(key);
    }
  }

  /* ------------------------------------------------------------------------------ the clock */
  async tick() {
    const now = this.now();
    const mode = this._mode();
    if (mode !== "kite") return;
    const today = istDate(now);
    // after the close, once a day: the closing candle, the desk's projections recorded, ended periods scored
    if (weekday(now) && minuteOfDay(now) >= 15 * 60 + 40 && this._dayDone !== today) {
      this._dayDone = today;
      for (const id of Object.keys(INDICES)) await this.view(id, { refresh: true }).catch((err) => this.log.error(`[indices] ${id}: ${err.message}`));
    }
    // the AI's projection by itself: the month on its first weekday, the year in January (from 8:45 AM)
    const st = this.settings();
    if (!st.aiAuto || !weekday(now) || minuteOfDay(now) < 8 * 60 + 45 || !this.ai || !this.ai.indexAi || !this.ai.indexAi.ready()) return;
    const day = Number(today.slice(8, 10));
    for (const id of Object.keys(INDICES)) {
      for (const horizon of ["month", "year"]) {
        if (horizon === "month" && day > 7) continue; // the first week only: later it would know too much of the month
        if (horizon === "year" && (today.slice(5, 7) !== "01" || day > 10)) continue;
        try {
          const made = await this.askAi(id, horizon, { auto: true });
          if (made) {
            this.log.log(`[indices] the AI's ${horizon} projection for ${id}: ${made.mid} (${made.status})`);
            return; // one a round
          }
        } catch (_) {
          /* tried again on the next round */
        }
      }
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.log.error(`[indices] ${err.message}`));
    }, 10 * 60000);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { IndexHistory, IndexError, INDICES, MODEL };
