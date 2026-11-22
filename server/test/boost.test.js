"use strict";
// The decision trees: they find what a straight line cannot (a threshold, an interaction, the time of day), are used per
// target only when unseen sessions confirm they cut the miss, and leave noise alone.

const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("../market/boost");

const rand = B.rng(99);
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

/**
 * Rows like the forecaster's: x[0] is the constant, then three inputs; s the slot of the day, bucket the regime.
 * Target 0: a stretch (x1) pulls back ONLY in the first hour (s < 12) — an interaction no straight line can fit.
 * Target 1: pure noise.
 */
function rows(n) {
  return Array.from({ length: n }, () => {
    const x = [1, gauss(), gauss(), gauss()];
    const s = Math.floor(rand() * 75);
    const y0 = (s < 12 ? -0.9 * Math.tanh(2 * x[1]) : 0) + 0.3 * x[2] + gauss() * 0.5;
    return { x, s, bucket: Math.floor(rand() * 3), y: [y0, gauss()] };
  });
}
// the "ridge forecaster" before the trees: it knows the straight part (0.3·x2) and nothing else
const predict = (row) => [0.3 * row.x[2], 0];

test("the trees learn the first-hour pull-back that the straight line missed; noise gets no trees", async () => {
  const out = await B.trainBooster({ trainRows: rows(12000), pickRows: rows(4000), judgeRows: rows(4000), predict, targets: 2, maxTrees: 120 });
  assert.equal(out.on[0], true, JSON.stringify(out.record[0]));
  assert.ok(out.record[0].gainJudge > 0.05, `the miss cut on unseen rows: ${out.record[0].gainJudge}`);
  assert.ok(out.record[0].trees > 10);
  assert.equal(out.on[1], false, "noise: switched off");
  assert.deepEqual(out.trees[1], []);
  // a live row: stretched up in the first hour → the trees say it pulls back; at midday they add almost nothing
  const early = B.addTo([0, 0], out, { x: [1, 1.5, 0, 0], s: 3, bucket: 1 });
  const midday = B.addTo([0, 0], out, { x: [1, 1.5, 0, 0], s: 40, bucket: 1 });
  assert.ok(early[0] < -0.4, `first hour: ${early[0]}`);
  assert.ok(Math.abs(midday[0]) < 0.2, `midday: ${midday[0]}`);
  assert.equal(early[1], 0, "a target without trees is untouched");
  const sum = B.summaryOf({ ...out, trainedAt: "2026-11-22T10:00:00.000Z" }, ["r1", "r2"]);
  assert.equal(sum.inUse, 1);
  assert.equal(sum.targets[0].target, "r1");
  assert.ok(sum.targets[0].cutPct > 5);
});

test("the pieces: bins by quantile, a tree read without bins, a fair reservoir, and nothing added by an empty or mismatched booster", () => {
  const F = Float64Array.from({ length: 1000 }, (_, i) => i);
  const e = B.edgesOf(F, 1000, 1, 4)[0];
  assert.deepEqual(e, [250, 500, 750]);
  assert.equal(B.binOf(e, 100), 0);
  assert.equal(B.binOf(e, 500), 1);
  assert.equal(B.binOf(e, 900), 3);
  const t = { f: [0, -1, -1, -1, -1, -1, -1], t: [5, 0, 0, 0, 0, 0, 0], v: [0, -1, 2, 0, 0, 0, 0] };
  assert.equal(B.treeAt(t, [3]), -1);
  assert.equal(B.treeAt(t, [9]), 2);
  const r = new B.Reservoir(100, 3);
  for (let i = 0; i < 10000; i += 1) r.add(i);
  assert.equal(r.items.length, 100);
  const mean = r.items.reduce((a, b) => a + b, 0) / 100;
  assert.ok(mean > 3500 && mean < 6500, `a fair sample: mean ${mean}`);
  assert.deepEqual(B.addTo([0.5], null, { x: [1, 2], s: 1, bucket: 0 }), [0.5]);
  assert.deepEqual(B.addTo([0.5], { on: [true], trees: [[t]], features: 99 }, { x: [1, 2], s: 1, bucket: 0 }), [0.5], "another list of inputs: ignored");
  assert.equal(B.featuresOf({ x: [1, 7, 8], s: 4, bucket: 2 }).join(","), "7,8,4,2");
});

test("too few rows: no trees, and it says why", async () => {
  const out = await B.trainBooster({ trainRows: rows(100), pickRows: rows(50), judgeRows: rows(50), predict, targets: 2 });
  assert.deepEqual(out.on, [false, false]);
  assert.equal(out.reason, "too few rows");
});
