import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

let mockConn = { status: "live" };
let mockTicks = { state: "live", slow: {} };
let mockBook = null;
jest.mock("../../api", () => ({ api: jest.fn(), peek: jest.fn(() => null) }));
jest.mock("../../visible", () => ({ everyVisible: jest.fn(() => () => {}) }));
jest.mock("../../live", () => ({ useLive: () => mockConn }));
jest.mock("../analyzer/liveTicks", () => ({ useLiveTicks: () => mockTicks }));
jest.mock("../trade/liveBook", () => ({ useLiveBook: () => mockBook }));
// eslint-disable-next-line import/first
import { api } from "../../api";
// eslint-disable-next-line import/first
import { everyVisible } from "../../visible";
// eslint-disable-next-line import/first
import NowView from "./NowView";

const lean = (side, p, proven, tier = "clear") => ({ lean: side, tier: side === "none" ? "none" : tier, p: side === "none" ? null : p, pUp: side === "up" ? p : 0.36, pDown: side === "down" ? p : 0.33, usualUp: 0.38, usualDown: 0.37, proven, at: "2026-11-20T05:55:00.000Z" });
const row = (symbol, c15, over = {}) => ({ symbol, available: true, last: 1000, changePct: 0.5, asOf: "2026-11-20T05:40:00.000Z", calls: { 5: lean("none"), 15: c15 }, forecaster: { pUp: 0.55, pct: 0.03 }, up: 4, down: 1, speaking: 5, top: [{ name: "Pullback to VWAP in a trend", state: 1 }], vsVwapPct: 0.21, volumeX: 1.4, early: null, ...over });
const board = (over = {}) => ({
  at: "2026-11-20T05:41:10.000Z",
  trained: true,
  mode: "kite",
  rows: [
    row("INFY", lean("none")),
    row("TCS", lean("up", 0.44, false, "slight")),
    row("RELIANCE", lean("down", 0.49, true), { last: 1432.5, changePct: -0.8, up: 2, down: 6, vsVwapPct: -0.34, volumeX: 2.2, early: { tone: "warn", read: "The down-move is at risk of turning within 15 minutes: 41% against a usual 29%.", reversal: "raised", momentum: "steady" } }),
    { symbol: "NOSUCH", available: false, last: null, changePct: null, reason: "Too little price history on this stock for a forecast." },
  ],
  liveCalls: { 1: { n: 30, ok: 16 }, 3: { n: 40, ok: 24 } },
  checked: 64,
  ai: { mode: "need", usedToday: 3, perDay: 40, record: { n: 12, ok: 7, right: 0.5833 } },
  market: { available: true, session: "open", tide: { label: "Falling", score: -9, summary: "Falling tide (−9): Nifty −0.60% on the day." }, nifty: { changePct: -0.6 }, vix: { last: 15.2, changePct: 6.5 }, gift: { last: 24010, changePct: -0.95 }, breadth: { up: 1, down: 8, total: 10 }, sectors: [{ name: "IT", changePct: 0.3 }, { name: "Auto", changePct: -1.1 }] },
  systems: [
    { id: "horizon", name: "15-minute forecaster", state: "on", detail: "learned to 2026-11-19" },
    { id: "evidence", name: "Evidence desk (techniques, order book, world)", state: "learning", detail: "no usable model yet (it trains after the forecaster)" },
    { id: "recorder", name: "Market recorder", state: "needs-zerodha", detail: "Zerodha is not connected" },
  ],
  checks: { forecaster: { 1: { n: 0, ok: 0 }, 3: { n: 120, ok: 66 } }, early: null },
  ...over,
});

beforeEach(() => {
  api.mockReset();
  everyVisible.mockClear();
  mockConn = { status: "live" };
  mockTicks = { state: "live", slow: {} };
  mockBook = null;
});

test("one page: the market, the board with every followed stock's calls (strongest proven lean first), the checks, the AI and the systems", async () => {
  api.mockResolvedValue(board());
  const onOpen = jest.fn();
  render(<NowView onOpen={onOpen} />);
  await waitFor(() => expect(screen.getByText("The board")).toBeTruthy());
  // it is re-read the moment the server says any of it changed
  expect(everyVisible.mock.calls[0][2].topics).toEqual(expect.arrayContaining(["evidence", "horizon", "market", "automation", "trading"]));
  expect(document.querySelector(".nw-conn").textContent).toMatch(/Live — every change shows at once/);
  // the market
  const tiles = [...document.querySelectorAll(".nw-tile")].map((t) => t.textContent);
  expect(tiles[0]).toMatch(/NIFTY tideFallingNIFTY −0\.60%/);
  expect(document.querySelector(".nw-tile--down")).toBeTruthy();
  expect(tiles[1]).toMatch(/India VIX15\.20\+6\.50% today/);
  expect(tiles[2]).toMatch(/GIFT NIFTY−0\.95%−0\.35% vs NIFTY/);
  expect(tiles[3]).toMatch(/Sectors1 up · 8 downbest IT \+0\.30%/);
  // the board in one number, the checks so far, the AI
  expect(tiles[4]).toMatch(/▲ 1 ▽ 11 early call · 4 followed/);
  expect(tiles[5]).toMatch(/Checked so far, 15 min60% of 40forecaster 55% of 120/);
  expect(tiles[6]).toMatch(/AI reads today3 of 40right 58% of 12 checked/);
  // the board: the proven lean first, then the unproven one, then no lean, and last what could not be read
  const rows = [...document.querySelectorAll(".nw-table tbody tr")];
  expect(rows.map((r) => r.querySelector(".nw-sym").textContent)).toEqual(["RELIANCE", "TCS", "INFY", "NOSUCH"]);
  const rel = rows[0];
  expect(rel.querySelector(".nw-lean--down.is-proven").textContent).toBe("▽ DOWN 49%proven");
  expect(rel.querySelector(".nw-split").textContent).toBe("26");
  expect(rel.querySelector(".nw-split__bar .is-down").style.width).toBe("75%");
  expect(rel.querySelector(".nw-early--warn").textContent).toBe("turn?");
  expect(rel.textContent).toMatch(/1,432\.50−0\.80%/);
  expect(rel.textContent).toMatch(/−0\.34%2\.2×/);
  expect(rows[1].querySelector(".nw-lean--up").textContent).toBe("▲ UP 44%slight");
  expect(rows[1].querySelector(".nw-lean--up").className).not.toMatch(/is-proven/);
  expect(rows[2].querySelectorAll(".nw-lean--none").length).toBe(2);
  expect(rows[3].className).toMatch(/is-off/);
  expect(rows[3].textContent).toMatch(/Too little price history on this stock for a forecast\./);
  // a stock opens on the Desk from its name or its button
  fireEvent.click(rel.querySelector(".nw-sym"));
  fireEvent.click(rows[1].querySelector(".adm-btn"));
  expect(onOpen.mock.calls.map((c) => c[0])).toEqual(["RELIANCE", "TCS"]);
  // the filters
  fireEvent.click(screen.getByText("Leaning up 1"));
  expect([...document.querySelectorAll(".nw-table tbody .nw-sym")].map((x) => x.textContent)).toEqual(["TCS"]);
  fireEvent.click(screen.getByText("Early calls 1"));
  expect([...document.querySelectorAll(".nw-table tbody .nw-sym")].map((x) => x.textContent)).toEqual(["RELIANCE"]);
  // the systems, each with its state in a word
  expect(document.querySelector(".nw-card h3 small").textContent).toBe("strongest proven leans first");
  const sys = [...document.querySelectorAll(".nw-sys li")];
  expect(sys.map((x) => x.querySelector(".nw-sys__state").textContent)).toEqual(["On", "Learning", "Needs Zerodha"]);
  expect(screen.getByText(/1 of 3 running/)).toBeTruthy();
  expect(screen.getByText(/Nothing on this page places an order/)).toBeTruthy();
});

test("prices come from the tick stream the moment they move; your positions carry the evidence for their next 15 minutes", async () => {
  mockTicks = { state: "live", slow: { RELIANCE: { last: 1436, prevClose: 1440 } } };
  mockBook = { available: true, positions: [{ symbol: "RELIANCE", exchange: "NSE", product: "MIS", quantity: 50, average: 1430, last: 1436, pnl: 300 }, { symbol: "NIFTY26NOVFUT", exchange: "NFO", product: "NRML", quantity: 75, average: 24000, last: 24010, pnl: 750 }, { symbol: "TCS", exchange: "NSE", product: "MIS", quantity: 0, average: 0, last: 3900, pnl: 120 }] };
  api.mockImplementation((url) => (url.startsWith("/api/admin/market/evidence/positions") ? Promise.resolve({ rows: [{ symbol: "RELIANCE", side: "long", available: true, lean: "down", p: 0.49, proven: true, against: true, text: "The evidence leans DOWN…", up: 2, down: 6 }] }) : Promise.resolve(board())));
  render(<NowView />);
  await waitFor(() => expect(document.querySelector(".ev-pos--against")).toBeTruthy());
  // only the open NSE cash position is listed, with what the evidence says about it
  const pos = [...document.querySelectorAll(".nw-pos li")];
  expect(pos.length).toBe(1);
  expect(pos[0].textContent).toMatch(/RELIANCE▲ LONG 50avg 1,430\.00 · now 1,436\.00\+₹300DOWN 49%against you · next 15 min/);
  expect(api.mock.calls.some((c) => c[0] === "/api/admin/market/evidence/positions?list=RELIANCE%3Along")).toBe(true);
  // on the board the streamed price and its own day's change replace the last reading
  const rel = [...document.querySelectorAll(".nw-table tbody tr")].find((r) => r.querySelector(".nw-sym").textContent === "RELIANCE");
  expect(rel.textContent).toMatch(/1,436\.00−0\.28%/);
});

test("it says plainly what is not there yet: no model, no market, a lost connection, no followed stock", async () => {
  mockConn = { status: "offline" };
  api.mockResolvedValue(board({ trained: false, rows: [], market: { available: false, reason: "Zerodha is not connected." }, liveCalls: { 1: { n: 0, ok: 0 }, 3: { n: 0, ok: 0 } }, checks: { forecaster: null, early: null }, ai: { mode: "off", usedToday: 0, perDay: 40, record: { n: 0 } } }));
  render(<NowView />);
  await waitFor(() => expect(screen.getByText("The board")).toBeTruthy());
  expect(document.querySelector(".nw-conn.is-offline").textContent).toMatch(/Offline — showing the last reading/);
  expect(document.querySelector(".nw-tile--wide").textContent).toMatch(/The marketNot readZerodha is not connected\./);
  expect(screen.getByText(/The evidence desk has not learned yet/)).toBeTruthy();
  expect(screen.getByText(/No stock is followed yet/)).toBeTruthy();
  const tiles = [...document.querySelectorAll(".nw-tile")].map((t) => t.textContent);
  expect(tiles.some((t) => /Checked so far, 15 minnone yetthe forecaster has no checks yet/.test(t))).toBe(true);
  expect(tiles.some((t) => /AI reads today0 of 40switched off/.test(t))).toBe(true);
  expect(document.querySelector(".nw-pos")).toBeNull();
});

test("when it cannot be read at all, the reason is shown instead of an empty page", async () => {
  api.mockRejectedValue(new Error("Session expired. Sign in again."));
  render(<NowView />);
  await waitFor(() => expect(screen.getByText("Session expired. Sign in again.")).toBeTruthy());
});
