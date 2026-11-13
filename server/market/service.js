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
const { buildContext: buildMarketContext, contextKeys } = require("./context");
const { buildProfile } = require("./profile");

const DAY = 86400000;
const IST = 5.5 * 3600 * 1000;
const HISTORY_DAYS = 3650; // ~10 years of daily bars
const CHUNK_DAYS = 1800; // per historical request
const DAILY_WAIT_MS = 2500; // how long a page waits on a daily top-up before it is shown the saved copy
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9&._ -]{0,24}$/;
const MAX_WATCHLIST = 40;
const INDEX_SYMBOL = "NIFTY 50";

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
  constructor({ dir, store, secrets, fetchImpl = globalThis.fetch, now = () => Date.now(), log = console, gaps, wsImpl, tickerOptions }) {
    this.dir = path.join(dir, "market");
    this.store = store;
    this.secrets = secrets;
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
    this.universe = new Universe({ dir: this.dir, market: this }); // every NSE stock, for the screener
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

  async completeLogin(requestToken) {
    if (!/^[A-Za-z0-9]{6,64}$/.test(String(requestToken || ""))) throw new MarketError("Kite did not send a valid request token.", "invalid");
    const s = this._settings();
    const r = await exchangeToken({
      apiKey: s.kiteApiKey,
      apiSecret: this._secret("kiteApiSecretEnc"),
      requestToken,
      fetchImpl: this.fetch,
    });
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
    return this.kiteState();
  }

  disconnect() {
    this.store.update((d) => {
      d.settings.kiteAccessTokenEnc = "";
      d.settings.kiteLoginAt = "";
    });
    this._client = null;
    this._syncTicker();
  }

  setDemo(on) {
    this.store.update((d) => {
      d.market.demo = Boolean(on);
    });
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
    });
    return this.watchlist();
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
      const raw = await this._call((k) => k.quotes(need.map((s) => `NSE:${s}`)));
      // a symbol Kite did not answer for is remembered too, so it is not asked again at once
      for (const s of need) this._quoteAt.set(s, { at: now, q: raw[`NSE:${s}`] || null });
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
    return { ...this.universe.status(), connected: this.mode() === "kite" };
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

  async scan() {
    if (this.mode() === "kite") this._learnStale();
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

module.exports = { MarketService, MarketError, tokenExpiry, isMarketHours, tickQuote, SYMBOL_RE, INDEX_SYMBOL };
