import { radarLabel, radarOrder, radarScore } from "./radar";

const nifty = { last: 24000, open: 24000 };

test("a stock above its open, above VWAP and at the day's high is strong", () => {
  const r = radarScore({ last: 103, open: 100, high: 103, low: 99.5, avgPrice: 101.5 }, nifty);
  expect(r.score).toBe(100);
  expect(r.relPct).toBe(3);
  expect(r.posPct).toBe(100);
  expect(radarLabel(r)).toBe("strong");
});

test("a stock below its open, below VWAP and at the day's low is weak", () => {
  const r = radarScore({ last: 97, open: 100, high: 100.5, low: 97, avgPrice: 98.6 }, nifty);
  expect(r.score).toBe(-100);
  expect(radarLabel(r)).toBe("weak");
});

test("strength is measured against the index, not on its own", () => {
  const q = { last: 100.8, open: 100, high: 101, low: 99.8, avgPrice: 100.8 };
  const flat = radarScore(q, nifty);
  const rally = radarScore(q, { last: 24480, open: 24000 }); // the Nifty is up 2% since its open
  expect(flat.relPct).toBe(0.8);
  expect(rally.relPct).toBe(-1.2);
  expect(rally.score).toBeLessThan(flat.score);
  expect(radarScore(q, null).relPct).toBe(0.8);
});

test("no reading before the stock has opened, and nothing in between is labelled", () => {
  expect(radarScore({ last: 100, open: 0 }, nifty)).toBeNull();
  expect(radarScore(null, nifty)).toBeNull();
  expect(radarScore({ last: 100 }, nifty)).toBeNull();
  const mid = radarScore({ last: 100.1, open: 100, high: 100.6, low: 99.6, avgPrice: 100.1 }, nifty);
  expect(Math.abs(mid.score)).toBeLessThan(50);
  expect(radarLabel(mid)).toBe("");
  expect(radarLabel(null)).toBe("");
});

test("ordering: strongest or weakest first, unknowns always last, the user's own order otherwise", () => {
  const scores = { A: { score: 10 }, B: { score: 80 }, C: null, D: { score: -60 } };
  const list = ["A", "B", "C", "D"];
  expect(radarOrder(list, scores, "strong")).toEqual(["B", "A", "D", "C"]);
  expect(radarOrder(list, scores, "weak")).toEqual(["D", "A", "B", "C"]);
  expect(radarOrder(list, scores, "mine")).toBe(list);
});
