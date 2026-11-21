"use strict";
// The consensus forecast's arithmetic: one level forecast for 5 and 15 minutes out of the desk's three forecasters and the
// live order book — and a blend that learns, from its own checked forecasts, how much each deserves.
//
//   INPUTS (for a horizon h bars ahead, every move in units of the stock's usual move σ·√h — the evidence desk's scale)
//     1  a constant (the blend's own bias)
//     z  the 15-minute forecaster's expected move (server/horizon.js)
//     e  the evidence desk's edge: its chance of a rise minus its chance of a fall (server/evidence.js)
//     a  the early calls: on a move, (carry-on chance − usual) − (turn chance − usual), signed by the move's side
//     b  the order book: (buy quantity − sell quantity) / (both), from the live quote
//   MODEL     ŷ = w · x, fitted by ridge regression on every checked forecast, pulled towards w₀ = (0, 1, 0, 0, 0) — the
//             forecaster alone — so with no evidence the blend IS the forecaster, and it moves away only as far as its
//             checks justify. Old checks fade slowly (FADE per check).
//   THE BAND  the forecaster's own band, scaled by how the blend's misses compare with the forecaster's (bounded), and
//             widened or narrowed by the early calls' momentum reading (a larger move building, or a quiet one).
//   PROOF     every check scores the blend AND the forecaster alone on the same forecast. The blend's numbers lead only once
//             it has at least MIN_CHECKS checks over MIN_DAYS sessions and misses less (by MIN_GAIN) without calling the
//             direction worse; until then the forecaster's numbers lead and the blend is shown "in trial".
//
// Pure: no clock, no network, no records.

const HZ = [1, 3]; // 5 and 15 minutes, in 5-minute bars
const KEYS = { 1: "5", 3: "15" };
const DIM = 5;
const FEATURES = ["bias", "forecaster", "evidence", "early", "book"];
const W0 = [0, 1, 0, 0, 0];
const LAMBDA = 60; // the pull towards the forecaster alone, in checks' worth
const FADE = 0.9995;
const MIN_CHECKS = 150;
const MIN_DAYS = 5;
const MIN_GAIN = 0.02;
const DIR_MIN = 0.1; // a move smaller than this (in usual moves) is not a direction
const Z70 = 1.0364;

const num = (x) => typeof x === "number" && Number.isFinite(x);
const clip = (x, a) => (x > a ? a : x < -a ? -a : x);
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const r4 = (x) => (num(x) ? Math.round(x * 10000) / 10000 : null);

/** The normal distribution's cumulative function. */
function phi(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

/** A fresh model: the ridge sums for each horizon start at the prior (the forecaster alone). */
function emptyModel() {
  const per = () => ({ A: Array.from({ length: DIM }, (_, i) => Array.from({ length: DIM }, (__, j) => (i === j ? LAMBDA : 0))), b: W0.map((w) => w * LAMBDA), w: W0.slice(), n: 0, stats: emptyStats() });
  return { version: 1, h: Object.fromEntries(HZ.map((h) => [h, per()])) };
}
function emptyStats() {
  return { n: 0, days: [], blend: { abs: 0, sq: 0, dirN: 0, dirOk: 0 }, solo: { abs: 0, sq: 0, dirN: 0, dirOk: 0 } };
}

/** Solve A w = b (Gaussian elimination with pivoting). Returns null when A is singular. */
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

/**
 * The inputs for one horizon.
 * @param hz    { pct, low, high, pUp, price } — the forecaster at this horizon (pct in percent)
 * @param sigmaPct the stock's usual 5-minute move, in percent
 * @param h     bars ahead
 * @param ev    { pUp, pDown } or null — the evidence desk's call nearest this horizon
 * @param early { run, dir (+1/−1), follow: { p, usual }, reversal: { p, usual } } or null
 * @param book  { buyQty, sellQty } or null
 */
function inputsOf({ hz, sigmaPct, h, ev = null, early = null, book = null }) {
  const s = sigmaPct * Math.sqrt(h);
  if (!hz || !num(hz.pct) || !num(s) || s <= 0) return null;
  const z = clip(hz.pct / s, 4);
  const e = ev && num(ev.pUp) && num(ev.pDown) ? clip(ev.pUp - ev.pDown, 1) : 0;
  let a = 0;
  if (early && early.run && (early.dir === 1 || early.dir === -1)) {
    const go = early.follow && num(early.follow.p) && num(early.follow.usual) ? early.follow.p - early.follow.usual : 0;
    const turn = early.reversal && num(early.reversal.p) && num(early.reversal.usual) ? early.reversal.p - early.reversal.usual : 0;
    a = clip(early.dir * (go - turn) * 4, 1); // a 25-point edge counts as a full unit
  }
  const bq = book && num(book.buyQty) && num(book.sellQty) && book.buyQty + book.sellQty > 0 ? clip((book.buyQty - book.sellQty) / (book.buyQty + book.sellQty), 1) : 0;
  return [1, r4(z), r4(e), r4(a), r4(bq)];
}

const dot = (w, x) => w.reduce((s, wi, i) => s + wi * x[i], 0);

/** Has the blend earned the lead at this horizon? */
function provenOf(st) {
  if (!st || st.n < MIN_CHECKS || (st.days || []).length < MIN_DAYS) return false;
  const maeB = st.blend.abs / st.n;
  const maeS = st.solo.abs / st.n;
  const dirB = st.blend.dirN ? st.blend.dirOk / st.blend.dirN : 0;
  const dirS = st.solo.dirN ? st.solo.dirOk / st.solo.dirN : 0;
  return maeB <= maeS * (1 - MIN_GAIN) && dirB >= dirS - 0.01;
}

/** The record of one horizon, for the screen. */
function summaryOf(st) {
  if (!st || !st.n) return { checks: 0, days: 0, proven: false };
  const n = st.n;
  return {
    checks: n,
    days: (st.days || []).length,
    proven: provenOf(st),
    blend: { missAvg: r4(st.blend.abs / n), dirAcc: st.blend.dirN ? r4(st.blend.dirOk / st.blend.dirN) : null, dirCalls: st.blend.dirN },
    forecaster: { missAvg: r4(st.solo.abs / n), dirAcc: st.solo.dirN ? r4(st.solo.dirOk / st.solo.dirN) : null, dirCalls: st.solo.dirN },
    gain: st.solo.abs > 0 ? r4(1 - st.blend.abs / st.solo.abs) : null,
  };
}

/**
 * The forecast at one horizon from the model as it stands.
 * @returns { blend: { z, pct, price, low, high, pUp }, solo: { … the forecaster's own }, contributions, proven }
 */
function forecastOf(model, h, x, { price, sigmaPct, hz, volMult = 1 }) {
  const m = model.h[h];
  const s = sigmaPct * Math.sqrt(h);
  const zb = clip(dot(m.w, x), 4);
  const st = m.stats;
  // the band: the forecaster's, scaled by the blend's misses against the forecaster's (once there are enough), and by momentum
  const half = num(hz.high) && num(hz.low) && price > 0 ? ((hz.high - hz.low) / 2 / price) * 100 : Z70 * s;
  const ratio = st.n >= 50 && st.solo.sq > 0 ? Math.sqrt(st.blend.sq / st.solo.sq) : 1;
  const hb = half * clamp(ratio, 0.7, 1.3) * clamp(volMult, 0.85, 1.2);
  const sdz = hb / Z70 / s;
  const pct = zb * s;
  const round = (p) => Math.round(p * 20) / 20;
  const blend = { z: r4(zb), pct: r4(pct), price: round(price * (1 + pct / 100)), low: round(price * (1 + (pct - hb) / 100)), high: round(price * (1 + (pct + hb) / 100)), pUp: r4(phi(zb / Math.max(sdz, 0.2))) };
  const solo = { z: x[1], pct: r4(hz.pct), price: hz.price, low: hz.low, high: hz.high, pUp: r4(hz.pUp) };
  const contributions = FEATURES.map((f, i) => ({ input: f, value: x[i], weight: r4(m.w[i]), adds: r4(m.w[i] * x[i] * s) })); // `adds`: percent of price
  return { blend, solo, contributions, proven: provenOf(st) };
}

/**
 * Learn one checked forecast: y is the move that happened (usual moves), zb and zs what the blend and the forecaster said.
 * Mutates the model. `date` counts the sessions behind the record.
 */
function learn(model, h, x, y, { zb, zs, date }) {
  const m = model.h[h];
  if (!m || !Array.isArray(x) || x.length !== DIM || !num(y)) return;
  const yy = clip(y, 8);
  // fade the old checks a little, keeping the prior's pull (the faded part of the prior is put back)
  for (let i = 0; i < DIM; i += 1) {
    for (let j = 0; j < DIM; j += 1) m.A[i][j] = m.A[i][j] * FADE + (i === j ? LAMBDA * (1 - FADE) : 0) + x[i] * x[j];
    m.b[i] = m.b[i] * FADE + W0[i] * LAMBDA * (1 - FADE) + x[i] * yy;
  }
  const w = solve(m.A, m.b);
  if (w && w.every(num)) m.w = w.map((v) => r4(clip(v, 3)));
  m.n += 1;
  const st = m.stats;
  st.n += 1;
  if (date && !st.days.includes(date)) st.days = [...st.days, date].slice(-60);
  const score = (side, z) => {
    side.abs += Math.abs(yy - z);
    side.sq += (yy - z) ** 2;
    if (Math.abs(z) >= DIR_MIN && Math.abs(yy) >= DIR_MIN) {
      side.dirN += 1;
      if (Math.sign(z) === Math.sign(yy)) side.dirOk += 1;
    }
  };
  if (num(zb)) score(st.blend, zb);
  if (num(zs)) score(st.solo, zs);
}

/** The early calls' momentum reading as a band multiplier: a larger move building widens it, a quiet one narrows it. */
function volMultOf(early) {
  if (!early || !early.momentum) return 1;
  const { big, calm } = early.momentum;
  const b = big && num(big.p) && num(big.usual) ? big.p - big.usual : 0;
  const c = calm && num(calm.p) && num(calm.usual) ? calm.p - calm.usual : 0;
  return clamp(1 + (b - c), 0.85, 1.2);
}

module.exports = { HZ, KEYS, DIM, FEATURES, W0, LAMBDA, FADE, MIN_CHECKS, MIN_DAYS, MIN_GAIN, DIR_MIN, phi, emptyModel, emptyStats, solve, inputsOf, forecastOf, learn, provenOf, summaryOf, volMultOf };
