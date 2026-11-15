"use strict";
// Overseas markets, as numbers: the US, Europe, Japan, Singapore, Hong Kong, Korea and China.
//
// Zerodha carries no foreign indices, so this reads them from Financial Modeling Prep (FMP) with the
// owner's own API key (typed in by the owner on the Desk's "Market & world" panel; kept encrypted, never
// shown again). Each index comes with its last level, change, previous close, the day's range and volume
// where the provider gives them; whether its exchange is open now is worked out here from the
// exchange's own hours and time zone (exchange holidays are not known). Daily closes of the US and
// Europe are read once a day so the forecast can MEASURE how the Nifty's open has followed them.
//
// What FMP serves depends on the owner's FMP plan: a plan that refuses index quotes is reported in the
// owner's words ("FMP refused: …"), and the desk carries on with GIFT Nifty and Zerodha's other prices.
// Calls are counted per day and stop below the free plan's 250. Read-only; no order, no AI.

const API = "https://financialmodelingprep.com/stable";
const DOC = "market/global-feed.json";
const CACHE = "market/global-cache.json";
const IST = 5.5 * 3600 * 1000;
const istDay = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const num = (x) => typeof x === "number" && Number.isFinite(x);
const n = (x) => {
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
};

/** The overseas indices the desk follows, with their exchange's hours in its own time zone. */
const MARKETS = [
  { id: "spx", name: "S&P 500", region: "US", fmp: "^GSPC", tz: "America/New_York", open: "09:30", close: "16:00" },
  { id: "ixic", name: "Nasdaq Composite", region: "US", fmp: "^IXIC", tz: "America/New_York", open: "09:30", close: "16:00" },
  { id: "dji", name: "Dow Jones", region: "US", fmp: "^DJI", tz: "America/New_York", open: "09:30", close: "16:00" },
  { id: "vix", name: "US VIX", region: "US", fmp: "^VIX", tz: "America/New_York", open: "09:30", close: "16:15", inverse: true },
  { id: "ftse", name: "FTSE 100", region: "Europe", fmp: "^FTSE", tz: "Europe/London", open: "08:00", close: "16:30" },
  { id: "dax", name: "DAX", region: "Europe", fmp: "^GDAXI", tz: "Europe/Berlin", open: "09:00", close: "17:30" },
  { id: "cac", name: "CAC 40", region: "Europe", fmp: "^FCHI", tz: "Europe/Paris", open: "09:00", close: "17:30" },
  { id: "n225", name: "Nikkei 225", region: "Japan", fmp: "^N225", tz: "Asia/Tokyo", open: "09:00", close: "15:30" },
  { id: "sti", name: "Straits Times (STI)", region: "Singapore", fmp: "^STI", tz: "Asia/Singapore", open: "09:00", close: "17:00" },
  { id: "hsi", name: "Hang Seng", region: "Hong Kong", fmp: "^HSI", tz: "Asia/Hong_Kong", open: "09:30", close: "16:00" },
  { id: "kospi", name: "KOSPI", region: "Korea", fmp: "^KS11", tz: "Asia/Seoul", open: "09:00", close: "15:30" },
  { id: "sse", name: "Shanghai Composite", region: "China", fmp: "000001.SS", tz: "Asia/Shanghai", open: "09:30", close: "15:00" },
];
const HISTORY = ["spx", "ixic", "dax", "n225"]; // daily closes for the measured sensitivities
const DAILY_CAP = 240; // stays under the free plan's 250 calls a day

/** Local weekday, minutes and date in a time zone. */
function local(tz, ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", year: "numeric", month: "2-digit", day: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { dow: p.weekday, mins: Number(p.hour) * 60 + Number(p.minute), date: `${p.year}-${p.month}-${p.day}` };
}
const toMins = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** "live", "pre" (before today's open), "closed" (after the close or a weekend) — holidays are not known. */
function sessionOf(m, ms) {
  const l = local(m.tz, ms);
  if (l.dow === "Sat" || l.dow === "Sun") return "closed";
  if (l.mins < toMins(m.open)) return "pre";
  return l.mins < toMins(m.close) ? "live" : "closed";
}

/** One provider row, whatever its shape (quote, batch quote, short quote) → the desk's shape. */
function shapeQuote(m, r, ms) {
  if (!r) return { id: m.id, name: m.name, region: m.region, available: false };
  const last = n(r.price ?? r.lastPrice ?? r.close);
  const change = n(r.change);
  let prevClose = n(r.previousClose);
  if (!num(prevClose) && num(last) && num(change)) prevClose = last - change;
  let changePct = n(r.changePercentage ?? r.changesPercentage ?? r.changePercent);
  if (!num(changePct) && num(change) && num(prevClose) && prevClose) changePct = (change / prevClose) * 100;
  const ts = n(r.timestamp);
  return {
    id: m.id,
    name: m.name,
    region: m.region,
    available: num(last),
    last,
    change,
    changePct: num(changePct) ? Math.round(changePct * 100) / 100 : null,
    prevClose,
    open: n(r.open),
    high: n(r.dayHigh),
    low: n(r.dayLow),
    volume: n(r.volume),
    asOf: num(ts) ? new Date(ts * (ts < 1e12 ? 1000 : 1)).toISOString() : new Date(ms).toISOString(),
    session: sessionOf(m, ms),
    inverse: Boolean(m.inverse),
    source: "FMP",
  };
}

class GlobalFeed {
  constructor({ docs, secrets, fetchImpl = globalThis.fetch, now = () => Date.now(), log = console }) {
    this.docs = docs;
    this.secrets = secrets;
    this.fetch = fetchImpl;
    this.now = now;
    this.log = log;
    this._busy = null;
  }

  _state() {
    return (this.docs && this.docs.read(DOC, null)) || {};
  }
  _key() {
    const s = this._state();
    if (!s.key) return "";
    try {
      return this.secrets.decrypt(s.key);
    } catch (_) {
      return "";
    }
  }
  configured() {
    return Boolean(this._state().key);
  }

  status() {
    const s = this._state();
    const c = (this.docs && this.docs.read(CACHE, null)) || {};
    return {
      provider: "Financial Modeling Prep",
      configured: Boolean(s.key),
      setAt: s.setAt || null,
      lastAt: c.at || null,
      lastError: s.lastError || "",
      callsToday: s.calls && s.calls.day === istDay(this.now()) ? s.calls.n : 0,
      dailyCap: DAILY_CAP,
      markets: MARKETS.map((m) => ({ id: m.id, name: m.name, region: m.region })),
    };
  }

  /** Save or remove the owner's key. The key is never returned. */
  setKey({ key, remove = false } = {}) {
    const s = this._state();
    if (remove) {
      delete s.key;
      s.lastError = "";
      this.docs.write(DOC, s);
      this.docs.write(CACHE, {});
      return this.status();
    }
    const k = String(key || "").trim();
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(k)) throw Object.assign(new Error("That does not look like an FMP API key (letters and digits, 16–64 long)."), { code: "invalid", status: 400 });
    s.key = this.secrets.encrypt(k);
    s.setAt = new Date(this.now()).toISOString();
    s.lastError = "";
    this.docs.write(DOC, s);
    this.docs.write(CACHE, {});
    return this.status();
  }

  _count() {
    const s = this._state();
    const day = istDay(this.now());
    const used = s.calls && s.calls.day === day ? s.calls.n : 0;
    if (used >= DAILY_CAP) throw Object.assign(new Error(`Today's ${DAILY_CAP} calls to FMP are used; overseas numbers resume tomorrow.`), { code: "quota" });
    s.calls = { day, n: used + 1 };
    this.docs.write(DOC, s);
  }

  async _get(path) {
    const key = this._key();
    if (!key) throw Object.assign(new Error("No FMP key saved."), { code: "not_configured" });
    this._count();
    const sep = path.includes("?") ? "&" : "?";
    const res = await this.fetch(`${API}${path}${sep}apikey=${encodeURIComponent(key)}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch (_) {
      body = null;
    }
    const said = body && !Array.isArray(body) && (body["Error Message"] || body.error || body.message);
    if (!res.ok || said) {
      const msg = `FMP refused: ${String(said || `HTTP ${res.status}`).slice(0, 200)}`;
      const s = this._state();
      s.lastError = msg;
      this.docs.write(DOC, s);
      throw Object.assign(new Error(msg), { code: "upstream" });
    }
    return Array.isArray(body) ? body : body ? [body] : [];
  }

  /**
   * Every followed index now. Kept 10 minutes while any of their exchanges is open (30 otherwise);
   * a failed read returns the last good one, marked stale.
   */
  async quotes({ refresh = false } = {}) {
    if (!this.configured()) return { available: false, reason: "Add a Financial Modeling Prep API key to see the overseas indices.", markets: [] };
    const now = this.now();
    const cache = (this.docs && this.docs.read(CACHE, null)) || {};
    const anyLive = MARKETS.some((m) => sessionOf(m, now) === "live");
    const ttl = (anyLive ? 10 : 30) * 60000;
    const restamp = (list) => list.map((q) => ({ ...q, session: sessionOf(MARKETS.find((m) => m.id === q.id), now) }));
    if (!refresh && cache.at && now - Date.parse(cache.at) < ttl && Array.isArray(cache.markets)) return { available: true, at: cache.at, markets: restamp(cache.markets), stale: false };
    if (this._busy) return this._busy;
    this._busy = (async () => {
      try {
        let rows = [];
        try {
          rows = await this._get(`/batch-index-quotes?symbols=${encodeURIComponent(MARKETS.map((m) => m.fmp).join(","))}`);
        } catch (err) {
          if (err.code === "quota" || err.code === "not_configured") throw err;
          // a plan without the batch endpoint: the three that matter most, one by one
          for (const m of MARKETS.filter((x) => ["spx", "n225", "dax"].includes(x.id))) rows.push(...(await this._get(`/quote?symbol=${encodeURIComponent(m.fmp)}`)));
        }
        const by = new Map(rows.map((r) => [String(r.symbol || ""), r]));
        const markets = MARKETS.map((m) => shapeQuote(m, by.get(m.fmp), now));
        if (!markets.some((x) => x.available)) throw Object.assign(new Error("FMP answered, but with no index prices (your plan may not include indices)."), { code: "empty" });
        const out = { at: new Date(now).toISOString(), markets };
        this.docs.write(CACHE, { ...cache, ...out });
        const s = this._state();
        if (s.lastError) {
          s.lastError = "";
          this.docs.write(DOC, s);
        }
        return { available: true, ...out, stale: false };
      } catch (err) {
        if (Array.isArray(cache.markets) && cache.markets.length) return { available: true, at: cache.at, markets: restamp(cache.markets), stale: true, error: err.message };
        return { available: false, reason: err.message, markets: [] };
      } finally {
        this._busy = null;
      }
    })();
    return this._busy;
  }

  /** Daily closes of the US and Europe (and Japan), read once a day: { spx: [{ d, c }], … } oldest first. */
  async history() {
    if (!this.configured()) return null;
    const cache = (this.docs && this.docs.read(CACHE, null)) || {};
    const day = istDay(this.now());
    if (cache.history && cache.historyDay === day) return cache.history;
    const from = new Date(this.now() - 400 * 86400000).toISOString().slice(0, 10);
    const out = {};
    for (const id of HISTORY) {
      const m = MARKETS.find((x) => x.id === id);
      try {
        const rows = await this._get(`/historical-price-eod/light?symbol=${encodeURIComponent(m.fmp)}&from=${from}`);
        out[id] = rows
          .map((r) => ({ d: String(r.date || "").slice(0, 10), c: n(r.close ?? r.price) }))
          .filter((r) => r.d && num(r.c))
          .sort((a, b) => (a.d < b.d ? -1 : 1));
      } catch (err) {
        if (err.code === "quota") break;
      }
    }
    if (Object.keys(out).length) this.docs.write(CACHE, { ...((this.docs && this.docs.read(CACHE, null)) || {}), history: out, historyDay: day });
    return Object.keys(out).length ? out : cache.history || null;
  }
}

module.exports = { GlobalFeed, MARKETS, sessionOf, shapeQuote, local };
