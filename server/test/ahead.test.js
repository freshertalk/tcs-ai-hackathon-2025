"use strict";
// The early calls (reversal, carry-on, momentum — 5 and 15 minutes ahead): the arithmetic says what it should and is
// honest about what it has not proven; the service learns through the forecaster, keeps every call, checks it, and
// learns the next day.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const H = require("../market/horizon");
const A = require("../market/ahead");
const { Horizon } = require("../horizon");
const { Ahead, CALLS, DAYS } = require("../ahead");
const { FileDocs, COLLECTIONS } = require("../docs");

const IST = 5.5 * 3600 * 1000;
const quiet = { log() {}, error() {} };
const mkdocs = () => new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-ahead-")));

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

/**
 * Sessions with what is planted: `phi` — each 5-minute return follows the one before it (a move carries on);
 * `volOf(i)` — how wide the bars are at each time of day (1 everywhere = no pattern in the size of moves).
 */
function world(dates, nStocks, { phi = 0, seed = 7, volOf = () => 1 } = {}) {
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
        const r = phi * prev + volOf(i) * (beta * mkt.get(d)[i] + 0.0011 * R.n());
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
/** A row as the forecaster gives it, with only what the early calls read. */
const row = (s, price, set = {}) => {
  const x = new Float64Array(H.D);
  x[0] = 1;
  for (const [k, v] of Object.entries(set)) x[H.FEATURES.indexOf(k)] = v;
  return { s, t: openMs("2026-03-02") + s * 300000, price, sigma: 0.002, x };
};

/* ------------------------------------------------------------------------------------------------ the arithmetic */

test("a bar is read facing the move: its direction, whether a move is on, and what counts as turned, carried on, large and quiet", () => {
  // a usual 5-minute move is 0.2% (sigma); a move is ON when the last 15 minutes covered 0.8 × √3 of it
  const rows = [
    row(10, 100.0, { r1: 0.9, r3: 2.4, vwap: 1.5, dHigh: 0.2, dLow: 3 }),
    row(11, 100.3, { r1: 1.5, r3: 3.0, vwap: 1.8, dHigh: 0.1, dLow: 3 }), // +0.30% in 5 minutes = 1.5 usual moves: large, carried on
    row(12, 100.3, { r1: 0, r3: 2.4 }),
    row(13, 99.9, { r1: -2, r3: 0.2 }),
    row(14, 99.85, { r1: -0.25, r3: -1.5 }),
    row(15, 99.85, { r1: 0, r3: -0.9 }),
    row(16, 99.85, { r1: 0, r3: -0.1 }),
  ];
  const out = A.aheadRows(rows);
  // the first three rows have the next 20 minutes in the session; the rest do not, and are left out
  assert.deepEqual(out.map((r) => r.s), [10, 11, 12]);
  const a = out[0];
  assert.equal(a.d, 1, "the last 15 minutes rose");
  assert.equal(a.run, true, "2.4 usual moves in 15 minutes is a move");
  // 5 minutes on: +0.30% = +1.5 usual moves → carried on, large, not quiet, did not turn
  assert.deepEqual([...a.y.run.slice(0, 2)], [0, 1]);
  assert.deepEqual([...a.y.all.slice(0, 2)], [1, 0]);
  // 15 minutes on (99.9): −0.10% = −0.5 of a usual move ÷ √3 = −0.29 → neither turned nor carried on; quiet
  assert.deepEqual([...a.y.run.slice(4, 6)], [0, 0]);
  assert.deepEqual([...a.y.all.slice(4, 6)], [0, 1]);
  // from 100.3 (row 11): 99.9 two bars on is −0.40% = −2 ÷ √2 = −1.41 usual moves → it turned, and it was large
  const b = out[1];
  assert.deepEqual([...b.y.run.slice(2, 4)], [1, 0]);
  assert.deepEqual([...b.y.all.slice(2, 4)], [1, 0]);
  // the inputs face the move: stretched above VWAP in an up-move is +; the room ahead is the room to the day's HIGH
  assert.equal(a.z[A.IX.a_vwap], 1.5);
  assert.equal(a.z[A.IX.roomAhead], 0.2);
  assert.equal(a.z[A.IX.roomBehind], 3);
  assert.ok(Math.abs(a.z[A.IX.nearX] - 0.8) < 1e-9, "the day's high is just ahead");
  assert.equal(out[1].streak, 2, "two bars in a row closed the move's way");
  // the same bar in a down-move reads the same, mirrored
  const down = A.aheadRows([row(20, 100, { r1: -0.9, r3: -2.4, vwap: -1.5, dHigh: 3, dLow: 0.2 }), row(21, 99.7, {}), row(22, 99.7, {}), row(23, 99.7, {}), row(24, 99.7, {})])[0];
  assert.equal(down.d, -1);
  assert.equal(down.z[A.IX.a_vwap], 1.5);
  assert.equal(down.z[A.IX.roomAhead], 0.2);
  assert.deepEqual([...down.y.run.slice(0, 2)], [0, 1], "falling further is carrying on");
  // no move on: nothing about turning or carrying on is asked
  const still = A.aheadRows([row(30, 100, { r1: 0.1, r3: 0.3 }), row(31, 100, {}), row(32, 100, {}), row(33, 100, {}), row(34, 100, {})])[0];
  assert.equal(still.run, false);
  assert.equal(still.y.run, null);
  // for the live call nothing is known of what follows: every bar is read, the last one included
  assert.equal(A.aheadRows(rows, { labels: false }).length, rows.length);
  // a gap in the session (a missing bar) is not bridged
  assert.equal(A.aheadRows([row(40, 100, {}), row(41, 100, {}), row(43, 100, {}), row(44, 100, {}), row(45, 100, {}), row(46, 100, {})]).length, 0);
});

test("the sums add; the calibration is the measured frequency, never falls as the score rises, and says nothing on too little", () => {
  const R = rng(3);
  const mk = () => {
    const z = new Float64Array(A.D);
    z[0] = 1;
    for (let i = 1; i < A.D; i += 1) z[i] = R.n();
    return z;
  };
  const whole = new A.Sums(2);
  const half1 = new A.Sums(2);
  const half2 = new A.Sums(2);
  // outcome 0 is likelier when input 3 is high; outcome 1 is a coin
  const draw = () => {
    const z = mk();
    return { z, y: Uint8Array.from([R.u() < 0.3 + 0.12 * Math.max(-2, Math.min(2, z[3])) ? 1 : 0, R.u() < 0.4 ? 1 : 0]) };
  };
  for (let i = 0; i < 4000; i += 1) {
    const { z, y } = draw();
    whole.add(z, y, 1);
    (i % 2 ? half1 : half2).add(z, y, 1);
  }
  // rows the weights never saw: one lot sets the calibration, another gives the evidence
  const items = Array.from({ length: 4000 }, draw);
  const unseen = Array.from({ length: 4000 }, draw);
  const W = A.fit(whole, A.LAMBDA, 100);
  const W2 = A.fit(half1.merge(half2), A.LAMBDA, 100);
  assert.ok(W && W2 && W.every((w, k) => w.every((v, a) => Math.abs(v - W2[k][a]) < 1e-6)), "two halves added give the same weights");
  assert.ok(Math.abs(whole.base()[1] - 0.4) < 0.03, "the usual rate is the share that happened");
  assert.ok(W[0][3] > 0.08, `the planted input was found (${W[0][3]})`);
  assert.equal(A.fit(whole), null, "too few rows: no model");

  const cal = A.calAdd(A.emptyCal(2), W, items, (it) => it.y);
  const base = whole.base();
  assert.equal(A.calCurve(cal.n[0].map((v) => v / 10), cal.hit[0].map((v) => v / 10), base[0]), null, "too little counted: no curve");
  const curve = A.calCurve(cal.n[0], cal.hit[0], base[0]);
  assert.ok(curve && curve.length === A.NB);
  for (let b = 1; b < A.NB; b += 1) assert.ok(curve[b] >= curve[b - 1] - 1e-12, "the curve never falls");
  assert.ok(curve[A.NB - 1] > curve[0] + 0.2, "a high score happened far more often than a low one");
  // a score of 0.5 is shown as what really followed such scores
  let n = 0;
  let hit = 0;
  for (const it of items) {
    const raw = A.rawOf(W[0], it.z);
    if (raw >= 0.48 && raw < 0.52) {
      n += 1;
      hit += it.y[0];
    }
  }
  assert.ok(n > 30 && Math.abs(A.probOf(0.5, curve, base[0]) - hit / n) < 0.12, `shown ${A.probOf(0.5, curve, base[0])}, happened ${hit / n}`);
  // without a curve the score itself is shown, kept modest
  assert.ok(A.probOf(5, null, 0.3) <= 0.9 && A.probOf(-5, null, 0.3) >= 0.03);

  // what a probability is called
  assert.equal(A.tierOf(0.55, 0.3), "likely");
  assert.equal(A.tierOf(0.4, 0.3), "raised");
  assert.equal(A.tierOf(0.33, 0.3), "usual");
  assert.equal(A.tierOf(0.2, 0.3), "low");
  assert.equal(A.tierOf(0.12, 0.1), "usual", "two points over a 10% rate is not a call");

  // the evidence: the coin (outcome 1) is not proven however many rows there are; "proven" needs a real edge
  const curves = W.map((_, k) => A.calCurve(cal.n[k], cal.hit[k], base[k]));
  const ev = A.evAdd(A.emptyEv(2), { W, base, curves }, unseen, (it) => it.y);
  // "proven" needs many unseen rows AND a smaller miss than the usual rate: the planted outcome earns it, the coin never does
  const many = { ...ev, n: ev.n.map((v) => v * 4), se: ev.se.map((v) => v * 4), se0: ev.se0.map((v) => v * 4) };
  assert.equal(A.provenOf(ev, 0), false, "4,000 rows are too few to call anything proven");
  assert.equal(A.provenOf(many, 0), true);
  assert.equal(A.provenOf(many, 1), false);
  assert.ok(ev.saidN[0] > 100 && ev.saidY[0] / ev.saidN[0] > base[0] + 0.1, "after a warning it happened clearly more often than usual");
  assert.ok(1 - ev.se[0] / ev.se0[0] > 0.02, "the planted outcome is forecast better than its usual rate");
  assert.ok(Math.abs(1 - ev.se[1] / ev.se0[1]) < 0.02, "the coin is not");
});

test("why: the inputs that pushed a call, in words, facing the move", () => {
  const w = new Array(A.D).fill(0);
  w[A.IX.a_vwap] = 0.05;
  w[A.IX.decel] = 0.04;
  w[A.IX.vol] = -0.03;
  const z = new Float64Array(A.D);
  z[A.IX.a_vwap] = 2;
  z[A.IX.decel] = -1.5;
  z[A.IX.vol] = 1;
  const why = A.whyOf(w, z);
  assert.deepEqual(why.map((x) => [x.key, x.side]), [["a_vwap", "for"], ["decel", "against"], ["vol", "against"]]);
  assert.equal(why[0].text, "the price is stretched from VWAP the move's way");
  assert.equal(why[1].text, "the move is slowing");
});

test("a kept call is settled from the session's bars: 5 and 15 minutes on, in usual moves for that time", () => {
  const t0 = openMs("2026-03-02");
  const bars = [100, 100.2, 100.5, 100.4, 100.0, 99.8].map((c, i) => ({ t: t0 + i * 300000, o: c, h: c + 0.1, l: c - 0.1, c, v: 1 }));
  // made at the close of the first bar (100), in an up-move
  const got = A.settle({ anchorEnd: t0 + 300000, price: 100, sigma: 0.002, d: 1 }, bars);
  assert.equal(got[1].price, 100.2);
  assert.deepEqual({ turn: got[1].turn, go: got[1].go, big: got[1].big, calm: got[1].calm }, { turn: false, go: true, big: true, calm: false });
  assert.equal(got[3].price, 100.4);
  assert.ok(got[3].go && got[3].big, "+0.4% in 15 minutes is 1.15 usual moves");
  assert.equal(got[4].price, 100.0);
  assert.ok(got[4].calm && !got[4].turn);
  // the same prices after a DOWN-move: the rise is a turn
  assert.equal(A.settle({ anchorEnd: t0 + 300000, price: 100, sigma: 0.002, d: -1 }, bars)[1].turn, true);
  // a bar the session does not hold is not settled
  assert.equal(A.settle({ anchorEnd: t0 + 5 * 300000, price: 100, sigma: 0.002, d: 1 }, bars)[3], undefined);
});

/* ------------------------------------------------------------------------------------------------ the service */

/** A forecaster trained on a made-up market, and the early calls beside it, with a session "today" after the history. */
async function setup(opts) {
  const all = weekdays("2026-01-05", 124);
  const dates = all.slice(0, 120);
  const full = world(all, 24, opts);
  const stocks = full.stocks.map((s) => ({ symbol: s.symbol, days: s.days.slice(0, 120) }));
  const history = fakeHistory(stocks);
  const docs = mkdocs();
  const clock = { ms: openMs(all[121]) + (11 * 60 + 3 - (9 * 60 + 15)) * 60000 + 10000 }; // 11:03:10 on a session after the history
  const dayOf = (s, i) => full.stocks.find((x) => x.symbol === s).days[i];
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
  };
  const horizon = new Horizon({ market, docs, history: () => history, universe: () => stocks.map((s) => s.symbol), now: () => clock.ms, log: quiet });
  const ahead = new Ahead({ horizon, docs, now: () => clock.ms, log: quiet });
  return { all, dates, full, stocks, history, docs, clock, dayOf, horizon, ahead };
}

test("the service learns through the forecaster, calls 5 and 15 minutes ahead, keeps and checks every call, and learns the next day", async () => {
  // planted: a move carries on (each bar follows the last), and the opening hour's bars are twice as wide as midday's
  const w = await setup({ phi: 0.35, seed: 11, volOf: (i) => (i < 12 ? 1.9 : i >= 33 && i < 51 ? 0.6 : 1) });
  const { horizon, ahead, clock, docs } = w;

  // before anything is learned it says so, and waits for the forecaster
  assert.equal((await ahead.view("T00")).available, false);
  assert.deepEqual({ train: ahead.pending().train, learn: ahead.pending().learn }, { train: false, learn: false }, "the forecaster is not ready: nothing is due here");
  await assert.rejects(() => ahead.train({ trigger: "test" }), /forecaster, which is not ready/);
  await horizon.train({ trigger: "test" });
  assert.equal(ahead.pending().train, true, "the forecaster is ready: the first training is due");

  const out = await ahead.train({ trigger: "test" });
  assert.ok(out.rows > 60000, `${out.rows} bars`);
  assert.equal(ahead.pending().train, false);
  const m = ahead.model();
  assert.equal(m.forecaster, H.MODEL_VERSION);
  assert.ok(m.sets.run.rows > 15000 && m.sets.run.rows < m.sets.all.rows, "a move is on in part of the bars only");
  const T = (name) => out.validation.targets.find((t) => t.target === name);
  // measured on rows that chose nothing: the planted carry-on and the planted wide/quiet hours are found…
  assert.ok(T("go1").proven && T("go1").skill > 0.01, `carry-on, 5 min: ${JSON.stringify(T("go1"))}`);
  assert.ok(T("go1").saidRate > T("go1").usual + 0.05, "after a carry-on call the move carried on clearly more often than usual");
  assert.ok(T("turn1").proven && T("turn1").lowRate < T("turn1").usual - 0.04, `where a turn was called unlikely it came less often: ${JSON.stringify(T("turn1"))}`);
  assert.ok(T("big3").proven && T("big3").saidRate > T("big3").usual + 0.05, `a called large move: ${JSON.stringify(T("big3"))}`);
  assert.ok(T("calm3").proven && T("calm3").saidRate > T("calm3").usual + 0.05, `a called quiet stretch: ${JSON.stringify(T("calm3"))}`);
  // …and every usual rate is a real share
  for (const t of out.validation.targets) assert.ok(t.usual > 0.05 && t.usual < 0.7 && t.n > 3000, JSON.stringify(t));

  // the calls for now: one for about 5 minutes, one for at least 15, each beside the forecaster's trend call
  const v = await ahead.view("T00");
  assert.equal(v.available, true, v.reason);
  assert.deepEqual(v.horizons.map((h) => h.key), ["5", "15"]);
  const [h5, h15] = v.horizons;
  assert.ok(h5.minutesAhead >= 2 && h5.minutesAhead <= 8, `${h5.minutesAhead} minutes ahead`);
  assert.ok(h15.minutesAhead >= 15 && h15.minutesAhead <= 20, `${h15.minutesAhead} minutes ahead`);
  assert.ok(["up", "down"].includes(v.move.dir) && typeof v.move.on === "boolean" && Number.isFinite(v.move.pct15));
  for (const h of v.horizons) {
    assert.ok(h.trend && ["UP", "DOWN", "LEANS UP", "LEANS DOWN", "NO CLEAR LEAN"].includes(h.trend.word), "the trend call is the forecaster's");
    assert.ok(["building", "steady", "fading"].includes(h.momentum.state));
    assert.ok(h.momentum.big.p > 0 && h.momentum.big.p < 1 && h.momentum.big.usual > 0);
    assert.equal(Boolean(h.reversal), v.move.on, "a reversal is only spoken of while a move is on");
    if (h.reversal) assert.ok(["likely", "raised", "usual", "low"].includes(h.reversal.tier) && h.reversal.p > 0 && h.follow.p > 0);
    assert.ok(h.read.length > 20 && Array.isArray(h.why.momentum));
  }
  assert.match(v.rule, /A reversal is never certain/);
  assert.equal(v.record.own.calls, 0, "nothing has been checked yet");

  // the call was kept once for the bar, and a second look inside the same bar keeps nothing more
  assert.equal(docs.items(CALLS).length, 1);
  ahead._cache.clear();
  await ahead.view("T00");
  assert.equal(docs.items(CALLS).length, 1);
  const kept = docs.items(CALLS)[0];
  assert.equal(kept.symbol, "T00");
  assert.equal(kept.p.length, 8);
  assert.equal(kept.t.length, 8);
  assert.equal(kept.settled, false);

  // a sweep keeps the calls of every stock followed
  assert.equal(await ahead.sweep(), 2);
  assert.equal(docs.items(CALLS).length, 2);
  assert.equal(await ahead.score(), 0, "their 15 minutes are not over");

  // later: every kept call is checked against what the price did, and each stock's own correction is learned
  clock.ms += 40 * 60000;
  assert.equal(await ahead.score(), 2);
  const rec = docs.items(CALLS).find((r) => r.symbol === "T00");
  assert.equal(rec.settled, true);
  assert.ok(Number.isFinite(rec.actual[1].pct) && Number.isFinite(rec.actual[3].pct) && typeof rec.actual[3].big === "boolean");
  const live = docs.read("market/ahead-live.json");
  assert.equal(live.n, 2);
  assert.ok(live.stocks.T00.big3.n === 1 && Number.isFinite(live.stocks.T00.big3.sp), "the stock's own record of a large move against the call");
  const after = await ahead.view("T00");
  assert.equal(after.record.own.calls, 1);
  assert.equal(after.record.all.calls, 2);
  assert.equal(after.record.last.length, 1);
  assert.ok(after.record.last[0].move15 !== null && Array.isArray(after.record.last[0].c15));
  for (const s of after.record.last[0].c15) assert.equal(s.ok, s.said === "warned" ? s.happened : !s.happened, "a warning is right when it happened; an unlikely is right when it did not");
  assert.match(after.checkRule, /WARNING .* counts as right when the thing happened/);

  // the evening: a new stored session is called with the model as it stood, checked, then learned
  assert.equal(ahead.pending().learn, false, "nothing new is stored");
  for (const s of w.stocks) w.history.append(s.symbol, w.all[120], w.dayOf(s.symbol, 120)[1]);
  assert.equal(ahead.pending().learn, false, "the forecaster learns the day first");
  await horizon.learnDays({ trigger: "test" });
  assert.equal(ahead.pending().learn, true);
  const rowsBefore = ahead.model().sets.all.rows;
  const learned = await ahead.learnDays({ trigger: "test" });
  assert.deepEqual(learned, { days: 1, to: w.all[120] });
  assert.ok(ahead.model().sets.all.rows > rowsBefore + 1000 && ahead.model().learned.days === 1);
  assert.equal((await ahead.learnDays({ trigger: "test" })).days, 0, "nothing new: nothing to learn");
  const board = ahead.board();
  assert.equal(board.days.length, 1);
  assert.ok(board.days[0].big15.n > 1000 && board.days[0].turn15.n > 300, `the day was checked on every stock: ${JSON.stringify(board.days[0].big15)}`);
  assert.equal(docs.items(DAYS).length, 1);
  assert.ok(board.trained && board.learning.targets.length === 8 && board.learning.targets.every((t) => t.h === 1 || t.h === 3));
  assert.ok(board.trend && board.trend[3], "the forecaster's own check of the trend call is beside it");

  // a model made for other inputs is not used: it is trained again by itself
  docs.write("market/ahead-model.json", { ...ahead.model(), forecaster: H.MODEL_VERSION + 1 });
  const fresh = new Ahead({ horizon, docs, now: () => clock.ms, log: quiet });
  assert.equal((await fresh.view("T00")).available, false);
  assert.equal(fresh.pending().train, true);
});

test("honest: in a market with nothing to find, no call is proven and none is made", async () => {
  const w = await setup({ phi: 0, seed: 23 });
  await w.horizon.train({ trigger: "test" });
  const out = await w.ahead.train({ trigger: "test" });
  for (const t of out.validation.targets) assert.equal(t.proven, false, `nothing was planted, yet ${t.target} claims an edge: ${JSON.stringify(t)}`);
  const v = await w.ahead.view("T00");
  assert.equal(v.available, true, v.reason);
  for (const h of v.horizons) {
    assert.equal(h.momentum.state, "steady");
    assert.equal(h.momentum.big.tier, "usual");
    if (h.reversal) assert.equal(h.reversal.tier, "usual");
    assert.match(h.read, /Nothing unusual ahead|nothing says it will turn or carry on/);
  }
});

test("the early calls' records are part of the database's list (so they are backed up and restored)", () => {
  assert.ok(COLLECTIONS.includes(CALLS) && COLLECTIONS.includes(DAYS));
});
