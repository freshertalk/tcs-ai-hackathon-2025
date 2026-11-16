"use strict";
// The coded set-ups (market/setups.js), the knowledge base (market/knowledge.js), the evening set-up lab
// (server/setuplab.js) and how a measured record weighs a set-up in the live score (market/scan.js).
// Synthetic bars, a fake market: no network, no order.

const test = require("node:test");
const assert = require("node:assert/strict");
const SU = require("../market/setups");
const KB = require("../market/knowledge");
const S = require("../market/scan");
const { SetupLab, SECTION } = require("../setuplab");

const at = (date, m) => Date.parse(`${date}T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00+05:30`);
/** Quiet sessions: a gentle wave around 100, 1,000 shares a bar. */
function quiet(dates) {
  const out = [];
  for (const d of dates) {
    let k = 0;
    for (let m = 555; m < 930; m += 5, k += 1) {
      const p = 100 + 0.6 * Math.sin(k / 5);
      const c = p + 0.05 * Math.sin(k);
      out.push({ t: at(d, m), o: p, h: Math.max(p, c) + 0.1, l: Math.min(p, c) - 0.1, c, v: 1000 });
    }
  }
  return out;
}
const PRIOR = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"];
const T = "2026-11-13";
const bar = (m, o, h, l, c, v) => ({ t: at(T, m), o, h, l, c, v });

/** A clean opening-range breakout at 9:35 that runs on to its target. */
function orbDay() {
  const today = [bar(555, 100.2, 101.0, 100.0, 100.6, 1500), bar(560, 100.6, 100.9, 100.2, 100.5, 1200), bar(565, 100.5, 100.8, 100.1, 100.4, 1000), bar(570, 100.4, 100.9, 100.3, 100.8, 1100), bar(575, 100.8, 101.8, 100.7, 101.6, 3000)];
  let p = 101.6;
  for (let m = 580; m < 930; m += 5) {
    const c = p + 0.35;
    today.push(bar(m, p, c + 0.1, p - 0.05, c, 1800));
    p = c;
  }
  return [...quiet(PRIOR), ...today];
}

test("an opening-range breakout is seen at the bar's close, with a stop behind the range and a 1.5R target", () => {
  const bars = orbDay();
  const P = SU.prep(bars);
  const i = P.b.findIndex((b) => b.t === at(T, 575));
  const sigs = SU.detect(P, i);
  const orb = sigs.find((s) => s.id === "orb");
  assert.ok(orb, JSON.stringify(sigs));
  assert.equal(orb.side, "long");
  assert.ok(orb.stop < orb.entry && orb.target > orb.entry);
  assert.equal(orb.rr, 1.5);
  assert.match(orb.why, /opening-range high/);
  assert.ok(P.relVol[i] >= 2.5, "volume against the same five minutes of earlier sessions");
  // before 9:30 nothing fires (the range is still forming)
  assert.deepEqual(SU.detect(P, P.b.findIndex((b) => b.t === at(T, 560))), []);
});

test("no look-ahead: a signal at bar i is the same whether or not the later bars exist", () => {
  const bars = orbDay();
  const full = SU.prep(bars);
  for (let i = 300; i < bars.length; i += 3) {
    const cut = SU.prep(bars.slice(0, i + 1));
    assert.deepEqual(SU.detect(cut, i), SU.detect(full, i), `bar ${i}`);
  }
});

test("the backtest: next bar's open, the target, charges taken off, one trade per set-up a day", () => {
  const trades = SU.backtest(orbDay(), { symbol: "TEST" });
  const orb = trades.filter((t) => t.id === "orb" && t.side === "long");
  assert.equal(orb.length, 1, "one trade per set-up, side and day");
  assert.equal(orb[0].how, "target");
  assert.ok(orb[0].costR > 0, "costs are counted");
  assert.ok(orb[0].R < orb[0].grossR && orb[0].R > 1, `R ${orb[0].R}`);
  // a day that turns straight back hits the stop
  const bad = orbDay();
  for (const b of bad) if (b.t > at(T, 575)) Object.assign(b, { o: 101.5, h: 101.55, l: 99.5, c: 99.6 });
  const lost = SU.backtest(bad, { symbol: "TEST" }).find((t) => t.id === "orb");
  assert.equal(lost.how, "stop");
  assert.ok(lost.R < -1, "a full loss plus costs");
});

test("a 2% gap up that falls back under its open and VWAP is a gap-fade short", () => {
  const prior = quiet(PRIOR);
  const pdc = prior[prior.length - 1].c;
  const o = pdc * 1.02;
  const today = [bar(555, o, o + 0.4, o - 0.3, o - 0.1, 2000), bar(560, o - 0.1, o + 0.1, o - 0.4, o - 0.2, 1500), bar(565, o - 0.2, o + 0.3, o - 0.3, o + 0.15, 1400), bar(570, o + 0.1, o + 0.15, o - 0.9, o - 0.8, 2500)];
  const P = SU.prep([...prior, ...today]);
  const sigs = SU.detect(P, P.n - 1);
  const fade = sigs.find((s) => s.id === "gap-fade");
  assert.ok(fade, JSON.stringify(sigs));
  assert.equal(fade.side, "short");
  assert.ok(fade.stop > fade.entry);
});

test("the summary by set-up and side, and how much a record counts: nothing below 30 trades, shrunk toward zero above", () => {
  const mk = (id, side, R, min = 600) => ({ id, side, R, grossR: R + 0.1, costR: 0.1, how: R > 0 ? "target" : "stop", min });
  const trades = [...Array.from({ length: 40 }, (_, k) => mk("orb", "long", k % 2 ? 1.4 : -1.1)), ...Array.from({ length: 10 }, () => mk("gap-fade", "short", -1.1, 700))];
  const sum = SU.summarize(trades);
  const orb = sum.rows.find((r) => r.key === "orb:long");
  assert.equal(orb.n, 40);
  assert.equal(orb.winPct, 50);
  assert.equal(orb.avgR, 0.15);
  assert.equal(orb.hours[0].n, 40, "by time of day");
  assert.equal(SU.edgeFactor(sum.rows.find((r) => r.key === "gap-fade:short")), null, "10 trades are too few to count");
  const ef = SU.edgeFactor(orb);
  assert.ok(ef > 0 && ef < 0.6, `shrunk: ${ef}`);
  assert.ok(SU.edgeFactor({ n: 600, avgR: -0.3 }) < -0.8);
});

test("the knowledge base: the topics that matter now, kept short, and every coded set-up described", () => {
  const txt = KB.relevant({ setups: ["orb", "gap-fade"], minute: 600, market: { score: 30 } }, 3500);
  assert.ok(txt.length <= 3500);
  assert.match(txt, /The honest odds/);
  assert.match(txt, /What a trade really costs/);
  assert.match(txt, /Time of day/);
  assert.match(txt, /Opening-range breakout/);
  assert.match(txt, /Gap fade/);
  assert.doesNotMatch(txt, /Squeeze breakout/, "only the set-ups in play");
  const all = KB.all();
  assert.deepEqual(all.setups.map((s) => s.id).sort(), Object.keys(SU.NAMES).sort(), "every coded set-up is in the knowledge base");
  assert.ok(all.topics.length >= 8);
  // never a promise
  assert.doesNotMatch(JSON.stringify(all), /guaranteed? (profit|return)|sure.?shot|sure profit|always wins/i);
});

test("a measured record weighs the set-up in the live score: paid → its way with more weight, lost → against it", () => {
  const f = { last: 101.6, atr5: 0.5, setups: [{ id: "orb", name: "Opening-range breakout", side: "long", quality: 0.8, why: "closed above the range" }] };
  const unmeasured = S.votes(f).find((v) => v.id === "setup");
  assert.equal(unmeasured.w, 6);
  assert.ok(unmeasured.v > 0);
  assert.match(unmeasured.why, /not yet measured/);
  const paid = S.votes(f, null, { "orb:long": { n: 400, winPct: 48, avgR: 0.2 } }).find((v) => v.id === "setup");
  assert.equal(paid.w, 12);
  assert.ok(paid.v > unmeasured.v);
  assert.match(paid.why, /\+0\.2R a trade after costs over 400 trades/);
  const lost = S.votes(f, null, { "orb:long": { n: 400, winPct: 30, avgR: -0.2 } }).find((v) => v.id === "setup");
  assert.ok(lost.v < 0, "a set-up that has lost money here argues against its own side");
});

test("the set-up lab: reads each stock's history, measures after costs, saves, and writes the lesson into the skills file", async () => {
  const series = { A: orbDay(), B: orbDay(), C: quiet([...PRIOR, T]) };
  let connected = true;
  let calls = 0;
  const market = {
    mode: () => "kite",
    kiteState: () => ({ connected }),
    instruments: async () => ({}),
    _instrument: async (s) => ({ t: s }),
    _call: async (fn) => fn({ historical: async (tok) => (calls++, series[tok].map((b) => ({ ...b, t: new Date(b.t).toISOString() }))) }),
  };
  const docs = { m: new Map(), read(k, d) { return this.m.has(k) ? JSON.parse(this.m.get(k)) : d; }, write(k, v) { this.m.set(k, JSON.stringify(v)); } };
  const sections = [];
  const ai = { playbook: { setSection: (h, b) => sections.push([h, b]) } };
  let clock = Date.parse("2026-11-13T11:00:00Z"); // 4:30 PM IST, Friday
  // a big enough sample for the lesson: the same day repeated over many symbols
  const uni = Array.from({ length: 24 }, (_, k) => ["A", "B", "C"][k % 3]);
  const lab = new SetupLab({ market, ai, docs, now: () => clock, log: { log() {}, error() {} }, universe: uni, gapMs: 0 });
  assert.equal(lab.view().available, false);
  await lab.run({ trigger: "asked" });
  assert.equal(calls, 24, "one history read per stock");
  const v = lab.view();
  assert.equal(v.available, true);
  assert.ok(v.trades > 0 && v.sessions >= 4 && v.stocks === 24);
  assert.match(v.basis, /next bar's open/);
  const e = lab.edges();
  assert.ok(e["orb:long"] && e["orb:long"].n >= 16);
  assert.equal(lab.brief().available, true);
  // the lesson in the trading-skills file (only set-ups with 30 trades or more are written)
  assert.ok(sections.length <= 1);
  if (sections.length) assert.equal(sections[0][0], SECTION);
  // evening: once a day by itself; not again the same day; not without Zerodha
  calls = 0;
  await lab.tick();
  assert.equal(calls, 0, "it already ran today");
  clock += 86400000 * 3; // Monday 4:30 PM
  await lab.tick();
  assert.equal(calls, 24);
  connected = false;
  assert.throws(() => lab.run(), /Connect Zerodha/);
});

test("the lab counts the exact charges: the journal's own intraday calculation (about ₹80 on ₹1 lakh each way)", () => {
  const { costOf } = require("../setuplab");
  const c = costOf(1000, 1000, 100, true); // ₹1 lakh in, ₹1 lakh out
  assert.ok(c > 70 && c < 90, `₹${c}`);
  const trades = SU.backtest(orbDay(), { symbol: "TEST", cost: costOf });
  assert.ok(trades.every((t) => t.costR > 0));
});
