"use strict";
// The refiner (22 Nov 2026): a second stage after the consensus forecast (market/consensus.js) that adds what the desk's
// forecasters did not use yet — and every part of it leads only once its own checked record proves it. With no record it
// changes nothing: the consensus's own numbers are shown exactly as before.
//
//   1  THE TOP OF THE BOOK   the microprice — the mid-price weighted by the queues at the best bid and offer, a better guess
//                            of where the next trades happen than the last price (Stoikov, "The micro-price", Quantitative
//                            Finance 2018) — and the queue imbalance at the best prices (Gould & Bonart 2016; Cartea,
//                            Donnelly & Jaimungal 2018), plus the spread in the stock's usual moves (a wide spread makes a
//                            confident call less reliable).
//   2  TODAY'S VOLATILITY    the realized volatility of today's 5-minute returns, exponentially weighted (RiskMetrics' fast
//                            average; the HAR idea of Corsi 2009 that recent volatility forecasts the next), against the
//                            stock's usual move. A call made in a wild session is shrunk or stretched as far as the checks
//                            show it should be (Moreira & Muir 2017 on volatility-managed bets).
//   3  THE RESIDUAL MODEL    ridge regression of what the leading forecast MISSED (y − ẑ) on those inputs, pulled towards
//                            zero: with no evidence the refiner adds nothing; it moves only as far as its checks justify.
//   4  THE CONFORMAL BAND    a band made from the forecast's own recent misses instead of an assumed bell curve: locally
//                            adaptive split-conformal prediction (Lei, G'Sell, Rinaldo, Tibshirani & Wasserman 2018 — the
//                            misses scaled by today's volatility) with adaptive conformal inference (Gibbs & Candès 2021):
//                            after every check the miss level is nudged, so the band keeps its stated 70% even when the
//                            market changes character. Its coverage is MEASURED beside the old band's.
//   4b THE MULTI-DAY BAND    the same conformal band, a second time, with the misses scaled by the volatility the stock's last
//                            days forecast for now (market/volmodel.js: HAR-RV + the intraday pattern, updated by today's
//                            bars). It takes over from the today-only band only when it is as honest and clearly narrower.
//   5  THE OFF-FORM ALARM    the Page-Hinkley test (Page 1954; Gama et al. 2014, concept drift) on today's misses across
//                            every stock: a session on which the forecasts miss clearly more than usual (an event day, a
//                            regime break) is flagged, and the leans are capped at "slight" until the next session.
//
// Units: every move is in the stock's usual move for the horizon (σ·√h), as in market/consensus.js.
// Pure: no clock, no network, no records.

// The last two were added on 23 Nov 2026 from the trade setup (server/setup.js): the stock's futures build-up now (long build-up
// and short covering +, short build-up and long unwinding −, scaled by the OI change) and the market's setup lean. Like the others
// they start at zero weight and move only as far as the checks show they explain what the forecast missed.
const DIM = 7;
const OLD_DIM = 5;
const FEATURES = ["bias", "micro", "queue", "spreadXcall", "volXcall", "buildup", "setupLean"];
/** A list of inputs from before the setup inputs: padded with zeros (they said nothing then). */
const padX = (x) => (Array.isArray(x) && x.length === OLD_DIM ? [...x, 0, 0] : x);
const LAMBDA = 80; // the pull towards "add nothing", in checks' worth
const FADE = 0.9995;
const MIN_CHECKS = 150;
const MIN_DAYS = 5;
const MIN_GAIN = 0.02;
const DIR_MIN = 0.1;
const TARGET = 0.7; // the band's stated coverage (the consensus band is a 70% band)
const GAMMA = 0.005; // adaptive conformal inference's step
const KEEP_SCORES = 500;
const MIN_SCORES = 60;
const RV_LAMBDA = 0.85;
const Z70 = 1.0364;
const PH_DELTA = 0.2; // Page-Hinkley: the slack per check, as a share of the usual miss
const PH_LIMIT = 15; // …and the alarm level, in usual misses
const PH_MIN = 20; // checks today before an alarm can sound

const num = (x) => typeof x === "number" && Number.isFinite(x);
const clip = (x, a) => (x > a ? a : x < -a ? -a : x);
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const r4 = (x) => (num(x) ? Math.round(x * 10000) / 10000 : null);
const dot = (w, x) => w.reduce((s, wi, i) => s + wi * x[i], 0);

function phi(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

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

const emptyConf = () => ({ scores: [], alpha: 1 - TARGET, n: 0, inC: 0, inO: 0, nC: 0, wC: 0, wO: 0, sC: 0 });
/**
 * The interval score of a central band of half-width `half` for a miss `miss` (Gneiting & Raftery 2007, a proper scoring
 * rule): its width, plus 2/α times how far the outcome fell outside it. Lower is better: narrow, but not by missing.
 */
const intervalScore = (half, miss) => 2 * half + (2 / (1 - TARGET)) * Math.max(0, miss - half);
function emptyHorizon() {
  return {
    A: Array.from({ length: DIM }, (_, i) => Array.from({ length: DIM }, (__, j) => (i === j ? LAMBDA : 0))),
    b: new Array(DIM).fill(0),
    w: new Array(DIM).fill(0),
    n: 0,
    days: [],
    mean: { lead: { abs: 0, dirN: 0, dirOk: 0 }, refined: { abs: 0, dirN: 0, dirOk: 0 } },
    conf: { scores: [], alpha: 1 - TARGET, n: 0, inC: 0, inO: 0, nC: 0, wC: 0, wO: 0 },
    conf2: emptyConf(),
    drift: { usual: null, date: "", S: 0, M: 0, n: 0, sum: 0, alarm: false, at: null },
  };
}
function emptyModel() {
  return { version: 1, h: { 1: emptyHorizon(), 3: emptyHorizon() } };
}
function horizonOf(model, h) {
  const m = model && model.h ? model.h[h] || model.h[h <= 2 ? 1 : 3] : null;
  if (m && !m.conf2) m.conf2 = emptyConf(); // a model saved before the multi-day band
  if (m && Array.isArray(m.A) && m.A.length < DIM) {
    // a model saved before the setup inputs: the new inputs join at the prior (zero weight, the usual pull)
    const n0 = m.A.length;
    m.A = Array.from({ length: DIM }, (_, i) => Array.from({ length: DIM }, (__, j) => (i < n0 && j < n0 ? m.A[i][j] : i === j ? LAMBDA : 0)));
    m.b = [...m.b, ...new Array(DIM - n0).fill(0)];
    m.w = [...m.w, ...new Array(DIM - n0).fill(0)];
  }
  return m;
}

/**
 * Today's realized volatility against the usual: the exponentially weighted mean of the squared 5-minute returns, over the
 * usual 5-minute move squared. 1 is an ordinary session; 2 is twice the usual variance. Null with fewer than 3 bars.
 */
function volRatio(bars, sigmaPct) {
  if (!Array.isArray(bars) || bars.length < 3 || !num(sigmaPct) || sigmaPct <= 0) return null;
  const s2 = (sigmaPct / 100) ** 2;
  let v = s2;
  let prev = null;
  for (const b of bars) {
    if (!b || !num(b.c) || b.c <= 0) continue;
    const from = prev !== null ? prev : num(b.o) && b.o > 0 ? b.o : null;
    if (from !== null) {
      const r = Math.log(b.c / from);
      v = RV_LAMBDA * v + (1 - RV_LAMBDA) * r * r;
    }
    prev = b.c;
  }
  return r4(clamp(v / s2, 0.1, 10));
}
/** The scale the misses are measured against: √(volatility ratio), bounded. */
const scaleOf = (ratio) => (num(ratio) ? clamp(Math.sqrt(ratio), 0.6, 2.5) : 1);

/**
 * The refiner's inputs for one horizon.
 * @param q      the live quote: bid, ask, bidQty, askQty (the best prices and their queues)
 * @param price  the price the forecast starts from
 * @param s      the usual move for the horizon, in percent (σ·√h)
 * @param zl     the leading forecast's move, in usual moves
 * @param ratio  today's volatility ratio (volRatio)
 */
function inputsOf({ q = null, price, s, zl, ratio = null, buildup = 0, setupLean = 0 }) {
  if (!num(price) || price <= 0 || !num(s) || s <= 0 || !num(zl)) return null;
  let micro = 0;
  let queue = 0;
  let spread = 0;
  const top = q && num(q.bid) && num(q.ask) && q.bid > 0 && q.ask >= q.bid && num(q.bidQty) && num(q.askQty) && q.bidQty + q.askQty > 0;
  if (top) {
    const mid = (q.bid + q.ask) / 2;
    const mp = (q.bid * q.askQty + q.ask * q.bidQty) / (q.bidQty + q.askQty);
    micro = clip(((mp - mid) / price) * 100 / s, 2);
    queue = clip((q.bidQty - q.askQty) / (q.bidQty + q.askQty), 1);
    spread = clamp(((q.ask - q.bid) / price) * 100 / s, 0, 2);
  }
  const lv = num(ratio) ? clip(Math.log(ratio), 1.5) : 0;
  return {
    x: [1, r4(micro), r4(queue), r4(clip(zl, 4) * spread), r4(clip(zl, 4) * lv), r4(num(buildup) ? clip(buildup, 1) : 0), r4(num(setupLean) ? clip(setupLean, 1) : 0)],
    top: top ? { bid: q.bid, ask: q.ask, bidQty: q.bidQty, askQty: q.askQty, microprice: Math.round(((q.bid * q.askQty + q.ask * q.bidQty) / (q.bidQty + q.askQty)) * 100) / 100 } : null,
  };
}

/** The q-th quantile of a list (the conformal rank: ⌈(n+1)q⌉-th smallest). */
function conformalQuantile(list, q) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const k = Math.min(s.length - 1, Math.max(0, Math.ceil((s.length + 1) * q) - 1));
  return s[k];
}

/** Has the residual model earned the lead? */
function meanProven(m) {
  if (!m || m.n < MIN_CHECKS || (m.days || []).length < MIN_DAYS) return false;
  const L = m.mean.lead;
  const R = m.mean.refined;
  const dirL = L.dirN ? L.dirOk / L.dirN : 0;
  const dirR = R.dirN ? R.dirOk / R.dirN : 0;
  return R.abs <= L.abs * (1 - MIN_GAIN) && dirR >= dirL - 0.01;
}

/** Has a conformal band (`c`) earned the lead: closer to its stated 70% than the old band, or as honest and narrower? */
function confProven(m, c) {
  if (!c || c.nC < MIN_CHECKS || (m.days || []).length < MIN_DAYS) return false;
  const covC = c.inC / c.nC;
  const covO = c.inO / c.nC;
  const errC = Math.abs(covC - TARGET);
  const errO = Math.abs(covO - TARGET);
  // …or as honest, with a clearly better interval score than the old band (an adaptive band can be better without being narrower on average)
  const scoreBetter = c.sO > 0 && errC <= 0.03 && (c.sC || 0) <= c.sO * 0.98;
  return errC + 0.02 <= errO || (errC <= 0.03 && errO <= 0.05 && c.wC < c.wO * 0.97) || scoreBetter;
}
/** The today-only conformal band. */
const bandProven = (m) => Boolean(m && confProven(m, m.conf));
/**
 * Which band leads: "multi" (misses scaled by the multi-day volatility) when proven and, if the today-only band is proven
 * too, at least 2% narrower without holding worse; "today"; or null (the consensus's own band).
 */
function bandChoice(m) {
  if (!m) return null;
  const a = confProven(m, m.conf);
  const c2 = m.conf2;
  const b = c2 && confProven(m, c2);
  if (b) {
    if (!a) return "multi";
    // compared by the interval score (a band that adapts may be wider on average yet better: narrow where calm, wide where wild)
    const s1 = (m.conf.sC || 0) / m.conf.nC;
    const s2 = (c2.sC || 0) / c2.nC;
    const e1 = Math.abs(m.conf.inC / m.conf.nC - TARGET);
    const e2 = Math.abs(c2.inC / c2.nC - TARGET);
    if (s1 > 0 && s2 <= s1 * 0.98 && e2 <= e1 + 0.01) return "multi";
  }
  return a ? "today" : null;
}

/** Is today flagged off-form at this horizon? */
const offFormOf = (m, date) => Boolean(m && m.drift && m.drift.alarm && m.drift.date === date);

/**
 * The refined forecast at one horizon.
 * @param zl    the leading forecast's move (usual moves)
 * @param ho    the leading forecast's band half-width (usual moves)
 * @param scale today's volatility scale (scaleOf)
 * @returns { zr, zShown, half, halfConformal, pUp, leads: { mean, band }, offForm, adds }
 */
function forecastOf(model, h, { x, zl, ho, scale = 1, scale2 = null, date = "" }) {
  const m = horizonOf(model, h);
  x = padX(x);
  if (!m || !Array.isArray(x) || x.length !== DIM || !num(zl)) return null;
  const adds = clip(dot(m.w, x), 1.5);
  const zr = clip(zl + adds, 4);
  const lm = meanProven(m);
  const zShown = lm ? zr : zl;
  const q = m.conf.scores.length >= MIN_SCORES ? conformalQuantile(m.conf.scores, clamp(1 - m.conf.alpha, 0.3, 0.97)) : null;
  const halfConformal = num(q) ? r4(q * scale) : null;
  const c2 = m.conf2;
  const q2 = num(scale2) && c2.scores.length >= MIN_SCORES ? conformalQuantile(c2.scores, clamp(1 - c2.alpha, 0.3, 0.97)) : null;
  const halfMulti = num(q2) ? r4(q2 * scale2) : null;
  const choice = bandChoice(m);
  const bandBy = choice === "multi" && num(halfMulti) ? "multi" : choice && num(halfConformal) ? "today" : null;
  const lb = Boolean(bandBy);
  const half = bandBy === "multi" ? halfMulti : bandBy === "today" ? halfConformal : num(ho) ? ho : Z70;
  const sd = Math.max(half / Z70, 0.2);
  return {
    zr: r4(zr),
    zShown: r4(zShown),
    half: r4(half),
    halfConformal,
    halfMulti,
    pUp: r4(phi(zShown / sd)),
    leads: { mean: lm, band: lb, bandBy },
    offForm: offFormOf(m, date),
    adds: r4(adds),
    contributions: FEATURES.map((f, i) => ({ input: f, value: x[i], weight: r4(m.w[i]), adds: r4(m.w[i] * x[i]) })),
  };
}

/**
 * Learn one checked forecast. `kept` is what was stored with the forecast: { x, zl, zs (the centre shown), scale, hc (the
 * conformal half then, or null), ho (the old half) }; y is the move that happened. Mutates the model.
 */
function learn(model, h, kept, y, { date = "" } = {}) {
  const m = horizonOf(model, h);
  if (kept && Array.isArray(kept.x)) kept = { ...kept, x: padX(kept.x) };
  if (!m || !kept || !Array.isArray(kept.x) || kept.x.length !== DIM || !num(y) || !num(kept.zl)) return;
  const yy = clip(y, 8);
  const x = kept.x;
  const res = yy - kept.zl;
  // 3 the residual model: what the leading forecast missed, on the refiner's inputs (pulled to zero; old checks fade)
  for (let i = 0; i < DIM; i += 1) {
    for (let j = 0; j < DIM; j += 1) m.A[i][j] = m.A[i][j] * FADE + (i === j ? LAMBDA * (1 - FADE) : 0) + x[i] * x[j];
    m.b[i] = m.b[i] * FADE + x[i] * res;
  }
  const zrThen = num(kept.zr) ? kept.zr : kept.zl + dot(m.w, x);
  const w = solve(m.A, m.b);
  if (w && w.every(num)) m.w = w.map((v) => r4(clip(v, 2)));
  m.n += 1;
  if (date && !m.days.includes(date)) m.days = [...m.days, date].slice(-60);
  const score = (side, z) => {
    side.abs += Math.abs(yy - z);
    if (Math.abs(z) >= DIR_MIN && Math.abs(yy) >= DIR_MIN) {
      side.dirN += 1;
      if (Math.sign(z) === Math.sign(yy)) side.dirOk += 1;
    }
  };
  score(m.mean.lead, kept.zl);
  score(m.mean.refined, zrThen);
  // 4 the conformal band: the miss of the centre shown, scaled by the day's volatility, joins the list; the level is nudged
  const centre = num(kept.zs) ? kept.zs : kept.zl;
  const miss = Math.abs(yy - centre);
  const scale = num(kept.scale) && kept.scale > 0 ? kept.scale : 1;
  const c = m.conf;
  c.scores.push(r4(miss / scale));
  if (c.scores.length > KEEP_SCORES) c.scores.splice(0, c.scores.length - KEEP_SCORES);
  c.n += 1;
  if (num(kept.hc) && kept.hc > 0 && num(kept.ho) && kept.ho > 0) {
    const outC = miss > kept.hc;
    c.alpha = clamp(c.alpha + GAMMA * ((1 - TARGET) - (outC ? 1 : 0)), 0.03, 0.7); // Gibbs & Candès: α ← α + γ(α* − err)
    c.nC += 1;
    if (!outC) c.inC += 1;
    if (Math.abs(yy - kept.zl) <= kept.ho) c.inO += 1;
    c.wC += kept.hc;
    c.wO += kept.ho;
    c.sC = (c.sC || 0) + intervalScore(kept.hc, miss);
    c.sO = (c.sO || 0) + intervalScore(kept.ho, Math.abs(yy - kept.zl));
  }
  // 4b the multi-day band: the same, with the misses scaled by the multi-day volatility forecast
  if (num(kept.scale2) && kept.scale2 > 0) {
    const c2 = m.conf2 || (m.conf2 = emptyConf());
    c2.scores.push(r4(miss / kept.scale2));
    if (c2.scores.length > KEEP_SCORES) c2.scores.splice(0, c2.scores.length - KEEP_SCORES);
    c2.n += 1;
    if (num(kept.hc2) && kept.hc2 > 0 && num(kept.ho) && kept.ho > 0) {
      const out2 = miss > kept.hc2;
      c2.alpha = clamp(c2.alpha + GAMMA * ((1 - TARGET) - (out2 ? 1 : 0)), 0.03, 0.7);
      c2.nC += 1;
      if (!out2) c2.inC += 1;
      if (Math.abs(yy - kept.zl) <= kept.ho) c2.inO += 1;
      c2.wC += kept.hc2;
      c2.wO += kept.ho;
      c2.sC = (c2.sC || 0) + intervalScore(kept.hc2, miss);
      c2.sO = (c2.sO || 0) + intervalScore(kept.ho, Math.abs(yy - kept.zl));
    }
  }
  // 5 the off-form alarm: Page-Hinkley on today's misses against the usual miss
  const d = m.drift;
  if (d.date !== date) Object.assign(d, { date, S: 0, M: 0, n: 0, sum: 0, alarm: false, at: null });
  if (d.usual === null) d.usual = miss;
  d.n += 1;
  d.sum += miss;
  d.S += miss - d.usual - PH_DELTA * d.usual;
  d.M = Math.min(d.M, d.S);
  if (!d.alarm && d.n >= PH_MIN && d.S - d.M > PH_LIMIT * d.usual) {
    d.alarm = true;
    d.at = d.n;
  }
  d.usual = r4(d.usual + 0.002 * (miss - d.usual)); // the usual miss follows slowly
  d.S = r4(d.S);
  d.M = r4(d.M);
  d.sum = r4(d.sum);
}

/** The refiner's record at one horizon, for the screen and the skills file. */
function summaryOf(m, date = "") {
  if (!m || !m.n) return { checks: 0, days: 0, mean: { proven: false }, band: { proven: false }, offForm: false };
  const c = m.conf;
  const L = m.mean.lead;
  const R = m.mean.refined;
  return {
    checks: m.n,
    days: (m.days || []).length,
    mean: { proven: meanProven(m), missLead: r4(L.abs / m.n), missRefined: r4(R.abs / m.n), dirLead: L.dirN ? r4(L.dirOk / L.dirN) : null, dirRefined: R.dirN ? r4(R.dirOk / R.dirN) : null, gain: L.abs > 0 ? r4(1 - R.abs / L.abs) : null },
    band: { proven: bandProven(m), stated: TARGET, checks: c.nC, coverage: c.nC ? r4(c.inC / c.nC) : null, oldCoverage: c.nC ? r4(c.inO / c.nC) : null, width: c.nC ? r4(c.wC / c.nC) : null, score: c.nC ? r4((c.sC || 0) / c.nC) : null, oldWidth: c.nC ? r4(c.wO / c.nC) : null, level: r4(1 - c.alpha) },
    band2: m.conf2 && m.conf2.nC ? { proven: confProven(m, m.conf2), checks: m.conf2.nC, coverage: r4(m.conf2.inC / m.conf2.nC), width: r4(m.conf2.wC / m.conf2.nC), score: r4((m.conf2.sC || 0) / m.conf2.nC), level: r4(1 - m.conf2.alpha) } : { proven: false, checks: 0 },
    bandBy: bandChoice(m),
    offForm: offFormOf(m, date),
    today: m.drift && m.drift.date === date && m.drift.n ? { checks: m.drift.n, missAvg: r4(m.drift.sum / m.drift.n), usual: m.drift.usual } : null,
    weights: Object.fromEntries(FEATURES.map((f, i) => [f, m.w[i]])),
  };
}

module.exports = { DIM, OLD_DIM, padX, FEATURES, LAMBDA, FADE, MIN_CHECKS, MIN_DAYS, MIN_SCORES, TARGET, GAMMA, KEEP_SCORES, PH_MIN, emptyModel, emptyHorizon, horizonOf, volRatio, scaleOf, inputsOf, intervalScore, conformalQuantile, forecastOf, learn, meanProven, bandProven, confProven, bandChoice, offFormOf, summaryOf, phi };
