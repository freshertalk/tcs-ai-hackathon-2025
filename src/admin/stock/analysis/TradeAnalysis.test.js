import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import TradeAnalysis from "./TradeAnalysis";

const mockLab = {
  available: true,
  date: "2026-11-13",
  summary: { trades: 2, replayed: 2, gross: 900, charges: 60, net: 840, capture: 42, ranOn: 1500, avoided: 700, score: 58, label: "Mixed" },
  rules: [
    { id: "actual", name: "Your exits", net: 840, trades: 2, vsActual: 0 },
    { id: "fixed", name: "Stop 0.5% · target 1% (2R)", net: 1200, trades: 2, vsActual: 360 },
    { id: "trail", name: "Trailing stop 0.5%", net: 1500, trades: 2, vsActual: 660 },
    { id: "breakeven", name: "Stop 0.5%, to break-even at +0.5%", net: 900, trades: 2, vsActual: 60 },
    { id: "close", name: "Hold to 3:15 PM", net: 300, trades: 2, vsActual: -540 },
  ],
  best: { id: "trail", name: "Trailing stop 0.5%", net: 1500, trades: 2, vsActual: 660 },
  flags: [{ id: "revenge", name: "Revenge trade", major: true, text: "In within 10 minutes of closing a loss.", count: 1, net: -420 }],
  trades: [
    { key: "a", symbol: "SBIN", side: "long", qty: 50, entryClock: "09:40", exitClock: "10:05", entryAvg: 800, exitAvg: 826, holdMin: 25, pnl: 1300, charges: 30, net: 1270, intraday: true, n: 1, read: { mfe: 2000, mae: -300, mfePct: 5, maePct: -0.75, capture: 65, ranOn: 900, avoided: 200, vsVwapPct: 0.4, opening: "above the opening range", rangePos: 70 }, whatIf: { trail: { exit: 830, how: "trail", net: 1470 } }, flags: [] },
    { key: "b", symbol: "INFY", side: "short", qty: 20, entryClock: "10:10", exitClock: "10:30", entryAvg: 1500, exitAvg: 1520, holdMin: 20, pnl: -400, charges: 30, net: -430, intraday: true, n: 2, read: { mfe: 100, mae: -500, mfePct: 0.33, maePct: -1.67, capture: null, ranOn: 600, avoided: 0, vsVwapPct: 0.2, rangePos: 40 }, whatIf: {}, flags: ["revenge", "againstVwap"] },
  ],
  limits: { stop: 1500, target: 3000 },
  notes: [],
};
const mockCalls = [];
jest.mock("../../api", () => ({
  api: (url) => {
    mockCalls.push(url);
    if (url === "/api/admin/analysis/days") return Promise.resolve({ days: [{ date: "2026-11-13" }] });
    if (url.startsWith("/api/admin/analysis/lab/")) return Promise.resolve(mockLab);
    if (url.startsWith("/api/admin/analysis/lab?")) return Promise.resolve({ days: 3, summary: { trades: 9, replayed: 9, net: 2100, charges: 270, capture: 38, ranOn: 4200, avoided: 1500, score: 61 }, rules: mockLab.rules, best: mockLab.best, flags: mockLab.flags, byHour: [{ hour: 9, label: "9 AM", trades: 4, net: 1800 }, { hour: 10, label: "10 AM", trades: 5, net: 300 }], context: [{ id: "withVwap", name: "With VWAP (long above, short below)", trades: 6, net: 2500 }], lessons: ["“Trailing stop 0.5%” would have made ₹660 more than your own exits on the same 9 entries."], trend: [{ date: "2026-11-11", score: 55 }, { date: "2026-11-12", score: 70 }, { date: "2026-11-13", score: 58 }] });
    return Promise.resolve({});
  },
}));
jest.mock("../../DatePicker", () => ({ DateField: ({ value, label }) => <span>{`${label}: ${value}`}</span> }));
const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));
beforeEach(() => {
  mockCalls.length = 0;
  window.localStorage.clear();
});

test("a day replayed: the score, the share kept, the best other exit, the habits and every trade", async () => {
  render(<TradeAnalysis />);
  await settle();
  expect(mockCalls).toContain("/api/admin/analysis/lab/2026-11-13");
  expect(screen.getByText("58 / 100")).toBeTruthy();
  expect(screen.getByText("Mixed")).toBeTruthy();
  expect(screen.getByText("42%")).toBeTruthy();
  expect(screen.getAllByText("Trailing stop 0.5%").length).toBeGreaterThan(0);
  expect(screen.getByText("Revenge trade")).toBeTruthy();
  expect(screen.getByText(/09:40–10:05/)).toBeTruthy();
  expect(screen.getByText("vs VWAP")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /SBIN/ }));
  expect(screen.getByText(/out at 830/)).toBeTruthy();
  expect(screen.getByText(/Day book/)).toBeTruthy();
});

test("a period: the lessons, the exit rules and the habits added up", async () => {
  render(<TradeAnalysis />);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "A period" }));
  await settle();
  expect(mockCalls.some((u) => u.startsWith("/api/admin/analysis/lab?from="))).toBe(true);
  expect(screen.getByText(/would have made ₹660 more/)).toBeTruthy();
  expect(screen.getByText("61 / 100")).toBeTruthy();
  expect(screen.getByText(/9 AM · 4/)).toBeTruthy();
});
