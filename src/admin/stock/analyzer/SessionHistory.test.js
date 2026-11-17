import React from "react";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import { rollUp, sessionRows, summary, toCsv } from "./sessionRows";

jest.mock("../../api", () => ({ api: jest.fn(), peek: jest.fn(() => null) }));
jest.mock("../../visible", () => ({ everyVisible: () => () => {} }));
// eslint-disable-next-line import/first
import { api } from "../../api";
// eslint-disable-next-line import/first
import SessionHistory from "./SessionHistory";

// n weekday-ish sessions ending 2026-11-13, closing 100, 101, 102 …
function bars(n) {
  const out = [];
  const end = Date.UTC(2026, 10, 13);
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(end - i * 86400000).toISOString().slice(0, 10);
    const c = 100 + (n - 1 - i);
    out.push({ t: d, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 + (n - i) });
  }
  return out;
}

test("each session is compared with the one before it", () => {
  const rows = sessionRows([
    { t: "2026-01-01", o: 100, h: 102, l: 99, c: 101, v: 10 },
    { t: "2026-01-02", o: 103.02, h: 105, l: 101, c: 102.01, v: 30 },
  ]);
  expect(rows[0].chg).toBeNull();
  expect(rows[1].chg).toBeCloseTo(1.01, 5);
  expect(rows[1].chgPct).toBeCloseTo(1, 5);
  expect(rows[1].gapPct).toBeCloseTo(2, 5);
  expect(rows[1].rangePct).toBeCloseTo((4 / 101) * 100, 5);
  expect(rows[1].closeAt).toBeCloseTo(25.25, 5);
});

test("months and years roll up open, high, low, close, volume and up days", () => {
  const rows = sessionRows([
    { t: "2025-12-30", o: 10, h: 11, l: 9, c: 10, v: 1 },
    { t: "2026-01-02", o: 10, h: 12, l: 10, c: 11, v: 2 },
    { t: "2026-01-05", o: 11, h: 13, l: 10.5, c: 10.8, v: 3 },
    { t: "2026-02-02", o: 11, h: 11, l: 9.5, c: 12, v: 4 },
  ]);
  const m = rollUp(rows, "month");
  expect(m.map((g) => g.key)).toEqual(["2025-12", "2026-01", "2026-02"]);
  const jan = m[1];
  expect([jan.o, jan.h, jan.l, jan.c, jan.v, jan.sessions, jan.up]).toEqual([10, 13, 10, 10.8, 5, 2, 1]);
  expect(jan.chgPct).toBeCloseTo(8, 5); // against December's close
  expect(rollUp(rows, "year").map((g) => g.key)).toEqual(["2025", "2026"]);
});

test("the summary covers the last n sessions; the CSV is newest first and escapes nothing it should not", () => {
  const rows = sessionRows(bars(40));
  const s = summary(rows, 30);
  expect(s.n).toBe(30);
  expect(s.up).toBe(30);
  expect(s.down).toBe(0);
  const csv = toCsv(rows).split("\n");
  expect(csv[0]).toMatch(/^Date,Open,High,Low,Close/);
  expect(csv[1].startsWith("2026-11-13,")).toBe(true);
  expect(csv).toHaveLength(41);
});

test("the Desk shows the last 30 sessions, then every session in pages, months and years", async () => {
  api.mockResolvedValue({ candles: bars(250), stale: false });
  render(<SessionHistory symbol="SBIN" />);
  const t30 = await screen.findByRole("region", { name: "SBIN: the last 30 sessions" });
  const body = (el) => el.querySelectorAll("tbody tr").length;
  expect(body(t30)).toBe(30);
  const all = () => screen.getByRole("region", { name: "SBIN: every session" });
  expect(body(all())).toBe(100); // first page of 100
  fireEvent.click(screen.getByRole("button", { name: /show all/i }));
  await waitFor(() => expect(body(all())).toBe(250));
  fireEvent.click(screen.getByRole("button", { name: "Months" }));
  expect(screen.getByRole("region", { name: "SBIN: month by month" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Years" }));
  expect(screen.getByRole("region", { name: "SBIN: year by year" })).toBeTruthy();
}, 30000);
