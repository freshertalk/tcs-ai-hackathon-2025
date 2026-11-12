"use strict";
// Technical indicators. Pure functions over plain arrays — no I/O, no dates.
//
// Conventions
//   • a candle is { t, o, h, l, c, v }  (t = "YYYY-MM-DD" for daily bars)
//   • every function returns an array the same length as its input, with `null`
//     where there is not enough history yet (the warm-up). Nothing is ever
//     back-filled or guessed.
//   • formulas follow the standard definitions (Wilder for RSI / ATR / ADX,
//     population standard deviation for Bollinger Bands — the same as the common
//     charting platforms), so the numbers match what a chart shows.

const isNum = (x) => typeof x === "number" && Number.isFinite(x);

function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** Exponential moving average, seeded with the SMA of the first n values. */
function ema(values, n) {
  const out = new Array(values.length).fill(null);
  if (values.length < n) return out;
  const k = 2 / (n + 1);
  let prev = 0;
  for (let i = 0; i < n; i += 1) prev += values[i];
  prev /= n;
  out[n - 1] = prev;
  for (let i = n; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's smoothing of a series that starts at `start` (first value = simple average). */
function wilder(values, n, start = 0) {
  const out = new Array(values.length).fill(null);
  if (values.length < start + n) return out;
  let prev = 0;
  for (let i = start; i < start + n; i += 1) prev += values[i];
  prev /= n;
  out[start + n - 1] = prev;
  for (let i = start + n; i < values.length; i += 1) {
    prev = (prev * (n - 1) + values[i]) / n;
    out[i] = prev;
  }
  return out;
}

/** Relative Strength Index (Wilder). */
function rsi(closes, n = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= n) return out;
  const gains = [0];
  const losses = [0];
  for (let i = 1; i < closes.length; i += 1) {
    const d = closes[i] - closes[i - 1];
    gains.push(d > 0 ? d : 0);
    losses.push(d < 0 ? -d : 0);
  }
  const ag = wilder(gains, n, 1);
  const al = wilder(losses, n, 1);
  for (let i = n; i < closes.length; i += 1) {
    if (al[i] === 0) out[i] = ag[i] === 0 ? 50 : 100;
    else out[i] = 100 - 100 / (1 + ag[i] / al[i]);
  }
  return out;
}

function macd(closes, fast = 12, slow = 26, signalN = 9) {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const line = closes.map((_, i) => (isNum(ef[i]) && isNum(es[i]) ? ef[i] - es[i] : null));
  const first = line.findIndex(isNum);
  const signal = new Array(closes.length).fill(null);
  if (first >= 0) {
    const sig = ema(line.slice(first), signalN);
    sig.forEach((v, j) => {
      signal[first + j] = v;
    });
  }
  const hist = line.map((v, i) => (isNum(v) && isNum(signal[i]) ? v - signal[i] : null));
  return { macd: line, signal, hist };
}

function bollinger(closes, n = 20, mult = 2) {
  const mid = sma(closes, n);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  const width = new Array(closes.length).fill(null);
  const pctB = new Array(closes.length).fill(null);
  for (let i = n - 1; i < closes.length; i += 1) {
    let ss = 0;
    for (let j = i - n + 1; j <= i; j += 1) ss += (closes[j] - mid[i]) ** 2;
    const sd = Math.sqrt(ss / n);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
    width[i] = mid[i] ? (upper[i] - lower[i]) / mid[i] : null;
    pctB[i] = upper[i] === lower[i] ? 0.5 : (closes[i] - lower[i]) / (upper[i] - lower[i]);
  }
  return { mid, upper, lower, width, pctB };
}

function trueRange(candles) {
  return candles.map((c, i) => {
    if (i === 0) return c.h - c.l;
    const pc = candles[i - 1].c;
    return Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc));
  });
}

/** Average True Range (Wilder). */
function atr(candles, n = 14) {
  return wilder(trueRange(candles), n, 1);
}

/** ADX with +DI / −DI (Wilder). */
function adx(candles, n = 14) {
  const len = candles.length;
  const plusDM = [0];
  const minusDM = [0];
  for (let i = 1; i < len; i += 1) {
    const up = candles[i].h - candles[i - 1].h;
    const down = candles[i - 1].l - candles[i].l;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
  }
  const trS = wilder(trueRange(candles), n, 1);
  const pS = wilder(plusDM, n, 1);
  const mS = wilder(minusDM, n, 1);
  const plusDI = new Array(len).fill(null);
  const minusDI = new Array(len).fill(null);
  const dx = new Array(len).fill(0);
  let firstDx = -1;
  for (let i = 0; i < len; i += 1) {
    if (!isNum(trS[i]) || trS[i] === 0) continue;
    plusDI[i] = (100 * pS[i]) / trS[i];
    minusDI[i] = (100 * mS[i]) / trS[i];
    const sum = plusDI[i] + minusDI[i];
    dx[i] = sum === 0 ? 0 : (100 * Math.abs(plusDI[i] - minusDI[i])) / sum;
    if (firstDx < 0) firstDx = i;
  }
  const out = firstDx < 0 ? new Array(len).fill(null) : wilder(dx, n, firstDx);
  return { adx: out, plusDI, minusDI };
}

function highest(values, n) {
  const out = new Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i += 1) {
    let m = -Infinity;
    for (let j = i - n + 1; j <= i; j += 1) if (values[j] > m) m = values[j];
    out[i] = m;
  }
  return out;
}

function lowest(values, n) {
  const out = new Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i += 1) {
    let m = Infinity;
    for (let j = i - n + 1; j <= i; j += 1) if (values[j] < m) m = values[j];
    out[i] = m;
  }
  return out;
}

/** Slow stochastic: %K smoothed by `smooth`, %D = SMA(%K, 3). */
function stochastic(candles, n = 14, smooth = 3) {
  const hh = highest(candles.map((c) => c.h), n);
  const ll = lowest(candles.map((c) => c.l), n);
  const raw = candles.map((c, i) => {
    if (!isNum(hh[i])) return null;
    return hh[i] === ll[i] ? 50 : (100 * (c.c - ll[i])) / (hh[i] - ll[i]);
  });
  const smoothNullable = (arr, m) => {
    const first = arr.findIndex(isNum);
    const out = new Array(arr.length).fill(null);
    if (first < 0) return out;
    sma(arr.slice(first), m).forEach((v, j) => {
      out[first + j] = v;
    });
    return out;
  };
  const k = smoothNullable(raw, smooth);
  const d = smoothNullable(k, 3);
  return { k, d };
}

/** Supertrend. dir: 1 = price above the line (bullish), −1 = below (bearish). */
function supertrend(candles, n = 10, mult = 3) {
  const a = atr(candles, n);
  const line = new Array(candles.length).fill(null);
  const dir = new Array(candles.length).fill(null);
  let fu = null;
  let fl = null;
  for (let i = 0; i < candles.length; i += 1) {
    if (!isNum(a[i])) continue;
    const mid = (candles[i].h + candles[i].l) / 2;
    const bu = mid + mult * a[i];
    const bl = mid - mult * a[i];
    const pc = i > 0 ? candles[i - 1].c : candles[i].c;
    fu = fu === null || bu < fu || pc > fu ? bu : fu;
    fl = fl === null || bl > fl || pc < fl ? bl : fl;
    const prevDir = i > 0 && dir[i - 1] !== null ? dir[i - 1] : 1;
    let d = prevDir;
    if (prevDir === 1 && candles[i].c < fl) d = -1;
    else if (prevDir === -1 && candles[i].c > fu) d = 1;
    dir[i] = d;
    line[i] = d === 1 ? fl : fu;
  }
  return { line, dir };
}

/** On-Balance Volume. */
function obv(candles) {
  const out = [];
  let v = 0;
  candles.forEach((c, i) => {
    if (i > 0) {
      if (c.c > candles[i - 1].c) v += c.v;
      else if (c.c < candles[i - 1].c) v -= c.v;
    }
    out.push(v);
  });
  return out;
}

/** Rate of change over n bars, in percent. */
function roc(values, n) {
  return values.map((v, i) => (i >= n && values[i - n] ? ((v - values[i - n]) / values[i - n]) * 100 : null));
}

/** Session VWAP for intraday candles of ONE day (typical price × volume). */
function vwap(candles) {
  let pv = 0;
  let vol = 0;
  return candles.map((c) => {
    pv += ((c.h + c.l + c.c) / 3) * c.v;
    vol += c.v;
    return vol ? pv / vol : null;
  });
}

/** Classic floor pivots plus the Central Pivot Range, from one completed session. */
function pivots(prev) {
  const p = (prev.h + prev.l + prev.c) / 3;
  const bc = (prev.h + prev.l) / 2;
  const tc = 2 * p - bc;
  return {
    p,
    r1: 2 * p - prev.l,
    s1: 2 * p - prev.h,
    r2: p + (prev.h - prev.l),
    s2: p - (prev.h - prev.l),
    r3: prev.h + 2 * (p - prev.l),
    s3: prev.l - 2 * (prev.h - p),
    cprTop: Math.max(tc, bc),
    cprBottom: Math.min(tc, bc),
  };
}

/**
 * Swing highs/lows: a bar whose high (low) is the extreme of `span` bars on each side.
 * Only confirmed swings are returned (the last `span` bars cannot be swings yet).
 */
function swings(candles, span = 5) {
  const highs = [];
  const lows = [];
  for (let i = span; i < candles.length - span; i += 1) {
    let isH = true;
    let isL = true;
    for (let j = i - span; j <= i + span; j += 1) {
      if (j === i) continue;
      if (candles[j].h >= candles[i].h) isH = false;
      if (candles[j].l <= candles[i].l) isL = false;
    }
    if (isH) highs.push({ i, price: candles[i].h, t: candles[i].t });
    if (isL) lows.push({ i, price: candles[i].l, t: candles[i].t });
  }
  return { highs, lows };
}

/**
 * Support and resistance: swing prices clustered within `tolPct` of each other,
 * split by where they sit relative to the last close. More touches = stronger.
 */
function supportResistance(candles, { span = 5, lookback = 250, tolPct = 1.2, max = 4 } = {}) {
  const from = Math.max(0, candles.length - lookback);
  const slice = candles.slice(from);
  if (slice.length < span * 2 + 1) return { supports: [], resistances: [] };
  const { highs, lows } = swings(slice, span);
  const points = [...highs, ...lows].map((p) => p.price).sort((a, b) => a - b);
  const clusters = [];
  for (const price of points) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(price - last.price) / last.price <= tolPct / 100) {
      last.price = (last.price * last.touches + price) / (last.touches + 1);
      last.touches += 1;
    } else clusters.push({ price, touches: 1 });
  }
  const close = candles[candles.length - 1].c;
  const supports = clusters
    .filter((c) => c.price < close)
    .sort((a, b) => b.price - a.price)
    .slice(0, max);
  const resistances = clusters
    .filter((c) => c.price > close)
    .sort((a, b) => a.price - b.price)
    .slice(0, max);
  return { supports, resistances };
}

/** Candlestick patterns completed on bar i. Deliberately a short, well-defined list. */
function candlePatterns(candles, i) {
  const out = [];
  if (i < 1) return out;
  const c = candles[i];
  const p = candles[i - 1];
  const body = Math.abs(c.c - c.o);
  const range = c.h - c.l;
  if (range <= 0) return out;
  const upper = c.h - Math.max(c.c, c.o);
  const lower = Math.min(c.c, c.o) - c.l;
  const pBody = Math.abs(p.c - p.o);

  if (body / range < 0.1) out.push({ name: "Doji", bias: "neutral", note: "Indecision — open and close almost equal" });
  if (lower >= 2 * body && upper <= body * 0.6 && body / range >= 0.1) {
    out.push({ name: "Hammer", bias: "bullish", note: "Long lower wick — sellers were rejected" });
  }
  if (upper >= 2 * body && lower <= body * 0.6 && body / range >= 0.1) {
    out.push({ name: "Shooting star", bias: "bearish", note: "Long upper wick — buyers were rejected" });
  }
  if (c.c > c.o && p.c < p.o && c.c >= p.o && c.o <= p.c && body > pBody) {
    out.push({ name: "Bullish engulfing", bias: "bullish", note: "Up day swallows the previous down day" });
  }
  if (c.c < c.o && p.c > p.o && c.o >= p.c && c.c <= p.o && body > pBody) {
    out.push({ name: "Bearish engulfing", bias: "bearish", note: "Down day swallows the previous up day" });
  }
  if (c.h < p.h && c.l > p.l) out.push({ name: "Inside bar", bias: "neutral", note: "Range contraction inside the previous bar" });
  if (c.l > p.h) out.push({ name: "Gap up", bias: "bullish", note: "Whole bar above the previous high" });
  if (c.h < p.l) out.push({ name: "Gap down", bias: "bearish", note: "Whole bar below the previous low" });
  return out;
}

module.exports = {
  isNum,
  sma,
  ema,
  wilder,
  rsi,
  macd,
  bollinger,
  trueRange,
  atr,
  adx,
  highest,
  lowest,
  stochastic,
  supertrend,
  obv,
  roc,
  vwap,
  pivots,
  swings,
  supportResistance,
  candlePatterns,
};
