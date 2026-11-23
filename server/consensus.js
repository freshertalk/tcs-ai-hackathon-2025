"use strict";
// The consensus forecast, as a service: one level forecast for the next 5 and 15 minutes for any stock — the price, the
// band, the chance of a rise and the level likely to be touched first — made from the desk's three forecasters (the
// 15-minute forecaster, the evidence desk, the early calls) and the live order book, by a blend that learns from its own
// checked forecasts how much each deserves. The arithmetic is in market/consensus.js.
//
//   NOW        for a stock (the Desk, Research, TradeAI ask): the three are read (each keeps its own short cache), the
//              blend's forecast is worked out, and the forecast is KEPT (one per stock per 5-minute bar).
//   SWEEP      every 5-minute bar in the session, the stocks followed live (the watchlist and those looked at in the last
//              three hours — the forecaster's own list) are forecast the same way, so the blend has enough checks to
//              learn from. It reads only the desk's arithmetic: no AI model is ever asked (the evidence desk's AI read
//              happens only when a stock is opened, and never from here).
//   CHECKING   every forecast is checked 5 and 15 minutes after its bar against the 5-minute bars, the blend learns, and
//              the blend AND the forecaster alone are scored on the same forecast. The blend leads only once its record
//              proves it misses less (market/consensus.js PROOF); until then the forecaster's own numbers lead.
//
// Nothing here can place, change or cancel an order.

const C = require("./market/consensus");
const H = require("./market/horizon");
const R = require("./market/refine");
const V = require("./market/volmodel"); // volatility from several days of history (22 Nov 2026)
const VOL_MODEL = "market/vol-model.json"; // the refiner (22 Nov 2026): the top of the book, today's volatility, conformal bands, the off-form alarm

const IST = 5.5 * 3600 * 1000;
const MODEL = "market/consensus-model.json";
const CALLS = "consensus_calls";
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9&._ -]{0,24}$/;
const BAR = 5 * 60000;
const OPEN_FROM = 9 * 60 + 20;
const OPEN_TO = 15 * 60 + 15;
const KEEP_DAYS = 10; // forecasts kept (they sit in memory with the record store; the model itself learns as it goes)
const SWEEP_MAX = 30;
const SECTION = "## The consensus forecast (5 and 15 minutes)";

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const r4 = (x) => (num(x) ? Math.round(x * 10000) / 10000 : null);
const iso = (ms) => new Date(ms).toISOString();
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const minuteOfDay = (ms) => {
  const d = new Date(ms + IST);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const weekday = (date) => {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
};
const pc = (p) => `${Math.round(p * 100)}%`;
const tick = () => new Promise((r) => setImmediate(r));

const RULE =
  "The consensus forecast blends the desk's three forecasters — the 15-minute forecaster's expected move, the evidence desk's chance of a rise against a fall, and the early calls' carry-on and turn chances — with the live order book's buy and sell quantities. The blend starts as the forecaster alone and moves weight to the others only as far as its own checked forecasts justify (ridge regression, old checks fading slowly). The band is the forecaster's, scaled by how the blend misses against it and by the momentum reading.";
const CHECK_RULE = "Every forecast is checked 5 and 15 minutes after its bar against the bar's close: the miss (in the stock's usual moves) and whether the direction was right, for the blend and for the forecaster alone on the same forecast. The blend's numbers lead only after 150 checks over 5 sessions that show it missing at least 2% less without calling the direction worse.";

class ConsensusError extends Error {
  constructor(message, code = "consensus", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class Consensus {
  /**
   * @param horizon   the 15-minute forecaster (view, barsFor, watching)
   * @param evidence  the evidence desk (view) — optional
   * @param ahead     the early calls (view) — optional
   * @param market    the MarketService (quotes, mode) — reads only
   */
  constructor({ horizon, evidence = null, ahead = null, market, docs, playbook = null, now = () => Date.now(), log = console, isTradingDay = weekday }) {
    this.playbook = playbook; // the trading-skills file every AI feature reads: the blend writes its rules and record into it
    this.horizon = horizon;
    this.evidence = evidence;
    this.ahead = ahead;
    this.market = market;
    this.docs = docs;
    this.now = now;
    this.log = log;
    this.isTradingDay = isTradingDay;
    this._model = null;
    this._vol = undefined;
    this._map = null;
    this._pending = [];
    this._cache = new Map();
    this._slot = "";
    this._busy = null;
    this.timer = null;
    this.lastError = "";
  }

  /* --------------------------------------------------------------------------- the records */
  model() {
    if (!this._model) {
      const m = this.docs.read(MODEL, null);
      this._model = m && m.version === 1 && m.h ? m : C.emptyModel();
    }
    if (!this._model.refine || !this._model.refine.h) this._model.refine = R.emptyModel(); // added beside the blend, in the same file
    return this._model;
  }
  _saveModel() {
    this.docs.write(MODEL, this.model());
  }
  /** The multi-day volatility model (refitted every evening from the stored history), or null. */
  volModel() {
    if (this._vol === undefined) {
      const v = this.docs.read(VOL_MODEL, null);
      this._vol = v && v.version === 1 && v.forecasts ? v : null;
    }
    return this._vol;
  }
  /** Fit the multi-day volatility model from the stored 5-minute history, one stock at a time. */
  async refreshVol() {
    const h = this.horizon;
    if (typeof h.storedSymbols !== "function" || typeof h.storedSessions !== "function") return null;
    const sums = {};
    for (const sym of h.storedSymbols() || []) {
      try {
        const days = (h.storedSessions(sym) || []).slice(-260).map(([date, raw]) => [date, H.cleanBars(raw)]);
        if (days.length >= 30) sums[sym] = V.summarizeStock(days);
      } catch (_) {
        /* the next stock */
      }
      await tick();
    }
    const m = V.fitVolModel(sums);
    if (!m) return null;
    m.fittedAt = iso(this.now());
    m.fittedOn = istDate(this.now());
    this.docs.write(VOL_MODEL, m);
    this._vol = m;
    this._cache.clear();
    this.log.log(`[consensus] multi-day volatility: ${m.stocks} stocks, ${m.sessions} sessions; on unseen sessions it misses ${m.judge.har} against ${m.judge.usual} for "the usual" and ${m.judge.yesterday} for "same as yesterday" (log variance)`);
    return m;
  }
  _recs() {
    if (!this._map) this._map = new Map((typeof this.docs.items === "function" ? this.docs.items(CALLS) : []).map((r) => [r.id, r]));
    return this._map;
  }
  _flush() {
    if (!this._pending.length) return;
    const list = this._pending.splice(0);
    if (typeof this.docs.putItems === "function") this.docs.putItems(CALLS, list);
  }
  _connected() {
    return typeof this.market.mode === "function" ? this.market.mode() === "kite" : true;
  }

  /* --------------------------------------------------------------------------- one stock now */
  async _read(symbol) {
    const safe = async (fn) => {
      try {
        return await fn();
      } catch (_) {
        return null;
      }
    };
    const hv = await safe(() => this.horizon.view(symbol));
    if (!hv || !hv.available) return { hv, reason: (hv && hv.reason) || "The 15-minute forecaster has no reading for this stock now." };
    const [ev, av, q, bars] = await Promise.all([
      this.evidence ? safe(() => this.evidence.view(symbol, { full: false })) : null,
      this.ahead ? safe(() => this.ahead.view(symbol)) : null,
      safe(async () => {
        const r = await this.market.quotes([symbol]);
        return (r && r.quotes && r.quotes[symbol]) || null;
      }),
      // today's finished 5-minute bars (the forecaster keeps them): the refiner's measure of today's volatility
      typeof this.horizon.barsFor === "function" ? safe(async () => H.cleanBars(await this.horizon.barsFor(symbol, istDate(this.now())))) : null,
    ]);
    return { hv, ev: ev && ev.available ? ev : null, av: av && av.available ? av : null, q, bars };
  }

  /** The forecast for one stock now (and keep it). */
  async view(symbol) {
    if (!SYMBOL_RE.test(symbol)) throw new ConsensusError("That is not a valid symbol.", "invalid");
    const now = this.now();
    const hit = this._cache.get(symbol);
    if (hit && now - hit.at < 10000) return hit.view;
    const base = { symbol, rule: RULE, checkRule: CHECK_RULE, record: this.record(), asOf: iso(now) };
    let out;
    try {
      const r = await this._read(symbol);
      out = r.hv && r.hv.available ? { ...base, ...this._build(symbol, r, now) } : { ...base, available: false, reason: r.reason, closed: Boolean(r.hv && r.hv.closed) };
    } catch (err) {
      out = { ...base, available: false, reason: err.message || "The consensus forecast could not be made." };
    }
    this._cache.set(symbol, { at: now, view: out });
    if (this._cache.size > 80) this._cache.clear();
    return out;
  }

  _build(symbol, { hv, ev, av, q, bars = null }, now) {
    const model = this.model();
    const today = istDate(now);
    const anchorEnd = Date.parse(hv.anchor.at);
    const price = hv.anchor.price;
    const sigmaPct = hv.sigmaPct;
    const byMin = new Map((hv.horizons || []).map((x) => [x.minutes, x]));
    const evCall = (minutes) => (ev && Array.isArray(ev.calls) ? ev.calls.find((c) => c.minutes === minutes) || ev.calls.find((c) => c.minutes === (minutes <= 5 ? 5 : 15)) || null : null);
    const earlyFor = (key) => {
      if (!av || !Array.isArray(av.horizons)) return null;
      const x = av.horizons.find((y) => y.key === key);
      if (!x) return null;
      return { run: Boolean(av.move && av.move.on), dir: av.move ? (av.move.dir === "up" ? 1 : -1) : 0, follow: x.follow, reversal: x.reversal, momentum: x.momentum, read: x.read, tone: x.tone };
    };
    const book = q && num(q.buyQty) && num(q.sellQty) ? { buyQty: q.buyQty, sellQty: q.sellQty } : null;
    const horizons = [];
    const keepX = {};
    const keepZ = {};
    const keepR = {};
    // the refiner's view of today: realized volatility against the usual (from bars finished before the forecast's own bar)
    const doneBars = Array.isArray(bars) ? bars.filter((b) => num(b.t) && b.t < anchorEnd) : null;
    const ratio = R.volRatio(doneBars, sigmaPct);
    const scale = R.scaleOf(ratio);
    // …and from several days of history: the stock's forecast volatility for today, updated by today's bars (market/volmodel.js)
    const vm = this.volModel();
    const prior = vm ? V.priorFor(vm, symbol, today) : null;
    const anchorSlot = H.slotOf(anchorEnd - BAR);
    const multiFor = (h) => (vm && prior !== null ? V.scaleFor({ prior, season: vm.season, bars: doneBars || [], sigmaPct, slot: anchorSlot, h }) : null);
    let multiNow = null;
    // the trade setup (server/setup.js): this stock's futures build-up now and the market's setup lean — refiner inputs
    let tags = null;
    let leanNow = 0;
    if (this.setup) {
      try {
        tags = this.setup.forStock(symbol);
        leanNow = this.setup.leanNow();
      } catch (_) {
        tags = null;
      }
    }
    const round05 = (p) => Math.round(p * 20) / 20;
    let topOfBook = null;
    for (const [key, lead] of [["5", 2.5], ["15", 15]]) {
      // the same choice of bar as the forecaster's own headline: the first bar end at least `lead` minutes from now
      const pick = (hv.horizons || []).find((x) => Date.parse(x.at) >= now + lead * 60000 - 1000);
      if (!pick) continue;
      const h = Math.round(pick.minutes / 5);
      const evc = evCall(pick.minutes);
      const early = earlyFor(key);
      const x = C.inputsOf({ hz: pick, sigmaPct, h, ev: evc, early, book });
      if (!x) continue;
      const mh = model.h[h] ? h : h <= 2 ? 1 : 3; // horizons between are read with the nearer model
      const f = C.forecastOf(model, mh, x, { price, sigmaPct, hz: pick, volMult: C.volMultOf(early) });
      const lead_ = f.proven ? f.blend : f.solo;
      // THE REFINER: a second stage on the leading forecast; its centre or its band replaces the consensus's only once proven
      const sH = sigmaPct * Math.sqrt(h);
      const zl = num(f.proven ? f.blend.z : f.solo.z) ? (f.proven ? f.blend.z : f.solo.z) : num(lead_.pct) ? lead_.pct / sH : 0;
      const ho = num(lead_.high) && num(lead_.low) && price > 0 ? ((lead_.high - lead_.low) / 2 / price) * 100 / sH : null;
      const ri = R.inputsOf({ q, price, s: sH, zl, ratio, buildup: tags ? tags.score : 0, setupLean: leanNow });
      const mv = multiFor(h);
      if (mv && h === 3) multiNow = mv;
      if (mv && !multiNow) multiNow = mv;
      const rf = ri ? R.forecastOf(model.refine, mh, { x: ri.x, zl, ho, scale, scale2: mv ? mv.scale : null, date: today }) : null;
      if (ri && ri.top) topOfBook = ri.top;
      let shown = { price: lead_.price, low: lead_.low, high: lead_.high, pct: lead_.pct, pUp: lead_.pUp };
      if (rf && (rf.leads.mean || rf.leads.band)) {
        const pc_ = rf.zShown * sH;
        const half = rf.half * sH;
        shown = { price: round05(price * (1 + pc_ / 100)), low: round05(price * (1 + (pc_ - half) / 100)), high: round05(price * (1 + (pc_ + half) / 100)), pct: r4(pc_), pUp: rf.pUp };
      }
      const pUp = shown.pUp;
      const side = pUp >= 0.5 ? "up" : "down";
      const p = Math.max(pUp, 1 - pUp);
      let tier = p >= 0.7 ? "strong" : p >= 0.6 ? "clear" : p >= 0.54 ? "slight" : "none";
      if (rf && rf.offForm && (tier === "strong" || tier === "clear")) tier = "slight"; // an off-form session: no confident leans
      horizons.push({
        key,
        minutes: pick.minutes,
        minutesAhead: Math.max(1, Math.round((Date.parse(pick.at) - now) / 60000)),
        at: pick.at,
        h,
        price: shown.price,
        low: shown.low,
        high: shown.high,
        pct: shown.pct,
        pUp,
        lean: tier === "none" ? "none" : side,
        tier,
        leads: f.proven ? "blend" : "forecaster",
        blend: f.blend,
        forecaster: f.solo,
        parts: {
          evidence: evc ? { lean: evc.lean, tier: evc.tier, pUp: evc.pUp, pDown: evc.pDown } : null,
          early: early ? { read: early.read, tone: early.tone } : null,
          book: book ? { buyQty: book.buyQty, sellQty: book.sellQty, buyShare: r4(book.buyQty / (book.buyQty + book.sellQty)) } : null,
        },
        contributions: f.contributions,
        record: C.summaryOf(model.h[mh].stats),
        refined: Boolean(rf && (rf.leads.mean || rf.leads.band)),
        refine: rf
          ? {
              leads: rf.leads,
              offForm: rf.offForm,
              price: round05(price * (1 + (rf.zr * sH) / 100)),
              pct: r4(rf.zr * sH),
              conformal: (() => {
                const hc = rf.leads.band ? rf.half : num(rf.halfMulti) ? rf.halfMulti : rf.halfConformal;
                return num(hc) ? { low: round05(price * (1 + ((rf.zShown - hc) * sH) / 100)), high: round05(price * (1 + ((rf.zShown + hc) * sH) / 100)), by: rf.leads.bandBy || (num(rf.halfMulti) ? "multi" : "today") } : null;
              })(),
              contributions: rf.contributions.map((c) => ({ ...c, adds: r4(c.adds * sH) })), // `adds`: percent of price
              record: R.summaryOf(R.horizonOf(model.refine, mh), today),
            }
          : null,
      });
      keepX[h] = x;
      keepZ[h] = [f.blend.z, f.solo.z];
      if (ri && rf) keepR[h] = { x: ri.x, zl: r4(zl), zr: rf.zr, zs: rf.zShown, scale: r4(scale), hc: rf.halfConformal, ho: r4(ho), ...(mv ? { scale2: mv.scale, hc2: rf.halfMulti } : {}) };
    }
    if (!horizons.length) return { available: false, reason: "The session is too close to its end for a forecast." };
    this._keep(symbol, { anchorEnd, price, sigmaPct, x: keepX, z: keepZ, rf: keepR });
    // the levels: the forecaster's chances of touching each within 15 and 30 minutes; the likeliest above and below
    const levels = (hv.levels || []).filter((l) => num(l.price)).map((l) => ({ name: l.name, price: l.price, side: l.side, distPct: l.distPct, p15: l.p15 ?? null, p30: l.p30 ?? null }));
    const firstOf = (side) => levels.filter((l) => l.side === side && num(l.p15)).sort((a, b) => b.p15 - a.p15)[0] || null;
    const h15 = horizons.find((x) => x.key === "15") || horizons[horizons.length - 1];
    return {
      available: true,
      anchor: hv.anchor,
      sigmaPct,
      horizons,
      levels: levels.slice(0, 12),
      firstUp: firstOf("above"),
      firstDown: firstOf("below"),
      headline: this._headline(symbol, h15, price),
      // the refiner's readings of now: today's volatility against the usual, and the top of the order book (microprice)
      volatility:
        ratio === null && prior === null
          ? null
          : {
              ratio,
              scale: r4(scale),
              read: ratio === null ? "too few bars yet today" : ratio >= 1.8 ? "a wild session: moves about " + Math.round(Math.sqrt(ratio) * 10) / 10 + "× the usual" : ratio <= 0.55 ? "a quiet session: moves well below the usual" : "an ordinary session",
              // from several days of history: what the last days forecast for today, and that updated by today's bars
              expected: prior,
              day: multiNow ? multiNow.day : null,
              share: multiNow ? multiNow.share : null,
              outlook: prior === null ? null : prior >= 1.4 ? `the last days point to a wilder session than usual (about ${Math.round(Math.sqrt(prior) * 10) / 10}× the usual move)` : prior <= 0.7 ? "the last days point to a calmer session than usual" : "the last days point to an ordinary session",
            },
      topOfBook,
      setup: tags ? { buildupNow: tags.live, buildupLastSession: tags.prev, banned: tags.banned, highDelivery: tags.highDelivery, marketLean: leanNow } : null,
      offForm: horizons.some((x) => x.refine && x.refine.offForm),
      parts: {
        forecaster: { trained: hv.trained !== false, live: hv.live || null },
        evidence: ev ? { trained: ev.trained !== false } : null,
        early: av ? { move: av.move || null } : null,
      },
    };
  }

  _headline(symbol, x, price) {
    if (!x) return "";
    const who = x.leads === "blend" ? "the consensus" : "the forecaster (the blend is still proving itself)";
    const dir = x.lean === "none" ? `no clear lean (rise ${pc(x.pUp)})` : `${x.lean === "up" ? "a rise" : "a fall"} more likely (${pc(x.lean === "up" ? x.pUp : 1 - x.pUp)}, ${x.tier})`;
    return `${symbol} in ${x.minutesAhead} min: about ₹${x.price} (likely between ₹${x.low} and ₹${x.high}) from ₹${price} — ${dir}; led by ${who}.`;
  }

  _keep(symbol, { anchorEnd, price, sigmaPct, x, z, rf = null }) {
    const id = `${symbol}|${anchorEnd}`;
    const recs = this._recs();
    if (recs.has(id)) return;
    const r = { id, symbol, date: istDate(anchorEnd), anchorEnd, price, sigma: sigmaPct, x, z, settled: false, at: iso(this.now()) };
    if (rf && Object.keys(rf).length) r.rf = rf;
    recs.set(id, r);
    this._pending.push(r);
  }

  /* --------------------------------------------------------------------------- checking */
  async score() {
    const now = this.now();
    const due = [...this._recs().values()].filter((r) => !r.settled && !r.void && now >= r.anchorEnd + Math.max(...Object.keys(r.x || {}).map(Number), 0) * BAR + 20000);
    if (!due.length) return 0;
    const today = istDate(now);
    const barsOf = new Map();
    const model = this.model();
    let done = 0;
    for (const r of due) {
      const key = `${r.symbol}|${r.date}`;
      if (!barsOf.has(key)) {
        let b = null;
        try {
          b = await this.horizon.barsFor(r.symbol, r.date);
        } catch (_) {
          b = null;
        }
        barsOf.set(key, b ? H.cleanBars(b) : null);
      }
      const bars = barsOf.get(key);
      const at = H.slotOf(r.anchorEnd - BAR);
      const actual = {};
      for (const hs of Object.keys(r.x || {})) {
        const h = Number(hs);
        const b = bars && bars.find((y) => y.s === at + h);
        if (b && num(r.price) && r.price > 0 && num(r.sigma) && r.sigma > 0) actual[h] = r4(((b.c - r.price) / r.price) * 100 / (r.sigma * Math.sqrt(h)));
      }
      if (!Object.keys(actual).length) {
        if (r.date < today && (bars || now - r.anchorEnd > 3 * 86400000)) {
          r.void = true;
          this._pending.push(r);
        }
        continue;
      }
      for (const [hs, y] of Object.entries(actual)) {
        const h = Number(hs);
        const mh = model.h[h] ? h : h <= 2 ? 1 : 3;
        const [zb, zs] = (r.z && r.z[h]) || [null, null];
        C.learn(model, mh, r.x[h], y, { zb, zs, date: r.date });
        if (r.rf && r.rf[h]) R.learn(model.refine, mh, r.rf[h], y, { date: r.date });
      }
      r.actual = actual;
      r.settled = true;
      this._pending.push(r);
      done += 1;
      if (done % 25 === 0) await tick();
    }
    if (done) {
      this._saveModel();
      this._cache.clear();
    }
    this._flush();
    return done;
  }

  _prune() {
    const cut = istDate(this.now() - KEEP_DAYS * 86400000);
    const old = [...this._recs().values()].filter((r) => r.date < cut).map((r) => r.id);
    if (!old.length) return;
    for (const id of old) this._recs().delete(id);
    if (typeof this.docs.removeItems === "function") this.docs.removeItems(CALLS, old);
  }

  /* --------------------------------------------------------------------------- the sweep */
  async sweep() {
    const list = typeof this.horizon.watching === "function" ? this.horizon.watching() : [];
    let n = 0;
    for (const s of (list || []).slice(0, SWEEP_MAX)) {
      try {
        const v = await this.view(s);
        if (v.available) n += 1;
      } catch (_) {
        /* the next one */
      }
      await tick();
    }
    this._flush();
    return n;
  }

  async tickOnce() {
    if (this._busy) return null;
    this._busy = (async () => {
      const now = this.now();
      const today = istDate(now);
      const min = minuteOfDay(now);
      if (this.isTradingDay(today) && this._connected() && min >= OPEN_FROM && min <= OPEN_TO) {
        const slot = `${today}|${Math.floor(min / 5)}`;
        // a little after each bar closes, so the forecaster has the new bar
        if (slot !== this._slot && now % BAR >= 45000) {
          this._slot = slot;
          await this.sweep();
        }
      }
      await this.score();
      if (min === 16 * 60 || !this._prunedOn || this._prunedOn !== today) {
        this._prunedOn = today;
        this._prune();
      }
      // after the close, once a day: the rules and the measured record go into the trading-skills file
      if (min >= 15 * 60 + 40 && this._taughtOn !== today) {
        this._taughtOn = today;
        this.teach();
      }
      // the multi-day volatility model: refitted after the close each day (and at once, outside the session, if there is none)
      const vm = this.volModel();
      const outside = min >= 15 * 60 + 45 || min < 9 * 60 + 5 || !this.isTradingDay(today);
      if (outside && this._volTried !== today && (!vm || (vm.fittedOn !== today && min >= 15 * 60 + 45))) {
        this._volTried = today;
        await this.refreshVol();
      }
      this._flush();
    })()
      .catch((err) => {
        this.lastError = err.message || String(err);
        this.log.error(`[consensus] ${this.lastError}`);
      })
      .finally(() => {
        this._busy = null;
      });
    return this._busy;
  }

  /** Write the blend's rules and its record into the trading-skills file (every AI feature reads it). */
  teach() {
    if (!this.playbook || typeof this.playbook.setSection !== "function") return false;
    const r = this.record();
    const line = (key) => {
      const x = r[key];
      if (!x || !x.checks) return `- ${key} minutes: no forecast checked yet.`;
      const pct = (v) => (num(v) ? `${Math.round(v * 100)}%` : "—");
      return `- ${key} minutes: ${x.checks} checks over ${x.days} sessions — direction right ${pct(x.blend.dirAcc)} for the blend, ${pct(x.forecaster.dirAcc)} for the forecaster alone; average miss ${x.blend.missAvg} against ${x.forecaster.missAvg} usual moves; ${x.proven ? "the blend LEADS (proven better)" : "the forecaster leads while the blend proves itself"}. Weights now: forecaster ${x.weights.forecaster}, evidence desk ${x.weights.evidence}, early calls ${x.weights.early}, order book ${x.weights.book}.`;
    };
    const refineLine = (key) => {
      const x = r[key] && r[key].refine;
      if (!x || !x.checks) return `- Refiner, ${key} minutes: nothing checked yet.`;
      const pct = (v) => (num(v) ? `${Math.round(v * 100)}%` : "—");
      return `- Refiner, ${key} minutes: ${x.checks} checks over ${x.days} sessions — centre ${x.mean.proven ? "LEADS" : "in trial"} (miss ${x.mean.missRefined} against ${x.mean.missLead}); conformal band ${x.band.proven ? "LEADS" : "in trial"}, held ${pct(x.band.coverage)} against the old band's ${pct(x.band.oldCoverage)} (stated 70%)${x.band2 && x.band2.checks ? `; the multi-day band (misses scaled by the volatility the last days forecast) held ${pct(x.band2.coverage)}, ${x.bandBy === "multi" ? "and LEADS" : "in trial"}` : ""}${x.offForm ? "; TODAY IS OFF-FORM: the forecasts are missing clearly more than usual" : ""}.`;
    };
    const lines = [
      "- One level forecast per stock for about 5 and 15 minutes blends the 15-minute forecaster, the evidence desk, the early calls and the live order book; it leads only when its checked record beats the forecaster alone. Quote its price, band and chance of a rise WITH its record; a band edge is not a target and no forecast is a certainty.",
      "- Weigh every reading by its measured record on this desk: a proven technique or live reading counts; an unproven one is context only.",
      "- The order book leans the next minutes: pending buy against sell, the imbalance at the best five prices; a wall is a level until it is pulled.",
      "- Delivery (published by NSE after the close): a rise on delivery above its 20-session average reads as accumulation, a fall on it as distribution; a big move on low delivery is speculative churn that fades more easily.",
      "- GIFT NIFTY, Wall Street and Asia matter most at the open; during the session NIFTY, SENSEX, the sector and India VIX set the tide for a single stock.",
      line("5"),
      line("15"),
      "- The refiner, a second stage on the consensus: the microprice and the queue imbalance at the best bid and offer (Stoikov 2018), the spread, and today's realized volatility against the usual (Corsi's HAR idea) correct the forecast's centre; the band comes from the forecast's own recent misses (adaptive conformal prediction, Gibbs & Candès 2021) so a 70% band holds about 70%; a second band scales those misses by the volatility forecast from the last days (HAR-RV, Corsi 2009, with the busy open and close taken out) and leads only with a better interval score; volatility.expected and volatility.outlook say how wild the last days make today; a Page-Hinkley alarm flags a session on which the forecasts miss clearly more than usual. Each part leads only once its checks prove it; on an off-form session no lean is stronger than slight.",
      refineLine("5"),
      refineLine("15"),
    ];
    try {
      this.playbook.setSection(SECTION, lines.join("\n"));
      return true;
    } catch (err) {
      this.log.error(`[consensus] the skills file could not be written: ${err.message}`);
      return false;
    }
  }

  /* --------------------------------------------------------------------------- for the screen */
  record() {
    const m = this.model();
    const today = istDate(this.now());
    return Object.fromEntries(C.HZ.map((h) => [C.KEYS[h], { ...C.summaryOf(m.h[h].stats), weights: Object.fromEntries(C.FEATURES.map((f, i) => [f, m.h[h].w[i]])), refine: R.summaryOf(R.horizonOf(m.refine, h), today) }]));
  }

  board() {
    const recs = [...this._recs().values()];
    const today = istDate(this.now());
    return { record: this.record(), kept: recs.length, today: recs.filter((r) => r.date === today).length, checked: recs.filter((r) => r.settled).length, rule: RULE, checkRule: CHECK_RULE, error: this.lastError };
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tickOnce();
    }, 30000);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { Consensus, ConsensusError, MODEL, CALLS, RULE, CHECK_RULE, SECTION };
