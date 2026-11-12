"use strict";
// The live intraday call and the long-term view.

const test = require("node:test");
const assert = require("node:assert/strict");

const { liveCall, sessionAt, tradeTime, buildTape, fastRead, barStart } = require("../market/intraday");
const { longTermView, cagr } = require("../market/longterm");
const { analyze } = require("../market/analyze");
const { buildVerdict } = require("../market/verdict");
const I = require("../market/indicators");

// Thursday 12 Nov 2026, at a given IST clock time
const at = (hhmm) => Date.parse(`2026-11-12T${hhmm}:00+05:30`);

/** 5-minute bars from 09:15, one per price. */
function tape(prices, { vol = 1000, spread = 0.3 } = {}) {
  return prices.map((p, i) => {
    const m = 9 * 60 + 15 + i * 5;
    const t = `2026-11-12T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00+0530`;
    const o = i === 0 ? p : prices[i - 1];
    return { t, o, h: Math.max(o, p) + spread, l: Math.min(o, p) - spread, c: p, v: typeof vol === "function" ? vol(i) : vol };
  });
}
const ramp = (from, step, n) => Array.from({ length: n }, (_, i) => from + i * step);
const quoteFor = (bars, last, extra = {}) => ({
  last,
  open: bars[0].o,
  high: Math.max(last, ...bars.map((b) => b.h)),
  low: Math.min(last, ...bars.map((b) => b.l)),
  prevClose: bars[0].o,
  volume: bars.reduce((s, b) => s + b.v, 0),
  time: null,
  ...extra,
});
const done = { t: "2026-11-11", o: 99, h: 101, l: 98, c: 100, v: 500000 };
const call = (bars, last, hhmm, extra = {}) =>
  liveCall({ bars, quote: quoteFor(bars, last, extra.quote), atr: 4, done, pivots: I.pivots(done), nowMs: at(hhmm), avgVolume: 500000, ...extra, ...(extra.quote ? { quote: quoteFor(bars, last, extra.quote) } : {}) });

function assertFinite(obj, path = "x") {
  if (obj === null || obj === undefined) return;
  if (typeof obj === "number") assert.ok(Number.isFinite(obj), `${path} is ${obj}`);
  else if (Array.isArray(obj)) obj.forEach((v, i) => assertFinite(v, `${path}[${i}]`));
  else if (typeof obj === "object") Object.entries(obj).forEach(([k, v]) => assertFinite(v, `${path}.${k}`));
}

/* ------------------------------------------------------------- the clock */

test("the session clock: each part of the NSE day, in IST", () => {
  const phase = (t) => sessionAt(at(t)).phase;
  assert.equal(phase("09:05"), "preopen");
  assert.equal(phase("09:15"), "opening");
  assert.equal(phase("09:29"), "opening");
  assert.equal(phase("09:30"), "morning");
  assert.equal(phase("11:30"), "midday");
  assert.equal(phase("13:30"), "afternoon");
  assert.equal(phase("14:45"), "late");
  assert.equal(phase("15:15"), "squareoff");
  assert.equal(phase("15:30"), "closed");
  assert.equal(phase("08:00"), "closed");
  assert.equal(sessionAt(Date.parse("2026-11-14T10:30:00+05:30")).phase, "closed", "Saturday");

  const s = sessionAt(at("10:50"));
  assert.equal(s.ist, "10:50");
  assert.equal(s.open, true);
  assert.equal(s.entries, true);
  assert.equal(s.minutesToCutoff, 235);
  assert.equal(s.minutesToSquareOff, 265);
  assert.equal(s.elapsedPct, 25);
  assert.equal(sessionAt(at("14:50")).entries, false);
  assert.equal(sessionAt(at("14:50")).minutesToCutoff, 0);
});

test("Kite trade times are read as IST", () => {
  assert.equal(tradeTime("2026-11-12 10:15:00"), Date.parse("2026-11-12T04:45:00Z"));
  assert.equal(tradeTime("2026-11-12T10:15:00+05:30"), Date.parse("2026-11-12T04:45:00Z"));
  assert.equal(tradeTime(null), null);
  assert.equal(tradeTime("rubbish"), null);
});

/* -------------------------------------------------------------- the call */

test("steady buying above VWAP and the opening range → Long in play, with a stop and targets", () => {
  const bars = tape(ramp(100, 0.15, 16)); // 09:15 → 10:30, 100 → 102.25
  const c = call(bars, 102.4, "10:32");
  assert.equal(c.available, true);
  assert.equal(c.state, "long");
  assert.equal(c.bias, "long");
  assert.ok(c.score >= 35);
  assert.match(c.headline, /Long — in play/);
  assert.equal(c.plan.side, "long");
  assert.equal(c.plan.entry, 102.4);
  assert.ok(c.plan.stop < c.plan.entry);
  assert.ok(c.plan.entry - c.plan.stop >= 0.2 * 4 - 0.03 && c.plan.entry - c.plan.stop <= 0.8 * 4 + 0.03, "stop between 0.2 and 0.8 ATR away");
  assert.deepEqual(c.plan.targets.map((t) => t.label), ["1R", "2R"]);
  assert.ok(Math.abs(c.plan.targets[1].price - (c.plan.entry + 2 * c.plan.riskPerShare)) < 0.02);
  assert.ok(c.movement.vsVwapPct > 0 && c.movement.fromOpenPct > 0 && c.movement.m30Pct > 0);
  assert.equal(c.session.phase, "morning");
});

test("steady selling below VWAP and the opening range → Short in play, mirrored", () => {
  const bars = tape(ramp(100, -0.15, 16));
  const c = call(bars, 97.6, "10:32");
  assert.equal(c.state, "short");
  assert.ok(c.score <= -35);
  assert.ok(c.plan.stop > c.plan.entry);
  assert.ok(c.plan.targets.every((t) => t.price < c.plan.entry && t.price > 0));
  assert.ok(c.notes.some((n) => /intraday-only/.test(n)), "the cash-market short rule is stated");
});

test("leaning up but still under the opening-range high → wait for the trigger, do not anticipate", () => {
  // a wide first 15 minutes (97.2 – 103.3), then a steady climb that has not cleared it yet
  const bars = tape([100, 103, 97.5, ...ramp(98, 0.2, 24)]);
  const c = call(bars, 102.7, "11:25");
  assert.equal(c.bias, "long");
  assert.equal(c.state, "wait-long");
  assert.match(c.headline, /long only above/);
  assert.equal(c.plan.entry, c.triggers.long);
  assert.ok(c.plan.entry > 102.7, "the entry is the trigger, not the current price");
  assert.equal(c.plan.entryNote, "only if it trades there");
});

test("a move that has run too far from its stop level → wait for a pullback instead of chasing", () => {
  const bars = tape(ramp(100, 0.5, 16)); // +7.5 in 75 minutes with ATR 4
  const c = call(bars, 108, "10:32");
  assert.equal(c.state, "wait-long");
  assert.match(c.headline, /pullback/);
  assert.ok(c.plan.entry < 108);
  assert.ok(c.notes.some((n) => /range is already/.test(n)));
});

test("a flat, directionless tape → Wait, with both triggers and no plan", () => {
  const bars = tape([100, 100.1, 99.9, 100, 100.05, 99.95, 100, 100.1, 99.9, 100, 100, 100.05]);
  const c = call(bars, 100, "10:15");
  assert.equal(c.state, "wait");
  assert.equal(c.bias, "none");
  assert.equal(c.plan, null);
  assert.ok(c.triggers.long > c.triggers.short);
  assert.ok(Math.abs(c.score) < 35);
});

test("a gap up that is being sold: short bias, but no short until the opening-range low breaks", () => {
  // the shape of the user's screenshot: +6% gap, opens near the high, fades toward the low
  const prices = [464, 460, 455, ...ramp(456, -0.12, 17)];
  const bars = tape(prices, { spread: 1.5 });
  const orLow = Math.min(...bars.slice(0, 3).map((b) => b.l));
  const last = orLow + 1.2;
  const c = liveCall({
    bars,
    quote: { last, open: 464, high: 466.8, low: 450.1, prevClose: 436.35, volume: 14600000, time: "2026-11-12 10:50:40" },
    atr: 15,
    done: { t: "2026-11-11", o: 430, h: 440, l: 428, c: 436.35, v: 9000000 },
    pivots: I.pivots({ h: 440, l: 428, c: 436.35 }),
    circuit: { upper: 523.6, lower: 349.1 },
    nowMs: at("10:50"),
    dailyDirection: "neutral",
    avgVolume: 9000000,
  });
  assert.equal(c.bias, "short");
  assert.equal(c.state, "wait-short");
  assert.equal(c.plan.entry, c.triggers.short);
  assert.ok(c.plan.stop > c.plan.entry);
  assert.ok(c.notes.some((n) => /gap/.test(n) && /giving it back/.test(n)));
  assert.equal(c.movement.gapPct, 6.34);
  assert.ok(c.movement.volumePace > 1, "heavy volume for the time of day");
});

/* ------------------------------------------------- reasons to stand down */

test("the first 15 minutes: no trade, whatever the tape says", () => {
  const c = call(tape([100, 100.8]), 101.2, "09:22");
  assert.equal(c.state, "no-trade");
  assert.match(c.headline, /opening range is forming/);
  assert.equal(c.plan, null);
});

test("after 2:45 PM: no fresh entries; after 3:15 PM: square-off window", () => {
  const bars = tape(ramp(100, 0.04, 66));
  const late = call(bars, 102.9, "14:50");
  assert.equal(late.state, "no-trade");
  assert.match(late.headline, /No fresh entries/);
  assert.equal(late.plan, null);
  assert.equal(late.bias, "long", "the reading is still shown, only the entry is refused");
  const sq = call(bars, 102.9, "15:17");
  assert.match(sq.headline, /square-off/);
});

test("market closed, weekend, or no bars today → no live call, with the reason", () => {
  const bars = tape(ramp(100, 0.1, 10));
  assert.equal(call(bars, 101, "17:00").available, false);
  assert.match(call(bars, 101, "17:00").reason, /closed/);
  assert.equal(call(bars, 101, "09:10").available, false);
  const holiday = liveCall({ bars: [], quote: { last: 100 }, atr: 4, done, nowMs: at("11:00") });
  assert.equal(holiday.available, false);
  assert.match(holiday.reason, /No trades today/);
  assert.equal(liveCall({ bars, quote: null, atr: 4, done, nowMs: at("11:00") }).available, false);
  assert.equal(liveCall({ bars, quote: { last: 100 }, atr: 4, done, nowMs: Date.parse("2026-11-14T11:00:00+05:30") }).available, false);
});

test("a stale last trade → no trade (thin stock or delayed feed)", () => {
  const bars = tape(ramp(100, 0.15, 16));
  const fresh = call(bars, 102.4, "10:32", { quote: { time: "2026-11-12 10:31:50" } });
  assert.equal(fresh.state, "long");
  assert.equal(fresh.movement.quoteAgeSec, 10);
  const stale = call(bars, 102.4, "10:32", { quote: { time: "2026-11-12 10:20:00" } });
  assert.equal(stale.state, "no-trade");
  assert.match(stale.headline, /last trade is old/);
});

test("circuit limits: no long close under the upper circuit, nothing at all when locked", () => {
  const bars = tape(ramp(100, 0.15, 16));
  const roomy = call(bars, 102.4, "10:32", { circuit: { upper: 110, lower: 90 } });
  assert.equal(roomy.state, "long");
  const tight = call(bars, 102.4, "10:32", { circuit: { upper: 103.2, lower: 90 } });
  assert.equal(tight.state, "no-trade");
  assert.match(tight.headline, /too close to the upper circuit/);
  const locked = call(bars, 102.4, "10:32", { circuit: { upper: 102.45, lower: 90 } });
  assert.match(locked.headline, /at the upper circuit/);

  // targets never go beyond the circuit
  const capped = call(bars, 102.4, "10:32", { circuit: { upper: 104.5, lower: 90 } });
  if (capped.plan) capped.plan.targets.forEach((t) => assert.ok(t.price < 104.5));
});

test("midday needs a stronger reading than the morning", () => {
  const bars = tape(ramp(100, 0.02, 40));
  assert.equal(call(bars.slice(0, 16), 100.4, "10:32").threshold, 35);
  assert.equal(call(bars, 100.9, "12:30").threshold, 45);
});

test("a day trade against the daily trend is flagged", () => {
  const bars = tape(ramp(100, 0.15, 16));
  const c = call(bars, 102.4, "10:32", { dailyDirection: "bearish" });
  assert.equal(c.withDaily, "against");
  assert.ok(c.notes.some((n) => /against the daily trend/.test(n)));
  assert.equal(call(bars, 102.4, "10:32", { dailyDirection: "bullish" }).withDaily, "with");
});

test("the score is the sum of its visible factors, each within its own weight", () => {
  const c = call(tape(ramp(100, 0.15, 16)), 102.4, "10:32");
  assert.equal(c.factors.reduce((s, f) => s + f.max, 0), 100);
  c.factors.forEach((f) => assert.ok(Math.abs(f.pts) <= f.max, `${f.name}: ${f.pts} within ±${f.max}`));
  assert.equal(Math.max(-100, Math.min(100, c.factors.reduce((s, f) => s + f.pts, 0))), c.score);
});

test("FUZZ: 500 random tapes and clock times — every call is well-formed and every plan is coherent", () => {
  let s = 987654;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const states = {};
  for (let k = 0; k < 500; k += 1) {
    const n = 1 + Math.floor(rnd() * 74);
    const base = 5 + rnd() * 3000;
    const atr = base * (0.01 + rnd() * 0.04);
    const drift = (rnd() - 0.5) * atr * 0.08;
    let p = base;
    const prices = Array.from({ length: n }, () => (p = Math.max(1, p + drift + (rnd() - 0.5) * atr * 0.12)));
    const bars = tape(prices, { spread: atr * 0.03, vol: () => 500 + Math.floor(rnd() * 5000) });
    const last = Math.max(0.5, prices[n - 1] + (rnd() - 0.5) * atr * 0.1);
    const mins = 9 * 60 + Math.floor(rnd() * 420); // 09:00 – 16:00
    const hhmm = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
    const band = [0.05, 0.1, 0.2][Math.floor(rnd() * 3)];
    const circuit = rnd() < 0.6 ? { upper: base * (1 + band), lower: base * (1 - band) } : null;
    const c = liveCall({
      bars,
      prior: rnd() < 0.5 ? tape(ramp(base, 0, 40)) : [],
      quote: { ...quoteFor(bars, last), prevClose: base * (1 + (rnd() - 0.5) * 0.06), avgPrice: rnd() < 0.5 ? base : null },
      atr,
      done: { t: "2026-11-11", o: base, h: base + atr / 2, l: base - atr / 2, c: base, v: 100000 },
      pivots: I.pivots({ h: base + atr / 2, l: base - atr / 2, c: base }),
      circuit,
      nowMs: at(hhmm),
      dailyDirection: ["bullish", "bearish", "neutral"][Math.floor(rnd() * 3)],
      avgVolume: rnd() < 0.8 ? 200000 : null,
      market: rnd() < 0.5 ? { tide: { score: Math.round((rnd() - 0.5) * 200), label: "x", summary: "s." }, nifty: { fromOpenPct: (rnd() - 0.5) * 3 }, vix: { changePct: (rnd() - 0.5) * 30 }, world: rnd() < 0.3 ? { mood: rnd() < 0.5 ? "risk_off" : "risk_on", time: "08:55", headline: "h" } : null } : null,
    });
    assertFinite(c, `case ${k}`);
    if (!c.available) {
      assert.equal(typeof c.reason, "string");
      assert.equal(c.session.open, false, `case ${k}: with bars and a quote, only a closed session gives no call`);
      continue;
    }
    states[c.state] = (states[c.state] || 0) + 1;
    assert.ok(["long", "short", "wait-long", "wait-short", "wait", "no-trade"].includes(c.state), `case ${k}`);
    assert.ok(c.score >= -100 && c.score <= 100);
    assert.equal(typeof c.headline, "string");
    assert.ok(c.triggers.long > c.triggers.short, `case ${k}`);
    if (!c.session.entries) assert.equal(c.state, "no-trade", `case ${k}: no entries in phase ${c.session.phase}`);
    if (c.state === "no-trade" || c.state === "wait") assert.equal(c.plan, null, `case ${k}`);
    else {
      const pl = c.plan;
      assert.equal(pl.side, c.state.replace("wait-", ""), `case ${k}`);
      if (pl.side === "long") {
        assert.ok(pl.stop < pl.entry, `case ${k}: long stop ${pl.stop} must be under entry ${pl.entry}`);
        pl.targets.forEach((t) => assert.ok(t.price > pl.entry && (!circuit || t.price < circuit.upper), `case ${k}`));
        pl.nextLevels.forEach((l) => assert.ok(l.price > pl.entry, `case ${k}`));
      } else {
        assert.ok(pl.stop > pl.entry, `case ${k}: short stop ${pl.stop} must be over entry ${pl.entry}`);
        pl.targets.forEach((t) => assert.ok(t.price < pl.entry && t.price > 0 && (!circuit || t.price > circuit.lower), `case ${k}`));
        pl.nextLevels.forEach((l) => assert.ok(l.price < pl.entry, `case ${k}`));
      }
      assert.ok(pl.riskPerShare > 0, `case ${k}`);
    }
    // an entry "at the current price" really is the current price
    if (c.state === "long" || c.state === "short") assert.equal(c.plan.entry, c.movement.last, `case ${k}`);
  }
  assert.ok(Object.keys(states).length >= 5, JSON.stringify(states));
});

/* -------------------------------------------------------------- long term */

const dayN = (i) => new Date(Date.UTC(2020, 0, 6) + i * 86400000).toISOString().slice(0, 10);
function walk(n, { start = 100, drift = 0.05, noise = 1, seed = 7 } = {}) {
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
    out.push({ t: dayN(i), o, h: Math.max(o, p) * 1.003, l: Math.min(o, p) * 0.997, c: p, v: 100000 });
  }
  return out;
}
const lt = (c, last) => longTermView(c, analyze(c, { chartBars: 1 }), last);

test("compound annual growth: exact on a known series, null when history is too short", () => {
  const c = Array.from({ length: 732 }, (_, i) => ({ t: dayN(i), o: 100, h: 100, l: 100, c: 100, v: 1 }));
  c[c.length - 1].c = 200; // doubled over almost exactly two years
  assert.ok(Math.abs(cagr(c, 2) - 41.4) < 0.3, String(cagr(c, 2)));
  assert.equal(cagr(c, 5), null);
});

test("long-term view: a multi-year rise reads as an uptrend, with the line that would end it", () => {
  const v = lt(walk(1400, { drift: 0.12, noise: 0.8 }));
  assert.equal(v.available, true);
  assert.equal(v.trend, "up");
  assert.equal(v.stance, "Long-term uptrend");
  assert.ok(v.met >= 5 && v.met <= v.total);
  assert.ok(v.checks.find((c) => /200-day average$/.test(c.name)).ok);
  assert.match(v.rule, /40-week average/);
  assert.ok(v.levels.line > 0 && v.levels.ema200 > 0 && v.levels.week30 > 0);
  assert.ok(v.returns.cagr3 > 0);
  assert.equal(v.returns.cagr5, null, "under four years of history");
  assert.ok(v.returns.years > 3.5);
  assert.match(v.caveat, /Earnings, debt, valuation/);
});

test("long-term view: a multi-year fall reads as a downtrend and says it is not a hold", () => {
  const v = lt(walk(1400, { drift: -0.1, noise: 0.8 }));
  assert.equal(v.trend, "down");
  assert.match(v.rule, /not a long-term hold/);
  assert.ok(v.risk.maxDrawdownPct > 40);
  assert.ok(v.notes.some((n) => /fallen as much as/.test(n)));
});

test("long-term view: needs about a year of history, and survives any random series", () => {
  assert.equal(lt(walk(120)).available, false);
  for (let k = 0; k < 60; k += 1) {
    const v = lt(walk(260 + k * 37, { drift: (k % 7) * 0.05 - 0.15, noise: 0.4 + (k % 5) * 0.7, seed: k + 1 }));
    assert.equal(v.available, true);
    assertFinite(v, `long-term ${k}`);
    assert.ok(["up", "down", "mixed"].includes(v.trend));
    if (v.trend === "up") assert.ok(v.checks[0].ok, "an uptrend is never called below the 200-day average");
    if (v.trend === "down") assert.ok(!v.checks[0].ok);
  }
});

/* ------------------------------------------------- inside the desk verdict */

test("the desk verdict carries all three horizons: live intraday, swing, long term", () => {
  const c = walk(900, { drift: 0.1, noise: 0.8 });
  const lc = c[c.length - 1].c;
  const bars = tape(ramp(lc, lc * 0.001, 16));
  const quote = { last: lc * 1.017, open: lc, high: lc * 1.018, low: lc * 0.999, prevClose: lc, volume: 400000, upperCircuit: lc * 1.1, lowerCircuit: lc * 0.9 };
  const a = analyze(c, { chartBars: 1 });
  const v = buildVerdict({ analysis: a, candles: c, quote, intradayBars: bars, nowMs: at("10:32") });
  assert.equal(v.day.available, true);
  assert.ok(["long", "wait-long"].includes(v.day.state), v.day.state);
  assert.equal(v.longTerm.available, true);
  assert.ok(["bullish", "bearish", "neutral"].includes(v.direction));
  assertFinite(v);

  // no clock → no live call, but the rest of the verdict is intact
  const noClock = buildVerdict({ analysis: a, candles: c, quote, intradayBars: bars });
  assert.equal(noClock.day.available, false);
  assert.equal(noClock.longTerm.available, true);

  // after the close the same inputs give no live call
  const evening = buildVerdict({ analysis: a, candles: c, quote, intradayBars: bars, nowMs: at("18:00") });
  assert.equal(evening.day.available, false);
  assert.match(evening.day.reason, /closed/);
});

test("a breakout is not 'in play' until a 5-minute bar has CLOSED beyond the opening range", () => {
  // quiet for an hour, then the forming bar pokes through the opening-range high
  const quiet = [100, 100.2, 99.9, ...Array.from({ length: 12 }, (_, i) => 100.05 + (i % 2) * 0.05)];
  const bars = tape([...quiet, 100.3]); // the 16th bar began at 10:30 and is still forming
  const poke = liveCall({ bars, prior: tape(ramp(99, 0.02, 40)), quote: quoteFor(bars, 101.2), atr: 4, done, pivots: I.pivots(done), nowMs: at("10:32"), avgVolume: 500000 });
  assert.equal(poke.triggers.closedAbove, false);
  if (poke.bias === "long") {
    assert.equal(poke.state, "wait-long");
    assert.match(poke.headline, /not yet confirmed/);
    assert.equal(poke.plan.entryNote, "after a 5-minute close above it");
  } else assert.equal(poke.state, "wait");

  // the same price once that bar has closed above the range
  const closedBars = tape([...quiet, 101.1, 101.2]);
  const confirmed = liveCall({ bars: closedBars, prior: tape(ramp(99, 0.02, 40)), quote: quoteFor(closedBars, 101.2), atr: 4, done, pivots: I.pivots(done), nowMs: at("10:37"), avgVolume: 500000 });
  assert.equal(confirmed.triggers.closedAbove, true);
  assert.equal(confirmed.state, "long");
});

test("bar times with Kite's +0530 zone are read correctly", () => {
  assert.equal(barStart("2026-11-12T09:15:00+0530"), Date.parse("2026-11-12T03:45:00Z"));
  assert.equal(barStart("2026-11-12T09:15:00+05:30"), Date.parse("2026-11-12T03:45:00Z"));
  assert.equal(barStart("nonsense"), null);
});

test("the tape for the intraday chart: times, OHLC, running VWAP and the opening range", () => {
  const bars = tape([100, 101, 102, 103], { vol: 1000 });
  const t = buildTape(bars, { prevClose: 99.5 });
  assert.equal(t.date, "2026-11-12");
  assert.deepEqual(t.bars.map((b) => b.t), ["09:15", "09:20", "09:25", "09:30"]);
  assert.equal(t.bars[3].c, 103);
  assert.ok(t.bars[3].w > t.bars[0].w, "VWAP rises with price");
  assert.equal(t.orHigh, 102.3);
  assert.equal(t.orLow, 99.7);
  assert.equal(t.prevClose, 99.5);
  assert.equal(buildTape([]), null);
  assert.equal(buildTape(tape([100])).orHigh, null, "no opening range from a single bar");
});

test("the market's tide moves the score, visibly: with it, against it, and not at all when unknown", () => {
  const bars = tape(ramp(100, 0.15, 16));
  const alone = call(bars, 102.4, "10:32");
  assert.equal(alone.marketAdj, 0);
  assert.deepEqual(alone.marketFactors, []);
  assert.equal(alone.score, alone.tapeScore);

  const tide = (score, fromOpenPct) => ({ tide: { score, label: score > 0 ? "Rising" : "Falling", summary: `${score > 0 ? "Rising" : "Falling"} tide (${score}).` }, nifty: { fromOpenPct }, vix: { changePct: 1 } });
  const withIt = call(bars, 102.4, "10:32", { market: tide(80, 0.2) });
  const against = call(bars, 102.4, "10:32", { market: tide(-80, -0.9) });
  assert.equal(withIt.tapeScore, alone.tapeScore, "the tape reading itself does not change");
  assert.deepEqual(withIt.factors, alone.factors);
  assert.equal(withIt.marketFactors[0].pts, 6);
  assert.equal(against.marketFactors[0].pts, -6);
  // the stock is +2.4% since its open: well ahead of the index either way
  assert.equal(withIt.marketFactors[1].pts, 7);
  assert.equal(against.marketFactors[1].pts, 7);
  assert.match(withIt.marketFactors[1].reading, /stock \+2\.40% vs Nifty \+0\.20%/);
  assert.equal(withIt.score, Math.min(100, alone.tapeScore + 13));
  assert.equal(against.score, Math.min(100, alone.tapeScore + 1));
  assert.ok(against.notes.some((n) => /market is falling/.test(n) && /swims against/.test(n)));
  assert.ok(!withIt.notes.some((n) => /swims against/.test(n)));

  // a stock lagging a strongly rising index loses on both counts, and the bias follows the final score
  const lagging = call(tape(ramp(100, 0.03, 16)), 100.5, "10:32", { market: tide(-100, 2.0) });
  assert.equal(lagging.marketFactors[0].pts, -8);
  assert.equal(lagging.marketFactors[1].pts, -7);
  assert.equal(lagging.score, Math.max(-100, lagging.tapeScore - 15));
  assert.equal(lagging.bias, lagging.score >= 35 ? "long" : lagging.score <= -35 ? "short" : "none");
});

test("India VIX and a contrary world brief are mentioned — never scored", () => {
  const bars = tape(ramp(100, 0.15, 16));
  const m = { tide: { score: 0, label: "Slack", summary: "Slack tide (0)." }, nifty: { fromOpenPct: 2.4 }, vix: { changePct: 9.5 }, world: { mood: "risk_off", time: "08:55", headline: "US fell, crude up" } };
  const c = call(bars, 102.4, "10:32", { market: m });
  assert.equal(c.marketAdj, 0);
  assert.equal(c.score, c.tapeScore);
  assert.ok(c.notes.some((n) => /India VIX is up 9\.5% today/.test(n)));
  const world = c.notes.find((n) => /World cues at 08:55 read risk-off/.test(n));
  assert.match(world, /US fell, crude up/);
  assert.match(world, /web search/, "it says where it came from");
  const agree = call(bars, 102.4, "10:32", { market: { ...m, world: { ...m.world, mood: "risk_on" } } });
  assert.ok(!agree.notes.some((n) => /World cues/.test(n)), "a brief that agrees with the trade needs no warning");
  const calm = call(bars, 102.4, "10:32", { market: { ...m, vix: { changePct: 2 }, world: null } });
  assert.ok(!calm.notes.some((n) => /VIX/.test(n)));
});

/* ---------------------------------------------------------- early warnings */

const at5 = (i) => {
  const m = 9 * 60 + 15 + i * 5;
  return `2026-11-12T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00+0530`;
};
const ohlc = (rows) => rows.map(([o, h, l, c], i) => ({ t: at5(i), o, h, l, c, v: 1000 }));
const ids = (c) => c.early.map((e) => e.id);

test("a clean trend raises no early warning", () => {
  const c = call(tape(ramp(100, 0.15, 16)), 102.4, "10:32");
  assert.deepEqual(c.early, []);
  assert.equal(c.weakening, false);
  assert.ok(!/Early warning/.test(c.detail));
});

test("a breakout that falls back inside the opening range is flagged as failed", () => {
  // up through the range to 102, then all the way back under it and under VWAP
  const bars = tape([100, 100.2, 100.1, 100.6, 101.2, 101.8, 102.0, 101.6, 101.0, 100.5, 100.2, 100.0]);
  const c = call(bars, 99.9, "10:17");
  const w = c.early.find((e) => e.id === "failed-breakout");
  assert.ok(w, JSON.stringify(ids(c)));
  assert.equal(w.against, "long");
  assert.match(w.text, /failed breakout/);
  assert.ok(!ids(c).includes("failed-breakdown"));
  // the mirror image
  const down = tape([100, 99.8, 99.9, 99.4, 98.8, 98.2, 98.0, 98.4, 99.0, 99.5, 99.8, 100.0]);
  const d = call(down, 100.1, "10:17");
  assert.equal(d.early.find((e) => e.id === "failed-breakdown").against, "short");
});

test("falling through the last swing low breaks the run of higher lows — the first sign an up-move is over", () => {
  // two rising swing lows (100.6 then 101.7), a new high at 103.1, then a drop through 101.7
  const bars = ohlc([
    [100.0, 100.5, 99.9, 100.4],
    [100.4, 101.2, 100.3, 101.1],
    [101.1, 101.9, 101.0, 101.8],
    [101.8, 101.85, 101.0, 101.1],
    [101.1, 101.2, 100.6, 100.8],
    [100.8, 101.6, 100.7, 101.5],
    [101.5, 102.4, 101.4, 102.3],
    [102.3, 103.0, 102.2, 102.9],
    [102.9, 102.95, 102.2, 102.3],
    [102.3, 102.4, 101.7, 101.9],
    [101.9, 102.6, 101.8, 102.5],
    [102.5, 103.1, 102.4, 103.0],
    [103.0, 103.05, 101.2, 101.3], // still forming
  ]);
  const before = call(bars.slice(0, 12), 103.0, "10:16");
  assert.ok(!ids(before).includes("structure-down"), "while the lows keep rising there is nothing to warn about");
  const c = call(bars, 101.3, "10:17");
  const w = c.early.find((e) => e.id === "structure-down");
  assert.ok(w, JSON.stringify(ids(c)));
  assert.match(w.text, /swing low \(₹101\.70\)/);
  assert.equal(w.against, "long");
});

test("tape speed: a rush in the last minute is a warning, and it marks an open trade as weakening", () => {
  const bars = tape(ramp(100, 0.15, 16));
  const calm = call(bars, 102.4, "10:32", { micro: { d30: 0.05, d60: 0.1, d180: 0.2 } });
  assert.deepEqual(calm.early, []);
  // ATR is 4: a 0.6 drop in sixty seconds is 15% of a normal day's range
  const rush = call(bars, 102.4, "10:32", { micro: { d30: -0.4, d60: -0.6, d180: -0.5 } });
  assert.equal(rush.state, "long", "an early warning never flips the call by itself…");
  assert.deepEqual(ids(rush), ["tape-down"]);
  assert.equal(rush.weakening, true, "…but the open long is marked as weakening");
  assert.match(rush.detail, /Early warning: Dropping fast: -0\.60 in the last minute — 15% of a normal day's range/);
  // the same rush is not a threat to a short, and a rush upward is
  const up = call(tape(ramp(100, -0.15, 16)), 97.6, "10:32", { micro: { d60: 0.6 } });
  assert.equal(up.state, "short");
  assert.equal(up.early[0].id, "tape-up");
  assert.equal(up.weakening, true);
  const withIt = call(tape(ramp(100, -0.15, 16)), 97.6, "10:32", { micro: { d60: -0.6 } });
  assert.equal(withIt.weakening, false, "selling that speeds up does not threaten a short");
});

test("price sitting on VWAP is called out as a test of the day's fair price", () => {
  const bars = tape([100, 100.1, 99.9, 100, 100.05, 99.95, 100, 100.1, 99.9, 100, 100, 100.05]);
  const c = call(bars, 100.01, "10:17");
  const w = c.early.find((e) => e.id === "vwap-test");
  assert.ok(w, JSON.stringify(ids(c)));
  assert.equal(w.against, "either");
  assert.equal(c.weakening, false);
});

/* --------------------------------------------------------- 1-minute tape */

const at1 = (i) => {
  const m = 9 * 60 + 15 + i;
  return `2026-11-12T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00+0530`;
};
const minuteBars = (closes, vol = 1000) => closes.map((c, i) => ({ t: at1(i), o: i ? closes[i - 1] : c, h: Math.max(c, i ? closes[i - 1] : c) + 0.05, l: Math.min(c, i ? closes[i - 1] : c) - 0.05, c, v: typeof vol === "function" ? vol(i) : vol }));

test("1-minute tape: the opening range is every bar before 9:30, whatever the bar size", () => {
  const t1 = buildTape(minuteBars(ramp(100, 0.02, 40)));
  assert.equal(t1.bars.length, 40);
  assert.equal(t1.bars[14].t, "09:29");
  // fifteen bars: 100.00 → 100.28
  assert.equal(t1.orHigh, 100.33);
  assert.equal(t1.orLow, 99.95);
  assert.equal(buildTape(minuteBars(ramp(100, 0.02, 10))).orHigh, null, "until 9:30 the range is still forming");
});

test("the quick 1-minute read: trend, momentum and structure", () => {
  const up = fastRead(minuteBars(ramp(100, 0.05, 60)));
  assert.equal(up.available, true);
  assert.equal(up.trend, "up");
  assert.ok(up.rsi > 70);
  assert.ok(up.m15Pct > up.m5Pct && up.m5Pct > up.m1Pct && up.m1Pct > 0);
  assert.match(up.summary, /^1-minute trend up; .*RSI \d+; \+0\.\d+% in five minutes\.$/);
  const down = fastRead(minuteBars(ramp(100, -0.05, 60)));
  assert.equal(down.trend, "down");
  assert.ok(down.rsi < 30 && down.m5Pct < 0);
  // the live price stands in for the bar still forming: a sharp dip turns an up-trend into a pause
  const dip = fastRead(minuteBars(ramp(100, 0.05, 60)), { last: 102.4 });
  assert.equal(dip.trend, "up, pausing");
  assert.ok(dip.m1Pct < 0);
  // a zigzag higher has higher highs and higher lows
  const zig = [];
  for (let i = 0; i < 60; i += 1) zig.push(100 + i * 0.03 + (i % 10 < 5 ? (i % 10) * 0.08 : (10 - (i % 10)) * 0.08));
  const zigBars = zig.map((c, i) => ({ t: at1(i), o: c, h: c + 0.05, l: c - 0.05, c, v: 1000 }));
  const z = fastRead(zigBars);
  assert.equal(z.structure, "higher highs and higher lows");
  assert.ok(z.swingLow < z.swingHigh, "the last swing low and high are reported for the chart");
  assert.equal(fastRead(zigBars.map((b) => ({ ...b, h: 200 - b.l, l: 200 - b.h, c: 200 - b.c, o: 200 - b.o }))).structure, "lower highs and lower lows");
  // volume in the last five minutes against the session average
  const busy = fastRead(minuteBars(ramp(100, 0.01, 40), (i) => (i >= 35 ? 5000 : 1000)));
  assert.ok(busy.volumeSurge > 3);
  // too little to read, and early in the session
  assert.equal(fastRead(minuteBars([100, 100.1, 100.2])).available, false);
  const early = fastRead(minuteBars(ramp(100, 0.05, 12)));
  assert.equal(early.trend, "warming up");
  assert.equal(early.rsi, null);
});

test("the order book joins the early warnings when it tilts hard against a trade", () => {
  const bars = tape(ramp(100, 0.15, 16));
  const against = call(bars, 102.4, "10:32", { micro: { d60: 0.05, flow: { pressure: -64, label: "Sellers pressing" } } });
  assert.equal(against.state, "long");
  assert.deepEqual(ids(against), ["book-down"]);
  assert.equal(against.weakening, true);
  assert.match(against.early[0].text, /tilted to sellers \(pressure -64\)/);
  const withIt = call(bars, 102.4, "10:32", { micro: { d60: 0.05, flow: { pressure: 64, label: "Buyers pressing" } } });
  assert.deepEqual(ids(withIt), ["book-up"]);
  assert.equal(withIt.weakening, false, "buyers pressing is no threat to a long");
  assert.deepEqual(withIt.tapeSpeed, { last30s: null, last60s: 0.05, last3min: null });
  assert.deepEqual(ids(call(bars, 102.4, "10:32", { micro: { d60: 0.05, flow: { pressure: 20 } } })), []);
});

test("the 1-minute tape warns only when its averages, its structure and the last five minutes all agree", () => {
  const bars = tape(ramp(100, 0.15, 16));
  const down = { available: true, trend: "down", structure: "lower highs and lower lows", m5Pct: -0.42, rsi: 31 };
  const c = call(bars, 102.4, "10:32", { fast: down });
  assert.equal(c.state, "long");
  assert.deepEqual(ids(c), ["fast-down"]);
  assert.equal(c.weakening, true);
  assert.match(c.early[0].text, /1-minute tape has turned down: lower highs and lower lows, -0\.42% in five minutes/);
  assert.equal(c.fast.trend, "down", "the read itself rides along with the call");
  // two out of three is not a turn
  assert.deepEqual(ids(call(bars, 102.4, "10:32", { fast: { ...down, trend: "down, pausing" } })), []);
  assert.deepEqual(ids(call(bars, 102.4, "10:32", { fast: { ...down, structure: "no clear structure" } })), []);
  assert.deepEqual(ids(call(bars, 102.4, "10:32", { fast: { ...down, m5Pct: 0.1 } })), []);
  // a turn in the trade's favour is listed, but it is no threat
  const up = call(bars, 102.4, "10:32", { fast: { available: true, trend: "up", structure: "higher lows", m5Pct: 0.3 } });
  assert.deepEqual(ids(up), ["fast-up"]);
  assert.equal(up.weakening, false);
  assert.equal(call(bars, 102.4, "10:32", { fast: { available: false, reason: "too few bars" } }).fast, null);
  assert.equal(call(bars, 102.4, "10:32").fast, null);
});

test("a 1-minute tape going nowhere is flat, not a trend", () => {
  const flat = fastRead(minuteBars(Array.from({ length: 40 }, () => 100)));
  assert.equal(flat.trend, "flat");
  assert.equal(flat.m5Pct, 0);
});
