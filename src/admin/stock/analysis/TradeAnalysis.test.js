import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import TradeAnalysis from "./TradeAnalysis";
import { TradeChart } from "./LabExtras";

const mockLab = {
  available: true,
  date: "2026-11-13",
  summary: { trades: 2, replayed: 2, gross: 900, charges: 60, net: 840, capture: 42, ranOn: 1500, avoided: 700, score: 58, label: "Mixed" },
  rules: [
    { id: "actual", name: "Your exits", net: 840, trades: 2, vsActual: 0 },
    { id: "fixed", name: "Stop 0.5% · target 1% (2R)", net: 1200, trades: 2, vsActual: 360 },
    { id: "trail", name: "Trailing stop 0.5%", net: 1500, trades: 2, vsActual: 660 },
    { id: "breakeven", name: "Stop 0.5%, to break-even at +0.5%", net: 900, trades: 2, vsActual: 60 },
    { id: "close", name: "Hold to 3:15 PM", net: 300, trades: 2, vsActual: -540 },
  ],
  best: { id: "trail", name: "Trailing stop 0.5%", net: 1500, trades: 2, vsActual: 660 },
  flags: [{ id: "revenge", name: "Revenge trade", major: true, text: "In within 10 minutes of closing a loss.", count: 1, net: -420 }],
  trades: [
    { key: "a", symbol: "SBIN", side: "long", qty: 50, entryClock: "09:40", exitClock: "10:05", entryAvg: 800, exitAvg: 826, holdMin: 25, pnl: 1300, charges: 30, net: 1270, intraday: true, n: 1, read: { mfe: 2000, mae: -300, mfePct: 5, maePct: -0.75, capture: 65, ranOn: 900, avoided: 200, vsVwapPct: 0.4, opening: "above the opening range", rangePos: 70 }, whatIf: { trail: { exit: 830, how: "trail", net: 1470 } }, flags: [] },
    { key: "b", symbol: "INFY", side: "short", qty: 20, entryClock: "10:10", exitClock: "10:30", entryAvg: 1500, exitAvg: 1520, holdMin: 20, pnl: -400, charges: 30, net: -430, intraday: true, n: 2, read: { mfe: 100, mae: -500, mfePct: 0.33, maePct: -1.67, capture: null, ranOn: 600, avoided: 0, vsVwapPct: 0.2, rangePos: 40 }, whatIf: {}, flags: ["revenge", "againstVwap"] },
  ],
  limits: { stop: 1500, target: 3000 },
  notes: [],
};
const mockBoard = {
  at: "2026-11-13T05:12:00Z",
  marketOpen: true,
  connected: true,
  streaming: true,
  minutesToSquareOff: 272,
  positions: [
    {
      key: "NSE:SBIN:MIS",
      symbol: "SBIN",
      exchange: "NSE",
      product: "MIS",
      side: "long",
      qty: 50,
      avg: 800,
      entryAt: Date.parse("2026-11-13T04:10:00Z"),
      entryClock: "09:40",
      at: Date.parse("2026-11-13T05:12:00Z"),
      advice: {
        state: "exit-now",
        word: "EXIT NOW",
        pressure: 100,
        headline: "EXIT NOW — about ₹805.95. The trailing stop at ₹806.40 is hit.",
        exit: { price: 805.95, qty: 50, how: "market", limit: null, note: "At market: about ₹805.95." },
        stop: 806.4,
        stopKind: "trailing stop",
        target: 812.4,
        reasons: { exit: ["The trailing stop at ₹806.40 is hit.", "You have given back 55% of the best gain (+1.60% at 10:20, now +0.74%)."], hold: ["Above VWAP ₹803.20 (+0.34%)."] },
        metrics: { last: 805.95, pnl: 297.5, gainPct: 0.74, peak: { price: 812.8, clock: "10:20", gainPct: 1.6, pnl: 640 }, trough: { price: 799.2, clock: "09:44", gainPct: -0.1, pnl: -40 }, givebackPct: 55, minutesIn: 62, minutesToSquareOff: 272, vwap: 803.2, vsVwapPct: 0.34, rsi1: 41, move3Pct: -0.31, bid: 805.95, ask: 806.05, book: { pressure: -48, label: "Sellers pressing", buyersPct: 34, delta60: -4200, lean: "down", wall: null, spread: 0.1 }, pulse: { score: -31, lean: "down", low: 801.5, high: 809.4 } },
      },
      ai: null,
      path: [[Date.parse("2026-11-13T04:10:00Z"), 800], [Date.parse("2026-11-13T04:50:00Z"), 812.8], [Date.parse("2026-11-13T05:11:00Z"), 806.2]],
      frames: [[1, 10, 0], [2, 60, 2], [3, 100, 3]],
      events: [{ at: 1, clock: "09:40", kind: "entry", text: "Bought 50 at ₹800.00." }, { at: 2, clock: "10:42", kind: "signal", state: "exit-now", text: "EXIT NOW — about ₹805.95." }],
      news: null,
      levels: null,
      map: { at: 1, last: 805.95, anchors: [{ id: "A1", price: 810, label: "Previous day's high + Round number", strength: 4, side: "above", awayPct: 0.5, touches: 2, touchPct: 46 }, { id: "B1", price: 803.2, label: "VWAP", strength: 3, side: "below", awayPct: -0.34, touches: 3, touchPct: 71 }] },
    },
  ],
  other: [],
  landed: [{ id: "INFY-1", symbol: "INFY", side: "short", qty: 20, avg: 1500, exitAvg: 1492, pnl: 160, entryClock: "09:25", exitClock: "09:58", peak: { clock: "09:50", pnl: 260 }, givebackPct: 38, coachExit: { clock: "09:53", price: 1489.5 } }],
  market: { tide: { score: -22, label: "Falling", summary: "Falling tide" }, forecast: { word: "down", headline: "NSE leans down" }, mood: { label: "Mixed" }, goal: "ok" },
  settings: { aiMode: "change", aiDailyCap: 30, notify: true, aiToday: 2, aiReady: true, model: "Claude Sonnet 5.5" },
  watch: { error: "" },
};
const mockLevels = {
  id: "L1",
  at: 1,
  clock: "10:43",
  by: "Claude Sonnet 5.5",
  auto: false,
  why: "you asked",
  last: 805.95,
  confidence: "medium",
  outlook: "against",
  summary: "Take profit into the previous day's high; the tide is against holding for more.",
  targets: [{ n: 1, anchor: "A1", label: "Previous day's high + Round number", level: 810, price: 809.9, strength: 4, touches: 2, awayPct: 0.5, gainPct: 1.25, touchPct: 46, reach: "within reach", r: 1.6, firstPct: 38, why: "810 held twice today.", status: "open", reachedAt: null }],
  stop: { anchor: "coach", label: "The coach's stop", level: 804.4, price: 804.4, clamped: false, note: "", why: "", awayPct: -0.19, touchPct: 88, tight: false, status: "open", hitAt: null },
  reversal: { anchor: "A1", label: "Previous day's high + Round number", price: 810, sign: "Sellers above 60% of the five best levels." },
  rejected: [{ what: "target", price: 104, why: "“A9” is not a level on the desk's map." }],
  checks: { asked: 3, passed: 2, corrected: 0 },
  failed: false,
  outcome: null,
};
const mockCompare = {
  available: true,
  date: "2026-11-13",
  enough: true,
  headline: "+₹840 net against your usual +₹310; score 58 against 52. First to fix: revenge trade.",
  baseline: { days: 9 },
  versus: [{ id: "score", name: "Execution score", unit: "/100", today: 58, usual: 52, better: true }, { id: "net", name: "Net after charges", unit: "₹", today: 840, usual: 310, better: true }],
  prevent: [{ id: "revenge", habit: "Revenge trade", major: true, what: "In within 10 minutes of closing a loss.", kind: "again", today: { count: 1, net: -420 }, history: { count: 6, net: -3100, days: 4 }, evidence: "6 times on 4 of your last 9 trading days: −₹3,100 net.", action: "After a losing exit, wait 15 minutes before the next entry." }],
  keep: [{ id: "ctx", text: "Entering with VWAP (longs above it, shorts below) works for you: 14 trades, 64% won, ₹2,300 net. Keep to it." }],
  similarDays: [{ date: "2026-11-06", net: -900, text: "6 Nov: 4 trades, −₹900 net, score 44 — the same revenge trade." }],
  similarTrades: [{ key: "a", good: true, text: "Longs with VWAP around 9 AM: 7 earlier trades, 5 won, ₹1,900 net." }],
};
const T = (hhmm) => Date.parse(`2026-11-13T${hhmm}:00+05:30`);
const mockSnap = {
  available: true,
  date: "2026-11-13",
  summary: { trades: 2, net: 840, leftOnTable: 730, booked: 1, gaveBack: 1, leftEarly: 0, neverPaid: 0, cutInTime: 0, peak: { at: T("10:20"), clock: "10:20", pnl: 2640, holding: ["SBIN"] }, givenBack: 1800 },
  headline: ["The day's profit peaked at +₹2,640 at 10:20; it closed at +₹840, so ₹1,800 of the peak was given back."],
  day: { measured: true, peak: { at: T("10:20"), clock: "10:20", pnl: 2640, holding: ["SBIN"] }, trough: { at: T("09:44"), clock: "09:44", pnl: -40, holding: ["SBIN"] }, close: 840, givenBack: 1800, curve: Array.from({ length: 60 }, (_, i) => [T("09:15") + i * 5 * 60000, i < 24 ? i * 110 : 2640 - (i - 24) * 50]) },
  trades: [{ key: "a", symbol: "SBIN", side: "long", qty: 50, entryAt: T("09:40"), exitAt: T("10:05"), entryClock: "09:40", exitClock: "10:05", entryAvg: 800, exitAvg: 826, net: 1270, peak: { clock: "10:00", pnl: 2000, pct: 5 }, leftOnTable: 730, gapMin: 5, outcome: { id: "gave-back", name: "Stayed past the peak", tone: "bad", text: "The best moment was +₹2,000 at 10:00; you stayed 5 min longer." } }],
  moments: [{ at: T("09:40"), clock: "09:40", kind: "entry", text: "Bought 50 SBIN at ₹800.00." }, { at: T("10:00"), clock: "10:00", kind: "peak", text: "SBIN at its best while you were in: +₹2,000." }, { at: T("10:02"), clock: "10:02", kind: "signal", text: "SBIN: TIGHTEN — the buyers are tiring." }, { at: T("10:05"), clock: "10:05", kind: "exit", text: "You closed SBIN at ₹826.00." }],
  notes: [],
};
const mockOutcomes = {
  rows: [{ id: "2026-11-13:a", date: "2026-11-13", key: "a", symbol: "SBIN", side: "long", entryClock: "09:40", exitClock: "10:05", net: 1270, peakClock: "10:00", peakPnl: 2000, leftOnTable: 730, outcome: "gave-back", tone: "bad", text: "The best moment was +₹2,000 at 10:00." }, { id: "2026-11-13:b", date: "2026-11-13", key: "b", symbol: "INFY", side: "short", entryClock: "10:10", exitClock: "10:30", net: -430, peakClock: null, peakPnl: null, leftOnTable: null, outcome: "never-paid", tone: "bad", text: "The price never went meaningfully your way." }],
  total: 2,
  days: 1,
  summary: { trades: 2, net: 840, leftOnTable: 730, missedAfter: 0, peakOnOffer: 2000, took: 1270, byOutcome: [{ id: "gave-back", name: "Stayed past the peak", tone: "bad", count: 1, net: 1270, left: 730 }, { id: "never-paid", name: "Never paid", tone: "bad", count: 1, net: -430, left: 0 }] },
  outcomes: [{ id: "gave-back", name: "Stayed past the peak", tone: "bad" }, { id: "never-paid", name: "Never paid", tone: "bad" }],
};
const mockLearn = {
  days: 5,
  trades: 23,
  statuses: ["open", "working", "mastered", "ignored"],
  learnings: [
    { id: "o:gave-back", kind: "avoid", source: "measured", title: "Stayed past the peak", text: "A winner held well past its best moment.", rule: "Trail the stop under the move.", count: 3, days: 2, wins: 3, cost: 1450, net: 900, firstSeen: "2026-11-06", lastSeen: "2026-11-13", daysSince: 0, state: "repeating", status: "open", note: "", relapse: false, recent: [{ date: "2026-11-13", symbol: "SBIN", clock: "09:40", net: 1270, id: "x" }] },
    { id: "o:never-paid", kind: "avoid", source: "measured", title: "Never paid", text: "A trade the price never moved your way.", rule: "Wait for confirmation.", count: 2, days: 2, wins: 0, cost: 800, net: -800, firstSeen: "2026-11-05", lastSeen: "2026-11-13", daysSince: 0, state: "new", status: "mastered", note: "", masteredAt: "2026-11-10", relapse: true, recent: [] },
    { id: "k:near-best", kind: "keep", source: "measured", title: "Booked near the best", text: "You left within minutes of the best moment.", rule: "Keep doing this.", count: 4, days: 3, wins: 4, cost: 5200, net: 5200, firstSeen: "2026-11-05", lastSeen: "2026-11-12", daysSince: 1, state: "strength", status: "open", note: "", relapse: false, recent: [] },
  ],
};
const mockOutcome = { id: "gave-back", name: "Stayed past the peak", tone: "bad", text: "The best moment was +₹900 at 10:42; you stayed 12 min longer." };
const mockRobotBoard = {
  at: "2026-11-13T05:12:00Z",
  date: "2026-11-13",
  paperOnly: true,
  live: true,
  settings: { on: true, withAi: true, aiReady: true, capital: 1000000, riskPct: 0.5 },
  open: [{ id: "2026-11-13:ICICIBANK:2", symbol: "ICICIBANK", side: "long", qty: 400, qty0: 400, entryClock: "11:02", entryAvg: 1250.4, last: 1255.2, stop: 1246.1, stop0: 1246.1, t1: 1257, t2: 1261, risk: 4.3, pnl: 1920, r: 1.1, peak: { price: 1256, at: 1, clock: "11:20" }, peakR: 1.3, score: 62, agree: 80, why: ["above VWAP"], level: { name: "Pivot point" }, t1Hit: false, events: [] }],
  closed: [{ id: "2026-11-13:SBIN:1", symbol: "SBIN", side: "long", qty: 500, entryClock: "09:45", exitClock: "10:54", entryAvg: 800, exitAvg: 805, net: 1900, netR: 0.95, why: "giveback", peakClock: "10:42", peakPnl: 2800, outcome: mockOutcome, score: 58 }],
  decisions: [{ at: 1, clock: "11:30", symbol: "TCS", side: "short", action: "skip", why: "score 38 is under the 53 needed in the midday lull" }],
  day: { trades: 2, net: 3820, wins: 1, winPct: 100, netPct: 0.38 },
  log: [{ at: "x", text: "SBIN long: giveback, +₹1,900 (0.95R) — Stayed past the peak." }],
};
const mockRobotDay = {
  available: true,
  date: "2026-11-13",
  trades: [{ id: "2026-11-13:SBIN:1", symbol: "SBIN", side: "long", qty0: 500, entryClock: "09:45", exitClock: "10:54", entryAt: 1000, exitAt: 5000, entryAvg: 800, exitAvg: 805, net: 1900, stop0: 797, t1: 804.5, t2: 807, peak: { price: 807, at: 3000, clock: "10:42" }, peakR: 2.3, score: 58, agree: 70, outcome: mockOutcome, level: { name: "Yesterday's low", ev: 0.21, hit: 54 }, events: [{ at: 1000, clock: "09:45", kind: "entry", text: "Bought 500 SBIN at ₹800.24." }, { at: 4000, clock: "10:50", kind: "exit", text: "Gave back 52% of its best gain." }], frames: [[1000, 800, 0, 58], [2000, 803, 1500, 58], [3000, 807, 3500, 57], [4000, 805, 2500, 55]] }],
  decisions: [{ at: 1, clock: "09:50", symbol: "INFY", side: "long", action: "skip", why: "before 9:30: the opening range is still forming" }],
};
const mockRobotCompare = {
  date: "2026-11-13",
  available: true,
  you: { trades: 2, net: -100, winPct: 50, efficiency: 40 },
  robot: { trades: 2, net: 300, winPct: 100, efficiency: 70 },
  gap: 400,
  pairs: [{ symbol: "SBIN", side: "long", you: { key: "a", entryClock: "09:57", exitClock: "10:58", net: 400 }, robot: { entryClock: "09:45", exitClock: "10:54", net: 1900 }, youLaterMin: 12, entryEdgePct: -0.4, exitEdgePct: 0.1, netDiff: -1500, better: "robot" }],
  robotOnly: [{ key: "r1", symbol: "ICICIBANK", side: "long", entryClock: "11:02", exitClock: "11:50", net: 600, outcome: { name: "Booked near the best" } }],
  youOnly: [{ key: "y1", symbol: "TCS", side: "short", entryClock: "12:00", exitClock: "12:20", net: -500, reason: "score 38 is under the 53 needed in the midday lull" }],
  habits: [{ id: "revenge", name: "Revenge trade", count: 1, net: -500, answer: "The robot waits 30 minutes before it enters the same stock again." }],
  lessons: ["The robot took 2 trades and made +₹300; you took 2 and made −₹100 — the robot made ₹400 more."],
  sample: "One day is a small sample. The comparison says what happened on this day, not what will happen next.",
};
const mockRobotLearning = {
  trades: 24,
  sessions: 9,
  curve: [{ date: "2026-11-12", cum: 1200, rollBad: 40 }, { date: "2026-11-13", cum: 3100, rollBad: 33 }],
  mistakes: [{ id: "gave-back", title: "A winner held until it gave part back", text: "The trade stayed past its best moment.", count: 6, recent: 5, cost: 4200, lastSeen: "2026-11-13", state: "relapse", correction: { id: "c1", date: "2026-11-09", summary: "Give-back exit 50% → 45%" } }],
  corrections: [{ id: "c1", date: "2026-11-09", status: "active", title: "Take profit sooner on a winner", summary: "Give-back exit 50% → 45%", why: "6 of the last 24 trades stayed past their best moment." }, { id: "c0", date: "2026-11-02", status: "reverted", title: "Ask for a higher score", summary: "Minimum score 45 → 48", why: "x", result: { n: 8, avgR: -0.3, baseline: 0.1 } }],
  rules: { rows: [{ param: "giveBackPct", value: 45, start: 50, changed: true }, { param: "minScore", value: 45, start: 45, changed: false }] },
  notes: [{ date: "2026-11-13", review: "A fair day: two trades, one gave back part of its peak.", lessons: ["SBIN gave back 52% of +₹3,500."] }],
  skill: { series: [{ date: "2026-11-10", evaluated: true, avgR: 0.12, allAvgR: 0.02 }, { date: "2026-11-11", evaluated: true, avgR: 0.1, allAvgR: 0.03 }], graduation: { target: 15, studied: 7, marked: 2, tests: 20, meanGap: null, better: 0, of: 2, state: "learning", text: "7 of 15 sessions studied. It is not asked to suggest with confidence until it has seen 15." }, studied: 7, live: 1, backfilled: 6, from: "2026-11-05", to: "2026-11-13" },
  job: null,
};
const mockLevelBook = {
  available: true,
  basedOn: "2026-11-13",
  sessions: 7,
  from: "2026-11-05",
  to: "2026-11-13",
  graduation: mockRobotLearning.skill.graduation,
  rows: [{ symbol: "RELIANCE", kind: "pdl", kindName: "Yesterday's low", level: 1280.5, play: "bounce", side: "long", entry: 1280.5, stop: 1276.9, target: 1285.9, riskPct: 0.28, trigger: "falls to 1280.5 and holds", key: "pdl|bounce|long", ev: 0.18, hit: 56, n: 9, pooledN: 410, pooledEv: 0.07, pooledHit: 52, own: true }],
  kinds: [{ key: "pdl|bounce|long", name: "Yesterday's low", play: "bounce", side: "long", n: 410, hitPct: 52, avgR: 0.07 }],
  symbols: ["RELIANCE", "SBIN"],
  symbol: null,
  stock: null,
};
const mockHistory = { available: true, stocks: 100, expected: 100, current: 100, deep: 97, sessions: 247, bars: 1850000, kb: 15200, from: "2025-11-17", to: "2026-11-13", asOf: "2026-11-13", complete: true, upToDate: true, running: false, job: null, error: "", learned: { at: "2026-11-13T11:10:00Z", to: "2026-11-13" }, connected: true };
const mockPredictor = {
  available: true,
  at: "2026-11-13T11:10:00Z",
  lastDate: "2026-11-13",
  nextDate: "2026-11-16",
  stocks: 100,
  samples: 21500,
  graduated: true,
  base: 31,
  summary: { sessions: 226, evaluated: 166, meanLift: 0.074, topRate: 0.42, baseRate: 0.33, t: 3.1, positive: 0.62, dirCalls: 410, dirHitPct: 58, state: "graduated", text: "Out of sample, over 166 sessions its ten highest-ranked stocks gave a clean directional day 42% of the time against 33% for the average stock (ahead on 62% of the sessions, t = 3.1)." },
  series: Array.from({ length: 30 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, top: 0.4, base: 0.33, lift: 0.07 })),
  picks: [{ rank: 1, symbol: "TATASTEEL", p: 0.52, base: 0.31, lift: 0.21, pUp: 0.64, side: "long", stockRate: 0.47, stockN: 226, avgRangePct: 2.1, targetPct: 1.26, why: ["the day before closed near its high (44% of 3,100 such sessions were clean)"], levels: [{ key: "pdl|bounce|long", kindName: "Yesterday's low", level: 148.2, play: "bounce", side: "long", entry: 148.2, stop: 147.6, target: 149.1, ev: 0.12, hit: 55 }], last: {} }, { rank: 2, symbol: "HAL", p: 0.49, base: 0.31, lift: 0.18, pUp: 0.5, side: "either", stockRate: 0.44, stockN: 226, avgRangePct: 2.6, targetPct: 1.56, why: [], levels: [], last: {} }],
  points: [{ id: "s:TATASTEEL", kind: "stock", text: "TATASTEEL: 47% of 226 sessions gave a clean directional day, against 31% for the NIFTY 100 — a stock that trends.", n: 226, lift: 0.16, firstSeen: "2026-11-02", state: "new" }, { id: "f:loc:high", kind: "market", text: "When the day before closed near its high, 36% of 4,100 sessions gave a clean directional day, against 31% overall.", n: 4100, lift: 0.05, firstSeen: "2026-10-20", state: "steady" }, { id: "t:first", kind: "timing", text: "In 61% of 21500 sessions the day's high or low was set in the first hour (9:15–10:15).", n: 21500, lift: 0.11, firstSeen: "2026-10-20", state: "steady" }],
  gone: ["s:OLD"],
  history: mockHistory,
};
const mockCalls = [];
const mockWrites = [];
jest.mock("../../api", () => ({
  api: (url, opts) => {
    mockCalls.push(url);
    if (opts && opts.method) mockWrites.push({ url, method: opts.method, body: opts.body });
    if (url === "/api/admin/robot") return Promise.resolve(mockRobotBoard);
    if (url.startsWith("/api/admin/robot/days")) return Promise.resolve({ days: [{ date: "2026-11-13", trades: 2, net: 3820, compared: true, you: -100, gap: 400, corrected: 1 }], summary: { days: 2, robotNet: 5000, youNet: 1200, gap: 3800, robotAhead: 2, youAhead: 0 } });
    if (url.startsWith("/api/admin/robot/day/")) return Promise.resolve(mockRobotDay);
    if (url.startsWith("/api/admin/robot/compare/")) return Promise.resolve(mockRobotCompare);
    if (url.startsWith("/api/admin/robot/learning")) return Promise.resolve(mockRobotLearning);
    if (url.startsWith("/api/admin/robot/levels")) return Promise.resolve(mockLevelBook);
    if (url.startsWith("/api/admin/robot/predictor")) return Promise.resolve(mockPredictor);
    if (url.startsWith("/api/admin/robot/")) return Promise.resolve({});
    if (url.startsWith("/api/admin/analysis/snapshot/")) return Promise.resolve(mockSnap);
    if (url.startsWith("/api/admin/analysis/outcomes")) return Promise.resolve(mockOutcomes);
    if (url.startsWith("/api/admin/analysis/learnings")) return Promise.resolve(mockLearn);
    if (url === "/api/admin/analysis/days") return Promise.resolve({ days: [{ date: "2026-11-13" }] });
    if (url === "/api/admin/flight") return Promise.resolve(mockBoard);
    if (url === "/api/admin/flight/ai") return Promise.resolve({ opinion: { at: 1, clock: "10:43", action: "exit-now", exitPrice: 805.9, stop: 806.4, confidence: "high", reason: "Half the gain is gone and sellers lead the book.", watch: "A reclaim of 808.", by: "Claude Sonnet 5.5", agrees: true, deskSaid: "exit-now" }, settings: mockBoard.settings });
    if (url === "/api/admin/flight/levels") return Promise.resolve({ levels: mockLevels, settings: mockBoard.settings, record: { judged: 12, text: "First target reached before the stop on 7 of 12 sets (58%); the stop came first on 3." } });
    if (url.startsWith("/api/admin/flight/day/")) return Promise.resolve({ available: false });
    if (url.startsWith("/api/admin/analysis/compare/")) return Promise.resolve(mockCompare);
    if (url.startsWith("/api/admin/analysis/lab/")) return Promise.resolve(mockLab);
    if (url.startsWith("/api/admin/analysis/lab?")) return Promise.resolve({ days: 3, summary: { trades: 9, replayed: 9, net: 2100, charges: 270, capture: 38, ranOn: 4200, avoided: 1500, score: 61 }, rules: mockLab.rules, best: mockLab.best, flags: mockLab.flags, byHour: [{ hour: 9, label: "9 AM", trades: 4, net: 1800 }, { hour: 10, label: "10 AM", trades: 5, net: 300 }], context: [{ id: "withVwap", name: "With VWAP (long above, short below)", trades: 6, net: 2500 }], lessons: ["“Trailing stop 0.5%” would have made ₹660 more than your own exits on the same 9 entries."], trend: [{ date: "2026-11-11", score: 55 }, { date: "2026-11-12", score: 70 }, { date: "2026-11-13", score: 58 }] });
    return Promise.resolve({});
  },
}));
jest.mock("../../DatePicker", () => ({ DateField: ({ value, label }) => <span>{`${label}: ${value}`}</span> }));
const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));
// While NSE is open the page always opens on the Live board, whatever was picked last time. The tests
// that open another part pin the clock to a Saturday, so they pass at any hour.
let clockSpy = null;
const outsideMarketHours = () => {
  const real = Date.now.bind(Date);
  const offset = Date.parse("2026-11-14T06:30:00Z") - real();
  clockSpy = jest.spyOn(Date, "now").mockImplementation(() => real() + offset);
};
beforeEach(() => {
  mockCalls.length = 0;
  mockWrites.length = 0;
  window.localStorage.clear();
});
afterEach(() => {
  if (clockSpy) clockSpy.mockRestore();
  clockSpy = null;
});

test("a day replayed: the score, the share kept, the best other exit, the habits and every trade", async () => {
  outsideMarketHours();
  window.localStorage.setItem("vpt.lab.mode", "day");
  render(<TradeAnalysis />);
  await settle();
  expect(mockCalls).toContain("/api/admin/analysis/lab/2026-11-13");
  expect(screen.getByText("58 / 100")).toBeTruthy();
  expect(screen.getByText("Mixed")).toBeTruthy();
  expect(screen.getByText("42%")).toBeTruthy();
  expect(screen.getAllByText("Trailing stop 0.5%").length).toBeGreaterThan(0);
  expect(screen.getByText("Revenge trade")).toBeTruthy();
  expect(screen.getByText(/09:40–10:05/)).toBeTruthy();
  expect(screen.getByText("vs VWAP")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /SBIN/ }));
  expect(screen.getByText(/out at 830/)).toBeTruthy();
  expect(screen.getByText(/Day book/)).toBeTruthy();
});

test("a period: the lessons, the exit rules and the habits added up", async () => {
  outsideMarketHours();
  window.localStorage.setItem("vpt.lab.mode", "day");
  render(<TradeAnalysis />);
  await settle();
  fireEvent.click(screen.getByRole("tab", { name: "A period" })); // the lab's parts are the page bar's tabs
  await settle();
  expect(mockCalls.some((u) => u.startsWith("/api/admin/analysis/lab?from="))).toBe(true);
  expect(screen.getByText(/would have made ₹660 more/)).toBeTruthy();
  expect(screen.getByText("61 / 100")).toBeTruthy();
  expect(screen.getByText(/9 AM · 4/)).toBeTruthy();
});

test("the Live board: each open position with its word, the exit price, the stop, the reasons — and the AI on request", async () => {
  window.localStorage.setItem("vpt.lab.mode", "live");
  render(<TradeAnalysis />);
  await settle();
  expect(mockCalls).toContain("/api/admin/flight");
  expect(screen.getByText("EXIT NOW")).toBeTruthy();
  expect(screen.getByText("exit pressure 100 / 100")).toBeTruthy();
  expect(screen.getByText("Exit now at")).toBeTruthy();
  expect(screen.getAllByText("₹805.95").length).toBeGreaterThan(0);
  expect(screen.getByText("₹806.40")).toBeTruthy();
  expect(screen.getByText(/given back 55% of the best gain/)).toBeTruthy();
  expect(screen.getByText(/buyers 34% · Sellers pressing/)).toBeTruthy();
  expect(screen.getByText("Market LIVE")).toBeTruthy();
  expect(screen.getByText(/09:53 at ₹1,489.50/)).toBeTruthy(); // landed today: where the coach said EXIT
  // the Exit button never trades by itself: with no trading context it is disabled
  expect(screen.getByRole("button", { name: "Exit…" }).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Ask the AI" }));
  await settle();
  expect(mockCalls).toContain("/api/admin/flight/ai");
  expect(screen.getByText(/Half the gain is gone and sellers lead the book/)).toBeTruthy();
  expect(screen.getByText(/It agrees with the desk/)).toBeTruthy();
});

test("the Live board's exit levels: the desk's level map, and the AI's research on request — only what passed the check, with what was left out", async () => {
  window.localStorage.setItem("vpt.lab.mode", "live");
  render(<TradeAnalysis />);
  await settle();
  expect(screen.getByText("Exit levels")).toBeTruthy();
  expect(screen.getByText(/The desk's own level map\. The AI has not researched this position yet/)).toBeTruthy();
  expect(screen.getByText("Previous day's high + Round number")).toBeTruthy(); // a level from the desk's map
  expect(screen.getAllByText("VWAP").length).toBe(2); // the gauge, and the level on the map
  expect(screen.getByText("NOW")).toBeTruthy();
  expect(screen.getByRole("img", { name: /46% odds of a touch before the square-off, no trend assumed/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Research levels (AI)" }));
  await settle();
  expect(mockCalls).toContain("/api/admin/flight/levels");
  expect(screen.getByText(/AI-researched at 10:43 by Claude Sonnet 5\.5 · 2 of 3 of its choices passed the desk's check · confidence medium · the wider market is against the trade/)).toBeTruthy();
  expect(screen.getByText("T1")).toBeTruthy();
  expect(screen.getByText("STOP")).toBeTruthy();
  expect(screen.getByText(/limit ₹809\.90 · 1\.6R to the stop · within reach/)).toBeTruthy();
  expect(screen.getByText("810 held twice today.")).toBeTruthy();
  expect(screen.getByText(/Watch for a turn at ₹810\.00/)).toBeTruthy();
  expect(screen.getByText(/“A9” is not a level on the desk's map/)).toBeTruthy();
  expect(screen.getByText(/First target reached before the stop on 7 of 12 sets/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Research again" })).toBeTruthy();
});

test("the Coach: what to prevent with its cost and a rule, what to keep, and the day against the usual", async () => {
  outsideMarketHours();
  window.localStorage.setItem("vpt.lab.mode", "coach");
  render(<TradeAnalysis />);
  await settle();
  await settle();
  expect(mockCalls).toContain("/api/admin/analysis/compare/2026-11-13");
  expect(screen.getByText(/First to fix: revenge trade/)).toBeTruthy();
  expect(screen.getByText("again today")).toBeTruthy();
  expect(screen.getByText(/wait 15 minutes before the next entry/)).toBeTruthy();
  expect(screen.getByText(/Entering with VWAP/)).toBeTruthy();
  expect(screen.getAllByText("▲ better than usual").length).toBe(2);
  expect(screen.getByText(/the same revenge trade/)).toBeTruthy();
});

test("a recorded trade's replay: the AI's exit levels as they were given, each scored on the day's bars", () => {
  const t = { symbol: "SBIN", side: "long", entryAt: 1000, exitAt: 601000, entryClock: "09:40", exitClock: "09:50", entryAvg: 800, exitAvg: 806, pnl: 300, read: { path: [[1000, 800], [301000, 808], [601000, 806], [1201000, 811]], bestExit: { at: 301000, clock: "09:45", price: 808, pnl: 400, kind: "profit" }, coach: null } };
  const flight = {
    events: [],
    levels: [
      { id: "L1", clock: "09:41", by: "Claude Sonnet 5.5", failed: false, targets: [{ n: 1, level: 810, label: "Previous day's high" }], stop: { price: 797.5 }, outcome: { t1: "reached", t1Clock: "10:00", t1At: 1201000, t2: null, stop: "open" } },
      { id: "L2", clock: "09:48", by: "Claude Sonnet 5.5", failed: true, targets: [], stop: null, outcome: null },
    ],
  };
  render(<TradeChart t={t} flight={flight} />);
  expect(screen.getByText(/target 1 ₹810\.00 \(Previous day's high\), stop ₹797\.50 — target 1 reached at 10:00 — 10 min after you left\./)).toBeTruthy();
  expect(screen.getByText(/none of its targets passed the desk's check/)).toBeTruthy();
  expect(screen.getByText(/AI target 810\.00/)).toBeTruthy(); // the level drawn across the chart
  // no recording, no list
  const { container } = render(<TradeChart t={t} flight={null} />);
  expect(container.querySelector(".lx-ai")).toBeNull();
});

test("a day's snapshot: the peak with its time, what became of each best moment, and the timeline with a timestamp on every moment", async () => {
  outsideMarketHours();
  window.localStorage.setItem("vpt.lab.mode", "snap");
  render(<TradeAnalysis />);
  await settle();
  expect(mockCalls).toContain("/api/admin/analysis/snapshot/2026-11-13");
  expect(screen.getByText("+₹2,640")).toBeTruthy(); // the day's peak
  expect(screen.getByText(/at 10:20 · open: SBIN/)).toBeTruthy();
  expect(screen.getByText(/₹1,800 of the peak was given back/)).toBeTruthy();
  expect(screen.getByRole("img", { name: /peaked at \+₹2,640 at 10:20 and closed at \+₹840/ })).toBeTruthy();
  expect(screen.getByText("Stayed past the peak")).toBeTruthy();
  expect(screen.getByText(/you stayed 5 min longer/)).toBeTruthy();
  expect(screen.getByText("Bought 50 SBIN at ₹800.00.")).toBeTruthy();
  expect(screen.getByText("09:40", { selector: "time" })).toBeTruthy();
  // the live board's signals are behind a switch
  expect(screen.queryByText(/TIGHTEN/)).toBeNull();
  fireEvent.click(screen.getByLabelText(/live-board signals \(1\)/));
  expect(screen.getByText(/TIGHTEN — the buyers are tiring/)).toBeTruthy();
});

test("the outcomes table: every trade with what became of its best moment, filtered by pressing an outcome", async () => {
  outsideMarketHours();
  window.localStorage.setItem("vpt.lab.mode", "outcomes");
  render(<TradeAnalysis />);
  await settle();
  expect(mockCalls.some((u) => u.startsWith("/api/admin/analysis/outcomes?from="))).toBe(true);
  expect(screen.getByText("The best moment was +₹2,000 at 10:00.")).toBeTruthy();
  expect(screen.getByText("The price never went meaningfully your way.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Never paid/ }));
  expect(screen.queryByText("The best moment was +₹2,000 at 10:00.")).toBeNull();
  expect(screen.getByText("The price never went meaningfully your way.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Never paid/ }));
  expect(screen.getByText("The best moment was +₹2,000 at 10:00.")).toBeTruthy();
});

test("the register of learnings: each habit with its cost and rule, a flag for one that came back, your status saved, a lesson of your own added", async () => {
  outsideMarketHours();
  window.localStorage.setItem("vpt.lab.mode", "learn");
  render(<TradeAnalysis />);
  await settle();
  expect(screen.getByText("Trail the stop under the move.", { exact: false })).toBeTruthy();
  expect(screen.getByText("₹1,450")).toBeTruthy();
  expect(screen.getByText("Repeating")).toBeTruthy();
  expect(screen.getByText(/Back after you marked it mastered/, { selector: "p b" })).toBeTruthy();
  expect(screen.getByText("Keep doing", { selector: "h3" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Your status on: Stayed past the peak"), { target: { value: "working" } });
  await settle();
  expect(mockWrites).toContainEqual({ url: "/api/admin/analysis/learnings/o%3Agave-back", method: "PUT", body: { status: "working" } });
  fireEvent.change(screen.getByLabelText("What I will not repeat"), { target: { value: "adding to a loser after 2 PM" } });
  fireEvent.click(screen.getByRole("button", { name: "Add lesson" }));
  await settle();
  expect(mockWrites.find((w) => w.method === "POST").body.text).toBe("adding to a loser after 2 PM");
});

test("the robot today: its open position, what finished and how, what it skipped — and the flight recorder of the day", async () => {
  outsideMarketHours();
  window.localStorage.setItem("vpt.lab.mode", "robot");
  render(<TradeAnalysis />);
  await settle();
  expect(screen.getByText(/The paper robot is/)).toBeTruthy();
  expect(screen.getByText("on", { selector: "b" })).toBeTruthy();
  expect(screen.getByText(/play money/i, { selector: "b" })).toBeTruthy();
  expect(screen.getByText("+₹3,820")).toBeTruthy();
  expect(screen.getByText(/ICICIBANK/)).toBeTruthy();
  expect(screen.getAllByText("Stayed past the peak").length).toBeGreaterThan(0);
  expect(screen.getByText(/score 38 is under the 53 needed/)).toBeTruthy();
  // the recorder: open the trade to see its frames and events
  expect(mockCalls).toContain("/api/admin/robot/day/2026-11-13");
  fireEvent.click(screen.getByRole("button", { name: /SBIN.*09:45–10:54/ }));
  expect(screen.getByText("Bought 500 SBIN at ₹800.24.")).toBeTruthy();
  expect(screen.getByText(/4 frames/)).toBeTruthy();
  expect(screen.getByRole("img", { name: /SBIN from 09:45: entry 800\.00, best 807\.00 at 10:42/ })).toBeTruthy();
  // the switch
  fireEvent.click(screen.getByRole("button", { name: "Switch off" }));
  await settle();
  expect(mockWrites).toContainEqual({ url: "/api/admin/robot/settings", method: "PUT", body: { on: false } });
});

test("the robot against you: the gap, what happened, the stocks you both traded, the calls you skipped and why the robot skipped yours", async () => {
  outsideMarketHours();
  window.localStorage.setItem("vpt.lab.mode", "robot");
  window.localStorage.setItem("vpt.robot.view", "versus");
  render(<TradeAnalysis />);
  await settle();
  await settle();
  expect(mockCalls).toContain("/api/admin/robot/compare/2026-11-13");
  expect(screen.getByText(/the robot made ₹400 more/)).toBeTruthy();
  expect(screen.getByText("+₹400", { selector: ".ta-kpi__v" })).toBeTruthy();
  expect(screen.getByText(/you 12 min later, 0\.4% worse/)).toBeTruthy();
  expect(screen.getByText("Advisor calls you did not take")).toBeTruthy();
  expect(screen.getByText(/ICICIBANK/)).toBeTruthy();
  expect(screen.getByText(/the robot: score 38 is under the 53 needed/)).toBeTruthy();
  expect(screen.getByText(/waits 30 minutes before it enters the same stock again/)).toBeTruthy();
  expect(screen.getByText(/One day is a small sample/)).toBeTruthy();
});

test("the robot's learning: where it is in its fifteen sessions, its mistakes, its corrections and how each fared — and Study now", async () => {
  outsideMarketHours();
  window.localStorage.setItem("vpt.lab.mode", "robot");
  window.localStorage.setItem("vpt.robot.view", "learning");
  render(<TradeAnalysis />);
  await settle();
  expect(screen.getByText(/session 7 of 15/)).toBeTruthy();
  expect(screen.getByRole("progressbar", { name: "Sessions studied" })).toBeTruthy();
  expect(screen.getByText(/7 of 15 sessions studied\. It is not asked to suggest/)).toBeTruthy();
  expect(screen.getByText("Back after its fix")).toBeTruthy();
  expect(screen.getAllByText(/Give-back exit 50% → 45%/).length).toBeGreaterThan(0);
  expect(screen.getByText("Measured: undone")).toBeTruthy();
  expect(screen.getByText(/the trades since averaged|Since: 8 trades averaged −0\.30R against \+0\.10R before/)).toBeTruthy();
  expect(screen.getByText(/A fair day: two trades/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Study the NIFTY 100 now/ }));
  await settle();
  expect(mockWrites.find((w) => w.url === "/api/admin/robot/study" && w.method === "POST")).toBeTruthy();
});

test("the Level Book: the best levels for the next session, with the record each rests on", async () => {
  outsideMarketHours();
  window.localStorage.setItem("vpt.lab.mode", "robot");
  window.localStorage.setItem("vpt.robot.view", "levels");
  render(<TradeAnalysis />);
  await settle();
  expect(screen.getByText("Best levels for the next session")).toBeTruthy();
  expect(screen.getByText(/RELIANCE/, { selector: "b" })).toBeTruthy();
  expect(screen.getByText(/falls to 1280\.5 and holds/)).toBeTruthy();
  expect(screen.getByText("+0.18R")).toBeTruthy();
  expect(screen.getByText(/9 of its own tests · 410 across the NIFTY 100/)).toBeTruthy();
  expect(screen.getByText(/it has not yet shown skill out of sample/)).toBeTruthy();
});

test("Day picks: the stocks the predictor ranks for the next session with their levels, its out-of-sample record, what it has learned — and the year of history it learns from by itself", async () => {
  outsideMarketHours();
  window.localStorage.setItem("vpt.lab.mode", "robot");
  window.localStorage.setItem("vpt.robot.view", "picks");
  render(<TradeAnalysis />);
  await settle();
  expect(mockCalls).toContain("/api/admin/robot/predictor");
  expect(screen.getByText("Ranking with evidence")).toBeTruthy();
  expect(screen.getByText(/Out of sample, over 166 sessions its ten highest-ranked stocks/)).toBeTruthy();
  expect(screen.getByText("1. TATASTEEL")).toBeTruthy();
  expect(screen.getByText("52%")).toBeTruthy();
  expect(screen.getByText(/the day before closed near its high \(44% of 3,100 such sessions were clean\)/)).toBeTruthy();
  expect(screen.getByText(/Yesterday's low 148\.20 — holds \(long\): in 148\.20, stop 147\.60, target 149\.10 · \+0\.12R, 55% won/)).toBeTruthy();
  expect(screen.getByText(/a stock that trends/)).toBeTruthy();
  expect(screen.getByText("New")).toBeTruthy();
  expect(screen.getByText(/1 earlier point no longer stand out|1 earlier point no longer stands? out/)).toBeTruthy();
  // the year in the database, kept by itself
  expect(screen.getByText("A year of the NIFTY 100 in the database")).toBeTruthy();
  expect(screen.getByText("Up to date")).toBeTruthy();
  expect(screen.getByText(/It reads, learns and updates/)).toBeTruthy();
  expect(screen.getByText("247", { selector: "b" })).toBeTruthy();
});
