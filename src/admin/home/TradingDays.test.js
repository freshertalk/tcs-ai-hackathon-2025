import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import TradingDays, { countDays, holidayMap, levelOf, monthStart, monthsOf } from "./TradingDays";

const mockCalls = [];
let mockAnswer = null;
jest.mock("../api", () => ({
  api: (url) => {
    mockCalls.push(url);
    return mockAnswer instanceof Error ? Promise.reject(mockAnswer) : Promise.resolve(mockAnswer);
  },
}));

// made-up days, not anyone's account
const day = (date, net, extra = {}) => ({ date, net, gross: net + 20, charges: 20, trades: 2, wins: net > 0 ? 2 : 0, trips: [], ...extra });
const ANSWER = { today: "2026-11-27", fromDay: "2025-12-01", toDay: "2026-11-27", days: [day("2026-11-02", 1500), day("2026-11-03", -800), day("2026-11-05", 300), day("2026-10-14", -50)], manual: [] };
const settle = async () => {
  for (let i = 0; i < 3; i += 1) await act(async () => Promise.resolve());
};

beforeEach(() => {
  mockCalls.length = 0;
  mockAnswer = ANSWER;
  window.localStorage.clear();
});

test("the arithmetic: months back, NSE sessions without weekends and holidays, green and red days", () => {
  expect([monthStart("2026-11-27", 0), monthStart("2026-11-27", 2), monthStart("2026-01-15", 1)]).toEqual(["2026-11-01", "2026-09-01", "2025-12-01"]);
  const hol = holidayMap("2026-11-01", "2026-11-30");
  expect(hol.has("2026-11-24")).toBe(true); // a weekday holiday in the built-in table
  const c = countDays({ fromDay: "2026-11-01", toDay: "2026-11-27", days: ANSWER.days, holidays: hol });
  expect([c.traded, c.green, c.red, c.net]).toEqual([3, 2, 1, 1000]);
  expect(c.sessions).toBe(20 - hol.size); // 20 weekdays from 1 to 27 Nov 2026, less the holidays on weekdays
  expect([c.best.date, c.worst.date]).toEqual(["2026-11-02", "2026-11-03"]);
  expect([levelOf(1500, [1500, -800, 300]), levelOf(300, [1500, -800, 300]), levelOf(0, [1]), levelOf(5, [])]).toEqual([4, 1, 0, 0]);
  const [nov] = monthsOf("2026-11-27", 1);
  expect(nov.label).toBe("November 2026");
  expect(nov.cells.filter(Boolean)).toHaveLength(30);
  expect(nov.cells[0]).toBe("2026-11-01"); // 1 Nov 2026 is a Sunday: no blank before it
});

test("shows the counts and a numbered grid; hovering a date shows that day's profit or loss", async () => {
  const { container } = render(
    <div className="adm">
      <TradingDays />
    </div>
  );
  await settle();
  expect(mockCalls[0]).toBe(`/api/admin/trading/journal/days?from=${monthStart(new Date(Date.now() + 19800000).toISOString().slice(0, 10), 11)}`);
  expect(screen.getByText("Days you traded").nextSibling.textContent).toBe("4"); // the default: 3 months (Sep to Nov)
  expect(screen.getByText("Profit days").nextSibling.textContent).toBe("2");
  expect(screen.getByText("Loss days").nextSibling.textContent).toBe("2");
  expect(screen.getAllByRole("group").map((g) => g.getAttribute("aria-label")).slice(1)).toEqual(["November 2026", "October 2026", "September 2026"]);
  const win = screen.getByRole("button", { name: /^\w+,? 2 Nov,? 2026: net \+₹1,500\.00/ });
  expect(win.textContent).toBe("2");
  expect(win.className).toMatch(/is-up l4/);
  expect(screen.getByRole("button", { name: /^\w+,? 3 Nov,? 2026: net −₹800\.00/ }).className).toMatch(/is-down/);
  fireEvent.mouseEnter(win);
  const tip = screen.getByRole("tooltip");
  expect(tip.textContent).toMatch(/Net P&L \+₹1,500\.00/);
  expect(tip.textContent).toMatch(/charges ₹20\.00/);
  expect(tip.textContent).toMatch(/2 trades · 2 won/);
  fireEvent.mouseEnter(screen.getByRole("button", { name: /^\w+,? 1 Nov,? 2026:/ }));
  expect(screen.getByRole("tooltip").textContent).toMatch(/Weekend · market closed/);
  fireEvent.mouseEnter(screen.getByRole("button", { name: /^\w+,? 24 Nov,? 2026:/ }));
  expect(screen.getByRole("tooltip").textContent).toMatch(/NSE holiday/);
  // another range: counted again, and remembered
  fireEvent.click(screen.getByRole("button", { name: "This month" }));
  expect(screen.getByText("Days you traded").nextSibling.textContent).toBe("3");
  fireEvent.click(screen.getByRole("button", { name: "12 months" }));
  expect(screen.getByText("Days you traded").nextSibling.textContent).toBe("4");
  expect(window.localStorage.getItem("vpt.home.days")).toBe("12");
  expect(container.querySelectorAll(".td__month")).toHaveLength(12);
});

test("a failed read says so", async () => {
  mockAnswer = new Error("Zerodha did not answer");
  render(<TradingDays />);
  await settle();
  expect(screen.getByText(/Your trading days could not be read: Zerodha did not answer/)).toBeTruthy();
});
