// src/admin/stock/holidays.js
// Exchange holiday calendars for the Stock Report page. Pure functions — no React.
//
//   • NASDAQ (and NYSE) are COMPUTED from the exchange's own rules, so any year
//     works without maintenance. Special one-off closures cannot be predicted and
//     are listed in US_SPECIAL_CLOSURES.
//   • BSE / NSE holidays cannot be computed: they follow lunar festivals and are
//     published by the exchanges once a year. They are DATA below.
//
// Each entry: { date: "YYYY-MM-DD", name, kind: "closed" | "early" | "special", note?, tag? }
//   closed   market shut all day
//   early    US early close, 1:00 pm ET
//   special  an exchange session on a day that is normally closed (Budget Sunday, Muhurat)

/* ------------------------------------------------------------ date helpers */
const pad = (n) => String(n).padStart(2, "0");
export const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const parts = (s) => s.split("-").map(Number);
const utcMs = (s) => {
  const [y, m, d] = parts(s);
  return Date.UTC(y, m - 1, d);
};

export const weekdayOf = (s) => new Date(utcMs(s)).getUTCDay(); // 0 = Sunday
export const isWeekend = (s) => [0, 6].includes(weekdayOf(s));

export function addDays(s, n) {
  const t = new Date(utcMs(s) + n * 86400000);
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export const daysBetween = (a, b) => Math.round((utcMs(b) - utcMs(a)) / 86400000);

/** Today's calendar date (YYYY-MM-DD) as it is in the given time zone. */
export function todayIn(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** "Wed, 11 Nov 2026" — formatted from the date itself, so the viewer's time zone cannot shift it. */
export function formatDate(s, opts = { weekday: "short", day: "numeric", month: "short", year: "numeric" }) {
  return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(new Date(utcMs(s)));
}

/* --------------------------------------------------------------- US rules */
function nthWeekday(y, m, weekday, n) {
  const first = weekdayOf(iso(y, m, 1));
  return iso(y, m, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
}

function lastWeekday(y, m, weekday) {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const w = weekdayOf(iso(y, m, last));
  return iso(y, m, last - ((w - weekday + 7) % 7));
}

/** Easter Sunday (anonymous Gregorian algorithm). */
function easterSunday(y) {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(y, month, day);
}

/** Saturday → the Friday before; Sunday → the Monday after. */
const observed = (s) => {
  const w = weekdayOf(s);
  return w === 6 ? addDays(s, -1) : w === 0 ? addDays(s, 1) : s;
};

/** One-off closures no rule can predict. Add new ones as they are announced. */
export const US_SPECIAL_CLOSURES = {
  "2025-01-09": "National Day of Mourning (former President Jimmy Carter)",
};

/** NASDAQ / NYSE holidays and early closes for any year. */
export function nasdaqHolidays(year) {
  const list = [];
  const add = (date, name, kind = "closed", note = "", tag = "") =>
    list.push({ date, name, kind, note, tag });

  // a holiday that lands on a weekend is observed on the nearest weekday
  const fixed = (m, d, name, tag) => {
    const actual = iso(year, m, d);
    const when = observed(actual);
    const note =
      when === actual
        ? ""
        : `${name} falls on a ${weekdayOf(actual) === 6 ? "Saturday" : "Sunday"} — observed ${formatDate(when, { weekday: "long" })}`;
    add(when, name, "closed", note, tag);
  };

  // New Year's Day on a Saturday is NOT observed on the Friday (the market stays open)
  if (weekdayOf(iso(year, 1, 1)) !== 6) fixed(1, 1, "New Year's Day");

  add(nthWeekday(year, 1, 1, 3), "Martin Luther King Jr. Day");
  add(nthWeekday(year, 2, 1, 3), "Washington's Birthday (Presidents' Day)");
  add(addDays(easterSunday(year), -2), "Good Friday");
  add(lastWeekday(year, 5, 1), "Memorial Day");
  if (year >= 2022) fixed(6, 19, "Juneteenth National Independence Day");
  fixed(7, 4, "Independence Day");
  add(nthWeekday(year, 9, 1, 1), "Labor Day");
  const thanksgiving = nthWeekday(year, 11, 4, 4);
  add(thanksgiving, "Thanksgiving Day");
  fixed(12, 25, "Christmas Day");

  for (const [date, name] of Object.entries(US_SPECIAL_CLOSURES)) {
    if (date.startsWith(`${year}-`)) add(date, name, "closed", "Unscheduled closure", "Special");
  }

  // 1:00 pm ET early closes — only on days the market would otherwise be open
  const closedDates = new Set(list.filter((h) => h.kind === "closed").map((h) => h.date));
  const early = (date, name) => {
    if (!isWeekend(date) && !closedDates.has(date)) add(date, name, "early", "Market closes at 1:00 pm ET", "Early close");
  };
  early(addDays(thanksgiving, 1), "Day after Thanksgiving");
  early(iso(year, 7, 3), "Day before Independence Day");
  early(iso(year, 12, 24), "Christmas Eve");

  return list.sort((a, b) => a.date.localeCompare(b.date));
}

/* ------------------------------------------------------------- BSE / NSE */
// Source: the exchanges' published trading-holiday lists for the equity and equity
// derivatives segments (NSE circular / BSE circular of 12 Dec 2025: 15 weekday
// holidays, four more on weekends), cross-checked against two independent
// listings, plus later circulars noted below. Currency, commodity and other
// segments can differ — always confirm with the exchange for those.
//
// TO ADD NEXT YEAR: the exchanges publish the list in December. Add an entry to
// INDIA below, in the same shape, and the page picks it up.
const INDIA = {
  2026: [
    {
      date: "2026-01-15",
      name: "Municipal Corporation elections (Maharashtra)",
      kind: "closed",
      tag: "Added later",
      note: "Not in the original list — added by exchange circular on 12 Jan 2026",
    },
    { date: "2026-01-26", name: "Republic Day" },
    {
      date: "2026-02-01",
      name: "Union Budget — special trading session",
      kind: "special",
      tag: "Special session",
      note: "Open on a Sunday, regular trading hours",
    },
    { date: "2026-02-15", name: "Mahashivratri" },
    { date: "2026-03-03", name: "Holi" },
    { date: "2026-03-21", name: "Id-Ul-Fitr (Ramadan Eid)" },
    { date: "2026-03-26", name: "Shri Ram Navami" },
    { date: "2026-03-31", name: "Shri Mahavir Jayanti" },
    { date: "2026-04-03", name: "Good Friday" },
    { date: "2026-04-14", name: "Dr. Baba Saheb Ambedkar Jayanti" },
    { date: "2026-05-01", name: "Maharashtra Day" },
    { date: "2026-05-28", name: "Bakri Id" },
    { date: "2026-06-26", name: "Muharram" },
    { date: "2026-08-15", name: "Independence Day" },
    { date: "2026-09-14", name: "Ganesh Chaturthi" },
    { date: "2026-10-02", name: "Mahatma Gandhi Jayanti" },
    { date: "2026-10-20", name: "Dussehra" },
    {
      date: "2026-11-08",
      name: "Diwali Laxmi Pujan — Muhurat trading",
      kind: "special",
      tag: "Special session",
      note: "Market is closed for the day, with a special Muhurat session; timings are set by the exchanges",
    },
    { date: "2026-11-10", name: "Diwali — Balipratipada" },
    { date: "2026-11-24", name: "Prakash Gurpurb Sri Guru Nanak Dev" },
    { date: "2026-12-25", name: "Christmas" },
  ],
};

export const INDIA_YEARS = Object.keys(INDIA).map(Number);

export function indiaHolidays(year) {
  return (INDIA[year] || [])
    .map((h) => ({ kind: "closed", note: "", tag: "", ...h }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/* ------------------------------------------------------------- summaries */
/** Closures that actually cost a trading day: not weekends, not special sessions. */
export const weekdayClosures = (list) =>
  list.filter((h) => h.kind === "closed" && !isWeekend(h.date));

/** The next full-day closure on a trading day, on or after `today`. */
export function nextClosure(list, today) {
  return weekdayClosures(list).find((h) => h.date >= today) || null;
}

/* ----------------------------------------- official data beats the rules */
/**
 * Pick what to show for NASDAQ in `year`.
 *   official  the copy the server fetched from Nasdaq Trader (when it has published that year)
 *   computed  the rule-based calendar above (any year, no network)
 * When both exist the OFFICIAL one is shown, and any date where the rules disagree with
 * it is reported in `differences` — a heads-up that either the exchange changed something
 * unusual or the rules need a look.
 *
 * @param official  the `nasdaq` object from /api/admin/stock/holidays, or null
 */
export function resolveNasdaq(year, official) {
  const computed = nasdaqHolidays(year);
  const snap = official && official.years && official.years[year];
  if (!snap || !Array.isArray(snap.entries) || snap.entries.length === 0) {
    return { entries: computed, source: "computed", snapshot: null, differences: [] };
  }

  const entries = snap.entries.map((e) => ({
    date: e.date,
    name: e.name,
    kind: e.kind === "early" ? "early" : "closed",
    note: e.note || "",
    tag: e.tag || "",
  }));

  const key = (e) => `${e.date}|${e.kind}`;
  const official_ = new Set(entries.map(key));
  const rules = new Set(computed.map(key));
  const differences = [
    ...entries.filter((e) => !rules.has(key(e))).map((e) => e.date),
    ...computed.filter((e) => !official_.has(key(e))).map((e) => e.date),
  ];
  return { entries, source: "official", snapshot: snap, differences: [...new Set(differences)].sort() };
}

/* ------------------------------------------------------------- BSE / NSE */
// India's list is checked by hand: the exchanges publish it only on pages that refuse
// automated requests, so there is no permitted way to sync it. This says when it was
// last compared with the exchange's own list, and warns when it is probably out of date.
export const INDIA_META = {
  verifiedOn: "2026-11-12",
  basis: "NSE's published trading-holiday list for the equity segment (20 entries, identical to this table)",
};

/**
 * "ok", or a warning for the reader: the exchanges publish next year's list in
 * December, so from 1 December a missing next-year list means this page is behind.
 */
export function indiaFreshness(todayIso) {
  const year = Number(todayIso.slice(0, 4));
  if (indiaHolidays(year).length === 0) {
    return { state: "stale", text: `There is no ${year} list on this page yet.` };
  }
  if (todayIso >= `${year}-12-01` && indiaHolidays(year + 1).length === 0) {
    return {
      state: "stale",
      text: `The exchanges normally publish the ${year + 1} list in December — it is not on this page yet.`,
    };
  }
  return { state: "ok", text: "" };
}
