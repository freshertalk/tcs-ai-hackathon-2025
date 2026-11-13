"use strict";
// The risk guard: the rules a prop desk puts on every trader, applied to your own account.
//
//   daily loss limit   when today's mark-to-market loss reaches it, the day is LOCKED
//   profit lock        optional: when today's gain reaches it, the day is LOCKED to keep it
//   max orders a day   executed orders today (from any app); at the cap, no new ones
//   max open positions at the cap, no position in a new symbol
//
// A lock blocks only what ADDS risk. Exits, sells of holdings, cancels and changes to orders
// that close a position always go through — a guard that stopped you getting out would be
// worse than none. A lock lasts until the end of the IST day, and while it is on, the limits
// can be tightened but not loosened. Nothing here ever places an order by itself.
//
// Pure functions: the trading service supplies the numbers.

const IST = 5.5 * 3600 * 1000;
const istDay = (ms) => new Date(ms + IST).toISOString().slice(0, 10);

const RISK_DEFAULTS = { enabled: false, dailyLoss: 0, profitLock: 0, maxOrders: 0, maxOpen: 0 };

function cleanConfig(c = {}) {
  const n = (x, max) => {
    const v = Math.floor(Number(x));
    return Number.isFinite(v) && v > 0 ? Math.min(v, max) : 0;
  };
  return {
    enabled: Boolean(c.enabled),
    dailyLoss: n(c.dailyLoss, 1e9),
    profitLock: n(c.profitLock, 1e9),
    maxOrders: n(c.maxOrders, 10000),
    maxOpen: n(c.maxOpen, 1000),
  };
}

/** Would `next` loosen any limit of `cur`? (0 means "no limit", the loosest of all.) */
function loosens(cur, next) {
  if (cur.enabled && !next.enabled) return true;
  const looser = (a, b) => a > 0 && (b === 0 || b > a);
  return looser(cur.dailyLoss, next.dailyLoss) || looser(cur.profitLock, next.profitLock) || looser(cur.maxOrders, next.maxOrders) || looser(cur.maxOpen, next.maxOpen);
}

/**
 * Where the account stands against the rules right now.
 * @param a { cfg, lock, now, dayPnl, ordersToday, openSymbols: Set }
 * @returns { enabled, locked, lock, breach, room{ loss, profit, orders, open }, dayPnl, ordersToday, openCount }
 */
function standing({ cfg, lock, now, dayPnl, ordersToday, openSymbols }) {
  const day = istDay(now);
  const live = lock && lock.day === day ? lock : null;
  let breach = null;
  if (cfg.enabled && cfg.dailyLoss > 0 && dayPnl <= -cfg.dailyLoss) breach = { kind: "loss", reason: `Today's loss (₹${Math.round(-dayPnl).toLocaleString("en-IN")}) reached the daily loss limit of ₹${cfg.dailyLoss.toLocaleString("en-IN")}.` };
  else if (cfg.enabled && cfg.profitLock > 0 && dayPnl >= cfg.profitLock) breach = { kind: "profit", reason: `Today's gain (₹${Math.round(dayPnl).toLocaleString("en-IN")}) reached the profit lock of ₹${cfg.profitLock.toLocaleString("en-IN")}. The day is locked to keep it.` };
  const openCount = openSymbols ? openSymbols.size : 0;
  return {
    enabled: cfg.enabled,
    locked: Boolean(cfg.enabled && (live || breach)),
    lock: live,
    breach,
    dayPnl,
    ordersToday,
    openCount,
    room: {
      loss: cfg.dailyLoss > 0 ? Math.max(0, cfg.dailyLoss + Math.min(0, dayPnl)) : null,
      profit: cfg.profitLock > 0 ? Math.max(0, cfg.profitLock - Math.max(0, dayPnl)) : null,
      orders: cfg.maxOrders > 0 ? Math.max(0, cfg.maxOrders - ordersToday) : null,
      open: cfg.maxOpen > 0 ? Math.max(0, cfg.maxOpen - openCount) : null,
    },
  };
}

/**
 * May this order go out?
 * @param s        standing(...)
 * @param opening  true when the order adds risk (anything that is not an exit)
 * @param symbol   the order's symbol (a new position counts against maxOpen; adding to one does not)
 * @returns null when allowed, else { code, message }
 */
function refusal(s, cfg, { opening, symbol, openSymbols }) {
  if (!cfg.enabled || !opening) return null;
  if (s.locked) {
    const why = s.lock ? s.lock.reason : s.breach.reason;
    return { code: "risk_locked", message: `Risk guard: the day is locked. ${why} Only exits, cancels and stop changes are allowed until tomorrow.` };
  }
  if (cfg.maxOrders > 0 && s.ordersToday >= cfg.maxOrders) return { code: "risk_orders", message: `Risk guard: ${s.ordersToday} orders have been executed today, your limit is ${cfg.maxOrders}. Exits are still allowed.` };
  if (cfg.maxOpen > 0 && s.openCount >= cfg.maxOpen && !(openSymbols && openSymbols.has(symbol))) return { code: "risk_open", message: `Risk guard: ${s.openCount} positions are open, your limit is ${cfg.maxOpen}. Close one before opening another.` };
  return null;
}

module.exports = { RISK_DEFAULTS, cleanConfig, loosens, standing, refusal, istDay };
