"use strict";
// The owner's Kundali (birth chart), kept for the superadmins and for nobody else.
//
//   THE CHART      One record (kundali/record.json): the chart's own numbers — birth details, where each planet stands,
//                  the divisional charts, the dasha's starting point — and the reading written from them, in Hindi. It
//                  is a person's private document, so it is NOT part of the code and NOT part of the page bundle a
//                  visitor's browser downloads: it lives in the record store (and so in the daily backup), it is put
//                  there by a superadmin (the page's "import"), and it leaves only through a superadmin's session.
//   THE PAPERS     The documents the reading comes from — the horoscope's PDF, a scan of a handwritten one: kept as
//                  files beside the temple's media, shown on the page and downloadable, to superadmins only. A file is
//                  checked by its first bytes (a PDF, a JPEG, a PNG or a WEBP), never by the name it arrives with.
//
// Nothing here is read by the trading desk, the AI or any other page: it has no way to reach an account or an order,
// and no AI model is ever shown it.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const NAME = "kundali/record.json";
const MAX_CHART = 600 * 1024; // the chart and its reading, as JSON
const MAX_FILE = 60 * 1024 * 1024; // one paper: a long horoscope is a few megabytes; a scan can be more
const MAX_TOTAL = 400 * 1024 * 1024;
const MAX_ITEMS = 24;
const MAX_PART = 2.5 * 1024 * 1024; // each upload part stays under the proxy's body limit
const PART_RE = /^kundali-upload-[a-f0-9]{16}\.part$/;

class KundaliError extends Error {
  constructor(message, code = "invalid", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** What a file is, from its first bytes. "" when it is not a paper this page shows. */
function sniff(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return "";
  if (buf.slice(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return "";
}
const EXT = { "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
const cleanLabel = (name, fallback) =>
  String(name || "")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[^\p{L}\p{M}\p{N} ._()-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90) || fallback;

/** Is this a chart the page can draw? Returns the reason it is not, or "". */
function chartProblem(c) {
  if (!c || typeof c !== "object" || Array.isArray(c)) return "The file is not a Kundali chart.";
  if (!c.birth || typeof c.birth !== "object") return "The chart has no birth details.";
  if (!c.lagna || !Number.isInteger(c.lagna.sign) || c.lagna.sign < 1 || c.lagna.sign > 12) return "The chart has no ascendant (lagna).";
  if (!Array.isArray(c.planets) || c.planets.length < 7) return "The chart has no planets.";
  for (const p of c.planets) {
    if (!p || typeof p.id !== "string" || !Number.isInteger(p.sign) || p.sign < 1 || p.sign > 12) return "A planet in the chart has no sign.";
  }
  return "";
}

class Kundali {
  constructor({ docs, dir, now = () => Date.now() }) {
    this.docs = docs;
    this.dir = path.resolve(dir, "media");
    this.now = now;
  }

  _load() {
    const d = this.docs.read(NAME, null) || {};
    return { chart: d.chart && typeof d.chart === "object" ? d.chart : null, chartAt: d.chartAt || null, chartBy: d.chartBy || "", documents: Array.isArray(d.documents) ? d.documents : [] };
  }
  _path(item) {
    if (!item || !item.fileName || !/^kundali-[a-f0-9]{12}\.[a-z0-9]{3,4}$/.test(item.fileName)) return null;
    const p = path.join(this.dir, item.fileName);
    return fs.existsSync(p) ? p : null;
  }
  _shape(item) {
    return { id: item.id, label: item.label, mime: item.mime, kind: item.mime === "application/pdf" ? "pdf" : "image", size: item.size, uploadedAt: item.uploadedAt, by: item.by || "" };
  }

  /** Everything the page shows: the chart and its reading, and the list of papers (never a file's place on the disk). */
  view() {
    const d = this._load();
    return {
      chart: d.chart,
      chartAt: d.chartAt,
      chartBy: d.chartBy,
      documents: d.documents.filter((x) => this._path(x)).map((x) => this._shape(x)),
      limits: { maxFile: MAX_FILE, maxItems: MAX_ITEMS, maxPart: MAX_PART, maxChart: MAX_CHART },
    };
  }

  /* ------------------------------------------------------------------ the chart */
  /** Put the chart in place (a parsed object, or the bytes of its JSON file). The one before it is replaced. */
  setChart(input, by = "") {
    let chart = input;
    if (Buffer.isBuffer(input)) {
      if (!input.length) throw new KundaliError("The file is empty.");
      if (input.length > MAX_CHART) throw new KundaliError("The chart file is larger than 600 KB.");
      try {
        chart = JSON.parse(input.toString("utf8").replace(/^\uFEFF/, ""));
      } catch (_) {
        throw new KundaliError("The file is not a Kundali chart (it is not JSON).");
      }
    }
    const problem = chartProblem(chart);
    if (problem) throw new KundaliError(problem);
    if (Buffer.byteLength(JSON.stringify(chart), "utf8") > MAX_CHART) throw new KundaliError("The chart is larger than 600 KB.");
    const d = this._load();
    d.chart = chart;
    d.chartAt = new Date(this.now()).toISOString();
    d.chartBy = by;
    this.docs.write(NAME, d);
    return this.view();
  }
  /** The chart as a file to keep or to carry to another server: { name, body } or null. */
  chartFile() {
    const d = this._load();
    if (!d.chart) return null;
    return { name: "kundali-chart.json", body: Buffer.from(`${JSON.stringify(d.chart, null, 2)}\n`, "utf8") };
  }
  removeChart() {
    const d = this._load();
    d.chart = null;
    d.chartAt = null;
    d.chartBy = "";
    this.docs.write(NAME, d);
    return this.view();
  }

  /* ------------------------------------------------------------------ the papers */
  /** One paper, to show or to download: { file, mime, name } or null. */
  file(id) {
    const item = this._load().documents.find((x) => x.id === String(id || ""));
    const file = this._path(item);
    return file ? { file, mime: item.mime, name: `${item.label}${EXT[item.mime] || ""}` } : null;
  }

  /**
   * One part of an upload. Parts arrive in order (0 … of-1) under one upload id; the last one checks the whole file
   * and adds it to the list.
   */
  part({ id, part, of, name, buf }, by = "") {
    if (!/^[a-f0-9]{16}$/.test(String(id || ""))) throw new KundaliError("Missing upload id.");
    const i = Number(part);
    const n = Number(of);
    if (!Number.isInteger(i) || !Number.isInteger(n) || n < 1 || n > Math.ceil(MAX_FILE / (1024 * 1024)) || i < 0 || i >= n) throw new KundaliError("That upload part is out of order.");
    if (!Buffer.isBuffer(buf) || !buf.length || buf.length > MAX_PART) throw new KundaliError("Each part must be at most 2.5 MB.");
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = path.join(this.dir, `kundali-upload-${id}.part`);
    if (i === 0) {
      if (!sniff(buf)) throw new KundaliError("That file is not a PDF or a picture (JPEG, PNG or WEBP).");
      if (this._load().documents.filter((x) => this._path(x)).length >= MAX_ITEMS) throw new KundaliError(`At most ${MAX_ITEMS} papers are kept. Remove one first.`);
      this._sweep();
      fs.writeFileSync(tmp, buf, { mode: 0o600 });
    } else {
      if (!fs.existsSync(tmp)) throw new KundaliError("The upload was interrupted. Start it again.");
      if (fs.statSync(tmp).size + buf.length > MAX_FILE) {
        fs.unlinkSync(tmp);
        throw new KundaliError("The file is larger than 60 MB.");
      }
      fs.appendFileSync(tmp, buf);
    }
    if (i < n - 1) return { received: i + 1, of: n };
    return { done: true, ...this._adopt(tmp, name, by) };
  }

  /** A whole file already on this machine (the first paper is put in place this way): copied in, checked, listed. */
  addFile(source, name, by = "") {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = path.join(this.dir, `kundali-upload-${crypto.randomBytes(8).toString("hex")}.part`);
    fs.copyFileSync(source, tmp);
    fs.chmodSync(tmp, 0o600);
    return this._adopt(tmp, name || path.basename(source), by);
  }

  _adopt(tmp, name, by) {
    const head = Buffer.alloc(64);
    const fd = fs.openSync(tmp, "r");
    fs.readSync(fd, head, 0, 64, 0);
    fs.closeSync(fd);
    const mime = sniff(head);
    const size = fs.statSync(tmp).size;
    const fail = (message) => {
      fs.unlinkSync(tmp);
      throw new KundaliError(message);
    };
    if (!mime) fail("That file is not a PDF or a picture (JPEG, PNG or WEBP).");
    if (size > MAX_FILE) fail("The file is larger than 60 MB.");
    const d = this._load();
    d.documents = d.documents.filter((x) => this._path(x)); // a file that is gone from the disk leaves the list too
    if (d.documents.length >= MAX_ITEMS) fail(`At most ${MAX_ITEMS} papers are kept. Remove one first.`);
    if (d.documents.reduce((a, x) => a + (x.size || 0), 0) + size > MAX_TOTAL) fail("The papers would pass 400 MB. Remove one first.");
    const itemId = crypto.randomBytes(6).toString("hex");
    const fileName = `kundali-${itemId}${EXT[mime]}`;
    fs.renameSync(tmp, path.join(this.dir, fileName));
    const item = { id: itemId, fileName, mime, size, label: cleanLabel(name, mime === "application/pdf" ? "Kundali" : "Kundali picture"), uploadedAt: new Date(this.now()).toISOString(), by };
    d.documents.push(item);
    this.docs.write(NAME, d);
    return { item: this._shape(item), view: this.view() };
  }

  rename(id, label) {
    const d = this._load();
    const item = d.documents.find((x) => x.id === String(id || ""));
    if (!item) throw new KundaliError("That paper is not here.", "not_found", 404);
    const name = cleanLabel(label, "");
    if (!name) throw new KundaliError("Give it a name.");
    item.label = name;
    this.docs.write(NAME, d);
    return this.view();
  }

  remove(id) {
    const d = this._load();
    const item = d.documents.find((x) => x.id === String(id || ""));
    if (!item) throw new KundaliError("That paper is not here.", "not_found", 404);
    const file = this._path(item);
    if (file) fs.unlinkSync(file);
    d.documents = d.documents.filter((x) => x.id !== item.id);
    this.docs.write(NAME, d);
    return this.view();
  }

  /** Parts of uploads abandoned more than a day ago are cleared away. */
  _sweep() {
    try {
      for (const f of fs.readdirSync(this.dir)) {
        if (!PART_RE.test(f)) continue;
        const p = path.join(this.dir, f);
        if (this.now() - fs.statSync(p).mtimeMs > 24 * 3600 * 1000) fs.unlinkSync(p);
      }
    } catch (_) {
      /* nothing to clear */
    }
  }
}

/** The routes. Every one needs a superadmin: the Kundali is not an admin's page. */
function mountKundali(app, { kundali, requireSuper, limiter, audit = () => {} }) {
  const express = require("express");
  const wrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req, res));
    } catch (err) {
      if (err instanceof KundaliError) return res.status(err.status).json({ error: err.code, message: err.message });
      console.error("[kundali]", err && err.message ? err.message : err);
      res.status(500).json({ error: "kundali_failed", message: "The Kundali could not be saved." });
    }
  };
  const by = (req) => (req.user && req.user.email) || "";
  const mark = (req, type) => audit(req, type, by(req));

  app.get("/api/admin/kundali", requireSuper, wrap(async () => kundali.view()));

  // the chart arrives as the bytes of its file (a few hundred kilobytes: more than the API's ordinary JSON limit)
  app.put(
    "/api/admin/kundali/chart",
    requireSuper,
    limiter(30, 15 * 60 * 1000),
    express.raw({ type: () => true, limit: "700kb" }),
    wrap(async (req) => {
      const v = kundali.setChart(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), by(req));
      mark(req, "kundali_chart_saved");
      return v;
    })
  );
  app.delete(
    "/api/admin/kundali/chart",
    requireSuper,
    limiter(30, 15 * 60 * 1000),
    wrap(async (req) => {
      const v = kundali.removeChart();
      mark(req, "kundali_chart_removed");
      return v;
    })
  );
  app.get("/api/admin/kundali/chart/export", requireSuper, limiter(60, 15 * 60 * 1000), (req, res) => {
    const f = kundali.chartFile();
    if (!f) return res.status(404).json({ error: "not_found", message: "There is no chart to export yet." });
    mark(req, "kundali_chart_exported");
    res.set({ "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${f.name}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    res.send(f.body);
  });

  app.post(
    "/api/admin/kundali/upload",
    requireSuper,
    limiter(400, 15 * 60 * 1000),
    express.raw({ type: () => true, limit: "3mb" }),
    wrap(async (req) => {
      const r = kundali.part({ id: req.query.id, part: req.query.part, of: req.query.of, name: req.query.name, buf: req.body }, by(req));
      if (r.done) mark(req, "kundali_paper_added");
      return r;
    })
  );
  app.put("/api/admin/kundali/documents/:id", requireSuper, limiter(120, 15 * 60 * 1000), wrap(async (req) => kundali.rename(String(req.params.id), (req.body || {}).label)));
  app.delete(
    "/api/admin/kundali/documents/:id",
    requireSuper,
    limiter(120, 15 * 60 * 1000),
    wrap(async (req) => {
      const v = kundali.remove(String(req.params.id));
      mark(req, "kundali_paper_removed");
      return v;
    })
  );
  // a paper itself: read in the browser, or kept as a file with ?download=1. Never cached anywhere but the person's
  // own browser session, never guessed at as another type.
  app.get("/api/admin/kundali/documents/:id", requireSuper, limiter(240, 15 * 60 * 1000), (req, res) => {
    const a = kundali.file(String(req.params.id));
    if (!a) return res.status(404).json({ error: "not_found", message: "That paper is not here." });
    const download = req.query.download === "1";
    if (download) mark(req, "kundali_paper_downloaded");
    const ascii = a.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    res.set({
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      // the Kundali page shows the paper in a frame of its own: this site (and only this site) may frame it
      "X-Frame-Options": "SAMEORIGIN",
      "Content-Security-Policy": "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
    });
    res.type(a.mime);
    res.sendFile(a.file);
  });
}

module.exports = { Kundali, KundaliError, mountKundali, sniff, chartProblem, NAME, MAX_FILE, MAX_ITEMS, MAX_CHART };
