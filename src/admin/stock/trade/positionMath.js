// The arithmetic behind the Positions page's first-sight panels (PositionDesk.jsx): what protects each open position in
// today's order book, what is at risk, how much room is left today, and what needs attention now. Pure functions over the
// figures the page already holds — nothing here reads, places or changes anything.

import { LIVE_STATUSES, holdingNumbers, positionPnl } from "./tradeMath";

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const mult = (p) => (fin(p.multiplier) && p.multiplier > 0 ? p.multiplier : 1);
const sum = (list, f) => list.reduce((a, x) => a + (f(x) || 0), 0);
const IST = 5.5 * 3600 * 1000;

export const posKey = (p) => `${p.exchange}:${p.symbol}:${p.product}`;

/** What the quantity still held would make or lose at this price (Zerodha's "unrealised": open quantity only). */
export function openPnl(p, last = p.last) {
  if (!p.quantity || !fin(last) || !(p.average > 0)) return 0;
  return p.quantity * (last - p.average) * mult(p);
}

/** The P&L on the open quantity as a share of what it cost to enter. */
export function openPnlPct(p, last = p.last) {
  if (!p.quantity || !fin(last) || !(p.average > 0)) return null;
  return ((last - p.average) / p.average) * 100 * Math.sign(p.quantity);
}

/**
 * The orders waiting in today's book that would close this position: stop-loss orders (SL / SL-M) and profit-taking limit
 * orders, on the other side, for the same instrument and product. GTT triggers are not part of the order book.
 * @returns { stops, targets, stopQty, state: "covered" | "partial" | "none", stop, target }
 *          stop / target: the one the price would reach first
 */
export function protection(p, orders = []) {
  const long = p.quantity > 0;
  const held = Math.abs(p.quantity);
  const mine = orders.filter((o) => LIVE_STATUSES.has(o.status) && o.symbol === p.symbol && o.exchange === p.exchange && o.product === p.product && o.side === (long ? "SELL" : "BUY"));
  const left = (o) => Math.max(0, (o.quantity || 0) - (o.filled || 0));
  const stops = mine.filter((o) => (o.type === "SL" || o.type === "SL-M") && o.trigger > 0).map((o) => ({ price: o.trigger, qty: left(o), type: o.type, id: o.id }));
  const targets = mine.filter((o) => o.type === "LIMIT" && o.price > 0).map((o) => ({ price: o.price, qty: left(o), type: o.type, id: o.id }));
  // the first to be reached: for a long the highest stop and the lowest target; the other way round for a short
  stops.sort((a, b) => (long ? b.price - a.price : a.price - b.price));
  targets.sort((a, b) => (long ? a.price - b.price : b.price - a.price));
  const stopQty = sum(stops, (s) => s.qty);
  return { stops, targets, stopQty, state: stopQty >= held && held > 0 ? "covered" : stopQty > 0 ? "partial" : "none", stop: stops[0] || null, target: targets[0] || null };
}

/** Percent from the last price to `price` (positive: above the market). */
export function awayPct(price, last) {
  return fin(price) && price > 0 && fin(last) && last > 0 ? ((price - last) / last) * 100 : null;
}

/** An open order's distance from the market: by its trigger when it has one, else its limit price; none for a market order. */
export function orderAway(o, last) {
  return awayPct(o.trigger > 0 ? o.trigger : o.price, last);
}

/**
 * The page's headline numbers over today's positions.
 * @param priceOf  (position) → the price to value it at (the live one when the page has it)
 */
export function bookNumbers(positions = [], orders = [], priceOf = (p) => p.last) {
  const open = positions.filter((p) => p.quantity !== 0);
  const total = sum(positions, (p) => positionPnl(p, priceOf(p)));
  const unrealised = sum(open, (p) => openPnl(p, priceOf(p)));
  const value = (p) => Math.abs(p.quantity) * (priceOf(p) || p.average || 0) * mult(p);
  const byProduct = {};
  for (const p of open) byProduct[p.product] = (byProduct[p.product] || 0) + 1;
  const guards = open.map((p) => ({ p, g: protection(p, orders) }));
  // what the open positions give back from here if every stop order in the book fills at its trigger
  const giveBack = sum(guards, ({ p, g }) => {
    let remaining = Math.abs(p.quantity);
    const last = priceOf(p);
    let out = 0;
    for (const s of g.stops) {
      const q = Math.min(remaining, s.qty);
      if (fin(last)) out += Math.max(0, (last - s.price) * Math.sign(p.quantity)) * q * mult(p);
      remaining -= q;
    }
    return out;
  });
  return {
    total,
    unrealised,
    booked: total - unrealised,
    open: open.length,
    closed: positions.length - open.length,
    longs: open.filter((p) => p.quantity > 0).length,
    shorts: open.filter((p) => p.quantity < 0).length,
    longValue: sum(open.filter((p) => p.quantity > 0), value),
    shortValue: sum(open.filter((p) => p.quantity < 0), value),
    byProduct,
    winners: open.filter((p) => openPnl(p, priceOf(p)) > 0).length,
    losers: open.filter((p) => openPnl(p, priceOf(p)) < 0).length,
    noStop: guards.filter((x) => x.g.state === "none").map((x) => x.p.symbol),
    partStop: guards.filter((x) => x.g.state === "partial").map((x) => x.p.symbol),
    covered: guards.filter((x) => x.g.state === "covered").length,
    giveBack,
  };
}

/**
 * Today's room against the risk guard's rules, from the figures on screen (the server enforces the rules; this only shows
 * them). `null` for a rule that is not set.
 */
export function roomToday({ rules, lock, dayPnl, orders = [], positions = [] }) {
  const r = rules || {};
  const on = Boolean(r.enabled);
  const done = orders.filter((o) => o.status === "COMPLETE").length;
  const symbols = new Set(positions.filter((p) => p.quantity !== 0).map((p) => `${p.exchange}:${p.symbol}`)).size;
  return {
    on,
    locked: Boolean(lock),
    reason: lock ? lock.reason || "" : "",
    loss: on && r.dailyLoss > 0 && fin(dayPnl) ? Math.max(0, r.dailyLoss + Math.min(0, dayPnl)) : null,
    lossUsedPct: on && r.dailyLoss > 0 && fin(dayPnl) ? Math.min(100, (Math.max(0, -dayPnl) / r.dailyLoss) * 100) : null,
    orders: on && r.maxOrders > 0 ? Math.max(0, r.maxOrders - done) : null,
    open: on && r.maxOpen > 0 ? Math.max(0, r.maxOpen - symbols) : null,
    done,
  };
}

/** Zerodha's equity margin: what is used, what is free, and the share used. */
export function marginUse(equity) {
  if (!equity || !equity.used || !fin(equity.net)) return null;
  const used = Math.max(0, equity.used.debits || 0);
  const free = Math.max(0, equity.net);
  const all = used + free;
  return { used, free: equity.net, pct: all > 0 ? (used / all) * 100 : 0 };
}

/** Minutes left to a time of day (minutes after midnight, IST) on a weekday; null on a weekend or without a time. */
export function minutesTo(min, now) {
  if (!fin(min) || !fin(now)) return null;
  const d = new Date(now + IST);
  if (d.getUTCDay() === 0 || d.getUTCDay() === 6) return null;
  return min - (d.getUTCHours() * 60 + d.getUTCMinutes());
}

/** Today's orders and fills in a few numbers. */
export function orderStats(orders = [], trades = []) {
  const count = (s) => orders.filter((o) => o.status === s).length;
  const value = (side) => sum(trades.filter((t) => t.side === side), (t) => (t.quantity || 0) * (t.price || 0));
  const buy = value("BUY");
  const sell = value("SELL");
  return {
    waiting: orders.filter((o) => LIVE_STATUSES.has(o.status)).length,
    complete: count("COMPLETE"),
    rejected: count("REJECTED"),
    cancelled: count("CANCELLED"),
    fills: trades.length,
    buy,
    sell,
    turnover: buy + sell,
  };
}

/** The delivery book at a glance: who is up and down, today's best and worst, and the biggest single holding. */
export function holdingInsights(holdings = [], priceOf = (h) => h.last) {
  const rows = holdings.map((h) => ({ symbol: h.symbol, ...holdingNumbers(h, priceOf(h)) })).filter((r) => r.qty > 0);
  if (!rows.length) return null;
  const all = sum(rows, (r) => r.current);
  const byDay = rows.filter((r) => fin(r.dayPct)).sort((a, b) => b.dayPct - a.dayPct);
  const byTotal = [...rows].sort((a, b) => b.pnlPct - a.pnlPct);
  const biggest = [...rows].sort((a, b) => b.current - a.current)[0];
  return {
    count: rows.length,
    inProfit: rows.filter((r) => r.pnl > 0).length,
    inLoss: rows.filter((r) => r.pnl < 0).length,
    bestToday: byDay[0] || null,
    worstToday: byDay.length > 1 ? byDay[byDay.length - 1] : null,
    best: byTotal[0],
    worst: byTotal.length > 1 ? byTotal[byTotal.length - 1] : null,
    biggest: biggest && all > 0 ? { symbol: biggest.symbol, share: (biggest.current / all) * 100 } : null,
  };
}

/**
 * What needs a look now, the most urgent first: [{ id, level: "danger" | "warn", text }].
 * @param a { numbers (bookNumbers), room (roomToday), margin (marginUse), stats (orderStats), mis: [{ symbol, left, clock }],
 *            coach: [{ symbol, state, headline }] }
 */
export function attention({ numbers, room, margin, stats, mis = [], coach = [] }) {
  const out = [];
  const add = (id, level, text) => out.push({ id, level, text });
  for (const c of coach) {
    if (c.state === "exit-now") add(`coach-${c.symbol}`, "danger", `${c.symbol}: the exit coach says EXIT NOW${c.price > 0 ? `, about ₹${c.price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ""}.`);
    else if (c.state === "book-part") add(`coach-${c.symbol}`, "warn", `${c.symbol}: the exit coach says BOOK PART.`);
  }
  for (const m of mis) {
    if (fin(m.left) && m.left > 0 && m.left <= 30) add(`mis-${m.symbol}`, m.left <= 10 ? "danger" : "warn", `${m.symbol} (MIS) is squared off by Zerodha at ${m.clock}, in ${m.left} min.`);
  }
  if (numbers && numbers.noStop.length) add("no-stop", "danger", `No stop-loss order in today’s order book for ${numbers.noStop.join(", ")}.`);
  if (numbers && numbers.partStop.length) add("part-stop", "warn", `The stop-loss order covers only part of the quantity in ${numbers.partStop.join(", ")}.`);
  if (room && room.locked) add("locked", "danger", `The risk guard has locked today: new trades are refused. ${room.reason}`.trim());
  else if (room && fin(room.lossUsedPct) && room.lossUsedPct >= 75) add("loss", "warn", `${Math.round(room.lossUsedPct)}% of today’s loss limit is used.`);
  if (margin && margin.pct >= 80) add("margin", "warn", `${Math.round(margin.pct)}% of the equity margin is in use.`);
  if (stats && stats.rejected) add("rejected", "warn", `${stats.rejected} order${stats.rejected === 1 ? " was" : "s were"} rejected today: the reason is on the Orders tab.`);
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "danger" ? -1 : 1));
}
