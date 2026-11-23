"use strict";
// Vinaypedia's AI writer (23 Nov 2026): the model turns one area of the desk's knowledge base into a lesson, and the newest
// circulars from NSE, SEBI, Zerodha and RBI into a short digest of what changed for an intraday trader.
//
// It is grounded: it is handed the area's own pages from the knowledge base (market/knowledge.js), the newest official updates
// filed under that area, the owner's own learnings there, and a fixed list of official reading — and it may cite ONLY from that
// list (by id; anything else is dropped). It never invents a rule, a rate or a date; where the material does not say, it says so.
//
// It runs only when asked: a click on the page, or the owner's "Allow once" on the popup (server/ai/spend.js). Nothing here has
// a clock.

const { AiError } = require("./client");

const str = (x, n) => String(x == null ? "" : x).replace(/\s+/g, " ").trim().slice(0, n);
const list = (x, max, n) => (Array.isArray(x) ? x : []).map((v) => str(v, n)).filter(Boolean).slice(0, max);

const LESSON_SYSTEM = `You write ONE lesson for an intraday trader in Indian markets (NSE/BSE cash equities, with F&O context), for a private study wiki the trader keeps.

You are given: the topic area, the desk's own knowledge pages for it (written from exchange rules and widely published practice), the newest official updates filed under it (NSE circulars, SEBI, Zerodha, RBI), the trader's own notes on it, and a numbered list of official reading.

How to write:
- Teach the area as a practitioner would: what it is, why it matters intraday, how to use it, and where it goes wrong.
- Use ONLY the material given for facts: rules, rates, timings, limits and dates must come from the pages or the updates. Never invent a number, a rule, a date or a source. If the updates change something the pages say, say the update is newer and the page may be out of date.
- Respect the trader's own notes: build on them, and point out kindly where one conflicts with the material.
- Rules must be one sentence each and actionable on a trading day. Mistakes are the common, costly ones.
- The worked example uses round Indian-market figures (₹, NSE stock-like prices) and is clearly an illustration, not a recommendation or a forecast.
- Cite reading ONLY by the ids in the list you are given.
- Never promise profit or a win rate. Plain, short sentences. No filler.`;

const LESSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "key_points", "rules", "mistakes", "example", "checklist", "read", "caveat"],
  properties: {
    summary: { type: "string", description: "Three to five sentences: what the area is and why it matters to an intraday trader." },
    key_points: { type: "array", items: { type: "string" }, description: "Up to six key points, each one or two sentences." },
    rules: { type: "array", items: { type: "string" }, description: "Up to six one-sentence rules to follow on a trading day." },
    mistakes: { type: "array", items: { type: "string" }, description: "Up to five common, costly mistakes and how to avoid each." },
    example: { type: "string", description: "One short worked example with round ₹ figures, marked as an illustration." },
    checklist: { type: "array", items: { type: "string" }, description: "Up to five quick checks before a trade, for this area." },
    read: { type: "array", items: { type: "string" }, description: "Up to four ids from the official reading list, most useful first." },
    caveat: { type: "string", description: "One sentence on what this lesson cannot cover or where to confirm it." },
  },
};

const DIGEST_SYSTEM = `You read the newest official updates for an Indian intraday trader (NSE circulars, SEBI, Zerodha's announcements, RBI press releases) and say, in plain words, which ones matter to an intraday trader in NSE/BSE cash equities (and F&O context), what changed, and what it means in practice.

- Use only the titles and excerpts given. Never invent the content of a circular you were not given; when the title alone does not say what changed, say "read the circular" instead of guessing.
- Leave out updates that do not matter to an intraday trader (a single company's routine filing, a fund's notice), and say how many you left out.
- Each item: what changed in one sentence, what it means for a trading day in one sentence.
- Never promise profit. Short, concrete sentences.`;

const DIGEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "items", "left_out", "caveat"],
  properties: {
    headline: { type: "string", description: "The week's updates in one line, under 18 words." },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "what_changed", "what_it_means"],
        properties: {
          key: { type: "string", description: "The update's key exactly as given." },
          what_changed: { type: "string" },
          what_it_means: { type: "string" },
        },
      },
      description: "Up to eight updates that matter, most important first.",
    },
    left_out: { type: "integer", description: "How many updates were left out as not relevant to intraday trading." },
    caveat: { type: "string", description: "One sentence: where to confirm (the circular itself)." },
  },
};

class LearnWriter {
  constructor(ai) {
    this.ai = ai;
  }

  /**
   * @param area     the area's name
   * @param pages    [{ title, rules: [..] }] the knowledge base's pages for the area
   * @param updates  [{ key, by, title, at, text }] the newest official updates filed under it
   * @param notes    [{ title, kind, body }] the owner's own learnings there
   * @param reading  [{ id, name, url }] the official reading it may cite
   */
  async lesson({ area, pages = [], updates = [], notes = [], reading = [] }) {
    const client = this.ai._client(); // no key → a clear error before anything is sent
    const material = {
      area,
      knowledgePages: pages.slice(0, 16).map((p) => ({ title: p.title, rules: (p.rules || []).slice(0, 10) })),
      officialUpdates: updates.slice(0, 10).map((u) => ({ by: u.by, date: String(u.at || "").slice(0, 10), title: u.title, excerpt: str(u.text, 300) })),
      tradersOwnNotes: notes.slice(0, 12).map((n) => ({ kind: n.kind, title: n.title, text: str(n.body, 600) })),
      officialReading: reading.map((r) => ({ id: r.id, name: r.name })),
    };
    const answer = await client.ask({ system: LESSON_SYSTEM, user: `The material for the lesson:\n\n${JSON.stringify(material, null, 1)}`, schema: LESSON_SCHEMA, effort: "medium", maxTokens: 5000 });
    const d = answer.data;
    if (!d || typeof d !== "object") throw new AiError("The model's answer was not in the expected format.", "bad_output", 502);
    const ids = new Set(reading.map((r) => r.id));
    return {
      area,
      at: new Date(this.ai.now()).toISOString(),
      model: answer.model,
      provider: typeof this.ai._provider === "function" ? this.ai._provider() : "",
      summary: str(d.summary, 1500),
      points: list(d.key_points, 6, 400),
      rules: list(d.rules, 6, 300),
      mistakes: list(d.mistakes, 5, 300),
      example: str(d.example, 1200),
      checklist: list(d.checklist, 5, 200),
      // only the official reading it was given: an invented link never reaches the page
      read: list(d.read, 4, 60).filter((id) => ids.has(id)),
      caveat: str(d.caveat, 300),
      grounded: { pages: material.knowledgePages.length, updates: material.officialUpdates.length, notes: material.tradersOwnNotes.length },
    };
  }

  /** @param updates  [{ key, by, title, at, text, link }] */
  async digest({ updates = [] }) {
    const client = this.ai._client();
    const given = updates.slice(0, 30).map((u) => ({ key: u.key, by: u.by, date: String(u.at || "").slice(0, 10), title: u.title, excerpt: str(u.text, 300) }));
    const answer = await client.ask({ system: DIGEST_SYSTEM, user: `The updates:\n\n${JSON.stringify(given, null, 1)}`, schema: DIGEST_SCHEMA, effort: "low", maxTokens: 3000 });
    const d = answer.data;
    if (!d || typeof d !== "object") throw new AiError("The model's answer was not in the expected format.", "bad_output", 502);
    const byKey = new Map(updates.map((u) => [u.key, u]));
    return {
      at: new Date(this.ai.now()).toISOString(),
      model: answer.model,
      headline: str(d.headline, 240),
      // only updates it was given: an invented one is dropped
      items: (Array.isArray(d.items) ? d.items : [])
        .filter((x) => x && byKey.has(String(x.key)))
        .slice(0, 8)
        .map((x) => {
          const u = byKey.get(String(x.key));
          return { key: u.key, by: u.by, title: u.title, link: u.link, at: u.at, what: str(x.what_changed, 400), means: str(x.what_it_means, 400) };
        }),
      leftOut: Number.isFinite(Number(d.left_out)) ? Math.max(0, Math.round(Number(d.left_out))) : 0,
      caveat: str(d.caveat, 300),
      from: given.length,
    };
  }
}

// the owner's AI brains reach these instructions automatically (server/ai/brains.js)
require("./brains").register("vinaypedia", LESSON_SYSTEM, "Vinaypedia lesson");
require("./brains").register("vinaypedia", DIGEST_SYSTEM, "Vinaypedia digest of official updates");

module.exports = { LearnWriter, LESSON_SCHEMA, DIGEST_SCHEMA, LESSON_SYSTEM, DIGEST_SYSTEM };
