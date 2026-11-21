import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ConsensusCard from "./ConsensusCard";
import { api } from "../../api";

jest.mock("../../api", () => ({ api: jest.fn(), peek: () => null }));
jest.mock("../../visible", () => ({ everyVisible: () => () => {} }));

const rec = (checks, proven) => (checks ? { checks, days: 6, proven, blend: { missAvg: 0.61, dirAcc: 0.58, dirCalls: 300 }, forecaster: { missAvg: 0.66, dirAcc: 0.55, dirCalls: 300 }, gain: 0.07 } : { checks: 0, days: 0, proven: false });
const view = (leads = "forecaster", checks = 0) => ({
  symbol: "SBIN",
  available: true,
  asOf: "2026-11-19T04:41:00.000Z",
  anchor: { at: "2026-11-19T04:35:00.000Z", price: 806 },
  horizons: [
    { key: "5", minutesAhead: 4, at: "2026-11-19T04:45:00.000Z", h: 2, price: 806.9, low: 805.2, high: 808.4, pct: 0.11, pUp: 0.61, lean: "up", tier: "clear", leads, blend: {}, forecaster: { price: 806.9, pUp: 0.61 }, parts: { evidence: { lean: "up", tier: "clear", pUp: 0.6, pDown: 0.3 }, early: { read: "Nothing unusual ahead.", tone: "none" }, book: { buyQty: 300000, sellQty: 200000, buyShare: 0.6 } }, contributions: [], record: rec(checks, leads === "blend") },
    { key: "15", minutesAhead: 14, at: "2026-11-19T04:55:00.000Z", h: 4, price: 808.5, low: 804.9, high: 811.6, pct: 0.31, pUp: 0.64, lean: "up", tier: "clear", leads, blend: {}, forecaster: { price: 808.2, pUp: 0.62 }, parts: { evidence: { lean: "up", tier: "clear", pUp: 0.6, pDown: 0.3 }, early: { read: "The up-move looks intact.", tone: "up" }, book: { buyQty: 300000, sellQty: 200000, buyShare: 0.6 } }, contributions: [{ input: "bias", value: 1, weight: 0, adds: 0 }, { input: "forecaster", value: 0.9, weight: 0.8, adds: 0.21 }, { input: "evidence", value: 0.3, weight: 0.3, adds: 0.05 }], record: rec(checks, leads === "blend") },
  ],
  firstUp: { name: "Day high", price: 810, p15: 0.42 },
  firstDown: { name: "VWAP", price: 803.2, p15: 0.31 },
  record: { 5: rec(checks, leads === "blend"), 15: rec(checks, leads === "blend") },
  rule: "The consensus forecast blends the desk's three forecasters.",
  checkRule: "Every forecast is checked 5 and 15 minutes after its bar.",
});

afterEach(() => api.mockReset());

test("one level forecast for 5 and 15 minutes: price, band, chance of a rise, the level touched first, the parts, and who leads", async () => {
  api.mockResolvedValue(view());
  const { container } = render(<ConsensusCard symbol="SBIN" />);
  await waitFor(() => expect(container.querySelector(".cs-tiles")).toBeTruthy());
  expect(api).toHaveBeenCalledWith("/api/admin/market/consensus/SBIN");
  expect(container.querySelector(".cs").className).toMatch(/cs--up/);
  expect(screen.getByText("led by the forecaster")).toBeTruthy();
  const tiles = [...container.querySelectorAll(".cs-tile")];
  expect(tiles).toHaveLength(2);
  expect(tiles[1].textContent).toMatch(/In 14 min/);
  expect(tiles[1].textContent).toMatch(/808\.5/);
  expect(tiles[1].textContent).toMatch(/\+0\.31%/);
  expect(tiles[1].textContent).toMatch(/likely .*804\.9.*811\.6/);
  expect(tiles[1].textContent).toMatch(/Chance of a rise 64% · clear/);
  expect(container.querySelector(".cs-first").textContent).toMatch(/above: Day high .*810.* \(42% within 15 min\) · below: VWAP .*803\.2.* \(31%\)/);
  const parts = container.querySelector(".cs-parts").textContent;
  expect(parts).toMatch(/Evidence desk.*up.*rise 60% · fall 30%/);
  expect(parts).toMatch(/Early calls.*The up-move looks intact\./);
  expect(parts).toMatch(/Order book60% buy3,00,000 to buy · 2,00,000 to sell/);
  expect(container.querySelector(".cs-record").textContent).toMatch(/no forecast checked yet/);
  fireEvent.click(screen.getByText("How it is weighed"));
  expect(container.querySelector(".cs-weights").textContent).toMatch(/15-minute forecasterweight 0\.8\+0\.210%/);
  expect(container.querySelector(".cs-how").textContent).toMatch(/Every forecast is checked/);
});

test("once proven, the blend leads and its record says so; compact hides the parts; no forecast says why", async () => {
  api.mockResolvedValue(view("blend", 420));
  const { container, unmount } = render(<ConsensusCard symbol="SBIN" compact />);
  await waitFor(() => expect(container.querySelector(".cs-tiles")).toBeTruthy());
  expect(screen.getByText("led by the blend").className).toMatch(/is-blend/);
  expect(container.querySelector(".cs-record").textContent).toMatch(/420 checks over 6 sessions — direction right 58% for the blend, 55% for the forecaster alone; average miss 0\.61 against 0\.66 usual moves blend proven/);
  expect(container.querySelector(".cs-parts")).toBeNull();
  unmount();
  api.mockResolvedValue({ symbol: "SBIN", available: false, reason: "The session is over." });
  render(<ConsensusCard symbol="SBIN" />);
  await waitFor(() => expect(screen.getByText("The session is over.")).toBeTruthy());
});
