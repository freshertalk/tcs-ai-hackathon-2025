import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { RsiWatch, TopPicks } from "./TopPicks";

const mockRow = (rank, symbol, side, extra = {}) => ({
  rank,
  symbol,
  sector: "NIFTY METAL",
  side,
  score: 80 - rank,
  margin: 30,
  deep: true,
  last: 150.5,
  changePct: side === "long" ? 1.2 : -0.8,
  reasons: [`${symbol}: above its 20-, 50- and 200-day averages.`, "Stronger than the NIFTY: +4.10% in 20 sessions against +1.00%."],
  against: ["Stretched: daily RSI 77 — a long here chases."],
  tags: ["trend", "rs"],
  plan: { kind: side, entry: 151, stop: 149.5, target: 154, target2: 156, record: { trades: 30, winRate: 57, avgR: 0.2 }, why: "Trend", status: "waiting" },
  data: { atrPct: 1.4, ret20: 4.1, rsi14: 77, turnoverCr: 420 },
  ...extra,
});
const mockView = {
  phase: { phase: "live", session: "2026-11-13" },
  snap: {
    id: "s1",
    at: "2026-11-13T05:20:00Z",
    clock: "10:50",
    phase: "live",
    session: "2026-11-13",
    trigger: "itself",
    list: [mockRow(1, "TATASTEEL", "long", { move: null, ai: { thesis: "Metals lead and it is the strongest of them.", risk: "A close under 149.50.", confidence: "medium" } }), mockRow(2, "HINDCOPPER", "short", { move: 2 })],
    onDeck: [mockRow(11, "SBIN", "long")],
    left: [{ symbol: "INFY", side: "short", rank: 4 }],
    context: { world: { score: 31, word: "up", firm: false, headline: "NSE leans up" }, tide: { score: 40, label: "Rising" }, nifty: { changePct: 0.76 }, mood: { label: "Positive", score: 30 } },
    stats: { universe: 102, scored: 98, excluded: 20, ms: 2100 },
    ai: { by: "Claude Sonnet 5.5", clock: "10:51", summary: "Metals lead; one short against the tide.", marketView: "A trending morning.", dropped: [{ symbol: "UPL", why: "Its plan's record is poor." }] },
    history: [],
  },
  stale: false,
  running: false,
  progress: null,
  record: { sessions: 12, picks: 118, hitRate: 56, avgPct: 0.31, avgEdgePct: 0.22, beatUniverse: 8, longs: { n: 80, hitRate: 58, avgPct: 0.35 }, shorts: { n: 38, hitRate: 52, avgPct: 0.2 }, byReason: [{ tag: "odds", n: 30, hitRate: 63, avgPct: 0.52 }], recent: [] },
  settings: { aiMode: "need", aiDailyCap: 6, aiToday: 2, aiReady: true },
  connected: true,
  demo: false,
  tagNames: { odds: "Measured odds (grade A or B)" },
};
const mockRsi = { available: true, rule: { period: 14, low: 15, high: 80, minTurnover: 100 }, at: "2026-11-13T05:20:00Z", live: true, considered: 480, oversold: [{ symbol: "LOWCO", name: "Low Co", last: 100, changePct: -3.1, rsi: 12.4, rsiPrev: 14, avgTurnoverCr: 140 }], overbought: [{ symbol: "HICO", name: "High Co", last: 900, changePct: 2, rsi: 83.1, rsiPrev: 81, avgTurnoverCr: 300 }] };
const mockCalls = [];
jest.mock("../../api", () => ({
  api: (url, opts) => {
    mockCalls.push(opts && opts.method ? `${opts.method} ${url}` : url);
    if (url === "/api/admin/picks") return Promise.resolve(mockView);
    if (url === "/api/admin/picks/refresh") return Promise.resolve({ ...mockView, running: true, progress: { step: "Scoring every stock", done: 40, of: 102 } });
    if (url === "/api/admin/picks/rsi") return Promise.resolve(mockRsi);
    if (url === "/api/admin/picks/settings") return Promise.resolve({ ...mockView.settings, aiMode: "off" });
    return Promise.resolve({});
  },
}));
jest.mock("../../auth", () => ({ useAuth: () => ({ user: { role: "superadmin" } }) }));
const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));
beforeEach(() => {
  mockCalls.length = 0;
});

test("the Top 10: ranked by itself, with the side, the score, the plan, the AI's note, rank moves, and what left the list", async () => {
  const opened = [];
  render(<TopPicks onOpen={(s) => opened.push(s)} />);
  await settle();
  expect(mockCalls).toContain("/api/admin/picks");
  expect(screen.getByText("Top 10 · for today's session")).toBeTruthy();
  expect(screen.getByText(/In the session · made 10:50 · re-ranked every 5 minutes · 102 stocks scored/)).toBeTruthy();
  expect(screen.getByText("World leans up (+31)")).toBeTruthy();
  expect(screen.getByText(/Reviewed by the AI \(Claude Sonnet 5.5, 10:51\)/)).toBeTruthy();
  expect(screen.getByText(/Left off: UPL \(Its plan's record is poor\.\)/)).toBeTruthy();
  expect(screen.getByText("NEW")).toBeTruthy();
  expect(screen.getByText("▲2")).toBeTruthy();
  expect(screen.getByText("AI: Metals lead and it is the strongest of them.")).toBeTruthy();
  expect(screen.getAllByText(/above ₹151.00 · stop ₹149.50 · target ₹154.00 — waiting for the entry/).length).toBeGreaterThan(0);
  expect(screen.getByText(/INFY \(was 4\)/)).toBeTruthy();
  // a row opens to every reason, what is against it, and the data behind it
  fireEvent.click(screen.getByText("TATASTEEL"));
  expect(screen.getByText("Why long")).toBeTruthy();
  expect(screen.getByText("Against it")).toBeTruthy();
  expect(screen.getByText("Daily range (ATR)")).toBeTruthy();
  expect(screen.getByText(/its rule won 57% of 30 past sessions/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open TATASTEEL on the desk" }));
  expect(opened).toEqual(["TATASTEEL"]);
  // the record, and the owner's controls
  expect(screen.getAllByText("Moved their way").length).toBeGreaterThan(0);
  expect(screen.getByText("Sessions scored")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "↻ Refresh now" }));
  await settle();
  expect(mockCalls).toContain("POST /api/admin/picks/refresh");
  expect(screen.getByText(/Scoring every stock · 40 of 102/)).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "AI review of the Top 10" }), { target: { value: "off" } });
  await settle();
  expect(mockCalls).toContain("PUT /api/admin/picks/settings");
});

test("the RSI watch: the NIFTY 500's extremes at RSI(14) 15 or less and 80 or more, ₹100 crore a day or more, by itself", async () => {
  const opened = [];
  render(<RsiWatch onOpen={(s) => opened.push(s)} />);
  await settle();
  expect(mockCalls).toContain("/api/admin/picks/rsi");
  expect(screen.getByText("RSI watch · NIFTY 500 · live")).toBeTruthy();
  expect(screen.getByText(/14-day RSI of 15 or less, or 80 or more · traded ₹100 crore a day or more/)).toBeTruthy();
  expect(screen.getByText(/Oversold · RSI 15 or less/)).toBeTruthy();
  expect(screen.getByText(/Overbought · RSI 80 or more/)).toBeTruthy();
  expect(screen.getByText("12.4")).toBeTruthy();
  expect(screen.getByText("83.1")).toBeTruthy();
  fireEvent.click(screen.getByText("HICO"));
  expect(opened).toEqual(["HICO"]);
});
