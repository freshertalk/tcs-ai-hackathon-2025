"use strict";
// The derivatives expiry calendar: every weekly and monthly expiry on NSE and BSE, from the exchanges' own contract lists.
//
//   LISTED      The exchanges publish every tradable contract with its expiry date; Zerodha republishes that list as a
//               public file (api.kite.trade/instruments/NFO and …/BFO — no login, no key). A date read from it is the
//               exchange's own: it already carries every holiday shift (the November 2026 monthly is Monday the 23rd
//               because Tuesday the 24th is a holiday) and every change of rule.
//   SCHEDULED   The exchange lists weekly contracts only about five weeks ahead and monthly ones three months ahead, so
//               the rest of the year is worked out by the exchange's rule — and THE RULE ITSELF IS READ FROM THE LIST:
//               the weekday the listed weekly contracts fall on (Tuesday on NSE, Thursday on BSE since September 2025),
//               the monthly being the last such weekday of the month, moved back to the previous trading day when that
//               day is a holiday. If the exchange changes the day, the listed contracts change and so does every date here.
//   A scheduled date is replaced by the listed one the day its contract appears; when the two differ, the row says so and
//   the service keeps the change (server/expiry.js).
//
// Pure arithmetic: nothing here reads the network, the clock or a file. No AI is involved anywhere.

const DAY = 86400000;
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const utc = (d) => Date.parse(`${d}T00:00:00Z`);
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const dowOf = (d) => new Date(utc(d)).getUTCDay();
const monthOf = (d) => String(d).slice(0, 7);

/** The index contracts of each exchange, with the name a person knows them by. Anything else in the list is a stock. */
const INDEX = {
  NSE: { NIFTY: "NIFTY 50", BANKNIFTY: "NIFTY Bank", FINNIFTY: "NIFTY Financial Services", MIDCPNIFTY: "NIFTY Midcap Select", NIFTYNXT50: "NIFTY Next 50" },
  BSE: { SENSEX: "SENSEX", BANKEX: "BANKEX", SENSEX50: "SENSEX 50", FOCIT: "FOCIT" },
};
/** What is assumed until the list has been read: the main index, and the weekday in force since 1 September 2025. */
const DEFAULTS = { NSE: { main: "NIFTY", dow: 2, file: "NFO" }, BSE: { main: "SENSEX", dow: 4, file: "BFO" } };
const EXCHANGES = Object.keys(DEFAULTS);

/** One line of a CSV file into its fields (quotes may hold commas). */
function splitCsv(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * The exchange's contract file into what matters here: for each underlying, the dates its options expire on and the
 * dates its futures do. @returns { NAME: { o: [dates, oldest first], f: [dates] } } — or null when the file is not the
 * list it should be (a page of text, an error, a truncated download)
 */
function parseList(csv) {
  const lines = String(csv || "").split(/\r?\n/);
  const head = splitCsv(lines[0] || "");
  const c = { name: head.indexOf("name"), expiry: head.indexOf("expiry"), type: head.indexOf("instrument_type") };
  if (c.name < 0 || c.expiry < 0 || c.type < 0) return null;
  const by = new Map();
  for (let i = 1; i < lines.length; i += 1) {
    if (!lines[i]) continue;
    const r = splitCsv(lines[i]);
    const type = r[c.type];
    const date = String(r[c.expiry] || "").slice(0, 10);
    const name = String(r[c.name] || "").trim();
    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date) || (type !== "CE" && type !== "PE" && type !== "FUT")) continue;
    const k = by.get(name) || by.set(name, { o: new Set(), f: new Set() }).get(name);
    (type === "FUT" ? k.f : k.o).add(date);
  }
  if (by.size < 2) return null;
  const out = {};
  for (const [name, k] of by) out[name] = { o: [...k.o].sort(), f: [...k.f].sort() };
  return out;
}

/** An underlying's monthly expiries: its futures' dates, and the last option date of each month (the far months have no future yet). */
function monthlyOf(u) {
  const last = new Map();
  for (const d of u.o) if (!last.has(monthOf(d)) || d > last.get(monthOf(d))) last.set(monthOf(d), d);
  for (const d of u.f) last.set(monthOf(d), d); // where a future is listed, its date is the month's
  return [...last.values()].sort();
}
const mode = (xs) => {
  const n = new Map();
  for (const x of xs) n.set(x, (n.get(x) || 0) + 1);
  let best = null;
  for (const [x, k] of n) if (best === null || k > n.get(best)) best = x;
  return best;
};

/**
 * What the exchange lists, read for the calendar.
 * @returns { main, dow (the weekday expiries fall on, read from the list), fromList (was it?), weekly: [dates of the
 *            weekly series], monthly: { "YYYY-MM": { date, indices: [labels], stocks } }, others: [{ date, what }] }
 */
function readList(parsed, exchange) {
  const def = DEFAULTS[exchange];
  const names = INDEX[exchange];
  const main = parsed && parsed[def.main] ? parsed[def.main] : null;
  if (!main) return { main: def.main, dow: def.dow, fromList: false, weekly: [], monthly: {}, others: [] };
  const mMain = new Set(monthlyOf(main));
  const weekly = main.o.filter((d) => !mMain.has(d));
  // the weekday: what most of the listed weekly contracts fall on (a holiday moves one or two, never most)
  const dow = weekly.length >= 2 ? mode(weekly.map(dowOf)) : mMain.size >= 2 ? mode([...mMain].map(dowOf)) : def.dow;
  const monthly = {};
  const others = [];
  for (const d of mMain) monthly[monthOf(d)] = { date: d, indices: [], stocks: 0 };
  for (const [name, u] of Object.entries(parsed)) {
    for (const d of monthlyOf(u)) {
      const m = monthly[monthOf(d)];
      if (m && m.date === d) {
        if (names[name]) m.indices.push(names[name]);
        else m.stocks += 1;
      } else if (names[name]) others.push({ date: d, what: `${names[name]} monthly` }); // an index that expires on its own day
    }
  }
  for (const m of Object.values(monthly)) m.indices.sort((a, b) => Object.values(names).indexOf(a) - Object.values(names).indexOf(b));
  return { main: def.main, dow, fromList: true, weekly, monthly, others };
}

/** The last trading day on or before a date (a holiday or a weekend moves an expiry back, never forward). */
function tradingOnOrBefore(date, cal) {
  let ms = utc(date);
  for (let i = 0; i < 10 && !cal.isTradingDay(iso(ms)); i += 1) ms -= DAY;
  return iso(ms);
}
const whatOf = (indices, stocks) => {
  const all = indices.slice();
  if (stocks > 0) all.push(`${stocks} stock${stocks === 1 ? "" : "s"}`);
  return all.length > 1 ? `${all.slice(0, -1).join(", ")} and ${all[all.length - 1]}` : all[0] || "";
};

/**
 * One exchange's expiries from `from` to `until`, one row per week: the listed date where the exchange lists the
 * contract, the rule's date otherwise.
 * @param cal    { isTradingDay(date), holidayName(date), known(date) } — the trading-holiday calendar
 * @param seen   { nominal date: the date once read from the list } — kept by the service, so a passed week keeps its real date
 * @returns [{ exchange, date, day, kind: "weekly"|"monthly", what, indices, stocks, status: "listed"|"scheduled"|"passed",
 *             nominal (the weekday's own date), moved, why, uncertain, past }]
 */
function build({ exchange, parsed = null, today, from, until, cal, seen = {} }) {
  const L = readList(parsed, exchange);
  const names = INDEX[exchange];
  const label = names[L.main] || L.main;
  // which week does a listed date belong to? the first expiry weekday on or after it (the exchange moves a date back, not forward)
  const slotOf = (d) => iso(utc(d) + ((7 - dowOf(d) + L.dow) % 7) * DAY);
  const listed = new Map();
  for (const d of L.weekly) listed.set(slotOf(d), d);
  for (const m of Object.values(L.monthly)) listed.set(slotOf(m.date), m.date);
  // who expires with the monthly when the month's own list is not out yet: as in the nearest listed month
  const nearest = Object.keys(L.monthly).sort()[0];
  const usual = nearest ? L.monthly[nearest] : { indices: Object.values(names), stocks: 0 };
  const rows = [];
  let ms = utc(from) + ((7 - dowOf(from) + L.dow) % 7) * DAY;
  for (; ms <= utc(until) + 6 * DAY; ms += 7 * DAY) {
    const nominal = iso(ms);
    const isMonthly = monthOf(iso(ms + 7 * DAY)) !== monthOf(nominal); // the last such weekday of its month
    const expected = tradingOnOrBefore(nominal, cal);
    const real = listed.get(nominal) || seen[nominal] || "";
    const date = real || expected;
    if (date < from || date > until) continue;
    const m = isMonthly ? L.monthly[monthOf(nominal)] || L.monthly[monthOf(date)] || null : null;
    const who = isMonthly ? m || usual : null;
    const moved = date !== nominal;
    const holiday = cal.holidayName(nominal);
    rows.push({
      exchange,
      date,
      day: DOW[dowOf(date)],
      kind: isMonthly ? "monthly" : "weekly",
      what: isMonthly ? `Monthly: ${whatOf(who.indices, who.stocks)}` : `${label} weekly`,
      indices: isMonthly ? who.indices : [label],
      stocks: isMonthly ? who.stocks : 0,
      status: listed.has(nominal) ? "listed" : date < today ? "passed" : "scheduled",
      nominal,
      moved,
      why: !moved ? "" : holiday ? `${DOW[dowOf(nominal)]} ${nominal} is a market holiday (${holiday}), so it expires on the trading day before` : listed.has(nominal) ? `the exchange lists this contract for ${DOW[dowOf(date)]}, not the usual ${DOW[L.dow]}` : `${DOW[dowOf(nominal)]} ${nominal} is not a trading day`,
      // a date worked out for a year whose holiday list the desk does not hold yet may move by a day
      uncertain: !listed.has(nominal) && !seen[nominal] && !cal.known(nominal),
      past: date < today,
    });
  }
  // an index contract that expires on a day of its own (none does today; if one is ever listed, it is not lost)
  for (const o of L.others) if (o.date >= from && o.date <= until && !rows.some((r) => r.date === o.date)) rows.push({ exchange, date: o.date, day: DOW[dowOf(o.date)], kind: "monthly", what: o.what, indices: [o.what.replace(/ monthly$/, "")], stocks: 0, status: "listed", nominal: o.date, moved: false, why: "", uncertain: false, past: o.date < today });
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { exchange, main: label, weekday: DOW[L.dow], dow: L.dow, fromList: L.fromList, rows, listedTo: [...listed.values()].sort().filter((d) => d <= until).pop() || null };
}

/** How far the calendar runs: to the end of this year — and, from 24 December, to the end of the next. */
function horizon(today) {
  const y = Number(today.slice(0, 4));
  const lastWeek = today >= `${y}-12-24`;
  return { from: `${y}-01-01`, until: `${lastWeek ? y + 1 : y}-12-31`, nextYear: lastWeek };
}

/** What the exchange already lists beyond the calendar's end (the first weeks of next year), for a line under the table. */
function beyond(parsed, exchange, until, limit = 4) {
  const L = readList(parsed, exchange);
  const m = new Set(Object.values(L.monthly).map((x) => x.date));
  const cap = iso(utc(until) + 45 * DAY); // the first weeks only: the far quarterly contracts are not what is asked for here
  return [...new Set([...L.weekly, ...m])].filter((d) => d > until && d <= cap).sort().slice(0, limit).map((d) => ({ exchange, date: d, day: DOW[dowOf(d)], kind: m.has(d) ? "monthly" : "weekly" }));
}

/**
 * What changed between two calendars: a week whose date is no longer what it was.
 * @param before, after  { "EXCHANGE|nominal": date }
 */
function changes(before, after, today) {
  const out = [];
  for (const [key, now] of Object.entries(after)) {
    const was = before[key];
    if (was && was !== now && (now >= today || was >= today)) out.push({ key, exchange: key.split("|")[0], nominal: key.split("|")[1], was, now });
  }
  return out;
}

module.exports = { DOW, INDEX, DEFAULTS, EXCHANGES, splitCsv, parseList, monthlyOf, readList, tradingOnOrBefore, build, horizon, beyond, changes };
