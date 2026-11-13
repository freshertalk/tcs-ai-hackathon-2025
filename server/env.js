"use strict";
// Reads server/.env (KEY=VALUE per line) into process.env, without overriding anything
// already set. The file holds what must not go into git — the MongoDB address, the two
// encryption keys — and is git-ignored. Lines starting with # are comments; values may be
// wrapped in single or double quotes.

const fs = require("fs");
const path = require("path");

function loadEnv(file = path.join(__dirname, ".env"), env = process.env) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (_) {
    return [];
  }
  const set = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (env[m[1]] === undefined) {
      env[m[1]] = v;
      set.push(m[1]);
    }
  }
  return set;
}

module.exports = { loadEnv };
