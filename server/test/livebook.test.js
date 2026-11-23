"use strict";
// The live book (trading/livebook.js): Zerodha's positions re-priced on every streamed tick. A fake
// trading service and a fake ticker: no network, no order.

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { LiveBook, reprice, totals } = require("../trading/livebook");

// positions in the shape server/trading/broker.js gives them
const long = { exchange: "NSE", symbol: "SBIN", token: 779521, product: "MIS", quantity: 50, multiplier: 1, average: 990, last: 1000, close: 985, pnl: 500, m2m: 500, realised: 0, unrealised: 500, buyValue: 49500, sellValue: 0 };
const short = { exchange: "NSE", symbol: "RELIANCE", token: 738561, product: "MIS", quantity: -20, multiplier: 1, average: 1300, last: 1290, close: 1295, pnl: 200, m2m: 200, realised: 0, unrealised: 200, buyValue: 0, sellValue: 26000 };
const closed = { exchange: "NSE", symbol: "ITC", token: 424961, product: "MIS", quantity: 0, multiplier: 1, average: 0, last: 402, close: 400, pnl: 180, m2m: 180, realised: 180, unrealised: 0, buyValue: 40000, sellValue: 40180 };

test("reprice: Zerodha's P&L formula at the streamed price, long and short", () => {
  const a = reprice(long, 1010);
  assert.equal(a.pnl, 1000); // 0 − 49 500 + 50 × 1 010
  assert.equal(a.m2m, 1000);
  assert.equal(a.unrealised, 1000);
  assert.equal(a.last, 1010);
  assert.equal(a.live, true);
  const b = reprice(short, 1295);
  assert.equal(b.pnl, 100); // 26 000 − 0 − 20 × 1 295
  assert.equal(b.m2m, 100);
});

test("reprice: a closed position does not move; a bad price changes nothing", () => {
  assert.deepEqual({ ...reprice(closed, 500), live: undefined }, { ...closed, live: undefined });
  assert.equal(reprice(closed, 500).live, false);
  assert.equal(reprice(long, NaN).pnl, 500);
  assert.equal(reprice(long, 0).live, false);
});

test("reprice: an overnight position keeps the day's M2M apart from the P&L since entry", () => {
  // carried from yesterday: since entry +800, today (M2M from yesterday's close) +300
  const carried = { ...long, pnl: 800, m2m: 300, buyValue: 49200 };
  const a = reprice(carried, 1002);
  assert.equal(a.pnl, 900); // 0 − 49 200 + 50 × 1 002
  assert.equal(a.m2m, 400); // +100 on the day, as the price moved ₹2 on 50
});

test("reprice: the multiplier counts (a currency future: 1 lot = 1 000 units)", () => {
  const fut = { exchange: "CDS", symbol: "USDINR26NOVFUT", token: 1, product: "NRML", quantity: 2, multiplier: 1000, average: 88, last: 88.1, pnl: 200, m2m: 200, unrealised: 200, buyValue: 176000, sellValue: 0 };
  assert.equal(reprice(fut, 88.2).pnl, 400);
  assert.equal(reprice(fut, 88.2).m2m, 400);
});

test("totals: the day's M2M over open and closed positions, and whether all of it is live", () => {
  const t = totals([reprice(long, 1010), reprice(short, 1295), { ...closed, live: false }]);
  assert.equal(t.day, 1280); // 1 000 + 100 + 180
  assert.equal(t.pnl, 1280);
  assert.equal(t.open, 2);
  assert.equal(t.closed, 1);
  assert.equal(t.live, true); // a closed position needs no price
  assert.equal(totals([{ ...long, live: false }]).live, false);
});

/* ------------------------------------------------------------------ the book */
function rig({ open = true } = {}) {
  const ticker = new EventEmitter();
  ticker.subs = new Map();
  ticker.subscribe = (toks) => toks.forEach((t) => ticker.subs.set(t, (ticker.subs.get(t) || 0) + 1));
  ticker.unsubscribe = (toks) => toks.forEach((t) => ticker.subs.set(t, (ticker.subs.get(t) || 0) - 1));
  ticker.isLive = () => true;
  const held = () => [...ticker.subs].filter(([, n]) => n > 0).map(([t]) => t).sort((a, b) => a - b);
  let clock = Date.parse("2026-11-16T05:20:00Z"); // 10:50 IST, a Monday
  const trading = {
    connected: true,
    net: [long, short, closed],
    reads: 0,
    listeners: new Set(),
    status() {
      return { connected: this.connected };
    },
    async positions() {
      this.reads += 1;
      if (!this.connected) throw Object.assign(new Error("Connect Zerodha first."), { code: "not_connected" });
      return { net: this.net.map((p) => ({ ...p })), day: [] };
    },
    stream(send) {
      this.listeners.add(send);
      send({ type: "hello" });
      return () => this.listeners.delete(send);
    },
    order(u) {
      for (const fn of this.listeners) fn({ type: "order", update: u });
    },
  };
  const book = new LiveBook({ trading, market: { ticker }, now: () => clock, log: { log() {}, error() {} }, isOpen: () => open, emitMs: 0, loopMs: 60000, afterOrder: [0] });
  book.start(); // listens to the ticker and the order updates (its own loop is slowed right down here)
  return { book, trading, ticker, held, tick: (ms) => (clock += ms) };
}
const wait = (ms = 5) => new Promise((r) => setTimeout(r, ms));

test("the book reads the positions, holds the open ones' instruments on the stream, and moves with each tick", async () => {
  const { book, ticker, held, tick } = rig();
  await book.refresh();
  assert.deepEqual(held(), [738561, 779521]); // the closed ITC is not followed
  let v = book.view();
  assert.equal(v.available, true);
  assert.equal(v.day, 880); // 500 + 200 + 180 at Zerodha's own prices
  assert.equal(v.live, false); // no streamed price yet
  tick(1000);
  ticker.emit("tick", { token: 779521, last: 1010 });
  ticker.emit("tick", { token: 738561, last: 1295 });
  ticker.emit("tick", { token: 424961, last: 999 }); // not held: ignored
  v = book.view();
  assert.equal(v.day, 1280);
  assert.equal(v.open, 2);
  assert.equal(v.live, true);
  assert.equal(v.positions.find((p) => p.symbol === "SBIN").last, 1010);
  // the same live positions serve the daily goal's check, in Zerodha's shape
  const p = await book.fresh();
  assert.equal(p.net.find((x) => x.symbol === "SBIN").m2m, 1000);
});

test("a watcher gets every change pushed; a closed position lets its instrument go", async () => {
  const { book, trading, ticker, held, tick } = rig();
  const got = [];
  const off = book.watch((v) => got.push(v));
  await wait();
  assert.ok(got.length >= 1, "the first view is pushed at once");
  tick(500);
  ticker.emit("tick", { token: 779521, last: 1004 });
  await wait();
  assert.equal(got[got.length - 1].positions.find((p) => p.symbol === "SBIN").pnl, 700);
  // SBIN is squared off: an order update arrives, the book re-reads at once
  trading.net = [{ ...long, quantity: 0, sellValue: 50200, realised: 700, unrealised: 0, pnl: 700, m2m: 700, last: 1004 }, short, closed];
  tick(500);
  trading.order({ id: "1", status: "COMPLETE", symbol: "SBIN", side: "SELL" });
  book.start();
  trading.order({ id: "1", status: "COMPLETE", symbol: "SBIN", side: "SELL" });
  await wait(20);
  const last = got[got.length - 1];
  assert.equal(last.open, 1);
  assert.equal(last.positions.find((p) => p.symbol === "SBIN").quantity, 0);
  assert.deepEqual(held().filter((t) => t !== 256265), [738561]);
  off();
  book.stop();
  assert.equal(book.listenerCount("book"), 0);
});

test("a streamed price older than the base is not used: Zerodha's newer figures stand", async () => {
  const { book, ticker, tick } = rig();
  await book.refresh();
  ticker.emit("tick", { token: 779521, last: 950 });
  tick(5000);
  await book.refresh(); // a newer read: the 950 seen before it is dropped
  assert.equal(book.view().positions.find((p) => p.symbol === "SBIN").pnl, 500);
});

test("the stream going down: back to Zerodha's own prices until it is live again", async () => {
  const { book, ticker } = rig();
  await book.refresh();
  ticker.emit("tick", { token: 779521, last: 1010 });
  assert.equal(book.view().day, 1380);
  book.start();
  ticker.emit("state", { state: "down", reason: "lost" });
  assert.equal(book.view().day, 880);
  book.stop();
});

test("not connected: no book, and the goal's check fails as the read itself does", async () => {
  const { book, trading } = rig();
  trading.connected = false;
  await book.refresh();
  assert.equal(book.view().available, false);
  await assert.rejects(() => book.fresh(), /Connect Zerodha first/);
});

test("in market hours one index is kept on the stream (order updates arrive on that socket); outside, it is let go", async () => {
  const opened = rig({ open: true });
  await opened.book._loop();
  assert.ok(opened.held().includes(256265));
  const shut = rig({ open: false });
  await shut.book._loop();
  assert.ok(!shut.held().includes(256265));
  opened.book.stop();
  assert.ok(!opened.held().includes(256265));
});

test("the base is read every 15 s in market hours only while it is needed (a page, or the goal on)", async () => {
  const { book, trading, tick } = rig();
  await book._loop();
  assert.equal(trading.reads, 0, "nobody looking, goal off: no reads");
  book.needed = () => true;
  await book._loop();
  assert.equal(trading.reads, 1);
  tick(5000);
  await book._loop();
  assert.equal(trading.reads, 1, "still fresh");
  tick(15000);
  await book._loop();
  assert.equal(trading.reads, 2);
});

test("unrealised = open positions only: a squared-off intraday position's P&L (Kite reports it as 'unrealised') is booked, not unrealised", () => {
  const { totals, openUnrealised } = require("../trading/livebook");
  // what Kite really sends for an intraday position closed today: quantity 0, realised 0, the whole P&L in `unrealised`
  const squared = { ...closed, symbol: "HINDCOPPER", pnl: 1627.85, m2m: 1627.85, realised: 0, unrealised: 1627.85 };
  const t = totals([squared]);
  assert.equal(t.unrealised, 0, "nothing open, nothing unrealised (Zerodha Console shows 0)");
  assert.equal(t.booked, 1627.85);
  assert.equal(t.unrealisedKite, 1627.85, "Kite's own sum is still there for anything that reads it");
  assert.equal(t.open, 0);
  // an open position partly booked: only the quantity still held counts, at (price − average)
  const part = { ...long, quantity: 50, average: 990, last: 1000, pnl: 900, unrealised: 900 }; // 400 booked earlier
  assert.equal(openUnrealised(part), 500);
  const both = totals([part, squared]);
  assert.equal(both.unrealised, 500);
  assert.equal(both.booked, 2027.85);
  // short: 20 short at 1300, price 1290 → +200
  assert.equal(openUnrealised(short), 200);
  // no average or price known: Kite's figure is the fallback
  assert.equal(openUnrealised({ quantity: 5, unrealised: 42 }), 42);
});
