"use strict";
// Sign in with an email address: passwords, emailed links and codes, one person per mailbox, locks, audit,
// and the admin panel's mail settings. No network: Google and the mail server are stand-ins.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createApp } = require("../app");
const { SUPERADMIN_EMAIL, canonicalEmail } = require("../config");
const pw = require("../passwords");
const { Mailer, MailError } = require("../mailer");

const CLIENT_ID = "1234567890-abcdefgh.apps.googleusercontent.com";
const STRONG = "Correct-Horse-9-Battery";

function fakeGoogle() {
  let lastNonce = "";
  return () => ({
    authUrl: ({ state, nonce }) => {
      lastNonce = nonce;
      return `https://accounts.google.com/fake?state=${state}`;
    },
    exchange: async (code) => ({ email: code, emailVerified: true, name: "Test Person", picture: "https://lh3.googleusercontent.com/a/x", nonce: lastNonce }),
  });
}

/** A mail server that writes nothing anywhere: every message is kept in `outbox`. */
function fakeMailer({ on = true } = {}) {
  const m = {
    outbox: [],
    on,
    failNext: false,
    configured: () => m.on,
    config: () => ({ host: "smtp.test", port: 587, security: "starttls", user: "u", pass: "p", fromEmail: "noreply@test.org", fromName: "Test", source: "database" }),
    send: async (msg) => {
      if (m.failNext) {
        m.failNext = false;
        throw new MailError("The mail server did not accept the user name or password.", "send_failed");
      }
      m.outbox.push(msg);
      return { messageId: "x" };
    },
    verify: async () => true,
  };
  return m;
}

async function boot(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-ea-"));
  const clock = { t: Date.parse("2026-11-17T10:00:00Z") };
  const mailer = opts.realMailer ? null : opts.mailer || fakeMailer();
  const made = createApp({
    dataDir: dir,
    buildDir: path.join(dir, "no-build"),
    env: { SETUP_TOKEN: "setup-token-123", PUBLIC_ORIGIN: opts.origin === undefined ? "https://site.test" : opts.origin, ...(opts.env || {}) },
    google: fakeGoogle(),
    holidayFetch: async () => {
      throw new Error("no network in tests");
    },
    ...(mailer ? { mailer } : {}),
    authNow: () => clock.t,
    ...(opts.app || {}),
  });
  const server = await new Promise((res) => {
    const s = made.app.listen(0, "127.0.0.1", () => res(s));
  });
  const port = server.address().port;

  const request = (method, url, { cookie, body, headers = {} } = {}) =>
    new Promise((resolve, reject) => {
      const h = { ...headers };
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

  async function google(email) {
    const start = await request("GET", "/api/auth/google/start");
    const state = new URL(start.headers.location).searchParams.get("state");
    const cb = await request("GET", `/api/auth/google/callback?state=${state}&code=${encodeURIComponent(email)}`, { cookie: start.jar });
    return { cb, session: cb.jar };
  }
  await request("POST", "/api/setup", { body: { token: "setup-token-123", googleClientId: CLIENT_ID, googleClientSecret: "GOCSPX-super-secret-value" } });
  const boss = (await google(SUPERADMIN_EMAIL)).session;

  const tick = () => new Promise((r) => setImmediate(r));
  // the mail goes out without the page waiting for it, so let it finish
  const flush = async () => {
    for (let i = 0; i < 5; i += 1) await tick();
  };
  const tokenIn = (msg) => decodeURIComponent((/token=([^\s&"]+)/.exec(msg.text) || [])[1] || "");
  const codeIn = (msg) => (/\b(\d{6})\b/.exec(msg.subject) || [])[1];

  /** Add an admin (no invitation mail unless asked) and give them a password through the emailed link. */
  async function person(email, password = STRONG) {
    const add = await request("POST", "/api/admin/admins", { cookie: boss, body: { email, invite: true } });
    assert.equal(add.status, 201, JSON.stringify(add.json));
    const msg = mailer.outbox.at(-1);
    const set = await request("POST", "/api/auth/email/password", { body: { token: tokenIn(msg), password } });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    mailer.outbox.length = 0;
  }
  const login = (email, password, extra = {}) => request("POST", "/api/auth/email/login", { body: { email, password, ...extra } });

  return { dir, made, port, mailer, clock, boss, request, google, flush, tokenIn, codeIn, person, login, close: () => new Promise((r) => server.close(r)) };
}

/* ------------------------------------------------------------- units */

test("one mailbox, one person: capitals, and for Gmail dots, +tags and googlemail.com, are folded", () => {
  assert.equal(canonicalEmail("  Vinay.Tiwari+news@GoogleMail.com "), "vinaytiwari@gmail.com");
  assert.equal(canonicalEmail("V.i.n.a.y@gmail.com"), "vinay@gmail.com");
  assert.equal(canonicalEmail("A.B@Corp.COM"), "a.b@corp.com", "dots are not folded for other providers");
  assert.notEqual(canonicalEmail("a+x@corp.com"), canonicalEmail("a@corp.com"), "+tags are not folded for other providers");
});

test("passwords are stored with scrypt, verified, upgraded when weaker, and the policy is enforced", async () => {
  const h = await pw.hashPassword(STRONG);
  assert.match(h, /^scrypt\$32768\$8\$1\$/);
  assert.ok(!h.includes(STRONG));
  assert.equal(await pw.verifyPassword(STRONG, h), true);
  assert.equal(await pw.verifyPassword(STRONG + "x", h), false);
  assert.equal(await pw.verifyPassword(STRONG, "garbage"), false);
  assert.equal(pw.needsRehash(h), false);
  assert.equal(pw.needsRehash(h.replace("$32768$", "$16384$")), true);
  assert.notEqual(await pw.hashPassword(STRONG), h, "a new salt every time");

  const bad = (p, who) => pw.checkPassword(p, who || { email: "someone.else@x.org", name: "Some One" });
  assert.match(bad("short1A!"), /at least 10/);
  assert.match(bad("alllowercase"), /three of/);
  assert.match(bad("Password123"), /common/);
  assert.match(bad("aaaaaaaaaaaaaaaaaaaaaaaa"), /predictable/);
  assert.match(bad("abcdefghijklmnopqrstuvwx"), /predictable/);
  assert.match(bad("Vinay2026Strong!", { email: "vinay@x.org" }), /email/);
  assert.match(bad("Strong-Tiwari-77!", { email: "q@x.org", name: "Vinay Tiwari" }), /name/);
  assert.equal(bad(STRONG), null);
  assert.equal(bad("a long passphrase of plain words"), null, "16 characters or more need no mix");
});

test("the mailer reads its settings, hides the password, and turns library errors into sentences", async () => {
  const sent = [];
  const data = { settings: {} };
  const store = { data };
  const secrets = { encrypt: (t) => `enc:${t}`, decrypt: (b) => String(b).replace(/^enc:/, "") };
  const m = new Mailer({
    store,
    secrets,
    env: {},
    log: { error() {} },
    createTransport: (cfg) => ({
      cfg,
      sendMail: async (msg) => {
        if (cfg.host === "bad.example") throw Object.assign(new Error("Invalid login: 535"), { code: "EAUTH" });
        sent.push({ cfg, msg });
        return { messageId: "m1" };
      },
      verify: async () => true,
    }),
  });
  assert.equal(m.configured(), false);
  await assert.rejects(m.send({ to: "a@b.org", subject: "x", text: "y" }), { code: "not_configured" });

  data.settings.smtp = { host: "smtp.example.org", port: 465, security: "ssl", user: "me", passEnc: "enc:secret", fromEmail: "noreply@example.org", fromName: "DrishtiAI" };
  assert.equal(m.configured(), true);
  await m.send({ to: "a@b.org", subject: "Hi\r\nBcc: x@y.z", text: "t", html: "<p>t</p>" });
  assert.equal(sent[0].cfg.secure, true);
  assert.deepEqual(sent[0].cfg.auth, { user: "me", pass: "secret" });
  assert.ok(!/[\r\n]/.test(sent[0].msg.subject), "no header injection through the subject");
  await assert.rejects(m.send({ to: "a@b.org\r\nBcc: x@y.z", subject: "x", text: "t" }), { code: "bad_address" });

  data.settings.smtp.host = "bad.example";
  await assert.rejects(m.send({ to: "a@b.org", subject: "x", text: "t" }), (e) => e.code === "send_failed" && /user name or password/.test(e.message) && !/535/.test(e.message));

  // from the environment when the database has no host
  const env = new Mailer({ store: { data: { settings: {} } }, secrets, env: { SMTP_HOST: "mail.corp.org", SMTP_USER: "u@corp.org", SMTP_PASS: "pw" }, createTransport: () => ({}) });
  assert.equal(env.config().source, "environment");
  assert.equal(env.config().fromEmail, "u@corp.org");
  assert.equal(env.configured(), true);
});

/* ------------------------------------------------------------- setting a password from an emailed link */

test("an invitation by email: the link sets a password once; the same mailbox is the same person by any route", async (t) => {
  const s = await boot();
  t.after(s.close);

  const add = await s.request("POST", "/api/admin/admins", { cookie: s.boss, body: { email: "Helper.One@Gmail.com" } });
  assert.equal(add.status, 201);
  assert.equal(add.json.invited, true);
  assert.equal(s.mailer.outbox.length, 1);
  const mail = s.mailer.outbox[0];
  assert.equal(mail.to, "helper.one@gmail.com");
  assert.match(mail.text, /^You have been given access|DrishtiAI/m);
  assert.match(mail.text, /https:\/\/site\.test\/me\/reset\?token=/, "links use the configured address");
  const token = s.tokenIn(mail);

  // the link can be looked at, and says whose it is only in part
  const look = await s.request("POST", "/api/auth/email/token", { body: { token } });
  assert.equal(look.status, 200);
  assert.match(look.json.email, /^h•+@gmail\.com$/);
  assert.equal((await s.request("POST", "/api/auth/email/token", { body: { token: token + "x" } })).status, 400);

  // the policy applies, and a refused password does not use the link up
  assert.equal((await s.request("POST", "/api/auth/email/password", { body: { token, password: "short" } })).status, 400);
  const set = await s.request("POST", "/api/auth/email/password", { body: { token, password: STRONG } });
  assert.equal(set.status, 200);
  assert.equal((await s.request("POST", "/api/auth/email/password", { body: { token, password: STRONG + "2" } })).status, 400, "single use");
  await s.flush();
  assert.ok(s.mailer.outbox.some((m) => /password was changed/i.test(m.subject)), "a notice goes to the person");

  // signing in by a different spelling of the same mailbox
  const a = await s.login("helperone+work@GOOGLEMAIL.com", STRONG);
  assert.equal(a.status, 200);
  const me = await s.request("GET", "/api/auth/status", { cookie: a.jar });
  assert.equal(me.json.user.email, "helper.one@gmail.com", "the listed address is the one identity");
  assert.equal(me.json.user.role, "admin");
  assert.equal(me.json.user.hasPassword, true);

  // and through Google as yet another spelling: the same record, nothing lost
  const g = await s.google("HELPERONE@gmail.com");
  const me2 = await s.request("GET", "/api/auth/status", { cookie: g.session });
  assert.equal(me2.json.user.email, "helper.one@gmail.com");
  assert.equal(me2.json.user.hasPassword, true, "Google sign-in kept the password");
  assert.equal((await s.login("helper.one@gmail.com", STRONG)).status, 200, "and the password still works after Google");
  assert.equal(Object.keys(s.made.store.data.users).filter((k) => canonicalEmail(k) === "helperone@gmail.com").length, 1, "one record for one person");
});

test("duplicates are refused: same mailbox in another spelling, and the superadmin's own", async (t) => {
  const s = await boot();
  t.after(s.close);
  const ok = await s.request("POST", "/api/admin/admins", { cookie: s.boss, body: { email: "first.person@gmail.com", invite: false } });
  assert.equal(ok.status, 201);
  for (const e of ["FIRST.PERSON@gmail.com", "firstperson@gmail.com", "first.person+x@googlemail.com", "f.i.r.s.t.person@gmail.com"]) {
    const r = await s.request("POST", "/api/admin/admins", { cookie: s.boss, body: { email: e } });
    assert.equal(r.status, 409, e);
  }
  const sup = await s.request("POST", "/api/admin/admins", { cookie: s.boss, body: { email: SUPERADMIN_EMAIL.replace(".", "").toUpperCase() } });
  assert.equal(sup.status, 400);
  assert.equal(s.made.store.data.admins.length, 1);
  assert.equal(s.mailer.outbox.length, 0, "invite:false sends nothing");
});

test("a person who is not on the list cannot get in by any email route, and nobody can tell why", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.person("listed@corp.org");
  await s.request("POST", "/api/admin/admins", { cookie: s.boss, body: { email: "nopassword@corp.org", invite: false } });

  const wrong = await s.login("listed@corp.org", "Wrong-Password-1x");
  const unknown = await s.login("stranger@corp.org", STRONG);
  const noPass = await s.login("nopassword@corp.org", STRONG);
  for (const r of [wrong, unknown, noPass]) {
    assert.equal(r.status, 401);
    assert.equal(r.json.error, "bad_login");
    assert.equal(r.json.message, wrong.json.message, "the same words every time");
    assert.equal(r.jar, "", "no session");
  }

  // a link or a code for a stranger: the same answer, and no mail
  const link = await s.request("POST", "/api/auth/email/link", { body: { email: "stranger@corp.org" } });
  const real = await s.request("POST", "/api/auth/email/link", { body: { email: "listed@corp.org" } });
  assert.equal(link.status, 200);
  assert.deepEqual(link.json, real.json);
  const c1 = await s.request("POST", "/api/auth/email/code", { body: { email: "stranger@corp.org" } });
  const c2 = await s.request("POST", "/api/auth/email/code", { body: { email: "nopassword@corp.org" } });
  assert.deepEqual(c1.json, c2.json);
  await s.flush();
  assert.deepEqual(s.mailer.outbox.map((m) => m.to).sort(), ["listed@corp.org", "nopassword@corp.org"].sort(), "only people on the list were mailed");
});

test("five wrong passwords lock the address for 15 minutes, a right one is refused meanwhile, and the owner can unlock", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.person("lock.me@corp.org");

  for (let i = 0; i < 4; i += 1) assert.equal((await s.login("lock.me@corp.org", "Wrong-Password-" + i)).status, 401);
  const fifth = await s.login("lock.me@corp.org", "Wrong-Password-4");
  assert.equal(fifth.status, 429);
  assert.equal(fifth.json.error, "locked");
  assert.ok(Number(fifth.headers["retry-after"]) > 800);
  assert.equal((await s.login("lock.me@corp.org", STRONG)).status, 429, "even the right password waits");
  const row = (await s.request("GET", "/api/admin/admins", { cookie: s.boss })).json.admins.find((a) => a.email === "lock.me@corp.org");
  assert.equal(row.lockedOut, true);

  s.clock.t += 16 * 60 * 1000;
  assert.equal((await s.login("lock.me@corp.org", STRONG)).status, 200, "the lock ends by itself");

  for (let i = 0; i < 5; i += 1) await s.login("lock.me@corp.org", "Wrong-Password-" + i);
  assert.equal((await s.login("lock.me@corp.org", STRONG)).status, 429);
  assert.equal((await s.request("POST", "/api/admin/admins/lock.me%40corp.org/unlock", { cookie: s.boss })).status, 200);
  assert.equal((await s.login("lock.me@corp.org", STRONG)).status, 200);
});

test("an address that does not exist is locked the same way, so the lock tells nothing either", async (t) => {
  const s = await boot();
  t.after(s.close);
  for (let i = 0; i < 4; i += 1) assert.equal((await s.login("ghost@corp.org", "Wrong-Password-" + i)).status, 401);
  assert.equal((await s.login("ghost@corp.org", "Wrong-Password-4")).status, 429);
  assert.equal((await s.login("ghost@corp.org", STRONG)).status, 429);
  assert.equal((await s.login("ghost@corp.org", STRONG)).headers["retry-after"] > 0, true);
});

test("a code by email: sent to people on the list, single use, five tries, ten minutes", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.request("POST", "/api/admin/admins", { cookie: s.boss, body: { email: "coder@corp.org", invite: false } });

  assert.equal((await s.request("POST", "/api/auth/email/code", { body: { email: "coder@corp.org" } })).status, 200);
  await s.flush();
  const code = s.codeIn(s.mailer.outbox.at(-1));
  assert.match(code, /^\d{6}$/);
  assert.ok(!JSON.stringify(s.made.store.data).includes(code), "the code itself is not stored");

  const wrong = String((Number(code) + 1) % 1000000).padStart(6, "0");
  assert.equal((await s.request("POST", "/api/auth/email/code/verify", { body: { email: "coder@corp.org", code: wrong } })).status, 401);
  const ok = await s.request("POST", "/api/auth/email/code/verify", { body: { email: "CODER@corp.org", code }, headers: {} });
  assert.equal(ok.status, 200);
  assert.equal((await s.request("GET", "/api/auth/status", { cookie: ok.jar })).json.user.email, "coder@corp.org");
  assert.equal((await s.request("POST", "/api/auth/email/code/verify", { body: { email: "coder@corp.org", code } })).status, 401, "used once");

  // too many wrong tries kill that code even if the next guess is right
  s.clock.t += 2 * 60 * 1000; // past the resend wait
  await s.request("POST", "/api/auth/email/code", { body: { email: "coder@corp.org" } });
  await s.flush();
  const code2 = s.codeIn(s.mailer.outbox.at(-1));
  for (let i = 0; i < 4; i += 1) await s.request("POST", "/api/auth/email/code/verify", { body: { email: "coder@corp.org", code: "000000" } });
  assert.notEqual((await s.request("POST", "/api/auth/email/code/verify", { body: { email: "coder@corp.org", code: code2 } })).status, 200, "locked after the wrong tries");

  // and a code that is too old
  s.clock.t += 20 * 60 * 1000;
  await s.request("POST", "/api/auth/email/code", { body: { email: "coder@corp.org" } });
  await s.flush();
  const code3 = s.codeIn(s.mailer.outbox.at(-1));
  s.clock.t += 11 * 60 * 1000;
  assert.equal((await s.request("POST", "/api/auth/email/code/verify", { body: { email: "coder@corp.org", code: code3 } })).status, 401, "expired");
});

test("mail is not sent faster than once a minute per address, and never to the address in a forged Host header", async (t) => {
  const s = await boot({ origin: "" });
  t.after(s.close);
  // no site address configured and the request does not come from a development machine: no link is made
  const forged = await s.request("POST", "/api/auth/email/link", { body: { email: SUPERADMIN_EMAIL }, headers: { host: "evil.example" } });
  assert.equal(forged.status, 200);
  await s.flush();
  assert.equal(s.mailer.outbox.length, 0, "a link built from a stranger's Host header would be a password-reset attack");
  s.clock.t += 61 * 1000;

  // from a development machine (the test itself) it is fine
  await s.request("POST", "/api/auth/email/link", { body: { email: SUPERADMIN_EMAIL } });
  await s.flush();
  assert.equal(s.mailer.outbox.length, 1);
  assert.match(s.mailer.outbox[0].text, /http:\/\/127\.0\.0\.1:\d+\/me\/reset\?token=/);
  await s.request("POST", "/api/auth/email/link", { body: { email: SUPERADMIN_EMAIL } });
  await s.flush();
  assert.equal(s.mailer.outbox.length, 1, "the second ask within a minute is answered but not mailed");
  s.clock.t += 61 * 1000;
  await s.request("POST", "/api/auth/email/link", { body: { email: SUPERADMIN_EMAIL } });
  await s.flush();
  assert.equal(s.mailer.outbox.length, 2);
});

test("a newer link replaces the older one, and a link dies when the person is taken off the list", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.request("POST", "/api/admin/admins", { cookie: s.boss, body: { email: "linky@corp.org" } });
  const first = s.tokenIn(s.mailer.outbox.at(-1));
  s.clock.t += 2 * 60 * 1000;
  await s.request("POST", "/api/auth/email/link", { body: { email: "linky@corp.org" } });
  await s.flush();
  const second = s.tokenIn(s.mailer.outbox.at(-1));
  assert.notEqual(first, second);
  assert.equal((await s.request("POST", "/api/auth/email/token", { body: { token: first } })).status, 400, "replaced");
  assert.equal((await s.request("POST", "/api/auth/email/token", { body: { token: second } })).status, 200);
  await s.request("DELETE", "/api/admin/admins/linky%40corp.org", { cookie: s.boss });
  assert.equal((await s.request("POST", "/api/auth/email/token", { body: { token: second } })).status, 400, "no longer on the list");
  // a link is not a session, and a session is not a link
  assert.equal((await s.request("GET", "/api/auth/status", { cookie: `vpt_session=${second}` })).json.user, null);
  assert.equal((await s.request("POST", "/api/auth/email/token", { body: { token: s.boss.split("=")[1] } })).status, 400);
});

/* ------------------------------------------------------------- signed in */

test("changing a password needs the current one, signs out the other devices and keeps this one", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.person("changer@corp.org");
  const one = (await s.login("changer@corp.org", STRONG)).jar;
  const two = (await s.login("changer@corp.org", STRONG)).jar;

  const wrong = await s.request("POST", "/api/auth/password/change", { cookie: one, body: { current: "Not-The-Password-1", next: "Another-Strong-Pass-5" } });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.json.error, "bad_current");
  const weak = await s.request("POST", "/api/auth/password/change", { cookie: one, body: { current: STRONG, next: "weak" } });
  assert.equal(weak.status, 400);
  assert.equal(weak.json.error, "weak_password");

  const done = await s.request("POST", "/api/auth/password/change", { cookie: one, body: { current: STRONG, next: "Another-Strong-Pass-5" } });
  assert.equal(done.status, 200);
  assert.ok(done.jar.startsWith("vpt_session="), "this device gets a fresh session");
  assert.equal((await s.request("GET", "/api/auth/status", { cookie: two })).json.user, null, "the other device is signed out");
  assert.equal((await s.request("GET", "/api/auth/status", { cookie: done.jar })).json.user.email, "changer@corp.org");
  assert.equal((await s.login("changer@corp.org", STRONG)).status, 401, "the old password no longer works");
  assert.equal((await s.login("changer@corp.org", "Another-Strong-Pass-5")).status, 200);

  // sign out everywhere, and the owner can do it for someone
  const other = (await s.login("changer@corp.org", "Another-Strong-Pass-5")).jar;
  const rev = await s.request("POST", "/api/auth/sessions/revoke", { cookie: done.jar });
  assert.equal((await s.request("GET", "/api/auth/status", { cookie: other })).json.user, null);
  assert.equal((await s.request("GET", "/api/auth/status", { cookie: rev.jar })).json.user.email, "changer@corp.org");
  const forced = await s.request("POST", "/api/admin/admins/changer%40corp.org/signout", { cookie: s.boss });
  assert.equal(forced.status, 200);
  assert.equal((await s.request("GET", "/api/auth/status", { cookie: rev.jar })).json.user, null);
  assert.equal((await s.request("GET", "/api/auth/status", { cookie: s.boss })).json.user.email, SUPERADMIN_EMAIL, "the owner stays signed in");
});

test("someone who has only used Google gets a first password from an emailed link, unless there is no email", async (t) => {
  const s = await boot();
  t.after(s.close);
  const direct = await s.request("POST", "/api/auth/password/change", { cookie: s.boss, body: { next: STRONG } });
  assert.equal(direct.status, 409);
  assert.equal(direct.json.error, "use_link");

  const acct = await s.request("GET", "/api/auth/account", { cookie: s.boss });
  assert.equal(acct.json.hasPassword, false);
  assert.equal(acct.json.googleLinked, true);
  assert.equal(acct.json.canSetPasswordDirectly, false);
  assert.ok(acct.json.activity.some((a) => a.type === "signin" && a.method === "google"));

  s.mailer.on = false; // no mail server: a signed-in person may set it here
  const ok = await s.request("POST", "/api/auth/password/change", { cookie: s.boss, body: { next: STRONG } });
  assert.equal(ok.status, 200);
  assert.equal((await s.login(SUPERADMIN_EMAIL, STRONG)).status, 200);
});

test("signing out is recorded, 'don't keep me signed in' gives a session cookie, and a removed person's sessions end", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.person("short@corp.org");
  const keep = await s.request("POST", "/api/auth/email/login", { body: { email: "short@corp.org", password: STRONG, remember: false } });
  assert.equal(keep.status, 200);
  const cookieLine = [].concat(keep.headers["set-cookie"]).find((c) => c.startsWith("vpt_session="));
  assert.ok(!/Max-Age/i.test(cookieLine), "no Max-Age: gone when the browser closes");
  const long = await s.login("short@corp.org", STRONG);
  assert.match([].concat(long.headers["set-cookie"]).find((c) => c.startsWith("vpt_session=")), /Max-Age=604800/);

  await s.request("POST", "/api/auth/logout", { cookie: long.jar });
  await s.request("DELETE", "/api/admin/admins/short%40corp.org", { cookie: s.boss });
  assert.equal((await s.request("GET", "/api/auth/status", { cookie: keep.jar })).json.user, null);
  assert.equal((await s.login("short@corp.org", STRONG)).status, 401, "their password went with their access");
  await s.request("POST", "/api/admin/admins", { cookie: s.boss, body: { email: "short@corp.org", invite: false } });
  assert.equal((await s.request("GET", "/api/auth/status", { cookie: keep.jar })).json.user, null, "an old session does not come back when they are added again");

  const trail = (await s.request("GET", "/api/admin/auth/audit", { cookie: s.boss })).json.entries;
  const types = trail.map((e) => e.type);
  for (const want of ["signin", "signout", "password_set", "admin_added", "admin_removed"]) assert.ok(types.includes(want), want);
  assert.ok(trail.every((e) => !JSON.stringify(e).includes(STRONG)), "no password in the trail");
  assert.ok(trail[0].at >= trail[trail.length - 1].at, "newest first");
});

/* ------------------------------------------------------------- the owner's settings */

test("Email & sign-in settings: superadmin only, validated, the password is encrypted and never returned", async (t) => {
  const sent = [];
  const s = await boot({
    realMailer: true,
    app: {
      mailTransport: (cfg) => ({ sendMail: async (m) => (sent.push({ cfg, m }), { messageId: "x" }), verify: async () => true }),
    },
  });
  t.after(s.close);

  // an ordinary admin cannot read or change it
  await s.request("POST", "/api/admin/admins", { cookie: s.boss, body: { email: "plain@corp.org", invite: false } });
  const plain = (await s.google("plain@corp.org")).session;
  assert.equal((await s.request("GET", "/api/admin/settings/email", { cookie: plain })).status, 403);
  assert.equal((await s.request("PUT", "/api/admin/settings/email", { cookie: plain, body: {} })).status, 403);
  assert.equal((await s.request("GET", "/api/admin/settings/email")).status, 401);
  assert.equal((await s.request("POST", "/api/admin/settings/email/test", { cookie: plain, body: {} })).status, 403);

  let r = await s.request("GET", "/api/admin/settings/email", { cookie: s.boss });
  assert.equal(r.status, 200);
  assert.equal(r.json.emailReady, false);
  assert.deepEqual(r.json.signIn, { google: true, password: true, code: true });

  const body = (over = {}) => ({ smtp: { host: "smtp.example.org", port: 587, security: "starttls", user: "mailer@example.org", pass: "app-password-123", fromEmail: "noreply@example.org", fromName: "DrishtiAI", ...over } });
  for (const [what, over] of [["host", { host: "bad host!" }], ["port", { port: 70000 }], ["security", { security: "weird" }], ["from", { fromEmail: "nope" }], ["pass", { pass: "" }]]) {
    const x = await s.request("PUT", "/api/admin/settings/email", { cookie: s.boss, body: body(over) });
    assert.equal(x.status, 400, what);
  }
  r = await s.request("PUT", "/api/admin/settings/email", { cookie: s.boss, body: body() });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.emailReady, true);
  assert.equal(r.json.smtp.passSet, true);
  assert.ok(!JSON.stringify(r.json).includes("app-password-123"), "the password never comes back");
  const raw = fs.readFileSync(path.join(s.dir, "db.json"), "utf8");
  assert.ok(!raw.includes("app-password-123"), "stored encrypted");
  assert.match(raw, /passEnc/);

  // leaving the password blank keeps it
  r = await s.request("PUT", "/api/admin/settings/email", { cookie: s.boss, body: body({ pass: "", fromName: "Renamed" }) });
  assert.equal(r.status, 200);
  assert.equal(r.json.smtp.fromName, "Renamed");
  assert.equal(r.json.smtp.passSet, true);

  // a test message, only to someone with access
  assert.equal((await s.request("POST", "/api/admin/settings/email/test", { cookie: s.boss, body: { to: "stranger@elsewhere.org" } })).status, 400);
  const t1 = await s.request("POST", "/api/admin/settings/email/test", { cookie: s.boss, body: {} });
  assert.equal(t1.status, 200);
  assert.equal(sent.at(-1).m.to, SUPERADMIN_EMAIL);
  assert.deepEqual(sent.at(-1).cfg.auth, { user: "mailer@example.org", pass: "app-password-123" });
  assert.equal((await s.request("POST", "/api/admin/settings/email/verify", { cookie: s.boss, body: {} })).status, 200);

  // the site address for links: https, no path
  for (const bad of ["http://site.example", "https://site.example/path", "javascript:alert(1)", "https://u:p@site.example"]) {
    assert.equal((await s.request("PUT", "/api/admin/settings/email", { cookie: s.boss, body: { publicUrl: bad } })).status, 400, bad);
  }
  r = await s.request("PUT", "/api/admin/settings/email", { cookie: s.boss, body: { publicUrl: "https://My.Site.example/" } });
  assert.equal(r.json.publicUrl, "https://my.site.example");
});

test("the owner can turn ways in off, but never all of them, and an off way is really off", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.person("both@corp.org");

  let r = await s.request("PUT", "/api/admin/settings/email", { cookie: s.boss, body: { signIn: { google: false, password: false, code: false } } });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, "locked_out");

  r = await s.request("PUT", "/api/admin/settings/email", { cookie: s.boss, body: { signIn: { google: false } } });
  assert.equal(r.status, 200);
  const start = await s.request("GET", "/api/auth/google/start");
  assert.equal(start.status, 302);
  assert.match(start.headers.location, /error=google-off/);
  assert.equal((await s.request("GET", "/api/auth/status")).json.methods.google, false);

  r = await s.request("PUT", "/api/admin/settings/email", { cookie: s.boss, body: { signIn: { google: true, password: false, code: false } } });
  assert.equal(r.status, 200);
  assert.equal((await s.login("both@corp.org", STRONG)).status, 403);
  assert.equal((await s.request("POST", "/api/auth/email/code", { body: { email: "both@corp.org" } })).status, 403);
  const m = (await s.request("GET", "/api/auth/status")).json.methods;
  assert.deepEqual(m, { google: true, password: false, code: false });
});

test("with no mail server the email routes say so plainly, and password sign-in still works", async (t) => {
  const s = await boot({ mailer: fakeMailer({ on: false }) });
  t.after(s.close);
  const m = (await s.request("GET", "/api/auth/status")).json.methods;
  assert.deepEqual(m, { google: true, password: true, code: false });
  const link = await s.request("POST", "/api/auth/email/link", { body: { email: SUPERADMIN_EMAIL } });
  assert.equal(link.status, 503);
  assert.equal(link.json.error, "email_off");
  assert.equal((await s.request("POST", "/api/auth/email/code", { body: { email: SUPERADMIN_EMAIL } })).status, 403);
  const add = await s.request("POST", "/api/admin/admins", { cookie: s.boss, body: { email: "nomail@corp.org" } });
  assert.equal(add.status, 201);
  assert.equal(add.json.invited, false);
});

test("a failed invitation does not undo adding the person, and says why", async (t) => {
  const s = await boot();
  t.after(s.close);
  s.mailer.failNext = true;
  const add = await s.request("POST", "/api/admin/admins", { cookie: s.boss, body: { email: "unlucky@corp.org" } });
  assert.equal(add.status, 201);
  assert.equal(add.json.invited, false);
  assert.match(add.json.inviteProblem, /user name or password/);
  assert.equal(s.made.store.data.admins.length, 1);
  // and it can be sent again from the people list
  const again = await s.request("POST", "/api/admin/admins/unlucky%40corp.org/link", { cookie: s.boss });
  assert.equal(again.status, 200);
  assert.equal(s.mailer.outbox.length, 1);
  assert.equal((await s.request("POST", "/api/admin/admins/nobody%40corp.org/link", { cookie: s.boss })).status, 404);
});

test("the email routes need the request header, like every other change", async (t) => {
  const s = await boot();
  t.after(s.close);
  const status = await new Promise((resolve, reject) => {
    const rq = http.request({ host: "127.0.0.1", port: s.port, method: "POST", path: "/api/auth/email/login", headers: { "content-type": "application/json" } }, (x) => {
      x.resume();
      x.on("end", () => resolve(x.statusCode));
    });
    rq.on("error", reject);
    rq.end(JSON.stringify({ email: "a@b.org", password: "x" }));
  });
  assert.equal(status, 403);
});

/* ------------------------------------------------------------- sign up: ask for access */

test("sign up: an address already on the list gets its link; a stranger becomes a request the owner decides, and the answer is the same", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.request("POST", "/api/admin/admins", { cookie: s.boss, body: { email: "known@corp.org", invite: false } });

  const known = await s.request("POST", "/api/auth/email/signup", { body: { name: "Known Person", email: "KNOWN@corp.org" } });
  s.clock.t += 61 * 1000;
  const stranger = await s.request("POST", "/api/auth/email/signup", { body: { name: "Stranger Danger", email: "Stranger@Elsewhere.org", note: "I trade the NIFTY and would like to look." } });
  assert.equal(known.status, 200);
  assert.deepEqual(known.json, stranger.json, "nothing tells the two apart");
  await s.flush();
  const to = s.mailer.outbox.map((m) => m.to).sort();
  assert.deepEqual(to, [SUPERADMIN_EMAIL, "known@corp.org"].sort(), "the known one got a link, the owner got a notice");
  assert.match(s.mailer.outbox.find((m) => m.to === SUPERADMIN_EMAIL).text, /Stranger Danger[\s\S]*NIFTY/);

  // the stranger is only a request: no access
  assert.equal(s.made.store.data.admins.length, 1);
  assert.equal((await s.login("stranger@elsewhere.org", STRONG)).status, 401);
  assert.equal((await s.request("POST", "/api/auth/email/link", { body: { email: "stranger@elsewhere.org" } })).status, 200);
  await s.flush();
  assert.equal(s.mailer.outbox.filter((m) => m.to === "stranger@elsewhere.org").length, 0);

  // asking twice (another spelling of the Gmail address) keeps one request, with the newest words
  await s.request("POST", "/api/auth/email/signup", { body: { name: "Gee Mail", email: "g.mail@gmail.com" } });
  await s.request("POST", "/api/auth/email/signup", { body: { name: "Gee Mail Two", email: "GMAIL+x@googlemail.com" } });
  const list = (await s.request("GET", "/api/admin/requests", { cookie: s.boss })).json.requests;
  assert.equal(list.length, 2);
  assert.equal(list.find((r) => /gmail/.test(r.email)).name, "Gee Mail Two");

  // only the owner sees and decides requests
  await s.request("POST", "/api/admin/admins", { cookie: s.boss, body: { email: "plain@corp.org", invite: false } });
  const plain = (await s.google("plain@corp.org")).session;
  assert.equal((await s.request("GET", "/api/admin/requests", { cookie: plain })).status, 403);
  assert.equal((await s.request("POST", `/api/admin/requests/${list[0].id}/approve`, { cookie: plain })).status, 403);
});

test("sign up: approving a request adds the person, emails the invitation and finishes with their name; declining just removes it", async (t) => {
  const s = await boot();
  t.after(s.close);
  await s.request("POST", "/api/auth/email/signup", { body: { name: "New Trader", email: "new.trader@corp.org" } });
  s.clock.t += 61 * 1000;
  await s.request("POST", "/api/auth/email/signup", { body: { name: "Not Today", email: "nope@corp.org" } });
  s.mailer.outbox.length = 0;
  const [first, second] = (await s.request("GET", "/api/admin/requests", { cookie: s.boss })).json.requests.reverse();
  assert.equal(first.email, "new.trader@corp.org");

  const ok = await s.request("POST", `/api/admin/requests/${first.id}/approve`, { cookie: s.boss });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.invited, true);
  assert.equal(s.made.store.data.admins.length, 1);
  const invite = s.mailer.outbox.at(-1);
  assert.equal(invite.to, "new.trader@corp.org");

  // the link finishes the set-up; the name they gave is already there and can be changed
  const look = await s.request("POST", "/api/auth/email/token", { body: { token: s.tokenIn(invite) } });
  assert.equal(look.json.name, "New Trader");
  assert.equal(look.json.hasPassword, false);
  const done = await s.request("POST", "/api/auth/email/password", { body: { token: s.tokenIn(invite), password: STRONG, name: "N. Trader" } });
  assert.equal(done.status, 200);
  const me = await s.request("GET", "/api/auth/account", { cookie: (await s.login("new.trader@corp.org", STRONG)).jar });
  assert.equal(me.json.name, "N. Trader");
  assert.equal((await s.request("POST", `/api/admin/requests/${first.id}/approve`, { cookie: s.boss })).status, 404, "a request is decided once");

  const no = await s.request("POST", `/api/admin/requests/${second.id}/decline`, { cookie: s.boss });
  assert.equal(no.status, 200);
  assert.deepEqual(no.json.requests, []);
  assert.equal(s.made.store.data.admins.length, 1);
  await s.flush();
  assert.equal(s.mailer.outbox.filter((m) => m.to === "nope@corp.org").length, 0, "a declined person is not written to");
  const trail = (await s.request("GET", "/api/admin/auth/audit", { cookie: s.boss })).json.entries.map((e) => e.type);
  for (const want of ["signup_requested", "request_approved", "request_declined"]) assert.ok(trail.includes(want), want);
});

test("sign up needs a name, an address and a working mail server, and cannot be used to mail a stranger", async (t) => {
  const s = await boot();
  t.after(s.close);
  assert.equal((await s.request("POST", "/api/auth/email/signup", { body: { name: "", email: "a@b.org" } })).status, 400);
  assert.equal((await s.request("POST", "/api/auth/email/signup", { body: { name: "A", email: "nope" } })).status, 400);
  await s.request("POST", "/api/auth/email/signup", { body: { name: "<b>Bold</b> One", email: "bold@corp.org", note: "x".repeat(500) } });
  const r = (await s.request("GET", "/api/admin/requests", { cookie: s.boss })).json.requests[0];
  assert.ok(!/[<>]/.test(r.name), "no markup in a name");
  assert.ok(r.note.length <= 240);
  await s.flush();
  assert.equal(s.mailer.outbox.filter((m) => m.to === "bold@corp.org").length, 0, "the person who asked is never mailed until approved");

  s.mailer.on = false;
  const off = await s.request("POST", "/api/auth/email/signup", { body: { name: "A", email: "a@b.org" } });
  assert.equal(off.status, 503);
  assert.equal(off.json.error, "email_off");
});
