"use strict";
// The Mandir: the devotional audio that plays softly while the private area is open.
//
// Three kinds of source:
//   - "file":    an audio file the owner uploads (one they own or may use). It is kept on this
//                server (server/data/media) and served only to signed-in people, with browser
//                caching, so after the first play it costs no internet at all.
//   - "url":     a direct link to an audio file (https).
//   - "youtube": a YouTube video, played through YouTube's own embedded player, as YouTube's terms
//                allow. Its audio is never downloaded or extracted — that would break YouTube's
//                terms and the recording's copyright.
// The page decides when to play (browsers allow sound only after the first tap or key press).
// Changing the source is for the superadmin; anyone signed in can play, pause and set the volume
// on their own device.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");

const NAME = "temple/settings.json";
const DEFAULT_VIDEO = "AETFvQonfV8"; // Shri Hanuman Chalisa — the owner's choice
const MAX_FILE = 40 * 1024 * 1024; // 40 MB: a long bhajan at high quality
const MAX_PART = 2.5 * 1024 * 1024; // each upload part stays under the proxy's body limit
const DEFAULTS = {
  source: { kind: "youtube", videoId: DEFAULT_VIDEO, label: "Shri Hanuman Chalisa", url: `https://www.youtube.com/watch?v=${DEFAULT_VIDEO}` },
  volume: 0.15, // soft, in the background
  autoplay: true,
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

/** What kind of audio a file is, from its first bytes; "" when it is not audio we can play. */
function sniff(buf) {
  if (!buf || buf.length < 12) return "";
  const s = (a, b) => buf.toString("latin1", a, b);
  if (s(0, 3) === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (s(4, 8) === "ftyp") return "audio/mp4";
  if (s(0, 4) === "OggS") return "audio/ogg";
  if (s(0, 4) === "RIFF" && s(8, 12) === "WAVE") return "audio/wav";
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "audio/webm";
  if (s(0, 4) === "fLaC") return "audio/flac";
  return "";
}
const EXT = { "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/ogg": ".ogg", "audio/wav": ".wav", "audio/webm": ".webm", "audio/flac": ".flac" };

class Temple {
  constructor({ docs, dir, now = () => Date.now() }) {
    this.docs = docs;
    this.dir = path.resolve(dir, "media");
    this.now = now;
  }

  settings() {
    const d = this.docs.read(NAME, null) || {};
    const source = d.source && d.source.kind ? d.source : DEFAULTS.source;
    // a file that has gone missing (a new server, a cleared folder) falls back to the default
    if (source.kind === "file" && !this._file(source)) return { ...DEFAULTS, volume: num(d.volume, DEFAULTS.volume), autoplay: d.autoplay !== false, missing: true };
    return { source, volume: num(d.volume, DEFAULTS.volume), autoplay: d.autoplay !== false, defaultVideo: DEFAULT_VIDEO };
  }

  _file(source) {
    if (!source || !source.fileName) return null;
    const p = path.join(this.dir, source.fileName);
    return fs.existsSync(p) ? p : null;
  }

  audioPath() {
    const s = this.settings();
    return s.source.kind === "file" ? { file: this._file(s.source), mime: s.source.mime } : null;
  }

  /** Volume, autoplay, and a link source (a YouTube video or an audio URL). */
  set({ volume, autoplay, link, label, reset } = {}, by = "") {
    const d = this.docs.read(NAME, null) || {};
    const next = { ...d };
    if (volume !== undefined) {
      const v = Number(volume);
      if (!Number.isFinite(v) || v < 0 || v > 1) throw new TempleError("The volume is a number from 0 to 1.");
      next.volume = Math.round(v * 100) / 100;
    }
    if (autoplay !== undefined) next.autoplay = Boolean(autoplay);
    if (reset) {
      this._dropFile(d.source);
      next.source = DEFAULTS.source;
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
      this._dropFile(d.source);
      next.source = { ...src, setAt: new Date(this.now()).toISOString(), setBy: by };
    }
    this.docs.write(NAME, next);
    return this.settings();
  }

  _dropFile(source) {
    const f = source && source.kind === "file" ? this._file(source) : null;
    if (f) {
      try {
        fs.unlinkSync(f);
      } catch (_) {
        /* already gone */
      }
    }
  }

  /**
   * One part of an upload. Parts arrive in order (0 … of-1) under one upload id; the last one checks
   * the whole file and makes it the source.
   */
  part({ id, part, of, name, buf }, by = "") {
    if (!/^[a-f0-9]{16}$/.test(String(id || ""))) throw new TempleError("Missing upload id.");
    const i = Number(part);
    const n = Number(of);
    if (!Number.isInteger(i) || !Number.isInteger(n) || n < 1 || n > Math.ceil(MAX_FILE / (1024 * 1024)) || i < 0 || i >= n) throw new TempleError("That upload part is out of order.");
    if (!Buffer.isBuffer(buf) || !buf.length || buf.length > MAX_PART) throw new TempleError("Each part must be at most 2.5 MB.");
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = path.join(this.dir, `upload-${id}.part`);
    if (i === 0) {
      if (!sniff(buf)) throw new TempleError("That file is not audio this site can play (MP3, M4A, OGG, WAV, WEBM or FLAC).");
      fs.writeFileSync(tmp, buf, { mode: 0o600 });
    } else {
      if (!fs.existsSync(tmp)) throw new TempleError("The upload was interrupted. Start it again.");
      if (fs.statSync(tmp).size + buf.length > MAX_FILE) {
        fs.unlinkSync(tmp);
        throw new TempleError("The file is larger than 40 MB.");
      }
      fs.appendFileSync(tmp, buf);
    }
    if (i < n - 1) return { received: i + 1, of: n };
    // the last part: check it and make it the source
    const head = Buffer.alloc(16);
    const fd = fs.openSync(tmp, "r");
    fs.readSync(fd, head, 0, 16, 0);
    fs.closeSync(fd);
    const mime = sniff(head);
    const size = fs.statSync(tmp).size;
    if (!mime) {
      fs.unlinkSync(tmp);
      throw new TempleError("That file is not audio this site can play.");
    }
    const d = this.docs.read(NAME, null) || {};
    this._dropFile(d.source);
    const fileName = `temple-${crypto.randomBytes(6).toString("hex")}${EXT[mime]}`;
    fs.renameSync(tmp, path.join(this.dir, fileName));
    const label = String(name || "").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[^\p{L}\p{N} ._()-]/gu, " ").trim().slice(0, 80) || "Uploaded audio";
    d.source = { kind: "file", fileName, mime, size, label, uploadedAt: new Date(this.now()).toISOString(), setBy: by };
    this.docs.write(NAME, d);
    return { done: true, settings: this.settings() };
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
      res.status(500).json({ error: "temple_failed", message: "The audio settings could not be saved." });
    }
  };
  const by = (req) => (req.user && req.user.email) || "";
  app.get("/api/admin/temple", requireAdmin, wrap(async () => temple.settings()));
  app.put("/api/admin/temple", requireSuper, limiter(40, 15 * 60 * 1000), wrap(async (req) => temple.set(req.body || {}, by(req))));
  app.post(
    "/api/admin/temple/upload",
    requireSuper,
    limiter(120, 15 * 60 * 1000),
    express.raw({ type: () => true, limit: "3mb" }),
    wrap(async (req) => temple.part({ id: req.query.id, part: req.query.part, of: req.query.of, name: req.query.name, buf: req.body }, by(req)))
  );
  // the uploaded file itself: signed-in people only, cached by the browser for a week
  app.get("/api/admin/temple/audio", requireAdmin, (req, res) => {
    const a = temple.audioPath();
    if (!a || !a.file) return res.status(404).json({ error: "not_found", message: "No audio file is uploaded." });
    res.set("Cache-Control", "private, max-age=604800");
    res.type(a.mime || "audio/mpeg");
    res.sendFile(a.file);
  });
}

module.exports = { Temple, TempleError, mountTemple, youtubeId, sniff, DEFAULT_VIDEO };
