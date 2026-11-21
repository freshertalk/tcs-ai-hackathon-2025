// The arithmetic of the expense page: which entries a period holds, how they add up by day, month, year, group and
// category, and how they are searched, sorted and written out as a file. Pure functions — the page (Expenses.jsx)
// draws what these return, and every figure on it comes from the same slice of entries, so they always agree.
//
// Dates are "YYYY-MM-DD" strings throughout: they sort and compare as text, and no time zone can move a day.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n) => String(n).padStart(2, "0");
const utc = (s) => new Date(`${s}T00:00:00Z`);
export const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
export const ymOf = (date) => String(date).slice(0, 7);
export const yearOf = (date) => Number(String(date).slice(0, 4));
export const lastDay = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
export const addMonths = (ym, n) => {
  const t = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
};
const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 86400000) + 1;
export const monthName = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
export const monthShort = (ym) => MONTHS[Number(ym.slice(5, 7)) - 1].slice(0, 3);
/** "18 Nov 2026" */
export const dayName = (date) => `${Number(date.slice(8, 10))} ${monthShort(date)} ${date.slice(0, 4)}`;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const weekday = (date) => WEEKDAYS[utc(date).getUTCDay()];

/* ------------------------------------------------------------------ money */
/** ₹1,25,000 — rupees the Indian way; paise only when there are any. */
export function money(n) {
  const v = Number(n) || 0;
  const whole = Math.abs(v - Math.round(v)) < 0.005;
  return `₹${v.toLocaleString("en-IN", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 })}`;
}
/** A short figure for an axis or a tile: ₹950, ₹12.5K, ₹1.2L, ₹3.4Cr (thousand, lakh, crore). */
export function compact(n) {
  const v = Math.abs(Number(n) || 0);
  const sign = n < 0 ? "−" : "";
  const cut = (x) => String(Math.round(x * 10) / 10).replace(/\.0$/, "");
  if (v >= 1e7) return `${sign}₹${cut(v / 1e7)}Cr`;
  if (v >= 1e5) return `${sign}₹${cut(v / 1e5)}L`;
  if (v >= 1e3) return `${sign}₹${cut(v / 1e3)}K`;
  return `${sign}₹${Math.round(v)}`;
}

/* ------------------------------------------------------------------ the period */
/**
 * The days a period covers, the one before it (to compare with), and its name.
 * @param period  { kind: "month", ym } | { kind: "year", y } | { kind: "last12" } | { kind: "all" } | { kind: "range", from, to }
 * @param today   "YYYY-MM-DD"
 * @param items   the entries (only "all" needs them: it runs from the first one)
 */
export function periodRange(period, today, items = []) {
  const p = period || { kind: "month", ym: ymOf(today) };
  if (p.kind === "year") {
    const y = Number(p.y) || yearOf(today);
    return { kind: "year", from: iso(y, 1, 1), to: iso(y, 12, 31), label: String(y), prev: { from: iso(y - 1, 1, 1), to: iso(y - 1, 12, 31), label: String(y - 1) } };
  }
  if (p.kind === "last12") {
    const end = ymOf(today);
    const start = addMonths(end, -11);
    const before = addMonths(start, -12);
    return { kind: "last12", from: `${start}-01`, to: `${end}-${pad(lastDay(end))}`, label: "Last 12 months", prev: { from: `${before}-01`, to: `${addMonths(start, -1)}-${pad(lastDay(addMonths(start, -1)))}`, label: "the 12 months before" } };
  }
  if (p.kind === "all") {
    const first = items.reduce((a, x) => (x.date < a ? x.date : a), today);
    const last = items.reduce((a, x) => (x.date > a ? x.date : a), today);
    return { kind: "all", from: first, to: last, label: "All time", prev: null };
  }
  if (p.kind === "range" && p.from && p.to) {
    const from = p.from <= p.to ? p.from : p.to;
    const to = p.from <= p.to ? p.to : p.from;
    return { kind: "range", from, to, label: from === to ? dayName(from) : `${dayName(from)} – ${dayName(to)}`, prev: null };
  }
  const ym = /^\d{4}-\d{2}$/.test(p.ym || "") ? p.ym : ymOf(today);
  const before = addMonths(ym, -1);
  return { kind: "month", ym, from: `${ym}-01`, to: `${ym}-${pad(lastDay(ym))}`, label: monthName(ym), prev: { from: `${before}-01`, to: `${before}-${pad(lastDay(before))}`, label: monthName(before) } };
}

export const within = (items, range) => (range ? items.filter((x) => x.date >= range.from && x.date <= range.to) : items);

/** How many days of a period have gone by (all of them, for one that is over): what "per day" is divided by. */
export function daysSoFar(range, today) {
  if (today < range.from) return 1;
  return Math.max(1, daysBetween(range.from, today < range.to ? today : range.to));
}

/* ------------------------------------------------------------------ search and filters */
/** The entries of the period that also match the words typed, the group and the way of paying. */
export function applyFilters(items, { range, q = "", group = "", method = "" }, cats) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  return within(items, range).filter((x) => {
    const c = cats.get(x.category) || { label: "", group: "other" };
    if (group && c.group !== group) return false;
    if (method && x.method !== method) return false;
    if (!words.length) return true;
    const hay = `${x.title} ${x.note || ""} ${c.label} ${x.method} ${x.date} ${dayName(x.date)} ${x.amount}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** Sorted by a column, either way; a tie is settled by the day, newest first. */
export function sortItems(items, key, dir, cats) {
  const val = (x) => (key === "amount" ? x.amount : key === "category" ? (cats.get(x.category) || { label: "" }).label.toLowerCase() : key === "title" ? String(x.title).toLowerCase() : key === "method" ? x.method : x.date);
  const sign = dir === "asc" ? 1 : -1;
  return items.slice().sort((a, b) => sign * cmp(val(a), val(b)) || cmp(b.date, a.date) || cmp(String(b.createdAt), String(a.createdAt)));
}

/* ------------------------------------------------------------------ totals */
export const total = (items) => Math.round(items.reduce((a, x) => a + x.amount, 0) * 100) / 100;

/**
 * The period cut into the bars of the chart: days for up to two months, months for up to three years, years beyond.
 * @returns { unit, buckets: [{ key, label, long, from, to }] }
 */
export function bucketsFor(range) {
  const days = daysBetween(range.from, range.to);
  if (days <= 62) {
    const out = [];
    for (let t = utc(range.from); t <= utc(range.to); t = new Date(t.getTime() + 86400000)) {
      const d = t.toISOString().slice(0, 10);
      out.push({ key: d, label: String(Number(d.slice(8, 10))), long: `${weekday(d)}, ${dayName(d)}`, from: d, to: d });
    }
    return { unit: "day", buckets: out };
  }
  const months = [];
  for (let ym = ymOf(range.from); ym <= ymOf(range.to); ym = addMonths(ym, 1)) months.push(ym);
  if (months.length <= 36) {
    return { unit: "month", buckets: months.map((ym) => ({ key: ym, label: monthShort(ym), long: monthName(ym), from: `${ym}-01`, to: `${ym}-${pad(lastDay(ym))}` })) };
  }
  const out = [];
  for (let y = yearOf(range.from); y <= yearOf(range.to); y += 1) out.push({ key: String(y), label: String(y), long: String(y), from: iso(y, 1, 1), to: iso(y, 12, 31) });
  return { unit: "year", buckets: out };
}

/** Each bar's total and its parts by group: [{ ...bucket, total, count, parts: { groupId: amount } }]. */
export function stack(items, buckets, cats) {
  const keyLen = buckets.length ? buckets[0].key.length : 10;
  const by = new Map(buckets.map((b) => [b.key, { ...b, total: 0, count: 0, parts: {} }]));
  for (const x of items) {
    const row = by.get(x.date.slice(0, keyLen));
    if (!row) continue;
    const g = (cats.get(x.category) || { group: "other" }).group;
    row.parts[g] = (row.parts[g] || 0) + x.amount;
    row.total += x.amount;
    row.count += 1;
  }
  return [...by.values()].map((r) => ({ ...r, total: Math.round(r.total * 100) / 100 }));
}

/** A round top for the axis and four steps up to it: { max, ticks }. */
export function niceScale(top) {
  if (!(top > 0)) return { max: 100, ticks: [0, 25, 50, 75, 100] };
  const raw = top / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  return { max: step * 4, ticks: [0, 1, 2, 3, 4].map((i) => Math.round(step * i * 100) / 100) };
}

/**
 * Where the money went: every group that has an entry, largest first, each with its categories, largest first.
 * @returns [{ id, label, total, share, count, cats: [{ id, label, total, share, count }] }]
 */
export function splitByGroup(items, groups, cats) {
  const all = total(items);
  const g = new Map(groups.map((x) => [x.id, { id: x.id, label: x.label, total: 0, count: 0, cats: new Map() }]));
  for (const x of items) {
    const c = cats.get(x.category) || { id: "other", label: "Other", group: "other" };
    const row = g.get(c.group) || g.get("other");
    if (!row) continue;
    row.total += x.amount;
    row.count += 1;
    const cr = row.cats.get(c.id) || { id: c.id, label: c.label, total: 0, count: 0 };
    cr.total += x.amount;
    cr.count += 1;
    row.cats.set(c.id, cr);
  }
  return [...g.values()]
    .filter((r) => r.count)
    .map((r) => ({ id: r.id, label: r.label, count: r.count, total: Math.round(r.total * 100) / 100, share: all ? r.total / all : 0, cats: [...r.cats.values()].map((c) => ({ ...c, total: Math.round(c.total * 100) / 100, share: r.total ? c.total / r.total : 0 })).sort((a, b) => b.total - a.total) }))
    .sort((a, b) => b.total - a.total);
}

/**
 * The same entries month by month, or year by year: the table under the chart.
 * @returns [{ key, label, count, total, perDay, top: { id, label, total } | null, parts }] newest first
 */
export function breakdown(items, unit, groups, cats, today) {
  const len = unit === "year" ? 4 : 7;
  const by = new Map();
  for (const x of items) {
    const key = x.date.slice(0, len);
    const row = by.get(key) || { key, count: 0, total: 0, parts: {} };
    const g = (cats.get(x.category) || { group: "other" }).group;
    row.parts[g] = (row.parts[g] || 0) + x.amount;
    row.total += x.amount;
    row.count += 1;
    by.set(key, row);
  }
  const name = new Map(groups.map((g) => [g.id, g.label]));
  return [...by.values()]
    .sort((a, b) => cmp(b.key, a.key))
    .map((r) => {
      const range = unit === "year" ? { from: `${r.key}-01-01`, to: `${r.key}-12-31` } : { from: `${r.key}-01`, to: `${r.key}-${pad(lastDay(r.key))}` };
      const top = Object.entries(r.parts).sort((a, b) => b[1] - a[1])[0];
      return { key: r.key, label: unit === "year" ? r.key : monthName(r.key), count: r.count, total: Math.round(r.total * 100) / 100, perDay: r.total / daysSoFar(range, today), top: top ? { id: top[0], label: name.get(top[0]) || top[0], total: top[1] } : null, parts: r.parts };
    });
}

/* ------------------------------------------------------------------ a file to keep */
const cell = (v) => {
  const s = String(v === undefined || v === null ? "" : v);
  // a cell that begins like a formula is given a leading apostrophe, so a spreadsheet shows it and does not run it
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
/** The entries as a spreadsheet file (CSV), oldest first. */
export function toCsv(items, cats, groups, methods) {
  const g = new Map(groups.map((x) => [x.id, x.label]));
  const m = new Map(methods.map((x) => [x.id, x.label]));
  const rows = items
    .slice()
    .sort((a, b) => cmp(a.date, b.date) || cmp(String(a.createdAt), String(b.createdAt)))
    .map((x) => {
      const c = cats.get(x.category) || { label: x.category, group: "other" };
      return [x.date, x.amount.toFixed(2), g.get(c.group) || c.group, c.label, x.title, m.get(x.method) || x.method, x.note || ""].map(cell).join(",");
    });
  return ["Date,Amount (INR),Group,Category,What,Paid by,Note", ...rows].join("\r\n") + "\r\n";
}

/* ------------------------------------------------------------------ for the analytics (21 Nov 2026) */
/** Every category that has an entry, largest first: [{ id, label, group, total, count, share }]. */
export function byCategory(items, cats) {
  const all = total(items);
  const m = new Map();
  for (const x of items) {
    const c = cats.get(x.category) || { id: x.category, label: x.category, group: "other" };
    const row = m.get(c.id) || { id: c.id, label: c.label, group: c.group, total: 0, count: 0 };
    row.total += x.amount;
    row.count += 1;
    m.set(c.id, row);
  }
  return [...m.values()].map((r) => ({ ...r, total: Math.round(r.total * 100) / 100, share: all ? r.total / all : 0 })).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

const WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
/** Spending by day of the week, Monday first: [{ key, label, short, total, count }]. */
export function byWeekday(items) {
  const rows = WEEK.map((w) => ({ key: w, label: w, short: w.slice(0, 3), total: 0, count: 0 }));
  for (const x of items) {
    const d = (utc(x.date).getUTCDay() + 6) % 7; // Monday = 0
    rows[d].total += x.amount;
    rows[d].count += 1;
  }
  return rows.map((r) => ({ ...r, total: Math.round(r.total * 100) / 100 }));
}

/** Spending by the way it was paid, largest first: [{ id, label, total, count, share }]. */
export function byMethod(items, methods) {
  const all = total(items);
  const name = new Map((methods || []).map((m) => [m.id, m.label]));
  const m = new Map();
  for (const x of items) {
    const row = m.get(x.method) || { id: x.method, label: name.get(x.method) || x.method, total: 0, count: 0 };
    row.total += x.amount;
    row.count += 1;
    m.set(x.method, row);
  }
  return [...m.values()].map((r) => ({ ...r, total: Math.round(r.total * 100) / 100, share: all ? r.total / all : 0 })).sort((a, b) => b.total - a.total);
}

/** What one group of categories cost. */
export const groupTotal = (items, cats, group) => total(items.filter((x) => (cats.get(x.category) || { group: "other" }).group === group));

/**
 * The period before, laid beside this one bar for bar (the 1st day beside the 1st day, the 1st month beside the 1st
 * month): a list as long as `rows`, null where the period before is shorter.
 */
export function alignPrev(rows, prevRows) {
  return rows.map((_, i) => (prevRows && prevRows[i] ? prevRows[i].total : null));
}
