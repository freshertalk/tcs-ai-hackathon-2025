"use strict";
// The position coach: the model reads your open positions and holdings — quantity, average
// price, live price, P&L, product, available funds — next to the desk's own reading of
// each stock (the live call, its levels, the 1-minute tape, early warnings), and says what
// it would do with each one: hold, trim, exit, tighten the stop, or wait.
//
// It advises. It cannot act: this folder has no way to reach the broker, and the account
// figures are handed to it by the trading routes as plain data. Every suggestion is shown
// to the trader, who decides — and places any order by hand, with the trading switch on.
// It runs only when asked; nothing here works by the clock.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { AiError } = require("./client");

const KEEP = 20;
const MAX_POS = 10;
const MAX_HOLD = 10;
const CASH = new Set(["NSE", "BSE"]);
const str = (x, n) => String(x == null ? "" : x).trim().slice(0, n);
const list = (x, max, n) => (Array.isArray(x) ? x : []).map((v) => str(v, n)).filter(Boolean).slice(0, max);
const numOr = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : null);
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);

const COACH_SYSTEM = `You are the position coach on a private trading desk for Indian markets (NSE/BSE cash, and sometimes F&O). One trader reads your notes about the positions and holdings they already have, and decides for themselves. You never place, change or cancel orders, and you never claim that anything has been done.

You are given, for each open position: exchange, symbol, product (MIS = intraday, squared off by the broker around 3:20 PM; CNC = delivery; NRML = F&O carry-forward), quantity (negative = short), average price, last price, P&L, and — for NSE stocks — the desk's rule engine: its live intraday call, the plan's levels, ATR, the 1-minute tape and early warnings. You may also be given holdings with the engine's daily and long-term reading, the available funds, the open orders, the time and the market's direction.

How to work:
- Judge each position on what the data says now, not on its P&L alone. A loss is not a reason to hold, and a profit is not a reason to sell; where the engine's reading has turned against the position, say so plainly.
- Use the engine's levels for any stop or target you mention, and say which level it is. Never invent a price. A stop for a long must be below the last price, for a short above it.
- Mind the clock: an MIS position late in the session, or a position against a falling market, deserves a direct word. Mind concentration: one position that is a large share of the funds deserves a mention.
- For F&O or symbols without engine data, say that the read is limited to the numbers given.
- Prefer "wait" or "hold with a stop at …" over action for its own sake. Never promise or imply a profit or a probability. Short, concrete sentences.`;

const COACH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overview", "positions", "holdings", "risk_note", "caveat"],
  properties: {
    overview: { type: "string", description: "Two to four sentences: the book as a whole, what matters most right now." },
    positions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["symbol", "product", "action", "urgency", "confidence", "reasoning", "stop", "target", "invalidation"],
        properties: {
          symbol: { type: "string" },
          product: { type: "string" },
          action: { type: "string", enum: ["hold", "tighten_stop", "trim", "exit", "add", "wait"] },
          urgency: { type: "string", enum: ["now", "today", "watch"] },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          reasoning: { type: "string", description: "Two or three sentences naming the facts used." },
          stop: { type: "number", description: "A stop price taken from the engine's levels, or 0 when none applies." },
          target: { type: "number", description: "A target taken from the engine's levels, or 0 when none applies." },
          invalidation: { type: "string", description: "What would change this advice." },
        },
      },
    },
    holdings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["symbol", "action", "reasoning"],
        properties: {
          symbol: { type: "string" },
          action: { type: "string", enum: ["hold", "review", "trim", "exit"] },
          reasoning: { type: "string" },
        },
      },
    },
    risk_note: { type: "string", description: "Concentration, funds, the clock — one to three sentences." },
    caveat: { type: "string", description: "What this reading cannot know, in one sentence." },
  },
};

class Coach {
  constructor(ai) {
    this.ai = ai;
    this.file = path.join(ai.dir, "coach.json");
    this._busy = null;
  }

  _all() {
    try {
      const a = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return Array.isArray(a) ? a : [];
    } catch (_) {
      return [];
    }
  }

  list() {
    return { configured: this.ai.configured(), readings: this._all().slice(0, 10) };
  }

  /** The desk's reading of one NSE stock, cut to what the coach needs. */
  async _engine(symbol) {
    try {
      const v = await this.ai.market.verdict(symbol);
      if (!v || !v.available) return { available: false };
      const d = v.day || {};
      return {
        available: true,
        last: v.last,
        atr: v.movement ? v.movement.atr : null,
        swing: { stance: v.stance, score: v.composite },
        longTerm: v.longTerm && v.longTerm.available ? { stance: v.longTerm.stance, checks: `${v.longTerm.met}/${v.longTerm.total}` } : null,
        intraday: d.available ? { call: d.headline, state: d.state, score: d.score, plan: d.plan, triggers: d.triggers, earlyWarnings: (d.early || []).map((e) => e.text), oneMinute: d.fast ? d.fast.summary : null, session: d.session ? d.session.label : null } : { available: false, reason: d.reason || "" },
        // every level, top to bottom (pivots, supports, resistances, day high/low, circuits)
        levels: Array.isArray(v.ladder) ? v.ladder.slice(0, 24).map((x) => ({ label: x.label, price: x.price, awayPct: x.awayPct })) : null,
        circuit: v.circuit || null,
      };
    } catch (err) {
      return { available: false, reason: err.message };
    }
  }

  /**
   * @param account  { positions: {net:[…]}, holdings:[…], funds:{equity}, orders:[…] } — plain data
   *                 from the trading routes
   */
  async read(account, { holdings = true } = {}) {
    if (this._busy) return this._busy;
    const client = this.ai._client(); // no key → a clear error before any work
    this._busy = (async () => {
      const net = ((account.positions && account.positions.net) || []).filter((p) => p.quantity !== 0).slice(0, MAX_POS);
      const held = holdings ? (account.holdings || []).filter((h) => h.quantity + h.t1 > 0).sort((a, b) => b.last * (b.quantity + b.t1) - a.last * (a.quantity + a.t1)).slice(0, MAX_HOLD) : [];
      if (!net.length && !held.length) throw new AiError("There are no open positions or holdings to read.", "no_data", 409);
      const positions = [];
      for (const p of net) {
        positions.push({
          exchange: p.exchange,
          symbol: p.symbol,
          product: p.product,
          quantity: p.quantity,
          average: p.average,
          last: p.last,
          pnl: r2(p.pnl),
          pnlPct: p.average ? r2(((p.last - p.average) / p.average) * 100 * Math.sign(p.quantity)) : null,
          value: r2(Math.abs(p.quantity) * p.last * (p.multiplier || 1)),
          engine: CASH.has(p.exchange) ? await this._engine(p.symbol) : { available: false, reason: "no engine data for F&O or commodities" },
        });
      }
      const holdingRows = [];
      for (const h of held) {
        const e = CASH.has(h.exchange) ? await this._engine(h.symbol) : { available: false };
        holdingRows.push({ symbol: h.symbol, quantity: h.quantity + h.t1, average: h.average, last: h.last, pnl: r2(h.pnl), dayChangePct: r2(h.dayChangePct), engine: e.available ? { swing: e.swing, longTerm: e.longTerm, last: e.last } : { available: false } });
      }
      let market = null;
      try {
        const c = await this.ai.market.context();
        if (c && c.available) market = { tide: c.tide, nifty: c.nifty, vix: c.vix };
      } catch (_) {
        market = null;
      }
      const eq = account.funds && account.funds.equity;
      const facts = {
        now: new Date(this.ai.now()).toISOString(),
        market,
        funds: eq ? { availableCash: eq.available.cash, net: eq.net, usedExposure: eq.used.exposure, usedSpan: eq.used.span } : null,
        openOrders: (account.orders || []).filter((o) => ["OPEN", "TRIGGER PENDING"].includes(o.status)).map((o) => ({ symbol: o.symbol, side: o.side, type: o.type, quantity: o.pending, price: o.price, trigger: o.trigger, product: o.product })).slice(0, 20),
        positions,
        holdings: holdingRows,
        world: this.ai.worldSummary() || null,
      };
      const answer = await client.ask({ system: COACH_SYSTEM, user: `Trading-skills file:\n\n${this.ai.playbook.read()}\n\n---\n\nThe book now:\n\n${JSON.stringify(facts)}\n\n---\n\nRead every open position, then the holdings.`, schema: COACH_SCHEMA, effort: "medium", maxTokens: 12000 });
      const d = answer.data;
      const bySym = new Map(positions.map((p) => [`${p.symbol}|${p.product}`, p]));
      const rows = (Array.isArray(d.positions) ? d.positions : []).slice(0, MAX_POS).map((x) => {
        const p = bySym.get(`${str(x.symbol, 40)}|${str(x.product, 8)}`) || positions.find((q) => q.symbol === str(x.symbol, 40));
        const notes = [];
        let stop = numOr(x.stop);
        const target = numOr(x.target);
        // a stop on the wrong side of the price is not a stop: show it, flagged, rather than hide it
        if (p && stop) {
          if ((p.quantity > 0 && stop >= p.last) || (p.quantity < 0 && stop <= p.last)) {
            notes.push(`The suggested stop ${stop} is on the wrong side of the last price ${p.last}; ignore it.`);
            stop = null;
          }
        }
        return { symbol: str(x.symbol, 40), product: str(x.product, 8), action: str(x.action, 16), urgency: str(x.urgency, 8), confidence: str(x.confidence, 8), reasoning: str(x.reasoning, 900), stop, target, invalidation: str(x.invalidation, 400), last: p ? p.last : null, quantity: p ? p.quantity : null, pnl: p ? p.pnl : null, notes };
      });
      const out = {
        id: crypto.randomBytes(6).toString("hex"),
        at: new Date(this.ai.now()).toISOString(),
        model: answer.model,
        overview: str(d.overview, 1500),
        positions: rows,
        holdings: (Array.isArray(d.holdings) ? d.holdings : []).slice(0, MAX_HOLD).map((h) => ({ symbol: str(h.symbol, 40), action: str(h.action, 10), reasoning: str(h.reasoning, 700) })),
        risk: str(d.risk_note, 800),
        caveat: str(d.caveat, 400),
        counts: { positions: positions.length, holdings: holdingRows.length },
        usage: answer.usage,
      };
      const all = [out, ...this._all()].slice(0, KEEP);
      fs.mkdirSync(this.ai.dir, { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(all, null, 2));
      this.ai.log.log(`[ai] position coach by ${answer.model}: ${positions.length} positions, ${holdingRows.length} holdings — ${answer.usage.inputTokens} in / ${answer.usage.outputTokens} out tokens`);
      return out;
    })();
    try {
      return await this._busy;
    } finally {
      this._busy = null;
    }
  }
}

module.exports = { Coach, COACH_SYSTEM, COACH_SCHEMA };
