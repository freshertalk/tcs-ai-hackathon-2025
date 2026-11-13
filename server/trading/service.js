"use strict";
// Trading: the account (funds, holdings, positions, orders, trades) and — only while the
// trading switch is ON — placing, modifying and cancelling orders, exiting positions and
// selling holdings. Built as a fallback for days when the Kite app or website is down but
// Zerodha's API still answers.
//
// Guard rails, all enforced here on the server (the page only mirrors them):
// - The switch. OFF by default; while it is off every route that would change anything
//   refuses with 423, whatever the page sends. Only the superadmin can turn it on.
// - Every order needs `confirm: true` and a fresh `clientRef`: a double click, a retried
//   request or a second tab cannot place the same order twice (the first answer is
//   returned again for two minutes).
// - A limit on quantity and on value per order, set on the page. An order that only
//   reduces what is already held (an exit) is not stopped by the value limit.
// - Market orders always carry Zerodha's market protection, so they become limit orders
//   at a bounded distance instead of filling at any price.
// - Every change and every order — accepted or refused — is written to an audit log.
//
// Nothing here runs by itself: no timer, no AI. The AI folder can read positions that the
// routes hand it, but it has no way to reach this module.

const path = require("path");
const { FileDocs } = require("../docs");
const { KiteError } = require("../market/kite");
const { KiteBroker } = require("./broker");
const risk = require("./risk");
const { TradeJournal, excursion } = require("./journal");

const EXCHANGES = ["NSE", "BSE", "NFO", "BFO", "MCX", "CDS", "BCD"];
const CASH = new Set(["NSE", "BSE"]);
const SIDES = ["BUY", "SELL"];
const TYPES = ["MARKET", "LIMIT", "SL", "SL-M"];
const PRODUCTS = ["CNC", "MIS", "NRML"];
const VARIETIES = ["regular", "amo"];
const VALIDITIES = ["DAY", "IOC"];
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9&_.-]{0,39}$/;
const ORDER_ID_RE = /^[0-9A-Za-z]{4,40}$/;
const REF_RE = /^[A-Za-z0-9_-]{8,64}$/;
const LIVE = new Set(["OPEN", "TRIGGER PENDING", "AMO REQ RECEIVED", "OPEN PENDING", "VALIDATION PENDING", "PUT ORDER REQ RECEIVED", "MODIFY PENDING", "MODIFY VALIDATION PENDING"]);
const TAG = "vptdesk";
const REF_MS = 2 * 60000;
const DEFAULTS = { maxQty: 5000, maxValue: 500000, protection: -1 };

class TradingError extends Error {
  constructor(message, code = "invalid", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const num = (x) => (x === "" || x === null || x === undefined ? NaN : Number(x));
const round2 = (x) => Math.round(x * 100) / 100;

class TradingService {
  /**
   * @param market  the MarketService: the day's Kite login and the live ticker come from it
   */
  /** @param docs  the record store (server/docs.js): the audit log is "trading/audit" */
  constructor({ dir, store, market, fetchImpl = globalThis.fetch, now = () => Date.now(), log = console, gapMs, docs }) {
    this.dir = path.join(dir, "trading");
    this.docs = docs || store.docs || new FileDocs(dir);
    this.journal = new TradeJournal(this.docs);
    this.store = store;
    this.market = market;
    this.fetch = fetchImpl;
    this.now = now;
    this.log = log;
    this.gapMs = gapMs;
    this._broker = null;
    this._brokerKey = "";
    this._refs = new Map(); // clientRef → { at, result | promise }
    this._updates = []; // the latest order updates from Zerodha's stream
    this._listeners = new Set();
    if (!this.store.data.trading) this.store.update((d) => (d.trading = { enabled: false, changedAt: null, changedBy: "", ...DEFAULTS }));
    // order updates arrive on the market-data socket as text frames
    if (market && market.ticker) {
      market.ticker.on("text", (m) => {
        if (!m || m.type !== "order" || !m.data) return;
        const o = m.data;
        const u = { at: new Date(this.now()).toISOString(), id: String(o.order_id || ""), status: String(o.status || ""), symbol: o.tradingsymbol || "", side: o.transaction_type || "", filled: Number(o.filled_quantity) || 0, quantity: Number(o.quantity) || 0, average: Number(o.average_price) || 0, message: o.status_message || "" };
        this._updates.unshift(u);
        this._updates.length = Math.min(this._updates.length, 50);
        for (const fn of this._listeners) fn(u);
      });
    }
  }

  /* --------------------------------------------------------------- state */

  _state() {
    return { ...DEFAULTS, ...(this.store.data.trading || {}) };
  }

  status() {
    const s = this._state();
    const k = this.market.kiteState();
    return {
      enabled: Boolean(s.enabled),
      changedAt: s.changedAt,
      changedBy: s.changedBy,
      limits: { maxQty: s.maxQty, maxValue: s.maxValue },
      protection: s.protection,
      connected: k.connected,
      user: k.user,
      updates: this._updates.slice(0, 20),
      streaming: Boolean(this.market.ticker && this.market.ticker.isLive()),
      // the risk guard's rules and today's lock, if any (the live standing needs Zerodha: riskStatus())
      risk: this._risk(),
      riskLock: this._riskLock(),
    };
  }

  /* ----------------------------------------------------------- risk guard */

  _risk() {
    return risk.cleanConfig({ ...risk.RISK_DEFAULTS, ...(this._state().risk || {}) });
  }

  _riskLock() {
    const l = this._state().riskLock;
    return l && l.day === risk.istDay(this.now()) ? l : null;
  }

  /** Where the account stands against the guard right now; locks the day on a breach. */
  async riskStatus() {
    const cfg = this._risk();
    const [{ net }, orders] = await Promise.all([this.positions(), this.orders()]);
    const dayPnl = net.reduce((a, p) => a + (Number.isFinite(p.m2m) ? p.m2m : p.pnl), 0);
    const openSymbols = new Set(net.filter((p) => p.quantity !== 0).map((p) => `${p.exchange}:${p.symbol}`));
    const ordersToday = orders.filter((o) => o.status === "COMPLETE").length;
    const st = risk.standing({ cfg, lock: this._riskLock(), now: this.now(), dayPnl, ordersToday, openSymbols });
    if (cfg.enabled && st.breach && !st.lock) {
      const lock = { day: risk.istDay(this.now()), kind: st.breach.kind, reason: st.breach.reason, at: new Date(this.now()).toISOString() };
      this.store.update((d) => {
        d.trading = { ...this._state(), riskLock: lock };
      });
      this._audit("risk guard", "risk-lock", { dayPnl: Math.round(dayPnl) }, { ok: true, reason: lock.reason });
      this.log.log(`[trading] risk guard locked the day: ${lock.reason}`);
      st.lock = lock;
    }
    return { ...st, config: cfg, openSymbols: [...openSymbols] };
  }

  setRisk(input, by) {
    const next = risk.cleanConfig(input || {});
    const cur = this._risk();
    if (this._riskLock() && risk.loosens(cur, next)) {
      throw new TradingError("The day is locked by the risk guard: limits can be tightened now, but not loosened or switched off until tomorrow.", "risk_locked", 409);
    }
    this.store.update((d) => {
      d.trading = { ...this._state(), risk: next };
    });
    this._audit(by, "risk-rules", next, { ok: true });
    return this.status();
  }

  /** Throws when the guard refuses an order that would add risk. */
  async _guard(order) {
    const cfg = this._risk();
    if (!cfg.enabled) return;
    if (await this._reduces(order)) return; // getting out is never blocked
    const st = await this.riskStatus();
    const no = risk.refusal(st, cfg, { opening: true, symbol: `${order.exchange}:${order.symbol}`, openSymbols: new Set(st.openSymbols) });
    if (no) throw new TradingError(no.message, no.code, 423);
  }

  setSwitch(on, by) {
    const enabled = Boolean(on);
    this.store.update((d) => {
      d.trading = { ...this._state(), enabled, changedAt: new Date(this.now()).toISOString(), changedBy: by };
    });
    this._audit(by, enabled ? "switch-on" : "switch-off", {}, { ok: true });
    this.log.log(`[trading] switch turned ${enabled ? "ON" : "OFF"} by ${by}`);
    return this.status();
  }

  setLimits({ maxQty, maxValue }, by) {
    const q = Math.floor(num(maxQty));
    const v = Math.floor(num(maxValue));
    if (!(q >= 1 && q <= 1000000)) throw new TradingError("The quantity limit must be between 1 and 10,00,000.");
    if (!(v >= 1000 && v <= 100000000)) throw new TradingError("The value limit must be between ₹1,000 and ₹10 crore.");
    this.store.update((d) => {
      d.trading = { ...this._state(), maxQty: q, maxValue: v };
    });
    this._audit(by, "limits", { maxQty: q, maxValue: v }, { ok: true });
    return this.status();
  }

  /* ----------------------------------------------------------- audit log */

  _audit(by, action, input, result) {
    try {
      this.docs.append("trading/audit", { at: new Date(this.now()).toISOString(), by, action, input, result });
    } catch (err) {
      this.log.error("[trading] could not write the audit log:", err.message);
    }
  }

  audit(limit = 100) {
    return this.docs.tail("trading/audit", limit).reverse();
  }

  /* -------------------------------------------------------------- broker */

  _client() {
    const auth = this.market.kiteAuth();
    if (!auth) throw new TradingError("Zerodha is not connected. Log in to Kite on the Trading desk first.", "not_connected", 409);
    const key = `${auth.apiKey}:${auth.accessToken}`;
    if (!this._broker || this._brokerKey !== key) {
      this._broker = new KiteBroker({ ...auth, fetchImpl: this.fetch, ...(this.gapMs !== undefined ? { gapMs: this.gapMs } : {}) });
      this._brokerKey = key;
    }
    return this._broker;
  }

  async _call(fn) {
    try {
      return await fn(this._client());
    } catch (err) {
      if (err instanceof KiteError && err.tokenExpired) {
        this.market.forgetSession();
        this._broker = null;
        throw new TradingError("The Kite session has expired. Log in to Kite again.", "not_connected", 409);
      }
      throw err;
    }
  }

  /* --------------------------------------------------------------- reads */

  funds() {
    return this._call((b) => b.funds());
  }
  holdings() {
    return this._call((b) => b.holdings());
  }
  positions() {
    return this._call((b) => b.positions());
  }
  orders() {
    return this._call((b) => b.orders());
  }
  trades() {
    return this._call((b) => b.trades());
  }
  orderHistory(id) {
    if (!ORDER_ID_RE.test(String(id || ""))) throw new TradingError("That is not an order id.");
    return this._call((b) => b.orderHistory(String(id)));
  }

  /** Everything the account screen shows, in one round trip. A part that fails says so. */
  async summary() {
    this._client(); // not connected → one clear error instead of five
    const parts = { funds: () => this.funds(), positions: () => this.positions(), holdings: () => this.holdings(), orders: () => this.orders(), trades: () => this.trades() };
    const out = { at: new Date(this.now()).toISOString(), errors: {} };
    await Promise.all(
      Object.entries(parts).map(async ([k, fn]) => {
        try {
          out[k] = await fn();
        } catch (err) {
          if (err instanceof TradingError && err.code === "not_connected") throw err;
          out[k] = null;
          out.errors[k] = err && err.message ? err.message : "failed";
        }
      })
    );
    out.status = this.status();
    // Zerodha only ever returns today's trades: keep each one in the journal as it is seen
    if (Array.isArray(out.trades)) {
      try {
        this.journal.ingestKite(out.trades);
      } catch (err) {
        this.log.error("[trading] journal:", err.message);
      }
    }
    return out;
  }

  /* --------------------------------------------------------------- journal */

  /** The journal, with today's trades brought in first when Zerodha is connected. */
  async journalView(filters) {
    if (this.market.kiteAuth()) {
      try {
        this.journal.ingestKite(await this.trades());
      } catch (_) {
        /* the stored journal is still worth showing */
      }
    }
    return this.journal.view(filters);
  }

  /**
   * MAE / MFE for recent closed NSE round trips that do not have them yet, from 1-minute bars
   * (Zerodha keeps about 60 days). Reads only.
   */
  async excursions({ limit = 25 } = {}) {
    const since = this.now() - 58 * 86400000;
    const candidates = this.journal.trips({}).filter((t) => !t.open && !t.exc && t.exchange === "NSE" && t.entryAt >= since);
    const todo = candidates.slice(-Math.max(1, Math.min(60, limit)));
    let done = 0;
    const failed = [];
    for (const t of todo) {
      try {
        const bars = await this.market.minuteBarsBetween(t.symbol, t.entryAt - 60000, t.exitAt + 60000);
        const e = excursion(t, bars);
        this.journal.setExcursion(t.key, e || { none: true });
        done += 1;
      } catch (err) {
        // a symbol Zerodha does not know (renamed, delisted) will never measure: note it and move on
        if (err && err.code === "unknown_symbol") this.journal.setExcursion(t.key, { none: true, reason: err.message });
        failed.push(`${t.symbol}: ${err.message}`);
      }
    }
    return { done, failed: [...new Set(failed)].slice(0, 5), left: candidates.length - todo.length };
  }

  /* --------------------------------------------------------------- writes */

  _requireOn() {
    if (!this._state().enabled) throw new TradingError("Trading is switched OFF. Turn the trading switch on to place, change or cancel orders.", "trading_off", 423);
  }

  /** Checks an order and turns it into Kite's parameters. Throws on anything doubtful. */
  _form(o) {
    const exchange = String(o.exchange || "").toUpperCase();
    const symbol = String(o.symbol || "").trim().toUpperCase();
    const side = String(o.side || "").toUpperCase();
    const type = String(o.type || "").toUpperCase();
    const product = String(o.product || "").toUpperCase();
    const validity = String(o.validity || "DAY").toUpperCase();
    const quantity = num(o.quantity);
    const price = num(o.price);
    const trigger = num(o.trigger);
    if (!EXCHANGES.includes(exchange)) throw new TradingError("Choose an exchange: NSE, BSE, NFO, BFO, MCX, CDS or BCD.");
    if (!SYMBOL_RE.test(symbol)) throw new TradingError("That is not a valid trading symbol.");
    if (!SIDES.includes(side)) throw new TradingError("The order must be a BUY or a SELL.");
    if (!TYPES.includes(type)) throw new TradingError("The order type must be MARKET, LIMIT, SL or SL-M.");
    if (!PRODUCTS.includes(product)) throw new TradingError("The product must be CNC (delivery), MIS (intraday) or NRML (F&O carry-forward).");
    if (product === "CNC" && !CASH.has(exchange)) throw new TradingError("CNC (delivery) is for NSE and BSE stocks. Use NRML or MIS for F&O.");
    if (product === "NRML" && CASH.has(exchange)) throw new TradingError("NRML is for F&O and commodities. Use CNC (delivery) or MIS (intraday) for stocks.");
    if (!VALIDITIES.includes(validity)) throw new TradingError("Validity must be DAY or IOC.");
    if (!(Number.isInteger(quantity) && quantity >= 1 && quantity <= 1000000)) throw new TradingError("The quantity must be a whole number above zero.");
    const form = { exchange, tradingsymbol: symbol, transaction_type: side, order_type: type, product, quantity: String(quantity), validity, tag: TAG };
    if (type === "LIMIT" || type === "SL") {
      if (!(price > 0)) throw new TradingError("A LIMIT or SL order needs a price above zero.");
      form.price = String(round2(price));
    }
    if (type === "SL" || type === "SL-M") {
      if (!(trigger > 0)) throw new TradingError("An SL or SL-M order needs a trigger price above zero.");
      form.trigger_price = String(round2(trigger));
    }
    if (type === "SL") {
      // a buy stop triggers on the way up and is filled at or below its limit; a sell stop the reverse
      if (side === "BUY" && trigger > price) throw new TradingError("For an SL buy, the trigger price must be at or below the limit price.");
      if (side === "SELL" && trigger < price) throw new TradingError("For an SL sell, the trigger price must be at or above the limit price.");
    }
    if (type === "MARKET" || type === "SL-M") {
      const p = o.protection === undefined || o.protection === null || o.protection === "" ? this._state().protection : num(o.protection);
      if (!(p === -1 || (p > 0 && p <= 100))) throw new TradingError("Market protection must be -1 (Zerodha's automatic limit) or a percentage above 0 and up to 100.");
      form.market_protection = String(p);
    }
    const variety = VARIETIES.includes(String(o.variety || "regular")) ? String(o.variety || "regular") : null;
    if (!variety) throw new TradingError("The variety must be regular or amo (after-market order).");
    return { variety, form, quantity, price: Number.isFinite(price) ? price : null, side, exchange, symbol, product };
  }

  /** Does this order only reduce what is already held? (then the value limit does not apply) */
  async _reduces({ exchange, symbol, product, side, quantity }) {
    try {
      const { net } = await this.positions();
      const p = net.find((x) => x.exchange === exchange && x.symbol === symbol && x.product === product && x.quantity !== 0);
      if (p && ((p.quantity > 0 && side === "SELL") || (p.quantity < 0 && side === "BUY")) && quantity <= Math.abs(p.quantity)) return true;
      if (product === "CNC" && side === "SELL") {
        const h = (await this.holdings()).find((x) => x.exchange === exchange && x.symbol === symbol);
        if (h && quantity <= h.quantity + h.t1) return true;
      }
    } catch (_) {
      return false;
    }
    return false;
  }

  async _limits(order, refPrice) {
    const s = this._state();
    if (order.quantity > s.maxQty) {
      if (!(await this._reduces(order))) throw new TradingError(`The quantity ${order.quantity} is above your limit of ${s.maxQty} per order. Raise the limit on the page if this is intended.`, "over_limit", 422);
    }
    const px = order.price || refPrice;
    if (px && order.quantity * px > s.maxValue) {
      if (!(await this._reduces(order))) throw new TradingError(`This order is worth about ₹${Math.round(order.quantity * px).toLocaleString("en-IN")}, above your limit of ₹${s.maxValue.toLocaleString("en-IN")} per order. Raise the limit on the page if this is intended.`, "over_limit", 422);
    }
  }

  /** Runs one write once per clientRef; a repeat within two minutes gets the first answer. */
  async _once(ref, fn) {
    if (!REF_RE.test(String(ref || ""))) throw new TradingError("Missing request reference. Reload the page and try again.");
    const now = this.now();
    for (const [k, v] of this._refs) if (now - v.at > REF_MS) this._refs.delete(k);
    const hit = this._refs.get(ref);
    if (hit) return { ...(await hit.promise), repeated: true };
    const promise = fn();
    this._refs.set(ref, { at: now, promise });
    try {
      return await promise;
    } catch (err) {
      this._refs.delete(ref); // a refused order can be corrected and sent again
      throw err;
    }
  }

  async _send(by, action, order, fn) {
    try {
      const r = await fn();
      this._audit(by, action, order, { ok: true, ...r });
      this.log.log(`[trading] ${action} by ${by}: ${[order.transaction_type, order.quantity, order.tradingsymbol || order.id].filter(Boolean).join(" ")} → ${r.orderId || "ok"}`);
      return r;
    } catch (err) {
      this._audit(by, action, order, { ok: false, error: err.message });
      if (err instanceof KiteError && err.tokenExpired) {
        this.market.forgetSession();
        this._broker = null;
        throw new TradingError("The Kite session has expired. Log in to Kite again.", "not_connected", 409);
      }
      if (err instanceof KiteError) throw new TradingError(`Zerodha refused it: ${err.message}`, "kite_refused", 422);
      throw err;
    }
  }

  async place(input, by) {
    this._requireOn();
    if (!input || input.confirm !== true) throw new TradingError("The order was not confirmed.", "unconfirmed");
    const order = this._form(input);
    return this._once(input.clientRef, async () => {
      await this._guard(order);
      await this._limits(order, num(input.refPrice) > 0 ? num(input.refPrice) : null);
      const r = await this._send(by, "place", { variety: order.variety, ...order.form }, () => this._client().place(order.variety, order.form));
      return { ...r, variety: order.variety };
    });
  }

  async modify(variety, id, input, by) {
    this._requireOn();
    if (!VARIETIES.includes(variety)) throw new TradingError("The variety must be regular or amo.");
    if (!ORDER_ID_RE.test(String(id || ""))) throw new TradingError("That is not an order id.");
    if (!input || input.confirm !== true) throw new TradingError("The change was not confirmed.", "unconfirmed");
    const form = {};
    const type = input.type ? String(input.type).toUpperCase() : "";
    if (type) {
      if (!TYPES.includes(type)) throw new TradingError("The order type must be MARKET, LIMIT, SL or SL-M.");
      form.order_type = type;
    }
    if (input.quantity !== undefined && input.quantity !== "") {
      const q = num(input.quantity);
      if (!(Number.isInteger(q) && q >= 1 && q <= this._state().maxQty)) throw new TradingError(`The quantity must be a whole number from 1 to your limit of ${this._state().maxQty}.`);
      form.quantity = String(q);
    }
    if (input.price !== undefined && input.price !== "") {
      if (!(num(input.price) > 0)) throw new TradingError("The price must be above zero.");
      form.price = String(round2(num(input.price)));
    }
    if (input.trigger !== undefined && input.trigger !== "") {
      if (!(num(input.trigger) > 0)) throw new TradingError("The trigger price must be above zero.");
      form.trigger_price = String(round2(num(input.trigger)));
    }
    if (type === "MARKET" || type === "SL-M") form.market_protection = String(this._state().protection);
    if (!Object.keys(form).length) throw new TradingError("Nothing to change.");
    // on a locked day an order may still be changed if it closes a position (a stop-loss, say)
    if (this._risk().enabled && this._riskLock()) {
      const o = (await this.orders()).find((x) => x.id === String(id));
      const closes = o && (await this._reduces({ exchange: o.exchange, symbol: o.symbol, product: o.product, side: o.side, quantity: Number(form.quantity || o.pending || o.quantity) }));
      if (!closes) throw new TradingError("Risk guard: the day is locked. Only orders that close a position can be changed until tomorrow.", "risk_locked", 423);
    }
    return this._once(input.clientRef, () => this._send(by, "modify", { id, variety, ...form }, () => this._client().modify(variety, id, form)));
  }

  async cancel(variety, id, input, by) {
    this._requireOn();
    if (!VARIETIES.includes(variety)) throw new TradingError("The variety must be regular or amo.");
    if (!ORDER_ID_RE.test(String(id || ""))) throw new TradingError("That is not an order id.");
    return this._once((input && input.clientRef) || "", () => this._send(by, "cancel", { id, variety }, () => this._client().cancel(variety, id)));
  }

  /** Close (part of) one open position with an opposite order. */
  async exit(input, by) {
    this._requireOn();
    if (!input || input.confirm !== true) throw new TradingError("The exit was not confirmed.", "unconfirmed");
    const exchange = String(input.exchange || "").toUpperCase();
    const symbol = String(input.symbol || "").toUpperCase();
    const product = String(input.product || "").toUpperCase();
    return this._once(input.clientRef, async () => {
      const { net } = await this.positions();
      const p = net.find((x) => x.exchange === exchange && x.symbol === symbol && x.product === product && x.quantity !== 0);
      if (!p) throw new TradingError("There is no open position in that symbol and product any more.", "no_position", 409);
      const want = input.quantity === undefined || input.quantity === "" ? Math.abs(p.quantity) : num(input.quantity);
      if (!(Number.isInteger(want) && want >= 1 && want <= Math.abs(p.quantity))) throw new TradingError(`Exit quantity must be from 1 to ${Math.abs(p.quantity)}.`);
      const type = String(input.type || "MARKET").toUpperCase() === "LIMIT" ? "LIMIT" : "MARKET";
      const order = this._form({ exchange, symbol, product, side: p.quantity > 0 ? "SELL" : "BUY", type, quantity: want, price: input.price, protection: input.protection });
      const r = await this._send(by, "exit", { variety: order.variety, ...order.form }, () => this._client().place(order.variety, order.form));
      return { ...r, variety: order.variety, side: order.side, quantity: want };
    });
  }

  /** Emergency: optionally cancel every pending order, then exit every open position at market. */
  async exitAll(input, by) {
    this._requireOn();
    if (!input || input.confirm !== "EXIT ALL") throw new TradingError('Type EXIT ALL to confirm.', "unconfirmed");
    return this._once(input.clientRef, async () => {
      const results = [];
      if (input.cancelOpen) {
        const pending = (await this.orders()).filter((o) => LIVE.has(o.status) && !o.parentId);
        for (const o of pending) {
          try {
            const r = await this._send(by, "cancel (exit all)", { id: o.id, variety: o.variety }, () => this._client().cancel(o.variety, o.id));
            results.push({ kind: "cancel", symbol: o.symbol, orderId: r.orderId, ok: true });
          } catch (err) {
            results.push({ kind: "cancel", symbol: o.symbol, orderId: o.id, ok: false, error: err.message });
          }
        }
      }
      const { net } = await this.positions();
      for (const p of net.filter((x) => x.quantity !== 0)) {
        try {
          const order = this._form({ exchange: p.exchange, symbol: p.symbol, product: p.product, side: p.quantity > 0 ? "SELL" : "BUY", type: "MARKET", quantity: Math.abs(p.quantity) });
          const r = await this._send(by, "exit (exit all)", { variety: "regular", ...order.form }, () => this._client().place("regular", order.form));
          results.push({ kind: "exit", symbol: p.symbol, product: p.product, quantity: Math.abs(p.quantity), side: order.side, orderId: r.orderId, ok: true });
        } catch (err) {
          results.push({ kind: "exit", symbol: p.symbol, product: p.product, quantity: Math.abs(p.quantity), ok: false, error: err.message });
        }
      }
      return { results, ok: results.every((r) => r.ok) };
    });
  }

  /** Sell (part of) a delivery holding. */
  async sellHolding(input, by) {
    this._requireOn();
    if (!input || input.confirm !== true) throw new TradingError("The sale was not confirmed.", "unconfirmed");
    const exchange = String(input.exchange || "NSE").toUpperCase();
    const symbol = String(input.symbol || "").toUpperCase();
    return this._once(input.clientRef, async () => {
      if (!CASH.has(exchange)) throw new TradingError("Holdings are sold on NSE or BSE.");
      // a delivery holding can be sold on either exchange, whichever Zerodha lists it under
      const all = await this.holdings();
      const h = all.find((x) => x.symbol === symbol && x.exchange === exchange) || all.find((x) => x.symbol === symbol);
      if (!h) throw new TradingError("That stock is not in your holdings.", "no_holding", 409);
      const max = h.quantity + h.t1;
      const want = input.quantity === undefined || input.quantity === "" ? max : num(input.quantity);
      if (!(Number.isInteger(want) && want >= 1 && want <= max)) throw new TradingError(`Sell quantity must be from 1 to ${max}.`);
      const type = String(input.type || "MARKET").toUpperCase() === "LIMIT" ? "LIMIT" : "MARKET";
      const order = this._form({ exchange, symbol, product: "CNC", side: "SELL", type, quantity: want, price: input.price, protection: input.protection, variety: input.variety });
      const r = await this._send(by, "sell holding", { variety: order.variety, ...order.form }, () => this._client().place(order.variety, order.form));
      return { ...r, variety: order.variety, quantity: want };
    });
  }

  /* ------------------------------------------------------- live updates */

  stream(send) {
    const fn = (u) => send({ type: "order", update: u });
    this._listeners.add(fn);
    send({ type: "hello", status: this.status() });
    return () => this._listeners.delete(fn);
  }
}

module.exports = { TradingService, TradingError, LIVE, TAG };
