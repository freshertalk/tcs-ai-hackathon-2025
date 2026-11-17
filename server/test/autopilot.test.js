"use strict";
// The autopilot: the trading calendar and event list, the regime and the playbook's scenarios, the risk gate, the grading of
// the outlook, and the service that watches live prices, proposes (never orders), grades its own proposals and learns.
// No network: the market is a stand-in with scripted prices and 1-minute bars.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const nse = require("../market/nse-holidays");
const ev = require("../market/events");
const sc = require("../market/scenarios");
const { gate, cleanSettings, correlation } = require("../risk-gate");
const { calibrate, sentenceFor, bucketOf } = require("../market/calibrate");
const { sectorOf } = require("../market/sectors");
const { Autopilot, COLLECTION } = require("../autopilot");
const { FileDocs, COLLECTIONS } = require("../docs");

/* ------------------------------------------------------------- made-up but repeatable history */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
const dayAfter = (date) => {
  let t = Date.parse(`${date}T00:00:00Z`) + 86400000;
  while ([0, 6].includes(new Date(t).getUTCDay())) t += 86400000;
  return new Date(t).toISOString().slice(0, 10);
};
/** A daily series: drift per day (%), noise (%), and an optional range multiplier. */
function series({ days = 300, drift = 0, noise = 1, range = 1, seed = 3, start = "2025-06-02", c0 = 500 } = {}) {
  const r = rng(seed);
  const out = [];
  let c = c0;
  let d = start;
  for (let i = 0; i < days; i += 1) {
    const o = c * (1 + (gauss(r) * 0.2) / 100);
    const cl = o * (1 + (drift + gauss(r) * noise) / 100);
    const h = Math.max(o, cl) * (1 + (Math.abs(gauss(r)) * 0.4 * range) / 100);
    const l = Math.min(o, cl) * (1 - (Math.abs(gauss(r)) * 0.4 * range) / 100);
    out.push({ t: d, o, h, l, c: cl, v: 1e5 });
    c = cl;
    d = dayAfter(d);
  }
  return out;
}

/* ------------------------------------------------------------- the calendar */

test("the trading calendar: weekends and listed holidays are closed, a special session is open, an unknown year says so", () => {
  assert.equal(nse.isTradingDay("2026-11-17"), true); // Tuesday
  assert.equal(nse.isTradingDay("2026-11-14"), false); // Saturday
  assert.equal(nse.isTradingDay("2026-11-10"), false); // Diwali Balipratipada
  assert.equal(nse.isTradingDay("2026-11-08"), false); // Sunday, and Muhurat only
  assert.equal(nse.isTradingDay("2026-02-01"), true); // the Budget Sunday
  assert.equal(nse.holidayName("2026-12-25"), "Christmas");
  assert.equal(nse.nextTradingDay("2026-11-09"), "2026-11-11");
  assert.equal(nse.prevTradingDay("2026-11-11"), "2026-11-09");
  assert.equal(nse.nextTradingDay("2026-11-20"), "2026-11-23");
  assert.equal(nse.lastTradingDayOfMonth("2026-11-05"), "2026-11-30");
  assert.equal(nse.lastTradingDayOfMonth("2026-10-05"), "2026-10-30");
  assert.deepEqual(nse.closuresBetween("2026-11-09", 3).map((c) => c.date), ["2026-11-10"]);
  assert.equal(nse.known("2026-06-01"), true);
  assert.equal(nse.known("2031-06-02"), false);
  assert.equal(nse.isTradingDay("2031-06-02"), true, "an unknown year: weekdays are trading days");
});

/* ------------------------------------------------------------- the events */

const NFO = [
  { n: "NIFTY", y: "CE", e: "2026-11-17" },
  { n: "NIFTY", y: "PE", e: "2026-11-17" },
  { n: "NIFTY", y: "CE", e: "2026-11-24" },
  { n: "NIFTY", y: "CE", e: "2026-11-30" },
  { n: "BANKNIFTY", y: "CE", e: "2026-11-24" },
  { n: "SBIN", y: "FUT", e: "2026-11-24" },
  { n: "TCS", y: "FUT", e: "2026-11-24" },
  { n: "NIFTY", y: "CE", e: "2027-03-30" },
];

test("expiries come from the NFO list: index weeklies and monthlies, and only the stocks asked for", () => {
  const x = ev.expiriesFrom(NFO, { today: "2026-11-16", days: 45, symbols: ["SBIN"] });
  assert.deepEqual(x.map((e) => `${e.name} ${e.date} ${e.kind}`), ["NIFTY 2026-11-17 weekly", "BANKNIFTY 2026-11-24 monthly", "NIFTY 2026-11-24 weekly", "SBIN 2026-11-24 monthly", "NIFTY 2026-11-30 monthly"]);
  assert.ok(!x.some((e) => e.name === "TCS" || e.date > "2026-12-31"));
});

test("automatic events: closures and the session before, expiries with a size factor, the month's last session", () => {
  const expiries = ev.expiriesFrom(NFO, { today: "2026-11-06", days: 45, symbols: [] });
  const list = ev.autoEvents({ today: "2026-11-06", days: 25, expiries });
  const kinds = list.map((e) => e.kind);
  for (const k of ["holiday", "pre-holiday", "expiry", "month-end"]) assert.ok(kinds.includes(k), k);
  const pre = list.find((e) => e.kind === "pre-holiday" && e.date === "2026-11-09");
  assert.match(pre.title, /Last session before Market closed|before Diwali/i);
  assert.ok(pre.sizeFactor < 1);
  const monthly = list.find((e) => e.kind === "expiry" && /monthly/.test(e.title));
  assert.equal(monthly.impact, "high");
  assert.equal(monthly.sizeFactor, 0.75);
  assert.match(monthly.advice, /max-pain/);
  const eom = list.find((e) => e.kind === "month-end");
  assert.equal(eom.date, "2026-11-30");
});

test("the owner's events: validated, and the advice depends on how close the date is", () => {
  assert.match(ev.cleanCustom({ date: "17 Nov", kind: "fed" }).error, /YYYY-MM-DD/);
  assert.match(ev.cleanCustom({ date: "2026-11-20", kind: "results" }).error, /symbol/);
  const c = ev.cleanCustom({ date: "2026-11-20", kind: "results", symbols: "sbin, tcs", time: "15:45", title: "<b>Q2 results</b>" });
  assert.deepEqual(c.symbols, ["SBIN", "TCS"]);
  assert.equal(c.time, "15:45");
  assert.ok(!/[<>]/.test(c.title));
  const today = ev.fromCustom({ ...c, id: "x" }, "2026-11-20");
  assert.equal(today.sizeFactor, 0.5);
  assert.equal(today.noOvernight, true);
  assert.equal(today.avoidNew, true);
  assert.match(today.advice, /Results today at 15:45/);
  const eve = ev.fromCustom({ ...c, id: "x" }, "2026-11-19");
  assert.equal(eve.sizeFactor, 0.7);
  assert.match(eve.advice, /Results tomorrow/);
  const fed = ev.fromCustom(ev.cleanCustom({ date: "2026-11-19", kind: "fed" }), "2026-11-19");
  assert.equal(fed.sizeFactor, 0.6);
  assert.equal(fed.scope.market, true);
});

test("what applies to a stock on a day: market events, its own, and 'results tomorrow' banning an overnight hold", () => {
  const events = [
    ...ev.autoEvents({ today: "2026-11-16", days: 10, expiries: [{ name: "NIFTY", date: "2026-11-17", kind: "weekly", index: true }] }),
    ev.fromCustom(ev.cleanCustom({ date: "2026-11-18", kind: "results", symbols: ["SBIN"] }), "2026-11-17"),
    ev.fromCustom(ev.cleanCustom({ date: "2026-11-17", kind: "rbi" }), "2026-11-17"),
  ];
  const sbin = ev.eventsOn(events, "2026-11-17", "SBIN");
  assert.equal(sbin.noOvernight, true, "SBIN's results are tomorrow");
  assert.ok(sbin.events.some((e) => e.title.includes("NIFTY")));
  assert.equal(sbin.avoidNew, true, "the RBI announcement is today");
  assert.ok(sbin.sizeFactor <= 0.55 && sbin.sizeFactor >= 0.25, `size ${sbin.sizeFactor}`);
  const tcs = ev.eventsOn(events, "2026-11-17", "TCS");
  assert.equal(tcs.noOvernight, false, "not TCS's results");
  assert.ok(ev.upcoming(events, "2026-11-16", { symbol: "SBIN", days: 5 }).every((e, i, a) => !i || a[i - 1].date <= e.date));
  assert.equal(ev.upcoming(events, "2026-11-16", { symbol: "TCS", days: 5 }).some((e) => e.title.includes("results")), false);
});

/* ------------------------------------------------------------- the regime */

test("the regime: a steady climb is trending, a drifting sideways stock is a range, quiet-then-wide shows squeeze and volatile", () => {
  const up = sc.regimeOf(series({ drift: 0.5, noise: 0.5, seed: 1 }));
  assert.equal(up.kind, "trending-up");
  assert.ok(up.er >= 0.35);
  const down = sc.regimeOf(series({ drift: -0.5, noise: 0.5, seed: 2 }));
  assert.equal(down.kind, "trending-down");
  const flat = sc.regimeOf(series({ drift: 0, noise: 1.1, seed: 4 }).map((b, i, a) => ({ ...b, c: 500 + 8 * Math.sin(i / 3) + (b.c - 500) * 0.0, o: 500 + 8 * Math.sin((i - 1) / 3), h: 512, l: 488 })));
  assert.ok(["range", "squeeze", "volatile"].includes(flat.kind));
  // quiet for a long stretch, then ranges blow out: volatile
  const wide = Array.from({ length: 300 }, (_, i) => ({ t: String(i), o: 500, h: 500.6, l: 499.4, c: 500 + (i % 2 ? 0.2 : -0.2) + (i % 7) * 0.01 }));
  for (let i = wide.length - 12; i < wide.length; i += 1) Object.assign(wide[i], { h: 530, l: 470 });
  assert.equal(sc.regimeOf(wide).kind, "volatile");
  // compressed: the last 20 closes barely move after a long, wide history
  const sq = series({ drift: 0, noise: 1.5, seed: 6 });
  const base = sq[sq.length - 21].c;
  for (let i = sq.length - 20; i < sq.length; i += 1) Object.assign(sq[i], { o: base, c: base * (1 + ((i % 2) - 0.5) * 0.001), h: base * 1.002, l: base * 0.998 });
  assert.equal(sc.regimeOf(sq).kind, "squeeze");
  assert.ok(up.doThis.length >= 3 && up.word);
  assert.equal(sc.regimeOf(series({ days: 30 })), null, "too little history");
});

/* ------------------------------------------------------------- the playbook's scenarios */

const planFor = (over = {}) => ({
  available: true,
  nextSession: "2026-11-17",
  last: 500,
  lean: { call: "long-bias", score: 34, agreement: 71, chartBucket: "up" },
  plans: {
    long: { side: "long", entry: 502, stop: 497, targets: [510, 515], riskPerShare: 5, riskPct: 1, rewardToRisk: 1.6 },
    short: { side: "short", entry: 492, stop: 497, targets: [484, 479], riskPerShare: 5, riskPct: 1, rewardToRisk: 1.6 },
  },
  open: { expected: 504, low: 502, high: 506, gapPct: 0.8 },
  habits: { gapFillPct: 62, gaps: 40, openingRange: { note: "The 9:15–9:30 range broke on 83% of days; the first break held to the close 61% of the time." }, firstHourExtremePct: 58, trendDayPct: 22, vwapHoldPct: 54 },
  record: { lean: { trades: 24, avgR: 0.21, winRate: 54, verdict: "positive, not proven", long: { trades: 14, avgR: 0.3, winRate: 57, verdict: "positive, not proven" }, short: { trades: 10, avgR: 0.05, winRate: 50, verdict: "too few to judge" } }, orb: { trades: 60, avgR: 0.12, winRate: 49, verdict: "positive, not proven" }, both: {} },
  options: { resistance: 520, support: 480, maxPain: 500, pcr: 1.2, label: "Leans up" },
  dayRangePct: 2,
  ...over,
});
const noEvents = { sizeFactor: 1, noOvernight: false, avoidNew: false, events: [] };

test("the scenarios: break and opening-range entries with triggers, advice for gaps, walls, events and the market turning", () => {
  const list = sc.buildScenarios({ symbol: "ABC", plan: planFor(), regime: { kind: "trending-up", bbRank: 40 }, events: noEvents, dayRs: 10 });
  const ids = list.map((s) => s.id);
  for (const id of ["break-long", "break-short", "orb-up", "orb-down", "gap-up", "call-wall", "put-wall", "risk-off"]) assert.ok(ids.includes(id), id);
  const bl = list.find((s) => s.id === "break-long");
  assert.equal(bl.kind, "entry");
  assert.deepEqual(bl.trigger, { type: "break", side: "long", level: 502, after: "09:30", before: "14:45", hold: 2 });
  assert.equal(bl.plan.stop, 497);
  assert.equal(bl.sizeFactor, 1, "with the lean and the trend");
  assert.match(bl.measured, /24|14 past sessions/);
  assert.deepEqual(bl.edge && bl.edge.n, 14);
  const bs = list.find((s) => s.id === "break-short");
  assert.ok(bs.sizeFactor < 0.5, `against the lean and the trend: ${bs.sizeFactor}`);
  assert.ok(bs.sizeNotes.some((n) => /against the trend/.test(n)) && bs.sizeNotes.some((n) => /against the chart/.test(n)));
  assert.match(list.find((s) => s.id === "orb-up").measured, /83% of days/);
  assert.ok(list.find((s) => s.id === "gap-up").then.length === 3);
  // a setup whose replayed record lost money is not proposed
  const bad = planFor();
  bad.record.lean.long = { trades: 20, avgR: -0.2, winRate: 38, verdict: "did not pay" };
  const bl2 = sc.buildScenarios({ symbol: "ABC", plan: bad, events: noEvents, dayRs: 10 }).find((s) => s.id === "break-long");
  assert.equal(bl2.sizeFactor, 0);
  assert.ok(bl2.sizeNotes.some((n) => /not proposed/.test(n)));
  // events scale the day
  const withEv = sc.buildScenarios({ symbol: "ABC", plan: planFor(), events: { ...noEvents, sizeFactor: 0.5, events: [{ kind: "custom", date: "2026-11-17", title: "Results", advice: "Careful.", sizeFactor: 0.5, noOvernight: true }] }, dayRs: 10 });
  assert.equal(withEv.find((s) => s.id === "break-long").sizeFactor, 0.5);
  assert.ok(withEv.some((s) => s.event));
  assert.deepEqual(sc.buildScenarios({ symbol: "ABC", plan: { available: false } }), []);
});

test("the day's script: every window, this stock's own numbers in it, and the events first", () => {
  const s = sc.scriptFor({ open: { expected: 504, gapPct: 0.8 }, habits: planFor().habits, events: { events: [{ title: "Results", advice: "Be flat." }] } });
  assert.equal(s[0].title, "Before you start");
  assert.deepEqual(s.slice(1).map((x) => x.from), ["08:45", "09:15", "09:30", "11:30", "13:30", "14:45", "15:20"]);
  assert.match(s.find((x) => x.title === "Pre-open").do, /62% of its gaps/);
  assert.match(s.find((x) => x.title === "Opening range").happens, /83% of days/);
  assert.match(s.find((x) => x.title === "Prime window").happens, /58% of days/);
  assert.match(s.find((x) => x.title === "Midday lull").happens, /54%/);
});

test("watching a break live: waiting, armed, breaking, held, late, spoiled — and the opening range", () => {
  const long = sc.buildScenarios({ symbol: "ABC", plan: planFor(), events: noEvents, dayRs: 10 }).find((s) => s.id === "break-long");
  const bar = (min, c) => ({ t: Date.parse("2026-11-17T00:00:00Z") - 19800000 + min * 60000, o: c, h: c + 0.2, l: c - 0.2, c });
  const live = (minute, price, closes = [], extra = {}) => ({ minute, price, bars1: closes.map((c, i) => bar(570 + i, c)), orb: null, fired: false, ...extra });
  assert.equal(sc.evaluate(long, live(9 * 60 + 20, 500)).state, "waiting");
  assert.equal(sc.evaluate(long, live(15 * 60, 503)).state, "expired");
  const armed = sc.evaluate(long, live(10 * 60, 500));
  assert.equal(armed.state, "armed");
  assert.match(armed.note, /below the trigger ₹502/);
  assert.equal(sc.evaluate(long, live(10 * 60, 502.5, [501, 501.5])).state, "breaking", "through, but the closes have not held");
  assert.equal(sc.evaluate(long, live(10 * 60, 502.6, [502.3, 502.5])).state, "triggered");
  assert.equal(sc.evaluate(long, live(10 * 60, 502.6, [502.3, 501.9])).state, "breaking", "one close back under the level breaks the hold");
  assert.equal(sc.evaluate(long, live(10 * 60, 506, [505, 505.5])).state, "late", "more than half the risk beyond the trigger: no chasing");
  assert.equal(sc.evaluate(long, live(10 * 60, 496.5)).state, "invalid", "through the stop first");
  assert.equal(sc.evaluate(long, live(10 * 60, 500, [], { fired: true })).state, "triggered");
  assert.equal(sc.evaluate({ kind: "advice" }, live(600, 500)).state, "info");
  const short = sc.buildScenarios({ symbol: "ABC", plan: planFor(), events: noEvents, dayRs: 10 }).find((s) => s.id === "break-short");
  assert.equal(sc.evaluate(short, live(10 * 60, 491.4, [491.7, 491.5])).state, "triggered");

  // the opening range: only known from 9:30, with at least ten minutes of bars
  const day0 = Date.parse("2026-11-17T00:00:00Z") - 19800000;
  const bars = Array.from({ length: 15 }, (_, i) => ({ t: day0 + (555 + i) * 60000, o: 500, h: 503 - (i % 3) * 0.1, l: 498 + (i % 4) * 0.1, c: 500 }));
  const orb = sc.openingRange(bars, day0);
  assert.equal(orb.high, 503);
  assert.equal(orb.low, 498);
  assert.equal(sc.openingRange(bars.slice(0, 6), day0), null);
  const up = sc.buildScenarios({ symbol: "ABC", plan: planFor(), events: noEvents, dayRs: 10 }).find((s) => s.id === "orb-up");
  const hit = sc.evaluate(up, { minute: 10 * 60, price: 503.3, bars1: [{ t: 0, c: 503.2 }], orb, fired: false });
  assert.equal(hit.state, "triggered");
  assert.equal(hit.plan.entry, 503);
  assert.equal(hit.plan.stop, 498, "the other side of the range (5 is within half a day's 10)");
  assert.deepEqual(hit.plan.targets, [510.5, 515.5]);
  const wide = sc.evaluate(up, { minute: 10 * 60, price: 503.3, bars1: [], orb: { high: 510, low: 498 }, fired: false });
  assert.equal(wide.state, "invalid");
  assert.match(wide.note, /wider than half a normal day/);
  assert.equal(sc.evaluate(up, { minute: 10 * 60, price: 500, bars1: [], orb: null, fired: false }).state, "waiting");
});

/* ------------------------------------------------------------- the risk gate */

const S0 = { capital: 1000000, riskPct: 0.5, maxPositionPct: 60, maxSectorPct: 60, maxGrossPct: 150, minRR: 1.5, maxProposals: 6 };
const base = (over = {}) => ({ symbol: "SBIN", side: "long", entry: 800, stop: 790, targets: [820, 830], sizeFactor: 1, settings: S0, positions: [], ...over });

test("the gate sizes from the risk budget and never lets a trade through that breaks a rule", () => {
  const ok = gate(base());
  assert.equal(ok.allowed, true);
  assert.equal(ok.qty, 500, "₹5,000 budget ÷ ₹10 risk per share");
  assert.equal(ok.riskRs, 5000);
  assert.equal(ok.rr, 2);
  assert.equal(ok.valueRs, 400000);
  assert.equal(ok.reasons[0].level, "ok");

  const blocked = (over, re) => {
    const g = gate(base(over));
    assert.equal(g.allowed, false);
    assert.equal(g.qty, 0);
    assert.ok(g.reasons.some((r) => r.level === "block" && re.test(r.text)), JSON.stringify(g.reasons));
  };
  blocked({ settings: { ...S0, capital: 0 } }, /Set your trading capital/);
  blocked({ stop: 810 }, /valid trade/);
  blocked({ targets: [805] }, /pays 0\.5× the risk/);
  blocked({ standing: { locked: true, lock: { reason: "daily loss reached" } } }, /locked the day: daily loss reached/);
  blocked({ events: { avoidNew: true } }, /announcement/);
  blocked({ proposalsToday: 6 }, /quota/);
  blocked({ positions: [{ symbol: "SBIN", qty: 100, avg: 790, last: 800 }] }, /already hold SBIN/);
  blocked({ standing: { room: { open: 0 } } }, /open-positions limit/);
  assert.equal(gate(base({ side: "short", entry: 800, stop: 810, targets: [780], positions: [{ symbol: "SBIN", qty: 100, avg: 790, last: 800 }] })).allowed, true, "the other side of a position is not 'already hold'");
});

test("the gate cuts: size factor, position cap, sector concentration, correlated holdings — and only ever downward", () => {
  const f = gate(base({ sizeFactor: 0.5 }));
  assert.equal(f.qty, 250);
  assert.ok(f.reasons.some((r) => r.level === "cut" && /×0\.5/.test(r.text)));
  assert.equal(gate(base({ sizeFactor: 7 })).qty, 500, "a factor above 1 is read as 1");
  assert.equal(gate(base({ sizeFactor: -2 })).allowed, false);

  const tight = gate(base({ stop: 799, entry: 800, targets: [802] , settings: { ...S0, riskPct: 2, minRR: 1, maxPositionPct: 25 } }));
  assert.equal(tight.valueRs, 249600, "the 25% position cap: 312 shares of ₹800");
  assert.ok(tight.reasons.some((r) => /limited to 25%/.test(r.text)));

  // banks are already 30% of capital: 5% more fits, not more
  const S35 = { ...S0, maxSectorPct: 35 };
  const heavy = gate(base({ settings: S35, positions: [{ symbol: "HDFCBANK", qty: 200, avg: 1500, last: 1500 }] }));
  assert.equal(sectorOf("HDFCBANK"), "Banks");
  assert.ok(heavy.valueRs <= 50000 + 800, `value ${heavy.valueRs}`);
  assert.ok(heavy.reasons.some((r) => /Banks would pass 35%/.test(r.text)));
  const full = gate(base({ settings: S35, positions: [{ symbol: "HDFCBANK", qty: 240, avg: 1500, last: 1500 }] }));
  assert.equal(full.allowed, false);

  // correlation: one bet, not two
  const corr = (a, b) => (a === "SBIN" && b === "ICICIBANK" ? 0.9 : null);
  const together = gate(base({ positions: [{ symbol: "ICICIBANK", qty: 50, avg: 1000, last: 1000 }], corr }));
  assert.equal(together.qty, 250);
  assert.ok(together.reasons.some((r) => /ICICIBANK \(correlation 0\.9\)/.test(r.text)));
  const hedge = gate(base({ positions: [{ symbol: "ICICIBANK", qty: -50, avg: 1000, last: 1000 }], corr }));
  assert.equal(hedge.qty, 500);
  assert.ok(hedge.reasons.some((r) => r.level === "warn" && /partly hedges/.test(r.text)));
  // a day that is already losing says so
  const losing = gate(base({ standing: { dayPnl: -8000, room: { loss: 12000, open: 3 } } }));
  assert.ok(losing.reasons.some((r) => r.level === "warn" && /down ₹8,000 today/.test(r.text)));
  // one share more than the budget
  assert.equal(gate(base({ entry: 800, stop: 100, targets: [1500], settings: { ...S0, riskPct: 0.05 } })).allowed, false);
});

test("the settings are cleaned to sane limits, and correlation is measured from returns", () => {
  const s = cleanSettings({ capital: "2500000", riskPct: 9, maxPositionPct: 0, minRR: 0.2, maxProposals: 99 });
  assert.deepEqual(s, { capital: 2500000, riskPct: 2, maxPositionPct: 1, maxSectorPct: 35, maxGrossPct: 150, minRR: 1, maxProposals: 30 });
  assert.equal(cleanSettings({ capital: -5 }).capital, 0);
  assert.equal(cleanSettings({ riskPct: "abc" }, { ...S0, riskPct: 0.7 }).riskPct, 0.7, "a bad value keeps the current one");
  const a = series({ seed: 1, noise: 1 }).map((b) => b.c);
  assert.equal(correlation(a, a), 1);
  assert.ok(correlation(a, a.map((x) => 1000 - x)) < -0.9);
  assert.ok(Math.abs(correlation(a, series({ seed: 99, noise: 1 }).map((b) => b.c))) < 0.4);
  assert.equal(correlation(a.slice(0, 10), a.slice(0, 10)), null, "too few pairs");
});

/* ------------------------------------------------------------- is the research any good? */

test("calibration grades the outlook on history: buckets, an overall hit rate and each voice's edge", () => {
  const set = [1, 2, 3, 4].map((seed) => ({ symbol: `S${seed}`, daily: series({ seed, drift: 0.05, noise: 1.1 }) }));
  const cal = calibrate(set, { lookback: 150 });
  assert.equal(cal.available, true);
  assert.equal(cal.buckets.length, 7);
  assert.equal(cal.buckets.reduce((s, b) => s + b.n, 0), cal.overall.n);
  assert.equal(cal.overall.stocks, 4);
  assert.ok(cal.overall.n >= 400);
  assert.ok(cal.overall.hitPct === null || (cal.overall.hitPct >= 0 && cal.overall.hitPct <= 100));
  assert.ok(cal.voices.length >= 5);
  for (const v of cal.voices) {
    assert.ok(v.multiplier >= 0.5 && v.multiplier <= 1.5, `${v.id} ${v.multiplier}`);
    assert.ok(["too few to judge", "has paid", "has been wrong", "noise so far"].includes(v.verdict));
  }
  assert.equal(bucketOf(30), "up");
  assert.equal(bucketOf(-50), "strong-down");
  const text = sentenceFor(cal, 30);
  assert.ok(text === "" || /When the outlook's lean was \+22 to \+40/.test(text));
  assert.equal(calibrate([{ symbol: "X", daily: series({ days: 50 }) }]).available, false);
  assert.equal(sentenceFor(null, 30), "");
});

/* ------------------------------------------------------------- the service */

const istMs = (date, hhmm) => Date.parse(`${date}T${hhmm}:00+05:30`);
const DAY = "2026-11-17"; // a Tuesday, a trading day in the table

function desk({ capital = 1000000 } = {}) {
  const daily = { ABC: series({ days: 330, seed: 21, drift: 0.1, noise: 1, start: "2025-07-01" }), "NIFTY 50": series({ days: 330, seed: 22, noise: 0.7, start: "2025-07-01" }) };
  // the last completed bar is the evening before DAY, so DAY's plan is for DAY
  for (const k of Object.keys(daily)) {
    const keep = daily[k].filter((b) => b.t < DAY);
    daily[k] = keep;
  }
  const clock = { t: istMs(DAY, "08:50") };
  const price = { ABC: 500 };
  const bars = []; // 1-minute bars of DAY for ABC, as { t, o, h, l, c }
  const sent = [];
  const m = {
    state: "kite",
    mode: () => m.state,
    watchlist: () => ["ABC"],
    daily: async (s) => ({ candles: daily[s] || [] }),
    intradayPlan: async (s) => (s === "ABC" ? planFor({ nextSession: DAY }) : { available: false, reason: "none" }),
    quotes: async (syms) => ({ quotes: Object.fromEntries(syms.map((s) => [s, { last: price[s] }])) }),
    minuteBarsBetween: async (s, from, to) => bars.filter((b) => b.t >= from && b.t <= to),
    derivatives: async () => NFO,
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-ap-"));
  const docs = new FileDocs(dir);
  const written = [];
  const ap = new Autopilot({
    market: m,
    docs,
    trading: { positions: async () => ({ net: [] }), riskStatus: async () => ({ standing: { locked: false, dayPnl: 0, room: { loss: 20000, open: 5 } } }) },
    notifier: { send: async (t) => (sent.push(t), true) },
    playbook: { setSection: (head, body) => written.push({ head, body }) },
    now: () => clock.t,
    log: { log() {}, error() {} },
  });
  ap.setSettings({ capital, riskPct: 0.5 }, "owner");
  // a minute bar at HH:MM of DAY
  const at = (hhmm) => istMs(DAY, hhmm);
  const put = (hhmm, c, spread = 0.2) => bars.push({ t: at(hhmm), o: c, h: c + spread, l: c - spread, c });
  /** play minutes from..to closing at `c`, then tick the clock to just after `to` and run one watch pass */
  const run = async (from, to, c) => {
    const [fh, fm] = from.split(":").map(Number);
    const [th, tm] = to.split(":").map(Number);
    for (let x = fh * 60 + fm; x <= th * 60 + tm; x += 1) put(`${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`, c);
    clock.t = at(to) + 20000;
    price.ABC = c;
    return ap.watch();
  };
  return { m, docs, ap, clock, price, bars, sent, written, put, run, at, dir, daily };
}

test("the collections the autopilot keeps are ones the database loads", () => {
  assert.ok(COLLECTIONS.includes(COLLECTION));
});

test("the morning: the playbook is made before the open, with its regime, script, events and where each scenario stands", async () => {
  const s = desk();
  await s.ap.tick(); // 08:50 — prepares
  const pb = await s.ap.playbook("ABC", { withAccount: true });
  assert.equal(pb.available, true);
  assert.equal(pb.date, DAY);
  assert.ok(pb.regime && pb.regime.kind);
  assert.equal(pb.script.some((x) => x.title === "Opening range"), true);
  const bl = pb.scenarios.find((x) => x.id === "break-long");
  assert.equal(bl.status.state, "waiting");
  assert.ok(pb.scenarios.some((x) => x.id === "orb-up"));
  assert.equal(pb.events.today.events.some((e) => /NIFTY weekly expiry/.test(e.title)), true, "NIFTY expires this Tuesday in the made-up list");
  assert.ok(pb.sizing && pb.sizing.allowed, JSON.stringify(pb.sizing));
  assert.ok(pb.sizing.qty > 0 && pb.sizing.sizeFactor <= 0.85, `the expiry day trims the size: ${pb.sizing.sizeFactor}`);
  assert.equal((await s.ap.playbook("ABC")).sizing, null, "the account's numbers are for the owner only");
  assert.equal((await s.ap.playbook("NOPE")).available, false);
  await assert.rejects(s.ap.playbook("bad symbol!"), { code: "invalid" });
});

test("a break that holds becomes a proposal with its size, stop, targets and reasons — and a notice; nothing is ordered", async () => {
  const s = desk();
  await s.ap.tick();
  s.clock.t = s.at("09:31");
  // before 9:30 nothing happens; at 9:35 the price is 1.2% under the trigger: armed
  let r = await s.run("09:15", "09:35", 498);
  assert.equal(r.created, 0);
  assert.equal((await s.ap.playbook("ABC")).scenarios.find((x) => x.id === "break-long").status.state, "armed");
  // through the level on 1 minute: breaking, not held
  r = await s.run("09:36", "09:40", 500);
  r = await s.run("09:41", "09:41", 502.4);
  assert.equal(r.created, 0);
  assert.equal((await s.ap.playbook("ABC")).scenarios.find((x) => x.id === "break-long").status.state, "breaking");
  // two closed minutes above 502: held
  r = await s.run("09:42", "09:44", 502.5);
  assert.equal(r.created, 1);
  const [p] = s.ap.proposals({ days: 0 });
  assert.equal(p.status, "new");
  assert.equal(p.symbol, "ABC");
  assert.equal(p.scenario, "break-long");
  assert.equal(p.side, "long");
  assert.equal(p.stop, 497);
  assert.equal(p.targets[0], 510);
  assert.ok(p.qty > 0 && p.riskRs > 0 && p.riskRs <= 5000, `risk ${p.riskRs}`);
  assert.ok(p.sizeFactor < 1, "NIFTY's expiry trims it");
  assert.deepEqual({ symbol: p.ticket.symbol, side: p.ticket.side, product: p.ticket.product, quantity: p.ticket.quantity }, { symbol: "ABC", side: "BUY", product: "MIS", quantity: p.qty });
  assert.equal(p.ticket.plan.stop, 497);
  assert.match(p.ticket.plan.source, /Autopilot/);
  assert.match(p.why, /previous session's high/);
  assert.equal(s.sent.length, 1);
  assert.match(s.sent[0], /BUY \d+ ABC.*nothing is sent until you place it/);
  // it fires once a day, however long the price stays there
  r = await s.run("09:45", "09:50", 503);
  assert.equal(r.created, 0);
  assert.equal(s.ap.proposals({ days: 0 }).length, 1);
  assert.equal((await s.ap.playbook("ABC")).scenarios.find((x) => x.id === "break-long").status.state, "triggered");
});

test("a refused proposal is recorded with its reason and never notified; the owner's answers are kept", async () => {
  const s = desk({ capital: 0 });
  await s.ap.tick();
  await s.run("09:15", "09:35", 498);
  await s.run("09:36", "09:44", 502.5);
  const [p] = s.ap.proposals({ days: 0 });
  assert.equal(p.status, "blocked");
  assert.equal(p.qty, 0);
  assert.equal(p.ticket, null);
  assert.ok(p.reasons.some((r) => r.level === "block" && /Set your trading capital/.test(r.text)));
  assert.equal(s.sent.length, 0);
  assert.throws(() => s.ap.decide(p.id, "opened"), { code: "invalid" });
  // an allowed one can be opened or ignored
  const t = desk();
  await t.ap.tick();
  await t.run("09:15", "09:35", 498);
  await t.run("09:36", "09:44", 502.5);
  const [q] = t.ap.proposals({ days: 0 });
  assert.equal(t.ap.decide(q.id, "opened", "owner").response.action, "opened");
  assert.equal(t.ap.decide(q.id, "ignored", "owner").response.action, "ignored");
  assert.throws(() => t.ap.decide(q.id, "place"), { code: "invalid" });
  assert.throws(() => t.ap.decide("nope", "opened"), { code: "not_found" });
});

test("the risk guard's lock stops proposals; a results day for the stock cuts the size; a holiday means no watching", async () => {
  const s = desk();
  s.ap.trading = { positions: async () => ({ net: [] }), riskStatus: async () => ({ standing: { locked: true, lock: { reason: "the daily loss limit was reached" } } }) };
  await s.ap.tick();
  await s.run("09:15", "09:35", 498);
  await s.run("09:36", "09:44", 502.5);
  const [p] = s.ap.proposals({ days: 0 });
  assert.equal(p.status, "blocked");
  assert.ok(p.reasons.some((r) => /locked the day: the daily loss limit was reached/.test(r.text)));

  const t = desk();
  t.ap.addEvent({ date: DAY, kind: "results", symbols: ["ABC"], time: "15:45" }, "owner");
  await t.ap.tick();
  const pb = await t.ap.playbook("ABC", { withAccount: true });
  assert.equal(pb.events.today.noOvernight, true);
  assert.ok(pb.scenarios.find((x) => x.id === "break-long").sizeFactor <= 0.43, "results today and the expiry: ×0.5 × ×0.85");
  assert.ok(pb.events.today.events.some((e) => e.source === "yours"));
  assert.throws(() => t.ap.addEvent({ date: "tomorrow", kind: "fed" }), { code: "invalid" });
  const ev1 = t.ap.customEvents()[0];
  t.ap.removeEvent(ev1.id);
  assert.equal(t.ap.customEvents().length, 0);
  assert.throws(() => t.ap.removeEvent("nope"), { code: "not_found" });

  const h = desk();
  h.clock.t = istMs("2026-11-10", "09:50"); // Diwali Balipratipada
  assert.deepEqual(await h.ap.watch(), { watched: 0 });
  h.m.state = "none";
  h.clock.t = istMs(DAY, "09:50");
  assert.deepEqual(await h.ap.watch(), { watched: 0 }, "no Zerodha: nothing to watch");
});

test("every proposal is graded on the minute bars to its stop, its target or 3:15, in R after costs — and the record is kept", async () => {
  const s = desk();
  await s.ap.tick();
  await s.run("09:15", "09:35", 498);
  await s.run("09:36", "09:44", 502.5);
  const [p] = s.ap.proposals({ days: 0 });
  // the price climbs to the first target
  for (let x = 585; x <= 600; x += 1) s.put(`${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`, 505 + (x - 585) * 0.4, 0.3);
  s.clock.t = s.at("10:05");
  assert.equal(await s.ap.grade(), 1);
  const g = s.ap.proposals({ days: 0 })[0];
  assert.equal(g.outcome.how, "target");
  assert.equal(g.outcome.price, 510);
  assert.ok(g.outcome.r > 1.4 && g.outcome.r < 1.6, `R ${g.outcome.r}`);
  const L = s.ap.learned();
  assert.equal(L.overall.n, 1);
  assert.equal(L.byScenario["break-long"].n, 1);
  assert.equal(L.byScenario["break-long"].paused, false);
  assert.equal(await s.ap.grade(), 0, "graded once");
  // a minute that touches both the stop and the target is a loss
  const t = desk();
  await t.ap.tick();
  await t.run("09:15", "09:35", 498);
  await t.run("09:36", "09:44", 502.5);
  t.bars.push({ t: t.at("09:46"), o: 503, h: 511, l: 496, c: 505 });
  t.clock.t = t.at("09:50");
  await t.ap.grade();
  assert.equal(t.ap.proposals({ days: 0 })[0].outcome.how, "stop");
  assert.ok(t.ap.proposals({ days: 0 })[0].outcome.r <= -1);
  // nothing resolved by 3:15: out at the last price
  const u = desk();
  await u.ap.tick();
  await u.run("09:15", "09:35", 498);
  await u.run("09:36", "09:44", 502.5);
  for (let x = 585; x <= 915; x += 5) u.put(`${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`, 503.5, 0.4);
  u.clock.t = u.at("15:16");
  await u.ap.grade();
  assert.equal(u.ap.proposals({ days: 0 })[0].outcome.how, "time");
});

test("a setup whose recent proposals lost money is paused, and what it has measured is written for the AI", async () => {
  const s = desk();
  const recs = [];
  for (let i = 0; i < 14; i += 1) {
    const day = `2026-10-${String(1 + i).padStart(2, "0")}`;
    recs.push({ id: `${day}|ABC|break-long`, date: day, createdAt: `${day}T04:30:00.000Z`, symbol: "ABC", scenario: "break-long", label: "x", side: "long", status: "new", entry: 500, stop: 495, targets: [510], riskPerShare: 5, qty: 100, outcome: { how: "stop", price: 495, r: i < 2 ? 1.5 : -1.1, at: `${day}T08:00:00.000Z` } });
  }
  s.docs.putItems(COLLECTION, recs);
  const fresh = new Autopilot({ market: s.m, docs: s.docs, playbook: { setSection: (h, b) => s.written.push({ h, b }) }, now: () => s.clock.t, log: { log() {}, error() {} } });
  const L = fresh.relearn();
  assert.equal(L.byScenario["break-long"].n, 14);
  assert.equal(L.byScenario["break-long"].paused, true);
  assert.ok(L.byScenario["break-long"].avgR < -0.15);
  assert.equal(s.written.at(-1).h, "## What the autopilot has measured (written by itself after every close)");
  assert.match(s.written.at(-1).b, /Autopilot proposals graded so far: 14.*break-long: 14 proposals.*paused/s);
  assert.ok(!/guarantee|sure shot|risk-free|always wins|never loses/i.test(s.written.at(-1).b));
  // and the paused setup is refused when it fires
  s.ap._learn = L;
  s.docs.write("autopilot/learn.json", L);
  await s.ap.tick();
  await s.run("09:15", "09:35", 498);
  await s.run("09:36", "09:44", 502.5);
  const p = s.ap.proposals({ days: 0 })[0];
  assert.equal(p.status, "blocked");
  assert.ok(p.reasons.some((r) => /Paused: this setup's last 14 proposals averaged/.test(r.text)));
});

test("settings are the owner's, cleaned, and the board shows the day: events, the record and the calibration", async () => {
  const s = desk();
  const set = s.ap.setSettings({ capital: 2000000, riskPct: 0.25, exclude: ["tcs", "bad sym!"], on: true, notify: false }, "owner");
  assert.equal(set.capital, 2000000);
  assert.equal(set.riskPct, 0.25);
  assert.deepEqual(set.exclude, ["TCS"]);
  assert.equal(set.notify, false);
  s.ap.setSettings({ on: false }, "owner");
  await s.ap.tick();
  assert.equal(s.ap._prep.size, 0, "switched off: it does nothing");
  s.ap.setSettings({ on: true }, "owner");
  const cal = await s.ap.recalibrate();
  assert.equal(cal.available, true);
  const b = await s.ap.board({ withAccount: true });
  assert.equal(b.settings.capital, 2000000);
  assert.equal(b.today.date, DAY);
  assert.equal(b.today.tradingDay, true);
  assert.deepEqual(b.universe, ["ABC"]);
  assert.ok(b.events.some((e) => /expiry/.test(e.title)));
  assert.equal(b.calibration.available, true);
  assert.equal((await s.ap.board({ withAccount: false })).proposals.length, 0);
  assert.deepEqual((await s.ap.board({ withAccount: false })).settings, { on: true }, "an admin who is not the owner sees no capital");
});
