"use strict";
// Exchange time (23 Nov 2026): SNTP arithmetic, the median of several time servers, and keeping the last good offset.
// No network: the UDP socket is faked.

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { ExchangeClock, sntpQuery, ntpToMs, msToNtp, median } = require("../clock");

/** A pretend time server whose clock is `ahead` ms ahead of ours, answering after `oneWay` ms each way. */
function fakeServer({ ahead = 0, oneWay = 20, stratum = 1, now }) {
  return () => {
    const sock = new EventEmitter();
    sock.close = () => {};
    sock.send = (buf, _o, _l, _port, _addr, cb) => {
      cb && cb(null);
      const t0 = ntpToMs(buf, 40);
      const reply = Buffer.alloc(48);
      reply[0] = 0x24; // version 4, mode 4 (server)
      reply[1] = stratum;
      msToNtp(reply, 24, t0); // origin = our transmit
      const t1 = t0 + oneWay + ahead;
      msToNtp(reply, 32, t1);
      msToNtp(reply, 40, t1 + 1);
      now.advance(oneWay * 2 + 1);
      setImmediate(() => sock.emit("message", reply));
    };
    return sock;
  };
}
const clockAt = (start) => {
  let t = start;
  const f = () => t;
  f.advance = (ms) => (t += ms);
  return f;
};

test("NTP timestamps round-trip", () => {
  const b = Buffer.alloc(8);
  msToNtp(b, 0, 1795444000123.5);
  assert.ok(Math.abs(ntpToMs(b, 0) - 1795444000123.5) < 0.01);
});

test("one SNTP question: the offset and the round trip, with the lookup outside the timing", async () => {
  const now = clockAt(1795444000000);
  const r = await sntpQuery("samay1.nic.in", { now, lookup: async () => "203.0.113.1", socketFactory: fakeServer({ ahead: 92, oneWay: 30, now }) });
  assert.equal(r.server, "samay1.nic.in");
  assert.ok(Math.abs(r.offsetMs - 92) < 1, `offset ${r.offsetMs}`);
  assert.ok(Math.abs(r.rttMs - 60) < 1.5, `rtt ${r.rttMs}`);
});

test("refuses an answer that is not to this question or not from a server", async () => {
  const now = clockAt(1795444000000);
  const bad = () => {
    const sock = new EventEmitter();
    sock.close = () => {};
    sock.send = (buf, _o, _l, _p, _a, cb) => {
      cb && cb(null);
      const reply = Buffer.alloc(48);
      reply[0] = 0x24;
      reply[1] = 0; // stratum 0: a "kiss of death", not a time
      setImmediate(() => sock.emit("message", reply));
    };
    return sock;
  };
  await assert.rejects(sntpQuery("x", { now, lookup: async () => "203.0.113.2", socketFactory: bad }), /not a usable server answer/);
});

test("the median of the servers is used: one wrong server cannot move the clock", async () => {
  assert.equal(median([90, 92, 95, 5000, 91]), 92);
  const offsets = { a: 90, b: 92, c: 95, d: 5000, e: 91 };
  const c = new ExchangeClock({ servers: Object.keys(offsets), log: { log() {} }, now: () => 1795444000000, query: async (s) => ({ server: s, offsetMs: offsets[s], rttMs: 40, stratum: 2 }) });
  const st = await c.sync();
  assert.equal(st.offsetMs, 92);
  assert.equal(st.source, "ntp");
  assert.equal(st.accuracyMs, 20);
  assert.equal(c.exchangeNow(), 1795444000092);
});

test("when every server is silent the last good offset stays; with none ever, the system clock is used", async () => {
  let up = true;
  const c = new ExchangeClock({ servers: ["a", "b"], log: { log() {} }, now: () => 1795444000000, query: async (s) => (up ? { server: s, offsetMs: 120, rttMs: 30, stratum: 1 } : Promise.reject(new Error("timeout"))) });
  await c.sync();
  up = false;
  const st = await c.sync();
  assert.equal(st.offsetMs, 120, "last good offset kept");
  assert.equal(st.source, "ntp");
  assert.match(st.lastError, /no time server answered/);
  const fresh = new ExchangeClock({ servers: ["a"], log: { log() {} }, query: async () => Promise.reject(new Error("timeout")) });
  const st2 = await fresh.sync();
  assert.equal(st2.source, "system");
  assert.equal(st2.offsetMs, 0);
});

test("answers with a round trip over a second are not trusted", async () => {
  const c = new ExchangeClock({ servers: ["slow", "ok"], log: { log() {} }, now: () => 0, query: async (s) => ({ server: s, offsetMs: s === "slow" ? 900 : 50, rttMs: s === "slow" ? 1800 : 40, stratum: 2 }) });
  assert.equal((await c.sync()).offsetMs, 50);
});
