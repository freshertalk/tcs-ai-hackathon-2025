"use strict";
// The day review: the model reads ONE trading day's report — the figures, the trades, the margin, the
// practices the arithmetic found — and says in plain words why the day made or lost money, what went
// right, what went wrong, and what to do about it.
//
// It reads figures handed to it by Trade Analysis; it has no way to reach the broker, and it writes
// nothing but the review. It runs when Trade Analysis asks (after the close, or on a press of a
// button); nothing here works by the clock.

const { AiError } = require("./client");

const str = (x, n) => String(x == null ? "" : x).replace(/\s+/g, " ").trim().slice(0, n);
const list = (x, max, n) => (Array.isArray(x) ? x : []).map((v) => str(v, n)).filter(Boolean).slice(0, max);

const SYSTEM = `You review ONE trader's single trading day (Indian markets, mostly NSE equities, intraday). The trader reads it after the close to learn from it.

You are given the day's report: profit (round trips that closed above zero), loss (below zero), charges and taxes (brokerage, STT, exchange fees, SEBI fee, GST, stamp duty — an estimate), net, the number of trades, win rate, the margin left, each trade (entry and exit time, size, prices, profit or loss, charges, time held), the day by hour of entry and by stock, the Nifty's move when known, and the good and bad practices the desk's arithmetic found, each with its figures.

How to work:
- Use only the figures given and quote them. Never invent a trade, a price, a news event or a reason the market moved: the report cannot see news, order flow or the chart, and you must say so where it matters.
- Explain WHY the day ended where it did: how the profit, the loss and the charges combine; whether the win rate or the size of wins and losses decided it; which stocks, hours and sides carried or sank it; what the bad practices cost, in rupees.
- Be fair: a loss with sound process can happen, and a profit with bad process is luck that will not last. Say which this was.
- Advice must be process rules the trader can act on tomorrow, each one sentence, each backed by a figure from the report ("Stop after two losses: the 3 trades after 12:10 lost ₹2,400"). Prefer fewer, sharper rules to many.
- Never promise or imply a future profit, a win rate or a probability. Short, concrete sentences. No filler.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "why_today", "what_worked", "what_hurt", "advice", "tomorrow", "caveat"],
  properties: {
    headline: { type: "string", description: "The day in one line, under 18 words, with the net figure." },
    why_today: { type: "string", description: "Four to six sentences: why the day made or lost money, with the main figures." },
    what_worked: { type: "array", items: { type: "string" }, description: "Up to four good practices or results, each with its figures." },
    what_hurt: { type: "array", items: { type: "string" }, description: "Up to four mistakes or leaks, each with the rupees it cost." },
    advice: { type: "array", items: { type: "string" }, description: "Up to four one-sentence process rules for tomorrow, each backed by a figure." },
    tomorrow: { type: "array", items: { type: "string" }, description: "Up to three short checks to run before the first trade tomorrow." },
    caveat: { type: "string", description: "One sentence on what this review cannot see." },
  },
};

class DayReview {
  constructor(ai) {
    this.ai = ai;
  }

  /** @param day  a Trade Analysis day report (analysis/day.js) */
  async write(day) {
    const client = this.ai._client(); // no key → a clear error before anything is sent
    const facts = {
      date: day.date,
      weekday: day.weekday,
      summary: day.summary,
      margin: day.margin,
      niftyMove: day.market,
      trades: (day.trades || []).slice(0, 60),
      byHourOfEntry: day.hours,
      byStock: (day.symbols || []).slice(0, 12),
      practicesFound: { good: (day.practices ? day.practices.good : []).map((p) => ({ title: p.title, detail: p.detail })), bad: (day.practices ? day.practices.bad : []).map((p) => ({ title: p.title, detail: p.detail, rupeesAtStake: p.impact })) },
      processScore: day.score,
      desksOwnReading: day.why,
      handEnteredFigures: Boolean(day.edited),
    };
    const answer = await client.ask({ system: SYSTEM, user: `The trading-skills file the trader works by (for context only):\n\n${this.ai.playbook.read().slice(0, 6000)}\n\n---\n\nThe day:\n\n${JSON.stringify(facts)}\n\n---\n\nWrite the review of this day.`, schema: SCHEMA, effort: "medium", maxTokens: 6000 });
    const d = answer.data;
    if (!d || typeof d !== "object") throw new AiError("The model's answer was not in the expected format.", "bad_output", 502);
    return {
      at: new Date(this.ai.now()).toISOString(),
      model: answer.model,
      provider: this.ai._provider(),
      headline: str(d.headline, 240),
      why: str(d.why_today, 2000),
      worked: list(d.what_worked, 4, 400),
      hurt: list(d.what_hurt, 4, 400),
      advice: list(d.advice, 4, 400),
      tomorrow: list(d.tomorrow, 3, 300),
      caveat: str(d.caveat, 300),
      usage: answer.usage,
    };
  }
}

// the owner's AI brains reach these instructions automatically (server/ai/brains.js)
require("./brains").register("dayreview", SYSTEM, "Trade Analysis day review");

module.exports = { DayReview, SCHEMA, SYSTEM };
