import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import Journal from "./Journal";

const mockCalls = [];
const mockRow = (id, label, trades, net, extra = {}) => ({ id, label, fromDay: "2026-04-01", toDay: "2026-11-16", trades, wins: Math.ceil(trades / 2), winRate: 50, gross: net + 100, charges: 100, brokerage: 40, taxes: 60, net, profitFactor: 1.4, expectancy: 10, avgWin: 50, avgLoss: -30, maxDrawdown: 300, days: trades, greenDays: 1, bestDay: { day: "2026-11-13", net: 900 }, worstDay: { day: "2026-11-10", net: -400 }, chargesPct: 12, ...extra });
const mockPer = {
  today: "2026-11-16",
  firstDay: "2024-12-10",
  accountSince: "",
  rows: [mockRow("today", "Today", 1, 120, { fromDay: "2026-11-16" }), mockRow("yesterday", "Yesterday (13 Nov 2026)", 2, -80), mockRow("fy", "This FY (2026-27)", 40, 5400)],
  fys: [mockRow("fy-2025", "FY 2025-26", 120, -2300), mockRow("fy-2024", "FY 2024-25", 30, 900)],
  all: mockRow("all", "Since the first trade", 190, 4000),
  months: [{ month: "2026-10", fy: 2026, net: 1200, gross: 1500, charges: 300, trades: 10, winRate: 60, profitFactor: 1.8 }, { month: "2025-06", fy: 2025, net: -700, gross: -500, charges: 200, trades: 8, winRate: 30, profitFactor: 0.6 }],
  sources: { kite: 120, console: 900, imports: [], capturedDays: 12, lastCaptured: null },
  gaps: [{ fromDay: "2025-08-04", toDay: "2025-08-29", weekdays: 20 }],
  views: [],
  capture: { running: true, connected: true, everyMin: 5, at: "2026-11-16T05:30:00.000Z", trades: 3, error: "" },
  snapshots: { days: 4, latestAt: null },
};
const mockView = { stats: { trades: 0, open: 0, calendar: [], curve: [], by: { symbol: [] } }, trips: [], fills: 1020, ignoredManual: 2, imports: [], setups: [], mistakes: [], firstAt: 1, period: { id: "fy", label: "This FY (2026-27)", fromDay: "2026-04-01", toDay: "2026-11-16" }, analytics: { summary: {}, months: [] } };
jest.mock("../../api", () => ({
  api: (url, opts = {}) => {
    mockCalls.push([url, opts.method || "GET"]);
    if (url.startsWith("/api/admin/trading/journal/periods")) return Promise.resolve(mockPer);
    if (url.startsWith("/api/admin/trading/journal/reviews")) return Promise.resolve({ configured: false, reviews: [] });
    if (url.startsWith("/api/admin/trading/journal?")) return Promise.resolve(mockView);
    return Promise.resolve({});
  },
}));
jest.mock("../../aiStatus", () => ({ useAiStatus: () => null }));
const settle = () => act(async () => new Promise((r) => setTimeout(r, 50)));
beforeEach(() => {
  mockCalls.length = 0;
});

test("profit and loss for every period and every financial year, from Zerodha only — no way to type a trade in", async () => {
  render(<Journal />);
  await settle();
  expect(mockCalls.some(([u]) => u === "/api/admin/trading/journal?period=fy")).toBe(true);
  const table = screen.getByText("Profit and loss by period").closest("section");
  expect(within(table).getByText("FY 2024-25")).toBeTruthy();
  expect(within(table).getByText("Since the first trade")).toBeTruthy();
  expect(within(table).getByText(/^\+₹5,400/)).toBeTruthy();
  expect(screen.queryByText(/Add a trade/)).toBeNull();
  expect(screen.getByText(/Kite API gives only the/)).toBeTruthy();
  expect(screen.getByText(/2 fills typed in by hand/)).toBeTruthy();
  expect(screen.getByText(/Gaps: weekdays with nothing on record/)).toBeTruthy();
  expect(screen.getByText(/Drop tradebook files here/)).toBeTruthy();
  expect(screen.getByText(/\.xlsx or \.csv from Zerodha Console/)).toBeTruthy();
  expect(mockCalls.some(([u]) => u === "/api/admin/trading/journal/files")).toBe(true);
  expect(screen.getByText("Every month since the start")).toBeTruthy();
});

test("the period buttons, a past financial year, a row of the table and a custom range all reload the journal", async () => {
  render(<Journal />);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Yesterday" }));
  await settle();
  expect(mockCalls.some(([u]) => u === "/api/admin/trading/journal?period=yesterday")).toBe(true);
  fireEvent.change(screen.getByLabelText("Past financial year"), { target: { value: "fy-2024" } });
  await settle();
  expect(mockCalls.some(([u]) => u === "/api/admin/trading/journal?period=fy-2024")).toBe(true);
  fireEvent.click(screen.getAllByLabelText(/^FY 2025-26: net/)[0]); // the table row (the chart bar has the same name)
  await settle();
  expect(mockCalls.some(([u]) => u === "/api/admin/trading/journal?period=fy-2025")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Custom…" }));
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-06-01" } });
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-06-30" } });
  fireEvent.click(screen.getByRole("button", { name: "Show" }));
  await settle();
  expect(mockCalls.some(([u]) => u === "/api/admin/trading/journal?period=custom&from=2026-06-01&to=2026-06-30")).toBe(true);
});
