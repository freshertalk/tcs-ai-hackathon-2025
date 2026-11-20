import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

jest.mock("../../api", () => ({ api: jest.fn(), peek: jest.fn(() => null) }));
jest.mock("../../visible", () => ({ everyVisible: () => () => {} }));
jest.mock("../../auth", () => ({ useAuth: () => ({ user: { role: "superadmin" } }) }));
// eslint-disable-next-line import/first
import { api } from "../../api";
// eslint-disable-next-line import/first
import AheadCard, { AheadBoard } from "./AheadCard";
// eslint-disable-next-line import/first
import { ForecastChips } from "./HorizonCard";

const call = (p, usual, tier, proven = true) => ({ p, usual, tier, proven });
const tally = (calls, turn15) => {
  const z = () => ({ said: 0, came: 0, low: 0, lowCame: 0, usual: null, n: 0 });
  return { calls, 5: { turn: z(), go: z(), big: z(), calm: z() }, 15: { turn: turn15 || z(), go: z(), big: z(), calm: z() } };
};
const targets = [
  { target: "turn3", kind: "turn", h: 3, minutes: 15, n: 31000, usual: 0.29, skill: 0.012, said: 4200, saidRate: 0.41, low: 3900, lowRate: 0.2, proven: true },
  { target: "big3", kind: "big", h: 3, minutes: 15, n: 62000, usual: 0.32, skill: 0.06, said: 9000, saidRate: 0.55, low: 12000, lowRate: 0.17, proven: true },
  { target: "calm3", kind: "calm", h: 3, minutes: 15, n: 62000, usual: 0.31, skill: 0.001, said: 100, saidRate: 0.33, low: 80, lowRate: 0.3, proven: false },
];
const view = {
  symbol: "SBIN",
  trained: true,
  available: true,
  closed: false,
  asOf: "2026-11-17T05:35:10.000Z",
  anchor: { at: "2026-11-17T05:35:00.000Z", price: 1082.5 },
  move: { dir: "up", on: true, bars: 3, pct15: 0.46, usual15Pct: 0.35 },
  horizons: [
    {
      key: "5",
      h: 1,
      minutes: 5,
      minutesAhead: 5,
      at: "2026-11-17T05:40:00.000Z",
      trend: { word: "LEANS UP", side: "up", p: 0.58, grade: "C", pct: 0.06, price: 1083.1 },
      reversal: call(0.3, 0.29, "usual"),
      follow: call(0.36, 0.3, "raised"),
      momentum: { state: "steady", big: call(0.33, 0.32, "usual"), calm: call(0.3, 0.31, "usual") },
      read: "The up-move is more likely than usual to carry on for 5 minutes: 36% against a usual 30%.",
      tone: "up",
      why: { reversal: [], momentum: [] },
    },
    {
      key: "15",
      h: 4,
      minutes: 20,
      minutesAhead: 20,
      at: "2026-11-17T05:55:00.000Z",
      trend: { word: "NO CLEAR LEAN", side: null, p: 0.52, grade: "none", pct: 0.02, price: 1082.7 },
      reversal: call(0.41, 0.29, "raised"),
      follow: call(0.27, 0.3, "usual"),
      momentum: { state: "building", big: call(0.48, 0.32, "raised"), calm: call(0.2, 0.31, "low", false) },
      read: "The up-move is at risk of turning within 20 minutes: 41% against a usual 29%. Momentum is building.",
      tone: "warn",
      why: { reversal: [{ key: "a_vwap", side: "for", text: "the price is stretched from VWAP the move's way", push: 0.04 }], momentum: [{ key: "vol", side: "for", text: "volume is heavier than usual", push: 0.03 }] },
    },
  ],
  record: {
    own: tally(6, { said: 4, came: 2, low: 1, lowCame: 0, usual: 0.29, n: 5 }),
    all: tally(40, { said: 22, came: 9, low: 6, lowCame: 1, usual: 0.29, n: 28 }),
    trend: { 1: { n: 30, ok: 19 }, 3: { n: 30, ok: 17 } },
    last: [{ at: "2026-11-17T05:00:00.000Z", price: 1080, dir: "up", run: true, move5: 0.05, move15: -0.31, c5: [], c15: [{ kind: "turn", said: "warned", tier: "raised", p: 0.4, usual: 0.29, happened: true, ok: true }] }],
  },
  learning: { trained: true, trainedAt: "2026-11-10T10:00:00.000Z", lastDate: "2026-11-16", rows: { all: 1700000, run: 720000 }, days: 4, lastAt: "2026-11-16T10:20:00.000Z", targets, job: null },
  rule: "How it works. A reversal is never certain.",
  checkRule: "Every call kept is checked 5 and 15 minutes after it was made.",
};

beforeEach(() => api.mockReset());

test("the card says, 5 and 15 minutes ahead, the trend, the reversal risk beside its usual rate, the carry-on and the momentum — in plain words", async () => {
  api.mockResolvedValue(view);
  const { container } = render(<AheadCard symbol="SBIN" />);
  await waitFor(() => expect(screen.getByText("Next 15 minutes")).toBeTruthy());
  expect(api).toHaveBeenCalledWith("/api/admin/market/ahead/SBIN");
  expect(screen.getByText("Next 5 minutes")).toBeTruthy();
  expect(screen.getByText(/UP-MOVE ON/)).toBeTruthy();
  expect(screen.getByText(/3 bars in a row the same way/)).toBeTruthy();
  // the 15-minute column: the forecaster's trend call, the reversal warning with its measured chance and the usual rate
  const col = container.querySelectorAll(".ah-col")[1];
  expect(col.className).toMatch(/ah-col--warn/);
  expect(col.textContent).toMatch(/Trend\s*NO CLEAR LEAN/);
  expect(col.textContent).toMatch(/Reversal\s*RAISED\s*41%\s*usual 29%/);
  expect(col.textContent).toMatch(/Momentum\s*BUILDING\s*48%\s*usual 32%/);
  expect(col.textContent).toMatch(/at risk of turning within 20 minutes: 41% against a usual 29%/);
  expect(col.textContent).toMatch(/the price is stretched from VWAP the move's way \(raises a turn\)/);
  // a call at its usual rate is not dressed up
  const col5 = container.querySelectorAll(".ah-col")[0];
  expect(col5.textContent).toMatch(/Reversal\s*usual\s*30%/);
  expect(col5.textContent).toMatch(/Carry on\s*RAISED\s*36%/);
  // the meter shows the call against the usual rate
  const meter = col.querySelector(".ah-meter--warn");
  expect(meter.querySelector("i").style.width).toBe("41%");
  expect(meter.querySelector("u").style.left).toBe("29%");
});

test("the check is on the card: how often a warned reversal really came, for this stock and for all; the details hold the proof on unseen sessions", async () => {
  api.mockResolvedValue(view);
  render(<AheadCard symbol="SBIN" />);
  await waitFor(() => expect(screen.getByText(/The check — was each call right/)).toBeTruthy());
  expect(screen.getByText(/SBIN: 6 calls checked/)).toBeTruthy();
  expect(screen.getByText(/Every stock followed: 40 calls checked/)).toBeTruthy();
  const lines = screen.getAllByText(/Reversal warning, 15 min:/).map((b) => b.closest("li").textContent);
  expect(lines[0]).toMatch(/said 4 times: it turned 2 \(50%; usual 29%\)/);
  expect(lines[1]).toMatch(/said 22 times: it turned 9 \(41%; usual 29%\)/);
  expect(screen.getByText(/Trend calls \(the forecaster’s\): 19 of 30 correct at 5 minutes, 17 of 30 at 15/)).toBeTruthy();
  // details: the measured record per call, and which calls are used
  expect(screen.queryByText(/Measured on sessions the model had not seen/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  expect(screen.getByText(/Measured on sessions the model had not seen/)).toBeTruthy();
  const row = screen.getByRole("row", { name: /Reversal 15 min/ });
  expect(row.textContent).toMatch(/29%.*41%.*of 4,200.*20%.*of 3,900.*31,000.*Proven/);
  expect(screen.getByRole("row", { name: /Quiet stretch 15 min/ }).textContent).toMatch(/Not yet/);
  expect(screen.getByText(/The last calls checked for this stock/)).toBeTruthy();
  expect(screen.getByText(/Reversal ↑ ✓/)).toBeTruthy();
  expect(screen.getByText(/A reversal is never certain/)).toBeTruthy();
});

test("a call that is not proven says so; with no move on, nothing is said about a reversal; when there is no call the reason is shown", async () => {
  api.mockResolvedValue({ ...view, move: { ...view.move, on: false }, horizons: [{ ...view.horizons[1], reversal: null, follow: null, tone: "none", momentum: { state: "fading", big: call(0.2, 0.32, "low"), calm: call(0.31, 0.31, "usual", false) } }] });
  const first = render(<AheadCard symbol="SBIN" />);
  await waitFor(() => expect(screen.getByText(/NO MOVE ON/)).toBeTruthy());
  expect(screen.getByText("no move on")).toBeTruthy();
  expect(screen.getByText("nothing to turn")).toBeTruthy();
  expect(screen.getByText("not proven yet")).toBeTruthy();
  first.unmount();
  api.mockResolvedValue({ ...view, available: false, trained: false, reason: "The early calls have not learned yet.", horizons: undefined, move: undefined, learning: { trained: false, job: null }, record: { own: tally(0), all: tally(0), trend: null, last: [] } });
  render(<AheadCard symbol="SBIN" />);
  await waitFor(() => expect(screen.getByText("The early calls have not learned yet.")).toBeTruthy());
  expect(screen.getByText(/No call has been checked yet/)).toBeTruthy();
});

test("the Desk's price bar carries one early-call chip, only when something is called", () => {
  const forecast = { data: { available: true, headline: { at: "2026-11-17T05:51:00.000Z", price: 1085.2, pct: 0.25, call: { side: "up", p: 0.66 } }, headline5: null, checks: null } };
  const warn = render(<ForecastChips state={forecast} ahead={{ data: view }} />);
  const chip = warn.container.querySelector(".fc-chip--early");
  expect(chip.className).toMatch(/is-warn/);
  expect(chip.textContent).toBe("turn?41%");
  warn.unmount();
  const calm = { ...view, horizons: [view.horizons[0]] }; // nothing is called at 5 minutes beyond the usual
  expect(render(<ForecastChips state={forecast} ahead={{ data: { ...calm, horizons: [{ ...calm.horizons[0], reversal: call(0.3, 0.29, "usual") }] } }} />).container.querySelector(".fc-chip--early")).toBeNull();
  expect(render(<ForecastChips state={forecast} />).container.querySelector(".fc-chip--early")).toBeNull();
});

test("the board in Research: the measured record, each evening's unseen day, and the owner's two buttons", async () => {
  const board = {
    trained: true,
    learning: view.learning,
    validation: null,
    days: [{ date: "2026-11-16", rows: 6600, turn15: { said: 310, saidRate: 0.4, usual: 0.29 }, go15: { said: 200, saidRate: 0.38, usual: 0.3 }, big15: { said: 800, saidRate: 0.56, usual: 0.32 }, calm15: { said: 0, saidRate: null, usual: 0.31 } }],
    live: tally(40, { said: 22, came: 9, low: 6, lowCame: 1, usual: 0.29, n: 28 }),
    trend: null,
    job: null,
    error: "",
    rule: "How it works.",
    checkRule: "Every call kept is checked.",
  };
  api.mockResolvedValue(board);
  render(<AheadBoard />);
  await waitFor(() => expect(screen.getByText(/Early calls · what they have learned/)).toBeTruthy());
  expect(screen.getByText(/learned from 17,00,000 bars \(7,20,000 with a move on\)/)).toBeTruthy();
  const dayRow = screen.getByRole("row", { name: /16 Nov/ });
  expect(dayRow.textContent).toMatch(/40% of 310.*29%.*38% of 200.*56% of 800/);
  api.mockResolvedValue({ ...board, job: { kind: "learn", phase: "reading the new sessions", rows: 1200, finishedAt: null } });
  fireEvent.click(screen.getByRole("button", { name: "Learn new sessions" }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/api/admin/market/ahead/learn", { method: "POST" }));
  await waitFor(() => expect(screen.getByText(/Learning: reading the new sessions · 1,200 bars read/)).toBeTruthy());
});
