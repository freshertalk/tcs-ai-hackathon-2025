"use strict";
// The Execution Lab (server/analysis/lab.js): trades replayed on 1-minute bars — MFE/MAE, the share
// kept, the entry context, what other exits would have made, behaviour flags, the score, a period.

const test = require("node:test");
const assert = require("node:assert/strict");
const { labDay, labRange, simulate, vwapAt, RULES } = require("../analysis/lab");

const D = "2026-11-13";
const at = (hhmm) => Date.parse(`${D}T${hhmm}:00+05:30`);
// a day that rises from 100 to 103 by 11:00, then falls back to 101 by 15:15 (1-minute bars)
function dayBars() {
  const out = [];
  for (let t = at("09:15"); t <= at("15:29"); t += 60000) {
    const m = (t - at("09:15")) / 60000;
    const px = m <= 105 ? 100 + (3 * m) / 105 : 103 - (2 * (m - 105)) / (360 - 105);
    out.push({ t, o: px, h: px + 0.05, l: px - 0.05, c: px, v: 1000 });
  }
  return out;
}
const trip = (o) => ({ key: o.key || `${o.side}-${o.in}`, symbol: "SBIN", side: o.side, entryAt: at(o.in), exitAt: at(o.out), entryAvg: o.e, exitAvg: o.x, maxQty: 100, pnl: (o.side === "long" ? o.x - o.e : o.e - o.x) * 100, charges: o.ch ?? 20, net: (o.side === "long" ? o.x - o.e : o.e - o.x) * 100 - (o.ch ?? 20), intraday: true });

test("vwap and one exit rule on the bars", () => {
  const bars = dayBars();
  const vw = vwapAt(bars, at("10:00"));
  assert.ok(vw > 100 && vw < 102);
  const t = { side: "long", entryAt: at("09:30"), entryAvg: 100.43, qty: 100 };
  const fixed = simulate(RULES.find((r) => r.id === "fixed"), t, bars, D);
  assert.equal(fixed.how, "target", "the 1% target is reached on the way up");
  assert.ok(Math.abs(fixed.exit - 100.43 * 1.01) < 0.01);
  const close = simulate(RULES.find((r) => r.id === "close"), t, bars, D);
  assert.equal(close.how, "time");
  const trail = simulate(RULES.find((r) => r.id === "trail"), t, bars, D);
  assert.equal(trail.how, "trail");
  assert.ok(trail.exit > 102 && trail.exit < 103, "the trail rides the rise and leaves on the turn");
});

test("a day replayed: share kept, the move after the exit, the context, what-ifs, flags and the score", () => {
  const bars = dayBars();
  const trips = [
    trip({ key: "a", side: "long", in: "09:30", out: "09:45", e: 100.43, x: 100.86 }), // a small win, cut early
    trip({ key: "b", side: "short", in: "10:00", out: "10:20", e: 101.29, x: 101.86 }), // a short against the rise: a loss
    trip({ key: "c", side: "long", in: "10:25", out: "10:40", e: 102.0, x: 102.3 }), // in 5 minutes after the loss: revenge
  ];
  const lab = labDay({ date: D, trips, bars: { SBIN: bars }, limits: { stop: 1000, target: 3000 } });
  assert.equal(lab.summary.trades, 3);
  assert.equal(lab.summary.replayed, 3);
  const a = lab.trades.find((t) => t.key === "a");
  assert.ok(a.read.mfe > a.pnl, "it went further for you than you kept");
  assert.ok(a.read.capture < 100);
  assert.ok(a.read.ranOn > 0, "the price ran on after the exit");
  assert.equal(a.read.vwap > 0, true);
  const b = lab.trades.find((t) => t.key === "b");
  assert.ok(b.flags.includes("againstVwap") === false || b.read.vsVwapPct !== null);
  assert.ok(b.net < 0);
  const c = lab.trades.find((t) => t.key === "c");
  assert.ok(c.flags.includes("revenge"), "in within 10 minutes of a loss");
  assert.ok(lab.flags.some((f) => f.id === "revenge" && f.count === 1));
  // every rule replayed on the same entries, compared with your exits
  assert.deepEqual(lab.rules.map((r) => r.id), RULES.map((r) => r.id));
  assert.equal(lab.rules[0].vsActual, 0);
  assert.ok(lab.best && lab.best.id !== "actual");
  assert.ok(lab.summary.score >= 0 && lab.summary.score <= 100);
  assert.ok(["Disciplined", "Mixed", "Leaky"].includes(lab.summary.label));
});

test("after the daily stop, over-trading, overnight trades and missing bars", () => {
  const bars = dayBars();
  // seven trades in a row, entered an hour apart, each closed before the next
  const seq = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const h = 9 + i;
    const pad = (n) => String(n).padStart(2, "0");
    return trip({ key: `s${i}`, side: "long", in: `${pad(h)}:20`, out: `${pad(h)}:50`, e: 102, x: 101 });
  });
  const lab = labDay({ date: D, trips: seq, bars: { SBIN: bars }, limits: { stop: 150, target: 5000 } });
  assert.ok(lab.trades[6].flags.includes("overtrading"), "beyond the sixth trade");
  assert.ok(lab.trades[2].flags.includes("afterStop"), "after two losses of ₹120 each the ₹150 stop was passed");
  const overnight = labDay({ date: D, trips: [{ ...trip({ key: "o", side: "long", in: "10:00", out: "11:00", e: 101, x: 102 }), entryAt: Date.parse("2026-11-12T10:00:00+05:30") }], bars: { SBIN: bars } });
  assert.equal(overnight.trades[0].intraday, false);
  assert.ok(overnight.notes.some((n) => /overnight/.test(n)));
  const noBars = labDay({ date: D, trips: [trip({ key: "n", side: "long", in: "10:00", out: "10:30", e: 101, x: 102 })], bars: {} });
  assert.equal(noBars.summary.replayed, 0);
  assert.ok(noBars.notes.some((n) => /1-minute bars could not be read/.test(n)));
});

test("a period: the best exit rule on your own entries, what each habit cost, by hour, and the lessons", () => {
  const bars = dayBars();
  const days = [0, 1, 2].map(() =>
    labDay({
      date: D,
      trips: [trip({ key: "a", side: "long", in: "09:30", out: "09:40", e: 100.43, x: 100.6 }), trip({ key: "b", side: "short", in: "10:00", out: "10:30", e: 101.29, x: 102.0 }), trip({ key: "c", side: "long", in: "10:35", out: "10:45", e: 102.1, x: 102.2 })],
      bars: { SBIN: bars },
    })
  );
  const r = labRange(days);
  assert.equal(r.days, 3);
  assert.equal(r.summary.trades, 9);
  assert.ok(r.best);
  assert.ok(r.byHour.some((h) => h.hour === 10));
  assert.ok(r.flags.some((f) => f.id === "revenge" && f.count === 3));
  assert.ok(r.lessons.length >= 1);
  assert.ok(r.lessons.some((l) => /Revenge trade|would have made|kept/.test(l)));
});
