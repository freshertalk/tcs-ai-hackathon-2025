import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

jest.mock("../api", () => ({ api: jest.fn(), peek: jest.fn(() => null) }));
jest.mock("../visible", () => ({ everyVisible: jest.fn(() => () => {}) }));
// eslint-disable-next-line import/first
import { api } from "../api";
// eslint-disable-next-line import/first
import { everyVisible } from "../visible";
// eslint-disable-next-line import/first
import ExpiryCalendar from "./ExpiryCalendar";

const row = (exchange, date, day, kind, status, over = {}) => ({ exchange, date, day, kind, what: kind === "monthly" ? (exchange === "NSE" ? "Monthly: NIFTY 50, NIFTY Bank and 219 stocks" : "Monthly: SENSEX and BANKEX") : exchange === "NSE" ? "NIFTY 50 weekly" : "SENSEX weekly", indices: [], stocks: 0, status, nominal: date, moved: false, why: "", uncertain: false, past: status === "passed", daysLeft: 0, ...over });
const view = (over = {}) => {
  const nse = [
    row("NSE", "2026-11-09", "Monday", "weekly", "passed", { nominal: "2026-11-10", moved: true, why: "Tuesday 2026-11-10 is a market holiday (Diwali — Balipratipada), so it expires on the trading day before", daysLeft: -11 }),
    row("NSE", "2026-11-17", "Tuesday", "weekly", "passed", { daysLeft: -3 }),
    row("NSE", "2026-11-23", "Monday", "monthly", "listed", { nominal: "2026-11-24", moved: true, why: "Tuesday 2026-11-24 is a market holiday (Prakash Gurpurb Sri Guru Nanak Dev), so it expires on the trading day before", daysLeft: 3 }),
    row("NSE", "2026-12-01", "Tuesday", "weekly", "listed", { daysLeft: 11 }),
    row("NSE", "2026-12-29", "Tuesday", "monthly", "scheduled", { daysLeft: 39 }),
  ];
  const bse = [row("BSE", "2026-11-19", "Thursday", "weekly", "passed", { daysLeft: -1 }), row("BSE", "2026-11-26", "Thursday", "monthly", "listed", { daysLeft: 6 }), row("BSE", "2026-12-03", "Thursday", "weekly", "listed", { daysLeft: 13 })];
  return {
    today: "2026-11-20",
    from: "2026-01-01",
    until: "2026-12-31",
    nextYear: false,
    source: { name: "The exchanges' own contract lists", url: "https://api.kite.trade/instruments/NFO", on: true, checkedAt: "2026-11-20T02:35:00.000Z", triedAt: "2026-11-20T02:35:00.000Z", error: "", busy: false },
    exchanges: [
      { id: "NSE", main: "NIFTY 50", weekday: "Tuesday", fromList: true, listedTo: "2026-12-29", next: nse[2], nextMonthly: nse[2], rows: nse },
      { id: "BSE", main: "SENSEX", weekday: "Thursday", fromList: true, listedTo: "2026-12-31", next: bse[1], nextMonthly: bse[1], rows: bse },
    ],
    ahead: [{ exchange: "NSE", date: "2027-01-25", day: "Monday", kind: "monthly" }],
    changes: [],
    holidaysKnown: true,
    note: "Next year's expiries are added by themselves on 24 December.",
    rule: "A date marked LISTED is read from the exchange's own contract list.",
    ...over,
  };
};
const dates = () => [...document.querySelectorAll(".xp-row .xp-date b")].map((x) => x.textContent);

beforeEach(() => {
  api.mockReset();
  everyVisible.mockClear();
});

test("every upcoming weekly and monthly expiry on both exchanges, by month, with where each date comes from — what has passed is hidden", async () => {
  api.mockResolvedValue(view());
  render(<ExpiryCalendar />);
  await waitFor(() => expect(screen.getByText("November 2026")).toBeTruthy());
  expect(screen.getByRole("heading", { name: "Expiry" })).toBeTruthy();
  // it is re-read the moment the server says the calendar changed
  expect(everyVisible.mock.calls[0][2].topics).toEqual(["expiry"]);
  // the next expiry of each exchange, up top
  const nexts = [...document.querySelectorAll(".xp-next")].map((x) => x.textContent);
  expect(nexts[0]).toMatch(/NSE · next expiry · Tuesdays.*Monday 23 Nov in 3 days.*Monthly: NIFTY 50, NIFTY Bank and 219 stocks/);
  expect(nexts[1]).toMatch(/BSE · next expiry · Thursdays.*Thursday 26 Nov in 6 days/);
  // the source, in words: the exchanges' own lists, no login, no AI, and when it was last read
  expect(document.querySelector(".xp-source.is-ok").textContent).toMatch(/From the exchanges’ own contract lists \(NSE and BSE derivatives, a public file — no login and no AI\)\. Last read .*read again by itself every morning and every twelve hours\./);
  // only what is still to come, both exchanges together, in date order
  expect(dates()).toEqual(["23 Nov", "26 Nov", "01 Dec", "03 Dec", "29 Dec"]);
  expect([...document.querySelectorAll(".xp-month h3")].map((x) => x.textContent)).toEqual(["November 2026", "December 2026"]);
  const first = document.querySelector(".xp-row");
  expect(first.className).toMatch(/is-monthly/);
  expect(first.querySelector(".xp-ex--nse").textContent).toBe("NSE");
  expect(first.querySelector(".xp-pill--monthly").textContent).toBe("monthly");
  expect(first.querySelector(".xp-pill--listed").textContent).toBe("listed");
  expect(first.querySelector(".xp-when").textContent).toBe("in 3 days");
  // a date the holiday moved says from when, and why
  expect(first.querySelector(".xp-moved").textContent).toBe("moved from Tue 24 Nov: a market holiday (Prakash Gurpurb Sri Guru Nanak Dev)");
  // beyond what the exchange has listed: scheduled, and it says so
  const last = [...document.querySelectorAll(".xp-row")].pop();
  expect(last.querySelector(".xp-pill--scheduled").textContent).toBe("scheduled");
  // next year: what is already listed, and when the whole year comes
  expect(screen.getByText(/Already listed by the exchanges for next year: NSE monthly Monday 25 Jan 2027\. The whole of next year is added here by itself on 24 December\./)).toBeTruthy();
});

test("“Show passed” brings back what has gone; the exchange and the kind can be chosen", async () => {
  api.mockResolvedValue(view());
  render(<ExpiryCalendar />);
  await waitFor(() => expect(screen.getByText("November 2026")).toBeTruthy());
  const box = screen.getByRole("checkbox");
  expect(box.checked).toBe(false);
  expect(box.closest("label").textContent).toMatch(/Show passed \(3\)/);
  fireEvent.click(box);
  expect(dates()).toEqual(["09 Nov", "17 Nov", "19 Nov", "23 Nov", "26 Nov", "01 Dec", "03 Dec", "29 Dec"]);
  const gone = document.querySelector(".xp-row.is-past");
  expect(gone.querySelector(".xp-pill--past").textContent).toBe("passed");
  expect(gone.querySelector(".xp-when")).toBeNull();
  fireEvent.click(box);
  // one exchange
  fireEvent.click(screen.getByText("BSE (Thursday)"));
  expect(dates()).toEqual(["26 Nov", "03 Dec"]);
  expect(screen.getByRole("checkbox").closest("label").textContent).toMatch(/Show passed \(1\)/);
  // one kind
  fireEvent.click(screen.getByText("NSE and BSE"));
  fireEvent.click(screen.getByText("Monthly"));
  expect(dates()).toEqual(["23 Nov", "26 Nov", "29 Dec"]);
  fireEvent.click(screen.getByText("Weekly"));
  expect(dates()).toEqual(["01 Dec", "03 Dec"]);
});

test("a date the exchange changed is said in words; “Check now” reads the lists this minute", async () => {
  const changed = view({ changes: [{ at: "2026-11-20T02:35:00.000Z", exchange: "NSE", kind: "date", nominal: "2026-12-22", was: "2026-12-22", now: "2026-12-21", text: "NSE: the expiry of the week of 2026-12-22 is now 2026-12-21 (it was 2026-12-22)." }] });
  api.mockImplementation((url, opts) => (opts && opts.method === "POST" ? Promise.resolve({ ...changed, refreshed: { ok: true, changed: 1, error: "" } }) : Promise.resolve(view())));
  render(<ExpiryCalendar />);
  await waitFor(() => expect(screen.getByText("Check now")).toBeTruthy());
  expect(document.querySelector(".xp-changes")).toBeNull();
  fireEvent.click(screen.getByText("Check now"));
  await waitFor(() => expect(document.querySelector(".xp-changes")).toBeTruthy());
  expect(api.mock.calls.some((c) => c[0] === "/api/admin/market/expiries/refresh" && c[1].method === "POST")).toBe(true);
  expect(document.querySelector(".xp-changes").textContent).toMatch(/Changed since it was first shown.*NSE: the expiry of the week of 2026-12-22 is now 2026-12-21 \(it was 2026-12-22\)\..*noticed/);
  expect(screen.getByText("Read just now: 1 date changed.")).toBeTruthy();
});

test("it says plainly when the lists could not be read, when they have not been read yet, and when a date may still move", async () => {
  const src = (over) => ({ ...view().source, ...over });
  api.mockResolvedValue(view({ source: src({ error: "NSE: the list of NFO contracts answered HTTP 429" }) }));
  const a = render(<ExpiryCalendar />);
  await waitFor(() => expect(document.querySelector(".xp-source.is-warn")).toBeTruthy());
  expect(document.querySelector(".xp-source").textContent).toMatch(/The latest read failed \(NSE: the list of NFO contracts answered HTTP 429\); the last good list is kept\./);
  a.unmount();

  api.mockResolvedValue(view({ source: src({ checkedAt: null }) }));
  const b = render(<ExpiryCalendar />);
  await waitFor(() => expect(screen.getByText("Not read yet.")).toBeTruthy());
  expect(document.querySelector(".xp-source").textContent).toMatch(/Until then every date is worked out from the exchange’s rule and the holiday calendar\./);
  b.unmount();

  api.mockResolvedValue(view({ source: src({ checkedAt: null, on: false }) }));
  const c = render(<ExpiryCalendar />);
  await waitFor(() => expect(screen.getByText("Worked out from the exchange’s rule.")).toBeTruthy());
  c.unmount();

  // the last week of December: next year is there; its holiday list is not, and the page says what that means
  const next = view({ until: "2027-12-31", nextYear: true, holidaysKnown: false, ahead: [], note: "It is the last week of December: the calendar now runs to the end of 2027." });
  next.exchanges[0].rows.push(row("NSE", "2027-02-23", "Tuesday", "monthly", "scheduled", { uncertain: true, daysLeft: 95 }));
  api.mockResolvedValue(next);
  render(<ExpiryCalendar />);
  await waitFor(() => expect(screen.getByText("February 2027")).toBeTruthy());
  expect(screen.getByText(/to 31 Dec 2027\. It is the last week of December: the calendar now runs to the end of 2027\./)).toBeTruthy();
  expect([...document.querySelectorAll(".xp-pill--scheduled")].pop().textContent).toBe("scheduled · may move");
  expect(screen.getByText(/The holiday list for 2027 is not in the desk yet/)).toBeTruthy();
  expect(screen.queryByText(/Already listed by the exchanges for next year/)).toBeNull();
});

test("when it cannot be read at all, the reason is shown", async () => {
  api.mockRejectedValue(new Error("Session expired. Sign in again."));
  render(<ExpiryCalendar />);
  await waitFor(() => expect(screen.getByText("Session expired. Sign in again.")).toBeTruthy());
});
