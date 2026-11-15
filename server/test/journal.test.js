"use strict";
// The trade journal and the risk guard's rules: pure functions, no server.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { roundTrips, charges, stats, excursion, fromConsoleCsv, TradeJournal } = require("../trading/journal");
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

/* ---------------------------------------------------------------- trades typed in by hand */

const NOW = at("2026-11-14T20:00:00");
const manual = (o = {}) => ({ date: "2026-11-13", symbol: "sbin", side: "long", qty: 10, entryPrice: 800, exitPrice: 806, entryTime: "09:40", exitTime: "13:10", ...o });
const freshJournal = () => new TradeJournal(new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-jm-"))));

test("a trade typed in by hand is two fills that pair into one round trip with charges", () => {
  const j = freshJournal();
  const r = j.addManual(manual(), NOW);
  assert.equal(r.error, undefined);
  assert.match(r.batch, /^[a-f0-9]{12}$/);
  const trips = j.trips();
  assert.equal(trips.length, 1);
  const t = trips[0];
  assert.deepEqual([t.symbol, t.side, t.qty, t.entryAvg, t.exitAvg, t.pnl, t.intraday, t.open], ["SBIN", "long", 10, 800, 806, 60, true, false]);
  assert.equal(t.manual, r.batch);
  assert.ok(t.charges > 0 && t.net < t.pnl, "charges are estimated like any other trade");
  assert.ok(t.brokerage > 0 && t.brokerage <= t.charges);
  // it shows in the calendar with the figures a day needs
  const day = stats(trips).calendar.find((c) => c.key === "2026-11-13");
  assert.deepEqual([day.trades, day.gross], [1, 60]);
  assert.equal(day.taxes, Math.round((day.charges - day.brokerage) * 100) / 100);
});

test("a short trade, and a delivery trade over two days, are paired and marked", () => {
  const j = freshJournal();
  j.addManual(manual({ side: "short", entryPrice: 810, exitPrice: 804 }), NOW);
  const r = j.addManual(manual({ symbol: "TCS", date: "2026-11-10", exitDate: "2026-11-12", entryPrice: 3900, exitPrice: 3950 }), NOW);
  const trips = j.trips();
  const sbin = trips.find((t) => t.symbol === "SBIN");
  const tcs = trips.find((t) => t.symbol === "TCS");
  assert.deepEqual([sbin.side, sbin.pnl], ["short", 60]);
  assert.deepEqual([tcs.intraday, tcs.product, tcs.pnl], [false, "CNC", 500]);
  assert.equal(tcs.manual, r.batch);
});

test("hand-typed trades are checked: future days, bad prices, the exit before the entry", () => {
  const j = freshJournal();
  const bad = (o, re) => assert.match(j.addManual(manual(o), NOW).error || "", re);
  bad({ date: "2026-11-15" }, /not happened/);
  bad({ date: "2026-13-40" }, /date of the trade/);
  bad({ symbol: "" }, /symbol/);
  bad({ exchange: "NFO" }, /NSE and BSE/);
  bad({ side: "" }, /long .* or short/);
  bad({ qty: 1.5 }, /whole number/);
  bad({ entryPrice: 0 }, /prices/);
  bad({ entryTime: "25:00" }, /hours and minutes/);
  bad({ exitTime: "09:00" }, /exit must come after/);
  bad({ exitDate: "2026-11-12" }, /before the entry date/);
  bad({ date: "2026-11-14", entryTime: "21:00", exitTime: "21:30" }, /future/);
  assert.equal(j.trips().length, 0, "nothing was saved");
});

test("a hand-typed trade can be removed with its tag, and warns when Zerodha already gave that day", () => {
  const j = freshJournal();
  // an earlier, complete round trip in the same stock that day (so the two do not interleave)
  j.ingestKite([
    { id: "9001", orderId: "o1", exchange: "NSE", symbol: "SBIN", side: "BUY", quantity: 5, price: 801, at: "2026-11-13 09:20:00", product: "MIS" },
    { id: "9002", orderId: "o2", exchange: "NSE", symbol: "SBIN", side: "SELL", quantity: 5, price: 802, at: "2026-11-13 09:30:00", product: "MIS" },
  ]);
  const r = j.addManual(manual(), NOW);
  assert.match(r.warn, /already has 2 fills/);
  const key = r.key;
  j.setTags(key, { setup: "Opening range" });
  assert.equal(j.trips().find((t) => t.manual === r.batch).tags.setup, "Opening range");
  assert.equal(j.removeManual(r.batch), 2);
  assert.equal(j.trips().find((t) => t.manual), undefined);
  assert.equal(j.view().setups.length, 0, "its tag went with it");
  assert.equal(j.removeManual(r.batch), 0);
  assert.equal(j.removeManual("zzzz"), 0);
});
