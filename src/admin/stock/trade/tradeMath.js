// Arithmetic and checks for the account screen and the order ticket. The server makes the
// same checks again (and is the one that counts); these keep the page honest about what it
// will accept before anything is sent.

export const LIVE_STATUSES = new Set(["OPEN", "TRIGGER PENDING", "AMO REQ RECEIVED", "OPEN PENDING", "VALIDATION PENDING", "PUT ORDER REQ RECEIVED", "MODIFY PENDING", "MODIFY VALIDATION PENDING"]);
export const CASH = new Set(["NSE", "BSE"]);

const fin = (x) => typeof x === "number" && Number.isFinite(x);

/**
 * A position's P&L at a given last price — Zerodha's own formula:
 * (sell value − buy value) + net quantity × last price × multiplier.
 */
export function positionPnl(p, last = p.last) {
  if (!fin(last)) return p.pnl;
  return p.sellValue - p.buyValue + p.quantity * last * (p.multiplier || 1);
}

/** The change since yesterday's close on what is held now (the "day" view of a position). */
export function positionDayChange(p, last = p.last) {
  if (!fin(last) || !fin(p.close) || !p.close) return null;
  return ((last - p.close) / p.close) * 100;
}

export function holdingNumbers(h, last = h.last) {
  const qty = h.quantity + h.t1;
  const px = fin(last) ? last : h.last;
  const invested = qty * h.average;
  const current = qty * px;
  return { qty, invested, current, pnl: current - invested, pnlPct: invested ? ((current - invested) / invested) * 100 : 0, dayPct: h.close ? ((px - h.close) / h.close) * 100 : h.dayChangePct };
}

/** Totals across a list, with live prices where the page has them. */
export function totals({ positions = [], holdings = [] }, liveOf = () => null) {
  let posPnl = 0;
  let open = 0;
  for (const p of positions) {
    posPnl += positionPnl(p, liveOf(p) ?? p.last);
    if (p.quantity !== 0) open += 1;
  }
  let invested = 0;
  let current = 0;
  let day = 0;
  for (const h of holdings) {
    const n = holdingNumbers(h, liveOf(h) ?? h.last);
    invested += n.invested;
    current += n.current;
    if (h.close) day += n.qty * ((liveOf(h) ?? h.last) - h.close);
  }
  return { posPnl, open, invested, current, holdPnl: current - invested, holdPnlPct: invested ? ((current - invested) / invested) * 100 : 0, holdDay: day };
}

/** A fresh reference for one order: a second click on the same ticket cannot place it twice. */
export function newRef() {
  const c = typeof window !== "undefined" ? window.crypto : null;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * What is wrong with a ticket, in words, or "" when it can be sent. Mirrors the server.
 * @param t  { exchange, symbol, side, type, product, quantity, price, trigger, protection }
 */
export function ticketProblem(t) {
  const q = Number(t.quantity);
  const price = Number(t.price);
  const trig = Number(t.trigger);
  if (!t.symbol || !/^[A-Z0-9][A-Z0-9&_.-]{0,39}$/.test(String(t.symbol).toUpperCase())) return "Enter a trading symbol.";
  if (!(Number.isInteger(q) && q >= 1)) return "Enter a whole number of shares (or units).";
  if (t.product === "CNC" && !CASH.has(t.exchange)) return "CNC (delivery) is for NSE and BSE stocks.";
  if (t.product === "NRML" && CASH.has(t.exchange)) return "NRML is for F&O and commodities.";
  if ((t.type === "LIMIT" || t.type === "SL") && !(price > 0)) return "Enter a price.";
  if ((t.type === "SL" || t.type === "SL-M") && !(trig > 0)) return "Enter a trigger price.";
  if (t.type === "SL" && t.side === "BUY" && trig > price) return "For an SL buy the trigger must be at or below the price.";
  if (t.type === "SL" && t.side === "SELL" && trig < price) return "For an SL sell the trigger must be at or above the price.";
  if ((t.type === "MARKET" || t.type === "SL-M") && t.protection !== "" && t.protection !== undefined) {
    const p = Number(t.protection);
    if (!(p === -1 || (p > 0 && p <= 100))) return "Market protection is -1 (automatic) or a percentage up to 100.";
  }
  return "";
}

/** The order in one line, for the confirmation step. */
export function describe(t) {
  const px = t.type === "MARKET" ? "at market" : t.type === "LIMIT" ? `at ₹${t.price}` : t.type === "SL" ? `stop ₹${t.trigger} → limit ₹${t.price}` : `stop ₹${t.trigger} → market`;
  const product = { CNC: "delivery (CNC)", MIS: "intraday (MIS)", NRML: "carry-forward (NRML)" }[t.product] || t.product;
  return `${t.side} ${t.quantity} ${t.symbol} on ${t.exchange} ${px}, ${product}${t.variety === "amo" ? ", after-market order" : ""}`;
}

/* ------------------------------------------------------------------ the plan */

const round2 = (x) => Math.round(x * 100) / 100;

/**
 * The money side of a planned trade: what is lost if the stop is hit, what is gained at the
 * target, and the ratio between them. Says so when a level is on the wrong side of the entry.
 * @returns null without an entry price and a quantity, else
 *          { riskPerShare, risk, reward, rr, problem }
 */
export function planNumbers({ side, entry, stop, target, quantity }) {
  const e = Number(entry);
  const q = Number(quantity);
  if (!(e > 0) || !(q > 0)) return null;
  const long = side === "BUY";
  const s = Number(stop);
  const t = Number(target);
  const out = { riskPerShare: null, risk: null, reward: null, rr: null, problem: "" };
  if (s > 0) {
    const d = long ? e - s : s - e;
    if (d <= 0) out.problem = long ? "For a buy, the stop belongs below the entry price." : "For a sell, the stop belongs above the entry price.";
    else {
      out.riskPerShare = round2(d);
      out.risk = round2(d * q);
    }
  }
  if (t > 0) {
    const g = long ? t - e : e - t;
    if (g <= 0) out.problem = out.problem || (long ? "For a buy, the target belongs above the entry price." : "For a sell, the target belongs below the entry price.");
    else {
      out.reward = round2(g * q);
      if (out.riskPerShare) out.rr = round2(g / out.riskPerShare);
    }
  }
  return out;
}

/** Shares for a chosen money risk: the risk divided by the distance from entry to stop, rounded down. */
export function sizeForRisk(risk, entry, stop) {
  const d = Math.abs(Number(entry) - Number(stop));
  if (!(Number(risk) > 0) || !(d > 0) || !(Number(entry) > 0) || !(Number(stop) > 0)) return 0;
  return Math.floor(Number(risk) / d + 1e-9);
}

/**
 * The stop-loss order that protects a filled entry: the opposite side, same product and
 * quantity, a stop-market order triggered at the stop. It is a ticket to confirm, never
 * something sent by itself.
 */
export function stopTicket(entry, stop) {
  if (!entry || !(Number(stop) > 0)) return null;
  return {
    symbol: entry.symbol,
    exchange: entry.exchange || "NSE",
    side: entry.side === "BUY" ? "SELL" : "BUY",
    product: entry.product,
    type: "SL-M",
    quantity: Number(entry.quantity),
    trigger: Number(stop),
  };
}
