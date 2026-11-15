"use strict";
// The AI Engine: every feature's model client comes through one door — the owner's brains on the
// way out, a shared lane per key so features using the same models at once wait their turn, and a
// live board of what runs now and today's counts. Fake companies only.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { AiService } = require("../ai/service");
const { Engine } = require("../ai/engine");
const tradeai = require("../ai/tradeai");

function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-eng-"));
  const store = { data: { settings: {} }, update(fn) { fn(this.data); } };
  const ai = new AiService({ dir, store, secrets: { encrypt: (x) => `enc:${x}`, decrypt: (x) => x.slice(4) }, market: { watchlist: () => [] }, fetchImpl: async () => new Response("{}"), now: () => Date.now(), log: { log() {}, error() {} } });
  return ai;
}

test("one door: the brains of the feature go out with every request, and the board counts it", async () => {
  const ai = boot();
  await ai.brains.save({ title: "Midday", text: "Between 11:30 and 13:30 prefer no trade.", scopes: ["tradeai"] }, "owner");
  const seen = [];
  const fake = { provider: "nvidia", model: "m-1", ask: async (a) => (seen.push(a.system), { data: { ok: true }, usage: { prompt_tokens: 10, completion_tokens: 4 } }) };
  const c = ai.engine.wrap(fake, { providerId: "nv-mistral" });
  await c.ask({ system: tradeai.SYSTEM, user: "u" });
  await c.ask({ system: "unregistered", user: "u" });
  assert.match(seen[0], /THE OWNER'S AI BRAINS[\s\S]*Midday/);
  assert.equal(seen[1], "unregistered", "no brains for a request that is not a feature");
  const st = ai.engine.status();
  const row = st.today.features.find((f) => f.id === "tradeai");
  assert.equal(row.calls, 1);
  assert.equal(row.input, 10);
  assert.equal(row.brains, 1);
  assert.equal(st.recent[0].feature, "other");
  assert.equal(st.running.length, 0);
  assert.equal(ai.engine.wrap(c), c, "never wrapped twice");
});

test("shared lanes: features using the same key at once queue instead of flooding the provider", async () => {
  const ai = boot();
  const eng = new Engine(ai);
  let inFlight = 0;
  let peak = 0;
  const release = [];
  const fake = { provider: "nvidia", model: "m", ask: () => new Promise((r) => { inFlight += 1; peak = Math.max(peak, inFlight); release.push(() => { inFlight -= 1; r({ data: {} }); }); }) };
  const c = eng.wrap(fake, { providerId: "nvidia" });
  const all = Array.from({ length: 12 }, () => c.ask({ system: "s" }));
  await new Promise((r) => setImmediate(r));
  assert.equal(peak, 8, "eight calls in flight on the free models' key");
  const st = eng.status();
  assert.equal(st.running.filter((x) => x.waiting).length, 4, "the rest wait their turn");
  assert.equal(st.lanes[0].waiting, 4);
  while (release.length) {
    release.shift()();
    await new Promise((r) => setImmediate(r));
  }
  await Promise.all(all);
  assert.equal(peak, 8);
  assert.equal(eng.status().lanes[0].busy, 0);
});

test("a failed request is counted and still frees its place in the lane", async () => {
  const ai = boot();
  const eng = new Engine(ai);
  const c = eng.wrap({ provider: "openai", model: "x", ask: async () => { throw new Error("down"); } }, { providerId: "openai" });
  await assert.rejects(c.ask({ system: tradeai.SYSTEM }), /down/);
  const st = eng.status();
  assert.equal(st.today.features.find((f) => f.id === "tradeai").failed, 1);
  assert.equal(st.recent[0].error, "down");
  assert.equal(st.lanes[0].busy, 0);
});

test("every AI feature in the service gets its client from the engine", () => {
  const ai = boot();
  ai.setSettings({ provider: "nvidia", apiKey: "nvapi-TESTONLYtestonlyTESTONLY1234567890" });
  assert.equal(ai._client().__engine, true, "the company in use");
  const src = ["ensemble.js", "mixture.js", "brains.js"].map((f) => fs.readFileSync(path.join(__dirname, "..", "ai", f), "utf8")).join("\n");
  assert.equal((src.match(/ai\.engine\.client\(/g) || []).length, 5, "the analysts, the paid lead, the mixture and the brains team");
});
