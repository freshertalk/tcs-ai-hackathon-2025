"use strict";
// AI brains: instructions the owner writes for the AI, kept in one place and added to the AI
// features they belong to — automatically, from the next request.
//
//   - A brain is { title, text, scopes, enabled }. "scopes" names the features it applies to
//     ("all", or e.g. "strategist", "copilot", "ensemble-live"). Every AI request whose
//     instructions belong to one of those features gets the brain appended to its system prompt.
//   - When a brain is saved with "let the AI refine it", the default model (Claude Sonnet 5.5 unless
//     the owner picked another on the AI page) rewrites it into clear final wording and decides where
//     it belongs; if it fails, the AI page's fallback models are tried in turn. The owner's own
//     wording is kept and can be put back at any time.
//   - Brains can never change an answer's format (the code checks it), never permit a promise of
//     profit, and never remove a stop-loss or the desk's arithmetic checks: those live in code.
//
// The trading-skills file (playbook.js) stays as it was: it is the core brain every strategist,
// research, decision, coach and review request already reads.
//
// No timers here (a test checks that the AI folder has none) and no broker: brains are text.

const crypto = require("node:crypto");
const { makeClient, providerOf } = require("./providers");
const { AiError } = require("./client");

const NAME = "ai/brains.json";
const MAX_BRAINS = 60;
const MAX_TEXT = 4000;
const MAX_TITLE = 100;
const MAX_IN_PROMPT = 9000; // characters of brains added to one request at most

/** Every AI feature a brain can be given to, in plain words. */
const FEATURES = [
  { id: "strategist", name: "AI strategist", trigger: "Build strategy button on a stock's AI strategist tab" },
  { id: "learn", name: "Score & learn", trigger: "Score outcomes & learn button (turns scored plans into lessons)" },
  { id: "copilot", name: "Live co-pilot", trigger: "Ask now, or Go live (call changes, level breaks, early warnings)" },
  { id: "decision", name: "AI decision", trigger: "Get AI decision on the Behaviour & AI tab" },
  { id: "research", name: "Research notes and summary", trigger: "Research N stocks, and the automatic research when AI notes are on" },
  { id: "ensemble-live", name: "AI Live analysts", trigger: "AI Live button (next 15–30 minutes)" },
  { id: "ensemble-research", name: "AI Research analysts", trigger: "AI Research button (next trading session)" },
  { id: "coach", name: "Position coach", trigger: "Ask the coach on Positions" },
  { id: "review", name: "Journal review", trigger: "Review this range on the Journal" },
  { id: "dayreview", name: "Trade Analysis day review", trigger: "The 3:45 PM report (when AI analysis is on) or Write the AI analysis" },
  { id: "debrief", name: "Day debrief", trigger: "Write the debrief on the Debrief" },
  { id: "tradeai", name: "TradeAI chat", trigger: "A question in the TradeAI chat (its own page), or ASK on WhatsApp" },
  { id: "whatsapp", name: "WhatsApp updates", trigger: "The timed updates on WhatsApp while WhatsApp Trading is on" },
  { id: "social", name: "Social & news digest", trigger: "New posts and headlines from the Social Media sources (every few minutes), or Digest now on the Social Media page" },
];
const FEATURE_IDS = FEATURES.map((f) => f.id);

/* ---------------------------------------------------------------------------------- registry */
// Each AI file registers the system prompt(s) it sends, so an ask can be traced to its feature.

const registry = new Map(); // system prompt text → feature id
const prompts = new Map(); // feature id → [{ label, text }]
function register(feature, system, label = "") {
  if (!FEATURE_IDS.includes(feature) || typeof system !== "string") return;
  registry.set(system, feature);
  const list = prompts.get(feature) || [];
  if (!list.some((p) => p.text === system)) list.push({ label: label || "System instructions", text: system });
  prompts.set(feature, list);
}
const featureOf = (system) => registry.get(system) || null;

/* ---------------------------------------------------------------------------- the AI team */

const REFINE_SYSTEM = `You help the owner of a private NSE (India) trading desk write an "AI brain": a standing instruction that is added to the instructions of some of the desk's AI features. You write the final version.

The desk's AI features (ids): ${FEATURES.map((f) => `"${f.id}" = ${f.name} (${f.trigger})`).join("; ")}. "all" means every feature.

Write the best version of the owner's draft:
- Keep the owner's intent exactly. Make it clear, specific and testable, in short plain-English sentences or a short list. No more than about 1,200 characters unless the draft needs more.
- Make it about process and conditions the AI can apply to the data it is given (time of day, trend agreement, distance from VWAP, volume, risk per trade, stops, position size, when to stand aside...). Never about predicting a particular stock.
- It must never ask for a promise of profit, a win rate or a probability; never remove or widen a stop-loss beyond the desk's rules; never ask the AI to place orders (it cannot); never change the answer format. If the draft asks for any of these, keep the rest and explain in "conflicts".
- Choose the scopes: the feature ids where this brain belongs (or ["all"]). Prefer the narrowest set that fits.
- Point out any conflict with the existing brains or the trading-skills rules you are shown, in "conflicts" (empty list when none).
- "rationale": one or two sentences on what you changed and why.`;

const VERSION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "text", "scopes", "conflicts", "rationale"],
  properties: {
    title: { type: "string", description: "A short name for the brain, under 80 characters." },
    text: { type: "string", description: "The instruction itself." },
    scopes: { type: "array", items: { type: "string" }, description: "Feature ids, or [\"all\"]." },
    conflicts: { type: "array", items: { type: "string" } },
    rationale: { type: "string" },
  },
};

const str = (x, n) => String(x === undefined || x === null ? "" : x).replace(/\r\n/g, "\n").trim().slice(0, n);
const cleanScopes = (list) => {
  const s = [...new Set((Array.isArray(list) ? list : []).map((x) => String(x).trim().toLowerCase()))].filter((x) => x === "all" || FEATURE_IDS.includes(x));
  return s.includes("all") || !s.length ? ["all"] : s;
};
const istDate = (ms) => new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10);

class Brains {
  constructor({ ai, docs, now = () => Date.now() }) {
    this.ai = ai;
    this.docs = docs;
    this.now = now;
  }

  _load() {
    const d = this.docs.read(NAME, null);
    return { brains: Array.isArray(d && d.brains) ? d.brains : [] };
  }
  _save(d) {
    this.docs.write(NAME, d);
  }

  list() {
    const d = this._load();
    return {
      brains: d.brains,
      features: FEATURES.map((f) => ({ ...f, brains: d.brains.filter((b) => b.enabled !== false && (b.scopes.includes("all") || b.scopes.includes(f.id))).map((b) => b.id) })),
      limits: { brains: MAX_BRAINS, text: MAX_TEXT, title: MAX_TITLE, inPrompt: MAX_IN_PROMPT },
      team: this.teamStatus(),
    };
  }

  /** Who would write a brain now: the default model, then the fallbacks. */
  teamStatus() {
    const chain = typeof this.ai.modelChain === "function" ? this.ai.modelChain() : [];
    return { lead: chain[0] ? `${chain[0].name} (${chain[0].company})` : null, fallbacks: chain.slice(1).map((a) => `${a.name} (${a.company})`) };
  }

  /* --------------------------------------------------------------- what each request gets */

  /** The brains for one feature, as the text appended to its system prompt ("" when none). */
  forFeature(feature) {
    if (!feature) return "";
    const live = this._load().brains.filter((b) => b.enabled !== false && (b.scopes.includes("all") || b.scopes.includes(feature)));
    if (!live.length) return "";
    let out = "";
    let n = 0;
    for (const b of live) {
      const line = `${n + 1}. ${b.title}: ${b.text}\n`;
      if (out.length + line.length > MAX_IN_PROMPT) break;
      out += line;
      n += 1;
    }
    return `\n\n---\nTHE OWNER'S AI BRAINS for this feature — standing instructions written by the desk's owner. Follow them closely. They never change the answer format, never permit promising a profit, a win rate or a probability, and never remove a stop-loss or the desk's checks; where one would, keep to the rules above and say so in your answer.\n${out}`;
  }

  /** The system prompt with the owner's brains added, for whichever feature it belongs to. */
  compose(system) {
    try {
      return system + this.forFeature(featureOf(system));
    } catch (_) {
      return system; // a damaged brains record never stops an AI request
    }
  }

  /** A client whose every ask carries the brains of its feature. */
  wrap(client) {
    if (!client || client.__brains) return client;
    const w = Object.create(client);
    w.__brains = true;
    w.ask = (args = {}) => client.ask({ ...args, system: this.compose(args.system || "") });
    return w;
  }

  /* ------------------------------------------------------------------------- add / edit */

  _clean(input) {
    const title = str(input.title, MAX_TITLE);
    const text = str(input.text, MAX_TEXT);
    if (!title) throw new AiError("Give the brain a short title.", "invalid", 400);
    if (text.length < 10) throw new AiError("Write the instruction itself (at least a sentence).", "invalid", 400);
    return { title, text, scopes: cleanScopes(input.scopes), enabled: input.enabled !== false };
  }

  /**
   * Save a brain (new when there is no id). With refine, the AI team rewrites it first and chooses
   * where it belongs; the owner's wording is kept as "original".
   */
  async save(input = {}, by = "") {
    const draft = this._clean(input);
    const d = this._load();
    const id = input.id ? String(input.id) : "";
    const old = id ? d.brains.find((b) => b.id === id) : null;
    if (id && !old) throw new AiError("That brain is not there any more.", "not_found", 404);
    if (!old && d.brains.length >= MAX_BRAINS) throw new AiError(`There are already ${MAX_BRAINS} brains. Remove one first.`, "invalid", 400);
    let final = draft;
    let team = null;
    if (input.refine) {
      team = await this.refine(draft, old ? old.id : null);
      final = { ...draft, title: team.final.title, text: team.final.text, scopes: input.keepScopes ? draft.scopes : team.final.scopes };
    }
    const at = new Date(this.now()).toISOString();
    const brain = {
      ...(old || { id: crypto.randomBytes(6).toString("hex"), createdAt: at, createdBy: by }),
      ...final,
      updatedAt: at,
      updatedBy: by,
      original: team ? { title: draft.title, text: draft.text, scopes: draft.scopes } : null,
      refined: team ? { by: team.models, mergedBy: team.mergedBy, conflicts: team.final.conflicts, notes: team.final.notes, at } : null,
      history: old ? [{ at: old.updatedAt, by: old.updatedBy || old.createdBy, title: old.title, text: old.text, scopes: old.scopes }, ...(old.history || [])].slice(0, 10) : [],
    };
    const d2 = this._load();
    d2.brains = old ? d2.brains.map((b) => (b.id === brain.id ? brain : b)) : [...d2.brains, brain];
    this._save(d2);
    return { ...this.list(), brain, refine: team };
  }

  /** Put the owner's own wording back (after a refine), or an earlier version from the history. */
  revert(id, { to = "original", index = 0 } = {}, by = "") {
    const d = this._load();
    const b = d.brains.find((x) => x.id === id);
    if (!b) throw new AiError("That brain is not there any more.", "not_found", 404);
    const src = to === "history" ? (b.history || [])[Number(index)] : b.original;
    if (!src) throw new AiError("There is no earlier wording to go back to.", "invalid", 400);
    const at = new Date(this.now()).toISOString();
    const next = { ...b, title: src.title, text: src.text, scopes: cleanScopes(src.scopes), updatedAt: at, updatedBy: by, original: null, refined: null, history: [{ at: b.updatedAt, by: b.updatedBy, title: b.title, text: b.text, scopes: b.scopes }, ...(b.history || [])].slice(0, 10) };
    d.brains = d.brains.map((x) => (x.id === id ? next : x));
    this._save(d);
    return { brain: next, ...this.list() };
  }

  setEnabled(id, enabled) {
    const d = this._load();
    if (!d.brains.some((b) => b.id === id)) throw new AiError("That brain is not there any more.", "not_found", 404);
    d.brains = d.brains.map((b) => (b.id === id ? { ...b, enabled: Boolean(enabled) } : b));
    this._save(d);
    return this.list();
  }

  move(id, dir) {
    const d = this._load();
    const i = d.brains.findIndex((b) => b.id === id);
    const j = i + (dir === "up" ? -1 : 1);
    if (i < 0 || j < 0 || j >= d.brains.length) return this.list();
    [d.brains[i], d.brains[j]] = [d.brains[j], d.brains[i]];
    this._save(d);
    return this.list();
  }

  remove(id) {
    const d = this._load();
    if (!d.brains.some((b) => b.id === id)) throw new AiError("That brain is not there any more.", "not_found", 404);
    d.brains = d.brains.filter((b) => b.id !== id);
    this._save(d);
    return this.list();
  }

  /* --------------------------------------------------------------------------- the team */

  /**
   * The default model writes the final version; when it fails, the fallback models are tried in turn.
   * Each refine counts as one of today's AI runs (the same daily cap as AI Live / AI Research).
   */
  async refine(draft, skipId = null) {
    const ai = this.ai;
    const ens = ai.ensemble;
    if (!ens) throw new AiError("The AI is not available on this server.", "not_configured", 409);
    const roster = ens.roster();
    const st = ens._state();
    const today = istDate(ai.now());
    if (st.day.date !== today) st.day = { date: today, paid: 0 };
    const writers = roster.lead ? [roster.lead, ...(roster.fallbacks || [])] : [];
    if (!writers.length) throw new AiError("No AI key is saved. Save the Anthropic key (the default model is Claude Sonnet 5.5) on the AI page, or save the brain without refining.", "not_configured", 409);
    if (st.day.paid >= roster.settings.paidDailyCap) throw new AiError(`Today's ${roster.settings.paidDailyCap} AI runs are used up (a limit you can change on the AI Engine page). Save the brain as written.`, "rate_limited", 429);

    const others = this._load()
      .brains.filter((b) => b.id !== skipId)
      .map((b) => ({ title: b.title, scopes: b.scopes, text: b.text.slice(0, 600) }));
    const skills = ai.playbook ? ai.playbook.read().slice(0, 5000) : "";
    const user = `The owner's draft:
${JSON.stringify({ title: draft.title, text: draft.text, scopes: draft.scopes })}

Existing brains:
${JSON.stringify(others)}

The trading-skills file (the core rules, first part):
${skills}

Write your version.`;
    const sec = roster.settings.deadlineSec;
    const versions = [];
    let pick = null;
    for (const a of writers) {
      const t0 = Date.now();
      try {
        const spec = { providerId: a.provider, apiKey: ai._key(a.provider), model: a.model, timeoutMs: Math.max(sec, 90) * 1000, repair: false };
        const client = ai.engine ? ai.engine.client(spec, { feature: "brains-team", brains: false }) : makeClient({ ...spec, fetchImpl: ai.fetch });
        const r = await client.ask({ system: REFINE_SYSTEM, user, schema: VERSION_SCHEMA, maxTokens: 6000, effort: "low" });
        const v = r.data || {};
        const out = { id: a.id, name: a.name, company: a.company, lead: true, ok: true, title: str(v.title, MAX_TITLE), text: str(v.text, MAX_TEXT), scopes: cleanScopes(v.scopes), conflicts: (v.conflicts || []).map((x) => str(x, 300)).slice(0, 6), rationale: str(v.rationale, 400), ms: Date.now() - t0, usage: r.usage, cached: Boolean(r.cached) };
        versions.push(out);
        if (out.title && out.text.length >= 10) {
          pick = out;
          break;
        }
      } catch (err) {
        versions.push({ id: a.id, name: a.name, company: a.company, lead: true, ok: false, error: err && err.message ? err.message : "failed", ms: Date.now() - t0 });
      }
    }
    if (pick && !pick.cached) {
      const s2 = ens._state();
      if (s2.day.date !== today) s2.day = { date: today, paid: 0 };
      s2.day.paid += 1;
      ens._save(s2);
    }
    if (!pick) throw new AiError(`The AI model failed or timed out (${versions.map((v) => `${v.name}: ${v.error || "no answer"}`).join("; ").slice(0, 400)}). Save the brain as written, or try again.`, "unavailable", 502);
    const final = { title: pick.title, text: pick.text, scopes: pick.scopes, conflicts: pick.conflicts, notes: pick.rationale || (versions.length > 1 ? `Written by ${pick.name} (the default model did not answer).` : "") };
    return { final, versions, models: [pick.name], mergedBy: pick.name, lead: pick.name };
  }

  /** What the AI Engine page shows the superadmin: every feature's real instructions. */
  prompts() {
    return FEATURES.map((f) => ({ ...f, prompts: prompts.get(f.id) || [], brains: this.forFeature(f.id) }));
  }
}

module.exports = { Brains, FEATURES, FEATURE_IDS, register, featureOf, cleanScopes, REFINE_SYSTEM, providerOf };
