"use strict";
// The exit coach (trading/exitcoach.js), the flight deck (flight.js), the lab's best-exit timing
// (analysis/lab.js) and the comparison with the trader's own history (analysis/compare.js).
// Everything runs on fakes: no broker, no network, no AI model, no timer.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { coach, replay, newMemory } = require("../trading/exitcoach");
const { FlightDeck } = require("../flight");
const { labDay } = require("../analysis/lab");
const { compareDay } = require("../analysis/compare");
const { FileDocs } = require("../docs");

const D = "2026-11-13"; // a Friday
const at = (hhmm, sec = 0) => Date.parse(`${D}T${hhmm}:00+05:30`) + sec * 1000;
/** A day that climbs from 100 to 103 by 11:00 and slides to 101 by the close (1-minute bars). */
function dayBars(until = "15:29") {
  const out = [];
  for (let t = at("09:15"); t <= at(until); t += 60000) {
    const m = (t - at("09:15")) / 60000;
    const px = m <= 105 ? 100 + (3 * m) / 105 : 103 - (2 * (m - 105)) / 255;
    out.push({ t, o: px, h: px + 0.05, l: px - 0.05, c: px, v: 1000 });
  }
  return out;
}
const POS = { symbol: "SBIN", side: "long", qty: 100, avg: 100.43, entryAt: at("09:30"), product: "MIS" };

/* ---------------------------------------------------------------------------- the exit coach */

test("the coach holds a trade that is working, with a stop, a target and the reasons", () => {
  const a = coach(POS, dayBars("10:30"), { last: 102.1, bid: 102.05, ask: 102.15 }, { now: at("10:30", 30), levels: [{ label: "R1", price: 102.6 }, { label: "S1", price: 99.5 }] });
  assert.equal(a.state, "hold");
  assert.equal(a.word, "HOLD");
  assert.ok(a.pressure < 25);
  assert.ok(a.stop < 102.1 && a.stop > 100.43, "the stop has been trailed above the entry");
  assert.equal(a.stopKind, "trailing stop");
  assert.equal(a.target, 102.6, "the next level above is the target");
  assert.match(a.headline, /^HOLD — stop ₹\d+\.\d\d, next target ₹102\.60/);
  assert.ok(a.reasons.hold.some((r) => /VWAP/.test(r)));
  assert.equal(a.metrics.peak.clock, "10:30");
  assert.ok(a.metrics.pnl > 160 && a.metrics.pnl < 170);
});

test("giving the gain back raises the pressure; a hit trailing stop is EXIT NOW at the bid", () => {
  const bars = dayBars("11:40");
  let memory = newMemory(POS);
  // first look near the top: the peak and the trail are remembered
  memory = coach(POS, bars.filter((b) => b.t <= at("11:00")), { last: 103 }, { now: at("11:00", 30), memory }).memory;
  const a = coach(POS, bars, { last: 102.72, bid: 102.7, ask: 102.75 }, { now: at("11:40", 30), memory });
  assert.equal(a.state, "exit-now");
  assert.equal(a.pressure, 100);
  assert.match(a.reasons.exit[0], /trailing stop at ₹102\.\d\d is hit/);
  assert.equal(a.exit.price, 102.7, "what a market order would get: the bid");
  assert.equal(a.exit.qty, 100);
  assert.match(a.headline, /^EXIT NOW — about ₹102\.70/);
});

test("the book, the pulse, the tide and the news each add to the pressure; a short is read the other way", () => {
  const bars = dayBars("10:00");
  const base = coach(POS, bars, { last: 101.2, bid: 101.15, ask: 101.25 }, { now: at("10:00", 30) });
  const flow = { available: true, pressure: -65, buyTotal: 3000, sellTotal: 9000, deltaRatio60Pct: -50, volume60: 4000, delta60: -2000, lean: { dir: "down", trained: true, hitRatePct: 61 }, wall: { side: "ask", price: 101.4, qty: 25000, times: 5 }, label: "Sellers pressing", spread: 0.1 };
  const a = coach(POS, bars, { last: 101.2, bid: 101.15, ask: 101.25 }, { now: at("10:00", 30), flow, pulse: { score: -40, lean: "down", window: { low: 100.6, high: 101.8 } }, tide: { score: -55 }, news: { high: 1, sentiment: -0.8, title: "SBI faces a regulatory probe", at: new Date(at("09:50")).toISOString() } });
  assert.ok(a.pressure >= base.pressure + 40, `${a.pressure} vs ${base.pressure}`);
  assert.ok(a.reasons.exit.some((r) => /order book is against you/.test(r)));
  assert.ok(a.reasons.exit.some((r) => /pulse for the next 15–30 minutes leans DOWN/.test(r)));
  assert.ok(a.reasons.exit.some((r) => /High-impact news against/.test(r)));
  assert.ok(a.reasons.exit.some((r) => /wall of 25,000 shares waits at ₹101\.40/.test(r)));
  assert.ok(["book-part", "exit-now"].includes(a.state));
  assert.equal(a.metrics.book.buyersPct, 25);
  // the same tape for a short is a trade that is going against it
  const short = coach({ ...POS, side: "short" }, bars, { last: 101.2, bid: 101.15, ask: 101.25 }, { now: at("10:00", 30) });
  assert.ok(short.metrics.pnl < 0);
  assert.equal(short.exit.price === 101.25 || short.state !== "exit-now", true, "a short exits at the offer");
});

test("five minutes before the square-off the coach says EXIT NOW whatever the tape says", () => {
  const a = coach({ ...POS, entryAt: at("14:30"), avg: 101.2 }, dayBars("15:11"), { last: 101.05 }, { now: at("15:11") });
  assert.equal(a.state, "exit-now");
  assert.match(a.reasons.exit[0], /minutes to the 3:15 PM square-off/);
});

test("a finished trade replayed: the coach's signals minute by minute and where it would have left", () => {
  const r = replay({ symbol: "SBIN", side: "long", qty: 100, entryAvg: 100.43, entryAt: at("09:30") }, dayBars());
  assert.ok(r.exit, "it left before 3:15");
  assert.equal(r.exit.clock, "11:21");
  assert.ok(r.exit.price > 102.7, "close to the top of the day, not the close at 101");
  assert.ok(r.exit.pnl > 230);
  assert.equal(r.changes[r.changes.length - 1].state, "exit-now");
});

/* ------------------------------------------------------------------ the lab's exit timing */

test("the lab gives the best moment to have left, with its time — the least loss when the trade never paid", () => {
  const trip = (key, side, inAt, outAt, e, x) => ({ key, symbol: "SBIN", side, entryAt: at(inAt), exitAt: at(outAt), entryAvg: e, exitAvg: x, maxQty: 100, pnl: (side === "long" ? x - e : e - x) * 100, charges: 20, net: (side === "long" ? x - e : e - x) * 100 - 20, intraday: true });
  const lab = labDay({ date: D, trips: [trip("w", "long", "09:30", "12:00", 100.43, 102.53), trip("l", "short", "09:40", "10:10", 100.6, 101.57)], bars: { SBIN: dayBars() } });
  const w = lab.trades.find((t) => t.key === "w").read;
  assert.equal(w.bestExit.clock, "11:00");
  assert.equal(w.bestExit.kind, "profit");
  assert.ok(w.bestExit.pnl > 255);
  assert.equal(w.timing.gapMin, 60, "you stayed an hour past the best moment");
  assert.ok(w.timing.leftOnTable > 40);
  assert.ok(w.timing.efficiency > 70 && w.timing.efficiency < 90);
  assert.equal(w.coach.exit.clock, "11:21");
  assert.equal(w.coach.exit.said, true);
  assert.ok(w.coach.vsYours > 0, "the coach's exit beat yours");
  assert.ok(w.path.length > 100);
  const l = lab.trades.find((t) => t.key === "l").read;
  assert.equal(l.bestExit.kind, "least-loss", "a short into a rising day never paid");
  assert.equal(l.bestExit.clock, "09:40");
  assert.ok(l.bestExit.pnl <= 0 && l.bestExit.pnl > -20, "the least loss was right at the entry");
  assert.equal(l.worst.clock, "10:10");
  // the day: hindsight's ceiling, the share taken, and the coach on the same entries
  assert.ok(lab.summary.bestPossible > 255);
  assert.ok(num(lab.summary.efficiency));
  assert.ok(lab.rules.some((r) => r.id === "coach" && r.trades === 2));
  assert.ok(num(lab.summary.coachVsYours));
});
function num(x) {
  return typeof x === "number" && Number.isFinite(x);
}

/* --------------------------------------------------------------------------- the flight deck */

function deck({ positions, ai = null, connected = true } = {}) {
  const docs = new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-flight-")));
  const clock = { ms: at("10:30", 30) };
  const state = { positions: positions || [{ exchange: "NSE", symbol: "SBIN", product: "MIS", token: 779521, quantity: 100, average: 100.43, last: 102.1, pnl: 167, sellPrice: 0, buyPrice: 100.43 }] };
  const sent = [];
  const released = [];
  const trading = {
    status: () => ({ connected }),
    positions: async () => ({ net: state.positions, day: [] }),
    trades: async () => [],
    journal: { ingestKite() {}, trips: () => [{ open: true, symbol: "SBIN", exchange: "NSE", entryAt: at("09:30") }] },
  };
  const market = {
    ticker: null,
    flow: { snapshot: () => null },
    followBook: (token) => () => released.push(token),
    minuteBarsBetween: async (s, from, to) => dayBars().filter((b) => b.t >= from && b.t <= to),
    verdict: async () => ({ available: true, ladder: [{ label: "R1", price: 102.6, kind: "pivot" }, { label: "Upper circuit", price: 110, kind: "circuit" }], day: { available: true, state: "long", side: "long", headline: "LONG — in play", score: 70 } }),
    pulse: async () => ({ available: true, score: 35, lean: "up", call: "long", headline: "Leans up", window: { low: 101.5, high: 102.9 } }),
    context: async () => ({ available: true, tide: { score: 40, label: "Rising", summary: "Rising tide" } }),
    marketForecast: async () => ({ available: true, lean: { score: 20, word: "up", firm: false }, headline: "NSE leans up" }),
    quotes: async (syms) => ({ quotes: Object.fromEntries(syms.map((s) => [s, { last: 102.1 }])) }),
    social: { forSymbol: () => null, signal: () => ({ mood: { label: "Positive", score: 30 }, items: 12 }) },
  };
  const d = new FlightDeck({ trading, market, ai, docs, notifier: { send: async (text, kind) => sent.push({ text, kind }) }, goal: () => "ok", now: () => clock.ms, log: { log() {}, error() {} } });
  return { d, docs, clock, state, sent, released, market };
}

test("a position that opens is put on the board at once, coached, and recorded", async () => {
  const { d } = deck();
  const heard = [];
  d.on("pos", (v) => heard.push(v));
  const b = await d.sync();
  assert.equal(b.positions.length, 1);
  const p = b.positions[0];
  assert.equal(p.symbol, "SBIN");
  assert.equal(p.entryClock, "09:30", "the entry time is the journal's first fill, not the moment it was seen");
  assert.equal(p.advice.state, "hold");
  assert.equal(p.advice.target, 102.6);
  assert.ok(p.path.length > 30, "the price path for the chart");
  assert.equal(p.events[0].kind, "entry");
  assert.ok(heard.length >= 1);
  assert.equal(b.market.goal, "ok");
  assert.equal(b.settings.aiMode, "change");
});

test("every tick is a look (at most four a second); a change to EXIT NOW is recorded, pushed and sent to the phone once", async () => {
  const { d, clock, sent } = deck();
  await d.sync();
  const slot = [...d.slots.values()][0];
  // the price runs to the top…
  clock.ms = at("11:00", 30);
  await d._context(slot);
  assert.ok(d._look(slot, { last: 103, bid: 102.95, ask: 103.05 }, { force: true }));
  clock.ms += 100;
  assert.equal(d._look(slot, { last: 103.02 }), null, "inside a quarter of a second: no second look");
  // …and falls through the trailing stop
  clock.ms = at("11:40", 30);
  await d._context(slot);
  const heard = [];
  d.on("pos", (v) => heard.push(v));
  const v = d._look(slot, { last: 102.72, bid: 102.7, ask: 102.75 }, { force: true });
  assert.equal(v.advice.state, "exit-now");
  assert.equal(heard.length, 1);
  await new Promise((r) => setImmediate(r)); // the message leaves on the next turn of the loop
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, "risk");
  assert.match(sent[0].text, /EXIT NOW — SBIN long 100/);
  assert.match(sent[0].text, /nothing was traded/);
  const ev = slot.flight.events.filter((e) => e.kind === "signal");
  assert.equal(ev[ev.length - 1].state, "exit-now");
  clock.ms += 5000;
  d._look(slot, { last: 102.6, bid: 102.55, ask: 102.65 }, { force: true });
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.length, 1, "not sent again while it stays EXIT NOW");
  assert.ok(slot.flight.snaps.length >= 2, "the CCTV keeps a frame every 15 seconds");
});

test("closing the position lands the flight: the exit is recorded and the day is saved in the database", async () => {
  const { d, state, clock, docs, released } = deck();
  await d.sync();
  clock.ms = at("11:05");
  state.positions = [{ exchange: "NSE", symbol: "SBIN", product: "MIS", token: 779521, quantity: 0, average: 0, last: 102.9, pnl: 247, sellPrice: 102.9, buyPrice: 100.43 }];
  const b = await d.sync();
  assert.equal(b.positions.length, 0);
  assert.equal(b.landed.length, 1);
  assert.equal(b.landed[0].exitAvg, 102.9);
  assert.equal(b.landed[0].pnl, 247);
  assert.equal(b.landed[0].exitClock, "11:05");
  assert.deepEqual(released, [779521], "the order book is let go");
  const saved = docs.read(`flight/${D}.json`, null);
  assert.equal(Object.values(saved.flights).length, 1);
  const f = Object.values(saved.flights)[0];
  assert.equal(f.events[f.events.length - 1].kind, "exit");
  assert.deepEqual(d.days(), [D]);
  assert.equal(d.day(D).flights.length, 1);
  assert.equal(d.day("2026-11-12").available, false);
  // a restart on the same day carries on from the record
  const again = new FlightDeck({ trading: d.trading, market: d.market, docs, now: () => clock.ms, log: { log() {}, error() {} } });
  assert.equal(again.board().landed.length, 1);
});

test("the AI Engine's second opinion: sparingly — on request every 30 seconds, by itself every five minutes, within the daily limit", async () => {
  let asked = 0;
  const ai = { modelChain: () => [{ name: "Claude Sonnet 5.5" }], exitAdvisor: { ready: () => true, advise: async (snap) => {
    asked += 1;
    assert.equal(snap.position.symbol, "SBIN");
    assert.ok(snap.deskExitCoach.signal);
    assert.equal(snap.tape.last20OneMinuteBars.rows.length, 20);
    return { action: "tighten", exitPrice: 102.05, stop: 101.6, confidence: "medium", reason: "Up 1.66% and near R1 at 102.60.", watch: "A close under VWAP.", by: "Claude Sonnet 5.5", cached: false };
  } } };
  const { d, clock } = deck({ ai });
  await d.sync();
  const key = [...d.slots.keys()][0];
  const op = await d.askAi(key);
  assert.equal(op.action, "tighten");
  assert.equal(op.deskSaid, "hold");
  assert.equal(op.agrees, false);
  assert.equal(d.settings().aiToday, 1);
  await assert.rejects(d.askAi(key), /a moment ago/);
  assert.equal(await d.askAi(key, { auto: true }), op, "by itself: the opinion of the last five minutes stands");
  clock.ms += 31000;
  await d.askAi(key);
  assert.equal(asked, 2);
  d.setSettings({ aiDailyCap: 2 });
  clock.ms += 31000;
  await assert.rejects(d.askAi(key), /AI opinions are used up/);
  assert.equal(d.board().positions[0].ai.action, "tighten");
  // without a key the board still works and says what is missing
  const none = deck();
  await none.d.sync();
  await assert.rejects(none.d.askAi([...none.d.slots.keys()][0]), /No AI key is saved/);
  assert.throws(() => d.setSettings({ aiMode: "always" }), /change, ask or off/);
});

test("not connected to Zerodha: an empty board that says so; derivatives are listed but not coached", async () => {
  const off = deck({ connected: false });
  const b = await off.d.sync();
  assert.equal(b.connected, false);
  assert.equal(b.positions.length, 0);
  assert.match(b.watch.error, /not connected/);
  const fo = deck({ positions: [{ exchange: "NFO", symbol: "NIFTY26NOVFUT", product: "NRML", token: 1, quantity: 75, average: 25200, last: 25250, pnl: 3750 }] });
  const b2 = await fo.d.sync();
  assert.equal(b2.positions.length, 0);
  assert.equal(b2.other.length, 1);
});

/* ------------------------------------------------------------------ the comparison */

test("today against your own history: what to prevent (with what it cost and a rule), what to keep, and the days and trades like it", () => {
  const bars = dayBars();
  const trip = (key, side, inAt, outAt, e, x, day = D) => {
    const shift = Date.parse(`${day}T00:00:00Z`) - Date.parse(`${D}T00:00:00Z`);
    return { key, symbol: "SBIN", side, entryAt: at(inAt) + shift, exitAt: at(outAt) + shift, entryAvg: e, exitAvg: x, maxQty: 100, pnl: (side === "long" ? x - e : e - x) * 100, charges: 5, net: (side === "long" ? x - e : e - x) * 100 - 5, intraday: true };
  };
  const barsOn = (day) => {
    const shift = Date.parse(`${day}T00:00:00Z`) - Date.parse(`${D}T00:00:00Z`);
    return bars.map((b) => ({ ...b, t: b.t + shift }));
  };
  // four earlier days: a good long with VWAP, then a short against the rise and a quick re-entry (a revenge trade that happened to pay)
  const history = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"].map((day) =>
    labDay({ date: day, trips: [trip("a", "long", "09:45", "10:30", 100.86, 102.1, day), trip("b", "short", "10:35", "10:50", 102.29, 102.7, day), trip("c", "long", "10:55", "11:00", 102.86, 103.0, day)], bars: { SBIN: barsOn(day) } })
  );
  const today = labDay({ date: D, trips: [trip("a", "long", "09:45", "10:30", 100.86, 102.1), trip("b", "short", "10:35", "10:50", 102.29, 102.7), trip("c", "long", "10:55", "11:00", 102.86, 103.0)], bars: { SBIN: bars } });
  const c = compareDay(today, history);
  assert.equal(c.enough, true);
  assert.equal(c.baseline.days, 4);
  assert.equal(c.versus.find((v) => v.id === "score").usual, c.today.score, "the same day five times: today equals the usual");
  assert.equal(c.versus.find((v) => v.id === "score").better, null, "no real gap: neither better nor worse");
  const rev = c.prevent.find((p) => p.id === "revenge");
  assert.ok(rev, "the revenge trade is first to prevent");
  assert.equal(rev.kind, "again");
  assert.equal(rev.today.count, 1);
  assert.equal(rev.history.count, 4);
  assert.equal(rev.history.days, 4);
  assert.match(rev.evidence, /4 times on 4 of your last 4 trading days/);
  assert.match(rev.action, /wait 15 minutes/);
  assert.ok(c.keep.some((k) => /Entering with VWAP/.test(k.text)), "what works is named too");
  assert.equal(c.similarDays.length, 3);
  assert.match(c.similarDays[0].text, /3 trades/);
  assert.ok(c.similarTrades.length >= 1);
  assert.match(c.similarTrades[0].text, /earlier trades, \d+ won/);
  assert.match(c.headline, /net against your usual/);
  // too little history: it says so instead of judging
  const thin = compareDay(today, history.slice(0, 1));
  assert.equal(thin.enough, false);
  assert.match(thin.headline, /needs at least three earlier days/);
  assert.ok(thin.versus.every((v) => v.better === null));
});

test("the word is steady: it steps up at once, steps down only after a minute and only when the pressure is clearly lower", () => {
  const bars = dayBars("10:00");
  const flow = (p) => ({ available: true, pressure: p, buyTotal: 5000, sellTotal: 5000, deltaRatio60Pct: 0, volume60: 0, delta60: 0, lean: { dir: "none", trained: false }, wall: null, label: "", spread: 0.05 });
  const look = (now, memory, extra) => coach(POS, bars, { last: 101.2, bid: 101.15, ask: 101.25 }, { now, memory, ...extra });
  // pulse against (10) + the book against (14) + the tide (5) = 29: TIGHTEN
  const a = look(at("10:00", 30), undefined, { flow: flow(-65), pulse: { score: -40 }, tide: { score: -50 } });
  assert.equal(a.state, "tighten");
  // ten seconds later the book eases (pressure 19): it does not flip back at once…
  const b = look(at("10:00", 40), a.memory, { flow: flow(-35), pulse: { score: -40 }, tide: { score: 0 } });
  assert.equal(b.pressure, 20);
  assert.equal(b.state, "tighten");
  // …nor after a minute while the pressure sits just under the line (20 is within 8 of 25)
  const c = look(at("10:02"), b.memory, { flow: flow(-35), pulse: { score: -40 }, tide: { score: 0 } });
  assert.equal(c.state, "tighten");
  // clearly calmer, and a minute has passed: HOLD again
  const d = look(at("10:03"), c.memory, { flow: flow(0), pulse: { score: 0 } });
  assert.equal(d.state, "hold");
});

/* ------------------------------------------------------- the AI's exit levels, and their check */

const { levelMap, verify, track, settle, record, touchOdds } = require("../trading/exitlevels");

function mapAt(hhmm = "10:30", last = 102.1) {
  return levelMap(POS, dayBars(hhmm), {
    now: at(hhmm, 30),
    last,
    daily: [
      { t: "2026-11-11", o: 99, h: 100.9, l: 98.4, c: 99.8 },
      { t: "2026-11-12", o: 99.9, h: 102.6, l: 99.2, c: 100.1 },
    ],
    ladder: [{ label: "R1", price: 102.6 }],
    vwap: 101.2,
    wall: { side: "ask", price: 102.9, qty: 42000 }, // the order-flow engine names the sides bid and ask
    pulse: { window: { low: 101.5, high: 102.9 } },
    peak: 102.19,
  });
}

test("the level map: every level is a real price from the desk's data, merged where they sit together, numbered above and below", () => {
  const m = mapAt();
  assert.equal(m.last, 102.1);
  assert.equal(m.minutesLeft, 285, "to the 3:15 PM square-off");
  assert.ok(m.sigma1 > 0);
  const ids = m.anchors.map((a) => a.id);
  assert.ok(ids.includes("A1") && ids.includes("B1"));
  assert.ok(m.anchors.every((a) => (a.id[0] === "A") === a.price > m.last), "A is above the price, B below it");
  assert.deepEqual(m.anchors.map((a) => a.price), m.anchors.map((a) => a.price).slice().sort((x, y) => y - x), "listed from the highest down");
  assert.ok(m.anchors.every((a) => Math.abs(Math.round(a.price / 0.05) * 0.05 - a.price) < 1e-6), "on the tick");
  const r1 = m.anchors.find((a) => /R1/.test(a.label));
  assert.equal(r1.price, 102.6);
  assert.match(r1.label, /Previous day's high/, "yesterday's high and the desk's R1 are one level");
  assert.ok(r1.strength >= 5, "several kinds of evidence at one price");
  assert.ok(r1.touchPct > 25 && r1.touchPct < 100);
  const wall = m.anchors.find((a) => /Wall of sell orders/.test(a.label));
  assert.equal(wall.price, 102.9);
  assert.match(wall.label, /pulse/, "the wall sits at the top of the pulse's window");
  assert.ok(m.anchors.some((a) => a.label === "VWAP" && a.side === "below"));
  assert.ok(m.anchors.some((a) => /Your entry/.test(a.label)));
  assert.ok(!m.anchors.some((a) => Math.abs(a.price - m.last) / m.last > 0.03), "nothing further than 3% away");
  // the yardstick: nearer is likelier, and no time left means no reach
  assert.ok(touchOdds(0.2, 0.06, 285) > touchOdds(1.5, 0.06, 285));
  assert.equal(touchOdds(1, 0.06, 0), null);
});

test("the check on the AI's answer: only levels from the map, at the desk's price, on the right side, worth the costs, within reach — the rest is left out with the reason", () => {
  const m = mapAt();
  const id = (re) => m.anchors.find((a) => re.test(a.label)).id;
  const px = (re) => m.anchors.find((a) => re.test(a.label)).price;
  const answer = {
    targets: [
      { anchor: id(/Today's high/), price: px(/Today's high/), why: "the high" }, // 0.1% away: inside the costs
      { anchor: id(/R1/), price: 102.63, why: "R1 and yesterday's high" }, // three paise off: the desk's price is used
      { anchor: id(/Wall/), price: 105.4, why: "made up" }, // a number that is not the level's
      { anchor: "A9", price: 104, why: "not on the map" },
    ],
    stop: { anchor: id(/VWAP/), price: px(/VWAP/), why: "VWAP lost" },
    reversal: { anchor: id(/R1/), sign: "sellers above 60% of the book" },
  };
  const v = verify(answer, m, POS, { last: 102.1, coachStop: 101.9, unit: 0.25 });
  assert.equal(v.targets.length, 1);
  const t = v.targets[0];
  assert.equal(t.n, 1);
  assert.equal(t.level, 102.6, "the desk's price, whatever the model wrote");
  assert.ok(t.price < 102.6 && t.price >= 102.5, "the limit sits a touch before the level");
  assert.equal(t.r, 2.5, "reward against the risk to the stop, worked out by the desk");
  assert.equal(t.firstPct, 29, "no trend: the odds the target comes before the stop");
  assert.equal(t.reach, "within reach");
  assert.equal(t.status, "open");
  assert.equal(v.rejected.length, 3);
  assert.match(v.rejected.map((r) => r.why).join(" | "), /closer than the costs.*quoted ₹105\.40.*“A9” is not a level on the desk's map/);
  assert.equal(v.stop.price, 101.9, "never further than the coach's stop");
  assert.equal(v.stop.clamped, true);
  assert.match(v.stop.note, /only ever moved towards the price/);
  assert.equal(v.reversal.price, 102.6);
  assert.equal(v.checks.asked, 5);
  assert.equal(v.checks.passed, 1);
  assert.equal(v.checks.corrected, 0);
  // a level behind the price is no target; with no stop named, the coach's stop stands
  const behind = verify({ targets: [{ anchor: id(/VWAP/), price: px(/VWAP/), why: "" }], stop: null, reversal: null }, m, POS, { last: 102.1, coachStop: 101.9, unit: 0.25 });
  assert.equal(behind.targets.length, 0);
  assert.match(behind.rejected.map((r) => r.why).join(" | "), /No level from the desk's map was named.*VWAP ₹101\.20 is not ahead of the price/);
  assert.equal(behind.stop.anchor, "coach");
  assert.match(behind.stop.note, /the coach's stop stands/);
  // a level out of reach before the square-off is left out; a stop of its own, nearer than the coach's, is kept just beyond the level
  const late = levelMap(POS, dayBars("15:00"), { now: at("15:00", 30), last: 101.1, ladder: [{ label: "R2", price: 103.4 }, { label: "S1", price: 100.95 }] });
  const far = verify({ targets: [{ anchor: late.anchors.find((a) => /R2/.test(a.label)).id, price: 103.4, why: "" }], stop: { anchor: late.anchors.find((a) => /S1/.test(a.label)).id, price: 100.95, why: "" }, reversal: { anchor: "", sign: "" } }, late, POS, { last: 101.1, coachStop: 100.5, unit: 0.25 });
  assert.equal(far.targets.length, 0);
  assert.match(far.rejected[0].why, /out of reach before 3:15 PM/);
  assert.equal(far.stop.clamped, false);
  assert.equal(far.stop.level, 100.95);
  assert.equal(far.stop.price, 100.85, "two ticks beyond the level");
  // "coach" keeps the coach's stop; a short is read the other way round
  const sh = verify({ targets: [{ anchor: id(/Bottom of the pulse/), price: px(/Bottom of the pulse/), why: "" }], stop: { anchor: "coach", price: 102.4, why: "" }, reversal: null }, m, { ...POS, side: "short", avg: 102.5 }, { last: 102.1, coachStop: 102.4, unit: 0.25 });
  assert.equal(sh.targets[0].level, 101.5);
  assert.ok(sh.targets[0].price > sh.targets[0].level, "a short's limit sits just above the level");
  assert.equal(sh.stop.anchor, "coach");
  assert.equal(sh.checks.passed, 2);
});

test("a level is marked the moment the price reaches it; after the close each set is scored on the bars and the record is counted", () => {
  const set = () => ({ at: at("10:30"), targets: [{ n: 1, level: 102.6, status: "open", reachedAt: null }, { n: 2, level: 103.4, status: "open", reachedAt: null }], stop: { price: 101.9, status: "open", hitAt: null } });
  const live = set();
  assert.deepEqual(track(live, POS, { last: 102.4, now: at("10:40") }), []);
  assert.deepEqual(track(live, POS, { last: 102.6, now: at("10:47") }), [{ kind: "target", n: 1, price: 102.6, after: false }]);
  assert.equal(live.targets[0].status, "reached");
  assert.deepEqual(track(live, POS, { last: 102.7, now: at("10:48") }), [], "told once");
  assert.equal(track(live, POS, { last: 101.85, now: at("12:55") })[0].kind, "stop");
  assert.equal(track(live, POS, { last: 103.5, now: at("13:10") })[0].after, true, "a target after the stop does not count");
  // the day's bars: 102.6 is reached at 10:46, 103.4 never, and the slide takes the stop out after noon
  const out = settle(set(), POS, dayBars());
  assert.equal(out.t1, "reached");
  assert.equal(new Date(out.t1At + 5.5 * 3600000).toISOString().slice(11, 16), "10:46");
  assert.equal(out.t2, "stopped");
  assert.equal(out.stop, "hit");
  assert.equal(out.judged, true);
  // a short into the same rising day: the stop comes first
  const sh = settle({ at: at("09:40"), targets: [{ n: 1, level: 100.2, status: "open" }], stop: { price: 101.2, status: "open" } }, { ...POS, side: "short" }, dayBars());
  assert.equal(sh.t1, "stopped");
  const rec = record([{ t1: "reached", t2: "stopped" }, { t1: "stopped", t2: null }, { t1: "neither", t2: null }, { t1: null }]);
  assert.equal(rec.judged, 3);
  assert.equal(rec.t1Pct, 33);
  assert.equal(rec.t2Given, 1);
  assert.equal(rec.enough, false);
  assert.match(rec.text, /First target reached before the stop on 1 of 3 sets \(33%\).*Too few to judge yet/);
  assert.match(record([]).text, /No AI level has been scored yet/);
});

function levelsAi(log = []) {
  return {
    modelChain: () => [{ name: "Claude Sonnet 5.5" }],
    exitAdvisor: {
      ready: () => true,
      advise: async () => ({ action: "hold", exitPrice: 102.6, stop: 101.9, confidence: "medium", reason: "r", watch: "w", by: "Claude Sonnet 5.5", cached: false }),
      research: async (snap) => {
        log.push(snap);
        const lv = (re) => snap.levelMap.find((l) => re.test(l.what));
        return {
          targets: [
            { anchor: lv(/R1/).id, price: lv(/R1/).price, why: "R1 102.60 with the pulse's window ending at 102.90." },
            { anchor: "A9", price: 108, why: "a guess" },
          ],
          stop: { anchor: lv(/Your entry/).id, price: lv(/Your entry/).price, why: "Back at the entry the trade has failed." },
          reversal: { anchor: lv(/R1/).id, sign: "Buyers under 40% of the five best levels at 102.60." },
          outlook: "with",
          confidence: "medium",
          summary: "Take profit into R1; the tide and the world lean the same way.",
          by: "Claude Sonnet 5.5",
          cached: false,
        };
      },
    },
  };
}

test("the AI Engine researches the exit levels from the desk's map; only what passes the check reaches the board, and a level reached is told once", async () => {
  const seen = [];
  const { d, clock, sent } = deck({ ai: levelsAi(seen) });
  await d.sync();
  const key = [...d.slots.keys()][0];
  const slot = d.slots.get(key);
  assert.equal(d._levelsNeed(slot, clock.ms), "the position came onto the board", "by itself: once, when the position opens");
  const set = await d.researchLevels(key, { auto: true, why: "the position came onto the board" });
  // what the model was shown: the map with ids and odds, the session, and nothing it could not check
  const snap = seen[0];
  assert.ok(snap.levelMap.length >= 5);
  assert.deepEqual(Object.keys(snap.levelMap[0]), ["id", "price", "what", "strength", "touchesToday", "awayPct", "touchOddsPct"]);
  assert.ok(snap.sessionIn5MinuteBars.rows.length >= 10);
  assert.equal(snap.levels, undefined);
  assert.equal(snap.yourRecordOnThisDesk, null, "no record yet");
  assert.equal(snap.minutesLeftToSquareOff, 285);
  // what came out
  assert.equal(set.by, "Claude Sonnet 5.5");
  assert.equal(set.failed, false);
  assert.equal(set.targets.length, 1);
  assert.equal(set.targets[0].level, 102.6);
  assert.equal(set.rejected.length, 1);
  assert.match(set.rejected[0].why, /“A9” is not a level/);
  assert.equal(set.stop.clamped, true, "the entry is further away than the coach's trailing stop");
  assert.equal(set.stop.price, slot.advice.stop);
  assert.deepEqual(set.checks, { asked: 3, passed: 1, corrected: 0 });
  assert.equal(d.settings().aiToday, 1, "counted against the same daily limit");
  const p = d.board().positions[0];
  assert.equal(p.levels.targets[0].level, 102.6);
  assert.ok(p.map.anchors.length >= 4, "the desk's own map is on the board too");
  assert.match(slot.flight.events[slot.flight.events.length - 1].text, /^AI levels \(Claude Sonnet 5\.5\): target 1 ₹102\.60 .* — 1 of 3 passed the desk's check\.$/);
  assert.equal(d._levelsNeed(slot, clock.ms + 9 * 60000), "", "nothing changed: it is not asked again");
  await assert.rejects(d.researchLevels(key), /a moment ago/);
  // the price reaches the target: written down, pushed in full, and sent to the phone as a reminder
  clock.ms = at("10:47", 5);
  const heard = [];
  d.on("pos", (v) => heard.push(v));
  d._look(slot, { last: 102.62, bid: 102.6, ask: 102.65 }, { force: true });
  assert.equal(slot.levels.targets[0].status, "reached");
  assert.ok(heard[0].levels, "a change of a level is pushed with the whole strip");
  const ev = slot.flight.events.filter((e) => e.kind === "level");
  assert.equal(ev.length, 1);
  assert.match(ev[0].text, /The AI's target 1 ₹102\.60 is reached .*the plan was to take profit here/);
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.filter((m) => /AI target 1 reached/.test(m.text)).length, 1);
  assert.match(sent[0].text, /nothing was traded/);
  d._look(slot, { last: 102.7 }, { force: true });
  assert.equal(slot.flight.events.filter((e) => e.kind === "level").length, 1, "told once");
  assert.equal(d._levelsNeed(slot, clock.ms + 1000), "its targets were reached", "now the rest of the trade needs new levels");
  // only when the AI is asked by itself: "Only when I ask" keeps it to the button
  d.setSettings({ aiMode: "ask" });
  assert.equal(await d.researchLevels(key, { auto: true }), null);
  assert.equal(seen.length, 1);
  clock.ms += 61000;
  await d.researchLevels(key);
  assert.equal(seen.length, 2);
  assert.equal(slot.flight.levels.length, 2);
  d.setSettings({ aiDailyCap: 2 });
  clock.ms += 61000;
  await assert.rejects(d.researchLevels(key), /AI requests are used up/);
  // no key: the board still has the desk's own map
  const none = deck();
  await none.d.sync();
  await assert.rejects(none.d.researchLevels([...none.d.slots.keys()][0]), /No AI key is saved/);
  assert.ok(none.d.board().positions[0].map.anchors.length >= 4);
});

test("after the close each set of AI levels is scored on the day's bars — also when you left before the target — and the record is kept", async () => {
  const seen = [];
  const { d, clock, state } = deck({ ai: levelsAi(seen) });
  await d.sync();
  const key = [...d.slots.keys()][0];
  await d.researchLevels(key);
  // out five minutes later, well before the target
  clock.ms = at("10:35");
  state.positions = [{ exchange: "NSE", symbol: "SBIN", product: "MIS", token: 779521, quantity: 0, average: 0, last: 102.25, pnl: 182, sellPrice: 102.25, buyPrice: 100.43 }];
  await d.sync();
  assert.equal(await d.settleLevels(D), 0, "not before the close");
  assert.equal(d.levelsRecord().judged, 0);
  clock.ms = at("15:40");
  assert.equal(await d.settleLevels(D), 1);
  const day = d.day(D);
  const out = day.flights[0].levels[0].outcome;
  assert.equal(out.t1, "reached");
  assert.equal(out.t1Clock, "10:46", "eleven minutes after you left");
  assert.equal(out.stop, "hit", "and the afternoon's slide took the stop out later");
  assert.equal(day.levelsRecord.judged, 1);
  assert.equal(day.levelsRecord.t1Pct, 100);
  assert.match(day.levelsRecord.text, /1 of 1 sets \(100%\).*Too few to judge yet/);
  assert.equal(await d.settleLevels(D), 0, "scored once");
  assert.equal(d.board().levelsRecord.judged, 1);
});
