"use strict";
// The account summary says when each open intraday (MIS) stock position is squared off (the Positions page shows it).
const test = require("node:test");
const assert = require("node:assert/strict");
const { TradingService } = require("../trading/service");

const at = Date.parse("2026-11-27T11:00:00+05:30");
const net = [
  { exchange: "NSE", symbol: "RELIANCE", product: "MIS", quantity: 10 },
  { exchange: "NSE", symbol: "SMALLCO", product: "MIS", quantity: -5 },
  { exchange: "NSE", symbol: "SBIN", product: "CNC", quantity: 15 },
  { exchange: "NSE", symbol: "TCS", product: "MIS", quantity: 0 },
  { exchange: "NFO", symbol: "NIFTY26DECFUT", product: "MIS", quantity: 75 },
];

test("until the F&O list is read every MIS stock gets the earlier time; then each gets its own", async () => {
  const self = { now: () => at, market: { derivatives: async () => [{ n: "RELIANCE", y: "FUT" }] } };
  const call = () => TradingService.prototype._squareOffs.call(self, net);
  const first = call();
  assert.deepEqual(Object.keys(first), ["RELIANCE", "SMALLCO"], "only open MIS positions in stocks");
  assert.equal(first.SMALLCO.clock, "3:12 PM", "unknown: the earlier time (early is safe)");
  await new Promise((r) => setImmediate(r));
  const later = call();
  assert.equal(later.RELIANCE.clock, "3:12 PM");
  assert.equal(later.SMALLCO.clock, "3:25 PM", "no closing auction");
  assert.match(later.SMALLCO.note, /squares off intraday \(MIS\) positions in SMALLCO automatically at 3:25 PM/);
});

test("nothing open in MIS: nothing to say, and the list is not even asked for", () => {
  const self = { now: () => at, market: { derivatives: () => assert.fail("not needed") } };
  assert.deepEqual(TradingService.prototype._squareOffs.call(self, [net[2], net[3]]), {});
});
