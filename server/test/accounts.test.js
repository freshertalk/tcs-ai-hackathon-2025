"use strict";
// A person's OWN Zerodha account (server/accounts.js) and each person's preferences (server/prefs.js), against a FAKE
// Zerodha that records the session every request came with. No network, no real order.
//
// What must hold: an account is used only by its own person, only while the owner has it switched on; an order can
// only ever leave on the session of the person who confirmed it; the owner sees that an account exists, never what is
// in it; and no key or token is kept in plain text.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createApp } = require("../app");
const { Accounts, slugOf, DOC } = require("../accounts");
const { clean, merge, DEFAULTS } = require("../prefs");
const { FileDocs } = require("../docs");
const { SUPERADMIN_EMAIL } = require("../config");

const quiet = { log() {}, error() {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "vpt-acc-"));
const NOW = Date.parse("2026-11-12T04:45:00Z"); // 10:15 IST, a Thursday
const KEYS = {
  owner: { key: "ownerkey11112222", secret: "ownersecret11112222", token: "OWNER-TOKEN", id: "OW0001" },
  asha: { key: "ashakey333344445", secret: "ashasecret33334444", token: "ASHA-TOKEN", id: "AS0002" },
  ravi: { key: "ravikey555566667", secret: "ravisecret55556666", token: "RAVI-TOKEN", id: "RV0003" },
};

/** A Zerodha stand-in for several accounts: which one answers is decided by the session the request carries. */
function fakeKite() {
  const k = { log: [], nextId: 500000 };
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  const who = (auth) => Object.entries(KEYS).find(([, v]) => auth === `token ${v.key}:${v.token}`);
  k.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || "GET";
    const form = init.body && typeof init.body === "string" && !init.body.startsWith("[") ? Object.fromEntries(new URLSearchParams(init.body)) : null;
    if (u.pathname === "/session/token") {
      const hit = Object.entries(KEYS).find(([, v]) => v.key === form.api_key);
      k.log.push({ method, path: u.pathname, account: hit ? hit[0] : "?" });
      if (!hit) return json(403, { status: "error", message: "Invalid api_key", error_type: "TokenException" });
      const want = crypto.createHash("sha256").update(hit[1].key + form.request_token + hit[1].secret).digest("hex");
      if (form.checksum !== want) return json(403, { status: "error", message: "Invalid checksum", error_type: "TokenException" });
      return json(200, { status: "success", data: { access_token: hit[1].token, user_id: hit[1].id, user_name: `${hit[0]} user` } });
    }
    const auth = (init.headers && (init.headers.Authorization || init.headers.authorization)) || "";
    const acct = who(auth);
    k.log.push({ method, path: u.pathname, account: acct ? acct[0] : "none", form });
    if (!acct) return json(403, { status: "error", message: "Incorrect api_key or access_token", error_type: "TokenException" });
    const name = acct[0];
    if (method === "GET" && u.pathname === "/user/margins") return json(200, { status: "success", data: { equity: { enabled: true, net: 100000, available: { cash: 100000, opening_balance: 100000, live_balance: 100000, collateral: 0, intraday_payin: 0 }, utilised: { debits: 0 } } } });
    if (method === "GET" && u.pathname === "/portfolio/positions") {
      const net = name === "asha" ? [{ tradingsymbol: "INFY", exchange: "NSE", instrument_token: 408065, product: "MIS", quantity: 5, overnight_quantity: 0, multiplier: 1, average_price: 1500, close_price: 1490, last_price: 1510, value: -7500, pnl: 50, m2m: 50, unrealised: 50, realised: 0, buy_quantity: 5, buy_price: 1500, buy_value: 7500, sell_quantity: 0, sell_price: 0, sell_value: 0, day_buy_quantity: 5, day_sell_quantity: 0 }] : [];
      return json(200, { status: "success", data: { net, day: net } });
    }
    if (method === "GET" && u.pathname === "/portfolio/holdings") return json(200, { status: "success", data: [] });
    if (method === "GET" && u.pathname === "/orders") return json(200, { status: "success", data: [] });
    if (method === "GET" && u.pathname === "/trades") return json(200, { status: "success", data: [] });
    if (method === "POST" && /^\/orders\/(regular|amo)$/.test(u.pathname)) {
      k.nextId += 1;
      return json(200, { status: "success", data: { order_id: String(k.nextId) } });
    }
    return json(400, { status: "error", message: "Route not found", error_type: "GeneralException" });
  };
  k.orders = () => k.log.filter((l) => l.method === "POST" && /^\/orders\//.test(l.path));
  return k;
}

const secrets = { encrypt: (t) => `enc(${Buffer.from(t).toString("base64")})`, decrypt: (b) => Buffer.from(String(b).slice(4, -1), "base64").toString("utf8") };
let refN = 0;
const ref = () => `ref-${String((refN += 1)).padStart(8, "0")}`;
const order = (extra = {}) => ({ exchange: "NSE", symbol: "INFY", side: "BUY", type: "LIMIT", product: "MIS", quantity: 1, price: 1500, confirm: true, clientRef: ref(), ...extra });

test("an account: only for someone on the list whom the owner switched on; its own key, login, switch and audit; nothing in plain text", async () => {
  const docs = new FileDocs(tmp());
  const kite = fakeKite();
  const admins = new Set(["asha@example.com", "ravi@example.com"]);
  const acc = new Accounts({ docs, secrets, market: { quotes: async () => ({ quotes: {} }) }, dataDir: docs.dir, isAdmin: (e) => admins.has(e), fetchImpl: kite.fetch, now: () => NOW, log: quiet, gapMs: 0 });

  // not switched on: nothing works, and nothing is created
  assert.equal(acc.allowed("asha@example.com"), false);
  assert.throws(() => acc.tradingFor("asha@example.com"), /has not been switched on for you/);
  assert.throws(() => acc.setCredentials("asha@example.com", KEYS.asha.key, KEYS.asha.secret), /has not been switched on/);
  assert.throws(() => acc.grant("stranger@example.com", "owner"), /Add this person under People first/);
  assert.deepEqual(acc.list(), []);

  acc.grant("asha@example.com", "owner@x");
  assert.equal(acc.allowed("asha@example.com"), true);
  assert.deepEqual(acc.state("asha@example.com"), { allowed: true, configured: false, connected: false, apiKeyHint: "", user: "", userId: "", loginAt: null, expiresAt: null, lastError: "" });
  assert.throws(() => acc.loginUrl("asha@example.com", "s"), /Add your Kite API key and secret first/);
  assert.throws(() => acc.setCredentials("asha@example.com", "bad key!", "x"), /letters and digits only/);

  // her own key, her own login
  acc.setCredentials("asha@example.com", KEYS.asha.key, KEYS.asha.secret);
  assert.match(acc.loginUrl("asha@example.com", "st4te"), new RegExp(`^https://kite\\.zerodha\\.com/connect/login\\?v=3&api_key=${KEYS.asha.key}&redirect_params=state%3Dst4te$`));
  const st = await acc.completeLogin("asha@example.com", "reqtoken123");
  assert.equal(st.connected, true);
  assert.equal(st.userId, KEYS.asha.id);
  assert.equal(st.apiKeyHint, "ash…45");
  assert.equal(st.expiresAt, "2026-11-13T00:30:00.000Z", "like any Kite session it ends at 6 AM the next morning");

  // nothing secret is stored as it was typed, and the owner's list holds no key, token, position or order
  const raw = JSON.stringify(docs.read(DOC));
  for (const s of [KEYS.asha.secret, KEYS.asha.token]) assert.ok(!raw.includes(s), "encrypted at rest");
  const row = acc.list()[0];
  assert.deepEqual(Object.keys(row).sort(), ["allowed", "configured", "connected", "email", "grantedAt", "kiteUser", "listed", "loginAt", "tradingOn"]);
  assert.equal(row.kiteUser, KEYS.asha.id);

  // her trading service: the same guard rails as the owner's — off until SHE turns it on
  const t = acc.tradingFor("asha@example.com");
  assert.equal(t, acc.tradingFor("asha@example.com"), "one service per account");
  assert.equal(t.status().enabled, false);
  assert.equal(t.status().connected, true);
  await assert.rejects(() => t.place(order(), "asha@example.com"), (e) => e.status === 423);
  assert.equal(kite.orders().length, 0);
  t.setSwitch(true, "asha@example.com");
  const placed = await t.place(order(), "asha@example.com");
  assert.ok(placed.orderId);
  assert.deepEqual(kite.orders().map((o) => o.account), ["asha"], "the order left on her session");
  assert.equal(kite.orders()[0].form.tradingsymbol, "INFY");
  await assert.rejects(() => t.place(order({ confirm: false }), "asha@example.com"), /confirm/i);
  // her positions, in the shape the pages draw
  const book = await acc.book("asha@example.com");
  assert.equal(book.available, true);
  assert.equal(book.open, 1);
  assert.equal(book.day, 50);
  assert.equal(book.positions[0].key, "NSE:INFY:MIS");
  assert.equal(book.streaming, false);
  // her own audit trail, under her own name in the store
  assert.ok(t.audit(10).some((a) => a.action === "place" || /place|order/i.test(a.action)));
  assert.ok(docs.read(`accounts/${slugOf("asha@example.com")}/trading/audit.json`).length >= 2);
  assert.equal(docs.tail("trading/audit").length, 0, "the owner's audit trail is untouched");

  // a second person: a second account, wholly apart
  acc.grant("ravi@example.com", "owner@x");
  acc.setCredentials("ravi@example.com", KEYS.ravi.key, KEYS.ravi.secret);
  await acc.completeLogin("ravi@example.com", "reqtoken456");
  const r = acc.tradingFor("ravi@example.com");
  assert.notEqual(r, t);
  assert.equal(r.status().enabled, false, "his switch is his own: hers being on does not turn his on");
  r.setSwitch(true, "ravi@example.com");
  await r.place(order({ symbol: "TCS" }), "ravi@example.com");
  assert.deepEqual(kite.orders().map((o) => `${o.account}:${o.form.tradingsymbol}`), ["asha:INFY", "ravi:TCS"]);
  assert.equal((await acc.book("ravi@example.com")).open, 0, "he sees his positions, not hers");
  r.setLimits({ maxQty: 3, maxValue: 10000 }, "ravi@example.com");
  assert.equal(t.status().limits.maxQty, 5000, "his limits are his own");
  await assert.rejects(() => r.place(order({ quantity: 4 }), "ravi@example.com"), /above your limit of 3/);

  // the owner switches hers off: the day's token is thrown away, her switch goes off, her service is gone
  acc.revoke("asha@example.com", "owner@x");
  assert.equal(acc.allowed("asha@example.com"), false);
  assert.equal(acc.state("asha@example.com").connected, false);
  assert.throws(() => acc.tradingFor("asha@example.com"), /has not been switched on/);
  await assert.rejects(() => t.place(order(), "asha@example.com"), (e) => e.status === 423 || e.status === 409, "even a service someone still held refuses");
  assert.equal(kite.orders().length, 2);
  // switched on again: her key is still there, her switch is OFF, and she logs in afresh
  acc.grant("asha@example.com", "owner@x");
  assert.equal(acc.state("asha@example.com").configured, true);
  assert.equal(acc.state("asha@example.com").connected, false);
  assert.equal(acc.tradingFor("asha@example.com").status().enabled, false);

  // taken off the admin list: not allowed at once, whatever her record says; forgotten: everything goes
  admins.delete("ravi@example.com");
  assert.equal(acc.allowed("ravi@example.com"), false);
  assert.throws(() => acc.tradingFor("ravi@example.com"), /has not been switched on/);
  acc.forget("ravi@example.com");
  assert.ok(!JSON.stringify(docs.read(DOC)).includes("ravi@example.com"));
  // her own choice: take the keys away
  acc.removeKeys("asha@example.com");
  assert.equal(acc.state("asha@example.com").configured, false);

  // a session Zerodha no longer accepts is forgotten, and said plainly
  acc.setCredentials("asha@example.com", KEYS.asha.key, KEYS.asha.secret);
  await acc.completeLogin("asha@example.com", "reqtoken789");
  const again = acc.tradingFor("asha@example.com");
  acc._rec("asha@example.com").kite.accessTokenEnc = secrets.encrypt("STALE-TOKEN");
  acc._services.clear();
  await assert.rejects(() => acc.tradingFor("asha@example.com").funds(), /session has expired/);
  assert.equal(acc.state("asha@example.com").connected, false);
  assert.match(acc.state("asha@example.com").lastError, /expired or was closed/);
  assert.ok(again);
});

/* ------------------------------------------------------------ over HTTP */
async function boot() {
  const dir = tmp();
  const kite = fakeKite();
  let nonce = "";
  const made = createApp({
    dataDir: dir,
    buildDir: path.join(dir, "no-build"),
    env: { SETUP_TOKEN: "tok" },
    google: () => ({
      authUrl: ({ state, nonce: n }) => ((nonce = n), `https://accounts.google.com/fake?state=${state}`),
      exchange: async (code) => ({ email: code, emailVerified: true, name: "T", picture: "", nonce }),
    }),
    holidayFetch: async () => {
      throw new Error("no network");
    },
    marketFetch: kite.fetch,
    marketGaps: { quote: 0, historical: 0, other: 0 },
    now: () => NOW,
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
          resolve({ status: res.statusCode, headers: res.headers, json: j, text, jar: (res.headers["set-cookie"] || []).map((c) => c.split(";")[0]).filter((c) => !/=$/.test(c)).join("; ") });
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
  const owner = await login(SUPERADMIN_EMAIL);
  return { dir, kite, made, request, login, owner, close: () => new Promise((r) => server.close(r)) };
}

test("over HTTP: the owner grants, the person connects their own Kite ID and trades on it; each sees only their own; the journal and the AI stay the owner's", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.request("POST", "/api/admin/admins", { cookie: s.owner, body: { email: "asha@example.com", invite: false } });
  await s.request("POST", "/api/admin/admins", { cookie: s.owner, body: { email: "ravi@example.com", invite: false } });
  const asha = await s.login("asha@example.com");
  const ravi = await s.login("ravi@example.com");

  // an admin without an account of their own: no trading at all, and they are told why
  assert.equal((await s.request("GET", "/api/auth/status", { cookie: asha })).json.user.trader, false);
  const no = await s.request("GET", "/api/admin/trading/status", { cookie: asha });
  assert.equal(no.status, 403);
  assert.match(no.json.message, /has not been switched on for you/);
  assert.equal((await s.request("POST", "/api/admin/trading/orders", { cookie: asha, body: order() })).status, 403);
  assert.equal((await s.request("PUT", "/api/admin/accounts/me/kite", { cookie: asha, body: { apiKey: KEYS.asha.key, apiSecret: KEYS.asha.secret } })).status, 403);
  // only the owner grants
  assert.equal((await s.request("GET", "/api/admin/accounts", { cookie: asha })).status, 403);
  assert.equal((await s.request("PUT", "/api/admin/accounts/people/asha%40example.com", { cookie: asha, body: { allowed: true } })).status, 403);
  assert.equal((await s.request("PUT", "/api/admin/accounts/people/nobody%40example.com", { cookie: s.owner, body: { allowed: true } })).status, 404);

  const g = await s.request("PUT", "/api/admin/accounts/people/asha%40example.com", { cookie: s.owner, body: { allowed: true } });
  assert.equal(g.status, 200, g.text);
  assert.deepEqual(g.json.people.map((p) => [p.email, p.allowed, p.configured, p.connected]), [["asha@example.com", true, false, false]]);
  assert.match(g.json.redirectUrl, /\/api\/admin\/accounts\/kite\/callback$/);
  assert.equal((await s.request("GET", "/api/auth/status", { cookie: asha })).json.user.trader, true);
  assert.equal((await s.request("GET", "/api/auth/status", { cookie: s.owner })).json.user.trader, false, "the owner uses the site's own connection");

  // she saves her key and logs in at Zerodha: the round trip is hers alone
  const me0 = await s.request("GET", "/api/admin/accounts/me", { cookie: asha });
  assert.deepEqual([me0.json.allowed, me0.json.configured, me0.json.connected, me0.json.owner], [true, false, false, false]);
  const saved = await s.request("PUT", "/api/admin/accounts/me/kite", { cookie: asha, body: { apiKey: KEYS.asha.key, apiSecret: KEYS.asha.secret } });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.json.configured, true);
  const go = await s.request("GET", "/api/admin/accounts/kite/login", { cookie: asha });
  assert.equal(go.status, 302);
  const loc = new URL(go.headers.location);
  assert.equal(loc.host, "kite.zerodha.com");
  assert.equal(loc.searchParams.get("api_key"), KEYS.asha.key);
  const state = new URLSearchParams(loc.searchParams.get("redirect_params")).get("state");
  // someone else finishing her login (their own session, her state) is refused; so is a made-up state
  assert.match((await s.request("GET", `/api/admin/accounts/kite/callback?status=success&request_token=reqtoken123&state=${state}`, { cookie: `${ravi}; ${go.jar}` })).headers.location, /account=error/);
  assert.match((await s.request("GET", "/api/admin/accounts/kite/callback?status=success&request_token=reqtoken123&state=forged", { cookie: `${asha}; ${go.jar}` })).headers.location, /account=error/);
  const back = await s.request("GET", `/api/admin/accounts/kite/callback?status=success&request_token=reqtoken123&state=${state}`, { cookie: `${asha}; ${go.jar}` });
  assert.match(back.headers.location, /\?account=connected$/);
  const me = await s.request("GET", "/api/admin/accounts/me", { cookie: asha });
  assert.equal(me.json.connected, true);
  assert.equal(me.json.userId, KEYS.asha.id);
  assert.ok(!JSON.stringify(me.json).includes(KEYS.asha.secret) && !JSON.stringify(me.json).includes(KEYS.asha.token));

  // her account, on the same pages the owner uses — but hers
  const st = await s.request("GET", "/api/admin/trading/status", { cookie: asha });
  assert.equal(st.status, 200, st.text);
  assert.deepEqual([st.json.enabled, st.json.connected, st.json.user], [false, true, "asha user"]);
  assert.equal((await s.request("POST", "/api/admin/trading/orders", { cookie: asha, body: order() })).status, 423, "her switch is off until she turns it on");
  assert.equal((await s.request("PUT", "/api/admin/trading/switch", { cookie: asha, body: { on: true } })).json.enabled, true);
  const placed = await s.request("POST", "/api/admin/trading/orders", { cookie: asha, body: order() });
  assert.equal(placed.status, 200, placed.text);
  assert.deepEqual(s.kite.orders().map((o) => o.account), ["asha"]);
  const pos = await s.request("GET", "/api/admin/trading/positions", { cookie: asha });
  assert.equal(pos.json.net.length, 1);
  const live = await s.request("GET", "/api/admin/trading/live", { cookie: asha });
  assert.deepEqual([live.json.available, live.json.open, live.json.streaming], [true, 1, false]);
  assert.ok((await s.request("GET", "/api/admin/trading/audit", { cookie: asha })).json.audit.length >= 2);

  // the owner's own trading is the site's connection: not connected here, switch off, and her order is not in its trail
  const ost = await s.request("GET", "/api/admin/trading/status", { cookie: s.owner });
  assert.deepEqual([ost.json.enabled, ost.json.connected], [false, false]);
  assert.equal((await s.request("GET", "/api/admin/trading/audit", { cookie: s.owner })).json.audit.filter((a) => /place|order/i.test(a.action)).length, 0);
  // the owner sees THAT she is connected and trading — and nothing of what is in the account
  const list = await s.request("GET", "/api/admin/accounts", { cookie: s.owner });
  assert.deepEqual(list.json.people.map((p) => [p.email, p.connected, p.kiteUser, p.tradingOn]), [["asha@example.com", true, KEYS.asha.id, true]]);
  assert.ok(!/TOKEN|secret|ashakey3333/i.test(JSON.stringify(list.json).replace(/"redirectUrl":"[^"]*"/, "")));

  // what stays the owner's: the journal, the AI coach; and the vault never serves her records one by one
  for (const url of ["/api/admin/trading/journal", "/api/admin/trading/coach", "/api/admin/vault"]) assert.equal((await s.request("GET", url, { cookie: asha })).status, 403, url);
  const slug = slugOf("asha@example.com");
  assert.equal((await s.request("GET", `/api/admin/vault/doc?name=${encodeURIComponent(`accounts/${slug}/trading/audit.json`)}`, { cookie: s.owner })).status, 404);
  assert.equal((await s.request("GET", "/api/admin/vault/doc?name=accounts%2Fsecrets.json", { cookie: s.owner })).status, 404);

  // ravi has no account: her being connected changes nothing for him
  assert.equal((await s.request("GET", "/api/admin/trading/positions", { cookie: ravi })).status, 403);

  // switched off by the owner: at once, for every route
  await s.request("PUT", "/api/admin/accounts/people/asha%40example.com", { cookie: s.owner, body: { allowed: false } });
  assert.equal((await s.request("GET", "/api/admin/trading/status", { cookie: asha })).status, 403);
  assert.equal((await s.request("POST", "/api/admin/trading/orders", { cookie: asha, body: order() })).status, 403);
  assert.equal(s.kite.orders().length, 1);
  // removed from the site: her account goes with her
  await s.request("PUT", "/api/admin/accounts/people/asha%40example.com", { cookie: s.owner, body: { allowed: true } });
  await s.request("DELETE", "/api/admin/admins/asha%40example.com", { cookie: s.owner });
  assert.deepEqual((await s.request("GET", "/api/admin/accounts", { cookie: s.owner })).json.people, []);
});

test("preferences: each person's own, checked on the way in, never able to widen what they may do", async (t) => {
  // the rules
  assert.deepEqual(clean(null), JSON.parse(JSON.stringify(DEFAULTS)));
  const odd = clean({ theme: "neon", accent: "rose", text: "huge", density: "compact", motion: "yes", nav: { order: ["journal", "nope", "journal", "analyzer"], hidden: ["analyzer", "paper", 7] }, start: "paper", desk: { board: false, dock: "sideways", chart: "m5" }, home: { today: false }, extra: "<script>" });
  assert.deepEqual(odd, { theme: "dark", accent: "rose", text: "normal", density: "compact", motion: true, nav: { order: ["journal", "analyzer"], hidden: ["paper"] }, start: "analyzer", desk: { board: false, dock: "auto", chart: "m5" }, home: { status: true, today: false, workspaces: true } });
  assert.equal(merge(odd, { desk: { dock: "closed" } }).desk.board, false, "a change moves only what it names");
  assert.equal(merge(odd, { nav: { hidden: [] }, start: "paper" }).start, "paper");

  const s = await boot();
  t.after(s.close);
  await s.request("POST", "/api/admin/admins", { cookie: s.owner, body: { email: "asha@example.com", invite: false } });
  const asha = await s.login("asha@example.com");
  assert.equal((await s.request("GET", "/api/admin/prefs")).status, 401);
  const first = await s.request("GET", "/api/admin/prefs", { cookie: asha });
  assert.deepEqual(first.json.prefs, JSON.parse(JSON.stringify(DEFAULTS)));
  assert.ok(first.json.options.accent.includes("violet") && first.json.options.views.includes("research"));
  const put = await s.request("PUT", "/api/admin/prefs", { cookie: asha, body: { theme: "light", accent: "teal", nav: { order: ["research", "analyzer"], hidden: ["debrief"] }, start: "research" } });
  assert.deepEqual([put.json.prefs.theme, put.json.prefs.accent, put.json.prefs.nav.order, put.json.prefs.nav.hidden, put.json.prefs.start], ["light", "teal", ["research", "analyzer"], ["debrief"], "research"]);
  // hers alone: the owner's are untouched
  assert.equal((await s.request("GET", "/api/admin/prefs", { cookie: s.owner })).json.prefs.theme, "dark");
  // a preference shows or hides; it grants nothing: the owner-only workspace's data is still refused
  await s.request("PUT", "/api/admin/prefs", { cookie: asha, body: { start: "journal", nav: { order: ["journal"] } } });
  assert.equal((await s.request("GET", "/api/admin/trading/journal", { cookie: asha })).status, 403);
  const reset = await s.request("DELETE", "/api/admin/prefs", { cookie: asha });
  assert.deepEqual(reset.json.prefs, JSON.parse(JSON.stringify(DEFAULTS)));
});
