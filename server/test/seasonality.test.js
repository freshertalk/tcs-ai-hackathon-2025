"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { seasonality } = require("../market/seasonality");

// two years of weekday bars: price rises 1% every January trading day and is flat otherwise
function bars() {
  const out = [];
  let c = 100;
  for (let t = Date.parse("2024-01-01T00:00:00Z"); t <= Date.parse("2025-12-31T00:00:00Z"); t += 86400000) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    if (d.getUTCMonth() === 0) c *= 1.01;
    out.push({ t: d.toISOString().slice(0, 10), c });
  }
  return out;
}

test("months: each calendar month's return, year by year, with the average and how often it rose", () => {
  const s = seasonality(bars());
  assert.equal(s.available, true);
  assert.deepEqual(s.years.map((y) => y.year), [2024, 2025]);
  assert.equal(s.years[0].months[0], null, "the first month has no month before it");
  assert.ok(s.years[1].months[0] > 20, "January 2025 rose");
  assert.equal(s.years[1].months[5], 0, "June was flat");
  const jan = s.months[0];
  assert.equal(jan.up, 100);
  assert.ok(jan.avg > 20);
  assert.equal(s.months[6].avg, 0);
  assert.equal(s.weekdays.length, 5);
  assert.ok(s.weekdays.every((w) => w.n > 50));
});

test("too little history says so", () => {
  assert.equal(seasonality([{ t: "2026-01-01", c: 1 }]).available, false);
});
