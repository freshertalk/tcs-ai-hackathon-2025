"use strict";
// A small PDF text reader (26 Nov 2026) — enough for the PDFs a trader attaches: contract notes, statements, reports saved from Word,
// a browser or an accounting system. No library; nothing is run. It reads what the file says, in this order:
//   1. every object (also those packed inside object streams), by scanning for "N G obj" — so a damaged cross-reference table does not matter
//   2. the page tree from the catalogue, so pages come out in order
//   3. each page's content streams (FlateDecode; anything else is skipped) and its fonts: a font's ToUnicode map turns glyph codes into
//      letters (almost every modern PDF needs it); a simple font without one is read as Windows-1252
//   4. the text operators (Tj TJ ' ") with line breaks where the text moves down, spaces where TJ jumps, and form XObjects (Do) read too
// Not handled, and said so: password-protected files, scanned pages (pictures of text: there is no text to take out), and streams with
// a filter other than Flate. The caller gets the text, the number of pages and a note about anything left out.

const zlib = require("node:zlib");
const { decryptorFor } = require("./pdf-crypt");

const MAX_PAGES = 60;
const MAX_CHARS = 120000;
const MAX_STREAM = 25 * 1024 * 1024;

class PdfError extends Error {}

/* ------------------------------------------------------------------------------------------------ objects */
const latin = (buf) => buf.toString("latin1");

function inflate(buf) {
  try {
    return zlib.inflateSync(buf, { maxOutputLength: MAX_STREAM });
  } catch (_) {
    try {
      return zlib.inflateRawSync(buf.subarray(2), { maxOutputLength: MAX_STREAM }); // a damaged zlib header
    } catch (__) {
      return null;
    }
  }
}

/** The value of /Key in a dictionary text: a number, a name, a reference "N G R", a dictionary or an array, as text. */
function entry(dict, key) {
  const re = new RegExp(`/${key}(?![A-Za-z0-9_.])\\s*`, "g");
  const m = re.exec(dict);
  if (!m) return null;
  return grab(dict, m.index + m[0].length);
}
function grab(s, i) {
  const c = s[i];
  if (c === "<" && s[i + 1] === "<") return balanced(s, i, "<<", ">>");
  if (c === "[") return balanced(s, i, "[", "]");
  if (c === "(") {
    let d = 0;
    let j = i;
    for (; j < s.length; j += 1) {
      if (s[j] === "\\") j += 1;
      else if (s[j] === "(") d += 1;
      else if (s[j] === ")") {
        d -= 1;
        if (!d) break;
      }
    }
    return s.slice(i, j + 1);
  }
  const m = /^(\/[^\s/<>[\]()]+|\d+\s+\d+\s+R|[-+]?\d*\.?\d+|true|false|null|<[0-9A-Fa-f\s]*>)/.exec(s.slice(i, i + 200));
  return m ? m[0] : null;
}
function balanced(s, i, open, close) {
  let d = 0;
  for (let j = i; j < s.length; j += 1) {
    if (s.startsWith(open, j)) {
      d += 1;
      j += open.length - 1;
    } else if (s.startsWith(close, j)) {
      d -= 1;
      j += close.length - 1;
      if (!d) return s.slice(i, j + 1);
    }
  }
  return s.slice(i);
}
const refOf = (v) => {
  const m = v && /^(\d+)\s+\d+\s+R$/.exec(v.trim());
  return m ? Number(m[1]) : null;
};
const refsIn = (v) => [...String(v || "").matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));

/** A stream's declared /Length: the number itself, or the number in the object it points to; null when not found. */
function lengthOf(text, dict) {
  const m = /\/Length(?![A-Za-z0-9])\s+(\d+)(\s+(\d+)\s+R)?/.exec(dict);
  if (!m) return null;
  if (!m[2]) return Number(m[1]);
  const at = new RegExp(`(?:^|[\\r\\n\\s])${m[1]}\\s+${m[3]}\\s+obj\\s+(\\d+)\\s+endobj`).exec(text);
  return at ? Number(at[1]) : null;
}

/** Every object of the file: number → { dict (text), stream (Buffer | null) }. Objects inside object streams are added. */
function readObjects(buf, unlock = null) {
  const text = latin(buf);
  const objs = new Map();
  const re = /(?:^|[\r\n\s])(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(text))) {
    const num = Number(m[1]);
    const start = m.index + m[0].length;
    const end = text.indexOf("endobj", start);
    const body = text.slice(start, end < 0 ? Math.min(text.length, start + 200000) : end);
    const si = body.search(/stream\r?\n|stream\r/);
    let dict = body;
    let stream = null;
    if (si >= 0) {
      dict = body.slice(0, si);
      const from = start + si + (/^stream\r\n/.test(body.slice(si)) ? 8 : 7);
      let to = text.indexOf("endstream", from);
      if (to < 0) to = end < 0 ? text.length : end;
      // the file says how long the stream is: that is used whenever "endstream" really follows it. Trimming line ends off
      // instead can cut a byte of the data itself (a locked or packed stream may end in one) — and lose what it holds.
      const said = lengthOf(text, dict);
      if (said !== null && from + said <= buf.length && /^[\s]{0,3}endstream/.test(text.substr(from + said, 12))) to = from + said;
      else {
        // the stream ends before the end-of-line that precedes "endstream"
        if (buf[to - 1] === 0x0a) to -= 1;
        if (buf[to - 1] === 0x0d) to -= 1;
      }
      stream = buf.subarray(from, to);
    }
    objs.set(num, { dict: dict.trim(), stream, gen: Number(m[2]) });
    if (end > 0) re.lastIndex = end;
  }
  // a password-protected file: every stream is opened first (the objects packed in streams come out readable)
  const open = unlock ? unlock(text, objs) : null;
  if (open) for (const [n, o] of objs) if (o.stream && !/\/Type\s*\/XRef/.test(o.dict)) o.stream = open(n, o.gen || 0, o.stream);
  // objects packed in object streams
  for (const o of [...objs.values()]) {
    if (!o.stream || !/\/Type\s*\/ObjStm/.test(o.dict)) continue;
    const data = decoded(o);
    if (!data) continue;
    const n = Number(entry(o.dict, "N"));
    const first = Number(entry(o.dict, "First"));
    if (!Number.isFinite(n) || !Number.isFinite(first)) continue;
    const t = latin(data);
    const head = t.slice(0, first).trim().split(/\s+/).map(Number);
    for (let k = 0; k < n; k += 1) {
      const num = head[k * 2];
      const off = head[k * 2 + 1];
      const next = k + 1 < n ? head[(k + 1) * 2 + 1] : t.length - first;
      if (Number.isFinite(num) && !objs.has(num)) objs.set(num, { dict: t.slice(first + off, first + next).trim(), stream: null });
    }
  }
  return objs;
}

/** The decoded bytes of a stream object, or null when its filter is not Flate. */
function decoded(o) {
  if (!o || !o.stream) return null;
  const f = entry(o.dict, "Filter");
  if (!f) return o.stream;
  if (/^\/FlateDecode$|^\/Fl$|^\[\s*\/FlateDecode\s*\]$/.test(f.trim())) {
    const out = inflate(o.stream);
    // a predictor (PNG up/sub) on a content stream is rare; object and xref streams are not text
    return out;
  }
  return null;
}

/* ------------------------------------------------------------------------------------------------ fonts */
/** A ToUnicode CMap → { bytes, map: Map(code → string) } */
function readCMap(text) {
  const map = new Map();
  let bytes = 1;
  const cs = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(text);
  if (cs) {
    const h = /<([0-9A-Fa-f]+)>/.exec(cs[1]);
    if (h) bytes = Math.max(1, Math.round(h[1].length / 2));
  }
  const uni = (hex) => {
    let s = "";
    for (let i = 0; i + 3 < hex.length + 1; i += 4) s += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    return s;
  };
  for (const b of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of b[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) map.set(parseInt(p[1], 16), uni(p[2]));
  }
  for (const b of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const p of b[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<([0-9A-Fa-f]+)>|\[([^\]]*)\])/g)) {
      const lo = parseInt(p[1], 16);
      const hi = Math.min(parseInt(p[2], 16), lo + 65535);
      if (p[4] !== undefined) {
        const base = uni(p[4]);
        for (let c = lo; c <= hi; c += 1) map.set(c, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + (c - lo)));
      } else {
        const list = [...(p[5] || "").matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => uni(x[1]));
        for (let c = lo; c <= hi && c - lo < list.length; c += 1) map.set(c, list[c - lo]);
      }
    }
  }
  return { bytes, map };
}

/** Windows-1252 for the bytes 0x80–0x9F; the rest is Latin-1. */
const CP1252 = { 0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ" };

function loadFont(objs, ref, cache) {
  if (cache.has(ref)) return cache.get(ref);
  const o = objs.get(ref);
  const font = { bytes: 1, map: null, simple: true };
  cache.set(ref, font);
  if (!o) return font;
  const tu = refOf(entry(o.dict, "ToUnicode"));
  const sub = (entry(o.dict, "Subtype") || "").trim();
  if (sub === "/Type0") font.simple = false;
  font.widths = widthsOf(objs, o.dict, sub);
  if (tu && objs.get(tu)) {
    const data = decoded(objs.get(tu));
    if (data) {
      const cm = readCMap(latin(data));
      font.map = cm.map;
      font.bytes = cm.bytes;
    }
  } else if (sub === "/Type0") font.bytes = 2;
  return font;
}

/** The glyph widths (1/1000 em) of a font: code → width, and the default for a code not listed. */
function widthsOf(objs, dict, sub) {
  const deref = (v) => {
    const r = refOf(v);
    return r && objs.get(r) ? objs.get(r).dict : v;
  };
  const w = { map: new Map(), dflt: sub === "/Type0" ? 1000 : 500, known: false };
  try {
    if (sub === "/Type0") {
      const d = deref(entry(dict, "DescendantFonts"));
      const desc = refsIn(entry(dict, "DescendantFonts"))[0];
      const dd = desc && objs.get(desc) ? objs.get(desc).dict : d;
      if (!dd) return w;
      const dw = entry(dd, "DW");
      if (dw && Number.isFinite(Number(dw))) w.dflt = Number(dw);
      const arr = deref(entry(dd, "W"));
      if (arr) {
        const toks = [...arr.matchAll(/\[[^\]]*\]|[-+]?\d*\.?\d+/g)].map((m) => m[0]);
        for (let i = 0; i < toks.length; ) {
          const c0 = Number(toks[i]);
          if (toks[i + 1] && toks[i + 1][0] === "[") {
            const list = [...toks[i + 1].matchAll(/[-+]?\d*\.?\d+/g)].map((m) => Number(m[0]));
            list.forEach((x, k) => w.map.set(c0 + k, x));
            i += 2;
          } else {
            const c1 = Number(toks[i + 1]);
            const x = Number(toks[i + 2]);
            for (let c = c0; c <= c1 && c - c0 < 70000; c += 1) w.map.set(c, x);
            i += 3;
          }
        }
      }
      w.known = true;
    } else {
      const first = Number(entry(dict, "FirstChar"));
      const arr = deref(entry(dict, "Widths"));
      if (arr && Number.isFinite(first)) {
        [...arr.matchAll(/[-+]?\d*\.?\d+/g)].forEach((m, k) => w.map.set(first + k, Number(m[0])));
        w.known = true;
      }
    }
  } catch (_) {
    /* no widths: the line-gap rule falls back to a plain one */
  }
  return w;
}

/** The distance the pen moves for these bytes, in text space units (width × size). */
function advanceOf(bytes, font, size) {
  if (!font || !font.widths || !font.widths.known) return null;
  const wd = font.widths;
  const k = font.map && font.map.size ? font.bytes || 1 : font.simple ? 1 : 2;
  let sum = 0;
  for (let i = 0; i + k <= bytes.length; i += k) {
    let code = 0;
    for (let j = 0; j < k; j += 1) code = code * 256 + bytes[i + j];
    sum += wd.map.has(code) ? wd.map.get(code) : wd.dflt;
  }
  return (sum / 1000) * size;
}

function decodeString(bytes, font) {
  let out = "";
  if (font && font.map && font.map.size) {
    const w = font.bytes || 1;
    for (let i = 0; i + w <= bytes.length; i += w) {
      let code = 0;
      for (let k = 0; k < w; k += 1) code = code * 256 + bytes[i + k];
      out += font.map.has(code) ? font.map.get(code) : w === 1 && code >= 32 ? String.fromCharCode(code) : "";
    }
    return out;
  }
  if (font && !font.simple) return ""; // glyph ids with no map: nothing readable
  for (const b of bytes) out += CP1252[b] || String.fromCharCode(b);
  return out;
}

/* ------------------------------------------------------------------------------------------------ content streams */
const WS = /[\s\0]/;
const DELIM = /[()<>[\]{}/%]/;

/** The operands and operators of a content stream, one operation at a time: { op, args }. Strings are Buffers. */
function* operations(text) {
  let i = 0;
  let args = [];
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (WS.test(c)) {
      i += 1;
    } else if (c === "%") {
      while (i < n && text[i] !== "\n" && text[i] !== "\r") i += 1;
    } else if (c === "(") {
      let d = 1;
      const out = [];
      i += 1;
      while (i < n && d > 0) {
        const ch = text[i];
        if (ch === "\\") {
          const nx = text[i + 1];
          if (nx >= "0" && nx <= "7") {
            let o = nx;
            if (text[i + 2] >= "0" && text[i + 2] <= "7") o += text[i + 2];
            if (o.length === 2 && text[i + 3] >= "0" && text[i + 3] <= "7") o += text[i + 3];
            out.push(parseInt(o, 8) & 255);
            i += 1 + o.length;
          } else {
            const map = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
            if (nx === "\r" || nx === "\n") i += nx === "\r" && text[i + 2] === "\n" ? 3 : 2;
            else {
              out.push(map[nx] !== undefined ? map[nx] : nx.charCodeAt(0));
              i += 2;
            }
          }
          continue;
        }
        if (ch === "(") d += 1;
        else if (ch === ")") {
          d -= 1;
          if (!d) {
            i += 1;
            break;
          }
        }
        out.push(ch.charCodeAt(0) & 255);
        i += 1;
      }
      args.push(Buffer.from(out));
    } else if (c === "<" && text[i + 1] === "<") {
      // a dictionary operand (inline image parameters, marked content): skipped whole
      let d = 0;
      while (i < n) {
        if (text.startsWith("<<", i)) {
          d += 1;
          i += 2;
        } else if (text.startsWith(">>", i)) {
          d -= 1;
          i += 2;
          if (!d) break;
        } else i += 1;
      }
      args.push(null);
    } else if (c === "<") {
      const e = text.indexOf(">", i);
      const hex = text.slice(i + 1, e < 0 ? n : e).replace(/\s+/g, "");
      const out = [];
      for (let k = 0; k < hex.length; k += 2) out.push(parseInt((hex.slice(k, k + 2) + "0").slice(0, 2), 16));
      args.push(Buffer.from(out));
      i = e < 0 ? n : e + 1;
    } else if (c === "[") {
      const arr = [];
      i += 1;
      const sub = [];
      // the array's items are read with the same rules, up to the matching ]
      let depth = 1;
      let j = i;
      let str = false;
      for (; j < n; j += 1) {
        const ch = text[j];
        if (str) {
          if (ch === "\\") j += 1;
          else if (ch === ")") str = false;
        } else if (ch === "(") str = true;
        else if (ch === "[") depth += 1;
        else if (ch === "]") {
          depth -= 1;
          if (!depth) break;
        }
      }
      for (const it of operations(`${text.slice(i, j)} __end__`)) {
        if (it.op === "__end__") for (const a of it.args) arr.push(a);
        else sub.push(it);
      }
      args.push(arr);
      i = j + 1;
    } else if (c === "/") {
      let j = i + 1;
      while (j < n && !WS.test(text[j]) && !DELIM.test(text[j])) j += 1;
      args.push({ name: text.slice(i + 1, j) });
      i = j;
    } else if (c === "]" || c === ">" || c === "{" || c === "}" || c === ")") {
      i += 1;
    } else {
      let j = i;
      while (j < n && !WS.test(text[j]) && !DELIM.test(text[j])) j += 1;
      const tok = text.slice(i, j);
      i = j;
      if (/^[-+]?\d*\.?\d+$/.test(tok)) args.push(Number(tok));
      else {
        if (tok === "BI") {
          // an inline image: its data is skipped up to EI
          const e = text.indexOf("EI", i);
          i = e < 0 ? n : e + 2;
          args = [];
          continue;
        }
        yield { op: tok, args };
        args = [];
      }
    }
  }
}

/** The text of one content stream. `res` gives { fonts: name → font, xobjects: name → { text, res } }. */
function streamText(data, res, depth, ctx) {
  let out = "";
  let font = null;
  let size = 10;
  let pen = 0; // how far the text has run since the current line began (text space units); null when widths are unknown
  let tmY = null;
  let tmX = 0;
  let known = true;
  const brk = () => {
    if (out && !out.endsWith("\n")) out += "\n";
    pen = 0;
  };
  const space = () => {
    if (out && !/\s$/.test(out)) out += " ";
  };
  const show = (bytes) => {
    out += decodeString(bytes, font);
    const a = advanceOf(bytes, font, size);
    if (a === null) known = false;
    else pen += a;
  };
  for (const { op, args } of operations(latin(data))) {
    if (out.length > MAX_CHARS) break;
    if (op === "Tf") {
      const nm = args[0] && args[0].name;
      font = (res.fonts && res.fonts(nm)) || null;
      if (Number.isFinite(args[1])) size = Math.abs(args[1]) || size;
      known = true;
    } else if (op === "Tj") {
      if (Buffer.isBuffer(args[0])) show(args[0]);
    } else if (op === "'" || op === '"') {
      brk();
      const s = args[args.length - 1];
      if (Buffer.isBuffer(s)) show(s);
    } else if (op === "TJ") {
      for (const it of args[0] || []) {
        if (Buffer.isBuffer(it)) show(it);
        else if (typeof it === "number") {
          if (it < -180) space();
          pen -= (it / 1000) * size;
        }
      }
    } else if (op === "Td" || op === "TD") {
      const dx = Number(args[0]) || 0;
      const dy = Number(args[1]) || 0;
      if (Math.abs(dy) > 0.5) brk();
      else if (dx > 0) {
        // the same line: a gap wider than the text just written (by more than a quarter em) is a space; a segment that carries
        // straight on from the last one — a browser splits words across runs — is not
        if (known ? dx - pen > size * 0.2 : dx > size * 3) space();
        pen = 0;
      }
    } else if (op === "T*") brk();
    else if (op === "Tm") {
      const x = Number(args[4]);
      const y = Number(args[5]);
      if (Number.isFinite(y) && (tmY === null || Math.abs(y - tmY) > 0.5)) brk();
      else if (Number.isFinite(x) && (known ? x - tmX - pen > size * 0.2 : x - tmX > size * 3)) space();
      if (Number.isFinite(y)) tmY = y;
      if (Number.isFinite(x)) tmX = x;
      pen = 0;
    } else if (op === "ET") brk();
    else if (op === "Do" && depth < 2) {
      const nm = args[0] && args[0].name;
      const x = res.xobjects && res.xobjects(nm);
      if (x) {
        brk();
        out += streamText(x.data, x.res, depth + 1, ctx);
        brk();
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------ pages */
function resourcesOf(objs, dictText, cache) {
  let r = entry(dictText, "Resources");
  const ref = refOf(r);
  if (ref && objs.get(ref)) r = objs.get(ref).dict;
  const sub = (key) => {
    let v = r ? entry(r, key) : null;
    const rr = refOf(v);
    if (rr && objs.get(rr)) v = objs.get(rr).dict;
    return v;
  };
  const fontDict = sub("Font");
  const xoDict = sub("XObject");
  const lookup = (dict) => (name) => {
    if (!dict || !name) return null;
    const v = entry(dict, name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return refOf(v);
  };
  const fontRef = lookup(fontDict);
  const xoRef = lookup(xoDict);
  return {
    fonts: (name) => {
      const f = fontRef(name);
      return f ? loadFont(objs, f, cache) : null;
    },
    xobjects: (name) => {
      const n = xoRef(name);
      const o = n && objs.get(n);
      if (!o || !/\/Subtype\s*\/Form/.test(o.dict)) return null;
      const data = decoded(o);
      if (!data) return null;
      const own = /\/Resources/.test(o.dict) ? resourcesOf(objs, o.dict, cache) : null;
      const mx = String(entry(o.dict, "Matrix") || "").match(/[-+]?\d*\.?\d+/g);
      return { data, res: own || resourcesOf(objs, dictText, cache), matrix: mx && mx.length === 6 ? mx.map(Number) : null };
    },
  };
}

function pageList(objs) {
  const cat = [...objs.values()].find((o) => /\/Type\s*\/Catalog/.test(o.dict));
  const out = [];
  const seen = new Set();
  const walk = (num, inherited, depth) => {
    const o = objs.get(num);
    if (!o || depth > 12 || seen.has(num)) return;
    seen.add(num);
    if (/\/Type\s*\/Pages\b/.test(o.dict) || /\/Kids/.test(o.dict)) {
      const res = /\/Resources/.test(o.dict) ? o.dict : inherited;
      for (const k of refsIn(entry(o.dict, "Kids"))) walk(k, res, depth + 1);
    } else out.push({ num, dict: o.dict, inherited });
  };
  const root = cat && refOf(entry(cat.dict, "Pages"));
  if (root) walk(root, "", 0);
  if (!out.length) {
    // no usable tree: every page object, in file order
    for (const [num, o] of objs) if (/\/Type\s*\/Page\b(?!s)/.test(o.dict)) out.push({ num, dict: o.dict, inherited: "" });
  }
  return out;
}

/**
 * @returns { text, pages, shown, note } — the text page by page ("--- Page N ---"), how many pages there are, how many were read
 * @throws PdfError for a file that is not a PDF, is password-protected, or has no text in it
 */
function pdfText(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8 || latin(buf.subarray(0, 5)) !== "%PDF-") throw new PdfError("This is not a PDF file.");
  const objs = readObjects(buf);
  if (!objs.size) throw new PdfError("This PDF could not be read (no objects found).");
  if (/\/Encrypt\s+\d+\s+\d+\s+R|\/Encrypt\s*<</.test(latin(buf.subarray(Math.max(0, buf.length - 4096))))) throw new PdfError("This PDF is password-protected. Save an unprotected copy and attach that.");
  const pages = pageList(objs);
  const cache = new Map();
  const parts = [];
  let chars = 0;
  let read = 0;
  for (const [i, p] of pages.slice(0, MAX_PAGES).entries()) {
    const dict = p.dict;
    const res = resourcesOf(objs, /\/Resources/.test(dict) ? dict : p.inherited || dict, cache);
    let contents = entry(dict, "Contents");
    const single = refOf(contents);
    const refs = single ? [single] : refsIn(contents);
    let text = "";
    for (const r of refs) {
      const data = decoded(objs.get(r));
      if (data) text += `${streamText(data, res, 0, {})}\n`;
    }
    text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    read += 1;
    if (text) {
      parts.push(`--- Page ${i + 1} ---\n${text}`);
      chars += text.length;
    }
    if (chars > MAX_CHARS) break;
  }
  const text = parts.join("\n\n").replace(/\u0000/g, "").trim();
  if (!text) throw new PdfError("This PDF has no text that could be read — it may be a scan (pictures of pages). Attach a screenshot of the page instead, or paste the text.");
  const note = pages.length > MAX_PAGES ? `only the first ${MAX_PAGES} of ${pages.length} pages were read` : "";
  return { text, pages: pages.length, shown: read, note };
}

/* ------------------------------------------------------------------------------------------------ where the words are */
// (28 Nov 2026, for the loan book's repayment schedules) A table's columns are told apart by where each piece of text sits on
// the page, not by the order the file happens to write it: every piece is placed (through the page's transforms), pieces on one
// baseline make a row, and a gap wider than a space starts a new cell.
const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
const IDENTITY = [1, 0, 0, 1, 0, 0];

function streamRuns(data, res, depth, base, runs) {
  let ctm = base;
  const saved = [];
  let tm = IDENTITY;
  let lm = IDENTITY;
  let font = null;
  let size = 10;
  let leading = 0;
  const move = (x, y) => {
    lm = mul([1, 0, 0, 1, x, y], lm);
    tm = lm;
  };
  const show = (bytes) => {
    const s = decodeString(bytes, font);
    const known = advanceOf(bytes, font, size);
    const adv = known === null ? s.length * size * 0.5 : known;
    const m = mul(tm, ctm);
    // the direction the text runs in: a page written sideways is turned upright before the rows are made
    const len = Math.hypot(m[0], m[1]) || 1;
    const dx = m[0] / len;
    const dy = m[1] / len;
    const h = size * (Math.hypot(m[2], m[3]) || 1);
    if (s.trim()) runs.push({ x: m[4] * dx + m[5] * dy, y: -m[4] * dy + m[5] * dx, w: adv * len, h, s });
    tm = mul([1, 0, 0, 1, adv, 0], tm);
  };
  for (const { op, args } of operations(latin(data))) {
    if (runs.length > 60000) break;
    const n = (i) => Number(args[i]) || 0;
    if (op === "q") saved.push(ctm);
    else if (op === "Q") ctm = saved.pop() || base;
    else if (op === "cm") ctm = mul([n(0), n(1), n(2), n(3), n(4), n(5)], ctm);
    else if (op === "BT") {
      tm = IDENTITY;
      lm = IDENTITY;
    } else if (op === "Tf") {
      font = (res.fonts && res.fonts(args[0] && args[0].name)) || null;
      if (Number.isFinite(args[1])) size = Math.abs(args[1]) || size;
    } else if (op === "TL") leading = n(0);
    else if (op === "Td") move(n(0), n(1));
    else if (op === "TD") {
      leading = -n(1);
      move(n(0), n(1));
    } else if (op === "Tm") {
      tm = [n(0), n(1), n(2), n(3), n(4), n(5)];
      lm = tm;
    } else if (op === "T*") move(0, -(leading || size * 1.2));
    else if (op === "Tj") {
      if (Buffer.isBuffer(args[0])) show(args[0]);
    } else if (op === "'" || op === '"') {
      move(0, -(leading || size * 1.2));
      const s = args[args.length - 1];
      if (Buffer.isBuffer(s)) show(s);
    } else if (op === "TJ") {
      for (const it of args[0] || []) {
        if (Buffer.isBuffer(it)) show(it);
        else if (typeof it === "number") tm = mul([1, 0, 0, 1, (-it / 1000) * size, 0], tm);
      }
    } else if (op === "Do" && depth < 2) {
      const x = res.xobjects && res.xobjects(args[0] && args[0].name);
      if (x) streamRuns(x.data, x.res, depth + 1, x.matrix ? mul(x.matrix, ctm) : ctm, runs);
    }
  }
  return runs;
}

/** One page's placed pieces → its rows, top to bottom, each a list of cells left to right. */
function rowsOf(runs) {
  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const r of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.y - r.y) <= Math.max(2, Math.min(row.h, r.h) * 0.45)) row.parts.push(r);
    else rows.push({ y: r.y, h: r.h, parts: [r] });
  }
  return rows.map((row) => {
    const cells = [];
    let end = null;
    for (const p of row.parts.sort((a, b) => a.x - b.x)) {
      const gap = end === null ? Infinity : p.x - end;
      if (cells.length && gap < p.h * 0.85) cells[cells.length - 1] += `${gap > p.h * 0.16 ? " " : ""}${p.s}`;
      else cells.push(p.s);
      end = p.x + p.w;
    }
    return cells.map((c) => c.replace(/\s+/g, " ").trim()).filter(Boolean);
  });
}

/**
 * A PDF as rows of cells, page by page; a password-protected one is opened with its password.
 * @returns { rows: [[cell, …], …], text, pages, note, locked }
 * @throws PdfError (code "password" when a password is needed or wrong)
 */
function pdfRows(buf, { password = "", maxPages = MAX_PAGES } = {}) {
  if (!Buffer.isBuffer(buf) || buf.length < 8 || latin(buf.subarray(0, 5)) !== "%PDF-") throw new PdfError("This is not a PDF file.");
  let locked = false;
  let objs;
  try {
    objs = readObjects(buf, (text, found) => {
      const open = decryptorFor(text, found, entry, password);
      locked = Boolean(open);
      return open;
    });
  } catch (err) {
    if (err && (err.code === "password" || err.code === "unsupported")) {
      const e = new PdfError(err.message);
      e.code = err.code;
      throw e;
    }
    throw err;
  }
  if (!objs.size) throw new PdfError("This PDF could not be read (no objects found).");
  const pages = pageList(objs);
  const cache = new Map();
  const rows = [];
  for (const p of pages.slice(0, maxPages)) {
    const res = resourcesOf(objs, /\/Resources/.test(p.dict) ? p.dict : p.inherited || p.dict, cache);
    const contents = entry(p.dict, "Contents");
    const single = refOf(contents);
    const runs = [];
    // the page's streams are one program: joined before they are run, so a transform set in one holds in the next
    const bits = (single ? [single] : refsIn(contents)).map((r) => decoded(objs.get(r))).filter(Boolean);
    if (bits.length) streamRuns(Buffer.concat(bits.flatMap((b) => [b, Buffer.from("\n")])), res, 0, IDENTITY, runs);
    rows.push(...rowsOf(runs));
    if (rows.length > 6000) break;
  }
  const text = rows.map((r) => r.join("  ")).join("\n").replace(/\u0000/g, "").trim();
  const note = pages.length > maxPages ? `only the first ${maxPages} of ${pages.length} pages were read` : "";
  return { rows, text, pages: pages.length, note, locked };
}

module.exports = { pdfText, pdfRows, PdfError, readCMap, readObjects, operations };
