"use strict";
// The day replayed through the live call: what it would have said at each 5-minute
// close, and how each "in play" call ended. Pure arithmetic — and it must never use
// anything that was not yet known at the moment it is replaying.

const test = require("node:test");
const assert = require("node:assert/strict");

const { analyze } = require("../market/analyze");
const { replayDay, replayDayAsync, combine, DEFAULT_COST_PCT, LABEL } = require("../market/replay");

const DATE = "2026-11-12";
const dayN = (i) => new Date(Date.UTC(2018, 0, 1) + i * 86400000).toISOString().slice(0, 10);

function history(n, lastDate, seed = 99) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648), s / 2147483648);
  const out = [];
  let p = 80;
  for (let i = 0; i < n; i += 1) {
    const o = p;
    p = p * (1 + (0.08 + (rnd() - 0.5) * 1.6) / 100);
    out.push({ t: dayN(i), o, h: Math.max(o, p) * 1.004, l: Math.min(o, p) * 0.996, c: p, v: 400000 });
  }
  // end exactly on lastDate
  const shift = (Date.parse(`${lastDate}T00:00:00Z`) - Date.parse(`${out[n - 1].t}T00:00:00Z`)) / 86400000;
  return out.map((c, i) => ({ ...c, t: new Date(Date.UTC(2018, 0, 1) + (i + shift) * 86400000).toISOString().slice(0, 10) }));
}
const stampOf = (i, date = DATE) => {
  const m = 9 * 60 + 15 + i * 5;
  return `${date}T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00+0530`;
};
const clockOf = (i) => stampOf(i).slice(11, 16);
/** 5-minute bars from 09:15, one per closing price. */
function tape(prices, date = DATE) {
  return prices.map((p, i) => {
    const o = i === 0 ? p : prices[i - 1];
    return { t: stampOf(i, date), o, h: Math.max(o, p) + 0.1, l: Math.min(o, p) - 0.1, c: p, v: 5000 + (i % 7) * 300 };
  });
}

const candles = history(2200, "2026-11-11");
const pc = candles[candles.length - 1].c;
const analysis = analyze(candles, { chartBars: 1 });
const atr = analysis.levels.atr.value;
// a day that leaves its opening range upwards, sags at midday and recovers
const prices = [];
for (let i = 0; i < 75; i += 1) {
  const trend = i < 6 ? 0.1 * Math.sin(i) : i < 30 ? 0.035 * (i - 6) : i < 42 ? 0.84 - 0.06 * (i - 30) : 0.12 + 0.03 * (i - 42);
  prices.push(pc * (1.002 + (trend * atr) / pc));
}
const bars = tape(prices);
const prior = tape(Array.from({ length: 75 }, (_, i) => pc * (0.995 + 0.00005 * i)), "2026-11-11");
const full = replayDay({ analysis, candles, bars, prior });
const near = (a, b, eps = 0.011) => Math.abs(a - b) <= eps;

test("the replay reads the engine at every 5-minute close, and respects the clock", () => {
  assert.equal(full.available, true);
  assert.equal(full.date, DATE);
  assert.equal(full.costPct, DEFAULT_COST_PCT);
  assert.equal(full.steps.length, 75);
  assert.deepEqual([full.steps[0].t, full.steps[74].t], ["09:20", "15:30"]);
  // nothing in the first fifteen minutes, nothing new after 2:45 PM, and no call once the market has closed
  assert.deepEqual(full.steps.slice(0, 2).map((s) => s.state), ["no-trade", "no-trade"]);
  for (const s of full.steps.filter((x) => x.t >= "14:45" && x.t < "15:30")) assert.equal(s.state, "no-trade", s.t);
  assert.equal(full.steps[74].state, "closed");
  assert.equal(full.steps[74].score, null);
  // every change of the call is listed once, with the price at that close
  assert.ok(full.changes.length >= 4);
  for (const c of full.changes) {
    const k = full.steps.findIndex((s) => s.t === c.t);
    assert.equal(c.to, LABEL[full.steps[k].state]);
    assert.equal(c.from, LABEL[full.steps[k - 1].state]);
    assert.equal(c.price, full.steps[k].price);
  }
  assert.equal(full.summary.callChanges, full.changes.length);
});

test("each fresh 'in play' call becomes one trade: entered at that close, stop on the losing side, scored in R", () => {
  assert.ok(full.trades.length >= 2, `the day should produce calls (got ${full.trades.length})`);
  let prevExit = "00:00";
  for (const t of full.trades) {
    const k = full.steps.findIndex((s) => s.t === t.at);
    assert.equal(full.steps[k].state, t.side, "the engine said so at that close");
    assert.notEqual(full.steps[k - 1].state, t.side, "and it was a change of the call, not a repeat");
    assert.equal(t.entry, full.steps[k].price, "entered at the close where the call appeared");
    assert.ok(t.side === "long" ? t.stop < t.entry : t.stop > t.entry);
    assert.ok(near(t.riskPerShare, Math.abs(t.entry - t.stop)));
    if (t.target !== null) assert.ok(near(Math.abs(t.target - t.entry), t.riskPerShare, 0.02), "the target is 1R away");
    assert.ok(t.at >= prevExit, "one trade at a time");
    prevExit = t.exitAt;
    // the result, in multiples of the risk
    const dir = t.side === "long" ? 1 : -1;
    assert.ok(near(t.r, (dir * (t.exit - t.entry)) / Math.abs(t.entry - t.stop), 0.03), JSON.stringify(t));
    if (t.why === "target") assert.ok(near(t.r, 1, 0.02));
    if (t.why === "stop") assert.ok(t.r <= -0.98);
    if (t.why === "square-off") assert.equal(t.exitAt, "15:15");
    // costs: an assumed share of the position's value, expressed against the risk taken
    assert.ok(near(t.costR, ((DEFAULT_COST_PCT / 100) * t.entry) / Math.abs(t.entry - t.stop), 0.02));
    assert.ok(near(t.netR, t.r - t.costR));
    assert.equal(t.risk, undefined, "internal fields are not sent out");
  }
  const s = full.summary;
  assert.equal(s.calls, full.trades.length);
  assert.equal(s.target + s.stop + s.squareOff + s.flip + s.open, s.calls);
  assert.ok(near(s.grossR, full.trades.reduce((a, t) => a + t.r, 0), 0.02));
  assert.ok(near(s.netR, s.grossR - s.costR, 0.02));
  assert.equal(s.wins + s.losses <= s.finished, true);
  assert.ok(s.costR > 0, "costs are never zero at the default assumption");
});

test("no look-ahead: replaying the morning alone gives exactly the morning of the full replay", () => {
  for (const k of [3, 10, 20, 31, 50, 74]) {
    const part = replayDay({ analysis, candles, bars: bars.slice(0, k), prior });
    assert.deepEqual(part.steps, full.steps.slice(0, k), `steps up to bar ${k}`);
    assert.deepEqual(part.changes, full.changes.filter((c) => c.t <= part.steps[k - 1].t), `changes up to bar ${k}`);
    // every trade that had been opened by then was opened at the same price with the same stop
    const opened = full.trades.filter((t) => t.at <= part.steps[k - 1].t);
    assert.deepEqual(part.trades.map((t) => [t.at, t.side, t.entry, t.stop, t.target]), opened.map((t) => [t.at, t.side, t.entry, t.stop, t.target]));
    // and one that had already finished has the same result
    for (const t of part.trades.filter((x) => x.why !== "open")) {
      const same = opened.find((o) => o.at === t.at);
      assert.deepEqual([t.why, t.exit, t.r, t.netR], [same.why, same.exit, same.r, same.netR]);
    }
  }
});

test("a trade still open when the bars run out is marked at the last price and kept out of the totals", () => {
  const first = full.trades[0];
  const k = full.steps.findIndex((s) => s.t === first.at);
  const part = replayDay({ analysis, candles, bars: bars.slice(0, k + 1), prior });
  const t = part.trades[part.trades.length - 1];
  assert.equal(t.why, "open");
  assert.equal(t.exit, t.entry);
  assert.equal(t.r, 0);
  assert.equal(part.summary.open, 1);
  assert.equal(part.summary.finished, part.trades.length - 1);
  assert.equal(part.day.complete, false);
  assert.equal(full.day.complete, true);
});

/** The first trade of the day, with the bars after its entry replaced by `after(entryBarIndex, trade)`. */
function rerun(after) {
  const first = full.trades[0];
  const k = full.steps.findIndex((s) => s.t === first.at);
  const changed = [...bars.slice(0, k + 1), ...after(k, first)];
  const out = replayDay({ analysis, candles, bars: changed, prior });
  assert.deepEqual([out.trades[0].at, out.trades[0].entry, out.trades[0].stop], [first.at, first.entry, first.stop], "the entry itself is untouched");
  return out.trades[0];
}
const bar = (i, o, h, l, c) => ({ t: stampOf(i), o, h, l, c, v: 5000 });

test("stop before target: a bar that touches both counts as a stop, and a gap through the stop is filled at the open", () => {
  const dir = full.trades[0].side === "long" ? 1 : -1;
  // one bar that reaches the target AND the stop
  const both = rerun((k, t) => [bar(k + 1, t.entry, Math.max(t.target, t.stop) + 0.2, Math.min(t.target, t.stop) - 0.2, t.entry)]);
  assert.equal(both.why, "stop");
  assert.equal(both.exit, both.stop);
  assert.ok(near(both.r, -1, 0.02));
  assert.equal(both.exitAt, clockOf(full.steps.findIndex((s) => s.t === both.at) + 1));
  // the next bar opens beyond the stop: out at the open, for more than the planned risk
  const gap = rerun((k, t) => {
    const o = t.stop - dir * 3 * t.riskPerShare;
    return [bar(k + 1, o, Math.max(o, o + dir * 0.1) + 0.05, Math.min(o, o + dir * 0.1) - 0.05, o)];
  });
  assert.equal(gap.why, "stop");
  assert.ok(near(gap.r, -4, 0.05), `a gap of three more risks loses about 4R, got ${gap.r}`);
  // the target alone
  const win = rerun((k, t) => [bar(k + 1, t.entry, Math.max(t.entry, t.target) + 0.01, Math.min(t.entry, t.target) - 0.01, t.target)]);
  assert.equal(win.why, "target");
  assert.equal(win.exit, win.target);
  assert.ok(near(win.r, 1, 0.02));
  assert.ok(win.netR < win.r, "and costs come off even a winner");
});

test("neither stop nor target: the trade is closed at the open of the 3:15 PM bar", () => {
  const t = rerun((k, tr) => {
    const quiet = [];
    const drift = (tr.side === "long" ? 1 : -1) * 0.3 * tr.riskPerShare;
    for (let i = k + 1; i < 75; i += 1) quiet.push(bar(i, tr.entry + drift, tr.entry + drift + 0.02, tr.entry + drift - 0.02, tr.entry + drift));
    return quiet;
  });
  assert.equal(t.why, "square-off");
  assert.equal(t.exitAt, "15:15");
  assert.ok(near(t.r, 0.3, 0.03));
});

test("the assumed cost is a setting: at zero the net result is the gross one", () => {
  const free = replayDay({ analysis, candles, bars, prior, costPct: 0 });
  assert.equal(free.costPct, 0);
  for (const t of free.trades) {
    assert.equal(t.costR, 0);
    assert.equal(t.netR, t.r);
  }
  assert.equal(free.summary.netR, free.summary.grossR);
  const dear = replayDay({ analysis, candles, bars, prior, costPct: 0.3 });
  assert.ok(dear.summary.netR < full.summary.netR, "a dearer round trip lowers the net result");
  assert.deepEqual(dear.steps, full.steps, "and changes nothing about the calls themselves");
});

test("the day's own numbers are measured from its bars", () => {
  const d = full.day;
  assert.equal(d.bars, 75);
  assert.ok(near(d.open, bars[0].o));
  assert.ok(near(d.close, bars[74].c));
  assert.ok(near(d.high, Math.max(...bars.map((b) => b.h))));
  assert.ok(near(d.low, Math.min(...bars.map((b) => b.l))));
  assert.ok(near(d.prevClose, pc));
  assert.ok(near(d.changePct, ((bars[74].c - pc) / pc) * 100, 0.011));
  assert.ok(near(d.orHigh, Math.max(...bars.slice(0, 3).map((b) => b.h))));
  assert.ok(near(d.orLow, Math.min(...bars.slice(0, 3).map((b) => b.l))));
  assert.equal(d.closedVsOpeningRange, "above");
  assert.ok(d.rangeVsAtr > 0.5 && d.rangeVsAtr < 3);
  assert.ok(d.vwap > d.low && d.vwap < d.high);
});

test("the stepping version gives the same answer, and a day with nothing to replay says so", async () => {
  assert.deepEqual(await replayDayAsync({ analysis, candles, bars, prior }), full);
  assert.equal(replayDay({ analysis, candles, bars: [], prior }).available, false);
  assert.match(replayDay({ analysis, candles, bars: [] }).reason, /no 5-minute bars/);
  assert.equal(replayDay({ analysis: { enoughData: false, message: "Only 12 daily bars." }, candles, bars }).reason, "Only 12 daily bars.");
  assert.equal(replayDay({ analysis: null, candles: [], bars }).available, false);
});

test("the watchlist as one day: every finished call in time order with a running total", () => {
  const down = replayDay({ analysis, candles, bars: tape(prices.map((p) => 2 * pc * 1.002 - p)), prior });
  const rows = [
    { symbol: "UPCO", ...full },
    { symbol: "DOWNCO", ...down },
    { symbol: "DEAD", available: false, reason: "no bars" },
  ];
  const { totals, curve } = combine(rows);
  assert.equal(totals.stocks, 2);
  assert.equal(totals.calls, full.summary.calls + down.summary.calls);
  assert.ok(near(totals.netR, full.summary.netR + down.summary.netR, 0.02));
  assert.ok(near(totals.grossR - totals.costR, totals.netR, 0.03));
  assert.equal(curve.length, full.summary.finished + down.summary.finished);
  for (let i = 1; i < curve.length; i += 1) assert.ok(curve[i].t >= curve[i - 1].t, "in time order");
  let run = 0;
  for (const p of curve) {
    run += p.netR;
    assert.ok(near(p.total, run, 0.02));
  }
  assert.ok(near(curve[curve.length - 1].total, totals.netR, 0.03));
  // the deepest fall of the running total from an earlier high
  let peak = 0;
  let worst = 0;
  for (const p of curve) {
    peak = Math.max(peak, p.total);
    worst = Math.min(worst, p.total - peak);
  }
  assert.ok(near(totals.deepestDipR, worst, 0.02));
  assert.ok(totals.deepestDipR <= 0);
  assert.deepEqual(combine([]).curve, []);
  assert.equal(combine([{ symbol: "X", available: false }]).totals.calls, 0);
});
