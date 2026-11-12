"use strict";
// The live tick stream (wire format and connection behaviour) and the market context.

const test = require("node:test");
const assert = require("node:assert/strict");

const { KiteTicker, parseTicks, encodeTicks } = require("../market/ticker");
const { tickQuote } = require("../market/service");
const { buildContext, contextKeys } = require("../market/context");
const { fakeSocket, wait, until } = require("./helpers/fake-socket");

const INFY = 408065; // NSE equity (segment 1)
const NIFTY = 256265; // index (segment 9)
const USDINR = (1234 << 8) | 3; // a currency-segment token

/* ------------------------------------------------------------ wire format */

test("a full equity packet: every field at its documented offset, prices in paise", () => {
  const p = Buffer.alloc(184);
  p.writeUInt32BE(INFY, 0);
  p.writeInt32BE(152050, 4); // last 1520.50
  p.writeInt32BE(25, 8); // last quantity
  p.writeInt32BE(151120, 12); // average price
  p.writeInt32BE(4300000, 16); // volume
  p.writeInt32BE(900, 20);
  p.writeInt32BE(700, 24);
  p.writeInt32BE(150300, 28); // open
  p.writeInt32BE(152100, 32); // high
  p.writeInt32BE(149900, 36); // low
  p.writeInt32BE(150000, 40); // previous close
  p.writeInt32BE(1794473107, 44); // last trade, epoch seconds
  p.writeInt32BE(1794473108, 60); // exchange time
  p.writeInt32BE(50, 64); // best bid quantity
  p.writeInt32BE(152045, 68); // best bid
  p.writeInt32BE(80, 124); // best offer quantity
  p.writeInt32BE(152055, 128); // best offer
  const frame = Buffer.concat([Buffer.from([0, 1, 0, 184]), p]);
  assert.deepEqual(parseTicks(frame), [
    { token: INFY, last: 1520.5, lastQty: 25, avgPrice: 1511.2, volume: 4300000, buyQty: 900, sellQty: 700, open: 1503, high: 1521, low: 1499, prevClose: 1500, lastTradeTime: 1794473107000, exchangeTime: 1794473108000, bid: 1520.45, bidQty: 50, ask: 1520.55, askQty: 80, depth: { b: [[1520.45, 50, 0]], a: [[1520.55, 80, 0]] } },
  ]);
});

test("index, quote-only, last-price-only and currency packets; several packets in one message", () => {
  const index = Buffer.alloc(32);
  index.writeUInt32BE(NIFTY, 0);
  [2412050, 2415000, 2398000, 2400000, 2395000, 17050].forEach((v, i) => index.writeInt32BE(v, 4 + i * 4));
  index.writeInt32BE(1794473108, 28);
  const quote = Buffer.alloc(44);
  quote.writeUInt32BE(INFY, 0);
  quote.writeInt32BE(152000, 4);
  quote.writeInt32BE(150000, 40);
  const ltp = Buffer.alloc(8);
  ltp.writeUInt32BE(INFY, 0);
  ltp.writeInt32BE(152010, 4);
  const fx = Buffer.alloc(8);
  fx.writeUInt32BE(USDINR, 0);
  fx.writeInt32BE(884025000, 4); // 88.4025 with seven implied decimals
  const len = (b) => Buffer.from([0, b.length]);
  const ticks = parseTicks(Buffer.concat([Buffer.from([0, 4]), len(index), index, len(quote), quote, len(ltp), ltp, len(fx), fx]));
  assert.equal(ticks.length, 4);
  assert.deepEqual(ticks[0], { token: NIFTY, index: true, last: 24120.5, high: 24150, low: 23980, open: 24000, prevClose: 23950, exchangeTime: 1794473108000 });
  assert.equal(ticks[1].last, 1520);
  assert.equal(ticks[1].prevClose, 1500);
  assert.equal(ticks[1].bid, undefined, "a quote packet carries no depth");
  assert.deepEqual(ticks[2], { token: INFY, last: 1520.1 });
  assert.equal(ticks[3].last, 88.4025);
});

test("heartbeats, empty frames and truncated messages never throw and never invent a tick", () => {
  assert.deepEqual(parseTicks(Buffer.from([0])), []); // the 1-byte heartbeat
  assert.deepEqual(parseTicks(Buffer.alloc(0)), []);
  assert.deepEqual(parseTicks("not a buffer"), []);
  const good = encodeTicks([{ token: INFY, last: 100, prevClose: 99 }, { token: INFY, last: 101, prevClose: 99 }]);
  assert.equal(parseTicks(good).length, 2);
  assert.equal(parseTicks(good.subarray(0, good.length - 10)).length, 1, "the cut-off second packet is dropped");
  assert.deepEqual(parseTicks(Buffer.from([0, 3, 0, 200, 1, 2, 3])), [], "a length that runs past the message");
});

test("encode → parse is lossless, and a tick becomes a quote in the same shape the poll gives", () => {
  const sent = { token: INFY, last: 1520.5, lastQty: 10, avgPrice: 1511.2, volume: 4300000, buyQty: 900, sellQty: 700, open: 1503, high: 1521, low: 1499, prevClose: 1500, lastTradeTime: Date.parse("2026-11-12T04:45:07Z"), exchangeTime: Date.parse("2026-11-12T04:45:08Z"), bid: 1520.45, bidQty: 50, ask: 1520.55, askQty: 80 };
  const [got] = parseTicks(encodeTicks([sent]));
  assert.deepEqual(got, { ...sent, depth: { b: [[1520.45, 50, 0]], a: [[1520.55, 80, 0]] } });
  const q = tickQuote(got);
  assert.equal(q.last, 1520.5);
  assert.equal(q.change, 20.5);
  assert.ok(Math.abs(q.changePct - 1.36667) < 0.0001);
  assert.equal(q.time, "2026-11-12 10:15:07", "IST, in the REST quote's format");
  assert.equal(q.streamed, true);
  assert.equal(q.upperCircuit, undefined, "circuit limits are not on the stream");
  // before the first trade of the day the exchange sends zeros: they must not become prices
  const pre = tickQuote({ token: INFY, last: 1500, open: 0, high: 0, low: 0, prevClose: 1500, volume: 0 });
  assert.equal(pre.open, undefined);
  assert.equal(pre.low, undefined);
  assert.equal(pre.volume, 0);
  const idx = tickQuote(parseTicks(encodeTicks([{ token: NIFTY, last: 24120.5, high: 24150, low: 23980, open: 24000, prevClose: 23950 }]))[0]);
  assert.equal(idx.volume, undefined);
  assert.equal(idx.changePct.toFixed(2), "0.71");
});

/* ------------------------------------------------------------- connection */

const make = (WS, extra = {}) => new KiteTicker({ WebSocketImpl: WS, retryMs: 5, idleMs: 25, staleMs: 10000, ...extra });

test("ticker: nothing happens without a session; with one it connects, subscribes in full mode and delivers ticks", async () => {
  const WS = fakeSocket();
  const tk = make(WS);
  const states = [];
  tk.on("state", (s) => states.push(s.state));
  tk.subscribe([INFY]);
  await wait(15);
  assert.equal(WS.sockets.length, 0, "no session, no connection");
  assert.equal(tk.state, "off");

  tk.setCredentials("KEY123", "TOKEN456");
  const sock = await until(() => WS.sockets[0]);
  assert.equal(sock.url, "wss://ws.kite.trade?api_key=KEY123&access_token=TOKEN456");
  await until(() => tk.isLive());
  assert.deepEqual(sock.sent, [{ a: "subscribe", v: [INFY] }, { a: "mode", v: ["full", [INFY]] }]);
  assert.deepEqual(states, ["connecting", "live"]);

  const got = [];
  tk.on("tick", (t) => got.push(t));
  sock.push([{ token: INFY, last: 100, prevClose: 99, volume: 10 }, { token: NIFTY, last: 24000, prevClose: 23900 }]);
  assert.equal(got.length, 1, "a tick for something nobody asked for is dropped");
  assert.equal(tk.get(INFY).last, 100);
  // a partial update keeps what it does not mention
  const ltp = Buffer.alloc(12);
  ltp.writeInt16BE(1, 0);
  ltp.writeInt16BE(8, 2);
  ltp.writeUInt32BE(INFY, 4);
  ltp.writeInt32BE(10050, 8);
  sock.emit("message", ltp, true);
  assert.equal(tk.get(INFY).last, 100.5);
  assert.equal(tk.get(INFY).prevClose, 99);
  // text frames (alerts, postbacks) are not market data
  sock.emit("message", Buffer.from(JSON.stringify({ type: "error", data: "x" })), false);
  assert.equal(got.length, 2);
  tk.close();
});

test("ticker: subscriptions are counted, so one page leaving does not blind another", async () => {
  const WS = fakeSocket();
  const tk = make(WS);
  tk.setCredentials("K", "T");
  tk.subscribe([INFY]);
  const sock = await until(() => WS.sockets[0]);
  await until(() => tk.isLive());
  tk.subscribe([INFY, NIFTY]); // a second listener
  assert.deepEqual(sock.sent.slice(2), [{ a: "subscribe", v: [NIFTY] }, { a: "mode", v: ["full", [NIFTY]] }], "only the new instrument is requested");
  tk.unsubscribe([INFY]);
  assert.ok(!sock.sent.some((m) => m.a === "unsubscribe"), "INFY is still wanted by the other listener");
  tk.unsubscribe([INFY, NIFTY]);
  assert.deepEqual(sock.sent[sock.sent.length - 1], { a: "unsubscribe", v: [INFY, NIFTY] });
  // nobody is listening: after a short grace period the socket is closed
  await until(() => sock.closed);
  assert.equal(tk.state, "idle");
  assert.equal(tk.get(INFY), null);
});

test("ticker: a dropped connection comes back and resubscribes; a stale price is never served meanwhile", async () => {
  const WS = fakeSocket();
  const tk = make(WS);
  tk.setCredentials("K", "T");
  tk.subscribe([INFY, NIFTY]);
  const a = await until(() => WS.sockets[0]);
  await until(() => tk.isLive());
  a.push([{ token: INFY, last: 100, prevClose: 99 }]);
  assert.equal(tk.get(INFY).last, 100);

  a.terminate(); // the network drops
  await until(() => tk.state === "down");
  assert.equal(tk.get(INFY), null, "not live → no price from the stream");
  const b = await until(() => WS.sockets[1]);
  await until(() => tk.isLive());
  assert.deepEqual(b.sent[0], { a: "subscribe", v: [INFY, NIFTY] });
  tk.close();
});

test("ticker: a connection that goes silent is treated as dead", async () => {
  const WS = fakeSocket();
  const tk = make(WS, { staleMs: 60 });
  tk.setCredentials("K", "T");
  tk.subscribe([INFY]);
  const a = await until(() => WS.sockets[0]);
  await until(() => tk.isLive());
  // no ticks and no heartbeat for longer than staleMs
  await until(() => WS.sockets.length >= 2, 2000);
  assert.equal(a.closed, true);
  tk.close();
});

test("ticker: a refused session stops retrying, and a new session starts again", async () => {
  const WS = fakeSocket();
  WS.reject = 403;
  const tk = make(WS);
  tk.setCredentials("K", "EXPIRED");
  tk.subscribe([INFY]);
  await until(() => tk.state === "denied");
  assert.match(tk.reason, /Log in to Kite again/);
  await wait(40);
  assert.equal(WS.sockets.length, 1, "no reconnect storm against a session Zerodha has refused");

  WS.reject = 0;
  tk.setCredentials("K", "FRESH");
  await until(() => tk.isLive());
  assert.match(WS.sockets[1].url, /access_token=FRESH$/);
  // losing the session altogether hangs up
  tk.setCredentials(null, null);
  assert.equal(tk.state, "off");
  await until(() => WS.sockets[1].closed);
});

test("ticker: other failed handshakes back off and try again", async () => {
  const WS = fakeSocket();
  WS.reject = 502;
  const tk = make(WS);
  tk.setCredentials("K", "T");
  tk.subscribe([INFY]);
  await until(() => WS.sockets.length >= 3, 2000);
  assert.equal(tk.denied, false);
  WS.reject = 0;
  await until(() => tk.isLive(), 2000);
  tk.close();
});

/* ---------------------------------------------------------- market context */

const at = (hhmm) => Date.parse(`2026-11-12T${hhmm}:00+05:30`);
const q = (last, open, high, low, prevClose, volume) => ({ last, open, high, low, prevClose, changePct: ((last - prevClose) / prevClose) * 100, volume });
const base = () => {
  const plan = contextKeys(at("10:30"));
  const quotes = {
    [plan.nifty]: q(23800, 24000, 24020, 23780, 23950),
    [plan.bank]: q(51500, 52000, 52050, 51450, 51900),
    [plan.vix]: q(15.4, 14.1, 15.6, 14, 14),
  };
  plan.sectors.forEach(([key], i) => (quotes[key] = q(1000 - 5 - i, 1004, 1006, 990, 1005)));
  return { plan, quotes };
};

test("the quote keys: indices by name, futures for this month and the next", () => {
  const plan = contextKeys(at("10:30"));
  assert.equal(plan.nifty, "NSE:NIFTY 50");
  assert.equal(plan.gift, "NSEIX:GIFT NIFTY");
  assert.deepEqual(plan.usdinr, ["CDS:USDINR26NOVFUT", "CDS:USDINR26DECFUT"]);
  assert.deepEqual(plan.crude, ["MCX:CRUDEOIL26NOVFUT", "MCX:CRUDEOIL26DECFUT"]);
  assert.deepEqual(contextKeys(Date.parse("2026-12-20T10:00:00+05:30")).usdinr, ["CDS:USDINR26DECFUT", "CDS:USDINR27JANFUT"], "December rolls into next year");
  assert.ok(plan.keys.length >= 18 && new Set(plan.keys).size === plan.keys.length);
});

test("a falling market reads as a falling tide, factor by factor, with VIX and breadth called out", () => {
  const { plan, quotes } = base();
  const c = buildContext({ quotes, plan, nowMs: at("10:30") });
  assert.equal(c.available, true);
  assert.equal(c.tide.label, "Falling");
  assert.ok(c.tide.score <= -60, String(c.tide.score));
  assert.equal(c.tide.factors.reduce((s, f) => s + f.max, 0), 100);
  c.tide.factors.forEach((f) => assert.ok(Math.abs(f.pts) <= f.max, f.name));
  assert.equal(c.tide.score, c.tide.factors.reduce((s, f) => s + f.pts, 0));
  assert.match(c.tide.summary, /^Falling tide \(-\d+\): Nifty -0\.63% on the day, -0\.83% since the open\.$/);
  assert.equal(c.nifty.dayPosPct, 8);
  assert.equal(c.vix.level, "normal");
  assert.equal(c.vix.changePct, 10);
  assert.ok(c.notes.some((n) => /India VIX is up 10\.0% today/.test(n)));
  assert.deepEqual(c.breadth, { up: 0, down: 10, flat: 0, total: 10 });
  assert.ok(c.notes.some((n) => /Almost every sector is down/.test(n)));
  assert.equal(c.session.phase, "morning");
});

test("a rising market, with the 5-minute trend counted when bars exist", () => {
  const { plan, quotes } = base();
  quotes[plan.nifty] = q(24180, 24000, 24190, 23990, 23950);
  quotes[plan.bank] = q(52400, 52000, 52420, 51980, 51900);
  plan.sectors.forEach(([key]) => (quotes[key] = q(1012, 1004, 1013, 1003, 1005)));
  const bars = Array.from({ length: 30 }, (_, i) => ({ t: "x", o: 24000 + i * 6, h: 24004 + i * 6, l: 23998 + i * 6, c: 24003 + i * 6, v: 0 }));
  const c = buildContext({ quotes, plan, niftyBars: bars, nowMs: at("11:45") });
  assert.equal(c.tide.label, "Rising");
  const trend = c.tide.factors.find((f) => /5-minute trend/.test(f.name));
  assert.equal(trend.pts, 15);
  assert.match(trend.reading, /9 EMA above 21 EMA, price above both/);
  assert.ok(c.notes.some((n) => /Almost every sector is up/.test(n)));
  assert.ok(c.tide.score >= 90);
});

test("overseas-linked instruments: the traded contract is chosen, missing ones are marked missing", () => {
  const { plan, quotes } = base();
  quotes[plan.gift] = q(24210, 24100, 24230, 24080, 24050);
  quotes[plan.usdinr[0]] = q(88.4, 88.2, 88.45, 88.15, 88.1, 200); // expiring, thin
  quotes[plan.usdinr[1]] = q(88.75, 88.4, 88.8, 88.35, 88.4, 9000); // where the trading is
  quotes[plan.crude[0]] = q(5820, 5700, 5830, 5690, 5680, 12000);
  const c = buildContext({ quotes, plan, nowMs: at("10:30") });
  const by = Object.fromEntries(c.items.map((x) => [x.id, x]));
  assert.equal(by.usdinr.last, 88.75);
  assert.equal(by.usdinr.changePct, 0.4);
  assert.ok(c.notes.some((n) => /rupee is weaker/.test(n)));
  assert.equal(by.crude.changePct, 2.46);
  assert.ok(c.notes.some((n) => /Crude oil is \+2\.46% today/.test(n)));
  assert.equal(by.gift.available, true);
  assert.equal(by.gold.available, false);
  assert.equal(by.gold.last, undefined, "nothing is invented for an instrument with no quote");
  assert.ok(!c.notes.some((n) => /GIFT Nifty/.test(n)), "during the session the Nifty itself is the guide");
});

test("before the open, GIFT Nifty is the early hint — and is described as a future, not as the Nifty", () => {
  const { plan, quotes } = base();
  quotes[plan.gift] = q(24210, 24100, 24230, 24080, 24050);
  const c = buildContext({ quotes, plan, nowMs: at("08:40") });
  assert.equal(c.session.open, false);
  assert.equal(c.tide.live, false);
  const note = c.notes.find((n) => /GIFT Nifty/.test(n));
  assert.match(note, /\+0\.67% from its previous close/);
  assert.match(note, /firmer open/);
  assert.match(note, /It is a future/);
});

test("without a Nifty quote there is no reading at all, rather than a guess", () => {
  const plan = contextKeys(at("10:30"));
  const c = buildContext({ quotes: {}, plan, nowMs: at("10:30") });
  assert.equal(c.available, false);
  assert.match(c.reason, /no Nifty 50 quote/);
  assert.deepEqual(c.items, []);
});

test("market depth: five levels a side, each with its price, quantity and number of resting bids or offers", () => {
  const depth = {
    b: [[100, 500, 12], [99.95, 400, 9], [99.9, 300, 7], [99.85, 200, 5], [99.8, 100, 2]],
    a: [[100.05, 150, 4], [100.1, 250, 6], [100.15, 350, 8], [100.2, 450, 10], [100.25, 550, 11]],
  };
  const [t] = parseTicks(encodeTicks([{ token: INFY, last: 100.05, prevClose: 99, volume: 10, depth }]));
  assert.deepEqual(t.depth, depth);
  assert.equal(t.bid, 100);
  assert.equal(t.bidQty, 500);
  assert.equal(t.ask, 100.05);
  assert.equal(t.askQty, 150);
  // a book with only one side (a stock locked at its circuit)
  const [locked] = parseTicks(encodeTicks([{ token: INFY, last: 110, prevClose: 100, depth: { b: [[110, 90000, 300]], a: [] } }]));
  assert.deepEqual(locked.depth, { b: [[110, 90000, 300]], a: [] });
  assert.equal(locked.ask, undefined);
});
