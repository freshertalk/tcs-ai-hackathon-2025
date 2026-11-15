"use strict";
// The AI's projection for NIFTY 50 or SENSEX: where the index may close this month or this year.
//
// The desk works out the history and its own projection with arithmetic (market/indices.js). The AI
// Engine's default model is shown that work — the calendar month's record year by year, the trend
// regime, the recent months, the volatility, the fall from the high, the desk's projection with its
// bands and its measured record, the NSE forecast from the world and the news mood — and gives its
// own projection: a lean, a close, a range, the chance of an up period, its reasons and its risks.
//
// The answer is raw here. The index-history service (server/index-history.js) checks it against the
// index's own volatility before it is kept (a close or range outside what the index can plausibly
// do in the time left is refused, with the reason), stores it frozen with its time and its base,
// and scores it when the period ends — so the AI's projections are backtested, not trusted.
// Text only: no timers here, and nothing can place an order.

const { askDefault, team } = require("./mixture");

const SYSTEM = `You are the index strategist of a private NSE (India) trading desk. You are asked where one Indian equity index (NIFTY 50 or SENSEX) will CLOSE at the end of one period — this calendar month, or this calendar year. Your projection is stored with its time and scored against the actual close when the period ends; your record on this desk is measured, so precision matters more than boldness.

You are given a snapshot the desk computed from the index's own daily history: the level now and at the start of the period, the move so far, the calendar month's record year by year (how often it rose, its average and median, its best and worst years, the last ten years), the trend regime (above or below the 10-month average) and how months or years in that regime did, the last twelve months, the yearly record, the volatility and what one standard move is for the time left, the fall from the all-time high, the average path of a year against this year, the desk's own projection (expected close, 68% and 90% bands, the chance of an up period, its reasons) with its walk-forward record (how often its lean was right against the plain "it rises" base rate, and how often the close fell inside its bands), and — when available — the NSE forecast from the world (GIFT Nifty, overseas markets) and the news mood.

How to answer:
- Use only the snapshot. Quote its numbers. Never invent an event, a level or a statistic.
- "close": the level you expect at the end of the period. "low" and "high": the range you expect the CLOSE to fall in with about 70% confidence. Keep the range honest: it cannot be narrower than the index's own volatility allows for the time left (the snapshot gives one standard move); a range much narrower than that is overconfidence.
- "lean": "up" if you expect the period to end above where it BEGAN (startLevel), "down" if below, "sideways" if within a few tenths of a percent.
- "prob_up": your chance, 0–100, that the period ends above its start level.
- Disagree with the desk's projection when the snapshot supports it, and say what it misses. Seasonality from fewer than ten cases is weak evidence; say so when you lean on it.
- "reasons": two to four plain sentences with the actual numbers. "risks": one to three things that would make you wrong, with levels where you can.
- "confidence": low, medium or high — how well the evidence agrees. Never promise a profit or a certainty.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["lean", "close", "low", "high", "prob_up", "reasons", "risks", "confidence"],
  properties: {
    lean: { type: "string", enum: ["up", "down", "sideways"] },
    close: { type: "number" },
    low: { type: "number" },
    high: { type: "number" },
    prob_up: { type: "number" },
    reasons: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
  },
};

const str = (x, n) => String(x == null ? "" : x).replace(/\s+/g, " ").trim().slice(0, n);
const price = (x) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? Math.round(x * 100) / 100 : null);

class IndexForecaster {
  constructor(ai) {
    this.ai = ai;
  }

  ready() {
    return team(this.ai).models.length > 0;
  }

  /**
   * @param snapshot what the index-history service gathered
   * @returns { lean, close, low, high, probUp, reasons, risks, confidence, by, cached } or null when no model answered
   */
  async project(snapshot, { fresh = false } = {}) {
    const r = await askDefault(this.ai, { system: SYSTEM, user: `The snapshot:\n${JSON.stringify(snapshot)}\n\nWhere will ${snapshot.index} close at the end of ${snapshot.period}?`, schema: SCHEMA, maxTokens: 4000, effort: "medium", timeoutSec: 90, fresh });
    if (!r.data) return null;
    const d = r.data;
    const p = Number(d.prob_up);
    return {
      lean: ["up", "down", "sideways"].includes(d.lean) ? d.lean : "sideways",
      close: price(d.close),
      low: price(d.low),
      high: price(d.high),
      probUp: Number.isFinite(p) ? Math.max(0, Math.min(100, Math.round(p))) : null,
      reasons: (Array.isArray(d.reasons) ? d.reasons : []).map((x) => str(x, 300)).filter(Boolean).slice(0, 4),
      risks: (Array.isArray(d.risks) ? d.risks : []).map((x) => str(x, 240)).filter(Boolean).slice(0, 3),
      confidence: ["low", "medium", "high"].includes(d.confidence) ? d.confidence : "low",
      by: r.by[0] || "AI",
      cached: (r.tried || []).some((t) => t.ok && t.cached),
    };
  }
}

require("./brains").register("indices", SYSTEM, "Index projections (NIFTY 50 / SENSEX)");

module.exports = { IndexForecaster, SYSTEM, SCHEMA };
