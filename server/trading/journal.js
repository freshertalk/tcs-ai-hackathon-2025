"use strict";
// The trade journal: every fill you made, paired into round trips, and the numbers a
// performance journal is built on — win rate, profit factor, expectancy, drawdown, streaks,
// and where the money is made and lost (by stock, side, product, weekday, hour, tag).
//
// Fills arrive two ways:
//   - from Zerodha each day: today's trades are copied in whenever the account is read
//     (Zerodha's API only ever returns the current day's trades), and
//   - from a tradebook CSV exported from Zerodha Console (any date range) for the history.
// A round trip runs from flat to flat in one instrument: every fill that opens, adds to,
// reduces or closes the position belongs to it. A fill that flips the position through zero
// is split between the trip it closes and the one it opens.
//
// Charges are an ESTIMATE from Zerodha's published equity rates (brokerage, STT, exchange
// and SEBI fees, GST, stamp duty, DP charge); the contract note is the truth.
// Pure functions plus a small store; no timers, no orders.

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
      cur = { symbol: f.symbol, exchange: f.exchange, side: f.side === "BUY" ? "long" : "short", entryAt: f.at, exitAt: null, buyQty: 0, buyVal: 0, sellQty: 0, sellVal: 0, maxQty: 0, fills: 0, products: new Set() };
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
    holdMin: open ? null : Math.round((t.exitAt - t.entryAt) / 60000),
  };
}

/* ---------------------------------------------------------------- charges */

/**
 * An estimate of Zerodha's charges on an NSE/BSE equity round trip (published rates; they
 * change — the contract note is the truth). F&O and commodities are not estimated (0).
 */
function charges(t) {
  if (!["NSE", "BSE"].includes(t.exchange)) return 0;
  const buy = t.turnoverBuy;
  const sell = t.turnoverSell;
  const turnover = buy + sell;
  const intraday = t.intraday;
  const brokerage = intraday ? Math.min(20, buy * 0.0003) + Math.min(20, sell * 0.0003) : 0;
  const stt = intraday ? sell * 0.00025 : turnover * 0.001;
  const exch = turnover * (t.exchange === "NSE" ? 0.0000297 : 0.0000375);
  const sebi = turnover * 0.000001;
  const gst = 0.18 * (brokerage + exch + sebi);
  const stamp = buy * (intraday ? 0.00003 : 0.00015);
  const dp = !intraday && sell > 0 ? 15.34 : 0;
  return r2(brokerage + stt + exch + sebi + gst + stamp + dp);
}

/* ------------------------------------------------------------------ stats */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function group(trips, keyOf) {
  const m = new Map();
  for (const t of trips) {
    const k = keyOf(t);
    if (k === null || k === undefined || k === "") continue;
    const g = m.get(k) || { key: k, trades: 0, wins: 0, net: 0, gross: 0 };
    g.trades += 1;
    if (t.net > 0) g.wins += 1;
    g.net += t.net;
    g.gross += t.pnl;
    m.set(k, g);
  }
  return [...m.values()].map((g) => ({ ...g, net: r2(g.net), gross: r2(g.gross), winRate: g.trades ? r2((g.wins / g.trades) * 100) : 0, avg: g.trades ? r2(g.net / g.trades) : 0 }));
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

/* ------------------------------------------------------------------ store */

const MISTAKES = ["Chased the entry", "No stop", "Moved the stop", "Exited too early", "Held a loser", "Oversized", "Against the trend", "Revenge trade", "Overtraded", "Ignored the plan"];

class TradeJournal {
  constructor(docs) {
    this.docs = docs;
  }

  _load() {
    const d = this.docs.read(NAME, null);
    return { fills: (d && d.fills) || {}, tags: (d && d.tags) || {}, excursions: (d && d.excursions) || {}, imports: (d && d.imports) || [] };
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
      if (source === "console") d.imports = [{ at: Date.now(), added, total: fills.length }, ...d.imports].slice(0, 20);
      this._save(d);
    }
    return added;
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
    return roundTrips(Object.values(d.fills))
      .map((t) => {
        const c = t.open ? 0 : charges(t);
        return { ...t, charges: c, net: r2(t.pnl - c), tags: d.tags[t.key] || null, exc: d.excursions[t.key] || null };
      })
      .filter((t) => (!from || t.entryAt >= from) && (!to || t.entryAt <= to))
      .filter((t) => (!symbol || t.symbol === symbol) && (!side || t.side === side) && (!kind || (kind === "intraday" ? t.intraday : !t.intraday)) && (!setup || (t.tags && t.tags.setup === setup)));
  }

  view(filters = {}) {
    const d = this._load();
    const trips = this.trips(filters);
    const setups = [...new Set(Object.values(d.tags).map((t) => t.setup).filter(Boolean))].sort();
    return {
      stats: stats(trips),
      trips: trips.slice(-500).reverse(),
      fills: Object.keys(d.fills).length,
      imports: d.imports,
      setups,
      mistakes: MISTAKES,
      firstAt: Object.values(d.fills).reduce((a, f) => Math.min(a, f.at), Infinity),
    };
  }
}

module.exports = { TradeJournal, roundTrips, charges, stats, excursion, fromConsoleCsv, fromKite, parseTime, csvRows, MISTAKES, NAME };
