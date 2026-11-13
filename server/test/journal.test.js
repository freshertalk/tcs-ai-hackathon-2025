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
