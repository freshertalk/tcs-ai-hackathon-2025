import React from "react";
import { act, render, screen } from "@testing-library/react";
import { api } from "../api";
import { clockStatus, exchangeNow, resetExchangeClock, syncClock, useExchangeNow } from "./exchangeClock";

jest.mock("../api", () => ({ api: jest.fn() }));

afterEach(() => {
  resetExchangeClock();
  jest.useRealTimers();
});

test("measures the offset NTP-style: the server's handling time is taken out", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-11-23T14:00:00.000Z"));
  // this computer is 2.5 s slow; the request takes 40 ms each way and the server spends 10 ms on it
  api.mockImplementation(() => {
    const t0 = Date.now();
    jest.setSystemTime(t0 + 90); // the answer arrives 90 ms later (40 + 10 + 40)
    return Promise.resolve({ t1: t0 + 2500 + 40, t2: t0 + 2500 + 50, source: "ntp", accuracyMs: 5 });
  });
  await syncClock();
  const st = clockStatus();
  expect(st.synced).toBe(true);
  expect(st.offset).toBeCloseTo(2500, 6);
  expect(st.rtt).toBe(80); // 90 ms less the server's 10 ms
  expect(st.accuracy).toBe(45); // half the round trip + the server's own ±5 ms
  expect(exchangeNow() - Date.now()).toBeCloseTo(2500, 6);
  expect(st.source).toMatch(/India's time servers/);
});

test("keeps the computer's clock (and says so) when the server cannot be reached", async () => {
  api.mockImplementation(() => Promise.reject(new Error("offline")));
  await syncClock();
  const st = clockStatus();
  expect(st.synced).toBe(false);
  expect(st.offset).toBe(0);
  expect(st.error).toMatch(/offline/);
});

test("a clock on the page turns over on the edge of the exchange's second", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-11-23T14:00:00.700Z"));
  api.mockImplementation(() => Promise.resolve({ t1: Date.now() + 500, t2: Date.now() + 500, source: "ntp", accuracyMs: 1 }));
  function Probe() {
    const t = useExchangeNow(1000);
    return <p data-testid="t">{new Date(t).toISOString().slice(17, 23)}</p>;
  }
  render(<Probe />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  // re-measured: 14:00:00.700 here is 14:00:01.200 on the exchange
  expect(screen.getByTestId("t").textContent).toBe("01.200");
  act(() => {
    jest.advanceTimersByTime(802); // to the next exchange second's edge (+2 ms)
  });
  expect(screen.getByTestId("t").textContent).toBe("02.002");
});
