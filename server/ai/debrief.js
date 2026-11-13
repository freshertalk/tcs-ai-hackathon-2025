"use strict";
// The end-of-day debrief: the day's facts, worked out by arithmetic, read back by the
// model as a short review — what the engine's calls did, what repeated, what to carry
// into tomorrow.
//
// The facts come first and stand without the model: the market service replays the
// rule engine over the session's 5-minute bars for every stock on the watchlist and
// scores each "in play" call (the day's scorecard — it needs no API key). To those are
// added the live co-pilot's scored readings and the strategist's plans from the same
// session, when there are any. The model is shown only those facts.
//
// It runs when the button is pressed — nothing here works by the clock. Lessons it
// suggests are shown, not saved: one goes into the trading-skills file only when the
// trader presses "add" on it.

const crypto = require("crypto");

const { AiError } = require("./client");

const IST = 5.5 * 3600 * 1000;
const KEEP = 30;
const REUSE_MS = 10 * 60000; // asked again sooner than this for the same session: the stored one
const MAX_STOCKS = 15;

const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const str = (x, n) => String(x == null ? "" : x).trim().slice(0, n);
const list = (x, max, n) => (Array.isArray(x) ? x : []).map((v) => str(v, n)).filter(Boolean).slice(0, max);

const DEBRIEF_SYSTEM = `You write the end-of-day debrief for a private day-trading desk in NSE (India) cash equities. One trader reads it after the close, to learn from the day.

You are given facts worked out by arithmetic. For each stock on the watchlist: how its day went, and a replay of the desk's rule engine — every "in play" call it would have made at a 5-minute close and how that call ended (target, stop, square-off, or closed by the opposite call), in multiples of the risk taken (R), before and after an assumed cost per round trip. You may also be given the live AI co-pilot's readings with their scores, the AI strategist's plans from the same session, and the direction of the market.

How to work:
- Use only the facts given, and quote their numbers. Do not invent a trade, a price or a reason. If the facts cannot explain something, say that.
- The replay is not a record of what the trader did. Never write as if these trades were taken. It shows what following the engine's calls mechanically would have done.
- Separate process from outcome. A stopped-out call made for sound reasons at a sound time is not a mistake, and a winner that needed luck is not a lesson. Look for conditions that repeat within today's facts: the time of day, with or against the daily trend, how wide the stop was against the cost, how many calls one stock produced, calls that were closed by the opposite call.
- Costs matter. Where a stop is so tight that the assumed cost is a large share of the risk, say so with the numbers.
- One day is a tiny sample; say it once, plainly. Offer at most three lessons — each one sentence, written as an instruction about process — and only when at least two of today's calls support it. Prefer no lesson to a weak one.
- "watch_tomorrow" is levels or conditions taken from the facts that are worth having in mind at the next open (today's high and low, VWAP at the close, the opening range). It is never a forecast and never a trade to take.
- Never promise or imply a profit, a win rate or a probability. Short, concrete sentences. No filler.`;

const DEBRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "summary", "what_worked", "what_did_not", "by_stock", "copilot_note", "lessons", "watch_tomorrow", "caveat"],
  properties: {
    headline: { type: "string", description: "The day in one line, under 16 words." },
    summary: { type: "string", description: "Three to five sentences: what the day was, what the replayed calls added up to before and after costs." },
    what_worked: { type: "array", items: { type: "string" }, description: "Up to four observations, each with its numbers." },
    what_did_not: { type: "array", items: { type: "string" }, description: "Up to four observations, each with its numbers." },
    by_stock: {
      type: "array",
      description: "One short note for each stock that produced a call, or that is worth a remark.",
      items: { type: "object", additionalProperties: false, required: ["symbol", "note"], properties: { symbol: { type: "string" }, note: { type: "string" } } },
    },
    copilot_note: { type: "string", description: "One or two sentences on the co-pilot's scored readings, or an empty string if there were none." },
    lessons: { type: "array", items: { type: "string" }, description: "Zero to three one-sentence process instructions." },
    watch_tomorrow: { type: "array", items: { type: "string" }, description: "Up to five levels or conditions from the facts, each naming its stock." },
    caveat: { type: "string", description: "What this debrief cannot show, in one or two sentences." },
  },
};

class Debrief {
  /** @param ai  the AiService: key, model, market service, journal, co-pilot and clock come from it */
  constructor(ai) {
    this.ai = ai;
    this.name = "ai/debriefs.json";
    this._busy = null; // the request in flight: a second press does not pay twice
  }

  _all() {
    const all = this.ai.docs.read(this.name, []);
    return Array.isArray(all) ? all : [];
  }

  _save(all) {
    this.ai.docs.write(this.name, all.slice(-KEEP));
  }

  /** The stored debriefs, newest first. Reading them costs nothing. */
  list() {
    return { configured: this.ai.configured(), debriefs: this._all().slice(-10).reverse() };
  }

  /**
   * Everything the model is shown: arithmetic and stored records, nothing personal.
   * @returns { facts, scorecard }
   */
  async facts(costPct) {
    const market = this.ai.market;
    if (typeof market.scorecard !== "function") throw new AiError("The day's scorecard is not available on this server.", "no_data", 409);
    // the same cost assumption as the scorecard on screen, so the two always agree
    const sc = await market.scorecard({ costPct });
    if (!sc.available) throw new AiError(sc.reason || "There is no session to debrief yet.", "no_data", 409);
    const date = sc.date;
    const rows = sc.rows.slice(0, MAX_STOCKS);

    const stocks = rows
      .filter((r) => r.available)
      .map((r) => ({
        symbol: r.symbol,
        day: {
          changePct: r.day.changePct,
          gapPct: r.day.gapPct,
          sinceOpenPct: r.day.fromOpenPct,
          open: r.day.open,
          high: r.day.high,
          low: r.day.low,
          close: r.day.close,
          rangeInAtrs: r.day.rangeVsAtr,
          vwapAtClose: r.day.vwap,
          closeVsVwapPct: r.day.closeVsVwapPct,
          openingRange: [r.day.orLow, r.day.orHigh],
          closedVsOpeningRange: r.day.closedVsOpeningRange,
        },
        calls: r.trades.map((t) => ({
          side: t.side,
          at: t.at,
          sessionPhase: t.phase,
          engineScore: t.score,
          dailyTrend: t.withDaily,
          entry: t.entry,
          stop: t.stop,
          target: t.target,
          riskPct: t.riskPct,
          endedAt: t.exitAt,
          exit: t.exit,
          how: t.why,
          r: t.r,
          costR: t.costR,
          netR: t.netR,
        })),
        result: { calls: r.summary.calls, target: r.summary.target, stop: r.summary.stop, squareOff: r.summary.squareOff, closedByOppositeCall: r.summary.flip, stillOpen: r.summary.open, grossR: r.summary.grossR, costR: r.summary.costR, netR: r.summary.netR },
        callChanges: r.changes.length,
        firstChanges: r.changes.slice(0, 12).map((c) => `${c.t} ${c.from} → ${c.to} at ${c.price}`),
      }));

    // the co-pilot's readings from the same session, when it was used
    const cp = this.ai.copilot.dayRecord(date);
    // the strategist's plans written during the same session
    const plans = this.ai.journal
      .all()
      .filter((e) => e.source === "kite" && istDate(Date.parse(e.at)) === date)
      .flatMap((e) =>
        e.plans.map((p) => ({
          symbol: e.symbol,
          madeAt: new Date(Date.parse(e.at) + IST).toISOString().slice(11, 16),
          horizon: p.horizon,
          action: p.action,
          entry: p.entry,
          stop: p.stop,
          target: p.target,
          checks: p.checkStatus,
          outcome: p.outcome ? p.outcome.status : "not scored yet",
          r: p.outcome ? p.outcome.r : null,
        }))
      )
      .slice(-20);

    let india = null;
    if (sc.today && typeof market.context === "function") {
      try {
        const c = await market.context();
        if (c.available) india = { tide: c.tide, nifty: c.nifty, indiaVix: c.vix };
      } catch (_) {
        india = null;
      }
    }

    const facts = {
      session: date,
      sessionComplete: sc.complete,
      howTheReplayWorks:
        "At each 5-minute close the rule engine is asked for its call with only what was known then (daily picture as of the previous close; no market-direction, tick or order-book inputs). A change to 'in play' opens one simulated trade at that close: the stop is checked first, then the 1R target; the opposite call closes it; otherwise it is closed at the 3:15 PM square-off. One trade at a time per stock.",
      assumedCostPctPerRoundTrip: sc.costPct,
      totals: sc.totals,
      everyFinishedCallInOrder: sc.curve.map((p) => ({ endedAt: p.t, symbol: p.symbol, side: p.side, how: p.why, netR: p.netR, runningTotalR: p.total })),
      stocks,
      notReplayed: rows.filter((r) => !r.available).map((r) => ({ symbol: r.symbol, why: r.reason })),
      copilot: cp,
      strategistPlans: plans,
      marketAtTheTimeOfWriting: india,
    };
    return { facts, scorecard: sc };
  }

  /** Write the debrief for the latest session, if the key is set. */
  async build({ refresh = false, costPct } = {}) {
    const client = this.ai._client(); // fails here, before anything is replayed, when no key is set
    if (this._busy) return this._busy;
    this._busy = this._build(client, refresh, costPct).finally(() => {
      this._busy = null;
    });
    return this._busy;
  }

  async _build(client, refresh, costPct) {
    const { facts, scorecard } = await this.facts(costPct);
    const now = this.ai.now();
    const have = this._all().filter((d) => d.day === facts.session).pop();
    // the same session at the same cost assumption, asked again within ten minutes: the stored one
    if (have && !refresh && have.costPct === scorecard.costPct && now - Date.parse(have.at) < REUSE_MS) return { ...have, repeated: true };

    const answer = await client.ask({
      system: DEBRIEF_SYSTEM,
      user: `Facts for the session of ${facts.session}:\n\n${JSON.stringify(facts)}\n\nWrite the debrief.`,
      schema: DEBRIEF_SCHEMA,
      maxTokens: 8000,
      effort: "medium",
    });
    const d = answer.data;
    const known = new Set(facts.stocks.map((s) => s.symbol));
    const out = {
      id: crypto.randomBytes(6).toString("hex"),
      at: new Date(now).toISOString(),
      day: facts.session,
      complete: Boolean(facts.sessionComplete),
      model: answer.model,
      headline: str(d.headline, 200),
      summary: str(d.summary, 1500),
      worked: list(d.what_worked, 4, 400),
      didNot: list(d.what_did_not, 4, 400),
      // a note about a stock that was not in the facts is not kept
      byStock: (Array.isArray(d.by_stock) ? d.by_stock : [])
        .filter((x) => x && known.has(String(x.symbol || "").toUpperCase()))
        .slice(0, MAX_STOCKS)
        .map((x) => ({ symbol: String(x.symbol).toUpperCase(), note: str(x.note, 400) })),
      copilotNote: str(d.copilot_note, 500),
      lessons: list(d.lessons, 3, 300).map((text) => ({ text, added: false })),
      tomorrow: list(d.watch_tomorrow, 5, 300),
      caveat: str(d.caveat, 500),
      // what the numbers were when it was written
      totals: scorecard.totals,
      costPct: scorecard.costPct,
      stocks: facts.stocks.length,
      sawCopilot: Boolean(facts.copilot),
      sawPlans: facts.strategistPlans.length,
      usage: answer.usage,
    };
    // one debrief per session: a newer one replaces the older
    const all = this._all().filter((x) => x.day !== out.day);
    all.push(out);
    this._save(all);
    this.ai.log.log(`[ai] debrief for ${out.day} by ${out.model}: ${out.stocks} stocks, ${out.totals.calls} calls — ${out.usage.inputTokens} in / ${out.usage.outputTokens} out tokens`);
    return out;
  }

  /** The trader accepts one suggested lesson: it goes into the trading-skills file, once. */
  addLesson(id, index) {
    const all = this._all();
    const d = all.find((x) => x.id === id);
    if (!d) throw new AiError("That debrief is no longer stored.", "not_found", 404);
    const lesson = Number.isInteger(index) ? d.lessons[index] : null;
    if (!lesson) throw new AiError("There is no such lesson in that debrief.", "invalid", 400);
    if (!lesson.added) {
      this.ai.playbook.appendLessons([lesson.text], d.day);
      lesson.added = true;
      this._save(all);
    }
    return { debrief: d, lessons: this.ai.playbook.lessons().length };
  }
}

module.exports = { Debrief, DEBRIEF_SYSTEM, DEBRIEF_SCHEMA };
