"use strict";
// Zerodha Kite Connect v3 — READ-ONLY client.
//
// This file can log in, read quotes, read historical candles and read the
// instrument list. It deliberately contains NO order, GTT, margin or funds calls:
// the Analyzer looks at the market, it never trades.
//
// Docs: https://kite.trade/docs/connect/v3/
//   login      https://kite.zerodha.com/connect/login?v=3&api_key=…
//   session    POST /session/token  (checksum = SHA-256(api_key + request_token + api_secret))
//   auth       Authorization: token api_key:access_token   (expires 6 AM IST next day)
//   limits     quote 1 req/s · historical 3 req/s · everything else 10 req/s

const crypto = require("crypto");

const API = "https://api.kite.trade";
const LOGIN = "https://kite.zerodha.com/connect/login";

class KiteError extends Error {
  constructor(message, { type = "GeneralException", status = 0 } = {}) {
    super(message);
    this.name = "KiteError";
    this.type = type;
    this.status = status;
    // the daily token has expired or was invalidated → the user must log in again
    this.tokenExpired = type === "TokenException" || status === 403;
  }
}

/** Runs tasks one at a time, at least `gapMs` apart — the API's per-second limits. */
class Throttle {
  constructor(gapMs) {
    this.gapMs = gapMs;
    this.last = 0;
    this.chain = Promise.resolve();
  }

  run(fn) {
    const next = this.chain.then(async () => {
      const wait = this.last + this.gapMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
      return fn();
    });
    this.chain = next.catch(() => {});
    return next;
  }
}

function loginUrl(apiKey, state) {
  const q = new URLSearchParams({ v: "3", api_key: apiKey });
  // redirect_params is handed back, untouched, on the redirect — used as a CSRF state
  if (state) q.set("redirect_params", `state=${state}`);
  return `${LOGIN}?${q}`;
}

async function parse(res) {
  let body = null;
  try {
    body = await res.json();
  } catch (_) {
    /* not JSON */
  }
  if (!res.ok || !body || body.status !== "success") {
    throw new KiteError((body && body.message) || `Kite answered HTTP ${res.status}`, {
      type: body && body.error_type,
      status: res.status,
    });
  }
  return body.data;
}

/** Swap the one-time request_token for the day's access_token. */
async function exchangeToken({ apiKey, apiSecret, requestToken, fetchImpl = globalThis.fetch }) {
  const checksum = crypto.createHash("sha256").update(apiKey + requestToken + apiSecret).digest("hex");
  const res = await fetchImpl(`${API}/session/token`, {
    method: "POST",
    headers: { "X-Kite-Version": "3", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ api_key: apiKey, request_token: requestToken, checksum }).toString(),
    signal: AbortSignal.timeout(15000),
  });
  const d = await parse(res);
  if (!d || !d.access_token) throw new KiteError("Kite did not return an access token");
  return { accessToken: d.access_token, userId: d.user_id || "", userName: d.user_name || d.user_shortname || "" };
}

/** Minimal CSV reader (handles quoted fields with commas). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cur);
      cur = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

const stamp = (d) => {
  // "yyyy-mm-dd hh:mm:ss" in IST, which is what the API expects
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString();
  return `${ist.slice(0, 10)} ${ist.slice(11, 19)}`;
};

class KiteClient {
  constructor({ apiKey, accessToken, fetchImpl = globalThis.fetch, gaps = { quote: 1050, historical: 350, other: 110 } }) {
    this.apiKey = apiKey;
    this.accessToken = accessToken;
    this.fetch = fetchImpl;
    this.throttles = {
      quote: new Throttle(gaps.quote),
      historical: new Throttle(gaps.historical),
      other: new Throttle(gaps.other),
    };
  }

  _headers() {
    return { "X-Kite-Version": "3", Authorization: `token ${this.apiKey}:${this.accessToken}` };
  }

  _get(bucket, path, { timeout = 15000 } = {}) {
    return this.throttles[bucket].run(() =>
      this.fetch(`${API}${path}`, { headers: this._headers(), signal: AbortSignal.timeout(timeout) })
    );
  }

  /**
   * Full quotes for up to 500 instruments ("NSE:INFY").
   * Returns { "INFY": { last, prevClose, change, changePct, open, high, low, volume, … } }.
   */
  async quotes(keys) {
    if (!keys.length) return {};
    const q = keys.slice(0, 500).map((k) => `i=${encodeURIComponent(k)}`).join("&");
    const data = await parse(await this._get("quote", `/quote?${q}`));
    const out = {};
    for (const [key, v] of Object.entries(data || {})) {
      const prev = v.ohlc ? v.ohlc.close : null;
      const last = v.last_price;
      out[key] = {
        last,
        prevClose: prev,
        change: prev ? last - prev : null,
        changePct: prev ? ((last - prev) / prev) * 100 : null,
        open: v.ohlc ? v.ohlc.open : null,
        high: v.ohlc ? v.ohlc.high : null,
        low: v.ohlc ? v.ohlc.low : null,
        volume: v.volume ?? null,
        avgPrice: v.average_price ?? null,
        buyQty: v.buy_quantity ?? null,
        sellQty: v.sell_quantity ?? null,
        upperCircuit: v.upper_circuit_limit ?? null,
        lowerCircuit: v.lower_circuit_limit ?? null,
        time: v.last_trade_time || v.timestamp || null,
      };
    }
    return out;
  }

  /**
   * Historical candles. `interval`: "day", "5minute", …
   * Daily bars are keyed by date ("YYYY-MM-DD"); intraday bars keep the full timestamp.
   */
  async historical(token, interval, from, to) {
    const q = new URLSearchParams({ from: stamp(from), to: stamp(to) });
    const data = await parse(await this._get("historical", `/instruments/historical/${encodeURIComponent(token)}/${interval}?${q}`, { timeout: 25000 }));
    const rows = (data && data.candles) || [];
    return rows
      .filter((r) => Array.isArray(r) && r.length >= 6 && r.slice(1, 5).every((x) => Number.isFinite(x) && x > 0))
      .map((r) => ({
        t: interval === "day" ? String(r[0]).slice(0, 10) : String(r[0]),
        o: r[1],
        h: r[2],
        l: r[3],
        c: r[4],
        v: Number.isFinite(r[5]) ? r[5] : 0,
      }));
  }

  /** The exchange's instrument list (a large CSV), reduced to what the Analyzer needs. */
  async instruments(exchange = "NSE") {
    const res = await this._get("other", `/instruments/${exchange}`, { timeout: 40000 });
    if (!res.ok) throw new KiteError(`Kite answered HTTP ${res.status} for the instrument list`, { status: res.status });
    const rows = parseCsv(await res.text());
    const head = rows.shift() || [];
    const col = (name) => head.indexOf(name);
    const c = {
      token: col("instrument_token"),
      symbol: col("tradingsymbol"),
      name: col("name"),
      type: col("instrument_type"),
      segment: col("segment"),
      exchange: col("exchange"),
    };
    if (c.token < 0 || c.symbol < 0) throw new KiteError("The instrument list has an unexpected format");
    const out = [];
    for (const r of rows) {
      if (r[c.exchange] !== exchange) continue;
      const isIndex = r[c.segment] === "INDICES";
      if (!isIndex && r[c.type] !== "EQ") continue;
      out.push({ s: r[c.symbol], n: r[c.name] || "", t: Number(r[c.token]), k: isIndex ? "INDEX" : "EQ" });
    }
    return out;
  }
}

module.exports = { KiteClient, KiteError, Throttle, loginUrl, exchangeToken, parseCsv, API };
