"use strict";
// A mixture of the FREE NVIDIA-hosted models, with fallback — so an answer always comes back.
//
//   1. Mixture: the strongest free models (up to `width`) answer the same question in parallel.
//   2. Merge: the strongest model that answered merges their answers into one (or, with one answer,
//      that answer is used as it is).
//   3. Fallback, one by one: if none of them answered, the remaining free models are tried in turn,
//      then — only when `allowPaid` and the paid model is switched on — the paid lead.
//   4. If every model fails, the caller gets { data: null } and shows the desk's own arithmetic.
//
// Used by TradeAI and by the WhatsApp updates. Every client comes from the AI Engine (engine.js), so
// it carries the owner's AI brains for its feature and shares the free models' lane with every other
// feature. No timers, no broker.

const { makeClient } = require("./providers");

// strongest first (by catalogue id fragments)
const STRENGTH = ["nemotron-3-ultra", "mistral-large", "nemotron-3-super", "nemotron-3.5", "deepseek", "gemma", "nano"];
const rankOf = (a) => {
  const i = STRENGTH.findIndex((k) => a.id.toLowerCase().includes(k));
  return i < 0 ? STRENGTH.length : i;
};

/** The free models switched on (strongest first), and the paid lead when it is on. */
function team(ai) {
  const r = ai.ensemble.roster();
  return { free: r.free.slice().sort((a, b) => rankOf(a) - rankOf(b)), lead: r.lead, settings: r.settings };
}

function clientFor(ai, a, timeoutMs) {
  const spec = { providerId: a.provider, apiKey: ai._key(a.provider), model: a.model, timeoutMs, repair: false };
  if (ai.engine) return ai.engine.client(spec); // the AI Engine: brains, the shared lane, the live board
  const raw = makeClient({ ...spec, fetchImpl: ai.fetch });
  return ai.brains ? ai.brains.wrap(raw) : raw;
}

/**
 * @param opts { system, user, schema, maxTokens, width = 3, timeoutSec, merge: { system, schema, build(answers) → user } | null,
 *               allowPaid = false, onStep(label) }
 * @returns { data, by, mergedBy, answers: [{ name, ok, ms, error }], tried, fallback, usage }
 */
async function askMixture(ai, opts) {
  const { system, user, schema, maxTokens = 3000, width = 3, merge = null, allowPaid = false, onStep = () => {}, judge: judgeModel = null } = opts;
  const t = team(ai);
  const sec = opts.timeoutSec || t.settings.deadlineSec || 75;
  const tried = [];
  const usage = { input: 0, output: 0 };
  const add = (u) => {
    if (!u) return;
    usage.input += u.input_tokens || u.inputTokens || u.prompt_tokens || 0;
    usage.output += u.output_tokens || u.outputTokens || u.completion_tokens || 0;
  };
  const ask = async (a, sys, usr, sch, tok) => {
    const t0 = Date.now();
    try {
      const r = await clientFor(ai, a, (a.lead ? Math.max(sec, 120) : sec) * 1000).ask({ system: sys, user: usr, schema: sch, maxTokens: tok, effort: "low" });
      add(r.usage);
      tried.push({ id: a.id, name: a.name, ok: true, ms: Date.now() - t0, paid: Boolean(a.lead) });
      return { a, data: r.data };
    } catch (err) {
      tried.push({ id: a.id, name: a.name, ok: false, ms: Date.now() - t0, paid: Boolean(a.lead), error: err && err.message ? err.message.slice(0, 160) : "failed" });
      return null;
    }
  };

  // 1. the mixture
  const first = t.free.slice(0, Math.max(1, width));
  let answers = [];
  if (first.length) {
    onStep(`${first.length} free model${first.length === 1 ? "" : "s"} reading: ${first.map((a) => a.name).join(", ")}`);
    answers = (await Promise.all(first.map((a) => ask(a, system, user, schema, maxTokens)))).filter(Boolean);
  }
  // 3. fallback, one by one: the other free models, then the paid lead when allowed
  let fallback = false;
  if (!answers.length) {
    const rest = [...t.free.slice(first.length), ...(allowPaid && t.lead ? [t.lead] : [])];
    for (const a of rest) {
      fallback = true;
      onStep(`Falling back to ${a.name}…`);
      const r = await ask(a, system, user, schema, maxTokens);
      if (r) {
        answers = [r];
        break;
      }
    }
  }
  if (!answers.length) return { data: null, by: [], mergedBy: null, answers: tried, tried, fallback, usage };

  // 2. the merge
  if (answers.length === 1 || !merge) {
    const best = answers.slice().sort((x, y) => rankOf(x.a) - rankOf(y.a))[0];
    return { data: best.data, by: answers.map((x) => x.a.name), mergedBy: answers.length === 1 ? null : best.a.name, answers: tried, tried, fallback, usage, all: answers.map((x) => ({ name: x.a.name, data: x.data })) };
  }
  const judge = answers.slice().sort((x, y) => rankOf(x.a) - rankOf(y.a))[0];
  // the paid lead merges when the caller hands it over (paid and free in combination); else the strongest free model
  const merger = judgeModel || judge.a;
  onStep(`${merger.name} is merging ${answers.length} answers`);
  const m = await ask(merger, merge.system, merge.build(answers.map((x) => ({ by: x.a.name, data: x.data }))), merge.schema || schema, maxTokens + 1000);
  if (m && m.data) return { data: m.data, by: answers.map((x) => x.a.name), mergedBy: merger.name, answers: tried, tried, fallback, usage, all: answers.map((x) => ({ name: x.a.name, data: x.data })) };
  return { data: judge.data, by: answers.map((x) => x.a.name), mergedBy: null, answers: tried, tried, fallback, usage, all: answers.map((x) => ({ name: x.a.name, data: x.data })) };
}

/**
 * ONE model at a time: the candidates are asked in order and the first answer is used; the next is
 * asked only when one fails. The fast way for TradeAI — no parallel calls, no merge.
 * @param candidates [{ id, name, provider, model, lead? }] in the order to try
 * @returns { data, by, mergedBy: null, answers, tried, fallback, usage }
 */
async function askOne(ai, candidates, opts) {
  const { system, user, schema, maxTokens = 2500, onStep = () => {} } = opts;
  const sec = opts.timeoutSec || 60;
  const tried = [];
  const usage = { input: 0, output: 0 };
  for (let i = 0; i < candidates.length; i += 1) {
    const a = candidates[i];
    onStep(i === 0 ? `${a.name}${a.lead ? " (paid)" : ""} is answering` : `Falling back to ${a.name}${a.lead ? " (paid)" : ""}…`);
    const t0 = Date.now();
    try {
      const r = await clientFor(ai, a, (a.lead ? Math.max(sec, 90) : sec) * 1000).ask({ system, user, schema, maxTokens, effort: "low" });
      const u = r.usage || {};
      usage.input += u.input_tokens || u.inputTokens || u.prompt_tokens || 0;
      usage.output += u.output_tokens || u.outputTokens || u.completion_tokens || 0;
      tried.push({ id: a.id, name: a.name, ok: true, ms: Date.now() - t0, paid: Boolean(a.lead) });
      return { data: r.data, by: [a.name], mergedBy: null, answers: tried, tried, fallback: i > 0, usage };
    } catch (err) {
      tried.push({ id: a.id, name: a.name, ok: false, ms: Date.now() - t0, paid: Boolean(a.lead), error: err && err.message ? err.message.slice(0, 160) : "failed" });
    }
  }
  return { data: null, by: [], mergedBy: null, answers: tried, tried, fallback: candidates.length > 1, usage };
}

module.exports = { askMixture, askOne, team, rankOf, clientFor };
