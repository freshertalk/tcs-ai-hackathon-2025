import React from "react";
import { act, render, screen } from "@testing-library/react";
import { api } from "../../api";
import { useClock } from "./TopBar";

jest.mock("../../api", () => ({ api: jest.fn() }));
jest.mock("react-router-dom", () => {
  const { createElement } = require("react");
  return { Link: ({ to, children, ...rest }) => createElement("a", { href: to, ...rest }, children), useSearchParams: () => [new URLSearchParams(), () => {}] };
});

const IST = 5.5 * 3600 * 1000;
const ist = (s) => Date.parse(`${s}:00Z`) - IST;

function Probe() {
  const c = useClock();
  return <p data-testid="clock">{`${c.state}|${c.holiday || ""}`}</p>;
}

afterEach(() => jest.useRealTimers());

test("on an NSE holiday the terminal clock says closed (holiday), not open, at 10 AM on a Tuesday", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(ist("2026-11-24T10:00"));
  api.mockImplementation(() => Promise.resolve({ today: { date: "2026-11-24", trading: false, holiday: "Prakash Gurpurb Sri Guru Nanak Dev", special: "" } }));
  render(<Probe />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(api).toHaveBeenCalledWith("/api/admin/market/next-session");
  expect(screen.getByTestId("clock").textContent).toBe("closed|Prakash Gurpurb Sri Guru Nanak Dev");
});

test("on a trading day it goes by the clock", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(ist("2026-11-25T10:00"));
  api.mockImplementation(() => Promise.resolve({ today: { date: "2026-11-25", trading: true, holiday: "", special: "" } }));
  render(<Probe />);
  await act(async () => {
    jest.advanceTimersByTime(61000); // past the once-a-minute gap of the shared ask
    await Promise.resolve();
  });
  expect(screen.getByTestId("clock").textContent).toBe("open|");
});
