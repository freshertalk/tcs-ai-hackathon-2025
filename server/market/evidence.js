"use strict";
// The evidence desk: everything a day trader weighs before the next 5 and 15 minutes, each reading as a WITNESS that
// either leans up, leans down or says nothing — and each one measured, never believed.
//
// Two kinds of witness:
//
//   BAR WITNESSES   the day-trading techniques desks around the world actually use, read from the 5-minute bars: the
//                   opening-range breakout and its failure (Crabel; Zarattini, Barbon & Aziz 2024), the first-hour
//                   ("initial balance") break of the market-profile school, VWAP as trend, pullback, reclaim and stretch
//                   (the institutions' benchmark), the 9/20 EMA pullback, Supertrend flips and the central pivot range
//                   (the two most-watched tools on Indian desks), Camarilla H3/L3 fades and H4/L4 breaks, yesterday's
//                   high and low broken or rejected, gap-and-go against gap-fill, NR7 and inside-bar breaks (Crabel),
//                   the Bollinger squeeze (Bollinger; Carter), band fades with RSI, Connors' RSI(2), RSI divergence
//                   (Wilder), the volume climax, the liquidity sweep (Wyckoff's spring and upthrust), pin bars and
//                   engulfing bars, three-bar pushes, up-volume against down-volume, breakouts on heavy and on thin
//                   volume, the market's own push and relative strength. Because they need only bars, every one of them
//                   is replayed over the whole stored NIFTY 100 history and its record kept: how often the price really
//                   went its way 5 and 15 minutes later. A technique that does not work here is shown as not working.
//
//   LIVE WITNESSES  what is only known now: the order book price by price (the 5 best bids and offers Zerodha sends, on
//                   NSE and on BSE), every pending buy and sell order, the order-flow pressure, futures open interest
//                   against price (long build-up, short covering…), the option chain's walls, the NIFTY tide, the stock's
//                   own sector, India VIX, GIFT NIFTY, the US close and Asia. These cannot be replayed from stored bars,
//                   so each is kept with every call, checked 5 and 15 minutes later, and tallied live (server/evidence.js).
//
// THE CALL is a stacked model: the 15-minute forecaster's own call (server/market/horizon.js) plus every bar witness,
// fitted together by ridge regression on "it rose" and "it fell" (by at least 0.3 of a usual move for that time), then
// calibrated on sessions it had not seen so that 60% means 60%. It competes against the forecaster ALONE on unseen rows:
// when the techniques do not cut the miss, the call is the forecaster's and the page says so.
//
// Pure arithmetic: nothing here reads the market, the clock, a file or an AI.

const H = require("./horizon");
const I = require("./indicators");
const { bookStats } = require("./flow");

const BAR = H.BAR;
const HZ = [1, 3]; // bars of five minutes: 5 and 15 minutes
// What the model answers: the direction 5 and 15 minutes on, and "tb" — WHICH COMES FIRST within 30 minutes, a move of one
// usual 15-minute move up or the same move down (the triple-barrier label of López de Prado, "Advances in Financial Machine
// Learning", 2018: a trade ends at its target, at its stop, or at the clock, so that is what a forecast for a trader
// should be about).
const KEYS = [1, 3, "tb"];
const TB_BARS = 6; // the clock: 30 minutes
const TB_UNIT = Math.sqrt(3); // the two barriers: one usual 15-minute move away, either side
const UP_MIN = 0.3; // "it rose" / "it fell": by at least 0.3 of a usual move for that time
// A technique does not mean the same thing in a trend and in a range (an RSI extreme is a fade in a range and a sign of
// strength in a trend), so each technique has one weight for each. The regime is the efficiency ratio of the last hour
// (Kaufman): the net move over the distance travelled. A random walk of 12 bars gives about 0.29.
const TREND_ER = 0.4;
const MODEL_VERSION = 2; // tied to the list of witnesses below and to the forecaster's own inputs (H.MODEL_VERSION)
const LAMBDA = 6e-3;
const MIN_ROWS = 15000;
const NB = 25; // calibration bins over the raw score, 0 … 1
const CAL_PRIOR = 25;
const MIN_CAL = 1500;
const MIN_PROOF = 1000; // leaning calls on unseen rows before a lean may be called proven
const MIN_ADD = 0.001; // the techniques must cut the miss (Brier) by at least 0.1% against the forecaster alone
const LEDGER_MIN = 300; // times a witness must have spoken before its record says anything
const LEDGER_DAYS = 20; // …on at least this many sessions
const LEDGER_Z = 2.5; // …and its average must stand this many standard errors (counted between sessions) clear of nothing
const DECAY_DAY = H.DECAY_DAY;
const TIERS = ["strong", "clear", "slight"];

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const r4 = (x) => (num(x) ? Math.round(x * 10000) / 10000 : null);
const clip = (x, a) => (x > a ? a : x < -a ? -a : x);
const sgn = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);
const px = (x) => (num(x) ? (Math.round(x * 20) / 20).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
const pc0 = (p) => `${Math.round(p * 100)}%`;
const qty = (n) => (num(n) ? Math.round(n).toLocaleString("en-IN") : "—");
const sp = (x, d = 2) => (num(x) ? `${x > 0 ? "+" : ""}${x.toFixed(d)}%` : "—");

/* ================================================================================ a session, prepared */

/** An exponential average that starts at the first value (no empty warm-up: a session has only 75 bars). */
function emaSeed(values, n) {
  const k = 2 / (n + 1);
  const out = new Array(values.length);
  let e = values[0];
  for (let i = 0; i < values.length; i += 1) {
    e = i ? e + k * (values[i] - e) : values[i];
    out[i] = e;
  }
  return out;
}

/**
 * Everything the witnesses read, worked out once for a session's bars so far.
 * @param rawBars  the session's 5-minute bars (cleaned here)
 * @param ctx      { sigma, day, beta, vol[75], prevClose, prevHigh, prevLow, mkt: Float64Array|null } — the forecaster's own context
 */
function prep(rawBars, ctx = {}) {
  const bars = H.cleanBars(rawBars);
  const n = bars.length;
  if (!n) return null;
  const sigma = num(ctx.sigma) && ctx.sigma > 0 ? ctx.sigma : 0.0015;
  const c = bars.map((b) => b.c);
  const u = c.map((v) => v * sigma); // a usual 5-minute move, in rupees
  const vwap = new Array(n);
  const vsd = new Array(n);
  const rvol = new Array(n);
  const hiBefore = new Array(n);
  const loBefore = new Array(n);
  const hcBefore = new Array(n); // the highest CLOSE before this bar, and which bar it was
  const hcAt = new Array(n);
  const lcBefore = new Array(n);
  const lcAt = new Array(n);
  let pv = 0;
  let vv = 0;
  let pvv = 0;
  let hi = -Infinity;
  let lo = Infinity;
  let hc = -Infinity;
  let hcI = -1;
  let lc = Infinity;
  let lcI = -1;
  let vsum = 0;
  for (let i = 0; i < n; i += 1) {
    const b = bars[i];
    hiBefore[i] = hi;
    loBefore[i] = lo;
    hcBefore[i] = hc;
    hcAt[i] = hcI;
    lcBefore[i] = lc;
    lcAt[i] = lcI;
    const tp = (b.h + b.l + b.c) / 3;
    pv += tp * b.v;
    vv += b.v;
    pvv += tp * tp * b.v;
    vwap[i] = vv > 0 ? pv / vv : b.c;
    vsd[i] = vv > 0 ? Math.sqrt(Math.max(0, pvv / vv - vwap[i] * vwap[i])) : 0;
    const usual = ctx.vol && ctx.vol[b.s] > 0 ? ctx.vol[b.s] : i >= 3 ? vsum / i : 0;
    rvol[i] = usual > 0 ? b.v / usual : 1;
    vsum += b.v;
    if (b.h > hi) hi = b.h;
    if (b.l < lo) lo = b.l;
    if (b.c > hc) {
      hc = b.c;
      hcI = i;
    }
    if (b.c < lc) {
      lc = b.c;
      lcI = i;
    }
  }
  // the opening range (first 15 minutes) and the first hour: known once those bars are over
  const rangeOf = (lastSlot) => {
    let h = -Infinity;
    let l = Infinity;
    let at = -1;
    for (let i = 0; i < n; i += 1) {
      if (bars[i].s <= lastSlot) {
        if (bars[i].h > h) h = bars[i].h;
        if (bars[i].l < l) l = bars[i].l;
      } else {
        at = i;
        break;
      }
    }
    return at > 0 && h > -Infinity ? { h, l, at } : { h: NaN, l: NaN, at: -1 };
  };
  const or = rangeOf(2);
  const ib = rangeOf(11);
  const prevClose = num(ctx.prevClose) && ctx.prevClose > 0 ? ctx.prevClose : null;
  const pdH = num(ctx.prevHigh) ? ctx.prevHigh : null;
  const pdL = num(ctx.prevLow) ? ctx.prevLow : null;
  let piv = null;
  let cam = null;
  if (pdH !== null && pdL !== null && prevClose !== null && pdH > pdL) {
    const p = I.pivots({ h: pdH, l: pdL, c: prevClose });
    piv = { p: p.p, top: Math.max(p.cprTop, p.cprBottom), bottom: Math.min(p.cprTop, p.cprBottom), r1: p.r1, s1: p.s1 };
    const w = (pdH - pdL) * 1.1;
    cam = { h3: prevClose + w / 4, l3: prevClose - w / 4, h4: prevClose + w / 2, l4: prevClose - w / 2 };
  }
  // the market's move since the open, bar by bar (null when the session's market returns are not known)
  let mk = null;
  if (ctx.mkt) {
    mk = new Array(n);
    let acc = 0;
    let known = 0;
    for (let i = 0; i < n; i += 1) {
      const m = ctx.mkt[bars[i].s];
      if (num(m)) {
        acc += m;
        known += 1;
      }
      mk[i] = acc;
    }
    if (known < Math.min(3, n)) mk = null;
  }
  const dayR = num(ctx.day) && ctx.day > 0 ? ctx.day : sigma * 15;
  // the efficiency ratio of the last hour (12 bars, fewer early in the session): net move ÷ distance travelled
  const er = new Array(n).fill(0);
  for (let i = 3; i < n; i += 1) {
    const from = Math.max(0, i - 12);
    let path = 0;
    for (let j = from + 1; j <= i; j += 1) path += Math.abs(c[j] - c[j - 1]);
    er[i] = path > 0 ? Math.abs(c[i] - c[from]) / path : 0;
  }
  // the usual 5-minute move RIGHT NOW: the stock's own long-run figure blended half and half with what the last half-hour
  // actually did. Moves cluster (a busy stretch follows a busy one) and the open is twice as wide as midday, so a target
  // or a stop "one usual move away" has to be measured in the moves of the moment (the multiplicative volatility models of
  // Engle & Sokalska 2012 put it the same way: a daily level, a time-of-day shape, and what the last bars add).
  const sloc = new Array(n).fill(sigma);
  for (let i = 1; i < n; i += 1) {
    const from = Math.max(1, i - 5);
    let sq = 0;
    for (let j = from; j <= i; j += 1) sq += ((c[j] - c[j - 1]) / c[j - 1]) ** 2;
    sloc[i] = Math.sqrt(0.5 * sigma * sigma + 0.5 * Math.min(sq / (i - from + 1), 25 * sigma * sigma));
  }
  const closeSlot = num(ctx.closeSlot) && ctx.closeSlot >= 60 && ctx.closeSlot <= H.SESSION_BARS ? ctx.closeSlot : H.SESSION_BARS;
  return {
    bars, n, c, u, sigma, dayR, er, sloc, closeSlot, beta: num(ctx.beta) && ctx.beta > 0 ? ctx.beta : 1,
    vwap, vsd, rvol, hiBefore, loBefore, hcBefore, hcAt, lcBefore, lcAt,
    ema9: emaSeed(c, 9), ema20: emaSeed(c, 20),
    rsi14: I.rsi(c, 14), rsi2: I.rsi(c, 2), bb: I.bollinger(c, 20, 2), macd: I.macd(c), st: I.supertrend(bars, 10, 3), adx: I.adx(bars, 14), atr: I.atr(bars, 14),
    orH: or.h, orL: or.l, orAt: or.at, ibH: ib.h, ibL: ib.l, ibAt: ib.at,
    prevClose, pdH, pdL, piv, cam, mk,
    gap: prevClose ? (bars[0].o - prevClose) / prevClose : null,
    dayHigh: hi, dayLow: lo,
  };
}

/* ================================================================================ the bar witnesses */

const rng = (b) => b.h - b.l;
const upWick = (b) => b.h - Math.max(b.o, b.c);
const dnWick = (b) => Math.min(b.o, b.c) - b.l;
const bodyOf = (b) => Math.abs(b.c - b.o);
const crossed = (P, i, level, margin, vol = 0) => {
  if (!num(level) || i < 1) return 0;
  const m = margin * P.u[i];
  if (P.rvol[i] < vol) return 0;
  if (P.c[i] > level + m && P.c[i - 1] <= level + m) return 1;
  if (P.c[i] < level - m && P.c[i - 1] >= level - m) return -1;
  return 0;
};
const side = (s, up, down) => (s > 0 ? up : down);

/**
 * Every bar witness: `ev(P, i)` is what the bar says by itself (+1 up, −1 down, 0 nothing); a witness with `hold` keeps
 * speaking for that many bars after its event (a breakout is not forgotten one bar later). `say` puts it in words.
 */
const WITS = [
  {
    id: "orbBreak", fam: "Breakout", name: "Opening-range breakout", hold: 3,
    what: "A close beyond the first 15 minutes' high or low on above-usual volume. The oldest day-trading rule there is: the side that wins the opening range tends to keep the day.",
    ev: (P, i) => (P.orAt < 0 || i < P.orAt ? 0 : crossed(P, i, P.c[i] > P.orH ? P.orH : P.orL, 0.2, 1.2) * (P.c[i] > P.orH || P.c[i] < P.orL ? 1 : 0)),
    say: (P, i, s) => `closed ${side(s, "above", "below")} the opening range (${px(P.orL)}–${px(P.orH)}) on ${r2(P.rvol[i])}× usual volume`,
  },
  {
    id: "orbFail", fam: "Reversal", name: "Failed opening-range break (trap)", hold: 3,
    what: "The price looked beyond the opening range and came back inside. Breakout buyers are trapped and their stops feed the move the other way.",
    ev: (P, i) => {
      if (P.orAt < 0 || i < P.orAt + 1) return 0;
      let above = false;
      let below = false;
      for (let j = Math.max(P.orAt, i - 3); j <= i; j += 1) {
        if (P.bars[j].h > P.orH + 0.3 * P.u[j]) above = true;
        if (P.bars[j].l < P.orL - 0.3 * P.u[j]) below = true;
      }
      const m = 0.2 * P.u[i];
      if (above && P.c[i] < P.orH - m && P.c[i - 1] >= P.orH - m) return -1;
      if (below && P.c[i] > P.orL + m && P.c[i - 1] <= P.orL + m) return 1;
      return 0;
    },
    say: (P, i, s) => `went ${side(s, "below", "above")} the opening range and came back ${side(s, "above", "below")} ${px(s > 0 ? P.orL : P.orH)}`,
  },
  {
    id: "ibBreak", fam: "Breakout", name: "First-hour range break", hold: 3,
    what: "A close beyond the first hour's high or low (the market-profile school's initial balance): the day is extending its range.",
    ev: (P, i) => (P.ibAt < 0 || i < P.ibAt ? 0 : P.c[i] > P.ibH ? Math.max(0, crossed(P, i, P.ibH, 0.2)) : P.c[i] < P.ibL ? Math.min(0, crossed(P, i, P.ibL, 0.2)) : 0),
    say: (P, i, s) => `closed ${side(s, "above", "below")} the first hour's ${side(s, "high", "low")} ${px(s > 0 ? P.ibH : P.ibL)}`,
  },
  {
    id: "vwapTrend", fam: "Trend", name: "Holding one side of VWAP", hold: 1,
    what: "Eight closes in a row on one side of VWAP while VWAP itself moves that way: institutions are being filled on that side, the mark of a trend day.",
    ev: (P, i) => {
      if (i < 8) return 0;
      let up = true;
      let down = true;
      for (let j = i - 7; j <= i; j += 1) {
        if (P.c[j] <= P.vwap[j]) up = false;
        if (P.c[j] >= P.vwap[j]) down = false;
      }
      return up && P.vwap[i] > P.vwap[i - 6] ? 1 : down && P.vwap[i] < P.vwap[i - 6] ? -1 : 0;
    },
    say: (P, i, s) => `the last 8 closes are all ${side(s, "above", "below")} VWAP ${px(P.vwap[i])}, and VWAP is ${side(s, "rising", "falling")}`,
  },
  {
    id: "vwapPull", fam: "Pullback", name: "Pullback to VWAP in a trend", hold: 2,
    what: "In a move that has stayed on one side of VWAP, the price came back to VWAP and closed away from it again. The classic lower-risk entry with the trend.",
    ev: (P, i) => {
      if (i < 12) return 0;
      let above = 0;
      for (let j = i - 11; j <= i; j += 1) if (P.c[j] > P.vwap[j]) above += 1;
      const b = P.bars[i];
      const m = 0.5 * P.u[i];
      if (above >= 9 && P.c[i] > P.c[i - 12] && Math.min(b.l, P.bars[i - 1].l) <= P.vwap[i] + m && b.c > P.vwap[i] && b.c > b.o) return 1;
      if (above <= 3 && P.c[i] < P.c[i - 12] && Math.max(b.h, P.bars[i - 1].h) >= P.vwap[i] - m && b.c < P.vwap[i] && b.c < b.o) return -1;
      return 0;
    },
    say: (P, i, s) => `came back to VWAP ${px(P.vwap[i])} in ${side(s, "an up", "a down")}-move and closed ${side(s, "up", "down")} from it`,
  },
  {
    id: "vwapCross", fam: "Trend", name: "VWAP reclaimed or lost", hold: 2,
    what: "A close across VWAP on at least usual volume: the day's average buyer has just gone from losing to winning (or the reverse).",
    ev: (P, i) => (i < 3 ? 0 : crossed(P, i, P.vwap[i], 0.3, 1)),
    say: (P, i, s) => `closed ${side(s, "back above", "below")} VWAP ${px(P.vwap[i])} on ${r2(P.rvol[i])}× usual volume`,
  },
  {
    id: "vwapBand", fam: "Reversal", name: "Stretched beyond the VWAP band", hold: 1,
    what: "Two volume-weighted standard deviations from VWAP. Prices that far from the day's average tend to be pulled back toward it, unless the day is a strong trend.",
    ev: (P, i) => {
      if (i < 6 || !(P.vsd[i] > 0.5 * P.u[i])) return 0;
      const z = (P.c[i] - P.vwap[i]) / P.vsd[i];
      return z >= 2 ? -1 : z <= -2 ? 1 : 0;
    },
    say: (P, i, s) => `${r2(Math.abs((P.c[i] - P.vwap[i]) / P.vsd[i]))} band-widths ${side(s, "below", "above")} VWAP ${px(P.vwap[i])}`,
  },
  {
    id: "emaPull", fam: "Pullback", name: "Pullback to the 20 EMA", hold: 2,
    what: "With the 9 EMA over a rising 20 EMA, the price dipped to the 20 EMA and closed back over the 9. The trend trader's bread and butter.",
    ev: (P, i) => {
      if (i < 10) return 0;
      const b = P.bars[i];
      const m = 0.3 * P.u[i];
      if (P.ema9[i] > P.ema20[i] && P.ema20[i] > P.ema20[i - 3] && Math.min(b.l, P.bars[i - 1].l) <= P.ema20[i] + m && b.c > P.ema9[i] && b.c > b.o) return 1;
      if (P.ema9[i] < P.ema20[i] && P.ema20[i] < P.ema20[i - 3] && Math.max(b.h, P.bars[i - 1].h) >= P.ema20[i] - m && b.c < P.ema9[i] && b.c < b.o) return -1;
      return 0;
    },
    say: (P, i, s) => `tested the 20 EMA ${px(P.ema20[i])} and closed ${side(s, "above", "below")} the 9 EMA ${px(P.ema9[i])}`,
  },
  {
    id: "emaCross", fam: "Trend", name: "9 EMA crossing the 20 EMA", hold: 3,
    what: "The fast average crossing the slow one: the short-term trend has changed side.",
    ev: (P, i) => {
      if (i < 6) return 0;
      const d1 = P.ema9[i] - P.ema20[i];
      const d0 = P.ema9[i - 1] - P.ema20[i - 1];
      return d0 <= 0 && d1 > 0 ? 1 : d0 >= 0 && d1 < 0 ? -1 : 0;
    },
    say: (P, i, s) => `the 9 EMA crossed ${side(s, "above", "below")} the 20 EMA near ${px(P.ema20[i])}`,
  },
  {
    id: "stFlip", fam: "Trend", name: "Supertrend flip", hold: 3,
    what: "Supertrend (10, 3) changed side: the price closed through an ATR-based trailing line. Among the most-followed signals on Indian intraday charts.",
    ev: (P, i) => (i >= 1 && P.st.dir[i] !== null && P.st.dir[i - 1] !== null && P.st.dir[i] !== P.st.dir[i - 1] ? P.st.dir[i] : 0),
    say: (P, i, s) => `Supertrend turned ${side(s, "up", "down")} (line ${px(P.st.line[i])})`,
  },
  {
    id: "macdCross", fam: "Trend", name: "MACD histogram through zero", hold: 2,
    what: "MACD (12, 26, 9) crossing its signal line: momentum has changed sign.",
    ev: (P, i) => {
      const h = P.macd.hist;
      if (i < 1 || !num(h[i]) || !num(h[i - 1])) return 0;
      return h[i - 1] <= 0 && h[i] > 0 ? 1 : h[i - 1] >= 0 && h[i] < 0 ? -1 : 0;
    },
    say: (P, i, s) => `MACD crossed ${side(s, "above", "below")} its signal line`,
  },
  {
    id: "adxTrend", fam: "Trend", name: "ADX trend strength", hold: 1,
    what: "ADX above 25 and rising says a trend is on and strengthening; +DI against −DI says which way.",
    ev: (P, i) => (i >= 3 && num(P.adx.adx[i]) && num(P.adx.adx[i - 3]) && P.adx.adx[i] >= 25 && P.adx.adx[i] > P.adx.adx[i - 3] ? sgn(P.adx.plusDI[i] - P.adx.minusDI[i]) : 0),
    say: (P, i, s) => `ADX ${r2(P.adx.adx[i])} and rising, ${side(s, "+DI over −DI", "−DI over +DI")}`,
  },
  {
    id: "pdBreak", fam: "Breakout", name: "Yesterday's high or low broken", hold: 3,
    what: "A close beyond yesterday's high or low: the level every chart shows, and where yesterday's traders have their stops.",
    ev: (P, i) => (P.pdH === null ? 0 : P.c[i] > P.pdH ? Math.max(0, crossed(P, i, P.pdH, 0.2)) : P.c[i] < P.pdL ? Math.min(0, crossed(P, i, P.pdL, 0.2)) : 0),
    say: (P, i, s) => `closed ${side(s, "above yesterday's high", "below yesterday's low")} ${px(s > 0 ? P.pdH : P.pdL)}`,
  },
  {
    id: "pdReject", fam: "Reversal", name: "Rejected at yesterday's high or low", hold: 2,
    what: "The price reached yesterday's high (or low) and was thrown back, leaving a wick: the level held.",
    ev: (P, i) => {
      if (P.pdH === null) return 0;
      const b = P.bars[i];
      const r = rng(b);
      if (r <= 0) return 0;
      if (b.h >= P.pdH && b.c < P.pdH - 0.3 * P.u[i] && upWick(b) >= 0.4 * r) return -1;
      if (b.l <= P.pdL && b.c > P.pdL + 0.3 * P.u[i] && dnWick(b) >= 0.4 * r) return 1;
      return 0;
    },
    say: (P, i, s) => `touched yesterday's ${side(s, "low", "high")} ${px(s > 0 ? P.pdL : P.pdH)} and was turned back`,
  },
  {
    id: "cprSide", fam: "Trend", name: "Side of the central pivot range", hold: 1,
    what: "Above the central pivot range (from yesterday's high, low and close) the day's bias is up; below it, down. The first thing an Indian intraday desk marks.",
    ev: (P, i) => (!P.piv ? 0 : P.c[i] > P.piv.top + 0.2 * P.u[i] ? 1 : P.c[i] < P.piv.bottom - 0.2 * P.u[i] ? -1 : 0),
    say: (P, i, s) => `${side(s, "above", "below")} the central pivot range (${px(P.piv.bottom)}–${px(P.piv.top)})`,
  },
  {
    id: "camFade", fam: "Reversal", name: "Camarilla H3 / L3 rejection", hold: 2,
    what: "Camarilla's third level is where range days turn: a touch of H3 that closes back under it is faded, and L3 the same from below.",
    ev: (P, i) => {
      if (!P.cam) return 0;
      const b = P.bars[i];
      if (b.h >= P.cam.h3 && b.c < P.cam.h3 && b.c < b.o) return -1;
      if (b.l <= P.cam.l3 && b.c > P.cam.l3 && b.c > b.o) return 1;
      return 0;
    },
    say: (P, i, s) => `turned back from Camarilla ${side(s, "L3", "H3")} ${px(s > 0 ? P.cam.l3 : P.cam.h3)}`,
  },
  {
    id: "camBreak", fam: "Breakout", name: "Camarilla H4 / L4 break", hold: 3,
    what: "A close beyond Camarilla's fourth level: the range has failed and the day has become a trend.",
    ev: (P, i) => (!P.cam ? 0 : P.c[i] > P.cam.h4 ? Math.max(0, crossed(P, i, P.cam.h4, 0.2)) : P.c[i] < P.cam.l4 ? Math.min(0, crossed(P, i, P.cam.l4, 0.2)) : 0),
    say: (P, i, s) => `closed ${side(s, "above Camarilla H4", "below Camarilla L4")} ${px(s > 0 ? P.cam.h4 : P.cam.l4)}`,
  },
  {
    id: "gapGo", fam: "Breakout", name: "Gap and go", hold: 1,
    what: "A real gap at the open that the first hours extend beyond the opening range: the news is being bought (or sold), not faded.",
    ev: (P, i) => {
      const s = P.bars[i].s;
      if (P.gap === null || P.orAt < 0 || s < 3 || s > 24 || Math.abs(P.gap) < 0.3 * P.dayR) return 0;
      return P.gap > 0 && P.c[i] > P.orH ? 1 : P.gap < 0 && P.c[i] < P.orL ? -1 : 0;
    },
    say: (P, i, s) => `gapped ${side(s, "up", "down")} ${sp(P.gap * 100)} and is ${side(s, "above", "below")} the opening range`,
  },
  {
    id: "gapFill", fam: "Reversal", name: "Gap being filled", hold: 1,
    what: "A gap that loses its opening range heads back to yesterday's close more often than not: the gap is being filled.",
    ev: (P, i) => {
      const s = P.bars[i].s;
      if (P.gap === null || P.orAt < 0 || s < 3 || s > 24 || Math.abs(P.gap) < 0.3 * P.dayR) return 0;
      return P.gap > 0 && P.c[i] < P.orL && P.c[i] > P.prevClose ? -1 : P.gap < 0 && P.c[i] > P.orH && P.c[i] < P.prevClose ? 1 : 0;
    },
    say: (P, i, s) => `gapped ${side(s, "down", "up")} ${sp(P.gap * 100)}, lost its opening range and is heading for yesterday's close ${px(P.prevClose)}`,
  },
  {
    id: "nr7Break", fam: "Breakout", name: "Break of a narrow bar (NR7)", hold: 2,
    what: "After the narrowest bar of the last seven, the next close beyond it: quiet is followed by movement (Crabel's volatility contraction).",
    ev: (P, i) => {
      if (i < 7) return 0;
      const r = rng(P.bars[i - 1]);
      for (let j = i - 7; j < i - 1; j += 1) if (rng(P.bars[j]) < r) return 0;
      return P.c[i] > P.bars[i - 1].h ? 1 : P.c[i] < P.bars[i - 1].l ? -1 : 0;
    },
    say: (P, i, s) => `broke ${side(s, "above", "below")} the narrowest bar of the last seven`,
  },
  {
    id: "insideBreak", fam: "Breakout", name: "Inside-bar break", hold: 2,
    what: "A bar wholly inside the one before it, then a close beyond that mother bar: indecision resolved.",
    ev: (P, i) => {
      if (i < 2) return 0;
      const a = P.bars[i - 2];
      const b = P.bars[i - 1];
      if (!(b.h <= a.h && b.l >= a.l)) return 0;
      return P.c[i] > a.h ? 1 : P.c[i] < a.l ? -1 : 0;
    },
    say: (P, i, s) => `closed ${side(s, "above", "below")} an inside bar's mother bar`,
  },
  {
    id: "sqzBreak", fam: "Breakout", name: "Bollinger squeeze released", hold: 3,
    what: "The bands (20, 2) were at their tightest of the last 20 bars and the price has now closed outside one: the squeeze has fired.",
    ev: (P, i) => {
      const w = P.bb.width;
      if (i < 12 || !num(w[i - 1]) || !num(P.bb.pctB[i])) return 0;
      let min = Infinity;
      let k = 0;
      for (let j = Math.max(0, i - 20); j < i; j += 1) {
        if (num(w[j])) {
          k += 1;
          if (w[j] < min) min = w[j];
        }
      }
      if (k < 8 || w[i - 1] > 1.15 * min) return 0;
      return P.bb.pctB[i] > 1 ? 1 : P.bb.pctB[i] < 0 ? -1 : 0;
    },
    say: (P, i, s) => `closed ${side(s, "above the upper", "below the lower")} Bollinger band out of a squeeze`,
  },
  {
    id: "bbFade", fam: "Reversal", name: "Outside the band with RSI at an extreme", hold: 1,
    what: "A close outside the Bollinger band with RSI(14) past 70 or 30 while ADX shows no strong trend: the range-trader's fade.",
    ev: (P, i) => {
      const b = P.bb.pctB[i];
      const r = P.rsi14[i];
      if (!num(b) || !num(r) || (num(P.adx.adx[i]) && P.adx.adx[i] >= 25)) return 0;
      return b > 1.05 && r >= 70 ? -1 : b < -0.05 && r <= 30 ? 1 : 0;
    },
    say: (P, i, s) => `${side(s, "below the lower", "above the upper")} Bollinger band with RSI ${r2(P.rsi14[i])} and no strong trend`,
  },
  {
    id: "rsi2", fam: "Reversal", name: "RSI(2) at an extreme", hold: 1,
    what: "Connors' two-period RSI below 5 or above 95: the last two bars have run as far as they usually do before a bounce.",
    ev: (P, i) => (i < 4 || !num(P.rsi2[i]) ? 0 : P.rsi2[i] >= 95 ? -1 : P.rsi2[i] <= 5 ? 1 : 0),
    say: (P, i) => `RSI(2) is ${r2(P.rsi2[i])}`,
  },
  {
    id: "rsiDiv", fam: "Reversal", name: "RSI divergence", hold: 3,
    what: "A new high in price on a lower RSI than the last high (or a new low on a higher RSI): the move is running out of force (Wilder).",
    ev: (P, i) => {
      const r = P.rsi14;
      if (i < 20 || !num(r[i])) return 0;
      const j = P.hcAt[i];
      if (j >= 0 && j <= i - 4 && P.c[i] > P.hcBefore[i] && num(r[j]) && r[j] >= 60 && r[i] <= r[j] - 3) return -1;
      const k = P.lcAt[i];
      if (k >= 0 && k <= i - 4 && P.c[i] < P.lcBefore[i] && num(r[k]) && r[k] <= 40 && r[i] >= r[k] + 3) return 1;
      return 0;
    },
    say: (P, i, s) => `a new ${side(s, "low", "high")} for the day, but RSI ${r2(P.rsi14[i])} is ${side(s, "higher", "lower")} than at the last one`,
  },
  {
    id: "climax", fam: "Reversal", name: "Volume climax", hold: 2,
    what: "After an extended run, one very wide bar on three times the usual volume: the last buyers (or sellers) have rushed in, and there is nobody left to continue.",
    ev: (P, i) => {
      if (i < 6) return 0;
      const b = P.bars[i];
      const d = sgn(b.c - b.o);
      const move = P.c[i] - P.c[i - 6];
      return d && P.rvol[i] >= 3 && rng(b) >= 2.5 * P.u[i] && sgn(move) === d && Math.abs(move) >= 3 * P.u[i] ? -d : 0;
    },
    say: (P, i, s) => `a very wide ${side(s, "falling", "rising")} bar on ${r2(P.rvol[i])}× usual volume after a long run: exhaustion`,
  },
  {
    id: "sweep", fam: "Reversal", name: "Liquidity sweep (stop hunt)", hold: 2,
    what: "The bar took out the day's high (or low), where the stops rest, and closed back inside with a long wick: Wyckoff's upthrust and spring.",
    ev: (P, i) => {
      if (i < 6) return 0;
      const b = P.bars[i];
      const r = rng(b);
      if (r < P.u[i]) return 0;
      if (b.h > P.hiBefore[i] && b.c < P.hiBefore[i] && upWick(b) >= 0.5 * r) return -1;
      if (b.l < P.loBefore[i] && b.c > P.loBefore[i] && dnWick(b) >= 0.5 * r) return 1;
      return 0;
    },
    say: (P, i, s) => `took out the day's ${side(s, "low", "high")} ${px(s > 0 ? P.loBefore[i] : P.hiBefore[i])} and closed back inside`,
  },
  {
    id: "pinBar", fam: "Reversal", name: "Pin bar (long rejection wick)", hold: 1,
    what: "A bar whose wick is most of its range: the price was pushed one way and rejected within five minutes.",
    ev: (P, i) => {
      const b = P.bars[i];
      const r = rng(b);
      if (r < 1.3 * P.u[i]) return 0;
      return dnWick(b) >= 0.6 * r ? 1 : upWick(b) >= 0.6 * r ? -1 : 0;
    },
    say: (P, i, s) => `a long ${side(s, "lower", "upper")} wick: the ${side(s, "fall", "rise")} was rejected`,
  },
  {
    id: "engulf", fam: "Reversal", name: "Engulfing bar on volume", hold: 1,
    what: "A bar whose body swallows the previous bar's body the other way, on above-usual volume: control changed hands.",
    ev: (P, i) => {
      if (i < 1) return 0;
      const a = P.bars[i - 1];
      const b = P.bars[i];
      const d = sgn(b.c - b.o);
      if (!d || sgn(a.c - a.o) !== -d || bodyOf(a) <= 0 || bodyOf(b) <= bodyOf(a)) return 0;
      if (Math.max(b.o, b.c) < Math.max(a.o, a.c) || Math.min(b.o, b.c) > Math.min(a.o, a.c)) return 0;
      return rng(b) >= 1.2 * P.u[i] && P.rvol[i] >= 1.2 ? d : 0;
    },
    say: (P, i, s) => `a ${side(s, "bullish", "bearish")} engulfing bar on ${r2(P.rvol[i])}× usual volume`,
  },
  {
    id: "threeBar", fam: "Trend", name: "Three pushes in a row", hold: 1,
    what: "Three bars each with a higher high, a higher low and a higher close (or the mirror): momentum in its plainest form.",
    ev: (P, i) => {
      if (i < 3) return 0;
      let up = true;
      let down = true;
      for (let j = i - 2; j <= i; j += 1) {
        const a = P.bars[j - 1];
        const b = P.bars[j];
        if (!(b.h > a.h && b.l > a.l && b.c > a.c)) up = false;
        if (!(b.h < a.h && b.l < a.l && b.c < a.c)) down = false;
      }
      return up ? 1 : down ? -1 : 0;
    },
    say: (P, i, s) => `three bars in a row with ${side(s, "higher highs and higher lows", "lower highs and lower lows")}`,
  },
  {
    id: "volPush", fam: "Volume", name: "Up-volume against down-volume", hold: 1,
    what: "Of the last half-hour's volume, how much traded in rising bars against falling ones: who has been the aggressor.",
    ev: (P, i) => {
      if (i < 5) return 0;
      let signed = 0;
      let all = 0;
      for (let j = i - 5; j <= i; j += 1) {
        signed += P.bars[j].v * sgn(P.bars[j].c - P.bars[j].o);
        all += P.bars[j].v;
      }
      const x = all > 0 ? signed / all : 0;
      return x >= 0.5 ? 1 : x <= -0.5 ? -1 : 0;
    },
    say: (P, i, s) => `most of the last half-hour's volume traded in ${side(s, "rising", "falling")} bars`,
  },
  {
    id: "newHighVol", fam: "Volume", name: "New high or low on heavy volume", hold: 2,
    what: "A new closing high (or low) for the day on nearly twice the usual volume: the breakout has real participation behind it.",
    ev: (P, i) => (i < 6 || P.rvol[i] < 1.8 ? 0 : P.c[i] > P.hcBefore[i] ? 1 : P.c[i] < P.lcBefore[i] ? -1 : 0),
    say: (P, i, s) => `a new closing ${side(s, "high", "low")} for the day on ${r2(P.rvol[i])}× usual volume`,
  },
  {
    id: "thinHigh", fam: "Volume", name: "New high or low on thin volume", hold: 2,
    what: "A new closing high (or low) on well under the usual volume: nobody followed the move, and such breaks often fail.",
    ev: (P, i) => (i < 6 || P.rvol[i] > 0.6 ? 0 : P.c[i] > P.hcBefore[i] ? -1 : P.c[i] < P.lcBefore[i] ? 1 : 0),
    say: (P, i, s) => `a new closing ${side(s, "low", "high")} for the day on only ${r2(P.rvol[i])}× usual volume`,
  },
  {
    id: "mktPush", fam: "Market", name: "The market's own last 15 minutes", hold: 1,
    what: "NIFTY's move over the last three bars, scaled by this stock's beta: most stocks are carried by the index most of the time.",
    ev: (P, i) => {
      if (!P.mk || i < 3) return 0;
      const m3 = P.mk[i] - P.mk[i - 3];
      return Math.abs(m3) * P.beta >= 0.5 * P.sigma * Math.sqrt(3) ? sgn(m3) : 0;
    },
    say: (P, i, s) => `the market ${side(s, "rose", "fell")} ${sp((P.mk[i] - P.mk[i - 3]) * 100)} in the last 15 minutes`,
  },
  {
    id: "rsLead", fam: "Market", name: "Relative strength against the market", hold: 1,
    what: "The stock's move since the open beyond what the market's move (times its beta) explains. Leaders tend to keep leading, laggards to keep lagging.",
    ev: (P, i) => {
      if (!P.mk || i < 3) return 0;
      const rel = P.c[i] / P.bars[0].o - 1 - P.beta * P.mk[i];
      return Math.abs(rel) >= 1.2 * P.sigma * Math.sqrt(i + 1) ? sgn(rel) : 0;
    },
    say: (P, i, s) => `${side(s, "stronger", "weaker")} than the market since the open by ${sp(Math.abs(P.c[i] / P.bars[0].o - 1 - P.beta * P.mk[i]) * 100)}`,
  },
  // ---- added on 2026-11-20 from published research (each is measured here like the rest; none is assumed to work on NSE) ----
  {
    id: "eodMkt", fam: "Time of day", name: "The market's day carried into the last half-hour", hold: 1,
    what: "In the last 30 minutes of continuous trading the index tends to continue the move it has made since the previous close, as hedgers and funds finish the day's orders (Baltussen, Da, Lammers & Martens 2021).",
    ev: (P, i) => {
      if (!P.mk || P.bars[i].s < P.closeSlot - 6) return 0;
      return Math.abs(P.mk[i]) * P.beta >= 0.6 * P.sigma * Math.sqrt(i + 1) ? sgn(P.mk[i]) : 0;
    },
    say: (P, i, s) => `the market is ${sp(P.mk[i] * 100)} since the open with the last half-hour under way: such days tend to finish the same way`,
  },
  {
    id: "eodLoser", fam: "Time of day", name: "The day's laggard bouncing into the close", hold: 1,
    what: "A stock that has fallen behind the market by an hour before the close tends to recover part of it in the last half-hour: sellers who had to sell are done, and intraday shorts are covered (Soebhag, Baltussen & Da 2025).",
    ev: (P, i) => (eodRel(P, i) <= -0.8 ? 1 : 0),
    say: (P) => `an hour before the close it was ${sp(eodRelPct(P))} behind what the market's move explains`,
  },
  {
    id: "eodWinner", fam: "Time of day", name: "The day's leader given back into the close", hold: 1,
    what: "The mirror of the laggard's bounce: a stock well ahead of the market an hour before the close tends to give a little back in the last half-hour. The published effect is weaker than for laggards.",
    ev: (P, i) => (eodRel(P, i) >= 0.8 ? -1 : 0),
    say: (P) => `an hour before the close it was ${sp(eodRelPct(P))} ahead of what the market's move explains`,
  },
  {
    id: "jumpDown", fam: "Reversal", name: "A sudden drop with nothing behind it", hold: 2,
    what: "A 5-minute fall three and a half times the size of the moves just before it. Jumps that come without news tend to be reversed over the next 15 to 60 minutes, falls more than rises (Xiao, Yin & Zhao 2020). The desk cannot see the news here, so the record below says how often it held.",
    ev: (P, i) => (i >= 3 && (P.c[i] - P.c[i - 1]) / P.c[i - 1] <= -3.5 * P.sloc[i - 1] ? 1 : 0),
    say: (P, i) => `fell ${sp(((P.c[i] - P.c[i - 1]) / P.c[i - 1]) * 100)} in one bar, ${r2(Math.abs((P.c[i] - P.c[i - 1]) / P.c[i - 1]) / P.sloc[i - 1])}× the moves just before it`,
  },
  {
    id: "jumpUp", fam: "Reversal", name: "A sudden spike with nothing behind it", hold: 2,
    what: "A 5-minute rise three and a half times the size of the moves just before it. Without news behind it such a spike tends to be given back, though less reliably than a sudden drop is recovered.",
    ev: (P, i) => (i >= 3 && (P.c[i] - P.c[i - 1]) / P.c[i - 1] >= 3.5 * P.sloc[i - 1] ? -1 : 0),
    say: (P, i) => `rose ${sp(((P.c[i] - P.c[i - 1]) / P.c[i - 1]) * 100)} in one bar, ${r2(Math.abs((P.c[i] - P.c[i - 1]) / P.c[i - 1]) / P.sloc[i - 1])}× the moves just before it`,
  },
];
/** The bar an hour before continuous trading ends (or the last one before it). */
function eodAnchor(P) {
  let j = -1;
  for (let k = 0; k < P.n; k += 1) {
    if (P.bars[k].s <= P.closeSlot - 13) j = k;
    else break;
  }
  return j;
}
/** In the last half-hour: how far the stock stood from what the market's move explained, an hour before the close (as a fraction). */
function eodRelPct(P) {
  const j = eodAnchor(P);
  if (j < 0 || !P.mk) return null;
  const from = P.prevClose || P.bars[0].o;
  return ((P.c[j] / from - 1) - P.beta * P.mk[j]) * 100;
}
/** …the same in the stock's usual moves for that stretch of the day; 0 outside the last half-hour. */
function eodRel(P, i) {
  if (!P.mk || P.bars[i].s < P.closeSlot - 6) return 0;
  const j = eodAnchor(P);
  if (j < 6) return 0;
  const from = P.prevClose || P.bars[0].o;
  return (P.c[j] / from - 1 - P.beta * P.mk[j]) / (P.sigma * Math.sqrt(j + 1));
}
const W = WITS.length;
const WIX = Object.fromEntries(WITS.map((w, k) => [w.id, k]));
const D = 2 + 2 * W; // the intercept, the forecaster's own call, then every bar witness twice: in a trend, and in a range
/** Is the stock trending on this bar (as against ranging)? */
const trendAt = (P, i) => P.er[i] >= TREND_ER;
const FAMILIES = ["Breakout", "Trend", "Pullback", "Reversal", "Volume", "Market", "Time of day"];

/**
 * What every bar witness says on every bar of the session: an n × W table of −1 / 0 / +1.
 * A witness with `hold` repeats its last event for that many bars.
 */
function statesAll(P) {
  const out = new Array(P.n);
  const last = new Int16Array(W).fill(-1000);
  const lastS = new Int8Array(W);
  for (let i = 0; i < P.n; i += 1) {
    const row = new Int8Array(W);
    for (let k = 0; k < W; k += 1) {
      let e = 0;
      try {
        e = WITS[k].ev(P, i) || 0;
      } catch (_) {
        e = 0;
      }
      if (e) {
        last[k] = i;
        lastS[k] = e;
      }
      row[k] = e || (i - last[k] < WITS[k].hold ? lastS[k] : 0);
    }
    out[i] = row;
  }
  return out;
}

/**
 * A session as the evidence model reads it: one row per bar with what the witnesses said and, when `labels`, what the
 * price then did 5 and 15 minutes on in usual moves for that time (NaN when the session does not hold that bar).
 * @returns [{ s, t, price, w: Int8Array(W), y: [y5, y15] }]
 */
function witnessRows(rawBars, ctx, { labels = true } = {}) {
  const P = prep(rawBars, ctx);
  if (!P) return [];
  const states = statesAll(P);
  const rows = [];
  for (let i = 0; i < P.n; i += 1) {
    const b = P.bars[i];
    const y = [NaN, NaN];
    if (labels) {
      for (let k = 0; k < HZ.length; k += 1) {
        const h = HZ[k];
        if (i + h < P.n && P.bars[i + h].s - b.s === h) y[k] = clip((P.bars[i + h].c - b.c) / b.c / (P.sigma * Math.sqrt(h)), 8);
      }
    }
    rows.push({ s: b.s, t: b.t, price: b.c, w: states[i], y, tr: trendAt(P, i) ? 1 : 0, sl: P.sloc[i], tb: labels ? firstBarrier(P.bars, i, P.sloc[i]) : null });
  }
  return rows;
}

/**
 * Which comes first after bar i, within TB_BARS bars: the price one usual 15-minute move higher, or the same move lower?
 * `sigma` is the usual 5-minute move of the moment (prep's `sloc`).
 * @returns [up first, down first] (both 0 = neither within the time), or null when it cannot be known: the session ends
 *          before the time is up with neither reached, or both lie inside one 5-minute bar (which came first is not in the bar)
 */
function firstBarrier(bars, i, sigma) {
  const base = bars[i].c;
  const up = base * (1 + sigma * TB_UNIT);
  const down = base * (1 - sigma * TB_UNIT);
  let seen = 0;
  for (let j = i + 1; j < bars.length && j <= i + TB_BARS; j += 1) {
    if (bars[j].s - bars[i].s !== j - i) return null; // a gap in the session: nothing is said across it
    seen += 1;
    const hitUp = bars[j].h >= up;
    const hitDown = bars[j].l <= down;
    if (hitUp && hitDown) return null;
    if (hitUp) return [1, 0];
    if (hitDown) return [0, 1];
  }
  return seen >= TB_BARS ? [0, 0] : null;
}

/**
 * What one of the model's questions turned out to be for a row: { y: [first outcome, second], yv (its sign says which) },
 * or null when the session does not hold the answer. k: 0 = 5 minutes, 1 = 15 minutes, 2 = which comes first.
 */
function outcomeAt(r, k) {
  if (k < HZ.length) {
    const y = outcomesOf(r.y[k]);
    return y ? { y, yv: r.y[k] } : null;
  }
  return r.tb ? { y: r.tb, yv: r.tb[0] - r.tb[1] } : null;
}

/** The forecaster's own call for one of its rows, in usual moves for that time: [5 minutes, 15 minutes]. */
function forecasterOf(p) {
  if (!p) return [0, 0];
  return HZ.map((h) => clip((p[H.tIndex(`r${h}`)] || 0) / Math.sqrt(h), 2.5));
}

/** The inputs of the stacked model for one bar and one question: each technique speaks in the regime the bar is in. */
function inputsOf(f, w, trend = true) {
  const z = new Float64Array(D);
  z[0] = 1;
  z[1] = f;
  const at = trend ? 2 : 2 + W;
  for (let k = 0; k < W; k += 1) z[at + k] = w[k];
  return z;
}
/** Where a technique's weight sits among the model's inputs, for the regime. */
const weightAt = (k, trend) => 2 + (trend ? 0 : W) + k;
/** The two outcomes of a bar at one horizon: [it rose, it fell]; null when the session does not hold that bar. */
const outcomesOf = (y) => (num(y) ? [y >= UP_MIN ? 1 : 0, y <= -UP_MIN ? 1 : 0] : null);

/* ================================================================================ the fit */

/** Sums that ADD (so a new day is learned without the old ones): z′z and z′y for the two outcomes. */
class Sums {
  constructor() {
    this.w = 0;
    this.n = 0;
    this.xtx = new Float64Array(D * D);
    this.xty = new Float64Array(2 * D);
  }
  add(z, y, w = 1) {
    this.n += 1;
    this.w += w;
    for (let a = 0; a < D; a += 1) {
      const za = z[a] * w;
      if (za === 0) continue;
      const base = a * D;
      for (let b = a; b < D; b += 1) this.xtx[base + b] += za * z[b];
    }
    for (let k = 0; k < 2; k += 1) if (y[k]) for (let a = 0; a < D; a += 1) this.xty[k * D + a] += w * z[a];
  }
  scale(f) {
    this.w *= f;
    for (let i = 0; i < this.xtx.length; i += 1) this.xtx[i] *= f;
    for (let i = 0; i < this.xty.length; i += 1) this.xty[i] *= f;
    return this;
  }
  merge(o) {
    this.w += o.w;
    this.n += o.n;
    for (let i = 0; i < this.xtx.length; i += 1) this.xtx[i] += o.xtx[i];
    for (let i = 0; i < this.xty.length; i += 1) this.xty[i] += o.xty[i];
    return this;
  }
  /** How often the price rose, and fell, over everything added: the usual rates. */
  base() {
    return [0, 1].map((k) => (this.w > 0 ? this.xty[k * D] / this.w : 0));
  }
  toJSON() {
    const rnd = (a) => Array.from(a, (v) => Math.round(v * 1e5) / 1e5);
    return { D, w: this.w, n: this.n, xtx: rnd(this.xtx), xty: rnd(this.xty) };
  }
  static from(o) {
    const s = new Sums();
    if (!o || o.D !== D || !Array.isArray(o.xtx) || o.xtx.length !== D * D || !Array.isArray(o.xty) || o.xty.length !== 2 * D) return s;
    s.w = o.w;
    s.n = o.n;
    s.xtx.set(o.xtx);
    s.xty.set(o.xty);
    return s;
  }
}

/**
 * Ridge weights for both outcomes from the sums, using the first `dims` inputs only (2 = the forecaster alone: the
 * model the techniques have to beat). @returns [wUp, wDown] or null
 */
function fit(sums, dims = D, lambda = LAMBDA, minRows = MIN_ROWS) {
  if (!sums || sums.n < minRows) return null;
  const A = new Float64Array(dims * dims);
  for (let a = 0; a < dims; a += 1) for (let b = a; b < dims; b += 1) A[a * dims + b] = A[b * dims + a] = sums.xtx[a * D + b];
  for (let a = 1; a < dims; a += 1) A[a * dims + a] += lambda * sums.w; // the intercept is not shrunk
  const out = [];
  for (let k = 0; k < 2; k += 1) {
    const w = H.solve(A, sums.xty.subarray(k * D, k * D + dims), dims);
    if (!w) return null;
    out.push(Array.from(w, (v) => Math.round(v * 1e6) / 1e6));
  }
  return out;
}
const rawOf = (w, z) => {
  let s = 0;
  for (let a = 0; a < w.length; a += 1) s += w[a] * z[a];
  return s;
};
const binOf = (raw) => Math.max(0, Math.min(NB - 1, Math.floor(raw * NB)));

/* ----------------------------------------------------------------------------- calibration: 60% must mean 60% */
const emptyCal = () => ({ n: [new Array(NB).fill(0), new Array(NB).fill(0)], hit: [new Array(NB).fill(0), new Array(NB).fill(0)] });
function calAdd(cal, Wk, z, y, w = 1) {
  for (let k = 0; k < 2; k += 1) {
    const b = binOf(rawOf(Wk[k], z));
    cal.n[k][b] += w;
    if (y[k]) cal.hit[k][b] += w;
  }
  return cal;
}
function calScale(cal, f) {
  for (const key of ["n", "hit"]) for (const row of cal[key]) for (let b = 0; b < NB; b += 1) row[b] *= f;
  return cal;
}
/** The measured frequency in each score bin, made to rise with the score (pooled adjacent violators), or null when too thin. */
function calCurve(n, hit, base) {
  let total = 0;
  for (let b = 0; b < NB; b += 1) total += n[b];
  if (total < MIN_CAL) return null;
  const blocks = [];
  for (let b = 0; b < NB; b += 1) {
    if (n[b] <= 0) continue;
    blocks.push({ w: n[b] + CAL_PRIOR, v: (hit[b] + base * CAL_PRIOR) / (n[b] + CAL_PRIOR), from: b });
    while (blocks.length > 1 && blocks[blocks.length - 2].v > blocks[blocks.length - 1].v) {
      const hi = blocks.pop();
      const lo = blocks[blocks.length - 1];
      lo.v = (lo.v * lo.w + hi.v * hi.w) / (lo.w + hi.w);
      lo.w += hi.w;
    }
  }
  if (!blocks.length) return null;
  const out = new Array(NB);
  let bi = 0;
  for (let b = 0; b < NB; b += 1) {
    while (bi + 1 < blocks.length && blocks[bi + 1].from <= b) bi += 1;
    out[b] = blocks[bi].v;
  }
  return out;
}
const probOf = (raw, curve, base) => (curve ? curve[binOf(raw)] : Math.max(0.03, Math.min(0.9, 0.5 * Math.max(0, Math.min(1, raw)) + 0.5 * base)));
const curvesOf = (cal, base) => [0, 1].map((k) => (cal ? calCurve(cal.n[k], cal.hit[k], base[k]) : null));

/* ----------------------------------------------------------------------------- the lean, and what proves it */
/**
 * From the chance of a rise and of a fall, set beside their usual rates: which way the evidence leans and how firmly.
 * strong = more likely than not; clear = at least a fifth above the usual rate; slight = a little above it.
 */
function leanOf(pUp, pDown, bUp, bDown) {
  const tier = (p, base, other) => (p >= 0.5 ? "strong" : p >= Math.max(base * 1.2, base + 0.05) ? "clear" : p >= base + 0.02 && p - other >= 0.04 ? "slight" : "");
  const tu = tier(pUp, bUp, pDown);
  const td = tier(pDown, bDown, pUp);
  if (tu && pUp > pDown && (!td || pUp - bUp >= pDown - bDown)) return { side: 1, tier: tu };
  if (td && pDown > pUp && (!tu || pDown - bDown > pUp - bUp)) return { side: -1, tier: td };
  return { side: 0, tier: "" };
}

/** A model's chances for one bar: { pUp, pDown, lean }. `m` = { W: [wUp, wDown], base, curves }. */
function callOf(m, z) {
  const pUp = probOf(rawOf(m.W[0], z), m.curves ? m.curves[0] : null, m.base[0]);
  const pDown = probOf(rawOf(m.W[1], z), m.curves ? m.curves[1] : null, m.base[1]);
  return { pUp, pDown, ...leanOf(pUp, pDown, m.base[0], m.base[1]) };
}

// The stocks of one session move together, so ten thousand bars are not ten thousand independent trials. Every test of
// "is this real?" below therefore counts SESSIONS, not bars: a session's bars are summed first, and the spread is taken
// between sessions (a cluster-robust test). Without this, noise passes for an edge — the honest-market test proves it.
const pairs = () => Object.fromEntries(TIERS.map((t) => [t, [0, 0, 0]])); // [leans, right, Σ over sessions of (right − half the leans)²]
const emptyEv = () => ({ n: 0, bs: 0, bs0: 0, qb: 0, tiers: pairs(), alone: pairs(), cur: null });
/**
 * Score one unseen bar: the miss (Brier, both outcomes) of the full model and of the forecaster alone, and whether each
 * one's lean — when it leaned — was right (the price ended on the side it named). The bars of a session are held in
 * `ev.cur` until `evClose` folds the session in.
 */
function evAdd(ev, full, alone, z, y, yv) {
  const a = callOf(full, z);
  const b = callOf(alone, z);
  const cur = ev.cur || (ev.cur = { d: 0, tiers: Object.fromEntries(TIERS.map((t) => [t, [0, 0]])), alone: Object.fromEntries(TIERS.map((t) => [t, [0, 0]])) });
  const bs = (a.pUp - y[0]) ** 2 + (a.pDown - y[1]) ** 2;
  const bs0 = (b.pUp - y[0]) ** 2 + (b.pDown - y[1]) ** 2;
  ev.n += 1;
  ev.bs += bs;
  ev.bs0 += bs0;
  cur.d += bs0 - bs;
  if (a.side) {
    cur.tiers[a.tier][0] += 1;
    if (sgn(yv) === a.side) cur.tiers[a.tier][1] += 1;
  }
  if (b.side) {
    cur.alone[b.tier][0] += 1;
    if (sgn(yv) === b.side) cur.alone[b.tier][1] += 1;
  }
  return ev;
}
/** The session is over: fold its bars into the totals, and its own result into the between-session spread. */
function evClose(ev) {
  const c = ev.cur;
  if (!c) return ev;
  ev.qb += c.d * c.d;
  for (const key of ["tiers", "alone"]) {
    for (const t of TIERS) {
      const [n, ok] = c[key][t];
      ev[key][t][0] += n;
      ev[key][t][1] += ok;
      ev[key][t][2] += (ok - 0.5 * n) ** 2;
    }
  }
  ev.cur = null;
  return ev;
}
function evScale(ev, f) {
  evClose(ev);
  ev.n *= f;
  ev.bs *= f;
  ev.bs0 *= f;
  ev.qb *= f * f;
  for (const key of ["tiers", "alone"]) for (const t of TIERS) ev[key][t] = [ev[key][t][0] * f, ev[key][t][1] * f, (ev[key][t][2] || 0) * f * f];
  return ev;
}
function evMerge(a, b) {
  evClose(a);
  evClose(b);
  a.n += b.n;
  a.bs += b.bs;
  a.bs0 += b.bs0;
  a.qb += b.qb;
  for (const key of ["tiers", "alone"]) for (const t of TIERS) a[key][t] = a[key][t].map((v, i) => v + (b[key][t][i] || 0));
  return a;
}
/** How much less the model with the techniques missed than the forecaster alone, on unseen bars (a fraction; ≤ 0 = nothing). */
const addsOf = (ev) => (ev && ev.n > 0 && ev.bs0 > 0 ? 1 - ev.bs / ev.bs0 : 0);
/**
 * Do the techniques earn their place at this horizon? Enough unseen bars, a real cut in the miss, and the cut must hold
 * session after session (two standard errors clear of nothing, counted between sessions).
 */
const techniquesOn = (ev) => Boolean(ev && ev.n >= 5000 && addsOf(ev) >= MIN_ADD && ev.qb > 0 && (ev.bs0 - ev.bs) / Math.sqrt(ev.qb) > 2);
/** Is a lean of this firmness proven — right clearly more often than a coin, on enough unseen calls, session after session? */
function provenOf(pair) {
  const [n, ok, q] = pair || [0, 0, 0];
  return n >= MIN_PROOF && q > 0 && ok / n > 0.5 && (ok - 0.5 * n) / Math.sqrt(q) > 2;
}
/** One horizon's evidence in plain numbers, for the page. */
function summarise(ev) {
  evClose(ev);
  const row = (pair) => ({ n: Math.round(pair[0]), right: pair[0] > 0 ? r4(pair[1] / pair[0]) : null, proven: provenOf(pair) });
  // every firmness together: their spreads are added as standard deviations (they share sessions), which errs on the careful side
  const all = (set) => TIERS.reduce((a, t) => [a[0] + set[t][0], a[1] + set[t][1], (Math.sqrt(a[2]) + Math.sqrt(set[t][2] || 0)) ** 2], [0, 0, 0]);
  return {
    n: Math.round(ev.n),
    adds: r4(addsOf(ev)),
    on: techniquesOn(ev),
    tiers: Object.fromEntries(TIERS.map((t) => [t, row(ev.tiers[t])])),
    all: row(all(ev.tiers)),
    alone: row(all(ev.alone)),
  };
}

/* ----------------------------------------------------------------------------- each witness's own record */
// A ledger cell, per witness and horizon:
//   [times it spoke, times the price ended its way, Σ move its way (in usual moves), Σ S², Σ S·n, Σ n², sessions]
// where S and n are one session's sum and count: the last four give the spread BETWEEN sessions (see the note above).
const emptyCell = () => [0, 0, 0, 0, 0, 0, 0];
const emptyLedger = (ids = WITS.map((w) => w.id)) => Object.fromEntries(ids.map((id) => [id, HZ.map(emptyCell)]));
/** One session's tally, before it is folded into the ledger: { id: [[n, right, S] per horizon] }. */
const emptyDay = () => ({});
function dayAdd(day, id, k, state, y) {
  if (!state || !num(y)) return;
  const c = (day[id] || (day[id] = HZ.map(() => [0, 0, 0])))[k];
  const m = state * y;
  c[0] += 1;
  if (m > 0) c[1] += 1;
  c[2] += m;
}
function ledgerFold(led, day) {
  for (const [id, cells] of Object.entries(day || {})) {
    if (!led[id]) led[id] = HZ.map(emptyCell);
    cells.forEach(([n, ok, S], k) => {
      if (!n) return;
      const c = led[id][k];
      c[0] += n;
      c[1] += ok;
      c[2] += S;
      c[3] += S * S;
      c[4] += S * n;
      c[5] += n * n;
      c[6] += 1;
    });
  }
  return led;
}
function ledgerScale(led, f) {
  for (const cells of Object.values(led)) {
    for (const c of cells) {
      for (let i = 0; i < 3; i += 1) c[i] *= f;
      for (let i = 3; i < 6; i += 1) c[i] = (c[i] || 0) * f * f;
    }
  }
  return led;
}
function ledgerMerge(a, b) {
  for (const [id, cells] of Object.entries(b)) {
    if (!a[id]) a[id] = HZ.map(emptyCell);
    cells.forEach((c, k) => c.forEach((v, i) => (a[id][k][i] = (a[id][k][i] || 0) + v)));
  }
  return a;
}
/**
 * What a witness's record says: "works" (the price went its way clearly more than not), "backwards" (clearly the other
 * way: here it is a signal to fade), "none" (no edge found) or "thin" (it has not spoken often enough, or on too few
 * sessions, to say). The test counts sessions, not bars.
 * @returns { n, days, right, edge (average move its way, in usual moves), verdict }
 */
function recordOf(cell, min = LEDGER_MIN, minDays = LEDGER_DAYS) {
  const [n, ok, sum, ss, sn, nn, days] = cell && cell.length >= 7 ? cell : emptyCell();
  if (!(n > 0)) return { n: 0, days: 0, right: null, edge: null, verdict: "thin" };
  const mean = sum / n;
  const se = Math.sqrt(Math.max(1e-12, ((ss - 2 * mean * sn + mean * mean * nn) / (n * n)) * (days > 1 ? days / (days - 1) : 1)));
  const verdict = n < min || days < minDays ? "thin" : mean - LEDGER_Z * se > 0 ? "works" : mean + LEDGER_Z * se < 0 ? "backwards" : "none";
  return { n: Math.round(n), days, right: r4(ok / n), edge: r4(mean), verdict };
}

/* ================================================================================ reading a session now */

/** The levels a trader has on the chart, each with how far it is from the price in % and in usual 5-minute moves. */
function levelsOf(P) {
  const i = P.n - 1;
  const last = P.c[i];
  const list = [
    ["VWAP", P.vwap[i]],
    ["VWAP upper band (2)", P.vsd[i] > 0 ? P.vwap[i] + 2 * P.vsd[i] : null],
    ["VWAP lower band (2)", P.vsd[i] > 0 ? P.vwap[i] - 2 * P.vsd[i] : null],
    ["Opening range high", P.orAt > 0 ? P.orH : null],
    ["Opening range low", P.orAt > 0 ? P.orL : null],
    ["First hour high", P.ibAt > 0 ? P.ibH : null],
    ["First hour low", P.ibAt > 0 ? P.ibL : null],
    ["Day high", P.dayHigh],
    ["Day low", P.dayLow],
    ["Yesterday's high", P.pdH],
    ["Yesterday's low", P.pdL],
    ["Yesterday's close", P.prevClose],
    ["Pivot", P.piv ? P.piv.p : null],
    ["CPR top", P.piv ? P.piv.top : null],
    ["CPR bottom", P.piv ? P.piv.bottom : null],
    ["R1", P.piv ? P.piv.r1 : null],
    ["S1", P.piv ? P.piv.s1 : null],
    ["Camarilla H3", P.cam ? P.cam.h3 : null],
    ["Camarilla L3", P.cam ? P.cam.l3 : null],
    ["Camarilla H4", P.cam ? P.cam.h4 : null],
    ["Camarilla L4", P.cam ? P.cam.l4 : null],
    ["20 EMA", P.n >= 10 ? P.ema20[i] : null],
    ["Supertrend", num(P.st.line[i]) ? P.st.line[i] : null],
  ];
  return list
    .filter(([, p]) => num(p) && p > 0)
    .map(([name, p]) => ({ name, price: Math.round(p * 20) / 20, side: p >= last ? "above" : "below", awayPct: r2((p / last - 1) * 100), moves: r2((p / last - 1) / P.sigma) }))
    .sort((a, b) => b.price - a.price);
}

/** The indicators as numbers, for the page and for whoever reads the evidence. */
function indicatorsOf(P) {
  const i = P.n - 1;
  const last = P.c[i];
  const at = (a) => (a && num(a[i]) ? r2(a[i]) : null);
  return {
    rsi14: at(P.rsi14), rsi2: at(P.rsi2),
    vwap: r2(P.vwap[i]), vsVwapPct: r2((last / P.vwap[i] - 1) * 100), vwapBands: P.vsd[i] > 0 ? r2((last - P.vwap[i]) / P.vsd[i]) : null,
    bollinger: num(P.bb.pctB[i]) ? { pctB: r2(P.bb.pctB[i]), upper: r2(P.bb.upper[i]), mid: r2(P.bb.mid[i]), lower: r2(P.bb.lower[i]) } : null,
    macdHist: at(P.macd.hist), adx: at(P.adx.adx), plusDI: at(P.adx.plusDI), minusDI: at(P.adx.minusDI),
    supertrend: P.st.dir[i] === null ? null : { dir: P.st.dir[i] > 0 ? "up" : "down", line: r2(P.st.line[i]) },
    ema9: r2(P.ema9[i]), ema20: r2(P.ema20[i]),
    volumeTimesUsual: r2(P.rvol[i]), atr5: at(P.atr), usualMovePct: r4(P.sigma * 100),
  };
}

/**
 * The bar witnesses for the newest bar, in words. @returns { P, states: Int8Array, said: [{ id, name, fam, what, state, text }] }
 */
function readNow(rawBars, ctx) {
  const P = prep(rawBars, ctx);
  if (!P) return null;
  const i = P.n - 1;
  const states = statesAll(P)[i];
  const said = [];
  for (let k = 0; k < W; k += 1) {
    if (!states[k]) continue;
    let text = "";
    try {
      text = WITS[k].say(P, i, states[k]);
    } catch (_) {
      text = "";
    }
    said.push({ id: WITS[k].id, name: WITS[k].name, fam: WITS[k].fam, state: states[k], text });
  }
  return { P, states, said, trend: trendAt(P, i), er: r2(P.er[i]), sloc: P.sloc[i] };
}

/* ================================================================================ the live witnesses */

const LIVE_FAMS = ["Order book", "Futures & options", "NSE market", "BSE", "World"];
const LIVE = [
  { id: "book5", fam: "Order book", name: "The 5 best bids against the 5 best offers", what: "Shares waiting to buy against shares waiting to sell at the five nearest prices, the nearest counting most." },
  { id: "bookAll", fam: "Order book", name: "All pending buy orders against all pending sell orders", what: "Every share bid in the whole book against every share offered." },
  { id: "micro", fam: "Order book", name: "Which side is thinner at the touch", what: "The micro-price: the side with less quantity at the best price gives way first." },
  { id: "wall", fam: "Order book", name: "A wall of orders", what: "One price holding three or more times the quantity of the levels around it: a bid wall props the price, an offer wall caps it." },
  { id: "press", fam: "Order book", name: "Order-flow pressure", what: "The desk's running read of the book and of who is hitting whom (only while the stock is open on the live stream)." },
  { id: "delta", fam: "Order book", name: "Who traded at whose price in the last minute", what: "Volume that lifted the offer against volume that hit the bid: the aggressor." },
  { id: "ofi", fam: "Order book", name: "Order-flow imbalance over 5 minutes", what: "Not how much is waiting on each side but how much was ADDED and TAKEN AWAY at the five nearest prices in the last five minutes (Cont, Kukanov & Stoikov 2014; on NSE its pull on the price is strongest in the next five minutes and gone within thirty: Tripathi, Dixit & Vipul 2021). Read only while the stock is open on the live stream." },
  { id: "oi15", fam: "Futures & options", name: "Futures open interest against price", what: "Price up with open interest up is a long build-up, price up with it down is short covering; price down with it up is a short build-up, down with it down is long unwinding." },
  { id: "optBias", fam: "Futures & options", name: "The option chain's lean", what: "Put-call ratio, fresh writing and where the walls sit, read together." },
  { id: "optWall", fam: "Futures & options", name: "An option wall close to the price", what: "The strike with the most call open interest just above caps the price; the heaviest put strike just below props it." },
  { id: "pin", fam: "Futures & options", name: "Expiry-day pull toward the heaviest strike", what: "On the afternoon of expiry the price of a stock with options tends to be drawn toward the strike that holds the most open interest (Ni, Pearson & Poteshman 2005). Spoken only on expiry day after 1 PM, when that strike is within 1%." },
  { id: "tide", fam: "NSE market", name: "The NIFTY tide", what: "The index's day, its 5-minute trend, the sectors and India VIX read as one: rising, falling or slack." },
  { id: "sector", fam: "NSE market", name: "The stock's own sector", what: "The sector index against NIFTY today: a stock rarely fights its sector for long." },
  { id: "breadth", fam: "NSE market", name: "Sectors rising against falling", what: "How broad the day's move is across the NSE sector indices." },
  { id: "vix", fam: "NSE market", name: "India VIX", what: "A jump in the fear gauge goes with selling; a fall with calm buying." },
  { id: "bseBook", fam: "BSE", name: "The same stock's order book on BSE", what: "The 5 best bids and offers on the other exchange: a second, independent look at who is waiting." },
  { id: "sensex", fam: "BSE", name: "SENSEX beside NIFTY", what: "The two exchanges' indices move together; a gap between them is unusual." },
  { id: "gift", fam: "World", name: "GIFT NIFTY", what: "NIFTY futures on the international exchange at GIFT City: where the world's money is pricing the index right now." },
  { id: "us", fam: "World", name: "Wall Street's last session", what: "The S&P 500 and the Nasdaq. It sets the mood of the Indian open; by mid-morning it is in the price." },
  { id: "asia", fam: "World", name: "Asia today", what: "The Nikkei, the Hang Seng and the KOSPI while India trades." },
];
const LIVE_IX = Object.fromEntries(LIVE.map((w, i) => [w.id, i]));

/**
 * What is only known now, each as a witness with its lean. Anything missing is simply left out.
 * @param L { last, minute (of the day, IST), book: { b, a, buyQty, sellQty }, flow, tape, chain, market, sector: { name, changePct },
 *            world: [{ id, name, changePct, session }], bse: { last, changePct, volume, book }, sensex: { changePct }, nseVolume }
 * @returns { rows: [{ id, name, fam, state, text }], book, bseBook }   (state 0 = a reading with no lean)
 */
function liveWitnesses(L = {}) {
  const rows = [];
  const say = (id, state, text) => rows.push({ id, name: LIVE[LIVE_IX[id]].name, fam: LIVE[LIVE_IX[id]].fam, state, text });
  const minute = num(L.minute) ? L.minute : 12 * 60;
  const statsOf = (bk) => (bk ? bookStats({ depth: { b: bk.b || [], a: bk.a || [] }, buyQty: bk.buyQty, sellQty: bk.sellQty }) : null);
  const book = statsOf(L.book);
  if (book) {
    if (book.bidQty + book.askQty > 0) {
      const share = book.bidQty / (book.bidQty + book.askQty);
      say("book5", book.imbalance >= 0.25 ? 1 : book.imbalance <= -0.25 ? -1 : 0, `${qty(book.bidQty)} shares bid against ${qty(book.askQty)} offered at the 5 nearest prices (buyers ${pc0(share)})`);
    }
    if (num(book.buyTotal) && num(book.sellTotal) && book.buyTotal + book.sellTotal > 0) {
      const share = book.buyTotal / (book.buyTotal + book.sellTotal);
      say("bookAll", share >= 0.58 ? 1 : share <= 0.42 ? -1 : 0, `${qty(book.buyTotal)} shares waiting to buy against ${qty(book.sellTotal)} waiting to sell (buyers ${pc0(share)})`);
    }
    if (num(book.bid) && num(book.ask)) say("micro", book.microEdge >= 0.5 ? 1 : book.microEdge <= -0.5 ? -1 : 0, book.microEdge >= 0.5 ? `little is offered at ${px(book.ask)}: the offer is the thin side` : book.microEdge <= -0.5 ? `little is bid at ${px(book.bid)}: the bid is the thin side` : `the best bid ${px(book.bid)} and offer ${px(book.ask)} are evenly matched`);
    if (book.wall) say("wall", book.wall.side === "bid" ? 1 : -1, `${qty(book.wall.qty)} shares ${book.wall.side === "bid" ? "bid" : "offered"} at ${px(book.wall.price)}, ${book.wall.times}× the levels around it`);
  }
  const f = L.flow;
  if (f && f.available !== false) {
    if (num(f.pressure)) say("press", f.pressure >= 30 ? 1 : f.pressure <= -30 ? -1 : 0, `${f.label || "pressure"} (${f.pressure > 0 ? "+" : ""}${Math.round(f.pressure)} on a scale of −100 to +100)`);
    if (num(f.ofi300)) say("ofi", f.ofi300 >= 1 ? 1 : f.ofi300 <= -1 ? -1 : 0, `net ${f.ofi300 >= 0 ? "buying" : "selling"} worth ${Math.abs(f.ofi300).toFixed(1)} average price levels at the 5 nearest prices in the last 5 minutes${num(f.ofi60) ? ` (${Math.abs(f.ofi60).toFixed(1)} ${f.ofi60 >= 0 ? "of buying" : "of selling"} in the last minute)` : ""}`);
    if (num(f.deltaRatio60Pct)) say("delta", f.deltaRatio60Pct >= 20 ? 1 : f.deltaRatio60Pct <= -20 ? -1 : 0, `in the last minute ${f.deltaRatio60Pct >= 0 ? "buyers lifted the offer" : "sellers hit the bid"} for a net ${Math.abs(Math.round(f.deltaRatio60Pct))}% of the volume`);
  }
  const t = L.tape;
  if (t && num(t.oi15Pct)) {
    const s = { "long build-up": 1, "short covering": 1, "short build-up": -1, "long unwinding": -1 }[t.position] || 0;
    say("oi15", s, `futures open interest ${sp(t.oi15Pct)} in 15 minutes${t.position ? `: ${t.position}` : ", with no clear build-up"}${num(t.oiDayPct) ? ` (${sp(t.oiDayPct)} on the day)` : ""}`);
  }
  const ch = L.chain;
  if (ch && ch.available) {
    if (ch.bias && num(ch.bias.score)) say("optBias", ch.bias.score >= 10 ? 1 : ch.bias.score <= -10 ? -1 : 0, `${ch.bias.label || "option chain"}${num(ch.pcr) ? `, put-call ratio ${r2(ch.pcr)}` : ""}${num(ch.maxPain) ? `, max pain ${px(ch.maxPain)}` : ""}`);
    const res = ch.resistance && num(ch.resistance.strike) ? ch.resistance.strike : null;
    const sup = ch.support && num(ch.support.strike) ? ch.support.strike : null;
    const spot = num(ch.spot) ? ch.spot : L.last;
    if (num(spot) && (num(res) || num(sup))) {
      const nearRes = num(res) && res >= spot && (res / spot - 1) * 100 <= 0.5;
      const nearSup = num(sup) && sup <= spot && (1 - sup / spot) * 100 <= 0.5;
      say("optWall", nearRes && !nearSup ? -1 : nearSup && !nearRes ? 1 : 0, `heaviest calls at ${num(res) ? px(res) : "—"} (a cap), heaviest puts at ${num(sup) ? px(sup) : "—"} (a floor); the price is ${px(spot)}`);
    }
  }
  // expiry-day pinning: only on expiry day, in the afternoon, toward the strike holding the most open interest within 1%
  if (ch && ch.available && num(ch.daysToExpiry) && ch.daysToExpiry <= 0.3 && minute >= 13 * 60 && Array.isArray(ch.rows)) {
    const spot = num(ch.spot) ? ch.spot : L.last;
    let best = null;
    for (const r of ch.rows) {
      const oi = ((r.ce && r.ce.oi) || 0) + ((r.pe && r.pe.oi) || 0);
      if (num(r.strike) && num(spot) && Math.abs(r.strike / spot - 1) <= 0.01 && oi > 0 && (!best || oi > best.oi)) best = { strike: r.strike, oi };
    }
    if (best) {
      const d = (best.strike / spot - 1) * 100;
      say("pin", d >= 0.1 ? 1 : d <= -0.1 ? -1 : 0, `expiry today: the heaviest strike ${px(best.strike)} is ${Math.abs(d).toFixed(2)}% ${d >= 0 ? "above" : "below"} the price`);
    }
  }
  const mk = L.market;
  if (mk && mk.available) {
    const nifty = mk.nifty && num(mk.nifty.changePct) ? mk.nifty.changePct : null;
    if (mk.tide) say("tide", mk.tide.label === "Rising" ? 1 : mk.tide.label === "Falling" ? -1 : 0, mk.tide.summary || `${mk.tide.label} tide`);
    if (L.sector && num(L.sector.changePct) && nifty !== null) {
      const rel = L.sector.changePct - nifty;
      say("sector", rel >= 0.4 ? 1 : rel <= -0.4 ? -1 : 0, `${L.sector.name} ${sp(L.sector.changePct)} against NIFTY ${sp(nifty)}`);
    }
    if (mk.breadth && mk.breadth.total >= 6) {
      const b = (mk.breadth.up - mk.breadth.down) / mk.breadth.total;
      say("breadth", b >= 0.5 ? 1 : b <= -0.5 ? -1 : 0, `${mk.breadth.up} sectors up, ${mk.breadth.down} down of ${mk.breadth.total}`);
    }
    if (mk.vix && num(mk.vix.changePct)) say("vix", mk.vix.changePct >= 5 ? -1 : mk.vix.changePct <= -5 ? 1 : 0, `India VIX ${r2(mk.vix.last)} (${sp(mk.vix.changePct)} today)`);
    const gift = (mk.items || []).find((x) => x.id === "gift" && x.available !== false && num(x.changePct));
    if (gift && nifty !== null) {
      const gap = gift.changePct - nifty;
      say("gift", gap >= 0.2 ? 1 : gap <= -0.2 ? -1 : 0, `GIFT NIFTY ${sp(gift.changePct)} against NIFTY ${sp(nifty)}${Math.abs(gap) >= 0.2 ? `: it is pricing the index ${gap > 0 ? "higher" : "lower"}` : ": in line"}`);
    }
    if (L.sensex && num(L.sensex.changePct) && nifty !== null) say("sensex", 0, `SENSEX ${sp(L.sensex.changePct)}, NIFTY ${sp(nifty)}${Math.abs(L.sensex.changePct - nifty) <= 0.25 ? ": the two exchanges agree" : ": unusually far apart"}`);
  }
  const bseBook = L.bse ? statsOf(L.bse.book) : null;
  if (L.bse && bseBook && bseBook.bidQty + bseBook.askQty > 0) {
    const share = bseBook.bidQty / (bseBook.bidQty + bseBook.askQty);
    const vShare = num(L.bse.volume) && num(L.nseVolume) && L.bse.volume + L.nseVolume > 0 ? L.bse.volume / (L.bse.volume + L.nseVolume) : null;
    say("bseBook", bseBook.imbalance >= 0.3 ? 1 : bseBook.imbalance <= -0.3 ? -1 : 0, `on BSE ${qty(bseBook.bidQty)} bid against ${qty(bseBook.askQty)} offered (buyers ${pc0(share)})${num(L.bse.last) ? `, last ${px(L.bse.last)}` : ""}${vShare !== null ? `; BSE has ${pc0(vShare)} of today's volume` : ""}`);
  }
  const world = Array.isArray(L.world) ? L.world.filter((m) => m && m.available !== false && num(m.changePct)) : [];
  const get = (id) => world.find((m) => m.id === id || m.symbol === id);
  const spx = get("spx") || world.find((m) => /S&P/i.test(m.name || ""));
  const ndq = get("ixic") || world.find((m) => /Nasdaq/i.test(m.name || ""));
  if (spx) {
    const early = minute < 10 * 60 + 15;
    const s = spx.changePct >= 0.6 ? 1 : spx.changePct <= -0.6 ? -1 : 0;
    say("us", early ? s : 0, `S&P 500 ${sp(spx.changePct)}${ndq ? `, Nasdaq ${sp(ndq.changePct)}` : ""} in its last session${early ? "" : " (in the price since the open)"}`);
  }
  const asia = world.filter((m) => /Nikkei|Hang Seng|KOSPI/i.test(m.name || ""));
  if (asia.length) {
    const avg = asia.reduce((a, m) => a + m.changePct, 0) / asia.length;
    say("asia", avg >= 0.6 ? 1 : avg <= -0.6 ? -1 : 0, asia.map((m) => `${m.name} ${sp(m.changePct)}`).join(", "));
  }
  return { rows, book, bseBook };
}

/* ================================================================================ a kept call, checked */

/** What the price did 5 and 15 minutes after a kept call, in usual moves for that time: { 1: y, 3: y } (missing when the bar is not there). */
function settle(rec, rawBars) {
  const bars = H.cleanBars(rawBars);
  const out = {};
  const at = H.slotOf(rec.anchorEnd - BAR);
  for (const h of HZ) {
    const b = bars.find((x) => x.s === at + h);
    if (b && num(rec.price) && rec.price > 0 && num(rec.sigma) && rec.sigma > 0) out[h] = r4(clip((b.c - rec.price) / rec.price / (rec.sigma * Math.sqrt(h)), 8));
  }
  // which came first, from the price the call was made at: +1 the move up, −1 the move down, 0 neither
  const i = bars.findIndex((x) => x.s === at);
  if (i >= 0 && num(rec.price) && rec.price > 0 && num(rec.sigma) && rec.sigma > 0) {
    const tb = firstBarrier(bars.map((x, j) => (j === i ? { ...x, c: rec.price } : x)), i, num(rec.sl) && rec.sl > 0 ? rec.sl : rec.sigma);
    if (tb) out.tb = tb[0] - tb[1];
  }
  return out;
}

module.exports = {
  BAR, HZ, KEYS, TB_BARS, TB_UNIT, TREND_ER, UP_MIN, MODEL_VERSION, LAMBDA, MIN_ROWS, MIN_PROOF, MIN_ADD, LEDGER_MIN, DECAY_DAY, TIERS, NB,
  WITS, W, WIX, D, FAMILIES, LIVE, LIVE_IX, LIVE_FAMS,
  prep, statesAll, witnessRows, firstBarrier, outcomeAt, trendAt, weightAt, forecasterOf, inputsOf, outcomesOf,
  Sums, fit, rawOf, emptyCal, calAdd, calScale, calCurve, curvesOf, probOf,
  leanOf, callOf, emptyEv, evAdd, evClose, evScale, evMerge, addsOf, techniquesOn, provenOf, summarise,
  emptyLedger, emptyDay, dayAdd, ledgerFold, ledgerScale, ledgerMerge, recordOf, LEDGER_DAYS,
  levelsOf, indicatorsOf, readNow, liveWitnesses, settle,
};
