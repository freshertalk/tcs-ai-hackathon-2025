"use strict";
// TradeAI against FAKE companies and a fake market: the plan, the router (instant data answers, one
// fast model, one model for advice, the merged mixture for Deep), the fallback one by one, the learned
// speeds, the paid model's limits, and the desk's own answer when every model fails.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { AiService } = require("../ai/service");

const KEY = "nvapi-TESTONLYtestonlyTESTONLY1234567890";
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

function boot({ failModels = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-tai-"));
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    const body = init.body ? JSON.parse(init.body) : {};
    if (!u.includes("integrate.api.nvidia.com")) return json(404, {});
    if (/\/models/.test(u)) return json(200, { data: [] });
    const sys = (body.messages || []).find((m) => m.role === "system");
    const user = (body.messages || []).find((m) => m.role === "user");
    calls.push({ model: body.model, merge: /You merge several analysts/.test(sys.content), user: user.content });
    if (failModels.some((f) => body.model.includes(f))) return json(500, { error: { message: "down" } });
    const merge = /You merge several analysts/.test(sys.content);
    const reply = { answer: merge ? "MERGED: SBIN is above VWAP 803.2 with RSI 61; the long holds while 799 holds." : `${body.model}: SBIN looks firm.`, datapoints: [{ label: "VWAP", value: "803.2" }], actions: [{ kind: "corrective", text: "Keep the stop at 799." }], forecast: { lean: "up", horizon: "next 30 minutes", scenarios: ["Above 809: 813"] }, confidence: "medium", followups: ["What if it breaks 799?"] };
    return json(200, { model: body.model, choices: [{ message: { role: "assistant", content: JSON.stringify(reply) }, finish_reason: "stop" }], usage: { prompt_tokens: 500, completion_tokens: 120 } });
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

test("a question of judgement goes to ONE model — the strongest free one with no paid key — and Deep brings the merged mixture", async () => {
  const { ai, calls } = boot();
  ai.setSettings({ provider: "nvidia", apiKey: KEY });
  const r = await ai.tradeai.answer("Should I hold SBIN?", { owner: true });
  assert.equal(r.meta.tier, "advice");
  assert.equal(r.meta.by.length, 1, "one model answers");
  assert.match(r.meta.by[0], /Ultra/, "with no paid key, the strongest free model");
  assert.equal(calls.length, 1, "no other model was asked");
  assert.match(r.answer, /SBIN looks firm/);
  assert.equal(r.forecast.lean, "up");
  assert.equal(r.actions[0].kind, "corrective");
  assert.ok(r.meta.used.includes("SBIN") && r.meta.used.includes("positions"));
  assert.match(calls[0].user, /"symbol":"SBIN"/);
  assert.match(calls[0].user, /"vwap":803.2/);
  assert.match(calls[0].user, /The trader asks: Should I hold SBIN\?/);
  const d = await ai.tradeai.answer("Should I hold SBIN?", { owner: true, mode: "deep" });
  assert.equal(d.meta.tier, "deep");
  assert.match(d.answer, /^MERGED/);
  assert.equal(d.meta.by.length, 3, "three models in the mixture");
});

test("Fast: the quickest model first, one at a time; when it fails the next is asked, and speeds are learned", async () => {
  const fails = [];
  const { ai, calls } = boot({ failModels: fails });
  ai.setSettings({ provider: "nvidia", apiKey: KEY });
  const order = ai.tradeai._fastest();
  assert.ok(order.length >= 2);
  fails.push(order[0].model);
  const r = await ai.tradeai.answer("How is SBIN?", { owner: false });
  assert.equal(r.meta.tier, "fast");
  assert.equal(r.meta.fallback, true);
  assert.deepEqual(r.meta.by, [order[1].name]);
  assert.deepEqual(calls.map((c) => c.model), [order[0].model, order[1].model], "one model at a time, never in parallel");
  const sp = ai.tradeai._speeds();
  assert.ok(sp[order[1].id].ms >= 0 && sp[order[0].id].fail === 1, "the answer's speed and the failure are remembered");
  assert.notEqual(ai.tradeai._fastest()[0].id, order[0].id, "a model that failed is no longer asked first");
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
  assert.match(f.answer, /desk's own arithmetic/);
  assert.match(f.answer, /SBIN long 40 @ ₹800 → ₹806/);
});

test("the paid model: used only when switched on and under the daily limit", async () => {
  const { ai } = boot();
  ai.ensemble._lead = () => ({ id: "anthropic|claude-sonnet-5-5", provider: "anthropic", model: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", lead: true });
  assert.equal(ai.tradeai._paid().name, "Claude Sonnet 5.5");
  ai.tradeai.setSettings({ paidDailyCap: 1 });
  ai.tradeai._countPaid();
  assert.equal(ai.tradeai._paid(), null, "the day's limit is reached");
  ai.tradeai.setSettings({ paidDailyCap: 50, usePaid: false });
  assert.equal(ai.tradeai._paid(), null, "switched off");
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
  ai.setSettings({ provider: "nvidia", apiKey: KEY });
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
  ai.setSettings({ provider: "nvidia", apiKey: KEY });
  const me = "owner@example.com";
  const a = await ai.tradeai.start({ text: "How is SBIN?", owner: me, isOwner: true });
  await until(ai, a.job, me);
  const b = await ai.tradeai.start({ text: "Market mood?", owner: me, isOwner: true });
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
  ai.setSettings({ provider: "nvidia", apiKey: KEY });
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
