"use strict";
// The performance review: the model reads your own journal — the numbers, broken down by
// stock, side, intraday/delivery, weekday, hour, setup and mistake tag, plus a sample of the
// round trips — and says where your money is made and where it leaks, with the figures.
//
// It reads figures handed to it by the trading routes; it has no way to reach the broker.
// Rules it suggests go into the trading-skills file only when you press "Add".
// It runs only when asked; nothing here works by the clock.

const crypto = require("crypto");
const { AiError } = require("./client");

const NAME = "ai/reviews.json";
const KEEP = 20;
const IST = 5.5 * 3600 * 1000;
const str = (x, n) => String(x == null ? "" : x).trim().slice(0, n);
const list = (x, max, n) => (Array.isArray(x) ? x : []).map((v) => str(v, n)).filter(Boolean).slice(0, max);

const REVIEW_SYSTEM = `You review one trader's own results from their trading journal (Indian markets, mostly NSE equities). The trader reads it to improve their process.

You are given the journal's statistics — net P&L after estimated charges, win rate, average win and loss, profit factor, expectancy, maximum drawdown, streaks, holding time — broken down by stock, long/short, intraday/delivery, weekday, hour of entry, the setup tag and the mistake tags the trader put on trades, plus a sample of round trips with their excursions (MAE: how far a trade went against them; MFE: how far it went their way; "captured": the share of the best move they kept) where measured.

How to work:
- Use only the figures given and quote them. Never invent a trade or a number. Small groups (fewer than about 8 trades) are noise: say so rather than draw a conclusion from them.
- Find the leaks: the stocks, hours, weekdays, sides or tags where net P&L is negative with enough trades to matter; losses much larger than wins; low "captured" (exits too early) or deep MAE before winners (stops too wide) or losers held far past their MAE.
- Find the edge: where the trader is consistently net positive with a sample worth trusting.
- Charges matter: say what share of gross profit they took.
- Suggest at most four rules, each one sentence, written as an instruction about process ("Stop taking new trades after 2:00 PM: 31 trades there lost ₹4,200 net"), each backed by figures from the data. Prefer no rule to a weak one.
- Never promise or imply a future profit or probability. Short, concrete sentences.`;

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "summary", "edge", "leaks", "rules", "focus", "caveat"],
  properties: {
    headline: { type: "string", description: "The period in one line, under 16 words." },
    summary: { type: "string", description: "Three to five sentences with the main figures." },
    edge: { type: "array", items: { type: "string" }, description: "Up to four things that work, each with figures." },
    leaks: { type: "array", items: { type: "string" }, description: "Up to five places money is lost, each with figures." },
    rules: { type: "array", items: { type: "string" }, description: "Zero to four one-sentence process rules backed by figures." },
    focus: { type: "string", description: "The one thing to work on next, in one or two sentences." },
    caveat: { type: "string", description: "What this review cannot know, in one sentence." },
  },
};

class Review {
  constructor(ai) {
    this.ai = ai;
    this._busy = null;
  }

  _all() {
    const a = this.ai.docs.read(NAME, []);
    return Array.isArray(a) ? a : [];
  }

  list() {
    return { configured: this.ai.configured(), reviews: this._all().slice(0, 10) };
  }

  /** @param stats  journal stats; trips  closed round trips (plain data) */
  async build({ stats, trips, range }) {
    if (this._busy) return this._busy;
    const client = this.ai._client();
    this._busy = (async () => {
      const slim = (g) => (g || []).map((x) => ({ key: x.key, trades: x.trades, winRatePct: x.winRate, net: x.net, avg: x.avg }));
      const day = (ms) => new Date(ms + IST).toISOString().slice(0, 16).replace("T", " ");
      const sample = trips.slice(-150).map((t) => ({
        symbol: t.symbol,
        side: t.side,
        kind: t.intraday ? "intraday" : "delivery",
        entry: day(t.entryAt),
        holdMin: t.holdMin,
        qty: t.maxQty,
        entryAvg: t.entryAvg,
        exitAvg: t.exitAvg,
        net: t.net,
        setup: t.tags ? t.tags.setup || null : null,
        mistakes: t.tags ? t.tags.mistakes : [],
        mae: t.exc && !t.exc.none ? t.exc.mae : null,
        mfe: t.exc && !t.exc.none ? t.exc.mfe : null,
        capturedPct: t.exc && !t.exc.none ? t.exc.captured : null,
      }));
      const facts = {
        range,
        totals: { trades: stats.trades, winRatePct: stats.winRate, gross: stats.gross, charges: stats.charges, net: stats.net, avgWin: stats.avgWin, avgLoss: stats.avgLoss, payoff: stats.payoff, profitFactor: stats.profitFactor, expectancyPerTrade: stats.expectancy, largestWin: stats.largestWin, largestLoss: stats.largestLoss, maxDrawdown: stats.maxDrawdown, bestStreak: stats.bestStreak, worstStreak: stats.worstStreak, avgHoldMin: stats.avgHoldMin, tradingDays: stats.tradingDays, greenDays: stats.greenDays },
        by: Object.fromEntries(Object.entries(stats.by).map(([k, v]) => [k, slim(v)])),
        sampleTrips: sample,
        chargesNote: "charges are an estimate from published equity rates",
      };
      const answer = await client.ask({ system: REVIEW_SYSTEM, user: `Trading-skills file (the trader's current rules):\n\n${this.ai.playbook.read()}\n\n---\n\nJournal:\n\n${JSON.stringify(facts)}\n\n---\n\nWrite the review.`, schema: REVIEW_SCHEMA, effort: "medium", maxTokens: 10000 });
      const d = answer.data;
      const out = {
        id: crypto.randomBytes(6).toString("hex"),
        at: new Date(this.ai.now()).toISOString(),
        model: answer.model,
        range,
        trades: stats.trades,
        net: stats.net,
        headline: str(d.headline, 200),
        summary: str(d.summary, 1500),
        edge: list(d.edge, 4, 400),
        leaks: list(d.leaks, 5, 400),
        rules: list(d.rules, 4, 300).map((text) => ({ text, added: false })),
        focus: str(d.focus, 500),
        caveat: str(d.caveat, 300),
        usage: answer.usage,
      };
      this.ai.docs.write(NAME, [out, ...this._all()].slice(0, KEEP));
      this.ai.log.log(`[ai] journal review (${range}, ${stats.trades} trades) by ${answer.model}: ${answer.usage.inputTokens} in / ${answer.usage.outputTokens} out tokens`);
      return out;
    })();
    try {
      return await this._busy;
    } finally {
      this._busy = null;
    }
  }

  /** The trader accepts one suggested rule: it goes into the trading-skills file, once. */
  addRule(id, index) {
    const all = this._all();
    const r = all.find((x) => x.id === id);
    if (!r) throw new AiError("That review is no longer stored.", "not_found", 404);
    const rule = Number.isInteger(index) ? r.rules[index] : null;
    if (!rule) throw new AiError("There is no such rule in that review.", "invalid", 400);
    if (!rule.added) {
      this.ai.playbook.appendLessons([rule.text], r.at.slice(0, 10));
      rule.added = true;
      this.ai.docs.write(NAME, all);
    }
    return { review: r, lessons: this.ai.playbook.lessons().length };
  }
}

module.exports = { Review, REVIEW_SYSTEM, REVIEW_SCHEMA };
