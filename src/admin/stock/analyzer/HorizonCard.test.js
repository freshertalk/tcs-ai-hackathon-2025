import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

jest.mock("../../api", () => ({ api: jest.fn(), peek: jest.fn(() => null) }));
jest.mock("../../visible", () => ({ everyVisible: () => () => {} }));
jest.mock("../../auth", () => ({ useAuth: () => ({ user: { role: "superadmin" } }) }));
// eslint-disable-next-line import/first
import { api } from "../../api";
// eslint-disable-next-line import/first
import HorizonCard, { HorizonBoard } from "./HorizonCard";

const view = {
  symbol: "SBIN",
  trained: true,
  available: true,
  closed: false,
  asOf: "2026-11-17T05:35:10.000Z",
  anchor: { at: "2026-11-17T05:35:00.000Z", price: 1082.5 },
  headline: {
    minutesAhead: 16,
    h: 4,
    at: "2026-11-17T05:51:00.000Z",
    price: 1085.2,
    pct: 0.25,
    low: 1081.4,
    high: 1089,
    pUp: 0.66,
    sdPct: 0.21,
    call: { word: "UP", side: "up", p: 0.66, grade: "B" },
    reach: { minutes: 20, up: { pct: 0.4, price: 1086.8 }, down: { pct: -0.15, price: 1080.9 } },
    grade: { statedP: 0.66, calls: 5200, acc: 0.63, text: "When the model leaned this strongly (62–70%) on sessions it had not seen, it was right 63% of the time (5,200 calls)." },
  },
  horizons: [
    { minutes: 5, at: "2026-11-17T05:40:00.000Z", price: 1083.4, pct: 0.08, low: 1082, high: 1084.8, pUp: 0.58 },
    { minutes: 20, at: "2026-11-17T05:55:00.000Z", price: 1085.2, pct: 0.25, low: 1081.4, high: 1089, pUp: 0.66 },
    { minutes: 30, at: "2026-11-17T06:05:00.000Z", price: 1086, pct: 0.32, low: 1080.9, high: 1091, pUp: 0.62 },
  ],
  reach: [{ minutes: 20, up: { pct: 0.4, price: 1086.8 }, down: { pct: -0.15, price: 1080.9 } }],
  levels: [
    { name: "Day high", price: 1086, side: "above", distPct: 0.32, p15: 0.41, p30: 0.55 },
    { name: "VWAP", price: 1079.9, side: "below", distPct: -0.24, p15: 0.22, p30: 0.38 },
  ],
  day: { high: 1086, low: 1070, vwap: 1079.9 },
  why: [{ key: "r3", side: "up", text: "the last 15 minutes were rising", pushSigma: 0.2 }],
  live: { n: 480, dirAcc: 0.57, coverage: 0.7, missPct: 0.11, naivePct: 0.13, strongN: 90, strongAcc: 0.66 },
  own: { n: 12, dirAcc: 0.58, coverage: 0.75 },
  stock: { n: 4200, dirAcc: 0.55, missPct: 0.12, naivePct: 0.14 },
  history: [{ at: "2026-11-17T05:00:00.000Z", price: 1080, forecast: 1081.2, actual: 1082, missPct: -0.07, inBand: true, right: true, pUp: 0.6 }],
  learning: { trained: true, examples: 1020000, stocks: 100, lastDate: "2026-11-16", daysLearned: 4, live: { n: 480 } },
  rule: "How it works.",
};

test("the card shows the price, band, high, low, chance, levels, why — and how often it has been right", async () => {
  api.mockResolvedValue(view);
  render(<HorizonCard symbol="SBIN" />);
  expect(await screen.findByText("UP")).toBeTruthy();
  expect(screen.getByText(/16 min ahead/)).toBeTruthy();
  expect(screen.getByText("₹1,085.20")).toBeTruthy();
  expect(screen.getByText("Expected high")).toBeTruthy();
  expect(screen.getByText("Expected low")).toBeTruthy();
  expect(screen.getByText("Chance higher")).toBeTruthy();
  expect(screen.getByText(/the last 15 minutes were rising/)).toBeTruthy();
  expect(screen.getByText(/right 63% of the time/)).toBeTruthy();
  expect(screen.getByText(/480 forecasts · direction 57%/)).toBeTruthy();
  expect(screen.getByText(/Tested on its history/)).toBeTruthy();
  expect(screen.getByLabelText(/Levels and the chance of touching them/)).toBeTruthy();
  // the details: every horizon, the levels, the last forecasts
  expect(screen.queryByText("The last forecasts for SBIN, and what happened")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  expect(screen.getByText("The last forecasts for SBIN, and what happened")).toBeTruthy();
  expect(screen.getByText("Levels: the chance the price touches them")).toBeTruthy();
});

test("when there is no forecast it says why, in the card's own words", async () => {
  api.mockResolvedValue({ symbol: "SBIN", trained: false, available: false, reason: "The forecaster has not learned yet.", live: { n: 0 }, own: { n: 0 }, history: [], learning: { trained: false } });
  render(<HorizonCard symbol="SBIN" />);
  expect(await screen.findByText("The forecaster has not learned yet.")).toBeTruthy();
});

test("the board lists the out-of-sample test and each evening's result, and lets the owner start the learning", async () => {
  const board = {
    trained: true,
    learning: {
      trained: true,
      examples: 1020000,
      lastDate: "2026-11-16",
      daysLearned: 4,
      contest: { name: "all 27 inputs", inUse: "full", examples: 80000, candidates: [{ id: "base", name: "the original 18 inputs", inUse: false, moreErrorPct: 0.41 }, { id: "full", name: "all 27 inputs", inUse: true, moreErrorPct: 0 }] },
      stockScales: { on: false, stocks: 100, gainPct: 0 },
      lessons: ["Tested on 80,000 examples from sessions it had not seen.", "Model in use: all 27 inputs."],
    },
    validation: { from: "2026-09-01", to: "2026-11-16", examples: 110000, stocks: 100, horizons: [{ h: 3, minutes: 15, n: 100, dirAcc: 0.541, skill: 0.01, missPct: 0.12, naivePct: 0.13, coverage: 0.7, bins: [{ lo: 0.7, hi: 0.8, calls: 1000, right: 640, acc: 0.64 }] }] },
    days: [{ date: "2026-11-16", rows: 3400, bandScale: 1, h15: { dirAcc: 0.55, missPct: 0.11, naivePct: 0.12, coverage: 0.69 }, h30: null }],
    live: { n: 0 },
    job: null,
    history: { stocks: 100, expected: 100, sessions: 240 },
  };
  api.mockResolvedValue(board);
  render(<HorizonBoard />);
  expect(await screen.findByText(/Tested on sessions it had not seen/)).toBeTruthy();
  expect(screen.getByText("54.1%")).toBeTruthy();
  expect(screen.getByText(/64.0% \(1,000\)/)).toBeTruthy();
  expect(screen.getByText(/Each evening/)).toBeTruthy();
  expect(screen.getByText("Model in use:").parentElement.textContent).toContain("all 27 inputs — the others on the same unseen examples: the original 18 inputs +0.41% error");
  expect(screen.getByText("Model in use:").parentElement.textContent).toContain("Each stock's own scale: not in use");
  expect(screen.getByText((t) => t.startsWith("What it has learned so far (2 findings"))).toBeTruthy();
  expect(screen.getByText("Tested on 80,000 examples from sessions it had not seen.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Learn new sessions" }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/api/admin/market/horizon/learn", { method: "POST" }));
});
