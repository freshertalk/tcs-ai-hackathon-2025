"use strict";
// The social and news digest: the default AI model (Claude Sonnet 5.5 unless the owner picked another
// on the AI page) reads the new posts and headlines that passed the rules' filter
// (server/social/extract.js) and turns each into organised information for the trading desk — is it
// really about Indian markets, a one-line summary, the NSE stocks and sectors it touches, the kind of
// event, bullish or bearish, how much it matters and for how long.
//
//   - The new items are cut into batches of eight; two batches are read at a time. A batch the
//     default model fails on goes to the AI page's fallback models, one at a time.
//   - The brief: the default model reads the organised items of the last hours and writes what
//     matters for NSE and BSE now — themes, stocks to watch, sectors, risks and a checklist.
//
// Every model comes through the AI Engine (brains, shared lanes, the live board). No timers here: the
// social watcher (server/social-watch.js) calls it. Nothing here can place an order.

const { team, clientFor } = require("./mixture");

const ITEM_SYSTEM = `You read social-media posts and news headlines for a private trading desk that trades Indian equities (NSE and BSE). For each item decide whether it can move Indian stocks, and organise it.

Rules:
- Use only the item's own words. Never invent a number, a company, an event or a date.
- "relevant" is true only for items that can plausibly move an Indian stock, sector, index, the rupee or Indian bonds — company news, results, orders, ratings, policy, RBI, SEBI, macro data, FII/DII flows, global markets and commodities that India trades on. Sports, gossip, lifestyle and unrelated politics are not relevant.
- "symbols": NSE trading symbols (upper case, e.g. RELIANCE, INFY, SBIN, TATAMOTORS) of the companies the item is about — only when the item names them; otherwise an empty list. "Nifty"/"Sensex" are not symbols.
- "sectors": from this list only: banks, it, pharma, auto, metals, energy, power, fmcg, realty, telecom, infra, defence, psu, cement, aviation, chemicals.
- "event": results, order, rating, corporate, regulatory, policy, macro, global, market or other.
- "sentiment": bullish, bearish or neutral FOR THE NAMED STOCKS (or for Indian markets when none is named).
- "impact": high (likely to move the stock or index today), medium, or low.
- "horizon": intraday, days, weeks or long.
- "summary": one plain sentence, under 25 words, with the key number if the item gives one.
- Rumour, opinion or an unverified social post: say so in the summary and keep impact at most medium.`;

const ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "relevant", "summary", "symbols", "sectors", "event", "sentiment", "impact", "horizon"],
        properties: {
          id: { type: "string" },
          relevant: { type: "boolean" },
          summary: { type: "string" },
          symbols: { type: "array", items: { type: "string" } },
          sectors: { type: "array", items: { type: "string" } },
          event: { type: "string", enum: ["results", "order", "rating", "corporate", "regulatory", "policy", "macro", "global", "market", "other"] },
          sentiment: { type: "string", enum: ["bullish", "bearish", "neutral"] },
          impact: { type: "string", enum: ["high", "medium", "low"] },
          horizon: { type: "string", enum: ["intraday", "days", "weeks", "long"] },
        },
      },
    },
  },
};

const BRIEF_SYSTEM = `You write the social-and-news brief for a private trading desk in Indian equities (NSE and BSE). You are given organised items from the last hours — each with its summary, stocks, sectors, event, sentiment, impact, source and time — and the desk's tally of mentions.

Write what matters for Indian markets now:
- a one-line headline and the overall mood (risk_on, risk_off or mixed);
- three to six themes, each with the evidence (which sources, how many items);
- the stocks to watch, each with the reason and the direction the news points (up, down or unclear) — only stocks named in the items;
- the sectors with a tailwind or a headwind;
- the risks (rumours, unconfirmed posts, scheduled events);
- a short checklist for the trader.
Use only the items given; quote their numbers; mark social posts and rumours as unverified. Never promise a move or a profit, and never tell the trader to buy or sell.`;

const BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "mood", "themes", "watch", "sectors", "risks", "checklist"],
  properties: {
    headline: { type: "string" },
    mood: { type: "string", enum: ["risk_on", "risk_off", "mixed"] },
    themes: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "detail"], properties: { title: { type: "string" }, detail: { type: "string" } } } },
    watch: { type: "array", items: { type: "object", additionalProperties: false, required: ["symbol", "direction", "why"], properties: { symbol: { type: "string" }, direction: { type: "string", enum: ["up", "down", "unclear"] }, why: { type: "string" } } } },
    sectors: { type: "array", items: { type: "object", additionalProperties: false, required: ["sector", "bias", "why"], properties: { sector: { type: "string" }, bias: { type: "string", enum: ["tailwind", "headwind", "watch"] }, why: { type: "string" } } } },
    risks: { type: "array", items: { type: "string" } },
    checklist: { type: "array", items: { type: "string" } },
  },
};

const SECTOR_IDS = ["banks", "it", "pharma", "auto", "metals", "energy", "power", "fmcg", "realty", "telecom", "infra", "defence", "psu", "cement", "aviation", "chemicals"];
const str = (x, n) => String(x == null ? "" : x).slice(0, n);

class SocialAI {
  constructor(ai) {
    this.ai = ai;
  }

  /** The default model, then the fallbacks. */
  models() {
    return team(this.ai).models;
  }

  ready() {
    return this.models().length > 0;
  }

  async _ask(model, system, user, schema, maxTokens, fresh = false) {
    const r = await clientFor(this.ai, model, 90000).ask({ system, user, schema, maxTokens, effort: "low", fresh });
    return r.data;
  }

  /**
   * Organise items with the default model (two batches at a time; the fallbacks for a failed batch).
   * @param items [{ id, title, text, source, at }] (the rules already found them market-related)
   * @returns { results: Map(id → reading), used: [{ model, items, ok, error }] }
   */
  async organise(items, { batch = 8 } = {}) {
    const models = this.models();
    const results = new Map();
    const used = [];
    if (!models.length || !items.length) return { results, used };
    const batches = [];
    for (let i = 0; i < items.length; i += batch) batches.push(items.slice(i, i + batch));
    const one = async (b) => {
      const user = `Items (JSON):\n${JSON.stringify(b.map((x) => ({ id: x.id, source: x.source, at: x.at, title: x.title, text: str(x.text, 500) })))}`;
      for (const m of models) {
        try {
          const d = await this._ask(m, ITEM_SYSTEM, user, ITEM_SCHEMA, 6000);
          for (const x of Array.isArray(d && d.items) ? d.items : []) {
            if (!b.some((y) => y.id === x.id)) continue;
            results.set(x.id, {
              relevant: Boolean(x.relevant),
              summary: str(x.summary, 240),
              symbols: (Array.isArray(x.symbols) ? x.symbols : []).map((s) => str(s, 20).toUpperCase().replace(/[^A-Z0-9&-]/g, "")).filter(Boolean).slice(0, 6),
              sectors: (Array.isArray(x.sectors) ? x.sectors : []).map((s) => str(s, 20).toLowerCase()).filter((s) => SECTOR_IDS.includes(s)).slice(0, 4),
              event: str(x.event, 20),
              sentiment: ["bullish", "bearish", "neutral"].includes(x.sentiment) ? x.sentiment : "neutral",
              impact: ["high", "medium", "low"].includes(x.impact) ? x.impact : "low",
              horizon: ["intraday", "days", "weeks", "long"].includes(x.horizon) ? x.horizon : "days",
              by: m.name,
            });
          }
          used.push({ model: m.name, items: b.length, ok: true });
          return;
        } catch (err) {
          used.push({ model: m.name, items: b.length, ok: false, error: str(err && err.message, 160) });
        }
      }
    };
    for (let i = 0; i < batches.length; i += 2) await Promise.all(batches.slice(i, i + 2).map(one));
    return { results, used };
  }

  /** The brief over the organised items: the default model (a fallback when it fails). */
  async brief(items, tally, { fresh = false } = {}) {
    const models = this.models();
    if (!models.length || !items.length) return null;
    const user = `The desk's tally (mentions, net sentiment):\n${JSON.stringify(tally)}\n\nOrganised items (newest first):\n${JSON.stringify(items.slice(0, 60))}`;
    for (const m of models) {
      try {
        const d = await this._ask(m, BRIEF_SYSTEM, user, BRIEF_SCHEMA, 8000, fresh);
        return {
          headline: str(d.headline, 240),
          mood: ["risk_on", "risk_off", "mixed"].includes(d.mood) ? d.mood : "mixed",
          themes: (d.themes || []).slice(0, 6).map((x) => ({ title: str(x.title, 100), detail: str(x.detail, 400) })),
          watch: (d.watch || []).slice(0, 10).map((x) => ({ symbol: str(x.symbol, 20).toUpperCase(), direction: ["up", "down", "unclear"].includes(x.direction) ? x.direction : "unclear", why: str(x.why, 300) })),
          sectors: (d.sectors || []).slice(0, 8).map((x) => ({ sector: str(x.sector, 60), bias: ["tailwind", "headwind", "watch"].includes(x.bias) ? x.bias : "watch", why: str(x.why, 300) })),
          risks: (d.risks || []).slice(0, 6).map((x) => str(x, 300)),
          checklist: (d.checklist || []).slice(0, 6).map((x) => str(x, 300)),
          by: m.name,
        };
      } catch (_) {
        /* the next model */
      }
    }
    return null;
  }
}

require("./brains").register("social", ITEM_SYSTEM, "Social & news: organise each item");
require("./brains").register("social", BRIEF_SYSTEM, "Social & news: the brief");

module.exports = { SocialAI, ITEM_SYSTEM, BRIEF_SYSTEM, SECTOR_IDS };
