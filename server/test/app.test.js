"use strict";
// Run with:  npm test   (inside server/)   — no network, no real Google.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createApp, isLocalHost } = require("../app");
const { encrypt, decrypt, sign, verify } = require("../crypto");
const { SUPERADMIN_EMAIL } = require("../config");

const CLIENT_ID = "1234567890-abcdefgh.apps.googleusercontent.com";
const CLIENT_SECRET = "GOCSPX-super-secret-value";

/* A stand-in for Google: the "code" is just the email address to sign in as. */
function fakeGoogle(overrides = {}) {
  let lastNonce = "";
  return () => ({
    authUrl: ({ state, nonce }) => {
      lastNonce = nonce;
      return `https://accounts.google.com/fake?state=${state}`;
    },
    exchange: async (code) => ({
      email: code,
      emailVerified: true,
      name: "Test Person",
      picture: "https://lh3.googleusercontent.com/a/x",
      nonce: lastNonce,
      ...overrides,
    }),
  });
}

async function boot(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-"));
  const env = { SETUP_TOKEN: "setup-token-123", ...(opts.env || {}) };
  const made = createApp({ dataDir: dir, buildDir: opts.buildDir || path.join(dir, "no-build"), env, google: opts.google || fakeGoogle(), holidayFetch: opts.holidayFetch || (async () => { throw new Error("no network in tests"); }), ...(opts.app || {}) });
  const server = await new Promise((res) => {
    const s = made.app.listen(0, "127.0.0.1", () => res(s));
  });
  const port = server.address().port;

  const request = (method, url, { cookie, body, headers = {}, csrf = true } = {}) =>
    new Promise((resolve, reject) => {
      const h = { ...headers };
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
          const jar = (res.headers["set-cookie"] || [])
            .map((c) => c.split(";")[0])
            .filter((c) => !/=$/.test(c))
            .join("; ");
          resolve({ status: res.statusCode, headers: res.headers, json, text, jar });
        });
      });
      r.on("error", reject);
      if (payload) r.write(payload);
      r.end();
    });

  // run the whole Google round trip against the fake and return the session cookie
  async function login(email) {
    const start = await request("GET", "/api/auth/google/start");
    assert.equal(start.status, 302);
    const state = new URL(start.headers.location).searchParams.get("state");
    const cb = await request("GET", `/api/auth/google/callback?state=${state}&code=${encodeURIComponent(email)}`, {
      cookie: start.jar,
    });
    return { cb, session: cb.jar };
  }

  const configure = () =>
    request("POST", "/api/setup", {
      body: { token: "setup-token-123", googleClientId: CLIENT_ID, googleClientSecret: CLIENT_SECRET },
    });

  return {
    dir,
    made,
    request,
    login,
    configure,
    port,
    close: () => new Promise((r) => server.close(r)),
  };
}

/* ----------------------------------------------------------- unit tests */

test("isLocalHost recognises development machines and nothing else", () => {
  for (const h of ["localhost:3000", "127.0.0.1:5000", "[::1]:3000", "192.168.1.20:3000", "10.1.2.3", "172.20.0.5", "mypc.local", "app.localhost"]) {
    assert.equal(isLocalHost(h), true, h);
  }
  for (const h of ["vinaytiwari.org", "www.vinaytiwari.org", "172.32.0.1", "8.8.8.8", "localhost.evil.com"]) {
    assert.equal(isLocalHost(h), false, h);
  }
});

test("encryption round-trips and rejects tampering; tokens expire and reject forgery", () => {
  const key = Buffer.alloc(32, 7);
  const blob = encrypt("hunter2", key);
  assert.equal(decrypt(blob, key), "hunter2");
  assert.notEqual(blob, encrypt("hunter2", key), "fresh IV every time");
  assert.throws(() => decrypt(blob.slice(0, -2) + "xx", key));
  assert.throws(() => decrypt(blob, Buffer.alloc(32, 8)));

  const t = sign({ email: "a@b.co" }, key, 60);
  assert.equal(verify(t, key).email, "a@b.co");
  assert.equal(verify(t + "x", key), null);
  assert.equal(verify(sign({ email: "a@b.co" }, key, -5), key), null, "expired");
  assert.equal(verify(t, Buffer.alloc(32, 9)), null, "wrong key");
});

/* ---------------------------------------------------------- first run */

test("first run: setup needs the one-time token, works once, and the secret is stored encrypted", async (t) => {
  const s = await boot();
  t.after(s.close);

  let r = await s.request("GET", "/api/auth/status");
  assert.equal(r.json.needsSetup, true);
  assert.equal(r.json.user, null);

  r = await s.request("POST", "/api/setup", { body: { token: "wrong", googleClientId: CLIENT_ID, googleClientSecret: CLIENT_SECRET } });
  assert.equal(r.status, 403);

  r = await s.request("POST", "/api/setup", { body: { token: "setup-token-123", googleClientId: "nope", googleClientSecret: CLIENT_SECRET } });
  assert.equal(r.status, 400);

  r = await s.configure();
  assert.equal(r.status, 200);

  r = await s.configure();
  assert.equal(r.status, 409, "the token is single-use");

  r = await s.request("GET", "/api/auth/status");
  assert.equal(r.json.configured, true);

  const onDisk = fs.readFileSync(path.join(s.dir, "db.json"), "utf8");
  assert.ok(!onDisk.includes(CLIENT_SECRET), "secret must not be stored in plain text");
  assert.ok(onDisk.includes(CLIENT_ID));
});

test("state-changing requests without the CSRF header, or from another origin, are refused", async (t) => {
  const s = await boot();
  t.after(s.close);
  let r = await s.request("POST", "/api/setup", { csrf: false, body: { token: "setup-token-123" } });
  assert.equal(r.status, 403);
  r = await s.request("POST", "/api/setup", { headers: { origin: "https://evil.example" }, body: { token: "setup-token-123" } });
  assert.equal(r.status, 403);
});

/* ------------------------------------------------------------- sign-in */

test("only the superadmin and listed admins can sign in", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.configure();

  const stranger = await s.login("stranger@example.com");
  assert.match(stranger.cb.headers.location, /error=unauthorized/);
  assert.equal(stranger.session, "", "no session cookie for a stranger");

  const boss = await s.login(SUPERADMIN_EMAIL);
  assert.equal(boss.cb.headers.location, "/me");
  const me = await s.request("GET", "/api/auth/status", { cookie: boss.session });
  assert.equal(me.json.user.role, "superadmin");
  assert.equal(me.json.user.email, SUPERADMIN_EMAIL);
});

test("sign-in rejects a bad state, an unverified email, and a nonce mismatch", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.configure();

  const start = await s.request("GET", "/api/auth/google/start");
  let r = await s.request("GET", `/api/auth/google/callback?state=forged&code=${SUPERADMIN_EMAIL}`, { cookie: start.jar });
  assert.match(r.headers.location, /error=state/);

  r = await s.request("GET", `/api/auth/google/callback?state=x&code=${SUPERADMIN_EMAIL}`);
  assert.match(r.headers.location, /error=state/, "no oauth cookie at all");

  const s2 = await boot({ google: fakeGoogle({ emailVerified: false }) });
  t.after(s2.close);
  await s2.configure();
  const { cb } = await s2.login(SUPERADMIN_EMAIL);
  assert.match(cb.headers.location, /error=unverified/);

  const s3 = await boot({ google: fakeGoogle({ nonce: "not-the-nonce" }) });
  t.after(s3.close);
  await s3.configure();
  const r3 = await s3.login(SUPERADMIN_EMAIL);
  assert.match(r3.cb.headers.location, /error=state/);
});

/* --------------------------------------------------------------- roles */

test("admin vs superadmin: same access, except managing admin users", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.configure();
  const boss = (await s.login(SUPERADMIN_EMAIL)).session;

  // not signed in
  assert.equal((await s.request("GET", "/api/admin/settings")).status, 401);
  assert.equal((await s.request("GET", "/api/admin/admins")).status, 401);

  // superadmin adds an admin
  let r = await s.request("POST", "/api/admin/admins", { cookie: boss, body: { email: "  Helper@Example.com " } });
  assert.equal(r.status, 201);
  assert.ok(r.json.admins.some((a) => a.email === "helper@example.com" && a.role === "admin"));
  assert.equal(r.json.admins[0].locked, true, "superadmin row is listed first and locked");

  r = await s.request("POST", "/api/admin/admins", { cookie: boss, body: { email: "helper@example.com" } });
  assert.equal(r.status, 409);
  r = await s.request("POST", "/api/admin/admins", { cookie: boss, body: { email: SUPERADMIN_EMAIL } });
  assert.equal(r.status, 400);
  r = await s.request("POST", "/api/admin/admins", { cookie: boss, body: { email: "not-an-email" } });
  assert.equal(r.status, 400);

  // the admin can sign in and use the app …
  const helper = (await s.login("helper@example.com")).session;
  const status = await s.request("GET", "/api/auth/status", { cookie: helper });
  assert.equal(status.json.user.role, "admin");
  assert.equal((await s.request("GET", "/api/admin/settings", { cookie: helper })).status, 200);
  r = await s.request("PUT", "/api/admin/settings/analytics", { cookie: helper, body: { gaMeasurementId: "G-ABCD1234" } });
  assert.equal(r.status, 200);

  // … but cannot manage admins
  assert.equal((await s.request("GET", "/api/admin/admins", { cookie: helper })).status, 403);
  assert.equal((await s.request("POST", "/api/admin/admins", { cookie: helper, body: { email: "x@example.com" } })).status, 403);
  assert.equal((await s.request("DELETE", "/api/admin/admins/helper%40example.com", { cookie: helper })).status, 403);

  // the superadmin can never be removed
  r = await s.request("DELETE", `/api/admin/admins/${encodeURIComponent(SUPERADMIN_EMAIL)}`, { cookie: boss });
  assert.equal(r.status, 400);

  // removing an admin ends their access immediately, session cookie and all
  r = await s.request("DELETE", "/api/admin/admins/helper%40example.com", { cookie: boss });
  assert.equal(r.status, 200);
  assert.equal((await s.request("GET", "/api/admin/settings", { cookie: helper })).status, 401);
  assert.equal((await s.request("GET", "/api/auth/status", { cookie: helper })).json.user, null);
  assert.match((await s.login("helper@example.com")).cb.headers.location, /error=unauthorized/);
});

/* ------------------------------------------------------------ settings */

test("Google settings: validated, secret kept when left blank, never sent back", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.configure();
  const boss = (await s.login(SUPERADMIN_EMAIL)).session;

  let r = await s.request("GET", "/api/admin/settings", { cookie: boss });
  assert.equal(r.json.googleClientId, CLIENT_ID);
  assert.equal(r.json.googleSecretSet, true);
  assert.ok(!r.text.includes(CLIENT_SECRET), "secret must never be in a response");

  r = await s.request("PUT", "/api/admin/settings/google", { cookie: boss, body: { googleClientId: "bad" } });
  assert.equal(r.status, 400);

  const newId = "999-newone.apps.googleusercontent.com";
  r = await s.request("PUT", "/api/admin/settings/google", { cookie: boss, body: { googleClientId: newId, googleClientSecret: "" } });
  assert.equal(r.status, 200, "blank secret keeps the saved one");
  r = await s.request("GET", "/api/admin/settings", { cookie: boss });
  assert.equal(r.json.googleClientId, newId);
  assert.equal(r.json.googleSecretSet, true);

  r = await s.request("PUT", "/api/admin/settings/google", { cookie: boss, body: { googleClientId: newId, googleClientSecret: "rotated-secret-9999" } });
  assert.equal(r.status, 200);
  assert.ok(!fs.readFileSync(path.join(s.dir, "db.json"), "utf8").includes("rotated-secret-9999"));
});

test("Analytics ID: strict format; never served to a local machine or to a signed-in admin", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.configure();
  const boss = (await s.login(SUPERADMIN_EMAIL)).session;

  for (const bad of ["UA-12345-1", "G-", "G-abc<script>", "https://x", "G-ABCD 1234"]) {
    const r = await s.request("PUT", "/api/admin/settings/analytics", { cookie: boss, body: { gaMeasurementId: bad } });
    assert.equal(r.status, 400, bad);
  }
  let r = await s.request("PUT", "/api/admin/settings/analytics", { cookie: boss, body: { gaMeasurementId: "g-abcd1234" } });
  assert.equal(r.json.gaMeasurementId, "G-ABCD1234", "upper-cased");

  const live = { headers: { host: "www.vinaytiwari.org" } };
  assert.equal((await s.request("GET", "/api/public-config", live)).json.ga, "G-ABCD1234", "a real visitor on the live site");
  assert.equal((await s.request("GET", "/api/public-config")).json.ga, null, "local run (127.0.0.1)");
  assert.equal(
    (await s.request("GET", "/api/public-config", { headers: { host: "localhost:3000" } })).json.ga,
    null,
    "localhost"
  );
  assert.equal(
    (await s.request("GET", "/api/public-config", { cookie: boss, headers: { host: "www.vinaytiwari.org" } })).json.ga,
    null,
    "the admin browsing their own live site is not counted"
  );

  r = await s.request("PUT", "/api/admin/settings/analytics", { cookie: boss, body: { gaMeasurementId: "" } });
  assert.equal((await s.request("GET", "/api/public-config", live)).json.ga, null, "cleared");
});

test("API and admin pages are marked noindex and uncached", async (t) => {
  const s = await boot();
  t.after(s.close);
  const r = await s.request("GET", "/api/auth/status");
  assert.match(r.headers["x-robots-tag"], /noindex/);
  assert.equal(r.headers["cache-control"], "no-store");
  assert.equal(r.headers["x-frame-options"], "DENY");
  const miss = await s.request("GET", "/api/nope");
  assert.equal(miss.status, 404);
});

test("the admin path matches whole segments only: /me yes, /media and /menu no", async (t) => {
  const { isAdminPath } = require("../config");
  for (const p of ["/me", "/me/", "/me/google", "/me/admins"]) assert.equal(isAdminPath(p), true, p);
  for (const p of ["/", "/media", "/menu", "/me.png", "/meet", "/mee", "/api/me"]) assert.equal(isAdminPath(p), false, p);

  // and the server really serves the bare shell only to the private area
  const build = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-build-"));
  fs.writeFileSync(path.join(build, "index.html"), "<html>PUBLIC SITE</html>");
  fs.writeFileSync(path.join(build, "admin.html"), "<html>ADMIN SHELL</html>");
  fs.mkdirSync(path.join(build, "img"));
  fs.writeFileSync(path.join(build, "img", "picture.avif"), "not really an image");
  fs.writeFileSync(path.join(build, "img", "picture.jpg"), "not really an image");
  const s = await boot({ buildDir: build });
  t.after(s.close);

  // pictures are labelled as pictures — AVIF too, which the static-file library does not know
  assert.equal((await s.request("GET", "/img/picture.avif")).headers["content-type"], "image/avif");
  assert.equal((await s.request("GET", "/img/picture.jpg")).headers["content-type"], "image/jpeg");
  assert.equal((await s.request("GET", "/img/picture.avif")).headers["x-content-type-options"], "nosniff");

  for (const p of ["/me", "/me/google", "/me/personal-access"]) {
    const r = await s.request("GET", p);
    assert.match(r.text, /ADMIN SHELL/, p);
    assert.match(r.headers["x-robots-tag"], /noindex/, p);
    assert.equal(r.headers["cache-control"], "no-store", p);
  }
  for (const p of ["/", "/media", "/menu", "/something-else"]) {
    const r = await s.request("GET", p);
    assert.match(r.text, /PUBLIC SITE/, p);
    assert.equal(r.headers["x-robots-tag"], undefined, `${p} must stay indexable`);
  }
});

/* ------------------------------------------------------ stock report API */

const NASDAQ_PAGE = fs.readFileSync(path.join(__dirname, "fixtures", "nasdaqtrader-2026.html"), "utf8");

test("holiday endpoints need a signed-in admin, and 'check now' needs the CSRF header", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.configure();
  assert.equal((await s.request("GET", "/api/admin/stock/holidays")).status, 401);
  assert.equal((await s.request("POST", "/api/admin/stock/holidays/refresh")).status, 401);

  const boss = (await s.login(SUPERADMIN_EMAIL)).session;
  assert.equal((await s.request("POST", "/api/admin/stock/holidays/refresh", { cookie: boss, csrf: false })).status, 403);
});

test("'check now' fetches the official page once, stores it, and serves it to the page", async (t) => {
  let fetches = 0;
  const s = await boot({
    holidayFetch: async (url) => {
      fetches += 1;
      assert.equal(url, "https://www.nasdaqtrader.com/trader.aspx?id=Calendar");
      return { ok: true, status: 200, text: async () => NASDAQ_PAGE };
    },
  });
  t.after(s.close);
  await s.configure();
  const boss = (await s.login(SUPERADMIN_EMAIL)).session;

  let r = await s.request("GET", "/api/admin/stock/holidays", { cookie: boss });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.nasdaq.years, {}, "nothing fetched yet");
  assert.equal(fetches, 0, "reading never triggers a fetch");

  r = await s.request("POST", "/api/admin/stock/holidays/refresh", { cookie: boss });
  assert.equal(r.status, 200);
  assert.equal(r.json.nasdaq.years["2026"].entries.length, 12);
  assert.equal(r.json.nasdaq.sourceName, "Nasdaq Trader");
  assert.equal(r.json.nasdaq.lastError, "");

  // an admin who is not the superadmin may use it too
  await s.request("POST", "/api/admin/admins", { cookie: boss, body: { email: "helper@example.com" } });
  const helper = (await s.login("helper@example.com")).session;
  r = await s.request("POST", "/api/admin/stock/holidays/refresh", { cookie: helper });
  assert.equal(r.status, 200);
  assert.equal(r.json.throttled, true, "a second check within a minute is served from the stored copy");
  assert.equal(fetches, 1, "the exchange was asked exactly once");

  r = await s.request("GET", "/api/admin/stock/holidays", { cookie: helper });
  assert.equal(r.json.nasdaq.years["2026"].entries[0].date, "2026-01-01");
});

test("when the exchange is unreachable the endpoint still answers, with the reason", async (t) => {
  const s = await boot(); // default fake network always fails
  t.after(s.close);
  await s.configure();
  const boss = (await s.login(SUPERADMIN_EMAIL)).session;
  const r = await s.request("POST", "/api/admin/stock/holidays/refresh", { cookie: boss });
  assert.equal(r.status, 200);
  assert.match(r.json.nasdaq.lastError, /no network in tests/);
  assert.deepEqual(r.json.nasdaq.years, {});
});

test("TRUST_PROXY given as text (as pm2 and .env do) still trusts one proxy hop", async (t) => {
  // Express reads the text "1" as an address list; the app must turn it into a hop count, or
  // every visitor looks like nginx and HTTPS is never seen.
  for (const value of ["1", "true"]) {
    const s = await boot({ env: { TRUST_PROXY: value } });
    t.after(s.close);
    const r = await s.request("GET", "/api/auth/status", { headers: { "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.9" } });
    assert.equal(r.status, 200);
    assert.match(String(r.headers["strict-transport-security"] || ""), /max-age=31536000/, `HSTS is sent when TRUST_PROXY=${value}`);
  }
  const plain = await boot();
  t.after(plain.close);
  const r = await plain.request("GET", "/api/auth/status", { headers: { "x-forwarded-proto": "https" } });
  assert.equal(r.headers["strict-transport-security"], undefined, "without TRUST_PROXY the header is not believed");
});

test("site health: every part is checked, the page never breaks, and only signed-in people see it", async (t) => {
  const s = await boot();
  t.after(s.close);
  assert.equal((await s.request("GET", "/api/admin/health")).status, 401);
  await s.configure();
  const boss = (await s.login(SUPERADMIN_EMAIL)).session;
  const r = await s.request("GET", "/api/admin/health", { cookie: boss });
  assert.equal(r.status, 200, r.text);
  const ids = r.json.checks.map((c) => c.id);
  for (const id of ["server", "database", "https", "signin", "zerodha", "stream", "universe", "alerts", "ai", "chain", "brains", "research", "trading", "analysis", "paper", "telegram", "whatsapp", "mandir"]) assert.ok(ids.includes(id), `checks ${id}`);
  assert.ok(r.json.checks.every((c) => ["ok", "warn", "error", "off"].includes(c.status) && c.detail), JSON.stringify(r.json.checks.filter((c) => !c.detail)));
  assert.equal(r.json.checks.find((c) => c.id === "database").status, "ok");
  assert.equal(r.json.checks.find((c) => c.id === "signin").status, "ok");
  assert.equal(r.json.checks.find((c) => c.id === "zerodha").status, "off");
  const chain = r.json.checks.find((c) => c.id === "chain");
  assert.equal(chain.status, "off", "no AI key saved");
  assert.match(chain.detail, /Anthropic · Claude Sonnet 5\.5/, "the default model is named");
  assert.ok(!r.json.checks.some((c) => /NVIDIA/i.test(`${c.title || ""} ${c.detail}`)), "nothing about the removed free models");
  assert.equal(r.json.checks.find((c) => c.id === "mandir").status, "warn", "only a YouTube link: no background audio until a file is uploaded");
  assert.ok(["ok", "warn", "error"].includes(r.json.overall));
});

test("the WhatsApp webhook refuses an unsigned body and a wrong verify token", async (t) => {
  const s = await boot();
  t.after(s.close);
  const v = await s.request("GET", "/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1");
  assert.equal(v.status, 403);
  const p = await s.request("POST", "/api/whatsapp/webhook", { body: { entry: [] }, csrf: false });
  assert.equal(p.status, 401, "no signature: refused (and no CSRF header is needed for Meta)");
});

test("Social Media routes: admins read the feed; only the superadmin changes sources and the X token, which never comes back", async (t) => {
  const feed = `<?xml version="1.0"?><rss><channel><item><title>SBI Q2 net profit jumps 28%; shares rise</title><link>https://example.com/sbi</link><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;
  const socialFetch = async () => ({ ok: true, status: 200, text: async () => feed, json: async () => ({}) });
  const s = await boot({ app: { socialFetch, socialWatch: false } });
  t.after(s.close);
  await s.configure();
  const boss = (await s.login(SUPERADMIN_EMAIL)).session;
  let r = await s.request("POST", "/api/admin/admins", { cookie: boss, body: { email: "helper@example.com" } });
  assert.equal(r.status, 201, r.text);
  const helper = (await s.login("helper@example.com")).session;

  r = await s.request("GET", "/api/admin/social", { cookie: helper });
  assert.equal(r.status, 200);
  assert.ok(r.json.settings.sources.length > 0);
  assert.equal(r.json.status.aiReady, false, "no AI key in this test");
  r = await s.request("POST", "/api/admin/social/sources", { cookie: helper, body: { type: "x", value: "NSEIndia" } });
  assert.equal(r.status, 403, "an admin cannot change the sources");
  r = await s.request("PUT", "/api/admin/social/creds", { cookie: helper, body: { xToken: "TESTONLY-x-bearer-token-0123456789abcdef" } });
  assert.equal(r.status, 403);

  r = await s.request("POST", "/api/admin/social/sources", { cookie: boss, body: { type: "x", value: "@NSEIndia" } });
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.settings.sources.some((x) => x.type === "x" && x.value === "NSEIndia"));
  r = await s.request("PUT", "/api/admin/social/creds", { cookie: boss, body: { xToken: "TESTONLY-x-bearer-token-0123456789abcdef" } });
  assert.equal(r.status, 200);
  assert.equal(r.json.settings.creds.x, true);
  assert.ok(!r.text.includes("TESTONLY"), "the token is never sent back");
  r = await s.request("PUT", "/api/admin/social/sources/nope", { cookie: boss, body: { enabled: false } });
  assert.equal(r.status, 404);

  r = await s.request("POST", "/api/admin/social/refresh", { cookie: helper });
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.polled.read > 0);
  r = await s.request("GET", "/api/admin/social/feed?relevant=1", { cookie: helper });
  assert.ok(r.json.items.some((x) => /SBI Q2/.test(x.title) && x.reading.symbols.includes("SBIN")));
  r = await s.request("GET", "/api/admin/social/digest", { cookie: helper });
  assert.ok(r.json.items >= 1);
  r = await s.request("POST", "/api/admin/social/brief", { cookie: helper });
  assert.equal(r.status, 409, "the brief needs the AI model");
  assert.match(r.json.message, /Anthropic key/);
});

test("Social Media live: the stream says hello to a signed-in admin, and high-impact news on a tracked stock is sent as an alert once", async (t) => {
  const at = new Date().toUTCString();
  const feed = `<?xml version="1.0"?><rss><channel><item><title>SBI Q2 net profit jumps 28%, beats estimates; shares rise 4%</title><link>https://example.com/sbi</link><guid>g1</guid><pubDate>${at}</pubDate></item><item><title>SBI shares rally 5% to a record high on strong results</title><link>https://example.com/sbi2</link><guid>g2</guid><pubDate>${at}</pubDate></item></channel></rss>`;
  const socialFetch = async () => ({ ok: true, status: 200, headers: new Map(), text: async () => feed, json: async () => ({}) });
  const sent = [];
  const notifier = { send: async (text, kind) => sent.push({ text, kind }) };
  const s = await boot({ app: { socialFetch, socialWatch: false, notifier } });
  t.after(s.close);
  await s.configure();
  const boss = (await s.login(SUPERADMIN_EMAIL)).session;
  // the stream: read the first event, then hang up
  const first = await new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: s.port, method: "GET", path: "/api/admin/social/stream", headers: { cookie: boss } }, (res) => {
      res.once("data", (chunk) => {
        resolve({ type: res.headers["content-type"], buffering: res.headers["x-accel-buffering"], text: String(chunk) });
        req.destroy();
      });
    });
    req.on("error", reject);
    req.end();
  });
  assert.match(first.type, /text\/event-stream/);
  assert.equal(first.buffering, "no", "nginx is told not to hold the stream back");
  assert.match(first.text, /event: hello/);
  const shut = await s.request("GET", "/api/admin/social/stream");
  assert.ok(shut.status === 401 || shut.status === 403, "signed out: no stream");
  let r = await s.request("PUT", "/api/admin/social/settings", { cookie: boss, body: { watch: "SBIN" } });
  assert.equal(r.status, 200, r.text);
  r = await s.request("POST", "/api/admin/social/refresh", { cookie: boss });
  assert.equal(r.status, 200, r.text);
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(sent.length, 1, "one alert for the stock, however many items");
  assert.equal(sent[0].kind, "alerts");
  assert.match(sent[0].text, /📰 .*SBIN — high-impact news/);
  assert.match(sent[0].text, /nothing was traded/);
});
