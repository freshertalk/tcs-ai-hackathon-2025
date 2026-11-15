"use strict";
// TradeAI's conversations, each kept as its own record in the database.
//
//   - MongoDB (production): one document per conversation in the "tradeai_chats" collection,
//     read when it is opened — so a long history costs no memory, and deleting a chat deletes its
//     document from the database.
//   - The record store otherwise (files in development and tests): one record per conversation
//     ("tradeai/chats/<id>.json") and a small index of titles ("tradeai/index.json"); deleting a
//     chat removes its record.
//
// A conversation: { id, owner, title, createdAt, updatedAt, pinned, count, preview, messages:
// [{ id, role: "user" | "assistant", text, at, reply?, stopped? }] }. Everyone sees only their own.
// The single record the first version kept ("ai/tradeai.json") is moved here once, then removed.

const OLD = "ai/tradeai.json";
const INDEX = "tradeai/index.json";
const recName = (id) => `tradeai/chats/${id}.json`;
const MAX_CONVS = 300; // per person: beyond this the oldest unpinned chat goes
const ID_RE = /^[a-f0-9]{6,32}$/;

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const meta = (c) => ({ id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, pinned: Boolean(c.pinned), count: c.count || (c.messages || []).length, preview: c.preview || "" });
const order = (a, b) => (Boolean(b.pinned) - Boolean(a.pinned)) || (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0);
const notFound = () => Object.assign(new Error("That conversation is not there any more."), { code: "not_found", status: 404 });

class ChatStore {
  constructor(docs) {
    this.docs = docs;
    this.col = docs && docs.kind === "mongodb" && docs.db ? docs.db.collection("tradeai_chats") : null;
    this.kind = this.col ? "mongodb" : "records";
    this._ready = null;
  }

  /** The first time: an index on MongoDB, and the old single record moved over. */
  ready() {
    if (!this._ready) {
      this._ready = (async () => {
        if (this.col && this.col.createIndex) await this.col.createIndex({ owner: 1, updatedAt: -1 }).catch(() => {});
        const old = this.docs ? this.docs.read(OLD, null) : null;
        if (old && Array.isArray(old.convs) && old.convs.length) {
          for (const c of old.convs) if (c && ID_RE.test(String(c.id))) await this._put({ ...c, count: (c.messages || []).length });
          this.docs.remove(OLD);
        }
      })().catch((err) => {
        this._ready = null;
        throw err;
      });
    }
    return this._ready;
  }

  _index() {
    const d = this.docs.read(INDEX, null);
    return Array.isArray(d && d.convs) ? d.convs : [];
  }

  async _put(c) {
    const doc = { ...c, count: (c.messages || []).length };
    if (this.col) {
      await this.col.replaceOne({ _id: doc.id }, { ...doc, _id: doc.id }, { upsert: true });
      return;
    }
    this.docs.write(recName(doc.id), doc);
    const idx = this._index().filter((x) => x.id !== doc.id);
    idx.push({ ...meta(doc), owner: doc.owner });
    this.docs.write(INDEX, { convs: idx });
  }

  /** Someone's chats, pinned first then newest; q searches titles and messages. */
  async list(owner, { q = "" } = {}) {
    await this.ready();
    const query = String(q || "").trim().slice(0, 80);
    if (this.col) {
      const filter = { owner };
      if (query) {
        const re = { $regex: escapeRe(query), $options: "i" };
        filter.$or = [{ title: re }, { "messages.text": re }];
      }
      const rows = await this.col.find(filter, { projection: { messages: 0 } }).sort({ pinned: -1, updatedAt: -1 }).limit(MAX_CONVS).toArray();
      return rows.map((r) => meta({ ...r, id: r.id || r._id }));
    }
    let rows = this._index().filter((x) => x.owner === owner);
    if (query) {
      const needle = query.toLowerCase();
      rows = rows.filter((x) => {
        if (String(x.title).toLowerCase().includes(needle)) return true;
        const c = this.docs.read(recName(x.id), null);
        return Boolean(c && (c.messages || []).some((m) => String(m.text || "").toLowerCase().includes(needle)));
      });
    }
    return rows.map(meta).sort(order);
  }

  /** One chat with its messages, or null. */
  async get(id, owner) {
    await this.ready();
    if (!ID_RE.test(String(id))) return null;
    if (this.col) {
      const r = await this.col.findOne({ _id: String(id), owner });
      if (!r) return null;
      const { _id, ...rest } = r;
      return { ...rest, id: rest.id || _id };
    }
    const c = this.docs.read(recName(id), null);
    return c && c.owner === owner ? c : null;
  }

  async need(id, owner) {
    const c = await this.get(id, owner);
    if (!c) throw notFound();
    return c;
  }

  /** Save a chat (new or changed); beyond MAX_CONVS a person's oldest unpinned chat is deleted. */
  async put(c) {
    await this.ready();
    await this._put(c);
    const mine = await this.list(c.owner);
    if (mine.length > MAX_CONVS) {
      const extra = mine.filter((x) => !x.pinned && x.id !== c.id).slice(MAX_CONVS - mine.length);
      for (const x of extra) await this.remove(x.id, c.owner);
    }
  }

  /** Delete a chat from the database. True when it was there. */
  async remove(id, owner) {
    await this.ready();
    if (!ID_RE.test(String(id))) return false;
    if (this.col) {
      const r = await this.col.deleteOne({ _id: String(id), owner });
      return Boolean(r && r.deletedCount);
    }
    const c = this.docs.read(recName(id), null);
    if (!c || c.owner !== owner) return false;
    this.docs.remove(recName(id));
    this.docs.write(INDEX, { convs: this._index().filter((x) => x.id !== id) });
    return true;
  }
}

module.exports = { ChatStore, MAX_CONVS, ID_RE };
