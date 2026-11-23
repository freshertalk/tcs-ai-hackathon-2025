"use strict";
// AI credit protection: a request to an AI company leaves the server only when a person pressed an AI button.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { SpendGuard } = require("../ai/spend");
const { FileDocs } = require("../docs");
const { makeClient } = require("../ai/providers");
const { AiService } = require("../ai/service");
const { ResearchAuto } = require("../research-auto");

const docs = () => new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-spend-")));
const quiet = { log() {}, error() {} };

test("a request to an AI company is refused unless a click began the work; reads and the owner's lifting are allowed", async () => {
  const g = new SpendGuard({ docs: docs(), log: quiet, enforce: true });
  assert.equal(g.allowed().ok, false);
  assert.throws(() => g.check("the news digest"), (e) => e.code === "not_asked" && e.status === 409 && /runs only when you press an AI button, so no credit was used/.test(e.message) && /the news digest/.test(e.message));
  let calls = 0;
  const inner = async () => (calls += 1, new Response("{}"));
  const f = g.wrapFetch(inner);
  await assert.rejects(f("https://api.anthropic.com/v1/messages", { method: "POST", body: "{}" }), { code: "not_asked" });
  assert.equal(calls, 0, "nothing left the server");
  // listing models is a GET and costs nothing
  await f("https://api.anthropic.com/v1/models", { method: "GET" });
  await f("https://api.anthropic.com/v1/models");
  assert.equal(calls, 2);
  // a click
  await g.run({ click: true, by: "owner", route: "POST /api/admin/ai/x" }, () => f("https://api.anthropic.com/v1/messages", { method: "POST", body: "{}" }));
  assert.equal(calls, 3);
  // not a click (a page being read, the co-pilot's own reading)
  await assert.rejects(g.run({ click: false, route: "GET /x" }, () => f("https://api.openai.com/v1/responses", { method: "POST" })), { code: "not_asked" });
  // the refusals are counted and listed
  const st = g.status();
  assert.equal(st.blockedToday, 3);
  assert.ok(st.blocked.some((x) => /the news digest/.test(x.what)));
  assert.ok(st.blocked.some((x) => /api.anthropic.com/.test(x.what) && x.n === 1));
  // the owner lifts it
  g.setAuto(true, "owner");
  await f("https://api.anthropic.com/v1/messages", { method: "POST" });
  assert.equal(calls, 4);
  assert.equal(g.status().auto, true);
  g.setAuto(false, "owner");
  await assert.rejects(f("https://api.anthropic.com/v1/messages", { method: "POST" }), { code: "not_asked" });
});

test("the click follows the work wherever it goes: after awaits, in timers made by the request, in a job that outlives it — not in a timer made at start-up", async () => {
  const g = new SpendGuard({ docs: docs(), log: quiet, enforce: true });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let startupTimer;
  const fromTimer = new Promise((resolve) => {
    startupTimer = setTimeout(() => resolve(g.clicked()), 5); // made before any request, like the app's watchers
  });
  const seen = await g.run({ click: true }, async () => {
    const out = [g.clicked()];
    await sleep(2);
    out.push(g.clicked());
    out.push(await new Promise((r) => setTimeout(() => r(g.clicked()), 3)));
    // a job started by the click carries on for a while after the answer
    const job = (async () => {
      await sleep(10);
      return g.clicked();
    })();
    out.push(await job);
    return out;
  });
  assert.deepEqual(seen, [true, true, true, true]);
  assert.equal(await fromTimer, false);
  clearTimeout(startupTimer);
  assert.equal(g.clicked(), false, "outside any request");
  // two requests at once do not mix
  const [a, b] = await Promise.all([g.run({ click: true }, async () => (await sleep(5), g.clicked())), g.run({ click: false }, async () => (await sleep(1), g.clicked()))]);
  assert.deepEqual([a, b], [true, false]);
});

test("not enforced (tests, tools): everything passes and nothing is counted", async () => {
  const g = new SpendGuard({ docs: docs(), log: quiet });
  assert.equal(g.autoAllowed(), true);
  let calls = 0;
  await g.wrapFetch(async () => (calls += 1, new Response("{}")))("https://x.test", { method: "POST" });
  assert.equal(calls, 1);
  assert.equal(g.status().blockedToday, 0);
});

const claudeFetch = () => {
  const f = { requests: [] };
  f.fetch = async (url, init) => {
    f.requests.push({ url: String(url), method: (init && init.method) || "GET" });
    return new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [{ type: "text", text: JSON.stringify({ ok: true }) }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return f;
};
const KEY = "sk-ant-api03-TESTONLYtestonlyTESTONLY1234567890abcd";

test("every model client the AI service builds goes through the guard: a click asks, a timer does not — and a held answer is still free", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-spend-svc-"));
  const claude = claudeFetch();
  const ai = new AiService({ dir, store: { data: { settings: {} }, update(fn) { fn(this.data); } }, secrets: { encrypt: (x) => x, decrypt: (x) => x }, market: {}, fetchImpl: claude.fetch, log: quiet });
  ai.guard.enforce = true;
  const client = () => ai.engine.client({ providerId: "anthropic", apiKey: KEY, model: "claude-sonnet-5-5" }, { feature: "strategist" });
  const ask = (c) => c.ask({ system: "You are a test.", user: "Say ok.", schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } });
  // a timer, a watcher, anything nobody pressed a button for
  await assert.rejects(ask(client()), { code: "not_asked" });
  assert.equal(claude.requests.length, 0, "no request reached the AI company");
  // a click
  const r = await ai.guard.run({ click: true, by: "owner" }, () => ask(client()));
  assert.equal(r.data.ok, true);
  assert.equal(claude.requests.length, 1);
  // the same question again, from a timer: the engine's cache holds the answer, which costs nothing, so it is served
  const again = await ask(client());
  assert.equal(again.cached, true);
  assert.equal(claude.requests.length, 1);
  // the engine named what was held back
  const other = client();
  await assert.rejects(other.ask({ system: "Another question.", user: "Why?", schema: { type: "object", properties: {}, additionalProperties: false } }), { code: "not_asked" });
  assert.ok(ai.guard.status().blocked.length >= 1);
  // other companies' clients built directly are guarded the same way
  const compat = makeClient({ providerId: "openai", apiKey: "sk-test", model: "gpt-x", fetchImpl: ai.fetch });
  await assert.rejects(compat.ask({ system: "s", user: "u", schema: { type: "object", properties: {} } }), { code: "not_asked" });
  assert.equal(claude.requests.length, 1);
  // Anthropic's own client, built without the engine: the SDK wraps what fetch throws, and the refusal still comes out as itself
  const raw = makeClient({ providerId: "anthropic", apiKey: KEY, model: "claude-sonnet-5-5", fetchImpl: ai.fetch });
  await assert.rejects(raw.ask({ system: "s", user: "u", schema: { type: "object", properties: {} } }), { code: "not_asked" });
  assert.equal(claude.requests.length, 1);
});

test("the morning research writes no AI notes on its own while the protection is on, and does when the owner lifted it", () => {
  const started = [];
  const mk = (auto) =>
    new ResearchAuto({
      ai: { configured: () => true, guard: { autoAllowed: () => auto }, research: { start: (o) => started.push(o) } },
      market: { mode: () => "kite" },
      docs: docs(),
      now: () => Date.parse("2026-11-17T03:25:00Z"), // 08:55 IST on a Tuesday
      log: quiet,
    });
  const r1 = mk(false);
  r1.set({ enabled: true, withAi: true });
  r1.tick();
  assert.equal(started.length, 1);
  assert.equal(started[0].useAi, false);
  assert.equal(started[0].news, false);
  assert.equal(started[0].world, false);
  const r2 = mk(true);
  r2.set({ enabled: true, withAi: true });
  r2.tick();
  assert.equal(started[1].useAi, true);
  assert.equal(started[1].world, true);
});

test("asking instead of failing: an automatic wish becomes an ask; Allow runs it as a click; Not now snoozes it", async () => {
  const { SpendGuard, wantAi } = require("../ai/spend");
  let t = Date.parse("2026-11-23T05:00:00Z");
  const g = new SpendGuard({ now: () => t, log: { log() {}, error() {} }, enforce: true });
  let told = 0;
  g.onAsk = () => (told += 1);
  let ran = 0;
  const run = async () => {
    ran += 1;
    return g.clicked() ? "ran as a click" : "ran";
  };
  // a timer (no click): it does not run, it asks
  assert.equal(await g.wants({ key: "picks-review", feature: "Research Top 10 — the AI's review", why: "the Top 10 changed" }, run), null);
  assert.equal(ran, 0);
  assert.equal(told, 1);
  await g.wants({ key: "picks-review", feature: "Research Top 10 — the AI's review", why: "the Top 10 changed" }, run);
  assert.equal(g.asks().length, 1, "the same wish is one ask");
  assert.equal(g.asks()[0].n, 2);
  assert.equal(told, 1, "a repeat does not tell the pages again");
  assert.equal(g.asks()[0].run, undefined, "the function is not listed");
  // Allow, inside a click: it runs now and leaves the list
  const out = await g.run({ click: true, by: "owner" }, () => g.allowAsk("picks-review"));
  assert.equal(out, "ran as a click");
  assert.equal(ran, 1);
  assert.equal(g.asks().length, 0);
  assert.equal(g.allowAsk("picks-review"), null, "gone");
  // Not now: quiet for two hours, then it may ask again
  await g.wants({ key: "index-ai:nifty:month", feature: "Indices — the month's projection" }, run);
  assert.equal(g.dismissAsk("index-ai:nifty:month"), true);
  await g.wants({ key: "index-ai:nifty:month", feature: "Indices — the month's projection" }, run);
  assert.equal(g.asks().length, 0, "snoozed");
  t += 2 * 3600000 + 1;
  await g.wants({ key: "index-ai:nifty:month", feature: "Indices — the month's projection" }, run);
  assert.equal(g.asks().length, 1, "it may ask again later");
  // an ask expires after three hours
  t += 3 * 3600000 + 1;
  assert.equal(g.asks().length, 0);
  // when the rule allows it (a click, or the owner lifted the protection) it simply runs
  assert.equal(await g.run({ click: true }, () => g.wants({ key: "x", feature: "x" }, run)), "ran as a click");
  g.setAuto(true, "owner");
  assert.equal(await g.wants({ key: "y", feature: "y" }, run), "ran");
  // a feature without the guard runs as before
  assert.equal(await wantAi(null, { key: "z" }, async () => "plain"), "plain");
  // never more than twelve asks
  g.setAuto(false, "owner");
  for (let i = 0; i < 20; i += 1) await g.wants({ key: `k${i}`, feature: `f${i}` }, run);
  assert.equal(g.asks().length, 12);
});
