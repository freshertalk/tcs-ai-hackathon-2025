"use strict";
// Volatility from several days of history: the HAR model beats "the usual" and "same as yesterday" where volatility
// persists, the intraday pattern is found, today's bars update the day's forecast, and the multi-day band in the refiner
// takes over only when it is as honest and narrower.

const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../market/volmodel");
const R = require("../market/refine");

let seed = 21;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const U = (s) => 1 + 2 * Math.exp(-s / 5) + Math.exp(-(74 - s) / 5); // a U-shaped day: busy open, busier close than midday
const dateOf = (i) => new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10);

/** A stock whose daily volatility persists (log-volatility AR(1)), with the intraday U-shape; 5-minute bars { s, o, c }. */
function stock(days = 160) {
  let lv = 0;
  const out = [];
  let c = 100;
  for (let d = 0; d < days; d += 1) {
    lv = 0.85 * lv + 0.35 * gauss();
    const bars = [];
    for (let s = 0; s < 75; s += 1) {
      const o = c;
      c = o * Math.exp(0.002 * Math.exp(lv) * Math.sqrt(U(s)) * gauss());
      bars.push({ s, o, c });
    }
    out.push([dateOf(d), bars, lv]);
  }
  return out;
}

test("HAR on several days: it beats 'the usual' and 'same as yesterday' on unseen sessions, and finds the busy open", () => {
  const per = {};
  const truth = {};
  for (let i = 0; i < 12; i += 1) {
    const st = stock();
    per[`S${i}`] = st.map(([d, b]) => [d, b]);
    truth[`S${i}`] = st[st.length - 1][2];
  }
  const m = V.fitVolModel(per);
  assert.ok(m && m.stocks === 12 && m.judge.n > 200, JSON.stringify(m && m.judge));
  assert.ok(m.judge.har < m.judge.usual * 0.9, `HAR ${m.judge.har} against the usual ${m.judge.usual}`);
  assert.ok(m.judge.har < m.judge.yesterday, `HAR ${m.judge.har} against yesterday ${m.judge.yesterday}`);
  assert.ok(m.judge.skill > 0.1);
  assert.ok(m.coef[1] + m.coef[2] + m.coef[3] > 0.4, "volatility persists: the past days' weights add up");
  assert.ok(m.season[0] > 2 && m.season[37] < 0.9 && m.season[74] > 1.3, `the intraday pattern: open ${m.season[0]}, midday ${m.season[37]}, close ${m.season[74]}`);
  // a stock ending in a wild stretch is forecast wilder than one ending calm
  const syms = Object.keys(truth).sort((a, b) => truth[a] - truth[b]);
  assert.ok(m.forecasts[syms[syms.length - 1]].ratio > m.forecasts[syms[0]].ratio, "the wildest-ending stock is forecast wilder");
  // it can be fitted from summaries too (the service never holds every bar at once), with the same result
  const m2 = V.fitVolModel(Object.fromEntries(Object.entries(per).map(([k, d]) => [k, V.summarizeStock(d)])));
  assert.deepEqual(m2.coef, m.coef);
  assert.equal(V.fitVolModel({ A: per.S0 }), null, "too few stocks");
});

test("during the session: the history's forecast is the prior, today's bars take over; the coming slots' share sets the scale", () => {
  const season = Array.from({ length: 75 }, (_, s) => U(s));
  const mean = season.reduce((a, b) => a + b, 0) / 75;
  const S = season.map((v) => v / mean);
  const sigmaPct = 0.2;
  const none = V.scaleFor({ prior: 2, season: S, bars: [], sigmaPct, slot: 30, h: 3 });
  assert.equal(none.day, 2, "no bars yet: the history speaks");
  // forty calm bars (exactly the usual size for each slot): the day's level comes down towards 1
  let c = 100;
  const calm = [];
  for (let s = 0; s < 40; s += 1) {
    const o = c;
    c = o * Math.exp((sigmaPct / 100) * Math.sqrt(S[s]) * (s % 2 ? 1 : -1));
    calm.push({ s, o, c });
  }
  const later = V.scaleFor({ prior: 2, season: S, bars: calm, sigmaPct, slot: 39, h: 3 });
  assert.ok(later.day < 1.3 && later.day > 0.95, `today's calm bars outweigh the prior: ${later.day}`);
  const open = V.scaleFor({ prior: 1, season: S, bars: [], sigmaPct, slot: 0, h: 1 });
  const mid = V.scaleFor({ prior: 1, season: S, bars: [], sigmaPct, slot: 36, h: 1 });
  assert.ok(open.scale > mid.scale * 1.3, "the bars just after the open are expected to move more than midday's");
  assert.equal(V.scaleFor({ prior: 1, sigmaPct: 0, slot: 1, h: 1 }), null);
  // the history's forecast is used only for the session after the one it was made from
  const model = { forecasts: { SBIN: { ratio: 1.5, after: "2026-11-20" } } };
  assert.equal(V.priorFor(model, "SBIN", "2026-11-23"), 1.5);
  assert.equal(V.priorFor(model, "SBIN", "2026-11-20"), null, "not for the day it was made from");
  assert.equal(V.priorFor(model, "SBIN", "2026-12-05"), null, "too old");
  assert.equal(V.priorFor(model, "TCS", "2026-11-23"), null);
});

test("the refiner's multi-day band: when its scale really tracks the misses it holds 70% with a better interval score than the today-only band, and leads", () => {
  const m = R.emptyModel();
  const dates = ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-16", "2026-11-17"];
  const ho = 1.0364;
  for (const date of dates) {
    for (let k = 0; k < 150; k += 1) {
      const vol = Math.exp(0.6 * gauss()); // each forecast's true volatility
      const scale2 = vol * Math.exp(0.1 * gauss()); // the multi-day estimate: close to the truth
      const scale = 1; // the today-only estimate here knows nothing
      const x = [1, 0, 0, 0, 0];
      const f = R.forecastOf(m, 3, { x, zl: 0, ho, scale, scale2, date });
      R.learn(m, 3, { x, zl: 0, zr: f.zr, zs: f.zShown, scale, hc: f.halfConformal, ho, scale2, hc2: f.halfMulti }, gauss() * vol, { date });
    }
  }
  const s = R.summaryOf(m.h[3]);
  assert.ok(Math.abs(s.band2.coverage - 0.7) < 0.05, `multi-day coverage ${s.band2.coverage}`);
  assert.ok(Math.abs(s.band.coverage - 0.7) < 0.05, `today-only coverage ${s.band.coverage}`);
  assert.ok(s.band2.score < s.band.score * 0.98, `a better interval score (narrow where calm, wide where wild): ${s.band2.score} against ${s.band.score}`);
  assert.equal(s.bandBy, "multi");
  const f = R.forecastOf(m, 3, { x: [1, 0, 0, 0, 0], zl: 0, ho, scale: 1, scale2: 0.5, date: dates[5] });
  assert.equal(f.leads.bandBy, "multi");
  assert.equal(f.half, f.halfMulti, "a calm stock now gets the narrow band the multi-day forecast earns");
  // a model saved before the multi-day band still loads and works
  const old = R.emptyModel();
  delete old.h[1].conf2;
  assert.equal(R.forecastOf(old, 1, { x: [1, 0, 0, 0, 0], zl: 0.2, ho: 1, scale2: 1.2 }).halfMulti, null);
});
