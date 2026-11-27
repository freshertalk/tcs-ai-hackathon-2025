import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import DeskGlance, { nearestLevels } from "./DeskGlance";

const analysis = {
  price: { open: 1452, prevClose: 1457, volume: 7500000 },
  score: { value: 17, label: "Neutral" },
  indicators: { rsi14: 59.3, macdHist: -3.31, adx: 45.4, plusDI: 22, minusDI: 9, atrPct: 1.63, relVolume: 1.64 },
  levels: {
    pivots: { p: 1454.35, r1: 1460.69, s1: 1450.63 },
    week52: { high: 1727.92, low: 1266.15 },
    atr: { value: 23.65, pctOfPrice: 1.63, nextDayLow: 1428.35, nextDayHigh: 1475.65 },
    supports: [{ price: 1445.48, touches: 1 }, { price: 1422.53, touches: 2 }],
    resistances: [{ price: 1473.84, touches: 2 }, { price: 1597.09, touches: 2 }],
    movingAverages: { ema20: 1438.07, ema200: 1415.81 },
  },
  relative: { name: "NIFTY 50", m1: -5.3, m3: 1.3 },
};
const liveVerdict = {
  available: true,
  direction: "bullish",
  stance: "Bullish",
  composite: 59,
  frames: [{ name: "Weekly", dir: "up", label: "Up", basis: "b" }, { name: "Intraday (5 min)", dir: null, label: "Not enough data", basis: "b" }],
  longTerm: { available: true, trend: "mixed", stance: "No clear long-term trend", met: 3, total: 7 },
  circuit: { upper: 1602.65, lower: 1311.25 },
  movement: { atr: 23.65, atrPct: 1.59, rangeUsedPct: 103, relVolume: 1.64, expectedLow: 1433.3, expectedHigh: 1480.6, gapPct: 0.26 },
  intraday: null,
  day: {
    available: true,
    state: "wait-long",
    side: "long",
    headline: "Wait for a pullback",
    score: 95,
    threshold: 35,
    movement: { open: 1460.8, vwap: 1472.9, rsi5: 73, m15Pct: 0.18, m30Pct: 0.41, orHigh: 1463.97, orLow: 1460.52, rangeUsedPct: 103 },
    plan: { side: "long", entry: 1472.95, entryNote: "on a pullback", stop: 1465.8, riskPct: 0.49, riskPerShare: 7.15, targets: [{ label: "1R", price: 1480.1 }, { label: "2R", price: 1487.25 }] },
  },
};
const quote = { upperCircuit: 1602.65, lowerCircuit: 1311.25, buyQty: 600, sellQty: 400, volume: 1323546, open: 1460.8 };
const show = (props = {}) =>
  render(<DeskGlance a={analysis} v={liveVerdict} intraday={null} quote={quote} price={1484.65} prevClose={1456.95} high={1484.95} low={1460.5} setupsOn={[]} onTab={() => {}} onVerdict={() => {}} {...props} />);

test("the live call stands across the top with the prices to act on", () => {
  show();
  const strip = screen.getByRole("region", { name: "Live call and plan" });
  expect(within(strip).getByText("Wait for a pullback")).toBeTruthy();
  expect(strip.textContent).toMatch(/Buy on a pullback₹1,472\.95/);
  expect(strip.textContent).toMatch(/Stop-loss₹1,465\.80/);
  expect(strip.textContent).toMatch(/Target 1R₹1,480\.10/);
  expect(strip.textContent).toMatch(/Target 2R₹1,487\.25/);
  expect(strip.textContent).toMatch(/Score\+95needs ±35/);
});

test("the four groups hold the day, the trend, the momentum and the levels", () => {
  show();
  const group = (name) => screen.getByRole("region", { name }).textContent;
  expect(group("Price today")).toMatch(/VWAP₹1,472\.90/);
  expect(group("Price today")).toMatch(/Waiting buy \/ sell60% \/ 40%/);
  expect(group("Price today")).toMatch(/Circuit limits1,311\.25 – 1,602\.65/);
  expect(group("Trend")).toMatch(/SwingBullishscore \+59/);
  expect(group("Trend")).toMatch(/Long termNo clear trend3 of 7/);
  expect(group("Trend")).toMatch(/Daily reading\+17 · Neutral/);
  expect(group("Momentum")).toMatch(/RSI daily \(14\)59firm/);
  expect(group("Momentum")).toMatch(/RSI 5-min73overbought/);
  expect(group("Momentum")).toMatch(/Range used today103%/);
  expect(group("Key levels")).toMatch(/Resistance₹1,597\.09/);
  expect(group("Key levels")).toMatch(/Support₹1,473\.84/);
});

test("with no live call, the next session's two triggers take its place", () => {
  show({ v: { ...liveVerdict, day: { available: false, reason: "The market is closed." }, intraday: { forSession: "Mon 30 Nov", long: { entry: 1500, stop: 1490 }, short: { entry: 1470, stop: 1480 } } } });
  const strip = screen.getByRole("region", { name: "The next triggers" });
  expect(strip.textContent).toMatch(/NO CALL/);
  expect(strip.textContent).toMatch(/Mon 30 Nov/);
  expect(strip.textContent).toMatch(/Long only above₹1,500\.00stop 1,490\.00/);
  expect(strip.textContent).toMatch(/Short only below₹1,470\.00stop 1,480\.00/);
});

test("before the verdict arrives nothing is guessed", () => {
  show({ v: null, quote: null });
  expect(screen.getByText("Reading the market…")).toBeTruthy();
  const trend = screen.getByRole("region", { name: "Trend" }).textContent;
  expect(trend).toMatch(/Swing—/);
  expect(screen.getByRole("region", { name: "Price today" }).textContent).toMatch(/Waiting buy \/ sell—/);
});

test("the links open the matching tab, and the whole verdict", () => {
  const tabs = [];
  let verdict = 0;
  show({ onTab: (t) => tabs.push(t), onVerdict: () => (verdict += 1), setupsOn: [{ name: "55-day breakout" }] });
  for (const name of ["Reading", "Indicators", "All levels", "55-day breakout"]) fireEvent.click(screen.getByRole("button", { name }));
  fireEvent.click(screen.getByRole("button", { name: "Full verdict" }));
  expect(tabs).toEqual(["overview", "indicators", "levels", "setups"]);
  expect(verdict).toBe(1);
});

test("on a phone a row of buttons chooses the group shown", () => {
  show();
  const levels = screen.getByRole("button", { name: "Levels" });
  fireEvent.click(levels);
  expect(levels.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("region", { name: "Key levels" }).className).toMatch(/is-seg/);
  expect(screen.getByRole("region", { name: "Price today" }).className).not.toMatch(/is-seg/);
});

test("the nearest level on each side comes from the swing levels and the year's high and low", () => {
  const near = nearestLevels(analysis.levels, 1450);
  expect([near.up.price, near.down.price]).toEqual([1473.84, 1445.48]);
  expect(nearestLevels(analysis.levels, 1800).up).toBeNull();
  expect(nearestLevels(analysis.levels, 1800).down.name).toBe("52-week high");
  expect(nearestLevels(null, 100)).toEqual({ up: null, down: null });
});
