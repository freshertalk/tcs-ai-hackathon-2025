"use strict";
// The live scanner's engine (market/scan.js): the buffer, the readings, the score, the next-move lean,
// eligibility, the plan and the record. Synthetic bars and ticks: no network, no order.

const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../market/scan");

const IST = 5.5 * 3600 * 1000;
const at = (date, hhmm) => Date.parse(`${date}T${hhmm}:00+05:30`);

/** 5-minute bars for whole sessions, each bar moving `step` from the last (a trend), with a small wobble. */
function sessions(dates, { start = 1000, step = 0.6, vol = 10000, wobble = 0.3 } = {}) {
  const out = [];
  let p = start;
  for (const d of dates) {
    for (let m = 555; m < 930; m += 5) {
      const t = at(d, `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
      const o = p;
      // a trend with pullbacks (two steps forward, one back), as real tapes move
      const c = p + step * [1.8, -0.7, 1.5, -0.6][out.length % 4];
      const w = (out.length % 3) * wobble;
      out.push({ t, o, h: Math.max(o, c) + 0.4 + w, l: Math.min(o, c) - 0.4 - w, c, v: vol });
      p = c;
    }
  }
  return out;
}
const daily = (n, { start = 900, step = 2 } = {}) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.parse("2026-06-01T00:00:00Z") + i * 86400000).toISOString().slice(0, 10);
    const c = start + i * step;
    return { t: d, o: c - 1, h: c + 4, l: c - 5, c, v: 2000000 };
  });

/** A stock in the buffer at `now`, bars up to now from `bars`, a tick on top. */
function stock({ symbol = "TEST", bars, now, tick = {}, dailyRows = null }) {
  const st = S.newState(symbol, 1);
  S.seed(st, bars.filter((b) => b.t <= now), now);
  if (dailyRows) st.daily = S.dailyContext(dailyRows, S.istDate(now));
  const lastBar = bars.filter((b) => b.t <= now).pop();
  S.addTick(st, { last: lastBar.c, volume: 1500000, avgPrice: lastBar.c - 3, open: lastBar.c - 20, high: lastBar.c + 0.5, low: lastBar.c - 25, prevClose: lastBar.c - 22, buyQty: 70000, sellQty: 30000, ...tick, at: now }, now);
  return st;
}

test("ticks build 5-minute bars: open, high, low, close, and volume from the day's running total", () => {
  const st = S.newState("SBIN", 779521);
  const d = "2026-11-16";
  S.addTick(st, { last: 100, volume: 5000, at: at(d, "09:15") + 10000 }, 0);
  S.addTick(st, { last: 102, volume: 5600, at: at(d, "09:16") }, 0);
  S.addTick(st, { last: 99, volume: 6100, at: at(d, "09:19") + 59000 }, 0);
  assert.equal(st.bars.length, 0);
  assert.deepEqual([st.forming.o, st.forming.h, st.forming.l, st.forming.c, st.forming.v], [100, 102, 99, 99, 1100]);
  S.addTick(st, { last: 101, volume: 6500, at: at(d, "09:20") + 5000 }, 0);
  assert.equal(st.bars.length, 1);
  assert.deepEqual(st.bars[0], { t: at(d, "09:15"), o: 100, h: 102, l: 99, c: 99, v: 1100 });
  assert.equal(st.forming.t, at(d, "09:20"));
  assert.equal(st.forming.v, 400); // 6 500 − 6 100: the new bar starts where the last one ended
  // outside the session: the quote is kept, no bar is made
  S.addTick(st, { last: 105, volume: 9000, at: at(d, "15:45") }, 0);
  assert.equal(st.tick.last, 105);
  assert.equal(st.bars.length, 1);
});

test("seeding from Zerodha's history: its time format is read, and the current bar carries on from the ticks", () => {
  const st = S.newState("INFY", 408065);
  const now = at("2026-11-16", "10:02");
  S.seed(st, [
    { t: "2026-11-16T09:50:00+0530", o: 10, h: 11, l: 9, c: 10.5, v: 100 },
    { t: "2026-11-16T09:55:00+0530", o: 10.5, h: 12, l: 10, c: 11.5, v: 200 },
    { t: "2026-11-16T10:00:00+0530", o: 11.5, h: 12.5, l: 11, c: 12, v: 300 },
  ], now);
  assert.equal(st.bars.length, 2);
  assert.equal(st.forming.t, at("2026-11-16", "10:00"));
  // the first tick on the seeded bar fixes where its volume started
  S.addTick(st, { last: 12.2, volume: 50300, at: now }, now);
  S.addTick(st, { last: 12.4, volume: 50400, at: now + 1000 }, now + 1000);
  assert.equal(st.forming.v, 400);
  assert.equal(st.forming.h, 12.5);
  assert.equal(st.forming.c, 12.4);
});

test("a steady uptrend above VWAP, ahead of the NIFTY, on volume: a strong UP lean and an eligible long with a plan", () => {
  const bars = sessions(["2026-11-12", "2026-11-13", "2026-11-16"]);
  const now = at("2026-11-16", "10:32");
  const st = stock({ bars, now, dailyRows: daily(80) });
  const nifty = { ready: true, chgPct: 0.3, ret30: 0.05 };
  const r = S.read(st, { now, nifty, market: { score: 30 } });
  assert.equal(r.ready, true);
  assert.ok(r.score >= 50, `score ${r.score}`);
  assert.ok(r.agree >= 0.75, `agree ${r.agree}`);
  assert.equal(r.next.dir, "up");
  assert.equal(r.next.strength, "strong");
  assert.ok(r.next.rangeLow < r.f.last && r.next.rangeHigh > r.f.last);
  assert.ok(r.reasons.length >= 4);
  assert.ok(r.reasons.some((x) => x.id === "vwap") && r.reasons.some((x) => x.id === "ema") && r.reasons.some((x) => x.id === "supertrend"));
  // every reading is there
  for (const k of ["vwap", "ema9", "ema21", "rsi", "macdHist", "supertrend", "adx", "atr5", "bbPctB", "orh", "orl", "pdh", "pdl", "relVol", "rsNifty", "bookBuyPct"]) assert.notEqual(r.f[k], null, k);
  assert.equal(r.f.orb, "above");
  assert.deepEqual(r.blocks, []);
  assert.equal(r.eligible, true);
  assert.equal(r.side, "long");
  const p = r.plan;
  assert.ok(p.stop < p.entry && p.t1 > p.entry && p.t2 > p.t1);
  assert.ok(p.risk >= 0.4 * r.f.atr5 - 1e-9 && p.risk <= 1.6 * r.f.atr5 + 1e-9, "the stop is 0.4–1.6 ATR away");
  assert.equal(Math.round(((p.t1 - p.entry) / p.risk) * 10) / 10, 1.5);
});

test("the same stock is not eligible before 9:30 or after 2:45 — the rule is named", () => {
  const bars = sessions(["2026-11-12", "2026-11-13", "2026-11-16"]);
  for (const [hhmm, words] of [["09:22", /before 9:30/], ["14:55", /after 2:45/]]) {
    const now = at("2026-11-16", hhmm);
    const r = S.read(stock({ bars, now, dailyRows: daily(80) }), { now, nifty: { ready: true, chgPct: 0.3, ret30: 0.05 } });
    assert.equal(r.eligible, false, hhmm);
    assert.ok(r.blocks.some((b) => words.test(b)), `${hhmm}: ${r.blocks.join("; ")}`);
  }
});

test("a downtrend below VWAP, behind the NIFTY: a DOWN lean and an eligible short", () => {
  const bars = sessions(["2026-11-12", "2026-11-13", "2026-11-16"], { start: 1300, step: -0.6 });
  const now = at("2026-11-16", "11:02");
  const last = bars.filter((b) => b.t <= now).pop().c;
  const st = stock({ bars, now, dailyRows: daily(80, { start: 1500, step: -2 }), tick: { avgPrice: last + 3, open: last + 20, high: last + 25, low: last - 0.5, prevClose: last + 22, buyQty: 25000, sellQty: 75000 } });
  const r = S.read(st, { now, nifty: { ready: true, chgPct: 0.1, ret30: 0 }, market: { score: -20 } });
  assert.equal(r.next.dir, "down");
  assert.equal(r.side, "short");
  assert.equal(r.eligible, true, r.blocks.join("; "));
  assert.ok(r.plan.stop > r.plan.entry && r.plan.t1 < r.plan.entry);
});

test("a flat, choppy stock has no side; a long against a market leaning hard down needs stronger evidence", () => {
  const chop = [];
  const dates = ["2026-11-12", "2026-11-13", "2026-11-16"];
  for (const d of dates) for (let m = 555; m < 930; m += 5) {
    const t = at(d, `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
    const c = 500 + (chop.length % 2 ? 0.5 : -0.5);
    chop.push({ t, o: 500, h: 501, l: 499, c, v: 10000 });
  }
  const now = at("2026-11-16", "11:30");
  const r = S.read(stock({ bars: chop, now, tick: { avgPrice: 500, open: 500, high: 501, low: 499, prevClose: 500, buyQty: 50000, sellQty: 50000, last: 500 } }), { now });
  assert.equal(r.eligible, false);
  assert.ok(Math.abs(r.score) < 35, `score ${r.score}`);
  // the uptrend again, but the market leans hard down and the evidence is not strong enough
  const bars = sessions(dates, { step: 0.25 });
  const now2 = at("2026-11-16", "10:32");
  const e = S.eligibility({ ...S.features(stock({ bars, now: now2, dailyRows: daily(80) }), { now: now2 }), at: now2 }, { score: 40, agree: 0.8 }, { dir: "up" }, { score: -60 });
  assert.ok(e.blocks.some((b) => /against a market leaning down/.test(b)), e.blocks.join("; "));
});

test("stretched: an RSI over 78 or a price far from VWAP keeps a long out", () => {
  const f = { at: at("2026-11-16", "11:00"), last: 110, vwap: 100, vsVwapAtr: 4, rsi: 84, adx: 30, orb: "above", relVol: 2, turnoverCr: 500, atr5: 2.5, swingLow: 108, supertrend: 1, supertrendLine: 107, dayHigh: 110.5, pivots: null, tickAge: 1 };
  const e = S.eligibility(f, { score: 70, agree: 0.9 }, { dir: "up" });
  assert.equal(e.eligible, false);
  assert.ok(e.blocks.some((b) => /RSI 84/.test(b)));
  assert.ok(e.blocks.some((b) => /4 ATR from VWAP/.test(b)));
});

test("the record: a call followed to its target, its stop or thirty minutes; leans checked fifteen minutes on", () => {
  const rec = S.newRecord("2026-11-16");
  const t0 = at("2026-11-16", "10:00");
  const mk = (symbol, side, entry, stop, t1) => S.openCall(rec, { symbol, side, score: 60, agree: 0.8, reasons: [{ id: "vwap" }], plan: { entry, stop, t1 } }, t0);
  mk("A", "long", 100, 99, 101.5);
  mk("B", "short", 200, 202, 197);
  mk("C", "long", 50, 49, 51.5);
  const px = { A: 101.6, B: 202.5, C: 50.2 };
  S.followCalls(rec, (s) => px[s], t0 + 5 * 60000);
  assert.equal(rec.calls.find((c) => c.symbol === "A").outcome, "target");
  assert.equal(rec.calls.find((c) => c.symbol === "B").outcome, "stop");
  assert.equal(rec.calls.find((c) => c.symbol === "C").outcome, null);
  S.followCalls(rec, (s) => px[s], t0 + 31 * 60000);
  assert.equal(rec.calls.find((c) => c.symbol === "C").outcome, "time");
  const sum = S.recordSummary(rec);
  assert.equal(sum.targets, 1);
  assert.equal(sum.stops, 1);
  assert.equal(sum.timedOut, 1);
  assert.equal(sum.hitPct, 50);
  // leans
  S.addLeans(rec, [{ ready: true, symbol: "A", next: { dir: "up", strength: "strong" }, f: { last: 100, atr5: 1 } }, { ready: true, symbol: "B", next: { dir: "down", strength: "strong" }, f: { last: 200, atr5: 1 } }, { ready: true, symbol: "C", next: { dir: "flat" }, f: { last: 50, atr5: 1 } }], t0);
  S.settleLeans(rec, (s) => ({ A: 100.5, B: 200.5 })[s], t0 + 10 * 60000);
  assert.equal(rec.leans.length, 2, "not yet: fifteen minutes");
  S.settleLeans(rec, (s) => ({ A: 100.5, B: 200.5 })[s], t0 + 16 * 60000);
  assert.deepEqual(rec.leanStats.strong, { n: 2, right: 1, wrong: 1 });
  assert.equal(S.recordSummary(rec).lean.strong.rightPct, 50);
});

test("the market's lean: the NIFTY's own reading and the breadth of the hundred", () => {
  const rows = [
    { ready: true, f: { chgPct: 1, vwap: 9, last: 10, ema9: 2, ema21: 1 } },
    { ready: true, f: { chgPct: 0.5, vwap: 9, last: 10, ema9: 2, ema21: 1 } },
    { ready: true, f: { chgPct: -0.2, vwap: 11, last: 10, ema9: 1, ema21: 2 } },
    { ready: false },
  ];
  const m = S.marketLean({ ready: true, score: 40, agree: 0.8, next: { dir: "up" }, f: { last: 24000, chgPct: 0.5, rsi: 60, adx: 25, supertrend: 1, orb: "above" }, reasons: [] }, rows);
  assert.equal(m.breadth.n, 3);
  assert.equal(m.breadth.advancing, 2);
  assert.equal(m.breadth.aboveVwap, 2);
  assert.ok(m.breadth.score > 0);
  assert.ok(m.score > 0 && m.dir === "up");
  assert.equal(m.nifty.score, 40);
});
