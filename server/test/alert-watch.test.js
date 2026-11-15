"use strict";
// Alerts that fire with no page open, and the Telegram messages that carry them. No network: a
// fake market and a fake Telegram.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { AlertWatch, nseOpen } = require("../alert-watch");
const { Notifier } = require("../notify");
const { FileDocs } = require("../docs");

const at = (s) => Date.parse(`${s}+05:30`);
const secrets = { encrypt: (x) => `enc:${Buffer.from(x).toString("base64")}`, decrypt: (x) => Buffer.from(x.slice(4), "base64").toString() };
const TOKEN = "123456789:AAtestonlyTESTONLYtestonlyTESTONLY12345";

function fakeMarket(alerts, prices, mode = "kite") {
  return {
    list: alerts,
    mode: () => mode,
    alerts() {
      return { alerts: this.list };
    },
    async quotes(symbols) {
      return { quotes: Object.fromEntries(symbols.filter((s) => prices[s]).map((s) => [s, { last: prices[s] }])) };
    },
    fireAlert(id, price) {
      const a = this.list.find((x) => x.id === id);
      const first = !a.firedAt;
      if (first) {
        a.firedAt = "now";
        a.firedPrice = price;
      }
      return { alert: a, first };
    },
  };
}

function fakeTelegram() {
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { sent, fetchImpl };
}

const notifierWith = (fetchImpl) => new Notifier({ docs: new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-notify-"))), secrets, fetchImpl, log: { log() {} } });

test("the NSE clock: weekdays 9:15 to 3:30 only", () => {
  assert.equal(nseOpen(at("2026-11-13T09:14:00")), false);
  assert.equal(nseOpen(at("2026-11-13T09:15:00")), true);
  assert.equal(nseOpen(at("2026-11-13T15:29:00")), true);
  assert.equal(nseOpen(at("2026-11-13T15:30:00")), false);
  assert.equal(nseOpen(at("2026-11-14T11:00:00")), false, "Saturday");
});

test("a crossing fires once on the server, and the owner gets one Telegram message", async () => {
  const tg = fakeTelegram();
  const n = notifierWith(tg.fetchImpl);
  n.set({ token: TOKEN, chatId: "123456789" });
  const alerts = [
    { id: "a1", symbol: "SBIN", dir: "above", price: 800, note: "breakout", firedAt: null },
    { id: "a2", symbol: "INFY", dir: "below", price: 1400, firedAt: null },
    { id: "a3", symbol: "TCS", dir: "above", price: 4000, firedAt: null },
  ];
  const market = fakeMarket(alerts, { SBIN: 801.5, INFY: 1450, TCS: 3990 });
  const w = new AlertWatch({ market, notifier: n, now: () => at("2026-11-13T10:30:00") });
  const fired = await w.tick();
  assert.deepEqual(fired.map((a) => a.id), ["a1"]);
  assert.equal(alerts[0].firedPrice, 801.5);
  assert.equal(tg.sent.length, 1);
  assert.match(tg.sent[0].url, /api\.telegram\.org\/bot123456789:/);
  assert.equal(tg.sent[0].body.chat_id, "123456789");
  assert.match(tg.sent[0].body.text, /SBIN is at ₹801\.5 — at or above ₹800\nbreakout/);
  // the next look does not fire it again
  assert.deepEqual(await w.tick(), []);
  assert.equal(tg.sent.length, 1);
  assert.equal(w.status().checked, 2);
});

test("outside market hours, without Zerodha, or with nothing waiting, nothing is read", async () => {
  let reads = 0;
  const m = fakeMarket([{ id: "a1", symbol: "SBIN", dir: "above", price: 1, firedAt: null }], { SBIN: 5 });
  const q = m.quotes.bind(m);
  m.quotes = async (s) => ((reads += 1), q(s));
  assert.deepEqual(await new AlertWatch({ market: m, now: () => at("2026-11-13T16:00:00") }).tick(), []);
  assert.deepEqual(await new AlertWatch({ market: { ...m, mode: () => "none" }, now: () => at("2026-11-13T10:00:00") }).tick(), []);
  assert.equal(reads, 0);
  const empty = fakeMarket([], {});
  assert.deepEqual(await new AlertWatch({ market: empty, now: () => at("2026-11-13T10:00:00") }).tick(), []);
});

test("Telegram settings: the token is encrypted and never shown; bad input is refused; kinds can be switched off", async () => {
  const tg = fakeTelegram();
  const n = notifierWith(tg.fetchImpl);
  assert.equal(n.status().configured, false);
  assert.deepEqual(await n.send("x"), { sent: false, reason: "not_configured" });
  assert.throws(() => n.set({ token: "not-a-token" }), /bot token/);
  assert.throws(() => n.set({ chatId: "hello there" }), /chat id/);
  const st = n.set({ token: TOKEN, chatId: "-1001234567890", kinds: { alerts: true, risk: false, dayReport: true } });
  assert.equal(st.configured, true);
  assert.ok(!JSON.stringify(st).includes(TOKEN), "the token never comes back");
  assert.equal(st.tokenHint, "1234…2345");
  assert.deepEqual(await n.send("locked", "risk"), { sent: false, reason: "switched_off" });
  await n.test();
  assert.equal(tg.sent.length, 1);
  assert.match(tg.sent[0].body.text, /Jai Shri Ram/);
  assert.equal(n.set({ remove: true }).configured, false);
});

test("a failing Telegram is recorded without the token, and never throws into the caller", async () => {
  const n = notifierWith(async () => new Response(JSON.stringify({ ok: false, description: "Unauthorized" }), { status: 401 }));
  n.set({ token: TOKEN, chatId: "123456" });
  const r = await n.send("hello");
  assert.equal(r.sent, false);
  assert.match(n.status().lastError, /Unauthorized/);
  assert.ok(!n.status().lastError.includes(TOKEN));
});
