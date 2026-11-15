"use strict";
// The AI part of the WhatsApp updates: the free NVIDIA-hosted models read the open positions'
// figures together and each says, per position, hold / tighten / trim / exit-watch with a short
// reason. Their actions are VOTED (the majority wins); the note comes from the strongest model that
// agreed with the majority. With no free model, or every model failing, the update goes out with
// the desk's own figures only. Text only: no timers, no broker.

const { askMixture, rankOf } = require("./mixture");

const SYSTEM = `You read a day trader's OPEN POSITIONS on the NSE (India) for a short WhatsApp update they read on their phone while away from the desk. For each position you get the numbers: side, quantity, average, last price, P&L, volume, the share of buyers vs sellers in the order book, 5-minute RSI, VWAP, the desk's live call, the nearest support and resistance, and the session clock.

For each position choose one action — "hold", "tighten" (move or respect the stop closer), "trim" (reduce size), "exit-watch" (be ready to exit; say the level), or "add-watch" (only for a winner in a strong trend; say the level) — and write one short note with the actual numbers: the level that matters and why. Use only the numbers given. Never promise a profit or a certainty, never tell the trader to remove a stop-loss or average down a loser, and remember intraday (MIS) positions are squared off by the broker around 3:15–3:20 PM. "watch" is one line on what to keep an eye on overall.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["positions", "watch"],
  properties: {
    positions: { type: "array", items: { type: "object", additionalProperties: false, required: ["symbol", "action", "note"], properties: { symbol: { type: "string" }, action: { type: "string", enum: ["hold", "tighten", "trim", "exit-watch", "add-watch"] }, note: { type: "string" } } } },
    watch: { type: "string" },
  },
};

/** Ask the free models together; vote each position's action. */
async function adviseAll(ai, facts) {
  const r = await askMixture(ai, { system: SYSTEM, user: `Open positions and the market now:\n${JSON.stringify(facts)}\n\nGive the update.`, schema: SCHEMA, maxTokens: 2000, width: 5, merge: null, allowPaid: false });
  const all = r.all || (r.data ? [{ name: (r.by || [])[0] || "model", data: r.data }] : []);
  if (!all.length) return { ok: false, models: r.tried || [] };
  const per = {};
  for (const ans of all) {
    for (const p of (ans.data && ans.data.positions) || []) {
      const s = String(p.symbol || "").toUpperCase();
      if (!s) continue;
      (per[s] = per[s] || []).push({ by: ans.name, action: p.action, note: String(p.note || "").slice(0, 240) });
    }
  }
  const out = {};
  for (const [s, votes] of Object.entries(per)) {
    const count = {};
    votes.forEach((v) => (count[v.action] = (count[v.action] || 0) + 1));
    const action = Object.entries(count).sort((a, b) => b[1] - a[1])[0][0];
    const agree = votes.filter((v) => v.action === action);
    // the note from the strongest model that agreed
    const strongest = agree.slice().sort((a, b) => rankOf({ id: a.by.toLowerCase().replace(/ /g, "-") }) - rankOf({ id: b.by.toLowerCase().replace(/ /g, "-") }))[0];
    out[s] = { action, agree: agree.length, of: votes.length, note: strongest ? strongest.note : "" };
  }
  const watch = (all.find((a) => a.data && a.data.watch) || { data: { watch: "" } }).data.watch;
  return { ok: true, per: out, watch: String(watch || "").slice(0, 240), models: all.map((a) => a.name) };
}

require("./brains").register("whatsapp", SYSTEM, "WhatsApp position updates");

module.exports = { adviseAll, SYSTEM, SCHEMA };
