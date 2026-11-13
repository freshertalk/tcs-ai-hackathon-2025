"use strict";
// The AI companies the strategist can use, and one client per kind of API.
//
//   • Anthropic          — the official SDK (client.js)
//   • OpenAI, DeepSeek, Moonshot (Kimi), NVIDIA — the OpenAI-style chat API, over plain HTTPS
//   • Google Gemini      — Gemini's own generateContent API, over plain HTTPS
//
// Every client offers the same three calls — ask (one JSON answer), search (prose with the web
// pages it drew on, where the company has web search) and ping — plus listModels, which reads the
// models the key can use, so the model list stays current without editing this file.
//
// The model lists below are only a starting point. Model names change every few months; the
// settings page reads the live list from the company once a key is saved.
// Nothing here runs on a timer, and the API key is passed in per call and never logged.

const { AiClient, AiError, MODELS: ANTHROPIC_MODELS } = require("./client");
const { enforce } = require("./contract");

// what every NVIDIA-hosted (free) company shares: the endpoint, the key and how answers are read
const NVIDIA_FREE = {
  kind: "compat",
  free: true,
  base: "https://integrate.api.nvidia.com/v1",
  json: "prompt", // the schema in the prompt; the answer is read leniently (thinking tags, code fences)
  tokensField: "max_tokens",
  maxOut: 16000, // reasoning models spend part of this thinking
  search: false,
  keyPrefix: "nvapi-",
  keyExample: "nvapi-…",
  console: "build.nvidia.com",
  consoleUrl: "https://build.nvidia.com/settings/api-keys",
  steps: [
    "Sign in at build.nvidia.com (NVIDIA's developer program; joining is free).",
    "Open any model page (for example Nemotron 3 Super) and choose Get API Key.",
    "Paste the key (it starts with nvapi-) here. The same key serves every FREE company in the list. Hosted use is a free trial under NVIDIA's API Trial Terms, with rate limits NVIDIA can change.",
  ],
};

const PROVIDERS = [
  {
    id: "anthropic",
    name: "Anthropic",
    family: "Claude",
    kind: "anthropic",
    search: true,
    keyPrefix: "sk-ant-",
    keyExample: "sk-ant-…",
    console: "console.anthropic.com",
    consoleUrl: "https://console.anthropic.com/settings/keys",
    steps: ["Sign in at console.anthropic.com (separate from a claude.ai subscription).", "Add credits under Billing; consider a monthly spend limit.", "Create a key under API keys and paste it here."],
    models: ANTHROPIC_MODELS,
  },
  {
    id: "openai",
    name: "OpenAI",
    family: "GPT",
    kind: "compat",
    base: "https://api.openai.com/v1",
    json: "schema", // structured outputs: the answer is held to the schema
    tokensField: "max_completion_tokens",
    maxOut: 32000,
    search: true, // the Responses API's web search tool
    keyPrefix: "sk-",
    keyExample: "sk-…",
    console: "platform.openai.com",
    consoleUrl: "https://platform.openai.com/api-keys",
    steps: ["Sign in at platform.openai.com (separate from a ChatGPT subscription).", "Add credits under Billing and set a usage limit.", "Create a secret key under API keys and paste it here."],
    models: [
      { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", note: "OpenAI's recommended production model" },
      { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", note: "Balance of depth and price" },
      { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", note: "Fast and cheap" },
    ],
  },
  {
    id: "gemini",
    name: "Google Gemini",
    family: "Gemini",
    kind: "gemini",
    base: "https://generativelanguage.googleapis.com/v1beta",
    maxOut: 65536,
    search: true, // grounding with Google Search
    keyPrefix: "",
    keyExample: "AIza…",
    console: "aistudio.google.com",
    consoleUrl: "https://aistudio.google.com/apikey",
    steps: ["Sign in at aistudio.google.com with a Google account.", "Choose Get API key and create one (a free tier exists, with low limits; paid use needs billing on the Google Cloud project).", "Paste the key here."],
    models: [
      { id: "gemini-pro-latest", name: "Gemini Pro (latest)", note: "Google's alias for the newest Pro model" },
      { id: "gemini-flash-latest", name: "Gemini Flash (latest)", note: "Fast; Google's alias for the newest Flash" },
      { id: "gemini-flash-lite-latest", name: "Gemini Flash-Lite (latest)", note: "Cheapest" },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    family: "DeepSeek",
    kind: "compat",
    base: "https://api.deepseek.com",
    json: "object", // JSON mode: valid JSON, with the schema given in the prompt
    tokensField: "max_tokens",
    maxOut: 8000,
    search: false,
    keyPrefix: "sk-",
    keyExample: "sk-…",
    console: "platform.deepseek.com",
    consoleUrl: "https://platform.deepseek.com/api_keys",
    steps: ["Sign in at platform.deepseek.com.", "Top up the balance (pay-as-you-go).", "Create a key under API keys and paste it here."],
    models: [
      { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", note: "Deeper reasoning" },
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", note: "Fast and very cheap" },
    ],
  },
  {
    id: "moonshot",
    name: "Moonshot AI",
    family: "Kimi",
    kind: "compat",
    base: "https://api.moonshot.ai/v1",
    json: "object",
    tokensField: "max_tokens",
    maxOut: 16000,
    search: false,
    keyPrefix: "sk-",
    keyExample: "sk-…",
    console: "platform.kimi.ai",
    consoleUrl: "https://platform.kimi.ai/console/api-keys",
    steps: ["Sign in at platform.kimi.ai (Moonshot AI's developer platform).", "Recharge the balance.", "Create a key under API keys and paste it here."],
    models: [{ id: "kimi-k3", name: "Kimi K3", note: "Moonshot's flagship" }],
  },
  /* ---- FREE: models hosted by NVIDIA at build.nvidia.com, all on one nvapi- key ----
     Every one of these calls integrate.api.nvidia.com only, with the NVIDIA key, and nothing
     else: while one of them is in use no paid company's key is ever borrowed (not even for web
     search), so the app itself never runs up a bill. NVIDIA runs them as a free trial under its
     API Trial Terms, with rate limits it can change; at the limit it answers with an error. */
  {
    id: "nvidia",
    name: "NVIDIA",
    family: "Nemotron",
    ...NVIDIA_FREE,
    models: [
      { id: "nvidia/nemotron-3-super-120b-a12b", name: "Nemotron 3 Super 120B", note: "Free trial endpoint; strong reasoning", free: true },
      { id: "nvidia/nemotron-3-ultra-550b-a55b", name: "Nemotron 3 Ultra 550B", note: "Largest Nemotron; free trial endpoint", free: true },
      { id: "nvidia/nvidia-nemotron-nano-9b-v2", name: "Nemotron Nano 9B v2", note: "Small and fast; free trial endpoint", free: true },
      { id: "nvidia/nemotron-3.5-super-vl-120b-a12b", name: "Nemotron 3.5 Super VL 120B", note: "Newest Super, reads text and images; free trial endpoint", free: true },
    ],
    match: (id) => id.startsWith("nvidia/"),
  },
  {
    id: "nv-mistral",
    name: "Mistral AI",
    family: "Mistral Large",
    ...NVIDIA_FREE,
    keyOf: "nvidia",
    models: [{ id: "mistralai/mistral-large-4-1t-a52b", name: "Mistral Large 4", note: "Mistral's largest model, hosted by NVIDIA; free trial endpoint", free: true }],
    match: (id) => id.startsWith("mistralai/"),
  },
  {
    id: "nv-deepseek",
    name: "DeepSeek",
    family: "via NVIDIA",
    ...NVIDIA_FREE,
    keyOf: "nvidia",
    models: [{ id: "deepseek-ai/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", note: "Reasoning model, hosted by NVIDIA; free trial endpoint", free: true }],
    match: (id) => id.startsWith("deepseek-ai/"),
  },
  {
    id: "nv-gemma",
    name: "Google Gemma",
    family: "Gemma",
    ...NVIDIA_FREE,
    keyOf: "nvidia",
    models: [{ id: "google/gemma-4-31b-it", name: "Gemma 4 31B IT", note: "Google's open model, hosted by NVIDIA; free trial endpoint", free: true }],
    match: (id) => id.startsWith("google/gemma"),
  },
];

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));
const providerOf = (id) => BY_ID.get(id) || null;
const DEFAULT_PROVIDER = "anthropic";
const SEARCH_ORDER = ["anthropic", "openai", "gemini"];

/** Plain checks on a pasted key; the company is the real judge (Test). */
function checkKey(providerId, key) {
  const p = providerOf(providerId);
  if (!p) throw new AiError("Unknown AI company.", "invalid", 400);
  const an = (name) => `${/^([AEIO]|N[A-Z])/.test(name) ? "an" : "a"} ${name}`; // "an NVIDIA", "an OpenAI"
  if (!/^[A-Za-z0-9_\-.]{20,400}$/.test(key)) throw new AiError(`That does not look like ${an(p.name)} API key.`, "invalid", 400);
  const looks = key.startsWith("sk-ant-") ? "anthropic" : key.startsWith("nvapi-") ? "nvidia" : key.startsWith("AIza") ? "gemini" : null;
  const owner = p.keyOf || p.id; // the free companies all use NVIDIA's key
  if (looks && looks !== owner) throw new AiError(`That looks like ${an(providerOf(looks).name)} key, not ${an(p.name)} one. Pick ${providerOf(looks).name} as the company, or paste the ${p.name} key.`, "invalid", 400);
  if (p.id === "anthropic") {
    if (key.startsWith("sk-ant-admin")) throw new AiError("That is an Admin API key. Create a normal API key in the Anthropic Console (API keys) and use that.", "invalid", 400);
    if (!/^sk-ant-[A-Za-z0-9_-]{16,300}$/.test(key)) throw new AiError("That does not look like an Anthropic API key. It should start with \"sk-ant-\".", "invalid", 400);
  }
  if (p.keyPrefix && !key.startsWith(p.keyPrefix)) throw new AiError(`That does not look like ${an(p.name)} API key. It should start with "${p.keyPrefix}".`, "invalid", 400);
  return key;
}

/* ------------------------------------------------------------ helpers */

const sleepless = (ms) => (typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);

/** The JSON instruction for companies without schema-held answers. */
const schemaNote = (schema) =>
  `\n\nAnswer with one JSON object and nothing else — no prose before or after it, no code fence. It must match this JSON Schema exactly (every required key present, no extra keys):\n${JSON.stringify(schema)}`;

/** Read a JSON object out of a model's text, forgiving thinking tags and code fences. */
function readJson(text) {
  let t = String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const d = JSON.parse(t.slice(a, b + 1));
    return d && typeof d === "object" && !Array.isArray(d) ? d : null;
  } catch (_) {
    return null;
  }
}

/** One HTTP failure, in words a person can act on. */
function httpError(p, status, detail) {
  const said = detail ? ` (${String(detail).slice(0, 200)})` : "";
  if (status === 401) return new AiError(`${p.name} rejected the API key. Check it in the AI settings.`, "bad_key", 401);
  if (status === 402) return new AiError(`${p.name} says the account has no credit left. Top it up in ${p.console}.`, "no_credit", 402);
  if (status === 403) return new AiError(`This ${p.name} key is not allowed to use the selected model${said}. Pick another model or check the key.`, "forbidden", 403);
  if (status === 404) return new AiError(`${p.name} does not know the selected model${said}. Press “Refresh models” and pick one from the list.`, "bad_model", 400);
  if (status === 429) return new AiError(`${p.name}'s rate limit or quota was reached${said}. Wait a minute and try again.`, "rate_limited", 429);
  if (status === 400 || status === 422) return new AiError(`${p.name} did not accept the request${said}.`, "bad_request", 400);
  return new AiError(`${p.name} returned an error (${status || "unknown"}). Try again shortly.`, "upstream", 502);
}

async function call(p, fetchImpl, url, { method = "POST", headers = {}, body, timeoutMs = 240000 } = {}) {
  let res;
  try {
    res = await (fetchImpl || globalThis.fetch)(url, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: sleepless(timeoutMs),
    });
  } catch (err) {
    if (err && (err.name === "TimeoutError" || err.name === "AbortError")) throw new AiError(`${p.name} did not answer in time. Try again.`, "timeout", 504);
    throw new AiError(`Could not reach ${p.name}. Check the server's internet connection.`, "unreachable", 502);
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {
    json = null;
  }
  if (!res.ok) {
    const e = json && (json.error || json);
    const detail = e ? (typeof e === "string" ? e : e.message || e.detail || e.status || "") : "";
    throw httpError(p, res.status, detail);
  }
  if (!json) throw new AiError(`${p.name} sent an answer that could not be read.`, "bad_output", 502);
  return json;
}

const effortOf = (e) => (e === "low" ? "low" : e === "medium" ? "medium" : "high");

/* ------------------------------------------------ OpenAI-style chat APIs */

class CompatClient {
  constructor({ provider, apiKey, model, fetchImpl }) {
    this.p = provider;
    this.key = apiKey;
    this.model = model;
    this.fetch = fetchImpl;
  }

  _auth() {
    return { authorization: `Bearer ${this.key}` };
  }

  _reasoning() {
    // only OpenAI's reasoning models take an effort setting; others reject it
    return this.p.id === "openai" && /^(o\d|gpt-5|gpt-6)/.test(this.model);
  }

  async _chat({ system, user, maxTokens, effort, format }) {
    const body = {
      model: this.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      [this.p.tokensField || "max_tokens"]: Math.min(maxTokens, this.p.maxOut || maxTokens),
    };
    if (format) body.response_format = format;
    if (effort && this._reasoning()) body.reasoning_effort = effortOf(effort);
    return call(this.p, this.fetch, `${this.p.base}/chat/completions`, { headers: this._auth(), body });
  }

  async ask({ system, user, schema, maxTokens = 16000, effort = "high" }) {
    let r;
    if (this.p.json === "schema") {
      try {
        r = await this._chat({ system, user, maxTokens, effort, format: { type: "json_schema", json_schema: { name: "answer", strict: true, schema } } });
      } catch (err) {
        // an older model without schema-held answers: fall back to plain JSON mode
        if (err.code !== "bad_request") throw err;
        r = await this._chat({ system: system + schemaNote(schema), user, maxTokens, effort, format: { type: "json_object" } });
      }
    } else {
      r = await this._chat({ system: system + schemaNote(schema), user, maxTokens, effort, format: this.p.json === "object" ? { type: "json_object" } : undefined });
    }
    const choice = (r.choices || [])[0] || {};
    const msg = choice.message || {};
    if (msg.refusal) throw new AiError(`The model declined this request (${String(msg.refusal).slice(0, 160)}). Nothing was produced.`, "refused", 422);
    if (choice.finish_reason === "length") throw new AiError("The answer was cut off before it finished. Try again, or pick a model with a longer answer limit.", "truncated", 502);
    if (choice.finish_reason === "content_filter") throw new AiError("The company's content filter stopped this answer. Nothing was produced.", "refused", 422);
    const data = readJson(typeof msg.content === "string" ? msg.content : Array.isArray(msg.content) ? msg.content.map((c) => c.text || "").join("") : "");
    if (!data) throw new AiError("The model's answer was not in the expected format. Try again, or pick a stronger model.", "bad_output", 502);
    return { data, usage: this._usage(r.usage), model: this.model, servedBy: r.model || this.model };
  }

  _usage(u = {}) {
    u = u || {};
    const cached = (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || u.prompt_cache_hit_tokens || 0;
    return { inputTokens: u.prompt_tokens || u.input_tokens || 0, outputTokens: u.completion_tokens || u.output_tokens || 0, cacheReadTokens: cached };
  }

  /** OpenAI only: the Responses API with its web search tool. */
  async search({ system, user, maxTokens = 8000, effort = "medium" }) {
    if (!this.p.search) throw new AiError(`${this.p.name} has no web search in its API.`, "no_search", 409);
    const body = { model: this.model, instructions: system, input: user, tools: [{ type: "web_search" }], max_output_tokens: Math.min(maxTokens + 8000, this.p.maxOut || 32000) };
    if (this._reasoning()) body.reasoning = { effort: effortOf(effort) };
    const r = await call(this.p, this.fetch, `${this.p.base}/responses`, { headers: this._auth(), body });
    const sources = new Map();
    let text = "";
    let searches = 0;
    for (const item of r.output || []) {
      if (item.type === "web_search_call") searches += 1;
      if (item.type !== "message") continue;
      for (const c of item.content || []) {
        if (c.type === "refusal") throw new AiError("The model declined this request. Nothing was produced.", "refused", 422);
        if (c.type !== "output_text") continue;
        text += c.text || "";
        for (const a of c.annotations || []) if (a.type === "url_citation" && a.url && !sources.has(a.url)) sources.set(a.url, { url: a.url, title: a.title || a.url, cited: true });
      }
    }
    text = text.trim();
    if (r.status === "incomplete" && !text) throw new AiError("The search did not finish. Try again.", "truncated", 504);
    if (!text) throw new AiError("The model returned no answer.", "search_failed", 502);
    const u = this._usage(r.usage);
    return { text, sources: [...sources.values()].slice(0, 12), searchErrors: [], usage: { ...u, searches }, model: this.model };
  }

  async ping() {
    const r = await this._chat({ system: "Reply with the single word: ok", user: "ok?", maxTokens: this._reasoning() ? 400 : 16, effort: "low" });
    return { ok: true, model: r.model || this.model, usage: this._usage(r.usage) };
  }

  async listModels() {
    const r = await call(this.p, this.fetch, `${this.p.base}/models`, { method: "GET", headers: this._auth(), timeoutMs: 30000 });
    const ids = (Array.isArray(r.data) ? r.data : []).map((m) => m && m.id).filter((id) => typeof id === "string");
    // NVIDIA lists every model it hosts on one key: each free company keeps only its own publisher's
    const mine = this.p.match ? ids.filter((id) => this.p.match(id)) : ids;
    return pickChatModels(this.p.free ? "nvidia" : this.p.id, mine).map((id) => ({ id, name: id }));
  }
}

/** Keep the models that can hold a conversation; drop speech, images, embeddings and the like. */
function pickChatModels(providerId, ids) {
  const drop =
    providerId === "openai"
      ? /(audio|realtime|tts|transcribe|whisper|dall-e|image|embedding|moderation|search-preview|davinci|babbage|instruct|sora|computer-use)/i
      : providerId === "nvidia"
        ? /(embed|rerank|retriev|vision|vila|clip|parse|safety|guard|reward|ingest|ocr|paddle|deplot|kosmos|neva|fuyu|ground|cosmos|riva|audio|asr|tts|translat|bge|nv-yolo|segment|diffusion|flux|sdxl|stable)/i
        : /(embed|vision|image|audio|tts)/i;
  const keep = providerId === "openai" ? /^(gpt|o\d|chatgpt)/i : /./;
  const out = [...new Set(ids)].filter((id) => keep.test(id) && !drop.test(id));
  // Nemotron first on NVIDIA's long list; otherwise newest-looking names first
  return out.sort((a, b) => {
    if (providerId === "nvidia") {
      const na = /nemotron/i.test(a) ? 0 : 1;
      const nb = /nemotron/i.test(b) ? 0 : 1;
      if (na !== nb) return na - nb;
    }
    return b.localeCompare(a, "en", { numeric: true });
  });
}

/* ------------------------------------------------------- Google Gemini */

class GeminiClient {
  constructor({ provider, apiKey, model, fetchImpl }) {
    this.p = provider;
    this.key = apiKey;
    this.model = model;
    this.fetch = fetchImpl;
  }

  _url(path) {
    return `${this.p.base}/${path}`;
  }

  async _generate(body) {
    return call(this.p, this.fetch, this._url(`models/${encodeURIComponent(this.model)}:generateContent`), { headers: { "x-goog-api-key": this.key }, body });
  }

  _read(r) {
    if (r.promptFeedback && r.promptFeedback.blockReason) throw new AiError(`Gemini blocked this request (${r.promptFeedback.blockReason}). Nothing was produced.`, "refused", 422);
    const c = (r.candidates || [])[0] || {};
    if (c.finishReason === "SAFETY" || c.finishReason === "PROHIBITED_CONTENT" || c.finishReason === "BLOCKLIST") throw new AiError("Gemini's safety filter stopped this answer. Nothing was produced.", "refused", 422);
    const text = ((c.content && c.content.parts) || [])
      .filter((x) => !x.thought && typeof x.text === "string")
      .map((x) => x.text)
      .join("");
    return { c, text };
  }

  _usage(u = {}) {
    u = u || {};
    return { inputTokens: u.promptTokenCount || 0, outputTokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0), cacheReadTokens: u.cachedContentTokenCount || 0 };
  }

  async ask({ system, user, schema, maxTokens = 16000 }) {
    const r = await this._generate({
      systemInstruction: { parts: [{ text: system + schemaNote(schema) }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      // thinking counts against the limit on current models, so leave it room
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: Math.min(this.p.maxOut, maxTokens + 8192) },
    });
    const { c, text } = this._read(r);
    if (c.finishReason === "MAX_TOKENS") throw new AiError("The answer was cut off before it finished. Try again.", "truncated", 502);
    const data = readJson(text);
    if (!data) throw new AiError("The model's answer was not in the expected format. Try again.", "bad_output", 502);
    return { data, usage: this._usage(r.usageMetadata), model: this.model, servedBy: r.modelVersion || this.model };
  }

  async search({ system, user, maxTokens = 8000 }) {
    const r = await this._generate({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      tools: [{ google_search: {} }],
      generationConfig: { maxOutputTokens: Math.min(this.p.maxOut, maxTokens + 8192) },
    });
    const { c, text } = this._read(r);
    const g = c.groundingMetadata || {};
    const sources = new Map();
    for (const ch of g.groundingChunks || []) if (ch && ch.web && ch.web.uri && !sources.has(ch.web.uri)) sources.set(ch.web.uri, { url: ch.web.uri, title: ch.web.title || ch.web.uri, cited: true });
    if (!text.trim()) throw new AiError("The model returned no answer.", "search_failed", 502);
    return { text: text.trim(), sources: [...sources.values()].slice(0, 12), searchErrors: [], usage: { ...this._usage(r.usageMetadata), searches: (g.webSearchQueries || []).length }, model: this.model };
  }

  async ping() {
    const r = await this._generate({ contents: [{ role: "user", parts: [{ text: "Reply with the single word: ok" }] }], generationConfig: { maxOutputTokens: 256 } });
    return { ok: true, model: r.modelVersion || this.model, usage: this._usage(r.usageMetadata) };
  }

  async listModels() {
    const r = await call(this.p, this.fetch, this._url("models?pageSize=1000"), { method: "GET", headers: { "x-goog-api-key": this.key }, timeoutMs: 30000 });
    return (Array.isArray(r.models) ? r.models : [])
      .filter((m) => m && typeof m.name === "string" && (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => ({ id: m.name.replace(/^models\//, ""), name: m.displayName || m.name.replace(/^models\//, "") }))
      .filter((m) => /^gemini/i.test(m.id) && !/(embedding|image|tts|audio|live|robotics|computer-use)/i.test(m.id))
      .sort((a, b) => b.id.localeCompare(a.id, "en", { numeric: true }));
  }
}

/* ------------------------------------------------------- Anthropic list */

async function anthropicModels(client) {
  const out = [];
  for await (const m of client.client.models.list({ limit: 100 })) {
    if (m && m.id) out.push({ id: m.id, name: m.display_name || m.id });
    if (out.length >= 200) break;
  }
  return out;
}

/** A client for one company, with one key and one model. */
function makeClient({ providerId, apiKey, model, fetchImpl }) {
  const p = providerOf(providerId);
  if (!p) throw new AiError("Unknown AI company.", "invalid", 400);
  if (!apiKey) throw new AiError(`No ${p.name} API key is set.`, "not_configured", 409);
  if (p.kind === "anthropic") {
    const c = new AiClient({ apiKey, model, fetchImpl });
    c.provider = p.id;
    c.listModels = () =>
      anthropicModels(c).catch((err) => {
        throw err instanceof AiError ? err : new AiError(`Could not read Anthropic's model list: ${err.message}`, "upstream", 502);
      });
    return c;
  }
  const c = p.kind === "gemini" ? new GeminiClient({ provider: p, apiKey, model, fetchImpl }) : new CompatClient({ provider: p, apiKey, model, fetchImpl });
  c.provider = p.id;
  // Anthropic holds answers to the schema itself; every other company's answer is checked against
  // the same schema here (contract.js), so all models meet one contract
  return enforce(c, { held: false, AiError });
}

module.exports = { PROVIDERS, providerOf, DEFAULT_PROVIDER, SEARCH_ORDER, checkKey, makeClient, readJson, pickChatModels };
