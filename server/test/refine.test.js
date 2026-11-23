"use strict";
// The refiner: the top of the book, today's volatility, the residual model, the conformal band and the off-form alarm —
// each one changing nothing until its own checked record proves it.

const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../market/refine");

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const DATES = ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-16", "2026-11-17", "2026-11-18"];

test("today's volatility: an ordinary session reads about 1, a wild one well above, too few bars nothing", () => {
  const sigma = 0.2; // the usual 5-minute move, in percent
  const walk = (k) => {
    let c = 100;
    return Array.from({ length: 40 }, () => {
      const o = c;
      c = c * (1 + (gauss() * sigma * k) / 100);
      return { o, c };
    });
  };
  const calm = R.volRatio(walk(1), sigma);
  const wild = R.volRatio(walk(2.5), sigma);
  assert.ok(calm > 0.4 && calm < 2, `ordinary: ${calm}`);
  assert.ok(wild > 3, `wild: ${wild}`);
  assert.equal(R.volRatio(walk(1).slice(0, 2), sigma), null);
  assert.equal(R.scaleOf(null), 1);
  assert.equal(R.scaleOf(100), 2.5, "bounded");
});

test("the top of the book: the microprice leans towards the thin side, the queue imbalance says which side is heavy", () => {
  const i = R.inputsOf({ q: { bid: 100, ask: 100.1, bidQty: 9000, askQty: 1000 }, price: 100.05, s: 0.2, zl: 0.5, ratio: 1 });
  assert.equal(i.top.microprice, 100.09, "a heavy bid queue pulls the fair price towards the offer");
  assert.ok(i.x[1] > 0, "micro leans up");
  assert.equal(i.x[2], 0.8, "the queue imbalance");
  assert.ok(i.x[3] > 0, "the spread times the call");
  assert.equal(i.x[4], 0, "an ordinary session leaves the call alone");
  const none = R.inputsOf({ q: { buyQty: 5, sellQty: 5 }, price: 100, s: 0.2, zl: 0.5, ratio: null });
  assert.deepEqual(none.x, [1, 0, 0, 0, 0, 0, 0], "no top of the book: nothing added");
  assert.equal(none.top, null);
  assert.equal(R.inputsOf({ q: null, price: 0, s: 0.2, zl: 0 }), null);
});

test("with no record the refiner changes nothing: the consensus's centre and band stand", () => {
  const m = R.emptyModel();
  const f = R.forecastOf(m, 3, { x: [1, 0.5, 0.8, 0.1, 0.2], zl: 0.4, ho: 1.1, scale: 1.3, date: DATES[0] });
  assert.equal(f.zShown, 0.4);
  assert.equal(f.half, 1.1);
  assert.equal(f.halfConformal, null, "too few misses for a conformal band");
  assert.deepEqual(f.leads, { mean: false, band: false, bandBy: null });
  assert.equal(f.offForm, false);
  assert.equal(R.forecastOf(m, 3, { x: [1, 2], zl: 0.4 }), null);
});

test("the residual model learns what the microprice adds, and leads only once it misses less over enough sessions", () => {
  const m = R.emptyModel();
  let i = 0;
  for (const date of DATES) {
    for (let k = 0; k < 200; k += 1) {
      i += 1;
      const micro = gauss() * 0.6;
      const zl = gauss() * 0.4;
      const x = [1, R.inputsOf({ q: null, price: 1, s: 1, zl }).x[1] + micro, 0, 0, 0];
      const y = zl + 0.7 * micro + gauss() * 0.4; // the microprice really predicts what the forecast missed
      const f = R.forecastOf(m, 3, { x, zl, ho: 1, date });
      R.learn(m, 3, { x, zl, zr: f.zr, zs: f.zShown, scale: 1, hc: f.halfConformal, ho: 1 }, y, { date });
    }
  }
  const s = R.summaryOf(m.h[3], DATES[DATES.length - 1]);
  assert.equal(s.checks, i);
  assert.equal(s.mean.proven, true, JSON.stringify(s.mean));
  assert.ok(s.weights.micro > 0.5 && s.weights.micro < 0.8, `micro weight ${s.weights.micro} (shrunk a little towards zero)`);
  assert.ok(s.mean.missRefined < s.mean.missLead * 0.9);
  const f = R.forecastOf(m, 3, { x: [1, 1, 0, 0, 0], zl: 0, ho: 1, date: DATES[6] });
  assert.equal(f.leads.mean, true);
  assert.ok(f.zShown > 0.5, "a microprice leaning up moves the centre up");
  assert.ok(f.pUp > 0.6);
  // and noise is NOT promoted: a refiner that learns from inputs unrelated to the miss stays in trial
  const n = R.emptyModel();
  for (const date of DATES) {
    for (let k = 0; k < 60; k += 1) {
      const x = [1, gauss() * 0.6, rnd() * 2 - 1, 0, 0];
      const zl = gauss() * 0.4;
      const f2 = R.forecastOf(n, 3, { x, zl, ho: 1, date });
      R.learn(n, 3, { x, zl, zr: f2.zr, zs: f2.zShown, scale: 1, hc: f2.halfConformal, ho: 1 }, zl + gauss() * 0.5, { date });
    }
  }
  assert.equal(R.summaryOf(n.h[3]).mean.proven, false, "noise does not lead");
});

test("the conformal band holds its stated 70% where the old band (too narrow) does not, and then leads", () => {
  const m = R.emptyModel();
  const ho = 1.0364; // the old band assumes misses of one usual move; the real misses are 1.6 wide
  for (const date of DATES) {
    for (let k = 0; k < 120; k += 1) {
      const zl = gauss() * 0.3;
      const x = [1, 0, 0, 0, 0];
      const f = R.forecastOf(m, 1, { x, zl, ho, scale: 1, date });
      R.learn(m, 1, { x, zl, zr: f.zr, zs: f.zShown, scale: 1, hc: f.halfConformal, ho }, zl + gauss() * 1.6, { date });
    }
  }
  const s = R.summaryOf(m.h[1]).band;
  assert.ok(s.checks > 600);
  assert.ok(Math.abs(s.coverage - 0.7) < 0.04, `conformal coverage ${s.coverage}`);
  assert.ok(s.oldCoverage < 0.55, `old coverage ${s.oldCoverage}`);
  assert.equal(s.proven, true);
  const f = R.forecastOf(m, 1, { x: [1, 0, 0, 0, 0], zl: 0, ho, scale: 1, date: DATES[6] });
  assert.equal(f.leads.band, true);
  assert.ok(f.half > 1.4 && f.half < 2.1, `the band widened to the real misses: ${f.half}`);
  // the misses are measured against the day's volatility: a wild session's band is wider
  const wild = R.forecastOf(m, 1, { x: [1, 0, 0, 0, 0], zl: 0, ho, scale: 2, date: DATES[6] });
  assert.ok(wild.half > f.half * 1.8);
  assert.equal(R.conformalQuantile([3, 1, 2, 5, 4], 0.5), 3);
});

test("the off-form alarm: a session of clearly bigger misses sounds it (after enough checks); the next session starts clean", () => {
  const m = R.emptyModel();
  const x = [1, 0, 0, 0, 0];
  for (const date of DATES.slice(0, 5)) for (let k = 0; k < 150; k += 1) R.learn(m, 3, { x, zl: 0, zs: 0, scale: 1, hc: null, ho: 1 }, gauss() * 1, { date });
  assert.equal(R.offFormOf(m.h[3], DATES[4]), false, "ordinary sessions: no alarm");
  const bad = DATES[5];
  for (let k = 0; k < 10; k += 1) R.learn(m, 3, { x, zl: 0, zs: 0, scale: 1, hc: null, ho: 1 }, gauss() * 3, { date: bad });
  assert.equal(R.offFormOf(m.h[3], bad), false, "not on a handful of checks");
  for (let k = 0; k < 120; k += 1) R.learn(m, 3, { x, zl: 0, zs: 0, scale: 1, hc: null, ho: 1 }, gauss() * 3, { date: bad });
  assert.equal(R.offFormOf(m.h[3], bad), true, "three times the usual misses all session");
  const f = R.forecastOf(m, 3, { x, zl: 1, ho: 1, date: bad });
  assert.equal(f.offForm, true);
  assert.ok(R.summaryOf(m.h[3], bad).today.missAvg > R.summaryOf(m.h[3], bad).today.usual * 1.5);
  R.learn(m, 3, { x, zl: 0, zs: 0, scale: 1, hc: null, ho: 1 }, 0.5, { date: DATES[6] });
  assert.equal(R.offFormOf(m.h[3], DATES[6]), false, "a new session starts clean");
});
