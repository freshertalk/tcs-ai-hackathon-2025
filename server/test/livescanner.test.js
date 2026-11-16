"use strict";
// The live scanner service (server/scanner.js): the feed, the buffer filled from history, the reading,
// the ranking, the record, the AI on need (and what it may not do), sharing and pushing. A fake market,
// a fake ticker and a fake AI: no network, no order.

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Scanner } = require("../scanner");
const S = require("../market/scan");

const at = (date, hhmm) => Date.parse(`${date}T${hhmm}:00+05:30`);
const DATES = ["2026-11-12", "2026-11-13", "2026-11-16"];

function bars(dir, start) {
  const out = [];
  let p = start;
  for (const d of DATES) {
    for (let m = 555; m < 930; m += 5) {
      const t = `${d}T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00+0530`;
      const o = p;
      const c = p + dir * 0.6 * [1.8, -0.7, 1.5, -0.6][out.length % 4];
      out.push({ t, o, h: Math.max(o, c) + 0.4, l: Math.min(o, c) - 0.4, c, v: 10000 });
      p = c;
    }
  }
  return out;
}
const dailyRows = (step) => Array.from({ length: 80 }, (_, i) => {
  const d = new Date(Date.parse("2026-07-01T00:00:00Z") + i * 86400000).toISOString().slice(0, 10);
  const c = 1000 + i * step;
  return { t: d, o: c, h: c + 4, l: c - 5, c, v: 2000000 };
});

function rig({ now = at("2026-11-16", "10:32"), connected = true } = {}) {
  let clock = now;
  const ticker = new EventEmitter();
  ticker.held = new Map();
  ticker.subscribe = (toks) => toks.forEach((t) => ticker.held.set(t, (ticker.held.get(t) || 0) + 1));
  ticker.unsubscribe = (toks) => toks.forEach((t) => ticker.held.set(t, (ticker.held.get(t) || 0) - 1));
  const TOK = { UPCO: 11, DNCO: 22, FLATCO: 33 };
  const series = { 11: bars(1, 1000), 22: bars(-1, 1300), 33: bars(0, 500), 256265: bars(0.2, 24000) };
  const market = {
    connected,
    ticker,
    historyCalls: 0,
    mode: () => "kite",
    kiteState() {
      return { connected: this.connected };
    },
    instruments: async () => ({}),
    _token: (s) => TOK[s] || null,
    async _call(fn) {
      return fn({
        historical: async (token) => {
          market.historyCalls += 1;
          return series[token].filter((b) => Date.parse(b.t.replace(/(\d{2})(\d{2})$/, "$1:$2")) <= clock);
        },
      });
    },
    daily: async (s) => ({ candles: dailyRows(s === "DNCO" ? -2 : s === "UPCO" ? 2 : 0) }),
  };
  const docs = { m: new Map(), read(k, d) { return this.m.has(k) ? JSON.parse(this.m.get(k)) : d; }, write(k, v) { this.m.set(k, JSON.stringify(v)); } };
  const shared = [];
  const reviews = [];
  const ai = {
    shared: { publish: (x) => shared.push(x) },
    scanAi: {
      ready: () => true,
      review: async (input) => {
        reviews.push(input);
        return {
          by: "Fake model",
          summary: "Two clean trends.",
          marketView: "Quiet.",
          picks: [
            { symbol: "NOTONLIST", keep: true, thesis: "made up", risk: "", confidence: "high" }, // not a candidate: ignored
            { symbol: "DNCO", keep: true, thesis: "Below VWAP with sellers in the book.", risk: "A reclaim of VWAP.", confidence: "medium" },
            { symbol: "UPCO", keep: false, thesis: "Stretched into yesterday's high.", risk: "", confidence: "low" },
          ],
        };
      },
    },
  };
  const sc = new Scanner({ market, ai, docs, now: () => clock, log: { log() {}, error() {} }, universe: ["UPCO", "DNCO", "FLATCO"] });
  const last = (tok) => series[tok].filter((b) => Date.parse(b.t.replace(/(\d{2})(\d{2})$/, "$1:$2")) <= clock).pop().c;
  const tickAll = () => {
    const mk = (token, side) => {
      const l = last(token);
      return { token, last: l, volume: 1500000, avgPrice: l - 3 * side, open: l - 20 * side, high: side > 0 ? l + 0.3 : l + 25, low: side > 0 ? l - 25 : l - 0.3, prevClose: l - 22 * side, buyQty: side > 0 ? 70000 : 25000, sellQty: side > 0 ? 30000 : 75000, at: clock };
    };
    sc._tick(mk(11, 1));
    sc._tick(mk(22, -1));
    sc._tick({ token: 33, last: last(33), volume: 900000, avgPrice: last(33), open: last(33), high: last(33) + 1, low: last(33) - 1, prevClose: last(33), buyQty: 50000, sellQty: 50000, at: clock });
    sc._tick({ token: 256265, last: last(256265), open: last(256265) - 30, high: last(256265) + 5, low: last(256265) - 40, prevClose: last(256265) - 35, at: clock });
  };
  return { sc, market, ticker, docs, shared, reviews, tickAll, step: (ms) => (clock += ms) };
}

async function fill(r) {
  await r.sc.loop(); // ensure: tokens held on the stream
  for (let i = 0; i < 6; i += 1) {
    r.step(500);
    await r.sc._seedNext();
  }
  r.tickAll();
  r.step(2100);
  r.sc.readAll();
}

test("the hundred (here three) and the NIFTY are held on the live stream; each stock's bars are read once from history", async () => {
  const r = rig();
  await fill(r);
  assert.deepEqual([...r.ticker.held].filter(([, n]) => n > 0).map(([t]) => t).sort((a, b) => a - b), [11, 22, 33, 256265]);
  assert.equal(r.market.historyCalls, 4, "one history read per instrument");
  const v = r.sc.view();
  assert.equal(v.universe.size, 3);
  assert.equal(v.universe.seeded, 3);
  assert.equal(v.universe.ticking, 3);
  assert.equal(v.board.length, 3);
});

test("the eligible stocks come first with their plan, the flat one is not eligible, and the market's lean is read", async () => {
  const r = rig();
  await fill(r);
  const v = r.sc.view();
  const names = v.picks.map((p) => p.symbol).sort();
  assert.deepEqual(names, ["DNCO", "UPCO"]);
  const up = v.picks.find((p) => p.symbol === "UPCO");
  assert.equal(up.side, "long");
  assert.ok(up.plan.stop < up.plan.entry && up.plan.t1 > up.plan.entry);
  assert.equal(v.picks.find((p) => p.symbol === "DNCO").side, "short");
  const flat = v.board.find((b) => b.s === "FLATCO");
  assert.equal(flat.el, false);
  assert.ok(flat.why, "the rule it fails is named");
  assert.ok(v.market && v.market.breadth.n === 3);
  assert.ok(v.market.nifty, "the NIFTY's own reading");
  // each turn to eligible opened a call in the record
  assert.equal(v.record.calls, 2);
});

test("the AI on need: its order and notes are used, but it cannot add a stock or change eligibility", async () => {
  const r = rig();
  await fill(r);
  await new Promise((res) => setTimeout(res, 10)); // the first eligible list of the day asked for a review
  assert.equal(r.reviews.length, 1);
  const input = r.reviews[0];
  assert.ok(input.candidates.every((c) => ["UPCO", "DNCO", "FLATCO"].includes(c.symbol)));
  assert.ok(input.market && input.record, "the market and the scanner's own record are given");
  const v = r.sc.view();
  assert.equal(v.ai.by, "Fake model");
  assert.equal(v.picks[0].symbol, "DNCO", "the AI's order for the names it kept");
  assert.equal(v.picks.find((p) => p.symbol === "UPCO").eligible, true, "a stock the AI would skip stays eligible — with the AI's reason shown");
  assert.equal(v.picks.find((p) => p.symbol === "UPCO").ai.keep, false);
  assert.ok(!v.picks.some((p) => p.symbol === "NOTONLIST"));
  // not again within ten minutes for the same leaders
  r.step(60000);
  r.tickAll();
  r.sc.readAll();
  await new Promise((res) => setTimeout(res, 10));
  assert.equal(r.reviews.length, 1);
  // within the daily limit
  r.sc.setSettings({ aiDailyCap: 1 });
  assert.equal(r.sc.settings().aiToday, 1);
  assert.equal(r.sc._aiNeed(r.sc._ranked().picks), "");
});

test("the leading eligible names are shared with the AI Engine (TradeAI reads them)", async () => {
  const r = rig();
  await fill(r);
  assert.ok(r.shared.length >= 2);
  assert.ok(r.shared.every((x) => x.feature === "scanner" && x.facts.entry && x.facts.stop));
});

test("a page watching gets the view at once and on every change", async () => {
  const r = rig();
  const got = [];
  const off = r.sc.watch((v) => got.push(v));
  assert.equal(got.length, 1);
  await fill(r);
  await new Promise((res) => setTimeout(res, 250));
  assert.ok(got.length >= 2);
  assert.ok(got[got.length - 1].picks.length >= 1);
  off();
  assert.equal(r.sc.listenerCount("update"), 0);
});

test("no Zerodha: off, nothing held; outside the hours: closed, the stream let go; the record is saved", async () => {
  const r = rig({ connected: false });
  await r.sc.loop();
  assert.equal(r.sc.view().state, "off");
  assert.equal([...r.ticker.held].filter(([, n]) => n > 0).length, 0);
  const r2 = rig();
  await fill(r2);
  r2.step(6 * 3600000); // 16:32
  await r2.sc.loop();
  assert.equal(r2.sc.view().state, "closed");
  assert.equal([...r2.ticker.held].filter(([, n]) => n > 0).length, 0);
  assert.ok(r2.docs.read("scanner/day-2026-11-16.json", null), "the day's record");
  assert.equal(r2.docs.read("scanner/record.json", null).sessions.length, 1);
});

test("one stock in detail: every reading and its votes; a stock outside the hundred is refused", async () => {
  const r = rig();
  await fill(r);
  const d = r.sc.detail("upco");
  assert.equal(d.ready, true);
  assert.ok(d.votes && d.votes.vwap > 0);
  assert.ok(d.f.adx !== null && d.f.macdHist !== null);
  assert.throws(() => r.sc.detail("RELIANCE"), /not in the NIFTY 100 scanner/);
  assert.deepEqual(Object.keys(S.RULES).sort(), Object.keys(r.sc.view().rules).sort());
});

test("a stock flickering at a rule's edge counts as one call, not many", async () => {
  const r = rig();
  await fill(r);
  const before = r.sc.view().record.calls;
  // UPCO drops out (a stale read) and comes back a few seconds later, twice
  for (let i = 0; i < 2; i += 1) {
    r.sc.rows.set("UPCO", { ...r.sc.rows.get("UPCO"), eligible: false });
    r.step(3000);
    r.tickAll();
    r.sc.readAll();
  }
  assert.equal(r.sc.view().record.calls, before);
});
