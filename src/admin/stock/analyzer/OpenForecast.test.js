import React from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OpenChips, OpenForecastPane, useOpenForecast, verdictOf } from "./OpenForecast";

const mockApi = jest.fn();
jest.mock("../../api", () => ({ api: (...a) => mockApi(...a) }));

const current = (over = {}) => ({
  date: "2026-11-18",
  symbol: "ABC",
  madeAt: "2026-11-18T03:10:00.000Z",
  firstAt: "2026-11-17T11:00:00.000Z",
  first: { gapPct: 0.1, predicted: 430.95 },
  revisions: 3,
  stage: "morning",
  stale: false,
  prevClose: 430.55,
  prevDate: "2026-11-17",
  gapPct: 0.36,
  predicted: 432.1,
  band: { low: 430.2, high: 434.0, halfPct: 0.44 },
  usualMissPct: 0.34,
  experts: {
    flat: { gapPct: 0, price: 430.55, weight: 6, missPct: null },
    index: { gapPct: 0.42, price: 432.35, weight: 34, missPct: null },
    pattern: { gapPct: 0.35, price: 432.05, weight: 40, missPct: null },
    signals: { gapPct: 0.4, price: 432.25, weight: 20, missPct: null },
  },
  bias: 0,
  cue: { gapPct: 0.3, usedPct: 0.3, source: "market forecast", basis: "GIFT Nifty against the future." },
  tilt: { score: 0.2, parts: [{ name: "chart", score: 40, weight: 1 }, { name: "options", score: -20, weight: 1 }] },
  fit: { beta: 1.4, sessions: 248, pattern: true },
  actual: null,
  errPct: null,
  missPct: null,
  errRs: null,
  inBand: null,
  ...over,
});
const view = (over = {}) => ({
  available: true,
  symbol: "ABC",
  target: "2026-11-18",
  phase: "pre",
  final: false,
  reason: "",
  current: current(),
  todayOpen: null,
  preopen: null,
  last: null,
  history: [],
  backtest: { sessions: 120, maePct: 0.22, flatMaePct: 0.61, betterPct: 64, insidePct: 71, directionPct: 84, directionN: 96 },
  learning: { scored: 0, stats: null, weights: { flat: 0.06, index: 0.34, pattern: 0.4, signals: 0.2 }, cue: { biasPct: 0, missPct: null, n: 0 }, bandScale: 1, softWorth: 0.25, own: null, updatedAt: null },
  rule: "Four estimates are blended…",
  ...over,
});
const scored = () => current({ actual: { open: 431.5, gapPct: 0.22, at: "2026-11-18T03:46:10.000Z", source: "quote" }, errPct: 0.14, missPct: 0.14, errRs: 0.6, inBand: true });

function Strip({ symbol = "ABC" }) {
  const fc = useOpenForecast(symbol, true);
  const [open, setOpen] = React.useState(false);
  return (
    <div>
      <OpenChips fc={fc} pressed={open} onShow={() => setOpen(true)} />
      {open && <OpenForecastPane symbol={symbol} fc={fc} />}
    </div>
  );
}
const settle = () => act(async () => Promise.resolve());

beforeEach(() => mockApi.mockReset());

test("before the open: the predicted price with its gap and band, and the other block waits for 9:15", async () => {
  mockApi.mockResolvedValue(view());
  render(<Strip />);
  await settle();
  expect(mockApi).toHaveBeenCalledWith("/api/admin/market/open-forecast/ABC");
  const pred = screen.getByRole("button", { name: "Show the opening-price forecast" });
  expect(pred.textContent).toMatch(/Predicted open · today · updating/);
  expect(pred.textContent).toMatch(/₹432\.10/);
  expect(pred.textContent).toMatch(/\+0\.36%/);
  expect(pred.textContent).toMatch(/₹430\.20–₹434\.00/);
  const act2 = screen.getByRole("button", { name: "Show the actual opening price beside the forecast" });
  expect(act2.textContent).toMatch(/Actual open/);
  expect(act2.textContent).toMatch(/at 9:15/);
});

test("after the open: the real price beside the forecast, how far off it was, and whether it fell in the band", async () => {
  mockApi.mockResolvedValue(view({ phase: "open", final: true, current: scored() }));
  render(<Strip />);
  await settle();
  const pred = screen.getByRole("button", { name: "Show the opening-price forecast" });
  expect(pred.textContent).toMatch(/today · final/);
  const act2 = screen.getByRole("button", { name: "Show the actual opening price beside the forecast" });
  expect(act2.textContent).toMatch(/₹431\.50/);
  expect(act2.textContent).toMatch(/forecast ₹0\.60 high/);
  expect(act2.textContent).toMatch(/in band ✓/);
  expect(act2.querySelector(".of-mini--hit")).toBeTruthy();
});

test("a miss outside the band is marked, and 'low' / 'high' say which way the forecast was wrong", () => {
  expect(verdictOf(current())).toBeNull();
  expect(verdictOf(scored())).toMatchObject({ inside: true, text: "₹0.60 high", pctText: "+0.14%" });
  const low = verdictOf(current({ actual: { open: 436, gapPct: 1.27 }, errPct: -0.91, errRs: -3.9, inBand: false }));
  expect(low).toMatchObject({ inside: false, text: "₹3.90 low", pctText: "−0.91%" });
});

test("after the close the forecast is for the next session, and the last result stays beside it", async () => {
  const last = { ...scored(), date: "2026-11-17" };
  mockApi.mockResolvedValue(view({ phase: "next", target: "2026-11-18", last }));
  render(<Strip />);
  await settle();
  expect(screen.getByRole("button", { name: "Show the opening-price forecast" }).textContent).toMatch(/Predicted open · Wed/);
  expect(screen.getByRole("button", { name: "Show the actual opening price beside the forecast" }).textContent).toMatch(/last .*17.*₹0\.60 high/);
});

test("during the auction the exchange's indicative price is shown as indicative, not as the open", async () => {
  mockApi.mockResolvedValue(view({ phase: "auction", final: true, preopen: { price: 431.9, at: "2026-11-18T03:35:00.000Z" } }));
  render(<Strip />);
  await settle();
  const b = screen.getByRole("button", { name: "Show the actual opening price beside the forecast" });
  expect(b.textContent).toMatch(/auction on/);
  expect(b.textContent).toMatch(/≈ ₹431\.90/);
  expect(b.textContent).toMatch(/indicative, not yet the open/);
});

test("no forecast: it says why instead of showing a number", async () => {
  mockApi.mockResolvedValue(view({ available: false, current: null, reason: "No forecast was made for this stock before today's opening auction (9:00)." }));
  render(<Strip />);
  await settle();
  expect(screen.getByRole("button", { name: "Show the opening-price forecast" }).textContent).toMatch(/—/);
  await userEvent.click(screen.getByRole("button", { name: "Show the opening-price forecast" }));
  expect(screen.getByText(/before today's opening auction/)).toBeTruthy();
});

test("the working: every estimate with its weight, the index cue, the stock's sensitivity, the soft evidence and the history test", async () => {
  mockApi.mockResolvedValue(view());
  render(<Strip />);
  await settle();
  await userEvent.click(screen.getByRole("button", { name: "Show the opening-price forecast" }));
  expect(screen.getByText("How it was made")).toBeTruthy();
  for (const name of ["Opens at the previous close", "Index gap × this stock's sensitivity", "Yesterday's behaviour + the index gap"]) expect(screen.getByText(name)).toBeTruthy();
  expect(screen.getByText(/the Nifty is expected to open \+0\.30%/)).toBeTruthy();
  expect(screen.getByText(/moved about 1\.4× the Nifty's opening gap, measured on 248 sessions/)).toBeTruthy();
  expect(screen.getByText(/Chart lean \+40/)).toBeTruthy();
  expect(screen.getByText(/Option chain \(OI\) −20/)).toBeTruthy();
  expect(screen.getByText(/Nothing has been scored yet/)).toBeTruthy();
  expect(screen.getByText(/last 120 sessions/)).toBeTruthy();
  expect(screen.getByText(/revised 2×/)).toBeTruthy();
});

test("the record and what was learned are shown once forecasts have been scored", async () => {
  mockApi.mockResolvedValue(
    view({
      phase: "open",
      final: true,
      current: scored(),
      history: [
        { date: "2026-11-18", predicted: 432.1, open: 431.5, gapPct: 0.36, actualGapPct: 0.22, errPct: 0.14, inBand: true },
        { date: "2026-11-17", predicted: 428.0, open: 430.9, gapPct: -0.2, actualGapPct: 0.48, errPct: -0.68, inBand: false },
      ],
      learning: { scored: 46, stats: { n: 46, days: 12, maePct: 0.31, flatMaePct: 0.52, betterPct: 40, insidePct: 67, directionPct: 71, directionN: 31, trend: { earlierMaePct: 0.36, laterMaePct: 0.27 } }, weights: { flat: 0.04, index: 0.3, pattern: 0.46, signals: 0.2 }, cue: { biasPct: 0.06, missPct: 0.18, n: 12 }, bandScale: 1.1, softWorth: 0.2, own: { n: 12, biasPct: 0.12, missPct: 0.29 }, updatedAt: "2026-11-18T03:47:00.000Z" },
    })
  );
  render(<Strip />);
  await settle();
  await userEvent.click(screen.getByRole("button", { name: "Show the opening-price forecast" }));
  expect(screen.getByText(/This stock's record · 12 scored · usual miss 0\.29% · tends to open above its forecast by 0\.12%/)).toBeTruthy();
  expect(screen.getAllByText("inside ✓").length).toBe(1);
  expect(screen.getByText("outside")).toBeTruthy();
  const all = document.querySelector(".of").textContent;
  expect(all).toMatch(/46 forecasts scored over 12 sessions.*0\.31%.*0\.52%.*40% better.*67% of opens/);
  expect(all).toMatch(/went that way 71% of the time \(31 cases\)/);
  expect(all).toMatch(/The index cue has missed the Nifty's real opening gap by 0\.18% on average, reading too high by 0\.06%/);
  expect(all).toMatch(/Getting better\? Its miss was 0\.36% in the older half of the record and 0\.27% in the newer half/);
  expect(all).toMatch(/The forecast was ₹0\.60 high/);
});
