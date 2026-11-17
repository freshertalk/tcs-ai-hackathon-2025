import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DailyGoalCard, GoalBanner, GoalPill } from "./DailyGoal";

jest.mock("../../api", () => ({ api: jest.fn(() => Promise.resolve({ config: {} })) }));

const base = { available: true, enabled: true, day: "2026-11-16", base: 100000, target: 3000, stop: 1500, pnl: 1100, peak: 2600, trough: 0, floor: 1300, protectFrom: 1000, protecting: true, gaveBackPct: 58, progressPct: 37, open: 2, positions: [], events: [], config: { targetPct: 3, stopPct: 1.5, protectFromPct: 1, keepPct: 50, posGivebackPct: 50, posMinGain: 500, repeatMin: 10, notify: true, applyToGuard: false, enabled: true } };
const giveback = { ...base, state: "giveback", level: "warning", title: "You have given back 58% of today's best", text: "Today's best was +₹2,600; now +₹1,100. Keep at least ₹1,300 (50% of the best).", action: "Book profits or tighten every stop now. Waiting for more is the habit that costs you." };

beforeEach(() => window.localStorage.clear());

test("the top bar's pill shows today against the target, and warns while profits are given back", () => {
  render(<GoalPill goal={giveback} onClick={() => {}} />);
  const pill = screen.getByRole("button");
  expect(pill.className).toMatch(/dg-pill--warning/);
  expect(pill.textContent).toMatch(/\+₹1,100/);
  expect(pill.textContent).toMatch(/₹3,000/);
});

test("the banner says what happened and what to do; Got it quiets it until it repeats", async () => {
  render(<GoalBanner goal={giveback} onOpen={() => {}} />);
  expect(screen.getByRole("alert").textContent).toMatch(/given back 58%/);
  expect(screen.getByText(/Waiting for more is the habit/)).toBeTruthy();
  fireEvent.click(screen.getByText("Got it"));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull()); // it slides away first
});

test("on plan, there is no banner; a position giving back its gain raises one with the price that keeps half", () => {
  const ok = { ...base, state: "ok", level: "info", title: "On plan", text: "", action: "" };
  const { rerender } = render(<GoalBanner goal={ok} />);
  expect(screen.queryByRole("alert")).toBeNull();
  rerender(<GoalBanner goal={{ ...ok, positions: [{ key: "NSE:SBIN:MIS", symbol: "SBIN", text: "SBIN: was +₹1,200, now +₹500. A stop at ₹806.00 keeps half the best gain." }] }} />);
  expect(screen.getByRole("alert").textContent).toMatch(/SBIN is giving back its gain/);
  expect(screen.getByRole("alert").textContent).toMatch(/A stop at ₹806.00/);
});

test("the card shows the numbers and the settings, with the lock-new-trades switch off by default", () => {
  render(<DailyGoalCard goal={giveback} />);
  expect(screen.getByText("GIVING BACK")).toBeTruthy();
  expect(screen.getByText("Keep at least")).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Settings"));
  expect(screen.getByText(/Lock new trades at the target and the stop/).querySelector("input") || screen.getByLabelText(/Lock new trades/)).toBeTruthy();
  expect(screen.getByLabelText(/Lock new trades/).checked).toBe(false);
  expect(screen.getByText("Save the daily goal")).toBeTruthy();
});

test("the banner keeps one line once the page is scrolled, and tells the page how tall it is", () => {
  render(<GoalBanner goal={giveback} onOpen={() => {}} />);
  const el = screen.getByRole("alert");
  expect(el.className).not.toMatch(/is-compact/);
  expect(document.documentElement.style.getPropertyValue("--dg-h")).not.toBeUndefined();
  Object.defineProperty(window, "scrollY", { value: 200, configurable: true });
  fireEvent.scroll(window);
  expect(screen.getByRole("alert").className).toMatch(/is-compact/);
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
});
