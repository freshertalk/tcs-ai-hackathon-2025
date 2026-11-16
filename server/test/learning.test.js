"use strict";
// The one-year history and the learning built on it: packed bars, the download in windows that resumes,
// the daily top-up, the day-trading predictor and its out-of-sample skill, the learning points, and the loop
// that does all of it by itself. Everything is faked: no network, no broker.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const H = require("../robot/history");
const P = require("../robot/predict");
const { PaperRobot } = require("../robot/service");
const { FileDocs, COLLECTIONS } = require("../docs");

const IST = 5.5 * 3600 * 1000;
const at = (date, hhmm) => Date.parse(`${date}T${hhmm}:00+05:30`);
const weekday = (d) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;

/** The weekdays from `from` to `to` (inclusive), as dates. */
function weekdays(from, to) {
  const out = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d = new Date(d.getTime() + 86400000)) if (weekday(d)) out.push(d.toISOString().slice(0, 10));
  return out;
}
const seeded = (seed) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 1000003, 7);

/**
 * One session's 75 bars. A "TRN" stock trends all day in a random direction with small noise; any other stock
 * chops around its open.
 */
function sessionBars(symbol, date, base = 100) {
  const rnd = seeded(hash(symbol + date));
  const trend = symbol.startsWith("TRN") ? (rnd() < 0.5 ? -1 : 1) * (0.006 + rnd() * 0.006) : 0;
  const bars = [];
  let px = base;
  for (let i = 0; i < 75; i += 1) {
    const o = px;
    px = base * (1 + trend * (i / 74)) + (rnd() - 0.5) * base * 0.0035;
    bars.push({ t: at(date, "09:15") + i * 300000, o, h: Math.max(o, px) + rnd() * base * 0.0008, l: Math.min(o, px) - rnd() * base * 0.0008, c: px, v: 1000 + Math.floor(rnd() * 400) });
  }
  return bars;
}
/** A fake Zerodha history call for the weekdays up to `lastDate`; records the windows asked for. */
function fakeMarket(symbols, lastDate, calls = []) {
  const k = (token, interval, from, to) => {
    calls.push({ token, interval, days: (to - from) / 86400000 });
    const a = new Date(from.getTime() + IST).toISOString().slice(0, 10);
    const b = new Date(Math.min(to.getTime(), at(lastDate, "23:00")) + IST).toISOString().slice(0, 10);
    return weekdays(a, b).flatMap((d) => sessionBars(token, d)).filter((x) => x.t >= from.getTime() && x.t <= to.getTime()).map((x) => ({ ...x, t: new Date(x.t + IST).toISOString().replace("Z", "+0530").replace(/\.\d+/, "") }));
  };
  return { mode: () => "kite", instruments: async () => {}, _instrument: async (s) => ({ t: s }), _call: async (fn) => fn({ historical: async (...a) => k(...a) }), indexList: { list: () => symbols } };
}

/* ------------------------------------------------------------------------------ the store */

test("packed bars come back exactly, merge by time without doubling, and only whole sessions count", () => {
  const bars = [...sessionBars("AAA", "2026-11-09"), ...sessionBars("AAA", "2026-11-10").slice(0, 30)];
  const rec = H.pack(bars);
  assert.equal(rec.n, 105);
  assert.equal(rec.from, "2026-11-09");
  assert.equal(rec.to, "2026-11-10");
  const back = H.unpack(rec);
  assert.equal(back.length, 105);
  assert.equal(back[3].t, bars[3].t);
  assert.ok(Math.abs(back[40].c - bars[40].c) < 0.006, "prices to the paisa");
  assert.ok(rec.z.length < JSON.stringify(bars).length / 3, "compressed");
  // the same minutes again, plus a new day: no doubling, the newer wins
  const more = [...bars.slice(60, 80).map((b) => ({ ...b, c: b.c + 1 })), ...sessionBars("AAA", "2026-11-11")];
  const m = H.merge(bars, more, { keepDays: 0 });
  assert.equal(m.length, 105 + 75, "20 repeated minutes, 75 new");
  assert.ok(m.find((b) => b.t === bars[65].t).c > bars[65].c, "the newer read replaced the older");
  assert.deepEqual([...H.sessions(m).keys()], ["2026-11-09", "2026-11-11"], "the 30 bars of an unfinished day are not a session");
  // the oldest bars beyond the keep window are dropped
  const old = H.merge(sessionBars("AAA", "2025-01-06"), sessionBars("AAA", "2026-11-09"), { keepDays: 400, now: at("2026-11-12", "10:00") });
  assert.equal(old.length, 75);
});

test("the last session that should be stored: today after 3:35 PM on a weekday, otherwise the weekday before", () => {
  assert.equal(H.expectedSession(at("2026-11-16", "10:00")), "2026-11-13", "Monday morning: Friday");
  assert.equal(H.expectedSession(at("2026-11-16", "15:36")), "2026-11-16", "Monday after the close: Monday");
  assert.equal(H.expectedSession(at("2026-11-14", "12:00")), "2026-11-13", "Saturday: Friday");
  assert.equal(H.expectedSession(at("2026-11-17", "08:00")), "2026-11-16");
});

function boot({ symbols = ["AAA", "BBB", "CCC"], lastDate = "2026-11-13", now = at("2026-11-14", "12:00"), calls = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-hist-"));
  const docs = new FileDocs(dir);
  const clock = { ms: now };
  const market = fakeMarket(symbols, lastDate, calls);
  const store = new H.HistoryStore({ docs, market, universe: () => symbols, now: () => clock.ms, log: { log() {} }, gapMs: 0 });
  return { docs, clock, market, store, calls, symbols };
}

test("a year of 5-minute bars is read in windows Zerodha allows, one stock at a time, each saved as soon as it is read", async () => {
  const b = boot();
  assert.equal(b.store.needs().length, 3);
  assert.ok(b.store.needs().every((x) => x.mode === "year"));
  const r = await b.store.sync();
  assert.equal(r.stocks, 3);
  assert.ok(b.calls.every((c) => c.days <= 90.01), "no window over 90 days (the limit is 100)");
  assert.ok(b.calls.length >= 3 * 4, "a year takes four or five windows a stock");
  const st = b.store.status();
  assert.equal(st.stocks, 3);
  assert.ok(st.sessions >= 245 && st.sessions <= 265, `about a year of sessions: ${st.sessions}`);
  assert.equal(st.to, "2026-11-13");
  assert.equal(st.complete, true);
  assert.equal(st.upToDate, true);
  assert.equal(b.docs.items("robot_history").length, 3, "one record per stock in its own table");
  assert.ok(st.kb < 3 * 400, "a year of a stock is a few hundred KB at most");
  assert.equal(b.store.needs().length, 0);
  assert.ok(b.store.bars("AAA").length > 18000);
});

test("a download that is interrupted carries on where it stopped: the stocks already read are not read again, a failing stock is tried again later", async () => {
  const b = boot();
  const real = b.market._call;
  let failing = true;
  b.market._call = async (fn) => {
    const tok = await fn({ historical: async (t) => t }).catch(() => null);
    if (failing && tok === "BBB") throw new Error("Zerodha: too many requests");
    return real(fn);
  };
  const r = await b.store.sync();
  assert.equal(r.stocks, 2);
  assert.deepEqual(r.failed.map((x) => x.symbol), ["BBB"]);
  assert.equal(b.store.status().error.includes("BBB"), true);
  assert.deepEqual(b.store.needs().map((x) => x.symbol), [], "a stock that has just failed is left for ten minutes");
  b.clock.ms += 11 * 60000;
  assert.deepEqual(b.store.needs().map((x) => x.symbol), ["BBB"], "and then tried again; the stocks already saved are not");
  failing = false;
  const again = await b.store.sync();
  assert.equal(again.stocks, 1);
  assert.equal(b.store.status().complete, true);
  assert.equal(b.store.status().error, "");
});

test("every evening the last ten days are read again and merged: a new session is added, nothing is doubled", async () => {
  const b = boot();
  await b.store.sync();
  const before = b.store.bars("AAA").length;
  assert.equal(b.store.needs().length, 0);
  // Monday 16 November after the close: the day's session is now expected
  b.clock.ms = at("2026-11-16", "15:50");
  b.market = Object.assign(b.market, fakeMarket(b.symbols, "2026-11-16", b.calls));
  const need = b.store.needs();
  assert.equal(need.length, 3);
  assert.ok(need.every((x) => x.mode === "topup"));
  b.calls.length = 0;
  await b.store.sync();
  assert.ok(b.calls.length <= 3 * 2, "a top-up is one window a stock");
  const after = b.store.bars("AAA");
  assert.equal(after.length, before + 75, "one new session, the ten re-read days not doubled");
  assert.equal(b.store.status().to, "2026-11-16");
  assert.equal(new Set(after.map((x) => x.t)).size, after.length);
});

/* --------------------------------------------------------------------------------- predictor */

function universe(symbols, days) {
  const by = new Map();
  for (const s of symbols) by.set(s, new Map(days.map((d) => [d, sessionBars(s, d)])));
  return by;
}
const DAYS = weekdays("2026-01-05", "2026-11-13").slice(0, 230);

test("a clean directional day is measured against the stock's own size, and which way it went", () => {
  const up = Array.from({ length: 75 }, (_, i) => ({ t: i, o: 100 + i * 0.02, h: 100.1 + i * 0.02, l: 99.95 + i * 0.02, c: 100 + i * 0.02, v: 1 }));
  assert.deepEqual(P.labelDay(up, 1.5), { clean: true, dir: "up" });
  const flat = Array.from({ length: 75 }, (_, i) => ({ t: i, o: 100, h: 100.1, l: 99.9, c: 100 + (i % 2 ? 0.05 : -0.05), v: 1 }));
  assert.deepEqual(P.labelDay(flat, 1.5), { clean: false, dir: null });
  const down = up.map((b, i) => ({ ...b, o: 100 - i * 0.02, h: 100.05 - i * 0.02, l: 99.9 - i * 0.02, c: 100 - i * 0.02 }));
  assert.equal(P.labelDay(down, 1.5).dir, "down");
  assert.equal(P.labelDay(up.slice(0, 4), 1.5), null, "too few bars");
});

test("the predictor finds the stocks that trend, and its skill is counted out of sample: it earns the word only when it beats the average stock", () => {
  const trending = ["TRN1", "TRN2", "TRN3", "TRN4", "TRN5", "TRN6"];
  const choppy = Array.from({ length: 24 }, (_, i) => `CHP${i}`);
  const by = universe([...trending, ...choppy], DAYS);
  const { samples, latest, lastDate } = P.buildSamples(by);
  assert.ok(samples.length > 30 * 190);
  assert.equal(lastDate, DAYS[DAYS.length - 1]);
  assert.ok(Object.keys(latest).length === 30);
  const tr = P.train(samples);
  const s = tr.summary;
  assert.ok(s.evaluated >= 120, `sessions marked out of sample: ${s.evaluated}`);
  assert.ok(s.topRate > s.baseRate + 0.1, `its top ten beat the average stock: ${s.topRate} vs ${s.baseRate}`);
  assert.equal(s.state, "graduated");
  assert.match(s.text, /Out of sample, over \d+ sessions/);
  // the ranking for the next session puts the trending stocks first
  const top = P.rank(tr.counts, latest, { limit: 8 });
  assert.ok(top.slice(0, 5).every((r) => r.symbol.startsWith("TRN")), `top: ${top.map((r) => r.symbol).join(",")}`);
  assert.ok(top[0].p > top[0].base && top[0].lift > 0.1);
  assert.equal(top[0].rank, 1);
  assert.ok(top[0].why.length >= 0 && top[0].targetPct > 0 && top[0].stockN > 150);
  // the points name them, in plain words
  const pts = P.points(tr.counts, samples);
  const pt = pts.find((p) => p.id === "s:TRN1");
  assert.ok(pt && /a stock that trends/.test(pt.text) && pt.kind === "stock");
  assert.ok(pts.some((p) => p.kind === "timing"));
  // and the next day's points are compared with this day's
  const d = P.diffPoints(pts.slice(0, 20), pts.slice(0, 18).map((p) => ({ ...p, lift: p.lift * 0.5, firstSeen: "2026-10-01" })));
  assert.equal(d.points.filter((p) => p.state === "new").length, 2);
  assert.ok(d.points.some((p) => p.state === "stronger" && p.firstSeen === "2026-10-01"));
});

test("with nothing to learn the predictor does not claim skill: all stocks alike, it does not graduate", () => {
  const same = Array.from({ length: 30 }, (_, i) => `CHP${i}`);
  const { samples } = P.buildSamples(universe(same, DAYS));
  const s = P.train(samples).summary;
  assert.notEqual(s.state, "graduated");
  assert.ok(Math.abs(s.meanLift) < 0.05, `no real lift: ${s.meanLift}`);
  assert.equal(P.predict(P.newCounts(), { prev: "flat", loc: "mid", range: "normal", trend: "near", dow: "1" }, "X"), null, "no chance given before it has seen enough sessions");
});

/* ------------------------------------------------------------------------ learning by itself */

async function until(fn, ms = 90000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

test("learning needs no one: once Zerodha is connected the robot downloads the year, studies every session, trains the predictor and saves the learning points — and keeps them current each evening", async () => {
  const sections = {};
  const syms = ["TRN1", "TRN2", "TRN3", ...Array.from({ length: 20 }, (_, i) => `CHP${i + 1}`)]; // the predictor ranks twenty or more stocks a day
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-auto-"));
  const docs = new FileDocs(dir);
  const clock = { ms: at("2026-11-14", "12:00") }; // a Saturday
  const market = fakeMarket(syms, "2026-11-13");
  const ai = { configured: () => false, playbook: { setSection: (h, t) => (sections[h] = t) } };
  const robot = new PaperRobot({ docs, feed: { live: () => false, picks: () => [], rowOf: () => null, priceOf: () => null, detail: () => null, lean: () => null }, market, ai, now: () => clock.ms, log: { log() {} }, gapMs: 0 });
  assert.equal(robot.predictor().available, false);
  assert.match(robot.predictor().reason, /as soon as Zerodha is connected/i);
  robot.tick();
  assert.ok(await until(() => robot.predictor().available), "the predictor was learned without anyone pressing anything");
  assert.ok(await until(() => !robot._learnBusy));
  const h = robot.historyView();
  assert.equal(h.complete, true);
  assert.ok(h.sessions >= 245);
  const p = robot.predictor();
  assert.equal(p.lastDate, "2026-11-13");
  assert.equal(p.nextDate, "2026-11-16");
  assert.ok(p.picks.length > 5 && p.points.length > 3 && p.series.length > 50);
  assert.equal(p.picks[0].rank, 1);
  assert.ok(p.picks.every((x) => Array.isArray(x.levels)));
  const l = robot.learning();
  assert.ok(l.skill.studied >= 120, `sessions of the Level Book from the stored year: ${l.skill.studied}`);
  assert.ok(l.auto.learned.to === "2026-11-13");
  assert.match(sections["## The day-trading predictor, measured on a year of the NIFTY 100 (written by itself)"] || "", /stock-sessions/);
  assert.equal(robot.levels().available, true);
  // nothing new: it leaves everything alone
  const at0 = robot.predictor().at;
  clock.ms += 60000;
  robot.tick();
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(robot.predictor().at, at0, "up to date: nothing is read or learned again");
  // Monday after the close: the day's session is read, and everything learned from it
  clock.ms = at("2026-11-16", "15:50");
  Object.assign(market, fakeMarket(syms, "2026-11-16"));
  robot.tick();
  assert.ok(await until(() => robot.predictor().lastDate === "2026-11-16"), "the new session was added and the predictor learned from it");
  assert.equal(robot.predictor().nextDate, "2026-11-17");
  assert.ok(robot.predictor().points.some((x) => x.state), "the points say what is new or has moved");
});

test("learning does not start while the scanner fills its buffer before the open, or without the Zerodha connection", async () => {
  const syms = ["AAA", "BBB", "CCC"];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-auto2-"));
  const clock = { ms: at("2026-11-16", "09:20") };
  const market = fakeMarket(syms, "2026-11-13");
  const robot = new PaperRobot({ docs: new FileDocs(dir), feed: { live: () => false }, market, now: () => clock.ms, log: { log() {} }, gapMs: 0 });
  robot.tick();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(robot.historyView().stocks, 0, "not in the half hour the scanner is seeding");
  market.mode = () => "demo";
  clock.ms = at("2026-11-16", "20:00");
  robot.tick();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(robot.historyView().stocks, 0, "no connection, no reading");
});

test("the history table is a collection of its own, and the history code cannot place an order", () => {
  assert.ok(COLLECTIONS.includes("robot_history"));
  for (const f of ["history.js", "predict.js"]) {
    const src = fs.readFileSync(path.join(__dirname, "..", "robot", f), "utf8");
    assert.ok(!/require\(["']\.\.\/trading/.test(src) && !/placeOrder|\/orders|setInterval|fetch\(/.test(src), `${f}: no broker, no order, no timer, no scraping`);
  }
});
