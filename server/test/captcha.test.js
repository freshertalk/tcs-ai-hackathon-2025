"use strict";
// The security gate: a picture drawn here, a proof of work, a pass tied to the visitor, a ceiling over all sign-in traffic — and every
// email sign-in route refusing without the pass. No network.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Captcha, powOk, zeroBits, makeText, drawSvg, BASE_BITS, GATE_USES, FLOOD_MAX, ALPHABET } = require("../captcha");

const KEY = crypto.randomBytes(32);
const fixed = (show = "ABCDE", answer = show) => () => ({ kind: "text", show, answer });
/** What a browser does: find the number. */
function work(pow) {
  for (let n = 0; ; n += 1) if (powOk(pow.salt, String(n), pow.bits)) return String(n);
}

test("the picture is random and drawn on the spot: five unmistakable characters or a sum, as an SVG data URI", () => {
  const seen = new Set();
  let sums = 0;
  for (let i = 0; i < 60; i += 1) {
    const t = makeText();
    if (t.kind === "sum") {
      sums += 1;
      assert.match(t.show, /^\d [+−] \d$/);
      assert.ok(Number(t.answer) >= 0);
    } else {
      assert.match(t.show, new RegExp(`^[${ALPHABET}]{5}$`));
      assert.equal(t.answer, t.show);
    }
    seen.add(t.show);
  }
  assert.ok(seen.size > 40 && sums > 3, "different every time, both kinds appear");
  assert.doesNotMatch(ALPHABET, /[01OIL]/, "nothing that looks like another");
  const uri = drawSvg("AB7K2");
  assert.match(uri, /^data:image\/svg\+xml;base64,/);
  const svg = Buffer.from(uri.split(",")[1], "base64").toString("utf8");
  assert.match(svg, /<feDisplacementMap/);
  assert.equal((svg.match(/<text /g) || []).length, 5);
  assert.notEqual(drawSvg("AB7K2"), uri, "never the same picture twice");
  assert.doesNotMatch(svg, /<script|onload|javascript:/i);
});

test("a right answer and the work earn a pass; a wrong answer, a missing proof, another visitor, a second try or a late one do not", () => {
  const cap = new Captcha({ key: KEY, text: fixed("QWERT") });
  const ch = cap.issue("1.1.1.1");
  assert.equal(ch.pow.bits, BASE_BITS);
  assert.equal(typeof ch.image, "string");
  const nonce = work(ch.pow);
  assert.ok(zeroBits(crypto.createHash("sha256").update(`${ch.pow.salt}:${nonce}`).digest()) >= ch.pow.bits);

  // wrong picture answer
  assert.deepEqual(cap.solve({ token: ch.token, answer: "WRONG", nonce }, "1.1.1.1"), { ok: false, reason: "wrong" });
  // a challenge is spent on its first answer, right or wrong
  assert.deepEqual(cap.solve({ token: ch.token, answer: "QWERT", nonce }, "1.1.1.1"), { ok: false, reason: "used" });

  // no work
  const c2 = cap.issue("1.1.1.1");
  assert.equal(cap.solve({ token: c2.token, answer: "QWERT", nonce: "x" }, "1.1.1.1").reason, "work");
  const c2b = cap.issue("1.1.1.1");
  const bad = String(Number(work(c2b.pow)) + 1); // the next number is almost never a solution
  if (!powOk(c2b.pow.salt, bad, c2b.pow.bits)) assert.equal(cap.solve({ token: c2b.token, answer: "QWERT", nonce: bad }, "1.1.1.1").reason, "work");

  // another visitor cannot use this challenge
  const c3 = cap.issue("1.1.1.1");
  assert.equal(cap.solve({ token: c3.token, answer: "QWERT", nonce: work(c3.pow) }, "9.9.9.9").reason, "invalid");

  // a forged or mangled token
  assert.equal(cap.solve({ token: "x.y", answer: "QWERT", nonce: "1" }, "1.1.1.1").reason, "expired");
  assert.equal(cap.solve({ token: ch.token.slice(0, -2) + "zz", answer: "QWERT", nonce }, "1.1.1.1").reason, "expired");

  // the good one: case and spaces do not matter
  const ok = cap.issue("1.1.1.1");
  const r = cap.solve({ token: ok.token, answer: " q w e r t ", nonce: work(ok.pow) }, "1.1.1.1");
  assert.equal(r.ok, true);
  assert.equal(typeof r.gate, "string");
  // the pass is for that visitor only
  assert.equal(cap.checkGate(r.gate, "9.9.9.9"), false);
  assert.equal(cap.checkGate("nonsense", "1.1.1.1"), false);
  for (let i = 0; i < GATE_USES; i += 1) assert.equal(cap.checkGate(r.gate, "1.1.1.1"), true);
  assert.equal(cap.checkGate(r.gate, "1.1.1.1"), false, "a pass carries a limited number of requests");
});

test("the proof of work gets harder as traffic rises, and for a visitor who has been refused", () => {
  const cap = new Captcha({ key: KEY, now: () => 1000 });
  assert.equal(cap.bits(), BASE_BITS);
  for (let i = 0; i < 45; i += 1) cap.issue("a");
  assert.equal(cap.bits(), BASE_BITS + 2);
  for (let i = 0; i < 120; i += 1) cap.issue("a");
  assert.equal(cap.bits(), BASE_BITS + 4);
  for (let i = 0; i < 400; i += 1) cap.issue("a");
  assert.equal(cap.bits(), BASE_BITS + 6);
  assert.equal(cap.bits(1), BASE_BITS + 7);
  assert.equal(cap.bits(99), 20, "never more than the ceiling");
  // and it relaxes when the traffic goes away
  const quiet = new Captcha({ key: KEY, now: () => 1000 });
  for (let i = 0; i < 45; i += 1) quiet.issue("a");
  quiet.now = () => 1000 + 61000;
  assert.equal(quiet.bits(), BASE_BITS);
});

test("the ceiling over all sign-in traffic turns the excess away, and lifts with the window", () => {
  let t = 5000;
  const cap = new Captcha({ key: KEY, now: () => t });
  for (let i = 0; i < FLOOD_MAX; i += 1) assert.equal(cap.crowded(), 0);
  const wait = cap.crowded();
  assert.ok(wait >= 1 && wait <= 10);
  t += 11000;
  assert.equal(cap.crowded(), 0);
});
