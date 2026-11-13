"use strict";
// The AI decision: where a stock looks to be heading and what to do about it, judged from
// BOTH what it is doing now (live price, volume, the 5- and 1-minute tape, indicators, levels,
// the rule engine's calls, the market, news) AND how it has behaved over the past year (the
// behaviour profile kept in the database: its trend phases, how its gaps fill, what follows
// its big days, how its breakouts follow through, how it reacts at its 50-day average…).
//
// A third input, when it exists: the MEASURED ODDS (server/market/edge.js) — what followed the
// past days most like today, and whether such calls held up when tested forward on this stock.
// The model is told to read them as past frequencies with a sample size, never as a promise.
//
// Additional to the strategist and the co-pilot — neither changes. Any plan it gives is put
// through the same mechanical checks as the strategist's (stop on the right side, sensible
// distance against ATR, inside the circuit limits). Every decision is stored with the price
// at the time, so its record can be looked at later. It advises; it never places an order.

const crypto = require("crypto");
const { AiError } = require("./client");

const NAME = "ai/decisions.json";
const KEEP = 200;
const str = (x, n) => String(x == null ? "" : x).trim().slice(0, n);
const list = (x, max, n) => (Array.isArray(x) ? x : []).map((v) => str(v, n)).filter(Boolean).slice(0, max);

const DECISION_SYSTEM = `You are the decision desk of a private trading terminal for NSE (India) cash equities. One trader reads your decision and decides for themselves; you never place orders.

You are given three things about one stock:
1. TODAY — a full live brief: price and volume, the day's 5-minute tape, the 1-minute read, daily indicators, levels (pivots, supports, resistances, moving averages, the 52-week range), the rule engine's intraday, swing and long-term calls, the Indian market and a world brief, and company news if checked.
2. ITS HABITS — a behaviour profile measured from its past year of daily bars: trend phases, swing structure, volatility against its own normal, how its gaps fill, what has followed its big up and down days, how its 20-day breakouts and breakdowns followed through, how it reacted at its 50-day average, its levels, weekday tendencies, volume on up versus down days, and a log of notable days.
3. MEASURED ODDS — for the 50 past days of this stock most similar to today (by trend, momentum, place in its range, volume, volatility and the market), what two fixed-rule trades did next, after costs, in R (multiples of the amount risked): a swing trade (in at the next open, stop 1.5 ATR away, target 2.25 ATR, out after 10 sessions) and a day trade (in at the open, stop 0.6 ATR away, out at the close). With them comes the FORWARD TEST: how the same favourable calls did on this stock when each was made from earlier data only. Grade A = favourable today and the forward test is strong; B = favourable, the test is positive but not conclusive; C = favourable today but the forward test does NOT back it; no grade = not favourable. This input may be missing.

How to decide:
- Say where it is heading ("up", "down" or "sideways") and on which horizon, and weigh today's evidence against its habits: a breakout in a stock whose breakouts usually fail deserves less trust; a gap in a stock whose gaps usually fill is a warning; a test of the 50-day average in a stock that usually holds it is an opportunity. Quote the habit's numbers and sample size.
- The measured odds are past frequencies with a sample size, not a probability of profit. A grade A or B reading that agrees with today's evidence strengthens a decision; grade C or no grade must never be the reason for a trade; a graded downside warning argues against a new long. When you use them, quote the numbers: how many similar days, the share that won, the average result in R, and the forward test's trades, win share and average R.
- decision: "buy" (go long), "sell" (an intraday short, or for a holder: exit), "hold" (keep an existing long, add nothing), "wait" (a setup may form: say at which level), or "avoid". In the cash market a short is intraday only.
- For "buy" or "sell", give entry, stop and up to three targets taken from the brief's levels — say which level. A long's stop sits below the entry, a short's above. Never invent a price.
- Where the two sources disagree, or the evidence is thin, prefer "wait" or "avoid" and say why. Never promise or imply a profit or a probability of profit. Short, concrete sentences.`;

const DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "horizon", "heading", "confidence", "thesis", "live_evidence", "habit_evidence", "odds_evidence", "conflicts", "entry", "stop", "targets", "level_notes", "invalidation", "watch"],
  properties: {
    decision: { type: "string", enum: ["buy", "sell", "hold", "wait", "avoid"] },
    horizon: { type: "string", enum: ["intraday", "swing"] },
    heading: { type: "string", enum: ["up", "down", "sideways"] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    thesis: { type: "string", description: "Three or four sentences: the decision and the main reasons." },
    live_evidence: { type: "array", items: { type: "string" }, description: "Up to five facts from today's brief, with numbers." },
    habit_evidence: { type: "array", items: { type: "string" }, description: "Up to five facts from the behaviour profile, each with its numbers and sample size." },
    odds_evidence: { type: "array", items: { type: "string" }, description: "Up to four facts from the measured odds and their forward test, with numbers and sample sizes; empty when that input is missing." },
    conflicts: { type: "array", items: { type: "string" }, description: "Where today, the habits and the measured odds disagree, or nothing." },
    entry: { type: "number", description: "For buy or sell; 0 otherwise." },
    stop: { type: "number", description: "For buy or sell; 0 otherwise." },
    targets: { type: "array", items: { type: "number" }, description: "Up to three, nearest first; empty otherwise." },
    level_notes: { type: "string", description: "Which levels the entry, stop and targets come from." },
    invalidation: { type: "string", description: "What would cancel this decision." },
    watch: { type: "array", items: { type: "string" }, description: "Up to four levels or conditions to watch next." },
  },
};

/** The profile cut to what the model needs (the full log is long). */
function slimProfile(p) {
  if (!p || !p.available) return { available: false, reason: p ? p.reason : "no profile" };
  return {
    available: true,
    asOf: p.asOf,
    days: p.days,
    price: p.price,
    trend: { ...p.trend, phases: p.trend.phases.slice(-6) },
    structure: p.structure,
    volatility: p.volatility,
    gaps: p.gaps,
    returns: p.returns,
    breakouts: p.breakouts,
    breakdowns: p.breakdowns,
    ema50Tests: p.ema50Tests,
    levels: p.levels,
    weekday: p.weekday,
    volume: p.volume,
    drawdown: p.drawdown,
    habits: p.facts,
    recentNotableDays: p.log.slice(-15),
    snapshots: (p.history || []).slice(-10),
  };
}

/** The measured odds cut to what the model needs. */
function slimEdge(e) {
  if (!e || !e.available) return { available: false, reason: e && e.reason ? e.reason : "not measured for this stock" };
  const side = (x) => ({
    grade: x.grade,
    reading: x.why,
    similarDays: x.live,
    forwardTest: { trades: x.oos.trades, winPct: x.oos.winPct, avgR: x.oos.expR, t: x.oos.t, profitFactor: x.oos.pf, maxDrawdownR: x.oos.maxDdR, lastTwoYears: x.oos.recent, takingEveryDay: x.oos.base },
    plan: x.plan,
  });
  const kind = (k) => ({ rules: { sessions: k.horizon, stopAtr: k.stopAtr, targetAtr: k.targetAtr, costPct: k.costPct }, openNotYetKnown: Boolean(k.preOpen), long: side(k.long), short: side(k.short), mostSimilarDays: k.analogs, afterSimilarDays: k.forward });
  return { available: true, asOf: e.asOf, atr: e.atr, gapAtr: e.gapAtr, best: e.best, warning: e.warning, swing: kind(e.kinds.swing), day: kind(e.kinds.day) };
}

class Decision {
  constructor(ai, checkPlan) {
    this.ai = ai;
    this.checkPlan = checkPlan;
    this._busy = new Map();
  }

  _all() {
    const a = this.ai.docs.read(NAME, []);
    return Array.isArray(a) ? a : [];
  }

  list(symbol = null) {
    const all = this._all();
    return { configured: this.ai.configured(), decisions: (symbol ? all.filter((d) => d.symbol === symbol) : all).slice(0, 20) };
  }

  async decide(symbol) {
    if (this._busy.has(symbol)) return this._busy.get(symbol);
    const client = this.ai._client();
    const job = (async () => {
      // the measured odds are an extra: without them the decision is made as before
      const odds = typeof this.ai.market.edge === "function" ? this.ai.market.edge(symbol).catch(() => null) : null;
      const [{ brief, verdict }, profile, edge] = await Promise.all([this.ai.brief(symbol), this.ai.market.behaviour(symbol), odds]);
      const user = `Trading-skills file:\n\n${this.ai.playbook.read()}\n\n---\n\nTODAY for ${symbol}:\n\n${JSON.stringify(brief)}\n\n---\n\nITS HABITS (behaviour profile, past year of daily bars):\n\n${JSON.stringify(slimProfile(profile))}\n\n---\n\nMEASURED ODDS (similar past days, and the forward test of such calls on this stock):\n\n${JSON.stringify(slimEdge(edge))}\n\n---\n\nGive the decision for ${symbol}.`;
      const answer = await client.ask({ system: DECISION_SYSTEM, user, schema: DECISION_SCHEMA, effort: "medium", maxTokens: 12000 });
      const d = answer.data;
      const decision = ["buy", "sell", "hold", "wait", "avoid"].includes(d.decision) ? d.decision : "wait";
      const horizon = d.horizon === "swing" ? "swing" : "intraday";
      // the plan's prices go through the strategist's mechanical checks
      let plan = null;
      if (decision === "buy" || decision === "sell") {
        const day = verdict.day || {};
        const ctx = { last: verdict.last, atr: verdict.movement.atr, circuit: verdict.circuit, session: day.session || null };
        const c = this.checkPlan({ horizon: decision === "sell" ? "intraday" : horizon, action: decision === "buy" ? "long" : "short", entry_type: "at_market", entry: d.entry, stop: d.stop, targets: d.targets, rationale: d.thesis, invalidation: d.invalidation }, ctx);
        plan = { side: c.plan.side, entry: c.plan.entry, stop: c.plan.stop, targets: c.plan.targets, checks: c.checks, checkStatus: c.status, notes: c.notes };
      }
      const out = {
        id: crypto.randomBytes(6).toString("hex"),
        at: new Date(this.ai.now()).toISOString(),
        symbol,
        model: answer.model,
        priceAt: verdict.last,
        live: Boolean(verdict.quoteLive),
        decision,
        horizon,
        heading: ["up", "down", "sideways"].includes(d.heading) ? d.heading : "sideways",
        confidence: ["low", "medium", "high"].includes(d.confidence) ? d.confidence : "low",
        thesis: str(d.thesis, 1500),
        liveEvidence: list(d.live_evidence, 5, 400),
        habitEvidence: list(d.habit_evidence, 5, 400),
        oddsEvidence: list(d.odds_evidence, 4, 400),
        odds: edge && edge.available ? { asOf: edge.asOf, best: edge.best, warning: edge.warning } : null,
        conflicts: list(d.conflicts, 4, 400),
        plan,
        levelNotes: str(d.level_notes, 500),
        invalidation: str(d.invalidation, 400),
        watch: list(d.watch, 4, 300),
        engine: { intraday: verdict.day && verdict.day.available ? verdict.day.state : null, swing: verdict.direction },
        profileAsOf: profile && profile.available ? profile.asOf : null,
        usage: answer.usage,
      };
      this.ai.docs.write(NAME, [out, ...this._all()].slice(0, KEEP));
      this.ai.log.log(`[ai] decision for ${symbol} by ${answer.model}: ${decision} (${horizon}, ${out.confidence}) — ${answer.usage.inputTokens} in / ${answer.usage.outputTokens} out tokens`);
      return out;
    })();
    this._busy.set(symbol, job);
    try {
      return await job;
    } finally {
      this._busy.delete(symbol);
    }
  }
}

module.exports = { Decision, DECISION_SYSTEM, DECISION_SCHEMA, slimProfile, slimEdge };
