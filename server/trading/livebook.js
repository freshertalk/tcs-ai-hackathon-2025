"use strict";
// The live book: Zerodha's positions, re-priced on every streamed tick — the one source of the day's
// P&L for every screen (the top bar, the positions dock, the daily goal, the Positions page) and for
// the daily goal's own check on the server.
//
//   BASE   Zerodha's positions (GET /portfolio/positions) carry its own P&L figures and the price they
//          were worked out at. They are read when an order update arrives (at once, then 1.5 s and 5 s
//          later — Zerodha's positions catch up with a fill a moment after the order says COMPLETE),
//          every 15 seconds in market hours while a page is looking or the daily goal is on, and every
//          minute outside market hours while a page is looking.
//   TICK   Zerodha's P&L moves in a straight line with the price: quantity × multiplier × the change.
//          So each position is moved from its base by the streamed price for its instrument (any
//          exchange: the stream is keyed by instrument token). A price older than the base is not used.
//   PUSH   every change goes to the pages over the trading stream they already hold open (at most four
//          pushes a second), so nothing on screen waits for a poll.
//
// In market hours it also keeps one index subscribed, so Zerodha's socket stays up and order updates
// (which arrive on it as text frames) keep coming even with no page open and no position held.
//
// It only reads the account and the market. It never places, changes or cancels an order. It lives
// outside server/ai, which holds no timers.

const { EventEmitter } = require("node:events");
const { nseOpen } = require("../alert-watch");

const BASE_MS = 15000; // the base is read this often in market hours (while needed)
const IDLE_MS = 60000; // … and this often outside them (while a page is looking)
const FRESH_MS = 20000; // a base this young serves the daily goal's check without a new read
const EMIT_MS = 250; // at most four pushes a second
const LOOP_MS = 2000;
const AFTER_ORDER = [0, 1500, 5000];
const KEEPALIVE_TOKEN = 256265; // NIFTY 50: keeps the socket (and its order updates) up in market hours

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => Math.round(x * 100) / 100;
const keyOf = (p) => `${p.exchange}:${p.symbol}:${p.product}`;

/**
 * One position at the price `last`, by Zerodha's own formulas: P&L = sell value − buy value +
 * quantity × price × multiplier; the day's M2M and the unrealised part move by the same amount.
 * A closed position (quantity 0) does not move with the price.
 */
function reprice(p, last) {
  if (!p || p.quantity === 0 || !num(last) || last <= 0) return { ...p, live: false };
  const mult = num(p.multiplier) && p.multiplier > 0 ? p.multiplier : 1;
  const pnl = num(p.sellValue) && num(p.buyValue) ? p.sellValue - p.buyValue + p.quantity * last * mult : (num(p.pnl) ? p.pnl : 0) + (num(p.last) && p.last > 0 ? p.quantity * mult * (last - p.last) : 0);
  // how far the price has moved the P&L since the base: applied to the figures Zerodha gave
  const base = num(p.last) && p.last > 0 ? p.quantity * mult * (last - p.last) : pnl - (num(p.pnl) ? p.pnl : 0);
  return {
    ...p,
    last,
    pnl: r2(pnl),
    m2m: r2((num(p.m2m) ? p.m2m : num(p.pnl) ? p.pnl : 0) + base),
    unrealised: r2((num(p.unrealised) ? p.unrealised : 0) + base),
    live: true,
  };
}

/** The day's figures over a set of (re-priced) positions. `day` is the day's M2M, as the goal counts it. */
function totals(rows) {
  const sum = (f) => r2(rows.reduce((a, p) => a + (num(p[f]) ? p[f] : 0), 0));
  const open = rows.filter((p) => p.quantity !== 0);
  return {
    day: r2(rows.reduce((a, p) => a + (num(p.m2m) ? p.m2m : num(p.pnl) ? p.pnl : 0), 0)),
    pnl: sum("pnl"),
    realised: sum("realised"),
    unrealised: sum("unrealised"),
    open: open.length,
    closed: rows.length - open.length,
    // every open position is moving with the stream (true with none open: nothing can be out of date)
    live: open.every((p) => p.live),
  };
}

class LiveBook extends EventEmitter {
  constructor({ trading, market, now = () => Date.now(), log = console, isOpen = nseOpen, every = BASE_MS, idleEvery = IDLE_MS, emitMs = EMIT_MS, loopMs = LOOP_MS, afterOrder = AFTER_ORDER, keepAliveToken = KEEPALIVE_TOKEN }) {
    super();
    this.setMaxListeners(200);
    this.trading = trading;
    this.market = market;
    this.now = now;
    this.log = log;
    this.isOpen = isOpen;
    this.every = every;
    this.idleEvery = idleEvery;
    this.emitMs = emitMs;
    this.loopMs = loopMs;
    this.afterOrder = afterOrder;
    this.keepAliveToken = keepAliveToken;
    this.base = null; // { net, day, at }
    this.error = "";
    this.prices = new Map(); // token → { last, at }
    this.subscribed = new Set(); // tokens this book holds on the ticker
    this.keepAlive = false;
    this.watchers = 0;
    this.needed = () => false; // set by the app: true while the daily goal is on
    this.timers = [];
    this._after = [];
    this._emitTimer = null;
    this._busy = null;
    this._onTick = (t) => this._tick(t);
    this._onState = (s) => {
      if (!s || s.state !== "live") {
        // a price is only used while the stream is live: until it is back the base's prices stand
        if (this.prices.size) {
          this.prices.clear();
          this._push();
        }
      }
    };
    this._offOrders = null;
  }

  /* ------------------------------------------------------------------ running */
  start() {
    if (this.timers.length) return;
    const tk = this.market && this.market.ticker;
    if (tk) {
      tk.on("tick", this._onTick);
      tk.on("state", this._onState);
    }
    // order updates: straight from the trading service's listeners (its stream() would also send a
    // "hello" with the account's status, which this does not need); never a reason for the app not to start
    try {
      if (this.trading && this.trading._listeners instanceof Set) {
        const fn = (u) => this._order(u);
        this.trading._listeners.add(fn);
        this._offOrders = () => this.trading._listeners.delete(fn);
      } else if (this.trading && typeof this.trading.stream === "function") {
        this._offOrders = this.trading.stream((ev) => {
          if (ev && ev.type === "order") this._order(ev.update);
        });
      }
    } catch (err) {
      this.log.error(`[livebook] order updates not followed: ${err && err.message ? err.message : err}`);
    }
    const t = setInterval(() => this._loop().catch(() => {}), this.loopMs);
    if (t.unref) t.unref();
    this.timers.push(t);
  }

  stop() {
    this.timers.forEach((t) => clearInterval(t));
    this.timers = [];
    this._after.forEach((t) => clearTimeout(t));
    this._after = [];
    clearTimeout(this._emitTimer);
    this._emitTimer = null;
    const tk = this.market && this.market.ticker;
    if (tk) {
      tk.off("tick", this._onTick);
      tk.off("state", this._onState);
    }
    if (this._offOrders) this._offOrders();
    this._offOrders = null;
    this._hold([]);
    this._keep(false);
  }

  _connected() {
    try {
      return Boolean(this.trading.status().connected);
    } catch (_) {
      return false;
    }
  }

  async _loop() {
    const connected = this._connected();
    const open = this.isOpen(this.now());
    this._keep(connected && open);
    if (!connected) {
      if (this.base) {
        this.base = null;
        this.error = "";
        this._hold([]);
        this._push(true);
      }
      return;
    }
    const want = this.watchers > 0 || (open && this.needed());
    const gap = open ? this.every : this.idleEvery;
    if (want && (!this.base || this.now() - this.base.at >= gap)) await this.refresh();
  }

  /** In market hours one index stays subscribed, so the socket — and the order updates on it — stay up. */
  _keep(on) {
    const tk = this.market && this.market.ticker;
    if (!tk || on === this.keepAlive) return;
    this.keepAlive = on;
    if (on) tk.subscribe([this.keepAliveToken]);
    else tk.unsubscribe([this.keepAliveToken]);
  }

  /** Hold exactly these tokens on the ticker (the open positions'); let the rest go. */
  _hold(tokens) {
    const tk = this.market && this.market.ticker;
    const next = new Set(tokens.filter((t) => Number.isInteger(t) && t > 0));
    const add = [...next].filter((t) => !this.subscribed.has(t));
    const drop = [...this.subscribed].filter((t) => !next.has(t));
    if (tk) {
      if (add.length) tk.subscribe(add);
      if (drop.length) tk.unsubscribe(drop);
    }
    drop.forEach((t) => this.prices.delete(t));
    this.subscribed = next;
  }

  /** An order changed: read the positions now, and again as Zerodha's book catches up with the fill. */
  _order(u) {
    if (!u) return;
    this._after.forEach((t) => clearTimeout(t));
    this._after = this.afterOrder.map((ms) => {
      const t = setTimeout(() => this.refresh().catch(() => {}), ms);
      if (t.unref) t.unref();
      return t;
    });
  }

  _tick(t) {
    if (!t || !this.subscribed.has(t.token) || !num(t.last)) return;
    const was = this.prices.get(t.token);
    if (was && was.last === t.last) return;
    this.prices.set(t.token, { last: t.last, at: this.now() });
    this._push();
  }

  /* ------------------------------------------------------------------- reads */
  /** Read Zerodha's positions (one read at a time; callers share it). */
  refresh() {
    if (this._busy) return this._busy;
    this._busy = this._refresh().finally(() => {
      this._busy = null;
    });
    return this._busy;
  }

  async _refresh() {
    if (!this._connected()) {
      this.base = null;
      this.error = "";
      this._hold([]);
      this._push(true);
      return this.view();
    }
    try {
      const p = await this.trading.positions();
      const at = this.now();
      this.base = { net: (p && p.net) || [], day: (p && p.day) || [], at };
      this.error = "";
      // a price streamed before this read is older than the base: drop it
      for (const [tok, v] of this.prices) if (v.at < at - 1500) this.prices.delete(tok);
      this._hold(this.base.net.filter((x) => x.quantity !== 0).map((x) => x.token));
    } catch (err) {
      this.error = err && err.message ? err.message : String(err);
    }
    this._push(true);
    return this.view();
  }

  _priced(net) {
    return net.map((p) => {
      const tick = p.quantity !== 0 ? this.prices.get(p.token) : null;
      return tick ? reprice(p, tick.last) : { ...p, live: false };
    });
  }

  /** Zerodha's positions at the streamed prices, in its own shape: { net, day }. */
  positions() {
    if (!this.base) return null;
    return { net: this._priced(this.base.net), day: this.base.day };
  }

  /**
   * The positions for a check that must not act on old numbers (the daily goal): the live book when its
   * base is young enough, else a fresh read. Errors (not connected…) are thrown as the read throws them.
   */
  async fresh(maxAge = FRESH_MS) {
    if (!this.base || this.now() - this.base.at > maxAge || this.error) {
      await this.refresh();
      // the read failed: fail as the read itself would, rather than judge the day on an old base
      if (this.error || !this.base) return this.trading.positions();
    }
    return this.positions();
  }

  /** What the pages are sent. */
  view() {
    const tk = this.market && this.market.ticker;
    if (!this.base) return { at: new Date(this.now()).toISOString(), available: false, connected: this._connected(), error: this.error, streaming: Boolean(tk && tk.isLive && tk.isLive()) };
    const rows = this._priced(this.base.net);
    return {
      at: new Date(this.now()).toISOString(),
      available: true,
      connected: true,
      baseAt: new Date(this.base.at).toISOString(),
      error: this.error,
      streaming: Boolean(tk && tk.isLive && tk.isLive()),
      ...totals(rows),
      positions: rows.map((p) => ({ key: keyOf(p), ...p })),
    };
  }

  /* ----------------------------------------------------------------- pushing */
  _push(now = false) {
    if (!this.listenerCount("book")) return;
    if (now) {
      clearTimeout(this._emitTimer);
      this._emitTimer = null;
      this.emit("book", this.view());
      return;
    }
    if (this._emitTimer) return;
    this._emitTimer = setTimeout(() => {
      this._emitTimer = null;
      this.emit("book", this.view());
    }, this.emitMs);
    if (this._emitTimer.unref) this._emitTimer.unref();
  }

  /** A page wants the live book: `send(view)` on every change until the returned function is called. */
  watch(send) {
    this.watchers += 1;
    this.on("book", send);
    if (this.base) send(this.view());
    if (!this.base || this.now() - this.base.at > FRESH_MS) this.refresh().catch(() => {});
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.watchers = Math.max(0, this.watchers - 1);
      this.off("book", send);
    };
  }
}

module.exports = { LiveBook, reprice, totals, keyOf };
