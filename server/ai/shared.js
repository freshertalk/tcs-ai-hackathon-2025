"use strict";
// Shared research: one record of what the AI has already worked out, read by every part of the desk.
//
// Every model answer goes out through the AI Engine (engine.js). When a feature that reasons about
// a stock gets an answer — the AI strategist, the live co-pilot, the AI decision, a research note,
// AI Live and AI Research, the position coach, TradeAI, the Live board's exit advisor — the Engine
// hands it here, and it is kept as a FINDING: which stock, which feature, which model, when, at
// what price, a short summary, its call (hold, exit, long …) and the prices it named. The Live
// board publishes its exit levels itself, after the desk's check, so only checked levels are shared.
//
// Any other part of the desk can then read what is already known instead of paying for it again:
// TradeAI's agent reads the findings on a stock before it asks anything; the exit advisor is told
// what the other features found; the terminal shows them beside the stock on every workspace. A
// finding is fresh for a time that fits its kind (an exit opinion: minutes; a research note: the
// day) and is marked when the price has moved away from where it was made.
//
// Text and numbers only, kept in the database (one record, the newest 400). Nothing here asks a
// model, starts work by itself or can place an order.

const DOC = "ai/shared-research.json";
const MAX = 400;
// how long a finding of each feature counts as fresh, in minutes
const TTL_MIN = { exit: 12, "exit-levels": 45, tradeai: 30, "ensemble-live": 20, "ensemble-research": 720, decision: 30, coach: 15, copilot: 10, research: 720, strategist: 240 };
const LABEL = {
  exit: "Exit advisor (Live board)",
  "exit-levels": "Exit levels (Live board)",
  tradeai: "TradeAI",
  "ensemble-live": "AI Live",
  "ensemble-research": "AI Research",
  decision: "AI decision",
  coach: "Position coach",
  copilot: "Live co-pilot",
  research: "Research note",
  strategist: "AI strategist",
};
// findings that speak of the owner's own positions: shown to the owner only
const PRIVATE = new Set(["exit", "exit-levels", "coach", "tradeai"]);
// features that publish their own findings (after their own checks): the Engine does not capture these
const OWN = new Set(["exit-levels"]);
const TEXT_KEYS = ["headline", "summary", "answer", "reason", "verdict", "thesis", "rationale", "note", "brief", "view", "text"];
const TAG_KEYS = ["action", "bias", "stance", "lean", "direction", "decision", "call", "side", "confidence", "conviction", "outlook"];
const FACT_KEYS = ["entry", "stop", "stopLoss", "stop_loss", "target", "target1", "target2", "exit_price", "exitPrice", "support", "resistance", "invalidation"];

const num = (x) => typeof x === "number" && Number.isFinite(x);
const plain = (x, n) =>
  String(x == null ? "" : x)
    .replace(/[#*_`>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
const SYMBOL = /^[A-Z][A-Z0-9&-]{1,19}$/;

/** The short summary, the calls and the prices of a model's structured answer, whatever its shape. */
function digest(data) {
  const out = { summary: "", tags: {}, facts: {} };
  if (typeof data === "string") return { ...out, summary: plain(data, 320) };
  if (!data || typeof data !== "object") return out;
  const texts = [];
  const walk = (o, depth) => {
    if (!o || typeof o !== "object" || depth > 2) return;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string" && v.trim()) {
        if (TEXT_KEYS.includes(k)) texts.push({ at: TEXT_KEYS.indexOf(k) + depth * 20, text: v });
        else if (TAG_KEYS.includes(k) && v.length <= 40 && out.tags[k] === undefined) out.tags[k] = plain(v, 40);
      } else if (num(v)) {
        if (FACT_KEYS.includes(k) && v > 0 && out.facts[k] === undefined && Object.keys(out.facts).length < 8) out.facts[k] = Math.round(v * 100) / 100;
        else if (TAG_KEYS.includes(k) && out.tags[k] === undefined) out.tags[k] = v;
      } else if (v && typeof v === "object" && !Array.isArray(v)) walk(v, depth + 1);
    }
  };
  walk(data, 0);
  texts.sort((a, b) => a.at - b.at);
  out.summary = texts.length ? plain(texts[0].text, 320) : "";
  return out;
}

class SharedResearch {
  constructor({ docs, now = () => Date.now() }) {
    this.docs = docs;
    this.now = now;
    this.items = null;
    this.reads = { day: "", n: 0 };
  }

  _load() {
    if (this.items) return this.items;
    const d = (this.docs && this.docs.read(DOC, null)) || {};
    this.items = Array.isArray(d.items) ? d.items : [];
    return this.items;
  }
  _save() {
    if (!this.docs) return;
    try {
      this.docs.write(DOC, { items: this.items });
    } catch (_) {
      /* the findings stay in memory until the next write */
    }
  }

  /**
   * Keep one finding.
   * @param f { feature, symbol ("*" for the market as a whole), by (the model's name), summary, tags, facts,
   *            last (the price it was made at), ttlMin, detail (a small object the feature wants shared as it is) }
   */
  publish(f = {}) {
    const feature = String(f.feature || "");
    const symbol = f.symbol === "*" ? "*" : String(f.symbol || "").toUpperCase();
    const summary = plain(f.summary, 320);
    if (!LABEL[feature] || (symbol !== "*" && !SYMBOL.test(symbol)) || !summary) return null;
    const at = this.now();
    const ttl = num(f.ttlMin) && f.ttlMin > 0 ? f.ttlMin : TTL_MIN[feature] || 30;
    const item = {
      id: `${at.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
      at,
      until: at + ttl * 60000,
      feature,
      source: LABEL[feature],
      symbol,
      by: plain(f.by, 60) || "AI",
      summary,
      tags: f.tags && typeof f.tags === "object" ? f.tags : {},
      facts: f.facts && typeof f.facts === "object" ? f.facts : {},
      last: num(f.last) ? Math.round(f.last * 100) / 100 : null,
      detail: f.detail && typeof f.detail === "object" ? f.detail : null,
    };
    const items = this._load();
    // the newest finding of a feature on a stock replaces the one before it
    this.items = [item, ...items.filter((x) => !(x.feature === feature && x.symbol === symbol))].slice(0, MAX);
    this._save();
    return item;
  }

  /**
   * From the Engine: a model has just answered a request of this feature.
   * @param feature the brains' id of the feature
   * @param sent    { system, user } as asked
   * @param r       { data, model, servedBy } as answered
   * @param subject { symbol, last } when the caller knows them; else they are read from the request
   */
  capture(feature, sent, r, subject = null) {
    if (!LABEL[feature] || OWN.has(feature) || !r || r.data == null) return null;
    if (subject && subject.none) return null; // the caller says this answer is about no single stock
    const user = String((sent && sent.user) || "");
    let symbol = subject && subject.symbol ? String(subject.symbol).toUpperCase() : null;
    if (!symbol) {
      const m = user.match(/"symbol"\s*:\s*"([A-Z][A-Z0-9&-]{1,19})"/) || user.match(/"symbols"\s*:\s*\[\s*"([A-Z][A-Z0-9&-]{1,19})"/);
      symbol = m ? m[1] : null;
    }
    if (!symbol) return null; // a finding belongs to a stock; the rest is not shared
    let last = subject && num(subject.last) ? subject.last : null;
    if (last === null) {
      const m = user.match(/"last"\s*:\s*([0-9]+(?:\.[0-9]+)?)/);
      last = m ? Number(m[1]) : null;
    }
    const d = digest(r.data);
    return this.publish({ feature, symbol, by: (subject && subject.by) || r.servedBy || r.model || "AI", summary: d.summary, tags: d.tags, facts: d.facts, last });
  }

  _view(x, last) {
    const now = this.now();
    const moved = num(last) && num(x.last) && x.last > 0 ? Math.abs(last - x.last) / x.last >= 0.006 : false;
    return { ...x, clock: new Date(x.at + 5.5 * 3600000).toISOString().slice(11, 16), ageMin: Math.max(0, Math.round((now - x.at) / 60000)), fresh: now <= x.until, moved };
  }

  /**
   * What is known about one stock, newest first.
   * @param opts { last: the price now (a finding made more than 0.6% away is marked moved), all: also the ones
   *               that are no longer fresh (up to 12 hours old), limit, reader: who is reading (counted) }
   */
  forSymbol(symbol, { last = null, all = false, limit = 8, reader = "", owner = true } = {}) {
    const sym = String(symbol || "").toUpperCase();
    const now = this.now();
    const out = this._load()
      .filter((x) => x.symbol === sym && (owner || !PRIVATE.has(x.feature)) && (now <= x.until || (all && now - x.at <= 12 * 3600000)))
      .slice(0, limit)
      .map((x) => this._view(x, last));
    if (reader && out.some((x) => x.fresh)) this._read();
    return out;
  }

  /** The freshest finding of one feature on one stock, or null (not when the price has moved away). */
  latest(symbol, feature, { last = null } = {}) {
    const x = this.forSymbol(symbol, { last }).find((f) => f.feature === feature && f.fresh && !f.moved);
    return x || null;
  }

  /** Everything fresh, newest first — for the terminal's research drawer. */
  recent({ limit = 40, all = false, owner = true } = {}) {
    const now = this.now();
    return this._load()
      .filter((x) => (owner || !PRIVATE.has(x.feature)) && (now <= x.until || (all && now - x.at <= 12 * 3600000)))
      .slice(0, limit)
      .map((x) => this._view(x, null));
  }

  _read() {
    const day = new Date(this.now() + 5.5 * 3600000).toISOString().slice(0, 10);
    this.reads = this.reads.day === day ? { day, n: this.reads.n + 1 } : { day, n: 1 };
  }

  stats() {
    const now = this.now();
    const items = this._load();
    const day = new Date(now + 5.5 * 3600000).toISOString().slice(0, 10);
    return { kept: items.length, fresh: items.filter((x) => now <= x.until).length, stocks: new Set(items.filter((x) => now <= x.until).map((x) => x.symbol)).size, readsToday: this.reads.day === day ? this.reads.n : 0 };
  }
}

module.exports = { SharedResearch, digest, LABEL, TTL_MIN, PRIVATE };
