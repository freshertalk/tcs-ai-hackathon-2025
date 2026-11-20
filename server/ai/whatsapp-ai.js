"use strict";
// The AI part of the WhatsApp updates: the default model (Claude Sonnet 5.5 unless the owner picked
// another on the AI page) reads the open positions' figures and says, per position, hold / tighten /
// trim / exit-watch with a short reason. When it fails, the fallback models are tried; with no model,
// or every model failing, the update goes out with the desk's own figures only. Text only: no timers,
// no broker.

const { askDefault } = require("./mixture");

const SYSTEM = `You read a day trader's OPEN POSITIONS on the NSE (India) for a short WhatsApp update they read on their phone while away from the desk. For each position you get the numbers: side, quantity, average, last price, P&L, volume, the share of buyers vs sellers in the order book, 5-minute RSI, VWAP, the desk's live call, the nearest support and resistance, and the session clock.

For each position choose one action — "hold", "tighten" (move or respect the stop closer), "trim" (reduce size), "exit-watch" (be ready to exit; say the level), or "add-watch" (only for a winner in a strong trend; say the level) — and write one short note with the actual numbers: the level that matters and why. Use only the numbers given. Never promise a profit or a certainty, never tell the trader to remove a stop-loss or average down a loser, and remember intraday (MIS) positions are squared off by Zerodha at 3:12 PM in a stock that has a closing auction — every stock with futures and options, which stops trading at 3:15 PM — and at 3:25 PM in any other stock. "watch" is one line on what to keep an eye on overall.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["positions", "watch"],
  properties: {
    positions: { type: "array", items: { type: "object", additionalProperties: false, required: ["symbol", "action", "note"], properties: { symbol: { type: "string" }, action: { type: "string", enum: ["hold", "tighten", "trim", "exit-watch", "add-watch"] }, note: { type: "string" } } } },
    watch: { type: "string" },
  },
};

/** Ask the default model for each position's action and note. */
async function adviseAll(ai, facts) {
  const r = await askDefault(ai, { system: SYSTEM, user: `Open positions and the market now:\n${JSON.stringify(facts)}\n\nGive the update.`, schema: SCHEMA, maxTokens: 2000, timeoutSec: 60 });
  if (!r.data) return { ok: false, models: r.tried || [] };
  const out = {};
  for (const p of r.data.positions || []) {
    const s = String(p.symbol || "").toUpperCase();
    if (!s || out[s]) continue;
    out[s] = { action: p.action, agree: 1, of: 1, note: String(p.note || "").slice(0, 240) };
  }
  return { ok: true, per: out, watch: String(r.data.watch || "").slice(0, 240), models: r.by };
}

require("./brains").register("whatsapp", SYSTEM, "WhatsApp position updates");

module.exports = { adviseAll, SYSTEM, SCHEMA };
