"use strict";
// WhatsApp Trading against a FAKE WhatsApp, a fake broker and a fake market: no network, no real
// order. Signatures, the owner-only rule, commands, the YES + PIN confirmation, and the 24-hour window.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { WhatsAppService, HELP } = require("../whatsapp");
const { FileDocs } = require("../docs");

const secrets = { encrypt: (x) => `enc:${Buffer.from(x).toString("base64")}`, decrypt: (x) => Buffer.from(x.slice(4), "base64").toString() };
const OWNER = "919876543210";
const APP_SECRET = "0123456789abcdef0123456789abcdef";
const TOKEN = "EAAGtestonlyTESTONLYtestonlyTESTONLYtestonlyTESTONLY1234";
const at = (s) => Date.parse(`${s}+05:30`);

function boot({ now = at("2026-11-13T10:30:00") } = {}) {
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init.body), auth: init.headers.authorization });
    return new Response(JSON.stringify({ messages: [{ id: "wamid.x" }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const orders = [];
  const trading = {
    on: false,
    status() {
      return { connected: true, enabled: this.on, risk: { enabled: true }, riskLock: null };
    },
    setSwitch(on, by) {
      this.on = on;
      orders.push({ kind: "switch", on, by });
    },
    async positions() {
      return { net: [{ exchange: "NSE", symbol: "SBIN", product: "MIS", quantity: 40, average: 800, last: 806, pnl: 240, m2m: 240 }] };
    },
    async funds() {
      return { equity: { net: 54321 } };
    },
    async preview(o) {
      return { margin: 6400, charges: { total: 21.5 }, checks: [{ id: "switch", ok: this.on, text: this.on ? "on" : "Trading is OFF" }], nudges: [] };
    },
    async place(o, by) {
      if (!this.on) throw new Error("Trading is switched OFF.");
      orders.push({ kind: "place", o, by });
      return { orderId: "250101000001" };
    },
    async exit(o, by) {
      orders.push({ kind: "exit", o, by });
      return { orderId: "250101000002", side: "SELL", quantity: 40 };
    },
    async exitAll(o, by) {
      orders.push({ kind: "exitAll", o, by });
      return { results: [{ kind: "exit", symbol: "SBIN", ok: true, orderId: "3" }] };
    },
  };
  const alerts = [];
  const market = {
    async quotes(s) {
      return { quotes: Object.fromEntries(s.map((x) => [x, { last: 806, changePct: 0.75, low: 798, high: 809, avgPrice: 803.2, volume: 12500000, buyQty: 600000, sellQty: 400000, upperCircuit: 880, lowerCircuit: 720 }])) };
    },
    async verdict() {
      return { available: true, last: 806, summary: "Bullish.", day: { available: true, headline: "LONG — in play", state: "long", score: 52, threshold: 35, movement: { rsi5: 61 }, plan: { side: "long", entry: 806, stop: 799, targets: [813, 820] } }, ladder: [{ label: "VWAP", price: 803.2 }, { label: "R1", price: 812 }] };
    },
    async context() {
      return { available: true, tide: { label: "Rising", score: 42 }, vix: { last: 13.1 } };
    },
    alerts: () => ({ alerts }),
    async addAlert(i) {
      const a = { symbol: i.symbol, dir: i.dir || "above", price: i.price };
      alerts.push(a);
      return { alert: a };
    },
  };
  const docs = new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-wa-")));
  const clock = { ms: now };
  const wa = new WhatsAppService({ docs, secrets, fetchImpl, now: () => clock.ms, log: { log() {} }, market, trading, ai: null, analysis: { list: () => [] } });
  wa.set({ phoneNumberId: "123456789012345", token: TOKEN, appSecret: APP_SECRET, verifyToken: "my-verify-token-123", owner: "+91 98765 43210", pin: "4321", enabled: true });
  return { wa, sent, orders, trading, clock, docs };
}
const sign = (raw) => `sha256=${crypto.createHmac("sha256", APP_SECRET).update(raw).digest("hex")}`;
const msg = (from, body, id = String(Math.random())) => ({ entry: [{ changes: [{ value: { messages: [{ id, from, type: "text", text: { body } }] } }] }] });
const say = async (s, text) => {
  const r = await s.wa.receive(msg(OWNER, text));
  return r.length ? r[0].reply : null;
};

test("settings: secrets are encrypted and never shown; the number and PIN are checked", () => {
  const { wa, docs } = boot();
  const st = wa.status();
  assert.equal(st.configured, true);
  assert.equal(st.owner, "+91…210");
  assert.ok(!JSON.stringify(st).includes(TOKEN) && !JSON.stringify(st).includes(APP_SECRET));
  const doc = docs.read("whatsapp/settings.json");
  assert.ok(!Object.values(doc).includes("4321") && !JSON.stringify(doc).includes('"4321"'), "the PIN is stored only as a hash");
  assert.match(doc.pinHash, /^[a-f0-9]{64}$/);
  assert.throws(() => wa.set({ pin: "12" }), /4 to 8 digits/);
  assert.throws(() => wa.set({ owner: "12345" }), /country code/);
  assert.throws(() => wa.set({ appSecret: "not hex!" }), /app secret/);
});

test("the webhook: Meta's verify handshake, and only correctly signed bodies", () => {
  const { wa } = boot();
  assert.equal(wa.verify({ "hub.mode": "subscribe", "hub.verify_token": "my-verify-token-123", "hub.challenge": "42" }), "42");
  assert.equal(wa.verify({ "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "42" }), null);
  const raw = Buffer.from(JSON.stringify(msg(OWNER, "HI")));
  assert.equal(wa.signed(raw, sign(raw)), true);
  assert.equal(wa.signed(raw, sign(Buffer.from("other"))), false);
  assert.equal(wa.signed(raw, "sha256=nothex"), false);
});

test("only the owner's number is answered, and each message only once", async () => {
  const s = boot();
  assert.deepEqual(await s.wa.receive(msg("911111111111", "STATUS")), []);
  assert.equal(s.sent.length, 0);
  const body = msg(OWNER, "HELP", "same-id");
  await s.wa.receive(body);
  await s.wa.receive(body);
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].body.text.body, HELP);
  assert.equal(s.sent[0].body.to, OWNER);
  assert.match(s.sent[0].auth, /^Bearer EAAG/);
});

test("ask commands: status, positions, quote, call, alerts", async () => {
  const s = boot();
  assert.match(await say(s, "status"), /Trading: OFF · risk guard on[\s\S]*Today's P&L: \+₹240 · open positions: 1/);
  const pos = await say(s, "POS");
  assert.match(pos, /SBIN\* long 40 @ ₹800 → ₹806 \(\+₹240, \+0\.75%\) MIS/);
  assert.match(pos, /buyers 60% \/ sellers 40%/);
  assert.match(pos, /RSI\(5m\) 61/);
  assert.match(pos, /Desk: LONG — in play/);
  assert.match(await say(s, "QUOTE SBIN"), /SBIN\* ₹806 \(\+0\.75%\)[\s\S]*Buyers 60%/);
  assert.match(await say(s, "CALL SBIN"), /Live call: LONG — in play \(score 52, needs ±35\)/);
  assert.match(await say(s, "ALERT SBIN 820"), /Alert set: SBIN above ₹820/);
  assert.match(await say(s, "ALERTS"), /SBIN above ₹820/);
  assert.match(await say(s, "EVERY 15"), /every 15 minutes/);
  assert.match(await say(s, "what"), /did not understand/);
});

test("trading from WhatsApp needs the switch on the card, then YES <code> <PIN>; TRADING OFF is immediate", async () => {
  const s = boot();
  assert.match(await say(s, "BUY 10 SBIN"), /not allowed/);
  s.wa.set({ allowTrading: true });
  // turning trading ON needs the confirmation
  const ask = await say(s, "TRADING ON");
  const code = ask.match(/YES (\d{6})/)[1];
  assert.equal(s.trading.on, false, "nothing happens on the first message");
  assert.match(await say(s, `YES ${code} 4321`), /Trading is ON/);
  assert.equal(s.trading.on, true);
  // an order: stated, then confirmed with the PIN, then sent through the desk's own place()
  const o = await say(s, "BUY 10 SBIN @ 805 CNC");
  assert.match(o, /BUY 10 SBIN on NSE at ₹805, CNC · last ₹806 · margin ₹6,400 · charges about ₹22/);
  const c2 = o.match(/YES (\d{6})/)[1];
  assert.equal(s.orders.filter((x) => x.kind === "place").length, 0);
  assert.match(await say(s, `YES ${c2} 4321`), /Sent to Zerodha: BUY 10 SBIN \(order 250101000001\)/);
  const placed = s.orders.find((x) => x.kind === "place");
  assert.deepEqual([placed.o.side, placed.o.quantity, placed.o.type, placed.o.price, placed.o.product, placed.o.confirm, placed.by], ["BUY", 10, "LIMIT", 805, "CNC", true, "whatsapp"]);
  assert.match(placed.o.clientRef, /^[a-f0-9]{24}$/);
  // exits
  const e = await say(s, "EXIT SBIN");
  assert.match(await say(s, `YES ${e.match(/YES (\d{6})/)[1]} 4321`), /Exit sent:\nSBIN MIS: SELL 40/);
  // OFF needs nothing
  assert.match(await say(s, "TRADING OFF"), /Trading is OFF/);
  assert.equal(s.trading.on, false);
});

test("a wrong PIN three times locks WhatsApp trading; a late YES expires; NO cancels", async () => {
  const s = boot();
  s.wa.set({ allowTrading: true });
  const code = (await say(s, "TRADING ON")).match(/YES (\d{6})/)[1];
  assert.match(await say(s, `YES ${code} 1111`), /Wrong PIN \(1 of 3\)/);
  assert.match(await say(s, `YES ${code} 2222`), /Wrong PIN \(2 of 3\)/);
  assert.match(await say(s, `YES ${code} 3333`), /locked for 30 minutes/);
  assert.equal(s.trading.on, false);
  assert.match(await say(s, "TRADING ON"), /locked until/);
  s.clock.ms += 31 * 60000;
  const c2 = (await say(s, "TRADING ON")).match(/YES (\d{6})/)[1];
  s.clock.ms += 3 * 60000;
  assert.match(await say(s, `YES ${c2} 4321`), /expired/);
  const c3 = (await say(s, "EXIT ALL")).match(/YES (\d{6})/)[1];
  assert.match(await say(s, "NO"), /Cancelled/);
  assert.match(await say(s, `YES ${c3} 4321`), /Nothing is waiting/);
  assert.equal(s.orders.filter((x) => x.kind !== "switch").length, 0);
});

test("outside WhatsApp's 24-hour window an update needs a template; inside it, plain text", async () => {
  const s = boot();
  const r1 = await s.wa.send("hello");
  assert.equal(r1.sent, false);
  assert.match(s.wa.status().lastError, /24 hours/);
  s.wa.set({ template: { name: "drishti_update", lang: "en" } });
  await s.wa.send("line one\nline two");
  assert.equal(s.sent[0].body.type, "template");
  assert.equal(s.sent[0].body.template.components[0].parameters[0].text, "line one · line two");
  await say(s, "HI"); // opens the window
  await s.wa.send("now plain");
  assert.equal(s.sent[s.sent.length - 1].body.type, "text");
});

test("the timed update goes out in market hours while a position is open, at most every N minutes", async () => {
  const s = boot({ now: at("2026-11-13T10:30:00") });
  await say(s, "HI");
  s.wa._note({ morning: "2026-11-13" });
  const before = s.sent.length;
  await s.wa.tick();
  assert.equal(s.sent.length, before + 1);
  assert.match(s.sent[s.sent.length - 1].body.text.body, /Drishti update[\s\S]*SBIN/);
  await s.wa.tick();
  assert.equal(s.sent.length, before + 1, "not again within the interval");
  s.clock.ms += 31 * 60000;
  await s.wa.tick();
  assert.equal(s.sent.length, before + 2);
});
