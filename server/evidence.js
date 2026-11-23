"use strict";
// The evidence desk, as a service: every reading weighed into one call for the next 5 and 15 minutes.
//
// The arithmetic is in market/evidence.js. This file gives it the market and a memory:
//
//   LEARNING    Through the 15-minute forecaster's own replay (server/horizon.js) every stored session of every NIFTY 100
//               stock is read bar by bar: what each technique said, what the forecaster called, what the price then did.
//               The newest quarter of the sessions is held back — half sets the calibration, the other half gives the
//               numbers shown — then everything is fitted. Each technique's own record (how often the price went its way)
//               is kept beside it. Every evening the new session is called with the model as it stood, checked, and learned.
//   NOW         For a stock: the call for 5 and 15 minutes with its chances, the techniques speaking, the indicators, the
//               levels, and what is only known live — the order book price by price on NSE and BSE, the pending orders,
//               futures open interest, the option chain, NIFTY, the stock's sector, India VIX, GIFT NIFTY, Wall Street
//               and Asia. The techniques move the call only where they beat the forecaster alone on unseen sessions; a
//               live reading moves it only once its own live record has proven it.
//   CHECKING    Every call is kept and checked 5 and 15 minutes later; so is every live reading and every AI read.
//   THE AI      When a stock is OPENED and the readings are undecided or in conflict — and only then — the AI Engine is
//               asked once to weigh the whole board (the owner's instruction of 2026-11-20). Limited per stock and per
//               day; switchable on the AI page; never on a timer. Its reads are checked like everything else.
//
// Nothing here can place, change or cancel an order.

const H = require("./market/horizon");
const E = require("./market/evidence");
const { sectorOf } = require("./market/sectors");
const { guardedTick } = require("./heal");

const IST = 5.5 * 3600 * 1000;
const MODEL = "market/evidence-model.json";
const LIVE = "market/evidence-live.json";
const CALLS = "evidence_calls";
const DAYS = "evidence_days";
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9&._ -]{0,24}$/;
const OPEN_FROM = 9 * 60 + 20;
const OPEN_TO = 15 * 60 + 30;
const LEARN_FROM = 15 * 60 + 50; // after the forecaster (3:40 PM) and the early calls (3:45 PM)
const KEEP_DAYS = 20;
const HELD_MAX = 60000;
const FADE = 0.985;
const LIVE_MIN = 150; // checks before a live reading's own record may say anything…
const LIVE_DAYS = 8; // …on at least this many sessions
const TILT_PER_MOVE = 0.38; // a usual move's worth of edge shifts the chance of a rise by about this much
const TILT_MAX = 0.06;
const TILT_SUM = 0.1;
const TIER_IX = { strong: 0, clear: 1, slight: 2 };
const AI_DEFAULT = { mode: "need", perDay: 40, gapMin: 15, everyone: false };
const AI_KEEP = 80;
// the sector index (market/context.js) of each sector group (market/sectors.js); a group without an index has none
const SECTOR_INDEX = { Banks: "Financials", "Financial services": "Financials", IT: "IT", Auto: "Auto", FMCG: "FMCG", Pharma: "Pharma", "Metals & mining": "Metals", "Oil, gas & power": "Energy" };
const PSU_BANKS = new Set(["SBIN", "BANKBARODA", "PNB", "CANBK", "UNIONBANK"]);

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const r4 = (x) => (num(x) ? Math.round(x * 10000) / 10000 : null);
const clip = (x, a) => (x > a ? a : x < -a ? -a : x);
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const minuteOfDay = (ms) => {
  const d = new Date(ms + IST);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const clock = (ms) => new Date(ms + IST).toISOString().slice(11, 16);
const weekday = (date) => {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
};
const iso = (ms) => new Date(ms).toISOString();
const pc = (p) => `${Math.round(p * 100)}%`;
const str = (x, n) => String(x == null ? "" : x).trim().slice(0, n);
const tick = () => new Promise((r) => setImmediate(r));

class EvidenceError extends Error {
  constructor(message, code = "evidence", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const RULE =
  "On every finished 5-minute bar the desk asks its day-trading techniques what they see (opening-range and first-hour breaks, VWAP as trend, pullback and stretch, the 9/20 EMAs, Supertrend, MACD, ADX, the central pivot range and Camarilla levels, yesterday's high and low, gaps, NR7 and inside bars, the Bollinger squeeze, RSI extremes and divergence, the volume climax, liquidity sweeps, pin and engulfing bars, up-volume against down-volume, sudden jumps, the market's push, relative strength and the last half-hour's patterns) and puts them together with the 15-minute forecaster's own call. Each technique has its own weight in a trend and in a range. Besides the direction it says which comes first within 30 minutes: a usual move up, or the same move down. The chances shown are measured frequencies on sessions the model had not seen, set beside the usual rate. The techniques are used only where they made the call miss less than the forecaster alone; otherwise the call is the forecaster's and the techniques are shown for reading. What is only known live — the order book on NSE and BSE, open interest, the option chain, NIFTY, the sector, India VIX, GIFT NIFTY, Wall Street, Asia — is shown, kept with every call and checked; a live reading moves the call only after its own live record has proven it. No call is certain: read 58% as 58%.";
const CHECK_RULE = "Every call kept is checked 5 and 15 minutes after it was made: a lean counts as right when the price ended on the side it named. A call with no lean says nothing and is not counted.";

const AI_SYSTEM = `You are the senior intraday analyst on a private NSE (India) trading desk. A trader has just opened ONE stock and the desk's arithmetic is undecided or its readings disagree. You are given the desk's whole evidence board for this stock at this moment: its own call for the next 5 and 15 minutes with measured chances, the day-trading techniques that are speaking (each with its measured record on this desk's history), the indicators (RSI, VWAP and its bands, Bollinger, MACD, ADX, Supertrend, EMAs, volume against usual), the price levels, the order book price by price on NSE and BSE, the pending buy and sell orders, futures open interest, the option chain, the NIFTY tide, the sector, India VIX, GIFT NIFTY, Wall Street and Asia, the early calls (reversal, carry-on, momentum) and any open position.

Weigh it as a profitable day trader would: what the order book and open interest say about who is really in control, whether the techniques that are speaking have a record worth trusting here (use the records given: a technique marked as not working is noise), whether the market and the sector carry or fight the stock, how near the next level is, and the time of day. Decide the most likely direction over the next 15 minutes.

How to answer:
- Use only the board. Quote its numbers. Never invent a price, a level or an event. Choose "invalid" and "level" only from prices that appear on the board.
- "lean": "up", "down" or "none". Say "none" when the evidence does not support a direction: that is a correct and useful answer.
- "confidence": low, medium or high — how well the evidence agrees. Never promise a profit or a certainty.
- "why": two or three plain sentences with the actual numbers, most important first.
- "watch": the one thing, with its price, that would confirm the lean in the next minutes.
- "invalid": the price whose break proves the read wrong (0 when the lean is "none").
- "risk": one sentence on the main thing that could make this wrong.
- You never place orders and you never tell the trader to trade: you read the evidence.`;
const AI_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["lean", "confidence", "why", "watch", "invalid", "risk"],
  properties: {
    lean: { type: "string", enum: ["up", "down", "none"] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    why: { type: "string" },
    watch: { type: "string" },
    invalid: { type: "number" },
    risk: { type: "string" },
  },
};

class Evidence {
  /**
   * @param horizon   the 15-minute forecaster (server/horizon.js): replay(), inputs(), storedDates(), ready(), storedTo(),
   *                  pending(), watching(), barsFor(), view()
   * @param market    the market service: _call(k => k.quotes(keys)), flowSnapshot(), optionChain(), context(), global
   * @param docs      the record store
   * @param ahead     the early calls (server/ahead.js), for the AI's board and the need test (optional)
   * @param ask       ({ system, user, schema, … }) → { data, by } — the AI Engine (optional: no AI reads without it)
   * @param holding   () → [{ symbol, side: "long"|"short", qty, avg }] — the open positions (optional)
   */
  constructor({ horizon, market = null, docs, ahead = null, ask = null, aiReady = null, holding = null, guard = null, now = () => Date.now(), log = console }) {
    // automatic training / learning never right after a start, nor again at once after a run the server did not live through
    // (server/train-guard.js); optional: without it, nothing changes
    this.guard = guard;
    this.horizon = horizon;
    this.market = market;
    this.docs = docs;
    this.ahead = ahead;
    this.ask = ask;
    this.aiReady = aiReady || (() => Boolean(ask)); // is a model set up at all?
    this.holding = holding; // the OWNER's positions: read only for the owner's own opens and questions
    this.now = now;
    this.log = log;
    this.timer = null;
    this._model = null;
    this._curves = null;
    this._liveDoc = null;
    this._map = null;
    this._job = null;
    this._rev = 0;
    this._anchor = new Map();
    this._cache = new Map(); // `${symbol}|full` → { at, part }
    this._pending = [];
    this._sweepSlot = "";
    this._scoreAt = 0;
    this._dailyAt = "";
    this._tryAt = 0;
    this._aiBusy = new Set();
    this._ledNow = null;
    this._late = null;
    this._nowHit = null;
    this.lastError = "";
  }

  /* --------------------------------------------------------------------------- the record */
  _recs() {
    if (!this._map) this._map = new Map(this.docs.items(CALLS).map((r) => [r.id, r]));
    return this._map;
  }
  model() {
    if (!this._model) this._model = this.docs.read(MODEL, null);
    return this._model;
  }
  _usable() {
    const m = this.model();
    return m && m.version === E.MODEL_VERSION && m.forecaster === H.MODEL_VERSION && m.hz && E.KEYS.every((h) => m.hz[h] && m.hz[h].W && m.hz[h].W0) ? m : null;
  }
  _saveModel(m) {
    this._rev += 1;
    this._model = m;
    this._curves = null;
    this.docs.write(MODEL, m);
  }
  _live() {
    if (!this._liveDoc) {
      const d = this.docs.read(LIVE, null) || {};
      this._liveDoc = { ledger: d.ledger || {}, ledgerDays: d.ledgerDays || {}, calls: d.calls || {}, ai: { ...AI_DEFAULT, ...(d.ai || {}) }, aiDay: d.aiDay || { date: "", count: 0 }, aiReads: Array.isArray(d.aiReads) ? d.aiReads : [], aiTally: d.aiTally || [0, 0], n: d.n || 0 };
    }
    return this._liveDoc;
  }
  _saveLive() {
    this._rev += 1;
    this._ledNow = null;
    this.docs.write(LIVE, this._liveDoc);
  }
  /** The live readings' ledger with the sessions still open counted in (each as one session). */
  _liveLedger() {
    if (!this._ledNow) {
      const live = this._live();
      const led = E.ledgerMerge({}, live.ledger);
      for (const day of Object.values(live.ledgerDays)) E.ledgerFold(led, day);
      this._ledNow = led;
    }
    return this._ledNow;
  }
  fingerprint() {
    const j = this._job;
    return `${this._rev}|${j ? `${j.kind}|${j.phase}|${Math.floor((j.rows || 0) / 50000)}|${j.finishedAt || ""}` : ""}|${this._aiBusy.size}`;
  }
  jobView() {
    return this._job ? { ...this._job } : null;
  }
  _busy() {
    return Boolean(this._job && !this._job.finishedAt);
  }
  /** Each horizon's two models with their calibration curves (worked out once per model). */
  _curvesOf(m) {
    if (this._curves && this._curves.m === m) return this._curves.v;
    const v = {};
    for (const h of E.KEYS) {
      const x = m.hz[h];
      v[h] = { full: { W: x.W, base: x.base, curves: E.curvesOf(x.cal, x.base) }, alone: { W: x.W0, base: x.base, curves: E.curvesOf(x.cal0, x.base) }, on: E.techniquesOn(x.ev) };
    }
    this._curves = { m, v };
    return v;
  }

  /* --------------------------------------------------------------------------- learning from the whole history */
  train({ trigger = "manual" } = {}) {
    if (this._busy()) return Promise.resolve({ busy: true });
    if (!this.horizon.ready()) return Promise.reject(new EvidenceError("The evidence desk learns through the 15-minute forecaster, which is not ready yet (it needs the stored NIFTY 100 history, and is trained first).", "not_ready", 409));
    const wait = this.guard ? this.guard.wait("evidence-train", trigger) : "";
    if (wait) return Promise.reject(new EvidenceError(`Training waits: ${wait}.`, "deferred", 409));
    this._job = { kind: "train", trigger, phase: "reading the stored sessions", rows: 0, startedAt: iso(this.now()), finishedAt: null, error: "" };
    const run = this._run(() => this._train());
    return this.guard ? this.guard.track("evidence-train", trigger, run) : run;
  }
  _run(fn) {
    return fn()
      .catch((err) => {
        this._job.error = err.message || String(err);
        this.lastError = this._job.error;
        this.log.error(`[evidence] ${this._job.kind} failed: ${this._job.error}`);
        throw err;
      })
      .finally(() => {
        this._job.finishedAt = iso(this.now());
        this._rev += 1;
      });
  }

  async _train() {
    const job = this._job;
    const dates = this.horizon.storedDates();
    if (dates.length < 40) throw new EvidenceError(`Only ${dates.length} stored sessions: the evidence desk needs at least 40 to learn from.`, "short_history", 409);
    const cut = dates[Math.floor(dates.length * 0.75)];
    const newest = dates[dates.length - 1];
    const train = E.KEYS.map(() => new E.Sums());
    const val = E.KEYS.map(() => new E.Sums());
    const held = E.KEYS.map(() => []);
    const seen = E.KEYS.map(() => 0);
    const ledger = E.emptyLedger();
    const dayLed = new Map(dates.map((d) => [d, E.emptyDay()])); // each technique's tally session by session (the stocks of a session move together)
    // of the unseen sessions, every other one sets the calibration and the rest give the numbers shown: whole sessions, never shared
    const unseenDates = dates.filter((d) => d > cut);
    const judgeDates = new Set(unseenDates.filter((_, i) => i % 2 === 1));
    const expected = this.horizon.storedStocks() * unseenDates.length * 70;
    const STRIDE = Math.max(1, Math.ceil(expected / HELD_MAX));
    job.phase = "learning";
    await this.horizon.replay(
      dates,
      (sym, date, rows, raw, ctx) => {
        if (!raw || !ctx) return;
        const wr = E.witnessRows(raw, ctx);
        const fOf = new Map(rows.map((r) => [r.s, r.p]));
        const w = E.DECAY_DAY ** H.daysBetween(date, newest);
        const unseen = date > cut;
        for (const r of wr) {
          if (!fOf.has(r.s)) continue;
          const f = E.forecasterOf(fOf.get(r.s));
          for (let k = 0; k < E.KEYS.length; k += 1) {
            const o = E.outcomeAt(r, k);
            if (!o) continue;
            const y = o.y;
            // "which comes first" reads the forecaster's 15-minute call; every question reads each technique in the bar's regime
            const z = E.inputsOf(f[Math.min(k, 1)], r.w, r.tr);
            (unseen ? val : train)[k].add(z, y, w);
            if (k < E.HZ.length) this._ledgerRow(dayLed.get(date), r, k);
            if (unseen) {
              seen[k] += 1;
              if (seen[k] % STRIDE === 0 && held[k].length < HELD_MAX) held[k].push({ z: Float32Array.from(z), y, yv: o.yv, d: date });
            }
          }
        }
        job.rows += wr.length;
      },
      { needAll: false }
    );
    for (const d of dates) E.ledgerFold(ledger, dayLed.get(d));
    job.phase = "measuring it on sessions it has not seen";
    const hz = {};
    const shown = {};
    for (let k = 0; k < E.KEYS.length; k += 1) {
      const h = E.KEYS[k];
      const Wt = E.fit(train[k]);
      const W0t = E.fit(train[k], 2);
      if (!Wt || !W0t) throw new EvidenceError("Not enough examples to fit the evidence desk.", "short_history", 409);
      const base0 = train[k].base();
      const choose = held[k].filter((it) => !judgeDates.has(it.d));
      const judge = held[k].filter((it) => judgeDates.has(it.d)).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
      // the calibration is set on one half of the unseen sessions; the numbers shown come from the other half, which chose nothing
      const cal = E.emptyCal();
      const cal0 = E.emptyCal();
      for (const it of choose) {
        E.calAdd(cal, Wt, it.z, it.y);
        E.calAdd(cal0, W0t, it.z, it.y);
      }
      const full = { W: Wt, base: base0, curves: E.curvesOf(cal, base0) };
      const alone = { W: W0t, base: base0, curves: E.curvesOf(cal0, base0) };
      const ev = E.emptyEv();
      let day = "";
      for (const it of judge) {
        if (it.d !== day) {
          E.evClose(ev); // a session is one trial of "does this hold?", however many bars it has
          day = it.d;
        }
        E.evAdd(ev, full, alone, it.z, it.y, it.yv);
      }
      E.evClose(ev);
      shown[h] = E.summarise(ev);
      // for use from now on: fitted on everything, calibrated on every unseen row
      for (const it of judge) {
        E.calAdd(cal, Wt, it.z, it.y);
        E.calAdd(cal0, W0t, it.z, it.y);
      }
      train[k].merge(val[k]);
      hz[h] = { stats: train[k].toJSON(), W: E.fit(train[k]) || Wt, W0: E.fit(train[k], 2) || W0t, base: train[k].base().map(r4), cal, cal0, ev, rows: train[k].n };
      await tick();
    }
    job.phase = "saving";
    const model = {
      version: E.MODEL_VERSION,
      forecaster: H.MODEL_VERSION,
      trainedAt: iso(this.now()),
      lastDate: newest,
      hz,
      ledger,
      validation: { from: dates.find((d) => d > cut) || null, to: newest, trainTo: cut, sessions: dates.length, examples: held.map((x) => x.length), shown },
      learned: { days: 0, lastAt: null, last: null },
    };
    this._saveModel(model);
    this._cache.clear();
    this.lastError = "";
    const s = shown[3];
    this.log.log(`[evidence] trained on ${hz[3].rows.toLocaleString("en-IN")} bars from ${dates.length} sessions; unseen, 15 min: leaned ${s.all.n.toLocaleString("en-IN")} times, right ${s.all.right == null ? "—" : pc(s.all.right)} (the forecaster alone ${s.alone.right == null ? "—" : pc(s.alone.right)} of ${s.alone.n.toLocaleString("en-IN")}); the techniques ${s.on ? `cut the miss by ${(s.adds * 100).toFixed(2)}% and are in use` : "did not beat the forecaster alone and are shown for reading only"}`);
    return { rows: hz[3].rows, sessions: dates.length, validation: model.validation };
  }

  /** One bar into a session's tally: each technique that spoke, overall and in the regime the bar was in ("@t" trend, "@r" range). */
  _ledgerRow(day, r, k) {
    for (let j = 0; j < E.W; j += 1) {
      if (!r.w[j]) continue;
      E.dayAdd(day, E.WITS[j].id, k, r.w[j], r.y[k]);
      E.dayAdd(day, `${E.WITS[j].id}${r.tr ? "@t" : "@r"}`, k, r.w[j], r.y[k]);
    }
  }

  /* --------------------------------------------------------------------------- learning each evening */
  learnDays({ trigger = "itself" } = {}) {
    if (this._busy()) return Promise.resolve({ busy: true });
    const m = this._usable();
    if (!m) return Promise.resolve({ skipped: "untrained" });
    if (!this.horizon.ready()) return Promise.resolve({ skipped: "forecaster busy" });
    const wait = this.guard ? this.guard.wait("evidence-learn", trigger) : "";
    if (wait) return Promise.reject(new EvidenceError(`Learning waits: ${wait}.`, "deferred", 409));
    this._job = { kind: "learn", trigger, phase: "reading the new sessions", rows: 0, startedAt: iso(this.now()), finishedAt: null, error: "" };
    const run = this._run(() => this._learnDays(m));
    return this.guard ? this.guard.track("evidence-learn", trigger, run) : run;
  }

  async _learnDays(m) {
    const job = this._job;
    const dates = this.horizon.storedDates().filter((d) => d > m.lastDate);
    if (!dates.length) {
      job.phase = "nothing new";
      return { days: 0 };
    }
    const newest = dates[dates.length - 1];
    const asStood = this._curvesOf(m);
    const fade = FADE ** dates.length;
    const gap = E.DECAY_DAY ** Math.max(1, H.daysBetween(m.lastDate, newest));
    const st = E.KEYS.map((h) => ({ sums: E.Sums.from(m.hz[h].stats).scale(gap), cal: E.calScale(m.hz[h].cal || E.emptyCal(), fade), cal0: E.calScale(m.hz[h].cal0 || E.emptyCal(), fade), ev: E.evScale(m.hz[h].ev || E.emptyEv(), fade), day: new Map(dates.map((d) => [d, E.emptyEv()])) }));
    const ledger = E.ledgerScale(m.ledger || E.emptyLedger(), gap);
    const dayLed = new Map(dates.map((d) => [d, E.emptyDay()]));
    const counts = new Map(dates.map((d) => [d, 0]));
    job.phase = "calling, checking and learning the new sessions";
    await this.horizon.replay(
      dates,
      (sym, date, rows, raw, ctx) => {
        if (!raw || !ctx) return;
        const wr = E.witnessRows(raw, ctx);
        const fOf = new Map(rows.map((r) => [r.s, r.p]));
        const w = E.DECAY_DAY ** H.daysBetween(date, newest);
        for (const r of wr) {
          if (!fOf.has(r.s)) continue;
          const f = E.forecasterOf(fOf.get(r.s));
          for (let k = 0; k < E.KEYS.length; k += 1) {
            const o = E.outcomeAt(r, k);
            if (!o) continue;
            const y = o.y;
            const z = E.inputsOf(f[Math.min(k, 1)], r.w, r.tr);
            const a = asStood[E.KEYS[k]];
            // first the call, with the model as it stood; then the lesson
            E.evAdd(st[k].day.get(date), a.full, a.alone, z, y, o.yv);
            E.calAdd(st[k].cal, a.full.W, z, y);
            E.calAdd(st[k].cal0, a.alone.W, z, y);
            st[k].sums.add(z, y, w);
            if (k < E.HZ.length) this._ledgerRow(dayLed.get(date), r, k);
          }
        }
        counts.set(date, counts.get(date) + wr.length);
        job.rows += wr.length;
      },
      { needAll: false }
    );
    job.phase = "saving";
    for (const d of dates) E.ledgerFold(ledger, dayLed.get(d));
    for (const x of st) for (const ev of x.day.values()) E.evClose(ev); // each new session is one trial
    const dayRecords = [];
    for (const date of dates) {
      if (!counts.get(date)) continue;
      dayRecords.push({ id: date, date, at: iso(this.now()), rows: counts.get(date), shown: Object.fromEntries(E.KEYS.map((h, k) => [h, E.summarise(st[k].day.get(date))])) });
    }
    E.KEYS.forEach((h, k) => {
      for (const ev of st[k].day.values()) E.evMerge(st[k].ev, ev);
      m.hz[h] = { stats: st[k].sums.toJSON(), W: E.fit(st[k].sums) || m.hz[h].W, W0: E.fit(st[k].sums, 2) || m.hz[h].W0, base: st[k].sums.base().map(r4), cal: st[k].cal, cal0: st[k].cal0, ev: st[k].ev, rows: st[k].sums.n };
    });
    m.ledger = ledger;
    this.docs.putItems(DAYS, dayRecords);
    m.lastDate = newest;
    m.learned = { days: ((m.learned && m.learned.days) || 0) + dayRecords.length, lastAt: iso(this.now()), last: newest };
    this._saveModel(m);
    this._cache.clear();
    const last = dayRecords[dayRecords.length - 1];
    if (last) this.log.log(`[evidence] learned ${dayRecords.length} session${dayRecords.length === 1 ? "" : "s"} to ${newest}; on ${last.date} the 15-minute call leaned ${last.shown[3].all.n} times, right ${last.shown[3].all.right == null ? "—" : pc(last.shown[3].all.right)}`);
    return { days: dayRecords.length, last: newest };
  }

  /** What is waiting: a first training, or the day's lesson (both only after the forecaster has done its own). */
  pending() {
    const busy = this._busy();
    let ready = false;
    let to = "";
    let fp = { learn: false, train: false };
    try {
      ready = this.horizon.ready();
      to = this.horizon.storedTo();
      fp = this.horizon.pending();
    } catch (_) {
      ready = false;
    }
    const m = this._usable();
    const clear = ready && !fp.train && !fp.learn;
    return { busy, train: !m && clear && Boolean(to), learn: Boolean(m && clear && to && to > m.lastDate), to: to || null, lastDate: m ? m.lastDate : null };
  }

  /* --------------------------------------------------------------------------- what is only known live */
  async _quotes(keys) {
    if (!this.market || typeof this.market._call !== "function" || !keys.length) return {};
    try {
      return (await this.market._call((k) => k.quotes(keys))) || {};
    } catch (_) {
      return {};
    }
  }
  _bookOf(q) {
    return q && q.depth ? { b: q.depth.b || [], a: q.depth.a || [], buyQty: q.buyQty, sellQty: q.sellQty } : null;
  }

  /**
   * Everything live for one stock. `full` also reads BSE, the option chain and the overseas indices (one stock, opened by
   * a person); the sweep over the followed stocks reads only what one shared request gives.
   */
  async _liveFor(symbol, inp, { full = false, pre = null } = {}) {
    const now = this.now();
    const sources = [];
    const src = (name, ok, note = "") => sources.push({ name, ok: Boolean(ok), note });
    const keys = [`NSE:${symbol}`];
    if (full) keys.push(`BSE:${symbol}`, "BSE:SENSEX");
    const q = pre && pre[`NSE:${symbol}`] && !full ? pre : await this._quotes(keys);
    const nse = q[`NSE:${symbol}`] || null;
    const L = { minute: minuteOfDay(now), last: nse && num(nse.last) ? nse.last : inp.fc.anchor.price, nseVolume: nse ? nse.volume : null };
    L.book = this._bookOf(nse);
    src("Order book on NSE (5 best bids and offers, all pending orders)", L.book, L.book ? "" : "Zerodha sent no order book for this stock just now.");
    try {
      L.flow = this.market && typeof this.market.flowSnapshot === "function" ? this.market.flowSnapshot(symbol) : null;
    } catch (_) {
      L.flow = null;
    }
    L.tape = inp.flow && inp.flow.read ? inp.flow.read : null;
    src("Futures open interest, minute by minute", L.tape && num(L.tape.oi15Pct), L.tape && num(L.tape.oi15Pct) ? "" : "Recorded only for stocks with futures, once the market recorder has run today.");
    try {
      L.market = this.market && typeof this.market.context === "function" ? await this.market.context() : null;
    } catch (_) {
      L.market = null;
    }
    src("NIFTY, sectors, India VIX, GIFT NIFTY", L.market && L.market.available, L.market && L.market.available ? "" : (L.market && L.market.reason) || "The market context could not be read.");
    if (L.market && L.market.available) {
      const name = PSU_BANKS.has(symbol) ? "PSU banks" : SECTOR_INDEX[sectorOf(symbol)];
      const s = name ? (L.market.sectors || []).find((x) => x.name === name) : null;
      if (s && num(s.changePct)) L.sector = { name: `NIFTY ${name}`, changePct: s.changePct };
    }
    if (full) {
      const bse = q[`BSE:${symbol}`] || null;
      if (bse && num(bse.last)) L.bse = { last: bse.last, changePct: bse.changePct, volume: bse.volume, book: this._bookOf(bse) };
      const sx = q["BSE:SENSEX"] || null;
      if (sx && num(sx.changePct)) L.sensex = { last: sx.last, changePct: sx.changePct };
      src("BSE: the same stock's quote and order book, and the SENSEX", L.bse || L.sensex, L.bse ? "" : "Zerodha returned no BSE quote for this symbol (it may not be listed there under the same name).");
      try {
        L.chain = this.market && typeof this.market.optionChain === "function" ? await this.market.optionChain(symbol) : null;
      } catch (_) {
        L.chain = null;
      }
      src("Option chain (put-call ratio, walls, max pain)", L.chain && L.chain.available, L.chain && L.chain.available ? "" : "This stock has no options, or the chain could not be read.");
      try {
        const g = this.market && this.market.global ? await this.market.global.quotes() : null;
        L.world = g && g.available ? g.markets : null;
        src("Wall Street and Asia", L.world, L.world ? "" : (g && g.reason) || "The overseas feed is not set up.");
      } catch (_) {
        L.world = null;
        src("Wall Street and Asia", false, "The overseas feed could not be read.");
      }
    }
    return { L, sources, quote: nse };
  }

  /** How much a live reading has earned: its live record, and the tilt it gives the chance of a rise (0 until proven). */
  _liveTilt(id, k, state) {
    const cell = (this._liveLedger()[id] || [])[k];
    const rec = E.recordOf(cell, LIVE_MIN, LIVE_DAYS);
    if (!state || (rec.verdict !== "works" && rec.verdict !== "backwards")) return { rec, tilt: 0 };
    const shrink = rec.n / (rec.n + 200);
    return { rec, tilt: state * clip(TILT_PER_MOVE * rec.edge * shrink, TILT_MAX) };
  }

  /* --------------------------------------------------------------------------- the call for a stock, now */
  async _compute(symbol, { full = false, pre = null } = {}) {
    const inp = await this.horizon.inputs(symbol);
    if (!inp || !inp.fc || !inp.bars || !inp.ctx) return { reason: (inp && inp.reason) || "The evidence desk reads through the 15-minute forecaster, which has nothing for this stock yet.", closed: Boolean(inp && inp.closed) };
    const read = E.readNow(inp.bars, inp.ctx);
    if (!read) return { reason: "No finished 5-minute bar yet today." };
    const m = this._usable();
    const fc = inp.fc;
    const left = H.closeOf(inp.ctx) - 1 - fc.anchor.slot; // bars of continuous trading left (it ends at 3:15 PM in a closing-auction stock)
    const { L, sources, quote } = await this._liveFor(symbol, inp, { full, pre });
    const live = E.liveWitnesses(L);
    const calls = {};
    const f = [];
    E.KEYS.forEach((h, k) => {
      const hb = k < E.HZ.length ? h : 3; // "which comes first" reads the forecaster's 15-minute call
      const fh = fc.horizons[hb];
      if (k < E.HZ.length) f[k] = fh && fc.sigma > 0 ? clip(fh.pct / fc.sigma / Math.sqrt(hb), 2.5) : 0;
      if (!m || (k < E.HZ.length ? h : E.TB_BARS) > left || !fh) return;
      const cv = this._curvesOf(m)[h];
      const z = E.inputsOf(f[Math.min(k, 1)], read.states, read.trend);
      const mdl = cv.on ? cv.full : cv.alone;
      const raw = E.callOf(mdl, z);
      // a live reading moves the call only once its own record has proven it
      const moved = [];
      let tilt = 0;
      for (const row of live.rows) {
        const t = this._liveTilt(row.id, Math.min(k, 1), row.state);
        if (t.tilt) {
          tilt += t.tilt;
          moved.push({ id: row.id, name: row.name, points: r4(t.tilt) });
        }
      }
      tilt = clip(tilt, TILT_SUM);
      const pUp = Math.max(0.02, Math.min(0.95, raw.pUp + tilt));
      const pDown = Math.max(0.02, Math.min(0.95, raw.pDown - tilt));
      const lean = E.leanOf(pUp, pDown, mdl.base[0], mdl.base[1]);
      // which techniques pushed it, and which pulled against
      const why = [];
      if (cv.on) {
        const wk = cv.full.W[lean.side < 0 ? 1 : 0];
        for (let j = 0; j < E.W; j += 1) {
          if (!read.states[j]) continue;
          const push = wk[E.weightAt(j, read.trend)] * read.states[j];
          if (Math.abs(push) >= 0.002) why.push({ id: E.WITS[j].id, name: E.WITS[j].name, push: r4(push) });
        }
        why.sort((a, b) => Math.abs(b.push) - Math.abs(a.push));
      }
      const ev = m.hz[h].ev;
      const pair = lean.side ? (cv.on ? ev.tiers : ev.alone)[lean.tier] : null;
      calls[h] = { h, pUp: r4(pUp), pDown: r4(pDown), usualUp: mdl.base[0], usualDown: mdl.base[1], side: lean.side, tier: lean.tier, on: cv.on, adds: r4(E.addsOf(ev)), proven: pair ? E.provenOf(pair) : false, right: pair && pair[0] > 0 ? r4(pair[1] / pair[0]) : null, n: pair ? Math.round(pair[0]) : 0, why: why.slice(0, 5), live: moved, forecaster: { pUp: fh.pUp, pct: fh.pct, price: fh.price, low: fh.low, high: fh.high } };
    });
    return { inp, read, live, L, sources, quote, calls, f, left, m, now: inp.now };
  }

  _sentence(c, minutesAhead, atClock) {
    const when = `by ${atClock}${num(minutesAhead) ? ` (${Math.max(1, Math.round(minutesAhead))} min)` : ""}`;
    if (!c.side) return `No clear lean ${when}: a rise is ${pc(c.pUp)} likely (usual ${pc(c.usualUp)}), a fall ${pc(c.pDown)} (usual ${pc(c.usualDown)}).`;
    const p = c.side > 0 ? c.pUp : c.pDown;
    const usual = c.side > 0 ? c.usualUp : c.usualDown;
    const firm = c.tier === "strong" ? "points" : c.tier === "clear" ? "leans" : "leans slightly";
    const rec = c.n ? ` Leans this firm were right ${c.right == null ? "—" : pc(c.right)} of ${c.n.toLocaleString("en-IN")} times on unseen sessions${c.proven ? "" : " — not yet proven"}.` : "";
    return `The evidence ${firm} ${c.side > 0 ? "UP" : "DOWN"} ${when}: ${pc(p)} against a usual ${pc(usual)}.${rec}`;
  }

  _witnessRows(c) {
    const led = (c.m && c.m.ledger) || {};
    return c.read.said.map((s) => {
      const def = E.WITS[E.WIX[s.id]];
      const rk = `${s.id}${c.read.trend ? "@t" : "@r"}`;
      return { id: s.id, name: s.name, fam: s.fam, what: def.what, state: s.state, text: s.text, record: { 5: E.recordOf((led[s.id] || [])[0]), 15: E.recordOf((led[s.id] || [])[1]) }, regime: { name: c.read.trend ? "trend" : "range", 5: E.recordOf((led[rk] || [])[0]), 15: E.recordOf((led[rk] || [])[1]) } };
    });
  }
  _liveRows(c) {
    const led = this._liveLedger();
    return c.live.rows.map((s) => ({ ...s, what: E.LIVE[E.LIVE_IX[s.id]].what, record: { 5: E.recordOf((led[s.id] || [])[0], LIVE_MIN, LIVE_DAYS), 15: E.recordOf((led[s.id] || [])[1], LIVE_MIN, LIVE_DAYS) } }));
  }
  _ladder(book, stats) {
    if (!book || !stats) return null;
    const rows = (list) => (list || []).filter((l) => l[0] > 0).slice(0, 5).map((l) => ({ price: l[0], qty: l[1], orders: l[2] || 0 }));
    return { bids: rows(book.b), asks: rows(book.a), bidQty: stats.bidQty, askQty: stats.askQty, buyTotal: stats.buyTotal, sellTotal: stats.sellTotal, spread: r2(stats.spread), spreadPct: r4(stats.spreadPct), imbalance: r4(stats.imbalance), wall: stats.wall };
  }

  /** The whole board for one stock. */
  async view(symbol, { full = true } = {}) {
    if (!SYMBOL_RE.test(symbol)) throw new EvidenceError("That is not a valid symbol.", "invalid");
    const now = this.now();
    const m = this._usable();
    const base = { symbol, trained: Boolean(m), learning: this._learning(m), rule: RULE, checkRule: CHECK_RULE, ai: this._aiView(symbol), techniques: E.W };
    const key = `${symbol}|${full ? 1 : 0}`;
    const hit = this._cache.get(key);
    if (hit && now - hit.at < 10000) return { ...base, ...hit.part };
    let part;
    try {
      const c = await this._compute(symbol, { full });
      if (!c.read) part = { available: false, reason: c.reason, closed: Boolean(c.closed) };
      else {
        this._keep(symbol, c);
        this._flush();
        const end = c.inp.fc.anchor.end;
        const witnesses = this._witnessRows(c);
        const liveRows = this._liveRows(c);
        const calls = E.HZ.filter((h) => c.calls[h]).map((h) => {
          const x = c.calls[h];
          const at = end + h * E.BAR;
          return { key: String(h * 5), minutes: h * 5, at: iso(at), lean: x.side > 0 ? "up" : x.side < 0 ? "down" : "none", tier: x.tier || "none", pUp: x.pUp, pDown: x.pDown, usualUp: x.usualUp, usualDown: x.usualDown, proven: x.proven, right: x.right, n: x.n, uses: x.on ? "techniques" : "forecaster", adds: x.adds, why: x.why, live: x.live, forecaster: x.forecaster, read: this._sentence(x, (at - now) / 60000, clock(at)) };
        });
        const tb = c.calls.tb || null;
        const unit = c.read.sloc * E.TB_UNIT; // one usual 15-minute move, in the moves of the moment
        const last0 = c.inp.fc.anchor.price;
        const first = tb
          ? {
              minutes: E.TB_BARS * 5,
              by: iso(end + E.TB_BARS * E.BAR),
              movePct: r4(unit * 100),
              up: { price: Math.round(last0 * (1 + unit) * 20) / 20, p: tb.pUp, usual: tb.usualUp },
              down: { price: Math.round(last0 * (1 - unit) * 20) / 20, p: tb.pDown, usual: tb.usualDown },
              lean: tb.side > 0 ? "up" : tb.side < 0 ? "down" : "none",
              tier: tb.tier || "none",
              proven: tb.proven,
              right: tb.right,
              n: tb.n,
              uses: tb.on ? "techniques" : "forecaster",
              read: `Within ${E.TB_BARS * 5} minutes, a move of ${(unit * 100).toFixed(2)}% up (to ${(Math.round(last0 * (1 + unit) * 20) / 20).toFixed(2)}) comes first ${pc(tb.pUp)} of the time (usual ${pc(tb.usualUp)}); the same move down (to ${(Math.round(last0 * (1 - unit) * 20) / 20).toFixed(2)}) comes first ${pc(tb.pDown)} (usual ${pc(tb.usualDown)}); otherwise neither.`,
            }
          : null;
        const firing = [...witnesses, ...liveRows.filter((r) => r.state)];
        const good = (r) => r.record[15].verdict === "works" || r.record[15].verdict === "backwards";
        const sideOf = (r) => (r.record[15].verdict === "backwards" ? -r.state : r.state);
        part = {
          available: true,
          reason: m ? "" : "The evidence desk has not learned yet: it trains by itself once the 15-minute forecaster is ready. The readings below are live; the call and the records come with the first training.",
          closed: false,
          asOf: iso(now),
          anchor: { at: iso(end), price: c.inp.fc.anchor.price },
          last: c.L.last,
          calls,
          first,
          regime: { name: c.read.trend ? "trend" : "range", er: c.read.er },
          count: { up: firing.filter((r) => r.state > 0).length, down: firing.filter((r) => r.state < 0).length, silent: E.W - witnesses.length, provenUp: firing.filter((r) => good(r) && sideOf(r) > 0).length, provenDown: firing.filter((r) => good(r) && sideOf(r) < 0).length },
          witnesses,
          live: liveRows,
          book: { nse: this._ladder(c.L.book, c.live.book), bse: c.L.bse ? { ...this._ladder(c.L.bse.book, c.live.bseBook), last: c.L.bse.last, changePct: r2(c.L.bse.changePct), volume: c.L.bse.volume } : null },
          volume: c.quote ? { today: c.quote.volume, vwap: c.quote.avgPrice, buyQty: c.quote.buyQty, sellQty: c.quote.sellQty } : null,
          indicators: E.indicatorsOf(c.read.P),
          levels: this._nearLevels(c.read.P),
          sources: c.sources,
        };
      }
    } catch (err) {
      part = { available: false, reason: err.message || "The evidence could not be read." };
    }
    this._cache.set(key, { at: now, part });
    if (this._cache.size > 120) this._cache.clear();
    return { ...base, ...part };
  }

  _nearLevels(P) {
    const all = E.levelsOf(P);
    const above = all.filter((l) => l.side === "above").slice(-5);
    const below = all.filter((l) => l.side === "below").slice(0, 5);
    return [...above, ...below];
  }

  _learning(m) {
    if (!m) return { trainedAt: null, rows: 0, sessions: 0, lastDate: null, validation: null, days: 0 };
    return { trainedAt: m.trainedAt, rows: m.hz[3].rows, sessions: m.validation ? m.validation.sessions : 0, lastDate: m.lastDate, validation: m.validation, days: (m.learned && m.learned.days) || 0, lastLearnedAt: m.learned ? m.learned.lastAt : null, now: Object.fromEntries(E.KEYS.map((h) => [h, E.summarise(m.hz[h].ev)])) };
  }

  /* --------------------------------------------------------------------------- keeping and checking */
  _keep(symbol, c) {
    const end = c.inp.fc.anchor.end;
    if (!Object.keys(c.calls).length) return;
    if (this._anchor.get(symbol) === end) return;
    this._anchor.set(symbol, end);
    const date = istDate(c.now || this.now());
    const id = `${date}|${symbol}|${end}`;
    if (this._recs().has(id)) return;
    const calls = {};
    for (const h of E.KEYS) if (c.calls[h]) calls[h] = [c.calls[h].pUp, c.calls[h].pDown, c.calls[h].side, c.calls[h].tier ? TIER_IX[c.calls[h].tier] : -1, c.calls[h].on ? 1 : 0];
    const lw = {};
    for (const r of c.live.rows) if (r.state) lw[r.id] = r.state;
    const rec = { id, date, symbol, anchorEnd: end, madeAt: iso(c.now || this.now()), price: c.inp.fc.anchor.price, sigma: c.read.P.sigma, sl: r4(c.read.sloc * 100) / 100, c: calls, lw, settled: false, actual: null };
    this._rev += 1;
    this._recs().set(id, rec);
    this._pending.push(rec);
  }
  _flush() {
    if (this._pending.length) {
      this.docs.putItems(CALLS, this._pending);
      this._pending = [];
    }
  }

  /** Check every kept call whose 15 minutes are over; the live readings and the AI reads learn from it. */
  async score() {
    const now = this.now();
    // a call with a "which comes first" part is checked when its 30 minutes are over; one without, after 15
    const due = [...this._recs().values()].filter((r) => !r.settled && !r.void && now >= r.anchorEnd + (r.c && r.c.tb ? E.TB_BARS : 3) * E.BAR + 20000);
    const reads = this._live().aiReads.filter((r) => !r.settled && now >= r.anchorEnd + 3 * E.BAR + 20000);
    if (!due.length && !reads.length) return 0;
    const today = istDate(now);
    const barsOf = new Map();
    const bars = async (symbol, date) => {
      const key = `${symbol}|${date}`;
      if (!barsOf.has(key)) {
        let b = null;
        try {
          b = await this.horizon.barsFor(symbol, date);
        } catch (_) {
          b = null;
        }
        barsOf.set(key, b);
      }
      return barsOf.get(key);
    };
    const live = this._live();
    // a session that is over is folded into the ledger as one session
    for (const d of Object.keys(live.ledgerDays)) {
      if (d < today) {
        E.ledgerFold(live.ledger, live.ledgerDays[d]);
        delete live.ledgerDays[d];
      }
    }
    let done = 0;
    for (const r of due) {
      const b = await bars(r.symbol, r.date);
      const all = b && b.length ? E.settle(r, b) : {};
      if (!num(all[1]) && !num(all[3])) {
        // an earlier day's call with no bar to check it against is set aside (after three days when the history has not arrived)
        if (r.date < today && ((b && b.length) || now - r.anchorEnd > 3 * 86400000)) {
          r.void = true;
          this._pending.push(r);
        }
        continue;
      }
      if (!num(all[3]) && r.date === today && minuteOfDay(now) < OPEN_TO + 10) continue;
      r.actual = all;
      r.settled = true;
      this._pending.push(r);
      done += 1;
      E.HZ.forEach((h, k) => {
        const y = all[h];
        if (!num(y)) return;
        const call = r.c[h];
        if (call && call[2]) {
          const tier = E.TIERS[call[3]] || "slight";
          const t = (live.calls[h] || (live.calls[h] = {}))[tier] || (live.calls[h][tier] = [0, 0]);
          t[0] += 1;
          if (Math.sign(y) === call[2]) t[1] += 1;
        }
        // today's checks wait in the open session; an older call's go straight in, as part of that session
        const day = r.date < today ? (this._late || (this._late = {}))[r.date] || (this._late[r.date] = E.emptyDay()) : live.ledgerDays[r.date] || (live.ledgerDays[r.date] = E.emptyDay());
        for (const [id, state] of Object.entries(r.lw || {})) E.dayAdd(day, id, k, state, y);
      });
      // which came first: a lean is right when the move it named came first
      if (r.c.tb && r.c.tb[2] && num(all.tb)) {
        const tier = E.TIERS[r.c.tb[3]] || "slight";
        const t = (live.calls.tb || (live.calls.tb = {}))[tier] || (live.calls.tb[tier] = [0, 0]);
        t[0] += 1;
        if (all.tb === r.c.tb[2]) t[1] += 1;
      }
      live.n += 1;
    }
    let aiDone = 0;
    for (const r of reads) {
      const b = await bars(r.symbol, r.date);
      const all = b && b.length ? E.settle(r, b) : {};
      if (!num(all[3])) {
        if (r.date < today) {
          r.settled = true;
          r.void = true;
        }
        continue;
      }
      r.settled = true;
      r.y = all[3];
      if (r.lean !== "none") {
        r.ok = Math.sign(all[3]) === (r.lean === "up" ? 1 : -1);
        live.aiTally[0] += 1;
        if (r.ok) live.aiTally[1] += 1;
      }
      aiDone += 1;
    }
    if (this._late) {
      for (const day of Object.values(this._late)) E.ledgerFold(live.ledger, day);
      this._late = null;
    }
    if (done || aiDone) {
      this._saveLive();
      if (done) this.log.log(`[evidence] ${done} calls checked${aiDone ? `, ${aiDone} AI read${aiDone === 1 ? "" : "s"}` : ""}`);
    }
    this._prune();
    this._flush();
    return done + aiDone;
  }

  _prune() {
    const cutoff = istDate(this.now() - KEEP_DAYS * 86400000);
    const old = [...this._recs().values()].filter((r) => r.date < cutoff);
    if (!old.length) return;
    for (const r of old) this._recs().delete(r.id);
    this.docs.removeItems(CALLS, old.map((r) => r.id));
  }

  _liveTally() {
    const calls = this._live().calls;
    const out = {};
    for (const h of E.KEYS) {
      const t = calls[h] || {};
      const all = E.TIERS.reduce((a, x) => [a[0] + ((t[x] || [0, 0])[0]), a[1] + ((t[x] || [0, 0])[1])], [0, 0]);
      out[h] = { n: all[0], ok: all[1], tiers: Object.fromEntries(E.TIERS.map((x) => [x, { n: (t[x] || [0, 0])[0], ok: (t[x] || [0, 0])[1] }])) };
    }
    return out;
  }

  /** Every technique and live reading with its record, and how the call has done: the Research page's table. */
  board() {
    const m = this._usable();
    const led = (m && m.ledger) || {};
    const liveLed = this._liveLedger();
    const days = this.docs.items(DAYS).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 30);
    // a technique's pull on the 15-minute call (towards a rise minus towards a fall), in a trend and in a range
    const weightOf = (id, trend) => (m && this._curvesOf(m)[3].on ? r4(m.hz[3].W[0][E.weightAt(E.WIX[id], trend)] - m.hz[3].W[1][E.weightAt(E.WIX[id], trend)]) : null);
    return {
      trained: Boolean(m),
      learning: this._learning(m),
      techniques: E.WITS.map((w) => ({ id: w.id, name: w.name, fam: w.fam, what: w.what, record: { 5: E.recordOf((led[w.id] || [])[0]), 15: E.recordOf((led[w.id] || [])[1]) }, trend15: E.recordOf((led[`${w.id}@t`] || [])[1]), range15: E.recordOf((led[`${w.id}@r`] || [])[1]), weight15: { trend: weightOf(w.id, true), range: weightOf(w.id, false) } })),
      live: E.LIVE.map((w) => ({ id: w.id, name: w.name, fam: w.fam, what: w.what, record: { 5: E.recordOf((liveLed[w.id] || [])[0], LIVE_MIN, LIVE_DAYS), 15: E.recordOf((liveLed[w.id] || [])[1], LIVE_MIN, LIVE_DAYS) } })),
      days: days.map((d) => ({ date: d.date, rows: d.rows, call15: d.shown[3], call5: d.shown[1], first: d.shown.tb || null })),
      liveCalls: this._liveTally(),
      checked: this._live().n,
      ai: this.aiStatus(),
      job: this.jobView(),
      error: this.lastError,
      rule: RULE,
      checkRule: CHECK_RULE,
    };
  }

  /* --------------------------------------------------------------------------- for the other desks */
  /**
   * The next 15 minutes for each open position, and whether it is with the position or against it.
   * @param list [{ symbol, side: "long"|"short" }]
   */
  async forPositions(list) {
    const out = [];
    for (const p of (list || []).slice(0, 30)) {
      const symbol = String(p.symbol || "").toUpperCase();
      if (!SYMBOL_RE.test(symbol)) continue;
      let v = null;
      try {
        v = await this.view(symbol, { full: false });
      } catch (_) {
        v = null;
      }
      const c = v && v.available ? v.calls.find((x) => x.key === "15") || v.calls[0] : null;
      if (!c) {
        out.push({ symbol, side: p.side, available: false, reason: (v && v.reason) || "No reading." });
        continue;
      }
      const long = p.side !== "short";
      const against = c.lean !== "none" && (c.lean === "down") === long;
      const withIt = c.lean !== "none" && !against;
      const p15 = c.lean === "up" ? c.pUp : c.lean === "down" ? c.pDown : null;
      const text = c.lean === "none" ? `No clear lean for the next ${c.minutes} minutes.` : `The evidence ${c.tier === "slight" ? "leans slightly" : c.tier === "strong" ? "points" : "leans"} ${c.lean.toUpperCase()} for the next ${c.minutes} minutes (${pc(p15)} against a usual ${pc(c.lean === "up" ? c.usualUp : c.usualDown)}): ${against ? `AGAINST your ${long ? "long" : "short"}` : `with your ${long ? "long" : "short"}`}${c.proven ? "" : " — a lean of this firmness is not yet proven"}.`;
      // which comes first for THIS position: the move in its favour, or the same move against it
      const fst = v.first ? { minutes: v.first.minutes, movePct: v.first.movePct, favour: long ? v.first.up : v.first.down, against: long ? v.first.down : v.first.up, proven: v.first.proven } : null;
      const firstText = fst ? ` Within ${fst.minutes} minutes a move of ${fst.movePct.toFixed(2)}% in your favour (to ${fst.favour.price.toFixed(2)}) comes first ${pc(fst.favour.p)} of the time; the same move against you (to ${fst.against.price.toFixed(2)}) ${pc(fst.against.p)}.` : "";
      out.push({ symbol, side: p.side, available: true, minutes: c.minutes, lean: c.lean, tier: c.tier, p: p15, pUp: c.pUp, pDown: c.pDown, proven: c.proven, against, with: withIt, text: text + firstText, first: fst, up: v.count.up, down: v.count.down, at: c.at });
    }
    return out;
  }

  /**
   * The command screen's board: every followed stock with its price and its calls for 5 and 15 minutes, read with ONE shared
   * request for all their order books. Kept for ten seconds; every call it makes is kept and checked like any other.
   * @param symbols  the stocks to show (the watchlist and the ones looked at lately)
   * @returns { at, trained, rows: [{ symbol, available, last, changePct, calls: { 5, 15 }, up, down, speaking, early, reason }] }
   */
  async nowBoard(symbols) {
    const list = [...new Set((symbols || []).map((s) => String(s || "").toUpperCase()))].filter((s) => SYMBOL_RE.test(s)).slice(0, 40);
    const now = this.now();
    const key = list.join(",");
    if (this._nowHit && this._nowHit.key === key && now - this._nowHit.at < 10000) return this._nowHit.v;
    const pre = await this._quotes(list.map((s) => `NSE:${s}`));
    const rows = [];
    const brief = (x, end) => (x ? { lean: x.side > 0 ? "up" : x.side < 0 ? "down" : "none", tier: x.tier || "none", p: x.side > 0 ? x.pUp : x.side < 0 ? x.pDown : null, pUp: x.pUp, pDown: x.pDown, usualUp: x.usualUp, usualDown: x.usualDown, proven: x.proven, at: iso(end + x.h * E.BAR) } : null);
    for (const s of list) {
      const q = pre[`NSE:${s}`] || null;
      const base = { symbol: s, last: q && num(q.last) ? q.last : null, changePct: q && num(q.changePct) ? r2(q.changePct) : null };
      try {
        const c = await this._compute(s, { full: false, pre });
        if (!c.read) {
          rows.push({ ...base, available: false, reason: c.reason || "No reading." });
          continue;
        }
        this._keep(s, c);
        const end = c.inp.fc.anchor.end;
        const speaking = c.read.said.length + c.live.rows.filter((r) => r.state).length;
        let early = null;
        try {
          const a = this.ahead ? await this.ahead.view(s) : null;
          const h = a && a.available ? a.horizons.find((x) => x.key === "15") || a.horizons[0] : null;
          if (h) early = { tone: h.tone, read: h.read, reversal: h.reversal ? h.reversal.tier : null, momentum: h.momentum ? h.momentum.state : null };
        } catch (_) {
          early = null;
        }
        const i = c.read.P.n - 1;
        rows.push({
          ...base,
          last: base.last !== null ? base.last : c.L.last,
          available: true,
          asOf: iso(end),
          calls: { 5: brief(c.calls[1], end), 15: brief(c.calls[3], end) },
          forecaster: c.inp.fc.horizons[3] ? { pUp: c.inp.fc.horizons[3].pUp, pct: c.inp.fc.horizons[3].pct, low: c.inp.fc.horizons[3].low, high: c.inp.fc.horizons[3].high } : null,
          up: c.read.said.filter((r) => r.state > 0).length + c.live.rows.filter((r) => r.state > 0).length,
          down: c.read.said.filter((r) => r.state < 0).length + c.live.rows.filter((r) => r.state < 0).length,
          speaking,
          top: c.read.said.slice(0, 2).map((r) => ({ name: r.name, state: r.state })),
          vsVwapPct: r2((c.read.P.c[i] / c.read.P.vwap[i] - 1) * 100),
          volumeX: r2(c.read.P.rvol[i]),
          early,
        });
      } catch (err) {
        rows.push({ ...base, available: false, reason: err.message || "No reading." });
      }
    }
    this._flush();
    const v = { at: iso(now), trained: Boolean(this._usable()), rows, liveCalls: this._liveTally(), checked: this._live().n, ai: this.aiStatus() };
    this._nowHit = { key, at: now, v };
    return v;
  }

  /** The board in brief, for an AI and for TradeAI: numbers and sentences only. */
  async brief(symbol, { full = true, withPosition = false } = {}) {
    const v = await this.view(symbol, { full });
    if (!v.available) return { symbol, available: false, reason: v.reason };
    const rec = (r) => (r.n ? `${r.verdict === "works" ? "works here" : r.verdict === "backwards" ? "works the other way here" : r.verdict === "none" ? "no edge found here" : "too few cases"}: price went its way ${r.right == null ? "—" : pc(r.right)} of ${r.n}` : "not measured yet");
    const lad = (b) => (b ? { bids: b.bids.map((l) => [l.price, l.qty, l.orders]), offers: b.asks.map((l) => [l.price, l.qty, l.orders]), columns: ["price", "shares", "orders"], sharesBidAt5: b.bidQty, sharesOfferedAt5: b.askQty, allPendingBuy: b.buyTotal, allPendingSell: b.sellTotal, spread: b.spread, wall: b.wall } : null);
    let early = null;
    try {
      const a = this.ahead ? await this.ahead.view(symbol) : null;
      early = a && a.available ? a.horizons.map((x) => ({ minutes: x.minutesAhead, read: x.read })) : null;
    } catch (_) {
      early = null;
    }
    let held = null;
    try {
      held = withPosition && this.holding ? (this.holding() || []).find((p) => p.symbol === symbol) || null : null;
    } catch (_) {
      held = null;
    }
    return {
      symbol,
      available: true,
      timeIST: clock(this.now()),
      last: v.last,
      deskCall: v.calls.map((c) => ({ minutes: c.minutes, by: clock(Date.parse(c.at)), lean: c.lean, firmness: c.tier, chanceUp: c.pUp, chanceDown: c.pDown, usualUp: c.usualUp, usualDown: c.usualDown, proven: c.proven, read: c.read, forecasterAlone: c.forecaster })),
      whichComesFirst: v.first ? { withinMinutes: v.first.minutes, movePct: v.first.movePct, upFirst: { toPrice: v.first.up.price, chance: v.first.up.p, usual: v.first.up.usual }, downFirst: { toPrice: v.first.down.price, chance: v.first.down.p, usual: v.first.down.usual }, proven: v.first.proven } : null,
      regimeNow: v.regime ? `${v.regime.name} (efficiency ratio ${v.regime.er}; each technique's record below is the one for this regime where it is known)` : null,
      readingsLeaning: v.count,
      techniquesSpeaking: v.witnesses.map((w) => ({ name: w.name, leans: w.state > 0 ? "up" : "down", what: w.text, record15min: rec(w.record[15]), ...(w.regime && w.regime[15].n ? { [`record15minInA${w.regime.name === "trend" ? "Trend" : "Range"}`]: rec(w.regime[15]) } : {}) })),
      liveReadings: v.live.map((w) => ({ group: w.fam, name: w.name, leans: w.state > 0 ? "up" : w.state < 0 ? "down" : "neither", what: w.text, liveRecord15min: rec(w.record[15]) })),
      orderBookNSE: lad(v.book.nse),
      orderBookBSE: v.book.bse ? { ...lad(v.book.bse), last: v.book.bse.last, volume: v.book.bse.volume } : null,
      volume: v.volume,
      indicators: v.indicators,
      levels: v.levels.map((l) => ({ name: l.name, price: l.price, awayPct: l.awayPct })),
      earlyCalls: early,
      ...(withPosition ? { openPosition: held || "none in this stock" } : {}),
      notRead: v.sources.filter((s) => !s.ok).map((s) => `${s.name}: ${s.note}`),
    };
  }

  /* --------------------------------------------------------------------------- the AI read (on opening a stock, when needed) */
  aiSettings() {
    return { ...this._live().ai };
  }
  setAi(patch = {}, by = "") {
    const live = this._live();
    const s = { ...live.ai };
    if (["need", "always", "off"].includes(patch.mode)) s.mode = patch.mode;
    if (num(Number(patch.perDay))) s.perDay = Math.max(0, Math.min(300, Math.round(Number(patch.perDay))));
    if (num(Number(patch.gapMin))) s.gapMin = Math.max(5, Math.min(120, Math.round(Number(patch.gapMin))));
    if (typeof patch.everyone === "boolean") s.everyone = patch.everyone;
    s.by = by;
    s.at = iso(this.now());
    live.ai = s;
    this._saveLive();
    this.log.log(`[evidence] AI read on opening a stock: ${s.mode === "off" ? "OFF" : s.mode === "always" ? "every time" : "when needed"}, at most ${s.perDay} a day, ${s.gapMin} minutes apart per stock (${by || "unknown"})`);
    return this.aiStatus();
  }
  _aiCount() {
    const live = this._live();
    const day = istDate(this.now());
    if (live.aiDay.date !== day) live.aiDay = { date: day, count: 0 };
    return live.aiDay;
  }
  aiStatus() {
    const live = this._live();
    const t = live.aiTally;
    return { ...live.ai, ready: Boolean(this.ask && this.aiReady()), usedToday: this._aiCount().count, record: { n: t[0], ok: t[1], right: t[0] ? r4(t[1] / t[0]) : null }, recent: live.aiReads.slice(0, 12).map((r) => ({ symbol: r.symbol, at: r.at, lean: r.lean, confidence: r.confidence, trigger: r.trigger, settled: Boolean(r.settled && !r.void), ok: r.ok === undefined ? null : r.ok })) };
  }
  _aiLast(symbol) {
    return this._live().aiReads.find((r) => r.symbol === symbol) || null;
  }
  _aiView(symbol) {
    const s = this._live().ai;
    const r = this._aiLast(symbol);
    const t = this._live().aiTally;
    const fresh = r && this.now() - Date.parse(r.at) < 45 * 60000 && r.date === istDate(this.now());
    return { mode: s.mode, ready: Boolean(this.ask && this.aiReady()), busy: this._aiBusy.has(symbol), usedToday: this._aiCount().count, perDay: s.perDay, record: { n: t[0], ok: t[1], right: t[0] ? r4(t[1] / t[0]) : null }, read: fresh ? { at: r.at, lean: r.lean, confidence: r.confidence, why: r.why, watch: r.watch, invalid: r.invalid, risk: r.risk, by: r.by, trigger: r.trigger, price: r.price, settled: Boolean(r.settled && !r.void), ok: r.ok === undefined ? null : r.ok } : null };
  }

  /**
   * Does this stock, now, need the AI? @returns { need, why }
   * Needed when the arithmetic is undecided or its readings disagree, when a reversal is warned against a leaning call,
   * when the day is unusual, or when the trader holds the stock.
   */
  async _aiNeed(symbol, v, isOwner = false) {
    if (!v || !v.available) return { need: false, why: (v && v.reason) || "There is no board for this stock now." };
    const c15 = v.calls.find((c) => c.key === "15") || v.calls[0] || null;
    const reasons = [];
    if (!c15 || c15.lean === "none") {
      if (v.count.up + v.count.down >= 3) reasons.push("the desk's own call has no clear lean while several readings are speaking");
    } else if (!c15.proven) reasons.push("the desk's lean is not yet a proven one");
    if (v.count.up >= 3 && v.count.down >= 3) reasons.push(`the readings disagree (${v.count.up} lean up, ${v.count.down} lean down)`);
    try {
      const a = this.ahead ? await this.ahead.view(symbol) : null;
      const h = a && a.available ? a.horizons.find((x) => x.key === "15") : null;
      if (h && h.reversal && (h.reversal.tier === "raised" || h.reversal.tier === "likely")) reasons.push("a reversal is warned within 15 minutes");
    } catch (_) {
      /* the early calls are optional here */
    }
    const vol = v.indicators && num(v.indicators.volumeTimesUsual) ? v.indicators.volumeTimesUsual : null;
    if (vol !== null && vol >= 2.5) reasons.push(`the last bar traded ${vol}× its usual volume`);
    try {
      if (isOwner && this.holding && (this.holding() || []).some((p) => p.symbol === symbol)) reasons.push("you hold a position in it");
    } catch (_) {
      /* no positions to read */
    }
    return reasons.length ? { need: true, why: reasons[0], reasons } : { need: false, why: "the readings agree and the call is clear: no AI was needed" };
  }

  /**
   * A stock was opened on the Desk. Decides — by the owner's settings, the daily limit, the gap per stock and the need test —
   * whether the AI is asked, and if so starts the read (it finishes by itself; the page is told through the live channel).
   * The caller runs this inside the spend guard's "opened" context (server/app.js). @returns { asked, why }
   */
  async opened(symbol, { isOwner = false } = {}) {
    if (!SYMBOL_RE.test(symbol)) throw new EvidenceError("That is not a valid symbol.", "invalid");
    const s = this._live().ai;
    if (!this.ask || !this.aiReady()) return { asked: false, why: "No AI model is set up." };
    if (s.mode === "off") return { asked: false, why: "The AI read on opening a stock is switched off (AI page)." };
    if (!isOwner && !s.everyone) return { asked: false, why: "The AI read on opening a stock runs for the owner only." };
    const now = this.now();
    const min = minuteOfDay(now);
    if (!weekday(istDate(now)) || min < OPEN_FROM || min > OPEN_TO - 15) return { asked: false, why: "The AI reads the next 15 minutes only while the market is open (from 9:20 AM until 15 minutes before the close)." };
    if (this._aiBusy.has(symbol)) return { asked: false, why: "The AI is already reading this stock." };
    const last = this._aiLast(symbol);
    if (last && now - Date.parse(last.at) < s.gapMin * 60000) return { asked: false, why: `The AI read this stock ${Math.max(1, Math.round((now - Date.parse(last.at)) / 60000))} minutes ago.` };
    if (this._aiCount().count >= s.perDay) return { asked: false, why: `Today's limit of ${s.perDay} automatic AI reads is used up.` };
    const v = await this.view(symbol, { full: true });
    if (v.available && v.trained && !v.calls.some((c) => c.key === "15")) return { asked: false, why: "Too close to the end of continuous trading in this stock for a 15-minute read." };
    const need = s.mode === "always" ? { need: v.available, why: v.available ? "it was opened (the AI is set to read every opened stock)" : v.reason } : await this._aiNeed(symbol, v, isOwner);
    if (!need.need) return { asked: false, why: need.why };
    this._aiRead(symbol, need.why, { auto: true, isOwner }).catch((err) => this.log.error(`[evidence] the AI read of ${symbol} failed: ${err.message}`));
    return { asked: true, why: need.why };
  }

  /** The trader pressed "Ask the AI" on the board: one read now (a click, so no limit but the model's own). */
  askNow(symbol, { isOwner = false } = {}) {
    if (!SYMBOL_RE.test(symbol)) throw new EvidenceError("That is not a valid symbol.", "invalid");
    if (!this.ask || !this.aiReady()) throw new EvidenceError("No AI model is set up (AI page).", "no_ai", 409);
    if (this._aiBusy.has(symbol)) throw new EvidenceError("The AI is already reading this stock.", "busy", 409);
    return this._aiRead(symbol, "you asked", { auto: false, isOwner });
  }

  async _aiRead(symbol, trigger, { auto, isOwner = false }) {
    this._aiBusy.add(symbol);
    this._rev += 1;
    if (auto) {
      // counted when asked, not when answered: a failed request has still used its turn
      this._aiCount().count += 1;
      this._saveLive();
    }
    try {
      const board = await this.brief(symbol, { full: true, withPosition: isOwner });
      if (!board.available) throw new EvidenceError(board.reason || "There is no board for this stock now.", "unavailable", 409);
      const r = await this.ask({ system: AI_SYSTEM, user: `The evidence board for ${symbol} now (${board.timeIST} IST). The AI was asked because ${trigger}.\n${JSON.stringify(board)}\n\nWhich way for the next 15 minutes?`, schema: AI_SCHEMA, maxTokens: 3000, effort: "medium", timeoutSec: 60, fresh: true, subject: { symbol, last: board.last } });
      if (!r || !r.data) throw new EvidenceError("No AI model answered.", "no_answer", 502);
      const d = r.data;
      const now = this.now();
      const v = await this.view(symbol, { full: false }).catch(() => null);
      const prices = new Set([...(board.levels || []).map((l) => l.price), ...((board.orderBookNSE && board.orderBookNSE.bids) || []).map((l) => l[0]), ...((board.orderBookNSE && board.orderBookNSE.offers) || []).map((l) => l[0])]);
      const invalid = num(d.invalid) && d.invalid > 0 ? [...prices].reduce((best, p) => (best === null || Math.abs(p - d.invalid) < Math.abs(best - d.invalid) ? p : best), null) : null;
      const read = {
        symbol,
        date: istDate(now),
        at: iso(now),
        anchorEnd: v && v.anchor ? Date.parse(v.anchor.at) : now - (now % E.BAR),
        price: board.last,
        sigma: v && v.indicators && num(v.indicators.usualMovePct) ? v.indicators.usualMovePct / 100 : 0.0015,
        lean: ["up", "down", "none"].includes(d.lean) ? d.lean : "none",
        confidence: ["low", "medium", "high"].includes(d.confidence) ? d.confidence : "low",
        why: str(d.why, 600),
        watch: str(d.watch, 240),
        // a price the AI names is kept only when it is one of the board's own (within a twentieth of a percent)
        invalid: invalid !== null && Math.abs(invalid - d.invalid) / d.invalid <= 0.0005 ? invalid : null,
        risk: str(d.risk, 240),
        by: (r.by && r.by[0]) || "AI",
        trigger,
        auto: Boolean(auto),
        settled: false,
      };
      const live = this._live();
      live.aiReads.unshift(read);
      live.aiReads = live.aiReads.slice(0, AI_KEEP);
      this._saveLive();
      this.log.log(`[evidence] AI read of ${symbol} (${trigger}): ${read.lean}, ${read.confidence} confidence, by ${read.by}`);
      return this._aiView(symbol);
    } finally {
      this._aiBusy.delete(symbol);
      this._rev += 1;
    }
  }

  /* --------------------------------------------------------------------------- timers */
  async sweep() {
    let made = 0;
    const list = this.horizon.watching();
    const pre = await this._quotes(list.map((s) => `NSE:${s}`));
    for (const s of list) {
      try {
        const c = await this._compute(s, { full: false, pre });
        if (c.read) {
          this._keep(s, c);
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
    const slot = `${today}|${Math.floor(min / 5)}`;
    if (weekday(today) && min >= OPEN_FROM && min <= OPEN_TO && this._usable() && slot !== this._sweepSlot && now % E.BAR >= 25000) {
      this._sweepSlot = slot;
      await this.sweep();
    }
    if (now - this._scoreAt >= 5 * 60000) {
      this._scoreAt = now;
      await this.score();
    }
    if (this._busy()) return;
    const p = this.pending();
    if (p.learn && weekday(today) && min >= LEARN_FROM && this._dailyAt !== today && !(this.guard && this.guard.wait("evidence-learn", "itself"))) {
      this._dailyAt = today;
      try {
        await this.learnDays({ trigger: "itself" });
      } catch (err) {
        this._dailyAt = "";
      }
    }
    if (p.train && now - this._tryAt >= 30 * 60000 && !(this.guard && this.guard.wait("evidence-train", "itself"))) {
      this._tryAt = now;
      this.train({ trigger: "itself" }).catch(() => {});
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      // one round at a time (a sweep longer than its slot no longer starts a second beside it), and a round stuck for
      // 15 minutes is let go so the service carries on (server/heal.js)
      if (!this._heal) this._heal = guardedTick("evidence", () => this.tickOnce(), { ms: 15 * 60000, log: this.log });
      this._heal.tick();
    }, 30000);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { Evidence, EvidenceError, MODEL, LIVE, CALLS, DAYS, RULE, CHECK_RULE, AI_SYSTEM, AI_SCHEMA };
