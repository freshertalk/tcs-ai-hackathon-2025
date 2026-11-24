"use strict";
const { BRAND } = require("./brand");
// The API behind /me, plus static hosting of the built site.
//
// Roles
//   owner       SUPERADMIN_EMAIL: the first superadmin. Cannot be removed or changed, and is the only one who can
//               make someone a superadmin, make a superadmin an admin again, or remove a superadmin.
//   superadmin  The owner, and anyone the owner has made one. Everything the owner can do (settings, people, the
//               site's own trading account, the private pages) except what is said above.
//   admin       Anyone a superadmin has added. Full access except admin management.
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
  canonicalEmail,
} = require("./config");
const defaultGoogle = require("./google");
const { Mailer } = require("./mailer");
const { mountEmailAuth } = require("./email-auth");
const { HolidayService } = require("./holidays/service");
const { NseHolidayService } = require("./holidays/nse-service");
const { nextSession } = require("./market/next-session");
const { ExchangeClock } = require("./clock");
const { MarketService, MarketError } = require("./market/service");
const { mountMarket } = require("./market/routes");
const { AiService } = require("./ai/service");
const { mountAi } = require("./ai/routes");
const { ResearchAuto } = require("./research-auto");
const { PaperService, PaperError } = require("./paper/service");
const { DayAnalysis } = require("./analysis/service");
const { mountAnalysis } = require("./analysis/routes");
const { Temple, mountTemple } = require("./temple");
const { Kundali, mountKundali } = require("./kundali");
const { Expenses, mountExpenses } = require("./expenses");
const { Notifier, mountNotify } = require("./notify");
const { AlertWatch } = require("./alert-watch");
const { DisciplineWatch } = require("./discipline-watch");
const { LiveBook } = require("./trading/livebook");
const { Scanner, ScannerError } = require("./scanner");
const { SetupLab, SetupLabError } = require("./setuplab");
const { PaperRobot } = require("./robot/service");
const { mountRobot } = require("./robot/routes");
const knowledge = require("./market/knowledge");
const { LearningService } = require("./learning/service");
const { GlobalFeed } = require("./market/global");
const { SocialService } = require("./social/service");
const { previewFor, previewTags, injectPreview } = require("./previews");
const { readingOf: socialReading } = require("./social/extract");
const { SocialWatch } = require("./social-watch");
const { FlightDeck, FlightError } = require("./flight");
const { LearnWatch } = require("./learn");
const { OpenForecast } = require("./open-forecast");
const { Horizon } = require("./horizon");
const { Ahead } = require("./ahead");
const { Evidence } = require("./evidence");
const { ExpiryCalendar } = require("./expiry");
const { askDefault, team: aiTeam } = require("./ai/mixture");
const { LiveHub, watchDocs } = require("./live");
const { Supervisor } = require("./supervisor");
const { TrainGuard } = require("./train-guard");
const { Consensus } = require("./consensus");
const { TradeSetup } = require("./setup");
const { MemoryGovernor } = require("./memory");
const { DeliveryStore } = require("./market/delivery");
const { dossier } = require("./dossier");
const { Recorder } = require("./recorder");
const { Accounts, AccountError } = require("./accounts");
const { Prefs, DEFAULTS: PREF_DEFAULTS, OPTIONS: PREF_OPTIONS } = require("./prefs");
const { Vault } = require("./vault");
const zlibLib = require("zlib");
const { Autopilot } = require("./autopilot");
const nseCalendar = require("./market/nse-holidays");
const { makeDeskReaders } = require("./desk-readers");
const { IndexHistory, IndexError } = require("./index-history");
const { TopPicks, PicksError } = require("./picks");
const { JournalCapture } = require("./journal-capture");
const { WhatsAppService, mountWhatsApp } = require("./whatsapp");
const { buildHealth } = require("./health");
const { chargeParts } = require("./trading/journal");
const { TradingService } = require("./trading/service");
const { mountTrading } = require("./trading/routes");

const SESSION_COOKIE = "vpt_session";
const OAUTH_COOKIE = "vpt_oauth";
const SESSION_TTL = 7 * 24 * 60 * 60; // seconds
const SHORT_SESSION_TTL = 12 * 60 * 60; // "don't keep me signed in": until the browser closes, and at most this long
const OAUTH_TTL = 10 * 60;
const AUDIT_KEEP = 300;

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
    ...(maxAge === undefined ? [] : [`Max-Age=${maxAge}`]), // none: a session cookie, gone when the browser closes
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
  // a real host name only (letters, digits, dots, hyphens, an optional port, or a bracketed IPv6): "evil.com?.local" is not local
  if (!/^(\[[0-9a-f:.]+\]|[a-z0-9.-]*)(:\d{1,5})?$/.test(h)) return false;
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
    hits.delete(key);
    hits.set(key, list); // the newest at the end
    // never let it grow without bound — by dropping the OLDEST entries, never all of them (clearing every bucket at once let a
    // stream of new addresses reset everyone's limits, sign-in included)
    if (hits.size > 5000) for (const k of hits.keys()) {
      if (hits.size <= 4500) break;
      hits.delete(k);
    }
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
  // NSE's own trading-holiday list (23 Nov 2026): read every six hours and handed to the server's trading-day rules
  // (market/nse-holidays.js), so the /me next-session strip, the Calendar page and every service read one calendar.
  // A change at NSE is published on the live channel ("holidays") — `live` is created further down, before start().
  const nseHolidays = opts.nseHolidays || new NseHolidayService({ dir: dataDir, fetchImpl: opts.holidayFetch, onChange: () => live && live.publish("holidays", "watch") });
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

  // AI credit protection (server/ai/spend.js): a request to an AI company leaves only when a person pressed an AI button.
  // On unless a test or tool built its own AI service or asks for it off; the owner can lift it on the AI page.
  if (!opts.ai) ai.guard.enforce = opts.aiGuard !== false;

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

  // A person's OWN Zerodha account (server/accounts.js): someone on the admin list, switched on by the owner, connects
  // their own Kite ID and trades on it — their key, their switch, their limits, their audit trail. Each gets a trading
  // service of their own; the owner's (above) is untouched. And each person's preferences for the private area.
  const accounts =
    opts.accounts ||
    new Accounts({
      docs: store.docs,
      secrets: { encrypt: (t) => encrypt(t, settingsKey), decrypt: (b) => decrypt(b, settingsKey) },
      market,
      dataDir,
      isAdmin: (email) => roleOf(email) === "admin",
      fetchImpl: opts.tradingFetch || opts.marketFetch,
      now: opts.now,
      log: opts.log || console,
      gapMs: opts.marketGaps ? 0 : undefined,
    });
  const prefs = opts.prefs || new Prefs({ docs: store.docs });

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
            .map((t) => ({ ...t, parts: t.parts || chargeParts(t) })); // the journal's own heads: corrected to Console's when a ledger or P&L statement was read
        },
        // that day's 1-minute bars, for the Execution Lab's replay
        minuteBars: (symbol, fromMs, toMs) => market.minuteBarsBetween(symbol, fromMs, toMs),
        // the live board's recorded flights of that day (signals, levels, alerts), for the day snapshot's timeline.
        // `flight` is created further down; this is only called later, by the sweep or a request.
        flightDay: (date) => flight.day(date),
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
    await analysis.snapshotBackfill({ max: 10 });
  };
  // a ledger matched to the journal: the Day book re-reads the days whose charges changed
  trading.onJournalMatch = async (days) => {
    for (const day of days) await analysis.capture(day, { by: "manual" }).catch(() => {});
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
  // One person, however they arrive: the same mailbox is the same user whether they came through Google, a
  // password or an emailed code, and spellings of one mailbox (capitals; for Gmail dots, +tags, googlemail.com)
  // are one mailbox. Returns the address as it is LISTED (the superadmin's, or the admin list's), which is the
  // key of every record about that person, or null when they are not allowed in.
  function identify(email) {
    const c = canonicalEmail(email);
    if (!c) return null;
    if (c === canonicalEmail(SUPERADMIN_EMAIL)) return { email: SUPERADMIN_EMAIL, role: "superadmin", owner: true };
    const a = store.data.admins.find((x) => canonicalEmail(x.email) === c);
    // a person the owner has made a superadmin: the same role, but never the owner
    return a ? { email: a.email, role: a.role === "superadmin" ? "superadmin" : "admin", owner: false } : null;
  }
  const roleOf = (email) => (identify(email) || {}).role || null;

  function currentUser(req) {
    const raw = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const p = verify(raw, sessionKey);
    if (!p || !p.email) return null;
    const id = identify(p.email); // looked up every time: removing an admin takes effect at once
    if (!id) return null;
    // "sign out everywhere" and a changed password raise this number; older cookies stop working
    if ((p.v || 0) !== ((store.data.users[id.email] || {}).sessionVer || 0)) return null;
    return {
      email: id.email,
      name: String(p.name || ""),
      picture: /^https:\/\//.test(p.picture || "") ? p.picture : "",
      role: id.role,
      owner: Boolean(id.owner),
    };
  }

  /* --- the audit trail, and signing someone in */
  function audit(req, type, email, extra = {}) {
    store.update((d) => {
      if (!Array.isArray(d.audit)) d.audit = [];
      d.audit.push({
        at: new Date(authNow()).toISOString(),
        type,
        email: logSafe(email).slice(0, 120),
        ip: logSafe(req && req.ip).slice(0, 60),
        ua: logSafe(req && req.get && req.get("user-agent")).slice(0, 90),
        ...extra,
      });
      if (d.audit.length > AUDIT_KEEP) d.audit.splice(0, d.audit.length - AUDIT_KEEP);
    });
  }

  /** The one place a session starts: Google, a password and an emailed code all end here. */
  function startSession(req, res, id, { method, remember = true, quiet = false, name, picture } = {}) {
    const rec = store.data.users[id.email] || {};
    if (!quiet) {
      store.update((d) => {
        d.users[id.email] = { ...(d.users[id.email] || {}), lastLogin: new Date(authNow()).toISOString() };
      });
    }
    const who = name !== undefined ? name : rec.name || id.email.split("@")[0]; // by email there is no profile name: show the part before the @
    const pic = picture !== undefined ? picture : rec.picture || "";
    const ttl = remember ? SESSION_TTL : SHORT_SESSION_TTL;
    res.append(
      "Set-Cookie",
      cookie(SESSION_COOKIE, sign({ email: id.email, name: who, picture: pic, v: rec.sessionVer || 0 }, sessionKey, ttl), {
        maxAge: remember ? SESSION_TTL : undefined,
        secure: isSecure(req),
      })
    );
    if (!quiet) audit(req, "signin", id.email, { method });
  }
  const authNow = () => (opts.authNow ? opts.authNow() : Date.now());

  // the sign-in address to put in emailed links: what the owner set, else PUBLIC_ORIGIN, else — only on a
  // development machine, or for the signed-in owner — this request's own address. Never an outsider's Host header.
  function trustedOrigin(req, { owner = false } = {}) {
    const set = store.data.settings.publicUrl;
    if (set) return set;
    if (env.PUBLIC_ORIGIN) return String(env.PUBLIC_ORIGIN).replace(/\/$/, "");
    if (owner || isLocalHost(req.get("host"))) return `${req.protocol}://${req.get("host")}`;
    return null;
  }

  // outgoing email (sign-in links and codes, invitations, notices); the owner sets the server in the admin panel
  const secretBox = { encrypt: (t) => encrypt(t, settingsKey), decrypt: (b) => decrypt(b, settingsKey) };
  const mailer = opts.mailer || new Mailer({ store, secrets: secretBox, env, createTransport: opts.mailTransport, log: opts.log || console });

  const origin = (req) =>
    (env.PUBLIC_ORIGIN || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  const redirectUri = (req) => `${origin(req)}/api/auth/google/callback`;
  const isSecure = (req) => req.protocol === "https";

  /* --------------------------------------------------------- express */
  const app = express();
  app.disable("x-powered-by");
  // Exchange time (23 Nov 2026): this server's clock corrected by time servers (clock.js). The receive moment of a clock
  // request is stamped HERE, before any other work, so the page's arithmetic can take the server's own handling time out.
  const exchangeClock = opts.exchangeClock || new ExchangeClock({ log: opts.log || console });
  app.use("/api/admin/clock", (req, res, next) => {
    req.clockT1 = exchangeClock.exchangeNow();
    next();
  });
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

  // Flood control in front of the API. Someone who is not signed in gets a small budget per
  // address (enough to sign in, far too little to hammer the server); a signed-in person gets room
  // for the live pages' polling — counted per person, not per address, and wide enough for the
  // terminal open in several tabs at once. The long-lived streams count once.
  // (Behind nginx, TRUST_PROXY makes req.ip the visitor's address, not nginx's.)
  const anonBudget = budget(Number(env.RATE_ANON_PER_MIN) || 90, 60000);
  const userBudget = budget(Number(env.RATE_USER_PER_MIN) || 3000, 60000);
  app.use("/api", (req, res, next) => {
    if (opts.rateLimit === false) return next();
    const user = parseCookies(req.headers.cookie)[SESSION_COOKIE] ? currentUser(req) : null;
    const wait = user ? userBudget(`u:${user.email}`) : anonBudget(`a:${req.ip || "?"}`);
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
        // the modern form of the same rule, plus no plugins and no foreign <base> (scripts are left to the existing rules)
        "Content-Security-Policy": "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
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

  // Which requests are a person pressing a button: a signed-in, state-changing request with the site's header (CSRF above). Whatever such a
  // request starts keeps that. The co-pilot's automatic readings (its Go live mode) come as the same kind of request with a reason other than
  // "manual": they are NOT a click. A page that is only being read (GET) is not one either.
  app.use("/api", (req, res, next) => {
    const g = ai.guard;
    const route = `${req.method} ${logSafe(req.baseUrl + req.path)}`;
    const user = ["GET", "HEAD", "OPTIONS"].includes(req.method) ? null : currentUser(req);
    const auto = Boolean(user && req.path.startsWith("/admin/ai/live/") && req.body && req.body.reason && req.body.reason !== "manual");
    // opening a stock on the Desk is not a click either: it is its own kind of request, which the evidence desk may answer with ONE
    // AI read of that stock when its own test says the AI is needed (the owner's instruction; server/ai/spend.js, server/evidence.js)
    const opened = Boolean(user && req.method === "POST" && /^\/admin\/market\/evidence\/[^/]+\/open$/.test(req.path));
    g.run(opened ? { click: false, opened: true, by: user.email, route } : user && !auto ? { click: true, by: user.email, route } : { click: false, route }, next);
  });

  // The live hub (server/live.js): every successful state-changing request under /api/admin tells every open page which topics changed,
  // so they re-read at once; the watchers further down publish what no request caused. Registered before any route.
  const live = opts.liveHub || new LiveHub({ now: opts.now, log: opts.log || console });
  app.use("/api/admin", live.middleware());
  // every saved record publishes its topic (server/live.js watchDocs): a change made by a timer, the clock or a learner reaches
  // the open pages at once, exactly as one made by a button does
  if (opts.liveDocs !== false) watchDocs(store.docs, live);

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
  // the owner alone: who is a superadmin is decided by one person, and a superadmin cannot make another
  const requireOwner = (req, res, next) =>
    requireSuper(req, res, () => {
      if (!req.user.owner) return res.status(403).json({ error: "forbidden", message: "Only the owner can do this." });
      next();
    });

  // Whose account? The owner's is the site's own Zerodha connection; a person the owner has switched it on for gets
  // THEIR OWN (server/accounts.js). The account comes from the session and from nothing else; anyone else is refused.
  const requireTrader = (req, res, next) =>
    requireAdmin(req, res, () => {
      if (req.user.role === "superadmin") {
        req.trading = trading;
        return next();
      }
      try {
        req.trading = accounts.tradingFor(req.user.email);
      } catch (err) {
        return res.status(err.status || 403).json({ error: err.code || "forbidden", message: err.message });
      }
      next();
    });

  /* ------------------------------------------------------- public API */

  // What the public site needs: the analytics ID (never on a local machine,
  // never for a signed-in admin, so neither pollutes the page counts).
  app.get("/api/public-config", (req, res) => {
    const id = store.data.settings.gaMeasurementId;
    const skip = isLocalHost(req.get("host")) || Boolean(currentUser(req));
    // loginIcon: whether the public site's navbar shows the small person icon that leads to /me (the owner's switch under
    // /me → Personal). Only the icon: /me itself always opens, whatever this says.
    res.json({ ga: id && !skip ? id : null, loginIcon: store.data.settings.loginIcon !== false });
  });

  // The public site's own tiny live channel: one Server-Sent Events stream that carries ONLY the icon's on/off, so a switch pressed
  // under /me reaches every open page of the public site at once, with no refresh. Capped (400 open, 3 per visitor) and quiet
  // (a heartbeat every 25 s); it sends nothing private, and a page that connects is told the current state first.
  const siteStreams = new Map(); // response -> visitor address
  const sendIcon = (res) => res.write(`event: icon\ndata: ${JSON.stringify({ loginIcon: store.data.settings.loginIcon !== false })}\n\n`);
  const siteBeat = setInterval(() => {
    for (const res of siteStreams.keys()) {
      try {
        res.write(": beat\n\n");
      } catch (_) {
        siteStreams.delete(res);
      }
    }
  }, 25000);
  if (siteBeat.unref) siteBeat.unref();
  app.get("/api/public-stream", (req, res) => {
    const ip = req.ip || "?";
    if (siteStreams.size >= 400 || [...siteStreams.values()].filter((x) => x === ip).length >= 3) return res.status(429).json({ error: "busy", message: "Too many open streams." });
    res.set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    res.write("retry: 4000\n\n");
    siteStreams.set(res, ip);
    req.on("close", () => siteStreams.delete(res));
    sendIcon(res);
  });

  // The switch for that icon: superadmins only, like the Personal block it sits in
  app.get("/api/admin/settings/login-icon", requireSuper, (req, res) => res.json({ on: store.data.settings.loginIcon !== false }));
  app.put("/api/admin/settings/login-icon", requireSuper, (req, res) => {
    const on = (req.body || {}).on;
    if (typeof on !== "boolean") return res.status(400).json({ error: "invalid", message: "Say whether the icon is on or off." });
    store.update((d) => {
      d.settings.loginIcon = on;
    });
    audit(req, "login_icon", req.user.email, { on });
    for (const s of siteStreams.keys()) {
      try {
        sendIcon(s); // every open page of the public site changes now
      } catch (_) {
        siteStreams.delete(s);
      }
    }
    res.json({ on });
  });

  app.get("/api/auth/status", (req, res) => {
    // Google or a working email setup is enough to sign in; the first-run page appears only when neither is
    const configured = isConfigured() || mailer.configured();
    const u = currentUser(req);
    res.json({
      configured,
      needsSetup: !configured,
      // trader: this person may use their OWN Zerodha account here (the owner uses the site's own connection)
      user: u ? { ...u, hasPassword: Boolean((store.data.users[u.email] || {}).passwordHash), trader: u.role !== "superadmin" && accounts.allowed(u.email) } : null,
      methods: emailAuth.methods(),
      captcha: emailAuth.captchaOn(), // the email sign-in asks for a security check (a picture and a proof of work)
      emailReady: mailer.configured(), // links by email can be sent (to choose or reset a password)
    });
  });

  app.get("/api/auth/google/start", limiter(30, 15 * 60 * 1000), (req, res) => {
    const c = credentials();
    if (!c.id || !c.secret) return res.redirect(`${ADMIN_BASE}?error=not-configured`);
    if (!emailAuth.methods().google) return res.redirect(`${ADMIN_BASE}?error=google-off`);
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

    const id = identify(profile.email);
    if (!id) {
      console.warn(`[auth] sign-in refused for ${logSafe(normaliseEmail(profile.email))}: not an admin`);
      audit(req, "signin_failed", canonicalEmail(profile.email), { method: "google", known: false });
      return fail("unauthorized");
    }

    // the same person as any password or code they use: one record, merged (never replaced)
    store.update((d) => {
      d.users[id.email] = {
        ...(d.users[id.email] || {}),
        name: profile.name || (d.users[id.email] || {}).name || "",
        picture: profile.picture,
        googleAt: new Date().toISOString(),
        emailVerifiedAt: (d.users[id.email] || {}).emailVerifiedAt || new Date().toISOString(),
      };
    });
    startSession(req, res, id, { method: "google", name: profile.name, picture: profile.picture });
    res.append("Set-Cookie", clear);
    res.redirect(ADMIN_BASE);
  });

  app.post("/api/auth/logout", (req, res) => {
    const u = currentUser(req);
    if (u) audit(req, "signout", u.email, {});
    res.append("Set-Cookie", cookie(SESSION_COOKIE, "", { maxAge: 0, secure: isSecure(req) }));
    res.json({ ok: true });
  });

  // Sign in with an email address (password or emailed code), account security, and the admin panel's
  // "Email & sign-in" settings: server/email-auth.js
  const emailAuth = mountEmailAuth(app, {
    captcha: opts.captcha, // false: off (tests of the email routes); otherwise the security gate is always on
    store,
    mailer,
    sessionKey,
    limiter,
    requireAdmin,
    requireSuper,
    identify,
    startSession,
    trustedOrigin,
    audit,
    googleReady: isConfigured,
    encrypt: (t) => encrypt(t, settingsKey),
    envMailReady: () => Boolean(env.SMTP_HOST && EMAIL_RE.test(String(env.SMTP_FROM || env.SMTP_USER || ""))),
    envOrigin: Boolean(env.PUBLIC_ORIGIN),
    now: authNow,
    log: opts.log || console,
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

  app.put("/api/admin/settings/google", requireSuper, (req, res) => {
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

  app.put("/api/admin/settings/analytics", requireSuper, (req, res) => {
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
  // `nse` (23 Nov 2026): NSE's own trading-holiday list — the one the server's trading-day rules use — with its check
  // against the built-in table.
  app.get("/api/admin/stock/holidays", requireAdmin, (req, res) => res.json({ ...holidays.snapshot(), nse: nseHolidays.snapshot() }));

  // Exchange time for the pages (23 Nov 2026): t1 = when this request arrived, t2 = when the answer leaves, both on this
  // server's corrected clock. The page computes its offset NTP-style: ((t1 − t0) + (t2 − t3)) / 2. Never cached.
  app.get("/api/admin/clock", requireAdmin, (req, res) => {
    const st = exchangeClock.status();
    res.set("Cache-Control", "no-store");
    res.json({ t1: req.clockT1 || exchangeClock.exchangeNow(), source: st.source, accuracyMs: st.accuracyMs, offsetMs: st.offsetMs, syncedAt: st.syncedAt, zone: st.zone, t2: exchangeClock.exchangeNow() });
  });

  // The next trading session by NSE's calendar (23 Nov 2026): today's state, the next trading day after today with its
  // times, the days skipped and why, and whether the calendar is NSE's own list (verified) or the built-in table.
  app.get("/api/admin/market/next-session", requireAdmin, (req, res) => {
    res.json(nextSession({ now: opts.now ? opts.now() : exchangeClock.exchangeNow(), official: nseHolidays.snapshot() }));
  });

  // "Check now". Limited per client, and the service itself refuses to ask the
  // exchange more than once a minute.
  app.post("/api/admin/stock/holidays/refresh", requireAdmin, limiter(6, 10 * 60 * 1000), async (req, res) => {
    res.json(await holidays.refresh());
  });
  // "Check now" for NSE's own list (the BSE / NSE calendar's button). Limited the same way; the service itself asks NSE
  // at most once a minute and keeps the last good copy when NSE does not answer.
  app.post("/api/admin/stock/holidays/nse/refresh", requireAdmin, limiter(6, 10 * 60 * 1000), async (req, res) => {
    res.json({ nse: await nseHolidays.refresh() });
  });

  /* ------------------------------------------- superadmin: admin users */
  const adminRow = (email, role, extra = {}) => {
    const u = store.data.users[email] || {};
    const owner = email === SUPERADMIN_EMAIL;
    return {
      email,
      role,
      owner,
      locked: owner, // the owner cannot be removed or changed; a superadmin the owner made can be, by the owner
      lastLogin: u.lastLogin || null,
      hasPassword: Boolean(u.passwordHash),
      googleLinked: Boolean(u.googleAt),
      // too many wrong passwords: locked for a while (for one visitor or for everyone — server/email-auth.js counts both)
      lockedOut: Boolean(u.fails && u.fails.until > authNow()) || Boolean(emailAuth && typeof emailAuth.isLocked === "function" && emailAuth.isLocked({ email })),
      ...extra,
    };
  };
  const isSuperRec = (a) => a.role === "superadmin";
  const adminRows = () => [
    adminRow(SUPERADMIN_EMAIL, "superadmin"),
    // the superadmins first, then the admins, each in the order they were added
    ...[...store.data.admins.filter(isSuperRec), ...store.data.admins.filter((a) => !isSuperRec(a))].map((a) =>
      adminRow(a.email, isSuperRec(a) ? "superadmin" : "admin", { addedBy: a.addedBy, addedAt: a.addedAt, ...(isSuperRec(a) ? { madeSuperBy: a.madeSuperBy || a.addedBy, madeSuperAt: a.madeSuperAt || a.addedAt } : {}) })
    ),
  ];
  // what the page needs to know about the one asking: only the owner is offered the superadmin choices
  const peopleView = (req, extra = {}) => ({ admins: adminRows(), canManageSupers: Boolean(req.user.owner), ...extra });

  app.get("/api/admin/admins", requireSuper, (req, res) => res.json(peopleView(req, { emailReady: mailer.configured() })));

  app.post("/api/admin/admins", requireSuper, async (req, res) => {
    const email = normaliseEmail((req.body || {}).email);
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return res.status(400).json({ error: "invalid", message: "Enter a valid email address." });
    }
    const asked = (req.body || {}).role;
    if (asked !== undefined && asked !== "admin" && asked !== "superadmin") {
      return res.status(400).json({ error: "invalid", message: "A person is added as an admin or as a superadmin." });
    }
    const asSuper = asked === "superadmin";
    if (asSuper && !req.user.owner) {
      return res.status(403).json({ error: "forbidden", message: "Only the owner can add a superadmin." });
    }
    // the same mailbox is the same person: capitals, and for Gmail dots, +tags and googlemail.com, do not make a new one
    const same = identify(email);
    if (same && same.owner) {
      return res.status(400).json({ error: "invalid", message: "That is the superadmin — it already has full access." });
    }
    if (same) {
      const what = same.role === "superadmin" ? "a superadmin" : "an admin";
      return res.status(409).json({ error: "exists", message: same.email === email ? `That person is already ${what}.` : `That is the same mailbox as ${same.email}, who is already ${what}.` });
    }
    const at = new Date().toISOString();
    store.update((d) => {
      d.admins.push({ email, addedBy: req.user.email, addedAt: at, ...(asSuper ? { role: "superadmin", madeSuperBy: req.user.email, madeSuperAt: at } : {}) });
    });
    audit(req, asSuper ? "superadmin_added" : "admin_added", email, { by: req.user.email });
    // an invitation by email, when email is set up and the superadmin did not decline it
    let invited = false;
    let inviteProblem = "";
    if ((req.body || {}).invite !== false && mailer.configured()) {
      try {
        await emailAuth.sendInvite(req, identify(email), req.user.name || req.user.email);
        invited = true;
        audit(req, "invite_sent", email, { by: req.user.email });
      } catch (err) {
        inviteProblem = err.message;
      }
    }
    res.status(201).json(peopleView(req, { invited, inviteProblem }));
  });

  // An admin becomes a superadmin, or a superadmin an admin again. The owner alone decides this: a superadmin can do
  // everything the owner can, the site's own trading account included, so nobody but the owner hands that out.
  app.put("/api/admin/admins/:email", requireOwner, limiter(30, 10 * 60 * 1000), (req, res) => {
    const role = (req.body || {}).role;
    if (role !== "admin" && role !== "superadmin") {
      return res.status(400).json({ error: "invalid", message: "Choose admin or superadmin." });
    }
    const id = identify(normaliseEmail(req.params.email));
    if (!id) return res.status(404).json({ error: "not_found", message: "No such admin." });
    if (id.owner) return res.status(400).json({ error: "locked", message: "The owner cannot be changed." });
    if (id.role === role) return res.json(peopleView(req));
    // a superadmin works on the site's own Zerodha account; a Zerodha account of their own is an admin's. One or the
    // other, said before it happens — never both at once.
    if (role === "superadmin" && accounts.allowed(id.email)) {
      return res.status(409).json({ error: "own_account", message: "This person trades on a Zerodha account of their own. Switch that off first (Zerodha accounts): a superadmin uses the site's own account." });
    }
    const at = new Date().toISOString();
    store.update((d) => {
      const a = d.admins.find((x) => x.email === id.email);
      if (!a) return;
      if (role === "superadmin") Object.assign(a, { role: "superadmin", madeSuperBy: req.user.email, madeSuperAt: at });
      else {
        delete a.role;
        delete a.madeSuperBy;
        delete a.madeSuperAt;
      }
    });
    audit(req, role === "superadmin" ? "superadmin_made" : "superadmin_unmade", id.email, { by: req.user.email });
    res.json(peopleView(req));
  });

  app.delete("/api/admin/admins/:email", requireSuper, (req, res) => {
    const email = normaliseEmail(req.params.email);
    const id = identify(email);
    if (id && id.owner) {
      return res.status(400).json({ error: "locked", message: "The superadmin cannot be removed." });
    }
    if (id && id.role === "superadmin" && !req.user.owner) {
      return res.status(403).json({ error: "forbidden", message: "Only the owner can remove a superadmin." });
    }
    if (!id) {
      return res.status(404).json({ error: "not_found", message: "No such admin." });
    }
    store.update((d) => {
      d.admins = d.admins.filter((a) => a.email !== id.email);
      // their password, codes and open sessions go with their access (the sign-in history stays in the trail);
      // the session number only ever goes up, so an old cookie cannot come back to life if they are added again
      const old = d.users[id.email] || {};
      d.users[id.email] = { name: old.name || "", lastLogin: old.lastLogin || null, sessionVer: (old.sessionVer || 0) + 1 };
    });
    accounts.forget(id.email); // their Zerodha key, token and trading settings go with their access
    audit(req, id.role === "superadmin" ? "superadmin_removed" : "admin_removed", id.email, { by: req.user.email });
    res.json(peopleView(req));
  });

  /* ------------------------------------------- each person's own Zerodha account (server/accounts.js) */
  const ACC_COOKIE = "vpt_kite_acc";
  const ACC_PATH = "/api/admin/accounts/kite";
  const accWrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      if (err instanceof AccountError) return res.status(err.status).json({ error: err.code, message: err.message });
      console.error("[accounts]", err && err.message ? err.message : err);
      res.status(502).json({ error: "kite_error", message: err && err.message ? `Zerodha said: ${err.message}` : "Could not reach Zerodha." });
    }
  };
  const accRedirect = (req) => `${origin(req)}${ACC_PATH}/callback`;
  // who can be given a Zerodha account of their own: the admins (a superadmin works on the site's own account)
  const ownAccountPeople = () => store.data.admins.filter((a) => a.role !== "superadmin").map((a) => a.email);
  // the owner: who has an account of their own, and the switch for each (never a key, a position or an order)
  app.get("/api/admin/accounts", requireSuper, accWrap(async (req) => ({ people: accounts.list(), admins: ownAccountPeople(), redirectUrl: accRedirect(req) })));
  app.put("/api/admin/accounts/people/:email", requireSuper, limiter(60, 10 * 60 * 1000), accWrap(async (req) => {
    const id = identify(normaliseEmail(req.params.email));
    if (!id || id.role !== "admin") throw new AccountError("Add this person under People first: only someone who can sign in can be given an account.", "not_admin", 404);
    const on = Boolean((req.body || {}).allowed);
    const people = on ? accounts.grant(id.email, req.user.email) : accounts.revoke(id.email, req.user.email);
    audit(req, on ? "account_granted" : "account_revoked", id.email, { by: req.user.email });
    return { people, admins: ownAccountPeople(), redirectUrl: accRedirect(req) };
  }));
  // the person: their own connection
  app.get("/api/admin/accounts/me", requireAdmin, accWrap(async (req) => ({ ...accounts.state(req.user.email), owner: req.user.role === "superadmin", redirectUrl: accRedirect(req) })));
  app.put("/api/admin/accounts/me/kite", requireAdmin, limiter(20, 15 * 60 * 1000), accWrap(async (req) => {
    const b = req.body || {};
    return { ...accounts.setCredentials(req.user.email, b.apiKey, b.apiSecret), owner: false, redirectUrl: accRedirect(req) };
  }));
  app.post("/api/admin/accounts/me/disconnect", requireAdmin, accWrap(async (req) => ({ ...accounts.disconnect(req.user.email), owner: false, redirectUrl: accRedirect(req) })));
  app.delete("/api/admin/accounts/me/kite", requireAdmin, accWrap(async (req) => ({ ...accounts.removeKeys(req.user.email), owner: false, redirectUrl: accRedirect(req) })));
  // the daily login: the password and 2FA are typed on kite.zerodha.com, never here; Zerodha sends the browser back with a one-time token
  app.get(`${ACC_PATH}/login`, limiter(20, 15 * 60 * 1000), (req, res) => {
    const u = currentUser(req);
    if (!u) return res.redirect(ADMIN_BASE);
    try {
      const state = randomToken(18);
      res.append("Set-Cookie", cookie(ACC_COOKIE, sign({ state, email: u.email }, sessionKey, 600), { maxAge: 600, path: ACC_PATH, secure: isSecure(req) }));
      res.redirect(accounts.loginUrl(u.email, state));
    } catch (err) {
      res.redirect(`${ADMIN_BASE}?account=error&reason=${encodeURIComponent(err.message)}`);
    }
  });
  app.get(`${ACC_PATH}/callback`, async (req, res) => {
    const clear = cookie(ACC_COOKIE, "", { maxAge: 0, path: ACC_PATH, secure: isSecure(req) });
    const fail = (reason) => {
      res.append("Set-Cookie", clear);
      res.redirect(`${ADMIN_BASE}?account=error&reason=${encodeURIComponent(reason)}`);
    };
    const u = currentUser(req);
    if (!u) return res.redirect(ADMIN_BASE);
    const pending = verify(parseCookies(req.headers.cookie)[ACC_COOKIE], sessionKey);
    // the attempt must have started here, in this browser, by this same person
    if (!pending || pending.email !== u.email || typeof req.query.state !== "string" || !safeEqual(req.query.state, pending.state)) return fail("That login attempt expired or did not start here. Please try again.");
    if (req.query.status && req.query.status !== "success") return fail("The Kite login was cancelled.");
    try {
      await accounts.completeLogin(u.email, req.query.request_token);
      res.append("Set-Cookie", clear);
      res.redirect(`${ADMIN_BASE}?account=connected`);
    } catch (err) {
      console.error("[accounts] Kite login failed:", err.message);
      fail(err instanceof AccountError ? err.message : `Zerodha said: ${err.message || "the login could not be completed"}`);
    }
  });

  /* ------------------------------------------- each person's preferences (server/prefs.js; /me → Customize) */
  app.get("/api/admin/prefs", requireAdmin, (req, res) => res.json({ prefs: prefs.get(req.user.email), stored: prefs.stored(req.user.email), defaults: PREF_DEFAULTS, options: PREF_OPTIONS }));
  app.put("/api/admin/prefs", requireAdmin, limiter(240, 10 * 60 * 1000), (req, res) => res.json({ prefs: prefs.set(req.user.email, req.body || {}), defaults: PREF_DEFAULTS, options: PREF_OPTIONS }));
  app.delete("/api/admin/prefs", requireAdmin, limiter(60, 10 * 60 * 1000), (req, res) => res.json({ prefs: prefs.reset(req.user.email), defaults: PREF_DEFAULTS, options: PREF_OPTIONS }));

  /* ------------------------------------------- stock report: the AI strategist */
  mountAi(app, { ai, requireAdmin, requireSuper, limiter });
  mountAnalysis(app, { analysis, requireSuper, limiter });

  /* ------------------------------------------------ the Mandir (devotional audio) */
  const temple = opts.temple || new Temple({ docs, dir: dataDir });
  mountTemple(app, { temple, requireAdmin, requireSuper, limiter });
  // the owner's Kundali: his birth chart, its reading and the papers it comes from — superadmins only (server/kundali.js)
  const kundali = opts.kundali || new Kundali({ docs, dir: dataDir, now: opts.now });
  mountKundali(app, { kundali, requireSuper, limiter, audit });
  // the owner's expense ledger, beside it under "Personal" on /me — superadmins only (server/expenses.js)
  const expenses = opts.expenses || new Expenses({ docs, now: opts.now });
  mountExpenses(app, { expenses, requireSuper, limiter });

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
  // the live book (trading/livebook.js): Zerodha's positions re-priced on every streamed tick — the one
  // source of the day's P&L for every screen and for the goal check below. It reaches the pages over
  // the trading stream (/api/admin/trading/stream), so a page opens no extra connection for it.
  const liveBook = opts.liveBookService || new LiveBook({ trading, market, now: opts.now, log: opts.log || console });
  liveBook.needed = () => {
    try {
      return Boolean(trading._discipline().enabled);
    } catch (_) {
      return false;
    }
  };
  trading.liveBook = liveBook;
  // the Zerodha session starting or ending changes every page's status at once
  if (market.events && typeof trading.pushStatus === "function") market.events.on("kite", () => trading.pushStatus());
  trading.livePositions = () => liveBook.fresh();
  if (opts.liveBook !== false && opts.alertWatch !== false) liveBook.start();
  app.get("/api/admin/trading/live", requireTrader, async (req, res) => {
    // a person's own account has no streamed book: its positions are read from Zerodha as they are
    if (req.user.role !== "superadmin") return res.json(await accounts.book(req.user.email));
    try {
      if (!liveBook.base || req.query.fresh === "1") await liveBook.refresh();
      res.json(liveBook.view());
    } catch (err) {
      res.status(502).json({ error: "no_data", message: err && err.message ? err.message : "Could not read the positions." });
    }
  });
  // with the live book the check is cheap (no call to Zerodha unless its base is old): every 5 seconds
  const disciplineWatch = opts.disciplineWatchService || new DisciplineWatch({ trading, now: opts.now, log: opts.log || console, every: 5000 });
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
    if (streams.size >= 60) return res.status(429).json({ error: "busy", message: "Too many open live streams." });
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
  // the level learner: after every close the day's tests of each level are counted (server/learn.js);
  // the flight deck's level map and TradeAI read its record. Arithmetic only — it asks no model.
  const learn = opts.learn || new LearnWatch({ market, docs: store.docs, flight, trading, playbook: ai.playbook, now: opts.now, log: opts.log || console });
  flight.learn = learn;
  if (opts.learnWatch !== false && opts.alertWatch !== false) learn.start();
  // the opening-price forecast (server/open-forecast.js): made before every open, scored at 9:16, learned from.
  // The Desk shows it for the stock that is open; the intraday plan's expected open reads it too.
  const openForecast = opts.openForecast || new OpenForecast({ market, docs: store.docs, ai, playbook: ai.playbook, world: () => (typeof ai.worldSummary === "function" && ai.worldSummary() && typeof ai.world === "function" ? ai.world() : null), now: opts.now, log: opts.log || console });
  market.openHint = (symbol) => openForecast.peek(symbol);
  if (opts.openForecastWatch !== false && opts.alertWatch !== false) openForecast.start();
  // the autopilot (server/autopilot.js): playbooks, the event calendar, the risk gate, order PROPOSALS (never orders),
  // and the grading of the research. It reads the market and the account; it cannot place an order.
  const autopilot = opts.autopilot || new Autopilot({ market, docs: store.docs, trading, notifier, playbook: ai.playbook, now: opts.now, log: opts.log || console });
  if (opts.autopilotWatch !== false && opts.alertWatch !== false) autopilot.start();
  const aWrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      if (!err.status) console.error("[autopilot]", err && err.message ? err.message : err);
      res.status(err.status || 500).json({ error: err.code || "autopilot_failed", message: err.message || "The autopilot failed." });
    }
  };
  // AI credit protection on the AI page: the rule, what it has held back today, what the AI has used
  app.get("/api/admin/ai/spend", requireAdmin, aWrap(() => ({ ...ai.guard.status(), today: ai.engine.status().today, saved: ai.engine.status().saved, open: evidence.aiStatus() })));
  app.put("/api/admin/ai/spend", requireSuper, limiter(20, 15 * 60 * 1000), aWrap((req) => ai.guard.setAuto(Boolean((req.body || {}).auto), req.user.email)));
  // The AI asks (23 Nov 2026): what an automatic feature would like the AI for — shown as a popup on every private page for the
  // superadmin. "Allow once" runs it inside this request's click (credit is spent only now, by the owner's press); "Not now" snoozes it.
  ai.guard.onAsk = () => live.publish("ai-ask", "ask");
  app.get("/api/admin/ai/asks", requireSuper, (req, res) => res.json({ asks: ai.guard.asks(), auto: ai.guard.status().auto, enforced: ai.guard.enforce }));
  app.post("/api/admin/ai/asks/:key/allow", requireSuper, limiter(30, 15 * 60 * 1000), (req, res) => {
    const key = String(req.params.key || "").slice(0, 80);
    const job = ai.guard.allowAsk(key);
    if (!job) return res.status(404).json({ error: "gone", message: "That request is no longer waiting (it was answered or it expired)." });
    job.catch((err) => (opts.log || console).error(`[ai] the allowed request "${key}" failed: ${err.message}`));
    res.json({ started: true, asks: ai.guard.asks() });
  });
  app.post("/api/admin/ai/asks/:key/dismiss", requireSuper, (req, res) => {
    ai.guard.dismissAsk(String(req.params.key || "").slice(0, 80));
    res.json({ ok: true, asks: ai.guard.asks() });
  });
  const symOf = (req) => String(req.params.symbol || "").trim().toUpperCase().slice(0, 25);
  app.get("/api/admin/autopilot", requireAdmin, aWrap((req) => autopilot.board({ withAccount: req.user.role === "superadmin" })));
  app.get("/api/admin/autopilot/playbook/:symbol", requireAdmin, limiter(120, 60 * 1000), aWrap((req) => autopilot.playbook(symOf(req), { withAccount: req.user.role === "superadmin" })));
  app.put("/api/admin/autopilot/settings", requireSuper, limiter(40, 15 * 60 * 1000), aWrap((req) => ({ settings: autopilot.setSettings(req.body || {}, req.user.email) })));
  app.post("/api/admin/autopilot/events", requireSuper, limiter(60, 15 * 60 * 1000), aWrap((req) => ({ event: autopilot.addEvent(req.body || {}, req.user.email) })));
  app.delete("/api/admin/autopilot/events/:id", requireSuper, aWrap((req) => {
    autopilot.removeEvent(String(req.params.id || "").slice(0, 40));
    return { ok: true };
  }));
  app.post("/api/admin/autopilot/proposals/:id/:action", requireSuper, limiter(120, 15 * 60 * 1000), aWrap((req) => ({ proposal: autopilot.decide(decodeURIComponent(String(req.params.id)).slice(0, 120), String(req.params.action), req.user.email) })));
  // "Study now": grade the outlook on a year of history again and read the proposals' results
  app.post("/api/admin/autopilot/recalibrate", requireSuper, limiter(8, 10 * 60 * 1000), aWrap(async () => {
    await autopilot.recalibrate();
    await autopilot.grade();
    return autopilot.board({ withAccount: true });
  }));
  const oWrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      if (!err.status) console.error("[open]", err && err.message ? err.message : err);
      res.status(err.status || 500).json({ error: err.code || "open_forecast_failed", message: err.message || "The opening forecast failed." });
    }
  };
  app.get("/api/admin/market/open-forecast", requireAdmin, oWrap(async () => openForecast.board()));
  app.get("/api/admin/market/open-forecast/:symbol", requireAdmin, limiter(180, 60 * 1000), oWrap(async (req) => openForecast.view(String(req.params.symbol || "").trim().toUpperCase().slice(0, 25))));
  // "score now": write the real opens beside the waiting forecasts and learn again (it also happens by itself)
  app.post("/api/admin/market/open-forecast/learn", requireSuper, limiter(12, 10 * 60 * 1000), oWrap(async () => {
    const scored = await openForecast.score();
    openForecast.relearn();
    return { scored, ...openForecast.board() };
  }));
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
  // what the desk has learned about levels, and Study now
  app.get("/api/admin/learn", requireAdmin, limiter(120, 60 * 1000), fWrap(async (req) => ({ ...learn.view(/^[A-Z][A-Z0-9&-]{1,19}$/.test(String(req.query.symbol || "")) ? String(req.query.symbol) : null), status: learn.status() })));
  app.post("/api/admin/learn/run", requireSuper, limiter(6, 10 * 60 * 1000), fWrap(async () => learn.run({ force: true })));
  // the shared research: what the AI has already found, for every workspace to read (findings about
  // the owner's own positions go to the owner only)
  app.get("/api/admin/ai/shared", requireAdmin, limiter(240, 60 * 1000), fWrap(async (req) => {
    const owner = req.user.role === "superadmin";
    const sym = String(req.query.symbol || "").toUpperCase();
    const one = /^[A-Z][A-Z0-9&-]{1,19}$/.test(sym);
    return { symbol: one ? sym : null, findings: one ? ai.shared.forSymbol(sym, { all: true, limit: 12, owner }) : ai.shared.recent({ all: true, owner }), stats: ai.shared.stats() };
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
  // the exit coach's step ups (TIGHTEN, BOOK PART, EXIT NOW) reach every open page as a popup, not only the Live board
  const STATE_WORD = { tighten: "TIGHTEN", "book-part": "BOOK PART", "exit-now": "EXIT NOW", hold: "HOLD" };
  flight.on("escalated", (e) => {
    if (typeof trading.notice !== "function") return;
    const money = (x) => `₹${Number(x).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
    trading.notice({
      level: e.state === "exit-now" ? "danger" : "warn",
      symbol: e.symbol,
      title: `${STATE_WORD[e.state] || String(e.state).toUpperCase()} — ${e.symbol} ${e.side} ${e.qty}`,
      text: `${e.headline || ""}${Number.isFinite(e.last) ? ` Now ${money(e.last)}` : ""}${Number.isFinite(e.pnl) ? `, P&L ${e.pnl >= 0 ? "+" : "−"}${money(Math.abs(e.pnl))}` : ""}${Number.isFinite(e.stop) ? `, stop ${money(e.stop)}` : ""}. The exit coach's reading: nothing was traded.`,
    });
  });
  flight.on("board", (b) => boards.size && fPush("board", b));
  const fBeat = setInterval(() => boards.size && fPush("board", flight.board()), 15000); // the paths, frames and events, and a heartbeat
  if (fBeat.unref) fBeat.unref();
  app.get("/api/admin/flight/stream", requireSuper, (req, res) => {
    if (boards.size >= 30) return res.status(429).json({ error: "busy", message: "Too many open Live boards." });
    res.set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders && res.flushHeaders();
    res.write("retry: 2000\n\n");
    res.write(`event: board\ndata: ${JSON.stringify(flight.board())}\n\n`);
    boards.add(res);
    flight.sync().catch(() => {}); // a page just opened: read the positions now rather than at the next round
    req.on("close", () => boards.delete(res));
  });

  // research that runs by itself before the open and after the close (server/research-auto.js)
  const researchAuto = new ResearchAuto({ ai, market, docs: store.docs, now: opts.now, log: opts.log || console, isHoliday: (date) => !nseCalendar.isTradingDay(date) });
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
    // AI notes written by a timer would spend credit nobody asked for: refused while AI credit protection is on
    if (b.withAi === true && ai.guard.enforce && !ai.guard.autoAllowed()) {
      return res.status(409).json({ error: "not_asked", message: "AI credit protection is on: the AI is asked only when you press an AI button, so the automatic run cannot write AI notes. Press Research on the stocks to get them, or lift the protection on the AI page." });
    }
    res.json(researchAuto.set({ enabled: typeof b.enabled === "boolean" ? b.enabled : undefined, withAi: typeof b.withAi === "boolean" ? b.withAi : undefined }));
  });

  /* ------------------------------------------- stock report: the account and trading */
  // the journal reads today's trades from Kite by itself (Kite keeps only the current day's)
  const journalCapture = opts.journalCaptureService || new JournalCapture({ trading, market, now: opts.now, log: opts.log || console });
  if (opts.journalCapture !== false) journalCapture.start();
  mountTrading(app, { trading, ai, requireSuper, requireTrader, limiter, capture: journalCapture });

  /* ------------------------------------------- stock report: the analyzer */
  mountMarket(app, {
    market,
    requireAdmin,
    requireSuper,
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

  /* --------------------------------------- the Indices page (server/index-history.js) */
  // NIFTY 50 and SENSEX year by year and month by month, the desk's and the AI's projections, and the
  // ledger that scores them. Reads the market only.
  const indices = opts.indexHistory || new IndexHistory({ market, ai, docs: store.docs, now: opts.now, log: opts.log || console });
  if (opts.indexWatch !== false && opts.alertWatch !== false) indices.start();
  const ixWrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      if (!(err instanceof IndexError)) console.error("[indices]", err && err.message ? err.message : err);
      res.status(err.status || 500).json({ error: err.code || "indices_failed", message: err.message || "The index history failed." });
    }
  };
  const ixId = (x) => (String(x || "").toUpperCase() === "SENSEX" ? "SENSEX" : "NIFTY");
  app.get("/api/admin/indices", requireAdmin, limiter(120, 60 * 1000), ixWrap(async (req) => indices.view(ixId(req.query.index))));
  app.get("/api/admin/indices/compare", requireAdmin, limiter(60, 60 * 1000), ixWrap(async () => indices.compare()));
  app.post("/api/admin/indices/refresh", requireAdmin, limiter(20, 10 * 60 * 1000), ixWrap(async (req) => indices.view(ixId((req.body || {}).index), { refresh: true })));
  app.post("/api/admin/indices/ai", requireSuper, limiter(12, 10 * 60 * 1000), ixWrap(async (req) => ({ entry: await indices.askAi(ixId((req.body || {}).index), (req.body || {}).horizon === "year" ? "year" : "month"), settings: indices.settings() })));
  app.put("/api/admin/indices/settings", requireSuper, limiter(30, 10 * 60 * 1000), ixWrap(async (req) => indices.setSettings(req.body || {})));

  /* -------------------------------------------- the Research tab's Top 10 (server/picks.js) */
  // ranked by itself before the open, every five minutes in the session and after the close; the AI
  // reviews it on need; each list is scored on its session. Also the live RSI extremes of the NIFTY 500.
  const picks = opts.topPicks || new TopPicks({ market, ai, docs: store.docs, now: opts.now, log: opts.log || console });
  if (opts.picksWatch !== false && opts.alertWatch !== false) picks.start();
  const pkWrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      if (!(err instanceof PicksError)) console.error("[picks]", err && err.message ? err.message : err);
      res.status(err.status || 500).json({ error: err.code || "picks_failed", message: err.message || "The Top 10 failed." });
    }
  };
  app.get("/api/admin/picks", requireAdmin, limiter(240, 60 * 1000), pkWrap(async () => picks.view()));
  app.post("/api/admin/picks/refresh", requireSuper, limiter(12, 10 * 60 * 1000), pkWrap(async () => {
    picks.build({ trigger: "asked" }).catch(() => {});
    return picks.view();
  }));
  app.put("/api/admin/picks/settings", requireSuper, limiter(30, 10 * 60 * 1000), pkWrap(async (req) => picks.setSettings(req.body || {})));
  app.get("/api/admin/picks/rsi", requireAdmin, limiter(240, 60 * 1000), pkWrap(async () => picks.rsiExtremes()));

  // The live scanner (server/scanner.js): the NIFTY 100 kept in a buffer from Zerodha's live stream and
  // read every two seconds — eligible intraday stocks, next-move leans, plans, its own record — with the
  // AI Engine on need. It reaches the pages on the live-price stream they already hold (?scan=1).
  const scanner = opts.scannerService || new Scanner({ market, ai, docs: store.docs, now: opts.now, log: opts.log || console });
  market.scanner = scanner;
  // it needs the live stream: never started without one (the test suite has none)
  if (market.ticker && opts.scanner !== false && opts.alertWatch !== false) scanner.start();
  const scWrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      if (!(err instanceof ScannerError)) console.error("[scanner]", err && err.message ? err.message : err);
      res.status(err.status || 500).json({ error: err.code || "scanner_failed", message: err.message || "The scanner failed." });
    }
  };
  app.get("/api/admin/scanner", requireAdmin, limiter(300, 60 * 1000), scWrap(async () => scanner.view()));
  app.get("/api/admin/scanner/stock/:symbol", requireAdmin, limiter(240, 60 * 1000), scWrap(async (req) => scanner.detail(String(req.params.symbol || "").slice(0, 25))));
  app.post("/api/admin/scanner/ai", requireSuper, limiter(10, 10 * 60 * 1000), scWrap(async () => ({ ai: await scanner.review("you asked"), view: scanner.view() })));
  app.put("/api/admin/scanner/settings", requireSuper, limiter(30, 10 * 60 * 1000), scWrap(async (req) => scanner.setSettings(req.body || {})));

  // The paper robot (server/robot): takes the live scanner's calls with play money, records everything like a
  // flight recorder, is compared with the trader's real day after the close, corrects its own mistakes and
  // studies the NIFTY 100's levels each evening. It reads the scanner through this narrow door and has no way
  // to reach the broker, the trading switch or an order.
  const robot =
    opts.robot ||
    new PaperRobot({
      docs: store.docs,
      market,
      ai,
      now: opts.now,
      log: opts.log || console,
      gapMs: opts.robotGapMs,
      feed: {
        live: () => scanner.state === "live" && scanner._live(),
        picks: () => scanner.view().picks,
        rowOf: (s) => scanner.rowOf(s),
        priceOf: (s) => scanner.priceOf(s),
        detail: (s) => scanner.detail(s),
        lean: () => (scanner.lean && typeof scanner.lean.score === "number" ? scanner.lean.score : null),
      },
      // the trader's real trades of a day, from Trade Analysis's snapshot (the comparison after the close)
      actual: async (date) => {
        const s = await analysis.snapshot(date);
        return s && s.available ? s.trades : [];
      },
    });
  if (market.ticker && opts.robotAuto !== false && opts.alertWatch !== false) robot.start();
  mountRobot(app, { robot, requireSuper, limiter });

  // The 15-minute forecast (server/horizon.js): learns from the stored NIFTY 100 history the robot keeps, forecasts the
  // price, the high and the low for the stock on the Desk, scores itself and learns again each evening. Reads the market;
  // never trades, never asks an AI model.
  // Automatic training and evening learning (forecaster, early calls, evidence desk) wait 5 minutes after a start and are never
  // started again at once after a run the server did not live through (server/train-guard.js: the once-a-minute 502 loop of
  // 21 Nov 2026). Under the test runner there is none unless a test passes one, so the tests' timing is as before.
  const trainGuard = opts.trainGuard !== undefined ? opts.trainGuard : process.env.NODE_TEST_CONTEXT ? null : new TrainGuard({ docs: store.docs, now: opts.now, log: opts.log || console });
  const horizon =
    opts.horizon ||
    new Horizon({ market, docs: store.docs, history: () => robot.history, universe: () => robot.universe(), ai, playbook: ai.playbook, guard: trainGuard, now: opts.now, log: opts.log || console });
  if (market.ticker && opts.horizonWatch !== false && opts.alertWatch !== false) horizon.start();
  const hWrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      if (!err.status) console.error("[horizon]", err && err.message ? err.message : err);
      res.status(err.status || 500).json({ error: err.code || "horizon_failed", message: err.message || "The forecast failed." });
    }
  };
  app.get("/api/admin/market/horizon", requireAdmin, hWrap(async () => horizon.board()));
  app.get("/api/admin/market/horizon/:symbol", requireAdmin, limiter(240, 60 * 1000), hWrap(async (req) => horizon.view(String(req.params.symbol || "").trim().toUpperCase().slice(0, 25))));
  // learn from the stored history now (a full training), or learn the sessions since the last one (it also happens by itself)
  // (the work runs in the background; a refusal that comes at once, such as "no history yet", is returned at once)
  const startJob = async (run) => {
    const p = run();
    const early = await Promise.race([p.then(() => null, (e) => e), new Promise((r) => setTimeout(() => r(null), 120))]);
    if (early) throw early;
    p.catch(() => {});
    return horizon.board();
  };
  app.post("/api/admin/market/horizon/train", requireSuper, limiter(6, 60 * 60 * 1000), hWrap(async () => startJob(() => horizon.train({ trigger: "you asked" }))));
  app.post("/api/admin/market/horizon/learn", requireSuper, limiter(12, 60 * 60 * 1000), hWrap(async () => startJob(() => horizon.learnDays({ trigger: "you asked" }))));

  // The early calls (server/ahead.js): 5 and 15 minutes before it happens — will the move that is on turn or carry on,
  // is a large move or a quiet stretch coming — beside the forecaster's trend call. Learns from the same stored
  // sessions through the forecaster, keeps and checks every call, learns again each evening. Reads the market; never
  // trades, never asks an AI model.
  const ahead = opts.ahead || new Ahead({ horizon, docs: store.docs, guard: trainGuard, now: opts.now, log: opts.log || console });
  if (market.ticker && opts.horizonWatch !== false && opts.alertWatch !== false) ahead.start();
  const startAhead = async (run) => {
    const p = run();
    const early = await Promise.race([p.then(() => null, (e) => e), new Promise((r) => setTimeout(() => r(null), 120))]);
    if (early) throw early;
    p.catch(() => {});
    return ahead.board();
  };
  app.get("/api/admin/market/ahead", requireAdmin, hWrap(async () => ahead.board()));
  app.get("/api/admin/market/ahead/:symbol", requireAdmin, limiter(240, 60 * 1000), hWrap(async (req) => ahead.view(String(req.params.symbol || "").trim().toUpperCase().slice(0, 25))));
  app.post("/api/admin/market/ahead/train", requireSuper, limiter(6, 60 * 60 * 1000), hWrap(async () => startAhead(() => ahead.train({ trigger: "you asked" }))));
  app.post("/api/admin/market/ahead/learn", requireSuper, limiter(12, 60 * 60 * 1000), hWrap(async () => startAhead(() => ahead.learnDays({ trigger: "you asked" }))));

  // The evidence desk (server/evidence.js): everything weighed into one call for the next 5 and 15 minutes — 40 day-trading
  // techniques measured on the stored history and stacked on the forecaster's call, with the order book price by price (NSE and
  // BSE), open interest, the option chain, NIFTY, the sector, India VIX, GIFT NIFTY, Wall Street and Asia read live, kept and
  // checked. It may ask the AI ONCE about a stock a person has just opened, when its own test says the AI is needed (the owner's
  // instruction of 2026-11-20; switch and limits on the AI page). Never on a timer; never an order.
  const evidence =
    opts.evidence ||
    new Evidence({
      horizon,
      market,
      docs: store.docs,
      ahead,
      ask: opts.evidenceAsk || ((req) => askDefault(ai, req)),
      aiReady: opts.evidenceAsk ? () => true : () => aiTeam(ai).models.length > 0,
      guard: trainGuard,
      holding: () => {
        const p = liveBook.positions();
        return ((p && p.net) || []).filter((x) => x.quantity !== 0 && x.exchange === "NSE").map((x) => ({ symbol: x.symbol, side: x.quantity > 0 ? "long" : "short", quantity: Math.abs(x.quantity), average: x.average }));
      },
      now: opts.now,
      log: opts.log || console,
    });
  ai.guard.openAllowed = () => evidence.aiSettings().mode !== "off";
  // the board in brief for the AI's briefs, never holding an answer up for more than six seconds (the AI folder holds no timer of its own)
  ai.deskEvidence = (symbol) => Promise.race([evidence.brief(symbol, { full: true }), new Promise((r) => setTimeout(() => r(null), 6000))]).catch(() => null);
  flight.evidence = evidence;
  if (market.ticker && opts.horizonWatch !== false && opts.alertWatch !== false) evidence.start();

  // The consensus forecast (server/consensus.js, 21 Nov 2026): ONE level forecast for the next 5 and 15 minutes — price, band,
  // chance of a rise, the level likely touched first — from the 15-minute forecaster, the evidence desk, the early calls and the
  // live order book, by a blend that learns from its own checked forecasts how much each deserves, and leads only once its record
  // beats the forecaster alone. It sweeps the stocks followed live every 5-minute bar. Arithmetic only: no AI, no order.
  const consensus = opts.consensus || new Consensus({ horizon, evidence, ahead, market, docs: store.docs, playbook: ai.playbook, now: opts.now, log: opts.log || console, isTradingDay: (d) => nseCalendar.isTradingDay(d) });
  if (market.ticker && opts.horizonWatch !== false && opts.alertWatch !== false) consensus.start();
  // Delivery (server/market/delivery.js): NSE's public daily file of traded and delivered quantity for every stock — the one
  // daily reading the broker does not give. No login, no AI; under test it touches no network unless a fetch is handed to it.
  const delivery =
    opts.delivery ||
    new DeliveryStore({ dir: dataDir, fetchImpl: opts.deliveryFetch !== undefined ? opts.deliveryFetch : underTest || opts.marketFetch ? null : globalThis.fetch, now: opts.now, log: opts.log || console, isTradingDay: (d) => nseCalendar.isTradingDay(d) });
  if (!underTest && opts.deliveryWatch !== false) delivery.start();
  // The trade setup (server/setup.js, 23 Nov 2026): the fifteen morning readings — NIFTY and BANKNIFTY levels, their option
  // writing, PCR, VIX, FII/DII flows, every F&O stock's build-up, high delivery and the F&O ban — kept fresh BY ITSELF from Zerodha
  // and NSE's public files, with a market lean that is recorded and scored. No AI, no button. It feeds the consensus refiner,
  // TradeAI and the dossier.
  const setup =
    opts.setup ||
    new TradeSetup({ market, delivery, docs: store.docs, playbook: ai.playbook, fetchImpl: opts.setupFetch !== undefined ? opts.setupFetch : underTest || opts.marketFetch ? async () => ({ ok: false, status: 0 }) : null, now: opts.now, log: opts.log || console, isTradingDay: (d) => nseCalendar.isTradingDay(d) });
  if (market.ticker && opts.horizonWatch !== false && opts.alertWatch !== false && opts.setupWatch !== false) setup.start();
  consensus.setup = setup;
  ai.deskSetup = () => setup.brief();
  ai.deskSetupFor = (symbol) => setup.forStock(symbol);
  live.watch("setup", () => setup.fingerprint());
  // The memory governor (server/memory.js): drops these caches when memory is tight, holds heavy jobs back, and outside market
  // hours restarts the server cleanly before pm2's hard limit would kill it mid-work. Every cache here refills from its source.
  const memory =
    opts.memory ||
    new MemoryGovernor({
      log: opts.log || console,
      now: opts.now,
      inSession: () => {
        const t = new Date((opts.now ? opts.now() : Date.now()) + 5.5 * 3600000);
        const m = t.getUTCHours() * 60 + t.getUTCMinutes();
        return nseCalendar.isTradingDay(t.toISOString().slice(0, 10)) && m >= 9 * 60 && m < 15 * 60 + 45;
      },
    });
  const dropMap = (o, k) => () => o && o[k] && typeof o[k].clear === "function" && o[k].clear();
  memory.register("forecaster views", dropMap(horizon, "_cache")).register("evidence views", dropMap(evidence, "_cache")).register("early-call views", dropMap(ahead, "_cache")).register("consensus views", dropMap(consensus, "_cache")).register("option chains", dropMap(market, "_chainAt")).register("delivery days", dropMap(delivery, "_days")).register("index analyses", dropMap(indices, "cache"));
  if (trainGuard) trainGuard.memory = memory;
  if (!underTest && opts.memoryWatch !== false) memory.start();
  app.get("/api/admin/system/memory", requireSuper, (req, res) => res.json(memory.status()));
  app.get("/api/admin/market/setup", requireAdmin, limiter(240, 60 * 1000), hWrap(async () => setup.view()));
  app.get("/api/admin/market/setup/stock/:symbol", requireAdmin, limiter(240, 60 * 1000), hWrap(async (req) => setup.forStock(csSym(req))));
  // The research dossier (server/dossier.js): everything the desk knows about one stock in one read — for TradeAI's deep research
  const researchOf = (symbol) => dossier(symbol, { market, horizon, evidence, ahead, consensus, delivery, setup, ensemble: ai.ensemble, now: opts.now });
  ai.deskConsensus = (symbol) => consensus.view(symbol);
  ai.deskDelivery = (symbol) => delivery.forSymbol(symbol);
  ai.deskDossier = researchOf;
  const csSym = (req) => String(req.params.symbol || "").trim().toUpperCase().slice(0, 25);
  app.get("/api/admin/market/consensus", requireAdmin, hWrap(async () => consensus.board()));
  app.get("/api/admin/market/consensus/:symbol", requireAdmin, limiter(240, 60 * 1000), hWrap(async (req) => consensus.view(csSym(req))));
  app.get("/api/admin/market/delivery/:symbol", requireAdmin, limiter(240, 60 * 1000), hWrap(async (req) => delivery.forSymbol(csSym(req))));
  // "Read now": the delivery files that are missing (a few hundred KB of public data each; no AI, no login)
  app.post("/api/admin/market/delivery/refresh", requireAdmin, limiter(6, 60 * 60 * 1000), hWrap(async () => ({ read: await delivery.refresh({ trigger: "you asked" }), ...delivery.status() })));
  app.get("/api/admin/market/dossier/:symbol", requireAdmin, limiter(60, 60 * 1000), hWrap(async (req) => researchOf(csSym(req))));
  const startEvidence = async (run) => {
    const p = run();
    const early = await Promise.race([p.then(() => null, (e) => e), new Promise((r) => setTimeout(() => r(null), 120))]);
    if (early) throw early;
    p.catch(() => {});
    return evidence.board();
  };
  const evSym = (req) => String(req.params.symbol || "").trim().toUpperCase().slice(0, 25);
  app.get("/api/admin/market/evidence", requireAdmin, hWrap(async () => evidence.board()));
  // the next 15 minutes for each open position: ?list=RELIANCE:long,TCS:short (the page sends what it shows; nothing of an account is read here)
  app.get(
    "/api/admin/market/evidence/positions",
    requireAdmin,
    limiter(120, 60 * 1000),
    hWrap(async (req) => ({
      rows: await evidence.forPositions(
        String(req.query.list || "")
          .split(",")
          .slice(0, 30)
          .map((x) => x.split(":"))
          .filter((x) => x[0])
          .map(([symbol, side]) => ({ symbol: symbol.trim().toUpperCase().slice(0, 25), side: side === "short" ? "short" : "long" }))
      ),
    }))
  );
  app.get("/api/admin/market/evidence/:symbol", requireAdmin, limiter(240, 60 * 1000), hWrap(async (req) => evidence.view(evSym(req))));
  // a stock was opened on the Desk: the AI is asked once about it when (and only when) the evidence desk's own test says it is needed
  app.post("/api/admin/market/evidence/:symbol/open", requireAdmin, limiter(120, 60 * 1000), hWrap(async (req) => evidence.opened(evSym(req), { isOwner: req.user.role === "superadmin" })));
  // "Ask the AI" on the board: a click
  app.post("/api/admin/market/evidence/:symbol/ai", requireAdmin, limiter(30, 15 * 60 * 1000), hWrap(async (req) => evidence.askNow(evSym(req), { isOwner: req.user.role === "superadmin" })));
  app.put("/api/admin/market/evidence/ai", requireSuper, limiter(30, 15 * 60 * 1000), hWrap(async (req) => evidence.setAi(req.body || {}, req.user.email)));
  app.post("/api/admin/market/evidence/train", requireSuper, limiter(6, 60 * 60 * 1000), hWrap(async () => startEvidence(() => evidence.train({ trigger: "you asked" }))));
  app.post("/api/admin/market/evidence/learn", requireSuper, limiter(12, 60 * 60 * 1000), hWrap(async () => startEvidence(() => evidence.learnDays({ trigger: "you asked" }))));

  // The expiry calendar (server/expiry.js): every weekly and monthly derivatives expiry on NSE and BSE, read from the exchanges'
  // own contract lists (a public file: no login, no key, no AI). It reads them by itself every morning and twice a day, works
  // the rest of the year out from the weekday those contracts fall on and the holiday calendar, and keeps every date that changes.
  // Under test it touches no network unless a fetch is handed to it.
  const expiryCal =
    opts.expiryCalendar ||
    new ExpiryCalendar({
      docs: store.docs,
      cal: { isTradingDay: nseCalendar.isTradingDay, holidayName: nseCalendar.holidayName, known: nseCalendar.known },
      fetchImpl: opts.expiryFetch !== undefined ? opts.expiryFetch : underTest || opts.marketFetch ? null : globalThis.fetch,
      now: opts.now,
      log: opts.log || console,
    });
  if (!underTest && opts.expiryWatch !== false) expiryCal.start();
  app.get("/api/admin/market/expiries", requireAdmin, limiter(120, 60 * 1000), hWrap(async () => expiryCal.view()));
  // "Check now": read the exchanges' lists this minute (a few megabytes of public data; no AI, no login)
  app.post("/api/admin/market/expiries/refresh", requireAdmin, limiter(12, 60 * 60 * 1000), hWrap(async () => {
    const r = await expiryCal.refresh({ trigger: "you asked" });
    return { ...expiryCal.view(), refreshed: r };
  }));

  // The market recorder (server/recorder.js): every minute of every session it reads every NIFTY 100 stock, the watchlist, the indices
  // and each one's near-month future — price, volume, the quantity waiting to buy and to sell, open interest — with no page open, keeps
  // the session in the database, and each evening learns what those readings add to the forecaster. It reads only; it asks no AI model.
  const recorder =
    opts.recorder ||
    new Recorder({ market, docs: store.docs, universe: () => robot.universe(), horizon, playbook: ai.playbook, isTradingDay: (d) => nseCalendar.isTradingDay(d), now: opts.now, log: opts.log || console });
  horizon.flow = recorder; // the forecast shows the order book and open interest of the bar's close, and uses them once they are proven
  if (market.ticker && opts.recorderWatch !== false && opts.alertWatch !== false && !underTest) recorder.start();
  app.get("/api/admin/recorder", requireAdmin, (req, res) => res.json(recorder.status()));
  app.post("/api/admin/recorder/learn", requireSuper, limiter(12, 60 * 60 * 1000), async (req, res) => {
    recorder.learn({ trigger: "you asked" }).catch(() => {});
    await new Promise((r) => setTimeout(r, 120));
    res.json(recorder.status());
  });

  // The vault (server/vault.js): every dataset in the database as a download, and backups of all of it — made by itself once a day,
  // kept on the server's disk and downloadable. Owner only. A restore is done with the server stopped (server/restore.js).
  const vault = opts.vault || new Vault({ docs: store.docs, dataDir, recorder, now: opts.now, log: opts.log || console });
  const vWrap = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error("[vault]", err && err.message ? err.message : err);
      if (!res.headersSent) res.status(500).json({ error: "vault_failed", message: err.message || "The download failed." });
      else res.end();
    }
  };
  const sendFile = (res, name, type, body) => {
    res.set({ "Content-Type": type, "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" });
    res.send(body);
  };
  const missing = (res, message = "There is nothing stored under that name.") => res.status(404).json({ error: "not_found", message });
  // a big download is written through gzip a piece at a time, so it never sits whole in memory
  const gzStream = async (res, name, pieces) => {
    res.set({ "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" });
    const gz = zlibLib.createGzip();
    gz.pipe(res);
    for await (const piece of pieces) if (piece && !gz.write(piece)) await new Promise((r) => gz.once("drain", r));
    gz.end();
  };
  app.get("/api/admin/vault", requireSuper, limiter(60, 60 * 1000), vWrap(async (req, res) => res.json({ ...vault.status(), datasets: await vault.datasets(), recorder: recorder.status() })));
  app.get("/api/admin/vault/status", requireSuper, limiter(120, 60 * 1000), vWrap(async (req, res) => res.json(vault.status())));
  app.put("/api/admin/vault/settings", requireSuper, limiter(30, 10 * 60 * 1000), vWrap(async (req, res) => {
    const b = req.body || {};
    vault.setSettings({ auto: typeof b.auto === "boolean" ? b.auto : undefined, keep: Number.isInteger(b.keep) ? b.keep : undefined });
    res.json(vault.status());
  }));
  app.post("/api/admin/vault/backup", requireSuper, limiter(12, 60 * 60 * 1000), vWrap(async (req, res) => {
    await vault.backup({ trigger: "you asked" });
    res.json(vault.status());
  }));
  app.get("/api/admin/vault/backups/:file", requireSuper, limiter(30, 10 * 60 * 1000), vWrap(async (req, res) => {
    const p = vault.pathOf(String(req.params.file || ""));
    if (!p) return missing(res, "There is no backup with that name.");
    res.set({ "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${path.basename(p)}"`, "Cache-Control": "no-store" });
    fs.createReadStream(p).on("error", () => res.end()).pipe(res);
  }));
  app.delete("/api/admin/vault/backups/:file", requireSuper, limiter(30, 10 * 60 * 1000), vWrap(async (req, res) => {
    if (!vault.remove(String(req.params.file || ""))) return missing(res, "There is no backup with that name.");
    res.json(vault.status());
  }));
  app.get("/api/admin/vault/collection/:name", requireSuper, limiter(60, 10 * 60 * 1000), vWrap(async (req, res) => {
    const name = String(req.params.name || "");
    const items = vault.items(name);
    if (!items) return missing(res);
    if (req.query.format === "csv") {
      const csv = vault.collectionCsv(name);
      if (csv === null) return missing(res, "This list has its own downloads.");
      return sendFile(res, `${name}.csv`, "text/csv; charset=utf-8", csv);
    }
    sendFile(res, `${name}.json`, "application/json; charset=utf-8", JSON.stringify(items));
  }));
  app.get("/api/admin/vault/doc", requireSuper, limiter(120, 10 * 60 * 1000), vWrap(async (req, res) => {
    const name = String(req.query.name || "");
    const d = vault.doc(name);
    if (!d) return missing(res);
    sendFile(res, name.replace(/\//g, "-"), d.type, d.body);
  }));
  app.get("/api/admin/vault/log", requireSuper, limiter(30, 10 * 60 * 1000), vWrap(async (req, res) => {
    const name = String(req.query.name || "");
    const body = vault.log_(name);
    if (body === null) return missing(res);
    sendFile(res, `${name.replace(/\//g, "-")}.jsonl`, "application/x-ndjson; charset=utf-8", body);
  }));
  // the recorded tape: one session as a spreadsheet, or every session in one compressed file
  app.get("/api/admin/vault/tape.csv.gz", requireSuper, limiter(6, 10 * 60 * 1000), vWrap(async (req, res) => {
    const dates = recorder.status().days.map((d) => d.date).concat(Object.keys(recorder._index().days)).filter((d, i, a) => a.indexOf(d) === i).sort();
    await gzStream(res, "recorded-tape.csv.gz", (async function* pieces() {
      let first = true;
      for (const date of dates) {
        const csv = await recorder.csv(date);
        if (!csv) continue;
        yield first ? csv : csv.slice(csv.indexOf("\n") + 1);
        first = false;
      }
    })());
  }));
  app.get("/api/admin/vault/tape/:date", requireSuper, limiter(60, 10 * 60 * 1000), vWrap(async (req, res) => {
    const date = String(req.params.date || "");
    const csv = /^\d{4}-\d{2}-\d{2}$/.test(date) ? await recorder.csv(date) : null;
    if (!csv) return missing(res, "No session is recorded for that date.");
    sendFile(res, `recorded-tape-${date}.csv`, "text/csv; charset=utf-8", csv);
  }));
  // the NIFTY 100's stored 5-minute history: one stock as a spreadsheet, or every stock in one compressed file
  app.get("/api/admin/vault/history.csv.gz", requireSuper, limiter(6, 10 * 60 * 1000), vWrap(async (req, res) => {
    const symbols = vault.historySymbols();
    await gzStream(res, "nifty100-5minute-history.csv.gz", (async function* pieces() {
      for (let i = 0; i < symbols.length; i += 1) {
        yield vault.historyCsv(symbols[i], i === 0);
        await new Promise((r) => setImmediate(r));
      }
    })());
  }));
  app.get("/api/admin/vault/history/:symbol", requireSuper, limiter(120, 10 * 60 * 1000), vWrap(async (req, res) => {
    const symbol = String(req.params.symbol || "").toUpperCase().slice(0, 25);
    const csv = vault.historyCsv(symbol);
    if (!csv) return missing(res, "That stock's history is not stored.");
    sendFile(res, `${symbol.replace(/[^A-Z0-9&_-]/g, "_")}-5minute.csv`, "text/csv; charset=utf-8", csv);
  }));

  // The desk's intraday knowledge base (market/knowledge.js) and the set-up lab (server/setuplab.js):
  // every classic set-up measured on the NIFTY 100's recent sessions after costs, each weekday evening.
  // Its record weighs each set-up in the live scanner and is written into the trading-skills file.
  const setupLab = opts.setupLabService || new SetupLab({ market, ai, docs: store.docs, now: opts.now, log: opts.log || console });
  scanner.edges = () => setupLab.edges();
  if (market.ticker && opts.setupLab !== false && opts.alertWatch !== false) setupLab.start();
  const labWrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      if (!(err instanceof SetupLabError)) console.error("[setuplab]", err && err.message ? err.message : err);
      res.status(err.status || 500).json({ error: err.code || "setuplab_failed", message: err.message || "The set-up lab failed." });
    }
  };
  app.get("/api/admin/setups", requireAdmin, limiter(120, 60 * 1000), labWrap(async () => ({ lab: setupLab.view(), knowledge: knowledge.all() })));
  // the whole knowledge base by area, or (?q=) the pages that answer a question best — the same search the AI uses
  app.get("/api/admin/knowledge", requireAdmin, limiter(240, 60 * 1000), labWrap(async (req) => {
    const q = String(req.query.q || "").slice(0, 200);
    if (q.trim()) return { q, results: knowledge.search(q, { limit: 8 }) };
    const all = knowledge.all();
    return { count: all.count, areas: all.areas, packs: Object.keys(knowledge.PACKS) };
  }));
  app.post("/api/admin/setups/run", requireSuper, limiter(4, 60 * 60 * 1000), labWrap(async () => {
    setupLab.run({ trigger: "asked" }).catch(() => {});
    return { lab: setupLab.view() };
  }));

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
  // the agent's readers outside the AI folder: the exit coach's reading, the tape, the level map, the Lab, the learner
  ai.tradeai.desk = makeDeskReaders({ market, flight, analysis, learn, now: opts.now || (() => Date.now()) });
  // …and the index history: NIFTY 50 and SENSEX month by month, the projections and their record
  ai.tradeai.desk.scanner = () => scanner.brief();
  /* ---------------------------------------------------------------- Vinaypedia: Vinay's own learning (server/learning/service.js) */
  // the desk's knowledge base by area, official updates read from NSE/SEBI/Zerodha/RBI's own feeds every six hours (no AI), lessons the
  // AI writes on a click (or an "Allow once" popup when new circulars that matter arrive), and the admins' own learnings
  const learningFetch = opts.learningFetch !== undefined ? opts.learningFetch : process.env.NODE_TEST_CONTEXT ? null : globalThis.fetch;
  const learning = opts.learning || new LearningService({ docs: store.docs, fetchImpl: learningFetch, ai, now: opts.now, log: opts.log || console });
  if (opts.learningWatch !== false && opts.alertWatch !== false && learningFetch) learning.start();
  const lWrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error("[vinaypedia]", err && err.message ? err.message : err);
      res.status(status).json({ error: err.code || "learning_failed", message: err.status ? err.message : "Vinaypedia could not do that just now." });
    }
  };
  const noteId = (req) => String(req.params.id || "").replace(/[^a-f0-9]/gi, "").slice(0, 20);
  app.get("/api/admin/learning", requireAdmin, limiter(240, 60 * 1000), lWrap(async (req) => learning.view(req.user)));
  app.post("/api/admin/learning/notes", requireAdmin, limiter(120, 10 * 60 * 1000), lWrap(async (req) => ({ note: learning.addNote(req.body || {}, req.user) })));
  app.put("/api/admin/learning/notes/:id", requireAdmin, limiter(240, 10 * 60 * 1000), lWrap(async (req) => ({ note: learning.updateNote(noteId(req), req.body || {}, req.user) })));
  app.delete("/api/admin/learning/notes/:id", requireAdmin, limiter(240, 10 * 60 * 1000), lWrap(async (req) => ({ removed: learning.removeNote(noteId(req), req.user) })));
  app.post("/api/admin/learning/refresh", requireAdmin, limiter(6, 10 * 60 * 1000), lWrap(async () => learning.refresh()));
  app.post("/api/admin/learning/lessons", requireAdmin, limiter(20, 60 * 60 * 1000), lWrap(async (req) => ({ lesson: await learning.writeLesson(String((req.body || {}).area || "").slice(0, 80), { by: req.user.email }) })));
  app.post("/api/admin/learning/digest", requireAdmin, limiter(10, 60 * 60 * 1000), lWrap(async (req) => ({ digest: await learning.writeDigest({ by: req.user.email }) })));

  // TradeAI's "playbook" reader: the knowledge base searched for the question, the desk's essentials, and
  // what each set-up has measured on this desk
  ai.tradeai.desk.playbook = (query) => ({ found: knowledge.searchText(String(query || ""), { limit: 5, maxChars: 5000 }), essentials: knowledge.relevant({ question: String(query || "") }, 1500), measuredSetups: setupLab.brief() });
  ai.tradeai.desk.picks = async () => ({ ...picks.brief(), rsiExtremes: await picks.rsiExtremes().then((r) => (r.available ? { rule: r.rule, oversold: r.oversold.slice(0, 10), overbought: r.overbought.slice(0, 10) } : { available: false, reason: r.reason })).catch(() => null) });
  ai.tradeai.desk.indices = (name) => indices.brief(/SENSEX|BSE/i.test(String(name || "")) ? "SENSEX" : "NIFTY");
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
    const attachments = Array.isArray(b.attachments) ? b.attachments.map((x) => String(x).slice(0, 40)).slice(0, 8) : []; // files read by /tradeai/attach
    if (!text && !attachments.length) throw Object.assign(new Error("Ask a question."), { status: 400 });
    const from = Number.isInteger(b.from) ? b.from : null; // edit / retry: go back to this question first
    return ai.tradeai.start({ conv: b.conv ? String(b.conv) : null, text, attachments, owner: who(req), isOwner: req.user.role === "superadmin", from, mode: ["auto", "fast", "deep"].includes(b.mode) ? b.mode : null, ...(req.user.role === "superadmin" ? { model: b.model && typeof b.model === "object" ? { provider: String(b.model.provider || "").slice(0, 40), model: String(b.model.model || "").slice(0, 80) } : null, effort: ["auto", "low", "medium", "high"].includes(b.effort) ? b.effort : null } : {}) }); // the model and the thinking level are the owner's to choose: their key, their tokens
  }));
  // a file attached to a question (an image, Word, Excel, PowerPoint, CSV or text): its bytes in, its description out; the file is read
  // on the server (ai/attach.js), kept for a few hours for the owner's questions, and never run or opened
  app.post("/api/admin/tradeai/attach", requireAdmin, limiter(60, 10 * 60 * 1000), express.raw({ type: () => true, limit: "8mb" }), taWrap(async (req) => {
    const name = String(req.query.name || "file").slice(0, 120);
    return { file: ai.tradeai.attach.put(who(req), name, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)) };
  }));
  app.delete("/api/admin/tradeai/attach/:id", requireAdmin, limiter(120, 10 * 60 * 1000), taWrap(async (req) => {
    ai.tradeai.attach.forget(who(req), String(req.params.id || "").slice(0, 40));
    return { ok: true };
  }));
  // how TradeAI answers: the default mode, and whether (and how often a day) the paid model may be used
  app.get("/api/admin/tradeai/activity", requireSuper, limiter(60, 60 * 1000), taWrap(async () => ai.tradeai.activity({ limit: 60 })));
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
  // The automation supervisor (server/supervisor.js): every minute it asks each duty whether it is behind and runs the first that is —
  // so an evening's learning missed because the server or Zerodha was down is caught up by itself, and the one download that used to
  // wait for a page to be opened starts on its own. It calls the services' own methods only: no order, no AI model.
  const kiteOn = () => {
    try {
      return market.mode() === "kite" && (typeof market.kiteState !== "function" || Boolean(market.kiteState().connected));
    } catch (_) {
      return false;
    }
  };
  const daysSince = (date) => (date ? Math.round((Date.parse(new Date((opts.now ? opts.now() : Date.now()) + 5.5 * 3600000).toISOString().slice(0, 10)) - Date.parse(date)) / 86400000) : 999);
  const supervisor =
    opts.supervisor ||
    new Supervisor({
      docs: store.docs,
      now: opts.now,
      log: opts.log || console,
      // nothing in the first 5 minutes after a start (none under the test runner unless a test asks)
      graceMs: opts.supervisorGraceMs !== undefined ? opts.supervisorGraceMs : process.env.NODE_TEST_CONTEXT ? 0 : 5 * 60000,
      isTradingDay: (d) => nseCalendar.isTradingDay(d),
      duties: [
        {
          id: "history",
          name: "NIFTY 100 history (5-minute bars)",
          what: "Tops up the stored year of 5-minute bars the paper robot and the forecaster learn from.",
          quietOnly: true,
          due: () => {
            if (!robot.history || !kiteOn() || robot.history.status().running) return "";
            const n = robot.history.needs().length;
            return n ? `${n} stock${n === 1 ? "" : "s"} not up to date` : "";
          },
          run: () => robot.history.sync({ trigger: "the supervisor" }),
        },
        {
          id: "forecaster-train",
          name: "15-minute forecaster: training",
          what: "Trains the forecaster from the whole stored history when it has no usable model (first start, or its inputs changed).",
          due: () => {
            const p = horizon.pending();
            return !p.busy && p.train ? "no usable model yet" : "";
          },
          run: () => horizon.train({ trigger: "the supervisor" }),
        },
        {
          id: "forecaster-learn",
          name: "15-minute forecaster: evening learning",
          what: "Forecasts, scores and then learns every stored session the model has not seen (normally at 3:40 PM; here when that was missed).",
          quietOnly: true,
          due: () => {
            const p = horizon.pending();
            return !p.busy && p.learn ? `sessions to ${p.to} are stored, learned only to ${p.lastDate}` : "";
          },
          run: () => horizon.learnDays({ trigger: "the supervisor" }),
        },
        {
          id: "early-calls-train",
          name: "Early calls: training",
          what: "Trains the reversal, carry-on and momentum calls from the whole stored history when they have no usable model (first start, or the forecaster's inputs changed). Runs after the forecaster's own training.",
          due: () => {
            const p = ahead.pending();
            return !p.busy && p.train ? "no usable model yet" : "";
          },
          run: () => ahead.train({ trigger: "the supervisor" }),
        },
        {
          id: "early-calls-learn",
          name: "Early calls: evening learning",
          what: "Calls, checks and then learns every stored session the early calls have not seen (normally at 3:45 PM, after the forecaster; here when that was missed).",
          quietOnly: true,
          due: () => {
            const p = ahead.pending();
            return !p.busy && p.learn ? `sessions to ${p.to} are stored, learned only to ${p.lastDate}` : "";
          },
          run: () => ahead.learnDays({ trigger: "the supervisor" }),
        },
        {
          id: "evidence-train",
          name: "Evidence desk: training",
          what: "Measures the 40 day-trading techniques on the whole stored history and fits them with the forecaster's call, when the evidence desk has no usable model (first start, or the forecaster's inputs changed). Runs after the forecaster's own training.",
          due: () => {
            const p = evidence.pending();
            return !p.busy && p.train ? "no usable model yet" : "";
          },
          run: () => evidence.train({ trigger: "the supervisor" }),
        },
        {
          id: "evidence-learn",
          name: "Evidence desk: evening learning",
          what: "Calls, checks and then learns every stored session the evidence desk has not seen (normally at 3:50 PM, after the forecaster and the early calls; here when that was missed).",
          quietOnly: true,
          due: () => {
            const p = evidence.pending();
            return !p.busy && p.learn ? `sessions to ${p.to} are stored, learned only to ${p.lastDate}` : "";
          },
          run: () => evidence.learnDays({ trigger: "the supervisor" }),
        },
        {
          id: "expiry-calendar",
          name: "Expiry calendar: reading the exchanges' contract lists",
          what: "Reads the list of every listed derivatives contract on NSE and BSE (a public file; no login, no AI) and works the expiry calendar out again. Normally every morning before the open and every twelve hours; here when that was missed.",
          due: () => {
            const s = expiryCal.status();
            return s.due ? (s.checkedAt ? `last read ${s.ageHours} hours ago` : "never read yet") : "";
          },
          run: () => expiryCal.refresh({ trigger: "the supervisor" }),
        },
        {
          id: "open-forecast",
          name: "Opening-price forecast: scoring",
          what: "Writes the real open beside forecasts of earlier sessions that were never scored, and learns from them.",
          due: () => {
            const n = openForecast.overdue();
            return n ? `${n} forecast${n === 1 ? "" : "s"} of earlier sessions not scored` : "";
          },
          run: () => openForecast.score(),
        },
        {
          id: "setup-lab",
          name: "Set-up lab",
          what: "Measures every classic set-up on the NIFTY 100's recent sessions (normally each weekday evening).",
          quietOnly: true,
          due: () => (setupLab.behind(supervisor.lastSession()) ? `not measured since before ${supervisor.lastSession()}` : ""),
          run: () => setupLab.run({ trigger: "the supervisor" }),
        },
        {
          id: "level-learner",
          name: "Level learner",
          what: "Studies how the day's levels held on the sessions it has not studied yet (normally after each close).",
          quietOnly: true,
          every: 6 * 3600000,
          due: () => {
            const n = learn.behind();
            return n ? `${n} trading day${n === 1 ? "" : "s"} not studied` : "";
          },
          run: () => learn.run(),
        },
        {
          id: "screener-history",
          name: "Screener history (Nifty 500)",
          what: "Downloads the Nifty 500's daily history the RSI search and the custom scanner need; it used to start only when the Screener was opened.",
          every: 6 * 3600000,
          due: () => {
            if (!kiteOn()) return "";
            const u = market.screenerStatus();
            if (u.job && u.job.running) return "";
            if (!u.ready) return "never downloaded";
            return daysSince(u.through) > 4 && (!u.syncedAt || (opts.now ? opts.now() : Date.now()) - Date.parse(u.syncedAt) > 20 * 3600000) ? `daily closes end on ${u.through}` : "";
          },
          run: async () => {
            market.screenerStart({});
          },
        },
        {
          id: "flow-learner",
          name: "Order book and open interest: evening learning",
          what: "Sets what the forecaster missed on every recorded session against the order book and open interest recorded at that minute, scores the result out of sample, and decides whether the readings may be used.",
          quietOnly: true,
          due: () => {
            const n = recorder.behind();
            return n ? `${n} recorded session${n === 1 ? "" : "s"} not learned yet` : "";
          },
          run: () => recorder.learn({ trigger: "the supervisor" }),
        },
        {
          id: "vinaypedia",
          name: "Vinaypedia's official updates",
          what: "Reads the newest NSE circulars, SEBI, Zerodha Z-Connect and Varsity, and RBI press releases from their own feeds and files them under the learning areas (no AI).",
          every: 2 * 3600000,
          due: () => learning.due(),
          run: () => learning.refresh({ force: true }),
        },
        {
          // last on purpose: the day's backup is made after everything else has caught up
          id: "backup",
          name: "Backup of the whole database",
          what: "Writes every record, list, log and recorded session to one compressed file on the server's disk and keeps the newest few (downloadable under /me → Data & backups).",
          quietOnly: true,
          every: 2 * 3600000,
          due: () => vault.due(),
          run: () => vault.backup({ trigger: "the supervisor" }),
        },
      ],
    });
  if (opts.supervisorWatch !== false && opts.alertWatch !== false && !underTest) supervisor.start();
  // every system that runs by itself, in one list: its schedule in words and whether it is on (for /me → Automation)
  const automationSystems = () => {
    const sys = (id, name, schedule, fn) => {
      try {
        return { id, name, schedule, ...fn() };
      } catch (err) {
        return { id, name, schedule, state: "unknown", detail: `Its state could not be read: ${err && err.message ? err.message : err}` };
      }
    };
    const on = kiteOn();
    const needs = (state, detail = "") => ({ state: on ? state : "needs-zerodha", detail });
    return [
      sys("zerodha", "Zerodha session", "You log in once each trading morning — Zerodha does not allow software to renew a session, so this is the one step that cannot be automatic", () => ({ state: on ? "on" : "needs-you", detail: on ? "Connected" : "Not connected: everything that needs live prices waits for your login" })),
      sys("horizon", "15-minute forecaster", "A forecast on every finished 5-minute bar; every evening at 3:40 PM it forecasts the whole NIFTY 100 day, is scored, then learns it; retrains every five weeks", () => {
        const b = horizon.board();
        return needs(b.trained ? "on" : "learning", b.trained ? `learned to ${b.learning.lastDate}; model in use: ${(b.learning.contest || {}).name || "—"}` : "no usable model yet");
      }),
      sys("ahead", "Early calls (reversal, momentum)", "On every finished 5-minute bar: will the move turn or carry on, is a large move or a quiet stretch coming, 5 and 15 minutes ahead; every call is kept and checked, and every evening at 3:45 PM the whole NIFTY 100 day is called, checked, then learned", () => {
        const b = ahead.board();
        const proven = b.trained ? b.learning.targets.filter((t) => t.proven).length : 0;
        return needs(b.trained ? "on" : "learning", b.trained ? `learned to ${b.learning.lastDate}; ${proven} of ${b.learning.targets.length} calls proven on unseen sessions` : "no usable model yet (it trains after the forecaster)");
      }),
      sys("evidence", "Evidence desk (techniques, order book, world)", "On every finished 5-minute bar: 40 day-trading techniques (each weighed apart in a trend and in a range), the order book, open interest, the sector, GIFT NIFTY and the world weighed into one call for 5 and 15 minutes; every call and every reading is kept and checked, and every evening at 3:50 PM the whole NIFTY 100 day is called, checked, then learned. The AI is asked only about a stock you open, when needed", () => {
        const b = evidence.board();
        const working = b.techniques.filter((t) => t.record[15].verdict === "works").length;
        return needs(b.trained ? "on" : "learning", b.trained ? `learned to ${b.learning.lastDate}; ${working} of ${b.techniques.length} techniques have a proven record here; AI reads today ${b.ai.usedToday} of ${b.ai.perDay}` : "no usable model yet (it trains after the forecaster)");
      }),
      sys("consensus", "Consensus forecast (5 and 15 minutes)", "On every finished 5-minute bar, for the stocks followed live: the forecaster, the evidence desk, the early calls and the order book blended into one level forecast; every forecast is checked 5 and 15 minutes later and the blend learns from it, leading only once its record beats the forecaster alone (no AI)", () => {
        const r = consensus.record();
        const f = r["15"] || {};
        return needs(f.checks ? "on" : "learning", f.checks ? `${f.checks} checks at 15 minutes over ${f.days} sessions; ${f.proven ? "the blend leads (it misses less than the forecaster alone)" : "the forecaster's numbers lead while the blend proves itself"}` : "no forecast checked yet: it learns from the first session it sees");
      }),
      sys("delivery", "Delivery data (NSE)", "Every evening after NSE publishes it: the day's traded and delivered quantity for every stock, from NSE's own public file (no login, no AI); the last 20 sessions are kept for the research and TradeAI", () => {
        const s = delivery.status();
        return { state: s.error && !s.days ? "attention" : s.days ? "on" : "learning", detail: s.days ? `${s.days} sessions kept, newest ${s.newest}${s.error ? ` · the last read failed (${s.error})` : ""}` : s.error ? `not read yet (${s.error})` : "the first read is under way" };
      }),
      sys("expiry", "Expiry calendar (weekly and monthly expiries)", "Every morning before the open and every twelve hours: the exchanges' own contract lists are read (a public file, no login, no AI), the calendar is worked out again, and any expiry date that changed is kept and shown on the Calendar", () => {
        const s = expiryCal.status();
        return { state: !s.on ? "off" : s.error ? "attention" : s.checkedAt ? "on" : "learning", detail: !s.on ? "no network access here: the calendar is worked out from the rule alone" : s.error ? `the last read failed (${s.error}); the last good list is kept` : s.checkedAt ? `last read ${s.ageHours} hours ago · ${s.changes} change${s.changes === 1 ? "" : "s"} kept` : "the first read is under way" };
      }),
      sys("recorder", "Market recorder", "Every minute from 9:15 to 15:30, with no page open: price, volume, the quantity waiting to buy and to sell, and the futures' open interest for every NIFTY 100 stock, your watchlist and the indices — kept in the database", () => {
        const st = recorder.status();
        const kept = `${st.stored.sessions} session${st.stored.sessions === 1 ? "" : "s"} stored`;
        return needs(st.state === "recording" ? "on" : "standing-by", st.state === "recording" ? `${st.today ? st.today.taken : 0} minutes read today · ${kept}` : `${st.detail} · ${kept}`);
      }),
      sys("flow", "Order book and open interest learner", "Each evening: what the forecaster missed is set against the recorded readings, scored on sessions the weights had not seen, and used in the live forecast only while that really reduces the miss", () => {
        const l = recorder.status().learner;
        return needs(l.days ? "on" : "learning", l.days ? `${l.days} session${l.days === 1 ? "" : "s"} learned · ${l.on ? "in use" : "not in use yet (needs proof)"}` : "waiting for the first recorded session");
      }),
      sys("backup", "Backups", "Once a day after the close, the whole database into one file on the server; the newest few are kept and can be downloaded", () => {
        const v = vault.status();
        return v.settings.auto ? { state: "on", detail: v.last ? `newest: ${v.last.at.slice(0, 10)} · ${v.backups.length} kept` : "the first one is made after the close" } : { state: "off", detail: "switched off under /me → Data & backups" };
      }),
      sys("open", "Opening-price forecast", "Forecasts from 8:30 AM, final at 9:00, scored from 9:16, learns after every scoring", () => needs("on", `${openForecast.learned().n || 0} opens learned from`)),
      sys("autopilot", "Autopilot", "Playbooks before the open, triggers watched all session, proposals checked against your limits and graded afterwards — it never sends an order", () => (autopilot.settings().on ? needs("on") : { state: "off", detail: "switched off under Research → Autopilot → Limits" })),
      sys("robot", "Paper robot", "Trades the live scanner's calls with play money all session; compares, corrects itself and studies the NIFTY 100's levels each evening", () => (robot.settings().on ? needs("on") : { state: "off", detail: "switched off under Trade Analysis → Robot" })),
      sys("scanner", "Live scanner", "Reads the NIFTY 100 from the live stream every two seconds while the market is open", () => needs(scanner.state === "live" ? "on" : "standing-by", scanner.state === "live" ? "streaming" : "starts with the session")),
      sys("research", "Research runs", "8:45 AM and 4:00 PM for the watchlist (data only; the AI's notes need your click)", () => (researchAuto.status().enabled ? needs("on") : { state: "off", detail: "switched off under Research" })),
      sys("picks", "Top 10 and RSI watch", "8:35 AM, through the session, and 3:45 PM", () => needs("on")),
      sys("setups", "Set-up lab", "Each weekday evening after the close", () => needs("on")),
      sys("levels", "Level learner", "After every close", () => needs("on")),
      sys("indices", "Indices", "The closing candle, the desk's projections and their scoring after every close", () => needs("on")),
      sys("analysis", "Trade Analysis day snapshot", "3:45 PM every trading day", () => (analysis.settings().auto ? needs("on") : { state: "off", detail: "auto-save switched off" })),
      sys("alerts", "Price alerts", "Checked every 15 seconds in market hours, with no page open", () => needs(alertWatch.status().running ? "on" : "off")),
      sys("paper", "Paper trading (auto mode)", "Follows the desk's live call with play money by itself", () => ((typeof paper._state === "function" ? paper._state().auto : paper.status().auto) ? needs("on") : { state: "off", detail: "your switch, on the Paper page (play money only)" })),
      sys("vinaypedia", "Vinaypedia's official updates", "Every six hours: NSE circulars, SEBI, Zerodha Z-Connect and Varsity, RBI press releases — filed under the learning areas with no AI", () => {
        const st = learning.status();
        const ok = st.sources.filter((x) => x.lastSuccessAt);
        if (!learningFetch) return { state: "off", detail: "not read on this server (no network)" };
        return { state: ok.length ? "on" : "standing-by", detail: ok.length ? `${st.updatesKept} updates kept · ${ok.length} of ${st.sources.length} sources read` : "the first read runs shortly after a start" };
      }),
      sys("ai", "AI models (paid)", "Only when you press an AI button — your rule; every forecast above is arithmetic and costs nothing", () => ({ state: ai.guard.status().auto ? "on" : "click-only", detail: ai.guard.status().auto ? "allowed to run by itself" : "protected: nothing is spent without a click" })),
    ];
  };
  app.get("/api/admin/automation", requireAdmin, (req, res) => res.json({ ...supervisor.status(), systems: automationSystems() }));
  // The command screen ("Now"): every followed stock with its price and its calls for 5 and 15 minutes, the market's own
  // state, what every automatic system is doing and how today's checks have gone — one read, refreshed the moment any of
  // it changes (the live topics "now", "evidence", "horizon", "market", "automation"). Nothing of an account is in it.
  app.get(
    "/api/admin/market/now",
    requireAdmin,
    limiter(240, 60 * 1000),
    hWrap(async () => {
      let symbols = [];
      try {
        symbols = horizon.watching();
      } catch (_) {
        symbols = [];
      }
      const board = await evidence.nowBoard(symbols);
      let ctx = null;
      try {
        ctx = await market.context();
      } catch (_) {
        ctx = null;
      }
      const gift = ctx && ctx.available ? (ctx.items || []).find((x) => x.id === "gift" && x.available !== false) : null;
      const systems = automationSystems().map((s) => ({ id: s.id, name: s.name, state: s.state, detail: s.detail }));
      let forecaster = null;
      let early = null;
      try {
        forecaster = horizon.checkTotals();
        early = ahead.board().live || null;
      } catch (_) {
        forecaster = null;
      }
      return {
        ...board,
        mode: market.mode(),
        market: ctx && ctx.available ? { available: true, session: ctx.session, tide: ctx.tide ? { label: ctx.tide.label, score: ctx.tide.score, summary: ctx.tide.summary } : null, nifty: ctx.nifty, vix: ctx.vix, gift: gift ? { last: gift.last, changePct: gift.changePct } : null, breadth: ctx.breadth, sectors: (ctx.sectors || []).map((s) => ({ name: s.name, changePct: s.changePct })) } : { available: false, reason: (ctx && ctx.reason) || "The market could not be read." },
        systems,
        checks: { forecaster, early },
      };
    })
  );
  // look now, instead of at the next minute
  app.post("/api/admin/automation/run", requireSuper, limiter(20, 10 * 60 * 1000), async (req, res) => {
    supervisor.tick().catch(() => {});
    await new Promise((r) => setTimeout(r, 150));
    res.json({ ...supervisor.status(), systems: automationSystems() });
  });

  // The live channel (one connection per browser; see src/admin/live.js) and what the hub watches. A watcher's value is a cheap fingerprint of
  // the server's own state: when it changes, its topic is published and every page that shows it re-reads.
  app.get("/api/admin/live", requireAdmin, live.handler());
  app.get("/api/admin/live/status", requireSuper, (req, res) => res.json(live.status()));
  live.watch("market", () => {
    const k = market.kiteState();
    return [market.mode(), k.connected, k.user, k.expiresAt, Boolean(market.ticker && market.ticker.isLive())];
  });
  live.watch("trading", () => {
    const s = trading.status();
    return [s.enabled, s.changedAt, s.riskLock, (s.updates || []).length, s.connected, s.streaming, s.limits];
  });
  live.watch("paper", () => {
    const s = paper.status();
    return [s.auto, s.autoSince, s.tested && s.tested.total];
  });
  live.watch("research", () => {
    const s = researchAuto.status();
    return [s.enabled, s.withAi, s.lastRuns, (s.history || []).map((h) => h.at || h.startedAt || h.finishedAt)];
  });
  live.watch("alerts", () => market.alerts());
  live.watch("robot", () => {
    const st = robot.s || {};
    const rec = robot.rec || {};
    return [robot.settings && robot.settings().on, (st.open || []).map((p) => `${p.symbol}:${p.qty}`), (st.log || []).length, Object.keys(rec.trades || {}).length, (rec.decisions || []).length, st.learned];
  });
  live.watch("horizon", () => horizon.fingerprint());
  live.watch("ahead", () => ahead.fingerprint());
  live.watch("evidence", () => evidence.fingerprint());
  live.watch("automation", () => {
    const st = supervisor.status();
    return [st.running && st.running.id, st.behind, st.events[0] && st.events[0].at, st.duties.map((d) => d.state)];
  });
  live.watch("data", () => [recorder.fingerprint(), vault.fingerprint()]);
  live.watch("accounts", () => accounts.fingerprint());
  live.watch("open", () => openForecast.fingerprint());
  live.watch("expiry", () => expiryCal.fingerprint());
  live.watch("autopilot", () => autopilot.fingerprint());
  live.watch("ai", () => [ai.guard.status(), ai.status()]);
  live.watch("social", () => (market.social && typeof market.social.status === "function" ? market.social.status() : null));
  live.watch("learning", () => learning.fingerprint());
  live.watch("system", () => [whatsapp ? whatsapp.status() : null, notifier.status(), temple.settings()]);
  live.watch("holidays", () => nseHolidays.fingerprint());
  live.watch("health", () => [market.mode(), trading.status().enabled, trading.status().riskLock, alertWatch ? alertWatch.status() : null, ai.configured(), horizon.fingerprint()]);
  if (opts.liveWatch !== false) live.start();

  app.get("/api/admin/health", requireAdmin, limiter(60, 60 * 1000), async (req, res) => {
    try {
      res.json(await buildHealth({ now: opts.now, docs, dataDir, memory, trainGuard, supervisor, recorder, vault, horizon, openForecast, autopilot, robot, market, ai, trading, analysis, paper, researchAuto, notifier, alertWatch, whatsapp, temple, holidays, nseHolidays, exchangeClock, googleConfigured: () => credentials().source !== "none" }, { secure: isSecure(req), host: req.get("host") || "" }));
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
    learning,
    nseHolidays,
    exchangeClock,
    market,
    ai,
    tradeSetup: setup,
    trading,
    scanner,
    setupLab,
    openForecast,
    horizon,
    ahead,
    evidence,
    expiryCal,
    kundali,
    expenses,
    live,
    supervisor,
    recorder,
    vault,
    accounts,
    prefs,
    autopilot,
    get setupToken() {
      return setupToken;
    },
  };
}

module.exports = {
  budget,
  logSafe, createApp, isLocalHost, SESSION_COOKIE };
