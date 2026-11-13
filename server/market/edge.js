"use strict";
// The edge engine: MEASURED odds for one stock, from its own daily history.
//
// The question it answers: "on the past days that looked most like today, what happened
// next — and when this method said 'favourable' in the past, was it right?"
//
// How it works
// 1. Every past day is described by 12 numbers known at that day's close: where price sat
//    against its 20- and 50-day averages (in ATRs), the slope of the 50-day, RSI, the 5-day
//    move, its place in the 20-day and 52-week ranges, volume against normal, volatility
//    against its own year, where the bar closed in its range, the Nifty's trend and the
//    stock's strength against it. The session kind adds the next morning's opening gap.
// 2. Every past day also has an OUTCOME, by fixed rules, after costs:
//      swing — enter at the next open, stop 1.5 ATR away, target 2.25 ATR (1.5R), out
//              after 10 sessions; a gap through the stop fills at the open; stop and
//              target touched in one bar counts as the stop.
//      day   — enter at the open, stop 0.6 ATR away, otherwise out at that day's close.
// 3. For today, the 50 most similar past days (kept at least a few sessions apart) give
//    the odds: how many made money, the average result in R, and a cautious lower bound.
// 4. WALK-FORWARD TEST: the same question is asked for every past day using only what
//    was known before it, and each "favourable" call is traded on paper, one at a time.
//    That record — trades, win rate, average R, t-statistic, the last two years apart —
//    decides the grade. A favourable reading on a method that did not hold up on this
//    stock is graded C, whatever today's odds look like.
//
// It is arithmetic on past prices: frequencies, not promises. On pure noise it must find
// nothing — a test checks that it does. Nothing here changes any other reading.

const I = require("./indicators");

const NF = 13; // 12 state features + the opening gap
const GAP = 12;
const K = 50; // analogs used for an estimate
const POOL = 220; // nearest candidates kept before they are spread apart in time
const MIN_ANALOGS = 25;
const MIN_TRAIN = 250;
const WARMUP = 260;
const TICK = 0.05;
// What the walk-forward record must show before a favourable reading is believed. A stock is
// tested four ways and a watchlist holds many stocks, so "proven" asks for more than the usual
// two standard errors: by luck alone a t of 2.5 turns up about once in 160 tries.
const PROOF = { A: { trades: 40, t: 2.5, expR: 0.05 }, B: { trades: 25, t: 1.5 } };

const KINDS = {
  swing: { id: "swing", horizon: 10, stopAtr: 1.5, targetAtr: 2.25, costPct: 0.25, spread: 5, usesGap: false },
  day: { id: "day", horizon: 1, stopAtr: 0.6, targetAtr: null, costPct: 0.1, spread: 2, usesGap: true },
};
const SIDES = ["long", "short"];

const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const clip = (x, m = 3) => (x > m ? m : x < -m ? -m : x);
const tick = (x) => Math.round(x / TICK) * TICK;

/* ------------------------------------------------------------------ outcome */

/**
 * What a trade taken on the session after day i did, in R (multiples of the risk), after
 * costs. Works on any array-likes of open/high/low/close with `n` completed bars.
 * @returns { r, exit, how }  r is NaN while the outcome is not known yet;
 *                            how: 1 target · 2 stop · 3 time (or the close, for a day trade)
 */
function outcome(kind, side, o, h, l, c, n, i, atrI) {
  const e = i + 1;
  const none = { r: NaN, exit: -1, how: 0 };
  if (e > n - 1 || !(atrI > 0)) return none;
  const long = side === "long";
  const entry = o[e];
  const risk = kind.stopAtr * atrI;
  if (!(entry > 0) || !(risk > 0)) return none;
  const cost = ((kind.costPct / 100) * entry) / risk;
  const stopPx = long ? entry - risk : entry + risk;
  const rOf = (px) => (long ? px - entry : entry - px) / risk;

  if (kind.targetAtr === null) {
    // a day trade: stopped if the day went far enough against it, otherwise out at the close
    const stopped = long ? l[e] <= stopPx : h[e] >= stopPx;
    return { r: (stopped ? -1 : rOf(c[e])) - cost, exit: e, how: stopped ? 2 : 3 };
  }

  const tgtPx = long ? entry + kind.targetAtr * atrI : entry - kind.targetAtr * atrI;
  const lastBar = e + kind.horizon - 1;
  for (let k = e; k <= lastBar && k <= n - 1; k += 1) {
    if (k > e && (long ? o[k] <= stopPx : o[k] >= stopPx)) return { r: rOf(o[k]) - cost, exit: k, how: 2 }; // gapped through the stop
    if (long ? l[k] <= stopPx : h[k] >= stopPx) return { r: -1 - cost, exit: k, how: 2 };
    if (k > e && (long ? o[k] >= tgtPx : o[k] <= tgtPx)) return { r: rOf(o[k]) - cost, exit: k, how: 1 };
    if (long ? h[k] >= tgtPx : l[k] <= tgtPx) return { r: kind.targetAtr / kind.stopAtr - cost, exit: k, how: 1 };
  }
  if (lastBar > n - 1) return none; // still running
  return { r: rOf(c[lastBar]) - cost, exit: lastBar, how: 3 };
}

/* ----------------------------------------------------------------- features */

function prepare(bars, indexBars) {
  const n = bars.length;
  const o = new Float64Array(n);
  const h = new Float64Array(n);
  const l = new Float64Array(n);
  const c = new Float64Array(n);
  const v = new Float64Array(n);
  const dates = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const b = bars[i];
    o[i] = b.o;
    h[i] = b.h;
    l[i] = b.l;
    c[i] = b.c;
    v[i] = b.v || 0;
    dates[i] = b.t;
  }
  const closes = Array.from(c);
  const e20 = I.ema(closes, 20);
  const e50 = I.ema(closes, 50);
  const a14 = I.atr(bars, 14);
  const rsi = I.rsi(closes, 14);
  const hh20 = I.highest(Array.from(h), 20);
  const ll20 = I.lowest(Array.from(l), 20);
  const atr = new Float64Array(n);
  for (let i = 0; i < n; i += 1) atr[i] = a14[i] > 0 ? a14[i] : NaN;

  let ix = null;
  if (indexBars && indexBars.length > 80) {
    const ic = indexBars.map((b) => b.c);
    ix = { c: ic, e20: I.ema(ic, 20), atr: I.atr(indexBars, 14), at: new Map(indexBars.map((b, k) => [b.t, k])) };
  }

  const F = new Float64Array(n * NF);
  const valid = new Uint8Array(n);
  for (let i = WARMUP; i < n; i += 1) {
    const A = atr[i];
    const cl = c[i];
    if (!(A > 0) || !(cl > 0) || e20[i] === null || e50[i] === null || e50[i - 10] === null || rsi[i] === null || hh20[i] === null) continue;
    // volatility against its own year, and the place in the 52-week range
    const ap = A / cl;
    let below = 0;
    let cnt = 0;
    let hi = -Infinity;
    let lo = Infinity;
    for (let k = i - 251; k <= i; k += 1) {
      const x = atr[k] / c[k];
      if (x === x) {
        cnt += 1;
        if (x <= ap) below += 1;
      }
      if (h[k] > hi) hi = h[k];
      if (l[k] < lo) lo = l[k];
    }
    let vs = 0;
    for (let k = i - 20; k < i; k += 1) vs += v[k];
    const va = vs / 20;
    const base = i * NF;
    F[base] = clip((cl - e20[i]) / A / 1.5);
    F[base + 1] = clip((cl - e50[i]) / A / 2.5);
    F[base + 2] = clip((e50[i] - e50[i - 10]) / A / 1.5);
    F[base + 3] = clip((rsi[i] - 50) / 15);
    F[base + 4] = clip((cl - c[i - 5]) / A / 2);
    F[base + 5] = hh20[i] > ll20[i] ? clip(((cl - ll20[i]) / (hh20[i] - ll20[i]) - 0.5) / 0.3) : 0;
    F[base + 6] = va > 0 && v[i] > 0 ? clip(Math.log(v[i] / va) / 0.5) : 0;
    F[base + 7] = cnt > 20 ? clip((below / cnt - 0.5) / 0.3) : 0;
    F[base + 8] = h[i] > l[i] ? clip(((cl - l[i]) / (h[i] - l[i]) - 0.5) / 0.3) : 0;
    let mkt = 0;
    let rs = 0;
    if (ix) {
      const k = ix.at.get(dates[i]);
      if (k !== undefined && k >= 20 && ix.e20[k] !== null && ix.atr[k] > 0) {
        mkt = clip((ix.c[k] - ix.e20[k]) / ix.atr[k] / 1.5);
        if (c[i - 20] > 0 && ix.c[k - 20] > 0) rs = clip((cl / c[i - 20] - 1 - (ix.c[k] / ix.c[k - 20] - 1)) / (ap * 4.5));
      }
    }
    F[base + 9] = mkt;
    F[base + 10] = rs;
    F[base + 11] = hi > lo ? clip(((cl - lo) / (hi - lo) - 0.5) / 0.3) : 0;
    // the NEXT session's opening gap, in ATRs (0 on the last row: it is never a candidate)
    F[base + GAP] = i < n - 1 ? clip((o[i + 1] - cl) / A / 0.5) : 0;
    valid[i] = 1;
  }
  return { n, o, h, l, c, v, atr, dates, F, valid, e20, e50, rsi };
}

/* ---------------------------------------------------------------- neighbours */

/** A fixed-size max-heap on distance: keeps the POOL nearest candidates seen. */
function makeHeap(cap) {
  const d = new Float64Array(cap);
  const j = new Int32Array(cap);
  let size = 0;
  return {
    reset() {
      size = 0;
    },
    push(dist, idx) {
      if (size < cap) {
        let k = size;
        size += 1;
        while (k > 0) {
          const p = (k - 1) >> 1;
          if (d[p] >= dist) break;
          d[k] = d[p];
          j[k] = j[p];
          k = p;
        }
        d[k] = dist;
        j[k] = idx;
      } else if (dist < d[0]) {
        let k = 0;
        for (;;) {
          let big = 2 * k + 1;
          if (big >= size) break;
          if (big + 1 < size && d[big + 1] > d[big]) big += 1;
          if (d[big] <= dist) break;
          d[k] = d[big];
          j[k] = j[big];
          k = big;
        }
        d[k] = dist;
        j[k] = idx;
      }
    },
    sorted() {
      const out = new Array(size);
      for (let k = 0; k < size; k += 1) out[k] = [d[k], j[k]];
      return out.sort((a, b) => a[0] - b[0]);
    },
  };
}

/**
 * The K past days most like the query, among rows 0…maxJ, kept `spread` sessions apart
 * (neighbouring days are near-copies of each other and would be counted as many).
 */
function nearest(P, q, useGap, maxJ, spread, heap) {
  const { F, valid } = P;
  heap.reset();
  const nf = useGap ? NF : NF - 1;
  for (let j = WARMUP; j <= maxJ; j += 1) {
    if (!valid[j]) continue;
    const base = j * NF;
    let s = 0;
    for (let f = 0; f < nf; f += 1) {
      const x = F[base + f] - q[f];
      s += x * x;
    }
    heap.push(s, j);
  }
  const picked = [];
  for (const [dist, j] of heap.sorted()) {
    let ok = true;
    for (let k = 0; k < picked.length; k += 1) {
      if (Math.abs(picked[k][1] - j) < spread) {
        ok = false;
        break;
      }
    }
    if (ok) {
      picked.push([dist, j]);
      if (picked.length >= K) break;
    }
  }
  return picked;
}

/** The odds over a set of analog days, for one side: count, win share, average R and cautious bounds. */
function odds(picked, R) {
  let n = 0;
  let wins = 0;
  let sum = 0;
  let sq = 0;
  for (let k = 0; k < picked.length; k += 1) {
    const r = R[picked[k][1]];
    if (r !== r) continue;
    n += 1;
    if (r > 0) wins += 1;
    sum += r;
    sq += r * r;
  }
  if (n < MIN_ANALOGS) return null;
  const mean = sum / n;
  const sd = Math.sqrt(Math.max(0, sq / n - mean * mean) * (n / (n - 1)));
  const p = wins / n;
  // Wilson lower bound at one standard error: a cautious reading of the win share
  const z = 1;
  const lo = (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
  return { n, p, pLo: lo, e: mean, eLo: mean - sd / Math.sqrt(n), sd };
}

/* ---------------------------------------------------------------- the model */

function labels(P, kind) {
  const out = {};
  for (const side of SIDES) {
    const R = new Float64Array(P.n).fill(NaN);
    const exit = new Int32Array(P.n).fill(-1);
    const how = new Uint8Array(P.n);
    for (let i = WARMUP; i < P.n - 1; i += 1) {
      if (!P.valid[i]) continue;
      const x = outcome(kind, side, P.o, P.h, P.l, P.c, P.n, i, P.atr[i]);
      R[i] = x.r;
      exit[i] = x.exit;
      how[i] = x.how;
    }
    out[side] = { R, exit, how };
  }
  return out;
}

/** The walk-forward record of one side: every favourable call, traded on paper one at a time. */
function record(P, kind, lab, wf) {
  const { R, exit } = lab;
  const trades = [];
  let free = 0;
  let days = 0;
  let signals = 0;
  let baseN = 0;
  let baseWins = 0;
  let baseSum = 0;
  const buckets = [
    { lo: 0, hi: 0.4, n: 0, wins: 0, pred: 0 },
    { lo: 0.4, hi: 0.5, n: 0, wins: 0, pred: 0 },
    { lo: 0.5, hi: 0.6, n: 0, wins: 0, pred: 0 },
    { lo: 0.6, hi: 1.01, n: 0, wins: 0, pred: 0 },
  ];
  for (let t = 0; t < P.n; t += 1) {
    const p = wf.p[t];
    const r = R[t];
    if (p !== p || r !== r) continue;
    days += 1;
    baseN += 1;
    baseSum += r;
    if (r > 0) baseWins += 1;
    const b = buckets.find((x) => p >= x.lo && p < x.hi);
    b.n += 1;
    b.pred += p;
    if (r > 0) b.wins += 1;
    if (!wf.fire[t]) continue;
    signals += 1;
    if (t < free) continue; // a trade is already open
    trades.push({ t, r });
    free = kind.horizon > 1 ? exit[t] : t + 1;
  }
  const stat = (list) => {
    const n = list.length;
    if (!n) return { trades: 0, winPct: null, expR: null, t: null, pf: null, maxDdR: null, wins: 0, sum: 0, sq: 0 };
    let sum = 0;
    let sq = 0;
    let wins = 0;
    let pos = 0;
    let neg = 0;
    let eq = 0;
    let peak = 0;
    let dd = 0;
    for (const x of list) {
      sum += x.r;
      sq += x.r * x.r;
      if (x.r > 0) {
        wins += 1;
        pos += x.r;
      } else neg -= x.r;
      eq += x.r;
      if (eq > peak) peak = eq;
      if (peak - eq > dd) dd = peak - eq;
    }
    const mean = sum / n;
    const sd = n > 1 ? Math.sqrt(Math.max(0, sq / n - mean * mean) * (n / (n - 1))) : 0;
    return { trades: n, winPct: r1((wins / n) * 100), expR: r2(mean), t: sd > 0 ? r2(mean / (sd / Math.sqrt(n))) : null, pf: neg > 0 ? r2(pos / neg) : null, maxDdR: r2(dd), wins, sum, sq };
  };
  const all = stat(trades);
  const recentFrom = P.n - 500;
  const recent = stat(trades.filter((x) => x.t >= recentFrom));
  return {
    days,
    signals,
    ...all,
    recent: { trades: recent.trades, winPct: recent.winPct, expR: recent.expR },
    base: { n: baseN, winPct: baseN ? r1((baseWins / baseN) * 100) : null, expR: baseN ? r2(baseSum / baseN) : null },
    calibration: buckets.filter((b) => b.n >= 15).map((b) => ({ range: `${Math.round(b.lo * 100)}–${Math.round(Math.min(1, b.hi) * 100)}%`, n: b.n, predictedPct: r1((b.pred / b.n) * 100), realisedPct: r1((b.wins / b.n) * 100) })),
    from: trades.length ? P.dates[trades[0].t] : null,
  };
}

/**
 * Builds the model as a generator, so a caller can let other work run between steps
 * (`yield` every ~120 test days). The final value is the model.
 */
function* modelSteps(bars, indexBars) {
  const P = prepare(bars, indexBars);
  const heap = makeHeap(POOL);
  const q = new Float64Array(NF);
  const kinds = {};
  for (const kind of Object.values(KINDS)) {
    const lab = labels(P, kind);
    const wf = {};
    for (const side of SIDES) wf[side] = { p: new Float32Array(P.n).fill(NaN), e: new Float32Array(P.n).fill(NaN), fire: new Uint8Array(P.n) };
    const first = WARMUP + MIN_TRAIN + kind.horizon;
    for (let t = first; t <= P.n - 2; t += 1) {
      if (!P.valid[t]) continue;
      for (let f = 0; f < NF; f += 1) q[f] = P.F[t * NF + f];
      // only days whose outcome was already known at the close of day t
      const picked = nearest(P, q, kind.usesGap, t - kind.horizon, kind.spread, heap);
      for (const side of SIDES) {
        const x = odds(picked, lab[side].R);
        if (!x) continue;
        wf[side].p[t] = x.p;
        wf[side].e[t] = x.e;
        wf[side].fire[t] = x.eLo > 0 ? 1 : 0;
      }
      if ((t - first) % 120 === 119) yield null;
    }
    const oos = {};
    for (const side of SIDES) oos[side] = record(P, kind, lab[side], wf[side]);
    kinds[kind.id] = { lab, wf, oos };
  }
  return { P, kinds, heap };
}

function buildModel(bars, indexBars) {
  const it = modelSteps(bars, indexBars);
  let step = it.next();
  while (!step.done) step = it.next();
  return step.value;
}

async function buildModelAsync(bars, indexBars) {
  const it = modelSteps(bars, indexBars);
  let step = it.next();
  while (!step.done) {
    await new Promise((res) => setImmediate(res));
    step = it.next();
  }
  return step.value;
}

/* --------------------------------------------------------------- today's read */

/** When choosing the days did no better than taking every day, the edge is the stock's own drift — say so. */
function driftNote(oos) {
  const b = oos.base;
  if (!b || b.expR === null || oos.expR === null || !(b.expR > 0) || oos.expR - b.expR >= 0.05) return "";
  return ` Choosing the days added little here: taking every day did about as well (${b.expR > 0 ? "+" : ""}${b.expR}R). The edge is this stock's own trend, and it lasts only as long as that does.`;
}

function gradeOf(live, oos) {
  if (!live || !live.fires) return { grade: null, why: live ? "Today's analog days do not show a positive result after costs with enough certainty." : "Not enough similar days to say." };
  const recentOk = oos.recent.trades < 8 || oos.recent.expR > 0;
  if (oos.trades >= PROOF.A.trades && oos.t !== null && oos.t >= PROOF.A.t && oos.expR > PROOF.A.expR && recentOk) {
    return { grade: "A", why: `Favourable today, and the method held up on this stock when tested forward: ${oos.trades} trades, ${oos.winPct}% won, ${oos.expR > 0 ? "+" : ""}${oos.expR}R each after costs (t ${oos.t}).${driftNote(oos)}` };
  }
  if (oos.trades >= PROOF.B.trades && oos.t !== null && oos.t >= PROOF.B.t && oos.expR > 0 && recentOk) {
    return { grade: "B", why: `Favourable today; the forward test is positive but not conclusive: ${oos.trades} trades, ${oos.winPct}% won, ${oos.expR > 0 ? "+" : ""}${oos.expR}R each (t ${oos.t}).${driftNote(oos)}` };
  }
  const tested = oos.trades ? `${oos.trades} trades, ${oos.expR > 0 ? "+" : ""}${oos.expR}R each${oos.t !== null ? ` (t ${oos.t})` : ""}` : "too few trades";
  return { grade: "C", why: `Favourable today, but the method has NOT proved itself on this stock when tested forward (${tested})${recentOk ? "" : "; the last two years were negative"}. Treat it as unproven.` };
}

/**
 * Today's reading from a built model.
 * @param open  today's opening price when the session has opened (the gap is then known)
 * @param last  the latest price, for the plan's reference
 */
function read(model, { open = null, last = null } = {}) {
  const { P, kinds, heap } = model;
  const L = P.n - 1;
  if (!P.valid[L]) return { available: false, reason: "The latest bar cannot be described yet (not enough history before it)." };
  const A = P.atr[L];
  const q = new Float64Array(NF);
  for (let f = 0; f < NF; f += 1) q[f] = P.F[L * NF + f];
  const gapKnown = Number.isFinite(open) && open > 0;
  if (gapKnown) q[GAP] = clip((open - P.c[L]) / A / 0.5);
  const out = { available: true, asOf: P.dates[L], bars: P.n, atr: r2(A), close: r2(P.c[L]), open: gapKnown ? r2(open) : null, gapAtr: gapKnown ? r2((open - P.c[L]) / A) : null, kinds: {} };

  for (const kind of Object.values(KINDS)) {
    const km = kinds[kind.id];
    const useGap = kind.usesGap && gapKnown;
    const picked = nearest(P, q, useGap, L - kind.horizon, kind.spread, heap);
    const kout = { horizon: kind.horizon, stopAtr: kind.stopAtr, targetAtr: kind.targetAtr, costPct: kind.costPct, preOpen: kind.usesGap && !gapKnown };
    for (const side of SIDES) {
      const lab = km.lab[side];
      const x = odds(picked, lab.R);
      const oos = km.oos[side];
      let live = null;
      if (x) {
        let tg = 0;
        let st = 0;
        for (const [, j] of picked) {
          if (lab.how[j] === 1) tg += 1;
          else if (lab.how[j] === 2) st += 1;
        }
        live = { n: x.n, winPct: r1(x.p * 100), winLoPct: r1(x.pLo * 100), expR: r2(x.e), expRLo: r2(x.eLo), targetPct: r1((tg / x.n) * 100), stopPct: r1((st / x.n) * 100), fires: x.eLo > 0 };
      }
      const g = gradeOf(live, oos);
      // the plan, in prices: from the open once it is known (a day trade), else from the latest price
      const long = side === "long";
      const ref = kind.usesGap ? (gapKnown ? open : null) : Number.isFinite(last) && last > 0 ? last : P.c[L];
      const plan = ref
        ? {
            entryRef: r2(tick(ref)),
            stop: r2(tick(long ? ref - kind.stopAtr * A : ref + kind.stopAtr * A)),
            target: kind.targetAtr === null ? null : r2(tick(long ? ref + kind.targetAtr * A : ref - kind.targetAtr * A)),
            riskPerShare: r2(kind.stopAtr * A),
            rr: kind.targetAtr === null ? null : r2(kind.targetAtr / kind.stopAtr),
          }
        : null;
      const { wins, sum, sq, ...oosOut } = oos; // sums are for pooling across stocks, not for display
      kout[side] = { live, grade: g.grade, why: g.why, plan, oos: oosOut, pool: { n: oos.trades, wins, sum: r2(sum), sq: r2(sq) } };
    }
    // the days it most resembles, and what the stock did after them
    kout.analogs = picked.slice(0, 6).map(([dist, j]) => ({ date: P.dates[j], distance: r2(Math.sqrt(dist)), longR: r2(km.lab.long.R[j]) }));
    if (kind.id === "swing" && picked.length >= MIN_ANALOGS) {
      const fwd = {};
      for (const d of [1, 3, 5, 10]) {
        let s = 0;
        let up = 0;
        let m = 0;
        for (const [, j] of picked) {
          if (j + d > P.n - 1) continue;
          const x = (P.c[j + d] - P.c[j]) / P.c[j];
          s += x;
          if (x > 0) up += 1;
          m += 1;
        }
        if (m) fwd[`d${d}`] = { avgPct: r2((s / m) * 100), upPct: r1((up / m) * 100) };
      }
      kout.forward = fwd;
    }
    out.kinds[kind.id] = kout;
  }

  // the headline: the best graded, tradeable reading (a swing short cannot be held in the cash market)
  const rank = { A: 3, B: 2, C: 1 };
  const cands = [
    ["swing", "long"],
    ["day", "long"],
    ["day", "short"],
  ]
    .map(([k, s]) => ({ kind: k, side: s, ...out.kinds[k][s] }))
    .filter((x) => x.grade);
  cands.sort((a, b) => rank[b.grade] - rank[a.grade] || b.live.expRLo - a.live.expRLo);
  out.best = cands[0] ? { kind: cands[0].kind, side: cands[0].side, grade: cands[0].grade, winPct: cands[0].live.winPct, expR: cands[0].live.expR, n: cands[0].live.n } : null;
  const down = out.kinds.swing.short;
  out.warning = down.grade === "A" || down.grade === "B" ? `Downside edge over the next sessions (grade ${down.grade}): similar days fell more often than not. A reason to avoid new longs and to tighten stops.` : null;
  return out;
}

module.exports = { KINDS, SIDES, PROOF, outcome, prepare, buildModel, buildModelAsync, read, nearest, odds, WARMUP, MIN_TRAIN, K };
