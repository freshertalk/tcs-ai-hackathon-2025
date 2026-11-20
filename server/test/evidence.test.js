"use strict";
// The evidence desk (server/market/evidence.js, server/evidence.js): the techniques read the bars as the books describe
// them; each one's record is measured, not assumed; the call uses them only where they beat the forecaster alone on unseen
// rows; what is only known live is read, kept and checked; the AI is asked about an opened stock only when needed, within
// its limits; and nothing is claimed that was not found.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const H = require("../market/horizon");
const E = require("../market/evidence");
const { Horizon } = require("../horizon");
const { Ahead } = require("../ahead");
const { Evidence, CALLS, DAYS, LIVE } = require("../evidence");
const { SpendGuard } = require("../ai/spend");
const { FileDocs, COLLECTIONS } = require("../docs");

const IST = 5.5 * 3600 * 1000;
const quiet = { log() {}, error() {} };
const mkdocs = () => new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-evidence-")));

function rng(seed) {
  let s = seed >>> 0;
  const u = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  return { u, n: () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u()) };
}
const weekdays = (from, n) => {
  const out = [];
  let t = Date.parse(`${from}T00:00:00Z`);
  while (out.length < n) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) out.push(new Date(t).toISOString().slice(0, 10));
    t += 86400000;
  }
  return out;
};
const openMs = (date) => Date.parse(`${date}T09:15:00Z`) - IST;
const T0 = openMs("2026-03-02");
/** Bars from rows of [open, high, low, close, volume], one per 5-minute slot from 9:15. */
const mk = (rows) => rows.map(([o, h, l, c, v], i) => ({ t: T0 + i * 300000, o, h, l, c, v }));
const at = (states, id) => states[E.WIX[id]];

/* ------------------------------------------------------------------------------------------------ the techniques */

test("the techniques read the bars as the books describe them: breakout, held, failed, swept", () => {
  // a usual 5-minute move is 0.2% (about 0.20 at a price of 100); the usual volume of a bar is 1,000
  const ctx = { sigma: 0.002, vol: new Array(75).fill(1000), prevClose: 100, prevHigh: 103, prevLow: 97 };
  const bars = mk([
    [100.0, 100.6, 99.8, 100.4, 1000],
    [100.4, 100.9, 100.2, 100.7, 1000],
    [100.7, 101.0, 100.5, 100.8, 1000], // the opening range: 99.80 – 101.00
    [100.8, 101.6, 100.7, 101.5, 2000], // closes above it on twice the usual volume
    [101.5, 101.7, 101.3, 101.4, 800],
    [101.4, 101.5, 101.0, 101.1, 800],
    [101.1, 101.2, 100.5, 100.6, 1500], // back inside: the breakout has failed
    [100.6, 101.9, 100.5, 100.7, 1000], // takes out the day's high 101.70 and closes far below it
  ]);
  const P = E.prep(bars, ctx);
  assert.deepEqual([P.orL, P.orH, P.orAt], [99.8, 101, 3]);
  const S = E.statesAll(P);
  assert.equal(S.length, 8);
  assert.equal(S[0].length, E.W);
  // nothing is said about the opening range while it is still forming
  assert.equal(at(S[2], "orbBreak"), 0);
  assert.equal(at(S[3], "orbBreak"), 1, "a close above the range on volume");
  assert.deepEqual([at(S[4], "orbBreak"), at(S[5], "orbBreak"), at(S[6], "orbBreak")], [1, 1, 0], "a breakout is remembered for three bars, no longer");
  assert.equal(at(S[3], "threeBar"), 1, "three bars with higher highs, higher lows and higher closes");
  assert.equal(at(S[3], "cprSide"), 1, "above yesterday's pivot range");
  assert.equal(at(S[6], "orbFail"), -1, "looked above the range and closed back inside: a trap");
  assert.equal(at(S[5], "orbFail"), 0);
  assert.equal(at(S[7], "sweep"), -1, "the high was taken out and rejected");
  assert.equal(at(S[7], "pinBar"), -1);
  // the same breakout on thin volume is not one
  const thin = bars.map((b, i) => (i === 3 ? { ...b, v: 900 } : b));
  assert.equal(at(E.statesAll(E.prep(thin, ctx))[3], "orbBreak"), 0);
  // mirrored, it reads the same the other way
  const flip = bars.map((b) => ({ ...b, o: 200 - b.o, h: 200 - b.l, l: 200 - b.h, c: 200 - b.c }));
  const F = E.statesAll(E.prep(flip, ctx));
  assert.deepEqual([at(F[3], "orbBreak"), at(F[6], "orbFail"), at(F[7], "sweep")], [-1, 1, 1]);

  // a row for the model: what the witnesses said, and what the price then did in usual moves for that time
  const rows = E.witnessRows(bars, ctx);
  assert.equal(rows.length, 8);
  assert.ok(Math.abs(rows[3].y[0] - (101.4 - 101.5) / 101.5 / 0.002) < 1e-9, "5 minutes on");
  assert.ok(Math.abs(rows[3].y[1] - (100.6 - 101.5) / 101.5 / (0.002 * Math.sqrt(3))) < 1e-9, "15 minutes on, over a usual 15-minute move");
  assert.ok(Number.isNaN(rows[7].y[0]) && Number.isNaN(rows[5].y[1]), "what the session does not hold is not made up");
  assert.deepEqual(E.outcomesOf(0.31), [1, 0]);
  assert.deepEqual(E.outcomesOf(-0.31), [0, 1]);
  assert.deepEqual(E.outcomesOf(0.1), [0, 0], "less than 0.3 of a usual move is neither a rise nor a fall");
  assert.equal(E.outcomesOf(NaN), null);

  // in words, for the newest bar, with the levels a trader has on the chart
  const now = E.readNow(bars.slice(0, 4), ctx);
  const orb = now.said.find((s) => s.id === "orbBreak");
  assert.match(orb.text, /closed above the opening range \(99\.80–101\.00\) on 2× usual volume/);
  const levels = E.levelsOf(now.P);
  assert.ok(levels.find((l) => l.name === "Opening range high" && l.price === 101 && l.side === "below"));
  assert.ok(levels.find((l) => l.name === "Yesterday's high" && l.price === 103 && l.side === "above" && l.moves > 5));
  const ind = E.indicatorsOf(now.P);
  assert.ok(ind.vwap > 100 && ind.vwap < 101.5 && ind.volumeTimesUsual === 2 && ind.usualMovePct === 0.2);
  // every technique has a name, a family and a sentence saying what it is
  for (const w of E.WITS) assert.ok(w.name && E.FAMILIES.includes(w.fam) && w.what.length > 40 && typeof w.ev === "function" && typeof w.say === "function", w.id);
  assert.equal(new Set(E.WITS.map((w) => w.id)).size, E.W);
});

test("a technique's record is measured: works, works the other way, no edge, or too few cases", () => {
  const R = rng(5);
  const led = E.emptyLedger(["good", "inverse", "noise", "rare", "herd", "fewDays"]);
  // 100 sessions of 40 bars each
  for (let d = 0; d < 100; d += 1) {
    const day = E.emptyDay();
    // on a "herd" day every stock moves together: one draw decides all 40 bars of the session
    const together = R.n();
    for (let i = 0; i < 40; i += 1) {
      const s = R.u() < 0.5 ? 1 : -1;
      E.dayAdd(day, "good", 1, s, 0.25 * s + R.n());
      E.dayAdd(day, "inverse", 1, s, -0.25 * s + R.n());
      E.dayAdd(day, "noise", 1, s, R.n());
      E.dayAdd(day, "herd", 1, 1, 0.12 + together);
      if (d === 0) E.dayAdd(day, "rare", 1, s, 2 * s + R.n());
      if (d < 5) for (let j = 0; j < 20; j += 1) E.dayAdd(day, "fewDays", 1, s, 2 * s + R.n());
    }
    E.dayAdd(day, "good", 1, 0, 5); // a silent witness is not counted
    E.dayAdd(day, "good", 1, 1, NaN); // nor a bar with no outcome
    E.ledgerFold(led, day);
  }
  const good = E.recordOf(led.good[1]);
  assert.deepEqual([good.n, good.days, good.verdict], [4000, 100, "works"]);
  assert.ok(good.right > 0.55 && good.edge > 0.2 && good.edge < 0.3, JSON.stringify(good));
  assert.equal(E.recordOf(led.inverse[1]).verdict, "backwards");
  assert.equal(E.recordOf(led.noise[1]).verdict, "none");
  assert.equal(E.recordOf(led.rare[1]).verdict, "thin", "40 cases prove nothing, however good they look");
  assert.equal(E.recordOf(led.fewDays[1]).verdict, "thin", "4,000 cases on five sessions prove nothing either");
  assert.equal(E.recordOf(led.good[0]).verdict, "thin", "nothing was recorded for 5 minutes");
  // 4,000 bars that all moved with their session are 100 trials, not 4,000: counted bar by bar this would pass for an edge
  const herd = E.recordOf(led.herd[1]);
  assert.equal(herd.verdict, "none", JSON.stringify(herd));
  assert.ok(herd.n === 4000 && Math.abs(herd.edge) < 0.4);
  // records add (a new day is added to the old ones) and fade
  const sum = E.ledgerMerge(E.emptyLedger(["good"]), led);
  assert.equal(E.recordOf(sum.good[1]).n, 4000);
  assert.equal(E.recordOf(E.ledgerScale(sum, 0.5).good[1]).n, 2000);
});

/** Bars for the stacked model with a known truth: the forecaster's call matters, and witness 0 matters by `power`. */
function planted(n, power, seed) {
  const R = rng(seed);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const f = 0.5 * R.n();
    const w = new Int8Array(E.W);
    const a = R.u();
    w[0] = a < 0.15 ? 1 : a < 0.3 ? -1 : 0;
    w[1] = R.u() < 0.2 ? (R.u() < 0.5 ? 1 : -1) : 0; // a witness that says things and means nothing
    const y = 0.3 * f + power * w[0] + R.n();
    out.push({ z: E.inputsOf(f, w), y: E.outcomesOf(y), yv: y });
  }
  return out;
}
function judged(power, seed) {
  const rows = planted(44000, power, seed);
  const sums = new E.Sums();
  for (const r of rows.slice(0, 24000)) sums.add(r.z, r.y);
  const W = E.fit(sums);
  const W0 = E.fit(sums, 2);
  const base = sums.base();
  const cal = E.emptyCal();
  const cal0 = E.emptyCal();
  for (const r of rows.slice(24000, 34000)) {
    E.calAdd(cal, W, r.z, r.y);
    E.calAdd(cal0, W0, r.z, r.y);
  }
  const full = { W, base, curves: E.curvesOf(cal, base) };
  const alone = { W: W0, base, curves: E.curvesOf(cal0, base) };
  const ev = E.emptyEv();
  // the unseen rows come in sessions of 100: each session is one trial of "does this hold?"
  rows.slice(34000).forEach((r, i) => {
    if (i % 100 === 0) E.evClose(ev);
    E.evAdd(ev, full, alone, r.z, r.y, r.yv);
  });
  E.evClose(ev);
  return { sums, W, W0, base, full, alone, ev };
}

test("the techniques are used only where they beat the forecaster alone on rows neither has seen", () => {
  const yes = judged(0.6, 3);
  assert.equal(yes.W[0].length, E.D);
  assert.equal(yes.W0[0].length, 2, "the forecaster alone: an intercept and its own call");
  assert.ok(yes.W[0][2] > 0.1 && yes.W[1][2] < -0.1, "the witness that matters pushes a rise up and a fall down");
  assert.ok(Math.abs(yes.W[0][3]) < 0.03, `the witness that means nothing gets next to no weight: ${yes.W[0][3]}`);
  assert.ok(E.addsOf(yes.ev) > 0.01 && E.techniquesOn(yes.ev), `the miss fell by ${E.addsOf(yes.ev)}`);
  const s = E.summarise(yes.ev);
  assert.ok(s.on && s.all.n > 2000 && s.all.right > s.alone.right, JSON.stringify(s));
  assert.ok(s.tiers.strong.n > 500 && s.tiers.strong.right > 0.6 && s.tiers.strong.proven, JSON.stringify(s.tiers));
  // the chances are honest: where it said about 60%, about 60% rose
  const z = E.inputsOf(0.8, Object.assign(new Int8Array(E.W), { 0: 1 }));
  const call = E.callOf(yes.full, z);
  assert.ok(call.side === 1 && call.tier === "strong" && call.pUp > 0.55 && call.pUp < 0.85 && call.pDown < 0.2, JSON.stringify(call));
  // with the same inputs mirrored it points down
  const down = E.callOf(yes.full, E.inputsOf(-0.8, Object.assign(new Int8Array(E.W), { 0: -1 })));
  assert.ok(down.side === -1 && down.pDown > 0.55);

  // the same witness with nothing behind it: no gain, so the techniques are left out of the call
  const no = judged(0, 3);
  assert.ok(E.addsOf(no.ev) < E.MIN_ADD && !E.techniquesOn(no.ev), `claimed a gain of ${E.addsOf(no.ev)} from nothing`);
  assert.equal(E.summarise(no.ev).on, false);
  // too few rows: nothing is fitted, and a thin calibration says nothing
  assert.equal(E.fit(new E.Sums()), null);
  assert.equal(E.calCurve(new Array(E.NB).fill(10), new Array(E.NB).fill(5), 0.4), null);
  // sums add and fade, and survive being stored
  const back = E.Sums.from(JSON.parse(JSON.stringify(yes.sums.toJSON())));
  assert.equal(back.n, 24000);
  assert.ok(Math.abs(back.base()[0] - yes.base[0]) < 1e-6);
  assert.equal(E.Sums.from({ D: 3 }).n, 0, "sums made for another list of techniques are not used");
});

test("the lean: firm only when the chance stands clear of the usual rate", () => {
  assert.deepEqual(E.leanOf(0.56, 0.2, 0.38, 0.38), { side: 1, tier: "strong" });
  assert.deepEqual(E.leanOf(0.47, 0.3, 0.38, 0.38), { side: 1, tier: "clear" });
  assert.deepEqual(E.leanOf(0.41, 0.35, 0.38, 0.38), { side: 1, tier: "slight" });
  assert.deepEqual(E.leanOf(0.39, 0.38, 0.38, 0.38), { side: 0, tier: "" }, "at the usual rate it says nothing");
  assert.deepEqual(E.leanOf(0.3, 0.48, 0.38, 0.38), { side: -1, tier: "clear" });
  assert.deepEqual(E.leanOf(0.41, 0.4, 0.38, 0.38), { side: 0, tier: "" }, "a rise and a fall both a little likelier (a big move either way) is not a direction");
  // proven: right clearly more often than a coin, on enough calls, session after session
  // (the third number is the spread between sessions: Σ (right − half the leans)² over the sessions)
  const sessions = (list) => list.reduce((a, [n, ok]) => [a[0] + n, a[1] + ok, a[2] + (ok - n / 2) ** 2], [0, 0, 0]);
  assert.equal(E.provenOf(sessions(Array.from({ length: 40 }, (_, i) => [50, i % 2 ? 29 : 27]))), true, "56% of 2,000, a little above half on every session");
  assert.equal(E.provenOf(sessions(Array.from({ length: 40 }, (_, i) => [50, i % 2 ? 31 : 21]))), false, "52% of 2,000 that swings from session to session is within chance");
  assert.equal(E.provenOf(sessions([[1000, 900], [1000, 220]])), false, "one very good session and one very bad one prove nothing");
  assert.equal(E.provenOf(sessions(Array.from({ length: 10 }, () => [30, 21]))), false, "70% of 300 is too few to call proven");
  assert.equal(E.provenOf([2000, 1120]), false, "a tally with no sessions behind it is not proven");
});

test("what is only known live: the order book price by price, open interest, the market, BSE and the world, each with its lean", () => {
  const L = {
    last: 1432.5,
    minute: 9 * 60 + 40,
    nseVolume: 900000,
    book: { b: [[1432.4, 4000, 12], [1432.3, 1500, 6], [1432.2, 1200, 5], [1432.1, 1100, 4], [1432.0, 900, 4]], a: [[1432.6, 300, 2], [1432.7, 700, 3], [1432.8, 800, 3], [1432.9, 600, 2], [1433.0, 500, 2]], buyQty: 640000, sellQty: 360000 },
    flow: { available: true, pressure: 44, label: "Buyers pressing", deltaRatio60Pct: 31 },
    tape: { oi15Pct: 0.6, oiDayPct: 3.1, position: "long build-up" },
    chain: { available: true, spot: 1432.5, pcr: 1.31, maxPain: 1420, resistance: { strike: 1440 }, support: { strike: 1400 }, bias: { score: 30, label: "Bullish" } },
    market: { available: true, tide: { label: "Falling", summary: "Falling tide (−9): Nifty −0.60% on the day." }, nifty: { changePct: -0.6 }, vix: { last: 15.2, changePct: 6.5 }, breadth: { up: 1, down: 8, total: 10 }, items: [{ id: "gift", available: true, changePct: -0.95 }] },
    sector: { name: "NIFTY IT", changePct: 0.3 },
    sensex: { changePct: -0.55 },
    bse: { last: 1432.3, changePct: 0.4, volume: 100000, book: { b: [[1432.2, 200, 2]], a: [[1432.7, 900, 4]], buyQty: 5000, sellQty: 9000 } },
    world: [{ id: "spx", name: "S&P 500", changePct: -1.1, available: true }, { id: "ixic", name: "Nasdaq Composite", changePct: -1.6, available: true }, { id: "n225", name: "Nikkei 225", changePct: -0.9, available: true }, { id: "hsi", name: "Hang Seng", changePct: -0.5, available: true }],
  };
  const { rows, book, bseBook } = E.liveWitnesses(L);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  // the book: 8,700 shares bid against 2,900 offered at the five nearest prices
  assert.deepEqual([book.bidQty, book.askQty], [8700, 2900]);
  assert.equal(by.book5.state, 1);
  assert.match(by.book5.text, /8,700 shares bid against 2,900 offered at the 5 nearest prices \(buyers 75%\)/);
  assert.equal(by.bookAll.state, 1);
  assert.match(by.bookAll.text, /6,40,000 shares waiting to buy against 3,60,000 waiting to sell \(buyers 64%\)/);
  assert.equal(by.micro.state, 1, "little is offered at the best price: the offer gives way first");
  assert.equal(by.wall.state, 1);
  assert.match(by.wall.text, /4,000 shares bid at 1,432\.40/);
  assert.deepEqual([by.press.state, by.delta.state], [1, 1]);
  // open interest and options
  assert.equal(by.oi15.state, 1);
  assert.match(by.oi15.text, /\+0\.60% in 15 minutes: long build-up/);
  assert.equal(by.optBias.state, 1);
  assert.equal(by.optWall.state, 0, "the call wall 1,440 is more than half a percent away");
  // the market leans the other way: every one says so by itself
  assert.deepEqual([by.tide.state, by.breadth.state, by.vix.state, by.gift.state], [-1, -1, -1, -1]);
  assert.equal(by.sector.state, 1, "its sector is 0.9 points stronger than NIFTY");
  assert.equal(by.sensex.state, 0, "the SENSEX is a reading, not a lean");
  assert.match(by.sensex.text, /the two exchanges agree/);
  // BSE: its own book for the same stock, and its share of the volume
  assert.deepEqual([bseBook.bidQty, bseBook.askQty], [200, 900]);
  assert.equal(by.bseBook.state, -1);
  assert.match(by.bseBook.text, /BSE has 10% of today's volume/);
  // the world: Wall Street counts at the open…
  assert.equal(by.us.state, -1);
  assert.equal(by.asia.state, -1);
  // …and is in the price by mid-morning
  const late = Object.fromEntries(E.liveWitnesses({ ...L, minute: 11 * 60 }).rows.map((r) => [r.id, r]));
  assert.equal(late.us.state, 0);
  assert.match(late.us.text, /in the price since the open/);
  // every row is a known witness with a family
  for (const r of rows) assert.ok(E.LIVE_IX[r.id] !== undefined && E.LIVE_FAMS.includes(r.fam) && r.text.length > 10, r.id);
  // what is missing is simply left out: nothing is invented
  assert.deepEqual(E.liveWitnesses({}).rows, []);
  assert.deepEqual(E.liveWitnesses({ market: { available: false } }).rows, []);
});

test("a kept call is settled from the session's bars, in usual moves for that time", () => {
  const bars = mk(Array.from({ length: 8 }, (_, i) => [100 + i * 0.1, 100.2 + i * 0.1, 99.9 + i * 0.1, 100.1 + i * 0.1, 1000]));
  // made at the close of the third bar (slot 2), price 100.30
  const rec = { anchorEnd: T0 + 3 * 300000, price: 100.3, sigma: 0.002 };
  const out = E.settle(rec, bars);
  assert.ok(Math.abs(out[1] - (100.4 - 100.3) / 100.3 / 0.002) < 1e-3);
  assert.ok(Math.abs(out[3] - (100.6 - 100.3) / 100.3 / (0.002 * Math.sqrt(3))) < 1e-3);
  assert.equal(E.settle({ anchorEnd: T0 + 7 * 300000, price: 100.7, sigma: 0.002 }, bars)[3], undefined, "a bar the session does not hold is not settled");
});

/* ------------------------------------------------------------------------------------------------ the service */

function world(dates, nStocks, { phi = 0, seed = 7 } = {}) {
  const R = rng(seed);
  const mkt = new Map();
  for (const d of dates) mkt.set(d, Array.from({ length: 75 }, () => 0.0006 * R.n()));
  const stocks = [];
  for (let s = 0; s < nStocks; s += 1) {
    const beta = 0.6 + 0.8 * R.u();
    let close = 100 + s * 37;
    const days = [];
    for (const d of dates) {
      let price = close * (1 + 0.003 * R.n());
      let prev = 0;
      const bars = [];
      for (let i = 0; i < 75; i += 1) {
        const r = phi * prev + beta * mkt.get(d)[i] + 0.0011 * R.n();
        prev = r;
        const o = price;
        price *= 1 + r;
        bars.push({ t: openMs(d) + i * 300000, o, h: Math.max(o, price) * (1 + Math.abs(0.0004 * R.n())), l: Math.min(o, price) * (1 - Math.abs(0.0004 * R.n())), c: price, v: Math.round(100000 * Math.exp(0.4 * R.n())) });
      }
      days.push([d, bars]);
      close = price;
    }
    stocks.push({ symbol: `T${String(s).padStart(2, "0")}`, days });
  }
  return { stocks };
}
function fakeHistory(stocks) {
  const by = new Map(stocks.map((s) => [s.symbol, s.days.flatMap(([, bars]) => bars)]));
  let to = stocks[0].days[stocks[0].days.length - 1][0];
  return {
    record: (s) => (by.has(s) ? { id: s } : null),
    bars: (s) => by.get(s) || [],
    status: () => ({ stocks: by.size, expected: by.size, sessions: 120, to }),
    needs: () => [],
    sync: async () => ({}),
    append: (s, date, bars) => {
      by.set(s, by.get(s).concat(bars));
      to = date;
    },
  };
}

/** A forecaster trained on a made-up market with the evidence desk beside it, a session "today", and a made-up live market. */
async function setup(opts) {
  const all = weekdays("2026-01-05", 124);
  const full = world(all, 24, opts);
  const stocks = full.stocks.map((s) => ({ symbol: s.symbol, days: s.days.slice(0, 120) }));
  const history = fakeHistory(stocks);
  const docs = mkdocs();
  const clock = { ms: openMs(all[121]) + (11 * 60 + 3 - (9 * 60 + 15)) * 60000 + 10000 }; // 11:03:10 on a session after the history
  const dayOf = (s, i) => full.stocks.find((x) => x.symbol === s).days[i];
  const asked = { quotes: [], chain: 0 };
  const lastOf = (s) => dayOf(s, 121)[1].filter((b) => b.t + 300000 <= clock.ms).slice(-1)[0].c;
  const kite = {
    quotes: async (keys) => {
      asked.quotes.push(keys);
      const out = {};
      for (const key of keys) {
        const [ex, sym] = key.split(":");
        if (sym === "SENSEX") out[key] = { last: 80000, changePct: 0.45 };
        else if (full.stocks.some((x) => x.symbol === sym)) {
          const p = lastOf(sym);
          const lv = (d, q) => [Math.round((p + d) * 20) / 20, q, 3];
          out[key] = { last: p, changePct: 0.8, volume: ex === "BSE" ? 50000 : 950000, avgPrice: p, buyQty: 60000, sellQty: 40000, depth: { b: [lv(-0.05, 900), lv(-0.1, 700), lv(-0.15, 600), lv(-0.2, 500), lv(-0.25, 400)], a: [lv(0.05, 300), lv(0.1, 300), lv(0.15, 250), lv(0.2, 250), lv(0.25, 200)] } };
        }
      }
      return out;
    },
  };
  const market = {
    mode: () => "kite",
    watchlist: () => ["T00", "T01"],
    daily: async (s) => ({ candles: full.stocks.find((x) => x.symbol === s).days.slice(0, 121).map(([d, bars]) => ({ t: d, o: bars[0].o, h: Math.max(...bars.map((b) => b.h)), l: Math.min(...bars.map((b) => b.l)), c: bars[bars.length - 1].c })) }),
    _recentBars: async (s) => {
      if (s === "NIFTY 50") {
        const d = full.stocks.map((x) => x.days[121][1]);
        const bars = d[0].map((b, i) => ({ t: b.t, o: d.reduce((a, x) => a + x[i].o, 0) / d.length, h: d.reduce((a, x) => a + x[i].h, 0) / d.length, l: d.reduce((a, x) => a + x[i].l, 0) / d.length, c: d.reduce((a, x) => a + x[i].c, 0) / d.length, v: 1 }));
        return { today: bars.filter((b) => b.t <= clock.ms), prior: [] };
      }
      const days = full.stocks.find((x) => x.symbol === s).days;
      return { today: days[121][1].filter((b) => b.t <= clock.ms), prior: days[120][1] };
    },
    _call: async (fn) => fn(kite),
    flowSnapshot: () => null,
    context: async () => ({ available: true, tide: { label: "Rising", summary: "Rising tide (+8): Nifty +0.50% on the day." }, nifty: { changePct: 0.5 }, vix: { last: 13.1, changePct: -6 }, breadth: { up: 8, down: 1, total: 10 }, sectors: [{ name: "IT", changePct: 1.2 }], items: [{ id: "gift", available: true, changePct: 0.9 }] }),
    optionChain: async (s) => {
      asked.chain += 1;
      return { available: true, spot: lastOf(s), pcr: 1.2, maxPain: Math.round(lastOf(s)), resistance: { strike: Math.round(lastOf(s) * 1.03) }, support: { strike: Math.round(lastOf(s) * 0.97) }, bias: { score: 30, label: "Bullish" } };
    },
    global: { quotes: async () => ({ available: true, markets: [{ id: "spx", name: "S&P 500", changePct: 0.9, available: true }, { id: "n225", name: "Nikkei 225", changePct: 1.0, available: true }] }) },
  };
  const horizon = new Horizon({ market, docs, history: () => history, universe: () => stocks.map((s) => s.symbol), now: () => clock.ms, log: quiet });
  const ahead = new Ahead({ horizon, docs, now: () => clock.ms, log: quiet });
  const ai = { calls: [], answer: { lean: "up", confidence: "medium", why: "Buyers hold 71% of the 5 nearest prices and the tide is rising.", watch: "A hold above VWAP.", invalid: 0, risk: "The market turning." } };
  const holding = { list: [] };
  const evidence = new Evidence({
    horizon,
    market,
    docs,
    ahead,
    ask: async (req) => {
      ai.calls.push(req);
      return { data: ai.answer, by: ["Test model"] };
    },
    holding: () => holding.list,
    now: () => clock.ms,
    log: quiet,
  });
  return { all, full, stocks, history, docs, clock, dayOf, horizon, ahead, evidence, asked, ai, holding, market };
}
const idle = async (ev) => {
  for (let i = 0; i < 200 && ev._aiBusy.size; i += 1) await new Promise((r) => setTimeout(r, 5));
};

test("the service measures the techniques on the stored history, makes the call, reads the live market, keeps and checks everything, and learns the next day", async () => {
  // planted: a move carries on (each 5-minute return follows the one before it)
  const w = await setup({ phi: 0.35, seed: 11 });
  const { horizon, evidence: ev, clock, docs } = w;

  // before anything is learned it says so, and waits for the forecaster
  assert.equal((await ev.view("T00")).available, false);
  assert.deepEqual({ train: ev.pending().train, learn: ev.pending().learn }, { train: false, learn: false });
  await assert.rejects(() => ev.train({ trigger: "test" }), /forecaster, which is not ready/);
  await horizon.train({ trigger: "test" });
  assert.equal(ev.pending().train, true, "the forecaster is ready: the first training is due");

  // the forecaster is ready but the evidence desk has not learned: the live readings are there, the call is not
  horizon._last.clear(); // (the forecaster keeps its last answer for 15 seconds)
  ev._cache.clear();
  const before = await ev.view("T00");
  assert.equal(before.available, true, before.reason);
  assert.equal(before.trained, false);
  assert.deepEqual(before.calls, []);
  assert.match(before.reason, /has not learned yet/);
  assert.ok(before.live.length >= 8 && before.indicators.vwap > 0);
  assert.equal(docs.items(CALLS).length, 0, "a board without a call keeps nothing");

  const out = await ev.train({ trigger: "test" });
  assert.ok(out.rows > 60000, `${out.rows} bars`);
  assert.equal(ev.pending().train, false);
  const m = ev.model();
  assert.deepEqual([m.version, m.forecaster], [E.MODEL_VERSION, H.MODEL_VERSION]);
  for (const h of E.HZ) {
    const s = out.validation.shown[h];
    assert.ok(s.n > 5000 && typeof s.on === "boolean" && Number.isFinite(s.adds), JSON.stringify(s));
    assert.ok(m.hz[h].base[0] > 0.2 && m.hz[h].base[0] < 0.5 && m.hz[h].base[1] > 0.2 && m.hz[h].base[1] < 0.5, "the usual rates of a rise and of a fall are real shares");
    // a lean was right more often than a coin on rows that chose nothing (the planted carry-on is found)
    assert.ok(s.all.n > 1000 && s.all.right > 0.53, `${h}: ${JSON.stringify(s.all)}`);
  }
  // the record of each technique on the whole history: the planted carry-on makes "three pushes in a row" work…
  const board = ev.board();
  assert.equal(board.techniques.length, E.W);
  const three = board.techniques.find((t) => t.id === "threeBar");
  assert.equal(three.record[5].verdict, "works", JSON.stringify(three.record));
  assert.ok(three.record[5].n > 3000 && three.record[5].right > 0.52);
  // …and the fades of a move work the OTHER way here: the desk says so instead of repeating the textbook
  const rsi2 = board.techniques.find((t) => t.id === "rsi2");
  assert.equal(rsi2.record[5].verdict, "backwards", JSON.stringify(rsi2.record));
  assert.equal(board.live.length, E.LIVE.length);
  assert.ok(board.live.every((x) => x.record[15].verdict === "thin"), "no live reading has a record yet");

  // the board for a stock now
  ev._cache.clear();
  const v = await ev.view("T00");
  assert.equal(v.available, true, v.reason);
  assert.deepEqual(v.calls.map((c) => c.key), ["5", "15"]);
  for (const c of v.calls) {
    assert.ok(c.pUp > 0 && c.pUp < 1 && c.pDown > 0 && c.pDown < 1 && c.usualUp > 0.2 && c.usualDown > 0.2);
    assert.ok(["up", "down", "none"].includes(c.lean) && ["strong", "clear", "slight", "none"].includes(c.tier));
    assert.equal(c.uses, out.validation.shown[c.minutes / 5].on ? "techniques" : "forecaster", "the techniques are in the call only where they beat the forecaster alone");
    assert.ok(Date.parse(c.at) > clock.ms && c.read.length > 30 && Number.isFinite(c.forecaster.pUp));
    assert.deepEqual(c.live, [], "no live reading has earned a say yet");
  }
  // every technique speaking has its sentence and its record beside it
  for (const x of v.witnesses) assert.ok(x.text.length > 10 && [1, -1].includes(x.state) && x.record[15].n >= 0 && x.what.length > 40, JSON.stringify(x));
  assert.equal(v.count.up + v.count.down, v.witnesses.length + v.live.filter((r) => r.state).length);
  // what is only known live was read from the market: the book price by price on both exchanges, the market, the world
  const lv = Object.fromEntries(v.live.map((r) => [r.id, r]));
  assert.deepEqual([lv.book5.state, lv.bookAll.state, lv.wall, lv.tide.state, lv.breadth.state, lv.vix.state, lv.gift.state, lv.optBias.state, lv.asia.state], [1, 1, undefined, 1, 1, 1, 1, 1, 1]);
  assert.equal(lv.us.state, 0, "at 11:03 Wall Street is in the price");
  assert.equal(lv.sensex.state, 0);
  assert.equal(lv.bseBook.state, 1);
  assert.equal(v.book.nse.bids.length, 5);
  assert.deepEqual(Object.keys(v.book.nse.bids[0]), ["price", "qty", "orders"]);
  assert.ok(v.book.nse.bidQty === 3100 && v.book.nse.askQty === 1300 && v.book.nse.buyTotal === 60000);
  assert.ok(v.book.bse && v.book.bse.asks.length === 5 && v.book.bse.volume === 50000);
  assert.ok(v.indicators.rsi14 > 0 && v.indicators.vwap > 0 && v.indicators.bollinger && v.levels.length >= 6);
  assert.deepEqual(v.sources.filter((s) => !s.ok).map((s) => s.name), ["Futures open interest, minute by minute"], "it says what it could not read");
  assert.match(v.rule, /No call is certain/);

  // the call was kept once for the bar, with the live readings that were leaning
  assert.equal(docs.items(CALLS).length, 1);
  ev._cache.clear();
  await ev.view("T00");
  assert.equal(docs.items(CALLS).length, 1);
  const kept = docs.items(CALLS)[0];
  assert.ok(kept.symbol === "T00" && kept.c[1].length === 5 && kept.c[3].length === 5 && kept.settled === false);
  assert.deepEqual([kept.lw.book5, kept.lw.tide, kept.lw.us], [1, 1, undefined], "a reading with no lean is not kept");

  // a sweep keeps the call of every stock followed, with one shared request for their order books
  const n0 = w.asked.quotes.length;
  assert.equal(await ev.sweep(), 2);
  assert.equal(docs.items(CALLS).length, 2);
  assert.deepEqual(w.asked.quotes.slice(n0), [["NSE:T00", "NSE:T01"]]);
  assert.equal(await ev.score(), 0, "their 15 minutes are not over");

  // later: every kept call is checked, and so is every live reading that leaned
  clock.ms += 40 * 60000;
  assert.equal(await ev.score(), 2);
  const rec = docs.items(CALLS).find((r) => r.symbol === "T00");
  assert.ok(rec.settled && Number.isFinite(rec.actual[1]) && Number.isFinite(rec.actual[3]));
  const live = docs.read(LIVE);
  assert.equal(live.n, 2);
  const open = live.ledgerDays[w.all[121]];
  assert.deepEqual([open.book5[0][0], open.book5[1][0], open.tide[1][0]], [2, 2, 2], "each live reading has two checks at 5 and at 15 minutes, held as today's session");
  assert.deepEqual(live.ledger, {}, "a session is folded into the ledger when it is over, as one session");
  const after = ev.board();
  assert.equal(after.checked, 2);
  assert.equal(after.live.find((x) => x.id === "book5").record[15].n, 2);
  assert.equal(after.live.find((x) => x.id === "book5").record[15].verdict, "thin", "two checks prove nothing: it does not move the call");

  // a live reading with a proven record moves the call, by a small bounded amount
  // 400 checks on 20 sessions; the price went its way by 0.3 of a usual move on average, on every session
  ev._liveDoc.ledger.tide = [[400, 250, 100, 500, 2000, 8000, 20], [400, 260, 120, 720, 2400, 8000, 20]];
  ev._ledNow = null;
  ev._cache.clear();
  const tilted = await ev.view("T00");
  const c15 = tilted.calls.find((c) => c.key === "15");
  assert.deepEqual(c15.live.map((x) => x.id), ["tide"]);
  assert.ok(c15.live[0].points > 0.02 && c15.live[0].points <= 0.06, `${c15.live[0].points}`);
  delete ev._liveDoc.ledger.tide;
  ev._ledNow = null;

  // for the positions: the next 15 minutes, and whether it is with the position or against it
  ev._cache.clear();
  const pos = await ev.forPositions([{ symbol: "T00", side: "long" }, { symbol: "T00", side: "short" }, { symbol: "nope!", side: "long" }]);
  assert.equal(pos.length, 2);
  assert.ok(pos[0].available && pos[1].available);
  if (pos[0].lean === "none") assert.ok(!pos[0].against && !pos[1].against && /No clear lean/.test(pos[0].text));
  else {
    assert.equal(pos[0].against, pos[0].lean === "down");
    assert.equal(pos[1].against, pos[1].lean === "up", "the same lean is against the opposite position");
    assert.match(pos[0].against ? pos[0].text : pos[1].text, /AGAINST your/);
  }

  // in brief, for an AI and for TradeAI: the ladder, the readings, the levels — and the owner's position only when asked for
  const brief = await ev.brief("T00");
  assert.deepEqual(brief.orderBookNSE.columns, ["price", "shares", "orders"]);
  assert.ok(brief.orderBookNSE.bids.length === 5 && brief.orderBookBSE.offers.length === 5 && brief.deskCall.length === 2 && brief.liveReadings.length >= 8 && brief.levels.length >= 6);
  assert.ok(Array.isArray(brief.earlyCalls) || brief.earlyCalls === null);
  assert.equal("openPosition" in brief, false);
  w.holding.list = [{ symbol: "T00", side: "long", quantity: 10, average: 100 }];
  assert.equal((await ev.brief("T00", { withPosition: true })).openPosition.quantity, 10);
  assert.equal((await ev.brief("T01", { withPosition: true })).openPosition, "none in this stock");
  w.holding.list = [];

  // the evening: a new stored session is called with the model as it stood, checked, then learned
  assert.equal(ev.pending().learn, false, "nothing new is stored");
  for (const s of w.stocks) w.history.append(s.symbol, w.all[120], w.dayOf(s.symbol, 120)[1]);
  assert.equal(ev.pending().learn, false, "the forecaster learns the day first");
  await horizon.learnDays({ trigger: "test" });
  assert.equal(ev.pending().learn, true);
  const rowsBefore = ev.model().hz[3].rows;
  const nBefore = ev.board().techniques.find((t) => t.id === "threeBar").record[5].n;
  assert.deepEqual(await ev.learnDays({ trigger: "test" }), { days: 1, last: w.all[120] });
  assert.ok(ev.model().hz[3].rows > rowsBefore + 1000 && ev.model().learned.days === 1);
  assert.equal((await ev.learnDays({ trigger: "test" })).days, 0, "nothing new: nothing to learn");
  const b2 = ev.board();
  assert.equal(b2.days.length, 1);
  assert.ok(b2.days[0].rows > 1000 && b2.days[0].call15.n > 1000, JSON.stringify(b2.days[0]));
  assert.equal(docs.items(DAYS).length, 1);
  assert.ok(b2.techniques.find((t) => t.id === "threeBar").record[5].n > nBefore, "each technique's record grew by the day");

  // a model made for other inputs is not used: it is trained again by itself
  docs.write("market/evidence-model.json", { ...ev.model(), forecaster: H.MODEL_VERSION + 1 });
  const fresh = new Evidence({ horizon, market: w.market, docs, now: () => clock.ms, log: quiet });
  assert.equal((await fresh.view("T00")).trained, false);
  assert.equal(fresh.pending().train, true);
});

test("honest: in a market with nothing to find, the techniques earn no place and no lean is proven", async () => {
  const w = await setup({ phi: 0, seed: 23 });
  await w.horizon.train({ trigger: "test" });
  const out = await w.evidence.train({ trigger: "test" });
  for (const h of E.HZ) {
    const s = out.validation.shown[h];
    assert.equal(s.on, false, `nothing was planted, yet the techniques claim to add ${s.adds} at ${h * 5} minutes`);
    assert.equal(s.all.proven, false, JSON.stringify(s.all));
    for (const t of E.TIERS) assert.equal(s.tiers[t].proven, false);
  }
  const v = await w.evidence.view("T00");
  assert.equal(v.available, true, v.reason);
  for (const c of v.calls) {
    assert.equal(c.uses, "forecaster");
    assert.equal(c.proven, false);
    assert.deepEqual(c.why, [], "techniques that are not in the call push nothing");
  }
  // a technique may look good by luck among 35 × 2 tries; no more than a couple may, and none strongly
  const lucky = w.evidence.board().techniques.flatMap((t) => [t.record[5], t.record[15]]).filter((r) => r.verdict === "works" || r.verdict === "backwards");
  assert.ok(lucky.length <= 3, `${lucky.length} techniques claim an edge in noise: ${JSON.stringify(lucky)}`);
  for (const r of lucky) assert.ok(Math.abs(r.right - 0.5) < 0.04, JSON.stringify(r));
});

test("the AI is asked about an opened stock only when needed, within its limits, and its reads are checked", async () => {
  const w = await setup({ phi: 0.35, seed: 11 });
  const { evidence: ev, clock, ai } = w;
  await w.horizon.train({ trigger: "test" });
  await ev.train({ trigger: "test" });
  assert.deepEqual(ev.aiSettings(), { mode: "need", perDay: 40, gapMin: 15, everyone: false });

  // the need test, on boards as the page would show them
  const boardOf = (lean, proven, up, down, vol = 1) => ({ available: true, calls: [{ key: "15", lean, proven }], count: { up, down }, indicators: { volumeTimesUsual: vol } });
  assert.deepEqual(await ev._aiNeed("T05", boardOf("up", true, 5, 1)), { need: false, why: "the readings agree and the call is clear: no AI was needed" });
  assert.match((await ev._aiNeed("T05", boardOf("none", false, 2, 2))).why, /no clear lean while several readings are speaking/);
  assert.equal((await ev._aiNeed("T05", boardOf("none", false, 1, 0))).need, false, "nothing is speaking: there is nothing to weigh");
  assert.match((await ev._aiNeed("T05", boardOf("up", false, 4, 0))).why, /not yet a proven one/);
  assert.match((await ev._aiNeed("T05", boardOf("up", true, 4, 3))).why, /the readings disagree \(4 lean up, 3 lean down\)/);
  assert.match((await ev._aiNeed("T05", boardOf("up", true, 5, 0, 3.2))).why, /3\.2× its usual volume/);
  w.holding.list = [{ symbol: "T05", side: "long" }];
  assert.match((await ev._aiNeed("T05", boardOf("up", true, 5, 0), true)).why, /you hold a position in it/);
  assert.equal((await ev._aiNeed("T05", boardOf("up", true, 5, 0), false)).need, false, "the owner's positions are read for the owner only");
  w.holding.list = [];
  assert.equal((await ev._aiNeed("T05", { available: false, reason: "The market is shut." })).need, false);

  // someone else opening a stock spends nothing; nor does the owner while the switch is off
  assert.deepEqual(await ev.opened("T00", { isOwner: false }), { asked: false, why: "The AI read on opening a stock runs for the owner only." });
  ev.setAi({ mode: "off" }, "owner@example.com");
  assert.match((await ev.opened("T00", { isOwner: true })).why, /switched off/);
  assert.equal(ai.calls.length, 0);

  // set to read every opened stock: one read, shown on the board, counted against the day
  ev.setAi({ mode: "always", perDay: 2, gapMin: 15 }, "owner@example.com");
  const first = await ev.opened("T00", { isOwner: true });
  assert.equal(first.asked, true, first.why);
  await idle(ev);
  assert.equal(ai.calls.length, 1);
  const req = ai.calls[0];
  assert.match(req.system, /Use only the board/);
  assert.match(req.user, /The evidence board for T00 now \(11:03 IST\)/);
  const sent = JSON.parse(req.user.split("\n")[1]);
  assert.ok(sent.orderBookNSE.bids.length === 5 && sent.deskCall.length === 2 && sent.indicators.vwap > 0 && sent.liveReadings.length >= 8, "the AI is given the whole board");
  assert.equal(sent.openPosition, "none in this stock");
  const shown = (await ev.view("T00")).ai;
  assert.ok(shown.read && shown.read.lean === "up" && shown.read.confidence === "medium" && shown.read.by === "Test model" && shown.read.invalid === null && shown.usedToday === 1);
  // the same stock again within the gap: nothing is spent
  assert.match((await ev.opened("T00", { isOwner: true })).why, /read this stock \d+ minutes? ago|is already reading/);
  // another stock uses the day's second read; a third is refused by the daily limit
  assert.equal((await ev.opened("T01", { isOwner: true })).asked, true);
  await idle(ev);
  assert.deepEqual(await ev.opened("T02", { isOwner: true }), { asked: false, why: "Today's limit of 2 automatic AI reads is used up." });
  assert.equal(ai.calls.length, 2);
  // "Ask the AI" is a click: it is answered whatever the automatic limit says, and does not count against it
  ai.answer = { ...ai.answer, lean: "down", invalid: 1 };
  const asked = await ev.askNow("T02", { isOwner: true });
  assert.ok(asked.read.lean === "down" && asked.read.trigger === "you asked" && asked.usedToday === 2);
  assert.equal(asked.read.invalid, null, "a price that is not on the board is not shown as a level");

  // 40 minutes on, the reads are checked against the price like everything else
  clock.ms += 40 * 60000;
  await ev.score();
  const st = ev.aiStatus();
  assert.equal(st.record.n, 3);
  assert.ok(st.record.ok >= 0 && st.record.ok <= 3 && st.recent.length === 3 && st.recent.every((r) => r.settled && typeof r.ok === "boolean"));
  // outside market hours nothing is asked
  clock.ms = openMs(w.all[121]) + 7 * 3600000;
  assert.match((await ev.opened("T03", { isOwner: true })).why, /only while the market is open/);
  // with no model set up, nothing is asked and nothing is counted
  const none = new Evidence({ horizon: w.horizon, market: w.market, docs: mkdocs(), now: () => clock.ms, log: quiet });
  assert.deepEqual(await none.opened("T00", { isOwner: true }), { asked: false, why: "No AI model is set up." });
  assert.throws(() => none.askNow("T00"), /No AI model is set up/);
});

test("AI credit: an opened stock may reach the AI only while its switch is on; a timer never can", () => {
  const g = new SpendGuard({ enforce: true });
  let on = true;
  g.openAllowed = () => on;
  g.run({ click: false, opened: true, route: "POST /api/admin/market/evidence/TCS/open" }, () => {
    assert.deepEqual(g.allowed(), { ok: true, why: "a stock was opened, and the owner allowed one AI read of it" });
    g.check("an AI read of TCS");
  });
  on = false;
  g.run({ click: false, opened: true }, () => {
    assert.equal(g.allowed().ok, false);
    assert.throws(() => g.check("an AI read of TCS"), /runs only when you press an AI button/);
  });
  on = true;
  // a timer, a page being read, a stranger: none of them is an opened stock
  g.run({ click: false, route: "timer" }, () => assert.equal(g.allowed().ok, false));
  assert.equal(g.allowed().ok, false, "no context at all");
  assert.equal(g.status().blockedToday, 1);
  // a click is still a click
  g.run({ click: true }, () => assert.equal(g.allowed().why, "a click"));
});

test("the evidence desk's records are part of the database's list (so they are backed up and restored)", () => {
  assert.ok(COLLECTIONS.includes(CALLS) && COLLECTIONS.includes(DAYS));
});
