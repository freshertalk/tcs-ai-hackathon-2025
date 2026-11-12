"use strict";
// The NSE-wide screener: which instruments are in it, how a stored series is brought
// up to "now", and what RSI "at this moment" means.

const test = require("node:test");
const assert = require("node:assert/strict");

const { membersOf, calendarFrom, resolveSeries, rsiNow } = require("../market/universe");
const I = require("../market/indicators");

test("the universe: main-series NSE equities — other series, bonds and indices are left out", () => {
  const list = [
    { s: "INFY", n: "INFOSYS", t: 1, k: "EQ" },
    { s: "BAJAJ-AUTO", n: "BAJAJ AUTO", t: 2, k: "EQ" }, // a hyphen that is part of the name
    { s: "M&M", n: "MAHINDRA & MAHINDRA", t: 3, k: "EQ" },
    { s: "XYZ-BE", n: "XYZ LTD", t: 4, k: "EQ" }, // trade-to-trade series
    { s: "ABC-SM", n: "ABC SME", t: 5, k: "EQ" }, // SME
    { s: "738GS2027-GS", n: "GOI LOAN", t: 6, k: "EQ" }, // a gilt
    { s: "SGBAUG29-GB", n: "SOVEREIGN GOLD BOND", t: 7, k: "EQ" },
    { s: "NHAI-N1", n: "NHAI BOND", t: 8, k: "EQ" },
    { s: "NIFTY 50", n: "NIFTY 50", t: 9, k: "INDEX" },
    { s: "NIFTYBEES", n: "NIPPON INDIA ETF NIFTY BEES", t: 10, k: "EQ" },
    { s: "LIQUIDCASE", n: "ZERODHA LIQUID FUND", t: 11, k: "EQ" },
    { s: "GOLDIAM", n: "GOLDIAM INTERNATIONAL", t: 12, k: "EQ" }, // a company, not a gold fund
  ];
  const m = membersOf(list);
  assert.deepEqual(m.map((x) => x.s), ["INFY", "BAJAJ-AUTO", "M&M", "NIFTYBEES", "LIQUIDCASE", "GOLDIAM"]);
  assert.deepEqual(m.filter((x) => x.fund).map((x) => x.s), ["NIFTYBEES", "LIQUIDCASE"]);
});

const bars = (closes, firstDay = 2) => closes.map((c, i) => ({ t: `2026-11-${String(firstDay + i).padStart(2, "0")}`, c }));
// sessions 9, 10, 11 November done; the 12th is today
const nifty = bars([23800, 23900, 23950, 24100], 9);

test("the calendar: which session the quotes' previous close belongs to", () => {
  // during the session: the Nifty's previous close is the 11th's close; today's bar exists
  assert.deepEqual(calendarFrom(nifty, { prevClose: 23950 }, "2026-11-12"), { d0: "2026-11-11", before: "2026-11-10", after: true, dates: ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"] });
  // before the open on the 12th: no bar for today yet, and the previous close is still the 11th's
  const morning = calendarFrom(nifty.slice(0, 3), { prevClose: 23950 }, "2026-11-12");
  assert.equal(morning.d0, "2026-11-11");
  assert.equal(morning.after, false, "nothing has traded since: there is no new bar to add");
  // with no index quote it falls back to the bars: a bar dated today means yesterday is the last full session
  assert.equal(calendarFrom(nifty, null, "2026-11-12").d0, "2026-11-11");
  assert.equal(calendarFrom(nifty.slice(0, 3), null, "2026-11-14").d0, "2026-11-11", "a weekend: the last bar is the last session");
  assert.equal(calendarFrom(nifty.slice(0, 1), null, "2026-11-12"), null, "one bar is not a calendar");
});

const cal = calendarFrom(nifty, { prevClose: 23950 }, "2026-11-12");
const live = (last, prevClose) => ({ last, prevClose, time: "2026-11-12 10:15:00" });

test("a stored series is brought to the previous close, then the live price is the newest bar", () => {
  // already complete through the 11th
  let r = resolveSeries({ d: "2026-11-11", c: [98, 99, 100] }, live(101, 100), cal);
  assert.deepEqual(r, { base: [98, 99, 100], live: true, rolled: false });
  // one session behind: the quote's previous close fills the gap — no download needed
  r = resolveSeries({ d: "2026-11-10", c: [97, 98, 99] }, live(101, 100), cal);
  assert.deepEqual(r, { base: [97, 98, 99, 100], live: true, rolled: true });
  // downloaded while today's bar was still forming: that half-made bar is dropped
  r = resolveSeries({ d: "2026-11-12", c: [98, 99, 100, 100.6] }, live(101, 100), cal);
  assert.deepEqual(r, { base: [98, 99, 100], live: true, rolled: false });
  // a stock that has not traded since the 11th contributes no new bar
  r = resolveSeries({ d: "2026-11-11", c: [98, 99, 100] }, { last: 100, prevClose: 100, time: "2026-11-11 15:29:58" }, cal);
  assert.equal(r.live, false);
});

test("a series that no longer agrees with the exchange is refused, not used", () => {
  // a 1:1 bonus: every past price is halved on the exchange, but the stored ones are not
  assert.deepEqual(resolveSeries({ d: "2026-11-11", c: [198, 199, 200] }, live(101, 100), cal), { stale: "rebased" });
  // the same, discovered while rolling forward: no stock moves 50% in a session
  assert.deepEqual(resolveSeries({ d: "2026-11-10", c: [197, 198, 199] }, live(101, 100), cal), { stale: "rebased" });
  // an ordinary 5% day rolls forward normally
  assert.equal(resolveSeries({ d: "2026-11-10", c: [97, 98, 99] }, live(105, 104), cal).rolled, true);
  // several sessions behind: it needs a fresh download
  assert.deepEqual(resolveSeries({ d: "2026-11-05", c: [97, 98, 99] }, live(101, 100), cal), { stale: "old" });
  assert.deepEqual(resolveSeries({ d: "2026-11-10", c: [97, 98, 99] }, { last: 101, prevClose: null }, cal), { stale: "no-previous-close" });
  assert.deepEqual(resolveSeries({ d: "2026-11-11", c: [] }, live(101, 100), cal), { stale: "empty" });
});

test("RSI now is Wilder's RSI with the live price as the last bar; RSI before is the previous close's", () => {
  let s = 7;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648), s / 2147483648);
  const base = [];
  let p = 100;
  for (let i = 0; i < 120; i += 1) base.push((p *= 1 + (rnd() - 0.5) * 0.04));
  const now = rsiNow(base, p * 1.03, true, 14);
  const full = I.rsi([...base, p * 1.03], 14);
  assert.equal(now.now, full[full.length - 1]);
  assert.equal(now.prev, I.rsi(base, 14)[base.length - 1]);
  assert.ok(now.now > now.prev, "a 3% jump lifts the RSI");
  // nothing traded since the last close: the RSI is simply that close's
  const flat = rsiNow(base, p, false, 14);
  assert.equal(flat.now, I.rsi(base, 14)[base.length - 1]);
  assert.equal(flat.prev, null);
  // other periods, and too little history
  assert.notEqual(rsiNow(base, p, false, 7).now, flat.now);
  assert.equal(rsiNow(base.slice(0, 10), p, true, 14), null);
  // an unbroken run of gains is 100, of losses 0
  assert.equal(rsiNow(Array.from({ length: 40 }, (_, i) => 100 + i), 141, true, 14).now, 100);
  assert.equal(rsiNow(Array.from({ length: 40 }, (_, i) => 200 - i), 159, true, 14).now, 0);
});
