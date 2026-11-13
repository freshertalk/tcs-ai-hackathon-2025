"use strict";
// The AI companies: one key and one model per company, switching without losing keys, the
// request each kind of API is sent, the web-search fallback, and the live model lists.
// Every company is FAKED here — no network, no real key, no cost.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { AiService } = require("../ai/service");
const { PROVIDERS, checkKey, readJson, pickChatModels } = require("../ai/providers");

// not real keys
const KEYS = {
  anthropic: "sk-ant-api03-TESTONLYtestonlyTESTONLY1234567890abcd",
  openai: "sk-proj-TESTONLYtestonlyTESTONLY1234567890",
  gemini: "AIzaTESTONLYtestonlyTESTONLY12345678",
  deepseek: "sk-TESTONLYtestonlyTESTONLY1234567890ab",
  moonshot: "sk-TESTONLYmoonshotTESTONLY1234567890ab",
  nvidia: "nvapi-TESTONLYtestonlyTESTONLY1234567890",
};

const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

/** One fake for every company: records each request and answers by its address. */
function fakeWorld() {
  const f = { requests: [], answers: {} };
  f.fetch = async (url, init = {}) => {
    const u = String(url);
    const headers = new Headers(init.headers || {});
    const body = init.body ? JSON.parse(init.body) : null;
    f.requests.push({ url: u, method: init.method || "GET", auth: headers.get("authorization") || headers.get("x-goog-api-key") || headers.get("x-api-key"), body });
    for (const [pattern, fn] of Object.entries(f.answers)) if (u.includes(pattern)) return fn(body, u);
    return json(404, { error: { message: `no fake for ${u}` } });
  };
  return f;
}

function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-aip-"));
  const store = { data: { settings: {} }, update(fn) { fn(this.data); } };
  const world = fakeWorld();
  const ai = new AiService({ dir, store, secrets: { encrypt: (x) => `enc:${Buffer.from(x).toString("base64")}`, decrypt: (x) => Buffer.from(x.slice(4), "base64").toString() }, market: {}, fetchImpl: world.fetch, log: { log() {} } });
  return { ai, store, world };
}

const SCHEMA = { type: "object", additionalProperties: false, required: ["mood"], properties: { mood: { type: "string" } } };
const chat = (content, extra = {}) => json(200, { model: extra.model || "served", choices: [{ message: { role: "assistant", content }, finish_reason: extra.finish || "stop" }], usage: { prompt_tokens: 120, completion_tokens: 30 } });

test("the catalogue: five paid companies and four FREE NVIDIA-hosted ones, each with models and steps", () => {
  assert.deepEqual(PROVIDERS.map((p) => p.id), ["anthropic", "openai", "gemini", "deepseek", "moonshot", "nvidia", "nv-mistral", "nv-deepseek", "nv-gemma"]);
  assert.deepEqual(PROVIDERS.filter((p) => p.free).map((p) => p.id), ["nvidia", "nv-mistral", "nv-deepseek", "nv-gemma"]);
  for (const p of PROVIDERS.filter((x) => x.free)) {
    assert.equal(p.base, "https://integrate.api.nvidia.com/v1", `${p.id} talks to NVIDIA only`);
    assert.ok(p.models.every((m) => m.free), p.id);
  }
  // the three Nemotron models stay, plus the newer ones asked for
  const ids = PROVIDERS.filter((p) => p.free).flatMap((p) => p.models.map((m) => m.id));
  for (const id of ["nvidia/nemotron-3-super-120b-a12b", "nvidia/nemotron-3-ultra-550b-a55b", "nvidia/nvidia-nemotron-nano-9b-v2", "nvidia/nemotron-3.5-super-vl-120b-a12b", "mistralai/mistral-large-4-1t-a52b", "deepseek-ai/deepseek-v4.1-flash", "google/gemma-4-31b-it"]) assert.ok(ids.includes(id), id);
  for (const p of PROVIDERS) {
    assert.ok(p.models.length > 0, p.id);
    assert.ok(p.steps.length >= 2, p.id);
    assert.match(p.consoleUrl, /^https:\/\//);
  }
  assert.ok(PROVIDERS.find((p) => p.id === "nvidia").models.some((m) => /nemotron/i.test(m.id) && m.free), "a free Nemotron model is offered");
});

test("keys are checked against the company they are saved for", () => {
  for (const [pid, k] of Object.entries(KEYS)) assert.equal(checkKey(pid, k), k, pid);
  assert.throws(() => checkKey("openai", KEYS.anthropic), /looks like an Anthropic key/);
  assert.throws(() => checkKey("anthropic", KEYS.nvidia), /looks like an NVIDIA key/);
  assert.throws(() => checkKey("nvidia", KEYS.deepseek), /start with "nvapi-"/);
  assert.equal(checkKey("nv-gemma", KEYS.nvidia), KEYS.nvidia, "the free companies take the NVIDIA key");
  assert.throws(() => checkKey("nv-mistral", KEYS.anthropic), /looks like an Anthropic key/);
  assert.throws(() => checkKey("anthropic", "sk-ant-admin01-AAAAAAAAAAAAAAAAAAAAAAAA"), /Admin API key/);
  assert.throws(() => checkKey("gemini", "short"), /does not look like a Google Gemini API key/);
  assert.throws(() => checkKey("openai", "sk-has a space in it 1234567890"), /does not look like an OpenAI API key/);
});

test("switching companies keeps every saved key and each company's model; keys are never sent back", () => {
  const { ai, store } = boot();
  ai.setSettings({ provider: "anthropic", apiKey: KEYS.anthropic, model: "claude-sonnet-5-5" });
  ai.setSettings({ provider: "deepseek", apiKey: KEYS.deepseek, model: "deepseek-v4-flash" });
  let st = ai.status();
  assert.equal(st.provider, "deepseek");
  assert.equal(st.providerName, "DeepSeek");
  assert.equal(st.model, "deepseek-v4-flash");
  assert.equal(st.configured, true);

  // back to Anthropic: no key needed again, and its model was remembered
  st = ai.setSettings({ provider: "anthropic" });
  assert.equal(st.provider, "anthropic");
  assert.equal(st.configured, true);
  assert.equal(st.model, "claude-sonnet-5-5");
  assert.equal(st.providers.find((p) => p.id === "deepseek").configured, true);
  assert.equal(st.providers.find((p) => p.id === "deepseek").model, "deepseek-v4-flash");

  // a company without a key can be chosen; the AI is then off until its key is added
  st = ai.setSettings({ provider: "nvidia" });
  assert.equal(st.configured, false);
  assert.equal(st.model, "nvidia/nemotron-3-super-120b-a12b");

  // removing one company's key leaves the others
  ai.setSettings({ provider: "deepseek", clear: true, use: false });
  st = ai.status();
  assert.equal(st.provider, "nvidia", "use:false changes a company without switching to it");
  assert.equal(st.providers.find((p) => p.id === "deepseek").configured, false);
  assert.equal(st.providers.find((p) => p.id === "anthropic").configured, true);

  const text = JSON.stringify(ai.status()) + JSON.stringify(store.data);
  for (const k of Object.values(KEYS)) assert.ok(!text.includes(k), "no key in clear text anywhere");
  assert.ok(st.version >= 4, "every change bumps the version pages watch");

  assert.throws(() => ai.setSettings({ provider: "openai", model: "claude-opus-5-5" }), /Unknown model for this company/);
  assert.throws(() => ai.setSettings({ provider: "acme" }), /Unknown AI company/);
});

test("an older single-key record still works and moves into the per-company fields", () => {
  const { ai, store } = boot();
  store.data.settings = { anthropicApiKeyEnc: `enc:${Buffer.from(KEYS.anthropic).toString("base64")}`, aiModel: "claude-haiku-5-5", aiLastTest: { ok: true, at: "x" } };
  let st = ai.status();
  assert.equal(st.configured, true);
  assert.equal(st.provider, "anthropic");
  assert.equal(st.model, "claude-haiku-5-5");
  assert.equal(st.lastTest.ok, true);
  st = ai.setSettings({ provider: "openai", apiKey: KEYS.openai });
  assert.equal(store.data.settings.anthropicApiKeyEnc, undefined);
  assert.ok(store.data.settings.aiKeys.anthropic);
  assert.equal(st.providers.find((p) => p.id === "anthropic").model, "claude-haiku-5-5");
});

test("OpenAI: chat completions with the answer held to the schema", async () => {
  const { ai, world } = boot();
  ai.setSettings({ provider: "openai", apiKey: KEYS.openai, model: "gpt-5.6-terra" });
  world.answers["api.openai.com/v1/chat/completions"] = () => chat('{"mood":"risk_on"}');
  const r = await ai._client().ask({ system: "sys", user: "hi", schema: SCHEMA, maxTokens: 16000, effort: "high" });
  assert.deepEqual(r.data, { mood: "risk_on" });
  assert.deepEqual(r.usage, { inputTokens: 120, outputTokens: 30, cacheReadTokens: 0 });
  const q = world.requests[0];
  assert.equal(q.auth, `Bearer ${KEYS.openai}`);
  assert.equal(q.body.model, "gpt-5.6-terra");
  assert.equal(q.body.response_format.type, "json_schema");
  assert.equal(q.body.response_format.json_schema.strict, true);
  assert.equal(q.body.max_completion_tokens, 16000);
  assert.equal(q.body.reasoning_effort, "high");
  assert.equal(q.body.messages[0].role, "system");

  // a cut-off answer and a refusal are reported, not parsed
  world.answers["api.openai.com/v1/chat/completions"] = () => chat('{"mood":', { finish: "length" });
  await assert.rejects(ai._client().ask({ system: "s", user: "u", schema: SCHEMA }), /cut off/);
  world.answers["api.openai.com/v1/chat/completions"] = () => json(401, { error: { message: "Incorrect API key provided" } });
  await assert.rejects(ai._client().ask({ system: "s", user: "u", schema: SCHEMA }), /OpenAI rejected the API key/);
});

test("DeepSeek and Moonshot: JSON mode with the schema in the prompt and their answer limits", async () => {
  const { ai, world } = boot();
  ai.setSettings({ provider: "deepseek", apiKey: KEYS.deepseek });
  world.answers["api.deepseek.com/chat/completions"] = () => chat('{"mood":"mixed"}');
  const r = await ai._client().ask({ system: "sys", user: "hi", schema: SCHEMA, maxTokens: 16000 });
  assert.equal(r.data.mood, "mixed");
  const q = world.requests[0];
  assert.deepEqual(q.body.response_format, { type: "json_object" });
  assert.equal(q.body.max_tokens, 8000, "held to DeepSeek's answer limit");
  assert.equal(q.body.reasoning_effort, undefined);
  assert.match(q.body.messages[0].content, /JSON Schema/);

  ai.setSettings({ provider: "moonshot", apiKey: KEYS.moonshot });
  world.answers["api.moonshot.ai/v1/chat/completions"] = () => chat('{"mood":"risk_off"}');
  assert.equal((await ai._client().ask({ system: "s", user: "u", schema: SCHEMA })).data.mood, "risk_off");
  assert.equal(world.requests[1].auth, `Bearer ${KEYS.moonshot}`);
});

test("NVIDIA Nemotron: the schema in the prompt, and the answer read past thinking and code fences", async () => {
  const { ai, world } = boot();
  ai.setSettings({ provider: "nvidia", apiKey: KEYS.nvidia });
  world.answers["integrate.api.nvidia.com/v1/chat/completions"] = () => chat('<think>weighing it up {not json}</think>\nHere it is:\n```json\n{"mood":"risk_on"}\n```');
  const r = await ai._client().ask({ system: "s", user: "u", schema: SCHEMA });
  assert.equal(r.data.mood, "risk_on");
  const q = world.requests[0];
  assert.equal(q.body.model, "nvidia/nemotron-3-super-120b-a12b");
  assert.equal(q.body.response_format, undefined);
  assert.equal(readJson("no json here"), null);
  assert.equal(readJson("[1,2]"), null);
});

test("Gemini: generateContent with JSON output, and web search by grounding", async () => {
  const { ai, world } = boot();
  ai.setSettings({ provider: "gemini", apiKey: KEYS.gemini });
  world.answers[":generateContent"] = (body) =>
    body.tools
      ? json(200, {
          candidates: [{ content: { parts: [{ text: "Nikkei up 1%." }] }, finishReason: "STOP", groundingMetadata: { webSearchQueries: ["nikkei", "gift nifty"], groundingChunks: [{ web: { uri: "https://example.com/a", title: "example.com" } }] } }],
          usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20 },
        })
      : json(200, { candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text: '{"mood":"mixed"}' }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 10, thoughtsTokenCount: 5 } });
  const r = await ai._client().ask({ system: "s", user: "u", schema: SCHEMA, maxTokens: 6000 });
  assert.equal(r.data.mood, "mixed");
  assert.equal(r.usage.outputTokens, 15);
  const q = world.requests[0];
  assert.match(q.url, /\/v1beta\/models\/gemini-pro-latest:generateContent$/);
  assert.equal(q.auth, KEYS.gemini, "the key travels in a header, never in the address");
  assert.ok(!q.url.includes(KEYS.gemini));
  assert.equal(q.body.generationConfig.responseMimeType, "application/json");

  const s = await ai._client().search({ system: "s", user: "u" });
  assert.equal(s.text, "Nikkei up 1%.");
  assert.equal(s.usage.searches, 2);
  assert.deepEqual(s.sources.map((x) => x.url), ["https://example.com/a"]);
  assert.deepEqual(world.requests[1].body.tools, [{ google_search: {} }]);
});

test("OpenAI web search goes through the Responses API, citations kept", async () => {
  const { ai, world } = boot();
  ai.setSettings({ provider: "openai", apiKey: KEYS.openai });
  world.answers["api.openai.com/v1/responses"] = () =>
    json(200, {
      status: "completed",
      output: [{ type: "web_search_call", status: "completed" }, { type: "message", content: [{ type: "output_text", text: "Brent at $80.", annotations: [{ type: "url_citation", url: "https://example.org/b", title: "B" }] }] }],
      usage: { input_tokens: 900, output_tokens: 90 },
    });
  const s = await ai._client().search({ system: "s", user: "u" });
  assert.equal(s.text, "Brent at $80.");
  assert.equal(s.usage.searches, 1);
  assert.equal(s.sources[0].url, "https://example.org/b");
  assert.deepEqual(world.requests[0].body.tools, [{ type: "web_search" }]);
});

test("a company without web search borrows one that has it; with none, it says so", () => {
  const { ai } = boot();
  ai.setSettings({ provider: "deepseek", apiKey: KEYS.deepseek });
  assert.throws(() => ai._searchClient(), /DeepSeek has no web search/);
  assert.equal(ai.status().searchBy, null);
  ai.setSettings({ provider: "gemini", apiKey: KEYS.gemini, use: false });
  const c = ai._searchClient();
  assert.equal(c.provider, "gemini");
  assert.equal(ai._client().provider, "deepseek", "the strategist stays on the company chosen");
  assert.equal(ai.status().searchByName, "Google Gemini");
});

test("the live model list: read with the saved key, filtered to text models, then offered and accepted", async () => {
  const { ai, world } = boot();
  await assert.rejects(ai.refreshModels("openai"), /Save OpenAI's API key first/);
  ai.setSettings({ provider: "openai", apiKey: KEYS.openai });
  world.answers["api.openai.com/v1/models"] = () => json(200, { data: ["gpt-6-astra", "gpt-5.6-sol", "text-embedding-3-large", "whisper-1", "gpt-realtime", "dall-e-3", "o9-mini"].map((id) => ({ id })) });
  const st = await ai.refreshModels("openai");
  const ids = st.models.map((m) => m.id);
  assert.ok(ids.includes("gpt-6-astra") && ids.includes("o9-mini") && ids.includes("gpt-5.6-sol"));
  assert.ok(!ids.some((id) => /embedding|whisper|realtime|dall-e/.test(id)));
  assert.equal(st.models.find((m) => m.id === "gpt-5.6-sol").note, "OpenAI's recommended production model", "catalogue notes kept");
  assert.ok(!ids.includes("gpt-5.6-luna"), "a catalogue model the company no longer lists is dropped");
  assert.equal(world.requests.at(-1).method, "GET");
  assert.equal(ai.setSettings({ provider: "openai", model: "gpt-6-astra" }).model, "gpt-6-astra");

  // NVIDIA's long list keeps chat models, Nemotron first
  const nv = pickChatModels("nvidia", ["meta/llama-4-maverick", "nvidia/nv-embedqa-e5-v5", "nvidia/nemotron-3-super-120b-a12b", "nvidia/llama-3.1-nemoguard-8b-content-safety", "nvidia/nemotron-3-ultra-550b-a55b"]);
  assert.deepEqual(nv, ["nvidia/nemotron-3-ultra-550b-a55b", "nvidia/nemotron-3-super-120b-a12b", "meta/llama-4-maverick"]);
});

test("Test checks the chosen company's key and keeps the result per company", async () => {
  const { ai, world } = boot();
  ai.setSettings({ provider: "nvidia", apiKey: KEYS.nvidia });
  world.answers["integrate.api.nvidia.com/v1/chat/completions"] = () => chat("ok");
  let r = await ai.test();
  assert.equal(r.test.ok, true);
  assert.equal(r.test.provider, "nvidia");
  world.answers["integrate.api.nvidia.com/v1/chat/completions"] = () => json(429, { detail: "Too many requests" });
  r = await ai.test();
  assert.equal(r.test.ok, false);
  assert.match(r.test.message, /NVIDIA's rate limit/);
  assert.equal(r.providers.find((p) => p.id === "nvidia").lastTest.ok, false);
  r = await ai.test("openai");
  assert.equal(r.test.ok, false);
  assert.match(r.test.message, /No OpenAI API key is saved/);
});

test("FREE companies: one NVIDIA key for all four, requests only to NVIDIA, never a paid key borrowed", async () => {
  const { ai, world } = boot();
  ai.setSettings({ provider: "anthropic", apiKey: KEYS.anthropic });
  ai.setSettings({ provider: "nv-mistral", apiKey: KEYS.nvidia });
  let st = ai.status();
  assert.equal(st.provider, "nv-mistral");
  assert.equal(st.free, true);
  for (const id of ["nvidia", "nv-mistral", "nv-deepseek", "nv-gemma"]) assert.equal(st.providers.find((p) => p.id === id).configured, true, `${id} uses the one saved key`);
  assert.equal(st.providers.find((p) => p.id === "nv-gemma").keyOf, "nvidia");

  // switching among the free ones never asks for a key
  st = ai.setSettings({ provider: "nv-deepseek" });
  assert.equal(st.configured, true);
  assert.equal(st.model, "deepseek-ai/deepseek-v4.1-flash");
  world.answers["integrate.api.nvidia.com/v1/chat/completions"] = () => chat('<think>…</think>{"mood":"mixed"}');
  assert.equal((await ai._client().ask({ system: "s", user: "u", schema: SCHEMA })).data.mood, "mixed");
  const q = world.requests.at(-1);
  assert.ok(q.url.startsWith("https://integrate.api.nvidia.com/v1/"), q.url);
  assert.equal(q.auth, `Bearer ${KEYS.nvidia}`);
  assert.equal(q.body.model, "deepseek-ai/deepseek-v4.1-flash");

  // web search: an Anthropic key IS saved, but a free model never borrows it
  assert.equal(ai.status().searchBy, null);
  assert.throws(() => ai._searchClient(), /never borrows a paid company's key/);
  await assert.rejects(ai.worldBrief({ refresh: true }), /never borrows/);
  assert.ok(world.requests.every((r) => r.url.startsWith("https://integrate.api.nvidia.com/")), "no request left for a paid company");

  // each free company's model list keeps only its own publisher's models from NVIDIA's list
  world.answers["integrate.api.nvidia.com/v1/models"] = () => json(200, { data: ["deepseek-ai/deepseek-v4.1-flash", "deepseek-ai/deepseek-v4.1-pro", "mistralai/mistral-large-4-1t-a52b", "google/gemma-4-31b-it", "nvidia/nemotron-3-super-120b-a12b", "nvidia/nv-embedqa-e5-v5"].map((id) => ({ id })) });
  assert.deepEqual((await ai.refreshModels("nv-deepseek")).providers.find((p) => p.id === "nv-deepseek").models.map((m) => m.id).sort(), ["deepseek-ai/deepseek-v4.1-flash", "deepseek-ai/deepseek-v4.1-pro"]);
  assert.deepEqual((await ai.refreshModels("nvidia")).providers.find((p) => p.id === "nvidia").models.map((m) => m.id), ["nvidia/nemotron-3-super-120b-a12b"]);

  // removing the key from one free company removes it for all four; Anthropic's stays
  st = ai.setSettings({ provider: "nv-gemma", clear: true, use: false });
  for (const id of ["nvidia", "nv-mistral", "nv-deepseek", "nv-gemma"]) assert.equal(st.providers.find((p) => p.id === id).configured, false, id);
  assert.equal(st.providers.find((p) => p.id === "anthropic").configured, true);
});

test("one answer contract: a malformed answer gets one correction; a second miss is refused", async () => {
  const { problems } = require("../ai/contract");
  const S = { type: "object", additionalProperties: false, required: ["mood", "n"], properties: { mood: { type: "string", enum: ["up", "down"] }, n: { anyOf: [{ type: "number" }, { type: "null" }] }, list: { type: "array", items: { type: "string" } } } };
  assert.deepEqual(problems({ mood: "up", n: null }, S), []);
  assert.deepEqual(problems({ mood: "sideways", n: "5", list: [1], extra: true }, S), ["answer.extra is not an allowed key", 'answer.mood must be one of "up", "down"', "answer.n must be number or null", "answer.list[0] must be string, not integer"]);
  assert.deepEqual(problems({}, S), ["answer.mood is missing", "answer.n is missing"]);

  const { ai, world } = boot();
  ai.setSettings({ provider: "nv-deepseek", apiKey: KEYS.nvidia });
  const replies = ['{"mood":"sideways","n":1}', '{"mood":"up","n":1}'];
  world.answers["integrate.api.nvidia.com/v1/chat/completions"] = () => chat(replies.shift() || '{"mood":"bad"}');
  const r = await ai._client().ask({ system: "s", user: "u", schema: S });
  assert.deepEqual(r.data, { mood: "up", n: 1 });
  assert.equal(r.contract, "repaired");
  assert.equal(r.usage.inputTokens, 240, "both requests are counted");
  assert.match(world.requests[1].body.messages[1].content, /did not match the required JSON schema:\n- answer\.mood must be one of/);

  world.answers["integrate.api.nvidia.com/v1/chat/completions"] = () => chat('{"mood":"bad","n":1}');
  await assert.rejects(ai._client().ask({ system: "s", user: "u", schema: S }), /did not follow the required format twice/);
});
