"use strict";
// Seasonality: how a stock has done in each calendar month (month by month, year by year) and on
// each weekday, from its own daily history. A past frequency, never a forecast.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const r2 = (x) => Math.round(x * 100) / 100;

/**
 * @param bars daily candles, oldest first ({ t: "YYYY-MM-DD", c })
 * @returns { years: [{ year, months: [pct|null ×12], total }], months: [{ name, avg, median, up, n }], weekdays: [...], from, to }
 */
function seasonality(bars, { weekdayYears = 3 } = {}) {
  const clean = (bars || []).filter((b) => b && /^\d{4}-\d{2}-\d{2}$/.test(b.t) && b.c > 0);
  if (clean.length < 60) return { available: false, reason: "Seasonality needs at least about three months of daily history." };
  // the last close of every month
  const lastOf = new Map();
  for (const b of clean) lastOf.set(b.t.slice(0, 7), b.c);
  const keys = [...lastOf.keys()];
  const byYear = new Map();
  for (let i = 1; i < keys.length; i += 1) {
    const [y, m] = keys[i].split("-").map(Number);
    const prev = lastOf.get(keys[i - 1]);
    const pct = ((lastOf.get(keys[i]) - prev) / prev) * 100;
    if (!byYear.has(y)) byYear.set(y, Array(12).fill(null));
    byYear.get(y)[m - 1] = r2(pct);
  }
  // the month still running is marked, so it is not mistaken for a finished one
  const lastKey = keys[keys.length - 1];
  const years = [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, months]) => {
      const got = months.filter((x) => x !== null);
      const total = got.length ? r2((got.reduce((p, x) => p * (1 + x / 100), 1) - 1) * 100) : null;
      return { year, months, total };
    });
  const months = MONTHS.map((name, m) => {
    const vals = years.map((y) => y.months[m]).filter((x, i) => x !== null && `${years[i].year}-${String(m + 1).padStart(2, "0")}` !== lastKey);
    const sorted = [...vals].sort((a, b) => a - b);
    return {
      name,
      n: vals.length,
      avg: vals.length ? r2(vals.reduce((a, x) => a + x, 0) / vals.length) : null,
      median: vals.length ? r2(sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : null,
      up: vals.length ? Math.round((vals.filter((x) => x > 0).length / vals.length) * 100) : null,
    };
  });
  // weekdays over the last few years: the day's close against the day before
  const since = `${Number(clean[clean.length - 1].t.slice(0, 4)) - weekdayYears}${clean[clean.length - 1].t.slice(4)}`;
  const wd = WEEKDAYS.map(() => []);
  for (let i = 1; i < clean.length; i += 1) {
    if (clean[i].t < since) continue;
    const dow = new Date(`${clean[i].t}T00:00:00Z`).getUTCDay();
    if (dow >= 1 && dow <= 5) wd[dow - 1].push(((clean[i].c - clean[i - 1].c) / clean[i - 1].c) * 100);
  }
  const weekdays = WEEKDAYS.map((name, i) => ({
    name,
    n: wd[i].length,
    avg: wd[i].length ? r2(wd[i].reduce((a, x) => a + x, 0) / wd[i].length) : null,
    up: wd[i].length ? Math.round((wd[i].filter((x) => x > 0).length / wd[i].length) * 100) : null,
  }));
  return { available: true, from: clean[0].t, to: clean[clean.length - 1].t, running: lastKey, years, months, weekdays, weekdaySince: since };
}

module.exports = { seasonality, MONTHS, WEEKDAYS };
