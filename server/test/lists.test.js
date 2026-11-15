"use strict";
// Several named watchlists: one is open, and it is "the watchlist" every engine reads.
const test = require("node:test");
const assert = require("node:assert/strict");
const { MarketService } = require("../market/service");

function svc(watchlist = ["SBIN", "INFY"]) {
  const m = Object.create(MarketService.prototype);
  let t = 1000;
  m.store = { data: { market: { watchlist } }, update(fn) { fn(this.data); } };
  m.mode = () => "kite";
  m.now = () => (t += 1);
  return m;
}

test("the first look shows one list, Main, holding the watchlist", () => {
  const m = svc();
  const l = m.lists();
  assert.deepEqual(l.lists.map((x) => [x.id, x.name, x.count]), [["main", "Main", 2]]);
  assert.equal(l.active, "main");
});

test("a new list opens empty; switching back brings the old symbols back; edits follow the open list", () => {
  const m = svc();
  let r = m.listAction({ action: "create", name: "  Swing   ideas " });
  assert.equal(r.lists[1].name, "Swing ideas");
  assert.equal(r.active, r.lists[1].id);
  assert.deepEqual(r.watchlist, []);
  m.setWatchlist(["TCS"]);
  assert.deepEqual(m.lists().lists.find((x) => x.name === "Swing ideas").symbols, ["TCS"]);
  r = m.listAction({ action: "open", id: "main" });
  assert.deepEqual(r.watchlist, ["SBIN", "INFY"]);
  r = m.listAction({ action: "open", id: r.lists[1].id });
  assert.deepEqual(r.watchlist, ["TCS"]);
});

test("rename, delete (never the last), and the limits", () => {
  const m = svc();
  const id = m.listAction({ action: "create", name: "Intraday" }).active;
  assert.equal(m.listAction({ action: "rename", id, name: "F&O" }).lists[1].name, "F&O");
  assert.throws(() => m.listAction({ action: "create", name: "F&O" }), /exists/);
  assert.throws(() => m.listAction({ action: "create", name: "" }), /name/);
  const r = m.listAction({ action: "delete", id });
  assert.equal(r.active, "main", "deleting the open list opens the first");
  assert.deepEqual(r.watchlist, ["SBIN", "INFY"]);
  assert.throws(() => m.listAction({ action: "delete", id: "main" }), /last list/);
  for (let i = 0; i < 9; i += 1) m.listAction({ action: "create", name: `L${i}` });
  assert.throws(() => m.listAction({ action: "create", name: "one more" }), /up to 10/);
});
