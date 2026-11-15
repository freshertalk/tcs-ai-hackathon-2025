"use strict";
// The option chain, read (server/market/options.js): implied volatility, PCR, max pain, the OI walls,
// fresh writing, build-up and the bias — on SYNTHETIC chains (no network, no clock).

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildOptionChain, impliedVol, black76, buildup } = require("../market/options");
const { buildIntradayPlan } = require("../market/intraplan");

const NOW = Date.parse("2026-11-16T19:00:00+05:30");
const EXP = "2026-11-25";
const T = (Date.parse(`${EXP}T15:30:00+05:30`) - NOW) / (365 * 86400000);

/** A chain priced at one volatility, with OI from the caller: strikes 900…1100 step 10, spot 1000. */
function chain({ ceOi, peOi, cePrev = null, pePrev = null, vol = 0.25, spot = 1000 }) {
  const rows = [];
  for (let k = 900; k <= 1100; k += 10) {
    const c = black76("CE", spot, k, T, vol).price;
    const p = black76("PE", spot, k, T, vol).price;
    rows.push({
      strike: k,
      ce: { last: Math.round(c * 20) / 20, prevClose: c, oi: ceOi(k), volume: 1000, prevOi: cePrev ? cePrev(k) : null },
      pe: { last: Math.round(p * 20) / 20, prevClose: p, oi: peOi(k), volume: 1200, prevOi: pePrev ? pePrev(k) : null },
    });
  }
  return rows;
}

test("implied volatility: Black-76 prices are read back to their volatility; impossible prices give none", () => {
  for (const [type, K, v] of [["CE", 1000, 0.25], ["PE", 950, 0.4], ["CE", 1080, 0.18]]) {
    const price = black76(type, 1000, K, T, v).price;
    assert.ok(Math.abs(impliedVol(type, price, 1000, K, T) - v) < 0.002, `${type} ${K}`);
  }
  assert.equal(impliedVol("CE", 0.01, 1000, 900, T), null, "below intrinsic value");
  assert.ok(black76("CE", 1000, 1000, T, 0.25).delta > 0.45 && black76("PE", 1000, 1000, T, 0.25).delta < -0.45);
  assert.equal(buildup(1, 5), "long build-up");
  assert.equal(buildup(-1, 5), "short build-up");
  assert.equal(buildup(1, -5), "short covering");
  assert.equal(buildup(-1, -5), "long unwinding");
});

test("PCR, max pain and the OI walls", () => {
  // calls pile up at 1050, puts at 950: resistance 1050, support 950
  const rows = chain({ ceOi: (k) => (k === 1050 ? 90000 : k > 1000 ? 30000 : 8000), peOi: (k) => (k === 950 ? 120000 : k < 1000 ? 30000 : 8000) });
  const c = buildOptionChain({ spot: 1000, expiry: EXP, now: NOW, rows, lot: 750 });
  assert.equal(c.available, true);
  assert.equal(c.atm, 1000);
  assert.equal(c.resistance.strike, 1050);
  assert.equal(c.support.strike, 950);
  assert.ok(c.pcr > 1, "more put OI than call OI");
  assert.ok(c.maxPain >= 950 && c.maxPain <= 1050, `max pain ${c.maxPain} between the walls`);
  assert.ok(Math.abs(c.atmIv - 25) < 1.5, `ATM IV ${c.atmIv}`);
  assert.ok(c.straddle > 0 && c.expectedMove.low < 1000 && c.expectedMove.high > 1000);
  assert.ok(c.expectedMove.day > 0 && c.expectedMove.day < c.straddle);
  assert.equal(c.oiChangeSince, null);
  assert.ok(c.bias.cautions.some((x) => /No earlier reading/.test(x)), "without an earlier reading, OI changes are not claimed");
});

test("the bias: heavy put writing, a high PCR and futures long build-up read bullish; the mirror reads bearish", () => {
  const flat = () => 20000;
  const bull = buildOptionChain({
    spot: 1000,
    future: { last: 1004, prevClose: 990, oi: 52000, prevOi: 40000 },
    expiry: EXP,
    now: NOW,
    rows: chain({ ceOi: flat, peOi: (k) => (k <= 1000 ? 40000 : 20000), cePrev: flat, pePrev: (k) => (k <= 1000 ? 22000 : 20000) }),
  });
  assert.equal(bull.future.buildup, "long build-up");
  assert.ok(bull.freshWriting.pe > bull.freshWriting.ce);
  assert.ok(bull.bias.score >= 25, `score ${bull.bias.score}`);
  assert.equal(bull.bias.label, "Bullish");
  const bear = buildOptionChain({
    spot: 1000,
    future: { last: 996, prevClose: 1010, oi: 52000, prevOi: 40000 },
    expiry: EXP,
    now: NOW,
    rows: chain({ ceOi: (k) => (k >= 1000 ? 40000 : 20000), peOi: flat, cePrev: (k) => (k >= 1000 ? 22000 : 20000), pePrev: flat }),
  });
  assert.equal(bear.future.buildup, "short build-up");
  assert.ok(bear.bias.score <= -25, `score ${bear.bias.score}`);
  assert.ok(bear.bias.votes.length >= 3 && bear.bias.votes.every((v) => v.why));
});

test("in the intraday plan, options are one more factor: reasons, a strength nudge and the walls on the ladder", () => {
  // a steady riser of 230 sessions, enough for the plan
  const daily = [];
  let c = 900;
  for (let i = 0; i < 230; i += 1) {
    const d = new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10);
    const o = c;
    c = c * (1 + (i % 5 < 3 ? 0.006 : -0.003));
    daily.push({ t: d, o, h: Math.max(o, c) * 1.004, l: Math.min(o, c) * 0.996, c, v: 1e6 });
  }
  const last = daily[daily.length - 1].c;
  const opts = buildOptionChain({
    spot: last,
    future: { last: last * 1.002, prevClose: last * 0.99, oi: 52000, prevOi: 40000 },
    expiry: EXP,
    now: NOW,
    rows: chain({ spot: last, ceOi: () => 20000, peOi: () => 40000, cePrev: () => 20000, pePrev: () => 22000 }).map((r) => ({ ...r, strike: Math.round((r.strike / 1000) * last) })),
  });
  const base = buildIntradayPlan({ daily });
  const withOpt = buildIntradayPlan({ daily, options: opts });
  assert.ok(withOpt.options && withOpt.options.label);
  const all = [...withOpt.decision.for, ...withOpt.decision.against];
  assert.ok(all.some((x) => /^Options:/.test(x)), "the options reading is given as a reason");
  if (base.decision.kind === "long") assert.ok(withOpt.decision.strength >= base.decision.strength, "a bullish chain does not weaken a long plan");
  assert.ok(withOpt.ladder.some((l) => /wall|Max pain/.test(l.label)));
});
