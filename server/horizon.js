"use strict";
// The 15-minute forecast service: it learns how prices move over the next 5 to 30 minutes from every stored session of
// every NIFTY 100 stock, forecasts the price, the high and the low for the stock on the Desk, scores every forecast
// against what happened, and learns again each evening. The arithmetic is in server/market/horizon.js; this keeps it.
//
//   HISTORY   the NIFTY 100's 5-minute bars of the last year, already kept in the database by the paper robot
//             (collection robot_history). The first training reads all of them once: about a million examples, the
//             newest quarter held back to measure the model out of sample.
//   EVERY DAY after the close (3:40 PM), once the day's bars are in: the whole day of every NIFTY 100 stock is first
//             FORECAST with the model as it was that morning and scored (a fresh out-of-sample test on about 7,000
//             examples a day, all stocks), then ADDED to the model's sums and the weights are solved again. The
//             accuracy of each day is kept (collection horizon_days) so improvement, or the lack of it, is visible.
//   LIVE      while the market is open, every finished 5-minute bar, for the stocks on the watchlist and the ones
//             being looked at: a forecast is made, kept (collection horizon_forecasts) and, when its time comes,
//             scored. Each stock's own bias, and how much the news mood and the AI's last live read are worth, are
//             learned from that record — what no history can teach, because no news archive exists for past minutes.
//   SELF-CORRECTION  the model's confidence is checked against its own record every day: its stated probabilities are
//             calibrated (when it says 70%, how often was it right?), its bands are widened or narrowed to hold 70% of
//             outcomes, and its moves are scaled back if they were too bold.
//
// It reads the market. It never trades and asks no AI model (it uses an AI read that already exists, when there is
// one). A forecast is a probability and a range: it is measured, never promised.

const H = require("./market/horizon");
const B = require("./market/boost"); // the decision trees: the forecaster's nonlinear stage (22 Nov 2026)
const { unpack, sessions, msOf } = require("./robot/history");

const IST = 5.5 * 3600 * 1000;
const COLLECTION = "horizon_forecasts";
const DAYS = "horizon_days";
const MODEL = "market/horizon-model.json";
const LEARNING = "horizon_learning"; // one record per training and per evening: what was chosen and what was learned
const SECTION = "## What the desk has measured about the next 15 minutes (written by itself after every evening's learning)";
const INDEX = "NIFTY 50";
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9&._ -]{0,24}$/;
const OPEN_FROM = 9 * 60 + 20;
const OPEN_TO = 15 * 60 + 30;
const LEARN_FROM = 15 * 60 + 40;
const MAX_LIVE = 25;
const KEEP_DAYS = 45;
const RETRAIN_DAYS = 35;
const STRIDE = 2;
const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const r4 = (x) => (num(x) ? Math.round(x * 10000) / 10000 : null);
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const minuteOfDay = (ms) => {
  const d = new Date(ms + IST);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const weekday = (date) => {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
};
const tick = () => new Promise((r) => setImmediate(r));
const iso = (ms) => new Date(ms).toISOString();

const SESSION = require("./market/session");
const { liveCloseSlot } = SESSION;

class HorizonError extends Error {
  constructor(message, code = "horizon", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** What each input means, in a few words, for the "why" list. */
const WHY = {
  r1: ["the last 5 minutes pushed the price up", "the last 5 minutes pushed the price down"],
  r3: ["the last 15 minutes were rising", "the last 15 minutes were falling"],
  r6: ["the last half hour was rising", "the last half hour was falling"],
  r12: ["the last hour was rising", "the last hour was falling"],
  fromOpen: ["it is well above the open", "it is well below the open"],
  gap: ["it opened above yesterday's close", "it opened below yesterday's close"],
  vwap: ["the price is above the day's average (VWAP)", "the price is below the day's average (VWAP)"],
  pos: ["it sits high in the day's range", "it sits low in the day's range"],
  rsi: ["RSI is strong", "RSI is weak"],
  vol: ["volume is heavier than usual for this time", "volume is lighter than usual for this time"],
  volDir: ["heavy volume is behind the move up", "heavy volume is behind the move down"],
  vnow: ["recent bars are wider than usual", "recent bars are narrower than usual"],
  tOpen: ["it is the opening rush", "it is the opening rush"],
  tClose: ["it is the closing rush", "it is the closing rush"],
  m3: ["the market is rising", "the market is falling"],
  m6: ["the market has been rising for half an hour", "the market has been falling for half an hour"],
  prevDay: ["yesterday was an up day", "yesterday was a down day"],
  trend: ["the last ten days drifted up", "the last ten days drifted down"],
  clv: ["the last bar closed near its high", "the last bar closed near its low"],
  clv3: ["the last three bars closed near their highs", "the last three bars closed near their lows"],
  wick: ["the last bar was rejected from above", "the last bar was rejected from below"],
  z20: ["the price is stretched above its 20-bar mean", "the price is stretched below its 20-bar mean"],
  orb: ["the price is above the opening range", "the price is below the opening range"],
  r1sq: ["the last bar was an unusually big rise", "the last bar was an unusually big fall"],
  rsiX: ["RSI is past 70", "RSI is under 30"],
  dHigh: ["the day's high is some way off", "the day's high is some way off"],
  dLow: ["the day's low is some way off", "the day's low is some way off"],
  orb5: ["it is above the first 5-minute bar, which traded unusual volume", "it is below the first 5-minute bar, which traded unusual volume"],
  noise: ["it is above its usual range for this time of day", "it is below its usual range for this time of day"],
  mom30: ["the first half-hour was up", "the first half-hour was down"],
  tod1: ["on recent days it rose in the next 5 minutes at this time", "on recent days it fell in the next 5 minutes at this time"],
  tod3: ["on recent days it rose over the next 15 minutes at this time", "on recent days it fell over the next 15 minutes at this time"],
  rs: ["it is stronger than the market today", "it is weaker than the market today"],
  ema: ["EMA 9 is above EMA 21", "EMA 9 is below EMA 21"],
  er: ["the last hour went up in a straight line", "the last hour went down in a straight line"],
  pivot: ["it is above yesterday's pivot", "it is below yesterday's pivot"],
  pdx: ["it is above yesterday's high", "it is below yesterday's low"],
  cpr: ["a rising day after a narrow pivot range", "a falling day after a narrow pivot range"],
  gapGo: ["the gap is being extended", "the gap is being faded"],
  vwSide: ["the last closes held above VWAP", "the last closes held below VWAP"],
  sqz: ["a rise out of a quiet stretch", "a fall out of a quiet stretch"],
};
const CHECK_RULE = "A call that leans (55% or more one way) is CORRECT when the price went that way by its time; a call with no lean is CORRECT when the price ended inside its band. Every forecast kept is checked this way, 5 and 15 minutes after it was made.";

/** The slot after a session's last bar, when the session ran into the afternoon; otherwise the usual 75 (3:30 PM). */
function closeSlotOf(rawBars) {
  const bars = H.cleanBars(rawBars || []);
  const last = bars.length ? bars[bars.length - 1].s + 1 : 0;
  return last >= 66 ? last : H.SESSION_BARS;
}

class Horizon {
  /**
   * @param market    the MarketService (_recentBars, daily, quotes, watchlist, social) — reads only
   * @param docs      the record store
   * @param history   () => the paper robot's HistoryStore (bars(symbol), record(symbol), status(), needs(), sync())
   * @param universe  () => the NIFTY 100's symbols
   * @param ai        the AiService, optional (its last live read for a stock; no model is asked)
   * @param flow      the market recorder (or () => it), optional: tiltFor(symbol, barEndMs) → the order book and open
   *                  interest recorded at that minute and the correction they have earned (server/recorder.js)
   */
  constructor({ market, docs, history, universe, ai = null, playbook = null, flow = null, guard = null, now = () => Date.now(), log = console }) {
    this.flow = flow;
    // automatic training / learning never right after a start, and never again at once after a run the server did not live
    // through (server/train-guard.js — the 502 loop of 21 Nov 2026); optional: without it, nothing changes
    this.guard = guard;
    this.playbook = playbook; // the trading-skills file every AI feature reads: the forecaster writes its findings into it
    this.market = market;
    this.docs = docs;
    this.history = history;
    this.universe = universe;
    this.ai = ai;
    this.now = now;
    this.log = log;
    this.timer = null;
    this._model = null;
    this._map = null;
    this._opened = new Map(); // symbol → last asked (ms)
    this._anchor = new Map(); // symbol → anchor end of the last record kept
    this._cache = new Map(); // symbol → { at, anchor, view }
    this._job = null;
    this._sweepSlot = "";
    this._scoreAt = 0;
    this._dailyAt = "";
    this._tryAt = 0;
    this._stats = new WeakMap(); // a list of sessions → what each one leaves behind (worked out once)
    this._prior = new Map(); // symbol → { date, ctx }: what the sessions before today say (for the live forecast)
    this._tally = null; // the check's totals over every stock, kept until the record changes
    this._last = new Map(); // symbol → { at, r }: the last reading of a stock, lent to the early calls for fifteen seconds
    this.lastError = "";
  }

  /* --------------------------------------------------------------------------- the record */
  _recs() {
    if (!this._map) this._map = new Map(this.docs.items(COLLECTION).map((r) => [r.id, r]));
    return this._map;
  }
  model() {
    if (!this._model) this._model = this.docs.read(MODEL, null);
    return this._model;
  }
  _usable() {
    const m = this.model();
    // a model made from another list of inputs cannot be used (its sums do not match): it is retrained by itself
    return m && m.W && m.version === H.MODEL_VERSION ? m : null;
  }
  /** Changes whenever the model, the record or a learning run does (the live hub compares it). */
  fingerprint() {
    const j = this._job;
    return `${this._rev || 0}|${j ? `${j.kind}|${j.phase}|${Math.floor((j.done || 0) / 10)}|${j.finishedAt || ""}` : ""}`;
  }
  _saveModel(m) {
    this._rev = (this._rev || 0) + 1;
    this._model = m;
    this.docs.write(MODEL, m);
  }
  _historyStore() {
    try {
      return typeof this.history === "function" ? this.history() : this.history;
    } catch (_) {
      return null;
    }
  }
  _stocks() {
    const h = this._historyStore();
    if (!h) return [];
    return (this.universe() || []).filter((s) => h.record(s));
  }
  _connected() {
    return typeof this.market.mode === "function" && this.market.mode() === "kite";
  }

  /* --------------------------------------------------------------------------- one stock's sessions */
  /** [[date, bars]] oldest first, whole sessions, from the stored history. */
  _days(symbol) {
    const h = this._historyStore();
    const bars = h ? h.bars(symbol) : [];
    return [...sessions(bars).entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }

  /** The inputs one session needs besides its own bars, from the sessions before it. */
  /** What one stored session leaves behind (close, high, low, bar returns, distance from the open), once per list of sessions. */
  _dayStat(days, i) {
    let c = this._stats.get(days);
    if (!c) this._stats.set(days, (c = new Array(days.length)));
    if (c[i] === undefined) c[i] = H.dayStat(days[i][1]);
    return c[i];
  }

  _ctxFor(profile, days, idx, mkt) {
    const closeOf = (i) => {
      const st = this._dayStat(days, i);
      return st ? st.close : null;
    };
    // yesterday's levels, the usual distance from the open and the same-time-of-day returns: from the 14 sessions BEFORE this one
    const before = [];
    for (let i = Math.max(0, idx - 14); i < idx; i += 1) before.push(this._dayStat(days, i));
    const pc = H.priorContext(before);
    const prevClose = closeOf(idx - 1);
    const prev2 = idx >= 2 ? closeOf(idx - 2) : null;
    const ten = idx >= 11 ? closeOf(idx - 11) : null;
    const dayR = profile.day || profile.sigma * 15;
    return {
      sigma: profile.sigma,
      day: profile.day,
      beta: profile.beta,
      vol: profile.vol,
      prevClose,
      prevDayRet: prevClose && prev2 ? (prevClose - prev2) / prev2 : null,
      trend: prevClose && ten ? (prevClose / ten - 1) / (dayR * Math.sqrt(10)) : 0,
      mkt: mkt ? mkt.get(days[idx][0]) || null : null,
      prevHigh: pc ? pc.prevHigh : null,
      prevLow: pc ? pc.prevLow : null,
      noise: pc ? pc.noise : null,
      tod: pc ? pc.tod : null,
      // when continuous trading ended on this session, as a 5-minute slot (75 = 3:30 PM; 72 = 3:15 PM where a closing auction
      // follows): the evidence desk's end-of-day techniques count back from it (server/market/evidence.js)
      closeSlot: closeSlotOf(days[idx][1]),
    };
  }

  /** The same context for the live forecast: from the stored sessions before today (a stock with no stored history has none). */
  _priorFor(symbol, today) {
    const hit = this._prior.get(symbol);
    if (hit && hit.date === today) return hit.ctx;
    let ctx = null;
    try {
      const days = this._days(symbol).filter(([d]) => d < today).slice(-14);
      ctx = H.priorContext(days.map(([, raw]) => H.dayStat(raw)));
    } catch (_) {
      ctx = null;
    }
    if (this._prior.size > 400) this._prior.clear();
    this._prior.set(symbol, { date: today, ctx });
    return ctx;
  }

  /* --------------------------------------------------------------------------- training from the whole history */
  jobView() {
    return this._job ? { ...this._job } : null;
  }

  /**
   * Learn from every stored session of every NIFTY 100 stock. The newest quarter of the sessions is held back and
   * scored out of sample; then the model is fitted on all of it. One run at a time. Resolves with the summary.
   */
  train({ trigger = "manual" } = {}) {
    if (this._job && !this._job.finishedAt) return Promise.resolve({ busy: true });
    const stocks = this._stocks();
    if (!stocks.length) return Promise.reject(new HorizonError("There is no stored history to learn from yet: the NIFTY 100's 5-minute history is downloaded under Paper trading. It needs Zerodha connected.", "no_history", 409));
    const wait = this.guard ? this.guard.wait("horizon-train", trigger) : "";
    if (wait) return Promise.reject(new HorizonError(`Training waits: ${wait}.`, "deferred", 409));
    this._job = { kind: "train", trigger, phase: "reading the market", total: stocks.length, done: 0, rows: 0, startedAt: iso(this.now()), finishedAt: null, error: "" };
    const run = this._train(stocks)
      .catch((err) => {
        this._job.error = err.message || String(err);
        this.lastError = this._job.error;
        this.log.error(`[horizon] training failed: ${this._job.error}`);
        throw err;
      })
      .finally(() => {
        this._job.finishedAt = iso(this.now());
      });
    return this.guard ? this.guard.track("horizon-train", trigger, run) : run;
  }

  async _train(stocks) {
    const job = this._job;
    // pass A: the market's own 5-minute moves (an average of the stocks), date by date
    const mktAcc = new Map();
    for (const s of stocks) {
      const days = this._days(s);
      for (const [date, raw] of days) {
        const bars = H.cleanBars(raw);
        let m = mktAcc.get(date);
        if (!m) mktAcc.set(date, (m = { s: new Float64Array(H.SESSION_BARS), c: new Float64Array(H.SESSION_BARS) }));
        for (let i = 0; i < bars.length; i += 1) {
          const prev = i ? bars[i - 1].c : bars[i].o;
          m.s[bars[i].s] += (bars[i].c - prev) / prev;
          m.c[bars[i].s] += 1;
        }
      }
      job.done += 1;
      await tick();
    }
    const mkt = new Map();
    for (const [date, m] of mktAcc) {
      const a = new Float64Array(H.SESSION_BARS);
      for (let i = 0; i < H.SESSION_BARS; i += 1) a[i] = m.c[i] >= 10 ? m.s[i] / m.c[i] : NaN;
      mkt.set(date, a);
    }
    const dates = [...mkt.keys()].sort();
    if (dates.length < 40) throw new HorizonError(`Only ${dates.length} stored sessions: the model needs at least 40 to learn from.`, "short_history", 409);
    const cut = dates[Math.floor(dates.length * 0.75)];
    const newest = dates[dates.length - 1];
    // pass B: every stock's rows
    job.phase = "learning";
    job.done = 0;
    const train = new H.Stats();
    const val = new H.Stats();
    // the time-of-day experts (the challenger): the same sums, kept per part of the day
    const trainSeg = H.SEGMENTS.map(() => new H.Stats());
    const valSeg = H.SEGMENTS.map(() => new H.Stats());
    const valRows = [];
    const treeRows = new B.Reservoir(B.SAMPLE); // a fair sample of the training rows, for the decision trees
    const profiles = {};
    for (const s of stocks) {
      const days = this._days(s);
      const prof = H.buildProfile(days, mkt);
      if (prof) {
        profiles[s] = prof;
        for (let d = 1; d < days.length; d += 1) {
          const date = days[d][0];
          if (date > newest) continue;
          const ctx = this._ctxFor(prof, days, d, mkt);
          if (!ctx.prevClose) continue;
          const rows = H.dayRows(days[d][1], ctx, { targets: true, stride: STRIDE });
          const w = H.DECAY_DAY ** H.daysBetween(date, newest);
          for (const row of rows) {
            const sg = H.segOf(row.s);
            if (date <= cut) {
              train.add(row.x, row.y, w);
              trainSeg[sg].add(row.x, row.y, w);
              if ((row.s & 1) === 0) treeRows.add({ x: row.x, y: row.y, s: row.s, bucket: row.bucket, sym: s });
            } else {
              val.add(row.x, row.y, w);
              valSeg[sg].add(row.x, row.y, w);
              if (valRows.length < 160000 && (row.s & 2) === 0) {
                row.sym = s;
                valRows.push(row);
              }
            }
          }
          job.rows += rows.length;
        }
      }
      job.done += 1;
      await tick();
    }
    job.phase = "measuring it on sessions it has not seen";
    await tick();
    // The unseen rows are split in two. Every CHOICE (which model, how much of the experts, the calibration, each stock's
    // scale, the width of the band) is made on one half; every NUMBER SHOWN is measured on the other, which chose nothing.
    const pick = valRows.filter((_, i) => i % 2 === 0);
    const judge = valRows.filter((_, i) => i % 2 === 1);
    // 1. the contest between the candidate models (the original inputs / all inputs / all inputs shrunk harder)
    const Ws = H.fitCandidates(train);
    if (!Ws[0]) throw new HorizonError("Not enough examples to fit the model.", "short_history", 409);
    const arena = H.arenaEvidence(null, Ws, pick);
    const ci = H.chooseChampion(arena, Ws);
    const champ = H.CANDIDATES[ci];
    const Wtrain = Ws[ci];
    // 2. the time-of-day experts, as far as they beat the champion alone
    const WsegTrain = trainSeg.map((st) => H.fit(st, champ.lambda, H.SEG_MIN_ROWS, champ.dims));
    const evidence = H.alphaEvidence(null, Wtrain, WsegTrain, pick);
    const alpha = H.chooseAlpha(evidence);
    const segsTrain = { W: WsegTrain, alpha };
    // 3. how bold the calls should be (one factor per target)
    const raw = H.scoreRows(H.emptyEval(), Wtrain, pick, { keepZ: false, segs: segsTrain });
    const slope = raw.pp.map((pp, k) => (pp > 0 ? Math.max(0.3, Math.min(1.5, raw.pa[k] / pp)) : 1));
    // 4. each stock's own scale, and whether using the scales makes the forecasts miss less
    const recs = {};
    for (const row of pick) {
      const p = H.predictRow(Wtrain, row.x, slope, H.segFor(segsTrain, row.s));
      const r = recs[row.sym] || (recs[row.sym] = { pp: 0, pa: 0 });
      for (let k = 0; k < H.HORIZONS.length; k += 1) {
        r.pp += p[k] * p[k];
        r.pa += p[k] * row.y[k];
      }
    }
    const scalesOf = (rs) => Object.fromEntries(Object.entries(rs).map(([sym, r]) => [sym, H.stockScaleOf(r)]));
    const sumSe = (e) => Array.from(e.se).reduce((a, b) => a + b, 0);
    const seNo = sumSe(H.scoreRows(H.emptyEval(), Wtrain, judge, { keepZ: false, segs: segsTrain, slope }));
    const seYes = sumSe(H.scoreRows(H.emptyEval(), Wtrain, judge, { keepZ: false, segs: segsTrain, slope, scales: scalesOf(recs) }));
    const stockCal = { on: seNo > 0 && (seNo - seYes) / seNo >= H.MIN_GAIN / 2, recs: Object.fromEntries(Object.entries(recs).map(([k2, r]) => [k2, { pp: r4(r.pp), pa: r4(r.pa) }])), se: [r2(seNo), r2(seYes)], n: judge.length };
    const scales = stockCal.on ? scalesOf(recs) : null;
    // 5. the spread of the misses and the width of the band, from the choosing half
    let ev = H.scoreRows(H.emptyEval(), Wtrain, pick, { keepZ: false, segs: segsTrain, slope, scales });
    const resSd = H.resSdOf(ev);
    ev = H.scoreRows(H.emptyEval(), Wtrain, pick, { resSd, keepZ: true, segs: segsTrain, slope, scales });
    const z70 = H.z70Of(ev);
    // 6. the numbers shown: the model as it will be used, and the original model alone, both on the half that chose nothing
    const used = H.scoreRows(H.emptyEval(), Wtrain, judge, { resSd, z70, slope, keepZ: false, segs: segsTrain, scales });
    const pooledOnly = H.summariseEval(H.scoreRows(H.emptyEval(), Ws[0], judge, { keepZ: false }));
    // 7. the decision trees: what the model as used still misses, learned nonlinearly; per target, used only where they cut the
    //    miss on the choosing half AND the half that chose nothing confirms it (market/boost.js)
    job.phase = "growing decision trees on what it still misses";
    let boost = null;
    try {
      const usedP = (row) => H.predictRow(Wtrain, row.x, slope, H.segFor(segsTrain, row.s), scales && row.sym ? scales[row.sym] || 1 : 1);
      const thin = (rows, cap) => (rows.length <= cap ? rows : rows.filter((_, i) => i % Math.ceil(rows.length / cap) === 0));
      boost = await B.trainBooster({ trainRows: treeRows.items, pickRows: thin(pick, 20000), judgeRows: thin(judge, 20000), predict: usedP, targets: H.TARGETS.length, pause: tick });
      boost.trainedAt = iso(this.now());
      this.log.log(`[horizon] decision trees: in use for ${boost.on.filter(Boolean).length} of ${H.TARGETS.length} targets`);
    } catch (err) {
      boost = { on: [], trees: [], record: null, error: err.message };
      this.log.error(`[horizon] the decision trees could not be grown: ${err.message}`);
    }
    train.merge(val);
    const Wall = H.fitCandidates(train);
    const W = Wall[ci] || Wtrain;
    trainSeg.forEach((st, i) => st.merge(valSeg[i]));
    const seg = { stats: trainSeg.map((st) => st.toJSON()), W: trainSeg.map((st) => H.fit(st, champ.lambda, H.SEG_MIN_ROWS, champ.dims)), alpha, evidence: { n: evidence.n, se: evidence.se.map((r) => r.map((v) => Math.round(v * 100) / 100)) } };
    job.phase = "saving";
    const old = this.model();
    const model = {
      version: H.MODEL_VERSION,
      champion: champ.id,
      Wall,
      arena: { n: arena.n, se: arena.se.map((r) => r.map((v) => r2(v))) },
      stockCal,
      trainedAt: iso(this.now()),
      lastDate: newest,
      stats: train.toJSON(),
      W,
      resSd,
      z70,
      slope: Array.from(slope, (v) => Math.round(v * 1000) / 1000),
      bandScale: 1,
      profiles,
      seg,
      live: old && old.live ? old.live : { bias: {}, tilt: {}, n: 0 },
      validation: { from: dates.find((d) => d > cut) || null, to: newest, trainTo: cut, sessions: dates.length, stocks: Object.keys(profiles).length, examples: valRows.length, horizons: H.summariseEval(used), pooled: pooledOnly.map((x) => ({ h: x.h, skill: x.skill, dirAcc: x.dirAcc })) },
      learned: { days: 0, lastAt: null },
      rows: train.n,
      boost,
    };
    this._saveModel(model);
    this._cache.clear();
    this.lastError = "";
    this._teach(model, "training");
    this.log.log(`[horizon] model in use: ${champ.name}; experts ${alpha.some((a) => a > 0) ? "used" : "not used"}; per-stock scales ${stockCal.on ? "used" : "not used"}`);
    this.log.log(`[horizon] trained on ${train.n.toLocaleString("en-IN")} examples from ${dates.length} sessions of ${model.validation.stocks} stocks; out of sample at 15 min: ${Math.round(((model.validation.horizons.find((h) => h.h === 3) || {}).dirAcc || 0) * 1000) / 10}% direction`);
    return { rows: train.n, sessions: dates.length, stocks: model.validation.stocks, validation: model.validation };
  }

  /* --------------------------------------------------------------------------- learning each evening */
  /**
   * Every session in the stored history newer than what the model has learned: forecast it with the model as it stood,
   * score that, then add it to the model. All NIFTY 100 stocks. One run at a time.
   */
  learnDays({ trigger = "itself" } = {}) {
    if (this._job && !this._job.finishedAt) return Promise.resolve({ busy: true });
    const m = this._usable();
    if (!m) return Promise.resolve({ skipped: "untrained" });
    const wait = this.guard ? this.guard.wait("horizon-learn", trigger) : "";
    if (wait) return Promise.reject(new HorizonError(`Learning waits: ${wait}.`, "deferred", 409));
    const stocks = this._stocks();
    this._job = { kind: "learn", trigger, phase: "reading the new sessions", total: stocks.length, done: 0, rows: 0, startedAt: iso(this.now()), finishedAt: null, error: "" };
    const run = this._learnDays(m, stocks)
      .catch((err) => {
        this._job.error = err.message || String(err);
        this.lastError = this._job.error;
        this.log.error(`[horizon] learning failed: ${this._job.error}`);
        throw err;
      })
      .finally(() => {
        this._job.finishedAt = iso(this.now());
      });
    return this.guard ? this.guard.track("horizon-learn", trigger, run) : run;
  }

  async _learnDays(m, stocks) {
    const job = this._job;
    const newDates = new Set();
    const per = new Map();
    for (const s of stocks) {
      const days = this._days(s);
      per.set(s, days.length);
      for (const [date] of days) if (date > m.lastDate) newDates.add(date);
    }
    const dates = [...newDates].sort();
    if (!dates.length) {
      job.phase = "nothing new";
      return { days: 0 };
    }
    const newest = dates[dates.length - 1];
    // the market's moves on the new dates
    const mktAcc = new Map();
    for (const s of stocks) {
      for (const [date, raw] of this._days(s)) {
        if (date <= m.lastDate) continue;
        const bars = H.cleanBars(raw);
        let a = mktAcc.get(date);
        if (!a) mktAcc.set(date, (a = { s: new Float64Array(H.SESSION_BARS), c: new Float64Array(H.SESSION_BARS) }));
        for (let i = 0; i < bars.length; i += 1) {
          const prev = i ? bars[i - 1].c : bars[i].o;
          a.s[bars[i].s] += (bars[i].c - prev) / prev;
          a.c[bars[i].s] += 1;
        }
      }
      await tick();
    }
    const mkt = new Map();
    for (const [date, a] of mktAcc) {
      const v = new Float64Array(H.SESSION_BARS);
      for (let i = 0; i < H.SESSION_BARS; i += 1) v[i] = a.c[i] >= 10 ? a.s[i] / a.c[i] : NaN;
      mkt.set(date, v);
    }
    const stats = H.Stats.from(m.stats);
    const gapDecay = H.DECAY_DAY ** Math.max(1, H.daysBetween(m.lastDate, newest));
    stats.scale(gapDecay);
    const W = m.W;
    // the experts learn the day too, and the evidence for and against them is counted again on it (out of sample)
    const segNow = m.seg && m.seg.W ? m.seg : null;
    const segStats = H.SEGMENTS.map((_, i) => H.Stats.from(segNow && segNow.stats ? segNow.stats[i] : null));
    segStats.forEach((st) => st.scale(gapDecay));
    const evidence = { n: 0, se: Array.from({ length: H.T }, (_, k) => H.ALPHAS.map((__, i) => ((segNow && segNow.evidence && segNow.evidence.se[k] ? segNow.evidence.se[k][i] : 0) || 0) * 0.97)) };
    evidence.n = Math.round(((segNow && segNow.evidence && segNow.evidence.n) || 0) * 0.97);
    const segs = segNow ? { W: segNow.W, alpha: segNow.alpha } : null;
    // the contest and the stocks' scales are judged again on the new sessions, which no candidate has seen
    const Wall = m.Wall || H.CANDIDATES.map((c) => (c.id === m.champion ? m.W : null));
    const arena = { n: Math.round(((m.arena && m.arena.n) || 0) * 0.97), se: H.CANDIDATES.map((_, c) => H.HORIZONS.map((__, k) => (((m.arena && m.arena.se[c]) || [])[k] || 0) * 0.97)) };
    const cal = m.stockCal || { on: false, recs: {}, se: [0, 0], n: 0 };
    const calSe = [(cal.se[0] || 0) * 0.97, (cal.se[1] || 0) * 0.97];
    const calRecs = Object.fromEntries(Object.entries(cal.recs || {}).map(([sym, r]) => [sym, { pp: r.pp * 0.98, pa: r.pa * 0.98 }]));
    const scalesAll = Object.fromEntries(Object.entries(cal.recs || {}).map(([sym, r]) => [sym, H.stockScaleOf(r)]));
    const scales = cal.on ? scalesAll : null;
    const sumSe = (e) => Array.from(e.se).reduce((a, b) => a + b, 0);
    const evs = new Map(dates.map((d) => [d, H.emptyEval()]));
    const counts = new Map(dates.map((d) => [d, 0]));
    const stockStat = m.stockStat || {};
    job.phase = "forecasting and learning from the new sessions";
    job.done = 0;
    for (const s of stocks) {
      const days = this._days(s);
      const prof = (m.profiles || {})[s] || H.buildProfile(days, null);
      if (prof) {
        for (let d = 1; d < days.length; d += 1) {
          const date = days[d][0];
          if (date <= m.lastDate) continue;
          const ctx = this._ctxFor(prof, days, d, mkt);
          if (!ctx.prevClose) continue;
          const rows = H.dayRows(days[d][1], ctx, { targets: true, stride: STRIDE });
          if (!rows.length) continue;
          for (const row of rows) row.sym = s;
          // first the forecast, with the model as it stood; then the lesson
          const one = H.emptyEval();
          H.scoreRows(one, W, rows, { resSd: m.resSd, z70: m.z70, slope: m.slope, bandScale: m.bandScale, keepZ: false, segs, scales });
          H.scoreRows(evs.get(date), W, rows, { resSd: m.resSd, z70: m.z70, slope: m.slope, bandScale: m.bandScale, keepZ: false, segs, scales });
          H.alphaEvidence(evidence, W, segNow ? segNow.W : null, rows);
          H.arenaEvidence(arena, Wall, rows);
          // with and without the stocks' scales (as they stood), then the day goes into this stock's own record
          calSe[0] += sumSe(H.scoreRows(H.emptyEval(), W, rows, { keepZ: false, segs, slope: m.slope }));
          calSe[1] += sumSe(H.scoreRows(H.emptyEval(), W, rows, { keepZ: false, segs, slope: m.slope, scales: scalesAll }));
          const cr = calRecs[s] || (calRecs[s] = { pp: 0, pa: 0 });
          for (const row of rows) {
            const p = H.predictRow(W, row.x, m.slope, H.segFor(segs, row.s));
            for (let k = 0; k < H.HORIZONS.length; k += 1) {
              cr.pp += p[k] * p[k];
              cr.pa += p[k] * row.y[k];
            }
          }
          for (const row of rows) segStats[H.segOf(row.s)].add(row.x, row.y, H.DECAY_DAY ** H.daysBetween(date, newest));
          const k3 = H.HORIZONS.indexOf(3);
          const st = stockStat[s] || { n: 0, hit: 0, miss: 0, naive: 0 };
          st.n += one.n[k3];
          st.hit += one.hit[k3];
          st.miss += one.ae[k3];
          st.naive += one.ae0[k3];
          stockStat[s] = st;
          const w = H.DECAY_DAY ** H.daysBetween(date, newest);
          for (const row of rows) stats.add(row.x, row.y, w);
          counts.set(date, counts.get(date) + rows.length);
          job.rows += rows.length;
        }
        // the stock's usual sizes move on (beta stays: it needs the whole market's history)
        const fresh = H.buildProfile(days, null);
        if (fresh) m.profiles[s] = { ...fresh, beta: prof.beta };
      }
      job.done += 1;
      await tick();
    }
    job.phase = "saving";
    // every candidate learns the day; the champion is the one the evidence favours (it changes only when clearly beaten)
    const WallNew = H.fitCandidates(stats);
    const was = H.CANDIDATES.findIndex((c) => c.id === m.champion);
    const ci = H.chooseChampion(arena, WallNew, was);
    const champ = H.CANDIDATES[ci];
    const Wn = WallNew[ci] || W;
    // the day's own out-of-sample scores correct the model's confidence
    let resSd = m.resSd;
    let slope = m.slope;
    let bandScale = m.bandScale || 1;
    const dayRecords = [];
    for (const date of dates) {
      const ev = evs.get(date);
      if (!counts.get(date)) continue;
      const k3 = H.HORIZONS.indexOf(3);
      const cov = ev.n[k3] ? ev.cover[k3] / ev.n[k3] : 0.7;
      // too few outcomes inside the band → widen; too many → narrow (a gentle step each day)
      bandScale = Math.max(0.6, Math.min(2, bandScale * Math.exp(1.2 * (0.7 - cov))));
      resSd = resSd.map((row, k) =>
        row.map((sd, b) => {
          const [n, ss] = ev.res[k][b];
          return n >= 300 ? Math.sqrt(0.9 * sd * sd + 0.1 * (ss / n)) : sd;
        })
      );
      // ev was measured WITH the present factor: a ratio of 1 means "as bold as it should be", so the factor moves by the ratio
      slope = slope.map((sl, k) => (ev.pp[k] > 0 ? Math.max(0.3, Math.min(1.5, sl * (0.9 + 0.1 * Math.max(0, Math.min(2, ev.pa[k] / ev.pp[k]))))) : sl));
      dayRecords.push({ id: date, date, at: iso(this.now()), stocks: stocks.length, rows: counts.get(date), bandScale: r4(bandScale), horizons: H.summariseEval(ev) });
    }
    this.docs.putItems(DAYS, dayRecords);
    m.stats = stats.toJSON();
    m.W = Wn;
    m.Wall = WallNew;
    m.changed = champ.id !== m.champion ? { from: m.champion, to: champ.id, at: iso(this.now()) } : m.changed || null;
    m.champion = champ.id;
    m.arena = { n: arena.n, se: arena.se.map((r) => r.map((v) => r2(v))) };
    // the scales stay in use while forecasts made with them miss no more than forecasts without; they start being used when clearly better
    m.stockCal = { on: calSe[0] > 0 && (cal.on ? calSe[1] <= calSe[0] : (calSe[0] - calSe[1]) / calSe[0] >= H.MIN_GAIN / 2), recs: Object.fromEntries(Object.entries(calRecs).map(([sym, r]) => [sym, { pp: r4(r.pp), pa: r4(r.pa) }])), se: [r2(calSe[0]), r2(calSe[1])], n: Math.round((cal.n || 0) * 0.97) + job.rows };
    m.seg = { stats: segStats.map((st) => st.toJSON()), W: segStats.map((st) => H.fit(st, champ.lambda, H.SEG_MIN_ROWS, champ.dims)), alpha: H.chooseAlpha(evidence), evidence: { n: evidence.n, se: evidence.se.map((r) => r.map((v) => Math.round(v * 100) / 100)) } };
    m.resSd = resSd;
    m.slope = Array.from(slope, (v) => Math.round(v * 1000) / 1000);
    m.bandScale = r4(bandScale);
    m.lastDate = newest;
    m.stockStat = stockStat;
    m.rows = stats.n;
    m.learned = { days: ((m.learned && m.learned.days) || 0) + dayRecords.length, lastAt: iso(this.now()), last: newest };
    this._saveModel(m);
    this._cache.clear();
    this._teach(m, "evening", { days: dayRecords.map((d) => d.date) });
    const k = dayRecords.length ? (dayRecords[dayRecords.length - 1].horizons.find((x) => x.h === 3) || {}) : {};
    this.log.log(`[horizon] learned ${dayRecords.length} day(s) to ${newest}; the last one forecast at 15 min: ${k.dirAcc == null ? "—" : Math.round(k.dirAcc * 1000) / 10}% direction, band held ${k.coverage == null ? "—" : Math.round(k.coverage * 100)}%`);
    return { days: dayRecords.length, to: newest };
  }

  /* --------------------------------------------------------------------------- for the market recorder's learner */
  /** Is there a model that can make a call? (None before the first training, and while it retrains with new inputs.) */
  ready() {
    return Boolean(this._usable()) && !(this._job && !this._job.finishedAt);
  }

  /** The newest session the stored price history holds ("" when there is none, or while it is being topped up). */
  storedTo() {
    const h = this._historyStore();
    if (!h) return "";
    try {
      const st = h.status();
      return st.running ? "" : st.to || "";
    } catch (_) {
      return "";
    }
  }

  /**
   * Every stock's rows on the given stored sessions, each with the present model's own call beside it (row.p, in the
   * stock's units, for every target). `each(symbol, date, rows)` is called once per stock per session. Nothing is learned
   * or saved here: the recorder uses it to set what the forecaster missed against what it recorded. @returns rows seen
   * `needAll: false` also gives the session's last bars, whose own targets the session does not hold (the early calls,
   * server/ahead.js, work out their own outcomes from the rows' prices).
   */
  async replay(dates, each, { needAll = true } = {}) {
    const m = this._usable();
    if (!m) return 0;
    const want = new Set(dates);
    const stocks = this._stocks();
    const mktAcc = new Map();
    for (const s of stocks) {
      for (const [date, raw] of this._days(s)) {
        if (!want.has(date)) continue;
        const bars = H.cleanBars(raw);
        let a = mktAcc.get(date);
        if (!a) mktAcc.set(date, (a = { s: new Float64Array(H.SESSION_BARS), c: new Float64Array(H.SESSION_BARS) }));
        for (let i = 0; i < bars.length; i += 1) {
          const prev = i ? bars[i - 1].c : bars[i].o;
          a.s[bars[i].s] += (bars[i].c - prev) / prev;
          a.c[bars[i].s] += 1;
        }
      }
      await tick();
    }
    const mkt = new Map();
    for (const [date, a] of mktAcc) {
      const v = new Float64Array(H.SESSION_BARS);
      for (let i = 0; i < H.SESSION_BARS; i += 1) v[i] = a.c[i] >= 10 ? a.s[i] / a.c[i] : NaN;
      mkt.set(date, v);
    }
    const scales = m.stockCal && m.stockCal.on ? m.stockCal.recs || {} : null;
    let seen = 0;
    for (const s of stocks) {
      const days = this._days(s);
      const prof = (m.profiles || {})[s] || H.buildProfile(days, null);
      if (prof) {
        for (let d = 1; d < days.length; d += 1) {
          const date = days[d][0];
          if (!want.has(date)) continue;
          const ctx = this._ctxFor(prof, days, d, mkt);
          if (!ctx.prevClose) continue;
          const rows = H.dayRows(days[d][1], ctx, { targets: true, stride: 1, needAll });
          if (!rows.length) continue;
          const mult = scales ? H.stockScaleOf(scales[s]) : 1;
          for (const row of rows) row.p = H.predictRow(m.W, row.x, m.slope, H.segFor(m.seg, row.s), mult);
          seen += rows.length;
          // the session's own bars and its context come too, for a reader that works from the bars (server/evidence.js)
          each(s, date, rows, days[d][1], ctx);
        }
      }
      await tick();
    }
    return seen;
  }

  /** How many stocks the stored history holds. */
  storedStocks() {
    return this._stocks().length;
  }

  /** Every session the stored history holds, oldest first (the early calls learn from the same sessions). */
  storedDates() {
    const set = new Set();
    for (const s of this._stocks()) for (const [date] of this._days(s)) set.add(date);
    return [...set].sort();
  }

  /**
   * What the forecaster sees for a stock right now, for the early calls (server/ahead.js): today's rows bar by bar and
   * the forecast made from them — or { reason }. Shared with view() for fifteen seconds, so the Desk asking for both
   * reads the market once.
   */
  async inputs(symbol) {
    const now = this.now();
    this._opened.set(symbol, now);
    const hit = this._last.get(symbol);
    if (hit && now - hit.at < 15000) return hit.r;
    const r = await this._compute(symbol);
    this._remember(symbol, r, now);
    return r;
  }

  _remember(symbol, r, now) {
    if (this._last.size > 120) this._last.clear();
    this._last.set(symbol, { at: now, r });
  }

  /** A session's bars for a stock: today's from the market (when connected), an earlier day's from the stored history. */
  async barsFor(symbol, date) {
    if (date === istDate(this.now()) && this._connected()) return (await this._todayBars(symbol)).today;
    const h = this._historyStore();
    return (h ? sessions(h.bars(symbol)).get(date) : null) || null;
  }

  /** The check's totals over every stock followed: { 1: { n, ok }, 3: { n, ok } } (5 and 15 minutes). */
  checkTotals() {
    return this._tallyAll();
  }

  /** The stocks followed live: the watchlist and the ones looked at in the last three hours. */
  watching() {
    return this._watch();
  }

  /* --------------------------------------------------------------------------- the forecast for now */
  _levels(fc, prevClose) {
    const out = [];
    const px = fc.anchor.price;
    if (fc.day) {
      if (num(fc.day.high) && fc.day.high > px * 1.0004) out.push({ name: "Day high", price: fc.day.high });
      if (num(fc.day.low) && fc.day.low < px * 0.9996) out.push({ name: "Day low", price: fc.day.low });
      if (num(fc.day.vwap)) out.push({ name: "VWAP", price: fc.day.vwap });
    }
    if (num(prevClose)) out.push({ name: "Previous close", price: prevClose });
    const step = px < 200 ? 5 : px < 1000 ? 10 : px < 3000 ? 50 : 100;
    const up = Math.ceil(px / step) * step;
    const dn = Math.floor(px / step) * step;
    if (up > px) out.push({ name: `Round ${up}`, price: up });
    if (dn < px && dn > 0) out.push({ name: `Round ${dn}`, price: dn });
    return out;
  }

  _evidence(symbol, now) {
    const ev = {};
    try {
      const n = this.market.social && typeof this.market.social.forSymbol === "function" ? this.market.social.forSymbol(symbol) : null;
      if (n && n.mentions >= 2 && num(n.sentiment)) ev.news = Math.max(-1, Math.min(1, n.sentiment));
    } catch (_) {
      /* no news */
    }
    try {
      const last = this.ai && this.ai.ensemble && typeof this.ai.ensemble.last === "function" ? this.ai.ensemble.last("live", symbol) : null;
      if (last && last.final && num(last.final.score) && last.at && now - Date.parse(last.at) < 45 * 60000) ev.aiLive = Math.max(-1, Math.min(1, last.final.score / 100));
    } catch (_) {
      /* no AI read on record */
    }
    return ev;
  }

  async _todayBars(symbol) {
    const rec = await this.market._recentBars(symbol);
    const conv = (b) => ({ t: msOf(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    return { today: (rec.today || []).map(conv), prior: (rec.prior || []).map(conv) };
  }

  /** The profile of a stock the model has not studied (not in the NIFTY 100): from what is at hand. */
  _fallbackProfile(prior, daily) {
    const rets = [];
    for (let i = 1; i < prior.length; i += 1) rets.push((prior[i].c - prior[i - 1].c) / prior[i - 1].c);
    if (rets.length < 40) return null;
    const rms = Math.sqrt(rets.reduce((a, x) => a + x * x, 0) / rets.length);
    const last = (daily || []).slice(-20);
    const ranges = last.map((c) => (c.h - c.l) / c.c).filter(num);
    return { sigma: rms, day: ranges.length ? ranges.reduce((a, b) => a + b, 0) / ranges.length : rms * 15, beta: 1, vol: null };
  }

  /** @returns the raw forecast pieces for a stock, or { reason } */
  async _compute(symbol) {
    const m = this._usable();
    if (!m) {
      const old = this.model();
      return { reason: old && old.W ? "The forecaster is learning again with its new inputs (it retrains by itself from the stored history); forecasts return in a few minutes." : "The forecaster has not learned yet. It learns from the NIFTY 100's stored 5-minute history (Paper trading downloads it) and is ready a few minutes after that." };
    }
    if (!this._connected()) return { reason: "The 15-minute forecast needs live prices: connect Zerodha." };
    const now = this.now();
    const today = istDate(now);
    if (!weekday(today)) return { reason: "The market is shut today; forecasts resume on the next trading day at 9:20.", closed: true };
    const { today: bars0, prior } = await this._todayBars(symbol);
    const done = bars0.filter((b) => b.t + H.BAR <= now + 1000);
    const min = minuteOfDay(now);
    if (!done.length) return { reason: min < 9 * 60 + 15 ? "The market opens at 9:15; the first forecast comes at 9:20, after the first 5-minute bar." : "No finished 5-minute bar yet today; the first forecast comes at 9:20.", closed: min >= OPEN_TO };
    // continuous trading ends at 3:15 PM in a stock with a closing auction, at 3:30 PM in the rest (market/session.js)
    const closeSlot = liveCloseSlot(closeSlotOf(prior), prior.length ? istDate(prior[prior.length - 1].t) : null, today);
    const closeMin = SESSION.OPEN_MIN + closeSlot * 5;
    if (min >= closeMin + 5) return { reason: closeSlot < H.SESSION_BARS ? `Continuous trading in this stock ended at ${SESSION.clockOf(closeMin)} (its closing auction follows); the next forecast comes at 9:20 on the next trading day.` : "The market has closed; the next forecast comes at 9:20 on the next trading day.", closed: true };
    let daily = [];
    try {
      daily = ((await this.market.daily(symbol)).candles || []).filter((c) => String(c.t).slice(0, 10) < today);
    } catch (_) {
      /* the stored profile still stands */
    }
    const prof = (m.profiles || {})[symbol] || this._fallbackProfile(prior.length ? prior : done, daily);
    if (!prof) return { reason: "Too little price history on this stock for a forecast." };
    const closes = daily.map((c) => c.c);
    const prevClose = closes.length ? closes[closes.length - 1] : prior.length ? prior[prior.length - 1].c : null;
    const prev2 = closes.length > 1 ? closes[closes.length - 2] : null;
    const ten = closes.length > 10 ? closes[closes.length - 11] : null;
    const dayR = prof.day || prof.sigma * 15;
    let mk = null;
    try {
      const ix = await this._todayBars(INDEX);
      if (ix.today.length) mk = H.marketFromBars(ix.today.filter((b) => b.t + H.BAR <= now + 1000));
    } catch (_) {
      mk = null; // without the index the market inputs stay at zero
    }
    const ctx = {
      sigma: prof.sigma,
      day: prof.day,
      beta: prof.beta,
      vol: prof.vol,
      prevClose,
      prevDayRet: prevClose && prev2 ? (prevClose - prev2) / prev2 : null,
      trend: prevClose && ten ? (prevClose / ten - 1) / (dayR * Math.sqrt(10)) : 0,
      mkt: mk,
    };
    // for the researched inputs: yesterday's high and low (from the daily candles, else the stored history), the usual
    // distance from the open and the same-time-of-day returns (from the stored sessions before today)
    const earlier = this._priorFor(symbol, today);
    const y = daily.length ? daily[daily.length - 1] : null;
    ctx.prevHigh = y && num(y.h) ? y.h : earlier ? earlier.prevHigh : null;
    ctx.prevLow = y && num(y.l) ? y.l : earlier ? earlier.prevLow : null;
    ctx.noise = earlier ? earlier.noise : null;
    ctx.tod = earlier ? earlier.tod : null;
    // continuous trading ends today when it ended on the last session — or, on the first day of new rules, when the table says
    ctx.closeSlot = closeSlot;
    const live = m.live || { bias: {}, tilt: {} };
    const evidence = this._evidence(symbol, now);
    let tilt = 0;
    for (const [k, v] of Object.entries(evidence)) tilt += ((live.tilt || {})[k] || 0) * v;
    const own = (live.bias || {})[symbol];
    const bias = own ? own.bias : 0;
    // the stock's own correction is learned apart for 5 minutes (from the 5-minute checks) and for 15 and beyond
    const bias1 = own && num(own.b1) ? own.b1 : 0;
    const biasK = H.HORIZONS.map((h) => (h <= 1 ? bias1 : h === 2 ? (bias1 + bias) / 2 : bias));
    const stockScale = m.stockCal && m.stockCal.on ? H.stockScaleOf((m.stockCal.recs || {})[symbol]) : 1;
    // the recorded order book and open interest as of the last finished bar: shown always, added to the forecast only once proven
    const flow = this._flowFor(symbol, done[done.length - 1].t + H.BAR);
    const tilts = flow && flow.on && flow.tilts ? flow.tilts : null;
    const probe = H.forecastFrom(done, ctx, m, { bias: biasK, tilt, tilts, levels: [], stockScale });
    if (!probe) return { reason: "The forecast could not be made from today's bars." };
    const fc = H.forecastFrom(done, ctx, m, { bias: biasK, tilt, tilts, levels: this._levels(probe, prevClose), stockScale });
    // today's rows bar by bar, for the early calls (they read the same inputs, turned to face the move)
    const rows = H.dayRows(done, ctx, { targets: false, stride: 1 });
    // `bars` and `ctx`: the finished bars and their context, for the evidence desk (server/evidence.js reads its techniques from them)
    return { fc, rows, bars: done, ctx, evidence, tilt, bias, bias1, prevClose, now, flow, flowTilt: tilts ? tilts[H.HORIZONS.indexOf(3)] || 0 : 0, flowTilt1: tilts ? tilts[H.HORIZONS.indexOf(1)] || 0 : 0 };
  }

  _flowFor(symbol, endMs) {
    try {
      const f = typeof this.flow === "function" ? this.flow() : this.flow;
      return f && typeof f.tiltFor === "function" ? f.tiltFor(symbol, endMs) : null;
    } catch (_) {
      return null; // the forecast never waits on, or fails with, the recorder
    }
  }

  /** The "why" list: which inputs pushed the 15-minute move, in words, biggest first. */
  _why(fc, m, h) {
    const k = H.tIndex(`r${h}`);
    if (k < 0 || !fc || !fc.x) return [];
    const out = [];
    H.FEATURES.slice(1).forEach((f, i) => {
      const v = fc.x[f];
      const c = m.W[k][i + 1] * v * (m.slope ? m.slope[k] : 1);
      if (!num(c) || Math.abs(c) < 0.004) return;
      const w = WHY[f];
      if (!w) return;
      // the words state the fact (which side the reading is on); `side` is which way the model takes it — they can differ
      // (a price far above VWAP is a fact that can push the forecast DOWN)
      out.push({ key: f, pushSigma: r4(c), side: c > 0 ? "up" : "down", text: v > 0 ? w[0] : w[1] });
    });
    return out.sort((a, b) => Math.abs(b.pushSigma) - Math.abs(a.pushSigma)).slice(0, 5);
  }

  /**
   * The forecast for one stock, with its record: what the Desk and Research show. Keeps the forecast in the record when
   * the bar is new, and asks nothing of Zerodha beyond the stock's own bars (shared for twenty seconds).
   */
  async view(symbol) {
    if (!SYMBOL_RE.test(symbol)) throw new HorizonError("That is not a valid symbol.", "invalid");
    const now = this.now();
    this._opened.set(symbol, now);
    const m = this._usable();
    const base = this._baseView(symbol, m);
    const hit = this._cache.get(symbol);
    if (hit && now - hit.at < 15000) return { ...base, ...hit.part };
    let part;
    try {
      const r = await this._compute(symbol);
      this._remember(symbol, r, now);
      if (!r.fc) part = { available: false, reason: r.reason, closed: Boolean(r.closed) };
      else {
        const head = H.headline(r.fc, now);
        const call = H.callOf(head);
        const k = head ? H.HORIZONS.indexOf(head.h) : -1;
        const grade = k >= 0 && m.validation ? this._gradeLine(m.validation.horizons[k], call) : null;
        // the 5-minute call: the first bar end at least 2½ minutes away (so always 2½ to 7½ minutes ahead)
        const head5 = H.headline(r.fc, now, 2.5);
        const call5 = H.callOf(head5);
        const k5 = head5 ? H.HORIZONS.indexOf(head5.h) : -1;
        const grade5 = k5 >= 0 && m.validation ? this._gradeLine(m.validation.horizons[k5], call5) : null;
        this._keep(symbol, r, now);
        this._flush();
        part = {
          available: Boolean(head),
          reason: head ? "" : "The session is too close to its end for a 15-minute forecast.",
          closed: false,
          asOf: iso(now),
          anchor: { at: iso(r.fc.anchor.end), price: r.fc.anchor.price },
          sigmaPct: r.fc.sigma,
          headline: head ? { minutesAhead: head.minutesAhead, at: iso(head.at), h: head.h, price: head.price, pct: head.pct, low: head.low, high: head.high, pUp: head.pUp, sdPct: head.sd, call, reach: head.reach ? { minutes: head.reach.minutes, up: head.reach.up, down: head.reach.down } : null, grade } : null,
          headline5: head5 ? { minutesAhead: Math.max(1, Math.round((head5.at - now) / 60000)), at: iso(head5.at), h: head5.h, price: head5.price, pct: head5.pct, low: head5.low, high: head5.high, pUp: head5.pUp, sdPct: head5.sd, call: call5, grade: grade5 } : null,
          horizons: Object.values(r.fc.horizons).map((x) => ({ minutes: x.minutes, at: iso(x.at), price: x.price, pct: x.pct, low: x.low, high: x.high, pUp: x.pUp })),
          reach: Object.values(r.fc.reach).map((x) => ({ minutes: x.minutes, up: x.up, down: x.down })),
          levels: r.fc.levels,
          day: r.fc.day,
          why: head ? this._why(r.fc, m, head.h) : [],
          why5: head5 ? this._why(r.fc, m, head5.h) : [],
          evidence: { news: r.evidence.news ?? null, aiLive: r.evidence.aiLive ?? null, tilt: r4(r.tilt), bias: r4(r.bias) },
          // the order book and open interest the recorder read at the bar's close; `inUse` only once they have proved themselves
          flow: r.flow && r.flow.read ? { ...r.flow.read, inUse: Boolean(r.flow.on), tilt: r4(r.flowTilt), gain15: r.flow.gain ?? null, scored: r.flow.evidence || 0 } : null,
        };
      }
    } catch (err) {
      part = { available: false, reason: err.message || "The forecast could not be made." };
    }
    this._cache.set(symbol, { at: now, part });
    if (this._cache.size > 80) this._cache.clear();
    return { ...base, ...part };
  }

  /** The part of a view that does not need the market: the record and what has been learned. */
  _baseView(symbol, m) {
    const mine = [...this._recs().values()].filter((r) => r.symbol === symbol && r.settled).sort((a, b) => b.anchorEnd - a.anchorEnd);
    const st = m && m.stockStat ? m.stockStat[symbol] : null;
    return {
      symbol,
      trained: Boolean(m),
      live: this._liveStats(),
      own: this._liveStats(symbol),
      stock: st && st.n ? { n: st.n, dirAcc: r4(st.hit / st.n), missPct: r4(st.miss / st.n), naivePct: r4(st.naive / st.n) } : null,
      history: mine.slice(0, 10).map((r) => this._row(r)),
      checks: this._checks(symbol, mine),
      learning: this._learning(m),
      rule:
        "The model looks at the stock's last hour of 5-minute bars — price, volume, RSI, VWAP, where it sits in the day's range, the time of day, the market's own move and the researched set-ups (the 5-minute opening range of a stock in play, the move out of its usual range for the time of day, the first half-hour's pull on the close, what it did at this time on recent days, yesterday's pivot levels) — and has learned from about a million examples from every NIFTY 100 stock how such moments turned out 5 to 30 minutes later. It forecasts the close, the high and the low; the band aims to hold 70% of outcomes. Every evening it forecasts the whole day again before looking at it, is scored on that, then learns it. It is a probability, not a promise: the screen shows how often it has really been right.",
    };
  }

  _gradeLine(sum, call) {
    if (!sum || !call || !call.p) return null;
    const bin = (sum.bins || []).find((b) => call.p >= b.lo && call.p < (b.hi >= 1 ? 1.0001 : b.hi));
    if (!bin || !bin.calls) return { statedP: call.p, calls: 0, acc: null, text: "It made almost no call this strong on the sessions it was tested on, so its record cannot say how reliable one is: treat it as unproven." };
    return { statedP: call.p, calls: bin.calls, acc: bin.acc, text: `When the model leaned this strongly (${Math.round(bin.lo * 100)}–${Math.round(bin.hi * 100)}%) on sessions it had not seen, it was right ${Math.round(bin.acc * 100)}% of the time (${bin.calls.toLocaleString("en-IN")} calls).` };
  }

  _learning(m) {
    if (!m || !m.W) return { trained: false };
    const v = m.validation || {};
    return {
      trained: true,
      trainedAt: m.trainedAt,
      lastDate: m.lastDate,
      examples: m.rows,
      daysLearned: (m.learned && m.learned.days) || 0,
      lastLearnedAt: m.learned ? m.learned.lastAt : null,
      stocks: v.stocks || null,
      sessions: v.sessions || null,
      testedFrom: v.from,
      testedTo: v.to,
      bandScale: m.bandScale,
      experts: this._experts(m),
      contest: this._contest(m),
      trees: B.summaryOf(m.boost, H.TARGETS),
      stockScales: m.stockCal ? { on: Boolean(m.stockCal.on), stocks: Object.keys(m.stockCal.recs || {}).length, gainPct: m.stockCal.se && m.stockCal.se[0] > 0 ? r2(((m.stockCal.se[0] - m.stockCal.se[1]) / m.stockCal.se[0]) * 100) : 0 } : null,
      lessons: this._lessons(m),
      live: m.live ? { n: m.live.n || 0, tilt: m.live.tilt || {} } : null,
    };
  }

  /** The contest between the candidate models: which is in use and how the others did on the same unseen rows. */
  _contest(m) {
    if (!m || !m.arena) return null;
    const tot = m.arena.se.map((r) => r.reduce((a, b) => a + b, 0));
    const ci = H.CANDIDATES.findIndex((c) => c.id === m.champion);
    const best = tot[ci] || 0;
    return {
      examples: m.arena.n,
      inUse: m.champion,
      name: (H.CANDIDATES[ci] || {}).name || m.champion,
      changed: m.changed || null,
      candidates: H.CANDIDATES.map((c, i) => ({ id: c.id, name: c.name, inUse: i === ci, moreErrorPct: best > 0 && tot[i] > 0 ? r2(((tot[i] - best) / best) * 100) : null })),
    };
  }

  /** How strongly each input moves the 15-minute call: its weight times how much the input usually varies (from the sums). */
  _drivers(m, h = 3) {
    const k = H.tIndex(`r${h}`);
    const st = m.stats;
    if (k < 0 || !st || !st.w) return [];
    const D = H.D;
    const out = [];
    for (let i = 1; i < D; i += 1) {
      const mean = st.xtx[i] / st.w; // the first row of the sums is Σ x, because the first input is always 1
      const sd = Math.sqrt(Math.max(0, st.xtx[i * D + i] / st.w - mean * mean));
      const eff = m.W[k][i] * sd * (m.slope ? m.slope[k] : 1);
      if (num(eff) && Math.abs(eff) > 0.002) out.push({ key: H.FEATURES[i], effect: r4(eff) });
    }
    return out.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
  }

  /**
   * What the forecaster has measured, in plain sentences: the same lines go on the board, into the learning record in the
   * database and into the trading-skills file every AI feature reads. Nothing here is a promise: each line is a count.
   */
  _lessons(m) {
    if (!m || !m.W || !m.validation) return [];
    const pct = (x, d = 1) => (num(x) ? `${(x * 100).toFixed(d)}%` : "—");
    const v = m.validation;
    const h15 = (v.horizons || []).find((x) => x.h === 3) || {};
    const strong = (h15.bins || []).filter((b) => b.lo >= 0.7);
    const sCalls = strong.reduce((a, b) => a + b.calls, 0);
    const sRight = strong.reduce((a, b) => a + b.right, 0);
    const lines = [];
    lines.push(`Tested on ${(h15.n || 0).toLocaleString("en-IN")} examples from sessions it had not seen (${v.from} to ${v.to}, ${v.stocks} stocks): 15 minutes ahead the direction was right ${pct(h15.dirAcc)} of the time (a coin is 50%)${sCalls ? `; when it leaned 70% or more it was right ${pct(sRight / sCalls)} of ${sCalls.toLocaleString("en-IN")} calls` : ""}; its average miss was ${num(h15.missPct) ? h15.missPct.toFixed(3) : "—"}% against ${num(h15.naivePct) ? h15.naivePct.toFixed(3) : "—"}% for "no move"; its 70% band held ${pct(h15.coverage, 0)}.`);
    const c = this._contest(m);
    if (c) lines.push(`Model in use: ${c.name}. It missed least on ${c.examples.toLocaleString("en-IN")} unseen examples${c.candidates.filter((x) => !x.inUse && x.moreErrorPct != null).length ? ` (${c.candidates.filter((x) => !x.inUse && x.moreErrorPct != null).map((x) => `${x.name}: ${x.moreErrorPct >= 0 ? "+" : ""}${x.moreErrorPct}% error`).join("; ")})` : ""}. The contest is counted again every evening.`);
    const ex = this._experts(m);
    if (ex) {
      const on = ex.horizons.filter((x) => x.weight > 0);
      lines.push(on.length ? `Time-of-day experts are blended in: ${on.map((x) => `${x.minutes} min at ${Math.round(x.weight * 100)}% (error cut ${x.gainPct}%)`).join(", ")}.` : "Time-of-day experts (opening hour, midday, from 2:00 PM) did not beat the single model on unseen sessions, so they are not used.");
    }
    const tr = B.summaryOf(m.boost, H.TARGETS);
    if (tr) lines.push(tr.inUse ? `Decision trees (gradient boosting on what the straight-line model still misses: thresholds, interactions, the time of day) are in use for ${tr.inUse} of ${tr.targets.length} forecasts: ${tr.targets.filter((t) => t.on).map((t) => `${t.target} error cut ${t.cutPct}%`).join(", ")} — measured on sessions they had not seen.` : "Decision trees were grown on what the model still misses, but on unseen sessions they did not cut the miss, so they are not used.");
    if (m.stockCal) lines.push(m.stockCal.on ? `Each stock's own scale is in use (${Object.keys(m.stockCal.recs || {}).length} stocks): forecasts made with them missed less on unseen sessions.` : "Per-stock scales did not make the forecasts miss less on unseen sessions, so every stock is read with the pooled model alone.");
    const words = {
      r1: "the last 5 minutes rose", r3: "the last 15 minutes rose", r6: "the last half hour rose", r12: "the last hour rose", fromOpen: "the price is above the open", gap: "it opened above yesterday's close", vwap: "the price is above VWAP", pos: "the price is high in the day's range", rsi: "RSI is high", vol: "volume is heavier than usual for the time", volDir: "heavy volume is behind a rise", vnow: "recent bars are wider than usual", tOpen: "it is the opening hour", tClose: "it is the closing hour", m3: "the market rose in the last 15 minutes", m6: "the market rose in the last half hour", prevDay: "yesterday was an up day", trend: "the last ten days drifted up",
      clv: "the last bar closed near its high", clv3: "the last three bars closed near their highs", wick: "the last bar was rejected from above (a long upper wick)", z20: "the price is stretched above its 20-bar mean", orb: "the price is above the opening range", r1sq: "the last bar was an unusually big rise", rsiX: "RSI is past 70", dHigh: "there is room left to the day's high", dLow: "the price is far above the day's low",
    };
    const top = this._drivers(m).filter((d) => words[d.key]).slice(0, 6);
    if (top.length) lines.push(`What moved the next 15 minutes most, measured (and the opposite holds for the opposite condition): ${top.map((d) => `when ${words[d.key]}, the price tends to be ${d.effect > 0 ? "higher" : "lower"} (strength ${Math.abs(d.effect).toFixed(3)})`).join("; ")}. Strength is in units of the stock's usual 5-minute move.`);
    const days = this.docs.items(DAYS).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10);
    const accs = days.map((d) => (d.horizons.find((x) => x.h === 3) || {}).dirAcc).filter(num);
    if (accs.length) lines.push(`The last ${accs.length} evening${accs.length === 1 ? "" : "s"} (every NIFTY 100 stock, each day forecast before it was learned): direction right ${pct(accs.reduce((a, b) => a + b, 0) / accs.length)} on average, best day ${pct(Math.max(...accs))}, worst ${pct(Math.min(...accs))}.`);
    const ss = Object.entries(m.stockStat || {}).filter(([, s]) => s.n >= 300).map(([sym, s]) => ({ sym, acc: s.hit / s.n }));
    if (ss.length >= 8) {
      ss.sort((a, b) => b.acc - a.acc);
      lines.push(`It has read these stocks best so far: ${ss.slice(0, 4).map((x) => `${x.sym} ${pct(x.acc)}`).join(", ")}; and these worst: ${ss.slice(-4).map((x) => `${x.sym} ${pct(x.acc)}`).join(", ")}.`);
    }
    lines.push("A 15-minute move is mostly noise: these are measured frequencies from past sessions, not promises. Trust a call as far as its tested hit rate, and never without a stop.");
    return lines;
  }

  /** Keep what was learned: a record in the database, and the findings in the trading-skills file the AI features read. */
  _teach(m, kind, extra = {}) {
    const lessons = this._lessons(m);
    const at = iso(this.now());
    try {
      const h15 = ((m.validation || {}).horizons || []).find((x) => x.h === 3) || {};
      this.docs.putItems(LEARNING, [{ id: `${at}|${kind}`, at, kind, lastDate: m.lastDate, examples: m.rows, champion: m.champion, contest: this._contest(m), experts: this._experts(m), stockScales: m.stockCal ? { on: Boolean(m.stockCal.on), se: m.stockCal.se } : null, bandScale: m.bandScale, slope: m.slope, tested15: { dirAcc: h15.dirAcc, missPct: h15.missPct, naivePct: h15.naivePct, coverage: h15.coverage }, drivers: this._drivers(m).slice(0, 12), lessons, ...extra }]);
      const all = this.docs.items(LEARNING).sort((a, b) => (a.at < b.at ? 1 : -1));
      if (all.length > 200) this.docs.removeItems(LEARNING, all.slice(200).map((r) => r.id));
    } catch (err) {
      this.log.error(`[horizon] the learning record was not saved: ${err.message}`);
    }
    if (this.playbook && lessons.length) {
      try {
        this.playbook.setSection(SECTION, lessons.map((l) => `- ${l}`).join("\n"));
      } catch (err) {
        this.log.error(`[horizon] the skills file was not updated: ${err.message}`);
      }
    }
    return lessons;
  }

  /** The time-of-day experts: how far each horizon's forecast leans on them, and what that was measured to gain. */
  _experts(m) {
    const seg = m && m.seg;
    if (!seg || !seg.alpha) return null;
    const ev = seg.evidence;
    return {
      examples: ev ? ev.n : 0,
      ready: seg.W.map((w, i) => ({ part: H.SEGMENTS[i], ready: Boolean(w) })),
      horizons: H.HORIZONS.map((h, k) => {
        const row = ev && ev.se[k] ? ev.se[k] : null;
        const i = H.ALPHAS.indexOf(seg.alpha[k]);
        return { minutes: h * 5, weight: seg.alpha[k], gainPct: row && row[0] > 0 && i > 0 ? r2(((row[0] - row[i]) / row[0]) * 100) : 0 };
      }),
    };
  }

  /* --------------------------------------------------------------------------- keeping and scoring */
  _keep(symbol, r, now) {
    const fc = r.fc;
    if (this._anchor.get(symbol) === fc.anchor.end) return;
    this._anchor.set(symbol, fc.anchor.end);
    const id = `${istDate(now)}|${symbol}|${fc.anchor.end}`;
    if (this._recs().has(id)) return;
    const horizons = {};
    for (const [h, x] of Object.entries(fc.horizons)) horizons[h] = { price: x.price, low: x.low, high: x.high, pct: x.pct, pUp: x.pUp, at: x.at };
    const reach = {};
    for (const [h, x] of Object.entries(fc.reach)) reach[h] = { up: x.up.price, down: x.down.price };
    const rec = { id, date: istDate(now), symbol, anchorEnd: fc.anchor.end, madeAt: iso(now), price: fc.anchor.price, sigma: fc.sigma, bucket: fc.bucket, horizons, reach, evidence: r.evidence, tilt: r4(r.tilt), bias: r4(r.bias), bias1: r4(r.bias1 || 0), flowTilt: r4(r.flowTilt || 0), flowTilt1: r4(r.flowTilt1 || 0), flow: r.flow && r.flow.read ? { imb: r.flow.read.imb, oi15: r.flow.read.oi15Pct } : null, settled: false, actual: null };
    this._rev = (this._rev || 0) + 1;
    this._recs().set(id, rec);
    this._pending = this._pending || [];
    this._pending.push(rec);
  }

  _flush() {
    if (this._pending && this._pending.length) {
      this.docs.putItems(COLLECTION, this._pending);
      this._pending = [];
    }
  }

  _row(r) {
    const a = (r.actual || {})[3] || (r.actual || {})[4] || null;
    const f = r.horizons[3] || r.horizons[4] || null;
    return { at: iso(r.anchorEnd), price: r.price, forecast: f ? f.price : null, actual: a ? a.price : null, missPct: a ? a.miss : null, inBand: a ? a.inBand : null, right: a ? a.right : null, pUp: f ? f.pUp : null, v5: this._check(r, 1), v15: this._check(r, 3) };
  }

  /* --------------------------------------------------------------------------- the check: was each forecast right? */
  /** One kept forecast at one horizon, with what happened and the verdict (null until its time has come). */
  _check(r, h) {
    const f = (r.horizons || {})[h];
    const a = (r.actual || {})[h];
    const v = H.verdictOf(f, a);
    return v ? { made: iso(r.anchorEnd), for: iso(f.at), minutes: h * 5, from: r.price, ...v } : null;
  }

  /** The check's totals over every stock followed (kept until the record changes). */
  _tallyAll() {
    if (this._tally && this._tally.rev === (this._rev || 0)) return this._tally.v;
    const v = { 1: { n: 0, ok: 0 }, 3: { n: 0, ok: 0 } };
    for (const r of this._recs().values()) {
      if (!r.settled || !r.actual) continue;
      for (const h of [1, 3]) {
        const x = H.verdictOf((r.horizons || {})[h], r.actual[h]);
        if (!x) continue;
        v[h].n += 1;
        if (x.ok) v[h].ok += 1;
      }
    }
    this._tally = { rev: this._rev || 0, v };
    return v;
  }

  /**
   * For the screen: the last checked forecasts of a stock at 5 and at 15 minutes — correct or not, by the one rule —
   * the count of the last twenty, the count over every stock, and what the last check taught.
   * @param mine the stock's settled records, newest first
   */
  _checks(symbol, mine) {
    const all = this._tallyAll();
    const side = (h) => {
      const list = mine.map((r) => this._check(r, h)).filter(Boolean);
      const l20 = list.slice(0, 20);
      const ok = l20.filter((x) => x.ok).length;
      return { minutes: h * 5, last: list[0] || null, recent: list.slice(0, 8), n: l20.length, ok, pct: l20.length ? r4(ok / l20.length) : null, all: { n: all[h].n, ok: all[h].ok, pct: all[h].n ? r4(all[h].ok / all[h].n) : null } };
    };
    const taught = mine.find((r) => r.learned);
    let learned = null;
    if (taught) {
      const L = taught.learned;
      const sg = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(3)}σ`;
      const moved = (p) => (Math.abs(p[1] - p[0]) < 0.0005 ? `stays ${sg(p[1])}` : `moved ${sg(p[0])} → ${sg(p[1])}`);
      learned = {
        at: iso(taught.anchorEnd),
        n: L.n,
        b5: L.b5,
        b15: L.b15,
        text: `Learned from the last check (right or wrong, every check counts): ${symbol}'s own correction for 5 minutes ${moved(L.b5)}, for 15 minutes ${moved(L.b15)} — from ${L.n} checked forecast${L.n === 1 ? "" : "s"} of this stock. After the close the whole model learns today's bars of every NIFTY 100 stock again.`,
      };
    }
    return { rule: CHECK_RULE, h5: side(1), h15: side(3), learned };
  }

  /** Write what happened beside every forecast whose time has come. */
  async score() {
    const now = this.now();
    const due = [...this._recs().values()].filter((r) => !r.settled && !r.void && now >= r.anchorEnd - H.BAR + (H.MAXH + 1) * H.BAR + 20000);
    if (!due.length) return 0;
    const bySym = new Map();
    for (const r of due) (bySym.get(r.symbol) || bySym.set(r.symbol, []).get(r.symbol)).push(r);
    let scored = 0;
    const today = istDate(now);
    const just = []; // the records checked in this pass
    const m0 = this._usable();
    const was = JSON.parse(JSON.stringify((m0 && m0.live && m0.live.bias) || {})); // each stock's correction before this pass
    for (const [sym, list] of bySym) {
      let bars = null;
      const dates = [...new Set(list.map((r) => r.date))];
      for (const date of dates) {
        try {
          if (date === today && this._connected()) bars = (await this._todayBars(sym)).today;
          else {
            const h = this._historyStore();
            const day = h ? sessions(h.bars(sym)).get(date) : null;
            bars = day || null;
          }
        } catch (_) {
          bars = null;
        }
        for (const r of list.filter((x) => x.date === date)) {
          if (!bars || !bars.length) {
            if (date < today && now - r.anchorEnd > 3 * 86400000) {
              r.void = true;
              this._pending = (this._pending || []).concat([r]);
            }
            continue;
          }
          const actual = H.settle(r, bars);
          if (Object.keys(actual).length) {
            r.actual = actual;
            r.settled = true;
            this._pending = (this._pending || []).concat([r]);
            just.push(r);
            scored += 1;
          }
        }
      }
    }
    if (scored) {
      this._rev = (this._rev || 0) + 1;
      this._learnLive();
      // what each check taught: the stock's own correction before and after it (kept with the forecast)
      const m1 = this._usable();
      const is = (m1 && m1.live && m1.live.bias) || {};
      for (const r of just) {
        const a = was[r.symbol] || {};
        const b = is[r.symbol] || {};
        r.learned = { n: b.n || 0, b5: [a.b1 || 0, b.b1 || 0], b15: [a.bias || 0, b.bias || 0] };
      }
      const ok15 = just.filter((r) => (H.verdictOf(r.horizons[3], r.actual[3]) || {}).ok).length;
      this.log.log(`[horizon] ${scored} forecasts checked (${ok15} correct at 15 minutes) and learned from`);
    }
    this._prune();
    this._flush();
    return scored;
  }

  _prune() {
    const cut = istDate(this.now() - KEEP_DAYS * 86400000);
    const old = [...this._recs().values()].filter((r) => r.date < cut).map((r) => r.id);
    if (old.length) {
      old.forEach((id) => this._recs().delete(id));
      this.docs.removeItems(COLLECTION, old);
    }
  }

  /**
   * Learn from the forecasts that were really made: each stock's own bias (how much its outcomes ran above or below the
   * forecasts, shrunk until there are many) and how much the news mood and the AI's live read are worth (a shrunk
   * regression of what was missed on each). Nothing here exists before the forecasts do: no history holds them.
   */
  _learnLive() {
    const m = this._usable();
    if (!m) return;
    const recs = [...this._recs().values()].filter((r) => r.settled && r.actual && r.actual[3] && r.horizons[3]);
    const bias = {};
    const by = new Map();
    for (const r of recs) (by.get(r.symbol) || by.set(r.symbol, []).get(r.symbol)).push(r);
    for (const [s, list] of by) {
      let sum = 0;
      // σ units: + the price went higher than the model alone said (the forecast shown also carried the bias and the tilt)
      for (const r of list) sum += (r.actual[3].pct - r.horizons[3].pct) / r.sigma + (r.bias || 0) + (r.tilt || 0) + (r.flowTilt || 0);
      const n = list.length;
      // the same for the 5-minute forecasts: what the model alone missed at 5 minutes, shrunk until there are many
      let sum1 = 0;
      let n1 = 0;
      for (const r of list) {
        if (!r.actual[1] || !r.horizons[1]) continue;
        sum1 += (r.actual[1].pct - r.horizons[1].pct) / r.sigma + (num(r.bias1) ? r.bias1 : r.bias || 0) + (r.tilt || 0) + (r.flowTilt1 || 0);
        n1 += 1;
      }
      bias[s] = { n, bias: r4(Math.max(-0.4, Math.min(0.4, (sum / n) * (n / (n + 40))))), n1, b1: n1 ? r4(Math.max(-0.4, Math.min(0.4, (sum1 / n1) * (n1 / (n1 + 40))))) : 0 };
    }
    const tilt = {};
    for (const key of ["news", "aiLive"]) {
      let se = 0;
      let see = 0;
      let n = 0;
      for (const r of recs) {
        const e = r.evidence && r.evidence[key];
        if (!num(e)) continue;
        const res = (r.actual[3].pct - r.horizons[3].pct) / r.sigma + (r.tilt || 0); // what the forecast missed, before the tilt was added
        se += e * res;
        see += e * e;
        n += 1;
      }
      tilt[key] = n >= 60 ? r4(Math.max(-0.5, Math.min(0.5, se / (see + 30)))) : 0;
    }
    m.live = { n: recs.length, bias, tilt, at: iso(this.now()) };
    this._saveModel(m);
  }

  /** Counts from the forecasts that were really made (all stocks, or one). */
  _liveStats(symbol = null) {
    const recs = [...this._recs().values()].filter((r) => r.settled && r.actual && r.actual[3] && (!symbol || r.symbol === symbol));
    if (!recs.length) return { n: 0 };
    let hit = 0;
    let dirN = 0;
    let band = 0;
    let miss = 0;
    let naive = 0;
    let sN = 0;
    let sHit = 0;
    for (const r of recs) {
      const a = r.actual[3];
      const f = r.horizons[3];
      if (a.right !== null && a.right !== undefined) {
        dirN += 1;
        hit += a.right ? 1 : 0;
        const side = Math.max(f.pUp, 1 - f.pUp);
        if (side >= 0.7) {
          sN += 1;
          sHit += a.right ? 1 : 0;
        }
      }
      band += a.inBand ? 1 : 0;
      miss += Math.abs(a.miss);
      naive += Math.abs(a.pct);
    }
    return { n: recs.length, dirAcc: dirN ? r4(hit / dirN) : null, coverage: r4(band / recs.length), missPct: r4(miss / recs.length), naivePct: r4(naive / recs.length), strongN: sN, strongAcc: sN ? r4(sHit / sN) : null };
  }

  /* --------------------------------------------------------------------------- the board */
  board() {
    const m = this._usable();
    const days = this.docs.items(DAYS).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 40);
    const h = this._historyStore();
    return {
      trained: Boolean(m),
      learning: this._learning(m),
      validation: m && m.validation ? m.validation : null,
      days: days.map((d) => ({ date: d.date, rows: d.rows, bandScale: d.bandScale, h15: d.horizons.find((x) => x.h === 3) || null, h30: d.horizons.find((x) => x.h === 6) || null })),
      live: this._liveStats(),
      job: this.jobView(),
      history: h ? { stocks: h.status().stocks, expected: h.status().expected, sessions: h.status().sessions, to: h.status().to } : null,
      error: this.lastError,
    };
  }

  /** What is waiting: a (re)training, or sessions in the stored history that the model has not learned yet. For the supervisor. */
  pending() {
    const busy = Boolean(this._job && !this._job.finishedAt);
    const h = this._historyStore();
    if (!h) return { busy, train: false, learn: false, to: null };
    let st;
    try {
      st = h.status();
    } catch (_) {
      return { busy, train: false, learn: false, to: null };
    }
    const m = this._usable();
    return { busy, train: !m && st.stocks >= 30 && st.sessions >= 60, learn: Boolean(m && st.to && st.to > m.lastDate), to: st.to || null, lastDate: m ? m.lastDate : null };
  }

  /* --------------------------------------------------------------------------- the clock */
  _watch() {
    const set = new Set();
    try {
      (this.market.watchlist ? this.market.watchlist() : []).forEach((s) => set.add(s));
    } catch (_) {
      /* no watchlist */
    }
    const since = this.now() - 3 * 3600000;
    for (const [s, at] of this._opened) if (at >= since) set.add(s);
    return [...set].filter((s) => SYMBOL_RE.test(s) && !/^DEMO/.test(s)).slice(0, MAX_LIVE);
  }

  /** One forecast per followed stock per finished bar: each is kept, so each is scored and taught from. */
  async sweep() {
    let made = 0;
    for (const s of this._watch()) {
      try {
        const r = await this._compute(s);
        if (r.fc) {
          this._keep(s, r, this.now());
          made += 1;
        }
      } catch (_) {
        /* one stock's failure does not stop the rest */
      }
    }
    this._flush();
    return made;
  }

  async tickOnce() {
    const now = this.now();
    const today = istDate(now);
    const min = minuteOfDay(now);
    const live = this._connected();
    const slot = `${today}|${Math.floor(min / 5)}`;
    if (live && weekday(today) && min >= OPEN_FROM && min <= OPEN_TO && this._usable() && slot !== this._sweepSlot && now % H.BAR >= 10000) {
      this._sweepSlot = slot;
      const n = await this.sweep();
      if (n && min % 30 < 5) this.log.log(`[horizon] ${n} forecasts kept for ${today} ${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`);
    }
    if (now - this._scoreAt >= 5 * 60000) {
      this._scoreAt = now;
      await this.score();
    }
    // the evening: the day's bars are in the history → forecast it with the morning's model, score that, learn it
    if (weekday(today) && min >= LEARN_FROM && this._dailyAt !== today && this._usable() && !(this._job && !this._job.finishedAt) && !(this.guard && this.guard.wait("horizon-learn", "itself"))) {
      const h = this._historyStore();
      if (h) {
        this._dailyAt = today;
        try {
          if (h.needs().length && live) await h.sync({ trigger: "the forecaster" });
          await this.learnDays({ trigger: "itself" });
        } catch (err) {
          this._dailyAt = "";
          this.log.error(`[horizon] evening learning: ${err.message}`);
        }
      }
    }
    // never trained: do it as soon as the history is there (and again every five weeks)
    if (now - this._tryAt >= 30 * 60000 && !(this._job && !this._job.finishedAt) && !(this.guard && this.guard.wait("horizon-train", "itself"))) {
      const m = this.model();
      const old = m && m.trainedAt && now - Date.parse(m.trainedAt) > RETRAIN_DAYS * 86400000;
      const h = this._historyStore();
      // `m.boost === undefined`: a model trained before the decision trees existed — trained again once, so it gets them
      if ((!m || !m.W || m.version !== H.MODEL_VERSION || old || m.boost === undefined) && h) {
        const st = h.status();
        if (st.stocks >= 30 && st.sessions >= 60) {
          this._tryAt = now;
          this.train({ trigger: "itself" }).catch(() => {});
        }
      }
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tickOnce().catch((err) => this.log.error(`[horizon] ${err.message}`));
    }, 30000);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { Horizon, HorizonError, COLLECTION, DAYS, MODEL, LEARNING, SECTION };
