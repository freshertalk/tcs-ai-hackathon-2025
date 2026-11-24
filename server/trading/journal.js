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
const { readXlsx } = require("./xlsx");
const retro = require("./retro");
const R = require("./returns");
const O = require("./otherbook");

const IST = 5.5 * 3600 * 1000;
const NAME = "trading/journal.json";
const FILLS = "journal_fills"; // one record per fill (docs.js items): years of trades would outgrow one record
const MAX_FILLS = 300000;
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

/** A minimal CSV reader (quoted fields, separators inside quotes; comma, semicolon or tab). */
function csvRows(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let q = false;
  const s = String(text || "").replace(/^﻿/, "");
  // the separator of the table itself: the line with the column names, else the first line
  const lines = s.split(/\r?\n/).slice(0, 40);
  const first = (lines.find((l) => /symbol/i.test(l)) || lines.find((l) => l.trim()) || "").replace(/"[^"]*"/g, "");
  const count = (ch) => first.split(ch).length - 1;
  const sep = count("\t") > count(",") && count("\t") > count(";") ? "\t" : count(";") > count(",") ? ";" : ",";
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) {
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
 * A date / time cell from a tradebook → ms. Zerodha writes "2026-11-12T09:30:01" or
 * "2026-11-12 09:30:01" (IST); a spreadsheet may hold an Excel date number (45607.396) or a
 * day-first "12-11-2026 09:30" / "12/11/2026". The date column fills in a time without a date.
 */
function parseWhen(time, date) {
  const cell = (v) => String(v === undefined || v === null ? "" : v).trim();
  const one = (v) => {
    const t = cell(v);
    if (!t) return NaN;
    if (/^\d{4,6}(\.\d+)?$/.test(t) && Number(t) > 20000 && Number(t) < 80000) {
      // an Excel date number: days since 30 Dec 1899, as wall-clock time (IST here)
      const wall = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(t) * 86400) * 1000).toISOString().slice(0, 19);
      return parseTime(wall);
    }
    const dm = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
    if (dm) {
      const [, d, m, y, hh, mm, ss] = dm;
      const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
      return hh ? parseTime(`${iso} ${hh.padStart(2, "0")}:${mm}:${ss || "00"}`) : parseTime(iso);
    }
    return parseTime(t.replace(/\.\d+$/, "").replace(/Z$/, ""));
  };
  const tm = cell(time);
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(tm)) {
    const d0 = one(date);
    return Number.isFinite(d0) ? parseTime(`${istIso(d0).slice(0, 10)} ${tm.length === 5 ? `${tm}:00` : tm.padStart(8, "0")}`) : NaN;
  }
  const a = one(tm);
  return Number.isFinite(a) ? a : one(date);
}

/** A tradebook's segment → the exchange code the journal uses (equity stays NSE / BSE). */
function exchangeOf(exchange, segment) {
  const ex = String(exchange || "").trim().toUpperCase() || "NSE";
  const seg = String(segment || "").trim().toUpperCase().replace(/[^A-Z&]/g, "");
  if (["NFO", "BFO", "CDS", "BCD", "MCX", "NCO"].includes(ex)) return ex;
  if (["FO", "F&O", "FNO", "DERIVATIVES", "NFO"].includes(seg)) return ex === "BSE" ? "BFO" : "NFO";
  if (["CD", "CDS", "CURRENCY"].includes(seg)) return ex === "BSE" ? "BCD" : "CDS";
  if (["COM", "MCX", "COMMODITY", "COMMODITIES"].includes(seg) || ex === "MCX") return "MCX";
  return ex;
}

const normHead = (h) => String(h || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/**
 * Tradebook rows (from a CSV or a spreadsheet) → fills. The header row is found among the first 40
 * rows (Console's .xlsx has a few title rows above it). Columns are matched by name in any order:
 * symbol, trade type, quantity and price are needed; trade id, order id, exchange, segment, series,
 * ISIN, product, auction, trade date and execution time are kept when present. Rows that cannot be
 * read are counted, not guessed. @returns { fills, skipped, error, segments, fromDay, toDay, rows }
 */
function fromRows(rows, { file = "" } = {}) {
  const hi = rows.slice(0, 40).findIndex((r) => {
    const h = r.map(normHead);
    return h.some((x) => x === "symbol" || x === "tradingsymbol") && h.some((x) => ["trade_type", "type", "transaction_type", "buy_sell"].includes(x)) && h.some((x) => ["quantity", "qty"].includes(x));
  });
  if (hi < 0) return { fills: [], skipped: Math.max(0, rows.length - 1), error: "This does not look like a Zerodha Console tradebook: it needs symbol, trade type, quantity and price columns.", segments: [], rows: 0 };
  const head = rows[hi].map(normHead);
  const col = (...names) => names.map((n) => head.indexOf(n)).find((i) => i >= 0);
  const c = { symbol: col("symbol", "tradingsymbol"), exchange: col("exchange"), side: col("trade_type", "type", "transaction_type", "buy_sell"), qty: col("quantity", "qty"), price: col("price", "trade_price", "average_price"), id: col("trade_id"), order: col("order_id"), time: col("order_execution_time", "trade_time", "execution_time", "time"), date: col("trade_date", "date"), segment: col("segment"), product: col("product"), series: col("series"), isin: col("isin"), auction: col("auction") };
  if (c.price === undefined) return { fills: [], skipped: rows.length - hi - 1, error: "The tradebook has no price column.", segments: [], rows: 0 };
  const fills = [];
  let skipped = 0;
  const segs = new Set();
  rows.slice(hi + 1).forEach((r, i) => {
    if (!r || !r.some((x) => String(x || "").trim())) return; // an empty line
    const get = (k) => (c[k] === undefined ? "" : String(r[c[k]] === undefined || r[c[k]] === null ? "" : r[c[k]]).trim());
    const side = get("side").toUpperCase().replace(/^B$/, "BUY").replace(/^S$/, "SELL");
    // a spreadsheet re-save may add thousands separators: "1,510.00"
    const qty = Math.abs(Number(get("qty").replace(/,/g, "")));
    const price = Number(get("price").replace(/,/g, ""));
    const at = parseWhen(get("time"), get("date"));
    const symbol = get("symbol").toUpperCase();
    const segment = get("segment").toUpperCase();
    const exchange = exchangeOf(get("exchange"), segment);
    if (!symbol || !["BUY", "SELL"].includes(side) || !(qty > 0) || !(price > 0) || !Number.isFinite(at)) {
      skipped += 1;
      return;
    }
    segs.add(exchange);
    const tid = get("id").replace(/\.0$/, "") || `${get("order").replace(/\.0$/, "")}-${i}`;
    const f = { id: `k:${exchange}:${tid}`, orderId: get("order").replace(/\.0$/, ""), exchange, symbol, side, qty, price, at, product: get("product").toUpperCase(), source: "console" };
    // everything else the tradebook says is kept with the fill
    if (segment) f.segment = segment;
    if (get("series")) f.series = get("series").toUpperCase();
    if (get("isin")) f.isin = get("isin").toUpperCase();
    if (/^(true|yes|y|1)$/i.test(get("auction"))) f.auction = true;
    if (get("date")) f.tradeDate = istIso(parseWhen("", get("date")) || at).slice(0, 10);
    if (file) f.file = file;
    fills.push(f);
  });
  const ats = fills.map((f) => f.at);
  return { fills, skipped, error: fills.length || !skipped ? "" : "No trade could be read from the file.", segments: [...segs], fromDay: ats.length ? istIso(Math.min(...ats)).slice(0, 10) : null, toDay: ats.length ? istIso(Math.max(...ats)).slice(0, 10) : null, rows: fills.length + skipped };
}

/** Zerodha Console tradebook CSV → fills (see fromRows). */
function fromConsoleCsv(text, opts) {
  const rows = csvRows(text);
  if (rows.length < 2) return { fills: [], skipped: 0, error: "The file has no trades in it.", segments: [], rows: 0 };
  return fromRows(rows, opts);
}

/**
 * Any tradebook file — .xlsx (Excel) or .csv — as bytes. The first sheet with a tradebook header
 * is read. @returns fromRows' result plus { kind: "xlsx" | "csv", sheet }
 */
function readTradebook(buf, opts = {}) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf || ""), "utf8");
  if (b.length >= 4 && b.readUInt32LE(0) === 0x04034b50) {
    let sheets;
    try {
      sheets = readXlsx(b);
    } catch (err) {
      return { fills: [], skipped: 0, error: err.message, segments: [], rows: 0, kind: "xlsx" };
    }
    let firstErr = null;
    for (const sh of sheets) {
      const r = fromRows(sh.rows, opts);
      if (r.fills.length) return { ...r, kind: "xlsx", sheet: sh.name };
      if (!firstErr) firstErr = r;
    }
    return { ...(firstErr || { fills: [], skipped: 0, error: "The spreadsheet has no sheets.", segments: [], rows: 0 }), kind: "xlsx" };
  }
  // text: UTF-8, or UTF-16 as Excel's "Unicode text" saves it
  const text = b[0] === 0xff && b[1] === 0xfe ? b.subarray(2).toString("utf16le") : b.toString("utf8");
  return { ...fromConsoleCsv(text, opts), kind: "csv" };
}

/**
 * The correction that makes a day match Zerodha's ledger (see reconcile): the day's extra charges (negative: fewer) are shared
 * among the day's closed trades in proportion to their estimated charges, and carried as the "other" charge, so every page —
 * the Journal, the Day book, the calendar, the returns — shows the corrected charges and net without knowing about it.
 */
function applyChargeFix(trips, fixes) {
  const days = Object.keys(fixes || {});
  if (!days.length) return trips;
  const by = new Map();
  for (const t of trips) {
    if (t.open) continue;
    const k = istDay(t.exitAt);
    if (fixes[k]) (by.get(k) || by.set(k, []).get(k)).push(t);
  }
  for (const [k, list] of by) {
    const fix = fixes[k];
    const extra = Number(fix.amount);
    if (!Number.isFinite(extra) || !extra) continue;
    const base = list.reduce((a, t) => a + t.chargesEst, 0);
    const ratio = (t) => (base > 0 ? t.chargesEst / base : 1 / list.length);
    // a correction that knows its heads (from Console's P&L statement) lands on those heads; otherwise on "other"
    const heads = fix.parts && typeof fix.parts === "object" && Object.keys(fix.parts).length ? fix.parts : { other: extra };
    const names = Object.keys(heads);
    const leftHead = { ...heads };
    let left = r2(extra);
    list.forEach((t, i) => {
      const last = i === list.length - 1;
      const share = last ? left : r2(extra * ratio(t));
      left = r2(left - share);
      t.charges = r2(t.chargesEst + share);
      t.net = r2(t.pnl - t.charges);
      if (t.parts) {
        const np = { ...t.parts };
        let put = 0;
        names.forEach((h, j) => {
          const part = last ? leftHead[h] : r2(heads[h] * ratio(t));
          leftHead[h] = r2(leftHead[h] - part);
          // the last head takes what the rounding left, so the heads always add up to the trade's charges
          const v = j === names.length - 1 ? r2(share - put) : part;
          put = r2(put + v);
          np[h] = r2((np[h] || 0) + v);
        });
        t.parts = np;
      }
    });
  }
  return trips;
}

/**
 * What a file from Zerodha Console is, read from its own headers (not its name): "tradebook" (symbol, trade type, quantity),
 * "ledger" (particulars, debit, credit) or "pnl" (Console's P&L statement — recognised, not read yet), else "unknown".
 */
function detectKind(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf || ""), "utf8");
  let sheets;
  try {
    if (b.length >= 4 && b.readUInt32LE(0) === 0x04034b50) sheets = readXlsx(b).map((s) => s.rows);
    else sheets = [csvRows(b[0] === 0xff && b[1] === 0xfe ? b.subarray(2).toString("utf16le") : b.toString("utf8"))];
  } catch (_) {
    return "unknown";
  }
  const heads = [];
  for (const rows of sheets) for (const r of rows.slice(0, 40)) heads.push(r.map(normHead));
  const has = (h, ...names) => names.some((n) => h.includes(n));
  // the order matters: a P&L statement also holds a sheet of other debits and credits that looks like a ledger
  if (heads.some((h) => has(h, "symbol", "tradingsymbol") && has(h, "trade_type", "type", "transaction_type", "buy_sell") && has(h, "quantity", "qty"))) return "tradebook";
  if (heads.some((h) => has(h, "symbol") && (has(h, "realized_p_l", "realised_p_l", "realized_profit", "profit") || (has(h, "buy_value") && has(h, "sell_value"))))) return "pnl";
  if (heads.some((h) => has(h, "particulars") && has(h, "debit") && has(h, "credit"))) return "ledger";
  return "unknown";
}

/** A Console ledger file (.xlsx or .csv bytes) → { entries, left, rows, error, kind }. See otherbook.js. */
function readLedger(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf || ""), "utf8");
  if (b.length >= 4 && b.readUInt32LE(0) === 0x04034b50) {
    let sheets;
    try {
      sheets = readXlsx(b);
    } catch (err) {
      return { entries: [], left: {}, rows: 0, error: err.message, kind: "xlsx" };
    }
    // every sheet that is a ledger (Console writes one per segment: Equity, Commodity…) is read and added together
    const all = { entries: [], left: {}, settle: {}, rows: 0 };
    let first = null;
    let found = false;
    for (const sh of sheets) {
      const r = O.fromLedgerRows(sh.rows);
      if (r.error) {
        if (!first) first = r;
        continue;
      }
      found = true;
      all.entries.push(...r.entries);
      all.rows += r.rows;
      for (const [k, n] of Object.entries(r.settle || {})) all.settle[k] = r2((all.settle[k] || 0) + n);
      for (const [k, n] of Object.entries(r.left)) all.left[k] = (all.left[k] || 0) + n;
    }
    if (found) return { ...all, entries: O.numbered(all.entries), error: "", kind: "xlsx" };
    return { ...(first || { entries: [], left: {}, rows: 0, error: "The spreadsheet has no sheets." }), kind: "xlsx" };
  }
  const text = b[0] === 0xff && b[1] === 0xfe ? b.subarray(2).toString("utf16le") : b.toString("utf8");
  const r = O.fromLedgerRows(csvRows(text));
  return { ...r, entries: O.numbered(r.entries), kind: "csv" };
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
  // the whole value of every order (Zerodha charges intraday brokerage per executed ORDER: ₹20 or 0.03%, whichever is lower)
  const orderValue = new Map();
  for (const f of fills) if (f && f.orderId) orderValue.set(`${f.side}:${f.orderId}`, (orderValue.get(`${f.side}:${f.orderId}`) || 0) + f.qty * f.price);
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
      cur = { symbol: f.symbol, exchange: f.exchange, side: f.side === "BUY" ? "long" : "short", entryAt: f.at, exitAt: null, buyQty: 0, buyVal: 0, sellQty: 0, sellVal: 0, maxQty: 0, fills: 0, products: new Set(), sources: new Set(), orders: new Map(), noOrder: false };
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
      // this trip's part of each order (an order can close one trip and open the next)
      if (f.orderId) cur.orders.set(`${f.side}:${f.orderId}`, (cur.orders.get(`${f.side}:${f.orderId}`) || 0) + qty * f.price);
      else cur.noOrder = true;
      if (f.source) cur.sources.add(f.source);
      if (f.product) cur.products.add(f.product);
      cur.maxQty = Math.max(cur.maxQty, Math.abs(pos));
      cur.lastAt = f.at;
    };
    const close = () => {
      cur.exitAt = cur.lastAt;
      cur.orderBrokerage = orderBrokerage(cur, orderValue);
      cur.orderCount = cur.orders.size;
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

/**
 * Intraday brokerage by Zerodha's rule — per executed order, ₹20 or 0.03% of the order's value, whichever is lower — with an
 * order shared between two trips split by value. null when a fill has no order id (an old import): the per-side estimate
 * is used then.
 */
function orderBrokerage(trip, orderValue) {
  if (trip.noOrder || !trip.orders || !trip.orders.size) return null;
  let total = 0;
  for (const [k, part] of trip.orders) {
    const whole = orderValue.get(k) || part;
    total += Math.min(20, whole * 0.0003) * (whole > 0 ? part / whole : 1);
  }
  return total;
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
    orderBrokerage: Number.isFinite(t.orderBrokerage) ? t.orderBrokerage : null, // per executed order (see orderBrokerage)
    orders: Number.isFinite(t.orderCount) ? t.orderCount : null,
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
  // per executed order when the orders are known (Zerodha's rule); otherwise one order a side, as before
  const brokerage = intraday ? (Number.isFinite(t.orderBrokerage) ? t.orderBrokerage : Math.min(20, buy * 0.0003) + Math.min(20, sell * 0.0003)) : 0;
  const stt = intraday ? sell * 0.00025 : turnover * 0.001;
  // NSE 0.00307% (24 Nov 2026: what Console charged on the owner's own statement, 185.13 on 6.03M); a ledger or P&L statement corrects any day
  const exchange = turnover * (t.exchange === "NSE" ? 0.0000307 : 0.0000375);
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

/** The money a trade put in: its size at the entry price (what the percentage returns are measured on). */
const entryValue = (t) => (num(t.entryAvg) && num(t.maxQty || t.qty) ? t.entryAvg * (t.maxQty || t.qty) : 0);
const num = (x) => typeof x === "number" && Number.isFinite(x);
/** A result as a percentage of the money put in (null when nothing was put in). */
const pctOf = (x, base) => (base > 0 ? Math.round((x / base) * 10000) / 100 : null);

function group(trips, keyOf) {
  const m = new Map();
  for (const t of trips) {
    const k = keyOf(t);
    if (k === null || k === undefined || k === "") continue;
    const g = m.get(k) || { key: k, trades: 0, wins: 0, net: 0, gross: 0, charges: 0, brokerage: 0, invested: 0, qty: 0, buyValue: 0, sellValue: 0 };
    g.trades += 1;
    // what Zerodha's P&L report shows per symbol: the quantity, and what was bought and sold for
    g.qty += num(t.qty) ? t.qty : 0;
    g.buyValue += num(t.turnoverBuy) ? t.turnoverBuy : 0;
    g.sellValue += num(t.turnoverSell) ? t.turnoverSell : 0;
    g.invested += entryValue(t);
    if (t.net > 0) g.wins += 1;
    g.net += t.net;
    g.gross += t.pnl;
    g.charges += t.charges || 0;
    g.brokerage += t.brokerage || 0;
    m.set(k, g);
  }
  return [...m.values()].map((g) => ({ ...g, buyValue: r2(g.buyValue), sellValue: r2(g.sellValue), buyAvg: g.qty ? r2(g.buyValue / g.qty) : null, sellAvg: g.qty ? r2(g.sellValue / g.qty) : null, invested: r2(g.invested), netPct: pctOf(g.net, g.invested), net: r2(g.net), gross: r2(g.gross), charges: r2(g.charges), brokerage: r2(g.brokerage), taxes: r2(g.charges - g.brokerage), winRate: g.trades ? r2((g.wins / g.trades) * 100) : 0, avg: g.trades ? r2(g.net / g.trades) : 0 }));
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
    // the money put into the trades (each trade's size at its entry price) and the result as a share of it
    invested: r2(sum(closed, entryValue)),
    netPct: pctOf(sum(closed, (t) => t.net), sum(closed, entryValue)),
    grossPct: pctOf(sum(closed, (t) => t.pnl), sum(closed, entryValue)),
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
  let invested = 0;
  for (const t of [...closed].sort((a, b) => a.exitAt - b.exitAt)) {
    invested += entryValue(t);
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
    invested: r2(invested),
    netPct: pctOf(net, invested),
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

/** The last day of a "YYYY-MM" month. */
const monthEnd = (m) => `${m}-${String(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;

class TradeJournal {
  constructor(docs) {
    this.docs = docs;
    this._ver = 0; // bumped on every change: the round trips are worked out again only then
    this._memo = null;
    this._migrated = false;
  }

  /** Fills live one record each when the store can (docs.js items); a plain store keeps them in the record. */
  _itemMode() {
    return typeof this.docs.items === "function" && typeof this.docs.putItems === "function";
  }

  /** The first version kept every fill inside the journal record: move them out, once. */
  _migrate() {
    if (this._migrated || !this._itemMode()) return;
    this._migrated = true;
    const d = this.docs.read(NAME, null);
    if (d && d.fills && Object.keys(d.fills).length) {
      this.docs.putItems(FILLS, Object.values(d.fills));
      const { fills, ...rest } = d;
      this.docs.write(NAME, rest);
      this._ver += 1;
    }
  }

  /** Every fill (read them, do not change them). */
  _fillsList() {
    if (!this._itemMode()) {
      const d = this.docs.read(NAME, null);
      return Object.values((d && d.fills) || {});
    }
    this._migrate();
    return this.docs.items(FILLS);
  }

  _load() {
    const d = this.docs.read(NAME, null);
    this._migrate();
    const out = { tags: (d && d.tags) || {}, excursions: (d && d.excursions) || {}, imports: (d && d.imports) || [], captured: (d && d.captured) || {}, accountSince: (d && d.accountSince) || "", views: (d && d.views) || [], retros: (d && d.retros) || [], capital: (d && d.capital) || [], manualDays: (d && d.manualDays) || {}, other: (d && d.other) || [], ledgerDays: (d && d.ledgerDays) || {}, chargeFix: (d && d.chargeFix) || {}, pnlRefs: (d && d.pnlRefs) || {} };
    if (!this._itemMode()) out.fills = (d && d.fills) || {};
    return out;
  }

  _save(d) {
    this._ver += 1;
    this.docs.write(NAME, d);
  }

  /**
   * Adds the fills it has not seen (by id: a trade from Kite and the same trade in a Console file are
   * one). @param meta for an import: { name, kind, file, segments, skipped } @returns how many were new
   */
  add(fills, source, meta = null) {
    const have = new Set(this._fillsList().map((f) => f.id));
    const fresh = [];
    for (const f of fills) {
      if (!f || !f.id || have.has(f.id)) continue;
      have.add(f.id);
      fresh.push(f);
    }
    if (have.size > MAX_FILLS) throw new Error(`The journal can hold ${MAX_FILLS.toLocaleString("en-IN")} fills; this would go past it.`);
    const d = this._load();
    if (fresh.length) {
      if (this._itemMode()) this.docs.putItems(FILLS, fresh);
      else for (const f of fresh) d.fills[f.id] = f;
      this._ver += 1;
    }
    if (source === "console") {
      // what the file held and the dates it covers: shown under "Where the history comes from"
      const ats = fills.filter(Boolean).map((f) => f.at);
      d.imports = [{ at: Date.now(), added: fresh.length, total: fills.length, fromDay: ats.length ? istDay(Math.min(...ats)) : null, toDay: ats.length ? istDay(Math.max(...ats)) : null, ...(meta || {}) }, ...d.imports].slice(0, 120);
    }
    if (source === "console" || (fresh.length && !this._itemMode())) this._save(d);
    return fresh.length;
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

  /* ------------------------------------------------------------------ the capital ledger */

  /** The money put in: the first capital, each addition, each withdrawal (dated, newest last). */
  capital() {
    return R.ledger(this._load().capital).map((e) => ({ ...e }));
  }

  /** Record money added (positive) or taken out (negative) on a day. The principal may never go below zero. */
  addCapital({ date, amount, note = "" } = {}, now = Date.now()) {
    const day = String(date || "").trim();
    const amt = Number(amount);
    if (!validDay(day) || day > istDay(now) || day < "2000-01-01") return { error: "Give the day the money went in as a date that has passed (YYYY-MM-DD)." };
    if (!Number.isFinite(amt) || amt === 0 || Math.abs(amt) > 1e10) return { error: "Give an amount: positive for money added, negative for money taken out." };
    const d = this._load();
    if ((d.capital || []).length >= 500) return { error: "The ledger holds 500 entries; remove one first." };
    const entry = { id: crypto.randomBytes(5).toString("hex"), date: day, amount: Math.round(amt * 100) / 100, note: String(note || "").trim().slice(0, 120), at: new Date(now).toISOString() };
    const next = [...(d.capital || []), entry];
    const bad = R.overdrawn(next);
    if (bad) return { error: `That would take the principal below zero on ${bad.date}: money cannot be taken out that was never put in.` };
    d.capital = next;
    this._save(d);
    return { entry, capital: this.capital() };
  }

  removeCapital(id) {
    const d = this._load();
    const left = (d.capital || []).filter((e) => e.id !== String(id));
    if (left.length === (d.capital || []).length) return { error: "There is no such entry." };
    const bad = R.overdrawn(left);
    if (bad) return { error: `Removing it would take the principal below zero on ${bad.date}: remove the later withdrawal first.` };
    d.capital = left;
    this._save(d);
    return { capital: this.capital() };
  }

  /* ------------------------------------------------------------------ other credits & debits */

  /** The estimated DP charge inside each day's charges (a DP charge entered or read from the ledger is not counted twice). */
  _dpByDay() {
    const m = new Map();
    for (const t of this.trips({})) {
      if (t.open || !t.parts || !t.parts.dp) continue;
      const k = istDay(t.exitAt);
      m.set(k, (m.get(k) || 0) + t.parts.dp);
    }
    return m;
  }

  /** The other credits & debits of a period (all when no days given): each entry with what counts, and the totals. */
  others({ fromDay = "", toDay = "" } = {}) {
    const list = O.counted(this._load().other, { fromDay, toDay }, this._dpByDay());
    return { entries: list, ...O.totals(list), kinds: O.KINDS };
  }

  /** One entry by hand: a credit is positive, a debit negative. */
  addOther({ date, amount, kind = "other", note = "" } = {}, now = Date.now()) {
    const day = String(date || "").trim();
    const amt = Number(amount);
    if (!validDay(day) || day > istDay(now) || day < "2000-01-01") return { error: "Give the day as a date that has passed (YYYY-MM-DD)." };
    if (!Number.isFinite(amt) || amt === 0 || Math.abs(amt) > 1e9) return { error: "Give an amount: positive for a credit, negative for a debit." };
    const k = Object.prototype.hasOwnProperty.call(O.KINDS, kind) ? kind : "other";
    const d = this._load();
    if (d.other.length >= 5000) return { error: "The list holds 5,000 entries; remove some first." };
    const text = String(note || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120);
    const entry = { id: crypto.randomBytes(5).toString("hex"), date: day, amount: r2(amt), kind: k, note: text, source: "manual", at: new Date(now).toISOString() };
    d.other = [...d.other, entry];
    this._save(d);
    return { entry, ...this.others() };
  }

  removeOther(id) {
    const d = this._load();
    const left = d.other.filter((e) => e.id !== String(id));
    if (left.length === d.other.length) return { error: "There is no such entry." };
    d.other = left;
    this._save(d);
    return this.others();
  }

  /** A Console ledger file → the other credits & debits it holds (lines already here are skipped). @returns { added, read, left, error, kind } */
  importLedger(buf, { name = "" } = {}, now = Date.now()) {
    const r = readLedger(buf);
    if (r.error) return { added: 0, read: 0, left: {}, error: r.error, kind: r.kind };
    const d = this._load();
    const have = new Set(d.other.map((e) => e.key).filter(Boolean));
    const fresh = [];
    for (const e of r.entries) {
      if (have.has(e.key)) continue;
      have.add(e.key);
      fresh.push({ id: crypto.randomBytes(5).toString("hex"), date: e.date, amount: e.amount, kind: e.kind, note: e.note, key: e.key, source: "console", file: String(name).slice(0, 100), at: new Date(now).toISOString() });
    }
    if (d.other.length + fresh.length > 5000) return { added: 0, read: r.entries.length, left: r.left, error: "The list holds 5,000 entries; remove some first.", kind: r.kind };
    // each day's net settlement for trades: what the reconciliation compares the journal's day with
    const days = Object.keys(r.settle || {});
    let changed = fresh.length > 0;
    for (const day of days) {
      const have1 = d.ledgerDays[day];
      if (!have1 || have1.settle !== r.settle[day]) changed = true;
      d.ledgerDays[day] = { settle: r.settle[day], file: String(name).slice(0, 100), at: new Date(now).toISOString() };
    }
    if (fresh.length) d.other = [...d.other, ...fresh];
    if (changed) this._save(d);
    return { added: fresh.length, read: r.entries.length, left: r.left, rows: r.rows, settledDays: days.length, error: "", kind: r.kind };
  }

  /**
   * Zerodha's ledger against the journal, day by day (24 Nov 2026). The ledger's net settlement of a day is what the day's
   * trades came to in the account — profit or loss after every charge — so for a day of intraday equity trades it should equal
   * the journal's day (realised P&L − estimated charges). The charges are an estimate, so a few rupees can differ; the ledger
   * is Zerodha's own figure, so a small difference is corrected (the day's charges are set so the net is the ledger's), and a
   * large one is left for a look (a trade missing from or extra in the journal).
   *   match        within ₹1
   *   corrected    a correction is in place and the day now equals the ledger
   *   off          differs by ₹1–50: can be corrected
   *   check        differs by more than ₹50, or the ledger has a day the journal has no trades for
   *   later        trades the ledger does not hold yet (after its last day)
   *   skip         not comparable: delivery, futures & options or an open position (their settlement is not the day's P&L)
   * @returns { days: [{ date, ledger, app, appNow, diff, fix, status, trades }], counts, from, to, file }
   */
  reconcile({ fromDay = "", toDay = "" } = {}) {
    const d = this._load();
    const ledger = d.ledgerDays;
    const keys = Object.keys(ledger).sort();
    if (!keys.length) return { days: [], counts: {}, from: null, to: null, file: null };
    const lo = fromDay && fromDay > keys[0] ? fromDay : keys[0];
    const hi = toDay && toDay < keys[keys.length - 1] ? toDay : keys[keys.length - 1];
    const byDay = new Map();
    for (const t of this._baseTrips()) {
      const k = t.open ? null : istDay(t.exitAt);
      if (!k) continue;
      const g = byDay.get(k) || { pnl: 0, est: 0, now: 0, n: 0, plain: true };
      g.pnl += t.pnl;
      g.est += t.chargesEst;
      g.now += t.charges;
      g.n += 1;
      if (!t.intraday || !["NSE", "BSE"].includes(t.exchange)) g.plain = false;
      byDay.set(k, g);
    }
    const openDays = new Set(this._baseTrips().filter((t) => t.open).map((t) => istDay(t.entryAt)));
    const all = [...new Set([...keys, ...[...byDay.keys()]])].filter((k) => k >= lo && k <= keys[keys.length - 1] && (!hi || k <= hi)).sort();
    const rows = all.map((date) => {
      const L = ledger[date] ? ledger[date].settle : null;
      const g = byDay.get(date) || null;
      const app = g ? r2(g.pnl - g.est) : null;
      const appNow = g ? r2(g.pnl - g.now) : null;
      const fix = d.chargeFix[date] ? d.chargeFix[date].amount : 0;
      let status;
      let diff = null;
      if (L === null || L === undefined) status = "later";
      else if (!g) status = Math.abs(L) > 1 ? "check" : "match";
      else if (!g.plain || openDays.has(date)) status = "skip";
      else {
        diff = r2(L - app);
        if (fix && Math.abs(appNow - L) <= 1) status = "corrected";
        else if (Math.abs(diff) <= 1) status = "match";
        else if (Math.abs(diff) <= 50) status = "off";
        else status = "check";
      }
      return { date, ledger: L === undefined ? null : L, app, appNow, diff, fix: r2(fix), status, trades: g ? g.n : 0, note: ledger[date] ? undefined : "not in the ledger" };
    });
    const counts = {};
    for (const x of rows) counts[x.status] = (counts[x.status] || 0) + 1;
    const last = keys.map((k) => ledger[k]).sort((a, b) => (a.at < b.at ? 1 : -1))[0];
    return { days: rows, counts, from: keys[0], to: keys[keys.length - 1], file: last ? last.file : null, at: last ? last.at : null };
  }

  /**
   * Make the days that differ a little match the ledger: the day's charges are set so its net is the ledger's. Without `days`,
   * every day that is "off" (and every corrected day whose trades changed since). A day that already matches loses its correction.
   * @returns { corrected: [dates], reconcile }
   */
  applyMatch({ days = null } = {}, now = Date.now()) {
    const want = Array.isArray(days) ? new Set(days.map(String)) : null;
    const rec = this.reconcile();
    const d = this._load();
    const corrected = [];
    for (const x of rec.days) {
      if (want && !want.has(x.date)) continue;
      if (x.status === "off" || (x.status === "corrected" && x.diff !== null && Math.abs(x.diff + x.fix) > 0.5)) {
        d.chargeFix[x.date] = { amount: r2(-x.diff), ledger: x.ledger, estimate: x.app, at: new Date(now).toISOString() };
        corrected.push(x.date);
      } else if (x.status === "match" && d.chargeFix[x.date]) {
        delete d.chargeFix[x.date];
        corrected.push(x.date);
      }
    }
    if (corrected.length) this._save(d);
    return { corrected, reconcile: this.reconcile() };
  }

  /* ------------------------------------------------------------------ Console's P&L statement */

  /** A Console P&L statement (.xlsx bytes) → kept as the reference for its period; its other debits and credits are read too. */
  importPnl(buf, { name = "" } = {}, now = Date.now()) {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf || ""), "utf8");
    let sheets;
    try {
      sheets = b.length >= 4 && b.readUInt32LE(0) === 0x04034b50 ? readXlsx(b) : [{ name: "csv", rows: csvRows(b.toString("utf8")) }];
    } catch (err) {
      return { error: err.message };
    }
    const p = O.fromPnlSheets(sheets);
    if (p.error) return { error: p.error };
    const d = this._load();
    const key = `${p.from}_${p.to}`;
    d.pnlRefs[key] = { key, from: p.from, to: p.to, file: String(name).slice(0, 100), at: new Date(now).toISOString(), summary: p.summary, heads: p.heads, headList: p.headList, symbols: p.symbols };
    const keys = Object.keys(d.pnlRefs).sort();
    if (keys.length > 24) for (const k of keys.slice(0, keys.length - 24)) delete d.pnlRefs[k];
    // the statement's own sheet of other debits and credits: the same entries the ledger holds (the same key, so never twice)
    const have = new Set(d.other.map((e) => e.key).filter(Boolean));
    let added = 0;
    for (const e of O.numbered(p.others.entries)) {
      if (have.has(e.key)) continue;
      have.add(e.key);
      d.other.push({ id: crypto.randomBytes(5).toString("hex"), date: e.date, amount: e.amount, kind: e.kind, note: e.note, key: e.key, source: "console", file: String(name).slice(0, 100), at: new Date(now).toISOString() });
      added += 1;
    }
    this._save(d);
    return { key, from: p.from, to: p.to, added, summary: p.summary, symbols: p.symbols.length };
  }

  /** The closed equity trades of a period: what the statement of that period is about (futures and options have their own statement). */
  _pnlTrips(from, to) {
    return this._baseTrips().filter((t) => !t.open && ["NSE", "BSE"].includes(t.exchange) && istDay(t.exitAt) >= from && istDay(t.exitAt) <= to);
  }

  /**
   * The statements kept, each against the journal for its own period: realised P&L, charges (and every head), other credits &
   * debits, net, and each symbol's realised P&L — Console's figure, the journal's, the difference.
   */
  pnlCompare() {
    const d = this._load();
    const dp = this._dpByDay();
    return Object.values(d.pnlRefs)
      .sort((a, b) => (a.to < b.to ? 1 : -1))
      .map((ref) => {
        const trips = this._pnlTrips(ref.from, ref.to);
        const sum = (f) => r2(trips.reduce((a, t) => a + f(t), 0));
        const app = { realised: sum((t) => t.pnl), charges: sum((t) => t.charges), est: sum((t) => t.chargesEst) };
        const oth = O.totals(O.counted(d.other, { fromDay: ref.from, toDay: ref.to }, dp));
        const row = (label, theirs, mine, tol) => ({ label, console: theirs, app: mine, diff: r2(mine - theirs), ok: Math.abs(mine - theirs) <= tol });
        const heads = ["brokerage", "stt", "exchange", "gst", "sebi", "stamp", "dp", "other"]
          .map((h) => {
            const mine = r2(trips.reduce((a, t) => a + ((t.parts && t.parts[h]) || 0), 0));
            const est = r2(trips.reduce((a, t) => a + ((t.partsEst && t.partsEst[h]) || 0), 0));
            const c = ref.heads[h] || 0;
            return { head: h, console: r2(c), app: mine, est, diff: r2(mine - c), ok: Math.abs(mine - c) <= 0.5 };
          })
          .filter((h) => h.console || h.app || h.est);
        const mine = new Map();
        for (const t of trips) mine.set(t.symbol, r2((mine.get(t.symbol) || 0) + t.pnl));
        const names = new Set([...mine.keys(), ...ref.symbols.map((x) => x.symbol)]);
        const symbols = [...names].sort().map((s) => {
          const c = (ref.symbols.find((x) => x.symbol === s) || {}).pnl;
          const m = mine.has(s) ? mine.get(s) : null;
          return { symbol: s, console: c === undefined ? null : c, app: m, diff: c === undefined || m === null ? null : r2(m - c), ok: c !== undefined && m !== null && Math.abs(m - c) <= 1 };
        });
        const cNet = r2(ref.summary.realised - ref.summary.charges + (ref.summary.other || 0));
        const aNet = r2(app.realised - app.charges + oth.total);
        const corrected = Object.values(d.chargeFix).filter((f) => f.source === "pnl" && f.ref === ref.key).length;
        const rows = [row("Realised P&L", ref.summary.realised, app.realised, 1), row("Charges & taxes", ref.summary.charges, app.charges, 0.5), row("Other credits & debits", ref.summary.other || 0, oth.total, 0.5), row("Net realised P&L", cNet, aNet, 1)];
        return { key: ref.key, from: ref.from, to: ref.to, file: ref.file, at: ref.at, rows, heads, symbols, trades: trips.length, corrected, ok: rows.every((x) => x.ok) && heads.every((h) => h.ok) && symbols.every((s) => s.ok) };
      });
  }

  /**
   * Make a period's charges Console's, head by head: what the statement says for each head less what the estimate says, spread
   * over the days that closed trades (in proportion to their estimated charges), kept as a correction of those days. A day the
   * ledger has settled is set to the ledger afterwards if it still differs by more than ₹1.
   */
  applyPnlMatch(key, now = Date.now()) {
    const d = this._load();
    const ref = d.pnlRefs[key];
    if (!ref) return { error: "That statement is not kept any more." };
    const trips = this._pnlTrips(ref.from, ref.to);
    if (!trips.length) return { error: "The journal has no closed equity trades in that period, so there is nothing to correct." };
    const heads = {};
    for (const h of ["brokerage", "stt", "exchange", "gst", "sebi", "stamp", "dp", "other"]) {
      const est = trips.reduce((a, t) => a + ((t.partsEst && t.partsEst[h]) || 0), 0);
      const c = ref.heads[h] || 0;
      if (Math.abs(c - est) >= 0.005) heads[h] = r2(c - est);
    }
    const w = new Map();
    for (const t of trips) w.set(istDay(t.exitAt), (w.get(istDay(t.exitAt)) || 0) + t.chargesEst);
    const days = [...w.keys()].sort();
    const total = [...w.values()].reduce((a, v) => a + v, 0);
    const left = { ...heads };
    days.forEach((day, i) => {
      const last = i === days.length - 1;
      const parts = {};
      for (const h of Object.keys(heads)) {
        const v = last ? left[h] : r2(heads[h] * (total > 0 ? w.get(day) / total : 1 / days.length));
        left[h] = r2(left[h] - v);
        if (v) parts[h] = v;
      }
      const amount = r2(Object.values(parts).reduce((a, v) => a + v, 0));
      if (amount) d.chargeFix[day] = { amount, parts, source: "pnl", ref: key, at: new Date(now).toISOString() };
      else delete d.chargeFix[day];
    });
    this._save(d);
    const m = this.applyMatch({}, now);
    return { days, ledger: m.corrected, compare: this.pnlCompare() };
  }

  /** Take a statement's correction back (the days it corrected have the estimate again). */
  removePnlMatch(key) {
    const d = this._load();
    const gone = Object.keys(d.chargeFix).filter((day) => d.chargeFix[day].ref === key);
    if (!gone.length) return { error: "That statement has no correction in place." };
    for (const day of gone) delete d.chargeFix[day];
    this._save(d);
    return { days: gone, compare: this.pnlCompare() };
  }

  /** Take a day's correction back: its charges are the estimate again. */
  removeMatch(day) {
    const d = this._load();
    if (!d.chargeFix[day]) return { error: "That day has no correction." };
    delete d.chargeFix[day];
    this._save(d);
    return { reconcile: this.reconcile() };
  }

  /**
   * The returns on the principal for a period (or all trades when none): by month, by day, the risk ratios.
   * @param filters the journal's filters (period, from, to, symbol, side, kind, setup)
   */
  returns(filters = {}, now = Date.now()) {
    const closed = this.trips(filters).filter((t) => !t.open);
    const first = this.firstAt();
    const fromDay = (filters.period && filters.period.fromDay) || (filters.from ? istDay(filters.from) : first ? istDay(first) : istDay(now));
    const toDay = (filters.period && filters.period.toDay) || (filters.to ? istDay(Math.min(filters.to, now)) : istDay(now));
    return R.compute({ trips: closed, entries: this._load().capital, fromDay, toDay });
  }

  ingestKite(trades) {
    return this.add(trades.map(fromKite).filter(Boolean), "kite");
  }

  importCsv(text) {
    return this.importFile(Buffer.from(String(text || ""), "utf8"), { name: "tradebook.csv" });
  }

  /** A tradebook file (.xlsx or .csv bytes) → the journal. @returns { added, read, skipped, error, kind, segments, fromDay, toDay } */
  importFile(buf, { name = "", file = "" } = {}) {
    const r = readTradebook(buf, { file });
    if (r.error && !r.fills.length) return { added: 0, read: 0, skipped: r.skipped, error: r.error, kind: r.kind };
    const added = this.add(r.fills, "console", { name: String(name).slice(0, 120), kind: r.kind, file, segments: r.segments, skipped: r.skipped, sheet: r.sheet || undefined });
    return { added, read: r.fills.length, skipped: r.skipped, error: "", kind: r.kind, segments: r.segments, fromDay: r.fromDay, toDay: r.toDay, sheet: r.sheet || null };
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

  /** The round trips with their charges, worked out again only after a change. */
  _baseTrips() {
    const list = this._fillsList();
    if (this._memo && this._memo.ver === this._ver && this._memo.n === list.length) return this._memo.trips;
    // only Zerodha's own fills (Kite and Console imports); hand-typed ones of an earlier version are not counted
    const trips = roundTrips(list.filter((f) => f.source !== "manual")).map((t) => {
      const c = t.open ? 0 : charges(t);
      const parts = t.open ? null : chargeParts(t);
      // each charge on its own (brokerage, STT, exchange, SEBI, GST, stamp duty, DP), for the charges breakdown
      return { ...t, charges: c, chargesEst: c, partsEst: parts, brokerage: t.open ? 0 : r2(parts.brokerage), parts: parts ? Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, r2(v)])) : null, net: r2(t.pnl - c) };
    });
    applyChargeFix(trips, this._load().chargeFix);
    this._memo = { ver: this._ver, n: list.length, trips };
    return trips;
  }

  /** Round trips with charges, tags and excursions attached, filtered. */
  trips({ from = null, to = null, symbol = "", side = "", kind = "", setup = "" } = {}) {
    const d = this._load();
    return this._baseTrips()
      .map((t) => ({ ...t, tags: d.tags[t.key] || null, exc: d.excursions[t.key] || null }))
      // a closed trade counts on the day it was closed (as in Zerodha's P&L); an open one by its entry
      .filter((t) => {
        const at = t.open ? t.entryAt : t.exitAt;
        return (!from || at >= from) && (!to || at <= to);
      })
      .filter((t) => (!symbol || t.symbol === symbol) && (!side || t.side === side) && (!kind || (kind === "intraday" ? t.intraday : !t.intraday)) && (!setup || (t.tags && t.tags.setup === setup)));
  }

  /** The first trade on record (ms), from Zerodha's fills only, or null. */
  firstAt() {
    const at = this._fillsList().reduce((a, f) => (f.source === "manual" ? a : Math.min(a, f.at)), Infinity);
    return Number.isFinite(at) ? at : null;
  }

  /* ------------------------------------------------------------- days entered by hand (23 Nov 2026) */
  /**
   * A day the owner enters by hand: a session that has no Zerodha record here (another broker, a day before the tradebooks).
   * Its figures are the owner's: gross P&L and each charge. A day that has Zerodha's own trades can never be entered or changed
   * by hand — those figures come from Zerodha alone. Kept apart from the fills; counted only where the page says so.
   */
  manualDays({ fromDay = "", toDay = "" } = {}) {
    const d = this._load();
    return Object.values(d.manualDays || {})
      .filter((m) => (!fromDay || m.date >= fromDay) && (!toDay || m.date <= toDay))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  /** Does Zerodha's own record have a trade on this IST day? (Then the day is not open to hand entry.) */
  zerodhaDay(date) {
    return this._fillsList().some((f) => f.source !== "manual" && istDay(f.at) === date);
  }
  setManualDay(date, input = {}, by = "", now = Date.now()) {
    const day = String(date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) throw Object.assign(new Error("Give the day as YYYY-MM-DD."), { status: 400 });
    if (day > istDay(now)) throw Object.assign(new Error("A day in the future cannot be entered."), { status: 400 });
    if (this.zerodhaDay(day)) throw Object.assign(new Error("This day has trades from Zerodha: its figures come from Zerodha alone and cannot be entered or changed by hand."), { status: 409, code: "zerodha_day" });
    const n = (k, { min = -1e10, max = 1e10 } = {}) => {
      const v = input[k] === "" || input[k] === undefined || input[k] === null ? 0 : Number(input[k]);
      if (!Number.isFinite(v) || v < min || v > max) throw Object.assign(new Error(`"${k}" must be a number${min === 0 ? " of 0 or more" : ""}.`), { status: 400 });
      return Math.round(v * 100) / 100;
    };
    const parts = { brokerage: n("brokerage", { min: 0 }), stt: n("stt", { min: 0 }), exchange: n("exchange", { min: 0 }), sebi: n("sebi", { min: 0 }), gst: n("gst", { min: 0 }), stamp: n("stamp", { min: 0 }), dp: n("dp", { min: 0 }), other: n("other", { min: 0 }) };
    const gross = n("gross");
    const trades = Math.round(n("trades", { min: 0, max: 100000 }));
    const charges = r2(Object.values(parts).reduce((a, b) => a + b, 0));
    const d = this._load();
    const old = d.manualDays[day] || null;
    const rec = { date: day, gross, parts, charges, net: r2(gross - charges), trades, note: String(input.note || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 300), source: "manual", by: String(by || "").slice(0, 120), createdAt: old ? old.createdAt : new Date(now).toISOString(), updatedAt: old ? new Date(now).toISOString() : null };
    d.manualDays = { ...d.manualDays, [day]: rec };
    this._save(d);
    return rec;
  }
  removeManualDay(date) {
    const d = this._load();
    if (!d.manualDays[String(date)]) return false;
    const next = { ...d.manualDays };
    delete next[String(date)];
    d.manualDays = next;
    this._save(d);
    return true;
  }

  /**
   * Day by day, for the P&L grid (Zerodha Console's green/red day grid, 23 Nov 2026): every IST day in the range that has
   * closed trades (each on the day it was closed, as in Zerodha's P&L), with its figures and its trades — so a click on a
   * day opens its table with no second request. Days entered by hand in the range come apart, marked as such.
   * @param fromDay, toDay  "YYYY-MM-DD" (IST), both included
   * @returns { fromDay, toDay, days: [{ date, trades, wins, gross, charges, brokerage, taxes, net, trips: [...] }], manual, totals }
   */
  days({ fromDay, toDay, side = "", kind = "", setup = "", symbol = "" } = {}) {
    const from = Date.parse(`${fromDay}T00:00:00+05:30`);
    const to = Date.parse(`${toDay}T23:59:59.999+05:30`);
    const closed = this.trips({ from, to, side, kind, setup, symbol }).filter((t) => !t.open);
    const by = new Map();
    for (const t of closed) {
      const k = istDay(t.exitAt);
      const g = by.get(k) || { date: k, trades: 0, wins: 0, gross: 0, charges: 0, brokerage: 0, net: 0, trips: [] };
      g.trades += 1;
      if (t.net > 0) g.wins += 1;
      g.gross += num(t.pnl) ? t.pnl : 0;
      g.charges += num(t.charges) ? t.charges : 0;
      g.brokerage += num(t.brokerage) ? t.brokerage : 0;
      g.net += num(t.net) ? t.net : 0;
      g.trips.push({
        key: t.key,
        symbol: t.symbol,
        exchange: t.exchange,
        side: t.side,
        product: t.product,
        intraday: Boolean(t.intraday),
        qty: t.maxQty || t.qty || 0,
        entryAt: t.entryAt,
        exitAt: t.exitAt,
        entryAvg: t.entryAvg,
        exitAvg: t.exitAvg,
        buyValue: num(t.turnoverBuy) ? r2(t.turnoverBuy) : null,
        sellValue: num(t.turnoverSell) ? r2(t.turnoverSell) : null,
        holdMin: t.holdMin,
        gross: r2(t.pnl || 0),
        charges: r2(t.charges || 0),
        net: r2(t.net || 0),
        setup: (t.tags && t.tags.setup) || "",
      });
      by.set(k, g);
    }
    const days = [...by.values()]
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((g) => ({ ...g, gross: r2(g.gross), charges: r2(g.charges), brokerage: r2(g.brokerage), taxes: r2(g.charges - g.brokerage), net: r2(g.net), trips: g.trips.sort((a, b) => a.exitAt - b.exitAt) }));
    const manual = this.manualDays({ fromDay, toDay }).map((m) => ({ date: m.date, trades: m.trades, gross: m.gross, charges: m.charges, net: m.net, note: m.note, manual: true }));
    const sum = (f) => r2(days.reduce((a, g) => a + g[f], 0));
    return {
      fromDay,
      toDay,
      days,
      manual,
      totals: { days: days.length, green: days.filter((g) => g.gross > 0).length, red: days.filter((g) => g.gross < 0).length, trades: days.reduce((a, g) => a + g.trades, 0), gross: sum("gross"), charges: sum("charges"), net: sum("net") },
    };
  }

  view(filters = {}) {
    const d = this._load();
    const trips = this.trips(filters);
    const setups = [...new Set(Object.values(d.tags).map((t) => t.setup).filter(Boolean))].sort();
    const all = this._fillsList();
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
      // the charges of the period's closed trades, one by one (Zerodha's published rates — an estimate; the contract note is the truth)
      chargeParts: (() => {
        const sum = { brokerage: 0, stt: 0, exchange: 0, sebi: 0, gst: 0, stamp: 0, dp: 0, other: 0 };
        for (const t of trips) if (!t.open && t.parts) for (const k of Object.keys(sum)) sum[k] += t.parts[k] || 0;
        // "other" (a correction that makes a day match the ledger) is there only when there is one
        return Object.fromEntries(Object.entries(sum).filter(([k, v]) => k !== "other" || v !== 0).map(([k, v]) => [k, r2(v)]));
      })(),
      // days entered by hand in the period (never a day Zerodha has trades for)
      manualDays: this.manualDays(filters.period ? { fromDay: filters.period.fromDay || "", toDay: filters.period.toDay || "" } : {}),
      // other credits & debits in the period (DP charges billed separately, AMC, interest, dividends…): part of Net realised P&L, as in Console
      other: this.others(filters.period ? { fromDay: filters.period.fromDay || "", toDay: filters.period.toDay || "" } : {}),
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
    const entries = d.capital || [];
    const row = (id) => {
      const p = periodRange(id, now, { firstAt });
      if (!p) return null;
      const inside = closed.filter((t) => (!p.from || t.exitAt >= p.from) && t.exitAt <= p.to);
      const rp = R.periodPct(inside, entries, p.fromDay || (firstAt ? istDay(firstAt) : today), p.toDay);
      return { ...p, ...summarize(inside), pct: rp.pct, base: rp.base };
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
        kite: this._fillsList().filter((f) => f.source === "kite").length,
        console: this._fillsList().filter((f) => f.source === "console").length,
        segments: [...new Set(this._fillsList().map((f) => f.exchange))].sort(),
        store: this._itemMode() ? (this.docs.kind === "mongodb" ? "MongoDB (collection journal_fills)" : "files (collections/journal_fills.json)") : "the journal record",
        imports: d.imports.slice(0, 20),
        capturedDays: capturedDays.length,
        lastCaptured: capturedDays.length ? { day: capturedDays[capturedDays.length - 1], ...d.captured[capturedDays[capturedDays.length - 1]] } : null,
      },
      gaps: gaps.sort((a, b) => b.weekdays - a.weekdays).slice(0, 12).sort((a, b) => (a.fromDay < b.fromDay ? 1 : -1)),
      // every month since the first trade, for the heatmap (financial year × month)
      capital: R.ledger(entries).length,
      months: byMonth(closed).map((x) => ({ month: x.month, fy: fyOf(`${x.month}-01`), pct: (R.compute({ trips: closed.filter((t) => istDay(t.exitAt).startsWith(x.month)), entries, fromDay: `${x.month}-01`, toDay: monthEnd(x.month) }).months[0] || {}).pct ?? null, net: x.net, gross: x.gross, charges: x.charges, trades: x.trades, winRate: x.winRate, profitFactor: x.profitFactor })),
      views: d.views,
    };
  }

  /** The period just before one of the same length (for "compared with before"), or null. */
  _prevOf(filters) {
    if (!filters.from || !filters.to) return null;
    const len = filters.to - filters.from;
    const from = filters.from - len - 1;
    const to = filters.from - 1;
    const closed = this.trips({ ...filters, from, to }).filter((t) => !t.open);
    return { ...summarize(closed), fromDay: istDay(from), toDay: istDay(to) };
  }

  /**
   * The deeper figures of one period: its summary, month by month, best and worst month, day by day,
   * the running total and its falls, costs by kind, holding time, the spread of results, the rolling
   * win rate, the kinds of trade, the health score, and the period before for comparison.
   */
  analytics(filters = {}) {
    const closed = this.trips(filters).filter((t) => !t.open);
    const months = byMonth(closed);
    const best = months.reduce((a, x) => (!a || x.net > a.net ? x : a), null);
    const worst = months.reduce((a, x) => (!a || x.net < a.net ? x : a), null);
    const summary = summarize(closed);
    return {
      summary,
      months,
      bestMonth: best && best.net > 0 ? { month: best.month, net: best.net } : null,
      worstMonth: worst && worst.net < 0 ? { month: worst.month, net: worst.net } : null,
      ...retro.deeper(closed, { chargeParts }),
      health: retro.health(summary),
      prev: this._prevOf(filters),
    };
  }

  /* -------------------------------------------------------------- the retrospective */

  /** What went well, what went wrong, what to keep, stop and try — for one period, saved in the database. */
  retrospective(filters = {}, now = Date.now()) {
    const closed = this.trips(filters).filter((t) => !t.open);
    const summary = summarize(closed);
    const period = filters.period || { id: "all", label: "All time", fromDay: closed.length ? istDay(Math.min(...closed.map((t) => t.exitAt))) : null, toDay: istDay(now) };
    const r = retro.retrospective({ trips: closed, summary, prev: this._prevOf(filters), period });
    const rec = { id: crypto.randomBytes(6).toString("hex"), at: new Date(now).toISOString(), filters: { kind: filters.kind || "", side: filters.side || "", setup: filters.setup || "", symbol: filters.symbol || "" }, ...r };
    const d = this._load();
    d.retros = [rec, ...(d.retros || [])].slice(0, 30);
    this._save(d);
    return rec;
  }

  /** Earlier retrospectives (newest first), light for a list. */
  retros() {
    return this._load().retros.map((r) => ({ id: r.id, at: r.at, period: r.period, verdict: r.verdict, headline: r.headline, score: r.score, net: r.summary ? r.summary.net : null, filters: r.filters }));
  }

  retro(id) {
    return this._load().retros.find((r) => r.id === String(id)) || null;
  }

  removeRetro(id) {
    const d = this._load();
    const before = d.retros.length;
    d.retros = d.retros.filter((r) => r.id !== String(id));
    if (d.retros.length !== before) this._save(d);
    return this.retros();
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

module.exports = { TradeJournal, detectKind, applyChargeFix, roundTrips, charges, chargeParts, stats, summarize, byMonth, excursion, fromConsoleCsv, fromRows, readTradebook, parseWhen, exchangeOf, fromKite, parseTime, csvRows, periodRange, fyOf, fyLabel, istDay, MISTAKES, NAME, FILLS, MAX_FILLS };
