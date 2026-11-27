"use strict";
// The morning call: where a stock is likely to trade from the opening auction to 9:45 AM, and through the rest of the day —
// made before the open, sharpened once the pre-open auction has set the opening price (9:08), and made again at every
// 5-minute mark from 9:15 to 9:40. From 9:45 the desk's live call, the 15-minute forecaster and the AI live read lead.
//
// WHAT  from the price a call is made at (the expected open, the auction's price, or the price at 9:15 + 5k minutes):
//         c15  where the price is 15 minutes later          c45  where it is at 9:45
//         u45  how far above it trades before 9:45           d45  how far below
//         cD   where the day closes                          uD / dD  how far above / below it trades for the rest of the day
//       all in units of the stock's own daily range (ATR), so one model learns from every stock at once.
// HOW   one ridge regression per checkpoint (k = 0 at the open … 5 at 9:40) and per target, fitted on the NIFTY 100's stored
//       year of 5-minute bars (the robot's history). The inputs are known at the moment of the call:
//         · the stock's previous sessions: its range, its last day's move and where it closed in its range, its last hour,
//           5 and 20 days of trend, the 20-day average, the 20-day high and low, the last day's volume against its average;
//         · the gap, and the market's gap — the middle of every stock's gap that morning (live: the GIFT Nifty's expected
//           gap until the auction, then the Nifty's own auction price);
//         · from 9:15, the session so far: the move from the open, the range, the place in it, the volume against this
//           stock's usual first minutes, VWAP, and the market's move since its open.
//       Before use the fit is tested on the newest fifth of the sessions, which it never saw; that test is the record shown
//       beside every call (direction right, error against simply expecting the usual range, and the band). The model is fitted
//       again every evening once the history has the new session.
//       Readings that have no stored history — futures open-interest build-up, the pre-open order imbalance, the trade
//       setup's market lean, the overnight world lean and the live order book — enter through a correction learned from the
//       desk's own scored calls. It starts at zero, and is used only once both halves of the sessions say it helps.
// Pure: no clock, no network, no database. It reads the market; it cannot place an order. Not a promise; not advice.

const IST = 5.5 * 3600 * 1000;
const OPEN_MIN = 9 * 60 + 15;
const CHECKS = 6; // k = 0 … 5: the calls at 9:15, 9:20, 9:25, 9:30, 9:35 and 9:40
const WIN = 6; // the first six 5-minute bars: 9:15 – 9:45
const MODEL_VERSION = 1;
const CLIP_X = 6;
const CLIP_Y = 8;
const MIN_PRIOR = 21; // previous sessions needed for a context (20 days of trend and volume, one more for the change)

const DAILY = ["atrPct", "prevRet", "prevClv", "prevRange", "ret5", "ret20", "ema20", "dHigh20", "dLow20", "prevVol", "lastHour"];
const OPENING = ["gap", "gapSq", "mktGap", "relGap"];
const SESSION = ["mv", "hi", "lo", "pos", "vol", "mktMv", "vw", "mvGap"];
const FEATURES = [...DAILY, ...OPENING, ...SESSION];
const F = FEATURES.length;
const IDX = Object.fromEntries(FEATURES.map((f, i) => [f, i]));
const TARGETS = ["c15", "c45", "u45", "d45", "cD", "uD", "dD"];
const T = TARGETS.length;
const TIX = Object.fromEntries(TARGETS.map((t, i) => [t, i]));
const DIRECTIONAL = ["c15", "c45", "cD"];
const SOFT = ["oi", "setup", "world", "preImb", "book"];

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const r3 = (x) => (num(x) ? Math.round(x * 1000) / 1000 : null);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const msOf = (t) => {
  if (num(t)) return t;
  const x = String(t || "").replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  return Date.parse(/[+-]\d{2}:\d{2}$|Z$/.test(x) ? x : `${x}+05:30`);
};
const minOf = (t) => {
  const d = new Date(msOf(t) + IST);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const dateOf = (t) => new Date(msOf(t) + IST).toISOString().slice(0, 10);
/** The 5-minute slot of a bar from 9:15 (0 = 9:15 – 9:20). */
const slotOf = (t) => Math.round((minOf(t) - OPEN_MIN) / 5);
function median(a) {
  const s = a.filter(num).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const i = clamp((sorted.length - 1) * q, 0, sorted.length - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/* ------------------------------------------------------------------------------------------------ one session, in short */

/**
 * A session's day bar, and what the morning model needs from its 5-minute bars.
 * @param bars  that session's 5-minute bars in time order ({ t, o, h, l, c, v })
 */
function daySummary(date, bars) {
  const n = bars.length;
  let h = -Infinity;
  let l = Infinity;
  let v = 0;
  for (const b of bars) {
    if (b.h > h) h = b.h;
    if (b.l < l) l = b.l;
    v += b.v || 0;
  }
  const firstVol = [];
  let cum = 0;
  for (let i = 0; i < WIN - 1; i += 1) {
    cum += bars[i] ? bars[i].v || 0 : 0;
    firstVol.push(cum);
  }
  return { date, o: bars[0].o, h, l, c: bars[n - 1].c, v, lastHour: n > 13 ? bars[n - 1].c - bars[n - 13].c : null, firstVol };
}

/** A daily candle as a summary (no intraday detail: the last hour and the first minutes' volume are unknown). */
const fromCandle = (c) => ({ date: String(c.t).slice(0, 10), o: c.o, h: c.h, l: c.l, c: c.c, v: c.v || 0, lastHour: null, firstVol: null });

/**
 * What the previous sessions say, in the stock's own units.
 * @param prior  the sessions before the one forecast, oldest first (daySummary or fromCandle), at least 21
 * @returns { atr, prevClose, atrPct, x: { …DAILY }, firstVolAvg: [5] | null } | null
 */
function contextOf(prior) {
  const n = prior ? prior.length : 0;
  if (n < MIN_PRIOR) return null;
  const last = prior[n - 1];
  let tr = 0;
  for (let i = n - 14; i < n; i += 1) {
    const d = prior[i];
    const pc = prior[i - 1].c;
    tr += Math.max(d.h - d.l, Math.abs(d.h - pc), Math.abs(d.l - pc));
  }
  const atr = tr / 14;
  if (!(atr > 0) || !(last.c > 0)) return null;
  const from = Math.max(0, n - 60);
  let ema = prior[from].c;
  const a = 2 / 21;
  for (let i = from + 1; i < n; i += 1) ema += a * (prior[i].c - ema);
  let hi20 = -Infinity;
  let lo20 = Infinity;
  for (let i = n - 20; i < n; i += 1) {
    hi20 = Math.max(hi20, prior[i].h);
    lo20 = Math.min(lo20, prior[i].l);
  }
  const vols = prior.slice(n - 21, n - 1).map((d) => d.v).filter((x) => x > 0);
  const avgV = vols.length ? vols.reduce((s, x) => s + x, 0) / vols.length : 0;
  let firstVolAvg = null;
  const withFirst = prior.slice(n - 20).filter((d) => Array.isArray(d.firstVol));
  if (withFirst.length >= 10) firstVolAvg = Array.from({ length: WIN - 1 }, (_, k) => withFirst.reduce((s, d) => s + (d.firstVol[k] || 0), 0) / withFirst.length);
  const atrPct = (atr / last.c) * 100;
  return {
    atr,
    prevClose: last.c,
    prevDate: last.date,
    atrPct,
    x: {
      atrPct,
      prevRet: (last.c - prior[n - 2].c) / atr,
      prevClv: last.h > last.l ? (2 * last.c - last.h - last.l) / (last.h - last.l) : 0,
      prevRange: (last.h - last.l) / atr,
      ret5: (last.c - prior[n - 6].c) / atr / Math.sqrt(5),
      ret20: (last.c - prior[n - 21].c) / atr / Math.sqrt(20),
      ema20: (last.c - ema) / atr,
      dHigh20: (last.c - hi20) / atr,
      dLow20: (last.c - lo20) / atr,
      prevVol: avgV > 0 && last.v > 0 ? Math.log(last.v / avgV) : 0,
      lastHour: num(last.lastHour) ? last.lastHour / atr : 0,
    },
    firstVolAvg,
  };
}

/**
 * The inputs of one call.
 * @param ctx        contextOf(the previous sessions)
 * @param open       the open — expected before the auction, the auction's price after it, the real one from 9:15
 * @param mktGapPct  the market's gap, %
 * @param k          5-minute bars finished today (0 … 5)
 * @param bars       today's bars (only the first k are read)
 * @param last       the price now (from 9:15); the last finished bar's close when not given
 * @param mktMvPct   the market's move since its open, %
 */
function featuresOf(ctx, { open, mktGapPct = 0, k = 0, bars = [], last = null, mktMvPct = 0 } = {}) {
  const x = new Float64Array(F);
  const a = ctx.atr;
  const set = (name, v) => {
    x[IDX[name]] = clamp(num(v) ? v : 0, -CLIP_X, CLIP_X * (name === "atrPct" ? 2 : 1));
  };
  for (const name of DAILY) set(name, ctx.x[name]);
  const gap = num(open) ? (open - ctx.prevClose) / a : 0;
  const mkt = num(mktGapPct) && ctx.atrPct > 0 ? mktGapPct / ctx.atrPct : 0;
  set("gap", gap);
  set("gapSq", Math.sign(gap) * Math.min(gap * gap, 4));
  set("mktGap", mkt);
  set("relGap", gap - mkt);
  if (k > 0 && bars.length >= k && num(open)) {
    let H = -Infinity;
    let L0 = Infinity;
    let pv = 0;
    let vv = 0;
    for (let i = 0; i < k; i += 1) {
      const b = bars[i];
      H = Math.max(H, b.h);
      L0 = Math.min(L0, b.l);
      pv += ((b.h + b.l + b.c) / 3) * (b.v || 0);
      vv += b.v || 0;
    }
    const L = num(last) ? last : bars[k - 1].c;
    H = Math.max(H, L);
    L0 = Math.min(L0, L);
    const vwap = vv > 0 ? pv / vv : (H + L0 + L) / 3;
    const mv = (L - open) / a;
    set("mv", mv);
    set("hi", (H - open) / a);
    set("lo", (L0 - open) / a);
    set("pos", H > L0 ? (L - L0) / (H - L0) - 0.5 : 0);
    const fa = ctx.firstVolAvg ? ctx.firstVolAvg[k - 1] : null;
    set("vol", vv > 0 && fa > 0 ? Math.log(vv / fa) : 0);
    set("mktMv", num(mktMvPct) && ctx.atrPct > 0 ? mktMvPct / ctx.atrPct : 0);
    set("vw", (L - vwap) / a);
    set("mvGap", mv * Math.sign(gap));
  }
  return x;
}

/**
 * What happened after a call made at checkpoint k from price L — the answers the model learns.
 * @param bars  the whole session's 5-minute bars, slot-aligned from 9:15 (the first six must be there)
 * @returns Float64Array in TARGETS order, ATR units
 */
function targetsOf(bars, k, L, atr) {
  const y = new Float64Array(T);
  const n = bars.length;
  let u = -Infinity;
  let d = Infinity;
  for (let i = k; i < WIN; i += 1) {
    u = Math.max(u, bars[i].h);
    d = Math.min(d, bars[i].l);
  }
  let U = u;
  let D = d;
  for (let i = WIN; i < n; i += 1) {
    U = Math.max(U, bars[i].h);
    D = Math.min(D, bars[i].l);
  }
  const put = (t, v) => {
    y[TIX[t]] = clamp(v / atr, -CLIP_Y, CLIP_Y);
  };
  put("c15", bars[Math.min(k + 2, n - 1)].c - L);
  put("c45", bars[WIN - 1].c - L);
  put("u45", Math.max(u, L) - L);
  put("d45", Math.min(d, L) - L);
  put("cD", bars[n - 1].c - L);
  put("uD", Math.max(U, L) - L);
  put("dD", Math.min(D, L) - L);
  return y;
}

/** True when the session's first six bars are the slots 9:15 … 9:40 in order (no gap in the opening half-hour). */
function alignedOpening(bars) {
  if (!bars || bars.length < WIN + 6) return false;
  for (let i = 0; i < WIN; i += 1) if (slotOf(bars[i].t) !== i) return false;
  return true;
}

/* ------------------------------------------------------------------------------------------------ the stored history */

/**
 * Every usable stock-session of the stored history as training rows, without holding all the bars at once: the stores'
 * records are read one stock at a time, twice (first for the market's gap and move each morning, then for the rows).
 * @param symbols   the stocks
 * @param barsOf    (symbol) => that stock's stored 5-minute bars (ms times)
 * @param sessions  (bars) => Map date → bars (whole sessions)
 * @returns { k: [{ X: Float32Array, Y: Float32Array, D: Int32Array }], n, dates: [..] (sorted), stocks }
 */
function rowsFrom(symbols, barsOf, sessions) {
  // pass 1: each morning's gap and move for the market (the middle of every stock's)
  const perDate = new Map(); // date → { gaps: [], mv: [[] × 5] }
  let count = 0;
  let stocks = 0;
  for (const s of symbols) {
    const m = sessions(barsOf(s) || []);
    const dates = [...m.keys()].sort();
    let used = false;
    for (let i = MIN_PRIOR; i < dates.length; i += 1) {
      const bars = m.get(dates[i]);
      if (!alignedOpening(bars)) continue;
      const prev = m.get(dates[i - 1]);
      const pc = prev[prev.length - 1].c;
      const o = bars[0].o;
      if (!(pc > 0) || !(o > 0)) continue;
      const e = perDate.get(dates[i]) || perDate.set(dates[i], { gaps: [], mv: Array.from({ length: WIN - 1 }, () => []) }).get(dates[i]);
      e.gaps.push(((o - pc) / pc) * 100);
      for (let k = 1; k < WIN; k += 1) e.mv[k - 1].push(((bars[k - 1].c - o) / o) * 100);
      count += 1;
      used = true;
    }
    if (used) stocks += 1;
  }
  const mkt = new Map([...perDate].map(([d, e]) => [d, { gap: median(e.gaps), mv: e.mv.map(median) }]));
  const dates = [...mkt.keys()].sort();
  const dIdx = new Map(dates.map((d, i) => [d, i]));
  const out = Array.from({ length: CHECKS }, () => ({ X: new Float32Array(count * F), Y: new Float32Array(count * T), D: new Int32Array(count) }));
  // pass 2: the rows
  let r = 0;
  for (const s of symbols) {
    const m = sessions(barsOf(s) || []);
    const dates2 = [...m.keys()].sort();
    const sums = dates2.map((d) => daySummary(d, m.get(d)));
    for (let i = MIN_PRIOR; i < dates2.length && r < count; i += 1) {
      const bars = m.get(dates2[i]);
      if (!alignedOpening(bars)) continue;
      const ctx = contextOf(sums.slice(Math.max(0, i - 60), i));
      const mk = mkt.get(dates2[i]);
      if (!ctx || !mk) continue;
      const o = bars[0].o;
      if (!(o > 0)) continue;
      for (let k = 0; k < CHECKS; k += 1) {
        const L = k === 0 ? o : bars[k - 1].c;
        const x = featuresOf(ctx, { open: o, mktGapPct: mk.gap, k, bars, last: L, mktMvPct: k > 0 ? mk.mv[k - 1] : 0 });
        const y = targetsOf(bars, k, L, ctx.atr);
        out[k].X.set(x, r * F);
        out[k].Y.set(y, r * T);
        out[k].D[r] = dIdx.get(dates2[i]);
      }
      r += 1;
    }
  }
  return { k: out.map((b) => ({ X: b.X.subarray(0, r * F), Y: b.Y.subarray(0, r * T), D: b.D.subarray(0, r) })), n: r, dates, stocks };
}

/* ------------------------------------------------------------------------------------------------ ridge */

/** Solves A w = b for a small symmetric positive-definite A (Cholesky). A is n×n row-major. */
function solve(A, b, n) {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let s = A[i * n + j];
      for (let k = 0; k < j; k += 1) s -= L[i * n + k] * L[j * n + k];
      if (i === j) L[i * n + i] = Math.sqrt(Math.max(s, 1e-12));
      else L[i * n + j] = s / L[j * n + j];
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let s = b[i];
    for (let k = 0; k < i; k += 1) s -= L[i * n + k] * y[k];
    y[i] = s / L[i * n + i];
  }
  const w = new Float64Array(n);
  for (let i = n - 1; i >= 0; i -= 1) {
    let s = y[i];
    for (let k = i + 1; k < n; k += 1) s -= L[k * n + i] * w[k];
    w[i] = s / L[i * n + i];
  }
  return w;
}

/**
 * Ridge for every target at once on the rows `take(i)` says yes to.
 * @returns { mean, sd, w: [T][F] (on the standardised inputs), b: [T] }
 */
function fit(block, take, lambda = 30) {
  const { X, Y, D } = block;
  const n = D.length;
  const mean = new Float64Array(F);
  const sd = new Float64Array(F);
  const ym = new Float64Array(T);
  let m = 0;
  for (let i = 0; i < n; i += 1) {
    if (!take(i)) continue;
    m += 1;
    for (let f = 0; f < F; f += 1) mean[f] += X[i * F + f];
    for (let t = 0; t < T; t += 1) ym[t] += Y[i * T + t];
  }
  if (m < F * 4) return null;
  for (let f = 0; f < F; f += 1) mean[f] /= m;
  for (let t = 0; t < T; t += 1) ym[t] /= m;
  for (let i = 0; i < n; i += 1) {
    if (!take(i)) continue;
    for (let f = 0; f < F; f += 1) {
      const d = X[i * F + f] - mean[f];
      sd[f] += d * d;
    }
  }
  for (let f = 0; f < F; f += 1) sd[f] = Math.sqrt(sd[f] / m);
  const A = new Float64Array(F * F);
  const B = Array.from({ length: T }, () => new Float64Array(F));
  const z = new Float64Array(F);
  for (let i = 0; i < n; i += 1) {
    if (!take(i)) continue;
    for (let f = 0; f < F; f += 1) z[f] = sd[f] > 1e-9 ? (X[i * F + f] - mean[f]) / sd[f] : 0;
    for (let a = 0; a < F; a += 1) {
      if (z[a] === 0) continue;
      for (let c = 0; c <= a; c += 1) A[a * F + c] += z[a] * z[c];
      for (let t = 0; t < T; t += 1) B[t][a] += z[a] * (Y[i * T + t] - ym[t]);
    }
  }
  for (let a = 0; a < F; a += 1) {
    for (let c = 0; c < a; c += 1) A[c * F + a] = A[a * F + c];
    A[a * F + a] += lambda;
  }
  const w = B.map((b) => Array.from(solve(A, b, F), (x) => r3(x) ?? 0));
  return { mean: Array.from(mean, (x) => r3(x)), sd: Array.from(sd, (x) => r3(x)), w, b: Array.from(ym, (x) => r3(x)) };
}

/** A fitted block's prediction for one target from raw inputs. */
function apply(p, x, t) {
  let s = p.b[t];
  const w = p.w[t];
  for (let f = 0; f < F; f += 1) if (p.sd[f] > 1e-9) s += w[f] * ((x[f] - p.mean[f]) / p.sd[f]);
  return s;
}

/* ------------------------------------------------------------------------------------------------ training and the test */

/**
 * The whole model from the rows: for each checkpoint, a fit on the older four-fifths of the sessions, its test on the newest
 * fifth (the record shown), then the fit on everything that is used.
 * @returns the model document, or null when there are too few sessions
 */
function train(rows, { valShare = 0.2, minSessions = 60, now = Date.now() } = {}) {
  const nd = rows.dates.length;
  if (rows.n < 500 || nd < minSessions) return null;
  const cut = Math.floor(nd * (1 - valShare)); // date index where the test sessions begin
  const perK = [];
  for (let k = 0; k < CHECKS; k += 1) {
    const block = rows.k[k];
    const old = fit(block, (i) => block.D[i] < cut);
    const all = fit(block, () => true);
    if (!old || !all) return null;
    const stats = {};
    const resid = TARGETS.map(() => []);
    const preds = TARGETS.map(() => []);
    const ys = TARGETS.map(() => []);
    const x = new Float64Array(F);
    const sessions = new Set();
    for (let i = 0; i < block.D.length; i += 1) {
      if (block.D[i] < cut) continue;
      sessions.add(block.D[i]);
      for (let f = 0; f < F; f += 1) x[f] = block.X[i * F + f];
      for (let t = 0; t < T; t += 1) {
        const p = apply(old, x, t);
        const y = block.Y[i * T + t];
        resid[t].push(y - p);
        preds[t].push(p);
        ys[t].push(y);
      }
    }
    TARGETS.forEach((name, t) => {
      const n = ys[t].length;
      const mae = resid[t].reduce((s, e) => s + Math.abs(e), 0) / Math.max(1, n);
      const base = ys[t].reduce((s, y) => s + Math.abs(y - old.b[t]), 0) / Math.max(1, n);
      const sorted = resid[t].slice().sort((a, b) => a - b);
      stats[name] = { n, mae: r3(mae), base: r3(base), skill: base > 0 ? r3(1 - mae / base) : 0, q15: r3(quantile(sorted, 0.15)), q85: r3(quantile(sorted, 0.85)) };
      if (DIRECTIONAL.includes(name)) {
        let called = 0;
        let hit = 0;
        let all2 = 0;
        for (let i = 0; i < n; i += 1) {
          if (ys[t][i] === 0) continue;
          all2 += 1;
          if (Math.abs(preds[t][i]) < 0.05) continue;
          called += 1;
          if (Math.sign(preds[t][i]) === Math.sign(ys[t][i])) hit += 1;
        }
        stats[name].dir = { called, hit, rate: called ? r3(hit / called) : null, share: all2 ? r3(called / all2) : 0 };
        stats[name].cal = calibrate(preds[t], ys[t]);
      }
    });
    perK.push({ k, fit: all, test: { sessions: sessions.size }, stats });
  }
  return {
    version: MODEL_VERSION,
    features: FEATURES,
    targets: TARGETS,
    trainedAt: new Date(now).toISOString(),
    trainedTo: rows.dates[nd - 1],
    from: rows.dates[0],
    sessions: nd,
    testFrom: rows.dates[cut],
    testSessions: nd - cut,
    rows: rows.n,
    stocks: rows.stocks,
    perK,
    soft: null,
  };
}

/**
 * How often the price really rose, by how strongly the call leaned: six bins of the test calls, sorted by the prediction.
 * @returns [[from, to, ups, n], …]
 */
function calibrate(preds, ys, bins = 6) {
  const pairs = preds.map((p, i) => [p, ys[i]]).filter((x) => x[1] !== 0).sort((a, b) => a[0] - b[0]);
  if (pairs.length < bins * 30) return [];
  const out = [];
  for (let b = 0; b < bins; b += 1) {
    const part = pairs.slice(Math.floor((pairs.length * b) / bins), Math.floor((pairs.length * (b + 1)) / bins));
    out.push([r3(part[0][0]), r3(part[part.length - 1][0]), part.filter((x) => x[1] > 0).length, part.length]);
  }
  return out;
}

/** The measured chance of a rise for a prediction, from the bin it falls in (shrunk a little toward even). */
function probUp(cal, pred) {
  if (!Array.isArray(cal) || !cal.length || !num(pred)) return null;
  let bin = cal[0];
  for (const c of cal) if (pred >= c[0]) bin = c;
  const [, , ups, n] = bin;
  return { p: r3((ups + 5) / (n + 10)), n };
}

/** The model's numbers for one call: every target, the band of the 9:45 price, and the chances of a rise. */
function predict(model, k, x, soft = null) {
  const pk = model.perK[clamp(k, 0, CHECKS - 1)];
  const y = {};
  TARGETS.forEach((name, t) => {
    y[name] = apply(pk.fit, x, t);
  });
  // the learned correction from the readings with no stored history, where it has proved itself
  const corr = { c45: 0, cD: 0 };
  if (soft && model.soft) {
    for (const t of ["c45", "cD"]) {
      const s = model.soft[t];
      if (!s || !s.on) continue;
      corr[t] = SOFT.reduce((acc, name, i) => acc + (num(soft[name]) ? soft[name] * s.w[i] : 0), 0);
      y[t] += corr[t];
    }
    y.c15 += corr.c45 * 0.5;
  }
  y.u45 = Math.max(0, y.u45, y.c45);
  y.d45 = Math.min(0, y.d45, y.c45);
  y.uD = Math.max(y.u45, y.uD, y.cD);
  y.dD = Math.min(y.d45, y.dD, y.cD);
  const st = pk.stats;
  return {
    y,
    band45: [y.c45 + (st.c45.q15 || 0), y.c45 + (st.c45.q85 || 0)],
    up45: probUp(st.c45.cal, y.c45 - corr.c45),
    up15: probUp(st.c15.cal, y.c15),
    upDay: probUp(st.cD.cal, y.cD - corr.cD),
    corr,
  };
}

/* ------------------------------------------------------------------------------------------------ the live correction */

/**
 * The correction from readings with no stored history (OI build-up, pre-open imbalance, setup lean, world lean, order
 * book), fitted on the desk's own scored calls. It is switched on only when a fit on half the sessions makes the calls on the
 * other half better, both ways round, by at least 2%.
 * @param recs  scored calls: [{ date, soft: {…}, pred: { c45, cD }, y: { c45, cD } }]
 */
function softFrom(recs, { minSessions = 10, minRecs = 100, lambda = 25 } = {}) {
  const out = {};
  for (const t of ["c45", "cD"]) {
    const rows = recs.filter((r) => r.soft && r.pred && r.y && num(r.pred[t]) && num(r.y[t]));
    const dates = [...new Set(rows.map((r) => r.date))].sort();
    const base = { on: false, n: rows.length, sessions: dates.length, w: SOFT.map(() => 0), gain: null };
    if (rows.length < minRecs || dates.length < minSessions) {
      out[t] = { ...base, why: `${dates.length} of ${minSessions} sessions and ${rows.length} of ${minRecs} scored calls so far` };
      continue;
    }
    const parity = new Map(dates.map((d, i) => [d, i % 2]));
    const fitOn = (part) => {
      const A = new Float64Array(SOFT.length * SOFT.length);
      const b = new Float64Array(SOFT.length);
      for (const r of part) {
        const s = SOFT.map((name) => (num(r.soft[name]) ? clamp(r.soft[name], -1, 1) : 0));
        const e = r.y[t] - r.pred[t];
        for (let i = 0; i < SOFT.length; i += 1) {
          b[i] += s[i] * e;
          for (let j = 0; j < SOFT.length; j += 1) A[i * SOFT.length + j] += s[i] * s[j];
        }
      }
      for (let i = 0; i < SOFT.length; i += 1) A[i * SOFT.length + i] += lambda;
      return Array.from(solve(A, b, SOFT.length));
    };
    const errOf = (part, w) => {
      let before = 0;
      let after = 0;
      for (const r of part) {
        const s = SOFT.reduce((acc, name, i) => acc + (num(r.soft[name]) ? clamp(r.soft[name], -1, 1) * w[i] : 0), 0);
        const e = r.y[t] - r.pred[t];
        before += Math.abs(e);
        after += Math.abs(e - s);
      }
      return before > 0 ? 1 - after / before : 0;
    };
    const even = rows.filter((r) => parity.get(r.date) === 0);
    const odd = rows.filter((r) => parity.get(r.date) === 1);
    const g1 = errOf(odd, fitOn(even));
    const g2 = errOf(even, fitOn(odd));
    const on = g1 >= 0.02 && g2 >= 0.02;
    out[t] = { ...base, on, w: fitOn(rows).map((x) => r3(x)), gain: r3(Math.min(g1, g2)), why: on ? `better on both halves of ${dates.length} sessions (by ${Math.round(Math.min(g1, g2) * 100)}% at least)` : `not better on both halves of ${dates.length} sessions yet` };
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------ before the model has learned */

/**
 * What this stock's own recent sessions say about its first half-hour and its day — measured medians in ATR units — used
 * while the pooled model has not learned (no stored history). @param sums daySummary-like rows with their bars
 */
function ownHabits(sessionsWithBars, atr) {
  const rows = sessionsWithBars.filter((x) => alignedOpening(x.bars));
  if (rows.length < 8 || !(atr > 0)) return null;
  const pick = (f) => median(rows.map(f));
  return {
    n: rows.length,
    u45: pick((x) => (Math.max(...x.bars.slice(0, WIN).map((b) => b.h)) - x.bars[0].o) / atr),
    d45: pick((x) => (Math.min(...x.bars.slice(0, WIN).map((b) => b.l)) - x.bars[0].o) / atr),
    uD: pick((x) => (Math.max(...x.bars.map((b) => b.h)) - x.bars[0].o) / atr),
    dD: pick((x) => (Math.min(...x.bars.map((b) => b.l)) - x.bars[0].o) / atr),
  };
}

/**
 * A lean from fixed votes, for when the model has not learned. No chance is given: there is no measured record behind it.
 * @returns { score −1…+1, side "up" | "down" | "none", votes: [{ name, vote, weight, why }] }
 */
function ruleLean({ x, soft = {}, k = 0 }) {
  const votes = [];
  const add = (name, weight, v, why) => {
    if (num(v) && v !== 0) votes.push({ name, weight, vote: r2(clamp(v, -1, 1)), why });
  };
  add("Market gap", 1, x[IDX.mktGap] / 0.5, "the market's expected or real gap");
  add("Trend (5 and 20 days)", 0.8, (x[IDX.ret5] + x[IDX.ret20]) / 1.5, "the last week's and month's move");
  add("Last close in its range", 0.5, x[IDX.prevClv], "where the last session closed between its high and low");
  add("Futures build-up", 1.2, soft.oi, "open interest against price since the last close");
  add("Setup lean", 0.8, soft.setup, "the trade setup's market lean");
  add("World lean", 0.8, soft.world, "GIFT Nifty and overseas markets");
  add("Pre-open orders", 1, soft.preImb, "buy against sell quantity in the auction");
  if (k > 0) {
    add("Move since the open", 1.5, x[IDX.mv] / 0.3, "the first minutes' move");
    add("VWAP side", 1, x[IDX.vw] / 0.15, "above or below the day's average price");
    add("Market since its open", 1, x[IDX.mktMv] / 0.3, "the Nifty's move since the open");
    add("Order book", 0.6, soft.book, "buyers against sellers waiting");
  }
  const wsum = votes.reduce((s, v) => s + v.weight, 0);
  const score = wsum ? votes.reduce((s, v) => s + v.vote * v.weight, 0) / Math.max(wsum, 4) : 0;
  return { score: r2(score), side: score >= 0.2 ? "up" : score <= -0.2 ? "down" : "none", votes };
}

/** Plain words for the inputs that pushed a model call most (standardised input × weight on the 9:45 target). */
function driversOf(model, k, x, top = 5) {
  const p = model.perK[clamp(k, 0, CHECKS - 1)].fit;
  const t = TIX.c45;
  const rows = FEATURES.map((name, f) => ({ name, push: p.sd[f] > 1e-9 ? p.w[t][f] * ((x[f] - p.mean[f]) / p.sd[f]) : 0 })).filter((r) => Math.abs(r.push) >= 0.005);
  return rows.sort((a, b) => Math.abs(b.push) - Math.abs(a.push)).slice(0, top).map((r) => ({ name: r.name, label: LABELS[r.name] || r.name, push: r3(r.push), side: r.push > 0 ? "up" : "down" }));
}

const LABELS = {
  atrPct: "How volatile the stock is",
  prevRet: "The last session's move",
  prevClv: "Where the last session closed in its range",
  prevRange: "The last session's range",
  ret5: "The last week's trend",
  ret20: "The last month's trend",
  ema20: "Distance from the 20-day average",
  dHigh20: "Distance below the 20-day high",
  dLow20: "Distance above the 20-day low",
  prevVol: "The last session's volume",
  lastHour: "The last hour of the last session",
  gap: "The gap",
  gapSq: "The size of the gap",
  mktGap: "The market's gap",
  relGap: "The gap against the market's",
  mv: "The move since the open",
  hi: "How far above the open it has traded",
  lo: "How far below the open it has traded",
  pos: "Where it sits in today's range",
  vol: "Volume against its usual first minutes",
  mktMv: "The market's move since the open",
  vw: "Distance from VWAP",
  mvGap: "Going with the gap or filling it",
};

module.exports = {
  MODEL_VERSION,
  CHECKS,
  WIN,
  FEATURES,
  TARGETS,
  SOFT,
  LABELS,
  OPEN_MIN,
  MIN_PRIOR,
  daySummary,
  fromCandle,
  contextOf,
  featuresOf,
  targetsOf,
  alignedOpening,
  rowsFrom,
  fit,
  apply,
  train,
  calibrate,
  probUp,
  predict,
  softFrom,
  ownHabits,
  ruleLean,
  driversOf,
  slotOf,
  dateOf,
  minOf,
  msOf,
  median,
};
