import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import FirstSight from "./FirstSight";
import { accountNumbers, indexCells, placeInRange, sortRows, volumeWords, watchRows, watchSummary } from "./homeData";
import { MONEY_ZONES, markAmounts } from "../privacy";

const mockCalls = [];
let mockAnswers = {};
jest.mock("../api", () => ({
  api: (url, options) => {
    mockCalls.push([url, options]);
    const key = Object.keys(mockAnswers).find((k) => url === k || url.startsWith(`${k}?`));
    return key ? Promise.resolve(mockAnswers[key]) : Promise.resolve({});
  },
}));

// made-up figures: not the market's
const quote = (last, prevClose, extra = {}) => ({ last, prevClose, change: last - prevClose, changePct: ((last - prevClose) / prevClose) * 100, open: prevClose + 1, high: last + 5, low: prevClose - 5, volume: 3461000, avgPrice: prevClose + 2, buyQty: 600, sellQty: 400, ...extra });
const QUOTES = { at: "2026-03-10T05:00:00.000Z", quotes: { ALPHA: quote(110, 100), BETA: quote(95, 100), "NIFTY 50": quote(25100, 25000), "NIFTY BANK": quote(55000, 55500), "INDIA VIX": quote(13, 12.5) } };
const SCAN = { rows: [{ symbol: "ALPHA", rsi14: 74.2, label: "Strongly bullish", enoughData: true, fromHighPct: -2.5, last: 100, changePct: 1, asOf: "2026-03-09" }, { symbol: "BETA", rsi14: 41, label: "Neutral", enoughData: true, fromHighPct: -20, last: 100, changePct: -1, asOf: "2026-03-09" }, { symbol: "GAMMA", rsi14: 55, label: "Bearish", enoughData: true, fromHighPct: -9, last: 321.5, changePct: 0.4, asOf: "2026-03-09" }] };
const EDGE = { rows: [{ symbol: "ALPHA", available: true, atr: 3.2, best: { kind: "swing", side: "long", grade: "A", winPct: 71.4, n: 50 } }, { symbol: "BETA", available: true, atr: 2, best: { kind: "day", side: "short", grade: "C", winPct: 51, n: 50 } }] };
const SETUP = {
  lean: { label: "Leaning up", score: 31, agreement: 0.72, readings: 6, of: 6 },
  nifty: { available: true, spot: 25100, side: "above", pivot: 25050, s1: 24950, s2: 24850, r1: 25180, r2: 25290 },
  pcr: { nifty: 1.14, bank: 0.86 },
  maxPain: { nifty: 25000, bank: 55500 },
  flows: { date: "09-Mar-2026", fii: { net: -1843.6 }, dii: { net: 2210.4 } },
  ban: { symbols: ["BETA"] },
  delivery: [{ symbol: "ALPHA", delivPct: 68, vsAvg: 1.6 }],
};
const pos = (symbol, quantity, average, last, extra = {}) => ({ exchange: "NSE", symbol, product: "MIS", quantity, average, last, close: 100, multiplier: 1, buyValue: quantity > 0 ? quantity * average : 0, sellValue: quantity < 0 ? -quantity * average : 0, pnl: quantity * (last - average), ...extra });
const SUMMARY = {
  at: "2026-03-10T05:00:00.000Z",
  errors: {},
  funds: { equity: { net: 61240.5, available: { opening: 100000 }, used: { debits: 38759.5 } } },
  positions: { net: [pos("ALPHA", 40, 105, 108), pos("BETA", -30, 97, 96)] },
  holdings: [{ exchange: "NSE", symbol: "DELTA", quantity: 10, t1: 0, average: 200, last: 220, close: 215, pnl: 200 }],
  orders: [{ id: "1", status: "TRIGGER PENDING", symbol: "ALPHA", exchange: "NSE", product: "MIS", side: "SELL", type: "SL-M", trigger: 104.5, quantity: 40, filled: 0 }],
  trades: [],
  status: { enabled: false, user: "Sample User" },
  squareOff: { ALPHA: { clock: "3:12 PM", min: 912 }, BETA: { clock: "3:12 PM", min: 912 } },
};
const ANSWERS = {
  "/api/admin/market/status": { mode: "kite", marketHours: false, watchlist: ["ALPHA", "BETA", "GAMMA"] },
  "/api/admin/market/quotes": QUOTES,
  "/api/admin/market/context": { session: { open: false }, tide: { score: 11, label: "Slack", summary: "A made-up tide." }, vix: { level: "normal" } },
  "/api/admin/market/alerts": { alerts: [] },
  "/api/admin/market/scan": SCAN,
  "/api/admin/market/edge": EDGE,
  "/api/admin/market/setup": SETUP,
  "/api/admin/market/expiries": { exchanges: [{ id: "NSE", main: "NIFTY 50", next: { date: "2026-03-17", daysLeft: 7, kind: "weekly" } }] },
  "/api/admin/trading/status": { connected: true, enabled: false },
  "/api/admin/trading/summary": SUMMARY,
};
const settle = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => Promise.resolve());
};
const ALL = { status: true, market: true, account: true, watchlist: true };
const draw = (props) =>
  render(
    <div className="adm">
      <div className="hm">
        <FirstSight own show={ALL} {...props} />
      </div>
    </div>
  );

beforeEach(() => {
  mockCalls.length = 0;
  mockAnswers = { ...ANSWERS };
});

describe("the arithmetic", () => {
  test("a watchlist row joins the live price, the daily reading, the odds and the morning's flags; without a live price it says the daily close", () => {
    const rows = watchRows({ quotes: QUOTES, scan: SCAN, edge: EDGE, setup: SETUP, symbols: ["ALPHA", "BETA", "GAMMA"] });
    expect(rows.map((r) => r.symbol)).toEqual(["ALPHA", "BETA", "GAMMA"]);
    const [a, b, g] = rows;
    expect([a.last, a.rsi, a.reading, a.volume]).toEqual([110, 74.2, "Strongly bullish", 3461000]);
    expect(a.vsVwap).toBeCloseTo(((110 - 102) / 102) * 100);
    expect(a.bidShare).toBe(60);
    expect(a.odds).toMatchObject({ grade: "A", proven: true, text: "Swing long" });
    expect(b.odds).toMatchObject({ grade: "C", proven: false, text: "Day short" });
    expect([a.delivery.delivPct, a.banned, b.banned]).toEqual([68, false, true]);
    expect([g.live, g.last, g.changePct, g.vsVwap, g.place, g.odds]).toEqual([false, 321.5, 0.4, null, null, null]);
    const s = watchSummary(rows);
    expect([s.count, s.up, s.down, s.proven, s.best.symbol, s.worst.symbol]).toEqual([3, 2, 1, 1, "ALPHA", "BETA"]);
  });

  test("sorting leaves a stock without the figure at the bottom both ways; small helpers", () => {
    const rows = [{ symbol: "A", rsi: 40 }, { symbol: "B", rsi: null }, { symbol: "C", rsi: 70 }];
    expect(sortRows(rows, { by: "rsi", way: "desc" }).map((r) => r.symbol)).toEqual(["C", "A", "B"]);
    expect(sortRows(rows, { by: "rsi", way: "asc" }).map((r) => r.symbol)).toEqual(["A", "C", "B"]);
    expect(sortRows(rows, null)).toBe(rows);
    expect([volumeWords(3461000), volumeWords(12000000), volumeWords(950), volumeWords(null)]).toEqual(["34.61 L", "1.20 Cr", "950", "—"]);
    expect([placeInRange(110, 100, 120), placeInRange(100, 100, 100), placeInRange(null, 1, 2)]).toEqual([50, 50, null]);
    expect(indexCells({ quotes: {} }).every((c) => c.last === null)).toBe(true);
  });

  test("the account: positions valued at the live price, what protects each, and what needs a look", () => {
    const a = accountNumbers(SUMMARY, QUOTES, Date.parse("2026-03-10T09:20:00.000Z")); // 2:50 PM IST
    expect(a.open.map((p) => [p.symbol, p.last, p.cover])).toEqual([
      ["ALPHA", 110, "covered"],
      ["BETA", 95, "none"],
    ]);
    expect(a.numbers.total).toBe(40 * (110 - 105) + -30 * (95 - 97));
    expect(a.equity).toMatchObject({ available: 61240.5, used: 38759.5, opening: 100000 });
    expect(a.holdings.holdPnl).toBe(200);
    const said = a.attention.map((x) => x.text).join(" | ");
    expect(said).toMatch(/No stop-loss order in today’s order book for BETA/);
    expect(said).toMatch(/ALPHA \(MIS\) is squared off by Zerodha at 3:12 PM, in 22 min/);
    expect(accountNumbers(undefined, QUOTES, 0)).toBeNull();
  });
});

describe("the first screen", () => {
  test("shows the indices, the account, what to know before a trade, positions and an analysis row for every watchlist stock — by reading only", async () => {
    draw();
    await settle();
    const idx = screen.getByRole("region", { name: "Market now" });
    expect(idx.textContent).toMatch(/NIFTY 50.*25,100\.00.*BANK NIFTY.*55,000\.00.*INDIA VIX.*13\.00/);
    expect(idx.textContent).toMatch(/Market closed: last prices from Zerodha/);
    const acct = screen.getByRole("region", { name: "Your account" });
    expect(acct.textContent).toMatch(/Trading OFF/);
    expect(acct.textContent).toMatch(/Margin available₹61,240\.50/);
    expect(acct.textContent).toMatch(/No stop-loss order in today’s order book for BETA/);
    const read = screen.getByRole("region", { name: "Before you trade" });
    expect(read.textContent).toMatch(/Leaning up.*score \+31 · 72% agree · 6 of 6 readings/);
    expect(read.textContent).toMatch(/Pivot25,050\.00/);
    expect(read.textContent).toMatch(/−₹1,844 cr/);
    expect(read.textContent).toMatch(/Tue, 17 Mar · in 7 days/);
    const positions = screen.getByRole("region", { name: "Open positions (2)" });
    expect(within(positions).getByText("No stop order")).toBeTruthy();
    expect(within(positions).getByRole("link", { name: "ALPHA" }).getAttribute("href")).toBe("/me/stock-report?s=ALPHA");
    const watch = screen.getByRole("region", { name: "Watchlist analysis" });
    expect(watch.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(watch.textContent).toMatch(/High delivery/);
    expect(watch.textContent).toMatch(/F&O ban/);
    expect(watch.textContent).toMatch(/321\.50.*daily close/);
    // nothing but reads: no request carried a method or a body, and no AI route was asked
    expect(mockCalls.every(([, o]) => !o)).toBe(true);
    expect(mockCalls.some(([u]) => u.includes("/ai"))).toBe(false);
  });

  test("the watchlist narrows with the chips and sorts by a heading or the list", async () => {
    draw();
    await settle();
    const watch = screen.getByRole("region", { name: "Watchlist analysis" });
    const names = () => [...watch.querySelectorAll("tbody th a")].map((a) => a.textContent);
    fireEvent.click(within(watch).getByRole("button", { name: /^Losers/ }));
    expect(names()).toEqual(["BETA"]);
    fireEvent.click(within(watch).getByRole("button", { name: /^All/ }));
    fireEvent.click(within(watch).getByRole("button", { name: "RSI (daily)" }));
    expect(names()).toEqual(["ALPHA", "GAMMA", "BETA"]);
    fireEvent.click(within(watch).getByRole("button", { name: /^RSI \(daily\)/ }));
    expect(names()).toEqual(["BETA", "GAMMA", "ALPHA"]);
    fireEvent.change(within(watch).getByRole("combobox"), { target: { value: "change:asc" } });
    expect(names()).toEqual(["BETA", "GAMMA", "ALPHA"]);
    fireEvent.change(within(watch).getByRole("combobox"), { target: { value: "" } });
    expect(names()).toEqual(["ALPHA", "BETA", "GAMMA"]);
  });

  test("Hide amounts stars your own money and leaves the market's prices readable", async () => {
    draw();
    await settle();
    expect(MONEY_ZONES).toContain(".fs-acct");
    expect(MONEY_ZONES).toContain(".fs-pos");
    markAmounts(document.querySelector(".adm"));
    const marked = (el) => Boolean(el.closest("[data-pv]"));
    expect(marked(screen.getByText("₹61,240.50"))).toBe(true);
    const row = document.querySelector(".fs-table--pos tbody tr");
    const cell = (label) => row.querySelector(`[data-label="${label}"]`);
    expect(cell("P&L").hasAttribute("data-pv")).toBe(true);
    expect(cell("P&L").querySelector("[data-pv]")).toBeNull(); // starred once, not twice
    for (const label of ["LTP", "Stop order"]) expect(cell(label).hasAttribute("data-pv")).toBe(false);
    expect(document.querySelector(".fs-watch [data-pv]")).toBeNull();
    expect(document.querySelector(".fs-idx [data-pv]")).toBeNull();
    expect(document.querySelector(".fs-read [data-pv]")).toBeNull();
  });

  test("with Zerodha not connected the account says so, and its figures are not asked for", async () => {
    mockAnswers["/api/admin/trading/status"] = { connected: false, enabled: false };
    mockAnswers["/api/admin/market/status"] = { mode: "off", watchlist: ["ALPHA"] };
    mockAnswers["/api/admin/market/quotes"] = { quotes: {}, at: null };
    draw();
    await settle();
    expect(screen.getByRole("region", { name: "Your account" }).textContent).toMatch(/Zerodha is not connected/);
    expect(screen.getByRole("region", { name: "Market now" }).textContent).toMatch(/Zerodha is not connected: live prices appear after you log in/);
    expect(mockCalls.some(([u]) => u === "/api/admin/trading/summary")).toBe(false);
    expect(screen.queryByRole("region", { name: /Open positions/ })).toBeNull();
  });

  test("someone without an account here never asks for one", async () => {
    draw({ own: false });
    await settle();
    expect(screen.queryByRole("region", { name: "Your account" })).toBeNull();
    expect(mockCalls.some(([u]) => u.startsWith("/api/admin/trading"))).toBe(false);
    expect(screen.getByRole("region", { name: "Watchlist analysis" })).toBeTruthy();
  });

  test("blocks switched off under Customize are not drawn and read nothing; the status line stays", async () => {
    draw({ show: { status: true, market: false, account: false, watchlist: false }, statusLine: <p>the status line</p> });
    await settle();
    expect(screen.getByText("the status line")).toBeTruthy();
    expect(screen.queryByRole("region")).toBeNull();
    expect(mockCalls).toHaveLength(0);
  });
});
