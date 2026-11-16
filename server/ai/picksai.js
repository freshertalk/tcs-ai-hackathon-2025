"use strict";
// The AI's review of the Top 10: the desk's candidates ordered and annotated by the AI Engine's model.
//
// The desk ranks the stocks with arithmetic (market/picks.js) and hands the model its fifteen best
// candidates, each with its side, its score, its reasons with their numbers, the plan's levels and the
// data points behind them, together with the market (the NSE forecast from the world, the tide, the
// NIFTY, the news mood) and — once the lists have been scored — the desk's own record: how its picks
// moved and which reasons paid.
//
// The model may only order the candidates, keep or drop each one with a reason, and write a thesis and
// a risk for each kept one. It cannot add a stock, flip a side or change a level: the service
// (server/picks.js) ignores any name that is not a candidate, and the desk's order fills whatever the
// model leaves out. Text only: no timers here, and nothing can place an order.

const { askDefault, team } = require("./mixture");

const SYSTEM = `You are the research desk's reviewer on a private NSE (India) intraday trading desk. The desk has ranked its candidates for the session — stocks to trade long or short intraday (MIS: in and out the same session) — with arithmetic on each stock's daily history, its live quote and the desk's own engines (the live call, the measured odds of the day's set-ups, the intraday plan and its record, the Live Pulse), weighed with the NSE forecast from the world (GIFT Nifty, the US, Asia), the market's tide, sectors and the news. Your job is the senior trader's last look before the list goes out.

You are given the phase (pre: before the open, for today; live: during the session; post: after the close, for the next session), the market, the desk's record when there is one (how its picks moved from the open to the close in their direction, and which reasons paid), and the candidates — each with the desk's rank, side, score, reasons with numbers, what argues against it, the plan's entry, stop and target when there is one, and its data points.

How to answer:
- Use only the candidates and the numbers given. Never add a stock, never change a side, never invent a level, an event or a statistic.
- "picks": the candidates you would put on the list, best first, with "keep": true — normally ten; and any candidate you would leave off with "keep": false. A candidate you do not mention keeps the desk's place.
- Drop a candidate only for a reason in the data: its reasons conflict (for example a long against a falling sector and a world that leans down), it is stretched, its plan's record is poor, it is too close to a level that has turned it, or the side runs against the market's clear direction without a strong stock-specific reason.
- Prefer candidates where several independent reasons agree (trend, relative strength, a set-up with volume, measured odds, the plan) over one strong reason. Spread the list across sectors. When the market's direction is clear, the list may lean that way, but keep the strongest counter-trend names if their evidence is strong.
- If the desk's record shows which reasons paid and which did not, lean on that.
- "thesis": one plain sentence with the numbers that make the trade. "risk": one plain sentence on what would make it wrong, with a level where there is one. "confidence": low, medium or high — how well the evidence agrees.
- "summary": two sentences at most on the list as a whole. "marketView": one sentence on the session's likely character from the market data.
- Never promise a profit or a win rate. This is research, not advice; the trader decides.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["picks", "summary", "marketView"],
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["symbol", "keep", "thesis", "risk", "confidence"],
        properties: { symbol: { type: "string" }, keep: { type: "boolean" }, thesis: { type: "string" }, risk: { type: "string" }, confidence: { type: "string", enum: ["low", "medium", "high"] } },
      },
    },
    summary: { type: "string" },
    marketView: { type: "string" },
  },
};

const str = (x, n) => String(x == null ? "" : x).replace(/\s+/g, " ").trim().slice(0, n);

class PicksReviewer {
  constructor(ai) {
    this.ai = ai;
  }

  ready() {
    return team(this.ai).models.length > 0;
  }

  /**
   * @param input { phase, session, timeIST, market, deskRecord, candidates: [...] }
   * @returns { picks: [{ symbol, keep, thesis, risk, confidence }], summary, marketView, by, cached } or null
   */
  async review(input, { fresh = false } = {}) {
    const r = await askDefault(this.ai, { system: SYSTEM, user: `The desk's candidates and the market:\n${JSON.stringify(input)}\n\nYour list?`, schema: SCHEMA, maxTokens: 5000, effort: "low", timeoutSec: 90, fresh, subject: { none: true } });
    if (!r.data) return null;
    const d = r.data;
    return {
      picks: (Array.isArray(d.picks) ? d.picks : []).slice(0, 20).map((p) => ({ symbol: str(p && p.symbol, 24).toUpperCase(), keep: Boolean(p && p.keep), thesis: str(p && p.thesis, 300), risk: str(p && p.risk, 240), confidence: ["low", "medium", "high"].includes(p && p.confidence) ? p.confidence : "low" })),
      summary: str(d.summary, 400),
      marketView: str(d.marketView, 240),
      by: r.by[0] || "AI",
      cached: (r.tried || []).some((t) => t.ok && t.cached),
    };
  }
}

require("./brains").register("picks", SYSTEM, "Top 10 review (Research)");

module.exports = { PicksReviewer, SYSTEM, SCHEMA };
