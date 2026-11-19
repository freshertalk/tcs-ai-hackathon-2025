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
  expect(screen.queryByText(/Order book at/)).toBeNull(); // nothing was recorded for this stock: nothing is claimed
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

test("the recorded order book and open interest are shown beside the forecast, and said to be unproven until they are proven", async () => {
  api.mockResolvedValue({ ...view, flow: { at: "11:05", buyShare: 0.62, imb: 0.24, oi15Pct: 0.8, position: "long build-up", inUse: false, tilt: 0, scored: 6900 } });
  const { unmount } = render(<HorizonCard symbol="SBIN" />);
  expect(await screen.findByText(/Order book at 11:05:/)).toBeTruthy();
  const line = document.querySelector(".hz-flow").textContent;
  expect(line).toMatch(/62% of the quantity waiting is on the buy side/);
  expect(line).toContain("futures open interest +0.80% in 15 min (long build-up)");
  expect(line).toContain("shown only: not yet proven to improve the forecast (6,900 forecasts scored so far)");
  unmount();
  api.mockResolvedValue({ ...view, flow: { at: "11:05", buyShare: 0.4, imb: -0.2, oi15Pct: null, position: "", inUse: true, tilt: -0.05, scored: 31000 } });
  render(<HorizonCard symbol="SBIN" />);
  expect(await screen.findByText(/Order book at 11:05:/)).toBeTruthy();
  const used = document.querySelector(".hz-flow").textContent;
  expect(used).toMatch(/40% of the quantity waiting is on the buy side · counted in this forecast/);
  expect(used).not.toMatch(/open interest/);
});

test("a 5-minute call beside the 15-minute one, and the check: each forecast confirmed correct or wrong, and what it taught", async () => {
  const check = (minutes, ok, extra = {}) => ({ made: "2026-11-17T05:30:00.000Z", for: minutes === 5 ? "2026-11-17T05:35:00.000Z" : "2026-11-17T05:45:00.000Z", minutes, from: 1080, ok, basis: "direction", side: "up", p: 0.61, right: ok, inBand: true, forecast: 1081.2, low: 1079.5, high: 1082.9, actual: ok ? 1081.6 : 1079.8, missPct: 0.04, movePct: ok ? 0.15 : -0.02, ...extra });
  api.mockResolvedValue({
    ...view,
    headline5: { minutesAhead: 4, at: "2026-11-17T05:40:00.000Z", h: 1, price: 1083.4, pct: 0.08, low: 1082, high: 1084.8, pUp: 0.58, sdPct: 0.1, call: { word: "LEANS UP", side: "up", p: 0.58, grade: "C" } },
    checks: {
      rule: "A call that leans (55% or more one way) is CORRECT when the price went that way by its time; a call with no lean is CORRECT when the price ended inside its band.",
      h5: { minutes: 5, last: check(5, true), recent: [], n: 20, ok: 13, pct: 0.65, all: { n: 480, ok: 290, pct: 0.6042 } },
      h15: { minutes: 15, last: check(15, false), recent: [], n: 20, ok: 11, pct: 0.55, all: { n: 480, ok: 271, pct: 0.5646 } },
      learned: { at: "2026-11-17T05:30:00.000Z", n: 41, b5: [0.01, 0.012], b15: [-0.02, -0.031], text: "Learned from the last check (right or wrong, every check counts): SBIN's own correction for 5 minutes moved +0.010σ → +0.012σ, for 15 minutes moved −0.020σ → −0.031σ — from 41 checked forecasts of this stock." },
    },
    history: [{ at: "2026-11-17T05:30:00.000Z", price: 1080, forecast: 1081.2, actual: 1079.8, missPct: 0.13, inBand: true, right: false, pUp: 0.61, v5: check(5, true), v15: check(15, false) }],
  });
  render(<HorizonCard symbol="SBIN" />);
  expect(await screen.findByText("Next 5 and 15 minutes")).toBeTruthy();
  // both calls, each labelled with its horizon
  expect(screen.getByText("LEANS UP")).toBeTruthy();
  expect(screen.getByText("UP")).toBeTruthy();
  const five = screen.getByLabelText("The 5-minute forecast").textContent;
  expect(five).toContain("In 5 minutes");
  expect(five).toContain("₹1,083.40");
  expect(five).toContain("(4 min ahead)");
  expect(five).toContain("chance higher 58%");
  // the check: one correct, one wrong, each with what was said and what happened
  const box = screen.getByRole("group", { name: "The check: was each forecast correct?" });
  expect(box.querySelectorAll(".hz-v--ok")).toHaveLength(1);
  expect(box.querySelectorAll(".hz-v--no")).toHaveLength(1);
  expect(box.textContent).toContain("✓ Correct");
  expect(box.textContent).toContain("✗ Wrong");
  expect(box.textContent).toContain("it said UP (61%): 1,080.00 → 1,081.20");
  expect(box.textContent).toContain("It was 1,079.80 (−0.02%), inside its band");
  expect(box.textContent).toContain("last 20: 13 correct (65%)");
  expect(box.textContent).toContain("last 20: 11 correct (55%)");
  expect(box.textContent).toContain("every stock: 271 of 480 (56%)");
  expect(box.textContent).toContain("Learned from the last check (right or wrong, every check counts)");
  expect(box.textContent).toContain("A call that leans (55% or more one way) is CORRECT");
  // the reasons say which way each one pushes
  expect(screen.getByText(/the last 15 minutes were rising ↑/)).toBeTruthy();
  // the record lists both horizons with their verdicts
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  const table = screen.getByText("The last forecasts for SBIN, and what happened").nextSibling;
  expect(table.textContent).toContain("5 min: forecast → actual");
  expect(table.querySelectorAll(".hz-v--ok")).toHaveLength(1);
  expect(table.querySelectorAll(".hz-v--no")).toHaveLength(1);
});

test("before anything has been checked the check says so, and an older server's record still gets its verdict", async () => {
  const none = { minutes: 5, last: null, recent: [], n: 0, ok: 0, pct: null, all: { n: 0, ok: 0, pct: null } };
  api.mockResolvedValue({ ...view, checks: { rule: "The rule.", h5: none, h15: { ...none, minutes: 15 }, learned: null } });
  render(<HorizonCard symbol="SBIN" />);
  const box = await screen.findByRole("group", { name: "The check: was each forecast correct?" });
  expect(box.querySelectorAll(".hz-v--wait")).toHaveLength(2);
  expect(box.textContent).toContain("no forecast of this stock has reached its time yet");
  expect(screen.queryByLabelText("The 5-minute forecast")).toBeNull();
  // a record kept before the check existed (no v15): judged on the direction it stored
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  const table = screen.getByText("The last forecasts for SBIN, and what happened").nextSibling;
  expect(table.querySelectorAll(".hz-v--ok")).toHaveLength(1);
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
