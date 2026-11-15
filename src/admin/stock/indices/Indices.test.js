import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import Indices from "./Indices";
import mockFixture from "./indices.fixture.json";

// the analysis as the server sends it (market/indices.js on a synthetic series), with the service's fields
const mockView = {
  ...mockFixture,
  index: { id: "NIFTY", name: "NIFTY 50", exchange: "NSE" },
  demo: false,
  source: "kite",
  fetchedAt: "2026-11-13T10:20:00Z",
  stale: false,
  staleReason: "",
  settings: { aiAuto: true, aiToday: 0, aiDailyCap: 12 },
  ai: { ready: true, model: "Claude Sonnet 5.5" },
  ledger: {
    items: [
      { id: "d1", index: "NIFTY", horizon: "month", period: "2026-10", label: "Oct 2026", kind: "desk", by: "Desk model (desk-v1)", madeAt: "2026-10-01T03:00:00Z", startLevel: 2400, base: 2400, mid: 2420, low68: 2330, high68: 2510, low90: 2280, high90: 2570, lean: "up", probUp: 61, status: "settled", actual: 2450, actualPct: 2.08, dirHit: true, in68: true, in90: true, errPct: 1.24 },
      { id: "a1", index: "NIFTY", horizon: "month", period: "2026-10", label: "Oct 2026", kind: "ai", by: "Claude Sonnet 5.5", madeAt: "2026-10-01T03:30:00Z", startLevel: 2400, base: 2400, mid: 2380, low68: 2350, high68: 2410, lean: "down", probUp: 40, status: "settled", actual: 2450, actualPct: 2.08, dirHit: false, in68: false, in90: null, errPct: 2.94, check: { ok: true, notes: [] } },
    ],
    desk: { month: { n: 1, leaned: 1, hits: 1, hitRate: 100, upShare: 100, in68Rate: 100, in90Rate: 100, maePct: 1.24, maeNaivePct: 2.08, skillPct: 40 }, year: { n: 0 } },
    ai: { month: { n: 1, leaned: 1, hits: 0, hitRate: 0, upShare: 100, in68Rate: 0, in90Rate: null, maePct: 2.94, maeNaivePct: 2.08, skillPct: -41 }, year: { n: 0 } },
    open: 0,
    refused: 0,
  },
};
const mockCompare = {
  available: true,
  demo: false,
  a: { id: "NIFTY", name: "NIFTY 50", from: "2012-01-02", to: "2026-11-13" },
  b: { id: "SENSEX", name: "SENSEX", from: "2012-01-02", to: "2026-11-13" },
  months: { n: 170, corr: 0.98, sameDirPct: 94, aBetter: 80, bBetter: 90, avgAbsDiffPct: 0.41, avgDiffPct: -0.02 },
  years: { n: 14, corr: 0.99, sameDirPct: 100, aBetter: 6, bBetter: 8, avgAbsDiffPct: 1.1, avgDiffPct: -0.1 },
  rows: [
    { y: 2026, a: { pct: 4.2, chg: 980, close: 24100, partial: true }, b: { pct: 3.9, chg: 3000, close: 79100, partial: true }, months: [{ a: { pct: 1.1, chg: 230, close: 23500, partial: false }, b: { pct: 0.9, chg: 700, close: 76800, partial: false } }, null, null, null, null, null, null, null, null, null, null, null] },
    { y: 2025, a: { pct: 10.5, chg: 2200, close: 23120, partial: false }, b: { pct: 9.8, chg: 6800, close: 76100, partial: false }, months: Array(12).fill(null) },
  ],
  largestGaps: [{ key: "2025-03", label: "Mar 2025", a: 3.2, b: 1.9, diff: 1.3 }],
};
const mockCalls = [];
jest.mock("../../api", () => ({
  api: (url, opts) => {
    mockCalls.push(opts && opts.method ? `${opts.method} ${url}` : url);
    if (url.startsWith("/api/admin/indices?index=")) return Promise.resolve(mockView);
    if (url === "/api/admin/indices/compare") return Promise.resolve(mockCompare);
    if (url === "/api/admin/indices/ai") return Promise.resolve({ entry: { status: "open", mid: 2555.5, check: { ok: true, notes: ["Its range is narrower than half of what the index's volatility allows: likely overconfident."] } }, settings: mockView.settings });
    return Promise.resolve({});
  },
}));
jest.mock("../../auth", () => ({ useAuth: () => ({ user: { role: "superadmin" } }) }));
const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));
beforeEach(() => {
  mockCalls.length = 0;
  window.localStorage.clear();
});

test("one index: the numbers now, the month's and the year's projection with the AI's, and the backtest with the ledger", async () => {
  render(<Indices />);
  await settle();
  expect(mockCalls).toContain("/api/admin/indices?index=NIFTY");
  expect(screen.getByText(/Daily history from Zerodha: 2 Jan 2012 to 13 Nov 2026 · 13 complete years/)).toBeTruthy();
  expect(screen.getByText("November in history")).toBeTruthy();
  expect(screen.getByText(`rose ${mockView.thisMonth.up} of ${mockView.thisMonth.n}`)).toBeTruthy();
  // the projections
  expect(screen.getByRole("region", { name: "This month: projection" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "This year: projection" })).toBeTruthy();
  expect(screen.getByRole("img", { name: /^Nov 2026: started at .* the desk expects .* at the end \(68% range/ })).toBeTruthy();
  expect(screen.getAllByText(/^November rose in \d+ of \d+ years on record/).length).toBeGreaterThan(0);
  // the backtest: walk-forward, and the ledger with the desk and the AI side by side
  const bt = screen.getByRole("region", { name: "Backtest" });
  expect(within(bt).getByText(/The desk’s model, walk-forward/)).toBeTruthy();
  expect(within(bt).getByText("the desk, live")).toBeTruthy();
  expect(within(bt).getByText("the AI, live")).toBeTruthy();
  expect(within(bt).getByText("AI · Claude Sonnet 5.5")).toBeTruthy();
  expect(within(bt).getAllByText("Oct 2026").length).toBe(2);
  // ask the AI: its checked projection goes into the ledger
  fireEvent.click(screen.getAllByRole("button", { name: "Ask the AI for its projection" })[0]);
  await settle();
  expect(mockCalls).toContain("POST /api/admin/indices/ai");
  expect(screen.getByText(/The AI's month projection is in the ledger: 2,555.50 — Its range is narrower/)).toBeTruthy();
});

test("the year × month table, each calendar month, every year — in percent or in points", async () => {
  render(<Indices />);
  await settle();
  const heat = screen.getByRole("region", { name: "Every year, every month" });
  expect(within(heat).getByText("2026")).toBeTruthy();
  expect(within(heat).getByText("Average")).toBeTruthy();
  expect(within(heat).getByText("Rose")).toBeTruthy();
  const cell = mockView.heat[0].cells[0];
  expect(within(heat).getAllByText(`${cell.pct > 0 ? "+" : "−"}${Math.abs(cell.pct).toFixed(1)}%`).length).toBeGreaterThan(0);
  const months = screen.getByRole("region", { name: "Each calendar month over the years" });
  expect(within(months).getByText("November")).toBeTruthy();
  expect(screen.getByRole("region", { name: "Every year" })).toBeTruthy();
  expect(screen.getByText("Falls from the high")).toBeTruthy();
  expect(screen.getByText("The turn of the month")).toBeTruthy();
  // points instead of percent
  fireEvent.click(screen.getByRole("button", { name: "Points" }));
  await settle();
  expect(within(heat).getByText(/points from the previous month's close/)).toBeTruthy();
});

test("side by side: how closely they move, month by month in a chosen year, and where they parted most", async () => {
  render(<Indices />);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Side by side" }));
  await settle();
  expect(mockCalls).toContain("/api/admin/indices/compare");
  expect(screen.getByText("0.98")).toBeTruthy();
  expect(screen.getByText("94%")).toBeTruthy();
  expect(screen.getByText("NIFTY 50 did better")).toBeTruthy();
  expect(screen.getByText("Mar 2025")).toBeTruthy();
  expect(screen.getByRole("img", { name: "NIFTY 50 and SENSEX year by year" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "2025" }));
  await settle();
  expect(screen.getAllByText("+10.50%").length).toBeGreaterThan(0);
});
