import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import TradeAnalysis from "./TradeAnalysis";
import { TradeChart } from "./LabExtras";

const mockLab = {
  available: true,
  date: "2026-11-13",
  summary: { trades: 2, replayed: 2, gross: 900, charges: 60, net: 840, capture: 42, ranOn: 1500, avoided: 700, score: 58, label: "Mixed" },
  rules: [
    { id: "actual", name: "Your exits", net: 840, trades: 2, vsActual: 0 },
    { id: "fixed", name: "Stop 0.5% · target 1% (2R)", net: 1200, trades: 2, vsActual: 360 },
    { id: "trail", name: "Trailing stop 0.5%", net: 1500, trades: 2, vsActual: 660 },
    { id: "breakeven", name: "Stop 0.5%, to break-even at +0.5%", net: 900, trades: 2, vsActual: 60 },
    { id: "close", name: "Hold to 3:15 PM", net: 300, trades: 2, vsActual: -540 },
  ],
  best: { id: "trail", name: "Trailing stop 0.5%", net: 1500, trades: 2, vsActual: 660 },
  flags: [{ id: "revenge", name: "Revenge trade", major: true, text: "In within 10 minutes of closing a loss.", count: 1, net: -420 }],
  trades: [
    { key: "a", symbol: "SBIN", side: "long", qty: 50, entryClock: "09:40", exitClock: "10:05", entryAvg: 800, exitAvg: 826, holdMin: 25, pnl: 1300, charges: 30, net: 1270, intraday: true, n: 1, read: { mfe: 2000, mae: -300, mfePct: 5, maePct: -0.75, capture: 65, ranOn: 900, avoided: 200, vsVwapPct: 0.4, opening: "above the opening range", rangePos: 70 }, whatIf: { trail: { exit: 830, how: "trail", net: 1470 } }, flags: [] },
    { key: "b", symbol: "INFY", side: "short", qty: 20, entryClock: "10:10", exitClock: "10:30", entryAvg: 1500, exitAvg: 1520, holdMin: 20, pnl: -400, charges: 30, net: -430, intraday: true, n: 2, read: { mfe: 100, mae: -500, mfePct: 0.33, maePct: -1.67, capture: null, ranOn: 600, avoided: 0, vsVwapPct: 0.2, rangePos: 40 }, whatIf: {}, flags: ["revenge", "againstVwap"] },
  ],
  limits: { stop: 1500, target: 3000 },
  notes: [],
};
const mockBoard = {
  at: "2026-11-13T05:12:00Z",
  marketOpen: true,
  connected: true,
  streaming: true,
  minutesToSquareOff: 272,
  positions: [
    {
      key: "NSE:SBIN:MIS",
      symbol: "SBIN",
      exchange: "NSE",
      product: "MIS",
      side: "long",
      qty: 50,
      avg: 800,
      entryAt: Date.parse("2026-11-13T04:10:00Z"),
      entryClock: "09:40",
      at: Date.parse("2026-11-13T05:12:00Z"),
      advice: {
        state: "exit-now",
        word: "EXIT NOW",
        pressure: 100,
        headline: "EXIT NOW — about ₹805.95. The trailing stop at ₹806.40 is hit.",
        exit: { price: 805.95, qty: 50, how: "market", limit: null, note: "At market: about ₹805.95." },
        stop: 806.4,
        stopKind: "trailing stop",
        target: 812.4,
        reasons: { exit: ["The trailing stop at ₹806.40 is hit.", "You have given back 55% of the best gain (+1.60% at 10:20, now +0.74%)."], hold: ["Above VWAP ₹803.20 (+0.34%)."] },
        metrics: { last: 805.95, pnl: 297.5, gainPct: 0.74, peak: { price: 812.8, clock: "10:20", gainPct: 1.6, pnl: 640 }, trough: { price: 799.2, clock: "09:44", gainPct: -0.1, pnl: -40 }, givebackPct: 55, minutesIn: 62, minutesToSquareOff: 272, vwap: 803.2, vsVwapPct: 0.34, rsi1: 41, move3Pct: -0.31, bid: 805.95, ask: 806.05, book: { pressure: -48, label: "Sellers pressing", buyersPct: 34, delta60: -4200, lean: "down", wall: null, spread: 0.1 }, pulse: { score: -31, lean: "down", low: 801.5, high: 809.4 } },
      },
      ai: null,
      path: [[Date.parse("2026-11-13T04:10:00Z"), 800], [Date.parse("2026-11-13T04:50:00Z"), 812.8], [Date.parse("2026-11-13T05:11:00Z"), 806.2]],
      frames: [[1, 10, 0], [2, 60, 2], [3, 100, 3]],
      events: [{ at: 1, clock: "09:40", kind: "entry", text: "Bought 50 at ₹800.00." }, { at: 2, clock: "10:42", kind: "signal", state: "exit-now", text: "EXIT NOW — about ₹805.95." }],
      news: null,
      levels: null,
      map: { at: 1, last: 805.95, anchors: [{ id: "A1", price: 810, label: "Previous day's high + Round number", strength: 4, side: "above", awayPct: 0.5, touches: 2, touchPct: 46 }, { id: "B1", price: 803.2, label: "VWAP", strength: 3, side: "below", awayPct: -0.34, touches: 3, touchPct: 71 }] },
    },
  ],
  other: [],
  landed: [{ id: "INFY-1", symbol: "INFY", side: "short", qty: 20, avg: 1500, exitAvg: 1492, pnl: 160, entryClock: "09:25", exitClock: "09:58", peak: { clock: "09:50", pnl: 260 }, givebackPct: 38, coachExit: { clock: "09:53", price: 1489.5 } }],
  market: { tide: { score: -22, label: "Falling", summary: "Falling tide" }, forecast: { word: "down", headline: "NSE leans down" }, mood: { label: "Mixed" }, goal: "ok" },
  settings: { aiMode: "change", aiDailyCap: 30, notify: true, aiToday: 2, aiReady: true, model: "Claude Sonnet 5.5" },
  watch: { error: "" },
};
const mockLevels = {
  id: "L1",
  at: 1,
  clock: "10:43",
  by: "Claude Sonnet 5.5",
  auto: false,
  why: "you asked",
  last: 805.95,
  confidence: "medium",
  outlook: "against",
  summary: "Take profit into the previous day's high; the tide is against holding for more.",
  targets: [{ n: 1, anchor: "A1", label: "Previous day's high + Round number", level: 810, price: 809.9, strength: 4, touches: 2, awayPct: 0.5, gainPct: 1.25, touchPct: 46, reach: "within reach", r: 1.6, firstPct: 38, why: "810 held twice today.", status: "open", reachedAt: null }],
  stop: { anchor: "coach", label: "The coach's stop", level: 804.4, price: 804.4, clamped: false, note: "", why: "", awayPct: -0.19, touchPct: 88, tight: false, status: "open", hitAt: null },
  reversal: { anchor: "A1", label: "Previous day's high + Round number", price: 810, sign: "Sellers above 60% of the five best levels." },
  rejected: [{ what: "target", price: 104, why: "“A9” is not a level on the desk's map." }],
  checks: { asked: 3, passed: 2, corrected: 0 },
  failed: false,
  outcome: null,
};
const mockCompare = {
  available: true,
  date: "2026-11-13",
  enough: true,
  headline: "+₹840 net against your usual +₹310; score 58 against 52. First to fix: revenge trade.",
  baseline: { days: 9 },
  versus: [{ id: "score", name: "Execution score", unit: "/100", today: 58, usual: 52, better: true }, { id: "net", name: "Net after charges", unit: "₹", today: 840, usual: 310, better: true }],
  prevent: [{ id: "revenge", habit: "Revenge trade", major: true, what: "In within 10 minutes of closing a loss.", kind: "again", today: { count: 1, net: -420 }, history: { count: 6, net: -3100, days: 4 }, evidence: "6 times on 4 of your last 9 trading days: −₹3,100 net.", action: "After a losing exit, wait 15 minutes before the next entry." }],
  keep: [{ id: "ctx", text: "Entering with VWAP (longs above it, shorts below) works for you: 14 trades, 64% won, ₹2,300 net. Keep to it." }],
  similarDays: [{ date: "2026-11-06", net: -900, text: "6 Nov: 4 trades, −₹900 net, score 44 — the same revenge trade." }],
  similarTrades: [{ key: "a", good: true, text: "Longs with VWAP around 9 AM: 7 earlier trades, 5 won, ₹1,900 net." }],
};
const mockCalls = [];
jest.mock("../../api", () => ({
  api: (url) => {
    mockCalls.push(url);
    if (url === "/api/admin/analysis/days") return Promise.resolve({ days: [{ date: "2026-11-13" }] });
    if (url === "/api/admin/flight") return Promise.resolve(mockBoard);
    if (url === "/api/admin/flight/ai") return Promise.resolve({ opinion: { at: 1, clock: "10:43", action: "exit-now", exitPrice: 805.9, stop: 806.4, confidence: "high", reason: "Half the gain is gone and sellers lead the book.", watch: "A reclaim of 808.", by: "Claude Sonnet 5.5", agrees: true, deskSaid: "exit-now" }, settings: mockBoard.settings });
    if (url === "/api/admin/flight/levels") return Promise.resolve({ levels: mockLevels, settings: mockBoard.settings, record: { judged: 12, text: "First target reached before the stop on 7 of 12 sets (58%); the stop came first on 3." } });
    if (url.startsWith("/api/admin/flight/day/")) return Promise.resolve({ available: false });
    if (url.startsWith("/api/admin/analysis/compare/")) return Promise.resolve(mockCompare);
    if (url.startsWith("/api/admin/analysis/lab/")) return Promise.resolve(mockLab);
    if (url.startsWith("/api/admin/analysis/lab?")) return Promise.resolve({ days: 3, summary: { trades: 9, replayed: 9, net: 2100, charges: 270, capture: 38, ranOn: 4200, avoided: 1500, score: 61 }, rules: mockLab.rules, best: mockLab.best, flags: mockLab.flags, byHour: [{ hour: 9, label: "9 AM", trades: 4, net: 1800 }, { hour: 10, label: "10 AM", trades: 5, net: 300 }], context: [{ id: "withVwap", name: "With VWAP (long above, short below)", trades: 6, net: 2500 }], lessons: ["“Trailing stop 0.5%” would have made ₹660 more than your own exits on the same 9 entries."], trend: [{ date: "2026-11-11", score: 55 }, { date: "2026-11-12", score: 70 }, { date: "2026-11-13", score: 58 }] });
    return Promise.resolve({});
  },
}));
jest.mock("../../DatePicker", () => ({ DateField: ({ value, label }) => <span>{`${label}: ${value}`}</span> }));
const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));
// While NSE is open the page always opens on the Live board, whatever was picked last time. The tests
// that open another part pin the clock to a Saturday, so they pass at any hour.
let clockSpy = null;
const outsideMarketHours = () => {
  const real = Date.now.bind(Date);
  const offset = Date.parse("2026-11-14T06:30:00Z") - real();
  clockSpy = jest.spyOn(Date, "now").mockImplementation(() => real() + offset);
};
beforeEach(() => {
  mockCalls.length = 0;
  window.localStorage.clear();
});
afterEach(() => {
  if (clockSpy) clockSpy.mockRestore();
  clockSpy = null;
});

test("a day replayed: the score, the share kept, the best other exit, the habits and every trade", async () => {
  outsideMarketHours();
  window.localStorage.setItem("vpt.lab.mode", "day");
  render(<TradeAnalysis />);
  await settle();
  expect(mockCalls).toContain("/api/admin/analysis/lab/2026-11-13");
  expect(screen.getByText("58 / 100")).toBeTruthy();
  expect(screen.getByText("Mixed")).toBeTruthy();
  expect(screen.getByText("42%")).toBeTruthy();
  expect(screen.getAllByText("Trailing stop 0.5%").length).toBeGreaterThan(0);
  expect(screen.getByText("Revenge trade")).toBeTruthy();
  expect(screen.getByText(/09:40–10:05/)).toBeTruthy();
  expect(screen.getByText("vs VWAP")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /SBIN/ }));
  expect(screen.getByText(/out at 830/)).toBeTruthy();
  expect(screen.getByText(/Day book/)).toBeTruthy();
});

test("a period: the lessons, the exit rules and the habits added up", async () => {
  outsideMarketHours();
  window.localStorage.setItem("vpt.lab.mode", "day");
  render(<TradeAnalysis />);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "A period" }));
  await settle();
  expect(mockCalls.some((u) => u.startsWith("/api/admin/analysis/lab?from="))).toBe(true);
  expect(screen.getByText(/would have made ₹660 more/)).toBeTruthy();
  expect(screen.getByText("61 / 100")).toBeTruthy();
  expect(screen.getByText(/9 AM · 4/)).toBeTruthy();
});

test("the Live board: each open position with its word, the exit price, the stop, the reasons — and the AI on request", async () => {
  window.localStorage.setItem("vpt.lab.mode", "live");
  render(<TradeAnalysis />);
  await settle();
  expect(mockCalls).toContain("/api/admin/flight");
  expect(screen.getByText("EXIT NOW")).toBeTruthy();
  expect(screen.getByText("exit pressure 100 / 100")).toBeTruthy();
  expect(screen.getByText("Exit now at")).toBeTruthy();
  expect(screen.getAllByText("₹805.95").length).toBeGreaterThan(0);
  expect(screen.getByText("₹806.40")).toBeTruthy();
  expect(screen.getByText(/given back 55% of the best gain/)).toBeTruthy();
  expect(screen.getByText(/buyers 34% · Sellers pressing/)).toBeTruthy();
  expect(screen.getByText("Market LIVE")).toBeTruthy();
  expect(screen.getByText(/09:53 at ₹1,489.50/)).toBeTruthy(); // landed today: where the coach said EXIT
  // the Exit button never trades by itself: with no trading context it is disabled
  expect(screen.getByRole("button", { name: "Exit…" }).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Ask the AI" }));
  await settle();
  expect(mockCalls).toContain("/api/admin/flight/ai");
  expect(screen.getByText(/Half the gain is gone and sellers lead the book/)).toBeTruthy();
  expect(screen.getByText(/It agrees with the desk/)).toBeTruthy();
});

test("the Live board's exit levels: the desk's level map, and the AI's research on request — only what passed the check, with what was left out", async () => {
  window.localStorage.setItem("vpt.lab.mode", "live");
  render(<TradeAnalysis />);
  await settle();
  expect(screen.getByText("Exit levels")).toBeTruthy();
  expect(screen.getByText(/The desk's own level map\. The AI has not researched this position yet/)).toBeTruthy();
  expect(screen.getByText("Previous day's high + Round number")).toBeTruthy(); // a level from the desk's map
  expect(screen.getAllByText("VWAP").length).toBe(2); // the gauge, and the level on the map
  expect(screen.getByText("NOW")).toBeTruthy();
  expect(screen.getByRole("img", { name: /46% odds of a touch before the square-off, no trend assumed/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Research levels (AI)" }));
  await settle();
  expect(mockCalls).toContain("/api/admin/flight/levels");
  expect(screen.getByText(/AI-researched at 10:43 by Claude Sonnet 5\.5 · 2 of 3 of its choices passed the desk's check · confidence medium · the wider market is against the trade/)).toBeTruthy();
  expect(screen.getByText("T1")).toBeTruthy();
  expect(screen.getByText("STOP")).toBeTruthy();
  expect(screen.getByText(/limit ₹809\.90 · 1\.6R to the stop · within reach/)).toBeTruthy();
  expect(screen.getByText("810 held twice today.")).toBeTruthy();
  expect(screen.getByText(/Watch for a turn at ₹810\.00/)).toBeTruthy();
  expect(screen.getByText(/“A9” is not a level on the desk's map/)).toBeTruthy();
  expect(screen.getByText(/First target reached before the stop on 7 of 12 sets/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Research again" })).toBeTruthy();
});

test("the Coach: what to prevent with its cost and a rule, what to keep, and the day against the usual", async () => {
  outsideMarketHours();
  window.localStorage.setItem("vpt.lab.mode", "coach");
  render(<TradeAnalysis />);
  await settle();
  await settle();
  expect(mockCalls).toContain("/api/admin/analysis/compare/2026-11-13");
  expect(screen.getByText(/First to fix: revenge trade/)).toBeTruthy();
  expect(screen.getByText("again today")).toBeTruthy();
  expect(screen.getByText(/wait 15 minutes before the next entry/)).toBeTruthy();
  expect(screen.getByText(/Entering with VWAP/)).toBeTruthy();
  expect(screen.getAllByText("▲ better than usual").length).toBe(2);
  expect(screen.getByText(/the same revenge trade/)).toBeTruthy();
});

test("a recorded trade's replay: the AI's exit levels as they were given, each scored on the day's bars", () => {
  const t = { symbol: "SBIN", side: "long", entryAt: 1000, exitAt: 601000, entryClock: "09:40", exitClock: "09:50", entryAvg: 800, exitAvg: 806, pnl: 300, read: { path: [[1000, 800], [301000, 808], [601000, 806], [1201000, 811]], bestExit: { at: 301000, clock: "09:45", price: 808, pnl: 400, kind: "profit" }, coach: null } };
  const flight = {
    events: [],
    levels: [
      { id: "L1", clock: "09:41", by: "Claude Sonnet 5.5", failed: false, targets: [{ n: 1, level: 810, label: "Previous day's high" }], stop: { price: 797.5 }, outcome: { t1: "reached", t1Clock: "10:00", t1At: 1201000, t2: null, stop: "open" } },
      { id: "L2", clock: "09:48", by: "Claude Sonnet 5.5", failed: true, targets: [], stop: null, outcome: null },
    ],
  };
  render(<TradeChart t={t} flight={flight} />);
  expect(screen.getByText(/target 1 ₹810\.00 \(Previous day's high\), stop ₹797\.50 — target 1 reached at 10:00 — 10 min after you left\./)).toBeTruthy();
  expect(screen.getByText(/none of its targets passed the desk's check/)).toBeTruthy();
  expect(screen.getByText(/AI target 810\.00/)).toBeTruthy(); // the level drawn across the chart
  // no recording, no list
  const { container } = render(<TradeChart t={t} flight={null} />);
  expect(container.querySelector(".lx-ai")).toBeNull();
});
