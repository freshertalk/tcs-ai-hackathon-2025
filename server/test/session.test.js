"use strict";
// NSE's day by date (server/market/session.js): when continuous trading ends and when Zerodha squares off intraday
// positions — and everything that counts minutes to the end of the day counting to the same minute.

const test = require("node:test");
const assert = require("node:assert/strict");

const S = require("../market/session");
const H = require("../market/horizon");
const { coach, newMemory, squareOffOf, replay } = require("../trading/exitcoach");
const { levelMap } = require("../trading/exitlevels");

const at = (date, hm) => Date.parse(`${date}T${hm}:00+05:30`);

test("the day by date: the old close, the closing auction from 3 August 2026, and the change of 7 December 2026", () => {
  // until 31 July 2026 everything traded to 3:30 PM and the desk counted to a 3:15 PM square-off
  assert.deepEqual(pick(S.sessionFor("2026-07-31")), ["vwap-close", "3:30 PM", 75, "3:15 PM", null]);
  assert.deepEqual(pick(S.sessionFor("2026-07-31", { cas: false })), ["vwap-close", "3:30 PM", 75, "3:15 PM", null]);
  // from 3 August 2026: F&O stocks stop at 3:15 PM for the closing auction and are squared off at 3:12 PM; the rest as before, at 3:25 PM
  assert.deepEqual(pick(S.sessionFor("2026-08-03")), ["closing-auction-1", "3:15 PM", 72, "3:12 PM", [915, 935]]);
  assert.deepEqual(pick(S.sessionFor("2026-11-20", { cas: false })), ["closing-auction-1", "3:30 PM", 75, "3:25 PM", null]);
  assert.equal(S.sessionFor("2026-11-20").unconfirmed, "");
  // from 7 December 2026 continuous trading runs to 3:30 PM again; the broker's times were not published, so the earliest is kept — and it says so
  const dec = S.sessionFor("2026-12-07");
  assert.deepEqual(pick(dec), ["closing-auction-2", "3:30 PM", 75, "3:12 PM", [930, 940]]);
  assert.match(dec.unconfirmed, /were not published/);
  // the moments themselves
  assert.equal(S.squareOffAt(at("2026-11-20", "10:00")), at("2026-11-20", "15:12"));
  assert.equal(S.squareOffAt(at("2026-11-20", "10:00"), { cas: false }), at("2026-11-20", "15:25"));
  assert.equal(S.closeAt(at("2026-11-20", "10:00")), at("2026-11-20", "15:15"));
  assert.equal(S.squareOffAt(at("2026-03-02", "10:00")), at("2026-03-02", "15:15"));
  assert.deepEqual([S.clockOf(555), S.clockOf(720), S.clockOf(912), S.clockAt(at("2026-11-20", "15:12"))], ["9:15 AM", "12:00 PM", "3:12 PM", "3:12 PM"]);
  // in a sentence, for a prompt or a note
  assert.match(S.squareOffNote("2026-11-20"), /squares off intraday \(MIS\) positions at 3:12 PM in stocks that have a closing auction \(every stock in the F&O list, whose continuous trading ends at 3:15 PM\) and at 3:25 PM in the rest/);
  assert.equal(S.squareOffNote("2026-03-02"), "Intraday (MIS) positions are squared off by the broker at about 3:15 PM.");
});
const pick = (x) => [x.regime, x.closeClock, x.closeSlot, x.squareOffClock, x.auction];

test("today's close for a stock follows its own last session — and the table on the first day of new rules", () => {
  // a stock whose last session ended at 3:15 PM (72 slots) is a closing-auction stock: the same today
  assert.equal(S.liveCloseSlot(72, "2026-11-19", "2026-11-20"), 72);
  assert.equal(S.liveCloseSlot(75, "2026-11-19", "2026-11-20"), 75, "a stock with no auction trades to 3:30 PM");
  assert.equal(S.liveCloseSlot(NaN, null, "2026-11-20"), 75, "nothing known: the usual close");
  // 7 December 2026: continuous trading runs to 3:30 PM again, whatever Friday looked like
  assert.equal(S.liveCloseSlot(72, "2026-12-04", "2026-12-07"), 75);
  assert.equal(S.liveCloseSlot(75, "2026-12-04", "2026-12-07"), 75);
  // (3 August 2026, looking back: every stock closed at 3:30 PM the day before; an F&O stock closes at 3:15 PM that day)
  assert.equal(S.liveCloseSlot(75, "2026-07-31", "2026-08-03"), 72);
});

test("the exit coach counts to the broker's square-off for the stock and the date, and says the time", () => {
  const day = "2026-11-20";
  const bars = Array.from({ length: 300 }, (_, i) => ({ t: at(day, "09:15") + i * 60000, o: 100, h: 100.1, l: 99.9, c: 100, v: 1000 }));
  const pos = { symbol: "SBIN", side: "long", qty: 10, avg: 100, entryAt: at(day, "10:00"), product: "MIS" };
  const look = (hm, opts = {}) => coach(pos, bars.filter((b) => b.t <= at(day, hm)), { last: 100 }, { now: at(day, hm), memory: newMemory(pos), ...opts });
  // a closing-auction stock (assumed when not told otherwise): 3:12 PM
  assert.equal(look("14:42").metrics.minutesToSquareOff, 30);
  assert.equal(look("15:08").state, "exit-now");
  assert.match(look("15:08").reasons.exit[0], /4 minutes to the 3:12 PM square-off/);
  // a stock with no closing auction: 3:25 PM — at 3:08 PM there are still 17 minutes
  const other = look("15:08", { cas: false });
  assert.equal(other.metrics.minutesToSquareOff, 17);
  assert.ok(!other.reasons.exit.some((r) => /minutes to the 3:\d\d PM square-off: exit yourself/.test(r)), "no forced exit yet");
  assert.ok(other.reasons.exit.some((r) => /17 minutes to the 3:25 PM square-off/.test(r)) || other.metrics.minutesToSquareOff === 17);
  assert.match(look("15:21", { cas: false }).reasons.exit[0], /4 minutes to the 3:25 PM square-off/);
  assert.equal(squareOffOf(at(day, "10:00")), at(day, "15:12"));
  assert.equal(squareOffOf(at(day, "10:00"), false), at(day, "15:25"));
  // a trade of last spring is replayed to the 3:15 PM the desk counted to then
  assert.equal(squareOffOf(at("2026-03-02", "10:00")), at("2026-03-02", "15:15"));
  assert.equal(typeof replay, "function");
  // the level map's minutes left are the same minutes
  const map = levelMap({ symbol: "SBIN", side: "long", qty: 10, avg: 100, entryAt: at(day, "10:00") }, bars.filter((b) => b.t <= at(day, "10:30")), { now: at(day, "10:30"), last: 100 });
  assert.equal(map.minutesLeft, 282);
  assert.equal(levelMap({ symbol: "SBIN", side: "long", qty: 10, avg: 100, entryAt: at(day, "10:00") }, bars.filter((b) => b.t <= at(day, "10:30")), { now: at(day, "10:30"), last: 100, cas: false }).minutesLeft, 295);
});

test("the forecaster counts back from when continuous trading really ends in the stock", () => {
  const openMs = at("2026-11-20", "09:15");
  const bars = (n) => Array.from({ length: n }, (_, i) => ({ t: openMs + i * 300000, o: 100 + i * 0.01, h: 100.05 + i * 0.01, l: 99.95 + i * 0.01, c: 100.01 + i * 0.01, v: 1000 }));
  const ctx = { sigma: 0.002, day: 0.015, beta: 1, vol: new Array(75).fill(1000), prevClose: 99.5, prevDayRet: 0.001, trend: 0, mkt: null };
  const ix = (name) => H.FEATURES.indexOf(name);
  // a full session to 3:30 PM: the closing rush starts 85 minutes before it (slot 58) and is full at the last bar
  const full = H.dayRows(bars(75), ctx, { targets: false, stride: 1 });
  assert.equal(full[58].x[ix("tClose")], 0);
  assert.equal(full[74].x[ix("tClose")], 1);
  // a session that ends at 3:15 PM reads the same 85 minutes before ITS close: three slots earlier
  const early = H.dayRows(bars(72), { ...ctx, closeSlot: 72 }, { targets: false, stride: 1 });
  assert.equal(early[55].x[ix("tClose")], 0);
  assert.equal(early[71].x[ix("tClose")], 1);
  assert.ok(early[58].x[ix("tClose")] > 0 && full[55].x[ix("tClose")] === 0);
  // the first half-hour's move counts in the last hour before the close: from 2:15 PM, not 2:30 PM
  assert.ok(early[60].x[ix("mom30")] !== 0 && full[60].x[ix("mom30")] === 0 && full[63].x[ix("mom30")] !== 0);
  assert.equal(H.closeOf({ closeSlot: 72 }), 72);
  assert.equal(H.closeOf({}), 75);
  assert.equal(H.closeOf({ closeSlot: 20 }), 75, "a half session is not a new closing time");
  assert.equal(H.MODEL_VERSION, 4, "the inputs changed meaning for sessions since 3 August 2026: the stored model is retrained by itself");
});

test("a simulated trade is closed at the last 5-minute bar before the broker's square-off on its own day", () => {
  // the old rules: 3:15 PM, as every simulation here always did — so results on sessions before August 2026 do not change
  assert.deepEqual([S.exitMinFor("2026-03-02"), S.exitHmFor("2026-03-02")], [915, "15:15"]);
  // since 3 August 2026 a closing-auction stock is squared off at 3:12 PM: out at the open of the 3:10 PM bar
  assert.deepEqual([S.exitMinFor("2026-11-20"), S.exitHmFor("2026-11-20")], [910, "15:10"]);
  // a stock with no auction: squared off at 3:25 PM, a bar boundary
  assert.deepEqual([S.exitMinFor("2026-11-20", { cas: false }), S.exitHmFor("2026-11-20", { cas: false })], [925, "15:25"]);
  assert.equal(S.exitAt(at("2026-11-20", "11:00")), at("2026-11-20", "15:10"));
  // the paper robot steps in real time, so it leaves at the square-off minute itself and says which
  const { squareOf } = require("../robot/engine");
  assert.deepEqual(squareOf(at("2026-11-20", "11:00")), { min: 912, clock: "3:12 PM" });
  assert.deepEqual(squareOf(at("2026-03-02", "11:00")), { min: 915, clock: "3:15 PM" });
  // the plan for a day says the same minute the backtest uses
  const { exitMinFor, clockOf } = S;
  assert.equal(clockOf(exitMinFor("2026-11-23")), "3:10 PM");
});
