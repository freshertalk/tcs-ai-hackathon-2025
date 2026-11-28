import React from "react";
import { act, render, screen, within } from "@testing-library/react";
import Advisor from "./Advisor";

const side = (live, grade, oos = {}) => ({
  live: { n: 50, winPct: live, winLoPct: live - 6, expR: grade ? 0.6 : -0.1, expRLo: grade ? 0.5 : -0.2, targetPct: 40, stopPct: 10, fires: Boolean(grade) },
  grade,
  why: "",
  plan: { entryRef: 1000, stop: 970, target: 1045, riskPerShare: 30, rr: 1.5 },
  oos: { trades: 100, winPct: 70, expR: 0.5, t: 5.1, pf: 3, maxDdR: 3, ...oos },
});
const row = (symbol, grade, extra = {}) => ({
  symbol,
  available: true,
  fresh: true,
  asOf: "2026-11-26",
  bars: 2600,
  atr: 20,
  close: 1000,
  last: 1000,
  kinds: {
    swing: { horizon: 10, stopAtr: 1.5, targetAtr: 2.25, long: side(78, grade), short: side(14, null), analogs: [], forward: { d1: { avgPct: 0.3, upPct: 60 }, d10: { avgPct: 2.32, upPct: 82 } } },
    day: { horizon: 1, stopAtr: 0.6, targetAtr: null, long: side(42, null), short: side(46, null), analogs: [] },
  },
  best: grade ? { kind: "swing", side: "long", grade, winPct: 78, expR: 0.6, n: 50 } : null,
  warning: null,
  knowledge: null,
  ...extra,
});
const board = {
  rows: [row("AAA", "A"), row("BBB", "B"), row("CCC", "C"), row("DDD", null)],
  pooled: {},
  proof: { A: { trades: 30, t: 2.5, expR: 0.1 }, B: { trades: 15, t: 1.5, expR: 0 } },
  building: 0,
  at: "2026-11-27T05:00:00.000Z",
};

jest.mock("../../api", () => ({
  api: (url) => Promise.resolve(url.includes("/edge") ? global.__board : url.includes("/signals") ? { summary: [], signals: [] } : { mode: "none" }),
  peek: () => null,
}));
jest.mock("../trade/TradeContext", () => ({ useTrade: () => null }));
jest.mock("../../live", () => ({ useTopics: () => {}, useLive: () => ({ status: "live" }) }));

beforeEach(() => {
  global.__board = board;
  window.matchMedia = (q) => ({ matches: q === "(min-width: 1280px)", media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
});

test("the best readings come first: grade A and B only, each with its evidence, its plan and the rupees for your risk", async () => {
  render(<Advisor onOpen={() => {}} />);
  await act(async () => Promise.resolve());
  const top = screen.getByRole("region", { name: "Best readings today" });
  const picks = within(top).getAllByRole("article");
  expect(picks.map((p) => p.getAttribute("aria-label"))).toEqual(["AAA: Swing long, grade A", "BBB: Swing long, grade B"]);
  const a = picks[0].textContent;
  expect(a).toMatch(/Similar days won78%of 50/);
  expect(a).toMatch(/Forward test\+0\.50R× 100 · 70% won · t 5\.1/);
  expect(a).toMatch(/10 sessions after similar days\+2\.32%closed higher 82%/);
  expect(a).toMatch(/Stop-loss₹970\.00/);
  expect(a).toMatch(/Reward : risk1\.50 : 1/);
  expect(a).toMatch(/Quantity33/, "₹1,000 of risk ÷ ₹30 a share");
  expect(a).toMatch(/At risk · to target₹990 · ₹1,485/);
});

test("the board shows both horizons and what followed the similar days for every stock", async () => {
  render(<Advisor onOpen={() => {}} />);
  await act(async () => Promise.resolve());
  expect(screen.getByRole("columnheader", { name: "Day · Swing" })).toBeTruthy();
  expect(screen.getByRole("columnheader", { name: "After similar days" })).toBeTruthy();
  const aaa = screen.getAllByRole("row").find((r) => /AAA/.test(r.textContent));
  expect(aaa.textContent).toMatch(/Day▼ 46%/);
  expect(aaa.textContent).toMatch(/Swing▲ 78%A/);
  expect(aaa.textContent).toMatch(/\+2\.32%82% closed up · 10 days/);
  expect(aaa.textContent).toMatch(/₹990 risk/);
});

test("with no grade A or B reading, the panel says so", async () => {
  global.__board = { ...board, rows: [row("CCC", "C"), row("DDD", null)] };
  render(<Advisor onOpen={() => {}} />);
  await act(async () => Promise.resolve());
  expect(screen.getByText(/No grade A or B reading today/)).toBeTruthy();
});
