"use strict";
// The Intraday Plan (server/market/intraplan.js): tomorrow's intraday plan for one stock, its habits
// and the plan's own replayed record — all on SYNTHETIC sessions (no network, no clock).

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildIntradayPlan, plansFor, play, nextWeekday } = require("../market/intraplan");

/* --------------------------------------------------------------------------- synthetic market */

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weekdays(n, from = "2025-03-03") {
  const out = [];
  const t = new Date(`${from}T00:00:00Z`);
  while (out.length < n) {
    const d = t.getUTCDay();
    if (d !== 0 && d !== 6) out.push(t.toISOString().slice(0, 10));
    t.setUTCDate(t.getUTCDate() + 1);
  }
  return out;
}

const TIMES = Array.from({ length: 75 }, (_, i) => {
  const m = 555 + i * 5;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});

/**
 * A whole market of sessions: dayFn(rand, prevClose, index) gives the gap and a 76-point path of
 * multipliers of the open (point 0 = the open, point 75 = the close). Daily bars are built from the
 * 5-minute bars, so the two always agree.
 */
function world({ n = 230, start = 1000, seed = 1, dayFn }) {
  const r = rng(seed);
  const dates = weekdays(n);
  let pc = start;
  const daily = [];
  const bars = [];
  dates.forEach((d, idx) => {
    const { gap, path } = dayFn(r, pc, idx);
    const o = pc * (1 + gap);
    const pts = path.map((m) => o * m);
    const day = [];
    for (let i = 0; i < 75; i += 1) {
      const a = pts[i];
      const b = pts[i + 1];
      const wig = Math.abs(b - a) * 0.2 + o * 0.0002;
      day.push({ t: `${d}T${TIMES[i]}:00+0530`, o: a, h: Math.max(a, b) + wig, l: Math.min(a, b) - wig, c: b, v: 100000 });
    }
    daily.push({ t: d, o, h: Math.max(...day.map((x) => x.h)), l: Math.min(...day.map((x) => x.l)), c: pts[75], v: 7500000 });
    bars.push(...day);
    pc = pts[75];
  });
  return { daily, bars };
}

const line = (from, to, r, noise = 0.0004) => Array.from({ length: 76 }, (_, i) => from + ((to - from) * i) / 75 + (i === 0 || i === 75 ? 0 : (r() - 0.5) * noise));

// up days rise steadily after a small dip in the first fifteen minutes; down days drift lower — a
// rising stock whose breaks above the previous high keep running
const trendUp = (r, pc, i) =>
  i % 5 < 3
    ? { gap: 0.0005, path: Array.from({ length: 76 }, (_, j) => (j <= 3 ? 1 - (0.002 * j) / 3 : 0.998 + 0.013 * Math.min(1, (j - 3) / 66)) + (j === 0 ? 0 : (r() - 0.5) * 0.0004)) }
    : { gap: -0.0005, path: line(1, 0.994, r) };
const trendDown = (r, pc, i) =>
  i % 5 < 3
    ? { gap: -0.0005, path: Array.from({ length: 76 }, (_, j) => (j <= 3 ? 1 + (0.002 * j) / 3 : 1.002 - 0.013 * Math.min(1, (j - 3) / 66)) + (j === 0 ? 0 : (r() - 0.5) * 0.0004)) }
    : { gap: 0.0005, path: line(1, 1.006, r) };
const noise = (r) => {
  let x = 1;
  const path = [1];
  for (let j = 0; j < 75; j += 1) {
    x *= 1 + (r() - 0.5) * 0.004;
    path.push(x);
  }
  return { gap: (r() - 0.5) * 0.006, path };
};
const quiet = (r) => ({ gap: 0, path: Array.from({ length: 76 }, (_, j) => 1 + 0.0004 * Math.sin(j / 4) + (j === 0 ? 0 : (r() - 0.5) * 0.0002)) });

/* ------------------------------------------------------------------------------------- tests */

test("a rising stock whose breaks keep running: a LONG plan, a positive replayed record, habits and odds", () => {
  // 228 sessions: the history ends on the third up day of a week, so the chart leans up
  const { daily, bars } = world({ n: 228, dayFn: trendUp });
  const p = buildIntradayPlan({ daily, bars5: bars.slice(-120 * 75) });
  assert.equal(p.available, true);
  assert.ok(p.habits && p.habits.sessions >= 100, "habits come from the 5-minute sessions");
  assert.ok(p.record.lean.long.trades >= 8, "the long rules were taken on past up-leaning days");
  assert.ok(p.record.lean.long.avgR > 0, "and they paid after costs");
  assert.equal(p.decision.kind, "long");
  assert.match(p.decision.headline, /^LONG above ₹/);
  assert.ok(p.decision.strength > 50);
  const L = p.plans.long;
  assert.ok(L.stop < L.entry && L.targets[0] > L.entry && L.targets[1] > L.targets[0]);
  assert.ok(p.plans.short.stop > p.plans.short.entry && p.plans.short.targets[0] < p.plans.short.entry);
  assert.ok(p.ladder.every((x, i, a) => i === 0 || a[i - 1].price >= x.price), "the ladder runs from the highest level down");
  assert.ok(p.range.low < p.open.expected && p.range.high > p.open.expected);
  assert.ok(p.range.wideHigh >= p.range.high && p.range.wideLow <= p.range.low);
  assert.ok(p.odds.up.sessions > 0);
  assert.ok(p.decision.checklist.some((c) => /stop/.test(c)) && p.decision.checklist.some((c) => /3:15 PM/.test(c)));
  assert.equal(p.nextSession, nextWeekday(daily[daily.length - 1].t));
});

test("the same rising stock the evening after two down days: no clear lean, so the opening-range break", () => {
  const { daily, bars } = world({ n: 230, dayFn: trendUp });
  const p = buildIntradayPlan({ daily, bars5: bars.slice(-120 * 75) });
  assert.equal(p.lean.call, "neutral");
  assert.equal(p.decision.kind, "orb");
  assert.ok(p.decision.checklist.some((c) => /9:15–9:30/.test(c)));
});

test("an expected gap far through the long trigger turns the plan into the opening-range break", () => {
  const { daily, bars } = world({ n: 228, dayFn: trendUp });
  const calm = buildIntradayPlan({ daily, bars5: bars.slice(-120 * 75) });
  assert.equal(calm.decision.kind, "long");
  const gapped = buildIntradayPlan({ daily, bars5: bars.slice(-120 * 75), gift: { available: true, last: 26000, changePct: 3 } });
  assert.ok(gapped.open.expected > gapped.plans.long.entry);
  assert.equal(gapped.decision.kind, "orb", "a trigger jumped at the open is stale: the day's own range sets the levels (it has held up here)");
  assert.ok(gapped.decision.against.some((x) => /trigger has been jumped/.test(x)));
});

test("a falling stock gets the SHORT plan, marked intraday only", () => {
  const { daily, bars } = world({ n: 228, dayFn: trendDown, start: 2000 });
  const p = buildIntradayPlan({ daily, bars5: bars.slice(-120 * 75) });
  assert.equal(p.decision.kind, "short");
  assert.match(p.decision.headline, /intraday only/);
  assert.ok(p.decision.checklist.some((c) => /bought back the same day/.test(c)));
  assert.ok(p.record.lean.short.avgR > 0);
});

test("random sessions: no rule is reported as having held up", () => {
  for (const seed of [3, 7, 11]) {
    const { daily, bars } = world({ dayFn: noise, seed });
    const p = buildIntradayPlan({ daily, bars5: bars.slice(-120 * 75) });
    assert.equal(p.available, true);
    for (const s of [p.record.lean, p.record.both, p.record.orb]) assert.notEqual(s.verdict, "held up", `seed ${seed}: a noise market must not look proven`);
  }
});

test("a stock that barely moves is AVOID: costs would eat the risk", () => {
  const { daily, bars } = world({ dayFn: quiet });
  const p = buildIntradayPlan({ daily, bars5: bars.slice(-80 * 75) });
  assert.equal(p.decision.kind, "avoid");
  assert.ok(p.decision.against.some((x) => /Costs of/.test(x)));
});

test("the expected open: GIFT Nifty's move times this stock's measured sensitivity, and none while the market trades", () => {
  const r = rng(5);
  const ng = weekdays(230).map(() => (r() - 0.5) * 0.01);
  const nifty = world({ dayFn: (_r, _pc, i) => ({ gap: ng[i], path: line(1, 1.001, _r, 0) }), seed: 2, start: 20000 }).daily;
  const stock = world({ dayFn: (rr, _pc, i) => ({ gap: 1.5 * ng[i], path: line(1, 1.0005, rr) }), seed: 9 });
  const gift = { available: true, last: 26000, changePct: 1 };
  const p = buildIntradayPlan({ daily: stock.daily, nifty, gift });
  assert.ok(Math.abs(p.open.beta - 1.5) < 0.1, `beta ${p.open.beta}`);
  assert.ok(Math.abs(p.open.gapPct - 1.5) < 0.15);
  assert.ok(p.open.expected > p.last && p.open.low < p.open.expected && p.open.high > p.open.expected);
  assert.match(p.open.basis, /GIFT Nifty/);
  const live = buildIntradayPlan({ daily: stock.daily, nifty, gift, marketOpen: true });
  assert.equal(live.open.gapPct, 0, "during the session the overnight cue is not used");
});

test("without 5-minute history it still plans from the daily chart, and says what is missing", () => {
  const { daily } = world({ dayFn: trendUp });
  const p = buildIntradayPlan({ daily });
  assert.equal(p.available, true);
  assert.equal(p.record, null);
  assert.equal(p.habits, null);
  assert.match(p.reason, /5-minute/);
  assert.ok(["long", "short", "orb", "wait", "avoid"].includes(p.decision.kind));
  assert.equal(buildIntradayPlan({ daily: daily.slice(0, 30) }).available, false);
});

test("no look-ahead: later sessions never change the record of earlier ones", () => {
  const { daily, bars } = world({ dayFn: noise, seed: 21 });
  const full = buildIntradayPlan({ daily, bars5: bars.slice(-120 * 75) });
  const cut = daily.length - 4;
  const early = buildIntradayPlan({ daily: daily.slice(0, cut), bars5: bars.slice(-120 * 75).filter((b) => b.t.slice(0, 10) <= daily[cut - 1].t) });
  // same policy on both sides, so the lists are comparable
  assert.equal(full.record.recentPolicy, early.record.recentPolicy);
  const byDate = new Map(full.record.recent.map((t) => [t.date, t]));
  const shared = early.record.recent.filter((t) => byDate.has(t.date));
  assert.ok(shared.length >= 3, "the two records overlap");
  for (const t of shared) assert.deepEqual(byDate.get(t.date), t);
});

test("the rules: a bar that triggers and touches the stop is a loss; a target only counts after the entry bar; out at 3:15 PM", () => {
  const prev = { h: 105, l: 95, c: 100 };
  const plans = plansFor(prev, 10);
  const L = plans.long;
  assert.ok(L.entry > 105 && L.stop < L.entry);
  const mk = (rows) => rows.map(([hm, o, h, l, c]) => ({ t: `2026-11-13T${hm}:00+0530`, o, h, l, c, v: 1 }));
  const whip = play(mk([["09:15", 100, 101, 99, 100], ["09:30", 104, L.entry + 1, L.stop - 1, 104]]), L, "long", 0.1, 1);
  assert.equal(whip.how, "stop");
  assert.ok(whip.r < -1, "a full loss plus costs");
  const win = play(mk([["09:15", 100, 101, 99, 100], ["09:30", 104, L.entry + 0.1, 104, L.entry], ["09:35", L.entry, L.targets[0] + 1, L.entry - 0.1, L.targets[0]]]), L, "long", 0.1, 1);
  assert.equal(win.how, "target");
  assert.ok(win.r > 1);
  const timed = play(mk([["09:15", 100, 101, 99, 100], ["09:30", 104, L.entry + 0.1, 104, L.entry], ["15:15", L.entry + 1, L.entry + 1, L.entry + 1, L.entry + 1]]), L, "long", 0, 1);
  assert.equal(timed.how, "time");
  assert.equal(play(mk([["09:15", 100, 101, 99, 100], ["15:05", 104, L.entry + 1, 104, L.entry]]), L, "long", 0.1, 1), null, "no new entry after 3:00 PM");
});
