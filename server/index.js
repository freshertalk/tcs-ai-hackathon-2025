"use strict";
// Entry point:  node server/index.js
//
// Serves the API and, if `npm run build` has been run, the built site too, so
// one process is the whole deployment. During development run this alongside
// `npm start` — the React dev server forwards /api to it (src/setupProxy.js).

const { createApp } = require("./app");
const { SUPERADMIN_EMAIL, ADMIN_BASE } = require("./config");

const PORT = Number(process.env.PORT) || 5000;
const { app, setupToken } = createApp();

const server = app.listen(PORT, () => {
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
