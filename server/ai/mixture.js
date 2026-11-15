"use strict";
// Asking the default model, with fallback — so an answer always comes back.
//
//   1. The default model answers (Claude Sonnet 5.5 unless the owner picked another on the AI page).
//   2. Fallback, one by one: if it fails and the AI page's fallback switch is on, each other company
//      whose key is saved is tried in turn, on its own chosen model.
//   3. If every model fails, the caller gets { data: null } and shows the desk's own arithmetic.
//
// Used by TradeAI, the social digest and the WhatsApp updates. Every client comes from the AI Engine
// (engine.js), so it carries the owner's AI brains for its feature and shares its company's lane with
// every other feature. No timers, no broker.

const { makeClient } = require("./providers");

/** The models to ask, in order: the default model first, then the fallbacks (ai.modelChain()). */
function team(ai) {
  const models = typeof ai.modelChain === "function" ? ai.modelChain() : [];
  const settings = ai.ensemble && typeof ai.ensemble.settings === "function" ? ai.ensemble.settings() : {};
  return { models, lead: models[0] || null, settings };
}

function clientFor(ai, a, timeoutMs) {
  const spec = { providerId: a.provider, apiKey: ai._key(a.provider), model: a.model, timeoutMs, repair: false };
  if (ai.engine) return ai.engine.client(spec); // the AI Engine: brains, the shared lane, the live board
  const raw = makeClient({ ...spec, fetchImpl: ai.fetch });
  return ai.brains ? ai.brains.wrap(raw) : raw;
}

/**
 * ONE model at a time: the candidates are asked in order and the first answer is used; the next is
 * asked only when one fails.
 * @param candidates [{ id, name, provider, model }] in the order to try
 * @param opts { system, user, schema, maxTokens, effort = "low", timeoutSec = 60, onStep(label) }
 * @returns { data, by, mergedBy: null, answers, tried, fallback, usage }
 */
async function askOne(ai, candidates, opts) {
  const { system, user, schema, maxTokens = 2500, effort = "low", onStep = () => {} } = opts;
  const sec = opts.timeoutSec || 60;
  const tried = [];
  const usage = { input: 0, output: 0 };
  for (let i = 0; i < candidates.length; i += 1) {
    const a = candidates[i];
    onStep(i === 0 ? `${a.name} is answering` : `Falling back to ${a.name}…`);
    const t0 = Date.now();
    try {
      const r = await clientFor(ai, a, sec * 1000).ask({ system, user, schema, maxTokens, effort, fresh: Boolean(opts.fresh) });
      const u = r.usage || {};
      usage.input += u.input_tokens || u.inputTokens || u.prompt_tokens || 0;
      usage.output += u.output_tokens || u.outputTokens || u.completion_tokens || 0;
      tried.push({ id: a.id, name: a.name, ok: true, ms: Date.now() - t0, ...(r.cached ? { cached: true } : {}) });
      return { data: r.data, by: [a.name], mergedBy: null, answers: tried, tried, fallback: i > 0, usage };
    } catch (err) {
      tried.push({ id: a.id, name: a.name, ok: false, ms: Date.now() - t0, error: err && err.message ? err.message.slice(0, 160) : "failed" });
    }
  }
  return { data: null, by: [], mergedBy: null, answers: tried, tried, fallback: candidates.length > 1, usage };
}

/**
 * The default model, then the fallbacks: the one way every AI feature without its own client asks.
 * @param opts { system, user, schema, maxTokens = 3000, effort, timeoutSec, onStep }
 * @returns as askOne, plus `all: [{ name, data }]` (the one answer, when there is one)
 */
async function askDefault(ai, opts) {
  const t = team(ai);
  const sec = opts.timeoutSec || t.settings.deadlineSec || 90;
  const r = await askOne(ai, t.models, { maxTokens: 3000, ...opts, timeoutSec: sec });
  return { ...r, all: r.data ? [{ name: r.by[0], data: r.data }] : [] };
}

module.exports = { askDefault, askOne, team, clientFor };
