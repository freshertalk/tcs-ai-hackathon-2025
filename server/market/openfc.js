"use strict";
// Where will this stock OPEN? The arithmetic of the opening-price forecast (no I/O here: server/open-forecast.js
// gathers the inputs, keeps the record and runs the clock).
//
// The opening price is set by one auction (9:00–9:08). What can be known before it:
//   · how the index is expected to open (GIFT Nifty against the Nifty future, the overseas cues: the desk's
//     own market forecast) — the single biggest input for most stocks
//   · how THIS stock's opens have followed the index's opens (its "beta" to the gap), measured on its own history
//   · what the stock did yesterday: its day's return, where it closed in the day's range, yesterday's own gap,
//     and what the index did — a small regression measured on the stock's own last year of sessions
//   · the softer evidence: the chart's lean, the AI research's lean, the option chain's bias (open interest),
//     the news mood. These only tilt the estimate, by an amount that is LEARNED from how much they have
//     actually helped
//
// Four estimates ("experts") are made from these and blended:
//   flat      it opens at the previous close (the baseline every other estimate must beat)
//   index     alpha + beta × the expected index gap
//   pattern   the regression on yesterday's behaviour and the expected index gap
//   signals   pattern + the tilt from the softer evidence
// The blend's weights are learned from the record: every scored forecast shows which expert was closest, and
// the weights follow the experts' recent average miss. Three more things are learned from the record:
// a per-stock bias (it keeps opening higher than forecast → raise the next one), the bias of the index cue
// itself, and the width of the band (so that about 70% of opens fall inside it).
//
// Nothing here is a promise: an opening price depends on overnight news nobody has seen yet.

const TICK = 0.05;
const Z70 = 1.04; // a normal error's 70% interval is ±1.04 standard deviations
const PRIOR = { flat: 0.06, index: 0.34, pattern: 0.4, signals: 0.2 };
const EXPERTS = Object.keys(PRIOR);
const TILT_K = 0.25; // how far full agreement of the soft evidence moves the estimate, in units of the stock's normal gap
const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const r4 = (x) => (num(x) ? Math.round(x * 10000) / 10000 : null);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const pct = (a, b) => (num(a) && num(b) && b > 0 ? (a / b - 1) * 100 : null);
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const sdOf = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};
const onTick = (x) => (num(x) ? r2(Math.round(x / TICK) * TICK) : null);
const quantile = (xs, q) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = clamp((s.length - 1) * q, 0, s.length - 1);
  const lo = Math.floor(i);
  return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (i - lo);
};
const GAP_CAP = 8; // a gap beyond ±8% is a corporate action or a one-off: it teaches nothing about a normal morning

/**
 * One row per session of the stock's history: the gap it opened with and what was known the evening before.
 * @param daily  [{ t, o, h, l, c }] completed sessions, oldest first
 * @param nifty  the index's daily bars, or null
 */
function sessions(daily, nifty) {
  const nIdx = new Map((Array.isArray(nifty) ? nifty : []).map((c, i) => [String(c.t).slice(0, 10), i]));
  const rows = [];
  for (let i = 2; i < daily.length; i += 1) {
    const cur = daily[i];
    const prev = daily[i - 1];
    const prev2 = daily[i - 2];
    const gap = pct(cur.o, prev.c);
    if (!num(gap) || Math.abs(gap) > GAP_CAP) continue;
    const j = nIdx.get(String(cur.t).slice(0, 10));
    const nGap = j > 0 ? pct(nifty[j].o, nifty[j - 1].c) : null;
    rows.push({
      t: String(cur.t).slice(0, 10),
      gap,
      prevRet: clamp(pct(prev.c, prev2.c) || 0, -10, 10),
      closeLoc: prev.h > prev.l ? ((prev.c - prev.l) / (prev.h - prev.l)) * 2 - 1 : 0,
      prevGap: clamp(pct(prev.o, prev2.c) || 0, -GAP_CAP, GAP_CAP),
      nGap: num(nGap) && Math.abs(nGap) <= GAP_CAP ? nGap : null,
      nPrevRet: j > 1 ? clamp(pct(nifty[j - 1].c, nifty[j - 2].c) || 0, -10, 10) : 0,
    });
  }
  return rows;
}

/** What is known tonight for tomorrow's open: the same fields as a row, without the gap. */
function tonight(daily, nifty) {
  const L = daily[daily.length - 1];
  const L1 = daily[daily.length - 2];
  const n = Array.isArray(nifty) && nifty.length >= 2 ? nifty : null;
  return {
    prevClose: L.c,
    prevDate: String(L.t).slice(0, 10),
    prevRet: L1 ? clamp(pct(L.c, L1.c) || 0, -10, 10) : 0,
    closeLoc: L.h > L.l ? ((L.c - L.l) / (L.h - L.l)) * 2 - 1 : 0,
    prevGap: L1 ? clamp(pct(L.o, L1.c) || 0, -GAP_CAP, GAP_CAP) : 0,
    nPrevRet: n ? clamp(pct(n[n.length - 1].c, n[n.length - 2].c) || 0, -10, 10) : 0,
  };
}

/** gap = alpha + beta × index gap, on the sessions that have an index gap. Shrunk toward beta 1, alpha 0 when thin. */
function fitIndex(rows) {
  const use = rows.filter((r) => num(r.nGap)).slice(-250);
  if (use.length < 30) return { alpha: 0, beta: 1, sd: Math.max(sdOf(rows.slice(-250).map((r) => r.gap)), 0.3) || 0.6, n: use.length, measured: false };
  const xs = use.map((r) => r.nGap);
  const ys = use.map((r) => r.gap);
  const mx = mean(xs);
  const my = mean(ys);
  const vx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  let beta = vx > 0 ? xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / vx : 1;
  beta = clamp((use.length * beta + 20) / (use.length + 20), 0, 3);
  const alpha = clamp((my - beta * mx) * (use.length / (use.length + 60)), -0.3, 0.3);
  const res = ys.map((y, i) => y - (alpha + beta * xs[i]));
  return { alpha, beta, sd: Math.max(Math.sqrt(res.reduce((s, x) => s + x * x, 0) / Math.max(1, res.length - 2)), 0.12), n: use.length, measured: true };
}

const FEATURES = ["nGap", "prevRet", "closeLoc", "prevGap", "nPrevRet"];

/** Solve A·w = b for a small symmetric system (Gaussian elimination with pivoting). */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c += 1) {
    let p = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r += 1) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k += 1) M[r][k] -= f * M[c][k];
    }
  }
  const w = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r -= 1) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k += 1) s -= M[r][k] * w[k];
    w[r] = s / M[r][r];
  }
  return w;
}

/**
 * A ridge regression of the gap on what was known the evening before plus the index's gap.
 * Features are standardised, so one penalty suits them all and no single noisy feature can run away.
 */
function fitPattern(rows, { lambda = 6 } = {}) {
  const use = rows.filter((r) => num(r.nGap)).slice(-250);
  if (use.length < 60) return null;
  const mu = FEATURES.map((f) => mean(use.map((r) => r[f])));
  const sg = FEATURES.map((f, k) => sdOf(use.map((r) => r[f])) || 1);
  const X = use.map((r) => FEATURES.map((f, k) => (r[f] - mu[k]) / sg[k]));
  const my = mean(use.map((r) => r.gap));
  const y = use.map((r) => r.gap - my);
  const p = FEATURES.length;
  const A = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => X.reduce((s, x) => s + x[i] * x[j], 0) + (i === j ? lambda : 0)));
  const b = Array.from({ length: p }, (_, i) => X.reduce((s, x, n) => s + x[i] * y[n], 0));
  const w = solve(A, b);
  if (!w) return null;
  const res = X.map((x, n) => y[n] - x.reduce((s, v, k) => s + v * w[k], 0));
  return { w, mu, sg, intercept: my, sd: Math.max(Math.sqrt(res.reduce((s, x) => s + x * x, 0) / Math.max(1, res.length - p - 1)), 0.12), n: use.length };
}

const applyPattern = (fit, x) => fit.intercept + FEATURES.reduce((s, f, k) => s + ((x[f] - fit.mu[k]) / fit.sg[k]) * fit.w[k], 0);

/**
 * The soft evidence as one number between −1 and +1, with what went into it.
 * @param s { chart, research, options, news } each a score −100…+100 (or null when not available)
 */
function tiltOf(s = {}) {
  const W = { chart: 1, research: 1.5, options: 1, news: 0.7 };
  const parts = [];
  let sum = 0;
  let wsum = 0;
  for (const k of Object.keys(W)) {
    if (!num(s[k])) continue;
    const v = clamp(s[k] / 100, -1, 1);
    parts.push({ name: k, score: Math.round(v * 100), weight: W[k] });
    sum += v * W[k];
    wsum += W[k];
  }
  // one voice alone is not agreement: the tilt is scaled by how much of the evidence is present
  const score = wsum ? (sum / wsum) * Math.min(1, wsum / 2.5) : 0;
  return { score: r4(score), parts };
}

/** What has been learned so far, with the starting values for a desk that has learned nothing yet. */
function emptyLearning() {
  return { n: 0, weights: { ...PRIOR }, bySymbol: {}, cueBias: 0, cueMae: null, cueN: 0, bandScale: 1, tiltK: TILT_K, stats: null, updatedAt: null };
}

/**
 * The forecast for one stock.
 * @param daily     completed daily bars, oldest first (the last one is the previous close)
 * @param nifty     the index's daily bars (null for the index itself, or when there are none)
 * @param cue       { gapPct, source, basis } the expected gap of the index this morning (gapPct null: no cue)
 * @param soft      { chart, research, options, news } scores −100…+100, any may be missing
 * @param learned   the learning record (emptyLearning() at first)
 * @param isIndex   the symbol IS the index: its open is the cue itself
 */
function forecastOpen({ symbol, daily, nifty = null, cue = null, soft = {}, learned = null, isIndex = false }) {
  if (!Array.isArray(daily) || daily.length < 3) return { available: false, reason: "Too little price history for this stock to forecast its open." };
  const L = learned || emptyLearning();
  const rows = sessions(daily, isIndex ? null : nifty);
  const x = tonight(daily, isIndex ? null : nifty);
  const ownSd = Math.max(sdOf(rows.slice(-250).map((r) => r.gap)), 0.15) || 0.6;
  const cueRaw = cue && num(cue.gapPct) ? cue.gapPct : null;
  const cueAdj = num(cueRaw) ? cueRaw - (L.cueBias || 0) : null; // the cue's own measured bias is taken out
  const cueUsed = num(cueAdj) ? cueAdj : 0;

  const experts = { flat: 0 };
  let fit = null;
  let pat = null;
  if (isIndex) {
    experts.index = cueUsed;
  } else {
    fit = fitIndex(rows);
    experts.index = fit.alpha + fit.beta * cueUsed;
    pat = fitPattern(rows);
    if (pat) experts.pattern = applyPattern(pat, { ...x, nGap: cueUsed });
  }
  const tilt = tiltOf(soft);
  const base = num(experts.pattern) ? experts.pattern : experts.index;
  if (tilt.parts.length) experts.signals = base + (L.tiltK ?? TILT_K) * tilt.score * ownSd;

  // the blend: the learned weights of the experts that could speak, re-normalised
  const w = {};
  let wsum = 0;
  for (const k of EXPERTS) {
    if (!num(experts[k])) continue;
    w[k] = Math.max(0.02, num((L.weights || {})[k]) ? L.weights[k] : PRIOR[k]);
    wsum += w[k];
  }
  for (const k of Object.keys(w)) w[k] = r4(w[k] / wsum);
  const blended = Object.keys(w).reduce((s, k) => s + w[k] * experts[k], 0);
  const mine = (L.bySymbol || {})[symbol] || null;
  const bias = mine && num(mine.bias) ? mine.bias : 0; // it has been opening higher (+) or lower (−) than forecast
  const gapPct = clamp(blended + bias, -GAP_CAP, GAP_CAP);

  const sd = isIndex ? Math.max(num(L.cueMae) ? L.cueMae * 1.25 : ownSd, 0.12) : pat ? pat.sd : fit.sd;
  // without a cue for the index, its whole normal gap is unknown too: the band is the stock's own spread of opens
  const sdUsed = num(cueAdj) ? sd : Math.max(sd, ownSd);
  const halfRaw = Z70 * sdUsed;
  const half = halfRaw * clamp(num(L.bandScale) ? L.bandScale : 1, 0.5, 3);
  const prev = x.prevClose;
  const price = (g) => onTick(prev * (1 + g / 100));
  const exp = Object.fromEntries(Object.entries(experts).map(([k, v]) => [k, r4(v)]));
  return {
    available: true,
    symbol,
    prevClose: prev,
    prevDate: x.prevDate,
    gapPct: r4(gapPct),
    predicted: price(gapPct),
    band: { low: price(gapPct - half), high: price(gapPct + half), halfPct: r4(half), halfRaw: r4(halfRaw) },
    experts: exp,
    weights: w,
    bias: r4(bias),
    cue: { gapPct: r4(cueRaw), usedPct: r4(cueAdj), source: (cue && cue.source) || "none", basis: (cue && cue.basis) || "" },
    tilt,
    fit: isIndex ? null : { beta: r2(fit.beta), alpha: r4(fit.alpha), n: fit.n, sd: r4(sdUsed), pattern: Boolean(pat), ownSd: r4(ownSd) },
    usualMissPct: r2(mine && mine.n >= 8 && num(mine.mae) ? mine.mae : 0.8 * sdUsed),
  };
}

/**
 * How the model would have done on this stock's last sessions, forecasting each from only the sessions before it and
 * GIVEN the index's real gap (so this measures the stock's part of the problem, not the index cue).
 */
function walkForward(daily, nifty, { sessions: count = 120 } = {}) {
  const rows = sessions(daily, nifty).filter((r) => num(r.nGap));
  if (rows.length < 90) return null;
  const from = Math.max(60, rows.length - count);
  const errs = [];
  const flat = [];
  let inside = 0;
  let dirN = 0;
  let dirHit = 0;
  for (let k = from; k < rows.length; k += 1) {
    const past = rows.slice(Math.max(0, k - 250), k);
    const pat = fitPattern(past);
    const ix = fitIndex(past);
    const r = rows[k];
    const pred = pat ? 0.55 * applyPattern(pat, r) + 0.45 * (ix.alpha + ix.beta * r.nGap) : ix.alpha + ix.beta * r.nGap;
    const sd = pat ? pat.sd : ix.sd;
    errs.push(Math.abs(pred - r.gap));
    flat.push(Math.abs(r.gap));
    if (Math.abs(pred - r.gap) <= Z70 * sd) inside += 1;
    if (Math.abs(pred) >= 0.1 && Math.abs(r.gap) >= 0.05) {
      dirN += 1;
      if (Math.sign(pred) === Math.sign(r.gap)) dirHit += 1;
    }
  }
  const n = errs.length;
  return { sessions: n, maePct: r2(mean(errs)), flatMaePct: r2(mean(flat)), betterPct: mean(flat) > 0 ? Math.round((1 - mean(errs) / mean(flat)) * 100) : 0, insidePct: Math.round((inside / n) * 100), directionPct: dirN ? Math.round((dirHit / dirN) * 100) : null, directionN: dirN };
}

/**
 * Read the record and learn from it.
 * @param records  every scored forecast: { symbol, date, gapPct, experts, band: { halfRaw }, tilt: { score }, fit: { ownSd },
 *                 actual: { gapPct }, cue: { gapPct }, isIndex }
 * @returns the learning record (weights, per-stock bias, the cue's bias, the band's scale, the tilt's worth, the score so far)
 */
function learnFrom(records, { now = Date.now() } = {}) {
  const L = emptyLearning();
  const scored = records.filter((r) => r && r.actual && num(r.actual.gapPct) && num(r.gapPct)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const stocks = scored.filter((r) => !r.isIndex);
  const idx = scored.filter((r) => r.isIndex);
  L.updatedAt = new Date(now).toISOString();
  L.n = stocks.length;

  // the index cue: how far off, and which way, it has been
  const cues = idx.filter((r) => r.cue && num(r.cue.gapPct)).slice(-30);
  if (cues.length) {
    const e = cues.map((r) => r.cue.gapPct - r.actual.gapPct);
    L.cueN = cues.length;
    L.cueBias = r4(clamp(mean(e) * (cues.length / (cues.length + 6)), -0.4, 0.4));
    L.cueMae = r4(mean(e.map(Math.abs)));
  }
  if (!stocks.length) return L;
  const recent = stocks.slice(-200);

  // the experts: the weight follows the recent average miss (a softmax over −miss), pulled toward the start values while the record is thin
  const mae = {};
  for (const k of EXPERTS) {
    const e = recent.filter((r) => r.experts && num(r.experts[k])).map((r) => Math.abs(r.experts[k] - r.actual.gapPct));
    if (e.length >= 5) mae[k] = mean(e);
  }
  const have = Object.keys(mae);
  if (have.length >= 2) {
    const best = Math.min(...have.map((k) => mae[k]));
    const raw = {};
    let sum = 0;
    for (const k of have) {
      raw[k] = Math.exp(-(mae[k] - best) / 0.12);
      sum += raw[k];
    }
    const n = recent.length;
    let total = 0;
    for (const k of EXPERTS) {
      const learnedW = have.includes(k) ? raw[k] / sum : PRIOR[k];
      L.weights[k] = (n * learnedW + 15 * PRIOR[k]) / (n + 15);
      total += L.weights[k];
    }
    for (const k of EXPERTS) L.weights[k] = r4(L.weights[k] / total);
  }
  L.expertMae = Object.fromEntries(Object.entries(mae).map(([k, v]) => [k, r4(v)]));

  // each stock: its own bias and usual miss (the last 20 scored)
  const by = new Map();
  for (const r of stocks) by.set(r.symbol, [...(by.get(r.symbol) || []), r]);
  for (const [sym, list] of by) {
    const last = list.slice(-20);
    // the bias is measured on what the blend said BEFORE its own bias was added, or it would chase itself
    const e = last.map((r) => r.actual.gapPct - (r.gapPct - (num(r.bias) ? r.bias : 0)));
    const n = last.length;
    L.bySymbol[sym] = { n, bias: r4(clamp(mean(e) * (n / (n + 6)), -0.6, 0.6)), mae: r4(mean(last.map((r) => Math.abs(r.gapPct - r.actual.gapPct)))), last: last[last.length - 1].date };
  }

  // the band: scaled so that about 70% of opens fall inside
  const ratios = recent.filter((r) => r.band && num(r.band.halfRaw) && r.band.halfRaw > 0).map((r) => Math.abs(r.gapPct - r.actual.gapPct) / r.band.halfRaw);
  if (ratios.length >= 15) {
    const q = quantile(ratios, 0.7);
    L.bandScale = r4(clamp((ratios.length * q + 20) / (ratios.length + 20), 0.6, 2.5));
  }

  // the soft evidence: how much of the remaining miss it explains, in units of the stock's normal gap
  const tl = recent.filter((r) => r.tilt && num(r.tilt.score) && r.tilt.score !== 0 && r.fit && num(r.fit.ownSd) && r.experts && num(r.experts.pattern ?? r.experts.index));
  if (tl.length >= 12) {
    let sxy = 0;
    let sxx = 0;
    for (const r of tl) {
      const xv = r.tilt.score * r.fit.ownSd;
      const res = r.actual.gapPct - (r.experts.pattern ?? r.experts.index);
      sxy += xv * res;
      sxx += xv * xv;
    }
    if (sxx > 0) L.tiltK = r4(clamp((tl.length * clamp(sxy / sxx, 0, 0.8) + 30 * TILT_K) / (tl.length + 30), 0, 0.8));
  }

  // the score so far
  const errs = recent.map((r) => Math.abs(r.gapPct - r.actual.gapPct));
  const flat = recent.map((r) => Math.abs(r.actual.gapPct));
  const dir = recent.filter((r) => Math.abs(r.gapPct) >= 0.1 && Math.abs(r.actual.gapPct) >= 0.05);
  const inside = recent.filter((r) => r.band && num(r.band.halfPct) && Math.abs(r.gapPct - r.actual.gapPct) <= r.band.halfPct);
  const half = Math.floor(recent.length / 2);
  L.stats = {
    n: recent.length,
    days: new Set(recent.map((r) => r.date)).size,
    maePct: r2(mean(errs)),
    flatMaePct: r2(mean(flat)),
    betterPct: mean(flat) > 0 ? Math.round((1 - mean(errs) / mean(flat)) * 100) : 0,
    insidePct: Math.round((inside.length / recent.length) * 100),
    directionPct: dir.length ? Math.round((dir.filter((r) => Math.sign(r.gapPct) === Math.sign(r.actual.gapPct)).length / dir.length) * 100) : null,
    directionN: dir.length,
    // is it getting better? the older half of the record against the newer half
    trend: recent.length >= 20 ? { earlierMaePct: r2(mean(errs.slice(0, half))), laterMaePct: r2(mean(errs.slice(half))) } : null,
  };
  return L;
}

/** The record's findings in plain sentences, for the trading-skills file every AI feature reads. */
function lessonsOf(L) {
  const out = [];
  const s = L && L.stats;
  if (!s || s.n < 10) return out;
  out.push(`Opening-price forecasts scored so far: ${s.n} over ${s.days} sessions. Average miss ${s.maePct}% of the price (assuming "opens at the previous close" would have missed by ${s.flatMaePct}%); ${s.insidePct}% of opens fell inside the forecast band (the aim is about 70%).`);
  if (num(s.directionPct) && s.directionN >= 10) out.push(`When the forecast called a gap of 0.1% or more, the open went that way ${s.directionPct}% of the time (${s.directionN} cases). A forecast gap is a lean for the first minutes, not for the day.`);
  if (L.cueN >= 8 && num(L.cueMae)) out.push(`The index cue (GIFT Nifty and the overseas markets) has missed the Nifty's real opening gap by ${r2(L.cueMae)}% on average${Math.abs(L.cueBias) >= 0.03 ? `, reading ${L.cueBias > 0 ? "too high" : "too low"} by about ${r2(Math.abs(L.cueBias))}%` : ""}.`);
  if (s.trend) out.push(`The forecast's miss was ${s.trend.earlierMaePct}% in the older half of its record and ${s.trend.laterMaePct}% in the newer half.`);
  const off = Object.entries(L.bySymbol || {}).filter(([, v]) => v.n >= 8 && Math.abs(v.bias) >= 0.1).sort((a, b) => Math.abs(b[1].bias) - Math.abs(a[1].bias)).slice(0, 5);
  if (off.length) out.push(`Stocks that keep opening away from their forecast: ${off.map(([k, v]) => `${k} ${v.bias > 0 ? "higher" : "lower"} by ~${r2(Math.abs(v.bias))}%`).join(", ")} — the forecast now allows for it.`);
  return out;
}

module.exports = { forecastOpen, walkForward, learnFrom, lessonsOf, emptyLearning, sessions, tonight, fitIndex, fitPattern, tiltOf, onTick, PRIOR, EXPERTS, Z70 };
