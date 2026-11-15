"use strict";
// AI Live and AI Research: the deterministic floor (pulse, outlook), the weighing of analysts, the
// plan checks, the scoring against real prices, and a whole run against FAKE companies — the default
// model (Claude Sonnet 5.5) and a fallback company — with no network, no real key, no cost.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildPulse } = require("../market/pulse");
const { buildOutlook } = require("../market/outlook");
const { AiService, checkPlan } = require("../ai/service");
const { combine, weigh, cleanVote, consensusPlan, sanePlan, judge, weightFromRecord } = require("../ai/ensemble");

const IST = 5.5 * 3600 * 1000;
const at = (hhmm, date = "2026-11-12") => Date.parse(`${date}T${hhmm}:00+05:30`);

/* -------------------------------------------------------------------------- synthetic sessions */

function bars5(n, from, step, { vol = 100000, wiggle = 0 } = {}) {
  const out = [];
  let px = from;
  let pv = 0;
  let vv = 0;
  for (let i = 0; i < n; i += 1) {
    const o = px;
    const c = px + step + (wiggle ? (i % 2 ? wiggle : -wiggle) : 0);
    const h = Math.max(o, c) + 0.35;
    const l = Math.min(o, c) - 0.35;
    const v = vol;
    pv += ((h + l + c) / 3) * v;
    vv += v;
    const mins = 9 * 60 + 15 + i * 5;
    out.push({ t: `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`, o, h, l, c, v, w: pv / vv });
    px = c;
  }
  return out;
}

const SESSION = { ist: "10:40", phase: "morning", label: "Morning session", open: true, entries: true, minutesToCutoff: 245, minutesToSquareOff: 275 };

function dayOf(bars, over = {}) {
  const last = bars[bars.length - 1].c;
  const first = bars[0].o;
  const k = bars.length - 1;
  const pc = (a, b) => ((a - b) / b) * 100;
  const vwap = bars[k].w;
  return {
    available: true,
    session: { ...SESSION, ...(over.session || {}) },
    state: over.state || "wait",
    headline: over.headline || "WAIT",
    score: over.score ?? 0,
    plan: over.plan || null,
    fast: over.fast === undefined ? { available: true, trend: "flat", structure: "no clear structure", swingLow: null, swingHigh: null } : over.fast,
    movement: { last, vwap, vsVwapPct: pc(last, vwap), m15Pct: pc(last, bars[k - 3].c), m30Pct: pc(last, bars[k - 6].c), rsi5: 55, atr: 18, orHigh: first + 2, orLow: first - 2, volumePace: 1.2, quoteAgeSec: 3, lastBarAt: bars[k].t, ...(over.movement || {}) },
  };
}

const UP_FAST = { available: true, trend: "up", structure: "higher highs and higher lows", swingLow: 1010, swingHigh: 1023 };
const DOWN_FAST = { available: true, trend: "down", structure: "lower highs and lower lows", swingLow: 977, swingHigh: 990 };

test("pulse: a clean rise on volume, above VWAP, in an up structure, leans up and calls a long — with both plans", () => {
  const b = bars5(30, 1000, 0.8);
  const p = buildPulse({ day: dayOf(b, { state: "long", score: 70, headline: "LONG in play", fast: UP_FAST }), bars5: b, fast: UP_FAST });
  assert.equal(p.available, true);
  assert.equal(p.lean, "up");
  assert.equal(p.call, "long");
  assert.ok(p.score >= 28 && p.agreement >= 62, JSON.stringify({ s: p.score, a: p.agreement }));
  assert.ok(p.components.length >= 7, "every component is shown with its vote");
  assert.ok(p.components.every((c) => c.vote >= -1 && c.vote <= 1 && c.why));
  // both sides always have a plan, on the right side of the entry
  assert.ok(p.plans.long.stop < p.plans.long.entry && p.plans.long.targets[0] > p.plans.long.entry);
  assert.ok(p.plans.short.stop > p.plans.short.entry && p.plans.short.targets[0] < p.plans.short.entry);
  assert.ok(p.window.low < p.last && p.window.high > p.last);
  assert.match(p.headline, /Leans UP/);
});

test("pulse: a clean fall leans down and calls a short", () => {
  const b = bars5(30, 1000, -0.8);
  const p = buildPulse({ day: dayOf(b, { state: "short", score: -70, headline: "SHORT in play", fast: DOWN_FAST }), bars5: b, fast: DOWN_FAST });
  assert.equal(p.lean, "down");
  assert.equal(p.call, "short");
  assert.match(p.headline, /Leans DOWN/);
});

test("pulse: choppy sideways trade is 'wait', and a strong lean is still 'wait' when a gate is shut", () => {
  const chop = bars5(30, 1000, 0, { wiggle: 0.5 });
  const p = buildPulse({ day: dayOf(chop), bars5: chop });
  assert.equal(p.call, "wait");
  assert.equal(p.lean, "sideways");
  // a strong rise, but outside the entry window: no call
  const b = bars5(30, 1000, 0.8);
  const late = buildPulse({ day: dayOf(b, { state: "long", score: 70, fast: UP_FAST, session: { entries: false, label: "After the 2:45 PM cut-off" } }), bars5: b, fast: UP_FAST });
  assert.equal(late.lean, "up");
  assert.equal(late.call, "wait");
  assert.match(late.headline, /stand aside/);
  assert.ok(late.gates.some((g) => /no fresh intraday entries/.test(g)));
  // thin volume is a gate too
  const thin = buildPulse({ day: dayOf(b, { state: "long", score: 70, fast: UP_FAST, movement: { volumePace: 0.3 } }), bars5: b, fast: UP_FAST });
  assert.equal(thin.call, "wait");
  // too early: not enough bars
  assert.equal(buildPulse({ day: dayOf(b), bars5: b.slice(0, 3) }).available, false);
  assert.equal(buildPulse({ day: { available: false, reason: "closed" }, bars5: b }).available, false);
});

test("pulse: knows the trader's position and margin, and sizes by risk — read only", () => {
  const up = bars5(30, 1000, 0.8);
  const down = bars5(30, 1000, -0.8);
  const hold = buildPulse({ day: dayOf(up, { score: 70, fast: UP_FAST }), bars5: up, fast: UP_FAST, account: { position: { quantity: 50, average: 1005, product: "MIS" }, funds: { available: 200000 } } });
  assert.equal(hold.you.hasPosition, true);
  assert.equal(hold.you.side, "long");
  assert.equal(hold.you.advice, "hold");
  assert.ok(hold.you.pnl > 0);
  assert.ok(hold.you.sizing.qty > 0 && hold.you.sizing.qty <= Math.floor(200000 / hold.last));
  assert.equal(hold.you.sizing.riskRs, 2000);
  const exit = buildPulse({ day: dayOf(down, { score: -70, fast: DOWN_FAST }), bars5: down, fast: DOWN_FAST, account: { position: { quantity: 50, average: 1005, product: "MIS" }, funds: { available: 200000 } } });
  assert.equal(exit.you.advice, "exit-or-tighten");
  const none = buildPulse({ day: dayOf(up, { score: 70, fast: UP_FAST }), bars5: up, fast: UP_FAST, account: { position: null, funds: { available: 50000 } } });
  assert.equal(none.you.hasPosition, false);
  assert.equal(none.you.cash, 50000);
});

/* ------------------------------------------------------------------------------------ outlook */

function daily(n, drift, noise = 1) {
  const out = [];
  let c = 500;
  for (let i = 0; i < n; i += 1) {
    const o = c;
    c = c + drift + Math.sin(i * 1.3) * noise;
    const d = new Date(Date.UTC(2026, 0, 1) + i * 86400000);
    out.push({ t: d.toISOString().slice(0, 10), o, h: Math.max(o, c) + 1.2, l: Math.min(o, c) - 1.2, c, v: 1e6 + (i % 5) * 1e4 });
  }
  return out;
}

test("outlook: an up-trending stock leans up for the next session with both plans, levels and scenarios", () => {
  const o = buildOutlook({ candles: daily(160, 0.9) });
  assert.equal(o.available, true);
  assert.equal(o.lean, "up");
  assert.ok(o.components.length >= 5);
  assert.ok(o.plans.long.stop < o.plans.long.entry && o.plans.long.targets[0] > o.plans.long.entry);
  assert.ok(o.plans.short.stop > o.plans.short.entry && o.plans.short.targets[0] < o.plans.short.entry);
  assert.ok(o.pivots.p && o.pivots.r1 > o.pivots.p && o.pivots.s1 < o.pivots.p);
  assert.ok(o.range.low < o.last && o.range.high > o.last);
  assert.ok(o.scenarios.length >= 3);
  assert.ok(o.gap && o.gap.sessions >= 20);
  const down = buildOutlook({ candles: daily(160, -0.9) });
  assert.equal(down.lean, "down");
});

test("outlook: it uses the research direction and the measured odds as components, and a forming bar is left out", () => {
  const c = daily(120, 0.3);
  const base = buildOutlook({ candles: c });
  const withDir = buildOutlook({ candles: c, direction: { available: true, score: 80, label: "Buy", why: "Most lenses agree." }, edge: { available: true, kinds: { swing: { forward: { d1: { avgPct: 0.6, upPct: 72 } } } } } });
  assert.ok(withDir.components.some((x) => x.id === "direction") && withDir.components.some((x) => x.id === "odds"));
  assert.ok(withDir.score > base.score, "strong research evidence moves the lean");
  const forming = buildOutlook({ candles: c, forming: true });
  assert.equal(forming.asOf, c[c.length - 2].t, "today's unfinished bar is not 'the last session'");
  assert.equal(buildOutlook({ candles: c.slice(0, 10) }).available, false);
});

/* -------------------------------------------------------------------------- weighing analysts */

const det = (lean, confidence = 80, extra = {}) => ({ lean, confidence, gates: [], last: 1000, stats: { dailyAtr: 20 }, circuit: null, session: SESSION, window: { low: 995, high: 1005 }, plans: { long: { side: "long", entry: 1000, stop: 996, targets: [1004, 1008], riskPerShare: 4 }, short: { side: "short", entry: 1000, stop: 1004, targets: [996, 992], riskPerShare: 4 } }, ...extra });
const vote = (id, bias, confidence = "medium", extra = {}) => ({ id, name: id, bias, confidence, long: { take: false }, short: { take: false }, low: null, high: null, ...extra });
const ctx = { last: 1000, atr: 20, circuit: null, session: SESSION, checkPlan };

test("combine: analysts that agree with the engine make a call; the call's plan passes the same checks as any other", () => {
  const votes = ["a", "b", "c", "d"].map((id) => vote(id, "up", "high", { long: { take: true, entry: 1000, stop: 996.5, target: 1004.5 } }));
  const r = combine({ kind: "live", det: det("up"), votes, ctx });
  assert.equal(r.mode, "ensemble");
  assert.equal(r.call, "long");
  assert.ok(r.agreement >= 90 && r.score > 60);
  assert.equal(r.plans.long.source, "consensus");
  assert.equal(r.plans.long.checkStatus, "passed");
  assert.equal(r.plans.short.checkStatus, "passed", "the short plan is shown too");
  assert.match(r.headline, /LONG/);
});

test("combine: split analysts, or an engine that disagrees, mean 'wait' — never a forced call", () => {
  const split = combine({ kind: "live", det: det("up"), votes: [vote("a", "up"), vote("b", "down"), vote("c", "down"), vote("d", "sideways")], ctx });
  assert.equal(split.call, "wait");
  assert.ok(split.agreement < 60);
  const opposed = combine({ kind: "live", det: det("down", 70), votes: ["a", "b", "c", "d", "e"].map((id) => vote(id, "up", "high")), ctx });
  assert.equal(opposed.call, "wait", "the models are bullish but the desk's own engine is bearish");
  assert.ok(opposed.gates.some((g) => /desk's own engine reads the other way/.test(g)));
  assert.ok(opposed.dissent.length === 0 && opposed.lean === "up");
  const gated = combine({ kind: "live", det: det("up", 80, { gates: ["Volume is thin."] }), votes: ["a", "b", "c"].map((id) => vote(id, "up", "high")), ctx });
  assert.equal(gated.call, "wait");
  assert.match(gated.headline, /stand aside: Volume is thin/);
});

test("combine: with no analyst at all the desk's own read stands, in full", () => {
  const r = combine({ kind: "live", det: det("up", 90), votes: [], ctx });
  assert.equal(r.mode, "engine-only");
  assert.ok(r.notes.some((n) => /desk's own arithmetic/.test(n)));
  assert.equal(r.lean, "up");
  assert.equal(r.plans.long.source, "engine");
  assert.deepEqual(r.dissent, []);
});

test("combine: a plan that fails the arithmetic checks is not called", () => {
  const bad = det("up", 90, { plans: { long: { side: "long", entry: 1000, stop: 999.95, targets: [1000.1, 1000.2], riskPerShare: 0.05 }, short: { side: "short", entry: 1000, stop: 1004, targets: [996, 992] } } });
  const r = combine({ kind: "live", det: bad, votes: [vote("a", "up", "high"), vote("b", "up", "high")], ctx });
  assert.equal(r.plans.long.checkStatus, "rejected");
  assert.equal(r.call, "wait");
  assert.ok(r.notes.some((n) => /did not pass the arithmetic checks/.test(n)));
});

test("combine for the next session: bias words, plain plan checks", () => {
  const o = { lean: "down", confidence: 75, gates: [], last: 500, range: { low: 490, high: 508, atr: 10 }, plans: { long: { side: "long", entry: 506, stop: 498, targets: [514, 520] }, short: { side: "short", entry: 496, stop: 504, targets: [488, 480] } } };
  const r = combine({ kind: "research", det: o, votes: ["a", "b", "c"].map((id) => vote(id, "down", "high")), ctx: { last: 500, atr: 10 } });
  assert.equal(r.call, "short-bias");
  assert.match(r.headline, /leans DOWN/);
  assert.equal(r.plans.short.checkStatus, "passed");
  assert.equal(sanePlan({ side: "long", entry: 100, stop: 101, targets: [105] }, 100, 2).ok, false, "a long's stop above its entry");
  assert.equal(sanePlan({ side: "long", entry: 100, stop: 98, targets: [101] }, 100, 2).ok, false, "a first target nearer than the stop");
  assert.equal(sanePlan({ side: "long", entry: 100, stop: 98, targets: [104] }, 100, 2).ok, true);
});

test("votes are cleaned: an unknown bias is sideways, a half-given plan is no plan, numbers are rounded to the tick", () => {
  const v = cleanVote({ bias: "moon", confidence: "certain", summary: "x".repeat(2000), expected_low: 99.97, expected_high: -4, long: { take: true, entry: 100.02, stop: 99, target: 0 }, short: { take: true, entry: 100.03, stop: 101.01, target: 98.5 }, key_levels: [101, "x", -1], reasons: "no" });
  assert.equal(v.bias, "sideways");
  assert.equal(v.confidence, "low");
  assert.equal(v.summary.length, 900);
  assert.equal(v.low, 99.97);
  assert.equal(v.high, null);
  assert.deepEqual(v.long, { take: false });
  assert.deepEqual(v.short, { take: true, entry: 100.05, stop: 101, target: 98.5 });
  assert.deepEqual(v.levels, [101]);
  assert.deepEqual(v.reasons, []);
});

test("consensus plan: the median of the analysts' prices and the engine's, but only when two or more would take it", () => {
  const e = { side: "long", entry: 1000, stop: 996, targets: [1004, 1008] };
  assert.equal(consensusPlan("long", e, [vote("a", "up", "high", { long: { take: true, entry: 1001, stop: 995, target: 1005 } })]).source, "engine");
  const c = consensusPlan("long", e, [vote("a", "up", "high", { long: { take: true, entry: 1001, stop: 995, target: 1006 } }), vote("b", "up", "high", { long: { take: true, entry: 999, stop: 997, target: 1010 } })]);
  assert.equal(c.source, "consensus");
  assert.equal(c.n, 2);
  assert.equal(c.entry, 1000);
  assert.equal(c.stop, 996);
  assert.equal(c.targets[0], 1006);
});

test("weights follow each analyst's record, only after enough scored calls, and never below 0.4 or above 1.6", () => {
  assert.equal(weightFromRecord(null), 1);
  assert.equal(weightFromRecord({ right: 9, wrong: 1 }), 1, "ten calls are too few to judge");
  assert.equal(weightFromRecord({ right: 28, wrong: 2 }), 1.6);
  assert.equal(weightFromRecord({ right: 2, wrong: 28 }), 0.4);
  assert.equal(weightFromRecord({ right: 15, wrong: 15, flat: 40 }), 1, "flat calls do not count either way");
  const w = weigh({ det: det("up"), votes: [vote("good", "up", "high"), vote("bad", "down", "high")], weights: { good: 1.6, bad: 0.4 }, thresholds: { lean: 25 } });
  assert.ok(w.score > 0, "the analyst with the better record outweighs the one with the worse");
});

test("judge: right, wrong and flat against what price did", () => {
  assert.equal(judge("up", 0.3, "live"), "right");
  assert.equal(judge("up", -0.3, "live"), "wrong");
  assert.equal(judge("up", 0.03, "live"), "flat");
  assert.equal(judge("down", -0.5, "research"), "right");
  assert.equal(judge("sideways", 0.02, "live"), "right");
  assert.equal(judge("sideways", 0.9, "research"), "wrong");
});

/* ------------------------------------------------------------ a whole run against fake companies */

const KEYS = { openai: "sk-TESTONLYtestonlyTESTONLY1234567890abcd", anthropic: "sk-ant-api03-TESTONLYtestonlyTESTONLY1234567890abcd" };
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

function boot({ sessionBars, bias = {}, webFails = false, anthropicDown = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-ens-"));
  const clock = { ms: at("10:40") };
  const b = sessionBars || bars5(30, 1000, 0.8);
  const day = dayOf(b, { state: "long", score: 70, headline: "LONG in play", fast: UP_FAST });
  const pulseOut = { ...buildPulse({ day, bars5: b, fast: UP_FAST }), symbol: "SBIN", circuit: null, session: day.session };
  const market = {
    seen: [],
    mode: () => "kite",
    now: () => clock.ms,
    pulse: async () => pulseOut,
    verdict: async () => ({ available: true, source: "kite", day, circuit: null }),
    tape: async (s, step) => ({ available: true, tape: { today: true, bars: step === 1 ? b.slice(-15) : b } }),
    context: async () => ({ available: true, tide: { score: 10, label: "mildly positive" }, nifty: {}, vix: {} }),
    // Kite's own timestamp format, with the zone
    intradayOn: async (symbol, date) => b.map((x) => ({ ...x, t: `${date}T${x.t}:00+0530` })),
  };
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push(u);
    const answerVote = (model) => {
      const bi = bias[model] || "up";
      const up = bi === "up";
      const down = bi === "down";
      return {
        bias: bi,
        confidence: "high",
        summary: `${model} reads ${bi}.`,
        expected_low: 1018,
        expected_high: 1030,
        long: up ? { take: true, entry: pulseOut.last, stop: pulseOut.plans.long.stop, target: pulseOut.plans.long.targets[0] } : { take: false, entry: 0, stop: 0, target: 0 },
        short: down ? { take: true, entry: pulseOut.last, stop: pulseOut.plans.short.stop, target: pulseOut.plans.short.targets[0] } : { take: false, entry: 0, stop: 0, target: 0 },
        key_levels: [1020],
        reasons: ["Price is above VWAP."],
        risks: ["Thin tape."],
        change_my_mind: ["A close under VWAP."],
      };
    };
    if (u.includes("api.openai.com")) {
      // the fallback company (OpenAI-style chat completions)
      const reply = answerVote(body.model);
      return json(200, { model: body.model, choices: [{ message: { role: "assistant", content: JSON.stringify(reply) }, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 200 } });
    }
    if (u.includes("api.anthropic.com")) {
      if (anthropicDown) return json(500, { type: "error", error: { type: "api_error", message: "down" } });
      if (webFails && body.tools) return json(500, { type: "error", error: { type: "api_error", message: "down" } });
      if (body.tools) return json(200, { id: "m", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: "Nothing specific found for this company today." }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 500, output_tokens: 80 } });
      const req = (body.output_config && body.output_config.format && body.output_config.format.schema && body.output_config.format.schema.required) || [];
      let reply;
      if (req.includes("bias")) reply = answerVote(body.model);
      else if (req.includes("tone")) reply = { tone: "none", headline: "No company-specific news found.", explains_move: "unknown", items: [], upcoming: [], caveats: [] };
      else reply = { mood: "mixed", headline: "Mixed overseas cues.", cues: [], india_read: "Flat.", sectors: [], events: [], caveats: [] };
      return json(200, { id: "m", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: JSON.stringify(reply) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1500, output_tokens: 300 } });
    }
    return json(404, { error: { message: `no fake for ${u}` } });
  };
  const store = { data: { settings: {} }, update(fn) { fn(this.data); } };
  const ai = new AiService({ dir, store, secrets: { encrypt: (x) => `enc:${Buffer.from(x).toString("base64")}`, decrypt: (x) => Buffer.from(x.slice(4), "base64").toString() }, market, fetchImpl, now: () => clock.ms, log: { log() {} } });
  ai.ensemble.account = async () => ({ position: { quantity: 40, average: 1003, product: "MIS" }, funds: { available: 150000 } });
  return { ai, store, clock, calls, market, dir, pulseOut };
}

const finish = async (ai, id) => {
  for (let i = 0; i < 400; i += 1) {
    const j = ai.ensemble.job(id);
    if (j.finishedAt) return j;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("the run did not finish");
};

test("a whole AI Live run: the default model does the web research, reads the same brief, and the call is weighed and recorded", async () => {
  const s = boot();
  s.ai.setSettings({ provider: "anthropic", apiKey: KEYS.anthropic });
  const st = s.ai.ensemble.status();
  assert.equal(st.roster.lead.model, "claude-sonnet-5-5", "Claude Sonnet 5.5 is the default model");
  assert.equal(st.roster.lead.provider, "anthropic");
  assert.deepEqual(st.roster.fallbacks, []);
  assert.equal(st.ready, true);
  assert.equal(st.settings.useFree, undefined, "no free-model settings are left");

  const started = s.ai.ensemble.start("live", "SBIN");
  assert.equal(started.finishedAt, null);
  assert.equal(s.ai.ensemble.start("live", "SBIN").id, started.id, "pressing the button twice does not run it twice");
  const job = await finish(s.ai, started.id);
  assert.equal(job.error, "");
  assert.equal(job.stage, "done");
  const r = job.result;
  assert.equal(r.analysts.length, 1, "one analyst: the default model");
  assert.equal(r.analysts[0].status, "answered");
  assert.equal(r.analysts[0].name, "Claude Sonnet 5.5");
  assert.equal(r.final.mode, "ensemble");
  assert.equal(r.final.call, "long");
  assert.ok(r.final.agreement >= 90);
  assert.equal(r.final.plans.long.checkStatus, "passed");
  assert.deepEqual(job.steps.map((x) => x.id), ["data", "web", "analysts", "combine"]);
  assert.equal(r.web.used, true);
  assert.ok(r.usage.paid.inputTokens >= 1500);
  assert.equal(r.usage.free, undefined);
  // every request went to the default model's company
  assert.ok(s.calls.length > 0 && s.calls.every((u) => u.includes("api.anthropic.com")));
  // the page can read the last run for free
  assert.equal(s.ai.ensemble.last("live", "SBIN").id, r.id);

  // a second run within 30 minutes reuses the web research; on the very same snapshot the engine also
  // reuses the analysis already paid for — no call at all, and no extra run counted against the limit
  const before = s.calls.length;
  const runs = s.ai.ensemble.status().paidRunsToday;
  const again = await finish(s.ai, s.ai.ensemble.start("live", "SBIN").id);
  assert.equal(again.result.web.news.repeated, true);
  assert.equal(s.calls.length - before, 0);
  assert.equal(s.ai.ensemble.status().paidRunsToday, runs);
});

test("with no AI key at all the run is the desk's own arithmetic, in full, and nothing is called", async () => {
  const s = boot();
  const st = s.ai.ensemble.status();
  assert.equal(st.ready, false);
  const job = await finish(s.ai, s.ai.ensemble.start("live", "SBIN").id);
  assert.equal(job.error, "");
  assert.equal(job.result.final.mode, "engine-only");
  assert.equal(job.result.final.call, "long", "the engine's own call is kept");
  assert.ok(job.result.final.notes.some((n) => /No AI key is saved/.test(n)));
  assert.equal(s.calls.length, 0);
});

test("a model that disagrees is outvoted, not obeyed; when the default fails the fallback answers; when every model fails the engine's answer stands", async () => {
  const s = boot({ bias: { "claude-sonnet-5-5": "down" } });
  s.ai.setSettings({ provider: "anthropic", apiKey: KEYS.anthropic });
  const job = await finish(s.ai, s.ai.ensemble.start("live", "SBIN").id);
  assert.equal(job.result.analysts[0].bias, "down");
  assert.notEqual(job.result.final.call, "short", "one bearish model against a bullish engine never turns the call short");
  assert.notEqual(job.result.final.lean, "down");

  // the default model is down; OpenAI's key is saved too, so it answers as the fallback
  const f = boot({ anthropicDown: true });
  f.ai.setSettings({ provider: "anthropic", apiKey: KEYS.anthropic });
  f.ai.setSettings({ provider: "openai", apiKey: KEYS.openai, use: false });
  assert.equal(f.ai.ensemble.status().roster.fallbacks[0].provider, "openai");
  const fj = await finish(f.ai, f.ai.ensemble.start("live", "SBIN").id);
  assert.equal(fj.error, "");
  assert.equal(fj.result.analysts.length, 1);
  assert.equal(fj.result.analysts[0].status, "answered");
  assert.equal(fj.result.analysts[0].fallbackFrom, "Claude Sonnet 5.5");
  assert.match(fj.result.analysts[0].id, /^openai\|/);
  assert.equal(fj.result.final.mode, "ensemble");
  assert.ok(f.calls.some((u) => u.includes("api.openai.com")));
  // with the fallback switch off, the other company is never asked
  f.ai.setSettings({ fallback: false });
  const before = f.calls.filter((u) => u.includes("api.openai.com")).length;
  const off = await finish(f.ai, f.ai.ensemble.start("live", "TCS").id);
  assert.equal(off.result.final.mode, "engine-only");
  assert.equal(f.calls.filter((u) => u.includes("api.openai.com")).length, before);

  // the same fake world, but now every call fails
  const s2 = boot();
  s2.ai.setSettings({ provider: "anthropic", apiKey: KEYS.anthropic });
  s2.ai.fetch = async () => json(500, { error: { message: "down" } });
  const j2 = await finish(s2.ai, s2.ai.ensemble.start("live", "SBIN").id);
  assert.equal(j2.error, "");
  assert.equal(j2.result.final.mode, "engine-only");
  assert.ok(j2.result.final.notes.some((n) => /Every analyst failed/.test(n)));
  assert.equal(j2.result.analysts.every((a) => a.status === "failed"), true);
});

test("the AI model is optional: switched off, it is never called; a failed web search does not stop the run; runs are capped per day", async () => {
  const s = boot();
  s.ai.setSettings({ provider: "anthropic", apiKey: KEYS.anthropic });
  s.ai.ensemble.setSettings({ usePaid: false });
  const offJob = await finish(s.ai, s.ai.ensemble.start("live", "SBIN").id);
  assert.equal(s.calls.length, 0, "no model call");
  assert.equal(offJob.result.final.mode, "engine-only");
  assert.ok(offJob.result.final.notes.some((n) => /switched off/.test(n)));
  const f = boot({ webFails: true });
  f.ai.setSettings({ provider: "anthropic", apiKey: KEYS.anthropic });
  const job = await finish(f.ai, f.ai.ensemble.start("live", "SBIN").id);
  assert.equal(job.error, "");
  assert.equal(job.steps.find((x) => x.id === "web").status, "failed");
  assert.equal(job.result.analysts.filter((a) => a.status === "answered").length, 1);
  // a daily limit on AI runs
  f.ai.ensemble.setSettings({ paidDailyCap: 0 });
  const capped = await finish(f.ai, f.ai.ensemble.start("live", "SBIN").id);
  assert.ok(capped.result.final.notes.some((n) => /AI model has done its 0 runs/.test(n)));
  assert.equal(capped.result.analysts.length, 0);
  assert.equal(capped.result.final.mode, "engine-only");
  assert.throws(() => f.ai.ensemble.setSettings({ deadlineSec: 5 }), /between 20 and 180/);
});

test("a market that is not live stops AI Live with a plain reason; nothing is asked of any model", async () => {
  const s = boot();
  s.ai.setSettings({ provider: "anthropic", apiKey: KEYS.anthropic });
  s.market.pulse = async () => ({ available: false, reason: "The market is closed." });
  const job = await finish(s.ai, s.ai.ensemble.start("live", "SBIN").id);
  assert.equal(job.stage, "failed");
  assert.match(job.error, /market is closed/);
  assert.equal(s.calls.length, 0);
  assert.throws(() => s.ai.ensemble.start("moon", "SBIN"), /Unknown kind/);
  assert.throws(() => s.ai.ensemble.start("live", "bad symbol!"), /not a valid symbol/);
  assert.throws(() => s.ai.ensemble.job("nope"), /No such AI run/);
});

test("scoring: a live call is judged against the price thirty minutes later, and the model's record is kept", async () => {
  const s = boot();
  s.ai.setSettings({ provider: "anthropic", apiKey: KEYS.anthropic });
  const job = await finish(s.ai, s.ai.ensemble.start("live", "SBIN").id);
  assert.equal(await s.ai.ensemble.score(), 0, "not due yet");
  s.clock.ms += 31 * 60000;
  // the price thirty minutes later: the fake day's bars end higher than the call was made
  assert.equal(await s.ai.ensemble.score(), 1);
  const rec = await s.ai.ensemble.record();
  const final = rec.rows.find((r) => r.id === "final");
  assert.equal(final.right + final.wrong + final.flat, 1);
  assert.ok(rec.rows.find((r) => r.id === "engine"));
  assert.equal(rec.rows.filter((r) => r.id === "anthropic|claude-sonnet-5-5").length, 1);
  assert.equal(rec.recent[0].id, job.id);
  assert.equal(rec.recent[0].scored.movePct !== null, true);
  assert.equal(await s.ai.ensemble.score(), 0, "scored once");
});

test("the ensemble can never trade, and holds no timer", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "ai", "ensemble.js"), "utf8");
  assert.ok(!/kite\.trade|\/orders|place_order|placeOrder|\/gtt|\/portfolio|\/margins/i.test(src));
  assert.ok(!/setInterval|setTimeout|cron/i.test(src));
  assert.ok(!/require\([^)]*(trading|broker)/.test(src));
});

test("outlook plans always pay at least their risk on the first target — a pivot too close is not used", () => {
  for (const drift of [0.9, -0.9, 0.05]) {
    const o = buildOutlook({ candles: daily(160, drift) });
    for (const sd of ["long", "short"]) {
      const p = o.plans[sd];
      assert.ok(Math.abs(p.targets[0] - p.entry) >= Math.abs(p.entry - p.stop) * 1.09, `${sd} at drift ${drift}: ${JSON.stringify(p)}`);
      assert.equal(sanePlan(p, o.last, o.range.atr).ok, true, `${sd} at drift ${drift} passes the plain checks`);
    }
  }
});

test("a run for a list of stocks (engineOnly) is the desk's arithmetic: no model and no web search, even with a key saved", async () => {
  const s = boot();
  s.ai.setSettings({ provider: "anthropic", apiKey: KEYS.anthropic });
  s.ai.setSettings({ provider: "openai", apiKey: KEYS.openai, use: false });
  const job = await finish(s.ai, s.ai.ensemble.start("live", "SBIN", { engineOnly: true }).id);
  assert.equal(job.error, "");
  assert.equal(job.result.analysts.length, 0);
  assert.equal(job.result.final.mode, "engine-only");
  assert.ok(job.result.final.notes.some((n) => /list of stocks/.test(n)));
  assert.equal(s.calls.length, 0, "no model call and no web search");
  assert.equal(job.steps.some((x) => x.id === "web"), false);
});
