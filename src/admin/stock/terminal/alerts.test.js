import { alertText, crossed, distancePct, due } from "./alerts";

const up = { id: "a", symbol: "SBIN", dir: "above", price: 800, firedAt: null };
const down = { id: "b", symbol: "INFY", dir: "below", price: 1450, firedAt: null };

test("an alert is reached at its level or beyond, on its own side only", () => {
  expect(crossed(up, 799.95)).toBe(false);
  expect(crossed(up, 800)).toBe(true);
  expect(crossed(up, 812)).toBe(true);
  expect(crossed(down, 1450.05)).toBe(false);
  expect(crossed(down, 1450)).toBe(true);
  expect(crossed(down, 1400)).toBe(true);
  // no price, or already fired: nothing happens
  expect(crossed(up, null)).toBe(false);
  expect(crossed({ ...up, firedAt: "2026-11-13T05:00:00Z" }, 900)).toBe(false);
  expect(crossed(null, 900)).toBe(false);
});

test("only the alerts whose price has arrived are due", () => {
  const prices = { SBIN: 801, INFY: 1500 };
  expect(due([up, down], (s) => prices[s]).map((a) => a.id)).toEqual(["a"]);
  expect(due([up, down], () => null)).toEqual([]);
  expect(due(null, () => 1)).toEqual([]);
});

test("wording and distance", () => {
  expect(alertText(up)).toBe("SBIN at or above ₹800");
  expect(alertText(down)).toBe("INFY at or below ₹1450");
  expect(distancePct(up, 790)).toBe(1.3);
  expect(distancePct(up, null)).toBeNull();
});
