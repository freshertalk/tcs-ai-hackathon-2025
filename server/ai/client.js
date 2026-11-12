"use strict";
// A thin wrapper around the official Anthropic SDK for the strategist.
//
//   • one structured-output call per question (JSON that matches a schema)
//   • every failure becomes an AiError with a plain-English message
//   • nothing here runs on a timer: a call happens only when an admin presses a button
//
// The API key is passed in per call and never logged.

const sdk = require("@anthropic-ai/sdk");

const Anthropic = sdk.default || sdk.Anthropic || sdk;

// The models an admin can choose. The first is the default.
const MODELS = [
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", note: "Default — strong reasoning at a moderate price" },
  { id: "claude-fable-5-2", name: "Claude Fable 5.2", note: "Most capable; about twice the price of Opus 5.5" },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", note: "Faster and cheaper" },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", note: "Cheapest; least depth" },
];
const DEFAULT_MODEL = MODELS[0].id;
// If a safety classifier declines a request, these models can hand it to a fallback model server-side.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const WITH_FALLBACK = new Set(["claude-opus-5-5", "claude-fable-5-2", "claude-sonnet-5-5"]);

class AiError extends Error {
  constructor(message, code = "ai_error", status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Turn an SDK exception into something a person can act on. Most specific first. */
function explain(err) {
  if (err instanceof AiError) return err;
  if (err instanceof sdk.AuthenticationError) return new AiError("Anthropic rejected the API key. Check it in the AI settings.", "bad_key", 401);
  if (err instanceof sdk.PermissionDeniedError) return new AiError("This API key is not allowed to use the selected model. Pick another model or check the key's workspace.", "forbidden", 403);
  if (err instanceof sdk.NotFoundError) return new AiError("Anthropic does not know the selected model. Pick another one in the AI settings.", "bad_model", 400);
  if (err instanceof sdk.RateLimitError) return new AiError("Anthropic's rate limit was reached. Wait a minute and try again.", "rate_limited", 429);
  if (err instanceof sdk.BadRequestError) return new AiError(`Anthropic did not accept the request: ${err.message}`, "bad_request", 400);
  if (err instanceof sdk.APIConnectionTimeoutError) return new AiError("Anthropic did not answer in time. Try again.", "timeout", 504);
  if (err instanceof sdk.APIConnectionError) return new AiError("Could not reach Anthropic. Check the server's internet connection.", "unreachable", 502);
  if (err instanceof sdk.APIError) return new AiError(`Anthropic returned an error (${err.status || "unknown"}). Try again shortly.`, "upstream", 502);
  return new AiError(err && err.message ? err.message : "The AI request failed.", "ai_error", 502);
}

const usageOf = (m) => {
  const u = (m && m.usage) || {};
  return { inputTokens: u.input_tokens || 0, outputTokens: u.output_tokens || 0, cacheReadTokens: u.cache_read_input_tokens || 0 };
};

class AiClient {
  constructor({ apiKey, model = DEFAULT_MODEL, fetchImpl }) {
    if (!apiKey) throw new AiError("No Anthropic API key is set.", "not_configured", 409);
    this.model = MODELS.some((m) => m.id === model) ? model : DEFAULT_MODEL;
    // maxRetries: the SDK retries 429 / 5xx / network errors itself; timeout is in milliseconds
    this.client = new Anthropic({ apiKey, maxRetries: 1, timeout: 240000, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  }

  /**
   * One question, one JSON answer that matches `schema`.
   * @returns { data, usage, model, servedBy }
   */
  async ask({ system, user, schema, maxTokens = 16000, effort = "high" }) {
    const fallback = WITH_FALLBACK.has(this.model);
    let message;
    try {
      // Thinking is adaptive by default on every model offered here; effort sets its depth.
      // create() rather than parse(): a refusal or a cut-off answer is not valid JSON, and the
      // stop reason has to be read BEFORE anything tries to parse the text.
      message = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
        output_config: { effort, format: { type: "json_schema", schema } },
        ...(fallback ? { betas: [FALLBACK_BETA], fallbacks: "default" } : {}),
      });
    } catch (err) {
      throw explain(err);
    }
    // always look at the stop reason before trusting the content
    if (message.stop_reason === "refusal") {
      const why = message.stop_details && message.stop_details.explanation ? ` (${message.stop_details.explanation})` : "";
      throw new AiError(`The model declined this request${why}. Nothing was produced.`, "refused", 422);
    }
    if (message.stop_reason === "max_tokens") throw new AiError("The answer was cut off before it finished. Try again.", "truncated", 502);
    // content is a list of blocks (thinking, text, …): the JSON is in the text blocks
    const text = (message.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = null;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new AiError("The model's answer was not in the expected format. Try again.", "bad_output", 502);
    return { data, usage: usageOf(message), model: this.model, servedBy: message.model || this.model };
  }

  /**
   * A question answered with Anthropic's web search tool: prose, plus the pages it drew on.
   * Search failures arrive inside a normal response, so they are looked for explicitly.
   */
  async search({ system, user, maxUses = 6, maxTokens = 8000, effort = "medium" }) {
    // the current tool version filters results before the model reads them; Haiku uses the basic one
    const tool = {
      type: this.model === "claude-haiku-5-5" ? "web_search_20250305" : "web_search_20260209",
      name: "web_search",
      max_uses: maxUses,
      user_location: { type: "approximate", country: "IN", timezone: "Asia/Kolkata" },
    };
    const messages = [{ role: "user", content: user }];
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, searches: 0 };
    const blocks = [];
    let message;
    try {
      // a long search turn can pause; sending the assistant turn back lets the server resume it
      for (let turn = 0; turn < 4; turn += 1) {
        message = await this.client.messages.create({ model: this.model, max_tokens: maxTokens, system, messages, tools: [tool], output_config: { effort } });
        const u = usageOf(message);
        usage.inputTokens += u.inputTokens;
        usage.outputTokens += u.outputTokens;
        usage.cacheReadTokens += u.cacheReadTokens;
        usage.searches += (message.usage && message.usage.server_tool_use && message.usage.server_tool_use.web_search_requests) || 0;
        blocks.push(...(message.content || []));
        if (message.stop_reason !== "pause_turn") break;
        messages.push({ role: "assistant", content: message.content });
      }
    } catch (err) {
      throw explain(err);
    }
    if (message.stop_reason === "refusal") throw new AiError("The model declined this request. Nothing was produced.", "refused", 422);
    if (message.stop_reason === "pause_turn") throw new AiError("The search did not finish in time. Try again.", "truncated", 504);

    const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    const sources = new Map();
    const errors = [];
    for (const b of blocks) {
      if (b.type === "text") {
        for (const c of b.citations || []) if (c.type === "web_search_result_location" && c.url) sources.set(c.url, { url: c.url, title: c.title || c.url, cited: true });
      } else if (b.type === "web_search_tool_result") {
        // a successful search is a list of results; a failed one is a single error object
        if (Array.isArray(b.content)) {
          for (const r of b.content) if (r && r.url && !sources.has(r.url)) sources.set(r.url, { url: r.url, title: r.title || r.url, age: r.page_age || null, cited: false });
        } else if (b.content && b.content.error_code) errors.push(b.content.error_code);
      }
    }
    if (!text) {
      throw new AiError(errors.length ? `Web search failed (${errors[0]}). Check that web search is switched on for this key's organisation in the Anthropic Console.` : "The model returned no answer.", "search_failed", 502);
    }
    const list = [...sources.values()].sort((a, b) => Number(b.cited) - Number(a.cited)).slice(0, 12);
    return { text, sources: list, searchErrors: errors, usage, model: this.model };
  }

  /** The cheapest possible request, to prove the key and the model work. */
  async ping() {
    try {
      const m = await this.client.messages.create({
        model: this.model,
        max_tokens: 16,
        output_config: { effort: "low" },
        messages: [{ role: "user", content: "Reply with the single word: ok" }],
      });
      return { ok: true, model: m.model || this.model, usage: usageOf(m) };
    } catch (err) {
      throw explain(err);
    }
  }
}

module.exports = { AiClient, AiError, MODELS, DEFAULT_MODEL, explain };
