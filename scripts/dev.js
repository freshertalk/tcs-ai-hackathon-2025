/* eslint-disable no-console */
// scripts/dev.js — `npm start`
// ---------------------------------------------------------------------------
// The CRA dev server, plus the book pipeline kept in step with the drop box:
//
//   1. publish what is in public/ebooks/ before the server starts, then
//   2. watch that folder, and republish whenever an EPUB (or books.json) is
//      added or replaced.
//
// Replace public/ebooks/<name>.epub with a new edition, save, and the reader
// serves the new text within a second or two. An open reader tab is told a
// new edition is available (see the update notice in src/reader/Reader.jsx).
// Publishing is hash-checked, so touching a file without changing it does
// nothing.
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DROP = path.join(ROOT, "public", "ebooks");
const PUBLISH = path.join(__dirname, "publish-book.js");
const CRA = path.join(ROOT, "node_modules", "react-scripts", "bin", "react-scripts.js");

const publish = (label) => {
  const r = spawnSync(process.execPath, [PUBLISH, "--soft"], { cwd: ROOT, encoding: "utf8" });
  const out = `${r.stdout || ""}${r.stderr || ""}`.trim();
  if (out) console.log(out.split("\n").map((l) => `[books] ${l}`).join("\n"));
  if (r.status !== 0) console.warn(`[books] ${label} failed — the previous edition stays live.`);
};

publish("initial publish");

let timer = null;
let watcher = null;
let watcher2 = null;
try {
  fs.mkdirSync(DROP, { recursive: true });
  watcher = fs.watch(DROP, (event, name) => {
    if (name && !/\.epub$|books\.json$/i.test(name)) return;
    clearTimeout(timer);
    // an editor or a copy writes the file in several bursts — wait for quiet
    timer = setTimeout(() => {
      console.log(`[books] change detected${name ? ` in ${name}` : ""} — republishing`);
      publish("republish");
    }, 900);
  });
  console.log("[books] watching public/ebooks for new or replaced EPUBs");
  // the hand-made cover pictures live in a folder of their own
  const ART = path.join(DROP, "coverimages");
  if (fs.existsSync(ART)) {
    watcher2 = fs.watch(ART, { recursive: false }, (event, name) => {
      if (name && !/.(png|jpe?g|webp)$/i.test(name)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        console.log(`[books] cover pictures changed${name ? ` (${name})` : ""} — republishing`);
        publish("republish");
      }, 1200);
    });
    console.log("[books] watching public/ebooks/coverimages for cover pictures");
  }
} catch (err) {
  console.warn(`[books] could not watch public/ebooks (${err.message}) — run npm run book:publish by hand`);
}

const server = spawn(process.execPath, [CRA, "start"], { cwd: ROOT, stdio: "inherit", env: process.env });

const stop = (code) => {
  if (watcher) watcher.close();
  if (watcher2) watcher2.close();
  process.exit(code ?? 0);
};
server.on("exit", stop);
process.on("SIGINT", () => server.kill("SIGINT"));
process.on("SIGTERM", () => server.kill("SIGTERM"));
