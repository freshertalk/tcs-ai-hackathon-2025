"use strict";
// Trade Analysis's memory: the day's snapshot (a timeline with timestamps and the day's own profit curve),
// what became of each trade's peak (booked, given back, left early, never paid…), the outcomes table, and
// the register of learnings with the trader's own status. Everything is faked: no network, no broker.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { DayAnalysis } = require("../analysis/service");
const SNAP = require("../analysis/snapshot");
const { FileDocs } = require("../docs");

const DAY = "2026-11-12";
const T0 = Date.parse(`${DAY}T09:15:00+05:30`);

/** A scripted price path, one 1-minute bar a minute from 9:15 (piecewise linear through the key points). */
function path1(keys) {
  const bars = [];
  for (let i = 0; i <= 375; i += 1) {
    let k = 0;
    while (k + 1 < keys.length - 1 && keys[k + 1][0] <= i) k += 1;
    const [a, pa] = keys[k];
    const [b, pb] = keys[k + 1];
    const px = i <= a ? pa : i >= b ? pb : pa + ((pb - pa) * (i - a)) / (b - a);
    bars.push({ t: T0 + i * 60000, o: px, h: px + 0.2, l: px - 0.2, c: px, v: 500 });
  }
  return bars;
}
const BARS = path1([
  [0, 800], [30, 800], [40, 812], [55, 795], [60, 790], [80, 790], [90, 806], [100, 796], [105, 796], [106, 800], [140, 830],
  [150, 830], [200, 800], [204, 800], [205, 800], [215, 797], [216, 797], [260, 805], [270, 815], [290, 807], [375, 800],
]);
const at = (i) => BARS[i].t;
function trip(key, symbol, side, inMin, outMin, qty = 50) {
  const e = BARS[inMin].c;
  const x = BARS[outMin].c;
  const pnl = Math.round((side === "long" ? x - e : e - x) * qty * 100) / 100;
  return { key, symbol, exchange: "NSE", side, product: "MIS", intraday: true, entryAt: at(inMin), exitAt: at(outMin), entryAvg: e, exitAvg: x, maxQty: qty, qty, pnl, charges: 20, net: pnl - 20, holdMin: outMin - inMin, parts: { brokerage: 10, stt: 5, exchange: 3, sebi: 0, gst: 1, stamp: 1, dp: 0 } };
}
// one trade of each kind, in the order they were taken
const TRIPS = [
  trip("wl", "SBIN", "long", 30, 55), // up 12 then back under the entry: winner turned loser
  trip("nb", "SBIN", "long", 80, 90), // out at the top
  trip("le", "SBIN", "long", 101, 106), // out small, the price then ran 30 points
  trip("lc", "SBIN", "long", 151, 160), // never went up, out before it fell much further
  trip("np", "SBIN", "long", 205, 215), // never went up, and it recovered after: no sparing
  trip("gb", "SBIN", "long", 261, 290), // peak at 270, stayed 20 minutes longer
];

function boot({ trips = TRIPS, now = Date.parse(`${DAY}T16:00:00+05:30`), flights = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-snap-"));
  const docs = new FileDocs(dir);
  const clock = { ms: now };
  let fetched = 0;
  const source = {
    closedTrips: async (date) => trips.filter((t) => new Date(t.exitAt + 5.5 * 3600 * 1000).toISOString().slice(0, 10) === date),
    minuteBars: async (sym, from, to) => {
      fetched += 1;
      return BARS.filter((b) => b.t >= from && b.t <= to);
    },
    discipline: () => ({ targetPct: 3, stopPct: 1.5 }),
    daysWithTrips: async () => [DAY],
    flightDay: async () => ({ available: flights.length > 0, flights }),
    funds: async () => null,
    positions: async () => [],
    market: async () => null,
  };
  const svc = new DayAnalysis({ docs, source, now: () => clock.ms, log: { log() {} } });
  return { svc, docs, clock, fetches: () => fetched };
}

test("each trade's peak: what became of it — booked, given back, left early, turned into a loss, never paid, cut in time", async () => {
  const { svc } = boot();
  const s = await svc.snapshot(DAY);
  assert.equal(s.available, true);
  const by = Object.fromEntries(s.trades.map((t) => [t.key, t]));
  assert.equal(by.wl.outcome.id, "winner-to-loser");
  assert.equal(by.nb.outcome.id, "near-best");
  assert.equal(by.le.outcome.id, "left-early");
  assert.equal(by.lc.outcome.id, "loss-cut");
  assert.equal(by.np.outcome.id, "never-paid");
  assert.equal(by.gb.outcome.id, "gave-back");
  // the peak of the winner-turned-loser is at 9:55 AM (minute 40) and was worth money you did not book
  assert.equal(by.wl.peak.clock, "09:55");
  assert.ok(by.wl.peak.pnl > 500 && by.wl.net < 0);
  assert.ok(by.wl.leftOnTable > 500);
  assert.match(by.wl.outcome.text, /09:55/);
  assert.equal(by.gb.peak.clock, "13:45", "the best moment of the last trade, with its time");
  assert.ok(by.gb.gapMin >= 15 && by.gb.leftOnTable > 300);
  assert.ok(by.le.missed > 1000, "what the price offered after you left");
  assert.equal(by.nb.gapMin <= 2, true);
  for (const t of s.trades) assert.ok(t.outcome.text.length > 10);
});

test("the timeline: every moment has its timestamp, in order — entries, peaks, exits, and what the price offered after", async () => {
  const { svc } = boot();
  const s = await svc.snapshot(DAY);
  const kinds = new Set(s.moments.map((m) => m.kind));
  for (const k of ["entry", "peak", "exit", "after", "day-peak"]) assert.ok(kinds.has(k), `a ${k} moment`);
  for (let i = 1; i < s.moments.length; i += 1) assert.ok(s.moments[i].at >= s.moments[i - 1].at, "in time order");
  for (const m of s.moments) assert.match(m.clock, /^\d{2}:\d{2}$/);
  const peak = s.moments.find((m) => m.kind === "peak" && m.key === "wl");
  assert.equal(peak.clock, "09:55");
  assert.match(peak.text, /at its best while you were in/);
  assert.match(peak.text, /stayed in/);
  // the entry carries the habits flagged on it
  assert.ok(s.moments.find((m) => m.kind === "entry" && m.key === "wl").flags);
});

test("the day's own profit curve: its peak and trough with their times, and how much of the peak was given back", async () => {
  const { svc } = boot();
  const s = await svc.snapshot(DAY);
  assert.equal(s.day.measured, true);
  assert.ok(s.day.peak.pnl > 0 && s.day.peak.clock && Array.isArray(s.day.peak.holding));
  assert.equal(s.day.close, s.summary.net);
  assert.ok(s.day.givenBack >= 0);
  assert.equal(s.day.givenBack, Math.round(Math.max(0, s.day.peak.pnl - s.day.close) * 100) / 100);
  assert.ok(s.day.curve.length > 20 && s.day.curve.length < 120, "thinned for storage");
  assert.ok(s.day.curve.some(([t, v]) => t === s.day.peak.at && v === s.day.peak.pnl), "the peak is on the curve");
  assert.match(s.headline.join(" "), /peaked at/);
  assert.ok(s.headline.some((h) => /biggest peak not booked/.test(h)));
});

test("the daily stop and target: the minute the day's profit or loss crossed them, and the trades taken after", () => {
  // a day that only loses: one losing short trade on a rising path
  const bars = { SBIN: BARS };
  const lab = { trades: [{ ...trip("x", "SBIN", "short", 30, 60), n: 1, flags: [], intraday: true, entryClock: "09:45", exitClock: "10:15", read: null, whatIf: {} }], limits: { stop: 200, target: 50000 }, summary: { net: -999, score: 50 }, notes: [] };
  const snap = SNAP.buildSnapshot({ date: DAY, lab, bars });
  assert.ok(snap.day.stopAt, "the loss reached the stop");
  assert.ok(snap.moments.find((m) => m.kind === "stop"));
  assert.equal(snap.moments.find((m) => m.kind === "target"), undefined);
});

test("the live board's recorded signals join the timeline for the trade they belong to", async () => {
  const flights = [{ symbol: "SBIN", side: "long", entryAt: at(80), events: [{ at: at(85), clock: "10:40", kind: "signal", state: "tighten", text: "TIGHTEN: the buyers are tiring." }, { at: at(88), clock: "10:43", kind: "alert", text: "Sent to your phone: EXIT NOW." }, { at: at(20), clock: "09:35", kind: "signal", text: "before the trade: ignored" }] }];
  const { svc } = boot({ flights });
  const s = await svc.snapshot(DAY);
  const sig = s.moments.filter((m) => m.kind === "signal" || m.kind === "alert");
  assert.equal(sig.length, 2, "only the events inside the trade");
  assert.match(sig[0].text, /TIGHTEN/);
  assert.equal(sig[0].key, "nb");
});

test("a snapshot is written from the lab's own replay (no second read of the bars), kept, and rebuilt only when the trades change", async () => {
  const { svc, docs, fetches } = boot();
  await svc.lab(DAY);
  assert.equal(fetches(), 1);
  assert.equal(docs.items("analysis_snapshots").length, 1, "the snapshot was recorded with the replay");
  assert.equal(docs.items("analysis_outcomes").length, 6, "one outcome row per trade");
  const s = await svc.snapshot(DAY);
  assert.equal(fetches(), 1, "read back without another read of the bars");
  assert.equal(s.trades.length, 6);
  await svc.snapshot(DAY, { refresh: true });
  assert.equal(fetches(), 2, "refresh replays it again");
  assert.equal(docs.items("analysis_outcomes").length, 6, "the day's rows are replaced, not added to");
  assert.equal(svc.snapshots().length, 1);
  assert.equal((await svc.snapshot("2026-11-11")).available, false, "a day without trades says so");
});

test("a snapshot that is missing (the lab had already replayed the day) is built by the sweep, and an old one is not rebuilt", async () => {
  const { svc, docs, fetches } = boot();
  await svc.lab(DAY);
  docs.removeItems("analysis_snapshots", [DAY]);
  docs.removeItems("analysis_outcomes", docs.items("analysis_outcomes").map((r) => r.id));
  assert.equal(docs.items("analysis_snapshots").length, 0);
  assert.deepEqual(await svc.snapshotBackfill(), [DAY]);
  assert.equal(docs.items("analysis_outcomes").length, 6);
  assert.deepEqual(await svc.snapshotBackfill(), [], "nothing missing now");
  assert.ok(fetches() >= 2);
});

test("outcomes: one table across the days, filtered by outcome, with what each kind cost", async () => {
  const { svc } = boot();
  await svc.lab(DAY);
  const all = svc.outcomes({});
  assert.equal(all.total, 6);
  assert.equal(all.days, 1);
  assert.equal(all.rows[0].date, DAY);
  assert.equal(all.summary.byOutcome.find((o) => o.id === "winner-to-loser").count, 1);
  assert.ok(all.summary.leftOnTable > 1000, "what was left on the table, added up");
  assert.ok(all.summary.peakOnOffer > all.summary.took);
  assert.equal(svc.outcomes({ outcome: "gave-back" }).total, 1);
  assert.equal(svc.outcomes({ outcome: "gave-back" }).rows[0].symbol, "SBIN");
  assert.equal(svc.outcomes({ from: "2026-11-13" }).total, 0);
  assert.equal(svc.outcomes({ symbol: "TCS" }).total, 0);
});

test("learnings: what not to repeat is counted from the outcomes and habits, with its cost and the rule; what worked is listed too", async () => {
  const { svc } = boot();
  await svc.lab(DAY);
  const l = svc.learnings();
  const g = Object.fromEntries(l.learnings.map((x) => [x.id, x]));
  assert.equal(g["o:winner-to-loser"].count, 1);
  assert.ok(g["o:winner-to-loser"].cost > 500);
  assert.match(g["o:winner-to-loser"].rule, /break-even/);
  assert.equal(g["o:winner-to-loser"].kind, "avoid");
  assert.equal(g["o:winner-to-loser"].lastSeen, DAY);
  assert.equal(g["o:winner-to-loser"].recent[0].symbol, "SBIN");
  assert.equal(g["k:near-best"].kind, "keep");
  assert.equal(g["k:near-best"].state, "strength");
  assert.ok(l.learnings.findIndex((x) => x.kind === "keep") > l.learnings.findLastIndex((x) => x.kind === "avoid"), "the mistakes come first");
  assert.ok(l.learnings.every((x) => x.status === "open"));
});

test("learnings: your status and note on each, your own lessons, a flag when a mastered habit comes back — and the measured ones cannot be deleted", async () => {
  const { svc } = boot();
  await svc.lab(DAY);
  let l = svc.setLearning("o:gave-back", { status: "working", note: "trail at 0.5%" });
  const gb = l.learnings.find((x) => x.id === "o:gave-back");
  assert.equal(gb.status, "working");
  assert.equal(gb.note, "trail at 0.5%");
  // mastered today: the habit seen today is not a relapse; seen later it is
  l = svc.setLearning("o:never-paid", { status: "mastered" });
  const np = l.learnings.find((x) => x.id === "o:never-paid");
  assert.equal(np.masteredAt, "2026-11-12");
  assert.equal(np.relapse, false);
  const rows = svc._tbl("analysis_outcomes").map((r) => ({ ...r, date: "2026-11-20", id: `2026-11-20:${r.key}` }));
  const later = SNAP.learnings([...svc._tbl("analysis_outcomes"), ...rows], svc._tbl("analysis_learnings"), []);
  assert.equal(later.find((x) => x.id === "o:never-paid").relapse, true, "it came back after you marked it mastered");
  // own lessons
  l = svc.addLearning({ text: "No trade in the first five minutes after a loss", rule: "Wait 15 minutes." });
  const own = l.learnings.find((x) => x.source === "own");
  assert.equal(own.status, "open");
  assert.equal(own.rule, "Wait 15 minutes.");
  l = svc.setLearning(own.id, { status: "working", text: "No trade for 15 minutes after a loss" });
  assert.equal(l.learnings.find((x) => x.id === own.id).title, "No trade for 15 minutes after a loss");
  assert.throws(() => svc.addLearning({ text: "x" }), /a few words/);
  assert.throws(() => svc.setLearning("o:gave-back", { status: "nonsense" }), /status is one of/);
  assert.throws(() => svc.setLearning("nope", { status: "open" }), /no such learning/);
  assert.throws(() => svc.removeLearning("o:gave-back"), /cannot be deleted/);
  l = svc.removeLearning(own.id);
  assert.equal(l.learnings.find((x) => x.id === own.id), undefined);
  // ignored ones drop to the bottom
  l = svc.setLearning("o:winner-to-loser", { status: "ignored" });
  const last = l.learnings.filter((x) => x.kind === "avoid").pop();
  assert.equal(last.id, "o:winner-to-loser");
});

test("repeating, easing and quiet: how many recorded days ago a habit last happened", () => {
  const row = (date, n) => ({ id: `${date}:${n}`, date, key: n, symbol: "X", entryAt: Date.parse(`${date}T05:00:00Z`) + n, entryClock: "10:30", net: -100, outcome: "gave-back", flags: [], leftOnTable: 100 });
  const dates = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10", "2026-11-11"];
  const repeating = SNAP.learnings([row("2026-11-10", 1), row("2026-11-11", 2)], [], dates).find((x) => x.id === "o:gave-back");
  assert.equal(repeating.state, "repeating");
  assert.equal(repeating.days, 2);
  assert.equal(repeating.daysSince, 0);
  const quiet = SNAP.learnings([row("2026-11-02", 1)], [], dates).find((x) => x.id === "o:gave-back");
  assert.equal(quiet.state, "quiet");
  assert.equal(quiet.daysSince, 7);
  const easing = SNAP.learnings([row("2026-11-06", 1)], [], dates).find((x) => x.id === "o:gave-back");
  assert.equal(easing.state, "easing");
});

test("classify: unmeasured trades, scratches and the thresholds", () => {
  const trade = (read, pnl, net) => ({ intraday: true, exitAt: 1000000, exitClock: "11:00", pnl, net, read });
  assert.equal(SNAP.classify({ intraday: true, exitClock: "11:00", pnl: 5, net: 1, read: null }).id, "unmeasured");
  assert.equal(SNAP.classify({ intraday: false, pnl: 5, net: 1, read: null }).text.includes("overnight"), true);
  const tm = (gap, left, eff) => ({ gapMin: gap, leftOnTable: left, efficiency: eff });
  const pk = { at: 5, clock: "10:00", price: 100, pnl: 40, kind: "profit" };
  assert.equal(SNAP.classify(trade({ bestExit: pk, timing: tm(0, 0, 100), mfePct: 0.1, ranOn: 0, avoided: 0 }, 3, 1)).id, "scratch", "a move under 0.3% is noise");
  assert.equal(SNAP.classify(trade({ bestExit: pk, timing: tm(1, 4, 90), mfePct: 0.5 }, 36, 30)).id, "near-best");
  assert.equal(SNAP.classify(trade({ bestExit: pk, timing: tm(10, 14, 65), mfePct: 0.5 }, 26, 20)).id, "kept-most");
  assert.equal(SNAP.classify(trade({ bestExit: pk, timing: tm(10, 30, 25), mfePct: 0.5 }, 10, 4)).id, "gave-back");
  assert.equal(SNAP.classify(trade({ bestExit: pk, timing: tm(10, 45, -12), mfePct: 0.5 }, -5, -9)).id, "winner-to-loser");
});

test("the folder holds no broker and no order code; the tables are collections of their own", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "analysis", "snapshot.js"), "utf8");
  assert.ok(!/require\(["']\.\.\/trading/.test(src) && !/setInterval|setTimeout|fetch\(|placeOrder|\/orders/.test(src));
  const { COLLECTIONS } = require("../docs");
  for (const name of ["analysis_snapshots", "analysis_outcomes", "analysis_learnings"]) assert.ok(COLLECTIONS.includes(name), `${name} is loaded from MongoDB at start`);
});
