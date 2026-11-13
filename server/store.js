"use strict";
// The app's main record: settings (secrets encrypted), the admin list, users, the
// watchlist and the trading switch. Held in memory and saved through the docs store
// (server/docs.js) on every change — a file in server/data/ or a MongoDB document.

const { FileDocs } = require("./docs");

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
  /**
   * @param dir   server/data/ — used when no docs store is given
   * @param docs  where to keep the record (server/docs.js)
   */
  constructor(dir, docs = null) {
    this.dir = dir;
    this.docs = docs || new FileDocs(dir);
    this.data = this._shape(this.docs.read("db.json", null));
  }

  _shape(raw) {
    const base = EMPTY();
    if (!raw || typeof raw !== "object") return base;
    return {
      settings: { ...base.settings, ...(raw.settings || {}) },
      admins: Array.isArray(raw.admins) ? raw.admins : [],
      users: raw.users && typeof raw.users === "object" ? raw.users : {},
      market: {
        watchlist: raw.market && Array.isArray(raw.market.watchlist) ? raw.market.watchlist : [],
        demo: Boolean(raw.market && raw.market.demo),
      },
      // the trading switch and its limits: kept across restarts (the trading service fills in defaults)
      ...(raw.trading && typeof raw.trading === "object" ? { trading: raw.trading } : {}),
    };
  }

  /** Run a mutation, then persist. The callback edits `data` in place. */
  update(fn) {
    fn(this.data);
    this.docs.write("db.json", this.data);
  }
}

module.exports = { Store };
