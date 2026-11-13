"use strict";
// The AI strategist. On request — never on a timer — it:
//   1. gathers a brief for one stock from the market service (live quote, today's
//      tape, daily history, every indicator, the rule engine's own reading, backtests)
//   2. asks Claude for a strategy as structured JSON, with the trading-skills file
//   3. checks every number in the answer mechanically, and rejects plans that fail
//   4. writes the plan to a journal, so it can later be scored against real prices
//   5. ("Score & learn") scores past plans by arithmetic and asks Claude to turn the
//      results into lessons, which are appended to the trading-skills file
//
//   6. ("Live co-pilot", copilot.js) gives a short second reading of the stock that is
//      open, when the page asks for one — bounded by a minimum gap and a daily limit
//   7. ("Why is it moving?") checks the news on one company by web search
//   8. ("Day debrief", debrief.js) reads back the day's scorecard — the rule engine replayed
//      over the session by arithmetic — as a short review
//
// It reads and writes analysis only. There is no order, basket or broker call in
// this folder, and the only outside hosts it talks to are the AI companies in providers.js.

const path = require("path");
const crypto = require("crypto");

const { AiError } = require("./client");
const { PROVIDERS, providerOf, DEFAULT_PROVIDER, SEARCH_ORDER, checkKey, makeClient } = require("./providers");
const { Playbook } = require("./playbook");
const { Journal, scorePlan, summarize, summarizeByModel, SWING_MAX_BARS } = require("./journal");
const { Copilot } = require("./copilot");
const { Debrief } = require("./debrief");
const { FileDocs } = require("../docs");
const { Coach } = require("./coach");
const { Research } = require("./research");
const { Review } = require("./review");
const { Decision } = require("./decision");
const { barStart } = require("../market/intraday");

const IST = 5.5 * 3600 * 1000;
const TICK = 0.05;
const HORIZONS = ["intraday", "swing", "both"];
const FINAL = new Set(["target", "stop", "expired", "not-triggered", "invalid"]);
const MIN_TO_LEARN = 3;

const num = (x) => typeof x === "number" && Number.isFinite(x);
const r2 = (x) => (num(x) ? Math.round(x * 100) / 100 : null);
const tick = (x) => (num(x) ? Math.round(Math.round(x / TICK) * TICK * 100) / 100 : null);
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);

/* ------------------------------------------------------------- prompts */

const SYSTEM = `You are the strategist on a private trading desk for NSE (India) cash equities. A single trader reads your output and decides for themselves; you never place orders.

You will receive a JSON brief for one stock, built from live and historical exchange data: the quote, today's 5-minute tape, daily bars, indicators, support and resistance, circuit limits, a rule-based engine's own reading on three horizons, backtests of seven rule-based setups on this stock, and the scored results of your own earlier plans for it. You will also receive the desk's trading-skills file. Follow it.

How to work:
- Use only numbers that appear in the brief. If something you need is missing, say so in "risks" instead of assuming it.
- Weigh the evidence on each horizon and say plainly what it supports. When it is mixed or thin, the right plan is "no_trade" — that is a normal, respectable answer, not a failure.
- You may disagree with the rule-based engine when the data supports it; say why. When you agree, do not just restate it — add what it cannot see in its fixed rules (for example how the tape behaved around a level, or what the backtests say about this stock's character).
- Every plan that is not "no_trade" needs a numeric entry, a stop-loss on the losing side of the entry, and one to three targets in order. Round prices to 0.05.
- entry_type: "at_market" means enter near the last price now; "breakout" means a stop order beyond the current price in the trade's direction (buy above / sell below); "pullback" means a limit order the price must come back to (buy lower / sell higher).
- Keep the stop close enough to be a real stop: for an intraday plan between about 0.2 and 1 times the daily ATR from the entry; for a swing plan between about 0.5 and 2.5 times. The first target must be at least as far away as the stop.
- Swing plans are delivery trades and are long-only. Intraday shorts are allowed and must be closed the same day.
- Never plan an entry or target beyond a circuit limit. Respect the session clock in the brief: no intraday entry in the first 15 minutes or after 2:45 PM IST.
- The brief may carry the state of the Indian market (the Nifty's tide, India VIX, sector breadth) and a world-markets brief that was gathered by web search. Weigh them: a trade against a strongly moving market needs a better reason and smaller size. Treat the world brief's figures as background that can be stale or wrong, never as a trigger.
- The brief may also carry a company-news check gathered by web search (results, orders, rating changes, what is scheduled). Treat it the same way: background that can be stale, incomplete or wrong. If it names a scheduled event (results, a board meeting), say how that changes the risk of holding through it.
- Beyond those two web-search items you cannot see news, results or corporate actions, and you are not shown the order book. Say so where it matters.
- Never promise or imply a profit, a win rate or a probability. Describe confidence only as low, medium or high, meaning how well the evidence agrees.
- Write for a busy trader: short, concrete sentences with the actual numbers. No hedging filler, no disclaimers beyond what "risks" needs.`;

const STRATEGY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["stance", "confidence", "summary", "evidence", "plans", "risks", "would_change_my_mind", "skills_used"],
  properties: {
    stance: { type: "string", enum: ["bullish", "bearish", "neutral"], description: "The overall reading for the requested horizon(s)." },
    confidence: { type: "string", enum: ["low", "medium", "high"], description: "How well the evidence agrees. Not a probability." },
    summary: { type: "string", description: "Two or three sentences: what the data says and what to do about it." },
    evidence: { type: "array", items: { type: "string" }, description: "Three to six concrete observations from the brief, each with its numbers." },
    plans: {
      type: "array",
      description: "One plan per requested horizon.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["horizon", "action", "entry_type", "entry", "stop", "targets", "rationale", "invalidation"],
        properties: {
          horizon: { type: "string", enum: ["intraday", "swing"] },
          action: { type: "string", enum: ["long", "short", "no_trade"] },
          entry_type: { type: "string", enum: ["at_market", "breakout", "pullback", "none"], description: "Use \"none\" with no_trade." },
          entry: { anyOf: [{ type: "number" }, { type: "null" }], description: "null with no_trade." },
          stop: { anyOf: [{ type: "number" }, { type: "null" }], description: "null with no_trade." },
          targets: { type: "array", items: { type: "number" }, description: "One to three prices in order; empty with no_trade." },
          rationale: { type: "string", description: "Why this plan, or why no trade, in one or two sentences." },
          invalidation: { type: "string", description: "What would cancel the plan before entry, or what to watch for with no_trade." },
        },
      },
    },
    risks: { type: "array", items: { type: "string" }, description: "What could make this wrong, including what the brief cannot show." },
    would_change_my_mind: { type: "array", items: { type: "string" }, description: "Specific prices or events that would flip the reading." },
    skills_used: { type: "array", items: { type: "string" }, description: "The rules or lessons from the trading-skills file that shaped this answer, quoted briefly." },
  },
};

const LEARN_SYSTEM = `You maintain the "lessons" section of a trading desk's skills file for NSE cash equities.

You will receive the scored outcomes of the desk's recent plans. The scoring was done by arithmetic on real prices: "target" means the first target was reached before the stop, "stop" means the stop was hit first (ties count as stops), "expired" means neither was reached in time, "not-triggered" means price never reached the entry. R is the result in multiples of the planned risk.

Write at most five lessons. A good lesson:
- is about process or conditions the desk can act on next time (time of day, agreement between horizons, entry type, distance from VWAP, chasing, counter-trend trades, thin volume), not a prediction about any stock;
- is supported by more than one outcome in this batch, or sharpens a lesson already in the file — say how many outcomes support it;
- is one sentence, concrete, and written as an instruction.

The sample is small. Do not draw a lesson from a single trade, do not claim a win rate, and prefer no lesson to a weak one. If the outcomes show nothing reliable, return an empty list and say so in "observation". Do not repeat a lesson that is already in the file unless you are refining it.`;

const LEARN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["observation", "lessons"],
  properties: {
    observation: { type: "string", description: "Two or three sentences on what this batch of outcomes shows, including how little it proves." },
    lessons: { type: "array", items: { type: "string" }, description: "Zero to five one-sentence instructions." },
  },
};

const WORLD_SYSTEM = `You prepare a short world-markets brief for a day trader in Indian (NSE) equities. Use web search for every figure and date; do not rely on memory for any number.

Find, as of now (the user message gives the time in India):
- United States: how the S&P 500, Nasdaq and Dow closed in their last session, and where US index futures are trading now.
- Asia today: Nikkei, Hang Seng, Shanghai, Kospi.
- Europe, if its markets are open: FTSE, DAX, CAC.
- GIFT Nifty, Brent crude, gold, the dollar index, the US 10-year yield and USD/INR.
- Foreign (FII/FPI) and domestic (DII) institutional flows in Indian equities for the latest reported session.
- Anything scheduled today that can move Indian stocks: RBI or Fed decisions, inflation or GDP data, large-cap results, index changes, derivative expiries.
- One or two overnight news items that matter for Indian markets.

Then write the brief in plain prose, under 350 words: the figures with their time or date, what was moving and why, and what it means for the Indian open or the session in progress. Say which Indian sectors are exposed. If a figure could not be found or sources disagree, say so rather than guessing. Do not predict where any index or stock will go, and do not recommend trades.`;

const WORLD_SHAPE_SYSTEM = `Turn a world-markets brief into structured data. Use only what the brief says: copy figures exactly, never add or correct a number, and write "not found" for anything the brief does not give. The mood is "risk_on" only when most overseas cues are positive for equities, "risk_off" only when most are negative, otherwise "mixed".`;

const WORLD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["mood", "headline", "cues", "india_read", "sectors", "events", "caveats"],
  properties: {
    mood: { type: "string", enum: ["risk_on", "risk_off", "mixed"], description: "The tone of overseas markets for Indian equities." },
    headline: { type: "string", description: "One sentence, under 20 words." },
    cues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "value", "change", "as_of", "read"],
        properties: {
          name: { type: "string" },
          value: { type: "string", description: "The level as text, or \"not found\"." },
          change: { type: "string", description: "The change as text, for example \"+0.6%\"; empty if unknown." },
          as_of: { type: "string", description: "The date or time the figure refers to." },
          read: { type: "string", enum: ["positive", "negative", "neutral"], description: "For Indian equities." },
        },
      },
    },
    india_read: { type: "string", description: "Two or three sentences on what this means for the Indian session." },
    sectors: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sector", "bias", "why"],
        properties: { sector: { type: "string" }, bias: { type: "string", enum: ["tailwind", "headwind", "watch"] }, why: { type: "string" } },
      },
    },
    events: { type: "array", items: { type: "string" }, description: "Scheduled events today that matter, with their India time if known." },
    caveats: { type: "array", items: { type: "string" }, description: "Figures that were missing, stale or disputed." },
  },
};
const WORLD_FRESH_MS = 10 * 3600 * 1000; // a brief older than this no longer describes "today"

const NEWS_SYSTEM = `You check the news on one NSE-listed company for a day trader who has its chart open. Use web search for every fact and every date; do not rely on memory.

Find, as of now (the user message gives the time in India and how the stock is moving today):
- Company news from the last three trading days: results, guidance, new contracts, management changes, stake sales and block deals, broker rating or target changes, regulatory or legal action, and exchange announcements.
- What is scheduled: the next results date, a board meeting, an ex-dividend, bonus or split date, entry to or exit from an index, and whether the stock is in the F&O ban list today.
- News on its sector, or on the commodity or currency it depends on, when that is what is moving it.

Then write a brief in plain prose, under 250 words: each item with its date and where it was reported, whether any of it plausibly explains today's move, and what is scheduled. If you find nothing specific to the company, say exactly that — an honest "no company-specific news found" is useful, because it means the move is more likely driven by the market or by flows. If sources disagree or a date is unclear, say so. Do not predict the price and do not recommend a trade.`;

const NEWS_SHAPE_SYSTEM = `Turn a company-news brief into structured data. Use only what the brief says: copy facts and dates exactly, never add one, and leave a list empty rather than fill it with guesses. "tone" is how the news reads for the share price: "positive", "negative", "mixed", "neutral" when the news is routine, or "none" when no company-specific news was found. "explains_move" says whether the brief itself ties the news to today's move.`;

const NEWS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tone", "headline", "explains_move", "items", "upcoming", "caveats"],
  properties: {
    tone: { type: "string", enum: ["positive", "negative", "mixed", "neutral", "none"] },
    headline: { type: "string", description: "One sentence, under 22 words." },
    explains_move: { type: "string", enum: ["yes", "partly", "no", "unknown"] },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["date", "what", "read"],
        properties: {
          date: { type: "string", description: "The date as the brief gives it; empty if it gives none." },
          what: { type: "string" },
          read: { type: "string", enum: ["positive", "negative", "neutral"] },
        },
      },
    },
    upcoming: { type: "array", items: { type: "string" }, description: "Scheduled events, each with its date." },
    caveats: { type: "array", items: { type: "string" }, description: "What was missing, unclear or disputed." },
  },
};
const NEWS_REUSE_MS = 30 * 60000; // asking again sooner than this returns the stored check
const NEWS_FRESH_MS = 6 * 3600 * 1000; // older than this, it is no longer shown to the model as current
const NEWS_KEEP = 40;

/* ------------------------------------------------------ plan validation */

/**
 * Check one AI plan against the data it was built from. Pure arithmetic.
 * @param ctx { last, atr, circuit: {upper, lower}|null, session: {open, entries, label}|null }
 * @returns { plan (normalised), checks: [{ name, ok, detail }], status: "passed"|"rejected"|"no-trade", notes: [] }
 */
function checkPlan(raw, ctx) {
  const horizon = raw.horizon === "swing" ? "swing" : "intraday";
  if (raw.action === "no_trade") {
    return { plan: { horizon, action: "no_trade", side: null, entryType: "none", entry: null, stop: null, targets: [], target: null, rationale: String(raw.rationale || ""), invalidation: String(raw.invalidation || "") }, checks: [], status: "no-trade", notes: [] };
  }
  const side = raw.action === "short" ? "short" : "long";
  const long = side === "long";
  const entryType = ["at_market", "breakout", "pullback"].includes(raw.entry_type) ? raw.entry_type : "at_market";
  const entry = tick(raw.entry);
  const stop = tick(raw.stop);
  const targets = (Array.isArray(raw.targets) ? raw.targets : []).map(tick).filter((t) => num(t)).slice(0, 3);
  const plan = { horizon, action: raw.action, side, entryType, entry, stop, targets, target: targets[0] ?? null, rationale: String(raw.rationale || ""), invalidation: String(raw.invalidation || "") };
  const checks = [];
  const notes = [];
  const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });
  const { last, atr, circuit, session } = ctx;

  const haveNumbers = num(entry) && num(stop) && entry > 0 && stop > 0 && targets.length > 0 && targets.every((t) => t > 0);
  add("Entry, stop and at least one target are given", haveNumbers, haveNumbers ? `entry ${entry}, stop ${stop}, targets ${targets.join(", ")}` : "A price is missing or not positive.");
  if (!haveNumbers) return { plan, checks, status: "rejected", notes };

  const risk = Math.abs(entry - stop);
  plan.riskPerShare = r2(risk);
  plan.riskPct = r2((risk / entry) * 100);
  plan.rewardToRisk = r2(Math.abs(targets[0] - entry) / risk);

  add("Stop is on the losing side of the entry", long ? stop < entry : stop > entry, long ? `a long needs its stop below ${entry}` : `a short needs its stop above ${entry}`);
  const ordered = targets.every((t, i) => (long ? t > entry : t < entry) && (i === 0 || (long ? t > targets[i - 1] : t < targets[i - 1])));
  add("Targets are beyond the entry and in order", ordered, targets.join(" → "));
  if (horizon === "swing") add("Swing plans are long-only (delivery)", long, long ? "long" : "A short cannot be carried overnight in the cash market.");

  if (circuit && num(circuit.upper) && num(circuit.lower)) {
    const inside = [entry, stop, ...targets].every((p) => p < circuit.upper && p > circuit.lower);
    add("Every level is inside the circuit limits", inside, `${circuit.lower} – ${circuit.upper}`);
  }
  if (num(atr) && atr > 0) {
    const lo = horizon === "intraday" ? 0.1 : 0.3;
    const hi = horizon === "intraday" ? 1.2 : 3;
    const mult = risk / atr;
    add(`Stop distance is sensible for ${horizon === "intraday" ? "a day trade" : "a swing trade"}`, risk > 0 && mult >= lo && mult <= hi, `${mult.toFixed(2)} × ATR (allowed ${lo}–${hi})`);
    const reach = horizon === "intraday" ? 1.5 : 3;
    if (num(last)) add("Entry is within reach of the current price", Math.abs(entry - last) <= reach * atr, `${(Math.abs(entry - last) / atr).toFixed(2)} × ATR from ${last} (allowed ${reach})`);
  }
  add("First target is at least as far as the stop", risk > 0 && plan.rewardToRisk >= 1, `${plan.rewardToRisk} × risk`);
  if (num(last) && num(atr) && risk > 0) {
    const slack = 0.15 * atr;
    if (entryType === "at_market") add("\"At market\" entry is at the current price", Math.abs(entry - last) <= slack, `entry ${entry} vs last ${last}`);
    if (entryType === "breakout") add("Breakout entry is beyond the current price", long ? entry >= last - slack : entry <= last + slack, `entry ${entry} vs last ${last}`);
    if (entryType === "pullback") add("Pullback entry is back from the current price", long ? entry <= last + slack : entry >= last - slack, `entry ${entry} vs last ${last}`);
  }
  if (horizon === "intraday" && session && session.open && !session.entries) add("Inside the day's entry window", false, `${session.label}: no fresh intraday entries now.`);
  if (horizon === "intraday" && (!session || !session.open)) notes.push("The market is closed: treat this as a plan for the next session and re-check it against the open.");

  return { plan, checks, status: checks.every((c) => c.ok) ? "passed" : "rejected", notes };
}

/* --------------------------------------------------------------- service */

class AiService {
  /**
   * @param store    the app's Store (the encrypted key and the model choice live in settings)
   * @param secrets  { encrypt(text), decrypt(blob) }
   * @param market   the MarketService — the only source of prices
   */
  /** @param docs  the record store (server/docs.js); a file store under dir when not given */
  constructor({ dir, store, secrets, market, fetchImpl, now = () => Date.now(), log = console, docs }) {
    this.dir = path.join(dir, "ai");
    this.docs = docs || new FileDocs(dir);
    this.store = store;
    this.secrets = secrets;
    this.market = market;
    this.fetch = fetchImpl;
    this.now = now;
    this.log = log;
    this.playbook = new Playbook({ docs: this.docs });
    this.journal = new Journal({ docs: this.docs });
    this._recent = new Map(); // symbol|horizon → { at, result }: a double click does not pay twice
    this.copilot = new Copilot(this);
    this.debrief = new Debrief(this);
    this.coach = new Coach(this);
    this.research = new Research(this);
    this.journalReview = new Review(this); // "review" is taken: the score-and-learn step below
    this.decision = new Decision(this, checkPlan);
  }

  /* ------------------------------------------------------------ settings */
  //
  // One company is in use at a time. Each company keeps its own encrypted key, its own chosen
  // model, its last test and the model list last read from it — so switching back and forth never
  // asks for a key again. Every request builds its client from these settings at the moment it is
  // made, so a change here applies to the very next request everywhere.
  // (Older records kept one Anthropic key in anthropicApiKeyEnc / aiModel / aiLastTest; they are
  // still read, and moved into the per-company fields on the next save.)

  _settings() {
    return this.store.data.settings;
  }

  /** The company in use. */
  _provider() {
    const id = this._settings().aiProvider;
    return providerOf(id) ? id : DEFAULT_PROVIDER;
  }

  /** Whose key a company uses: its own, or NVIDIA's for the free NVIDIA-hosted companies. */
  _keyOwner(pid) {
    const p = providerOf(pid);
    return (p && p.keyOf) || pid;
  }

  _keyBlob(pid) {
    const s = this._settings();
    const keys = s.aiKeys && typeof s.aiKeys === "object" ? s.aiKeys : {};
    pid = this._keyOwner(pid);
    if (keys[pid]) return keys[pid];
    return pid === "anthropic" ? s.anthropicApiKeyEnc || "" : "";
  }

  _key(pid = this._provider()) {
    const blob = this._keyBlob(pid);
    if (!blob) return "";
    try {
      return this.secrets.decrypt(blob);
    } catch (_) {
      return "";
    }
  }

  /** The models offered for a company: the live list read from it when there is one, else the catalogue. */
  modelsFor(pid) {
    const p = providerOf(pid);
    if (!p) return [];
    const lists = this._settings().aiModelLists || {};
    const live = lists[pid] && Array.isArray(lists[pid].models) ? lists[pid].models : [];
    if (!live.length) return p.models.map((m) => ({ ...m }));
    // the catalogue's notes stay on the models it knows; the rest come as the company names them
    const known = new Map(p.models.map((m) => [m.id, m]));
    const liveIds = new Set(live.map((m) => m.id));
    return [...p.models.filter((m) => liveIds.has(m.id)).map((m) => ({ ...m })), ...live.filter((m) => !known.has(m.id)).map((m) => ({ id: m.id, name: m.name || m.id }))];
  }

  validModel(pid, id) {
    if (!id || typeof id !== "string") return false;
    const p = providerOf(pid);
    if (!p) return false;
    const lists = this._settings().aiModelLists || {};
    const live = lists[pid] && Array.isArray(lists[pid].models) ? lists[pid].models : [];
    return p.models.some((m) => m.id === id) || live.some((m) => m.id === id);
  }

  _modelOf(pid) {
    const s = this._settings();
    const chosen = (s.aiModels && s.aiModels[pid]) || (pid === "anthropic" ? s.aiModel : "");
    if (this.validModel(pid, chosen)) return chosen;
    const list = this.modelsFor(pid);
    return list.length ? list[0].id : providerOf(pid).models[0].id;
  }

  _model() {
    return this._modelOf(this._provider());
  }

  _testOf(pid) {
    const s = this._settings();
    if (s.aiTests && s.aiTests[pid] !== undefined) return s.aiTests[pid] || null;
    return pid === "anthropic" ? s.aiLastTest || null : null;
  }

  configured() {
    return Boolean(this._key());
  }

  /** The company that answers web searches: the one in use if it can, else another with a saved key. */
  _searchProvider() {
    const pid = this._provider();
    // a free model never borrows a paid company's key — not even for web search — so nothing is billed
    if (providerOf(pid).free) return null;
    if (providerOf(pid).search && this._key(pid)) return pid;
    return SEARCH_ORDER.find((id) => this._key(id)) || null;
  }

  status() {
    const pid = this._provider();
    const p = providerOf(pid);
    const key = this._key(pid);
    const lists = this._settings().aiModelLists || {};
    const hint = (k) => (k ? `${k.slice(0, Math.min(10, Math.max(4, k.length - 8)))}…${k.slice(-4)}` : "");
    const providers = PROVIDERS.map((x) => {
      const k = this._key(x.id);
      return {
        id: x.id,
        name: x.name,
        family: x.family,
        configured: Boolean(k),
        keyHint: hint(k),
        model: this._modelOf(x.id),
        models: this.modelsFor(x.id),
        listedAt: lists[x.id] ? lists[x.id].at : null,
        lastTest: this._testOf(x.id),
        search: x.search,
        free: Boolean(x.free),
        keyOf: x.keyOf || null, // the free companies share NVIDIA's key
        keyExample: x.keyExample,
        console: x.console,
        consoleUrl: x.consoleUrl,
        steps: x.steps,
      };
    });
    const model = this._modelOf(pid);
    const names = {};
    for (const x of providers) for (const m of x.models) names[m.id] = m.name;
    const searchBy = this._searchProvider();
    return {
      configured: Boolean(key),
      provider: pid,
      providerName: p.name,
      free: Boolean(p.free),
      // enough to recognise the key, never enough to use it
      keyHint: hint(key),
      model,
      modelName: names[model] || model,
      models: this.modelsFor(pid),
      providers,
      names,
      searchBy,
      searchByName: searchBy ? providerOf(searchBy).name : null,
      lastTest: this._testOf(pid),
      stats: summarize(this.journal.all().filter((e) => e.source === "kite")),
      byModel: summarizeByModel(this.journal.all().filter((e) => e.source === "kite")),
      lessons: this.playbook.lessons().length,
      world: this.worldSummary(),
      live: this.copilot.summary(),
      version: this._settings().aiVersion || 0,
    };
  }

  /**
   * @param provider  the company to change (and to switch to, unless use === false)
   * @param apiKey    a new key for that company (it replaces only that company's key)
   * @param model     a model of that company
   * @param clear     remove that company's key
   */
  setSettings({ provider, apiKey, model, clear, live, use } = {}) {
    const pid = provider ? String(provider) : this._provider();
    if (!providerOf(pid)) throw new AiError("Unknown AI company.", "invalid", 400);
    const key = String(apiKey || "").trim();
    if (key) checkKey(pid, key);
    if (model !== undefined && model !== null && model !== "" && !this.validModel(pid, model)) throw new AiError("Unknown model for this company. Press “Refresh models” to read its current list.", "invalid", 400);
    this.store.update((d) => {
      const s = d.settings;
      // move an older single-key record into the per-company fields
      s.aiKeys = { ...(s.aiKeys || {}) };
      s.aiModels = { ...(s.aiModels || {}) };
      s.aiTests = { ...(s.aiTests || {}) };
      if (s.anthropicApiKeyEnc && !s.aiKeys.anthropic) s.aiKeys.anthropic = s.anthropicApiKeyEnc;
      if (s.aiModel && !s.aiModels.anthropic) s.aiModels.anthropic = s.aiModel;
      if (s.aiLastTest !== undefined && s.aiTests.anthropic === undefined) s.aiTests.anthropic = s.aiLastTest;
      delete s.anthropicApiKeyEnc;
      delete s.aiModel;
      delete s.aiLastTest;
      const owner = this._keyOwner(pid);
      const sharing = PROVIDERS.filter((x) => (x.keyOf || x.id) === owner).map((x) => x.id);
      if (clear) {
        delete s.aiKeys[owner];
        sharing.forEach((id) => (s.aiTests[id] = null));
      }
      if (key) {
        s.aiKeys[owner] = this.secrets.encrypt(key);
        sharing.forEach((id) => (s.aiTests[id] = null));
      }
      if (model) s.aiModels[pid] = model;
      if (provider && use !== false) s.aiProvider = pid;
      s.aiVersion = (s.aiVersion || 0) + 1; // pages compare this to know the choice changed
    });
    if (live && typeof live === "object") this.copilot.setSettings(live);
    return this.status();
  }

  /** Read the models a company offers this key, and keep the list. */
  async refreshModels(provider) {
    const pid = provider ? String(provider) : this._provider();
    const p = providerOf(pid);
    if (!p) throw new AiError("Unknown AI company.", "invalid", 400);
    const key = this._key(pid);
    if (!key) throw new AiError(`Save ${p.name}'s API key first; the model list is read with it.`, "not_configured", 409);
    const models = (await makeClient({ providerId: pid, apiKey: key, model: this._modelOf(pid), fetchImpl: this.fetch }).listModels()).slice(0, 300);
    if (!models.length) throw new AiError(`${p.name} returned no models this key can use for text.`, "upstream", 502);
    this.store.update((d) => {
      d.settings.aiModelLists = { ...(d.settings.aiModelLists || {}), [pid]: { at: new Date(this.now()).toISOString(), models } };
      d.settings.aiVersion = (d.settings.aiVersion || 0) + 1;
    });
    return this.status();
  }

  /**
   * A client for the company in use.
   * @param model  a model other than the strategist's (the co-pilot can be given a faster one)
   */
  _client(model) {
    const pid = this._provider();
    const key = this._key(pid);
    if (!key) throw new AiError(`The AI strategist is not set up. Add ${providerOf(pid).name}'s API key in the AI settings.`, "not_configured", 409);
    return makeClient({ providerId: pid, apiKey: key, model: model && this.validModel(pid, model) ? model : this._modelOf(pid), fetchImpl: this.fetch });
  }

  /** A client that can search the web: the company in use when it can, else one with a saved key that can. */
  _searchClient() {
    const pid = this._provider();
    const by = this._searchProvider();
    if (!this._key(pid)) return this._client(); // the usual "not set up" message
    if (!by && providerOf(pid).free) throw new AiError("The free NVIDIA-hosted models have no web search, and while one is in use the app never borrows a paid company's key, so nothing is billed. The world brief and the news check need Anthropic, OpenAI or Gemini picked as the company.", "no_search", 409);
    if (!by) throw new AiError(`${providerOf(pid).name} has no web search in its API. The world brief and the news check need Anthropic, OpenAI or Gemini — save a key for one of them in the AI settings (the strategist can stay on ${providerOf(pid).name}).`, "no_search", 409);
    return by === pid ? this._client() : makeClient({ providerId: by, apiKey: this._key(by), model: this._modelOf(by), fetchImpl: this.fetch });
  }

  async test(provider) {
    const pid = provider && providerOf(String(provider)) ? String(provider) : this._provider();
    let result;
    try {
      const key = this._key(pid);
      if (!key) throw new AiError(`No ${providerOf(pid).name} API key is saved.`, "not_configured", 409);
      const r = await makeClient({ providerId: pid, apiKey: key, model: this._modelOf(pid), fetchImpl: this.fetch }).ping();
      result = { ok: true, at: new Date(this.now()).toISOString(), model: r.model, message: "The key works." };
    } catch (err) {
      result = { ok: false, at: new Date(this.now()).toISOString(), model: this._modelOf(pid), message: err.message, code: err.code };
    }
    this.store.update((d) => {
      d.settings.aiTests = { ...(d.settings.aiTests || {}), [pid]: result };
      if (pid === "anthropic") delete d.settings.aiLastTest;
    });
    return { ...this.status(), test: { ...result, provider: pid } };
  }

  /* ---------------------------------------------------------- world brief */

  /** The stored world brief, whatever its age, or null. */
  world() {
    const w = this.docs.read("ai/world.json", null);
    return w && w.at ? w : null;
  }

  /** The brief in one line — only while it still describes today. */
  worldSummary() {
    const w = this.world();
    if (!w) return null;
    const made = Date.parse(w.at);
    if (!(this.now() - made < WORLD_FRESH_MS) || istDate(made) !== istDate(this.now())) return null;
    return { mood: w.mood, headline: w.headline, at: w.at, time: new Date(made + IST).toISOString().slice(11, 16) };
  }

  /**
   * Overseas markets, gathered by web search and then put into a fixed shape.
   * Two requests: one that searches and writes, one that structures what was written.
   */
  async worldBrief({ refresh = false } = {}) {
    const have = this.world();
    if (have && !refresh && this.now() - Date.parse(have.at) < 30 * 60000) return { ...have, repeated: true };
    const searcher = this._searchClient();
    const client = this._client();
    const ist = new Date(this.now() + IST);
    const stamp = `${ist.toISOString().slice(0, 10)} ${ist.toISOString().slice(11, 16)}`;
    const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][ist.getUTCDay()];
    const found = await searcher.search({ system: WORLD_SYSTEM, user: `It is ${weekday} ${stamp} India time. Prepare the brief.` });
    const shaped = await client.ask({ system: WORLD_SHAPE_SYSTEM, user: `Brief:\n\n${found.text}`, schema: WORLD_SCHEMA, maxTokens: 6000, effort: "low" });
    const d = shaped.data;
    const str = (x, n) => String(x == null ? "" : x).slice(0, n);
    const out = {
      at: new Date(this.now()).toISOString(),
      model: found.model,
      mood: ["risk_on", "risk_off", "mixed"].includes(d.mood) ? d.mood : "mixed",
      headline: str(d.headline, 240),
      indiaRead: str(d.india_read, 900),
      cues: (Array.isArray(d.cues) ? d.cues : []).slice(0, 16).map((c) => ({ name: str(c.name, 60), value: str(c.value, 60), change: str(c.change, 40), asOf: str(c.as_of, 60), read: ["positive", "negative", "neutral"].includes(c.read) ? c.read : "neutral" })),
      sectors: (Array.isArray(d.sectors) ? d.sectors : []).slice(0, 8).map((x) => ({ sector: str(x.sector, 60), bias: ["tailwind", "headwind", "watch"].includes(x.bias) ? x.bias : "watch", why: str(x.why, 240) })),
      events: (Array.isArray(d.events) ? d.events : []).slice(0, 8).map((x) => str(x, 240)),
      caveats: (Array.isArray(d.caveats) ? d.caveats : []).slice(0, 6).map((x) => str(x, 240)),
      text: found.text.slice(0, 6000),
      sources: found.sources,
      usage: {
        inputTokens: found.usage.inputTokens + shaped.usage.inputTokens,
        outputTokens: found.usage.outputTokens + shaped.usage.outputTokens,
        searches: found.usage.searches,
      },
    };
    this.docs.write("ai/world.json", out);
    this.log.log(`[ai] world brief by ${out.model}: ${out.usage.searches} searches, ${out.usage.inputTokens} in / ${out.usage.outputTokens} out tokens`);
    return out;
  }

  /* ------------------------------------------------------- company news */

  _newsAll() {
    const all = this.docs.read("ai/news.json", {});
    return all && typeof all === "object" && !Array.isArray(all) ? all : {};
  }

  /** The stored news check for a symbol, whatever its age, or null. */
  newsFor(symbol) {
    const n = this._newsAll()[symbol];
    return n && n.at ? n : null;
  }

  /** The check in one line — only while it is still today's and a few hours old at most. */
  newsSummary(symbol) {
    const n = this.newsFor(symbol);
    if (!n) return null;
    const made = Date.parse(n.at);
    if (!(this.now() - made < NEWS_FRESH_MS) || istDate(made) !== istDate(this.now())) return null;
    return { tone: n.tone, headline: n.headline, explainsMove: n.explainsMove, at: n.at, time: new Date(made + IST).toISOString().slice(11, 16) };
  }

  /**
   * "Why is it moving?" — a web search on one company, then a fixed shape.
   * Two requests, like the world brief. Only the symbol, the company's name and
   * today's move are sent.
   */
  async news(symbol, { refresh = false } = {}) {
    const have = this.newsFor(symbol);
    if (have && !refresh && this.now() - Date.parse(have.at) < NEWS_REUSE_MS) return { ...have, repeated: true };
    const searcher = this._searchClient();
    const client = this._client();
    let name = "";
    let move = null;
    try {
      if (typeof this.market.nameOf === "function") name = await this.market.nameOf(symbol);
    } catch (_) {
      name = "";
    }
    try {
      const q = typeof this.market.quotes === "function" ? (await this.market.quotes([symbol])).quotes[symbol] : null;
      if (q && num(q.changePct)) move = { last: r2(q.last), changePct: r2(q.changePct) };
    } catch (_) {
      move = null;
    }
    const ist = new Date(this.now() + IST);
    const stamp = `${ist.toISOString().slice(0, 10)} ${ist.toISOString().slice(11, 16)}`;
    const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][ist.getUTCDay()];
    const moving = move ? ` The share is at ${move.last}, ${move.changePct >= 0 ? "up" : "down"} ${Math.abs(move.changePct).toFixed(2)}% against the previous close.` : "";
    const who = name && name.toUpperCase() !== symbol ? `${name} (NSE symbol ${symbol})` : `the company with NSE symbol ${symbol}`;
    const found = await searcher.search({ system: NEWS_SYSTEM, user: `Company: ${who}. It is ${weekday} ${stamp} India time.${moving} Check the news.`, maxUses: 5, maxTokens: 6000 });
    const shaped = await client.ask({ system: NEWS_SHAPE_SYSTEM, user: `Brief:\n\n${found.text}`, schema: NEWS_SCHEMA, maxTokens: 4000, effort: "low" });
    const d = shaped.data;
    const str = (x, n) => String(x == null ? "" : x).slice(0, n);
    const out = {
      symbol,
      name,
      at: new Date(this.now()).toISOString(),
      model: found.model,
      move,
      tone: ["positive", "negative", "mixed", "neutral", "none"].includes(d.tone) ? d.tone : "neutral",
      headline: str(d.headline, 260),
      explainsMove: ["yes", "partly", "no", "unknown"].includes(d.explains_move) ? d.explains_move : "unknown",
      items: (Array.isArray(d.items) ? d.items : []).slice(0, 8).map((x) => ({ date: str(x && x.date, 40), what: str(x && x.what, 300), read: ["positive", "negative", "neutral"].includes(x && x.read) ? x.read : "neutral" })),
      upcoming: (Array.isArray(d.upcoming) ? d.upcoming : []).slice(0, 6).map((x) => str(x, 240)),
      caveats: (Array.isArray(d.caveats) ? d.caveats : []).slice(0, 6).map((x) => str(x, 240)),
      text: found.text.slice(0, 5000),
      sources: found.sources,
      usage: {
        inputTokens: found.usage.inputTokens + shaped.usage.inputTokens,
        outputTokens: found.usage.outputTokens + shaped.usage.outputTokens,
        searches: found.usage.searches,
      },
    };
    const all = this._newsAll();
    all[symbol] = out;
    const keys = Object.keys(all);
    if (keys.length > NEWS_KEEP) keys.sort((a, b) => Date.parse(all[a].at) - Date.parse(all[b].at)).slice(0, keys.length - NEWS_KEEP).forEach((k) => delete all[k]);
    this.docs.write("ai/news.json", all);
    this.log.log(`[ai] news check for ${symbol} by ${out.model}: ${out.usage.searches} searches, ${out.usage.inputTokens} in / ${out.usage.outputTokens} out tokens`);
    return out;
  }

  /* --------------------------------------------------------------- brief */

  /** Everything the strategist is shown about one stock. Market data only — nothing personal. */
  async brief(symbol) {
    const v = await this.market.verdict(symbol);
    if (!v.available) throw new AiError(v.reason || "There is not enough data for this symbol.", "no_data", 409);
    const a = await this.market.analysis(symbol, { chartBars: 60 });
    let backtests = [];
    try {
      const bt = await this.market.backtestAll(symbol, {});
      backtests = bt.rows.map((r) => ({
        setup: r.name,
        trades: r.stats.trades,
        winRatePct: r.stats.winRatePct,
        avgPerTradePct: r.stats.expectancyPct,
        profitFactor: r.stats.profitFactor,
        returnPerYearPct: r.stats.cagrPct,
        buyAndHoldPerYearPct: r.stats.buyHoldCagrPct,
        worstFallPct: r.stats.maxDrawdownPct,
        evidence: r.stats.reliability,
      }));
    } catch (_) {
      /* a brief without backtests is still a brief */
    }
    const daily = (await this.market.daily(symbol)).candles.slice(-30).map((c) => [c.t, r2(c.o), r2(c.h), r2(c.l), r2(c.c), c.v]);
    const mine = this.journal.all().filter((e) => e.symbol === symbol && e.source === "kite");
    const day = v.day || { available: false, reason: "not available" };
    const lt = v.longTerm || { available: false };
    // the market around the stock, when the feed has it
    let indianMarket = null;
    if (typeof this.market.context === "function") {
      try {
        const c = await this.market.context();
        if (c.available) {
          indianMarket = {
            tide: c.tide,
            nifty: c.nifty,
            indiaVix: c.vix,
            instruments: c.items.filter((x) => x.available).map((x) => ({ name: x.name, last: x.last, changePct: x.changePct, fromOpenPct: x.fromOpenPct })),
            sectors: c.sectors.map((x) => ({ sector: x.name, changePct: x.changePct })),
            notes: c.notes,
          };
        }
      } catch (_) {
        indianMarket = null;
      }
    }
    const w = this.worldSummary() ? this.world() : null;
    const news = this.newsSummary(symbol) ? this.newsFor(symbol) : null;

    const brief = {
      symbol,
      asOf: v.at,
      dataSource: v.source === "demo" ? "DEMO — synthetic prices, not a real stock" : "Zerodha Kite",
      dataNotes: [v.stale ? `STALE DAILY DATA: ${v.staleReason}` : null, v.quoteNote || null, a.barInProgress ? "Today's daily bar is unfinished." : null].filter(Boolean),
      price: { last: v.last, live: Boolean(v.quoteLive), prevClose: a.price.prevClose, open: a.price.open, dayHigh: v.movement.dayHigh, dayLow: v.movement.dayLow },
      circuit: v.circuit,
      session: day.session || null,
      atr: v.movement.atr,
      indianMarket,
      worldBrief: w ? { gatheredAt: w.at, source: "web search — figures can be stale or wrong", mood: w.mood, headline: w.headline, indiaRead: w.indiaRead, cues: w.cues, events: w.events, caveats: w.caveats } : null,
      companyNews: news ? { gatheredAt: news.at, source: "web search — can be stale, incomplete or wrong", tone: news.tone, headline: news.headline, explainsTodaysMove: news.explainsMove, items: news.items, scheduled: news.upcoming, caveats: news.caveats } : null,
      ruleEngine: {
        intraday: day.available
          ? { call: day.headline, state: day.state, tapeScore: day.score, needs: day.threshold, factors: day.factors, plan: day.plan, triggers: day.triggers, movement: day.movement, earlyWarnings: (day.early || []).map((e) => e.text), oneMinuteTape: day.fast ? day.fast.summary : null, notes: day.notes }
          : { available: false, reason: day.reason, nextSessionLevels: v.intraday },
        swing: { stance: v.stance, score: v.composite, conviction: v.conviction, timeFrames: v.frames, plan: v.swing, against: v.against },
        longTerm: lt.available ? { stance: lt.stance, checksMet: `${lt.met}/${lt.total}`, checks: lt.checks, levels: lt.levels, returns: lt.returns, risk: lt.risk } : { available: false },
      },
      daily: {
        reading: { score: a.score.value, label: a.score.label },
        indicators: a.indicators,
        levels: { pivots: a.levels.pivots, supports: a.levels.supports, resistances: a.levels.resistances, movingAverages: a.levels.movingAverages, week52: a.levels.week52 },
        setups: a.setups.map((s) => ({ name: s.name, triggered: s.triggered, conditionsMet: `${s.met}/${s.total}` })),
        warnings: (a.bearish || []).map((b) => b.name),
        patterns: a.patterns,
        returns: a.returns,
        volatilityPct: a.volatilityPct,
        liquidity: a.liquidity,
        relativeStrength: a.relative,
      },
      backtestsOnThisStock: backtests,
      last30DailyBars: { columns: ["date", "open", "high", "low", "close", "volume"], rows: daily },
      todayTape5min: v.tape && v.tape.today ? { columns: ["time", "open", "high", "low", "close", "volume", "vwap"], rows: v.tape.bars.map((b) => [b.t, b.o, b.h, b.l, b.c, b.v, b.w]), openingRange: [v.tape.orLow, v.tape.orHigh] } : null,
      yourEarlierPlansHere: {
        record: summarize(mine),
        latest: mine.slice(-5).flatMap((e) => e.plans.filter((p) => p.action !== "no_trade").map((p) => ({ date: e.at.slice(0, 10), horizon: p.horizon, side: p.side, entry: p.entry, stop: p.stop, target: p.target, outcome: p.outcome ? p.outcome.status : "pending", r: p.outcome ? p.outcome.r : null }))),
      },
    };
    return { brief, verdict: v };
  }

  /* ------------------------------------------------------------ strategy */

  async strategy(symbol, horizon = "both") {
    const h = HORIZONS.includes(horizon) ? horizon : "both";
    const cacheKey = `${symbol}|${h}`;
    const hit = this._recent.get(cacheKey);
    if (hit && this.now() - hit.at < 60000) return { ...hit.result, repeated: true };

    const client = this._client(); // fails fast, before any data is fetched, when no key is set
    const { brief, verdict } = await this.brief(symbol);
    const want = h === "both" ? "an intraday plan and a swing plan" : `${h === "intraday" ? "an intraday" : "a swing"} plan only`;
    const user = `Trading-skills file:\n\n${this.playbook.read()}\n\n---\n\nBrief for ${symbol}:\n\n${JSON.stringify(brief)}\n\n---\n\nBuild the strategy for ${symbol}. Give ${want}.`;

    const answer = await client.ask({ system: SYSTEM, user, schema: STRATEGY_SCHEMA });
    const d = answer.data;
    const day = verdict.day || {};
    const ctx = { last: verdict.last, atr: verdict.movement.atr, circuit: verdict.circuit, session: day.session || null };
    const wanted = h === "both" ? ["intraday", "swing"] : [h];
    const plans = (Array.isArray(d.plans) ? d.plans : [])
      .filter((p) => p && wanted.includes(p.horizon))
      .slice(0, 2)
      .map((p) => {
        const c = checkPlan(p, ctx);
        // where the fixed rules and the model disagree, say so rather than hide it
        const engineSide = p.horizon === "intraday" ? (day.available ? day.side : null) : verdict.direction === "bullish" ? "long" : verdict.direction === "bearish" ? "avoid" : "none";
        if (c.plan.side && engineSide && engineSide !== "none" && engineSide !== c.plan.side) c.notes.push(`The rule-based engine reads this horizon differently (${engineSide === "avoid" ? "no longs" : engineSide}). Two methods disagreeing is a reason for smaller size or no trade.`);
        return { ...c.plan, checks: c.checks, checkStatus: c.status, notes: c.notes, outcome: null };
      });

    const entry = {
      id: crypto.randomBytes(8).toString("hex"),
      at: new Date(this.now()).toISOString(),
      symbol,
      source: verdict.source,
      horizon: h,
      provider: this._provider(),
      model: answer.model,
      servedBy: answer.servedBy,
      stance: ["bullish", "bearish", "neutral"].includes(d.stance) ? d.stance : "neutral",
      confidence: ["low", "medium", "high"].includes(d.confidence) ? d.confidence : "low",
      summary: String(d.summary || ""),
      evidence: (d.evidence || []).map(String).slice(0, 8),
      risks: (d.risks || []).map(String).slice(0, 8),
      changeMind: (d.would_change_my_mind || []).map(String).slice(0, 6),
      skillsUsed: (d.skills_used || []).map(String).slice(0, 6),
      plans,
      context: { last: verdict.last, atr: verdict.movement.atr, live: Boolean(verdict.quoteLive), stale: Boolean(verdict.stale), phase: day.session ? day.session.phase : null, engineIntraday: day.available ? day.state : null, engineSwing: verdict.direction },
      usage: answer.usage,
      learnedAt: null,
    };
    this.journal.add(entry);
    this.log.log(`[ai] strategy for ${symbol} (${h}) by ${answer.model}: ${answer.usage.inputTokens} in / ${answer.usage.outputTokens} out tokens`);
    this._recent.set(cacheKey, { at: this.now(), result: entry });
    if (this._recent.size > 50) this._recent.clear();
    return entry;
  }

  /* ------------------------------------------------------ score and learn */

  /** Score every unresolved plan against the bars that followed it. Arithmetic only. */
  async score() {
    const now = this.now();
    const today = istDate(now);
    let scored = 0;
    const errors = [];
    const dailyCache = new Map();
    const tapeCache = new Map();

    for (const e of this.journal.all()) {
      if (e.source !== "kite") continue; // demo plans are not evidence of anything
      for (const p of e.plans) {
        if (p.action === "no_trade" || p.checkStatus !== "passed") continue;
        if (p.outcome && FINAL.has(p.outcome.status)) continue;
        const madeAt = Date.parse(e.at);
        const madeOn = istDate(madeAt);
        try {
          let bars;
          let expire;
          if (p.horizon === "intraday") {
            const key = `${e.symbol}|${madeOn}`;
            if (!tapeCache.has(key)) tapeCache.set(key, await this.market.intradayOn(e.symbol, madeOn));
            // only bars that began after the plan, and nothing past the 3:15 PM square-off
            bars = tapeCache.get(key).filter((b) => {
              const s = barStart(b.t);
              return s !== null && s >= madeAt && String(b.t).slice(11, 16) < "15:15";
            });
            expire = madeOn < today || new Date(now + IST).getUTCHours() * 60 + new Date(now + IST).getUTCMinutes() >= 15 * 60 + 30;
          } else {
            if (!dailyCache.has(e.symbol)) dailyCache.set(e.symbol, (await this.market.daily(e.symbol)).candles);
            // sessions after the day the plan was made
            bars = dailyCache.get(e.symbol).filter((c) => c.t > madeOn).slice(0, SWING_MAX_BARS);
            expire = bars.length >= SWING_MAX_BARS;
          }
          p.outcome = { ...scorePlan({ side: p.side, entry: p.entry, stop: p.stop, target: p.target, entryType: p.entryType }, bars, { expire }), scoredAt: new Date(now).toISOString() };
          scored += 1;
        } catch (err) {
          errors.push(`${e.symbol} (${madeOn}): ${err.message}`);
        }
      }
    }
    if (scored) this.journal.save();
    return { scored, errors };
  }

  /** Score, then — if enough new results exist and a key is set — ask for lessons and append them. */
  async review() {
    const { scored, errors } = await this.score();
    const fresh = [];
    for (const e of this.journal.all()) {
      if (e.source !== "kite" || e.learnedAt) continue;
      const done = e.plans.filter((p) => p.checkStatus === "passed" && p.outcome && FINAL.has(p.outcome.status) && p.outcome.status !== "invalid");
      const waiting = e.plans.some((p) => p.checkStatus === "passed" && p.action !== "no_trade" && !(p.outcome && FINAL.has(p.outcome.status)));
      if (done.length && !waiting) fresh.push({ e, done });
    }
    const outcomes = fresh.flatMap(({ e, done }) =>
      done.map((p) => ({
        symbol: e.symbol,
        date: e.at.slice(0, 10),
        horizon: p.horizon,
        side: p.side,
        entryType: p.entryType,
        sessionPhaseWhenPlanned: e.context ? e.context.phase : null,
        aiStance: e.stance,
        aiConfidence: e.confidence,
        ruleEngineIntraday: e.context ? e.context.engineIntraday : null,
        ruleEngineSwing: e.context ? e.context.engineSwing : null,
        rewardToRisk: p.rewardToRisk,
        result: p.outcome.status,
        r: p.outcome.r,
        note: p.outcome.note,
        rationale: p.rationale.slice(0, 240),
      }))
    );
    const stats = summarize(this.journal.all().filter((x) => x.source === "kite"));
    const base = { scored, errors, newOutcomes: outcomes.length, stats, lessonsAdded: [], observation: "" };

    if (outcomes.length < MIN_TO_LEARN) return { ...base, learned: false, why: `Only ${outcomes.length} newly finished plan${outcomes.length === 1 ? "" : "s"} — at least ${MIN_TO_LEARN} are needed before drawing lessons, so one lucky or unlucky trade cannot rewrite the rules.` };
    if (!this.configured()) return { ...base, learned: false, why: "Plans were scored. Add an AI API key in the AI settings to turn results into lessons." };

    const user = `Lessons already in the skills file:\n${this.playbook.lessons().map((l) => `- ${l}`).join("\n") || "(none)"}\n\nOverall record so far: ${JSON.stringify(stats)}\n\nNewly scored outcomes (${outcomes.length}):\n${JSON.stringify(outcomes.slice(-40))}`;
    const answer = await this._client().ask({ system: LEARN_SYSTEM, user, schema: LEARN_SCHEMA, maxTokens: 8000, effort: "medium" });
    const lessons = (Array.isArray(answer.data.lessons) ? answer.data.lessons : []).map(String).slice(0, 5);
    const stamp = new Date(this.now()).toISOString();
    if (lessons.length) this.playbook.appendLessons(lessons, istDate(this.now()));
    fresh.forEach(({ e }) => {
      e.learnedAt = stamp;
    });
    this.journal.save();
    this.log.log(`[ai] review: ${outcomes.length} outcomes → ${lessons.length} lesson(s)`);
    return { ...base, learned: true, lessonsAdded: lessons, observation: String(answer.data.observation || ""), usage: answer.usage };
  }

  entries({ symbol = null, limit = 30 } = {}) {
    return { entries: this.journal.list({ symbol, limit }), stats: summarize(this.journal.all().filter((e) => e.source === "kite" && (!symbol || e.symbol === symbol))) };
  }
}

module.exports = { AiService, AiError, checkPlan, SYSTEM, STRATEGY_SCHEMA, HORIZONS };
