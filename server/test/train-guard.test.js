"use strict";
// The restart loop of 21 Nov 2026 cannot come back: automatic training waits after a start, a run the server did not live
// through is paused (30 min, 1 h, 2 h … a day) instead of started again at once, the supervisor notices a duty that died
// with the server, and the health check says when pm2 restarted the server for memory.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TrainGuard, NAME } = require("../train-guard");
const { Supervisor } = require("../supervisor");
const { FileDocs } = require("../docs");
const { Horizon } = require("../horizon");
const lifecycle = require("../lifecycle");
const { buildHealth } = require("../health");

const quiet = { log() {}, error() {} };
const MIN = 60000;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "vpt-guard-"));
const T0 = Date.parse("2026-11-21T04:00:00Z"); // a Saturday: quiet all day

test("right after a start automatic training waits; the owner's own click never does", () => {
  const docs = new FileDocs(tmp());
  let now = T0;
  const g = new TrainGuard({ docs, now: () => now, log: quiet });
  assert.match(g.wait("horizon-train", "itself"), /started 0 s ago.*waits 5 minutes/);
  assert.match(g.wait("horizon-train", "the supervisor"), /waits 5 minutes/);
  assert.equal(g.wait("horizon-train", "you asked"), "", "a click is never refused");
  now = T0 + 4 * MIN + 59000;
  assert.notEqual(g.wait("horizon-train", "itself"), "");
  now = T0 + 5 * MIN;
  assert.equal(g.wait("horizon-train", "itself"), "", "after five minutes, with nothing on record, it may run");
});

test("a run the server did not live through is paused 30 min, then 1 h, 2 h … — across restarts — and a finished run clears it", () => {
  const dir = tmp();
  let now = T0 + 10 * MIN;
  const start = (at) => new TrainGuard({ docs: new FileDocs(dir), now: () => now, startedAt: at, log: quiet });

  // process 1 begins a training and is killed during it (no end)
  let g = start(T0);
  assert.equal(g.wait("horizon-train", "itself"), "");
  g.begin("horizon-train", "itself");
  assert.equal(g.wait("horizon-train", "itself"), "", "while it runs in this very process it is not taken for dead");
  assert.equal(g.record("horizon-train").died, 0);

  // process 2, started a minute later, past its own grace
  now += 6 * MIN;
  g = start(now - 5 * MIN);
  assert.match(g.wait("horizon-train", "itself"), /never finished.*not tried again before 2026-11-21T04:40:00\.000Z/);
  assert.match(g.wait("horizon-train", "the supervisor"), /never finished/);
  assert.equal(g.wait("horizon-train", "you asked"), "", "the owner may still start it by hand");
  assert.deepEqual(g.troubles().map((t) => [t.id, t.died, t.waiting]), [["horizon-train", 1, true]]);
  assert.equal(g.wait("ahead-train", "itself"), "", "other jobs are not held up");

  // 30 minutes after that run began, it may try again — and dies again
  now = T0 + 40 * MIN;
  assert.equal(g.wait("horizon-train", "itself"), "");
  g.begin("horizon-train", "itself");
  assert.equal(g.record("horizon-train").died, 1, "a second run in a row that never ended");

  // process 3: the pause is now an hour from the second run's start
  now = T0 + 70 * MIN;
  g = start(now - 10 * MIN);
  assert.match(g.wait("horizon-train", "itself"), /not tried again before 2026-11-21T05:40:00\.000Z/);
  now = T0 + 100 * MIN;
  assert.equal(g.wait("horizon-train", "itself"), "", "an hour after it began");

  // this time it finishes: the streak is cleared
  g.begin("horizon-train", "itself");
  assert.equal(g.record("horizon-train").died, 2);
  g.end("horizon-train", { ok: true });
  assert.equal(g.record("horizon-train").died, 0);
  g = start(now - 10 * MIN);
  assert.equal(g.wait("horizon-train", "itself"), "");
  assert.deepEqual(g.troubles(), []);
  assert.ok(new FileDocs(dir).read(NAME, null)["horizon-train"].endedAt, "kept in the record store");
});

test("the pause doubles and stops at a day", () => {
  const g = new TrainGuard({ docs: null, log: quiet });
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map((n) => g.pauseAfter(n) / MIN), [30, 60, 120, 240, 480, 960, 1440, 1440]);
});

test("track() records the end of a run whether it succeeds or fails", async () => {
  const docs = new FileDocs(tmp());
  const g = new TrainGuard({ docs, now: () => T0 + 10 * MIN, startedAt: T0, log: quiet });
  assert.equal(await g.track("evidence-learn", "itself", Promise.resolve(7)), 7);
  assert.equal(g.record("evidence-learn").ok, true);
  await assert.rejects(g.track("evidence-train", "itself", Promise.reject(new Error("short history"))), /short history/);
  const r = g.record("evidence-train");
  assert.equal(r.ok, false);
  assert.equal(r.error, "short history");
  assert.ok(r.endedAt, "an error still ended: the process lived through it");
  assert.equal(g.wait("evidence-train", "itself"), "");
});

test("the forecaster with a guard: no automatic training in the first minutes, the supervisor's request waits, a click goes through", async () => {
  const docs = new FileDocs(tmp());
  let now = T0;
  const guard = new TrainGuard({ docs, now: () => now, log: quiet });
  let trained = 0;
  const history = { record: () => ({ z: "" }), bars: () => [], status: () => ({ stocks: 100, sessions: 250 }), needs: () => [] };
  const hz = new Horizon({ market: { mode: () => "kite" }, docs, history: () => history, universe: () => ["A"], guard, now: () => now, log: quiet });
  hz._train = async () => {
    trained += 1;
    return { rows: 1 };
  };
  await hz.tickOnce();
  assert.equal(trained, 0, "30 s after a start: no training (this is what restarted the server every minute)");
  await assert.rejects(hz.train({ trigger: "the supervisor" }), (err) => err.code === "deferred" && /waits 5 minutes/.test(err.message));
  assert.equal(trained, 0);
  await hz.train({ trigger: "you asked" });
  assert.equal(trained, 1, "the owner's click is not held back");
  assert.equal(guard.record("horizon-train").ok, true);
  now = T0 + 6 * MIN;
  hz._job = null;
  await hz.tickOnce();
  await new Promise((r) => setImmediate(r));
  assert.equal(trained, 2, "after the grace it trains by itself as before");
});

test("without a guard the forecaster behaves exactly as before", async () => {
  const docs = new FileDocs(tmp());
  let trained = 0;
  const history = { record: () => ({ z: "" }), bars: () => [], status: () => ({ stocks: 100, sessions: 250 }), needs: () => [] };
  const hz = new Horizon({ market: { mode: () => "kite" }, docs, history: () => history, universe: () => ["A"], now: () => T0, log: quiet });
  hz._train = async () => {
    trained += 1;
    return { rows: 1 };
  };
  await hz.tickOnce();
  await new Promise((r) => setImmediate(r));
  assert.equal(trained, 1);
});

test("the supervisor: a duty the server died during is counted as failed and paused, not started again at once", async () => {
  const dir = tmp();
  let now = T0;
  let state = "no usable model yet";
  const ran = [];
  const duties = () => [{ id: "forecaster-train", name: "15-minute forecaster: training", what: "", due: () => state, run: async () => ran.push(now) }];

  // process 1 starts the duty; the server stops before it ends (the run never resolves)
  const s1 = new Supervisor({ docs: new FileDocs(dir), duties: [{ ...duties()[0], run: () => new Promise(() => {}) }], now: () => now, log: quiet });
  s1.tick();
  await new Promise((r) => setImmediate(r));
  assert.ok(new FileDocs(dir).read("automation/supervisor.json", null).duties["forecaster-train"].inFlight, "marked as running in the record");

  // process 2 finds the mark
  now = T0 + 2 * MIN;
  const s2 = new Supervisor({ docs: new FileDocs(dir), duties: duties(), now: () => now, log: quiet });
  const st = s2.status();
  const d = st.duties[0];
  assert.equal(d.state, "failed");
  assert.match(d.lastError, /server stopped while this was running/);
  assert.equal(st.events[0].kind, "failed");
  assert.equal(await s2.tick(), null, "not started again at once");
  assert.equal(ran.length, 0);
  now = T0 + 31 * MIN;
  assert.equal(await s2.tick(), "forecaster-train", "after its pause (30 min from when that run began) it is tried again");
  state = "";
  const rec = new FileDocs(dir).read("automation/supervisor.json", null).duties["forecaster-train"];
  assert.equal(rec.inFlight, null);
  assert.equal(rec.died, 0);
});

test("the supervisor waits out its grace after a start", async () => {
  let now = T0;
  const ran = [];
  const s = new Supervisor({ docs: new FileDocs(tmp()), graceMs: 5 * MIN, now: () => now, log: quiet, duties: [{ id: "x", name: "x", what: "", due: () => (ran.length ? "" : "behind"), run: async () => ran.push(1) }] });
  assert.equal(await s.tick(), null);
  now = T0 + 4 * MIN;
  assert.equal(await s.tick(), null);
  now = T0 + 5 * MIN;
  assert.equal(await s.tick(), "x");
});

test("a stop is written down with its memory, and pm2's limit is read from the environment", () => {
  const file = path.join(tmp(), "last-stop.json");
  lifecycle.recordStop(file, "SIGINT", { memoryUsage: () => ({ rss: 640 * 1048576, heapUsed: 300 * 1048576 }), uptime: () => 59.4, pid: 42 });
  const st = lifecycle.lastStop(file);
  assert.equal(st.signal, "SIGINT");
  assert.equal(st.rssMB, 640);
  assert.equal(st.heapMB, 300);
  assert.equal(st.upS, 59);
  assert.equal(lifecycle.lastStop(path.join(tmp(), "none.json")), null);
  assert.equal(lifecycle.memoryLimitMB({ max_memory_restart: String(1024 * 1048576) }), 1024);
  assert.equal(lifecycle.memoryLimitMB({}), null);
});

test("the health check says when the last restart was pm2's memory limit, and which training is paused", async () => {
  const dataDir = tmp();
  const docs = new FileDocs(dataDir);
  const now = Date.now();
  fs.writeFileSync(path.join(dataDir, "last-stop.json"), JSON.stringify({ at: new Date(now - 2 * MIN).toISOString(), signal: "SIGINT", rssMB: 990, heapMB: 700, upS: 59 }));
  const guard = new TrainGuard({ docs, now: () => now, startedAt: now - 10 * MIN, log: quiet });
  docs.write(NAME, { "horizon-train": { startedAt: new Date(now - 5 * MIN).toISOString(), endedAt: null, trigger: "itself", died: 0 } });
  const list = (await buildHealth({ now: () => now, docs, dataDir, trainGuard: guard })).checks;
  const server = list.find((c) => c.id === "server");
  assert.equal(server.status, "warn");
  assert.match(server.detail, /the last restart \(2 min ago\) came when it used 990 MB after 59 s — pm2's memory limit/);
  assert.match(server.detail, /automatic horizon train did not finish once \(the server stopped during it\); tried again in about 25 min/);

  // a deploy's restart (little memory in use) is not taken for one
  fs.writeFileSync(path.join(dataDir, "last-stop.json"), JSON.stringify({ at: new Date(now - 2 * MIN).toISOString(), signal: "SIGINT", rssMB: 310, heapMB: 150, upS: 7200 }));
  docs.write(NAME, {});
  const calm = (await buildHealth({ now: () => now, docs, dataDir, trainGuard: guard })).checks.find((c) => c.id === "server");
  assert.doesNotMatch(calm.detail, /memory limit|did not finish/);
});
