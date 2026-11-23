"use strict";
// The NSE calendar through the app (23 Nov 2026): GET /api/admin/stock/holidays carries NSE's own list, its "check now"
// route reads NSE (fake network), and GET /api/admin/market/next-session answers from the same trading-day rules.
// No network, no real Google.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createApp } = require("../app");
const { SUPERADMIN_EMAIL } = require("../config");
const cal = require("../market/nse-holidays");

const CLIENT_ID = "1234567890-abcdefgh.apps.googleusercontent.com";
const NSE_BODY = fs.readFileSync(path.join(__dirname, "fixtures", "nse-holiday-master.json"), "utf8");

test.afterEach(() => cal.setOfficial(null));

async function boot({ holidayFetch } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-ns-"));
  let lastNonce = "";
  const google = () => ({
    authUrl: ({ state, nonce }) => {
      lastNonce = nonce;
      return `https://accounts.google.com/fake?state=${state}`;
    },
    exchange: async (code) => ({ email: code, emailVerified: true, name: "Test Person", picture: "", nonce: lastNonce }),
  });
  const made = createApp({
    dataDir: dir,
    buildDir: path.join(dir, "no-build"),
    env: { SETUP_TOKEN: "setup-token-123" },
    google,
    holidayFetch: holidayFetch || (async () => {
      throw new Error("no network in tests");
    }),
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
          resolve({ status: res.statusCode, json, text, jar, headers: res.headers });
        });
      });
      r.on("error", reject);
      if (payload) r.write(payload);
      r.end();
    });
  await request("POST", "/api/setup", { body: { token: "setup-token-123", googleClientId: CLIENT_ID, googleClientSecret: "GOCSPX-x" } });
  const login = async (email) => {
    const start = await request("GET", "/api/auth/google/start");
    const state = new URL(start.headers.location).searchParams.get("state");
    const cb = await request("GET", `/api/auth/google/callback?state=${state}&code=${encodeURIComponent(email)}`, { cookie: start.jar });
    return cb.jar;
  };
  return { made, request, login, close: () => new Promise((r) => server.close(r)) };
}

test("next-session and NSE's check-now need a signed-in admin (and the CSRF header)", async (t) => {
  const s = await boot();
  t.after(s.close);
  assert.equal((await s.request("GET", "/api/admin/market/next-session")).status, 401);
  assert.equal((await s.request("POST", "/api/admin/stock/holidays/nse/refresh")).status, 401);
  const boss = await s.login(SUPERADMIN_EMAIL);
  assert.equal((await s.request("POST", "/api/admin/stock/holidays/nse/refresh", { cookie: boss, csrf: false })).status, 403);
});

test("before NSE's list is read: the built-in table answers, and it says it is not verified", async (t) => {
  const s = await boot();
  t.after(s.close);
  const boss = await s.login(SUPERADMIN_EMAIL);
  let r = await s.request("GET", "/api/admin/stock/holidays", { cookie: boss });
  assert.equal(r.status, 200);
  assert.ok(r.json.nasdaq, "the NASDAQ copy is still there");
  assert.deepEqual(r.json.nse.years, {}, "reading never fetches");
  assert.equal(r.json.nse.sourceName, "NSE");

  r = await s.request("GET", "/api/admin/market/next-session", { cookie: boss });
  assert.equal(r.status, 200);
  const d = r.json;
  assert.ok(d.next.date > d.today.date, "the next trading day is after today");
  assert.equal(cal.isTradingDay(d.next.date), true);
  for (const k of d.skipped) assert.equal(cal.isTradingDay(k.date), false, `${k.date} is shut`);
  assert.equal(d.next.openClock, "9:15 AM");
  assert.equal(d.verify.status, "unverified");

  // NSE unreachable: check-now still answers, with the reason, and nothing breaks
  r = await s.request("POST", "/api/admin/stock/holidays/nse/refresh", { cookie: boss });
  assert.equal(r.status, 200);
  assert.match(r.json.nse.lastError, /no network in tests/);
});

test("check-now reads NSE's list once; the calendar, the rules and next-session then all say NSE", async (t) => {
  const asked = [];
  const s = await boot({
    holidayFetch: async (url) => {
      asked.push(url);
      return { ok: true, status: 200, text: async () => NSE_BODY };
    },
  });
  t.after(s.close);
  const boss = await s.login(SUPERADMIN_EMAIL);
  let r = await s.request("POST", "/api/admin/stock/holidays/nse/refresh", { cookie: boss });
  assert.equal(r.status, 200);
  assert.equal(r.json.nse.years["2026"].entries.length, 20);
  assert.deepEqual(asked, ["https://www.nseindia.com/api/holiday-master?type=trading"], "only NSE was asked (the NASDAQ route is separate)");
  assert.equal(r.json.nse.verify[0].status, "match");

  r = await s.request("GET", "/api/admin/stock/holidays", { cookie: boss });
  assert.equal(r.json.nse.years["2026"].entries[18].date, "2026-11-24");
  assert.equal(cal.sourceOf(2026), "nse");

  r = await s.request("GET", "/api/admin/market/next-session", { cookie: boss });
  assert.equal(r.status, 200);
  if (r.json.today.date.startsWith("2026")) {
    assert.equal(r.json.calendar.years["2026"], "nse");
    if (!r.json.next.date.startsWith("2027")) assert.equal(r.json.verify.status, "match");
  }
});

test("the exchange clock route: signed-in only, never cached, receive and send stamps", async (t) => {
  const s = await boot();
  t.after(s.close);
  assert.equal((await s.request("GET", "/api/admin/clock")).status, 401);
  const boss = await s.login(SUPERADMIN_EMAIL);
  const before = Date.now();
  const r = await s.request("GET", "/api/admin/clock", { cookie: boss });
  assert.equal(r.status, 200);
  assert.equal(r.headers["cache-control"], "no-store");
  assert.ok(Number.isFinite(r.json.t1) && Number.isFinite(r.json.t2));
  assert.ok(r.json.t2 >= r.json.t1, "sent after it arrived");
  assert.ok(Math.abs(r.json.t1 - before) < 5000, "the server's clock (no time server asked in tests)");
  assert.equal(r.json.source, "system");
  assert.match(r.json.zone, /Asia\/Kolkata/);
});
