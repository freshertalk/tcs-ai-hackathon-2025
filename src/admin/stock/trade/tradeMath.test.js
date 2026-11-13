import { describe as words, holdingNumbers, newRef, positionPnl, ticketProblem, totals } from "./tradeMath";

const pos = { quantity: 10, multiplier: 1, buyValue: 39500, sellValue: 0, last: 3960, close: 4000, pnl: 100 };

test("position P&L follows Zerodha's formula and moves with the live price", () => {
  expect(positionPnl(pos)).toBe(100);
  expect(positionPnl(pos, 3970)).toBe(200);
  // a closed position keeps its realised P&L whatever the price does
  expect(positionPnl({ quantity: 0, multiplier: 1, buyValue: 40000, sellValue: 40050, last: 402 }, 500)).toBe(50);
  // a short gains as the price falls
  expect(positionPnl({ quantity: -20, multiplier: 1, buyValue: 0, sellValue: 16000, last: 800 }, 790)).toBe(200);
});

test("holdings count T1 shares and compare with the average price", () => {
  const n = holdingNumbers({ quantity: 40, t1: 2, average: 1300, last: 1512.5, close: 1500, dayChangePct: 0.83 });
  expect(n.qty).toBe(42);
  expect(n.pnl).toBeCloseTo(8925);
  expect(n.dayPct).toBeCloseTo(0.8333, 3);
});

test("totals use live prices where there are some", () => {
  const t = totals({ positions: [pos], holdings: [{ quantity: 10, t1: 0, average: 100, last: 110, close: 105 }] }, (x) => (x.quantity === 10 && x.average === 100 ? 120 : null));
  expect(t.posPnl).toBe(100);
  expect(t.holdPnl).toBe(200);
  expect(t.holdDay).toBe(150);
  expect(t.open).toBe(1);
});

test("the ticket says what is missing before anything is sent", () => {
  const ok = { exchange: "NSE", symbol: "INFY", side: "BUY", type: "LIMIT", product: "CNC", quantity: "3", price: "1500", trigger: "", protection: "" };
  expect(ticketProblem(ok)).toBe("");
  expect(ticketProblem({ ...ok, quantity: "1.5" })).toMatch(/whole number/);
  expect(ticketProblem({ ...ok, price: "" })).toMatch(/price/);
  expect(ticketProblem({ ...ok, type: "SL", trigger: "1510" })).toMatch(/trigger must be at or below/);
  expect(ticketProblem({ ...ok, exchange: "NFO" })).toMatch(/CNC/);
  expect(ticketProblem({ ...ok, type: "MARKET", price: "", protection: "150" })).toMatch(/protection/);
  expect(ticketProblem({ ...ok, type: "MARKET", price: "" })).toBe("");
});

test("the confirmation line names everything that matters", () => {
  expect(words({ side: "SELL", quantity: 4, symbol: "TCS", exchange: "NSE", type: "SL", trigger: 3900, price: 3895, product: "MIS" })).toBe("SELL 4 TCS on NSE stop ₹3900 → limit ₹3895, intraday (MIS)");
  expect(newRef()).not.toBe(newRef());
  expect(newRef().length).toBeGreaterThanOrEqual(8);
});

describe("planning the exit", () => {
  const { planNumbers, sizeForRisk, stopTicket } = require("./tradeMath");

  test("risk, reward and their ratio come from the entry, stop, target and quantity", () => {
    expect(planNumbers({ side: "BUY", entry: 800, stop: 785, target: 822.5, quantity: 66 })).toEqual({ riskPerShare: 15, risk: 990, reward: 1485, rr: 1.5, problem: "" });
    expect(planNumbers({ side: "SELL", entry: 500, stop: 504.8, target: 490, quantity: 100 })).toEqual({ riskPerShare: 4.8, risk: 480, reward: 1000, rr: 2.08, problem: "" });
    // a stop alone, or a target alone
    expect(planNumbers({ side: "BUY", entry: 100, stop: 98, target: "", quantity: 10 })).toEqual({ riskPerShare: 2, risk: 20, reward: null, rr: null, problem: "" });
    expect(planNumbers({ side: "BUY", entry: 100, stop: "", target: 104, quantity: 10 }).reward).toBe(40);
    expect(planNumbers({ side: "BUY", entry: "", stop: 98, target: 104, quantity: 10 })).toBeNull();
    expect(planNumbers({ side: "BUY", entry: 100, stop: 98, target: 104, quantity: 0 })).toBeNull();
  });

  test("a level on the wrong side of the entry is named", () => {
    expect(planNumbers({ side: "BUY", entry: 100, stop: 101, quantity: 5 }).problem).toMatch(/stop belongs below/);
    expect(planNumbers({ side: "SELL", entry: 100, stop: 99, quantity: 5 }).problem).toMatch(/stop belongs above/);
    expect(planNumbers({ side: "BUY", entry: 100, stop: 98, target: 99, quantity: 5 }).problem).toMatch(/target belongs above/);
    expect(planNumbers({ side: "SELL", entry: 100, stop: 102, target: 101, quantity: 5 }).problem).toMatch(/target belongs below/);
  });

  test("the quantity for a money risk is rounded down", () => {
    expect(sizeForRisk(1000, 800, 785)).toBe(66);
    expect(sizeForRisk(1000, 500, 504.8)).toBe(208);
    expect(sizeForRisk(1000, 800, 800)).toBe(0);
    expect(sizeForRisk(0, 800, 785)).toBe(0);
    expect(sizeForRisk(1000, "", 785)).toBe(0);
  });

  test("the protecting stop is the opposite side, same product and size, stop-market at the stop", () => {
    expect(stopTicket({ symbol: "SBIN", exchange: "NSE", side: "BUY", product: "MIS", quantity: 66 }, 785)).toEqual({ symbol: "SBIN", exchange: "NSE", side: "SELL", product: "MIS", type: "SL-M", quantity: 66, trigger: 785 });
    expect(stopTicket({ symbol: "SBIN", side: "SELL", product: "MIS", quantity: 10 }, 810).side).toBe("BUY");
    expect(stopTicket({ symbol: "SBIN", side: "BUY", product: "MIS", quantity: 10 }, "")).toBeNull();
    expect(stopTicket(null, 100)).toBeNull();
  });
});
