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

app.listen(PORT, () => {
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
