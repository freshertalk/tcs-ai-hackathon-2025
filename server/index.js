"use strict";
// Entry point:  node server/index.js
//
// Serves the API and, if `npm run build` has been run, the built site too, so
// one process is the whole deployment. During development run this alongside
// `npm start` — the React dev server forwards /api to it (src/setupProxy.js).
//
// Staying up (server/lifecycle.js, README → "Staying up"): a crash is written down and the
// process leaves at once so pm2 starts a clean one; a stop or restart closes properly within 8 s;
// a blocked event loop is logged. pm2 restarts it, the watchdog catches hangs, systemd reboots.

const path = require("path");
// server/.env first: MONGO_URI and the keys may live there (git-ignored)
require("./env").loadEnv();
const { createApp } = require("./app");
const { openDocs } = require("./docs");
const { SUPERADMIN_EMAIL, ADMIN_BASE } = require("./config");
const { installCrashHandlers, makeShutdown, watchStalls } = require("./lifecycle");

const PORT = Number(process.env.PORT) || 5000;
// in production the app listens on 127.0.0.1 only (deploy/ecosystem.config.cjs): the world
// reaches it through nginx, so nobody can go round nginx or forge the forwarded address
const HOST = process.env.HOST || undefined;
const DATA_DIR = path.join(__dirname, "data");
const CRASH_FILE = path.join(DATA_DIR, "last-crash.json"); // shown by the site health check after the restart
const STOP_FILE = path.join(DATA_DIR, "last-stop.json"); // how the last process left (a restart for memory shows there)

// from the very first line: a crash is logged, written down, the database flushed (at most 1.5 s),
// and the process exits — pm2 starts a clean one instead of letting it run on in an unknown state
let flushDocs = null;
installCrashHandlers({ crashFile: CRASH_FILE, beforeExit: () => (flushDocs ? flushDocs() : null) });
watchStalls();

async function main() {
  // MONGO_URI set → records live in MongoDB (database MONGO_DB, default "stock-trading");
  // otherwise in files under server/data/
  let docs;
  try {
    docs = await openDocs({ dir: DATA_DIR });
  } catch (err) {
    console.error(`\nCould not connect to MongoDB: ${err.message}\nCheck MONGO_URI (and that the database server is running), or unset it to use files.\n`);
    process.exit(1);
  }
  flushDocs = () => docs.close();
  const { app, setupToken, holidays, nseHolidays, recorder } = createApp({ docs });

  const server = app.listen(PORT, HOST, () => {
    // fetch the exchanges' official holiday data now, then every 6 hours
    holidays.start();
    // NSE's own trading-holiday list, now and every 6 hours (the trading-day rules read it). NSE_HOLIDAY_SYNC=off in
    // server/.env stops the automatic reads (the last good copy, else the built-in table, stays in use).
    if (nseHolidays && String(process.env.NSE_HOLIDAY_SYNC || "").toLowerCase() !== "off") nseHolidays.start();
    console.log(`\nAPI ready on http://localhost:${PORT}`);
    console.log(`Admin area: ${ADMIN_BASE}   (superadmin: ${SUPERADMIN_EMAIL})`);
    if (setupToken) {
      console.log(
        "\nGoogle sign-in is not configured yet." +
          `\n  1. Open ${ADMIN_BASE} in the browser.` +
          "\n  2. Paste this one-time setup token, then your Google Client ID and Secret:" +
          `\n\n     ${setupToken}\n`
      );
    }
    // pm2 (wait_ready in deploy/ecosystem.config.cjs) counts the process as up from this moment
    if (typeof process.send === "function") process.send("ready");
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        [
          "",
          `Port ${PORT} is already in use — the API server is probably already running.`,
          "Close that terminal first, or start this one on another port:  PORT=5001 npm run server",
          "",
        ].join("\n")
      );
    } else {
      console.error(err);
    }
    process.exit(1);
  });

  // pm2 stop / restart, Ctrl+C: requests in flight finish, the live streams are closed after a
  // short grace, the last writes reach the database — and after 8 s it leaves regardless (pm2's
  // kill_timeout is 10 s), so a restart can never hang on a stuck connection
  // the market recorder first: the minutes read since its last save go to the database before it closes
  const shutdown = makeShutdown({ server, closers: [() => recorder.stop(), () => docs.close()], stopFile: STOP_FILE });
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  // pm2 on Windows sends a message instead of a signal
  process.on("message", (m) => {
    if (m === "shutdown") shutdown("shutdown message");
  });
}

main();
