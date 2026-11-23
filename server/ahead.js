"use strict";
// The early-call service: says, 5 and 15 minutes BEFORE it happens, whether the move that is on will turn or carry on,
// and whether a large move or a quiet stretch is coming — beside the forecaster's own trend call for the same minutes.
// The arithmetic is in server/market/ahead.js; this learns it, keeps every call, checks it and learns from the check.
//
//   LEARNS    from the same stored sessions as the 15-minute forecaster (every NIFTY 100 stock's 5-minute bars of the
//             last year), through the forecaster's own replay, so both always read the same inputs. The first training
//             holds back the newest quarter of the sessions: half of those unseen rows set the calibration, the other
//             half give the numbers shown.
//   EVERY DAY after the forecaster has learned the day (from 3:45 PM): the day of every NIFTY 100 stock is first CALLED
//             with the model as it stood and checked (fresh unseen evidence, kept per day in ahead_days), then added to
//             the sums and the weights solved again. The calibration and the evidence fade slowly, so they follow the
//             market.
//   LIVE      on every finished 5-minute bar, for the watchlist and the stocks being looked at: the calls are kept
//             (ahead_calls) and, 5 and 15 minutes later, checked against what the price did. Each stock's own
//             correction is learned from those checks (a stock that turns more often than the model says is told so).
//   HONEST    a call is shown beside its usual rate, and is USED (named "raised", "likely" or "low") only while it has
//             beaten "always say the usual rate" on unseen sessions. The screen shows how often a warned reversal
//             really came — which is well under always.
//
// It reads the market. It never trades, places no order, and asks no AI model.

const A = require("./market/ahead");
const H = require("./market/horizon");
const { guardedTick } = require("./heal");

const IST = 5.5 * 3600 * 1000;
const MODEL = "market/ahead-model.json";
const LIVE = "market/ahead-live.json";
const CALLS = "ahead_calls";
const DAYS = "ahead_days";
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9&._ -]{0,24}$/;
const OPEN_FROM = 9 * 60 + 20;
const OPEN_TO = 15 * 60 + 30;
const LEARN_FROM = 15 * 60 + 45; // after the forecaster's own evening learning (3:40 PM)
const KEEP_DAYS = 20;
const HELD_MAX = 60000; // unseen rows kept in memory during a training, per family
const FADE = 0.985; // the calibration and the evidence fade a little with each new session
const CHECKED = [1, 3]; // a kept call is checked 5 and 15 minutes after it was made
const ORDER = CHECKED.flatMap((h) => ["turn", "go", "big", "calm"].map((k) => `${k}${h}`)); // the order of a kept call's numbers
const TIER_CODE = { likely: "l", raised: "r", low: "w", usual: "u" };
const CODE_TIER = { l: "likely", r: "raised", w: "low", u: "usual" };
const OFFSET_K = 40; // a stock's own correction is shrunk until it has many checks
const OFFSET_MAX = 0.08;

const num = (x) => typeof x === "number" && Number.isFinite(x);
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
const iso = (ms) => new Date(ms).toISOString();
const pc = (p) => `${Math.round(p * 100)}%`;
const setOfKind = (kind) => (kind === "turn" || kind === "go" ? A.setOf("run") : A.setOf("all"));

class AheadError extends Error {
  constructor(message, code = "ahead", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const RULE =
  "On every finished 5-minute bar the desk reads the forecaster's inputs turned to face the way the price has just been going — how far it is stretched from VWAP and from its 20-bar mean, whether RSI and volume went with it, whether the last bars closed against it, how many bars in a row it has run, whether it is slowing, how near the day's extreme is, the time of day and the market's own move — and says how likely it is that the move TURNS (gives back at least half a usual move), CARRIES ON (adds at least half a usual move), that a LARGE move comes (a whole usual move or more) or that the price goes QUIET. Each number is the measured frequency on sessions the model had not seen, shown beside the usual rate. A reversal is never certain: read a warning as “more likely than usual”, and look at how often warned reversals really came.";
const CHECK_RULE = "Every call kept is checked 5 and 15 minutes after it was made: a WARNING (raised or likely) counts as right when the thing happened; an UNLIKELY counts as right when it did not. Calls at the usual rate say nothing and are not counted.";

class Ahead {
  /**
   * @param horizon  the 15-minute forecaster (server/horizon.js): replay(), inputs(), storedDates(), ready(), storedTo(),
   *                 pending(), watching(), checkTotals(), barsFor()
   * @param docs     the record store
   */
  constructor({ horizon, docs, guard = null, now = () => Date.now(), log = console }) {
    // automatic training / learning never right after a start, nor again at once after a run the server did not live through
    // (server/train-guard.js); optional: without it, nothing changes
    this.guard = guard;
    this.horizon = horizon;
    this.docs = docs;
    this.now = now;
    this.log = log;
    this.timer = null;
    this._model = null;
    this._curves = null;
    this._liveDoc = null;
    this._map = null;
    this._job = null;
    this._rev = 0;
    this._anchor = new Map(); // symbol → anchor end of the last call kept
    this._cache = new Map(); // symbol → { at, part }
    this._pending = [];
    this._sweepSlot = "";
    this._scoreAt = 0;
    this._dailyAt = "";
    this._tryAt = 0;
    this._tally = null;
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
    return m && m.version === A.MODEL_VERSION && m.forecaster === H.MODEL_VERSION && m.sets && A.SETS.every((s) => m.sets[s.id] && m.sets[s.id].W) ? m : null;
  }
  _saveModel(m) {
    this._rev += 1;
    this._model = m;
    this._curves = null;
    this.docs.write(MODEL, m);
  }
  _live() {
    if (!this._liveDoc) this._liveDoc = this.docs.read(LIVE, null) || { stocks: {}, n: 0 };
    return this._liveDoc;
  }
  /** Changes whenever the model, the record or a learning run does (the live hub compares it). */
  fingerprint() {
    const j = this._job;
    return `${this._rev}|${j ? `${j.kind}|${j.phase}|${Math.floor((j.rows || 0) / 50000)}|${j.finishedAt || ""}` : ""}`;
  }
  jobView() {
    return this._job ? { ...this._job } : null;
  }
  _busy() {
    return Boolean(this._job && !this._job.finishedAt);
  }

  /** The measured frequency of each score bin, per family and outcome (worked out once per model). */
  _curvesOf(m) {
    if (this._curves && this._curves.m === m) return this._curves.v;
    const v = {};
    for (const set of A.SETS) {
      const s = m.sets[set.id];
      v[set.id] = s.W.map((_, k) => (s.cal ? A.calCurve(s.cal.n[k], s.cal.hit[k], s.base[k]) : null));
    }
    this._curves = { m, v };
    return v;
  }

  /* --------------------------------------------------------------------------- training from the whole history */
  /**
   * Learn from every stored session. The newest quarter is held back: half of those rows set the calibration, the other
   * half give the numbers shown; then everything is fitted. One run at a time. Resolves with the summary.
   */
  train({ trigger = "manual" } = {}) {
    if (this._busy()) return Promise.resolve({ busy: true });
    if (!this.horizon.ready()) return Promise.reject(new AheadError("The early calls learn through the 15-minute forecaster, which is not ready yet (it needs the stored NIFTY 100 history, and is trained first).", "not_ready", 409));
    const wait = this.guard ? this.guard.wait("ahead-train", trigger) : "";
    if (wait) return Promise.reject(new AheadError(`Training waits: ${wait}.`, "deferred", 409));
    this._job = { kind: "train", trigger, phase: "reading the stored sessions", rows: 0, startedAt: iso(this.now()), finishedAt: null, error: "" };
    const run = this._train()
      .catch((err) => {
        this._job.error = err.message || String(err);
        this.lastError = this._job.error;
        this.log.error(`[ahead] training failed: ${this._job.error}`);
        throw err;
      })
      .finally(() => {
        this._job.finishedAt = iso(this.now());
        this._rev += 1;
      });
    return this.guard ? this.guard.track("ahead-train", trigger, run) : run;
  }

  async _train() {
    const job = this._job;
    const dates = this.horizon.storedDates();
    if (dates.length < 40) throw new AheadError(`Only ${dates.length} stored sessions: the early calls need at least 40 to learn from.`, "short_history", 409);
    const cut = dates[Math.floor(dates.length * 0.75)];
    const newest = dates[dates.length - 1];
    const mk = () => Object.fromEntries(A.SETS.map((s) => [s.id, new A.Sums(A.targetsOf(s).length)]));
    const train = mk();
    const val = mk();
    const held = { run: [], all: [] };
    const seenHeld = { run: 0, all: 0 };
    // the unseen rows are many (a session of a stock is about 70): keep an even share of them, HELD_MAX per family at most
    const expected = this.horizon.storedStocks() * dates.filter((d) => d > cut).length * 70;
    const STRIDE = { all: Math.max(1, Math.ceil(expected / HELD_MAX)), run: Math.max(1, Math.ceil((expected * 0.45) / HELD_MAX)) };
    job.phase = "learning";
    await this.horizon.replay(
      dates,
      (sym, date, rows) => {
        const items = A.aheadRows(rows);
        const w = A.DECAY_DAY ** H.daysBetween(date, newest);
        const into = date <= cut ? train : val;
        for (const it of items) {
          into.all.add(it.z, it.y.all, w);
          if (it.y.run) into.run.add(it.z, it.y.run, w);
          if (date > cut) {
            for (const id of ["all", "run"]) {
              const y = it.y[id];
              if (!y) continue;
              seenHeld[id] += 1;
              if (seenHeld[id] % STRIDE[id] === 0 && held[id].length < HELD_MAX) held[id].push({ z: Float32Array.from(it.z), y: Uint8Array.from(y) });
            }
          }
        }
        job.rows += items.length;
      },
      { needAll: false }
    );
    job.phase = "measuring it on sessions it has not seen";
    const sets = {};
    const shown = [];
    const pick = (it) => it.y;
    for (const set of A.SETS) {
      const T = A.targetsOf(set).length;
      const Wtrain = A.fit(train[set.id]);
      if (!Wtrain) throw new AheadError("Not enough examples to fit the early calls.", "short_history", 409);
      const base0 = train[set.id].base();
      const choose = held[set.id].filter((_, i) => i % 2 === 0);
      const judge = held[set.id].filter((_, i) => i % 2 === 1);
      // the calibration is set on one half of the unseen rows; the numbers shown come from the other half, which chose nothing
      const cal = A.calAdd(A.emptyCal(T), Wtrain, choose, pick);
      const curves = Wtrain.map((_, k) => A.calCurve(cal.n[k], cal.hit[k], base0[k]));
      const ev = A.evAdd(A.emptyEv(T), { W: Wtrain, base: base0, curves }, judge, pick);
      shown.push(...A.summarise(set, ev));
      // for use from now on: fitted on everything, calibrated on every unseen row
      A.calAdd(cal, Wtrain, judge, pick);
      train[set.id].merge(val[set.id]);
      const W = A.fit(train[set.id]) || Wtrain;
      sets[set.id] = { stats: train[set.id].toJSON(), W, base: train[set.id].base().map(r4), cal, ev, rows: train[set.id].n };
      await new Promise((r) => setImmediate(r));
    }
    job.phase = "saving";
    const model = {
      version: A.MODEL_VERSION,
      forecaster: H.MODEL_VERSION,
      trainedAt: iso(this.now()),
      lastDate: newest,
      sets,
      validation: { from: dates.find((d) => d > cut) || null, to: newest, trainTo: cut, sessions: dates.length, examples: { run: held.run.length, all: held.all.length }, targets: shown },
      learned: { days: 0, lastAt: null, last: null },
    };
    this._saveModel(model);
    this._cache.clear();
    this.lastError = "";
    const t15 = shown.find((x) => x.target === "turn3") || {};
    const b15 = shown.find((x) => x.target === "big3") || {};
    this.log.log(`[ahead] trained on ${sets.all.rows.toLocaleString("en-IN")} bars (${sets.run.rows.toLocaleString("en-IN")} with a move on) from ${dates.length} sessions; unseen, 15 min: a warned reversal came ${t15.saidRate == null ? "—" : pc(t15.saidRate)} (usual ${t15.usual == null ? "—" : pc(t15.usual)}), a called large move ${b15.saidRate == null ? "—" : pc(b15.saidRate)} (usual ${b15.usual == null ? "—" : pc(b15.usual)})`);
    return { rows: sets.all.rows, sessions: dates.length, validation: model.validation };
  }

  /* --------------------------------------------------------------------------- learning each evening */
  /** Every stored session newer than what the model has learned: called and checked with the model as it stood, then learned. */
  learnDays({ trigger = "itself" } = {}) {
    if (this._busy()) return Promise.resolve({ busy: true });
    const m = this._usable();
    if (!m) return Promise.resolve({ skipped: "untrained" });
    if (!this.horizon.ready()) return Promise.resolve({ skipped: "forecaster busy" });
    const wait = this.guard ? this.guard.wait("ahead-learn", trigger) : "";
    if (wait) return Promise.reject(new AheadError(`Learning waits: ${wait}.`, "deferred", 409));
    this._job = { kind: "learn", trigger, phase: "reading the new sessions", rows: 0, startedAt: iso(this.now()), finishedAt: null, error: "" };
    const run = this._learnDays(m)
      .catch((err) => {
        this._job.error = err.message || String(err);
        this.lastError = this._job.error;
        this.log.error(`[ahead] learning failed: ${this._job.error}`);
        throw err;
      })
      .finally(() => {
        this._job.finishedAt = iso(this.now());
        this._rev += 1;
      });
    return this.guard ? this.guard.track("ahead-learn", trigger, run) : run;
  }

  async _learnDays(m) {
    const job = this._job;
    const dates = this.horizon.storedDates().filter((d) => d > m.lastDate);
    if (!dates.length) {
      job.phase = "nothing new";
      return { days: 0 };
    }
    const newest = dates[dates.length - 1];
    const curves = this._curvesOf(m);
    const fade = FADE ** dates.length;
    const gap = A.DECAY_DAY ** Math.max(1, H.daysBetween(m.lastDate, newest));
    const st = {};
    for (const set of A.SETS) {
      const T = A.targetsOf(set).length;
      const s = m.sets[set.id];
      const sums = A.Sums.from(s.stats, T);
      sums.scale(gap);
      st[set.id] = { T, sums, asStood: { W: s.W, base: s.base, curves: curves[set.id] }, cal: A.calScale(s.cal || A.emptyCal(T), fade), ev: A.evScale(s.ev || A.emptyEv(T), fade), day: new Map(dates.map((d) => [d, A.emptyEv(T)])) };
    }
    const counts = new Map(dates.map((d) => [d, 0]));
    job.phase = "calling, checking and learning the new sessions";
    await this.horizon.replay(
      dates,
      (sym, date, rows) => {
        const items = A.aheadRows(rows);
        if (!items.length) return;
        const w = A.DECAY_DAY ** H.daysBetween(date, newest);
        for (const set of A.SETS) {
          const x = st[set.id];
          const list = set.id === "run" ? items.filter((it) => it.y.run) : items;
          const pick = (it) => it.y[set.id];
          // first the calls, with the model as it stood; then the lesson
          A.evAdd(x.day.get(date), x.asStood, list, pick);
          A.calAdd(x.cal, x.asStood.W, list, pick);
          for (const it of list) x.sums.add(it.z, it.y[set.id], w);
        }
        counts.set(date, counts.get(date) + items.length);
        job.rows += items.length;
      },
      { needAll: false }
    );
    job.phase = "saving";
    const dayRecords = [];
    for (const date of dates) {
      if (!counts.get(date)) continue;
      const targets = A.SETS.flatMap((set) => A.summarise(set, st[set.id].day.get(date)));
      dayRecords.push({ id: date, date, at: iso(this.now()), rows: counts.get(date), targets });
    }
    for (const set of A.SETS) {
      const x = st[set.id];
      for (const ev of x.day.values()) A.evMerge(x.ev, ev);
      const W = A.fit(x.sums) || m.sets[set.id].W;
      m.sets[set.id] = { stats: x.sums.toJSON(), W, base: x.sums.base().map(r4), cal: x.cal, ev: x.ev, rows: x.sums.n };
    }
    this.docs.putItems(DAYS, dayRecords);
    m.lastDate = newest;
    m.learned = { days: ((m.learned && m.learned.days) || 0) + dayRecords.length, lastAt: iso(this.now()), last: newest };
    this._saveModel(m);
    this._cache.clear();
    const last = dayRecords[dayRecords.length - 1];
    const t15 = last ? last.targets.find((x) => x.target === "turn3") || {} : {};
    this.log.log(`[ahead] learned ${dayRecords.length} day(s) to ${newest}; on the last one a warned reversal (15 min) came ${t15.saidRate == null ? "—" : pc(t15.saidRate)} of ${t15.said || 0} times (usual ${t15.usual == null ? "—" : pc(t15.usual)})`);
    return { days: dayRecords.length, to: newest };
  }

  /** What is waiting, for the supervisor: a first training, or stored sessions not learned yet. */
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
    // after the forecaster: it trains first, and learns the day first
    const clear = ready && !fp.train && !fp.learn;
    return { busy, train: !m && clear && Boolean(to), learn: Boolean(m && clear && to && to > m.lastDate), to: to || null, lastDate: m ? m.lastDate : null };
  }

  /* --------------------------------------------------------------------------- the calls for now */
  /** A stock's own correction for one outcome, learned from its checked calls (0 until there are some). */
  _offset(symbol, name) {
    const s = (this._live().stocks || {})[symbol];
    const r = s && s[name];
    if (!r || !r.n) return 0;
    return Math.max(-OFFSET_MAX, Math.min(OFFSET_MAX, (r.sy - r.sp) / (r.n + OFFSET_K)));
  }

  /** @returns { reason, closed } or the raw pieces of the calls for a stock */
  async _compute(symbol) {
    const m = this._usable();
    if (!m) return { reason: this._busy() ? "The early calls are learning from the stored sessions; they are ready in a few minutes." : "The early calls have not learned yet. They learn from the same stored NIFTY 100 history as the 15-minute forecaster, right after it." };
    const r = await this.horizon.inputs(symbol);
    if (!r || !r.fc || !r.rows || !r.rows.length) return { reason: (r && r.reason) || "No finished 5-minute bar to read yet.", closed: Boolean(r && r.closed) };
    const items = A.aheadRows(r.rows, { labels: false });
    const it = items[items.length - 1];
    if (!it || it.t + A.BAR !== r.fc.anchor.end) return { reason: "The early calls could not be made from today's bars." };
    const curves = this._curvesOf(m);
    const left = H.closeOf(r.ctx) - 1 - it.s; // bars of continuous trading left (it ends at 3:15 PM in a closing-auction stock)
    const calls = {}; // name → { p, usual, tier, proven, raw, off }
    for (const set of A.SETS) {
      if (set.id === "run" && !it.run) continue;
      const s = m.sets[set.id];
      A.targetsOf(set).forEach((name, k) => {
        const h = A.AHEAD[Math.floor(k / set.kinds.length)];
        if (h > left) return;
        const raw = A.rawOf(s.W[k], it.z);
        const p0 = A.probOf(raw, curves[set.id][k], s.base[k]);
        const off = this._offset(symbol, name);
        const p = Math.max(0.01, Math.min(0.99, p0 + off));
        const proven = Boolean(s.ev && A.provenOf(s.ev, k));
        calls[name] = { p: r4(p), usual: r4(s.base[k]), tier: proven ? A.tierOf(p, s.base[k]) : "usual", proven, off: r4(off), k, set: set.id };
      });
    }
    return { m, it, calls, fc: r.fc, now: this.now(), left };
  }

  _whyFor(m, it, name) {
    const set = setOfKind(name.replace(/\d+$/, ""));
    const k = A.targetsOf(set).indexOf(name);
    return k < 0 ? [] : A.whyOf(m.sets[set.id].W[k], it.z);
  }

  /** One horizon of the screen: the forecaster's trend call beside the early calls, and one line that reads them together. */
  _horizonView(c, key, h, head) {
    const { calls, it, m } = c;
    const at = it.t + A.BAR + h * A.BAR;
    // the words count from NOW (the bar the call was made from closed a few minutes ago): "within the next 7 minutes"
    const minutes = Math.max(1, Math.round((at - c.now) / 60000));
    const get = (kind) => {
      const x = calls[`${kind}${h}`];
      return x ? { p: x.p, usual: x.usual, tier: x.tier, proven: x.proven } : null;
    };
    const turn = get("turn");
    const go = get("go");
    const big = get("big");
    const calm = get("calm");
    const call = H.callOf(head);
    const trend = head ? { word: call.word, side: call.side, p: call.p, grade: call.grade, pct: head.pct, price: head.price, low: head.low, high: head.high } : null;
    const warn = (x) => x && (x.tier === "raised" || x.tier === "likely");
    const state = warn(big) && (!warn(calm) || big.p - big.usual >= calm.p - calm.usual) ? "building" : warn(calm) ? "fading" : "steady";
    const dirWord = it.d > 0 ? "up" : "down";
    let read;
    let tone = "none";
    if (it.run) {
      if (warn(turn)) {
        read = `The ${dirWord}-move is at risk of turning within ${minutes} minutes: ${pc(turn.p)} against a usual ${pc(turn.usual)}.`;
        tone = "warn";
      } else if (warn(go)) {
        read = `The ${dirWord}-move is more likely than usual to carry on for ${minutes} minutes: ${pc(go.p)} against a usual ${pc(go.usual)}.`;
        tone = dirWord;
      } else if (turn && turn.tier === "low") {
        read = `The ${dirWord}-move looks intact: a turn within ${minutes} minutes is less likely than usual (${pc(turn.p)} against ${pc(turn.usual)}).`;
        tone = dirWord;
      } else read = `A ${dirWord}-move is on; nothing says it will turn or carry on more than usual in the next ${minutes} minutes.`;
    } else if (state === "building") {
      read = `No move is on yet, but a larger one is more likely than usual within ${minutes} minutes (${pc(big.p)} against ${pc(big.usual)})${trend && trend.side ? `; the trend call leans ${trend.side}` : ""}.`;
      tone = "alert";
    } else if (state === "fading") {
      read = `Little movement is expected in the next ${minutes} minutes (quiet ${pc(calm.p)} against a usual ${pc(calm.usual)}).`;
      tone = "quiet";
    } else read = `Nothing unusual ahead in the next ${minutes} minutes.`;
    if (it.run && state !== "steady") read += state === "building" ? " Momentum is building." : " Momentum is fading.";
    return {
      key,
      h,
      minutes: h * 5,
      minutesAhead: minutes,
      at: iso(at),
      trend,
      reversal: turn,
      follow: go,
      momentum: { state, big, calm },
      read,
      tone,
      why: { reversal: turn ? this._whyFor(m, it, `turn${h}`) : [], momentum: this._whyFor(m, it, `${state === "fading" ? "calm" : "big"}${h}`) },
    };
  }

  /** The early calls for one stock, with their record: what the Desk and Research show. Keeps the call when the bar is new. */
  async view(symbol) {
    if (!SYMBOL_RE.test(symbol)) throw new AheadError("That is not a valid symbol.", "invalid");
    const now = this.now();
    const m = this._usable();
    const base = this._baseView(symbol, m);
    const hit = this._cache.get(symbol);
    if (hit && now - hit.at < 15000) return { ...base, ...hit.part };
    let part;
    try {
      const c = await this._compute(symbol);
      if (!c.it) part = { available: false, reason: c.reason, closed: Boolean(c.closed) };
      else {
        this._keep(symbol, c);
        this._flush();
        const end = c.it.t + A.BAR;
        const pickH = (lead) => A.AHEAD.find((h) => h <= c.left && end + h * A.BAR >= now + lead * 60000 - 1000) || null;
        const h5 = pickH(2.5);
        const h15 = pickH(15);
        const horizons = [];
        if (h5) horizons.push(this._horizonView(c, "5", h5, H.headline(c.fc, now, 2.5)));
        if (h15) horizons.push(this._horizonView(c, "15", h15, H.headline(c.fc, now)));
        part = {
          available: horizons.length > 0,
          reason: horizons.length ? "" : "The session is too close to its end for a call.",
          closed: false,
          asOf: iso(now),
          anchor: { at: iso(end), price: c.it.price },
          move: { dir: c.it.d > 0 ? "up" : "down", on: c.it.run, bars: c.it.streak, pct15: r4(c.it.r3 * c.it.sigma * 100), usual15Pct: r4(c.it.sigma * Math.sqrt(3) * 100) },
          horizons,
        };
      }
    } catch (err) {
      part = { available: false, reason: err.message || "The early calls could not be made." };
    }
    this._cache.set(symbol, { at: now, part });
    if (this._cache.size > 80) this._cache.clear();
    return { ...base, ...part };
  }

  /** The part of a view that does not need the market: the record and what has been learned. */
  _baseView(symbol, m) {
    const mine = [...this._recs().values()].filter((r) => r.symbol === symbol && r.settled).sort((a, b) => b.anchorEnd - a.anchorEnd);
    let trendChecks = null;
    try {
      trendChecks = this.horizon.checkTotals();
    } catch (_) {
      trendChecks = null;
    }
    return {
      symbol,
      trained: Boolean(m),
      record: { own: this._tallyOf(mine), all: this._tallyAll(), trend: trendChecks, last: mine.slice(0, 8).map((r) => this._row(r)) },
      learning: this._learning(m),
      rule: RULE,
      checkRule: CHECK_RULE,
    };
  }

  _learning(m) {
    if (!m) return { trained: false, job: this.jobView() };
    const targets = A.SETS.flatMap((set) => A.summarise(set, m.sets[set.id].ev || A.emptyEv(A.targetsOf(set).length)));
    return {
      trained: true,
      trainedAt: m.trainedAt,
      lastDate: m.lastDate,
      rows: { all: m.sets.all.rows, run: m.sets.run.rows },
      days: (m.learned && m.learned.days) || 0,
      lastAt: (m.learned && m.learned.lastAt) || null,
      // the running evidence on unseen sessions (the first training's held-back half, then every evening's day)
      targets: targets.filter((t) => t.h === 1 || t.h === 3),
      validation: m.validation ? { from: m.validation.from, to: m.validation.to, sessions: m.validation.sessions } : null,
      job: this.jobView(),
    };
  }

  /* --------------------------------------------------------------------------- keeping and checking the calls */
  _keep(symbol, c) {
    const end = c.it.t + A.BAR;
    if (this._anchor.get(symbol) === end) return;
    this._anchor.set(symbol, end);
    const date = istDate(c.now);
    const id = `${date}|${symbol}|${end}`;
    if (this._recs().has(id)) return;
    const p = [];
    const u = [];
    const o = [];
    let t = "";
    for (const name of ORDER) {
      const x = c.calls[name];
      p.push(x ? x.p : null);
      u.push(x ? x.usual : null);
      o.push(x ? x.off : 0);
      t += x ? TIER_CODE[x.tier] : "-";
    }
    const rec = { id, date, symbol, anchorEnd: end, madeAt: iso(c.now), price: c.it.price, sigma: c.it.sigma, d: c.it.d, run: c.it.run, p, u, t, settled: false, actual: null };
    if (o.some((v) => v)) rec.o = o;
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

  /** The statements a kept call made at one horizon, with what happened: [{ kind, said: "warned"|"unlikely", p, usual, happened, ok }]. */
  _statements(r, h) {
    const a = (r.actual || {})[h];
    const out = [];
    const base = CHECKED.indexOf(h) * 4;
    if (base < 0) return out;
    ["turn", "go", "big", "calm"].forEach((kind, i) => {
      const tier = CODE_TIER[(r.t || "")[base + i]];
      if (!tier || tier === "usual") return;
      const said = tier === "low" ? "unlikely" : "warned";
      const happened = a ? Boolean(a[kind]) : null;
      out.push({ kind, said, tier, p: r.p[base + i], usual: r.u[base + i], happened, ok: happened === null ? null : said === "warned" ? happened : !happened });
    });
    return out;
  }

  _row(r) {
    const a = r.actual || {};
    return { at: iso(r.anchorEnd), price: r.price, dir: r.d > 0 ? "up" : "down", run: Boolean(r.run), move5: a[1] ? a[1].pct : null, move15: a[3] ? a[3].pct : null, c5: this._statements(r, 1), c15: this._statements(r, 3) };
  }

  /** Totals of the checked statements: per horizon and kind — how many were warned and how many of those happened; the same for "unlikely". */
  _tallyOf(recs) {
    const mk = () => ({ said: 0, came: 0, low: 0, lowCame: 0, usual: 0, n: 0 });
    const v = { 5: { turn: mk(), go: mk(), big: mk(), calm: mk() }, 15: { turn: mk(), go: mk(), big: mk(), calm: mk() }, calls: 0 };
    for (const r of recs) {
      if (!r.settled || !r.actual) continue;
      v.calls += 1;
      for (const h of CHECKED) {
        const key = h === 1 ? 5 : 15;
        for (const s of this._statements(r, h)) {
          if (s.happened === null) continue;
          const x = v[key][s.kind];
          x.n += 1;
          x.usual += s.usual || 0;
          if (s.said === "warned") {
            x.said += 1;
            if (s.happened) x.came += 1;
          } else {
            x.low += 1;
            if (s.happened) x.lowCame += 1;
          }
        }
      }
    }
    for (const key of [5, 15]) for (const x of Object.values(v[key])) x.usual = x.n ? r4(x.usual / x.n) : null;
    return v;
  }

  _tallyAll() {
    if (this._tally && this._tally.rev === this._rev) return this._tally.v;
    const v = this._tallyOf([...this._recs().values()]);
    this._tally = { rev: this._rev, v };
    return v;
  }

  /** Check the kept calls whose 15 minutes have passed, and learn each stock's own correction from them. */
  async score() {
    const now = this.now();
    const due = [...this._recs().values()].filter((r) => !r.settled && !r.void && now >= r.anchorEnd + 3 * A.BAR + 20000);
    if (!due.length) return 0;
    const bySym = new Map();
    for (const r of due) (bySym.get(`${r.symbol}|${r.date}`) || bySym.set(`${r.symbol}|${r.date}`, []).get(`${r.symbol}|${r.date}`)).push(r);
    const today = istDate(now);
    const just = [];
    for (const list of bySym.values()) {
      const { symbol, date } = list[0];
      let bars = null;
      try {
        bars = await this.horizon.barsFor(symbol, date);
      } catch (_) {
        bars = null;
      }
      for (const r of list) {
        if (!bars || !bars.length) {
          if (date < today && now - r.anchorEnd > 3 * 86400000) {
            r.void = true;
            this._pending.push(r);
          }
          continue;
        }
        const all = A.settle(r, bars);
        // a call made in the session's last minutes may have no bar 15 minutes on: it is checked on what there is
        if (!all[1] && !all[3]) {
          if (date < today) {
            r.void = true;
            this._pending.push(r);
          }
          continue;
        }
        if (!all[3] && date === today && minuteOfDay(now) < OPEN_TO + 10) continue; // its 15 minutes are not over yet
        r.actual = {};
        for (const h of CHECKED) if (all[h]) r.actual[h] = all[h];
        r.settled = true;
        this._pending.push(r);
        just.push(r);
      }
    }
    if (just.length) {
      this._rev += 1;
      this._learnLive(just);
      const warned = just.flatMap((r) => this._statements(r, 3)).filter((s) => s.kind === "turn" && s.said === "warned");
      this.log.log(`[ahead] ${just.length} calls checked${warned.length ? ` (${warned.filter((s) => s.happened).length} of ${warned.length} warned reversals came within 15 minutes)` : ""}`);
    }
    this._prune();
    this._flush();
    return just.length;
  }

  /** Each stock's own correction: how much more (or less) often a thing happened to it than the calls said. */
  _learnLive(just) {
    const live = this._live();
    live.stocks = live.stocks || {};
    for (const r of just) {
      const s = live.stocks[r.symbol] || (live.stocks[r.symbol] = {});
      ORDER.forEach((name, i) => {
        if (!num(r.p[i])) return;
        const h = Number(name.slice(-1));
        const a = (r.actual || {})[h];
        if (!a) return;
        const kind = name.slice(0, -1);
        const rec = s[name] || (s[name] = { n: 0, sy: 0, sp: 0 });
        rec.n += 1;
        rec.sy += a[kind] ? 1 : 0;
        rec.sp += r.p[i] - ((r.o && r.o[i]) || 0); // against the call before the stock's own correction
        if (rec.n > 2000) {
          rec.n /= 2;
          rec.sy /= 2;
          rec.sp /= 2;
        }
      });
    }
    live.n = (live.n || 0) + just.length;
    live.at = iso(this.now());
    this.docs.write(LIVE, live);
  }

  _prune() {
    const cut = istDate(this.now() - KEEP_DAYS * 86400000);
    const old = [...this._recs().values()].filter((r) => r.date < cut).map((r) => r.id);
    if (old.length) {
      old.forEach((id) => this._recs().delete(id));
      this.docs.removeItems(CALLS, old);
      this._rev += 1;
    }
  }

  /* --------------------------------------------------------------------------- the board */
  board() {
    const m = this._usable();
    const days = this.docs.items(DAYS).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 30);
    const pickT = (d, name) => d.targets.find((t) => t.target === name) || null;
    return {
      trained: Boolean(m),
      learning: this._learning(m),
      validation: m && m.validation ? m.validation : null,
      days: days.map((d) => ({ date: d.date, rows: d.rows, turn15: pickT(d, "turn3"), go15: pickT(d, "go3"), big15: pickT(d, "big3"), calm15: pickT(d, "calm3"), turn5: pickT(d, "turn1"), big5: pickT(d, "big1") })),
      live: this._tallyAll(),
      trend: (() => {
        try {
          return this.horizon.checkTotals();
        } catch (_) {
          return null;
        }
      })(),
      job: this.jobView(),
      error: this.lastError,
      rule: RULE,
      checkRule: CHECK_RULE,
    };
  }

  /* --------------------------------------------------------------------------- the clock */
  /** One set of calls per followed stock per finished bar: each is kept, so each is checked and taught from. */
  async sweep() {
    let made = 0;
    for (const s of this.horizon.watching()) {
      try {
        const c = await this._compute(s);
        if (c.it) {
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
    if (weekday(today) && min >= OPEN_FROM && min <= OPEN_TO && this._usable() && slot !== this._sweepSlot && now % A.BAR >= 20000) {
      this._sweepSlot = slot;
      await this.sweep();
    }
    if (now - this._scoreAt >= 5 * 60000) {
      this._scoreAt = now;
      await this.score();
    }
    if (this._busy()) return;
    const p = this.pending();
    // the evening: once the forecaster has learned the day, the day is called, checked and learned here too
    if (p.learn && weekday(today) && min >= LEARN_FROM && this._dailyAt !== today && !(this.guard && this.guard.wait("ahead-learn", "itself"))) {
      this._dailyAt = today;
      try {
        await this.learnDays({ trigger: "itself" });
      } catch (err) {
        this._dailyAt = "";
      }
    }
    // never trained (or its inputs changed): as soon as the forecaster is ready
    if (p.train && now - this._tryAt >= 30 * 60000 && !(this.guard && this.guard.wait("ahead-train", "itself"))) {
      this._tryAt = now;
      this.train({ trigger: "itself" }).catch(() => {});
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      // one round at a time (a sweep longer than its slot no longer starts a second beside it), and a round stuck for
      // 15 minutes is let go so the service carries on (server/heal.js)
      if (!this._heal) this._heal = guardedTick("ahead", () => this.tickOnce(), { ms: 15 * 60000, log: this.log });
      this._heal.tick();
    }, 30000);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { Ahead, AheadError, MODEL, LIVE, CALLS, DAYS, RULE, CHECK_RULE };
