"use strict";
// Sign in with an email address, next to "Sign in with Google".
//
// Who may sign in is unchanged: the superadmin and the admins the superadmin has listed — by ANY route. The same
// mailbox is the same person whichever way they arrive (Google, a password, an emailed code), and spellings of one
// mailbox (capitals; for Gmail, dots, +tags and googlemail.com) are one person: see canonicalEmail in config.js.
//
// Ways in by email
//   password   email + password. Set (or reset) from a link that is emailed, so the address is proven to be theirs.
//   code       a 6-digit code emailed to them, valid 10 minutes, five tries, used once. No password needed.
//
// What protects it
//   · ONLY the people the owner has listed can use any of it (21 Nov 2026, the owner's instruction). An address that is not on the
//     list is refused at once, on EVERY route (password, code, link, check) with one plain message — "you are not authorized to
//     enter this space" — nothing is sent to it, no code or link is made, and the sign-in page shows no reset or code option for it.
//     The owner chose that clear refusal over hiding who is on the list; so every refusal is audited (unauthorized_attempt) and counted
//     against the visitor: six in 15 minutes shut that visitor out for 30 minutes — but ONLY for addresses that are not on the list: a listed address is never blocked.
//     (An address that IS listed but types a wrong password still gets the usual answer and lock below.)
//   · a SECURITY GATE in front of all of it (22 Nov 2026, server/captcha.js): a fresh random picture drawn here, a proof of work that
//     gets harder as traffic rises, a pass good for 15 minutes tied to the visitor, and one ceiling over all sign-in traffic
//     ("busy, wait a few seconds"). A script cannot ask for sign-ins by the thousand; every email route refuses without the pass.
//   · five wrong tries lock that address for 15 minutes (per address, kept across restarts for people on the list),
//     and every route has a limit per visitor address as well
//   · passwords: scrypt, a policy (see passwords.js), never logged or returned
//   · links and codes: signed, expire (an hour; three days for an invitation), single use, and a new one replaces the
//     last; links point at the configured site address — never at the Host header of the request
//   · a changed or reset password signs the person out everywhere else; they get a notice by email
//   · every sign-in, failure, lock, link, code and change is written to an audit trail the superadmin can read
//   · mail goes out through the owner's SMTP server, set from the admin panel (server/mailer.js)
//
// Sign up: anyone may ASK for access (name, email, an optional note). An address that is already on the list gets its
// link to choose a password at once; any other address becomes a request the superadmin approves or declines
// (an email tells them), and approval adds the person and emails the invitation. Nobody gets in by asking alone.

const crypto = require("crypto");
const { EMAIL_RE, SMTP_HOST_RE, ADMIN_BASE, SUPERADMIN_EMAIL, canonicalEmail } = require("./config");
const { BRAND } = require("./brand");
const pw = require("./passwords");
const { MailError } = require("./mailer");
const { randomToken, sign, verify, safeEqual } = require("./crypto");
const { Captcha } = require("./captcha");

const LINK_TTL = 60 * 60; // seconds
const INVITE_TTL = 3 * 24 * 60 * 60;
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_TRIES = 5;
const MAX_FAILS = 5;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
// Wrong tries are counted per address AND visitor (security review, 23 Nov 2026): five from one visitor lock that visitor out of
// that address; a stranger can no longer lock the owner out of their own email sign-in. The address as a whole locks only after
// MAX_FAILS_ALL wrong tries from everyone together in the window (a wide guessing attack).
const MAX_FAILS_ALL = 30;
const RESEND_MS = 60 * 1000;
const PER_HOUR = 5;
const MAX_REQUESTS = 50; // open requests kept; a flood cannot grow the record
const STRIKES = 6; // refusals of unlisted addresses, from one visitor, within STRIKE_WINDOW_MS, shut that visitor out…
const STRIKE_WINDOW_MS = 15 * 60 * 1000;
const STRIKE_BLOCK_MS = 30 * 60 * 1000; // …for this long
const NOT_AUTHORIZED = "You are not authorized to enter this space. Please do not try to sign in: this is the personal space of Vinay Kumar Tiwari, open only to the email addresses he has allowed.";

const sha = (x) => crypto.createHash("sha256").update(String(x)).digest("hex");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const maskEmail = (e) => {
  const [l, d] = String(e).split("@");
  return `${l.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(6, l.length - 1)))}@${d}`;
};

/** The three switches, with "on" as the default for anything never set. */
function toggles(store) {
  const s = (store.data.settings && store.data.settings.signIn) || {};
  return { google: s.google !== false, password: s.password !== false, code: s.code !== false };
}

/** A small, plain message: text for every client and a simple card for those that show HTML. */
function message({ title, lines, button, fine }) {
  const text = [title, "", ...lines, ...(button ? ["", `${button.label}: ${button.url}`] : []), "", fine || "", "", `— ${BRAND.name}`].join("\n").replace(/\n{3,}/g, "\n\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f8;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#17212b">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="480" cellspacing="0" cellpadding="0" style="max-width:480px;background:#ffffff;border-radius:14px;padding:28px;border:1px solid #e1e6ec">
<tr><td style="font-size:13px;font-weight:600;color:#53657a;padding-bottom:6px">${esc(BRAND.name)}</td></tr>
<tr><td style="font-size:20px;font-weight:600;padding-bottom:14px">${esc(title)}</td></tr>
${lines.map((l) => `<tr><td style="font-size:15px;line-height:1.55;padding-bottom:10px">${esc(l)}</td></tr>`).join("\n")}
${button ? `<tr><td style="padding:10px 0 14px"><a href="${esc(button.url)}" style="display:inline-block;background:#1a6fd4;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:11px 20px;border-radius:9px">${esc(button.label)}</a></td></tr>
<tr><td style="font-size:12px;color:#6a7b8e;word-break:break-all;padding-bottom:10px">Or paste this address into your browser:<br>${esc(button.url)}</td></tr>` : ""}
${fine ? `<tr><td style="font-size:12px;line-height:1.5;color:#6a7b8e;border-top:1px solid #e8ecf1;padding-top:12px">${esc(fine)}</td></tr>` : ""}
</table></td></tr></table></body></html>`;
  return { text, html };
}

/**
 * @returns { methods() } — what is open for sign-in right now: { google, password, code }
 */
function mountEmailAuth(app, ctx) {
  const { store, mailer, sessionKey, limiter, requireAdmin, requireSuper, identify, startSession, trustedOrigin, audit, googleReady } = ctx;
  const now = ctx.now || (() => Date.now());
  const log = ctx.log || console;
  const linkKey = crypto.createHmac("sha256", sessionKey).update("email-auth/link").digest();

  const methods = () => {
    const t = toggles(store);
    return { google: t.google && Boolean(googleReady()), password: t.password, code: t.code && mailer.configured() };
  };

  const record = (id) => (id ? store.data.users[id.email] || null : null);
  const touch = (id, fn) =>
    store.update((d) => {
      if (!d.users[id.email]) d.users[id.email] = {};
      fn(d.users[id.email], d);
    });
  const bad = (res, status, error, message2, extra) => res.status(status).json({ error, message: message2, ...(extra || {}) });
  const typed = (v) => String(v == null ? "" : v).trim().slice(0, 254);

  /* ------------------------------------------------ wrong tries and the lock */
  const memFails = new Map(); // for addresses that are not on the list: kept only in memory
  const visitorFails = new Map(); // `${address}|${visitor}` → { n, first, until } (memory; a restart forgets, the address lock stays)
  const visitorOf = (req) => String((req && (req.ip || (req.socket && req.socket.remoteAddress))) || "?").slice(0, 64);
  const failsOf = (canon, id) => (id ? (record(id) || {}).fails || null : memFails.get(canon) || null);
  const left = (f) => (f && f.until > now() ? f.until - now() : 0);
  /** How long this address is locked: for one visitor (`who`), or — without `who` — for anyone (the admin page's "locked"). */
  const lockLeft = (canon, id, who) => {
    let ms = left(failsOf(canon, id));
    if (who) ms = Math.max(ms, left(visitorFails.get(`${canon}|${who}`)));
    else for (const [k, f] of visitorFails) if (k.startsWith(`${canon}|`)) ms = Math.max(ms, left(f));
    return ms;
  };
  const bump = (f, t, max) => {
    let g = f || { n: 0, first: t, until: 0 };
    if (t - g.first > FAIL_WINDOW_MS || (g.until && g.until <= t)) g = { n: 0, first: t, until: 0 };
    return { n: g.n + 1, first: g.first, until: g.n + 1 >= max ? t + LOCK_MS : 0 };
  };
  function recordFail(canon, id, who) {
    const t = now();
    // the address as a whole: a listed one only after many wrong tries from everyone; an unlisted one as before
    const f = bump(failsOf(canon, id), t, id && who ? MAX_FAILS_ALL : MAX_FAILS);
    if (id) touch(id, (u) => (u.fails = f));
    else {
      memFails.set(canon, f);
      if (memFails.size > 5000) memFails.delete(memFails.keys().next().value);
    }
    if (!who) return f;
    const k = `${canon}|${who}`;
    const v = bump(visitorFails.get(k), t, MAX_FAILS);
    visitorFails.delete(k);
    visitorFails.set(k, v);
    if (visitorFails.size > 20000) visitorFails.delete(visitorFails.keys().next().value);
    return { n: Math.max(f.n, v.n), until: Math.max(f.until || 0, v.until || 0) };
  }
  function clearFails(canon, id, who) {
    if (id) {
      const u = record(id);
      if (u && u.fails && !who) touch(id, (x) => delete x.fails);
    } else memFails.delete(canon);
    if (who) visitorFails.delete(`${canon}|${who}`);
    else for (const k of [...visitorFails.keys()]) if (k.startsWith(`${canon}|`)) visitorFails.delete(k);
  }
  const lockedReply = (res, canon, id, req, method) => {
    const ms = lockLeft(canon, id, visitorOf(req));
    audit(req, "locked", canon, { method });
    res.set("Retry-After", String(Math.ceil(ms / 1000)));
    return bad(res, 429, "locked", `Too many wrong attempts. Try again in ${Math.max(1, Math.ceil(ms / 60000))} minute${Math.ceil(ms / 60000) === 1 ? "" : "s"}.`);
  };

  /* ------------------------------------------------ unlisted addresses: refused, counted, shut out */
  const strikes = new Map(); // visitor address -> { n, first, until }
  const visitor = (req) => String((req && req.ip) || "unknown");
  /** Is this visitor shut out for too many refusals? Answers at once, with the same warning, and says for how long. */
  const shutOut = (req, res) => {
    const f = strikes.get(visitor(req));
    if (!f || !f.until || f.until <= now()) return false;
    const mins = Math.max(1, Math.ceil((f.until - now()) / 60000));
    res.set("Retry-After", String(Math.ceil((f.until - now()) / 1000)));
    bad(res, 429, "not_authorized", `${NOT_AUTHORIZED} Too many attempts: this device is paused for ${mins} minute${mins === 1 ? "" : "s"}.`, { blocked: true, retryAfter: Math.ceil((f.until - now()) / 1000) });
    return true;
  };
  // an unlisted address: refused, or — once its visitor has been shut out — turned away at once. A listed address is NEVER held up by this:
  // the pause is only for addresses that are not on the list (the owner's instruction, 22 Nov 2026)
  const deny = (req, res, canon, method) => (shutOut(req, res) ? undefined : refuse(req, res, canon, method));
  /** The one refusal for an address that is not on the list. Nothing is sent to it and nothing is made for it. */
  const refuse = (req, res, canon, method) => {
    const t = now();
    const key = visitor(req);
    let f = strikes.get(key) || { n: 0, first: t, until: 0, tried: [] };
    if (t - f.first > STRIKE_WINDOW_MS || (f.until && f.until <= t)) f = { n: 0, first: t, until: 0, tried: [] };
    const tried = f.tried.includes(canon) ? f.tried : [...f.tried, canon].slice(-6);
    f = { n: f.n + 1, first: f.first, until: f.n + 1 >= STRIKES ? t + STRIKE_BLOCK_MS : 0, tried };
    strikes.set(key, f);
    if (strikes.size > 5000) strikes.delete(strikes.keys().next().value);
    audit(req, "unauthorized_attempt", canon, { method, strikes: f.n });
    if (f.until) {
      audit(req, "visitor_shut_out", canon, { minutes: STRIKE_BLOCK_MS / 60000 });
      alertOwner(req, f);
    }
    return bad(res, 403, "not_authorized", NOT_AUTHORIZED, f.until ? { blocked: true, retryAfter: Math.ceil(STRIKE_BLOCK_MS / 1000) } : undefined);
  };
  // the owner is told, once per shut-out, when a visitor keeps trying addresses that are not on the list (only when mail is set up)
  function alertOwner(req, f) {
    if (!mailer.configured() || !mayMail("owner-alert")) return;
    const m = message({
      title: "Someone keeps trying to get into your private room",
      lines: [
        `A visitor tried ${f.n} addresses that are not on your list and was shut out for ${STRIKE_BLOCK_MINUTES()} minutes.`,
        `Addresses tried: ${f.tried.join(", ")}`,
        `From: ${visitor(req)} · ${String((req.get && req.get("user-agent")) || "").slice(0, 90)}`,
        "Nothing was sent to those addresses and nobody was let in.",
      ],
      fine: "You can see every refused attempt under Email & sign-in → Recent sign-in activity.",
    });
    fire(mailer.send({ to: SUPERADMIN_EMAIL, subject: `${BRAND.name}: a visitor was shut out of your private room`, ...m }), "owner alert");
  }
  const STRIKE_BLOCK_MINUTES = () => STRIKE_BLOCK_MS / 60000;

  /* ------------------------------------------------ sending links and codes */
  const sent = new Map(); // canonical address -> [timestamps]
  function mayMail(canon) {
    const t = now();
    const list = (sent.get(canon) || []).filter((x) => t - x < 3600000);
    if (list.length && t - list[list.length - 1] < RESEND_MS) return false;
    if (list.length >= PER_HOUR) return false;
    list.push(t);
    sent.set(canon, list);
    if (sent.size > 5000) sent.delete(sent.keys().next().value);
    return true;
  }

  /** Make a one-time link for a listed person and mail it. Rejects with MailError. */
  async function sendLink(req, id, { invite = false, by = "" } = {}) {
    const base = trustedOrigin(req);
    if (!base) throw new MailError("The site address for links is not set yet. Set it in Email & sign-in first.", "no_origin");
    const jti = randomToken(16);
    touch(id, (u) => {
      u.linkJti = sha(jti);
      u.linkAt = now();
    });
    const token = sign({ typ: "pw", e: id.email, j: jti }, linkKey, invite ? INVITE_TTL : LINK_TTL);
    const url = `${base}${ADMIN_BASE}/reset?token=${encodeURIComponent(token)}`;
    const has = Boolean((record(id) || {}).passwordHash);
    const hours = invite ? "3 days" : "1 hour";
    const m = invite
      ? message({
          title: `You have been given access to ${BRAND.name}`,
          lines: [`${by || "The owner"} has added you to the private area. You can sign in with Google (using this email address), or choose a password with the button below.`, `The link works for ${hours} and only once.`],
          button: { label: "Choose a password", url },
          fine: "If you were not expecting this, you can ignore this email: nothing changes until the link is used.",
        })
      : message({
          title: has ? "Reset your password" : "Choose your password",
          lines: [has ? "Someone asked to reset the password for this address — hopefully you." : "Use the button to choose a password for signing in with your email address.", `The link works for ${hours} and only once.`],
          button: { label: has ? "Reset password" : "Choose a password", url },
          fine: "If you did not ask for this, ignore this email: your password stays as it is.",
        });
    await mailer.send({ to: id.email, subject: invite ? `Your access to ${BRAND.name}` : has ? `Reset your ${BRAND.name} password` : `Choose your ${BRAND.name} password`, ...m });
  }

  const fire = (promise, what) =>
    promise.catch((err) => log.warn(`[auth] ${what} not sent: ${String((err && err.message) || err).slice(0, 160)}`));

  /* ------------------------------------------------ the security gate: a picture, a proof of work, a flood guard (server/captcha.js) */
  // ctx.captcha === false switches it off (the tests of the routes below); otherwise it is always on
  const cap = ctx.captcha === false ? null : ctx.captcha instanceof Captcha ? ctx.captcha : new Captcha({ key: sessionKey });
  const perVisitor = (max, mins) => limiter(max, mins * 60 * 1000);
  // ONE ceiling over every visitor together: past it, a sign-in request is turned away for almost nothing (before any password
  // hashing, any mail, any record) with "wait a few seconds", so a flood cannot take the server down
  app.use(["/api/auth/email", "/api/auth/captcha", "/api/auth/gate"], (req, res, next) => {
    const wait = cap ? cap.crowded() : 0;
    if (!wait) return next();
    res.set("Retry-After", String(wait));
    return bad(res, 503, "busy", "The sign-in is very busy just now. Please wait a few seconds and try again.", { retryAfter: wait });
  });
  /** Every email sign-in route asks for the pass first. True when it has answered (no pass): the caller returns. */
  const needGate = (req, res) => {
    if (!cap || cap.checkGate((req.body || {}).gate, visitor(req))) return false;
    bad(res, 403, "gate_required", "Please complete the security check first.");
    return true;
  };
  const challengeFor = (req) => {
    const f = strikes.get(visitor(req));
    return cap.issue(visitor(req), { extra: f && f.n ? Math.min(4, f.n) : 0 }); // a visitor who has been refused works a little harder
  };
  const WHY = {
    wrong: "That is not what the picture shows. Here is a new one — please try again.",
    work: "The check could not be finished. Here is a new picture — please try again.",
    used: "That picture was already used. Here is a new one.",
    expired: "That picture timed out. Here is a new one.",
    invalid: "That picture was not meant for this device. Here is a new one.",
  };
  app.get("/api/auth/captcha", perVisitor(20, 10), (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!cap) return res.json({ off: true });
    res.json(challengeFor(req));
  });
  app.post("/api/auth/gate", perVisitor(30, 10), (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!cap) return res.json({ ok: true, off: true });
    const b = req.body || {};
    const r = cap.solve({ token: b.token, answer: b.answer, nonce: b.nonce }, visitor(req));
    if (r.ok) return res.json({ ok: true, gate: r.gate, expiresIn: r.expiresIn });
    audit(req, "captcha_failed", "", { why: r.reason });
    return bad(res, 400, `captcha_${r.reason}`, WHY[r.reason] || WHY.invalid, { challenge: challengeFor(req) });
  });

  /* ------------------------------------------------ routes: public */

  // The first step of signing in by email: is this address one the owner has allowed? Only then does the page show the password
  // field and the reset / code options. An unlisted address gets the refusal and nothing else.
  app.post("/api/auth/email/check", perVisitor(12, 15), (req, res) => {
    if (needGate(req, res)) return;
    const email = typed((req.body || {}).email);
    if (!EMAIL_RE.test(email)) return bad(res, 400, "invalid", "Enter a valid email address.");
    const canon = canonicalEmail(email);
    const id = identify(email);
    if (!id) return deny(req, res, canon, "check");
    const m = methods();
    res.json({ ok: true, email: id.email, hasPassword: Boolean((record(id) || {}).passwordHash), can: { password: m.password, code: m.code, link: mailer.configured() } });
  });

  app.post("/api/auth/email/login", perVisitor(20, 15), async (req, res) => {
    if (needGate(req, res)) return;
    const b = req.body || {};
    const email = typed(b.email);
    const password = typeof b.password === "string" ? b.password.slice(0, 256) : "";
    if (!EMAIL_RE.test(email) || !password) return bad(res, 400, "invalid", "Enter your email address and password.");
    const canon = canonicalEmail(email);
    const id = identify(email);
    if (!id) return deny(req, res, canon, "password");
    if (!methods().password) return bad(res, 403, "disabled", "Signing in with a password is turned off.");
    if (lockLeft(canon, id, visitorOf(req))) return lockedReply(res, canon, id, req, "password");

    const rec = record(id);
    // always spend the time of one check, so an unknown address cannot be told from a wrong password
    const ok = (await pw.verifyPassword(password, rec && rec.passwordHash ? rec.passwordHash : await pw.dummyHash())) && Boolean(rec && rec.passwordHash);
    if (!ok) {
      const f = recordFail(canon, id, visitorOf(req));
      audit(req, "signin_failed", canon, { method: "password", known: Boolean(id) });
      if (f.until) return lockedReply(res, canon, id, req, "password");
      return bad(res, 401, "bad_login", "That email address or password is not right.");
    }
    clearFails(canon, id);
    if (pw.needsRehash(rec.passwordHash)) {
      const h = await pw.hashPassword(password);
      touch(id, (u) => (u.passwordHash = h));
    }
    startSession(req, res, id, { method: "password", remember: b.remember !== false });
    res.json({ ok: true });
  });

  // "Email me a link" — to choose a password the first time, or to reset a forgotten one
  app.post("/api/auth/email/link", perVisitor(10, 15), async (req, res) => {
    if (needGate(req, res)) return;
    const email = typed((req.body || {}).email);
    if (!EMAIL_RE.test(email)) return bad(res, 400, "invalid", "Enter a valid email address.");
    const canon = canonicalEmail(email);
    const id = identify(email);
    if (!id) return deny(req, res, canon, "link"); // no link is made, nothing is mailed
    if (!mailer.configured()) return bad(res, 503, "email_off", "Email is not set up yet, so a link cannot be sent. Ask the owner.");
    if (mayMail(canon)) {
      audit(req, "link_requested", id.email, {});
      fire(sendLink(req, id), "sign-in link");
    }
    res.json({ ok: true, message: "A link to choose a new password is on its way to your inbox. It works for an hour." });
  });

  // Sign up: ask for access (or, if already allowed, get the link to choose a password)
  app.post("/api/auth/email/signup", perVisitor(8, 60), async (req, res) => {
    if (needGate(req, res)) return;
    const b = req.body || {};
    const email = typed(b.email);
    const name = String(b.name == null ? "" : b.name).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    const note = String(b.note == null ? "" : b.note).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
    if (!name) return bad(res, 400, "invalid", "Please tell us your name.");
    if (!EMAIL_RE.test(email)) return bad(res, 400, "invalid", "Enter a valid email address.");
    if (!mailer.configured()) return bad(res, 503, "email_off", "Email is not set up yet, so sign-up is not open. Ask the owner.");
    const canon = canonicalEmail(email);
    const id = identify(email);
    if (id) {
      // already allowed: this is simply the first-time set-up
      if (mayMail(canon)) {
        audit(req, "link_requested", id.email, { via: "signup" });
        fire(sendLink(req, id), "sign-up link");
      }
    } else {
      const open = store.data.requests || [];
      const fresh = !open.some((r) => canonicalEmail(r.email) === canon);
      if (fresh && open.length >= MAX_REQUESTS) return bad(res, 503, "full", "Too many requests are waiting for the owner just now. Please try again later.");
      store.update((d) => {
        if (!Array.isArray(d.requests)) d.requests = [];
        const at = new Date(now()).toISOString();
        const i = d.requests.findIndex((r) => canonicalEmail(r.email) === canon);
        if (i >= 0) d.requests[i] = { ...d.requests[i], name, note, at };
        else d.requests.push({ id: randomToken(9), email: email.toLowerCase(), name, note, at });
      });
      audit(req, "signup_requested", canon, {});
      if (fresh && mayMail("owner-notify")) {
        const base = trustedOrigin(req);
        const m = message({
          title: "Someone asked for access",
          lines: [`${name} <${email.toLowerCase()}> asked for access to ${BRAND.name}.`, note ? `They wrote: ${note}` : "They left no note.", "Nothing happens until you approve them under Admin users."],
          ...(base ? { button: { label: "Review the request", url: `${base}${ADMIN_BASE}/admins` } } : {}),
        });
        fire(mailer.send({ to: SUPERADMIN_EMAIL, subject: `${BRAND.name}: ${name} asked for access`, ...m }), "request notice");
      }
    }
    res.json({ ok: true, message: "Thank you. If this address already has access, a link to choose a password is on its way. Otherwise your request has gone to the owner, who will reply by email." });
  });

  app.post("/api/auth/email/token", perVisitor(30, 15), (req, res) => {
    const t = checkLink((req.body || {}).token);
    if (!t) return bad(res, 400, "expired", "This link has expired or has already been used. Ask for a new one.");
    res.json({ ok: true, email: maskEmail(t.id.email), hasPassword: Boolean(t.rec.passwordHash), name: t.rec.name || "" });
  });

  function checkLink(token) {
    const p = verify(String(token || ""), linkKey);
    if (!p || p.typ !== "pw" || !p.e || !p.j) return null;
    const id = identify(p.e); // taken off the list since? then the link is dead
    const rec = record(id);
    if (!id || id.email !== p.e || !rec || !rec.linkJti || !safeEqual(rec.linkJti, sha(p.j))) return null;
    return { id, rec };
  }

  app.post("/api/auth/email/password", perVisitor(15, 15), async (req, res) => {
    const b = req.body || {};
    const t = checkLink(b.token);
    if (!t) return bad(res, 400, "expired", "This link has expired or has already been used. Ask for a new one.");
    const password = typeof b.password === "string" ? b.password : "";
    const problem = pw.checkPassword(password, { email: t.id.email, name: t.rec.name });
    if (problem) return bad(res, 400, "weak_password", problem);
    const hash = await pw.hashPassword(password);
    if (!checkLink(b.token)) return bad(res, 400, "expired", "This link has expired or has already been used. Ask for a new one.");
    // finishing the set-up: a first-time person may say how their name should appear
    const name = String(b.name == null ? "" : b.name).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    touch(t.id, (u) => {
      if (name && !t.rec.passwordHash) u.name = name;
      u.passwordHash = hash;
      u.passwordAt = new Date(now()).toISOString();
      u.emailVerifiedAt = u.emailVerifiedAt || u.passwordAt;
      u.linkJti = "";
      u.code = null;
      delete u.fails;
      u.sessionVer = (u.sessionVer || 0) + 1; // signed out everywhere else
    });
    audit(req, "password_set", t.id.email, {});
    fire(noticePasswordChanged(t.id), "password notice");
    res.json({ ok: true });
  });

  async function noticePasswordChanged(id) {
    if (!mailer.configured()) return;
    const m = message({
      title: "Your password was changed",
      lines: ["The password for signing in with your email address was just changed, and every other signed-in device was signed out."],
      fine: "If this was not you, contact the owner at once: an account can be locked from the admin panel.",
    });
    await mailer.send({ to: id.email, subject: `Your ${BRAND.name} password was changed`, ...m });
  }

  // a code by email, instead of a password
  const codeMac = (id, code) => crypto.createHmac("sha256", linkKey).update(`${id.email}:${code}`).digest("hex");

  app.post("/api/auth/email/code", perVisitor(10, 15), async (req, res) => {
    if (needGate(req, res)) return;
    const email = typed((req.body || {}).email);
    if (!EMAIL_RE.test(email)) return bad(res, 400, "invalid", "Enter a valid email address.");
    const canon = canonicalEmail(email);
    const id = identify(email);
    if (!id) return deny(req, res, canon, "code"); // no code is made, nothing is mailed
    if (!methods().code) return bad(res, 403, "disabled", mailer.configured() ? "Signing in with an emailed code is turned off." : "Email is not set up yet, so a code cannot be sent.");
    if (mayMail(canon)) {
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
      touch(id, (u) => (u.code = { h: codeMac(id, code), exp: now() + CODE_TTL_MS, tries: 0 }));
      audit(req, "code_sent", id.email, {});
      const m = message({
        title: `Your sign-in code: ${code}`,
        lines: [`Enter this code to sign in to ${BRAND.name}. It works for 10 minutes and only once.`],
        fine: "If you did not ask for this, ignore this email. Nobody can sign in without the code.",
      });
      fire(mailer.send({ to: id.email, subject: `${code} is your ${BRAND.name} sign-in code`, ...m }), "sign-in code");
    }
    res.json({ ok: true, message: "A 6-digit code is on its way to your inbox. It works for 10 minutes." });
  });

  app.post("/api/auth/email/code/verify", perVisitor(30, 15), async (req, res) => {
    if (needGate(req, res)) return;
    const b = req.body || {};
    const email = typed(b.email);
    const code = String(b.code == null ? "" : b.code).replace(/\s+/g, "");
    if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) return bad(res, 400, "invalid", "Enter the email address and the 6-digit code.");
    const canon = canonicalEmail(email);
    const id = identify(email);
    if (!id) return deny(req, res, canon, "code");
    if (!methods().code) return bad(res, 403, "disabled", "Signing in with an emailed code is turned off.");
    if (lockLeft(canon, id, visitorOf(req))) return lockedReply(res, canon, id, req, "code");
    const rec = record(id);
    const c = rec && rec.code;
    const live = Boolean(c && c.exp > now() && c.tries < CODE_TRIES);
    const same = safeEqual(codeMac(id || { email: canon }, code), (live && c.h) || "0".repeat(64));
    if (!(live && same)) {
      if (id && c) touch(id, (u) => u.code && (u.code.tries += 1));
      const f = recordFail(canon, id, visitorOf(req));
      audit(req, "signin_failed", canon, { method: "code", known: Boolean(id) });
      if (f.until) return lockedReply(res, canon, id, req, "code");
      return bad(res, 401, "bad_code", "That code is not right, or it has expired. Ask for a new one.");
    }
    touch(id, (u) => {
      u.code = null;
      u.emailVerifiedAt = u.emailVerifiedAt || new Date(now()).toISOString();
    });
    clearFails(canon, id);
    startSession(req, res, id, { method: "code", remember: b.remember !== false });
    res.json({ ok: true });
  });

  /* ------------------------------------------------ routes: signed in */
  app.get("/api/auth/account", requireAdmin, (req, res) => {
    const id = identify(req.user.email);
    const u = record(id) || {};
    res.json({
      email: id.email,
      name: u.name || req.user.name || "",
      role: req.user.role,
      hasPassword: Boolean(u.passwordHash),
      passwordAt: u.passwordAt || null,
      googleLinked: Boolean(u.googleAt),
      emailVerified: Boolean(u.emailVerifiedAt),
      lastLogin: u.lastLogin || null,
      methods: methods(),
      canSetPasswordDirectly: !mailer.configured(),
      activity: (store.data.audit || []).filter((a) => canonicalEmail(a.email) === canonicalEmail(id.email)).slice(-12).reverse(),
    });
  });

  app.post("/api/auth/password/change", requireAdmin, perVisitor(10, 15), async (req, res) => {
    const b = req.body || {};
    const id = identify(req.user.email);
    const u = record(id) || {};
    if (!methods().password) return bad(res, 403, "disabled", "Signing in with a password is turned off.");
    if (u.passwordHash) {
      const ok = typeof b.current === "string" && (await pw.verifyPassword(b.current, u.passwordHash));
      if (!ok) {
        audit(req, "password_change_failed", id.email, {});
        return bad(res, 400, "bad_current", "Your current password is not right.");
      }
    } else if (mailer.configured()) {
      // a first password for someone who has only used Google: prove the inbox too (a stolen session must not be enough)
      return bad(res, 409, "use_link", "For safety, choose your first password from the link we email you.");
    }
    const next = typeof b.next === "string" ? b.next : "";
    const problem = pw.checkPassword(next, { email: id.email, name: u.name });
    if (problem) return bad(res, 400, "weak_password", problem);
    const hash = await pw.hashPassword(next);
    touch(id, (x) => {
      x.passwordHash = hash;
      x.passwordAt = new Date(now()).toISOString();
      x.emailVerifiedAt = x.emailVerifiedAt || x.passwordAt;
      x.sessionVer = (x.sessionVer || 0) + 1;
    });
    audit(req, "password_changed", id.email, {});
    fire(noticePasswordChanged(id), "password notice");
    startSession(req, res, id, { method: "password", quiet: true, remember: true }); // this device stays signed in
    res.json({ ok: true });
  });

  app.post("/api/auth/sessions/revoke", requireAdmin, (req, res) => {
    const id = identify(req.user.email);
    touch(id, (x) => (x.sessionVer = (x.sessionVer || 0) + 1));
    audit(req, "signout_everywhere", id.email, {});
    startSession(req, res, id, { method: "session", quiet: true, remember: true });
    res.json({ ok: true });
  });

  /* ------------------------------------------------ routes: the superadmin */
  const view = (req) => {
    const c = mailer.config();
    const origin = trustedOrigin(req);
    return {
      signIn: toggles(store),
      smtp: { host: c.host, port: c.port, security: c.security, user: c.user, passSet: Boolean(c.pass), fromEmail: c.fromEmail, fromName: c.fromName, source: c.source },
      emailReady: mailer.configured(),
      publicUrl: (store.data.settings && store.data.settings.publicUrl) || "",
      publicUrlInUse: origin || "",
      googleReady: Boolean(googleReady()),
      peopleWithPassword: Object.values(store.data.users).filter((u) => u && u.passwordHash).length,
    };
  };

  app.get("/api/admin/settings/email", requireSuper, (req, res) => res.json(view(req)));

  app.put("/api/admin/settings/email", requireSuper, (req, res) => {
    const b = req.body || {};
    // The mail server and the site address carry EVERY sign-in code and reset link — the owner's too. Whoever controls them could
    // receive the owner's code and sign in as the owner, so only the owner may change them (security review, 23 Nov 2026). A
    // superadmin still sees the settings and can send the test message.
    const touchesMail = b.clearSmtp === true || (b.smtp && typeof b.smtp === "object") || typeof b.publicUrl === "string" || (b.signIn && typeof b.signIn === "object");
    if (touchesMail && !(req.user && req.user.owner)) {
      audit(req, "settings_refused", req.user.email, { what: "email & sign-in (owner only)" });
      return bad(res, 403, "owner_only", "Only the owner can change the mail server, the site address or the ways to sign in: they carry everyone's sign-in codes and links.");
    }
    const next = { ...toggles(store) };
    if (b.signIn && typeof b.signIn === "object") for (const k of ["google", "password", "code"]) if (typeof b.signIn[k] === "boolean") next[k] = b.signIn[k];

    let smtp = null;
    let clearSmtp = false;
    if (b.clearSmtp === true) clearSmtp = true;
    else if (b.smtp && typeof b.smtp === "object") {
      const s = b.smtp;
      const host = String(s.host || "").trim().toLowerCase();
      const port = Number(s.port);
      const security = String(s.security || "starttls");
      const fromEmail = String(s.fromEmail || "").trim();
      const fromName = String(s.fromName || "").replace(/[\u0000-\u001f\u007f<>"]/g, " ").trim().slice(0, 80);
      const user = String(s.user || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 254);
      const pass = typeof s.pass === "string" ? s.pass : "";
      if (!SMTP_HOST_RE.test(host)) return bad(res, 400, "invalid", "Enter the mail server's host name, for example smtp.gmail.com.");
      if (!Number.isInteger(port) || port < 1 || port > 65535) return bad(res, 400, "invalid", "The port must be a number from 1 to 65535 (usually 587 or 465).");
      if (!["starttls", "ssl", "none"].includes(security)) return bad(res, 400, "invalid", "Choose STARTTLS, SSL or none for the connection.");
      if (!EMAIL_RE.test(fromEmail)) return bad(res, 400, "invalid", "Enter the address mail is sent from.");
      if (pass.length > 256 || /[\u0000-\u001f\u007f]/.test(pass)) return bad(res, 400, "invalid", "That password cannot be used.");
      const had = Boolean(mailer.config().pass) && Boolean((store.data.settings.smtp || {}).host);
      if (user && !pass && !had) return bad(res, 400, "invalid", "Enter the password for that user name.");
      smtp = { host, port, security, user, fromEmail, fromName, pass };
    }

    // never leave the owner with no way in
    const wouldHave = { google: next.google && Boolean(googleReady()), password: next.password, code: next.code && (clearSmtp ? Boolean(ctx.envMailReady && ctx.envMailReady()) : smtp ? true : mailer.configured()) };
    if (!wouldHave.google && !wouldHave.password && !wouldHave.code) return bad(res, 400, "locked_out", "Keep at least one way to sign in turned on (and working).");

    let publicUrl = (store.data.settings && store.data.settings.publicUrl) || "";
    if (typeof b.publicUrl === "string") {
      const v = b.publicUrl.trim().replace(/\/+$/, "");
      if (v) {
        let u = null;
        try {
          u = new URL(v);
        } catch (_) {
          /* below */
        }
        const local = u && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
        if (!u || (u.protocol !== "https:" && !(u.protocol === "http:" && local)) || u.pathname !== "/" || u.search || u.hash || u.username) return bad(res, 400, "invalid", "The site address must look like https://example.org (no path, and https unless it is localhost).");
        publicUrl = u.origin;
      } else publicUrl = "";
    }
    store.update((d) => {
      d.settings.signIn = next;
      d.settings.publicUrl = publicUrl;
      if (clearSmtp) delete d.settings.smtp;
      else if (smtp) {
        const old = d.settings.smtp || {};
        const { pass, ...rest } = smtp;
        d.settings.smtp = { ...rest, passEnc: pass ? ctx.encrypt(pass) : rest.user ? old.passEnc || "" : "" };
      }
    });
    // the first time mail is set up, links in it point at the address the owner is using right now
    if (!publicUrl && !ctx.envOrigin && smtp) {
      const o = trustedOrigin(req, { owner: true });
      if (o) store.update((d) => (d.settings.publicUrl = o));
    }
    audit(req, "settings_changed", req.user.email, { what: "email & sign-in" });
    log.log(`[settings] Email & sign-in updated by ${req.user.email}`);
    res.json(view(req));
  });

  app.post("/api/admin/settings/email/test", requireSuper, limiter(8, 10 * 60 * 1000), async (req, res) => {
    const to = typed((req.body || {}).to) || req.user.email;
    if (!identify(to)) return bad(res, 400, "invalid", "A test goes only to someone who has access here.");
    if (!mailer.configured()) return bad(res, 400, "email_off", "Save the mail server settings first.");
    try {
      await mailer.send({
        to: identify(to).email,
        subject: `${BRAND.name}: a test message`,
        ...message({ title: "Email is working", lines: [`This is a test from the ${BRAND.name} private area. If you can read it, sign-in links, codes and notices will reach people.`] }),
      });
      audit(req, "test_mail", req.user.email, { to: identify(to).email });
      res.json({ ok: true, to: identify(to).email });
    } catch (err) {
      bad(res, 502, "send_failed", err.message || "The test could not be sent.");
    }
  });

  app.post("/api/admin/settings/email/verify", requireSuper, limiter(8, 10 * 60 * 1000), async (req, res) => {
    try {
      await mailer.verify();
      res.json({ ok: true });
    } catch (err) {
      bad(res, 502, "verify_failed", err.message);
    }
  });

  app.get("/api/admin/auth/audit", requireSuper, (req, res) => {
    const n = Math.min(300, Math.max(1, Number(req.query.limit) || 100));
    res.json({ entries: (store.data.audit || []).slice(-n).reverse() });
  });

  // access requests: the people who asked, waiting for the owner
  const requestRows = () => (store.data.requests || []).map((r) => ({ id: r.id, email: r.email, name: r.name, note: r.note, at: r.at })).reverse();
  app.get("/api/admin/requests", requireSuper, (req, res) => res.json({ requests: requestRows() }));

  app.post("/api/admin/requests/:id/approve", requireSuper, limiter(30, 10 * 60 * 1000), async (req, res) => {
    const r = (store.data.requests || []).find((x) => x.id === req.params.id);
    if (!r) return bad(res, 404, "not_found", "That request is no longer there.");
    let id = identify(r.email);
    store.update((d) => {
      if (!id) d.admins.push({ email: r.email, addedBy: req.user.email, addedAt: new Date(now()).toISOString() });
      d.requests = d.requests.filter((x) => x.id !== r.id);
    });
    id = identify(r.email);
    touch(id, (u) => {
      if (!u.name) u.name = r.name;
    });
    audit(req, "request_approved", id.email, { by: req.user.email });
    let invited = false;
    let inviteProblem = "";
    if (mailer.configured()) {
      try {
        await sendLink(req, id, { invite: true, by: req.user.name || req.user.email });
        invited = true;
      } catch (err) {
        inviteProblem = err.message;
      }
    }
    res.json({ ok: true, invited, inviteProblem, requests: requestRows() });
  });

  app.post("/api/admin/requests/:id/decline", requireSuper, (req, res) => {
    const r = (store.data.requests || []).find((x) => x.id === req.params.id);
    if (!r) return bad(res, 404, "not_found", "That request is no longer there.");
    store.update((d) => {
      d.requests = d.requests.filter((x) => x.id !== r.id);
    });
    audit(req, "request_declined", canonicalEmail(r.email), { by: req.user.email });
    res.json({ ok: true, requests: requestRows() });
  });

  const person = (req, res) => {
    const id = identify(String(req.params.email || ""));
    if (!id) {
      bad(res, 404, "not_found", "No such person.");
      return null;
    }
    // a superadmin the owner made manages the admins; another superadmin's sign-in (and the owner's) is the owner's
    // to touch — and their own, as it is anyone's
    if (id.role === "superadmin" && !req.user.owner && id.email !== req.user.email) {
      bad(res, 403, "forbidden", "Only the owner can do this for a superadmin.");
      return null;
    }
    return id;
  };

  // send a person a link to choose a password (an invitation)
  app.post("/api/admin/admins/:email/link", requireSuper, limiter(20, 10 * 60 * 1000), async (req, res) => {
    const id = person(req, res);
    if (!id) return;
    if (!mailer.configured()) return bad(res, 400, "email_off", "Set up email first (Email & sign-in).");
    try {
      await sendLink(req, id, { invite: true, by: req.user.name || req.user.email });
      audit(req, "invite_sent", id.email, { by: req.user.email });
      res.json({ ok: true });
    } catch (err) {
      bad(res, 502, "send_failed", err.message);
    }
  });

  app.post("/api/admin/admins/:email/signout", requireSuper, (req, res) => {
    const id = person(req, res);
    if (!id) return;
    touch(id, (x) => (x.sessionVer = (x.sessionVer || 0) + 1));
    audit(req, "signout_forced", id.email, { by: req.user.email });
    if (id.email === req.user.email) startSession(req, res, id, { method: "session", quiet: true, remember: true });
    res.json({ ok: true });
  });

  app.post("/api/admin/admins/:email/unlock", requireSuper, (req, res) => {
    const id = person(req, res);
    if (!id) return;
    clearFails(canonicalEmail(id.email), id);
    memFails.delete(canonicalEmail(id.email));
    audit(req, "unlocked", id.email, { by: req.user.email });
    res.json({ ok: true });
  });

  return {
    methods,
    captchaOn: () => Boolean(cap), // the sign-in page shows the security check only when this is on
    toggles: () => toggles(store),
    sendInvite: (req, id, by) => sendLink(req, id, { invite: true, by }),
    isLocked: (id) => lockLeft(canonicalEmail(id.email), id) > 0,
    maskEmail,
  };
}

module.exports = { mountEmailAuth, toggles, message, maskEmail };
