"use strict";
// The vault: the store's cold shelf and dump (files and MongoDB), a backup of everything, a restore that changes nothing
// when the file is cut short, the downloads, and the automatic backup's rules.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");

const { FileDocs, MongoDocs } = require("../docs");
const { Vault, restore, inspect, toCsv, FILE_RE } = require("../vault");
const { pack } = require("../robot/history");
const { main: restoreCli } = require("../restore");

const quiet = { log() {}, error() {} };
const tmp = (p = "vpt-vault-") => fs.mkdtempSync(path.join(os.tmpdir(), p));

/** The same small MongoDB stand-in as docs.test.js, with the two calls the cold shelf adds. */
function fakeDb() {
  const cols = new Map();
  const col = (name) => {
    if (!cols.has(name)) cols.set(name, []);
    const rows = cols.get(name);
    const match = (q) => (r) => Object.entries(q).every(([k, v]) => r[k] === v);
    const cursor = (list) => {
      const c = {
        sort(spec) {
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
        const r = rows.find(match(q));
        if (r) Object.assign(r, JSON.parse(JSON.stringify(u.$set)));
        else if (o && o.upsert) rows.push({ ...q, ...JSON.parse(JSON.stringify(u.$set)) });
      },
      async deleteOne(q) {
        const i = rows.findIndex(match(q));
        if (i >= 0) rows.splice(i, 1);
      },
      async deleteMany() {},
      async insertOne(d) {
        rows.push({ _id: rows.length + 1, ...JSON.parse(JSON.stringify(d)) });
      },
      async insertMany(ds) {
        for (const d of ds) rows.push({ _id: rows.length + 1, ...JSON.parse(JSON.stringify(d)) });
      },
      createIndex: async () => "ok",
    };
  };
  return { db: { collection: col }, rows: (name) => cols.get(name) || [] };
}

function fill(docs) {
  docs.write("db.json", {
    settings: { kiteApiSecretEnc: "enc:abc" },
    admins: [{ email: "a@b.c" }],
  });
  docs.write("market/horizon-model.json", { version: 2, W: [[1, 2]] });
  docs.write("ai/trading-skills.md", "# rules\n- cut losses\n");
  docs.append("trading/audit", {
    at: "2026-11-18T05:00:00Z",
    action: "switch-on",
  });
  docs.append("trading/audit", { at: "2026-11-18T05:01:00Z", action: "place" });
  docs.putItems("horizon_forecasts", [
    {
      id: "f1",
      symbol: "INFY",
      horizons: { 3: { price: 1500, pUp: 0.6 } },
      tags: ["a", "b"],
    },
    { id: "f2", symbol: "TCS", note: 'said "wait", then went' },
  ]);
  docs.putItems("robot_history", [
    {
      id: "INFY",
      symbol: "INFY",
      ...pack([
        {
          t: Date.parse("2026-11-18T09:15:00+05:30"),
          o: 1,
          h: 2,
          l: 0.5,
          c: 1.5,
          v: 10,
        },
        {
          t: Date.parse("2026-11-18T09:20:00+05:30"),
          o: 1.5,
          h: 2,
          l: 1,
          c: 1.8,
          v: 20,
        },
      ]),
    },
  ]);
}

test("the cold shelf and the dump: files", async () => {
  const dir = tmp();
  const d = new FileDocs(dir);
  fill(d);
  await d.coldPut("market_tape", "2026-11-18", {
    date: "2026-11-18",
    z: "abc",
  });
  await d.coldPut("market_tape", "2026-11-19", {
    date: "2026-11-19",
    z: "defg",
  });
  assert.deepEqual(
    (await d.coldList("market_tape")).map((r) => r.id),
    ["2026-11-18", "2026-11-19"],
  );
  assert.equal((await d.coldGet("market_tape", "2026-11-19")).z, "defg");
  assert.equal(await d.coldGet("market_tape", "../../db"), null, "an id is never a path");
  await assert.rejects(() => d.coldPut("market_tape", "../x", {}));
  // caches, keys and media are not records
  fs.writeFileSync(path.join(dir, "settings.key"), "secret");
  fs.mkdirSync(path.join(dir, "market", "candles"), { recursive: true });
  fs.writeFileSync(path.join(dir, "market", "candles", "INFY.json"), "[1]");
  fs.writeFileSync(path.join(dir, "market", "instruments.json"), "[1]");
  const seen = [];
  await d.dump(async (e) => seen.push(`${e.kind}:${e.name}${e.id ? `:${e.id}` : ""}`));
  assert.deepEqual(seen.filter((x) => x.startsWith("doc:")).sort(), ["doc:ai/trading-skills.md", "doc:db.json", "doc:market/horizon-model.json"]);
  assert.equal(seen.filter((x) => x === "log:trading/audit").length, 2);
  assert.equal(seen.filter((x) => x.startsWith("item:")).length, 3);
  assert.deepEqual(
    seen.filter((x) => x.startsWith("cold:")),
    ["cold:market_tape:2026-11-18", "cold:market_tape:2026-11-19"],
  );
  const light = [];
  await d.dump(async (e) => light.push(e.kind), { light: true });
  assert.ok(!light.includes("item") && !light.includes("cold"));
  await d.coldRemove("market_tape", ["2026-11-18"]);
  assert.equal((await d.coldList("market_tape")).length, 1);
});

test("the cold shelf and the dump: MongoDB (the big records are not kept in memory)", async () => {
  const fake = fakeDb();
  const m = new MongoDocs({ db: fake.db, dir: null, log: quiet });
  await m.load();
  fill(m);
  await m.coldPut("market_tape", "2026-11-19", {
    date: "2026-11-19",
    z: "defg",
  });
  assert.equal(fake.rows("cold_market_tape").length, 1);
  assert.ok(!m._items.has("market_tape") && !m._cache.has("market_tape"), "not in memory");
  assert.equal((await m.coldGet("market_tape", "2026-11-19")).z, "defg");
  const l = await m.coldList("market_tape");
  assert.equal(l[0].id, "2026-11-19");
  assert.ok(l[0].bytes > 10);
  const seen = [];
  await m.dump(async (e) => seen.push(e.kind));
  assert.deepEqual([...new Set(seen)].sort(), ["cold", "doc", "item", "log"]);
  assert.equal(seen.filter((k) => k === "log").length, 2, "the whole log, not only what memory keeps");
  await m.coldRemove("market_tape", ["2026-11-19"]);
  assert.equal(await m.coldGet("market_tape", "2026-11-19"), null);
});

test("a backup holds everything; a restore puts it back, and a file cut short changes nothing", async () => {
  const dir = tmp();
  const docs = new FileDocs(dir);
  fill(docs);
  await docs.coldPut("market_tape", "2026-11-19", {
    date: "2026-11-19",
    z: "defg",
  });
  let now = Date.parse("2026-11-19T16:30:00+05:30");
  const vault = new Vault({ docs, dataDir: dir, now: () => now, log: quiet });
  assert.equal(vault.due(), "no backup has been made yet");
  const b = await vault.backup({ trigger: "test" });
  assert.match(b.file, FILE_RE);
  assert.equal(b.file, "drishtiai-backup-2026-11-19-163000.ndjson.gz");
  assert.deepEqual(b.counts, { doc: 3, log: 2, item: 3, cold: 1 });
  assert.equal(vault.due(), "");
  const file = vault.pathOf(b.file);
  assert.ok(file && fs.statSync(file).size === b.bytes);
  assert.equal(vault.pathOf("../db.json"), null);
  assert.equal(vault.pathOf("drishtiai-backup-2026-11-19-999999.ndjson.gz"), null);
  // a backup is not itself backed up, and the key is never in one
  fs.writeFileSync(path.join(dir, "settings.key"), "the-key");
  now += 60000;
  const b2 = await vault.backup({ trigger: "test" });
  const text = zlib.gunzipSync(fs.readFileSync(vault.pathOf(b2.file))).toString("utf8");
  assert.ok(!text.includes("the-key") && !text.includes("drishtiai-backup"));
  assert.deepEqual(JSON.parse(text.trim().split("\n").pop()), {
    kind: "end",
    counts: b.counts,
  });

  // restore into an empty store (files, then MongoDB): the same records
  const seen = await inspect(file);
  assert.equal(seen.whole, true);
  assert.deepEqual(seen.names.item, ["horizon_forecasts", "robot_history"]);
  const into = new FileDocs(tmp());
  const dry = await restore(file, into, { dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal(into.read("db.json", null), null, "a dry run changes nothing");
  const r = await restore(file, into);
  assert.deepEqual(r.done, {
    doc: 3,
    log: 2,
    item: 3,
    cold: 1,
    skippedLogs: [],
  });
  assert.deepEqual(into.read("market/horizon-model.json"), {
    version: 2,
    W: [[1, 2]],
  });
  assert.equal(into.read("ai/trading-skills.md"), "# rules\n- cut losses\n");
  assert.deepEqual(
    into.tail("trading/audit").map((x) => x.action),
    ["switch-on", "place"],
  );
  assert.equal(into.items("horizon_forecasts").length, 2);
  assert.equal((await into.coldGet("market_tape", "2026-11-19")).z, "defg");
  // again: nothing is doubled (a log is only restored into an empty one)
  const again = await restore(file, into);
  assert.deepEqual(again.done.skippedLogs, ["trading/audit"]);
  assert.equal(into.tail("trading/audit").length, 2);
  assert.equal(into.items("horizon_forecasts").length, 2);
  const fake = fakeDb();
  const mongo = new MongoDocs({ db: fake.db, dir: null, log: quiet });
  await mongo.load();
  await restore(file, mongo, { only: ["doc", "cold"] });
  assert.equal(mongo.read("db.json").admins[0].email, "a@b.c");
  assert.equal(mongo.items("horizon_forecasts").length, 0, "only what was asked for");
  assert.equal(fake.rows("cold_market_tape").length, 1);

  // a file cut short: refused, and the store is untouched
  const cut = path.join(tmp(), "cut.ndjson.gz");
  const lines = text.trim().split("\n");
  fs.writeFileSync(cut, zlib.gzipSync(`${lines.slice(0, -2).join("\n")}\n`));
  const empty = new FileDocs(tmp());
  await assert.rejects(() => restore(cut, empty), /incomplete/);
  assert.equal(empty.read("db.json", null), null);
  // the command line: a dry run by default reports and changes nothing
  const out = [];
  const log = console.log;
  console.log = (...a) => out.push(a.join(" "));
  try {
    assert.equal(await restoreCli([file, "--dry-run"]), 0);
    assert.equal(await restoreCli([file]), 0, "without --yes nothing happens");
    assert.equal(await restoreCli([]), 2);
  } finally {
    console.log = log;
  }
  assert.match(out.join("\n"), /3 records, 3 list items in 2 lists, 1 recorded sessions, 2 log entries/);
  assert.match(out.join("\n"), /Dry run: nothing was changed/);

  // the newest few are kept; one a day by itself; a switch turns that off
  assert.equal(vault.list().length, 2);
  now += 21 * 3600000;
  assert.match(vault.due(), /the newest backup is from/);
  vault.setSettings({ keep: 1 });
  assert.equal(vault.list().length, 1, "the older one was removed at once");
  vault.setSettings({ auto: false });
  assert.equal(vault.due(), "");
  assert.deepEqual(vault.settings(), { auto: false, keep: 1 });
  vault.setSettings({ keep: 99 });
  assert.equal(vault.settings().keep, 1, "an absurd number is ignored");
  assert.equal(vault.remove(vault.list()[0].file), true);
  assert.equal(vault.list().length, 0);
});

test("the downloads: every dataset is listed; lists as CSV and JSON; the accounts record is never served alone", async () => {
  const dir = tmp();
  const docs = new FileDocs(dir);
  fill(docs);
  const recorder = {
    status: () => ({
      what: "every minute",
      stored: { sessions: 2, kb: 1800 },
      days: [
        { date: "2026-11-19", taken: 376, kb: 900 },
        { date: "2026-11-18", taken: 370, kb: 900 },
      ],
    }),
  };
  const vault = new Vault({ docs, dataDir: dir, recorder, log: quiet });
  const groups = await vault.datasets();
  const all = groups.flatMap((g) => g.items);
  assert.deepEqual(
    groups.map((g) => g.group),
    ["Recorded market data", "The learning brain", "Forecasts and their scores", "Trading records", "Other records"],
  );
  const tape = all.find((x) => x.id === "tape");
  assert.equal(tape.rows, 2);
  assert.equal(tape.days[0].href, "/api/admin/vault/tape/2026-11-19");
  const hist = all.find((x) => x.id === "robot_history");
  assert.equal(hist.rows, 2);
  assert.deepEqual(hist.stocks, ["INFY"]);
  const fc = all.find((x) => x.id === "horizon_forecasts");
  assert.equal(fc.rows, 2);
  assert.deepEqual(
    fc.links.map((l) => l.label),
    ["CSV", "JSON"],
  );
  assert.equal(all.find((x) => x.id === "open_forecasts").links.length, 0, "an empty list has nothing to download");
  assert.ok(all.find((x) => x.id === "doc:market/horizon-model.json"));
  assert.ok(all.find((x) => x.id === "doc:ai/trading-skills.md").links[0].label === "Text");
  assert.equal(all.find((x) => x.id === "log:trading/audit").rows, 2);
  assert.ok(!all.some((x) => /db\.json/.test(x.id)), "the accounts and settings are only in a full backup");
  assert.equal(vault.doc("db.json"), null);
  assert.equal(vault.doc("../settings.key"), null);
  assert.equal(vault.doc("market/horizon-model.json").type, "application/json; charset=utf-8");
  assert.equal(vault.doc("ai/trading-skills.md").body, "# rules\n- cut losses\n");
  assert.equal(vault.items("Not A Name"), null);
  // CSV: nested records become columns, lists stay whole in one cell, quotes are doubled
  const csv = vault.collectionCsv("horizon_forecasts").trim().split("\n");
  assert.equal(csv[0], "id,symbol,horizons.3.price,horizons.3.pUp,tags,note");
  assert.equal(csv[1], 'f1,INFY,1500,0.6,"[""a"",""b""]",');
  assert.equal(csv[2], 'f2,TCS,,,,"said ""wait"", then went"');
  assert.equal(toCsv([]), "\n");
  assert.equal(vault.collectionCsv("robot_history"), null, "the price history has its own downloads");
  assert.deepEqual(vault.historySymbols(), ["INFY"]);
  assert.equal(vault.historyCsv("INFY"), "symbol,date,time,open,high,low,close,volume\nINFY,2026-11-18,09:15,1,2,0.5,1.5,10\nINFY,2026-11-18,09:20,1.5,2,1,1.8,20\n");
  assert.equal(vault.historyCsv("NOPE"), null);
  assert.equal(vault.log_("trading/audit").split("\n").length, 2);
  assert.equal(vault.log_("anything/else"), null);
});
