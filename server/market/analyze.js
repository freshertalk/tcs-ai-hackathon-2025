"use strict";
// Turns daily candles into the full reading shown on the Analyzer page:
// trend, momentum, volume, volatility, levels, setups, warnings and history.
//
// Everything here is arithmetic on published prices. The "score" is a transparent
// checklist — each line shows its value and how many points it added or removed —
// so the reader can see exactly why the reading is what it is, and disagree.

const I = require("./indicators");
const { STRATEGIES, WARMUP, buildContext, triggered, bearishEvents } = require("./strategies");

const num = I.isNum;
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const r1 = (x) => (num(x) ? Math.round(x * 10) / 10 : null);
const pct = (a, b) => (num(a) && num(b) && b !== 0 ? ((a - b) / b) * 100 : null);

const MIN_BARS = 30; // below this nothing meaningful can be said

function label(score) {
  if (score >= 50) return "Strongly bullish";
  if (score >= 20) return "Bullish";
  if (score > -20) return "Neutral";
  if (score > -50) return "Bearish";
  return "Strongly bearish";
}

/** Slope sign of a series over the last n bars: 1 rising, −1 falling, 0 flat/unknown. */
function slope(values, i, n) {
  if (i - n < 0 || !num(values[i]) || !num(values[i - n])) return 0;
  const d = values[i] - values[i - n];
  return d > 0 ? 1 : d < 0 ? -1 : 0;
}

function scoreCard(ctx, i, rel) {
  const c = ctx.candles[i];
  const f = [];
  // each factor: points in [-max, +max]; skipped (not counted) when its inputs are missing
  const add = (group, name, value, reading, points, max, available = true) => {
    if (available) f.push({ group, name, value, reading, points, max });
  };
  const sign = (cond, pts) => (cond ? pts : -pts);

  // ---- trend (40)
  add("Trend", "Price vs 200 EMA", r2(ctx.ema200[i]), c.c > ctx.ema200[i] ? "Above — long-term uptrend" : "Below — long-term downtrend", sign(c.c > ctx.ema200[i], 10), 10, num(ctx.ema200[i]));
  add("Trend", "50 EMA vs 200 EMA", `${r2(ctx.ema50[i])} / ${r2(ctx.ema200[i])}`, ctx.ema50[i] > ctx.ema200[i] ? "50 above 200" : "50 below 200", sign(ctx.ema50[i] > ctx.ema200[i], 10), 10, num(ctx.ema200[i]));
  add("Trend", "Price vs 20 EMA", r2(ctx.ema20[i]), c.c > ctx.ema20[i] ? "Above — short-term strength" : "Below — short-term weakness", sign(c.c > ctx.ema20[i], 5), 5, num(ctx.ema20[i]));
  add("Trend", "20 EMA vs 50 EMA", `${r2(ctx.ema20[i])} / ${r2(ctx.ema50[i])}`, ctx.ema20[i] > ctx.ema50[i] ? "20 above 50" : "20 below 50", sign(ctx.ema20[i] > ctx.ema50[i], 5), 5, num(ctx.ema50[i]));
  if (num(ctx.adx[i])) {
    const strong = ctx.adx[i] >= 25;
    const up = ctx.plusDI[i] > ctx.minusDI[i];
    add("Trend", "ADX (trend strength)", r1(ctx.adx[i]), strong ? `Strong trend, ${up ? "buyers" : "sellers"} in control` : "Weak / sideways — trend signals are less reliable", strong ? sign(up, 10) : 0, 10);
  }

  // ---- momentum (30)
  if (num(ctx.rsi14[i])) {
    const v = ctx.rsi14[i];
    const pts = v >= 60 ? 10 : v >= 50 ? 5 : v >= 40 ? -5 : -10;
    const reading = v >= 70 ? "Overbought — strong, but late to enter" : v >= 60 ? "Bullish momentum" : v >= 50 ? "Mildly positive" : v >= 40 ? "Mildly negative" : v > 30 ? "Bearish momentum" : "Oversold";
    add("Momentum", "RSI (14)", r1(v), reading, pts, 10);
  }
  if (num(ctx.macdHist[i])) {
    const up = ctx.macdHist[i] > 0;
    add("Momentum", "MACD (12, 26, 9)", r2(ctx.macdHist[i]), up ? "Above its signal line" : "Below its signal line", sign(up, 10), 10);
  }
  if (num(ctx.roc20[i])) add("Momentum", "20-day price change", `${r1(ctx.roc20[i])}%`, ctx.roc20[i] > 0 ? "Higher than a month ago" : "Lower than a month ago", sign(ctx.roc20[i] > 0, 5), 5);
  if (ctx.stDir[i] !== null) add("Momentum", "Supertrend (10, 3)", r2(ctx.stLine[i]), ctx.stDir[i] === 1 ? "Bullish (price above the line)" : "Bearish (price below the line)", sign(ctx.stDir[i] === 1, 5), 5);

  // ---- volume (15)
  if (i >= 20) {
    const s = slope(ctx.obv, i, 20);
    add("Volume", "On-balance volume, 20 days", s > 0 ? "Rising" : s < 0 ? "Falling" : "Flat", s > 0 ? "Volume is flowing in" : s < 0 ? "Volume is flowing out" : "No clear flow", s * 5, 5);
    let upVol = 0;
    let downVol = 0;
    for (let k = i - 19; k <= i; k += 1) {
      if (ctx.candles[k].c > ctx.candles[k - 1].c) upVol += ctx.candles[k].v;
      else if (ctx.candles[k].c < ctx.candles[k - 1].c) downVol += ctx.candles[k].v;
    }
    const ratio = downVol > 0 ? upVol / downVol : upVol > 0 ? 9.99 : 1;
    add("Volume", "Up-day vs down-day volume, 20 days", `${r2(ratio)}×`, ratio >= 1.2 ? "Accumulation — more volume on up days" : ratio <= 0.83 ? "Distribution — more volume on down days" : "Balanced", ratio >= 1.2 ? 5 : ratio <= 0.83 ? -5 : 0, 5);
  }
  if (num(ctx.volAvg20[i - 1]) && ctx.volAvg20[i - 1] > 0) {
    const rv = c.v / ctx.volAvg20[i - 1];
    const up = c.c >= ctx.candles[i - 1].c;
    add("Volume", "Today's volume vs 20-day average", `${r2(rv)}×`, rv >= 1.5 ? `Heavy volume on ${up ? "an up" : "a down"} day` : "Ordinary volume", rv >= 1.5 ? sign(up, 5) : 0, 5);
  }

  // ---- relative strength vs the index (15)
  if (rel && num(rel.m3)) {
    const d = rel.m3;
    const pts = Math.max(-15, Math.min(15, Math.round(d * 1.5)));
    add("Relative strength", `vs ${rel.name}, 3 months`, `${d > 0 ? "+" : ""}${r1(d)} pts`, d > 2 ? "Outperforming the market" : d < -2 ? "Lagging the market" : "In line with the market", pts, 15);
  }

  const got = f.reduce((s, x) => s + x.points, 0);
  const max = f.reduce((s, x) => s + x.max, 0);
  const value = max ? Math.round((got / max) * 100) : 0;
  return { value, label: label(value), points: got, max, factors: f };
}

function returnsTable(candles) {
  const n = candles.length;
  const last = candles[n - 1].c;
  const back = (k) => (n - 1 - k >= 0 ? r2(pct(last, candles[n - 1 - k].c)) : null);
  const year = candles[n - 1].t.slice(0, 4);
  const lastOfPrevYear = [...candles].reverse().find((c) => c.t.slice(0, 4) < year);
  return {
    d1: back(1),
    w1: back(5),
    m1: back(21),
    m3: back(63),
    m6: back(126),
    y1: back(252),
    ytd: lastOfPrevYear ? r2(pct(last, lastOfPrevYear.c)) : null,
  };
}

function yearlyReturns(candles) {
  const lastByYear = new Map();
  for (const c of candles) lastByYear.set(c.t.slice(0, 4), c.c);
  const years = [...lastByYear.keys()].sort();
  const firstYear = years[0];
  const out = [];
  for (let k = 0; k < years.length; k += 1) {
    const y = years[k];
    const base = k === 0 ? candles[0].c : lastByYear.get(years[k - 1]);
    out.push({
      year: Number(y),
      returnPct: r2(pct(lastByYear.get(y), base)),
      // the first year starts wherever the data starts; the last year is still running
      partial: y === firstYear || y === candles[candles.length - 1].t.slice(0, 4),
    });
  }
  return out;
}

function drawdown(candles) {
  let peak = -Infinity;
  let peakT = null;
  let worst = { pct: 0, from: null, to: null };
  for (const c of candles) {
    if (c.c > peak) {
      peak = c.c;
      peakT = c.t;
    }
    const dd = ((peak - c.c) / peak) * 100;
    if (dd > worst.pct) worst = { pct: dd, from: peakT, to: c.t };
  }
  const last = candles[candles.length - 1].c;
  return {
    maxPct: r2(worst.pct),
    maxFrom: worst.from,
    maxTo: worst.to,
    currentPct: r2(((peak - last) / peak) * 100),
    peak: r2(peak),
    peakDate: peakT,
  };
}

function annualVolatility(candles, n = 252) {
  const slice = candles.slice(-Math.min(n + 1, candles.length));
  if (slice.length < 21) return null;
  const rets = [];
  for (let i = 1; i < slice.length; i += 1) rets.push(Math.log(slice[i].c / slice[i - 1].c));
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  const variance = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / (rets.length - 1);
  return r1(Math.sqrt(variance) * Math.sqrt(252) * 100);
}

/** Stock return minus index return over the same dates. */
function relativeStrength(candles, index) {
  if (!index || !Array.isArray(index.candles) || index.candles.length < 30) return null;
  const idx = new Map(index.candles.map((c) => [c.t, c.c]));
  const n = candles.length;
  const lastT = candles[n - 1].t;
  if (!idx.has(lastT)) return null;
  const over = (k) => {
    if (n - 1 - k < 0) return null;
    const then = candles[n - 1 - k];
    if (!idx.has(then.t)) return null;
    return r2(pct(candles[n - 1].c, then.c) - pct(idx.get(lastT), idx.get(then.t)));
  };
  return { name: index.name || "the index", m1: over(21), m3: over(63), m6: over(126), y1: over(252) };
}

function levels(ctx, i, inProgress = false) {
  const c = ctx.candles[i];
  const n = ctx.candles.length;
  const yearSlice = ctx.candles.slice(Math.max(0, n - 252));
  const hi = yearSlice.reduce((m, x) => (x.h > m.h ? x : m), yearSlice[0]);
  const lo = yearSlice.reduce((m, x) => (x.l < m.l ? x : m), yearSlice[0]);
  const a = ctx.atr14[i];
  const sr = I.supportResistance(ctx.candles);
  // while today's bar is still forming, pivots must come from the last COMPLETED session
  const pivotBar = inProgress && i >= 1 ? ctx.candles[i - 1] : c;
  const pv = I.pivots(pivotBar);
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r2(v)]));
  return {
    // pivots are calculated FROM the last completed bar and apply to the session after it
    pivots: { ...round(pv), basedOn: pivotBar.t },
    lastBar: { date: c.t, open: r2(c.o), high: r2(c.h), low: r2(c.l), close: r2(c.c) },
    week52: {
      high: r2(hi.h),
      highDate: hi.t,
      low: r2(lo.l),
      lowDate: lo.t,
      fromHighPct: r2(pct(c.c, hi.h)),
      fromLowPct: r2(pct(c.c, lo.l)),
      positionPct: hi.h > lo.l ? r1(((c.c - lo.l) / (hi.h - lo.l)) * 100) : null,
      bars: yearSlice.length,
    },
    atr: num(a)
      ? { value: r2(a), pctOfPrice: r2((a / c.c) * 100), nextDayLow: r2(c.c - a), nextDayHigh: r2(c.c + a) }
      : null,
    supports: sr.supports.map((s) => ({ price: r2(s.price), touches: s.touches, awayPct: r2(pct(s.price, c.c)) })),
    resistances: sr.resistances.map((s) => ({ price: r2(s.price), touches: s.touches, awayPct: r2(pct(s.price, c.c)) })),
    movingAverages: {
      ema20: r2(ctx.ema20[i]),
      ema50: r2(ctx.ema50[i]),
      ema200: r2(ctx.ema200[i]),
      sma50: r2(ctx.sma50[i]),
      sma200: r2(ctx.sma200[i]),
    },
  };
}

function setupsToday(ctx, i) {
  const c = ctx.candles[i];
  const ready = i >= WARMUP && num(ctx.atr14[i]);
  return STRATEGIES.map((s) => {
    const conditions = ready ? s.conditions(ctx, i) : [];
    const isOn = ready && conditions.every((x) => x.ok);
    const met = conditions.filter((x) => x.ok).length;

    // the most recent bar (within ~6 weeks) on which this setup fired
    let lastFired = null;
    for (let k = i; k >= Math.max(WARMUP, i - 30); k -= 1) {
      if (triggered(s, ctx, k)) {
        lastFired = { date: ctx.candles[k].t, barsAgo: i - k };
        break;
      }
    }

    let plan = null;
    if (isOn) {
      const stop = s.stop(ctx, i);
      const entry = c.c;
      const risk = entry - stop;
      if (num(stop) && risk > 0) {
        plan = {
          // the rule buys at the NEXT session's open; the last close is only a reference
          entryRef: r2(entry),
          stop: r2(stop),
          riskPerShare: r2(risk),
          riskPct: r2((risk / entry) * 100),
          targets: [1, 2, 3].map((m) => ({ r: m, price: r2(entry + m * risk) })),
          exitRule: s.exitText,
        };
      }
    }
    return {
      id: s.id,
      name: s.name,
      style: s.style,
      idea: s.idea,
      exitText: s.exitText,
      triggered: isOn,
      met,
      total: conditions.length,
      conditions,
      lastFired,
      plan,
    };
  });
}

function cautions(ctx, i, lv, liquidityCr) {
  const c = ctx.candles[i];
  const out = [];
  const a = ctx.atr14[i];
  if (num(ctx.rsi14[i]) && ctx.rsi14[i] >= 75) out.push(`RSI is ${r1(ctx.rsi14[i])} — overbought. Strong stocks can stay overbought, but new entries here carry more pullback risk.`);
  if (num(ctx.rsi14[i]) && ctx.rsi14[i] <= 25) out.push(`RSI is ${r1(ctx.rsi14[i])} — deeply oversold. That is not a buy signal by itself; falling stocks can stay oversold.`);
  if (num(a) && num(ctx.ema20[i]) && c.c - ctx.ema20[i] > 2.5 * a) out.push(`Price is ${r1((c.c - ctx.ema20[i]) / a)} ATRs above its 20 EMA — extended. Chasing here usually means a wide stop.`);
  if (num(a) && (a / c.c) * 100 >= 5) out.push(`Daily range (ATR) is ${r1((a / c.c) * 100)}% of price — very volatile. Size positions smaller.`);
  if (num(liquidityCr) && liquidityCr < 5) out.push(`Average daily turnover is only ₹${r1(liquidityCr)} crore — thin. Entries and exits may slip.`);
  if (num(ctx.ema200[i]) && c.c < ctx.ema200[i]) out.push("Price is below its 200 EMA — the long-term trend is down. Most long setups are switched off here on purpose.");
  if (lv.week52 && num(lv.week52.fromHighPct) && lv.week52.fromHighPct > -3 && lv.week52.fromHighPct < 0) out.push(`Within ${Math.abs(lv.week52.fromHighPct)}% of its 52-week high — a level where sellers have appeared before.`);
  if (num(ctx.adx[i]) && ctx.adx[i] < 18) out.push(`ADX is ${r1(ctx.adx[i])} — no real trend. Breakouts fail more often in sideways markets.`);
  return out;
}

/**
 * @param candles  daily bars, oldest first: { t, o, h, l, c, v }
 * @param opts     { index: { name, candles }, chartBars }
 */
function analyze(candles, opts = {}) {
  const n = candles.length;
  if (n < MIN_BARS) {
    return { enoughData: false, bars: n, message: `Only ${n} daily bars available — at least ${MIN_BARS} are needed for any reading.` };
  }
  const ctx = buildContext(candles);
  const i = n - 1;
  const c = candles[i];
  const p = candles[i - 1];

  const rel = relativeStrength(candles, opts.index);
  const lv = levels(ctx, i, Boolean(opts.inProgress));
  const turnover20 = candles.slice(-20).reduce((s, x) => s + x.c * x.v, 0) / Math.min(20, n);
  const liquidityCr = turnover20 / 1e7;

  const chartBars = Math.min(opts.chartBars || 260, n);
  const from = n - chartBars;
  const cut = (arr, d = 2) => arr.slice(from).map((v) => (num(v) ? Math.round(v * 10 ** d) / 10 ** d : null));

  // setups that fired inside the chart window, to mark on the chart
  const markers = [];
  for (let k = Math.max(from, WARMUP); k <= i; k += 1) {
    for (const s of STRATEGIES) if (triggered(s, ctx, k)) markers.push({ t: candles[k].t, id: s.id, name: s.name });
  }
  const recentBearish = [];
  for (let k = Math.max(1, i - 4); k <= i; k += 1) {
    for (const e of bearishEvents(ctx, k)) recentBearish.push({ ...e, date: candles[k].t, barsAgo: i - k });
  }

  return {
    enoughData: true,
    bars: n,
    fullHistory: n > WARMUP,
    asOf: c.t,
    firstBar: candles[0].t,
    price: {
      last: r2(c.c),
      prevClose: r2(p.c),
      change: r2(c.c - p.c),
      changePct: r2(pct(c.c, p.c)),
      open: r2(c.o),
      high: r2(c.h),
      low: r2(c.l),
      volume: c.v,
    },
    score: scoreCard(ctx, i, rel),
    cautions: cautions(ctx, i, lv, liquidityCr),
    indicators: {
      rsi14: r1(ctx.rsi14[i]),
      rsi2: r1(ctx.rsi2[i]),
      macd: r2(ctx.macd[i]),
      macdSignal: r2(ctx.macdSignal[i]),
      macdHist: r2(ctx.macdHist[i]),
      adx: r1(ctx.adx[i]),
      plusDI: r1(ctx.plusDI[i]),
      minusDI: r1(ctx.minusDI[i]),
      stochK: r1(ctx.stoch.k[i]),
      stochD: r1(ctx.stoch.d[i]),
      atr14: r2(ctx.atr14[i]),
      atrPct: num(ctx.atr14[i]) ? r2((ctx.atr14[i] / c.c) * 100) : null,
      bbUpper: r2(ctx.bb.upper[i]),
      bbMid: r2(ctx.bb.mid[i]),
      bbLower: r2(ctx.bb.lower[i]),
      bbWidthPct: num(ctx.bb.width[i]) ? r1(ctx.bb.width[i] * 100) : null,
      bbPctB: r2(ctx.bb.pctB[i]),
      supertrend: r2(ctx.stLine[i]),
      supertrendDir: ctx.stDir[i],
      roc20: r1(ctx.roc20[i]),
      relVolume: num(ctx.volAvg20[i - 1]) && ctx.volAvg20[i - 1] > 0 ? r2(c.v / ctx.volAvg20[i - 1]) : null,
      avgVolume20: num(ctx.volAvg20[i]) ? Math.round(ctx.volAvg20[i]) : null,
      high20: r2(ctx.hh20[i]),
      low20: r2(ctx.ll20[i]),
      high55: r2(ctx.hh55[i]),
    },
    levels: lv,
    setups: setupsToday(ctx, i),
    bearish: recentBearish,
    patterns: I.candlePatterns(candles, i),
    returns: returnsTable(candles),
    yearly: yearlyReturns(candles),
    drawdown: drawdown(candles),
    volatilityPct: annualVolatility(candles),
    liquidity: { avgTurnoverCr: r1(liquidityCr), avgVolume20: num(ctx.volAvg20[i]) ? Math.round(ctx.volAvg20[i]) : null },
    relative: rel,
    chart: {
      t: candles.slice(from).map((x) => x.t),
      o: cut(candles.map((x) => x.o)),
      h: cut(candles.map((x) => x.h)),
      l: cut(candles.map((x) => x.l)),
      c: cut(candles.map((x) => x.c)),
      v: candles.slice(from).map((x) => x.v),
      ema20: cut(ctx.ema20),
      ema50: cut(ctx.ema50),
      ema200: cut(ctx.ema200),
      bbUpper: cut(ctx.bb.upper),
      bbLower: cut(ctx.bb.lower),
      supertrend: cut(ctx.stLine),
      supertrendDir: ctx.stDir.slice(from),
      rsi: cut(ctx.rsi14, 1),
      macdHist: cut(ctx.macdHist),
      markers,
    },
  };
}

/** The few numbers a watchlist row needs. */
function summarize(candles, opts = {}) {
  const a = analyze(candles, { ...opts, chartBars: 1 });
  if (!a.enoughData) return { enoughData: false };
  return {
    enoughData: true,
    asOf: a.asOf,
    last: a.price.last,
    changePct: a.price.changePct,
    score: a.score.value,
    label: a.score.label,
    rsi14: a.indicators.rsi14,
    triggered: a.setups.filter((s) => s.triggered).map((s) => ({ id: s.id, name: s.name })),
    bearishToday: a.bearish.filter((b) => b.barsAgo === 0).map((b) => b.name),
    fromHighPct: a.levels.week52.fromHighPct,
  };
}

module.exports = { analyze, summarize, MIN_BARS };
