"use strict";
// The short-horizon forecast: where a stock's price, and its high and low, will be 5, 10, 15, 20 and 30 minutes from
// the last finished 5-minute bar — made from the price, volume, RSI, VWAP, timing and the market's own movement, and
// learned from every session of the NIFTY 100 and from every forecast it has made.
//
//   WHAT     One pooled model over many stocks, so it has hundreds of thousands of examples instead of the few
//            thousand one stock gives. Every input is measured in the stock's own units (its usual 5-minute move,
//            its usual hour, its usual day), so a stock of ₹50 and one of ₹5,000 teach the same lesson:
//              r1 r3 r6 r12   the move over the last 1, 3, 6 and 12 bars        fromOpen  the move since the open
//              gap            the open against yesterday's close                vwap      distance from the day's VWAP
//              pos            where the price sits in the day's range          rsi       RSI(14) of the day's 5-minute closes
//              vol, volDir    the bar's volume against the stock's usual for that time of day, and with its direction
//              vnow           how wide the recent bars are against usual        tOpen tClose  the opening and closing rushes
//              m3 m6          the market's move (index) over 3 and 6 bars, times the stock's beta
//              prevDay trend  yesterday's move and the last ten days' drift
//   TARGETS  for each horizon the move of the close; and, for 15, 20 and 30 minutes, how far the high and the low
//            will reach — those two are the forecast LEVELS.
//   FIT      ridge regression (shrunk, so noise is not memorised), by sufficient statistics: sums of x·xᵀ and x·y that
//            ADD. A new day is added to them and the weights solved again; old days fade slowly (half-life ~1 year),
//            so the model follows the market without forgetting it. Nothing is stored per row.
//   HONEST   the model is fitted on the older sessions and scored on the newest ones it never saw (walk-forward).
//            Direction hit rate, the miss against "no move", and how often the stated band held are measured, not
//            claimed. A call's probability comes from the model's own residuals by volatility regime, then is
//            calibrated against what really happened; the hit rate of calls at each stated probability is kept, so
//            the screen can say "when it says 70% it has been right N% of the time".
//
// Pure arithmetic: no AI, no network, no clock, no orders. A forecast is a probability and a range, not a promise.

const IST = 5.5 * 3600 * 1000;
const BAR = 5 * 60000;
const OPEN_MIN = 9 * 60 + 15;
const SESSION_BARS = 75;
const HORIZONS = [1, 2, 3, 4, 6]; // bars of five minutes: 5, 10, 15, 20, 30 minutes
const REACH = [3, 4, 6]; // horizons that also forecast the high and the low
const TARGETS = [...HORIZONS.map((h) => `r${h}`), ...REACH.map((h) => `u${h}`), ...REACH.map((h) => `d${h}`)];
// The first 19 are the original inputs. The rest were added on 2026-11-19 from what is known about short-horizon price
// behaviour (order-flow pressure read from where bars close, rejection wicks, stretch from a moving mean, the opening
// range, the fact that big moves behave differently from small ones, RSI only at its extremes, room to the day's high and
// low). They are NOT assumed to help: the model with them competes against the model without them on unseen sessions
// (see CANDIDATES), and the loser is not used.
const FEATURES = [
  "bias", "r1", "r3", "r6", "r12", "fromOpen", "gap", "vwap", "pos", "rsi", "vol", "volDir", "vnow", "tOpen", "tClose", "m3", "m6", "prevDay", "trend",
  "clv", "clv3", "wick", "z20", "orb", "r1sq", "rsiX", "dHigh", "dLow",
  // Added on 2026-11-19 from published research on intraday behaviour and from the levels Indian desks watch. Like the nine
  // above they are NOT assumed to help on NSE: a model with them competes against the models without them on sessions
  // none has seen, and is used only if it misses less.
  //   orb5     beyond the FIRST 5-minute bar, weighted by how unusual that bar's volume was — Zarattini, Barbon & Aziz
  //            (2024): the 5-minute opening range of "stocks in play"
  //   noise    beyond the stock's own usual distance from its open for this time of day — Zarattini, Aziz & Barbon
  //            (2024): intraday momentum out of the "noise area"
  //   mom30    the first half-hour's move (from yesterday's close), counted only from 2:30 PM — Gao, Han, Li & Zhou,
  //            "Market intraday momentum" (JFE 2018): the first half-hour predicts the last
  //   tod1 tod3  what this stock did in the next bar, and the next three, at this time of day on its last five sessions —
  //            Heston, Korajczyk & Sadka (2010): returns repeat at the same time of day
  //   rs       the move since the open beyond what the market's own move (times beta) explains: relative strength
  //   ema er   EMA 9 over EMA 21, and how straight the last hour's path was (net move ÷ distance travelled)
  //   pivot pdx cpr  against yesterday's pivot; beyond yesterday's high or low; a narrow central pivot range × today's drift
  //   gapGo    the gap being extended (+) or faded (−)        vwSide  the share of the last six closes above VWAP
  //   sqz      a move out of a quiet stretch
  "orb5", "noise", "mom30", "tod1", "tod3", "rs", "ema", "er", "pivot", "pdx", "cpr", "gapGo", "vwSide", "sqz",
];
const BASE_D = 19;
const V2_D = 28; // the inputs up to the first addition: that model is a corner of the full one's sums
const D = FEATURES.length;
// 4 (2026-11-20): the closing rush and the last-hour input count back from when continuous trading really ends in the
// stock (ctx.closeSlot: 3:15 PM for stocks with a closing auction since 3 August 2026), not from a fixed 3:30 PM.
const MODEL_VERSION = 4; // the stored sums are tied to the list of inputs: a model of another version is retrained
const T = TARGETS.length;
const MAXH = Math.max(...HORIZONS);
const DECAY_DAY = 0.998; // an old day counts a little less each calendar day (half-life about a year)
const LAMBDA = 2e-3; // ridge strength, per unit of weight
const BUCKETS = 3; // calm / usual / wide recent bars
const MIN_ROWS = 20000; // fewer examples than this and the model is not used
const NO_EDGE = 0.55;

const num = (x) => typeof x === "number" && Number.isFinite(x);
/** The slot after a session's last bar of continuous trading: 75 (3:30 PM) unless the context says it ends earlier. */
const closeOf = (ctx) => (ctx && num(ctx.closeSlot) && ctx.closeSlot >= 60 && ctx.closeSlot <= SESSION_BARS ? ctx.closeSlot : SESSION_BARS);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const r4 = (x) => (num(x) ? Math.round(x * 10000) / 10000 : null);
const clip = (x, a) => (x > a ? a : x < -a ? -a : x);
const tIndex = (name) => TARGETS.indexOf(name);
const dateOf = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const minOf = (ms) => {
  const d = new Date(ms + IST);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
/** The 5-minute slot of a bar's start time: 0 at 9:15 … 74 at 15:25. */
const slotOf = (ms) => Math.round((minOf(ms) - OPEN_MIN) / 5);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** Standard normal cumulative distribution (Abramowitz–Stegun 7.1.26 on erf). */
function phi(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Bars with a usable time and prices, in time order, one per slot. */
function cleanBars(bars) {
  const out = [];
  let last = -1;
  for (const b of bars || []) {
    if (!b || !num(b.t) || ![b.o, b.h, b.l, b.c].every(num) || b.c <= 0) continue;
    const s = slotOf(b.t);
    if (s < 0 || s >= SESSION_BARS || s <= last) continue;
    last = s;
    out.push({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: num(b.v) ? b.v : 0, s });
  }
  return out;
}

/* ============================================================================ a stock's scale */

/**
 * What is usual for a stock, from its recent sessions: the size of a 5-minute move (sigma), of a day (day), its
 * beta to the market, the volume usual at each time of day, and its last daily closes.
 * @param days  [[date, bars]] oldest first, whole sessions
 * @param mkt   Map date → Float64Array(75) of the market's 5-minute returns (NaN where unknown), or null
 */
function buildProfile(days, mkt = null) {
  const recent = days.slice(-40);
  const rets = [];
  const pairs = [];
  for (const [date, raw] of recent) {
    const bars = cleanBars(raw);
    const m = mkt ? mkt.get(date) : null;
    for (let i = 0; i < bars.length; i += 1) {
      const prev = i ? bars[i - 1].c : bars[i].o;
      const r = (bars[i].c - prev) / prev;
      rets.push(r);
      if (m && num(m[bars[i].s])) pairs.push([r, m[bars[i].s]]);
    }
  }
  if (rets.length < 200) return null;
  const rms = (xs, cap = Infinity) => Math.sqrt(xs.reduce((a, x) => a + Math.min(x * x, cap), 0) / xs.length);
  const s0 = rms(rets);
  const sigma = rms(rets, (5 * s0) ** 2);
  let beta = 1;
  if (pairs.length > 300) {
    let mm = 0;
    let sm = 0;
    let ss = 0;
    for (const [s, m] of pairs) {
      mm += m * m;
      sm += s * m;
      ss += s;
    }
    if (mm > 0) beta = Math.max(0.2, Math.min(2.5, 0.5 + 0.5 * (sm / mm)));
  }
  const last20 = days.slice(-20);
  const ranges = [];
  const vol = new Array(SESSION_BARS).fill(0);
  const vn = new Array(SESSION_BARS).fill(0);
  for (const [, raw] of last20) {
    const bars = cleanBars(raw);
    if (!bars.length) continue;
    const hi = Math.max(...bars.map((b) => b.h));
    const lo = Math.min(...bars.map((b) => b.l));
    ranges.push((hi - lo) / bars[bars.length - 1].c);
    for (const b of bars) {
      vol[b.s] += b.v;
      vn[b.s] += 1;
    }
  }
  const closes = days.slice(-25).map(([date, raw]) => {
    const bars = cleanBars(raw);
    return [date, bars.length ? bars[bars.length - 1].c : null];
  }).filter((x) => num(x[1]));
  return {
    sigma: r4(sigma),
    day: r4(ranges.length ? ranges.reduce((a, b) => a + b, 0) / ranges.length : sigma * Math.sqrt(SESSION_BARS) * 2),
    beta: r2(beta),
    vol: vol.map((v, i) => (vn[i] ? Math.round(v / vn[i]) : 0)),
    closes,
    n: recent.length,
    lastDate: days.length ? days[days.length - 1][0] : null,
  };
}

/** The market's 5-minute returns by date, as the average of many stocks' (a proxy for the index). Map date → Float64Array(75). */
function marketFromStocks(perStock) {
  const sum = new Map();
  for (const days of perStock) {
    for (const [date, raw] of days) {
      const bars = cleanBars(raw);
      let m = sum.get(date);
      if (!m) sum.set(date, (m = { s: new Float64Array(SESSION_BARS), c: new Float64Array(SESSION_BARS) }));
      for (let i = 0; i < bars.length; i += 1) {
        const prev = i ? bars[i - 1].c : bars[i].o;
        m.s[bars[i].s] += (bars[i].c - prev) / prev;
        m.c[bars[i].s] += 1;
      }
    }
  }
  const out = new Map();
  for (const [date, m] of sum) {
    const a = new Float64Array(SESSION_BARS);
    for (let i = 0; i < SESSION_BARS; i += 1) a[i] = m.c[i] >= 10 ? m.s[i] / m.c[i] : NaN;
    out.set(date, a);
  }
  return out;
}

/** The market's 5-minute returns of one day from an index's bars. */
function marketFromBars(raw) {
  const bars = cleanBars(raw);
  const a = new Float64Array(SESSION_BARS).fill(NaN);
  for (let i = 0; i < bars.length; i += 1) {
    const prev = i ? bars[i - 1].c : bars[i].o;
    a[bars[i].s] = (bars[i].c - prev) / prev;
  }
  return a;
}

/* ============================================================================ what earlier sessions say about a day */

/** What one whole session leaves behind: its close, high and low, each bar's return, and how far each bar's close stood from the open. */
function dayStat(rawBars) {
  const bars = cleanBars(rawBars);
  if (!bars.length) return null;
  const ret = new Float64Array(SESSION_BARS).fill(NaN);
  const abs = new Float64Array(SESSION_BARS).fill(NaN);
  const o0 = bars[0].o;
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = 0; i < bars.length; i += 1) {
    const b = bars[i];
    const prev = i ? bars[i - 1].c : b.o;
    ret[b.s] = (b.c - prev) / prev;
    abs[b.s] = Math.abs(b.c / o0 - 1);
    if (b.h > hi) hi = b.h;
    if (b.l < lo) lo = b.l;
  }
  return { close: bars[bars.length - 1].c, high: hi, low: lo, ret, abs };
}

/**
 * From the sessions BEFORE a day (oldest first; the day itself is never read, so nothing of it can leak into its own
 * inputs): yesterday's close, high and low; `noise` — the usual distance of the close from the open at each time of day
 * (up to 14 sessions, at least 4); `tod` — the average return of each 5-minute bar over the last 5 sessions (at least 3).
 * @param prev [dayStat, …]
 */
function priorContext(prev) {
  const list = (prev || []).filter(Boolean);
  if (!list.length) return null;
  const last = list[list.length - 1];
  const noise = new Float64Array(SESSION_BARS).fill(NaN);
  const tod = new Float64Array(SESSION_BARS).fill(NaN);
  const n14 = list.slice(-14);
  const n5 = list.slice(-5);
  for (let k = 0; k < SESSION_BARS; k += 1) {
    let a = 0;
    let an = 0;
    for (const d of n14) {
      if (num(d.abs[k])) {
        a += d.abs[k];
        an += 1;
      }
    }
    if (an >= 4) noise[k] = a / an;
    let r = 0;
    let rn = 0;
    for (const d of n5) {
      if (num(d.ret[k])) {
        r += d.ret[k];
        rn += 1;
      }
    }
    if (rn >= 3) tod[k] = r / rn;
  }
  return { prevClose: last.close, prevHigh: last.high, prevLow: last.low, noise, tod };
}

/* ============================================================================ the inputs and the targets */

/**
 * One row per finished bar of a session: the inputs `x` (as of that bar's close) and, when asked, the targets `y`
 * (NaN where the session ends first). Rows are taken every `stride` bars; the last bar is always kept when `last`.
 * @param bars  the session's bars so far (cleaned here)
 * @param ctx   { sigma, day, beta, vol[75], prevClose, prevDayRet, trend, mkt: Float64Array|null,
 *                prevHigh, prevLow, noise: Float64Array|null, tod: Float64Array|null }   (the last four from priorContext;
 *                an input whose context is missing stays at zero, which says nothing)
 */
function dayRows(rawBars, ctx, { targets = true, stride = 1, last = false, needAll = true } = {}) {
  const bars = cleanBars(rawBars);
  const n = bars.length;
  const rows = [];
  if (!n) return rows;
  const sigma = ctx.sigma;
  const sigH = sigma * Math.sqrt(12);
  const dayR = ctx.day || sigma * 15;
  const o0 = bars[0].o;
  const gap = num(ctx.prevClose) && ctx.prevClose > 0 ? clip((o0 - ctx.prevClose) / ctx.prevClose / dayR, 4) : 0;
  const prevDay = num(ctx.prevDayRet) ? clip(ctx.prevDayRet / dayR, 4) : 0;
  const trend = num(ctx.trend) ? clip(ctx.trend, 4) : 0;
  const beta = ctx.beta || 1;
  const mkt = ctx.mkt || null;
  const vol = ctx.vol || null;
  const close = closeOf(ctx);
  let pv = 0;
  let vv = 0;
  let hi = -Infinity;
  let lo = Infinity;
  let aG = 0;
  let aL = 0;
  const closes = [];
  const rets = [];
  const absRets = [];
  const clvs = [];
  let orH = -Infinity; // the opening range: the first 15 minutes
  let orL = Infinity;
  // for the researched inputs
  const noise = ctx.noise || null;
  const tod = ctx.tod || null;
  const first = bars[0].s === 0 ? bars[0] : null; // the first 5-minute bar, when the session's start was read
  const firstRv = first && vol && vol[0] > 0 ? Math.max(0.5, Math.min(2.5, first.v / vol[0])) : 1;
  const ref = num(ctx.prevClose) && ctx.prevClose > 0 ? ctx.prevClose : o0;
  let firstHalf = null; // the move from yesterday's close to 9:45
  let mktCum = 0;
  let e9 = bars[0].c;
  let e21 = bars[0].c;
  const side = []; // each close against VWAP: +1 above, −1 below
  for (let i = 0; i < n; i += 1) {
    const b = bars[i];
    const prevC = i ? bars[i - 1].c : b.o;
    if (b.s <= 5) firstHalf = (b.c - ref) / ref;
    if (mkt && num(mkt[b.s])) mktCum += mkt[b.s];
    if (i) {
      e9 += (2 / 10) * (b.c - e9);
      e21 += (2 / 22) * (b.c - e21);
    }
    if (b.s < 3) {
      orH = Math.max(orH, b.h);
      orL = Math.min(orL, b.l);
    }
    clvs.push(b.h > b.l ? (b.c - b.l - (b.h - b.c)) / (b.h - b.l) : 0);
    pv += ((b.h + b.l + b.c) / 3) * b.v;
    vv += b.v;
    const vwNow = vv > 0 ? pv / vv : b.c;
    side.push(b.c > vwNow ? 1 : b.c < vwNow ? -1 : 0);
    hi = Math.max(hi, b.h);
    lo = Math.min(lo, b.l);
    const d = b.c - prevC;
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    if (i < 14) {
      aG = (aG * i + g) / (i + 1);
      aL = (aL * i + l) / (i + 1);
    } else {
      aG = (aG * 13 + g) / 14;
      aL = (aL * 13 + l) / 14;
    }
    closes.push(b.c);
    const r = d / prevC;
    rets.push(r);
    absRets.push(Math.abs(r));
    const isLast = i === n - 1;
    if (i % stride !== 0 && !(last && isLast)) continue;
    // targets first: a row with no complete target set is skipped in training
    let y = null;
    if (targets) {
      y = new Float64Array(T).fill(NaN);
      let ok = true;
      for (let k = 0; k < HORIZONS.length; k += 1) {
        const h = HORIZONS[k];
        if (i + h < n && bars[i + h].s - b.s === h) y[k] = clip((bars[i + h].c - b.c) / b.c / sigma, 12);
        else ok = false;
      }
      for (let k = 0; k < REACH.length; k += 1) {
        const h = REACH[k];
        if (i + h < n && bars[i + h].s - b.s === h) {
          let mx = -Infinity;
          let mn = Infinity;
          for (let j = i + 1; j <= i + h; j += 1) {
            if (bars[j].h > mx) mx = bars[j].h;
            if (bars[j].l < mn) mn = bars[j].l;
          }
          y[HORIZONS.length + k] = clip((mx - b.c) / b.c / sigma, 14);
          y[HORIZONS.length + REACH.length + k] = clip((mn - b.c) / b.c / sigma, 14);
        } else ok = false;
      }
      if (!ok && needAll) continue;
    }
    const x = new Float64Array(D);
    const back = (nb) => {
      const j = i - nb;
      const base = j >= 0 ? closes[j] : o0;
      return clip((b.c - base) / base / sigma, 6);
    };
    x[0] = 1;
    x[1] = back(1);
    x[2] = back(3);
    x[3] = back(6);
    x[4] = back(12);
    x[5] = clip((b.c - o0) / o0 / sigH, 6);
    x[6] = gap;
    const vw = vv > 0 ? pv / vv : b.c;
    x[7] = clip((b.c - vw) / vw / sigH, 6);
    x[8] = hi > lo ? (b.c - lo) / (hi - lo) - 0.5 : 0;
    x[9] = aL === 0 && aG === 0 ? 0 : ((aL === 0 ? 100 : 100 - 100 / (1 + aG / aL)) - 50) / 50;
    const usual = vol && vol[b.s] > 0 ? vol[b.s] : 0;
    x[10] = usual > 0 ? clip(Math.log((b.v + 1) / (usual + 1)), 2) : 0;
    x[11] = x[10] * Math.tanh(x[1]);
    const w = Math.min(6, i + 1);
    let ar = 0;
    for (let j = i - w + 1; j <= i; j += 1) ar += absRets[j];
    x[12] = i >= 1 ? clip(Math.log(Math.max(ar / w, 1e-9) / sigma), 1.5) : 0;
    x[13] = Math.max(0, 1 - b.s / 12);
    x[14] = Math.max(0, (b.s - (close - 17)) / 16); // the closing rush: the last 85 minutes of continuous trading
    if (mkt) {
      let s3 = 0;
      let s6 = 0;
      for (let k = 0; k < 6; k += 1) {
        const m = mkt[b.s - k];
        if (num(m)) {
          if (k < 3) s3 += m;
          s6 += m;
        }
      }
      x[15] = clip((beta * s3) / sigma, 8);
      x[16] = clip((beta * s6) / sigma, 8);
    }
    x[17] = prevDay;
    x[18] = trend;
    // --- the added inputs
    x[19] = clvs[i]; // where the bar closed in its own range: +1 at its high (buyers won it), −1 at its low
    x[20] = (clvs[i] + (i >= 1 ? clvs[i - 1] : clvs[i]) + (i >= 2 ? clvs[i - 2] : clvs[i])) / 3;
    x[21] = b.h > b.l ? (b.h - Math.max(b.o, b.c) - (Math.min(b.o, b.c) - b.l)) / (b.h - b.l) : 0; // upper wick minus lower wick: + means rejected above
    const zw = Math.min(20, i + 1);
    if (zw >= 5) {
      let zm = 0;
      for (let j = i - zw + 1; j <= i; j += 1) zm += closes[j];
      zm /= zw;
      let zs = 0;
      for (let j = i - zw + 1; j <= i; j += 1) zs += (closes[j] - zm) ** 2;
      zs = Math.sqrt(zs / zw);
      x[22] = zs > 0 ? clip((b.c - zm) / zs, 3) : 0; // stretch from the 20-bar mean, in its own deviations (Bollinger position)
    }
    if (b.s >= 3 && orH > orL) x[23] = clip((b.c - (orH + orL) / 2) / Math.max(orH - orL, b.c * sigma), 3); // against the opening range: beyond ±0.5 it is outside it
    x[24] = clip((x[1] * Math.abs(x[1])) / 3, 6); // a big last bar is not just a bigger small one
    x[25] = Math.sign(x[9]) * Math.max(0, Math.abs(x[9]) - 0.4); // RSI only past 70 / 30
    x[26] = clip((hi - b.c) / b.c / sigH, 6); // room to the day's high
    x[27] = clip((b.c - lo) / b.c / sigH, 6); // room to the day's low
    // --- the researched inputs (see FEATURES)
    if (first && b.s >= 1 && b.s <= 24) x[28] = clip(((b.c > first.h ? (b.c - first.h) / b.c : b.c < first.l ? (b.c - first.l) / b.c : 0) / sigma) * firstRv, 6);
    const nz = noise && num(noise[b.s]) && noise[b.s] > 0 ? noise[b.s] : null;
    if (nz !== null) {
      const up = Math.max(o0, ref) * (1 + nz);
      const dn = Math.min(o0, ref) * (1 - nz);
      x[29] = clip((b.c > up ? (b.c - up) / b.c : b.c < dn ? (b.c - dn) / b.c : 0) / sigH, 6);
    }
    if (b.s >= close - 12 && num(firstHalf)) x[30] = clip(firstHalf / dayR, 4) * Math.min(1, (b.s - (close - 13)) / 7); // the last hour
    if (tod) {
      if (num(tod[b.s + 1])) x[31] = clip(tod[b.s + 1] / sigma, 3);
      if (num(tod[b.s + 1]) && num(tod[b.s + 2]) && num(tod[b.s + 3])) x[32] = clip((tod[b.s + 1] + tod[b.s + 2] + tod[b.s + 3]) / sigma / Math.sqrt(3), 3);
    }
    if (mkt) x[33] = clip(((b.c - o0) / o0 - beta * mktCum) / sigH, 6);
    x[34] = clip((e9 - e21) / b.c / sigma, 6);
    const ew = Math.min(12, i);
    if (ew >= 3) {
      let dist = 0;
      for (let j = i - ew + 1; j <= i; j += 1) dist += absRets[j];
      x[35] = dist > 0 ? clip((b.c - closes[i - ew]) / closes[i - ew] / dist, 1) : 0;
    }
    if (num(ctx.prevHigh) && num(ctx.prevLow) && ctx.prevHigh > ctx.prevLow) {
      const pH = ctx.prevHigh;
      const pL = ctx.prevLow;
      x[36] = clip((b.c - (pH + pL + ref) / 3) / Math.max(pH - pL, b.c * sigma * 4), 3);
      x[37] = clip((b.c > pH ? (b.c - pH) / b.c : b.c < pL ? (b.c - pL) / b.c : 0) / sigH, 6);
      x[38] = Math.max(0, 1 - Math.abs(2 * ref - pH - pL) / (pH - pL)) * Math.tanh(x[5]); // 1 × today's drift after a day that closed mid-range (a narrow CPR)
    }
    x[39] = clip(x[6] * Math.tanh(x[5]), 4);
    const sw = Math.min(6, i + 1);
    let above = 0;
    for (let j = i - sw + 1; j <= i; j += 1) above += side[j];
    x[40] = above / sw;
    x[41] = clip(Math.max(0, -x[12]) * x[1], 4);
    rows.push({ s: b.s, t: b.t, price: b.c, sigma, x, y, bucket: x[12] < -0.3 ? 0 : x[12] > 0.3 ? 2 : 1, hi, lo, vwap: vw });
  }
  return rows;
}

/* ============================================================================ sufficient statistics and the fit */

class Stats {
  constructor() {
    this.w = 0;
    this.n = 0;
    this.xtx = new Float64Array(D * D);
    this.xty = new Float64Array(T * D);
    this.yy = new Float64Array(T);
  }

  add(x, y, w = 1) {
    this.n += 1;
    this.w += w;
    const xtx = this.xtx;
    for (let a = 0; a < D; a += 1) {
      const xa = x[a] * w;
      if (xa === 0) continue;
      const base = a * D;
      for (let b = a; b < D; b += 1) xtx[base + b] += xa * x[b];
    }
    for (let k = 0; k < T; k += 1) {
      const yk = y[k];
      const wy = yk * w;
      this.yy[k] += wy * yk;
      const base = k * D;
      for (let a = 0; a < D; a += 1) this.xty[base + a] += wy * x[a];
    }
  }

  scale(f) {
    this.w *= f;
    for (let i = 0; i < this.xtx.length; i += 1) this.xtx[i] *= f;
    for (let i = 0; i < this.xty.length; i += 1) this.xty[i] *= f;
    for (let i = 0; i < this.yy.length; i += 1) this.yy[i] *= f;
  }

  merge(o) {
    this.w += o.w;
    this.n += o.n;
    for (let i = 0; i < this.xtx.length; i += 1) this.xtx[i] += o.xtx[i];
    for (let i = 0; i < this.xty.length; i += 1) this.xty[i] += o.xty[i];
    for (let i = 0; i < this.yy.length; i += 1) this.yy[i] += o.yy[i];
    return this;
  }

  toJSON() {
    const rnd = (a) => Array.from(a, (v) => Math.round(v * 1e6) / 1e6);
    return { w: this.w, n: this.n, xtx: rnd(this.xtx), xty: rnd(this.xty), yy: rnd(this.yy) };
  }

  static from(o) {
    const s = new Stats();
    if (!o || !Array.isArray(o.xtx) || o.xtx.length !== D * D || !Array.isArray(o.xty) || o.xty.length !== T * D) return s;
    s.w = o.w;
    s.n = o.n;
    s.xtx.set(o.xtx);
    s.xty.set(o.xty);
    s.yy.set(o.yy || []);
    return s;
  }
}

/** Solve A·w = b for a small dense A (Gauss–Jordan with partial pivoting). */
function solve(A, b, n) {
  const M = new Float64Array(n * (n + 1));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) M[i * (n + 1) + j] = A[i * n + j];
    M[i * (n + 1) + n] = b[i];
  }
  for (let c = 0; c < n; c += 1) {
    let p = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(M[r * (n + 1) + c]) > Math.abs(M[p * (n + 1) + c])) p = r;
    if (Math.abs(M[p * (n + 1) + c]) < 1e-12) return null;
    if (p !== c) for (let j = c; j <= n; j += 1) [M[c * (n + 1) + j], M[p * (n + 1) + j]] = [M[p * (n + 1) + j], M[c * (n + 1) + j]];
    const piv = M[c * (n + 1) + c];
    for (let j = c; j <= n; j += 1) M[c * (n + 1) + j] /= piv;
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const f = M[r * (n + 1) + c];
      if (f === 0) continue;
      for (let j = c; j <= n; j += 1) M[r * (n + 1) + j] -= f * M[c * (n + 1) + j];
    }
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) out[i] = M[i * (n + 1) + n];
  return out;
}

/** The weights of every target from the statistics: T arrays of D numbers, or null when there are too few rows. */
function fit(stats, lambda = LAMBDA, minRows = MIN_ROWS, dims = D) {
  if (!stats || stats.n < minRows) return null;
  // `dims` leading inputs only: the sums of a smaller model are a corner of the larger one's, so both come from one pass
  const A = new Float64Array(dims * dims);
  for (let a = 0; a < dims; a += 1) for (let b = a; b < dims; b += 1) A[a * dims + b] = A[b * dims + a] = stats.xtx[a * D + b];
  for (let a = 1; a < dims; a += 1) A[a * dims + a] += lambda * stats.w; // the intercept is not shrunk
  const W = [];
  for (let k = 0; k < T; k += 1) {
    const w = solve(A, stats.xty.subarray(k * D, k * D + dims), dims);
    if (!w) return null;
    const full = new Array(D).fill(0);
    for (let a = 0; a < dims; a += 1) full[a] = Math.round(w[a] * 1e6) / 1e6;
    W.push(full);
  }
  return W;
}

/* ---- the contest: several models from the same sums; the one in use is the one that missed least on unseen sessions ----
   Every candidate is fitted from the same statistics (so they cost one pass) and judged on rows none of them saw. The
   evidence is kept, fades slowly, and is added to every evening; the champion changes only when another candidate is
   clearly ahead (0.2% less squared error over the return horizons), so it does not flip on noise. */
const CANDIDATES = [
  { id: "base", dims: BASE_D, lambda: LAMBDA, name: "the original 18 inputs" },
  { id: "full", dims: V2_D, lambda: LAMBDA, name: `${V2_D - 1} inputs (with bar shape, stretch and the opening range)` },
  { id: "full-shrunk", dims: V2_D, lambda: LAMBDA * 10, name: `${V2_D - 1} inputs, shrunk harder` },
  { id: "setups", dims: D, lambda: LAMBDA, name: `all ${D - 1} inputs (with the researched set-ups)` },
  { id: "setups-shrunk", dims: D, lambda: LAMBDA * 10, name: `all ${D - 1} inputs (with the researched set-ups), shrunk harder` },
];
const fitCandidates = (stats, minRows = MIN_ROWS) => CANDIDATES.map((c) => fit(stats, c.lambda, minRows, c.dims));

/** Add to the evidence: each candidate's summed squared error on `rows`, per return horizon. */
function arenaEvidence(acc, Ws, rows) {
  const a = acc || { n: 0, se: CANDIDATES.map(() => new Array(HORIZONS.length).fill(0)) };
  for (const row of rows) {
    a.n += 1;
    for (let c = 0; c < CANDIDATES.length; c += 1) {
      const W = Ws[c];
      if (!W) continue;
      for (let k = 0; k < HORIZONS.length; k += 1) {
        const e = row.y[k] - dot(W[k], row.x);
        a.se[c][k] += e * e;
      }
    }
  }
  return a;
}

/** The champion's index: the least total squared error; the current one stays unless another is clearly ahead. */
function chooseChampion(acc, Ws, current = -1) {
  const total = (c) => (Ws[c] ? acc.se[c].reduce((x, y) => x + y, 0) : Infinity);
  let best = 0;
  for (let c = 1; c < CANDIDATES.length; c += 1) if (total(c) < total(best)) best = c;
  if (current >= 0 && Ws[current] && current !== best && acc.n >= 500) {
    const cur = total(current);
    if (cur > 0 && (cur - total(best)) / cur < MIN_GAIN) return current;
  }
  return best;
}

const dot = (w, x) => {
  let s = 0;
  for (let i = 0; i < D; i += 1) s += w[i] * x[i];
  return s;
};

/* ============================================================================ measuring a model on rows it has not seen */

const BINS = [0.5, 0.55, 0.6, 0.7, 0.8, 1.01];
const emptyEval = () => ({
  n: new Float64Array(HORIZONS.length),
  hit: new Float64Array(HORIZONS.length),
  se: new Float64Array(HORIZONS.length),
  se0: new Float64Array(HORIZONS.length),
  ae: new Float64Array(HORIZONS.length), // absolute miss, in percent
  ae0: new Float64Array(HORIZONS.length),
  cover: new Float64Array(HORIZONS.length),
  bin: HORIZONS.map(() => BINS.slice(0, -1).map(() => [0, 0])), // [calls, right] by stated probability
  res: Array.from({ length: T }, () => Array.from({ length: BUCKETS }, () => [0, 0])), // [n, sum of squares] by regime
  zs: Array.from({ length: T }, () => []), // |residual| / sd, for the band width (sampled)
  pp: new Float64Array(T),
  pa: new Float64Array(T),
});

/* ---- the time-of-day experts: a challenger to the one pooled model, adopted only as far as the evidence supports ----
   The opening hour, the middle of the day and the last ninety minutes do not behave alike (the open trends and gaps fill;
   midday reverts; the close is driven by squaring-off). So beside the pooled model there is one model per part of the day,
   fitted on that part's rows only. A part's model has far fewer examples and can simply be noisier, so it is never trusted
   outright: the forecast is  pooled + alpha × (expert − pooled),  and alpha (0, ¼, ½, ¾ or 1, per target) is the one that
   gave the smallest squared error on rows NEITHER model had seen. Alpha 0 — the pooled model alone — stays unless an
   expert earns its place, and the evidence is re-counted every evening, so the choice can change as the market does. */
const SEGMENTS = ["open", "mid", "close"];
const ALPHAS = [0, 0.25, 0.5, 0.75, 1];
const SEG_MIN_ROWS = 6000;
const MIN_GAIN = 0.002; // an expert must cut the squared error by at least 0.2% to be used at all
/** Which part of the day a 5-minute slot belongs to: 0 the first hour, 2 from 2:00 PM, 1 between. */
const segOf = (slot) => (slot < 12 ? 0 : slot >= 57 ? 2 : 1);

/**
 * The model's call for one row: for each target, the standardised prediction. `seg` = { W, alpha } blends in an expert;
 * `mult` is the stock's own scale for the return horizons (how much this stock really follows such a call; 1 = as called).
 */
function predictRow(W, x, slope = null, seg = null, mult = 1) {
  const out = new Float64Array(T);
  for (let k = 0; k < T; k += 1) {
    let p = dot(W[k], x);
    if (seg && seg.W && seg.alpha && seg.alpha[k]) p += seg.alpha[k] * (dot(seg.W[k], x) - p);
    out[k] = p * (slope ? slope[k] : 1) * (k < HORIZONS.length ? mult : 1);
  }
  return out;
}

/* ---- each stock's own scale ----
   The pooled model speaks for the average stock. Some stocks follow such calls more than others (and a few go the other
   way). For each stock the record of  call × outcome  and  call²  is kept (on sessions the model had not seen, fading
   slowly), and its scale is their ratio pulled towards 1 until the record is long: scale = (Σ call·outcome + K) / (Σ call² + K).
   It is used only while forecasts made WITH the scales miss less than forecasts without them — counted every evening. */
const SCALE_K = 5;
const stockScaleOf = (rec) => (rec && rec.pp > 0 ? Math.max(0.4, Math.min(1.6, (rec.pa + SCALE_K) / (rec.pp + SCALE_K))) : 1);

/** The expert for a row's part of the day, from a model's (or a training run's) experts. */
function segFor(segs, slot) {
  if (!segs || !segs.W || !segs.alpha) return null;
  const w = segs.W[segOf(slot)];
  return w ? { W: w, alpha: segs.alpha } : null;
}

/** Evidence for each alpha: the summed squared error per target of  pooled + alpha × (expert − pooled)  on `rows`. */
function alphaEvidence(acc, W, Wseg, rows) {
  const a = acc || { n: 0, se: Array.from({ length: T }, () => new Array(ALPHAS.length).fill(0)) };
  for (const row of rows) {
    const ws = Wseg ? Wseg[segOf(row.s)] : null;
    a.n += 1;
    for (let k = 0; k < T; k += 1) {
      const p = dot(W[k], row.x);
      const d = ws ? dot(ws[k], row.x) - p : 0;
      for (let i = 0; i < ALPHAS.length; i += 1) {
        const e = row.y[k] - (p + ALPHAS[i] * d);
        a.se[k][i] += e * e;
      }
    }
  }
  return a;
}

/** The alpha each target has earned: the best one, or 0 when the best is not clearly better than the pooled model alone. */
function chooseAlpha(acc) {
  if (!acc || acc.n < 2000) return new Array(T).fill(0);
  return acc.se.map((row) => {
    let best = 0;
    for (let i = 1; i < row.length; i += 1) if (row[i] < row[best]) best = i;
    return row[0] > 0 && (row[0] - row[best]) / row[0] >= MIN_GAIN ? ALPHAS[best] : 0;
  });
}

/**
 * Score a model on rows: direction, miss against "no move", the band, the stated-probability table and the residuals
 * by regime. `resSd` (T×BUCKETS) is needed for probabilities and bands; without it only residuals are gathered.
 */
function scoreRows(ev, W, rows, { resSd = null, z70 = null, slope = null, bandScale = 1, keepZ = true, every = 1, segs = null, scales = null } = {}) {
  let c = 0;
  for (const row of rows) {
    c += 1;
    if (every > 1 && c % every !== 0) continue;
    const p = predictRow(W, row.x, slope, segFor(segs, row.s), scales && row.sym ? scales[row.sym] || 1 : 1);
    for (let k = 0; k < T; k += 1) {
      const y = row.y[k];
      const e = y - p[k];
      const cell = ev.res[k][row.bucket];
      cell[0] += 1;
      cell[1] += e * e;
      ev.pp[k] += p[k] * p[k];
      ev.pa[k] += p[k] * y;
      if (k < HORIZONS.length) {
        ev.n[k] += 1;
        ev.se[k] += e * e;
        ev.se0[k] += y * y;
        ev.ae[k] += Math.abs(e) * row.sigma * 100;
        ev.ae0[k] += Math.abs(y) * row.sigma * 100;
        if (y !== 0) ev.hit[k] += Math.sign(p[k]) === Math.sign(y) ? 1 : 0;
        if (resSd) {
          const sd = resSd[k][row.bucket];
          const z = sd > 0 ? Math.abs(e) / sd : 0;
          if (keepZ && ev.zs[k].length < 40000) ev.zs[k].push(Math.round(z * 100) / 100);
          if (z70 && z <= z70[k] * bandScale) ev.cover[k] += 1;
          const pUp = phi(p[k] / sd);
          const side = Math.max(pUp, 1 - pUp);
          const right = (pUp >= 0.5) === (y > 0) ? 1 : 0;
          if (y !== 0) {
            for (let b = 0; b < BINS.length - 1; b += 1) {
              if (side >= BINS[b] && side < BINS[b + 1]) {
                ev.bin[k][b][0] += 1;
                ev.bin[k][b][1] += right;
                break;
              }
            }
          }
        }
      }
    }
  }
  return ev;
}

/** Residual spread by regime, from an evaluation: T × BUCKETS of standard deviations (σ units). */
function resSdOf(ev, prior = null) {
  return ev.res.map((row, k) =>
    row.map(([n, ss], b) => {
      if (n >= 200) return Math.sqrt(ss / n);
      return prior ? prior[k][b] : Math.sqrt(ss / Math.max(1, n)) || 1;
    })
  );
}

/** The width of the band: the 70th percentile of |residual|/sd, per target. */
function z70Of(ev) {
  return ev.zs.map((z) => {
    if (z.length < 200) return 1.04;
    const s = [...z].sort((a, b) => a - b);
    return s[Math.floor(s.length * 0.7)] || 1.04;
  });
}

/** Plain numbers for a screen from an evaluation. */
function summariseEval(ev) {
  return HORIZONS.map((h, k) => ({
    h,
    minutes: h * 5,
    n: ev.n[k],
    dirAcc: ev.n[k] ? r4(ev.hit[k] / ev.n[k]) : null,
    skill: ev.se0[k] ? r4(1 - ev.se[k] / ev.se0[k]) : null, // share of the variance explained (out of sample)
    missPct: ev.n[k] ? r4(ev.ae[k] / ev.n[k]) : null,
    naivePct: ev.n[k] ? r4(ev.ae0[k] / ev.n[k]) : null,
    coverage: ev.n[k] ? r4(ev.cover[k] / ev.n[k]) : null,
    bins: BINS.slice(0, -1).map((lo, b) => ({ lo, hi: BINS[b + 1] > 1 ? 1 : BINS[b + 1], calls: ev.bin[k][b][0], right: ev.bin[k][b][1], acc: ev.bin[k][b][0] ? r4(ev.bin[k][b][1] / ev.bin[k][b][0]) : null })),
  }));
}

/* ============================================================================ the forecast for now */

const HNAME = (h) => `${h * 5} min`;

/**
 * The forecast from the last finished bar. @param model { W, resSd, z70, slope, bandScale, grades }
 * @param opts { bias (σ units, per stock), tilt (σ units added to the moves), tilts (σ units, one per horizon), levels: [{ name, price }] }
 * @returns { anchor: { t, end, price }, sigma, horizons: { [h]: {...} }, reach, levels } or null
 */
function forecastFrom(rawBars, ctx, model, { bias = 0, tilt = 0, tilts = null, levels = [], stockScale = 1 } = {}) {
  // `bias` may be one number for every horizon, or one per horizon (the stock's own correction is learned for 5 and 15 minutes apart)
  const biasAt = (k) => (Array.isArray(bias) ? (num(bias[k]) ? bias[k] : 0) : bias);
  if (!model || !model.W) return null;
  const rows = dayRows(rawBars, ctx, { targets: false, last: true, stride: 1000 }).filter((r, i, a) => i === a.length - 1);
  if (!rows.length) return null;
  const row = rows[0];
  const slope = model.slope || null;
  const scale = model.bandScale || 1;
  const p = predictRow(model.W, row.x, slope, segFor(model.seg, row.s), stockScale);
  // the decision trees' correction (market/boost.js), for the targets where they proved they cut the miss
  if (model.boost) require("./boost").addTo(p, model.boost, row);
  const sg = row.sigma;
  const price = row.price;
  const left = closeOf(ctx) - 1 - row.s; // bars of continuous trading after this one that the session still has
  const horizons = {};
  for (let k = 0; k < HORIZONS.length; k += 1) {
    const h = HORIZONS[k];
    if (h > left) continue;
    const sd = model.resSd[k][row.bucket] * scale;
    // `tilts`: a correction of its own for each horizon (the recorded order book and open interest, when they have earned one)
    const mu = clip(p[k] + biasAt(k) + tilt + (tilts && num(tilts[k]) ? tilts[k] : 0), 2.5); // beyond 2.5σ the inputs are outside anything it has learned from
    const move = mu * sg; // fraction
    const pUp = phi(mu / sd);
    const z = (model.z70 ? model.z70[k] : 1.04) * sd;
    horizons[h] = {
      h,
      minutes: h * 5,
      at: row.t + BAR * (h + 1),
      pct: r4(move * 100),
      price: Math.round(price * (1 + move) * 20) / 20,
      low: Math.round(price * (1 + (mu - z) * sg) * 20) / 20,
      high: Math.round(price * (1 + (mu + z) * sg) * 20) / 20,
      pUp: r4(pUp),
      sd: r4(sd * sg * 100),
    };
  }
  const reach = {};
  for (let k = 0; k < REACH.length; k += 1) {
    const h = REACH[k];
    if (h > left) continue;
    const iu = HORIZONS.length + k;
    const id = HORIZONS.length + REACH.length + k;
    const su = model.resSd[iu][row.bucket] * scale;
    const sdn = model.resSd[id][row.bucket] * scale;
    const up = Math.max(p[iu], 0);
    const dn = Math.min(p[id], 0);
    reach[h] = {
      h,
      minutes: h * 5,
      up: { pct: r4(up * sg * 100), price: Math.round(price * (1 + up * sg) * 20) / 20, sd: su },
      down: { pct: r4(dn * sg * 100), price: Math.round(price * (1 + dn * sg) * 20) / 20, sd: sdn },
    };
  }
  // the chance of touching a level within 15 and 30 minutes: the high reaches it, or the low does
  const touch = [];
  for (const lv of levels) {
    if (!lv || !num(lv.price) || lv.price <= 0) continue;
    const z = (lv.price / price - 1) / sg;
    const out = { name: lv.name, price: lv.price, side: z >= 0 ? "above" : "below", distPct: r4((lv.price / price - 1) * 100) };
    for (const h of [3, 6]) {
      const r = reach[h];
      if (!r) continue;
      if (Math.abs(z) < 1e-9) out[`p${h * 5}`] = 1;
      else if (z > 0) out[`p${h * 5}`] = r4(Math.max(0, Math.min(1, 1 - phi((z - Math.max(p[HORIZONS.length + REACH.indexOf(h)], 0)) / r.up.sd))));
      else out[`p${h * 5}`] = r4(Math.max(0, Math.min(1, phi((z - Math.min(p[HORIZONS.length + REACH.length + REACH.indexOf(h)], 0)) / r.down.sd))));
    }
    touch.push(out);
  }
  return {
    anchor: { t: row.t, end: row.t + BAR, price, slot: row.s },
    sigma: r4(sg * 100),
    bucket: row.bucket,
    x: Object.fromEntries(FEATURES.slice(1).map((f, i) => [f, r2(row.x[i + 1])])),
    horizons,
    reach,
    levels: touch,
    day: { high: row.hi, low: row.lo, vwap: r2(row.vwap) },
  };
}

/**
 * The 15-minute headline: the first bar end at least 15 minutes after `nowMs` that the model forecasts.
 * A forecast made from a bar finished a few minutes ago still looks a full 15 minutes ahead.
 * `leadMinutes` 2.5 gives the 5-minute headline: the first bar end at least 2½ minutes away, so it is always
 * between 2½ and 7½ minutes ahead (the bar now forming, or the next when this one is nearly over).
 */
function headline(fc, nowMs, leadMinutes = 15) {
  if (!fc) return null;
  const need = nowMs + leadMinutes * 60000;
  let pick = null;
  for (const h of HORIZONS) {
    const x = fc.horizons[h];
    if (!x) continue;
    if (x.at >= need - 1000 && !pick) pick = x;
  }
  if (!pick) return null;
  const reachH = Object.values(fc.reach).find((r) => r.h === pick.h) || null; // the high and the low are forecast for 15, 20 and 30 minutes only
  return { ...pick, reach: reachH, minutesAhead: Math.round((pick.at - nowMs) / 60000) };
}

/** How sure the call is, as a word and a probability of the side it favours. */
function callOf(h) {
  if (!h) return { word: "NO READING", side: null, p: null, grade: "none" };
  const side = h.pUp >= 0.5 ? "up" : "down";
  const p = Math.max(h.pUp, 1 - h.pUp);
  const grade = p >= 0.7 ? "A" : p >= 0.62 ? "B" : p >= NO_EDGE ? "C" : "none";
  const word = grade === "none" ? "NO CLEAR LEAN" : side === "up" ? (grade === "C" ? "LEANS UP" : "UP") : grade === "C" ? "LEANS DOWN" : "DOWN";
  return { word, side: grade === "none" ? null : side, p: r4(p), grade };
}

/* ============================================================================ the record: scoring a forecast made earlier */

/** Fill a stored forecast with what happened. @param rec { anchorEnd, price, horizons, sigma } @param bars the session's bars */
function settle(rec, rawBars) {
  const bars = cleanBars(rawBars);
  const out = {};
  const anchor = rec.price;
  for (const [hs, f] of Object.entries(rec.horizons || {})) {
    const h = Number(hs);
    const endBarStart = rec.anchorEnd - BAR + h * BAR; // the bar that ends at the target time
    const b = bars.find((x) => x.t === endBarStart);
    if (!b) continue;
    let mx = -Infinity;
    let mn = Infinity;
    for (const x of bars) {
      if (x.t > rec.anchorEnd - BAR && x.t <= endBarStart) {
        mx = Math.max(mx, x.h);
        mn = Math.min(mn, x.l);
      }
    }
    out[h] = {
      price: b.c,
      pct: r4(((b.c - anchor) / anchor) * 100),
      high: mx,
      low: mn,
      miss: r4(f.price ? ((f.price - b.c) / anchor) * 100 : null),
      inBand: b.c >= f.low - 1e-9 && b.c <= f.high + 1e-9,
      right: f.pct === 0 || b.c === anchor ? null : (f.pct > 0) === (b.c > anchor),
    };
  }
  return out;
}

/**
 * Was a forecast right? One rule, stated on the screen:
 *   a call that LEANS (55% or more one way) is correct when the price went that way;
 *   a call with no lean is correct when the price ended inside its band.
 * @param f the forecast for a horizon { price, low, high, pct, pUp }   @param a what happened (from settle)
 */
function verdictOf(f, a) {
  if (!f || !a) return null;
  const p = Math.max(f.pUp, 1 - f.pUp);
  const lean = p >= NO_EDGE;
  const flat = a.right === null || a.right === undefined; // the price ended exactly where it started: no direction to judge
  const basis = lean && !flat ? "direction" : "band";
  const ok = basis === "direction" ? Boolean(a.right) : Boolean(a.inBand);
  return { ok, basis, side: lean ? (f.pUp >= 0.5 ? "up" : "down") : null, p: r4(p), right: flat ? null : Boolean(a.right), inBand: Boolean(a.inBand), forecast: f.price, low: f.low, high: f.high, actual: a.price, missPct: a.miss, movePct: a.pct };
}

module.exports = {
  BAR, OPEN_MIN, SESSION_BARS, HORIZONS, REACH, TARGETS, FEATURES, D, T, MAXH, DECAY_DAY, LAMBDA, BUCKETS, MIN_ROWS, NO_EDGE, BINS,
  phi, cleanBars, slotOf, dateOf, minOf, daysBetween, tIndex, closeOf,
  buildProfile, marketFromStocks, marketFromBars, dayRows, dayStat, priorContext,
  Stats, fit, solve, dot,
  emptyEval, predictRow, scoreRows, resSdOf, z70Of, summariseEval,
  SEGMENTS, ALPHAS, SEG_MIN_ROWS, segOf, segFor, alphaEvidence, chooseAlpha,
  BASE_D, V2_D, MODEL_VERSION, CANDIDATES, fitCandidates, arenaEvidence, chooseChampion, SCALE_K, stockScaleOf, MIN_GAIN,
  forecastFrom, headline, callOf, settle, verdictOf, HNAME,
};
