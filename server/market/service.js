"use strict";
// Market data for the Analyzer: where prices come from, how they are cached, and
// what happens when the source is unavailable.
//
// Sources
//   kite   Zerodha Kite Connect, using the owner's own API key (live + historical)
//   demo   synthetic series, clearly labelled, for exploring the tool
//   none   nothing connected yet
//
// Failing safe
//   • every daily series is cached on disk. If Kite is down, the token has expired
//     or the network drops, the last good copy is served and marked `stale` — the
//     page says how old it is instead of showing an error or, worse, a wrong number.
//   • an incremental refresh that disagrees with the cached history (a split or
//     bonus re-adjusts all past prices) triggers a full re-download.
//   • requests are throttled to the API's published limits.

const fs = require("fs");
const { EventEmitter } = require("events");
const path = require("path");

const { KiteClient, KiteError, loginUrl, exchangeToken } = require("./kite");
const { analyze, summarize } = require("./analyze");
const { runBacktest } = require("./backtest");
const { STRATEGIES, byId, buildContext } = require("./strategies");
const I = require("./indicators");
const demo = require("./demo");
const { buildVerdict } = require("./verdict");
const { buildTape, fastRead, barStart } = require("./intraday");
const { FlowEngine } = require("./flow");
const { replayDayAsync, combine, DEFAULT_COST_PCT } = require("./replay");
const { KiteTicker } = require("./ticker");
const { Universe } = require("./universe");
const { IndexList } = require("./indexlist");
const { buildPulse } = require("./pulse");
const { buildOutlook } = require("./outlook");
const { buildIntradayPlan, nextWeekday } = require("./intraplan");
const { buildOptionChain } = require("./options");
const { buildMarketForecast } = require("./premarket");

// option underlyings: the index's name on NSE ↔ its name on the NFO contracts
const OPTION_NAME = { "NIFTY 50": "NIFTY", "NIFTY BANK": "BANKNIFTY", "NIFTY FIN SERVICE": "FINNIFTY", "NIFTY MID SELECT": "MIDCPNIFTY", "NIFTY NEXT 50": "NIFTYNXT50" };
const SPOT_OF = Object.fromEntries(Object.entries(OPTION_NAME).map(([k, v]) => [v, k]));
const OI_DOC = "market/oi-snapshots.json";
/** The trading session today's quotes describe: before 9:15 (and at weekends) it is the previous weekday's. */
function sessionDay(ms) {
  const d = new Date(ms + 5.5 * 3600 * 1000);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  let back = 0;
  const dow = d.getUTCDay();
  if (dow === 6) back = 1;
  else if (dow === 0) back = 2;
  else if (mins < 555) back = dow === 1 ? 3 : 1;
  return new Date(ms + 5.5 * 3600 * 1000 - back * 86400000).toISOString().slice(0, 10);
}
const { buildContext: buildMarketContext, contextKeys } = require("./context");
const { buildProfile } = require("./profile");
const E = require("./edge");

const EDGE_DOC = "market/edge.json";
const SIGNAL_DOC = "market/signals.json";
const SIGNAL_KEEP = 4000;
const ALERT_DOC = "market/alerts.json";
const ALERT_MAX = 60; // waiting at once
const ALERT_KEEP = 40; // fired ones kept for the record
const HOW = ["", "target", "stop", "time"];

// The chart's intervals, as Kite names them. Kite answers at most `chunk` days of each per
// request; `days` is how far back the chart reaches by default, `max` the most it may ask for.
const CANDLE_INTERVALS = {
  minute: { chunk: 60, days: 5, max: 60 },
  "3minute": { chunk: 100, days: 15, max: 100 },
  "5minute": { chunk: 100, days: 30, max: 200 },
  "10minute": { chunk: 100, days: 45, max: 200 },
  "15minute": { chunk: 200, days: 60, max: 400 },
  "30minute": { chunk: 200, days: 120, max: 400 },
  "60minute": { chunk: 400, days: 250, max: 800 },
  day: { days: 3650 },
};

const DAY = 86400000;
const IST = 5.5 * 3600 * 1000;
const HISTORY_DAYS = 3650; // ~10 years of daily bars
const CHUNK_DAYS = 1800; // per historical request
const DAILY_WAIT_MS = 2500; // how long a page waits on a daily top-up before it is shown the saved copy
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9&._ -]{0,24}$/;
const MAX_LISTS = 10; // named watchlists
const MAX_WATCHLIST = 40;
const INDEX_SYMBOL = "NIFTY 50";
// Kite instrument tokens of the indices on the Indices page (NIFTY 50 is also looked up in the NSE list)
const INDEX_TOKENS = { NIFTY: 256265, SENSEX: 265 };

const istIso = (ms) => new Date(ms + IST).toISOString();
const istDate = (ms) => istIso(ms).slice(0, 10);
const isNum = (x) => typeof x === "number" && Number.isFinite(x);

/** A streamed tick in the same shape as a REST quote, so either can be used anywhere. */
function tickQuote(t) {
  const q = { last: t.last, streamed: true };
  if (isNum(t.prevClose) && t.prevClose > 0) {
    q.prevClose = t.prevClose;
    q.change = t.last - t.prevClose;
    q.changePct = (q.change / t.prevClose) * 100;
  }
  for (const k of ["open", "high", "low", "avgPrice", "bid", "ask"]) if (isNum(t[k]) && t[k] > 0) q[k] = t[k];
  for (const k of ["volume", "buyQty", "sellQty", "bidQty", "askQty"]) if (isNum(t[k]) && !t.index) q[k] = t[k];
  const when = t.lastTradeTime || t.exchangeTime;
  if (when) q.time = istIso(when).slice(0, 19).replace("T", " "); // the same format the REST quote uses
  return q;
}

/** Mon–Fri 09:00–16:00 IST: when prices are moving (holidays are not known here — harmless). */
function isMarketHours(ms) {
  const d = new Date(ms + IST);
  const dow = d.getUTCDay();
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  return dow >= 1 && dow <= 5 && mins >= 9 * 60 && mins <= 16 * 60;
}

/**
 * Which part of the trading day it is. A measured-odds reading is good for one of these:
 * it changes when the session opens (the gap is known) and when it closes (a new bar).
 */
function sessionPhase(ms) {
  const d = new Date(ms + IST);
  const dow = d.getUTCDay();
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  const date = istDate(ms);
  if (dow === 0 || dow === 6) return `${date}|closed`;
  if (mins < 9 * 60 + 16) return `${date}|pre`;
  return mins <= 16 * 60 ? `${date}|open` : `${date}|post`;
}

/** A Kite access token dies at 06:00 IST on the day after login. */
function tokenExpiry(loginMs) {
  const d = new Date(loginMs + IST);
  let six = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 6, 0, 0) - IST;
  if (six <= loginMs) six += DAY;
  return six;
}

class MarketError extends Error {
  constructor(message, code = "market_error", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class MarketService {
  /**
   * @param store    the app's Store (settings + watchlist live there)
   * @param secrets  { encrypt(text), decrypt(blob) } — API secret and token are stored encrypted
   */
  constructor({ dir, store, secrets, fetchImpl = globalThis.fetch, now = () => Date.now(), log = console, gaps, wsImpl, tickerOptions, screenerIndex = "nse", indexFetch = null }) {
    this.dir = path.join(dir, "market");
    this.store = store;
    this.secrets = secrets;
    // changes the open pages are told about at once (app.js passes them on): "kite" when the Zerodha
    // session starts or ends, "alerts" when a price alert is set, fired or removed
    this.events = new EventEmitter();
    this.events.setMaxListeners(500);
    this.fetch = fetchImpl;
    this.now = now;
    this.log = log;
    this.gaps = gaps;
    this._client = null;
    this._syncTicker();
    this._clientKey = "";
    this._instruments = null;
    this._quoteAt = new Map(); // symbol → { at, q }: one poll never thrashes another
    this._barsAt = new Map(); // symbol → { at, day, today, prior }: recent 5-minute bars
    this._analysisAt = new Map(); // symbol → { key, a }: the daily analysis, reused until the bars change
    // Live ticks over Zerodha's WebSocket. wsImpl === null switches streaming off (tests, simulators
    // without a socket); undefined uses the real one.
    this.ticker = wsImpl === null ? null : new KiteTicker({ WebSocketImpl: wsImpl, now, ...(tickerOptions || {}) });
    // order flow for the stock a page has in focus: fed once per tick, whoever is watching
    this.flow = new FlowEngine();
    this._focus = new Map(); // token → how many pages have it in focus
    this._minAt = new Map(); // symbol → { at, day, bars, today }: 1-minute bars
    this._replayAt = new Map(); // symbol|cost → { at, out }: the day replayed
    if (this.ticker) {
      this.ticker.on("tick", (t) => {
        if (this._focus.has(t.token)) this.flow.update(t.token, t, t.at);
      });
    }
    this._ctx = null; // { at, data }: the market context, shared for a few seconds
    // the screener's NSE index lists (indexlist.js): the board shows any of them, the RSI search the Nifty 500
    // "all" (tests with a made-up exchange): every NSE stock and no index lists
    this.indexList = screenerIndex === "all" ? null : new IndexList({ dir: this.dir, fetchImpl: indexFetch, now: this.now, log });
    this.universe = new Universe({ dir: this.dir, market: this });
    this.openHint = null; // (symbol) => the learned opening forecast for the next session, when app.js wires one
    this.worldProvider = null; // () => the latest AI world brief in short form, when the AI service is present
    fs.mkdirSync(path.join(this.dir, "candles"), { recursive: true });
    if (!this.store.data.market) this.store.update((d) => (d.market = { watchlist: [], demo: false }));
  }

  /* ------------------------------------------------------------ connection */

  _settings() {
    return this.store.data.settings;
  }

  _secret(field) {
    const blob = this._settings()[field];
    if (!blob) return "";
    try {
      return this.secrets.decrypt(blob);
    } catch (_) {
      return "";
    }
  }

  kiteState() {
    const s = this._settings();
    const configured = Boolean(s.kiteApiKey && this._secret("kiteApiSecretEnc"));
    const loginAt = s.kiteLoginAt ? Date.parse(s.kiteLoginAt) : 0;
    const expiresAt = loginAt ? tokenExpiry(loginAt) : 0;
    const connected = configured && Boolean(this._secret("kiteAccessTokenEnc")) && this.now() < expiresAt;
    return {
      configured,
      connected,
      apiKeyHint: s.kiteApiKey ? `${s.kiteApiKey.slice(0, 3)}…${s.kiteApiKey.slice(-2)}` : "",
      user: connected ? s.kiteUserName || s.kiteUserId || "" : "",
      loginAt: connected ? s.kiteLoginAt : null,
      expiresAt: connected ? new Date(expiresAt).toISOString() : null,
      lastError: s.kiteLastError || "",
    };
  }

  mode() {
    if (this.kiteState().connected) return "kite";
    return this.store.data.market.demo ? "demo" : "none";
  }

  status() {
    return {
      mode: this.mode(),
      demo: Boolean(this.store.data.market.demo),
      kite: this.kiteState(),
      marketHours: isMarketHours(this.now()),
      today: istDate(this.now()),
      indexName: this.mode() === "demo" ? "Demo index" : INDEX_SYMBOL,
    };
  }

  setKiteCredentials(apiKey, apiSecret) {
    const key = String(apiKey || "").trim();
    const secret = String(apiSecret || "").trim();
    if (!/^[a-z0-9]{6,40}$/i.test(key)) throw new MarketError("The API key should be letters and digits only (copy it from the Kite developer console).", "invalid");
    const hadSecret = Boolean(this._secret("kiteApiSecretEnc"));
    if (secret ? !/^[a-z0-9]{6,80}$/i.test(secret) : !hadSecret) throw new MarketError("The API secret should be letters and digits only.", "invalid");
    this.store.update((d) => {
      const changed = d.settings.kiteApiKey !== key || Boolean(secret);
      d.settings.kiteApiKey = key;
      if (secret) d.settings.kiteApiSecretEnc = this.secrets.encrypt(secret);
      if (changed) {
        // a token belongs to the key that created it
        d.settings.kiteAccessTokenEnc = "";
        d.settings.kiteLoginAt = "";
      }
      d.settings.kiteLastError = "";
    });
    this._client = null;
    this._syncTicker();
  }

  loginUrl(state) {
    const s = this._settings();
    if (!s.kiteApiKey || !this._secret("kiteApiSecretEnc")) throw new MarketError("Add the Kite API key and secret first.", "not_configured");
    return loginUrl(s.kiteApiKey, state);
  }

  async completeLogin(requestToken, { allowOtherUser = true } = {}) {
    if (!/^[A-Za-z0-9]{6,64}$/.test(String(requestToken || ""))) throw new MarketError("Kite did not send a valid request token.", "invalid");
    const s = this._settings();
    const r = await exchangeToken({
      apiKey: s.kiteApiKey,
      apiSecret: this._secret("kiteApiSecretEnc"),
      requestToken,
      fetchImpl: this.fetch,
    });
    const known = s.kiteUserId || "";
    if (!allowOtherUser && known && r.userId && r.userId !== known) {
      this.log.warn(`[market] a Kite login for ${r.userId} was refused: the site's account is ${known}`);
      throw new MarketError(`That login was for Zerodha account ${r.userId}, not the site's account ${known}. Only the owner can switch the site to another Zerodha account.`, "other_account", 403);
    }
    this.store.update((d) => {
      d.settings.kiteAccessTokenEnc = this.secrets.encrypt(r.accessToken);
      d.settings.kiteLoginAt = new Date(this.now()).toISOString();
      d.settings.kiteUserId = r.userId;
      d.settings.kiteUserName = r.userName;
      d.settings.kiteLastError = "";
    });
    this._client = null;
    this._syncTicker();
    this.log.log(`[market] Kite connected for ${r.userId || "user"}`);
    this._tell("kite");
    return this.kiteState();
  }

  disconnect() {
    this.store.update((d) => {
      d.settings.kiteAccessTokenEnc = "";
      d.settings.kiteLoginAt = "";
    });
    this._client = null;
    this._syncTicker();
    this._tell("kite");
  }

  setDemo(on) {
    this.store.update((d) => {
      d.market.demo = Boolean(on);
    });
    this._tell("kite");
  }

  /** Tell whoever listens (the open pages, through app.js) that something changed. Never throws. */
  _tell(kind, detail = {}) {
    try {
      this.events.emit(kind, { kind, at: new Date(this.now()).toISOString(), ...detail });
    } catch (_) {
      /* a listener's failure is not the market's */
    }
  }

  _kite() {
    if (!this.kiteState().connected) throw new MarketError("Zerodha is not connected. Log in to Kite to load live data.", "not_connected", 409);
    const s = this._settings();
    const token = this._secret("kiteAccessTokenEnc");
    const key = `${s.kiteApiKey}:${token}`;
    if (!this._client || this._clientKey !== key) {
      this._client = new KiteClient({ apiKey: s.kiteApiKey, accessToken: token, fetchImpl: this.fetch, gaps: this.gaps });
      this._clientKey = key;
    }
    return this._client;
  }

  /**
   * The day's Kite login (key + access token), or null when Zerodha is not connected.
   * Used by the trading module in server/trading, which keeps its own client: this folder
   * itself never sends anything but market-data reads.
   */
  kiteAuth() {
    if (!this.kiteState().connected) return null;
    return { apiKey: this._settings().kiteApiKey, accessToken: this._secret("kiteAccessTokenEnc") };
  }

  /** Zerodha refused the day's token: forget it everywhere so the page asks for a fresh login. */
  forgetSession() {
    this.store.update((d) => {
      d.settings.kiteAccessTokenEnc = "";
      d.settings.kiteLoginAt = "";
      d.settings.kiteLastError = "The Kite session expired or was closed. Log in again.";
    });
    this._client = null;
    this._syncTicker();
    this._tell("kite");
  }

  /** Run a Kite call; if the day's token has died, forget it so the page asks for a fresh login. */
  async _call(fn) {
    try {
      return await fn(this._kite());
    } catch (err) {
      if (err instanceof KiteError && err.tokenExpired) {
        this.forgetSession();
        throw new MarketError("The Kite session has expired. Log in to Kite again.", "not_connected", 409);
      }
      throw err;
    }
  }

  /* ----------------------------------------------------------- instruments */

  async instruments() {
    if (this.mode() === "demo") return demo.demoInstruments();
    const today = istDate(this.now());
    const file = path.join(this.dir, "instruments.json");
    if (!this._instruments) {
      try {
        this._instruments = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch (_) {
        this._instruments = null;
      }
    }
    const cached = this._instruments;
    if (cached && cached.fetchedOn === today) return cached.list;
    if (this.mode() !== "kite") return cached ? cached.list : [];
    // the list is several megabytes: everyone who needs it while it downloads waits for the one copy
    if (this._instrumentsBusy) return this._instrumentsBusy;
    this._instrumentsBusy = this._fetchInstruments(file, today, cached).finally(() => {
      this._instrumentsBusy = null;
    });
    return this._instrumentsBusy;
  }

  async _fetchInstruments(file, today, cached) {
    try {
      const list = await this._call((k) => k.instruments("NSE"));
      if (list.length < 100) throw new Error("the instrument list looks incomplete");
      this._instruments = { fetchedOn: today, list };
      fs.writeFileSync(file, JSON.stringify(this._instruments));
      return list;
    } catch (err) {
      if (cached) return cached.list; // yesterday's list is still almost entirely right
      throw err;
    }
  }

  async search(q) {
    const term = String(q || "").trim().toUpperCase();
    if (!term) return [];
    const list = await this.instruments();
    const starts = [];
    const contains = [];
    for (const it of list) {
      if (it.s.startsWith(term)) starts.push(it);
      else if (it.s.includes(term) || it.n.toUpperCase().includes(term)) contains.push(it);
      if (starts.length >= 20) break;
    }
    return [...starts, ...contains].slice(0, 20).map((it) => ({ symbol: it.s, name: it.n, kind: it.k }));
  }

  async _instrument(symbol) {
    const list = await this.instruments();
    const it = list.find((x) => x.s === symbol);
    if (!it) throw new MarketError(`"${symbol}" is not in the NSE instrument list.`, "unknown_symbol", 404);
    return it;
  }

  /* -------------------------------------------------------------- watchlist */

  watchlist() {
    const all = this.store.data.market.watchlist || [];
    const demoMode = this.mode() === "demo";
    // demo symbols only make sense in demo mode, and real ones only outside it
    const mine = all.filter((s) => demo.isDemoSymbol(s) === demoMode);
    return demoMode && mine.length === 0 ? demo.DEMO_SYMBOLS : mine;
  }

  setWatchlist(symbols) {
    if (!Array.isArray(symbols)) throw new MarketError("Send a list of symbols.", "invalid");
    const clean = [...new Set(symbols.map((s) => String(s || "").trim().toUpperCase()))].filter((s) => SYMBOL_RE.test(s));
    if (clean.length > MAX_WATCHLIST) throw new MarketError(`A watchlist can hold up to ${MAX_WATCHLIST} symbols.`, "invalid");
    const demoMode = this.mode() === "demo";
    this.store.update((d) => {
      // keep the other mode's symbols untouched
      const others = (d.market.watchlist || []).filter((s) => demo.isDemoSymbol(s) !== demoMode);
      d.market.watchlist = [...others, ...clean.filter((s) => demo.isDemoSymbol(s) === demoMode)];
      // the list that is open follows every edit
      if (!demoMode && Array.isArray(d.market.lists)) {
        const act = d.market.lists.find((l) => l.id === d.market.activeList) || d.market.lists[0];
        if (act) act.symbols = d.market.watchlist.filter((s) => !demo.isDemoSymbol(s));
      }
    });
    return this.watchlist();
  }

  /* -------------------------------------------------- several named watchlists */
  // One list is open at a time; the open list is "the watchlist" every engine reads (scan,
  // Advisor, Debrief, Paper, Research). Switching lists swaps which symbols that is.

  lists() {
    const m = this.store.data.market || {};
    const real = (m.watchlist || []).filter((s) => !demo.isDemoSymbol(s));
    const lists = Array.isArray(m.lists) && m.lists.length ? m.lists : [{ id: "main", name: "Main", symbols: real }];
    const active = lists.some((l) => l.id === m.activeList) ? m.activeList : lists[0].id;
    return { lists: lists.map((l) => ({ id: l.id, name: l.name, symbols: l.id === active ? real : l.symbols || [], count: (l.id === active ? real : l.symbols || []).length })), active, max: MAX_LISTS };
  }

  listAction({ action, id, name } = {}) {
    if (this.mode() === "demo") throw new MarketError("Demo mode has one list of demo stocks.", "invalid");
    const cur = this.lists();
    const clean = String(name || "").trim().replace(/\s+/g, " ").slice(0, 30);
    const exists = (x) => cur.lists.find((l) => l.id === x);
    this.store.update((d) => {
      const m = d.market;
      const real = (m.watchlist || []).filter((s) => !demo.isDemoSymbol(s));
      const demos = (m.watchlist || []).filter((s) => demo.isDemoSymbol(s));
      let lists = cur.lists.map((l) => ({ id: l.id, name: l.name, symbols: l.id === cur.active ? real : l.symbols }));
      let active = cur.active;
      const open = (to) => {
        lists = lists.map((l) => (l.id === active ? { ...l, symbols: real } : l));
        active = to;
        m.watchlist = [...demos, ...(lists.find((l) => l.id === to).symbols || [])];
      };
      if (action === "create") {
        if (!clean) throw new MarketError("Give the list a name.", "invalid");
        if (lists.length >= MAX_LISTS) throw new MarketError(`You can keep up to ${MAX_LISTS} lists.`, "invalid");
        if (lists.some((l) => l.name.toLowerCase() === clean.toLowerCase())) throw new MarketError("A list with that name exists.", "invalid");
        const nid = `l${this.now().toString(36)}`;
        lists.push({ id: nid, name: clean, symbols: [] });
        open(nid);
      } else if (action === "rename") {
        if (!exists(id)) throw new MarketError("That list is not there any more.", "not_found", 404);
        if (!clean) throw new MarketError("Give the list a name.", "invalid");
        lists = lists.map((l) => (l.id === id ? { ...l, name: clean } : l));
      } else if (action === "delete") {
        if (!exists(id)) throw new MarketError("That list is not there any more.", "not_found", 404);
        if (lists.length <= 1) throw new MarketError("The last list cannot be deleted.", "invalid");
        const wasOpen = id === active;
        lists = lists.filter((l) => l.id !== id);
        if (wasOpen) {
          active = lists[0].id;
          m.watchlist = [...demos, ...(lists[0].symbols || [])];
        }
      } else if (action === "open") {
        if (!exists(id)) throw new MarketError("That list is not there any more.", "not_found", 404);
        if (id !== active) open(id);
      } else throw new MarketError("Unknown action.", "invalid");
      m.lists = lists;
      m.activeList = active;
    });
    return { ...this.lists(), watchlist: this.watchlist() };
  }

  /* ---------------------------------------------------------------- candles */

  _cacheFile(symbol) {
    return path.join(this.dir, "candles", `${symbol.replace(/[^A-Z0-9]/g, "_")}.json`);
  }

  _readCache(symbol) {
    try {
      const c = JSON.parse(fs.readFileSync(this._cacheFile(symbol), "utf8"));
      return c && Array.isArray(c.candles) && c.symbol === symbol ? c : null;
    } catch (_) {
      return null;
    }
  }

  _writeCache(symbol, candles, fullAt) {
    const rec = { symbol, fetchedAt: new Date(this.now()).toISOString(), fullAt, candles };
    const file = this._cacheFile(symbol);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rec));
    fs.renameSync(tmp, file);
    return rec;
  }

  async _download(token, fromMs, toMs) {
    const out = [];
    for (let a = fromMs; a < toMs; a += CHUNK_DAYS * DAY) {
      const b = Math.min(a + CHUNK_DAYS * DAY, toMs);
      const part = await this._call((k) => k.historical(token, "day", new Date(a), new Date(b)));
      out.push(...part);
    }
    // de-duplicate by date, keep order
    const byDate = new Map(out.map((c) => [c.t, c]));
    return [...byDate.values()].sort((x, y) => (x.t < y.t ? -1 : 1));
  }

  /**
   * Daily candles for a symbol.
   * @returns { candles, source, fetchedAt, stale, staleReason }
   */
  /**
   * Daily candles. Two callers asking for the same stock at once (the watchlist scan and the
   * behaviour learner, say) share one read: two downloads would race to write the same cache
   * file, and Windows refuses the second rename.
   */
  daily(symbol) {
    if (!this._dailyBusy) this._dailyBusy = new Map();
    const hit = this._dailyBusy.get(symbol);
    if (hit) return hit;
    const p = this._daily(symbol).finally(() => this._dailyBusy.delete(symbol));
    this._dailyBusy.set(symbol, p);
    return p;
  }

  async _daily(symbol) {
    if (!SYMBOL_RE.test(symbol)) throw new MarketError("That is not a valid symbol.", "invalid");
    const mode = this.mode();

    if (demo.isDemoSymbol(symbol)) {
      if (mode !== "demo") throw new MarketError("Demo symbols are only available in demo mode.", "unknown_symbol", 404);
      return { candles: demo.demoCandles(symbol, istDate(this.now())), source: "demo", fetchedAt: new Date(this.now()).toISOString(), stale: false, staleReason: "" };
    }
    if (mode === "demo") throw new MarketError("Demo mode only has the DEMO-… symbols. Connect Zerodha for real stocks.", "unknown_symbol", 404);

    const cache = this._readCache(symbol);
    const now = this.now();
    const age = cache ? now - Date.parse(cache.fetchedAt) : Infinity;
    const ttl = isMarketHours(now) ? 5 * 60 * 1000 : 3 * 3600 * 1000;
    const served = (rec, stale = false, reason = "") => ({ candles: rec.candles, source: "kite", fetchedAt: rec.fetchedAt, stale, staleReason: reason });

    if (cache && age < ttl) return served(cache);
    if (mode !== "kite") {
      if (cache) return served(cache, true, "Zerodha is not connected — showing the last downloaded data.");
      throw new MarketError("Zerodha is not connected, and there is no saved data for this symbol yet.", "not_connected", 409);
    }
    // During market hours, with a copy saved earlier today, the refresh gets 2.5 seconds. It
    // normally finishes well inside that (and a split or an outage shows at once); when
    // Zerodha's queue is slow the page gets the saved copy now and the refresh carries on —
    // the next read has it. The page never sits waiting on a top-up of bars it mostly has.
    if (cache && isMarketHours(now) && cache.fetchedAt.slice(0, 10) === new Date(now).toISOString().slice(0, 10) && cache.candles.length >= 30) {
      const job = this._refreshDaily(symbol, cache);
      let timer;
      const late = new Promise((res) => {
        timer = setTimeout(() => res(null), DAILY_WAIT_MS);
        if (timer.unref) timer.unref();
      });
      const done = await Promise.race([job, late]);
      clearTimeout(timer);
      return done || served(cache);
    }
    return this._fetchDaily(symbol, cache);
  }

  /** One background refresh per stock at a time; a failure leaves the saved copy in place. */
  _refreshDaily(symbol, cache) {
    if (!this._dailyRefresh) this._dailyRefresh = new Map();
    if (this._dailyRefresh.has(symbol)) return this._dailyRefresh.get(symbol);
    const p = this._fetchDaily(symbol, cache)
      .catch(() => null)
      .finally(() => this._dailyRefresh.delete(symbol));
    this._dailyRefresh.set(symbol, p);
    return p;
  }

  /** Download (top up, or rebuild) a stock's daily bars from Zerodha and save them. */
  async _fetchDaily(symbol, cache) {
    const now = this.now();
    const served = (rec, stale = false, reason = "") => ({ candles: rec.candles, source: "kite", fetchedAt: rec.fetchedAt, stale, staleReason: reason });
    try {
      const it = await this._instrument(symbol);
      const fullDue = !cache || !cache.fullAt || now - Date.parse(cache.fullAt) > 7 * DAY || cache.candles.length < 30;
      if (!fullDue) {
        // top up the last few sessions, and check they agree with what is cached
        const lastT = Date.parse(`${cache.candles[cache.candles.length - 1].t}T00:00:00Z`);
        const fresh = await this._download(it.t, lastT - 10 * DAY, now);
        const old = new Map(cache.candles.map((c) => [c.t, c]));
        const overlap = fresh.filter((c) => old.has(c.t)).slice(0, -1); // the newest shared bar may still be forming
        const agrees = overlap.every((c) => Math.abs(c.c - old.get(c.t).c) / old.get(c.t).c < 0.005);
        if (fresh.length && agrees) {
          const merged = new Map(cache.candles.map((c) => [c.t, c]));
          fresh.forEach((c) => merged.set(c.t, c));
          const candles = [...merged.values()].sort((x, y) => (x.t < y.t ? -1 : 1));
          return served(this._writeCache(symbol, candles, cache.fullAt));
        }
        // past prices changed (corporate action) or nothing came back → rebuild from scratch
      }
      const candles = await this._download(it.t, now - HISTORY_DAYS * DAY, now);
      if (candles.length < 2) throw new MarketError(`Kite returned no price history for ${symbol}.`, "no_data", 502);
      return served(this._writeCache(symbol, candles, new Date(now).toISOString()));
    } catch (err) {
      if (cache) {
        const why = err instanceof MarketError && err.code === "not_connected" ? err.message : `Could not refresh from Kite (${err.message}).`;
        return served(cache, true, `${why} Showing data saved on ${cache.fetchedAt.slice(0, 10)}.`);
      }
      throw err;
    }
  }

  /**
   * The daily history of NIFTY 50 or SENSEX from Zerodha (the owner's Kite connection), as far back as
   * Kite keeps it, for the Indices page. NIFTY 50's token is read from the NSE instrument list; SENSEX
   * is a BSE index (Kite token 265). Read-only. @returns [{ t: "YYYY-MM-DD", o, h, l, c }]
   */
  async indexDaily(id, { fromMs } = {}) {
    if (this.mode() !== "kite") throw new MarketError("The index history needs the Zerodha connection.", "not_connected", 409);
    let token = INDEX_TOKENS[id];
    if (!token) throw new MarketError("Unknown index.", "invalid");
    if (id === "NIFTY") {
      try {
        const it = (await this.instruments()).find((x) => x.s === INDEX_SYMBOL);
        if (it && it.t) token = it.t;
      } catch (_) {
        /* the known token stands */
      }
    }
    const from = Number.isFinite(fromMs) ? fromMs : Date.UTC(1995, 0, 1);
    const rows = await this._download(token, from, this.now());
    return rows.map((c) => ({ t: String(c.t).slice(0, 10), o: c.o, h: c.h, l: c.l, c: c.c })).filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.t));
  }

  /** The benchmark for relative strength. Never fatal: without it the factor is simply dropped. */
  async index() {
    try {
      if (this.mode() === "demo") return demo.demoIndex(istDate(this.now()));
      const d = await this.daily(INDEX_SYMBOL);
      return { name: INDEX_SYMBOL, candles: d.candles };
    } catch (_) {
      return null;
    }
  }

  /* ----------------------------------------------------------------- quotes */

  async quotes(symbols) {
    const list = [...new Set(symbols)].filter((s) => SYMBOL_RE.test(s)).slice(0, 100);
    const mode = this.mode();
    if (mode === "demo") {
      const out = {};
      for (const s of list.filter(demo.isDemoSymbol)) {
        const c = demo.demoCandles(s, istDate(this.now()));
        const last = c[c.length - 1];
        const prev = c[c.length - 2];
        // a made-up 10% price band, so the circuit display can be explored in demo mode
        const band = (x) => Math.round(x / 0.05) * 0.05;
        out[s] = { last: last.c, prevClose: prev.c, change: last.c - prev.c, changePct: ((last.c - prev.c) / prev.c) * 100, open: last.o, high: last.h, low: last.l, volume: last.v, time: null, upperCircuit: band(prev.c * 1.1), lowerCircuit: band(prev.c * 0.9) };
      }
      return { quotes: out, live: false, at: new Date(this.now()).toISOString() };
    }
    if (mode !== "kite") return { quotes: {}, live: false, at: null };

    // cached per symbol for 2.5 s: the watchlist poll and a single-stock poll share answers
    const now = this.now();
    if (this._quoteAt.size > 500) this._quoteAt.clear();
    const fresh = (s) => {
      const hit = this._quoteAt.get(s);
      // while ticks are streaming, polling is only needed for what the stream lacks (circuit limits)
      return hit && now - hit.at < (this._liveQuote(s) ? 30000 : 2500) ? hit : null;
    };
    const need = list.filter((s) => !fresh(s));
    if (need.length) {
      // callers asking at the same moment share one request per symbol (before, each queued its own behind Zerodha's limit)
      if (!this._quoteFlight) this._quoteFlight = new Map();
      const waitOn = new Set();
      const ask = [];
      for (const s of need) {
        const f = this._quoteFlight.get(s);
        if (f) waitOn.add(f);
        else ask.push(s);
      }
      if (ask.length) {
        const job = this._call((k) => k.quotes(ask.map((s) => `NSE:${s}`)))
          .then((raw) => {
            // a symbol Kite did not answer for is remembered too, so it is not asked again at once
            for (const s of ask) this._quoteAt.set(s, { at: now, q: raw[`NSE:${s}`] || null });
          })
          .finally(() => {
            for (const s of ask) if (this._quoteFlight.get(s) === job) this._quoteFlight.delete(s);
          });
        for (const s of ask) this._quoteFlight.set(s, job);
        waitOn.add(job);
      }
      await Promise.all(waitOn);
    }
    const quotes = {};
    let oldest = now;
    let streamed = false;
    for (const s of list) {
      const hit = this._quoteAt.get(s);
      const tick = this._liveQuote(s);
      // a streamed tick is newer than any polled quote; the poll still supplies what the stream lacks
      if (hit && hit.q) quotes[s] = tick ? { ...hit.q, ...tick } : hit.q;
      else if (tick) quotes[s] = tick;
      if (tick) streamed = true;
      if (hit && hit.at < oldest) oldest = hit.at;
    }
    return { quotes, live: true, streaming: streamed, at: new Date(streamed ? now : oldest).toISOString() };
  }

  /* ------------------------------------------------------------ live stream */

  /** Keep the live stream's session in step with the Kite session. */
  _syncTicker() {
    if (!this.ticker) return;
    if (this.kiteState().connected) this.ticker.setCredentials(this._settings().kiteApiKey, this._secret("kiteAccessTokenEnc"));
    else this.ticker.setCredentials(null, null);
  }

  /** symbol → instrument token, from the instrument list already in memory. */
  _token(symbol) {
    const list = this._instruments && this._instruments.list;
    if (!list) return null;
    if (this._tokensFor !== list) {
      this._tokens = new Map(list.map((it) => [it.s, it.t]));
      this._tokensFor = list;
    }
    return this._tokens.get(symbol) || null;
  }

  /** How fast the price has moved over the last few minutes, read from the streamed ticks. */
  _micro(symbol) {
    if (!this.ticker || !this.ticker.isLive()) return null;
    const token = this._token(symbol);
    const tr = token ? this.ticker.recent(token) : [];
    if (tr.length < 5) return null;
    const [endAt, last] = tr[tr.length - 1];
    const ago = (ms) => {
      let p = null;
      for (const [t, v] of tr) {
        if (t <= endAt - ms) p = v;
        else break;
      }
      return p;
    };
    const diff = (p) => (p === null ? null : last - p);
    return { d30: diff(ago(30000)), d60: diff(ago(60000)), d180: diff(ago(180000)), seconds: Math.round((endAt - tr[0][0]) / 1000) };
  }

  /**
   * Keep the order book and the order-flow reading running for one instrument with no page in focus
   * (the exit coach follows every open position this way). Returns a function that lets it go.
   */
  followBook(token) {
    if (!this.ticker || !token) return () => {};
    this._focus.set(token, (this._focus.get(token) || 0) + 1);
    this._syncTicker();
    this.ticker.subscribe([token]);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.ticker.unsubscribe([token]);
      const left = (this._focus.get(token) || 1) - 1;
      if (left > 0) this._focus.set(token, left);
      else {
        this._focus.delete(token);
        this.flow.reset(token);
      }
    };
  }

  /** The order-flow reading for a symbol, when a page has it in focus on the live stream. */
  flowSnapshot(symbol) {
    if (!this.ticker || !this.ticker.isLive()) return null;
    const token = this._token(symbol);
    const snap = token ? this.flow.snapshot(token) : null;
    return snap && snap.available ? snap : null;
  }

  /** The newest streamed tick for a symbol as a quote, or null when the stream is not live for it. */
  _liveQuote(symbol) {
    if (!this.ticker || !this.ticker.isLive()) return null;
    const token = this._token(symbol);
    const t = token ? this.ticker.get(token) : null;
    return t ? tickQuote(t) : null;
  }

  /**
   * Push live ticks for these symbols to `send` until the returned handle is closed.
   * send({ type: "tick", symbol, tick }) | send({ type: "status", state, reason })
   */
  async stream(symbols, send, { focus = "" } = {}) {
    const off = (reason) => {
      send({ type: "status", state: "off", reason });
      return { close() {} };
    };
    if (!this.ticker) return off("Live streaming is not available on this server.");
    const mode = this.mode();
    if (mode !== "kite") return off(mode === "demo" ? "Demo prices do not stream." : "Zerodha is not connected.");
    await this.instruments();
    const byToken = new Map();
    for (const s of [...new Set([...(focus ? [focus] : []), ...symbols])].filter((x) => SYMBOL_RE.test(x)).slice(0, 80)) {
      const t = this._token(s);
      if (t) byToken.set(t, s);
    }
    const tokens = [...byToken.keys()];
    // the stock in focus also gets its order book and the order-flow reading with every tick
    const focusToken = focus && SYMBOL_RE.test(focus) ? this._token(focus) : null;
    if (focusToken) this._focus.set(focusToken, (this._focus.get(focusToken) || 0) + 1);
    const onTick = (t) => {
      const s = byToken.get(t.token);
      if (!s) return;
      const tick = tickQuote(t);
      if (t.token === focusToken) {
        tick.depth = t.depth || null;
        tick.flow = this.flow.snapshot(t.token);
      }
      send({ type: "tick", symbol: s, tick });
    };
    const onState = (st) => send({ type: "status", state: st.state, reason: st.reason });
    this.ticker.on("tick", onTick);
    this.ticker.on("state", onState);
    this._syncTicker();
    this.ticker.subscribe(tokens);
    send({ type: "status", state: this.ticker.state, reason: this.ticker.reason });
    for (const t of tokens) {
      const known = this.ticker.get(t);
      if (known) onTick(known);
    }
    let closed = false;
    return {
      close: () => {
        if (closed) return;
        closed = true;
        this.ticker.off("tick", onTick);
        this.ticker.off("state", onState);
        this.ticker.unsubscribe(tokens);
        if (focusToken) {
          const left = (this._focus.get(focusToken) || 1) - 1;
          if (left > 0) this._focus.set(focusToken, left);
          else {
            this._focus.delete(focusToken);
            this.flow.reset(focusToken);
          }
        }
      },
    };
  }

  /** Tape speed and order-book pressure together: the fastest things the live call can be told. */
  _tapeNow(symbol) {
    const micro = this._micro(symbol);
    const flow = this.flowSnapshot(symbol);
    if (!micro && !flow) return null;
    return { ...(micro || {}), flow: flow ? { pressure: flow.pressure, label: flow.label } : null };
  }

  /** Is the newest bar still being built? (Its close is then the live price, not a settled one.) */
  _forming(bars, stepMin) {
    if (!bars.length || !isMarketHours(this.now())) return false;
    const start = barStart(bars[bars.length - 1].t);
    return start !== null && start + stepMin * 60000 > this.now();
  }

  /** The company's name for a symbol, from the instrument list ("" when it is not known). */
  async nameOf(symbol) {
    try {
      return String((await this._instrument(symbol)).n || "");
    } catch (_) {
      return "";
    }
  }

  /** Today's 1-minute bars — or the last session's, before today's first trade. */
  async _minuteBars(symbol) {
    const now = this.now();
    const today = istDate(now);
    const hit = this._minAt.get(symbol);
    if (hit && hit.day === today && now - hit.at < (isMarketHours(now) ? 10000 : 600000)) return hit;
    const it = await this._instrument(symbol);
    const dayStart = Date.parse(`${today}T00:00:00Z`) - IST;
    const dateOf = (b) => String(b.t).slice(0, 10);
    let bars = (await this._call((k) => k.historical(it.t, "minute", new Date(dayStart), new Date(now)))).filter((b) => dateOf(b) === today);
    const isToday = bars.length > 0;
    if (!isToday) {
      const older = await this._call((k) => k.historical(it.t, "minute", new Date(now - 5 * DAY), new Date(now)));
      const lastDate = older.length ? dateOf(older[older.length - 1]) : "";
      bars = older.filter((b) => dateOf(b) === lastDate);
    }
    const rec = { at: now, day: today, bars, today: isToday };
    if (this._minAt.size > 60) this._minAt.clear();
    this._minAt.set(symbol, rec);
    return rec;
  }

  /**
   * 1-minute bars of an NSE stock between two times (Zerodha keeps about 60 days of them),
   * as { t: ms, o, h, l, c, v } — for the journal's excursion analysis. Read-only.
   */
  async minuteBarsBetween(symbol, fromMs, toMs) {
    const it = await this._instrument(symbol);
    const bars = await this._call((k) => k.historical(it.t, "minute", new Date(fromMs), new Date(toMs)));
    // Zerodha writes "2026-11-12T09:15:00+0530"; the colon in the offset is added so every engine parses it
    const ms = (t) => {
      const x = String(t).replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
      return Date.parse(/[+-]\d{2}:\d{2}$|Z$/.test(x) ? x : `${x}+05:30`);
    };
    return bars.map((b) => ({ t: ms(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })).filter((b) => Number.isFinite(b.t));
  }

  /** The intraday tape for the chart, at 1-minute or 5-minute resolution, with a quick read of it. */
  async tape(symbol, interval = 5) {
    if (this.mode() !== "kite") return { available: false, reason: "Intraday bars need the Zerodha connection." };
    const step = Number(interval) === 1 ? 1 : 5;
    let bars;
    let isToday;
    if (step === 1) {
      const rec = await this._minuteBars(symbol);
      bars = rec.bars;
      isToday = rec.today;
    } else {
      const rec = await this._recentBars(symbol);
      isToday = rec.today.length > 0;
      const lastDate = rec.prior.length ? String(rec.prior[rec.prior.length - 1].t).slice(0, 10) : "";
      bars = isToday ? rec.today : rec.prior.filter((b) => String(b.t).slice(0, 10) === lastDate);
    }
    if (!bars.length) return { available: false, reason: "Zerodha returned no intraday bars for this symbol." };
    let quote = null;
    try {
      quote = (await this.quotes([symbol])).quotes[symbol] || null;
    } catch (_) {
      quote = null; // the chart still draws from the bars
    }
    const live = isToday && quote ? quote : null;
    const tape = buildTape(bars, { prevClose: live ? live.prevClose : null });
    tape.today = isToday;
    tape.step = step;
    tape.forming = isToday && this._forming(bars, step);
    return { available: true, at: new Date(this.now()).toISOString(), step, tape, fast: step === 1 ? fastRead(bars, { last: live ? live.last : null }) : null };
  }

  /* ---------------------------------------------------------- the chart's candles */

  /**
   * Candles for the chart at any of Kite's intervals: day (the cached daily history, up to
   * ten years) or minute … 60minute (asked of Kite in the chunks it allows, kept for 15 s
   * while the market is open and 10 min after it). Weekly and monthly bars are built from
   * the daily ones on the page. Read-only.
   * @returns { symbol, interval, candles: [{ t, o, h, l, c, v }], source, stale, at }
   */
  async candles(symbol, interval = "day", { days } = {}) {
    if (!SYMBOL_RE.test(symbol)) throw new MarketError("That is not a valid symbol.", "invalid");
    const spec = CANDLE_INTERVALS[interval];
    if (!spec) throw new MarketError(`Unknown interval. Use one of: ${Object.keys(CANDLE_INTERVALS).join(", ")}.`, "invalid");
    const now = this.now();
    if (interval === "day") {
      const d = await this.daily(symbol);
      return { symbol, interval, candles: d.candles, source: d.source, stale: Boolean(d.stale), at: new Date(now).toISOString() };
    }
    if (this.mode() !== "kite") throw new MarketError("Intraday candles need the Zerodha connection.", "not_connected", 409);
    const want = Math.max(1, Math.min(spec.max, Math.round(Number(days) || spec.days)));
    const key = `${symbol}|${interval}|${want}`;
    if (!this._candleAt) this._candleAt = new Map();
    const hit = this._candleAt.get(key);
    if (hit && now - hit.at < (isMarketHours(now) ? 15000 : 600000)) return hit.out;
    if (!this._candleBusy) this._candleBusy = new Map();
    if (this._candleBusy.has(key)) return this._candleBusy.get(key);
    const job = (async () => {
      const it = await this._instrument(symbol);
      const parts = [];
      for (let end = now, left = want; left > 0; left -= spec.chunk) {
        const span = Math.min(spec.chunk, left);
        const start = end - span * DAY;
        parts.unshift(await this._call((k) => k.historical(it.t, interval, new Date(start), new Date(end))));
        end = start - 60000;
      }
      const seen = new Set();
      const candles = parts.flat().filter((b) => (seen.has(b.t) ? false : (seen.add(b.t), true)));
      const out = { symbol, interval, candles, source: "kite", stale: false, at: new Date(now).toISOString() };
      if (this._candleAt.size > 120) this._candleAt.clear();
      this._candleAt.set(key, { at: now, out });
      return out;
    })().finally(() => this._candleBusy.delete(key));
    this._candleBusy.set(key, job);
    return job;
  }

  /* ------------------------------------------------------------- day replay */

  /**
   * The latest session replayed through the live call, for one symbol (see replay.js):
   * every call it would have made at a 5-minute close, and how each one ended.
   */
  async replay(symbol, { costPct } = {}) {
    if (!SYMBOL_RE.test(symbol)) throw new MarketError("That is not a valid symbol.", "invalid");
    if (this.mode() !== "kite") return { available: false, symbol, reason: "The replay needs intraday bars, which come with the Zerodha connection." };
    const asked = Number(costPct);
    const cost = costPct !== undefined && costPct !== null && costPct !== "" && Number.isFinite(asked) ? Math.max(0, Math.min(1, asked)) : DEFAULT_COST_PCT;
    const now = this.now();
    const key = `${symbol}|${cost}`;
    const hit = this._replayAt.get(key);
    // a minute while the day is still being written; ten once it is final
    if (hit && hit.day === istDate(now) && now - hit.at < (isMarketHours(now) ? 60000 : 600000)) return hit.out;

    const rec = await this._recentBars(symbol);
    const dateOf = (b) => String(b.t).slice(0, 10);
    let bars = rec.today;
    let prior = rec.prior;
    if (!bars.length) {
      // before today's first trade: the last session there is
      const lastDate = prior.length ? dateOf(prior[prior.length - 1]) : "";
      bars = prior.filter((b) => dateOf(b) === lastDate);
      prior = prior.filter((b) => dateOf(b) < lastDate);
    }
    if (!bars.length) return { available: false, symbol, reason: "Zerodha returned no 5-minute bars for this symbol." };
    const date = dateOf(bars[0]);
    const isToday = date === istDate(now);

    // the daily picture as it stood BEFORE that session: nothing the day itself decided is used
    const d = await this.daily(symbol);
    const before = d.candles.filter((c) => c.t < date);
    const index = symbol === INDEX_SYMBOL ? null : await this.index();
    const analysis = analyze(before, { index: index ? { ...index, candles: index.candles.filter((c) => c.t < date) } : null, inProgress: false, chartBars: 1 });
    // the price band is only known for today, from the quote
    let circuit = null;
    if (isToday) {
      try {
        const q = (await this.quotes([symbol])).quotes[symbol];
        if (q && isNum(q.upperCircuit) && isNum(q.lowerCircuit)) circuit = { upper: q.upperCircuit, lower: q.lowerCircuit };
      } catch (_) {
        circuit = null;
      }
    }
    const out = { symbol, source: d.source, stale: d.stale, today: isToday, ...(await replayDayAsync({ analysis, candles: before, bars, prior, circuit, costPct: cost })) };
    if (this._replayAt.size > 80) this._replayAt.clear();
    this._replayAt.set(key, { at: now, day: istDate(now), out });
    return out;
  }

  /**
   * Many past sessions of one symbol replayed through the live call — the same engine and the
   * same rules as replay(), one session at a time, each judged only on what was known before it.
   * Used by paper trading on history. Finished sessions only (today joins once it has closed).
   * @returns { symbol, available, sessions: [{ date, trades, summary }] }
   */
  async replayHistory(symbol, { sessions = 20, costPct } = {}) {
    if (!SYMBOL_RE.test(symbol)) throw new MarketError("That is not a valid symbol.", "invalid");
    if (this.mode() !== "kite") return { available: false, symbol, reason: "Paper trading on history replays 5-minute bars, which come with the Zerodha connection." };
    const want = Math.max(1, Math.min(60, Math.round(Number(sessions) || 20)));
    const asked = Number(costPct);
    const cost = costPct !== undefined && costPct !== null && costPct !== "" && Number.isFinite(asked) ? Math.max(0, Math.min(1, asked)) : DEFAULT_COST_PCT;
    const now = this.now();
    const today = istDate(now);
    // about 1.6 calendar days per session, plus room for the warm-up session before the first
    const bars = (await this.candles(symbol, "5minute", { days: Math.min(200, Math.ceil(want * 1.6) + 7) })).candles;
    const byDate = new Map();
    for (const b of bars) {
      const d = String(b.t).slice(0, 10);
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d).push(b);
    }
    const finished = (d) => d < today || (!isMarketHours(now) && String((byDate.get(d) || []).slice(-1)[0]?.t || "").slice(11, 16) >= "15:25");
    const dates = [...byDate.keys()].sort().filter(finished);
    const daily = await this.daily(symbol);
    const index = symbol === INDEX_SYMBOL ? null : await this.index();
    const out = [];
    for (const date of dates.slice(-want)) {
      const at = dates.indexOf(date);
      const prior = at > 0 ? (byDate.get(dates[at - 1]) || []).slice(-150) : [];
      const before = daily.candles.filter((c) => c.t < date);
      if (before.length < 30) continue;
      const analysis = analyze(before, { index: index ? { ...index, candles: index.candles.filter((c) => c.t < date) } : null, inProgress: false, chartBars: 1 });
      const r = await replayDayAsync({ analysis, candles: before, bars: byDate.get(date), prior, circuit: null, costPct: cost });
      if (r.available) out.push({ date, trades: r.trades, summary: r.summary });
    }
    return { symbol, available: out.length > 0, reason: out.length ? "" : "No finished session could be replayed.", costPct: cost, sessions: out };
  }

  /** The watchlist's day in one table: each stock replayed, and every call as one running total. */
  async scorecard({ costPct } = {}) {
    if (this.mode() !== "kite") return { available: false, reason: "The day's scorecard replays intraday bars, which come with the Zerodha connection." };
    const all = this.watchlist();
    const symbols = all.slice(0, 15);
    if (symbols.length === 0) return { available: false, reason: "The watchlist is empty. Add the stocks you follow and their day is replayed here." };
    const rows = [];
    for (const s of symbols) {
      try {
        rows.push(await this.replay(s, { costPct }));
      } catch (err) {
        // one stock that cannot be replayed does not sink the rest
        rows.push({ symbol: s, available: false, reason: err instanceof KiteError ? `Zerodha said: ${err.message}` : err.message });
      }
    }
    const ok = rows.filter((r) => r.available);
    if (ok.length === 0) return { available: false, reason: rows[0].reason || "None of the watchlist could be replayed.", rows };
    // the session most of the list traded in (a stock that did not trade today shows an older one, and is left out of the totals)
    const date = ok.map((r) => r.date).sort().pop();
    const same = rows.map((r) => (r.available && r.date !== date ? { ...r, available: false, reason: `No trades on ${date}; its last session was ${r.date}.` } : r));
    const { totals, curve } = combine(same);
    const first = ok.find((r) => r.date === date);
    return {
      available: true,
      at: new Date(this.now()).toISOString(),
      date,
      today: date === istDate(this.now()),
      complete: same.filter((r) => r.available).every((r) => r.day.complete),
      costPct: first.costPct,
      rows: same,
      totals,
      curve,
      skipped: all.length - symbols.length, // stocks beyond the first fifteen are not replayed
    };
  }

  /* ---------------------------------------------------------------- screener */

  screenerStatus() {
    return { ...this.universe.status(), connected: this.mode() === "kite", scope: this.indexList ? this.indexList.status() : { index: "ALL", source: "all NSE stocks" } };
  }

  screenerStart(opts) {
    try {
      this.universe.start(opts);
      return this.screenerStatus();
    } catch (err) {
      throw err instanceof MarketError ? err : new MarketError(err.message, err.code || "invalid", err.status || 400);
    }
  }

  screenerStop() {
    this.universe.stop();
    return this.screenerStatus();
  }

  /**
   * The Live Pulse for one stock: the next 15–30 minutes read from the live session by arithmetic
   * (pulse.js) — no AI. It sits on top of the desk's live call. `account` is the trader's own
   * position and margin for this stock, read-only, when the caller has them.
   */
  async pulse(symbol, { account = null, riskPct } = {}) {
    if (!SYMBOL_RE.test(symbol)) throw new MarketError("That is not a valid symbol.", "invalid");
    if (this.mode() !== "kite") return { available: false, symbol, reason: "The live pulse needs the Zerodha connection and the market open." };
    const v = await this.verdict(symbol);
    const day = v.available && v.day ? v.day : null;
    if (!day || !day.available) return { available: false, symbol, reason: day && day.reason ? day.reason : "The live session is not available: the market is closed or has not traded yet." };
    let t5 = null;
    let t1 = null;
    try {
      t5 = await this.tape(symbol, 5);
    } catch (_) {
      t5 = null;
    }
    try {
      t1 = await this.tape(symbol, 1);
    } catch (_) {
      t1 = null;
    }
    const bars5 = t5 && t5.available && t5.tape.today ? t5.tape.bars : [];
    const fast = day.fast || (t1 && t1.fast && t1.fast.available ? t1.fast : null);
    let flow = null;
    try {
      flow = this.flowSnapshot(symbol);
    } catch (_) {
      flow = null;
    }
    const p = buildPulse({ day, bars5, fast, flow, account, riskPct });
    return { ...p, symbol, source: v.source, circuit: v.circuit || null, session: day.session || null, at: new Date(this.now()).toISOString(), lastBar: day.movement ? day.movement.lastBarAt : null };
  }

  /**
   * The Intraday Plan for the next session (intraplan.js): where the stock may open and trade, how
   * it behaves inside a day, the plan's own rules replayed on its past sessions, and a decision —
   * LONG / SHORT on a trigger, the opening-range break, WAIT or AVOID. Arithmetic only, read-only.
   * `outlook` is the Next-Session Outlook with the research direction and odds when the caller has
   * it (the AI service passes it); without it the outlook is drawn here from the chart and the odds.
   */
  async intradayPlan(symbol, { outlook = null, world = null } = {}) {
    if (!SYMBOL_RE.test(symbol)) throw new MarketError("That is not a valid symbol.", "invalid");
    const now = this.now();
    const phase = sessionPhase(now);
    const marketOpen = phase.endsWith("|open");
    if (!this._planAt) this._planAt = new Map();
    const key = `${symbol}|${phase}`;
    const hit = this._planAt.get(key);
    // overnight the GIFT Nifty cue moves, so the expected open is redrawn every quarter hour
    if (hit && now - hit.at < (marketOpen ? 5 : 15) * 60000) return hit.out;
    const d = await this.daily(symbol);
    const forming = this._inProgress(d);
    let bars5 = [];
    if (this.mode() === "kite") {
      try {
        bars5 = (await this.candles(symbol, "5minute", { days: 150 })).candles;
      } catch (_) {
        bars5 = [];
      }
    }
    const ix = symbol === INDEX_SYMBOL ? null : await this.index();
    let gift = null;
    if (!marketOpen) {
      try {
        const ctx = await this.context();
        gift = ctx && ctx.available ? (ctx.items || []).find((x) => x.id === "gift") || null : null;
      } catch (_) {
        gift = null;
      }
    }
    let out = outlook && outlook.available ? outlook : null;
    if (!out) {
      let edge = null;
      try {
        edge = await this.edge(symbol);
      } catch (_) {
        edge = null;
      }
      out = buildOutlook({ candles: d.candles, forming, edge });
    }
    let options = null;
    if (this.mode() === "kite") {
      try {
        options = await this.optionChain(symbol);
      } catch (_) {
        options = null; // a stock without options, or the NFO list unreachable: the plan goes on without
      }
    }
    // the NSE forecast from the world: its expected Nifty gap sets this stock's expected open
    let marketCue = null;
    if (!marketOpen && symbol !== INDEX_SYMBOL) {
      try {
        const f = await this.marketForecast({ world });
        if (f && f.available) marketCue = { gapPct: f.open ? f.open.gapPct : null, label: f.open ? f.open.label : null, basis: f.open ? f.open.basis : null, score: f.lean.score, word: f.lean.word, firm: f.lean.firm, agreement: f.lean.agreement, headline: f.headline };
      } catch (_) {
        marketCue = null;
      }
    }
    let news = null;
    try {
      news = this.social ? this.social.forSymbol(symbol) : null;
    } catch (_) {
      news = null;
    }
    let openHint = null;
    try {
      openHint = !marketOpen && this.openHint ? this.openHint(symbol) : null;
    } catch (_) {
      openHint = null;
    }
    const p = buildIntradayPlan({ daily: d.candles, forming, bars5, outlook: out, nifty: ix ? ix.candles : null, gift, marketOpen, costPct: DEFAULT_COST_PCT, options, marketCue, news, openHint });
    const res = { ...p, symbol, source: d.source, stale: Boolean(d.stale), marketOpen, outlookBasis: outlook && outlook.available ? "full" : "chart and odds", at: new Date(now).toISOString() };
    if (this._planAt.size > 80) this._planAt.clear();
    this._planAt.set(key, { at: now, out: res });
    return res;
  }

  /**
   * GIFT Nifty against the close of the NSE near-month Nifty future: { pct, giftLast, futLast, futName }
   * or null (no Zerodha connection, no GIFT price, or no future found).
   */
  async _giftGap(gift) {
    if (this.mode() !== "kite" || !gift || !gift.available || !(gift.last > 0)) return null;
    try {
      const now = this.now();
      const today = istDate(now);
      const ist = new Date(now + 5.5 * 3600 * 1000);
      const closedToday = ist.getUTCHours() * 60 + ist.getUTCMinutes() > 930;
      const futs = (await this.derivatives()).filter((x) => x.n === "NIFTY" && x.y === "FUT" && (x.e > today || (x.e === today && !closedToday))).sort((a, b) => (a.e < b.e ? -1 : 1));
      if (!futs.length) return null;
      const key = `NFO:${futs[0].s}`;
      const q = (await this._call((k) => k.quotes([key])))[key];
      if (!q || !(q.last > 0)) return null;
      return { pct: Math.round((gift.last / q.last - 1) * 10000) / 100, giftLast: gift.last, futLast: q.last, futName: futs[0].s, expiry: futs[0].e };
    } catch (_) {
      return null;
    }
  }

  /** The NFO contract list (futures and options), once a day: several megabytes, one download for everyone. */
  async derivatives() {
    if (this.mode() !== "kite") return [];
    const today = istDate(this.now());
    const file = path.join(this.dir, "nfo.json");
    if (!this._nfo) {
      try {
        this._nfo = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch (_) {
        this._nfo = null;
      }
    }
    if (this._nfo && this._nfo.fetchedOn === today) return this._nfo.list;
    if (this._nfoBusy) return this._nfoBusy;
    this._nfoBusy = (async () => {
      try {
        const list = await this._call((k) => k.derivatives());
        if (list.length < 20) throw new Error("the NFO list looks incomplete");
        this._nfo = { fetchedOn: today, list };
        fs.writeFileSync(file, JSON.stringify(this._nfo));
        return list;
      } catch (err) {
        if (this._nfo) return this._nfo.list; // yesterday's list is nearly all still right
        throw err;
      }
    })().finally(() => {
      this._nfoBusy = null;
    });
    return this._nfoBusy;
  }

  /**
   * The option chain of one stock or index, read (options.js): every strike around the money with
   * price, OI, OI change, volume, IV and delta, and PCR, max pain, the OI walls, fresh writing, build-up,
   * the expected move, skew and a bias with its reasons. From Zerodha quotes on the NFO contracts —
   * read-only. OI change compares with the last reading saved during the previous session.
   */
  async optionChain(symbol, { expiry = "", strikes = 12 } = {}) {
    if (!SYMBOL_RE.test(symbol)) throw new MarketError("That is not a valid symbol.", "invalid");
    if (this.mode() !== "kite") return { available: false, symbol, reason: "The option chain needs the Zerodha connection." };
    const name = OPTION_NAME[symbol] || symbol;
    const spotSym = SPOT_OF[name] || symbol;
    const now = this.now();
    const key = `${name}|${expiry || "near"}`;
    if (!this._chainAt) this._chainAt = new Map();
    const hit = this._chainAt.get(key);
    if (hit && now - hit.at < (isMarketHours(now) ? 30000 : 600000)) return hit.out;
    const list = await this.derivatives();
    const mine = list.filter((x) => x.n === name);
    const opts = mine.filter((x) => x.y === "CE" || x.y === "PE");
    if (!opts.length) return { available: false, symbol, reason: `${symbol} has no options on NSE — it is not in the F&O list.` };
    const today = istDate(now);
    const ist = new Date(now + 5.5 * 3600 * 1000);
    const closedToday = ist.getUTCHours() * 60 + ist.getUTCMinutes() > 930;
    const expiries = [...new Set(opts.map((x) => x.e))].filter((e) => e > today || (e === today && !closedToday)).sort();
    if (!expiries.length) return { available: false, symbol, reason: "No live option expiry was found." };
    const exp = expiries.includes(expiry) ? expiry : expiries[0];
    const spotQ = (await this.quotes([spotSym])).quotes[spotSym];
    let spot = spotQ && spotQ.last > 0 ? spotQ.last : null;
    if (!spot) {
      // no quote yet (early morning): the last daily close stands in
      try {
        const d = await this.daily(spotSym);
        spot = d.candles.length ? d.candles[d.candles.length - 1].c : null;
      } catch (_) {
        spot = null;
      }
    }
    if (!spot) return { available: false, symbol, reason: `No price for ${spotSym} right now.` };
    const ofExp = opts.filter((x) => x.e === exp);
    const ks = [...new Set(ofExp.map((x) => x.k))].sort((a, b) => a - b);
    const ai = ks.reduce((b, k, i) => (Math.abs(k - spot) < Math.abs(ks[b] - spot) ? i : b), 0);
    const pick = new Set(ks.slice(Math.max(0, ai - strikes), ai + strikes + 1));
    const legs = ofExp.filter((x) => pick.has(x.k));
    const futs = mine.filter((x) => x.y === "FUT" && x.e >= today).sort((a, b) => (a.e < b.e ? -1 : 1));
    const fut = futs.find((x) => x.e === exp) || futs[0] || null;
    const keys = [...legs.map((x) => `NFO:${x.s}`), ...(fut ? [`NFO:${fut.s}`] : [])];
    const raw = await this._call((k) => k.quotes(keys));

    // the saved OI reading of the previous session, and this session's (written at most once a minute)
    const day = sessionDay(now);
    const all = (this.store.docs && this.store.docs.read(OI_DOC, {})) || {};
    let snap = all[`${name}|${exp}`];
    if (!snap || snap.day !== day) snap = { day, at: null, oi: {}, prevDay: snap ? snap.day : null, prevAt: snap ? snap.at : null, prev: snap ? snap.oi : null };
    const prevOi = (ts) => (snap.prev && Number.isFinite(snap.prev[ts]) ? snap.prev[ts] : null);
    const nowOi = {};
    for (const x of [...legs, ...(fut ? [fut] : [])]) {
      const q = raw[`NFO:${x.s}`];
      if (q && Number.isFinite(q.oi)) nowOi[x.s] = q.oi;
    }
    if (!snap.at || now - Date.parse(snap.at) > 60000) {
      snap = { ...snap, at: new Date(now).toISOString(), oi: { ...snap.oi, ...nowOi } };
      all[`${name}|${exp}`] = snap;
      // only near expiries are kept
      for (const k of Object.keys(all)) if (String(k.split("|")[1] || "") < today) delete all[k];
      if (this.store.docs) this.store.docs.write(OI_DOC, all);
    }
    const leg = (x) => {
      if (!x) return null;
      const q = raw[`NFO:${x.s}`];
      return q ? { last: q.last, prevClose: q.prevClose, oi: q.oi, volume: q.volume, prevOi: prevOi(x.s) } : null;
    };
    const rows = [...pick].map((k) => ({ strike: k, ce: leg(ofExp.find((x) => x.k === k && x.y === "CE")), pe: leg(ofExp.find((x) => x.k === k && x.y === "PE")) }));
    let dayAtrPct = null;
    try {
      const d = await this.daily(spotSym);
      const c = d.candles.slice(-21);
      const rg = c.slice(1).map((b, i) => ((b.h - b.l) / c[i].c) * 100).sort((a, b) => a - b);
      dayAtrPct = rg.length ? rg[Math.floor(rg.length / 2)] : null;
    } catch (_) {
      dayAtrPct = null;
    }
    const fq = fut ? raw[`NFO:${fut.s}`] : null;
    const chain = buildOptionChain({ spot, future: fq ? { last: fq.last, prevClose: fq.prevClose, oi: fq.oi, prevOi: prevOi(fut.s) } : null, expiry: exp, now, lot: (legs[0] && legs[0].l) || 1, rows, dayAtrPct, prevOiAt: snap.prevAt });
    const out = { ...chain, symbol, underlying: name, spotSymbol: spotSym, expiries: expiries.slice(0, 6), futureSymbol: fut ? fut.s : null, futureExpiry: fut ? fut.e : null, source: "kite", at: new Date(now).toISOString() };
    if (this._chainAt.size > 60) this._chainAt.clear();
    this._chainAt.set(key, { at: now, out });
    return out;
  }

  /**
   * Every F&O stock's near-month future, quoted in ONE request (the trade setup's build-ups, 23 Nov 2026): the underlying, the
   * contract, its last price, the previous close and the open interest now. Indices are left out. Read-only.
   */
  async futuresBoard() {
    if (this.mode() !== "kite") return { available: false, reason: "The futures board needs the Zerodha connection.", rows: [] };
    const now = this.now();
    const today = istDate(now);
    const list = await this.derivatives();
    const near = new Map();
    for (const x of list) {
      if (x.y !== "FUT" || x.e < today || SPOT_OF[x.n]) continue;
      const cur = near.get(x.n);
      if (!cur || x.e < cur.e) near.set(x.n, x);
    }
    const futs = [...near.values()].sort((a, b) => (a.n < b.n ? -1 : 1));
    if (!futs.length) return { available: false, reason: "No stock futures were found in the NFO list.", rows: [] };
    const raw = {};
    for (let i = 0; i < futs.length; i += 450) Object.assign(raw, await this._call((k) => k.quotes(futs.slice(i, i + 450).map((x) => `NFO:${x.s}`))));
    const rows = futs.map((x) => {
      const q = raw[`NFO:${x.s}`] || {};
      return { symbol: x.n, future: x.s, token: x.t, expiry: x.e, lot: x.l, last: q.last ?? null, prevClose: q.prevClose ?? null, oi: q.oi ?? null, volume: q.volume ?? null };
    });
    return { available: true, at: new Date(now).toISOString(), expiry: futs[0].e, rows };
  }

  /** One contract's daily candles WITH open interest (futures), the last `days` calendar days. Read-only. */
  async futureDaily(token, { days = 10 } = {}) {
    if (this.mode() !== "kite") return [];
    const to = new Date(this.now());
    const from = new Date(this.now() - days * 86400000);
    return this._call((k) => k.historical(token, "day", from, to, { oi: true }));
  }

  /**
   * The NSE forecast from the world (premarket.js): before the open, the expected Nifty gap and the
   * day's lean from GIFT Nifty, the US, Europe, Japan, Singapore, Hong Kong, Korea, China, the rupee,
   * crude, both VIXes, FII flows, the Nifty's option chain and the world brief; in the session, the lean
   * for the rest of the day. `world` is the AI service's world brief when the caller has a fresh one.
   * Overseas indices come from the owner's FMP key when one is saved (`this.global`, global.js).
   */
  async marketForecast({ world = null } = {}) {
    const now = this.now();
    const phase = sessionPhase(now).split("|")[1];
    // a new world brief, a Zerodha login or a new overseas key each start a fresh reading
    const key = `${phase}|${world && world.at ? world.at : ""}|${this.mode()}|${this.global && this.global.configured() ? this.global.status().setAt : ""}|${this.social ? this.social.status().polledAt || "" : ""}`;
    if (this._fcAt && this._fcAt.key === key && now - this._fcAt.at < (phase === "open" ? 30000 : 120000)) return this._fcAt.out;
    let ctx = null;
    try {
      ctx = await this.context();
    } catch (_) {
      ctx = null;
    }
    const items = {};
    for (const it of (ctx && ctx.items) || []) items[it.id] = it;
    // without a market context (no Nifty quote yet), the overseas-linked prices are read directly
    if (!(ctx && ctx.available) && this.mode() === "kite") {
      try {
        const plan = contextKeys(now);
        const raw = await this._call((k) => k.quotes([plan.gift, plan.vix, ...plan.usdinr, ...plan.crude, ...plan.gold]));
        const pick = (keys, id, name) => {
          for (const k of [].concat(keys)) {
            const q = raw[k];
            if (q && q.last > 0) {
              const chg = Number.isFinite(q.changePct) ? q.changePct : q.prevClose ? ((q.last - q.prevClose) / q.prevClose) * 100 : null;
              items[id] = { id, name, available: true, last: q.last, changePct: chg === null ? null : Math.round(chg * 100) / 100 };
              return;
            }
          }
        };
        pick(plan.gift, "gift", "GIFT Nifty");
        pick(plan.vix, "vix", "India VIX");
        pick(plan.usdinr, "usdinr", "USD / INR");
        pick(plan.crude, "crude", "Crude oil (MCX)");
        pick(plan.gold, "gold", "Gold (MCX)");
      } catch (_) {
        /* no overseas-linked prices: the forecast works with what it has */
      }
    }
    const n = items.nifty;
    const kite = { gift: items.gift, usdinr: items.usdinr, crude: items.crude, gold: items.gold, vix: items.vix };
    // GIFT Nifty's move since the NSE close, measured against the NSE Nifty future's close (both are
    // near-month Nifty futures, so the usual futures premium cancels out). Its own "change" is measured
    // from its last settlement, which reads 0.00% once it has settled — every weekend.
    const giftGap = phase !== "open" ? await this._giftGap(kite.gift) : null;
    let daily = null;
    try {
      const d = await this.daily(INDEX_SYMBOL);
      daily = this._inProgress(d) ? d.candles.slice(0, -1) : d.candles;
    } catch (_) {
      daily = null;
    }
    let nifty = null;
    if (n && n.available && Number.isFinite(n.last)) {
      const prev = Number.isFinite(n.changePct) ? n.last / (1 + n.changePct / 100) : n.last;
      nifty = { prevClose: phase === "open" ? prev : n.last, last: n.last, changePct: n.changePct, daily };
    } else if (daily && daily.length) nifty = { prevClose: daily[daily.length - 1].c, last: daily[daily.length - 1].c, changePct: null, daily };
    let global = null;
    let history = null;
    let feed = null;
    if (this.global && this.global.configured()) {
      try {
        feed = await this.global.quotes();
        global = feed.available ? feed.markets : null;
        history = await this.global.history();
      } catch (_) {
        global = null;
      }
    }
    let options = null;
    if (this.mode() === "kite") {
      try {
        options = await this.optionChain(INDEX_SYMBOL);
      } catch (_) {
        options = null;
      }
    }
    const today = istDate(now);
    const nextSession = phase === "pre" ? today : phase === "open" ? null : nextWeekday(today);
    let social = null;
    try {
      social = this.social ? this.social.signal() : null;
    } catch (_) {
      social = null;
    }
    const f = buildMarketForecast({ phase, nifty, kite, tide: ctx && ctx.tide, global, world, options, history, nextSession, social, giftGap });
    const out = { ...f, at: new Date(now).toISOString(), feed: this.global ? { configured: this.global.configured(), stale: Boolean(feed && feed.stale), error: feed && (feed.error || (!feed.available && feed.reason)) ? feed.error || feed.reason : "" } : { configured: false } };
    this._fcAt = { key, at: now, out };
    return out;
  }

  /** The market board: top gainers and losers, RSI, VWAP and more for any NSE index (universe.js). */
  async screenerBoard(params = {}) {
    if (this.mode() !== "kite") throw new MarketError("The market board needs the Zerodha connection: every price comes from it.", "not_connected", 409);
    const p = Math.round(Number(params.period) || 14);
    if (!(p >= 2 && p <= 50)) throw new MarketError("The RSI period must be between 2 and 50.", "invalid");
    try {
      const index = String(params.index || "nifty50").toLowerCase();
      if (this.indexList && !this.indexList.has(index)) throw new MarketError("Unknown index.", "invalid");
      return await this.universe.board({ period: p, live: isMarketHours(this.now()), index });
    } catch (err) {
      if (err instanceof MarketError || err instanceof KiteError) throw err;
      throw new MarketError(err && err.message ? err.message : "The market board could not be read.", "screener_failed", 502);
    }
  }

  /** Every NSE stock whose RSI is inside the asked range at this moment. */
  async screenerRsi(params = {}) {
    if (this.mode() !== "kite") throw new MarketError("The screener needs the Zerodha connection: every stock's price comes from it.", "not_connected", 409);
    const n = (x) => (x === undefined || x === null || String(x).trim() === "" ? null : Number(x));
    const min = n(params.min);
    const max = n(params.max);
    if (min === null && max === null) throw new MarketError("Enter an RSI value to search for.", "invalid");
    for (const v of [min, max]) if (v !== null && !(v >= 0 && v <= 100)) throw new MarketError("RSI runs from 0 to 100.", "invalid");
    if (min !== null && max !== null && min > max) throw new MarketError("The lower RSI value is above the upper one.", "invalid");
    const period = n(params.period) === null ? 14 : Math.round(Number(params.period));
    if (!(period >= 2 && period <= 50)) throw new MarketError("The RSI period must be between 2 and 50.", "invalid");
    const pos = (x) => {
      const v = n(x);
      return v !== null && Number.isFinite(v) && v > 0 ? v : 0;
    };
    try {
      return await this.universe.scan({ min, max, period, minPrice: pos(params.minPrice), minTurnover: pos(params.minTurnover), funds: params.funds === "1" || params.funds === true });
    } catch (err) {
      if (err instanceof MarketError || err instanceof KiteError) throw err;
      throw new MarketError(err && err.message ? err.message : "The screener could not run.", "screener_failed", 502);
    }
  }

  /** The custom scanner over the Nifty 500 (market/scanner.js). */
  async screenerCustom(body = {}) {
    if (this.mode() !== "kite") throw new MarketError("The scanner needs the Zerodha connection: every stock's price comes from it.", "not_connected", 409);
    try {
      const to = Number(body.minTurnover);
      return await this.universe.customScan({ conditions: body.conditions, minTurnover: Number.isFinite(to) && to > 0 ? to : 0, funds: body.funds === true });
    } catch (err) {
      if (err instanceof MarketError || err instanceof KiteError) throw err;
      throw new MarketError(err && err.message ? err.message : "The scanner could not run.", "invalid", 400);
    }
  }

  /** Saved scans: a name and its conditions (up to 20). */
  scans() {
    const list = this.store.docs.read("market/scans.json", []);
    return { scans: Array.isArray(list) ? list : [] };
  }

  saveScan({ name, conditions } = {}) {
    const S = require("./scanner");
    const clean = String(name || "").trim().slice(0, 60);
    if (!clean) throw new MarketError("Give the scan a name.", "invalid");
    let conds;
    try {
      conds = S.validate(conditions);
    } catch (err) {
      throw new MarketError(err.message, "invalid");
    }
    const list = this.scans().scans.filter((x) => x.name.toLowerCase() !== clean.toLowerCase());
    if (list.length >= 20) throw new MarketError("You can keep up to 20 scans. Delete one first.", "invalid");
    const scan = { id: `s${this.now().toString(36)}`, name: clean, conditions: conds, savedAt: new Date(this.now()).toISOString() };
    this.store.docs.write("market/scans.json", [scan, ...list]);
    return this.scans();
  }

  removeScan(id) {
    this.store.docs.write("market/scans.json", this.scans().scans.filter((x) => x.id !== String(id)));
    return this.scans();
  }

  /* --------------------------------------------------------- market context */

  /** The market around every stock: Nifty's tide, India VIX, sectors, GIFT Nifty, the rupee, crude, gold. */
  async context() {
    const mode = this.mode();
    if (mode !== "kite") return { available: false, reason: mode === "demo" ? "Demo mode has no market feed." : "Zerodha is not connected.", items: [], sectors: [], notes: [] };
    const now = this.now();
    const streaming = Boolean(this.ticker && this.ticker.isLive());
    // one request covers every instrument; while ticks stream, the indices stay fresh without it
    const ttl = streaming ? 15000 : 6000;
    let stale = false;
    if (!this._ctx || now - this._ctx.at >= ttl) {
      const plan = contextKeys(now);
      try {
        const raw = await this._call((k) => k.quotes(plan.keys));
        let bars = { today: [], prior: [] };
        if (isMarketHours(now)) {
          try {
            bars = await this._recentBars(INDEX_SYMBOL);
          } catch (_) {
            /* the tide is then read without the 5-minute trend */
          }
        }
        this._ctx = { at: now, plan, raw, bars };
      } catch (err) {
        // a failed refresh serves the last reading for up to two minutes, marked as such
        if (!this._ctx || now - this._ctx.at >= 120000) throw err;
        stale = true;
      }
    }
    const { plan, raw, bars } = this._ctx;
    const quotes = { ...raw };
    for (const it of plan.streamable) {
      const t = this._liveQuote(it.symbol);
      if (t) quotes[it.key] = { ...(quotes[it.key] || {}), ...t };
    }
    const data = buildMarketContext({ quotes, plan, niftyBars: bars.today, priorBars: bars.prior, nowMs: now });
    data.world = this.worldProvider ? this.worldProvider() : null;
    data.streaming = streaming;
    if (stale) {
      data.stale = true;
      data.at = new Date(this._ctx.at).toISOString();
    }
    return data;
  }

  /* --------------------------------------------------------------- analysis */

  async analysis(symbol, { chartBars = 260 } = {}) {
    const d = await this.daily(symbol);
    const index = symbol === INDEX_SYMBOL ? null : await this.index();
    const inProgress = this._inProgress(d);
    const a = analyze(d.candles, { index, inProgress, chartBars: Math.max(60, Math.min(520, Number(chartBars) || 260)) });
    return {
      symbol,
      source: d.source,
      fetchedAt: d.fetchedAt,
      stale: d.stale,
      staleReason: d.staleReason,
      barInProgress: inProgress && a.enoughData,
      ...a,
    };
  }

  /** During market hours the newest daily bar is today's and is still changing. */
  _inProgress(d) {
    const n = d.candles.length;
    return d.source === "kite" && n > 0 && d.candles[n - 1].t === istDate(this.now()) && isMarketHours(this.now());
  }

  /**
   * Recent 5-minute bars, split into today's and the days before (those only warm up
   * the intraday averages). Shared for 20 seconds between everything that asks.
   */
  async _recentBars(symbol) {
    const now = this.now();
    const today = istDate(now);
    const hit = this._barsAt.get(symbol);
    // 20 seconds while prices are moving; ten minutes once the day's tape is final
    if (hit && hit.day === today && now - hit.at < (isMarketHours(now) ? 20000 : 600000)) return hit;
    const it = await this._instrument(symbol);
    const bars = await this._call((k) => k.historical(it.t, "5minute", new Date(now - 6 * DAY), new Date(now)));
    const rec = { at: now, day: today, today: bars.filter((b) => String(b.t).slice(0, 10) === today), prior: bars.filter((b) => String(b.t).slice(0, 10) < today).slice(-150) };
    if (this._barsAt.size > 200) this._barsAt.clear();
    this._barsAt.set(symbol, rec);
    return rec;
  }

  async _todayBars(symbol) {
    return (await this._recentBars(symbol)).today;
  }

  /**
   * The desk verdict for one symbol: direction, conviction, plans and every level.
   * Built from whatever is available — a missing live quote or missing intraday
   * bars weakens the reading and is stated, it never breaks it.
   */
  async verdict(symbol) {
    const d = await this.daily(symbol);
    const mode = this.mode();
    const index = symbol === INDEX_SYMBOL ? null : await this.index();
    const inProgress = this._inProgress(d);
    // the daily analysis only changes when the daily bars do; the verdict is polled every few seconds
    const key = `${d.fetchedAt}|${d.candles.length}|${inProgress}|${index ? index.candles.length : 0}`;
    let cached = this._analysisAt.get(symbol);
    if (!cached || cached.key !== key) {
      cached = { key, a: analyze(d.candles, { index, inProgress, chartBars: 1 }) };
      if (this._analysisAt.size > 60) this._analysisAt.clear();
      this._analysisAt.set(symbol, cached);
    }
    const a = cached.a;

    let quote = null;
    let quoteNote = "";
    if (mode !== "none") {
      try {
        quote = (await this.quotes([symbol])).quotes[symbol] || null;
        if (!quote) quoteNote = "The exchange returned no quote for this symbol.";
      } catch (err) {
        quoteNote = `Live quote unavailable (${err.message}).`;
      }
    } else quoteNote = "Zerodha is not connected, so there is no live quote.";

    let bars = null;
    let prior = [];
    let barsNote = "";
    let tape = null;
    if (mode === "kite") {
      try {
        const rec = await this._recentBars(symbol);
        prior = rec.prior;
        // the live call only reads today's bars while the market is open…
        if (isMarketHours(this.now())) bars = rec.today;
        // …but the intraday chart shows the latest session at any hour
        const lastDate = rec.prior.length ? String(rec.prior[rec.prior.length - 1].t).slice(0, 10) : "";
        const shown = rec.today.length ? rec.today : rec.prior.filter((b) => String(b.t).slice(0, 10) === lastDate);
        tape = buildTape(shown, { prevClose: rec.today.length && quote ? quote.prevClose : null });
        if (tape) {
          tape.today = rec.today.length > 0;
          tape.step = 5;
          tape.forming = tape.today && this._forming(shown, 5);
        }
      } catch (err) {
        barsNote = `Intraday bars unavailable (${err.message}).`; // the verdict says so instead of failing
      }
    }

    // the market around it: Nifty's tide, India VIX, and the latest world brief if there is one
    let market = null;
    if (mode === "kite" && symbol !== INDEX_SYMBOL) {
      try {
        const c = await this.context();
        if (c.available) market = { tide: c.tide, nifty: c.nifty, vix: c.vix, world: c.world || null };
      } catch (_) {
        market = null; // the call is then made on the stock's own tape alone
      }
    }

    // the 1-minute tape, for the fastest read of all — the call still stands without it
    let fast = null;
    if (mode === "kite" && bars && bars.length) {
      try {
        const rec = await this._minuteBars(symbol);
        if (rec.today) fast = fastRead(rec.bars, { last: quote ? quote.last : null });
      } catch (_) {
        fast = null;
      }
    }

    const v = buildVerdict({ analysis: a, candles: d.candles, quote, intradayBars: bars, priorBars: prior, inProgress, stale: d.stale, nowMs: this.now(), market, micro: mode === "kite" ? this._tapeNow(symbol) : null, fast });
    if (v.available && mode !== "kite") v.day = { available: false, reason: mode === "demo" ? "Demo prices have no live tape. Connect Zerodha for the live intraday call." : "Zerodha is not connected, so there is no live tape to read.", session: v.day.session };
    else if (v.available && !v.day.available && barsNote) v.day.reason = barsNote;
    return {
      symbol,
      source: d.source,
      fetchedAt: d.fetchedAt,
      stale: d.stale,
      staleReason: d.staleReason,
      at: new Date(this.now()).toISOString(),
      marketHours: isMarketHours(this.now()),
      quoteLive: mode === "kite" && Boolean(quote),
      quoteNote,
      streaming: Boolean(quote && quote.streamed),
      tape,
      ...v,
    };
  }

  async backtest(symbol, strategyId, { costPct } = {}) {
    const strategy = byId(strategyId);
    if (!strategy) throw new MarketError("Unknown strategy.", "invalid");
    const d = await this.daily(symbol);
    const cost = Number.isFinite(Number(costPct)) ? Math.max(0, Math.min(5, Number(costPct))) : 0.3;
    const r = runBacktest(d.candles, strategy, { costPct: cost });
    // thin the equity curve for the wire: at most ~400 points
    const step = Math.max(1, Math.ceil(r.equity.length / 400));
    const equity = r.equity.filter((_, i) => i % step === 0 || i === r.equity.length - 1).map((p) => ({ t: p.t, v: Math.round(p.v * 10000) / 10000 }));
    return { symbol, source: d.source, stale: d.stale, strategy: { id: strategy.id, name: strategy.name }, costPct: cost, stats: r.stats, open: r.open, trades: r.trades.slice(-200), equity };
  }

  /** Every strategy on one symbol, side by side. */
  async backtestAll(symbol, { costPct } = {}) {
    const d = await this.daily(symbol);
    const cost = Number.isFinite(Number(costPct)) ? Math.max(0, Math.min(5, Number(costPct))) : 0.3;
    const ctx = buildContext(d.candles);
    return {
      symbol,
      source: d.source,
      costPct: cost,
      rows: STRATEGIES.map((s) => {
        const r = runBacktest(d.candles, s, { costPct: cost, ctx });
        return { id: s.id, name: s.name, style: s.style, stats: r.stats, open: Boolean(r.open) };
      }),
    };
  }

  /** One-line reading for every watchlist symbol. A failing symbol never sinks the rest. */
  /* ------------------------------------------------------ behaviour memory */

  /**
   * How a stock has behaved over the past year of daily bars (server/market/profile.js),
   * kept in the database ("market/behaviour.json"): the profile, rebuilt at most once a day,
   * plus one snapshot per day so the record of the stock's behaviour grows over time.
   * Additional to every existing reading — nothing else changes because of it.
   */
  async behaviour(symbol, { refresh = false } = {}) {
    const docs = this.store.docs;
    const today = istDate(this.now());
    const all = (docs && docs.read("market/behaviour.json", {})) || {};
    const hit = all[symbol];
    if (hit && !refresh && hit.builtOn === today) return hit;
    const d = await this.daily(symbol);
    const p = buildProfile(symbol, d.candles.slice(-520));
    const history = (hit && Array.isArray(hit.history) ? hit.history : []).filter((h) => h.d !== today);
    if (p.available) {
      history.push({ d: today, asOf: p.asOf, c: p.price.last, trend: p.trend.now, pos52Pct: p.price.pos52Pct, atrPct: p.volatility.atrPct, volRatio: p.volume.ratioNow, structure: p.structure.pattern });
    }
    const rec = { ...p, source: d.source, builtAt: new Date(this.now()).toISOString(), builtOn: today, history: history.slice(-250) };
    if (docs) {
      all[symbol] = rec;
      const keys = Object.keys(all);
      if (keys.length > 80) keys.sort((a, b) => (all[a].builtAt < all[b].builtAt ? -1 : 1)).slice(0, keys.length - 80).forEach((k) => delete all[k]);
      docs.write("market/behaviour.json", all);
    }
    return rec;
  }

  /** The stored profiles in short form, for a list. */
  behaviourList() {
    const all = (this.store.docs && this.store.docs.read("market/behaviour.json", {})) || {};
    return Object.values(all)
      .filter((r) => r && r.available)
      .map((r) => ({ symbol: r.symbol, builtAt: r.builtAt, asOf: r.asOf, trend: r.trend.now, structure: r.structure.pattern, pos52Pct: r.price.pos52Pct, atrPct: r.volatility.atrPct, regime: r.volatility.regime, snapshots: (r.history || []).length }));
  }

  /** Learn (or refresh) every watchlist stock, one after another. */
  async learnWatchlist({ refresh = true } = {}) {
    const out = [];
    for (const s of this.watchlist()) {
      try {
        const r = await this.behaviour(s, { refresh });
        out.push({ symbol: s, ok: Boolean(r.available), reason: r.available ? "" : r.reason });
      } catch (err) {
        out.push({ symbol: s, ok: false, reason: err.message });
      }
    }
    return { learned: out };
  }

  /** Once a day, while the desk is in use: bring stale watchlist profiles up to date in the background. */
  _learnStale() {
    const today = istDate(this.now());
    if (this._learnedOn === today || this._learning) return;
    this._learning = this.learnWatchlist({ refresh: false })
      .then(() => {
        this._learnedOn = today;
      })
      .catch(() => {})
      .finally(() => {
        this._learning = null;
      });
  }

  /* ---------------------------------------------------------- measured odds */

  /**
   * The measured odds for one stock (server/market/edge.js): what followed the past days most
   * like today, and how the same favourable calls did when each was made with earlier data
   * only. Built from completed daily bars — today's forming bar is left out, and only its
   * open is used, for the day reading. Kept in the database ("market/edge.json"), good for
   * one part of the trading day. Additional to every other reading; nothing else changes.
   */
  edge(symbol, { refresh = false } = {}) {
    if (!this._edgeBusy) this._edgeBusy = new Map();
    const hit = this._edgeBusy.get(symbol);
    if (hit) return hit;
    const p = this._edge(symbol, refresh).finally(() => this._edgeBusy.delete(symbol));
    this._edgeBusy.set(symbol, p);
    return p;
  }

  async _edge(symbol, refresh) {
    if (!SYMBOL_RE.test(symbol)) throw new MarketError("That is not a valid symbol.", "invalid");
    const docs = this.store.docs;
    const now = this.now();
    const phase = sessionPhase(now);
    const saved = ((docs && docs.read(EDGE_DOC, {})) || {})[symbol];
    // during the session a reading made before the open was known is redone once it is
    const awaitsOpen = saved && phase.endsWith("|open") && saved.available && saved.kinds.day.preOpen && now - Date.parse(saved.builtAt) > 120000;
    if (saved && !refresh && saved.phase === phase && !awaitsOpen) return saved;

    const d = await this.daily(symbol);
    let bars = d.candles;
    let forming = null;
    if (this._inProgress(d)) {
      forming = bars[bars.length - 1];
      bars = bars.slice(0, -1);
    }
    const head = { symbol, source: d.source, stale: Boolean(d.stale), phase, builtAt: new Date(now).toISOString() };
    let rec;
    if (bars.length < E.WARMUP + 40) {
      rec = { ...head, available: false, reason: `Measured odds need more than a year of daily bars; ${symbol} has ${bars.length}.` };
    } else {
      const model = await this._edgeModel(symbol, bars);
      const tick = this._liveQuote(symbol);
      const last = tick && isNum(tick.last) ? tick.last : forming ? forming.c : null;
      const report = E.read(model, { open: forming ? forming.o : null, last });
      rec = { ...head, ...report, last: isNum(last) ? Math.round(last * 100) / 100 : null };
      // the knowledge base's checks on the same stock's completed sessions (market/situation.js): context
      // shown beside the measured odds, never part of them
      rec.knowledge = this._edgeKnowledge(bars);
      if (d.source === "kite") this._trackSignals(symbol, model, rec);
    }
    if (docs) {
      const all = docs.read(EDGE_DOC, {}) || {}; // read again: other stocks were written while this one was computed
      all[symbol] = rec;
      const keys = Object.keys(all);
      if (keys.length > 80) keys.sort((a, b) => (all[a].builtAt < all[b].builtAt ? -1 : 1)).slice(0, keys.length - 80).forEach((k) => delete all[k]);
      docs.write(EDGE_DOC, all);
    }
    return rec;
  }

  /** What the knowledge base says about a stock's completed daily sessions, for the Advisor (null when it cannot say). */
  _edgeKnowledge(bars) {
    try {
      const df = require("./picks").dailyFeatures(bars);
      if (!df) return null;
      const KC = require("./situation");
      return KC.brief(KC.check(KC.fromPick(df, null, { live: false })), { limit: 6 });
    } catch (_) {
      return null; // the knowledge base never stops a reading of the odds
    }
  }

  /** The learned model for a stock, kept in memory while its history is unchanged. */
  async _edgeModel(symbol, bars) {
    if (!this._edgeModels) this._edgeModels = new Map();
    const lastBar = bars[bars.length - 1];
    const key = `${bars.length}|${bars[0].t}|${lastBar.t}|${lastBar.c}`;
    const hit = this._edgeModels.get(symbol);
    if (hit && hit.key === key) return hit.model;
    const index = symbol === INDEX_SYMBOL ? null : await this.index();
    const model = await E.buildModelAsync(bars, index ? index.candles : null);
    if (this._edgeModels.size >= 60) this._edgeModels.delete(this._edgeModels.keys().next().value);
    this._edgeModels.set(symbol, { key, model });
    return model;
  }

  _signalList() {
    const a = this.store.docs && this.store.docs.read(SIGNAL_DOC, []);
    return Array.isArray(a) ? a : [];
  }

  /**
   * The forward record. Every favourable reading is written down once, on the day it is made,
   * before anyone knows how it ends; later it is scored against the real bars by the same
   * rules the engine learned from. Unlike a backtest, this cannot be flattered by hindsight.
   * A swing reading is not logged again while an earlier one for that stock and side is open.
   */
  _trackSignals(symbol, model, rec) {
    const docs = this.store.docs;
    if (!docs) return;
    const list = this._signalList();
    const P = model.P;
    const nowIso = new Date(this.now()).toISOString();
    let changed = false;
    for (const s of list) {
      if (s.symbol !== symbol || isNum(s.r)) continue;
      const i = P.dates.lastIndexOf(s.asOf);
      if (i < 0) continue;
      const x = E.outcome(E.KINDS[s.kind], s.side, P.o, P.h, P.l, P.c, P.n, i, P.atr[i]);
      if (!isNum(x.r)) continue;
      Object.assign(s, { r: Math.round(x.r * 100) / 100, exitDate: P.dates[x.exit], how: HOW[x.how], scoredAt: nowIso });
      changed = true;
    }
    if (rec.available) {
      for (const kind of Object.keys(E.KINDS)) {
        const k = rec.kinds[kind];
        if (E.KINDS[kind].usesGap && k.preOpen) continue; // the day reading is logged once its open is known
        for (const side of E.SIDES) {
          const x = k[side];
          if (!x.grade) continue;
          const id = `${symbol}|${kind}|${side}|${rec.asOf}`;
          if (list.some((s) => s.id === id)) continue;
          if (kind === "swing" && list.some((s) => s.symbol === symbol && s.kind === kind && s.side === side && !isNum(s.r))) continue;
          list.unshift({ id, at: nowIso, symbol, kind, side, asOf: rec.asOf, grade: x.grade, n: x.live.n, winPct: x.live.winPct, expR: x.live.expR, entryRef: x.plan ? x.plan.entryRef : null, stop: x.plan ? x.plan.stop : null, target: x.plan ? x.plan.target : null });
          changed = true;
        }
      }
    }
    if (changed) docs.write(SIGNAL_DOC, list.slice(0, SIGNAL_KEEP));
  }

  /** The forward record: what was called, and how the calls whose outcome is known turned out. */
  signals({ symbol = "" } = {}) {
    const all = this._signalList();
    const mine = symbol ? all.filter((s) => s.symbol === symbol) : all;
    const groups = {};
    const add = (key, s) => {
      const g = groups[key] || (groups[key] = { key, calls: 0, open: 0, scored: 0, wins: 0, sum: 0, sq: 0 });
      g.calls += 1;
      if (!isNum(s.r)) {
        g.open += 1;
        return;
      }
      g.scored += 1;
      if (s.r > 0) g.wins += 1;
      g.sum += s.r;
      g.sq += s.r * s.r;
    };
    for (const s of mine) {
      add(`grade ${s.grade}`, s);
      add(`${s.kind} ${s.side}`, s);
      add("all", s);
    }
    const summary = Object.values(groups).map((g) => {
      const mean = g.scored ? g.sum / g.scored : null;
      const sd = g.scored > 1 ? Math.sqrt(Math.max(0, g.sq / g.scored - mean * mean) * (g.scored / (g.scored - 1))) : 0;
      return { key: g.key, calls: g.calls, open: g.open, scored: g.scored, winPct: g.scored ? Math.round((g.wins / g.scored) * 1000) / 10 : null, expR: g.scored ? Math.round(mean * 100) / 100 : null, t: sd > 0 ? Math.round((mean / (sd / Math.sqrt(g.scored))) * 100) / 100 : null };
    });
    return { since: mine.length ? mine[mine.length - 1].at : null, summary, signals: mine.slice(0, 200) };
  }

  /**
   * The watchlist's readings side by side, from the database, plus the method's pooled
   * walk-forward record across those stocks. Anything missing or out of date is rebuilt
   * behind this call; the answer says how many are still being worked on.
   */
  edgeBoard() {
    const docs = this.store.docs;
    const all = (docs && docs.read(EDGE_DOC, {})) || {};
    const now = this.now();
    const phase = sessionPhase(now);
    const list = this.watchlist();
    if (!this._edgeErrors) this._edgeErrors = new Map();
    const rows = list.map((symbol) => {
      const r = all[symbol];
      const err = this._edgeErrors.get(symbol);
      if (!r) return { symbol, pending: !err, error: err ? err.message : undefined };
      return { ...r, fresh: r.phase === phase, error: err ? err.message : undefined };
    });
    const stale = list.filter((s) => {
      const err = this._edgeErrors.get(s);
      if (err && now - err.at < 5 * 60 * 1000) return false;
      return !all[s] || all[s].phase !== phase;
    });
    if (stale.length) this._edgeLearn(stale);
    const pooled = {};
    for (const kind of Object.keys(E.KINDS)) {
      for (const side of E.SIDES) {
        const g = { stocks: 0, trades: 0, wins: 0, sum: 0, sq: 0 };
        for (const r of rows) {
          const p = r.available ? r.kinds[kind][side].pool : null;
          if (!p || !p.n) continue;
          g.stocks += 1;
          g.trades += p.n;
          g.wins += p.wins || 0;
          g.sum += p.sum;
          g.sq += p.sq;
        }
        const mean = g.trades ? g.sum / g.trades : null;
        const sd = g.trades > 1 ? Math.sqrt(Math.max(0, g.sq / g.trades - mean * mean) * (g.trades / (g.trades - 1))) : 0;
        pooled[`${kind}.${side}`] = { kind, side, stocks: g.stocks, trades: g.trades, winPct: g.trades ? Math.round((g.wins / g.trades) * 1000) / 10 : null, expR: g.trades ? Math.round(mean * 100) / 100 : null, t: sd > 0 ? Math.round((mean / (sd / Math.sqrt(g.trades))) * 100) / 100 : null };
      }
    }
    const queue = this._edgeQueue ? this._edgeQueue.length : 0;
    return { rows, pooled, proof: E.PROOF, rules: E.KINDS, building: queue + (this._edgeNow ? 1 : 0), phase, at: new Date(now).toISOString() };
  }

  /* ------------------------------------------------------------ price alerts */

  // A price alert is a note to yourself: "tell me when SBIN reaches 800". It is kept in the
  // database so it survives a reload and shows on every device; the open page watches the
  // price and reports the crossing here, so an alert fires once. Nothing is traded by it.

  _alertList() {
    const a = this.store.docs && this.store.docs.read(ALERT_DOC, []);
    return Array.isArray(a) ? a : [];
  }

  alerts() {
    return { alerts: this._alertList() };
  }

  /** @param input { symbol, price, dir?: "above" | "below", note? } — without dir, the side is taken from the price now */
  async addAlert(input, by = "") {
    const symbol = String((input && input.symbol) || "").trim().toUpperCase();
    const price = Number(input && input.price);
    if (!SYMBOL_RE.test(symbol)) throw new MarketError("That is not a valid symbol.", "invalid");
    if (!(price > 0 && price < 1e7)) throw new MarketError("Enter the price to be told about.", "invalid");
    let dir = input.dir === "above" || input.dir === "below" ? input.dir : "";
    let from = null;
    if (!dir) {
      try {
        const q = (await this.quotes([symbol])).quotes[symbol];
        if (q && isNum(q.last)) from = q.last;
      } catch (_) {
        /* fall through to the last close */
      }
      if (from === null) {
        const cache = this._readCache(symbol);
        if (cache && cache.candles.length) from = cache.candles[cache.candles.length - 1].c;
      }
      if (from === null) throw new MarketError(`The price of ${symbol} could not be read just now. Say whether to alert above or below ${price}.`, "no_price", 409);
      dir = price >= from ? "above" : "below";
    }
    const list = this._alertList();
    if (list.filter((a) => !a.firedAt).length >= ALERT_MAX) throw new MarketError(`You have ${ALERT_MAX} alerts waiting. Remove one first.`, "too_many", 409);
    if (list.some((a) => !a.firedAt && a.symbol === symbol && a.dir === dir && a.price === price)) throw new MarketError("That alert is already set.", "duplicate", 409);
    const alert = { id: `${this.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, symbol, dir, price: Math.round(price * 100) / 100, note: String((input && input.note) || "").trim().slice(0, 120), from: from === null ? null : Math.round(from * 100) / 100, createdAt: new Date(this.now()).toISOString(), by, firedAt: null, firedPrice: null };
    this._saveAlerts([alert, ...list]);
    this._tell("alerts", { id: alert.id, symbol: alert.symbol, what: "added" });
    return { alert, alerts: this._alertList() };
  }

  _saveAlerts(list) {
    const waiting = list.filter((a) => !a.firedAt);
    const fired = list.filter((a) => a.firedAt).sort((a, b) => (a.firedAt < b.firedAt ? 1 : -1)).slice(0, ALERT_KEEP);
    this.store.docs.write(ALERT_DOC, [...waiting, ...fired]);
  }

  removeAlert(id) {
    const list = this._alertList();
    const next = list.filter((a) => a.id !== String(id));
    if (next.length !== list.length) {
      this._saveAlerts(next);
      this._tell("alerts", { id: String(id), what: "removed" });
    }
    return { alerts: this._alertList() };
  }

  /** The page saw the price cross. Recorded once: a second report (another tab) changes nothing. */
  fireAlert(id, price) {
    const list = this._alertList();
    const a = list.find((x) => x.id === String(id));
    if (!a) throw new MarketError("That alert no longer exists.", "not_found", 404);
    const first = !a.firedAt;
    if (first) {
      a.firedAt = new Date(this.now()).toISOString();
      a.firedPrice = isNum(Number(price)) && Number(price) > 0 ? Math.round(Number(price) * 100) / 100 : null;
      this._saveAlerts(list);
      this._tell("alerts", { id: a.id, symbol: a.symbol, what: "fired", price: a.firedPrice });
    }
    return { alert: a, first, alerts: this._alertList() };
  }

  /** Build the readings for these stocks one after another, in the background. */
  _edgeLearn(symbols) {
    if (!this._edgeQueue) this._edgeQueue = [];
    if (!this._edgeErrors) this._edgeErrors = new Map();
    for (const s of symbols) if (s !== this._edgeNow && !this._edgeQueue.includes(s)) this._edgeQueue.push(s);
    if (this._edgeRunning) return this._edgeRunning;
    this._edgeRunning = (async () => {
      while (this._edgeQueue.length) {
        const s = this._edgeQueue.shift();
        this._edgeNow = s;
        try {
          await this.edge(s);
          this._edgeErrors.delete(s);
        } catch (err) {
          this._edgeErrors.set(s, { at: this.now(), message: err.message });
        }
      }
    })().finally(() => {
      this._edgeNow = null;
      this._edgeRunning = null;
    });
    return this._edgeRunning;
  }

  /** Once per part of the trading day, while the desk is in use: keep the watchlist's readings (and the forward record) current. */
  _edgeStale() {
    const phase = sessionPhase(this.now());
    if (this._edgePhase === phase) return;
    this._edgePhase = phase;
    const all = (this.store.docs && this.store.docs.read(EDGE_DOC, {})) || {};
    const stale = this.watchlist().filter((s) => !all[s] || all[s].phase !== phase);
    if (stale.length) this._edgeLearn(stale).catch(() => {});
  }

  async scan() {
    if (this.mode() === "kite") {
      this._learnStale();
      this._edgeStale();
    }
    const symbols = this.watchlist();
    const index = await this.index();
    const rows = [];
    for (const symbol of symbols) {
      try {
        const d = await this.daily(symbol);
        rows.push({ symbol, source: d.source, stale: d.stale, ...summarize(d.candles, { index }) });
      } catch (err) {
        rows.push({ symbol, enoughData: false, error: err.message });
      }
    }
    return { rows, at: new Date(this.now()).toISOString() };
  }

  /** Today's intraday picture from 5-minute bars: VWAP and the opening range. Kite only. */
  async intraday(symbol) {
    if (this.mode() !== "kite") return { available: false, reason: "Intraday levels need a live Zerodha connection." };
    const now = this.now();
    const bars = await this._todayBars(symbol);
    if (bars.length === 0) return { available: false, reason: "No trades yet today." };
    const v = I.vwap(bars);
    const opening = bars.slice(0, 3); // first 15 minutes
    const last = bars[bars.length - 1];
    const r2 = (x) => Math.round(x * 100) / 100;
    return {
      available: true,
      date: istDate(now),
      bars: bars.length,
      last: last.c,
      vwap: r2(v[v.length - 1]),
      aboveVwap: last.c > v[v.length - 1],
      openingRange: opening.length === 3 ? { high: Math.max(...opening.map((b) => b.h)), low: Math.min(...opening.map((b) => b.l)) } : null,
      dayHigh: Math.max(...bars.map((b) => b.h)),
      dayLow: Math.min(...bars.map((b) => b.l)),
      volume: bars.reduce((s, b) => s + b.v, 0),
    };
  }

  /** One past session's 5-minute bars — used to score an intraday plan after the fact. Kite only. */
  async intradayOn(symbol, date) {
    if (this.mode() !== "kite") throw new MarketError("Scoring intraday plans needs the Zerodha connection.", "not_connected", 409);
    if (!/^\d{4}-\d\d-\d\d$/.test(String(date))) throw new MarketError("That is not a valid date.", "invalid");
    const it = await this._instrument(symbol);
    const start = Date.parse(`${date}T00:00:00Z`) - IST;
    const bars = await this._call((k) => k.historical(it.t, "5minute", new Date(start), new Date(start + DAY - 1000)));
    return bars.filter((b) => String(b.t).slice(0, 10) === date);
  }

  strategies() {
    return STRATEGIES.map((s) => ({ id: s.id, name: s.name, style: s.style, idea: s.idea, exitText: s.exitText }));
  }
}

module.exports = { MarketService, MarketError, tokenExpiry, isMarketHours, tickQuote, SYMBOL_RE, INDEX_SYMBOL, sessionDay };
