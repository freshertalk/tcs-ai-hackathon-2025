"use strict";
// The trade journal: every fill you made, paired into round trips, and the numbers a
// performance journal is built on — win rate, profit factor, expectancy, drawdown, streaks,
// and where the money is made and lost (by stock, side, product, weekday, hour, tag).
//
// Fills come only from Zerodha — nothing is typed in by hand:
//   - from Kite every day: Zerodha's API only ever returns the current day's trades, so the server
//     copies them in by itself every few minutes on trading days (journal-capture.js) and whenever
//     the account is read; and
//   - from tradebook CSVs exported from Zerodha Console for everything before that (Kite Connect has
//     no endpoint for past trades or past P&L): one file per financial year, repeats ignored.
// Profit and loss is then shown for any period — today, yesterday, this week / month / quarter, the
// last 6, 9 and 12 months, this financial year, every past financial year since the account opened,
// or a custom range — a trade counting on the day it was closed, like Zerodha's own P&L.
// Trades typed in by hand by an earlier version are kept in the record but no longer counted.
// A round trip runs from flat to flat in one instrument: every fill that opens, adds to,
// reduces or closes the position belongs to it. A fill that flips the position through zero
// is split between the trip it closes and the one it opens.
//
// Charges are an ESTIMATE from Zerodha's published equity rates (brokerage, STT, exchange
// and SEBI fees, GST, stamp duty, DP charge); the contract note is the truth.
// Pure functions plus a small store; no timers, no orders.

const crypto = require("node:crypto");

const IST = 5.5 * 3600 * 1000;
const NAME = "trading/journal.json";
const MAX_FILLS = 60000;
const r2 = (x) => Math.round(x * 100) / 100;
const istIso = (ms) => new Date(ms + IST).toISOString();

/* ------------------------------------------------------------------ fills */

/** "2026-11-12 09:30:01" (IST, as Zerodha writes it) or an ISO time → ms. */
function parseTime(s) {
  if (!s) return NaN;
  const t = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(t)) return Date.parse(`${t.replace(" ", "T")}${t.length === 16 ? ":00" : ""}+05:30`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return Date.parse(`${t}T09:15:00+05:30`);
  return Date.parse(t);
}

/** A trade from the broker (server/trading/broker.js shapeTrade) → a journal fill. */
function fromKite(t) {
  const at = parseTime(t.at);
  if (!t.id || !Number.isFinite(at) || !(t.quantity > 0) || !(t.price > 0)) return null;
  return { id: `k:${t.exchange}:${t.id}`, orderId: t.orderId || "", exchange: t.exchange, symbol: t.symbol, side: t.side === "SELL" ? "SELL" : "BUY", qty: t.quantity, price: t.price, at, product: t.product || "", source: "kite" };
}

/** A minimal CSV reader (quoted fields, commas inside quotes). */
function csvRows(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let q = false;
  const s = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i += 1;
      row.push(cur);
      cur = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
  }
  return rows;
}

/**
 * Zerodha Console tradebook CSV → fills. Columns used (by name, any order):
 * symbol, exchange, trade_type (buy/sell), quantity, price, trade_id, order_id,
 * order_execution_time (or trade_date). Unknown rows are counted, not guessed.
 */
function fromConsoleCsv(text) {
  const rows = csvRows(text);
  if (rows.length < 2) return { fills: [], skipped: 0, error: "The file has no trades in it." };
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = (...names) => names.map((n) => head.indexOf(n)).find((i) => i >= 0);
  const c = { symbol: col("symbol", "tradingsymbol"), exchange: col("exchange"), side: col("trade_type", "type", "transaction_type"), qty: col("quantity", "qty"), price: col("price", "trade_price"), id: col("trade_id"), order: col("order_id"), time: col("order_execution_time", "trade_time", "execution_time"), date: col("trade_date", "date"), segment: col("segment"), product: col("product") };
  if ([c.symbol, c.side, c.qty, c.price].some((i) => i === undefined)) return { fills: [], skipped: rows.length - 1, error: "This does not look like a Zerodha Console tradebook (it needs symbol, trade_type, quantity and price columns)." };
  const fills = [];
  let skipped = 0;
  rows.slice(1).forEach((r, i) => {
    const get = (k) => (c[k] === undefined ? "" : String(r[c[k]] || "").trim());
    const side = get("side").toUpperCase();
    // a spreadsheet re-save may add thousands separators: "1,510.00"
    const qty = Number(get("qty").replace(/,/g, ""));
    const price = Number(get("price").replace(/,/g, ""));
    const at = parseTime(get("time") || get("date"));
    const symbol = get("symbol").toUpperCase();
    const exchange = (get("exchange") || "NSE").toUpperCase();
    if (!symbol || !["BUY", "SELL"].includes(side) || !(qty > 0) || !(price > 0) || !Number.isFinite(at)) {
      skipped += 1;
      return;
    }
    const tid = get("id") || `${get("order")}-${i}`;
    fills.push({ id: `k:${exchange}:${tid}`, orderId: get("order"), exchange, symbol, side, qty, price, at, product: get("product").toUpperCase(), source: "console" });
  });
  return { fills, skipped, error: "" };
}

/* ---------------------------------------------------------------- periods */
// Every date here is an Indian (IST) calendar day, "YYYY-MM-DD".

const istDay = (ms) => istIso(ms).slice(0, 10);
const dayStartMs = (d) => Date.parse(`${d}T00:00:00+05:30`);
const dayEndMs = (d) => Date.parse(`${d}T23:59:59.999+05:30`);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (d) => DATE_RE.test(String(d || "")) && istDay(dayStartMs(d)) === d;
/** d + n days */
function addDays(d, n) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
/** d − n months, the day clamped to the month's length (31 May − 3 months = 28/29 Feb) */
function minusMonths(d, n) {
  const [y, m, dd] = d.split("-").map(Number);
  const total = y * 12 + (m - 1) - n;
  const yy = Math.floor(total / 12);
  const mm = (total % 12) + 1;
  const len = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  return `${yy}-${String(mm).padStart(2, "0")}-${String(Math.min(dd, len)).padStart(2, "0")}`;
}
const weekday = (d) => new Date(`${d}T00:00:00Z`).getUTCDay(); // 0 Sunday
/** The financial year (April to March) a day falls in, by its starting year: 2026-11-15 → 2026. */
const fyOf = (d) => {
  const [y, m] = d.split("-").map(Number);
  return m >= 4 ? y : y - 1;
};
const fyLabel = (y) => `FY ${y}-${String((y + 1) % 100).padStart(2, "0")}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDay = (d) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

/**
 * A named period → its first and last day (IST). Trades count on the day they were closed.
 *   today · yesterday (the previous weekday: on Monday it is Friday; exchange holidays are not known)
 *   week (Monday to today) · month · quarter (Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar)
 *   6m · 9m · 12m (the same date that many months ago, to today) · fy (this financial year)
 *   fy-2024 (1 Apr 2024 – 31 Mar 2025) · all (since the first trade) · custom (from, to)
 * @returns { id, label, fromDay, toDay, from, to } or null when the period is not valid
 */
function periodRange(id, now = Date.now(), { from = "", to = "", firstAt = null } = {}) {
  const today = istDay(now);
  const out = (label, fromDay, toDay) => (fromDay && toDay && fromDay > toDay ? null : { id, label, fromDay, toDay, from: fromDay ? dayStartMs(fromDay) : null, to: toDay ? dayEndMs(toDay) : null });
  switch (id) {
    case "today":
      return out("Today", today, today);
    case "yesterday": {
      let d = addDays(today, -1);
      while (weekday(d) === 0 || weekday(d) === 6) d = addDays(d, -1);
      return out(`Yesterday (${shortDay(d)})`, d, d);
    }
    case "week":
      return out("This week", addDays(today, -((weekday(today) + 6) % 7)), today);
    case "month":
      return out(`This month (${MONTHS[Number(today.slice(5, 7)) - 1]})`, `${today.slice(0, 7)}-01`, today);
    case "quarter": {
      const m = Number(today.slice(5, 7));
      const q0 = m - ((m - 1) % 3);
      return out(`This quarter (${MONTHS[q0 - 1]}–${MONTHS[q0 + 1]})`, `${today.slice(0, 4)}-${String(q0).padStart(2, "0")}-01`, today);
    }
    case "6m":
    case "9m":
    case "12m":
      return out(`Last ${parseInt(id, 10)} months`, minusMonths(today, parseInt(id, 10)), today);
    case "fy": {
      const y = fyOf(today);
      return out(`This FY (${fyLabel(y).slice(3)})`, `${y}-04-01`, today);
    }
    case "all":
      return out("Since the first trade", firstAt ? istDay(firstAt) : null, today);
    case "custom": {
      if (!validDay(from) || !validDay(to)) return null;
      const t = to > today ? today : to;
      return out(`${shortDay(from)} – ${shortDay(t)}`, from, t);
    }
    default: {
      const fy = /^fy-(\d{4})$/.exec(String(id || ""));
      if (!fy) return null;
      const y = Number(fy[1]);
      if (y < 2000 || y > fyOf(today)) return null;
      const end = `${y + 1}-03-31`;
      return out(fyLabel(y), `${y}-04-01`, end > today ? today : end);
    }
  }
}

/* ------------------------------------------------------------ round trips */

/**
 * Fills → round trips, flat to flat, per exchange + symbol, in time order.
 * @returns [{ key, symbol, exchange, side, qty, entryAvg, exitAvg, entryAt, exitAt, pnl, open, fills, intraday, product }]
 */
function roundTrips(fills) {
  const by = new Map();
  for (const f of [...fills].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))) {
    const k = `${f.exchange}:${f.symbol}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(f);
  }
  const trips = [];
  for (const list of by.values()) {
    let cur = null;
    let pos = 0;
    const start = (f, qty) => {
      cur = { symbol: f.symbol, exchange: f.exchange, side: f.side === "BUY" ? "long" : "short", entryAt: f.at, exitAt: null, buyQty: 0, buyVal: 0, sellQty: 0, sellVal: 0, maxQty: 0, fills: 0, products: new Set(), sources: new Set() };
      pos = 0;
      return qty;
    };
    const add = (f, qty) => {
      if (f.side === "BUY") {
        cur.buyQty += qty;
        cur.buyVal += qty * f.price;
        pos += qty;
      } else {
        cur.sellQty += qty;
        cur.sellVal += qty * f.price;
        pos -= qty;
      }
      cur.fills += 1;
      if (f.source) cur.sources.add(f.source);
      if (f.product) cur.products.add(f.product);
      cur.maxQty = Math.max(cur.maxQty, Math.abs(pos));
      cur.lastAt = f.at;
    };
    const close = () => {
      cur.exitAt = cur.lastAt;
      trips.push(finish(cur, false));
      cur = null;
      pos = 0;
    };
    for (const f of list) {
      let qty = f.qty;
      if (!cur) start(f, qty);
      const sign = f.side === "BUY" ? 1 : -1;
      // the part of this fill that closes the position, and what is left to open the next trip
      if (pos !== 0 && Math.sign(pos) !== sign && qty > Math.abs(pos)) {
        const closing = Math.abs(pos);
        add(f, closing);
        close();
        qty -= closing;
        start(f, qty);
      }
      add(f, qty);
      if (pos === 0) close();
    }
    if (cur) trips.push(finish(cur, true));
  }
  return trips.sort((a, b) => a.entryAt - b.entryAt);
}

function finish(t, open) {
  const long = t.side === "long";
  const qty = long ? t.buyQty : t.sellQty;
  const entryAvg = long ? t.buyVal / t.buyQty : t.sellVal / t.sellQty;
  const exitQty = long ? t.sellQty : t.buyQty;
  const exitAvg = exitQty ? (long ? t.sellVal / t.sellQty : t.buyVal / t.buyQty) : null;
  const closedQty = Math.min(t.buyQty, t.sellQty);
  // realised P&L on the closed quantity only; an open trip shows what is closed so far
  const pnl = closedQty ? (long ? (exitAvg - entryAvg) * closedQty : (entryAvg - exitAvg) * closedQty) : 0;
  const products = [...t.products];
  const intraday = !open && istIso(t.entryAt).slice(0, 10) === istIso(t.exitAt).slice(0, 10);
  return {
    key: `${t.exchange}:${t.symbol}:${t.entryAt}`,
    symbol: t.symbol,
    exchange: t.exchange,
    side: t.side,
    qty,
    maxQty: t.maxQty,
    entryAvg: r2(entryAvg),
    exitAvg: exitAvg === null ? null : r2(exitAvg),
    entryAt: t.entryAt,
    exitAt: open ? null : t.exitAt,
    turnoverBuy: t.buyVal,
    turnoverSell: t.sellVal,
    pnl: r2(pnl),
    open,
    fills: t.fills,
    product: products.length === 1 ? products[0] : intraday ? "MIS" : products.includes("CNC") || !products.length ? "CNC" : products.join("/"),
    intraday,
    sources: [...t.sources], // "kite" (captured from Kite) and/or "console" (a tradebook import)
    holdMin: open ? null : Math.round((t.exitAt - t.entryAt) / 60000),
  };
}

/* ---------------------------------------------------------------- charges */

/**
 * An estimate of Zerodha's charges on an NSE/BSE equity round trip (published rates; they
 * change — the contract note is the truth). F&O and commodities are not estimated (0).
 */
function chargeParts(t) {
  const zero = { brokerage: 0, stt: 0, exchange: 0, sebi: 0, gst: 0, stamp: 0, dp: 0 };
  if (!["NSE", "BSE"].includes(t.exchange)) return zero;
  const buy = t.turnoverBuy;
  const sell = t.turnoverSell;
  const turnover = buy + sell;
  const intraday = t.intraday;
  const brokerage = intraday ? Math.min(20, buy * 0.0003) + Math.min(20, sell * 0.0003) : 0;
  const stt = intraday ? sell * 0.00025 : turnover * 0.001;
  const exchange = turnover * (t.exchange === "NSE" ? 0.0000297 : 0.0000375);
  const sebi = turnover * 0.000001;
  const gst = 0.18 * (brokerage + exchange + sebi);
  const stamp = buy * (intraday ? 0.00003 : 0.00015);
  const dp = !intraday && sell > 0 ? 15.34 : 0;
  return { brokerage, stt, exchange, sebi, gst, stamp, dp };
}

function charges(t) {
  const p = chargeParts(t);
  return r2(p.brokerage + p.stt + p.exchange + p.sebi + p.gst + p.stamp + p.dp);
}

/* ------------------------------------------------------------------ stats */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function group(trips, keyOf) {
  const m = new Map();
  for (const t of trips) {
    const k = keyOf(t);
    if (k === null || k === undefined || k === "") continue;
    const g = m.get(k) || { key: k, trades: 0, wins: 0, net: 0, gross: 0, charges: 0, brokerage: 0 };
    g.trades += 1;
    if (t.net > 0) g.wins += 1;
    g.net += t.net;
    g.gross += t.pnl;
    g.charges += t.charges || 0;
    g.brokerage += t.brokerage || 0;
    m.set(k, g);
  }
  return [...m.values()].map((g) => ({ ...g, net: r2(g.net), gross: r2(g.gross), charges: r2(g.charges), brokerage: r2(g.brokerage), taxes: r2(g.charges - g.brokerage), winRate: g.trades ? r2((g.wins / g.trades) * 100) : 0, avg: g.trades ? r2(g.net / g.trades) : 0 }));
}

/**
 * The numbers for a set of closed round trips (each with .net = pnl − charges, and .tags).
 */
function stats(trips) {
  const closed = trips.filter((t) => !t.open);
  const wins = closed.filter((t) => t.net > 0);
  const losses = closed.filter((t) => t.net <= 0);
  const sum = (a, f) => a.reduce((s, t) => s + f(t), 0);
  const grossWin = sum(wins, (t) => t.net);
  const grossLoss = -sum(losses, (t) => t.net);
  // equity curve and drawdown, in exit order
  let eq = 0;
  let peak = 0;
  let maxDd = 0;
  let streak = 0;
  let bestStreak = 0;
  let worstStreak = 0;
  const curve = [];
  for (const t of [...closed].sort((a, b) => a.exitAt - b.exitAt)) {
    eq += t.net;
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, peak - eq);
    streak = t.net > 0 ? (streak > 0 ? streak + 1 : 1) : streak < 0 ? streak - 1 : -1;
    bestStreak = Math.max(bestStreak, streak);
    worstStreak = Math.min(worstStreak, streak);
    curve.push({ at: t.exitAt, equity: r2(eq), net: t.net, symbol: t.symbol });
  }
  const day = (ms) => istIso(ms).slice(0, 10);
  const calendar = group(closed, (t) => day(t.exitAt)).sort((a, b) => (a.key < b.key ? -1 : 1));
  const n = closed.length;
  return {
    trades: n,
    open: trips.length - n,
    wins: wins.length,
    losses: losses.length,
    winRate: n ? r2((wins.length / n) * 100) : 0,
    gross: r2(sum(closed, (t) => t.pnl)),
    charges: r2(sum(closed, (t) => t.charges)),
    net: r2(sum(closed, (t) => t.net)),
    avgWin: wins.length ? r2(grossWin / wins.length) : 0,
    avgLoss: losses.length ? r2(-grossLoss / losses.length) : 0,
    payoff: losses.length && wins.length ? r2(grossWin / wins.length / (grossLoss / losses.length || 1)) : null,
    profitFactor: grossLoss > 0 ? r2(grossWin / grossLoss) : wins.length ? null : 0,
    expectancy: n ? r2(sum(closed, (t) => t.net) / n) : 0,
    largestWin: wins.length ? r2(Math.max(...wins.map((t) => t.net))) : 0,
    largestLoss: losses.length ? r2(Math.min(...losses.map((t) => t.net))) : 0,
    maxDrawdown: r2(maxDd),
    bestStreak,
    worstStreak: -worstStreak,
    avgHoldMin: n ? Math.round(sum(closed, (t) => t.holdMin || 0) / n) : 0,
    tradingDays: calendar.length,
    greenDays: calendar.filter((d) => d.net > 0).length,
    curve,
    calendar,
    by: {
      symbol: group(closed, (t) => t.symbol).sort((a, b) => b.net - a.net),
      side: group(closed, (t) => t.side),
      kind: group(closed, (t) => (t.intraday ? "Intraday" : "Delivery / overnight")),
      weekday: group(closed, (t) => WEEKDAYS[new Date(t.entryAt + IST).getUTCDay()]).sort((a, b) => WEEKDAYS.indexOf(a.key) - WEEKDAYS.indexOf(b.key)),
      hour: group(closed, (t) => `${String(new Date(t.entryAt + IST).getUTCHours()).padStart(2, "0")}:00`).sort((a, b) => (a.key < b.key ? -1 : 1)),
      setup: group(closed, (t) => (t.tags && t.tags.setup) || null).sort((a, b) => b.net - a.net),
      mistake: group(
        closed.flatMap((t) => ((t.tags && t.tags.mistakes) || []).map((m) => ({ ...t, _m: m }))),
        (t) => t._m
      ).sort((a, b) => a.net - b.net),
    },
  };
}

/* ------------------------------------------------------- excursions */

/**
 * MAE / MFE: how far a trip went against you and in your favour while it was open, from
 * 1-minute bars ({ t: ms, h, l }). Rupees on the trip's largest size, and percent of entry.
 */
function excursion(trip, bars) {
  const inside = bars.filter((b) => b.t >= trip.entryAt - 60000 && b.t <= (trip.exitAt || Infinity));
  if (!inside.length) return null;
  const hi = Math.max(...inside.map((b) => b.h));
  const lo = Math.min(...inside.map((b) => b.l));
  const long = trip.side === "long";
  const fav = long ? hi - trip.entryAvg : trip.entryAvg - lo;
  const adv = long ? lo - trip.entryAvg : trip.entryAvg - hi;
  const q = trip.maxQty || trip.qty;
  const mfe = r2(Math.max(0, fav) * q);
  return {
    mfe,
    mae: r2(Math.min(0, adv) * q),
    mfePct: r2((Math.max(0, fav) / trip.entryAvg) * 100),
    maePct: r2((Math.min(0, adv) / trip.entryAvg) * 100),
    captured: mfe > 0 ? r2((trip.pnl / mfe) * 100) : null, // share of the best move that was kept
    bars: inside.length,
  };
}

/* -------------------------------------------------------------- summaries */

/**
 * The figures of a set of closed round trips, for one period or one month: trades, win rate,
 * gross, charges (brokerage and taxes), net, profit factor, expectancy, average win and loss,
 * the largest fall from a high (drawdown), the best and worst day, and charges as a share of gross.
 */
function summarize(closed) {
  const days = new Map();
  let wins = 0;
  let gross = 0;
  let ch = 0;
  let brk = 0;
  let net = 0;
  let won = 0;
  let lost = 0;
  let eq = 0;
  let peak = 0;
  let dd = 0;
  for (const t of [...closed].sort((a, b) => a.exitAt - b.exitAt)) {
    if (t.net > 0) {
      wins += 1;
      won += t.net;
    } else lost -= t.net;
    gross += t.pnl;
    ch += t.charges;
    brk += t.brokerage;
    net += t.net;
    eq += t.net;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
    const k = istDay(t.exitAt);
    days.set(k, (days.get(k) || 0) + t.net);
  }
  const n = closed.length;
  const list = [...days.entries()];
  const best = list.reduce((a, x) => (!a || x[1] > a[1] ? x : a), null);
  const worst = list.reduce((a, x) => (!a || x[1] < a[1] ? x : a), null);
  return {
    trades: n,
    wins,
    losses: n - wins,
    winRate: n ? r2((wins / n) * 100) : 0,
    gross: r2(gross),
    charges: r2(ch),
    brokerage: r2(brk),
    taxes: r2(ch - brk),
    net: r2(net),
    profitFactor: lost > 0 ? r2(won / lost) : wins ? null : 0,
    expectancy: n ? r2(net / n) : 0,
    avgWin: wins ? r2(won / wins) : 0,
    avgLoss: n - wins ? r2(-lost / (n - wins)) : 0,
    maxDrawdown: r2(dd),
    days: list.length,
    greenDays: list.filter((x) => x[1] > 0).length,
    bestDay: best && best[1] > 0 ? { day: best[0], net: r2(best[1]) } : null,
    worstDay: worst && worst[1] < 0 ? { day: worst[0], net: r2(worst[1]) } : null,
    chargesPct: gross > 0 ? r2((ch / gross) * 100) : null,
  };
}

/** Closed trips → one row per calendar month (newest first), each with its summary. */
function byMonth(closed) {
  const m = new Map();
  for (const t of closed) {
    const k = istDay(t.exitAt).slice(0, 7);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(t);
  }
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([month, list]) => ({ month, ...summarize(list) }));
}

/* ------------------------------------------------------------------ store */

const MISTAKES = ["Chased the entry", "No stop", "Moved the stop", "Exited too early", "Held a loser", "Oversized", "Against the trend", "Revenge trade", "Overtraded", "Ignored the plan"];

class TradeJournal {
  constructor(docs) {
    this.docs = docs;
  }

  _load() {
    const d = this.docs.read(NAME, null);
    return { fills: (d && d.fills) || {}, tags: (d && d.tags) || {}, excursions: (d && d.excursions) || {}, imports: (d && d.imports) || [], captured: (d && d.captured) || {}, accountSince: (d && d.accountSince) || "", views: (d && d.views) || [] };
  }

  _save(d) {
    const ids = Object.keys(d.fills);
    if (ids.length > MAX_FILLS) {
      const keep = ids.sort((a, b) => d.fills[b].at - d.fills[a].at).slice(0, MAX_FILLS);
      d.fills = Object.fromEntries(keep.map((k) => [k, d.fills[k]]));
    }
    this.docs.write(NAME, d);
  }

  /** Adds fills it has not seen. @returns how many were new */
  add(fills, source) {
    const d = this._load();
    let added = 0;
    for (const f of fills) {
      if (!f || d.fills[f.id]) continue;
      d.fills[f.id] = f;
      added += 1;
    }
    if (added || source === "console") {
      if (source === "console") {
        // the dates the file covers (its first and last trade): shown under "Where the history comes from"
        const ats = fills.filter(Boolean).map((f) => f.at);
        d.imports = [{ at: Date.now(), added, total: fills.length, fromDay: ats.length ? istDay(Math.min(...ats)) : null, toDay: ats.length ? istDay(Math.max(...ats)) : null }, ...d.imports].slice(0, 60);
      }
      this._save(d);
    }
    return added;
  }

  /** A day Kite's trades were read (the server's automatic capture, or a page read): proof the day is complete. */
  markCaptured(dayKey, trades) {
    if (!validDay(dayKey)) return;
    const d = this._load();
    const prev = d.captured[dayKey];
    if (prev && (Number(trades) || 0) <= (prev.trades || 0)) return; // nothing new: no write every five minutes
    d.captured[dayKey] = { at: Date.now(), trades: Math.max(Number(trades) || 0, (prev && prev.trades) || 0) };
    const keys = Object.keys(d.captured).sort();
    if (keys.length > 1200) for (const k of keys.slice(0, keys.length - 1200)) delete d.captured[k];
    this._save(d);
  }

  /** When the Zerodha account was opened (optional; Kite's API does not say): the financial years are listed from it. */
  setAccountSince(dayKey) {
    const v = String(dayKey || "").trim();
    if (v && (!validDay(v) || v > istDay(Date.now()) || v < "2000-01-01")) return { error: "Give the date the account was opened, as a past date." };
    const d = this._load();
    d.accountSince = v;
    this._save(d);
    return { accountSince: v };
  }

  ingestKite(trades) {
    return this.add(trades.map(fromKite).filter(Boolean), "kite");
  }

  importCsv(text) {
    const r = fromConsoleCsv(text);
    if (r.error) return { added: 0, read: 0, skipped: r.skipped, error: r.error };
    const added = this.add(r.fills, "console");
    return { added, read: r.fills.length, skipped: r.skipped, error: "" };
  }

  /* ------------------------------------------------- your saved analytics views */
  views() {
    return this._load().views;
  }

  /** Save a named view of the journal: a period (or a custom range) and the filters. Same name: replaced. */
  saveView(input = {}, now = Date.now()) {
    const name = String(input.name || "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (!name) return { error: "Give the view a name." };
    const period = String(input.period || "");
    const range = periodRange(period, now, { from: input.from, to: input.to, firstAt: this.firstAt() });
    if (!range) return { error: "That period is not valid." };
    const view = {
      id: crypto.createHash("sha1").update(name.toLowerCase()).digest("hex").slice(0, 10),
      name,
      period,
      from: period === "custom" ? String(input.from) : "",
      to: period === "custom" ? String(input.to) : "",
      kind: ["intraday", "delivery"].includes(input.kind) ? input.kind : "",
      side: ["long", "short"].includes(input.side) ? input.side : "",
      setup: String(input.setup || "").slice(0, 60),
      at: new Date(now).toISOString(),
    };
    const d = this._load();
    d.views = [view, ...d.views.filter((v) => v.id !== view.id)].slice(0, 40);
    this._save(d);
    return { view, views: d.views };
  }

  removeView(id) {
    const d = this._load();
    const before = d.views.length;
    d.views = d.views.filter((v) => v.id !== String(id));
    if (d.views.length !== before) this._save(d);
    return { removed: before - d.views.length, views: d.views };
  }

  setTags(key, { setup, mistakes, note, rating } = {}) {
    const d = this._load();
    const clean = {
      setup: String(setup || "").trim().slice(0, 60),
      mistakes: (Array.isArray(mistakes) ? mistakes : []).map((m) => String(m).trim().slice(0, 40)).filter(Boolean).slice(0, 6),
      note: String(note || "").trim().slice(0, 1000),
      rating: [1, 2, 3, 4, 5].includes(Number(rating)) ? Number(rating) : null,
    };
    if (!clean.setup && !clean.mistakes.length && !clean.note && !clean.rating) delete d.tags[key];
    else d.tags[key] = clean;
    this._save(d);
    return clean;
  }

  setExcursion(key, value) {
    const d = this._load();
    d.excursions[key] = value;
    this._save(d);
  }

  /** Round trips with charges, tags and excursions attached, filtered. */
  trips({ from = null, to = null, symbol = "", side = "", kind = "", setup = "" } = {}) {
    const d = this._load();
    // only Zerodha's own fills (Kite and Console imports); hand-typed ones of an earlier version are not counted
    return roundTrips(Object.values(d.fills).filter((f) => f.source !== "manual"))
      .map((t) => {
        const c = t.open ? 0 : charges(t);
        const brokerage = t.open ? 0 : r2(chargeParts(t).brokerage);
        return { ...t, charges: c, brokerage, net: r2(t.pnl - c), tags: d.tags[t.key] || null, exc: d.excursions[t.key] || null };
      })
      // a closed trade counts on the day it was closed (as in Zerodha's P&L); an open one by its entry
      .filter((t) => {
        const at = t.open ? t.entryAt : t.exitAt;
        return (!from || at >= from) && (!to || at <= to);
      })
      .filter((t) => (!symbol || t.symbol === symbol) && (!side || t.side === side) && (!kind || (kind === "intraday" ? t.intraday : !t.intraday)) && (!setup || (t.tags && t.tags.setup === setup)));
  }

  /** The first trade on record (ms), from Zerodha's fills only, or null. */
  firstAt() {
    const at = Object.values(this._load().fills).reduce((a, f) => (f.source === "manual" ? a : Math.min(a, f.at)), Infinity);
    return Number.isFinite(at) ? at : null;
  }

  view(filters = {}) {
    const d = this._load();
    const trips = this.trips(filters);
    const setups = [...new Set(Object.values(d.tags).map((t) => t.setup).filter(Boolean))].sort();
    const all = Object.values(d.fills);
    return {
      stats: stats(trips),
      trips: trips.slice(-500).reverse(),
      fills: all.filter((f) => f.source !== "manual").length,
      ignoredManual: all.filter((f) => f.source === "manual").length,
      imports: d.imports,
      setups,
      mistakes: MISTAKES,
      firstAt: this.firstAt(),
      period: filters.period || null,
    };
  }

  /**
   * Profit and loss for every standard period at once — today, yesterday, week, month, quarter,
   * 6 / 9 / 12 months, this financial year, every past financial year since the account opened (or
   * the first trade), and since the first trade — plus where the history comes from and the gaps
   * in it. Closed trades only, each on the day it was closed.
   */
  periods(now = Date.now()) {
    const d = this._load();
    const firstAt = this.firstAt();
    const today = istDay(now);
    const closed = this.trips({}).filter((t) => !t.open);
    const row = (id) => {
      const p = periodRange(id, now, { firstAt });
      if (!p) return null;
      return { ...p, ...summarize(closed.filter((t) => (!p.from || t.exitAt >= p.from) && t.exitAt <= p.to)) };
    };
    const startDay = d.accountSince || (firstAt ? istDay(firstAt) : today);
    const fys = [];
    for (let y = fyOf(today) - 1; y >= fyOf(startDay) && fys.length < 40; y -= 1) fys.push(row(`fy-${y}`));
    // where the history comes from, and runs of 10+ weekdays with nothing on record
    const known = new Set([...closed.map((t) => istDay(t.exitAt)), ...closed.map((t) => istDay(t.entryAt)), ...Object.keys(d.captured)]);
    for (const imp of d.imports) if (imp.fromDay && imp.toDay) for (let k = imp.fromDay, n = 0; k <= imp.toDay && n < 800; k = addDays(k, 1), n += 1) known.add(k);
    const gaps = [];
    let run = null;
    for (let k = startDay, n = 0; k < today && n < 20000; k = addDays(k, 1), n += 1) {
      if (weekday(k) === 0 || weekday(k) === 6) continue;
      if (known.has(k)) {
        if (run && run.weekdays >= 10) gaps.push(run);
        run = null;
      } else run = run ? { ...run, toDay: k, weekdays: run.weekdays + 1 } : { fromDay: k, toDay: k, weekdays: 1 };
    }
    if (run && run.weekdays >= 10) gaps.push(run);
    const capturedDays = Object.keys(d.captured).sort();
    return {
      today,
      firstAt,
      firstDay: firstAt ? istDay(firstAt) : null,
      accountSince: d.accountSince,
      rows: ["today", "yesterday", "week", "month", "quarter", "6m", "9m", "12m", "fy"].map(row).filter(Boolean),
      fys: fys.filter(Boolean),
      all: row("all"),
      sources: {
        kite: Object.values(d.fills).filter((f) => f.source === "kite").length,
        console: Object.values(d.fills).filter((f) => f.source === "console").length,
        imports: d.imports.slice(0, 20),
        capturedDays: capturedDays.length,
        lastCaptured: capturedDays.length ? { day: capturedDays[capturedDays.length - 1], ...d.captured[capturedDays[capturedDays.length - 1]] } : null,
      },
      gaps: gaps.sort((a, b) => b.weekdays - a.weekdays).slice(0, 12).sort((a, b) => (a.fromDay < b.fromDay ? 1 : -1)),
      // every month since the first trade, for the heatmap (financial year × month)
      months: byMonth(closed).map((x) => ({ month: x.month, fy: fyOf(`${x.month}-01`), net: x.net, gross: x.gross, charges: x.charges, trades: x.trades, winRate: x.winRate, profitFactor: x.profitFactor })),
      views: d.views,
    };
  }

  /** The deeper figures of one period: its summary, month by month, best and worst month. */
  analytics(filters = {}) {
    const closed = this.trips(filters).filter((t) => !t.open);
    const months = byMonth(closed);
    const best = months.reduce((a, x) => (!a || x.net > a.net ? x : a), null);
    const worst = months.reduce((a, x) => (!a || x.net < a.net ? x : a), null);
    return { summary: summarize(closed), months, bestMonth: best && best.net > 0 ? { month: best.month, net: best.net } : null, worstMonth: worst && worst.net < 0 ? { month: worst.month, net: worst.net } : null };
  }

  /**
   * Save every period's profit and loss in the database: the latest figures in full, and one
   * compact line per period per day (the last 800 days), so how each period stood on any day is
   * kept for your own analysis. Written only when something changed.
   */
  snapshot(now = Date.now()) {
    const NAME_S = "trading/pnl-snapshots.json";
    const per = this.periods(now);
    const rows = [...per.rows, ...per.fys, ...(per.all ? [per.all] : [])];
    const compact = rows.map((r) => [r.id, r.label, r.fromDay, r.toDay, r.trades, r.winRate, r.gross, r.charges, r.net, r.profitFactor, r.maxDrawdown]);
    const prev = this.docs.read(NAME_S, null) || { days: {} };
    const day = per.today;
    const same = prev.days && prev.days[day] && JSON.stringify(prev.days[day].rows) === JSON.stringify(compact);
    if (same) return { saved: false, day, days: Object.keys(prev.days).length };
    const days = { ...(prev.days || {}), [day]: { at: new Date(now).toISOString(), rows: compact } };
    const keys = Object.keys(days).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - 800))) delete days[k];
    this.docs.write(NAME_S, { columns: ["id", "label", "from", "to", "trades", "winRate", "gross", "charges", "net", "profitFactor", "maxDrawdown"], latest: { at: new Date(now).toISOString(), rows, months: per.months }, days });
    return { saved: true, day, days: Object.keys(days).length };
  }

  /** The saved snapshots (for the page's note and the download). */
  snapshots() {
    const d = this.docs.read("trading/pnl-snapshots.json", null);
    return d ? { columns: d.columns, latestAt: d.latest && d.latest.at, days: d.days || {} } : { columns: [], latestAt: null, days: {} };
  }
}

module.exports = { TradeJournal, roundTrips, charges, chargeParts, stats, summarize, byMonth, excursion, fromConsoleCsv, fromKite, parseTime, csvRows, periodRange, fyOf, fyLabel, istDay, MISTAKES, NAME };
