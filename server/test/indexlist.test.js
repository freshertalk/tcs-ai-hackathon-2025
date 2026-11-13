"use strict";
// The screener's scope: the Nifty 100, read from NSE's published list, kept when NSE is unreachable.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { IndexList, parseIndexCsv, SNAPSHOT, URL_N100 } = require("../market/indexlist");

const csv = (n, extra = "") => ["Company Name,Industry,Symbol,Series,ISIN Code", ...Array.from({ length: n }, (_, i) => `Co ${i},X,SYM${i},EQ,INE${i}`), extra].filter(Boolean).join("\r\n");

test("NSE's CSV is read by its Symbol column, EQ series only, and must look like the Nifty 100", () => {
  const s = parseIndexCsv(csv(100, "M and M Ltd,Auto,M&M,EQ,INE101") + "\r\nBond,X,GSEC1,GS,INE999");
  assert.equal(s.length, 101);
  assert.ok(s.includes("M&M"));
  assert.ok(!s.includes("GSEC1"));
  assert.throws(() => parseIndexCsv(csv(20)), /not the Nifty 100/);
  assert.throws(() => parseIndexCsv("<html>blocked</html>"), /Symbol|empty/);
  assert.equal(SNAPSHOT.symbols.length, 100);
  assert.ok(SNAPSHOT.symbols.includes("RELIANCE") && SNAPSHOT.symbols.includes("BAJAJ-AUTO"));
});

test("a weekly re-read from NSE, an honest User-Agent, and the last copy kept when it fails", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-idx-"));
  let now = Date.parse("2026-11-13T05:00:00Z");
  const asked = [];
  let answer = { ok: true, status: 200, text: async () => csv(100) };
  const list = new IndexList({ dir, now: () => now, log: { log() {} }, fetchImpl: async (url, init) => (asked.push({ url, ua: init.headers["User-Agent"] }), answer) });
  assert.equal(list.status().source, "snapshot");
  assert.ok(list.symbols().has("RELIANCE"), "the bundled copy until NSE has been read");
  await list._busy;
  assert.equal(asked.length, 1);
  assert.equal(asked[0].url, URL_N100);
  assert.doesNotMatch(asked[0].ua, /Mozilla|Chrome|Safari/, "never pretends to be a browser");
  assert.equal(list.status().source, "NSE");
  assert.ok(list.symbols().has("SYM5"));
  // within the week: not asked again
  list.symbols();
  assert.equal(asked.length, 1);
  // a week later NSE refuses: the last good copy stays
  now += 8 * 86400000;
  answer = { ok: false, status: 403, text: async () => "" };
  list.symbols();
  await list._busy;
  assert.equal(asked.length, 2);
  assert.ok(list.symbols().has("SYM5"));
  // and a refusal is not retried at once
  await list.refresh();
  assert.equal(asked.length, 2);
});

test("with no fetch (tests, simulators) it never reaches out, and uses the bundled list", async () => {
  const list = new IndexList({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "vpt-idx-")), fetchImpl: null, log: { log() {} } });
  assert.equal(list.symbols().size, 100);
  assert.equal((await list.refresh()).source, "snapshot");
});
