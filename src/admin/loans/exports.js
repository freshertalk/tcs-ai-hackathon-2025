// The Loans page's downloads, made in the browser from what is on the page (nothing is sent anywhere):
//   CSV    the detailed table, UTF-8 with its mark so Excel reads ₹ and Hindi rightly; text that a spreadsheet would take
//          for a formula is written as text
//   Excel  a real .xlsx workbook (a ZIP of XML parts, written here — no library): a sheet per table, headings frozen,
//          amounts as numbers, dates as dates
//   PDF    A4 landscape with jsPDF (already one of the site's libraries, loaded only when asked): headings repeated on each
//          page, totals, page numbers. Its built-in fonts have no ₹ sign or Indian scripts, so amounts say "Rs" and other
//          letters it cannot draw show as "?" (the CSV and Excel files keep them).

/* ------------------------------------------------------------------ CSV */
const csvCell = (v) => {
  let s = v === null || v === undefined ? "" : String(v);
  // a cell starting with = + - @ (or a tab) would run as a formula in a spreadsheet
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(tables, stamp = []) {
  const list = Array.isArray(tables) ? tables : [tables];
  const out = [];
  list.forEach((table, i) => {
    const line = (r) => table.columns.map((c) => csvCell(r[c.key] === undefined ? "" : r[c.key])).join(",");
    // with more than one table, each is named above its headings
    if (list.length > 1) out.push(...(i ? [""] : []), csvCell(table.title));
    out.push(table.columns.map((c) => csvCell(c.label)).join(","), ...table.rows.map(line));
    if (table.totals) out.push(line(table.totals));
  });
  if (stamp.length) out.push("", ...stamp.map((s) => csvCell(s)));
  return `﻿${out.join("\r\n")}\r\n`;
}

/* ------------------------------------------------------------------ Excel (.xlsx) */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const utf8 = (s) => {
  const out = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
};
/** A ZIP with its parts stored as they are (no compression: these files are small). */
function zip(parts) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const head = (size, fill) => {
    const b = new Uint8Array(size);
    fill(new DataView(b.buffer));
    return b;
  };
  parts.forEach(([name, body]) => {
    const at = offset;
    const n = utf8(name);
    const data = utf8(body);
    const crc = crc32(data);
    const local = head(30, (v) => {
      v.setUint32(0, 0x04034b50, true);
      v.setUint16(4, 20, true);
      v.setUint16(12, 0x0021, true); // 1 January 1980: the file's own date is not the point
      v.setUint32(14, crc, true);
      v.setUint32(18, data.length, true);
      v.setUint32(22, data.length, true);
      v.setUint16(26, n.length, true);
    });
    chunks.push(local, n, data);
    central.push(
      head(46, (v) => {
        v.setUint32(0, 0x02014b50, true);
        v.setUint16(4, 20, true);
        v.setUint16(6, 20, true);
        v.setUint16(14, 0x0021, true);
        v.setUint32(16, crc, true);
        v.setUint32(20, data.length, true);
        v.setUint32(24, data.length, true);
        v.setUint16(28, n.length, true);
        v.setUint32(42, at, true);
      }),
      n
    );
    offset = at + 30 + n.length + data.length;
  });
  const size = central.reduce((a, b) => a + b.length, 0);
  const end = head(22, (v) => {
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, parts.length, true);
    v.setUint16(10, parts.length, true);
    v.setUint32(12, size, true);
    v.setUint32(16, offset, true);
  });
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

const xml = (s) =>
  String(s)
    // characters XML 1.0 does not allow
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const colName = (i) => (i >= 26 ? colName(Math.floor(i / 26) - 1) : "") + String.fromCharCode(65 + (i % 26));
const excelDay = (d) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000);
// cell styles, in the order of styles.xml's cellXfs below
const S = { text: 0, head: 1, money: 2, rate: 3, date: 4, int: 5, boldText: 6, boldMoney: 7, title: 8 };
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="[&gt;=10000000]##\\,##\\,##\\,##0.00;[&gt;=100000]##\\,##\\,##0.00;##,##0.00"/><numFmt numFmtId="165" formatCode="0.00"/><numFmt numFmtId="166" formatCode="dd\\-mmm\\-yyyy"/></numFmts><fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E79"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><top style="thin"/></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="9"><xf numFmtId="0" fontId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="3" fillId="2" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf><xf numFmtId="165" fontId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf><xf numFmtId="166" fontId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf><xf numFmtId="1" fontId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf><xf numFmtId="0" fontId="1" borderId="1" xfId="0" applyFont="1" applyBorder="1"/><xf numFmtId="164" fontId="1" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/><xf numFmtId="0" fontId="2" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function cell(ref, value, type, total = false) {
  if (value === null || value === undefined || value === "") return total ? `<c r="${ref}" s="${S.boldText}"/>` : "";
  if (type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) return `<c r="${ref}" s="${S.date}"><v>${excelDay(value)}</v></c>`;
  if (typeof value === "number" && Number.isFinite(value)) {
    const style = total ? S.boldMoney : type === "money" ? S.money : type === "rate" ? S.rate : S.int;
    return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  }
  // text is stored as text (an inline string): it can never run as a formula
  return `<c r="${ref}" s="${total ? S.boldText : S.text}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function sheetXml(table, stamp) {
  const cols = table.columns;
  const rows = [];
  const at = (r, i) => `${colName(i)}${r}`;
  rows.push(`<row r="1" ht="20" customHeight="1"><c r="A1" s="${S.title}" t="inlineStr"><is><t>${xml(table.title)}</t></is></c></row>`);
  stamp.forEach((s, k) => rows.push(`<row r="${2 + k}"><c r="A${2 + k}" t="inlineStr"><is><t>${xml(s)}</t></is></c></row>`));
  const headAt = stamp.length + 3;
  rows.push(`<row r="${headAt}" ht="30" customHeight="1">${cols.map((c, i) => `<c r="${at(headAt, i)}" s="${S.head}" t="inlineStr"><is><t>${xml(c.label)}</t></is></c>`).join("")}</row>`);
  table.rows.forEach((row, k) => {
    const n = headAt + 1 + k;
    rows.push(`<row r="${n}">${cols.map((c, i) => cell(at(n, i), row[c.key], c.type)).join("")}</row>`);
  });
  const last = headAt + table.rows.length;
  if (table.totals) {
    const r = last + 1;
    rows.push(`<row r="${r}">${cols.map((c, i) => cell(at(r, i), table.totals[c.key], c.type, true)).join("")}</row>`);
  }
  const widths = cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(8, Math.round(c.w * 2.1))}" customWidth="1"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0"><pane ySplit="${headAt}" topLeftCell="A${headAt + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${widths}</cols><sheetData>${rows.join("")}</sheetData>${table.rows.length ? `<autoFilter ref="A${headAt}:${colName(cols.length - 1)}${last}"/>` : ""}<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}

/** The tables as one workbook's bytes. */
export function toXlsx(tables, stamp = []) {
  const used = new Set();
  const names = tables.map((t, i) => {
    let n = String(t.name || `Sheet ${i + 1}`).replace(/[[\]:*?/\\]/g, " ").slice(0, 31).trim() || `Sheet ${i + 1}`;
    while (used.has(n.toLowerCase())) n = `${n.slice(0, 28)} ${i + 1}`;
    used.add(n.toLowerCase());
    return n;
  });
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${tables.map((t, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const book = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`;
  const bookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${tables.map((t, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${tables.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  return zip([["[Content_Types].xml", types], ["_rels/.rels", rels], ["xl/workbook.xml", book], ["xl/_rels/workbook.xml.rels", bookRels], ["xl/styles.xml", STYLES], ...tables.map((t, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(t, stamp)])]);
}

/* ------------------------------------------------------------------ PDF */
/** What jsPDF's built-in fonts can draw. */
export const pdfSafe = (s) =>
  String(s === null || s === undefined ? "" : s)
    .replace(/₹/g, "Rs ")
    .replace(/[–—−]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/→/g, "->")
    .replace(/[^ -ÿ\n]/g, "?");
const dmy = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? `${d.slice(8)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : d);
const shown = (v, type) => {
  if (v === null || v === undefined || v === "") return "";
  if (type === "date") return dmy(v);
  if (type === "money" && typeof v === "number") return v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (type === "rate" && typeof v === "number") return v.toLocaleString("en-IN", { maximumFractionDigits: 3 });
  return String(v);
};
const RIGHT = new Set(["money", "rate", "int"]);

/** The document, drawn. `JsPDF` is the library's class (passed in so the page loads it only when asked). */
export function drawPdf(JsPDF, set, { stamp = [], summary = [] } = {}) {
  const doc = new JsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 9;
  let y = M + 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(20, 20, 20);
  doc.text(pdfSafe(set.title), M, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(90, 90, 90);
  for (const line of [...stamp, ...summary, "All amounts are in Indian rupees (Rs)."]) {
    for (const part of doc.splitTextToSize(pdfSafe(line), W - 2 * M)) {
      y += 4;
      doc.text(part, M, y);
    }
  }
  y += 5;
  set.tables.forEach((table, t) => {
    // columns marked pdf: false are kept for the spreadsheets: a page has no room for them
    const cols = table.columns.filter((c) => c.pdf !== false);
    const all = cols.reduce((a, c) => a + c.w, 0);
    const widths = cols.map((c) => ((W - 2 * M) * c.w) / all);
    const x = widths.reduce((a, w, i) => (i ? [...a, a[i - 1] + widths[i - 1]] : [M]), []);
    const wrap = (row, bold) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      return cols.map((c, i) => doc.splitTextToSize(pdfSafe(shown(row[c.key], row === table.totals && typeof row[c.key] === "string" ? "text" : c.type)), widths[i] - 1.6));
    };
    const draw = (cells, h, { bold = false, fill = null, ink = [30, 30, 30] } = {}) => {
      if (fill) {
        doc.setFillColor(...fill);
        doc.rect(M, y, W - 2 * M, h, "F");
      }
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setTextColor(...ink);
      cells.forEach((lines, i) => {
        const right = RIGHT.has(cols[i].type);
        lines.forEach((l, k) => doc.text(l, right ? x[i] + widths[i] - 0.8 : x[i] + 0.8, y + 3.2 + k * 3.2, right ? { align: "right" } : undefined));
      });
      y += h;
      doc.setDrawColor(222, 222, 222);
      doc.line(M, y, W - M, y);
    };
    const high = (cells) => Math.max(1, ...cells.map((c) => c.length)) * 3.2 + 1.8;
    const header = () => {
      doc.setFontSize(7.2);
      const cells = wrap(Object.fromEntries(cols.map((c) => [c.key, c.label])), true);
      // headings are words even over a column of numbers
      doc.setFont("helvetica", "bold");
      draw(cols.map((c, i) => doc.splitTextToSize(pdfSafe(c.label), widths[i] - 1.6)), high(cells), { bold: true, fill: [31, 78, 121], ink: [255, 255, 255] });
      doc.setFontSize(cols.length > 12 ? 6.8 : 7.4);
    };
    if (set.tables.length > 1) {
      if (t > 0 && y > H - 40) {
        doc.addPage();
        y = M;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.setTextColor(20, 20, 20);
      doc.text(pdfSafe(table.title), M, y + 3);
      y += 6;
    }
    header();
    table.rows.forEach((row, i) => {
      const cells = wrap(row, false);
      const h = high(cells);
      if (y + h > H - 12) {
        doc.addPage();
        y = M;
        header();
      }
      draw(cells, h, { fill: i % 2 ? [247, 248, 250] : null });
    });
    if (!table.rows.length) draw([["No rows"], ...cols.slice(1).map(() => [""])], 5);
    if (table.totals) {
      const cells = wrap(table.totals, true);
      if (y + high(cells) > H - 12) {
        doc.addPage();
        y = M;
        header();
      }
      draw(cells, high(cells), { bold: true, fill: [234, 239, 246] });
    }
    y += 6;
  });
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(110, 110, 110);
    doc.text("DrishtiAI - loan book", M, H - 5);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 5, { align: "right" });
  }
  return doc;
}

/* ------------------------------------------------------------------ saving to the device */
export function saveFile(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function download(kind, set, { stamp = [], summary = [] } = {}) {
  if (kind === "csv") return saveFile(`${set.file}.csv`, toCsv(set.tables.length > 1 ? set.tables : set.detail, stamp), "text/csv;charset=utf-8");
  if (kind === "xlsx") return saveFile(`${set.file}.xlsx`, toXlsx(set.tables, stamp), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const { jsPDF } = await import("jspdf");
  return saveFile(`${set.file}.pdf`, drawPdf(jsPDF, set, { stamp, summary }).output("arraybuffer"), "application/pdf");
}
