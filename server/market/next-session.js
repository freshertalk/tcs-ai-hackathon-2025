"use strict";
// The next trading session by NSE's calendar (23 Nov 2026) — what the /me strip shows.
//
//   today     its state now: before the open, pre-open (9:00–9:15), open, closed for the day, a holiday, a weekend
//   next      the next trading day AFTER today: when tomorrow is a holiday (or a weekend) it is the day after, and so on
//             — with its pre-open, open and close times (and the closing auction from market/session.js)
//   skipped   the days between today and the next trading day, and why each is shut
//   upcoming  the next few weekday holidays
//   calendar  where the holiday list came from: NSE's own list (read by holidays/nse-service.js) or the built-in table
//   verify    whether NSE's list and the built-in table agree for the years shown
//
// One calendar: the same market/nse-holidays.js every service uses, which reads NSE's own list once the holiday service
// has it. Pure apart from the clock it is given.

const nseCalendarModule = require("./nse-holidays");
const { sessionFor, clockOf } = require("./session");

const IST = 5.5 * 3600 * 1000;
const DAY = 86400000;
const PRE_OPEN_MIN = 9 * 60;
const OPEN_MIN = 9 * 60 + 15;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const istMinute = (ms) => {
  const d = new Date(ms + IST);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const midnight = (date) => Date.parse(`${date}T00:00:00Z`) - IST; // IST midnight of a date, as a moment
const at = (date, min) => midnight(date) + min * 60000;
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const weekdayOf = (date) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
const isWeekendDate = (date) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
/** "Wednesday, 25 November 2026" */
const longLabel = (date) => {
  const d = new Date(`${date}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
/** "Wed 25 Nov" */
const shortLabel = (date) => {
  const d = new Date(`${date}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}`;
};

/** A trading day's times: pre-open, open, the close, and the closing auction for F&O stocks when there is one. */
function timesFor(date) {
  const all = sessionFor(date, { cas: false }); // the market as a whole (and every stock outside the F&O list)
  const fno = sessionFor(date, { cas: true }); // stocks in the F&O list (closing auction since 3 Aug 2026)
  const closingAuction = fno.auction
    ? { from: clockOf(fno.auction[0]), to: clockOf(fno.auction[1]), fnoContinuousTill: fno.closeClock, text: `F&O stocks: continuous trading till ${fno.closeClock}, closing auction ${clockOf(fno.auction[0])}–${clockOf(fno.auction[1])}` }
    : null;
  return {
    preOpenAt: at(date, PRE_OPEN_MIN),
    opensAt: at(date, OPEN_MIN),
    closesAt: at(date, all.closeMin),
    preOpenClock: clockOf(PRE_OPEN_MIN),
    openClock: clockOf(OPEN_MIN),
    closeClock: all.closeClock,
    closingAuction,
  };
}

/** Why a day is shut (or "" when it is a trading day). */
function shutReason(cal, date) {
  if (cal.isTradingDay(date)) return null;
  const name = cal.holidayName(date);
  if (name && !isWeekendDate(date)) return { reason: "holiday", name };
  return { reason: "weekend", name: name || "" };
}

/** The year-by-year check of NSE's list against the built-in table, for the years this answer touches. */
function verifyFor(years, official, cal) {
  const rows = (official && Array.isArray(official.verify) ? official.verify : []).filter((v) => years.includes(v.year));
  const nseYears = years.filter((y) => cal.sourceOf && cal.sourceOf(y) === "nse");
  if (!nseYears.length) {
    const tableYears = years.filter((y) => cal.sourceOf && cal.sourceOf(y) === "table");
    return {
      status: "unverified",
      years,
      text: tableYears.length
        ? `NSE's own list has not been read on this server yet; the built-in table is in use${official && official.lastError ? ` (the last check failed: ${official.lastError})` : ""}.`
        : `No holiday list for ${years.join(" / ")} yet: weekdays are assumed open.`,
      rows,
    };
  }
  const differs = rows.filter((r) => r.status === "differs");
  if (differs.length) {
    const bits = differs.map((r) => [
      ...r.onlyNse.map((d) => `NSE adds ${d.date}${d.name ? ` (${d.name})` : ""}`),
      ...r.onlyTable.map((d) => `NSE no longer lists ${d.date}`),
    ].join("; "));
    return { status: "differs", years, text: `NSE's list differs from the built-in table — ${bits.join("; ")}. NSE's list is the one used.`, rows };
  }
  const missing = years.filter((y) => !nseYears.includes(y));
  return {
    status: "match",
    years,
    text: `Matches NSE's official calendar${missing.length ? ` (${missing.join(", ")}: not published by NSE yet)` : ""}.`,
    rows,
  };
}

/**
 * @param now       the moment (ms)
 * @param official  the NSE holiday service's snapshot (for where the list came from and the check), optional
 * @param calendar  the trading-day rules (tests may pass their own)
 */
function nextSession({ now = Date.now(), official = null, calendar = nseCalendarModule, upcomingCount = 3 } = {}) {
  const cal = calendar;
  const date = istDate(now);
  const minute = istMinute(now);
  const trading = cal.isTradingDay(date);
  const special = (cal.SPECIAL || {})[date] || "";
  const shut = shutReason(cal, date);

  // today
  const today = { date, weekday: weekdayOf(date), label: longLabel(date), short: shortLabel(date), trading, special, holiday: shut && shut.reason === "holiday" ? shut.name : "" };
  if (trading) {
    const t = timesFor(date);
    Object.assign(today, t);
    if (minute < PRE_OPEN_MIN) Object.assign(today, { status: "before-open", text: `Opens today at ${t.openClock} (pre-open ${t.preOpenClock})` });
    else if (minute < OPEN_MIN) Object.assign(today, { status: "pre-open", text: `Pre-open now · opens at ${t.openClock}` });
    else if (now < t.closesAt) Object.assign(today, { status: "open", text: `Market open · closes at ${t.closeClock}` });
    else Object.assign(today, { status: "closed-for-day", text: `Closed for the day (closed at ${t.closeClock})` });
  } else if (shut && shut.reason === "holiday") Object.assign(today, { status: "holiday", text: `Market holiday · ${shut.name}` });
  else Object.assign(today, { status: "weekend", text: `Weekend · market closed${shut && shut.name ? ` (${shut.name})` : ""}` });

  // the next trading day after today, and the days skipped on the way
  const skipped = [];
  let next = addDays(date, 1);
  for (let i = 0; i < 30 && !cal.isTradingDay(next); i += 1) {
    const r = shutReason(cal, next) || { reason: "weekend", name: "" };
    skipped.push({ date: next, weekday: weekdayOf(next), short: shortLabel(next), reason: r.reason, name: r.name });
    next = addDays(next, 1);
  }
  const nt = timesFor(next);
  const nextOut = {
    date: next,
    weekday: weekdayOf(next),
    label: longLabel(next),
    short: shortLabel(next),
    daysAway: Math.round((Date.parse(`${next}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY),
    special: (cal.SPECIAL || {})[next] || "",
    ...nt,
  };

  // the session that comes next or is running now (today's when it has not closed yet)
  const sessionDate = trading && now < today.closesAt ? date : next;
  const st = sessionDate === date ? today : nextOut;
  const session = {
    date: sessionDate,
    isToday: sessionDate === date,
    phase: now >= st.opensAt && now < st.closesAt ? "open" : now >= st.preOpenAt && now < st.opensAt ? "pre-open" : "upcoming",
    preOpenAt: st.preOpenAt,
    opensAt: st.opensAt,
    closesAt: st.closesAt,
  };

  // the next few weekday holidays (from tomorrow)
  const upcoming = [];
  for (let i = 1; i <= 400 && upcoming.length < upcomingCount; i += 1) {
    const d = addDays(date, i);
    if (isWeekendDate(d)) continue;
    const name = cal.holidayName(d);
    if (name && !(cal.SPECIAL || {})[d]) upcoming.push({ date: d, weekday: weekdayOf(d), short: shortLabel(d), name, daysAway: i });
  }

  // where the calendar came from
  const years = [...new Set([Number(date.slice(0, 4)), Number(next.slice(0, 4))])];
  const sources = years.map((y) => (cal.sourceOf ? cal.sourceOf(y) : "table"));
  const calendarInfo = {
    source: sources.every((s) => s === "nse") ? "nse" : sources.includes("none") ? (sources.every((s) => s === "none") ? "none" : "partial") : sources.includes("nse") ? "mixed" : "table",
    years: Object.fromEntries(years.map((y, i) => [y, sources[i]])),
    sourceName: "NSE",
    sourceUrl: (official && official.sourceUrl) || "https://www.nseindia.com/resources/exchange-communication-holidays",
    lastSuccessAt: official ? official.lastSuccessAt : null,
    lastAttemptAt: official ? official.lastAttemptAt : null,
    lastError: official ? official.lastError : "",
    known: years.every((y) => cal.known(`${y}-06-01`)),
  };

  return {
    at: new Date(now).toISOString(),
    nowClock: clockOf(minute),
    today,
    next: nextOut,
    session,
    skipped,
    upcoming,
    calendar: calendarInfo,
    verify: verifyFor(years, official, cal),
    // when the answer next changes by itself: the next boundary of today's or the next session (the page re-reads then)
    refreshAt: [today.preOpenAt, today.opensAt, today.closesAt, midnight(addDays(date, 1))].filter((t) => Number.isFinite(t) && t > now).sort((a, b) => a - b)[0] || null,
  };
}

module.exports = { nextSession, timesFor, longLabel, shortLabel };
