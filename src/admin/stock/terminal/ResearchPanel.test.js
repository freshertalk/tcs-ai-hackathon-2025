import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import ResearchButton from "./ResearchPanel";

const mockFindings = [
  { id: "a", feature: "exit-levels", source: "Exit levels (Live board)", symbol: "SBIN", by: "Claude Sonnet 5.5", clock: "10:50", ageMin: 3, last: 806, fresh: true, moved: false, summary: "Long from ₹800.00: target 1 ₹809.40 (R1), stop ₹803.10.", tags: { confidence: "medium" }, facts: { target1: 809.4, stop: 803.1 }, detail: { checked: "2 of 3 choices passed the desk's check" } },
  { id: "b", feature: "ensemble-live", source: "AI Live", symbol: "SBIN", by: "Claude Sonnet 5.5", clock: "09:40", ageMin: 73, last: 799, fresh: false, moved: true, summary: "SBIN leans up for the next 30 minutes.", tags: { lean: "up" }, facts: {}, detail: null },
];
const mockLearn = {
  available: true,
  days: 21,
  from: "2026-10-15",
  to: "2026-11-13",
  stocks: 12,
  tests: 1840,
  note: "Held = the price fell back one step before closing beyond the level.",
  levels: [
    { source: "prev-high", name: "The previous day's high", held: 54, broke: 34, n: 88, pct: 61, own: { n: 22, pct: 64 }, hours: [] },
    { source: "vwap", name: "VWAP", held: 70, broke: 60, n: 130, pct: 54, own: null, hours: [] },
  ],
  findings: ["Measured by the desk on 21 trading days.", "The previous day's high held on 61% of 88 tests."],
  aiLevels: { judged: 12, text: "First target reached before the stop on 7 of 12 sets (58%)." },
  status: { lastRun: { at: "2026-11-13T10:15:00Z" } },
};
const mockCalls = [];
jest.mock("../../api", () => ({
  api: (url, opts) => {
    mockCalls.push(opts && opts.method === "POST" ? `POST ${url}` : url);
    if (url.startsWith("/api/admin/ai/shared")) return Promise.resolve({ symbol: "SBIN", findings: mockFindings, stats: { kept: 2, fresh: 1, stocks: 1, readsToday: 4 } });
    if (url === "/api/admin/learn/run") return Promise.resolve({ studied: [{ date: "2026-11-13", symbols: 12, tests: 90 }] });
    if (url.startsWith("/api/admin/learn")) return Promise.resolve(mockLearn);
    return Promise.resolve({});
  },
}));
jest.mock("react-router-dom", () => {
  const { createElement } = require("react");
  return { Link: ({ to, children, ...rest }) => createElement("a", { href: to, ...rest }, children) };
});
jest.mock("../../auth", () => ({ useAuth: () => ({ user: { role: "superadmin" } }) }));
const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));
beforeEach(() => {
  mockCalls.length = 0;
});

test("the top bar's lamp: the AI's findings on the open stock, shared by every workspace — and what the desk has learned", async () => {
  render(<ResearchButton symbol="SBIN" />);
  await settle();
  // the button counts the fresh findings on the open stock
  const btn = screen.getByRole("button", { name: "AI research shared across the desk: 1 fresh finding on SBIN" });
  expect(mockCalls).toContain("/api/admin/ai/shared?symbol=SBIN");
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(btn);
  await settle();
  expect(screen.getByRole("dialog", { name: /AI research, shared/ })).toBeTruthy();
  // each finding: who found it, when, at what price, what it said, and whether it still stands
  expect(screen.getByText("Exit levels (Live board)")).toBeTruthy();
  expect(screen.getByText(/Claude Sonnet 5\.5 · 10:50 \(3 min ago\) · at ₹806\.00/)).toBeTruthy();
  expect(screen.getByText(/target 1 ₹809\.40 \(R1\), stop ₹803\.10/)).toBeTruthy();
  expect(screen.getByText("✓ 2 of 3 choices passed the desk's check")).toBeTruthy();
  expect(screen.getByText("AI Live")).toBeTruthy();
  expect(screen.getByText("old")).toBeTruthy();
  expect(screen.getByText("price has moved")).toBeTruthy();
  expect(screen.getByText(/1 fresh finding on 1 stock; read 4 times today by other features instead of a new AI request/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Ask TradeAI about SBIN" })).toBeTruthy();
  // what the desk has measured by itself
  fireEvent.click(screen.getByRole("tab", { name: "Learned" }));
  await settle();
  expect(mockCalls).toContain("/api/admin/learn?symbol=SBIN");
  expect(screen.getByText(/21 trading days \(2026-10-15 to 2026-11-13\) · 12 stocks · 1,840 tests of a level/)).toBeTruthy();
  expect(screen.getByRole("img", { name: "held 61% of 88 tests" })).toBeTruthy();
  expect(screen.getByText("64% of 22")).toBeTruthy(); // the stock's own record
  expect(screen.getByText("The previous day's high held on 61% of 88 tests.")).toBeTruthy();
  expect(screen.getByText(/First target reached before the stop on 7 of 12 sets/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Study now" }));
  await settle();
  expect(mockCalls).toContain("POST /api/admin/learn/run");
  expect(screen.getByText("Studied 2026-11-13.")).toBeTruthy();
  // Escape closes it
  fireEvent.keyDown(document, { key: "Escape" });
  await settle(); // the button counts the findings again once the panel is closed
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("the panel's class names are its own: the terminal's sheet never styles the Research page's \"rs\" classes", () => {
  // on 2026-11-16 this panel was first written with the prefix "rs", which is the Research page's:
  // its width rule squeezed that whole page into 520px. The panel's prefix is "shr".
  const fs = require("fs");
  const path = require("path");
  const css = fs.readFileSync(path.join(__dirname, "terminal.css"), "utf8");
  const mine = css.split("\n").filter((l) => /^\.rs(\b|-)/.test(l.trim()));
  expect(mine).toEqual([]);
  const jsx = fs.readFileSync(path.join(__dirname, "ResearchPanel.jsx"), "utf8");
  expect(/className=(\{`|")rs(-|"| )/.test(jsx)).toBe(false);
  expect(jsx.includes('className="tm-alerts shr"')).toBe(true);
});
