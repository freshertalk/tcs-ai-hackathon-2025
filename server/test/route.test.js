"use strict";
// TradeAI's router (server/ai/route.js): which way a question goes, and the instant answers.

const test = require("node:test");
const assert = require("node:assert/strict");

const { classify, instantAnswer } = require("../ai/route");

test("data questions are instant; judgement goes to one model; depth to the merged mixture", () => {
  const c = (q, o = {}) => classify(q, o);
  assert.deepEqual([c("show my positions").tier, c("show my positions").intent], ["instant", "positions"]);
  assert.equal(c("how am I doing against my daily target?").intent, "goal");
  assert.equal(c("what is my available margin").intent, "funds");
  assert.equal(c("price of SBIN", { symbols: ["SBIN"] }).tier, "instant");
  assert.equal(c("price?").tier, "fast", "a price of what? no symbol, no instant answer");
  assert.equal(c("option chain of RELIANCE", { symbols: ["RELIANCE"] }).intent, "options");
  assert.equal(c("should I buy as per the option chain of SBIN?", { symbols: ["SBIN"] }).tier, "instant", "the chain is the desk's own analysis");
  assert.equal(c("intraday plan for TATASTEEL", { symbols: ["TATASTEEL"] }).intent, "plan");
  assert.equal(c("should I exit my positions now?").tier, "advice", "judgement words need a model");
  assert.equal(c("why is SBIN falling?", { symbols: ["SBIN"] }).tier, "advice");
  assert.equal(c("what should I expect from the market next week?").tier, "deep");
  assert.equal(c("compare SBIN and HDFCBANK", { symbols: ["SBIN", "HDFCBANK"] }).tier, "deep");
  assert.equal(c("hello there").tier, "fast");
  assert.equal(c("show my positions", { mode: "deep" }).tier, "deep", "Deep chosen: always the combination");
  assert.equal(c("should I hold SBIN?", { mode: "fast", symbols: ["SBIN"] }).tier, "fast", "Fast chosen: one quick model");
});

test("instant answers are tables from the data, or nothing when the data is missing", () => {
  const g = { available: true, enabled: true, pnl: 2600, target: 3000, stop: 1500, peak: 3100, floor: 1550, progressPct: 87, state: "near-target", level: "warning", title: "Close to the target", text: "Today is +₹2,600.", action: "Trail the stops.", positions: [], base: 100000, config: { targetPct: 3, stopPct: 1.5 } };
  const a = instantAnswer("goal", { goal: g });
  assert.match(a.answer, /\| \*\*\+₹2,600\*\* \| ₹3,000 \(3%\)/);
  assert.equal(a.actions[0].kind, "corrective");
  assert.equal(instantAnswer("goal", {}), null);
  assert.equal(instantAnswer("positions", { positions: [] }).answer.includes("no open positions"), true);
  assert.equal(instantAnswer("quote", { stock_SBIN: { quote: null } }, { symbol: "SBIN" }), null);
  const o = instantAnswer("options", { options: { available: false, reason: "SBIN has no options on NSE" } });
  assert.match(o.answer, /no options/);
});
