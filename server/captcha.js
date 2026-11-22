"use strict";
// The security gate in front of every email sign-in route (22 Nov 2026): a CAPTCHA made here, on this server, with no outside service,
// plus a proof of work, plus a flood guard — so that a script, an AI agent or a botnet cannot hammer the sign-in (and its costly password
// hashing) to crash the server or guess its way in.
//
//   1  THE PICTURE   a fresh, random picture for every challenge: five characters (or a small sum), each turned, skewed, sized and
//                    coloured differently, warped by an SVG displacement filter, with noise curves, strike lines and dots. Drawn on
//                    the spot (no image files, no library); sent as a data URI.
//   2  THE WORK      every challenge also carries a small proof of work: find a number that makes SHA-256(salt:number) begin with
//                    `bits` zero bits. A browser does it in the background in a moment; a program asking for thousands of
//                    sign-ins pays for each. The difficulty RISES by itself with the traffic (and with a visitor's refusals).
//   3  THE PASS      answering the picture AND doing the work earns a "gate": a signed pass for 15 minutes, tied to the visitor's
//                    address and usable a few dozen times. Every email sign-in route asks for it before it does anything else.
//   4  THE GUARD     a ceiling on all sign-in traffic at once: past it the server answers "busy, wait a few seconds" at almost no
//                    cost, so a flood cannot take the site down for the owner.
//
// Stateless where it can be: a challenge carries its own (signed, hashed) answer, so issuing one stores nothing; only the ids of
// challenges already used (until they expire) and the use-count of live passes are kept, both bounded.
// Pure of the network: it only needs the server's secret key. The browser half is src/admin/Captcha.jsx.

const crypto = require("node:crypto");
const { sign, verify, safeEqual } = require("./crypto");

const CHALLENGE_TTL = 5 * 60; // seconds to answer a picture
const GATE_TTL = 15 * 60; // seconds a pass lasts
const GATE_USES = 40; // sign-in requests one pass may carry
const BASE_BITS = 12; // proof of work: ~4,000 hashes at the quietest
const MAX_BITS = 20;
const FLOOD_WINDOW_MS = 10000;
const FLOOD_MAX = 400; // all sign-in requests, every visitor together, in one window
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L: nothing that looks like another
const W = 230;
const H = 84;
const INK = ["#1d3557", "#7a1f2b", "#14532d", "#5b3a00", "#3b2a6b", "#0b4f6c", "#8a2d0b"];
const PAPER = [["#f7f4ee", "#eef3f8"], ["#f3f6f0", "#f8f1f1"], ["#f1f4fa", "#f7f5ec"]];

const pick = (list) => list[crypto.randomInt(0, list.length)];
const between = (a, b) => a + (crypto.randomInt(0, 10001) / 10000) * (b - a);
const r1 = (x) => Math.round(x * 10) / 10;

/** Leading zero bits of a SHA-256 digest. */
function zeroBits(buf) {
  let n = 0;
  for (const byte of buf) {
    if (byte === 0) n += 8;
    else {
      n += Math.clz32(byte) - 24;
      break;
    }
  }
  return n;
}
const powOk = (salt, nonce, bits) => /^\d{1,12}$/.test(String(nonce)) && zeroBits(crypto.createHash("sha256").update(`${salt}:${nonce}`).digest()) >= bits;

/** The text to draw, and the answer: five characters, or a sum of two small numbers. */
function makeText() {
  if (crypto.randomInt(0, 100) < 30) {
    const a = crypto.randomInt(2, 10);
    const b = crypto.randomInt(2, 10);
    const plus = crypto.randomInt(0, 2) === 0;
    const hi = Math.max(a, b);
    const lo = Math.min(a, b);
    return plus ? { kind: "sum", show: `${a} + ${b}`, answer: String(a + b) } : { kind: "sum", show: `${hi} − ${lo}`, answer: String(hi - lo) };
  }
  let t = "";
  for (let i = 0; i < 5; i += 1) t += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  return { kind: "text", show: t, answer: t };
}

/** The picture: an SVG, different every time. */
function drawSvg(show) {
  const [c1, c2] = pick(PAPER);
  const fx = between(0.012, 0.024);
  const fy = between(0.02, 0.05);
  const scale = r1(between(4, 7));
  const glyphs = [...show].filter((c) => c !== " ");
  const step = (W - 40) / Math.max(glyphs.length, 1);
  let x = 20 + (show.includes(" ") ? 4 : 0);
  const parts = [];
  for (const ch of [...show]) {
    if (ch === " ") {
      x += step * 0.35;
      continue;
    }
    const size = r1(between(34, 46));
    const y = r1(between(52, 64));
    const rot = r1(between(-24, 24));
    const skew = r1(between(-14, 14));
    const gx = r1(x + between(-3, 3));
    parts.push(`<text x="${gx}" y="${y}" font-size="${size}" font-weight="700" font-family="Georgia,'Trebuchet MS',Verdana,sans-serif" fill="${pick(INK)}" transform="rotate(${rot} ${gx} ${y}) skewX(${skew})">${ch.replace("&", "&amp;")}</text>`);
    x += step;
  }
  const curve = (w, op) => {
    const y0 = r1(between(8, H - 8));
    return `<path d="M${r1(between(-5, 20))} ${y0} C ${r1(between(40, 90))} ${r1(between(0, H))}, ${r1(between(120, 180))} ${r1(between(0, H))}, ${W + 5} ${r1(between(8, H - 8))}" stroke="${pick(INK)}" stroke-opacity="${op}" stroke-width="${w}" fill="none"/>`;
  };
  const noise = [];
  for (let i = 0; i < 7; i += 1) noise.push(curve(r1(between(0.8, 2)), r1(between(0.35, 0.7))));
  const dots = [];
  for (let i = 0; i < 46; i += 1) dots.push(`<circle cx="${r1(between(0, W))}" cy="${r1(between(0, H))}" r="${r1(between(0.7, 2.2))}" fill="${pick(INK)}" fill-opacity="${r1(between(0.25, 0.6))}"/>`);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>` +
    `<filter id="w" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="turbulence" baseFrequency="${r1(fx * 1000) / 1000} ${r1(fy * 1000) / 1000}" numOctaves="2" seed="${crypto.randomInt(1, 9999)}" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="${scale}"/></filter></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#g)"/>` +
    noise.slice(0, 3).join("") +
    `<g filter="url(#w)">${parts.join("")}</g>` +
    noise.slice(3).join("") +
    dots.join("") +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

class Captcha {
  /** @param key the server's secret (32 bytes); @param now a clock in ms (for tests) */
  constructor({ key, now = () => Date.now(), text = makeText }) {
    this.text = text; // what to draw (a test sets a known text)
    this.key = crypto.createHmac("sha256", key).update("captcha/v1").digest();
    this.now = now;
    this.used = new Map(); // challenge id → expiry (ms): a picture is answered once
    this.passes = new Map(); // pass id → uses so far
    this.issued = []; // timestamps of recent challenges (the traffic the difficulty follows)
    this.flood = { start: 0, n: 0 };
  }

  ipTag(ip) {
    return crypto.createHmac("sha256", this.key).update(`ip:${ip}`).digest("hex").slice(0, 16);
  }
  _mac(id, answer) {
    return crypto.createHmac("sha256", this.key).update(`ans:${id}:${answer}`).digest("hex");
  }
  _prune() {
    const t = this.now();
    if (this.used.size > 4000) for (const [k, exp] of this.used) if (exp < t) this.used.delete(k);
    while (this.used.size > 20000) this.used.delete(this.used.keys().next().value);
    while (this.passes.size > 20000) this.passes.delete(this.passes.keys().next().value);
  }

  /** The traffic's difficulty: how many zero bits the proof of work asks for now. */
  bits(extra = 0) {
    const t = this.now();
    this.issued = this.issued.filter((x) => t - x < 60000);
    const n = this.issued.length;
    const level = n >= 500 ? 6 : n >= 150 ? 4 : n >= 40 ? 2 : 0;
    return Math.min(MAX_BITS, BASE_BITS + level + Math.max(0, extra));
  }

  /** A new challenge for a visitor. @param extra extra bits for a visitor who has been refused */
  issue(ip, { extra = 0 } = {}) {
    this._prune();
    this.issued.push(this.now());
    if (this.issued.length > 5000) this.issued.splice(0, this.issued.length - 5000);
    const text = this.text();
    const id = crypto.randomBytes(9).toString("base64url");
    const salt = crypto.randomBytes(12).toString("base64url");
    const bits = this.bits(extra);
    const token = sign({ typ: "cap", j: id, a: this._mac(id, text.answer), s: salt, b: bits, p: this.ipTag(ip) }, this.key, CHALLENGE_TTL);
    return { token, image: drawSvg(text.show), kind: text.kind, pow: { salt, bits }, expiresIn: CHALLENGE_TTL };
  }

  /**
   * The answer to a picture and the work for it. @returns { ok, gate, expiresIn } or { ok:false, reason }
   * reason: invalid | expired | used | wrong | work
   */
  solve({ token, answer, nonce }, ip) {
    const p = verify(String(token || ""), this.key);
    if (!p || p.typ !== "cap" || !p.j) return { ok: false, reason: "expired" };
    if (p.p !== this.ipTag(ip)) return { ok: false, reason: "invalid" };
    if (this.used.has(p.j)) return { ok: false, reason: "used" };
    this.used.set(p.j, this.now() + CHALLENGE_TTL * 1000); // a challenge is spent on its first answer, right or wrong
    const a = String(answer == null ? "" : answer).replace(/\s+/g, "").toUpperCase().slice(0, 12);
    if (!a || !safeEqual(this._mac(p.j, a), p.a)) return { ok: false, reason: "wrong" };
    if (!powOk(p.s, nonce, p.b)) return { ok: false, reason: "work" };
    const jti = crypto.randomBytes(9).toString("base64url");
    const gate = sign({ typ: "gate", j: jti, p: p.p }, this.key, GATE_TTL);
    this.passes.set(jti, 0);
    return { ok: true, gate, expiresIn: GATE_TTL };
  }

  /** Is this pass good for this visitor? Counts a use. */
  checkGate(gate, ip) {
    const p = verify(String(gate || ""), this.key);
    if (!p || p.typ !== "gate" || !p.j || p.p !== this.ipTag(ip)) return false;
    const n = (this.passes.get(p.j) || 0) + 1;
    if (n > GATE_USES) return false;
    this.passes.set(p.j, n);
    return true;
  }

  /** The ceiling on all sign-in traffic: 0 to go on, else the seconds to wait. */
  crowded() {
    const t = this.now();
    if (!this.flood.start || t - this.flood.start >= FLOOD_WINDOW_MS) this.flood = { start: t, n: 0 };
    this.flood.n += 1;
    return this.flood.n > FLOOD_MAX ? Math.max(1, Math.ceil((this.flood.start + FLOOD_WINDOW_MS - t) / 1000)) : 0;
  }
}

module.exports = { Captcha, powOk, zeroBits, makeText, drawSvg, CHALLENGE_TTL, GATE_TTL, GATE_USES, BASE_BITS, MAX_BITS, FLOOD_MAX, ALPHABET };
