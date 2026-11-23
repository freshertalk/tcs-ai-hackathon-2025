"use strict";
// The NSE/BSE equity trading calendar, for the server: which days the market is open.
//
// Source: the exchanges' published trading-holiday list for the equity and derivatives segments (the same table the
// Calendar workspace shows, src/admin/stock/holidays.js — keep the two in step when the next year's list comes out in
// December). Weekends are never trading days, except an announced special session (the Union Budget day when it falls
// on a weekend). A day the market is shut for everything but the Muhurat hour is treated as closed.
//
// A year that is not in the table is treated as "no holidays known": weekdays are trading days and `known` says so, so
// a caller can be honest about it instead of confident.
//
// NSE's OWN LIST (23 Nov 2026): the holiday service (holidays/nse-service.js) reads NSE's official trading-holiday list
// every few hours and hands it here with setOfficial(). A year NSE has published is then read from NSE's list; the table
// below is the fallback for a year NSE's list does not carry (and the comparison that says whether the two agree). The
// special sessions stay here: NSE announces them by circular, not in the holiday list.

const CLOSED = {
  2026: {
    "2026-01-15": "Municipal Corporation elections (Maharashtra)",
    "2026-01-26": "Republic Day",
    "2026-02-15": "Mahashivratri",
    "2026-03-03": "Holi",
    "2026-03-21": "Id-Ul-Fitr (Ramadan Eid)",
    "2026-03-26": "Shri Ram Navami",
    "2026-03-31": "Shri Mahavir Jayanti",
    "2026-04-03": "Good Friday",
    "2026-04-14": "Dr. Baba Saheb Ambedkar Jayanti",
    "2026-05-01": "Maharashtra Day",
    "2026-05-28": "Bakri Id",
    "2026-06-26": "Muharram",
    "2026-08-15": "Independence Day",
    "2026-09-14": "Ganesh Chaturthi",
    "2026-10-02": "Mahatma Gandhi Jayanti",
    "2026-10-20": "Dussehra",
    "2026-11-08": "Diwali Laxmi Pujan (Muhurat trading only)",
    "2026-11-10": "Diwali — Balipratipada",
    "2026-11-24": "Prakash Gurpurb Sri Guru Nanak Dev",
    "2026-12-25": "Christmas",
  },
};
const SPECIAL = { "2026-02-01": "Union Budget — special trading session" };

const DAY = 86400000;
const utc = (date) => Date.parse(`${date}T00:00:00Z`);
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const dow = (date) => new Date(utc(date)).getUTCDay();
const isWeekend = (date) => [0, 6].includes(dow(date));
const yearOf = (date) => Number(String(date).slice(0, 4));

// NSE's official list, by year: { 2026: { "2026-11-24": "Prakash Gurpurb Sri Guru Nanak Dev", … } }. Empty until the service
// has read it (or loaded its last good copy from disk).
let OFFICIAL = {};

/**
 * Take NSE's official list. `years` is { "2026": [{ date, name, kind }…] } (the holiday service's stored copy); a year
 * given here replaces the table's year. `setOfficial(null)` forgets it (tests). Returns the years now official.
 */
function setOfficial(years) {
  const next = {};
  for (const [y, list] of Object.entries(years || {})) {
    if (!Array.isArray(list) || !list.length) continue;
    const map = {};
    for (const e of list) {
      if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(String(e.date)) || String(e.date).slice(0, 4) !== String(y)) continue;
      map[e.date] = e.kind === "muhurat" ? `${e.name} (Muhurat trading only)` : String(e.name || "Market holiday");
    }
    if (Object.keys(map).length) next[Number(y)] = map;
  }
  OFFICIAL = next;
  return Object.keys(OFFICIAL).map(Number);
}
/** Is this year read from NSE's own list (true) or from the table (false)? */
const isOfficial = (date) => Boolean(OFFICIAL[yearOf(date)]);
/** The closures in force for a year, and where they come from. */
const closedFor = (year) => (OFFICIAL[year] ? OFFICIAL[year] : CLOSED[year] || null);
const sourceOf = (year) => (OFFICIAL[year] ? "nse" : CLOSED[year] ? "table" : "none");
/** The table's own closures for a year (for the comparison with NSE's list). */
const localClosed = (year) => ({ ...(CLOSED[year] || {}) });

/** True when this year's list is in the table (or NSE's official list carries it). */
const known = (date) => Boolean(OFFICIAL[yearOf(date)] || CLOSED[yearOf(date)]);
/** The name of the holiday, or "" when the market is not closed for one. */
const holidayName = (date) => ((closedFor(yearOf(date)) || {})[date]) || "";
/** Is the equity market open for a normal session on this date? */
function isTradingDay(date) {
  if (SPECIAL[date]) return true;
  return !isWeekend(date) && !holidayName(date);
}
function nextTradingDay(date) {
  let t = utc(date) + DAY;
  for (let i = 0; i < 20 && !isTradingDay(iso(t)); i += 1) t += DAY;
  return iso(t);
}
function prevTradingDay(date) {
  let t = utc(date) - DAY;
  for (let i = 0; i < 20 && !isTradingDay(iso(t)); i += 1) t -= DAY;
  return iso(t);
}
/** Closures (weekday holidays and the special sessions) from `from` for `days` days, oldest first. */
function closuresBetween(from, days) {
  const out = [];
  for (let i = 0; i <= days; i += 1) {
    const d = iso(utc(from) + i * DAY);
    const name = holidayName(d);
    if (name) out.push({ date: d, name, kind: "closed" });
    else if (SPECIAL[d]) out.push({ date: d, name: SPECIAL[d], kind: "special" });
  }
  return out;
}
/** The last trading day of the month this date is in. */
function lastTradingDayOfMonth(date) {
  const [y, m] = date.split("-").map(Number);
  let t = Date.UTC(y, m, 0); // day 0 of next month = last day of this one
  for (let i = 0; i < 10 && !isTradingDay(iso(t)); i += 1) t -= DAY;
  return iso(t);
}

module.exports = { isTradingDay, nextTradingDay, prevTradingDay, holidayName, closuresBetween, lastTradingDayOfMonth, known, isWeekend, SPECIAL, setOfficial, isOfficial, sourceOf, localClosed };
