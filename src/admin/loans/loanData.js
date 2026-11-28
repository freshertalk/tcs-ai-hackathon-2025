// The Loans page's arithmetic and tables, from what the server sends (server/loans.js — the outstanding is worked out there).
// Pure functions: the month's register, the tables a download carries, and what needs attention.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const r2 = (x) => Math.round(x * 100) / 100;
const num = (x) => typeof x === "number" && Number.isFinite(x);

export const monthName = (ym) => (ym ? `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}` : "—");
export const shortMonth = (ym) => (ym ? `${MONTHS[Number(ym.slice(5)) - 1].slice(0, 3)} ${ym.slice(0, 4)}` : "—");
/** "05 Nov 2026" from "2026-11-05". */
export const dayName = (d) => (d ? `${d.slice(8, 10)} ${MONTHS[Number(d.slice(5, 7)) - 1].slice(0, 3)} ${d.slice(0, 4)}` : "—");
export const shiftMonth = (ym, by) => {
  const n = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5)) - 1 + by;
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`;
};
export const daysFrom = (today, date) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
/** ₹ with Indian grouping and paise. */
export const rupees = (x, paise = true) => (num(x) ? `${x < 0 ? "−" : ""}₹${Math.abs(x).toLocaleString("en-IN", { minimumFractionDigits: paise ? 2 : 0, maximumFractionDigits: paise ? 2 : 0 })}` : "—");
export const rateText = (x) => (num(x) ? `${x.toLocaleString("en-IN", { maximumFractionDigits: 3 })}%` : "—");

/** Where an instalment stands, in words. */
export function stateText(row, today) {
  if (row.paid) return row.paidAt ? `Paid · ticked ${dayName(new Date(Date.parse(row.paidAt) + 5.5 * 3600000).toISOString().slice(0, 10))}` : "Paid";
  const d = daysFrom(today, row.date);
  if (d === 0) return "Due today";
  if (d < 0) return `Overdue by ${-d} day${d === -1 ? "" : "s"}`;
  return `Due in ${d} day${d === 1 ? "" : "s"}`;
}

/** Bank (EMI) loans and cash from people are kept apart: only the first have monthly rows. */
export const bankLoans = (data) => ((data && data.loans) || []).filter((l) => l.type !== "cash");
export const cashLoans = (data) => ((data && data.loans) || []).filter((l) => l.type === "cash");

/** The interest still to pay as it stood after a month: today's figure plus what has been ticked paid since that month. */
export function interestLeftAfter(loan, row) {
  const s = loan.summary;
  if (s.interestRemaining === null || s.interestRemaining === undefined) return null;
  return r2(s.interestRemaining + loan.rows.filter((x) => x.paid && x.month > row.month).reduce((a, x) => a + (x.interest || 0), 0));
}

/** One month across all loans: a row for every loan with an instalment that month, by EMI date, numbered. */
export function registerFor(data, month) {
  const rows = [];
  for (const loan of (data && data.loans) || []) {
    const row = loan.rows.find((x) => x.month === month);
    if (row) rows.push({ loan, row });
  }
  rows.sort((a, b) => (a.row.date < b.row.date ? -1 : a.row.date > b.row.date ? 1 : a.loan.name.localeCompare(b.loan.name)));
  const sum = (f) => r2(rows.reduce((a, x) => a + f(x), 0));
  return {
    rows: rows.map((x, i) => ({ sr: i + 1, ...x })),
    totals: { total: sum((x) => x.loan.totalAmount), emi: sum((x) => x.row.emi), principal: sum((x) => x.row.principal || 0), interest: sum((x) => x.row.interest || 0), outstanding: sum((x) => x.row.outstanding), interestLeft: sum((x) => interestLeftAfter(x.loan, x.row) || 0), paid: rows.filter((x) => x.row.paid).length, paidAmount: sum((x) => (x.row.paid ? x.row.emi : 0)), count: rows.length },
  };
}

/** The first month that has any row (never later than the running month). */
export function firstMonth(data) {
  const all = ((data && data.loans) || []).flatMap((l) => (l.rows.length ? [l.rows[0].month] : []));
  const now = data && data.today ? data.today.slice(0, 7) : "";
  return all.length ? [...all, now].sort()[0] : now;
}

/** What needs a look: overdue EMIs (oldest first), those due within a week, and an EMI that never clears its loan. */
export function attentionOf(data) {
  const out = [];
  if (!data) return out;
  for (const loan of bankLoans(data)) {
    if (loan.summary.closed) continue;
    for (const row of loan.rows) {
      if (row.state === "overdue") out.push({ id: `${loan.id}-${row.month}`, level: "danger", loan, row, text: `${loan.name}: the ${shortMonth(row.month)} EMI of ${rupees(row.emi)} was due on ${dayName(row.date)} and is not ticked paid.` });
      else if (!row.paid) {
        const d = daysFrom(data.today, row.date);
        if (d >= 0 && d <= 7) out.push({ id: `${loan.id}-${row.month}`, level: "warn", loan, row, text: `${loan.name}: ${rupees(row.emi)} is due ${d === 0 ? "today" : `in ${d} day${d === 1 ? "" : "s"}`} (${dayName(row.date)}).` });
      }
    }
    if (loan.summary.scheduleOld) out.push({ id: `${loan.id}-old`, level: "warn", loan, row: null, text: `${loan.name}: a part-payment or the bank’s own figure changed what is owed since the schedule was uploaded. Upload the lender’s revised schedule.` });
    if (!loan.summary.coversInterest) out.push({ id: `${loan.id}-interest`, level: "danger", loan, row: null, text: `${loan.name}: at ${rateText(loan.rate)} a month’s interest is about ${rupees(loan.summary.interestThisMonth)}, as much as the EMI or more — check the rate and the EMI.` });
  }
  return out.sort((a, b) => (a.level !== b.level ? (a.level === "danger" ? -1 : 1) : a.row && b.row ? (a.row.date < b.row.date ? -1 : 1) : 0));
}

/** What a new loan's terms would mean, shown under the form while it is filled in. */
export function previewOf(form, today) {
  const n = (x) => Number(String(x === undefined || x === null ? "" : x).replace(/[₹,%\s]/g, ""));
  const total = n(form.totalAmount);
  const start = String(form.startBalance || "").trim() === "" ? total : n(form.startBalance);
  const rate = n(form.rate);
  const emi = n(form.emiAmount);
  const first = String(form.firstEmiDate || "");
  const out = { rows: null, interest: null, principal: null, short: false };
  if (/^\d{4}-\d{2}-\d{2}$/.test(first) && today) {
    const k = (Number(today.slice(0, 4)) - Number(first.slice(0, 4))) * 12 + Number(today.slice(5, 7)) - Number(first.slice(5, 7)) + 1;
    out.rows = Math.max(0, Math.min(600, k));
  }
  if (start > 0 && String(form.rate).trim() !== "" && rate >= 0 && emi > 0) {
    out.interest = r2((start * rate) / 1200);
    out.principal = r2(emi - out.interest);
    out.short = out.principal <= 0;
  }
  return out;
}

/* ------------------------------------------------------------------ the tables a download carries */
const COL = {
  sr: { key: "sr", label: "Sr. No.", type: "int", w: 3.5 },
  loan: { key: "loan", label: "Loan", type: "text", w: 10 },
  month: { key: "month", label: "Month", type: "text", w: 6.5 },
  opening: { key: "opening", label: "Opening Date", type: "date", w: 6.5 },
  total: { key: "total", label: "Total Amount", type: "money", w: 8.5 },
  rate: { key: "rate", label: "Interest Rate (% a year)", type: "rate", w: 4.5 },
  emiDate: { key: "emiDate", label: "EMI Date", type: "date", w: 6.5 },
  emi: { key: "emi", label: "EMI Amount", type: "money", w: 7.5 },
  principal: { key: "principal", label: "Principal in EMI", type: "money", w: 7.5 },
  interest: { key: "interest", label: "Interest in EMI", type: "money", w: 7 },
  outstanding: { key: "outstanding", label: "Outstanding Loan Amount (principal)", type: "money", w: 8.5 },
  interestLeft: { key: "interestLeft", label: "Interest Remaining", type: "money", w: 8 },
  totalLeft: { key: "totalLeft", label: "Total Still To Pay", type: "money", w: 8.5, pdf: false },
  paid: { key: "paid", label: "Is Paid?", type: "text", w: 3.5 },
  paidOn: { key: "paidOn", label: "Ticked Paid On", type: "date", w: 6.5 },
  extra: { key: "extra", label: "Part-payment", type: "money", w: 6.5 },
  remarks: { key: "remarks", label: "Remarks", type: "text", w: 11 },
  updated: { key: "updated", label: "Last Updated (IST)", type: "text", w: 9, pdf: false },
};
const istStamp = (iso) => {
  if (!iso) return "";
  const d = new Date(Date.parse(iso) + 5.5 * 3600000).toISOString();
  return `${dayName(d.slice(0, 10))} ${d.slice(11, 16)}`;
};
const blank = (x) => (x === null || x === undefined ? "" : x);
const rowOf = (loan, row, sr) => {
  const left = interestLeftAfter(loan, row);
  return {
    sr,
    loan: loan.name,
    month: shortMonth(row.month),
    opening: loan.openingDate,
    total: loan.totalAmount,
    rate: row.rate,
    emiDate: row.date,
    emi: row.emi,
    principal: blank(row.principal),
    interest: blank(row.interest),
    outstanding: row.outstanding,
    interestLeft: blank(left),
    totalLeft: left === null ? "" : r2(row.outstanding + left),
    paid: row.paid ? "Yes" : "No",
    paidOn: row.paidAt ? new Date(Date.parse(row.paidAt) + 5.5 * 3600000).toISOString().slice(0, 10) : "",
    extra: row.extra || 0,
    remarks: row.remarks || "",
    updated: istStamp(row.updatedAt),
  };
};

const SUMMARY_COLUMNS = [
  COL.sr,
  COL.loan,
  COL.opening,
  COL.total,
  { key: "rate", label: "Interest Rate (% a year)", type: "rate", w: 4.5 },
  { key: "emi", label: "EMI a Month", type: "money", w: 7.5 },
  COL.outstanding,
  COL.interestLeft,
  { key: "totalLeft", label: "Total Still To Pay", type: "money", w: 8.5 },
  { key: "paidPrincipal", label: "Principal Paid", type: "money", w: 8, pdf: false },
  { key: "paidInterest", label: "Interest Paid", type: "money", w: 7.5, pdf: false },
  { key: "repaid", label: "Repaid (%)", type: "rate", w: 4.5 },
  { key: "overdue", label: "Overdue Amount", type: "money", w: 7 },
  { key: "next", label: "Next EMI Date", type: "date", w: 6.5 },
  COL.remarks,
];
export function summaryTable(data) {
  const rows = bankLoans(data).map((l, i) => ({ sr: i + 1, loan: l.name, opening: l.openingDate, total: l.totalAmount, rate: l.rate, emi: l.emiAmount, outstanding: l.summary.outstanding, interestLeft: blank(l.summary.interestRemaining), totalLeft: blank(l.summary.totalToPay), paidPrincipal: blank(l.summary.paidPrincipal), paidInterest: blank(l.summary.paidInterest), repaid: l.summary.repaidPct, overdue: l.summary.overdueAmount, next: l.summary.next ? l.summary.next.date : "", remarks: l.remarks }));
  const sum = (k) => r2(rows.reduce((a, x) => a + (Number(x[k]) || 0), 0));
  return { name: "Summary", title: "Loans with EMIs", columns: SUMMARY_COLUMNS, rows, totals: { loan: "Total", total: sum("total"), emi: data.totals.emiPerMonth, outstanding: sum("outstanding"), interestLeft: sum("interestLeft"), totalLeft: sum("totalLeft"), paidPrincipal: sum("paidPrincipal"), paidInterest: sum("paidInterest"), overdue: data.totals.overdueAmount } };
}

const CASH_COLUMNS = [
  COL.sr,
  { key: "loan", label: "From", type: "text", w: 12 },
  { key: "opening", label: "Date Taken", type: "date", w: 7 },
  { key: "total", label: "Amount", type: "money", w: 9 },
  { key: "back", label: "Paid Back", type: "money", w: 9 },
  { key: "outstanding", label: "Outstanding", type: "money", w: 9 },
  { key: "paid", label: "Is Paid?", type: "text", w: 4 },
  { key: "last", label: "Last Repayment", type: "date", w: 7 },
  { key: "remarks", label: "Remarks", type: "text", w: 20 },
];
export function cashTable(data) {
  const rows = cashLoans(data).map((l, i) => ({ sr: i + 1, loan: l.name, opening: l.openingDate, total: l.totalAmount, back: l.summary.paidAmount, outstanding: l.summary.outstanding, paid: l.summary.closed ? "Yes" : "No", last: l.summary.lastPaid || "", remarks: l.remarks }));
  const sum = (k) => r2(rows.reduce((a, x) => a + x[k], 0));
  return { name: "Cash from people", title: "Money from people (cash)", columns: CASH_COLUMNS, rows, totals: { loan: "Total", total: sum("total"), back: sum("back"), outstanding: sum("outstanding") } };
}
const REPAY_COLUMNS = [
  COL.sr,
  { key: "loan", label: "From", type: "text", w: 12 },
  { key: "date", label: "Paid On", type: "date", w: 7 },
  { key: "amount", label: "Amount", type: "money", w: 9 },
  { key: "outstanding", label: "Left After", type: "money", w: 9 },
  { key: "note", label: "Note", type: "text", w: 24 },
];
export function repaymentTable(loans) {
  let sr = 0;
  const rows = loans.flatMap((l) => l.payments.map((p) => ({ sr: (sr += 1), loan: l.name, date: p.date, amount: p.amount, outstanding: p.outstanding, note: p.note })));
  return { name: "Cash repayments", title: "Cash repayments", columns: REPAY_COLUMNS, rows, totals: { loan: "Total", amount: r2(rows.reduce((a, x) => a + x.amount, 0)) } };
}

const slug = (name) => name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "loan";
/**
 * The tables for one download.
 * @param scope "month" (the register of `month`, and the cash loans) | "loan" (one loan's every month, or one cash loan's
 *              repayments) | "all" (everything)
 * @returns { file (name without extension), title, tables: [{ name, title, columns, rows, totals }], detail }
 */
export function exportSet(data, scope, { month, loanId } = {}) {
  const loan = data.loans.find((l) => l.id === loanId);
  if (scope === "loan" && loan && loan.type === "cash") {
    const table = repaymentTable([loan]);
    return { file: `cash-${slug(loan.name)}-${data.today}`, title: `${loan.name}: repayments`, tables: [{ ...table, title: `${loan.name}: repayments` }], detail: table };
  }
  if (scope === "loan" && loan) {
    const made = loan.rows.map((row, i) => rowOf(loan, row, i + 1));
    // the months still to come, from the lender's schedule or projected, marked as such
    let leftAfter = loan.summary.interestRemaining;
    const coming = (loan.upcoming || []).map((x, i) => {
      if (leftAfter !== null && leftAfter !== undefined) leftAfter = Math.max(0, r2(leftAfter - (x.interest || 0)));
      return { sr: loan.rows.length + i + 1, loan: loan.name, month: shortMonth(x.month), opening: loan.openingDate, total: loan.totalAmount, rate: loan.rate, emiDate: x.date, emi: x.emi, principal: blank(x.principal), interest: blank(x.interest), outstanding: blank(x.closing), interestLeft: blank(leftAfter), totalLeft: "", paid: "To come", paidOn: "", extra: "", remarks: "", updated: "" };
    });
    const hidden = (c) => ({ ...c, pdf: false }); // the same on every line of one loan: left off the page, kept in the sheet
    const table = { name: "Schedule", title: `${loan.name}: every month`, columns: [COL.sr, COL.month, hidden(COL.opening), hidden(COL.total), COL.rate, COL.emiDate, COL.emi, COL.principal, COL.interest, COL.outstanding, COL.interestLeft, COL.totalLeft, COL.paid, COL.paidOn, COL.extra, COL.remarks, COL.updated], rows: [...made, ...coming], totals: { month: "Now owed", outstanding: loan.summary.outstanding, interestLeft: blank(loan.summary.interestRemaining), totalLeft: blank(loan.summary.totalToPay) } };
    return { file: `loan-${slug(loan.name)}-${data.today}`, title: table.title, tables: [table], detail: table };
  }
  const people = cashLoans(data);
  if (scope === "month") {
    const reg = registerFor(data, month);
    const rows = reg.rows.map((x) => rowOf(x.loan, x.row, x.sr));
    const table = { name: shortMonth(month), title: `Loan register: ${monthName(month)}`, columns: [COL.sr, COL.loan, COL.opening, COL.total, COL.rate, COL.emiDate, COL.emi, COL.principal, COL.interest, COL.outstanding, COL.interestLeft, COL.totalLeft, COL.paid, COL.remarks, COL.updated], rows, totals: { loan: "Total", total: reg.totals.total, emi: reg.totals.emi, principal: reg.totals.principal, interest: reg.totals.interest, outstanding: reg.totals.outstanding, interestLeft: reg.totals.interestLeft, totalLeft: r2(reg.totals.outstanding + reg.totals.interestLeft), paid: `${reg.totals.paid} of ${reg.totals.count}` } };
    return { file: `loan-register-${month}`, title: table.title, tables: people.length ? [table, cashTable(data)] : [table], detail: table };
  }
  let sr = 0;
  const every = bankLoans(data).flatMap((l) => l.rows.map((row) => ({ l, row })));
  every.sort((a, b) => (a.row.month !== b.row.month ? (a.row.month < b.row.month ? -1 : 1) : a.row.date < b.row.date ? -1 : a.row.date > b.row.date ? 1 : a.l.name.localeCompare(b.l.name)));
  const detail = { name: "All EMIs", title: "Every month of every loan", columns: [COL.sr, COL.month, COL.loan, { ...COL.opening, pdf: false }, { ...COL.total, pdf: false }, COL.rate, COL.emiDate, COL.emi, COL.principal, COL.interest, COL.outstanding, COL.interestLeft, COL.totalLeft, COL.paid, COL.paidOn, { ...COL.extra, pdf: false }, COL.remarks, COL.updated], rows: every.map((x) => rowOf(x.l, x.row, (sr += 1))), totals: null };
  return { file: `loans-all-${data.today}`, title: "Loan book", tables: [summaryTable(data), detail, ...(people.length ? [cashTable(data), repaymentTable(people)] : [])], detail };
}

/** The line every download carries: when it was made and when the book was last saved. */
export function stampLines(data) {
  const last = data.saved && data.saved.last;
  return [`Generated ${istStamp(new Date().toISOString())} IST`, last ? `Last saved ${istStamp(last.at)} IST by ${last.by} (${last.name}: ${last.what})` : "Nothing saved yet"];
}

/* ------------------------------------------------------------------ analysis (the desk's own sums, no AI) */
/** How many EMIs clear `balance` with interest charged monthly, and that interest; null when the EMI never does. */
export function payoff(balance, rate, emi) {
  if (!(balance > 0)) return { count: 0, interest: 0 };
  let left = balance;
  let interest = 0;
  for (let n = 1; n <= 1200; n += 1) {
    const i = (left * rate) / 1200;
    if (emi <= i) return null;
    interest += i;
    left = left + i - emi;
    if (left <= 0.005) return { count: n, interest: r2(interest) };
  }
  return null;
}
/** What prepaying does (the same sum as the server's): a sum now and/or extra monthly, keeping the EMI or the months. */
export function simulate(balance, rate, emi, { lump = 0, extra = 0, mode = "tenure" } = {}) {
  const bal = Math.max(0, r2(balance - lump));
  let pay = emi;
  if (mode === "emi" && lump > 0) {
    const base = payoff(balance, rate, emi);
    if (!base || !base.count) return null;
    const m = rate / 1200;
    pay = m > 0 ? r2((bal * m * Math.pow(1 + m, base.count)) / (Math.pow(1 + m, base.count) - 1)) : r2(bal / base.count);
  }
  if (!(bal > 0)) return { months: 0, interest: 0, emi: r2(pay) };
  const out = payoff(bal, rate, pay + extra);
  return out ? { months: out.count, interest: out.interest, emi: r2(pay) } : null;
}

/** Where prepaying saves the most: for each open loan, the interest ₹1,00,000 paid now would save (an estimate). */
export function prepayRank(data, lump = 100000) {
  return bankLoans(data)
    .filter((l) => !l.summary.closed && l.rate > 0)
    .map((l) => {
      const amount = Math.min(lump, l.summary.outstanding);
      const plain = simulate(l.summary.outstanding, l.rate, l.emiAmount);
      const with1 = simulate(l.summary.outstanding, l.rate, l.emiAmount, { lump: amount });
      if (!plain || !with1) return null;
      return { loan: l, amount, saved: r2(plain.interest - with1.interest), sooner: plain.months - with1.months, perRupee: (plain.interest - with1.interest) / amount };
    })
    .filter(Boolean)
    .sort((a, b) => b.perRupee - a.perRupee);
}

/** The April–March year of a month: "2026-27". */
export const financialYear = (ym) => {
  const y = Number(ym.slice(0, 4)) - (Number(ym.slice(5)) < 4 ? 1 : 0);
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
};
/** Principal and interest by financial year: all instalments (past and to come), and those ticked paid. */
export function byYear(loans) {
  const out = new Map();
  const at = (fy) => out.get(fy) || out.set(fy, { fy, principal: 0, interest: 0, paidPrincipal: 0, paidInterest: 0 }).get(fy);
  for (const l of loans) {
    if (l.type === "cash" || !l.summary.split) continue;
    for (const x of [...l.rows, ...(l.upcoming || [])]) {
      const y = at(financialYear(x.month));
      y.principal += (x.principal || 0) + (x.extra || 0);
      y.interest += x.interest || 0;
      if (x.paid) {
        y.paidPrincipal += (x.principal || 0) + (x.extra || 0);
        y.paidInterest += x.interest || 0;
      }
    }
  }
  return [...out.values()].sort((a, b) => (a.fy < b.fy ? -1 : 1)).map((y) => ({ fy: y.fy, principal: r2(y.principal), interest: r2(y.interest), paidPrincipal: r2(y.paidPrincipal), paidInterest: r2(y.paidInterest) }));
}
