"use strict";
// Other credits & debits: the Console ledger read, the entries by hand, what counts, and the journal's view.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { TradeJournal } = require("../trading/journal");
const { fromLedgerRows, classify, counted, totals } = require("../trading/otherbook");
const { FileDocs } = require("../docs");

const at = (s) => Date.parse(`${s}+05:30`);
const j0 = () => new TradeJournal(new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-ob-"))));

const LEDGER = [
  "particulars,posting_date,cost_center,voucher_type,debit,credit,net_balance",
  "Opening Balance,2026-04-01,,,0,0,1000",
  'Net obligation for Equity on 2026-04-02,2026-04-02,NSE-EQ,Book Voucher,0,1500,2500',
  "Funds added using UPI,2026-04-03,,Bank Receipts,0,10000,12500",
  "DP charges for Q-123 on 2026-04-04,2026-04-05,,Journal Entry,15.34,0,12484.66",
  "Annual maintenance charges for 2026,2026-04-10,,Journal Entry,354,0,12130.66",
  "Dividend from INFY,2026-04-12,,Journal Entry,0,\"1,200.50\",13331.16",
  "Interest on delayed payment,2026-04-15,,Journal Entry,22.1,0,13309.06",
  "Withdrawal to bank,2026-04-20,,Bank Payments,5000,0,8309.06",
  "Something odd,not-a-date,,Journal Entry,1,0,0",
].join("\n");

test("a Console ledger: only the non-trade entries are read, the rest are counted by what they are", () => {
  const { csvRows } = require("../trading/journal");
  const r = fromLedgerRows(csvRows(LEDGER));
  assert.equal(r.error, "");
  assert.deepEqual(r.entries.map((e) => [e.date, e.amount, e.kind]), [
    ["2026-04-05", -15.34, "dp"],
    ["2026-04-10", -354, "amc"],
    ["2026-04-12", 1200.5, "dividend"],
    ["2026-04-15", -22.1, "interest"],
  ]);
  assert.equal(r.left["trade settlements"], 1);
  assert.equal(r.left["fund transfers"], 3 - 1 + 0); // funds added, withdrawal
  assert.equal(r.left.balances, 1);
  assert.equal(r.left["lines that could not be read"], 1);
});

test("not a ledger: said so, nothing is guessed", () => {
  const r = fromLedgerRows([["symbol", "quantity"], ["INFY", "1"]]);
  assert.match(r.error, /ledger/i);
  assert.equal(r.entries.length, 0);
});

test("classify names the kinds", () => {
  assert.equal(classify("DP charges for x", "Journal Entry").kind, "dp");
  assert.equal(classify("Call & trade charges", "Journal Entry").kind, "call");
  assert.equal(classify("Net settlement for Equity", "Book Voucher").kind, null);
  assert.equal(classify("Cheque bounce penalty", "Journal Entry").kind, "charges");
});

test("totals: credits and debits apart; a DP charge already inside the day's estimated charges is not counted twice", () => {
  const list = counted(
    [
      { id: "a", date: "2026-04-05", amount: -15.34, kind: "dp" },
      { id: "b", date: "2026-04-06", amount: -15.34, kind: "dp" },
      { id: "c", date: "2026-04-12", amount: 1200.5, kind: "dividend" },
      { id: "d", date: "2026-04-10", amount: -354, kind: "amc" },
    ],
    { fromDay: "2026-04-01", toDay: "2026-04-30" },
    new Map([["2026-04-05", 15.34]])
  );
  assert.equal(list.find((e) => e.id === "a").covered, true);
  const t = totals(list);
  assert.deepEqual([t.total, t.credits, t.debits, t.covered, t.count], [831.16, 1200.5, -369.34, 1, 4]);
  assert.equal(t.byKind.dividend, 1200.5);
});

test("by hand: a credit or a debit, dated in the past; bad input is refused; removing works", () => {
  const j = j0();
  const now = at("2026-11-24T10:00:00");
  assert.match(j.addOther({ date: "2027-01-01", amount: 5 }, now).error, /passed/);
  assert.match(j.addOther({ date: "2026-11-01", amount: 0 }, now).error, /amount/);
  const a = j.addOther({ date: "2026-11-01", amount: -354, kind: "amc", note: "AMC \u0001" }, now);
  assert.equal(a.entry.kind, "amc");
  assert.equal(a.entry.note, "AMC");
  j.addOther({ date: "2026-11-05", amount: 100, kind: "nonsense" }, now);
  const all = j.others();
  assert.deepEqual([all.total, all.credits, all.debits, all.count], [-254, 100, -354, 2]);
  assert.equal(all.entries[1].kind, "other");
  const left = j.removeOther(a.entry.id);
  assert.equal(left.count, 1);
  assert.match(j.removeOther("nope").error, /no such/);
});

test("importing the same ledger twice adds nothing the second time; the journal's view carries the period's total", () => {
  const j = j0();
  const now = at("2026-11-24T10:00:00");
  const one = j.importLedger(Buffer.from(LEDGER, "utf8"), { name: "ledger.csv" }, now);
  assert.equal(one.error, "");
  assert.equal(one.added, 4);
  const two = j.importLedger(Buffer.from(LEDGER, "utf8"), { name: "ledger.csv" }, now);
  assert.equal(two.added, 0);
  const v = j.view({ period: { fromDay: "2026-04-01", toDay: "2026-04-30" } });
  assert.equal(v.other.count, 4);
  assert.equal(v.other.total, r2(-15.34 - 354 + 1200.5 - 22.1));
  const narrow = j.view({ period: { fromDay: "2026-04-11", toDay: "2026-04-30" } });
  assert.equal(narrow.other.count, 2);
  assert.match(j.importLedger(Buffer.from("symbol,qty\nA,1", "utf8"), { name: "x.csv" }, now).error, /ledger/i);
});
const r2 = (x) => Math.round(x * 100) / 100;

test("Console's own .xlsx layout: title rows, an empty first column, the header on row 15, balances without dates, four decimals; two alike entries are both kept and a re-read adds nothing", () => {
  const { readXlsx } = require("../trading/xlsx");
  assert.equal(typeof readXlsx, "function");
  const rows = [
    [], [], [],
    ["", "Client ID", "AB1234"],
    ["", "Ledger for Equity from 2026-11-11 to 2026-11-24"],
    [],
    ["", "Particulars", "Posting Date", "Cost Center", "Voucher Type", "Debit", "Credit", "Net Balance"],
    ["", "Opening Balance", "", "", "", "", "", "0.0046"],
    ["", "Funds added using UPI from AB1234 with reference number 1", "2026-11-12", "NSE-EQ - Z", "Bank Receipts", "0.0000", "69001.0000", "69001.0046"],
    ["", "Net settlement for Equity with settlement number: 2026214", "2026-11-12", "NSE-EQ - Z", "Book Voucher", "0.0000", "7967.2782", "76968.2829"],
    ["", "Call and Trade charges(Auto Square Off) for 2026-11-23", "2026-11-23", "NSE-EQ - Z", "Journal Entry", "59.0000", "0.0000", "71867.1178"],
    ["", "Call and Trade charges(Auto Square Off) for 2026-11-23", "2026-11-23", "NSE-EQ - Z", "Journal Entry", "59.0000", "0.0000", "71808.1178"],
    ["", "Closing Balance", "", "", "", "", "", "71808.1178"],
  ];
  const r = fromLedgerRows(rows);
  assert.equal(r.error, "");
  assert.deepEqual(r.entries.map((e) => [e.date, e.amount, e.kind]), [["2026-11-23", -59, "call"], ["2026-11-23", -59, "call"]]);
  assert.deepEqual(r.left, { balances: 2, "fund transfers": 1, "trade settlements": 1 });
  const { numbered } = require("../trading/otherbook");
  const keys = numbered(r.entries).map((e) => e.key);
  assert.equal(new Set(keys).size, 2);
});
