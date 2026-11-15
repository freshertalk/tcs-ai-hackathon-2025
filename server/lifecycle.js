"use strict";
// Staying up: what the server process does when something goes wrong, and how it leaves.
//
// Three layers keep the site running (README → "Staying up"):
//   1. this file, inside the process — a crash is logged, written down (data/last-crash.json, shown
//      by the site health check after the restart) and the process exits at once, so pm2 starts a
//      clean one instead of letting it limp on in an unknown state; a stop or restart (SIGTERM /
//      SIGINT) closes the HTTP server and the database properly, with a hard deadline so a stuck
//      connection can never hold a restart up; a blocked event loop is noticed and logged.
//   2. pm2 (deploy/ecosystem.config.cjs) — restarts the process when it exits or grows too big,
//      backing off if it keeps failing; started again by systemd when the machine reboots.
//   3. the watchdog (deploy/watchdog.sh, every minute) — restarts the app when it is up but no
//      longer answers (a hang pm2 cannot see), and revives it if pm2 gave up on it.
//
// Decisions:
//   - uncaughtException: always fatal. Node's own advice: the process state is unknown afterwards.
//   - unhandledRejection: logged and counted, not fatal on its own (a forgotten .catch on a network
//     call is not worth dropping every open page and the live price stream). A burst — more than 20
//     in a minute — means something is badly wrong, so the process exits and pm2 restarts it.
// Nothing here starts work on its own except the stall timer, which is unref'd.

const fs = require("node:fs");
const path = require("node:path");

const stats = {
  startedAt: new Date().toISOString(),
  rejections: { count: 0, last: null },
  stalls: { count: 0, maxMs: 0, maxAt: null, date: "" },
  shuttingDown: false,
};

const istDate = (ms) => new Date(ms + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const msgOf = (err) => (err && err.stack ? String(err.stack) : String(err));

/** Write the crash down so the next process can show it (best effort, synchronous). */
function recordCrash(file, err, kind = "uncaughtException") {
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), kind, message: String((err && err.message) || err).slice(0, 500), stack: msgOf(err).slice(0, 2000), pid: process.pid }, null, 2));
  } catch (_) {
    /* the log line is the record then */
  }
}

/** The last crash written down, or null. */
function lastCrash(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return null;
  }
}

/**
 * Install the crash handlers.
 * @param opts { log, exit, crashFile, beforeExit: async () => {} (best-effort flush, at most flushMs),
 *               flushMs = 1500, burst = 20 rejections in burstMs = 60000 }
 * @returns uninstall()
 */
function installCrashHandlers({ log = console, exit = (c) => process.exit(c), crashFile = null, beforeExit = null, flushMs = 1500, burst = 20, burstMs = 60000, proc = process } = {}) {
  let dying = false;
  const recent = [];
  const die = (err, kind) => {
    if (dying) return;
    dying = true;
    log.error(`[lifecycle] ${kind} — the process exits now and pm2 starts a clean one:\n${msgOf(err)}`);
    recordCrash(crashFile, err, kind);
    const done = () => exit(1);
    const t = setTimeout(done, flushMs);
    if (t.unref) t.unref();
    if (typeof beforeExit === "function") {
      Promise.resolve()
        .then(beforeExit)
        .catch(() => {})
        .finally(() => {
          clearTimeout(t);
          done();
        });
    }
  };
  const onException = (err) => die(err, "uncaughtException");
  const onRejection = (reason) => {
    const now = Date.now();
    stats.rejections.count += 1;
    stats.rejections.last = { at: new Date(now).toISOString(), message: String((reason && reason.message) || reason).slice(0, 300) };
    log.error(`[lifecycle] unhandled promise rejection (logged, not fatal):\n${msgOf(reason)}`);
    recent.push(now);
    while (recent.length && now - recent[0] > burstMs) recent.shift();
    if (recent.length > burst) die(reason, `unhandledRejection burst (${recent.length} in ${Math.round(burstMs / 1000)} s)`);
  };
  proc.on("uncaughtException", onException);
  proc.on("unhandledRejection", onRejection);
  return () => {
    proc.removeListener("uncaughtException", onException);
    proc.removeListener("unhandledRejection", onRejection);
  };
}

/**
 * Leave properly: stop accepting connections, let requests in flight finish, close the long-lived
 * streams after a short grace, run the closers (the database), then exit. A hard deadline makes sure
 * a restart never hangs on a stuck connection (pm2's kill_timeout is a little longer).
 * @param opts { server, closers: [async fn], log, exit, graceMs = 3000, deadlineMs = 8000 }
 * @returns a function (signal) → Promise
 */
function makeShutdown({ server = null, closers = [], log = console, exit = (c) => process.exit(c), graceMs = 3000, deadlineMs = 8000 } = {}) {
  let closing = null;
  return (signal = "shutdown") => {
    if (closing) return closing;
    stats.shuttingDown = true;
    log.log(`[lifecycle] ${signal}: closing — new connections refused, requests in flight finishing…`);
    const hard = setTimeout(() => {
      log.error(`[lifecycle] still closing after ${deadlineMs / 1000} s: leaving anyway`);
      exit(1);
    }, deadlineMs);
    if (hard.unref) hard.unref();
    closing = (async () => {
      if (server) {
        const closed = new Promise((resolve) => server.close(() => resolve()));
        if (typeof server.closeIdleConnections === "function") server.closeIdleConnections();
        // live streams (prices, Social Media) never end by themselves: cut them after the grace
        const cut = setTimeout(() => {
          if (typeof server.closeAllConnections === "function") server.closeAllConnections();
        }, graceMs);
        if (cut.unref) cut.unref();
        await closed;
        clearTimeout(cut);
      }
      for (const fn of closers) {
        try {
          await fn();
        } catch (err) {
          log.error(`[lifecycle] while closing: ${err && err.message ? err.message : err}`);
        }
      }
      clearTimeout(hard);
      log.log("[lifecycle] closed cleanly");
      exit(0);
    })();
    return closing;
  };
}

/**
 * Notice a blocked event loop: a timer that should fire every `everyMs` arriving much later means
 * something held the loop (a huge synchronous job). Logged, and kept for the health check; a true
 * hang is the watchdog's job.
 * @returns stop()
 */
function watchStalls({ everyMs = 1000, warnMs = 2000, log = console, now = () => Date.now() } = {}) {
  let expected = now() + everyMs;
  const t = setInterval(() => {
    const at = now();
    const late = at - expected;
    expected = at + everyMs;
    if (late < warnMs) return;
    const day = istDate(at);
    if (stats.stalls.date !== day) Object.assign(stats.stalls, { count: 0, maxMs: 0, maxAt: null, date: day });
    stats.stalls.count += 1;
    if (late > stats.stalls.maxMs) Object.assign(stats.stalls, { maxMs: late, maxAt: new Date(at).toISOString() });
    log.error(`[lifecycle] the event loop was blocked for ${(late / 1000).toFixed(1)} s`);
  }, everyMs);
  if (t.unref) t.unref();
  return () => clearInterval(t);
}

/** pm2's process facts, when pm2 runs this process (it passes them in the environment). */
function pm2Facts(env = process.env) {
  if (env.pm_id === undefined) return null;
  const n = Number(env.restart_time);
  return { id: env.pm_id, name: env.name || null, restarts: Number.isFinite(n) ? n : null };
}

module.exports = { stats, installCrashHandlers, makeShutdown, watchStalls, recordCrash, lastCrash, pm2Facts };
