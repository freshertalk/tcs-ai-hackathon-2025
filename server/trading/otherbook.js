"use strict";
// Other credits & debits (24 Nov 2026) — the money in Zerodha Console's P&L report that is neither a trade nor a trading
// charge: DP charges billed separately, the annual maintenance charge, interest, dividends, call-and-trade fees, penalties.
// Zerodha's API gives no ledger, so they come two ways, both dated and kept one by one:
//   · hand-entered (a credit is positive, a debit negative), and
//   · read from the Console LEDGER file (Console → Funds → Statement / Ledger, .csv or .xlsx), which is Zerodha's own
//     record, so a figure here is the figure there. Trade settlements, fund transfers and opening / closing balances are
//     not "other" and are left out; every kind of row left out is counted and named.
// Pure functions: no clock, no network, no orders.

const KINDS = {
  dp: "DP charges",
  amc: "Annual maintenance (AMC)",
  interest: "Interest",
  dividend: "Dividend",
  call: "Call & trade",
  charges: "Other charges",
  other: "Other",
};

const norm = (h) => String(h || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const money = (v) => {
  const t = String(v === undefined || v === null ? "" : v).replace(/[,₹\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!t || t === "-") return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
const r2 = (x) => Math.round(x * 100) / 100;

/** The kind of a ledger line, or null when it is not an "other" entry (with a name for what it is, for the count of what was left out). */
function classify(particulars, voucher) {
  const p = String(particulars || "");
  const v = String(voucher || "");
  // not "other": trades settling, money moving in or out of the account, balances carried
  const left =
    (/opening balance|closing balance|balance b\/?f|balance c\/?f/i.test(p) && "balances") ||
    (/net (settlement|obligation|amount payable)|settlement|obligation|margin|mtm|pay-?in|pay-?out|payout/i.test(p) && "trade settlements") ||
    (/bank (receipt|payment)|funds? (added|withdraw|transfer)|upi|razorpay|payment gateway|neft|imps|rtgs|withdrawal|fund transfer/i.test(p) && "fund transfers") ||
    (/bank|receipt|payment/i.test(v) && "fund transfers") ||
    (/^book voucher$/i.test(v.trim()) && "trade settlements");
  if (left) return { kind: null, left };
  if (/\bdp\b.*charge|depository|dp charges/i.test(p)) return { kind: "dp" };
  if (/\bamc\b|annual maintenance/i.test(p)) return { kind: "amc" };
  if (/dividend/i.test(p)) return { kind: "dividend" };
  if (/interest|delayed payment|\bdpc\b/i.test(p)) return { kind: "interest" };
  if (/call\s*&?\s*(and\s*)?trade/i.test(p)) return { kind: "call" };
  if (/charge|fee|penalt|fine|\bgst\b|stamp|sms|rejection|square[- ]?off|auto/i.test(p)) return { kind: "charges" };
  if (/journal|debit note|credit note|adjust/i.test(v) || /journal|adjust/i.test(p)) return { kind: "other" };
  return { kind: null, left: "other lines" };
}

const dayOf = (cell) => {
  const t = String(cell === undefined || cell === null ? "" : cell).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  if (/^\d{4,6}(\.\d+)?$/.test(t) && Number(t) > 20000 && Number(t) < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(Number(t) * 86400) * 1000).toISOString().slice(0, 10); // an Excel date number
  return "";
};

/**
 * Console ledger rows → "other" entries. The header (particulars, posting date, voucher type, debit, credit) is found among the
 * first 40 rows. @returns { entries: [{ date, amount, kind, note, key }], left: { "trade settlements": n, … }, rows, error }
 */
function fromLedgerRows(rows) {
  const hi = rows.slice(0, 40).findIndex((r) => {
    const h = r.map(norm);
    return h.includes("particulars") && h.includes("debit") && h.includes("credit");
  });
  if (hi < 0) return { entries: [], left: {}, rows: 0, error: "This does not look like a Zerodha Console ledger: it needs particulars, posting date, debit and credit columns (Console → Funds → Statement)." };
  const head = rows[hi].map(norm);
  const col = (...names) => names.map((n) => head.indexOf(n)).find((i) => i >= 0);
  const c = { p: col("particulars"), date: col("posting_date", "date", "voucher_date"), voucher: col("voucher_type", "type"), debit: col("debit"), credit: col("credit") };
  if (c.date === undefined) return { entries: [], left: {}, rows: 0, error: "The ledger has no posting date column." };
  const entries = [];
  const left = {};
  let bad = 0;
  let n = 0;
  for (const r of rows.slice(hi + 1)) {
    if (!r || !r.some((x) => String(x || "").trim())) continue;
    n += 1;
    const get = (i) => (i === undefined || r[i] === undefined || r[i] === null ? "" : r[i]);
    const date = dayOf(get(c.date));
    if (!date && /^\s*(opening|closing) balance/i.test(String(get(c.p)))) {
      left.balances = (left.balances || 0) + 1; // carried balances have no posting date: not a bad line
      continue;
    }
    const debit = money(get(c.debit));
    const credit = money(get(c.credit));
    if (!date || Number.isNaN(debit) || Number.isNaN(credit)) {
      bad += 1;
      continue;
    }
    const cls = classify(get(c.p), get(c.voucher));
    if (!cls.kind) {
      left[cls.left] = (left[cls.left] || 0) + 1;
      continue;
    }
    const amount = r2(credit - debit);
    if (!amount) continue;
    const note = String(get(c.p)).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
    entries.push({ date, amount, kind: cls.kind, note, key: `${date}|${note.slice(0, 80)}|${amount}` });
  }
  if (bad) left["lines that could not be read"] = bad;
  return { entries, left, rows: n, error: "" };
}

/**
 * Two genuine entries can read alike (the same charge twice in a day): each gets its number among the alike, so a file read
 * again — or an overlapping one — matches entry for entry and nothing is counted twice or lost.
 */
function numbered(entries) {
  const seen = new Map();
  return entries.map((e) => {
    const n = (seen.get(e.key) || 0) + 1;
    seen.set(e.key, n);
    return { ...e, key: `${e.key}#${n}` };
  });
}

/**
 * The entries of a period, each with what counts. A DP charge on a day whose trades already carry an estimated DP charge is not
 * counted again (it is the same money): it stays listed, marked `covered`.
 * @param dpByDay Map<day, estimated DP charge in that day's charges>
 */
function counted(entries, { fromDay = "", toDay = "" } = {}, dpByDay = new Map()) {
  return (entries || [])
    .filter((e) => (!fromDay || e.date >= fromDay) && (!toDay || e.date <= toDay))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((e) => {
      const covered = e.kind === "dp" && e.amount < 0 && (dpByDay.get(e.date) || 0) > 0;
      return { ...e, covered, counts: covered ? 0 : e.amount };
    });
}

function totals(list) {
  let credits = 0;
  let debits = 0;
  let coveredN = 0;
  const byKind = {};
  for (const e of list) {
    if (e.covered) {
      coveredN += 1;
      continue;
    }
    if (e.counts > 0) credits += e.counts;
    else debits += e.counts;
    byKind[e.kind] = r2((byKind[e.kind] || 0) + e.counts);
  }
  return { total: r2(credits + debits), credits: r2(credits), debits: r2(debits), count: list.length, covered: coveredN, byKind };
}

module.exports = { KINDS, classify, fromLedgerRows, numbered, counted, totals, dayOf };
