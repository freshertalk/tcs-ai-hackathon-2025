"use strict";
// The tradebook files you upload to the Journal, kept exactly as they came, so every column of
// every file stays in the database for later analysis (and can be downloaded or read again).
//
//   - MongoDB (production): one document per file in the "journal_files" collection (the bytes, up to
//     15 MB a file, with what the import found).
//   - Files otherwise: server/data/journal-files/<id> plus a small index record.
// A file is known by the SHA-256 of its bytes: the same file uploaded twice is kept once.
//
// Big files arrive in parts of up to 2 MB (each part stays under the web server's request limit):
// start → parts in order → finish. Parts wait in memory for at most 30 minutes.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const INDEX = "trading/journal-files.json";
const MAX_FILE = 15 * 1024 * 1024;
const PART = 2 * 1024 * 1024;
const MAX_PART = 2.5 * 1024 * 1024;
const PENDING_MS = 30 * 60 * 1000;
const ID_RE = /^[a-f0-9]{16}$/;

class UploadError extends Error {
  constructor(message, code = "invalid", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const typeOf = (name, buf) => (buf && buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50 ? "xlsx" : /\.xlsx$/i.test(name || "") ? "xlsx" : "csv");

class JournalFiles {
  constructor(docs, { now = () => Date.now() } = {}) {
    this.docs = docs;
    this.now = now;
    this.col = docs && docs.kind === "mongodb" && docs.db ? docs.db.collection("journal_files") : null;
    this.dir = docs && docs.dir ? path.join(docs.dir, "journal-files") : null;
    this.pending = new Map(); // upload id → { name, size, parts: [Buffer], got, at }
  }

  /* ------------------------------------------------------------------ chunked upload */
  start({ name, size } = {}) {
    const n = String(name || "").replace(/[\\/\r\n\t]/g, " ").trim().slice(0, 120);
    const bytes = Number(size);
    if (!n) throw new UploadError("The file needs a name.");
    if (!/\.(csv|xlsx|txt)$/i.test(n)) throw new UploadError("Upload a Zerodha Console tradebook as .csv or .xlsx.");
    if (!(bytes > 0)) throw new UploadError("The file is empty.");
    if (bytes > MAX_FILE) throw new UploadError(`A file can be at most ${MAX_FILE / 1024 / 1024} MB: download the tradebook one financial year at a time.`);
    for (const [id, u] of this.pending) if (this.now() - u.at > PENDING_MS) this.pending.delete(id);
    if (this.pending.size >= 6) throw new UploadError("Too many uploads are open at once. Wait for them to finish.", "busy", 429);
    const id = crypto.randomBytes(8).toString("hex");
    this.pending.set(id, { name: n, size: bytes, parts: [], got: 0, at: this.now() });
    return { id, partSize: PART, parts: Math.ceil(bytes / PART) };
  }

  part(id, index, buf) {
    const u = this.pending.get(String(id));
    if (!u) throw new UploadError("That upload is not open any more. Start it again.", "not_found", 404);
    if (Number(index) !== u.parts.length) throw new UploadError(`Part ${index} came out of order (expected ${u.parts.length}).`);
    if (!Buffer.isBuffer(buf) || !buf.length || buf.length > MAX_PART) throw new UploadError("Each part must be at most 2.5 MB.");
    if (u.got + buf.length > u.size) throw new UploadError("The parts are larger than the file.");
    u.parts.push(buf);
    u.got += buf.length;
    u.at = this.now();
    return { got: u.got, size: u.size };
  }

  /** The whole file, once every part is in. The upload is closed. */
  take(id) {
    const u = this.pending.get(String(id));
    if (!u) throw new UploadError("That upload is not open any more. Start it again.", "not_found", 404);
    this.pending.delete(String(id));
    if (u.got !== u.size) throw new UploadError(`The upload is incomplete (${u.got} of ${u.size} bytes).`);
    return { name: u.name, buf: Buffer.concat(u.parts) };
  }

  /* --------------------------------------------------------------------- the files */
  _index() {
    const d = this.docs.read(INDEX, null);
    return Array.isArray(d && d.files) ? d.files : [];
  }

  /** Keep a file. @returns { id, duplicate, meta } — duplicate when the same bytes are already kept. */
  async keep({ name, buf, result = null }) {
    const id = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
    const meta = { id, name: String(name || "tradebook").slice(0, 120), type: typeOf(name, buf), size: buf.length, at: new Date(this.now()).toISOString(), result };
    const existing = (await this.list()).find((f) => f.id === id);
    if (existing) {
      await this._setResult(id, { ...existing, lastImportAt: meta.at, result: result || existing.result });
      return { id, duplicate: true, meta: existing };
    }
    if (this.col) await this.col.replaceOne({ _id: id }, { _id: id, ...meta, data: buf }, { upsert: true });
    else {
      if (!this.dir) throw new UploadError("No place to keep the file on this server.", "not_configured", 409);
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(path.join(this.dir, id), buf, { mode: 0o600 });
      this.docs.write(INDEX, { files: [meta, ...this._index().filter((f) => f.id !== id)].slice(0, 500) });
    }
    return { id, duplicate: false, meta };
  }

  async _setResult(id, meta) {
    if (this.col) await this.col.updateOne({ _id: id }, { $set: { lastImportAt: meta.lastImportAt, result: meta.result } });
    else this.docs.write(INDEX, { files: this._index().map((f) => (f.id === id ? { ...f, lastImportAt: meta.lastImportAt, result: meta.result } : f)) });
  }

  async list() {
    if (this.col) {
      const rows = await this.col.find({}, { projection: { data: 0 } }).sort({ at: -1 }).limit(500).toArray();
      return rows.map(({ _id, data, ...m }) => ({ ...m, id: m.id || _id }));
    }
    return this._index();
  }

  /** @returns { meta, buf } or null */
  async get(id) {
    if (!ID_RE.test(String(id))) return null;
    if (this.col) {
      const r = await this.col.findOne({ _id: String(id) });
      if (!r) return null;
      const { _id, data, ...meta } = r;
      const buf = Buffer.isBuffer(data) ? data : data && data.buffer ? Buffer.from(data.buffer) : Buffer.from(data || []);
      return { meta: { ...meta, id: _id }, buf };
    }
    const meta = this._index().find((f) => f.id === id);
    if (!meta || !this.dir) return null;
    try {
      return { meta, buf: fs.readFileSync(path.join(this.dir, id)) };
    } catch (_) {
      return null;
    }
  }

  /** Deletes the kept copy of a file (its trades stay in the journal). */
  async remove(id) {
    if (!ID_RE.test(String(id))) return false;
    if (this.col) {
      const r = await this.col.deleteOne({ _id: String(id) });
      return Boolean(r && r.deletedCount);
    }
    const had = this._index().some((f) => f.id === id);
    this.docs.write(INDEX, { files: this._index().filter((f) => f.id !== id) });
    try {
      if (this.dir) fs.unlinkSync(path.join(this.dir, id));
    } catch (_) {
      /* already gone */
    }
    return had;
  }
}

module.exports = { JournalFiles, UploadError, MAX_FILE, PART };
