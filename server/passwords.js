"use strict";
// Passwords: how they are stored and what is accepted.
//
// Stored with scrypt (memory-hard, built into Node): a fresh random salt per password, the cost written into the
// record so it can be raised later and old records are upgraded the next time their owner signs in. Nothing
// here ever logs or returns a password.
//
// Accepted: 10–128 characters; with fewer than 16 characters, three of the four kinds (lower case, upper case,
// digits, symbols); never the person's own address or name, a very common password, one repeated character
// or a plain run such as 12345678 / abcdefgh.

const crypto = require("crypto");

const N = 32768; // 2^15: about 30 ms and 32 MB per hash on a small server
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAX_N = 1 << 17; // a record asking for more than this is not one we wrote

const b64u = (buf) => Buffer.from(buf).toString("base64url");

function scrypt(password, salt, n, r, p) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password).normalize("NFKC"), salt, KEYLEN, { N: n, r, p, maxmem: 256 * n * r }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** "scrypt$N$r$p$salt$hash" */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, N, R, P);
  return ["scrypt", N, R, P, b64u(salt), b64u(key)].join("$");
}

function parse(stored) {
  const [alg, n, r, p, salt, hash] = String(stored || "").split("$");
  if (alg !== "scrypt" || !salt || !hash) return null;
  const parts = { n: Number(n), r: Number(r), p: Number(p), salt: Buffer.from(salt, "base64url"), hash: Buffer.from(hash, "base64url") };
  if (![parts.n, parts.r, parts.p].every(Number.isInteger) || parts.n < 2 || parts.n > MAX_N || parts.r < 1 || parts.r > 32 || parts.p < 1 || parts.p > 8) return null;
  if (parts.hash.length !== KEYLEN) return null;
  return parts;
}

async function verifyPassword(password, stored) {
  const x = parse(stored);
  if (!x) return false;
  try {
    const key = await scrypt(password, x.salt, x.n, x.r, x.p);
    return crypto.timingSafeEqual(key, x.hash);
  } catch (_) {
    return false;
  }
}

/** True when the record was made with weaker settings than today's. */
function needsRehash(stored) {
  const x = parse(stored);
  return !x || x.n < N || x.r < R || x.p < P;
}

// Compared against when the address is unknown, so a wrong address costs the same time as a wrong password
// (the answer must not tell the two apart). It is of a random password nobody has.
let dummy = null;
function dummyHash() {
  if (!dummy) dummy = hashPassword(crypto.randomBytes(24).toString("base64url"));
  return dummy;
}

const COMMON = new Set(
  (
    "password password1 password12 password123 password1234 passw0rd p@ssw0rd p@ssword qwerty qwerty123 qwertyuiop qwerty12345 1q2w3e4r 1q2w3e4r5t " +
    "iloveyou admin admin123 administrator welcome welcome1 welcome123 letmein letmein123 monkey dragon football baseball abc123 abcd1234 abcdefgh " +
    "111111 11111111 123123 123456 1234567 12345678 123456789 1234567890 0987654321 000000 00000000 zaq12wsx trustno1 sunshine princess master login " +
    "hanuman jaishreeram jaishriram omnamahshivaya radheradhe harharmahadev india123 india@123 bharat123 shivshankar vinaytiwari drishtiai stockmarket trading123"
  ).split(" ")
);

function isRun(s) {
  // a straight run of characters, up or down (abcdefgh, 87654321)
  if (s.length < 8) return false;
  let up = true;
  let down = true;
  for (let i = 1; i < s.length; i += 1) {
    const d = s.charCodeAt(i) - s.charCodeAt(i - 1);
    if (d !== 1) up = false;
    if (d !== -1) down = false;
  }
  return up || down;
}

/** null when acceptable, else a sentence telling the person what to change. */
function checkPassword(password, { email = "", name = "" } = {}) {
  const pw = String(password == null ? "" : password);
  const n = [...pw].length;
  if (n < 10) return "Use at least 10 characters.";
  if (n > 128) return "Use at most 128 characters.";
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  if (n < 16 && kinds < 3) return "Mix at least three of: lower case, upper case, digits, symbols — or make it 16 characters or longer.";
  const low = pw.toLowerCase();
  if (COMMON.has(low) || COMMON.has(low.replace(/[^a-z0-9@]/g, ""))) return "That password is too common. Choose something harder to guess.";
  if (/^(.)\1+$/.test(pw) || isRun(low)) return "That password is too predictable (a repeated or sequential run).";
  const local = String(email).toLowerCase().split("@")[0].replace(/[^a-z0-9]/g, "");
  if (local.length >= 4 && low.replace(/[^a-z0-9]/g, "").includes(local)) return "The password must not contain your email address.";
  for (const part of String(name).toLowerCase().split(/\s+/)) {
    if (part.length >= 4 && low.includes(part)) return "The password must not contain your name.";
  }
  return null;
}

module.exports = { hashPassword, verifyPassword, needsRehash, dummyHash, checkPassword };
