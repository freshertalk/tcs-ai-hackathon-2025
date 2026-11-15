"use strict";
// AI brains: the owner's standing instructions reach exactly the AI features they belong to, and the
// AI team (free models in parallel, merged by the paid lead or the strongest free model) writes them.
// Everything runs against FAKE companies: no network, no real key, no cost.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { AiService } = require("../ai/service");
const { FEATURE_IDS, featureOf, cleanScopes } = require("../ai/brains");

const KEYS = { nvidia: "nvapi-TESTONLYtestonlyTESTONLY1234567890", anthropic: "sk-ant-api03-TESTONLYtestonlyTESTONLY1234567890abcd" };
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

function boot({ failFree = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-brains-"));
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    const body = init.body ? JSON.parse(init.body) : {};
    const version = (by) => ({ title: `Stand aside at midday (${by})`, text: `Between 11:30 AM and 1:30 PM IST prefer "no trade" unless the tape score is at least 45 — ${by}.`, scopes: ["strategist", "copilot", "nonsense"], conflicts: [], rationale: `${by} tightened it.` });
    if (u.includes("integrate.api.nvidia.com")) {
      if (/\/models/.test(u)) return json(200, { data: [] });
      const sys = (body.messages || []).find((m) => m.role === "system");
      seen.push({ to: body.model, system: sys ? sys.content : "" });
      if (failFree) return json(500, { error: { message: "down" } });
      const merge = sys && /You merge several models/.test(sys.content);
      const reply = merge ? { title: "Midday: stand aside", text: "From 11:30 AM to 1:30 PM IST, prefer no trade unless the tape score is 45 or more.", scopes: ["copilot", "strategist"], conflicts: [], notes: "Merged by a free model." } : version(body.model);
      return json(200, { model: body.model, choices: [{ message: { role: "assistant", content: JSON.stringify(reply) }, finish_reason: "stop" }], usage: { prompt_tokens: 400, completion_tokens: 120 } });
    }
    if (u.includes("api.anthropic.com")) {
      seen.push({ to: body.model, system: typeof body.system === "string" ? body.system : JSON.stringify(body.system) });
      const req = (body.output_config && body.output_config.format && body.output_config.format.schema && body.output_config.format.schema.required) || [];
      const reply = req.includes("notes") ? { title: "Midday discipline", text: "Between 11:30 AM and 1:30 PM IST, stand aside unless the tape score is at least 45; say so plainly.", scopes: ["strategist", "copilot", "ensemble-live"], conflicts: [], notes: "Merged by the paid lead." } : version(body.model);
      return json(200, { id: "m", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: JSON.stringify(reply) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 600, output_tokens: 150 } });
    }
    return json(404, { error: { message: `no fake for ${u}` } });
  };
  const store = { data: { settings: {} }, update(fn) { fn(this.data); } };
  const ai = new AiService({ dir, store, secrets: { encrypt: (x) => `enc:${Buffer.from(x).toString("base64")}`, decrypt: (x) => Buffer.from(x.slice(4), "base64").toString() }, market: { mode: () => "kite", now: () => Date.now() }, fetchImpl, now: () => Date.parse("2026-11-15T10:00:00+05:30"), log: { log() {} } });
  return { ai, seen };
}

test("every AI feature's instructions are registered, so a brain can find its way to it", () => {
  boot();
  for (const id of FEATURE_IDS) assert.ok(require("../ai/brains").featureOf, id);
  const { ai } = boot();
  const prompts = ai.brains.prompts();
  assert.deepEqual(prompts.map((p) => p.id), FEATURE_IDS);
  assert.ok(prompts.every((p) => p.prompts.length >= 1 && p.prompts[0].text.length > 100), "each feature shows its real instructions");
  assert.equal(featureOf("some other prompt"), null);
});

test("a brain is added to exactly the features in its scope; switched off, it is added nowhere", async () => {
  const { ai } = boot();
  const copilotSystem = ai.brains.prompts().find((p) => p.id === "copilot").prompts[0].text;
  const coachSystem = ai.brains.prompts().find((p) => p.id === "coach").prompts[0].text;
  const r = await ai.brains.save({ title: "No chasing", text: "Never suggest an entry more than 0.5 ATR away from VWAP.", scopes: ["copilot"] }, "owner@example.com");
  assert.equal(r.brain.original, null, "saved as written");
  assert.match(ai.brains.compose(copilotSystem), /THE OWNER'S AI BRAINS[\s\S]*1\. No chasing: Never suggest an entry/);
  assert.equal(ai.brains.compose(coachSystem), coachSystem, "the coach is not in its scope");
  assert.equal(ai.brains.compose("unknown prompt"), "unknown prompt");
  // a wrapped client sends the composed instructions
  let sent = null;
  const fake = { ask: async (a) => ((sent = a), { data: {} }), other: () => "kept" };
  const w = ai.brains.wrap(fake);
  await w.ask({ system: copilotSystem, user: "x" });
  assert.match(sent.system, /No chasing/);
  assert.equal(w.other(), "kept", "everything else on the client still works");
  // "all" reaches every feature
  await ai.brains.save({ title: "Plain words", text: "Write in short, plain sentences with the actual numbers.", scopes: ["all"] });
  assert.match(ai.brains.compose(coachSystem), /Plain words/);
  // switched off: nowhere
  ai.brains.setEnabled(r.brain.id, false);
  assert.doesNotMatch(ai.brains.compose(copilotSystem), /No chasing/);
});

test("the strategist's real request carries the brains of its feature", async () => {
  const { ai, seen } = boot();
  ai.setSettings({ provider: "nvidia", apiKey: KEYS.nvidia });
  await ai.brains.save({ title: "Midday rule", text: "Prefer no trade between 11:30 AM and 1:30 PM IST.", scopes: ["learn"] });
  const client = ai._client();
  await client.ask({ system: ai.brains.prompts().find((p) => p.id === "learn").prompts[0].text, user: "{}", schema: { type: "object", additionalProperties: false, required: ["title", "text", "scopes", "conflicts", "rationale"], properties: { title: { type: "string" }, text: { type: "string" }, scopes: { type: "array", items: { type: "string" } }, conflicts: { type: "array", items: { type: "string" } }, rationale: { type: "string" } } }, maxTokens: 500 });
  assert.match(seen[seen.length - 1].system, /Midday rule: Prefer no trade/);
});

test("edits keep a history; scopes are cleaned; bad input and unknown ids are refused", async () => {
  const { ai } = boot();
  assert.deepEqual(cleanScopes(["copilot", "nonsense", "COPILOT"]), ["copilot"]);
  assert.deepEqual(cleanScopes([]), ["all"]);
  await assert.rejects(ai.brains.save({ title: "", text: "long enough text" }), /title/);
  await assert.rejects(ai.brains.save({ title: "x", text: "short" }), /instruction itself/);
  const a = (await ai.brains.save({ title: "First", text: "The first wording of the rule.", scopes: ["coach", "made-up"] })).brain;
  assert.deepEqual(a.scopes, ["coach"]);
  const b = (await ai.brains.save({ id: a.id, title: "First", text: "The second wording of the rule.", scopes: ["coach"] })).brain;
  assert.equal(b.history.length, 1);
  assert.equal(b.history[0].text, "The first wording of the rule.");
  const back = ai.brains.revert(a.id, { to: "history", index: 0 }).brain;
  assert.equal(back.text, "The first wording of the rule.");
  await assert.rejects(ai.brains.save({ id: "ffffffffffff", title: "x", text: "something long" }), /not there/);
  const c = (await ai.brains.save({ title: "Second", text: "Another rule for the order test." })).brain;
  assert.deepEqual(ai.brains.move(c.id, "up").brains.map((x) => x.title), ["Second", "First"]);
  assert.deepEqual(ai.brains.remove(c.id).brains.map((x) => x.title), ["First"]);
});

test("the AI team: seven free models write in parallel and the paid lead merges and places it; the owner's wording is kept", async () => {
  const { ai, seen } = boot();
  ai.setSettings({ provider: "nvidia", apiKey: KEYS.nvidia });
  ai.setSettings({ provider: "anthropic", apiKey: KEYS.anthropic, model: "claude-sonnet-5-5" });
  const r = await ai.brains.save({ title: "midday", text: "dont trade in lunch time unless strong", scopes: ["all"], refine: true }, "owner@example.com");
  assert.equal(r.refine.versions.length, 8, "the lead and seven free models");
  assert.equal(r.refine.mergedBy, "Claude Sonnet 5.5");
  assert.equal(r.brain.title, "Midday discipline");
  assert.deepEqual(r.brain.scopes, ["strategist", "copilot", "ensemble-live"], "placed where the team decided");
  assert.deepEqual(r.brain.original, { title: "midday", text: "dont trade in lunch time unless strong", scopes: ["all"] });
  assert.ok(r.brain.refined.by.length === 8);
  assert.equal(ai.ensemble.status().paidRunsToday, 1, "it counts against the same daily cap as AI Live");
  assert.ok(seen.filter((s) => /You help the owner of a private NSE/.test(s.system)).length === 8);
  // the owner can put their own wording back
  const back = ai.brains.revert(r.brain.id, { to: "original" }).brain;
  assert.deepEqual([back.title, back.scopes], ["midday", ["all"]]);
});

test("without a paid model the strongest free model merges; with no key at all the team says so", async () => {
  const { ai } = boot();
  await assert.rejects(ai.brains.save({ title: "x rule", text: "a rule to refine here", refine: true }), /No AI key is saved for the AI team/);
  ai.setSettings({ provider: "nvidia", apiKey: KEYS.nvidia });
  const r = await ai.brains.save({ title: "x rule", text: "a rule to refine here", refine: true });
  assert.equal(r.refine.lead, null);
  assert.match(r.refine.mergedBy, /Ultra/);
  assert.equal(r.brain.title, "Midday: stand aside");
});

test("when every model fails, nothing is saved and the reason is given", async () => {
  const { ai } = boot({ failFree: true });
  ai.setSettings({ provider: "nvidia", apiKey: KEYS.nvidia });
  await assert.rejects(ai.brains.save({ title: "x rule", text: "a rule to refine here", refine: true }), /Every model of the AI team failed/);
  assert.equal(ai.brains.list().brains.length, 0);
});
