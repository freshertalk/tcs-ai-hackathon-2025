"use strict";
// The memory governor: caches dropped when memory is tight, heavy work held back, a clean restart outside market hours when it
// stays critical — never during the session.

const test = require("node:test");
const assert = require("node:assert/strict");
const { MemoryGovernor } = require("../memory");

const MB = 1048576;
const quiet = { log() {}, warn() {}, error() {} };

test("normal: nothing happens; tight: every cache is dropped (at most every two minutes) and heavy jobs wait", () => {
  let t = 0;
  let use = { heapUsed: 300 * MB, rss: 400 * MB };
  const g = new MemoryGovernor({ rssLimitMB: 1000, heapLimitMB: 800, read: () => use, now: () => t, log: quiet });
  let a = 0;
  let b = 0;
  g.register("a", () => (a += 1)).register("b", () => {
    b += 1;
    throw new Error("cannot");
  });
  assert.equal(g.check(), "normal");
  assert.equal(g.pressure(), false);
  assert.equal(a, 0);
  use = { heapUsed: 600 * MB, rss: 500 * MB }; // 75% of the heap
  assert.equal(g.check(), "tight");
  assert.equal(g.pressure(), true);
  assert.equal(a, 1, "dropped");
  assert.equal(b, 1, "a cache that throws does not stop the rest");
  t += 30000;
  g.check();
  assert.equal(a, 1, "not again within two minutes");
  t += 2 * 60000;
  g.check();
  assert.equal(a, 2);
  use = { heapUsed: 300 * MB, rss: 400 * MB };
  assert.equal(g.check(), "normal");
  const s = g.status();
  assert.deepEqual(s.caches, ["a", "b"]);
  assert.ok(s.events.some((e) => e.kind === "level" && /tight → normal/.test(e.text)));
});

test("critical twice in a row: a clean restart outside market hours — but never while the market is open", () => {
  let session = true;
  let restarts = 0;
  const use = { heapUsed: 100 * MB, rss: 950 * MB }; // 95% of pm2's limit
  const g = new MemoryGovernor({ rssLimitMB: 1000, heapLimitMB: 800, read: () => use, inSession: () => session, restart: () => (restarts += 1), now: () => 0, log: quiet });
  assert.equal(g.check(), "critical");
  g.check();
  g.check();
  assert.equal(restarts, 0, "the market is open: no restart");
  assert.ok(g.status().events.some((e) => e.kind === "hold"));
  session = false;
  g.check();
  assert.equal(restarts, 1, "after the close it restarts itself cleanly");
  g.check();
  assert.equal(restarts, 1, "once");
  assert.ok(g.status().events.some((e) => e.kind === "restart"));
});

test("the train guard waits while memory is tight (a hand-started training still runs)", () => {
  const { TrainGuard } = require("../train-guard");
  const docs = { read: () => null, write: () => {} };
  const tg = new TrainGuard({ docs, now: () => 10 * 60 * 60000, log: quiet });
  tg.startedAt = 0;
  tg.memory = { pressure: () => true };
  assert.match(tg.wait("horizon-train", "itself"), /memory is tight/);
  assert.equal(tg.wait("horizon-train", "you asked"), "");
  tg.memory = { pressure: () => false };
  assert.equal(tg.wait("horizon-train", "itself"), "");
});
