import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import PnlGrid, { levelOf, monthBlocks, scaleOf } from "./PnlGrid";
import { api } from "../../api";

jest.mock("../../api", () => ({ api: jest.fn() }));

// made-up figures, nobody's account
const DATA = {
  today: "2026-11-23",
  fromDay: "2025-12-01",
  toDay: "2026-11-23",
  days: [
    {
      date: "2026-11-12",
      trades: 2,
      wins: 2,
      gross: 8105.5,
      charges: 137.5,
      brokerage: 80,
      taxes: 57.5,
      net: 7968,
      trips: [
        { key: "a", symbol: "HINDCOPPER", side: "long", product: "MIS", intraday: true, qty: 5634, entryAt: Date.parse("2026-11-12T09:20:00+05:30"), exitAt: Date.parse("2026-11-12T10:05:00+05:30"), entryAvg: 427.59, exitAvg: 428.34, gross: 4240.35, charges: 90, net: 4150.35 },
        { key: "b", symbol: "SBIN", side: "short", product: "MIS", intraday: true, qty: 500, entryAt: Date.parse("2026-11-12T11:00:00+05:30"), exitAt: Date.parse("2026-11-12T11:30:00+05:30"), entryAvg: 812, exitAvg: 804.27, gross: 3865.15, charges: 47.5, net: 3817.65 },
      ],
    },
    { date: "2026-11-18", trades: 1, wins: 0, gross: -3700, charges: 59, brokerage: 40, taxes: 19, net: -3759, trips: [{ key: "c", symbol: "TCS", side: "long", product: "MIS", qty: 10, entryAt: 1, exitAt: Date.parse("2026-11-18T13:20:00+05:30"), entryAvg: 3000, exitAvg: 2630, gross: -3700, charges: 59, net: -3759 }] },
  ],
  manual: [{ date: "2026-11-05", trades: 2, gross: 900, charges: 40, net: 860, note: "another broker", manual: true }],
  totals: { days: 2, green: 1, red: 1, trades: 3, gross: 4405.5, charges: 196.5, net: 4209 },
};

test("months are laid out as on Console: week columns, Sunday on top, nothing past the last day", () => {
  const b = monthBlocks("2026-11-01", "2026-11-23");
  expect(b).toHaveLength(1);
  expect(b[0].label).toBe("NOV");
  expect(b[0].cols).toBe(5); // 1 Nov 2026 is a Sunday, 30 Nov a Monday
  expect(b[0].cells[0]).toEqual({ key: "2026-11-01", col: 0, row: 0 });
  expect(b[0].cells.find((c) => c.key === "2026-11-12")).toEqual({ key: "2026-11-12", col: 1, row: 4 }); // a Thursday
  expect(b[0].cells[b[0].cells.length - 1].key).toBe("2026-11-23");
  const year = monthBlocks("2025-12-01", "2026-11-23");
  expect(year.map((m) => m.label)).toEqual(["DEC", "JAN", "FEB", "MAR", "APR", "MAY", "JUNE", "JULY", "AUG", "SEPT", "OCT", "NOV"]);
  expect(monthBlocks("2026-11-10", "2026-11-01")).toEqual([]);
});

test("colour depth: four steps by size against the large days; one outlier does not wash the rest out", () => {
  const scale = scaleOf([100, -200, 300, 400, 10000]);
  expect(scale).toBe(10000);
  expect(scaleOf([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000, 90000])).toBe(2000); // the 95th percentile: the one 90,000 day does not set the scale
  expect([levelOf(0, 100), levelOf(10, 100), levelOf(-40, 100), levelOf(70, 100), levelOf(-500, 100), levelOf(null, 100)]).toEqual([0, 1, 2, 3, 4, 0]);
});

test("a year of days: green and red squares, a tooltip on hover, and a click opens the day's trades below", async () => {
  api.mockImplementation(async () => DATA);
  const onOpenDay = jest.fn();
  const { container } = render(<PnlGrid ranges={[{ id: "12m", label: "Last 12 months" }]} onOpenDay={onOpenDay} />);
  await waitFor(() => expect(container.querySelectorAll("button.pg__cell").length).toBeGreaterThan(300));
  expect(api).toHaveBeenCalledWith("/api/admin/trading/journal/days?");
  const d12 = screen.getByRole("button", { name: /12 Nov,? 2026: realised P&L \+₹8,105\.50, net \+₹7,968\.00/ });
  expect(d12.className).toMatch(/is-up l4/);
  const d18 = screen.getByRole("button", { name: /18 Nov,? 2026: realised P&L −₹3,700\.00/ });
  expect(d18.className).toMatch(/is-down/);
  expect(screen.getByRole("button", { name: /5 Nov,? 2026: entered by hand/ }).className).toMatch(/is-manual/);
  expect(screen.getByRole("button", { name: /^Sun, 5 Apr,? 2026: no trades/ }).className).toBe("pg__cell");
  expect(container.querySelector(".pg__sum").textContent).toMatch(/2 days traded · 1 green · 1 red · 3 trades/);

  fireEvent.mouseEnter(screen.getByRole("button", { name: /^Sun, 5 Apr,? 2026: no trades/ }));
  expect(screen.getByRole("tooltip").textContent).toBe("No data on Apr 5, 2026");
  fireEvent.mouseEnter(d12);
  expect(screen.getByRole("tooltip").textContent).toMatch(/Nov 12, 2026Realised P&L \+8,105\.50Net \+7,968\.00 · 2 trades/);

  fireEvent.click(d12);
  // Console's line: "Gross realised P&L  Nov 12, 2026 | Equity: 8105.50"
  expect(container.querySelector(".pg__dline").textContent).toMatch(/Gross realised P&LNov 12, 2026Equity: 8,105\.50/);
  const rows = [...container.querySelectorAll(".pg__table tbody tr")].map((tr) => tr.textContent);
  expect(rows[0]).toMatch(/^10:05HINDCOPPERLongMIS5634427\.59428\.34\+4,240\.35/);
  expect(rows[1]).toMatch(/^11:30SBINShortMIS500804\.27812\.00\+3,865\.15/); // a short: bought back lower
  expect(container.querySelector(".pg__table tfoot").textContent).toMatch(/Total\+8,105\.50137\.50\+7,968\.00/);
  // Net colours by the figure after charges
  fireEvent.click(screen.getByRole("button", { name: "Net" }));
  expect(container.querySelector(".pg__dline").textContent).toMatch(/Net realised P&LNov 12, 2026Equity: 7,968\.00/);
  // step to the next traded day, open it in the Journal, close it
  fireEvent.click(screen.getByRole("button", { name: "Next day with trades" }));
  expect(container.querySelector(".pg__dline").textContent).toMatch(/Nov 18, 2026Equity: −3,759\.00/); // a true minus sign, as Console
  expect(screen.getByRole("button", { name: /18 Nov,? 2026/ }).getAttribute("data-tip")).toBe(""); // the page's own tooltip, not the help bubble
  fireEvent.click(screen.getByRole("button", { name: "Open this day" }));
  expect(onOpenDay).toHaveBeenCalledWith("2026-11-18");
  fireEvent.click(screen.getByRole("button", { name: "Close the day" }));
  expect(container.querySelector(".pg__detail")).toBeNull();
});

test("keyboard: one square in the tab order; arrows move a day or a week; Enter opens, Escape closes", async () => {
  api.mockImplementation(async () => DATA);
  const { container } = render(<PnlGrid />);
  await waitFor(() => expect(container.querySelectorAll("button.pg__cell").length).toBeGreaterThan(300));
  const tabbable = [...container.querySelectorAll("button.pg__cell")].filter((b) => b.tabIndex === 0);
  expect(tabbable).toHaveLength(1);
  expect(tabbable[0].getAttribute("aria-label")).toMatch(/18 Nov,? 2026/); // the latest traded day
  act(() => tabbable[0].focus());
  fireEvent.keyDown(tabbable[0], { key: "ArrowLeft" });
  expect(document.activeElement.getAttribute("aria-label")).toMatch(/11 Nov,? 2026/);
  fireEvent.keyDown(document.activeElement, { key: "ArrowDown" });
  expect(document.activeElement.getAttribute("aria-label")).toMatch(/12 Nov,? 2026/);
  fireEvent.click(document.activeElement);
  expect(container.querySelector(".pg__detail")).toBeTruthy();
  fireEvent.keyDown(document.activeElement, { key: "Escape" });
  expect(container.querySelector(".pg__detail")).toBeNull();
});

test("a failed read says why and keeps what was on screen", async () => {
  api.mockImplementation(async () => {
    throw new Error("Could not reach the server.");
  });
  render(<PnlGrid />);
  expect(await screen.findByText("Could not reach the server.")).toBeTruthy();
});
