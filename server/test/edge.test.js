"use strict";
// The measured-odds engine, on made-up price series whose truth is known:
// a planted pattern must be found, pure noise must yield nothing proven, and no reading
// may use a bar from its own future.

const test = require("node:test");
const assert = require("node:assert/strict");

const E = require("../market/edge");

/* ------------------------------------------------------------ made-up series */

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => {
  let u = 0;
  let v = 0;
  while (u === 0) u = r();
  while (v === 0) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const day = (i) => new Date(Date.UTC(2015, 0, 1) + i * 86400000).toISOString().slice(0, 10);

/** Bars from each day's open-to-close log return. The gap is part of the move, never a hint about it. */
function barsFrom(rets, r, vol = 0.012) {
  const bars = [];
  let prev = 500;
  for (let i = 0; i < rets.length; i += 1) {
    const o = prev * Math.exp(gauss(r) * vol * 0.3);
    const c = o * Math.exp(rets[i]);
    const h = Math.max(o, c) * (1 + Math.abs(gauss(r)) * vol * 0.5);
    const l = Math.min(o, c) * (1 - Math.abs(gauss(r)) * vol * 0.5);
    bars.push({ t: day(i), o, h, l, c, v: Math.round(1e6 * (0.6 + r() * 0.8)) });
    prev = c;
  }
  return bars;
}

/** Pure noise: tomorrow owes nothing to today. */
function noise(n, seed) {
  const r = rng(seed);
  const rets = [];
  for (let i = 0; i < n; i += 1) rets.push(gauss(r) * 0.012);
  return barsFrom(rets, r);
}

/** A planted pattern: trends that persist for weeks, ending in an uptrend. */
function trends(n, seed, drift = 0.004) {
  const r = rng(seed);
  const rets = [];
  let d = drift;
  let left = 60;
  for (let i = 0; i < n; i += 1) {
    if (i === n - 45) {
      d = drift;
      left = 1000;
    } else if (left <= 0) {
      d = -d;
      left = 40 + Math.floor(r() * 60);
    }
    left -= 1;
    rets.push(d + gauss(r) * 0.01);
  }
  return barsFrom(rets, r);
}

/* ------------------------------------------------------------ the trade rules */

/** Five quiet bars, then whatever the test appends: arrays for outcome(). */
function tape(rows) {
  const all = [[100, 100.5, 99.5, 100], ...rows];
  return { o: all.map((x) => x[0]), h: all.map((x) => x[1]), l: all.map((x) => x[2]), c: all.map((x) => x[3]), n: all.length };
}
const run = (kind, side, rows, atr = 2) => {
  const t = tape(rows);
  return E.outcome(E.KINDS[kind], side, t.o, t.h, t.l, t.c, t.n, 0, atr);
};
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ""} got ${a}, wanted ${b}`);

test("a swing trade: the next open is the entry, 1.5 ATR the stop, 2.25 ATR the target, costs come off", () => {
  // ATR 2 → risk 3, stop 97, target 104.5; cost 0.25% of 100 = 0.25 → 0.0833R
  const cost = 0.25 / 3;
  const quiet = [100, 101, 99, 100];
  const hit = run("swing", "long", [quiet, [100, 105, 99.5, 104]]);
  near(hit.r, 1.5 - cost, "target");
  assert.equal(hit.how, 1);
  assert.equal(hit.exit, 2);

  const stopped = run("swing", "long", [quiet, [100, 100.5, 96.5, 97.5]]);
  near(stopped.r, -1 - cost, "stop");
  assert.equal(stopped.how, 2);

  // stop and target inside one bar: it counts as the stop
  const both = run("swing", "long", [[100, 105, 96, 100]]);
  near(both.r, -1 - cost, "both touched");

  // a gap through the stop fills at the open, worse than the stop
  const gap = run("swing", "long", [quiet, [94, 95, 93, 94]]);
  near(gap.r, -2 - cost, "gap through the stop");

  // nothing touched in ten sessions: out at the tenth close
  const flat = Array.from({ length: 10 }, () => quiet);
  flat[9] = [100, 101.5, 99.5, 101.2];
  const timed = run("swing", "long", flat);
  near(timed.r, 1.2 / 3 - cost, "time exit");
  assert.equal(timed.how, 3);
  assert.equal(timed.exit, 10);

  // still running: nine sessions seen, neither level touched → not known yet
  assert.ok(Number.isNaN(run("swing", "long", flat.slice(0, 9)).r));
  // no next session at all
  assert.ok(Number.isNaN(run("swing", "long", []).r));

  // the short side mirrors it: stop 103, target 95.5
  const short = run("swing", "short", [quiet, [100, 100.5, 95, 96]]);
  near(short.r, 1.5 - cost, "short target");
  near(run("swing", "short", [quiet, [100, 103.5, 99, 103]]).r, -1 - cost, "short stop");
});

test("a day trade: in at the open, stopped 0.6 ATR away, otherwise out at that close", () => {
  // ATR 2 → risk 1.2, long stop 98.8; cost 0.1% of 100 = 0.1 → 0.0833R
  const cost = 0.1 / 1.2;
  near(run("day", "long", [[100, 101.5, 99.2, 101.2]]).r, 1 - cost, "held to the close");
  const s = run("day", "long", [[100, 102, 98.7, 101.9]]);
  near(s.r, -1 - cost, "stopped, whatever the close did");
  assert.equal(s.how, 2);
  near(run("day", "short", [[100, 100.9, 98, 98.8]]).r, 1 - cost, "short to the close");
  near(run("day", "short", [[100, 101.3, 98, 98.8]]).r, -1 - cost, "short stopped");
});

/* --------------------------------------------------------- what it finds */

test("a planted pattern is found, proved forward, and graded A", () => {
  const model = E.buildModel(trends(2500, 3), null);
  const out = E.read(model, {});
  assert.equal(out.available, true);
  const long = out.kinds.swing.long;
  assert.ok(long.oos.trades >= 80, `trades ${long.oos.trades}`);
  assert.ok(long.oos.t >= 3.5, `t ${long.oos.t}`);
  assert.ok(long.oos.expR > 0.25, `expectancy ${long.oos.expR}`);
  assert.ok(long.oos.winPct > 58, `won ${long.oos.winPct}%`);
  assert.ok(long.oos.winPct > long.oos.base.winPct + 10, "far better than taking every day");
  assert.ok(long.oos.recent.expR > 0, "and still working in the last two years");
  // it ends in an uptrend: today reads favourable for a long, and the record backs it
  assert.equal(long.live.fires, true, JSON.stringify(long.live));
  assert.equal(long.grade, "A");
  assert.match(long.why, /held up/);
  assert.equal(out.best.kind, "swing");
  assert.equal(out.best.side, "long");
  assert.equal(out.best.grade, "A");
  // the plan is in prices, on the tick, with the stop under and the target over
  const p = long.plan;
  assert.ok(p.stop < p.entryRef && p.target > p.entryRef);
  near(p.rr, 1.5);
  near(Math.round(p.stop * 20), p.stop * 20, "stop on the 5-paise tick");
  // the days it resembles are listed, with what a long did after each
  assert.equal(out.kinds.swing.analogs.length, 6);
  assert.match(out.kinds.swing.analogs[0].date, /^\d{4}-\d\d-\d\d$/);
  assert.ok(out.kinds.swing.forward.d5.upPct > 55);
  // calibration: the days it called above 60% did win more often than the days it called under 40%
  const cal = long.oos.calibration;
  assert.ok(cal.length >= 2);
  assert.ok(cal[cal.length - 1].realisedPct > cal[0].realisedPct + 15, JSON.stringify(cal));
});

test("on pure noise it proves nothing — whatever today's odds look like", () => {
  let fired = 0;
  for (const seed of [1, 2, 3, 4]) {
    const out = E.read(E.buildModel(noise(2500, seed), null), {});
    for (const kind of ["swing", "day"]) {
      for (const side of E.SIDES) {
        const x = out.kinds[kind][side];
        assert.ok(x.oos.t === null || x.oos.t < E.PROOF.B.t, `seed ${seed} ${kind}/${side}: t ${x.oos.t}`);
        assert.ok(x.oos.expR === null || x.oos.expR < 0.1, `seed ${seed} ${kind}/${side}: ${x.oos.expR}R`);
        assert.ok(x.grade === null || x.grade === "C", `seed ${seed} ${kind}/${side} graded ${x.grade}`);
        if (x.grade === "C") {
          fired += 1;
          assert.match(x.why, /NOT proved/);
        }
      }
    }
    assert.ok(!out.best || out.best.grade === "C");
    assert.equal(out.warning, null);
  }
  // noise does throw up favourable-looking days; that is exactly why the forward test decides
  assert.ok(fired >= 1, "at least one unproven reading among the sixteen");
});

test("costs are what noise loses", () => {
  const out = E.read(E.buildModel(noise(2500, 6), null), {});
  // taking every day at random: about minus the cost, in R
  for (const kind of ["swing", "day"]) {
    for (const side of E.SIDES) {
      const b = out.kinds[kind][side].oos.base;
      assert.ok(b.expR < 0.03 && b.expR > -0.3, `${kind}/${side} base ${b.expR}R`);
    }
  }
});

/* ------------------------------------------------------------ no look-ahead */

test("no reading uses a bar from its own future", () => {
  const bars = trends(1500, 7);
  const cut = 1100;
  const full = E.buildModel(bars, null);
  // the same history, but everything after day cut+1 is rewritten
  const r = rng(99);
  const other = bars.slice(0, cut + 2).concat(noise(400, 5).map((b, i) => ({ ...b, t: day(cut + 2 + i), o: b.o * (0.5 + r()), h: b.h * 2, l: b.l * 0.4 })));
  const changed = E.buildModel(other, null);
  const short = E.buildModel(bars.slice(0, cut + 2), null);
  let compared = 0;
  for (const kind of ["swing", "day"]) {
    for (const side of E.SIDES) {
      const a = full.kinds[kind].wf[side];
      for (const m of [changed, short]) {
        const b = m.kinds[kind].wf[side];
        for (let t = 0; t <= cut; t += 1) {
          const same = (Number.isNaN(a.p[t]) && Number.isNaN(b.p[t])) || a.p[t] === b.p[t];
          assert.ok(same && a.fire[t] === b.fire[t], `${kind}/${side} day ${t}: ${a.p[t]} vs ${b.p[t]}`);
          if (!Number.isNaN(a.p[t])) compared += 1;
        }
      }
    }
  }
  assert.ok(compared > 2000, `compared ${compared} readings`);
  // an outcome needs its own future, and only that: the last days have none yet
  const lab = full.kinds.swing.lab.long;
  assert.ok(Number.isNaN(lab.R[bars.length - 1]));
  assert.ok(Number.isNaN(lab.R[bars.length - 2]) || lab.how[bars.length - 2] !== 3, "an unfinished trade has no time exit");
});

/* ------------------------------------------------------------ today's reading */

test("before the open the day reading says so; once the open is known it is used", () => {
  const bars = trends(1200, 11);
  const model = E.buildModel(bars, null);
  const last = bars[bars.length - 1];
  const pre = E.read(model, {});
  assert.equal(pre.kinds.day.preOpen, true);
  assert.equal(pre.kinds.day.long.plan, null, "no entry price before the open");
  assert.equal(pre.open, null);
  const open = last.c * 1.004;
  const post = E.read(model, { open, last: last.c * 1.01 });
  assert.equal(post.kinds.day.preOpen, false);
  near(post.kinds.day.long.plan.entryRef, Math.round(open / 0.05) * 0.05, "the day plan starts from the open");
  assert.equal(post.kinds.day.long.plan.target, null, "a day trade has no target: it is out at the close");
  assert.ok(post.gapAtr > 0);
  // the swing plan follows the latest price
  near(post.kinds.swing.long.plan.entryRef, Math.round((last.c * 1.01) / 0.05) * 0.05, "swing entry reference");
  assert.equal(post.asOf, last.t);
  assert.equal(post.bars, 1200);
});

test("too little history: it says so instead of guessing", () => {
  const out = E.read(E.buildModel(noise(200, 2), null), {});
  assert.equal(out.available, false);
  assert.match(out.reason, /not enough history/i);
  // enough bars to describe today but too few to test forward: no grade above C is possible
  const thin = E.read(E.buildModel(noise(600, 2), null), {});
  assert.equal(thin.available, true);
  for (const side of E.SIDES) assert.ok(thin.kinds.swing[side].grade === null || thin.kinds.swing[side].grade === "C");
});

test("the market is part of the picture when an index is given", () => {
  const bars = trends(900, 4);
  const index = noise(900, 8);
  const a = E.prepare(bars, index);
  const b = E.prepare(bars, null);
  const row = 700 * 13;
  assert.notEqual(a.F[row + 9], b.F[row + 9], "Nifty trend feature");
  assert.equal(b.F[row + 9], 0);
  assert.equal(b.F[row + 10], 0);
  assert.ok(Math.abs(a.F[row + 9]) <= 3 && Math.abs(a.F[row + 10]) <= 3);
});

/* ------------------------------------------------------------------- speed */

test("ten years of one stock are learned and tested in a few seconds, without blocking", async () => {
  const bars = noise(2500, 9);
  const t0 = Date.now();
  let ticks = 0;
  const beat = setInterval(() => (ticks += 1), 5);
  const model = await E.buildModelAsync(bars, null);
  clearInterval(beat);
  const ms = Date.now() - t0;
  assert.ok(ms < 8000, `took ${ms} ms`);
  assert.ok(ticks >= 3, `other work ran ${ticks} times meanwhile`);
  assert.equal(E.read(model, {}).bars, 2500);
});

/* ------------------------------------------------- in the service: stored, tracked, scored */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MarketService } = require("../market/service");
const { FileDocs } = require("../docs");
const { Decision, slimEdge } = require("../ai/decision");
const { checkPlan } = require("../ai/service");
const { buildProfile } = require("../market/profile");

const IST = 5.5 * 3600 * 1000;
/** A moment on calendar day i of the made-up series, at hh:mm IST. */
const at = (i, hh, mm = 0) => Date.parse(`${day(i)}T00:00:00Z`) + (hh * 60 + mm) * 60000 - IST;

/** 1503 bars that end thirty days into an uptrend: today reads favourable for a swing long. */
const uptrendNow = () => trends(1517, 3).slice(0, 1503);

/** A market service with made-up bars: `upTo` says how many bars exist "now". */
function desk(full, { watch = ["AAA"] } = {}) {
  const docs = new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-edge-")));
  const m = Object.create(MarketService.prototype);
  const st = { now: 0, upTo: 0, dailyCalls: 0, indexCalls: 0, fail: new Set() };
  Object.assign(m, {
    store: { docs },
    now: () => st.now,
    mode: () => "kite",
    watchlist: () => watch,
    _liveQuote: () => null,
    index: async () => ((st.indexCalls += 1), null),
    daily: async (symbol) => {
      st.dailyCalls += 1;
      if (st.fail.has(symbol)) throw new Error("Zerodha did not answer.");
      return { candles: full.slice(0, st.upTo), source: "kite", stale: false };
    },
  });
  return { m, st, docs };
}

test("a reading is stored for its part of the day, the open is used once known, and calls are scored later", async () => {
  // day 1503 is a Tuesday; the series is in an uptrend from day 1472 to its end
  const n = 1503;
  const full = trends(n + 14, 3);
  assert.equal(new Date(`${day(n)}T00:00:00Z`).getUTCDay(), 2);
  const { m, st, docs } = desk(full);

  // 08:00, before the open: yesterday's bar is the last one
  st.now = at(n, 8);
  st.upTo = n;
  const pre = await m.edge("AAA");
  assert.equal(pre.available, true);
  assert.equal(pre.asOf, day(n - 1));
  assert.equal(pre.kinds.day.preOpen, true);
  assert.equal(pre.kinds.swing.long.grade, "A", pre.kinds.swing.long.why);
  assert.equal(pre.phase, `${day(n)}|pre`);
  assert.equal((await m.edge("AAA")).builtAt, pre.builtAt, "the same part of the day: from the database");
  assert.equal(st.dailyCalls, 1);
  assert.equal(docs.read("market/edge.json").AAA.asOf, day(n - 1));

  // the favourable swing reading was written down, once, with its plan
  let log = m.signals();
  const swing = log.signals.find((s) => s.kind === "swing" && s.side === "long");
  assert.equal(swing.id, `AAA|swing|long|${day(n - 1)}`);
  assert.equal(swing.grade, "A");
  assert.ok(swing.stop < swing.entryRef && swing.target > swing.entryRef);
  assert.equal(swing.r, undefined);
  assert.ok(!log.signals.some((s) => s.kind === "day"), "no day call before the open is known");
  assert.equal(log.summary.find((g) => g.key === "grade A").open >= 1, true);

  // 10:00: today's bar is forming — it is left out of the history, and its open is used
  st.now = at(n, 10);
  st.upTo = n + 1;
  const open = await m.edge("AAA");
  assert.equal(open.asOf, day(n - 1), "the forming bar is not history");
  assert.equal(open.kinds.day.preOpen, false);
  assert.equal(open.open, Math.round(full[n].o * 100) / 100);
  assert.equal(open.phase, `${day(n)}|open`);
  assert.equal(st.indexCalls, 1, "the learned model is reused while the history is unchanged");
  assert.equal(m.signals().signals.filter((s) => s.kind === "swing" && s.side === "long").length, 1, "not written down twice");

  // a fortnight on: the swing call's outcome is known and scored by the engine's own rules
  st.now = at(n + 14, 8);
  st.upTo = n + 14;
  const later = await m.edge("AAA");
  assert.equal(later.asOf, day(n + 13));
  log = m.signals();
  const scored = log.signals.find((s) => s.id === swing.id);
  assert.equal(typeof scored.r, "number");
  assert.ok(["target", "stop", "time"].includes(scored.how));
  assert.ok(scored.exitDate > day(n - 1) && scored.exitDate <= day(n + 10));
  const P = E.prepare(full.slice(0, n + 14), null);
  const want = E.outcome(E.KINDS.swing, "long", P.o, P.h, P.l, P.c, P.n, n - 1, P.atr[n - 1]);
  near(scored.r, Math.round(want.r * 100) / 100, "scored by the same rule");
  const all = log.summary.find((g) => g.key === "all");
  assert.ok(all.scored >= 1 && all.calls >= all.scored);
  assert.equal(m.signals({ symbol: "ZZZ" }).signals.length, 0);
  // while that call was open, no second swing long was logged for the stock
  const longs = log.signals.filter((s) => s.kind === "swing" && s.side === "long");
  assert.ok(longs.every((s) => s.asOf === day(n - 1) || s.asOf >= scored.exitDate), JSON.stringify(longs.map((s) => s.asOf)));
});

test("the board shows the watchlist from the database and builds what is missing behind it", async () => {
  const n = 1503;
  const { m, st } = desk(uptrendNow(), { watch: ["AAA", "BBB", "BAD"] });
  st.now = at(n, 8);
  st.upTo = n;
  st.fail.add("BAD");
  const first = m.edgeBoard();
  assert.equal(first.rows.length, 3);
  assert.ok(first.rows.every((r) => r.pending), "nothing measured yet");
  assert.ok(first.building >= 1);
  await m._edgeRunning;
  const second = m.edgeBoard();
  assert.equal(second.building, 0);
  const a = second.rows.find((r) => r.symbol === "AAA");
  assert.equal(a.available, true);
  assert.equal(a.fresh, true);
  assert.equal(a.best.grade, "A");
  const bad = second.rows.find((r) => r.symbol === "BAD");
  assert.match(bad.error, /did not answer/);
  assert.equal(m._edgeRunning, null, "a failing stock is not retried at once");
  // the method's record pooled across the stocks that have one
  const pool = second.pooled["swing.long"];
  assert.equal(pool.stocks, 2);
  assert.equal(pool.trades, a.kinds.swing.long.oos.trades * 2);
  assert.ok(pool.t > 4 && pool.winPct > 55 && pool.expR > 0.2, JSON.stringify(pool));
  assert.equal(second.proof.A.t, 2.5);
  // five minutes later the failing stock is tried again
  st.fail.clear();
  st.now += 6 * 60 * 1000;
  m.edgeBoard();
  await m._edgeRunning;
  assert.equal(m.edgeBoard().rows.find((r) => r.symbol === "BAD").available, true);
});

test("a short history is reported, not guessed at", async () => {
  const { m, st } = desk(noise(200, 1));
  st.now = at(250, 20);
  st.upTo = 200;
  const out = await m.edge("AAA");
  assert.equal(out.available, false);
  assert.match(out.reason, /more than a year/);
  assert.equal(m.signals().signals.length, 0);
  await assert.rejects(() => m.edge("bad symbol!"), /valid symbol/);
});

test("the AI decision is given the measured odds as a third input, and works without them", async () => {
  const report = E.read(E.buildModel(uptrendNow(), null), {});
  const slim = slimEdge(report);
  assert.equal(slim.available, true);
  assert.equal(slim.swing.long.grade, "A");
  assert.ok(slim.swing.long.forwardTest.trades > 40);
  assert.equal(slim.day.openNotYetKnown, true);
  assert.equal(slimEdge(null).available, false);
  assert.equal(slimEdge({ available: false, reason: "x" }).reason, "x");

  const answer = { decision: "wait", horizon: "swing", heading: "up", confidence: "low", thesis: "t", live_evidence: ["a"], habit_evidence: ["b"], odds_evidence: ["50 similar days, 64% won"], conflicts: [], entry: 0, stop: 0, targets: [], level_notes: "", invalidation: "i", watch: [] };
  const asked = [];
  const ai = (market) => ({
    docs: new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-dec2-"))),
    now: () => Date.parse("2026-11-12T05:00:00Z"),
    log: { log() {}, error() {} },
    configured: () => true,
    playbook: { read: () => "(skills)" },
    brief: async () => ({ brief: { symbol: "AAA" }, verdict: { last: 100, quoteLive: true, movement: { atr: 2 }, circuit: { upper: 110, lower: 90 }, day: { available: false }, direction: "bullish" } }),
    market,
    _client: () => ({ ask: async (q) => (asked.push(q), { data: answer, usage: { inputTokens: 9, outputTokens: 3 }, model: "claude-opus-5-5" }) }),
  });
  const profile = buildProfile("AAA", trends(400, 2));
  const withOdds = await new Decision(ai({ behaviour: async () => profile, edge: async () => report }), checkPlan).decide("AAA");
  assert.match(asked[0].user, /MEASURED ODDS/);
  assert.match(asked[0].user, /"forwardTest"/);
  assert.match(asked[0].system, /past frequencies with a sample size, not a probability of profit/);
  assert.deepEqual(withOdds.oddsEvidence, ["50 similar days, 64% won"]);
  assert.equal(withOdds.odds.best.grade, "A");
  // the engine failing, or missing altogether, never stops a decision
  const broken = await new Decision(ai({ behaviour: async () => profile, edge: async () => Promise.reject(new Error("down")) }), checkPlan).decide("AAA");
  assert.equal(broken.odds, null);
  assert.match(asked[1].user, /"available":false/);
  const none = await new Decision(ai({ behaviour: async () => profile }), checkPlan).decide("AAA");
  assert.equal(none.decision, "wait");
});

/* ------------------------------------------------------------- price alerts */

test("a price alert is kept, takes its side from the price now, and fires once", async () => {
  const { m, st, docs } = desk(noise(300, 1));
  st.now = at(10, 10);
  m.quotes = async () => ({ quotes: { SBIN: { last: 790 } } });
  m._readCache = () => null;
  const up = await m.addAlert({ symbol: "sbin", price: 800 }, "me@example.com");
  assert.equal(up.alert.symbol, "SBIN");
  assert.equal(up.alert.dir, "above");
  assert.equal(up.alert.from, 790);
  assert.equal(up.alert.firedAt, null);
  const down = await m.addAlert({ symbol: "SBIN", price: 780, note: "support" });
  assert.equal(down.alert.dir, "below");
  assert.equal(down.alert.note, "support");
  await assert.rejects(() => m.addAlert({ symbol: "SBIN", price: 800 }), /already set/);
  await assert.rejects(() => m.addAlert({ symbol: "SBIN", price: 0 }), /Enter the price/);
  await assert.rejects(() => m.addAlert({ symbol: "bad symbol!", price: 5 }), /valid symbol/);

  // no live quote: the last saved close decides; with nothing at all, the side must be given
  m.quotes = async () => ({ quotes: {} });
  m._readCache = (s) => (s === "INFY" ? { candles: [{ c: 1500 }] } : null);
  assert.equal((await m.addAlert({ symbol: "INFY", price: 1450 })).alert.dir, "below");
  await assert.rejects(() => m.addAlert({ symbol: "TCS", price: 4000 }), /above or below/);
  assert.equal((await m.addAlert({ symbol: "TCS", price: 4000, dir: "above" })).alert.dir, "above");

  // the page reports the crossing: recorded once, however many tabs report it
  const f1 = m.fireAlert(up.alert.id, 800.4);
  assert.equal(f1.first, true);
  assert.equal(f1.alert.firedPrice, 800.4);
  const f2 = m.fireAlert(up.alert.id, 805);
  assert.equal(f2.first, false);
  assert.equal(f2.alert.firedPrice, 800.4);
  assert.throws(() => m.fireAlert("nope", 1), /no longer exists/);

  // waiting alerts first, fired ones after; removing one
  const all = m.alerts().alerts;
  assert.equal(all.length, 4);
  assert.equal(all[all.length - 1].id, up.alert.id);
  assert.equal(m.removeAlert(down.alert.id).alerts.length, 3);
  assert.equal(docs.read("market/alerts.json").length, 3);
  assert.equal(m.removeAlert("nope").alerts.length, 3);
});

test("when the edge is only the stock's own drift, the reading says so", () => {
  // a steady climb with noise: every day is a good day to buy, so choosing days adds nothing
  const r = rng(21);
  const rets = [];
  for (let i = 0; i < 1500; i += 1) rets.push(0.003 + gauss(r) * 0.011);
  const out = E.read(E.buildModel(barsFrom(rets, r), null), {});
  const long = out.kinds.swing.long;
  assert.ok(long.oos.base.expR > 0.2, `every day: ${long.oos.base.expR}R`);
  assert.equal(long.grade, "A", long.why);
  assert.match(long.why, /Choosing the days added little/);
  assert.match(long.why, /lasts only as long as/);
  // where the timing does add something, the note is absent
  const timed = E.read(E.buildModel(trends(2500, 3), null), {}).kinds.swing.long;
  assert.doesNotMatch(timed.why, /added little/);
});
