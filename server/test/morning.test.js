"use strict";
// The morning call: the arithmetic (server/market/morning.js) and the service (server/morning.js), with a made-up history
// and a fake market. No network, no broker, no AI.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const M = require("../market/morning");
const { Morning, slotOfClock } = require("../morning");
const { sessions } = require("../robot/history");
const { FileDocs } = require("../docs");

const at = (date, hhmm) => Date.parse(`${date}T${hhmm}:00+05:30`);
const seeded = (seed) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const gauss = (rnd) => Math.sqrt(-2 * Math.log(Math.max(rnd(), 1e-9))) * Math.cos(2 * Math.PI * rnd());
function weekdays(from, n) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); out.length < n; t += 86400000) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * A made-up history with one planted habit: the first half-hour goes on in the direction of the gap ("gap and go"), by 0.6 of
 * the gap, and the stocks' gaps follow the market's. Everything else is noise.
 */
function makeHistory({ stocks = 12, days = 140, from = "2026-04-01", go = 0.6 } = {}) {
  const dates = weekdays(from, days);
  const rnd = seeded(7);
  const market = dates.map(() => gauss(rnd) * 0.5); // % gap of the market each morning
  const out = {};
  for (let s = 0; s < stocks; s += 1) {
    const sym = `S${String.fromCharCode(65 + s)}`;
    let px = 500 + s * 40;
    const bars = [];
    dates.forEach((date, di) => {
      const atrRupees = px * 0.015;
      const gapPct = market[di] * (0.8 + 0.05 * s) + gauss(rnd) * 0.25;
      const open = px * (1 + gapPct / 100);
      const gapAtr = (open - px) / atrRupees;
      let p = open;
      for (let i = 0; i < 75; i += 1) {
        const o = p;
        const drift = i < 6 ? (go * gapAtr * atrRupees) / 6 : 0;
        p = o + drift + gauss(rnd) * atrRupees * 0.07;
        const h = Math.max(o, p) + Math.abs(gauss(rnd)) * atrRupees * 0.03;
        const l = Math.min(o, p) - Math.abs(gauss(rnd)) * atrRupees * 0.03;
        bars.push({ t: at(date, "09:15") + i * 300000, o, h, l, c: p, v: 1000 + Math.round(rnd() * 500) + (i < 6 ? 800 : 0) });
      }
      px = p;
    });
    out[sym] = bars;
  }
  return { dates, bars: out, symbols: Object.keys(out) };
}

const fakeStore = (h) => ({
  record: (s) => (h.bars[s] ? { id: s } : null),
  bars: (s) => h.bars[s] || [],
  status: () => ({ stocks: h.symbols.length, sessions: h.dates.length, to: h.dates[h.dates.length - 1] }),
});

/* ------------------------------------------------------------------------------------------------ the arithmetic */

test("the answers are measured from the price of the call, in the stock's daily range", () => {
  const bars = [];
  for (let i = 0; i < 75; i += 1) bars.push({ t: at("2026-11-27", "09:15") + i * 300000, o: 100 + i * 0.1, h: 100.5 + i * 0.1, l: 99.5 + i * 0.1, c: 100.1 + i * 0.1, v: 10 });
  const y = M.targetsOf(bars, 0, 100, 2);
  const get = (t) => y[M.TARGETS.indexOf(t)];
  assert.ok(Math.abs(get("c45") - (bars[5].c - 100) / 2) < 1e-9, "the 9:45 price is the close of the 9:40 bar");
  assert.ok(Math.abs(get("c15") - (bars[2].c - 100) / 2) < 1e-9, "15 minutes after the 9:15 call is the close of the 9:25 bar");
  assert.ok(Math.abs(get("u45") - (bars[5].h - 100) / 2) < 1e-9, "the half-hour's high");
  assert.ok(Math.abs(get("d45") - (99.5 - 100) / 2) < 1e-9, "the half-hour's low");
  assert.ok(Math.abs(get("uD") - (bars[74].h - 100) / 2) < 1e-9, "the day's high");
  const y3 = M.targetsOf(bars, 3, bars[2].c, 2);
  assert.ok(Math.abs(y3[M.TARGETS.indexOf("d45")] - (Math.min(bars[3].l, bars[2].c) - bars[2].c) / 2) < 1e-9, "a call at 9:30 looks only at what is still to come");
  assert.equal(M.alignedOpening(bars), true);
  assert.equal(M.alignedOpening(bars.slice(1)), false, "a session missing its first bar is not used");
});

test("a context needs 21 previous sessions; the inputs before 9:15 carry no session-so-far", () => {
  const h = makeHistory({ stocks: 1, days: 30 });
  const m = sessions(h.bars.SA);
  const sums = [...m].map(([d, b]) => M.daySummary(d, b));
  assert.equal(M.contextOf(sums.slice(0, 20)), null);
  const ctx = M.contextOf(sums.slice(0, 25));
  assert.ok(ctx.atr > 0 && ctx.firstVolAvg && ctx.firstVolAvg.length === 5);
  const x0 = M.featuresOf(ctx, { open: ctx.prevClose * 1.01, mktGapPct: 0.5, k: 0 });
  for (const f of ["mv", "hi", "lo", "pos", "vol", "mktMv", "vw", "mvGap"]) assert.equal(x0[M.FEATURES.indexOf(f)], 0, f);
  assert.ok(x0[M.FEATURES.indexOf("gap")] > 0);
  const day = m.get([...m.keys()][25]);
  const x2 = M.featuresOf(ctx, { open: day[0].o, k: 2, bars: day, last: day[1].c });
  assert.ok(x2[M.FEATURES.indexOf("vol")] !== 0, "volume against the stock's usual first minutes");
});

test("trained on a year with a planted gap-and-go habit, the model finds it — measured on sessions it never saw", () => {
  const h = makeHistory();
  const rows = M.rowsFrom(h.symbols, (s) => h.bars[s], (b) => sessions(b));
  assert.equal(rows.stocks, 12);
  assert.ok(rows.n > 1000, `${rows.n} stock-sessions`);
  const model = M.train(rows, { now: Date.parse("2026-11-27T12:00:00Z") });
  assert.ok(model, "trained");
  assert.equal(model.version, M.MODEL_VERSION);
  assert.equal(model.perK.length, M.CHECKS);
  assert.ok(model.testSessions >= 20 && model.testFrom > model.from);
  const s0 = model.perK[0].stats;
  assert.ok(s0.c45.dir.rate > 0.7, `direction to 9:45 right on ${s0.c45.dir.rate} of test calls`);
  assert.ok(s0.c45.skill > 0.2, `closer than the usual move: ${s0.c45.skill}`);
  assert.ok(Math.abs(s0.cD.dir.rate - 0.5) < 0.2 || s0.cD.dir.called < 50, "the rest of the day is noise here, and the record says so");
  const wGap = model.perK[0].fit.w[M.TARGETS.indexOf("c45")][M.FEATURES.indexOf("gap")];
  assert.ok(wGap > 0, "the gap pushes the 9:45 call its own way");
  assert.ok(s0.c45.cal.length === 6, "chances measured in six bins");

  // one prediction: a gap up gives a rise by 9:45 more often than not, with a band around the 9:45 price
  const m = sessions(h.bars.SA);
  const sums = [...m].map(([d, b]) => M.daySummary(d, b));
  const ctx = M.contextOf(sums.slice(-60));
  const up = M.predict(model, 0, M.featuresOf(ctx, { open: ctx.prevClose * 1.012, mktGapPct: 1 }));
  const down = M.predict(model, 0, M.featuresOf(ctx, { open: ctx.prevClose * 0.988, mktGapPct: -1 }));
  assert.ok(up.y.c45 > 0 && down.y.c45 < 0);
  assert.ok(up.up45.p > 0.6 && down.up45.p < 0.4, `${up.up45.p} / ${down.up45.p}`);
  assert.ok(up.band45[0] < up.y.c45 && up.y.c45 < up.band45[1]);
  assert.ok(up.y.u45 >= 0 && up.y.d45 <= 0 && up.y.uD >= up.y.u45 && up.y.dD <= up.y.d45);
  const drivers = M.driversOf(model, 0, M.featuresOf(ctx, { open: ctx.prevClose * 1.012, mktGapPct: 1 }));
  assert.ok(drivers.some((d) => d.name === "gap" || d.name === "relGap" || d.name === "mktGap"), "the gap is among the reasons given");
});

test("too little history is refused rather than fitted", () => {
  const h = makeHistory({ stocks: 2, days: 40 });
  const rows = M.rowsFrom(h.symbols, (s) => h.bars[s], (b) => sessions(b));
  assert.equal(M.train(rows), null);
});

test("the live correction switches on only when both halves of the sessions say it helps", () => {
  const rnd = seeded(3);
  const dates = weekdays("2026-09-01", 30);
  const helpful = [];
  const noise = [];
  for (const date of dates) {
    for (let i = 0; i < 8; i += 1) {
      const oi = rnd() * 2 - 1;
      const e = gauss(rnd) * 0.1;
      helpful.push({ date, soft: { oi }, pred: { c45: 0, cD: 0 }, y: { c45: 0.4 * oi + e, cD: e } });
      noise.push({ date, soft: { oi }, pred: { c45: 0, cD: 0 }, y: { c45: gauss(rnd) * 0.3, cD: gauss(rnd) * 0.3 } });
    }
  }
  const on = M.softFrom(helpful);
  assert.equal(on.c45.on, true, on.c45.why);
  assert.ok(on.c45.w[M.SOFT.indexOf("oi")] > 0.2);
  assert.equal(on.cD.on, false);
  assert.equal(M.softFrom(noise).c45.on, false);
  const few = M.softFrom(helpful.slice(0, 40));
  assert.equal(few.c45.on, false);
  assert.match(few.c45.why, /of 10 sessions/);
});

test("without a learned model, a lean from fixed votes, with no chance claimed", () => {
  const x = new Float64Array(M.FEATURES.length);
  x[M.FEATURES.indexOf("mktGap")] = 0.6;
  const l = M.ruleLean({ x, soft: { oi: 1, world: 0.5 }, k: 0 });
  assert.equal(l.side, "up");
  assert.ok(l.votes.find((v) => v.name === "Futures build-up"));
  assert.equal(M.ruleLean({ x: new Float64Array(M.FEATURES.length) }).side, "none");
});

/* ------------------------------------------------------------------------------------------------ the service */

/** A fake market on a fixed day: AAA (in the F&O list) gapped up and is climbing; the clock is set by the test. */
function fakeMarket(h, clock, { today = "2026-11-27" } = {}) {
  const daily = (s) => {
    const m = sessions(h.bars[s] || h.bars.SA);
    const candles = [...m].map(([d, b]) => {
      const x = M.daySummary(d, b);
      return { t: `${d}T00:00:00+0530`, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v };
    });
    return { candles };
  };
  const prevClose = () => {
    const c = daily("SA").candles;
    return c[c.length - 1].c;
  };
  const todayBars = () => {
    const pc = prevClose();
    const out = [];
    const minNow = Math.floor((clock.ms - at(today, "09:15")) / 300000);
    for (let i = 0; i <= Math.min(minNow, 74); i += 1) {
      const o = pc * (1.01 + 0.001 * i);
      const hh = String(9 + Math.floor((15 + i * 5) / 60)).padStart(2, "0");
      const mm = String((15 + i * 5) % 60).padStart(2, "0");
      out.push({ t: `${hh}:${mm}`, o, h: o * 1.002, l: o * 0.999, c: o * 1.001, v: 2000 });
    }
    return out;
  };
  return {
    mode: () => "kite",
    watchlist: () => ["AAA"],
    daily: async (s) => daily(s === "AAA" ? "SA" : s),
    marketForecast: async () => ({ available: true, open: { gapPct: 0.6, label: "gap up" }, lean: { score: 30 } }),
    derivatives: async () => [{ y: "FUT", n: "AAA" }, { y: "CE", n: "BBB" }],
    quotes: async (list) => {
      const pc = prevClose();
      const min = Math.floor((clock.ms - at(today, "00:00")) / 60000);
      const quotes = {};
      for (const s of list) {
        if (s === "NIFTY 50") quotes[s] = min >= 548 ? { last: 26100, open: min >= 555 ? 26100 : null, prevClose: 26000 } : { last: 26000, prevClose: 26000 };
        else if (min < 540) quotes[s] = { last: pc, prevClose: pc };
        else if (min < 555) quotes[s] = { last: pc * 1.01, prevClose: pc, buyQty: 6000, sellQty: 4000 };
        else {
          const b = todayBars();
          quotes[s] = { last: b[b.length - 1].c, open: b[0].o, prevClose: pc, buyQty: 5000, sellQty: 5000 };
        }
      }
      return { quotes };
    },
    tape: async () => {
      const bars = clock.ms >= at(today, "09:15") ? todayBars() : [];
      return bars.length ? { available: true, tape: { today: true, bars } } : { available: false };
    },
  };
}

function boot({ trained = false } = {}) {
  const h = makeHistory({ stocks: 12, days: 140, from: "2026-05-01" });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-morning-"));
  const docs = new FileDocs(dir);
  const clock = { ms: at("2026-11-27", "08:45") };
  const market = fakeMarket(h, clock);
  const openForecast = { peek: (s) => (s === "AAA" ? { date: "2026-11-27", predicted: 0, low: 0, high: 0 } : null) };
  const svc = new Morning({ market, docs, history: fakeStore(h), universe: () => h.symbols, openForecast, now: () => clock.ms, log: { log() {}, error() {} } });
  // the opening-price forecast's own number, near the last close
  const pc = market.daily("SA").then((d) => d.candles[d.candles.length - 1].c);
  return { h, docs, clock, market, svc, pc, openForecast, trained };
}

test("from the evening before to 9:45: the stages, the open each one uses, and what is kept", async () => {
  const b = boot();
  const pc = await b.pc;
  b.openForecast.peek = () => ({ date: "2026-11-27", predicted: pc * 1.004, low: pc * 0.998, high: pc * 1.01 });

  // the evening before: an early read for the next session, nothing kept
  b.clock.ms = at("2026-11-26", "19:30");
  let v = await b.svc.view("AAA");
  assert.equal(v.stage, "next");
  assert.equal(v.target, "2026-11-27");
  assert.equal(v.available, true, v.reason);
  assert.equal(b.svc._recs().size, 0, "only this morning's calls are kept");

  // 8:45: the expected open is the opening-price forecast's; rules, since nothing has been learned
  b.clock.ms = at("2026-11-27", "08:45");
  v = await b.svc.view("AAA");
  assert.equal(v.stage, "pre");
  assert.equal(v.call.engine, "rules");
  assert.equal(v.call.chances, null, "no chance is claimed without a record");
  assert.ok(Math.abs(v.call.open.price - pc * 1.004) < 0.06);
  assert.equal(v.call.open.known, false);
  assert.equal(v.call.market.source, "GIFT Nifty's expected gap");
  assert.equal(v.squareOff.clock, "3:12 PM", "AAA is in the F&O list: its MIS square-off is 3:12 PM");
  assert.match(v.squareOff.note, /automatically at 3:12 PM/);
  assert.ok(b.svc._recs().get("2026-11-27|AAA|pre"));

  // 9:05: the auction collects orders — the imbalance is read, the open is still a forecast
  b.clock.ms = at("2026-11-27", "09:05");
  v = await b.svc.view("AAA");
  assert.equal(v.stage, "preopen");
  assert.equal(v.call.soft.preImb, 0.2);
  assert.ok(Math.abs(v.call.open.indicative - pc * 1.01) < 0.06, "the auction's indicative price is shown");
  assert.ok(Math.abs(v.call.open.price - pc * 1.01) < 0.06, "and it is the best estimate of the open until 9:08");
  assert.equal(v.call.open.known, false);

  // 9:10: the auction has set the price: the call is made again from it
  b.clock.ms = at("2026-11-27", "09:10");
  v = await b.svc.view("AAA");
  assert.equal(v.stage, "auction");
  assert.equal(v.call.open.known, true);
  assert.ok(Math.abs(v.call.from.price - pc * 1.01) < 0.01);
  assert.equal(v.call.market.source, "the Nifty's pre-open price");
  assert.ok(Math.abs(v.call.market.gapPct - 0.38) < 0.01);

  // 9:27: two 5-minute bars are done; the call is made from the price now, and the half-hour's high already seen is kept
  b.clock.ms = at("2026-11-27", "09:27");
  v = await b.svc.view("AAA");
  assert.equal(v.stage, "opening");
  assert.equal(v.call.k, 2);
  assert.equal(v.call.at, "9:25 AM");
  assert.ok(v.call.levels.first30.high >= v.call.levels.soFar.high);
  assert.ok(v.call.levels.day.high >= v.call.levels.first30.high && v.call.levels.day.low <= v.call.levels.first30.low);
  assert.equal(v.call.levels.next15.at, "9:42 AM");
  assert.ok(b.svc._recs().get("2026-11-27|AAA|o2"));
  const keys = [...b.svc._recs().keys()].sort();
  assert.deepEqual(keys, ["2026-11-27|AAA|auction", "2026-11-27|AAA|o2", "2026-11-27|AAA|pre"]);

  // a 5-minute call stands as first made
  const first = b.svc._recs().get("2026-11-27|AAA|o2").madeAt;
  b.clock.ms = at("2026-11-27", "09:29");
  await b.svc.view("AAA");
  assert.equal(b.svc._recs().get("2026-11-27|AAA|o2").madeAt, first);

  // 9:50: the half-hour is scored; from 9:45 the morning call steps back for the live call
  b.clock.ms = at("2026-11-27", "09:50");
  assert.equal(await b.svc.score(), 3);
  const o2 = b.svc._recs().get("2026-11-27|AAA|o2");
  assert.ok(o2.y45 && o2.y45.c45 > 0, "the price climbed after 9:25");
  assert.equal(o2.y, undefined, "the day is not over");
  v = await b.svc.view("AAA");
  assert.equal(v.stage, "handover");
  assert.equal(v.show, false);
  assert.equal(v.today.length, 3);
  const o2t = v.today.find((t) => t.stage === "o2");
  assert.ok(o2t.result.at945 > 0);
  assert.ok(o2t.result.low30 <= o2.soFar.low, "the half-hour's low counts what had traded before the call");

  // after the close: the day is scored
  b.clock.ms = at("2026-11-27", "15:45");
  assert.equal(await b.svc.score(), 3);
  assert.ok(b.svc._recs().get("2026-11-27|AAA|o2").y.uD >= 0);
  const rec = v.record.find((g) => g.group === "opening");
  assert.ok(rec);
});

test("before 9:35 the Live Pulse can stand on the morning call; it calls wait while the opening range forms", async () => {
  const b = boot();
  b.clock.ms = at("2026-11-27", "09:16");
  const p = await b.svc.pulseLike("AAA", { session: { entries: false } });
  assert.equal(p.available, true);
  assert.equal(p.early, true);
  assert.equal(p.call, "wait");
  assert.ok(p.window.low < p.window.high);
  assert.ok(p.plans.long.stop < p.plans.long.entry && p.plans.short.stop > p.plans.short.entry);
  assert.match(p.gates[0], /before 9:30/);
  b.clock.ms = at("2026-11-27", "09:40");
  assert.equal(await b.svc.pulseLike("AAA", {}), null, "from 9:35 the pulse has its own bars");
});

test("it learns from the stored history, and its calls then carry measured chances and the reasons", async () => {
  const b = boot();
  const r = await b.svc.train({ trigger: "you asked" });
  assert.equal(r.ok, true);
  assert.equal(r.trained, true);
  assert.ok(b.svc.model().perK[0].stats.c45.dir.rate > 0.65);
  b.clock.ms = at("2026-11-27", "09:10");
  const v = await b.svc.view("AAA");
  assert.equal(v.call.engine, "model");
  assert.ok(v.call.chances.up45.p > 0.5, "gapped up 1%: more often than not up by 9:45 in this history");
  assert.equal(v.call.side, "up");
  assert.ok(v.call.drivers.length > 0);
  assert.equal(v.model.trained, true);
  assert.ok(v.model.checks.length === 3);
  const lessons = b.svc.lessons();
  assert.ok(lessons.some((l) => /tested on the newest/.test(l)));
  // a fresh service reads the stored model
  const again = new Morning({ market: b.market, docs: b.docs, now: () => b.clock.ms, log: { log() {}, error() {} } });
  assert.equal(again.model().trainedAt, b.svc.model().trainedAt);
});

test("every evening it learns again once the stored history has the new session", async () => {
  const b = boot();
  b.clock.ms = at("2026-11-27", "16:05");
  await b.svc.tick();
  assert.ok(b.svc.model(), "no model yet → learned");
  const first = b.svc.model().trainedAt;
  b.clock.ms += 60000;
  await b.svc.tick();
  assert.equal(b.svc.model().trainedAt, first, "once a day");
});

test("a stock with no closing auction is squared off at 3:25 PM", async () => {
  const b = boot();
  const s = await b.svc.squareOff("BBB");
  assert.equal(s.clock, "3:25 PM");
  assert.equal(s.cas, false);
  assert.equal(slotOfClock("09:40"), 5);
});
