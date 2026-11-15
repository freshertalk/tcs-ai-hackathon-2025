"use strict";
// The ensemble: several independent analysts on one stock, weighed together with the desk's own
// arithmetic — started by a button, never by a timer.
//
//   AI Live      the next 15–30 minutes of the stock that is open
//   AI Research  the next trading session
//
// The desk's deterministic engines (market/pulse.js for the live window, market/outlook.js for the
// next session, on top of the existing live call, research direction and measured odds) answer
// FIRST and without any AI: they are the floor. If no AI key is saved, every model fails, or the
// network is down, the result is that engine's answer — same shape, same plans — and the page says
// so. AI is optional; it can only add to the arithmetic, never be required by it.
//
// Analysts:
//   • every FREE NVIDIA-hosted model with a saved key (Nemotron ×4, Mistral Large 4, DeepSeek
//     V4.1 Flash, Gemma 4) — they cannot browse, so they work from the numbers they are given;
//   • one optional PAID "lead" (the company chosen on the AI page, else the first saved Anthropic /
//     OpenAI / Gemini key) which first does the web search — company news and world markets, kept
//     30 minutes so credits are not spent twice — and then analyses like the rest, with a little
//     more say because it has read the news.
// Every analyst gets the identical instructions, schema and snapshot. They answer in parallel.
//
// The combination is arithmetic too: each vote (the desk's own included) carries a weight, adjusted
// by how well that analyst's past calls scored against real prices; the lean is the weighted sum
// and the agreement is the share of weight on the winning side. A long or short is only called when
// the lean is clear, the agreement is high, the desk's engine does not oppose, no gate is shut, and
// the plan passes the same arithmetic checks as every other plan (checkPlan). Otherwise the call is
// "wait" — which is a position. Plans for BOTH sides are always shown.
//
// Nothing in this file can place an order, touches the broker, or runs on a timer. Agreement is
// not a probability of profit and nothing here can promise a winning trade.

const crypto = require("crypto");
const { PROVIDERS, providerOf, makeClient, SEARCH_ORDER } = require("./providers");
const { AiError } = require("./client");
const { buildDirection } = require("../market/direction");
const { buildOutlook } = require("../market/outlook");
const { sheet } = require("./research");
const { barStart } = require("../market/intraday");

const SETTINGS_DEFAULT = { useFree: true, usePaid: true, freeModels: null, paidDailyCap: 40, deadlineSec: 75 };
const NAME = "ai/ensemble.json";
const LAST = "ai/ensemble-last.json";
const MAX_PREDS = 400;
const MAX_JOBS = 40;
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9&._-]{0,24}$/;
const IST = 5.5 * 3600 * 1000;
const FLAT = { live: 0.08, research: 0.25 }; // a move smaller than this (in %) counts as flat
const LEAD_WEIGHT = 1.5;
const ENGINE_WEIGHT = 3;
const CONF = { low: 0.5, medium: 0.75, high: 1 };
const MIN_DECIDED = 20;

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const str = (x, n) => String(x == null ? "" : x).replace(/\s+/g, " ").trim().slice(0, n);
const list = (x, max, n) => (Array.isArray(x) ? x : []).map((v) => str(v, n)).filter(Boolean).slice(0, max);
const pos = (x) => (num(Number(x)) && Number(x) > 0 ? Number(x) : null);
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const median = (xs) => {
  const a = xs.filter(num).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const onTick = (x) => (num(x) ? r2(Math.round(x / 0.05) * 0.05) : null);

/* --------------------------------------------------------------------------------- the questions */

const COMMON = `You are one of several independent analysts on a private trading desk for NSE (India) cash equities. A single trader reads the combined result and decides for themselves; you never place orders and you cannot browse the internet.

How to work:
- Use only the numbers in the snapshot. Quote them. Never invent a price, a level, an event or a date. If something you need is missing, say so in "risks".
- The desk's own arithmetic read is in the snapshot (its lean, the evidence for and against it, its plans). You may disagree with it when the data supports it; say why. When you agree, add what its fixed rules cannot see.
- "Web context" (company news, world markets), when present, was gathered by a search model and can be stale, incomplete or wrong. Treat it as background, never as a trigger.
- Weigh evidence on BOTH sides: the case for a long and the case for a short. "sideways" is a respectable answer when the evidence is split — it is a position, not a failure.
- Every plan needs a numeric entry, a stop on the losing side and a target on the winning side; set "take" to false (and the prices to 0) for a side you would not trade. The first target must be at least as far as the stop. A short in the cash market is intraday-only.
- If the trader already holds this stock, say in "summary" what your read means for that position.
- Never promise or imply a profit, a win rate or a probability. Confidence is low, medium or high: how well the evidence agrees. Short, concrete sentences with the actual numbers.`;

const LIVE_SYSTEM = `${COMMON}

Task — LIVE: decide where this stock is more likely to go over the NEXT 15 TO 30 MINUTES, using the live snapshot: price against VWAP, the last 15 and 30 minutes, volume, RSI, structure, the opening range, candle patterns, the order book if present, and the desk's live call. Entries are valid only between 9:30 AM and 2:45 PM IST; everything is closed before the 3:15 PM square-off. Keep the stop between about 0.12 and 0.8 times the daily ATR from the entry. "expected_low" and "expected_high" are the range you expect over the next 30 minutes.`;

const RESEARCH_SYSTEM = `${COMMON}

Task — NEXT SESSION: using the data sheet (daily indicators, levels, backtests on this stock, the research direction, the measured odds and the desk's next-session outlook), decide where this stock is more likely to go in the NEXT TRADING SESSION and how to prepare for it. Prices in the plans are for the next session: "entry" is the trigger price. Keep the stop between about 0.3 and 1.2 times the daily ATR from the entry. "expected_low" and "expected_high" are the range you expect for the session. "gap_view" is how you expect it to open.`;

const side = (what) => ({
  type: "object",
  additionalProperties: false,
  required: ["take", "entry", "stop", "target"],
  properties: {
    take: { type: "boolean", description: `Would you take a ${what} on this evidence?` },
    entry: { type: "number", description: "Entry price; 0 when take is false." },
    stop: { type: "number", description: "Stop-loss price on the losing side; 0 when take is false." },
    target: { type: "number", description: "First target price; 0 when take is false." },
  },
});
const VOTE_PROPS = {
  bias: { type: "string", enum: ["up", "down", "sideways"], description: "Where the price is more likely to go over the horizon asked." },
  confidence: { type: "string", enum: ["low", "medium", "high"], description: "How well the evidence agrees. Not a probability." },
  summary: { type: "string", description: "Two or three sentences: what the data says and what to do about it." },
  expected_low: { type: "number", description: "The low of the range you expect over the horizon asked." },
  expected_high: { type: "number", description: "The high of the range you expect over the horizon asked." },
  long: side("long"),
  short: side("short"),
  key_levels: { type: "array", items: { type: "number" }, description: "Up to four prices that matter most, from the snapshot." },
  reasons: { type: "array", items: { type: "string" }, description: "Two to four concrete reasons, each with its numbers." },
  risks: { type: "array", items: { type: "string" }, description: "What could make this wrong, including what the snapshot cannot show." },
  change_my_mind: { type: "array", items: { type: "string" }, description: "Specific prices or events that would flip the read." },
};
const LIVE_SCHEMA = { type: "object", additionalProperties: false, required: Object.keys(VOTE_PROPS), properties: VOTE_PROPS };
const RESEARCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...Object.keys(VOTE_PROPS), "gap_view"],
  properties: { ...VOTE_PROPS, gap_view: { type: "string", enum: ["gap-up", "gap-down", "flat"], description: "How you expect the next session to open." } },
};

/* ------------------------------------------------------------------------------ pure arithmetic */

/** A model's answer, cleaned into the fixed shape (and nothing it said is trusted blindly). */
function cleanVote(d) {
  const b = ["up", "down", "sideways"].includes(d.bias) ? d.bias : "sideways";
  const plan = (p) => {
    p = p && typeof p === "object" ? p : {};
    const take = p.take === true && pos(p.entry) && pos(p.stop) && pos(p.target);
    return take ? { take: true, entry: onTick(Number(p.entry)), stop: onTick(Number(p.stop)), target: onTick(Number(p.target)) } : { take: false };
  };
  return {
    bias: b,
    confidence: ["low", "medium", "high"].includes(d.confidence) ? d.confidence : "low",
    summary: str(d.summary, 900),
    low: pos(d.expected_low),
    high: pos(d.expected_high),
    long: plan(d.long),
    short: plan(d.short),
    levels: (Array.isArray(d.key_levels) ? d.key_levels : []).map(Number).filter((x) => x > 0).slice(0, 4),
    reasons: list(d.reasons, 4, 300),
    risks: list(d.risks, 4, 300),
    change: list(d.change_my_mind, 3, 240),
    gap: ["gap-up", "gap-down", "flat"].includes(d.gap_view) ? d.gap_view : null,
  };
}

const dirOf = (bias) => (bias === "up" || bias === "long" || bias === "long-bias" ? 1 : bias === "down" || bias === "short" || bias === "short-bias" ? -1 : 0);

/**
 * Weigh the desk's own answer and the analysts' votes into one lean and one agreement.
 * @param det     the deterministic read: { lean, confidence, call }
 * @param votes   [{ id, bias, confidence, lead }]
 * @param weights { [id]: multiplier } from each analyst's record
 */
function weigh({ det, votes, weights = {}, thresholds }) {
  const rows = [{ id: "engine", name: "The desk's engine", bias: det.lean === "up" ? "up" : det.lean === "down" ? "down" : "sideways", factor: clamp((det.confidence || 0) / 100, 0.3, 1), w: ENGINE_WEIGHT }];
  for (const v of votes) rows.push({ id: v.id, name: v.name, bias: v.bias, factor: CONF[v.confidence] || 0.5, w: (weights[v.id] || 1) * (v.lead ? LEAD_WEIGHT : 1) });
  const total = rows.reduce((s, r) => s + r.w, 0);
  const score = Math.round((rows.reduce((s, r) => s + dirOf(r.bias) * r.factor * r.w, 0) / total) * 100);
  const by = { up: 0, down: 0, sideways: 0 };
  for (const r of rows) by[r.bias] += r.w;
  const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
  const agreement = Math.round((top[1] / total) * 100);
  const lean = score >= thresholds.lean ? "up" : score <= -thresholds.lean ? "down" : "sideways";
  const confidence = clamp(Math.round(agreement * (Math.min(Math.abs(score), 60) / 60) * 0.5 + agreement * 0.5), 0, 100);
  return { rows, score, lean, agreement, confidence, shares: { up: Math.round((by.up / total) * 100), down: Math.round((by.down / total) * 100), sideways: Math.round((by.sideways / total) * 100) } };
}

/** The analyst's weight from its own record: 1 until MIN_DECIDED calls are scored, then 0.4–1.6. */
function weightFromRecord(t) {
  if (!t) return 1;
  const decided = (t.right || 0) + (t.wrong || 0);
  if (decided < MIN_DECIDED) return 1;
  return clamp(1 + ((t.right || 0) / decided - 0.5) * 1.5, 0.4, 1.6);
}

/** The plan of one side from the analysts that would take it, with the desk's plan as the base. */
function consensusPlan(sideName, enginePlan, votes) {
  const mine = votes.filter((v) => v[sideName] && v[sideName].take);
  const entries = [enginePlan && enginePlan.entry, ...mine.map((v) => v[sideName].entry)];
  const stops = [enginePlan && enginePlan.stop, ...mine.map((v) => v[sideName].stop)];
  const t1 = [enginePlan && (enginePlan.targets ? enginePlan.targets[0] : enginePlan.target), ...mine.map((v) => v[sideName].target)];
  if (!enginePlan || mine.length < 2) return { ...(enginePlan || {}), source: "engine", n: 0 };
  const entry = onTick(median(entries));
  const stop = onTick(median(stops));
  const tgt = onTick(median(t1));
  const risk = Math.abs(entry - stop);
  const long = sideName === "long";
  return { side: sideName, entry, stop, targets: [tgt, onTick(long ? entry + 2 * risk : entry - 2 * risk)].sort((a, b) => (long ? a - b : b - a)), riskPerShare: r2(risk), riskPct: r2((risk / entry) * 100), rewardToRisk: r2(Math.abs(tgt - entry) / risk), source: "consensus", n: mine.length };
}

/** Plain arithmetic for a next-session plan (checkPlan's clock rules belong to the live session only). */
function sanePlan(plan, last, atr) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });
  const long = plan.side === "long";
  const tg = (plan.targets || [])[0];
  add("Entry, stop and target are given", num(plan.entry) && num(plan.stop) && num(tg), `entry ${plan.entry}, stop ${plan.stop}, target ${tg}`);
  if (!checks[0].ok) return { ok: false, checks };
  const risk = Math.abs(plan.entry - plan.stop);
  add("Stop is on the losing side", long ? plan.stop < plan.entry : plan.stop > plan.entry, `a ${plan.side} needs its stop ${long ? "below" : "above"} ${plan.entry}`);
  add("Target is on the winning side", long ? tg > plan.entry : tg < plan.entry, `target ${tg}`);
  if (num(atr) && atr > 0) {
    add("Stop distance is sensible", risk >= 0.2 * atr && risk <= 1.5 * atr, `${(risk / atr).toFixed(2)} × the daily ATR (allowed 0.2–1.5)`);
    if (num(last)) add("Entry is within reach of the last price", Math.abs(plan.entry - last) <= 1.5 * atr, `${(Math.abs(plan.entry - last) / atr).toFixed(2)} × ATR from ${last}`);
  }
  add("First target is at least as far as the stop", risk > 0 && Math.abs(tg - plan.entry) >= risk, `${risk > 0 ? r2(Math.abs(tg - plan.entry) / risk) : "—"} × the risk`);
  return { ok: checks.every((c) => c.ok), checks };
}

/**
 * The final call. Pure: the same inputs always give the same answer.
 * @param kind     "live" | "research"
 * @param det      pulse (live) or outlook (research), available
 * @param votes    cleaned analyst votes
 * @param ctx      { last, atr, circuit, session, checkPlan }
 */
function combine({ kind, det, votes, weights = {}, ctx }) {
  const live = kind === "live";
  const th = live ? { lean: 25, call: 30, agree: 60 } : { lean: 22, call: 25, agree: 60 };
  const w = weigh({ det, votes, weights, thresholds: th });
  const mode = votes.length ? "ensemble" : "engine-only";
  const notes = [];
  const plans = {};
  for (const sd of ["long", "short"]) {
    const base = det.plans ? det.plans[sd] : null;
    if (!base) continue;
    const p = mode === "ensemble" ? consensusPlan(sd, base, votes) : { ...base, source: "engine", n: 0 };
    let verdict;
    if (live) {
      verdict = ctx.checkPlan({ horizon: "intraday", action: sd, entry_type: "at_market", entry: p.entry, stop: p.stop, targets: p.targets, rationale: "", invalidation: "" }, { last: ctx.last, atr: ctx.atr, circuit: ctx.circuit, session: ctx.session });
      verdict = { ok: verdict.status === "passed", checks: verdict.checks };
    } else verdict = sanePlan({ ...p, side: sd }, ctx.last, ctx.atr);
    plans[sd] = { ...p, side: sd, checks: verdict.checks, checkStatus: verdict.ok ? "passed" : "rejected" };
  }
  // the desk's own engine must not be on the other side of the call
  const engineSide = dirOf(det.lean);
  const opposed = (w.lean === "up" && engineSide < 0) || (w.lean === "down" && engineSide > 0);
  const dissent = votes.filter((v) => dirOf(v.bias) !== 0 && dirOf(v.bias) === -dirOf(w.lean)).map((v) => v.name);
  const gates = [...(det.gates || [])];
  if (opposed) gates.push("The desk's own engine reads the other way: two methods disagreeing is a reason to stand aside.");
  const strong = Math.abs(w.score) >= th.call && w.agreement >= th.agree && gates.length === 0;
  let call = live ? "wait" : "neutral";
  if (strong) {
    const sd = w.lean === "up" ? "long" : "short";
    if (plans[sd] && plans[sd].checkStatus === "passed") call = live ? sd : `${sd}-bias`;
    else notes.push(`The ${sd} plan did not pass the arithmetic checks, so the call stays at "${live ? "wait" : "neutral"}".`);
  }
  if (mode === "engine-only") notes.push("No AI analyst answered: this is the desk's own arithmetic read, in full.");
  const headline =
    call === "long" || call === "long-bias"
      ? `${live ? "LONG" : "Next session leans UP"} — ${w.agreement}% of the weight agrees`
      : call === "short" || call === "short-bias"
        ? `${live ? "SHORT" : "Next session leans DOWN"} — ${w.agreement}% of the weight agrees`
        : gates.length && w.lean !== "sideways"
          ? `Leans ${w.lean.toUpperCase()}, but stand aside: ${gates[0]}`
          : w.lean === "sideways"
            ? "No clear lean — standing aside is a position"
            : `Leans ${w.lean.toUpperCase()}, not strongly enough to call (${w.agreement}% agree)`;
  const lows = [det.window ? det.window.low : det.range ? det.range.low : null, ...votes.map((v) => v.low)];
  const highs = [det.window ? det.window.high : det.range ? det.range.high : null, ...votes.map((v) => v.high)];
  return {
    mode,
    call,
    lean: w.lean,
    score: w.score,
    agreement: w.agreement,
    confidence: w.confidence,
    shares: w.shares,
    headline,
    gates,
    dissent,
    plans,
    expected: { low: onTick(median(lows)), high: onTick(median(highs)), basis: votes.length ? "the median of the engine's volatility window and the analysts' own ranges" : "the engine's volatility window" },
    weights: w.rows.map((r) => ({ id: r.id, weight: r.w })),
    notes,
  };
}

/** Right, wrong or flat for one lean against what the price then did (move in %). */
function judge(bias, move, kind) {
  const thr = FLAT[kind];
  const d = dirOf(bias);
  if (d === 0) return Math.abs(move) < thr ? "right" : "wrong";
  if (move * d >= thr) return "right";
  if (move * d <= -thr) return "wrong";
  return "flat";
}

/* ------------------------------------------------------------------------------------ the class */

class Ensemble {
  /** @param ai  the AiService. `checkPlan` is passed in (it lives in service.js, which builds this). */
  constructor(ai, { checkPlan }) {
    this.ai = ai;
    this.checkPlan = checkPlan;
    this.account = null; // set by the app: async (symbol) => { position, funds } | null — read-only
    this.jobs = new Map();
    this._cache = new Map(); // outlook, five minutes
  }

  /* ------------------------------------------------------------ settings and roster */

  settings() {
    const s = this.ai.store.data.settings.aiEnsemble || {};
    return {
      useFree: s.useFree !== false,
      usePaid: s.usePaid !== false,
      freeModels: Array.isArray(s.freeModels) ? s.freeModels.filter((x) => typeof x === "string").slice(0, 20) : null,
      paidDailyCap: Number.isFinite(Number(s.paidDailyCap)) && s.paidDailyCap !== null && s.paidDailyCap !== undefined ? clamp(Math.round(Number(s.paidDailyCap)), 0, 500) : SETTINGS_DEFAULT.paidDailyCap,
      deadlineSec: clamp(Math.round(Number(s.deadlineSec)) || SETTINGS_DEFAULT.deadlineSec, 20, 180),
    };
  }

  setSettings(patch = {}) {
    const next = { ...this.settings() };
    if (typeof patch.useFree === "boolean") next.useFree = patch.useFree;
    if (typeof patch.usePaid === "boolean") next.usePaid = patch.usePaid;
    if (patch.freeModels !== undefined) {
      if (patch.freeModels === null) next.freeModels = null;
      else if (Array.isArray(patch.freeModels)) {
        const known = new Set(this._freeCatalogue().map((a) => a.id));
        next.freeModels = patch.freeModels.filter((x) => known.has(x));
      } else throw new AiError("freeModels must be a list.", "invalid", 400);
    }
    for (const k of ["paidDailyCap", "deadlineSec"]) {
      if (patch[k] === undefined) continue;
      const v = Number(patch[k]);
      const [lo, hi] = k === "paidDailyCap" ? [0, 500] : [20, 180];
      if (!Number.isFinite(v) || v < lo || v > hi) throw new AiError(`"${k}" must be between ${lo} and ${hi}.`, "invalid", 400);
      next[k] = Math.round(v);
    }
    this.ai.store.update((d) => {
      d.settings.aiEnsemble = next;
    });
    return this.status();
  }

  /** Every FREE model the app knows, whether or not its key is saved. */
  _freeCatalogue() {
    const out = [];
    for (const p of PROVIDERS.filter((x) => x.free)) for (const m of p.models) out.push({ id: `${p.id}|${m.id}`, provider: p.id, model: m.id, name: m.name, company: p.name, free: true, ready: Boolean(this.ai._key(p.id)) });
    return out;
  }

  /** The paid lead: the company in use when it is paid, else the first saved search-capable one. */
  _lead() {
    const ai = this.ai;
    const inUse = ai._provider();
    let pid = null;
    if (!providerOf(inUse).free && ai._key(inUse)) pid = inUse;
    else pid = SEARCH_ORDER.find((id) => ai._key(id)) || null;
    if (!pid) return null;
    const model = ai._modelOf(pid);
    const name = (ai.modelsFor(pid).find((m) => m.id === model) || {}).name || model;
    return { id: `${pid}|${model}`, provider: pid, model, name, company: providerOf(pid).name, free: false, lead: true, search: Boolean(providerOf(pid).search) };
  }

  roster() {
    const s = this.settings();
    const free = s.useFree ? this._freeCatalogue().filter((a) => a.ready && (!s.freeModels || s.freeModels.includes(a.id))) : [];
    const lead = s.usePaid ? this._lead() : null;
    return { free, lead, analysts: [...(lead ? [lead] : []), ...free], settings: s };
  }

  /* ----------------------------------------------------------------- stored state */

  _state() {
    const d = this.ai.docs.read(NAME, null);
    return { preds: Array.isArray(d && d.preds) ? d.preds : [], tally: d && d.tally && typeof d.tally === "object" ? d.tally : {}, day: d && d.day && d.day.date ? d.day : { date: null, paid: 0 } };
  }

  _save(s) {
    this.ai.docs.write(NAME, s);
  }

  _weights(state) {
    const w = {};
    for (const [id, t] of Object.entries(state.tally)) w[id] = weightFromRecord(t);
    return w;
  }

  status() {
    const r = this.roster();
    const st = this._state();
    const today = istDate(this.ai.now());
    return {
      settings: r.settings,
      catalogue: this._freeCatalogue(),
      roster: { free: r.free, lead: r.lead },
      ready: r.analysts.length > 0,
      paidRunsToday: st.day.date === today ? st.day.paid : 0,
      record: this._recordRows(st),
    };
  }

  _recordRows(st) {
    const rows = Object.entries(st.tally).map(([id, t]) => {
      const decided = (t.right || 0) + (t.wrong || 0);
      return { id, name: t.name || id, right: t.right || 0, wrong: t.wrong || 0, flat: t.flat || 0, decided, accuracyPct: decided ? Math.round(((t.right || 0) / decided) * 100) : null, weight: r2(weightFromRecord(t)), counted: decided >= MIN_DECIDED };
    });
    rows.sort((a, b) => (b.decided >= MIN_DECIDED) - (a.decided >= MIN_DECIDED) || (b.accuracyPct ?? -1) - (a.accuracyPct ?? -1) || b.decided - a.decided);
    return { rows, minDecided: MIN_DECIDED, recent: st.preds.slice(-12).reverse().map((p) => ({ id: p.id, kind: p.kind, symbol: p.symbol, at: p.at, call: p.call, lean: p.lean, score: p.score, agreement: p.agreement, price: p.price, scored: p.scored })) };
  }

  /* ------------------------------------------------------ the deterministic floor (no AI) */

  async pulse(symbol) {
    let account = null;
    try {
      account = typeof this.account === "function" ? await this.account(symbol) : null;
    } catch (_) {
      account = null;
    }
    return this.ai.market.pulse(symbol, { account });
  }

  /** The next-session outlook: the research direction and measured odds enter it whole. Five minutes of memory. */
  async outlook(symbol) {
    const hit = this._cache.get(symbol);
    if (hit && this.ai.now() - hit.at < 5 * 60000) return hit.out;
    const { brief, verdict } = await this.ai.brief(symbol);
    const sh = sheet(brief, verdict);
    const market = this.ai.market;
    const [edge, profile, ctx] = await Promise.all([
      typeof market.edge === "function" ? market.edge(symbol).catch(() => null) : null,
      typeof market.behaviour === "function" ? market.behaviour(symbol).catch(() => null) : null,
      typeof market.context === "function" ? market.context().catch(() => null) : null,
    ]);
    const direction = buildDirection({ sheet: sh, edge, profile, market: ctx && ctx.available ? { tide: ctx.tide } : null });
    const d = await market.daily(symbol);
    const forming = typeof market._inProgress === "function" ? market._inProgress(d) : false;
    const o = buildOutlook({ candles: d.candles, forming, direction, edge });
    const out = { ...o, symbol, direction: direction.available ? { call: direction.call, label: direction.label, score: direction.score, confidence: direction.confidence, why: direction.why, conflicts: direction.conflicts } : null, source: d.source, stale: Boolean(d.stale), brief, verdict, sheet: sh };
    if (this._cache.size > 40) this._cache.clear();
    this._cache.set(symbol, { at: this.ai.now(), out });
    return out;
  }

  /* ------------------------------------------------------------------------- the briefs */

  _web(symbol) {
    const w = this.ai.worldSummary() ? this.ai.world() : null;
    const n = this.ai.newsSummary(symbol) ? this.ai.newsFor(symbol) : null;
    return {
      companyNews: n ? { gatheredAt: n.at, tone: n.tone, headline: n.headline, explainsTodaysMove: n.explainsMove, items: n.items.slice(0, 4), scheduled: n.upcoming.slice(0, 3), caveats: n.caveats.slice(0, 2) } : null,
      worldMarkets: w ? { gatheredAt: w.at, mood: w.mood, headline: w.headline, indiaRead: w.indiaRead, cues: w.cues.slice(0, 8), events: w.events.slice(0, 4) } : null,
      note: n || w ? "From a web search by the paid model — can be stale, incomplete or wrong." : "No web context: the paid model was not used, or found nothing.",
    };
  }

  async _you(symbol) {
    try {
      return typeof this.account === "function" ? await this.account(symbol) : null;
    } catch (_) {
      return null;
    }
  }

  async _liveBrief(symbol, pulse) {
    const market = this.ai.market;
    const v = await market.verdict(symbol);
    const day = v.day;
    const m = day.movement;
    let t5 = null;
    let t1 = null;
    try {
      t5 = await market.tape(symbol, 5);
    } catch (_) {
      t5 = null;
    }
    try {
      t1 = await market.tape(symbol, 1);
    } catch (_) {
      t1 = null;
    }
    let india = null;
    try {
      const c = await market.context();
      if (c && c.available) india = { tide: c.tide, nifty: c.nifty, indiaVix: c.vix };
    } catch (_) {
      india = null;
    }
    const you = pulse.you || null;
    return {
      symbol,
      timeIST: pulse.session ? pulse.session.ist : null,
      session: pulse.session ? { phase: pulse.session.label, minutesToEntryCutOff: pulse.session.minutesToCutoff, minutesToSquareOff: pulse.session.minutesToSquareOff } : null,
      price: { last: m.last, changePct: m.changePct, sinceOpenPct: m.fromOpenPct, vwap: m.vwap, vsVwapPct: m.vsVwapPct, dayHigh: m.dayHigh, dayLow: m.dayLow, openingRange: [m.orLow, m.orHigh], dailyATR: m.atr, rsi5min: m.rsi5, last15minPct: m.m15Pct, last30minPct: m.m30Pct, volumePace: m.volumePace },
      circuit: v.circuit || null,
      deskLiveCall: { call: day.headline, state: day.state, side: day.side, score: day.score, factors: (day.factors || []).map((f) => ({ name: f.name, points: f.pts, of: f.max, reading: f.reading })), earlyWarnings: (day.early || []).map((e) => e.text), dailyTrend: day.withDaily, notes: day.notes || [] },
      deskArithmeticRead: { lean: pulse.lean, score: pulse.score, agreement: pulse.agreement, call: pulse.call, headline: pulse.headline, gates: pulse.gates, components: pulse.components.map((c) => ({ name: c.label, vote: c.vote, weight: c.weight, reading: c.why })), patterns: pulse.patterns, expected30MinWindow: pulse.window, plans: { long: { entry: pulse.plans.long.entry, stop: pulse.plans.long.stop, targets: pulse.plans.long.targets }, short: { entry: pulse.plans.short.entry, stop: pulse.plans.short.stop, targets: pulse.plans.short.targets } } },
      last12FiveMinuteBars: t5 && t5.available ? { columns: ["time", "open", "high", "low", "close", "volume", "vwap"], rows: t5.tape.bars.slice(-12).map((b) => [b.t, b.o, b.h, b.l, b.c, b.v, b.w]) } : null,
      last15OneMinuteBars: t1 && t1.available ? { columns: ["time", "open", "high", "low", "close", "volume"], rows: t1.tape.bars.slice(-15).map((b) => [b.t, b.o, b.h, b.l, b.c, b.v]) } : null,
      indianMarket: india,
      web: this._web(symbol),
      theTrader: you ? { position: you.hasPosition ? { side: you.side, quantity: you.quantity, average: you.average, pnlNow: you.pnl, deskNote: you.why } : "none in this stock", availableCash: you.cash, sizingByRisk: you.sizing || null } : "not available",
    };
  }

  async _researchBrief(symbol, out) {
    const you = await this._you(symbol);
    const mk = this.ai.market;
    let edgeSummary = null;
    try {
      const e = typeof mk.edge === "function" ? await mk.edge(symbol) : null;
      if (e && e.available) edgeSummary = { best: e.best, warning: e.warning, nextSessionAfterSimilarDays: e.kinds && e.kinds.swing ? e.kinds.swing.forward : null };
    } catch (_) {
      edgeSummary = null;
    }
    return {
      symbol,
      dataSheet: out.brief,
      researchDirection: out.direction,
      deskNextSessionOutlook: { asOf: out.asOf, lean: out.lean, score: out.score, agreement: out.agreement, call: out.call, headline: out.headline, gates: out.gates, components: out.components.map((c) => ({ name: c.label, vote: c.vote, weight: c.weight, reading: c.why })), expectedRange: out.range, gapHabit: out.gap, pivots: out.pivots, plans: { long: { entry: out.plans.long.entry, stop: out.plans.long.stop, targets: out.plans.long.targets }, short: { entry: out.plans.short.entry, stop: out.plans.short.stop, targets: out.plans.short.targets } }, scenarios: out.scenarios },
      measuredOdds: edgeSummary,
      web: this._web(symbol),
      theTrader: you ? { position: you.position ? { side: you.position.quantity > 0 ? "long" : "short", quantity: Math.abs(you.position.quantity), average: you.position.average } : "none in this stock", availableCash: you.funds ? you.funds.available : null } : "not available",
    };
  }

  /* ---------------------------------------------------------------------------------- jobs */

  _view(job) {
    const { _promise, ...rest } = job;
    void _promise;
    return rest;
  }

  job(id) {
    const j = this.jobs.get(String(id || ""));
    if (!j) throw new AiError("No such AI run (it may have been cleared). Start it again.", "not_found", 404);
    return this._view(j);
  }

  /** The last finished AI run for a stock and kind, for the page to show on arrival. Costs nothing. */
  last(kind, symbol) {
    const all = this.ai.docs.read(LAST, {});
    return (all && all[`${kind}|${symbol}`]) || null;
  }

  /** Start an AI run for the stock that is open. One at a time per stock and kind. */
  start(kind, symbol, { freeOnly = false } = {}) {
    if (kind !== "live" && kind !== "research") throw new AiError("Unknown kind.", "invalid", 400);
    if (!SYMBOL_RE.test(symbol)) throw new AiError("That is not a valid symbol.", "invalid", 400);
    for (const j of this.jobs.values()) if (j.kind === kind && j.symbol === symbol && !j.finishedAt) return this._view(j);
    if ([...this.jobs.values()].filter((j) => !j.finishedAt).length >= 4) throw new AiError("Four AI runs are already going. Wait for one to finish.", "busy", 429);
    const job = { id: crypto.randomBytes(6).toString("hex"), kind, symbol, startedAt: new Date(this.ai.now()).toISOString(), finishedAt: null, freeOnly: Boolean(freeOnly), stage: "data", steps: [], analysts: [], det: null, result: null, error: "" };
    this.jobs.set(job.id, job);
    if (this.jobs.size > MAX_JOBS) for (const [id, j] of this.jobs) if (j.finishedAt && this.jobs.size > MAX_JOBS) this.jobs.delete(id);
    job._promise = this._run(job).catch((err) => {
      job.error = err && err.message ? err.message : "The run failed.";
      job.code = err && err.code ? err.code : "failed";
    }).finally(() => {
      job.finishedAt = new Date(this.ai.now()).toISOString();
      job.stage = job.error ? "failed" : "done";
    });
    return this._view(job);
  }

  _step(job, id, label, status, note = "") {
    const s = job.steps.find((x) => x.id === id);
    if (s) Object.assign(s, { status, note, label });
    else job.steps.push({ id, label, status, note });
    job.stage = id;
  }

  async _run(job) {
    const ai = this.ai;
    const { kind, symbol } = job;
    const live = kind === "live";

    /* 1. the desk's own arithmetic — the floor that needs no AI */
    this._step(job, "data", "The desk's own arithmetic read", "running");
    const det = live ? await this.pulse(symbol) : await this.outlook(symbol);
    if (!det.available) {
      this._step(job, "data", "The desk's own arithmetic read", "failed", det.reason || "");
      throw new AiError(det.reason || "Not enough data.", "unavailable", 409);
    }
    job.det = live ? det : this._compactOutlook(det);
    this._step(job, "data", "The desk's own arithmetic read", "done", det.headline);

    const roster = this.roster();
    // a run for a list of stocks (the screener) uses the free models only: no paid credits are spent
    if (job.freeOnly) {
      roster.lead = null;
      roster.analysts = roster.analysts.filter((a) => !a.lead);
    }
    const state = this._state();
    const today = istDate(ai.now());
    if (state.day.date !== today) state.day = { date: today, paid: 0 };
    const notes = [];
    let analysts = roster.analysts.slice();
    if (!analysts.length) {
      const s = roster.settings;
      notes.push(!s.useFree && !s.usePaid ? "Both the free and the paid analysts are switched off in the AI settings." : "No AI key is saved for the analysts, so this run is the desk's own arithmetic. Add the free NVIDIA key (or a paid key) on the AI page to bring the analysts in.");
    }

    /* 2. the paid lead's web research (news and world markets, kept 30 minutes) */
    const lead = roster.lead && analysts.some((a) => a.lead) ? roster.lead : null;
    const web = { used: false };
    if (lead && state.day.paid >= roster.settings.paidDailyCap) {
      notes.push(`The paid model has done its ${roster.settings.paidDailyCap} runs for today (a limit you can change): it sat this one out.`);
      analysts = analysts.filter((a) => !a.lead);
    } else if (lead && lead.search) {
      this._step(job, "web", `Web research by ${lead.name}`, "running");
      try {
        const spec = { providerId: lead.provider, apiKey: ai._key(lead.provider), model: lead.model, timeoutMs: 150000 };
        const lc = ai.engine ? ai.engine.client(spec) : makeClient({ ...spec, fetchImpl: ai.fetch });
        const via = { searcher: lc, shaper: lc };
        const [n, w] = await Promise.allSettled([ai.news(symbol, { via }), ai.worldBrief({ via })]);
        web.used = true;
        web.news = n.status === "fulfilled" ? { tone: n.value.tone, headline: n.value.headline, repeated: Boolean(n.value.repeated) } : { error: n.reason && n.reason.message };
        web.world = w.status === "fulfilled" ? { mood: w.value.mood, headline: w.value.headline, repeated: Boolean(w.value.repeated) } : { error: w.reason && w.reason.message };
        const bad = [n, w].filter((x) => x.status === "rejected").length;
        this._step(job, "web", `Web research by ${lead.name}`, bad === 2 ? "failed" : "done", bad === 2 ? "Both searches failed; carrying on without web context." : bad ? "One search failed; the other is used." : "News and world markets gathered (reused for 30 minutes).");
      } catch (err) {
        this._step(job, "web", `Web research by ${lead.name}`, "failed", err.message);
      }
    } else if (lead) {
      this._step(job, "web", `Web research by ${lead.name}`, "skipped", `${lead.company} has no web search in its API.`);
    }

    /* 3. every analyst, in parallel, on the identical brief */
    let votes = [];
    if (analysts.length) {
      const brief = live ? await this._liveBrief(symbol, det) : await this._researchBrief(symbol, det);
      const user = `${live ? "Live" : "Next-session"} snapshot for ${symbol}:\n\n${JSON.stringify(brief)}\n\n---\n\nGive your reading.`;
      const system = live ? LIVE_SYSTEM : RESEARCH_SYSTEM;
      const schema = live ? LIVE_SCHEMA : RESEARCH_SCHEMA;
      const sec = roster.settings.deadlineSec;
      this._step(job, "analysts", `${analysts.length} analyst${analysts.length === 1 ? "" : "s"} reading the same numbers`, "running");
      job.analysts = analysts.map((a) => ({ id: a.id, name: a.name, company: a.company, free: a.free, lead: Boolean(a.lead), status: "waiting" }));
      await Promise.all(
        analysts.map(async (a, i) => {
          job.analysts[i].status = "reading";
          const t0 = Date.now();
          try {
            const spec = { providerId: a.provider, apiKey: ai._key(a.provider), model: a.model, timeoutMs: (a.lead ? Math.max(sec, 120) : sec) * 1000, repair: false };
            // through the AI Engine: the owner's brains for AI Live / AI Research, and the shared lane
            const client = ai.engine ? ai.engine.client(spec) : ai.brains ? ai.brains.wrap(makeClient({ ...spec, fetchImpl: ai.fetch })) : makeClient({ ...spec, fetchImpl: ai.fetch });
            const r = await client.ask({ system, user, schema, maxTokens: 3500, effort: "low" });
            const v = { ...cleanVote(r.data), id: a.id, name: a.name, company: a.company, free: a.free, lead: Boolean(a.lead), usage: r.usage, ms: Date.now() - t0 };
            votes.push(v);
            job.analysts[i] = { ...job.analysts[i], status: "answered", bias: v.bias, confidence: v.confidence, summary: v.summary, reasons: v.reasons, risks: v.risks, change: v.change, low: v.low, high: v.high, long: v.long, short: v.short, levels: v.levels, gap: v.gap, ms: v.ms, usage: v.usage };
          } catch (err) {
            job.analysts[i] = { ...job.analysts[i], status: "failed", error: err && err.message ? err.message : "failed", ms: Date.now() - t0 };
          }
        })
      );
      const ok = votes.length;
      this._step(job, "analysts", `${analysts.length} analyst${analysts.length === 1 ? "" : "s"} reading the same numbers`, ok ? "done" : "failed", `${ok} answered${ok < analysts.length ? `, ${analysts.length - ok} did not` : ""}`);
      if (!ok) notes.push("Every analyst failed or timed out: this is the desk's own arithmetic read.");
      if (votes.some((v) => v.lead)) state.day.paid += 1;
    }

    /* 4. the combination: arithmetic, with the same plan checks as every other plan */
    this._step(job, "combine", "Weighing everything together", "running");
    votes = analysts.map((a) => votes.find((v) => v.id === a.id)).filter(Boolean); // the roster's order, not the finishing order
    const weights = this._weights(state);
    const ctx = live
      ? { last: det.last, atr: det.stats ? det.stats.dailyAtr : null, circuit: det.circuit || null, session: det.session || null, checkPlan: this.checkPlan }
      : { last: det.last, atr: det.range ? det.range.atr : null, circuit: null, session: null, checkPlan: this.checkPlan };
    const final = combine({ kind, det, votes, weights, ctx });
    final.notes.unshift(...notes);
    const tokens = (xs) => xs.reduce((s, v) => ({ inputTokens: s.inputTokens + ((v.usage && v.usage.inputTokens) || 0), outputTokens: s.outputTokens + ((v.usage && v.usage.outputTokens) || 0) }), { inputTokens: 0, outputTokens: 0 });
    const result = {
      id: job.id,
      kind,
      symbol,
      at: new Date(ai.now()).toISOString(),
      last: det.last,
      final,
      analysts: job.analysts,
      web,
      usage: { free: tokens(votes.filter((v) => v.free)), paid: tokens(votes.filter((v) => !v.free)) },
      disclaimer: "This is a summary of evidence — arithmetic and several models' readings of the same numbers — not a forecast and not advice. Agreement is not a probability of profit. No method wins every trade; keep the stop.",
    };
    job.result = result;
    this._step(job, "combine", "Weighing everything together", "done", final.headline);

    /* 5. keep it: the record scores it later against real prices */
    const pred = { id: job.id, kind, symbol, at: result.at, date: live ? istDate(ai.now()) : det.asOf, price: det.last, call: final.call, lean: final.lean, score: final.score, agreement: final.agreement, votes: { engine: det.lean === "up" ? "up" : det.lean === "down" ? "down" : "sideways", ...Object.fromEntries(votes.map((v) => [v.id, v.bias])) }, scored: null };
    const names = { engine: "The desk's engine", ...Object.fromEntries(votes.map((v) => [v.id, `${v.name} (${v.company})`])) };
    pred.names = names;
    const fresh = this._state();
    fresh.day = state.day;
    fresh.preds = [...fresh.preds, pred].slice(-MAX_PREDS);
    this._save(fresh);
    const all = ai.docs.read(LAST, {});
    const keep = { ...(all && typeof all === "object" ? all : {}), [`${kind}|${symbol}`]: result };
    const keys = Object.keys(keep);
    if (keys.length > 60) keys.slice(0, keys.length - 60).forEach((k) => delete keep[k]);
    ai.docs.write(LAST, keep);
    ai.log.log(`[ai] ensemble ${kind} ${symbol}: ${final.call} (${final.agreement}% agree, ${votes.length}/${analysts.length} analysts, engine ${det.lean})`);
  }

  _compactOutlook(o) {
    const { brief, verdict, sheet: sh, ...rest } = o;
    void brief;
    void verdict;
    void sh;
    return rest;
  }

  /* --------------------------------------------------------------------------- scoring */

  /**
   * Score what has come due against real prices: a live call 30 minutes after it was made, a
   * next-session call once that session has closed. Arithmetic only; at most eight per call.
   */
  async score() {
    const ai = this.ai;
    const market = ai.market;
    if (typeof market.mode === "function" && market.mode() !== "kite") return 0;
    const st = this._state();
    const now = ai.now();
    let done = 0;
    for (const p of st.preds) {
      if (p.scored || done >= 8) continue;
      try {
        let move = null;
        let basis = "";
        if (p.kind === "live") {
          if (now < Date.parse(p.at) + 30 * 60000) continue;
          const bars = await market.intradayOn(p.symbol, p.date);
          const want = Date.parse(p.at) + 30 * 60000;
          const hit = bars.find((b) => {
            const s = barStart(b.t);
            return s !== null && s + 5 * 60000 >= want;
          });
          const px = hit ? hit.c : bars.length && istDate(now) > p.date ? bars[bars.length - 1].c : null;
          if (!num(px)) continue;
          move = ((px - p.price) / p.price) * 100;
          basis = `price ${r2(px)} thirty minutes later`;
        } else {
          const d = await market.daily(p.symbol);
          const i = d.candles.findIndex((c) => c.t > p.date);
          if (i < 1) continue;
          const next = d.candles[i];
          const base = d.candles[i - 1];
          // a session still being written is not an outcome yet
          if (next.t >= istDate(now) && typeof market._inProgress === "function" && market._inProgress(d)) continue;
          move = ((next.c - base.c) / base.c) * 100;
          basis = `${next.t} closed ${r2(next.c)} against ${r2(base.c)}`;
        }
        const out = { movePct: r2(move), basis, at: new Date(now).toISOString(), results: {} };
        for (const [id, bias] of Object.entries(p.votes)) {
          const res = judge(bias, move, p.kind);
          out.results[id] = res;
          const t = st.tally[id] || { name: (p.names && p.names[id]) || id, right: 0, wrong: 0, flat: 0 };
          t[res] += 1;
          if (p.names && p.names[id]) t.name = p.names[id];
          st.tally[id] = t;
        }
        const callBias = p.call === "long" || p.call === "long-bias" ? "up" : p.call === "short" || p.call === "short-bias" ? "down" : null;
        if (callBias) {
          const res = judge(callBias, move, p.kind);
          out.results.final = res;
          const t = st.tally.final || { name: "The final call (when it was not 'wait')", right: 0, wrong: 0, flat: 0 };
          t[res] += 1;
          st.tally.final = t;
        }
        p.scored = out;
        done += 1;
      } catch (_) {
        /* scored next time */
      }
    }
    if (done) this._save(st);
    return done;
  }

  async record() {
    await this.score();
    return this._recordRows(this._state());
  }
}

// the owner's AI brains reach these instructions automatically (server/ai/brains.js)
require("./brains").register("ensemble-live", LIVE_SYSTEM, "AI Live analysts");
require("./brains").register("ensemble-research", RESEARCH_SYSTEM, "AI Research analysts");

module.exports = { Ensemble, combine, weigh, cleanVote, consensusPlan, sanePlan, judge, weightFromRecord, LIVE_SCHEMA, RESEARCH_SCHEMA, LIVE_SYSTEM, RESEARCH_SYSTEM };
