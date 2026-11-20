import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

jest.mock("../../api", () => ({ api: jest.fn(), peek: jest.fn(() => null) }));
jest.mock("../../visible", () => ({ everyVisible: () => () => {} }));
jest.mock("../../auth", () => ({ useAuth: () => ({ user: { role: "superadmin" } }) }));
// eslint-disable-next-line import/first
import { api } from "../../api";
// eslint-disable-next-line import/first
import EvidenceCard, { EvidenceBoard, PositionEvidence } from "./EvidenceCard";

const rec = (verdict, n = 0, right = null, edge = null) => ({ n, days: n ? 180 : 0, right, edge, verdict });
const ai = (read = null, over = {}) => ({ mode: "need", ready: true, busy: false, usedToday: 3, perDay: 40, record: { n: 12, ok: 7, right: 0.5833 }, read, ...over });
const call = (key, over = {}) => ({
  key,
  minutes: Number(key),
  at: "2026-11-20T05:55:00.000Z",
  lean: "up",
  tier: "clear",
  pUp: 0.47,
  pDown: 0.29,
  usualUp: 0.38,
  usualDown: 0.37,
  proven: true,
  right: 0.57,
  n: 6400,
  uses: "techniques",
  adds: 0.0041,
  why: [{ id: "vwapPull", name: "Pullback to VWAP in a trend", push: 0.031 }, { id: "rsi2", name: "RSI(2) at an extreme", push: -0.012 }],
  live: [],
  forecaster: { pUp: 0.56, pct: 0.04, price: 1433, low: 1430, high: 1436 },
  read: "The evidence leans UP by 11:25 (9 min): 47% against a usual 38%. Leans this firm were right 57% of 6,400 times on unseen sessions.",
  ...over,
});
const view = (over = {}) => ({
  symbol: "RELIANCE",
  trained: true,
  techniques: 35,
  available: true,
  reason: "",
  closed: false,
  asOf: "2026-11-20T05:41:10.000Z",
  anchor: { at: "2026-11-20T05:40:00.000Z", price: 1432.5 },
  last: 1432.6,
  calls: [call("5", { lean: "none", tier: "none", proven: false, n: 0, right: null, why: [], read: "No clear lean by 11:15 (4 min): a rise is 39% likely (usual 38%), a fall 36% (usual 37%).", uses: "forecaster" }), call("15")],
  first: { minutes: 30, by: "2026-11-20T06:10:00.000Z", movePct: 0.28, up: { price: 1436.5, p: 0.38, usual: 0.31 }, down: { price: 1428.5, p: 0.27, usual: 0.3 }, lean: "up", tier: "clear", proven: false, right: 0.55, n: 420, uses: "techniques", read: "Within 30 minutes…" },
  regime: { name: "trend", er: 0.52 },
  count: { up: 6, down: 2, silent: 31, provenUp: 2, provenDown: 0 },
  witnesses: [
    { id: "vwapPull", name: "Pullback to VWAP in a trend", fam: "Pullback", what: "In a move that has stayed on one side of VWAP, the price came back to VWAP and closed away from it again.", state: 1, text: "came back to VWAP 1,430.20 in an up-move and closed up from it", record: { 5: rec("works", 9100, 0.53, 0.04), 15: rec("works", 9000, 0.54, 0.05) }, regime: { name: "trend", 5: rec("works", 3200, 0.55, 0.06), 15: rec("works", 3100, 0.56, 0.07) } },
    { id: "rsi2", name: "RSI(2) at an extreme", fam: "Reversal", what: "Connors' two-period RSI below 5 or above 95.", state: -1, text: "RSI(2) is 96.4", record: { 5: rec("backwards", 22000, 0.47, -0.05), 15: rec("backwards", 21000, 0.48, -0.03) }, regime: { name: "trend", 5: rec("thin", 90, 0.5, 0), 15: rec("thin", 88, 0.5, 0) } },
    { id: "pinBar", name: "Pin bar (long rejection wick)", fam: "Reversal", what: "A bar whose wick is most of its range.", state: 1, text: "a long lower wick: the fall was rejected", record: { 5: rec("none", 14000, 0.5, 0.001), 15: rec("none", 13800, 0.5, 0) } },
  ],
  live: [
    { id: "book5", name: "The 5 best bids against the 5 best offers", fam: "Order book", what: "Shares waiting to buy against shares waiting to sell at the five nearest prices.", state: 1, text: "8,700 shares bid against 2,900 offered at the 5 nearest prices (buyers 75%)", record: { 5: rec("thin", 12, 0.58, 0.1), 15: rec("thin", 12, 0.5, 0) } },
    { id: "oi15", name: "Futures open interest against price", fam: "Futures & options", what: "Price up with open interest up is a long build-up.", state: 1, text: "futures open interest +0.60% in 15 minutes: long build-up", record: { 5: rec("thin"), 15: rec("thin") } },
    { id: "tide", name: "The NIFTY tide", fam: "NSE market", what: "The index's day, its 5-minute trend, the sectors and India VIX read as one.", state: -1, text: "Falling tide (−9): Nifty −0.60% on the day.", record: { 5: rec("thin"), 15: rec("thin") } },
    { id: "sensex", name: "SENSEX beside NIFTY", fam: "BSE", what: "The two exchanges' indices move together.", state: 0, text: "SENSEX −0.55%, NIFTY −0.60%: the two exchanges agree", record: { 5: rec("thin"), 15: rec("thin") } },
    { id: "gift", name: "GIFT NIFTY", fam: "World", what: "NIFTY futures on the international exchange at GIFT City.", state: -1, text: "GIFT NIFTY −0.95% against NIFTY −0.60%: it is pricing the index lower", record: { 5: rec("thin"), 15: rec("thin") } },
    { id: "us", name: "Wall Street's last session", fam: "World", what: "The S&P 500 and the Nasdaq.", state: 0, text: "S&P 500 −1.10%, Nasdaq −1.60% in its last session (in the price since the open)", record: { 5: rec("thin"), 15: rec("thin") } },
  ],
  book: {
    nse: { bids: [{ price: 1432.4, qty: 4000, orders: 12 }, { price: 1432.3, qty: 1500, orders: 6 }], asks: [{ price: 1432.6, qty: 300, orders: 2 }, { price: 1432.7, qty: 700, orders: 3 }], bidQty: 8700, askQty: 2900, buyTotal: 640000, sellTotal: 360000, spread: 0.2, spreadPct: 0.014, imbalance: 0.5, wall: null },
    bse: { bids: [{ price: 1432.2, qty: 200, orders: 2 }], asks: [{ price: 1432.7, qty: 900, orders: 4 }], bidQty: 200, askQty: 900, buyTotal: 5000, sellTotal: 9000, last: 1432.3, changePct: 0.4, volume: 100000 },
  },
  volume: { today: 900000, vwap: 1430.2, buyQty: 640000, sellQty: 360000 },
  indicators: { rsi14: 61.2, rsi2: 96.4, vwap: 1430.2, vsVwapPct: 0.17, vwapBands: 0.8, bollinger: { pctB: 0.82, upper: 1434.1, mid: 1430.5, lower: 1426.9 }, macdHist: 0.31, adx: 27.4, plusDI: 24.1, minusDI: 15.3, supertrend: { dir: "up", line: 1427.8 }, ema9: 1431.6, ema20: 1430.4, volumeTimesUsual: 1.4, atr5: 2.1, usualMovePct: 0.16 },
  levels: [{ name: "Day high", price: 1436, side: "above", awayPct: 0.24, moves: 1.5 }, { name: "VWAP", price: 1430.2, side: "below", awayPct: -0.17, moves: -1.05 }],
  sources: [{ name: "Order book on NSE (5 best bids and offers, all pending orders)", ok: true, note: "" }, { name: "Wall Street and Asia", ok: false, note: "Add a Financial Modeling Prep API key to see the overseas indices." }],
  rule: "On every finished 5-minute bar the desk asks 35 day-trading techniques what they see. No call is certain: read 58% as 58%.",
  checkRule: "Every call kept is checked 5 and 15 minutes after it was made.",
  ai: ai(),
  ...over,
});

beforeEach(() => api.mockReset());

test("the board says the call for 5 and 15 minutes with its chances beside the usual rates, and whether a lean of that firmness is proven", async () => {
  api.mockResolvedValue(view());
  render(<EvidenceCard symbol="RELIANCE" />);
  await waitFor(() => expect(screen.getByText("Next 15 minutes")).toBeTruthy());
  const card = document.querySelector(".ev");
  expect(card.className).toMatch(/ah--up/);
  const [c5, c15] = document.querySelectorAll(".ev-call");
  expect(c5.textContent).toMatch(/Next 5 minutes.*NO CLEAR LEAN/);
  expect(c5.textContent).toMatch(/This call is the forecaster's own, calibrated/);
  expect(c15.querySelector(".ev-lean strong").textContent).toBe("UP");
  expect(c15.querySelector(".ev-proof").textContent).toBe("proven · right 57% of 6,400");
  expect(c15.textContent).toMatch(/Rise47% usual 38%/);
  expect(c15.textContent).toMatch(/Fall29% usual 37%/);
  // the meter is filled to the chance, with its tick at the usual rate
  expect(c15.querySelector(".ah-meter--up i").style.width).toBe("47%");
  expect(c15.querySelector(".ah-meter--up u").style.left).toBe("38%");
  // what pushed it, and what pulled against
  expect(c15.querySelector(".ev-push.is-for").textContent).toBe("+ Pullback to VWAP in a trend");
  expect(c15.querySelector(".ev-push.is-against").textContent).toBe("− RSI(2) at an extreme");
  expect(c15.textContent).toMatch(/The techniques are in this call: with them it missed 0\.4% less than the forecaster alone/);
  // which comes first within 30 minutes: the two prices, each with its chance beside its usual rate
  const first = document.querySelector(".ev-first");
  expect(first.className).toMatch(/ev-first--up/);
  expect(first.textContent).toMatch(/Which comes first, within 30 minutesa move of 0\.28% either way · not proven yet/);
  expect(first.textContent).toMatch(/▲ 1,436\.5038% usual 31%/);
  expect(first.textContent).toMatch(/▽ 1,428\.5027% usual 30%/);
  // how many readings lean each way, and how many of those have a proven record
  expect(document.querySelector(".ev-count").textContent).toMatch(/▲ 6 lean up.*▽ 2 lean down.*proven: 2 up, 0 down.*31 techniques silent.*the stock is trending now/);
  // it was only read: opening is announced by the Desk alone
  expect(api.mock.calls.map((c) => c[0])).toEqual(["/api/admin/market/evidence/RELIANCE"]);
});

test("every technique speaking shows what it saw and its own record; the order book is shown price by price on both exchanges; the live readings are grouped", async () => {
  api.mockResolvedValue(view());
  render(<EvidenceCard symbol="RELIANCE" />);
  await waitFor(() => expect(screen.getByText("Techniques speaking now")).toBeTruthy());
  const rows = [...document.querySelectorAll(".ev-sec")[0].querySelectorAll(".ev-row")];
  expect(rows.length).toBe(3);
  expect(rows[0].className).toMatch(/is-up/);
  // its record for the regime the stock is in now, when it has spoken often enough there…
  expect(rows[0].textContent).toMatch(/Pullback to VWAP in a trend.*came back to VWAP 1,430\.20.*in a trend: works here · went its way 56% of 3,100/);
  expect(rows[1].className).toMatch(/is-down/);
  // …and its overall record when it has not; a textbook signal that fails here is said to fail here
  expect(rows[1].querySelector(".ev-rec--backwards").textContent).toBe("works the other way here · went its way 48% of 21,000");
  expect(rows[2].querySelector(".ev-rec--none").textContent).toMatch(/no edge found here/);
  // the ladders: bids on the left, offers on the right, with shares and orders at each price
  const [nse, bse] = document.querySelectorAll(".ev-ladder");
  expect(nse.querySelector(".ev-ladder__cap").textContent).toMatch(/NSE · 8,700 shares bid, 2,900 offered at these prices · all pending orders: 6,40,000 to buy, 3,60,000 to sell/);
  const first = nse.querySelectorAll("tbody tr")[0];
  expect([...first.querySelectorAll("td")].map((td) => td.textContent)).toEqual(["4,000 ×12", "1,432.40", "1,432.60", "300 ×2"]);
  // the bar behind each quantity is drawn against the largest level shown
  expect(first.querySelector(".ev-ladder__q--bid i").style.width).toBe("100%");
  expect(first.querySelector(".ev-ladder__q--ask i").style.width).toBe("8%");
  expect(bse.querySelector(".ev-ladder__cap").textContent).toMatch(/BSE · 200 shares bid, 900 offered/);
  // the groups of live readings, each row with its lean; a reading with no lean is shown as a reading
  const titles = [...document.querySelectorAll(".ev-sec > summary")].map((x) => x.textContent);
  expect(titles.some((t) => /^Futures & options/.test(t))).toBe(true);
  expect(titles.some((t) => /^NSE market 0 up, 1 down/.test(t))).toBe(true);
  expect(titles.some((t) => /^World 0 up, 1 down/.test(t))).toBe(true);
  expect(screen.getByText(/GIFT NIFTY −0\.95% against NIFTY −0\.60%/)).toBeTruthy();
  expect(screen.getByText(/in the price since the open/).closest(".ev-row").className).toMatch(/is-flat/);
  expect(screen.getByText(/8,700 shares bid against 2,900 offered/).closest(".ev-row").querySelector(".ev-rec").textContent).toMatch(/too few cases yet/);
  // indicators, levels, and what could not be read
  expect(document.querySelector(".ev-ind").textContent).toMatch(/RSI \(14\)61\.2.*Bollinger %B0\.82.*Supertrendup \(1,427\.80\)/);
  expect(screen.getByText("Day high").closest("tr").textContent).toMatch(/1,436\.00\+0\.24%1\.5/);
  expect(document.querySelector(".ev-missing").textContent).toMatch(/Not read just now: Wall Street and Asia — Add a Financial Modeling Prep API key/);
  expect(screen.getByText(/No call is certain: read 58% as 58%/)).toBeTruthy();
});

test("on the Desk the server is told the stock was opened; the AI's read is shown with its reason, and “Ask the AI” is a button", async () => {
  const read = { at: "2026-11-20T05:42:00.000Z", lean: "down", confidence: "medium", why: "Buyers hold 75% of the 5 nearest prices, but GIFT NIFTY is 0.35 points weaker than NIFTY.", watch: "A close under VWAP 1,430.20.", invalid: 1436, risk: "The tide turning up.", by: "Sonnet 5.5", trigger: "the readings disagree (6 lean up, 2 lean down)", price: 1432.6, settled: false, ok: null };
  api.mockImplementation((url, opts) => {
    if (opts && opts.method === "POST" && url.endsWith("/open")) return Promise.resolve({ asked: false, why: "The AI read this stock 4 minutes ago." });
    if (opts && opts.method === "POST" && url.endsWith("/ai")) return Promise.resolve(ai({ ...read, lean: "up", trigger: "you asked" }, { usedToday: 3 }));
    return Promise.resolve(view({ ai: ai(read) }));
  });
  render(<EvidenceCard symbol="RELIANCE" announce />);
  await waitFor(() => expect(document.querySelector(".ev-ai__lean")).toBeTruthy());
  expect(api.mock.calls.some((c) => c[0] === "/api/admin/market/evidence/RELIANCE/open" && c[1].method === "POST")).toBe(true);
  const box = document.querySelector(".ev-ai");
  expect(box.className).toMatch(/ev-ai--down/);
  expect(box.textContent).toMatch(/reads a stock you open when the readings are undecided · 3 of 40 automatic reads today · its reads were right 58% of 12 checked/);
  expect(box.textContent).toMatch(/DOWN for the next 15 minutes · medium confidence.*Sonnet 5\.5.*asked because the readings disagree \(6 lean up, 2 lean down\)/);
  expect(box.textContent).toMatch(/Watch: A close under VWAP 1,430\.20\./);
  expect(box.textContent).toMatch(/Wrong if it breaks: 1,436\.00/);
  expect(box.textContent).toMatch(/Risk: The tide turning up\./);
  // the button asks now: one request, and the answer replaces what was shown
  fireEvent.click(screen.getByText("Ask the AI"));
  await waitFor(() => expect(document.querySelector(".ev-ai").className).toMatch(/ev-ai--up/));
  expect(api.mock.calls.filter((c) => c[0] === "/api/admin/market/evidence/RELIANCE/ai").length).toBe(1);
  expect(document.querySelector(".ev-ai").textContent).toMatch(/asked because you asked/);
});

test("with no read it says why the AI was not asked; with no model the button is off; compact shows the call only; a board that cannot be read gives its reason", async () => {
  api.mockImplementation((url, opts) => (opts && opts.method === "POST" ? Promise.resolve({ asked: false, why: "the readings agree and the call is clear: no AI was needed" }) : Promise.resolve(view({ ai: ai(null, { ready: false }) }))));
  const { unmount } = render(<EvidenceCard symbol="RELIANCE" announce />);
  await waitFor(() => expect(screen.getByText(/Not asked: the readings agree and the call is clear: no AI was needed/)).toBeTruthy());
  expect(screen.getByText("Ask the AI").disabled).toBe(true);
  unmount();

  api.mockReset();
  api.mockResolvedValue(view());
  const c = render(<EvidenceCard symbol="RELIANCE" compact />);
  await waitFor(() => expect(screen.getByText("Next 15 minutes")).toBeTruthy());
  expect(document.querySelector(".ev-count")).toBeTruthy();
  expect(document.querySelector(".ev-sec")).toBeNull();
  expect(document.querySelector(".ev-ladder")).toBeNull();
  c.unmount();

  api.mockReset();
  api.mockResolvedValue({ symbol: "RELIANCE", trained: false, techniques: 35, available: false, reason: "The 15-minute forecast needs live prices: connect Zerodha.", ai: ai() });
  render(<EvidenceCard symbol="RELIANCE" />);
  await waitFor(() => expect(screen.getByText("The 15-minute forecast needs live prices: connect Zerodha.")).toBeTruthy());
  expect(document.querySelector(".ev-call")).toBeNull();
});

test("the board in Research: the call on unseen sessions against the forecaster alone, each technique's record, the live readings and the owner's buttons", async () => {
  const sum = (on, adds, all, alone) => ({ n: 31000, adds, on, all, alone, tiers: { strong: { n: 400, right: 0.61, proven: false }, clear: { n: 2500, right: 0.57, proven: true }, slight: { n: 6100, right: 0.53, proven: true } } });
  const board = {
    trained: true,
    learning: { trainedAt: "2026-11-19T10:25:00.000Z", rows: 1240000, sessions: 240, lastDate: "2026-11-19", days: 3, now: { 1: sum(false, 0.0002, { n: 5200, right: 0.54, proven: true }, { n: 5000, right: 0.54, proven: true }), 3: sum(true, 0.0041, { n: 9000, right: 0.55, proven: true }, { n: 7000, right: 0.53, proven: true }), tb: sum(true, 0.002, { n: 3000, right: 0.56, proven: true }, { n: 2500, right: 0.54, proven: true }) } },
    techniques: view().witnesses.map((w) => ({ id: w.id, name: w.name, fam: w.fam, what: w.what, record: w.record, trend15: rec("works", 3100, 0.56, 0.07), range15: rec("none", 5900, 0.51, 0.01), weight15: { trend: 0.03, range: 0.01 } })),
    live: view().live.map((w) => ({ id: w.id, name: w.name, fam: w.fam, what: w.what, record: w.record })),
    days: [{ date: "2026-11-19", rows: 7400, call5: { all: { n: 300, right: 0.52 }, alone: { n: 280, right: 0.52 } }, call15: { all: { n: 520, right: 0.56 }, alone: { n: 410, right: 0.53 } } }],
    liveCalls: { 1: { n: 0, ok: 0 }, 3: { n: 40, ok: 24 } },
    checked: 64,
    ai: ai().record && { mode: "need", perDay: 40, usedToday: 3, record: { n: 12, right: 0.5833 } },
    job: null,
    error: "",
    rule: "On every finished 5-minute bar…",
    checkRule: "Every call kept is checked…",
  };
  api.mockResolvedValue(board);
  render(<EvidenceBoard />);
  await waitFor(() => expect(screen.getByText("Evidence desk · what it has measured")).toBeTruthy());
  expect(screen.getByText(/learned from 12,40,000 bars of 240 sessions/)).toBeTruthy();
  const tables = document.querySelectorAll("table");
  // the call: where the techniques are in use, and how a lean did against the forecaster alone
  expect(tables[0].querySelector("caption").textContent).toMatch(/Checked live so far: 5 min none checked yet, 15 min 60% of 40/);
  const [r5, r15] = tables[0].querySelectorAll("tbody tr");
  expect(r5.textContent).toMatch(/5 minutesnot in use \(no real gain\)54% of 5,20054% of 5,000/);
  expect(r15.textContent).toMatch(/15 minutesin use · cut the miss by 0\.4%55% of 9,00053% of 7,000/);
  expect(tables[0].querySelectorAll("tbody tr")[2].textContent).toMatch(/Which first, 30 minin use · cut the miss by 0\.2%56% of 3,00054% of 2,500/);
  // each technique with its record and its verdict
  expect(tables[1].textContent).toMatch(/Pullback to VWAP in a trendPullback53% of 9,10054% of 9,000works here56% of 3,10051% of 5,900/);
  expect(tables[1].textContent).toMatch(/RSI\(2\) at an extremeReversal47% of 22,00048% of 21,000works the other way here/);
  // the live readings, with how many calls have been checked
  expect(tables[2].querySelector("caption").textContent).toMatch(/64 calls checked so far/);
  expect(tables[3].textContent).toMatch(/7,40052% of 30056% of 52053% of 410/);
  expect(screen.getByText(/AI reads on opening a stock: only when the readings are undecided · 3 of 40 used today · right 58% of 12 checked/)).toBeTruthy();
  // the owner's buttons
  fireEvent.click(screen.getByText("Learn new sessions"));
  await waitFor(() => expect(api.mock.calls.some((c) => c[0] === "/api/admin/market/evidence/learn" && c[1].method === "POST")).toBe(true));
});

test("a position's line: the lean for its next 15 minutes, and whether it is with the position or against it", () => {
  const { container, rerender } = render(<PositionEvidence reading={{ available: true, lean: "down", p: 0.48, against: true, proven: true, text: "The evidence leans DOWN…", up: 2, down: 6 }} />);
  expect(container.querySelector(".ev-pos--against").textContent).toBe("DOWN 48%against you · next 15 min");
  rerender(<PositionEvidence reading={{ available: true, lean: "up", p: 0.44, against: false, proven: false, text: "The evidence leans slightly UP…", up: 4, down: 1 }} />);
  expect(container.querySelector(".ev-pos--with").textContent).toBe("UP 44%with you · next 15 minnot proven");
  rerender(<PositionEvidence reading={{ available: true, lean: "none", against: false, text: "No clear lean for the next 15 minutes.", up: 1, down: 1 }} />);
  expect(container.querySelector(".ev-pos--flat").textContent).toBe("No clear leannext 15 min");
  rerender(<PositionEvidence reading={{ available: false, reason: "The market has closed." }} />);
  expect(container.querySelector(".ev-pos")).toBeNull();
});
