import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import MorningStrip, { MisChip, MorningRecap } from "./MorningCall";
import DeskGlance from "./DeskGlance";

jest.mock("../../api", () => ({ api: jest.fn(() => Promise.resolve({ ok: true })), peek: () => null }));
jest.mock("../../auth", () => ({ useAuth: () => ({ user: { role: "superadmin" } }) }));
jest.mock("../../clock/exchangeClock", () => ({ useExchangeNow: () => Date.parse("2026-11-27T14:50:00+05:30") }));

const sq = { clock: "3:12 PM", min: 15 * 60 + 12, cas: true, note: "Zerodha squares off intraday (MIS) positions automatically at 3:12 PM." };
const call = {
  engine: "model",
  stage: "auction",
  k: 0,
  at: "9:08 AM",
  from: { price: 1460.8, what: "the pre-open auction's price (9:08)" },
  prevClose: 1456.95,
  atr: 23.65,
  open: { price: 1460.8, band: null, source: "the pre-open auction's price (9:08)", gapPct: 0.26, indicative: null, known: true },
  market: { gapPct: 0.38, source: "the Nifty's pre-open price", movePct: null },
  side: "up",
  strength: "strong",
  chances: { up45: { p: 0.64, n: 380 }, up15: { p: 0.58, n: 380 }, upDay: { p: 0.55, n: 380 } },
  levels: { next15: { at: "9:30 AM", price: 1462.4, changePct: 0.11 }, at945: { price: 1465.1, band: [1458.2, 1470.3], changePct: 0.29 }, first30: { high: 1469.5, low: 1455.2 }, day: { high: 1481.6, low: 1448.6, close: 1466.4 }, soFar: null },
  pred: {},
  soft: { oi: 0.6, preImb: 0.2, world: 0.17 },
  drivers: [{ name: "gap", label: "The gap", push: 0.04, side: "up" }],
  lean: null,
  plan: "Open ₹1,460.80. Leans up: watch for buyers to hold ₹1,460.80.",
};
const morning = {
  symbol: "RELIANCE",
  stage: "auction",
  available: true,
  show: true,
  call,
  squareOff: sq,
  record: [{ group: "pre", label: "Before the auction", calls: 40, sessions: 12, called: 30, right: 19, rate: 0.633, inBand: 0.7 }],
  model: { trained: true, sessions: 248, stocks: 98, trainedTo: "2026-11-26", testSessions: 49, checks: [{ k: 0, clock: "9:15 AM", dir45: { called: 4000, hit: 2400, rate: 0.6 }, skill: { high30: 0.12, low30: 0.1, dayHigh: 0.08, dayLow: 0.07 } }], soft: null },
  today: [],
  rule: "A ridge regression per 5-minute mark.",
};

test("the morning call shows the stage, the lean with its measured chance, and the levels to act on", () => {
  render(<MorningStrip m={morning} />);
  const s = screen.getByRole("region", { name: "Morning call" });
  expect(s.textContent).toMatch(/Auction price set/);
  expect(s.textContent).toMatch(/leans UP · 64% of similar test sessions went that way by 9:45/);
  expect(s.textContent).toMatch(/Auction price \(9:08\)₹1,460\.80gap \+0\.26%/);
  expect(s.textContent).toMatch(/Next 15 min · 9:30 AM₹1,462\.40/);
  expect(s.textContent).toMatch(/At 9:45₹1,465\.101,458\.20 – 1,470\.30/);
  expect(s.textContent).toMatch(/First 30 min1,455\.20 – 1,469\.50/);
  expect(s.textContent).toMatch(/Day range1,448\.60 – 1,481\.60/);
});

test("a down call states the chance of the side it leans to", () => {
  render(<MorningStrip m={{ ...morning, call: { ...call, side: "down", chances: { ...call.chances, up45: { p: 0.3, n: 300 } } } }} />);
  expect(screen.getByRole("region", { name: "Morning call" }).textContent).toMatch(/leans DOWN · 70% of similar test sessions/);
});

test("before it has learned, the call says it rests on fixed rules and claims no record", () => {
  render(<MorningStrip m={{ ...morning, model: { trained: false, why: "It learns from the stored history." }, call: { ...call, engine: "rules", chances: null, lean: { score: 0.3, side: "up", votes: [{ name: "Futures build-up", weight: 1.2, vote: 0.6, why: "OI" }] } } }} />);
  const s = screen.getByRole("region", { name: "Morning call" });
  expect(s.textContent).toMatch(/fixed rules: no record yet/);
  fireEvent.click(screen.getByRole("button", { name: "Why · record" }));
  expect(screen.getByText("The votes (fixed rules)")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Learn from the stored history now" })).toBeTruthy();
});

test("the details give the reasons, the readings and the record — the model's test and the live one", () => {
  render(<MorningStrip m={morning} />);
  fireEvent.click(screen.getByRole("button", { name: "Why · record" }));
  expect(screen.getByText("The gap")).toBeTruthy();
  expect(screen.getByText(/Pre-open orders: 60% buy \/ 40% sell/)).toBeTruthy();
  expect(screen.getByText(/tested on the newest 49 it never saw/)).toBeTruthy();
  expect(screen.getByText(/direction to 9:45 right on/).textContent).toMatch(/60%/);
  expect(screen.getByText(/Live, before the auction: direction right on 19 of 30 \(63%\)/)).toBeTruthy();
});

test("the MIS square-off time is shown, with a countdown in its last hour", () => {
  render(<MisChip sq={sq} />);
  const chip = screen.getByText(/MIS auto square-off/);
  expect(chip.textContent).toMatch(/MIS auto square-off 3:12 PM · in 22 min/);
  expect(chip.getAttribute("data-tip")).toMatch(/automatically at 3:12 PM/);
});

test("from 9:45 a line says how the morning call did", () => {
  const m = { ...morning, show: false, handover: true, today: [{ stage: "o5", madeAt: "2026-11-27T04:10:00.000Z", side: "up", p45: 0.62, from: 1462, levels: { at945: 1465, high30: 1469, low30: 1455, dayHigh: 1481, dayLow: 1448 }, result: { at945: 1466.2, high30: 1468, low30: 1458, right: true }, day: null }] };
  render(<MorningRecap m={m} />);
  expect(screen.getByRole("status").textContent).toMatch(/Morning call 9:40 am: leaned up \(62%\) — 9:45 was ₹1,466\.20 \(\+0\.29%\) · right/i);
});

test("on the Desk, before 9:45 the morning call leads the first-sight panel; during the opening minutes it stands alone", async () => {
  const a = { price: { open: 1452, prevClose: 1457, volume: 1 }, score: { value: 17, label: "Neutral" }, indicators: {}, levels: { week52: {}, pivots: {}, movingAverages: {} } };
  const { rerender } = render(<DeskGlance a={a} v={null} intraday={null} quote={null} price={1460} prevClose={1457} high={1461} low={1455} onTab={() => {}} onVerdict={() => {}} morning={morning} />);
  await act(async () => Promise.resolve());
  expect(screen.getByRole("region", { name: "Morning call" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "The next triggers" })).toBeTruthy();
  rerender(<DeskGlance a={a} v={null} intraday={null} quote={null} price={1460} prevClose={1457} high={1461} low={1455} onTab={() => {}} onVerdict={() => {}} morning={{ ...morning, stage: "opening", call: { ...call, stage: "opening" } }} />);
  expect(screen.queryByRole("region", { name: "The next triggers" })).toBeNull();
});
