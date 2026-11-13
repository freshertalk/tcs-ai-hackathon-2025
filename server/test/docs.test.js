"use strict";
// The record store: files, and MongoDB (against an in-memory stand-in with the driver's
// collection API, so the tests need no database server).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { FileDocs, MongoDocs, openDocs } = require("../docs");
const { Store } = require("../store");
const { TradingService } = require("../trading/service");

/** A tiny MongoDB stand-in: just the calls server/docs.js makes. Writes are slow on purpose. */
function fakeDb() {
  const cols = new Map();
  const ops = [];
  const later = (v) => new Promise((r) => setTimeout(() => r(v), 5));
  const col = (name) => {
    if (!cols.has(name)) cols.set(name, []);
    const rows = cols.get(name);
    const match = (q) => (r) => Object.entries(q).every(([k, v]) => r[k] === v);
    const cursor = (list) => {
      const c = {
        sort(spec) {
          // every key in turn, as MongoDB does (ties on "at" are broken by _id)
          const keys = Object.entries(spec);
          list = [...list].sort((a, b) => {
            for (const [k, dir] of keys) if (a[k] !== b[k]) return a[k] < b[k] ? -dir : dir;
            return 0;
          });
          return c;
        },
        limit(n) {
          list = list.slice(0, n);
          return c;
        },
        toArray: async () => JSON.parse(JSON.stringify(list)),
      };
      return c;
    };
    return {
      find: (q = {}) => cursor(rows.filter(match(q))),
      async updateOne(q, u, o) {
        ops.push(`update ${name} ${q._id}`);
        await later();
        const r = rows.find(match(q));
        if (r) Object.assign(r, JSON.parse(JSON.stringify(u.$set)));
        else if (o && o.upsert) rows.push({ ...q, ...JSON.parse(JSON.stringify(u.$set)) });
      },
      async deleteOne(q) {
        ops.push(`delete ${name} ${q._id}`);
        await later();
        const i = rows.findIndex(match(q));
        if (i >= 0) rows.splice(i, 1);
      },
      async insertOne(d) {
        ops.push(`insert ${name}`);
        await later();
        rows.push({ _id: rows.length + 1, ...JSON.parse(JSON.stringify(d)) });
      },
      async insertMany(ds) {
        for (const d of ds) rows.push({ _id: rows.length + 1, ...JSON.parse(JSON.stringify(d)) });
      },
      createIndex: async () => "ok",
    };
  };
  return { db: { collection: col }, rows: (name) => cols.get(name) || [], ops };
}
const quiet = { log() {}, error() {} };
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test("file store: JSON and text records, logs, and a damaged file kept aside", () => {
  const dir = tmp("vpt-docs-f-");
  const d = new FileDocs(dir);
  assert.equal(d.read("ai/coach.json", "none"), "none");
  d.write("ai/coach.json", [{ a: 1 }]);
  d.write("ai/trading-skills.md", "# rules\n");
  assert.deepEqual(d.read("ai/coach.json"), [{ a: 1 }]);
  assert.equal(d.read("ai/trading-skills.md"), "# rules\n");
  d.append("trading/audit", { at: "2026-11-12T05:00:00Z", action: "a" });
  d.append("trading/audit", { at: "2026-11-12T05:01:00Z", action: "b" });
  assert.deepEqual(d.tail("trading/audit", 1).map((x) => x.action), ["b"]);
  assert.ok(fs.existsSync(path.join(dir, "trading", "audit.jsonl")), "the same file as before");
  fs.writeFileSync(path.join(dir, "db.json"), "{ not json");
  assert.equal(d.read("db.json", null), null);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith("db.json.corrupt-")));
});

test("MongoDB store: imports the files once, serves from memory, writes through in order", async () => {
  const dir = tmp("vpt-docs-m-");
  const files = new FileDocs(dir);
  files.write("db.json", { settings: { googleClientId: "x" }, admins: [{ email: "a@b.c" }] });
  files.write("ai/trading-skills.md", "# my rules\n");
  files.append("trading/audit", { at: "2026-11-12T05:00:00Z", action: "switch-on" });
  const fake = fakeDb();

  const m = new MongoDocs({ db: fake.db, dir, log: quiet });
  await m.load();
  assert.equal(m.read("db.json").admins[0].email, "a@b.c", "imported from the file");
  assert.equal(m.read("ai/trading-skills.md"), "# my rules\n");
  assert.equal(m.tail("trading/audit")[0].action, "switch-on");
  assert.equal(fake.rows("docs").length, 2);

  // reads come from memory at once; writes land in order, and flush() waits for them
  m.write("ai/coach.json", [1]);
  m.write("ai/coach.json", [1, 2]);
  m.append("trading/audit", { at: "2026-11-12T06:00:00Z", action: "place" });
  assert.deepEqual(m.read("ai/coach.json"), [1, 2]);
  const v = m.read("ai/coach.json");
  v.push(99);
  assert.deepEqual(m.read("ai/coach.json"), [1, 2], "a caller cannot change the store by editing what it read");
  await m.flush();
  assert.deepEqual(fake.rows("docs").find((r) => r._id === "ai/coach.json").v, [1, 2]);
  m.remove("ai/trading-skills.md");
  await m.flush();

  // a restart reads it all back from the database — and does not import the files again
  fs.rmSync(dir, { recursive: true, force: true });
  const again = new MongoDocs({ db: fake.db, dir: tmp("vpt-docs-m2-"), log: quiet });
  await again.load();
  assert.deepEqual(again.read("ai/coach.json"), [1, 2]);
  assert.equal(again.read("ai/trading-skills.md", "gone"), "gone");
  assert.deepEqual(again.tail("trading/audit").map((x) => x.action), ["switch-on", "place"]);
});

test("a failed database write is logged, kept in memory, and does not stop later writes", async () => {
  const fake = fakeDb();
  const col = fake.db.collection("docs");
  let fail = true;
  const real = col.updateOne;
  col.updateOne = async (...a) => {
    if (fail) {
      fail = false;
      throw new Error("connection reset");
    }
    return real(...a);
  };
  const db = { collection: (n) => (n === "docs" ? col : fake.db.collection(n)) };
  const errors = [];
  const m = new MongoDocs({ db, log: { log() {}, error: (e) => errors.push(e) } });
  await m.load();
  m.write("ai/news.json", { a: 1 });
  m.write("ai/news.json", { a: 2 });
  await m.flush();
  assert.match(errors[0], /connection reset/);
  assert.match(m.lastError, /ai\/news.json/);
  assert.deepEqual(m.read("ai/news.json"), { a: 2 });
  assert.deepEqual(fake.rows("docs").find((r) => r._id === "ai/news.json").v, { a: 2 });
});

test("the trading switch, limits and audit log live in the database across a restart", async () => {
  const fake = fakeDb();
  const dir = tmp("vpt-docs-t-");
  const market = { ticker: null, kiteState: () => ({ connected: false }), kiteAuth: () => null };
  const m1 = new MongoDocs({ db: fake.db, dir, log: quiet });
  await m1.load();
  const t1 = new TradingService({ dir, store: new Store(dir, m1), market, docs: m1, log: quiet });
  t1.setSwitch(true, "me");
  t1.setLimits({ maxQty: 300, maxValue: 90000 }, "me");
  await m1.flush();
  assert.ok(!fs.existsSync(path.join(dir, "db.json")), "nothing written to files");

  const m2 = new MongoDocs({ db: fake.db, dir, log: quiet });
  await m2.load();
  const t2 = new TradingService({ dir, store: new Store(dir, m2), market, docs: m2, log: quiet });
  assert.equal(t2.status().enabled, true);
  assert.deepEqual(t2.status().limits, { maxQty: 300, maxValue: 90000 });
  assert.deepEqual(t2.audit().map((a) => a.action), ["limits", "switch-on"]);
});

test("without MONGO_URI the server keeps using files", async () => {
  const d = await openDocs({ env: {}, dir: tmp("vpt-docs-o-"), log: quiet });
  assert.equal(d.kind, "files");
});
