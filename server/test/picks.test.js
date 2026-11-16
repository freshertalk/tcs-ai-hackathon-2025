"use strict";
// The Research tab's Top 10 (market/picks.js, picks.js) and the live RSI extremes. Everything runs on
// fakes: no broker, no network, no AI model, no timer.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const P = require("../market/picks");
const { TopPicks } = require("../picks");
const { FileDocs } = require("../docs");

/** Daily candles: `n` sessions ending yesterday, drifting `drift`% a day, the last one shaped by `last`. */
function candles({ n = 260, start = 100, drift = 0.1, wobble = 0.4, seed = 3, end = "2026-11-12", last = null, vol = 1e6, band = 0.004 } = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648), s / 2147483648);
  const out = [];
  let p = start;
  const days = [];
  for (let t = Date.parse(`${end}T00:00:00Z`); days.length < n; t -= 86400000) {
    const w = new Date(t).getUTCDay();
    if (w !== 0 && w !== 6) days.unshift(new Date(t).toISOString().slice(0, 10));
  }
  for (const d of days) {
    const o = p;
    p = p * (1 + (drift + (rnd() - 0.5) * wobble) / 100);
    out.push({ t: d, o, h: Math.max(o, p) * (1 + band), l: Math.min(o, p) * (1 - band), c: p, v: vol * (0.8 + rnd() * 0.4) });
  }
  if (last) Object.assign(out[out.length - 1], last(out[out.length - 2]));
  return out;
}

test("the daily features: trend, strength, set-ups, range, volume — from completed candles only", () => {
  const up = P.dailyFeatures(candles({ drift: 0.25 }));
  assert.ok(up.vsEma20 > 0 && up.vsEma50 > 0 && up.vsEma200 > 0);
  assert.ok(up.ema20Slope > 0);
  assert.ok(up.ret20 > 3);
  assert.ok(up.atrPct > 0.5 && up.atrPct < 2);
  assert.ok(up.turnoverCr > 0);
  assert.equal(P.dailyFeatures(candles({ n: 40 })), null, "too little history");
  // a close through the 20-day high on heavy volume
  const brk = P.dailyFeatures(candles({ drift: 0.05, last: (p) => ({ o: p.c, h: p.c * 1.04, l: p.c * 0.999, c: p.c * 1.035, v: 3e6 }) }));
  assert.ok(brk.toHi20Pct <= 0);
  assert.ok(brk.relVol >= 2.5);
  assert.ok(brk.closeLoc >= 0.8);
});

test("a stock scored on both sides: each reason with its number, the clear side, and what is left out", () => {
  const df = P.dailyFeatures(candles({ drift: 0.25, last: (p) => ({ o: p.c, h: p.c * 1.03, l: p.c * 0.999, c: p.c * 1.028, v: 6e7 }), vol: 2e7 }));
  const s = P.score(df, null, { niftyRet20: 1, world: { score: 40, firm: true, word: "up" }, sector: { name: "NIFTY IT", vsNiftyPct: 1.2 }, news: { sentiment: 0.5, high: true, mentions: 3, title: "Order win" } });
  assert.equal(s.side, "long");
  assert.ok(s.clear && !s.excluded);
  assert.ok(s.score >= 60);
  assert.deepEqual(s.tags.slice(0, 3).sort(), ["breakout", "rs", "trend"], "the heaviest reasons first");
  assert.ok(s.against.some((r) => /^Stretched: daily RSI/.test(r)), "what holds it back is listed too");
  assert.ok(s.reasons.some((r) => /^Above its 20-, 50- and 200-day averages/.test(r)));
  assert.ok(s.reasons.some((r) => /^Stronger than the NIFTY: \+[\d.]+% in 20 sessions against \+1.00%/.test(r)));
  assert.ok(s.reasons.some((r) => /^Closed above its 20-day high .* on [\d.]+× its usual volume/.test(r)));
  assert.ok(s.reasons.some((r) => /NSE forecast from the world .* leans up, firmly/.test(r)));
  assert.ok(s.reasons.some((r) => /Its sector \(NIFTY IT\) is leading the NIFTY/.test(r)));
  assert.ok(s.reasons.some((r) => /^Positive news \(high impact\): “Order win”/.test(r)));
  // a falling stock is a short; the live session adds its own reasons
  const down = P.dailyFeatures(candles({ drift: -0.25, vol: 2e7 }));
  const live = P.liveFeatures({ last: down.close * 0.98, prevClose: down.close, open: down.close * 0.995, high: down.close * 0.996, low: down.close * 0.978, volume: down.avgVol * 0.9, avgPrice: down.close * 0.985 }, down, { minutesIn: 180 });
  const sh = P.score(down, live, { niftyRet20: 0, niftyChangePct: 0.3, live: true, tide: { score: -40 } });
  assert.equal(sh.side, "short");
  assert.ok(sh.reasons.some((r) => /^Down −?[\d.-]+% today, -?[\d.]+% worse than the NIFTY/.test(r) || /worse than the NIFTY/.test(r)));
  assert.ok(sh.reasons.some((r) => /^Below VWAP/.test(r)));
  assert.ok(sh.reasons.some((r) => /tide is falling/.test(r)));
  // left out: too thin, too quiet, or two-sided
  const thin = P.dailyFeatures(candles({ drift: 0.25, vol: 1000 }));
  assert.match(P.score(thin, null, {}).excluded, /^Too thin to trade/);
  const quiet = P.dailyFeatures(candles({ drift: 0, wobble: 0.05, vol: 2e7, band: 0.001 }));
  assert.match(P.score(quiet, null, {}).excluded, /^Too quiet to trade intraday/);
  const two = P.score({ ...quiet, atrPct: 1.5, vsEma20: 0, vsEma50: 0, vsEma200: 0, ema20Slope: 0, ret20: 0, rsi14: 50 }, null, { niftyRet20: 0 });
  assert.match(two.excluded, /^Two-sided: \d+ points for a long, \d+ for a short\./);
});

test("the second pass: the desk's engines add to the score, the plan's levels come along, and an 'avoid' plan leaves the list", () => {
  const df = P.dailyFeatures(candles({ drift: 0.2, vol: 2e7 }));
  const first = P.score(df, null, { niftyRet20: 0 });
  const plan = { available: true, decision: { kind: "long", why: "Above the pivot" }, plans: { long: { entry: 120.5, stop: 118.9, targets: [123, 125] } }, record: { lean: { long: { trades: 40, winRate: 58, avgR: 0.21 } } } };
  const edge = { available: true, kinds: { day: { long: { grade: "A", live: { n: 48, winPct: 61, expR: 0.31 } } }, swing: { long: { grade: "A" } } } };
  const deep = P.deepen(first, { verdict: { available: true, direction: "bullish", conviction: 70, convictionLabel: "High" }, edge, plan, live: false });
  assert.ok(deep.score > first.score);
  assert.equal(deep.deep, true);
  assert.deepEqual(deep.plan, { kind: "long", entry: 120.5, stop: 118.9, target: 123, target2: 125, record: { trades: 40, winRate: 58, avgR: 0.21 }, why: "Above the pivot" });
  assert.ok(deep.reasons.some((r) => /^Measured odds, grade A: on the days most like today a long day trade won 61% of 48 times \(\+0.31R a trade\)/.test(r)));
  assert.ok(deep.reasons.some((r) => /^The intraday plan is LONG \(its rule won 58% of 40 past sessions\)/.test(r)));
  assert.ok(deep.reasons.some((r) => /daily verdict is bullish \(High conviction\)/.test(r)));
  const avoid = P.deepen(first, { plan: { available: true, decision: { kind: "avoid", why: "Results today" } } });
  assert.match(avoid.excluded, /^The intraday plan says avoid: Results today/);
  // in the session the live call and the pulse count
  const liveDeep = P.deepen(first, { live: true, verdict: { available: true, direction: "neutral", day: { available: true, state: "short", score: 64 } }, pulse: { available: true, score: -45 } });
  assert.ok(liveDeep.parts.short.some((x) => x.id === "liveCall") && liveDeep.parts.short.some((x) => x.id === "pulse"));
});

test("the list: the clear ones best first, at most three from one sector — and how a list did in its session, and over many", () => {
  const mk = (symbol, score, sector, excluded = "") => ({ symbol, sector, s: { score, margin: 20, excluded } });
  const rows = [mk("A", 90, "IT"), mk("B", 88, "IT"), mk("C", 87, "IT"), mk("D", 86, "IT"), mk("E", 80, "BANK"), mk("F", 99, "BANK", "thin"), mk("G", 70, null)];
  assert.deepEqual(P.rank(rows).map((r) => r.symbol), ["A", "B", "C", "E", "G"], "a fourth IT name and an excluded one stay out");
  const day = { A: { o: 100, h: 103, l: 99, c: 102 }, B: { o: 50, h: 51, l: 48, c: 48.5 }, U1: { o: 10, h: 10.2, l: 9.9, c: 10.1 }, U2: { o: 20, h: 20, l: 19, c: 19.8 } };
  const r = P.scoreList([{ symbol: "A", side: "long", rank: 1, tags: ["trend", "rs"] }, { symbol: "B", side: "short", rank: 2, tags: ["trend"] }], day, ["A", "B", "U1", "U2"]);
  assert.deepEqual([r.n, r.hits, r.hitRate], [2, 2, 100]);
  assert.deepEqual(r.rows.map((x) => x.movePct), [2, 3]);
  assert.equal(r.rows[0].bestPct, 3);
  assert.equal(r.rows[1].worstPct, -2, "a short's worst point is the high");
  assert.equal(r.universeAvgPct, -0.25);
  assert.equal(r.edgePct, 2.5, "against the same side mix in the whole universe");
  const rec = P.record([{ result: r }, { result: { ...r, rows: r.rows.map((x) => ({ ...x, movePct: -1, hit: false })), edgePct: -0.5, n: 2 } }]);
  assert.deepEqual([rec.sessions, rec.picks, rec.hitRate, rec.avgPct, rec.beatUniverse], [2, 4, 50, 0.75, 1]);
  assert.deepEqual(rec.byReason.find((x) => x.tag === "trend"), { tag: "trend", n: 4, hitRate: 50, avgPct: 0.75 });
  assert.equal(rec.longs.n, 2);
});

/* ---------------------------------------------------------------------------- the service */

function boot({ mode = "kite", time = "2026-11-13T16:00:00+05:30", ai = null } = {}) {
  const docs = new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-picks-")));
  const clock = { ms: Date.parse(time) };
  const calls = { daily: 0, quotes: 0, verdict: 0, plan: 0, pulse: 0, rsi: [], sync: 0 };
  const today = () => new Date(clock.ms + 5.5 * 3600000).toISOString().slice(0, 10);
  const shapes = { UPA: 0.3, UPB: 0.25, UPC: 0.22, DNA: -0.3, DNB: -0.25, FLAT: 0, THIN: 0.3 };
  const history = {};
  for (const [s, d] of Object.entries(shapes)) history[s] = candles({ drift: d, wobble: d ? 0.4 : 0.05, vol: s === "THIN" ? 500 : 2e7, seed: s.length + d * 10, end: "2026-11-12", band: s === "FLAT" ? 0.001 : 0.004 });
  history["NIFTY 50"] = candles({ drift: 0.05, end: "2026-11-12", vol: 0 });
  const withToday = (s) => {
    const h = history[s].slice();
    const p = h[h.length - 1];
    if (today() > p.t && new Date(clock.ms + 5.5 * 3600000).getUTCHours() * 60 + new Date(clock.ms + 5.5 * 3600000).getUTCMinutes() >= 9 * 60 + 15) h.push({ t: today(), o: p.c, h: p.c * 1.02, l: p.c * 0.99, c: p.c * (1 + (shapes[s] || 0) * 0.05), v: p.v });
    return h;
  };
  const sharedOut = [];
  const market = {
    mode: () => mode,
    watchlist: () => Object.keys(shapes),
    indexList: { list: () => [], catalog: () => [] },
    daily: async (s) => (calls.daily++, { candles: withToday(s) }),
    quotes: async (syms) => {
      calls.quotes++;
      const q = {};
      for (const s of syms) {
        const h = history[s];
        if (!h) continue;
        const p = h[h.length - 1].c;
        const d = shapes[s] || 0;
        q[s] = { last: p * (1 + d * 0.04), prevClose: p, changePct: d * 4, open: p, high: p * (1 + Math.max(0, d) * 0.05), low: p * (1 + Math.min(0, d) * 0.05), volume: 2e7, avgPrice: p * (1 + d * 0.02) };
      }
      return { quotes: q };
    },
    verdict: async (s) => (calls.verdict++, { available: true, direction: (shapes[s] || 0) > 0 ? "bullish" : (shapes[s] || 0) < 0 ? "bearish" : "neutral", conviction: 60, convictionLabel: "Medium", day: { available: true, state: "flat" } }),
    edge: async () => ({ available: true, kinds: {} }),
    pulse: async (s) => (calls.pulse++, { available: true, score: (shapes[s] || 0) * 150 }),
    marketForecast: async () => ({ available: true, lean: { score: 30, word: "up", firm: false }, headline: "NSE leans up" }),
    context: async () => ({ available: true, tide: { score: 25, label: "Rising" } }),
    social: { signal: () => ({ mood: { label: "Mixed", score: 0 }, stocks: [] }), forSymbol: () => null },
    screenerStatus: () => ({ ready: calls.sync > 0, job: { running: false, done: 0, total: 0 } }),
    screenerStart: () => (calls.sync++, { ready: false, job: { running: true, done: 10, total: 500, etaSeconds: 180 } }),
    screenerRsi: async (q) => {
      calls.rsi.push(q);
      return q.max !== undefined ? { at: "x", live: true, session: "2026-11-13", considered: 480, rows: [{ symbol: "LOWCO", name: "Low Co", last: 100, changePct: -3, rsi: 12.4, rsiPrev: 14, avgTurnoverCr: 140 }] } : { at: "x", live: true, session: "2026-11-13", considered: 480, rows: [{ symbol: "HICO", name: "High Co", last: 900, changePct: 2, rsi: 83.1, rsiPrev: 81, avgTurnoverCr: 300 }] };
    },
  };
  const ensemble = { intraday: async (s) => (calls.plan++, (shapes[s] || 0) > 0 ? { available: true, decision: { kind: "long", why: "Trend" }, plans: { long: { entry: 101, stop: 99, targets: [104, 106] } }, record: { lean: { long: { trades: 30, winRate: 57, avgR: 0.2 } } } } : { available: true, decision: { kind: "short", why: "Trend" }, plans: { short: { entry: 99, stop: 101, targets: [96, 94] } }, record: { lean: { short: { trades: 30, winRate: 55, avgR: 0.15 } } } }) };
  const playbook = { sections: [], setSection(h, b) { this.sections.push({ h, b }); } };
  const shared = { publish: (f) => sharedOut.push(f) };
  const svc = new TopPicks({ market, ai: { ensemble, playbook, shared, ...(ai || {}) }, docs, now: () => clock.ms, log: { log() {}, error() {} } });
  return { svc, docs, clock, calls, sharedOut, playbook, history };
}

test("after the close: the list for the next session — ranked, with reasons, plans and data points, shared with the desk, and the clear sides only", async () => {
  const { svc, calls, sharedOut } = boot();
  const v = await svc.build();
  assert.equal(v.phase, "post");
  assert.equal(v.session, "2026-11-16", "Friday after the close: the list is for Monday");
  const syms = v.list.map((x) => x.symbol);
  assert.ok(syms.includes("UPA") && syms.includes("DNA"));
  assert.ok(!syms.includes("THIN") && !syms.includes("FLAT"), "too thin, and too quiet, stay out");
  const a = v.list.find((x) => x.symbol === "UPA");
  assert.equal(a.side, "long");
  assert.equal(v.list.find((x) => x.symbol === "DNA").side, "short");
  assert.ok(a.reasons.length >= 3 && a.score > 0);
  assert.deepEqual(a.plan.entry, 101);
  assert.ok(a.data.atrPct > 0 && "rsi14" in a.data && "ret20" in a.data);
  assert.equal(v.list[0].rank, 1);
  assert.equal(v.stats.universe, 7);
  assert.ok(calls.plan >= 4, "the intraday plan for the shortlist");
  assert.equal(calls.pulse, 0, "the pulse is a session reading");
  // shared with the rest of the desk
  assert.equal(sharedOut.length, v.list.length);
  assert.match(sharedOut[0].summary, /^Top 10 #1 for the next session: (LONG|SHORT), score \d+\./);
  assert.equal(sharedOut[0].feature, "picks");
  // the view
  const view = svc.view();
  assert.equal(view.snap.session, "2026-11-16");
  assert.equal(view.stale, false);
  assert.equal(view.record.sessions, 0);
});

test("in the session: re-ranked from quotes and the engines, the daily part read once, rank moves and new names marked", async () => {
  const { svc, calls, clock } = boot({ time: "2026-11-13T10:00:00+05:30" });
  const first = await svc.build();
  assert.equal(first.phase, "live");
  assert.equal(first.session, "2026-11-13");
  const dailyReads = calls.daily;
  assert.ok(calls.pulse > 0 && calls.quotes > 0);
  assert.ok(first.list.every((x) => x.move === undefined || x.move === null));
  const a = first.list.find((x) => x.symbol === "UPA");
  assert.ok(a.reasons.some((r) => /VWAP|today|Pulse/.test(r)), "live reasons");
  clock.ms += 5 * 60000;
  const second = await svc.build();
  assert.equal(calls.daily, dailyReads, "the daily candles are not read again in the session");
  assert.ok(second.list.every((x) => x.move === 0 || typeof x.move === "number"), "every name was on the list before: its move is a number");
  assert.equal(second.history.length, 2, "both lists of the session are kept");
});

test("before the open, and scoring: the pre-market list and last evening's list are scored on the session's candles; ten sessions write the skills file", async () => {
  const { svc, clock, docs, playbook } = boot({ time: "2026-11-12T16:00:00+05:30" });
  await svc.build(); // Thursday evening: for Friday
  clock.ms = Date.parse("2026-11-13T08:50:00+05:30");
  const pre = await svc.build();
  assert.equal(pre.phase, "pre");
  assert.equal(pre.session, "2026-11-13");
  clock.ms = Date.parse("2026-11-13T16:00:00+05:30");
  svc.feat = null;
  await svc.build(); // Friday evening: scores Friday's two lists, makes Monday's
  const rec = docs.read("picks/record.json", null);
  assert.deepEqual(rec.lists.map((l) => [l.session, l.kind]).sort(), [["2026-11-13", "evening"], ["2026-11-13", "pre"]]);
  const r = rec.lists[0].result;
  assert.ok(r.n >= 4);
  assert.ok(r.rows.every((x) => typeof x.movePct === "number"));
  const v = svc.view();
  assert.equal(v.record.sessions, 2);
  assert.equal(v.record.recent.length, 2);
  assert.equal(playbook.sections.length, 0, "not before ten sessions");
  // ten sessions on record: the findings go into the skills file
  rec.lists = Array.from({ length: 10 }, (_, i) => ({ ...rec.lists[0], session: `2026-10-${String(i + 10).padStart(2, "0")}` }));
  docs.write("picks/record.json", rec);
  svc._lessons();
  assert.equal(playbook.sections.length, 1);
  assert.match(playbook.sections[0].h, /What the desk's daily Top 10 has done/);
  assert.match(playbook.sections[0].b, /^- Scored on 10 sessions/);
});

test("the AI's review on need: it may only order and keep or drop the desk's candidates; in the session only when the list really changed", async () => {
  const seen = [];
  const reviewer = {
    ready: () => true,
    review: async (input) => {
      seen.push(input);
      return { picks: [{ symbol: "DNA", keep: true, thesis: "Weakest in its group.", risk: "A close above 105.", confidence: "medium" }, { symbol: "NOPE", keep: true, thesis: "not a candidate", risk: "", confidence: "high" }, { symbol: "UPC", keep: false, thesis: "Stretched after five up days.", risk: "", confidence: "low" }], summary: "A balanced list.", marketView: "A quiet open.", by: "Claude Sonnet 5.5", cached: false };
    },
  };
  const { svc, clock } = boot({ ai: { picksAi: reviewer } });
  const v = await svc.build();
  assert.equal(seen.length, 1, "after the close: reviewed");
  assert.equal(seen[0].phase, "post");
  assert.ok(seen[0].candidates.length >= 4 && seen[0].candidates[0].reasons.length > 0);
  assert.equal(v.list[0].symbol, "DNA", "the AI's order");
  assert.equal(v.list[0].ai.thesis, "Weakest in its group.");
  assert.ok(typeof v.list[0].deskRank === "number");
  assert.ok(!v.list.some((x) => x.symbol === "NOPE"), "a stock that is not a candidate is ignored");
  assert.ok(!v.list.some((x) => x.symbol === "UPC"), "dropped, with its reason");
  assert.deepEqual(v.ai.dropped, [{ symbol: "UPC", why: "Stretched after five up days." }]);
  assert.equal(v.ai.by, "Claude Sonnet 5.5");
  assert.equal(svc.settings().aiToday, 1);
  // in the session: the first list is reviewed; re-ranks within the hour are not
  clock.ms = Date.parse("2026-11-16T09:30:00+05:30");
  await svc.build();
  await new Promise((r) => setImmediate(r));
  assert.equal(seen.length, 2);
  clock.ms += 10 * 60000;
  await svc.build();
  await new Promise((r) => setImmediate(r));
  assert.equal(seen.length, 2, "nothing changed: no new review");
  // switched off: never
  svc.setSettings({ aiMode: "off" });
  clock.ms += 2 * 3600000;
  await svc.build({ trigger: "asked" });
  assert.equal(seen.length, 2);
  assert.throws(() => svc.setSettings({ aiMode: "always" }), /need or off/);
});

test("the RSI extremes: the NIFTY 500 at RSI(14) 15 or less and 80 or more, ₹100 crore a day or more — the history prepared by itself first", async () => {
  const { svc, calls } = boot({ time: "2026-11-13T11:00:00+05:30" });
  const first = await svc.rsiExtremes();
  assert.equal(first.available, false);
  assert.equal(first.preparing, true);
  assert.equal(calls.sync, 1, "the NIFTY 500's daily history is downloaded by itself");
  assert.match(first.reason, /Downloading the NIFTY 500's daily history, 10 of 500 stocks/);
  const r = await svc.rsiExtremes();
  assert.equal(r.available, true);
  assert.deepEqual(r.rule, { period: 14, low: 15, high: 80, minTurnover: 100 });
  assert.deepEqual(calls.rsi, [{ period: 14, minTurnover: 100, max: 15 }, { period: 14, minTurnover: 100, min: 80 }]);
  assert.deepEqual(r.oversold.map((x) => [x.symbol, x.rsi]), [["LOWCO", 12.4]]);
  assert.deepEqual(r.overbought.map((x) => [x.symbol, x.rsi]), [["HICO", 83.1]]);
  await svc.rsiExtremes();
  assert.equal(calls.rsi.length, 2, "kept for 30 seconds");
  const demo = boot({ mode: "demo" });
  assert.match((await demo.svc.rsiExtremes()).reason, /not available on demo data/);
});

test("by itself: the pre-market list from 8:35, a re-rank every five minutes in the session, the evening list after 3:45 — weekdays, with Zerodha", async () => {
  const { svc, clock, docs } = boot({ time: "2026-11-13T08:40:00+05:30" });
  await svc.tick();
  assert.equal(svc._latest().phase, "pre");
  await svc.tick();
  assert.equal(docs.read("picks/day-2026-11-13.json", null).snaps.length, 1, "once before the open");
  clock.ms = Date.parse("2026-11-13T09:20:00+05:30");
  await svc.tick();
  assert.equal(svc._latest().phase, "live");
  clock.ms += 2 * 60000;
  await svc.tick();
  assert.equal(docs.read("picks/day-2026-11-13.json", null).snaps.length, 2, "not before five minutes");
  clock.ms += 4 * 60000;
  await svc.tick();
  assert.equal(docs.read("picks/day-2026-11-13.json", null).snaps.length, 3);
  clock.ms = Date.parse("2026-11-13T15:50:00+05:30");
  await svc.tick();
  assert.equal(svc._latest().phase, "post");
  const sat = boot({ time: "2026-11-14T10:00:00+05:30" });
  await sat.svc.tick();
  assert.equal(sat.svc._latest(), null, "nothing on a Saturday");
  const off = boot({ mode: "none", time: "2026-11-13T10:00:00+05:30" });
  await off.svc.tick();
  assert.equal(off.svc._latest(), null);
  await assert.rejects(off.svc.build(), /needs the Zerodha connection/);
});

test("in the session the plan's levels carry where the price stands against them: waiting, entry passed, target reached, stop", async () => {
  const { svc } = boot({ time: "2026-11-13T11:00:00+05:30" });
  const v = await svc.build();
  const withPlan = v.list.filter((x) => x.plan && (x.plan.kind === "long" || x.plan.kind === "short"));
  assert.ok(withPlan.length > 0);
  for (const x of withPlan) {
    assert.ok(["waiting", "triggered", "target", "stop"].includes(x.plan.status), `${x.symbol}: ${x.plan.status}`);
    const s = x.plan.kind === "long" ? 1 : -1;
    if (x.plan.status === "target") assert.ok(s * (x.last - x.plan.target) >= 0);
    if (x.plan.status === "waiting") assert.ok(s * (x.last - x.plan.entry) < 0);
  }
  const post = boot();
  const p = await post.svc.build();
  assert.ok(p.list.every((x) => !x.plan || x.plan.status === undefined), "after the close there is no live price to compare");
});
