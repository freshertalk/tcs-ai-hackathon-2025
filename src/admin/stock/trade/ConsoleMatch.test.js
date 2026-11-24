import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ConsoleMatch, { resultSaid } from "./ConsoleMatch";
import { api } from "../../api";
import { uploadConsoleFile } from "./consoleUpload";

jest.mock("../../api", () => ({ api: jest.fn() }));
jest.mock("../../live", () => ({ useTopics: () => {} }));
jest.mock("../../dialog/DialogProvider", () => ({ useDialog: () => () => Promise.resolve(true) }));
jest.mock("./consoleUpload", () => ({ CONSOLE_FILE: /\.(csv|xlsx|txt)$/i, uploadConsoleFile: jest.fn() }));

const REC = {
  from: "2026-11-12",
  to: "2026-11-23",
  file: "ledger-XX.xlsx",
  counts: { match: 1, off: 1, check: 1, corrected: 1 },
  days: [
    { date: "2026-11-12", ledger: 7967.28, app: 7967.5, appNow: 7967.5, diff: -0.22, fix: 0, status: "match", trades: 2 },
    { date: "2026-11-19", ledger: -3648.96, app: -3399, appNow: -3399, diff: -249.96, fix: 0, status: "check", trades: 3 },
    { date: "2026-11-20", ledger: 4544.76, app: 4540.1, appNow: 4540.1, diff: 4.66, fix: 0, status: "off", trades: 2 },
    { date: "2026-11-23", ledger: 1295.36, app: 1290, appNow: 1295.36, diff: 5.36, fix: -5.36, status: "corrected", trades: 1 },
  ],
};

beforeEach(() => {
  api.mockReset();
  uploadConsoleFile.mockReset();
  api.mockImplementation((url) => (url.endsWith("/reconcile") ? Promise.resolve(REC) : Promise.resolve({ reconcile: REC })));
});

test("every day against the ledger: newest first, a result for each, and what can be done about it", async () => {
  const { container } = render(<ConsoleMatch />);
  await waitFor(() => expect(container.querySelectorAll(".cm-table tbody tr").length).toBe(4));
  const rows = [...container.querySelectorAll(".cm-table tbody tr")].map((r) => r.textContent);
  expect(rows[0]).toMatch(/23 Nov 2026.*Corrected to match.*Undo/);
  expect(rows[1]).toMatch(/20 Nov 2026.*\+₹4,544\.76.*Differs a little.*Correct/);
  expect(rows[2]).toMatch(/19 Nov 2026.*Check the trades/);
  expect(rows[3]).toMatch(/12 Nov 2026.*Matches/);
  expect(container.querySelector(".cm-head .cm-chip").textContent).toBe("1 day to check");
  expect(screen.getByRole("button", { name: /Correct 1 day to match/ })).toBeTruthy();
});

test("Correct sends the day and shows the answer", async () => {
  const onChanged = jest.fn();
  render(<ConsoleMatch onChanged={onChanged} />);
  await waitFor(() => screen.getByRole("button", { name: /Correct 1 day to match/ }));
  fireEvent.click(screen.getByRole("button", { name: /Correct 1 day to match/ }));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(api).toHaveBeenCalledWith("/api/admin/trading/journal/reconcile/apply", { method: "POST", body: {} });
});

test("Undo asks, then removes that day's correction", async () => {
  const onChanged = jest.fn();
  render(<ConsoleMatch onChanged={onChanged} />);
  await waitFor(() => screen.getByRole("button", { name: "Undo" }));
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(api).toHaveBeenCalledWith("/api/admin/trading/journal/reconcile/2026-11-23", { method: "DELETE" });
});

test("files are read tradebook first, the ledger last; each says what it was; a wrong file is said, not hidden", async () => {
  const order = [];
  uploadConsoleFile.mockImplementation((f) => {
    order.push(f.name);
    if (/bad/.test(f.name)) return Promise.reject(new Error("bad.xlsx: this is not a Zerodha Console tradebook or ledger."));
    return Promise.resolve(/ledger/.test(f.name) ? { type: "ledger", added: 1, read: 1, settledDays: 8, left: { "trade settlements": 8 }, matched: ["2026-11-19"] } : { type: "tradebook", added: 11, read: 12, fromDay: "2026-11-12", toDay: "2026-11-23" });
  });
  const { container } = render(<ConsoleMatch />);
  await waitFor(() => container.querySelector(".cm-table"));
  const files = [new File(["x"], "ledger-AB.xlsx"), new File(["x"], "tradebook-AB.xlsx"), new File(["x"], "bad.xlsx"), new File(["x"], "photo.png")];
  await act(async () => {
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files } });
  });
  await waitFor(() => expect(container.querySelectorAll(".cm-q").length).toBe(3));
  expect(order[0]).toBe("tradebook-AB.xlsx");
  expect(order.indexOf("ledger-AB.xlsx")).toBeGreaterThan(order.indexOf("tradebook-AB.xlsx"));
  const said = [...container.querySelectorAll(".cm-q")].map((q) => q.textContent).join("|");
  expect(said).toMatch(/Tradebook: 11 new trades added \(1 already here\), 12 Nov 2026 – 23 Nov 2026/);
  expect(said).toMatch(/Ledger: 8 days of settlements read\..*1 day corrected to match/);
  expect(said).toMatch(/not a Zerodha Console tradebook or ledger/);
  expect(screen.getByText(/1 file was left out/)).toBeTruthy();
});

test("what a result says", () => {
  expect(resultSaid({ type: "tradebook", added: 1, read: 1 })).toBe("Tradebook: 1 new trade added.");
});

const ST = {
  key: "2026-11-11_2026-11-24",
  from: "2026-11-11",
  to: "2026-11-24",
  file: "pnl-XX.xlsx",
  trades: 11,
  corrected: 0,
  ok: false,
  rows: [
    { label: "Realised P&L", console: 5868.2, app: 5868.2, diff: 0, ok: true },
    { label: "Charges & taxes", console: 1647.72, app: 1640.51, diff: -7.21, ok: false },
    { label: "Other credits & debits", console: -59, app: -59, diff: 0, ok: true },
    { label: "Net realised P&L", console: 4161.48, app: 4168.69, diff: 7.21, ok: false },
  ],
  heads: [
    { head: "brokerage", console: 489.11, est: 489.11, app: 489.11, diff: 0, ok: true },
    { head: "exchange", console: 185.13, est: 179.09, app: 179.09, diff: -6.04, ok: false },
  ],
  symbols: [{ symbol: "HINDCOPPER", console: 7390.5, app: 7390.5, diff: 0, ok: true }],
};

test("Console's P&L statement against the journal: each figure with its result, the heads, the symbols; Correct sends the statement", async () => {
  let now = ST; // the server's statement: corrected after the press
  api.mockImplementation((url, opts) => {
    if (url.endsWith("/reconcile")) return Promise.resolve({ days: [], counts: {} });
    if (url.includes("/pnl/") && opts && opts.method === "POST") {
      now = { ...ST, ok: true, corrected: 2, rows: ST.rows.map((r) => ({ ...r, ok: true, diff: 0 })), heads: ST.heads.map((h) => ({ ...h, ok: true })) };
      return Promise.resolve({ statements: [now] });
    }
    if (url.endsWith("/pnl")) return Promise.resolve({ statements: [now] });
    return Promise.resolve({});
  });
  const { container } = render(<ConsoleMatch />);
  await waitFor(() => expect(container.querySelector(".cm-st")).toBeTruthy());
  expect(container.querySelector(".cm-st h4").textContent).toMatch(/11 Nov 2026 – 24 Nov 2026/);
  const rows = [...container.querySelectorAll(".cm-st > .cm-wrap tbody tr")].map((r) => r.textContent);
  expect(rows[1]).toMatch(/Charges & taxes.*₹1,647\.72.*₹1,640\.51.*−₹7\.21Differs/);
  expect(rows[0]).toMatch(/Matches/);
  expect(container.querySelector(".cm-st .cm-chip").textContent).toBe("Charges differ");
  expect(container.querySelector(".cm-head .cm-chip").textContent).toBe("Differs from Console’s P&L");
  fireEvent.click(screen.getByRole("button", { name: "Correct charges to Console" }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/api/admin/trading/journal/pnl/2026-11-11_2026-11-24/apply", { method: "POST", body: {} }));
  await waitFor(() => expect(container.querySelector(".cm-st .cm-chip").textContent).toBe("Every figure matches"));
});

test("a P&L statement uploaded says what it is", () => {
  expect(resultSaid({ type: "pnl", from: "2026-11-11", to: "2026-11-24", added: 1, compare: { ok: false } })).toBe("P&L statement of 11 Nov 2026 – 24 Nov 2026: kept as the reference, 1 other credit or debit added. Some figures differ: see below.");
});
