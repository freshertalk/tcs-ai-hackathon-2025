"use strict";
// TradeAI against FAKE companies and a fake market: the plan, the router (instant data answers; the
// default model — Claude Sonnet 5.5 — brief for light questions, fuller for advice, thinking longer for
// Deep), the fallback company one at a time, the learned speeds, the daily limit, and the desk's own
// answer when no model can answer.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { AiService } = require("../ai/service");

const KEYS = { anthropic: "sk-ant-api03-TESTONLYtestonlyTESTONLY1234567890abcd", openai: "sk-TESTONLYtestonlyTESTONLY1234567890abcd" };
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
const REPLY = (by) => ({ answer: `${by}: SBIN looks firm.`, datapoints: [{ label: "VWAP", value: "803.2" }], actions: [{ kind: "corrective", text: "Keep the stop at 799." }], forecast: { lean: "up", horizon: "next 30 minutes", scenarios: ["Above 809: 813"] }, confidence: "medium", followups: ["What if it breaks 799?"] });

function boot({ fail = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-tai-"));
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    const body = init.body ? JSON.parse(init.body) : {};
    if (u.includes("api.anthropic.com")) {
      // the default model (the Messages API)
      calls.push({ company: "anthropic", model: body.model, maxTokens: body.max_tokens, effort: body.output_config && body.output_config.effort, user: body.messages[0].content });
      if (fail.anthropic) return json(400, { type: "error", error: { type: "invalid_request_error", message: "down" } });
      return json(200, { id: "m", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: JSON.stringify(REPLY(body.model)) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 500, output_tokens: 120 } });
    }
    if (u.includes("api.openai.com")) {
      // the fallback company (OpenAI-style chat completions)
      const user = (body.messages || []).find((m) => m.role === "user");
      calls.push({ company: "openai", model: body.model, user: user.content });
      if (fail.openai) return json(400, { error: { message: "down" } });
      return json(200, { model: body.model, choices: [{ message: { role: "assistant", content: JSON.stringify(REPLY(body.model)) }, finish_reason: "stop" }], usage: { prompt_tokens: 500, completion_tokens: 120 } });
    }
    return json(404, {});
  };
  const market = {
    mode: () => "kite",
    now: () => Date.now(),
    watchlist: () => ["SBIN", "INFY"],
    instruments: async () => [{ symbol: "SBIN" }, { symbol: "INFY" }, { symbol: "TCS" }],
    async verdict() {
      return { available: true, last: 806, stance: "Bullish", summary: "Bullish.", frames: [{ name: "Daily", label: "Up" }], day: { available: true, state: "long", headline: "LONG — in play", score: 52, movement: { vwap: 803.2, rsi5: 61 } }, ladder: [{ label: "VWAP", price: 803.2 }, { label: "R1", price: 812 }], movement: { atr: 14 } };
    },
    async analysis() {
      return { enoughData: true, score: { value: 48, label: "Bullish" }, indicators: { rsi14: 63 }, patterns: [{ name: "Hammer", bias: "bullish" }], setups: [], bearish: [], levels: { week52: { high: 860 } } };
    },
    async quotes(s) {
      return { quotes: Object.fromEntries(s.map((x) => [x, { last: 806, changePct: 0.7, buyQty: 6, sellQty: 4, avgPrice: 803.2, volume: 1000 }])) };
    },
    async context() {
      return { available: true, tide: { score: 30, label: "Rising", summary: "Rising tide" }, sectors: [] };
    },
    alerts: () => ({ alerts: [] }),
  };
  const store = { data: { settings: {} }, update(fn) { fn(this.data); } };
  const ai = new AiService({ dir, store, secrets: { encrypt: (x) => `enc:${Buffer.from(x).toString("base64")}`, decrypt: (x) => Buffer.from(x.slice(4), "base64").toString() }, market, fetchImpl, now: () => Date.now(), log: { log() {} } });
  ai.ensemble.outlook = async () => ({ available: true, lean: "up", score: 30, scenarios: [] });
  ai.tradeai.account = {
    positions: async () => [{ symbol: "SBIN", exchange: "NSE", product: "MIS", quantity: 40, average: 800, last: 806, pnl: 240, m2m: 240 }],
    funds: async () => ({ equity: { net: 50000, used: 6400 } }),
    history: async () => ({ last30: { days: 5, net: 1200 } }),
  };
  return { ai, calls };
}

test("the plan finds the stocks and the data a question needs", async () => {
  const { ai } = boot();
  const p = await ai.tradeai.plan("should I hold sbin today or exit? what about TCS", { owner: true });
  assert.deepEqual(p.symbols, ["SBIN", "TCS"]);
  assert.ok(p.tools.includes("snapshot"));
  const p2 = await ai.tradeai.plan("how did i do this month, my profit and loss?", { owner: true });
  assert.ok(p2.tools.includes("pnl"));
  const p3 = await ai.tradeai.plan("what will the market do tomorrow", { owner: false });
  assert.ok(p3.tools.includes("market") && p3.tools.includes("outlook") && !p3.tools.includes("positions"));
});

test("every question that needs a model goes to the default model, Claude Sonnet 5.5 — brief when light, fuller for advice, thinking longer for Deep", async () => {
  const { ai, calls } = boot();
  ai.setSettings({ provider: "anthropic", apiKey: KEYS.anthropic });
  const st = ai.tradeai.status();
  assert.equal(st.lead.name, "Claude Sonnet 5.5");
  assert.deepEqual(st.models.map((m) => m.name), ["Claude Sonnet 5.5"]);
  assert.equal(st.fastest, undefined, "no free-model speed list is left");

  const r = await ai.tradeai.answer("Should I hold SBIN?", { owner: true });
  assert.equal(r.meta.tier, "advice");
  assert.deepEqual(r.meta.by, ["Claude Sonnet 5.5"]);
  assert.equal(calls.length, 1, "one request");
  assert.deepEqual([calls[0].model, calls[0].maxTokens, calls[0].effort], ["claude-sonnet-5-5", 8000, "low"]);
  assert.match(r.answer, /SBIN looks firm/);
  assert.equal(r.forecast.lean, "up");
  assert.equal(r.actions[0].kind, "corrective");
  assert.ok(r.meta.used.includes("SBIN") && r.meta.used.includes("positions"));
  assert.match(calls[0].user, /"symbol":"SBIN"/);
  assert.match(calls[0].user, /"vwap":803.2/);
  assert.match(calls[0].user, /The trader asks: Should I hold SBIN\?/);

  const d = await ai.tradeai.answer("Should I hold SBIN?", { owner: true, mode: "deep" });
  assert.equal(d.meta.tier, "deep");
  assert.deepEqual(d.meta.by, ["Claude Sonnet 5.5"]);
  assert.deepEqual([calls[1].maxTokens, calls[1].effort], [16000, "medium"], "Deep thinks longer");

  const f = await ai.tradeai.answer("How is SBIN?", { owner: false });
  assert.equal(f.meta.tier, "fast");
  assert.deepEqual([calls[2].maxTokens, calls[2].effort], [4000, "low"], "a light question gets a brief answer");
  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => c.company === "anthropic"));

  // another default picked on the AI page is used from the next question
  ai.setSettings({ provider: "anthropic", model: "claude-opus-5-5" });
  const o = await ai.tradeai.answer("Should I hold SBIN?", { owner: true });
  assert.deepEqual(o.meta.by, ["Claude Opus 5.5"]);
  assert.equal(calls[3].model, "claude-opus-5-5");
});

test("when the default model fails the fallback company is asked, one at a time, and speeds are learned; with the fallback off, the desk answers", async () => {
  const { ai, calls } = boot({ fail: { anthropic: true } });
  ai.setSettings({ provider: "anthropic", apiKey: KEYS.anthropic });
  ai.setSettings({ provider: "openai", apiKey: KEYS.openai, use: false });
  assert.deepEqual(ai.tradeai.status().models.map((m) => [m.company, m.fallback]), [["Anthropic", false], ["OpenAI", true]]);
  const r = await ai.tradeai.answer("How is SBIN?", { owner: false });
  assert.equal(r.meta.tier, "fast");
  assert.equal(r.meta.fallback, true);
  assert.equal(r.meta.engineOnly, false);
  assert.deepEqual(calls.map((c) => c.company), ["anthropic", "openai"], "one model at a time, never in parallel");
  const sp = ai.tradeai._speeds();
  assert.equal(sp["anthropic|claude-sonnet-5-5"].fail, 1, "the failure is remembered");
  assert.ok(sp[`openai|${calls[1].model}`].ms >= 0, "and the fallback's answer time");
  assert.equal(ai.tradeai.settings().paidToday, 1, "an answer counts once against the day's limit");

  ai.setSettings({ fallback: false });
  const off = await ai.tradeai.answer("How is SBIN?", { owner: false });
  assert.equal(off.meta.engineOnly, true);
  assert.match(off.answer, /did not answer just now, so this is the desk's own arithmetic/);
  assert.equal(calls.filter((c) => c.company === "openai").length, 1, "the fallback was not asked again");
});

test("data questions are answered instantly from the desk's data — no model; and with no AI the desk's arithmetic answers", async () => {
  const { ai, calls } = boot();
  const r = await ai.tradeai.answer("Show my positions", { owner: true });
  assert.equal(r.meta.tier, "instant");
  assert.equal(calls.length, 0, "no model was asked");
  assert.match(r.answer, /\| SBIN \| long \| 40 \|/);
  const q = await ai.tradeai.answer("What is the price of SBIN?", { owner: false });
  assert.equal(q.meta.tier, "instant");
  assert.match(q.answer, /\*\*SBIN\*\* is at \*\*₹806.00\*\*/);
  const f = await ai.tradeai.answer("Should I exit SBIN?", { owner: true });
  assert.equal(f.meta.engineOnly, true);
  assert.match(f.answer, /No AI key is saved — the default model is Claude Sonnet 5\.5/);
  assert.match(f.answer, /desk's own arithmetic/);
  assert.equal(calls.length, 0);
  assert.match(f.answer, /SBIN long 40 @ ₹800 → ₹806/);
});

test("the AI model: used only when switched on and under the daily limit; otherwise the desk's arithmetic says why", async () => {
  const { ai, calls } = boot();
  ai.setSettings({ provider: "anthropic", apiKey: KEYS.anthropic });
  assert.equal(ai.tradeai._models()[0].name, "Claude Sonnet 5.5");
  ai.tradeai.setSettings({ paidDailyCap: 1 });
  ai.tradeai._countPaid();
  assert.deepEqual(ai.tradeai._models(), [], "the day's limit is reached");
  const capped = await ai.tradeai.answer("Should I hold SBIN?", { owner: true });
  assert.equal(capped.meta.engineOnly, true);
  assert.match(capped.answer, /Today's limit of 1 model answers is reached/);
  ai.tradeai.setSettings({ paidDailyCap: 50, usePaid: false });
  assert.deepEqual(ai.tradeai._models(), [], "switched off");
  const off = await ai.tradeai.answer("Should I hold SBIN?", { owner: true });
  assert.match(off.answer, /switched off/);
  assert.equal(calls.length, 0, "no model was asked");
  assert.throws(() => ai.tradeai.setSettings({ mode: "turbo" }), /auto, fast or deep/);
  assert.equal(ai.tradeai.setSettings({ mode: "fast", usePaid: true }).mode, "fast");
});

const until = async (ai, job, owner) => {
  let j = job;
  for (let i = 0; i < 300 && !j.finishedAt; i += 1) {
    await new Promise((r) => setTimeout(r, 10));
    j = ai.tradeai.job(job.id, owner);
  }
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 5)); // the save after the answer
  return j;
};

test("a chat turn runs as a job and is saved as its own record, per owner", async () => {
  const { ai } = boot();
  ai.setSettings({ provider: "anthropic", apiKey: KEYS.anthropic });
  const { job, conv } = await ai.tradeai.start({ text: "How is SBIN?", owner: "owner@example.com", isOwner: true });
  const j = await until(ai, job, "owner@example.com");
  assert.equal(j.error, "");
  assert.ok(j.steps.length >= 2);
  const c = await ai.tradeai.get(conv, "owner@example.com");
  assert.deepEqual(c.messages.map((m) => m.role), ["user", "assistant"]);
  assert.ok(c.messages.every((m) => m.id), "every message has an id");
  assert.ok(Array.isArray(c.messages[1].reply.related) && c.messages[1].reply.related.length >= 2, "related questions come with the answer");
  assert.ok(c.messages[1].reply.meta.sec >= 0);
  assert.equal(ai.docs.read(`tradeai/chats/${conv}.json`).id, conv, "the chat is its own record");
  assert.equal((await ai.tradeai.list("someone@else.com")).convs.length, 0, "another person never sees it");
  await assert.rejects(ai.tradeai.get(conv, "someone@else.com"), /not there/);
  assert.throws(() => ai.tradeai.job(job.id, "someone@else.com"), /no longer kept/);
});

test("rename, pin, search, edit from an earlier question, and delete — which removes the record", async () => {
  const { ai } = boot();
  ai.setSettings({ provider: "anthropic", apiKey: KEYS.anthropic });
  const me = "owner@example.com";
  const a = await ai.tradeai.start({ text: "How is SBIN?", owner: me, isOwner: true });
  await until(ai, a.job, me);
  const b = await ai.tradeai.start({ text: "Why is the market mood weak?", owner: me, isOwner: true });
  await until(ai, b.job, me);
  await ai.tradeai.rename(a.conv, me, "  SBIN   check ");
  const pinned = await ai.tradeai.pin(b.conv, me, true);
  assert.equal(pinned.convs[0].id, b.conv, "pinned chats come first");
  assert.equal(pinned.convs.find((c) => c.id === a.conv).title, "SBIN check");
  assert.deepEqual((await ai.tradeai.list(me, { q: "looks firm" })).convs.map((c) => c.id).sort(), [a.conv, b.conv].sort(), "search reads the messages too");
  assert.deepEqual((await ai.tradeai.list(me, { q: "sbin check" })).convs.map((c) => c.id), [a.conv]);
  // edit: go back to the first question and ask something else
  const e = await ai.tradeai.start({ conv: a.conv, text: "How is INFY?", owner: me, isOwner: true, from: 0 });
  await until(ai, e.job, me);
  const c = await ai.tradeai.get(a.conv, me);
  assert.deepEqual(c.messages.map((m) => m.role), ["user", "assistant"]);
  assert.equal(c.messages[0].text, "How is INFY?");
  // delete: gone from the database
  const left = await ai.tradeai.remove(a.conv, me);
  assert.deepEqual(left.convs.map((x) => x.id), [b.conv]);
  assert.equal(ai.docs.read(`tradeai/chats/${a.conv}.json`, null), null, "the record is deleted");
  await assert.rejects(ai.tradeai.get(a.conv, me), /not there/);
});

test("stop: an answer that arrives after Stop is not kept", async () => {
  const { ai } = boot();
  ai.setSettings({ provider: "anthropic", apiKey: KEYS.anthropic });
  const me = "owner@example.com";
  const { job, conv } = await ai.tradeai.start({ text: "How is SBIN?", owner: me, isOwner: true });
  const j = ai.tradeai.cancel(job.id, me);
  assert.equal(j.cancelled, true);
  for (let i = 0; i < 60; i += 1) await new Promise((r) => setTimeout(r, 10));
  const c = await ai.tradeai.get(conv, me);
  assert.deepEqual(c.messages.map((m) => m.role), ["user"], "only the question stays");
});

test("suggestions put what you are most likely to ask first: a losing position, then the rest", async () => {
  const { ai } = boot();
  ai.tradeai.account.positions = async () => [
    { symbol: "SBIN", exchange: "NSE", quantity: 40, average: 800, last: 806, pnl: 240 },
    { symbol: "INFY", exchange: "NSE", quantity: -10, average: 1500, last: 1530, pnl: -300 },
  ];
  ai.tradeai.account.orders = async () => [{ symbol: "TCS", side: "BUY", quantity: 5, price: 3900 }];
  ai.tradeai.account.today = async () => [{ symbol: "HDFCBANK", side: "long", net: -420 }];
  const r = await ai.tradeai.suggest({ isOwner: true });
  assert.match(r.suggestions[0].text, /INFY short is down ₹300/);
  assert.equal(r.suggestions[0].kind, "position");
  assert.ok(r.suggestions.some((x) => /order for TCS at ₹3900/.test(x.text)), "a pending order");
  assert.ok(r.suggestions.some((x) => /HDFCBANK/.test(x.text)), "today's losing trade");
  assert.ok(r.suggestions.length <= 8 && r.suggestions.every((x) => x.why));
  const guest = await ai.tradeai.suggest({ isOwner: false });
  assert.ok(!guest.suggestions.some((x) => x.kind === "position" || x.kind === "order"), "account questions only for the owner");
});

test("the old single chat record moves into one record per chat, once", async () => {
  const { ai } = boot();
  ai.docs.write("ai/tradeai.json", { convs: [{ id: "abc123abc123", owner: "o@x.com", title: "Old chat", createdAt: "2026-11-14T10:00:00.000Z", updatedAt: "2026-11-14T10:00:00.000Z", messages: [{ role: "user", text: "hi" }] }] });
  const { ChatStore } = require("../ai/chats");
  const st = new ChatStore(ai.docs);
  const list = await st.list("o@x.com");
  assert.equal(list[0].title, "Old chat");
  assert.equal(ai.docs.read("ai/tradeai.json", null), null, "the old record is removed");
});

test("on MongoDB every chat is a document in tradeai_chats, and delete removes it", async () => {
  const { ChatStore } = require("../ai/chats");
  const rows = new Map();
  const match = (d, f) =>
    Object.entries(f).every(([k, v]) => {
      if (k === "$or") return v.some((x) => match(d, x));
      if (v && v.$regex) {
        const re = new RegExp(v.$regex, v.$options);
        return k === "messages.text" ? (d.messages || []).some((m) => re.test(m.text)) : re.test(d[k]);
      }
      return d[k] === v;
    });
  const col = {
    createIndex: async () => "ok",
    replaceOne: async (f, doc) => rows.set(f._id, JSON.parse(JSON.stringify(doc))),
    findOne: async (f) => [...rows.values()].find((d) => match(d, f)) || null,
    deleteOne: async (f) => {
      const d = [...rows.values()].find((x) => match(x, f));
      if (d) rows.delete(d._id);
      return { deletedCount: d ? 1 : 0 };
    },
    find: (f) => {
      let out = [...rows.values()].filter((d) => match(d, f)).map(({ messages, ...rest }) => rest);
      const cur = { sort: () => cur, limit: () => cur, toArray: async () => out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)) };
      return cur;
    },
  };
  const docs = { kind: "mongodb", db: { collection: (n) => (assert.equal(n, "tradeai_chats"), col) }, read: () => null, write() {}, remove() {} };
  const st = new ChatStore(docs);
  await st.put({ id: "aaaaaa111111", owner: "o@x.com", title: "SBIN", createdAt: "a", updatedAt: "2026-11-15T09:00:00Z", messages: [{ role: "user", text: "how is sbin" }] });
  await st.put({ id: "bbbbbb222222", owner: "o@x.com", title: "Market", createdAt: "a", updatedAt: "2026-11-15T10:00:00Z", messages: [{ role: "user", text: "market mood" }] });
  assert.equal(rows.size, 2);
  assert.deepEqual((await st.list("o@x.com")).map((c) => c.id), ["bbbbbb222222", "aaaaaa111111"]);
  assert.deepEqual((await st.list("o@x.com", { q: "SBIN" })).map((c) => c.id), ["aaaaaa111111"]);
  assert.equal((await st.get("aaaaaa111111", "o@x.com")).messages[0].text, "how is sbin");
  assert.equal(await st.get("aaaaaa111111", "other@x.com"), null);
  assert.equal(await st.remove("aaaaaa111111", "other@x.com"), false, "never someone else's");
  assert.equal(await st.remove("aaaaaa111111", "o@x.com"), true);
  assert.equal(rows.size, 1, "the document is gone from the database");
});

test("WhatsApp gets TradeAI's Markdown as plain WhatsApp text", () => {
  const { toWhatsApp } = require("../whatsapp");
  const t = toWhatsApp("**Hold** above 799.\n\n### Levels\n| Level | Price |\n|---|---|\n| VWAP | 803.2 |\n- Keep the stop");
  assert.match(t, /^\*Hold\* above 799\./);
  assert.match(t, /\*Levels\*/);
  assert.match(t, /• VWAP · 803\.2/);
  assert.ok(!t.includes("|---"));
  assert.match(t, /• Keep the stop/);
});

test("a stock named in the question is found in Zerodha's instrument list (its symbol field is \"s\"), not only on the watchlist", async () => {
  const { TradeAI } = require("../ai/tradeai");
  const t = new TradeAI({ market: { watchlist: () => [], instruments: async () => [{ s: "HDFCBANK", n: "HDFC BANK", k: "EQ" }, { s: "NIFTY 50", k: "INDEX" }] }, now: () => Date.now(), docs: null });
  assert.deepEqual(await t._symbols("Should I buy HDFCBANK today?", new Set()), ["HDFCBANK"]);
});

test("the same question on unchanged data is answered with the answer already paid for; Retry and a new default model ask again", async () => {
  const { ai, calls } = boot();
  ai.setSettings({ provider: "anthropic", apiKey: KEYS.anthropic });
  const q = "Should I hold SBIN or exit?";
  const a = await ai.tradeai.answer(q, { owner: true });
  assert.equal(calls.length, 1);
  assert.ok(!a.meta.reused);
  const b = await ai.tradeai.answer(q, { owner: true });
  assert.equal(calls.length, 1, "no second AI call");
  assert.equal(b.meta.reused, true);
  assert.equal(b.answer, a.answer);
  assert.deepEqual(b.meta.usage, { input: 0, output: 0 });
  await ai.tradeai.answer(q, { owner: true, fresh: true });
  assert.equal(calls.length, 2, "Retry asks the model again");
  await ai.tradeai.answer("Should I hold INFY or exit?", { owner: true });
  assert.equal(calls.length, 3, "another question is a new call");
  ai.setSettings({ provider: "anthropic", model: "claude-opus-5-5" });
  await ai.tradeai.answer(q, { owner: true });
  assert.equal(calls.length, 4, "a new default model answers afresh");
});
