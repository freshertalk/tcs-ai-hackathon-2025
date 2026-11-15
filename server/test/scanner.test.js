"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { validate, passes, describe } = require("../market/scanner");

const rising = (n, from = 100, step = 0.5) => Array.from({ length: n }, (_, i) => from + i * step);

test("conditions are cleaned and bad ones refused", () => {
  assert.throws(() => validate([]), /at least one/);
  assert.throws(() => validate([{ type: "nope" }]), /Unknown/);
  assert.throws(() => validate([{ type: "rsi", a: 150 }]), /0 to 100/);
  const [c] = validate([{ type: "cross", fast: 250, slow: 10 }]);
  assert.deepEqual([c.fast, c.slow], [199, 200]);
  assert.equal(validate(Array(6).fill({ type: "streak" })).length, 6);
  assert.throws(() => validate(Array(7).fill({ type: "streak" })), /At most 6/);
});

test("a steady riser passes trend and momentum conditions, and fails the opposite ones", () => {
  const c = rising(260);
  const ok = (list, today = 0.5) => passes(c, today, validate(list));
  assert.equal(ok([{ type: "ma", kind: "sma", period: 200, op: "above" }]), true);
  assert.equal(ok([{ type: "ma", kind: "ema", period: 20, op: "below" }]), false);
  assert.equal(ok([{ type: "rsi", period: 14, op: "above", a: 70 }]), true);
  assert.equal(ok([{ type: "high52", within: 1 }]), true);
  assert.equal(ok([{ type: "low52", within: 5 }]), false);
  assert.equal(ok([{ type: "streak", dir: "up", days: 5 }]), true);
  assert.equal(ok([{ type: "change", days: 20, op: "above", value: 4 }]), true);
  assert.equal(ok([{ type: "today", op: "above", value: 1 }]), false);
  // every condition must hold
  assert.equal(ok([{ type: "ma", period: 200, op: "above" }, { type: "today", op: "above", value: 1 }]), false);
});

test("a golden cross is found only within the window asked for", () => {
  // falling for 220 days, then rising fast: the 50-day crosses above the 200-day at some point
  const c = [...Array.from({ length: 220 }, (_, i) => 300 - i * 0.5), ...Array.from({ length: 120 }, (_, i) => 190 + i * 2)];
  const conds = (within) => validate([{ type: "cross", kind: "sma", fast: 50, slow: 200, dir: "above", within }]);
  let crossAt = -1;
  for (let end = 201; end <= c.length; end += 1) {
    if (passes(c.slice(0, end), 0, conds(1))) {
      crossAt = end;
      break;
    }
  }
  assert.ok(crossAt > 0, "the cross happens");
  assert.equal(passes(c.slice(0, crossAt + 3), 0, conds(5)), true, "three sessions later, within 5");
  assert.equal(passes(c.slice(0, crossAt + 8), 0, conds(5)), false, "eight sessions later, not within 5");
  assert.match(describe(conds(5)[0]), /50-day SMA crossed above the 200-day in the last 5 sessions/);
});
