import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AuthContext } from "../auth";
import TradeAI from "./TradeAI";

const mockCalls = [];
const mockConv = { id: "abc123abc123", title: "SBIN check", updatedAt: new Date().toISOString(), pinned: false, count: 2, preview: "" };
const mockReply = { answer: "### SBIN\n**Hold** while 799 holds.\n\n| Level | Price |\n|---|---|\n| VWAP | 803.2 |", datapoints: [{ label: "P&L", value: "+₹240" }], actions: [{ kind: "corrective", text: "Keep the stop at 799." }], forecast: { lean: "up", horizon: "next 30 minutes", scenarios: ["Above 809: 813"] }, confidence: "medium", followups: [], related: ["Where should I trail my stop on SBIN?"], meta: { used: ["SBIN"], by: ["A", "B", "C"], mergedBy: "A", sec: 12.3, steps: ["Reading SBIN"], models: [] } };
jest.mock("../api", () => ({
  api: (url, opts = {}) => {
    mockCalls.push([url, opts.method || "GET", opts.body]);
    if (url.startsWith("/api/admin/tradeai/suggest")) return Promise.resolve({ suggestions: [{ text: "My INFY short is down ₹300 — should I exit or hold?", why: "Open short · −₹300", kind: "position", score: 130 }], positions: 2 });
    if (url.startsWith("/api/admin/tradeai/convs/abc123abc123")) return Promise.resolve({ ...mockConv, messages: [{ id: "m1", role: "user", text: "How is SBIN?" }, { id: "m2", role: "assistant", text: mockReply.answer, reply: mockReply }] });
    if (url.startsWith("/api/admin/tradeai/convs")) return Promise.resolve({ convs: [mockConv] });
    return Promise.resolve({});
  },
}));
jest.mock("react-router-dom", () => {
  const { createElement } = require("react");
  return { Link: ({ to, children, ...rest }) => createElement("a", { href: to, ...rest }, children) };
});

const page = () => (
  <AuthContext.Provider value={{ loading: false, user: { email: "o@example.com", name: "Test Person", role: "superadmin" }, reload() {} }}>
    <div className="adm">
      <TradeAI />
    </div>
  </AuthContext.Provider>
);
const settle = () => act(async () => new Promise((r) => setTimeout(r, 300)));

beforeEach(() => {
  mockCalls.length = 0;
  window.history.replaceState(null, "", "/me/tradeai");
  Element.prototype.scrollTo = function scrollTo() {};
});

test("a new chat greets you, suggests from your open positions, and lists your saved chats", async () => {
  render(page());
  await settle();
  expect(screen.getByText(/, Test$/)).toBeTruthy();
  expect(screen.getByText(/INFY short is down ₹300/)).toBeTruthy();
  expect(screen.getByText("Open short · −₹300")).toBeTruthy();
  expect(screen.getByText(/from your 2 open positions/)).toBeTruthy();
  expect(screen.getByText("SBIN check")).toBeTruthy();
  expect(mockCalls.some(([u]) => u === "/api/admin/tradeai/suggest")).toBe(true);
});

test("opening a saved chat shows the rich answer: table, key numbers, forecast, actions and related questions", async () => {
  render(page());
  await settle();
  fireEvent.click(screen.getByText("SBIN check"));
  await settle();
  expect(screen.getByRole("table")).toBeTruthy();
  expect(screen.getByText("+₹240").className).toMatch(/is-up/);
  expect(screen.getByText(/Leans up/)).toBeTruthy();
  expect(screen.getByText("Keep the stop at 799.")).toBeTruthy();
  expect(screen.getByText("Where should I trail my stop on SBIN?")).toBeTruthy();
  expect(screen.getByText(/merged by A/)).toBeTruthy();
  expect(window.location.search).toBe("?c=abc123abc123");
});

test("searching chats asks the database with the words typed", async () => {
  render(page());
  await settle();
  fireEvent.change(screen.getByLabelText("Search chats"), { target: { value: "vwap" } });
  await settle();
  expect(mockCalls.some(([u]) => u === "/api/admin/tradeai/convs?q=vwap")).toBe(true);
});
