import React from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthContext } from "../../auth";
import { PlaybookChip, PlaybookPane } from "./Playbook";
import { ProposalCard, stateOf } from "./Proposals";
import AutopilotPanel from "./AutopilotPanel";
import { TradeContext } from "../trade/TradeContext";

const mockApi = jest.fn();
jest.mock("../../api", () => ({ api: (...a) => mockApi(...a) }));
jest.mock("../../visible", () => ({ everyVisible: () => () => {} }));

const proposal = (over = {}) => ({
  id: "2026-11-17|ABC|break-long",
  date: "2026-11-17",
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 25 * 60000).toISOString(),
  symbol: "ABC",
  scenario: "break-long",
  label: "Break above ₹502 holds → long",
  side: "long",
  status: "new",
  price: 502.5,
  entry: 502,
  stop: 497,
  targets: [510, 515],
  riskPerShare: 5,
  qty: 400,
  riskRs: 2000,
  valueRs: 201000,
  rr: 1.6,
  sizeFactor: 0.85,
  reasons: [{ level: "cut", text: "Size ×0.85 (events)." }],
  why: "The previous session's high is where yesterday's sellers gave up.",
  measured: "Replayed on 14 past sessions: 57% won.",
  ticket: { symbol: "ABC", exchange: "NSE", side: "BUY", product: "MIS", quantity: 400, price: 502.5, plan: { stop: 497, target: 510, risk: 2000, source: "Autopilot · Break above" } },
  outcome: null,
  ...over,
});

const scenario = (over = {}) => ({
  id: "break-long",
  label: "Break above ₹502 holds → long",
  kind: "entry",
  side: "long",
  trigger: { type: "break", side: "long", level: 502 },
  plan: { entry: 502, stop: 497, targets: [510, 515], riskPerShare: 5, riskPct: 1, rewardToRisk: 1.6 },
  sizeFactor: 0.85,
  sizeNotes: ["events today ×0.85"],
  measured: "Replayed on 14 past sessions: 57% won.",
  why: "The previous session's high is where yesterday's sellers gave up.",
  cancels: ["After 2:45 PM"],
  status: { state: "armed", note: "0.5% below the trigger ₹502." },
  learned: { n: 6, avgR: 0.4, winRate: 67, paused: false },
  ...over,
});
const playbook = (over = {}) => ({
  available: true,
  symbol: "ABC",
  date: "2026-11-17",
  open: true,
  last: 500,
  lean: { call: "long-bias", score: 34, agreement: 71, reliability: "When the outlook's lean was +22 to +40 (212 past sessions across 20 stocks), the next session closed higher 56% of the time." },
  regime: { kind: "trending-up", word: "Trending up", er: 0.5, atrPct: 1.4, atrRank: 55, bbRank: 40, doThis: ["Trade with the trend.", "Let winners run.", "A first fade is a gift."] },
  script: [{ from: "09:15", to: "09:30", title: "Opening range", happens: "Spreads are wide.", do: "No entries." }],
  scenarios: [scenario(), { id: "risk-off", label: "The Nifty turns hard against you", kind: "advice", sizeFactor: 1, why: "Stocks follow the index.", then: ["Stop adding."], cancels: [], measured: "", status: null }],
  events: { today: { events: [{ id: "e1", title: "NIFTY weekly expiry", advice: "Trade smaller." }], sizeFactor: 0.85, noOvernight: false, avoidNew: false }, upcoming: [{ id: "e2", date: "2026-11-24", daysAway: 7, title: "NIFTY monthly expiry", impact: "high" }] },
  sizing: { scenario: "break-long", label: "Break above ₹502 holds → long", allowed: true, qty: 400, riskRs: 2000, riskOfCapitalPct: 0.2, valueRs: 201000, capitalPct: 20.1, reasons: [{ level: "cut", text: "A position is limited to 25% of capital." }] },
  proposals: [],
  watching: true,
  rule: "A playbook is what a disciplined trader writes before the open.",
  ...over,
});

const settle = () => act(async () => Promise.resolve());
beforeEach(() => mockApi.mockReset());

test("the chip says what kind of day it is and how many setups are armed", () => {
  const { container } = render(<PlaybookChip pb={{ loading: false, data: playbook() }} pressed={false} onShow={() => {}} />);
  const b = screen.getByRole("button", { name: "Show the playbook for this stock" });
  expect(b.textContent).toMatch(/Playbook.*Trending up.*1 armed/);
  expect(container.querySelector(".ab-mini--up")).toBeTruthy();
  render(<PlaybookChip pb={{ loading: false, data: playbook({ proposals: [proposal()] }) }} pressed={false} onShow={() => {}} />);
  expect(screen.getAllByRole("button", { name: "Show the playbook for this stock" })[1].textContent).toMatch(/1 proposal/);
});

test("the playbook: the day, the lean and its record, sizing, each setup with its trigger and where it stands, the script", () => {
  render(<PlaybookPane symbol="ABC" pb={{ loading: false, data: playbook() }} />);
  expect(screen.getByText("Trending up")).toBeTruthy();
  expect(screen.getByText(/the next session closed higher 56% of the time/)).toBeTruthy();
  expect(screen.getByText(/NIFTY weekly expiry/)).toBeTruthy();
  expect(screen.getByText(/400 shares, risking ₹2,000 \(0\.2% of capital\)/)).toBeTruthy();
  expect(screen.getByText("Armed")).toBeTruthy();
  expect(screen.getByText(/Enter ₹502\.00 · stop ₹497\.00 · targets ₹510\.00, ₹515\.00/)).toBeTruthy();
  expect(screen.getByText(/Autopilot's own record for this setup: 6 proposals, 67% won, average 0\.4R/)).toBeTruthy();
  expect(screen.getByText("What cancels it")).toBeTruthy();
  expect(screen.getByText("The Nifty turns hard against you")).toBeTruthy();
  expect(screen.getByText("Opening range")).toBeTruthy();
  expect(screen.getByText(/NIFTY monthly expiry/)).toBeTruthy();
  expect(screen.getByText(/watching these triggers every 30 seconds/)).toBeTruthy();
});

test("a stock with no playbook says why", () => {
  render(<PlaybookPane symbol="ABC" pb={{ loading: false, data: { available: false, reason: "Too little history for a playbook." } }} />);
  expect(screen.getByText("Too little history for a playbook.")).toBeTruthy();
});

const withTrade = (ui, trade) => <AuthContext.Provider value={{ user: { role: "superadmin" } }}><TradeContext.Provider value={trade}>{ui}</TradeContext.Provider></AuthContext.Provider>;

test("Review opens the order ticket filled in and records that it was opened — the proposal itself sends nothing", async () => {
  mockApi.mockResolvedValue({ proposal: {} });
  const openTicket = jest.fn();
  render(withTrade(<ul><ProposalCard p={proposal()} onChanged={() => {}} /></ul>, { enabled: true, connected: true, openTicket }));
  expect(screen.getByText(/Near ₹502\.50 · stop ₹497\.00 · target ₹510\.00 then ₹515\.00 · risk ₹2,000/)).toBeTruthy();
  expect(screen.getByText("Size ×0.85 (events).")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Review the order" }));
  expect(openTicket).toHaveBeenCalledTimes(1);
  expect(openTicket.mock.calls[0][0]).toMatchObject({ symbol: "ABC", side: "BUY", product: "MIS", quantity: 400, price: 502.5, plan: { stop: 497, target: 510 } });
  expect(mockApi).toHaveBeenCalledWith("/api/admin/autopilot/proposals/2026-11-17%7CABC%7Cbreak-long/opened", { method: "POST", body: {} });
});

test("with trading off the proposal can be read but not reviewed; a refused one has no buttons and gives its reason", async () => {
  render(withTrade(<ul><ProposalCard p={proposal()} /></ul>, { enabled: false, connected: true, openTicket: jest.fn() }));
  expect(screen.getByRole("button", { name: "Review the order" }).disabled).toBe(true);
  render(withTrade(<ul><ProposalCard p={proposal({ id: "b", status: "blocked", qty: 0, ticket: null, reasons: [{ level: "block", text: "The risk guard has locked the day." }] })} /></ul>, { enabled: true, connected: true, openTicket: jest.fn() }));
  expect(screen.getByText("The risk guard has locked the day.")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Review the order" }).length).toBe(1);
  expect(stateOf(proposal({ status: "blocked" })).id).toBe("blocked");
  expect(stateOf(proposal({ outcome: { how: "target", r: 1.5 } })).text).toMatch(/reached target 1: \+1\.50R/);
  expect(stateOf(proposal({ outcome: { how: "stop", r: -1.1 } })).id).toBe("lost");
  expect(stateOf(proposal({ expiresAt: new Date(Date.now() - 1000).toISOString() })).id).toBe("stale");
  expect(stateOf(proposal({ response: { action: "ignored" } })).id).toBe("ignored");
});

const board = (over = {}) => ({
  on: true,
  watching: true,
  lastTick: new Date().toISOString(),
  error: "",
  universe: ["ABC", "XYZ"],
  settings: { capital: 1000000, riskPct: 0.5, maxPositionPct: 25, maxSectorPct: 35, maxGrossPct: 150, minRR: 1.5, maxProposals: 6, on: true, notify: true, exclude: [] },
  proposals: [proposal()],
  today: { date: "2026-11-17", tradingDay: true, holiday: "", known: true },
  learned: { byScenario: { "break-long": { n: 14, winRate: 57, avgR: 0.31, totalR: 4.3, paused: false } }, overall: { n: 14, winRate: 57, avgR: 0.31, totalR: 4.3, profitFactor: 1.8, how: { target: 8, stop: 5, time: 1 } } },
  calibration: { available: true, from: "2025-08-01", to: "2026-11-16", at: new Date().toISOString(), overall: { n: 800, stocks: 5, called: 300, hitPct: 54, baseUpPct: 51, avgCalledPct: 0.08, t: 1.4 }, buckets: [{ id: "up", label: "+22 to +40", n: 120, upPct: 56, avgPct: 0.12 }], voices: [{ id: "trend", n: 400, hitPct: 55, avgPct: 0.1, verdict: "has paid", multiplier: 1.2 }], rule: "The outlook is rebuilt for each past session." },
  events: [{ id: "x1", date: "2026-11-24", daysAway: 7, kind: "expiry", title: "NIFTY monthly expiry", impact: "high", sizeFactor: 0.75, advice: "Expiry day.", scope: { market: true } }],
  custom: [],
  lessons: ["Autopilot proposals graded so far: 14."],
  ...over,
});
const panel = (role = "superadmin", trade = { enabled: true, connected: true, openTicket: jest.fn() }) => (
  <AuthContext.Provider value={{ user: { role } }}>
    <TradeContext.Provider value={trade}>
      <AutopilotPanel />
    </TradeContext.Provider>
  </AuthContext.Provider>
);

test("the autopilot panel: status, the waiting proposal, the scorecard with the research's own grade, events and limits", async () => {
  mockApi.mockResolvedValue(board());
  render(panel());
  await settle();
  expect(screen.getByText(/Watching 2 stocks/)).toBeTruthy();
  expect(screen.getByText("1 new proposal")).toBeTruthy();
  expect(screen.getByText("Waiting for you")).toBeTruthy();
  expect(screen.getByText("Break above ₹502 holds → long")).toBeTruthy();
  await userEvent.click(screen.getByRole("tab", { name: "Scorecard" }));
  expect(document.querySelector(".apx-score").textContent).toMatch(/14 graded.*57% won.*0\.31R.*profit factor 1\.8/);
  expect(document.querySelector(".apx-score").textContent).toMatch(/5 stocks, 800 past sessions.*right 54%.*51%/);
  await userEvent.click(screen.getByRole("tab", { name: "Events" }));
  expect(document.querySelector(".apx-evs").textContent).toMatch(/2026-11-24.*in 7 d.*NIFTY monthly expiry.*high.*size ×0.75.*Expiry day./);
  expect(screen.getByRole("button", { name: "Add event" })).toBeTruthy();
  await userEvent.click(screen.getByRole("tab", { name: "Limits" }));
  expect(screen.getByLabelText("Trading capital (₹)").value).toBe("1000000");
});

test("saving the limits sends them; an admin who is not the owner sees no proposals and no limits", async () => {
  mockApi.mockResolvedValue(board());
  render(panel());
  await settle();
  await userEvent.click(screen.getByRole("tab", { name: "Limits" }));
  await userEvent.clear(screen.getByLabelText("Trading capital (₹)"));
  await userEvent.type(screen.getByLabelText("Trading capital (₹)"), "2500000");
  mockApi.mockResolvedValue({});
  await userEvent.click(screen.getByRole("button", { name: "Save limits" }));
  expect(mockApi).toHaveBeenCalledWith("/api/admin/autopilot/settings", expect.objectContaining({ method: "PUT", body: expect.objectContaining({ capital: "2500000", riskPct: 0.5, on: true }) }));

  mockApi.mockReset();
  mockApi.mockResolvedValue(board({ proposals: [], settings: { on: true } }));
  render(panel("admin", null));
  await settle();
  const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
  expect(tabs).toEqual(expect.arrayContaining(["Scorecard", "Events"]));
  expect(screen.queryAllByRole("tab", { name: "Limits" }).length).toBe(1, "only the owner's panel has it");
});

test("with no capital set the panel says why nothing is proposed, and a holiday is named", async () => {
  mockApi.mockResolvedValue(board({ settings: { ...board().settings, capital: 0 }, proposals: [], today: { date: "2026-11-10", tradingDay: false, holiday: "Diwali — Balipratipada", known: true } }));
  render(panel());
  await settle();
  expect(screen.getByText(/Set your trading capital under Limits/)).toBeTruthy();
  expect(screen.getByText(/today is a market holiday \(Diwali — Balipratipada\)/)).toBeTruthy();
});
