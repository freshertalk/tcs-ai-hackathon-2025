"use strict";
// Parser for the official Nasdaq Trader holiday schedule:
//   https://www.nasdaqtrader.com/trader.aspx?id=Calendar
//
// The page carries one table for the current year:
//   <tr><td>November 27, 2026</td><td>Early Close* - U.S.</td><td>1:00 p.m.</td></tr>
//   <tr><td>December 25, 2026</td><td>Christmas Holiday - U.S.</td><td>Closed</td></tr>
//
// The parser is deliberately strict. If the page changes shape, it THROWS rather
// than guessing, and the service keeps serving the last good copy.

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const ENTITIES = { "&amp;": "&", "&rsquo;": "’", "&lsquo;": "‘", "&#39;": "'", "&apos;": "'", "&quot;": '"', "&nbsp;": " " };
const decode = (s) => s.replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] || e);
const clean = (s) => decode(String(s)).replace(/\s+/g, " ").trim();

/** "November 27, 2026" → "2026-11-27", or null. */
function parseUsDate(text) {
  const m = clean(text).match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase()) + 1;
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (!month || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null; // e.g. "February 30"
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * @returns {{ year: number, entries: Array<{date, name, kind, note, tag, status}> }}
 * @throws if the page is not recognisably the holiday schedule
 */
function parseNasdaqTrader(html) {
  if (typeof html !== "string" || html.length < 200) throw new Error("empty or truncated page");

  const heading = html.match(/Holiday Schedule\s+(\d{4})/i);
  if (!heading) throw new Error("holiday schedule heading not found");
  const year = Number(heading[1]);

  const rowRe = /<tr>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<\/tr>/gi;
  const entries = [];
  let m;
  while ((m = rowRe.exec(html))) {
    const date = parseUsDate(m[1]);
    if (!date) continue; // header rows and anything that is not a dated row

    const rawName = clean(m[2]);
    const status = clean(m[3]);
    const closed = /^closed$/i.test(status);
    const early = /\b\d{1,2}:\d{2}\s*[ap]\.?m\.?/i.test(status);
    if (!closed && !early) throw new Error(`unrecognised status "${status}" on ${date}`);

    const observed = /\(observed\)/i.test(rawName);
    const name = rawName
      .replace(/\s*\(observed\)/i, "")
      .replace(/\s+-\s+U\.S\.?$/i, "")
      .replace(/\*+/g, "")
      .replace(/\s+/g, " ")
      .trim();

    entries.push({
      date,
      name,
      kind: closed ? "closed" : "early",
      tag: early ? "Early close" : "",
      note: early ? `Market closes at ${status} ET` : observed ? "Observed holiday" : "",
      status,
    });
  }

  // sanity: an exchange has at least ~9 closures a year; the table must be for that year, in order
  if (entries.length < 8) throw new Error(`only ${entries.length} rows parsed — page layout probably changed`);
  for (const [i, e] of entries.entries()) {
    if (!e.date.startsWith(`${year}-`)) throw new Error(`${e.date} is not in ${year}`);
    if (i && e.date <= entries[i - 1].date) throw new Error("dates are not in ascending order");
  }
  if (!entries.some((e) => e.kind === "closed")) throw new Error("no full-day closures found");

  return { year, entries };
}

module.exports = { parseNasdaqTrader, parseUsDate };
