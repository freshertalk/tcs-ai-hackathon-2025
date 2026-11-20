"use strict";
// Each person's own preferences for the private area, chosen on /me → Customize and kept on the server, so they follow
// the person to every device: how it looks (dark or light, the accent colour, the text size, how tightly things are
// packed), which workspaces the terminal shows and in what order, where it opens, and how the Desk starts.
//
// Only looks and arrangement live here. Nothing in a preference can widen what a person is allowed to do: a workspace
// the person has no right to stays hidden whatever their list says (the terminal filters by role first), and no
// setting here touches trading, the AI or anyone else's view.
//
// One small record per person (prefs/<slug>.json). Everything is checked on the way in: an unknown value is dropped
// and the default stands, so an old or hand-edited record can never break a page.

const crypto = require("crypto");

const VIEWS = ["analyzer", "now", "research", "advisor", "screener", "account", "indices", "analysis", "calendar", "journal", "paper", "debrief", "engine", "document"];
const OPTIONS = {
  theme: ["dark", "light"],
  accent: ["blue", "teal", "green", "amber", "rose", "violet"],
  text: ["small", "normal", "large", "larger"],
  density: ["comfortable", "compact"],
  dock: ["auto", "open", "closed"],
  chart: ["pro", "m1", "m5", "daily"],
  views: VIEWS,
};
const DEFAULTS = Object.freeze({
  theme: "dark",
  accent: "blue",
  text: "normal",
  density: "comfortable",
  motion: true, // gentle movement when pages and cards open
  nav: { order: [], hidden: [] }, // [] = the built-in order, nothing hidden
  start: "analyzer", // the workspace the terminal opens on
  desk: { board: true, dock: "auto", chart: "pro" },
  home: { status: true, today: true, workspaces: true }, // the blocks of /me
});

const slugOf = (email) => {
  const e = String(email || "").toLowerCase();
  return `${e.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)}-${crypto.createHash("sha1").update(e).digest("hex").slice(0, 8)}`;
};
const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);
const bool = (v, fallback) => (typeof v === "boolean" ? v : fallback);
const uniqViews = (list) => [...new Set((Array.isArray(list) ? list : []).filter((x) => VIEWS.includes(x)))];

/** Whatever was stored or sent, as a complete, valid set of preferences. */
function clean(input) {
  const p = input && typeof input === "object" ? input : {};
  const nav = p.nav && typeof p.nav === "object" ? p.nav : {};
  const desk = p.desk && typeof p.desk === "object" ? p.desk : {};
  const home = p.home && typeof p.home === "object" ? p.home : {};
  const hidden = uniqViews(nav.hidden).filter((v) => v !== "analyzer"); // the Desk is the way in: it cannot be hidden
  const start = pick(p.start, VIEWS, DEFAULTS.start);
  return {
    theme: pick(p.theme, OPTIONS.theme, DEFAULTS.theme),
    accent: pick(p.accent, OPTIONS.accent, DEFAULTS.accent),
    text: pick(p.text, OPTIONS.text, DEFAULTS.text),
    density: pick(p.density, OPTIONS.density, DEFAULTS.density),
    motion: bool(p.motion, DEFAULTS.motion),
    nav: { order: uniqViews(nav.order), hidden },
    start: hidden.includes(start) ? DEFAULTS.start : start, // a hidden workspace cannot be where the terminal opens
    desk: { board: bool(desk.board, DEFAULTS.desk.board), dock: pick(desk.dock, OPTIONS.dock, DEFAULTS.desk.dock), chart: pick(desk.chart, OPTIONS.chart, DEFAULTS.desk.chart) },
    home: { status: bool(home.status, DEFAULTS.home.status), today: bool(home.today, DEFAULTS.home.today), workspaces: bool(home.workspaces, DEFAULTS.home.workspaces) },
  };
}

/** A change laid over what is there: only the parts that were sent move. */
function merge(cur, patch) {
  const p = patch && typeof patch === "object" ? patch : {};
  return clean({
    ...cur,
    ...p,
    nav: { ...cur.nav, ...(p.nav && typeof p.nav === "object" ? p.nav : {}) },
    desk: { ...cur.desk, ...(p.desk && typeof p.desk === "object" ? p.desk : {}) },
    home: { ...cur.home, ...(p.home && typeof p.home === "object" ? p.home : {}) },
  });
}

class Prefs {
  constructor({ docs }) {
    this.docs = docs;
    this._rev = 0;
  }
  _name(email) {
    return `prefs/${slugOf(email)}.json`;
  }
  get(email) {
    return clean(this.docs.read(this._name(email), null));
  }
  /** Has this person ever saved a preference? (If not, the page starts from what their device already shows.) */
  stored(email) {
    return this.docs.read(this._name(email), null) !== null;
  }
  set(email, patch) {
    const next = merge(this.get(email), patch);
    this.docs.write(this._name(email), next);
    this._rev += 1;
    return next;
  }
  reset(email) {
    if (typeof this.docs.remove === "function") this.docs.remove(this._name(email));
    else this.docs.write(this._name(email), clean(null));
    this._rev += 1;
    return clean(null);
  }
  fingerprint() {
    return String(this._rev);
  }
}

module.exports = { Prefs, clean, merge, DEFAULTS, OPTIONS, VIEWS };
