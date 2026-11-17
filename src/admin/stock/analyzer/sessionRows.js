// Pure helpers for the Desk's history tables: one row per session, and the same bars rolled up by month and by year.
// Input is the daily candle list the server already keeps (up to ten years): [{ t: "YYYY-MM-DD", o, h, l, c, v }], oldest first.

const ok = (x) => typeof x === "number" && Number.isFinite(x);
const AVG = 20; // volume average for the "× average" column

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const weekday = (iso) => WEEKDAYS[new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).getUTCDay()];

/** One row per session, oldest first, with what each session did against the one before it. */
export function sessionRows(candles) {
  const bars = (Array.isArray(candles) ? candles : []).filter((b) => b && /^\d{4}-\d{2}-\d{2}/.test(String(b.t)) && ok(b.c));
  const out = [];
  let sum = 0; // running sum of the volume of the AVG sessions before this one
  for (let i = 0; i < bars.length; i += 1) {
    const b = bars[i];
    const prev = i ? bars[i - 1].c : null;
    const t = String(b.t).slice(0, 10);
    const base = i >= AVG ? sum / AVG : i >= 5 ? sum / Math.min(i, AVG) : null;
    out.push({
      t,
      o: b.o,
      h: b.h,
      l: b.l,
      c: b.c,
      v: ok(b.v) ? b.v : null,
      prev,
      chg: prev ? b.c - prev : null,
      chgPct: prev ? ((b.c - prev) / prev) * 100 : null,
      gapPct: prev && ok(b.o) ? ((b.o - prev) / prev) * 100 : null,
      rangePct: ok(b.h) && ok(b.l) && b.l > 0 ? ((b.h - b.l) / b.l) * 100 : null,
      // where the close sat in the day's range: 0 = at the low, 100 = at the high
      closeAt: ok(b.h) && ok(b.l) && b.h > b.l ? ((b.c - b.l) / (b.h - b.l)) * 100 : null,
      volX: ok(b.v) && base && base > 0 ? b.v / base : null,
      value: ok(b.v) ? (b.v * ((b.h + b.l + b.c) / 3)) : null, // an estimate: shares × the day's typical price
    });
    if (ok(b.v)) sum += b.v;
    if (i >= AVG && ok(bars[i - AVG].v)) sum -= bars[i - AVG].v;
  }
  return out;
}

/** A summary of the last `n` rows of `rows` (oldest first). */
export function summary(rows, n = 30) {
  const tail = rows.slice(-n);
  if (!tail.length) return null;
  const first = tail[0];
  const lastRow = tail[tail.length - 1];
  const base = first.prev || first.o || first.c;
  const vols = tail.map((r) => r.v).filter(ok);
  const ranges = tail.map((r) => r.rangePct).filter(ok);
  return {
    n: tail.length,
    from: first.t,
    to: lastRow.t,
    high: Math.max(...tail.map((r) => r.h).filter(ok)),
    low: Math.min(...tail.map((r) => r.l).filter(ok)),
    returnPct: base ? ((lastRow.c - base) / base) * 100 : null,
    up: tail.filter((r) => r.chg > 0).length,
    down: tail.filter((r) => r.chg < 0).length,
    avgVolume: vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : null,
    avgRangePct: ranges.length ? ranges.reduce((a, b) => a + b, 0) / ranges.length : null,
    best: tail.reduce((m, r) => (ok(r.chgPct) && (m === null || r.chgPct > m.chgPct) ? r : m), null),
    worst: tail.reduce((m, r) => (ok(r.chgPct) && (m === null || r.chgPct < m.chgPct) ? r : m), null),
  };
}

/** Roll the session rows (oldest first) into months or years: open of the first, close of the last, extremes, volume. */
export function rollUp(rows, by = "month") {
  const len = by === "year" ? 4 : 7;
  const groups = [];
  let cur = null;
  for (const r of rows) {
    const key = r.t.slice(0, len);
    if (!cur || cur.key !== key) {
      cur = { key, t: key, o: r.o, h: r.h, l: r.l, c: r.c, v: 0, sessions: 0, up: 0, prevClose: r.prev, firstT: r.t, lastT: r.t };
      groups.push(cur);
    }
    cur.h = Math.max(cur.h, r.h);
    cur.l = Math.min(cur.l, r.l);
    cur.c = r.c;
    cur.lastT = r.t;
    cur.v += ok(r.v) ? r.v : 0;
    cur.sessions += 1;
    if (r.chg > 0) cur.up += 1;
  }
  return groups.map((g) => {
    const base = g.prevClose || g.o;
    return { ...g, chg: g.c - base, chgPct: base ? ((g.c - base) / base) * 100 : null, rangePct: g.l > 0 ? ((g.h - g.l) / g.l) * 100 : null };
  });
}

const csvCell = (v) => (v === null || v === undefined ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** The session rows as CSV text, newest first. */
export function toCsv(rows) {
  const head = ["Date", "Open", "High", "Low", "Close", "Prev close", "Change", "Change %", "Gap %", "Range %", "Volume"];
  const r2 = (x) => (ok(x) ? Math.round(x * 100) / 100 : "");
  const lines = [head.join(",")];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const r = rows[i];
    lines.push([r.t, r.o, r.h, r.l, r.c, r.prev, r2(r.chg), r2(r.chgPct), r2(r.gapPct), r2(r.rangePct), r.v].map(csvCell).join(","));
  }
  return lines.join("\n");
}
