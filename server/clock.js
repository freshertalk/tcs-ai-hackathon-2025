"use strict";
// Exchange time for every page (23 Nov 2026): the owner's rule is "no fraction of a gap between this website's time and
// NSE's". NSE runs on Indian Standard Time as kept by NPL (the National Physical Laboratory) — IST is UTC + 5:30 exactly —
// so the question is only how far this server's clock is from true UTC. This module asks time servers over SNTP:
//
//   samay1.nic.in, samay2.nic.in   the Government of India's NIC time servers (traceable to NPL's IST)
//   time.google.com, time.cloudflare.com, pool.ntp.org   public stratum-1/2 servers, for agreement
//
// For each answer: offset = ((t1 − t0) + (t2 − t3)) / 2 and round trip = (t3 − t0) − (t2 − t1), the standard NTP
// arithmetic. Answers with a round trip over 1 s are dropped; the MEDIAN offset of the rest is used (one wrong server
// cannot move it). Re-checked every 15 minutes; the last good offset is kept when every server is silent, and with none
// ever, the system clock is used (a VPS keeps it in step itself) — the status says which. exchangeNow() is the server's
// best idea of true time; GET /api/admin/clock hands it to the pages, which correct their own clocks with it.
//
// Sends 48 bytes of time request to public time servers — no data about anyone.

const dgram = require("node:dgram");
const dns = require("node:dns");

const SERVERS = ["samay1.nic.in", "samay2.nic.in", "time.google.com", "time.cloudflare.com", "pool.ntp.org"];
const NTP_EPOCH = 2208988800; // seconds from 1900 to 1970
const MAX_RTT_MS = 1000;
const EVERY_MS = 15 * 60 * 1000;

/** Read a 64-bit NTP timestamp at `off` as Unix milliseconds. */
function ntpToMs(buf, off) {
  const sec = buf.readUInt32BE(off);
  const frac = buf.readUInt32BE(off + 4);
  return (sec - NTP_EPOCH) * 1000 + (frac * 1000) / 0x100000000;
}

/** Write Unix milliseconds as a 64-bit NTP timestamp at `off`. */
function msToNtp(buf, off, ms) {
  const sec = Math.floor(ms / 1000) + NTP_EPOCH;
  const frac = Math.round(((ms % 1000) / 1000) * 0x100000000) >>> 0;
  buf.writeUInt32BE(sec >>> 0, off);
  buf.writeUInt32BE(frac, off + 4);
}

/**
 * One SNTP question. Resolves { server, offsetMs, rttMs, stratum } or rejects.
 * `now` is the local clock (ms); `socketFactory` lets tests answer without a network.
 */
function sntpQuery(server, opts = {}) {
  // the name is looked up FIRST, so the timed round trip is the network's alone (a lookup inside it skews the offset)
  const lookup = opts.lookup || ((name) => new Promise((res, rej) => dns.lookup(name, { family: 4 }, (err, address) => (err ? rej(err) : res(address)))));
  return Promise.resolve(lookup(server)).then((address) => sntpAsk(server, address, opts));
}

function sntpAsk(server, address, { now = () => Date.now(), timeoutMs = 2500, socketFactory = () => dgram.createSocket("udp4") } = {}) {
  return new Promise((resolve, reject) => {
    const sock = socketFactory();
    const req = Buffer.alloc(48);
    req[0] = 0x23; // LI 0, version 4, mode 3 (client)
    let t0 = 0;
    const done = (err, val) => {
      clearTimeout(timer);
      try {
        sock.close();
      } catch (_) {
        /* already closed */
      }
      if (err) reject(err);
      else resolve(val);
    };
    const timer = setTimeout(() => done(new Error(`${server}: no answer`)), timeoutMs);
    if (timer.unref) timer.unref();
    sock.on("error", (err) => done(err));
    sock.on("message", (msg) => {
      const t3 = now();
      if (!msg || msg.length < 48) return done(new Error(`${server}: short answer`));
      const mode = msg[0] & 0x07;
      const stratum = msg[1];
      if (mode !== 4 || stratum === 0 || stratum > 15) return done(new Error(`${server}: not a usable server answer (mode ${mode}, stratum ${stratum})`));
      const origin = ntpToMs(msg, 24);
      if (Math.abs(origin - t0) > 1) return done(new Error(`${server}: the answer is not to this question`));
      const t1 = ntpToMs(msg, 32); // server received
      const t2 = ntpToMs(msg, 40); // server sent
      const offsetMs = (t1 - t0 + (t2 - t3)) / 2;
      const rttMs = t3 - t0 - (t2 - t1);
      if (!Number.isFinite(offsetMs) || !Number.isFinite(rttMs) || rttMs < 0) return done(new Error(`${server}: unreadable times`));
      done(null, { server, offsetMs, rttMs, stratum });
    });
    t0 = now();
    msToNtp(req, 40, t0); // transmit timestamp: the server echoes it as "origin"
    sock.send(req, 0, 48, 123, address, (err) => {
      if (err) done(err);
    });
  });
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

class ExchangeClock {
  constructor({ servers = SERVERS, now = () => Date.now(), query = sntpQuery, log = console } = {}) {
    this.servers = servers;
    this.now = now;
    this.query = query;
    this.log = log;
    this.offsetMs = 0; // true time − this server's clock
    this.accuracyMs = null; // half the best round trip among the answers used
    this.source = "system"; // "ntp" | "system"
    this.syncedAt = null;
    this.lastError = "";
    this.samples = [];
    this._timer = null;
    this._inflight = null;
  }

  /** The server's best idea of true time (ms since 1970, UTC). Add 5:30 for IST. */
  exchangeNow() {
    return this.now() + this.offsetMs;
  }

  /** Ask every server at once; keep the median of the good answers. */
  sync() {
    if (this._inflight) return this._inflight;
    this._inflight = (async () => {
      const results = await Promise.allSettled(this.servers.map((s) => this.query(s, { now: this.now })));
      const good = results.filter((r) => r.status === "fulfilled" && r.value.rttMs <= MAX_RTT_MS).map((r) => r.value);
      this.samples = results.map((r, i) => (r.status === "fulfilled" ? { server: r.value.server, offsetMs: Math.round(r.value.offsetMs * 10) / 10, rttMs: Math.round(r.value.rttMs), stratum: r.value.stratum } : { server: this.servers[i], error: String((r.reason && r.reason.message) || r.reason).slice(0, 120) }));
      if (good.length) {
        const before = this.offsetMs;
        this.offsetMs = median(good.map((g) => g.offsetMs));
        this.accuracyMs = Math.round(Math.min(...good.map((g) => g.rttMs)) / 2);
        this.source = "ntp";
        this.syncedAt = new Date(this.exchangeNow()).toISOString();
        this.lastError = "";
        if (Math.abs(this.offsetMs - before) > 250) this.log.log(`[clock] this server's clock is ${Math.round(this.offsetMs)} ms from true time (${good.length} time servers agree); pages are corrected by it`);
      } else {
        this.lastError = "no time server answered";
        if (!this.syncedAt) this.source = "system";
      }
      return this.status();
    })().finally(() => {
      this._inflight = null;
    });
    return this._inflight;
  }

  status() {
    return {
      now: this.exchangeNow(),
      offsetMs: Math.round(this.offsetMs * 10) / 10,
      accuracyMs: this.accuracyMs,
      source: this.source,
      syncedAt: this.syncedAt,
      lastError: this.lastError,
      samples: this.samples,
      zone: "Asia/Kolkata (IST, UTC+05:30) — NSE's time",
    };
  }

  start(everyMs = EVERY_MS) {
    this.sync().catch(() => {});
    this._timer = setInterval(() => this.sync().catch(() => {}), everyMs);
    if (this._timer.unref) this._timer.unref();
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }
}

module.exports = { ExchangeClock, sntpQuery, ntpToMs, msToNtp, median, SERVERS };
