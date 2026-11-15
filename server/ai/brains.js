"use strict";
// AI brains: instructions the owner writes for the AI, kept in one place and added to the AI
// features they belong to — automatically, from the next request.
//
//   - A brain is { title, text, scopes, enabled }. "scopes" names the features it applies to
//     ("all", or e.g. "strategist", "copilot", "ensemble-live"). Every AI request whose
//     instructions belong to one of those features gets the brain appended to its system prompt.
//   - When a brain is saved with "let the AI team refine it", every free NVIDIA-hosted model
//     writes its own version in parallel, and one model (the paid lead when the paid model is on,
//     else the strongest free model that answered) merges them into the final wording and decides
//     where it belongs. The owner's own wording is kept and can be put back at any time.
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

const REFINE_SYSTEM = `You help the owner of a private NSE (India) trading desk write an "AI brain": a standing instruction that is added to the instructions of some of the desk's AI features. You are one of several models writing a version independently.

The desk's AI features (ids): ${FEATURES.map((f) => `"${f.id}" = ${f.name} (${f.trigger})`).join("; ")}. "all" means every feature.

Write the best version of the owner's draft:
- Keep the owner's intent exactly. Make it clear, specific and testable, in short plain-English sentences or a short list. No more than about 1,200 characters unless the draft needs more.
- Make it about process and conditions the AI can apply to the data it is given (time of day, trend agreement, distance from VWAP, volume, risk per trade, stops, position size, when to stand aside...). Never about predicting a particular stock.
- It must never ask for a promise of profit, a win rate or a probability; never remove or widen a stop-loss beyond the desk's rules; never ask the AI to place orders (it cannot); never change the answer format. If the draft asks for any of these, keep the rest and explain in "conflicts".
- Choose the scopes: the feature ids where this brain belongs (or ["all"]). Prefer the narrowest set that fits.
- Point out any conflict with the existing brains or the trading-skills rules you are shown, in "conflicts" (empty list when none).
- "rationale": one or two sentences on what you changed and why.`;

const MERGE_SYSTEM = `You merge several models' versions of one "AI brain" (a standing instruction for a private NSE trading desk's AI features) into the single best final version.

Rules: keep the owner's intent exactly; take the clearest and most precise wording and the strongest safeguards from the versions; drop anything that promises profit, a win rate or a probability, removes a stop-loss, asks for orders, or changes an answer's format; keep it concise (about 1,200 characters at most unless the intent needs more). Choose the final scopes from the feature ids (${FEATURE_IDS.join(", ")}, or "all"), preferring the narrowest set that fits — the versions' choices are votes. List real conflicts with the existing brains or rules in "conflicts". "notes": two or three sentences on how the versions differed and what you kept.`;

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
const MERGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "text", "scopes", "conflicts", "notes"],
  properties: {
    title: { type: "string" },
    text: { type: "string" },
    scopes: { type: "array", items: { type: "string" } },
    conflicts: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
  },
};
// which free model merges when no paid model is available: the strongest first
const MERGE_ORDER = ["nemotron-3-ultra", "mistral-large", "nemotron-3-super", "nemotron-3.5", "deepseek", "gemma", "nano"];

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

  /** Who would write a brain now: the free models with the NVIDIA key, and the paid lead when it is on. */
  teamStatus() {
    const ens = this.ai.ensemble;
    if (!ens) return { free: [], lead: null };
    const r = ens.roster();
    return { free: r.free.map((a) => a.name), lead: r.lead ? `${r.lead.name} (${r.lead.company})` : null };
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
   * Every free model writes its version in parallel; one model merges them. The paid lead joins
   * (and merges) when the paid model is switched on in the AI settings and today's paid runs are
   * not used up (the same daily cap as AI Live / AI Research).
   */
  async refine(draft, skipId = null) {
    const ai = this.ai;
    const ens = ai.ensemble;
    if (!ens) throw new AiError("The AI team is not available on this server.", "not_configured", 409);
    const roster = ens.roster();
    const st = ens._state();
    const today = istDate(ai.now());
    if (st.day.date !== today) st.day = { date: today, paid: 0 };
    let lead = roster.lead;
    if (lead && st.day.paid >= roster.settings.paidDailyCap) lead = null;
    const writers = [...(lead ? [lead] : []), ...roster.free];
    if (!writers.length) throw new AiError("No AI key is saved for the AI team. Save the free NVIDIA key (or a paid key) on the AI page, or save the brain without refining.", "not_configured", 409);

    const others = this._load()
      .brains.filter((b) => b.id !== skipId)
      .map((b) => ({ title: b.title, scopes: b.scopes, text: b.text.slice(0, 600) }));
    const skills = ai.playbook ? ai.playbook.read().slice(0, 5000) : "";
    const user = `The owner's draft:\n${JSON.stringify({ title: draft.title, text: draft.text, scopes: draft.scopes })}\n\nExisting brains:\n${JSON.stringify(others)}\n\nThe trading-skills file (the core rules, first part):\n${skills}\n\nWrite your version.`;
    const sec = roster.settings.deadlineSec;
    const versions = await Promise.all(
      writers.map(async (a) => {
        const t0 = Date.now();
        try {
          const spec = { providerId: a.provider, apiKey: ai._key(a.provider), model: a.model, timeoutMs: (a.lead ? Math.max(sec, 120) : sec) * 1000, repair: false };
          const client = ai.engine ? ai.engine.client(spec, { feature: "brains-team", brains: false }) : makeClient({ ...spec, fetchImpl: ai.fetch });
          const r = await client.ask({ system: REFINE_SYSTEM, user, schema: VERSION_SCHEMA, maxTokens: 3000, effort: "low" });
          const v = r.data || {};
          return { id: a.id, name: a.name, company: a.company, free: a.free, lead: Boolean(a.lead), ok: true, title: str(v.title, MAX_TITLE), text: str(v.text, MAX_TEXT), scopes: cleanScopes(v.scopes), conflicts: (v.conflicts || []).map((x) => str(x, 300)).slice(0, 6), rationale: str(v.rationale, 400), ms: Date.now() - t0, usage: r.usage };
        } catch (err) {
          return { id: a.id, name: a.name, company: a.company, free: a.free, lead: Boolean(a.lead), ok: false, error: err && err.message ? err.message : "failed", ms: Date.now() - t0 };
        }
      })
    );
    const good = versions.filter((v) => v.ok && v.title && v.text.length >= 10);
    if (lead && versions.some((v) => v.lead && v.ok)) {
      const s2 = ens._state();
      if (s2.day.date !== today) s2.day = { date: today, paid: 0 };
      s2.day.paid += 1;
      ens._save(s2);
    }
    if (!good.length) throw new AiError(`Every model of the AI team failed or timed out (${versions.map((v) => `${v.name}: ${v.error || "no answer"}`).join("; ").slice(0, 400)}). Save the brain as written, or try again.`, "unavailable", 502);

    // one model merges: the paid lead when it answered, else the strongest free model that did
    const pick = (lead && good.find((v) => v.lead)) || MERGE_ORDER.map((k) => good.find((v) => v.id.toLowerCase().includes(k))).find(Boolean) || good[0];
    const mergeWith = writers.find((a) => a.id === pick.id);
    let final = null;
    let mergedBy = null;
    if (good.length > 1 && mergeWith) {
      try {
        const spec = { providerId: mergeWith.provider, apiKey: ai._key(mergeWith.provider), model: mergeWith.model, timeoutMs: Math.max(sec, 90) * 1000, repair: false };
        const client = ai.engine ? ai.engine.client(spec, { feature: "brains-team", brains: false }) : makeClient({ ...spec, fetchImpl: ai.fetch });
        const r = await client.ask({ system: MERGE_SYSTEM, user: `The owner's draft:\n${JSON.stringify({ title: draft.title, text: draft.text, scopes: draft.scopes })}\n\nThe versions:\n${JSON.stringify(good.map((v) => ({ by: v.name, title: v.title, text: v.text, scopes: v.scopes, conflicts: v.conflicts, rationale: v.rationale })))}\n\nExisting brains:\n${JSON.stringify(others)}\n\nWrite the final version.`, schema: MERGE_SCHEMA, maxTokens: 3000, effort: "low" });
        const m = r.data || {};
        if (str(m.title, MAX_TITLE) && str(m.text, MAX_TEXT).length >= 10) {
          final = { title: str(m.title, MAX_TITLE), text: str(m.text, MAX_TEXT), scopes: cleanScopes(m.scopes), conflicts: (m.conflicts || []).map((x) => str(x, 300)).slice(0, 6), notes: str(m.notes, 600) };
          mergedBy = mergeWith.name;
        }
      } catch (_) {
        final = null; // fall back to the strongest single version below
      }
    }
    if (!final) final = { title: pick.title, text: pick.text, scopes: pick.scopes, conflicts: pick.conflicts, notes: good.length > 1 ? `The merge step did not answer, so ${pick.name}'s version is used.` : `Only ${pick.name} answered.` };
    return { final, versions, models: good.map((v) => v.name), mergedBy: mergedBy || pick.name, lead: lead ? lead.name : null };
  }

  /** What the AI Engine page shows the superadmin: every feature's real instructions. */
  prompts() {
    return FEATURES.map((f) => ({ ...f, prompts: prompts.get(f.id) || [], brains: this.forFeature(f.id) }));
  }
}

module.exports = { Brains, FEATURES, FEATURE_IDS, register, featureOf, cleanScopes, REFINE_SYSTEM, MERGE_SYSTEM, providerOf };
