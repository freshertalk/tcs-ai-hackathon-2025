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

test("world-market questions are answered at once from the forecast", () => {
  for (const q of ["How will the market open tomorrow?", "What is GIFT Nifty saying?", "sgx nifty?", "How are US markets?", "Nikkei and Singapore markets today"]) assert.deepEqual([q, classify(q).tier, classify(q).intent], [q, "instant", "global"]);
  assert.equal(classify("What should I expect from the market next week?").tier, "deep", "depth still goes to the merged mixture");
  const f = { available: true, headline: "NSE likely to see a gap-up open (+0.60%); the day leans UP", for: "the session on 2026-11-17", lean: { word: "up" }, open: { expected: 24144, low: 24100, high: 24190, gapPct: 0.6, basis: "GIFT Nifty +0.60%." }, nifty: { prevClose: 24000 }, markets: [{ region: "Singapore", name: "Straits Times (STI)", last: 3900, changePct: 0.4, session: "live" }], votes: [{ label: "GIFT Nifty", vote: 1, why: "GIFT Nifty +0.60%" }], sectors: [], cautions: [], measured: { us: { beta: 0.32, days: 240, followedPct: 66, minMove: 0.5 } } };
  const a = instantAnswer("global", { forecast: f });
  assert.match(a.answer, /\*\*₹24,144\.00\*\*/);
  assert.match(a.answer, /\| Singapore \| Straits Times \(STI\) \|/);
  assert.match(a.answer, /moved 0\.32× the S&P 500/);
  assert.equal(a.forecast.lean, "up");
});

test("more answers straight from the desk's data: levels, the desk's reading, the outlook, the market, your results", () => {
  const c = (q, symbols = []) => classify(q, { symbols });
  assert.deepEqual([c("support and resistance of SBIN", ["SBIN"]).tier, c("support and resistance of SBIN", ["SBIN"]).intent], ["instant", "levels"]);
  assert.deepEqual([c("what is the outlook for SBIN next session?", ["SBIN"]).tier, c("what is the outlook for SBIN next session?", ["SBIN"]).intent], ["instant", "outlook"]);
  assert.deepEqual([c("RSI and VWAP of INFY", ["INFY"]).tier, c("RSI and VWAP of INFY", ["INFY"]).intent], ["instant", "call"]);
  assert.equal(c("should I buy INFY on this RSI?", ["INFY"]).tier, "advice", "a judgement still goes to the model");
  assert.deepEqual([c("how is the market today?").tier, c("how is the market today?").intent], ["instant", "market"]);
  assert.equal(c("which sectors are leading?").tier, "instant");
  assert.equal(c("why is the market falling?").tier, "advice");
  assert.deepEqual([c("how did I do last week?").tier, c("how did I do last week?").intent], ["instant", "pnl"]);
  assert.equal(c("support of what?").intent, null, "levels of what? no symbol, no instant answer");

  const stock = { quote: { last: 812, changePct: 0.6 }, levels: [{ name: "R1", price: 818, awayPct: 0.74 }, { name: "VWAP", price: 809.5, awayPct: -0.31 }, { name: "S1", price: 801, awayPct: -1.35 }], liveCall: { headline: "Long setup forming", score: 58, threshold: 65, vwap: 809.5, vsVwapPct: 0.31, rsi5: 61 }, daily: { score: { value: 64, label: "Bullish" }, rsi14: 58.2, macdHist: 1.4, adx: 24 }, outlook: { lean: "up", score: 32, agreement: 71, headline: "Leans up", range: { low: 798, high: 826 }, pivots: { p: 810, r1: 818, s1: 801 }, scenarios: ["Above 818: 826 is next"] } };
  const lv = instantAnswer("levels", { stock_SBIN: stock }, { symbol: "SBIN" });
  assert.match(lv.answer, /\| R1 ▲ \| ₹818\.00 \| \+0\.74% \|/);
  assert.match(lv.answer, /no model/);
  const call = instantAnswer("call", { stock_SBIN: stock }, { symbol: "SBIN" });
  assert.match(call.answer, /Live call:\*\* Long setup forming — score 58 of 65 needed/);
  assert.match(call.answer, /RSI 14 58/);
  const ol = instantAnswer("outlook", { stock_SBIN: stock }, { symbol: "SBIN" });
  assert.match(ol.answer, /next session: Leans up/);
  assert.equal(ol.forecast.lean, "up");
  const mk = instantAnswer("market", { market: { tide: { score: 35, label: "Buyers in control", summary: "Breadth is positive." }, sectors: [{ name: "Bank", changePct: 1.2 }, { name: "IT", changePct: -0.8 }] } });
  assert.match(mk.answer, /Buyers in control/);
  assert.match(mk.answer, /\| Bank ▲ \| \+1\.20% \|/);
  const pnl = instantAnswer("pnl", { pnl: { last30: { days: 12, net: 18400, profit: 52000, loss: -33600, charges: 4200, trades: 61 }, recentDays: [{ date: "2026-11-13", net: 2100, trades: 5 }], journal3m: { trades: 180, winRate: 54, profitFactor: 1.32, expectancy: 220, maxDrawdown: -21000 } } });
  assert.match(pnl.answer, /Last 30 days: net \+₹18,400/);
  assert.match(pnl.answer, /win rate 54%/);
  assert.equal(instantAnswer("levels", { stock_SBIN: {} }, { symbol: "SBIN" }), null, "no levels: no instant answer (a model answers instead)");
});

test("when the desk's data cannot be read, the answer says why at once — no model is paid to say the same", () => {
  assert.match(instantAnswer("market", { market: { available: false, reason: "Zerodha is not connected." } }).answer, /No market reading right now: Zerodha is not connected/);
  assert.match(instantAnswer("levels", { stock_SBIN: { symbol: "SBIN", liveError: "Zerodha is not connected." } }, { symbol: "SBIN" }).answer, /No reading for SBIN right now/);
  assert.match(instantAnswer("pnl", { pnl: { last30: { days: 0, net: 0 } } }).answer, /No saved Trade Analysis days/);
  assert.equal(classify("key levels for SBIN", { symbols: ["SBIN"] }).intent, "levels");
  assert.equal(classify("intraday plan for SBIN", { symbols: ["SBIN"] }).intent, "plan");
});
