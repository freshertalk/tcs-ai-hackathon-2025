"use strict";
// Opening a password-protected PDF WITH ITS PASSWORD (28 Nov 2026): lenders usually send repayment schedules and statements
// locked with a password (a date of birth, part of the account number). This is the PDF's own "standard" security handler,
// as its specification describes it (ISO 32000): RC4 40/128-bit (revisions 2, 3, 4), AES-128 (4) and AES-256 (5, 6). It
// only turns a file the owner can open into one the reader can read; without the right password nothing opens.
// The password is used for this one reading and is never kept.

const crypto = require("node:crypto");

class PdfPasswordError extends Error {
  constructor(message, code = "password") {
    super(message);
    this.code = code;
  }
}

const PAD = Buffer.from("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a", "hex");
const md5 = (...parts) => crypto.createHash("md5").update(Buffer.concat(parts)).digest();

/** RC4 (not offered by newer OpenSSL builds, so written here). */
function rc4(key, data) {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) s[i] = i;
  for (let i = 0, j = 0; i < 256; i += 1) {
    j = (j + s[i] + key[i % key.length]) & 255;
    const t = s[i];
    s[i] = s[j];
    s[j] = t;
  }
  const out = Buffer.allocUnsafe(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k += 1) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    const t = s[i];
    s[i] = s[j];
    s[j] = t;
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

/** A PDF string as it stands in the file — (literal with escapes) or <hex> — as bytes. */
function pdfBytes(v) {
  const s = String(v || "").trim();
  if (s.startsWith("<") && !s.startsWith("<<")) {
    const hex = s.slice(1, s.indexOf(">")).replace(/\s+/g, "");
    return Buffer.from(hex.length % 2 ? `${hex}0` : hex, "hex");
  }
  if (!s.startsWith("(")) return Buffer.alloc(0);
  const out = [];
  const esc = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
  for (let i = 1; i < s.length - 1; i += 1) {
    const c = s[i];
    if (c !== "\\") {
      out.push(c.charCodeAt(0) & 255);
      continue;
    }
    const n = s[i + 1];
    if (n >= "0" && n <= "7") {
      let o = n;
      i += 1;
      while (o.length < 3 && s[i + 1] >= "0" && s[i + 1] <= "7") {
        o += s[i + 1];
        i += 1;
      }
      out.push(parseInt(o, 8) & 255);
    } else if (n === "\r" || n === "\n") {
      i += n === "\r" && s[i + 2] === "\n" ? 2 : 1;
    } else {
      out.push(esc[n] !== undefined ? esc[n] : n.charCodeAt(0) & 255);
      i += 1;
    }
  }
  return Buffer.from(out);
}

/* ---------------------------------------------------------------- revisions 2–4 */
const padPassword = (pw) => Buffer.concat([pw.subarray(0, 32), PAD]).subarray(0, 32);

function fileKey(pw, p) {
  const perms = Buffer.alloc(4);
  perms.writeInt32LE(p.P | 0);
  const parts = [padPassword(pw), p.O.subarray(0, 32), perms, p.id];
  if (p.R >= 4 && !p.encryptMetadata) parts.push(Buffer.from([255, 255, 255, 255]));
  let key = md5(...parts);
  if (p.R >= 3) for (let i = 0; i < 50; i += 1) key = md5(key.subarray(0, p.n));
  return key.subarray(0, p.n);
}
const xorKey = (key, i) => Buffer.from(key.map((b) => b ^ i));

/** The file key when `pw` is the user password, else null. */
function tryUser(pw, p) {
  const key = fileKey(pw, p);
  if (p.R === 2) return rc4(key, PAD).equals(p.U.subarray(0, 32)) ? key : null;
  let x = rc4(key, md5(PAD, p.id));
  for (let i = 1; i < 20; i += 1) x = rc4(xorKey(key, i), x);
  return x.subarray(0, 16).equals(p.U.subarray(0, 16)) ? key : null;
}
/** …or when it is the owner password: it unlocks the user password kept inside /O. */
function tryOwner(pw, p) {
  let h = md5(padPassword(pw));
  if (p.R >= 3) for (let i = 0; i < 50; i += 1) h = md5(h);
  const okey = h.subarray(0, p.n);
  let x = p.O.subarray(0, 32);
  if (p.R === 2) x = rc4(okey, x);
  else for (let i = 19; i >= 0; i -= 1) x = rc4(xorKey(okey, i), x);
  return tryUser(x, p);
}

/* ---------------------------------------------------------------- revisions 5 and 6 (AES-256) */
const sha = (bits, ...parts) => crypto.createHash(`sha${bits}`).update(Buffer.concat(parts)).digest();
const aesCbc = (enc, bits, key, iv, data) => {
  const c = (enc ? crypto.createCipheriv : crypto.createDecipheriv)(`aes-${bits}-cbc`, key, iv);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(data), c.final()]);
};
function hash256(pw, salt, udata, R) {
  let k = sha(256, pw, salt, udata);
  if (R === 5) return k;
  for (let round = 0; ; round += 1) {
    const block = Buffer.concat([pw, k, udata]);
    const k1 = Buffer.concat(Array(64).fill(block));
    const e = aesCbc(true, 128, k.subarray(0, 16), k.subarray(16, 32), k1);
    let mod = 0;
    for (let i = 0; i < 16; i += 1) mod = (mod + e[i]) % 3;
    k = sha(mod === 0 ? 256 : mod === 1 ? 384 : 512, e);
    if (round >= 63 && e[e.length - 1] <= round - 32) break;
  }
  return k.subarray(0, 32);
}
function key256(pw, p) {
  const word = pw.subarray(0, 127);
  const zero = Buffer.alloc(16);
  const U48 = p.U.subarray(0, 48);
  if (hash256(word, p.U.subarray(32, 40), Buffer.alloc(0), p.R).subarray(0, 32).equals(p.U.subarray(0, 32))) return aesCbc(false, 256, hash256(word, p.U.subarray(40, 48), Buffer.alloc(0), p.R).subarray(0, 32), zero, p.UE.subarray(0, 32));
  if (hash256(word, p.O.subarray(32, 40), U48, p.R).subarray(0, 32).equals(p.O.subarray(0, 32))) return aesCbc(false, 256, hash256(word, p.O.subarray(40, 48), U48, p.R).subarray(0, 32), zero, p.OE.subarray(0, 32));
  return null;
}

/* ---------------------------------------------------------------- the handler */
const num = (v) => (v === null || v === undefined ? NaN : Number(String(v).trim()));

/**
 * Is the file encrypted, and with this password, how is a stream opened?
 * @param file     the whole file as latin-1 text
 * @param objs     the objects (number → { dict, gen })
 * @param entry    the reader's dictionary lookup (pdf-text.js)
 * @returns null when not encrypted, else (num, gen, bytes) → bytes
 * @throws PdfPasswordError with code "password" (needed or wrong) or "unsupported"
 */
function decryptorFor(file, objs, entry, password = "") {
  const found = [...file.matchAll(/\/Encrypt\s+(\d+)\s+\d+\s+R/g)].pop();
  let dict = null;
  if (found) {
    const o = objs.get(Number(found[1]));
    dict = o ? o.dict : null;
  } else {
    const inline = [...file.matchAll(/\/Encrypt\s*<</g)].pop();
    if (inline) dict = entry(file.slice(inline.index), "Encrypt");
    else return null;
  }
  if (!dict) throw new PdfPasswordError("This PDF is locked in a way that could not be read. Save an unprotected copy and upload that.", "unsupported");
  const filter = (entry(dict, "Filter") || "").trim();
  const V = num(entry(dict, "V")) || 0;
  const R = num(entry(dict, "R"));
  if (filter !== "/Standard" || ![1, 2, 4, 5].includes(V) || ![2, 3, 4, 5, 6].includes(R)) throw new PdfPasswordError("This PDF uses a kind of protection this reader does not open. Save an unprotected copy and upload that.", "unsupported");
  const idm = [...file.matchAll(/\/ID\s*\[\s*(<[0-9A-Fa-f\s]*>|\((?:\\.|[^\\)])*\))/g)].pop();
  const params = {
    R,
    V,
    P: num(entry(dict, "P")),
    O: pdfBytes(entry(dict, "O")),
    U: pdfBytes(entry(dict, "U")),
    OE: R >= 5 ? pdfBytes(entry(dict, "OE")) : null,
    UE: R >= 5 ? pdfBytes(entry(dict, "UE")) : null,
    id: idm ? pdfBytes(idm[1]) : Buffer.alloc(0),
    n: R === 2 ? 5 : Math.max(5, Math.min(16, (num(entry(dict, "Length")) || (V === 4 ? 128 : 40)) / 8)),
    encryptMetadata: !/\/EncryptMetadata\s+false/.test(dict),
  };
  // how streams are enciphered: version 4 and 5 name a crypt filter
  let method = V >= 5 ? "aes256" : "rc4";
  if (V === 4) {
    const cf = entry(dict, "CF") || "";
    const name = (entry(dict, "StmF") || "/Identity").trim().slice(1);
    if (name === "Identity") method = "none";
    else {
      const one = entry(cf, name) || cf;
      method = /\/CFM\s*\/AESV2/.test(one) ? "aes128" : /\/CFM\s*\/AESV3/.test(one) ? "aes256" : "rc4";
    }
  }
  const tries = [Buffer.from(String(password || ""), R >= 5 ? "utf8" : "latin1")];
  let key = null;
  for (const pw of tries) key = R >= 5 ? key256(pw, params) : tryUser(pw, params) || tryOwner(pw, params);
  if (!key) throw new PdfPasswordError(password ? "That password did not open this PDF. Check it and try again." : "This PDF is password-protected. Type its password (lenders often use your date of birth or part of the loan number; their email says which).");
  return (objNum, gen, bytes) => {
    if (method === "none") return bytes;
    let k = key;
    if (method !== "aes256") {
      const tail = Buffer.from([objNum & 255, (objNum >> 8) & 255, (objNum >> 16) & 255, gen & 255, (gen >> 8) & 255]);
      k = md5(key, tail, method === "aes128" ? Buffer.from("sAlT", "latin1") : Buffer.alloc(0)).subarray(0, Math.min(key.length + 5, 16));
    }
    if (method === "rc4") return rc4(k, bytes);
    if (bytes.length < 32) return Buffer.alloc(0);
    try {
      const d = crypto.createDecipheriv(method === "aes256" ? "aes-256-cbc" : "aes-128-cbc", k, bytes.subarray(0, 16));
      const body = bytes.subarray(16, 16 + Math.floor((bytes.length - 16) / 16) * 16);
      return Buffer.concat([d.update(body), d.final()]);
    } catch (_) {
      return Buffer.alloc(0);
    }
  };
}

module.exports = { decryptorFor, PdfPasswordError, rc4, pdfBytes };
