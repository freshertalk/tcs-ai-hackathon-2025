"use strict";
// The opening-price forecast: the arithmetic (market/openfc.js), and the service that makes a forecast before the
// open, freezes it at 9:00, writes the real open beside it, and learns from the record (open-forecast.js).
// No network: the market is a stand-in built from made-up, repeatable price series.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const fc = require("../market/openfc");
const { OpenForecast, targetOf, SECTION } = require("../open-forecast");
const { FileDocs, COLLECTIONS } = require("../docs");
const { buildIntradayPlan } = require("../market/intraplan");

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

/** An index and a stock whose opening gap is alpha + beta × the index's gap (+ a little of yesterday's close) + noise. */
function history({ days = 320, beta = 1.6, alpha = 0.05, noise = 0.15, seed = 7, start = "2025-08-01", carry = 0.25 } = {}) {
  const r = rng(seed);
  const nifty = [];
  const stock = [];
  let date = start;
  let nc = 24000;
  let sc = 500;
  let loc = 0;
  for (let i = 0; i < days; i += 1) {
    const ng = gauss(r) * 0.45;
    const no = nc * (1 + ng / 100);
    const nclose = no * (1 + (gauss(r) * 0.6) / 100);
    nifty.push({ t: date, o: no, h: Math.max(no, nclose) * 1.003, l: Math.min(no, nclose) * 0.997, c: nclose });
    const sg = alpha + beta * ng + carry * loc + gauss(r) * noise;
    const so = sc * (1 + sg / 100);
    const sclose = so * (1 + (gauss(r) * 1.1) / 100);
    const hi = Math.max(so, sclose) * (1 + Math.abs(gauss(r)) * 0.004);
    const lo = Math.min(so, sclose) * (1 - Math.abs(gauss(r)) * 0.004);
    stock.push({ t: date, o: so, h: hi, l: lo, c: sclose, v: 100000 });
    loc = hi > lo ? ((sclose - lo) / (hi - lo)) * 2 - 1 : 0;
    nc = nclose;
    sc = sclose;
    date = dayAfter(date);
  }
  return { nifty, stock, next: date };
}

/* ------------------------------------------------------------- the arithmetic */

test("the history is read as one row per session, with what was known the evening before", () => {
  const { nifty, stock } = history({ days: 60 });
  const rows = fc.sessions(stock, nifty);
  assert.equal(rows.length, 58);
  const k = 10;
  const i = k + 2;
  assert.ok(Math.abs(rows[k].gap - (stock[i].o / stock[i - 1].c - 1) * 100) < 1e-9);
  assert.ok(Math.abs(rows[k].nGap - (nifty[i].o / nifty[i - 1].c - 1) * 100) < 1e-9);
  assert.ok(rows.every((x) => x.closeLoc >= -1 && x.closeLoc <= 1));
  const x = fc.tonight(stock, nifty);
  assert.equal(x.prevClose, stock[stock.length - 1].c);
  assert.equal(x.prevDate, stock[stock.length - 1].t);
  // a split-sized gap teaches nothing about a normal morning
  const odd = stock.map((c) => ({ ...c }));
  odd[30].o = odd[29].c * 1.4;
  assert.equal(fc.sessions(odd, nifty).length, 57);
});

test("the stock's sensitivity to the index's gap is measured, and thin history falls back to one-for-one", () => {
  const { nifty, stock } = history({ beta: 1.6 });
  const f = fc.fitIndex(fc.sessions(stock, nifty));
  assert.ok(Math.abs(f.beta - 1.6) < 0.2, `beta ${f.beta}`);
  assert.ok(f.sd > 0.1 && f.sd < 0.4);
  assert.equal(f.measured, true);
  const thin = fc.fitIndex(fc.sessions(stock.slice(0, 20), nifty.slice(0, 20)));
  assert.equal(thin.beta, 1);
  assert.equal(thin.measured, false);
});

test("a forecast: the price follows the index cue, sits on a tick, and carries a band and its working", () => {
  const { nifty, stock } = history({ beta: 1.6, alpha: 0.05 });
  const prev = stock[stock.length - 1].c;
  const up = fc.forecastOpen({ symbol: "ABC", daily: stock, nifty, cue: { gapPct: 0.5, source: "market forecast", basis: "GIFT" } });
  assert.equal(up.available, true);
  assert.ok(up.gapPct > 0.45 && up.gapPct < 1.25, `gap ${up.gapPct}`);
  assert.ok(Math.abs(up.predicted / prev - 1 - up.gapPct / 100) < 0.0006);
  assert.equal(Math.round(up.predicted * 100) % 5, 0, "on the 5-paise tick");
  assert.ok(up.band.low < up.predicted && up.predicted < up.band.high);
  for (const k of ["flat", "index", "pattern"]) assert.ok(typeof up.experts[k] === "number", k);
  assert.equal(up.experts.flat, 0);
  assert.ok(Math.abs(Object.values(up.weights).reduce((a, b) => a + b, 0) - 1) < 0.001);

  const down = fc.forecastOpen({ symbol: "ABC", daily: stock, nifty, cue: { gapPct: -0.5, source: "market forecast" } });
  assert.ok(down.gapPct < -0.3 && down.predicted < prev);

  // no cue: centred near the last close, and the band is the stock's whole normal spread of opens
  const blind = fc.forecastOpen({ symbol: "ABC", daily: stock, nifty, cue: null });
  assert.ok(Math.abs(blind.gapPct) < 0.4);
  assert.ok(blind.band.halfPct > up.band.halfPct * 1.5, "without a cue the band is much wider");
  assert.equal(blind.cue.source, "none");

  assert.equal(fc.forecastOpen({ symbol: "ABC", daily: stock.slice(0, 2), nifty }).available, false);
});

test("the index itself opens where its cue says, less the cue's own measured bias", () => {
  const { nifty } = history();
  const plain = fc.forecastOpen({ symbol: "NIFTY 50", daily: nifty, cue: { gapPct: 0.4, source: "market forecast" }, isIndex: true });
  assert.ok(Math.abs(plain.gapPct - 0.4 * plain.weights.index) < 0.02, "the blend of the cue and 'flat'");
  const L = { ...fc.emptyLearning(), cueBias: 0.1 };
  const fixed = fc.forecastOpen({ symbol: "NIFTY 50", daily: nifty, cue: { gapPct: 0.4, source: "market forecast" }, isIndex: true, learned: L });
  assert.ok(fixed.experts.index > 0.29 && fixed.experts.index < 0.31);
  assert.equal(fixed.cue.gapPct, 0.4);
  assert.equal(fixed.cue.usedPct, 0.3);
});

test("the soft evidence only tilts: agreement moves the estimate a little, one voice alone hardly at all", () => {
  const { nifty, stock } = history();
  const cue = { gapPct: 0.2, source: "market forecast" };
  const none = fc.forecastOpen({ symbol: "ABC", daily: stock, nifty, cue });
  const bull = fc.forecastOpen({ symbol: "ABC", daily: stock, nifty, cue, soft: { chart: 80, research: 70, options: 60, news: 50 } });
  const bear = fc.forecastOpen({ symbol: "ABC", daily: stock, nifty, cue, soft: { chart: -80, research: -70, options: -60, news: -50 } });
  const lone = fc.forecastOpen({ symbol: "ABC", daily: stock, nifty, cue, soft: { news: 100 } });
  assert.equal(none.experts.signals, undefined);
  assert.ok(bull.experts.signals > bull.experts.pattern && bear.experts.signals < bear.experts.pattern);
  assert.ok(bull.gapPct > none.gapPct && none.gapPct > bear.gapPct);
  assert.ok(bull.gapPct - none.gapPct < 0.15, "a tilt, not a takeover");
  assert.ok(Math.abs(lone.tilt.score) < Math.abs(bull.tilt.score) / 2);
  assert.deepEqual(bull.tilt.parts.map((p) => p.name), ["chart", "research", "options", "news"]);
});

test("on its own history the model beats 'it opens at the previous close' once the index's gap is known", () => {
  const { nifty, stock } = history({ beta: 1.6, noise: 0.15 });
  const b = fc.walkForward(stock, nifty);
  assert.ok(b.sessions >= 100);
  assert.ok(b.maePct < b.flatMaePct * 0.6, `${b.maePct} against ${b.flatMaePct}`);
  assert.ok(b.insidePct >= 55 && b.insidePct <= 85, `inside ${b.insidePct}%`);
  assert.ok(b.directionPct >= 70);
  assert.equal(fc.walkForward(stock.slice(0, 50), nifty.slice(0, 50)), null);
});

/* ------------------------------------------------------------- learning from the record */

const scoredRec = (symbol, date, gapPct, actual, extra = {}) => ({ symbol, date, gapPct, bias: 0, experts: { flat: 0, index: gapPct, pattern: gapPct }, band: { halfRaw: 0.3, halfPct: 0.3 }, tilt: { score: 0, parts: [] }, fit: { ownSd: 0.5 }, cue: { gapPct: 0.2 }, actual: { gapPct: actual }, ...extra });

test("learning: the expert that has been closest gets the weight, and a thin record stays near the start", () => {
  const recs = [];
  let d = "2026-06-01";
  for (let i = 0; i < 60; i += 1) {
    const actual = ((i % 7) - 3) * 0.2;
    // "index" is right to within 0.02; "pattern" is off by 0.3; "flat" is off by the whole gap
    recs.push(scoredRec("ABC", d, actual + 0.01, actual, { experts: { flat: 0, index: actual + 0.02, pattern: actual + 0.3 } }));
    d = dayAfter(d);
  }
  const L = fc.learnFrom(recs);
  assert.ok(L.weights.index > 0.6, JSON.stringify(L.weights));
  assert.ok(L.weights.index > L.weights.pattern && L.weights.pattern > L.weights.flat);
  assert.ok(Math.abs(Object.values(L.weights).reduce((a, b) => a + b, 0) - 1) < 0.001);
  assert.ok(L.expertMae.index < 0.03 && L.expertMae.pattern > 0.29);

  const few = fc.learnFrom(recs.slice(0, 6));
  assert.ok(Math.abs(few.weights.index - fc.PRIOR.index) < 0.2, "six forecasts do not overturn the starting weights");
  assert.deepEqual(fc.learnFrom([]).weights, fc.PRIOR);
});

test("learning: a stock that keeps opening above its forecast gets a bias, and the next forecast allows for it", () => {
  const { nifty, stock } = history();
  const recs = [];
  let d = "2026-06-01";
  for (let i = 0; i < 20; i += 1) {
    recs.push(scoredRec("ABC", d, 0.1, 0.4)); // 0.3% too low, every time
    recs.push(scoredRec("XYZ", d, 0.2, 0.2));
    d = dayAfter(d);
  }
  const L = fc.learnFrom(recs);
  assert.ok(L.bySymbol.ABC.bias > 0.2 && L.bySymbol.ABC.bias <= 0.3, `bias ${L.bySymbol.ABC.bias}`);
  assert.ok(Math.abs(L.bySymbol.XYZ.bias) < 0.01);
  assert.equal(L.bySymbol.ABC.n, 20);
  const cue = { gapPct: 0.2, source: "market forecast" };
  const before = fc.forecastOpen({ symbol: "ABC", daily: stock, nifty, cue });
  const after = fc.forecastOpen({ symbol: "ABC", daily: stock, nifty, cue, learned: L });
  assert.ok(after.bias > 0.2);
  assert.ok(after.gapPct - (after.gapPct - after.bias) > 0.2 && after.predicted > before.predicted - 0.5);
  // the bias is measured on the blend BEFORE the bias, so it does not chase itself
  const again = fc.learnFrom(recs.map((r) => (r.symbol === "ABC" ? { ...r, gapPct: 0.4, bias: 0.3 } : r)));
  assert.ok(again.bySymbol.ABC.bias > 0.2, "once corrected, the measured bias stays instead of collapsing to zero");
});

test("learning: the band widens when opens keep falling outside it, and the index cue's bias is measured", () => {
  const recs = [];
  let d = "2026-06-01";
  for (let i = 0; i < 40; i += 1) {
    const miss = i % 2 ? 0.6 : -0.6; // always twice the band
    recs.push(scoredRec("ABC", d, 0, miss));
    recs.push(scoredRec("NIFTY 50", d, 0.3, 0.2, { isIndex: true, cue: { gapPct: 0.3 } })); // the cue reads 0.1 high
    d = dayAfter(d);
  }
  const L = fc.learnFrom(recs);
  assert.ok(L.bandScale > 1.4, `scale ${L.bandScale}`);
  assert.ok(L.cueBias > 0.07 && L.cueBias <= 0.1);
  assert.ok(Math.abs(L.cueMae - 0.1) < 0.001);
  assert.equal(L.n, 40, "the index's own records are not counted as stock forecasts");
  assert.equal(L.stats.insidePct, 0);
  assert.equal(L.stats.days, 40);
});

test("learning: the soft evidence earns its worth only if it has explained the miss", () => {
  const mk = (helps) => {
    const recs = [];
    let d = "2026-06-01";
    for (let i = 0; i < 60; i += 1) {
      const t = i % 2 ? 0.6 : -0.6;
      const actual = 0.1 + (helps ? 0.5 * t * 0.5 : 0);
      recs.push(scoredRec("ABC", d, 0.1, actual, { tilt: { score: t, parts: [] }, experts: { flat: 0, index: 0.1, pattern: 0.1 } }));
      d = dayAfter(d);
    }
    return fc.learnFrom(recs).tiltK;
  };
  assert.ok(mk(true) > 0.3, "it helped: it is believed more");
  assert.ok(mk(false) < 0.15, "it did not: it is believed less");
});

test("the findings are written in plain sentences, with numbers and no promises", () => {
  const recs = [];
  let d = "2026-06-01";
  for (let i = 0; i < 30; i += 1) {
    const actual = ((i % 5) - 2) * 0.3;
    recs.push(scoredRec("ABC", d, actual + 0.35, actual));
    recs.push(scoredRec("NIFTY 50", d, 0.25, 0.2, { isIndex: true, cue: { gapPct: 0.25 } }));
    d = dayAfter(d);
  }
  const L = fc.learnFrom(recs);
  const lines = fc.lessonsOf(L);
  assert.ok(lines.length >= 3);
  assert.match(lines[0], /scored so far: 30 over 30 sessions/);
  assert.ok(lines.some((l) => /ABC lower by/.test(l)), lines.join("\n"));
  assert.ok(lines.every((l) => !/guarantee|sure shot|risk-free|always wins|never loses/i.test(l)));
  assert.deepEqual(fc.lessonsOf(fc.learnFrom(recs.slice(0, 6))), [], "too few to say anything");
});

/* ------------------------------------------------------------- the service */

const istMs = (date, hhmm) => Date.parse(`${date}T${hhmm}:00+05:30`);

function desk({ seed = 11 } = {}) {
  const h = history({ seed, start: "2025-08-01", days: 320 });
  const other = history({ seed: seed + 1, start: "2025-08-01", days: 320, beta: 0.8 });
  const data = { "NIFTY 50": h.nifty, ABC: h.stock, XYZ: other.stock };
  const clock = { t: 0 };
  const calls = { forecast: 0, options: 0, quotes: 0 };
  const m = {
    state: "kite",
    cue: 0.3,
    openOf: {}, // symbol -> today's open, once the market has opened
    mode: () => m.state,
    daily: async (s) => {
      if (!data[s]) throw new Error("no such stock");
      return { candles: data[s], stale: false };
    },
    index: async () => ({ candles: data["NIFTY 50"] }),
    quotes: async (syms) => {
      calls.quotes += 1;
      return { quotes: Object.fromEntries(syms.filter((s) => data[s]).map((s) => [s, { last: m.openOf[s] || data[s][data[s].length - 1].c * 1.002, open: m.openOf[s] || 0 }])) };
    },
    marketForecast: async () => {
      calls.forecast += 1;
      return { available: true, open: { gapPct: m.cue, basis: "GIFT Nifty against the future", label: "a gap-up open" }, lean: { score: 20 } };
    },
    optionChain: async () => {
      calls.options += 1;
      return { available: true, bias: { score: 40 } };
    },
    watchlist: () => ["ABC", "XYZ"],
    social: null,
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-open-"));
  const docs = new FileDocs(dir);
  const written = [];
  const playbook = { setSection: (head, body) => written.push({ head, body }) };
  const of = new OpenForecast({ market: m, docs, playbook, now: () => clock.t, log: { log() {}, error() {} } });
  // the next session after the made-up history, and a way to "trade" it: add the day's bar
  const trade = (date, gaps) => {
    for (const s of Object.keys(data)) {
      const prev = data[s][data[s].length - 1];
      const o = prev.c * (1 + (gaps[s] ?? 0) / 100);
      m.openOf[s] = o;
      data[s].push({ t: date, o, h: o * 1.01, l: o * 0.99, c: o * 1.004, v: 1 });
    }
  };
  return { m, docs, dir, of, clock, calls, data, written, next: h.next, trade };
}

test("which session a forecast is for: today until the close, then the next weekday", () => {
  assert.equal(targetOf(istMs("2026-11-17", "08:10")), "2026-11-17"); // Tuesday morning
  assert.equal(targetOf(istMs("2026-11-17", "12:00")), "2026-11-17");
  assert.equal(targetOf(istMs("2026-11-17", "15:31")), "2026-11-18");
  assert.equal(targetOf(istMs("2026-11-20", "18:00")), "2026-11-23"); // Friday evening → Monday
  assert.equal(targetOf(istMs("2026-11-22", "10:00")), "2026-11-23"); // Sunday
  assert.ok(COLLECTIONS.includes("open_forecasts"), "the collection is one the database loads");
});

test("a morning: made before the auction, final at 9:00, the real open beside it at 9:16, and kept", async () => {
  const s = desk();
  const day = s.next;
  s.clock.t = istMs(day, "08:40");
  const a = await s.of.forecast("ABC");
  assert.equal(a.date, day);
  assert.equal(a.stage, "morning");
  assert.equal(a.revisions, 1);
  assert.ok(a.predicted > 0 && a.band.low < a.band.high);
  assert.equal(a.cue.gapPct, 0.3);
  assert.equal(s.calls.options, 1, "opened by hand: the option chain is read too");
  assert.equal((await s.of.forecast("ABC")).madeAt, a.madeAt, "not redone within three minutes");

  // the cue moves; ten minutes later the forecast follows it
  s.m.cue = 0.8;
  s.clock.t = istMs(day, "08:52");
  const b = await s.of.forecast("ABC");
  assert.equal(b.revisions, 2);
  assert.ok(b.predicted > a.predicted, "a bigger expected index gap, a higher expected open");
  assert.deepEqual(b.first, { gapPct: a.gapPct, predicted: a.predicted }, "the first forecast is remembered");

  // 9:05: the auction is on — final, whatever is asked
  s.m.cue = -2;
  s.clock.t = istMs(day, "09:05");
  const c = await s.of.forecast("ABC", { force: true });
  assert.equal(c.madeAt, b.madeAt);
  let v = await s.of.view("ABC");
  assert.equal(v.phase, "auction");
  assert.equal(v.final, true);
  assert.equal(v.current.predicted, b.predicted);
  assert.equal(v.current.actual, null);
  assert.ok(v.preopen && v.preopen.price > 0, "the exchange's indicative price is shown, not scored");
  // a stock first opened during the auction gets no forecast: it would not be a forecast
  const late = await s.of.view("XYZ");
  assert.equal(late.available, false);
  assert.match(late.reason, /before today's opening auction/);

  // the market opens 0.5% up
  s.trade(day, { ABC: 0.5, "NIFTY 50": 0.4, XYZ: 0.2 });
  s.clock.t = istMs(day, "09:17");
  v = await s.of.view("ABC");
  assert.equal(v.phase, "open");
  assert.equal(v.current.actual.open, s.m.openOf.ABC);
  assert.equal(v.current.actual.source, "quote");
  assert.ok(Math.abs(v.current.actual.gapPct - 0.5) < 0.01);
  assert.ok(Math.abs(v.current.errPct - (b.gapPct - 0.5)) < 0.011, "the miss is forecast minus actual");
  assert.equal(typeof v.current.inBand, "boolean");
  assert.ok(v.current.experts.index.missPct !== null);
  assert.equal(v.history.length, 1);
  assert.equal(v.learning.scored, 1);

  // kept: a new service on the same store has it
  const again = new OpenForecast({ market: s.m, docs: new FileDocs(s.dir), now: () => s.clock.t, log: { log() {}, error() {} } });
  assert.equal(again.peek("ABC").actual, s.m.openOf.ABC);
  assert.equal(again.learned().n, 1);

  // after the close the page moves on to the next session, and keeps today's result beside it
  s.clock.t = istMs(day, "16:10");
  s.m.cue = 0.1;
  v = await s.of.view("ABC");
  assert.equal(v.phase, "next");
  assert.equal(v.target, dayAfter(day));
  assert.equal(v.current.stage, "evening");
  assert.equal(v.current.actual, null);
  assert.equal(v.last.date, day);
  assert.equal(v.last.actual.open, s.m.openOf.ABC);
  assert.ok(v.backtest && v.backtest.sessions >= 100);
});

test("by itself: the morning sweep forecasts the index and the watchlist, the 9:16 tick scores them, and it learns", async () => {
  const s = desk();
  let day = s.next;
  const gaps = [0.4, -0.3, 0.1, 0.6, -0.5, 0.2, -0.1, 0.3, -0.4, 0.5, 0.15, -0.25];
  for (const g of gaps) {
    s.m.cue = g + 0.1; // the cue reads the index 0.1 too high every day
    s.clock.t = istMs(day, "08:31");
    await s.of.tick();
    assert.ok(s.of.peek("NIFTY 50") && s.of.peek("ABC") && s.of.peek("XYZ"), "the index and the watchlist");
    s.clock.t = istMs(day, "09:00");
    await s.of.tick();
    s.trade(day, { "NIFTY 50": g, ABC: 1.6 * g + 0.05, XYZ: 0.8 * g });
    s.clock.t = istMs(day, "09:16");
    await s.of.tick();
    assert.equal(s.of.peek("ABC").actual, s.m.openOf.ABC);
    day = dayAfter(day);
  }
  assert.equal(s.calls.options, 0, "the sweep does not read forty option chains");
  const L = s.of.learned();
  assert.equal(L.n, 24);
  assert.equal(L.cueN, 12);
  assert.ok(L.cueBias > 0.04, `the cue's bias is found: ${L.cueBias}`);
  assert.ok(L.stats.maePct < L.stats.flatMaePct, "it beats 'opens at the previous close'");
  assert.ok(L.bySymbol.ABC && L.bySymbol.XYZ);
  // the findings reach the file every AI feature reads
  assert.ok(s.written.length >= 1);
  assert.equal(s.written.at(-1).head, SECTION);
  assert.match(s.written.at(-1).body, /Opening-price forecasts scored so far: 24 over 12 sessions/);
  const board = s.of.board();
  assert.equal(board.learning.scored, 24);
  assert.equal(board.waiting, 0);
  assert.ok(board.recent.length === 36 && board.recent[0].date >= board.recent[35].date);
  // and the forecast now takes the cue's bias out
  s.m.cue = 0.5;
  s.clock.t = istMs(day, "08:45");
  const r = await s.of.forecast("NIFTY 50", { force: true });
  assert.ok(r.cue.usedPct < 0.5 && r.cue.usedPct > 0.35);
});

test("a morning the server slept through is scored later from the day's bar; a holiday is not scored at all", async () => {
  const s = desk();
  const day = s.next;
  s.clock.t = istMs(day, "08:40");
  await s.of.forecast("ABC");
  // nobody was there at 9:16; the next evening the bar is on record but no quote says "today"
  s.trade(day, { ABC: -0.7 });
  s.m.state = "none";
  s.clock.t = istMs(dayAfter(day), "20:00");
  assert.equal(await s.of.score(), 1);
  const done = (await s.of.view("ABC")).last;
  assert.equal(done.date, day);
  assert.equal(done.actual.source, "day bar");
  assert.ok(Math.abs(done.actual.gapPct + 0.7) < 0.01);

  // a forecast for a day the market turned out to be shut
  s.m.state = "kite";
  const holiday = dayAfter(dayAfter(day));
  s.clock.t = istMs(holiday, "08:40");
  await s.of.forecast("XYZ");
  const after = dayAfter(holiday);
  s.data.XYZ.push({ t: after, o: 100, h: 101, l: 99, c: 100, v: 1 }); // the next session trades; the holiday has no bar
  s.clock.t = istMs(after, "20:00");
  await s.of.score();
  const rec = s.docs.items("open_forecasts").find((r) => r.symbol === "XYZ" && r.date === holiday);
  assert.equal(rec.void, true);
  assert.equal(rec.actual, null);
  assert.equal(s.of.learned().n, 1, "a void forecast teaches nothing");
});

test("no Zerodha, a demo, a bad symbol: it says so instead of guessing", async () => {
  const s = desk();
  s.clock.t = istMs(s.next, "08:40");
  await assert.rejects(s.of.view("bad symbol!"), { code: "invalid" });
  s.m.state = "none";
  const v = await s.of.view("ABC"); // saved bars are still there: a forecast without an index cue
  assert.equal(v.available, true);
  assert.equal(v.current.cue.source, "none");
  assert.equal(s.calls.forecast, 0);
  s.m.state = "demo";
  assert.equal(await s.of.forecast("XYZ"), null);
  assert.match((await s.of.view("XYZ")).reason, /real prices/);
  s.m.state = "kite";
  const missing = await s.of.view("NOSUCH");
  assert.equal(missing.available, false);
  assert.match(missing.reason, /no such stock/);
});

test("the intraday plan's expected open follows the learned forecast when there is one", () => {
  const { nifty, stock } = history();
  const plain = buildIntradayPlan({ daily: stock, nifty });
  const hinted = buildIntradayPlan({ daily: stock, nifty, openHint: { gapPct: 0.62, halfPct: 0.33 } });
  assert.equal(plain.open.gapPct, 0);
  assert.equal(hinted.open.gapPct, 0.62);
  assert.match(hinted.open.basis, /opening-price forecast/);
  assert.ok(hinted.open.expected > plain.open.expected);
  assert.ok(Math.abs((hinted.open.high / hinted.open.expected - 1) * 100 - 0.33) < 0.03);
});
