import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { PnlBySymbol, PnlSummary, consoleView, kite, openPart, unrealisedOf } from "./PnlReport";

// made-up figures (nobody's account); the HINDCOPPER row is the one in the owner's screenshot of Zerodha's report
const s = { gross: 4240.35, charges: 1310.42, net: 2929.93, open: 0, trades: 1 };
const rows = [
  { key: "HINDCOPPER", qty: 5634, buyAvg: 427.59, buyValue: 2409016.5, sellAvg: 428.34, sellValue: 2413256.85, gross: 4240.35 },
  { key: "ICICIBANK", qty: 400, buyAvg: 1640.2, buyValue: 656080, sellAvg: 1633.1, sellValue: 653240, gross: -2840 },
];

test("Zerodha's short figures: 4.24k, 1.31k, 1.25L, 2.1Cr, with a sign on a profit or loss", () => {
  expect([kite(4240.35, { signed: true }), kite(1310.42), kite(0), kite(-2840, { signed: true }), kite(125000), kite(21000000), kite(950.5), kite(null)]).toEqual(["+4.24k", "1.31k", "0", "−2.84k", "1.25L", "2.1Cr", "950.5", "—"]);
});

test("the five figures of Zerodha's P&L report, in its words; what the API cannot give is said, not shown as 0", () => {
  const { container } = render(<PnlSummary s={s} unrealised={{ total: 0, why: "nothing in this period is open" }} />);
  const figs = [...container.querySelectorAll(".zp-fig")].map((f) => [f.querySelector("dt").textContent, f.querySelector("dd").textContent]);
  expect(figs).toEqual([
    ["Realised P&L", "+4.24k"],
    ["Charges & taxes", "1.31k"],
    ["Other credits & debits", "—"],
    ["Net realised P&L", "+2.93k"],
    ["Unrealised P&L", "0"],
  ]);
  expect(container.querySelectorAll(".zp-fig dd")[0].className).toBe("is-up");
  expect(container.querySelector(".zp-fig:nth-child(3)").getAttribute("data-tip")).toMatch(/Zerodha's API does not give them/);
  // the net comes after a rule, as in Zerodha's report
  expect(container.querySelector(".zp-sum__rule")).toBeTruthy();
});

test("the unrealised P&L: the live book's open positions when the period reaches today; 0 when nothing is open; unknown otherwise", () => {
  const book = { available: true, live: true, streaming: true, unrealised: 812.5, positions: [{ symbol: "SBIN", quantity: 100, unrealised: 812.5 }, { symbol: "TCS", quantity: 0, unrealised: 0 }] };
  const today = "2026-11-21";
  const live = unrealisedOf({ s, period: { toDay: today }, book, today });
  expect([live.total, live.bySymbol.get("SBIN"), live.bySymbol.has("TCS"), live.why]).toEqual([812.5, 812.5, false, "open positions, live with every price"]);
  expect(unrealisedOf({ s, period: { toDay: "2026-10-31" }, book, today }).total).toBe(0);
  const past = unrealisedOf({ s: { ...s, open: 2 }, period: { toDay: "2026-10-31" }, book, today });
  expect([past.total, past.why]).toEqual([null, "2 positions are still open; they are valued live on the Positions page"]);
  expect(unrealisedOf({ s: { ...s, open: 1 }, period: { toDay: today }, book: null, today }).why).toBe("1 position is still open; connect Zerodha to value them");
});

test("per symbol, Zerodha's columns: Qty., Buy avg., Buy value, Sell avg., Sell value, Realised P&L with its %, Unrealised P&L", () => {
  const onCsv = jest.fn();
  const { container } = render(<PnlBySymbol rows={rows} unrealised={{ total: 120, bySymbol: new Map([["SBIN", 120]]) }} onCsv={onCsv} updated="2026-11-20" />);
  expect([...container.querySelectorAll(".zp-table thead th")].map((th) => th.textContent.replace(/[˄˅]/g, "").trim())).toEqual(["Symbol", "Qty.", "Buy avg.", "Buy value", "Sell avg.", "Sell value", "Realised P&L", "Unrealised P&L"]);
  expect(screen.getByText(/Showing 3 symbols · Last updated: 2026-11-20/)).toBeTruthy();
  const body = () => [...container.querySelectorAll(".zp-table tbody tr")].map((tr) => tr.textContent);
  // A to Z by symbol, as Zerodha lists them; a stock held open with nothing closed still has its row
  expect(body()).toEqual([
    "HINDCOPPER5634427.5924,09,016.50428.3424,13,256.85+4,240.35 +0.18%–",
    "ICICIBANK4001,640.206,56,080.001,633.106,53,240.00−2,840.00 −0.43%–",
    "SBIN——————+120.00",
  ]);
  // any column sorts, either way
  fireEvent.click(within(container.querySelector(".zp-table thead")).getByRole("button", { name: /Realised P&L/ }));
  expect(body()[0]).toMatch(/^HINDCOPPER/);
  fireEvent.click(within(container.querySelector(".zp-table thead")).getByRole("button", { name: /Realised P&L/ }));
  expect(body()[0]).toMatch(/^ICICIBANK/);
  // search and download, as in Zerodha's report
  fireEvent.change(screen.getByPlaceholderText("Search"), { target: { value: "hind" } });
  expect(body().length).toBe(1);
  fireEvent.click(screen.getByText("Download"));
  expect(onCsv).toHaveBeenCalledTimes(1);
  expect(onCsv.mock.calls[0][0].map((r) => r.key)).toEqual(["HINDCOPPER"]);
});

test("a position squared off today is not unrealised: Kite's 'unrealised' field carries its booked P&L, Console shows 0", () => {
  // what Kite sends for an intraday position closed today, and the book total built from Kite's own fields
  const book = { available: true, live: true, streaming: true, unrealised: 1627.85, positions: [{ symbol: "HINDCOPPER", quantity: 0, average: 0, last: 428.6, unrealised: 1627.85, pnl: 1627.85 }] };
  const today = "2026-11-23";
  const u = unrealisedOf({ s, period: { toDay: today }, book, today });
  expect([u.total, u.bySymbol.size]).toEqual([0, 0]);
  expect(u.why).toMatch(/nothing is open just now/);
  // an open position partly booked: only what is still held, at (price − average)
  expect(openPart({ quantity: 50, average: 990, last: 1000, unrealised: 900 })).toBe(500);
  expect(openPart({ quantity: -20, average: 1300, last: 1290 })).toBe(200);
  expect(openPart({ quantity: 10, unrealisedOpen: 77.5, unrealised: 999 })).toBe(77.5);
  expect(openPart({ quantity: 0, unrealised: 50 })).toBeNull();
});

test("as Zerodha Console shows it: today's trades reach Console after its overnight update, so the page can show the period without them", () => {
  const today = "2026-11-23";
  // the owner's case, in made-up round figures: the period has today's +1,627.85 in it; Console does not yet
  const sp = { gross: 5868.2, charges: 1535.65, net: 4332.55, trades: 11, open: 0, calendar: [{ key: "2026-11-12", trades: 3, gross: 8105.5, charges: 137.5, net: 7968 }, { key: today, trades: 2, gross: 1627.85, charges: 225.9, net: 1401.95 }] };
  const cv = consoleView(sp, { toDay: today }, today);
  expect(cv).toEqual({ today: { trades: 2, gross: 1627.85, charges: 225.9, net: 1401.95 }, console: { trades: 9, gross: 4240.35, charges: 1309.75, net: 2930.6 } });
  expect(consoleView(sp, { toDay: "2026-11-20" }, today)).toBeNull(); // the period does not reach today
  expect(consoleView({ ...sp, calendar: [] }, { toDay: today }, today)).toBeNull(); // no trades today: nothing to explain
});

test("the summary says how it differs from Console and can show Console's figures", () => {
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const sp = { gross: 5868.2, charges: 1535.65, net: 4332.55, trades: 11, open: 0, calendar: [{ key: today, trades: 2, gross: 1627.85, charges: 225.9, net: 1401.95 }] };
  const { container } = render(<PnlSummary s={sp} unrealised={{ total: 0, why: "nothing is open" }} period={{ toDay: today }} />);
  const fig = () => [...container.querySelectorAll(".zp-fig dd")].map((d) => d.textContent);
  expect(fig().slice(0, 4)).toEqual(["+5.87k", "1.54k", "—", "+4.33k"]);
  expect(container.querySelector(".zp-recon__text").textContent).toMatch(/Includes today’s 2 trades: realised \+1,627\.85, charges ₹225\.90\. Zerodha Console adds a day’s trades after its overnight update, so until then it shows realised \+4,240\.35 · charges ₹1,309\.75 · net \+2,930\.60/);
  fireEvent.click(screen.getByRole("button", { name: "As in Console" }));
  expect(fig().slice(0, 4)).toEqual(["+4.24k", "1.31k", "—", "+2.93k"]);
  expect(screen.getByRole("button", { name: "As in Console" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Including today" }));
  expect(fig()[0]).toBe("+5.87k");
});

test("other credits & debits are part of the net, as in Console: −354 + 1,200.50 moves 2.93k to 3.78k; none recorded stays “—”", () => {
  const other = { count: 2, total: 846.5, credits: 1200.5, debits: -354 };
  const { container } = render(<PnlSummary s={s} unrealised={{ total: 0, why: "" }} other={other} />);
  const figs = Object.fromEntries([...container.querySelectorAll(".zp-fig")].map((f) => [f.querySelector("dt").textContent, f.querySelector("dd").textContent]));
  expect([figs["Other credits & debits"], figs["Net realised P&L"], figs["Realised P&L"]]).toEqual(["+846.5", "+3.78k", "+4.24k"]);
  expect(container.querySelector(".zp-fig:nth-child(5)").getAttribute("data-tip")).toMatch(/Other credits & debits: ₹3,776\.43/);
  const none = render(<PnlSummary s={s} unrealised={{ total: 0, why: "" }} other={{ count: 0, total: 0 }} />);
  expect(none.container.querySelectorAll(".zp-fig dd")[2].textContent).toBe("—");
  expect(none.container.querySelectorAll(".zp-fig dd")[3].textContent).toBe("+2.93k");
});
