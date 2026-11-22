"use strict";
// Volatility from several days of history (22 Nov 2026): how wild each stock should be in the NEXT session, and in each part
// of it — so a forecast band is the right width from the first bar, instead of waiting for today's bars to show it.
//
//   THE DAY      the heterogeneous autoregressive model of realized volatility, HAR-RV (Corsi, "A simple approximate
//                long-memory model of realized volatility", Journal of Financial Econometrics 2009), in logs: tomorrow's
//                realized variance against the stock's usual is forecast from yesterday's, the last week's and the last
//                month's — the three speeds at which traders' volatility fades — plus the whole market's yesterday. One
//                pooled model over every stored stock (each in its own units), by ridge sums.
//   THE HOUR     the intraday pattern of volatility (Andersen & Bollerslev, "Intraday periodicity and volatility persistence",
//                Journal of Empirical Finance 1997): the opening and closing bars move far more than midday ones. Each 5-minute
//                slot's usual share is measured, so the open is not mistaken for a wild day and midday not for a calm one.
//   DURING THE SESSION
//                the day's forecast is the prior; every finished bar (its move, taken out of the slot's usual share) updates it
//                like a running average that starts with K bars' worth of the prior. Early on the history speaks; by midday
//                today's own bars do.
//   HONEST       fitted on the older three quarters of the sessions and judged on the newest quarter against two plain
//                rules: "the usual" and "the same as yesterday". The judged numbers are what the screen shows.
//
// Pure arithmetic: no clock, no network, no records.

const SLOTS = 75; // 5-minute bars in a session (9:15–15:30)
const USUAL_DAYS = 40;
const K_PRIOR = 12; // the prior counts as this many bars of today
const LAMBDA = 10;
const DIM = 5;
const FEATURES = ["bias", "day", "week", "month", "market"];

const num = (x) => typeof x === "number" && Number.isFinite(x);
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const r4 = (x) => (num(x) ? Math.round(x * 10000) / 10000 : null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c += 1) {
    let p = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k += 1) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** The squared 5-minute log returns of one session, by slot (bars cleaned and slotted: { s, o, c }). */
function sessionReturns(bars) {
  const out = [];
  let prev = null;
  for (const b of bars || []) {
    if (!b || !num(b.c) || b.c <= 0 || !num(b.s)) continue;
    const from = prev !== null ? prev : num(b.o) && b.o > 0 ? b.o : null;
    if (from !== null) out.push({ s: b.s, r2: Math.log(b.c / from) ** 2 });
    prev = b.c;
  }
  return out;
}

/** One session's realized variance per bar (the mean squared 5-minute return); null with too few bars. */
function dayVariance(bars) {
  const r = sessionReturns(bars);
  if (r.length < 30) return null;
  const v = mean(r.map((x) => x.r2));
  return v > 0 ? v : null;
}

/**
 * One stock's history boiled down (so the bars need not be held): its daily variances, and its returns' sums by slot in its own
 * units (for the intraday pattern). @param days [[date, bars], …] (bars cleaned and slotted)
 */
function summarizeStock(days) {
  const pts = days.map(([date, b]) => [date, dayVariance(b)]).filter(([, v]) => num(v));
  const sum = new Array(SLOTS).fill(0);
  const cnt = new Array(SLOTS).fill(0);
  const u = mean(pts.map((p) => p[1]));
  if (u > 0) {
    for (const [, b] of days.slice(-120)) {
      for (const x of sessionReturns(b)) {
        if (x.s < 0 || x.s >= SLOTS) continue;
        sum[x.s] += Math.min(x.r2 / u, 50); // a single shock does not make a slot "wild"
        cnt[x.s] += 1;
      }
    }
  }
  return { pts, sum, cnt };
}

/** The intraday pattern: each slot's usual share of the variance (mean 1), pooled over the stocks' summaries. */
function seasonFrom(summaries) {
  const sum = new Float64Array(SLOTS);
  const cnt = new Float64Array(SLOTS);
  for (const sm of summaries) {
    for (let i = 0; i < SLOTS; i += 1) {
      sum[i] += sm.sum[i] || 0;
      cnt[i] += sm.cnt[i] || 0;
    }
  }
  const raw = Array.from(sum, (v, i) => (cnt[i] >= 30 ? v / cnt[i] : NaN));
  const known = raw.filter(num);
  if (known.length < SLOTS / 2) return new Array(SLOTS).fill(1);
  const avg = mean(known);
  const filled = raw.map((v, i) => (num(v) ? v : raw.slice(Math.max(0, i - 3), i + 4).filter(num)[0] || avg));
  const smooth = filled.map((v, i) => (i === 0 || i === SLOTS - 1 ? v : (filled[i - 1] + 2 * v + filled[i + 1]) / 4));
  const m = mean(smooth);
  return smooth.map((v) => r4(clamp(v / m, 0.3, 5)));
}
/** The same from whole histories. @param perStock [[ [date, bars], … ], …] */
const seasonOf = (perStock) => seasonFrom(perStock.map(summarizeStock));

/** The HAR inputs for day t of a stock's daily variances `v` (ascending), against its usual; null when the history is short. */
function harInputs(v, t, marketDay = 0) {
  if (t < 21) return null;
  const from = Math.max(0, t - USUAL_DAYS + 1);
  const u = mean(v.slice(from, t + 1));
  if (!(u > 0)) return null;
  const ld = Math.log(v[t] / u);
  const lw = Math.log(mean(v.slice(t - 4, t + 1)) / u);
  const lm = Math.log(mean(v.slice(t - 21, t + 1)) / u);
  return { x: [1, clamp(ld, -3, 3), clamp(lw, -3, 3), clamp(lm, -3, 3), clamp(num(marketDay) ? marketDay : 0, -3, 3)], u };
}

/**
 * Fit the model from the stored sessions.
 * @param perStock { SYMBOL: [[date, bars], …] } (bars cleaned and slotted) — or { SYMBOL: summarizeStock(…) }
 * @returns { coef, resVar, season, forecasts: { SYMBOL: { ratio, after } }, judge: { n, har, usual, yesterday, skill }, … }
 */
function fitVolModel(perStock) {
  const series = {};
  const sums = {};
  for (const [sym, val] of Object.entries(perStock)) {
    const sm = Array.isArray(val) ? summarizeStock(val) : val;
    if (!sm || !Array.isArray(sm.pts)) continue;
    sums[sym] = sm;
    if (sm.pts.length >= 30) series[sym] = sm.pts;
  }
  const syms = Object.keys(series);
  if (syms.length < 3) return null;
  // the whole market's day: the average over stocks of log(day / usual), by date
  const mk = new Map();
  for (const sym of syms) {
    const pts = series[sym];
    const v = pts.map((p) => p[1]);
    for (let t = 21; t < pts.length; t += 1) {
      const u = mean(v.slice(Math.max(0, t - USUAL_DAYS + 1), t + 1));
      const a = mk.get(pts[t][0]) || [0, 0];
      a[0] += Math.log(v[t] / u);
      a[1] += 1;
      mk.set(pts[t][0], a);
    }
  }
  const mkDay = (date) => {
    const a = mk.get(date);
    return a && a[1] >= 3 ? a[0] / a[1] : 0;
  };
  const dates = [...new Set(syms.flatMap((s) => series[s].map((p) => p[0])))].sort();
  const cut = dates[Math.floor(dates.length * 0.75)];
  const rows = [];
  for (const sym of syms) {
    const pts = series[sym];
    const v = pts.map((p) => p[1]);
    for (let t = 21; t < pts.length - 1; t += 1) {
      const hi = harInputs(v, t, mkDay(pts[t][0]));
      if (!hi) continue;
      rows.push({ x: hi.x, y: clamp(Math.log(v[t + 1] / hi.u), -4, 4), date: pts[t + 1][0] });
    }
  }
  const fitOn = (list) => {
    const A = Array.from({ length: DIM }, (_, i) => Array.from({ length: DIM }, (__, j) => (i === j && i > 0 ? LAMBDA : 0)));
    const b = new Array(DIM).fill(0);
    for (const r of list) {
      for (let i = 0; i < DIM; i += 1) {
        b[i] += r.x[i] * r.y;
        for (let j = 0; j < DIM; j += 1) A[i][j] += r.x[i] * r.x[j];
      }
    }
    return list.length >= 50 ? solve(A, b) : null;
  };
  const train = rows.filter((r) => r.date <= cut);
  const test = rows.filter((r) => r.date > cut);
  const w = fitOn(train);
  if (!w || test.length < 30) return null;
  const meanY = mean(train.map((r) => r.y));
  let seH = 0;
  let seU = 0;
  let seY = 0;
  for (const r of test) {
    const p = r.x.reduce((s, xi, i) => s + xi * w[i], 0);
    seH += (r.y - p) ** 2;
    seU += (r.y - meanY) ** 2;
    seY += (r.y - r.x[1]) ** 2; // "the same as yesterday"
  }
  const coef = fitOn(rows) || w;
  const resVar = seH / test.length;
  // each stock's forecast for the session after its last stored one
  const forecasts = {};
  for (const sym of syms) {
    const pts = series[sym];
    const v = pts.map((p) => p[1]);
    const t = pts.length - 1;
    const hi = harInputs(v, t, mkDay(pts[t][0]));
    if (!hi) continue;
    const ly = hi.x.reduce((s, xi, i) => s + xi * coef[i], 0);
    forecasts[sym] = { ratio: r4(clamp(Math.exp(ly + resVar / 2), 0.25, 6)), after: pts[t][0] };
  }
  return {
    version: 1,
    coef: coef.map(r4),
    features: FEATURES,
    resVar: r4(resVar),
    season: seasonFrom(Object.values(sums)),
    forecasts,
    stocks: syms.length,
    sessions: dates.length,
    judge: { n: test.length, from: dates.find((d) => d > cut) || null, to: dates[dates.length - 1], har: r4(seH / test.length), usual: r4(seU / test.length), yesterday: r4(seY / test.length), skill: seU > 0 ? r4(1 - seH / seU) : null },
  };
}

/**
 * The volatility for a forecast now: the day's level (the history's forecast updated by today's finished bars) and the
 * scale for the next `h` bars (√ of the day's level × the coming slots' usual share).
 * @param prior   the history's forecast for today (ratio to the usual variance), or null (= 1)
 * @param bars    today's finished bars (cleaned and slotted)
 * @param sigmaPct the usual 5-minute move, in percent (the forecaster's)
 * @param slot    the slot of the bar the forecast starts from
 */
function scaleFor({ prior = null, season = null, bars = [], sigmaPct, slot, h }) {
  if (!num(sigmaPct) || sigmaPct <= 0 || !num(slot) || !num(h) || h < 1) return null;
  const S = Array.isArray(season) && season.length === SLOTS ? season : new Array(SLOTS).fill(1);
  const s2 = (sigmaPct / 100) ** 2;
  const p = num(prior) && prior > 0 ? prior : 1;
  let sum = 0;
  let n = 0;
  for (const x of sessionReturns(bars)) {
    if (x.s > slot || x.s < 0 || x.s >= SLOTS) continue;
    sum += Math.min(x.r2 / (s2 * S[x.s]), 25);
    n += 1;
  }
  const day = (K_PRIOR * p + sum) / (K_PRIOR + n);
  let ahead = 0;
  let m = 0;
  for (let k = slot + 1; k <= slot + h && k < SLOTS; k += 1) {
    ahead += S[k];
    m += 1;
  }
  const share = m ? ahead / m : 1;
  return { day: r4(day), share: r4(share), scale: r4(clamp(Math.sqrt(day * share), 0.5, 3)), bars: n };
}

/** The history's forecast for a stock today: only when it was made from the session just before (within a week). */
function priorFor(model, symbol, today) {
  const f = model && model.forecasts ? model.forecasts[symbol] : null;
  if (!f || !f.after || f.after >= today) return null;
  const gap = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${f.after}T00:00:00Z`)) / 86400000;
  return gap <= 7 ? f.ratio : null;
}

module.exports = { SLOTS, K_PRIOR, FEATURES, sessionReturns, dayVariance, summarizeStock, seasonFrom, seasonOf, harInputs, fitVolModel, scaleFor, priorFor };
