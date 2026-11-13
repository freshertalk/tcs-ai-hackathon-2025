"use strict";
// Entry point:  node server/index.js
//
// Serves the API and, if `npm run build` has been run, the built site too, so
// one process is the whole deployment. During development run this alongside
// `npm start` — the React dev server forwards /api to it (src/setupProxy.js).

const path = require("path");
// server/.env first: MONGO_URI and the keys may live there (git-ignored)
require("./env").loadEnv();
const { createApp } = require("./app");
const { openDocs } = require("./docs");
const { SUPERADMIN_EMAIL, ADMIN_BASE } = require("./config");

const PORT = Number(process.env.PORT) || 5000;

async function main() {
  // MONGO_URI set → records live in MongoDB (database MONGO_DB, default "stock-trading");
  // otherwise in files under server/data/
  let docs;
  try {
    docs = await openDocs({ dir: path.join(__dirname, "data") });
  } catch (err) {
    console.error(`\nCould not connect to MongoDB: ${err.message}\nCheck MONGO_URI (and that the database server is running), or unset it to use files.\n`);
    process.exit(1);
  }
  const { app, setupToken, holidays } = createApp({ docs });

  const server = app.listen(PORT, () => {
    // fetch the exchanges' official holiday data now, then every 6 hours
    holidays.start();
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

  // pm2 stop / restart, Ctrl+C: let the last writes reach the database before leaving
  let closing = false;
  const shutdown = async (sig) => {
    if (closing) return;
    closing = true;
    console.log(`${sig}: saving and closing…`);
    server.close();
    try {
      await docs.close();
    } catch (err) {
      console.error("[db] close:", err.message);
    }
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
