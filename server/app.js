"use strict";
// The API behind /me, plus static hosting of the built site.
//
// Roles
//   superadmin  SUPERADMIN_EMAIL. Everything an admin can do, plus add/remove admins.
//   admin       Anyone the superadmin has added. Full access except admin management.
//   (nobody else can sign in — a valid Google account is not enough on its own.)

const fs = require("fs");
const path = require("path");
const express = require("express");

const { Store } = require("./store");
const { FileDocs } = require("./docs");
const {
  loadKey,
  encrypt,
  decrypt,
  sign,
  verify,
  safeEqual,
  randomToken,
} = require("./crypto");
const {
  ADMIN_BASE,
  isAdminPath,
  SUPERADMIN_EMAIL,
  EMAIL_RE,
  GA_RE,
  CLIENT_ID_RE,
  CLIENT_SECRET_RE,
} = require("./config");
const defaultGoogle = require("./google");
const { HolidayService } = require("./holidays/service");
const { MarketService, MarketError } = require("./market/service");
const { mountMarket } = require("./market/routes");
const { AiService } = require("./ai/service");
const { mountAi } = require("./ai/routes");
const { ResearchAuto } = require("./research-auto");
const { PaperService, PaperError } = require("./paper/service");
const { TradingService } = require("./trading/service");
const { mountTrading } = require("./trading/routes");

const SESSION_COOKIE = "vpt_session";
const OAUTH_COOKIE = "vpt_oauth";
const SESSION_TTL = 7 * 24 * 60 * 60; // seconds
const OAUTH_TTL = 10 * 60;

/* ------------------------------------------------------------- helpers */

function parseCookies(header) {
  const out = {};
  String(header || "")
    .split(";")
    .forEach((part) => {
      const i = part.indexOf("=");
      if (i < 0) return;
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch (_) {
        /* ignore a malformed cookie */
      }
    });
  return out;
}

function cookie(name, value, { maxAge, path: p = "/", secure }) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${p}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Is this request coming from a machine the developer is sitting at?
 * Used so Google Analytics is never switched on while running locally.
 */
function isLocalHost(hostHeader) {
  let h = String(hostHeader || "").toLowerCase();
  h = h.startsWith("[") ? h.slice(0, h.indexOf("]") + 1) : h.replace(/:\d+$/, "");
  if (["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0", ""].includes(h)) return true;
  if (h.endsWith(".localhost") || h.endsWith(".local")) return true;
  const m = h.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/** Tiny in-memory rate limiter: `max` hits per `windowMs`, per client address. */
function limiter(max, windowMs) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || "?";
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) {
      res.status(429).json({ error: "rate_limited", message: "Too many attempts. Try again later." });
      return;
    }
    list.push(now);
    hits.set(key, list);
    if (hits.size > 5000) hits.clear(); // never let it grow without bound
    next();
  };
}

/**
 * A fixed-window counter per client: cheap enough to sit in front of every request.
 * Memory stays bounded (oldest windows are dropped), and the answer to an excess is 429
 * with Retry-After — never a slow reply that would tie the server up.
 */
function budget(max, windowMs) {
  const seen = new Map(); // key → { start, n }
  return (key, now = Date.now()) => {
    let w = seen.get(key);
    if (!w || now - w.start >= windowMs) {
      w = { start: now, n: 0 };
      seen.delete(key);
      seen.set(key, w);
      if (seen.size > 20000) seen.delete(seen.keys().next().value);
    }
    w.n += 1;
    return w.n <= max ? 0 : Math.ceil((w.start + windowMs - now) / 1000);
  };
}

/** Text from a request, made safe for a log line: no CR/LF (log forging), no control characters. */
const logSafe = (x) => String(x == null ? "" : x).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 200);

const normaliseEmail = (e) => String(e || "").trim().toLowerCase();

/* ----------------------------------------------------------------- app */

function createApp(opts = {}) {
  const env = opts.env || process.env;
  const dataDir = opts.dataDir || path.join(__dirname, "data");
  const buildDir = opts.buildDir || path.join(__dirname, "..", "build");
  const makeGoogle = opts.google || defaultGoogle;

  // where records live: MongoDB when the caller opened it (server/index.js with MONGO_URI), files otherwise
  const docs = opts.docs || new FileDocs(dataDir);
  const store = new Store(dataDir, docs);
  // exchange holiday data, kept in step with the exchange's own publication
  const holidays = opts.holidays || new HolidayService({ dir: dataDir, fetchImpl: opts.holidayFetch });
  const settingsKey = loadKey(dataDir, "settings.key", env.SETTINGS_KEY);
  const sessionKey = loadKey(dataDir, "session.key", env.SESSION_SECRET);

  // market data for the Analyzer (Zerodha Kite, read-only). Its API secret and
  // daily token are encrypted with the same key as the Google client secret.
  const market =
    opts.market ||
    new MarketService({
      dir: dataDir,
      store,
      secrets: { encrypt: (t) => encrypt(t, settingsKey), decrypt: (b) => decrypt(b, settingsKey) },
      fetchImpl: opts.marketFetch,
      now: opts.now,
      gaps: opts.marketGaps,
      // a custom fetch means "not the real Zerodha" (tests, simulators): then the real
      // WebSocket must not be used either, unless a stand-in is supplied
      wsImpl: opts.marketWs !== undefined ? opts.marketWs : opts.marketFetch ? null : undefined,
      tickerOptions: opts.tickerOptions,
      // the screener: NSE index lists (RSI search over the Nifty 500), re-read weekly from NSE (not from tests or simulators)
      screenerIndex: opts.screenerIndex || "nse",
      indexFetch: opts.indexFetch !== undefined ? opts.indexFetch : opts.marketFetch ? null : globalThis.fetch,
    });

  // the AI strategist (Anthropic, OpenAI, Gemini, DeepSeek, Moonshot or NVIDIA). Optional: without a key every other feature works as before.
  const ai =
    opts.ai ||
    new AiService({
      dir: dataDir,
      store,
      secrets: { encrypt: (t) => encrypt(t, settingsKey), decrypt: (b) => decrypt(b, settingsKey) },
      market,
      docs,
      fetchImpl: opts.aiFetch,
      now: opts.now,
    });

  // the account and trading (Zerodha). Reads always; writes only while its switch is on.
  // Tests and simulators pass their own fetch: then orders go to the fake, never to Zerodha.
  const trading =
    opts.trading ||
    new TradingService({
      dir: dataDir,
      store,
      market,
      docs,
      fetchImpl: opts.tradingFetch || opts.marketFetch,
      now: opts.now,
      gapMs: opts.marketGaps ? 0 : undefined,
    });

  // the live call mentions the latest world brief when it argues against a trade
  if (market && typeof ai.worldSummary === "function") market.worldProvider = () => ai.worldSummary();

  /* --- Google credentials: the database wins, environment variables fill the gaps */
  function credentials() {
    const s = store.data.settings;
    let secret = "";
    let fromDb = false;
    if (s.googleClientSecretEnc) {
      try {
        secret = decrypt(s.googleClientSecretEnc, settingsKey);
        fromDb = true;
      } catch (_) {
        secret = ""; // key changed or file damaged: treat as not set
      }
    }
    if (s.googleClientId) fromDb = true;
    const id = s.googleClientId || env.GOOGLE_CLIENT_ID || "";
    if (!secret) secret = env.GOOGLE_CLIENT_SECRET || "";
    return { id, secret, source: id && secret ? (fromDb ? "database" : "environment") : "none" };
  }
  const isConfigured = () => {
    const c = credentials();
    return Boolean(c.id && c.secret);
  };

  // First-run guard: until Google is configured, saving credentials needs a
  // one-time token that is only ever printed to the server console.
  let setupToken = isConfigured() ? null : env.SETUP_TOKEN || randomToken(18);

  /* --- who is this? */
  function roleOf(email) {
    const e = normaliseEmail(email);
    if (e === SUPERADMIN_EMAIL) return "superadmin";
    return store.data.admins.some((a) => a.email === e) ? "admin" : null;
  }

  function currentUser(req) {
    const raw = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const p = verify(raw, sessionKey);
    if (!p || !p.email) return null;
    const role = roleOf(p.email); // looked up every time: removing an admin takes effect at once
    if (!role) return null;
    return {
      email: p.email,
      name: String(p.name || ""),
      picture: /^https:\/\//.test(p.picture || "") ? p.picture : "",
      role,
    };
  }

  const origin = (req) =>
    (env.PUBLIC_ORIGIN || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  const redirectUri = (req) => `${origin(req)}/api/auth/google/callback`;
  const isSecure = (req) => req.protocol === "https";

  /* --------------------------------------------------------- express */
  const app = express();
  app.disable("x-powered-by");
  if (env.TRUST_PROXY) app.set("trust proxy", env.TRUST_PROXY === "true" ? 1 : env.TRUST_PROXY);

  // baseline headers on everything
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=(), usb=()",
      "Cross-Origin-Opener-Policy": "same-origin",
      "X-DNS-Prefetch-Control": "off",
    });
    // over HTTPS, the browser is told to use nothing else for a year
    if (isSecure(req)) res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
  });

  // Flood control in front of the API, per client address. Someone who is not signed in gets
  // a small budget (enough to sign in, far too little to hammer the server); a signed-in
  // session gets room for the live pages' polling. The long-lived streams count once.
  // (Behind nginx, TRUST_PROXY makes req.ip the visitor's address, not nginx's.)
  const anonBudget = budget(Number(env.RATE_ANON_PER_MIN) || 90, 60000);
  const userBudget = budget(Number(env.RATE_USER_PER_MIN) || 1500, 60000);
  app.use("/api", (req, res, next) => {
    if (opts.rateLimit === false) return next();
    const signedIn = Boolean(parseCookies(req.headers.cookie)[SESSION_COOKIE]) && Boolean(currentUser(req));
    const wait = (signedIn ? userBudget : anonBudget)(`${signedIn ? "u" : "a"}:${req.ip || "?"}`);
    if (!wait) return next();
    res.set("Retry-After", String(wait));
    res.status(429).json({ error: "rate_limited", message: "Too many requests. Please wait a moment." });
  });

  // the private area and the API: never cached, never indexed, never framed
  app.use((req, res, next) => {
    if (isAdminPath(req.path) || req.path.startsWith("/api/")) {
      res.set({
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
        "X-Frame-Options": "DENY",
      });
    }
    next();
  });

  app.use(express.json({ limit: "10kb" }));

  // a slow API answer is logged with its path, so a sluggish page can be traced to its cause
  app.use("/api", (req, res, next) => {
    const t0 = Date.now();
    res.on("finish", () => {
      const ms = Date.now() - t0;
      if (ms >= 3000 && !/\/stream$/.test(req.path)) console.warn(`[slow] ${logSafe(req.method)} ${logSafe(req.baseUrl + req.path)} took ${(ms / 1000).toFixed(1)} s (${res.statusCode})`);
    });
    next();
  });

  // CSRF: a state-changing request must carry a header a cross-site form cannot
  // set, and, when the browser sends an Origin, it must be this site.
  app.use("/api", (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const o = req.get("origin");
    let sameOrigin = true;
    if (o) {
      try {
        sameOrigin = new URL(o).host === req.get("host");
      } catch (_) {
        sameOrigin = false;
      }
    }
    if (req.get("x-requested-with") !== "vpt" || !sameOrigin) {
      return res.status(403).json({ error: "csrf", message: "Request blocked." });
    }
    next();
  });

  const requireAdmin = (req, res, next) => {
    const u = currentUser(req);
    if (!u) return res.status(401).json({ error: "unauthenticated", message: "Please sign in." });
    req.user = u;
    next();
  };
  const requireSuper = (req, res, next) =>
    requireAdmin(req, res, () => {
      if (req.user.role !== "superadmin") {
        return res.status(403).json({ error: "forbidden", message: "Only the superadmin can do this." });
      }
      next();
    });

  /* ------------------------------------------------------- public API */

  // What the public site needs: the analytics ID (never on a local machine,
  // never for a signed-in admin, so neither pollutes the page counts).
  app.get("/api/public-config", (req, res) => {
    const id = store.data.settings.gaMeasurementId;
    const skip = isLocalHost(req.get("host")) || Boolean(currentUser(req));
    res.json({ ga: id && !skip ? id : null });
  });

  app.get("/api/auth/status", (req, res) => {
    const configured = isConfigured();
    res.json({ configured, needsSetup: !configured, user: currentUser(req) });
  });

  app.get("/api/auth/google/start", limiter(30, 15 * 60 * 1000), (req, res) => {
    const c = credentials();
    if (!c.id || !c.secret) return res.redirect(`${ADMIN_BASE}?error=not-configured`);
    const state = randomToken(18);
    const nonce = randomToken(18);
    res.append(
      "Set-Cookie",
      cookie(OAUTH_COOKIE, sign({ state, nonce }, sessionKey, OAUTH_TTL), {
        maxAge: OAUTH_TTL,
        path: "/api/auth/google",
        secure: isSecure(req),
      })
    );
    res.redirect(makeGoogle(c.id, c.secret, redirectUri(req)).authUrl({ state, nonce }));
  });

  app.get("/api/auth/google/callback", limiter(30, 15 * 60 * 1000), async (req, res) => {
    const clear = cookie(OAUTH_COOKIE, "", { maxAge: 0, path: "/api/auth/google", secure: isSecure(req) });
    const fail = (code) => {
      res.append("Set-Cookie", clear);
      res.redirect(`${ADMIN_BASE}?error=${code}`);
    };

    if (req.query.error) return fail("denied");
    const c = credentials();
    if (!c.id || !c.secret) return fail("not-configured");

    const pending = verify(parseCookies(req.headers.cookie)[OAUTH_COOKIE], sessionKey);
    if (!pending || typeof req.query.state !== "string" || !safeEqual(req.query.state, pending.state)) {
      return fail("state");
    }
    if (typeof req.query.code !== "string") return fail("google");

    let profile;
    try {
      profile = await makeGoogle(c.id, c.secret, redirectUri(req)).exchange(req.query.code);
    } catch (err) {
      console.error("[auth] Google exchange failed:", err.message);
      return fail("google");
    }
    if (!profile.nonce || !safeEqual(profile.nonce, pending.nonce)) return fail("state");
    if (!profile.emailVerified) return fail("unverified");

    const email = normaliseEmail(profile.email);
    if (!roleOf(email)) {
      console.warn(`[auth] sign-in refused for ${email}: not an admin`);
      return fail("unauthorized");
    }

    store.update((d) => {
      d.users[email] = {
        name: profile.name,
        picture: profile.picture,
        lastLogin: new Date().toISOString(),
      };
    });
    res.append(
      "Set-Cookie",
      cookie(
        SESSION_COOKIE,
        sign({ email, name: profile.name, picture: profile.picture }, sessionKey, SESSION_TTL),
        { maxAge: SESSION_TTL, secure: isSecure(req) }
      )
    );
    res.append("Set-Cookie", clear);
    res.redirect(ADMIN_BASE);
  });

  app.post("/api/auth/logout", (req, res) => {
    res.append("Set-Cookie", cookie(SESSION_COOKIE, "", { maxAge: 0, secure: isSecure(req) }));
    res.json({ ok: true });
  });

  /* ---------------------------------------------------- first-run setup */
  app.post("/api/setup", limiter(10, 15 * 60 * 1000), (req, res) => {
    if (!setupToken) {
      return res.status(409).json({ error: "already_configured", message: "Google sign-in is already set up." });
    }
    const b = req.body || {};
    if (!safeEqual(String(b.token || ""), setupToken)) {
      return res.status(403).json({ error: "bad_token", message: "That setup token is not right." });
    }
    const problem = validateGoogle(b.googleClientId, b.googleClientSecret, true);
    if (problem) return res.status(400).json({ error: "invalid", message: problem });
    const ga = String(b.gaMeasurementId || "").trim().toUpperCase();
    if (ga && !GA_RE.test(ga)) {
      return res.status(400).json({ error: "invalid", message: "That Google Analytics ID does not look right (expected G-XXXXXXXXXX)." });
    }
    store.update((d) => {
      d.settings.googleClientId = String(b.googleClientId).trim();
      d.settings.googleClientSecretEnc = encrypt(String(b.googleClientSecret).trim(), settingsKey);
      if (ga) d.settings.gaMeasurementId = ga;
    });
    setupToken = null; // single use
    res.json({ ok: true });
  });

  /* ----------------------------------------------------- admin: settings */
  function validateGoogle(clientId, clientSecret, secretRequired) {
    if (!CLIENT_ID_RE.test(String(clientId || "").trim())) {
      return "The Client ID should end in .apps.googleusercontent.com.";
    }
    const s = String(clientSecret || "").trim();
    if (secretRequired || s) {
      if (!CLIENT_SECRET_RE.test(s)) return "The Client Secret looks wrong (8–200 characters, no spaces).";
    }
    return null;
  }

  app.get("/api/admin/settings", requireAdmin, (req, res) => {
    const c = credentials();
    res.json({
      googleClientId: c.id,
      googleSecretSet: Boolean(c.secret), // the secret itself is never sent to a browser
      googleSource: c.source,
      gaMeasurementId: store.data.settings.gaMeasurementId || "",
    });
  });

  app.put("/api/admin/settings/google", requireAdmin, (req, res) => {
    const b = req.body || {};
    const hadSecret = Boolean(credentials().secret);
    const newSecret = String(b.googleClientSecret || "").trim();
    const problem = validateGoogle(b.googleClientId, newSecret, !hadSecret);
    if (problem) return res.status(400).json({ error: "invalid", message: problem });
    store.update((d) => {
      d.settings.googleClientId = String(b.googleClientId).trim();
      if (newSecret) d.settings.googleClientSecretEnc = encrypt(newSecret, settingsKey);
    });
    console.log(`[settings] Google credentials updated by ${req.user.email}`);
    res.json({ ok: true });
  });

  app.put("/api/admin/settings/analytics", requireAdmin, (req, res) => {
    const id = String((req.body || {}).gaMeasurementId || "").trim().toUpperCase();
    if (id && !GA_RE.test(id)) {
      return res.status(400).json({ error: "invalid", message: "That does not look like a GA4 measurement ID (G-XXXXXXXXXX)." });
    }
    store.update((d) => {
      d.settings.gaMeasurementId = id;
    });
    console.log(`[settings] Analytics ID ${id ? "set" : "cleared"} by ${req.user.email}`);
    res.json({ ok: true, gaMeasurementId: id });
  });

  /* ------------------------------------------------ stock report: holidays */
  // The official copies the server has fetched, and when each source was last checked.
  app.get("/api/admin/stock/holidays", requireAdmin, (req, res) => res.json(holidays.snapshot()));

  // "Check now". Limited per client, and the service itself refuses to ask the
  // exchange more than once a minute.
  app.post("/api/admin/stock/holidays/refresh", requireAdmin, limiter(6, 10 * 60 * 1000), async (req, res) => {
    res.json(await holidays.refresh());
  });

  /* ------------------------------------------- superadmin: admin users */
  const adminRows = () => [
    {
      email: SUPERADMIN_EMAIL,
      role: "superadmin",
      locked: true,
      lastLogin: (store.data.users[SUPERADMIN_EMAIL] || {}).lastLogin || null,
    },
    ...store.data.admins.map((a) => ({
      email: a.email,
      role: "admin",
      locked: false,
      addedBy: a.addedBy,
      addedAt: a.addedAt,
      lastLogin: (store.data.users[a.email] || {}).lastLogin || null,
    })),
  ];

  app.get("/api/admin/admins", requireSuper, (req, res) => res.json({ admins: adminRows() }));

  app.post("/api/admin/admins", requireSuper, (req, res) => {
    const email = normaliseEmail((req.body || {}).email);
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return res.status(400).json({ error: "invalid", message: "Enter a valid email address." });
    }
    if (email === SUPERADMIN_EMAIL) {
      return res.status(400).json({ error: "invalid", message: "That is the superadmin — it already has full access." });
    }
    if (store.data.admins.some((a) => a.email === email)) {
      return res.status(409).json({ error: "exists", message: "That person is already an admin." });
    }
    store.update((d) => {
      d.admins.push({ email, addedBy: req.user.email, addedAt: new Date().toISOString() });
    });
    res.status(201).json({ admins: adminRows() });
  });

  app.delete("/api/admin/admins/:email", requireSuper, (req, res) => {
    const email = normaliseEmail(req.params.email);
    if (email === SUPERADMIN_EMAIL) {
      return res.status(400).json({ error: "locked", message: "The superadmin cannot be removed." });
    }
    if (!store.data.admins.some((a) => a.email === email)) {
      return res.status(404).json({ error: "not_found", message: "No such admin." });
    }
    store.update((d) => {
      d.admins = d.admins.filter((a) => a.email !== email);
    });
    res.json({ admins: adminRows() });
  });

  /* ------------------------------------------- stock report: the AI strategist */
  mountAi(app, { ai, requireAdmin, limiter });

  // research that runs by itself before the open and after the close (server/research-auto.js)
  const researchAuto = new ResearchAuto({ ai, market, docs: store.docs, now: opts.now, log: opts.log || console });
  if (opts.researchAuto !== false) researchAuto.start();
  // paper trading: the live call followed with play money. A separate system: it reads prices only,
  // and is not connected to the trading service or its switch in any way.
  const paper = opts.paper || new PaperService({ market, playbook: ai.playbook, docs: store.docs, now: opts.now, log: opts.log || console });
  if (opts.paperAuto !== false) paper.start();
  const paperWrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      if (err instanceof PaperError || err instanceof MarketError) return res.status(err.status || 400).json({ error: err.code, message: err.message });
      res.status(500).json({ error: "paper_failed", message: err && err.message ? err.message : "Paper trading failed." });
    }
  };
  app.get("/api/admin/paper", requireAdmin, paperWrap(async () => paper.status()));
  app.put("/api/admin/paper/settings", requireAdmin, paperWrap(async (req) => {
    const b = req.body || {};
    return paper.setSettings({ capital: b.capital, riskPct: b.riskPct, costPct: b.costPct, sessions: b.sessions }, b.symbols);
  }));
  app.put("/api/admin/paper/auto", requireAdmin, paperWrap(async (req) => paper.setAuto(Boolean((req.body || {}).on))));
  app.post("/api/admin/paper/history", requireAdmin, limiter(20, 60 * 60 * 1000), paperWrap(async () => paper.startHistory({ by: "manual" })));
  app.post("/api/admin/paper/live", requireAdmin, limiter(60, 60 * 60 * 1000), paperWrap(async () => {
    await paper.liveStep({ force: true });
    return paper.status();
  }));
  app.post("/api/admin/paper/reset", requireAdmin, paperWrap(async () => paper.reset()));

  app.get("/api/admin/research/auto", requireAdmin, (req, res) => res.json(researchAuto.status()));
  app.put("/api/admin/research/auto", requireSuper, (req, res) => {
    const b = req.body || {};
    res.json(researchAuto.set({ enabled: typeof b.enabled === "boolean" ? b.enabled : undefined, withAi: typeof b.withAi === "boolean" ? b.withAi : undefined }));
  });

  /* ------------------------------------------- stock report: the account and trading */
  mountTrading(app, { trading, ai, requireSuper, limiter });

  /* ------------------------------------------- stock report: the analyzer */
  mountMarket(app, {
    market,
    requireAdmin,
    limiter,
    currentUser,
    origin,
    adminBase: ADMIN_BASE,
    helpers: { cookie, parseCookies, sign, verify, safeEqual, randomToken, sessionKey, isSecure },
  });

  app.use("/api", (req, res) => res.status(404).json({ error: "not_found" }));

  /* --------------------------------------------- the built site, if any */
  const indexFile = path.join(buildDir, "index.html");
  if (fs.existsSync(indexFile)) {
    // host-config files that ship inside build/ are for Netlify/Cloudflare, not visitors
    app.use((req, res, next) =>
      ["/_headers", "/_redirects"].includes(req.path) ? res.status(404).end() : next()
    );
    app.use(
      express.static(buildDir, {
        index: false,
        setHeaders(res, file) {
          const hashed = file.includes(`${path.sep}static${path.sep}`);
          res.set("Cache-Control", hashed ? "public, max-age=31536000, immutable" : "public, max-age=3600");
          // The static-file library is older than the AVIF format and would send such a file as a
          // nameless download — which a browser told not to guess types (nosniff, above) may refuse
          // to draw as a picture.
          if (/\.avif$/i.test(file)) res.set("Content-Type", "image/avif");
        },
      })
    );
    // the private area gets a bare shell (see scripts/prerender.js); any other
    // path is the single-page app, which sends unknown URLs to "/"
    const adminFile = path.join(buildDir, "admin.html");
    app.get("*", (req, res) =>
      res.sendFile(isAdminPath(req.path) && fs.existsSync(adminFile) ? adminFile : indexFile)
    );
  } else {
    app.get("/", (req, res) =>
      res.type("text").send("API is running. The site has not been built yet — run `npm run build`, or use `npm start` for development.")
    );
  }

  // JSON errors from the body parser etc.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error("[server]", err);
    res.status(status).json({ error: status === 400 ? "bad_request" : "server_error", message: status === 400 ? "Bad request." : "Something went wrong." });
  });

  return {
    app,
    store,
    holidays,
    market,
    ai,
    get setupToken() {
      return setupToken;
    },
  };
}

module.exports = {
  budget,
  logSafe, createApp, isLocalHost, SESSION_COOKIE };
