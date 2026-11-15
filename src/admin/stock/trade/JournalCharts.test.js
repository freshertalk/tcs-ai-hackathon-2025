import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { Dashboard, Hero, Retro } from "./JournalCharts";

const s = { trades: 40, wins: 22, losses: 18, winRate: 55, net: 5400, gross: 9000, charges: 3600, avgWin: 600, avgLoss: -400, profitFactor: 1.8, bestStreak: 5, worstStreak: 3, maxDrawdown: 2100, tradingDays: 18, by: { symbol: [{ key: "SBIN", net: 4000, trades: 10, winRate: 70 }, { key: "INFY", net: -900, trades: 6, winRate: 33 }], weekday: [{ key: "Mon", net: 1200, trades: 8, winRate: 60 }], hour: [{ key: "10:00", net: 3000, trades: 12, winRate: 66 }], mistake: [] } };
const a = {
  summary: { bestDay: { day: "2026-11-05", net: 1900 }, worstDay: { day: "2026-11-09", net: -800 } },
  prev: { trades: 20, net: 1000, winRate: 45, fromDay: "2026-09-01", toDay: "2026-09-30" },
  days: [{ date: "2026-11-05", trades: 3, wins: 2, grossProfit: 2500, grossLoss: 400, charges: 200, net: 1900 }, { date: "2026-11-09", trades: 2, wins: 0, grossProfit: 0, grossLoss: 700, charges: 100, net: -800 }],
  curve: [{ date: "2026-11-05", equity: 1900, drawdown: 0 }, { date: "2026-11-09", equity: 1100, drawdown: -800 }],
  costs: { brokerage: 1500, stt: 900, exchange: 300, sebi: 10, gst: 600, stamp: 200, dp: 90 },
  holding: [{ key: "lt5", label: "Under 5 min", trades: 10, wins: 4, net: -300, winRate: 40 }, { key: "15to60", label: "15–60 min", trades: 20, wins: 13, net: 4100, winRate: 65 }],
  spread: [{ key: "l0", label: "Lost up to ₹500", trades: 15, net: -2500, tone: "down" }, { key: "w0", label: "Made up to ₹500", trades: 18, net: 4000, tone: "up" }],
  rolling: [{ date: "2026-11-05", winRate: 60, n: 20 }, { date: "2026-11-09", winRate: 55, n: 20 }],
  mix: [{ key: "intraday", label: "Intraday (same day)", trades: 35, wins: 20, net: 5000 }, { key: "delivery", label: "Delivery (kept overnight)", trades: 5, wins: 2, net: 400 }],
  sides: [{ key: "long", label: "Buy first (long)", trades: 30, wins: 18, net: 6000 }],
  health: { score: 66, label: "Mixed", enough: true, parts: [{ key: "wins", label: "How often you win", score: 83, value: "55% of trades won" }] },
};

test("the result says in plain words what happened, and the Retrospective button is there", () => {
  const run = jest.fn();
  render(<Hero s={s} a={a} label="This month (Nov)" period={{ fromDay: "2026-11-01", toDay: "2026-11-16" }} onRetro={run} busy={false} />);
  expect(screen.getByText("You made")).toBeTruthy();
  expect(screen.getByText("₹5,400")).toBeTruthy();
  expect(screen.getByText(/better than the 30 days before/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Retrospective analysis/ }));
  expect(run).toHaveBeenCalled();
});

test("the dashboard: health gauge, win ring, costs and trade-kind rings with legends, columns and plain notes", () => {
  render(<Dashboard s={s} a={a} />);
  expect(screen.getByRole("img", { name: /Trading health 66 out of 100: Mixed/ })).toBeTruthy();
  expect(screen.getByRole("img", { name: /55% 22 of 40 won/ })).toBeTruthy();
  expect(screen.getByRole("img", { name: /Costs by kind: Brokerage/ })).toBeTruthy();
  expect(screen.getByText("STT (securities tax)")).toBeTruthy();
  expect(screen.getByText("SEBI fee and DP charge")).toBeTruthy();
  expect(screen.getByRole("img", { name: /Kinds of trades: Intraday \(same day\) 88%/ })).toBeTruthy();
  expect(screen.getByText("15–60 min")).toBeTruthy();
  expect(screen.getByText("Made up to ₹500")).toBeTruthy();
  expect(screen.getByText("10am–11am")).toBeTruthy();
  expect(screen.getAllByText(/ⓘ/).length).toBeGreaterThan(8);
});

test("the retrospective shows the five parts, and an empty part says so", () => {
  const r = { id: "r1", period: { label: "This month (Nov)", fromDay: "2026-11-01", toDay: "2026-11-16" }, verdict: "good", headline: "A good period: you made +₹5,400 after costs.", score: 66, summary: { net: 5400, trades: 40, winRate: 55 }, prev: { net: 1000, trades: 20, winRate: 45 }, wentWell: [{ text: "SBIN made you +₹4,000 in 10 trades." }], wentWrong: [], keepDoing: [{ text: "Trading at 10 AM–11 AM — your best time." }], stopDoing: [], tryNext: [{ text: "Tag your trades." }], note: "Worked out from your own trades. Not investment advice." };
  const close = jest.fn();
  render(<Retro r={r} list={[{ id: "r1" }, { id: "r0", at: "2026-11-01T00:00:00Z", period: { label: "Oct" }, net: -200 }]} onOpen={() => {}} onClose={close} />);
  for (const t of ["What went well", "What went wrong", "Keep doing", "Stop doing", "Try next"]) expect(screen.getByText(t)).toBeTruthy();
  expect(screen.getByText("SBIN made you +₹4,000 in 10 trades.")).toBeTruthy();
  expect(screen.getByText("Nothing stood out as a problem.")).toBeTruthy();
  expect(screen.getByText(/Before this period: \+₹1,000/)).toBeTruthy();
  expect(screen.getByText(/Earlier \(1\)/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(close).toHaveBeenCalled();
});
