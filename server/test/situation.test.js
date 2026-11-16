"use strict";
// The knowledge checks (market/situation.js): the knowledge base applied to one stock's readings, and the
// places that use them — the live scanner's score and eligibility, the Top 10, the direction's lens, the AI
// brief and the knowledge packs.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const KB = require("../market/knowledge");
const KC = require("../market/situation");
const S = require("../market/scan");
const P = require("../market/picks");
const { buildDirection } = require("../market/direction");

const STRETCHED_LONG = {
  horizon: "intraday",
  live: true,
  minsIn: 60,
  last: 100,
  chgPct: 3.5,
  rangePos: 0.9,
  vsVwapPct: 3,
  vsVwapAtr: 2.4,
  rsi: 76,
  adx: 16,
  orb: "above",
  relVol: 0.6,
  gapPct: 2,
  vsOpenPct: -0.5,
  market: -45,
  circuit: { upper: 101, lower: 90, toUpperPct: 1, toLowerPct: -10 },
  plan: { side: "long", entry: 100, stop: 99.8, t1: 100.2 },
  turnoverCr: 30,
  vix: 21,
};

test("every check names a topic that exists in the knowledge base, under a unique id", () => {
  const ids = new Set();
  for (const c of KC.CHECKS) {
    assert.ok(!ids.has(c.id), c.id);
    ids.add(c.id);
    assert.ok(KB.ALL.some((t) => t.id === c.topic), `${c.id}: ${c.topic}`);
  }
  assert.ok(KC.CHECKS.length >= 20);
});

test("a stretched, fading long on thin volume near its upper band: the rules argue against it", () => {
  const r = KC.check(STRETCHED_LONG);
  assert.ok(r.vote < 0, `vote ${r.vote}`);
  const against = r.notes.filter((n) => n.stance === "against" && n.side === "long").map((n) => n.id);
  for (const id of ["vwap-stretch", "chase", "gap", "break-volume", "price-band", "rsi-context", "costs"]) assert.ok(against.includes(id), id);
  // costs speak but never vote: they say whether a trade pays, not where the stock goes
  assert.equal(r.notes.find((n) => n.id === "costs").counts, false);
  // the market's tide is the engines' own reading: shown, not counted again
  assert.equal(r.notes.find((n) => n.id === "market-tide").counts, false);
  assert.ok(r.cautions >= 3, "VIX, liquidity, reward against risk");
  assert.match(r.voteWhy, /knowledge base/);
  // the warnings come first
  assert.equal(r.notes[0].stance, "against");
  for (const n of r.notes) assert.ok(n.title && n.text.length > 20, n.id);
});

test("a clean breakout with the trend and volume behind it: the rules agree", () => {
  const r = KC.check({ horizon: "intraday", live: true, minsIn: 40, last: 100, chgPct: 1.2, rangePos: 0.8, vsVwapPct: 0.6, vsVwapAtr: 0.8, rsi: 66, adx: 28, plusDI: 30, minusDI: 14, orb: "above", relVol: 2.1, market: -25, rsNifty: 1.8, dailyTrend: 1, cprWidthPct: 0.2 });
  assert.ok(r.vote > 0, `vote ${r.vote}`);
  const g = KC.forSide(r, "long");
  const ids = g.agree.map((n) => n.id);
  for (const id of ["break-volume", "leader", "vwap-side", "opening-range", "adx-regime", "higher-timeframe"]) assert.ok(ids.includes(id), id);
  assert.equal(g.against.length, 0);
  assert.ok(g.info.some((n) => n.id === "cpr"));
  // seen from the other side, the same notes argue against a short
  assert.ok(KC.forSide(r, "short").against.length >= ids.length);
});

test("RSI is read against the trend's strength: overbought in a trend is not a short, in a range it fades", () => {
  const trend = KC.check({ rsi: 74, adx: 30, plusDI: 28, minusDI: 12 }).notes.find((n) => n.id === "rsi-context");
  assert.equal(trend.stance, "for");
  assert.equal(trend.side, "long");
  const range = KC.check({ rsi: 74, adx: 15 }).notes.find((n) => n.id === "rsi-context");
  assert.equal(range.stance, "against");
  assert.equal(range.side, "long");
  const oversoldRange = KC.check({ rsi: 26, adx: 14 }).notes.find((n) => n.id === "rsi-context");
  assert.equal(oversoldRange.side, "short");
});

test("the time of day, from the desk's own session phases", () => {
  const at = (minsIn) => KC.check({ horizon: "intraday", live: true, minsIn }).notes.find((n) => n.id === "time-of-day");
  assert.match(at(5).text, /first 15 minutes/);
  assert.equal(at(60), undefined);
  assert.match(at(150).text, /midday/);
  assert.match(at(340).text, /2:45 PM/);
  // a swing reading has no time of day
  assert.equal(KC.check({ horizon: "swing", live: true, minsIn: 5 }).notes.length, 0);
});

test("nothing to read says nothing, and broken facts never throw", () => {
  const r = KC.check({});
  assert.deepEqual(r.notes, []);
  assert.equal(r.vote, null);
  assert.equal(KC.brief(r), null);
  assert.equal(KC.forAi(r), null);
  assert.doesNotThrow(() => KC.check({ circuit: "x", plan: { side: "sideways", entry: "a" }, events: 5, rsi: NaN }));
  assert.doesNotThrow(() => KC.check(null));
});

test("what an AI request is given: how to use the checks, the checks, and the full rules behind them", () => {
  const a = KC.forAi(KC.check(STRETCHED_LONG), { maxTopicChars: 1500 });
  assert.match(a.how, /the measurement wins/);
  assert.ok(a.checks.length >= 8);
  assert.ok(a.checks.every((c) => c.says && c.from && c.stance));
  assert.ok(a.rules.length >= 2);
  assert.ok(a.rules.join("").length <= 1500);
  assert.doesNotMatch(JSON.stringify(a), /guaranteed? (profit|return)|sure.?shot|always wins/i);
});

test("the AI brief's own numbers become facts (the daily picture and the live session)", () => {
  const brief = {
    price: { last: 102, live: true, prevClose: 100, open: 101, dayHigh: 102.2, dayLow: 100.5 },
    session: { ist: "10:15", open: true },
    circuit: { upper: 103, lower: 92, toUpperPct: 0.98, toLowerPct: -9.8 },
    indianMarket: { tide: { score: 45 }, nifty: { changePct: 0.3 }, indiaVix: { last: 13 } },
    daily: { indicators: { rsi14: 72, adx: 31, plusDI: 29, minusDI: 11, atrPct: 2.1, relVolume: 1.2, high20: 101, low20: 90 }, levels: { movingAverages: { ema20: 98, ema50: 95, sma200: 88 }, week52: { fromHighPct: -1, fromLowPct: 30 }, pivots: { cprTop: 100.2, cprBottom: 100 } }, liquidity: { avgTurnoverCr: 400 } },
    todayTape5min: { rows: [["10:10", 101.5, 102, 101.4, 101.9, 1000, 101.2]] },
    companyNews: { scheduled: ["Q2 results on 18 Nov"] },
  };
  const f = KC.fromBrief(brief);
  assert.equal(f.minsIn, 60);
  assert.equal(f.chgPct, 2);
  assert.equal(f.rsNifty, 1.7);
  assert.equal(f.vix, 13);
  const ids = KC.check(f).notes.map((n) => n.id);
  for (const id of ["price-band", "rsi-context", "trend-template", "week52", "cpr", "event", "vwap-side"]) assert.ok(ids.includes(id), id);
});

test("the live scanner: the checks are in each reading, and their vote is one small weight in the score", () => {
  const f = { last: 100, vwap: 99.5, atr5: 0.2, vsVwapPct: 0.5, vsVwapAtr: 2.5, rsi: 60, knowledge: { vote: -1, voteWhy: "the knowledge base: stretched" } };
  const vs = S.votes(f);
  const kn = vs.find((v) => v.id === "knowledge");
  assert.ok(kn);
  assert.equal(kn.w, 8);
  assert.equal(kn.v, -1);
  // without checks the votes are exactly as before
  assert.equal(S.votes({ ...f, knowledge: null }).some((v) => v.id === "knowledge"), false);
  assert.equal(S.votes({ ...f, knowledge: { vote: null } }).some((v) => v.id === "knowledge"), false);
});

const IST_UTC = (h, m) => Date.UTC(2026, 10, 16, h - 5, m - 30);

test("the live scanner's eligibility: a first target too close to clear costs, and the midday lull, block an entry", () => {
  const base = { last: 100, vwap: 99.6, atr5: 0.1, adx: 26, orb: "above", relVol: 1.4, turnoverCr: 800, rsi: 62, vsVwapAtr: 1, swingLow: 99.9, supertrend: 1, supertrendLine: 99.5, dayHigh: 100.05, pdh: 101, tickAge: 2 };
  const s = { score: 50, agree: 0.8 };
  const nm = { dir: "up" };
  const tight = S.eligibility({ ...base, at: IST_UTC(10, 30) }, s, nm);
  assert.ok(tight.blocks.some((b) => /charges and slippage/.test(b)), tight.blocks.join(" | "));
  const roomy = S.eligibility({ ...base, atr5: 0.6, swingLow: 99.2, supertrendLine: 98.9, vwap: 99.4, pdh: 103, dayHigh: 100.1, at: IST_UTC(10, 30) }, s, nm);
  assert.ok(!roomy.blocks.some((b) => /charges and slippage/.test(b)), roomy.blocks.join(" | "));
  const midday = S.eligibility({ ...base, atr5: 0.6, swingLow: 99.2, supertrendLine: 98.9, vwap: 99.4, pdh: 103, at: IST_UTC(12, 15) }, { score: 40, agree: 0.8 }, nm);
  assert.ok(midday.blocks.some((b) => /midday lull/.test(b)), midday.blocks.join(" | "));
  const strong = S.eligibility({ ...base, atr5: 0.6, swingLow: 99.2, supertrendLine: 98.9, vwap: 99.4, pdh: 103, at: IST_UTC(12, 15) }, { score: 50, agree: 0.8 }, nm);
  assert.ok(!strong.blocks.some((b) => /midday lull/.test(b)));
  // a caller's own rules without the new keys keep the old behaviour
  const old = { ...S.RULES };
  delete old.minTargetPct;
  delete old.middayExtra;
  assert.ok(!S.eligibility({ ...base, at: IST_UTC(12, 15) }, { score: 40, agree: 0.8 }, nm, null, old).blocks.some((b) => /charges|midday/.test(b)));
});

test("the Top 10: a rule against a side takes points from it, never gives them to the other side", () => {
  const df = { close: 100, ret1: 3, vsEma20: 2, vsEma50: 3, vsEma200: 8, ema20Slope: 0.5, rsi14: 64, atrPct: 2, turnoverCr: 300, toHi20Pct: 1.5, toLo20Pct: 8, fromHi52Pct: -10, fromLo52Pct: 40, relVol: 1, nr7: false, inside: false, closeLoc: 0.6, avgVol: 1e6 };
  const quiet = P.score(df, null, {});
  const lf = { last: 104, changePct: 4, gapPct: 0.4, vsOpenPct: 3.6, vsVwapPct: 3, rangePos: 0.95, relVolNow: 1.1 };
  const chase = P.score(df, lf, { live: true, niftyChangePct: 0.2, minutesIn: 90 });
  const kb = chase.parts.long.filter((x) => x.id === "kb");
  assert.ok(kb.length >= 2, "a stretch from VWAP and a chase");
  assert.ok(kb.every((x) => x.pts < 0));
  assert.equal(chase.parts.short.filter((x) => x.id === "kb").length, 0);
  assert.ok(chase.against.some((t) => /Knowledge base/.test(t)));
  assert.ok(chase.knowledge && chase.knowledge.notes.length);
  assert.ok(quiet.knowledge === null || Array.isArray(quiet.knowledge.notes));
  assert.ok(P.TAG_NAME.kb);
  // the second pass keeps them
  assert.equal(P.deepen(chase, {}).knowledge, chase.knowledge);
});

test("the direction has a knowledge-base lens that weighs only what the other lenses do not", () => {
  const sheet = { price: { last: 100 }, atr: 2, indicators: { rsi14: 74, adx: 14, atrPct: 2, relVolume: 0.6, high20: 99 }, movingAverages: { ema20: 97, ema50: 95, sma200: 90 }, week52: { fromHighPct: -1, fromLowPct: 40 }, liquidity: { turnoverCr: 300 } };
  const d = buildDirection({ sheet });
  const kb = d.lenses.find((l) => l.id === "knowledge");
  assert.ok(kb && kb.available);
  assert.ok(kb.weight > 0, "RSI overbought in a range and a break on thin volume vote");
  assert.equal(kb.view, "bearish");
  assert.ok(kb.evidence.some((e) => /range/.test(e)));
  // with nothing directional to say it weighs nothing
  const calm = buildDirection({ sheet: { price: { last: 100 }, indicators: { atrPct: 5 } } });
  const k2 = calm.lenses.find((l) => l.id === "knowledge");
  assert.equal(k2.weight, 0);
  assert.equal(calm.lenses.find((l) => l.id === "value").available, false);
});

test("every AI feature that is shown the checks is told how to weigh them", () => {
  for (const f of ["decision", "strategist", "copilot", "ensemble-live", "ensemble-research", "research", "coach", "exit", "exit-levels", "tradeai"]) assert.match(KB.packFor(f), /the measurement wins\./, f);
  assert.doesNotMatch(KB.packFor("review"), /knowledgeChecks/);
});

test("the checks are market text and arithmetic: no trading module, no clock, no network", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "market", "situation.js"), "utf8");
  assert.doesNotMatch(src, /require\(["'][./]*trading/);
  assert.doesNotMatch(src, /Date\.now|new Date\(|setTimeout|setInterval|fetch\(/);
});

test("two more checks from the working knowledge: a round number close by, and a volume climax far from VWAP", () => {
  const near = KC.check({ horizon: "intraday", live: true, last: 2000.8, relVol: 1 });
  const rn = near.notes.find((n) => n.id === "round-number");
  assert.ok(rn && rn.stance === "info" && /round number 2000/.test(rn.text), "within 0.12% of 2,000");
  assert.equal(near.vote, null, "an information note moves no vote");
  assert.equal(KC.check({ horizon: "intraday", live: true, last: 2033, relVol: 1 }).notes.find((n) => n.id === "round-number"), undefined, "1.6% away: not near");
  const up = KC.check({ horizon: "intraday", live: true, last: 100, relVol: 4.2, vsVwapAtr: 3, minsIn: 90 });
  const cl = up.notes.find((n) => n.id === "climax");
  assert.ok(cl && cl.stance === "against" && cl.side === "long" && /exhaustion/.test(cl.text));
  const dn = KC.check({ horizon: "intraday", live: true, last: 100, relVol: 4.2, vsVwapAtr: -3, minsIn: 90 });
  assert.equal(dn.notes.find((n) => n.id === "climax").side, "short");
  assert.equal(KC.check({ horizon: "intraday", live: true, last: 100, relVol: 1.2, vsVwapAtr: 3 }).notes.find((n) => n.id === "climax"), undefined, "ordinary volume is not a climax");
});
