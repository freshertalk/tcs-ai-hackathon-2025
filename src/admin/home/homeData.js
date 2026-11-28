// The arithmetic behind /me's first screen (28 Nov 2026): the index cells, one row of analysis for every watchlist stock,
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
/** Shares traded, the Indian way: 34.61 L, 1.20 Cr. */
export function volumeWords(x) {
  if (!num(x) || x < 0) return "—";
  if (x >= 1e7) return `${(x / 1e7).toFixed(2)} Cr`;
  if (x >= 1e5) return `${(x / 1e5).toFixed(2)} L`;
  if (x >= 1e3) return `${(x / 1e3).toFixed(1)} K`;
  return String(Math.round(x));
}

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
const KIND = { day: "Day", swing: "Swing" };
const SIDE = { long: "long", short: "short" };
/** The Advisor's best reading for a stock, in words: only A and B are backed by the forward test. */
export function oddsOf(edgeRow) {
  const b = edgeRow && edgeRow.available && edgeRow.best;
  if (!b || !b.grade) return null;
  return { grade: b.grade, proven: b.grade === "A" || b.grade === "B", text: `${KIND[b.kind] || b.kind} ${SIDE[b.side] || b.side}`, winPct: num(b.winPct) ? b.winPct : null, expR: num(b.expR) ? b.expR : null, n: num(b.n) ? b.n : null, warning: edgeRow.warning || "" };
}

/**
 * One row for every watchlist stock: the price now (the live quote, else the last daily close), the day's range, VWAP, volume,
 * the waiting buy and sell quantity, the daily reading and RSI, the distance from the 52-week high, the average daily range,
 * the Advisor's odds and what the morning setup flags.
 * @param a { quotes, scan, edge, setup, symbols (the watchlist in its order) }
 */
export function watchRows({ quotes, scan, edge, setup, symbols }) {
  const q = (quotes && quotes.quotes) || {};
  const daily = new Map(((scan && scan.rows) || []).map((r) => [r.symbol, r]));
  const odds = new Map(((edge && edge.rows) || []).map((r) => [r.symbol, r]));
  const banned = new Set((setup && setup.ban && setup.ban.symbols) || []);
  const delivered = new Map(((setup && setup.delivery) || []).map((x) => [x.symbol, x]));
  const order = symbols && symbols.length ? symbols : daily.size ? [...daily.keys()] : Object.keys(q);
  return order
    .filter((s) => !INDEX_SYMBOLS.has(s))
    .map((symbol) => {
      const x = q[symbol];
      const d = daily.get(symbol);
      const e = odds.get(symbol);
      const live = Boolean(x && num(x.last));
      const last = live ? x.last : d && num(d.last) ? d.last : null;
      const total = live && num(x.buyQty) && num(x.sellQty) ? x.buyQty + x.sellQty : 0;
      const atr = e && num(e.atr) ? e.atr : null;
      return {
        symbol,
        live,
        last,
        change: live && num(x.change) ? x.change : null,
        changePct: live ? (num(x.changePct) ? x.changePct : null) : d && num(d.changePct) ? d.changePct : null,
        open: live ? x.open : null,
        low: live ? x.low : null,
        high: live ? x.high : null,
        place: live ? placeInRange(x.last, x.low, x.high) : null,
        vwap: live && num(x.avgPrice) && x.avgPrice > 0 ? x.avgPrice : null,
        vsVwap: live && num(x.avgPrice) && x.avgPrice > 0 ? pct(x.last, x.avgPrice) : null,
        volume: live && num(x.volume) ? x.volume : null,
        bidShare: total > 0 ? (x.buyQty / total) * 100 : null,
        rsi: d && num(d.rsi14) ? d.rsi14 : null,
        reading: (d && d.enoughData !== false && d.label) || null,
        score: d && num(d.score) ? d.score : null,
        fromHigh: d && num(d.fromHighPct) ? d.fromHighPct : null,
        atr,
        atrPct: atr && last ? (atr / last) * 100 : null,
        dailyAsOf: (d && d.asOf) || null,
        odds: oddsOf(e),
        banned: banned.has(symbol),
        delivery: delivered.get(symbol) || null,
      };
    });
}

/** The watchlist in a line: how many are up and down, how many hold above VWAP, the average move, the best and the worst. */
export function watchSummary(rows) {
  const moved = rows.filter((r) => num(r.changePct));
  const sorted = [...moved].sort((a, b) => b.changePct - a.changePct);
  const vw = rows.filter((r) => num(r.vsVwap));
  return {
    count: rows.length,
    up: moved.filter((r) => r.changePct > 0).length,
    down: moved.filter((r) => r.changePct < 0).length,
    flat: moved.filter((r) => r.changePct === 0).length,
    aboveVwap: vw.filter((r) => r.vsVwap > 0).length,
    withVwap: vw.length,
    average: moved.length ? moved.reduce((a, r) => a + r.changePct, 0) / moved.length : null,
    best: sorted[0] || null,
    worst: sorted.length > 1 ? sorted[sorted.length - 1] : null,
    proven: rows.filter((r) => r.odds && r.odds.proven).length,
  };
}

export const FILTERS = [
  { id: "all", label: "All", test: () => true },
  { id: "up", label: "Gainers", test: (r) => num(r.changePct) && r.changePct > 0 },
  { id: "down", label: "Losers", test: (r) => num(r.changePct) && r.changePct < 0 },
  { id: "vwap", label: "Above VWAP", test: (r) => num(r.vsVwap) && r.vsVwap > 0 },
  { id: "odds", label: "Odds A or B", test: (r) => Boolean(r.odds && r.odds.proven) },
];

const GRADE = { A: 3, B: 2, C: 1 };
const SORT_VALUE = {
  symbol: (r) => r.symbol,
  change: (r) => r.changePct,
  range: (r) => r.place,
  vwap: (r) => r.vsVwap,
  volume: (r) => r.volume,
  book: (r) => r.bidShare,
  rsi: (r) => r.rsi,
  high: (r) => r.fromHigh,
  atr: (r) => r.atrPct,
  odds: (r) => (r.odds ? GRADE[r.odds.grade] * 1000 + (r.odds.winPct || 0) : null),
};
/** Rows in the asked order; a stock without the figure stays at the bottom whichever way it is sorted. */
export function sortRows(rows, sort) {
  if (!sort || !SORT_VALUE[sort.by]) return rows;
  const get = SORT_VALUE[sort.by];
  const way = sort.way === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1;
    return typeof x === "string" ? x.localeCompare(y) * way : (x - y) * way;
  });
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
