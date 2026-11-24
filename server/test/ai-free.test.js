"use strict";
// NVIDIA's free hosted models as the lead (26 Nov 2026): the one-time setup, free-first routing, the automatic fallback to a paid
// company, searches going to the company that can search, and the credit guard letting only FREE requests run on their own.
// Every company is FAKED — no network, no real key, no cost.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { AiService } = require("../ai/service");
const { FREE_PREFERENCE } = require("../ai/providers");

const NV_KEY = "nvapi-TESTONLYtestonlyTESTONLY1234567890";
const OA_KEY = "sk-proj-TESTONLYtestonlyTESTONLY1234567890";
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
const SECRETS = { encrypt: (x) => `enc:${Buffer.from(x).toString("base64")}`, decrypt: (x) => Buffer.from(x.slice(4), "base64").toString() };
const SCHEMA = { type: "object", additionalProperties: false, required: ["mood"], properties: { mood: { type: "string" } } };
const chat = (content, model = "served") => json(200, { model, choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20 } });

/** NVIDIA and OpenAI, faked: `nv.works` says which NVIDIA models answer, `nv.fail` says how the others fail. */
function world({ list = null, works = null } = {}) {
  const w = { requests: [], nv: { list, works, fail: 404, answers: 0 }, oa: { calls: 0, searches: 0 } };
  w.fetch = async (url, init = {}) => {
    const u = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    const auth = new Headers(init.headers || {}).get("authorization");
    w.requests.push({ url: u, method: init.method || "GET", model: body && body.model, auth });
    if (u.startsWith("https://integrate.api.nvidia.com/v1/models")) {
      if (auth !== `Bearer ${NV_KEY}`) return json(401, { error: { message: "bad key" } });
      return json(200, { data: (w.nv.list || FREE_PREFERENCE).map((id) => ({ id })) });
    }
    if (u.startsWith("https://integrate.api.nvidia.com/v1/chat/completions")) {
      if (auth !== `Bearer ${NV_KEY}`) return json(401, { error: { message: "bad key" } });
      const ok = !w.nv.works || w.nv.works.includes(body.model);
      if (!ok) return json(w.nv.fail, { error: { message: "model unavailable" } });
      w.nv.answers += 1;
      return chat(JSON.stringify({ mood: `free:${body.model}` }), body.model);
    }
    if (u.startsWith("https://api.openai.com/v1/chat/completions")) {
      w.oa.calls += 1;
      return chat(JSON.stringify({ mood: `paid:${body.model}` }), body.model);
    }
    if (u.startsWith("https://api.openai.com/v1/responses")) {
      w.oa.searches += 1;
      return json(200, { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "Nifty is up on firm global cues.", annotations: [] }] }], usage: { input_tokens: 10, output_tokens: 10 } });
    }
    return json(404, { error: { message: `no fake for ${u}` } });
  };
  return w;
}

function boot(w, settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-aifree-"));
  const store = { data: { settings }, update(fn) { fn(this.data); } };
  const ai = new AiService({ dir, store, secrets: SECRETS, market: {}, fetchImpl: w.fetch, log: { log() {} } });
  return { ai, store };
}

test("the one-time setup: one NVIDIA key → the best free model that answers, a second from another publisher, a paid fallback named", async () => {
  // the key can use these; the very best one is not among them, and the second best is down
  const w = world({ list: ["deepseek-ai/deepseek-v4-pro", "nvidia/nemotron-3-super-120b-a12b", "meta/llama-3.3-70b-instruct", "nvidia/nv-embedqa-e5-v5"], works: ["nvidia/nemotron-3-super-120b-a12b", "meta/llama-3.3-70b-instruct"] });
  const { ai, store } = boot(w);
  ai.setSettings({ provider: "openai", apiKey: OA_KEY, use: false });
  const st = await ai.setupFree({ apiKey: NV_KEY, fallbackProvider: "openai" });
  assert.equal(st.provider, "nvidia");
  assert.equal(st.model, "nvidia/nemotron-3-super-120b-a12b", "the strongest of the preference that is listed and answers");
  assert.equal(st.setup.backup.model, "meta/llama-3.3-70b-instruct", "another publisher's model stands in");
  assert.deepEqual([st.setup.done, st.setup.fallbackProvider, st.setup.fallbackReady, st.setup.freeLead, st.setup.freeAuto], [true, "openai", true, true, true]);
  assert.deepEqual(st.chain.map((m) => `${m.provider}|${m.model}`), ["nvidia|nvidia/nemotron-3-super-120b-a12b", "nvidia|meta/llama-3.3-70b-instruct", "openai|gpt-5.6-sol"]);
  assert.deepEqual(st.chain.map((m) => m.free), [true, true, false]);
  // no credit was used: nothing went to a paid company, and the key is nowhere in clear text
  assert.ok(w.requests.every((r) => r.url.includes("nvidia.com")));
  assert.ok(!JSON.stringify(store.data).includes(NV_KEY) && !JSON.stringify(st).includes(NV_KEY));
  assert.ok(!w.requests.some((r) => r.model === "nvidia/nv-embedqa-e5-v5"), "an embedding model is never tested");
});

test("setup with a wrong key says so and changes nothing; with no model answering it says that too", async () => {
  const w = world();
  const { ai, store } = boot(w);
  await assert.rejects(ai.setupFree({ apiKey: "nvapi-WRONGwrongWRONGwrong1234567890" }), /rejected the API key/);
  assert.notEqual(store.data.settings.aiProvider, "nvidia");
  assert.equal(store.data.settings.aiSetup, undefined);
  await assert.rejects(ai.setupFree({}), /Paste your NVIDIA API key first/);
  const w2 = world({ works: [] });
  const b = boot(w2);
  await assert.rejects(b.ai.setupFree({ apiKey: NV_KEY }), /None of NVIDIA's free models answered/);
  await assert.rejects(boot(world()).ai.setupFree({ apiKey: NV_KEY, fallbackProvider: "nvidia" }), /Pick a paid company/);
});

test("free first, and the fallback is automatic: a failing free model hands the same request to the next, then to the paid company, with no one choosing", async () => {
  const w = world();
  const { ai } = boot(w);
  ai.setSettings({ provider: "openai", apiKey: OA_KEY, use: false });
  await ai.setupFree({ apiKey: NV_KEY, fallbackProvider: "openai" });
  const first = ai.modelChain()[0].model;
  const second = ai.modelChain()[1].model;
  // all well: the best free model answers and nothing paid is touched
  let r = await ai._client().ask({ system: "s", user: "u1", schema: SCHEMA, maxTokens: 100 });
  assert.equal(r.data.mood, `free:${first}`);
  assert.equal(w.oa.calls, 0);
  // the lead is rate-limited: the second free model answers the same request
  w.nv.works = [second];
  w.nv.fail = 429;
  r = await ai._client().ask({ system: "s", user: "u2", schema: SCHEMA, maxTokens: 100 });
  assert.equal(r.data.mood, `free:${second}`);
  assert.equal(r.fallbackFrom, first);
  assert.equal(w.oa.calls, 0);
  // both free models are down: the paid company answers
  w.nv.works = [];
  w.nv.fail = 503;
  r = await ai._client().ask({ system: "s", user: "u3", schema: SCHEMA, maxTokens: 100, fresh: true });
  assert.match(r.data.mood, /^paid:/);
  assert.equal(r.fallbackFrom, first);
  assert.equal(w.oa.calls, 1);
  // a model that was just rate-limited steps back: the next request does not wait for it again
  const before = w.requests.length;
  await ai._client().ask({ system: "s", user: "u4", schema: SCHEMA, maxTokens: 100, fresh: true });
  const sent = w.requests.slice(before).filter((x) => x.url.includes("chat/completions")).map((x) => x.model);
  assert.ok(sent[0].startsWith("gpt-"), `the cooling models are tried last (${sent.join(", ")})`);
  assert.ok(ai.status().chain.some((m) => m.cooling));
  // fallback off: the free model's failure is the failure
  ai.setSettings({ fallback: false });
  w.nv.works = [first];
  w.nv.fail = 404;
  ai._cool.clear();
  w.nv.works = [];
  await assert.rejects(ai._client().ask({ system: "s", user: "u5", schema: SCHEMA, maxTokens: 100, fresh: true }), /does not know the selected model|did not accept/);
});

test("what the free models cannot do goes to the paid company by itself: web searches, and the askDefault path of the features that carry their own fallback", async () => {
  const w = world();
  const { ai } = boot(w);
  ai.setSettings({ provider: "openai", apiKey: OA_KEY, use: false });
  await ai.setupFree({ apiKey: NV_KEY, fallbackProvider: "openai" });
  const s = await ai._client().search({ system: "s", user: "what moved Nifty?", maxTokens: 500 });
  assert.match(s.text, /Nifty is up/);
  assert.equal(w.oa.searches, 1);
  assert.equal((await ai._searchClient().search({ system: "s", user: "again" })).text.length > 0, true);
  // without any paid key a search says what is needed
  const lone = boot(world());
  await lone.ai.setupFree({ apiKey: NV_KEY });
  await assert.rejects(lone.ai._client().search({ system: "s", user: "x" }), /no search|search in its API/i);
  // the shared ask-with-fallback (TradeAI, WhatsApp, social) walks the same chain
  const { askDefault } = require("../ai/mixture");
  w.nv.works = [];
  w.nv.fail = 503;
  const r = await askDefault(ai, { system: "s", user: "mix", schema: SCHEMA, maxTokens: 100 });
  assert.match(r.data.mood, /^paid:/);
  assert.equal(r.fallback, true);
});

test("the credit guard: a FREE request may run on its own, a paid one never does; the owner's switch turns the free allowance off", async () => {
  const w = world();
  const { ai } = boot(w);
  ai.setSettings({ provider: "openai", apiKey: OA_KEY, use: false });
  await ai.setupFree({ apiKey: NV_KEY, fallbackProvider: "openai" });
  ai.guard.enforce = true; // as in the running app; this request is not a click
  assert.equal(ai.guard.autoAllowed(), true, "the default model is free, so automatic work may start");
  const r = await ai._client().ask({ system: "s", user: "auto1", schema: SCHEMA, maxTokens: 100 });
  assert.match(r.data.mood, /^free:/);
  // the free model fails: the paid step is refused (no click), so no credit is used
  w.nv.works = [];
  w.nv.fail = 503;
  await assert.rejects(ai._client().ask({ system: "s", user: "auto2", schema: SCHEMA, maxTokens: 100, fresh: true }), (e) => e.code !== "not_asked" || /no credit was used/.test(e.message));
  assert.equal(w.oa.calls, 0, "a paid model was never asked without a click");
  // inside a click the paid fallback may answer
  const viaClick = await ai.guard.run({ click: true }, () => ai._client().ask({ system: "s", user: "click1", schema: SCHEMA, maxTokens: 100, fresh: true }));
  assert.match(viaClick.data.mood, /^paid:/);
  // the owner's switch: free models need a click again
  ai.setSettings({ freeAuto: false });
  w.nv.works = null;
  assert.equal(ai.guard.autoAllowed(), false);
  await assert.rejects(ai._client().ask({ system: "s", user: "auto3", schema: SCHEMA, maxTokens: 100, fresh: true }), /was not asked for this/);
  // wants(): runs at once with a free lead, asks otherwise
  ai.setSettings({ freeAuto: true });
  let ran = 0;
  await ai.guard.wants({ key: "k1", feature: "f" }, async () => { ran += 1; });
  assert.equal(ran, 1);
  // a paid default model: nothing changes for it
  ai.setSettings({ provider: "openai", use: true });
  assert.equal(ai.guard.autoAllowed(), false, "a paid default still needs a click");
});

test("settings: the free backup, the paid fallback company and the free-auto switch are checked and kept", async () => {
  const w = world();
  const { ai } = boot(w);
  ai.setSettings({ provider: "nvidia", apiKey: NV_KEY });
  assert.throws(() => ai.setSettings({ fallbackProvider: "nvidia" }), /Pick a paid company/);
  assert.throws(() => ai.setSettings({ fallbackProvider: "acme" }), /Pick a paid company/);
  assert.throws(() => ai.setSettings({ freeBackup: "not/a-model" }), /Unknown NVIDIA model/);
  const st = ai.setSettings({ fallbackProvider: "gemini", freeBackup: "meta/llama-3.3-70b-instruct", freeAuto: false });
  assert.deepEqual([st.setup.fallbackProvider, st.setup.backup.model, st.setup.freeAuto], ["gemini", "meta/llama-3.3-70b-instruct", false]);
});
