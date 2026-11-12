// Number and date formatting for the Analyzer. Indian grouping (1,23,456.78), ₹, lakh/crore.

const isNum = (x) => typeof x === "number" && Number.isFinite(x);

export const num = (x, d = 2) =>
  isNum(x) ? x.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—";

export const inr = (x, d = 2) => (isNum(x) ? `₹${num(x, d)}` : "—");

export const pct = (x, d = 2) => (isNum(x) ? `${x > 0 ? "+" : ""}${x.toFixed(d)}%` : "—");

export const signed = (x, d = 2) => (isNum(x) ? `${x > 0 ? "+" : ""}${num(x, d)}` : "—");

/** 12,34,567 → "12.35 L"; 4,20,00,000 → "4.20 Cr" */
export function compact(v) {
  if (!isNum(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e7) return `${(v / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${(v / 1e5).toFixed(2)} L`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)} K`;
  return String(Math.round(v));
}

export const tone = (x) => (!isNum(x) || x === 0 ? "flat" : x > 0 ? "up" : "down");

/** "2026-11-12" → "12 Nov 2026" (from the date itself; the viewer's time zone cannot shift it) */
export function day(iso, opts = { day: "numeric", month: "short", year: "numeric" }) {
  if (!iso) return "—";
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(d);
}

export const when = (iso) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

export const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");

export { isNum };
