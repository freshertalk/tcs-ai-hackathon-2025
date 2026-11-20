"use strict";
// A person's own Zerodha account: someone the owner has let in can connect THEIR Kite ID and trade on it from this
// site — with their own key, their own daily login, their own trading switch, limits, risk guard and audit trail.
//
//   WHO      only people on the owner's admin list, and only those the owner has switched this on for
//            (/me → People & accounts). The owner trades on the site's own connection as before; this is for the others.
//   WHOSE    Zerodha ties a Kite Connect app to ONE client ID: a login with any other ID is refused ("the user is not
//            enabled for the app"). So each person brings their own Kite Connect app — its API key and secret — and
//            sets its redirect URL to this site's (shown on the card). Nothing is shared between accounts.
//   HOW      each account gets its own TradingService (server/trading/service.js, unchanged): the same guard rails —
//            a switch that is OFF until that person turns it on, a confirmation and a one-time reference on every
//            order, limits on quantity and value, the risk guard, an audit line for everything. What differs is only
//            what it is handed: that person's Kite session, that person's settings, that person's audit trail.
//   APART    a person can act on their own account and on nothing else: the account is chosen from who is signed
//            in, never from anything the page sends. The owner can switch the permission on and off and see whether
//            an account is connected; the owner cannot place an order on it, read its positions or see its keys.
//   KEPT     accounts/secrets.json: each person's API key, the secret and the day's token encrypted with the
//            site's settings key (the same as the owner's), and their trading settings. Their audit trail and
//            journal live under accounts/<their slug>/. Market data (prices, charts) still comes from the site's
//            own connection: only the account and the orders are theirs.
//
// Nothing here runs by itself: no timer, no AI, no order that a signed-in person did not confirm.

const crypto = require("crypto");
const { TradingService } = require("./trading/service");
const { loginUrl, exchangeToken, KiteError } = require("./market/kite");
const { tokenExpiry } = require("./market/service");
const { totals, keyOf } = require("./trading/livebook");

const DOC = "accounts/secrets.json";
const AUDIT_KEEP = 500;

class AccountError extends Error {
  constructor(message, code = "invalid", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** A name for a person's records that is safe in a path: letters and digits of the address, and a short hash of all of it. */
const slugOf = (email) => {
  const e = String(email || "").toLowerCase();
  return `${e.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)}-${crypto.createHash("sha1").update(e).digest("hex").slice(0, 8)}`;
};

/**
 * The record store as one account sees it: its own names (accounts/<slug>/…), its own audit trail kept as a short list,
 * and no shared lists at all — so the journal of one account can never touch another's.
 */
class AccountDocs {
  constructor(docs, slug) {
    this.docs = docs;
    this.base = `accounts/${slug}/`;
    this.kind = docs.kind;
  }
  read(name, fallback = null) {
    return this.docs.read(this.base + name, fallback);
  }
  write(name, value) {
    this.docs.write(this.base + name, value);
  }
  remove(name) {
    if (typeof this.docs.remove === "function") this.docs.remove(this.base + name);
  }
  append(name, entry) {
    const file = `${this.base}${name}.json`;
    const list = this.docs.read(file, null) || [];
    list.push(entry);
    this.docs.write(file, list.slice(-AUDIT_KEEP));
  }
  tail(name, n = 100) {
    return (this.docs.read(`${this.base}${name}.json`, null) || []).slice(-n);
  }
  flush() {
    return typeof this.docs.flush === "function" ? this.docs.flush() : Promise.resolve();
  }
}

class Accounts {
  /**
   * @param docs     the record store
   * @param secrets  { encrypt, decrypt } with the site's settings key
   * @param market   the MarketService: prices and bars for the order ticket's checks (never its Kite session)
   * @param isAdmin  (email) => is this person on the admin list right now (and not the owner)?
   */
  constructor({ docs, secrets, market, dataDir, isAdmin = () => false, fetchImpl = globalThis.fetch, now = () => Date.now(), log = console, gapMs, makeTrading = null }) {
    this.docs = docs;
    this.secrets = secrets;
    this.market = market;
    this.dataDir = dataDir;
    this.isAdmin = isAdmin;
    this.fetch = fetchImpl;
    this.now = now;
    this.log = log;
    this.gapMs = gapMs;
    this.makeTrading = makeTrading;
    this._d = null;
    this._services = new Map(); // email → TradingService
    this._rev = 0;
  }

  /* --------------------------------------------------------------------------- the record */
  _all() {
    if (!this._d) {
      const d = this.docs.read(DOC, null);
      this._d = d && d.people && typeof d.people === "object" ? d : { people: {} };
    }
    return this._d;
  }
  _save() {
    this._rev += 1;
    this.docs.write(DOC, this._d);
  }
  _rec(email) {
    return this._all().people[email] || null;
  }
  _own(email) {
    const all = this._all();
    if (!all.people[email]) all.people[email] = { allowed: false, kite: {}, trading: null };
    if (!all.people[email].kite) all.people[email].kite = {};
    return all.people[email];
  }
  _dec(blob) {
    if (!blob) return "";
    try {
      return this.secrets.decrypt(blob);
    } catch (_) {
      return "";
    }
  }
  fingerprint() {
    return `${this._rev}|${Object.keys(this._all().people).length}`;
  }

  /* --------------------------------------------------------------------------- who may */
  /** May this person use their own Zerodha account here? On the admin list, and switched on by the owner. */
  allowed(email) {
    const r = this._rec(email);
    return Boolean(r && r.allowed) && Boolean(this.isAdmin(email));
  }

  _need(email) {
    if (!this.allowed(email)) throw new AccountError("Trading on your own Zerodha account has not been switched on for you. Ask the owner.", "forbidden", 403);
  }

  /** The owner switches a person's account on. They must already be on the admin list. */
  grant(email, by) {
    if (!this.isAdmin(email)) throw new AccountError("Add this person under People first: only someone who can sign in can be given an account.", "not_admin", 409);
    const r = this._own(email);
    r.allowed = true;
    r.grantedBy = by;
    r.grantedAt = new Date(this.now()).toISOString();
    this._save();
    this.log.log(`[accounts] own-account trading switched on for ${email} by ${by}`);
    return this.list();
  }

  /** …and off: their day's token is thrown away and their trading switch goes off. Their key stays, so switching on again is one press. */
  revoke(email, by) {
    const r = this._rec(email);
    if (!r) return this.list();
    r.allowed = false;
    r.revokedBy = by;
    r.revokedAt = new Date(this.now()).toISOString();
    r.kite.accessTokenEnc = "";
    r.kite.loginAt = "";
    if (r.trading) r.trading = { ...r.trading, enabled: false, changedAt: r.revokedAt, changedBy: `${by} (access removed)` };
    this._services.delete(email);
    this._save();
    this.log.log(`[accounts] own-account trading switched off for ${email} by ${by}`);
    return this.list();
  }

  /** A person removed from the site: everything about their account goes. */
  forget(email) {
    const all = this._all();
    if (!all.people[email]) return;
    delete all.people[email];
    this._services.delete(email);
    this._save();
  }

  /** For the owner: who has an account, and whether it is connected. Never a key, a token, a position or an order. */
  list() {
    return Object.keys(this._all().people)
      .sort()
      .map((email) => {
        const s = this.state(email);
        const r = this._rec(email);
        return { email, allowed: Boolean(r.allowed), listed: Boolean(this.isAdmin(email)), configured: s.configured, connected: s.connected, kiteUser: s.userId, loginAt: s.loginAt, grantedAt: r.grantedAt || null, tradingOn: Boolean(r.trading && r.trading.enabled) };
      });
  }

  /* --------------------------------------------------------------------------- one person's connection */
  state(email) {
    const r = this._rec(email);
    const k = (r && r.kite) || {};
    const allowed = this.allowed(email);
    const configured = Boolean(k.apiKey && this._dec(k.apiSecretEnc));
    const loginAt = k.loginAt ? Date.parse(k.loginAt) : 0;
    const expiresAt = loginAt ? tokenExpiry(loginAt) : 0;
    const connected = allowed && configured && Boolean(this._dec(k.accessTokenEnc)) && this.now() < expiresAt;
    return {
      allowed,
      configured,
      connected,
      apiKeyHint: k.apiKey ? `${k.apiKey.slice(0, 3)}…${k.apiKey.slice(-2)}` : "",
      user: connected ? k.userName || k.userId || "" : "",
      userId: connected ? k.userId || "" : "",
      loginAt: connected ? k.loginAt : null,
      expiresAt: connected ? new Date(expiresAt).toISOString() : null,
      lastError: k.lastError || "",
    };
  }

  setCredentials(email, apiKey, apiSecret) {
    this._need(email);
    const key = String(apiKey || "").trim();
    const secret = String(apiSecret || "").trim();
    if (!/^[a-z0-9]{6,40}$/i.test(key)) throw new AccountError("The API key should be letters and digits only (copy it from your Kite developer console).", "invalid");
    const r = this._own(email);
    const hadSecret = Boolean(this._dec(r.kite.apiSecretEnc));
    if (secret ? !/^[a-z0-9]{6,80}$/i.test(secret) : !hadSecret) throw new AccountError("The API secret should be letters and digits only.", "invalid");
    const changed = r.kite.apiKey !== key || Boolean(secret);
    r.kite.apiKey = key;
    if (secret) r.kite.apiSecretEnc = this.secrets.encrypt(secret);
    if (changed) {
      // a token belongs to the key that made it
      r.kite.accessTokenEnc = "";
      r.kite.loginAt = "";
    }
    r.kite.lastError = "";
    this._services.delete(email);
    this._save();
    this.log.log(`[accounts] Kite API key saved for ${email}`);
    return this.state(email);
  }

  loginUrl(email, state) {
    this._need(email);
    const k = (this._rec(email) || {}).kite || {};
    if (!k.apiKey || !this._dec(k.apiSecretEnc)) throw new AccountError("Add your Kite API key and secret first.", "not_configured", 409);
    return loginUrl(k.apiKey, state);
  }

  async completeLogin(email, requestToken) {
    this._need(email);
    if (!/^[A-Za-z0-9]{6,64}$/.test(String(requestToken || ""))) throw new AccountError("Kite did not send a valid request token.", "invalid");
    const r = this._own(email);
    const out = await exchangeToken({ apiKey: r.kite.apiKey, apiSecret: this._dec(r.kite.apiSecretEnc), requestToken, fetchImpl: this.fetch });
    r.kite.accessTokenEnc = this.secrets.encrypt(out.accessToken);
    r.kite.loginAt = new Date(this.now()).toISOString();
    r.kite.userId = out.userId;
    r.kite.userName = out.userName;
    r.kite.lastError = "";
    this._services.delete(email);
    this._save();
    this.log.log(`[accounts] Kite connected for ${email} (${out.userId || "user"})`);
    return this.state(email);
  }

  /** Log out of Zerodha here (the key stays). */
  disconnect(email) {
    const r = this._rec(email);
    if (!r) return this.state(email);
    r.kite.accessTokenEnc = "";
    r.kite.loginAt = "";
    this._services.delete(email);
    this._save();
    return this.state(email);
  }

  /** Take the key and the secret away as well (their own choice). */
  removeKeys(email) {
    const r = this._rec(email);
    if (!r) return this.state(email);
    r.kite = {};
    if (r.trading) r.trading = { ...r.trading, enabled: false };
    this._services.delete(email);
    this._save();
    return this.state(email);
  }

  /* --------------------------------------------------------------------------- one person's trading */
  /** What the trading service is handed in place of the site's market service: this person's Kite session, the site's prices. */
  _marketFor(email) {
    const self = this;
    const m = this.market || {};
    return {
      ticker: null, // order updates are read, not streamed, for these accounts
      events: null,
      kiteState: () => self.state(email),
      kiteAuth() {
        const s = self.state(email);
        if (!s.connected) return null;
        const k = self._rec(email).kite;
        return { apiKey: k.apiKey, accessToken: self._dec(k.accessTokenEnc) };
      },
      forgetSession() {
        const r = self._rec(email);
        if (!r) return;
        r.kite.accessTokenEnc = "";
        r.kite.loginAt = "";
        r.kite.lastError = "The Kite session expired or was closed. Log in again.";
        self._save();
      },
      // prices and bars for the ticket's checks: the site's own data, read-only
      quotes: (...a) => (typeof m.quotes === "function" ? m.quotes(...a) : Promise.resolve({ quotes: {}, live: false, at: null })),
      verdict: (...a) => (typeof m.verdict === "function" ? m.verdict(...a) : Promise.resolve({ available: false })),
      minuteBarsBetween: (...a) => (typeof m.minuteBarsBetween === "function" ? m.minuteBarsBetween(...a) : Promise.resolve([])),
    };
  }

  /** …and in place of the site's main record: this person's trading settings, saved with their account. */
  _storeFor(email, docs) {
    const self = this;
    const store = {
      docs,
      get data() {
        const r = self._own(email);
        return {
          get trading() {
            return r.trading;
          },
          set trading(v) {
            r.trading = v;
          },
        };
      },
      update(fn) {
        fn(store.data);
        self._save();
      },
    };
    return store;
  }

  /** This person's trading service (made once, kept while their key does not change). Refuses anyone not allowed. */
  tradingFor(email) {
    this._need(email);
    let t = this._services.get(email);
    if (!t) {
      const docs = new AccountDocs(this.docs, slugOf(email));
      const args = { dir: this.dataDir, store: this._storeFor(email, docs), market: this._marketFor(email), docs, fetchImpl: this.fetch, now: this.now, log: this.log, gapMs: this.gapMs };
      t = this.makeTrading ? this.makeTrading(args) : new TradingService(args);
      t.account = email;
      this._services.set(email, t);
    }
    return t;
  }

  /** The day's positions in the shape the pages draw (the site's live book has it for the owner): Zerodha's own figures, read now. */
  async book(email) {
    const t = this.tradingFor(email);
    const at = new Date(this.now()).toISOString();
    if (!this.state(email).connected) return { at, available: false, connected: false, error: "", streaming: false };
    try {
      const p = await t.positions();
      const rows = ((p && p.net) || []).map((x) => ({ ...x, live: false }));
      return { at, available: true, connected: true, baseAt: at, error: "", streaming: false, ...totals(rows), live: false, positions: rows.map((x) => ({ key: keyOf(x), ...x })) };
    } catch (err) {
      return { at, available: false, connected: true, error: err && err.message ? err.message : "Could not read the positions.", streaming: false };
    }
  }
}

module.exports = { Accounts, AccountError, AccountDocs, slugOf, DOC, KiteError };
