// The chart's arithmetic: turning Kite's candles into chart bars, building weekly / monthly /
// Heikin-Ashi bars, every indicator the chart offers, candlestick patterns, pivot points, a
// technical summary, and folding live ticks into the last bar. Pure functions, tested.
//
// Times: the chart's axis has no time zone, so every bar's time is the IST wall clock written
// as if it were UTC (seconds). The axis then reads 09:15 for the 09:15 IST bar, wherever the
// browser is.

export const IST_SEC = 5.5 * 3600;

export const INTERVALS = [
  { id: "minute", label: "1m", sec: 60, kite: "minute" },
  { id: "3minute", label: "3m", sec: 180, kite: "3minute" },
  { id: "5minute", label: "5m", sec: 300, kite: "5minute" },
  { id: "10minute", label: "10m", sec: 600, kite: "10minute" },
  { id: "15minute", label: "15m", sec: 900, kite: "15minute" },
  { id: "30minute", label: "30m", sec: 1800, kite: "30minute" },
  { id: "60minute", label: "1H", sec: 3600, kite: "60minute" },
  { id: "day", label: "1D", sec: 86400, kite: "day" },
  { id: "week", label: "1W", sec: 7 * 86400, kite: "day", group: "week" },
  { id: "month", label: "1M", sec: 30 * 86400, kite: "day", group: "month" },
];
export const intervalOf = (id) => INTERVALS.find((x) => x.id === id) || INTERVALS[7];

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const r4 = (x) => (fin(x) ? Math.round(x * 10000) / 10000 : x);

/** One Kite candle → a chart bar. Daily "YYYY-MM-DD" → that date at 00:00; intraday ISO → IST wall time. */
export function toBar(c) {
  const t = String(c.t);
  let time;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) time = Date.parse(`${t}T00:00:00Z`) / 1000;
  else {
    const ms = Date.parse(t.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    time = Math.round(ms / 1000) + IST_SEC;
  }
  return { time, open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v || 0 };
}
export const toBars = (candles) => (candles || []).map(toBar).filter((b) => fin(b.time)).sort((a, b) => a.time - b.time);

/** Daily bars → weekly (weeks start Monday) or monthly bars. */
export function aggregate(bars, group) {
  const key = (time) => {
    const d = new Date(time * 1000);
    if (group === "month") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
    const dow = (d.getUTCDay() + 6) % 7;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow) / 1000;
  };
  const out = [];
  for (const b of bars) {
    const k = key(b.time);
    const last = out[out.length - 1];
    if (last && last.time === k) {
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
      last.volume += b.volume;
    } else out.push({ time: k, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
  }
  return out;
}

export function heikinAshi(bars) {
  const out = [];
  bars.forEach((b, i) => {
    const close = (b.open + b.high + b.low + b.close) / 4;
    const open = i === 0 ? (b.open + b.close) / 2 : (out[i - 1].open + out[i - 1].close) / 2;
    out.push({ time: b.time, open: r4(open), high: Math.max(b.high, open, close), low: Math.min(b.low, open, close), close: r4(close), volume: b.volume });
  });
  return out;
}

/* ------------------------------------------------------------- indicators */

export function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let s = 0;
  for (let i = 0; i < values.length; i += 1) {
    s += values[i];
    if (i >= n) s -= values[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}
export function ema(values, n) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (n + 1);
  let prev = null;
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] === null || values[i] === undefined) continue;
    if (prev === null) {
      if (i >= n - 1) {
        let s = 0;
        let c = 0;
        for (let j = i - n + 1; j <= i; j += 1) {
          if (values[j] !== null) {
            s += values[j];
            c += 1;
          }
        }
        if (c === n) prev = s / n;
      }
    } else prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
export function wma(values, n) {
  const out = new Array(values.length).fill(null);
  const den = (n * (n + 1)) / 2;
  for (let i = n - 1; i < values.length; i += 1) {
    let s = 0;
    for (let j = 0; j < n; j += 1) s += values[i - j] * (n - j);
    out[i] = s / den;
  }
  return out;
}
/** Wilder's smoothing (RSI, ATR, ADX). */
function wilder(values, n) {
  const out = new Array(values.length).fill(null);
  let prev = null;
  let s = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (prev === null) {
      s += values[i];
      if (i === n - 1) prev = s / n;
    } else prev = (prev * (n - 1) + values[i]) / n;
    if (prev !== null) out[i] = prev;
  }
  return out;
}
export function bollinger(values, n = 20, mult = 2) {
  const mid = sma(values, n);
  const up = new Array(values.length).fill(null);
  const lo = new Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i += 1) {
    let v = 0;
    for (let j = i - n + 1; j <= i; j += 1) v += (values[j] - mid[i]) ** 2;
    const sd = Math.sqrt(v / n);
    up[i] = mid[i] + mult * sd;
    lo[i] = mid[i] - mult * sd;
  }
  return { mid, up, lo };
}
export function rsi(values, n = 14) {
  const g = [0];
  const l = [0];
  for (let i = 1; i < values.length; i += 1) {
    const d = values[i] - values[i - 1];
    g.push(Math.max(d, 0));
    l.push(Math.max(-d, 0));
  }
  const ag = wilder(g.slice(1), n);
  const al = wilder(l.slice(1), n);
  const out = [null];
  for (let i = 0; i < ag.length; i += 1) out.push(ag[i] === null ? null : al[i] === 0 ? 100 : 100 - 100 / (1 + ag[i] / al[i]));
  return out;
}
export function macd(values, fast = 12, slow = 26, signal = 9) {
  const f = ema(values, fast);
  const s = ema(values, slow);
  const line = values.map((_, i) => (f[i] !== null && s[i] !== null ? f[i] - s[i] : null));
  const sig = ema(line, signal);
  const hist = line.map((x, i) => (x !== null && sig[i] !== null ? x - sig[i] : null));
  return { line, signal: sig, hist };
}
export function trueRange(bars) {
  return bars.map((b, i) => (i === 0 ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close))));
}
export const atr = (bars, n = 14) => wilder(trueRange(bars), n);
export function stochastic(bars, n = 14, d = 3) {
  const k = bars.map((b, i) => {
    if (i < n - 1) return null;
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - n + 1; j <= i; j += 1) {
      hi = Math.max(hi, bars[j].high);
      lo = Math.min(lo, bars[j].low);
    }
    return hi === lo ? 50 : ((b.close - lo) / (hi - lo)) * 100;
  });
  const kk = k.map((x) => (x === null ? 0 : x));
  const dd = sma(kk, d).map((x, i) => (i >= n + d - 2 ? x : null));
  return { k, d: dd };
}
export function adx(bars, n = 14) {
  const pdm = [0];
  const ndm = [0];
  for (let i = 1; i < bars.length; i += 1) {
    const up = bars[i].high - bars[i - 1].high;
    const dn = bars[i - 1].low - bars[i].low;
    pdm.push(up > dn && up > 0 ? up : 0);
    ndm.push(dn > up && dn > 0 ? dn : 0);
  }
  const tr = wilder(trueRange(bars), n);
  const p = wilder(pdm, n);
  const m = wilder(ndm, n);
  const pdi = tr.map((t, i) => (t ? (100 * p[i]) / t : null));
  const mdi = tr.map((t, i) => (t ? (100 * m[i]) / t : null));
  const dx = pdi.map((x, i) => (x !== null && mdi[i] !== null && x + mdi[i] > 0 ? (100 * Math.abs(x - mdi[i])) / (x + mdi[i]) : 0));
  const firstDx = pdi.findIndex((x) => x !== null);
  const a = new Array(bars.length).fill(null);
  if (firstDx >= 0) {
    const sm = wilder(dx.slice(firstDx), n);
    sm.forEach((v, i) => (a[firstDx + i] = v));
  }
  return { adx: a, pdi, mdi };
}
/** VWAP that starts again each session (intraday) — or over the whole series (daily). */
export function vwap(bars, intraday = true) {
  let pv = 0;
  let vol = 0;
  let day = null;
  return bars.map((b) => {
    const d = Math.floor(b.time / 86400);
    if (intraday && d !== day) {
      pv = 0;
      vol = 0;
      day = d;
    }
    const tp = (b.high + b.low + b.close) / 3;
    pv += tp * (b.volume || 0);
    vol += b.volume || 0;
    return vol > 0 ? pv / vol : tp;
  });
}
export function supertrend(bars, n = 10, mult = 3) {
  const a = atr(bars, n);
  const out = new Array(bars.length).fill(null);
  const dir = new Array(bars.length).fill(0);
  let fu = null;
  let fl = null;
  let d = 1;
  for (let i = 0; i < bars.length; i += 1) {
    if (a[i] === null) continue;
    const mid = (bars[i].high + bars[i].low) / 2;
    const bu = mid + mult * a[i];
    const bl = mid - mult * a[i];
    const pc = i > 0 ? bars[i - 1].close : bars[i].close;
    fu = fu === null || bu < fu || pc > fu ? bu : fu;
    fl = fl === null || bl > fl || pc < fl ? bl : fl;
    if (d === 1 && bars[i].close < fl) d = -1;
    else if (d === -1 && bars[i].close > fu) d = 1;
    out[i] = d === 1 ? fl : fu;
    dir[i] = d;
  }
  return { line: out, dir };
}
export function obv(bars) {
  let v = 0;
  return bars.map((b, i) => {
    if (i > 0) v += b.close > bars[i - 1].close ? b.volume : b.close < bars[i - 1].close ? -b.volume : 0;
    return v;
  });
}
export function cci(bars, n = 20) {
  const tp = bars.map((b) => (b.high + b.low + b.close) / 3);
  const m = sma(tp, n);
  return tp.map((x, i) => {
    if (m[i] === null) return null;
    let md = 0;
    for (let j = i - n + 1; j <= i; j += 1) md += Math.abs(tp[j] - m[i]);
    md /= n;
    return md ? (x - m[i]) / (0.015 * md) : 0;
  });
}
export function williamsR(bars, n = 14) {
  return bars.map((b, i) => {
    if (i < n - 1) return null;
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - n + 1; j <= i; j += 1) {
      hi = Math.max(hi, bars[j].high);
      lo = Math.min(lo, bars[j].low);
    }
    return hi === lo ? -50 : ((hi - b.close) / (hi - lo)) * -100;
  });
}
export const roc = (values, n = 12) => values.map((x, i) => (i >= n && values[i - n] ? ((x - values[i - n]) / values[i - n]) * 100 : null));

/** Classic floor pivots from one bar (the previous session, week or month). */
export function pivots(b) {
  if (!b) return null;
  const p = (b.high + b.low + b.close) / 3;
  return { p, r1: 2 * p - b.low, s1: 2 * p - b.high, r2: p + (b.high - b.low), s2: p - (b.high - b.low), r3: b.high + 2 * (p - b.low), s3: b.low - 2 * (b.high - p) };
}

/* ------------------------------------------------------------ candlestick patterns */

/** The common single- and multi-bar patterns, as chart markers. */
export function patterns(bars) {
  const out = [];
  const body = (b) => Math.abs(b.close - b.open);
  const range = (b) => b.high - b.low || 1e-9;
  const up = (b) => b.close > b.open;
  for (let i = 2; i < bars.length; i += 1) {
    const b = bars[i];
    const p = bars[i - 1];
    const q = bars[i - 2];
    const lowerWick = Math.min(b.open, b.close) - b.low;
    const upperWick = b.high - Math.max(b.open, b.close);
    if (!up(p) && up(b) && b.open <= p.close && b.close >= p.open && body(b) > body(p)) out.push({ time: b.time, kind: "bull", text: "Bullish engulfing" });
    else if (up(p) && !up(b) && b.open >= p.close && b.close <= p.open && body(b) > body(p)) out.push({ time: b.time, kind: "bear", text: "Bearish engulfing" });
    else if (!up(q) && body(p) < 0.3 * body(q) && up(b) && b.close > (q.open + q.close) / 2) out.push({ time: b.time, kind: "bull", text: "Morning star" });
    else if (up(q) && body(p) < 0.3 * body(q) && !up(b) && b.close < (q.open + q.close) / 2) out.push({ time: b.time, kind: "bear", text: "Evening star" });
    else if (lowerWick > 2 * body(b) && upperWick < body(b) && body(b) / range(b) > 0.05 && p.close < q.close) out.push({ time: b.time, kind: "bull", text: "Hammer" });
    else if (upperWick > 2 * body(b) && lowerWick < body(b) && body(b) / range(b) > 0.05 && p.close > q.close) out.push({ time: b.time, kind: "bear", text: "Shooting star" });
    else if (body(b) / range(b) < 0.08) out.push({ time: b.time, kind: "neutral", text: "Doji" });
  }
  return out;
}

/* ------------------------------------------------------------- technical summary */

/**
 * A tally across moving averages and oscillators, the way market sites summarise a chart:
 * each votes buy, sell or neutral on the latest bar. A mechanical count, not advice.
 */
export function technicalSummary(bars) {
  if (!bars || bars.length < 30) return null;
  const c = bars.map((b) => b.close);
  const last = c[c.length - 1];
  const at = (arr) => arr[arr.length - 1];
  const vote = (cond, inv) => (cond ? "buy" : inv ? "sell" : "neutral");
  const mas = [];
  for (const n of [5, 10, 20, 50, 100, 200]) {
    if (c.length < n) continue;
    const s = at(sma(c, n));
    const e = at(ema(c, n));
    mas.push({ name: `SMA ${n}`, value: s, action: vote(last > s, last < s) });
    mas.push({ name: `EMA ${n}`, value: e, action: vote(last > e, last < e) });
  }
  const r = at(rsi(c, 14));
  const st = stochastic(bars, 14, 3);
  const k = at(st.k);
  const m = macd(c);
  const h = at(m.hist);
  const ad = adx(bars, 14);
  const cc = at(cci(bars, 20));
  const wr = at(williamsR(bars, 14));
  const rc = at(roc(c, 12));
  const osc = [
    { name: "RSI (14)", value: r, action: r === null ? "neutral" : vote(r > 55 && r < 70, r < 45 && r > 30) },
    { name: "Stochastic (14,3)", value: k, action: k === null ? "neutral" : vote(k < 20, k > 80) },
    { name: "MACD (12,26)", value: h, action: h === null ? "neutral" : vote(h > 0, h < 0) },
    { name: "ADX (14)", value: at(ad.adx), action: at(ad.adx) === null || at(ad.adx) < 20 ? "neutral" : vote(at(ad.pdi) > at(ad.mdi), at(ad.pdi) < at(ad.mdi)) },
    { name: "CCI (20)", value: cc, action: cc === null ? "neutral" : vote(cc > 100, cc < -100) },
    { name: "Williams %R", value: wr, action: wr === null ? "neutral" : vote(wr < -80, wr > -20) },
    { name: "ROC (12)", value: rc, action: rc === null ? "neutral" : vote(rc > 0, rc < 0) },
  ];
  const tally = (list) => {
    const buy = list.filter((x) => x.action === "buy").length;
    const sell = list.filter((x) => x.action === "sell").length;
    const score = list.length ? (buy - sell) / list.length : 0;
    const label = score >= 0.5 ? "Strong buy" : score >= 0.15 ? "Buy" : score <= -0.5 ? "Strong sell" : score <= -0.15 ? "Sell" : "Neutral";
    return { buy, sell, neutral: list.length - buy - sell, score, label };
  };
  const all = tally([...mas, ...osc]);
  return { overall: all, mas: { list: mas, ...tally(mas) }, oscillators: { list: osc, ...tally(osc) } };
}

/* ------------------------------------------------------------- live ticks */

/**
 * Fold the latest traded price into the bars: it updates the last bar, or opens a new one
 * when the tick belongs to a later interval. Daily-and-longer bars are only updated.
 * @param tickMs  the tick's time (ms, real UTC); price; cumVolume: the day's volume so far
 */
export function applyTick(bars, { price, tickMs }, intervalSec) {
  if (!bars.length || !fin(price)) return bars;
  const last = bars[bars.length - 1];
  if (intervalSec >= 86400) {
    const next = { ...last, close: price, high: Math.max(last.high, price), low: Math.min(last.low, price) };
    return [...bars.slice(0, -1), next];
  }
  const wall = Math.floor((tickMs || Date.now()) / 1000) + IST_SEC;
  const slot = Math.floor(wall / intervalSec) * intervalSec;
  if (slot > last.time) return [...bars, { time: slot, open: price, high: price, low: price, close: price, volume: 0 }];
  const next = { ...last, close: price, high: Math.max(last.high, price), low: Math.min(last.low, price) };
  return [...bars.slice(0, -1), next];
}
