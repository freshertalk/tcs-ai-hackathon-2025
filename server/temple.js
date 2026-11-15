"use strict";
// The Mandir: devotional audio that plays softly while the private area is open.
//
// Three kinds of source:
//   - "library": the files the owner uploads — any number, one after another — kept on this server
//                (server/data/media) and served only to signed-in people, with browser caching, so
//                after the first play each costs no internet. Audio (MP3, M4A, OGG, WAV, WEBM, FLAC)
//                and video (MP4, MOV, WEBM, MKV) — a video plays as sound in the background, and its
//                picture shows only in the Mandir card when asked. With "Auto" on, the page plays the
//                whole list in order and starts again; with it off, the file playing repeats.
//   - "url":     a direct link to an audio file (https).
//   - "youtube": a YouTube video, kept as a link only. YouTube's terms allow neither its sound without
//                its player nor downloading it — so its audio is never downloaded or extracted.
// The page decides when to play (browsers allow sound only after the first tap or key press).
// Changing the sources, the list and Auto is for the superadmin; anyone signed in can play, pause,
// skip and set the volume on their own device.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");

const NAME = "temple/settings.json";
const DEFAULT_VIDEO = "AETFvQonfV8"; // Shri Hanuman Chalisa — the owner's choice
const MAX_FILE = 200 * 1024 * 1024; // 200 MB: a long bhajan, or a video of one
const MAX_TOTAL = 2 * 1024 * 1024 * 1024; // 2 GB for the whole library
const MAX_ITEMS = 60;
const MAX_PART = 2.5 * 1024 * 1024; // each upload part stays under the proxy's body limit
const ITEM_RE = /^[a-f0-9]{12}$/;
const DEFAULTS = {
  source: { kind: "youtube", videoId: DEFAULT_VIDEO, label: "Shri Hanuman Chalisa", url: `https://www.youtube.com/watch?v=${DEFAULT_VIDEO}` },
  volume: 0.01, // 1%: barely there, in the background (the owner's choice, 2026-11-15)
  autoplay: true,
  auto: true, // play the uploaded list one after another
};

class TempleError extends Error {
  constructor(message, code = "invalid", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** The 11-character id of a YouTube link (watch, youtu.be, embed, shorts, live), or "". */
function youtubeId(link) {
  let u;
  try {
    u = new URL(String(link || "").trim());
  } catch (_) {
    return "";
  }
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  let id = "";
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v") || "";
    else {
      const m = u.pathname.match(/^\/(embed|shorts|live|v)\/([^/?#]+)/);
      if (m) id = m[2];
    }
  }
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
}

/**
 * What kind of media a file is, from its first bytes; "" when it is not audio or video we can play.
 * `hint` is the browser's own type for the file ("video/mp4", "audio/x-m4a"…): it only decides
 * between audio and video where the bytes cannot (an MP4 or WEBM may be either).
 */
function sniff(buf, hint = "") {
  if (!buf || buf.length < 12) return "";
  const s = (a, b) => buf.toString("latin1", a, b);
  const wantsVideo = /^video\//i.test(String(hint || ""));
  if (s(0, 3) === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (s(4, 8) === "ftyp") {
    const brand = s(8, 12);
    if (/^M4[AB] /.test(brand)) return "audio/mp4";
    if (brand === "qt  ") return "video/quicktime";
    if (/^M4V/.test(brand)) return "video/mp4";
    return wantsVideo ? "video/mp4" : "audio/mp4";
  }
  if (s(0, 4) === "OggS") return "audio/ogg";
  if (s(0, 4) === "RIFF" && s(8, 12) === "WAVE") return "audio/wav";
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    const head = s(0, Math.min(buf.length, 64));
    if (head.includes("matroska")) return "video/x-matroska";
    return wantsVideo ? "video/webm" : "audio/webm";
  }
  if (s(0, 4) === "fLaC") return "audio/flac";
  return "";
}
const EXT = { "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/ogg": ".ogg", "audio/wav": ".wav", "audio/webm": ".webm", "audio/flac": ".flac", "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm", "video/x-matroska": ".mkv" };
const SERVE = { "video/quicktime": "video/mp4" }; // browsers play QuickTime's H.264 best when told it is MP4
const cleanLabel = (name, d) => String(name || "").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[^\p{L}\p{N} ._()-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80) || d;

class Temple {
  constructor({ docs, dir, now = () => Date.now() }) {
    this.docs = docs;
    this.dir = path.resolve(dir, "media");
    this.now = now;
  }

  /** The stored settings, with the single uploaded file of the first version moved into the library once. */
  _load() {
    const d = this.docs.read(NAME, null) || {};
    if (!Array.isArray(d.library)) d.library = [];
    if (d.source && d.source.kind === "file") {
      if (d.source.fileName && !d.library.some((x) => x.fileName === d.source.fileName)) d.library.unshift({ id: crypto.randomBytes(6).toString("hex"), fileName: d.source.fileName, mime: d.source.mime, size: d.source.size || 0, label: d.source.label || "Uploaded audio", uploadedAt: d.source.uploadedAt || new Date(this.now()).toISOString(), setBy: d.source.setBy || "" });
      d.source = { kind: "library" };
      this.docs.write(NAME, d);
    }
    // once: the old default of 5% becomes the new default of 1% (a volume the owner set by hand stays)
    if (!d.volume1pct) {
      if (d.volume === undefined || d.volume === 0.05) d.volume = DEFAULTS.volume;
      d.volume1pct = true;
      this.docs.write(NAME, d);
    }
    return d;
  }

  _path(item) {
    if (!item || !item.fileName) return null;
    const p = path.join(this.dir, item.fileName);
    return fs.existsSync(p) ? p : null;
  }

  _shape(item) {
    return { id: item.id, label: item.label, mime: item.mime, kind: /^video\//.test(item.mime) ? "video" : "audio", size: item.size, uploadedAt: item.uploadedAt };
  }

  settings() {
    const d = this._load();
    const library = d.library.filter((x) => this._path(x));
    const missing = d.library.length - library.length;
    let source = d.source && d.source.kind ? d.source : DEFAULTS.source;
    if (source.kind === "library" && !library.length) source = DEFAULTS.source; // every file gone: the default
    return {
      source: source.kind === "library" ? { kind: "library", label: library[0] ? library[0].label : "" } : source,
      volume: num(d.volume, DEFAULTS.volume),
      autoplay: d.autoplay !== false,
      auto: d.auto === undefined ? DEFAULTS.auto : Boolean(d.auto),
      library: library.map((x) => this._shape(x)),
      usedBytes: library.reduce((a, x) => a + (x.size || 0), 0),
      limits: { maxFile: MAX_FILE, maxTotal: MAX_TOTAL, maxItems: MAX_ITEMS },
      missing: missing > 0 || (d.source && d.source.kind === "library" && !library.length) ? true : undefined,
      defaultVideo: DEFAULT_VIDEO,
    };
  }

  /** One uploaded file, for playing: { file, mime } or null. */
  mediaPath(id) {
    if (!ITEM_RE.test(String(id || ""))) return null;
    const item = this._load().library.find((x) => x.id === id);
    const file = this._path(item);
    return file ? { file, mime: SERVE[item.mime] || item.mime } : null;
  }

  /** The first file of the list (the address the first version used). */
  audioPath() {
    const s = this.settings();
    return s.library.length ? this.mediaPath(s.library[0].id) : null;
  }

  /** Volume, start-by-itself, Auto, a link source, back to the library, or back to the default. */
  set({ volume, autoplay, auto, link, label, reset, useLibrary } = {}, by = "") {
    const d = this._load();
    if (volume !== undefined) {
      const v = Number(volume);
      if (!Number.isFinite(v) || v < 0 || v > 1) throw new TempleError("The volume is a number from 0 to 1.");
      d.volume = Math.round(v * 100) / 100;
    }
    if (autoplay !== undefined) d.autoplay = Boolean(autoplay);
    if (auto !== undefined) d.auto = Boolean(auto);
    if (reset) d.source = DEFAULTS.source; // the uploaded files stay in the library
    else if (useLibrary) {
      if (!d.library.some((x) => this._path(x))) throw new TempleError("Upload a file first.");
      d.source = { kind: "library", setAt: new Date(this.now()).toISOString(), setBy: by };
    } else if (link !== undefined) {
      const raw = String(link || "").trim();
      if (raw.length > 2000) throw new TempleError("That link is too long.");
      const name = String(label || "").trim().slice(0, 80);
      const id = youtubeId(raw);
      let src;
      if (id) src = { kind: "youtube", videoId: id, url: `https://www.youtube.com/watch?v=${id}`, label: name || "YouTube" };
      else {
        let u;
        try {
          u = new URL(raw);
        } catch (_) {
          throw new TempleError("Enter a YouTube link or a direct https link to an audio file.");
        }
        if (u.protocol !== "https:") throw new TempleError("Only https links can be played on this site.");
        src = { kind: "url", url: u.toString(), label: name || decodeURIComponent(u.pathname.split("/").pop() || "Audio link").slice(0, 80) };
      }
      d.source = { ...src, setAt: new Date(this.now()).toISOString(), setBy: by };
    }
    this.docs.write(NAME, d);
    return this.settings();
  }

  /** Take one file out of the list and off the disk. */
  remove(id) {
    const d = this._load();
    const item = d.library.find((x) => x.id === id);
    if (!item) throw new TempleError("That file is not in the list.", "not_found", 404);
    const f = this._path(item);
    if (f) {
      try {
        fs.unlinkSync(f);
      } catch (_) {
        /* already gone */
      }
    }
    d.library = d.library.filter((x) => x.id !== id);
    if (!d.library.length && d.source && d.source.kind === "library") d.source = DEFAULTS.source;
    this.docs.write(NAME, d);
    return this.settings();
  }

  /** A new order for the list: every id once. */
  order(ids) {
    const d = this._load();
    const list = Array.isArray(ids) ? ids.map(String) : [];
    if (list.length !== d.library.length || new Set(list).size !== list.length || !list.every((id) => d.library.some((x) => x.id === id))) throw new TempleError("Send every file of the list once, in the new order.");
    d.library = list.map((id) => d.library.find((x) => x.id === id));
    this.docs.write(NAME, d);
    return this.settings();
  }

  rename(id, label) {
    const d = this._load();
    const item = d.library.find((x) => x.id === id);
    if (!item) throw new TempleError("That file is not in the list.", "not_found", 404);
    const name = cleanLabel(label, "");
    if (!name) throw new TempleError("Give it a name.");
    item.label = name;
    this.docs.write(NAME, d);
    return this.settings();
  }

  /**
   * One part of an upload. Parts arrive in order (0 … of-1) under one upload id; the last one checks
   * the whole file and adds it to the END of the list. Uploading makes the list the source.
   */
  part({ id, part, of, name, type, buf }, by = "") {
    if (!/^[a-f0-9]{16}$/.test(String(id || ""))) throw new TempleError("Missing upload id.");
    const i = Number(part);
    const n = Number(of);
    if (!Number.isInteger(i) || !Number.isInteger(n) || n < 1 || n > Math.ceil(MAX_FILE / (1024 * 1024)) || i < 0 || i >= n) throw new TempleError("That upload part is out of order.");
    if (!Buffer.isBuffer(buf) || !buf.length || buf.length > MAX_PART) throw new TempleError("Each part must be at most 2.5 MB.");
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = path.join(this.dir, `upload-${id}.part`);
    if (i === 0) {
      if (!sniff(buf, type)) throw new TempleError("That file is not audio or video this site can play (MP3, M4A, OGG, WAV, WEBM, FLAC, MP4, MOV or MKV).");
      const d = this._load();
      if (d.library.length >= MAX_ITEMS) throw new TempleError(`The list holds at most ${MAX_ITEMS} files. Remove one first.`);
      this._sweep();
      fs.writeFileSync(tmp, buf, { mode: 0o600 });
    } else {
      if (!fs.existsSync(tmp)) throw new TempleError("The upload was interrupted. Start it again.");
      if (fs.statSync(tmp).size + buf.length > MAX_FILE) {
        fs.unlinkSync(tmp);
        throw new TempleError("The file is larger than 200 MB.");
      }
      fs.appendFileSync(tmp, buf);
    }
    if (i < n - 1) return { received: i + 1, of: n };
    // the last part: check it and add it to the list
    const head = Buffer.alloc(64);
    const fd = fs.openSync(tmp, "r");
    fs.readSync(fd, head, 0, 64, 0);
    fs.closeSync(fd);
    const mime = sniff(head, type);
    const size = fs.statSync(tmp).size;
    if (!mime) {
      fs.unlinkSync(tmp);
      throw new TempleError("That file is not audio or video this site can play.");
    }
    const d = this._load();
    const used = d.library.reduce((a, x) => a + (this._path(x) ? x.size || 0 : 0), 0);
    if (used + size > MAX_TOTAL) {
      fs.unlinkSync(tmp);
      throw new TempleError("The list would pass 2 GB. Remove a file first.");
    }
    const itemId = crypto.randomBytes(6).toString("hex");
    const fileName = `temple-${itemId}${EXT[mime]}`;
    fs.renameSync(tmp, path.join(this.dir, fileName));
    const item = { id: itemId, fileName, mime, size, label: cleanLabel(name, /^video\//.test(mime) ? "Uploaded video" : "Uploaded audio"), uploadedAt: new Date(this.now()).toISOString(), setBy: by };
    d.library.push(item);
    if (!d.source || d.source.kind !== "library") d.source = { kind: "library", setAt: item.uploadedAt, setBy: by };
    this.docs.write(NAME, d);
    return { done: true, item: this._shape(item), settings: this.settings() };
  }

  /** Parts of uploads abandoned more than a day ago are cleared away. */
  _sweep() {
    try {
      for (const f of fs.readdirSync(this.dir)) {
        if (!/^upload-[a-f0-9]{16}\.part$/.test(f)) continue;
        const p = path.join(this.dir, f);
        if (this.now() - fs.statSync(p).mtimeMs > 86400000) fs.unlinkSync(p);
      }
    } catch (_) {
      /* nothing to sweep */
    }
  }
}

const num = (x, d) => (Number.isFinite(Number(x)) && x !== null && x !== "" ? Number(x) : d);

function mountTemple(app, { temple, requireAdmin, requireSuper, limiter }) {
  const wrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      if (err instanceof TempleError) return res.status(err.status).json({ error: err.code, message: err.message });
      console.error("[temple]", err && err.message ? err.message : err);
      res.status(500).json({ error: "temple_failed", message: "The Mandir settings could not be saved." });
    }
  };
  const by = (req) => (req.user && req.user.email) || "";
  app.get("/api/admin/temple", requireAdmin, wrap(async () => temple.settings()));
  app.put("/api/admin/temple", requireSuper, limiter(60, 15 * 60 * 1000), wrap(async (req) => temple.set(req.body || {}, by(req))));
  app.post(
    "/api/admin/temple/upload",
    requireSuper,
    limiter(600, 15 * 60 * 1000), // a 200 MB video is a hundred parts
    express.raw({ type: () => true, limit: "3mb" }),
    wrap(async (req) => temple.part({ id: req.query.id, part: req.query.part, of: req.query.of, name: req.query.name, type: req.query.type, buf: req.body }, by(req)))
  );
  app.put("/api/admin/temple/library/order", requireSuper, limiter(120, 15 * 60 * 1000), wrap(async (req) => temple.order((req.body || {}).ids)));
  app.put("/api/admin/temple/library/:id", requireSuper, limiter(120, 15 * 60 * 1000), wrap(async (req) => temple.rename(String(req.params.id), (req.body || {}).label)));
  app.delete("/api/admin/temple/library/:id", requireSuper, limiter(120, 15 * 60 * 1000), wrap(async (req) => temple.remove(String(req.params.id))));
  // a file itself: signed-in people only; its address never changes, so the browser keeps it a year.
  // Express sends byte ranges, so a long file or a video starts at once and can be skipped through.
  const send = (a, res, forever = true) => {
    if (!a || !a.file) return res.status(404).json({ error: "not_found", message: "That file is not uploaded." });
    res.set("Cache-Control", forever ? "private, max-age=31536000, immutable" : "private, max-age=3600");
    res.type(a.mime || "audio/mpeg");
    res.sendFile(a.file);
  };
  app.get("/api/admin/temple/media/:id", requireAdmin, (req, res) => send(temple.mediaPath(String(req.params.id)), res));
  app.get("/api/admin/temple/audio", requireAdmin, (req, res) => send(temple.audioPath(), res, false)); // the first file: its address can change hands
}

module.exports = { Temple, TempleError, mountTemple, youtubeId, sniff, DEFAULT_VIDEO, MAX_FILE, MAX_TOTAL, MAX_ITEMS };
