"use strict";
// The AI Engine: the one door every AI feature goes through to reach a model.
//
//   - ONE DOOR. The strategist, co-pilot, decision, research, coach, reviews, debrief, AI Live /
//     AI Research analysts, the AI team that writes brains, TradeAI and the WhatsApp updates all get
//     their model client here (the default model, or a fallback when it fails).
//   - ONE SET OF BRAINS. On the way out, every request gets the owner's AI brains for the feature
//     its instructions belong to (brains.js) — the same brains, read at the moment of the request, so
//     an edit reaches every feature at once.
//   - SHARED LANES. Requests that use the same key share a fair number of calls in flight. When several features use the models at the same time —
//     TradeAI, AI Live, WhatsApp, the co-pilot — the extra requests wait their turn for a moment
//     instead of tripping the provider's rate limit. Waiting is a promise queue, not a timer.
//   - NO CREDIT SPENT TWICE. The very same request (same model, same instructions with their brains,
//     same data, same schema) within 15 minutes gets the answer already paid for; two identical
//     requests at the same moment share one call. The board counts the calls and tokens saved. A
//     caller that needs a new answer (Retry, Rewrite) passes { fresh: true }.
//   - ONE LIVE BOARD. What is running now (per feature and model, and what is waiting), today's
//     calls, failures, tokens and time per feature, and the last calls — shown on the AI Engine page.
//
// No timers and no broker here (a test checks the whole AI folder).

const crypto = require("node:crypto");
const { makeClient, providerOf } = require("./providers");
const { featureOf, FEATURES } = require("./brains");

const NAME = "ai/engine.json";
const LANES = { anthropic: 6 }; // calls in flight per key; every other key: DEFAULT_LANE
const DEFAULT_LANE = 6;
const RECENT = 40;
const CACHE_MS = 15 * 60000; // an identical request within this reuses the answer already paid for
const CACHE_MAX = 300;

// requests that are not one of the brains' features, but are still counted on the board
const EXTRA = new Map(); // system prompt text → { id, name }
const EXTRA_NAMES = { "brains-team": "AI refining a brain", other: "Other requests" };
/** Give a system prompt a name on the board without giving it brains (the web searches, for instance). */
function tag(system, id, name) {
  if (typeof system === "string" && id) {
    EXTRA.set(system, { id, name: name || id });
    EXTRA_NAMES[id] = name || id;
  }
}
const nameOf = (id) => (FEATURES.find((f) => f.id === id) || {}).name || EXTRA_NAMES[id] || id;
const istDate = (ms) => new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10);

class Engine {
  constructor(ai) {
    this.ai = ai;
    this.running = new Map(); // id → { feature, model, provider, kind, queuedAt, startedAt }
    this.lanes = new Map(); // key group → { busy, queue: [resolve] }
    this.seq = 0;
    const saved = ai.docs ? ai.docs.read(NAME, null) : null;
    this.day = saved && saved.day && saved.day.date ? saved.day : { date: "", by: {} };
    this.recent = Array.isArray(saved && saved.recent) ? saved.recent.slice(0, RECENT) : [];
    this.startedAt = new Date(ai.now ? ai.now() : Date.now()).toISOString();
    this.cache = new Map(); // request key → { at, r }
    this.inflight = new Map(); // request key → promise (identical requests at the same moment share one call)
  }

  _key(parts) {
    return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  }

  /** An answer served from the cache: counted on the board as a call (and its tokens) saved. */
  _saved(feature, usage) {
    const now = this.ai.now ? this.ai.now() : Date.now();
    const date = istDate(now);
    if (this.day.date !== date) this.day = { date, by: {} };
    const sv = this.day.saved || { calls: 0, input: 0, output: 0, by: {} };
    sv.calls += 1;
    if (usage) {
      sv.input += usage.input_tokens || usage.inputTokens || usage.prompt_tokens || 0;
      sv.output += usage.output_tokens || usage.outputTokens || usage.completion_tokens || 0;
    }
    sv.by[feature] = (sv.by[feature] || 0) + 1;
    this.day.saved = sv;
    try {
      if (this.ai.docs) this.ai.docs.write(NAME, { day: this.day, recent: this.recent });
    } catch (_) {
      /* the board is a convenience */
    }
  }

  /* ------------------------------------------------------------------------------ lanes */
  laneOf(providerId) {
    return providerOf(providerId) ? providerId : "anthropic";
  }
  limitOf(lane) {
    return LANES[lane] || DEFAULT_LANE;
  }
  async _slot(lane) {
    let l = this.lanes.get(lane);
    if (!l) {
      l = { busy: 0, queue: [] };
      this.lanes.set(lane, l);
    }
    if (l.busy < this.limitOf(lane)) l.busy += 1;
    else await new Promise((resolve) => l.queue.push(resolve)); // the slot is handed over when one frees
    return () => {
      const next = l.queue.shift();
      if (next) next();
      else l.busy -= 1;
    };
  }

  /* ---------------------------------------------------------------------------- clients */
  /**
   * A model client from the engine.
   * @param spec  { providerId, apiKey, model, timeoutMs, repair } (fetch comes from the AI service)
   * @param opts  { feature: the board's name for requests whose instructions are not registered,
   *                brains: false for the requests that write brains themselves }
   */
  client(spec, opts = {}) {
    const raw = makeClient({ fetchImpl: this.ai.fetch, ...spec });
    return this.wrap(raw, { ...opts, providerId: spec.providerId, model: spec.model });
  }

  /** Any client, sent through the engine: brains on the way out, a lane, and the board. */
  wrap(client, { feature = null, brains = true, providerId = null, model = null } = {}) {
    if (!client || client.__engine) return client;
    const w = Object.create(client);
    const compose = brains && !client.__brains;
    w.__engine = true;
    w.__brains = Boolean(client.__brains || brains);
    const pid = providerId || client.provider || "anthropic";
    const run = async (kind, args, fn) => {
      const system = (args && args.system) || "";
      const extra = EXTRA.get(system);
      const feat = featureOf(system) || (extra && extra.id) || feature || "other";
      // AI credit protection: a request nobody asked for goes no further (the answer already held, above, is still served)
      if (this.ai.guard) this.ai.guard.check(nameOf(feat));
      const id = ++this.seq;
      const entry = { id, feature: feat, model: model || client.model || "", provider: pid, kind, queuedAt: Date.now(), startedAt: null };
      this.running.set(id, entry);
      let release = null;
      try {
        release = await this._slot(this.laneOf(pid));
        entry.startedAt = Date.now();
        const r = await fn(args || {});
        this._done(entry, true, r && r.usage);
        return r;
      } catch (err) {
        this._done(entry, false, null, err);
        throw err;
      } finally {
        if (release) release();
        this.running.delete(id);
      }
    };
    w.ask = async (args = {}) => {
      // subject: { symbol, last, by } — what the request is about, for the shared research (never sent to the model)
      const { fresh = false, subject = null, ...a } = args || {};
      // the owner's brains and the desk's knowledge base for this feature go with every request
      const sent = compose && this.ai.brains ? { ...a, system: this.ai.brains.compose(a.system || "") + (typeof this.ai.brains.knowledgeFor === "function" ? this.ai.brains.knowledgeFor(a.system || "") : "") } : a;
      const key = this._key([pid, model || client.model || "", sent.system || "", sent.user || "", sent.schema || null]);
      const now = Date.now();
      const hit = this.cache.get(key);
      if (!fresh && hit && now - hit.at < CACHE_MS) {
        const extra = EXTRA.get(a.system || "");
        this._saved(featureOf(a.system || "") || (extra && extra.id) || feature || "other", hit.r && hit.r.usage);
        return { ...hit.r, cached: true, cachedAt: new Date(hit.at).toISOString() };
      }
      if (!fresh && this.inflight.has(key)) return this.inflight.get(key);
      const p = run("ask", a, () => client.ask(sent)).then((r) => {
        // what was just paid for is kept where every other feature can read it (ai/shared.js)
        if (this.ai.shared) {
          try {
            const extra = EXTRA.get(a.system || "");
            this.ai.shared.capture(featureOf(a.system || "") || (extra && extra.id) || feature || "other", a, r, subject);
          } catch (_) {
            /* sharing never fails a request */
          }
        }
        this.cache.set(key, { at: Date.now(), r });
        if (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value);
        return r;
      });
      this.inflight.set(key, p);
      try {
        return await p;
      } finally {
        this.inflight.delete(key);
      }
    };
    if (typeof client.search === "function") w.search = (args = {}) => run("search", args, (a) => client.search(a));
    return w;
  }

  /* ------------------------------------------------------------------------------ board */
  _done(entry, ok, usage, err) {
    const now = this.ai.now ? this.ai.now() : Date.now();
    const date = istDate(now);
    if (this.day.date !== date) this.day = { date, by: {} };
    const ms = Date.now() - (entry.startedAt || entry.queuedAt);
    const waitMs = (entry.startedAt || Date.now()) - entry.queuedAt;
    const g = this.day.by[entry.feature] || { calls: 0, ok: 0, failed: 0, input: 0, output: 0, ms: 0, waitMs: 0, models: {}, last: null };
    g.calls += 1;
    g[ok ? "ok" : "failed"] += 1;
    if (usage) {
      g.input += usage.input_tokens || usage.inputTokens || usage.prompt_tokens || 0;
      g.output += usage.output_tokens || usage.outputTokens || usage.completion_tokens || 0;
    }
    g.ms += ms;
    g.waitMs += waitMs;
    const m = entry.model || entry.provider;
    g.models[m] = (g.models[m] || 0) + 1;
    g.last = new Date(now).toISOString();
    this.day.by[entry.feature] = g;
    this.recent.unshift({ at: g.last, feature: entry.feature, model: m, provider: entry.provider, kind: entry.kind, ok, ms, waitMs, error: ok ? undefined : String((err && err.message) || "failed").slice(0, 160) });
    this.recent = this.recent.slice(0, RECENT);
    try {
      if (this.ai.docs) this.ai.docs.write(NAME, { day: this.day, recent: this.recent });
    } catch (_) {
      /* the board is a convenience: a failed write never fails a request */
    }
  }

  /** What the AI Engine page shows: the live board. */
  status() {
    const now = Date.now();
    const brains = this.ai.brains ? this.ai.brains._load().brains : [];
    const ids = [...new Set([...FEATURES.map((f) => f.id), ...Object.keys(this.day.by)])];
    return {
      at: new Date(this.ai.now ? this.ai.now() : now).toISOString(),
      since: this.startedAt,
      running: [...this.running.values()].map((e) => ({ feature: e.feature, name: nameOf(e.feature), model: e.model || e.provider, provider: e.provider, kind: e.kind, waiting: !e.startedAt, sec: Math.round((now - (e.startedAt || e.queuedAt)) / 1000) })),
      lanes: [...this.lanes.entries()].map(([lane, l]) => ({ lane, busy: l.busy, waiting: l.queue.length, limit: this.limitOf(lane) })),
      today: {
        date: this.day.date,
        features: ids.map((id) => {
          const g = this.day.by[id];
          const f = FEATURES.find((x) => x.id === id);
          return { id, name: nameOf(id), trigger: f ? f.trigger : "", brains: brains.filter((b) => b.enabled !== false && (b.scopes.includes("all") || b.scopes.includes(id))).length, calls: g ? g.calls : 0, ok: g ? g.ok : 0, failed: g ? g.failed : 0, input: g ? g.input : 0, output: g ? g.output : 0, avgSec: g && g.calls ? Math.round(g.ms / g.calls / 100) / 10 : null, avgWaitSec: g && g.calls ? Math.round(g.waitMs / g.calls / 100) / 10 : null, models: g ? g.models : {}, last: g ? g.last : null };
        }),
      },
      recent: this.recent.map((r) => ({ ...r, name: nameOf(r.feature) })),
      // answers reused instead of paid for again today (identical requests within 15 minutes)
      saved: this.day.saved ? { calls: this.day.saved.calls, input: this.day.saved.input, output: this.day.saved.output, by: Object.entries(this.day.saved.by || {}).map(([id, n]) => ({ id, name: nameOf(id), calls: n })) } : { calls: 0, input: 0, output: 0, by: [] },
      core: { brainsOn: brains.filter((b) => b.enabled !== false).length, brains: brains.length, skillsChars: this.ai.playbook ? this.ai.playbook.read().length : 0, lanes: { anthropic: LANES.anthropic, other: DEFAULT_LANE } },
    };
  }
}

module.exports = { Engine, tag, LANES, DEFAULT_LANE };
