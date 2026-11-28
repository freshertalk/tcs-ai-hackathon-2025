"use strict";
// A loan document, whatever its form, as rows of cells and as text (28 Nov 2026): PDF (also password-protected, with its
// password), Excel, CSV, Word and plain text — read here on the server from the file's own bytes; nothing in it is run.
// A picture (a photo or a screenshot) has no text to take out: only an AI model that can see it can read it.

const { pdfRows } = require("./pdf-text");
const { readXlsx, unzip } = require("./xlsx-reader");
const { sniff, readAttachment } = require("./ai/attach");
const { fromSheet } = require("./loan-schedule");

const MAX_BYTES = 7 * 1024 * 1024; // the web server in front allows 8 MB a request
const MAX_IMAGE = 4 * 1024 * 1024;
const PDF_PAGES = 120; // a loan agreement can be long
const SCAN_PAGES = 40; // scanned pages of one file that are offered for reading

class LoanFileError extends Error {
  constructor(message, code = "unreadable", status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** CSV (or tab-separated) as rows, quotes honoured. */
function csvRows(text) {
  const sep = (text.split("\n", 5).join("\n").match(/\t/g) || []).length > 4 ? "\t" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length && rows.length < 5000; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && !cell.trim()) quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** What a file that cannot be read may still be kept as: a paper or a picture, never a program or a web page. */
function keepable(name, buf) {
  const what = sniff(buf);
  const ext = (String(name).match(/\.([A-Za-z0-9]+)$/) || [])[1] || "";
  if (what.startsWith("image/")) return { kind: "image", mime: what };
  if (what === "pdf") return { kind: "pdf", mime: "application/pdf" };
  if ((what === "zip" && /^(xlsx|docx|pptx)$/i.test(ext)) || (what === "ole" && /^(xls|doc|ppt|xlsx|docx)$/i.test(ext))) return { kind: "office", mime: "application/octet-stream" };
  return null;
}

const MIME = { pdf: "application/pdf", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", csv: "text/csv", text: "text/plain" };
const cleanName = (n) => String(n || "document").replace(/[\\/\r\n\t"<>|:*?\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "document";

/**
 * @returns { kind: "pdf" | "xlsx" | "csv" | "text" | "docx" | "image", name, mime, size, rows, text, pages, note, locked,
 *            image?: { mediaType, data } }
 * @throws LoanFileError — code "password" when the PDF needs (another) password
 */
function readLoanFile(nameIn, buf, { password = "" } = {}) {
  const name = cleanName(nameIn);
  if (!Buffer.isBuffer(buf) || !buf.length) throw new LoanFileError(`${name} is empty.`, "empty", 400);
  if (buf.length > MAX_BYTES) throw new LoanFileError(`${name} is larger than ${Math.round(MAX_BYTES / 1048576)} MB. Upload a smaller file, or only the pages that matter.`, "too_large", 413);
  const what = sniff(buf);
  const base = { name, size: buf.length, pages: 0, note: "", locked: false };
  if (what.startsWith("image/")) {
    if (buf.length > MAX_IMAGE) throw new LoanFileError(`${name} is too large as a picture (over ${Math.round(MAX_IMAGE / 1048576)} MB).`, "too_large", 413);
    return { ...base, kind: "image", mime: what, rows: [], text: "", image: { mediaType: what, data: buf.toString("base64") } };
  }
  if (what === "pdf") {
    let r;
    try {
      r = pdfRows(buf, { password, maxPages: PDF_PAGES, pictures: SCAN_PAGES });
    } catch (err) {
      if (err && err.code === "password") throw new LoanFileError(err.message, "password", 422);
      throw new LoanFileError(`${name}: ${err && err.message ? err.message : "could not be read"}`);
    }
    if (!r.text) {
      const err = new LoanFileError(`${name} has no text in it: it looks scanned (pictures of pages). Upload a screenshot or photo of the page, which the free AI can read, or download the PDF from the lender’s website instead.`, "scanned");
      err.scans = r.scans;
      err.pages = r.pages;
      err.locked = r.locked;
      throw err;
    }
    return { ...base, kind: "pdf", mime: MIME.pdf, rows: r.rows, text: r.text, pages: r.pages, note: r.note, locked: r.locked, scans: r.scans };
  }
  if (what === "ole") throw new LoanFileError(`${name} is an old Office file (.xls or .doc), or a locked Excel file. Save it as .xlsx, .csv or PDF and upload that.`, "unsupported", 415);
  if (what === "zip") {
    let inner = [];
    try {
      inner = Object.keys(unzip(buf, (n) => /^(word\/document\.xml|xl\/workbook\.xml)$/.test(n)));
    } catch (_) {
      inner = [];
    }
    if (inner.includes("xl/workbook.xml")) {
      let sheets;
      try {
        sheets = readXlsx(buf);
      } catch (err) {
        throw new LoanFileError(`${name}: ${err.message}`);
      }
      const rows = sheets.slice(0, 8).flatMap((s) => fromSheet(s.rows.slice(0, 3000)));
      return { ...base, kind: "xlsx", mime: MIME.xlsx, rows, text: rows.map((r) => r.filter(Boolean).join("  ")).filter(Boolean).join("\n") };
    }
  }
  let read;
  try {
    // a loan paper is read whole: a long agreement matters to its last page
    read = readAttachment(name, buf, { maxText: 400000, maxRows: 5000 });
  } catch (err) {
    throw new LoanFileError(err.message, err.code || "unreadable", err.status || 422);
  }
  const docx = what === "zip";
  const isCsv = /\.(csv|tsv)$/i.test(name);
  const full = isCsv ? buf.toString("utf8").replace(/^﻿/, "") : read.text;
  const rows = isCsv ? csvRows(full) : full.split(/\r?\n/).map((l) => l.split(/\s*\|\s*|\t|\s{2,}/));
  return { ...base, kind: docx ? "docx" : isCsv ? "csv" : "text", mime: docx ? MIME.docx : isCsv ? MIME.csv : MIME.text, rows, text: isCsv ? rows.map((r) => r.join("  ")).join("\n") : full };
}

/**
 * The same, for keeping: a scanned, old-format or unreadable paper comes back as it is, marked `unread` with the reason,
 * so it can be saved with its loan and viewed later. A password-protected one does so only when `keep` says to leave it
 * closed (otherwise its password is asked for).
 */
function readOrKeep(nameIn, buf, { password = "", keep = false } = {}) {
  try {
    return readLoanFile(nameIn, buf, { password });
  } catch (err) {
    if (!(err instanceof LoanFileError)) throw err;
    if (!["scanned", "unsupported", "unreadable", "password"].includes(err.code) || (err.code === "password" && !keep)) throw err;
    const name = cleanName(nameIn);
    const as = keepable(name, buf);
    if (!as) throw err;
    const unread = err.code === "password" ? "It is kept locked, as it came: its details were not read. Open it with its password when you view it." : err.message;
    return { name, size: buf.length, pages: err.pages || 0, note: "", locked: err.code === "password" || Boolean(err.locked), rows: [], text: "", unread, scans: err.scans || [], ...as };
  }
}

module.exports = { readLoanFile, readOrKeep, csvRows, cleanName, LoanFileError, MAX_BYTES };
