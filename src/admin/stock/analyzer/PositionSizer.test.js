import { sizePosition } from "./PositionSizer";
import { compact, inr, pct, day } from "./format";

describe("position sizing", () => {
  test("shares come from the money at risk, not from the money available", () => {
    // ₹5,00,000 capital, 1% risk = ₹5,000. Entry 500, stop 480 → ₹20 a share → 250 shares
    const r = sizePosition({ capital: 500000, riskPct: 1, entry: 500, stop: 480 });
    expect(r.ok).toBe(true);
    expect(r.qty).toBe(250);
    expect(r.risk).toBe(5000);
    expect(r.value).toBe(125000);
    expect(r.valuePct).toBe(25);
    expect(r.stopPct).toBe(4);
    expect(r.cappedByCash).toBe(false);
    expect(r.targets.map((t) => t.price)).toEqual([520, 540, 560]);
    expect(r.targets.map((t) => t.profit)).toEqual([5000, 10000, 15000]);
  });

  test("rounds DOWN — never risks more than the budget", () => {
    const r = sizePosition({ capital: 100000, riskPct: 1, entry: 100, stop: 97 }); // ₹1,000 / ₹3 = 333.33
    expect(r.qty).toBe(333);
    expect(r.risk).toBeLessThanOrEqual(1000);
  });

  test("a very tight stop is capped by capital — no leverage", () => {
    const r = sizePosition({ capital: 100000, riskPct: 2, entry: 1000, stop: 999 }); // risk says 2,000 shares = ₹20 lakh
    expect(r.qty).toBe(100);
    expect(r.cappedByCash).toBe(true);
    expect(r.value).toBeLessThanOrEqual(100000);
  });

  test("refuses nonsense instead of dividing by zero", () => {
    expect(sizePosition({ capital: 100000, riskPct: 1, entry: 100, stop: 100 }).ok).toBe(false);
    expect(sizePosition({ capital: 100000, riskPct: 1, entry: 100, stop: 120 }).reason).toMatch(/below the entry/);
    expect(sizePosition({ capital: "", riskPct: 1, entry: 100, stop: 90 }).ok).toBe(false);
    expect(sizePosition({ capital: 100000, riskPct: 0, entry: 100, stop: 90 }).ok).toBe(false);
    expect(sizePosition({ capital: -5, riskPct: 1, entry: 100, stop: 90 }).ok).toBe(false);
  });

  test("accepts what a form gives it (strings)", () => {
    expect(sizePosition({ capital: "500000", riskPct: "0.5", entry: "250", stop: "240" }).qty).toBe(250);
  });

  test("a share that costs more than the risk budget allows gives zero, not one", () => {
    const r = sizePosition({ capital: 10000, riskPct: 1, entry: 5000, stop: 4000 }); // ₹100 budget, ₹1,000 risk a share
    expect(r.qty).toBe(0);
  });
});

describe("formatting", () => {
  test("Indian grouping, rupees, lakh and crore", () => {
    expect(inr(1234567.5)).toBe("₹12,34,567.50");
    expect(inr(null)).toBe("—");
    expect(compact(1234567)).toBe("12.35 L");
    expect(compact(42000000)).toBe("4.20 Cr");
    expect(compact(950)).toBe("950");
    expect(pct(1.234)).toBe("+1.23%");
    expect(pct(-0.5)).toBe("-0.50%");
    expect(pct(undefined)).toBe("—");
  });

  test("dates are formatted from the date itself", () => {
    expect(day("2026-11-12")).toBe("12 Nov 2026");
    expect(day("")).toBe("—");
  });
});
