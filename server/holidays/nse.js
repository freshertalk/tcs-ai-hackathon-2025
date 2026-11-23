"use strict";
// NSE's own trading-holiday list, read strictly (23 Nov 2026).
//
// Source: the JSON behind nseindia.com → Resources → Exchange communication → Holidays
//   https://www.nseindia.com/api/holiday-master?type=trading
// One list per market segment ("CM" = equities, "FO" = equity derivatives, "CD" = currency, …). Each entry looks like
//   { "tradingDate": "24-Nov-2026", "weekDay": "Tuesday", "description": "Prakash Gurpurb Sri Guru Nanak Dev", … }
// An asterisk after the name ("Diwali Laxmi Pujan*") is NSE's mark for the Muhurat day: the market is shut except for
// the Muhurat hour, whose timings NSE announces later by circular.
//
// Strict on purpose: anything that does not look exactly like that list (a web page instead of JSON, a weekday that does
// not match its date, a date out of order, a list too short or too long) is REFUSED with a reason, and the caller keeps
// the last good copy. Pure: no clock, no network.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MIN_PER_YEAR = 5; // NSE lists 14–25 a year; fewer than this is a broken page, not a quiet year
const MAX_PER_YEAR = 40;

/** "24-Nov-2026" → "2026-11-24"; null for anything that is not a real date in that form. */
function parseNseDate(text) {
  const m = /^\s*(\d{1,2})-([A-Za-z]{3})-(\d{4})\s*$/.exec(String(text || ""));
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS[m[2].toLowerCase()];
  const year = Number(m[3]);
  if (!month || year < 2000 || year > 2100) return null;
  const t = Date.UTC(year, month - 1, day);
  const d = new Date(t);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

const weekdayOf = (date) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];

/** "Diwali Laxmi Pujan*" → { name: "Diwali Laxmi Pujan", muhurat: true } */
function cleanName(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  const muhurat = /\*\s*$/.test(raw);
  const name = raw.replace(/\*+\s*$/, "").trim();
  return { name, muhurat };
}

/** One segment's list → entries, oldest first. Throws with a reason when it is not a believable list. */
function readSegment(list, label) {
  if (!Array.isArray(list)) throw new Error(`the ${label} list is missing`);
  const out = [];
  for (const [i, e] of list.entries()) {
    if (!e || typeof e !== "object") throw new Error(`${label} entry ${i + 1} is not an object`);
    const date = parseNseDate(e.tradingDate);
    if (!date) throw new Error(`${label} entry ${i + 1} has no readable date (${JSON.stringify(String(e.tradingDate || "")).slice(0, 30)})`);
    const said = String(e.weekDay || "").trim();
    if (said && said.toLowerCase() !== weekdayOf(date).toLowerCase()) throw new Error(`${label} entry ${i + 1}: NSE says ${said} but ${date} is a ${weekdayOf(date)}`);
    const { name, muhurat } = cleanName(e.description);
    if (!name || name.length > 120) throw new Error(`${label} entry ${i + 1} (${date}) has no usable name`);
    const prev = out[out.length - 1];
    if (prev && prev.date >= date) throw new Error(`${label} dates are not in ascending order at ${date}`);
    out.push({
      date,
      weekday: weekdayOf(date),
      name,
      kind: muhurat ? "muhurat" : "closed",
      note: muhurat ? "Muhurat trading only: the market is shut except for the Muhurat hour, whose timings NSE announces by circular." : "",
    });
  }
  return out;
}

const byYear = (entries) => {
  const years = {};
  for (const e of entries) (years[e.date.slice(0, 4)] = years[e.date.slice(0, 4)] || []).push(e);
  return years;
};

/**
 * Parse the holiday-master JSON (text or already-parsed object).
 * @returns { years: { "2026": [entry…] }, segment: "CM", derivatives: { same: boolean, onlyEquity: [date], onlyDerivatives: [date] } | null }
 */
function parseNseHolidayMaster(input, { segment = "CM" } = {}) {
  let data = input;
  if (typeof input === "string") {
    const text = input.trim();
    if (!text) throw new Error("the source answered with an empty page");
    if (text[0] !== "{") throw new Error("the source answered with a web page, not the holiday list (NSE may be refusing automated requests just now)");
    try {
      data = JSON.parse(text);
    } catch (_) {
      throw new Error("the holiday list is not valid JSON");
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("the holiday list is not in NSE's format");
  const entries = readSegment(data[segment], segment);
  const years = byYear(entries);
  if (!Object.keys(years).length) throw new Error(`the ${segment} list is empty`);
  for (const [y, list] of Object.entries(years)) {
    if (list.length < MIN_PER_YEAR) throw new Error(`only ${list.length} ${segment} holidays for ${y}: that is a broken list, not a year`);
    if (list.length > MAX_PER_YEAR) throw new Error(`${list.length} ${segment} holidays for ${y} is more than any real year`);
  }

  // Equity derivatives close on the same days as equities; if NSE ever lists them differently, say so (never fail on it).
  let derivatives = null;
  if (segment === "CM" && Array.isArray(data.FO)) {
    try {
      const fo = new Set(readSegment(data.FO, "FO").map((e) => e.date));
      const cm = new Set(entries.map((e) => e.date));
      const onlyEquity = [...cm].filter((d) => !fo.has(d));
      const onlyDerivatives = [...fo].filter((d) => !cm.has(d));
      derivatives = { same: !onlyEquity.length && !onlyDerivatives.length, onlyEquity, onlyDerivatives };
    } catch (_) {
      derivatives = null;
    }
  }
  return { years, segment, derivatives };
}

module.exports = { parseNseHolidayMaster, parseNseDate, cleanName, weekdayOf };
