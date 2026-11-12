"use strict";
// Indicators, setups, the backtester and the analysis reading. Pure maths — no network.

const test = require("node:test");
const assert = require("node:assert/strict");

const I = require("../market/indicators");
const { STRATEGIES, WARMUP, buildContext, triggered, bearishEvents, byId } = require("../market/strategies");
const { runBacktest } = require("../market/backtest");
const { analyze, summarize } = require("../market/analyze");

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

/* ----------------------------------------------------------- builders */
const day = (i) => new Date(Date.UTC(2021, 0, 4) + i * 86400000).toISOString().slice(0, 10);

/** n flat bars at `price` with a fixed 1-point range and steady volume. */
function flat(n, price = 100, vol = 100000) {
  return Array.from({ length: n }, (_, i) => ({ t: day(i), o: price, h: price + 0.5, l: price - 0.5, c: price, v: vol }));
}

/** Deterministic pseudo-random walk with drift (percent per bar). */
function walk(n, { start = 100, drift = 0.05, noise = 1.2, seed = 42 } = {}) {
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const out = [];
  let p = start;
  for (let i = 0; i < n; i += 1) {
    const o = p;
    p = Math.max(1, p * (1 + (drift + (rnd() - 0.5) * 2 * noise) / 100));
    const h = Math.max(o, p) * (1 + rnd() * 0.004);
    const l = Math.min(o, p) * (1 - rnd() * 0.004);
    out.push({ t: day(i), o, h, l, c: p, v: Math.round(100000 + rnd() * 50000) });
  }
  return out;
}

/* --------------------------------------------------------- indicators */

test("SMA and EMA", () => {
  assert.deepEqual(I.sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  // EMA(3) of 1..6: seed = mean(1,2,3) = 2, k = 0.5
  assert.deepEqual(I.ema([1, 2, 3, 4, 5, 6], 3), [null, null, 2, 3, 4, 5]);
  assert.deepEqual(I.ema([7, 7, 7, 7], 2), [null, 7, 7, 7], "a constant series stays constant");
  assert.deepEqual(I.ema([1, 2], 5), [null, null], "not enough data → all null, no guessing");
});

test("RSI matches the classic published 14-period worked example", () => {
  const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64, 46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57, 43.42, 42.66, 43.13];
  // published values (their inputs carry more decimals than are printed, hence the tolerance)
  const published = [70.53, 66.32, 66.55, 69.41, 66.36, 57.97, 62.93, 63.26, 56.06, 62.38, 54.71, 50.42, 39.99, 41.46, 41.87, 45.46, 37.3, 33.08, 37.77];
  const got = I.rsi(closes, 14);
  assert.equal(got.slice(0, 14).every((x) => x === null), true, "no value before 14 changes exist");
  published.forEach((v, k) => near(got[14 + k], v, 0.1));
});

test("RSI extremes", () => {
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  const down = Array.from({ length: 30 }, (_, i) => 100 - i);
  assert.equal(I.rsi(up, 14)[29], 100);
  assert.equal(I.rsi(down, 14)[29], 0);
  assert.equal(I.rsi(new Array(30).fill(50), 14)[29], 50, "no movement is neutral, not a divide-by-zero");
});

test("MACD of a constant series is zero; histogram = line − signal", () => {
  const m = I.macd(new Array(60).fill(10));
  near(m.macd[59], 0);
  near(m.hist[59], 0);
  const w = walk(120).map((c) => c.c);
  const mm = I.macd(w);
  near(mm.hist[119], mm.macd[119] - mm.signal[119], 1e-9);
  assert.equal(mm.macd[24], null);
  assert.notEqual(mm.macd[25], null, "line starts when the 26-EMA exists");
  assert.equal(mm.signal[32], null);
  assert.notEqual(mm.signal[33], null, "signal needs 9 line values");
});

test("Bollinger Bands on a hand-computable window", () => {
  // mean 5, population standard deviation 2
  const b = I.bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
  near(b.mid[7], 5);
  near(b.upper[7], 9);
  near(b.lower[7], 1);
  near(b.pctB[7], 1, 1e-9); // the last close (9) sits exactly on the upper band
});

test("ATR equals the range when every bar has the same range and no gaps", () => {
  const a = I.atr(flat(40), 14);
  assert.equal(a[13], null);
  near(a[14], 1);
  near(a[39], 1);
});

test("ATR counts gaps (true range, not just high − low)", () => {
  const c = flat(20);
  c[19] = { ...c[19], o: 110, h: 110.5, l: 109.5, c: 110 }; // 10-point gap up
  near(I.trueRange(c)[19], 10.5);
});

test("ADX: a steady uptrend is a strong trend led by +DI; a flat market is not", () => {
  const up = Array.from({ length: 80 }, (_, i) => ({ t: day(i), o: 100 + i, h: 101 + i, l: 99.5 + i, c: 100.8 + i, v: 1 }));
  const a = I.adx(up, 14);
  assert.ok(a.adx[79] > 40, `ADX ${a.adx[79]}`);
  assert.ok(a.plusDI[79] > a.minusDI[79]);
  const f = I.adx(flat(80), 14);
  assert.equal(f.adx[79], 0);
});

test("Supertrend follows the trend and flips on a reversal", () => {
  const up = Array.from({ length: 60 }, (_, i) => ({ t: day(i), o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 1 }));
  const down = Array.from({ length: 40 }, (_, i) => ({ t: day(60 + i), o: 160 - 3 * i, h: 161 - 3 * i, l: 157 - 3 * i, c: 157.5 - 3 * i, v: 1 }));
  const s = I.supertrend([...up, ...down], 10, 3);
  assert.equal(s.dir[59], 1);
  assert.ok(s.line[59] < up[59].c, "in an uptrend the line is below price");
  assert.equal(s.dir[99], -1);
  assert.ok(s.line[99] > down[39].c, "in a downtrend the line is above price");
});

test("OBV, highest/lowest, ROC, VWAP", () => {
  const c = [
    { c: 10, v: 100 },
    { c: 11, v: 50 },
    { c: 10.5, v: 30 },
    { c: 10.5, v: 99 },
  ];
  assert.deepEqual(I.obv(c), [0, 50, 20, 20]);
  assert.deepEqual(I.highest([1, 3, 2, 5, 4], 3), [null, null, 3, 5, 5]);
  assert.deepEqual(I.lowest([1, 3, 2, 5, 4], 3), [null, null, 1, 2, 2]);
  assert.deepEqual(I.roc([100, 110, 121], 1).map((x) => (x === null ? null : Math.round(x))), [null, 10, 10]);
  const v = I.vwap([
    { h: 11, l: 9, c: 10, v: 100 }, // typical 10
    { h: 21, l: 19, c: 20, v: 300 }, // typical 20
  ]);
  near(v[0], 10);
  near(v[1], 17.5);
});

test("Pivot points and the central pivot range", () => {
  const p = I.pivots({ h: 110, l: 100, c: 105 });
  near(p.p, 105);
  near(p.r1, 110);
  near(p.s1, 100);
  near(p.r2, 115);
  near(p.s2, 95);
  near(p.r3, 120);
  near(p.s3, 90);
  const q = I.pivots({ h: 110, l: 100, c: 108 });
  assert.ok(q.cprTop > q.cprBottom);
  assert.ok(q.s1 < q.p && q.p < q.r1);
});

test("Support/resistance clusters swing points on either side of price", () => {
  // oscillate between ~90 and ~110, finishing at 100
  const bars = [];
  for (let i = 0; i < 200; i += 1) {
    const mid = 100 + 10 * Math.sin((i / 20) * Math.PI);
    bars.push({ t: day(i), o: mid, h: mid + 0.5, l: mid - 0.5, c: mid, v: 1 });
  }
  const { supports, resistances } = I.supportResistance(bars);
  assert.ok(supports.length >= 1 && resistances.length >= 1);
  near(supports[0].price, 89.5, 0.6);
  near(resistances[0].price, 110.5, 0.6);
  assert.ok(supports[0].touches >= 3 && resistances[0].touches >= 3, "repeated swings count as touches");
});

test("Candlestick patterns", () => {
  const names = (a, b) => I.candlePatterns([a, b], 1).map((p) => p.name);
  assert.ok(names({ o: 105, h: 106, l: 99, c: 100 }, { o: 99.5, h: 108, l: 99, c: 107 }).includes("Bullish engulfing"));
  assert.ok(names({ o: 100, h: 106, l: 99, c: 105 }, { o: 105.5, h: 106, l: 97, c: 98 }).includes("Bearish engulfing"));
  assert.ok(names({ o: 100, h: 101, l: 99, c: 100 }, { o: 100, h: 101.2, l: 94, c: 101 }).includes("Hammer"));
  assert.ok(names({ o: 100, h: 110, l: 90, c: 105 }, { o: 101, h: 104, l: 99, c: 102 }).includes("Inside bar"));
  assert.ok(names({ o: 100, h: 101, l: 99, c: 100 }, { o: 103, h: 104, l: 102, c: 103.5 }).includes("Gap up"));
  assert.deepEqual(I.candlePatterns([{ o: 1, h: 1, l: 1, c: 1 }], 0), []);
});

/* ------------------------------------------------- no look-ahead proof */

test("NO LOOK-AHEAD: every indicator value on bar i is unchanged by later bars", () => {
  const all = walk(420, { seed: 9 });
  const full = buildContext(all);
  for (const cutAt of [230, 300, 377]) {
    const part = buildContext(all.slice(0, cutAt + 1));
    const check = (name, a, b) => {
      const x = a[cutAt];
      const y = b[cutAt];
      if (x === null || y === null) assert.equal(x, y, `${name} @${cutAt}`);
      else near(x, y, 1e-9);
    };
    for (const key of ["ema20", "ema50", "ema200", "sma50", "sma200", "rsi14", "rsi2", "macd", "macdSignal", "macdHist", "atr14", "adx", "plusDI", "minusDI", "stLine", "stDir", "obv", "volAvg20", "hh20", "ll20", "hh55", "roc20"]) {
      check(key, full[key], part[key]);
    }
    check("bb.upper", full.bb.upper, part.bb.upper);
    check("stoch.k", full.stoch.k, part.stoch.k);
    // and therefore every setup decision on that bar is identical too
    for (const s of STRATEGIES) assert.equal(triggered(s, full, cutAt), triggered(s, part, cutAt), s.id);
  }
});

/* ------------------------------------------------------------- setups */

test("setups never trigger during the warm-up, and always explain themselves", () => {
  const ctx = buildContext(walk(400));
  for (const s of STRATEGIES) {
    assert.equal(triggered(s, ctx, WARMUP - 1), false);
    assert.equal(triggered(s, ctx, 9999), false, "out of range is not a signal");
    const conds = s.conditions(ctx, 300);
    assert.ok(conds.length >= 2, s.id);
    conds.forEach((c) => {
      assert.equal(typeof c.label, "string");
      assert.equal(typeof c.ok, "boolean");
    });
    assert.ok(s.exitText && s.idea && s.name, s.id);
    assert.ok(Number.isFinite(s.stop(ctx, 300)), `${s.id} stop`);
  }
});

test("55-day breakout fires on a high-volume close above the range — and not without the volume", () => {
  // 240 gently rising bars (so price is above its 200 EMA), then a tight 59-bar range, then a breakout bar
  const bars = [];
  for (let i = 0; i < 240; i += 1) {
    const p = 100 + i * 0.25;
    bars.push({ t: day(i), o: p, h: p + 0.6, l: p - 0.6, c: p, v: 100000 });
  }
  for (let i = 240; i < 299; i += 1) bars.push({ t: day(i), o: 160, h: 161, l: 159, c: 160, v: 100000 });
  const breakout = { t: day(299), o: 160.5, h: 166, l: 160.2, c: 165.5, v: 300000 };
  const s = byId("breakout_55");

  const withVolume = buildContext([...bars, breakout]);
  assert.equal(triggered(s, withVolume, 299), true);
  assert.ok(s.conditions(withVolume, 299).every((c) => c.ok));

  const quiet = buildContext([...bars, { ...breakout, v: 110000 }]);
  assert.equal(triggered(s, quiet, 299), false, "a breakout on ordinary volume is not taken");
  const failed = s.conditions(quiet, 299).filter((c) => !c.ok);
  assert.equal(failed.length, 1);
  assert.match(failed[0].label, /Volume/);

  assert.equal(triggered(s, withVolume, 298), false, "the day before, inside the range, there is no signal");
});

test("RSI-2 dip setup needs an uptrend AND a sharp sell-off", () => {
  const bars = [];
  for (let i = 0; i < 260; i += 1) {
    const p = 100 + i * 0.3;
    bars.push({ t: day(i), o: p, h: p + 0.5, l: p - 0.5, c: p, v: 100000 });
  }
  // three hard down days, still far above the 200 DMA
  let p = bars[259].c;
  for (let k = 0; k < 3; k += 1) {
    const o = p;
    p -= 3;
    bars.push({ t: day(260 + k), o, h: o + 0.2, l: p - 0.3, c: p, v: 150000 });
  }
  const ctx = buildContext(bars);
  assert.equal(triggered(byId("rsi2_dip"), ctx, 262), true);
  assert.equal(triggered(byId("rsi2_dip"), ctx, 259), false, "no dip, no signal");
});

test("bearish events are reported on the day they happen", () => {
  const up = [];
  for (let i = 0; i < 260; i += 1) {
    const p = 100 + i * 0.3;
    up.push({ t: day(i), o: p, h: p + 0.5, l: p - 0.5, c: p, v: 100000 });
  }
  const crash = { t: day(260), o: 177, h: 177.2, l: 150, c: 151, v: 400000 }; // −15% on 4× volume, through the 20-day low
  const ctx = buildContext([...up, crash]);
  const names = bearishEvents(ctx, 260).map((e) => e.name);
  assert.ok(names.includes("20-day low breakdown"));
  assert.ok(names.includes("Heavy-volume sell-off"));
  assert.deepEqual(bearishEvents(ctx, 259), [], "nothing bearish on an ordinary up day");
});

/* ---------------------------------------------------------- backtester */

// A scripted strategy: enter after bar `enterOn`, leave after bar `exitOn`, fixed stop.
function scripted({ enterOn, exitOn = Infinity, stop, maxHold }) {
  return {
    id: "scripted",
    maxHold,
    conditions: (ctx, i) => [{ label: "scripted entry", ok: enterOn.includes(i) }],
    stop: () => stop,
    exit: (ctx, i) => (i >= exitOn ? "scripted exit" : null),
  };
}

/** 300 flat bars at 100, then caller-supplied bars from index 300. */
function scenario(extra) {
  return [...flat(300), ...extra.map((b, k) => ({ t: day(300 + k), v: 100000, ...b }))];
}

test("backtest: a signal is filled at the NEXT bar's open, exits at the open after the exit signal", () => {
  const bars = scenario([
    { o: 100, h: 101, l: 99.5, c: 100.5 }, // 300: signal on this close
    { o: 102, h: 104, l: 101.5, c: 103 }, //  301: filled at the open, 102 (not at 100.5)
    { o: 103, h: 109, l: 102.5, c: 108 }, //  302: exit signal on this close
    { o: 110, h: 111, l: 109, c: 110.5 }, //  303: exits at the open, 110
    { o: 110, h: 111, l: 109, c: 110 }, //    304
  ]);
  const r = runBacktest(bars, scripted({ enterOn: [300], exitOn: 302, stop: 90 }), { costPct: 0 });
  assert.equal(r.trades.length, 1);
  const t = r.trades[0];
  assert.equal(t.entryDate, day(301));
  assert.equal(t.entry, 102);
  assert.equal(t.exitDate, day(303));
  assert.equal(t.exit, 110);
  near(t.returnPct, (110 / 102 - 1) * 100, 0.01);
  assert.equal(t.reason, "scripted exit");
  assert.equal(r.open, null);
});

test("backtest: costs are charged on every round trip", () => {
  const bars = scenario([
    { o: 100, h: 101, l: 99.5, c: 100 },
    { o: 100, h: 101, l: 99.5, c: 100 },
    { o: 100, h: 101, l: 99.5, c: 100 },
    { o: 100, h: 101, l: 99.5, c: 100 },
    { o: 100, h: 101, l: 99.5, c: 100 },
  ]);
  const s = scripted({ enterOn: [300], exitOn: 302, stop: 90 });
  near(runBacktest(bars, s, { costPct: 0 }).trades[0].returnPct, 0, 1e-9);
  near(runBacktest(bars, s, { costPct: 0.3 }).trades[0].returnPct, -0.3, 1e-9);
  assert.equal(runBacktest(bars, s).costPct, 0.3, "0.3% is the default");
});

test("backtest: the stop is honoured at the stop price, and a gap through it fills at the (worse) open", () => {
  const stopHit = scenario([
    { o: 100, h: 101, l: 99.5, c: 100 }, // signal
    { o: 100, h: 101, l: 99, c: 100 }, //   in at 100, stop 95
    { o: 99, h: 99.5, l: 94, c: 96 }, //    trades through 95 → out at 95
    { o: 96, h: 97, l: 95.5, c: 96 },
  ]);
  let t = runBacktest(stopHit, scripted({ enterOn: [300], stop: 95 }), { costPct: 0 }).trades[0];
  assert.equal(t.exit, 95);
  assert.equal(t.reason, "Stop-loss hit");
  assert.equal(t.r, -1, "a clean stop-out is exactly −1R");

  const gap = scenario([
    { o: 100, h: 101, l: 99.5, c: 100 },
    { o: 100, h: 101, l: 99, c: 100 },
    { o: 90, h: 91, l: 88, c: 89 }, // opens far below the stop → out at 90, not 95
    { o: 89, h: 90, l: 88, c: 89 },
  ]);
  t = runBacktest(gap, scripted({ enterOn: [300], stop: 95 }), { costPct: 0 }).trades[0];
  assert.equal(t.exit, 90);
  assert.equal(t.r, -2, "the gap cost twice the planned risk — and the backtest admits it");
});

test("backtest: stop and exit rule on the same bar → the stop wins (pessimistic)", () => {
  const bars = scenario([
    { o: 100, h: 101, l: 99.5, c: 100 },
    { o: 100, h: 101, l: 99, c: 100 },
    { o: 100, h: 106, l: 94, c: 105 }, // hits the stop intraday; the exit rule also fires on the close
    { o: 105, h: 106, l: 104, c: 105 },
  ]);
  const r = runBacktest(bars, scripted({ enterOn: [300], exitOn: 302, stop: 95 }), { costPct: 0 });
  assert.equal(r.trades.length, 1);
  assert.equal(r.trades[0].reason, "Stop-loss hit");
  assert.equal(r.trades[0].exit, 95);
});

test("backtest: a trade is skipped when the open has already gapped below the stop", () => {
  const bars = scenario([
    { o: 100, h: 101, l: 99.5, c: 100 }, // signal, stop 95
    { o: 94, h: 95, l: 93, c: 94 }, //     opens under the stop → no trade
    { o: 94, h: 95, l: 93, c: 94 },
  ]);
  const r = runBacktest(bars, scripted({ enterOn: [300], stop: 95 }), { costPct: 0 });
  assert.equal(r.trades.length, 0);
  assert.equal(r.open, null);
});

test("backtest: time stop, one position at a time, and an open trade is reported — not hidden", () => {
  const rows = Array.from({ length: 12 }, () => ({ o: 100, h: 101, l: 99.5, c: 100 }));
  const bars = scenario(rows);
  // signals every day; with a 3-bar time stop the trades must not overlap
  const s = scripted({ enterOn: [300, 301, 302, 303, 304, 305, 306, 307, 308, 309, 310], stop: 90, maxHold: 3 });
  const r = runBacktest(bars, s, { costPct: 0 });
  assert.ok(r.trades.length >= 2);
  for (let k = 1; k < r.trades.length; k += 1) {
    assert.ok(r.trades[k].entryDate >= r.trades[k - 1].exitDate, "no overlapping positions");
  }
  assert.match(r.trades[0].reason, /Time stop/);
  assert.equal(r.trades[0].bars, 4, "3 bars held, sold at the next open");

  const stillIn = runBacktest(scenario(rows), scripted({ enterOn: [309], stop: 90 }), { costPct: 0 });
  assert.equal(stillIn.trades.length, 0);
  assert.equal(stillIn.open.entryDate, day(310));
  assert.equal(stillIn.open.unrealisedPct, 0);
});

test("backtest statistics add up", () => {
  // +10%, −5%, +10% on a flat tape, no costs
  const bars = scenario([
    { o: 100, h: 100.5, l: 99.5, c: 100 }, // 300 signal
    { o: 100, h: 111, l: 99.5, c: 110 }, //   301 in @100, exit signal
    { o: 110, h: 110.5, l: 109.5, c: 110 }, // 302 out @110 (+10%); signal
    { o: 100, h: 100.5, l: 94, c: 95 }, //    303 in @100, exit signal
    { o: 95, h: 95.5, l: 94.5, c: 95 }, //    304 out @95 (−5%); signal
    { o: 100, h: 111, l: 99.5, c: 110 }, //   305 in @100, exit signal
    { o: 110, h: 110.5, l: 109.5, c: 110 }, // 306 out @110 (+10%)
    { o: 110, h: 110.5, l: 109.5, c: 110 },
  ]);
  const s = {
    id: "s",
    conditions: (ctx, i) => [{ label: "x", ok: [300, 302, 304].includes(i) }],
    stop: () => 50,
    exit: (ctx, i) => ([301, 303, 305].includes(i) ? "x" : null),
  };
  const { stats, trades, equity } = runBacktest(bars, s, { costPct: 0 });
  assert.deepEqual(trades.map((t) => t.returnPct), [10, -5, 10]);
  assert.equal(stats.trades, 3);
  assert.equal(stats.wins, 2);
  near(stats.winRatePct, 66.7, 0.05);
  assert.equal(stats.avgWinPct, 10);
  assert.equal(stats.avgLossPct, -5);
  assert.equal(stats.payoffRatio, 2);
  assert.equal(stats.profitFactor, 4);
  near(stats.expectancyPct, 5, 1e-9);
  near(stats.totalReturnPct, (1.1 * 0.95 * 1.1 - 1) * 100, 0.01);
  near(equity[equity.length - 1].v, 1.1 * 0.95 * 1.1, 1e-9);
  assert.equal(stats.worstLosingStreak, 1);
  assert.equal(stats.reliability, "too few trades to trust");
  assert.ok(stats.maxDrawdownPct > 0);
});

test("backtest: every real strategy runs on noisy data without breaking its own invariants", () => {
  const bars = walk(1500, { drift: 0.04, noise: 1.6, seed: 3 });
  const ctx = buildContext(bars);
  for (const s of STRATEGIES) {
    const r = runBacktest(bars, s, { ctx });
    assert.equal(r.equity.length, bars.length - WARMUP, s.id);
    r.trades.forEach((t) => {
      assert.ok(t.exitDate >= t.entryDate, `${s.id} exits after it enters`);
      assert.ok(t.stop < t.entry, `${s.id} stop is below entry`);
      assert.ok(Number.isFinite(t.returnPct));
      // no single trade can lose more than a gap-free stop-out… unless it gapped, which r reports
      if (t.reason === "Stop-loss hit") assert.ok(t.r <= -1 + 1e-9 || t.exit <= t.stop, s.id);
    });
    for (let k = 1; k < r.trades.length; k += 1) assert.ok(r.trades[k].entryDate >= r.trades[k - 1].exitDate, `${s.id}: one position at a time`);
    assert.ok(r.stats.maxDrawdownPct >= 0 && r.stats.maxDrawdownPct <= 100);
    assert.ok(r.stats.exposurePct >= 0 && r.stats.exposurePct <= 100);
  }
});

test("backtest with too little history says so instead of inventing numbers", () => {
  const r = runBacktest(flat(120), STRATEGIES[0]);
  assert.equal(r.trades.length, 0);
  assert.equal(r.stats.enoughData, false);
});

/* ------------------------------------------------------------ analysis */

test("analysis refuses to read too little data", () => {
  const a = analyze(flat(10));
  assert.equal(a.enoughData, false);
  assert.match(a.message, /at least 30/);
});

test("an uptrend reads bullish, a downtrend bearish, and every score line is within its limits", () => {
  const up = analyze(walk(500, { drift: 0.25, noise: 0.8, seed: 5 }));
  const down = analyze(walk(500, { drift: -0.25, noise: 0.8, seed: 5 }));
  assert.ok(up.score.value >= 20, `uptrend scored ${up.score.value}`);
  assert.ok(down.score.value <= -20, `downtrend scored ${down.score.value}`);
  assert.match(up.score.label, /bullish/i);
  assert.match(down.score.label, /bearish/i);
  for (const a of [up, down]) {
    assert.ok(a.score.value >= -100 && a.score.value <= 100);
    a.score.factors.forEach((f) => assert.ok(Math.abs(f.points) <= f.max, `${f.name}: ${f.points} of ±${f.max}`));
    assert.equal(a.score.points, a.score.factors.reduce((s, f) => s + f.points, 0));
  }
  assert.ok(down.cautions.some((c) => /below its 200 EMA/.test(c)));
});

test("short history: factors that need 200 bars are left out, not faked", () => {
  const a = analyze(walk(90));
  assert.equal(a.enoughData, true);
  assert.equal(a.fullHistory, false);
  assert.equal(a.score.factors.some((f) => /200 EMA/.test(f.name)), false);
  assert.equal(a.setups.every((s) => s.triggered === false), true, "no setups before the warm-up");
  assert.equal(a.levels.movingAverages.ema200, null);
});

test("returns, yearly returns and drawdown are computed from the bars", () => {
  // 2 full years + a bit: 100 → 200 linearly over the first 400 bars, then a fall to 150
  const bars = [];
  for (let i = 0; i < 500; i += 1) {
    const p = i < 400 ? 100 + (i * 100) / 399 : 200 - ((i - 399) * 50) / 100;
    bars.push({ t: day(i), o: p, h: p + 0.1, l: p - 0.1, c: p, v: 100000 });
  }
  const a = analyze(bars);
  near(a.price.last, 150, 0.01);
  near(a.drawdown.maxPct, 25, 0.01);
  assert.equal(a.drawdown.peakDate, day(399));
  near(a.drawdown.currentPct, 25, 0.01);
  near(a.returns.d1, ((150 - 150.5) / 150.5) * 100, 0.01);
  assert.equal(a.yearly[0].year, 2021);
  assert.equal(a.yearly[0].partial, true);
  assert.ok(a.yearly.every((y) => Number.isFinite(y.returnPct)));
  assert.ok(a.volatilityPct > 0);
});

test("relative strength compares like-for-like dates against the index", () => {
  const stock = walk(300, { drift: 0.3, noise: 0.5, seed: 1 });
  const index = walk(300, { drift: 0.05, noise: 0.5, seed: 2 });
  const a = analyze(stock, { index: { name: "NIFTY 50", candles: index } });
  assert.equal(a.relative.name, "NIFTY 50");
  assert.ok(a.relative.m3 > 0, "a faster-rising stock outperforms");
  assert.ok(a.score.factors.some((f) => f.group === "Relative strength"));

  // an index with different dates cannot be compared → the factor is dropped
  const other = index.map((c, i) => ({ ...c, t: day(i + 1000) }));
  const b = analyze(stock, { index: { name: "X", candles: other } });
  assert.equal(b.relative, null);
  assert.equal(b.score.factors.some((f) => f.group === "Relative strength"), false);
});

test("a triggered setup comes with a complete, self-consistent plan", () => {
  const bars = [];
  for (let i = 0; i < 240; i += 1) {
    const p = 100 + i * 0.25;
    bars.push({ t: day(i), o: p, h: p + 0.6, l: p - 0.6, c: p, v: 100000 });
  }
  for (let i = 240; i < 299; i += 1) bars.push({ t: day(i), o: 160, h: 161, l: 159, c: 160, v: 100000 });
  bars.push({ t: day(299), o: 160.5, h: 166, l: 160.2, c: 165.5, v: 300000 });

  const a = analyze(bars);
  const s = a.setups.find((x) => x.id === "breakout_55");
  assert.equal(s.triggered, true);
  assert.equal(s.met, s.total);
  assert.deepEqual(s.lastFired, { date: day(299), barsAgo: 0 });
  assert.ok(s.plan.stop < s.plan.entryRef);
  near(s.plan.riskPerShare, s.plan.entryRef - s.plan.stop, 0.011);
  near(s.plan.targets[1].price, s.plan.entryRef + 2 * s.plan.riskPerShare, 0.03);
  assert.match(s.plan.exitRule, /20 days/);
  assert.ok(a.chart.markers.some((m) => m.t === day(299) && m.id === "breakout_55"));

  const sum = summarize(bars);
  assert.ok(sum.triggered.map((t) => t.id).includes("breakout_55"));
  assert.equal(sum.last, 165.5);
});

test("chart series are aligned and trimmed to the requested window", () => {
  const a = analyze(walk(400), { chartBars: 120 });
  const len = a.chart.t.length;
  assert.equal(len, 120);
  for (const k of ["o", "h", "l", "c", "v", "ema20", "ema50", "ema200", "bbUpper", "bbLower", "supertrend", "supertrendDir", "rsi", "macdHist"]) {
    assert.equal(a.chart[k].length, len, k);
  }
  assert.equal(a.chart.t[len - 1], a.asOf);
});
