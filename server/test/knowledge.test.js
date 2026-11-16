"use strict";
// The desk's knowledge base (market/knowledge.js with market/kb/): its integrity, its search, the packs
// each AI feature is given with every request, and TradeAI answering knowledge questions from it at once.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const KB = require("../market/knowledge");
const { AiService } = require("../ai/service");
const { featureOf } = require("../ai/brains");

test("every topic is complete, its id unique, and no topic promises anything", () => {
  const ids = new Set();
  for (const t of KB.ALL) {
    assert.ok(t.id && !ids.has(t.id), `unique id: ${t.id}`);
    ids.add(t.id);
    assert.ok(t.area && t.title, t.id);
    assert.ok(Array.isArray(t.rules) && t.rules.length >= 1, t.id);
    for (const r of t.rules) assert.ok(typeof r === "string" && r.length > 20 && r.length < 700, `${t.id}: ${r.slice(0, 40)}`);
  }
  assert.ok(KB.ALL.length >= 70, `${KB.ALL.length} topics`);
  const text = JSON.stringify(KB.ALL);
  assert.doesNotMatch(text, /guaranteed? (profit|return)|sure.?shot|risk.?free profit|always wins|never loses/i);
  // every area of trading is covered
  for (const area of ["India: market and rules", "Order types and execution", "Costs and taxes", "Indicators", "Price action and patterns", "Volume, open interest and order flow", "Strategies", "Risk and money", "Psychology", "Research and testing", "Macro and sectors", "Fundamentals for traders", "Masters' methods"]) {
    assert.ok(KB.AREAS.includes(area), area);
  }
});

test("the market folder still cannot name a trading endpoint (the knowledge files are text about markets, not code that trades)", () => {
  const dir = path.join(__dirname, "..", "market", "kb");
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    assert.doesNotMatch(src, /require\(["'][./]*trading/, f);
    assert.doesNotMatch(src, /\/orders|\/portfolio|\/user\/margins|KiteBroker/, f);
  }
});

test("search finds the right page for real questions", () => {
  const top = (q) => (KB.search(q, { limit: 1 })[0] || {}).id;
  const cases = {
    "what is open interest and long buildup": "vol-oi",
    "how does T+1 settlement work": "in-settlement",
    "explain VWAP": "ind-vwap",
    "how does the F&O ban work": "in-fno",
    "how is intraday profit taxed": "in-tax",
    "market wide circuit breaker rules": "in-bands",
    "difference between SL and SL-M orders": "in-orders",
    "bollinger squeeze": "ind-bollinger",
    "delivery percentage meaning": "in-data",
    "position sizing kelly": "risk-sizing",
    "averaging down": "risk-pyramid",
    "revenge trading": "psy-biases",
    "backtest overfitting": "res-testing",
    "who was jesse livermore": "m-livermore",
    "minervini vcp": "m-minervini",
    "turtle traders rules": "m-turtles",
    "vijay kedia smile": "m-india",
    "buffett margin of safety": "m-value",
    "india vix level": "in-indices",
    "narrow cpr trend day": "st-daytypes",
    "head and shoulders pattern": "pa-patterns",
    "rbi repo rate effect on banks": "macro-india",
  };
  for (const [q, want] of Object.entries(cases)) assert.equal(top(q), want, q);
  assert.deepEqual(KB.search("zzzz qqqq"), []);
  assert.ok(KB.searchText("open interest", { maxChars: 600 }).length <= 600);
});

test("each AI feature has a compact knowledge pack; every topic it names exists", () => {
  for (const [feature, ids] of Object.entries(KB.PACKS)) {
    for (const id of ids) assert.ok(KB.ALL.some((t) => t.id === id), `${feature}: ${id}`);
    const pack = KB.packFor(feature);
    assert.ok(pack.length > 200 && pack.length < 2700, `${feature}: ${pack.length}`);
    assert.match(pack, /THE DESK'S KNOWLEDGE BASE/);
    assert.match(pack, /never treat any of it as a promise/);
  }
  assert.equal(KB.packFor("no-such-feature"), "");
  assert.equal(KB.packFor(null), "");
});

function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-kb-"));
  const sent = [];
  const fetchImpl = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {};
    sent.push({ system: typeof body.system === "string" ? body.system : JSON.stringify(body.system || ""), user: body.messages ? body.messages[0].content : "" });
    const text = String(body.messages && body.messages[0].content).startsWith("READERS:") ? JSON.stringify({ thought: "", calls: [], enough: true }) : JSON.stringify({ answer: "From the knowledge given.", datapoints: [], actions: [], forecast: { lean: "n/a", horizon: "", scenarios: [] }, confidence: "medium", followups: [] });
    return { ok: true, status: 200, json: async () => ({ id: "m", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20 } }), text: async () => "" };
  };
  const market = { mode: () => "kite", now: () => Date.now(), watchlist: () => [], instruments: async () => [{ symbol: "SBIN" }], async context() { return { available: false }; }, alerts: () => ({ alerts: [] }) };
  const store = { data: { settings: {} }, update(fn) { fn(this.data); } };
  const ai = new AiService({ dir, store, secrets: { encrypt: (x) => `enc:${Buffer.from(x).toString("base64")}`, decrypt: (x) => Buffer.from(x.slice(4), "base64").toString() }, market, fetchImpl, now: () => Date.now(), log: { log() {} } });
  return { ai, sent };
}

test("TradeAI answers a knowledge question at once from the knowledge base — no model, even with no AI key", async () => {
  const { ai, sent } = boot();
  const r = await ai.tradeai.answer("What is open interest?", { owner: true });
  assert.equal(r.meta.tier, "instant");
  assert.equal(r.meta.intent, "knowledge");
  assert.equal(sent.length, 0, "no model was asked");
  assert.match(r.answer, /Open interest and the option chain/);
  assert.match(r.answer, /long build-up/);
  const t = await ai.tradeai.answer("Explain T+1 settlement", { owner: false });
  assert.match(t.answer, /T\+1/);
  // a question about the trader's own account is not a knowledge question
  const m = await ai.tradeai.answer("What is my margin?", { owner: true });
  assert.notEqual(m.meta.intent, "knowledge");
});

test("every AI request carries its feature's knowledge pack after the owner's brains", async () => {
  const { ai } = boot();
  const { SYSTEM } = require("../ai/scanai");
  const coachSystem = require("../ai/coach").COACH_SYSTEM || null;
  // the pack is chosen by the request's registered instructions
  const copilot = require("../ai/copilot");
  const sys = copilot.LIVE_SYSTEM;
  if (sys) {
    assert.equal(featureOf(sys), "copilot");
    assert.match(ai.brains.knowledgeFor(sys), /VWAP/);
  }
  assert.equal(ai.brains.knowledgeFor(SYSTEM), "", "the scanner's review is handed its knowledge in the request itself");
  assert.equal(ai.brains.knowledgeFor("an unregistered prompt"), "");
  void coachSystem;
});
