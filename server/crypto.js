"use strict";
// Small crypto helpers: a key file, authenticated encryption for the stored
// Google client secret, and HMAC-signed tokens for cookies.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const unb64u = (s) => Buffer.from(String(s), "base64url");

/** Constant-time string comparison that is safe for unequal lengths. */
function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) {
    // still burn the comparison so timing does not reveal the length match
    crypto.timingSafeEqual(x, x);
    return false;
  }
  return crypto.timingSafeEqual(x, y);
}

const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString("base64url");

/**
 * A 32-byte key. An environment value wins (hex or base64); otherwise one is
 * created in the data folder on first run and reused afterwards.
 */
function loadKey(dir, fileName, fromEnv) {
  if (fromEnv) {
    const hex = /^[0-9a-f]{64}$/i.test(fromEnv);
    const buf = hex ? Buffer.from(fromEnv, "hex") : Buffer.from(fromEnv, "base64");
    if (buf.length >= 32) return buf.subarray(0, 32);
    // a short passphrase is stretched rather than rejected
    return crypto.scryptSync(fromEnv, "vinaytiwari.org/" + fileName, 32);
  }
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, fileName);
  if (fs.existsSync(file)) return unb64u(fs.readFileSync(file, "utf8").trim());
  const key = crypto.randomBytes(32);
  fs.writeFileSync(file, b64u(key), { mode: 0o600 });
  return key;
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext>, all base64url. */
function encrypt(plain, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return ["v1", b64u(iv), b64u(c.getAuthTag()), b64u(ct)].join(".");
}

function decrypt(blob, key) {
  const [v, iv, tag, ct] = String(blob).split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("bad ciphertext");
  const d = crypto.createDecipheriv("aes-256-gcm", key, unb64u(iv));
  d.setAuthTag(unb64u(tag));
  return Buffer.concat([d.update(unb64u(ct)), d.final()]).toString("utf8");
}

/** payload + expiry → "<body>.<hmac>". */
function sign(payload, key, ttlSeconds) {
  const body = b64u(
    JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })
  );
  const mac = b64u(crypto.createHmac("sha256", key).update(body).digest());
  return `${body}.${mac}`;
}

/** Returns the payload, or null if the signature is wrong or it has expired. */
function verify(token, key) {
  if (typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const mac = b64u(crypto.createHmac("sha256", key).update(body).digest());
  if (!safeEqual(token.slice(dot + 1), mac)) return null;
  try {
    const p = JSON.parse(unb64u(body).toString("utf8"));
    if (!p || typeof p.exp !== "number" || p.exp < Date.now() / 1000) return null;
    return p;
  } catch {
    return null;
  }
}

module.exports = { loadKey, encrypt, decrypt, sign, verify, safeEqual, randomToken };
