"use strict";
// The consensus forecast: one level forecast for 5 and 15 minutes, made from the forecaster, the evidence desk, the early
// calls and the order book; kept, checked, learned; the blend leads only once its record beats the forecaster alone.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const C = require("../market/consensus");
const { Consensus, CALLS, SECTION } = require("../consensus");
const { FileDocs } = require("../docs");

const quiet = { log() {}, error() {} };
const IST = 5.5 * 3600 * 1000;
const at = (date, hhmm) => Date.parse(`${date}T${hhmm}:00Z`) - IST;
const BAR = 5 * 60000;
const mkdocs = () => new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-cons-")));

// a little seeded randomness, so the test is the same every run
let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

/** A made-up market: the forecaster's guess is noise, the evidence desk's edge is what really moves the price. */
function world() {
  const truth = new Map(); // `${sym}|${anchorEnd}` → { zHz, edge, y: {1, 3} }
  let now = 0;
  const sigma = 0.2;
  const price = 100;
  const cell = (sym, end) => {
    const k = `${sym}|${end}`;
    if (!truth.has(k)) {
      const edge = rnd() * 2 - 1;
      const zHz = gauss() * 0.5;
      truth.set(k, { zHz, edge, y: { 1: 0.8 * edge + gauss() * 0.3, 3: 0.8 * edge + gauss() * 0.3 } });
    }
    return truth.get(k);
  };
  const anchorOf = (t) => Math.floor(t / BAR) * BAR;
  const horizon = {
    async view(sym) {
      const end = anchorOf(now);
      const c = cell(sym, end);
      const horizons = [1, 2, 3, 4, 6].map((h) => {
        const s = sigma * Math.sqrt(h);
        const pct = c.zHz * s;
        return { minutes: h * 5, at: new Date(end + h * BAR).toISOString(), pct, price: Math.round(price * (1 + pct / 100) * 20) / 20, low: price * (1 + (pct - 1.04 * s) / 100), high: price * (1 + (pct + 1.04 * s) / 100), pUp: C.phi(c.zHz) };
      });
      return { available: true, trained: true, anchor: { at: new Date(end).toISOString(), price }, sigmaPct: sigma, horizons, levels: [{ name: "Day high", price: 100.6, side: "above", distPct: 0.6, p15: 0.4, p30: 0.6 }, { name: "VWAP", price: 99.7, side: "below", distPct: -0.3, p15: 0.55, p30: 0.7 }], live: null };
    },
    async barsFor(sym, date) {
      const out = [];
      for (const [k, c] of truth) {
        const [s, endS] = k.split("|");
        const end = Number(endS);
        if (s !== sym || new Date(end + IST).toISOString().slice(0, 10) !== date) continue;
        const startOf = (h) => end - BAR + h * BAR; // the bar h after the anchor bar
        out.push({ t: startOf(0), o: price, h: price, l: price, c: price, v: 1 });
        for (const h of [1, 3]) {
          const cl = price * (1 + (c.y[h] * sigma * Math.sqrt(h)) / 100);
          out.push({ t: startOf(h), o: cl, h: cl, l: cl, c: cl, v: 1 });
        }
      }
      return out.sort((a, b) => a.t - b.t);
    },
    watching: () => ["AAA", "BBB"],
  };
  const evidence = {
    async view(sym) {
      const c = cell(sym, anchorOf(now));
      const pUp = 0.5 + c.edge * 0.4;
      return { available: true, trained: true, calls: [5, 15].map((m) => ({ minutes: m, pUp, pDown: 1 - pUp, lean: c.edge > 0 ? "up" : "down", tier: "clear" })) };
    },
  };
  const ahead = { async view() { return { available: true, move: { dir: "up", on: false }, horizons: [{ key: "5", follow: { p: 0.5, usual: 0.5 }, reversal: { p: 0.4, usual: 0.4 }, momentum: { state: "steady", big: { p: 0.2, usual: 0.2 }, calm: { p: 0.2, usual: 0.2 } }, read: "Nothing unusual ahead.", tone: "none" }] }; } };
  const market = { mode: () => "kite", async quotes(list) { return { quotes: Object.fromEntries(list.map((s) => [s, { buyQty: 5000, sellQty: 5000 }])) }; } };
  return { horizon, evidence, ahead, market, setNow: (t) => (now = t), get now() { return now; } };
}

test("the arithmetic: the blend starts as the forecaster alone, and learns what the checks show", () => {
  const m = C.emptyModel();
  const x = C.inputsOf({ hz: { pct: 0.1, low: 99.7, high: 100.5, pUp: 0.6, price: 100.1 }, sigmaPct: 0.2, h: 1, ev: { pUp: 0.7, pDown: 0.2 }, early: { run: true, dir: 1, follow: { p: 0.6, usual: 0.5 }, reversal: { p: 0.3, usual: 0.4 } }, book: { buyQty: 700, sellQty: 300 } });
  assert.deepEqual(x, [1, 0.5, 0.5, 0.8, 0.4]);
  const f = C.forecastOf(m, 1, x, { price: 100, sigmaPct: 0.2, hz: { pct: 0.1, low: 99.7, high: 100.5, pUp: 0.6, price: 100.1 } });
  assert.equal(f.blend.pct, 0.1, "with no checks the blend says what the forecaster says");
  assert.equal(f.proven, false);
  assert.equal(C.volMultOf({ momentum: { big: { p: 0.4, usual: 0.2 }, calm: { p: 0.1, usual: 0.2 } } }), 1.2);
  assert.equal(C.volMultOf({ momentum: { big: { p: 0.1, usual: 0.2 }, calm: { p: 0.4, usual: 0.2 } } }), 0.85);
  assert.deepEqual(C.solve([[2, 0], [0, 4]], [2, 8]), [1, 2]);
  assert.equal(C.solve([[0, 0], [0, 0]], [1, 1]), null);
});

test("a forecast for 5 and 15 minutes, led by the forecaster until the blend has proved itself; kept once per bar", async () => {
  const w = world();
  const docs = mkdocs();
  const cs = new Consensus({ horizon: w.horizon, evidence: w.evidence, ahead: w.ahead, market: w.market, now: () => w.now, docs, log: quiet, isTradingDay: () => true });
  w.setNow(at("2026-11-19", "10:05"));
  const v = await cs.view("AAA");
  assert.equal(v.available, true);
  assert.deepEqual(v.horizons.map((h) => [h.key, h.minutes, h.leads]), [["5", 5, "forecaster"], ["15", 15, "forecaster"]]);
  const h15 = v.horizons[1];
  assert.equal(h15.price, h15.forecaster.price, "the forecaster's numbers lead");
  assert.equal(h15.parts.book.buyShare, 0.5);
  assert.ok(h15.parts.evidence.pUp > 0 && h15.parts.evidence.pUp < 1);
  assert.equal(h15.record.checks, 0);
  assert.equal(v.firstUp.name, "Day high");
  assert.equal(v.firstDown.name, "VWAP");
  assert.match(v.headline, /^AAA in \d+ min: about ₹[\d.]+ \(likely between ₹[\d.]+ and ₹[\d.]+\) from ₹100 — .+; led by the forecaster \(the blend is still proving itself\)\.$/);
  cs._flush();
  assert.equal(docs.items(CALLS).length, 1);
  // the same bar again: no second record
  cs._cache.clear();
  await cs.view("AAA");
  cs._flush();
  assert.equal(docs.items(CALLS).length, 1);
  await assert.rejects(cs.view("not a symbol!"), /not a valid symbol/);
});

test("checked forecasts teach the blend; once its record beats the forecaster alone it leads — and writes its rules into the skills file", async () => {
  const w = world();
  const docs = mkdocs();
  const written = {};
  const playbook = { setSection: (head, body) => (written[head] = body) };
  const cs = new Consensus({ horizon: w.horizon, evidence: w.evidence, ahead: w.ahead, market: w.market, now: () => w.now, docs, playbook, log: quiet, isTradingDay: () => true });
  const dates = ["2026-11-12", "2026-11-13", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"];
  const syms = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"];
  for (const date of dates) {
    for (const hhmm of ["10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30"]) {
      const t = at(date, hhmm);
      w.setNow(t);
      cs._cache.clear();
      for (const s of syms) await cs.view(s);
      w.setNow(t + 3 * BAR + 30000);
      await cs.score();
    }
  }
  const rec = cs.record();
  assert.ok(rec["15"].checks >= 150 && rec["15"].days === 6, JSON.stringify(rec["15"]));
  assert.equal(rec["15"].proven, true, "the blend misses less than the forecaster alone");
  assert.ok(rec["15"].blend.missAvg < rec["15"].forecaster.missAvg * 0.9);
  assert.ok(rec["15"].weights.evidence > 0.4, "the weight moved to the evidence desk, which really predicts the move");
  assert.ok(Math.abs(rec["15"].weights.forecaster) < 0.5, "and away from the forecaster's noise");
  w.setNow(at("2026-11-20", "10:05"));
  cs._cache.clear();
  const v = await cs.view("S1");
  assert.equal(v.horizons[1].leads, "blend");
  assert.equal(v.horizons[1].price, v.horizons[1].blend.price);
  assert.match(v.headline, /led by the consensus/);
  // the model and the records are kept
  assert.ok(docs.read("market/consensus-model.json", null).h[3].n > 100);
  assert.ok(docs.items(CALLS).filter((r) => r.settled).length > 100);
  // the rules and the record go into the trading-skills file
  assert.equal(cs.teach(), true);
  assert.match(written[SECTION], /blend LEADS/);
  assert.match(written[SECTION], /Delivery \(published by NSE after the close\)/);
});

test("the sweep forecasts the stocks followed live; outside the session it does nothing", async () => {
  const w = world();
  const cs = new Consensus({ horizon: w.horizon, evidence: w.evidence, ahead: w.ahead, market: w.market, now: () => w.now, docs: mkdocs(), log: quiet, isTradingDay: () => true });
  w.setNow(at("2026-11-19", "10:05") + 50000);
  await cs.tickOnce();
  assert.equal(cs.board().today, 2);
  const cs2 = new Consensus({ horizon: w.horizon, evidence: w.evidence, ahead: w.ahead, market: w.market, now: () => w.now, docs: mkdocs(), log: quiet, isTradingDay: () => true });
  w.setNow(at("2026-11-19", "08:00"));
  await cs2.tickOnce();
  assert.equal(cs2.board().kept, 0);
});

test("the refiner rides on every forecast: the top of the book, today's volatility, its own record — kept, checked and learned, and leading nothing until proven", async () => {
  const w = world();
  w.market.quotes = async (list) => ({ quotes: Object.fromEntries(list.map((s) => [s, { buyQty: 5000, sellQty: 5000, bid: 99.95, ask: 100.05, bidQty: 3000, askQty: 1000 }])) });
  const docs = mkdocs();
  const written = {};
  const cs = new Consensus({ horizon: w.horizon, evidence: w.evidence, ahead: w.ahead, market: w.market, now: () => w.now, docs, playbook: { setSection: (h, b) => (written[h] = b) }, log: quiet, isTradingDay: () => true });
  for (const hhmm of ["10:00", "10:30", "11:00", "11:30"]) {
    w.setNow(at("2026-11-19", hhmm));
    cs._cache.clear();
    for (const s of ["S1", "S2", "S3"]) await cs.view(s);
    w.setNow(at("2026-11-19", hhmm) + 3 * BAR + 30000);
    await cs.score();
  }
  w.setNow(at("2026-11-19", "12:05"));
  cs._cache.clear();
  const v = await cs.view("S1");
  assert.equal(v.topOfBook.microprice, 100.03, "the heavy bid queue pulls the fair price up");
  assert.ok(v.volatility && v.volatility.ratio > 0 && /session/.test(v.volatility.read), JSON.stringify(v.volatility));
  const h15 = v.horizons[1];
  assert.equal(h15.refined, false, "in trial: nothing changed");
  assert.equal(h15.price, h15.forecaster.price);
  assert.deepEqual(h15.refine.leads, { mean: false, band: false, bandBy: null });
  assert.ok(h15.refine.record.checks > 0, "it learned from the checks");
  assert.equal(h15.refine.contributions.length, 5);
  cs._flush();
  assert.ok(docs.items(CALLS).some((r) => r.rf && r.rf[3] && Array.isArray(r.rf[3].x)), "kept with the forecast");
  assert.ok(docs.read("market/consensus-model.json", null).refine.h[3].n > 0, "saved with the blend");
  assert.ok(cs.record()["15"].refine.checks > 0);
  cs.teach();
  assert.match(written[SECTION], /The refiner, a second stage/);
  assert.match(written[SECTION], /Refiner, 15 minutes: \d+ checks/);
});

test("the multi-day volatility: fitted from the stored sessions, read as today's prior, kept with each forecast for the second band", async () => {
  const w = world();
  // a stored history for the model to learn from: 12 stocks, 80 sessions of 5-minute bars whose volatility persists
  const hist = {};
  for (let i = 0; i < 12; i += 1) {
    let lv = 0;
    let c = 100;
    hist[`H${i}`] = Array.from({ length: 80 }, (_, d) => {
      lv = 0.85 * lv + 0.35 * gauss();
      const day = new Date(Date.UTC(2026, 7, 1) + d * 86400000).toISOString().slice(0, 10);
      const start = Date.parse(`${day}T03:45:00Z`);
      return [day, Array.from({ length: 75 }, (__, s) => {
        const o = c;
        c = o * Math.exp(0.002 * Math.exp(lv) * gauss());
        return { t: start + s * BAR, o, h: Math.max(o, c), l: Math.min(o, c), c, v: 1 };
      })];
    });
  }
  w.horizon.storedSymbols = () => Object.keys(hist);
  w.horizon.storedSessions = (s) => hist[s] || [];
  const docs = mkdocs();
  const cs = new Consensus({ horizon: w.horizon, evidence: w.evidence, ahead: w.ahead, market: w.market, now: () => w.now, docs, log: quiet, isTradingDay: () => true });
  w.setNow(at("2026-11-19", "16:00"));
  const m = await cs.refreshVol();
  assert.ok(m && m.stocks === 12 && m.season.length === 75 && m.judge.n > 0, JSON.stringify(m && m.judge));
  assert.equal(docs.read("market/vol-model.json", null).fittedOn, "2026-11-19");
  // a forecast for S1 the next session, with the model's forecast for it
  cs._vol = { ...m, forecasts: { S1: { ratio: 1.8, after: "2026-11-19" } } };
  w.setNow(at("2026-11-20", "10:05"));
  cs._cache.clear();
  const v = await cs.view("S1");
  assert.equal(v.volatility.expected, 1.8);
  assert.match(v.volatility.outlook, /wilder session than usual/);
  assert.ok(v.volatility.day > 0);
  cs._flush();
  const kept = docs.items(CALLS).find((r) => r.symbol === "S1" && r.date === "2026-11-20");
  assert.ok(kept && kept.rf[3] && kept.rf[3].scale2 > 0, "the multi-day scale is kept with the forecast, for its band's record");
  // the evening refit runs by itself after the close
  cs._vol = undefined;
  docs.write("market/vol-model.json", null);
  w.setNow(at("2026-11-20", "15:50"));
  await cs.tickOnce();
  assert.equal(cs.volModel().fittedOn, "2026-11-20");
});
