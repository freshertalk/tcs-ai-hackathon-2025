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

/* ------------------------------------------------------------------ the set-ups added from published research */
const idsAt = (bars, m) => {
  const P = SU.prep(bars);
  const i = P.b.findIndex((b) => b.t === at(T, m));
  return SU.detect(P, i);
};

test("orb5: the first 5-minute bar of a stock in play, broken in that candle's own direction — and only then", () => {
  // a green first bar on three times its usual volume, its high taken out at 9:20
  const inPlay = [...quiet(PRIOR), bar(555, 100.0, 100.8, 99.9, 100.7, 3000), bar(560, 100.7, 101.3, 100.6, 101.2, 2000)];
  const hit = idsAt(inPlay, 560).find((s) => s.id === "orb5");
  assert.ok(hit, "it fires at 9:20, before the 9:30 start of every other set-up");
  assert.equal(hit.side, "long");
  assert.equal(hit.rr, 3, "the winner is left to run, as in the paper");
  assert.match(hit.why, /in play \(3× its usual opening volume\).*first 5-minute bar's high/);
  assert.equal(hit.name, "5-minute opening range (stock in play)");
  assert.deepEqual(idsAt(inPlay, 560).map((s) => s.id), ["orb5"], "nothing else is read this early");
  // the same break on ordinary volume is not a stock in play
  const ordinary = [...quiet(PRIOR), bar(555, 100.0, 100.8, 99.9, 100.7, 1100), bar(560, 100.7, 101.3, 100.6, 101.2, 2000)];
  assert.ok(!idsAt(ordinary, 560).some((s) => s.id === "orb5"));
  // a RED first bar is never bought above its high: only its low may be sold
  const red = [...quiet(PRIOR), bar(555, 100.7, 100.8, 99.9, 100.0, 3000), bar(560, 100.0, 101.3, 99.95, 101.2, 2000)];
  assert.ok(!idsAt(red, 560).some((s) => s.id === "orb5"));
  const redBreak = [...quiet(PRIOR), bar(555, 100.7, 100.8, 99.9, 100.0, 3000), bar(560, 100.0, 100.1, 99.3, 99.4, 2000)];
  assert.equal(idsAt(redBreak, 560).find((s) => s.id === "orb5").side, "short");
  // after 10:30 the opening bar is old news
  const late = [...quiet(PRIOR), bar(555, 100.0, 100.8, 99.9, 100.7, 3000)];
  for (let m = 560; m <= 635; m += 5) late.push(bar(m, 100.5, 100.75, 100.4, 100.6, 900));
  late.push(bar(640, 100.6, 101.4, 100.5, 101.3, 2500));
  assert.ok(!idsAt(late, 640).some((s) => s.id === "orb5"));
});

test("noise-break: beyond the stock's own usual distance from the open for that time of day, at a half-hour mark, on VWAP's side", () => {
  const P0 = SU.prep(quiet([...PRIOR, T]));
  const i0 = P0.b.findIndex((b) => b.t === at(T, 595));
  assert.ok(P0.noise[i0] > 0.004 && P0.noise[i0] < 0.009, `the usual distance from the open at 10:00 is measured from the sessions before: ${P0.noise[i0]}`);
  assert.equal(SU.prep(quiet([PRIOR[0], T])).noise.filter((x) => x !== null).length, 0, "too few earlier sessions: no boundary, no signal");
  // a steady climb that leaves the noise area by 10:00
  const today = [];
  let p = 100.4;
  for (let m = 555; m <= 600; m += 5) {
    today.push(bar(m, p, p + 0.2, p - 0.03, p + 0.17, 1500));
    p += 0.17;
  }
  const bars = [...quiet(PRIOR), ...today];
  const hit = idsAt(bars, 595).find((s) => s.id === "noise-break");
  assert.ok(hit, "it fires on the bar that closes at 10:00");
  assert.equal(hit.side, "long");
  assert.equal(hit.rr, 3);
  assert.match(hit.why, /above its usual range for this time of day/);
  assert.ok(!idsAt(bars, 590).some((s) => s.id === "noise-break"), "only on a half-hour mark");
  // inside the area (an ordinary morning) there is nothing to follow
  assert.ok(!idsAt(quiet([...PRIOR, T]), 595).some((s) => s.id === "noise-break"));
});

test("cpr-break: only after a balanced day (a narrow pivot range), beyond both that range and the opening range", () => {
  const today = [bar(555, 100.0, 100.4, 99.9, 100.2, 1200), bar(560, 100.2, 100.4, 100.0, 100.3, 1000), bar(565, 100.3, 100.4, 100.1, 100.2, 1000), bar(570, 100.2, 100.4, 100.1, 100.3, 1000), bar(575, 100.3, 101.0, 100.25, 100.9, 3000)];
  // yesterday closed at the middle of its range: pivot, top and bottom coincide
  const balanced = quiet(PRIOR);
  const last = balanced[balanced.length - 1];
  const yb = balanced.filter((b) => b.t >= at(PRIOR[3], 555));
  const mid = (Math.max(...yb.map((b) => b.h)) + Math.min(...yb.map((b) => b.l))) / 2;
  last.c = mid;
  last.h = Math.max(last.h, mid);
  last.l = Math.min(last.l, mid);
  const hit = idsAt([...balanced, ...today], 575).find((s) => s.id === "cpr-break");
  assert.ok(hit && hit.side === "long", "the first close beyond both lines, on volume, above VWAP");
  assert.match(hit.why, /narrow pivot range/);
  // the same morning after a day that closed near its high (a wide pivot range) is not this set-up
  const wide = quiet(PRIOR);
  const w = wide[wide.length - 1];
  w.c = Math.max(...wide.filter((b) => b.t >= at(PRIOR[3], 555)).map((b) => b.h));
  assert.ok(!idsAt([...wide, ...today], 575).some((s) => s.id === "cpr-break"));
});

test("the new set-ups are named, described with their source and their limits, and measured by the same backtest", () => {
  for (const id of ["orb5", "noise-break", "cpr-break"]) {
    assert.ok(SU.NAMES[id], id);
    assert.ok(KB.SETUP_NOTES[id] && KB.SETUP_NOTES[id].rules.length > 80 && KB.SETUP_NOTES[id].avoid, id);
  }
  assert.match(KB.SETUP_NOTES.orb5.rules, /Zarattini, Barbon & Aziz/);
  assert.match(KB.SETUP_NOTES["noise-break"].rules, /Zarattini, Aziz & Barbon/);
  assert.match(KB.SETUP_NOTES["cpr-break"].avoid, /No published study/);
  // a stock in play that keeps going: the backtest enters at the next bar's open and lets it run to 3R
  const day = [bar(555, 100.0, 100.8, 99.9, 100.7, 3000), bar(560, 100.7, 101.3, 100.6, 101.2, 2000)];
  let p = 101.2;
  for (let m = 565; m < 930; m += 5) {
    day.push(bar(m, p, p + 0.3, p - 0.04, p + 0.25, 1500));
    p += 0.25;
  }
  const trades = SU.backtest([...quiet(PRIOR), ...day], { symbol: "TEST" });
  const t = trades.find((x) => x.id === "orb5");
  assert.ok(t && t.side === "long" && t.how === "target" && t.grossR > 2.9, JSON.stringify(t));
  assert.ok(SU.summarize(trades).rows.some((r) => r.id === "orb5" && r.name === "5-minute opening range (stock in play)"));
});
