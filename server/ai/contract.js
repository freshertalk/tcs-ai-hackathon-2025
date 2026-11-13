"use strict";
// One answer contract for every model.
//
// Every AI feature asks with the same instructions, the same trading-skills file, the same data
// and the same JSON schema, whichever company answers. Anthropic and OpenAI hold their answers to
// the schema themselves; the others (DeepSeek, Kimi and the free NVIDIA-hosted models) are only
// asked to follow it. So their answer is checked here against the very same schema; if it does not
// match, the model is shown what was wrong and asked once more; if it still does not match, the
// request fails with a clear message instead of letting a malformed plan through.
// After this, the service's own checks (checkPlan's arithmetic, the clean-up of every field) apply
// to every model alike.

const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);

/**
 * The places where `data` breaks `schema`. Covers what the desk's schemas use: type, enum,
 * required, properties, additionalProperties: false, items and anyOf.
 * @returns string[]  empty when the data matches
 */
function problems(data, schema, at = "answer", out = []) {
  if (out.length >= 12 || !schema || typeof schema !== "object") return out;
  if (Array.isArray(schema.anyOf)) {
    if (!schema.anyOf.some((s) => problems(data, s, at, []).length === 0)) out.push(`${at} must be ${schema.anyOf.map((s) => s.type || "a listed shape").join(" or ")}`);
    return out;
  }
  const t = typeOf(data);
  if (schema.type) {
    const want = Array.isArray(schema.type) ? schema.type : [schema.type];
    const ok = want.some((w) => w === t || (w === "number" && t === "integer"));
    if (!ok) {
      out.push(`${at} must be ${want.join(" or ")}, not ${t}`);
      return out;
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(data)) out.push(`${at} must be one of ${schema.enum.map((x) => JSON.stringify(x)).join(", ")}`);
  if (t === "object") {
    for (const k of schema.required || []) if (!(k in data)) out.push(`${at}.${k} is missing`);
    const props = schema.properties || {};
    if (schema.additionalProperties === false) for (const k of Object.keys(data)) if (!(k in props)) out.push(`${at}.${k} is not an allowed key`);
    for (const [k, s] of Object.entries(props)) if (k in data) problems(data[k], s, `${at}.${k}`, out);
  }
  if (t === "array" && schema.items) data.slice(0, 50).forEach((x, i) => problems(x, schema.items, `${at}[${i}]`, out));
  return out;
}

/**
 * Wrap a client's ask() so every answer meets the schema: one repair attempt, then a clear failure.
 * @param held  true when the company itself holds answers to the schema (no second check needed)
 */
function enforce(client, { held = false, AiError }) {
  if (held) return client;
  const ask = client.ask.bind(client);
  client.ask = async (args) => {
    const first = await ask(args);
    let issues = problems(first.data, args.schema);
    if (!issues.length) return { ...first, contract: "checked" };
    const retryUser = `${args.user}\n\n---\n\nYour previous answer did not match the required JSON schema:\n- ${issues.slice(0, 10).join("\n- ")}\n\nAnswer again: one JSON object only, matching the schema exactly, with the same analysis rules as before.`;
    const second = await ask({ ...args, user: retryUser });
    issues = problems(second.data, args.schema);
    const usage = {
      inputTokens: (first.usage.inputTokens || 0) + (second.usage.inputTokens || 0),
      outputTokens: (first.usage.outputTokens || 0) + (second.usage.outputTokens || 0),
      cacheReadTokens: (first.usage.cacheReadTokens || 0) + (second.usage.cacheReadTokens || 0),
    };
    if (issues.length) throw new AiError(`The model's answer did not follow the required format twice (${issues.slice(0, 3).join("; ")}). Nothing was saved. Try again, or pick a stronger model.`, "bad_output", 502);
    return { ...second, usage, contract: "repaired" };
  };
  return client;
}

module.exports = { problems, enforce };
