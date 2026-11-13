"use strict";
// The account and trading routes, against a FAKE Zerodha. No network, no real order —
// the fake records every request so the tests can see exactly what would have been sent.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const { createApp } = require("../app");
const { TradingService } = require("../trading/service");
const { Coach } = require("../ai/coach");
const { Research } = require("../ai/research");
const { SUPERADMIN_EMAIL } = require("../config");
const { FileDocs, MongoDocs } = require("../docs");

const API_KEY = "abcd1234efgh5678";
const API_SECRET = "zyxw9876vuts5432";

/* ------------------------------------------------------------ fake Kite */
function fakeKite() {
  const k = {
    log: [],
    orders: [
      { order_id: "250001", status: "OPEN", variety: "regular", exchange: "NSE", tradingsymbol: "INFY", transaction_type: "BUY", order_type: "LIMIT", product: "CNC", validity: "DAY", quantity: 5, pending_quantity: 5, filled_quantity: 0, price: 1400, trigger_price: 0, average_price: 0, order_timestamp: "2026-11-12 09:20:00", tag: "" },
      { order_id: "250002", status: "COMPLETE", variety: "regular", exchange: "NSE", tradingsymbol: "TCS", transaction_type: "BUY", order_type: "MARKET", product: "MIS", validity: "DAY", quantity: 10, pending_quantity: 0, filled_quantity: 10, price: 0, trigger_price: 0, average_price: 3950, order_timestamp: "2026-11-12 09:30:00", tag: "" },
    ],
    net: [
      { tradingsymbol: "TCS", exchange: "NSE", instrument_token: 2953217, product: "MIS", quantity: 10, overnight_quantity: 0, multiplier: 1, average_price: 3950, close_price: 4000, last_price: 3960, value: -39500, pnl: 100, m2m: 100, unrealised: 100, realised: 0, buy_quantity: 10, buy_price: 3950, buy_value: 39500, sell_quantity: 0, sell_price: 0, sell_value: 0 },
      { tradingsymbol: "SBIN", exchange: "NSE", instrument_token: 779521, product: "MIS", quantity: -20000, overnight_quantity: 0, multiplier: 1, average_price: 800, close_price: 805, last_price: 798, value: 16000000, pnl: 40000, m2m: 40000, unrealised: 40000, realised: 0, buy_quantity: 0, sell_quantity: 20000, sell_price: 800, sell_value: 16000000 },
      { tradingsymbol: "ITC", exchange: "NSE", instrument_token: 424961, product: "MIS", quantity: 0, overnight_quantity: 0, multiplier: 1, average_price: 0, close_price: 400, last_price: 402, pnl: 50, realised: 50, buy_quantity: 100, sell_quantity: 100 },
    ],
    holdings: [{ tradingsymbol: "INFY", exchange: "NSE", instrument_token: 408065, isin: "INE009A01021", product: "CNC", quantity: 40, t1_quantity: 2, used_quantity: 0, average_price: 1300, last_price: 1512.5, close_price: 1500, pnl: 8925, day_change: 12.5, day_change_percentage: 0.83 }],
    nextId: 260000,
    expired: false,
  };
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  k.writes = () => k.log.filter((l) => l.method !== "GET" && l.path !== "/session/token");
  k.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || "GET";
    const form = init.body ? Object.fromEntries(new URLSearchParams(init.body)) : null;
    k.log.push({ method, path: u.pathname, form });
    if (u.pathname === "/session/token") {
      const want = crypto.createHash("sha256").update(API_KEY + form.request_token + API_SECRET).digest("hex");
      if (form.checksum !== want) return json(403, { status: "error", message: "Invalid checksum", error_type: "TokenException" });
      return json(200, { status: "success", data: { access_token: "ACCESS-TOKEN-XYZ", user_id: "AB1234", user_name: "Test User" } });
    }
    if (k.expired) return json(403, { status: "error", message: "Incorrect api_key or access_token", error_type: "TokenException" });
    if (method === "GET" && u.pathname === "/user/margins") return json(200, { status: "success", data: { equity: { enabled: true, net: 99725.05, available: { cash: 245431.6, opening_balance: 245431.6, live_balance: 99725.05, collateral: 0, intraday_payin: 0 }, utilised: { debits: 145706.55, exposure: 38981.25, span: 101989, option_premium: 0, holding_sales: 0, m2m_realised: 0, m2m_unrealised: 0 } }, commodity: { enabled: false, net: 0, available: {}, utilised: {} } } });
    if (method === "GET" && u.pathname === "/portfolio/positions") return json(200, { status: "success", data: { net: k.net, day: k.net } });
    if (method === "GET" && u.pathname === "/portfolio/holdings") return json(200, { status: "success", data: k.holdings });
    if (method === "GET" && u.pathname === "/orders") return json(200, { status: "success", data: k.orders });
    if (method === "GET" && u.pathname === "/trades") return json(200, { status: "success", data: [{ trade_id: "T1", order_id: "250002", exchange: "NSE", tradingsymbol: "TCS", transaction_type: "BUY", product: "MIS", quantity: 10, average_price: 3950, fill_timestamp: "2026-11-12 09:30:01" }] });
    if (method === "GET" && /^\/orders\/\w+$/.test(u.pathname)) return json(200, { status: "success", data: k.orders.filter((o) => o.order_id === u.pathname.split("/")[2]) });
    let m = u.pathname.match(/^\/orders\/(regular|amo)$/);
    if (method === "POST" && m) {
      if (form.quantity === "999") return json(400, { status: "error", message: "Insufficient funds", error_type: "MarginException" });
      if (form.order_type === "MARKET" && !form.market_protection) return json(400, { status: "error", message: "Market orders need market protection", error_type: "InputException" });
      k.nextId += 1;
      return json(200, { status: "success", data: { order_id: String(k.nextId) } });
    }
    m = u.pathname.match(/^\/orders\/(regular|amo)\/(\w+)$/);
    if (m && (method === "PUT" || method === "DELETE")) return json(200, { status: "success", data: { order_id: m[2] } });
    return json(400, { status: "error", message: "Route not found", error_type: "GeneralException" });
  };
  return k;
}

/* --------------------------------------------------------------- harness */
async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-trade-"));
  const kite = fakeKite();
  let nonce = "";
  const made = createApp({
    dataDir: dir,
    buildDir: path.join(dir, "no-build"),
    env: { SETUP_TOKEN: "tok" },
    google: () => ({
      authUrl: ({ state, nonce: n }) => {
        nonce = n;
        return `https://accounts.google.com/fake?state=${state}`;
      },
      exchange: async (code) => ({ email: code, emailVerified: true, name: "T", picture: "", nonce }),
    }),
    holidayFetch: async () => {
      throw new Error("no network");
    },
    marketFetch: kite.fetch,
    marketGaps: { quote: 0, historical: 0, other: 0 },
    now: () => Date.parse("2026-11-12T04:45:00Z"),
  });
  const server = await new Promise((res) => {
    const s = made.app.listen(0, "127.0.0.1", () => res(s));
  });
  const port = server.address().port;
  const request = (method, url, { cookie, body } = {}) =>
    new Promise((resolve, reject) => {
      const h = {};
      if (cookie) h.cookie = cookie;
      if (method !== "GET") h["x-requested-with"] = "vpt";
      let payload;
      if (body !== undefined) {
        payload = JSON.stringify(body);
        h["content-type"] = "application/json";
        h["content-length"] = Buffer.byteLength(payload);
      }
      const r = http.request({ host: "127.0.0.1", port, method, path: url, headers: h }, (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => {
          let j = null;
          try {
            j = JSON.parse(text);
          } catch (_) {
            /* not JSON */
          }
          const jar = (res.headers["set-cookie"] || []).map((c) => c.split(";")[0]).filter((c) => !/=$/.test(c)).join("; ");
          resolve({ status: res.statusCode, headers: res.headers, json: j, jar });
        });
      });
      r.on("error", reject);
      if (payload) r.write(payload);
      r.end();
    });
  await request("POST", "/api/setup", { body: { token: "tok", googleClientId: "1234567890-abcdefgh.apps.googleusercontent.com", googleClientSecret: "GOCSPX-secret-secret" } });
  const login = async (email) => {
    const start = await request("GET", "/api/auth/google/start");
    const state = new URL(start.headers.location).searchParams.get("state");
    return (await request("GET", `/api/auth/google/callback?state=${state}&code=${encodeURIComponent(email)}`, { cookie: start.jar })).jar;
  };
  const admin = await login(SUPERADMIN_EMAIL);
  const connectKite = async () => {
    await request("PUT", "/api/admin/market/kite", { cookie: admin, body: { apiKey: API_KEY, apiSecret: API_SECRET } });
    const go = await request("GET", "/api/admin/market/kite/login", { cookie: admin });
    const st = new URLSearchParams(new URL(go.headers.location).searchParams.get("redirect_params")).get("state");
    await request("GET", `/api/admin/market/kite/callback?request_token=REQTOKEN123&action=login&status=success&state=${st}`, { cookie: `${admin}; ${go.jar}` });
  };
  const close = () =>
    new Promise((r) => {
      if (server.closeAllConnections) server.closeAllConnections();
      server.close(r);
    });
  let refN = 0;
  const ref = () => `test-ref-${Date.now()}-${(refN += 1)}`;
  return { dir, kite, made, request, admin, login, connectKite, close, ref, port };
}

const on = (s) => s.request("PUT", "/api/admin/trading/switch", { cookie: s.admin, body: { on: true } });

/* ------------------------------------------------------------------ tests */

test("trading routes are for the superadmin only", async (t) => {
  const s = await boot();
  t.after(s.close);
  assert.equal((await s.request("GET", "/api/admin/trading/summary")).status, 401);
  await s.request("POST", "/api/admin/admins", { cookie: s.admin, body: { email: "helper@example.com" } });
  const helper = await s.login("helper@example.com");
  for (const [m, p] of [["GET", "/api/admin/trading/summary"], ["GET", "/api/admin/trading/status"], ["PUT", "/api/admin/trading/switch"], ["POST", "/api/admin/trading/orders"], ["POST", "/api/admin/trading/exit-all"]]) {
    const r = await s.request(m, p, { cookie: helper, body: m === "GET" ? undefined : { on: true } });
    assert.equal(r.status, 403, `${m} ${p}`);
  }
});

test("the account can be read while trading is switched off", async (t) => {
  const s = await boot();
  t.after(s.close);
  assert.equal((await s.request("GET", "/api/admin/trading/summary", { cookie: s.admin })).status, 409, "not connected yet");
  await s.connectKite();
  const r = await s.request("GET", "/api/admin/trading/summary", { cookie: s.admin });
  assert.equal(r.status, 200);
  const d = r.json;
  assert.equal(d.status.enabled, false, "the switch starts OFF");
  assert.equal(d.funds.equity.available.cash, 245431.6);
  assert.equal(d.positions.net[0].symbol, "TCS");
  assert.equal(d.positions.net[0].pnl, 100);
  assert.equal(d.holdings[0].t1, 2);
  assert.equal(d.orders.length, 2);
  assert.equal(d.trades[0].orderId, "250002");
  assert.equal(s.kite.writes().length, 0, "reading sends nothing that changes the account");
});

test("while the switch is OFF every write is refused and nothing reaches Zerodha", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  const tries = [
    ["POST", "/api/admin/trading/orders", { exchange: "NSE", symbol: "INFY", side: "BUY", type: "LIMIT", product: "CNC", quantity: 1, price: 1500, confirm: true, clientRef: s.ref() }],
    ["PUT", "/api/admin/trading/orders/regular/250001", { price: 1401, confirm: true, clientRef: s.ref() }],
    ["DELETE", "/api/admin/trading/orders/regular/250001", { clientRef: s.ref() }],
    ["POST", "/api/admin/trading/exit", { exchange: "NSE", symbol: "TCS", product: "MIS", confirm: true, clientRef: s.ref() }],
    ["POST", "/api/admin/trading/exit-all", { confirm: "EXIT ALL", clientRef: s.ref() }],
    ["POST", "/api/admin/trading/sell-holding", { symbol: "INFY", quantity: 1, confirm: true, clientRef: s.ref() }],
  ];
  for (const [m, p, body] of tries) {
    const r = await s.request(m, p, { cookie: s.admin, body });
    assert.equal(r.status, 423, `${m} ${p}`);
    assert.equal(r.json.error, "trading_off");
  }
  assert.equal(s.kite.writes().length, 0);
});

test("with the switch ON an order goes out once, with Kite's own parameters", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  assert.equal((await on(s)).json.enabled, true);
  const ref = s.ref();
  const body = { exchange: "NSE", symbol: "infy", side: "BUY", type: "LIMIT", product: "CNC", quantity: 3, price: 1499.999, confirm: true, clientRef: ref };
  const r = await s.request("POST", "/api/admin/trading/orders", { cookie: s.admin, body });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.orderId, /^\d+$/);
  const sent = s.kite.writes();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].path, "/orders/regular");
  assert.deepEqual(sent[0].form, { exchange: "NSE", tradingsymbol: "INFY", transaction_type: "BUY", order_type: "LIMIT", product: "CNC", quantity: "3", validity: "DAY", tag: "vptdesk", price: "1500" });

  // a double click (same reference) gets the same answer and sends nothing more
  const again = await s.request("POST", "/api/admin/trading/orders", { cookie: s.admin, body });
  assert.equal(again.json.orderId, r.json.orderId);
  assert.equal(again.json.repeated, true);
  assert.equal(s.kite.writes().length, 1);

  // a market order always carries market protection
  const mk = await s.request("POST", "/api/admin/trading/orders", { cookie: s.admin, body: { exchange: "NSE", symbol: "TCS", side: "SELL", type: "MARKET", product: "MIS", quantity: 2, confirm: true, clientRef: s.ref() } });
  assert.equal(mk.status, 200, JSON.stringify(mk.json));
  assert.equal(s.kite.writes()[1].form.market_protection, "-1");
  assert.equal(s.kite.writes()[1].form.price, undefined);

  // SL-M carries its trigger
  await s.request("POST", "/api/admin/trading/orders", { cookie: s.admin, body: { exchange: "NSE", symbol: "TCS", side: "SELL", type: "SL-M", product: "MIS", quantity: 2, trigger: 3900, confirm: true, clientRef: s.ref() } });
  assert.equal(s.kite.writes()[2].form.trigger_price, "3900");
});

test("doubtful orders are refused before they reach Zerodha", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  await on(s);
  const base = { exchange: "NSE", symbol: "INFY", side: "BUY", type: "LIMIT", product: "CNC", quantity: 1, price: 1500, confirm: true };
  const bad = [
    [{ confirm: false }, "unconfirmed"],
    [{ clientRef: "" }, "invalid"],
    [{ type: "SL", price: 1500, trigger: 1510 }, "invalid"], // a buy stop with its trigger above its limit
    [{ exchange: "NFO", symbol: "INFY26NOVFUT" }, "invalid"], // CNC is not for F&O
    [{ product: "NRML" }, "invalid"], // NRML is not for stocks
    [{ quantity: 1.5 }, "invalid"],
    [{ type: "LIMIT", price: 0 }, "invalid"],
    [{ symbol: "INFY; DROP" }, "invalid"],
    [{ type: "MARKET", protection: 150 }, "invalid"],
  ];
  for (const [patch, code] of bad) {
    const r = await s.request("POST", "/api/admin/trading/orders", { cookie: s.admin, body: { ...base, clientRef: s.ref(), ...patch } });
    assert.equal(r.status, 400, JSON.stringify(patch));
    assert.equal(r.json.error, code, JSON.stringify(patch));
  }
  assert.equal(s.kite.writes().length, 0);
});

test("per-order limits stop a fat finger, but never an exit", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  await on(s);
  await s.request("PUT", "/api/admin/trading/limits", { cookie: s.admin, body: { maxQty: 1000, maxValue: 200000 } });
  const big = await s.request("POST", "/api/admin/trading/orders", { cookie: s.admin, body: { exchange: "NSE", symbol: "SBIN", side: "SELL", type: "LIMIT", product: "MIS", quantity: 5000, price: 800, confirm: true, clientRef: s.ref() } });
  assert.equal(big.status, 422, "a fresh 5000-share short is over both limits");
  const value = await s.request("POST", "/api/admin/trading/orders", { cookie: s.admin, body: { exchange: "NSE", symbol: "INFY", side: "BUY", type: "LIMIT", product: "CNC", quantity: 200, price: 1500, confirm: true, clientRef: s.ref() } });
  assert.equal(value.status, 422, "₹3 lakh is over the ₹2 lakh limit");
  assert.equal(s.kite.writes().length, 0);
  // buying back the 20,000-share short is an exit: allowed whatever the limits
  const exit = await s.request("POST", "/api/admin/trading/exit", { cookie: s.admin, body: { exchange: "NSE", symbol: "SBIN", product: "MIS", confirm: true, clientRef: s.ref() } });
  assert.equal(exit.status, 200, JSON.stringify(exit.json));
  const sent = s.kite.writes()[0].form;
  assert.equal(sent.transaction_type, "BUY");
  assert.equal(sent.quantity, "20000");
  assert.equal(sent.order_type, "MARKET");
  assert.equal(sent.market_protection, "-1");
});

test("exit, partial exit, sell holding, modify and cancel send the right requests", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  await on(s);
  const part = await s.request("POST", "/api/admin/trading/exit", { cookie: s.admin, body: { exchange: "NSE", symbol: "TCS", product: "MIS", quantity: 4, type: "LIMIT", price: 3965, confirm: true, clientRef: s.ref() } });
  assert.equal(part.status, 200, JSON.stringify(part.json));
  assert.deepEqual([part.json.side, part.json.quantity], ["SELL", 4]);
  const tooMany = await s.request("POST", "/api/admin/trading/exit", { cookie: s.admin, body: { exchange: "NSE", symbol: "TCS", product: "MIS", quantity: 11, confirm: true, clientRef: s.ref() } });
  assert.equal(tooMany.status, 400);
  const none = await s.request("POST", "/api/admin/trading/exit", { cookie: s.admin, body: { exchange: "NSE", symbol: "ITC", product: "MIS", confirm: true, clientRef: s.ref() } });
  assert.equal(none.status, 409, "a closed position cannot be exited");

  const sell = await s.request("POST", "/api/admin/trading/sell-holding", { cookie: s.admin, body: { exchange: "NSE", symbol: "INFY", confirm: true, clientRef: s.ref() } });
  assert.equal(sell.status, 200, JSON.stringify(sell.json));
  assert.equal(sell.json.quantity, 42, "holding + T1");
  const over = await s.request("POST", "/api/admin/trading/sell-holding", { cookie: s.admin, body: { exchange: "NSE", symbol: "INFY", quantity: 43, confirm: true, clientRef: s.ref() } });
  assert.equal(over.status, 400);

  const mod = await s.request("PUT", "/api/admin/trading/orders/regular/250001", { cookie: s.admin, body: { price: 1405, quantity: 6, confirm: true, clientRef: s.ref() } });
  assert.equal(mod.status, 200, JSON.stringify(mod.json));
  const can = await s.request("DELETE", "/api/admin/trading/orders/regular/250001", { cookie: s.admin, body: { clientRef: s.ref() } });
  assert.equal(can.status, 200);
  const w = s.kite.writes();
  assert.deepEqual(w.map((x) => `${x.method} ${x.path}`), ["POST /orders/regular", "POST /orders/regular", "PUT /orders/regular/250001", "DELETE /orders/regular/250001"]);
  assert.deepEqual(w[1].form.product, "CNC");
  assert.deepEqual(w[2].form, { quantity: "6", price: "1405" });
});

test("exit all asks for the words, cancels pending orders when told, then exits every open position", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  await on(s);
  assert.equal((await s.request("POST", "/api/admin/trading/exit-all", { cookie: s.admin, body: { confirm: true, clientRef: s.ref() } })).status, 400);
  const r = await s.request("POST", "/api/admin/trading/exit-all", { cookie: s.admin, body: { confirm: "EXIT ALL", cancelOpen: true, clientRef: s.ref() } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.ok, true);
  assert.deepEqual(r.json.results.map((x) => `${x.kind} ${x.symbol}`), ["cancel INFY", "exit TCS", "exit SBIN"], "the flat ITC position and the finished TCS order are left alone");
  const w = s.kite.writes();
  assert.equal(w[0].method, "DELETE");
  assert.equal(w[1].form.transaction_type, "SELL");
  assert.equal(w[2].form.transaction_type, "BUY");
});

test("every change and every order is written to the audit log, those Zerodha refuses too", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  await on(s);
  await s.request("POST", "/api/admin/trading/orders", { cookie: s.admin, body: { exchange: "NSE", symbol: "INFY", side: "BUY", type: "LIMIT", product: "CNC", quantity: 1, price: 1500, confirm: true, clientRef: s.ref() } });
  await s.request("POST", "/api/admin/trading/orders", { cookie: s.admin, body: { exchange: "NSE", symbol: "INFY", side: "BUY", type: "MARKET", product: "CNC", quantity: 1, confirm: true, clientRef: s.ref(), protection: 0.5 } });
  const refused = await s.request("POST", "/api/admin/trading/orders", { cookie: s.admin, body: { exchange: "NSE", symbol: "INFY", side: "BUY", type: "LIMIT", product: "CNC", quantity: 999, price: 10, confirm: true, clientRef: s.ref() } });
  assert.equal(refused.status, 422);
  assert.match(refused.json.message, /Insufficient funds/);
  await s.request("PUT", "/api/admin/trading/switch", { cookie: s.admin, body: { on: false } });
  const a = (await s.request("GET", "/api/admin/trading/audit", { cookie: s.admin })).json.audit;
  assert.deepEqual(a.map((x) => x.action), ["switch-off", "place", "place", "place", "switch-on"]);
  assert.equal(a[1].result.ok, false);
  assert.match(a[1].result.error, /Insufficient funds/);
  assert.equal(a[0].by, SUPERADMIN_EMAIL);
  assert.equal(a[3].result.ok, true);
  assert.ok(!JSON.stringify(a).includes("ACCESS-TOKEN"), "no secret in the log");
});

test("a dead Kite session is forgotten and asks for a fresh login", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  s.kite.expired = true;
  const r = await s.request("GET", "/api/admin/trading/summary", { cookie: s.admin });
  assert.equal(r.status, 409);
  assert.equal(r.json.error, "not_connected");
  assert.equal((await s.request("GET", "/api/admin/market/status", { cookie: s.admin })).json.kite.connected, false);
});

test("order updates from Zerodha's stream reach the trading status", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-trade-u-"));
  const ticker = new EventEmitter();
  ticker.isLive = () => true;
  const store = { data: {}, update(fn) { fn(this.data); } };
  const market = { ticker, kiteState: () => ({ connected: true, user: "X" }), kiteAuth: () => null };
  const t = new TradingService({ dir, store, market, log: { log() {}, error() {} } });
  const seen = [];
  const off = t.stream((ev) => seen.push(ev.type));
  ticker.emit("text", { type: "message", data: "hello" });
  ticker.emit("text", { type: "order", data: { order_id: "77", status: "COMPLETE", tradingsymbol: "INFY", transaction_type: "BUY", filled_quantity: 3, quantity: 3, average_price: 1500 } });
  off();
  assert.deepEqual(seen, ["hello", "order"]);
  const u = t.status().updates[0];
  assert.deepEqual([u.id, u.status, u.filled], ["77", "COMPLETE", 3]);
});

test("only server/trading/broker.js can send an order; the AI and market folders cannot reach it", () => {
  const root = path.join(__dirname, "..");
  const strip = (src) => src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const folder of ["ai", "market"]) {
    for (const f of fs.readdirSync(path.join(root, folder)).filter((x) => x.endsWith(".js"))) {
      const src = strip(fs.readFileSync(path.join(root, folder, f), "utf8"));
      assert.doesNotMatch(src, /require\(["'][./]*trading/, `${folder}/${f} must not load the trading module`);
      assert.doesNotMatch(src, /\/orders|\/portfolio|\/user\/margins|KiteBroker/, `${folder}/${f} must not name a trading endpoint`);
    }
  }
  for (const f of fs.readdirSync(path.join(root, "trading")).filter((x) => x !== "broker.js")) {
    const src = strip(fs.readFileSync(path.join(root, "trading", f), "utf8"));
    assert.doesNotMatch(src, /fetch\(|api\.kite\.trade/, `trading/${f} must go through the broker`);
  }
});

/* -------------------------------------------------- AI: coach and research */

function aiStub(answers) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-ai-c-"));
  const asked = [];
  return {
    asked,
    dir,
    docs: new FileDocs(dir),
    now: () => Date.parse("2026-11-12T04:45:00Z"),
    log: { log() {}, error() {} },
    configured: () => true,
    worldSummary: () => null,
    playbook: { read: () => "(skills)" },
    _client: () => ({ ask: async (q) => { asked.push(q); return { data: answers.shift(), usage: { inputTokens: 10, outputTokens: 5 }, model: "claude-opus-5-5" }; } }),
    market: {
      watchlist: () => ["TCS", "INFY"],
      context: async () => ({ available: false }),
      verdict: async (s) => ({ available: true, last: s === "TCS" ? 3960 : 1512.5, movement: { atr: 40 }, stance: "neutral", composite: 0, ladder: [{ label: "S1", price: 3900, awayPct: -1.5 }], day: { available: true, headline: "Wait", state: "wait", score: -10 } }),
    },
  };
}

test("the coach reads the book as plain data and flags a stop on the wrong side", async () => {
  const ai = aiStub([{ overview: "o", positions: [{ symbol: "TCS", product: "MIS", action: "hold", urgency: "watch", confidence: "low", reasoning: "r", stop: 3990, target: 4000, invalidation: "i" }], holdings: [{ symbol: "INFY", action: "hold", reasoning: "r" }], risk_note: "x", caveat: "c" }]);
  const c = new Coach(ai);
  const account = { positions: { net: [{ exchange: "NSE", symbol: "TCS", product: "MIS", quantity: 10, average: 3950, last: 3960, pnl: 100, multiplier: 1 }, { exchange: "NSE", symbol: "ITC", product: "MIS", quantity: 0, last: 402 }] }, holdings: [{ exchange: "NSE", symbol: "INFY", quantity: 40, t1: 2, average: 1300, last: 1512.5, pnl: 1, dayChangePct: 0.8 }], funds: null, orders: [] };
  const r = await c.read(account);
  const facts = JSON.parse(ai.asked[0].user.split("The book now:\n\n")[1].split("\n\n---")[0]);
  assert.deepEqual(facts.positions.map((p) => p.symbol), ["TCS"], "flat positions are left out");
  assert.equal(facts.positions[0].engine.available, true);
  assert.equal(r.positions[0].stop, null, "a long's stop above the price is dropped");
  assert.match(r.positions[0].notes[0], /wrong side/);
  assert.equal(c.list().readings.length, 1);
});

test("research without an AI key still produces a data sheet for each stock", async () => {
  const ai = aiStub([]);
  ai.configured = () => false;
  ai.brief = async (s) => ({ brief: { price: { last: 1 }, atr: 2, daily: { indicators: { rsi14: 55 }, levels: { pivots: { p: 1 }, supports: [], resistances: [] }, setups: [] }, ruleEngine: {}, backtestsOnThisStock: [] }, verdict: { circuit: null } });
  const r = new Research(ai);
  r.start({ symbols: ["TCS", "INFY", "bad symbol!"], phase: "post" });
  while (!r.job.finishedAt) await new Promise((res) => setImmediate(res));
  assert.equal(r.job.error, "");
  const rep = r.report(r.job.reportId);
  assert.deepEqual(rep.stocks.map((x) => x.symbol), ["TCS", "INFY"]);
  assert.equal(rep.stocks[0].sheet.indicators.rsi14, 55);
  assert.equal(rep.stocks[0].note, null);
  assert.equal(rep.model, null);
});

test("the trading switch and limits survive a server restart", () => {
  const { Store } = require("../store");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-trade-r-"));
  const market = { ticker: null, kiteState: () => ({ connected: false }), kiteAuth: () => null };
  const quiet = { log() {}, error() {} };
  const a = new TradingService({ dir, store: new Store(dir), market, log: quiet });
  a.setSwitch(true, "me");
  a.setLimits({ maxQty: 250, maxValue: 75000 }, "me");
  const b = new TradingService({ dir, store: new Store(dir), market, log: quiet });
  assert.equal(b.status().enabled, true);
  assert.deepEqual(b.status().limits, { maxQty: 250, maxValue: 75000 });
});

/* ------------------------------------------------------------- risk guard */

test("risk guard through the routes: a breach locks the day, blocks new risk, still lets you exit", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  await on(s);
  // today's mark-to-market: a ₹6,000 loss
  s.kite.net[0].m2m = -6000;
  s.kite.net[1].m2m = 0;
  const set = await s.request("PUT", "/api/admin/trading/risk", { cookie: s.admin, body: { enabled: true, dailyLoss: 5000, maxOpen: 5 } });
  assert.equal(set.status, 200);
  const st = (await s.request("GET", "/api/admin/trading/risk", { cookie: s.admin })).json;
  assert.equal(st.standing.locked, true);
  assert.equal(st.lock.kind, "loss");
  // a fresh buy is refused…
  const buy = await s.request("POST", "/api/admin/trading/orders", { cookie: s.admin, body: { exchange: "NSE", symbol: "INFY", side: "BUY", type: "LIMIT", product: "MIS", quantity: 1, price: 1500, confirm: true, clientRef: s.ref() } });
  assert.equal(buy.status, 423);
  assert.equal(buy.json.error, "risk_locked");
  // …an exit is not
  const exit = await s.request("POST", "/api/admin/trading/exit", { cookie: s.admin, body: { exchange: "NSE", symbol: "TCS", product: "MIS", confirm: true, clientRef: s.ref() } });
  assert.equal(exit.status, 200, JSON.stringify(exit.json));
  // and selling part of the TCS long through the normal ticket counts as an exit too
  const sell = await s.request("POST", "/api/admin/trading/orders", { cookie: s.admin, body: { exchange: "NSE", symbol: "TCS", side: "SELL", type: "MARKET", product: "MIS", quantity: 2, confirm: true, clientRef: s.ref() } });
  assert.equal(sell.status, 200, JSON.stringify(sell.json));
  // while locked the limits can tighten, not loosen
  assert.equal((await s.request("PUT", "/api/admin/trading/risk", { cookie: s.admin, body: { enabled: true, dailyLoss: 8000, maxOpen: 5 } })).status, 409);
  assert.equal((await s.request("PUT", "/api/admin/trading/risk", { cookie: s.admin, body: { enabled: false } })).status, 409);
  assert.equal((await s.request("PUT", "/api/admin/trading/risk", { cookie: s.admin, body: { enabled: true, dailyLoss: 4000, maxOpen: 3 } })).status, 200);
  const audit = (await s.request("GET", "/api/admin/trading/audit", { cookie: s.admin })).json.audit.map((a) => a.action);
  assert.ok(audit.includes("risk-lock"));
});

test("journal through the routes: today's fills are captured, a Console CSV imports, trips can be tagged", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  const v = (await s.request("GET", "/api/admin/trading/journal?range=all", { cookie: s.admin })).json;
  assert.equal(v.fills, 1, "today's TCS fill from Zerodha");
  assert.equal(v.stats.open, 1);
  const csv = "symbol,exchange,trade_type,quantity,price,trade_id,order_id,order_execution_time\nRELIANCE,NSE,buy,5,1280,A1,O1,2026-11-03T09:20:00\nRELIANCE,NSE,sell,5,1290,A2,O2,2026-11-03T11:20:00\n";
  // the request helper sends JSON; send the CSV as text with the same cookie and CSRF header
  const res = await fetch(`http://127.0.0.1:${s.port}/api/admin/trading/journal/import`, { method: "POST", headers: { cookie: s.admin, "x-requested-with": "vpt", "content-type": "text/csv" }, body: csv });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.added, 2);
  const after = (await s.request("GET", "/api/admin/trading/journal?range=all", { cookie: s.admin })).json;
  const rel = after.trips.find((x) => x.symbol === "RELIANCE");
  assert.equal(rel.pnl, 50);
  assert.ok(rel.charges > 0 && rel.net < 50);
  const tag = await s.request("PUT", "/api/admin/trading/journal/tags", { cookie: s.admin, body: { key: rel.key, setup: "Opening range", mistakes: ["Exited too early"] } });
  assert.equal(tag.status, 200, JSON.stringify(tag.json));
  assert.equal((await s.request("PUT", "/api/admin/trading/journal/tags", { cookie: s.admin, body: { key: "nonsense" } })).status, 400);
  const tagged = (await s.request("GET", "/api/admin/trading/journal?range=all&setup=Opening%20range", { cookie: s.admin })).json;
  assert.equal(tagged.stats.trades, 1);
  assert.equal(tagged.stats.by.setup[0].key, "Opening range");
});
