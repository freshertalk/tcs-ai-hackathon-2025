"use strict";
// A small reader for .xlsx files (Excel 2007+), enough for the tradebooks Zerodha Console gives:
// every sheet as rows of cell text. No library: an .xlsx file is a ZIP of XML parts, read here with
// Node's own zlib. Formulas are read as their saved results; styles and formatting are ignored
// (a date stored as a number is returned as that number — the caller turns it into a date).

const zlib = require("node:zlib");

const MAX_ENTRY = 120 * 1024 * 1024; // an unpacked part larger than this is refused (a zip bomb)

/** ZIP → { name: Buffer } for the parts asked for (or all). */
function unzip(buf, want = null) {
  if (!Buffer.isBuffer(buf) || buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) throw new Error("This is not an .xlsx file.");
  // the end-of-central-directory record is within the last 64 KB + 22 bytes
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("The .xlsx file is damaged (no central directory).");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let k = 0; k < count; k += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("The .xlsx file is damaged.");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (want && !want(name)) continue;
    if (usize > MAX_ENTRY) throw new Error("The .xlsx file is too large to read.");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    if (method === 0) out[name] = Buffer.from(data);
    else if (method === 8) out[name] = zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRY });
    else throw new Error(`The .xlsx file uses a compression this reader does not know (${method}).`);
  }
  return out;
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()]));
/** The text of every <t> inside a piece of XML (a shared string can be split into runs). */
const textOf = (xml) => {
  let out = "";
  xml.replace(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, (m, t) => {
    out += decode(t);
    return m;
  });
  return out;
};
/** "BC" → 54 (0-based column index) */
const colIndex = (letters) => [...letters].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;

/**
 * @returns [{ name, rows: [[cell text, ...], ...] }] in workbook order
 */
function readXlsx(buf) {
  const parts = unzip(buf, (n) => /^xl\/(workbook\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml)$/.test(n));
  const shared = [];
  if (parts["xl/sharedStrings.xml"]) {
    parts["xl/sharedStrings.xml"].toString("utf8").replace(/<si>([\s\S]*?)<\/si>/g, (m, si) => {
      shared.push(textOf(si));
      return m;
    });
  }
  // the sheets in workbook order, through the relationships file
  const rels = {};
  if (parts["xl/_rels/workbook.xml.rels"]) {
    parts["xl/_rels/workbook.xml.rels"].toString("utf8").replace(/<Relationship\b([^>]*)\/?>/g, (m, attrs) => {
      const id = /\bId="([^"]+)"/.exec(attrs);
      const target = /\bTarget="([^"]+)"/.exec(attrs);
      if (id && target) rels[id[1]] = target[1].replace(/^\/?xl\//, "").replace(/^\//, "");
      return m;
    });
  }
  const sheets = [];
  if (parts["xl/workbook.xml"]) {
    parts["xl/workbook.xml"].toString("utf8").replace(/<sheet\b([^>]*)\/?>/g, (m, attrs) => {
      const name = /\bname="([^"]*)"/.exec(attrs);
      const rid = /\br:id="([^"]+)"/.exec(attrs) || /\bid="([^"]+)"/.exec(attrs);
      const target = rid && rels[rid[1]];
      if (target) sheets.push({ name: name ? decode(name[1]) : target, path: `xl/${target}` });
      return m;
    });
  }
  if (!sheets.length) for (const k of Object.keys(parts).filter((n) => n.startsWith("xl/worksheets/")).sort()) sheets.push({ name: k.replace(/^.*\//, "").replace(/\.xml$/, ""), path: k });
  return sheets
    .filter((sh) => parts[sh.path])
    .map((sh) => {
      const xml = parts[sh.path].toString("utf8");
      const rows = [];
      xml.replace(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g, (m, attrs, body) => {
        const row = [];
        if (body) {
          let next = 0;
          body.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (mc, cattrs, inner = "") => {
            const ref = /\br="([A-Z]+)\d+"/.exec(cattrs);
            const idx = ref ? colIndex(ref[1]) : next;
            next = idx + 1;
            const type = (/\bt="([^"]+)"/.exec(cattrs) || [])[1] || "";
            const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
            let val = "";
            if (type === "s") val = v ? shared[Number(v[1])] || "" : "";
            else if (type === "inlineStr") val = textOf(inner);
            else if (type === "b") val = v ? (v[1] === "1" ? "TRUE" : "FALSE") : "";
            else val = v ? decode(v[1]) : "";
            while (row.length < idx) row.push("");
            row[idx] = val;
            return mc;
          });
        }
        rows.push(row);
        return m;
      });
      return { name: sh.name, rows };
    });
}

module.exports = { readXlsx, unzip };
