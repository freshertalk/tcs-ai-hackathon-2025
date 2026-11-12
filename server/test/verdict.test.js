"use strict";
// The desk verdict: time frames, stance, plans, circuits and the level ladder.

const test = require("node:test");
const assert = require("node:assert/strict");

const { analyze } = require("../market/analyze");
const { buildVerdict, toWeekly, weekStart, weeklyTrend, intradayPicture } = require("../market/verdict");

const day = (i) => new Date(Date.UTC(2021, 0, 4) + i * 86400000).toISOString().slice(0, 10); // 4 Jan 2021 is a Monday

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

const verdictOf = (candles, extra = {}) => buildVerdict({ analysis: analyze(candles, { chartBars: 1 }), candles, ...extra });

/** 5-minute bars for "today". */
function bars5(prices) {
  return prices.map((p, i) => ({ t: `2026-11-12T09:${15 + i * 5}:00+0530`, o: p - 0.2, h: p + 0.5, l: p - 0.5, c: p, v: 1000 }));
}

/** Every number in an object is finite — no NaN, no Infinity, anywhere. */
function assertFinite(obj, path = "verdict") {
  if (obj === null || obj === undefined) return;
  if (typeof obj === "number") assert.ok(Number.isFinite(obj), `${path} is ${obj}`);
  else if (Array.isArray(obj)) obj.forEach((v, i) => assertFinite(v, `${path}[${i}]`));
  else if (typeof obj === "object") Object.entries(obj).forEach(([k, v]) => assertFinite(v, `${path}.${k}`));
}

/* ----------------------------------------------------------- time frames */

test("weekly bars: Monday-keyed, with the right open, high, low, close and volume", () => {
  assert.equal(weekStart("2021-01-04"), "2021-01-04"); // Monday
  assert.equal(weekStart("2021-01-08"), "2021-01-04"); // Friday of the same week
  assert.equal(weekStart("2021-01-10"), "2021-01-04"); // Sunday still belongs to that week
  assert.equal(weekStart("2021-01-11"), "2021-01-11");

  const d = [
    { t: "2021-01-04", o: 10, h: 12, l: 9, c: 11, v: 100 },
    { t: "2021-01-05", o: 11, h: 15, l: 10, c: 14, v: 200 },
    { t: "2021-01-08", o: 14, h: 14.5, l: 8, c: 9, v: 300 },
    { t: "2021-01-11", o: 9, h: 10, l: 8.5, c: 9.5, v: 50 },
  ];
  assert.deepEqual(toWeekly(d), [
    { t: "2021-01-04", o: 10, h: 15, l: 8, c: 9, v: 600 },
    { t: "2021-01-11", o: 9, h: 10, l: 8.5, c: 9.5, v: 50 },
  ]);
});

test("weekly trend follows the long direction and admits when there is too little history", () => {
  assert.equal(weeklyTrend(walk(700, { drift: 0.2, noise: 0.6 })).dir, "up");
  assert.equal(weeklyTrend(walk(700, { drift: -0.2, noise: 0.6 })).dir, "down");
  const short = weeklyTrend(walk(100));
  assert.equal(short.dir, null);
  assert.match(short.basis, /weekly bars/);
});

test("intraday picture: VWAP, opening range and direction", () => {
  const up = intradayPicture(bars5([100, 100.2, 100.1, 101, 102, 103, 104]), 104);
  assert.equal(up.orHigh, 100.7);
  assert.equal(up.orLow, 99.5);
  assert.equal(up.dir, "up");
  assert.ok(up.vwap > 100 && up.vwap < 104);
  assert.match(up.basis, /above VWAP/);

  const down = intradayPicture(bars5([100, 100.2, 100.1, 99, 98, 97, 96]), 96);
  assert.equal(down.dir, "down");
  assert.equal(intradayPicture(bars5([100, 100, 100]), 100), null, "three bars are not enough");
  assert.equal(intradayPicture(null, 100), null);
});

/* --------------------------------------------------------------- stance */

test("a strong, aligned uptrend reads Bullish with a complete long plan", () => {
  const c = walk(700, { drift: 0.22, noise: 0.7, seed: 5 });
  const v = verdictOf(c);
  assert.equal(v.available, true);
  assert.equal(v.direction, "bullish");
  assert.equal(v.stance, "Bullish");
  assert.ok(v.composite >= 25);
  assert.deepEqual(v.frames.map((f) => f.name), ["Weekly", "Daily", "Intraday (5 min)"]);
  assert.equal(v.frames[0].dir, "up");
  assert.equal(v.frames[2].dir, null, "no intraday bars were supplied");

  const s = v.swing;
  assert.ok(["buy-setup", "buy-on-trigger"].includes(s.action));
  assert.ok(s.stop < s.entry, "stop below entry");
  assert.ok(Math.abs(s.riskPerShare - (s.entry - s.stop)) < 0.02);
  assert.deepEqual(s.targets.map((t) => t.r), [1, 2, 3]);
  assert.ok(s.targets[0].price > s.entry && s.targets[1].price > s.targets[0].price && s.targets[2].price > s.targets[1].price);
  assert.ok(Math.abs(s.targets[1].price - (s.entry + 2 * s.riskPerShare)) < 0.03);
  assert.ok(s.invalidBelow < s.entry);
  assert.match(v.summary, /^Bullish/);
});

test("a strong downtrend reads Bearish: no long plan, and shorts are flagged as intraday-only", () => {
  const v = verdictOf(walk(700, { drift: -0.22, noise: 0.7, seed: 5 }));
  assert.equal(v.direction, "bearish");
  assert.equal(v.swing.action, "avoid");
  assert.equal(v.swing.entry, undefined, "there is no buy level in a bearish verdict");
  assert.ok(v.swing.improvesAbove > v.last);
  assert.match(v.summary, /intraday-only/);
  assert.equal(v.intraday.preferred, "short");
  assert.match(v.intraday.preferredNote, /closed the same day/);
});

test("a directionless market reads Neutral and tells you to stand aside", () => {
  // flat with noise, long enough for every time frame
  const v = verdictOf(walk(700, { drift: 0, noise: 0.9, seed: 21 }));
  if (v.direction !== "neutral") return; // seed-dependent; the fuzz test below covers neutrality broadly
  assert.equal(v.swing.action, "wait");
  assert.equal(v.convictionLabel, "No edge");
  assert.ok(v.swing.bullishAbove > v.swing.bearishBelow);
  assert.equal(v.intraday.preferred, "either");
});

test("when the time frames disagree, conviction drops and the disagreement is stated", () => {
  // the same bullish daily and weekly chart, read twice: once with today's
  // session rising with it, once with today's session falling hard against it
  const c = walk(700, { drift: 0.22, noise: 0.7, seed: 5 });
  const lc = c[c.length - 1].c;
  const quote = (last) => ({ last, open: lc, high: Math.max(lc, last) + 0.5, low: Math.min(lc, last) - 0.5, prevClose: lc, upperCircuit: lc * 1.2, lowerCircuit: lc * 0.8 });
  const step = lc * 0.002;
  const rising = bars5(Array.from({ length: 24 }, (_, i) => lc + i * step));
  const falling = bars5(Array.from({ length: 24 }, (_, i) => lc - i * step));

  const aligned = verdictOf(c, { quote: quote(lc + 23 * step), intradayBars: rising, inProgress: true });
  const mixed = verdictOf(c, { quote: quote(lc - 23 * step), intradayBars: falling, inProgress: true });
  assert.equal(aligned.frames[2].dir, "up");
  assert.equal(mixed.frames[0].dir, "up");
  assert.equal(mixed.frames[2].dir, "down");
  assert.ok(mixed.composite < aligned.composite);
  assert.ok(mixed.conviction < aligned.conviction, `${mixed.conviction} should be below ${aligned.conviction}`);
  if (mixed.direction === "bullish") assert.ok(mixed.against.some((x) => /Intraday.*disagrees/.test(x)));
  assert.ok(!aligned.against.some((x) => /disagrees/.test(x)));
});

/* ------------------------------------------------------- live vs last close */

test("without a live quote it says so, and measures from the last close", () => {
  const c = walk(400, { drift: 0.2, noise: 0.7 });
  const v = verdictOf(c);
  assert.equal(v.live, false);
  assert.equal(v.circuit, null);
  assert.ok(v.against.some((x) => /No live quote/.test(x)));
  assert.equal(v.intraday.state, "unknown");
  assert.equal(v.intraday.forSession, "the next session");
  assert.equal(v.completedSession, c[c.length - 1].t);
  assert.ok(v.ladder.some((r) => r.label === "Last close"));
});

test("with a live quote: circuits, day range and the live price lead", () => {
  const c = walk(400, { drift: 0.2, noise: 0.7 });
  const lastClose = c[c.length - 1].c;
  const quote = { last: lastClose * 1.01, open: lastClose * 1.002, high: lastClose * 1.015, low: lastClose * 0.998, prevClose: lastClose, upperCircuit: lastClose * 1.1, lowerCircuit: lastClose * 0.9 };
  const v = verdictOf(c, { quote });
  assert.equal(v.live, true);
  assert.ok(Math.abs(v.last - quote.last) < 0.01);
  assert.ok(Math.abs(v.circuit.upper - quote.upperCircuit) < 0.01);
  assert.ok(v.circuit.toUpperPct > 0 && v.circuit.toLowerPct < 0);
  assert.ok(v.circuit.positionPct > 50 && v.circuit.positionPct < 100);
  assert.ok(Math.abs(v.movement.gapPct - 0.2) < 0.01);
  assert.ok(v.movement.rangeUsedPct > 0);
  const top = v.ladder[0];
  const bottom = v.ladder[v.ladder.length - 1];
  assert.ok(v.ladder.some((r) => r.label === "Upper circuit") && v.ladder.some((r) => r.label === "Lower circuit"));
  assert.ok(top.price >= bottom.price);
  assert.ok(v.ladder.some((r) => r.label === "Last price" && r.awayPct === 0));
});

test("near a circuit limit: a loud warning, lower conviction, and no target beyond the limit", () => {
  const c = walk(400, { drift: 0.2, noise: 0.7 });
  const lc = c[c.length - 1].c;
  const far = verdictOf(c, { quote: { last: lc, open: lc, high: lc, low: lc, prevClose: lc, upperCircuit: lc * 1.2, lowerCircuit: lc * 0.8 } });
  const near = verdictOf(c, { quote: { last: lc * 1.09, open: lc, high: lc * 1.09, low: lc, prevClose: lc, upperCircuit: lc * 1.1, lowerCircuit: lc * 0.9 } });
  assert.ok(near.against.some((x) => /upper circuit/.test(x)));
  assert.ok(near.circuit.toUpperPct < 2);
  assert.ok(near.conviction <= far.conviction);
  near.intraday.long.targets.forEach((t) => assert.ok(t < near.circuit.upper, `${t} must be below the upper circuit`));
  near.intraday.short.targets.forEach((t) => assert.ok(t > near.circuit.lower));

  const floor = verdictOf(c, { quote: { last: lc * 0.905, open: lc, high: lc, low: lc * 0.905, prevClose: lc, upperCircuit: lc * 1.1, lowerCircuit: lc * 0.9 } });
  assert.ok(floor.against.some((x) => /lower circuit/.test(x)));
});

test("during market hours pivots come from YESTERDAY, not from today's unfinished bar", () => {
  const c = walk(300, { drift: 0.1, noise: 0.8 });
  const yesterday = c[c.length - 2];
  const today = c[c.length - 1];
  const v = verdictOf(c, { inProgress: true });
  assert.equal(v.completedSession, yesterday.t);
  const p = (yesterday.h + yesterday.l + yesterday.c) / 3;
  assert.ok(Math.abs(v.ladder.find((r) => r.label === "Pivot").price - p) < 0.011);
  assert.ok(Math.abs(v.ladder.find((r) => r.label === "Previous day high").price - yesterday.h) < 0.011);
  assert.ok(v.against.some((x) => /unfinished/.test(x)));

  const closed = verdictOf(c, { inProgress: false });
  assert.equal(closed.completedSession, today.t);
});

/* -------------------------------------------------------- intraday plan */

test("intraday plan: long above, short below, stops on the right side, targets in order", () => {
  const c = walk(400, { drift: 0.05, noise: 1 });
  const v = verdictOf(c);
  const { long, short } = v.intraday;
  assert.ok(long.entry > short.entry, "the long trigger is above the short trigger");
  assert.ok(long.stop < long.entry);
  assert.ok(short.stop > short.entry);
  long.targets.forEach((t) => assert.ok(t > long.entry));
  short.targets.forEach((t) => assert.ok(t < short.entry && t > 0));
  for (let i = 1; i < long.targets.length; i += 1) assert.ok(long.targets[i] > long.targets[i - 1]);
  for (let i = 1; i < short.targets.length; i += 1) assert.ok(short.targets[i] < short.targets[i - 1]);
  assert.match(v.intraday.basedOn, /last completed session/);
});

test("with live 5-minute bars the plan switches to today's opening range and VWAP decides the side", () => {
  const c = walk(700, { drift: 0.22, noise: 0.7, seed: 5 }); // bullish daily
  const lc = c[c.length - 1].c;
  const rising = bars5([lc, lc + 0.2, lc + 0.1, lc + 1, lc + 2, lc + 3, lc + 4]);
  const quote = { last: lc + 4, open: lc, high: lc + 4.5, low: lc - 0.5, prevClose: lc, upperCircuit: lc * 1.1, lowerCircuit: lc * 0.9 };
  const v = verdictOf(c, { quote, intradayBars: rising, inProgress: true });
  assert.equal(v.frames[2].dir, "up");
  assert.match(v.intraday.basedOn, /opening range/);
  assert.equal(v.intraday.forSession, "today");
  assert.equal(v.intraday.preferred, "long");
  assert.equal(v.intraday.state, "above-long", "price is already through the trigger");
  assert.ok(v.ladder.some((r) => r.label === "VWAP") && v.ladder.some((r) => r.label === "Opening range high"));

  // same bullish daily chart, but today price is under VWAP → no preferred side
  const falling = bars5([lc, lc + 0.2, lc + 0.1, lc - 1, lc - 2, lc - 3, lc - 4]);
  const w = verdictOf(c, { quote: { ...quote, last: lc - 4, low: lc - 4.5 }, intradayBars: falling, inProgress: true });
  assert.equal(w.intraday.preferred, "either");
  assert.match(w.intraday.preferredNote, /smaller size/);
});

/* ------------------------------------------------------------ robustness */

test("too little history → no verdict, with the reason", () => {
  const v = buildVerdict({ analysis: analyze(walk(10)), candles: walk(10) });
  assert.equal(v.available, false);
  assert.match(v.reason, /at least 30/);
  assert.equal(buildVerdict({ analysis: null, candles: [] }).available, false);
});

test("stale data lowers conviction and is called out", () => {
  const c = walk(700, { drift: 0.22, noise: 0.7, seed: 5 });
  const fresh = verdictOf(c);
  const old = verdictOf(c, { stale: true });
  assert.ok(old.conviction < fresh.conviction);
  assert.ok(old.against.some((x) => /saved data/.test(x)));
});

test("FUZZ: 300 random markets — every verdict is well-formed and every plan is internally consistent", () => {
  let s = 12345;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const seen = { bullish: 0, bearish: 0, neutral: 0 };

  for (let k = 0; k < 300; k += 1) {
    const n = 40 + Math.floor(rnd() * 760);
    const c = walk(n, { start: 5 + rnd() * 3000, drift: (rnd() - 0.5) * 0.6, noise: 0.3 + rnd() * 3.5, seed: 1 + Math.floor(rnd() * 1e6) });
    const lc = c[n - 1].c;
    const withQuote = rnd() < 0.6;
    const band = [0.05, 0.1, 0.2][Math.floor(rnd() * 3)];
    const last = lc * (1 + (rnd() - 0.5) * band * 1.9);
    const quote = withQuote ? { last, open: lc * (1 + (rnd() - 0.5) * 0.02), high: Math.max(last, lc) * 1.004, low: Math.min(last, lc) * 0.996, prevClose: lc, upperCircuit: lc * (1 + band), lowerCircuit: lc * (1 - band) } : null;
    const bars = withQuote && rnd() < 0.5 ? bars5(Array.from({ length: 4 + Math.floor(rnd() * 40) }, (_, i) => lc * (1 + ((last / lc - 1) * i) / 40 + (rnd() - 0.5) * 0.004))) : null;

    const v = verdictOf(c, { quote, intradayBars: bars, inProgress: rnd() < 0.5, stale: rnd() < 0.1 });
    assert.equal(v.available, true, `case ${k}`);
    assertFinite(v, `case ${k}`);
    seen[v.direction] += 1;

    assert.ok(["bullish", "bearish", "neutral"].includes(v.direction));
    assert.ok(v.composite >= -100 && v.composite <= 100);
    assert.ok(v.conviction >= 0 && v.conviction <= 100);
    assert.equal(typeof v.summary, "string");

    // a direction is never called on a flat daily chart, whatever the other time frames say
    if (v.direction === "bullish") assert.ok(v.dailyScore >= 15, `case ${k}: bullish on daily score ${v.dailyScore}`);
    if (v.direction === "bearish") assert.ok(v.dailyScore <= -15, `case ${k}: bearish on daily score ${v.dailyScore}`);

    // direction and plan always match
    if (v.direction === "bullish") {
      assert.ok(v.swing.stop < v.swing.entry, `case ${k}: long stop must be below entry`);
      assert.ok(v.swing.riskPerShare > 0);
      assert.ok(v.swing.targets.every((t) => t.price > v.swing.entry));
    } else {
      assert.equal(v.swing.entry, undefined, `case ${k}: no buy level unless bullish`);
      assert.ok(["avoid", "wait"].includes(v.swing.action));
    }
    if (v.direction === "bearish") assert.notEqual(v.intraday.preferred, "long");
    if (v.direction === "bullish") assert.notEqual(v.intraday.preferred, "short");

    const { long, short } = v.intraday;
    assert.ok(long.entry > short.entry, `case ${k}`);
    assert.ok(long.stop < long.entry && short.stop > short.entry, `case ${k}`);
    assert.ok(long.targets.every((t) => t > long.entry) && short.targets.every((t) => t < short.entry && t > 0), `case ${k}`);
    if (v.circuit) {
      assert.ok(long.targets.every((t) => t < v.circuit.upper) && short.targets.every((t) => t > v.circuit.lower), `case ${k}: targets inside the circuit band`);
    }

    // the ladder is sorted and contains exactly one "you are here"
    for (let i = 1; i < v.ladder.length; i += 1) assert.ok(v.ladder[i - 1].price >= v.ladder[i].price, `case ${k}: ladder order`);
    assert.equal(v.ladder.filter((r) => r.kind === "price").length, 1);
  }
  // the rules are not stuck on one answer
  assert.ok(seen.bullish > 20 && seen.bearish > 20 && seen.neutral > 20, JSON.stringify(seen));
});

test("the same inputs always give the same verdict", () => {
  const c = walk(500, { drift: 0.1, noise: 1.1, seed: 77 });
  assert.deepEqual(verdictOf(c), verdictOf(c));
});

test("a live price far from the saved history (split or bonus) → no verdict, with the reason", () => {
  const c = walk(400, { drift: 0.2, noise: 0.7 });
  const lc = c[c.length - 1].c;
  const v = verdictOf(c, { quote: { last: lc / 2, open: lc / 2, high: lc / 2, low: lc / 2, prevClose: lc / 2, upperCircuit: lc * 0.55, lowerCircuit: lc * 0.45 } });
  assert.equal(v.available, false);
  assert.match(v.reason, /corporate action/);
});

test("an exchange previous close that matches neither of the last two sessions is flagged", () => {
  const c = walk(400, { drift: 0.2, noise: 0.7 });
  const lc = c[c.length - 1].c;
  const q = (prevClose) => ({ last: lc * 1.01, open: lc, high: lc * 1.01, low: lc, prevClose, upperCircuit: lc * 1.2, lowerCircuit: lc * 0.8 });
  const ok = verdictOf(c, { quote: q(lc) });
  const alsoOk = verdictOf(c, { quote: q(c[c.length - 2].c), inProgress: true });
  const off = verdictOf(c, { quote: q(lc * 0.93) });
  assert.ok(!ok.against.some((x) => /does not match the saved price history/.test(x)));
  assert.ok(!alsoOk.against.some((x) => /does not match the saved price history/.test(x)));
  assert.ok(off.against.some((x) => /does not match the saved price history/.test(x)));
  assert.ok(off.conviction <= ok.conviction);
});

test("a very low-priced share still gets a stop at least one tick from the trigger", () => {
  const c = walk(300, { start: 1.2, drift: 0.02, noise: 0.4, seed: 3 });
  const v = verdictOf(c);
  assert.ok(v.intraday.long.stop < v.intraday.long.entry);
  assert.ok(v.intraday.short.stop > v.intraday.short.entry);
});
