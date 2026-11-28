"use strict";
// The pictures of a scanned PDF's pages (28 Nov 2026). A scan has no words to take out: each page is one picture, and only
// an AI model that can see it can read it. This takes that picture out of the file, with no library: a JPEG scan is the
// picture as it stands; a packed (Flate) bitmap is wrapped as a PNG. Fax (CCITT), JBIG2 and JPEG 2000 pictures are not
// turned into pictures here, and the page says so. Nothing in the file is run.

const zlib = require("node:zlib");

const MAX_PIXELS = 40 * 1000 * 1000;
const MAX_BYTES = 25 * 1024 * 1024;

/* ------------------------------------------------------------------------------------------------ PNG */
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}
/** @param lines the picture's rows, each led by its PNG filter byte */
function png({ width, height, depth, colorType, palette, lines }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([depth, colorType, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), ...(palette ? [chunk("PLTE", palette)] : []), chunk("IDAT", zlib.deflateSync(lines, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}

/* ------------------------------------------------------------------------------------------------ one picture */
const filtersOf = (v) => String(v || "").match(/\/[A-Za-z0-9]+/g) || [];

function inflate(buf) {
  try {
    return zlib.inflateSync(buf, { maxOutputLength: MAX_BYTES });
  } catch (_) {
    return null;
  }
}

/** The colours of a picture: { channels, palette } or null for a kind that is not drawn here. */
function colours(objs, value, tools, depth = 0) {
  const { entry, refOf, decoded } = tools;
  let v = String(value || "").trim();
  const ref = refOf(v);
  if (ref !== null && objs.get(ref)) v = objs.get(ref).dict.trim();
  if (/^\/(DeviceGray|CalGray|G)\b/.test(v) || /^\[\s*\/CalGray/.test(v)) return { channels: 1, palette: null };
  if (/^\/(DeviceRGB|CalRGB|RGB)\b/.test(v) || /^\[\s*\/CalRGB/.test(v)) return { channels: 3, palette: null };
  const icc = /^\[\s*\/ICCBased\s+(\d+)\s+\d+\s+R/.exec(v);
  if (icc && objs.get(Number(icc[1]))) {
    const n = Number(entry(objs.get(Number(icc[1])).dict, "N"));
    return n === 1 || n === 3 ? { channels: n, palette: null } : null;
  }
  const idx = /^\[\s*\/Indexed\s+(\/[A-Za-z]+|\d+\s+\d+\s+R|\[[^\]]*\])\s+(\d+)\s+([\s\S]+?)\s*\]$/.exec(v);
  if (idx && depth === 0) {
    const base = colours(objs, idx[1], tools, 1);
    if (!base || base.palette) return null;
    const size = Number(idx[2]) + 1;
    const table = idx[3].trim();
    let bytes = null;
    const at = refOf(table);
    if (at !== null && objs.get(at)) bytes = decoded(objs.get(at));
    else if (/^<[0-9A-Fa-f\s]*>$/.test(table)) bytes = Buffer.from(table.slice(1, -1).replace(/\s+/g, ""), "hex");
    if (!bytes || size > 256 || bytes.length < size * base.channels) return null;
    const palette = Buffer.alloc(size * 3);
    for (let i = 0; i < size; i += 1) for (let c = 0; c < 3; c += 1) palette[i * 3 + c] = bytes[i * base.channels + (base.channels === 3 ? c : 0)];
    return { channels: 1, palette };
  }
  return null;
}

/**
 * What is needed to make the picture later, held on its own (the file may have been locked: it is already open here).
 * @returns { ok: true, kind: "jpeg" | "raw", … } or { ok: false, why }
 */
function describe(objs, o, tools) {
  const { entry, refOf } = tools;
  const num = (key) => {
    const v = entry(o.dict, key);
    const ref = refOf(v);
    return Number(ref !== null && objs.get(ref) ? objs.get(ref).dict : v);
  };
  const width = num("Width");
  const height = num("Height");
  if (!(width > 0 && height > 0 && width * height <= MAX_PIXELS) || !o.stream) return { ok: false, why: "the page’s picture is too large or damaged" };
  const filters = filtersOf(entry(o.dict, "Filter"));
  const last = filters[filters.length - 1] || "";
  if (last === "/DCTDecode" || last === "/DCT") {
    let data = o.stream;
    if (filters.length === 2 && /^\/(FlateDecode|Fl)$/.test(filters[0])) data = inflate(data);
    else if (filters.length !== 1) data = null;
    if (!data || data[0] !== 0xff || data[1] !== 0xd8) return { ok: false, why: "the page’s picture could not be unpacked" };
    return { ok: true, kind: "jpeg", width, height, data: Buffer.from(data) };
  }
  if (filters.length === 1 && /^\/(FlateDecode|Fl)$/.test(last)) {
    const mask = /true/.test(String(entry(o.dict, "ImageMask") || ""));
    const bpc = mask ? 1 : num("BitsPerComponent");
    const space = mask ? { channels: 1, palette: null } : colours(objs, entry(o.dict, "ColorSpace"), tools);
    if (!space || ![1, 2, 4, 8].includes(bpc) || (space.channels === 3 && bpc !== 8)) return { ok: false, why: "the page’s picture uses colours that are not drawn here" };
    const parms = String(entry(o.dict, "DecodeParms") || "");
    const predictor = Number(entry(parms, "Predictor") || 1);
    if (predictor !== 1 && predictor < 10) return { ok: false, why: "the page’s picture is packed in a way that is not read here" };
    const invert = /\[\s*1\s+0\s*\]/.test(String(entry(o.dict, "Decode") || ""));
    return { ok: true, kind: "raw", width, height, bpc, channels: space.channels, palette: space.palette, filtered: predictor >= 10, invert, data: Buffer.from(o.stream) };
  }
  const name = last === "/CCITTFaxDecode" || last === "/CCF" ? "a fax-style (black and white) scan" : last === "/JBIG2Decode" ? "a JBIG2 scan" : last === "/JPXDecode" ? "a JPEG 2000 picture" : "a kind of picture";
  return { ok: false, why: `the page is ${name}, which is not turned into a picture here` };
}

/** The picture itself: { mime, data } — or null when it does not unpack. */
function pictureOf(d) {
  if (!d || !d.ok) return null;
  if (d.kind === "jpeg") return { mime: "image/jpeg", data: d.data };
  const raw = inflate(d.data);
  if (!raw) return null;
  const rowBytes = Math.ceil((d.width * d.channels * d.bpc) / 8);
  let lines;
  if (d.filtered) {
    // packed with a PNG predictor: these are PNG rows already
    if (raw.length < (rowBytes + 1) * d.height) return null;
    lines = raw.subarray(0, (rowBytes + 1) * d.height);
  } else {
    if (raw.length < rowBytes * d.height) return null;
    lines = Buffer.alloc((rowBytes + 1) * d.height);
    for (let y = 0; y < d.height; y += 1) raw.copy(lines, y * (rowBytes + 1) + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  let palette = d.palette;
  let invert = d.invert;
  if (invert && !d.filtered && !palette) {
    for (let y = 0; y < d.height; y += 1) for (let x = 1; x <= rowBytes; x += 1) lines[y * (rowBytes + 1) + x] ^= 0xff;
    invert = false;
  }
  return { mime: "image/png", data: png({ width: d.width, height: d.height, depth: d.bpc, colorType: palette ? 3 : d.channels === 3 ? 2 : 0, palette, lines }) };
}

module.exports = { describe, pictureOf, crc32 };
