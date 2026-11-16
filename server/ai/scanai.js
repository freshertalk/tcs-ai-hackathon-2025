"use strict";
// The AI's look at the live scanner (Research): the desk's eligible intraday candidates from the NIFTY 100,
// ordered and annotated by the AI Engine's model.
//
// The desk reads every NIFTY 100 stock from Zerodha's live stream (market/scan.js): VWAP, EMA 9/21,
// Supertrend, MACD, RSI, ADX, ATR, Bollinger, the opening range, yesterday's levels and the pivots, volume
// against the usual, strength against the NIFTY and the order book — a score, a next-move lean, the rules
// that make a stock eligible for an intraday trade now, and a plan. The model is handed the eligible
// candidates and a few near misses, the market's lean (the NIFTY and the breadth of the hundred) and the
// scanner's own measured record (today's calls to target or stop, how often its leans were right).
//
// The model may only order the candidates, keep or drop each one with a reason, and write a thesis and a
// risk. It cannot add a stock, make an ineligible stock eligible, flip a side or change a level: the service
// (server/scanner.js) ignores any name that is not a candidate, keeps the desk's eligibility, and the
// desk's order fills whatever the model leaves out. Text only: no timers here, and nothing can place an order.

const { askDefault, team } = require("./mixture");

const SYSTEM = `You are the senior intraday trader reviewing a live scanner on a private NSE (India) desk. The desk reads every NIFTY 100 stock from the broker's live stream, every two seconds, on 5-minute bars: VWAP and the distance from it in ATRs, EMA 9 against EMA 21, Supertrend (10, 3), the MACD histogram, RSI (14), ADX (14) with +DI/−DI, ATR, Bollinger %B and the squeeze, the opening range (9:15–9:30) and its break, yesterday's high, low and close, the floor pivots and the CPR, volume against the usual at this time of day, strength against the NIFTY, and the order book's bids against offers. Each reading votes up or down with a weight: the score (−100…+100), the agreement (the share of the evidence that agrees), a lean for the next 15–30 minutes, and rules that make a stock ELIGIBLE for an intraday trade now (the entry window 9:30–14:45, a clear score with most evidence agreeing, the right side of VWAP, a trend or an opening-range break, live volume, liquidity, not stretched, room to the next level, a counter-trend trade only on stronger evidence). Each eligible stock has a plan: entry at the price, a stop behind the nearest structure, targets at 1.5R and 2.5R.

You are given the time, the market's lean (the NIFTY's own reading and the breadth of the hundred), the scanner's measured record (today's calls followed to target, stop or 30 minutes; how often its leans were right 15 minutes on, by strength; the last sessions added up), and the candidates — eligible ones and a few near misses — each with its score, agreement, lean, plan, reasons with numbers, what argues against it, the rules it fails (near misses) and its data.

How to answer:
- Use only the candidates and the numbers given. Never add a stock, never change a side, never invent a level, an event or a statistic.
- "picks": every candidate you have a view on, best first. "keep": true for an eligible candidate you would take now; false for one you would skip, with the reason in the data. For a near miss, "keep": true means it is worth watching for the rule it fails to clear — it stays ineligible.
- Skip an eligible candidate only for a reason in the data: its reasons rest on one family of evidence (for example only momentum), it is stretched from VWAP, the level against it is close, it fights a clear market lean on modest evidence, its volume is thin, or the scanner's record shows that kind of call has not paid today.
- Prefer candidates where independent evidence agrees — trend (EMA, Supertrend, ADX), location (VWAP, the opening range, yesterday's levels), participation (volume, the order book) and strength against the NIFTY — over a single strong reading. Spread across sectors where you can tell.
- "thesis": one plain sentence with the numbers that make the trade. "risk": one plain sentence on what would make it wrong, with the stop or a level. "confidence": low, medium or high — how well the evidence agrees.
- "summary": two sentences at most on the list as a whole. "marketView": one sentence on the next 30 minutes for the market from the data.
- Never promise a profit or a win rate; quote the scanner's record only as given. This is research, not advice; the trader decides.`;

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

class ScanReviewer {
  constructor(ai) {
    this.ai = ai;
  }

  ready() {
    return team(this.ai).models.length > 0;
  }

  /**
   * @param input { timeIST, market, record, history, candidates: [...] }
   * @returns { picks: [{ symbol, keep, thesis, risk, confidence }], summary, marketView, by, cached } or null
   */
  async review(input, { fresh = false } = {}) {
    const r = await askDefault(this.ai, { system: SYSTEM, user: `The live scanner's candidates and the market:\n${JSON.stringify(input)}\n\nYour view?`, schema: SCHEMA, maxTokens: 4000, effort: "low", timeoutSec: 75, fresh, subject: { none: true } });
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

require("./brains").register("scanner", SYSTEM, "Live scanner review (Research)");

module.exports = { ScanReviewer, SYSTEM, SCHEMA };
