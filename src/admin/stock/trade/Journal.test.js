import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import Journal from "./Journal";

const mockCalls = [];
let mockViewOverride = null;
const T = (d, hm) => Date.parse(`${d}T${hm}:00+05:30`);
const mockTrip = (key, symbol, side, net, d) => ({ key, symbol, side, maxQty: 100, entryAvg: 100, exitAvg: 101, entryAt: T(d, "10:00"), exitAt: T(d, "11:00"), holdMin: 60, pnl: net + 20, charges: 20, net, intraday: true, open: false, sources: ["kite"], tags: null, exc: null });
const fullView = (extra = {}) => ({
  stats: { trades: 3, open: 0, wins: 2, losses: 1, winRate: 66.7, gross: 1060, charges: 60, net: 1000, avgWin: 700, avgLoss: -400, payoff: 1.75, profitFactor: 1.75, expectancy: 333, largestWin: 800, largestLoss: -400, maxDrawdown: 400, bestStreak: 2, worstStreak: 1, avgHoldMin: 60, tradingDays: 2, greenDays: 1, curve: [{ at: T("2026-11-12", "11:00"), equity: 800 }, { at: T("2026-11-13", "11:00"), equity: 1000 }], calendar: [{ key: "2026-11-12", trades: 2, wins: 1, net: 400, gross: 440, charges: 40, brokerage: 16, taxes: 24, winRate: 50 }, { key: "2026-11-13", trades: 1, wins: 1, net: 600, gross: 620, charges: 20, brokerage: 8, taxes: 12, winRate: 100 }], by: { symbol: [{ key: "SBIN", trades: 1, wins: 1, net: 800, winRate: 100 }, { key: "TCS", trades: 1, wins: 0, net: -400, winRate: 0 }], side: [], kind: [], weekday: [], hour: [], setup: [], mistake: [] } },
  trips: [mockTrip("a", "SBIN", "long", 800, "2026-11-12"), mockTrip("b", "TCS", "short", -400, "2026-11-12"), mockTrip("c", "INFY", "long", 600, "2026-11-13")],
  fills: 6,
  ignoredManual: 0,
  imports: [],
  setups: [],
  mistakes: [],
  firstAt: 1,
  period: { id: "fy", label: "This FY (2026-27)", fromDay: "2026-04-01", toDay: "2026-11-16" },
  returns: { hasCapital: false, needsCapital: true, months: [], daily: [], curve: [], principal: {}, risk: {} },
  capital: [],
  ...extra,
});
const withCapital = {
  hasCapital: true,
  needsCapital: false,
  totalPct: 0.8,
  avgMonthPct: 0.8,
  greenMonths: 1,
  principal: { start: 100000, now: 125000, added: 25000, withdrawn: 0 },
  bestMonth: { month: "2026-11", pct: 0.8, net: 1000 },
  worstMonth: { month: "2026-11", pct: 0.8, net: 1000 },
  bestDay: { date: "2026-11-13", pct: 0.48, net: 600 },
  worstDay: { date: "2026-11-12", pct: 0.32, net: 400 },
  months: [{ month: "2026-11", from: "2026-11-02", to: "2026-11-16", startPrincipal: 100000, endPrincipal: 125000, base: 125000, additions: [{ date: "2026-11-10", amount: 25000, note: "" }], net: 1000, gross: 1060, trades: 3, pct: 0.8, cumPct: 0.8 }],
  daily: [{ date: "2026-11-12", net: 400, trades: 2, principal: 100000, pct: 0.4, cumPct: 0.4 }, { date: "2026-11-13", net: 600, trades: 1, principal: 125000, pct: 0.48, cumPct: 0.88 }],
  curve: [{ date: "2026-11-12", cumPct: 0.4 }, { date: "2026-11-13", cumPct: 0.88 }],
  risk: { days: 25, enough: true, volPct: 0.2, annualVolPct: 3.2, sharpe: 1.4, sortino: 2.1, maxDrawdownPct: 0.3, annualPct: 9.5, calmar: 31.6, note: "" },
  method: "Return = net profit after charges over the principal.",
};
const mockRow = (id, label, trades, net, extra = {}) => ({ id, label, fromDay: "2026-04-01", toDay: "2026-11-16", trades, wins: Math.ceil(trades / 2), winRate: 50, gross: net + 100, pct: Math.round(net / 10) / 100, charges: 100, brokerage: 40, taxes: 60, net, profitFactor: 1.4, expectancy: 10, avgWin: 50, avgLoss: -30, maxDrawdown: 300, days: trades, greenDays: 1, bestDay: { day: "2026-11-13", net: 900 }, worstDay: { day: "2026-11-10", net: -400 }, chargesPct: 12, ...extra });
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
    if (url.startsWith("/api/admin/trading/journal?")) return Promise.resolve(mockViewOverride || mockView);
    if (url === "/api/admin/analysis/days") return Promise.resolve({ days: [{ date: "2026-11-13", weekday: "Fri", source: "auto", summary: { trades: 3, net: 1200, gross: 1400, charges: 200, wins: 2, losses: 1 }, score: 62, good: 2, bad: 1 }], settings: { auto: true, withAi: false, aiReady: false } });
    if (url.startsWith("/api/admin/analysis/analytics")) return Promise.resolve({ count: 1, totals: { days: 0 }, previous: null });
    return Promise.resolve({});
  },
}));
jest.mock("../../aiStatus", () => ({ useAiStatus: () => null }));
const settle = () => act(async () => new Promise((r) => setTimeout(r, 50)));
beforeEach(() => {
  mockCalls.length = 0;
  mockViewOverride = null;
  window.localStorage.clear();
  window.localStorage.setItem("vpt.journal.tab", "calendar"); // the period table lives on the Calendar tab
});

test("profit and loss for every period and every financial year, from Zerodha only — no way to type a trade in", async () => {
  render(<Journal />);
  await settle();
  expect(mockCalls.some(([u]) => u === "/api/admin/trading/journal?period=fy&kind=intraday")).toBe(true);
  const table = screen.getByText("Profit and loss by period").closest("section");
  expect(within(table).getByText("FY 2024-25")).toBeTruthy();
  expect(within(table).getByText("Since the first trade")).toBeTruthy();
  expect(within(table).getByText(/^\+₹5,400/)).toBeTruthy();
  expect(within(table).getByText("+5.40%")).toBeTruthy(); // the return on the money put into the trades, beside the amount
  expect(screen.queryByText(/Add a trade/)).toBeNull();
  expect(screen.getByText("Every month since the start")).toBeTruthy();
  fireEvent.click(within(screen.getByRole("tablist", { name: "Journal sections" })).getByRole("tab", { name: "Reports" })); // where the history comes from lives under Reports
  expect(screen.getByText(/Kite API gives only the/)).toBeTruthy();
  expect(screen.getByText(/2 fills typed in by hand/)).toBeTruthy();
  expect(screen.getByText(/Gaps: weekdays with nothing on record/)).toBeTruthy();
  expect(screen.getByText(/Drop tradebook files here/)).toBeTruthy();
  expect(screen.getByText(/\.xlsx or \.csv from Zerodha Console/)).toBeTruthy();
  expect(mockCalls.some(([u]) => u === "/api/admin/trading/journal/files")).toBe(true);
});

test("the period buttons, a past financial year, a row of the table and a custom range all reload the journal", async () => {
  render(<Journal />);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Yesterday" }));
  await settle();
  expect(mockCalls.some(([u]) => u === "/api/admin/trading/journal?period=yesterday&kind=intraday")).toBe(true);
  fireEvent.change(screen.getByLabelText("Past financial year"), { target: { value: "fy-2024" } });
  await settle();
  expect(mockCalls.some(([u]) => u === "/api/admin/trading/journal?period=fy-2024&kind=intraday")).toBe(true);
  fireEvent.click(screen.getAllByLabelText(/^FY 2025-26: net/)[0]); // the table row (the chart bar has the same name)
  await settle();
  expect(mockCalls.some(([u]) => u === "/api/admin/trading/journal?period=fy-2025&kind=intraday")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Custom…" }));
  // the Material range picker: open it, click a first and a last day; the second one gives the range
  fireEvent.click(screen.getByRole("button", { name: /Your dates/ }));
  fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
  const days = screen.getAllByRole("button").filter((b) => b.getAttribute("data-day"));
  const first = days[0].getAttribute("data-day");
  const last = days[9].getAttribute("data-day");
  fireEvent.click(days[0]);
  fireEvent.click(days[9]);
  await settle();
  expect(mockCalls.some(([u]) => u === `/api/admin/trading/journal?period=custom&from=${first}&to=${last}&kind=intraday`)).toBe(true);
});

test("the Day book is part of the Journal: every day saved by itself, with no button to save one by hand", async () => {
  window.localStorage.clear();
  render(<Journal />);
  await settle();
  fireEvent.click(screen.getByRole("tab", { name: /Day book/ }));
  await settle();
  expect(mockCalls.some(([u]) => u === "/api/admin/analysis/days")).toBe(true);
  expect(screen.getByRole("heading", { name: "Day book" })).toBeTruthy();
  expect(screen.getByText(/nothing is saved or typed by hand/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Save today now|Save this day/ })).toBeNull();
  expect(screen.queryByText(/Auto-save 3:45 PM/)).toBeNull();
});

test("the command bar keeps the period's figures in view and the tabs switch the workspace — Overview, Returns, Performance, Trades, Calendar, Reports", async () => {
  window.localStorage.setItem("vpt.journal.tab", "overview");
  mockViewOverride = fullView({ returns: withCapital, capital: [{ id: "a", date: "2026-11-02", amount: 100000, note: "" }, { id: "b", date: "2026-11-10", amount: 25000, note: "added" }] });
  render(<Journal />);
  await settle();
  const bar = screen.getByRole("region", { name: "The period at a glance" });
  expect(within(bar).getByText(/^\+₹1,000/)).toBeTruthy();
  expect(within(bar).getByText("+0.80%")).toBeTruthy(); // the return on the principal
  expect(within(bar).getByText("67%")).toBeTruthy();
  // the headline: the principal, with the addition counted from its day
  expect(screen.getByText(/of your ₹1,25,000 principal/)).toBeTruthy();
  expect(screen.getByText(/counted from the day it was made/)).toBeTruthy();
  const tab = (name) => within(screen.getByRole("tablist", { name: "Journal sections" })).getByRole("tab", { name: new RegExp(`^${name}`) });
  fireEvent.click(tab("Returns"));
  expect(screen.getByText("Month by month, on the principal")).toBeTruthy();
  expect(screen.getByText("Sharpe ratio")).toBeTruthy();
  expect(screen.getByText("1.40")).toBeTruthy();
  expect(screen.getByText("Your capital")).toBeTruthy();
  fireEvent.click(tab("Reports"));
  expect(screen.getByRole("button", { name: /Print \/ save as PDF/ })).toBeTruthy();
  expect(screen.getByLabelText("Printable report")).toBeTruthy();
  fireEvent.click(tab("Performance"));
  expect(screen.getByText("How often you win")).toBeTruthy();
  // keys 1–6
  fireEvent.keyDown(window, { key: "4" });
  expect(tab("Trades").getAttribute("aria-selected")).toBe("true");
});

test("without capital recorded the bar and the headline ask for it, and adding it goes to the ledger", async () => {
  window.localStorage.setItem("vpt.journal.tab", "returns");
  mockViewOverride = fullView();
  render(<Journal />);
  await settle();
  expect(screen.getByText(/Add your capital to see returns in percent/)).toBeTruthy();
  const bar = screen.getByRole("region", { name: "The period at a glance" });
  expect(within(bar).getByText("add capital")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: "100000" } });
  fireEvent.click(screen.getByRole("button", { name: "Add to the ledger" }));
  await settle();
  const post = mockCalls.find(([u, m]) => u === "/api/admin/trading/journal/capital" && m === "POST");
  expect(post).toBeTruthy();
});

test("the trades list can be searched, filtered by result and sorted, and says what the shown trades made", async () => {
  window.localStorage.setItem("vpt.journal.tab", "trades");
  mockViewOverride = fullView();
  render(<Journal />);
  await settle();
  expect(screen.getByText(/3 of 3 trades/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Search a stock"), { target: { value: "tcs" } });
  expect(screen.getByText(/1 of 3 trades/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Search a stock"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Result"), { target: { value: "loss" } });
  expect(screen.getByText(/1 of 3 trades · net/)).toBeTruthy();
  expect(screen.queryByText("SBIN")).toBeNull();
});
