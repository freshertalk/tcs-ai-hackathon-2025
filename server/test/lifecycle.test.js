"use strict";
// Staying up (server/lifecycle.js): a crash is written down and the process leaves; a burst of
// unhandled rejections does too, a single one does not; a stop closes the server, its streams and
// the database within a deadline; a blocked event loop is noticed. Nothing here really exits.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { EventEmitter } = require("node:events");

const { stats, installCrashHandlers, makeShutdown, watchStalls, lastCrash, pm2Facts } = require("../lifecycle");

const quiet = { log() {}, error() {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "vpt-life-"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("an uncaught exception is written down, the database flushed, and the process exits with 1", async () => {
  const proc = new EventEmitter();
  const file = path.join(tmp(), "last-crash.json");
  const exits = [];
  let flushed = false;
  installCrashHandlers({ proc, log: quiet, exit: (c) => exits.push(c), crashFile: file, beforeExit: async () => (flushed = true) });
  proc.emit("uncaughtException", new Error("boom in a handler"));
  proc.emit("uncaughtException", new Error("a second one while leaving")); // ignored: already leaving
  await wait(20);
  assert.deepEqual(exits, [1]);
  assert.equal(flushed, true);
  const c = lastCrash(file);
  assert.equal(c.kind, "uncaughtException");
  assert.equal(c.message, "boom in a handler");
  assert.match(c.stack, /boom in a handler/);
});

test("a flush that hangs cannot keep a crashed process alive", async () => {
  const proc = new EventEmitter();
  const exits = [];
  installCrashHandlers({ proc, log: quiet, exit: (c) => exits.push(c), beforeExit: () => new Promise(() => {}), flushMs: 30 });
  proc.emit("uncaughtException", new Error("x"));
  await wait(80);
  assert.deepEqual(exits, [1]);
});

test("one unhandled rejection is logged and counted, not fatal; a burst exits", async () => {
  const proc = new EventEmitter();
  const exits = [];
  const before = stats.rejections.count;
  installCrashHandlers({ proc, log: quiet, exit: (c) => exits.push(c), burst: 3, burstMs: 1000 });
  proc.emit("unhandledRejection", new Error("forgot a catch"));
  await wait(10);
  assert.deepEqual(exits, []);
  assert.equal(stats.rejections.count, before + 1);
  assert.match(stats.rejections.last.message, /forgot a catch/);
  for (let i = 0; i < 3; i += 1) proc.emit("unhandledRejection", new Error(`again ${i}`));
  await wait(1600);
  assert.deepEqual(exits, [1], "more than 3 within a second: leave and let pm2 restart");
});

test("a stop closes the server — a live stream included — runs the closers, and exits with 0", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/stream") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("event: hello\ndata: {}\n\n"); // never ends by itself
      return;
    }
    res.end("ok");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((resolve) => {
    http.get(`http://127.0.0.1:${port}/stream`, (res) => res.once("data", resolve));
  });
  const exits = [];
  const closed = [];
  const shutdown = makeShutdown({ server, closers: [async () => closed.push("db")], log: quiet, exit: (c) => exits.push(c), graceMs: 50, deadlineMs: 3000 });
  const p = shutdown("SIGTERM");
  assert.equal(shutdown("SIGTERM"), p, "a second signal waits for the same close");
  await p;
  assert.deepEqual(closed, ["db"]);
  assert.deepEqual(exits, [0]);
  assert.equal(server.listening, false);
});

test("a closer that never finishes cannot hold a restart: the deadline exits with 1", async () => {
  const exits = [];
  const shutdown = makeShutdown({ server: null, closers: [() => new Promise(() => {})], log: quiet, exit: (c) => exits.push(c), deadlineMs: 60 });
  shutdown("SIGTERM");
  await wait(120);
  assert.deepEqual(exits, [1]);
});

test("a blocked event loop is noticed and kept for the health check", async () => {
  const before = stats.stalls.count;
  const stop = watchStalls({ everyMs: 20, warnMs: 100, log: quiet });
  await wait(40);
  const until = Date.now() + 250;
  while (Date.now() < until) {
    /* hold the loop, as a huge synchronous job would */
  }
  await wait(60);
  stop();
  assert.ok(stats.stalls.count > before);
  assert.ok(stats.stalls.maxMs >= 100);
});

test("pm2's facts come from its environment; none outside pm2", () => {
  assert.equal(pm2Facts({}), null);
  assert.deepEqual(pm2Facts({ pm_id: "0", name: "vinaytiwari", restart_time: "3" }), { id: "0", name: "vinaytiwari", restarts: 3 });
});
