"use strict";
// NIFTY 50 / SENSEX history (market/indices.js), the Indices page's service and ledger
// (index-history.js) and the AI's checked projection. Everything runs on fakes: no broker, no
// network, no AI model, no timer.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const I = require("../market/indices");
const { IndexHistory } = require("../index-history");
const { FileDocs } = require("../docs");

/** A plain series: every weekday from `from`, with a chosen close for some days and a gentle drift otherwise. */
function series(from, to, { start = 1000, drift = 0.03, wobble = 0.6, seed = 7 } = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648), s / 2147483648);
  const out = [];
  let p = start;
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86400000) {
    const w = new Date(t).getUTCDay();
    if (w === 0 || w === 6) continue;
    const o = p;
    p = p * (1 + (drift + (rnd() + rnd() + rnd() - 1.5) * wobble * 1.6) / 100);
    out.push({ d: new Date(t).toISOString().slice(0, 10), o, h: Math.max(o, p) * 1.002, l: Math.min(o, p) * 0.998, c: p });
  }
  return out;
}

test("months and years: the move in points and percent from the previous close, the best and worst point inside, and the partial period marked", () => {
  const d = [
    { d: "2024-12-31", o: 100, h: 101, l: 99, c: 100 },
    { d: "2025-01-01", o: 100, h: 104, l: 99, c: 103 },
    { d: "2025-01-31", o: 103, h: 106, l: 95, c: 105 },
    { d: "2025-02-03", o: 105, h: 105, l: 97, c: 98 },
    { d: "2025-02-28", o: 98, h: 99, l: 96, c: 98 },
  ];
  const ms = I.monthsOf(d, { today: "2025-02-28" });
  assert.deepEqual(ms.map((m) => m.key), ["2024-12", "2025-01", "2025-02"]);
  const jan = ms[1];
  assert.deepEqual([jan.prevClose, jan.close, jan.chg, jan.pct, jan.high, jan.low], [100, 105, 5, 5, 106, 95]);
  assert.deepEqual([jan.upExcPct, jan.downExcPct, jan.rangePct, jan.days, jan.partial], [6, -5, 11, 2, false]);
  assert.equal(ms[2].partial, true, "the month of today is in progress");
  assert.deepEqual([ms[2].chg, ms[2].pct], [-7, -6.67]);
  assert.equal(ms[0].prevClose, null, "the first month has no previous close");
  const ys = I.yearsOf(d, ms, { today: "2025-02-28" });
  const y25 = ys.find((y) => y.y === 2025);
  assert.deepEqual([y25.prevClose, y25.close, y25.chg, y25.pct, y25.upMonths, y25.downMonths, y25.partial], [100, 98, -2, -2, 1, 0, true]);
  assert.equal(y25.maxDdPct, -10.38, "the deepest fall from a high inside the year: 106 to 95 (a day's high and low both count — the unkind reading)");
  assert.deepEqual([y25.bestMonth.m, y25.worstMonth.m], [1, 2]);
  // candles in Kite's shape are read the same way
  assert.equal(I.normalize([["2025-01-01", 1, 2, 0.5, 1.5], { t: "2025-01-02T00:00:00+0530", o: 1.5, h: 2, l: 1, c: 1.8 }]).length, 2);
});

test("each calendar month over the years, the table of years × months, the average year, and the patterns", () => {
  const d = series("2010-01-01", "2024-12-31");
  const a = I.analyze(d, { today: "2024-12-31" });
  assert.equal(a.available, true);
  assert.equal(a.yearsCovered, 13, "2011–2023: the first year has no previous close; the last is in progress");
  const mar = a.monthStats[2];
  assert.equal(mar.name, "March");
  assert.equal(mar.n, 15);
  assert.equal(mar.up + mar.down <= mar.n, true);
  assert.equal(mar.winRate, Math.round((mar.up / mar.n) * 100));
  assert.ok(mar.best.pct >= mar.avgPct && mar.worst.pct <= mar.avgPct);
  assert.ok(mar.avgUpExcPct > 0 && mar.avgDownExcPct < 0);
  assert.equal(mar.years.length, 15);
  assert.equal(mar.last10.n, 10);
  // the table: newest year first, twelve cells and the year
  assert.equal(a.heat[0].y, 2024);
  assert.equal(a.heat[0].cells.length, 12);
  assert.equal(a.heat[0].cells[11].partial, true);
  assert.equal(a.heat[a.heat.length - 1].y, 2010);
  // the average year
  assert.equal(a.seasonal.years, 13);
  assert.equal(a.seasonal.rows.length, 12);
  assert.ok(a.seasonal.rows.every((r) => r.p25 <= r.median && r.median <= r.p75));
  assert.equal(a.seasonal.current.y, 2024);
  // the patterns
  const p = a.patterns;
  assert.deepEqual(p.dayOfWeek.map((x) => x.name), ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
  assert.ok(p.turnOfMonth.turn.n > 0 && p.turnOfMonth.rest.n > p.turnOfMonth.turn.n);
  assert.ok(p.afterMonths.afterUp.n + p.afterMonths.afterDown.n >= 170);
  assert.ok(p.streaks.longestUp.n >= 1 && /^\w{3} \d{4}$/.test(p.streaks.longestUp.from));
  assert.ok(p.drawdowns.ath.close > 0 && p.drawdowns.now.pct <= 0);
  assert.deepEqual(p.elections.years.map((y) => y.y), [2014, 2019, 2024].filter((y) => y < 2024), "only complete election years");
});

test("the drawdowns: the all-time high, the fall from it now, and every fall of 10% or more with its recovery", () => {
  const d = [100, 110, 99, 95, 112, 115, 100, 90, 103].map((c, i) => ({ d: `2024-01-${String(i + 1).padStart(2, "0")}`, o: c, h: c, l: c, c }));
  const dd = I.drawdowns(d);
  assert.deepEqual(dd.ath, { close: 115, d: "2024-01-06" });
  assert.deepEqual(dd.now, { pct: -10.43, sessions: 3 });
  assert.equal(dd.episodes.length, 2);
  assert.deepEqual([dd.episodes[0].peak, dd.episodes[0].trough, dd.episodes[0].pct, dd.episodes[0].recovered], ["2024-01-06", "2024-01-08", -21.74, null]);
  assert.deepEqual([dd.episodes[1].pct, dd.episodes[1].recovered], [-13.64, "2024-01-05"]);
});

test("the projection for a month: made from what was known before it began, with its parts, a 68% and 90% band from the index's volatility, and carried forward inside the month", () => {
  const d = I.normalize(series("2012-01-01", "2024-11-14"));
  const months = I.monthsOf(d, { today: "2024-11-14" });
  const start = I.projectMonth(months, d, "2024-11");
  assert.equal(start.available, true);
  assert.equal(start.period, "2024-11");
  assert.equal(start.label, "Nov 2024");
  assert.equal(start.base, start.base0, "at the start the base is October's close");
  assert.equal(start.base0, months.find((m) => m.key === "2024-10").close);
  assert.ok(start.low90 < start.low68 && start.low68 < start.mid && start.mid < start.high68 && start.high68 < start.high90);
  assert.equal(start.daysTotal, 21);
  assert.equal(start.daysLeft, 21);
  assert.ok(["up", "down", "none"].includes(start.lean));
  assert.ok(start.probUp >= 0 && start.probUp <= 100);
  assert.equal(start.parts.seasonal.n, 12, "Novembers before this one");
  assert.ok(start.parts.regime && ["above", "below"].includes(start.parts.regime.state));
  assert.match(start.reasons[0], /^November rose in \d+ of 12 years on record/);
  // no look-ahead: the start projection does not change when November's days are added
  const before = I.normalize(d.filter((x) => x.d < "2024-11-01"));
  const same = I.projectMonth(I.monthsOf(before, { today: "2024-11-01" }), before, "2024-11");
  assert.deepEqual([same.mid, same.low68, same.high68, same.probUp], [start.mid, start.low68, start.high68, start.probUp]);
  // inside the month: from today's close, a narrower band for the sessions left, and the chance the month ends up
  const last = d[d.length - 1];
  const live = I.projectMonth(months, d, "2024-11", { asOf: { d: last.d, close: last.c } });
  assert.equal(live.base, Math.round(last.c * 100) / 100);
  assert.equal(live.daysLeft, 11);
  assert.ok(live.sigmaPct < start.sigmaPct);
  assert.ok(live.high68 - live.low68 < start.high68 - start.low68);
  // too little history says so
  const short = I.normalize(series("2023-01-01", "2024-02-10"));
  assert.match(I.projectMonth(I.monthsOf(short, { today: "2024-02-10" }), short, "2024-02").reason, /Two years of complete months are needed/);
});

test("the walk-forward record: every past month projected with only what came before, scored against the 'it rises' base rate, the bands and 'no change'", () => {
  const d = I.normalize(series("2008-01-01", "2024-12-31", { drift: 0.04 }));
  const months = I.monthsOf(d, { today: "2024-12-31" });
  const years = I.yearsOf(d, months, { today: "2024-12-31" });
  const wf = I.walkForward(months, years, d, "month");
  const s = wf.summary;
  assert.equal(s.n, wf.rows.length);
  assert.ok(s.n >= 170);
  assert.equal(s.hitRate, Math.round((s.hits / s.leaned) * 100));
  assert.ok(s.upShare > 0 && s.upShare < 100, "the base rate to beat");
  // the bands are calibrated: about 68% and 90% of the closes fall inside
  assert.ok(s.in68Rate >= 58 && s.in68Rate <= 80, `68% band held ${s.in68Rate}%`);
  assert.ok(s.in90Rate >= 82 && s.in90Rate <= 97, `90% band held ${s.in90Rate}%`);
  assert.ok(s.maeNaivePct > 0);
  const row = wf.rows[0];
  assert.deepEqual(Object.keys(row).slice(0, 4), ["period", "label", "y", "base"]);
  assert.equal(row.in68, row.actual >= row.low68 && row.actual <= row.high68);
  assert.ok(wf.byYear.length >= 14);
  const wy = I.walkForward(months, years, d, "year");
  assert.ok(wy.summary.n >= 10 && wy.rows.every((r) => /^\d{4}$/.test(r.period)));
});

test("two indices side by side: month by month and year by year, how closely they move and where they parted most", () => {
  const a = I.analyze(series("2015-01-01", "2024-06-30", { seed: 3 }), { today: "2024-06-30" });
  const b = I.analyze(series("2015-01-01", "2024-06-30", { seed: 3, start: 3300 }).map((x, i) => ({ ...x, c: x.c * (1 + (i % 50 === 0 ? 0.004 : 0)) })), { today: "2024-06-30" });
  const c = I.compare(a, b);
  assert.ok(c.months.n >= 100);
  assert.ok(c.months.corr > 0.95);
  assert.ok(c.months.sameDirPct >= 90);
  assert.equal(c.months.aBetter + c.months.bBetter <= c.months.n, true);
  assert.equal(c.rows[0].y, 2024);
  assert.equal(c.rows[0].months.length, 12);
  assert.ok(c.rows[0].months[0].a.pct !== undefined && c.rows[0].months[0].b.pct !== undefined);
  assert.equal(c.rows[0].months[11], null, "no December yet");
  assert.ok(c.largestGaps.length > 0 && Math.abs(c.largestGaps[0].diff) >= Math.abs(c.largestGaps[c.largestGaps.length - 1].diff));
});

/* ---------------------------------------------------------------------------- the service */

function boot({ mode = "kite", ai = null, today = "2026-11-13", time = "16:00" } = {}) {
  const docs = new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-ix-")));
  const clock = { ms: Date.parse(`${today}T${time}:00+05:30`) };
  const reads = [];
  const data = { NIFTY: series("2008-01-01", today, { start: 5000, seed: 5 }), SENSEX: series("2008-01-01", today, { start: 17000, seed: 5 }) };
  const market = {
    mode: () => mode,
    indexDaily: async (id, { fromMs } = {}) => {
      reads.push({ id, from: fromMs ? new Date(fromMs).toISOString().slice(0, 10) : "first" });
      const cut = new Date(clock.ms + 5.5 * 3600000).toISOString().slice(0, 10);
      return data[id].filter((c) => c.d <= cut && (!fromMs || Date.parse(`${c.d}T00:00:00Z`) >= fromMs)).map((c) => ({ t: c.d, o: c.o, h: c.h, l: c.l, c: c.c }));
    },
    social: { signal: () => ({ mood: { label: "Positive", score: 22 } }) },
    marketForecast: async () => ({ available: true, lean: { word: "up", score: 30 }, headline: "NSE leans up" }),
  };
  const ix = new IndexHistory({ market, ai, docs, now: () => clock.ms, log: { log() {}, error() {} } });
  return { ix, docs, clock, reads, data };
}

test("the page's data: the history read once from Zerodha and topped up after, the desk's projections frozen in the ledger, and scored when the period ends", async () => {
  const { ix, docs, clock, reads } = boot();
  const v = await ix.view("NIFTY");
  assert.equal(v.available, true);
  assert.deepEqual([v.index.id, v.index.name, v.demo, v.source], ["NIFTY", "NIFTY 50", false, "kite"]);
  assert.equal(v.months, undefined, "the raw months stay on the server; the table is sent");
  assert.ok(v.heat.length >= 18 && v.monthStats.length === 12 && v.years.length >= 18);
  assert.equal(v.to, "2026-11-13");
  assert.deepEqual(reads, [{ id: "NIFTY", from: "first" }], "the first read goes back as far as Kite keeps");
  assert.equal(docs.read("indices/candles-NIFTY.json", null).candles[0][0], "2008-01-01");
  // the desk's projections for November and for 2026 are in the ledger, made from the data before each began
  const l = v.ledger.items;
  assert.deepEqual(l.map((x) => [x.kind, x.horizon, x.period, x.status]).sort(), [["desk", "month", "2026-11", "open"], ["desk", "year", "2026", "open"]]);
  const nov = l.find((x) => x.horizon === "month");
  assert.equal(nov.startLevel, v.projections.month.start.base0);
  assert.equal(nov.mid, v.projections.month.start.mid);
  // a second look is served from the saved copy; the next day it is topped up from ten days before the last saved day
  await ix.view("NIFTY");
  assert.equal(reads.length, 1);
  clock.ms = Date.parse("2026-12-02T16:00:00+05:30");
  const dec = await ix.view("NIFTY");
  assert.deepEqual(reads[1], { id: "NIFTY", from: "2026-11-03" });
  // November is over: its projection is scored, December's is frozen, and nothing else in the ledger changed
  const done = dec.ledger.items.find((x) => x.period === "2026-11");
  assert.equal(done.status, "settled");
  assert.equal(done.actual, dec.heat[0].cells[10].close);
  assert.equal(typeof done.in68, "boolean");
  assert.equal(done.actualPct, Math.round(((done.actual - done.startLevel) / done.startLevel) * 10000) / 100);
  assert.deepEqual([done.mid, done.low68, done.startLevel], [nov.mid, nov.low68, nov.startLevel], "the projection itself is never rewritten");
  assert.ok(dec.ledger.items.some((x) => x.period === "2026-12" && x.kind === "desk"));
  assert.equal(dec.ledger.desk.month.n, 1);
  // SENSEX has its own history and ledger; side by side reads both
  const c = await ix.compare();
  assert.equal(c.available, true);
  assert.deepEqual([c.a.name, c.b.name], ["NIFTY 50", "SENSEX"]);
  assert.ok(c.months.n > 200);
});

test("without Zerodha: the saved history with a note, or a clear message; in demo mode two synthetic series, named as such, never in the ledger", async () => {
  const off = boot({ mode: "none" });
  await assert.rejects(off.ix.view("NIFTY"), /needs the Zerodha connection/);
  const on = boot();
  await on.ix.view("SENSEX");
  const later = new IndexHistory({ market: { mode: () => "none" }, docs: on.docs, now: () => on.clock.ms + 86400000, log: { log() {}, error() {} } });
  const v = await later.view("SENSEX");
  assert.equal(v.stale, true);
  assert.match(v.staleReason, /Zerodha is not connected: showing the history saved on 2026-11-13/);
  const d = boot({ mode: "demo" });
  const dv = await d.ix.view("NIFTY");
  assert.deepEqual([dv.demo, dv.index.name, dv.source], [true, "Demo index A", "demo"]);
  assert.ok(dv.from <= "2005-01-03");
  assert.equal(dv.ledger.items.length, 0, "demo series are not backtested");
});

function fakeAi(answer, seen = []) {
  return { modelChain: () => [{ name: "Claude Sonnet 5.5" }], indexAi: { ready: () => true, project: async (snap) => (seen.push(snap), typeof answer === "function" ? answer(snap) : answer) } };
}

test("the AI's projection: shown the desk's work, checked against the index's own volatility, kept frozen, and scored like the desk's", async () => {
  const seen = [];
  const { ix, clock } = boot({ ai: fakeAi((snap) => ({ lean: "up", close: Math.round(snap.deskProjection.expectedClose * 1.002), low: snap.deskProjection.range68[0], high: snap.deskProjection.range68[1], probUp: 62, reasons: ["November rose in most years."], risks: ["A close under the start."], confidence: "medium", by: "Claude Sonnet 5.5", cached: false }), seen) });
  const e = await ix.askAi("NIFTY", "month");
  const snap = seen[0];
  // what it was shown: the desk's numbers, nothing it could not check
  assert.deepEqual([snap.index, snap.horizon, snap.period], ["NIFTY 50", "month", "Nov 2026"]);
  assert.ok(snap.calendarMonth.years >= 17 && snap.calendarMonth.byYear.length > 0);
  assert.ok(snap.deskRecordWalkForward.n > 100);
  assert.deepEqual(snap.newsMood, { mood: "Positive", score: 22 });
  assert.equal(snap.nseForecastFromTheWorld.headline, "NSE leans up");
  assert.equal(snap.sessionsLeft, 11);
  // what was kept
  assert.deepEqual([e.kind, e.trigger, e.status, e.by, e.lean, e.probUp], ["ai", "asked", "open", "Claude Sonnet 5.5", "up", 62]);
  assert.equal(e.check.ok, true);
  assert.deepEqual(e.check.notes, []);
  assert.ok(e.desk.mid > 0, "the desk's projection at that moment is kept beside it");
  assert.equal(ix.settings().aiToday, 1);
  await assert.rejects(ix.askAi("NIFTY", "month"), /One every three hours/);
  // a close beyond the volatility is refused with the reason; a range too narrow is marked overconfident
  const wild = boot({ ai: fakeAi((snap) => ({ lean: "up", close: Math.round(snap.level * 1.4), low: snap.level, high: Math.round(snap.level * 1.5), probUp: 90, reasons: [], risks: [], confidence: "high", by: "Claude Sonnet 5.5", cached: false })) });
  const bad = await wild.ix.askAi("SENSEX", "month");
  assert.equal(bad.status, "refused");
  assert.match(bad.check.notes[0], /is beyond what the index's own volatility allows in 11 sessions \(98% range/);
  const tight = boot({ ai: fakeAi((snap) => ({ lean: "down", close: snap.level, low: snap.level - 1, high: snap.level + 1, probUp: 70, reasons: [], risks: [], confidence: "high", by: "Claude Sonnet 5.5", cached: false })) });
  const t = await tight.ix.askAi("NIFTY", "year");
  assert.equal(t.status, "open");
  assert.match(t.check.notes.join(" "), /narrower than half of what the index's volatility allows.*likely overconfident/);
  assert.match(t.check.notes.join(" "), /Its lean \(down\) and its chance of an up period \(70%\) disagree/);
  // the month ends: the AI's projection is scored against where the month began
  clock.ms = Date.parse("2026-12-01T16:00:00+05:30");
  const v = await ix.view("NIFTY");
  const s = v.ledger.items.find((x) => x.kind === "ai");
  assert.equal(s.status, "settled");
  assert.equal(typeof s.dirHit, "boolean");
  assert.equal(s.in90, null, "it gave one range, not two");
  assert.equal(v.ledger.ai.month.n, 1);
  assert.equal(v.ledger.ai.month.in90Rate, null);
  // no key: a clear message
  const none = boot();
  await assert.rejects(none.ix.askAi("NIFTY", "month"), /No AI key is saved/);
});

test("by itself: after the close the day is read and recorded; the AI's month projection in the first week of the month, once; never in demo mode", async () => {
  const seen = [];
  const answer = (snap) => ({ lean: "up", close: snap.deskProjection.expectedClose, low: snap.deskProjection.range68[0], high: snap.deskProjection.range68[1], probUp: 60, reasons: [], risks: [], confidence: "low", by: "Claude Sonnet 5.5", cached: false });
  const { ix, clock, reads } = boot({ ai: fakeAi(answer, seen), today: "2026-11-03", time: "09:00" });
  await ix.tick();
  assert.equal(seen.length, 1, "the month's projection, on a weekday of the first week");
  assert.equal(ix._ledger().filter((x) => x.kind === "ai")[0].trigger, "auto");
  await ix.tick();
  assert.equal(seen.length, 2, "one a round: the next round asks for SENSEX");
  await ix.tick();
  assert.equal(seen.length, 2, "once a month for each index");
  clock.ms = Date.parse("2026-11-03T15:45:00+05:30");
  const before = reads.length;
  await ix.tick();
  assert.ok(reads.length > before, "after the close the history is topped up");
  ix.setSettings({ aiAuto: false });
  clock.ms = Date.parse("2026-12-01T09:00:00+05:30");
  await ix.tick();
  assert.equal(seen.length, 2, "switched off: not asked");
  const d = boot({ mode: "demo", ai: fakeAi(answer, seen), today: "2026-11-02", time: "09:00" });
  await d.ix.tick();
  assert.equal(seen.length, 2, "demo data never costs AI credits by itself");
  // the reading TradeAI's agent gets
  const b = await ix.brief("NIFTY");
  assert.equal(b.index, "NIFTY 50");
  assert.ok(b.thisCalendarMonthInHistory.years >= 17);
  assert.ok(b.deskProjection.month.range68.length === 2);
  assert.equal(b.aiProjection.month.by, "Claude Sonnet 5.5");
});
