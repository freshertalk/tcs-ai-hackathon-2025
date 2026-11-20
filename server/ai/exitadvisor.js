"use strict";
// The exit advisor: the AI Engine's second opinion on one open intraday position.
//
// The desk's own exit coach (server/trading/exitcoach.js) reads every tick with arithmetic and is
// always there. This is the model's reading of the same moment, asked for sparingly by the flight
// deck (server/flight.js): when the coach's signal steps up, or when the trader presses "Ask the AI"
// on the Live board — one opinion per position every few minutes, within a daily limit.
//
// It is given the position, the coach's reading with its reasons, the last twenty 1-minute bars, the
// order book in numbers, the nearest levels, the Live Pulse, the market's tide, the NSE forecast from
// the world and the news about the stock — and answers hold / tighten / book part / exit now with a
// price, a stop, and one or two sentences. Text only: no timers here, and nothing can place an order.
//
// It also researches the exit LEVELS of a position (`research`): it is shown the desk's level map —
// every level a real price worked out by the desk, each with an id (server/trading/exitlevels.js) —
// with the tape, the book, the forecasts and its own record on this desk, and chooses by id up to
// two levels to take profit at, the level whose break proves the trade wrong, and where a turn is
// most likely. It never supplies a number of its own: the flight deck checks every choice against
// the map before anything is shown, and scores each set after the close.

const { askDefault, team } = require("./mixture");

const SYSTEM = `You are the exit advisor on a private NSE (India) intraday trading desk. One trader holds ONE open intraday (MIS) position; you are asked, at this moment, whether to keep it. The trader decides and acts; you never place orders. Intraday positions are squared off by Zerodha at 3:12 PM in a stock that has a closing auction — every stock with futures and options, which stops trading at 3:15 PM — and at 3:25 PM in any other stock (the snapshot's minutes to the square-off already count to the right one).

You are given a snapshot: the position (side, quantity, average, last price, P&L, the best and worst it has been, how much of the best gain was given back, minutes in the trade and to the square-off), the desk's own exit coach (its signal, exit pressure 0–100, exit price, stop, target and its reasons for and against), the tape (VWAP, 1-minute RSI, the last three minutes, the last twenty 1-minute bars), the order book in numbers (who is pressing, the last minute's trades, a wall of orders, the 30-second lean), the nearest levels, the desk's pulse for the next 15–30 minutes, its live call, the market's tide, the NSE forecast from the world, and the news about this stock.

How to answer:
- Use only the snapshot. Quote its numbers. Never invent a price, a level or an event.
- "action": "hold", "tighten" (keep it, move the stop closer), "book-part" (sell part now, trail the rest) or "exit-now".
- This trader's known weakness is staying in for more and giving the gain back: when the gain is being given back and the tape or the book has turned, say so plainly. A small sure profit beats a round trip to a loss. Never suggest removing or widening a stop, and never suggest averaging a losing intraday position.
- "exit_price": the price to exit at now (the bid for a long, the offer for a short), or the level you would take profit at if you say hold. "stop": where the stop belongs now — never further from the price than the coach's stop.
- You may disagree with the coach when the snapshot supports it; say what it is missing.
- "reason": one or two plain sentences with the actual numbers. "watch": the one thing that would change your mind, with its price.
- "confidence": low, medium or high — how well the evidence agrees. Never promise a profit or a certainty.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action", "exit_price", "stop", "confidence", "reason", "watch"],
  properties: {
    action: { type: "string", enum: ["hold", "tighten", "book-part", "exit-now"] },
    exit_price: { type: "number" },
    stop: { type: "number" },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    reason: { type: "string" },
    watch: { type: "string" },
  },
};

const LEVELS_SYSTEM = `You are the level researcher on a private NSE (India) intraday trading desk. One trader holds ONE open intraday (MIS) position. Your job: research where this trade should be EXITED — the levels to take profit at, and the level whose break proves the trade wrong. The trader decides and acts; you never place orders. Intraday positions are squared off by Zerodha at 3:12 PM in a stock that has a closing auction — every stock with futures and options, which stops trading at 3:15 PM — and at 3:25 PM in any other stock (the snapshot's minutes to the square-off already count to the right one).

You are given a snapshot: the position; "levelMap" — every price level the desk has worked out from its own data (today's high, low and open, the opening range, VWAP, the previous day's high, low and close and the pivots from them, 5- and 20-day highs and lows, today's swing highs and lows, the busiest price of the day, round numbers, a wall of orders in the book, the edges of the desk's pulse window, the desk's ladder, the entry, the best price since it). Each level has an "id" (A1, A2 … above the last price, nearest first; B1, B2 … below it, nearest first), its price, what it is, "strength" (how many kinds of evidence sit there), "touches" (how many times today's bars turned there), "touchOddsPct" (the no-trend odds that the price touches it before the square-off, from today's one-minute moves) and, where the desk has measured it, "heldPct" with "heldOfTests" (how often levels of that kind held when tested — prefer a level with a good record over one without). "otherAiFindings", when shown, is what the desk's other AI features already found on this stock: build on it, and discount a finding marked moved. You also get the session in 5-minute bars, the last twenty 1-minute bars, the previous days' bars, the order book in numbers, the desk's exit coach (its signal, stop and target), the pulse for the next 15–30 minutes, the desk's live call, the market's tide, the NSE forecast from the world (GIFT Nifty, overseas markets), the news about this stock, the minutes left, and — when there is one — your own record on this desk (how often your first target came before your stop).

How to answer:
- Choose levels ONLY from levelMap, by "anchor" id, and copy that level's price exactly. Never invent a price, never adjust one, never name a level that is not on the map. If no level on the map qualifies as a target, return an empty "targets" list and say why in "summary" — that is a correct answer.
- "targets": at most two, nearest first, both AHEAD of the last price in the trade's direction (ids starting with A for a long, B for a short). Target 1 is the nearest level where the evidence says the price is likely to pause or turn — strength, touches, a wall of orders, the edge of the pulse window — and that is realistically reachable in the time left (use touchOddsPct; do not pick a level with single-digit odds). Give a second target only when the tape, the book and the wider market support the move continuing past the first.
- "stop": the level whose break proves the trade wrong, on the LOSING side of the last price (ids starting with B for a long, A for a short). It must not be further from the price than the coach's stop; if every candidate is further, answer the anchor "coach" (with the coach's stop as the price) and say so. Never suggest removing or widening a stop, and never suggest averaging a losing intraday position.
- "reversal": the level (by id) where a reversal against the position is most likely BEFORE the first target, and in "sign" the one order-book or volume reading — with its number from the snapshot — that would confirm it is happening.
- "outlook": "with" when GIFT Nifty / the world's forecast, the tide and the news support holding for the further target, "against" when they oppose it, "mixed" otherwise.
- Each "why": one plain sentence that quotes the actual numbers from the snapshot. "summary": two sentences at most — the plan in words. "confidence": low, medium or high — how well the evidence agrees. If your record on this desk shows your targets are often not reached, choose nearer ones.
- This trader's known weakness is staying in for more and giving the gain back: prefer a level that is likely to be reached over one that would pay more. Never promise a profit or a certainty.`;

const pick = { type: "object", additionalProperties: false, required: ["anchor", "price", "why"], properties: { anchor: { type: "string" }, price: { type: "number" }, why: { type: "string" } } };
const LEVELS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["targets", "stop", "reversal", "outlook", "confidence", "summary"],
  properties: {
    targets: { type: "array", items: pick },
    stop: pick,
    reversal: { type: "object", additionalProperties: false, required: ["anchor", "sign"], properties: { anchor: { type: "string" }, sign: { type: "string" } } },
    outlook: { type: "string", enum: ["with", "against", "mixed"] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    summary: { type: "string" },
  },
};

const str = (x, n) => String(x == null ? "" : x).trim().slice(0, n);
const price = (x) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? Math.round(x * 100) / 100 : null);

const subjectOf = (snapshot) => (snapshot && snapshot.position ? { symbol: snapshot.position.symbol, last: snapshot.position.last } : null);

class ExitAdvisor {
  constructor(ai) {
    this.ai = ai;
  }

  ready() {
    return team(this.ai).models.length > 0;
  }

  /**
   * @param snapshot what the flight deck gathered for one position
   * @returns { action, exitPrice, stop, confidence, reason, watch, by, cached } or null when no model answered
   */
  async advise(snapshot, { fresh = false } = {}) {
    const r = await askDefault(this.ai, { system: SYSTEM, user: `The position now:\n${JSON.stringify(snapshot)}\n\nKeep it, or leave?`, schema: SCHEMA, maxTokens: 3000, effort: "low", timeoutSec: 45, fresh, subject: subjectOf(snapshot) });
    if (!r.data) return null;
    const d = r.data;
    return {
      action: ["hold", "tighten", "book-part", "exit-now"].includes(d.action) ? d.action : "hold",
      exitPrice: price(d.exit_price),
      stop: price(d.stop),
      confidence: ["low", "medium", "high"].includes(d.confidence) ? d.confidence : "low",
      reason: str(d.reason, 400),
      watch: str(d.watch, 240),
      by: r.by[0] || "AI",
      cached: (r.tried || []).some((t) => t.ok && t.cached),
    };
  }

  /**
   * The exit levels of one position, chosen by id from the desk's level map. The answer is raw:
   * the flight deck checks it (trading/exitlevels.js `verify`) before anything is shown.
   * @param snapshot what the flight deck gathered, with `levelMap`
   * @returns { targets: [{ anchor, price, why }], stop: { anchor, price, why }, reversal: { anchor, sign },
   *            outlook, confidence, summary, by, cached } or null when no model answered
   */
  async research(snapshot, { fresh = false } = {}) {
    const r = await askDefault(this.ai, { system: LEVELS_SYSTEM, user: `The position and the desk's level map now:\n${JSON.stringify(snapshot)}\n\nWhere should this trade be exited?`, schema: LEVELS_SCHEMA, maxTokens: 4000, effort: "medium", timeoutSec: 60, fresh, subject: subjectOf(snapshot) });
    if (!r.data) return null;
    const d = r.data;
    const one = (x) => (x && typeof x === "object" ? { anchor: str(x.anchor, 8), price: price(x.price), why: str(x.why, 240) } : null);
    return {
      targets: (Array.isArray(d.targets) ? d.targets : []).map(one).filter(Boolean).slice(0, 4),
      stop: one(d.stop),
      reversal: d.reversal && typeof d.reversal === "object" ? { anchor: str(d.reversal.anchor, 8), sign: str(d.reversal.sign, 240) } : null,
      outlook: ["with", "against", "mixed"].includes(d.outlook) ? d.outlook : "mixed",
      confidence: ["low", "medium", "high"].includes(d.confidence) ? d.confidence : "low",
      summary: str(d.summary, 400),
      by: r.by[0] || "AI",
      cached: (r.tried || []).some((t) => t.ok && t.cached),
    };
  }
}

require("./brains").register("exit", SYSTEM, "Exit advisor (Execution Lab)");
require("./brains").register("exit-levels", LEVELS_SYSTEM, "Exit levels research (Execution Lab)");

module.exports = { ExitAdvisor, SYSTEM, SCHEMA, LEVELS_SYSTEM, LEVELS_SCHEMA };
