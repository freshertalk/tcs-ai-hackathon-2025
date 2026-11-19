import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import DataCard from "./DataCard";

const mockApi = jest.fn();
let mockRole = "superadmin";
jest.mock("./api", () => ({ api: (...a) => mockApi(...a) }));
jest.mock("./visible", () => ({ everyVisible: () => () => {} }));
jest.mock("./auth", () => ({ useAuth: () => ({ user: { role: mockRole } }) }));

const recorder = {
  state: "recording",
  detail: "reading every stock once a minute",
  what: "Every minute, 9:15 to 15:30: price, volume, the quantity waiting to buy and to sell, and open interest.",
  today: {
    date: "2026-11-19",
    taken: 142,
    expected: 143,
    stocks: 104,
    futures: 99,
    last: "2026-11-19T06:07:05.000Z",
  },
  stored: {
    sessions: 12,
    from: "2026-11-04",
    to: "2026-11-19",
    kb: 11400,
    minutes: 4280,
  },
  days: [{ date: "2026-11-19", taken: 142, kb: 380 }],
  learner: {
    available: true,
    on: false,
    days: 3,
    rows: 20700,
    evidence: 13800,
    needed: 20000,
    gain15: 0.0011,
    gains: [
      { minutes: 5, gain: 0.004 },
      { minutes: 15, gain: 0.0011 },
      { minutes: 30, gain: -0.0002 },
    ],
    waiting: 1,
    skipped: [],
    drivers: [],
    lessons: [
      "3 recorded sessions learned (20,700 forecasts set against the order book and open interest of their minute), the last on 2026-11-18.",
      "Weights are fitted but not proven: 13,800 forecasts have been scored out of sample and 20,000 are needed before they may be used.",
    ],
    history: [],
  },
  error: "",
};
const vault = {
  settings: { auto: true, keep: 5 },
  backups: [
    {
      file: "drishtiai-backup-2026-11-18-161000.ndjson.gz",
      bytes: 5 * 1024 * 1024,
      at: "2026-11-18T10:40:00.000Z",
      href: "/api/admin/vault/backups/drishtiai-backup-2026-11-18-161000.ndjson.gz",
    },
  ],
  totalKb: 5120,
  where: "on the server's disk (data/backups)",
  holds: "Everything in the database.",
  restore: "A restore is done with the server stopped: node server/restore.js data/backups/<file>",
  error: "",
  datasets: [
    {
      group: "Recorded market data",
      items: [
        {
          id: "tape",
          title: "Recorded tape: every stock, every minute",
          what: "Every minute.",
          rows: 12,
          unit: "sessions",
          kb: 11400,
          links: [
            {
              label: "All sessions (CSV, compressed)",
              href: "/api/admin/vault/tape.csv.gz",
            },
          ],
          days: [
            {
              date: "2026-11-19",
              minutes: 142,
              kb: 380,
              href: "/api/admin/vault/tape/2026-11-19",
            },
          ],
        },
        {
          id: "robot_history",
          title: "NIFTY 100 price history",
          what: "A year of 5-minute bars.",
          rows: 1800000,
          unit: "bars",
          kb: 15000,
          stocks: ["INFY", "TCS"],
          links: [
            {
              label: "All stocks (CSV, compressed)",
              href: "/api/admin/vault/history.csv.gz",
            },
          ],
        },
      ],
    },
    {
      group: "Forecasts and their scores",
      items: [
        {
          id: "horizon_forecasts",
          title: "15-minute forecasts made live",
          what: "",
          rows: 480,
          unit: "records",
          kb: null,
          links: [
            {
              label: "CSV",
              href: "/api/admin/vault/collection/horizon_forecasts?format=csv",
            },
            {
              label: "JSON",
              href: "/api/admin/vault/collection/horizon_forecasts?format=json",
            },
          ],
        },
        {
          id: "open_forecasts",
          title: "Opening-price forecasts",
          what: "",
          rows: 0,
          unit: "records",
          kb: null,
          links: [],
        },
      ],
    },
  ],
  recorder,
};

beforeEach(() => {
  mockApi.mockReset();
  mockRole = "superadmin";
});

test("the owner sees what is recorded and learned, a download for every dataset, and the backups — and can back up now", async () => {
  mockApi.mockImplementation((url, opts) =>
    Promise.resolve(
      opts && opts.method === "POST"
        ? {
            ...vault,
            backups: [
              {
                ...vault.backups[0],
                file: "drishtiai-backup-2026-11-19-170000.ndjson.gz",
              },
              ...vault.backups,
            ],
          }
        : vault,
    ),
  );
  render(<DataCard />);
  expect(await screen.findByText("Market recorder")).toBeTruthy();
  expect(screen.getByText(/Recording now · 12 sessions recorded · order book and open interest not in use yet · newest backup/)).toBeTruthy();
  expect(screen.getByText(/Today: 142 of 143 minutes read for 104 stocks and 99 futures/)).toBeTruthy();
  expect(screen.getByText(/No page needs to be open, and no AI credit is used/)).toBeTruthy();
  // the learner: measured, and plainly not in use until proven
  expect(screen.getByText("Not proven yet")).toBeTruthy();
  expect(screen.getByText(/3 recorded sessions learned · 13,800 of 20,000 forecasts scored/)).toBeTruthy();
  expect(screen.getByText(/5 min \+0\.40% · 15 min \+0\.11% · 30 min -0\.02%/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Learn now" })).toBeTruthy();
  // the downloads are real links
  expect(screen.getByRole("link", { name: "All sessions (CSV, compressed)" }).getAttribute("href")).toBe("/api/admin/vault/tape.csv.gz");
  expect(screen.getByRole("link", { name: "2026-11-19" }).getAttribute("href")).toBe("/api/admin/vault/tape/2026-11-19");
  // the long lists of records are folded until asked for
  expect(screen.queryByRole("link", { name: "CSV" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Forecasts and their scores/ }));
  expect(screen.getByText(/480 records/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "CSV" }).getAttribute("href")).toBe("/api/admin/vault/collection/horizon_forecasts?format=csv");
  expect(screen.getByText("nothing stored yet")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("One stock's history"), {
    target: { value: "TCS" },
  });
  expect(screen.getByRole("link", { name: "TCS (CSV)" }).getAttribute("href")).toBe("/api/admin/vault/history/TCS");
  // the backups
  expect(screen.getByRole("link", { name: "Download" }).getAttribute("href")).toBe(vault.backups[0].href);
  expect(screen.getByText(/node server\/restore\.js/)).toBeTruthy();
  expect(screen.getByLabelText("How many backups to keep").value).toBe("5");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Back up now" }));
  });
  await waitFor(() =>
    expect(mockApi).toHaveBeenCalledWith("/api/admin/vault/backup", {
      method: "POST",
    }),
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("checkbox"));
  });
  await waitFor(() =>
    expect(mockApi).toHaveBeenCalledWith("/api/admin/vault/settings", {
      method: "PUT",
      body: { auto: false },
    }),
  );
});

test("an admin who is not the owner sees what is recorded and learned, and no downloads or backups", async () => {
  mockRole = "admin";
  mockApi.mockResolvedValue(recorder);
  render(<DataCard />);
  expect(await screen.findByText("Market recorder")).toBeTruthy();
  expect(mockApi).toHaveBeenCalledWith("/api/admin/recorder");
  expect(screen.getByText("Downloads and backups are the owner's.")).toBeTruthy();
  expect(screen.queryByText("Download from the database")).toBeNull();
  expect(screen.queryByRole("button", { name: "Back up now" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Learn now" })).toBeNull();
});
