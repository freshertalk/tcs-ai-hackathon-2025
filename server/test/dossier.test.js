"use strict";
// The research dossier: every reading on one stock in one read; what could not be read is listed, never guessed.

const test = require("node:test");
const assert = require("node:assert/strict");
const { dossier, ladder } = require("../dossier");

const market = {
  async quotes(list) {
    return { quotes: Object.fromEntries(list.map((s) => [s, { last: 806, prevClose: 800, changePct: 0.75, open: 801, high: 809, low: 799, avgPrice: 803.2, volume: 1200000, buyQty: 300000, sellQty: 200000 }])) };
  },
  async verdict() {
    return { available: true, stance: "Bullish", conviction: 62, summary: "Up on the day.", frames: [{ name: "Daily", label: "Up" }], day: { available: true, state: "long", headline: "LONG", score: 55, movement: { vwap: 803.2, vsVwapPct: 0.35, rsi5: 61 } } };
  },
  async analysis() {
    return { enoughData: true, score: { value: 48, label: "Bullish" }, indicators: { rsi14: 63, adx: 24 }, patterns: [], setups: [], levels: { week52: { high: 860, low: 600 } } };
  },
  async context() {
    return { available: true, tide: { score: 30, label: "Rising", summary: "Rising tide" }, vix: 13.2, sectors: [{ name: "Banks", changePct: 0.8 }] };
  },
  behaviourList: () => ({ profiles: { SBIN: { habits: ["Fades after 2:30 PM"] } } }),
};
const consensus = { async view() { return { available: true, headline: "SBIN in 14 min", horizons: [{ key: "15", minutesAhead: 14, at: "t", price: 808.5, low: 805, high: 812, pct: 0.3, pUp: 0.64, lean: "up", tier: "clear", leads: "forecaster", forecaster: {}, blend: {}, parts: { evidence: null, early: null }, record: { checks: 0 } }], firstUp: { name: "Day high", price: 809 }, firstDown: null, rule: "r" }; } };
const evidence = {
  async view(s, { full }) {
    assert.equal(full, true, "one stock, read in full: BSE, the option chain and the overseas indices too");
    return { available: true, calls: [{ minutes: 15, lean: "up", pUp: 0.6 }], first: null, regime: { name: "trend" }, count: { up: 5, down: 2 }, witnesses: [{ id: "orb", name: "Opening range break", state: 1, record: { 15: { verdict: "works", right: 0.58, n: 900 } } }, { id: "quiet", name: "Quiet one", state: 0, record: {} }], live: [{ id: "gift", name: "GIFT NIFTY", state: 1, value: "+0.4%", record: { 15: { verdict: "thin" } } }], book: { nse: { bids: [{ price: 805.9, qty: 1200, orders: 9 }], asks: [{ price: 806.1, qty: 800, orders: 5 }], bidQty: 9000, askQty: 6000, buyTotal: 300000, sellTotal: 200000, spreadPct: 0.02, imbalance: 0.2, wall: null }, bse: null }, volume: { today: 1200000 }, indicators: { rsi5: 61 }, levels: [] };
  },
};
const delivery = { forSymbol: () => ({ available: true, asOf: "2026-11-18", last: { delivPct: 64 }, avgDelivPct: 48.5, reading: { word: "accumulation" } }) };

test("every reading on one stock, in one read", async () => {
  const d = await dossier("SBIN", { market, consensus, evidence, delivery, horizon: { async view() { return { available: true, headline: { price: 808 }, horizons: [{ minutes: 15, price: 808, low: 805, high: 811, pUp: 0.62 }], live: { n: 400 } }; } }, ahead: { async view() { return { available: true, move: { dir: "up", on: true }, horizons: [{ key: "15", read: "intact", tone: "up", momentum: { state: "steady" } }] }; } }, now: () => Date.parse("2026-11-19T05:00:00Z") });
  assert.equal(d.quote.buyShare, 60);
  assert.equal(d.consensus.horizons[0].price, 808.5);
  assert.equal(d.forecaster.path[0].price, 808);
  assert.deepEqual(d.evidence.techniques, [{ name: "Opening range break", says: "up", record15: { verdict: "works", right: 0.58, n: 900 } }]);
  assert.deepEqual(d.evidence.bookNse, { bids: [{ price: 805.9, qty: 1200, orders: 9 }], offers: [{ price: 806.1, qty: 800, orders: 5 }], bestFiveBuyQty: 9000, bestFiveSellQty: 6000, pendingBuy: 300000, pendingSell: 200000, spreadPct: 0.02, imbalance: 0.2, wall: null });
  assert.equal(d.evidence.live[0].proven, "thin");
  assert.equal(d.earlyCalls.horizons[0].momentum, "steady");
  assert.equal(d.session.liveCall.vwap, 803.2);
  assert.equal(d.daily.rsi14, 63);
  assert.equal(d.delivery.reading.word, "accumulation");
  assert.equal(d.market.vix, 13.2);
  assert.deepEqual(d.habits, ["Fades after 2:30 PM"]);
  assert.deepEqual(d.missing, []);
});

test("what could not be read is listed, never guessed; a slow part does not hold the rest up", async () => {
  const slow = { view: () => new Promise(() => {}) };
  const d = await dossier("SBIN", { market: { quotes: async () => ({ quotes: {} }) }, consensus: { view: async () => ({ available: false, reason: "The session is over." }) }, evidence: { view: async () => { throw new Error("broker down"); } }, horizon: slow, ahead: null, delivery: { forSymbol: () => ({ available: false, reason: "not read yet" }) } });
  assert.ok(d.missing.includes("The session is over."));
  assert.ok(d.missing.some((m) => /evidence desk.*broker down/.test(m)));
  assert.ok(d.missing.some((m) => /15-minute forecaster took too long/.test(m)));
  assert.ok(d.missing.includes("not read yet"));
  assert.equal(d.quote, undefined);
  assert.equal(ladder(null), null);
});
