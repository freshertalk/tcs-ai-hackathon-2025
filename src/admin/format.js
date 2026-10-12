// src/admin/format.js
// Numbers, durations, dates and downloads for the account and admin screens.

const nf = new Intl.NumberFormat("en-IN");

export const fmtN = (n) => nf.format(Math.round(Number(n) || 0));
export const rupees = (n) => `₹${nf.format(Math.round(Number(n) || 0))}`;

/** 3725 → "1h 2m", 95 → "1m 35s", 40 → "40s" */
export function fmtDur(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60 ? ` ${s % 60}s` : ""}`;
  const h = Math.floor(m / 60);
  if (h < 100) return `${h}h${m % 60 ? ` ${m % 60}m` : ""}`;
  return `${fmtN(h)}h`;
}

/** A change against the period before, as a signed percent (null when there is nothing to compare). */
export function delta(now, before) {
  const a = Number(now) || 0;
  const b = Number(before) || 0;
  if (!b) return a ? { pct: null, up: true, fresh: true } : null;
  const p = ((a - b) / b) * 100;
  return { pct: Math.round(p), up: p >= 0, fresh: false };
}

const pad = (n) => String(n).padStart(2, "0");

/** A Date → "2026-10-12" in the viewer's own time zone. */
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const addDays = (d, n) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  return x;
};

/** Minutes east of UTC, as the collector wants it. */
export const tzMinutes = () => -new Date().getTimezoneOffset();

export const PRESETS = [
  { id: "today", label: "Today", range: (t) => [ymd(t), ymd(t)] },
  { id: "yesterday", label: "Yesterday", range: (t) => [ymd(addDays(t, -1)), ymd(addDays(t, -1))] },
  { id: "7d", label: "7 days", range: (t) => [ymd(addDays(t, -6)), ymd(t)] },
  { id: "30d", label: "30 days", range: (t) => [ymd(addDays(t, -29)), ymd(t)] },
  { id: "90d", label: "90 days", range: (t) => [ymd(addDays(t, -89)), ymd(t)] },
  {
    id: "month",
    label: "This month",
    range: (t) => [ymd(new Date(t.getFullYear(), t.getMonth(), 1)), ymd(t)],
  },
  {
    id: "lastmonth",
    label: "Last month",
    range: (t) => [
      ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1)),
      ymd(new Date(t.getFullYear(), t.getMonth(), 0)),
    ],
  },
  { id: "all", label: "All time", range: () => null },
];

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-12" → "12 Oct" (or "12 Oct 2026" with year). */
export function shortDate(s, year = false) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
  if (!m) return String(s || "");
  return `${Number(m[3])} ${MON[Number(m[2]) - 1]}${year ? ` ${m[1]}` : ""}`;
}

/** An ISO time → "12 Oct 2026, 7:05 pm" in the viewer's zone. */
export function fmtWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const h = d.getHours();
  const h12 = h % 12 || 12;
  return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}, ${h12}:${pad(d.getMinutes())} ${h < 12 ? "am" : "pm"}`;
}

export function fmtAgo(iso) {
  const t = new Date(iso).getTime();
  if (!t) return "—";
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 45) return `${d} d ago`;
  return fmtWhen(iso).split(",")[0];
}

/** A path as a person would name it. */
export function prettyPath(p) {
  const s = String(p || "");
  if (s === "/") return "Home";
  const m = /^\/read\/[^/]+\/(.+)$/.exec(s);
  if (m) return m[1] === "cover" ? "Reader · cover" : `Reader · ${m[1]}`;
  if (/^\/read\//.test(s)) return "Reader";
  if (/^\/books\//.test(s)) return "Book page";
  const names = { "/library": "Library", "/terms": "Terms", "/privacy": "Privacy", "/refund": "Refund", "/account": "Account", "/admin": "Admin" };
  return names[s] || s;
}

export function toCsv(rows, cols) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.map((c) => esc(c.label)).join(",");
  const body = rows.map((r) => cols.map((c) => esc(typeof c.get === "function" ? c.get(r) : r[c.key])).join(","));
  return [head, ...body].join("\r\n");
}

export function download(name, text, mime = "text/csv;charset=utf-8") {
  // a leading BOM so a spreadsheet opens Hindi names correctly
  const blob = new Blob(["﻿", text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
