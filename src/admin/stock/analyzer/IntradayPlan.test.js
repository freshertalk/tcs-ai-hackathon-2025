import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import IntradayPlan, { nextTradingDay, sessionOf } from "./IntradayPlan";

jest.mock("../../api", () => ({ api: jest.fn(() => new Promise(() => {})) }));

const stats = (trades, winRate, avgR, verdict) => ({ trades, wins: Math.round((trades * winRate) / 100), losses: trades - Math.round((trades * winRate) / 100), winRate, avgR, totalR: avgR * trades, verdict });

const PLAN = {
  available: true,
  symbol: "SBIN",
  asOf: "2026-11-23",
  nextSession: "2026-11-24",
  marketOpen: false,
  last: 1000,
  outlookBasis: "full",
  decision: {
    kind: "long",
    why: "the lean and the measured record agree",
    headline: "LONG above ₹1012.4 after 9:30 — stop ₹1004.1, target ₹1024.8",
    strength: 72,
    for: ["Trend: above the 20-day average"],
    against: ["Momentum: RSI 71 (falling)"],
    checklist: ["Price trades above ₹1012.4 after 9:30 — a spike in the first 15 minutes does not count.", "Book at least part at ₹1024.8; everything out by 3:15 PM."],
  },
  lean: { call: "long-bias", score: 40, agreement: 70, headline: "Next session leans UP (70% of the evidence agrees)", chartScore: 35, chartBucket: "up", split: false },
  odds: { now: "up", up: { sessions: 60, closedUpPct: 58, aboveOpenPct: 55, avgPct: 0.3 }, down: { sessions: 30 }, flat: { sessions: 100 } },
  open: { expected: 1005, low: 1001, high: 1009, gapPct: 0.5, beta: 1.2, cue: 0.42, basis: "GIFT Nifty is +0.42%…" },
  range: { low: 995, high: 1020, wideLow: 988, wideHigh: 1030, typicalPct: 2.1, basis: "a normal day…" },
  plans: {
    long: { side: "long", entry: 1012.4, stop: 1004.1, targets: [1024.8, 1033.2], riskPerShare: 8.3, riskPct: 0.82, rewardToRisk: 1.5 },
    short: { side: "short", entry: 990.6, stop: 998.9, targets: [978.2, 969.9], riskPerShare: 8.3, riskPct: 0.84, rewardToRisk: 1.5 },
    orb: { rule: "Break of the 9:15–9:30 high or low after 9:30…", typicalRangePct: 0.6 },
  },
  ladder: [
    { label: "R1", price: 1022, kind: "res", away: 1.7 },
    { label: "Long trigger", price: 1012.4, kind: "long", away: 0.7 },
    { label: "Expected open", price: 1005, kind: "open", away: 0 },
    { label: "Short trigger", price: 990.6, kind: "short", away: -1.4 },
  ],
  habits: { sessions: 98, from: "2026-07-01", to: "2026-11-23", rangePct: { median: 2.1, low: 1.2, high: 3.4 }, openingRange: { medianPct: 0.6, upPct: 50, downPct: 45, nonePct: 5, heldPct: 61, avgRun: 1.8, note: "The 9:15–9:30 range broke on 95% of days…" }, firstHourExtremePct: 70, highTime: {}, lowTime: {}, trendDayPct: 30, vwapHoldPct: 68, gapFillPct: 55, gaps: 40, openDrivePct: 52 },
  record: { sessions: 98, costPct: 0.1, lean: { ...stats(30, 57, 0.18, "positive, not proven"), long: stats(20, 60, 0.22, "positive, not proven"), short: stats(10, 50, 0.1, "positive, not proven") }, both: { ...stats(80, 48, 0.02, "positive, not proven"), long: stats(40, 50, 0.05, "positive, not proven"), short: stats(40, 45, -0.01, "did not pay") }, orb: stats(85, 44, -0.04, "did not pay"), recent: [{ date: "2026-11-20", side: "long", at: "09:45", entry: 990, exit: 1002, r: 1.4, how: "target" }], recentPolicy: "lean", rule: "Every past session…" },
  stale: false,
};

test("the next trading day skips weekends and the NSE holidays on file", () => {
  expect(nextTradingDay("2026-11-20")).toBe("2026-11-23"); // Friday -> Monday
  expect(nextTradingDay("2026-11-23")).toBe("2026-11-25"); // 24 Nov 2026 is Guru Nanak Jayanti
  expect(sessionOf(PLAN)).toBe("2026-11-25");
  expect(sessionOf({ ...PLAN, marketOpen: true, nextSession: "2026-11-23" })).toBe("2026-11-23");
});

test("the plan shows the decision, the forecast, both sides, the levels and a checklist that ticks", () => {
  render(<IntradayPlan symbol="SBIN" data={PLAN} />);
  expect(screen.getByText("LONG")).toBeTruthy();
  expect(screen.getByText(/LONG above ₹1012.4 after 9:30/)).toBeTruthy();
  expect(screen.getByText(/for Wed,? 25 Nov/)).toBeTruthy();
  expect(screen.getAllByText("Expected open").length).toBeGreaterThan(0);
  expect(screen.getByText(/closed up 58% of 60/)).toBeTruthy();
  expect(screen.getByText("60% won")).toBeTruthy();
  expect(screen.getByText("the plan")).toBeTruthy();
  expect(screen.getByText("Levels for the day")).toBeTruthy();
  const box = screen.getAllByRole("checkbox")[0];
  expect(box.checked).toBe(false);
  fireEvent.click(box);
  expect(box.checked).toBe(true);
  expect(screen.getByText(/The plan's rules, replayed on past sessions/)).toBeTruthy();
  expect(screen.getByText(/not a promise, and not advice/)).toBeTruthy();
});

test("without a record it says what is missing; an unavailable plan gives its reason", () => {
  const { rerender } = render(<IntradayPlan symbol="SBIN" data={{ ...PLAN, record: null, habits: null, reason: "Too few past sessions of 5-minute bars" }} />);
  expect(screen.getByText(/Too few past sessions of 5-minute bars/)).toBeTruthy();
  expect(screen.getByText("needs 5-minute history")).toBeTruthy();
  rerender(<IntradayPlan symbol="SBIN" data={{ available: false, reason: "Fewer than 60 daily bars" }} />);
  expect(screen.getByText(/Fewer than 60 daily bars/)).toBeTruthy();
});
