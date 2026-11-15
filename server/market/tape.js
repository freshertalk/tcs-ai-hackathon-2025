"use strict";
// The tape read: what today's 1-minute bars say, in the numbers a trader looks at.
//
//   session       open, high, low, the opening range, where the price sits in the day's range
//   VWAP          the day's volume-weighted price and one deviation either side of it
//   RSI           Wilder's RSI(14) on 1-minute and on 5-minute closes, and a divergence against price
//   Bollinger     the 20-bar, 2-deviation bands on 5-minute closes: %B, the width, a squeeze,
//                 a close outside a band, a walk along one
//   volume        the last five minutes against the day's usual five, the biggest minute, the share
//                 of the day's volume traded in rising minutes, whether volume is building or fading
//   momentum      the move over 3, 5, 15 and 30 minutes
//   price action  higher highs and higher lows (or the reverse) on 5-minute bars, the last swing
//                 high and low, and what the last 5-minute candle did
//
// Pure arithmetic on bars: no AI, no network, no timer. TradeAI's agent, the flight deck and the
// level learner read it; it is one more reading beside the desk's engines, not a replacement.

const IST = 5.5 * 3600 * 1000;
const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const r1 = (x) => (num(x) ? Math.round(x * 10) / 10 : null);
const clock = (ms) => new Date(ms + IST).toISOString().slice(11, 16);
const pctOf = (a, b) => (num(a) && num(b) && b !== 0 ? ((a - b) / b) * 100 : null);

/** Wilder's RSI on closes. */
function rsi(closes, n = 14) {
  if (!Array.isArray(closes) || closes.length < n + 1) return null;
  let up = 0;
  let dn = 0;
  for (let i = 1; i <= n; i += 1) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) up += d;
    else dn -= d;
  }
  up /= n;
  dn /= n;
  for (let i = n + 1; i < closes.length; i += 1) {
    const d = closes[i] - closes[i - 1];
    up = (up * (n - 1) + Math.max(0, d)) / n;
    dn = (dn * (n - 1) + Math.max(0, -d)) / n;
  }
  return dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
}

/** 1-minute bars folded into n-minute bars. */
function fold(bars, minutes = 5) {
  const ms = minutes * 60000;
  const out = [];
  for (const b of bars) {
    const k = Math.floor(b.t / ms) * ms;
    const cur = out[out.length - 1];
    if (cur && cur.t === k) {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += num(b.v) ? b.v : 0;
    } else out.push({ t: k, o: b.o, h: b.h, l: b.l, c: b.c, v: num(b.v) ? b.v : 0 });
  }
  return out;
}

/** Bollinger bands on the last n closes: the mean and k standard deviations either side. */
function bollinger(closes, n = 20, k = 2) {
  if (!Array.isArray(closes) || closes.length < n) return null;
  const w = closes.slice(-n);
  const mid = w.reduce((a, x) => a + x, 0) / n;
  const sd = Math.sqrt(w.reduce((a, x) => a + (x - mid) ** 2, 0) / n);
  return { mid, upper: mid + k * sd, lower: mid - k * sd, sd };
}

/** The day's VWAP from bars, with the volume-weighted deviation of price around it. */
function vwapBands(bars) {
  let pv = 0;
  let v = 0;
  for (const b of bars) {
    const vol = num(b.v) && b.v > 0 ? b.v : 1;
    pv += ((b.h + b.l + b.c) / 3) * vol;
    v += vol;
  }
  if (!v) return null;
  const price = pv / v;
  let dev = 0;
  for (const b of bars) dev += ((b.h + b.l + b.c) / 3 - price) ** 2 * (num(b.v) && b.v > 0 ? b.v : 1);
  const sd = Math.sqrt(dev / v);
  return { price, sd, upper: price + sd, lower: price - sd };
}

/** What a candle did: an engulfing bar, a long wick against the move, an inside bar. */
function candleOf(prev, b) {
  if (!b) return "none";
  const range = b.h - b.l;
  if (!(range > 0)) return "flat";
  const body = Math.abs(b.c - b.o);
  const upper = b.h - Math.max(b.c, b.o);
  const lower = Math.min(b.c, b.o) - b.l;
  if (prev) {
    const pBody = Math.abs(prev.c - prev.o);
    if (b.c > b.o && prev.c < prev.o && b.c >= prev.o && b.o <= prev.c && body > pBody) return "bullish engulfing";
    if (b.c < b.o && prev.c > prev.o && b.c <= prev.o && b.o >= prev.c && body > pBody) return "bearish engulfing";
    if (b.h <= prev.h && b.l >= prev.l) return "inside bar";
  }
  if (upper >= range * 0.55 && body <= range * 0.35) return "long upper wick (sellers rejected the high)";
  if (lower >= range * 0.55 && body <= range * 0.35) return "long lower wick (buyers rejected the low)";
  if (body >= range * 0.75) return b.c > b.o ? "strong up bar" : "strong down bar";
  return "plain";
}

/**
 * @param bars today's 1-minute bars [{ t (ms), o, h, l, c, v }], oldest first
 * @param opts { now, last } — the latest price when the bars lag it
 * @returns the readings above, or { available: false, reason }
 */
function tapeRead(bars, opts = {}) {
  const now = opts.now || Date.now();
  const day = (Array.isArray(bars) ? bars : []).filter((b) => b && num(b.c) && b.t <= now).sort((a, b) => a.t - b.t);
  if (day.length < 5) return { available: false, reason: "Fewer than five 1-minute bars today: the tape is read once the session has started." };
  const last = num(opts.last) ? opts.last : day[day.length - 1].c;
  const closes = day.map((b) => b.c);
  const hi = day.reduce((m, b) => Math.max(m, b.h), -Infinity);
  const lo = day.reduce((m, b) => Math.min(m, b.l), Infinity);
  const first15 = day.filter((b) => b.t < day[0].t + 15 * 60000);
  const five = fold(day, 5);
  const done5 = five.filter((b) => b.t + 300000 <= now);
  const c5 = done5.map((b) => b.c);

  /* ---- VWAP */
  const vw = vwapBands(day);

  /* ---- RSI and its divergence: a new price extreme that the RSI does not confirm */
  const m1 = rsi(closes.slice(-80));
  const m5 = rsi(c5);
  let divergence = null;
  if (closes.length >= 45) {
    const a = closes.slice(-45, -15);
    const b = closes.slice(-15);
    const rA = rsi(closes.slice(0, closes.length - 15).slice(-60));
    if (num(rA) && num(m1)) {
      if (Math.max(...b) > Math.max(...a) && m1 < rA - 3) divergence = "bearish";
      else if (Math.min(...b) < Math.min(...a) && m1 > rA + 3) divergence = "bullish";
    }
  }

  /* ---- Bollinger on 5-minute closes */
  let band = null;
  const bb = bollinger(c5);
  if (bb) {
    const pctB = bb.upper > bb.lower ? (last - bb.lower) / (bb.upper - bb.lower) : 0.5;
    const width = ((bb.upper - bb.lower) / bb.mid) * 100;
    // a squeeze: the bands are narrower than they have been over the last 30 five-minute bars
    const widths = [];
    for (let i = 20; i <= c5.length; i += 1) {
      const x = bollinger(c5.slice(0, i));
      if (x) widths.push(((x.upper - x.lower) / x.mid) * 100);
    }
    const recent = widths.slice(-30);
    const squeeze = recent.length >= 6 && width <= Math.min(...recent) * 1.05;
    const tail = done5.slice(-3);
    const walk = tail.length === 3 && tail.every((b) => b.c >= bb.upper - bb.sd * 0.5) ? "upper" : tail.length === 3 && tail.every((b) => b.c <= bb.lower + bb.sd * 0.5) ? "lower" : null;
    band = { frame: "5-minute, 20 bars, 2 deviations", upper: r2(bb.upper), mid: r2(bb.mid), lower: r2(bb.lower), pctB: r2(pctB), widthPct: r2(width), squeeze, outside: last > bb.upper ? "above" : last < bb.lower ? "below" : null, walk };
  }

  /* ---- volume */
  const vols = day.map((b) => (num(b.v) ? b.v : 0));
  const total = vols.reduce((a, x) => a + x, 0);
  const last5 = vols.slice(-5).reduce((a, x) => a + x, 0);
  const avg5 = day.length > 5 ? (vols.slice(0, -5).reduce((a, x) => a + x, 0) / (day.length - 5)) * 5 : null;
  const avg1 = total / day.length;
  let big = null;
  day.forEach((b, i) => {
    if (!big || vols[i] > big.volume) big = { clock: clock(b.t), volume: vols[i], price: r2(b.c) };
  });
  const upVol = day.reduce((a, b, i) => a + (b.c >= b.o ? vols[i] : 0), 0);
  const v15 = vols.slice(-15).reduce((a, x) => a + x, 0);
  const p15 = vols.slice(-30, -15).reduce((a, x) => a + x, 0);
  const volume = total > 0
    ? {
        total: Math.round(total),
        last5: Math.round(last5),
        usual5: num(avg5) ? Math.round(avg5) : null,
        rel5: num(avg5) && avg5 > 0 ? r1(last5 / avg5) : null,
        biggestMinute: big ? { ...big, volume: Math.round(big.volume), timesUsual: avg1 > 0 ? r1(big.volume / avg1) : null } : null,
        risingMinutesSharePct: Math.round((upVol / total) * 100),
        trend: p15 > 0 ? (v15 > p15 * 1.25 ? "building" : v15 < p15 * 0.75 ? "fading" : "steady") : null,
      }
    : null;

  /* ---- momentum */
  const back = (n) => (closes.length > n ? r2(pctOf(last, closes[closes.length - 1 - n])) : null);

  /* ---- price action on 5-minute bars */
  const sw = { high: null, low: null };
  for (let i = 2; i < done5.length - 2; i += 1) {
    const b = done5[i];
    const around = [done5[i - 2], done5[i - 1], done5[i + 1], done5[i + 2]];
    if (around.every((x) => b.h >= x.h) && around.some((x) => b.h > x.h)) sw.high = { price: r2(b.h), clock: clock(b.t) };
    if (around.every((x) => b.l <= x.l) && around.some((x) => b.l < x.l)) sw.low = { price: r2(b.l), clock: clock(b.t) };
  }
  const t4 = done5.slice(-4);
  let structure = "not enough bars";
  if (t4.length === 4) {
    const hh = t4[3].h > t4[1].h && t4[2].h > t4[0].h;
    const hl = t4[3].l > t4[1].l && t4[2].l > t4[0].l;
    const lh = t4[3].h < t4[1].h && t4[2].h < t4[0].h;
    const ll = t4[3].l < t4[1].l && t4[2].l < t4[0].l;
    structure = hh && hl ? "higher highs and higher lows" : lh && ll ? "lower highs and lower lows" : hh && ll ? "widening range" : lh && hl ? "narrowing range" : "sideways";
  }
  let run = 0;
  for (let i = done5.length - 1; i > 0; i -= 1) {
    const d = Math.sign(done5[i].c - done5[i - 1].c);
    if (d === 0 || (run !== 0 && d !== Math.sign(run))) break;
    run += d;
  }

  /* ---- in words: the few things that stand out */
  const notes = [];
  if (vw) notes.push(`${last >= vw.price ? "Above" : "Below"} VWAP ${r2(vw.price)} (${r2(pctOf(last, vw.price))}%).`);
  if (num(m1)) notes.push(`1-minute RSI ${Math.round(m1)}${m1 >= 70 ? " — overbought" : m1 <= 30 ? " — oversold" : ""}${divergence ? `, ${divergence} divergence against price` : ""}.`);
  if (band) notes.push(band.outside ? `Outside the ${band.outside === "above" ? "upper" : "lower"} Bollinger band (%B ${band.pctB}).` : band.squeeze ? "Bollinger squeeze: the bands are at their narrowest of the last 30 bars — a move is being stored." : band.walk ? `Walking the ${band.walk} Bollinger band.` : `Inside the Bollinger bands (%B ${band.pctB}).`);
  if (volume && num(volume.rel5)) notes.push(`The last five minutes traded ${volume.rel5}× the usual five; volume is ${volume.trend || "steady"}.`);
  notes.push(`5-minute structure: ${structure}.`);

  return {
    available: true,
    asOf: clock(now),
    bars: day.length,
    last: r2(last),
    session: {
      open: r2(day[0].o),
      high: r2(hi),
      low: r2(lo),
      fromOpenPct: r2(pctOf(last, day[0].o)),
      rangePct: r2(pctOf(hi, lo)),
      placeInRangePct: hi > lo ? Math.round(((last - lo) / (hi - lo)) * 100) : 50,
      openingRange: first15.length && day[day.length - 1].t >= day[0].t + 15 * 60000 ? { high: r2(first15.reduce((m, b) => Math.max(m, b.h), -Infinity)), low: r2(first15.reduce((m, b) => Math.min(m, b.l), Infinity)) } : null,
    },
    vwap: vw ? { price: r2(vw.price), vsPct: r2(pctOf(last, vw.price)), side: last >= vw.price ? "above" : "below", upper1: r2(vw.upper), lower1: r2(vw.lower) } : null,
    rsi: { m1: r1(m1), m5: r1(m5), state: num(m1) ? (m1 >= 70 ? "overbought" : m1 <= 30 ? "oversold" : "neutral") : null, divergence },
    bollinger: band,
    volume,
    momentum: { m3Pct: back(3), m5Pct: back(5), m15Pct: back(15), m30Pct: back(30) },
    priceAction: { structure, swingHigh: sw.high, swingLow: sw.low, lastCandle5m: candleOf(done5[done5.length - 2], done5[done5.length - 1]), run5m: run },
    notes,
  };
}

module.exports = { tapeRead, rsi, fold, bollinger, vwapBands, candleOf };
