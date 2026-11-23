import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ChargesBreakdown, MonthCalendar } from "./JournalLedger";
import { api } from "../../api";

jest.mock("../../api", () => ({ api: jest.fn() }));
const mockAsk = jest.fn(async () => true);
jest.mock("../../dialog/DialogProvider", () => ({ useDialog: () => mockAsk }));
const mockSnack = jest.fn();
jest.mock("../../ux/snack", () => ({ snack: (...a) => mockSnack(...a) }));
afterEach(() => {
  api.mockReset();
  mockSnack.mockReset();
});

const s = { gross: 10000, charges: 1000, net: 9000, trades: 20 };
const parts = { brokerage: 400, stt: 300, exchange: 100, sebi: 10, gst: 90, stamp: 60, dp: 40 };
const manual = [{ date: "2026-11-18", gross: 2500, parts: { brokerage: 40, stt: 20, exchange: 0, sebi: 0, gst: 0, stamp: 0, dp: 0, other: 0 }, charges: 60, net: 2440, trades: 3, note: "another broker", source: "manual", updatedAt: null }];

test("charges & taxes: every charge on its own, the statement from realised P&L to net, taxes apart from fees, hand-entered days on request", () => {
  const { container } = render(<ChargesBreakdown s={s} parts={parts} manual={manual} label="November 2026" />);
  const kpis = container.querySelector(".jl-kpis").textContent;
  expect(kpis).toMatch(/Realised P&L\+₹12,500/);
  expect(kpis).toMatch(/Charges & taxes−₹1,060/);
  expect(kpis).toMatch(/Net realised P&L\+₹11,440/);
  const legend = container.querySelector(".jl-legend").textContent;
  expect(legend).toMatch(/Brokerage fee₹440/);
  expect(legend).toMatch(/STT tax₹320/);
  expect(container.querySelector(".jl-fall").textContent).toMatch(/Realised P&L.*\+₹12,500.*Brokerage.*−₹440.*Net realised P&L.*\+₹11,440/);
  // taxes (STT + GST + stamp) apart from fees (brokerage + exchange + SEBI + DP)
  expect(kpis).toMatch(/Taxes · fees₹470\.00 · ₹590\.00/);
  // without the day entered by hand
  fireEvent.click(screen.getByRole("checkbox", { name: /Include 1 day entered by hand/ }));
  expect(container.querySelector(".jl-kpis").textContent).toMatch(/Net realised P&L\+₹9,000/);
});

const calendar = [{ key: "2026-11-20", net: 1234.5, gross: 1300, charges: 65.5, trades: 2 }];
const trips = [{ key: "a", symbol: "INFY", side: "long", qty: 10, entryAvg: 1500, exitAvg: 1510, open: false, exitAt: Date.parse("2026-11-20T10:00:00+05:30"), net: 60, parts: { brokerage: 40, stt: 3.8, exchange: 0.9, sebi: 0, gst: 7.4, stamp: 0.5, dp: 0 } }];

test("the month calendar: each day's net; a Zerodha day opens read-only with its trades and charges", async () => {
  const { container } = render(<MonthCalendar calendar={calendar} trips={trips} manual={manual} toDay="2026-11-30" onChanged={() => {}} />);
  expect(screen.getByRole("heading", { name: "November 2026" })).toBeTruthy();
  expect(container.querySelector(".jl-cal__sum").textContent).toMatch(/\+₹3,674\.50 this month · 2 green · 0 red/);
  const z = screen.getByRole("gridcell", { name: /^20 November 2026: \+₹1,234\.50, 2 trades$/ });
  expect(z.className).toMatch(/is-gain/);
  fireEvent.click(z);
  const panel = screen.getByRole("dialog");
  expect(within(panel).getByText("From Zerodha · read-only")).toBeTruthy();
  expect(panel.textContent).toMatch(/INFY.*Long.*10 @ 1,500\.00 → 1,510\.00/);
  expect(panel.textContent).toMatch(/These figures come from Zerodha's own record and cannot be changed here/);
  expect(within(panel).queryByRole("button", { name: /Correct this day|Enter this day/ })).toBeNull();
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  // the next month and back
  fireEvent.click(screen.getByRole("button", { name: "The month after" }));
  expect(screen.getByRole("heading", { name: "December 2026" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "The month before" }));
  expect(screen.getByRole("heading", { name: "November 2026" })).toBeTruthy();
});

test("a day entered by hand can be corrected or removed; an empty past day can be entered; nothing for Zerodha's days", async () => {
  const changed = jest.fn();
  mockAsk.mockResolvedValue(true); // the confirmation dialog says yes (mocks are reset between tests)
  render(<MonthCalendar calendar={calendar} trips={trips} manual={manual} toDay="2026-11-30" onChanged={changed} />);
  fireEvent.click(screen.getByRole("gridcell", { name: /^18 November 2026: \+₹2,440\.00, entered by hand$/ }));
  let panel = screen.getByRole("dialog");
  expect(panel.textContent).toMatch(/Entered by hand/);
  expect(panel.textContent).toMatch(/“another broker”/);
  fireEvent.click(within(panel).getByRole("button", { name: "Correct this day" }));
  const gross = within(panel).getByLabelText(/Realised P&L/);
  expect(gross.value).toBe("2500");
  fireEvent.change(gross, { target: { value: "2600" } });
  expect(panel.textContent).toMatch(/Charges ₹60\.00 · Net \+₹2,540\.00/);
  api.mockResolvedValueOnce({ day: {} });
  fireEvent.click(within(panel).getByRole("button", { name: "Save the correction" }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/api/admin/trading/journal/manual/2026-11-18", expect.objectContaining({ method: "PUT", body: expect.objectContaining({ gross: 2600, brokerage: 40, stt: 20, trades: 3, note: "another broker" }) })));
  expect(changed).toHaveBeenCalled();
  expect(mockSnack).toHaveBeenCalledWith("The day is corrected.", { tone: "ok" });
  // remove
  api.mockResolvedValueOnce({ removed: true });
  fireEvent.click(await within(screen.getByRole("dialog")).findByRole("button", { name: "Remove" }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/api/admin/trading/journal/manual/2026-11-18", { method: "DELETE" }));
  // an empty past day
  fireEvent.click(screen.getByRole("gridcell", { name: /^10 November 2026: no trades$/ }));
  panel = screen.getByRole("dialog");
  expect(panel.textContent).toMatch(/No Zerodha trades on this day/);
  fireEvent.click(within(panel).getByRole("button", { name: "Enter this day by hand" }));
  expect(within(panel).getByRole("button", { name: "Add this day" })).toBeTruthy();
});
