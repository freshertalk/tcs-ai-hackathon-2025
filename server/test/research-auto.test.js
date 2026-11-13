"use strict";
// Research that runs by itself: when it is due, that it runs once, and what it costs.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ResearchAuto, dueRun } = require("../research-auto");
const { FileDocs } = require("../docs");
const { buildDirection } = require("../market/direction");

const IST = (date, hh, mm) => Date.parse(`${date}T00:00:00Z`) + (hh * 60 + mm - 330) * 60000;

test("due before the open and after the close, on weekdays, once a day each", () => {
  assert.deepEqual(dueRun(IST("2026-11-13", 8, 45)), { phase: "pre", date: "2026-11-13" }); // Friday
  assert.equal(dueRun(IST("2026-11-13", 8, 44)), null);
  assert.equal(dueRun(IST("2026-11-13", 10, 0)), null, "not during the session");
  assert.deepEqual(dueRun(IST("2026-11-13", 16, 5)), { phase: "post", date: "2026-11-13" });
  assert.equal(dueRun(IST("2026-11-13", 16, 5), { post: "2026-11-13" }), null, "already ran today");
  assert.equal(dueRun(IST("2026-11-14", 8, 50)), null, "Saturday");
});

test("a due run starts research once, data only unless AI notes are switched on", () => {
  const docs = new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-auto-")));
  let now = IST("2026-11-13", 8, 46);
  const started = [];
  const ai = { configured: () => true, research: { start: (o) => started.push(o) } };
  const auto = new ResearchAuto({ ai, market: { mode: () => "kite" }, docs, now: () => now, log: { log() {} } });
  assert.equal(auto.tick().phase, "pre");
  assert.equal(auto.tick(), null, "not twice");
  assert.deepEqual(started[0], { phase: "pre", useAi: false, news: false, world: false });
  auto.set({ withAi: true });
  now = IST("2026-11-13", 16, 1);
  auto.tick();
  assert.deepEqual(started[1], { phase: "post", useAi: true, news: true, world: false });
  assert.equal(auto.status().history.length, 2);
  // switched off: nothing runs
  auto.set({ enabled: false });
  now = IST("2026-11-16", 8, 50);
  assert.equal(auto.tick(), null);
  assert.equal(started.length, 2);
});

test("without live data it waits; a run the trader started is not interrupted", () => {
  const docs = new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-auto-")));
  const now = IST("2026-11-13", 8, 50);
  let mode = "none";
  const ai = { configured: () => false, research: { start: () => { throw Object.assign(new Error("busy"), { code: "busy" }); } } };
  const auto = new ResearchAuto({ ai, market: { mode: () => mode }, docs, now: () => now, log: { log() {} } });
  assert.equal(auto.tick(), null);
  mode = "kite";
  assert.equal(auto.tick(), null, "busy: try again next minute");
  assert.equal(auto.status().lastRuns.pre, undefined);
});

test("the direction weighs the lenses into one call and never hides the missing value lens", () => {
  const sheet = { price: { last: 100 }, atr: 2, indicators: { rsi14: 60, macdHist: 1, roc20: 5, adx: 28, atrPct: 2 }, movingAverages: { sma200: 90, ema20: 98, ema50: 95 }, week52: { positionPct: 80, low: 70, high: 105 }, supports: [{ price: 97 }], resistances: [{ price: 104 }, { price: 108 }], swing: { stance: "Bullish", score: 50, conviction: "high" }, longTerm: { stance: "Long-term uptrend", checks: "6/7" } };
  const up = buildDirection({ sheet, edge: { available: true, best: { grade: "A", kind: "swing", side: "long", winPct: 62, n: 50, expR: 0.4 } }, market: { tide: { score: 30, label: "Rising" } } });
  assert.equal(up.call, "buy");
  assert.ok(up.plan.stop < up.plan.entry && up.plan.targets[0] > up.plan.entry);
  assert.equal(up.lenses.find((l) => l.id === "value").available, false);
  // the same picture without forward-tested odds is only a "watch"
  const unproven = buildDirection({ sheet, edge: { available: true, best: null } });
  assert.notEqual(unproven.call, "buy");
  const down = buildDirection({ sheet: { ...sheet, indicators: { rsi14: 35, macdHist: -1, roc20: -6, adx: 30 }, movingAverages: { sma200: 120, ema20: 96, ema50: 99 }, swing: { stance: "Bearish", score: -50 }, longTerm: { stance: "Long-term downtrend" } } });
  assert.equal(down.call, "avoid");
  assert.equal(down.plan, null);
  assert.equal(buildDirection({ sheet: null }).available, false);
});
