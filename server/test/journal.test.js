"use strict";
// The trade journal and the risk guard's rules: pure functions, no server.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { roundTrips, charges, stats, excursion, fromConsoleCsv, TradeJournal, periodRange, summarize } = require("../trading/journal");
const { FileDocs } = require("../docs");
const risk = require("../trading/risk");

const at = (s) => Date.parse(`${s}+05:30`);
let n = 0;
const fill = (time, side, qty, price, symbol = "INFY", product = "MIS") => ({ id: `t${(n += 1)}`, exchange: "NSE", symbol, side, qty, price, at: at(time), product, source: "kite" });

test("round trips run flat to flat; a flip through zero is split; an open position stays open", () => {
  const trips = roundTrips([
    fill("2026-11-10T09:20:00", "BUY", 10, 100),
    fill("2026-11-10T09:30:00", "BUY", 10, 102), // add
    fill("2026-11-10T10:00:00", "SELL", 5, 105), // partial exit
    fill("2026-11-10T11:00:00", "SELL", 25, 104), // closes 15, opens a 10 short
    fill("2026-11-10T12:00:00", "BUY", 10, 101), // closes the short
    fill("2026-11-11T09:20:00", "BUY", 3, 110), // still open
  ]);
  assert.equal(trips.length, 3);
  const [a, b, c] = trips;
  assert.deepEqual([a.side, a.qty, a.entryAvg, a.exitAvg, a.open, a.intraday], ["long", 20, 101, 104.25, false, true]);
  assert.equal(a.pnl, 65); // (104.25 − 101) × 20
  assert.deepEqual([b.side, b.qty, b.entryAvg, b.exitAvg, b.pnl], ["short", 10, 104, 101, 30]);
  assert.equal(c.open, true);
  assert.equal(c.pnl, 0);
});

test("charges are estimated from Zerodha's equity rates: intraday cheap, delivery carries STT and DP", () => {
  const [intra] = roundTrips([fill("2026-11-10T09:20:00", "BUY", 100, 1000), fill("2026-11-10T10:20:00", "SELL", 100, 1010)]);
  const [deliv] = roundTrips([fill("2026-11-03T09:20:00", "BUY", 100, 1000, "TCS", "CNC"), fill("2026-11-10T10:20:00", "SELL", 100, 1010, "TCS", "CNC")]);
  const ci = charges(intra);
  const cd = charges(deliv);
  assert.ok(ci > 40 && ci < 90, `intraday ≈ ₹40 brokerage + STT etc., got ${ci}`);
  assert.ok(cd > 200 && cd < 260, `delivery ≈ ₹201 STT + stamp + DP, got ${cd}`);
  assert.equal(charges({ ...intra, exchange: "NFO" }), 0, "F&O is not estimated");
});

test("stats: win rate, profit factor, expectancy, drawdown, streaks and the breakdowns", () => {
  const mk = (exit, net, extra = {}) => ({ key: `k${exit}`, symbol: "A", side: "long", intraday: true, open: false, entryAt: at(`2026-11-${exit}T09:30:00`), exitAt: at(`2026-11-${exit}T10:00:00`), pnl: net, charges: 0, net, holdMin: 30, tags: null, ...extra });
  const s = stats([mk("02", 100), mk("03", 50), mk("04", -30), mk("05", -60), mk("06", 200, { symbol: "B", side: "short", tags: { setup: "ORB", mistakes: ["Chased the entry"] } }), { ...mk("07", 0), open: true }]);
  assert.equal(s.trades, 5);
  assert.equal(s.open, 1);
  assert.equal(s.winRate, 60);
  assert.equal(s.net, 260);
  assert.equal(s.profitFactor, 3.89); // 350 / 90
  assert.equal(s.expectancy, 52);
  assert.equal(s.maxDrawdown, 90);
  assert.equal(s.bestStreak, 2);
  assert.equal(s.worstStreak, 2);
  assert.equal(s.greenDays, 3);
  assert.equal(s.by.symbol[0].key, "B");
  assert.deepEqual(s.by.setup.map((g) => g.key), ["ORB"]);
  assert.equal(s.by.mistake[0].key, "Chased the entry");
  assert.equal(s.by.weekday.find((g) => g.key === "Mon").trades, 1); // 2 Nov 2026 was a Monday
  assert.equal(s.curve[s.curve.length - 1].equity, 260);
});

test("a Zerodha Console tradebook imports; junk rows are counted, not guessed", () => {
  const csv = [
    "symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time",
    "INFY,INE009A01021,2026-11-10,NSE,EQ,EQ,buy,false,10,1500.5,9001,7001,2026-11-10T09:21:04",
    'INFY,INE009A01021,2026-11-10,NSE,EQ,EQ,sell,false,10,"1,510.00",9002,7002,2026-11-10T10:05:00',
    "INFY,INE009A01021,2026-11-10,NSE,EQ,EQ,sell,false,10,1515,9003,7003,2026-11-10T10:06:00",
    "BAD,,,,,,hold,,x,y,,,",
  ].join("\n");
  const r = fromConsoleCsv(csv);
  assert.equal(r.error, "");
  assert.equal(r.fills.length, 3, "a quoted price with a thousands comma is read");
  assert.equal(r.fills[1].price, 1510);
  assert.equal(r.skipped, 1);
  assert.equal(r.fills[0].at, at("2026-11-10T09:21:04"));
  assert.match(fromConsoleCsv("a,b\n1,2").error, /Console tradebook/);

  // into the journal: imported once, then de-duplicated against today's trades from Zerodha
  const j = new TradeJournal(new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-j-"))));
  assert.equal(j.importCsv(csv).added, 3);
  assert.equal(j.importCsv(csv).added, 0);
  assert.equal(j.ingestKite([{ id: "9001", orderId: "7001", exchange: "NSE", symbol: "INFY", side: "BUY", quantity: 10, price: 1500.5, at: "2026-11-10 09:21:04" }]), 0, "same trade id: not added twice");
  const tripKey = j.trips()[0].key;
  j.setTags(tripKey, { setup: "Pullback", mistakes: ["Exited too early", ""], rating: 4 });
  const v = j.view({});
  const tagged = v.trips.find((x) => x.key === tripKey);
  assert.equal(tagged.tags.setup, "Pullback");
  assert.deepEqual(tagged.tags.mistakes, ["Exited too early"]);
  assert.equal(v.stats.open, 1, "the third fill opened a short that is still open");
  assert.deepEqual(v.setups, ["Pullback"]);
});

test("MAE / MFE from 1-minute bars, and how much of the best move was kept", () => {
  const trip = { side: "long", entryAvg: 100, entryAt: at("2026-11-10T09:30:00"), exitAt: at("2026-11-10T09:35:00"), qty: 10, maxQty: 10, pnl: 20 };
  const bars = [9.5, 99, 104, 101].map((x, i) => ({ t: at(`2026-11-10T09:3${i}:00`), h: Math.max(x, 100) + (i === 2 ? 0 : 0.5), l: i === 1 ? 98 : 99.5 }));
  const e = excursion(trip, bars);
  assert.equal(e.mfe, 40); // high 104 − 100, × 10
  assert.equal(e.mae, -20); // low 98 − 100, × 10
  assert.equal(e.captured, 50);
  assert.equal(excursion(trip, []), null);
});

test("risk rules: a loss or a profit lock locks the day; locks block only new risk; limits cannot loosen", () => {
  const cfg = risk.cleanConfig({ enabled: true, dailyLoss: 5000, profitLock: 20000, maxOrders: 10, maxOpen: 2 });
  const now = at("2026-11-12T11:00:00");
  const open = new Set(["NSE:INFY", "NSE:TCS"]);
  let s = risk.standing({ cfg, lock: null, now, dayPnl: -5200, ordersToday: 3, openSymbols: open });
  assert.equal(s.locked, true);
  assert.equal(s.breach.kind, "loss");
  assert.equal(s.room.loss, 0);
  assert.equal(risk.refusal(s, cfg, { opening: true, symbol: "NSE:SBIN", openSymbols: open }).code, "risk_locked");
  assert.equal(risk.refusal(s, cfg, { opening: false }), null, "an exit is never refused");

  s = risk.standing({ cfg, lock: null, now, dayPnl: 21000, ordersToday: 3, openSymbols: open });
  assert.equal(s.breach.kind, "profit");

  s = risk.standing({ cfg, lock: null, now, dayPnl: -100, ordersToday: 3, openSymbols: open });
  assert.equal(s.locked, false);
  assert.equal(s.room.loss, 4900);
  assert.equal(risk.refusal(s, cfg, { opening: true, symbol: "NSE:SBIN", openSymbols: open }).code, "risk_open", "a third symbol");
  assert.equal(risk.refusal(s, cfg, { opening: true, symbol: "NSE:INFY", openSymbols: open }), null, "adding to an open one is fine");
  s = risk.standing({ cfg, lock: null, now, dayPnl: 0, ordersToday: 10, openSymbols: new Set() });
  assert.equal(risk.refusal(s, cfg, { opening: true, symbol: "NSE:X", openSymbols: new Set() }).code, "risk_orders");

  // yesterday's lock is gone today
  s = risk.standing({ cfg, lock: { day: "2026-11-11", reason: "x" }, now, dayPnl: 0, ordersToday: 0, openSymbols: new Set() });
  assert.equal(s.locked, false);

  assert.equal(risk.loosens(cfg, { ...cfg, dailyLoss: 6000 }), true);
  assert.equal(risk.loosens(cfg, { ...cfg, dailyLoss: 0 }), true, "0 means no limit: looser");
  assert.equal(risk.loosens(cfg, { ...cfg, enabled: false }), true);
  assert.equal(risk.loosens(cfg, { ...cfg, dailyLoss: 3000, maxOrders: 5 }), false);
  assert.equal(risk.standing({ cfg: risk.cleanConfig({}), lock: null, now, dayPnl: -1e9, ordersToday: 0, openSymbols: new Set() }).locked, false, "off means off");
});

/* ------------------------------------------------- periods, years, saved views, capture */

const freshJournal = () => new TradeJournal(new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-jp-"))));
const kite = (id, symbol, side, quantity, price, when, product = "MIS") => ({ id: String(id), orderId: `o${id}`, exchange: "NSE", symbol, side, quantity, price, at: when, product });
// a round trip in one call: buy then sell (or sell then buy) on the given days
let tid = 1000;
const trip = (symbol, inAt, outAt, qty, buy, sell, product = "MIS") => [kite((tid += 1), symbol, "BUY", qty, buy, inAt, product), kite((tid += 1), symbol, "SELL", qty, sell, outAt, product)];
const NOW = at("2026-11-16T12:00:00"); // a Monday

test("periods: today, yesterday (Friday on a Monday), week, month, quarter, months back, financial years, custom", () => {
  const p = (id, o) => periodRange(id, NOW, o);
  assert.deepEqual([p("today").fromDay, p("today").toDay], ["2026-11-16", "2026-11-16"]);
  assert.equal(p("yesterday").fromDay, "2026-11-13");
  assert.equal(p("week").fromDay, "2026-11-16");
  assert.equal(p("month").fromDay, "2026-11-01");
  assert.equal(p("quarter").fromDay, "2026-10-01");
  assert.equal(p("6m").fromDay, "2026-05-16");
  assert.equal(p("9m").fromDay, "2026-02-16");
  assert.equal(p("12m").fromDay, "2025-11-16");
  assert.deepEqual([p("fy").fromDay, p("fy").label], ["2026-04-01", "This FY (2026-27)"]);
  assert.deepEqual([p("fy-2024").fromDay, p("fy-2024").toDay, p("fy-2024").label], ["2024-04-01", "2025-03-31", "FY 2024-25"]);
  assert.equal(p("fy-2027"), null, "a financial year not yet begun");
  assert.equal(p("custom", { from: "2026-02-30", to: "2026-03-05" }), null, "not a real date");
  assert.equal(p("custom", { from: "2026-03-05", to: "2026-03-01" }), null, "the first day after the last");
  assert.equal(p("custom", { from: "2026-01-01", to: "2027-06-01" }).toDay, "2026-11-16", "never past today");
  assert.equal(periodRange("6m", at("2026-08-31T10:00:00")).fromDay, "2026-02-28", "31 August − 6 months is the end of February");
  assert.equal(p("nonsense"), null);
});

test("profit and loss for every period at once, each trade on the day it was closed, and every past financial year", () => {
  const j = freshJournal();
  j.ingestKite([
    ...trip("SBIN", "2026-11-16 09:30:00", "2026-11-16 10:00:00", 10, 800, 810), // today +100 gross
    ...trip("INFY", "2026-11-13 09:30:00", "2026-11-13 10:00:00", 10, 1500, 1490), // Friday −100 gross
    ...trip("TCS", "2026-10-29 09:30:00", "2026-11-02 10:00:00", 10, 3900, 3950, "CNC"), // bought in October, sold in November
    ...trip("ITC", "2025-06-10 09:30:00", "2025-06-10 10:00:00", 100, 400, 402), // FY 2025-26
    ...trip("ITC", "2024-12-10 09:30:00", "2024-12-10 10:00:00", 100, 400, 399), // FY 2024-25
  ]);
  const per = j.periods(NOW);
  const row = (id) => per.rows.find((r) => r.id === id);
  assert.equal(row("today").trades, 1);
  assert.equal(row("today").gross, 100);
  assert.equal(row("yesterday").gross, -100);
  assert.equal(row("week").trades, 1);
  assert.equal(row("month").trades, 3, "TCS counts in November, the month it was sold");
  assert.equal(row("quarter").trades, 3);
  assert.equal(row("12m").trades, 3);
  assert.equal(row("fy").trades, 3);
  assert.deepEqual(per.fys.map((r) => [r.id, r.trades]), [["fy-2025", 1], ["fy-2024", 1]], "every past financial year since the first trade");
  assert.equal(per.all.trades, 5);
  assert.equal(per.firstDay, "2024-12-10");
  const t = row("today");
  assert.ok(t.charges > 0 && t.net < t.gross && t.brokerage <= t.charges);
  assert.equal(t.taxes, Math.round((t.charges - t.brokerage) * 100) / 100);
  assert.ok(per.months.some((m) => m.month === "2025-06" && m.fy === 2025));
  // the account opened earlier than the first trade: its years are listed, empty
  j.setAccountSince("2022-07-01");
  assert.deepEqual(j.periods(NOW).fys.map((r) => r.id), ["fy-2025", "fy-2024", "fy-2023", "fy-2022"]);
  assert.match(j.setAccountSince("2099-01-01").error, /past date/);
});

test("the journal for one period, with month by month, best and worst, and the deeper figures", () => {
  const j = freshJournal();
  j.ingestKite([...trip("SBIN", "2026-09-10 09:30:00", "2026-09-10 10:00:00", 10, 800, 830), ...trip("SBIN", "2026-10-12 09:30:00", "2026-10-12 10:00:00", 10, 800, 790), ...trip("INFY", "2026-10-13 09:30:00", "2026-10-13 10:00:00", 10, 1500, 1520)]);
  const p = periodRange("fy", NOW);
  const a = j.analytics({ from: p.from, to: p.to });
  assert.equal(a.summary.trades, 3);
  assert.deepEqual(a.months.map((m) => [m.month, m.trades]), [["2026-10", 2], ["2026-09", 1]]);
  assert.equal(a.bestMonth.month, "2026-09");
  assert.ok(a.summary.profitFactor > 1);
  assert.ok(a.summary.maxDrawdown > 0, "the October loss is a fall from the September high");
  assert.equal(a.summary.bestDay.day, "2026-09-10");
  assert.equal(a.summary.worstDay.day, "2026-10-12");
  const s0 = summarize([]);
  assert.deepEqual([s0.trades, s0.net, s0.bestDay, s0.chargesPct], [0, 0, null, null]);
});

test("hand-typed fills of an earlier version are kept in the record but never counted", () => {
  const docs = new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-jh-")));
  docs.write("trading/journal.json", { fills: { "m:aaaaaaaaaaaa:1": { id: "m:aaaaaaaaaaaa:1", exchange: "NSE", symbol: "SBIN", side: "BUY", qty: 10, price: 800, at: at("2026-11-13T09:40:00"), source: "manual", batch: "aaaaaaaaaaaa" }, "m:aaaaaaaaaaaa:2": { id: "m:aaaaaaaaaaaa:2", exchange: "NSE", symbol: "SBIN", side: "SELL", qty: 10, price: 806, at: at("2026-11-13T13:10:00"), source: "manual", batch: "aaaaaaaaaaaa" } } });
  const j = new TradeJournal(docs);
  assert.equal(j.trips().length, 0);
  const v = j.view();
  assert.deepEqual([v.fills, v.ignoredManual, v.firstAt], [0, 2, null]);
  assert.equal(docs.items("journal_fills").filter((f) => f.source === "manual").length, 2, "nothing was deleted (kept with the other fills)");
  assert.equal(typeof j.addManual, "undefined", "there is no way to type a trade in any more");
});

test("saved views, the daily snapshot of every period, captured days and the gaps in the history", () => {
  const j = freshJournal();
  j.ingestKite([...trip("SBIN", "2026-11-16 09:30:00", "2026-11-16 10:00:00", 10, 800, 810), ...trip("ITC", "2026-06-01 09:30:00", "2026-06-01 10:00:00", 100, 400, 402)]);
  // views
  const v = j.saveView({ name: "  Intraday   this FY ", period: "fy", kind: "intraday" }, NOW);
  assert.equal(v.view.name, "Intraday this FY");
  j.saveView({ name: "intraday this fy", period: "custom", from: "2026-06-01", to: "2026-06-30" }, NOW);
  assert.equal(j.views().length, 1, "the same name replaces the view");
  assert.equal(j.views()[0].period, "custom");
  assert.match(j.saveView({ name: "x", period: "custom", from: "2026-06-30", to: "2026-06-01" }, NOW).error, /not valid/);
  assert.equal(j.removeView(j.views()[0].id).removed, 1);
  // snapshot: written once per change
  const s1 = j.snapshot(NOW);
  assert.equal(s1.saved, true);
  assert.equal(j.snapshot(NOW).saved, false, "nothing changed: nothing written");
  const snaps = j.snapshots();
  assert.ok(snaps.days["2026-11-16"].rows.some((r) => r[0] === "fy" && r[4] === 2));
  // captured days and gaps: June to November has nothing on record but the two trades
  j.markCaptured("2026-11-13", 0);
  const per = j.periods(NOW);
  assert.equal(per.sources.capturedDays, 1);
  assert.ok(per.gaps.length >= 1 && per.gaps[0].weekdays >= 10, "a long run of weekdays with nothing on record is a gap");
  assert.ok(per.gaps.every((g) => g.fromDay > "2026-06-01"));
});

test("the automatic capture reads today's trades from Kite on weekdays, marks the day and saves the snapshot", async () => {
  const { JournalCapture, captureWindow } = require("../journal-capture");
  assert.equal(captureWindow(at("2026-11-16T09:00:00")), false, "before 9:10");
  assert.equal(captureWindow(at("2026-11-16T09:15:00")), true);
  assert.equal(captureWindow(at("2026-11-16T22:30:00")), true, "a late Kite login still saves the day");
  assert.equal(captureWindow(at("2026-11-15T11:00:00")), false, "Sunday");
  const j = freshJournal();
  let connected = false;
  const today = trip("SBIN", "2026-11-16 09:30:00", "2026-11-16 10:00:00", 10, 800, 810); // the same two trades on every read
  const trading = { journal: j, trades: async () => today.map((t) => ({ ...t })) };
  const cap = new JournalCapture({ trading, market: { kiteAuth: () => connected }, now: () => at("2026-11-16T11:00:00"), log: { log() {} } });
  assert.equal(await cap.tick(), null, "not connected: nothing read");
  connected = true;
  const r = await cap.tick();
  assert.deepEqual([r.day, r.trades, r.added, r.error], ["2026-11-16", 2, 2, ""]);
  assert.equal((await cap.tick()).added, 0, "repeats are ignored");
  assert.equal(j.periods(at("2026-11-16T11:00:00")).sources.lastCaptured.day, "2026-11-16");
  assert.ok(Object.keys(j.snapshots().days).length === 1);
  trading.trades = async () => {
    throw new Error("Zerodha session expired");
  };
  assert.match((await cap.tick()).error, /expired/);
});

/* ------------------------------------------- tradebook files: .xlsx and .csv, every column kept */

const { readTradebook } = require("../trading/journal");
const { makeXlsx } = require("./helpers/xlsx-maker");
const { readXlsx } = require("../trading/xlsx");

const CONSOLE_HEAD = ["Symbol", "ISIN", "Trade Date", "Exchange", "Segment", "Series", "Trade Type", "Auction", "Quantity", "Price", "Trade ID", "Order ID", "Order Execution Time"];

test("a Console tradebook .xlsx is read: title rows skipped, Excel dates, every column kept", () => {
  const buf = makeXlsx([
    ["Client ID", "AB1234"],
    ["Tradebook for Equity from 2025-04-01 to 2026-03-31"],
    [],
    CONSOLE_HEAD,
    ["SBIN", "INE062A01020", "2025-06-10", "NSE", "EQ", "EQ", "buy", "false", 10, 800.5, "T1001", "O9001", "2025-06-10T09:31:05"],
    ["SBIN", "INE062A01020", "2025-06-10", "NSE", "EQ", "EQ", "sell", "false", 10, "805.25", "T1002", "O9002", 45818.5625], // an Excel date number: 13:30 IST
    ["NIFTY25JUN24500CE", "", "2025-06-11", "NSE", "FO", "", "buy", "false", 75, 120, "T2001", "O9101", "2025-06-11T10:00:00"],
    ["", "", "", "", "", "", "", "", "", "", "", "", ""],
    ["junk", "", "", "", "", "", "hold", "", 0, 0, "", "", ""],
  ]);
  assert.equal(readXlsx(buf)[0].name, "Equity");
  const r = readTradebook(buf, { file: "abcdef0123456789" });
  assert.equal(r.kind, "xlsx");
  assert.equal(r.error, "");
  assert.equal(r.fills.length, 3);
  assert.equal(r.skipped, 1, "the junk row is counted, the empty one ignored");
  const [b, sOut, fo] = r.fills;
  assert.deepEqual([b.id, b.symbol, b.side, b.qty, b.price, b.isin, b.segment, b.series, b.tradeDate, b.file, b.source], ["k:NSE:T1001", "SBIN", "BUY", 10, 800.5, "INE062A01020", "EQ", "EQ", "2025-06-10", "abcdef0123456789", "console"]);
  assert.equal(new Date(sOut.at + 5.5 * 3600000).toISOString().slice(0, 16), "2025-06-10T13:30");
  assert.equal(fo.exchange, "NFO", "F&O trades are kept apart from equity (no equity charges on them)");
  assert.deepEqual(r.segments.sort(), ["NFO", "NSE"]);
  assert.deepEqual([r.fromDay, r.toDay], ["2025-06-10", "2025-06-11"]);
});

test("CSV tradebooks in other shapes: semicolons, day-first dates, a time with its own date column, UTF-16", () => {
  const semi = "symbol;trade_date;exchange;trade_type;quantity;price;trade_id;order_id;order_execution_time\nINFY;10-06-2025;NSE;BUY;5;1500;X1;Y1;10-06-2025 09:40\nINFY;10-06-2025;NSE;SELL;5;1510;X2;Y2;10-06-2025 14:05:30\n";
  const r = readTradebook(Buffer.from(semi));
  assert.deepEqual([r.kind, r.fills.length, r.fromDay], ["csv", 2, "2025-06-10"]);
  assert.equal(new Date(r.fills[1].at + 5.5 * 3600000).toISOString().slice(11, 19), "14:05:30");
  const split = "symbol,trade_date,trade_type,quantity,price,trade_id,trade_time\nTCS,2025-07-01,buy,1,3900,Z1,09:20:00\n";
  assert.equal(new Date(readTradebook(Buffer.from(split)).fills[0].at + 5.5 * 3600000).toISOString().slice(0, 19), "2025-07-01T09:20:00");
  const u16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("symbol\ttrade_type\tquantity\tprice\ttrade_id\torder_execution_time\nITC\tbuy\t10\t400\tU1\t2025-07-02T10:00:00\n", "utf16le")]);
  assert.equal(readTradebook(u16).fills[0].symbol, "ITC");
  assert.match(readTradebook(Buffer.from("name,age\nA,3\n")).error, /does not look like a Zerodha Console tradebook/);
  assert.match(readTradebook(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])).error, /not an \.xlsx|damaged/);
});

test("fills live one record each; the old journal record is moved out once; a Kite trade and its Console row are one", () => {
  const docs = new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-jf-")));
  docs.write("trading/journal.json", { fills: { "k:NSE:T1": { id: "k:NSE:T1", exchange: "NSE", symbol: "SBIN", side: "BUY", qty: 10, price: 800, at: at("2025-06-10T09:31:00"), source: "kite" } }, tags: {} });
  const j = new TradeJournal(docs);
  assert.equal(j.view().fills, 1);
  assert.equal(docs.read("trading/journal.json").fills, undefined, "moved out of the journal record");
  assert.equal(docs.items("journal_fills").length, 1);
  // the same trade again from a Console file: not counted twice
  const csv = `${CONSOLE_HEAD.join(",")}\nSBIN,INE062A01020,2025-06-10,NSE,EQ,EQ,buy,false,10,800,T1,O1,2025-06-10T09:31:00\nSBIN,INE062A01020,2025-06-10,NSE,EQ,EQ,sell,false,10,806,T2,O2,2025-06-10T13:00:00\n`;
  const r = j.importFile(Buffer.from(csv), { name: "fy25.csv", file: "1111222233334444" });
  assert.deepEqual([r.added, r.read], [1, 2]);
  assert.equal(j.trips()[0].pnl, 60);
  const imp = j.view().imports[0];
  assert.deepEqual([imp.name, imp.kind, imp.file, imp.added], ["fy25.csv", "csv", "1111222233334444", 1]);
});

/* ---------------------------------------------------- deeper figures and the retrospective */

const tripAt = (sym, dayStr, inT, outT, qty, buy, sell, product = "MIS") => trip(sym, `${dayStr} ${inT}`, `${dayStr} ${outT}`, qty, buy, sell, product);

test("the deeper figures: day by day, running total and falls, costs by kind, holding time, spread, rolling win rate, mix, health, the period before", () => {
  const j = freshJournal();
  j.ingestKite([
    ...tripAt("SBIN", "2026-10-05", "10:05:00", "10:09:00", 100, 800, 806), // +600, 4 min
    ...tripAt("INFY", "2026-10-05", "11:00:00", "11:40:00", 10, 1500, 1480), // −200, 40 min
    ...tripAt("TCS", "2026-10-06", "09:30:00", "13:30:00", 5, 3900, 3920), // +100, 4 h
    ...trip("ITC", "2026-10-06 10:00:00", "2026-10-09 10:00:00", 100, 400, 410, "CNC"), // +1000, overnight
    ...tripAt("SBIN", "2026-09-10", "10:00:00", "10:30:00", 10, 800, 790), // before the period: −100
  ]);
  const p = periodRange("custom", NOW, { from: "2026-10-01", to: "2026-10-31" });
  const a = j.analytics({ from: p.from, to: p.to });
  assert.deepEqual(a.days.map((d) => [d.date, d.trades]), [["2026-10-05", 2], ["2026-10-06", 1], ["2026-10-09", 1]]);
  assert.equal(a.days[0].grossProfit, 600);
  assert.equal(a.days[0].grossLoss, 200);
  assert.equal(a.curve.length, 3);
  assert.ok(a.curve.every((c) => c.drawdown <= 0));
  assert.ok(a.costs.brokerage > 0 && a.costs.stt > 0 && a.costs.dp > 0, "the delivery trade pays the DP charge");
  const hold = Object.fromEntries(a.holding.map((h) => [h.key, h.trades]));
  assert.deepEqual(hold, { lt5: 1, "15to60": 1, gt3h: 1, multi: 1 });
  assert.equal(a.spread.reduce((s, b) => s + b.trades, 0), 4);
  assert.equal(a.rolling[a.rolling.length - 1].n, 4);
  assert.deepEqual(a.mix.map((m) => [m.key, m.trades]), [["intraday", 3], ["delivery", 1]]);
  assert.ok(a.health.score >= 0 && a.health.score <= 100 && a.health.parts.length === 6);
  assert.equal(a.health.enough, false, "4 trades are too few to score with confidence");
  assert.equal(a.prev.trades, 1, "September, the month before");
  assert.ok(a.prev.net < 0);
});

test("the retrospective: a losing period names what went wrong — revenge trades, busy days, a big loss — and what to try; it is saved", () => {
  const j = freshJournal();
  const fills = [];
  // three busy days with losses and quick re-entries in the same stock after each loss
  for (const dd of ["2026-11-02", "2026-11-03", "2026-11-04"]) {
    const times = [["10:00", "10:05"], ["10:10", "10:15"], ["10:20", "10:25"], ["10:30", "10:35"], ["10:40", "10:45"], ["10:50", "10:55"], ["11:00", "11:05"]];
    times.forEach(([i, o], k) => fills.push(...tripAt("INFY", dd, `${i}:00`, `${o}:00`, 10, 1500, k % 3 === 0 ? 1503 : 1496)));
  }
  fills.push(...tripAt("SBIN", "2026-11-05", "10:00:00", "14:00:00", 100, 800, 760)); // one big loss
  for (let k = 0; k < 4; k += 1) fills.push(...tripAt("TCS", `2026-11-0${6 + (k % 3)}`, `1${k}:00:00`, `1${k}:20:00`, 5, 3900, 3910));
  j.ingestKite(fills);
  const p = periodRange("month", NOW);
  const r = j.retrospective({ from: p.from, to: p.to, period: { id: p.id, label: p.label, fromDay: p.fromDay, toDay: p.toDay } }, NOW);
  assert.equal(r.verdict, "bad");
  assert.match(r.headline, /^A losing period/);
  const wrong = r.wentWrong.map((x) => x.text).join("\n");
  assert.match(wrong, /You lost money/);
  assert.match(wrong, /jumped back into the same stock within 15 minutes/);
  assert.match(wrong, /very busy day/);
  assert.match(wrong, /One trade lost ₹4,0\d\d \(SBIN/, "the loss after costs");
  assert.match(r.wentWell.map((x) => x.text).join("\n"), /TCS made you/);
  assert.ok(r.stopDoing.length >= 2 && r.tryNext.length >= 2);
  assert.ok(r.tryNext.some((x) => /wait 30 minutes/.test(x.text)));
  assert.match(r.note, /not investment advice/);
  // saved, listed, opened, removed
  assert.equal(j.retros()[0].id, r.id);
  assert.equal(j.retro(r.id).headline, r.headline);
  assert.equal(j.removeRetro(r.id).length, 0);
  // an empty period says so
  const none = j.retrospective({ from: Date.parse("2020-01-01T00:00:00+05:30"), to: Date.parse("2020-01-31T23:59:59+05:30"), period: { label: "Jan 2020" } }, NOW);
  assert.equal(none.verdict, "none");
  assert.match(none.headline, /No closed trades/);
});

test("the total profit or loss as a percentage: of the money put into the trades (size at entry price), for the period, each day, each month and each group", () => {
  const { stats, summarize, byMonth } = require("../trading/journal");
  const at = (d, hm) => Date.parse(`${d}T${hm}:00+05:30`);
  const mk = (symbol, side, qty, entry, exit, day, charges = 0) => {
    const pnl = (side === "long" ? exit - entry : entry - exit) * qty;
    return { symbol, side, qty, maxQty: qty, entryAvg: entry, exitAvg: exit, entryAt: at(day, "10:00"), exitAt: at(day, "11:00"), pnl, charges, brokerage: charges / 2, net: pnl - charges, open: false, intraday: true, holdMin: 60 };
  };
  const trips = [mk("SBIN", "long", 100, 1000, 1010, "2026-11-12", 50), mk("TCS", "short", 10, 3000, 3030, "2026-11-12", 50), mk("INFY", "long", 50, 1500, 1503, "2026-11-13", 30)];
  const s = stats(trips);
  assert.equal(s.invested, 100000 + 30000 + 75000, "each trade's size at its entry price, added up");
  assert.equal(s.net, 1000 - 50 - 300 - 50 + 150 - 30);
  assert.equal(s.netPct, Math.round((s.net / s.invested) * 10000) / 100);
  assert.equal(s.grossPct, Math.round(((1000 - 300 + 150) / s.invested) * 10000) / 100);
  const day = s.calendar.find((d) => d.key === "2026-11-12");
  assert.equal(day.invested, 130000);
  assert.equal(day.netPct, Math.round(((1000 - 50 - 300 - 50) / 130000) * 10000) / 100);
  assert.equal(s.by.symbol.find((x) => x.key === "TCS").netPct, Math.round(((-300 - 50) / 30000) * 10000) / 100, "a short counts its entry value too");
  assert.equal(summarize(trips).netPct, s.netPct);
  assert.equal(byMonth(trips)[0].netPct, s.netPct);
  assert.equal(stats([]).netPct, null, "nothing put in, no percentage");
});
