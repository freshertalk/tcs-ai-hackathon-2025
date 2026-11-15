import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { AuthContext } from "../auth";
import Social from "./Social";

const mockAt = (min) => new Date(Date.now() - min * 60000).toISOString();
const mockReading = (o) => ({ relevant: true, symbols: [], sectors: [], event: "other", sentiment: 0, impact: "low", summary: "", by: "rules", ...o });
const mockItems = [
  { id: "a1", type: "rss", sourceLabel: "Economic Times · Markets", title: "SBI Q2 net profit jumps 28%; shares rise", link: "https://e.test/sbi", text: "", at: mockAt(5), seenAt: mockAt(4), reading: mockReading({ symbols: ["SBIN"], sectors: ["banks"], event: "results", sentiment: 1, impact: "high", summary: "SBI beat estimates with a 28% profit rise.", by: "ai" }), ai: { by: "Claude Sonnet 5.5" } },
  { id: "b2", type: "x", sourceLabel: "X · @RBI", author: "@RBI", title: "RBI keeps the repo rate at 5.5%", link: "https://x.com/RBI/status/1", text: "", at: mockAt(9), seenAt: mockAt(8), reading: mockReading({ sectors: ["banks"], event: "policy", impact: "medium" }), metrics: { likes: 120, reposts: 40 } },
  { id: "c3", type: "reddit", sourceLabel: "Reddit · r/IndianStreetBets", title: "Reliance slump after weak margins?", link: "https://reddit.test/r", text: "", at: mockAt(20), seenAt: mockAt(19), reading: mockReading({ symbols: ["RELIANCE"], sentiment: -1, impact: "medium" }) },
];
const mockSettings = {
  sources: [
    { id: "s1", type: "google", value: "Nifty Sensex stock market", label: "Google News · Nifty & Sensex", enabled: true, everyMin: 10, lastAt: mockAt(2), lastOk: mockAt(2), error: "", count: 40, needsKey: false },
    { id: "s2", type: "x", value: "RBI", label: "X · @RBI", enabled: true, everyMin: 15, lastAt: mockAt(2), lastOk: null, error: "Needs your X API Bearer Token", count: 0, needsKey: true },
  ],
  sectors: ["banks", "it"],
  keywords: ["capex"],
  watch: ["SBIN"],
  aiOn: true,
  aiMode: "smart",
  aiPerHour: 4,
  aiBriefAuto: false,
  alertMe: true,
  creds: { x: false },
  kinds: { rss: { name: "News site (RSS)", hint: "https://…" }, google: { name: "Google News search", hint: "words" }, youtube: { name: "YouTube channel", hint: "UC…" }, reddit: { name: "Reddit community", hint: "name" }, x: { name: "X account", hint: "handle" } },
  sectorList: [
    { id: "banks", name: "Banks & financials" },
    { id: "it", name: "IT & tech" },
    { id: "pharma", name: "Pharma & health" },
  ],
  presets: [{ type: "x", value: "NSEIndia", label: "X · @NSEIndia" }],
  aiReady: true,
};
const mockDigest = {
  hours: 24,
  items: 3,
  total: 3,
  aiRead: 1,
  mood: { score: 35, label: "Positive" },
  radar: [{ symbol: "SBIN", mentions: 2, sentiment: 0.8, tone: "bullish", watched: true, top: { title: "SBI Q2", link: "https://e.test/sbi", summary: "SBI beat estimates." }, last: mockAt(5) }],
  sectors: [{ id: "banks", name: "Banks & financials", mentions: 2, sentiment: 0.5, tone: "bullish" }],
  events: [{ id: "a1", event: "results" }],
  alerts: [{ id: "a1", at: mockAt(5), title: "SBI Q2", link: "https://e.test/sbi", source: "ET", impact: "high", sentiment: 1, symbols: ["SBIN"], summary: "SBI beat estimates.", why: "a stock you watch" }],
  deskBrief: { headline: "Positive news mood (+35) across 3 market items; most talked about: SBIN.", mood: "risk_on", themes: [{ title: "Results", detail: "2 items, mostly positive." }], watch: [{ symbol: "SBIN", direction: "up", why: "2 items, bullish" }], sectors: [], risks: [], checklist: ["Read the latest on SBIN before trading it."], by: "the desk's rules (no AI)", ai: false, at: mockAt(1), items: 3 },
  brief: { headline: "Banks lead on results", mood: "risk_on", themes: [{ title: "Bank results", detail: "SBI beat." }], watch: [{ symbol: "SBIN", direction: "up", why: "Profit up 28%." }], sectors: [], risks: ["One post is unverified."], checklist: ["Check the opening range."], by: "Claude Sonnet 5.5", at: mockAt(10), items: 3 },
};
const mockCalls = [];
jest.mock("../api", () => ({
  api: (url, opts = {}) => {
    mockCalls.push([url, opts.method || "GET", opts.body]);
    if (url.startsWith("/api/admin/social/feed")) return Promise.resolve({ items: mockItems, total: 3, polledAt: new Date().toISOString() });
    if (url.startsWith("/api/admin/social/digest")) return Promise.resolve(mockDigest);
    if (url === "/api/admin/social/creds") return Promise.resolve({ settings: { ...mockSettings, creds: { x: true } } });
    if (url === "/api/admin/social") return Promise.resolve({ settings: mockSettings, status: { sources: 2, on: 2, failing: 1, items: 3, polledAt: new Date().toISOString(), aiOn: true, aiReady: true, model: "Claude Sonnet 5.5 (Anthropic)" }, watch: { running: true } });
    return Promise.resolve({ settings: mockSettings });
  },
}));
jest.mock("../dialog/DialogProvider", () => ({ useDialog: () => async () => true }));
jest.mock("../Shell", () => ({ children }) => <div>{children}</div>);

const page = (role = "superadmin") => (
  <AuthContext.Provider value={{ loading: false, user: { email: "o@example.com", name: "Owner", role }, reload() {} }}>
    <div className="adm">
      <Social />
    </div>
  </AuthContext.Provider>
);
const list = () => within(document.querySelector(".soc-list"));
const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));

beforeEach(() => {
  mockCalls.length = 0;
  window.scrollTo = () => {};
});

test("the live feed, the ticker and the organised picture: tone in words, the AI brief, the radar", async () => {
  render(page());
  await settle();
  expect(screen.getByRole("region", { name: /Latest market headlines/ })).toBeTruthy();
  expect(list().getByRole("link", { name: "SBI Q2 net profit jumps 28%; shares rise" })).toBeTruthy();
  expect(list().getByText("SBI beat estimates with a 28% profit rise.")).toBeTruthy();
  expect(screen.getAllByText("Bullish").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Bearish").length).toBeGreaterThan(0);
  expect(screen.getByText("Banks lead on results")).toBeTruthy();
  expect(screen.getByText(/Positive/, { selector: "b" })).toBeTruthy();
  expect(screen.getByText(/Claude Sonnet 5.5 \(Anthropic\)/)).toBeTruthy();
  expect(screen.getByText(/1 failing/)).toBeTruthy();
});

test("filters: a stock from the radar, and the kind of source", async () => {
  render(page());
  await settle();
  fireEvent.click(screen.getAllByRole("button", { name: "SBIN" })[0]);
  expect(list().queryByText("RBI keeps the repo rate at 5.5%")).toBeNull();
  expect(screen.getByText(/Showing only/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Clear the SBIN filter/ }));
  fireEvent.click(screen.getByRole("button", { name: "X", pressed: false }));
  expect(list().getByText("RBI keeps the repo rate at 5.5%")).toBeTruthy();
  expect(list().queryByText("Reliance slump after weak margins?")).toBeNull();
});

test("the superadmin's settings: sources with their state, suggestions, and the X token as a password field", async () => {
  render(page());
  await settle();
  fireEvent.click(screen.getByRole("button", { name: /Sources & settings/ }));
  expect(screen.getAllByText("X · @RBI").length).toBeGreaterThan(0);
  expect(screen.getByText(/needs the X token below|Needs your X API Bearer Token/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "+ X · @NSEIndia" })).toBeTruthy();
  const token = screen.getByLabelText(/X API Bearer Token/);
  expect(token.getAttribute("type")).toBe("password");
  fireEvent.change(token, { target: { value: "TESTONLY-x-bearer-token-0123456789abcdef" } });
  fireEvent.click(screen.getByRole("button", { name: "Save token" }));
  await settle();
  expect(mockCalls.some(([u, m, b]) => u === "/api/admin/social/creds" && m === "PUT" && b.xToken)).toBe(true);
  expect(screen.getByText(/Why no usernames and passwords/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove X · @RBI" }));
  await settle();
  expect(mockCalls.some(([u, m]) => u === "/api/admin/social/sources/s2" && m === "DELETE")).toBe(true);
});

test("an admin reads the feed but gets no settings", async () => {
  render(page("admin"));
  await settle();
  expect(list().getByRole("link", { name: "SBI Q2 net profit jumps 28%; shares rise" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Sources & settings/ })).toBeNull();
});

test("without an AI brief the desk's own brief shows (no AI, no cost); the AI mode and alerts are settings", async () => {
  const keep = mockDigest.brief;
  mockDigest.brief = null;
  try {
    render(page());
    await settle();
    expect(screen.getByRole("heading", { name: "Desk brief" })).toBeTruthy();
    expect(screen.getByText(/most talked about: SBIN/)).toBeTruthy();
    expect(screen.getByText(/Written by the desk’s rules — no AI, no cost/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ask the AI" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Sources & settings/ }));
    const mode = screen.getByLabelText(/When the AI reads an item/);
    expect(mode.value).toBe("smart");
    fireEvent.change(mode, { target: { value: "off" } });
    await settle();
    expect(mockCalls.some(([u, m, b]) => u === "/api/admin/social/settings" && m === "PUT" && b.aiMode === "off")).toBe(true);
    expect(screen.getByLabelText(/Alert me on Telegram/)).toBeTruthy();
  } finally {
    mockDigest.brief = keep;
  }
});
