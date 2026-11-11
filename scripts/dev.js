/* eslint-disable no-console */
// One command for development:  npm run dev
//
//   • the API server  (server/index.js)      http://localhost:5000
//   • the site        (react-scripts start)  http://localhost:3000   — /api is proxied to the API
//
// Both start together and stop together (Ctrl+C). If server/ has never had its
// dependencies installed, that happens first. Override ports with PORT (site)
// and API_PORT (API).

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const apiPort = process.env.API_PORT || "5000";

if (!fs.existsSync(path.join(root, "server", "node_modules"))) {
  console.log("[dev] Installing the API server's dependencies (first run only)…");
  const r = spawnSync("npm", ["install", "--prefix", "server", "--no-audit", "--no-fund"], {
    cwd: root,
    stdio: "inherit",
    shell: true,
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

const api = spawn(process.execPath, [path.join(root, "server", "index.js")], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, PORT: apiPort },
});

const site = spawn(
  process.execPath,
  [path.join(root, "node_modules", "react-scripts", "bin", "react-scripts.js"), "start"],
  {
    cwd: root,
    stdio: "inherit",
    // the proxy in src/setupProxy.js reads API_TARGET
    env: { ...process.env, API_TARGET: `http://localhost:${apiPort}` },
  }
);

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const c of [api, site]) {
    try {
      c.kill();
    } catch (_) {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(code), 300);
}

api.on("exit", (code) => {
  if (!stopping && code) {
    console.error(`\n[dev] The API server stopped (code ${code}). Stopping the site too.`);
  }
  stop(code || 0);
});
site.on("exit", (code) => stop(code || 0));
["SIGINT", "SIGTERM"].forEach((s) => process.on(s, () => stop(0)));
