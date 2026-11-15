"use strict";
// The tape reader (market/tape.js), the level learner (trading/levellearn.js, learn.js), the shared
// research (ai/shared.js) and the readers TradeAI's agent is handed (desk-readers.js).
// Everything runs on fakes: no broker, no network, no AI model, no timer.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { tapeRead, rsi, bollinger, fold } = require("../market/tape");
const { studyDay, summarize, holdOf, table, lessons, rate } = require("../trading/levellearn");
const { levelMap } = require("../trading/exitlevels");
const { LearnWatch, SECTION } = require("../learn");
const { SharedResearch, digest } = require("../ai/shared");
const { makeDeskReaders } = require("../desk-readers");
const { FlightDeck } = require("../flight");
const { FileDocs } = require("../docs");

const at = (date, hhmm, sec = 0) => Date.parse(`${date}T${hhmm}:00+05:30`) + sec * 1000;
const D = "2026-11-13"; // a Friday
/** A day: up to yesterday's high (102.6) and back, then through it, then flat above it. */
function dayBars(date = D) {
  const f = (i) => (i <= 30 ? 101 + (1.56 * i) / 30 : i <= 60 ? 102.56 - (1.36 * (i - 30)) / 30 : i <= 100 ? 101.2 + (2 * (i - 60)) / 40 : 103.2 + 0.05 * Math.sin(i / 9));
  const out = [];
  let prev = 101;
  for (let i = 0; i < 375; i += 1) {
    const c = f(i);
    out.push({ t: at(date, "09:15") + i * 60000, o: prev, h: Math.max(prev, c) + 0.03, l: Math.min(prev, c) - 0.03, c, v: i >= 26 && i <= 30 ? 9000 : 2000 });
    prev = c;
  }
  return out;
}
const DAILY = [
  { t: "2026-11-11", o: 99, h: 100.9, l: 98.4, c: 99.8 },
  { t: "2026-11-12", o: 99.9, h: 102.6, l: 99.2, c: 100.1 },
];

/* ------------------------------------------------------------------------------- the tape */

test("the tape: RSI, VWAP, the Bollinger bands, volume, momentum and price action from the day's 1-minute bars", () => {
  const bars = dayBars().filter((b) => b.t <= at(D, "11:40"));
  const t = tapeRead(bars, { now: at(D, "11:40", 30) });
  assert.equal(t.available, true);
  assert.equal(t.bars, 146);
  assert.deepEqual([t.session.open, t.session.high > 103.2, t.session.low < 101], [101, true, true]);
  assert.ok(t.session.openingRange.high > 101.7 && t.session.openingRange.low < 101);
  assert.equal(t.vwap.side, "above");
  assert.ok(t.vwap.price > 101.5 && t.vwap.price < 103);
  assert.ok(t.vwap.upper1 > t.vwap.price && t.vwap.lower1 < t.vwap.price);
  assert.ok(t.rsi.m1 > 0 && t.rsi.m1 <= 100 && t.rsi.m5 > 50, "it rose into the last hour");
  assert.ok(t.bollinger.upper > t.bollinger.mid && t.bollinger.mid > t.bollinger.lower);
  assert.ok(t.bollinger.pctB > 0.4, "near the upper band after the run");
  assert.equal(typeof t.bollinger.squeeze, "boolean");
  assert.equal(t.volume.biggestMinute.volume, 9000);
  assert.ok(t.volume.biggestMinute.timesUsual > 3);
  assert.equal(t.volume.rel5 < 1.1, true);
  assert.ok(t.momentum.m30Pct !== null);
  assert.match(t.priceAction.structure, /highs|range|sideways/);
  assert.ok(t.priceAction.swingHigh && t.priceAction.swingLow);
  assert.ok(t.notes.some((n) => /^Above VWAP/.test(n)) && t.notes.some((n) => /Bollinger/.test(n)));
  // too little to read says so
  assert.equal(tapeRead(bars.slice(0, 3), { now: at(D, "09:18") }).available, false);
  // the pieces
  assert.equal(rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]), 100);
  assert.equal(rsi([1, 2, 3]), null);
  const b = bollinger(Array.from({ length: 20 }, (_, i) => 100 + (i % 2)));
  assert.deepEqual([b.mid, Math.round(b.upper * 100) / 100, Math.round(b.lower * 100) / 100], [100.5, 101.5, 99.5]);
  assert.equal(fold(bars, 5).length, 30);
});

/* -------------------------------------------------------------------------- the level learner */

test("the level learner: every test of a level is written down with what followed — nothing looks ahead", () => {
  const s = studyDay(dayBars(), DAILY, { date: D, frames: [[at(D, "09:44", 30), 102.5, 102.45, 102.55, 30, -40]] });
  assert.equal(s.date, D);
  assert.equal(s.bars, 375);
  assert.ok(s.unit >= 0.25 && s.unit <= 0.85);
  const ph = s.touches.filter((t) => t.source === "prev-high");
  assert.equal(ph.length, 2, "yesterday's high was tested twice");
  // the first test: from below, in the first 45 minutes, on high volume, with sellers holding the book — and it held
  assert.deepEqual([ph[0].price, ph[0].from, ph[0].outcome, ph[0].bucket, ph[0].vol, ph[0].book], [102.6, "below", "held", "open", "high", "defended"]);
  assert.match(ph[0].clock, /^09:4[3-5]$/);
  // the second: later in the morning, and it broke
  assert.deepEqual([ph[1].from, ph[1].outcome, ph[1].bucket, ph[1].book], ["below", "broke", "morning", null]);
  assert.equal(s.counts["s|prev-high|held"], 1);
  assert.equal(s.counts["s|prev-high|broke"], 1);
  assert.equal(s.counts["t|prev-high|open|held"], 1);
  assert.equal(s.counts["k|defended|held"], 1);
  assert.ok(s.touches.some((t) => t.source === "round") && s.touches.some((t) => t.source === "pivot"));
  assert.ok(!s.touches.some((t) => t.source === "opening-range" && t.clock < "09:35"), "the opening range is a level only once it exists");
  assert.equal(studyDay(dayBars().slice(0, 30), DAILY, { date: D }), null, "too few bars to study");
});

test("the days added up: how often each kind of level held, for the stock and for all — and the findings in plain words", () => {
  const one = studyDay(dayBars(), DAILY, { date: D });
  const days = Array.from({ length: 10 }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, "0")}`, symbols: { SBIN: { counts: one.counts }, INFY: { counts: one.counts } } }));
  const sum = summarize(days);
  assert.deepEqual([sum.days, sum.from, sum.to, sum.symbols], [10, "2026-11-01", "2026-11-10", 2]);
  assert.deepEqual(rate(sum.all, "s|prev-high"), { held: 20, broke: 20, n: 40, pct: 50 });
  const h = holdOf(sum, "SBIN", ["prev-high", "wall", "ladder"], { at: at(D, "09:50") });
  assert.deepEqual([h.source, h.pct, h.n, h.scope], ["prev-high", 50, 20, "this stock"]);
  assert.deepEqual(h.hour, { name: "the first 45 minutes", pct: 100, n: 20 });
  assert.equal(holdOf(sum, "TCS", ["prev-high"]).scope, "all stocks", "a stock without its own record reads the desk's");
  assert.equal(holdOf(sum, "SBIN", ["wall", "ladder", "entry"]), null, "a kind of level the learner does not study has no record");
  assert.equal(holdOf(summarize([days[0]]), "SBIN", ["prev-high"]), null, "too few tests: no record is quoted");
  const rows = table(sum, "SBIN");
  assert.ok(rows[0].n >= rows[1].n, "the most tested first");
  assert.deepEqual(rows.find((r) => r.source === "prev-high").own, { n: 20, pct: 50 });
  const text = lessons(sum, { aiLevels: "The AI's exit levels on this desk: 7 of 12." });
  assert.match(text[0], /^Measured by the desk on 10 trading days \(2026-11-01 to 2026-11-10\), 2 stocks, \d+ tests of a level\./);
  assert.ok(text.some((l) => /^The previous day's high held on 50% of 40 tests\.$/.test(l)));
  assert.ok(text.some((l) => /The previous day's high holds more often the first 45 minutes \(100% of 20\) than 10:00–11:30 \(0% of 20\)\./.test(l)));
  assert.equal(text[text.length - 1], "The AI's exit levels on this desk: 7 of 12.");
  assert.deepEqual(lessons(summarize([]), {}), []);
});

function learnBoot({ time = "15:45", mode = "kite", failing = false } = {}) {
  const docs = new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-learn-")));
  const clock = { ms: at(D, time) };
  const asked = [];
  const written = [];
  const market = {
    mode: () => mode,
    watchlist: () => ["SBIN", "INFY"],
    minuteBarsBetween: async (sym, from) => {
      const date = new Date(from + 5.5 * 3600000).toISOString().slice(0, 10);
      asked.push(`${sym} ${date}`);
      if (failing) throw new Error("not connected");
      return dayBars(date);
    },
    daily: async () => ({ candles: [{ t: "2026-11-05", o: 99, h: 100.9, l: 98.4, c: 99.8 }, { t: "2026-11-06", o: 99.9, h: 102.6, l: 99.2, c: 100.1 }] }),
  };
  const playbook = { setSection: (head, body) => written.push({ head, body }) };
  const flight = { day: () => ({ available: false }), levelsRecord: () => ({ judged: 12, text: "First target reached before the stop on 7 of 12 sets (58%); the stop came first on 3." }) };
  const w = new LearnWatch({ market, docs, flight, playbook, now: () => clock.ms, log: { log() {}, error() {} } });
  return { w, docs, clock, asked, written };
}

test("after the close the desk studies the day by itself, catches up on the days it has not seen, and writes what it found into the skills file", async () => {
  const { w, docs, clock, asked, written } = learnBoot();
  assert.equal(w.view().available, false);
  assert.match(w.view().reason, /Nothing has been studied yet/);
  await w.tick();
  // today and the three trading days before it, both watchlist stocks each
  assert.deepEqual([...new Set(asked.map((a) => a.split(" ")[1]))], ["2026-11-13", "2026-11-12", "2026-11-11", "2026-11-10"]);
  assert.equal(asked.length, 8);
  const st = w.status();
  assert.deepEqual([st.days, st.stocks, st.studied, st.lastRun.by], [4, 2, 4, "itself"]);
  assert.ok(st.tests > 20);
  assert.ok(docs.read("learn/levels/2026-11-13.json", null).symbols.SBIN.counts["s|prev-high|held"] >= 1);
  assert.equal(docs.read("learn/levels-summary.json", null).days, 4);
  // the skills file: one section, replaced each time, with the AI's own record in it
  assert.equal(written.length, 1);
  assert.equal(written[0].head, SECTION);
  assert.match(written[0].body, /^- Measured by the desk on 4 trading days/);
  assert.match(written[0].body, /- The AI's exit levels on this desk: First target reached before the stop on 7 of 12 sets/);
  // what it learned is there for the level map and for TradeAI
  const h = w.holdOf("SBIN", ["prev-high"], { at: at(D, "09:50") });
  assert.deepEqual([h.pct, h.n, h.scope], [50, 8, "this stock"]);
  const v = w.view("SBIN");
  assert.deepEqual([v.available, v.days, v.symbol], [true, 4, "SBIN"]);
  assert.ok(v.levels.length >= 4 && v.findings.length >= 3);
  assert.equal(v.aiLevels.judged, 12);
  // ten minutes later: three more earlier days; once nothing is due it rests
  clock.ms += 11 * 60000;
  await w.tick();
  assert.equal(w.status().days, 7);
  clock.ms += 5 * 60000;
  await w.tick();
  assert.equal(w.status().days, 7, "not before ten minutes have passed");
  // Study now studies today again
  const again = await w.run({ force: true });
  assert.equal(again.by, "asked");
  assert.equal(again.studied[0].date, D);
});

test("the learner waits for the close and for Zerodha; a day whose bars could not be read is tried again", async () => {
  const early = learnBoot({ time: "14:00" });
  await early.w.tick();
  assert.equal(early.asked.length, 0, "the session is not over");
  const off = learnBoot({ mode: "demo" });
  await off.w.tick();
  assert.equal(off.asked.length, 0, "the bars need the Zerodha connection");
  const bad = learnBoot({ failing: true });
  const r = await bad.w.run();
  assert.ok(r.studied.every((x) => x.failed && x.symbols === 0));
  assert.equal(bad.w.status().studied, 0, "nothing is marked as done");
  assert.equal(bad.written.length, 0);
});

/* ---------------------------------------------------------------------------- the level map */

test("the level map carries the learner's record on each level, and the 5-minute Bollinger bands are levels too", () => {
  const bars = dayBars().filter((b) => b.t <= at(D, "11:40"));
  const m = levelMap({ side: "long", avg: 102, entryAt: at(D, "10:40") }, bars, {
    now: at(D, "11:40", 30),
    daily: DAILY,
    learned: (sources) => (sources.includes("prev-high") ? { pct: 61, n: 88, scope: "all stocks", name: "The previous day's high", hour: null } : null),
  });
  const ph = m.anchors.find((a) => /Previous day's high/.test(a.label));
  assert.deepEqual(ph.held, { pct: 61, n: 88, scope: "all stocks", name: "The previous day's high", hour: null });
  assert.ok(m.anchors.some((a) => /Bollinger band \(5-min\)/.test(a.label)));
  assert.equal(m.anchors.find((a) => /Today's low/.test(a.label)).held, null, "a kind of level without a record carries none");
});

/* ------------------------------------------------------------------------ the shared research */

test("the shared research: one finding per feature and stock, fresh for a time that fits it, marked when the price has moved", () => {
  const docs = new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-shared-")));
  const clock = { ms: at(D, "10:30") };
  const s = new SharedResearch({ docs, now: () => clock.ms });
  // whatever shape a feature's answer has, its summary, its call and its prices are found
  assert.deepEqual(digest({ decision: { action: "hold", confidence: "medium", stop: 799.5, target: 812 }, reason: "**VWAP** held twice." }), { summary: "VWAP held twice.", tags: { action: "hold", confidence: "medium" }, facts: { stop: 799.5, target: 812 } });
  assert.equal(digest({ thought: "nothing to share", calls: [] }).summary, "");
  // from the Engine: the stock and the price are read from the request when the caller does not say
  const a = s.capture("ensemble-live", { user: 'Data: {"symbol":"SBIN","last":806.2,"x":1}' }, { data: { headline: "SBIN leans up for the next 30 minutes.", lean: "up" }, servedBy: "claude-sonnet-5-5" });
  assert.deepEqual([a.feature, a.source, a.symbol, a.last, a.by, a.tags.lean], ["ensemble-live", "AI Live", "SBIN", 806.2, "claude-sonnet-5-5", "up"]);
  assert.equal(s.capture("exit", { user: "{}" }, { data: { reason: "Half the gain is gone." } }, { symbol: "SBIN", last: 805, by: "Claude Sonnet 5.5" }).source, "Exit advisor (Live board)");
  // not shared: a feature that is not about a stock, an answer with nothing to say, the levels the Live board checks itself
  assert.equal(s.capture("dayreview", { user: '{"symbol":"SBIN"}' }, { data: { summary: "A day." } }), null);
  assert.equal(s.capture("exit-levels", { user: '{"symbol":"SBIN"}' }, { data: { summary: "Unchecked levels." } }), null);
  assert.equal(s.capture("tradeai", { user: '{"symbol":"SBIN"}' }, { data: { answer: "The market." } }, { none: true }), null);
  assert.equal(s.capture("coach", { user: "no stock here" }, { data: { summary: "x" } }), null);
  assert.equal(s.publish({ feature: "exit-levels", symbol: "sbin", by: "Claude Sonnet 5.5", summary: "Target 1 ₹809.40, stop ₹803.10.", facts: { target1: 809.4, stop: 803.1 }, last: 806 }).symbol, "SBIN");
  assert.deepEqual(s.forSymbol("SBIN").map((f) => f.feature), ["exit-levels", "exit", "ensemble-live"], "newest first");
  // a newer finding of the same feature replaces the older one
  s.capture("ensemble-live", { user: '{"symbol":"SBIN","last":807}' }, { data: { headline: "SBIN still leans up." } });
  assert.equal(s.forSymbol("SBIN").filter((f) => f.feature === "ensemble-live").length, 1);
  assert.equal(s.forSymbol("SBIN")[0].summary, "SBIN still leans up.");
  // the owner's own positions stay with the owner
  assert.deepEqual(s.forSymbol("SBIN", { owner: false }).map((f) => f.feature), ["ensemble-live"]);
  // fresh for a time that fits the kind: an exit opinion for minutes, the checked levels for longer
  clock.ms += 15 * 60000;
  assert.deepEqual(s.forSymbol("SBIN").map((f) => f.feature).sort(), ["ensemble-live", "exit-levels"]);
  assert.equal(s.forSymbol("SBIN", { all: true }).find((f) => f.feature === "exit").fresh, false);
  assert.equal(s.latest("SBIN", "exit-levels", { last: 806.5 }).facts.target1, 809.4);
  assert.equal(s.latest("SBIN", "exit-levels", { last: 812 }), null, "the price has moved more than 0.6% away");
  assert.deepEqual([s.stats().fresh, s.stats().stocks], [2, 1]);
  // kept in the database: another instance reads the same findings
  assert.equal(new SharedResearch({ docs, now: () => clock.ms }).forSymbol("SBIN").length, 2);
});

/* ------------------------------------------------------------ the agent's readers and the deck */

function deck() {
  const docs = new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-desk-")));
  const clock = { ms: at(D, "11:40", 30) };
  const bars = () => dayBars().filter((b) => b.t <= clock.ms);
  const shared = new SharedResearch({ docs, now: () => clock.ms });
  const seen = [];
  const ai = {
    shared,
    modelChain: () => [{ name: "Claude Sonnet 5.5" }],
    exitAdvisor: {
      ready: () => true,
      research: async (snap) => {
        seen.push(snap);
        // the nearest level above that is worth the costs and within reach
        const up = snap.levelMap.filter((l) => l.id[0] === "A" && l.awayPct >= 0.15 && l.touchOddsPct >= 10).sort((x, y) => x.awayPct - y.awayPct)[0];
        return { targets: [{ anchor: up.id, price: up.price, why: "the next level above" }], stop: { anchor: "coach", price: snap.deskExitCoach.stop, why: "the coach's stop" }, reversal: null, outlook: "with", confidence: "medium", summary: "Take profit at the next level.", by: "Claude Sonnet 5.5", cached: false };
      },
    },
  };
  const trading = { status: () => ({ connected: true }), positions: async () => ({ net: [{ exchange: "NSE", symbol: "SBIN", product: "MIS", token: 779521, quantity: 100, average: 102, last: 103.2, pnl: 120 }] }), trades: async () => [], journal: { ingestKite() {}, trips: () => [{ open: true, symbol: "SBIN", exchange: "NSE", entryAt: at(D, "10:40") }] } };
  const market = {
    ticker: null,
    flow: { snapshot: () => ({ available: true, pressure: 35, label: "Buyers pressing", buyTotal: 6200, sellTotal: 3800, deltaRatio60Pct: 22, volume60: 9000, lean: { dir: "up", trained: true, hitRatePct: 58 }, wall: null, spread: 0.05 }) },
    _token: () => 779521,
    followBook: () => () => {},
    minuteBarsBetween: async (s, from, to) => bars().filter((b) => b.t >= from && b.t <= to),
    daily: async () => ({ candles: DAILY }),
    verdict: async () => ({ available: true, ladder: [{ label: "R2", price: 104.05, kind: "pivot" }, { label: "Last price", price: 103.2, kind: "price" }], day: { available: false } }),
    pulse: async () => ({ available: false }),
    context: async () => ({ available: false }),
    quotes: async (syms) => ({ quotes: Object.fromEntries(syms.map((s) => [s, { last: 103.2, changePct: 3.1, open: 101, high: 103.3, low: 100.97, volume: 310000, avgPrice: 102.3, bid: 103.15, ask: 103.2, buyQty: 62000, sellQty: 38000 }])) }),
  };
  const d = new FlightDeck({ trading, market, ai, docs, now: () => clock.ms, log: { log() {}, error() {} } });
  d.learn = { holdOf: (symbol, sources) => (sources.includes("prev-high") || sources.includes("round") ? { pct: 64, n: 22, scope: "this stock", name: "x", hour: null } : null), view: (sym) => ({ available: true, days: 21, symbol: sym }) };
  return { d, market, ai, shared, seen, clock };
}

test("the agent's readers: the exit coach's reading of the position, the tape with the order book, and the level map with each level's record", async () => {
  const { d, market } = deck();
  const desk = makeDeskReaders({ market, flight: d, analysis: null, learn: d.learn, now: d.now });
  const [p] = await desk.reading("SBIN");
  assert.deepEqual([p.symbol, p.side, p.qty, p.avg, p.enteredAt], ["SBIN", "long", 100, 102, "10:40"]);
  assert.ok(["HOLD", "TIGHTEN", "BOOK PART", "EXIT NOW"].includes(p.coach.word));
  assert.ok(p.coach.stop < 103.2 && p.coach.exit.price > 0 && Array.isArray(p.coach.whyStay));
  assert.deepEqual([p.numbers.last, p.numbers.pnl, p.numbers.orderBook.buyersPct, p.numbers.orderBook.label], [103.2, 120, 62, "Buyers pressing"]);
  assert.ok(p.levelsAhead.above.length >= 1 && p.levelsAhead.below.length >= 1);
  assert.match(p.recent[0], /^10:40 Bought 100 at ₹102\.00/);
  assert.equal(p.aiLevels, null, "no AI levels yet");
  assert.deepEqual(await desk.reading("INFY"), [], "no such position");
  assert.equal((await desk.reading()).length, 1, "no symbol: every open position");
  const t = await desk.tape("SBIN");
  assert.deepEqual([t.symbol, t.available, t.quote.bid, t.quote.ask, t.quote.buyersSharePct], ["SBIN", true, 103.15, 103.2, 62]);
  assert.deepEqual([t.orderBook.buyersPct, t.orderBook.next30seconds, t.orderBook.lastMinuteNetBuyingPct], [62, "up", 22]);
  assert.ok(t.rsi.m1 > 0 && t.bollinger && t.vwap.side === "above");
  const lv = await desk.levels("SBIN");
  assert.equal(lv.last, 103.2);
  assert.ok(lv.above.some((x) => /R2/.test(x.what)));
  assert.ok(!JSON.stringify(lv).includes("Last price"), "the ladder's own last-price rung is not a level");
  assert.match(lv.below.find((x) => /Previous day's high/.test(x.what)).held, /^64% of 22 tests \(this stock\)$/);
  // a stock with no position: the map is built from the market alone
  const other = await desk.levels("INFY");
  assert.ok(other.above.length + other.below.length >= 4);
  assert.deepEqual(desk.learned("SBIN"), { available: true, days: 21, symbol: "SBIN" });
  assert.equal(await desk.lab(), null, "no Execution Lab was handed in");
});

test("the Live board tells the AI each level's record and what the other features found — and shares only the levels that passed its check", async () => {
  const { d, shared, seen } = deck();
  shared.capture("ensemble-live", { user: '{"symbol":"SBIN","last":103.1}' }, { data: { headline: "SBIN leans up for the next 30 minutes.", lean: "up" }, servedBy: "Claude Sonnet 5.5" });
  await d.sync();
  const key = [...d.slots.keys()][0];
  const set = await d.researchLevels(key);
  const snap = seen[0];
  assert.ok(snap.levelMap.some((l) => l.heldPct === 64 && l.heldOfTests === 22), "the learner's record is on the level");
  assert.ok(snap.levelMap.some((l) => l.heldPct === undefined), "a level without a record carries none");
  assert.deepEqual(snap.otherAiFindings.map((f) => [f.from, f.summary]), [["AI Live", "SBIN leans up for the next 30 minutes."]]);
  assert.equal(set.failed, false);
  const f = shared.forSymbol("SBIN").find((x) => x.feature === "exit-levels");
  assert.equal(f.source, "Exit levels (Live board)");
  assert.equal(f.facts.target1, set.targets[0].level);
  assert.equal(f.facts.stop, set.stop.price);
  assert.match(f.summary, /^Long from ₹102\.00: target 1 ₹\d+\.\d\d .* Take profit at the next level\.$/);
  assert.match(f.detail.checked, /^2 of 2 choices passed the desk's check$/);
  assert.equal(d.board().positions[0].levels.targets[0].held.pct, 64);
});
