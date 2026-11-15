"use strict";
const { BRAND } = require("./brand");
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
const { DayAnalysis } = require("./analysis/service");
const { mountAnalysis } = require("./analysis/routes");
const { Temple, mountTemple } = require("./temple");
const { Notifier, mountNotify } = require("./notify");
const { AlertWatch } = require("./alert-watch");
const { DisciplineWatch } = require("./discipline-watch");
const { GlobalFeed } = require("./market/global");
const { SocialService } = require("./social/service");
const { previewFor, previewTags, injectPreview } = require("./previews");
const { readingOf: socialReading } = require("./social/extract");
const { SocialWatch } = require("./social-watch");
const { FlightDeck, FlightError } = require("./flight");
const { JournalCapture } = require("./journal-capture");
const { WhatsAppService, mountWhatsApp } = require("./whatsapp");
const { buildHealth } = require("./health");
const { chargeParts } = require("./trading/journal");
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

  // overseas indices (US, Europe, Japan, Singapore, Hong Kong, Korea, China) from the owner's own
  // Financial Modeling Prep key, kept encrypted like the other secrets (server/market/global.js)
  if (!market.global) market.global = opts.globalFeed || new GlobalFeed({ docs: store.docs, secrets: { encrypt: (t) => encrypt(t, settingsKey), decrypt: (b) => decrypt(b, settingsKey) }, fetchImpl: opts.globalFetch || globalThis.fetch, now: opts.now });

  // the AI (one default model for every feature: Claude Sonnet 5.5 unless the owner picks another of Anthropic,
  // OpenAI, Gemini, DeepSeek or Moonshot). Optional: without a key every other feature works as before.
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

  // What AI Live and AI Research may know about the trader, READ-ONLY: this stock's position and the
  // available margin. Nothing here places, changes or cancels anything; a failure is simply "not known".
  let accountRead = null; // shared for 15 seconds: the page's pulse asks every 20, for every stock it opens
  ai.ensemble.account = async (symbol) => {
    try {
      const nowMs = Date.now();
      if (!accountRead || nowMs - accountRead.at > 15000) accountRead = { at: nowMs, ask: Promise.all([trading.funds(), trading.positions()]) };
      const [f, p] = await accountRead.ask;
      const row = ((p && p.net) || []).find((x) => x.symbol === symbol && Number(x.quantity) !== 0) || null;
      const eq = f && f.equity && f.equity.available ? f.equity.available : null;
      const available = eq ? (Number.isFinite(eq.live) ? eq.live : eq.cash) : null;
      return { position: row ? { quantity: row.quantity, average: row.average, product: row.product, pnl: row.pnl } : null, funds: { available: Number.isFinite(available) ? available : null, net: f && f.equity ? f.equity.net : null } };
    } catch (_) {
      return null;
    }
  };

  // Trade Analysis: one report per trading day, saved by itself at 3:45 PM IST and editable by hand.
  // It reads the owner's own closed trades, margin and positions through this narrow door — read-only.
  const istDay = (ms) => new Date(ms + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const analysis =
    opts.analysis ||
    new DayAnalysis({
      docs: store.docs,
      ai,
      now: opts.now,
      log: opts.log || console,
      source: {
        async closedTrips(date) {
          // Zerodha only ever returns today's trades: bring them into the journal first, when connected
          if (market.kiteAuth()) {
            try {
              trading.journal.ingestKite(await trading.trades());
            } catch (_) {
              /* the stored journal still holds the earlier fills */
            }
          }
          return trading.journal
            .trips({})
            .filter((t) => !t.open && t.exitAt && istDay(t.exitAt) === date)
            .map((t) => ({ ...t, parts: chargeParts(t) }));
        },
        // that day's 1-minute bars, for the Execution Lab's replay
        minuteBars: (symbol, fromMs, toMs) => market.minuteBarsBetween(symbol, fromMs, toMs),
        // the daily goal's percentages (target and stop), for the lab's "after the stop / target" flags
        discipline: () => trading._discipline(),
        // the days that have closed trades in the journal (for saving the days that were missed)
        daysWithTrips(fromDate, toDate) {
          const set = new Set();
          for (const t of trading.journal.trips({})) {
            if (t.open || !t.exitAt) continue;
            const d = istDay(t.exitAt);
            if (d >= fromDate && d <= toDate) set.add(d);
          }
          return [...set].sort();
        },
        async funds() {
          const f = await trading.funds();
          return f && f.equity ? f.equity : null;
        },
        async positions() {
          const p = await trading.positions();
          return ((p && p.net) || []).filter((x) => Number(x.quantity) !== 0).map((x) => ({ symbol: x.symbol, quantity: x.quantity, product: x.product }));
        },
        async market() {
          const q = await market.quotes(["NIFTY 50"]);
          const n = q && q.quotes ? q.quotes["NIFTY 50"] : null;
          return n && Number.isFinite(n.changePct) ? { niftyChangePct: n.changePct } : null;
        },
      },
    });
  if (opts.analysisAuto !== false) analysis.start();
  // a tradebook import: the Day book saves the new days, and the lab replays the recent ones, at once (not on the next hourly sweep)
  trading.onJournalImport = async () => {
    for (let i = 0; i < 25; i += 1) if (!(await analysis.backfill()).length) break; // 20 days a round, until none is missing
    await analysis.labBackfill({ max: 10 });
  };
  // figures are no longer entered by hand: days edited by hand in an earlier version are rebuilt from the journal once
  if (typeof analysis.dropHandFigures === "function") analysis.dropHandFigures().catch((err) => (opts.log || console).error(`[analysis] ${err.message}`));

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
  // pm2 and .env give every value as text. Express reads the TEXT "1" as an address list, not
  // as "one proxy hop", so "true" and a plain number are turned into numbers here.
  if (env.TRUST_PROXY) {
    const hops = String(env.TRUST_PROXY).trim();
    app.set("trust proxy", hops === "true" ? 1 : /^\d+$/.test(hops) ? Number(hops) : env.TRUST_PROXY);
  }

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

  // WhatsApp Cloud API webhook (server/whatsapp.js): Meta calls it with every message to the bot.
  // It needs the raw body for the signature check, so it sits before the JSON parser and the CSRF
  // rule (Meta cannot send our header). A wrong signature is refused; only the owner's number is
  // ever answered.
  let whatsappRef = null;
  const waLimit = limiter(120, 60 * 1000);
  app.get("/api/whatsapp/webhook", waLimit, (req, res) => {
    const c = whatsappRef ? whatsappRef.verify(req.query || {}) : null;
    if (!c) return res.status(403).type("text/plain").send("forbidden");
    res.type("text/plain").send(c);
  });
  app.post("/api/whatsapp/webhook", waLimit, express.raw({ type: () => true, limit: "512kb" }), (req, res) => {
    if (!whatsappRef || !Buffer.isBuffer(req.body) || !whatsappRef.signed(req.body, req.get("x-hub-signature-256"))) return res.status(401).end();
    let body;
    try {
      body = JSON.parse(req.body.toString("utf8"));
    } catch (_) {
      return res.status(400).end();
    }
    res.status(200).end(); // Meta wants a quick 200; the reply goes out as a new message
    whatsappRef.receive(body).catch((err) => console.warn(`[whatsapp] ${logSafe(err && err.message)}`));
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
  mountAi(app, { ai, requireAdmin, requireSuper, limiter });
  mountAnalysis(app, { analysis, requireSuper, limiter });

  /* ------------------------------------------------ the Mandir (devotional audio) */
  const temple = opts.temple || new Temple({ docs, dir: dataDir });
  mountTemple(app, { temple, requireAdmin, requireSuper, limiter });

  /* ------------------------------------------------ messages to the owner's phone (Telegram) */
  const notifier = opts.notifier || new Notifier({ docs, secrets: { encrypt: (t) => encrypt(t, settingsKey), decrypt: (b) => decrypt(b, settingsKey) }, fetchImpl: opts.notifyFetch || globalThis.fetch, now: opts.now, log: opts.log || console });
  mountNotify(app, { notifier, requireSuper, limiter });
  const inr = (x) => `${x < 0 ? "−" : x > 0 ? "+" : ""}₹${Math.abs(Math.round(x)).toLocaleString("en-IN")}`;
  trading.onLock = (lock) => notifier.send(`🛑 Risk guard locked the day: ${lock.reason}
New trades are refused until tomorrow; exits and cancels still work. (${BRAND.name})`, "risk");
  analysis.onReport = (d) => {
    const s = d.summary || {};
    return notifier.send(`📒 Trade Analysis · ${d.date}
Net ${inr(s.net || 0)} · profit ${inr(s.grossProfit || 0)} · loss ${inr(-(s.grossLoss || 0))} · charges ${inr(-((s.charges && s.charges.total) || 0))}
${s.trades || 0} trades, ${s.wins || 0} won · process score ${d.score === null || d.score === undefined ? "—" : d.score}
(${BRAND.name})`, "dayReport");
  };
  // price alerts checked on the server every 15 s in market hours, even with no page open
  const alertWatch = opts.alertWatchService || new AlertWatch({ market, notifier, now: opts.now, log: opts.log || console });
  if (opts.alertWatch !== false) alertWatch.start();
  app.get("/api/admin/market/alerts/watch", requireAdmin, (req, res) => res.json(alertWatch.status()));
  // the daily goal (target, stop, profit protection): reminders every 15 s in market hours, even with
  // no page open, to Telegram / WhatsApp when set up — reminders only, it never trades
  trading.onDiscipline = (e) => notifier.send(`${e.level === "danger" ? "🛑" : e.level === "success" ? "🎯" : "⚠️"} ${e.title}
${e.text}
(${BRAND.name} · a reminder — nothing was traded)`, "risk");
  const disciplineWatch = opts.disciplineWatchService || new DisciplineWatch({ trading, now: opts.now, log: opts.log || console });
  if (opts.disciplineWatch !== false && opts.alertWatch !== false) disciplineWatch.start();
  app.get("/api/admin/trading/discipline/watch", requireAdmin, (req, res) => res.json(disciplineWatch.status()));

  // overseas markets: the feed's state and its numbers; the key is written by the superadmin only and never read back
  const gWrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      res.status(err.status || 400).json({ error: err.code || "global_failed", message: err.message || "The overseas feed failed." });
    }
  };
  app.get("/api/admin/market/global", requireAdmin, limiter(120, 60 * 1000), gWrap(async () => ({ feed: market.global.status(), quotes: await market.global.quotes() })));
  app.post("/api/admin/market/global/refresh", requireAdmin, limiter(20, 60 * 60 * 1000), gWrap(async () => ({ feed: market.global.status(), quotes: await market.global.quotes({ refresh: true }) })));
  app.put("/api/admin/market/global/key", requireSuper, limiter(20, 60 * 60 * 1000), gWrap(async (req) => ({ feed: market.global.setKey(req.body || {}) })));

  /* ------------------------------------------------ Social Media (server/social/) */
  // the aggregator: news sites, Google News, X, YouTube, Reddit and NSE announcements, organised for
  // trading by the rules and the default AI model; its signal goes to the forecast, plans and TradeAI.
  // Official access only (RSS, X's API with the owner's token); it never logs in or posts.
  const social =
    opts.socialService ||
    new SocialService({ docs: store.docs, secrets: { encrypt: (t) => encrypt(t, settingsKey), decrypt: (b) => decrypt(b, settingsKey) }, fetchImpl: opts.socialFetch || globalThis.fetch, now: opts.now, market, ai, log: opts.log || console });
  market.social = social;
  // the open positions' symbols (for which items need the AI, and for the news alerts), read at most once a minute
  let posCache = { at: 0, list: [] };
  const openSymbols = async () => {
    const t = opts.now ? opts.now() : Date.now();
    if (t - posCache.at < 60000) return posCache.list;
    let list = [];
    try {
      if (trading.status().connected) list = (await trading.positions()).net.filter((p) => p.quantity !== 0).map((p) => p.symbol);
    } catch (_) {
      list = [];
    }
    posCache = { at: t, list };
    return list;
  };
  social.focusSymbols = openSymbols;

  // LISTENER: a high-impact item about an open position or a tracked stock (or any market-moving item
  // about an open position) goes to Telegram / WhatsApp at once — at most one per stock every 30
  // minutes and 12 a day, only items from the last two hours, and only while "Alert me" is on.
  const newsSent = new Map(); // symbol → time sent
  let newsDay = { date: "", n: 0 };
  social.on("items", async (items) => {
    try {
      const st = social.settings();
      if (!st.alertMe) return;
      const t = opts.now ? opts.now() : Date.now();
      const date = new Date(t + 5.5 * 3600000).toISOString().slice(0, 10);
      if (newsDay.date !== date) newsDay = { date, n: 0 };
      const pos = new Set(await openSymbols());
      const focus = new Set([...st.watch, ...pos]);
      for (const it of items) {
        if (newsDay.n >= 12) break;
        const r = socialReading(it);
        if (!r.relevant || t - Date.parse(it.at || it.seenAt) > 2 * 3600000) continue;
        const hits = r.symbols.filter((x) => focus.has(x) && t - (newsSent.get(x) || 0) > 30 * 60000);
        if (!hits.length) continue;
        if (!(r.impact === "high" || (r.impact === "medium" && hits.some((x) => pos.has(x))))) continue;
        hits.forEach((x) => newsSent.set(x, t));
        newsDay.n += 1;
        const tone = r.sentiment >= 0.2 ? "🟢" : r.sentiment <= -0.2 ? "🔴" : "⚪";
        notifier.send(`📰 ${tone} ${hits.join(", ")}${hits.some((x) => pos.has(x)) ? " (you hold it)" : ""} — ${r.impact}-impact news\n${it.title}\n${it.sourceLabel}${it.link ? ` · ${it.link}` : ""}\n(${BRAND.name} · a news alert — nothing was traded)`, "alerts");
      }
    } catch (_) {
      /* an alert is a convenience: it never stops the feed */
    }
  });

  // LISTENER: the Social Media page's live stream — a pushed note the moment new items are kept or
  // organised, so the page reads them at once (Server-Sent Events; the page falls back to polling)
  const streams = new Set();
  const push = (event, data) => {
    for (const res of streams) {
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch (_) {
        streams.delete(res);
      }
    }
  };
  social.on("items", (items) => push("items", { count: items.length, at: new Date().toISOString() }));
  social.on("organised", (x) => push("organised", x));
  const beat = setInterval(() => push("ping", { at: new Date().toISOString() }), 25000);
  if (beat.unref) beat.unref();
  app.get("/api/admin/social/stream", requireAdmin, (req, res) => {
    if (streams.size >= 20) return res.status(429).json({ error: "busy", message: "Too many open live streams." });
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders && res.flushHeaders();
    res.write(`event: hello\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    streams.add(res);
    req.on("close", () => streams.delete(res));
  });
  const socialWatch = opts.socialWatchService || new SocialWatch({ social, now: opts.now, log: opts.log || console });
  // the watcher reads real feeds: never under the test runner, unless a test hands it a fake fetch
  const underTest = Boolean(process.env.NODE_TEST_CONTEXT) && !opts.socialFetch;
  if (opts.socialWatch !== false && opts.alertWatch !== false && !underTest) socialWatch.start();
  const sWrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      res.status(err.status || 400).json({ error: err.code || "social_failed", message: err.message || "Social Media failed." });
    }
  };
  const sq = (req) => req.query || {};
  app.get("/api/admin/social", requireAdmin, limiter(240, 60 * 1000), sWrap(async () => ({ settings: social.settings(), status: social.status(), watch: socialWatch.status() })));
  app.get("/api/admin/social/feed", requireAdmin, limiter(240, 60 * 1000), sWrap(async (req) => social.feed({ since: String(sq(req).since || ""), limit: Number(sq(req).limit) || 80, type: String(sq(req).type || ""), sector: String(sq(req).sector || ""), relevant: sq(req).relevant === "1", symbol: String(sq(req).symbol || ""), q: String(sq(req).q || "").slice(0, 80) })));
  app.get("/api/admin/social/digest", requireAdmin, limiter(120, 60 * 1000), sWrap(async (req) => social.digest({ hours: Number(sq(req).hours) || 24 })));
  app.get("/api/admin/social/symbol/:symbol", requireAdmin, limiter(120, 60 * 1000), sWrap(async (req) => ({ symbol: String(req.params.symbol || "").toUpperCase(), news: social.forSymbol(req.params.symbol) })));
  app.post("/api/admin/social/refresh", requireAdmin, limiter(20, 10 * 60 * 1000), sWrap(async () => {
    const polled = await social.poll({ force: true });
    const read = await social.process();
    return { polled, ai: { read: read.read, batches: read.batches }, status: social.status(), settings: social.settings() };
  }));
  app.post("/api/admin/social/brief", requireAdmin, limiter(10, 10 * 60 * 1000), sWrap(async () => ({ brief: await social.brief({ refresh: true }) })));
  app.put("/api/admin/social/settings", requireSuper, limiter(60, 10 * 60 * 1000), sWrap(async (req) => ({ settings: social.setSettings(req.body || {}) })));
  app.post("/api/admin/social/sources", requireSuper, limiter(60, 10 * 60 * 1000), sWrap(async (req) => ({ settings: social.addSource(req.body || {}) })));
  app.put("/api/admin/social/sources/:id", requireSuper, limiter(120, 10 * 60 * 1000), sWrap(async (req) => ({ settings: social.updateSource(String(req.params.id), req.body || {}) })));
  app.delete("/api/admin/social/sources/:id", requireSuper, limiter(60, 10 * 60 * 1000), sWrap(async (req) => ({ settings: social.removeSource(String(req.params.id)) })));
  // the X API Bearer Token: written by the superadmin only, never read back (only "set" or not)
  app.put("/api/admin/social/creds", requireSuper, limiter(20, 60 * 60 * 1000), sWrap(async (req) => {
    const out = social.setCreds(req.body || {});
    console.log(`[social] X token ${(req.body || {}).remove === "x" ? "removed" : "saved"}`);
    return { settings: out };
  }));

  /* ------------------------------------------------ the flight deck (server/flight.js) */
  // every open position watched tick by tick by the exit coach, pushed to the Execution Lab's Live
  // board, and recorded (the CCTV). It reads the account and the market; it cannot place an order.
  const flight =
    opts.flightDeck ||
    new FlightDeck({ trading, market, ai, docs: store.docs, notifier, goal: () => (disciplineWatch.status().state || null), now: opts.now, log: opts.log || console });
  if (opts.flightWatch !== false && opts.alertWatch !== false) flight.start();
  const fWrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      if (!(err instanceof FlightError)) console.error("[flight]", err && err.message ? err.message : err);
      res.status(err.status || 500).json({ error: err.code || "flight_failed", message: err.message || "The flight deck failed." });
    }
  };
  app.get("/api/admin/flight", requireSuper, limiter(240, 60 * 1000), fWrap(async () => flight.board()));
  app.post("/api/admin/flight/sync", requireSuper, limiter(60, 60 * 1000), fWrap(async () => flight.sync()));
  app.post("/api/admin/flight/ai", requireSuper, limiter(40, 10 * 60 * 1000), fWrap(async (req) => ({ opinion: await flight.askAi(String((req.body || {}).key || "")), settings: flight.settings() })));
  app.get("/api/admin/flight/settings", requireSuper, fWrap(async () => flight.settings()));
  app.put("/api/admin/flight/settings", requireSuper, limiter(40, 10 * 60 * 1000), fWrap(async (req) => flight.setSettings(req.body || {})));
  app.get("/api/admin/flight/days", requireSuper, fWrap(async () => ({ days: flight.days() })));
  // the AI Engine researches one position's exit levels (chosen from the desk's level map, checked before they are shown)
  app.post("/api/admin/flight/levels", requireSuper, limiter(30, 10 * 60 * 1000), fWrap(async (req) => ({ levels: await flight.researchLevels(String((req.body || {}).key || "")), settings: flight.settings(), record: flight.levelsRecord() })));
  app.get("/api/admin/flight/day/:date", requireSuper, limiter(60, 60 * 1000), fWrap(async (req) => {
    await flight.settleLevels(req.params.date).catch(() => {}); // a finished day's AI levels are scored on its bars the first time it is opened
    return flight.day(req.params.date);
  }));
  // the Live board's stream: the whole board on connecting, then every look at every open position
  // as it happens (Server-Sent Events; at most four a second per position)
  const boards = new Set();
  const fPush = (event, data) => {
    for (const res of boards) {
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch (_) {
        boards.delete(res);
      }
    }
  };
  flight.on("pos", (v) => boards.size && fPush("pos", v));
  flight.on("board", (b) => boards.size && fPush("board", b));
  const fBeat = setInterval(() => boards.size && fPush("board", flight.board()), 15000); // the paths, frames and events, and a heartbeat
  if (fBeat.unref) fBeat.unref();
  app.get("/api/admin/flight/stream", requireSuper, (req, res) => {
    if (boards.size >= 10) return res.status(429).json({ error: "busy", message: "Too many open Live boards." });
    res.set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders && res.flushHeaders();
    res.write("retry: 2000\n\n");
    res.write(`event: board\ndata: ${JSON.stringify(flight.board())}\n\n`);
    boards.add(res);
    flight.sync().catch(() => {}); // a page just opened: read the positions now rather than at the next round
    req.on("close", () => boards.delete(res));
  });

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
  // the journal reads today's trades from Kite by itself (Kite keeps only the current day's)
  const journalCapture = opts.journalCaptureService || new JournalCapture({ trading, market, now: opts.now, log: opts.log || console });
  if (opts.journalCapture !== false) journalCapture.start();
  mountTrading(app, { trading, ai, requireSuper, limiter, capture: journalCapture });

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

  /* ------------------------------------------------ WhatsApp Trading (server/whatsapp.js) */
  const whatsapp = opts.whatsapp || new WhatsAppService({ docs, secrets: { encrypt: (t) => encrypt(t, settingsKey), decrypt: (b) => decrypt(b, settingsKey) }, fetchImpl: opts.whatsappFetch || globalThis.fetch, now: opts.now, log: opts.log || console, market, trading, ai, analysis });
  whatsappRef = whatsapp;
  mountWhatsApp(app, { whatsapp, requireSuper, limiter });
  if (opts.whatsappAuto !== false) whatsapp.start();
  // price alerts, the risk-guard lock and the 3:45 PM report go to WhatsApp as well as Telegram
  notifier.also = (text, kind) => (kind === "alerts" || kind === "risk" || kind === "dayReport" ? whatsapp.send(text, { kind }) : null);

  /* ------------------------------------------------ TradeAI (server/ai/tradeai.js) */
  // the chat reads the account through these read-only functions (the AI folder cannot load the broker)
  ai.tradeai.account = {
    positions: async () => (await trading.positions()).net,
    funds: () => trading.funds(),
    history: async () => {
      const days = analysis.list({}).slice(0, 31);
      const sum = (f) => days.reduce((s, d) => s + (f(d.summary || {}) || 0), 0);
      let journal = null;
      try {
        const st = trading.journal.view({ from: (opts.now ? opts.now() : Date.now()) - 92 * 86400000 }).stats;
        journal = { trades: st.trades, winRate: st.winRate, net: st.net, profitFactor: st.profitFactor, expectancy: st.expectancy, maxDrawdown: st.maxDrawdown, byHour: (st.by.hour || []).slice(0, 8), mistakes: (st.by.mistake || []).slice(0, 6) };
      } catch (_) {
        journal = null;
      }
      return { last30: { days: days.length, net: sum((s) => s.net), profit: sum((s) => s.grossProfit), loss: sum((s) => s.grossLoss), charges: sum((s) => s.charges && s.charges.total), trades: sum((s) => s.trades) }, recentDays: days.slice(0, 7).map((d) => ({ date: d.date, net: d.summary && d.summary.net, trades: d.summary && d.summary.trades, score: d.score })), journal3m: journal };
    },
    // the daily goal: today's P&L against the target and stop, and the giveback guard (read-only)
    goal: () => trading.disciplineStatus(),
    // for the suggested questions: orders still waiting, and today's closed round trips
    orders: async () => (await trading.orders()).filter((o) => /^(OPEN|TRIGGER PENDING|AMO REQ RECEIVED)$/.test(o.status)).map((o) => ({ symbol: o.symbol, side: o.side, quantity: o.quantity, price: o.price || o.trigger || 0, type: o.type })),
    today: async () => {
      const now = opts.now ? opts.now() : Date.now();
      const dayStart = Date.parse(`${new Date(now + 5.5 * 3600000).toISOString().slice(0, 10)}T00:00:00+05:30`);
      return trading.journal.trips({ from: dayStart }).filter((t) => !t.open).map((t) => ({ symbol: t.symbol, side: t.side, net: t.net, exitAt: t.exitAt }));
    },
  };
  const taWrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      res.status(err.status || 400).json({ error: err.code || "tradeai_failed", message: err.message || "TradeAI failed." });
    }
  };
  const who = (req) => (req.user && req.user.email) || "";
  app.post("/api/admin/tradeai/ask", requireAdmin, limiter(30, 10 * 60 * 1000), taWrap(async (req) => {
    const b = req.body || {};
    const text = String(b.text || "").trim();
    if (!text) throw Object.assign(new Error("Ask a question."), { status: 400 });
    const from = Number.isInteger(b.from) ? b.from : null; // edit / retry: go back to this question first
    return ai.tradeai.start({ conv: b.conv ? String(b.conv) : null, text, owner: who(req), isOwner: req.user.role === "superadmin", from, mode: ["auto", "fast", "deep"].includes(b.mode) ? b.mode : null });
  }));
  // how TradeAI answers: the default mode, and whether (and how often a day) the paid model may be used
  app.get("/api/admin/tradeai/settings", requireAdmin, limiter(120, 60 * 1000), taWrap(async () => ai.tradeai.status()));
  app.put("/api/admin/tradeai/settings", requireSuper, limiter(30, 10 * 60 * 1000), taWrap(async (req) => ai.tradeai.setSettings(req.body || {})));
  app.get("/api/admin/tradeai/job/:id", requireAdmin, limiter(600, 60 * 1000), taWrap(async (req) => ai.tradeai.job(String(req.params.id), who(req))));
  app.post("/api/admin/tradeai/job/:id/stop", requireAdmin, limiter(60, 60 * 1000), taWrap(async (req) => ai.tradeai.cancel(String(req.params.id), who(req))));
  // the questions you are most likely to ask now (positions, orders, today's trades, movers, alerts)
  app.get("/api/admin/tradeai/suggest", requireAdmin, limiter(60, 60 * 1000), taWrap(async (req) => ai.tradeai.suggest({ isOwner: req.user.role === "superadmin" })));
  // every chat is its own record in the database; deleting one deletes it there
  app.get("/api/admin/tradeai/convs", requireAdmin, limiter(240, 60 * 1000), taWrap(async (req) => ai.tradeai.list(who(req), { q: String(req.query.q || "") })));
  app.get("/api/admin/tradeai/convs/:id", requireAdmin, limiter(240, 60 * 1000), taWrap(async (req) => ai.tradeai.get(String(req.params.id), who(req))));
  app.put("/api/admin/tradeai/convs/:id", requireAdmin, limiter(60, 60 * 1000), taWrap(async (req) => ai.tradeai.rename(String(req.params.id), who(req), (req.body || {}).title)));
  app.put("/api/admin/tradeai/convs/:id/pin", requireAdmin, limiter(60, 60 * 1000), taWrap(async (req) => ai.tradeai.pin(String(req.params.id), who(req), (req.body || {}).pinned)));
  app.delete("/api/admin/tradeai/convs/:id", requireAdmin, limiter(60, 60 * 1000), taWrap(async (req) => ai.tradeai.remove(String(req.params.id), who(req))));

  /* ------------------------------------------------ liveness (deploy/watchdog.sh) */
  // Is the process alive and answering? No sign-in, no database, nothing private: the watchdog asks
  // it every minute and restarts the app when it stops answering (a hang pm2 cannot see).
  app.get("/api/live", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, up: Math.round(process.uptime()), at: new Date().toISOString() });
  });

  /* ------------------------------------------------ site health (server/health.js) */
  app.get("/api/admin/health", requireAdmin, limiter(60, 60 * 1000), async (req, res) => {
    try {
      res.json(await buildHealth({ now: opts.now, docs, dataDir, market, ai, trading, analysis, paper, researchAuto, notifier, alertWatch, whatsapp, temple, holidays, googleConfigured: () => credentials().source !== "none" }, { secure: isSecure(req), host: req.get("host") || "" }));
    } catch (err) {
      res.status(500).json({ error: "health_failed", message: err.message });
    }
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
    // Each private-area address carries its own link preview (server/previews.js): WhatsApp,
    // Telegram, Slack, X, LinkedIn and iMessage read the HTML without running it, so the page's title,
    // description and picture are written into the shell here. The shell is read once and again only
    // when a new build replaces it. The headers set above (no-store, noindex, no framing) still apply.
    let shell = { mtime: 0, html: "" };
    const shellHtml = () => {
      const m = fs.statSync(adminFile).mtimeMs;
      if (m !== shell.mtime) shell = { mtime: m, html: fs.readFileSync(adminFile, "utf8") };
      return shell.html;
    };
    // the address the preview points at: the configured public origin, else this request's host
    // (https unless it is a development machine, since nginx may hand us plain http)
    const previewOrigin = (req) => {
      if (env.PUBLIC_ORIGIN) return String(env.PUBLIC_ORIGIN).replace(/\/$/, "");
      const host = String(req.get("host") || "").replace(/[^A-Za-z0-9.:[\]-]/g, "").slice(0, 255);
      if (!host) return "https://vinaytiwari.org";
      return `${req.protocol === "https" || !isLocalHost(host) ? "https" : "http"}://${host}`;
    };
    app.get("*", (req, res) => {
      if (!isAdminPath(req.path) || !fs.existsSync(adminFile)) return res.sendFile(indexFile);
      try {
        const html = injectPreview(shellHtml(), previewTags(previewFor(req.path, req.query), previewOrigin(req)));
        res.type("html").send(html);
      } catch (_) {
        res.sendFile(adminFile); // a preview is a convenience: the page itself must always open
      }
    });
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
