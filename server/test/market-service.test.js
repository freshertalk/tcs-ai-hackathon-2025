"use strict";
// The Analyzer's data layer and API, against a FAKE Zerodha. No network.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createApp } = require("../app");
const { tokenExpiry, isMarketHours } = require("../market/service");
const { parseCsv, loginUrl } = require("../market/kite");
const { SUPERADMIN_EMAIL } = require("../config");

const API_KEY = "abcd1234efgh5678";
const API_SECRET = "zyxw9876vuts5432";
const DAY = 86400000;

/* ------------------------------------------------------------ fake Kite */
function fakeKite() {
  const k = {
    log: [], // every request made to "Zerodha"
    failWith: null, // { status, body } → every data call fails this way
    networkDown: false,
    scale: 1, // multiply all historical prices (simulates a split re-adjustment)
    extraBars: 0,
    today: "2026-11-12",
    extra: {}, // "EXCHANGE:SYMBOL" → a raw Kite quote, for instruments a test adds
    failNext: 0, // answer this many data calls with "too many requests"
  };
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

  // a deterministic daily series: weekdays from 2014 up to "today"
  function series(today) {
    const out = [];
    let p = 500;
    let i = 0;
    for (let t = Date.UTC(2014, 0, 1); t <= Date.parse(`${today}T00:00:00Z`); t += DAY) {
      const dow = new Date(t).getUTCDay();
      if (dow === 0 || dow === 6) continue;
      const o = p;
      p = p * (1 + (Math.sin(i / 9) * 0.6 + 0.05) / 100);
      out.push([`${iso(t)}T00:00:00+0530`, o * k.scale, Math.max(o, p) * 1.004 * k.scale, Math.min(o, p) * 0.996 * k.scale, p * k.scale, 100000 + (i % 7) * 1000]);
      i += 1;
    }
    return out;
  }

  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

  k.fetch = async (url, init = {}) => {
    const u = new URL(url);
    k.log.push({ method: init.method || "GET", path: u.pathname, search: u.search, auth: (init.headers || {}).Authorization || "" });
    if (k.networkDown) throw new Error("getaddrinfo ENOTFOUND api.kite.trade");

    if (u.pathname === "/session/token") {
      const f = new URLSearchParams(init.body);
      const want = crypto.createHash("sha256").update(API_KEY + f.get("request_token") + API_SECRET).digest("hex");
      if (f.get("api_key") !== API_KEY || f.get("checksum") !== want) return json(403, { status: "error", message: "Invalid checksum", error_type: "TokenException" });
      return json(200, { status: "success", data: { access_token: "ACCESS-TOKEN-XYZ", user_id: "AB1234", user_name: "Vinay Kumar Tiwari" } });
    }

    if (k.failWith) return json(k.failWith.status, k.failWith.body);
    if (k.failNext > 0) {
      k.failNext -= 1;
      return json(429, { status: "error", message: "Too many requests", error_type: "NetworkException" });
    }
    if (!/^token abcd1234efgh5678:ACCESS-TOKEN-XYZ$/.test((init.headers || {}).Authorization || "")) {
      return json(403, { status: "error", message: "Incorrect api_key or access_token", error_type: "TokenException" });
    }

    if (u.pathname === "/instruments/NSE") {
      const rows = ["instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange"];
      rows.push('408065,1594,INFY,INFOSYS,0,,0,0.05,1,EQ,NSE,NSE');
      rows.push('2953217,11536,TCS,TATA CONSULTANCY SERV LT,0,,0,0.05,1,EQ,NSE,NSE');
      rows.push('738561,2885,RELIANCE,RELIANCE INDUSTRIES,0,,0,0.05,1,EQ,NSE,NSE');
      rows.push('519937,2031,M&M,"MAHINDRA & MAHINDRA, LTD",0,,0,0.05,1,EQ,NSE,NSE');
      rows.push('256265,1001,NIFTY 50,NIFTY 50,0,,0,0,0,EQ,INDICES,NSE');
      rows.push('999,3,INFY26NOVFUT,INFY,0,2026-11-26,0,0.05,400,FUT,NFO-FUT,NFO');
      for (let i = 0; i < 120; i += 1) rows.push(`${5000 + i},${i},ZZFILL${i},FILLER ${i},0,,0,0.05,1,EQ,NSE,NSE`);
      return { ok: true, status: 200, text: async () => rows.join("\n") };
    }

    if (u.pathname === "/quote") {
      const data = {};
      for (const key of u.searchParams.getAll("i")) {
        if (k.extra[key]) data[key] = k.extra[key];
        if (key === "NSE:INFY") data[key] = { instrument_token: 408065, last_price: 1512.5, volume: 4200000, average_price: 1508.2, buy_quantity: 1000, sell_quantity: 800, net_change: 12.5, lower_circuit_limit: 1350, upper_circuit_limit: 1650, last_trade_time: "2026-11-12 10:15:00", ohlc: { open: 1503, high: 1515, low: 1499, close: 1500 } };
        if (key === "NSE:M&M") {
          // a quote that agrees with the price history: up 1.2% on the day, trading above its average price
          const hist = series(k.today);
          const pc = hist[hist.length - 2][4];
          data[key] = { instrument_token: 519937, last_price: Math.round(pc * 1.012 * 20) / 20, volume: 300000, average_price: pc * 1.006, lower_circuit_limit: pc * 0.9, upper_circuit_limit: pc * 1.1, last_trade_time: `${k.today} 10:14:58`, ohlc: { open: pc * 1.001, high: pc * 1.013, low: pc * 0.999, close: pc } };
        }
        if (key === "NSE:TCS") data[key] = { instrument_token: 2953217, last_price: 3960, volume: 900000, ohlc: { open: 4000, high: 4010, low: 3950, close: 4000 } };
      }
      return json(200, { status: "success", data });
    }

    const m = u.pathname.match(/^\/instruments\/historical\/(\d+)\/(day|5minute|minute)$/);
    if (m) {
      const from = u.searchParams.get("from").slice(0, 10);
      const to = u.searchParams.get("to").slice(0, 10);
      if (m[2] === "minute") {
        // forty 1-minute bars from 09:15, climbing a little each minute
        const hist = series(to);
        const pc = hist[hist.length - 2][4];
        const bars = [];
        for (let i = 0; i < 40; i += 1) {
          const mins = 15 + i;
          const o = pc * (1.001 + 0.0003 * i);
          bars.push([`${to}T${mins < 60 ? "09" : "10"}:${String(mins % 60).padStart(2, "0")}:00+0530`, o, o * 1.0006, o * 0.9997, o * 1.0003, 3000 + i * 10]);
        }
        return json(200, { status: "success", data: { candles: bars } });
      }
      if (m[2] === "5minute") {
        const bars = [];
        if (m[1] === "519937") {
          // M&M: a steady morning climb from yesterday's close
          const hist = series(to);
          const pc = hist[hist.length - 2][4];
          for (let i = 0; i < 12; i += 1) {
            const mins = 15 + i * 5;
            const o = pc * (1.001 + 0.001 * i);
            bars.push([`${to}T${mins < 60 ? "09" : "10"}:${String(mins % 60).padStart(2, "0")}:00+0530`, o, o * 1.0015, o * 0.9995, o * 1.001, 20000 + i * 500]);
          }
        } else for (let i = 0; i < 6; i += 1) bars.push([`${to}T09:${15 + i * 5}:00+0530`, 100 + i, 101 + i, 99.5 + i, 100.5 + i, 1000]);
        return json(200, { status: "success", data: { candles: bars } });
      }
      const all = series(to);
      return json(200, { status: "success", data: { candles: all.filter((c) => c[0].slice(0, 10) >= from && c[0].slice(0, 10) <= to) } });
    }
    return json(400, { status: "error", message: "Route not found", error_type: "GeneralException" });
  };
  return k;
}

/* --------------------------------------------------------------- harness */
async function boot(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-mkt-"));
  const kite = fakeKite();
  const clock = { ms: Date.parse("2026-11-12T04:45:00Z") }; // Thu 10:15 IST — market open
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
    screenerIndex: "all", // the fake exchange lists made-up names; the Nifty 100 scope has its own test
    marketGaps: { quote: 0, historical: 0, other: 0 },
    now: () => clock.ms,
    ...extra,
  });
  const server = await new Promise((res) => {
    const s = made.app.listen(0, "127.0.0.1", () => res(s));
  });
  const port = server.address().port;

  const request = (method, url, { cookie, body, csrf = true } = {}) =>
    new Promise((resolve, reject) => {
      const h = {};
      if (cookie) h.cookie = cookie;
      if (csrf && method !== "GET") h["x-requested-with"] = "vpt";
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
          let json = null;
          try {
            json = JSON.parse(text);
          } catch (_) {
            /* not JSON */
          }
          const jar = (res.headers["set-cookie"] || []).map((c) => c.split(";")[0]).filter((c) => !/=$/.test(c)).join("; ");
          resolve({ status: res.statusCode, headers: res.headers, json, text, jar });
        });
      });
      r.on("error", reject);
      if (payload) r.write(payload);
      r.end();
    });

  await request("POST", "/api/setup", { body: { token: "tok", googleClientId: "1234567890-abcdefgh.apps.googleusercontent.com", googleClientSecret: "GOCSPX-secret-secret" } });
  const start = await request("GET", "/api/auth/google/start");
  const state = new URL(start.headers.location).searchParams.get("state");
  const cb = await request("GET", `/api/auth/google/callback?state=${state}&code=${encodeURIComponent(SUPERADMIN_EMAIL)}`, { cookie: start.jar });
  const admin = cb.jar;

  // the full Zerodha login round trip
  async function connectKite() {
    await request("PUT", "/api/admin/market/kite", { cookie: admin, body: { apiKey: API_KEY, apiSecret: API_SECRET } });
    const go = await request("GET", "/api/admin/market/kite/login", { cookie: admin });
    const st = new URLSearchParams(new URL(go.headers.location).searchParams.get("redirect_params")).get("state");
    return request("GET", `/api/admin/market/kite/callback?request_token=REQTOKEN123&action=login&status=success&state=${st}`, { cookie: `${admin}; ${go.jar}` });
  }

  const close = () =>
    new Promise((r) => {
      if (made.market.ticker) made.market.ticker.close();
      if (server.closeAllConnections) server.closeAllConnections(); // an open event stream would keep it alive
      server.close(r);
    });
  return { dir, kite, clock, made, request, admin, connectKite, port, close };
}

const dataCalls = (kite) => kite.log.filter((l) => l.path !== "/session/token");

/* ----------------------------------------------------------------- units */

test("a Kite token expires at 6 AM IST on the day after login", () => {
  const at = (s) => Date.parse(s);
  // logged in Thu 12 Nov 10:00 IST → dies Fri 13 Nov 06:00 IST (00:30 UTC)
  assert.equal(new Date(tokenExpiry(at("2026-11-12T04:30:00Z"))).toISOString(), "2026-11-13T00:30:00.000Z");
  // logged in at 02:00 IST → dies the same morning at 06:00 IST
  assert.equal(new Date(tokenExpiry(at("2026-11-11T20:30:00Z"))).toISOString(), "2026-11-12T00:30:00.000Z");
  // logged in exactly at 06:00 IST → the next day
  assert.equal(new Date(tokenExpiry(at("2026-11-12T00:30:00Z"))).toISOString(), "2026-11-13T00:30:00.000Z");
});

test("market hours are judged in IST, on weekdays", () => {
  assert.equal(isMarketHours(Date.parse("2026-11-12T04:45:00Z")), true); // Thu 10:15 IST
  assert.equal(isMarketHours(Date.parse("2026-11-12T12:00:00Z")), false); // Thu 17:30 IST
  assert.equal(isMarketHours(Date.parse("2026-11-14T04:45:00Z")), false); // Saturday
  assert.equal(isMarketHours(Date.parse("2026-11-11T23:00:00Z")), false); // Thu 04:30 IST
});

test("CSV parsing copes with quoted commas", () => {
  assert.deepEqual(parseCsv('a,b\n1,"x, y"\r\n2,"he said ""hi"""\n'), [["a", "b"], ["1", "x, y"], ["2", 'he said "hi"']]);
});

test("the login URL carries the key and a state, nothing secret", () => {
  const u = new URL(loginUrl(API_KEY, "STATE1"));
  assert.equal(u.origin + u.pathname, "https://kite.zerodha.com/connect/login");
  assert.equal(u.searchParams.get("api_key"), API_KEY);
  assert.equal(u.searchParams.get("redirect_params"), "state=STATE1");
  assert.ok(!u.href.includes(API_SECRET));
});

/* ------------------------------------------------------------ connection */

test("every market route needs a signed-in admin", async (t) => {
  const s = await boot();
  t.after(s.close);
  for (const p of ["/api/admin/market/status", "/api/admin/market/quotes", "/api/admin/market/scan", "/api/admin/market/analysis/INFY", "/api/admin/market/backtest/INFY", "/api/admin/market/search?q=IN", "/api/admin/market/watchlist"]) {
    assert.equal((await s.request("GET", p)).status, 401, p);
  }
  assert.equal((await s.request("PUT", "/api/admin/market/kite", { body: { apiKey: API_KEY, apiSecret: API_SECRET } })).status, 401);
  // not signed in → the Kite login/callback just go back to the sign-in page
  assert.equal((await s.request("GET", "/api/admin/market/kite/login")).headers.location, "/me");
  assert.equal((await s.request("GET", "/api/admin/market/kite/callback?request_token=x&state=y")).headers.location, "/me");
});

test("Kite credentials: validated, stored encrypted, never sent back", async (t) => {
  const s = await boot();
  t.after(s.close);
  let r = await s.request("PUT", "/api/admin/market/kite", { cookie: s.admin, body: { apiKey: "bad key!", apiSecret: API_SECRET } });
  assert.equal(r.status, 400);
  r = await s.request("PUT", "/api/admin/market/kite", { cookie: s.admin, body: { apiKey: API_KEY, apiSecret: "" } });
  assert.equal(r.status, 400, "a secret is required the first time");

  r = await s.request("PUT", "/api/admin/market/kite", { cookie: s.admin, body: { apiKey: API_KEY, apiSecret: API_SECRET } });
  assert.equal(r.status, 200);
  assert.equal(r.json.kite.configured, true);
  assert.equal(r.json.kite.connected, false);
  assert.ok(!r.text.includes(API_SECRET) && !r.text.includes(API_KEY), "neither the key nor the secret is echoed");
  assert.equal(r.json.kite.apiKeyHint, "abc…78");

  const disk = fs.readFileSync(path.join(s.dir, "db.json"), "utf8");
  assert.ok(!disk.includes(API_SECRET), "secret is encrypted at rest");
});

test("the daily login: state-checked round trip, checksum-signed exchange, token encrypted", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.request("PUT", "/api/admin/market/kite", { cookie: s.admin, body: { apiKey: API_KEY, apiSecret: API_SECRET } });

  const go = await s.request("GET", "/api/admin/market/kite/login", { cookie: s.admin });
  assert.equal(go.status, 302);
  assert.match(go.headers.location, /^https:\/\/kite\.zerodha\.com\/connect\/login\?/);
  const st = new URLSearchParams(new URL(go.headers.location).searchParams.get("redirect_params")).get("state");

  // forged state → refused, nothing exchanged
  let cb = await s.request("GET", "/api/admin/market/kite/callback?request_token=REQTOKEN123&status=success&state=forged", { cookie: `${s.admin}; ${go.jar}` });
  assert.match(cb.headers.location, /kite=error/);
  assert.equal(s.kite.log.filter((l) => l.path === "/session/token").length, 0);

  // no state cookie → refused
  cb = await s.request("GET", `/api/admin/market/kite/callback?request_token=REQTOKEN123&status=success&state=${st}`, { cookie: s.admin });
  assert.match(cb.headers.location, /kite=error/);

  // the real thing
  cb = await s.request("GET", `/api/admin/market/kite/callback?request_token=REQTOKEN123&status=success&state=${st}`, { cookie: `${s.admin}; ${go.jar}` });
  assert.equal(cb.headers.location, "/me/stock-report?kite=connected");

  const status = (await s.request("GET", "/api/admin/market/status", { cookie: s.admin })).json;
  assert.equal(status.mode, "kite");
  assert.equal(status.kite.user, "Vinay Kumar Tiwari");
  assert.equal(status.kite.expiresAt, "2026-11-13T00:30:00.000Z");
  assert.match(status.redirectUrl, /\/api\/admin\/market\/kite\/callback$/);

  const disk = fs.readFileSync(path.join(s.dir, "db.json"), "utf8");
  assert.ok(!disk.includes("ACCESS-TOKEN-XYZ"), "the access token is encrypted at rest");
});

test("a wrong secret is reported, not swallowed", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.request("PUT", "/api/admin/market/kite", { cookie: s.admin, body: { apiKey: API_KEY, apiSecret: "wrongsecret12345" } });
  const go = await s.request("GET", "/api/admin/market/kite/login", { cookie: s.admin });
  const st = new URLSearchParams(new URL(go.headers.location).searchParams.get("redirect_params")).get("state");
  const cb = await s.request("GET", `/api/admin/market/kite/callback?request_token=REQTOKEN123&status=success&state=${st}`, { cookie: `${s.admin}; ${go.jar}` });
  assert.match(decodeURIComponent(cb.headers.location), /Zerodha said: Invalid checksum/);
  assert.equal((await s.request("GET", "/api/admin/market/status", { cookie: s.admin })).json.mode, "none");
});

test("the session ends by itself at 6 AM IST and the page is told to log in again", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  s.clock.ms = Date.parse("2026-11-13T00:29:00Z");
  assert.equal((await s.request("GET", "/api/admin/market/status", { cookie: s.admin })).json.mode, "kite");
  s.clock.ms = Date.parse("2026-11-13T00:31:00Z");
  const st = (await s.request("GET", "/api/admin/market/status", { cookie: s.admin })).json;
  assert.equal(st.mode, "none");
  assert.equal(st.kite.connected, false);
  assert.equal(st.kite.configured, true, "the key and secret are kept — only the day's token is gone");
});

/* ------------------------------------------------------------------ data */

test("instrument search finds equities and indices, and nothing from other exchanges", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  let r = await s.request("GET", "/api/admin/market/search?q=inf", { cookie: s.admin });
  assert.deepEqual(r.json.results.map((x) => x.symbol), ["INFY"]);
  r = await s.request("GET", "/api/admin/market/search?q=mahindra", { cookie: s.admin });
  assert.deepEqual(r.json.results[0], { symbol: "M&M", name: "MAHINDRA & MAHINDRA, LTD", kind: "EQ" });
  r = await s.request("GET", "/api/admin/market/search?q=NIFTY", { cookie: s.admin });
  assert.equal(r.json.results[0].kind, "INDEX");

  // the list is fetched once a day, not once per search
  assert.equal(s.kite.log.filter((l) => l.path === "/instruments/NSE").length, 1);
});

test("live quotes are mapped correctly and change is measured from the previous close", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  await s.request("PUT", "/api/admin/market/watchlist", { cookie: s.admin, body: { symbols: ["INFY", "TCS"] } });
  const r = await s.request("GET", "/api/admin/market/quotes", { cookie: s.admin });
  assert.equal(r.json.live, true);
  const q = r.json.quotes;
  assert.equal(q.INFY.last, 1512.5);
  assert.equal(q.INFY.prevClose, 1500);
  assert.equal(q.INFY.change, 12.5);
  assert.ok(Math.abs(q.INFY.changePct - 0.8333) < 0.001);
  assert.equal(q.INFY.upperCircuit, 1650);
  assert.equal(q.TCS.changePct, -1);

  // a burst of page polls becomes one upstream call
  await s.request("GET", "/api/admin/market/quotes", { cookie: s.admin });
  await s.request("GET", "/api/admin/market/quotes", { cookie: s.admin });
  assert.equal(s.kite.log.filter((l) => l.path === "/quote").length, 1);
  s.clock.ms += 3000;
  await s.request("GET", "/api/admin/market/quotes", { cookie: s.admin });
  assert.equal(s.kite.log.filter((l) => l.path === "/quote").length, 2);
});

test("history: downloaded once, cached, then topped up — not re-downloaded", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  const hist = () => s.kite.log.filter((l) => l.path.includes("/historical/408065/day")).length;

  let a = (await s.request("GET", "/api/admin/market/analysis/INFY", { cookie: s.admin })).json;
  assert.equal(a.enoughData, true);
  assert.equal(a.source, "kite");
  assert.equal(a.stale, false);
  assert.ok(a.bars > 2000, `${a.bars} bars`);
  assert.equal(a.asOf, "2026-11-12");
  assert.equal(a.barInProgress, true, "it is 10:15 IST on a trading day: today's bar is still forming");
  const first = hist();
  assert.equal(first, 3, "~10 years in 3 requests");
  assert.ok(a.relative && a.relative.name === "NIFTY 50", "the index was loaded for relative strength");

  await s.request("GET", "/api/admin/market/analysis/INFY", { cookie: s.admin });
  assert.equal(hist(), first, "inside the cache window: no new request");

  s.clock.ms += 6 * 60 * 1000; // cache window (5 min in market hours) passed
  await s.request("GET", "/api/admin/market/analysis/INFY", { cookie: s.admin });
  assert.equal(hist(), first + 1, "one small top-up request");

  s.clock.ms = Date.parse("2026-11-13T05:00:00Z"); // next day (token expired at 00:30 UTC)
  a = (await s.request("GET", "/api/admin/market/analysis/INFY", { cookie: s.admin })).json;
  assert.equal(a.stale, true, "not connected any more → saved data, clearly marked");
  assert.match(a.staleReason, /not connected/i);
});

test("a split/bonus re-adjustment of past prices triggers a full re-download", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  const hist = () => s.kite.log.filter((l) => l.path.includes("/historical/408065/day")).length;
  const before = (await s.request("GET", "/api/admin/market/analysis/INFY", { cookie: s.admin })).json;
  const n0 = hist();

  s.kite.scale = 0.5; // the exchange halves every historical price (1:1 bonus)
  s.clock.ms += 6 * 60 * 1000;
  const after = (await s.request("GET", "/api/admin/market/analysis/INFY", { cookie: s.admin })).json;
  assert.equal(hist(), n0 + 1 + 3, "the top-up disagreed with the cache → whole history fetched again");
  assert.ok(Math.abs(after.price.last - before.price.last / 2) < 0.02);
  assert.ok(Math.abs(after.levels.week52.high - before.levels.week52.high / 2) < 0.02, "no half-old, half-new history");
});

test("Zerodha down → the last good data is served and marked stale; nothing saved → a clear error", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  const ok = (await s.request("GET", "/api/admin/market/analysis/INFY", { cookie: s.admin })).json;

  s.kite.networkDown = true;
  s.clock.ms += 10 * 60 * 1000;
  let r = await s.request("GET", "/api/admin/market/analysis/INFY", { cookie: s.admin });
  assert.equal(r.status, 200);
  assert.equal(r.json.stale, true);
  assert.match(r.json.staleReason, /Could not refresh from Kite/);
  assert.equal(r.json.price.last, ok.price.last, "same numbers as before the outage");

  r = await s.request("GET", "/api/admin/market/analysis/RELIANCE", { cookie: s.admin });
  assert.equal(r.status, 502);
  assert.equal(typeof r.json.message, "string");

  r = await s.request("GET", "/api/admin/market/quotes?symbols=INFY", { cookie: s.admin });
  assert.equal(r.status, 502, "quotes cannot be invented");
});

test("a token killed early (403 TokenException) ends the session cleanly", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  await s.request("GET", "/api/admin/market/analysis/INFY", { cookie: s.admin });

  s.kite.failWith = { status: 403, body: { status: "error", message: "Token is invalid or has expired.", error_type: "TokenException" } };
  s.clock.ms += 10 * 60 * 1000;
  const r = await s.request("GET", "/api/admin/market/quotes?symbols=INFY", { cookie: s.admin });
  assert.equal(r.status, 409);
  assert.equal(r.json.error, "not_connected");

  const st = (await s.request("GET", "/api/admin/market/status", { cookie: s.admin })).json;
  assert.equal(st.mode, "none");
  assert.match(st.kite.lastError, /Log in again/);
  // saved history still works
  const a = await s.request("GET", "/api/admin/market/analysis/INFY", { cookie: s.admin });
  assert.equal(a.json.stale, true);
});

test("unknown symbols and bad input are refused with a reason", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  let r = await s.request("GET", "/api/admin/market/analysis/NOSUCHSTOCK", { cookie: s.admin });
  assert.equal(r.status, 404);
  r = await s.request("GET", "/api/admin/market/analysis/%3Cscript%3E", { cookie: s.admin });
  assert.equal(r.status, 400);
  r = await s.request("GET", "/api/admin/market/backtest/INFY?strategy=nope", { cookie: s.admin });
  assert.equal(r.status, 400);
  r = await s.request("GET", "/api/admin/market/analysis/DEMO-UPTREND", { cookie: s.admin });
  assert.equal(r.status, 404, "demo symbols do not exist outside demo mode");
});

test("watchlist: cleaned, de-duplicated, capped, and saved", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  let r = await s.request("PUT", "/api/admin/market/watchlist", { cookie: s.admin, body: { symbols: [" infy ", "TCS", "INFY", "<bad>", "M&M"] } });
  assert.deepEqual(r.json.watchlist, ["INFY", "TCS", "M&M"]);
  r = await s.request("PUT", "/api/admin/market/watchlist", { cookie: s.admin, body: { symbols: Array.from({ length: 41 }, (_, i) => `SYM${i}`) } });
  assert.equal(r.status, 400);
  r = await s.request("PUT", "/api/admin/market/watchlist", { cookie: s.admin, body: { symbols: "INFY" } });
  assert.equal(r.status, 400);
  assert.deepEqual((await s.request("GET", "/api/admin/market/watchlist", { cookie: s.admin })).json.watchlist, ["INFY", "TCS", "M&M"]);
});

test("scan: one bad symbol does not sink the rest", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  await s.request("PUT", "/api/admin/market/watchlist", { cookie: s.admin, body: { symbols: ["INFY", "GHOST", "TCS"] } });
  const r = (await s.request("GET", "/api/admin/market/scan", { cookie: s.admin })).json;
  assert.equal(r.rows.length, 3);
  assert.equal(r.rows[0].enoughData, true);
  assert.equal(typeof r.rows[0].score, "number");
  assert.equal(r.rows[1].enoughData, false);
  assert.match(r.rows[1].error, /not in the NSE instrument list/);
  assert.equal(r.rows[2].enoughData, true);
});

test("backtests run over the saved history, one strategy or all of them", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  let r = (await s.request("GET", "/api/admin/market/backtest/INFY", { cookie: s.admin })).json;
  assert.equal(r.rows.length, 7);
  r.rows.forEach((row) => assert.equal(row.stats.enoughData, true));
  r = (await s.request("GET", "/api/admin/market/backtest/INFY?strategy=supertrend_flip&cost=0.5", { cookie: s.admin })).json;
  assert.equal(r.costPct, 0.5);
  assert.ok(r.equity.length > 10 && r.equity.length <= 401);
  assert.ok(Array.isArray(r.trades));
});

test("intraday levels: VWAP and the first-15-minute range from 5-minute bars", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  const r = (await s.request("GET", "/api/admin/market/intraday/INFY", { cookie: s.admin })).json;
  assert.equal(r.available, true);
  assert.equal(r.bars, 6);
  assert.deepEqual(r.openingRange, { high: 103, low: 99.5 });
  assert.equal(r.dayHigh, 106);
  assert.ok(r.vwap > 100 && r.vwap < 106);
});

/* ------------------------------------------------------------------ demo */

test("demo mode: made-up symbols only, clearly labelled, no Zerodha calls at all", async (t) => {
  const s = await boot();
  t.after(s.close);
  let r = await s.request("PUT", "/api/admin/market/demo", { cookie: s.admin, body: { on: true } });
  assert.equal(r.json.mode, "demo");
  assert.ok(r.json.watchlist.every((x) => x.startsWith("DEMO-")));

  const a = (await s.request("GET", "/api/admin/market/analysis/DEMO-UPTREND", { cookie: s.admin })).json;
  assert.equal(a.source, "demo");
  assert.equal(a.enoughData, true);
  assert.equal(a.barInProgress, false);
  assert.ok(a.setups.length === 7 && a.score.factors.length >= 10);

  r = await s.request("GET", "/api/admin/market/analysis/INFY", { cookie: s.admin });
  assert.equal(r.status, 404, "no real tickers in demo mode — a fake INFY price must be impossible");

  const q = (await s.request("GET", "/api/admin/market/quotes", { cookie: s.admin })).json;
  assert.equal(q.live, false);
  assert.equal(Object.keys(q.quotes).length, 5);

  assert.equal(s.kite.log.length, 0, "demo mode never talks to Zerodha");

  // deterministic: the same history every time
  const again = (await s.request("GET", "/api/admin/market/analysis/DEMO-UPTREND", { cookie: s.admin })).json;
  assert.equal(again.price.last, a.price.last);
});

/* -------------------------------------------------- the read-only promise */

test("READ-ONLY: the market module only ever reads from Zerodha — trading lives apart, in server/trading", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  await s.request("PUT", "/api/admin/market/watchlist", { cookie: s.admin, body: { symbols: ["INFY", "TCS"] } });
  for (const p of ["/api/admin/market/quotes", "/api/admin/market/scan", "/api/admin/market/analysis/INFY", "/api/admin/market/backtest/INFY", "/api/admin/market/intraday/INFY", "/api/admin/market/search?q=TC"]) {
    await s.request("GET", p, { cookie: s.admin });
  }
  // 1. everything sent to Zerodha after login is a GET to a market-data path
  const calls = dataCalls(s.kite);
  assert.ok(calls.length >= 6);
  for (const c of calls) {
    assert.equal(c.method, "GET", `${c.method} ${c.path}`);
    assert.match(c.path, /^\/(quote|instruments\/NSE|instruments\/historical\/\d+\/(day|5minute|minute))$/, c.path);
  }
  assert.equal(s.kite.log.filter((l) => l.method !== "GET").length, 1, "the only non-GET is the login token exchange");

  // 2. the code contains no order, GTT, portfolio or funds endpoint at all
  const dir = path.join(__dirname, "..", "market");
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(src, /["'`/](orders|gtt|portfolio|margins|mf\/|positions|holdings)\b/i, `${f} must not reference trading endpoints`);
  }
});

/* ---------------------------------------------------------------- verdict */

test("verdict: live quote, circuits, today's 5-minute bars and yesterday's pivots come together", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  // the fake series ends near 500-ish prices; ask what it closed at so the quote can sit beside it
  const a = (await s.request("GET", "/api/admin/market/analysis/TCS", { cookie: s.admin })).json;
  assert.equal(a.barInProgress, true, "10:15 IST on a weekday: today's bar is unfinished");
  assert.equal(a.levels.lastBar.date, "2026-11-12");
  assert.equal(a.levels.pivots.basedOn, "2026-11-11", "pivots come from the last completed session");

  const r = await s.request("GET", "/api/admin/market/verdict/INFY", { cookie: s.admin });
  assert.equal(r.status, 200);
  const v = r.json;
  // INFY's fake quote (1512.5) is nowhere near the fake history → refused, not guessed
  assert.equal(v.available, false);
  assert.match(v.reason, /corporate action/);
  assert.equal(v.symbol, "INFY");
});

test("verdict: a symbol with no quote still gets a full reading, and says the quote is missing", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  const v = (await s.request("GET", "/api/admin/market/verdict/RELIANCE", { cookie: s.admin })).json;
  assert.equal(v.available, true);
  assert.equal(v.quoteLive, false);
  assert.match(v.quoteNote, /no quote/);
  assert.equal(v.live, false);
  assert.equal(v.circuit, null);
  assert.ok(["bullish", "bearish", "neutral"].includes(v.direction));
  // market is open, so the 5-minute bars were fetched and the intraday frame has a reading
  assert.ok(v.frames[2].dir, "intraday frame is filled from today's bars");
  assert.match(v.intraday.basedOn, /opening range/);
  assert.ok(v.intraday.long.entry > v.intraday.short.entry);
  assert.ok(v.ladder.length > 8);

  // polled again at once: the 5-minute bars are not downloaded twice
  await s.request("GET", "/api/admin/market/verdict/RELIANCE", { cookie: s.admin });
  await s.request("GET", "/api/admin/market/intraday/RELIANCE", { cookie: s.admin });
  assert.equal(s.kite.log.filter((l) => /\/738561\/5minute$/.test(l.path)).length, 1);
  s.clock.ms += 31000;
  await s.request("GET", "/api/admin/market/verdict/RELIANCE", { cookie: s.admin });
  assert.equal(s.kite.log.filter((l) => /\/738561\/5minute$/.test(l.path)).length, 2);
});

test("verdict: when Zerodha goes down it degrades to saved data and says so — it does not fail", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  const first = (await s.request("GET", "/api/admin/market/verdict/RELIANCE", { cookie: s.admin })).json;
  assert.equal(first.stale, false);

  s.kite.networkDown = true;
  s.clock.ms += 10 * 60 * 1000; // past the cache window, so a refresh is attempted and fails
  const r = await s.request("GET", "/api/admin/market/verdict/RELIANCE", { cookie: s.admin });
  assert.equal(r.status, 200);
  assert.equal(r.json.available, true);
  assert.equal(r.json.stale, true);
  assert.match(r.json.quoteNote, /unavailable/);
  assert.ok(r.json.against.some((x) => /saved data/.test(x)));
  assert.ok(r.json.conviction <= first.conviction);
});

test("verdict: needs a signed-in admin, a valid symbol, and a known one", async (t) => {
  const s = await boot();
  t.after(s.close);
  assert.equal((await s.request("GET", "/api/admin/market/verdict/INFY")).status, 401);
  await s.connectKite();
  assert.equal((await s.request("GET", "/api/admin/market/verdict/NOPE", { cookie: s.admin })).status, 404);
  assert.equal((await s.request("GET", "/api/admin/market/verdict/%3Cscript%3E", { cookie: s.admin })).status, 400);
});

test("verdict in demo mode: works without Zerodha, with a labelled demo price band", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.request("PUT", "/api/admin/market/demo", { cookie: s.admin, body: { on: true } });
  for (const sym of ["DEMO-UPTREND", "DEMO-DOWNTREND", "DEMO-RANGE", "DEMO-VOLATILE", "DEMO-CYCLES"]) {
    const v = (await s.request("GET", `/api/admin/market/verdict/${sym}`, { cookie: s.admin })).json;
    assert.equal(v.available, true, sym);
    assert.equal(v.source, "demo");
    assert.equal(v.quoteLive, false);
    assert.ok(v.circuit && v.circuit.upper > v.last && v.circuit.lower < v.last, sym);
  }
  assert.equal(dataCalls(s.kite).length, 0, "demo mode never calls Zerodha");
});

test("quotes are cached per symbol: a single-stock poll does not evict the watchlist's answers", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  await s.request("PUT", "/api/admin/market/watchlist", { cookie: s.admin, body: { symbols: ["INFY", "TCS"] } });
  const calls = () => s.kite.log.filter((l) => l.path === "/quote");
  await s.request("GET", "/api/admin/market/quotes", { cookie: s.admin });
  await s.request("GET", "/api/admin/market/quotes?symbols=RELIANCE", { cookie: s.admin });
  await s.request("GET", "/api/admin/market/quotes", { cookie: s.admin });
  assert.equal(calls().length, 2);
  assert.equal(new URLSearchParams(calls()[1].search).getAll("i").join(), "NSE:RELIANCE", "only the new symbol was asked for");
});

test("verdict: in market hours it carries a live intraday call from the quote and today's bars, plus the long-term view", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  const get = async () => (await s.request("GET", "/api/admin/market/verdict/M%26M", { cookie: s.admin })).json;
  const v = await get();
  assert.equal(v.available, true);
  assert.equal(v.quoteLive, true);
  assert.equal(v.live, true);

  // the live call
  assert.equal(v.day.available, true);
  assert.equal(v.day.session.ist, "10:15");
  assert.equal(v.day.session.phase, "morning");
  assert.ok(["long", "wait-long"].includes(v.day.state), v.day.state);
  assert.ok(v.day.score > 0);
  assert.equal(v.day.movement.last, v.last);
  assert.ok(v.day.movement.vsVwapPct > 0, "above the exchange's average traded price");
  assert.equal(v.day.movement.quoteAgeSec, 2);
  assert.equal(v.day.movement.bars, 12);
  if (v.day.plan) assert.ok(v.day.plan.stop < v.day.plan.entry);

  // the tape for the intraday chart
  assert.equal(v.tape.today, true);
  assert.equal(v.tape.bars.length, 12);
  assert.equal(v.tape.bars[0].t, "09:15");
  assert.ok(v.tape.orHigh > v.tape.orLow);

  // the long-term view and the circuit limits ride along
  assert.equal(v.longTerm.available, true);
  assert.ok(v.longTerm.returns.cagr5 !== null, "the fake history is more than five years long");
  assert.ok(v.circuit.upper > v.last && v.circuit.lower < v.last);

  // the 5-minute request reaches back several days, to warm up the intraday averages
  const five = s.kite.log.filter((l) => /\/519937\/5minute$/.test(l.path));
  assert.equal(five.length, 1);
  assert.ok(new URLSearchParams(five[0].search).get("from").slice(0, 10) < "2026-11-10");

  // polled every 5 seconds: quotes refresh, but nothing heavy is fetched again
  const daily = () => s.kite.log.filter((l) => /\/519937\/day$/.test(l.path)).length;
  const before = daily();
  s.clock.ms += 5000;
  const again = await get();
  assert.equal(again.day.available, true);
  assert.equal(daily(), before, "the daily history is not downloaded again");
  assert.equal(s.kite.log.filter((l) => /\/519937\/5minute$/.test(l.path)).length, 1, "nor are the 5-minute bars, inside 20 seconds");
  assert.equal(s.kite.log.filter((l) => l.path === "/quote" && /M%26M/.test(l.search)).length, 2, "only the quote is asked for again");

  // after the close: the same stock, no live call
  s.clock.ms = Date.parse("2026-11-12T12:30:00Z"); // 6:00 PM IST
  const evening = await get();
  assert.equal(evening.available, true);
  assert.equal(evening.day.available, false);
  assert.match(evening.day.reason, /closed/);
});

test("verdict in demo mode says plainly that there is no live tape", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.request("PUT", "/api/admin/market/demo", { cookie: s.admin, body: { on: true } });
  const v = (await s.request("GET", "/api/admin/market/verdict/DEMO-UPTREND", { cookie: s.admin })).json;
  assert.equal(v.day.available, false);
  assert.match(v.day.reason, /Demo prices have no live tape/);
  assert.equal(v.longTerm.available, true);
});

/* ------------------------------------------- live stream and market context */

const { fakeSocket, openStream, until } = require("./helpers/fake-socket");

test("live stream: ticks reach the page as server-sent events, and every quote uses them at once", async (t) => {
  const WS = fakeSocket();
  const s = await boot({ marketWs: WS, tickerOptions: { retryMs: 5, idleMs: 40 } });
  t.after(s.close);
  await s.connectKite();
  const stream = await openStream(s.port, "/api/admin/market/stream?symbols=INFY,TCS,NIFTY%2050,NOPE", s.admin);
  t.after(stream.close);
  assert.equal(stream.status, 200);
  assert.match(stream.headers["content-type"], /text\/event-stream/);
  assert.match(stream.headers["cache-control"], /no-transform/, "so a proxy or compression layer cannot buffer it");

  const sock = await until(() => WS.sockets[0]);
  await until(() => sock.sent.length >= 2);
  assert.equal(sock.url, "wss://ws.kite.trade?api_key=abcd1234efgh5678&access_token=ACCESS-TOKEN-XYZ");
  assert.deepEqual(sock.sent[0], { a: "subscribe", v: [408065, 2953217, 256265] });
  assert.deepEqual(sock.sent[1], { a: "mode", v: ["full", [408065, 2953217, 256265]] });
  await stream.next((e) => e.event === "status" && e.data.state === "live");

  sock.push([
    { token: 408065, last: 1520.5, lastQty: 10, avgPrice: 1511.2, volume: 4300000, buyQty: 900, sellQty: 700, open: 1503, high: 1521, low: 1499, prevClose: 1500, lastTradeTime: Date.parse("2026-11-12T04:45:07Z"), bid: 1520.45, bidQty: 50, ask: 1520.55, askQty: 80 },
    { token: 256265, last: 24120.5, high: 24150, low: 23980, open: 24000, prevClose: 23950 },
  ]);
  const tick = await stream.next((e) => e.event === "tick" && e.data.s === "INFY");
  assert.equal(tick.data.last, 1520.5);
  assert.equal(tick.data.bid, 1520.45);
  assert.equal(tick.data.ask, 1520.55);
  assert.equal(tick.data.time, "2026-11-12 10:15:07");
  assert.ok(Math.abs(tick.data.changePct - 1.36667) < 0.001);
  const idx = await stream.next((e) => e.event === "tick" && e.data.s === "NIFTY 50");
  assert.equal(idx.data.last, 24120.5);
  assert.equal(idx.data.volume, undefined, "an index has no volume");

  // the polled quote now carries the streamed price, and keeps what only the poll knows
  await s.request("PUT", "/api/admin/market/watchlist", { cookie: s.admin, body: { symbols: ["INFY", "TCS"] } });
  const q = (await s.request("GET", "/api/admin/market/quotes", { cookie: s.admin })).json;
  assert.equal(q.streaming, true);
  assert.equal(q.quotes.INFY.last, 1520.5);
  assert.equal(q.quotes.INFY.upperCircuit, 1650, "circuit limits still come from the poll");
  assert.equal(q.quotes.TCS.last, 3960, "no tick yet for TCS: the polled price stands");

  // while the stream is live, the poll for a streamed symbol relaxes from 2.5 s to 30 s
  const polls = () => s.kite.log.filter((l) => l.path === "/quote" && /INFY/.test(l.search)).length;
  const before = polls();
  s.clock.ms += 5000;
  sock.push([{ token: 408065, last: 1522, prevClose: 1500, open: 1503, high: 1522, low: 1499, avgPrice: 1511.4, volume: 4310000 }]);
  await stream.next((e) => e.event === "tick" && e.data.last === 1522);
  const q2 = (await s.request("GET", "/api/admin/market/quotes", { cookie: s.admin })).json;
  assert.equal(q2.quotes.INFY.last, 1522);
  assert.equal(polls(), before, "INFY was not polled again");

  // a dropped connection reconnects and resubscribes by itself; meanwhile the polled price is used
  sock.terminate();
  await stream.next((e) => e.event === "status" && e.data.state === "down");
  const sock2 = await until(() => WS.sockets[1]);
  await until(() => sock2.sent.length >= 2);
  assert.deepEqual([...sock2.sent[0].v].sort(), [256265, 2953217, 408065].sort());

  // when the page goes away, the subscription is released and the socket is closed
  stream.close();
  await until(() => sock2.closed);
  // the stream never asked Zerodha for anything except market data
  for (const m of [...sock.sent, ...sock2.sent]) assert.ok(["subscribe", "unsubscribe", "mode"].includes(m.a));
});

test("the stream needs a signed-in admin, and says plainly when there is nothing to stream", async (t) => {
  const s = await boot({ marketWs: fakeSocket() });
  t.after(s.close);
  const anon = await openStream(s.port, "/api/admin/market/stream?symbols=INFY", "");
  assert.equal(anon.status, 401);
  anon.close();

  const idle = await openStream(s.port, "/api/admin/market/stream?symbols=INFY", s.admin);
  const off = await idle.next((e) => e.event === "status");
  assert.equal(off.data.state, "off");
  assert.match(off.data.reason, /not connected/);
  idle.close();

  await s.request("PUT", "/api/admin/market/demo", { cookie: s.admin, body: { on: true } });
  const demo = await openStream(s.port, "/api/admin/market/stream?symbols=DEMO-UPTREND", s.admin);
  assert.match((await demo.next((e) => e.event === "status")).data.reason, /Demo prices do not stream/);
  demo.close();

  // a server built without a socket (as the other tests are) says so instead of failing
  const plain = await boot();
  t.after(plain.close);
  await plain.connectKite();
  const none = await openStream(plain.port, "/api/admin/market/stream?symbols=INFY", plain.admin);
  assert.match((await none.next((e) => e.event === "status")).data.reason, /not available on this server/);
  none.close();
});

test("market context: the Nifty's tide, VIX, sectors and overseas-linked futures — and the live call shows what the market did to the score", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  const idx = (last, open, high, low, close, volume) => ({ last_price: last, volume, ohlc: { open, high, low, close } });
  Object.assign(s.kite.extra, {
    "NSE:NIFTY 50": idx(24140, 24000, 24150, 23980, 23950),
    "NSE:NIFTY BANK": idx(52300, 52000, 52350, 51950, 51900),
    "NSE:INDIA VIX": idx(13.2, 13.9, 14, 13.1, 14),
    "NSE:NIFTY IT": idx(40200, 40000, 40250, 39900, 39800),
    "NSE:NIFTY AUTO": idx(23100, 23000, 23150, 22950, 22900),
    "NSE:NIFTY PHARMA": idx(21900, 22000, 22050, 21850, 22000),
    "NSEIX:GIFT NIFTY": idx(24210, 24100, 24230, 24080, 24050),
    "CDS:USDINR26NOVFUT": idx(88.4, 88.2, 88.45, 88.15, 88.1, 5000),
    "CDS:USDINR26DECFUT": idx(88.6, 88.4, 88.65, 88.35, 88.3, 300),
    "MCX:CRUDEOIL26NOVFUT": idx(5820, 5700, 5830, 5690, 5680, 9000),
  });
  const r = await s.request("GET", "/api/admin/market/context", { cookie: s.admin });
  assert.equal(r.status, 200, r.text);
  const c = r.json;
  assert.equal(c.available, true);
  assert.equal(c.tide.label, "Rising");
  assert.equal(c.tide.score, 76);
  assert.equal(c.tide.factors.reduce((a, f) => a + f.max, 0), 100);
  assert.equal(c.nifty.changePct, 0.79);
  assert.equal(c.nifty.fromOpenPct, 0.58);
  assert.equal(c.vix.level, "normal");
  const by = Object.fromEntries(c.items.map((x) => [x.id, x]));
  assert.equal(by.gift.available, true);
  assert.equal(by.usdinr.last, 88.4, "the contract with the volume is the front month");
  assert.equal(by.crude.changePct, 2.46);
  assert.equal(by.gold.available, false, "no gold quote → shown as unavailable, not invented");
  assert.deepEqual(c.sectors.map((x) => x.name), ["IT", "Auto", "Pharma"]);
  assert.deepEqual(c.breadth, { up: 2, down: 1, flat: 0, total: 3 });
  assert.ok(c.notes.some((n) => /Crude oil/.test(n)));
  assert.equal(c.world, null, "no world brief has been made");

  // one upstream call for everything, shared for five seconds
  const calls = () => s.kite.log.filter((l) => l.path === "/quote" && /NIFTY/.test(l.search)).length;
  assert.equal(calls(), 1);
  await s.request("GET", "/api/admin/market/context", { cookie: s.admin });
  assert.equal(calls(), 1);

  const v = (await s.request("GET", "/api/admin/market/verdict/M%26M", { cookie: s.admin })).json;
  const d = v.day;
  assert.equal(d.available, true);
  assert.deepEqual(d.marketFactors.map((f) => f.name), ["Market tide (Nifty)", "Strength vs Nifty since the open"]);
  assert.equal(d.marketFactors[0].pts, 6);
  assert.match(d.marketFactors[0].reading, /^Rising tide \(\+76\)/);
  assert.equal(d.marketAdj, d.marketFactors[0].pts + d.marketFactors[1].pts);
  assert.equal(d.tapeScore, d.factors.reduce((a, f) => a + f.pts, 0));
  assert.equal(d.score, Math.max(-100, Math.min(100, d.tapeScore + d.marketAdj)));

  // if Zerodha stops answering, the last reading is served for a while, marked stale — then it is an error
  s.kite.networkDown = true;
  s.clock.ms += 20000;
  const stale = (await s.request("GET", "/api/admin/market/context", { cookie: s.admin })).json;
  assert.equal(stale.stale, true);
  assert.equal(stale.tide.score, 76);
  s.clock.ms += 3 * 60000;
  assert.equal((await s.request("GET", "/api/admin/market/context", { cookie: s.admin })).status, 502);
});

test("market context needs an admin and a Zerodha session", async (t) => {
  const s = await boot();
  t.after(s.close);
  assert.equal((await s.request("GET", "/api/admin/market/context")).status, 401);
  const c = (await s.request("GET", "/api/admin/market/context", { cookie: s.admin })).json;
  assert.equal(c.available, false);
  assert.match(c.reason, /not connected/);
});

/* ---------------------------------------------------------------- screener */

const Ind = require("../market/indicators");

/** Start the background download and wait for it to end. */
async function syncUniverse(s, body = {}) {
  const started = await s.request("POST", "/api/admin/market/screener/sync", { cookie: s.admin, body });
  for (let i = 0; i < 600; i += 1) {
    const st = (await s.request("GET", "/api/admin/market/screener/status", { cookie: s.admin })).json;
    if (!st.job.running) return { started, st };
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("the download did not finish");
}
const fillerCalls = (s) => s.kite.log.filter((l) => /\/5\d{3}\/day$/.test(l.path)).length;

test("screener: the first use downloads every NSE stock once, in the background, and an interrupted run resumes", async (t) => {
  const s = await boot();
  t.after(s.close);
  s.made.market.universePauseMs = 5;
  // nothing without Zerodha
  assert.equal((await s.request("GET", "/api/admin/market/screener/rsi?max=30", { cookie: s.admin })).status, 409);
  assert.equal((await s.request("POST", "/api/admin/market/screener/sync", { cookie: s.admin, body: {} })).status, 409);
  assert.equal((await s.request("GET", "/api/admin/market/screener/status")).status, 401);
  await s.connectKite();

  let st = (await s.request("GET", "/api/admin/market/screener/status", { cookie: s.admin })).json;
  assert.equal(st.ready, false);
  assert.equal(st.symbols, 0);
  assert.equal(st.connected, true);
  // a search before the download says so, rather than returning an empty list as if nothing matched
  const early = (await s.request("GET", "/api/admin/market/screener/rsi?max=30", { cookie: s.admin })).json;
  assert.equal(early.ready, false);

  await s.request("GET", "/api/admin/market/search?q=IN", { cookie: s.admin }); // the stock list is now in memory
  s.kite.failNext = 1; // one "too many requests" on the way: retried after a pause, not counted as a failure
  const run = await syncUniverse(s);
  assert.equal(run.started.json.job.running, true, "the request returns at once; the work goes on behind it");
  assert.equal(run.started.json.connected, true, "the same shape as the status call, so the page does not lose track of the connection");
  st = run.st;
  assert.equal(st.ready, true);
  assert.equal(st.symbols, 124, "INFY, TCS, RELIANCE, M&M and 120 others — the index and the future are not stocks");
  assert.deepEqual([st.job.done, st.job.total, st.job.failed, st.job.error], [124, 124, 0, ""]);
  assert.equal(st.through, "2026-11-12");
  assert.equal(fillerCalls(s), 120, "one request per stock");
  assert.equal(s.kite.log.filter((l) => /\/408065\/day$/.test(l.path)).length, 2, "the rate-limited request was made again");
  assert.ok(fs.existsSync(path.join(s.dir, "market", "universe.json")));

  // starting it again the same day downloads nothing — this is how an interrupted run carries on
  await syncUniverse(s);
  assert.equal(fillerCalls(s), 120);
  // …unless a fresh copy is asked for
  await syncUniverse(s, { force: true });
  assert.equal(fillerCalls(s), 240);

  // Zerodha going away mid-download stops it with a reason instead of grinding through 2,000 failures
  s.kite.networkDown = true;
  const broken = await syncUniverse(s, { force: true });
  assert.match(broken.st.job.error, /stopped answering/);
  assert.equal(broken.st.symbols, 124, "what was already downloaded is kept");
});

test("screener: RSI for every stock at this moment, filtered — checked against an independent calculation", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  await syncUniverse(s);

  // M&M's expected RSI, worked out here from the same history and the same quote
  const res = await s.kite.fetch("https://api.kite.trade/instruments/historical/519937/day?from=2025-06-01+00%3A00%3A00&to=2026-11-12+10%3A15%3A00", { headers: { Authorization: "token abcd1234efgh5678:ACCESS-TOKEN-XYZ" } });
  const candles = (await res.json()).data.candles;
  const r2 = (x) => Math.round(x * 100) / 100;
  const closes = candles.filter((c) => c[0].slice(0, 10) <= "2026-11-11").map((c) => r2(c[4])).slice(-259);
  const pc = candles[candles.length - 2][4];
  const last = Math.round(pc * 1.012 * 20) / 20;
  const series = Ind.rsi([...closes, last], 14);
  const expected = Math.round(series[series.length - 1] * 10) / 10;
  const before = Math.round(series[series.length - 2] * 10) / 10;
  const last20 = candles.slice(-20);
  const turnover = r2(last20.reduce((a, c) => a + c[4] * c[5], 0) / 20 / 1e7);

  const scan = async (q) => s.request("GET", `/api/admin/market/screener/rsi?${q}`, { cookie: s.admin });
  const hit = (await scan(`min=${expected - 1}&max=${expected + 1}`)).json;
  assert.equal(hit.ready, true);
  assert.equal(hit.period, 14);
  assert.equal(hit.session, "2026-11-11", "the previous close is the 11th's");
  assert.equal(hit.live, true);
  assert.equal(hit.considered, 124);
  assert.equal(hit.matched, 1);
  assert.deepEqual(hit.rows[0], { symbol: "M&M", name: "MAHINDRA & MAHINDRA, LTD", last, changePct: r2(((last - pc) / pc) * 100), rsi: expected, rsiPrev: before, volume: 300000, avgTurnoverCr: turnover, fund: false });
  assert.ok(hit.rows[0].rsi > hit.rows[0].rsiPrev, "the stock is up today, so its RSI is above yesterday's");
  // INFY and TCS have quotes that disagree with their stored history: left out, and queued for a fresh download
  assert.deepEqual(hit.skipped, { noQuote: 121, outOfDate: 2, tooShort: 0 });
  assert.equal(hit.mending, 2);

  // the range is what decides
  assert.equal((await scan(`min=${expected + 2}`)).json.matched, 0);
  assert.equal((await scan(`max=${expected - 2}`)).json.matched, 0);
  assert.equal((await scan("min=0&max=100")).json.matched, 1);
  assert.equal((await scan("max=100&minPrice=99999999")).json.matched, 0);
  assert.equal((await scan(`max=100&minTurnover=${turnover + 1}`)).json.matched, 0);
  assert.equal((await scan(`max=100&minTurnover=${Math.max(0.01, turnover - 0.01)}`)).json.matched, 1);
  const seven = (await scan("max=100&period=7")).json;
  assert.equal(seven.period, 7);
  assert.notEqual(seven.rows[0].rsi, expected);

  // every stock's price came in one batched request, shared for 20 seconds
  const batches = () => s.kite.log.filter((l) => l.path === "/quote" && /ZZFILL0/.test(l.search));
  assert.equal(batches().length, 1);
  assert.equal(new URLSearchParams(batches()[0].search).getAll("i").length, 125, "124 stocks and the Nifty");
  s.clock.ms += 21000;
  await scan("max=100");
  assert.equal(batches().length, 2);

  // bad input is refused with a reason
  for (const [q, why] of [["", /Enter an RSI value/], ["min=120", /0 to 100/], ["max=-1", /0 to 100/], ["min=60&max=40", /lower RSI value is above/], ["max=30&period=1", /between 2 and 50/], ["max=abc", /0 to 100/]]) {
    const bad = await scan(q);
    assert.equal(bad.status, 400, q);
    assert.match(bad.json.message, why);
  }
  assert.equal((await s.request("GET", "/api/admin/market/screener/rsi?max=30")).status, 401);
});

test("screener: a series one session behind rolls forward from the quote, with no download", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  await syncUniverse(s);
  const u = s.made.market.universe;
  // pretend M&M was last downloaded two sessions ago: its stored series ends on the 10th
  const rec = u._load().symbols["M&M"];
  const full = rec.c.slice();
  rec.c = full.slice(0, -2); // drop the 11th and today's forming bar
  rec.d = "2026-11-10";
  const mmCalls = () => s.kite.log.filter((l) => /\/519937\/day$/.test(l.path)).length;
  const calls = mmCalls();
  const out = (await s.request("GET", "/api/admin/market/screener/rsi?max=100", { cookie: s.admin })).json;
  assert.equal(out.matched, 1);
  assert.equal(mmCalls(), calls, "no history was fetched");
  // the 11th's close came from the quote's previous close, and was kept
  assert.equal(rec.d, "2026-11-11");
  assert.equal(rec.c.length, full.length - 1);
  assert.ok(Math.abs(rec.c[rec.c.length - 1] - full[full.length - 2]) < 0.011);
  // and it gives the same RSI as the fully downloaded series did
  rec.c = full.slice();
  rec.d = "2026-11-12";
  s.clock.ms += 21000;
  const again = (await s.request("GET", "/api/admin/market/screener/rsi?max=100", { cookie: s.admin })).json;
  assert.equal(again.rows[0].rsi, out.rows[0].rsi);
});

/* ------------------------------------------------- 1-minute tape, order flow */

test("the 1-minute tape: bars for the chart, the opening range, and a quick read of trend and structure", async (t) => {
  const s = await boot();
  t.after(s.close);
  assert.equal((await s.request("GET", "/api/admin/market/tape/M%26M?interval=1")).status, 401);
  assert.equal((await s.request("GET", "/api/admin/market/tape/M%26M?interval=1", { cookie: s.admin })).json.available, false, "nothing without Zerodha");
  await s.connectKite();
  const r = await s.request("GET", "/api/admin/market/tape/M%26M?interval=1", { cookie: s.admin });
  assert.equal(r.status, 200, r.text);
  const out = r.json;
  assert.equal(out.available, true);
  assert.equal(out.step, 1);
  assert.equal(out.tape.step, 1);
  assert.equal(out.tape.today, true);
  assert.equal(out.tape.bars.length, 40);
  assert.deepEqual([out.tape.bars[0].t, out.tape.bars[39].t], ["09:15", "09:54"]);
  assert.ok(out.tape.orHigh > out.tape.orLow, "the opening range is the first fifteen 1-minute bars");
  const firstFifteen = out.tape.bars.slice(0, 15);
  assert.equal(out.tape.orHigh, Math.max(...firstFifteen.map((b) => b.h)));
  assert.ok(out.tape.bars[39].w > out.tape.bars[0].w, "VWAP is carried on every bar");
  // the quick read
  assert.equal(out.fast.available, true);
  assert.equal(out.fast.bars, 40);
  assert.equal(out.fast.trend, "up");
  assert.ok(out.fast.rsi > 60);
  assert.ok(out.fast.m5Pct > 0 && out.fast.m15Pct > out.fast.m5Pct);
  assert.match(out.fast.summary, /^1-minute trend up/);

  // shared for ten seconds, then fetched again
  const calls = () => s.kite.log.filter((l) => /\/519937\/minute$/.test(l.path)).length;
  assert.equal(calls(), 1);
  await s.request("GET", "/api/admin/market/tape/M%26M?interval=1", { cookie: s.admin });
  assert.equal(calls(), 1);
  s.clock.ms += 11000;
  await s.request("GET", "/api/admin/market/tape/M%26M?interval=1", { cookie: s.admin });
  assert.equal(calls(), 2);

  // the 5-minute tape through the same door, with no quick read
  const five = (await s.request("GET", "/api/admin/market/tape/M%26M?interval=5", { cookie: s.admin })).json;
  assert.equal(five.step, 5);
  assert.equal(five.tape.bars.length, 12);
  assert.equal(five.fast, null);
});

test("order flow: the stock in focus gets its order book and the flow reading with every tick; the others do not", async (t) => {
  const WS = fakeSocket();
  const s = await boot({ marketWs: WS, tickerOptions: { retryMs: 5, idleMs: 40 } });
  t.after(s.close);
  await s.connectKite();
  const stream = await openStream(s.port, "/api/admin/market/stream?symbols=INFY,TCS&focus=INFY", s.admin);
  t.after(stream.close);
  const sock = await until(() => WS.sockets[0]);
  await stream.next((e) => e.event === "status" && e.data.state === "live");
  const depth = {
    b: [[1520, 900, 20], [1519.95, 800, 18], [1519.9, 700, 15], [1519.85, 600, 12], [1519.8, 500, 10]],
    a: [[1520.05, 100, 5], [1520.1, 100, 5], [1520.15, 100, 5], [1520.2, 100, 5], [1520.25, 100, 5]],
  };
  sock.push([
    { token: 408065, last: 1520.05, prevClose: 1500, volume: 1000, buyQty: 90000, sellQty: 20000, depth },
    { token: 2953217, last: 3961, prevClose: 4000, volume: 500, depth: { b: [[3960.95, 10, 1]], a: [[3961, 10, 1]] } },
  ]);
  const infy = await stream.next((e) => e.event === "tick" && e.data.s === "INFY");
  assert.deepEqual(infy.data.depth, depth);
  assert.equal(infy.data.flow.available, true);
  assert.equal(infy.data.flow.label, "Buyers pressing");
  assert.ok(infy.data.flow.pressure >= 50);
  assert.equal(infy.data.flow.imbalanceTotalPct, 64);
  assert.equal(infy.data.flow.lean.dir, "learning");
  assert.equal(infy.data.flow.spreadTicks, 1);
  const tcs = await stream.next((e) => e.event === "tick" && e.data.s === "TCS");
  assert.equal(tcs.data.depth, undefined, "only the stock in focus carries the book");
  assert.equal(tcs.data.flow, undefined);
  assert.equal(tcs.data.bid, 3960.95);

  // a second tick with more volume traded at the offer: buying
  sock.push([{ token: 408065, last: 1520.05, prevClose: 1500, volume: 1600, buyQty: 90000, sellQty: 20000, depth }]);
  const next = await stream.next((e) => e.event === "tick" && e.data.s === "INFY" && e.data.flow.delta30 === 600);
  assert.equal(next.data.flow.delta30, 600);
  // when the page leaves, the model for that stock is dropped
  stream.close();
  await until(() => s.made.market.flow.snapshot(408065) === null);
});

test("verdict: the 1-minute read rides along with the live call, and the chart is told whether its newest bar is still forming", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.connectKite();
  const v = (await s.request("GET", "/api/admin/market/verdict/M%26M", { cookie: s.admin })).json;
  assert.equal(v.day.available, true);
  assert.equal(v.day.fast.available, true);
  assert.equal(v.day.fast.bars, 40);
  assert.match(v.day.fast.summary, /^1-minute trend /);
  assert.equal(v.tape.step, 5);
  assert.equal(typeof v.tape.forming, "boolean");
  // the minute bars are fetched once and shared with the chart's own request
  assert.equal(s.kite.log.filter((l) => /\/519937\/minute$/.test(l.path)).length, 1);
  await s.request("GET", "/api/admin/market/tape/M%26M?interval=1", { cookie: s.admin });
  assert.equal(s.kite.log.filter((l) => /\/519937\/minute$/.test(l.path)).length, 1);

  // "forming" is judged against the clock: a bar is settled the instant its time is up
  const m = s.made.market;
  s.clock.ms = Date.parse("2026-11-12T10:14:30+05:30");
  assert.equal(m._forming([{ t: "2026-11-12T10:14:00+0530" }], 1), true);
  assert.equal(m._forming([{ t: "2026-11-12T10:10:00+0530" }], 5), true);
  s.clock.ms = Date.parse("2026-11-12T10:15:00+05:30");
  assert.equal(m._forming([{ t: "2026-11-12T10:14:00+0530" }], 1), false);
  assert.equal(m._forming([{ t: "2026-11-12T10:10:00+0530" }], 5), false);
  assert.equal(m._forming([], 1), false);
  s.clock.ms = Date.parse("2026-11-12T18:00:00+05:30");
  assert.equal(m._forming([{ t: "2026-11-12T15:29:00+0530" }], 1), false, "nothing is forming after the close");
  // the company's name comes from the instrument list; an unknown symbol has none
  assert.equal(typeof (await m.nameOf("INFY")), "string");
  assert.ok((await m.nameOf("INFY")).length > 0);
  assert.equal(await m.nameOf("NOSUCHSYMBOL"), "");
});

/* ----------------------------------------------------- day replay, scorecard */

test("day replay and scorecard: the watchlist's session replayed through the live call, by arithmetic", async (t) => {
  const s = await boot();
  t.after(s.close);
  assert.equal((await s.request("GET", "/api/admin/market/scorecard")).status, 401);
  assert.equal((await s.request("GET", "/api/admin/market/replay/INFY")).status, 401);
  // without Zerodha there are no intraday bars to replay, and it says so
  let r = await s.request("GET", "/api/admin/market/scorecard", { cookie: s.admin });
  assert.equal(r.status, 200);
  assert.equal(r.json.available, false);
  assert.match(r.json.reason, /Zerodha/);
  assert.equal((await s.request("GET", "/api/admin/market/replay/INFY", { cookie: s.admin })).json.available, false);

  await s.connectKite();
  await s.request("PUT", "/api/admin/market/watchlist", { cookie: s.admin, body: { symbols: [] } });
  assert.match((await s.request("GET", "/api/admin/market/scorecard", { cookie: s.admin })).json.reason, /watchlist is empty/);
  await s.request("PUT", "/api/admin/market/watchlist", { cookie: s.admin, body: { symbols: ["INFY", "M&M"] } });

  // one stock
  r = await s.request("GET", "/api/admin/market/replay/M%26M", { cookie: s.admin });
  assert.equal(r.status, 200, r.text);
  const one = r.json;
  assert.equal(one.available, true);
  assert.equal(one.symbol, "M&M");
  assert.equal(one.date, "2026-11-12");
  assert.equal(one.today, true);
  assert.equal(one.costPct, 0.1);
  assert.equal(one.steps.length, 12, "twelve 5-minute bars have printed by 10:15");
  assert.deepEqual([one.steps[0].t, one.steps[11].t], ["09:20", "10:15"]);
  assert.equal(one.day.complete, false);
  assert.equal(one.day.bars, 12);
  assert.ok(one.day.prevClose > 0 && one.day.open > 0);
  for (const tr of one.trades) assert.ok(tr.side === "long" ? tr.stop < tr.entry : tr.stop > tr.entry);
  // the daily picture is the one from BEFORE the session: today's own bar is not used
  const quoted = (await s.request("GET", "/api/admin/market/quotes?symbols=M%26M", { cookie: s.admin })).json.quotes["M&M"];
  assert.equal(one.day.prevClose, Math.round(quoted.prevClose * 100) / 100, "measured from yesterday's close, as the exchange quotes it");

  // a different cost assumption is honoured and bounded
  const dear = (await s.request("GET", "/api/admin/market/replay/M%26M?cost=0.3", { cookie: s.admin })).json;
  assert.equal(dear.costPct, 0.3);
  assert.deepEqual(dear.steps, one.steps);
  assert.equal((await s.request("GET", "/api/admin/market/replay/M%26M?cost=50", { cookie: s.admin })).json.costPct, 1);
  assert.equal((await s.request("GET", "/api/admin/market/replay/M%26M?cost=abc", { cookie: s.admin })).json.costPct, 0.1);
  assert.equal((await s.request("GET", "/api/admin/market/replay/bad%20symbol!", { cookie: s.admin })).status, 400);

  // the whole watchlist
  const before = s.kite.log.length;
  r = await s.request("GET", "/api/admin/market/scorecard", { cookie: s.admin });
  assert.equal(r.status, 200, r.text);
  const card = r.json;
  assert.equal(card.available, true);
  assert.equal(card.date, "2026-11-12");
  assert.equal(card.today, true);
  assert.equal(card.complete, false);
  assert.deepEqual(card.rows.map((x) => [x.symbol, x.available]), [["INFY", true], ["M&M", true]]);
  assert.equal(card.totals.stocks, 2);
  assert.equal(card.skipped, 0);
  assert.equal(card.totals.calls, card.rows.reduce((a, x) => a + x.summary.calls, 0));
  assert.equal(card.curve.length, card.rows.reduce((a, x) => a + x.summary.finished, 0));
  // asked again inside a minute: nothing is fetched from Zerodha again
  const mid = s.kite.log.length;
  assert.ok(mid > before, "INFY's bars had to be fetched once");
  await s.request("GET", "/api/admin/market/scorecard", { cookie: s.admin });
  assert.equal(s.kite.log.length, mid);

  // a stock Zerodha does not know does not sink the others
  await s.request("PUT", "/api/admin/market/watchlist", { cookie: s.admin, body: { symbols: ["INFY", "NOSUCH"] } });
  const mixed = (await s.request("GET", "/api/admin/market/scorecard", { cookie: s.admin })).json;
  assert.equal(mixed.available, true);
  assert.deepEqual(mixed.rows.map((x) => [x.symbol, x.available]), [["INFY", true], ["NOSUCH", false]]);
  assert.ok(mixed.rows[1].reason.length > 0);
  assert.equal(mixed.totals.stocks, 1);

  // only read-only Zerodha routes were used for all of this
  for (const l of s.kite.log) assert.match(l.path, /^\/(session\/token|quote|instruments\/NSE|instruments\/historical\/\d+\/(day|5minute|minute))$/, l.path);
});

test("the weekly grouping is remembered between readings and still gives the same weeks", () => {
  const { toWeekly, weekStart } = require("../market/longterm");
  assert.equal(weekStart("2026-11-12"), "2026-11-09", "a Thursday belongs to the week of its Monday");
  assert.equal(weekStart("2026-11-09"), "2026-11-09");
  assert.equal(weekStart("2026-11-15"), "2026-11-09", "Sunday closes the week");
  assert.equal(weekStart("2026-11-16T09:15:00+0530"), "2026-11-16");
  assert.equal(weekStart("2026-11-12"), "2026-11-09", "asked twice, answered the same");
  const days = ["2026-11-09", "2026-11-10", "2026-11-13", "2026-11-16", "2026-11-17"].map((t, i) => ({ t, o: 10 + i, h: 12 + i, l: 9 + i, c: 11 + i, v: 100 }));
  const wk = toWeekly(days);
  assert.deepEqual(wk, [
    { t: "2026-11-09", o: 10, h: 14, l: 9, c: 13, v: 300 },
    { t: "2026-11-16", o: 13, h: 16, l: 12, c: 15, v: 200 },
  ]);
  assert.deepEqual(toWeekly(days), wk);
  assert.throws(() => weekStart("not a date"));
});
