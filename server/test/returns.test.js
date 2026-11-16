"use strict";
// The journal's percentage returns on the trader's principal: the capital ledger, a month's base (the principal on its
// first trading day, and from the day money was added), the day and period figures, and the risk ratios.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const R = require("../trading/returns");
const { TradeJournal } = require("../trading/journal");
const { FileDocs } = require("../docs");

const at = (s) => Date.parse(`${s}+05:30`);
const trip = (day, net) => ({ exitAt: at(`${day}T14:00:00`), net, pnl: net + 20, open: false });
const LEDGER = [{ id: "a", date: "2026-10-01", amount: 100000 }, { id: "b", date: "2026-10-16", amount: 50000, note: "added" }];

test("the principal on a day is the ledger added up to it, and never goes below zero", () => {
  const led = R.ledger(LEDGER);
  assert.equal(R.principalOn(led, "2026-09-30"), 0);
  assert.equal(R.principalOn(led, "2026-10-15"), 100000);
  assert.equal(R.principalOn(led, "2026-10-16"), 150000, "an addition counts from the day it was made");
  assert.equal(R.overdrawn([...LEDGER, { date: "2026-10-20", amount: -200000 }]).date, "2026-10-20");
  assert.equal(R.overdrawn(LEDGER), null);
});

test("a month's return is over its principal: the first trading day's, and from the day money was added", () => {
  const r = R.compute({ trips: [trip("2026-10-05", 3000), trip("2026-10-20", -1000)], entries: LEDGER, fromDay: "2026-10-01", toDay: "2026-10-30" });
  assert.equal(r.hasCapital, true);
  const m = r.months[0];
  assert.equal(m.month, "2026-10");
  assert.equal(m.startPrincipal, 100000, "the principal on the first trading day of the month");
  assert.equal(m.endPrincipal, 150000);
  assert.equal(m.base, 125000, "11 weekdays on 1,00,000 and 11 on 1,50,000: the addition counts from its day");
  assert.equal(m.net, 2000);
  assert.equal(m.pct, 1.6);
  assert.deepEqual(m.additions.map((a) => a.amount), [50000]);
  assert.equal(r.totalPct, 1.6);
  // the days are over the principal of their own day
  assert.equal(r.daily.find((d) => d.date === "2026-10-05").pct, 3);
  assert.equal(r.daily.find((d) => d.date === "2026-10-20").pct, Math.round((-1000 / 150000) * 10000) / 100);
  assert.ok(r.risk.enough && r.risk.sharpe !== null && r.risk.maxDrawdownPct > 0, "22 weekdays are enough for the ratios");
  assert.equal(r.bestMonth.month, "2026-10");
  assert.equal(r.curve.length, 22);
});

test("a period's total is the sum of its months, each on its own principal; profit is not added to the principal", () => {
  const led = [{ id: "a", date: "2026-09-01", amount: 100000 }];
  const r = R.compute({ trips: [trip("2026-09-10", 5000), trip("2026-10-12", 2000)], entries: led, fromDay: "2026-09-01", toDay: "2026-10-30" });
  assert.deepEqual(r.months.map((m) => [m.month, m.pct]), [["2026-09", 5], ["2026-10", 2]]);
  assert.equal(r.totalPct, 7);
  assert.equal(r.avgMonthPct, 3.5);
  assert.equal(r.months[1].cumPct, 7);
  assert.equal(r.greenMonths, 2);
});

test("without any capital recorded there is no percentage — the page asks for it; a month before the first entry has none", () => {
  const none = R.compute({ trips: [trip("2026-10-05", 3000)], entries: [], fromDay: "2026-10-01", toDay: "2026-10-30" });
  assert.equal(none.needsCapital, true);
  assert.equal(none.totalPct, null);
  assert.equal(none.months[0].pct, null);
  const late = R.compute({ trips: [trip("2026-10-05", 3000)], entries: [{ id: "a", date: "2026-11-01", amount: 100000 }], fromDay: "2026-10-01", toDay: "2026-10-30" });
  assert.equal(late.hasCapital, false);
  assert.equal(R.compute({ trips: [], entries: LEDGER, fromDay: "bad", toDay: "2026-10-30" }).error.length > 0, true);
  const few = R.compute({ trips: [trip("2026-10-05", 3000)], entries: LEDGER, fromDay: "2026-10-01", toDay: "2026-10-09" });
  assert.equal(few.risk.enough, false);
  assert.equal(few.risk.sharpe, null, "fewer than 20 days: no risk ratio");
});

test("the capital ledger: added with a date and an amount, checked, kept in the journal record, removed", () => {
  const j = new TradeJournal(new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-cap-"))));
  const now = at("2026-11-16T12:00:00");
  assert.deepEqual(j.capital(), []);
  assert.match(j.addCapital({ date: "2026-12-01", amount: 1000 }, now).error, /date that has passed/);
  assert.match(j.addCapital({ date: "2026-10-01", amount: 0 }, now).error, /Give an amount/);
  assert.match(j.addCapital({ date: "2026-10-01", amount: -500 }, now).error, /below zero/);
  const a = j.addCapital({ date: "2026-10-01", amount: 100000, note: "first capital" }, now);
  assert.equal(a.entry.amount, 100000);
  const b = j.addCapital({ date: "2026-10-16", amount: 50000 }, now);
  assert.equal(j.capital().length, 2);
  assert.match(j.addCapital({ date: "2026-10-20", amount: -200000 }, now).error, /below zero on 2026-10-20/);
  const w = j.addCapital({ date: "2026-11-02", amount: -140000 }, now);
  assert.equal(j.capital().length, 3);
  assert.match(j.removeCapital(b.entry.id).error, /below zero on 2026-11-02/, "an addition cannot be removed while a later withdrawal depends on it");
  assert.equal(j.removeCapital("nope").error, "There is no such entry.");
  assert.equal(j.removeCapital(w.entry.id).capital.length, 2);
  // it survives a reload of the journal
  assert.equal(new TradeJournal(j.docs).capital().length, 2);
  // and reaches the journal's own returns and the period rows
  const r = j.returns({}, now);
  assert.equal(r.hasCapital, true);
  assert.equal(r.principal.now, 150000);
  assert.equal(j.periods(now).capital, 2);
});
