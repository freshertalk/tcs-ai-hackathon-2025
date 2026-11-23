"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { deadline, guardedTick } = require("../heal");
const quiet = { log() {}, error() {} };

test("a job past its deadline is let go; one inside it gives its answer", async (t) => {
  const hold = setInterval(() => {}, 1000); // the deadline's clock does not keep the process alive: this test does
  t.after(() => clearInterval(hold));
  assert.equal(await deadline(Promise.resolve(7), 50), 7);
  await assert.rejects(deadline(new Promise(() => {}), 20, "the NSE read"), /the NSE read took longer than 0 s/);
  await assert.rejects(deadline(Promise.reject(new Error("boom")), 50), /boom/);
});

test("a tick that hangs does not stop the service: the next round starts afresh, and it is counted", async (t0) => {
  const hold = setInterval(() => {}, 1000);
  t0.after(() => clearInterval(hold));
  let t = 0;
  let calls = 0;
  let hang = true;
  const g = guardedTick("setup", () => {
    calls += 1;
    return hang ? new Promise(() => {}) : Promise.resolve("ok");
  }, { ms: 1000, log: quiet, now: () => t });
  g.tick();
  g.tick();
  await Promise.resolve();
  assert.equal(calls, 1, "one at a time");
  t += 2000; // past the deadline on the service's clock
  hang = false;
  await g.tick();
  assert.equal(calls, 2, "the stuck run was let go and a new one ran");
  assert.equal(g.status().abandoned, 1);
  assert.equal(g.status().busy, false);
  // an error is caught and kept, never thrown at the timer
  const h = guardedTick("x", () => {
    throw new Error("nope");
  }, { log: quiet });
  await h.tick();
  assert.equal(h.status().lastError, "nope");
});

test("the Zerodha queue is bounded: too many waiting are refused at once, and one that waited too long is not sent late", async () => {
  const { Throttle } = require("../market/kite");
  const th = new Throttle(0, { maxQueue: 2, maxWaitMs: 40 });
  let release;
  const slow = th.run(() => new Promise((r) => (release = r)));
  const second = th.run(async () => "sent");
  await assert.rejects(th.run(async () => "x"), (e) => e.code === "busy", "the third is refused at once");
  await new Promise((r) => setTimeout(r, 60));
  release("first");
  assert.equal(await slow, "first");
  await assert.rejects(second, /waited too long/, "it waited past its limit, so it is not sent late");
  assert.equal(await th.run(async () => "fresh"), "fresh", "the queue carries on");
  assert.equal(th.refused, 2);
});

test("a price-tick listener that throws is logged and skipped: the others still get the tick, and the process does not die", () => {
  const { KiteTicker } = require("../market/ticker");
  const t = new KiteTicker({ WebSocketImpl: class {} });
  const got = [];
  const errors = [];
  const keep = console.error;
  console.error = (m) => errors.push(m);
  try {
    t.on("tick", () => {
      throw new Error("a bug in one listener");
    });
    t.on("tick", (x) => got.push(x.last));
    t._safeEmit("tick", { last: 101 });
    t._safeEmit("tick", { last: 102 });
  } finally {
    console.error = keep;
  }
  assert.deepEqual(got, [101, 102]);
  assert.equal(t.listenerErrors, 2);
  assert.equal(errors.length, 1, "logged at most once a minute");
  assert.match(errors[0], /a bug in one listener/);
});
