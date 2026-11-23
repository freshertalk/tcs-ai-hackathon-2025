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
  // a character in the middle always changes the decoded bytes (the last ones may only be padding bits,
  // which made "replace the last two with xx" pass now and then without tampering at all)
  const mid = Math.floor(blob.length / 2);
  assert.throws(() => decrypt(blob.slice(0, mid) + (blob[mid] === "A" ? "B" : "A") + blob.slice(mid + 1), key));
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
  // site-wide settings (sign-in, analytics, the AI key) are a superadmin's since the security review of 23 Nov 2026
  r = await s.request("PUT", "/api/admin/settings/analytics", { cookie: helper, body: { gaMeasurementId: "G-ABCD1234" } });
  assert.equal(r.status, 403);
  assert.equal((await s.request("PUT", "/api/admin/settings/google", { cookie: helper, body: { googleClientId: "999-x.apps.googleusercontent.com", googleClientSecret: "" } })).status, 403);
  assert.equal((await s.request("PUT", "/api/admin/ai/settings", { cookie: helper, body: { provider: "anthropic" } })).status, 403);
  r = await s.request("PUT", "/api/admin/settings/analytics", { cookie: boss, body: { gaMeasurementId: "G-ABCD1234" } });
  assert.equal(r.status, 200);

  // … and cannot manage admins
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

test("the owner can make superadmins: they manage admins and see what the owner sees, but only the owner decides who is one", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.configure();
  const boss = (await s.login(SUPERADMIN_EMAIL)).session;
  const row = (r, email) => r.json.admins.find((a) => a.email === email);

  // the owner is told they are the owner, and that the superadmin choices are theirs
  assert.equal((await s.request("GET", "/api/auth/status", { cookie: boss })).json.user.owner, true);
  assert.equal((await s.request("GET", "/api/admin/admins", { cookie: boss })).json.canManageSupers, true);

  // added as a superadmin in one step …
  let r = await s.request("POST", "/api/admin/admins", { cookie: boss, body: { email: "Partner@Example.com", role: "superadmin", invite: false } });
  assert.equal(r.status, 201);
  assert.deepEqual([row(r, "partner@example.com").role, row(r, "partner@example.com").owner, row(r, "partner@example.com").locked], ["superadmin", false, false]);
  assert.deepEqual([r.json.admins[0].email, r.json.admins[0].owner, r.json.admins[0].locked], [SUPERADMIN_EMAIL, true, true]);
  assert.equal(row(r, "partner@example.com").madeSuperBy, SUPERADMIN_EMAIL);
  // … or an admin made one afterwards
  await s.request("POST", "/api/admin/admins", { cookie: boss, body: { email: "helper@example.com", invite: false } });
  await s.request("POST", "/api/admin/admins", { cookie: boss, body: { email: "third@example.com", invite: false } });
  r = await s.request("PUT", "/api/admin/admins/helper%40example.com", { cookie: boss, body: { role: "superadmin" } });
  assert.equal(r.status, 200);
  assert.equal(row(r, "helper@example.com").role, "superadmin");
  // the superadmins are listed before the admins
  assert.deepEqual(r.json.admins.map((a) => a.email), [SUPERADMIN_EMAIL, "partner@example.com", "helper@example.com", "third@example.com"]);
  assert.equal((await s.request("PUT", "/api/admin/admins/helper%40example.com", { cookie: boss, body: { role: "boss" } })).status, 400);
  assert.equal((await s.request("POST", "/api/admin/admins", { cookie: boss, body: { email: "x@example.com", role: "owner" } })).status, 400);
  assert.equal((await s.request("PUT", "/api/admin/admins/nobody%40example.com", { cookie: boss, body: { role: "superadmin" } })).status, 404);
  r = await s.request("POST", "/api/admin/admins", { cookie: boss, body: { email: "partner@example.com" } });
  assert.equal(r.status, 409);
  assert.match(r.json.message, /already a superadmin/);

  // a superadmin is a superadmin everywhere: the role, the people page, the superadmin-only settings
  const partner = (await s.login("partner@example.com")).session;
  const me = (await s.request("GET", "/api/auth/status", { cookie: partner })).json.user;
  assert.deepEqual([me.role, me.owner], ["superadmin", false]);
  r = await s.request("GET", "/api/admin/admins", { cookie: partner });
  assert.equal(r.status, 200);
  assert.equal(r.json.canManageSupers, false);
  assert.equal((await s.request("GET", "/api/admin/auth/audit", { cookie: partner })).status, 200);
  // … and manages the admins, as the owner does
  r = await s.request("POST", "/api/admin/admins", { cookie: partner, body: { email: "fourth@example.com", invite: false } });
  assert.equal(r.status, 201);
  assert.equal((await s.request("DELETE", "/api/admin/admins/fourth%40example.com", { cookie: partner })).status, 200);

  // but who is a superadmin is the owner's decision alone
  r = await s.request("POST", "/api/admin/admins", { cookie: partner, body: { email: "friend@example.com", role: "superadmin" } });
  assert.equal(r.status, 403);
  assert.match(r.json.message, /Only the owner can add a superadmin/);
  assert.equal((await s.request("PUT", "/api/admin/admins/third%40example.com", { cookie: partner, body: { role: "superadmin" } })).status, 403);
  assert.equal((await s.request("PUT", "/api/admin/admins/helper%40example.com", { cookie: partner, body: { role: "admin" } })).status, 403);
  r = await s.request("DELETE", "/api/admin/admins/helper%40example.com", { cookie: partner });
  assert.equal(r.status, 403);
  assert.match(r.json.message, /Only the owner can remove a superadmin/);
  // nor can one superadmin sign another (or the owner) out, though they can do it for an admin and for themselves
  assert.equal((await s.request("POST", "/api/admin/admins/helper%40example.com/signout", { cookie: partner })).status, 403);
  assert.equal((await s.request("POST", `/api/admin/admins/${encodeURIComponent(SUPERADMIN_EMAIL)}/signout`, { cookie: partner })).status, 403);
  assert.equal((await s.request("POST", "/api/admin/admins/third%40example.com/signout", { cookie: partner })).status, 200);
  // the owner is never changed or removed, by anyone
  assert.equal((await s.request("PUT", `/api/admin/admins/${encodeURIComponent(SUPERADMIN_EMAIL)}`, { cookie: boss, body: { role: "admin" } })).status, 400);
  assert.equal((await s.request("DELETE", `/api/admin/admins/${encodeURIComponent(SUPERADMIN_EMAIL)}`, { cookie: partner })).status, 400);

  // made an admin again: the superadmin pages close at once, on the very next request, with the same cookie
  r = await s.request("PUT", "/api/admin/admins/partner%40example.com", { cookie: boss, body: { role: "admin" } });
  assert.equal(row(r, "partner@example.com").role, "admin");
  assert.equal(row(r, "partner@example.com").madeSuperBy, undefined);
  assert.equal((await s.request("GET", "/api/admin/admins", { cookie: partner })).status, 403);
  assert.equal((await s.request("GET", "/api/auth/status", { cookie: partner })).json.user.role, "admin");
  // and the owner removes a superadmin like anyone else
  r = await s.request("DELETE", "/api/admin/admins/helper%40example.com", { cookie: boss });
  assert.equal(r.status, 200);
  assert.equal(row(r, "helper@example.com"), undefined);
  // every step is in the trail
  const types = (await s.request("GET", "/api/admin/auth/audit?limit=300", { cookie: boss })).json.entries.map((e) => e.type);
  for (const k of ["superadmin_added", "superadmin_made", "superadmin_unmade", "superadmin_removed"]) assert.ok(types.includes(k), k);
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

test("liveness: /api/live answers without sign-in, with nothing private — the watchdog's question", async (t) => {
  const s = await boot();
  t.after(s.close);
  const r = await s.request("GET", "/api/live");
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json).sort(), ["at", "ok", "up"]);
  assert.equal(r.json.ok, true);
  assert.ok(Number.isInteger(r.json.up) && r.json.up >= 0);
  assert.match(r.headers["cache-control"] || "", /no-store/);
});

test("site health, Server: uptime and memory, whether pm2 runs it, and a crash written down by the last process", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.configure();
  const boss = (await s.login(SUPERADMIN_EMAIL)).session;
  let r = await s.request("GET", "/api/admin/health", { cookie: boss });
  let srv = r.json.checks.find((c) => c.id === "server");
  assert.match(srv.detail, /Up .* min · memory \d+ MB/);
  assert.match(srv.detail, /not run by pm2/);
  // the process before this one crashed an hour ago (server/lifecycle.js wrote it down)
  fs.writeFileSync(path.join(s.dir, "last-crash.json"), JSON.stringify({ at: new Date(Date.now() - 3600000).toISOString(), kind: "uncaughtException", message: "Cannot read properties of undefined", stack: "TypeError: …" }));
  r = await s.request("GET", "/api/admin/health", { cookie: boss });
  srv = r.json.checks.find((c) => c.id === "server");
  assert.equal(srv.status, "warn");
  assert.match(srv.detail, /last crash (60 min|1 h) ago: Cannot read properties of undefined \(restarted automatically\)/);
  assert.match(srv.hint, /pm2 logs/);
});

test("a tradebook import fills the Journal's Day book at once — no button, no waiting for the hourly sweep", async (t) => {
  const s = await boot({ app: { socialWatch: false } });
  t.after(s.close);
  await s.configure();
  const boss = (await s.login(SUPERADMIN_EMAIL)).session;
  const csv = ["trade_id,order_id,symbol,exchange,segment,trade_type,quantity,price,product,order_execution_time", "1,O1,SBIN,NSE,EQ,buy,10,800,MIS,2026-10-20T09:40:00", "2,O2,SBIN,NSE,EQ,sell,10,806,MIS,2026-10-20T10:10:00", "3,O3,INFY,NSE,EQ,sell,5,1500,MIS,2026-10-21T11:00:00", "4,O4,INFY,NSE,EQ,buy,5,1490,MIS,2026-10-21T11:30:00"].join("\n");
  const bytes = Buffer.from(csv);
  let r = await s.request("POST", "/api/admin/trading/journal/upload", { cookie: boss, body: { name: "tradebook.csv", size: bytes.length } });
  assert.equal(r.status, 200, r.text);
  const id = r.json.id;
  const put = await new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: s.port, method: "PUT", path: `/api/admin/trading/journal/upload/${id}/0`, headers: { cookie: boss, "x-requested-with": "vpt", "content-type": "application/octet-stream", "content-length": bytes.length } }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end(bytes);
  });
  assert.equal(put, 200);
  r = await s.request("POST", `/api/admin/trading/journal/upload/${id}/finish`, { cookie: boss, body: {} });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.added, 4);
  let days = [];
  for (let i = 0; i < 40 && days.length < 2; i += 1) {
    await new Promise((res) => setTimeout(res, 50));
    days = (await s.request("GET", "/api/admin/analysis/days", { cookie: boss })).json.days;
  }
  assert.deepEqual(days.map((d) => d.date), ["2026-10-21", "2026-10-20"]);
  assert.ok(days.every((d) => d.source === "auto"));
  r = await s.request("POST", "/api/admin/analysis/day/2026-10-20", { cookie: boss, body: {} });
  assert.equal(r.status, 404, "there is no route to save a day by hand");
});

test("Trade Analysis's memory over HTTP: snapshots, outcomes and the register of learnings — superadmin only, and a lesson of your own can be added, marked and removed", async (t) => {
  const s = await boot({ app: { socialWatch: false } });
  t.after(s.close);
  await s.configure();
  const boss = (await s.login(SUPERADMIN_EMAIL)).session;
  for (const url of ["/api/admin/analysis/learnings", "/api/admin/analysis/outcomes", "/api/admin/analysis/snapshots", "/api/admin/analysis/snapshot/2026-10-20"]) {
    const r = await s.request("GET", url, {});
    assert.ok(r.status === 401 || r.status === 403, `${url} needs the superadmin (got ${r.status})`);
  }
  let r = await s.request("GET", "/api/admin/analysis/learnings", { cookie: boss });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.learnings, [], "nothing recorded yet");
  r = await s.request("POST", "/api/admin/analysis/learnings", { cookie: boss, body: { text: "No new trade for 15 minutes after a loss", rule: "Wait." } });
  assert.equal(r.status, 200, r.text);
  const own = r.json.learnings.find((x) => x.source === "own");
  assert.equal(own.rule, "Wait.");
  r = await s.request("PUT", `/api/admin/analysis/learnings/${encodeURIComponent(own.id)}`, { cookie: boss, body: { status: "working", note: "day 1" } });
  assert.equal(r.json.learnings.find((x) => x.id === own.id).status, "working");
  r = await s.request("POST", "/api/admin/analysis/learnings", { cookie: boss, body: { text: "x" } });
  assert.equal(r.status, 400);
  r = await s.request("DELETE", "/api/admin/analysis/learnings/o%3Agave-back", { cookie: boss });
  assert.equal(r.status, 400, "a measured learning cannot be deleted");
  r = await s.request("DELETE", `/api/admin/analysis/learnings/${encodeURIComponent(own.id)}`, { cookie: boss });
  assert.deepEqual(r.json.learnings, []);
  r = await s.request("GET", "/api/admin/analysis/outcomes?outcome=gave-back", { cookie: boss });
  assert.equal(r.status, 200);
  assert.equal(r.json.total, 0);
  assert.equal((await s.request("GET", "/api/admin/analysis/snapshot/2026-10-20", { cookie: boss })).json.available, false, "a day without trades says so");
});

test("the capital ledger over HTTP: the superadmin records the money put in, the journal returns percentages on that principal, a withdrawal that overdraws is refused", async (t) => {
  const s = await boot({ app: { socialWatch: false } });
  t.after(s.close);
  await s.configure();
  const boss = (await s.login(SUPERADMIN_EMAIL)).session;
  assert.ok([401, 403].includes((await s.request("GET", "/api/admin/trading/journal/capital", {})).status), "needs the superadmin");
  let r = await s.request("GET", "/api/admin/trading/journal?period=all", { cookie: boss });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.returns.needsCapital, true);
  assert.deepEqual(r.json.capital, []);
  r = await s.request("POST", "/api/admin/trading/journal/capital", { cookie: boss, body: { date: "2026-10-01", amount: 100000, note: "first" } });
  assert.equal(r.status, 200, r.text);
  const id = r.json.entry.id;
  r = await s.request("POST", "/api/admin/trading/journal/capital", { cookie: boss, body: { date: "2026-10-05", amount: -500000 } });
  assert.equal(r.status, 400);
  assert.match(r.json.message, /below zero/);
  r = await s.request("GET", "/api/admin/trading/journal?period=all", { cookie: boss });
  assert.equal(r.json.returns.hasCapital, true);
  assert.equal(r.json.capital.length, 1);
  r = await s.request("DELETE", `/api/admin/trading/journal/capital/${id}`, { cookie: boss });
  assert.deepEqual(r.json.capital, []);
});

test("the login icon on the public site: the owner's switch, in the public config; superadmins only; /me opens either way", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.configure();
  const boss = (await s.login(SUPERADMIN_EMAIL)).session;
  const live = { headers: { host: "www.vinaytiwari.org" } };

  // on by default, for everyone who asks (the public site does, signed in or not)
  assert.equal((await s.request("GET", "/api/public-config", live)).json.loginIcon, true);
  assert.deepEqual((await s.request("GET", "/api/admin/settings/login-icon", { cookie: boss })).json, { on: true });

  // nobody who is not signed in can change it, and it must be a yes or a no
  assert.equal((await s.request("PUT", "/api/admin/settings/login-icon", { body: { on: false } })).status, 401);
  assert.equal((await s.request("GET", "/api/admin/settings/login-icon")).status, 401);
  assert.equal((await s.request("PUT", "/api/admin/settings/login-icon", { cookie: boss, body: { on: "no" } })).status, 400);
  assert.equal((await s.request("PUT", "/api/admin/settings/login-icon", { cookie: boss, body: {} })).status, 400);

  // a plain admin is not a superadmin: refused
  await s.request("POST", "/api/admin/admins", { cookie: boss, body: { email: "plain@example.com", invite: false } });
  const plain = (await s.login("plain@example.com")).session;
  assert.equal((await s.request("PUT", "/api/admin/settings/login-icon", { cookie: plain, body: { on: false } })).status, 403);
  assert.equal((await s.request("GET", "/api/public-config", live)).json.loginIcon, true, "unchanged");

  // off: the public config says so — and the door itself is untouched
  assert.deepEqual((await s.request("PUT", "/api/admin/settings/login-icon", { cookie: boss, body: { on: false } })).json, { on: false });
  assert.equal((await s.request("GET", "/api/public-config", live)).json.loginIcon, false);
  assert.equal((await s.request("GET", "/api/auth/status")).status, 200, "sign-in keeps working with the icon hidden");
  assert.equal((await s.request("GET", "/api/auth/google/start")).status, 302, "Google sign-in keeps working too");
  assert.deepEqual((await s.request("GET", "/api/admin/settings/login-icon", { cookie: boss })).json, { on: false });

  // on again
  await s.request("PUT", "/api/admin/settings/login-icon", { cookie: boss, body: { on: true } });
  assert.equal((await s.request("GET", "/api/public-config", live)).json.loginIcon, true);
  // the change is on the audit trail
  const trail = (await s.request("GET", "/api/admin/auth/audit", { cookie: boss })).json.entries.filter((e) => e.type === "login_icon");
  assert.deepEqual(trail.map((e) => e.on).reverse(), [false, true]);
});

test("the public site hears the icon switch at once over its own small stream: told the state on connecting, then every change; capped per visitor; nothing else travels on it", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.configure();
  const boss = (await s.login(SUPERADMIN_EMAIL)).session;
  const events = [];
  const open = () =>
    new Promise((resolve) => {
      const req = http.request({ host: "127.0.0.1", port: s.port, method: "GET", path: "/api/public-stream" }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve({ status: res.statusCode, req });
        }
        res.setEncoding("utf8");
        res.on("data", (c) => events.push(c));
        resolve({ status: 200, res, req });
      });
      req.on("error", () => {});
      req.end();
    });
  const wait = async (ms = 150) => new Promise((r) => setTimeout(r, ms));

  const a = await open(); // no sign-in: it is the PUBLIC site's stream
  assert.equal(a.status, 200);
  assert.match(a.res.headers["content-type"], /text\/event-stream/);
  await wait();
  const text = () => events.join("");
  assert.match(text(), /event: icon\ndata: {"loginIcon":true}\n\n/, "told the state on connecting");

  await s.request("PUT", "/api/admin/settings/login-icon", { cookie: boss, body: { on: false } });
  await wait();
  assert.match(text(), /event: icon\ndata: {"loginIcon":false}\n\n/, "pushed the moment it was switched off");
  await s.request("PUT", "/api/admin/settings/login-icon", { cookie: boss, body: { on: true } });
  await wait();
  assert.ok(text().lastIndexOf('{"loginIcon":true}') > text().lastIndexOf('{"loginIcon":false}'), "and on again");
  assert.doesNotMatch(text(), /email|admin|token/i, "nothing private travels on it");

  // a page that connects later is told the current state, not the past
  await s.request("PUT", "/api/admin/settings/login-icon", { cookie: boss, body: { on: false } });
  events.length = 0;
  const b = await open();
  await wait();
  assert.match(text(), /{"loginIcon":false}/);

  // three streams per visitor; the fourth is turned away
  const c = await open();
  const d = await open();
  assert.equal(c.status, 200);
  assert.equal(d.status, 429);
  for (const x of [a, b, c]) x.req.destroy();
});

test("the trade setup and the AI asks over HTTP: the setup for admins; the asks, Allow once (as the owner's click) and Not now for the superadmin", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.configure();
  const boss = (await s.login(SUPERADMIN_EMAIL)).session;
  let r = await s.request("GET", "/api/admin/market/setup", { cookie: boss });
  assert.equal(r.status, 200);
  assert.ok("lean" in r.json && "record" in r.json && "options" in r.json, Object.keys(r.json).join(","));
  assert.equal((await s.request("GET", "/api/admin/market/setup")).status, 401);
  assert.equal((await s.request("GET", "/api/admin/market/setup/stock/SBIN", { cookie: boss })).json.symbol, "SBIN");

  // an automatic feature wishes for the AI (no click): it becomes an ask
  const g = s.made.ai.guard;
  g.enforce = true;
  let ran = null;
  await g.wants({ key: "picks-review", feature: "Research Top 10 — the AI's review", why: "the Top 10 changed", page: "research" }, async () => {
    ran = g.clicked() ? "click" : "no click";
  });
  assert.equal(ran, null);
  r = await s.request("GET", "/api/admin/ai/asks", { cookie: boss });
  assert.deepEqual(r.json.asks.map((a) => [a.key, a.feature, a.why]), [["picks-review", "Research Top 10 — the AI's review", "the Top 10 changed"]]);
  r = await s.request("POST", "/api/admin/ai/asks/picks-review/allow", { cookie: boss });
  assert.equal(r.json.started, true);
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(ran, "click", "it ran inside the owner's press");
  assert.equal((await s.request("POST", "/api/admin/ai/asks/picks-review/allow", { cookie: boss })).status, 404, "answered already");
  await g.wants({ key: "scanner-review", feature: "Live scanner — the AI's review" }, async () => {});
  r = await s.request("POST", "/api/admin/ai/asks/scanner-review/dismiss", { cookie: boss });
  assert.deepEqual(r.json.asks, []);
  // a plain admin does not see or answer them
  await s.request("POST", "/api/admin/admins", { cookie: boss, body: { email: "plain2@example.com", invite: false } });
  const plain = (await s.login("plain2@example.com")).session;
  assert.equal((await s.request("GET", "/api/admin/ai/asks", { cookie: plain })).status, 403);
});

test("security review (23 Nov 2026): only the owner changes mail and sign-in; only a superadmin logs the site's Zerodha in; plain admins never see the owner's account", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.configure();
  const boss = (await s.login(SUPERADMIN_EMAIL)).session;
  await s.request("POST", "/api/admin/admins", { cookie: boss, body: { email: "partner@example.com", role: "superadmin", invite: false } });
  await s.request("POST", "/api/admin/admins", { cookie: boss, body: { email: "plain@example.com", invite: false } });
  const partner = (await s.login("partner@example.com")).session;
  const plain = (await s.login("plain@example.com")).session;
  // a superadmin who is not the owner cannot point the mail server or the site address elsewhere (that would receive the owner's codes)
  let r = await s.request("PUT", "/api/admin/settings/email", { cookie: partner, body: { smtp: { host: "smtp.evil.example", port: 587, security: "starttls", fromEmail: "x@evil.example", user: "", pass: "" } } });
  assert.equal(r.status, 403);
  assert.equal(r.json.error, "owner_only");
  assert.equal((await s.request("PUT", "/api/admin/settings/email", { cookie: partner, body: { publicUrl: "https://evil.example" } })).status, 403);
  assert.equal((await s.request("GET", "/api/admin/settings/email", { cookie: partner })).status, 200, "they may still read it");
  // a plain admin cannot start the site's Zerodha login
  r = await s.request("GET", "/api/admin/market/kite/login", { cookie: plain });
  assert.equal(r.status, 302);
  assert.match(decodeURIComponent(r.headers.location || ""), /Only a superadmin can log the site's Zerodha account in/);
  // the AI pulse never carries the owner's account for a plain admin
  let asked = 0;
  s.made.ai.ensemble.account = async () => {
    asked += 1;
    return { available: 123456, position: null };
  };
  await s.request("GET", "/api/admin/ai/pulse/INFY", { cookie: plain });
  assert.equal(asked, 0, "the account is not even read for a plain admin");
});

test("days entered by hand over HTTP: added and corrected on an empty day; refused with its reason on a bad one", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.configure();
  const boss = (await s.login(SUPERADMIN_EMAIL)).session;
  let r = await s.request("PUT", "/api/admin/trading/journal/manual/2026-11-10", { cookie: boss, body: { gross: 1500, brokerage: 40, stt: 12.5, trades: 2, note: "another broker" } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.day.net, 1447.5);
  r = await s.request("PUT", "/api/admin/trading/journal/manual/2026-11-10", { cookie: boss, body: { brokerage: -1 } });
  assert.equal(r.status, 400);
  assert.match(r.json.message, /0 or more/, "the real reason, not 'could not reach Zerodha'");
  r = await s.request("PUT", "/api/admin/trading/journal/manual/not-a-day", { cookie: boss, body: {} });
  assert.equal(r.status, 400);
  r = await s.request("DELETE", "/api/admin/trading/journal/manual/2026-11-10", { cookie: boss });
  assert.deepEqual(r.json, { removed: true });
  assert.equal((await s.request("PUT", "/api/admin/trading/journal/manual/2026-11-10", { body: { gross: 1 } })).status, 401);
});

test("the P&L grid's days over HTTP: the last 12 months by default, a chosen range, refusals said plainly, superadmins only", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.configure();
  const boss = (await s.login(SUPERADMIN_EMAIL)).session;
  await s.request("PUT", "/api/admin/trading/journal/manual/2026-11-10", { cookie: boss, body: { gross: 1500, brokerage: 40, trades: 2 } });
  let r = await s.request("GET", "/api/admin/trading/journal/days", { cookie: boss });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.fromDay, /^\d{4}-\d{2}-01$/, "from the 1st of a month");
  assert.equal(r.json.toDay, r.json.today);
  const months = (Number(r.json.toDay.slice(0, 4)) - Number(r.json.fromDay.slice(0, 4))) * 12 + Number(r.json.toDay.slice(5, 7)) - Number(r.json.fromDay.slice(5, 7));
  assert.equal(months, 11, "twelve months shown, this one included");
  assert.ok(Array.isArray(r.json.days) && r.json.totals);
  r = await s.request("GET", "/api/admin/trading/journal/days?from=2026-11-01&to=2026-11-30", { cookie: boss });
  assert.equal(r.json.fromDay, "2026-11-01");
  assert.ok(r.json.toDay <= r.json.today, "never past today");
  assert.deepEqual(r.json.manual.map((m) => [m.date, m.gross]), [["2026-11-10", 1500]]);
  r = await s.request("GET", "/api/admin/trading/journal/days?from=2026-11-20&to=2026-11-01", { cookie: boss });
  assert.equal(r.status, 400);
  assert.match(r.json.message, /valid date range/);
  r = await s.request("GET", "/api/admin/trading/journal/days?from=2020-01-01&to=2026-11-01", { cookie: boss });
  assert.equal(r.status, 400);
  assert.match(r.json.message, /three years/);
  assert.equal((await s.request("GET", "/api/admin/trading/journal/days")).status, 401);
});
