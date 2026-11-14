"use strict";
// The screener's index lists: NSE's published constituent files, read weekly, kept when NSE is
// unreachable, with copies bundled for the first run. The RSI search covers the Nifty 500.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { IndexList, parseIndexCsv, CATALOG, RSI_INDEX, BASE, SNAP } = require("../market/indexlist");

const csv = (n, extra = "") => ["Company Name,Industry,Symbol,Series,ISIN Code", ...Array.from({ length: n }, (_, i) => `Co ${i},X,SYM${i},EQ,INE${i}`), extra].filter(Boolean).join("\r\n");

test("the catalogue: NSE's derivative indices first, then broad and sectoral ones, each with a bundled list", () => {
  const derivs = CATALOG.filter((c) => c.group === "Indices eligible in derivatives").map((c) => c.name);
  assert.deepEqual(derivs, ["NIFTY 50", "NIFTY BANK", "NIFTY FINANCIAL SERVICES", "NIFTY MIDCAP SELECT", "NIFTY NEXT 50"]);
  for (const name of ["NIFTY 100", "NIFTY 500", "NIFTY MIDCAP 150", "NIFTY SMALLCAP 250", "NIFTY IT", "NIFTY PSU BANK"]) assert.ok(CATALOG.some((c) => c.name === name), name);
  for (const c of CATALOG) {
    assert.ok(SNAP.indices[c.id] && SNAP.indices[c.id].length >= 10, `${c.id} has a bundled copy`);
    assert.match(c.file, /^ind_.+list\.csv$/);
    assert.ok(c.kite.length >= 1);
  }
  assert.equal(RSI_INDEX, "nifty500");
  assert.equal(SNAP.indices.nifty50.length, 50);
  assert.ok(SNAP.indices.nifty500.length >= 480);
  assert.ok(SNAP.indices.nifty50.includes("RELIANCE") && SNAP.indices.niftybank.includes("HDFCBANK"));
});

test("NSE's CSV is read by its Symbol column, EQ series only, and must look like the list it replaces", () => {
  const s = parseIndexCsv(csv(100, "M and M Ltd,Auto,M&M,EQ,INE101") + "\r\nBond,X,GSEC1,GS,INE999", 100);
  assert.equal(s.length, 101);
  assert.ok(s.includes("M&M"));
  assert.ok(!s.includes("GSEC1"));
  assert.throws(() => parseIndexCsv(csv(20), 100), /about 100 were expected/);
  assert.throws(() => parseIndexCsv(csv(3)), /not an index list/);
  assert.throws(() => parseIndexCsv("<html>blocked</html>"), /Symbol|empty/);
});

test("a weekly re-read per index from NSE, an honest User-Agent, and the last copy kept when it fails", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-idx-"));
  let now = Date.parse("2026-11-14T05:00:00Z");
  const asked = [];
  let answer = { ok: true, status: 200, text: async () => csv(50) };
  const list = new IndexList({ dir, now: () => now, log: { log() {} }, fetchImpl: async (url, init) => (asked.push({ url, ua: init.headers["User-Agent"] }), answer) });
  assert.equal(list.status("nifty50").source, "snapshot");
  assert.ok(list.list("nifty50").includes("RELIANCE"), "the bundled copy until NSE has been read");
  await list._busy.get("nifty50");
  assert.equal(asked.length, 1, "only the list that was used is read");
  assert.equal(asked[0].url, `${BASE}ind_nifty50list.csv`);
  assert.doesNotMatch(asked[0].ua, /Mozilla|Chrome|Safari/, "never pretends to be a browser");
  assert.equal(list.status("nifty50").source, "NSE");
  assert.ok(list.list("nifty50").includes("SYM5"));
  // within the week: not asked again
  list.list("nifty50");
  assert.equal(asked.length, 1);
  // a week later NSE refuses: the last good copy stays, and a refusal is not retried at once
  now += 8 * 86400000;
  answer = { ok: false, status: 403, text: async () => "" };
  list.list("nifty50");
  await list._busy.get("nifty50");
  assert.equal(asked.length, 2);
  assert.ok(list.list("nifty50").includes("SYM5"));
  await list.refresh("nifty50");
  assert.equal(asked.length, 2);
  // an unknown index is nothing, and asks nothing
  assert.deepEqual(list.list("nope"), []);
  assert.equal(list.has("nope"), false);
});

test("with no fetch (tests, simulators) it never reaches out, uses the bundled lists, and the download covers every index", async () => {
  const list = new IndexList({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "vpt-idx-")), fetchImpl: null, log: { log() {} } });
  assert.equal(list.symbols().size, SNAP.indices.nifty500.length, "the RSI search: the Nifty 500");
  const all = list.allSymbols();
  for (const c of CATALOG) for (const s of SNAP.indices[c.id]) assert.ok(all.has(s), `${s} (${c.id}) is downloaded`);
  assert.equal((await list.refresh("nifty50")).source, "snapshot");
  assert.equal(list.catalog().find((c) => c.id === "niftybank").count, SNAP.indices.niftybank.length);
});
