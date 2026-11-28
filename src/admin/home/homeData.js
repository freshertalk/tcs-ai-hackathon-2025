// The arithmetic behind /me's first screen (28 Nov 2026): the index cells, the watchlist's up and down count,
// and the account's figures. Pure functions over what the server already answers — nothing here reads, places or changes
// anything. A figure that is not known stays null: the page shows a dash, never a guess.

import { holdingNumbers, positionPnl, totals } from "../stock/trade/tradeMath";
import { attention, bookNumbers, holdingInsights, marginUse, minutesTo, openPnlPct, orderStats, protection, roomToday, awayPct } from "../stock/trade/positionMath";

export const INDICES = [
  { symbol: "NIFTY 50", name: "NIFTY 50" },
  { symbol: "NIFTY BANK", name: "BANK NIFTY" },
  { symbol: "INDIA VIX", name: "INDIA VIX" },
];
const INDEX_SYMBOLS = new Set(INDICES.map((i) => i.symbol));
export const QUOTES_URL = `/api/admin/market/quotes?symbols=${encodeURIComponent(INDICES.map((i) => i.symbol).join(","))}`;

export const num = (x) => typeof x === "number" && Number.isFinite(x);
const pct = (a, b) => (num(a) && num(b) && b !== 0 ? ((a - b) / b) * 100 : null);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/* ------------------------------------------------------------------ words for figures */
export const price = (x) => (num(x) ? x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
export const signed = (x, digits = 2) => (num(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}` : "—");
export const percent = (x, digits = 2) => (num(x) ? `${signed(x, digits)}%` : "—");
export const rupees = (x, digits = 2) => (num(x) ? `${x < 0 ? "−" : ""}₹${Math.abs(x).toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}` : "—");
export const pnlWords = (x) => (num(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}₹${Math.abs(x).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—");
export const tone = (x) => (num(x) ? (x > 0 ? "is-up" : x < 0 ? "is-down" : "") : "");
/** Where the last price sits between the day's low and high, 0…100; null without a range. */
export function placeInRange(last, low, high) {
  if (![last, low, high].every(num) || high < low) return null;
  return high === low ? 50 : clamp(((last - low) / (high - low)) * 100, 0, 100);
}

/* ------------------------------------------------------------------ the indices */
export function indexCells(quotes) {
  const q = (quotes && quotes.quotes) || {};
  return INDICES.map(({ symbol, name }) => {
    const x = q[symbol];
    if (!x || !num(x.last)) return { symbol, name, last: null };
    return { symbol, name, last: x.last, change: num(x.change) ? x.change : null, changePct: num(x.changePct) ? x.changePct : null, open: x.open, high: x.high, low: x.low, prevClose: x.prevClose, place: placeInRange(x.last, x.low, x.high) };
  });
}

/* ------------------------------------------------------------------ the watchlist */
/** The watchlist in a line, from the live quotes: how many are up and down, the average move, how many hold above VWAP. */
export function watchSummary(quotes, symbols) {
  const q = (quotes && quotes.quotes) || {};
  const order = (symbols && symbols.length ? symbols : Object.keys(q)).filter((s) => !INDEX_SYMBOLS.has(s));
  const live = order.map((s) => q[s]).filter((x) => x && num(x.last));
  const moved = live.filter((x) => num(x.changePct));
  const vw = live.filter((x) => num(x.avgPrice) && x.avgPrice > 0);
  return {
    count: order.length,
    up: moved.filter((x) => x.changePct > 0).length,
    down: moved.filter((x) => x.changePct < 0).length,
    aboveVwap: vw.filter((x) => x.last > x.avgPrice).length,
    withVwap: vw.length,
    average: moved.length ? moved.reduce((a, x) => a + x.changePct, 0) / moved.length : null,
  };
}

/* ------------------------------------------------------------------ the account */
/**
 * Everything the first screen says about the account, from Zerodha's own figures (the trading summary). Positions and
 * holdings are valued at the live quote where this page has one, as the Positions page does.
 */
export function accountNumbers(summary, quotes, now) {
  if (!summary) return null;
  const q = (quotes && quotes.quotes) || {};
  const liveOf = (x) => (x.exchange === "NSE" && q[x.symbol] && num(q[x.symbol].last) ? q[x.symbol].last : null);
  const priceOf = (x) => liveOf(x) ?? x.last;
  const positions = (summary.positions && summary.positions.net) || [];
  const holdings = summary.holdings || [];
  const orders = summary.orders || [];
  const trades = summary.trades || [];
  const status = summary.status || {};
  const equity = summary.funds && summary.funds.equity;
  const numbers = summary.positions ? bookNumbers(positions, orders, priceOf) : null;
  const margin = marginUse(equity);
  const stats = summary.orders ? orderStats(orders, trades) : null;
  const room = roomToday({ rules: status.risk, lock: status.riskLock, dayPnl: numbers ? numbers.total : null, orders, positions });
  const squareOff = summary.squareOff || {};
  const open = positions
    .filter((p) => p.quantity !== 0)
    .map((p) => {
      const last = priceOf(p);
      const guard = protection(p, orders);
      const off = p.product === "MIS" ? squareOff[p.symbol] || null : null;
      return {
        key: `${p.exchange}:${p.symbol}:${p.product}`,
        symbol: p.symbol,
        exchange: p.exchange,
        product: p.product,
        qty: p.quantity,
        average: p.average,
        last,
        dayPct: num(p.close) && p.close ? pct(last, p.close) : null,
        pnl: positionPnl(p, last),
        pnlPct: openPnlPct(p, last),
        stop: guard.stop ? { price: guard.stop.price, away: awayPct(guard.stop.price, last) } : null,
        cover: guard.state,
        target: guard.target ? { price: guard.target.price, away: awayPct(guard.target.price, last) } : null,
        squareOff: off ? off.clock : null,
      };
    });
  const mis = open
    .filter((p) => p.product === "MIS" && squareOff[p.symbol])
    .map((p) => ({ symbol: p.symbol, clock: squareOff[p.symbol].clock, left: minutesTo(squareOff[p.symbol].min, now) }));
  const held = holdings.filter((h) => h.quantity + (h.t1 || 0) > 0);
  const sum = totals({ positions: [], holdings: held }, liveOf);
  return {
    equity: equity
      ? { available: equity.net, used: equity.used ? equity.used.debits : null, opening: equity.available ? equity.available.opening : null, usedPct: margin ? margin.pct : null }
      : null,
    numbers,
    open,
    room,
    stats,
    holdings: summary.holdings
      ? {
          ...sum,
          rows: held.map((h) => ({ symbol: h.symbol, ...holdingNumbers(h, priceOf(h)) })),
          insights: holdingInsights(held, priceOf),
        }
      : null,
    attention: attention({ numbers, room, margin, stats, mis }),
    errors: summary.errors || {},
    user: status.user || "",
    trading: Boolean(status.enabled),
    at: summary.at || null,
  };
}
