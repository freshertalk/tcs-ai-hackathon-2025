"use strict";
// Index history: NIFTY 50 and SENSEX, year by year and month by month — and where they may go next.
//
//   THE PAST   every month and every year from the daily candles: open, high, low, close, the move
//              in points and in percent from the previous close, the best and worst point inside the
//              period (how far it ran up and down from the previous close), the range, the average
//              daily range, the deepest fall from a high inside the year, up and down months.
//   BY MONTH   each calendar month over all the years: how often it rose, the average and the median
//              move, the spread, the best and the worst year, the last ten years on their own — the
//              seasonality prop desks look at before a month starts.
//   PATTERNS   the average path of a year (year-to-date at each month end) against this year; the
//              day of the week; the turn of the month (the last three and first three sessions); what
//              followed a big month; streaks of up and down months; the drawdowns from the high;
//              general-election years.
//   AHEAD      a projection for the month and the year, from data that existed before the period
//              began: the long-run drift, the calendar month's own record, the trend regime (above or
//              below the 10-month average) and what followed an extreme month — each shrunk towards
//              the long-run average by how few cases it rests on — and a band from the index's own
//              volatility (68% and 90%). The same function is run on every past month and year
//              (walk-forward, no look-ahead), so its record is measured, not claimed: how often its
//              lean was right against the plain "it rises" base rate, how often the close fell inside
//              its bands, and its error against "no change".
//
// Pure arithmetic on daily candles: no AI, no network, no timer.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// Lok Sabha general elections
const ELECTIONS = [1996, 1998, 1999, 2004, 2009, 2014, 2019, 2024];
const MODEL = "desk-v1";

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 || 0 : null);
const r1 = (x) => (num(x) ? Math.round(x * 10) / 10 : null);
const mean = (xs) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const k = Math.floor(s.length / 2);
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};
const std = (xs) => {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
const quantile = (xs, q) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const p = (s.length - 1) * q;
  const lo = Math.floor(p);
  const hi = Math.ceil(p);
  return s[lo] + (s[hi] - s[lo]) * (p - lo);
};
/** The mean without the single best and worst case once there are six or more: one wild year does not set the month's character. */
const trimmed = (xs) => {
  if (xs.length < 6) return mean(xs);
  const s = xs.slice().sort((a, b) => a - b);
  return mean(s.slice(1, -1));
};
const pctOf = (a, b) => (num(a) && num(b) && b !== 0 ? ((a - b) / b) * 100 : null);
const cases = (n, word = "case") => `${n} ${word}${n === 1 ? "" : "s"}`;
const share = (n, of) => (of ? Math.round((n / of) * 100) : null);
const sign = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);
/** The normal distribution's cumulative function (Abramowitz–Stegun 26.2.17). */
function phi(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}
const monthKey = (y, m) => `${y}-${String(m).padStart(2, "0")}`;
const labelOf = (key) => (key.length === 4 ? key : `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`);
/** Weekdays from one date to another, both included (exchange holidays are not known here: a close estimate). */
function weekdays(fromIso, toIso) {
  let n = 0;
  for (let t = Date.parse(`${fromIso}T00:00:00Z`), end = Date.parse(`${toIso}T00:00:00Z`); t <= end; t += 86400000) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) n += 1;
  }
  return n;
}
const lastDayOf = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
const nextDay = (iso) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

/** Candles in one shape: [{ d: "YYYY-MM-DD", o, h, l, c }], oldest first, one per day. */
function normalize(candles) {
  const by = new Map();
  for (const x of candles || []) {
    const c = Array.isArray(x) ? { d: x[0], o: x[1], h: x[2], l: x[3], c: x[4] } : { d: x.d || x.t, o: x.o, h: x.h, l: x.l, c: x.c };
    const d = String(c.d || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !num(c.c) || c.c <= 0) continue;
    const o = num(c.o) && c.o > 0 ? c.o : c.c;
    by.set(d, { d, o, h: Math.max(num(c.h) ? c.h : c.c, o, c.c), l: Math.min(num(c.l) && c.l > 0 ? c.l : c.c, o, c.c), c: c.c });
  }
  return [...by.values()].sort((a, b) => (a.d < b.d ? -1 : 1));
}

/* ======================================================================== the past */

function periodOf(days, ref) {
  let high = -Infinity;
  let low = Infinity;
  const ranges = [];
  for (const x of days) {
    high = Math.max(high, x.h);
    low = Math.min(low, x.l);
    if (num(x.pc) && x.pc > 0) ranges.push(((x.h - x.l) / x.pc) * 100);
  }
  const first = days[0];
  const last = days[days.length - 1];
  const base = num(ref) ? ref : first.o;
  return {
    open: r2(first.o),
    high: r2(high),
    low: r2(low),
    close: r2(last.c),
    prevClose: num(ref) ? r2(ref) : null,
    chg: r2(last.c - base),
    pct: r2(pctOf(last.c, base)),
    upExcPct: r2(pctOf(high, base)), // the best point inside the period, from the previous close
    downExcPct: r2(pctOf(low, base)), // the worst point
    rangePct: r2(((high - low) / base) * 100),
    dayRangePct: r2(mean(ranges)),
    days: days.length,
    first: first.d,
    last: last.d,
  };
}

/**
 * Every month. @param today "YYYY-MM-DD" — the month it falls in (and any later) is marked partial
 * @returns [{ key, y, m, open, high, low, close, prevClose, chg, pct, upExcPct, downExcPct, rangePct, dayRangePct, days, first, last, partial }]
 */
function monthsOf(daily, { today } = {}) {
  const d = normalize(daily);
  for (let i = 0; i < d.length; i += 1) d[i].pc = i ? d[i - 1].c : null;
  const groups = new Map();
  for (const x of d) {
    const k = x.d.slice(0, 7);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  }
  const tk = String(today || "").slice(0, 7);
  const out = [];
  let prev = null;
  for (const [key, days] of groups) {
    const p = periodOf(days, prev);
    out.push({ key, y: Number(key.slice(0, 4)), m: Number(key.slice(5, 7)), ...p, partial: Boolean(tk) && key >= tk });
    prev = days[days.length - 1].c;
  }
  return out;
}

/** Every year, with its up and down months, its best and worst month and the deepest fall from a high inside it. */
function yearsOf(daily, months, { today } = {}) {
  const d = normalize(daily);
  for (let i = 0; i < d.length; i += 1) d[i].pc = i ? d[i - 1].c : null;
  const groups = new Map();
  for (const x of d) {
    const k = x.d.slice(0, 4);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  }
  const ty = String(today || "").slice(0, 4);
  const out = [];
  let prev = null;
  for (const [key, days] of groups) {
    const p = periodOf(days, prev);
    // the deepest fall from a high inside the year (the previous close counts as the first high)
    let peak = num(prev) ? prev : days[0].o;
    let dd = 0;
    for (const x of days) {
      peak = Math.max(peak, x.h);
      dd = Math.min(dd, (x.l / peak - 1) * 100);
    }
    const ms = months.filter((m) => m.y === Number(key) && num(m.pct));
    const done = ms.filter((m) => !m.partial);
    const best = ms.length ? ms.reduce((a, b) => (b.pct > a.pct ? b : a)) : null;
    const worst = ms.length ? ms.reduce((a, b) => (b.pct < a.pct ? b : a)) : null;
    out.push({
      key,
      y: Number(key),
      ...p,
      maxDdPct: r2(dd),
      upMonths: done.filter((m) => m.pct > 0).length,
      downMonths: done.filter((m) => m.pct < 0).length,
      bestMonth: best ? { m: best.m, pct: best.pct, chg: best.chg } : null,
      worstMonth: worst ? { m: worst.m, pct: worst.pct, chg: worst.chg } : null,
      election: ELECTIONS.includes(Number(key)),
      partial: Boolean(ty) && key >= ty,
    });
    prev = days[days.length - 1].c;
  }
  return out;
}

const complete = (rows) => rows.filter((x) => !x.partial && num(x.prevClose) && num(x.pct));

const pick = (rows, dir) => {
  if (!rows.length) return null;
  const x = rows.reduce((a, b) => (dir * b.pct > dir * a.pct ? b : a));
  return { y: x.y, pct: x.pct, chg: x.chg };
};

/** One set of moves summarised. */
function summary(rows) {
  const p = rows.map((x) => x.pct);
  const up = rows.filter((x) => x.pct > 0).length;
  return { n: rows.length, up, down: rows.filter((x) => x.pct < 0).length, winRate: share(up, rows.length), avgPct: r2(mean(p)), medianPct: r2(median(p)), stdPct: r2(std(p)) };
}

/** Each calendar month over the years: the seasonality table. */
function monthStats(months) {
  const done = complete(months);
  const lastY = done.length ? done[done.length - 1].y : null;
  return MONTHS.map((short, i) => {
    const xs = done.filter((x) => x.m === i + 1);
    if (!xs.length) return { m: i + 1, short, name: MONTH_NAMES[i], n: 0 };
    const best = xs.reduce((a, b) => (b.pct > a.pct ? b : a));
    const worst = xs.reduce((a, b) => (b.pct < a.pct ? b : a));
    const last10 = xs.filter((x) => lastY !== null && x.y > lastY - 10);
    return {
      m: i + 1,
      short,
      name: MONTH_NAMES[i],
      ...summary(xs),
      avgPts: r2(mean(xs.map((x) => x.chg))),
      medianPts: r2(median(xs.map((x) => x.chg))),
      best: { y: best.y, pct: best.pct, chg: best.chg },
      worst: { y: worst.y, pct: worst.pct, chg: worst.chg },
      avgUpExcPct: r2(mean(xs.map((x) => x.upExcPct))),
      avgDownExcPct: r2(mean(xs.map((x) => x.downExcPct))),
      avgRangePct: r2(mean(xs.map((x) => x.rangePct))),
      avgDayRangePct: r2(mean(xs.filter((x) => num(x.dayRangePct)).map((x) => x.dayRangePct))),
      last10: last10.length ? { n: last10.length, winRate: share(last10.filter((x) => x.pct > 0).length, last10.length), avgPct: r2(mean(last10.map((x) => x.pct))) } : null,
      years: xs.map((x) => ({ y: x.y, pct: x.pct, chg: x.chg })),
    };
  });
}

/** The table of years × months, newest year first. */
function heat(months, years) {
  return years
    .slice()
    .reverse()
    .map((yr) => ({
      y: yr.y,
      cells: MONTHS.map((_, i) => {
        const x = months.find((mm) => mm.y === yr.y && mm.m === i + 1);
        // a move is from the previous close: the first month on record has none
        return x && num(x.pct) && num(x.prevClose) ? { pct: x.pct, chg: x.chg, close: x.close, partial: x.partial } : null;
      }),
      year: num(yr.pct) && num(yr.prevClose) ? { pct: yr.pct, chg: yr.chg, close: yr.close, partial: yr.partial } : null,
    }));
}

/** The average path of a year: year-to-date at each month end, with the middle half of the years, against this year. */
function seasonalPath(months, years) {
  const closeOf = new Map(years.map((y) => [y.y, y]));
  const full = years.filter((y) => !y.partial && num(y.prevClose) && months.filter((m) => m.y === y.y && !m.partial).length === 12);
  const rows = MONTHS.map((short, i) => {
    const xs = full.map((y) => {
      const m = months.find((mm) => mm.y === y.y && mm.m === i + 1);
      return m ? pctOf(m.close, y.prevClose) : null;
    }).filter(num);
    return { m: i + 1, short, avg: r2(mean(xs)), median: r2(median(xs)), p25: r2(quantile(xs, 0.25)), p75: r2(quantile(xs, 0.75)), n: xs.length };
  });
  const cur = years.length ? years[years.length - 1] : null;
  const now = cur && cur.partial && num(cur.prevClose) ? months.filter((m) => m.y === cur.y).map((m) => ({ m: m.m, ytd: r2(pctOf(m.close, cur.prevClose)), partial: m.partial })) : [];
  void closeOf;
  return { years: full.length, rows, current: cur && cur.partial ? { y: cur.y, path: now } : null };
}

/** Close-to-close moves by the day of the week. */
function dayOfWeek(daily) {
  const d = normalize(daily);
  const by = [[], [], [], [], []];
  for (let i = 1; i < d.length; i += 1) {
    const w = new Date(`${d[i].d}T00:00:00Z`).getUTCDay();
    if (w >= 1 && w <= 5) by[w - 1].push(pctOf(d[i].c, d[i - 1].c));
  }
  return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((name, i) => ({ name, n: by[i].length, avgPct: r2(mean(by[i])) === null ? null : Math.round(mean(by[i]) * 1000) / 1000, winRate: share(by[i].filter((x) => x > 0).length, by[i].length) }));
}

/** The turn of the month: the last three and the first three sessions against every other day. */
function turnOfMonth(daily) {
  const d = normalize(daily);
  const keyOf = (x) => x.d.slice(0, 7);
  const turn = [];
  const rest = [];
  const first = [];
  for (let i = 1; i < d.length; i += 1) {
    const k = keyOf(d[i]);
    let fromStart = 0;
    for (let j = i - 1; j >= 0 && keyOf(d[j]) === k; j -= 1) fromStart += 1;
    let toEnd = 0;
    for (let j = i + 1; j < d.length && keyOf(d[j]) === k; j += 1) toEnd += 1;
    if (i + toEnd === d.length - 1 && toEnd < 3 && k === keyOf(d[d.length - 1])) {
      // the last days of the series may not be the last days of the month: left out
      continue;
    }
    const x = pctOf(d[i].c, d[i - 1].c);
    if (fromStart === 0) first.push(x);
    (fromStart < 3 || toEnd < 3 ? turn : rest).push(x);
  }
  const s = (xs) => ({ n: xs.length, avgPct: xs.length ? Math.round(mean(xs) * 1000) / 1000 : null, winRate: share(xs.filter((x) => x > 0).length, xs.length) });
  return { turn: s(turn), rest: s(rest), firstDay: s(first) };
}

/** What followed a big month (beyond one standard deviation), an up month and a down month. */
function afterMonths(months) {
  const done = complete(months);
  const p = done.map((x) => x.pct);
  const m = mean(p);
  const sd = std(p);
  const groups = { bigUp: [], up: [], down: [], bigDown: [] };
  for (let i = 1; i < done.length; i += 1) {
    const a = done[i - 1];
    const b = done[i];
    if (!(a.y * 12 + a.m + 1 === b.y * 12 + b.m)) continue;
    if (num(sd) && a.pct >= m + sd) groups.bigUp.push(b.pct);
    if (num(sd) && a.pct <= m - sd) groups.bigDown.push(b.pct);
    (a.pct > 0 ? groups.up : groups.down).push(b.pct);
  }
  const s = (xs) => ({ n: xs.length, avgPct: r2(mean(xs)), winRate: share(xs.filter((x) => x > 0).length, xs.length) });
  return { threshold: { upPct: r2(num(sd) ? m + sd : null), downPct: r2(num(sd) ? m - sd : null) }, afterBigUp: s(groups.bigUp), afterUp: s(groups.up), afterDown: s(groups.down), afterBigDown: s(groups.bigDown) };
}

/** The longest runs of up and down months, and the run now. */
function streaks(months) {
  const done = complete(months);
  let best = { up: null, down: null };
  let cur = null;
  for (const x of done) {
    const dir = x.pct > 0 ? "up" : x.pct < 0 ? "down" : null;
    if (!dir) {
      cur = null;
      continue;
    }
    if (cur && cur.dir === dir) {
      cur.n += 1;
      cur.to = x.key;
    } else cur = { dir, n: 1, from: x.key, to: x.key };
    if (!best[dir] || cur.n > best[dir].n) best = { ...best, [dir]: { ...cur } };
  }
  const lab = (s) => (s ? { n: s.n, from: labelOf(s.from), to: labelOf(s.to) } : null);
  return { longestUp: lab(best.up), longestDown: lab(best.down), now: cur ? { dir: cur.dir, n: cur.n, from: labelOf(cur.from) } : null };
}

/** The all-time high, the fall from it now, and the deepest falls on record (10% or more). */
function drawdowns(daily) {
  const d = normalize(daily);
  if (!d.length) return null;
  let peak = d[0];
  let trough = d[0];
  let open = null;
  const episodes = [];
  for (const x of d) {
    if (x.c >= peak.c) {
      if (open && (trough.c / open.c - 1) * 100 <= -10) episodes.push({ peak: open.d, peakClose: r2(open.c), trough: trough.d, troughClose: r2(trough.c), pct: r2((trough.c / open.c - 1) * 100), recovered: x.d });
      peak = x;
      trough = x;
      open = null;
      continue;
    }
    if (!open) open = peak;
    if (x.c < trough.c) trough = x;
  }
  if (open && (trough.c / open.c - 1) * 100 <= -10) episodes.push({ peak: open.d, peakClose: r2(open.c), trough: trough.d, troughClose: r2(trough.c), pct: r2((trough.c / open.c - 1) * 100), recovered: null });
  const last = d[d.length - 1];
  return {
    ath: { close: r2(peak.c), d: peak.d },
    now: { pct: r2((last.c / peak.c - 1) * 100), sessions: d.length - 1 - d.findIndex((x) => x.d === peak.d) },
    episodes: episodes.sort((a, b) => a.pct - b.pct).slice(0, 8),
  };
}

/** General-election years against the rest. */
function elections(years) {
  const done = complete(years);
  const e = done.filter((y) => y.election);
  const o = done.filter((y) => !y.election);
  return { years: e.map((y) => ({ y: y.y, pct: y.pct, maxDdPct: y.maxDdPct })), election: summary(e), others: summary(o) };
}

/* ======================================================================== ahead */

/** The trend regime at the start of each month: the previous close above or below the average of the last ten month closes. */
function regimes(months) {
  const out = new Map();
  for (let i = 10; i <= months.length; i += 1) {
    const w = months.slice(i - 10, i);
    if (w.some((x) => !num(x.close))) continue;
    const avg = mean(w.map((x) => x.close));
    const prev = w[w.length - 1].close;
    const key = i < months.length ? months[i].key : null;
    const st = prev >= avg ? "above" : "below";
    if (key) out.set(key, st);
    else out.set("next", st);
  }
  return out;
}

/** The daily volatility (standard deviation of log returns) over the last n sessions before a date. */
function dailyVol(daily, beforeIso, n = 63) {
  let hi = daily.length;
  if (beforeIso) {
    let lo = 0;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (daily[mid].d < beforeIso) lo = mid + 1;
      else hi = mid;
    }
  }
  const w = daily.slice(Math.max(0, hi - n - 1), hi);
  if (w.length < 20) return null;
  const r = [];
  for (let i = 1; i < w.length; i += 1) r.push(Math.log(w[i].c / w[i - 1].c));
  return std(r);
}

/** What a conditional record says, shrunk towards the long-run average by how few cases it rests on. */
const shrink = (avg, base, n, k) => (num(avg) && n > 0 ? ((avg - base) * n) / (n + k) : 0);

function bandOf(base, expPct, sigmaPct) {
  const c = Math.log(1 + expPct / 100);
  const s = sigmaPct / 100;
  const at = (z) => r2(base * Math.exp(c + z * s));
  return { mid: r2(base * (1 + expPct / 100)), low68: at(-1), high68: at(1), low90: at(-1.645), high90: at(1.645), low98: at(-2.326), high98: at(2.326) };
}

/**
 * The projection for one month, from what was known before it began — and, when `asOf` falls inside
 * it, carried forward from the close of that day.
 * @param months all months (monthsOf), daily normalized candles
 * @param key    "YYYY-MM"
 * @param asOf   { d, close } inside that month, or null for the projection made at its start
 */
function projectMonth(months, daily, key, { asOf = null, regimeMap = null } = {}) {
  const hist = complete(months).filter((x) => x.key < key);
  if (hist.length < 24) return { available: false, reason: `Two years of complete months are needed before a projection (${hist.length} so far).` };
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  const prev = months.filter((x) => x.key < key).pop();
  if (!prev || !num(prev.close)) return { available: false, reason: "The month before is not on record." };
  const base0 = prev.close;
  const p = hist.map((x) => x.pct);
  const muAll = mean(p);
  const sdAll = std(p);
  const wrAll = hist.filter((x) => x.pct > 0).length / hist.length;
  // the calendar month's own record
  const hm = hist.filter((x) => x.m === m);
  const muM = trimmed(hm.map((x) => x.pct));
  const upM = hm.filter((x) => x.pct > 0).length;
  // the trend regime
  const rg = regimeMap || regimes(months);
  const state = rg.get(key) || (months.some((x) => x.key === key) ? null : rg.get("next")) || null;
  const hr = state ? hist.filter((x) => rg.get(x.key) === state) : [];
  const muR = mean(hr.map((x) => x.pct));
  const upR = hr.filter((x) => x.pct > 0).length;
  // after an extreme month
  let extreme = null;
  if (num(sdAll) && num(prev.pct) && !prev.partial) {
    const dir = prev.pct >= muAll + 1.5 * sdAll ? "up" : prev.pct <= muAll - 1.5 * sdAll ? "down" : null;
    if (dir) {
      const xs = [];
      for (let i = 1; i < hist.length; i += 1) {
        const a = hist[i - 1];
        if (a.y * 12 + a.m + 1 !== hist[i].y * 12 + hist[i].m) continue;
        if ((dir === "up" && a.pct >= muAll + 1.5 * sdAll) || (dir === "down" && a.pct <= muAll - 1.5 * sdAll)) xs.push(hist[i].pct);
      }
      extreme = { dir, n: xs.length, avgPct: r2(mean(xs)), winRate: share(xs.filter((x) => x > 0).length, xs.length) };
    }
  }
  let e = muAll + shrink(muM, muAll, hm.length, 12) + shrink(muR, muAll, hr.length, 40) + (extreme ? shrink(extreme.avgPct, muAll, extreme.n, 20) : 0);
  e = Math.max(-sdAll, Math.min(sdAll, e));
  const wrM = (upM + 8 * wrAll) / (hm.length + 8);
  const wrR = hr.length ? (upR + 20 * wrAll) / (hr.length + 20) : wrAll;
  const pStart = (wrM + wrR) / 2;

  // the band: the index's own recent volatility, blended with the spread of all months
  const first = `${key}-01`;
  const last = lastDayOf(y, m);
  const total = Math.max(1, weekdays(first, last));
  const inside = asOf && asOf.d >= first && asOf.d <= last ? asOf : null;
  const left = inside ? Math.max(0, weekdays(nextDay(inside.d), last)) : total;
  const frac = left / total;
  const vd = dailyVol(daily, inside ? nextDay(inside.d) : first);
  const sigmaFull = num(vd) ? 0.5 * vd * Math.sqrt(total) * 100 + 0.5 * sdAll : sdAll;
  const sigma = sigmaFull * Math.sqrt(frac);
  const base = inside ? inside.close : base0;
  const eLeft = e * frac;
  const band = left > 0 ? bandOf(base, eLeft, sigma) : bandOf(base, 0, 0);
  // the chance the month ends above where it began: from the record at the start; carried forward with the move so far
  let probUp = pStart;
  if (inside) {
    if (left <= 0 || sigma <= 0) probUp = base > base0 ? 1 : 0;
    else probUp = phi((Math.log(base / base0) + Math.log(1 + eLeft / 100)) / (sigma / 100));
  }
  const lean = probUp >= 0.58 && band.mid >= base0 ? "up" : probUp <= 0.42 && band.mid <= base0 ? "down" : "none";
  const reasons = [];
  reasons.push(`${MONTH_NAMES[m - 1]} rose in ${upM} of ${hm.length} years on record (average ${r2(mean(hm.map((x) => x.pct)))}%, median ${r2(median(hm.map((x) => x.pct)))}%).`);
  if (state) reasons.push(`It begins ${state === "above" ? "above" : "below"} its 10-month average: months that began so rose ${share(upR, hr.length)}% of the time (average ${r2(muR)}%, ${hr.length} months).`);
  if (extreme) reasons.push(`Last month was an extreme ${extreme.dir} month (${prev.pct}%): after such months it rose ${extreme.winRate}% of the time (average ${extreme.avgPct}%, ${cases(extreme.n)}).`);
  reasons.push(`All months together: ${Math.round(wrAll * 100)}% rose, average ${r2(muAll)}%.`);
  if (num(vd)) reasons.push(`The last 63 sessions moved ${r2(vd * 100)}% a day: ±${r2(sigmaFull)}% is one standard move for the whole month.`);
  return {
    available: true,
    model: MODEL,
    horizon: "month",
    period: key,
    label: labelOf(key),
    base0: r2(base0),
    base: r2(base),
    asOf: inside ? inside.d : null,
    expPct: r2(pctOf(band.mid, base0)),
    ...band,
    probUp: Math.round(probUp * 100),
    lean,
    sigmaPct: r2(sigma),
    sigmaFullPct: r2(sigmaFull),
    daysTotal: total,
    daysLeft: left,
    parts: {
      drift: { n: hist.length, winRate: Math.round(wrAll * 100), avgPct: r2(muAll), stdPct: r2(sdAll) },
      seasonal: { n: hm.length, up: upM, winRate: share(upM, hm.length), avgPct: r2(mean(hm.map((x) => x.pct))), trimmedPct: r2(muM), shrunkPct: r2(shrink(muM, muAll, hm.length, 12)) },
      regime: state ? { state, n: hr.length, winRate: share(upR, hr.length), avgPct: r2(muR), shrunkPct: r2(shrink(muR, muAll, hr.length, 40)) } : null,
      extreme,
      vol: { dailyPct: r2(num(vd) ? vd * 100 : null) },
    },
    reasons,
  };
}

/** The projection for one year, the same way: the long-run drift, the regime at its start, what followed an extreme year, election years. */
function projectYear(years, months, daily, y, { asOf = null, regimeMap = null } = {}) {
  const hist = complete(years).filter((x) => x.y < y);
  if (hist.length < 5) return { available: false, reason: `Five complete years are needed before a yearly projection (${hist.length} so far).` };
  const prev = years.filter((x) => x.y < y).pop();
  if (!prev || !num(prev.close)) return { available: false, reason: "The year before is not on record." };
  const base0 = prev.close;
  const p = hist.map((x) => x.pct);
  const muAll = mean(p);
  const sdAll = std(p);
  const wrAll = hist.filter((x) => x.pct > 0).length / hist.length;
  const rg = regimeMap || regimes(months);
  const startKey = monthKey(y, 1);
  const state = rg.get(startKey) || (months.some((x) => x.key === startKey) ? null : rg.get("next")) || null;
  const hr = state ? hist.filter((x) => rg.get(monthKey(x.y, 1)) === state) : [];
  const muR = mean(hr.map((x) => x.pct));
  const upR = hr.filter((x) => x.pct > 0).length;
  let extreme = null;
  if (num(sdAll) && num(prev.pct) && !prev.partial) {
    const dir = prev.pct >= muAll + sdAll ? "up" : prev.pct <= muAll - sdAll ? "down" : null;
    if (dir) {
      const xs = hist.filter((x, i) => i > 0 && hist[i - 1].y === x.y - 1 && (dir === "up" ? hist[i - 1].pct >= muAll + sdAll : hist[i - 1].pct <= muAll - sdAll)).map((x) => x.pct);
      extreme = { dir, n: xs.length, avgPct: r2(mean(xs)), winRate: share(xs.filter((x) => x > 0).length, xs.length) };
    }
  }
  const isElection = ELECTIONS.includes(y);
  const he = isElection ? hist.filter((x) => x.election) : [];
  let e = muAll + shrink(muR, muAll, hr.length, 8) + (extreme ? shrink(extreme.avgPct, muAll, extreme.n, 8) : 0) + (isElection ? shrink(mean(he.map((x) => x.pct)), muAll, he.length, 6) : 0);
  e = Math.max(-sdAll, Math.min(sdAll, e));
  const wrR = hr.length ? (upR + 5 * wrAll) / (hr.length + 5) : wrAll;
  const pStart = (wrR + wrAll) / 2;
  const first = `${y}-01-01`;
  const last = `${y}-12-31`;
  const total = Math.max(1, weekdays(first, last));
  const inside = asOf && asOf.d >= first && asOf.d <= last ? asOf : null;
  const left = inside ? Math.max(0, weekdays(nextDay(inside.d), last)) : total;
  const frac = left / total;
  const vd = dailyVol(daily, inside ? nextDay(inside.d) : first, 126);
  const sigmaFull = num(vd) ? 0.5 * vd * Math.sqrt(total) * 100 + 0.5 * sdAll : sdAll;
  const sigma = sigmaFull * Math.sqrt(frac);
  const base = inside ? inside.close : base0;
  const eLeft = e * frac;
  const band = left > 0 ? bandOf(base, eLeft, sigma) : bandOf(base, 0, 0);
  let probUp = pStart;
  if (inside) {
    if (left <= 0 || sigma <= 0) probUp = base > base0 ? 1 : 0;
    else probUp = phi((Math.log(base / base0) + Math.log(1 + eLeft / 100)) / (sigma / 100));
  }
  const lean = probUp >= 0.58 && band.mid >= base0 ? "up" : probUp <= 0.42 && band.mid <= base0 ? "down" : "none";
  const reasons = [`${hist.filter((x) => x.pct > 0).length} of ${hist.length} complete years on record rose (average ${r2(muAll)}%, median ${r2(median(p))}%).`];
  if (state) reasons.push(`It began ${state} its 10-month average: years that began so rose ${share(upR, hr.length)}% of the time (average ${r2(muR)}%, ${cases(hr.length, "year")}).`);
  if (extreme) reasons.push(`Last year was an extreme ${extreme.dir} year (${prev.pct}%): the years after such years rose ${extreme.winRate}% of the time (${cases(extreme.n)}).`);
  if (isElection && he.length) reasons.push(`A general-election year: the ${he.length} earlier ones averaged ${r2(mean(he.map((x) => x.pct)))}%.`);
  if (num(vd)) reasons.push(`The last six months moved ${r2(vd * 100)}% a day: ±${r2(sigmaFull)}% is one standard move for a whole year.`);
  return {
    available: true,
    model: MODEL,
    horizon: "year",
    period: String(y),
    label: String(y),
    base0: r2(base0),
    base: r2(base),
    asOf: inside ? inside.d : null,
    expPct: r2(pctOf(band.mid, base0)),
    ...band,
    probUp: Math.round(probUp * 100),
    lean,
    sigmaPct: r2(sigma),
    sigmaFullPct: r2(sigmaFull),
    daysTotal: total,
    daysLeft: left,
    parts: {
      drift: { n: hist.length, winRate: Math.round(wrAll * 100), avgPct: r2(muAll), stdPct: r2(sdAll) },
      regime: state ? { state, n: hr.length, winRate: share(upR, hr.length), avgPct: r2(muR) } : null,
      extreme,
      election: isElection ? { n: he.length, avgPct: r2(mean(he.map((x) => x.pct))) } : null,
      vol: { dailyPct: r2(num(vd) ? vd * 100 : null) },
    },
    reasons,
  };
}

/** One projection against what happened. */
function scored(pj, actual) {
  const up = actual > pj.base;
  const dirHit = pj.lean === "none" ? null : (pj.lean === "up") === up && actual !== pj.base;
  return {
    actual: r2(actual),
    actualPct: r2(pctOf(actual, pj.base)),
    dirHit,
    signHit: sign(pj.mid - pj.base) === sign(actual - pj.base),
    in68: actual >= pj.low68 && actual <= pj.high68,
    in90: actual >= pj.low90 && actual <= pj.high90,
    errPct: r2(pctOf(actual, pj.mid)),
    naivePct: r2(pctOf(actual, pj.base)),
  };
}

function scoreRows(rows) {
  const n = rows.length;
  if (!n) return { n: 0 };
  const leaned = rows.filter((x) => x.dirHit !== null);
  const hits = leaned.filter((x) => x.dirHit).length;
  const mae = mean(rows.map((x) => Math.abs(x.errPct)));
  const maeNaive = mean(rows.map((x) => Math.abs(x.naivePct)));
  return {
    n,
    leaned: leaned.length,
    hits,
    hitRate: share(hits, leaned.length),
    signHitRate: share(rows.filter((x) => x.signHit).length, n),
    upShare: share(rows.filter((x) => x.actual > x.base).length, n), // the "it rises" base rate
    in68Rate: share(rows.filter((x) => x.in68).length, n),
    in90Rate: share(rows.filter((x) => x.in90).length, n),
    maePct: r2(mae),
    maeNaivePct: r2(maeNaive),
    skillPct: num(mae) && maeNaive > 0 ? Math.round((1 - mae / maeNaive) * 100) : null,
  };
}

/**
 * The projection run on every past period with only what was known before it (walk-forward).
 * @returns { summary, byYear: [{ y, n, hitRate, in68Rate }], rows: [{ period, label, base, mid, low68, high68, low90, high90, lean, probUp, actual, actualPct, dirHit, signHit, in68, in90, errPct }] }
 */
function walkForward(months, years, daily, horizon = "month") {
  const rg = regimes(months);
  const rows = [];
  if (horizon === "month") {
    for (const x of complete(months)) {
      const pj = projectMonth(months, daily, x.key, { regimeMap: rg });
      if (!pj.available) continue;
      rows.push({ period: x.key, label: labelOf(x.key), y: x.y, base: pj.base, mid: pj.mid, low68: pj.low68, high68: pj.high68, low90: pj.low90, high90: pj.high90, lean: pj.lean, probUp: pj.probUp, ...scored(pj, x.close) });
    }
  } else {
    for (const x of complete(years)) {
      const pj = projectYear(years, months, daily, x.y, { regimeMap: rg });
      if (!pj.available) continue;
      rows.push({ period: x.key, label: x.key, y: x.y, base: pj.base, mid: pj.mid, low68: pj.low68, high68: pj.high68, low90: pj.low90, high90: pj.high90, lean: pj.lean, probUp: pj.probUp, ...scored(pj, x.close) });
    }
  }
  const ys = [...new Set(rows.map((r) => r.y))];
  return {
    model: MODEL,
    summary: scoreRows(rows),
    byYear: horizon === "month" ? ys.map((y) => ({ y, ...scoreRows(rows.filter((r) => r.y === y)) })).map((x) => ({ y: x.y, n: x.n, hitRate: x.hitRate, in68Rate: x.in68Rate, signHitRate: x.signHitRate })) : [],
    rows,
  };
}

/* ======================================================================== side by side */

function corr(a, b) {
  if (a.length < 3) return null;
  const ma = mean(a);
  const mb = mean(b);
  let s = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < a.length; i += 1) {
    s += (a[i] - ma) * (b[i] - mb);
    sa += (a[i] - ma) ** 2;
    sb += (b[i] - mb) ** 2;
  }
  return sa > 0 && sb > 0 ? s / Math.sqrt(sa * sb) : null;
}

/**
 * Two indices month by month and year by year.
 * @returns { months: { n, corr, sameDirPct, aBetter, bBetter, avgAbsDiffPct }, years: { … }, rows: [{ y, a, b, months: [12]{ a, b } }] }
 */
function compare(a, b) {
  const bm = new Map(b.months.map((x) => [x.key, x]));
  const pairs = a.months.filter((x) => num(x.pct) && bm.has(x.key) && num(bm.get(x.key).pct) && num(x.prevClose) && num(bm.get(x.key).prevClose)).map((x) => [x, bm.get(x.key)]);
  const done = pairs.filter(([x, y]) => !x.partial && !y.partial);
  const by = new Map(b.years.map((x) => [x.y, x]));
  const ypairs = a.years.filter((x) => by.has(x.y) && num(x.prevClose) && num(by.get(x.y).prevClose)).map((x) => [x, by.get(x.y)]);
  const ydone = ypairs.filter(([x, y]) => !x.partial && !y.partial);
  const stat = (ps) => ({
    n: ps.length,
    corr: r2(corr(ps.map(([x]) => x.pct), ps.map(([, y]) => y.pct))),
    sameDirPct: share(ps.filter(([x, y]) => sign(x.pct) === sign(y.pct)).length, ps.length),
    aBetter: ps.filter(([x, y]) => x.pct > y.pct).length,
    bBetter: ps.filter(([x, y]) => y.pct > x.pct).length,
    avgAbsDiffPct: r2(mean(ps.map(([x, y]) => Math.abs(x.pct - y.pct)))),
    avgDiffPct: r2(mean(ps.map(([x, y]) => x.pct - y.pct))),
  });
  const cell = (x) => (x ? { pct: x.pct, chg: x.chg, close: x.close, partial: x.partial } : null);
  const rows = ypairs
    .map(([x, y]) => ({
      y: x.y,
      a: cell(x),
      b: cell(y),
      months: MONTHS.map((_, i) => {
        const p = pairs.find(([mx]) => mx.y === x.y && mx.m === i + 1);
        return p ? { a: cell(p[0]), b: cell(p[1]) } : null;
      }),
    }))
    .reverse();
  const largest = done
    .map(([x, y]) => ({ key: x.key, label: labelOf(x.key), a: x.pct, b: y.pct, diff: r2(x.pct - y.pct) }))
    .sort((p, q) => Math.abs(q.diff) - Math.abs(p.diff))
    .slice(0, 8);
  return { months: stat(done), years: stat(ydone), rows, largestGaps: largest };
}

/* ======================================================================== everything for one index */

/**
 * @param daily candles of the index (any shape normalize accepts)
 * @param opts  { today: "YYYY-MM-DD" }
 */
function analyze(daily, { today } = {}) {
  const d = normalize(daily);
  if (d.length < 60) return { available: false, reason: "Too little history to analyse (fewer than 60 sessions)." };
  const t = today || d[d.length - 1].d;
  const months = monthsOf(d, { today: t });
  const years = yearsOf(d, months, { today: t });
  const last = d[d.length - 1];
  const cm = months[months.length - 1];
  const cy = years[years.length - 1];
  const rg = regimes(months);
  const asOf = { d: last.d, close: last.c };
  const curKey = t.slice(0, 7);
  const curY = Number(t.slice(0, 4));
  const monthLive = projectMonth(months, d, curKey, { asOf, regimeMap: rg });
  const monthStart = projectMonth(months, d, curKey, { regimeMap: rg });
  const yearLive = projectYear(years, months, d, curY, { asOf, regimeMap: rg });
  const yearStart = projectYear(years, months, d, curY, { regimeMap: rg });
  const ms = monthStats(months);
  const wfM = walkForward(months, years, d, "month");
  const wfY = walkForward(months, years, d, "year");
  const doneM = complete(months);
  const doneY = complete(years);
  return {
    available: true,
    from: d[0].d,
    to: last.d,
    sessions: d.length,
    yearsCovered: doneY.length,
    last: { d: last.d, close: r2(last.c), prevClose: d.length > 1 ? r2(d[d.length - 2].c) : null, chg: d.length > 1 ? r2(last.c - d[d.length - 2].c) : null, pct: d.length > 1 ? r2(pctOf(last.c, d[d.length - 2].c)) : null },
    mtd: cm && cm.key === curKey ? { key: cm.key, label: labelOf(cm.key), chg: cm.chg, pct: cm.pct, high: cm.high, low: cm.low, upExcPct: cm.upExcPct, downExcPct: cm.downExcPct } : null,
    ytd: cy && cy.key === String(curY) ? { y: cy.y, chg: cy.chg, pct: cy.pct, high: cy.high, low: cy.low, maxDdPct: cy.maxDdPct } : null,
    thisMonth: ms[Number(curKey.slice(5, 7)) - 1],
    overall: {
      months: { ...summary(doneM), avgPts: r2(mean(doneM.map((x) => x.chg))) },
      years: { ...summary(doneY), avgPts: r2(mean(doneY.map((x) => x.chg))), best: pick(doneY, 1), worst: pick(doneY, -1) },
      cagrPct: doneY.length >= 2 && num(doneY[0].prevClose) ? r2((Math.pow(doneY[doneY.length - 1].close / doneY[0].prevClose, 1 / doneY.length) - 1) * 100) : null,
    },
    months,
    years,
    heat: heat(months, years),
    monthStats: ms,
    seasonal: seasonalPath(months, years),
    patterns: { dayOfWeek: dayOfWeek(d), turnOfMonth: turnOfMonth(d), afterMonths: afterMonths(months), streaks: streaks(months), drawdowns: drawdowns(d), elections: elections(years) },
    projections: { month: { live: monthLive, start: monthStart }, year: { live: yearLive, start: yearStart } },
    backtest: { month: { ...wfM, rows: wfM.rows.slice(-60) }, year: wfY },
    // the month path so far (for the projection chart): the period's daily closes
    path: { month: d.filter((x) => x.d.slice(0, 7) === curKey).map((x) => [x.d, r2(x.c)]), year: d.filter((x) => x.d.slice(0, 4) === String(curY)).map((x) => [x.d, r2(x.c)]) },
  };
}

module.exports = { analyze, normalize, monthsOf, yearsOf, monthStats, heat, seasonalPath, dayOfWeek, turnOfMonth, afterMonths, streaks, drawdowns, elections, regimes, projectMonth, projectYear, walkForward, scored, scoreRows, compare, weekdays, labelOf, MONTHS, MONTH_NAMES, ELECTIONS, MODEL };
