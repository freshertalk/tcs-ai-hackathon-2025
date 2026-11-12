"use strict";
// A tiny JSON-file store. The data is a handful of rows (a few admins and
// three settings), so a database would be more machinery than the job needs.
// Writes are atomic: write a temp file, then rename over the real one.

const fs = require("fs");
const path = require("path");

const EMPTY = () => ({
  settings: {
    googleClientId: "",
    googleClientSecretEnc: "",
    gaMeasurementId: "",
  },
  admins: [], // { email, addedBy, addedAt }
  users: {}, // email -> { name, picture, lastLogin }
  market: { watchlist: [], demo: false }, // the Analyzer's watchlist and demo switch
});

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, "db.json");
    fs.mkdirSync(dir, { recursive: true });
    this.data = this._read();
  }

  _read() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      const base = EMPTY();
      return {
        settings: { ...base.settings, ...(raw.settings || {}) },
        admins: Array.isArray(raw.admins) ? raw.admins : [],
        users: raw.users && typeof raw.users === "object" ? raw.users : {},
        market: {
          watchlist: raw.market && Array.isArray(raw.market.watchlist) ? raw.market.watchlist : [],
          demo: Boolean(raw.market && raw.market.demo),
        },
      };
    } catch (err) {
      if (err.code !== "ENOENT") {
        // a corrupt file must never be silently replaced — keep a copy
        try {
          fs.copyFileSync(this.file, `${this.file}.corrupt-${Date.now()}`);
        } catch (_) {
          /* best effort */
        }
      }
      return EMPTY();
    }
  }

  /** Run a mutation, then persist. The callback edits `data` in place. */
  update(fn) {
    fn(this.data);
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Store };
