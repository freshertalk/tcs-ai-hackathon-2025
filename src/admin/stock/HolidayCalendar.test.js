import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { api } from "../api";
import HolidayCalendar from "./HolidayCalendar";

jest.mock("../api", () => ({ api: jest.fn() }));

// NSE's 2026 list as the server keeps it (two entries are enough here), read 23 Nov 2026
const nse = (over = {}) => ({
  sourceName: "NSE",
  sourceUrl: "https://www.nseindia.com/resources/exchange-communication-holidays",
  years: {
    2026: {
      entries: [
        { date: "2026-11-24", name: "Prakash Gurpurb Sri Guru Nanak Dev", kind: "closed", note: "" },
        { date: "2026-12-25", name: "Christmas", kind: "closed", note: "" },
      ],
      fetchedAt: "2026-11-23T14:28:00.000Z",
      changedAt: "2026-11-23T14:28:00.000Z",
    },
  },
  lastSuccessAt: "2026-11-23T14:28:00.000Z",
  lastError: "",
  ...over,
});
const answer = (n) => ({ nasdaq: { sourceName: "Nasdaq Trader", sourceUrl: "x", years: {}, lastSuccessAt: null, lastError: "" }, nse: n });

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-11-23T14:05:00Z")); // Monday 23 Nov 2026, 7:35 PM IST
});
afterEach(() => {
  act(() => {
    jest.advanceTimersByTime(1500); // let the shared request between the two cards expire (it is held for a second)
  });
  jest.useRealTimers();
});
const settle = () => act(async () => {
  await Promise.resolve();
  await Promise.resolve();
});

test("the BSE / NSE card shows NSE's own list from the server, verified, with its Check now", async () => {
  api.mockImplementation((url) => Promise.resolve(url.includes("/nse/refresh") ? { nse: nse({ lastSuccessAt: "2026-11-23T14:40:00.000Z" }) } : answer(nse())));
  render(<HolidayCalendar market="india" />);
  await settle();
  expect(api).toHaveBeenCalledWith("/api/admin/stock/holidays");
  expect(screen.getByText("Verified with NSE’s official list")).toBeTruthy();
  expect(screen.getAllByText("Prakash Gurpurb Sri Guru Nanak Dev").length).toBeGreaterThan(0);
  expect(screen.getByText(/Next:/).textContent).toMatch(/tomorrow/);
  fireEvent.click(screen.getByRole("button", { name: "Check now" }));
  await settle();
  expect(api).toHaveBeenCalledWith("/api/admin/stock/holidays/nse/refresh", { method: "POST" });
  expect(screen.getByText("Verified with NSE’s official list")).toBeTruthy(); // the merged answer keeps the list
});

test("without NSE's copy the hand-checked table is shown, and the card says NSE's list has not been read", async () => {
  api.mockImplementation(() => Promise.resolve(answer(nse({ years: {}, lastSuccessAt: null, lastError: "NSE answered HTTP 403" }))));
  render(<HolidayCalendar market="india" />);
  await settle();
  expect(screen.getByText(/NSE’s own list has not been read yet/)).toBeTruthy();
  expect(screen.getByText(/NSE answered HTTP 403/)).toBeTruthy();
  expect(screen.getByText("Checked by hand")).toBeTruthy();
  expect(screen.getAllByText("Prakash Gurpurb Sri Guru Nanak Dev").length).toBeGreaterThan(0); // from the table
});
