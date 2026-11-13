"use strict";
// Behaviour memory and the AI decision, without a server or the network.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { buildProfile } = require("../market/profile");
const { MarketService } = require("../market/service");
const { Decision, slimProfile } = require("../ai/decision");
const { checkPlan } = require("../ai/service");
const { FileDocs } = require("../docs");

/** Weekday bars from a price path: path(i) → close; opens gap by gapAt(i) percent. */
function series(n, path, { gapAt = () => 0, vol = () => 100000 } = {}) {
  const out = [];
  let t = Date.UTC(2025, 0, 1);
  let prev = path(0);
  for (let i = 0; out.length < n; i += 1) {
    t += 86400000;
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const k = out.length;
    const c = path(k);
    const o = prev * (1 + gapAt(k) / 100);
    out.push({ t: d.toISOString().slice(0, 10), o, h: Math.max(o, c) * 1.004, l: Math.min(o, c) * 0.996, c, v: vol(k) });
    prev = c;
  }
  return out;
}

test("a steady climb reads as an uptrend", () => {
  const p = buildProfile("UP", series(400, (k) => 100 * Math.pow(1.0012, k) * (1 + 0.012 * Math.sin(k / 4))));
  assert.equal(p.available, true);
  assert.equal(p.trend.now, "uptrend");
  assert.ok(p.trend.shareUp > 60, `share up ${p.trend.shareUp}`);
  assert.equal(p.days, 252);
  assert.ok(p.price.changePct.y1 > 20);
  assert.ok(p.facts[0].startsWith("Trend now: uptrend"));
  assert.ok(Array.isArray(p.log));
  assert.equal(buildProfile("X", series(60, () => 100)).available, false);
});

test("gaps are counted and their same-day fills measured", () => {
  // every 10th day gaps up 2% and closes back below the prior close (a filled gap)
  const bars = series(300, (k) => 100 + (k % 10 === 0 ? -0.5 : 0.05 * (k % 10)), { gapAt: (k) => (k % 10 === 0 ? 2 : 0) });
  const p = buildProfile("GAP", bars);
  assert.ok(p.gaps.up.n >= 20, `gaps up ${p.gaps.up.n}`);
  assert.equal(p.gaps.up.fillRatePct, 100);
  assert.ok(p.log.some((x) => x.events.some((e) => /gap up 2%.*filled/.test(e))));
  assert.ok(p.facts.some((f) => /Gaps up .* filled the same day 100%/.test(f)));
});

test("the profile is stored in the database once a day, with a growing daily history", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-beh-"));
  const docs = new FileDocs(dir);
  let now = Date.parse("2026-11-12T10:00:00Z");
  let calls = 0;
  const bars = series(400, (k) => 100 + k * 0.1);
  const fake = { store: { docs }, now: () => now, daily: async () => ((calls += 1), { candles: bars, source: "kite" }) };
  const behaviour = MarketService.prototype.behaviour;
  const a = await behaviour.call(fake, "INFY");
  const b = await behaviour.call(fake, "INFY");
  assert.equal(calls, 1, "the same day: served from the database");
  assert.equal(b.history.length, 1);
  now += 86400000;
  const c = await behaviour.call(fake, "INFY");
  assert.equal(calls, 2);
  assert.equal(c.history.length, 2, "one snapshot a day");
  assert.equal(docs.read("market/behaviour.json").INFY.symbol, "INFY");
  assert.equal(a.builtOn, "2026-11-12");
  assert.equal(MarketService.prototype.behaviourList.call(fake)[0].snapshots, 2);
});

function aiStub(answer, { last = 100, atr = 2 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-dec-"));
  const asked = [];
  const profile = buildProfile("INFY", series(400, (k) => 80 + k * 0.05));
  return {
    asked,
    docs: new FileDocs(dir),
    now: () => Date.parse("2026-11-12T05:00:00Z"),
    log: { log() {}, error() {} },
    configured: () => true,
    playbook: { read: () => "(skills)" },
    brief: async () => ({ brief: { symbol: "INFY", price: { last } }, verdict: { last, quoteLive: true, movement: { atr }, circuit: { upper: 110, lower: 90 }, day: { available: true, state: "long", session: null }, direction: "bullish" } }),
    market: { behaviour: async () => profile },
    _client: () => ({ ask: async (q) => (asked.push(q), { data: answer, usage: { inputTokens: 9, outputTokens: 3 }, model: "claude-opus-5-5" }) }),
  };
}

test("the decision weighs today against the stored habits, and its plan is checked like any other", async () => {
  const base = { horizon: "intraday", heading: "up", confidence: "medium", thesis: "t", live_evidence: ["a"], habit_evidence: ["b"], conflicts: [], level_notes: "R1", invalidation: "i", watch: ["w"] };
  const ai = aiStub({ ...base, decision: "buy", entry: 100, stop: 98.5, targets: [102, 104] });
  const d = new Decision(ai, checkPlan);
  const out = await d.decide("INFY");
  assert.equal(out.decision, "buy");
  assert.equal(out.plan.side, "long");
  assert.ok(out.plan.checks.length > 1);
  assert.notEqual(out.plan.checkStatus, "rejected", JSON.stringify(out.plan.checks));
  assert.match(ai.asked[0].user, /ITS HABITS/);
  assert.match(ai.asked[0].user, /habits/, "the profile's plain-language habits are sent");
  assert.equal(d.list("INFY").decisions.length, 1);

  // a long with its stop above the entry fails the checks
  const bad = await new Decision(aiStub({ ...base, decision: "buy", entry: 100, stop: 101, targets: [103] }), checkPlan).decide("INFY");
  assert.equal(bad.plan.checkStatus, "rejected");

  // wait / avoid carry no plan
  const wait = await new Decision(aiStub({ ...base, decision: "wait", entry: 0, stop: 0, targets: [] }), checkPlan).decide("INFY");
  assert.equal(wait.plan, null);
  assert.equal(slimProfile({ available: false, reason: "x" }).available, false);
});
