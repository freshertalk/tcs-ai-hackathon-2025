"use strict";
// Where the server keeps its records: settings and admins, the watchlist, the trading switch
// and audit log, the AI's journal, skills file and reports.
//
// Two interchangeable stores, with the same small, synchronous API:
//   read(name, fallback)   the stored value (JSON, or text for *.md), or the fallback
//   write(name, value)     store a value (replaces it)
//   append(name, entry)    add an entry to a log;  tail(name, n) → the last n, newest last
//   flush()                resolves once every write has reached its store
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
const RECORDS = ["db.json", "ai/world.json", "ai/news.json", "ai/live.json", "ai/journal.json", "ai/debriefs.json", "ai/coach.json", "ai/research.json", "ai/trading-skills.md"];
const LOGS = { "trading/audit": "trading/audit.jsonl" };
const LOG_KEEP = 2000; // entries of a log kept in memory (the database keeps them all)

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

module.exports = { FileDocs, MongoDocs, openDocs, RECORDS, LOGS };
