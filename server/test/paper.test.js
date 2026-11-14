"use strict";
// Paper trading: play money only, the same engine as the desk, completely separate from real
// trading, an honest bar for findings, and the findings written into the trading-skills file.
// The market is faked here; nothing talks to Zerodha.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { PaperService, sizeTrade, summarize, SECTION } = require("../paper/service");
const { findingsOf, stats } = require("../paper/findings");
const { Playbook, LESSONS_HEAD } = require("../ai/playbook");
const { TradingService } = require("../trading/service");
const { FileDocs } = require("../docs");

const IST = 5.5 * 3600 * 1000;
const at = (date, hhmm) => Date.parse(`${date}T${hhmm}:00+05:30`);

/** An engine trade as replay.js makes one. */
const trade = (side, atClock, netR, extra = {}) => ({ side, at: atClock, entry: 100, stop: side === "long" ? 99 : 101, target: side === "long" ? 101 : 99, riskPerShare: 1, riskPct: 1, score: 60, withDaily: true, phase: "morning", costR: 0.1, exitAt: "14:00", exit: side === "long" ? 100 + netR + 0.1 : 100 - netR - 0.1, why: netR > 0 ? "target" : "stop", r: netR + 0.1, netR, ...extra });

function stubMarket(clock) {
  const m = {
    calls: [],
    watch: ["SBIN", "INFY"],
    todayTrades: { SBIN: [trade("long", "10:05", 0.9), trade("short", "13:10", -1.1, { why: "open", exit: 101, netR: -1.1 })], INFY: [] },
    sessions: null,
  };
  m.mode = () => "kite";
  m.watchlist = () => m.watch;
  m.now = () => clock.ms;
  m.replay = async (symbol) => {
    m.calls.push(`replay ${symbol}`);
    return { available: true, date: new Date(clock.ms + IST).toISOString().slice(0, 10), trades: m.todayTrades[symbol] || [] };
  };
  m.replayHistory = async (symbol, { sessions }) => {
    m.calls.push(`history ${symbol} ${sessions}`);
    return { available: true, sessions: m.sessions ? m.sessions(symbol) : [] };
  };
  return m;
}

function boot(clockMs = at("2026-11-13", "10:40")) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-paper-"));
  const docs = new FileDocs(dir);
  const clock = { ms: clockMs };
  const market = stubMarket(clock);
  const store = { docs, data: { settings: {} }, update(fn) { fn(this.data); docs.write("db.json", this.data); } };
  const trading = new TradingService({ dir, store, market: { kiteState: () => ({ connected: true, user: null }) }, docs, now: () => clock.ms, log: { log() {}, error() {} } });
  const playbook = new Playbook({ docs });
  const paper = new PaperService({ market, playbook, docs, now: () => clock.ms, log: { log() {} } });
  return { dir, docs, clock, market, trading, playbook, paper };
}

const waitFor = async (fn) => {
  for (let i = 0; i < 200; i += 1) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("timed out");
};

test("sizing is play money from the paper capital and the risk per trade; totals add up", () => {
  const t = { side: "long", entry: 500, riskPerShare: 5, exit: 510 };
  const s = sizeTrade(t, { capital: 1000000, riskPct: 1, costPct: 0.1 });
  assert.equal(s.qty, 2000, "₹10,000 risk / ₹5 a share");
  assert.equal(s.pnl, (10 - 0.5) * 2000);
  // never more shares than the capital can buy
  assert.equal(sizeTrade({ side: "long", entry: 500, riskPerShare: 0.1, exit: 501 }, { capital: 100000, riskPct: 1, costPct: 0 }).qty, 200);
  const sum = summarize([{ netR: 1, pnl: 100, why: "target" }, { netR: -1, pnl: -80, why: "stop" }, { netR: 0.5, pnl: 40, why: "square-off" }, { netR: -0.2, why: "open" }]);
  assert.deepEqual([sum.trades, sum.finished, sum.open, sum.wins, sum.losses, sum.pnl, sum.netR, sum.profitFactor, sum.deepestDip], [4, 3, 1, 2, 1, 60, 0.5, 1.75, -80]);
});

test("a finding needs 30+ trades and a clear edge; noise and small samples say nothing", () => {
  const good = Array.from({ length: 40 }, (_, i) => trade("long", "10:00", i % 5 === 0 ? -1 : 0.6));
  const few = Array.from({ length: 12 }, () => trade("short", "13:30", 1, { withDaily: false }));
  const noise = Array.from({ length: 60 }, (_, i) => trade("long", "12:00", i % 2 ? 1 : -1, { withDaily: false }));
  const f = findingsOf([...good, ...few, ...noise]);
  const slice = (id) => f.slices.find((s) => s.id === id);
  assert.equal(slice("w1").verdict, "works", JSON.stringify(slice("w1")));
  assert.equal(slice("short").verdict, "too few");
  assert.equal(slice("w2").verdict, "unclear", "a coin flip is not a finding");
  assert.ok(f.findings.some((x) => x.id === "w1" && /averaged \+0\.28R/.test(x.text)));
  assert.ok(!f.findings.some((x) => x.id === "short" || x.id === "w2"));
  assert.deepEqual(stats([]), { n: 0, avg: null, sd: null, t: null, winPct: null, sum: 0 });
});

test("paper trading is separate from real trading: auto mode never touches the real switch, either way", async () => {
  const { trading, paper } = boot();
  // real trading ON stays ON when paper auto mode starts and stops
  trading.setSwitch(true, "owner");
  let st = paper.setAuto(true);
  assert.equal(st.auto, true);
  assert.equal(st.paperOnly, true);
  assert.equal(trading.status().enabled, true, "auto mode did not turn real trading off");
  assert.equal(st.realTrading, undefined, "paper trading does not even read the real switch");
  // and the owner can switch real trading off and on while paper auto mode runs, as always
  assert.equal(trading.setSwitch(false, "owner").enabled, false);
  assert.equal(trading.setSwitch(true, "owner").enabled, true);
  assert.doesNotThrow(() => trading._requireOn());
  st = paper.setAuto(false);
  assert.equal(trading.status().enabled, true, "auto mode off did not change it either");
  // real trading OFF stays OFF too
  trading.setSwitch(false, "owner");
  paper.setAuto(true);
  assert.equal(trading.status().enabled, false);
  assert.equal(trading.status().lockedBy, undefined, "no lock of any kind on the trading service");
});

test("the paper folder cannot trade: no broker, no trading service, no order endpoints", () => {
  const dir = path.join(__dirname, "..", "paper");
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    assert.ok(!/require\([^)]*broker/.test(src), `${f} must not load the broker`);
    assert.ok(!/require\([^)]*trading/.test(src), `${f} must not load the trading service`);
    assert.ok(!/setSwitch|lockedBy/.test(src), `${f} must not touch the real trading switch`);
    assert.ok(!/kite\.trade|\/orders|place_order|placeOrder|\/gtt/i.test(src), `${f} must not touch orders`);
  }
});

test("live market: today's calls become sized paper trades; a new day moves them to the record", async () => {
  const { clock, market, paper } = boot();
  const r = await paper.liveStep({ force: true });
  assert.deepEqual(r, { ran: true, trades: 2 });
  let st = paper.status();
  assert.equal(st.today.trades.length, 2);
  const long = st.today.trades.find((t) => t.side === "long");
  assert.equal(long.symbol, "SBIN");
  assert.equal(long.source, "live");
  assert.equal(long.qty, 10000, "₹10,000 risk at ₹1 a share");
  assert.equal(st.today.summary.open, 1, "the afternoon short is still open, marked to the price");
  assert.deepEqual(market.calls, ["replay SBIN", "replay INFY"]);

  // the next morning: yesterday's finished trade joins the record, the open one does not
  clock.ms = at("2026-11-16", "09:40");
  market.todayTrades = { SBIN: [], INFY: [] };
  await paper.liveStep({ force: true });
  st = paper.status();
  assert.equal(st.recentLive.length, 1);
  assert.equal(st.tested.live.finished, 1);
  assert.equal(st.today.trades.length, 0);
});

test("history: the same engine over past sessions, counted for the current setup, findings written to the skills file once", async () => {
  const { market, paper, playbook } = boot();
  // 40 winning morning longs and 40 losing afternoon shorts across two stocks
  market.sessions = (symbol) =>
    Array.from({ length: 20 }, (_, d) => ({
      date: `2026-10-${String(d + 1).padStart(2, "0")}`,
      trades: symbol === "SBIN" ? [trade("long", "09:45", d % 5 === 0 ? -1 : 0.8), trade("short", "13:20", d % 5 === 0 ? 0.5 : -0.9, { withDaily: false })] : [trade("long", "10:15", d % 4 === 0 ? -1 : 0.7), trade("short", "13:40", -0.8, { withDaily: false })],
    }));
  paper.setSettings({ sessions: 20 });
  paper.startHistory();
  assert.throws(() => paper.startHistory(), /already running/);
  await waitFor(() => paper.job && paper.job.finishedAt);
  const st = paper.status();
  assert.equal(st.history.summary.trades, 80);
  assert.equal(st.history.current, true);
  assert.equal(st.tested.total, 80);
  assert.equal(st.history.bySymbol.length, 2);
  assert.equal(st.history.byDay.length, 20);
  assert.deepEqual(market.calls.filter((c) => c.startsWith("history")), ["history SBIN 20", "history INFY 20"]);

  assert.equal(st.findings.written, true);
  const kinds = Object.fromEntries(st.findings.findings.map((f) => [f.id, f.kind]));
  assert.equal(kinds.long, "works");
  assert.equal(kinds.short, "loses");
  assert.equal(kinds.against, "loses");
  let text = playbook.read();
  assert.ok(text.includes(SECTION));
  assert.ok(text.indexOf(SECTION) < text.indexOf(LESSONS_HEAD), "above the lessons, so lessons are untouched");
  assert.match(text, /short calls averaged -0\.\d+R after costs over 40 paper trades/);
  assert.deepEqual(playbook.lessons(), ["_None yet. Lessons appear here after plans have been scored against real prices._"].filter((l) => l.startsWith("- ")), "no lesson was added");

  // a second run rewrites the section rather than adding another
  market.sessions = () => [];
  paper.startHistory();
  await waitFor(() => paper.job && paper.job.finishedAt);
  text = playbook.read();
  assert.equal(text.split(SECTION).length, 2, "one section, rewritten");
  assert.match(text, /Nothing measured strongly enough yet/);
});

test("auto mode: paper trades in market hours, then after the close the day is final and history runs", async () => {
  const { clock, market, paper } = boot(at("2026-11-13", "08:30"));
  assert.equal(paper.tick(), null, "off: nothing happens");
  paper.setAuto(true);
  await waitFor(() => market.calls.length >= 2);
  assert.equal(paper.tick(), null, "before the open: nothing");
  clock.ms = at("2026-11-13", "11:00");
  assert.equal(paper.tick(), "live");
  clock.ms = at("2026-11-14", "11:00");
  assert.equal(paper.tick(), null, "Saturday: nothing");

  clock.ms = at("2026-11-13", "15:45");
  market.todayTrades.SBIN = [trade("long", "10:05", 0.9)];
  assert.equal(paper.tick(), "close");
  await waitFor(() => paper.status().lastRuns.closed === "2026-11-13");
  assert.equal(paper.status().recentLive.length, 1);
  assert.equal(paper.tick(), "history");
  await waitFor(() => paper.job && paper.job.finishedAt);
  assert.equal(paper.tick(), null, "once a day");
});
