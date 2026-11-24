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

/* ------------------------------------------------------------------ the ledger against the journal */
const { detectKind } = require("../trading/journal");
let nf = 0;
const fl = (time, side, qty, price, symbol = "INFY", product = "MIS") => ({ id: `r${(nf += 1)}`, exchange: "NSE", symbol, side, qty, price, at: at(time), product, source: "kite" });
const ledgerCsv = (lines) => ["particulars,posting_date,cost_center,voucher_type,debit,credit,net_balance", ...lines.map(([day, amt]) => `Net settlement for Equity with settlement number: ${day},${day},NSE-EQ,Book Voucher,${amt < 0 ? -amt : 0},${amt > 0 ? amt : 0},0`)].join("\n");

test("the file's own headers say what it is: tradebook, ledger, Console's P&L statement, or nothing known", () => {
  assert.equal(detectKind(Buffer.from(LEDGER)), "ledger");
  assert.equal(detectKind(Buffer.from("trade_id,symbol,trade_type,quantity,price,trade_date\n1,INFY,buy,1,1,2026-01-01")), "tradebook");
  assert.equal(detectKind(Buffer.from("Symbol,ISIN,Quantity,Buy Value,Sell Value,Profit\nA,B,1,1,2,1")), "pnl");
  assert.equal(detectKind(Buffer.from("a,b\n1,2")), "unknown");
});

test("ledger against journal: match, off by a little (corrected), off by a lot (left to check), delivery skipped; the correction flows into the trades and can be undone", () => {
  const j = j0();
  j.add([
    fl("2026-11-12T09:20:00", "BUY", 100, 1000), fl("2026-11-12T10:20:00", "SELL", 100, 1010), // day A
    fl("2026-11-13T09:20:00", "BUY", 100, 1000), fl("2026-11-13T10:20:00", "SELL", 100, 1005), // day B
    fl("2026-11-16T09:20:00", "BUY", 100, 1000), fl("2026-11-16T10:20:00", "SELL", 100, 990), // day C
    fl("2026-11-17T09:20:00", "BUY", 10, 500, "TCS", "CNC"), // delivery: open on D
  ], "kite");
  const est = (d) => { const t = j.trips({}).filter((x) => !x.open && x.exitAt && new Date(x.exitAt + 19800000).toISOString().slice(0, 10) === d); return t.reduce((a, x) => a + x.pnl - x.chargesEst, 0); };
  const a = Math.round(est("2026-11-12") * 100) / 100;
  const b = Math.round(est("2026-11-13") * 100) / 100;
  const c = Math.round(est("2026-11-16") * 100) / 100;
  const csv = ledgerCsv([["2026-11-12", a + 3.4], ["2026-11-13", b], ["2026-11-16", c - 400], ["2026-11-17", -5000], ["2026-11-18", 900]]);
  const r = j.importLedger(Buffer.from(csv), { name: "ledger.csv" }, at("2026-11-24T10:00:00"));
  assert.equal(r.settledDays, 5);
  const rec = j.reconcile();
  const st = Object.fromEntries(rec.days.map((x) => [x.date, x.status]));
  assert.deepEqual(st, { "2026-11-12": "off", "2026-11-13": "match", "2026-11-16": "check", "2026-11-17": "check", "2026-11-18": "check" });
  assert.equal(rec.days[0].diff, 3.4);

  // the correction: day A's charges rise by 3.40 less… the net becomes the ledger's, everywhere
  const before = j.trips({}).find((t) => !t.open && t.symbol === "INFY" && new Date(t.exitAt + 19800000).toISOString().startsWith("2026-11-12"));
  const m = j.applyMatch({}, at("2026-11-24T10:00:00"));
  assert.deepEqual(m.corrected, ["2026-11-12"]);
  const after = j.trips({}).find((t) => t.key === before.key);
  assert.equal(Math.round((after.net - (a + 3.4)) * 100) / 100, 0);
  assert.equal(Math.round((before.charges - after.charges - 3.4) * 100) / 100, 0);
  assert.equal(after.parts.other, -3.4);
  assert.equal(m.reconcile.days[0].status, "corrected");
  assert.equal(j.view({}).chargeParts.other, -3.4);
  // a second apply changes nothing
  assert.deepEqual(j.applyMatch({}, at("2026-11-24T10:00:00")).corrected, []);
  // undo
  assert.match(j.removeMatch("2026-11-30").error, /no correction/);
  assert.equal(j.removeMatch("2026-11-12").reconcile.days[0].status, "off");
  assert.equal(j.trips({}).find((t) => t.key === before.key).net, before.net);
});

test("a corrected day whose trades changed since is corrected again to the ledger", () => {
  const j = j0();
  j.add([fl("2026-11-12T09:20:00", "BUY", 100, 1000), fl("2026-11-12T10:20:00", "SELL", 100, 1010)], "kite");
  const t = j.trips({})[0];
  j.importLedger(Buffer.from(ledgerCsv([["2026-11-12", t.pnl - t.chargesEst + 2]])), { name: "l.csv" }, at("2026-11-24T10:00:00"));
  j.applyMatch({}, at("2026-11-24T10:00:00"));
  assert.equal(j.reconcile().days[0].status, "corrected");
  j.add([fl("2026-11-12T11:00:00", "BUY", 50, 1000, "SBIN"), fl("2026-11-12T11:30:00", "SELL", 50, 1000.1, "SBIN")], "kite"); // a late fill
  const s = j.reconcile().days[0];
  assert.notEqual(s.status, "corrected");
});

/* ------------------------------------------------------------------ Console's P&L statement */
const { makeXlsx } = require("./helpers/xlsx-maker");
const { fromPnlSheets, headOf } = require("../trading/otherbook");

const stmt = ({ realised, charges, other, heads, symbols, from = "2026-11-12", to = "2026-11-16" }) => [
  [], [], [], [], [], [],
  ["", "Client ID", "AB1234"],
  [], [], [],
  ["", `P&L Statement for Equity from ${from} to ${to}`],
  [],
  ["", "Summary"],
  [],
  ["", "Charges", charges],
  ["", "Other Credit & Debit", other],
  ["", "Realized P&L", realised],
  ["", "Unrealized P&L", "0.0000"],
  [], [],
  ["", "Charges"],
  [],
  ["", "Account Head", "Amount"],
  ...heads.map(([n, v]) => ["", n, v]),
  [], [], [], [],
  ["", "Symbol", "ISIN", "Quantity", "Buy Value", "Sell Value", "Realized P&L", "Realized P&L Pct."],
  ...symbols.map(([s, p]) => ["", s, "INE000", "100", "1", "1", p, "0.1"]),
];

test("Console's P&L statement: period, summary, every charge head mapped to ours, each symbol", () => {
  const rows = stmt({ realised: "1000.0000", charges: "100.5000", other: "-59.0000", heads: [["Brokerage - Z", "40.0000"], ["Exchange Transaction Charges - Z", "10.0000"], ["Clearing Charges - Z", "0.0000"], ["Integrated GST - Z", "10.0000"], ["Securities Transaction Tax - Z", "30.0000"], ["SEBI Turnover Fees - Z", "0.5000"], ["Stamp Duty - Z", "9.9900"], ["IPFT", "0.0100"]], symbols: [["INFY", "600.5"], ["SBIN", "399.5"]] });
  const r = fromPnlSheets([{ name: "Equity", rows }]);
  assert.equal(r.error, "");
  assert.deepEqual([r.from, r.to], ["2026-11-12", "2026-11-16"]);
  assert.deepEqual(r.summary, { charges: 100.5, other: -59, realised: 1000, unrealised: 0 });
  assert.deepEqual(r.heads, { brokerage: 40, exchange: 10, gst: 10, stt: 30, sebi: 0.5, stamp: 9.99, other: 0.01 });
  assert.deepEqual(r.symbols.map((x) => [x.symbol, x.pnl]), [["INFY", 600.5], ["SBIN", 399.5]]);
  assert.equal(headOf("Central GST - Z"), "gst");
  assert.match(fromPnlSheets([{ name: "x", rows: [["a", "b"]] }]).error, /P&L statement/);
});

test("a statement against the journal: the differences by head; one press makes the charges Console's, head by head, on every trade; undo puts the estimate back", () => {
  const j = j0();
  j.add([
    fl("2026-11-12T09:20:00", "BUY", 100, 1000), fl("2026-11-12T10:20:00", "SELL", 100, 1010),
    fl("2026-11-13T09:20:00", "BUY", 200, 500, "SBIN"), fl("2026-11-13T10:20:00", "SELL", 200, 503, "SBIN"),
  ], "kite");
  const trips = j.trips({});
  const estH = (h) => Math.round(trips.reduce((a, t) => a + (t.partsEst[h] || 0), 0) * 10000) / 10000;
  const realised = trips.reduce((a, t) => a + t.pnl, 0);
  const heads = { brokerage: estH("brokerage"), stt: estH("stt") - 0.5, exchange: estH("exchange") + 2.5, gst: estH("gst") + 0.45, sebi: estH("sebi"), stamp: estH("stamp") + 0.6 };
  const total = Object.values(heads).reduce((a, v) => a + v, 0);
  const buf = makeXlsx(stmt({ realised: realised.toFixed(4), charges: total.toFixed(4), other: "0.0000", symbols: [["INFY", String(trips[0].pnl)], ["SBIN", String(trips[1].pnl + 5)]], heads: [["Brokerage - Z", heads.brokerage], ["Securities Transaction Tax - Z", heads.stt], ["Exchange Transaction Charges - Z", heads.exchange], ["Integrated GST - Z", heads.gst], ["SEBI Turnover Fees - Z", heads.sebi], ["Stamp Duty - Z", heads.stamp]] }));
  const r = j.importPnl(buf, { name: "pnl.xlsx" }, at("2026-11-24T10:00:00"));
  assert.equal(r.error, undefined);
  assert.equal(r.key, "2026-11-12_2026-11-16");
  const before = j.pnlCompare()[0];
  assert.equal(before.ok, false);
  assert.equal(before.rows[0].ok, true); // realised P&L matches
  assert.equal(before.rows[1].ok, false); // the charges do not
  assert.equal(before.rows[1].diff, Math.round(-(2.5 - 0.5 + 0.45 + 0.6) * 100) / 100);
  assert.deepEqual(before.symbols.map((x) => [x.symbol, x.ok]), [["INFY", true], ["SBIN", false]]); // a symbol's own difference is shown, not "corrected"

  const done = j.applyPnlMatch(r.key, at("2026-11-24T10:00:00"));
  assert.equal(done.error, undefined);
  const after = j.pnlCompare()[0];
  assert.ok(after.heads.every((h) => h.ok), JSON.stringify(after.heads));
  assert.equal(after.rows[1].ok, true);
  assert.equal(after.corrected, 2);
  const now = j.trips({});
  for (const t of now) assert.ok(Math.abs(t.parts.brokerage + t.parts.stt + t.parts.exchange + t.parts.gst + t.parts.sebi + t.parts.stamp + t.parts.dp + (t.parts.other || 0) - t.charges) < 0.011); // every trade's heads add up to its charges
  assert.equal(Math.round(now.reduce((a, t) => a + t.charges, 0) * 100) / 100, Math.round(total * 100) / 100);
  // undo
  assert.match(j.removePnlMatch("nope").error, /no correction/);
  j.removePnlMatch(r.key);
  assert.equal(j.pnlCompare()[0].rows[1].ok, false);
  assert.equal(Math.round(j.trips({}).reduce((a, t) => a + t.charges, 0) * 100) / 100, Math.round(trips.reduce((a, t) => a + t.chargesEst, 0) * 100) / 100);
});

test("the statement's sheet of other debits and credits is read into the entries, and the same line from the ledger is not counted twice", () => {
  const j = j0();
  const now = at("2026-11-24T10:00:00");
  const L = ["particulars,posting_date,cost_center,voucher_type,debit,credit,net_balance", "Call and Trade charges(Auto Square Off) for 2026-11-14,2026-11-14,NSE-EQ,Journal Entry,59,0,0"].join("\n");
  j.importLedger(Buffer.from(L), { name: "l.csv" }, now);
  assert.equal(j.others().count, 1);
  const o = fromPnlSheets([{ name: "Other Debits and Credits", rows: [[], ["", "Particulars", "Posting Date", "Debit", "Credit"], ["", "Call and Trade charges(Auto Square Off) for 2026-11-14", "2026-11-14", "59.0000", "0.0000"]] }, { name: "Equity", rows: stmt({ realised: "1", charges: "0", other: "-59", heads: [], symbols: [["A", "1"]] }) }]);
  assert.equal(o.others.entries.length, 1);
  assert.equal(o.others.entries[0].amount, -59);
  assert.equal(o.others.entries[0].key, "2026-11-14|Call and Trade charges(Auto Square Off) for 2026-11-14|-59");
});
