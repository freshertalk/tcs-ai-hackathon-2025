import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { PnlBySymbol, PnlSummary, kite, unrealisedOf } from "./PnlReport";

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
