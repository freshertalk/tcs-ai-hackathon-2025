"use strict";
// Live ticks from Zerodha's streaming WebSocket (the "KiteTicker" protocol).
//
// Market data only. This client subscribes to instruments and reads prices; the
// only things it ever sends are subscribe / unsubscribe / mode requests, and it
// ignores every text frame the server sends. It reconnects by itself, notices a
// silent connection, and stops trying when Zerodha refuses the session.
//
// Wire format (https://kite.trade/docs/connect/v3/websocket/):
//   message = int16 packet count, then for each packet: int16 length + bytes
//   tradable packet: 8 bytes (ltp), 44 (quote) or 184 (full, with 5+5 depth levels)
//   index packet:    28 bytes (quote) or 32 (full)
//   prices are integers in paise (÷100), currency segments use more decimals

const { EventEmitter } = require("events");

const ENDPOINT = "wss://ws.kite.trade";
const SEG_CDS = 3;
const SEG_BCD = 6;
const SEG_INDEX = 9;

const divisorFor = (token) => {
  const seg = token & 0xff;
  return seg === SEG_CDS ? 10000000 : seg === SEG_BCD ? 10000 : 100;
};

function parsePacket(p) {
  if (p.length < 8) return null;
  const token = p.readUInt32BE(0);
  const div = divisorFor(token);
  const px = (o) => p.readInt32BE(o) / div;
  if (p.length === 8) return { token, last: px(4) };

  if ((token & 0xff) === SEG_INDEX) {
    if (p.length < 28) return null;
    const t = { token, index: true, last: px(4), high: px(8), low: px(12), open: px(16), prevClose: px(20) };
    if (p.length >= 32) t.exchangeTime = p.readInt32BE(28) * 1000;
    return t;
  }

  if (p.length < 44) return null;
  const t = {
    token,
    last: px(4),
    lastQty: p.readInt32BE(8),
    avgPrice: px(12),
    volume: p.readInt32BE(16),
    buyQty: p.readInt32BE(20),
    sellQty: p.readInt32BE(24),
    open: px(28),
    high: px(32),
    low: px(36),
    prevClose: px(40),
  };
  if (p.length >= 64) {
    t.lastTradeTime = p.readInt32BE(44) * 1000;
    t.exchangeTime = p.readInt32BE(60) * 1000;
  }
  if (p.length >= 184) {
    // market depth: five bids from byte 64, five offers from byte 124. Each level is 12 bytes:
    // quantity, price, a 2-byte count of the resting orders at that price, and 2 bytes of padding.
    const side = (from) => {
      const rows = [];
      for (let k = 0; k < 5; k += 1) {
        const o = from + k * 12;
        const price = px(o + 4);
        if (price > 0) rows.push([price, p.readInt32BE(o), p.readUInt16BE(o + 8)]);
      }
      return rows;
    };
    const bids = side(64);
    const asks = side(124);
    if (bids.length) {
      t.bid = bids[0][0];
      t.bidQty = bids[0][1];
    }
    if (asks.length) {
      t.ask = asks[0][0];
      t.askQty = asks[0][1];
    }
    // depth as [price, quantity, count] rows, best first
    if (bids.length || asks.length) t.depth = { b: bids, a: asks };
  }
  return t;
}

/** One binary WebSocket message → the ticks inside it. Heartbeats (1 byte) and junk give []. */
function parseTicks(buf) {
  const out = [];
  if (!Buffer.isBuffer(buf) || buf.length < 4) return out;
  const count = buf.readInt16BE(0);
  let off = 2;
  for (let i = 0; i < count && off + 2 <= buf.length; i += 1) {
    const len = buf.readInt16BE(off);
    off += 2;
    if (len <= 0 || off + len > buf.length) break;
    const t = parsePacket(buf.subarray(off, off + len));
    if (t) out.push(t);
    off += len;
  }
  return out;
}

/** The inverse of parseTicks — builds a message from ticks. Used by the tests and by simulators. */
function encodeTicks(ticks) {
  const parts = [];
  for (const t of ticks) {
    const div = divisorFor(t.token);
    const i = (x) => Math.round((x || 0) * div);
    let p;
    if ((t.token & 0xff) === SEG_INDEX) {
      p = Buffer.alloc(32);
      p.writeUInt32BE(t.token, 0);
      [t.last, t.high, t.low, t.open, t.prevClose].forEach((v, k) => p.writeInt32BE(i(v), 4 + k * 4));
      p.writeInt32BE(i(t.last - (t.prevClose || 0)), 24);
      p.writeInt32BE(Math.floor((t.exchangeTime || 0) / 1000), 28);
    } else {
      p = Buffer.alloc(184);
      p.writeUInt32BE(t.token, 0);
      p.writeInt32BE(i(t.last), 4);
      p.writeInt32BE(t.lastQty || 0, 8);
      p.writeInt32BE(i(t.avgPrice), 12);
      p.writeInt32BE(t.volume || 0, 16);
      p.writeInt32BE(t.buyQty || 0, 20);
      p.writeInt32BE(t.sellQty || 0, 24);
      [t.open, t.high, t.low, t.prevClose].forEach((v, k) => p.writeInt32BE(i(v), 28 + k * 4));
      p.writeInt32BE(Math.floor((t.lastTradeTime || 0) / 1000), 44);
      p.writeInt32BE(Math.floor((t.exchangeTime || 0) / 1000), 60);
      const levels = (rows, from) =>
        rows.slice(0, 5).forEach(([price, qty, count], k) => {
          p.writeInt32BE(qty || 0, from + k * 12);
          p.writeInt32BE(i(price), from + k * 12 + 4);
          p.writeUInt16BE(count || 0, from + k * 12 + 8);
        });
      levels(t.depth ? t.depth.b : t.bid ? [[t.bid, t.bidQty, 0]] : [], 64);
      levels(t.depth ? t.depth.a : t.ask ? [[t.ask, t.askQty, 0]] : [], 124);
    }
    const len = Buffer.alloc(2);
    len.writeInt16BE(p.length, 0);
    parts.push(len, p);
  }
  const head = Buffer.alloc(2);
  head.writeInt16BE(ticks.length, 0);
  return Buffer.concat([head, ...parts]);
}

/**
 * States:  off (no session) · idle (session, nobody listening) · connecting · live ·
 *          down (lost, retrying) · denied (Zerodha refused the session — no retry until it changes)
 * Events:  "tick" (the latest merged tick for a token), "state" ({ state, reason })
 */
class KiteTicker extends EventEmitter {
  constructor({ WebSocketImpl, now = () => Date.now(), retryMs = 1000, maxRetryMs = 30000, idleMs = 30000, staleMs = 15000 } = {}) {
    super();
    this.setMaxListeners(500);
    this.WS = WebSocketImpl || require("ws");
    this.now = now;
    this.retryMs = retryMs;
    this.maxRetryMs = maxRetryMs;
    this.idleMs = idleMs;
    this.staleMs = staleMs;
    this.creds = null;
    this.ws = null;
    this.state = "off";
    this.reason = "";
    this.denied = false;
    this.attempt = 0;
    this.lastMessageAt = 0;
    this.refs = new Map(); // token → how many listeners want it
    this.ticks = new Map(); // token → latest merged tick
    this.trail = new Map(); // token → [[ms, price], …]: about one point a second, a few minutes deep
  }

  /** Give (or take away) the session. A changed session drops the socket and starts again. */
  setCredentials(apiKey, accessToken) {
    const next = apiKey && accessToken ? { apiKey, accessToken } : null;
    const same = (a, b) => (!a && !b) || (a && b && a.apiKey === b.apiKey && a.accessToken === b.accessToken);
    if (same(this.creds, next)) return;
    this.creds = next;
    this.denied = false;
    this.attempt = 0;
    this._drop();
    if (next && this.refs.size) this._connect();
    else this._set(next ? "idle" : "off");
  }

  subscribe(tokens) {
    const fresh = [];
    for (const t of tokens) {
      const n = this.refs.get(t) || 0;
      this.refs.set(t, n + 1);
      if (!n) fresh.push(t);
    }
    clearTimeout(this._idleTimer);
    if (!this.creds || this.denied) return;
    if (!this.ws && !this._retryTimer) this._connect();
    else if (this.state === "live") this._ask(fresh);
  }

  unsubscribe(tokens) {
    const gone = [];
    for (const t of tokens) {
      const n = (this.refs.get(t) || 0) - 1;
      if (n <= 0) {
        if (this.refs.delete(t)) gone.push(t);
      } else this.refs.set(t, n);
    }
    gone.forEach((t) => {
      this.ticks.delete(t);
      this.trail.delete(t);
    });
    if (gone.length && this.state === "live") this._write({ a: "unsubscribe", v: gone });
    if (this.refs.size === 0) {
      // nobody is watching: hang up after a short grace period
      clearTimeout(this._idleTimer);
      this._idleTimer = setTimeout(() => {
        if (this.refs.size) return;
        this._drop();
        this._set(this.creds ? "idle" : "off");
      }, this.idleMs);
      if (this._idleTimer.unref) this._idleTimer.unref();
    }
  }

  isLive() {
    return this.state === "live";
  }

  /** The latest tick for a token — only while the stream is live, so a stale price is never served as current. */
  get(token) {
    return this.state === "live" ? this.ticks.get(token) || null : null;
  }

  /** Recent prices for a token, oldest first — only while the stream is live. */
  recent(token) {
    return this.state === "live" ? this.trail.get(token) || [] : [];
  }

  close() {
    this.creds = null;
    clearTimeout(this._idleTimer);
    this._drop();
    this._set("off");
  }

  _set(state, reason = "") {
    if (this.state === state && this.reason === reason) return;
    this.state = state;
    this.reason = reason;
    this.emit("state", { state, reason });
  }

  _write(obj) {
    try {
      this.ws.send(JSON.stringify(obj));
    } catch (_) {
      /* the socket is going away; the reconnect will resubscribe */
    }
  }

  _ask(tokens) {
    if (!tokens.length) return;
    this._write({ a: "subscribe", v: tokens });
    this._write({ a: "mode", v: ["full", tokens] });
  }

  _drop() {
    clearTimeout(this._retryTimer);
    this._retryTimer = null;
    clearInterval(this._watchTimer);
    const ws = this.ws;
    this.ws = null;
    this.ticks.clear();
    this.trail.clear();
    if (ws) {
      try {
        ws.terminate();
      } catch (_) {
        /* already closed */
      }
    }
  }

  _retry(reason) {
    this._drop();
    this._set("down", reason);
    const wait = Math.min(this.maxRetryMs, this.retryMs * 2 ** this.attempt);
    this.attempt += 1;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      if (this.creds && this.refs.size && !this.denied) this._connect();
    }, wait);
    if (this._retryTimer.unref) this._retryTimer.unref();
  }

  _connect() {
    if (this.ws || !this.creds) return;
    this._set("connecting");
    let ws;
    try {
      // the session travels in the query string because that is Zerodha's protocol; this URL is never logged
      ws = new this.WS(`${ENDPOINT}?api_key=${encodeURIComponent(this.creds.apiKey)}&access_token=${encodeURIComponent(this.creds.accessToken)}`);
    } catch (err) {
      this._retry("could not open the connection");
      return;
    }
    this.ws = ws;

    ws.on("open", () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this.lastMessageAt = this.now();
      this._set("live");
      this._ask([...this.refs.keys()]);
      // a connection that goes quiet (no ticks and no heartbeat) is dead even if it never closes
      this._watchTimer = setInterval(() => {
        if (this.ws === ws && this.now() - this.lastMessageAt > this.staleMs) this._retry("no data from Zerodha — reconnecting");
      }, Math.max(50, Math.min(5000, this.staleMs / 3)));
      if (this._watchTimer.unref) this._watchTimer.unref();
    });

    ws.on("message", (data, isBinary) => {
      if (this.ws !== ws) return;
      this.lastMessageAt = this.now();
      if (isBinary === false || !Buffer.isBuffer(data)) return; // text frames are not market data: ignored
      for (const t of parseTicks(data)) {
        if (!this.refs.has(t.token)) continue;
        const merged = { ...(this.ticks.get(t.token) || {}), ...t, at: this.lastMessageAt };
        this.ticks.set(t.token, merged);
        // a short trail of recent prices, for reading how fast the tape is moving
        let tr = this.trail.get(t.token);
        if (!tr) this.trail.set(t.token, (tr = []));
        if (!tr.length || merged.at - tr[tr.length - 1][0] >= 1000) {
          tr.push([merged.at, merged.last]);
          if (tr.length > 360) tr.shift();
        } else tr[tr.length - 1][1] = merged.last;
        this.emit("tick", merged);
      }
    });

    ws.on("unexpected-response", (req, res) => {
      if (this.ws !== ws) return;
      const code = res && res.statusCode;
      if (code === 401 || code === 403) {
        this.denied = true;
        this._drop();
        this._set("denied", "Zerodha refused the live stream — the Kite session has expired or was closed. Log in to Kite again.");
      } else this._retry(`Zerodha answered HTTP ${code}`);
    });

    // an "error" is always followed by "close"; without a listener it would crash the process
    ws.on("error", () => {});

    ws.on("close", () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.creds && this.refs.size && !this.denied) this._retry("the connection closed");
      else this._set(this.creds ? (this.denied ? "denied" : "idle") : "off", this.reason);
    });
  }
}

module.exports = { KiteTicker, parseTicks, encodeTicks, parsePacket };
