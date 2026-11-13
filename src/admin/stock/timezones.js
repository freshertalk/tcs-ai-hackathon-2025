// src/admin/stock/timezones.js
// Time-zone maths for the world clock. Pure functions; the browser's Intl database
// supplies the rules, so daylight saving (US, UK) is always right with no tables here.

/** The six zones on the clock. `abbr(dst)` is the everyday name for the zone right now. */
export const ZONES = [
  { id: "in", code: "IN", label: "India", city: "Mumbai · New Delhi", tz: "Asia/Kolkata", abbr: () => "IST" },
  { id: "us", code: "US", label: "USA", city: "New York (Eastern)", tz: "America/New_York", abbr: (dst) => (dst ? "EDT" : "EST") },
  { id: "sg", code: "SG", label: "Singapore", city: "Singapore", tz: "Asia/Singapore", abbr: () => "SGT" },
  { id: "uk", code: "UK", label: "UK", city: "London", tz: "Europe/London", abbr: (dst) => (dst ? "BST" : "GMT") },
  { id: "jp", code: "JP", label: "Japan", city: "Tokyo", tz: "Asia/Tokyo", abbr: () => "JST" },
  { id: "cn", code: "CN", label: "China", city: "Beijing · Shanghai", tz: "Asia/Shanghai", abbr: () => "CST" },
];

const formatters = new Map();
function fmt(tz) {
  if (!formatters.has(tz)) {
    formatters.set(
      tz,
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    );
  }
  return formatters.get(tz);
}

/** Minutes the zone is ahead of UTC at this instant (India = 330, New York in winter = -300). */
export function tzOffsetMinutes(tz, date = new Date()) {
  const p = {};
  for (const { type, value } of fmt(tz).formatToParts(date)) p[type] = value;
  const hour = Number(p.hour) === 24 ? 0 : Number(p.hour);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second));
  const real = Math.floor(date.getTime() / 1000) * 1000; // whole seconds, as the formatter shows
  return Math.round((asUtc - real) / 60000);
}

/** True while the zone is on daylight-saving time (offset above its own winter/summer minimum). */
export function isDst(tz, date = new Date()) {
  const y = date.getUTCFullYear();
  const jan = tzOffsetMinutes(tz, new Date(Date.UTC(y, 0, 1)));
  const jul = tzOffsetMinutes(tz, new Date(Date.UTC(y, 6, 1)));
  return tzOffsetMinutes(tz, date) > Math.min(jan, jul);
}

/** "UTC+05:30", "UTC−05:00", "UTC" */
export function formatUtcOffset(minutes) {
  if (minutes === 0) return "UTC";
  const sign = minutes < 0 ? "−" : "+";
  const abs = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** The size of a gap: 570 → "9h 30m", 480 → "8h", 0 → "0h". */
export function formatGap(minutes) {
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** How this zone's clock compares with the reference zone's right now. */
export function compareTo(zoneTz, refTz, date = new Date()) {
  const diff = tzOffsetMinutes(zoneTz, date) - tzOffsetMinutes(refTz, date);
  return {
    minutes: diff,
    direction: diff === 0 ? "same" : diff > 0 ? "ahead" : "behind",
    text: diff === 0 ? "Same time" : `${diff > 0 ? "+" : "−"}${formatGap(diff)}`,
  };
}

const dateKey = (tz, date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

/** Is it the same calendar day there as in the reference zone, or yesterday/tomorrow? */
export function dayRelation(zoneTz, refTz, date = new Date()) {
  const a = Date.parse(`${dateKey(zoneTz, date)}T00:00:00Z`);
  const b = Date.parse(`${dateKey(refTz, date)}T00:00:00Z`);
  const days = Math.round((a - b) / 86400000);
  return days === 0 ? "same day" : days > 0 ? "tomorrow" : "yesterday";
}

/** Clock face pieces for a zone: hours:minutes, seconds, and a short date. */
export function clockParts(tz, date = new Date(), hour12 = false) {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: hour12 ? "h12" : "h23",
  })
    .formatToParts(date)
    .reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
  return {
    hm: `${time.hour}:${time.minute}`,
    seconds: time.second,
    meridiem: hour12 ? String(time.dayPeriod || "").toLowerCase() : "",
    date: new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(date),
  };
}

/* ------------------------------------------------------- the time zone converter */

// Some browsers list a few zones under their old names (Asia/Calcutta, Asia/Katmandu,
// Asia/Saigon …). The current names are added, so the ones people look for are always there.
const MODERN = ["UTC", "Asia/Kolkata", "Asia/Kathmandu", "Asia/Ho_Chi_Minh", "Asia/Yangon", "Europe/Kyiv", "America/Nuuk", "Pacific/Kanton"];
/** Old name → current name, for the zones a browser may still report by their old names. */
export const ALIASES = { "Asia/Calcutta": "Asia/Kolkata", "Asia/Katmandu": "Asia/Kathmandu", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Asia/Rangoon": "Asia/Yangon", "Europe/Kiev": "Europe/Kyiv", "America/Godthab": "America/Nuuk", "Pacific/Enderbury": "Pacific/Kanton" };
export const currentZoneName = (tz) => ALIASES[tz] || tz;

/** Every time zone the browser knows (IANA names), sorted, with UTC first. */
export function allZones() {
  let list = [];
  try {
    if (typeof Intl.supportedValuesOf === "function") list = Intl.supportedValuesOf("timeZone") || [];
  } catch (_) {
    list = [];
  }
  if (!list.length) list = ["Europe/Berlin", "Europe/Paris", "Asia/Dubai", "Asia/Hong_Kong", "Australia/Sydney", "America/Chicago", "America/Los_Angeles"];
  const all = new Set([...list, ...MODERN, ...ZONES.map((z) => z.tz)]);
  all.delete("UTC");
  Object.keys(ALIASES).forEach((old) => all.delete(old));
  return ["UTC", ...[...all].sort()];
}

/**
 * The moment when a wall clock in `tz` shows `local` ("YYYY-MM-DDTHH:mm").
 * Found by correcting for the zone's offset twice, which settles daylight-saving edges.
 * @returns Date, or null for a bad input
 */
export function wallTimeToDate(local, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(local || ""));
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let t = asUtc - tzOffsetMinutes(tz, new Date(asUtc)) * 60000;
  t = asUtc - tzOffsetMinutes(tz, new Date(t)) * 60000;
  return new Date(t);
}

/** "YYYY-MM-DDTHH:mm" as the wall clock in `tz` shows it at `date`. */
export function dateToWallTime(date, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(date)
      .map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
