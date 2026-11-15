"use strict";
// Trade Analysis: the day's report by arithmetic, the practices it finds, the analytics over many
// days, the saved records, hand edits, and the 3:45 PM capture. Everything is faked: no network.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildDay, analytics, chargeSet } = require("../analysis/day");
const { DayAnalysis } = require("../analysis/service");
const { chargeParts, charges } = require("../trading/journal");
const { FileDocs } = require("../docs");

const IST = 5.5 * 3600 * 1000;
const at = (date, hhmm) => Date.parse(`${date}T${hhmm}:00+05:30`);
const D = "2026-11-13";

/** A closed round trip as the journal makes one (intraday, NSE). */
function trip(symbol, side, qty, entry, exit, entryHM, exitHM, date = D) {
  const long = side === "long";
  const pnl = Math.round((long ? exit - entry : entry - exit) * qty * 100) / 100;
  const t = { key: `${symbol}:${date}:${entryHM}`, symbol, exchange: "NSE", side, qty, maxQty: qty, entryAvg: entry, exitAvg: exit, entryAt: at(date, entryHM), exitAt: at(date, exitHM), turnoverBuy: (long ? entry : exit) * qty, turnoverSell: (long ? exit : entry) * qty, pnl, open: false, intraday: true, product: "MIS" };
  t.holdMin = Math.round((t.exitAt - t.entryAt) / 60000);
  t.parts = chargeParts(t);
  t.charges = charges(t);
  t.net = Math.round((pnl - t.charges) * 100) / 100;
  return t;
}

const FUNDS = { net: 98000, available: { cash: 91000, opening: 100000, live: 92500 }, used: { debits: 6000 } };

test("charges: broken into brokerage, STT, exchange fee, SEBI fee, GST, stamp duty and DP — and they still add up to the journal's total", () => {
  const t = trip("SBIN", "long", 100, 1000, 1010, "10:00", "11:00");
  const p = chargeParts(t);
  assert.deepEqual(Object.keys(p), ["brokerage", "stt", "exchange", "sebi", "gst", "stamp", "dp"]);
  assert.equal(Math.round((p.brokerage + p.stt + p.exchange + p.sebi + p.gst + p.stamp + p.dp) * 100) / 100, charges(t));
  assert.ok(p.brokerage > 0 && p.stt > 0 && p.gst > 0 && p.stamp > 0);
  assert.equal(p.dp, 0, "no DP charge on an intraday trade");
  const set = chargeSet(p);
  assert.equal(set.total, charges(t));
  assert.equal(set.statutory, Math.round((p.stt + p.gst + p.stamp + p.sebi) * 100) / 100);
});

test("a day: profit, loss, charges and net are separate figures, and the percentages are real", () => {
  const trips = [trip("SBIN", "long", 100, 1000, 1012, "09:45", "10:20"), trip("INFY", "long", 50, 1500, 1494, "10:30", "10:50"), trip("TCS", "short", 20, 3500, 3490, "11:10", "12:00"), trip("SBIN", "long", 100, 1010, 1004, "13:00", "13:20")];
  const day = buildDay({ date: D, trips, funds: { available: FUNDS.available, used: FUNDS.used, net: FUNDS.net }, market: { niftyChangePct: -0.62 } });
  const s = day.summary;
  assert.equal(s.trades, 4);
  assert.deepEqual([s.wins, s.losses], [2, 2]);
  assert.equal(s.winRatePct, 50);
  assert.equal(s.grossProfit, 1200 + 200);
  assert.equal(s.grossLoss, 300 + 600);
  assert.equal(s.gross, 500);
  assert.equal(s.net, Math.round((500 - s.charges.total) * 100) / 100);
  assert.ok(s.charges.total > 0 && s.charges.brokerage > 0 && s.charges.stt > 0 && s.charges.gst > 0);
  assert.ok(Math.abs(s.charges.total - trips.reduce((a, t) => a + t.charges, 0)) < 0.05, "the day's total is the sum of the kinds; each trade's own figure is rounded separately");
  assert.equal(s.chargesPctOfGross, Math.round((s.charges.total / 500) * 1000) / 10);
  assert.equal(s.netPctOfMargin, Math.round((s.net / 100000) * 10000) / 100, "net as a share of the opening margin");
  assert.equal(day.margin.available, 92500);
  assert.equal(day.margin.opening, 100000);
  assert.equal(day.margin.source, "kite");
  assert.equal(s.profitFactor, Math.round((1400 / 900) * 100) / 100);
  assert.equal(day.weekday, "Fri");
  assert.equal(day.trades.length, 4);
  assert.equal(day.trades[0].entryAt, "09:45");
  assert.ok(day.why[0].startsWith("Net profit of ₹"), day.why[0]);
  assert.ok(day.why.some((w) => /Nifty fell 0\.62%/.test(w)));
  assert.equal(day.hours.map((h) => h.hour).join(), "09,10,11,13");
});

test("practices: overtrading, a big loss, losers held longer, entries outside the window — each with its figures", () => {
  // 7 trades; usual is 3 a day. A first-minute entry that lost, and a loser held far longer than any winner.
  const trips = [trip("SBIN", "long", 100, 1000, 1002, "09:20", "09:25"), trip("SBIN", "long", 100, 1000, 1003, "10:00", "10:08"), trip("INFY", "long", 50, 1500, 1502, "10:20", "10:30"), trip("TCS", "long", 20, 3500, 3250, "10:40", "12:40"), trip("SBIN", "long", 100, 1000, 999, "13:00", "13:10"), trip("INFY", "long", 50, 1500, 1500, "13:20", "13:30"), trip("RELIANCE", "long", 10, 1300, 1295, "14:50", "15:05")];
  const history = Array.from({ length: 8 }, (_, i) => ({ date: `2026-11-0${i + 1}`, summary: { trades: 3, net: i % 2 ? 500 : -400 } }));
  const day = buildDay({ date: D, trips, history });
  const bad = Object.fromEntries(day.practices.bad.map((p) => [p.id, p]));
  assert.ok(bad.overtrading && /7 trades today against your usual 3/.test(bad.overtrading.detail), JSON.stringify(bad.overtrading));
  assert.ok(bad["big-loss"] && /TCS lost ₹5,000/.test(bad["big-loss"].detail), JSON.stringify(bad["big-loss"]));
  assert.ok(bad["hold-losers"]);
  assert.ok(bad.window && /first 15 minutes \(1\)/.test(bad.window.detail) && /after 2:45 PM \(1\)/.test(bad.window.detail));
  assert.equal(bad.window.impact, 0, "the two off-window trades happened to net a little; the rule is breached either way");
  assert.ok(day.advice.length >= 3, "each bad practice brings a piece of advice");
  assert.ok(day.score < 50, `a day with this many mistakes scores low: ${day.score}`);
});

test("practices: a calm, disciplined day shows what was done well, and no bad ones", () => {
  const trips = [trip("SBIN", "long", 100, 1000, 1010, "10:00", "11:30"), trip("INFY", "long", 50, 1500, 1520, "11:00", "13:00"), trip("TCS", "long", 20, 3500, 3490, "12:00", "12:20"), trip("HDFCBANK", "long", 60, 1600, 1612, "13:30", "14:20")];
  const day = buildDay({ date: D, trips, openPositions: [] });
  assert.deepEqual(day.practices.bad.map((p) => p.id), []);
  const good = day.practices.good.map((p) => p.id);
  for (const id of ["window", "payoff", "flat"]) assert.ok(good.includes(id), `${id} in ${good}`);
  assert.ok(day.score >= 76);
  assert.match(day.advice[0], /process was sound/);
});

test("practices: revenge trading, and trading on after two losses in a row", () => {
  const trips = [trip("SBIN", "long", 100, 1000, 995, "10:00", "10:10"), trip("SBIN", "long", 300, 996, 992, "10:14", "10:30"), trip("INFY", "long", 50, 1500, 1490, "10:40", "10:50"), trip("TCS", "long", 20, 3500, 3480, "11:00", "11:30")];
  const day = buildDay({ date: D, trips });
  const ids = day.practices.bad.map((p) => p.id);
  assert.ok(ids.includes("revenge"), `4 minutes after a loss, same stock, double the size: ${ids}`);
  assert.ok(ids.includes("stop-rule"));
  const sr = day.practices.bad.find((p) => p.id === "stop-rule");
  assert.match(sr.detail, /2 more trades after the second straight loss \(at 10:30\)/);
  assert.ok(day.practices.bad.find((p) => p.id === "oversized"));
});

test("practices: charges that turn a gross profit into a net loss; an intraday position left open", () => {
  const tiny = Array.from({ length: 10 }, (_, i) => trip("SBIN", "long", 100, 1000, 1000.6, `10:${String(i * 5).padStart(2, "0")}`, `10:${String(i * 5 + 3).padStart(2, "0")}`));
  const day = buildDay({ date: D, trips: tiny, openPositions: [{ symbol: "ITC", quantity: 100, product: "MIS" }] });
  assert.ok(day.summary.gross > 0 && day.summary.net < 0, `${day.summary.gross} gross, ${day.summary.net} net`);
  const ids = day.practices.bad.map((p) => p.id);
  assert.ok(ids.includes("costs"));
  assert.ok(ids.includes("left-open"));
  assert.match(day.practices.bad.find((p) => p.id === "costs").detail, /Before charges the day made/);
});

test("a day is built only from the trades: figures passed by hand are ignored", () => {
  const day = buildDay({ date: D, trips: [], overrides: { trades: 6, grossProfit: 5000 } });
  assert.deepEqual([day.summary.trades, day.summary.gross, day.edited], [0, 0, false]);
});

test("an empty day is reported as such, not invented", () => {
  const day = buildDay({ date: D, trips: [] });
  assert.equal(day.summary.trades, 0);
  assert.equal(day.score, null);
  assert.match(day.why[0], /No closed trades/);
});

/* ------------------------------------------------------------------------------- analytics */

function makeDays(nets) {
  return nets.map((n, i) => {
    const date = new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);
    return buildDay({ date, trips: n === 0 ? [] : [trip("SBIN", "long", 100, 1000, 1000 + n / 100, "10:00", "10:30", date)], overrides: n === 0 ? { trades: 1, wins: 0, losses: 0, grossProfit: 0, grossLoss: 0 } : null });
  });
}

test("analytics: totals, the equity curve, drawdown, streaks, weekday and hour tables, and the comparison with the period before", () => {
  const days = makeDays([500, -300, 800, -900, -200, 600, 400, -100]);
  const a = analytics(days, { from: "2026-10-05", to: "2026-10-08" });
  assert.equal(a.range.days, 4);
  const all = analytics(days, {});
  const t = all.totals;
  assert.equal(t.days, 8);
  assert.equal(t.trades, 8);
  assert.equal(t.grossProfit, 500 + 800 + 600 + 400);
  assert.equal(t.grossLoss, 300 + 900 + 200 + 100);
  assert.equal(t.gross, 800);
  assert.equal(t.net, Math.round((800 - t.charges.total) * 100) / 100);
  assert.equal(t.greenDays + t.redDays, 8);
  assert.equal(t.greenDays, 4);
  assert.equal(t.greenDaysPct, 50);
  assert.equal(t.bestDay.date, "2026-10-03");
  assert.equal(t.worstDay.date, "2026-10-04");
  assert.ok(t.maxDrawdown > 1000, `the fall from the peak after day 3: ${t.maxDrawdown}`);
  assert.equal(all.series.length, 8);
  assert.equal(all.series[7].cumNet, t.net);
  assert.ok(all.series.every((s) => s.drawdown >= 0));
  assert.ok(all.weekday.length >= 5);
  assert.equal(all.hours[0].key, "10:00");
  assert.equal(all.composition.profit, t.grossProfit);
  assert.equal(all.charges.find((c) => c.key === "stt").pct > 0, true);
  assert.equal(Math.round(all.charges.reduce((s, c) => s + c.pct, 0)), 100);
  // the previous period: the same number of days just before
  const cmp = analytics(days, { from: "2026-10-05", to: "2026-10-08" });
  assert.equal(cmp.previous.days, 4);
  assert.equal(cmp.previous.from, "2026-10-01");
  assert.equal(analytics(days, { from: "2026-10-01", to: "2026-10-08" }).previous, null, "nothing before the first day");
});

test("analytics: which bad practices recur, and what those days netted against the others", () => {
  const over = (date) => buildDay({ date, trips: Array.from({ length: 8 }, (_, i) => trip("SBIN", "long", 100, 1000, 1000.2, `10:${String(i * 6).padStart(2, "0")}`, `10:${String(i * 6 + 4).padStart(2, "0")}`, date)), history: Array.from({ length: 6 }, (_, i) => ({ date: `2026-09-0${i + 1}`, summary: { trades: 2, net: 100 } })) });
  const calm = (date) => buildDay({ date, trips: [trip("SBIN", "long", 100, 1000, 1010, "10:00", "11:00", date)] });
  const days = [over("2026-10-01"), over("2026-10-02"), calm("2026-10-03"), calm("2026-10-05")];
  const a = analytics(days, {});
  const o = a.practices.bad.find((p) => p.id === "overtrading");
  assert.equal(o.days, 2);
  assert.equal(o.pctDays, 50);
  assert.ok(o.avgOnOtherDays > o.avgOnThoseDays, "the overtrading days did worse than the calm ones");
});

/* ---------------------------------------------------------------------------- the service */

function boot({ trips = [], now = at(D, "15:50"), funds = FUNDS, ai = null, failTrips = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-an-"));
  const docs = new FileDocs(dir);
  const clock = { ms: now };
  const calls = [];
  const source = {
    closedTrips: async (date) => {
      calls.push(`trips ${date}`);
      if (failTrips) throw new Error("Zerodha is not connected");
      return trips.filter((t) => new Date(t.exitAt + IST).toISOString().slice(0, 10) === date);
    },
    funds: async () => ({ available: funds.available, used: funds.used, net: funds.net }),
    positions: async () => [],
    market: async () => ({ niftyChangePct: 0.4 }),
  };
  const svc = new DayAnalysis({ docs, source, ai, now: () => clock.ms, log: { log() {} } });
  return { svc, clock, calls, docs };
}

test("saving a day: the report is stored in its own record, and read back with its table, margin and practices", async () => {
  const trips = [trip("SBIN", "long", 100, 1000, 1012, "09:45", "10:20"), trip("INFY", "long", 50, 1500, 1494, "10:30", "10:50")];
  const { svc, docs } = boot({ trips });
  const r = await svc.capture(D, { by: "manual" });
  assert.equal(r.summary.trades, 2);
  assert.equal(r.margin.available, 92500);
  assert.equal(r.market.niftyChangePct, 0.4);
  assert.equal(r.source, "manual");
  const stored = docs.read("analysis/days", null);
  assert.ok(stored.days[D], "kept in the analysis/days record");
  const list = svc.list({});
  assert.equal(list.length, 1);
  assert.equal(list[0].summary.net, r.summary.net);
  assert.ok(list[0].good + list[0].bad >= 0);
  assert.equal(svc.get(D).date, D);
  assert.throws(() => svc.get("2026-11-12"), /No report is saved/);
  assert.throws(() => svc.get("13-11-2026"), /not a valid date/);
  assert.throws(() => svc.get("2027-01-01"), /has not happened yet/);
  assert.equal(svc.analytics({}).totals.days, 1);
});

test("a day's notes are kept and change no figure; figures can never be typed in", async () => {
  const trips = [trip("SBIN", "long", 100, 1000, 1012, "09:45", "10:20")];
  const { svc } = boot({ trips });
  await svc.capture(D, { by: "manual" });
  const before = svc.get(D).summary.net;
  let r = await svc.edit(D, { notes: { text: "Waited for VWAP. Good.", rating: 4, lessons: ["Keep waiting for VWAP", ""], mood: "calm" } });
  assert.equal(r.notes.text, "Waited for VWAP. Good.");
  assert.equal(r.notes.rating, 4);
  assert.deepEqual(r.notes.lessons, ["Keep waiting for VWAP"]);
  assert.equal(r.summary.net, before, "a note changes no figure");
  await assert.rejects(svc.edit(D, { overrides: { grossProfit: 3000 } }), /cannot be edited by hand/);
  await assert.rejects(svc.edit(D, {}), /Nothing to save/);
  assert.equal(svc.get(D).summary.net, before);
  // capturing again keeps the note
  r = await svc.capture(D, { by: "manual" });
  assert.equal(r.notes.text, "Waited for VWAP. Good.");
  assert.equal(r.edited, false);
  // a note on a day the journal holds no trades for: the day is built (empty) from the journal, never invented
  const e = await svc.edit("2026-11-12", { notes: { text: "No trades: stayed out." } });
  assert.deepEqual([e.summary.trades, e.summary.net, e.notes.text], [0, 0, "No trades: stayed out."]);
  assert.equal(svc.list({}).length, 2);
  assert.deepEqual(svc.remove(D), { removed: D });
});

test("days whose figures were typed in by hand earlier are rebuilt from the journal; the old figures stay on record", async () => {
  const trips = [trip("SBIN", "long", 100, 1000, 1012, "09:45", "10:20")];
  const { svc, docs } = boot({ trips });
  await svc.capture(D, { by: "manual" });
  const real = svc.get(D).summary.net;
  // an earlier version's hand edit, as it was stored
  const doc = docs.read("analysis/days");
  doc.days[D] = { ...doc.days[D], overrides: { grossProfit: 3000, grossLoss: 500 }, edited: true, summary: { ...doc.days[D].summary, net: 2350 }, notes: { text: "kept", rating: 3, lessons: [], mood: "" } };
  docs.write("analysis/days", doc);
  assert.deepEqual(await svc.dropHandFigures(), [D]);
  const d = svc.get(D);
  assert.equal(d.summary.net, real, "the journal's own figures");
  assert.deepEqual(d.formerOverrides, { grossProfit: 3000, grossLoss: 500 });
  assert.equal(d.overrides, null);
  assert.equal(d.edited, false);
  assert.equal(d.notes.text, "kept");
  assert.deepEqual(await svc.dropHandFigures(), [], "once");
});

test("3:45 PM: on a trading day the report saves itself once, and not before, not on a weekend, not twice", async () => {
  const trips = [trip("SBIN", "long", 100, 1000, 1012, "09:45", "10:20")];
  const { svc, clock, calls } = boot({ trips, now: at(D, "15:44") });
  assert.equal(await svc.tick(), null, "15:44: too early");
  assert.equal(svc.list({}).length, 0);
  clock.ms = at(D, "15:45");
  const r = await svc.tick();
  assert.equal(r.date, D);
  assert.equal(r.source, "auto");
  assert.equal(svc.list({}).length, 1);
  const seen = calls.length;
  clock.ms = at(D, "16:30");
  assert.equal(await svc.tick(), null, "done for the day");
  assert.equal(calls.length, seen);
  // Saturday
  const sat = boot({ trips, now: at("2026-11-14", "16:00") });
  assert.equal(await sat.svc.tick(), null);
  // the old "auto" switch is ignored: every day is saved by itself
  const off = boot({ trips, now: at(D, "16:00") });
  off.svc.setSettings({ auto: false });
  assert.equal((await off.svc.tick()).source, "auto");
  assert.equal(off.svc.settings().auto, true);
});

test("missed days are saved by themselves on the hourly sweep: every day with closed trades and no record, newest first, without the AI", async () => {
  const days = ["2026-11-09", "2026-11-10", "2026-11-11"];
  const mk = (date, i) => ({ symbol: "SBIN", exchange: "NSE", side: "long", product: "MIS", intraday: true, entryAt: Date.parse(`${date}T04:00:00Z`), exitAt: Date.parse(`${date}T05:00:00Z`), entryAvg: 800, exitAvg: 804, maxQty: 10, qty: 10, pnl: 40 + i, charges: 12, net: 28 + i, holdMin: 60, key: `k${i}`, parts: { brokerage: 0, stt: 2, exchange: 1, sebi: 0, gst: 1, stamp: 0, dp: 0 } });
  const trips = days.map(mk);
  const b = boot({ trips, now: at("2026-11-12", "11:00") });
  b.svc.source.daysWithTrips = async (from, to) => days.filter((d) => d >= from && d <= to);
  const saved = await b.svc.backfill();
  assert.deepEqual(saved, ["2026-11-11", "2026-11-10", "2026-11-09"]);
  assert.deepEqual(b.svc.list({}).map((d) => d.date), ["2026-11-11", "2026-11-10", "2026-11-09"]);
  assert.ok(b.svc.list({}).every((d) => d.source === "auto" && !d.hasAi));
  assert.deepEqual(await b.svc.backfill(), [], "nothing left to save");
  // the minute timer runs the sweep at most once an hour, outside the 3:45 window too
  const c = boot({ trips, now: at("2026-11-12", "11:00") });
  c.svc.source.daysWithTrips = async (from, to) => days.filter((d) => d >= from && d <= to);
  await c.svc.tick();
  assert.equal(c.svc.list({}).length, 3);
});

test("3:45 PM with no trades saves nothing; with the broker unreachable it tries again, a few times", async () => {
  const none = boot({ trips: [], now: at(D, "15:50") });
  const r = await none.svc.tick();
  assert.equal(r.skipped, "no trades");
  assert.equal(none.svc.list({}).length, 0);
  assert.equal(await none.svc.tick(), null, "no trades is an answer: it does not keep asking");

  const down = boot({ trips: [], failTrips: true, now: at(D, "15:50") });
  assert.equal((await down.svc.tick()).skipped, "no trades");
  assert.equal(await down.svc.tick(), null, "not again within ten minutes");
  down.clock.ms += 11 * 60000;
  assert.ok(await down.svc.tick(), "a second try");
  down.clock.ms += 11 * 60000;
  await down.svc.tick();
  down.clock.ms += 11 * 60000;
  await down.svc.tick();
  down.clock.ms += 11 * 60000;
  assert.equal(await down.svc.tick(), null, "four tries, then it gives up for the day");
});

test("the AI write-up is optional: used when a model is saved and asked for, and its absence or failure never loses the report", async () => {
  const trips = [trip("SBIN", "long", 100, 1000, 1012, "09:45", "10:20")];
  const review = { at: "x", model: "m", headline: "A small win", why: "…", worked: [], hurt: [], advice: ["Stop after two losses."], tomorrow: [], caveat: "" };
  const ai = { configured: () => true, dayReview: { write: async (d) => ({ ...review, headline: `Net ${d.summary.net}` }) } };
  const a = boot({ trips, ai, now: at(D, "15:50") });
  const auto = await a.svc.tick();
  assert.match(auto.ai.headline, /^Net /, "written automatically at 3:45 when AI is on");
  // switched off for the automatic run
  const b = boot({ trips, ai, now: at(D, "15:50") });
  b.svc.setSettings({ withAi: false });
  const manual = await b.svc.tick();
  assert.equal(manual.ai, null);
  const w = await b.svc.writeAi(D);
  assert.match(w.ai.headline, /^Net /, "and on a press of the button");
  // a failing model leaves the report whole
  const bad = { configured: () => true, dayReview: { write: async () => { throw new Error("rate limited"); } } };
  const c = boot({ trips, ai: bad, now: at(D, "15:50") });
  const r = await c.svc.tick();
  assert.equal(r.summary.trades, 1);
  assert.equal(r.ai, null);
  assert.match(r.aiError, /rate limited/);
  // no key at all
  const d = boot({ trips, ai: { configured: () => false, dayReview: {} }, now: at(D, "15:50") });
  const q = await d.svc.tick();
  assert.match(q.aiError, /No AI key/);
  assert.equal(q.summary.trades, 1);
});

test("Trade Analysis reads and reports; the folder holds no broker and no order code", () => {
  const dir = path.join(__dirname, "..", "analysis");
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    assert.ok(!/require\([^)]*(broker|trading\/service)/.test(src), `${f} must not load the broker or the trading service`);
    assert.ok(!/place_order|placeOrder|\/gtt|kite\.trade|\/orders/i.test(src), `${f} must not touch orders`);
  }
  const ai = fs.readFileSync(path.join(__dirname, "..", "ai", "dayreview.js"), "utf8");
  assert.ok(!/setInterval|setTimeout|cron/i.test(ai));
});

test("the Execution Lab: a day replayed from the journal and that day's 1-minute bars, kept once worked out, and added up over a period", async () => {
  const day = "2026-11-12";
  const t0 = Date.parse(`${day}T09:15:00+05:30`);
  const bars = [];
  for (let i = 0; i <= 375; i += 1) {
    const px = 800 + Math.sin(i / 40) * 6 + i * 0.02;
    bars.push({ t: t0 + i * 60000, o: px, h: px + 0.4, l: px - 0.4, c: px, v: 500 });
  }
  const mk = (k, inMin, outMin, side) => {
    const e = bars[inMin].c;
    const x = bars[outMin].c;
    const pnl = (side === "long" ? x - e : e - x) * 50;
    return { key: k, symbol: "SBIN", exchange: "NSE", side, product: "MIS", intraday: true, entryAt: bars[inMin].t, exitAt: bars[outMin].t, entryAvg: e, exitAvg: x, maxQty: 50, qty: 50, pnl, charges: 30, net: pnl - 30, holdMin: outMin - inMin, parts: { brokerage: 0, stt: 10, exchange: 5, sebi: 0, gst: 2, stamp: 1, dp: 0 } };
  };
  const trips = [mk("a", 20, 50, "long"), mk("b", 60, 70, "short"), mk("c", 75, 120, "long")];
  const b = boot({ trips, now: at("2026-11-13", "11:00") });
  let fetched = 0;
  b.svc.source.minuteBars = async (sym, from, to) => {
    fetched += 1;
    return bars.filter((x) => x.t >= from && x.t <= to);
  };
  b.svc.source.discipline = () => ({ targetPct: 3, stopPct: 1.5 });
  b.svc.source.daysWithTrips = async () => [day];
  const lab = await b.svc.lab(day);
  assert.equal(lab.available, true);
  assert.equal(lab.summary.trades, 3);
  assert.equal(lab.summary.replayed, 3);
  assert.equal(fetched, 1, "one stock: one read of its bars");
  assert.ok(lab.rules.length === 6 && lab.best, "your exits, four fixed rules and the exit coach");
  assert.ok(lab.trades.find((t) => t.key === "c").flags.includes("revenge") || lab.trades.find((t) => t.key === "b").net >= 0);
  await b.svc.lab(day);
  assert.equal(fetched, 1, "kept once worked out: no second read");
  await b.svc.lab(day, { refresh: true });
  assert.equal(fetched, 2, "refresh replays it again");
  const r = b.svc.labRange({ from: "2026-11-01", to: "2026-11-30" });
  assert.equal(r.days, 1);
  assert.equal(r.summary.trades, 3);
  assert.equal((await b.svc.lab("2026-11-11")).available, false, "a day without trades says so");
  // the sweep replays the recent days by itself
  const c = boot({ trips, now: at("2026-11-13", "11:00") });
  c.svc.source.minuteBars = async (sym, from, to) => bars.filter((x) => x.t >= from && x.t <= to);
  c.svc.source.daysWithTrips = async () => [day];
  assert.deepEqual(await c.svc.labBackfill(), [day]);
  assert.deepEqual(await c.svc.labBackfill(), [], "already replayed");
});
