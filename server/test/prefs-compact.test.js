"use strict";
// Compact by default (24 Nov 2026): a new person starts compact; a record saved before the change (which carries the old
// default, not a choice) moves to compact once; whatever is chosen afterwards stands. Trade setup and Vinaypedia can be
// shown, hidden and ordered like every other workspace.

const test = require("node:test");
const assert = require("node:assert/strict");
const { Prefs, clean, DEFAULTS, VIEWS } = require("../prefs");

const store = () => {
  const mem = {};
  return { mem, docs: { read: (n, d) => (n in mem ? mem[n] : d), write: (n, v) => (mem[n] = v) } };
};

test("a person with no saved preferences starts compact", () => {
  const s = store();
  assert.equal(DEFAULTS.density, "compact");
  assert.equal(new Prefs({ docs: s.docs }).get("new@example.com").density, "compact");
});

test("an old record moves to compact once; a choice made afterwards is kept", () => {
  const s = store();
  const p = new Prefs({ docs: s.docs });
  const name = p._name("old@example.com");
  s.mem[name] = { theme: "light", density: "comfortable", accent: "teal" }; // saved before 24 Nov 2026
  const got = p.get("old@example.com");
  assert.equal(got.density, "compact");
  assert.equal(got.theme, "light", "nothing else changes");
  assert.equal(got.accent, "teal");
  assert.ok(s.mem[name].v >= 2, "marked, so it happens only once");
  // the person asks for room again: it stands
  p.set("old@example.com", { density: "comfortable" });
  assert.equal(p.get("old@example.com").density, "comfortable");
  assert.equal(new Prefs({ docs: s.docs }).get("old@example.com").density, "comfortable", "after a restart too");
});

test("an order saved before the owner's order of 27 Nov 2026 gives way to it once; what is hidden stays hidden", () => {
  const s = store();
  const p = new Prefs({ docs: s.docs });
  const name = p._name("me@example.com");
  s.mem[name] = { v: 2, nav: { order: ["research", "analyzer", "now"], hidden: ["paper"] } };
  const got = p.get("me@example.com");
  assert.deepEqual(got.nav.order, []);
  assert.deepEqual(got.nav.hidden, ["paper"]);
  assert.equal(s.mem[name].v, 3);
  p.set("me@example.com", { nav: { order: ["screener", "analyzer"] } });
  assert.deepEqual(new Prefs({ docs: s.docs }).get("me@example.com").nav.order, ["screener", "analyzer"], "a new order stands");
});

test("Trade setup and Vinaypedia can be hidden and ordered", () => {
  assert.ok(VIEWS.includes("setup") && VIEWS.includes("learning"));
  const c = clean({ nav: { order: ["learning", "setup", "journal"], hidden: ["setup"] }, start: "learning" });
  assert.deepEqual(c.nav.order, ["learning", "setup", "journal"]);
  assert.deepEqual(c.nav.hidden, ["setup"]);
  assert.equal(c.start, "learning");
});

test("hide amounts is a kept preference, off unless switched on", () => {
  assert.equal(DEFAULTS.privacy, false);
  assert.equal(clean({ privacy: true }).privacy, true);
  assert.equal(clean({ privacy: "yes" }).privacy, false, "only a real yes or no");
  const s = store();
  const p = new Prefs({ docs: s.docs });
  p.set("pv@example.com", { privacy: true });
  assert.equal(new Prefs({ docs: s.docs }).get("pv@example.com").privacy, true, "kept across a restart");
});
