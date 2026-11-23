import React from "react";
import { act, render, screen } from "@testing-library/react";
import NextSession, { countdown, sessionCard } from "./NextSession";

const IST = 5.5 * 3600 * 1000;
const ist = (s) => Date.parse(`${s}:00Z`) - IST;

// the server's answer for Monday 23 Nov 2026, 7:35 PM IST (server/market/next-session.js), NSE's list read and matching
const answer = (over = {}) => ({
  at: new Date(ist("2026-11-23T19:35")).toISOString(),
  nowClock: "7:35 PM",
  today: { date: "2026-11-23", weekday: "Monday", short: "Mon 23 Nov", status: "closed-for-day", text: "Closed for the day (closed at 3:30 PM)", trading: true, opensAt: ist("2026-11-23T09:15"), closesAt: ist("2026-11-23T15:30"), openClock: "9:15 AM", closeClock: "3:30 PM" },
  next: {
    date: "2026-11-25",
    weekday: "Wednesday",
    label: "Wednesday, 25 November 2026",
    short: "Wed 25 Nov",
    daysAway: 2,
    special: "",
    preOpenAt: ist("2026-11-25T09:00"),
    opensAt: ist("2026-11-25T09:15"),
    closesAt: ist("2026-11-25T15:30"),
    preOpenClock: "9:00 AM",
    openClock: "9:15 AM",
    closeClock: "3:30 PM",
    closingAuction: { text: "F&O stocks: continuous trading till 3:15 PM, closing auction 3:15 PM–3:35 PM" },
  },
  session: { date: "2026-11-25", isToday: false, phase: "upcoming" },
  skipped: [{ date: "2026-11-24", weekday: "Tuesday", short: "Tue 24 Nov", reason: "holiday", name: "Prakash Gurpurb Sri Guru Nanak Dev" }],
  upcoming: [
    { date: "2026-11-24", short: "Tue 24 Nov", name: "Prakash Gurpurb Sri Guru Nanak Dev", daysAway: 1 },
    { date: "2026-12-25", short: "Fri 25 Dec", name: "Christmas", daysAway: 32 },
  ],
  calendar: { source: "nse", sourceUrl: "https://www.nseindia.com/resources/exchange-communication-holidays", lastSuccessAt: new Date(ist("2026-11-23T19:30")).toISOString(), lastError: "" },
  verify: { status: "match", text: "Matches NSE's official calendar." },
  refreshAt: ist("2026-11-24T00:00"),
  ...over,
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(ist("2026-11-23T19:35"));
});
afterEach(() => {
  jest.useRealTimers();
});

test("shows the next trading day after a holiday, its times, the skipped holiday and the NSE check", () => {
  render(<NextSession ns={{ status: "ready", data: answer(), skew: 0 }} place="main" />);
  expect(screen.getByRole("heading", { name: "Next trading day" })).toBeTruthy();
  expect(screen.getByText("Wednesday, 25 November 2026")).toBeTruthy();
  const times = screen.getByText("Pre-open").closest("p");
  expect(times.textContent).toMatch(/Pre-open 9:00 AM/);
  expect(times.textContent).toMatch(/Opens 9:15 AM/);
  expect(times.textContent).toMatch(/Closes 3:30 PM/);
  expect(times.textContent).toMatch(/IST/);
  // Tue 24 Nov is shut: the reason is on screen
  const skips = screen.getByLabelText("Days the market is shut before then");
  expect(skips.textContent).toMatch(/Tue 24 Nov market holiday · Prakash Gurpurb Sri Guru Nanak Dev/);
  expect(skips.textContent).toMatch(/Next holiday: Fri 25 Dec · Christmas · in 32 days/);
  // the countdown to Wednesday 9:15 AM: 37 h 40 min = 1 d 13 h
  expect(screen.getByText("1 d 13 h")).toBeTruthy();
  // today's state and the check against NSE's own list
  expect(screen.getByText(/Closed for the day/).textContent).toMatch(/Today, Mon 23 Nov/);
  const nse = screen.getByText("NSE’s official calendar").closest("a");
  expect(nse.getAttribute("href")).toBe("https://www.nseindia.com/resources/exchange-communication-holidays");
  expect(screen.getByText(/checked 7:30 PM/)).toBeTruthy();
  expect(screen.getByText("Holiday list").closest("a").getAttribute("href")).toBe("/me/stock-report?view=calendar");
});

test("the countdown moves with the clock", () => {
  render(<NextSession ns={{ status: "ready", data: answer(), skew: 0 }} />);
  expect(screen.getByText("1 d 13 h")).toBeTruthy();
  act(() => {
    jest.setSystemTime(ist("2026-11-25T08:40"));
    jest.advanceTimersByTime(20000);
  });
  expect(screen.getByText("34 min")).toBeTruthy(); // 9:15 − 8:40:20
  // within the hour it ticks every second
  act(() => {
    jest.setSystemTime(ist("2026-11-25T09:14") + 30000);
    jest.advanceTimersByTime(1000);
  });
  expect(screen.getByText("under a minute")).toBeTruthy();
});

test("says so when the calendar is not verified, and when a special session is next", () => {
  render(
    <NextSession
      ns={{
        status: "ready",
        skew: 0,
        data: answer({ verify: { status: "unverified", text: "NSE's own list has not been read on this server yet; the built-in table is in use." }, next: { ...answer().next, special: "Union Budget — special trading session" } }),
      }}
    />
  );
  expect(screen.getByText(/NSE's own list has not been read on this server yet/)).toBeTruthy();
  expect(screen.getByText("Special session: Union Budget — special trading session")).toBeTruthy();
});

test("nothing is drawn when the server cannot answer; a placeholder while it is asked", () => {
  const { container, rerender } = render(<NextSession ns={{ status: "error", data: null, skew: 0 }} />);
  expect(container.innerHTML).toBe("");
  rerender(<NextSession ns={{ status: "loading", data: null, skew: 0 }} />);
  expect(container.querySelector("[aria-busy='true']")).toBeTruthy();
});

test("the status row's NSE card reads the same answer (a holiday tomorrow names the day after)", () => {
  const now = ist("2026-11-23T19:35");
  expect(sessionCard({ data: answer(), skew: 0 }, now)).toEqual({ id: "closed", label: "Closed", sub: "opens Wed 25 Nov at 9:15 AM IST" });
  const open = answer({ today: { ...answer().today, status: "open" } });
  expect(sessionCard({ data: open, skew: 0 }, ist("2026-11-23T13:00")).sub).toBe("closes in 2 h 30 min · 3:30 PM IST");
  const hol = answer({ today: { date: "2026-11-24", short: "Tue 24 Nov", trading: false, status: "holiday", holiday: "Prakash Gurpurb Sri Guru Nanak Dev", text: "Market holiday · Prakash Gurpurb Sri Guru Nanak Dev" }, next: { ...answer().next, daysAway: 1 } });
  expect(sessionCard({ data: hol, skew: 0 }, now)).toEqual({ id: "closed", label: "Holiday", sub: "opens tomorrow at 9:15 AM IST" });
  expect(sessionCard({ data: null }, now)).toBeNull();
});

test("today's state flips on the clock without asking the server again", () => {
  const morning = answer({ today: { ...answer().today, preOpenAt: ist("2026-11-23T09:00"), preOpenClock: "9:00 AM" } });
  jest.setSystemTime(ist("2026-11-23T08:59") + 58000);
  render(<NextSession ns={{ status: "ready", data: morning, skew: 0 }} />);
  expect(screen.getByText(/Opens today at 9:15 AM/)).toBeTruthy();
  act(() => {
    jest.advanceTimersByTime(3000); // 9:00:01
  });
  expect(screen.getByText(/Pre-open now/)).toBeTruthy();
  act(() => {
    jest.advanceTimersByTime(15 * 60000); // 9:15:01
  });
  expect(screen.getByText(/Market open · closes at 3:30 PM/)).toBeTruthy();
});

test("countdown wording", () => {
  expect(countdown(30 * 1000)).toBe("under a minute");
  expect(countdown(4 * 60000)).toBe("4 min");
  expect(countdown(125 * 60000)).toBe("2 h 5 min");
  expect(countdown(120 * 60000)).toBe("2 h");
  expect(countdown(38 * 3600000)).toBe("1 d 14 h");
  expect(countdown(-5)).toBe("now");
});
