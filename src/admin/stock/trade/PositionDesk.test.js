import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { Attention, PositionMonitor } from "./PositionDesk";
import { attention, bookNumbers, holdingInsights, marginUse, minutesTo, openPnlPct, orderAway, orderStats, protection, roomToday } from "./positionMath";

jest.mock("../../api", () => ({ api: jest.fn(() => Promise.resolve({})), peek: () => null }));
jest.mock("../../visible", () => ({ everyVisible: () => () => {} }));
jest.mock("./TradeContext", () => ({ TradeButtons: () => null }));
jest.mock("../analyzer/EvidenceCard", () => ({ PositionEvidence: () => null }));

const pos = (symbol, quantity, average, last, extra = {}) => ({ exchange: "NSE", symbol, product: "MIS", quantity, multiplier: 1, average, last, close: average, buyValue: quantity > 0 ? quantity * average : 0, sellValue: quantity < 0 ? -quantity * average : 0, pnl: quantity * (last - average), ...extra });
const order = (symbol, side, type, extra = {}) => ({ id: `${symbol}-${type}`, exchange: "NSE", symbol, product: "MIS", side, type, status: "TRIGGER PENDING", quantity: 10, filled: 0, price: 0, trigger: 0, ...extra });

const long = pos("AAA", 10, 100, 110);
const short = pos("BBB", -10, 200, 190);
const sl = order("AAA", "SELL", "SL-M", { trigger: 95 });
const tgt = order("AAA", "SELL", "LIMIT", { status: "OPEN", price: 120 });

test("a stop order protects only the other side of the same instrument and product, and only for what it covers", () => {
  expect(protection(long, [sl, tgt])).toMatchObject({ state: "covered", stop: { price: 95 }, target: { price: 120 } });
  expect(protection(long, [{ ...sl, quantity: 4 }]).state).toBe("partial");
  expect(protection(long, [{ ...sl, product: "CNC" }]).state).toBe("none");
  expect(protection(long, [{ ...sl, side: "BUY" }]).state).toBe("none");
  expect(protection(long, [{ ...sl, status: "CANCELLED" }]).state).toBe("none");
  // two stops: the one the price reaches first leads (the higher for a long, the lower for a short)
  expect(protection(long, [{ ...sl, quantity: 5 }, { ...sl, id: "2", trigger: 99, quantity: 5 }]).stop.price).toBe(99);
  expect(protection(short, [order("BBB", "BUY", "SL", { trigger: 205, quantity: 5 }), order("BBB", "BUY", "SL-M", { trigger: 198, quantity: 5 })]).stop.price).toBe(198);
});

test("the headline numbers: booked and open apart, exposure by side, and what the stops give back from here", () => {
  const closed = pos("CCC", 0, 0, 50, { buyValue: 500, sellValue: 560, pnl: 60 });
  const n = bookNumbers([long, short, closed], [sl]);
  expect(n).toMatchObject({ total: 260, unrealised: 200, booked: 60, open: 2, closed: 1, longs: 1, shorts: 1, longValue: 1100, shortValue: 1900, covered: 1, giveBack: 150, winners: 2, losers: 0 });
  expect(n.noStop).toEqual(["BBB"]);
  expect(openPnlPct(short, 190)).toBeCloseTo(5);
});

test("limits, margin, orders, holdings and the countdown", () => {
  expect(roomToday({ rules: { enabled: true, dailyLoss: 1000, maxOrders: 5, maxOpen: 3 }, dayPnl: -800, orders: [{ status: "COMPLETE" }], positions: [long] })).toMatchObject({ loss: 200, lossUsedPct: 80, orders: 4, open: 2, locked: false });
  expect(roomToday({ rules: { enabled: false, dailyLoss: 1000 }, dayPnl: -800 }).loss).toBeNull();
  expect(marginUse({ net: 60, used: { debits: 40 } }).pct).toBe(40);
  expect(orderAway({ trigger: 95, price: 0 }, 100)).toBeCloseTo(-5);
  expect(orderAway({ trigger: 0, price: 0 }, 100)).toBeNull();
  expect(orderStats([{ status: "REJECTED" }, { status: "OPEN" }], [{ side: "BUY", quantity: 2, price: 10 }, { side: "SELL", quantity: 1, price: 12 }])).toMatchObject({ rejected: 1, waiting: 1, buy: 20, sell: 12, turnover: 32 });
  expect(holdingInsights([{ symbol: "X", quantity: 10, t1: 0, average: 10, last: 12, close: 11 }, { symbol: "Y", quantity: 1, t1: 0, average: 50, last: 40, close: 44 }])).toMatchObject({ count: 2, inProfit: 1, inLoss: 1, bestToday: { symbol: "X" }, worst: { symbol: "Y" }, biggest: { symbol: "X", share: 75 } });
  const fri = Date.parse("2026-11-27T14:50:00+05:30");
  expect(minutesTo(15 * 60 + 12, fri)).toBe(22);
  expect(minutesTo(15 * 60 + 12, fri + 86400000)).toBeNull(); // Saturday
});

test("what needs attention comes with the most urgent first", () => {
  const items = attention({ numbers: { noStop: ["BBB"], partStop: [] }, room: { locked: false, lossUsedPct: 80 }, margin: { pct: 85 }, stats: { rejected: 1 }, mis: [{ symbol: "AAA", clock: "3:12 PM", left: 8 }], coach: [{ symbol: "AAA", state: "exit-now", price: 101.5 }] });
  expect(items.map((x) => x.level)).toEqual(["danger", "danger", "danger", "warn", "warn", "warn"]);
  expect(items[0].text).toBe("AAA: the exit coach says EXIT NOW, about ₹101.50.");
  render(<Attention items={items} open />);
  expect(screen.getByRole("region", { name: "Needs attention" }).textContent).toMatch(/No stop-loss order in today’s order book for BBB/);
});

const monitor = (extra) => <PositionMonitor positions={[long, short]} orders={[sl, tgt]} priceOf={(p) => p.last} quoteOf={() => ({ low: 98, high: 112, avgPrice: 105, open: 101, prevClose: 100, volume: 250000, buyQty: 60, sellQty: 40 })} coach={{}} evidence={{}} squareOff={{}} canTrade trade={{ openTicket: () => {} }} onExit={() => {}} onOpen={() => {}} {...extra} />;

test("each open position says what protects it; a missing stop can be drafted as a ticket to confirm — never sent", () => {
  const openTicket = jest.fn();
  const onExit = jest.fn();
  render(monitor({ trade: { openTicket }, onExit, coach: { "NSE:BBB:MIS": { advice: { state: "tighten", word: "TIGHTEN", headline: "TIGHTEN — move the stop to ₹196.00.", pressure: 55, stop: 196, target: 185, reasons: { exit: ["x"], hold: [] }, metrics: {} } } } }));
  const a = screen.getByRole("article", { name: "AAA long MIS" });
  expect(a.textContent).toMatch(/Stop order in place/);
  expect(a.textContent).toMatch(/If the stop fills at 95\.00, this position’s P&L would be −₹50\.00/);
  expect(a.textContent).toMatch(/The stock today/);
  expect(a.querySelector(".pd-draft")).toBeNull(); // fully covered: nothing to draft
  const b = screen.getByRole("article", { name: "BBB short MIS" });
  expect(b.textContent).toMatch(/No stop-loss order/);
  expect(b.textContent).toMatch(/Coach stop196\.00/);
  expect(b.textContent).toMatch(/TIGHTEN — move the stop/);
  fireEvent.click(b.querySelector(".pd-draft"));
  expect(openTicket).toHaveBeenCalledWith(expect.objectContaining({ symbol: "BBB", side: "BUY", type: "SL-M", product: "MIS", quantity: 10, trigger: 196 }));
  fireEvent.click(screen.getByRole("button", { name: "Exit AAA" }));
  expect(onExit).toHaveBeenCalledWith(long, 110);
});

test("with the trading switch OFF the panels' buttons are greyed out", () => {
  render(monitor({ canTrade: false }));
  expect(screen.getByRole("button", { name: "Exit AAA" }).disabled).toBe(true);
  expect(screen.getByRole("button", { name: /Draft a stop order/ }).disabled).toBe(true);
});
