"use strict";
// The paper robot: the Level Book (what each level has done), the gate and the rulebook, running a
// position, what became of each best moment, the mistakes and the corrections, the comparison with the
// trader's real day, and the service that ties them together. Everything is faked: no network, no broker.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const L = require("../robot/levels");
const E = require("../robot/engine");
const I = require("../robot/improve");
const C = require("../robot/compare");
const { PaperRobot } = require("../robot/service");
const { FileDocs, COLLECTIONS } = require("../docs");

const IST = 5.5 * 3600 * 1000;
const at = (date, hhmm, sec = 0) => Date.parse(`${date}T${hhmm}:${String(sec).padStart(2, "0")}+05:30`);
const D = "2026-11-16"; // a Monday

/* ----------------------------------------------------------------------------- the Level Book */

/** 75 five-minute bars from 9:15 through `keys` ([bar, price] points, linear in between). */
function session(date, keys, { spread = 0.3 } = {}) {
  const bars = [];
  for (let i = 0; i < 75; i += 1) {
    let k = 0;
    while (k + 1 < keys.length - 1 && keys[k + 1][0] <= i) k += 1;
    const [a, pa] = keys[k];
    const [b, pb] = keys[k + 1];
    const c = i <= a ? pa : i >= b ? pb : pa + ((pb - pa) * (i - a)) / (b - a);
    bars.push({ t: at(date, "09:15") + i * 300000, o: c, h: c + spread, l: c - spread, c, v: 1000 });
  }
  return bars;
}

test("the Level Book: a level tested and held pays the bounce, one that gives way pays the break — each with its costs", () => {
  // yesterday: high 105, low 95, close 100 → pdl 95. Today the price falls onto 95 and bounces.
  const prev = { h: 105, l: 95, c: 100 };
  const up = L.studySession(session("2026-11-10", [[0, 100], [8, 100], [14, 95.2], [16, 95], [30, 99], [74, 101]]), prev, { costPct: 0.1, atr5: 0.6 });
  const b = up.trials.find((t) => t.k === "pdl" && t.p === "bounce");
  assert.ok(b, "the first test of yesterday's low was traded");
  assert.equal(b.s, "long");
  assert.ok(b.r > 1 && b.why === "target", `the bounce reached its target: ${JSON.stringify(b)}`);
  // the same level giving way: the price closes well below it, and keeps going
  const down = L.studySession(session("2026-11-11", [[0, 100], [8, 100], [14, 95.2], [16, 94], [30, 90], [74, 88]]), prev, { costPct: 0.1, atr5: 0.6 });
  const bounce = down.trials.find((t) => t.k === "pdl" && t.p === "bounce");
  const brk = down.trials.find((t) => t.k === "pdl" && t.p === "break");
  assert.ok(bounce && bounce.r <= -1 && bounce.why === "stop", "the bounce was stopped out");
  assert.ok(brk && brk.s === "short" && brk.r > 1, "the break paid");
  assert.equal(L.studySession([], prev).trials.length, 0, "no bars, no trials");
  assert.equal(L.studySession(session("2026-11-11", [[0, 100], [74, 100]]), null).trials.length, 0, "no levels without yesterday");
});

test("the book adds sessions up, shrinks a stock's own record towards the pooled one, and ranks tomorrow's levels", () => {
  const mkSession = (date, wins, n, perR) => ({ date, pooled: { "pdl|bounce|long": [n, wins, perR * n] }, stock: { AAA: { "pdl|bounce|long": [2, 2, 3] } }, lasts: { AAA: { h: 105, l: 95, c: 100, atr5: 0.6 } } });
  const list = Array.from({ length: 12 }, (_, i) => mkSession(`2026-11-${String(i + 2).padStart(2, "0")}`, 6, 10, 0.2));
  const book = L.buildBook(list);
  assert.equal(book.sessions, 12);
  assert.equal(book.pooled["pdl|bounce|long"][0], 120);
  const e = L.edge(book, "AAA", "pdl", "bounce", "long");
  assert.ok(e.n === 24 && e.pooledN === 120, "the stock's own tests and the pooled ones");
  assert.ok(e.ev > 0.2 && e.ev < 3 / 2 + 0.01, "the stock's own +1.5R a test is shrunk towards the pooled +0.2R");
  assert.equal(L.edge(book, "AAA", "pdh", "bounce", "short"), null, "a kind with too few tests has no edge");
  const rows = L.suggestFor(book, "AAA", { h: 105, l: 95, c: 100, atr5: 0.6 });
  const top = rows[0];
  assert.equal(top.kind, "pdl");
  assert.equal(top.play, "bounce");
  assert.equal(top.side, "long");
  assert.ok(top.entry === 95 && top.stop < top.entry && top.target > top.entry);
  assert.match(top.trigger, /falls to 95/);
});

test("skill is counted out of sample, and graduation needs fifteen sessions and a real gap over the average level", () => {
  const days = Array.from({ length: 18 }, (_, i) => {
    const date = `2026-10-${String(i + 5).padStart(2, "0")}`;
    return { date, pooled: { "pdl|bounce|long": [10, 6, 3] }, stock: { AAA: { "pdl|bounce|long": [8, 6, 6.4], "p|bounce|long": [8, 2, -4] } }, lasts: { AAA: { h: 105, l: 95, c: 100, atr5: 0.6 } } };
  });
  const series = L.skillSeries(days);
  assert.equal(series.filter((x) => x.evaluated).length, 13, "the first five sessions have no book before them");
  const ev = series.filter((x) => x.evaluated);
  assert.ok(ev.every((x) => x.triggered > 0 && x.gap > 0), "the chosen level beat the average one each session");
  const early = L.graduation(series.slice(0, 8), 8, { sessions: 15 });
  assert.equal(early.state, "learning");
  assert.match(early.text, /8 of 15 sessions studied/);
  const grad = L.graduation(series, 18, { sessions: 15 });
  assert.equal(grad.state, "graduated");
  assert.ok(grad.meanGap > 0 && grad.better >= 6);
  // the same sessions with the chosen level doing worse than the rest: not graduated
  const flip = days.map((d) => ({ ...d, stock: { AAA: { "pdl|bounce|long": [8, 0, -8], "p|bounce|long": [8, 8, 8] } } }));
  assert.notEqual(L.graduation(L.skillSeries(flip), 18, { sessions: 15 }).state, "graduated");
});

test("a live entry's nearest level is named, within a third of an ATR", () => {
  const f = { pdh: 105, pdl: 95, orh: 101, orl: 99, vwap: 100.2, pivots: { p: 100, r1: 104, s1: 96 } };
  assert.equal(L.nearestLevel(f, 100.15, 0.5).kind, "vwap");
  assert.equal(L.nearestLevel(f, 96.1, 0.5).kind, "s1");
  assert.equal(L.nearestLevel(f, 102.5, 0.5), null, "nothing close");
});

/* ------------------------------------------------------------------------------- the rulebook */

const pick = (o = {}) => ({ symbol: "SBIN", side: "long", eligible: true, score: 60, agree: 0.8, plan: { side: "long", entry: 100, stop: 99, t1: 101.5, t2: 102.5, risk: 1, level: { name: "R1", roomR: 2 } }, reasons: [{ text: "above VWAP" }], ai: null, ...o });
const ctxAt = (hhmm, o = {}) => ({ now: at(D, hhmm), openSymbols: new Set(), open: 0, today: 0, dayNetPct: 0, lastClosed: {}, date: D, lean: null, levelEdge: null, ...o });

test("the gate: every check in order, and the first that fails is the reason written down", () => {
  const r = E.clampRules({});
  assert.deepEqual(E.gate(pick(), r, ctxAt("10:30")), { ok: true, why: "" });
  const why = (p, c, rules = r) => E.gate(p, rules, c).why;
  assert.match(why(pick({ eligible: false }), ctxAt("10:30")), /not eligible/);
  assert.match(why(pick({ plan: null }), ctxAt("10:30")), /no priced plan/);
  assert.match(why(pick(), ctxAt("09:20")), /before 9:30/);
  assert.match(why(pick(), ctxAt("14:40")), /too late/);
  assert.match(why(pick(), ctxAt("10:30", { dayNetPct: -1.6 })), /loss limit/);
  assert.match(why(pick(), ctxAt("10:30", { today: 8 })), /trade limit/);
  assert.match(why(pick(), ctxAt("10:30", { open: 3 })), /as many positions/);
  assert.match(why(pick(), ctxAt("10:30", { openSymbols: new Set(["SBIN"]) })), /already holding/);
  assert.match(why(pick(), ctxAt("10:30", { lastClosed: { SBIN: at(D, "10:10") } })), /closed it a moment ago/);
  assert.match(why(pick({ score: 40 }), ctxAt("10:30")), /score 40 is under the 45/);
  assert.match(why(pick({ score: 50 }), ctxAt("12:00")), /under the 53 needed in the midday lull/);
  assert.match(why(pick({ agree: 0.5 }), ctxAt("10:30")), /50% of the engines/);
  assert.match(why(pick({ ai: { keep: false } }), ctxAt("10:30")), /AI's review dropped it/);
  assert.match(why(pick({ plan: { ...pick().plan, level: { name: "R1", roomR: 0.4 } } }), ctxAt("10:30")), /R1 is only 0.4R away/);
  assert.match(why(pick({ plan: { entry: 100, stop: 99.9, t1: 100.15, t2: 100.25, risk: 0.1 } }), ctxAt("10:30")), /charges would take [0-9.]+R of a stopped trade \(the stop is only 0.1% away\)/);
  assert.match(why(pick(), ctxAt("10:30", { levelEdge: { ev: -0.3, pooledN: 90 } })), /Level Book/);
  assert.match(why(pick(), ctxAt("10:30", { lean: -50 }), E.clampRules({ requireMarket: true })), /against the market/);
  // its own corrections close doors
  assert.match(why(pick(), ctxAt("10:30"), E.clampRules({ blockHours: [10] })), /10:00 hour blocked/);
  assert.match(why(pick(), ctxAt("10:30"), E.clampRules({ blockSymbols: { SBIN: "2026-11-20" } })), /kept out of SBIN until 2026-11-20/);
  assert.match(why(pick({ score: 47 }), ctxAt("10:30"), E.clampRules({ sideBump: { long: 5 } })), /under the 50 needed/);
});

test("the rulebook keeps every number inside its bounds", () => {
  const r = E.clampRules({ minScore: 5, giveBackPct: 99, riskPct: 9, sideBump: { long: 99 }, blockHours: [3, 10, 10, 11, 20], capital: 5 });
  assert.equal(r.minScore, 35);
  assert.equal(r.giveBackPct, 60);
  assert.equal(r.riskPct, 1);
  assert.equal(r.sideBump.long, 15);
  assert.deepEqual(r.blockHours, [10, 11]);
  assert.equal(r.capital, 10000);
});

test("a position: sized from the risk, half booked at the first target, the stop to the entry, then the rest out", () => {
  const rules = E.clampRules({ slipPct: 0 });
  const pos = E.openPosition(pick(), rules, { now: at(D, "10:30"), id: "t1" });
  assert.equal(pos.entryAvg, 100);
  assert.equal(E.openPosition(pick({ side: "short", score: -60, plan: { entry: 100, stop: 101, t1: 98.5, t2: 97.5, risk: 1 } }), rules, { now: at(D, "10:30"), id: "sc" }).score, 60, "the score kept is the call's strength, not its sign");
  assert.equal(pos.qty, Math.min(Math.floor((1000000 * 0.005) / 1), Math.floor((1000000 * 0.25) / 100)), "risk 0.5% of the capital, capped at a quarter of it in one stock");
  assert.equal(pos.riskRs, pos.qty * 1);
  E.step(pos, 100.5, at(D, "10:31"), rules);
  assert.equal(pos.status, "open");
  E.step(pos, 101.5, at(D, "10:35"), rules);
  assert.equal(pos.t1Hit, true);
  assert.equal(pos.qty, pos.qty0 - Math.round(pos.qty0 / 2));
  assert.ok(pos.stop >= 100, "the stop is at the entry or better after the first target");
  E.step(pos, 102.5, at(D, "10:40"), rules);
  assert.equal(pos.status, "closed");
  assert.equal(pos.why, "target");
  const t = E.finish(pos);
  assert.ok(t.pnl > 0 && t.net < t.pnl && t.charges > 0, "costs come off every trade");
  assert.equal(t.netR, Math.round((t.net / pos.riskRs) * 100) / 100);
  assert.equal(t.peak.price, 102.5);
});

test("a position: the stop, the trailing stop, the give-back, a flip of the call, the square-off", () => {
  const rules = E.clampRules({ slipPct: 0 });
  const fresh = () => E.openPosition(pick(), rules, { now: at(D, "10:30"), id: "x" });
  let p = fresh();
  E.step(p, 98.9, at(D, "10:33"), rules);
  assert.equal(p.status, "closed");
  assert.equal(p.why, "stop");
  assert.ok(E.finish(p).net < 0);
  // up to +1R: the stop moves to the entry; the price then falls back through it
  p = fresh();
  E.step(p, 101, at(D, "10:33"), rules);
  assert.equal(p.stop, 100);
  E.step(p, 99.9, at(D, "10:36"), rules);
  assert.equal(p.why, "break-even");
  // a gain given back: best +1.4R, then half of it is gone
  p = fresh();
  E.step(p, 101.4, at(D, "10:33"), rules);
  E.step(p, 100.7, at(D, "10:36"), rules);
  assert.equal(p.why, "giveback");
  // the trailing stop after the first target
  p = fresh();
  E.step(p, 101.5, at(D, "10:33"), rules);
  E.step(p, 102.2, at(D, "10:35"), rules);
  assert.ok(p.stop > 100, "the stop trails behind the best price");
  E.step(p, 101.3, at(D, "10:40"), E.clampRules({ slipPct: 0, giveBackPct: 60 }));
  assert.equal(p.status, "closed");
  assert.match(p.why, /trail|giveback/);
  // the advisor turning against it
  p = fresh();
  E.step(p, 100.1, at(D, "10:33"), rules, { flip: true, reason: "The scanner now has an eligible call on the other side" });
  assert.equal(p.why, "flip");
  // 3:15 PM
  p = fresh();
  E.step(p, 100.2, at(D, "15:15"), rules);
  assert.equal(p.why, "square-off");
  // a short mirrors a long
  const s = E.openPosition(pick({ side: "short", plan: { entry: 100, stop: 101, t1: 98.5, t2: 97.5, risk: 1 } }), rules, { now: at(D, "10:30"), id: "s" });
  E.step(s, 97.5, at(D, "10:40"), rules);
  assert.equal(s.status, "closed");
  assert.ok(E.finish(s).pnl > 0);
});

test("what became of the best moment: the robot's trades are classed the way the trader's are, and the 45 minutes after the exit decide 'left early'", () => {
  const rules = E.clampRules({ slipPct: 0 });
  // up, then closed under the entry: a winner turned loser needs a loss
  const p = E.openPosition(pick(), rules, { now: at(D, "10:30"), id: "w" });
  E.step(p, 100.7, at(D, "10:32"), rules);
  p.stop = 99.6;
  E.step(p, 99.5, at(D, "10:50"), rules);
  const t = E.finish(p);
  assert.equal(t.outcome.id, "winner-to-loser", "up 0.7% and closed under the entry");
  const n = E.openPosition(pick(), rules, { now: at(D, "10:30"), id: "n" });
  E.step(n, 100.1, at(D, "10:32"), rules);
  E.step(n, 98.9, at(D, "10:40"), rules);
  assert.equal(E.finish(n).outcome.id, "never-paid", "a best moment of 0.1% is noise: the price never paid");
  // a real peak that ended in a loss
  const q = E.openPosition(pick({ plan: { entry: 100, stop: 98, t1: 103, t2: 104, risk: 2 } }), rules, { now: at(D, "10:30"), id: "w2" });
  q.peak = { price: 101.2, at: at(D, "10:40"), clock: "10:40" };
  q.stop = 99.4;
  E.step(q, 99.3, at(D, "11:00"), E.clampRules({ slipPct: 0, giveBackPct: 60 }));
  assert.equal(E.finish(q).outcome.id, "winner-to-loser");
  // closed small, and the price ran 4R further inside 45 minutes
  const r = E.openPosition(pick(), rules, { now: at(D, "10:30"), id: "e" });
  E.step(r, 101.5, at(D, "10:35"), rules);
  E.step(r, 101.6, at(D, "10:36"), rules, { flip: true });
  const done = E.finish(r);
  done.after = { until: done.exitAt + 45 * 60000, best: null, worst: null };
  E.watchAfter(done, 104, done.exitAt + 20 * 60000);
  assert.equal(E.outcomeOf(done).id, "left-early");
  assert.equal(E.watchAfter(done, 105, done.exitAt + 50 * 60000), false, "the watch ends after 45 minutes");
});

/* ----------------------------------------------------------------------------- the corrections */

let tid = 0;
function trade(date, o = {}) {
  tid += 1;
  const id = `${date}:T${tid}`;
  const base = { id, date, symbol: "SBIN", side: "long", qty0: 100, entryAt: at(date, "10:30"), exitAt: at(date, "11:00"), entryAvg: 100, exitAvg: 100, pnl: 0, net: 0, netR: 0, peakPnl: 0, peakR: 0, hour: 10, score: 60, midday: false, lean: 0, why: "stop", outcome: { id: "scratch", name: "No real move", tone: "flat" }, riskRs: 500 };
  const t = { ...base, ...o };
  if (o.outcomeId) t.outcome = { id: o.outcomeId, name: o.outcomeId, tone: ["winner-to-loser", "gave-back", "left-early", "never-paid"].includes(o.outcomeId) ? "bad" : "good" };
  return t;
}
const sessions = Array.from({ length: 10 }, (_, i) => `2026-11-${String(i + 2).padStart(2, "0")}`);

test("a mistake that keeps happening proposes ONE change to ONE part of the rulebook, with the evidence", () => {
  const rules = E.clampRules({});
  const trades = [];
  sessions.forEach((d, i) => {
    trades.push(trade(d, { outcomeId: i % 2 ? "winner-to-loser" : "scratch", netR: i % 2 ? -1 : 0.1, net: i % 2 ? -500 : 50, pnl: i % 2 ? -450 : 60, peakPnl: i % 2 ? 600 : 0 }));
    trades.push(trade(d, { outcomeId: "near-best", netR: 0.8, net: 400, pnl: 450, peakPnl: 460 }));
  });
  const p = I.propose({ trades, rules, corrections: [], today: "2026-11-11", dates: sessions });
  const w = p.find((x) => x.key === "winner-to-loser");
  assert.ok(w, "five winners turned losers out of twenty trades");
  assert.equal(w.changes[0].param, "beR");
  assert.equal(w.changes[0].to, 0.85);
  assert.match(w.why, /5 of the last 20 trades were up and closed at a loss/);
  assert.ok(w.baseline && w.evalAfter === 5);
  const after = E.clampRules(I.applyChanges(rules, w.changes));
  assert.equal(after.beR, 0.85);
  assert.equal(E.clampRules(I.revertChanges(after, w.changes)).beR, 1, "an undo puts the old value back");
  // not again within five sessions of a correction on the same part
  const again = I.propose({ trades, rules: after, corrections: [{ ...w, status: "active" }], today: "2026-11-12", dates: [...sessions, "2026-11-12"] });
  assert.equal(again.find((x) => x.key === "winner-to-loser"), undefined);
  // too few of them is not a pattern
  assert.deepEqual(I.propose({ trades: trades.slice(0, 4), rules, corrections: [], today: "2026-11-11", dates: sessions }), []);
});

test("opposite mistakes do not pull the rulebook both ways; hours, sides and stocks that lose are switched off", () => {
  const rules = E.clampRules({});
  const early = [];
  sessions.forEach((d, i) => {
    early.push(trade(d, { outcomeId: i < 4 ? "left-early" : "near-best", netR: 0.3, net: 100, pnl: 150, peakPnl: 160, after: { best: { price: 104, at: 1 }, worst: null } }));
    if (i < 2) early.push(trade(d, { outcomeId: "gave-back", netR: 0.2, net: 80, pnl: 120, peakPnl: 400 }));
  });
  const p = I.propose({ trades: early, rules, corrections: [], today: "2026-11-11", dates: sessions });
  assert.ok(p.find((x) => x.key === "left-early"), "the evidence leans towards leaving too early");
  assert.equal(p.find((x) => x.key === "gave-back"), undefined, "so it does not also tighten the give-back");
  // an hour that loses
  const hourly = [];
  sessions.forEach((d, i) => {
    hourly.push(trade(d, { hour: 12, netR: -0.6, net: -300, pnl: -250 }));
    hourly.push(trade(d, { hour: 10, netR: 0.5, net: 250, pnl: 300, symbol: i % 2 ? "TCS" : "INFY", side: i % 2 ? "short" : "long" }));
  });
  const h = I.propose({ trades: hourly, rules, corrections: [], today: "2026-11-11", dates: sessions });
  const hour = h.find((x) => x.key === "hour:12");
  assert.ok(hour);
  assert.equal(E.clampRules(I.applyChanges(rules, hour.changes)).blockHours.includes(12), true);
  assert.ok(h.length <= 2, "at most two a day");
  // a stock that keeps stopping it out
  const sym = [trade(sessions[0], { symbol: "ZEEL", net: -200, netR: -1, why: "stop" }), trade(sessions[1], { symbol: "ZEEL", net: -200, netR: -1, why: "stop" }), trade(sessions[2], { symbol: "TCS", net: 300, netR: 0.8 })];
  const s = I.propose({ trades: sym, rules, corrections: [], today: "2026-11-03", dates: sessions.slice(0, 3) });
  assert.match(s.find((x) => x.key === "symbol:ZEEL").summary, /No ZEEL until 2026-11-08/);
});

test("a correction is measured five sessions later: kept when the trades since are no worse, undone when they are worse", () => {
  const c = { id: "c1", key: "never-paid", date: "2026-11-03", status: "active", changes: [{ param: "minScore", from: 45, to: 48 }], baseline: { n: 20, avgR: 0.1 }, evalAfter: 5, summary: "Minimum score 45 → 48" };
  const mk = (avgR) => ["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10"].flatMap((d) => [trade(d, { netR: avgR }), trade(d, { netR: avgR })]);
  const dates = ["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10"];
  const worse = I.evaluate([c], mk(-0.3), "2026-11-10", dates);
  assert.equal(worse.corrections[0].status, "reverted");
  assert.equal(worse.reverts.length, 1);
  assert.equal(E.clampRules(I.revertChanges(E.clampRules({ minScore: 48 }), c.changes)).minScore, 45);
  const fine = I.evaluate([c], mk(0.2), "2026-11-10", dates);
  assert.equal(fine.corrections[0].status, "kept");
  const early = I.evaluate([c], mk(0.2).slice(0, 4), "2026-11-05", dates.slice(0, 2));
  assert.equal(early.corrections[0].status, "active", "too soon to judge");
});

test("the register says whether each mistake is open, corrected, fixed or back after its correction; the curve follows the sessions", () => {
  const trades = [];
  for (const d of sessions) trades.push(trade(d, { outcomeId: "gave-back", netR: 0.1, net: 50, pnl: 80, peakPnl: 400, tone: "bad" }));
  const cor = [{ id: "c9", key: "gave-back", date: "2026-11-05", status: "active", summary: "Give-back exit 50% → 45%" }];
  const reg = I.register(trades, cor, sessions);
  const g = reg.find((x) => x.id === "gave-back");
  assert.equal(g.count, 10);
  assert.equal(g.state, "relapse", "it kept happening after the correction");
  assert.equal(g.correction.id, "c9");
  assert.equal(I.register(trades, [], sessions).find((x) => x.id === "gave-back").state, "open");
  const curve = I.progress(trades);
  assert.equal(curve.length, 10);
  assert.equal(curve[9].cum, 500);
  assert.ok(curve[9].rollBad === 100);
});

/* ------------------------------------------------------------------------------- the comparison */

test("the robot against you: stocks both traded, calls you skipped, trades it skipped and why, your habits and the rule that answers each", () => {
  const robot = [
    trade(D, { symbol: "SBIN", side: "long", entryAt: at(D, "10:00"), exitAt: at(D, "10:40"), entryAvg: 100, exitAvg: 103, net: 280, pnl: 300, peakPnl: 320, outcome: { id: "near-best", name: "Booked near the best", tone: "good" } }),
    trade(D, { symbol: "INFY", side: "long", entryAt: at(D, "11:00"), exitAt: at(D, "11:30"), entryAvg: 50, exitAvg: 52, net: 150, pnl: 170, peakPnl: 200 }),
  ];
  const actual = [
    { key: "a", symbol: "SBIN", side: "long", entryAt: at(D, "10:12"), exitAt: at(D, "10:50"), entryAvg: 100.6, exitAvg: 102.5, net: 160, pnl: 190, peak: { clock: "10:30", pnl: 320 }, leftOnTable: 130, efficiency: 59, flags: ["chased"], outcome: { id: "gave-back", name: "Stayed past the peak", tone: "bad" } },
    { key: "b", symbol: "TCS", side: "short", entryAt: at(D, "12:00"), exitAt: at(D, "12:20"), entryAvg: 3000, exitAvg: 3010, net: -150, pnl: -120, peak: { clock: "12:05", pnl: 20 }, leftOnTable: 0, efficiency: null, flags: ["revenge"], outcome: { id: "never-paid", name: "Never paid", tone: "bad" } },
  ];
  const c = C.compareDay({ date: D, robot, actual, skips: [{ symbol: "TCS", action: "skip", why: "score 38 is under the 45 needed" }] });
  assert.equal(c.pairs.length, 1);
  assert.equal(c.pairs[0].symbol, "SBIN");
  assert.equal(c.pairs[0].youLaterMin, 12);
  assert.equal(c.pairs[0].better, "robot");
  assert.ok(c.pairs[0].entryEdgePct < 0, "you came in at the worse price");
  assert.equal(c.robotOnly.length, 1);
  assert.equal(c.robotOnly[0].symbol, "INFY");
  assert.equal(c.youOnly[0].symbol, "TCS");
  assert.match(c.youOnly[0].reason, /score 38/);
  assert.equal(c.robot.net, 430);
  assert.equal(c.you.net, 10);
  assert.equal(c.gap, 420);
  assert.equal(c.habits[0].id, "revenge");
  assert.match(c.habits[0].answer, /waits 30 minutes/);
  assert.ok(c.lessons.some((l) => /robot made ₹420 more/.test(l)));
  assert.ok(c.lessons.some((l) => /five minutes or more after the robot/.test(l)) === false, "one late entry is not a pattern");
  assert.match(C.compareDay({ date: D, robot, actual: [] }).lessons[0], /you took none/);
  assert.match(C.compareDay({ date: D, robot: [], actual }).lessons[0], /the robot took none/);
  const r = C.compareRange([c, C.compareDay({ date: "2026-11-13", robot: [], actual: [] })]);
  assert.equal(r.days, 2);
  assert.equal(r.gap, 420);
});

/* --------------------------------------------------------------------------------- the service */

function bootRobot({ ai = null, actual = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-robot-"));
  const docs = new FileDocs(dir);
  const clock = { ms: at(D, "10:30") };
  const px = { SBIN: 100, TCS: 3000 };
  const picks = [pick()];
  const rows = { SBIN: { symbol: "SBIN", eligible: true, side: "long", score: 60, agree: 0.8 } };
  const feed = { live: () => true, picks: () => picks, rowOf: (s) => rows[s] || null, priceOf: (s) => px[s] ?? null, detail: () => ({ f: { atr5: 0.5, pivots: {}, vwap: 100.1 } }), lean: () => 10 };
  const robot = new PaperRobot({ docs, feed, actual, ai, now: () => clock.ms, log: { log() {} }, gapMs: 0 });
  return { robot, docs, clock, px, picks, rows, dir };
}

test("the robot trades the advisor's call end to end: entered, recorded frame by frame, booked at the targets, landed in its table — and the same stock is not re-entered at once", () => {
  const b = bootRobot();
  assert.equal(b.robot.tick(), "session");
  let board = b.robot.board();
  assert.equal(board.open.length, 1);
  assert.equal(board.open[0].symbol, "SBIN");
  assert.equal(board.paperOnly, true);
  assert.match(board.open[0].events[0].text, /Bought \d+ SBIN at ₹100\.03/);
  b.clock.ms += 20000;
  b.px.SBIN = 100.6;
  b.robot.tick();
  b.clock.ms += 20000;
  b.px.SBIN = 101.6;
  b.robot.tick();
  board = b.robot.board();
  assert.equal(board.open[0].t1Hit, true, "half booked at the first target");
  b.clock.ms += 20000;
  b.px.SBIN = 102.7;
  b.robot.tick();
  board = b.robot.board();
  assert.equal(board.open.length, 0);
  assert.equal(board.closed.length, 1);
  assert.ok(board.closed[0].net > 0 && board.closed[0].why === "target");
  assert.equal(board.day.trades, 1);
  assert.ok(board.day.net > 0);
  // the flight record: frames every 15 seconds, events, decisions
  const day = b.robot.day(D);
  assert.equal(day.available, true);
  assert.ok(day.trades[0].frames.length >= 3, "a frame every 15 seconds");
  assert.ok(day.trades[0].events.some((e) => e.kind === "target"));
  assert.ok(day.decisions.some((d) => d.action === "enter"));
  assert.equal(b.docs.items("robot_trades").length, 1, "the finished trade is in its own table");
  // the same stock straight away: skipped, with the reason written down
  b.clock.ms += 20000;
  b.robot.tick();
  assert.equal(b.robot.board().open.length, 0);
  assert.ok(b.robot.board().decisions.some((d) => d.action === "skip" && /closed it a moment ago/.test(d.why)));
});

test("the robot is off, or has no connection: it takes nothing; open positions are still run to their exit", () => {
  const b = bootRobot();
  b.robot.setSettings({ on: false });
  assert.equal(b.robot.tick(), null);
  assert.equal(b.robot.board().open.length, 0);
  b.robot.setSettings({ on: true });
  b.robot.tick();
  b.robot.setSettings({ on: false });
  b.clock.ms += 20000;
  b.px.SBIN = 98.5;
  assert.equal(b.robot.tick(), "session", "an open position is still managed");
  assert.equal(b.robot.board().closed[0].why, "stop");
  const off = bootRobot();
  off.robot.feed.live = () => false;
  assert.equal(off.robot.tick(), null);
  assert.throws(() => b.robot.setSettings({ capital: 5 }), /paper capital/);
  assert.throws(() => b.robot.setSettings({ riskPct: 5 }), /risk per trade/);
});

test("after 3:31 PM the robot still closes out, compares and corrects even though the scanner has stopped at 3:40", async () => {
  const actual = async () => [];
  const b = bootRobot({ actual });
  b.robot.tick();
  b.clock.ms += 20000;
  b.px.SBIN = 98.5;
  b.robot.tick();
  b.robot.feed.live = () => false; // the scanner is closed
  b.clock.ms = at(D, "15:56");
  assert.equal(b.robot.tick(), "after");
  await new Promise((r) => setTimeout(r, 80));
  const f = b.robot.s.finished[D];
  assert.ok(f.close && f.compare && f.improve, "the close, the comparison and the corrections ran by themselves");
  assert.equal(b.robot.days()[0].compared, true);
  assert.equal(b.robot.s.finished[D].study, undefined, "no market connection here: no study");
});

test("open positions and the rulebook survive a restart", () => {
  const b = bootRobot();
  b.robot.tick();
  b.robot._save();
  const again = new PaperRobot({ docs: b.docs, feed: b.robot.feed, now: () => b.clock.ms, log: { log() {} }, gapMs: 0 });
  assert.equal(again.board().open.length, 1);
  assert.equal(again.s.rules.minScore, 45);
});

test("after the close: the comparison with the trader's day, the corrections (the AI may veto one by id), and the table of days", async () => {
  const sections = {};
  let seen = null;
  const ai = { configured: () => true, playbook: { setSection: (h, t) => (sections[h] = t) }, robotCoach: { review: async (input) => { seen = input; return { review: "A fair day.", vetoes: [{ id: input.proposals[0] ? input.proposals[0].id : "none", why: "too few trades" }, { id: "c:not-proposed", why: "invented" }], lessons: ["x"], watch: [] }; } } };
  const actual = async () => [{ key: "a", symbol: "TCS", side: "short", entryAt: at(D, "12:00"), exitAt: at(D, "12:20"), entryAvg: 3000, exitAvg: 3010, net: -150, pnl: -120, flags: [], outcome: { id: "never-paid", name: "Never paid", tone: "bad" } }];
  const b = bootRobot({ ai, actual });
  b.robot.tick();
  b.clock.ms += 20000;
  b.px.SBIN = 98.5;
  b.robot.tick();
  const c = await b.robot.compare(D);
  assert.equal(c.youOnly[0].symbol, "TCS");
  assert.equal(c.robotOnly[0].symbol, "SBIN");
  assert.equal((await b.robot.comparison(D)).date, D);
  const days = b.robot.days();
  assert.equal(days[0].open, 0);
  assert.equal(days[0].date, D);
  assert.equal(days[0].compared, true);
  // ten sessions of losing winners: a correction is proposed, applied, written into the skills file
  const rows = [];
  for (const d of sessions) for (let k = 0; k < 2; k += 1) rows.push({ ...trade(d, { outcomeId: "winner-to-loser", netR: -1, net: -500, pnl: -450, peakPnl: 600 }), outcome: { id: "winner-to-loser", name: "Winner turned loser", tone: "bad" } });
  b.docs.putItems("robot_trades", rows);
  const r = await b.robot.improveDay("2026-11-11", { by: "manual" });
  assert.ok(r.proposals.length >= 1 && r.proposals.length <= 2);
  assert.ok(seen && seen.proposals.length === r.proposals.length, "the AI was shown the proposals");
  assert.equal(r.vetoed.length, 1, "the AI's veto of a real id counts; the invented id is ignored");
  assert.ok(b.robot.learning().corrections.some((x) => x.status === "vetoed"));
  assert.match(sections["## The paper robot (written by itself)"] || "", /Paper trades/);
  // without the AI the arithmetic stands
  const plain = bootRobot();
  plain.docs.putItems("robot_trades", rows);
  const p2 = await plain.robot.improveDay("2026-11-11");
  assert.ok(p2.applied.length >= 1 && p2.applied[0].status === "active");
  assert.ok(plain.robot.s.rules.beR < 1, "the rulebook moved, inside its bounds");
  const l = plain.robot.learning();
  assert.ok(l.mistakes.find((m) => m.id === "winner-to-loser").correction);
  assert.ok(l.rules.rows.some((x) => x.param === "beR" && x.changed));
});

/** A fake Zerodha history: `n` weekdays of 75 five-minute bars for any stock, ending the day before `now`. */
function history(n, now) {
  const days = [];
  let d = new Date(`${new Date(now + IST).toISOString().slice(0, 10)}T00:00:00Z`);
  while (days.length < n) {
    d = new Date(d.getTime() - 86400000);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days.unshift(d.toISOString().slice(0, 10));
  }
  const seeded = (seed) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  return (token) => {
    const rnd = seeded(token.length * 977 + token.charCodeAt(0));
    let px = 100 + rnd() * 50;
    const rows = [];
    for (const date of days) {
      for (let i = 0; i < 75; i += 1) {
        const t = at(date, "09:15") + i * 300000;
        const o = px;
        px += (rnd() - 0.5) * 1.2;
        rows.push({ t: new Date(t).toISOString().replace("Z", "+00:00"), o, h: Math.max(o, px) + rnd() * 0.3, l: Math.min(o, px) - rnd() * 0.3, c: px, v: 1000 + Math.floor(rnd() * 500) });
      }
    }
    return rows;
  };
}

test("the study: every stock's levels traded session by session into the Level Book, the suggestions, and the skill counted out of sample", async () => {
  const sections = {};
  const ai = { configured: () => false, playbook: { setSection: (h, t) => (sections[h] = t) } };
  const b = bootRobot({ ai });
  b.clock.ms = at(D, "17:00");
  const bars = history(24, b.clock.ms);
  const syms = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"];
  b.robot.market = { instruments: async () => {}, _instrument: async (s) => ({ t: s }), _call: async (fn) => fn({ historical: async (token) => bars(token) }), indexList: { list: () => syms } };
  const r = await b.robot.study({ trigger: "manual" });
  assert.ok(r.sessions >= 20, `sessions studied: ${r.sessions}`);
  const l = b.robot.levels();
  assert.equal(l.available, true);
  assert.ok(l.sessions >= 20 && l.kinds.length > 4);
  assert.ok(l.kinds.every((k) => k.n >= L.MIN_POOLED));
  const sk = b.robot.learning().skill;
  assert.ok(sk.studied >= 20 && sk.series.some((x) => x.evaluated), "the early sessions are not marked; later ones are, against the book before them");
  assert.ok(["graduated", "not-yet", "learning"].includes(sk.graduation.state));
  assert.equal(sk.backfilled, sk.studied, "history is labelled as backfill, not as live sessions");
  assert.match(sections["## Entry levels measured on the NIFTY 100 (written by itself)"] || "", /Measured on the NIFTY 100's last/);
  assert.equal(l.gated, false);
  assert.equal(l.minSessions, 8);
  // a book of fewer than eight sessions gives no suggestion and is not consulted by the robot
  const young = bootRobot({ ai });
  young.clock.ms = at(D, "17:00");
  const few = history(6, young.clock.ms);
  young.robot.market = { instruments: async () => {}, _instrument: async (s) => ({ t: s }), _call: async (fn) => fn({ historical: async (token) => few(token) }), indexList: { list: () => syms } };
  await young.robot.study({ trigger: "manual" });
  const y = young.robot.levels();
  assert.equal(y.gated, true);
  assert.deepEqual(y.rows, []);
  assert.equal(young.robot._book(), null);
  // a second run adds nothing it has already seen
  const again = await b.robot.study({ trigger: "manual" });
  assert.equal(again.sessions, 0);
  // one stock's levels
  const one = b.robot.levels({ symbol: "aaa" });
  assert.equal(one.symbol, "AAA");
  assert.ok(Array.isArray(one.rows) && one.stock.records.length > 0);
  // no connection to the market: it says so
  const none = bootRobot();
  await assert.rejects(() => none.robot.study(), /market connection/);
});

test("the paper robot cannot place an order: its folder holds no broker, no trading service and no order endpoint; its tables are collections of their own", () => {
  const dir = path.join(__dirname, "..", "robot");
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    assert.ok(!/require\(["']\.\.\/trading\/(broker|service|routes)/.test(src), `${f} loads no broker or trading service`);
    assert.ok(!/placeOrder|\/orders|tradingSwitch|\.enabled\b/.test(src), `${f} names no order endpoint or trading switch`);
  }
  const ai = fs.readFileSync(path.join(__dirname, "..", "ai", "robotai.js"), "utf8");
  assert.ok(!/setInterval|setTimeout|cron/.test(ai), "server/ai holds no timers");
  for (const name of ["robot_trades", "robot_days", "robot_study"]) assert.ok(COLLECTIONS.includes(name), `${name} is loaded from MongoDB at start`);
});
