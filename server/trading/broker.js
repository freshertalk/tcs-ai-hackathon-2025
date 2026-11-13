"use strict";
// Zerodha Kite Connect v3 — the account side: funds, holdings, positions, the order book,
// trades, and placing / modifying / cancelling orders.
//
// This is the only file in the project that can send an order to Zerodha. It is used by
// server/trading/service.js alone, which checks the trading switch, the limits and the
// inputs before anything gets here. The market-data client (server/market/kite.js) and the
// AI folder (server/ai) cannot reach it; tests enforce that.
//
// Docs: https://kite.trade/docs/connect/v3/orders/ · /portfolio/ · /user/
//   place     POST   /orders/:variety           (form-encoded)
//   modify    PUT    /orders/:variety/:order_id
//   cancel    DELETE /orders/:variety/:order_id
//   book      GET    /orders · GET /orders/:order_id (history) · GET /trades
//   portfolio GET    /portfolio/holdings · GET /portfolio/positions
//   funds     GET    /user/margins
// Since 1 April 2026 Zerodha accepts API orders only from the static IP registered on the
// Kite Connect app (SEBI's retail-algo rules); reads work from anywhere.

const { KiteError, Throttle, API } = require("../market/kite");

async function parse(res) {
  let body = null;
  try {
    body = await res.json();
  } catch (_) {
    /* not JSON */
  }
  if (!res.ok || !body || body.status !== "success") {
    throw new KiteError((body && body.message) || `Kite answered HTTP ${res.status}`, { type: body && body.error_type, status: res.status });
  }
  return body.data;
}

const n = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);

/** A position as the desk shows it. P&L follows Zerodha's own formula. */
function shapePosition(p) {
  return {
    exchange: p.exchange,
    symbol: p.tradingsymbol,
    token: p.instrument_token,
    product: p.product,
    quantity: n(p.quantity),
    overnight: n(p.overnight_quantity),
    multiplier: n(p.multiplier) || 1,
    average: n(p.average_price),
    last: n(p.last_price),
    close: n(p.close_price),
    pnl: n(p.pnl),
    m2m: n(p.m2m),
    realised: n(p.realised),
    unrealised: n(p.unrealised),
    buyQty: n(p.buy_quantity),
    buyPrice: n(p.buy_price),
    buyValue: n(p.buy_value),
    sellQty: n(p.sell_quantity),
    sellPrice: n(p.sell_price),
    sellValue: n(p.sell_value),
    dayBuyQty: n(p.day_buy_quantity),
    daySellQty: n(p.day_sell_quantity),
  };
}

function shapeHolding(h) {
  return {
    exchange: h.exchange,
    symbol: h.tradingsymbol,
    token: h.instrument_token,
    isin: h.isin || "",
    product: h.product || "CNC",
    quantity: n(h.quantity),
    t1: n(h.t1_quantity),
    used: n(h.used_quantity),
    collateral: n(h.collateral_quantity),
    average: n(h.average_price),
    last: n(h.last_price),
    close: n(h.close_price),
    pnl: n(h.pnl),
    dayChange: n(h.day_change),
    dayChangePct: n(h.day_change_percentage),
  };
}

function shapeOrder(o) {
  return {
    id: String(o.order_id || ""),
    parentId: o.parent_order_id || null,
    exchangeId: o.exchange_order_id || null,
    status: String(o.status || ""),
    message: o.status_message || o.status_message_raw || "",
    variety: o.variety || "regular",
    exchange: o.exchange,
    symbol: o.tradingsymbol,
    token: o.instrument_token,
    side: o.transaction_type,
    type: o.order_type,
    product: o.product,
    validity: o.validity,
    quantity: n(o.quantity),
    pending: n(o.pending_quantity),
    filled: n(o.filled_quantity),
    cancelled: n(o.cancelled_quantity),
    price: n(o.price),
    trigger: n(o.trigger_price),
    average: n(o.average_price),
    tag: o.tag || "",
    placedAt: o.order_timestamp || null,
    exchangeAt: o.exchange_update_timestamp || o.exchange_timestamp || null,
    placedBy: o.placed_by || "",
  };
}

function shapeTrade(t) {
  return {
    id: String(t.trade_id || ""),
    orderId: String(t.order_id || ""),
    exchange: t.exchange,
    symbol: t.tradingsymbol,
    side: t.transaction_type,
    product: t.product,
    quantity: n(t.quantity),
    price: n(t.average_price),
    at: t.fill_timestamp || t.exchange_timestamp || t.order_timestamp || null,
  };
}

function shapeSegment(s) {
  if (!s) return null;
  const a = s.available || {};
  const u = s.utilised || {};
  return {
    enabled: Boolean(s.enabled),
    net: n(s.net),
    available: { cash: n(a.cash), opening: n(a.opening_balance), live: n(a.live_balance), payin: n(a.intraday_payin), collateral: n(a.collateral), adhoc: n(a.adhoc_margin) },
    used: {
      debits: n(u.debits),
      exposure: n(u.exposure),
      span: n(u.span),
      optionPremium: n(u.option_premium),
      holdingSales: n(u.holding_sales),
      delivery: n(u.delivery),
      m2mRealised: n(u.m2m_realised),
      m2mUnrealised: n(u.m2m_unrealised),
      payout: n(u.payout),
    },
  };
}

class KiteBroker {
  constructor({ apiKey, accessToken, fetchImpl = globalThis.fetch, gapMs = 110 }) {
    this.apiKey = apiKey;
    this.accessToken = accessToken;
    this.fetch = fetchImpl;
    // one queue for reads and writes alike: Zerodha allows 10 requests a second
    this.throttle = new Throttle(gapMs);
  }

  _req(method, p, form) {
    return this.throttle.run(async () =>
      parse(
        await this.fetch(`${API}${p}`, {
          method,
          headers: {
            "X-Kite-Version": "3",
            Authorization: `token ${this.apiKey}:${this.accessToken}`,
            ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
          },
          body: form ? new URLSearchParams(form).toString() : undefined,
          signal: AbortSignal.timeout(15000),
        })
      )
    );
  }

  async funds() {
    const d = (await this._req("GET", "/user/margins")) || {};
    return { equity: shapeSegment(d.equity), commodity: shapeSegment(d.commodity) };
  }

  async holdings() {
    return ((await this._req("GET", "/portfolio/holdings")) || []).map(shapeHolding);
  }

  async positions() {
    const d = (await this._req("GET", "/portfolio/positions")) || {};
    return { net: (d.net || []).map(shapePosition), day: (d.day || []).map(shapePosition) };
  }

  async orders() {
    return ((await this._req("GET", "/orders")) || []).map(shapeOrder);
  }

  async orderHistory(id) {
    return ((await this._req("GET", `/orders/${encodeURIComponent(id)}`)) || []).map(shapeOrder);
  }

  async trades() {
    return ((await this._req("GET", "/trades")) || []).map(shapeTrade);
  }

  /** @param form  Kite's own parameter names, already checked by the trading service */
  async place(variety, form) {
    const d = await this._req("POST", `/orders/${encodeURIComponent(variety)}`, form);
    return { orderId: String((d && d.order_id) || "") };
  }

  async modify(variety, id, form) {
    const d = await this._req("PUT", `/orders/${encodeURIComponent(variety)}/${encodeURIComponent(id)}`, form);
    return { orderId: String((d && d.order_id) || id) };
  }

  async cancel(variety, id) {
    const d = await this._req("DELETE", `/orders/${encodeURIComponent(variety)}/${encodeURIComponent(id)}`);
    return { orderId: String((d && d.order_id) || id) };
  }
}

module.exports = { KiteBroker, shapeOrder, shapePosition, shapeHolding, shapeTrade, shapeSegment };
