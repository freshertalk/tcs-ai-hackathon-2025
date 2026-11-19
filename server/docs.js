"use strict";
// Where the server keeps its records: settings and admins, the watchlist, the trading switch
// and audit log, the AI's journal, skills file and reports.
//
// Two interchangeable stores, with the same small, synchronous API:
//   read(name, fallback)   the stored value (JSON, or text for *.md), or the fallback
//   write(name, value)     store a value (replaces it)
//   append(name, entry)    add an entry to a log;  tail(name, n) → the last n, newest last
//   flush()                resolves once every write has reached its store
//   items(name) / putItems(name, list) / removeItems(name, ids)
//                          big lists kept ONE RECORD PER ITEM (each item has an "id"): the trade
//                          journal's fills. A single MongoDB record cannot exceed 16 MB, and years of
//                          trades would. Items are read once at start and served from memory too.
//   coldPut(name, id, value) / coldGet(name, id) / coldList(name) / coldRemove(name, ids)   (all return promises)
//                          BIG records that are NOT kept in memory: the market recorder's sessions (about a megabyte a
//                          day, for ever). They are read one at a time when something needs one; coldList gives their
//                          ids, dates and sizes without their bodies.
//   dump(emit)             every record this store holds, one entry at a time, for a backup (server/vault.js):
//                          { kind: "doc" | "log" | "item" | "cold", name, id?, v }
//
// FileDocs keeps each record as a file under server/data/ (the default, and what tests use).
// MongoDocs keeps them in MongoDB: everything is read once at start-up, served from memory,
// and every change is written through to the database straight away (one record at a time,
// in order). The server runs as ONE process, so memory and the database never disagree.
//
// Caches that can be downloaded again — candles, the instrument list, the screener's data,
// exchange holidays — stay as files either way. So do the two encryption keys: a key kept
// next to the secrets it protects would protect nothing.

const fs = require("fs");
const path = require("path");

/** The records that live here, by name (a path under server/data/ for the file store). */
const RECORDS = ["db.json", "ai/world.json", "ai/news.json", "ai/live.json", "ai/journal.json", "ai/debriefs.json", "ai/coach.json", "ai/research.json", "ai/trading-skills.md", "trading/journal.json", "ai/reviews.json", "market/behaviour.json", "ai/decisions.json", "market/edge.json", "market/signals.json", "market/alerts.json", "research/auto.json"];
const LOGS = { "trading/audit": "trading/audit.jsonl" };
/** Lists kept one record per item (a collection of its own in MongoDB, one file otherwise). */
const COLLECTIONS = ["journal_fills", "analysis_snapshots", "analysis_outcomes", "analysis_learnings", "robot_trades", "robot_days", "robot_study", "robot_history", "open_forecasts", "autopilot_proposals", "horizon_forecasts", "horizon_days", "horizon_learning", "tape_learning"];
/** Big records read one at a time, never held in memory (a collection "cold_<name>" in MongoDB, a folder of files otherwise). */
const COLD = ["market_tape"];
const LOG_KEEP = 2000; // entries of a log kept in memory (the database keeps them all)
const COLD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/;
/** In the file store: what is a cache (downloaded again when missing), a key or a working file — never part of a backup. */
const NOT_RECORDS = [/^backups\//, /^media\//, /^cold\//, /^collections\//, /^market\/candles\//, /^market\/indices\//, /^market\/screener/, /^health\//, /\.key$/, /\.tmp$/, /\.corrupt-\d+$/, /^market\/instruments\.json$/, /^market\/universe\.json$/, /^nfo\.json$/, /^holidays\.json$/, /^last-crash\.json$/];

const isText = (name) => name.endsWith(".md");
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

class FileDocs {
  constructor(dir) {
    this.dir = dir;
    this.kind = "files";
    fs.mkdirSync(dir, { recursive: true });
  }

  _path(name) {
    return path.join(this.dir, ...name.split("/"));
  }

  read(name, fallback = null) {
    const file = this._path(name);
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (_) {
      return fallback;
    }
    if (isText(name)) return text;
    try {
      return JSON.parse(text);
    } catch (_) {
      // a damaged file is never silently replaced: keep a copy beside it
      try {
        fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`);
      } catch (__) {
        /* best effort */
      }
      return fallback;
    }
  }

  write(name, value) {
    const file = this._path(name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, isText(name) ? String(value) : JSON.stringify(value, null, name === "db.json" ? 2 : 0), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  remove(name) {
    try {
      fs.unlinkSync(this._path(name));
    } catch (_) {
      /* already gone */
    }
  }

  append(name, entry) {
    const file = this._path(LOGS[name] || `${name}.jsonl`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  }

  tail(name, n = 100) {
    try {
      const lines = fs.readFileSync(this._path(LOGS[name] || `${name}.jsonl`), "utf8").trim().split("\n").filter(Boolean);
      return lines
        .slice(-n)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch (_) {
            return null;
          }
        })
        .filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  _itemsPath(name) {
    return `collections/${name}.json`;
  }

  items(name) {
    const v = this.read(this._itemsPath(name), null);
    return v && typeof v === "object" ? Object.values(v) : [];
  }

  putItems(name, list) {
    if (!list || !list.length) return;
    const v = this.read(this._itemsPath(name), null) || {};
    for (const it of list) if (it && it.id) v[it.id] = it;
    this.write(this._itemsPath(name), v);
  }

  removeItems(name, ids) {
    const v = this.read(this._itemsPath(name), null);
    if (!v) return;
    for (const id of ids || []) delete v[id];
    this.write(this._itemsPath(name), v);
  }

  /* ---- big records, one file each (cold/<name>/<id>.json): never read unless asked for ---- */
  _coldDir(name) {
    return path.join(this.dir, "cold", name);
  }

  async coldPut(name, id, value) {
    if (!COLD_ID.test(String(id))) throw new Error("That is not a valid record id.");
    const dir = this._coldDir(name);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${id}.json`);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ id: String(id), at: new Date().toISOString(), v: value }), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  async coldGet(name, id) {
    if (!COLD_ID.test(String(id))) return null;
    try {
      return JSON.parse(fs.readFileSync(path.join(this._coldDir(name), `${id}.json`), "utf8")).v;
    } catch (_) {
      return null;
    }
  }

  async coldList(name) {
    let files = [];
    try {
      files = fs.readdirSync(this._coldDir(name)).filter((f) => f.endsWith(".json"));
    } catch (_) {
      return [];
    }
    return files
      .map((f) => {
        const st = fs.statSync(path.join(this._coldDir(name), f));
        return { id: f.slice(0, -5), bytes: st.size, at: st.mtime.toISOString() };
      })
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  async coldRemove(name, ids) {
    for (const id of ids || []) {
      if (!COLD_ID.test(String(id))) continue;
      try {
        fs.unlinkSync(path.join(this._coldDir(name), `${id}.json`));
      } catch (_) {
        /* already gone */
      }
    }
  }

  /** Every record kept here, one entry at a time (caches, keys, media and backups are not records). `light`: documents and logs only. */
  async dump(emit, { light = false } = {}) {
    const walk = (rel) => {
      let names = [];
      try {
        names = fs.readdirSync(path.join(this.dir, rel), { withFileTypes: true });
      } catch (_) {
        return [];
      }
      const out = [];
      for (const d of names) {
        const p = rel ? `${rel}/${d.name}` : d.name;
        if (NOT_RECORDS.some((re) => re.test(d.isDirectory() ? `${p}/` : p))) continue;
        if (d.isDirectory()) out.push(...walk(p));
        else out.push(p);
      }
      return out;
    };
    for (const p of walk("").sort()) {
      if (p.endsWith(".jsonl")) {
        const name = Object.keys(LOGS).find((k) => LOGS[k] === p) || p.slice(0, -6);
        for (const v of this.tail(name, 1e9)) await emit({ kind: "log", name, v });
      } else if (p.endsWith(".json") || p.endsWith(".md")) {
        const v = this.read(p, undefined);
        if (v !== undefined && v !== null) await emit({ kind: "doc", name: p, v });
      }
    }
    if (light) return;
    let cols = [];
    try {
      cols = fs.readdirSync(path.join(this.dir, "collections")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
    } catch (_) {
      cols = [];
    }
    for (const name of cols.sort()) for (const v of this.items(name)) await emit({ kind: "item", name, v });
    let cold = [];
    try {
      cold = fs.readdirSync(path.join(this.dir, "cold"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch (_) {
      cold = [];
    }
    for (const name of cold.sort()) for (const r of await this.coldList(name)) await emit({ kind: "cold", name, id: r.id, v: await this.coldGet(name, r.id) });
  }

  flush() {
    return Promise.resolve();
  }

  close() {
    return Promise.resolve();
  }
}

class MongoDocs {
  /**
   * @param db   a connected MongoDB database (or anything with the same collection API)
   * @param dir  server/data/: files found there are imported the first time
   */
  constructor({ db, client = null, dir, log = console }) {
    this.db = db;
    this.client = client;
    this.dir = dir;
    this.log = log;
    this.kind = "mongodb";
    this.docs = db.collection("docs"); // { _id: name, v: value, at }
    this.logs = db.collection("logs"); // { log: name, at, v }
    this._cache = new Map();
    this._tails = new Map();
    this._items = new Map(); // collection name → Map(id → item), read at start
    this._chain = new Map(); // name → the last write in flight: writes to one record stay in order
    this._pending = new Set();
    this.lastError = "";
  }

  /** Connect, read everything into memory, and import any records still only on disk. */
  static async open({ uri, dbName = "stock-trading", dir, log = console, MongoClient }) {
    const Client = MongoClient || require("mongodb").MongoClient;
    const client = new Client(uri, { serverSelectionTimeoutMS: 10000, appName: "vinaytiwari-desk" });
    await client.connect();
    const docs = new MongoDocs({ db: client.db(dbName), client, dir, log });
    await docs.load();
    return docs;
  }

  async load() {
    for (const d of await this.docs.find({}).toArray()) this._cache.set(d._id, d.v);
    for (const name of COLLECTIONS) {
      const rows = await this.db.collection(name).find({}).toArray();
      this._items.set(name, new Map(rows.map((r) => {
        const { _id, ...rest } = r;
        return [String(_id), { ...rest, id: rest.id || String(_id) }];
      })));
    }
    for (const name of Object.keys(LOGS)) {
      const rows = await this.logs.find({ log: name }).sort({ at: -1, _id: -1 }).limit(LOG_KEEP).toArray();
      this._tails.set(name, rows.reverse().map((r) => r.v));
    }
    await this._import();
    await this.logs.createIndex({ log: 1, at: -1 }).catch(() => {});
  }

  /** First start on MongoDB: bring over what the file store holds, record by record. */
  async _import() {
    if (!this.dir) return;
    const files = new FileDocs(this.dir);
    const moved = [];
    for (const name of RECORDS) {
      if (this._cache.has(name)) continue;
      const v = files.read(name, undefined);
      if (v === undefined || v === null) continue;
      await this.docs.updateOne({ _id: name }, { $set: { v, at: new Date() } }, { upsert: true });
      this._cache.set(name, v);
      moved.push(name);
    }
    for (const name of Object.keys(LOGS)) {
      if ((this._tails.get(name) || []).length) continue;
      const rows = files.tail(name, 1e9);
      if (!rows.length) continue;
      await this.logs.insertMany(rows.map((v) => ({ log: name, at: v && v.at ? new Date(v.at) : new Date(), v })));
      this._tails.set(name, rows.slice(-LOG_KEEP));
      moved.push(`${name} (${rows.length})`);
    }
    if (moved.length) this.log.log(`[db] imported from ${this.dir}: ${moved.join(", ")}`);
  }

  read(name, fallback = null) {
    return this._cache.has(name) ? clone(this._cache.get(name)) : fallback;
  }

  _queue(name, job) {
    const before = this._chain.get(name) || Promise.resolve();
    const p = before.then(job).catch((err) => {
      this.lastError = `${new Date().toISOString()} ${name}: ${err.message}`;
      this.log.error(`[db] could not save ${name}: ${err.message}`);
    });
    this._chain.set(name, p);
    this._pending.add(p);
    p.finally(() => {
      this._pending.delete(p);
      if (this._chain.get(name) === p) this._chain.delete(name);
    });
    return p;
  }

  write(name, value) {
    const v = clone(value);
    this._cache.set(name, v);
    this._queue(name, () => this.docs.updateOne({ _id: name }, { $set: { v, at: new Date() } }, { upsert: true }));
  }

  remove(name) {
    this._cache.delete(name);
    this._queue(name, () => this.docs.deleteOne({ _id: name }));
  }

  append(name, entry) {
    const v = clone(entry);
    const t = this._tails.get(name) || [];
    t.push(v);
    if (t.length > LOG_KEEP) t.splice(0, t.length - LOG_KEEP);
    this._tails.set(name, t);
    this._queue(`log:${name}`, () => this.logs.insertOne({ log: name, at: v && v.at ? new Date(v.at) : new Date(), v }));
  }

  tail(name, n = 100) {
    return clone((this._tails.get(name) || []).slice(-n));
  }

  /** Every item of a collection, from memory (the objects themselves: read them, do not change them). */
  items(name) {
    return [...(this._items.get(name) || new Map()).values()];
  }

  /** Add or replace items (by id): in memory at once, and in the database in batches of 1,000, in order. */
  putItems(name, list) {
    if (!list || !list.length) return;
    let m = this._items.get(name);
    if (!m) {
      m = new Map();
      this._items.set(name, m);
    }
    const clean = list.filter((it) => it && it.id).map(clone);
    for (const it of clean) m.set(String(it.id), it);
    const col = this.db.collection(name);
    for (let i = 0; i < clean.length; i += 1000) {
      const chunk = clean.slice(i, i + 1000);
      this._queue(`col:${name}`, async () => {
        if (typeof col.bulkWrite === "function") await col.bulkWrite(chunk.map((it) => ({ replaceOne: { filter: { _id: String(it.id) }, replacement: { ...it, _id: String(it.id) }, upsert: true } })), { ordered: false });
        else for (const it of chunk) await col.updateOne({ _id: String(it.id) }, { $set: it }, { upsert: true });
      });
    }
  }

  removeItems(name, ids) {
    const m = this._items.get(name);
    const list = (ids || []).map(String);
    if (m) for (const id of list) m.delete(id);
    if (list.length) this._queue(`col:${name}`, () => this.db.collection(name).deleteMany({ _id: { $in: list } }));
  }

  /* ---- big records, one database record each (collection cold_<name>): read only when asked for ---- */
  _cold(name) {
    return this.db.collection(`cold_${name}`);
  }

  coldPut(name, id, value) {
    if (!COLD_ID.test(String(id))) return Promise.reject(new Error("That is not a valid record id."));
    const v = clone(value);
    const bytes = Buffer.byteLength(JSON.stringify(v));
    return this._queue(`cold:${name}:${id}`, () => this._cold(name).updateOne({ _id: String(id) }, { $set: { v, at: new Date(), bytes } }, { upsert: true }));
  }

  async coldGet(name, id) {
    if (!COLD_ID.test(String(id))) return null;
    await (this._chain.get(`cold:${name}:${id}`) || Promise.resolve()); // a write still on its way lands first
    const rows = await this._cold(name).find({ _id: String(id) }).limit(1).toArray();
    return rows.length ? rows[0].v : null;
  }

  async coldList(name) {
    const rows = await this._cold(name).find({}, { projection: { v: 0 } }).toArray();
    return rows
      .map((r) => ({ id: String(r._id), bytes: r.bytes || (r.v ? Buffer.byteLength(JSON.stringify(r.v)) : 0), at: r.at ? new Date(r.at).toISOString() : null }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  async coldRemove(name, ids) {
    const col = this._cold(name);
    for (const id of (ids || []).map(String)) await this._queue(`cold:${name}:${id}`, () => col.deleteOne({ _id: id }));
  }

  /** Every record kept here, one entry at a time: the documents, the whole of each log, every list and every big record. `light`: documents and logs only. */
  async dump(emit, { light = false } = {}) {
    await this.flush();
    for (const name of [...this._cache.keys()].sort()) await emit({ kind: "doc", name, v: this._cache.get(name) });
    for (const name of Object.keys(LOGS)) {
      const rows = await this.logs.find({ log: name }).sort({ at: 1, _id: 1 }).toArray();
      for (const r of rows) await emit({ kind: "log", name, v: r.v });
    }
    if (light) return;
    for (const name of [...this._items.keys()].sort()) for (const v of this._items.get(name).values()) await emit({ kind: "item", name, v });
    for (const name of COLD) for (const r of await this.coldList(name)) await emit({ kind: "cold", name, id: r.id, v: await this.coldGet(name, r.id) });
  }

  async flush() {
    while (this._pending.size) await Promise.all([...this._pending]);
  }

  async close() {
    await this.flush();
    if (this.client) await this.client.close();
  }
}

/** The store to use: MongoDB when MONGO_URI is set, files otherwise. */
async function openDocs({ env = process.env, dir, log = console } = {}) {
  if (!env.MONGO_URI) return new FileDocs(dir);
  const docs = await MongoDocs.open({ uri: env.MONGO_URI, dbName: env.MONGO_DB || "stock-trading", dir, log });
  log.log(`[db] using MongoDB database "${env.MONGO_DB || "stock-trading"}"`);
  return docs;
}

module.exports = { FileDocs, MongoDocs, openDocs, RECORDS, LOGS, COLLECTIONS, COLD };
