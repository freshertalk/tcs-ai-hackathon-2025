"use strict";
// Order flow: the book in numbers, signed trade flow, and the small model's honest scorecard.

const test = require("node:test");
const assert = require("node:assert/strict");

const { FlowEngine, bookStats } = require("../market/flow");

const T0 = Date.parse("2026-11-12T10:30:00+05:30");
const level = (p, q, n = 10) => [p, q, n];
const book = (bidQtys, askQtys, bid = 100, extra = {}) => ({
  last: bid + 0.05,
  bid,
  ask: bid + 0.05,
  depth: { b: bidQtys.map((q, i) => level(bid - i * 0.05, q)), a: askQtys.map((q, i) => level(bid + 0.05 + i * 0.05, q)) },
  ...extra,
});

test("the book in numbers: spread, weighted imbalance, micro price, order size", () => {
  const s = bookStats(book([500, 400, 300, 200, 100], [100, 100, 100, 100, 100], 100, { buyQty: 30000, sellQty: 10000 }));
  assert.equal(s.bid, 100);
  assert.equal(s.ask, 100.05);
  assert.ok(Math.abs(s.spread - 0.05) < 1e-9);
  assert.equal(s.spreadTicks, 1);
  assert.equal(s.bidQty, 1500);
  assert.equal(s.askQty, 500);
  // weighted: bids 500+320+180+80+20 = 1100, asks 100+80+60+40+20 = 300 → (1100−300)/1400
  assert.ok(Math.abs(s.imbalance - 800 / 1400) < 1e-9);
  assert.equal(s.imbalanceTotal, 0.5, "from the exchange's totals for the whole book");
  // 500 bid against 100 offered at the touch: the offer gives way first, so the micro price sits near the ask
  assert.ok(s.micro > s.mid);
  assert.ok(Math.abs(s.microEdge - (500 - 100) / 600) < 1e-9);
  assert.equal(s.avgBid, 30);
  assert.equal(s.avgAsk, 10);
  assert.equal(s.sizeSkew, 0.5, "bids are three times the size of offers on average");
  assert.equal(s.oneSided, null);
});

test("a wall is one level far bigger than its neighbours; an empty side is said plainly", () => {
  const s = bookStats(book([100, 100, 5000, 100, 100], [100, 100, 100, 100, 100]));
  assert.deepEqual(s.wall, { side: "bid", price: 99.9, qty: 5000, times: 50 });
  assert.equal(bookStats(book([100, 110, 120, 90, 100], [100, 100, 100, 100, 100])).wall, null);
  // locked at the upper circuit: bids only
  const locked = bookStats({ last: 110, depth: { b: [level(110, 90000)], a: [] } });
  assert.equal(locked.oneSided, "no sellers");
  assert.equal(locked.imbalance, 1);
  assert.equal(locked.spread, null);
  assert.equal(bookStats({ last: 100 }), null, "no depth, no reading");
  assert.equal(bookStats({ last: 100, depth: { b: [], a: [] } }), null);
});

test("trade flow: volume that trades at the offer is buying, at the bid is selling", () => {
  const f = new FlowEngine();
  const flat = [100, 100, 100, 100, 100];
  f.update(1, book(flat, flat, 100, { volume: 1000 }), T0);
  // 400 shares at 100.05 — the offer
  let s = f.update(1, { ...book(flat, flat, 100, { volume: 1400 }), last: 100.05 }, T0 + 1000);
  assert.equal(s.delta30, 400);
  // 300 at 100.00 — the bid
  s = f.update(1, { ...book(flat, flat, 100, { volume: 1700 }), last: 100 }, T0 + 2000);
  assert.equal(s.delta30, 100);
  assert.equal(s.volume60, 700);
  assert.equal(s.deltaRatio60Pct, 14);
  // no new volume: nothing is added
  s = f.update(1, { ...book(flat, flat, 100, { volume: 1700 }), last: 100 }, T0 + 3000);
  assert.equal(s.delta30, 100);
  // forty seconds on, the 30-second window is empty but the minute still holds them
  s = f.update(1, { ...book(flat, flat, 100, { volume: 1700 }), last: 100 }, T0 + 42000);
  assert.equal(s.delta30, 0);
  assert.equal(s.delta60, 100);
});

test("pressure combines the book and the trades, and is bounded", () => {
  const f = new FlowEngine();
  const heavy = [900, 800, 700, 600, 500];
  const light = [50, 50, 50, 50, 50];
  const buy = f.update(1, book(heavy, light, 100, { volume: 1, buyQty: 50000, sellQty: 5000 }), T0);
  assert.ok(buy.pressure >= 50, String(buy.pressure));
  assert.equal(buy.label, "Buyers pressing");
  assert.ok(buy.imbalancePct > 80);
  const g = new FlowEngine();
  const sell = g.update(2, book(light, heavy, 100, { volume: 1, buyQty: 5000, sellQty: 50000 }), T0);
  assert.ok(sell.pressure <= -50);
  assert.equal(sell.label, "Sellers pressing");
  const h = new FlowEngine();
  const even = h.update(3, book([100, 100, 100], [100, 100, 100], 100, { volume: 1 }), T0);
  assert.equal(even.pressure, 0);
  assert.equal(even.label, "Balanced");
  assert.equal(h.update(3, { last: 100, volume: 2 }, T0 + 1000).available, false, "a tick without depth gives no reading");
});

/** Drive an engine with a tape whose book either does, or does not, foretell the next move. */
function run(engine, { seconds, informative, seed = 5, regime = 20 }) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648), s / 2147483648);
  let price = 500;
  let bias = 1; // which side the book favours for the next stretch
  let snap;
  for (let i = 0; i < seconds; i += 1) {
    if (i % regime === 0) bias = rnd() < 0.5 ? 1 : -1;
    // when the book is informative, price drifts the way the book leans; otherwise it wanders on its own
    const drift = informative ? bias : rnd() < 0.5 ? 1 : -1;
    if (i % 4 === 0) price = Math.round((price + drift * 0.05) * 20) / 20;
    const big = [900, 800, 700, 600, 500].map((q) => q + Math.floor(rnd() * 100));
    const small = [150, 150, 150, 150, 150].map((q) => q + Math.floor(rnd() * 100));
    const tick = book(bias > 0 ? big : small, bias > 0 ? small : big, price, { volume: 1000 + i * 10 });
    snap = engine.update(7, tick, T0 + i * 1000);
  }
  return snap;
}

test("the lean: while learning it says so; on an informative tape it finds the pattern and scores well", () => {
  const f = new FlowEngine({ minTrain: 40 });
  const early = run(f, { seconds: 45, informative: true });
  assert.equal(early.lean.dir, "learning");
  assert.equal(early.lean.trained, false);
  assert.equal(early.lean.calls, 0, "nothing is called before the model has learned anything");

  const g = new FlowEngine({ minTrain: 40 });
  // the book favours one side for a few minutes at a time, and price follows it
  const done = run(g, { seconds: 1800, informative: true, regime: 180 });
  assert.equal(done.lean.trained, true);
  assert.ok(done.lean.calls > 100, String(done.lean.calls));
  assert.ok(done.lean.hitRatePct >= 65, `hit rate ${done.lean.hitRatePct}%`);
  assert.equal(done.lean.reliable, true);
  assert.ok(["up", "down"].includes(done.lean.dir));
  assert.equal(done.lean.horizonSec, 30);
});

test("the lean: on a tape where the book foretells nothing, it scores like a coin and is marked unreliable", () => {
  const f = new FlowEngine({ minTrain: 40 });
  const done = run(f, { seconds: 1500, informative: false, seed: 11 });
  assert.equal(done.lean.trained, true);
  if (done.lean.calls >= 40) {
    assert.ok(done.lean.hitRatePct <= 60, `no edge exists, yet it claims ${done.lean.hitRatePct}%`);
  }
  // either it rarely commits, or its recent record is too poor to be called reliable
  assert.ok(done.lean.reliable === false || done.lean.recentRatePct < 62, JSON.stringify(done.lean));
});

test("scoring is out of sample: a prediction is judged with the weights it was made with", () => {
  const f = new FlowEngine({ minTrain: 1, horizonMs: 2000, sampleMs: 1000 });
  const up = [900, 800, 700, 600, 500];
  const dn = [100, 100, 100, 100, 100];
  // t0: a prediction is recorded with untrained weights → 50%, so it is NOT counted as a call
  f.update(1, book(up, dn, 100, { volume: 1 }), T0);
  f.update(1, book(up, dn, 100.1, { volume: 2 }), T0 + 1000);
  const s = f.update(1, book(up, dn, 100.2, { volume: 3 }), T0 + 2000);
  assert.equal(s.lean.samples, 1, "the first example has matured and been learned from");
  assert.equal(s.lean.calls, 0, "but it was made at 50% before any learning, so it was never a call");
  assert.ok(s.lean.upPct > 50, "having seen the book lead price up once, the next reading leans up");
});

test("a new day starts a new model", () => {
  const f = new FlowEngine({ minTrain: 40 });
  run(f, { seconds: 300, informative: true });
  assert.ok(f.snapshot(7).lean.samples > 0);
  const flat = [100, 100, 100, 100, 100];
  const next = f.update(7, book(flat, flat, 500, { volume: 1 }), T0 + 86400000);
  assert.equal(next.lean.samples, 0);
  assert.equal(next.delta300, 0);
  f.reset(7);
  assert.equal(f.snapshot(7), null);
});
