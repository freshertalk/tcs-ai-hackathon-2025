"use strict";
// The flight deck: every open position watched from the entry to the exit, with no page open.
//
//   WATCH     every 10 seconds in NSE hours (while Zerodha is connected) the open positions are read;
//             a new one opens a "flight", a closed one lands it. Each open position's instrument is
//             followed on the live stream with its five best bids and offers (the order-flow engine).
//   COACH     on every streamed tick (at most four looks a second per position) the exit coach
//             (trading/exitcoach.js) reads the position against the tape, the book, the levels and
//             the forecasts, and says HOLD, TIGHTEN, BOOK PART or EXIT NOW with the price. The slow
//             inputs — 1-minute bars, the desk's levels and live call, the Live Pulse, the news about
//             the stock, the market's tide, the NSE forecast from the world, the day's goal — are
//             refreshed every 20–30 seconds; the look itself is arithmetic in memory, so the board
//             moves within a fraction of a second of the price.
//   TELL      each look is pushed to the Live board (app.js: a Server-Sent Events stream); a change to
//             EXIT NOW also goes to Telegram / WhatsApp (once per position every 10 minutes). The AI
//             Engine gives a second opinion on a change of signal or on request — sparingly: one per
//             position every 5 minutes, within a daily limit.
//   LEVELS    the AI Engine also researches each position's exit levels — when it comes onto the
//             board, when its first target is reached, when the levels go stale, or on request. It
//             chooses by id from the desk's own level map (trading/exitlevels.js); every choice is
//             checked against that map before it is shown (a level that is not on it, is on the
//             wrong side, is not worth the costs or is out of reach is left out and listed), the
//             price moving through a level is marked the moment it happens, and after the close each
//             set is scored on the day's 1-minute bars — the AI's record here is counted, not assumed.
//   RECORD    the CCTV: a snapshot of every open position every 15 seconds (price, bid, offer, who is
//             pressing, the exit pressure, the signal, the P&L) and every event (entry, each change
//             of signal, each AI opinion, each alert, the exit), kept in the database one record per
//             day (flight/DATE.json) for the replay after the close and the analysis over time.
//
// It reads the account and the market. It never places, changes or cancels an order: the board's Exit
// button only opens the order ticket, which the trader confirms. It lives outside server/ai (which
// holds no timers).

const { EventEmitter } = require("node:events");
const { coach, newMemory, RANK } = require("./trading/exitcoach");
const { levelMap, verify, track, settle, record, fiveMinute } = require("./trading/exitlevels");
const { nseOpen } = require("./alert-watch");
const { BRAND } = require("./brand");

const IST = 5.5 * 3600 * 1000;
const SETTINGS = "flight/settings.json";
const INDEX = "flight/index.json";
const LEVELS = "flight/ai-levels.json"; // every scored set of AI levels: the track record
const dayName = (date) => `flight/${date}.json`;
const POS_MS = 10000; // the positions are read this often
const CTX_MS = 25000; // the slow inputs of one position
const MKT_MS = 30000; // the market-wide inputs
const SNAP_MS = 15000; // one CCTV frame per position
const SAVE_MS = 60000;
const LOOK_MS = 250; // at most four looks a second per position
const LVL_AUTO_MS = 10 * 60000; // by itself: one research per position at most this often …
const LVL_EVENT_MS = 3 * 60000; // … or this often when a target was reached or the stop broken
const LVL_ASK_MS = 60000; // on request
const LVL_OLD_MS = 60 * 60000; // a set this old is looked at again if the price has moved away
const MAX_SETS = 12;
const KEEP_DAYS = 180;
const MAX_SNAPS = 2400;
const COLS = ["t", "last", "bid", "ask", "buyersPct", "bookPressure", "exitPressure", "state", "pnl"];
const DEFAULTS = { aiMode: "change", aiDailyCap: 30, notify: true };
const AI_MODES = ["change", "ask", "off"];

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const clock = (ms) => new Date(ms + IST).toISOString().slice(11, 16);
const rs = (x) => (num(x) ? `₹${Number(x).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—");
const signed = (x) => (num(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}₹${Math.abs(Math.round(x)).toLocaleString("en-IN")}` : "—");

class FlightError extends Error {
  constructor(message, code = "invalid", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class FlightDeck extends EventEmitter {
  /**
   * @param trading  the TradingService (reads only: status, positions, trades, journal)
   * @param market   the MarketService (ticks, the order-flow engine, bars, verdict, pulse, context, forecast, social)
   * @param ai       the AiService (optional): ai.exitAdvisor
   * @param goal     () => the day's goal state as last read ("ok", "target"…), or null
   */
  constructor({ trading, market, ai = null, docs, notifier = null, goal = null, now = () => Date.now(), log = console }) {
    super();
    this.trading = trading;
    this.market = market;
    this.ai = ai;
    this.docs = docs;
    this.notifier = notifier;
    this.goal = goal;
    this.learn = null; // set by app.js: the level learner (server/learn.js) — how often each kind of level has held
    this.now = now;
    this.log = log;
    this.slots = new Map(); // key → the open position being flown
    this.other = []; // open positions the coach does not fly (derivatives)
    this.mkt = { at: 0, tide: null, forecast: null, mood: null };
    this.rec = null; // today's record
    this.dirty = false;
    this.timers = [];
    this._syncing = null;
    this.last = { at: null, error: "", positions: 0 };
    this._onTick = (t) => {
      for (const slot of this.slots.values()) if (slot.token === t.token) this._look(slot, t);
    };
  }

  /* ---------------------------------------------------------------------------- settings */
  settings() {
    const d = this.docs.read(SETTINGS, null) || {};
    const cap = Number(d.aiDailyCap);
    const today = istDate(this.now());
    return {
      aiMode: AI_MODES.includes(d.aiMode) ? d.aiMode : DEFAULTS.aiMode,
      aiDailyCap: Number.isFinite(cap) && cap >= 0 ? Math.min(300, Math.round(cap)) : DEFAULTS.aiDailyCap,
      notify: d.notify === undefined ? DEFAULTS.notify : Boolean(d.notify),
      aiToday: d.ai && d.ai.day === today ? d.ai.n : 0,
      aiReady: Boolean(this.ai && this.ai.exitAdvisor && this.ai.exitAdvisor.ready()),
      model: this._model(),
    };
  }
  setSettings(patch = {}) {
    const d = this.docs.read(SETTINGS, null) || {};
    if (patch.aiMode !== undefined) {
      if (!AI_MODES.includes(patch.aiMode)) throw new FlightError("The AI mode is change, ask or off.");
      d.aiMode = patch.aiMode;
    }
    if (patch.aiDailyCap !== undefined) {
      const v = Number(patch.aiDailyCap);
      if (!Number.isFinite(v) || v < 0 || v > 300) throw new FlightError("AI opinions a day: 0 to 300.");
      d.aiDailyCap = Math.round(v);
    }
    if (patch.notify !== undefined) d.notify = Boolean(patch.notify);
    this.docs.write(SETTINGS, d);
    return this.settings();
  }
  _model() {
    try {
      const m = this.ai && typeof this.ai.modelChain === "function" ? this.ai.modelChain()[0] : null;
      return m ? m.name : null;
    } catch (_) {
      return null;
    }
  }

  /* ------------------------------------------------------------------------- the record */
  _record() {
    const date = istDate(this.now());
    if (!this.rec || this.rec.date !== date) {
      if (this.rec && this.dirty) this._save();
      const d = this.docs.read(dayName(date), null);
      this.rec = d && d.date === date && d.flights ? d : { date, cols: COLS, flights: {} };
    }
    return this.rec;
  }
  _save() {
    if (!this.rec) return;
    try {
      this.docs.write(dayName(this.rec.date), this.rec);
      const ix = this.docs.read(INDEX, null) || { days: [] };
      if (!ix.days.includes(this.rec.date)) {
        ix.days = [...ix.days, this.rec.date].sort();
        // only the last KEEP_DAYS are kept
        while (ix.days.length > KEEP_DAYS) this.docs.remove(dayName(ix.days.shift()));
        this.docs.write(INDEX, ix);
      }
      this.dirty = false;
    } catch (err) {
      this.log.error(`[flight] could not save the record: ${err.message}`);
    }
  }
  _event(slot, kind, extra = {}, at = this.now()) {
    const f = slot.flight;
    const ev = { at, clock: clock(at), kind, ...extra };
    f.events.push(ev);
    if (f.events.length > 300) f.events.splice(0, f.events.length - 300);
    this.dirty = true;
    return ev;
  }

  /** The days on record, newest first. */
  days() {
    const ix = this.docs.read(INDEX, null) || { days: [] };
    return ix.days.slice().reverse();
  }
  /** One day's record: every flight with its frames and events. */
  day(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new FlightError("That is not a valid date (use YYYY-MM-DD).");
    if (this.rec && this.rec.date === date) return { available: true, ...this.rec, flights: Object.values(this.rec.flights), levelsRecord: this.levelsRecord() };
    const d = this.docs.read(dayName(date), null);
    if (!d) return { available: false, date, reason: "Nothing was recorded on that day (the recorder runs while Zerodha is connected and a position is open)." };
    return { available: true, ...d, flights: Object.values(d.flights || {}), levelsRecord: this.levelsRecord() };
  }

  /* ------------------------------------------------------------------------ the positions */
  /** Read the open positions and open, update or land the flights. One at a time. */
  sync() {
    if (this._syncing) return this._syncing;
    this._syncing = this._sync().finally(() => {
      this._syncing = null;
    });
    return this._syncing;
  }

  async _sync() {
    let st;
    try {
      st = this.trading.status();
    } catch (_) {
      st = { connected: false };
    }
    if (!st.connected) {
      this.last = { at: new Date(this.now()).toISOString(), error: "Zerodha is not connected.", positions: this.slots.size };
      return this.board();
    }
    let p;
    try {
      p = await this.trading.positions();
    } catch (err) {
      this.last = { at: new Date(this.now()).toISOString(), error: err.message, positions: this.slots.size };
      return this.board();
    }
    const net = (p && p.net) || [];
    const keyOf = (x) => `${x.exchange}:${x.symbol}:${x.product}`;
    const open = net.filter((x) => Number(x.quantity) !== 0);
    const cash = open.filter((x) => x.exchange === "NSE" || x.exchange === "BSE");
    this.other = open.filter((x) => !cash.includes(x)).map((x) => ({ symbol: x.symbol, exchange: x.exchange, product: x.product, quantity: x.quantity, average: x.average, last: x.last, pnl: r2(x.pnl) }));
    let changed = false;
    const seen = new Set();
    for (const row of cash) {
      const key = keyOf(row);
      seen.add(key);
      const side = row.quantity > 0 ? "long" : "short";
      let slot = this.slots.get(key);
      if (slot && slot.side !== side) {
        this._land(slot, null); // the position was reversed: one flight ends, another begins
        slot = null;
      }
      if (!slot) {
        await this._open(key, row, side);
        changed = true;
      } else if (slot.qty !== Math.abs(row.quantity) || Math.abs(slot.avg - row.average) > 0.005) {
        this._event(slot, "size", { text: `Size ${slot.qty} → ${Math.abs(row.quantity)}, average ${rs(row.average)}.`, qty: Math.abs(row.quantity), avg: row.average });
        Object.assign(slot, { qty: Math.abs(row.quantity), avg: row.average });
        Object.assign(slot.flight, { qty: slot.qty, avg: slot.avg });
        changed = true;
      }
    }
    for (const [key, slot] of [...this.slots]) {
      if (seen.has(key)) continue;
      this._land(slot, net.find((x) => keyOf(x) === key) || null);
      changed = true;
    }
    this.last = { at: new Date(this.now()).toISOString(), error: "", positions: this.slots.size };
    if (changed) this.emit("board", this.board());
    return this.board();
  }

  async _open(key, row, side) {
    const now = this.now();
    let entryAt = now;
    try {
      // the entry time is the first fill of the open round trip in the journal (today's trades are read first)
      this.trading.journal.ingestKite(await this.trading.trades());
      const trip = this.trading.journal
        .trips({})
        .filter((t) => t.open && t.symbol === row.symbol && t.exchange === row.exchange)
        .sort((a, b) => b.entryAt - a.entryAt)[0];
      if (trip && trip.entryAt && istDate(trip.entryAt) === istDate(now)) entryAt = trip.entryAt;
    } catch (_) {
      /* the moment it was first seen stands in */
    }
    const rec = this._record();
    const id = `${row.symbol}-${row.product}-${entryAt}`;
    const flight = rec.flights[id] || { id, symbol: row.symbol, exchange: row.exchange, product: row.product, side, qty: Math.abs(row.quantity), avg: row.average, entryAt, entryClock: clock(entryAt), exitAt: null, exitClock: null, exitAvg: null, pnl: null, snaps: [], events: [], ai: [], levels: [], final: null };
    if (!Array.isArray(flight.levels)) flight.levels = [];
    rec.flights[id] = flight;
    const pos = { symbol: row.symbol, side, qty: Math.abs(row.quantity), avg: row.average, entryAt, product: row.product };
    const slot = { key, id, token: row.token || null, exchange: row.exchange, ...pos, memory: newMemory(pos), ctx: { at: 0, bars: [], levels: [], pulse: null, news: null, liveCall: null }, tick: null, advice: null, lookAt: 0, snapAt: 0, ai: flight.ai.length ? flight.ai[flight.ai.length - 1] : null, aiAt: 0, notifiedAt: 0, flight, release: null, daily: [], dailyAt: 0, map: null, levels: flight.levels.length ? flight.levels[flight.levels.length - 1] : null, levelsAt: flight.levels.length ? flight.levels[flight.levels.length - 1].at : 0, levelsBusy: false };
    if (!slot.token && typeof this.market._token === "function") slot.token = this.market._token(row.symbol);
    if (slot.token && typeof this.market.followBook === "function") slot.release = this.market.followBook(slot.token);
    this.slots.set(key, slot);
    if (!flight.events.length) this._event(slot, "entry", { text: `${side === "long" ? "Bought" : "Sold short"} ${slot.qty} at ${rs(slot.avg)}.${now - entryAt > 90000 ? ` (On the board from ${clock(now)}.)` : ""}`, price: slot.avg }, entryAt);
    this.dirty = true;
    await this._context(slot).catch(() => {});
    this._look(slot, { last: row.last }, { force: true });
    this.log.log(`[flight] ${row.symbol} ${side} ${slot.qty} @ ${slot.avg}: on the board`);
  }

  _land(slot, row) {
    const now = this.now();
    const s = slot.side === "long" ? 1 : -1;
    const f = slot.flight;
    const lastPx = slot.tick && num(slot.tick.last) ? slot.tick.last : slot.advice ? slot.advice.metrics.last : slot.avg;
    const dayExit = row ? (slot.side === "long" ? row.sellPrice : row.buyPrice) : null;
    f.exitAt = now;
    f.exitClock = clock(now);
    f.exitAvg = r2(num(dayExit) && dayExit > 0 && Math.abs(dayExit - lastPx) / lastPx < 0.03 ? dayExit : lastPx);
    f.pnl = r2(s * (f.exitAvg - slot.avg) * slot.qty);
    const m = slot.advice ? slot.advice.metrics : null;
    f.final = { state: slot.advice ? slot.advice.state : null, pressure: slot.advice ? slot.advice.pressure : null, peak: m ? m.peak : null, trough: m ? m.trough : null, givebackPct: m ? m.givebackPct : null, minutesIn: Math.round((now - slot.entryAt) / 60000) };
    this._event(slot, "exit", { text: `Closed at about ${rs(f.exitAvg)}: ${signed(f.pnl)}${m && m.peak && m.peak.pnl > 0 ? ` (the best was ${signed(m.peak.pnl)} at ${m.peak.clock})` : ""}.`, price: f.exitAvg });
    if (slot.release) slot.release();
    this.slots.delete(slot.key);
    this._save();
    this.log.log(`[flight] ${slot.symbol}: landed, ${f.pnl}`);
  }

  /* ----------------------------------------------------------------------- the slow inputs */
  async _context(slot) {
    const now = this.now();
    const m = this.market;
    const day = istDate(now);
    const open = Date.parse(`${day}T03:45:00Z`);
    const ctx = { ...slot.ctx, at: now };
    const jobs = [
      m.minuteBarsBetween(slot.symbol, open, now).then((bars) => {
        if (Array.isArray(bars) && bars.length) ctx.bars = bars;
      }),
      m.verdict(slot.symbol).then((v) => {
        if (!v || v.available === false) return;
        ctx.levels = (v.ladder || []).filter((l) => num(l.price) && l.kind !== "circuit" && l.kind !== "price").map((l) => ({ label: l.label, price: l.price }));
        const d = v.day;
        ctx.liveCall = d && d.available ? { side: d.side || null, active: d.state === "long" || d.state === "short", headline: d.headline, score: d.score } : null;
      }),
      m.pulse(slot.symbol).then((p) => {
        ctx.pulse = p && p.available ? { score: p.score, lean: p.lean, call: p.call, headline: p.headline, window: p.window ? { low: p.window.low, high: p.window.high } : null } : null;
      }),
    ];
    if (!slot.daily.length && now - slot.dailyAt > 5 * 60000 && typeof m.daily === "function") {
      slot.dailyAt = now;
      jobs.push(
        m.daily(slot.symbol).then((d) => {
          if (d && Array.isArray(d.candles)) slot.daily = d.candles.slice(-30).map((c) => ({ t: String(c.t).slice(0, 10), o: c.o, h: c.h, l: c.l, c: c.c }));
        })
      );
    }
    await Promise.all(jobs.map((j) => j.catch(() => {})));
    try {
      const n = m.social ? m.social.forSymbol(slot.symbol, { hours: 6 }) : null;
      ctx.news = n ? { sentiment: n.sentiment, tone: n.tone, high: n.high, mentions: n.mentions, title: n.items[0] && n.items[0].title, at: n.items[0] && n.items[0].at } : null;
    } catch (_) {
      ctx.news = null;
    }
    slot.ctx = ctx;
    slot.map = this._map(slot);
  }

  /** The desk's level map around one position, from what is in memory now. */
  _map(slot) {
    const a = slot.advice;
    const pos = { symbol: slot.symbol, side: slot.side, qty: slot.qty, avg: slot.avg, entryAt: slot.entryAt };
    try {
      return levelMap(pos, slot.ctx.bars, {
        now: this.now(),
        last: slot.tick && num(slot.tick.last) ? slot.tick.last : a ? a.metrics.last : undefined,
        daily: slot.daily,
        ladder: slot.ctx.levels,
        vwap: slot.tick && num(slot.tick.vwap) ? slot.tick.vwap : a ? a.metrics.vwap : null,
        wall: a && a.metrics.book ? a.metrics.book.wall : null,
        pulse: slot.ctx.pulse,
        peak: slot.memory ? slot.memory.peak : null,
        learned: this.learn ? (sources) => this.learn.holdOf(slot.symbol, sources, { at: this.now() }) : undefined,
      });
    } catch (_) {
      return null;
    }
  }

  async _market() {
    const now = this.now();
    const m = this.market;
    const out = { at: now, tide: this.mkt.tide, forecast: this.mkt.forecast, mood: this.mkt.mood };
    await Promise.all([
      m
        .context()
        .then((c) => {
          out.tide = c && c.available && c.tide ? { score: c.tide.score, label: c.tide.label, summary: c.tide.summary } : null;
        })
        .catch(() => {}),
      (typeof m.marketForecast === "function" ? m.marketForecast() : Promise.resolve(null))
        .then((f) => {
          out.forecast = f && f.available ? { score: f.lean.score, word: f.lean.word, firm: f.lean.firm, headline: f.headline } : null;
        })
        .catch(() => {}),
    ]);
    try {
      const sig = m.social ? m.social.signal() : null;
      out.mood = sig ? { label: sig.mood.label, score: sig.mood.score, items: sig.items } : null;
    } catch (_) {
      out.mood = null;
    }
    this.mkt = out;
  }

  /* ---------------------------------------------------------------------------- one look */
  _look(slot, tick, { force = false } = {}) {
    const now = this.now();
    if (!force && now - slot.lookAt < LOOK_MS) return null;
    if (!tick || !num(tick.last)) return null;
    slot.lookAt = now;
    slot.tick = { last: tick.last, bid: num(tick.bid) ? tick.bid : null, ask: num(tick.ask) ? tick.ask : null, vwap: num(tick.avgPrice) ? tick.avgPrice : null, volume: num(tick.volume) ? tick.volume : null };
    let flow = null;
    try {
      flow = slot.token && this.market.flow ? this.market.flow.snapshot(slot.token) : null;
    } catch (_) {
      flow = null;
    }
    let goal = null;
    try {
      goal = typeof this.goal === "function" ? this.goal() : null;
    } catch (_) {
      goal = null;
    }
    const pos = { symbol: slot.symbol, side: slot.side, qty: slot.qty, avg: slot.avg, entryAt: slot.entryAt, product: slot.product };
    // a target the AI chose (and the desk checked) is a level like any other on the ladder
    const set = slot.levels && !slot.levels.failed ? slot.levels : null;
    const aiLevels = set ? set.targets.filter((t) => t.status === "open").map((t) => ({ label: `the AI's target ${t.n} (${t.label})`, price: t.level })) : [];
    const a = coach(pos, slot.ctx.bars, slot.tick, { now, memory: slot.memory, flow, levels: aiLevels.length ? [...slot.ctx.levels, ...aiLevels] : slot.ctx.levels, pulse: slot.ctx.pulse, tide: this.mkt.tide, forecast: this.mkt.forecast, news: slot.ctx.news, goal: goal ? { state: goal } : null, liveCall: slot.ctx.liveCall });
    const prev = slot.advice ? slot.advice.state : null;
    slot.memory = a.memory;
    const { memory, parts, ...advice } = a;
    void memory;
    void parts;
    slot.advice = advice;
    if (a.state !== prev) {
      this._event(slot, "signal", { state: a.state, pressure: a.pressure, price: a.metrics.last, text: a.headline });
      if (prev !== null && RANK[a.state] > RANK[prev]) this._escalated(slot, a);
    }
    let levelMoved = false;
    if (set) {
      for (const ch of track(set, pos, { last: tick.last, now })) {
        levelMoved = true;
        this._levelReached(slot, set, ch, a);
      }
    }
    if (now - slot.snapAt >= SNAP_MS) {
      slot.snapAt = now;
      const snaps = slot.flight.snaps;
      snaps.push([now, a.metrics.last, a.metrics.bid, a.metrics.ask, a.metrics.book ? a.metrics.book.buyersPct : null, a.metrics.book ? a.metrics.book.pressure : null, a.pressure, RANK[a.state], a.metrics.pnl]);
      if (snaps.length > MAX_SNAPS) snaps.splice(0, snaps.length - MAX_SNAPS);
      this.dirty = true;
    }
    const view = this._view(slot, { light: !levelMoved });
    this.emit("pos", view);
    return view;
  }

  /** The price has just reached one of the AI's levels: write it down and tell the phone (a reminder, nothing is traded). */
  _levelReached(slot, set, ch, a) {
    const st = this.settings();
    const t = ch.kind === "target" ? set.targets.find((x) => x.n === ch.n) : null;
    const text =
      ch.kind === "stop"
        ? `The AI's stop ${rs(set.stop.price)} is broken (${set.stop.label}).`
        : ch.after
          ? `The AI's target ${ch.n} ${rs(ch.price)} was reached, but only after its stop.`
          : `The AI's target ${ch.n} ${rs(ch.price)} is reached (${t ? t.label : "level"}): the plan was to take profit here.`;
    this._event(slot, "level", { text, price: ch.price, level: ch.kind === "stop" ? "stop" : `t${ch.n}` });
    if (ch.kind === "target" && !ch.after && st.notify && this.notifier) {
      const msg = `🎯 AI target ${ch.n} reached — ${slot.symbol} ${slot.side} ${slot.qty} @ ${rs(slot.avg)}, now ${rs(a.metrics.last)} (${signed(a.metrics.pnl)})\n${t ? t.label : ""} ${rs(ch.price)}: the plan was to take profit here. The coach says ${a.word}; stop ${rs(a.stop)}.\n(${BRAND.name} · a reminder — nothing was traded)`;
      Promise.resolve()
        .then(() => this.notifier.send(msg, "risk"))
        .catch(() => {});
    }
  }

  /** The signal stepped up: tell the phone (EXIT NOW only), and ask the AI Engine when that is switched on. */
  _escalated(slot, a) {
    const now = this.now();
    const st = this.settings();
    // every open page hears of a step up at once (app.js turns it into a popup); at most once a minute per position and signal
    const said = slot.saidAt && slot.saidAt[a.state];
    if (!said || now - said > 60000) {
      slot.saidAt = { ...(slot.saidAt || {}), [a.state]: now };
      this.emit("escalated", { key: slot.key, symbol: slot.symbol, side: slot.side, qty: slot.qty, state: a.state, last: a.metrics.last, pnl: a.metrics.pnl, stop: a.stop, headline: a.headline, reason: (a.reasons && a.reasons.exit && a.reasons.exit[0]) || "" });
    }
    if (a.state === "exit-now" && st.notify && this.notifier && now - slot.notifiedAt > 10 * 60000) {
      slot.notifiedAt = now;
      const text = `🚪 EXIT NOW — ${slot.symbol} ${slot.side} ${slot.qty} @ ${rs(slot.avg)}, now ${rs(a.metrics.last)} (${signed(a.metrics.pnl)})\n${a.reasons.exit[0] || ""}\nExit: ${a.exit.note} Stop ${rs(a.stop)}.\n(${BRAND.name} · the exit coach's reading — nothing was traded)`;
      Promise.resolve()
        .then(() => this.notifier.send(text, "risk"))
        .catch(() => {});
      this._event(slot, "alert", { text: "Sent to your phone: EXIT NOW." });
    }
    if (st.aiMode === "change" && (a.state === "exit-now" || a.state === "book-part")) this.askAi(slot.key, { auto: true }).catch(() => {});
  }

  /* -------------------------------------------------------------------- the AI's opinion */
  /**
   * A second opinion from the AI Engine on one open position. Sparingly: by itself at most one per
   * position every five minutes, on request one every 30 seconds, and within the daily limit.
   */
  async askAi(key, { auto = false } = {}) {
    const slot = this.slots.get(String(key));
    if (!slot) throw new FlightError("That position is not open any more.", "not_found", 404);
    if (!slot.advice) throw new FlightError("The coach has not read this position yet.", "not_ready", 409);
    if (!this.ai || !this.ai.exitAdvisor || !this.ai.exitAdvisor.ready()) throw new FlightError("No AI key is saved (the default model is Claude Sonnet 5.5 — save its key on the AI page).", "not_configured", 409);
    const now = this.now();
    const st = this.settings();
    if (st.aiMode === "off" && auto) return null;
    if (st.aiToday >= st.aiDailyCap) throw new FlightError(`Today's ${st.aiDailyCap} AI opinions are used up (a limit you can change on the board).`, "rate_limited", 429);
    if (now - slot.aiAt < (auto ? 5 * 60000 : 30000)) {
      if (auto) return slot.ai;
      throw new FlightError("The AI gave its opinion on this position a moment ago. Try again in half a minute.", "rate_limited", 429);
    }
    slot.aiAt = now;
    const a = slot.advice;
    const snapshot = this._snapshot(slot);
    let r;
    try {
      r = await this.ai.exitAdvisor.advise(snapshot);
    } catch (err) {
      throw new FlightError(err && err.message ? err.message : "The AI did not answer.", "ai_failed", 502);
    }
    if (!r) throw new FlightError("The AI model did not answer just now.", "ai_failed", 502);
    this._countAi(r.cached);
    const op = { at: now, clock: clock(now), action: r.action, exitPrice: r.exitPrice, stop: r.stop, confidence: r.confidence, reason: r.reason, watch: r.watch, by: r.by, agrees: r.action === a.state, deskSaid: a.state, auto };
    if (!this.slots.has(slot.key)) return op; // it was closed while the AI was thinking
    slot.ai = op;
    slot.flight.ai.push(op);
    this._event(slot, "ai", { text: `AI (${r.by}): ${String(r.action).replace("-", " ").toUpperCase()} — ${r.reason}`, state: r.action });
    this.emit("pos", this._view(slot));
    return op;
  }

  /** What the desk's other AI features have already found on a position's stock, for the model's snapshot. */
  _shared(slot) {
    try {
      if (!this.ai || !this.ai.shared) return null;
      const last = slot.advice ? slot.advice.metrics.last : null;
      const found = this.ai.shared.forSymbol(slot.symbol, { last, reader: "live board" }).filter((f) => f.feature !== "exit-levels" && f.feature !== "exit");
      return found.length ? found.slice(0, 4).map((f) => ({ from: f.source, model: f.by, minutesAgo: f.ageMin, madeAtPrice: f.last, moved: f.moved, summary: f.summary, ...(Object.keys(f.tags).length ? { call: f.tags } : {}) })) : null;
    } catch (_) {
      return null;
    }
  }

  /** One paid AI request against the day's limit (an answer reused from the Engine's cache costs nothing). */
  _countAi(cached) {
    if (cached) return;
    const d = this.docs.read(SETTINGS, null) || {};
    const today = istDate(this.now());
    d.ai = d.ai && d.ai.day === today ? { day: today, n: d.ai.n + 1 } : { day: today, n: 1 };
    this.docs.write(SETTINGS, d);
  }

  /** What the AI Engine is told about one position: only what the desk itself holds at this moment. */
  _snapshot(slot) {
    const now = this.now();
    const a = slot.advice;
    return {
      timeIST: clock(now),
      position: { symbol: slot.symbol, side: slot.side, quantity: slot.qty, average: slot.avg, product: slot.product, enteredAt: clock(slot.entryAt), last: a.metrics.last, pnl: a.metrics.pnl, gainPct: a.metrics.gainPct, best: a.metrics.peak, worst: a.metrics.trough, givenBackPct: a.metrics.givebackPct, minutesIn: a.metrics.minutesIn, minutesToSquareOff: a.metrics.minutesToSquareOff },
      deskExitCoach: { signal: a.word, exitPressure: a.pressure, headline: a.headline, exit: a.exit, stop: a.stop, target: a.target, reasonsToExit: a.reasons.exit, reasonsToHold: a.reasons.hold },
      tape: { vwap: a.metrics.vwap, vsVwapPct: a.metrics.vsVwapPct, rsi1min: a.metrics.rsi1, move3minPct: a.metrics.move3Pct, last20OneMinuteBars: { columns: ["time", "open", "high", "low", "close", "volume"], rows: slot.ctx.bars.slice(-20).map((b) => [clock(b.t), b.o, b.h, b.l, b.c, b.v]) } },
      orderBook: a.metrics.book,
      levels: slot.ctx.levels.slice().sort((x, y) => Math.abs(x.price - a.metrics.last) - Math.abs(y.price - a.metrics.last)).slice(0, 8),
      next15to30min: slot.ctx.pulse,
      deskLiveCall: slot.ctx.liveCall,
      market: { tide: this.mkt.tide, nseForecastFromTheWorld: this.mkt.forecast, newsMood: this.mkt.mood },
      newsOnThisStock: slot.ctx.news,
      otherAiFindings: this._shared(slot),
    };
  }

  /* ------------------------------------------------------------------- the AI's exit levels */
  /** The AI's record on this desk: how often its first target came before its stop, from the scored sets. */
  levelsRecord() {
    const d = this.docs.read(LEVELS, null) || { rows: [] };
    return record(d.rows);
  }

  /** Is it time to research a position's levels again, by itself? The reason, or "". */
  _levelsNeed(slot, now) {
    const a = slot.advice;
    if (!a || slot.levelsBusy) return "";
    if (num(a.metrics.minutesToSquareOff) && a.metrics.minutesToSquareOff <= 10) return ""; // too late in the day to be of use
    const set = slot.levels;
    const since = now - Math.max(slot.levelsAt, slot.levelsTryAt || 0);
    if (!set) return since >= LVL_AUTO_MS ? "the position came onto the board" : "";
    const open = (set.targets || []).filter((t) => t.status === "open");
    if (set.stop && set.stop.status === "hit") return since >= LVL_EVENT_MS ? "its stop was broken" : "";
    if ((set.targets || []).length && !open.length) return since >= LVL_EVENT_MS ? "its targets were reached" : "";
    if ((set.targets || []).some((t) => t.status === "reached")) return since >= LVL_EVENT_MS ? "its first target was reached" : "";
    if (!(set.targets || []).length) return since >= LVL_AUTO_MS * 2 ? "no target passed the check last time" : "";
    if (since >= LVL_OLD_MS && Math.abs(a.metrics.last - set.last) > (a.metrics.unit || a.metrics.last * 0.004)) return "the levels are an hour old and the price has moved";
    return "";
  }

  /**
   * The AI Engine researches one position's exit levels: it chooses by id from the desk's level map,
   * and every choice is checked against that map before it is kept. Sparingly: by itself only when
   * it is needed (see `_levelsNeed`), on request once a minute, within the same daily limit as the
   * second opinions.
   * @returns the set { id, at, clock, by, why, last, targets, stop, reversal, rejected, checks, summary, … }
   */
  async researchLevels(key, { auto = false, why = "you asked" } = {}) {
    const slot = this.slots.get(String(key));
    if (!slot) throw new FlightError("That position is not open any more.", "not_found", 404);
    if (!slot.advice) throw new FlightError("The coach has not read this position yet.", "not_ready", 409);
    if (!this.ai || !this.ai.exitAdvisor || !this.ai.exitAdvisor.ready()) throw new FlightError("No AI key is saved (the default model is Claude Sonnet 5.5 — save its key on the AI page).", "not_configured", 409);
    const now = this.now();
    const st = this.settings();
    if (auto) slot.levelsTryAt = now;
    if (auto && (st.aiMode !== "change" || typeof this.ai.exitAdvisor.research !== "function")) return null;
    if (st.aiToday >= st.aiDailyCap) {
      if (auto) return null;
      throw new FlightError(`Today's ${st.aiDailyCap} AI requests are used up (a limit you can change on the board).`, "rate_limited", 429);
    }
    if (slot.levelsBusy) {
      if (auto) return slot.levels;
      throw new FlightError("The AI is researching this position's levels right now.", "busy", 409);
    }
    if (!auto && now - slot.levelsAt < LVL_ASK_MS && slot.levels) throw new FlightError("The levels were researched a moment ago. Try again in a minute.", "rate_limited", 429);
    const map = this._map(slot);
    if (!map || !map.anchors.length) {
      if (auto) return null;
      throw new FlightError("The desk has no levels around the price yet: the day's 1-minute bars are still coming in.", "not_ready", 409);
    }
    slot.levelsAt = now;
    slot.levelsBusy = true;
    try {
      const pos = { symbol: slot.symbol, side: slot.side, qty: slot.qty, avg: slot.avg, entryAt: slot.entryAt };
      const rec = this.levelsRecord();
      const snapshot = {
        ...this._snapshot(slot),
        minutesLeftToSquareOff: map.minutesLeft,
        oneMinuteMoveRupees: map.sigma1,
        levelMap: map.anchors.map((x) => ({ id: x.id, price: x.price, what: x.label, strength: x.strength, touchesToday: x.touches, awayPct: x.awayPct, touchOddsPct: x.touchPct, ...(x.held ? { heldPct: x.held.pct, heldOfTests: x.held.n } : {}) })),
        // what the desk's other AI features have already found on this stock (paid for once, read by all)
        sessionIn5MinuteBars: { columns: ["time", "open", "high", "low", "close", "volume"], rows: fiveMinute(slot.ctx.bars).slice(-75).map((b) => [clock(b.t), b.o, b.h, b.l, b.c, b.v]) },
        previousDays: { columns: ["date", "open", "high", "low", "close"], rows: slot.daily.filter((c) => c.t < istDate(now)).slice(-5).map((c) => [c.t, c.o, c.h, c.l, c.c]) },
        yourRecordOnThisDesk: rec.judged >= 5 ? { setsScored: rec.judged, firstTargetBeforeStopPct: rec.t1Pct, secondTargetPct: rec.t2Pct, stopCameFirst: rec.stoppedFirst } : null,
      };
      delete snapshot.levels; // the map holds them, with ids
      let r;
      try {
        r = await this.ai.exitAdvisor.research(snapshot);
      } catch (err) {
        throw new FlightError(err && err.message ? err.message : "The AI did not answer.", "ai_failed", 502);
      }
      if (!r) throw new FlightError("The AI model did not answer just now.", "ai_failed", 502);
      this._countAi(r.cached);
      // the price has moved while the model was thinking: the check is made against the price now
      const a = slot.advice;
      const lastNow = slot.tick && num(slot.tick.last) ? slot.tick.last : a.metrics.last;
      const v = verify(r, map, pos, { last: lastNow, coachStop: a.stop, unit: a.metrics.unit });
      const at = this.now();
      const set = { id: `${slot.id}-L${at}`, at, clock: clock(at), by: r.by, auto, why, last: r2(lastNow), confidence: r.confidence, outlook: r.outlook, summary: r.summary, targets: v.targets, stop: v.stop, reversal: v.reversal, rejected: v.rejected, checks: v.checks, failed: !v.targets.length, outcome: null };
      if (!this.slots.has(slot.key)) return set; // it was closed while the AI was thinking
      slot.levels = set;
      slot.flight.levels.push(set);
      if (slot.flight.levels.length > MAX_SETS) slot.flight.levels.splice(0, slot.flight.levels.length - MAX_SETS);
      const said = v.targets.map((t) => `target ${t.n} ${rs(t.level)} (${t.label})`).join(", ");
      this._event(slot, "levels", {
        text: set.failed
          ? `AI levels (${r.by}): none of its targets passed the desk's check${v.rejected[0] ? ` — ${v.rejected[0].why}` : "."}${v.stop ? ` Stop ${rs(v.stop.price)}.` : ""}`
          : `AI levels (${r.by}): ${said}${v.stop ? `, stop ${rs(v.stop.price)}` : ""} — ${v.checks.passed} of ${v.checks.asked} passed the desk's check.`,
      });
      slot.levelsBusy = false; // before the strip is pushed, so the board's button is free again
      this.emit("pos", this._view(slot));
      // only levels that passed the desk's check are shared with the rest of the desk
      if (this.ai && this.ai.shared && !set.failed) {
        try {
          this.ai.shared.publish({ feature: "exit-levels", symbol: slot.symbol, by: r.by, last: lastNow, summary: `${slot.side === "long" ? "Long" : "Short"} from ${rs(slot.avg)}: ${said}${v.stop ? `, stop ${rs(v.stop.price)}` : ""}. ${r.summary}`, tags: { outlook: r.outlook, confidence: r.confidence }, facts: { ...(v.targets[0] ? { target1: v.targets[0].level } : {}), ...(v.targets[1] ? { target2: v.targets[1].level } : {}), ...(v.stop ? { stop: v.stop.price } : {}) }, detail: { checked: `${v.checks.passed} of ${v.checks.asked} choices passed the desk's check`, turn: v.reversal ? { price: v.reversal.price, sign: v.reversal.sign } : null } });
        } catch (_) {
          /* sharing never fails the research */
        }
      }
      return set;
    } finally {
      slot.levelsBusy = false;
    }
  }

  /**
   * After the close: score the sets of AI levels of one day on its 1-minute bars — for each set,
   * which came first from the moment it was given, the target or the stop. Adds them to the record.
   * @returns how many sets were scored now
   */
  async settleLevels(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return 0;
    const now = this.now();
    const close = Date.parse(`${date}T10:00:00Z`); // 3:30 PM IST
    if (now < close + 60000) return 0; // the day is not over
    const mine = this.rec && this.rec.date === date;
    const rec = mine ? this.rec : this.docs.read(dayName(date), null);
    if (!rec || !rec.flights) return 0;
    const doc = this.docs.read(LEVELS, null) || { rows: [] };
    const known = new Set(doc.rows.map((r) => r.id));
    let done = 0;
    for (const f of Object.values(rec.flights)) {
      const sets = (f.levels || []).filter((x) => x && !x.failed && x.targets && x.targets.length && !x.outcome);
      if (!sets.length) continue;
      let bars;
      try {
        bars = await this.market.minuteBarsBetween(f.symbol, sets[0].at - 60000, close);
      } catch (_) {
        continue; // tried again the next time the day is opened
      }
      if (!Array.isArray(bars) || !bars.length) continue;
      for (const set of sets) {
        const out = settle(set, { side: f.side, avg: f.avg }, bars);
        set.outcome = { ...out, t1Clock: out.t1At ? clock(out.t1At) : null, t2Clock: out.t2At ? clock(out.t2At) : null, stopClock: out.stopAt ? clock(out.stopAt) : null, settledAt: now };
        if (!known.has(set.id)) doc.rows.push({ id: set.id, date, symbol: f.symbol, side: f.side, by: set.by, t1: out.t1, t2: out.t2, stop: out.stop });
        done += 1;
      }
    }
    if (done) {
      doc.rows = doc.rows.slice(-400);
      this.docs.write(LEVELS, doc);
      if (mine) this._save();
      else this.docs.write(dayName(date), rec);
    }
    return done;
  }

  /* ------------------------------------------------------------------------- what is shown */
  _view(slot, { light = false } = {}) {
    const v = { key: slot.key, symbol: slot.symbol, exchange: slot.exchange, product: slot.product, side: slot.side, qty: slot.qty, avg: slot.avg, entryAt: slot.entryAt, entryClock: clock(slot.entryAt), advice: slot.advice, ai: slot.ai, at: slot.lookAt };
    if (light) return v;
    const from = slot.entryAt - 15 * 60000;
    const map = this._map(slot) || slot.map;
    return {
      ...v,
      path: slot.ctx.bars.filter((b) => b.t >= from).slice(-240).map((b) => [b.t, b.c]),
      frames: slot.flight.snaps.slice(-240).map((x) => [x[0], x[6], x[7]]), // time, exit pressure, signal
      events: slot.flight.events.slice(-14),
      levels: slot.levels,
      levelsBusy: slot.levelsBusy,
      map: map ? { at: map.at, last: map.last, anchors: [...map.anchors.filter((x) => x.side === "above").slice(-5), ...map.anchors.filter((x) => x.side === "below").slice(0, 5)] } : null,
      news: slot.ctx.news,
      pulse: slot.ctx.pulse,
      liveCall: slot.ctx.liveCall,
    };
  }

  /** The whole board. */
  board() {
    const now = this.now();
    const rec = this._record();
    let connected = false;
    try {
      connected = Boolean(this.trading.status().connected);
    } catch (_) {
      connected = false;
    }
    const sq = Date.parse(`${istDate(now)}T09:45:00Z`);
    return {
      at: new Date(now).toISOString(),
      marketOpen: nseOpen(now),
      connected,
      streaming: Boolean(this.market.ticker && this.market.ticker.isLive()),
      minutesToSquareOff: Math.round((sq - now) / 60000),
      positions: [...this.slots.values()].map((s) => this._view(s)),
      other: this.other,
      landed: Object.values(rec.flights)
        .filter((f) => f.exitAt)
        .sort((a, b) => b.exitAt - a.exitAt)
        .map((f) => ({ id: f.id, symbol: f.symbol, side: f.side, qty: f.qty, avg: f.avg, exitAvg: f.exitAvg, pnl: f.pnl, entryClock: f.entryClock, exitClock: f.exitClock, peak: f.final ? f.final.peak : null, givebackPct: f.final ? f.final.givebackPct : null, finalState: f.final ? f.final.state : null, coachExit: (f.events.find((e) => e.kind === "signal" && e.state === "exit-now") || null) })),
      market: { tide: this.mkt.tide, forecast: this.mkt.forecast, mood: this.mkt.mood, goal: typeof this.goal === "function" ? this.goal() : null },
      settings: this.settings(),
      levelsRecord: this.levelsRecord(),
      watch: { ...this.last, running: this.timers.length > 0 },
    };
  }

  /* ------------------------------------------------------------------------------ the clock */
  /** One round of the slow work: positions, the market's inputs, each position's inputs, a look without the stream, the save. */
  async tick() {
    const now = this.now();
    if (!nseOpen(now)) {
      // after the close nothing is flown; anything still on the board is landed by the next read of the positions
      if (this.slots.size && now - (this._posAt || 0) >= POS_MS * 3) {
        this._posAt = now;
        await this.sync();
      }
      if (this.dirty) this._save();
      // once the day is over, the day's sets of AI levels are scored on its 1-minute bars
      if (now - (this._settleAt || 0) >= 10 * 60000 && this.rec && Object.values(this.rec.flights).some((f) => (f.levels || []).some((x) => !x.failed && !x.outcome))) {
        this._settleAt = now;
        await this.settleLevels(this.rec.date).catch(() => {});
      }
      return;
    }
    if (now - (this._posAt || 0) >= POS_MS) {
      this._posAt = now;
      await this.sync();
    }
    if (!this.slots.size) return;
    if (now - this.mkt.at >= MKT_MS) await this._market().catch(() => {});
    const live = Boolean(this.market.ticker && this.market.ticker.isLive());
    for (const slot of [...this.slots.values()]) {
      if (now - slot.ctx.at >= CTX_MS) await this._context(slot).catch(() => {});
      // the AI's levels, only when they are needed: at the start, when a level was reached, when they went stale
      const need = this._levelsNeed(slot, now);
      if (need) this.researchLevels(slot.key, { auto: true, why: need }).catch(() => {});
      // no streamed tick lately (the stream is down, or the stock is quiet): look with a quote
      if (!live || now - slot.lookAt > 4000) {
        try {
          const q = (await this.market.quotes([slot.symbol])).quotes[slot.symbol];
          if (q && num(q.last)) this._look(slot, q, { force: true });
        } catch (_) {
          /* the next round tries again */
        }
      }
    }
    if (this.dirty && now - (this._savedAt || 0) >= SAVE_MS) {
      this._savedAt = now;
      this._save();
    }
  }

  start() {
    if (this.timers.length) return;
    if (this.market.ticker) this.market.ticker.on("tick", this._onTick);
    const t = setInterval(() => {
      this.tick().catch((err) => this.log.error(`[flight] ${err.message}`));
    }, 2000);
    if (t.unref) t.unref();
    this.timers.push(t);
  }

  stop() {
    this.timers.forEach((t) => clearInterval(t));
    this.timers = [];
    if (this.market.ticker) this.market.ticker.off("tick", this._onTick);
    for (const slot of this.slots.values()) if (slot.release) slot.release();
    if (this.dirty) this._save();
  }
}

module.exports = { FlightDeck, FlightError, COLS };
