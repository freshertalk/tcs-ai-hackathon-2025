"use strict";
// The chart's candles: every Kite interval, asked for in the chunks Kite allows, cached briefly.

const test = require("node:test");
const assert = require("node:assert/strict");
const { MarketService } = require("../market/service");

function desk({ open = true } = {}) {
  const asked = [];
  const now = open ? Date.parse("2026-11-12T05:00:00Z") : Date.parse("2026-11-12T12:00:00Z");
  const m = Object.create(MarketService.prototype);
  Object.assign(m, {
    now: () => now,
    mode: () => "kite",
    _instrument: async () => ({ t: 123 }),
    daily: async () => ({ candles: [{ t: "2026-11-11", o: 1, h: 2, l: 1, c: 2, v: 5 }], source: "kite", stale: false }),
    _call: async (fn) =>
      fn({
        historical: async (token, interval, from, to) => {
          asked.push({ interval, days: Math.round((to - from) / 86400000) });
          return [{ t: `${to.toISOString().slice(0, 10)}T09:15:00+0530`, o: 10, h: 11, l: 9, c: 10.5, v: 100 }];
        },
      }),
  });
  return { m, asked };
}

test("intraday intervals are asked for in Kite's chunks and joined without repeats", async () => {
  const { m, asked } = desk();
  const out = await m.candles("SBIN", "5minute", { days: 150 });
  assert.equal(out.interval, "5minute");
  assert.deepEqual(asked.map((a) => a.days), [100, 50], "the newest 100 days first, then the 50 before them");
  assert.equal(out.candles.length, 2);
  // within 15 s during the session: from the cache
  await m.candles("SBIN", "5minute", { days: 150 });
  assert.equal(asked.length, 2);
  // the most a chart may ask for is capped
  await m.candles("SBIN", "minute", { days: 999 });
  assert.equal(asked[2].days, 60);
});

test("daily candles come from the cached history; unknown intervals and symbols are refused", async () => {
  const { m, asked } = desk();
  const d = await m.candles("SBIN", "day");
  assert.equal(d.candles.length, 1);
  assert.equal(asked.length, 0);
  await assert.rejects(() => m.candles("SBIN", "2minute"), /Unknown interval/);
  await assert.rejects(() => m.candles("bad sym!", "day"), /valid symbol/);
  m.mode = () => "demo";
  await assert.rejects(() => m.candles("SBIN", "15minute"), /Zerodha connection/);
});
