// A small Word (.docx) writer for the Document and the AI Engine — no library, made in the browser.
//
// A .docx is a ZIP of a few XML files. This writes the ZIP with the "stored" method (no compression,
// which Word reads happily) and a CRC-32 per file, and the XML for headings, paragraphs, bullet and
// numbered lists, tables, notes and code blocks, with **bold** and `code` inside a line.
//
// Input: { title, subtitle, parts, chapters, appendix } where chapters use the same blocks as the
// Document ({ h }, { p }, { ul }, { ol }, { dl }, { table }, { note }, { warn }, { logic }), plus
// { pre } for preformatted text (the AI's real instructions).

/* ---------------------------------------------------------------------------------- XML */
const esc = (s) =>
  String(s === undefined || s === null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // characters XML 1.0 does not allow
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

function runs(text, { bold = false, color = "" } = {}) {
  const out = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  const src = String(text || "");
  let last = 0;
  let m;
  const run = (t, b, code) => {
    if (!t) return;
    // Word wants the run properties in the schema's order: fonts, bold, colour, shading
    const pr = `${code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>' : ""}${b || bold ? "<w:b/>" : ""}${color ? `<w:color w:val="${color}"/>` : ""}${code ? '<w:shd w:val="clear" w:color="auto" w:fill="EFEFEF"/>' : ""}`;
    out.push(`<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`);
  };
  while ((m = re.exec(src))) {
    run(src.slice(last, m.index), false, false);
    if (m[1] !== undefined) run(m[1], true, false);
    else run(m[2], false, true);
    last = m.index + m[0].length;
  }
  run(src.slice(last), false, false);
  return out.join("");
}

const para = (text, { style = "", bold = false, color = "", indent = 0, justify = false, shade = "" } = {}) => {
  const pPr = `${style ? `<w:pStyle w:val="${style}"/>` : ""}${shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : ""}${indent ? `<w:ind w:left="${indent}" w:hanging="${Math.min(indent, 280)}"/>` : ""}${justify ? '<w:jc w:val="both"/>' : ""}`;
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${runs(text, { bold, color })}</w:p>`;
};

function table(head, rows) {
  const cell = (t, h) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${h ? '<w:shd w:val="clear" w:color="auto" w:fill="E7ECF2"/>' : ""}</w:tcPr><w:p>${runs(t, { bold: h })}</w:p></w:tc>`;
  const border = (n) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="B8C2CC"/>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${head.map(() => `<w:gridCol w:w="${Math.floor(9638 / head.length)}"/>`).join("")}</w:tblGrid><w:tr><w:trPr><w:tblHeader/></w:trPr>${head.map((h) => cell(h, true)).join("")}</w:tr>${rows.map((r) => `<w:tr>${r.map((c) => cell(c, false)).join("")}</w:tr>`).join("")}</w:tbl>${para("")}`;
}

function block(b) {
  if (b.h) return para(b.h, { style: "Heading3" });
  if (b.p) return para(b.p, { justify: true });
  if (b.ul) return b.ul.map((t) => para(`•\t${t}`, { indent: 360, justify: true })).join("");
  if (b.ol) return b.ol.map((t, i) => para(`${i + 1}.\t${t}`, { indent: 360, justify: true })).join("");
  if (b.dl) return b.dl.map(([t, d]) => para(`**${t}** — ${d}`, { justify: true })).join("");
  if (b.table) return table(b.table.head, b.table.rows);
  if (b.note) return para(b.note, { shade: "EAF2FB", justify: true });
  if (b.warn) return para(b.warn, { shade: "FDF3E2", justify: true });
  if (b.pre)
    return String(b.pre)
      .split("\n")
      .map((line) => `<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F4F4F4"/><w:spacing w:after="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`)
      .join("") + para("");
  if (b.logic) {
    const l = b.logic;
    return [
      para(`How it works — ${l.title}`, { style: "Heading4" }),
      l.who ? para(`**Who does it:** ${l.who}`, { justify: true }) : "",
      l.when ? para(`**When:** ${l.when}`, { justify: true }) : "",
      ...(l.steps || []).map((t, i) => para(`${i + 1}.\t${t}`, { indent: 360, justify: true })),
      l.limits ? para(`**Limits & honest notes.** ${l.limits}`, { shade: "F3F4F6", justify: true }) : "",
    ].join("");
  }
  return "";
}

function documentXml({ title, subtitle, parts, chapters, appendix = [] }) {
  const body = [];
  body.push(para(title, { style: "Title" }));
  if (subtitle) body.push(para(subtitle, { style: "Subtitle" }));
  body.push(para(`Downloaded ${new Date().toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" })}`, { color: "6B7280" }));
  // contents
  body.push(para("Contents", { style: "Heading1" }));
  (parts || [{ id: "_", title: "" }]).forEach((p) => {
    const list = chapters.filter((c) => !parts || c.part === p.id);
    if (!list.length) return;
    if (p.title) body.push(para(p.title, { bold: true }));
    list.forEach((c, i) => body.push(para(`${c.no || i + 1}. ${c.title}`, { indent: 360 })));
  });
  appendix.forEach((a) => body.push(para(a.title, { indent: 360 })));
  // chapters
  (parts || [{ id: "_", title: "" }]).forEach((p) => {
    const list = chapters.filter((c) => !parts || c.part === p.id);
    if (!list.length) return;
    list.forEach((c, i) => {
      body.push(`<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:pageBreakBefore/></w:pPr>${runs(`${c.no || i + 1}. ${c.title}`)}</w:p>`);
      if (c.intro) body.push(para(c.intro, { shade: "EEF4FF", justify: true }));
      c.blocks.forEach((b) => body.push(block(b)));
    });
  });
  appendix.forEach((a) => {
    body.push(`<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:pageBreakBefore/></w:pPr>${runs(a.title)}</w:p>`);
    if (a.intro) body.push(para(a.intro, { justify: true }));
    a.blocks.forEach((b) => body.push(block(b)));
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Mangal" w:eastAsia="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-IN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3B57"/><w:sz w:val="48"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="4B5563"/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3B57"/><w:sz w:val="34"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:color w:val="27496D"/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="60"/><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:color w:val="9A6A00"/><w:sz w:val="23"/></w:rPr></w:style>
</w:styles>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
const core = (title) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`;

/* ---------------------------------------------------------------------------------- ZIP */
let CRC_TABLE = null;
export function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Files → the bytes of a ZIP archive (stored, not compressed). */
export function zip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true); // version needed
    dv.setUint16(6, 0x0800, true); // UTF-8 names
    dv.setUint16(8, 0, true); // stored
    dv.setUint16(10, 0, true);
    dv.setUint16(12, 0x21, true); // 1 Jan 1980
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, name.length, true);
    dv.setUint16(28, 0, true);
    local.set(name, 30);
    parts.push(local, data);
    const c = new Uint8Array(46 + name.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    c.set(name, 46);
    central.push(c);
    offset += local.length + data.length;
  }
  const size = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, size, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of all) {
    out.set(a, at);
    at += a.length;
  }
  return out;
}

/** The bytes of a .docx for this content. */
export function docxBytes(content) {
  return zip([
    { name: "[Content_Types].xml", data: CONTENT_TYPES },
    { name: "_rels/.rels", data: RELS },
    { name: "docProps/core.xml", data: core(content.title) },
    { name: "word/document.xml", data: documentXml(content) },
    { name: "word/styles.xml", data: STYLES },
    { name: "word/_rels/document.xml.rels", data: DOC_RELS },
  ]);
}

/** Make the .docx and hand it to the browser as a download. */
export function downloadDocx(filename, content) {
  const blob = new Blob([docxBytes(content)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
