"use strict";
// The loan ledger (28 Nov 2026): every loan, its monthly instalments, what is paid and what is still owed. A personal book
// of the owner's, like the expense ledger — superadmins only.
//
//   A LOAN        its name, the day it was opened, the amount borrowed, the yearly interest rate, the EMI and the day of
//                 the first one, remarks — and, for a loan already running, what was still owed when the book began.
//   A MONTH       one row per loan per month: the EMI's date and amount, the rate, "Is paid?", remarks. The rows are made
//                 BY ITSELF from the first EMI up to the running month (IST), each with the loan's latest rate, EMI and
//                 day, and kept in the database. No rows are made once nothing is owed.
//   OUTSTANDING   never typed, always worked out from the rows: ticking "Is paid?" takes that instalment off what is owed
//                 (unticking puts it back), split into PRINCIPAL and INTEREST. Three ways, chosen per loan:
//                   "schedule"   the lender's own repayment schedule, uploaded once: each month's principal and interest
//                                are the lender's (or worked out from its balance when it does not split them)
//                   "principal"  the EMI less a month's interest comes off (a bank's reducing balance, worked out here; the
//                                default without a schedule — an estimate, as banks count by the day)
//                   "emi"        the whole EMI comes off, with no split
//                 A part-payment comes off as well, and the bank's own figure, typed on a month, replaces the sum there.
//   CASH          money from a person: who, when, how much, remarks — nothing else. What is paid back is entered by hand;
//                 no monthly rows, no EMI, no rate.
//   DOCUMENTS     what was uploaded for a loan is listed on it; the files themselves are kept apart (loan-intake.js).
//   HISTORY       who changed what and when is kept with the loan; the page shows the last save.
//
// Nothing here moves money, talks to a bank, or is read by the trading desk or an AI model.

const crypto = require("crypto");

const NAME = "loans";
const INSIGHT = "loans/insight.json"; // the AI's last analysis and the questions asked of it
const IST = 5.5 * 3600 * 1000;
const MAX_LOANS = 100;
const MAX_MONTHS = 600; // fifty years
const MAX_AMOUNT = 1e10;
const KEEP_HISTORY = 200;
const AUTO = "the desk (automatic)";
const KINDS = [
  { id: "home", label: "Home loan" },
  { id: "car", label: "Car / vehicle loan" },
  { id: "personal", label: "Personal loan" },
  { id: "education", label: "Education loan" },
  { id: "gold", label: "Gold loan" },
  { id: "business", label: "Business loan" },
  { id: "card", label: "Credit card EMI" },
  { id: "family", label: "From family or friends" },
  { id: "other", label: "Other" },
];
const METHODS = [
  { id: "principal", label: "Principal and interest, worked out from the rate (EMI less a month’s interest comes off)" },
  { id: "schedule", label: "The lender’s repayment schedule (its principal and interest)" },
  { id: "emi", label: "The whole EMI comes off the outstanding (no split)" },
];
const MAX_PAYMENTS = 1000;

class LoanError extends Error {
  constructor(message, code = "invalid", status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const r2 = (x) => Math.round(x * 100) / 100;
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const realDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ""))) return false;
  const t = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s;
};
const text = (v, max) =>
  String(v === undefined || v === null ? "" : v)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthWord = (ym) => `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;
const nextMonth = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};
const monthsBetween = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
/** The EMI's date in a month: the chosen day, or the month's last when it is shorter (31 → 28 Feb). */
const dateIn = (ym, day) => {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(Math.min(day, last)).padStart(2, "0")}`;
};
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

function money(v, what, { min = 0, max = MAX_AMOUNT, optional = false } = {}) {
  const raw = typeof v === "string" ? v.replace(/[₹,\s]/g, "") : v;
  if (raw === "" || raw === null || raw === undefined) {
    if (optional) return null;
    throw new LoanError(`Enter ${what}.`);
  }
  const n = r2(Number(raw));
  if (!Number.isFinite(n) || n < min) throw new LoanError(`Enter ${what}${min > 0 ? ", above zero" : ""}.`);
  if (n > max) throw new LoanError(`That figure for ${what} is too large to be right.`);
  return n;
}
function rateOf(v) {
  const raw = typeof v === "string" ? v.replace(/[%\s]/g, "") : v;
  const n = Number(raw);
  if (raw === "" || raw === null || raw === undefined || !Number.isFinite(n) || n < 0 || n > 100) throw new LoanError("Enter the yearly interest rate, from 0 to 100.");
  return Math.round(n * 1000) / 1000;
}

/** What was typed, as a loan's terms — or a LoanError saying, in words, what is wrong. */
function cleanLoan(input, now = Date.now()) {
  const b = input && typeof input === "object" ? input : {};
  const today = istDate(now);
  const name = text(b.name, 80);
  if (!name) throw new LoanError("Give the loan a name (the lender, or what it is for).");
  const openingDate = String(b.openingDate || "");
  if (!realDate(openingDate)) throw new LoanError("Choose the day the loan was opened.");
  if (openingDate < "1970-01-01" || openingDate > istDate(now + 366 * 86400000)) throw new LoanError("Check the opening date.");
  const totalAmount = money(b.totalAmount, "the total loan amount", { min: 1 });
  const rate = rateOf(b.rate);
  const emiAmount = money(b.emiAmount, "the EMI amount", { min: 1, max: totalAmount * 2 });
  const firstEmiDate = String(b.firstEmiDate || "");
  if (!realDate(firstEmiDate)) throw new LoanError("Choose the date of the first EMI to keep in this book.");
  if (firstEmiDate < openingDate) throw new LoanError("The first EMI cannot be before the day the loan was opened.");
  if (monthsBetween(firstEmiDate.slice(0, 7), today.slice(0, 7)) >= MAX_MONTHS) throw new LoanError("That first EMI is too far back.");
  if (monthsBetween(today.slice(0, 7), firstEmiDate.slice(0, 7)) > 24) throw new LoanError("The first EMI is more than two years ahead.");
  // the day of the month the EMI falls on; it may differ from the first EMI's (a 31st kept through short months)
  const emiDay = b.emiDay === undefined || b.emiDay === "" || b.emiDay === null ? Number(firstEmiDate.slice(8)) : Number(b.emiDay);
  if (!Number.isInteger(emiDay) || emiDay < 1 || emiDay > 31) throw new LoanError("The EMI day of the month is from 1 to 31.");
  const startBalance = money(b.startBalance, "the outstanding when this book begins", { max: totalAmount * 1.5, optional: true });
  const kind = KINDS.some((k) => k.id === b.kind) ? b.kind : "other";
  const method = b.method === undefined || b.method === "" ? "principal" : String(b.method);
  if (!METHODS.some((m) => m.id === method)) throw new LoanError("Choose how a paid EMI reduces the outstanding.");
  return { name, kind, openingDate, totalAmount, rate, emiAmount, firstEmiDate, emiDay, startBalance: startBalance === null ? totalAmount : startBalance, method, remarks: text(b.remarks, 500) };
}

/** Money from a person: only who, when, how much and a word about it. */
function cleanCash(input, now = Date.now()) {
  const b = input && typeof input === "object" ? input : {};
  const name = text(b.name, 80);
  if (!name) throw new LoanError("Write who the money is from.");
  const openingDate = String(b.openingDate || "");
  if (!realDate(openingDate)) throw new LoanError("Choose the day you took it.");
  if (openingDate < "1970-01-01" || openingDate > istDate(now + 86400000)) throw new LoanError("Check the date you took it.");
  const totalAmount = money(b.totalAmount, "the amount", { min: 1 });
  return { name, openingDate, totalAmount, remarks: text(b.remarks, 500) };
}
function cleanPayment(input, loan, now = Date.now()) {
  const b = input && typeof input === "object" ? input : {};
  const date = String(b.date || "");
  if (!realDate(date)) throw new LoanError("Choose the day you paid.");
  if (date < loan.openingDate) throw new LoanError("A repayment cannot be before the day you took the money.");
  if (date > istDate(now + 86400000)) throw new LoanError("A repayment cannot be in the future.");
  const amount = money(b.amount, "the amount paid", { min: 0.01 });
  return { date, amount, note: text(b.note, 200) };
}
const isCash = (loan) => loan.type === "cash";
const paidBackOf = (loan) => r2((loan.payments || []).reduce((a, x) => a + x.amount, 0));

/** A lender's schedule as one entry a month (two instalments in a month are added together). */
function planByMonth(rows) {
  const out = new Map();
  for (const x of rows) {
    const month = x.date.slice(0, 7);
    const had = out.get(month);
    if (!had) out.set(month, { ...x, month });
    else {
      const sum = (k) => (had[k] === null || x[k] === null ? null : r2(had[k] + x[k]));
      out.set(month, { ...had, date: x.date, emi: r2(had.emi + x.emi), principal: sum("principal"), interest: sum("interest"), closing: x.closing });
    }
  }
  return [...out.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
}
/** The instalment that repeats most often: the loan's EMI. */
function usualEmi(rows) {
  const n = new Map();
  for (const x of rows) n.set(x.emi, (n.get(x.emi) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
/** A checked lender's schedule, ready to keep with a loan. */
function cleanPlan(input) {
  const rows = ((input && input.rows) || []).filter((x) => x && realDate(x.date) && x.emi > 0);
  if (rows.length < 2) throw new LoanError("That schedule has fewer than two instalments.");
  if (rows.length > MAX_MONTHS) throw new LoanError(`A schedule holds at most ${MAX_MONTHS} instalments.`);
  if (rows.some((x) => typeof x.principal !== "number" || typeof x.interest !== "number" || x.principal < 0 || x.interest < 0)) throw new LoanError("The schedule’s principal and interest are not worked out yet: give the loan amount or the rate first.");
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : 1)).map((x, i) => ({ no: Number(x.no) || i + 1, date: x.date, emi: r2(x.emi), principal: r2(x.principal), interest: r2(x.interest), closing: x.closing === null || x.closing === undefined ? null : r2(x.closing), rate: x.rate || null }));
  const first = planByMonth(sorted)[0];
  const amount = Number(input.amount) > 0 ? r2(Number(input.amount)) : r2((first.closing || 0) + first.principal);
  const rate = input.rate !== null && input.rate !== undefined && Number(input.rate) >= 0 && Number(input.rate) <= 100 ? Number(input.rate) : null;
  return { rows: sorted, how: ["lender", "balance", "computed", "ai-columns"].includes(input.how) ? input.how : "lender", amount, rate, docId: input.docId || null, uploadedAt: input.uploadedAt || null };
}

/** One month's EMI split into principal and interest, by the loan's way, on the balance before it. */
function splitOf(loan, row, before) {
  if (loan.method === "emi") return { principal: null, interest: null };
  if (loan.method === "schedule" && typeof row.principal === "number") return { principal: r2(Math.min(before, row.principal)), interest: r2(row.interest || 0) };
  const interest = r2((before * row.rate) / 1200);
  return { principal: r2(Math.min(before, Math.max(0, row.emi - interest))), interest: r2(Math.min(row.emi, interest)) };
}

/**
 * The rows with what is owed worked out down the months.
 * @returns the rows, each with { principal, interest (this EMI's split; null with no split), before, reduced, outstanding }
 */
function schedule(loan) {
  let balance = loan.startBalance;
  return [...(loan.months || [])]
    .sort((a, b) => (a.month < b.month ? -1 : 1))
    .map((row) => {
      const before = balance;
      const split = splitOf(loan, row, before);
      if (row.paid) balance = r2(balance - Math.min(balance, loan.method === "emi" ? row.emi : split.principal));
      if (row.extra > 0) balance = r2(balance - Math.min(balance, row.extra));
      if (row.bankBalance !== null && row.bankBalance !== undefined) balance = row.bankBalance;
      return { ...row, ...split, before, reduced: r2(before - balance), outstanding: balance };
    });
}

/** The months still to come: from the lender's schedule, or projected month by month from what is owed now. */
function upcomingOf(loan, rows, outstanding) {
  if (!(outstanding > 0)) return [];
  const last = rows.length ? rows[rows.length - 1].month : null;
  if (loan.method === "schedule" && loan.plan) return planByMonth(loan.plan.rows).filter((x) => (last ? x.month > last : true)).map((x) => ({ month: x.month, date: x.date, emi: x.emi, principal: x.principal, interest: x.interest, closing: x.closing }));
  const out = [];
  let ym = last ? nextMonth(last) : loan.firstEmiDate.slice(0, 7);
  let bal = outstanding;
  for (let i = 0; i < MAX_MONTHS && bal > 0.005; i += 1, ym = nextMonth(ym)) {
    const split = loan.method !== "emi";
    const interest = split ? r2((bal * loan.rate) / 1200) : 0;
    if (split && loan.emiAmount <= interest) break;
    const principal = r2(Math.min(bal, loan.emiAmount - interest));
    bal = r2(bal - principal);
    out.push({ month: ym, date: ym === loan.firstEmiDate.slice(0, 7) ? loan.firstEmiDate : dateIn(ym, loan.emiDay), emi: r2(principal + interest), principal: split ? principal : null, interest: split ? interest : null, closing: bal });
  }
  return out;
}

/**
 * How many EMIs would clear `balance` if interest is charged month by month (the bank's way): an estimate.
 * @returns { count, interest } or null when the EMI does not even cover the interest
 */
function payoff(balance, rate, emi) {
  if (!(balance > 0)) return { count: 0, interest: 0 };
  let left = balance;
  let interest = 0;
  for (let n = 1; n <= MAX_MONTHS * 2; n += 1) {
    const i = (left * rate) / 1200;
    if (emi <= i) return null;
    interest += i;
    left = left + i - emi;
    if (left <= 0.005) return { count: n, interest: r2(interest) };
  }
  return null;
}

/** A cash loan as the page shows it. */
function cashViewOf(loan) {
  const { months, history, payments, ...terms } = loan;
  void months;
  const paid = paidBackOf(loan);
  const outstanding = Math.max(0, r2(loan.totalAmount - paid));
  const sorted = [...(payments || [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.at).localeCompare(String(b.at))));
  let bal = loan.totalAmount;
  return {
    ...terms,
    type: "cash",
    documents: loan.documents || [],
    rows: [],
    upcoming: [],
    payments: sorted.map((x) => {
      bal = Math.max(0, r2(bal - x.amount));
      return { ...x, outstanding: bal };
    }),
    history: history || [],
    summary: {
      outstanding,
      closed: outstanding <= 0,
      repaidPct: loan.totalAmount > 0 ? Math.max(0, Math.min(100, r2(((loan.totalAmount - outstanding) / loan.totalAmount) * 100))) : 0,
      paidAmount: paid,
      lastPaid: sorted.length ? sorted[sorted.length - 1].date : null,
    },
  };
}

/** One loan as the page shows it: its rows and the figures worked out from them. */
function viewOf(loan, now) {
  if (isCash(loan)) return cashViewOf(loan);
  const today = istDate(now);
  const rows = schedule(loan).map((row) => ({ ...row, state: row.paid ? "paid" : row.date < today ? "overdue" : row.date === today ? "due-today" : "due" }));
  const outstanding = rows.length ? rows[rows.length - 1].outstanding : loan.startBalance;
  const closed = outstanding <= 0;
  const overdue = closed ? [] : rows.filter((x) => x.state === "overdue");
  const upcoming = upcomingOf(loan, rows, outstanding);
  const unpaid = closed ? [] : rows.filter((x) => !x.paid);
  // the next instalment to pay: the oldest unpaid row, else the one after the last row made so far
  let next = unpaid[0] || null;
  if (!closed && !next && upcoming[0]) next = { ...upcoming[0], coming: true };
  const paidRows = rows.filter((x) => x.paid);
  const split = loan.method !== "emi";
  const atRate = payoff(outstanding, loan.rate, loan.emiAmount);
  const sum = (list, f) => r2(list.reduce((a, x) => a + (f(x) || 0), 0));
  // the interest still to be paid: the schedule's own for the months not ticked and to come, else the reducing balance's
  const interestRemaining = !split ? null : closed ? 0 : loan.method === "schedule" ? r2(sum(unpaid, (x) => x.interest) + sum(upcoming, (x) => x.interest)) : atRate ? atRate.interest : null;
  let left = 0;
  let endMonth = null;
  if (!closed && loan.method === "schedule") {
    left = unpaid.length + upcoming.length;
    const lastOne = upcoming.length ? upcoming[upcoming.length - 1] : unpaid[unpaid.length - 1];
    endMonth = lastOne ? lastOne.month : null;
  } else if (!closed) {
    left = loan.method === "principal" ? (atRate ? atRate.count : null) : Math.ceil(outstanding / loan.emiAmount);
    if (left && next) {
      endMonth = next.month;
      for (let i = 1; i < Math.min(left, MAX_MONTHS * 2); i += 1) endMonth = nextMonth(endMonth);
    }
  }
  const { months, history, plan, ...terms } = loan;
  void months;
  const thisMonth = rows.find((x) => x.month === today.slice(0, 7));
  return {
    ...terms,
    type: "bank",
    documents: loan.documents || [],
    plan: plan ? { how: plan.how, instalments: plan.rows.length, first: plan.rows[0].date, last: plan.rows[plan.rows.length - 1].date, uploadedAt: plan.uploadedAt, docId: plan.docId, totalInterest: r2(plan.rows.reduce((a, x) => a + x.interest, 0)) } : null,
    rows,
    upcoming,
    history: history || [],
    summary: {
      outstanding,
      closed,
      split,
      interestRemaining,
      totalToPay: interestRemaining === null ? null : r2(outstanding + interestRemaining),
      paidPrincipal: split ? sum(paidRows, (x) => x.reduced - (x.extra || 0)) : null,
      paidInterest: split ? sum(paidRows, (x) => x.interest) : null,
      // of what was borrowed, how much is no longer owed
      repaidPct: loan.totalAmount > 0 ? Math.max(0, Math.min(100, r2(((loan.totalAmount - outstanding) / loan.totalAmount) * 100))) : 0,
      paidCount: paidRows.length,
      paidAmount: sum(paidRows, (x) => x.emi),
      extraPaid: sum(rows, (x) => x.extra),
      overdueCount: overdue.length,
      overdueAmount: sum(overdue, (x) => x.emi),
      next: next ? { month: next.month, date: next.date, amount: next.emi, principal: next.principal, interest: next.interest, inDays: daysBetween(today, next.date), coming: Boolean(next.coming) } : null,
      interestThisMonth: closed ? 0 : thisMonth && typeof thisMonth.interest === "number" ? thisMonth.interest : r2((outstanding * loan.rate) / 1200),
      emisLeft: left,
      endMonth,
      // the same outstanding with interest charged monthly: how long the bank would take, and what it would charge
      atRate: closed ? null : atRate,
      coversInterest: closed || loan.method === "schedule" || Boolean(atRate),
      // a part-payment or a typed bank figure makes the lender's old schedule out of date
      scheduleOld: loan.method === "schedule" && rows.some((x) => x.extra > 0 || (x.bankBalance !== null && x.bankBalance !== undefined)),
    },
  };
}

/**
 * What prepaying does, on a reducing balance: a sum now and/or extra every month, keeping the EMI (the loan ends sooner) or
 * keeping the months (the EMI falls). An estimate, before any charge the lender makes.
 * @returns { months, interest, emi } or null when the EMI never clears the loan
 */
function simulate(balance, rate, emi, { lump = 0, extra = 0, mode = "tenure" } = {}) {
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

/** All the loans together, and the running month. */
function totalsOf(views, now) {
  const today = istDate(now);
  const ym = today.slice(0, 7);
  const bank = views.filter((v) => v.type !== "cash");
  const cash = views.filter((v) => v.type === "cash");
  const open = bank.filter((v) => !v.summary.closed);
  const sum = (list, f) => r2(list.reduce((a, x) => a + (f(x) || 0), 0));
  const monthRows = bank.flatMap((v) => v.rows.filter((x) => x.month === ym));
  const owed = sum(views, (v) => v.summary.outstanding);
  const bankOwed = sum(bank, (v) => v.summary.outstanding);
  const cashOwed = sum(cash, (v) => v.summary.outstanding);
  const next = open
    .filter((v) => v.summary.next)
    .map((v) => ({ loanId: v.id, name: v.name, ...v.summary.next }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const ends = open.map((v) => v.summary.endMonth);
  const borrowed = sum(views, (v) => v.totalAmount);
  const interestKnown = open.filter((v) => v.summary.interestRemaining !== null);
  const interestRemaining = sum(interestKnown, (v) => v.summary.interestRemaining);
  return {
    loans: views.length,
    active: views.filter((v) => !v.summary.closed).length,
    closed: views.filter((v) => v.summary.closed).length,
    borrowed,
    activeBorrowed: sum(views.filter((v) => !v.summary.closed), (v) => v.totalAmount),
    // what is owed of the money borrowed: the principal (cash loans are all principal)
    outstanding: owed,
    bankOutstanding: bankOwed,
    cashOutstanding: cashOwed,
    interestRemaining,
    // open EMI loans whose interest is not split or never clears: left out of the interest figure, and said so
    interestUnknown: open.length - interestKnown.length,
    totalToPay: r2(owed + interestRemaining),
    paidPrincipal: sum(bank, (v) => v.summary.paidPrincipal),
    paidInterest: sum(bank, (v) => v.summary.paidInterest),
    repaidPct: borrowed > 0 ? Math.max(0, Math.min(100, r2(((borrowed - owed) / borrowed) * 100))) : 0,
    emiPerMonth: sum(open, (v) => v.emiAmount),
    // the yearly rate across what is still owed to lenders
    avgRate: bankOwed > 0 ? r2(open.reduce((a, v) => a + v.rate * v.summary.outstanding, 0) / bankOwed) : null,
    interestThisMonth: sum(open, (v) => v.summary.interestThisMonth),
    month: {
      month: ym,
      count: monthRows.length,
      amount: sum(monthRows, (x) => x.emi),
      principal: sum(monthRows, (x) => x.principal),
      interest: sum(monthRows, (x) => x.interest),
      paidCount: monthRows.filter((x) => x.paid).length,
      paidAmount: sum(monthRows.filter((x) => x.paid), (x) => x.emi),
      leftAmount: sum(monthRows.filter((x) => !x.paid), (x) => x.emi),
    },
    overdueCount: open.reduce((a, v) => a + v.summary.overdueCount, 0),
    overdueAmount: sum(open, (v) => v.summary.overdueAmount),
    next: next[0] || null,
    upcoming: next.slice(0, 8),
    // the month the last EMI loan would be cleared, by each loan's own rule; unknown when one's EMI never clears it
    debtFree: open.length && ends.every(Boolean) ? [...ends].sort()[ends.length - 1] : null,
    cash: { count: cash.length, open: cash.filter((v) => !v.summary.closed).length, borrowed: sum(cash, (v) => v.totalAmount), outstanding: cashOwed },
  };
}

class Loans {
  constructor({ docs, now = () => Date.now(), log = console }) {
    this.docs = docs;
    this.now = now;
    this.log = log;
    this.timer = null;
  }

  _all() {
    return this.docs.items(NAME).map((x) => JSON.parse(JSON.stringify(x)));
  }

  _find(id, { deleted = false } = {}) {
    const loan = this._all().find((x) => x.id === String(id || "") && Boolean(x.deletedAt) === deleted);
    if (!loan) throw new LoanError("That loan is no longer there.", "not_found", 404);
    return loan;
  }

  _save(loan, what, by) {
    const at = new Date(this.now()).toISOString();
    loan.updatedAt = at;
    loan.updatedBy = by;
    loan.history = [{ at, by, what }, ...(loan.history || [])].slice(0, KEEP_HISTORY);
    this.docs.putItems(NAME, [loan]);
    return loan;
  }

  /** The rows this loan should have by the running month and does not yet: made with its latest rate, EMI and day. */
  _fill(loan) {
    if (isCash(loan)) return [];
    const plan = loan.method === "schedule" && loan.plan ? new Map(planByMonth(loan.plan.rows).map((x) => [x.month, x])) : null;
    const upto = istDate(this.now()).slice(0, 7);
    const have = new Set(loan.months.map((x) => x.month));
    const added = [];
    let ym = loan.firstEmiDate.slice(0, 7);
    const at = new Date(this.now()).toISOString();
    for (let i = 0; i < MAX_MONTHS && ym <= upto; i += 1, ym = nextMonth(ym)) {
      if (have.has(ym)) continue;
      // nothing owed by then: the loan is over, no more instalments
      const before = schedule({ ...loan, months: loan.months.filter((x) => x.month < ym) });
      const owed = before.length ? before[before.length - 1].outstanding : loan.startBalance;
      if (owed <= 0) break;
      const first = ym === loan.firstEmiDate.slice(0, 7);
      const blank = { paid: false, paidAt: null, paidBy: "", extra: 0, bankBalance: null, remarks: "", createdAt: at, updatedAt: at };
      if (plan) {
        // the lender's schedule decides: no instalment that month, no row
        const x = plan.get(ym);
        if (!x) continue;
        loan.months.push({ month: ym, date: x.date, rate: x.rate || loan.rate, emi: x.emi, principal: x.principal, interest: x.interest, ...blank });
      } else loan.months.push({ month: ym, date: first ? loan.firstEmiDate : dateIn(ym, loan.emiDay), rate: loan.rate, emi: loan.emiAmount, ...blank });
      added.push(ym);
    }
    loan.months.sort((a, b) => (a.month < b.month ? -1 : 1));
    return added;
  }

  /** Every loan brought up to the running month. Saves only the loans that gained a row. */
  catchUp() {
    let made = 0;
    for (const loan of this._all()) {
      if (loan.deletedAt) continue;
      const added = this._fill(loan);
      if (!added.length) continue;
      made += added.length;
      loan.autoAt = new Date(this.now()).toISOString();
      this._save(loan, added.length === 1 ? `Row for ${monthWord(added[0])} added` : `${added.length} monthly rows added (${monthWord(added[0])} to ${monthWord(added[added.length - 1])})`, AUTO);
    }
    return made;
  }

  /** Make the new month's rows by itself, page open or not. */
  start(every = 60 * 60 * 1000) {
    if (this.timer) return;
    const tick = () => {
      try {
        this.catchUp();
      } catch (err) {
        this.log.error("[loans]", err && err.message ? err.message : err);
      }
    };
    this.timer = setInterval(tick, every);
    if (this.timer.unref) this.timer.unref();
    const soon = setTimeout(tick, 5000);
    if (soon.unref) soon.unref();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Everything the page shows. */
  view() {
    this.catchUp();
    const now = this.now();
    const all = this._all();
    const views = all
      .filter((x) => !x.deletedAt)
      .sort((a, b) => (a.openingDate < b.openingDate ? -1 : a.openingDate > b.openingDate ? 1 : String(a.createdAt).localeCompare(String(b.createdAt))))
      .map((x) => viewOf(x, now));
    // the last save of anything, a removed loan included: what the page shows at its foot
    const changes = all.flatMap((x) => (x.history || []).map((h) => ({ ...h, loanId: x.id, name: x.name }))).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)); // equal times keep each loan's own newest-first order
    const autoAt = all.map((x) => x.autoAt).filter(Boolean).sort().pop() || null;
    const kept = this.docs.read(INSIGHT, null) || {};
    return {
      at: new Date(now).toISOString(),
      today: istDate(now),
      ai: this.aiStatus ? this.aiStatus() : { ready: false, model: "", setup: "" },
      insight: { book: kept.book || null, byLoan: kept.byLoan || {}, asked: (kept.asked || []).slice(0, 20) },
      loans: views,
      totals: totalsOf(views, now),
      removed: all.filter((x) => x.deletedAt).map((x) => ({ id: x.id, name: x.name, deletedAt: x.deletedAt })).sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1)),
      saved: { last: changes[0] || null, byPerson: changes.find((c) => c.by !== AUTO) || null, autoAt, store: this.docs.kind || "files" },
      history: changes.slice(0, 100),
      kinds: KINDS,
      methods: METHODS,
    };
  }

  add(input, by = "", { plan = null } = {}) {
    if (this._all().filter((x) => !x.deletedAt).length >= MAX_LOANS) throw new LoanError(`The book holds at most ${MAX_LOANS} loans.`);
    const at = new Date(this.now()).toISOString();
    const id = `l${crypto.randomBytes(8).toString("hex")}`;
    if (input && input.type === "cash") {
      const cash = { id, type: "cash", ...cleanCash(input, this.now()), payments: [], months: [], documents: [], history: [], createdAt: at, createdBy: by, deletedAt: null, autoAt: null };
      this._save(cash, "Cash loan added", by);
      return id;
    }
    const terms = cleanLoan(plan ? { ...input, method: "schedule" } : input, this.now());
    if (terms.method === "schedule" && !plan) throw new LoanError("Upload the lender’s repayment schedule to use it.");
    const loan = { id, type: "bank", ...terms, plan: null, months: [], documents: [], history: [], createdAt: at, createdBy: by, deletedAt: null, autoAt: null };
    if (plan) {
      const checked = cleanPlan(plan);
      loan.plan = { ...checked, uploadedAt: at };
      loan.startBalance = checked.amount;
      loan.firstEmiDate = checked.rows[0].date;
    }
    const added = this._fill(loan);
    if (added.length) loan.autoAt = at;
    this._save(loan, `Loan added${plan ? " from the lender’s repayment schedule" : ""}${added.length ? ` with ${added.length} monthly row${added.length === 1 ? "" : "s"}` : ""}`, by);
    return loan.id;
  }

  /** A loan's own record, as stored. */
  get(id) {
    return this._find(id);
  }

  /**
   * The lender's repayment schedule for a loan already in the book (or a revised one after a part-payment): its figures take
   * over every month it covers; a month keeps its tick, remarks, part-payment and bank figure.
   * @returns { dropped: months outside the schedule that were ticked paid (or carried a part-payment) and are replaced }
   */
  applyPlan(id, plan, by = "") {
    const loan = this._find(id);
    if (isCash(loan)) throw new LoanError("A cash loan has no repayment schedule.");
    const checked = cleanPlan(plan);
    const at = new Date(this.now()).toISOString();
    const byMonth = new Map(planByMonth(checked.rows).map((x) => [x.month, x]));
    const dropped = loan.months.filter((x) => !byMonth.has(x.month) && (x.paid || x.extra > 0)).map((x) => x.month);
    loan.months = loan.months
      .filter((x) => byMonth.has(x.month))
      .map((x) => {
        const n = byMonth.get(x.month);
        return { ...x, date: n.date, emi: n.emi, principal: n.principal, interest: n.interest, rate: n.rate || checked.rate || x.rate, updatedAt: at };
      });
    loan.method = "schedule";
    loan.plan = { ...checked, uploadedAt: at };
    loan.startBalance = checked.amount;
    loan.firstEmiDate = checked.rows[0].date;
    loan.emiDay = Number(checked.rows[Math.min(1, checked.rows.length - 1)].date.slice(8));
    loan.emiAmount = usualEmi(checked.rows);
    if (checked.rate !== null) loan.rate = checked.rate;
    if (loan.totalAmount < checked.amount - 1) loan.totalAmount = checked.amount;
    this._fill(loan);
    this._save(loan, `Repayment schedule applied: ${checked.rows.length} instalments${dropped.length ? `; ${dropped.length} ticked month(s) outside it replaced` : ""}`, by);
    return { dropped };
  }

  attachDocument(id, meta, by = "") {
    const loan = this._find(id);
    loan.documents = [...(loan.documents || []), meta];
    this._save(loan, `Document added: ${meta.docLabel || "document"} (${meta.name})`, by);
    return meta;
  }

  removeDocument(id, docId, by = "") {
    const loan = this._find(id);
    const meta = (loan.documents || []).find((x) => x.id === String(docId || ""));
    if (!meta) throw new LoanError("That document is no longer there.", "not_found", 404);
    loan.documents = loan.documents.filter((x) => x.id !== meta.id);
    this._save(loan, `Document removed: ${meta.name}`, by);
    return meta;
  }

  /* ------------------------------------------------------------ cash loans: repayments entered by hand */
  _cash(id) {
    const loan = this._find(id);
    if (!isCash(loan)) throw new LoanError("Repayments are entered this way for cash loans only.");
    loan.payments = loan.payments || [];
    return loan;
  }

  _fits(loan, amount, but = null) {
    const others = r2(loan.payments.filter((x) => x.id !== but).reduce((a, x) => a + x.amount, 0));
    if (r2(others + amount) > loan.totalAmount + 0.005) throw new LoanError(`That is more than is still owed (₹${r2(loan.totalAmount - others).toLocaleString("en-IN")}).`);
  }

  addPayment(id, input, by = "", extra = {}) {
    const loan = this._cash(id);
    if (loan.payments.length >= MAX_PAYMENTS) throw new LoanError("This loan has too many repayments.");
    const p = cleanPayment(input, loan, this.now());
    this._fits(loan, p.amount);
    const item = { id: `p${crypto.randomBytes(6).toString("hex")}`, ...p, ...extra, at: new Date(this.now()).toISOString(), by };
    loan.payments.push(item);
    this._save(loan, `Repaid ₹${p.amount.toLocaleString("en-IN")} on ${p.date}`, by);
    return item.id;
  }

  updatePayment(id, paymentId, input, by = "") {
    const loan = this._cash(id);
    const old = loan.payments.find((x) => x.id === String(paymentId || ""));
    if (!old) throw new LoanError("That repayment is no longer there.", "not_found", 404);
    const p = cleanPayment(input, loan, this.now());
    this._fits(loan, p.amount, old.id);
    Object.assign(old, p, { at: new Date(this.now()).toISOString(), by });
    this._save(loan, `Repayment changed: ₹${p.amount.toLocaleString("en-IN")} on ${p.date}`, by);
    return old.id;
  }

  removePayment(id, paymentId, by = "") {
    const loan = this._cash(id);
    const old = loan.payments.find((x) => x.id === String(paymentId || ""));
    if (!old) throw new LoanError("That repayment is no longer there.", "not_found", 404);
    loan.payments = loan.payments.filter((x) => x.id !== old.id);
    this._save(loan, `Repayment removed: ₹${old.amount.toLocaleString("en-IN")} of ${old.date}`, by);
    return old.id;
  }

  /** "Is paid?" for a cash loan: ticking records what is left as paid today; unticking takes that entry away again. */
  settle(id, settled, by = "") {
    const loan = this._cash(id);
    const owed = r2(loan.totalAmount - paidBackOf(loan));
    if (settled) {
      if (owed <= 0) throw new LoanError("It is already paid in full.");
      return this.addPayment(id, { date: istDate(this.now()), amount: owed, note: "Settled in full" }, by, { settle: true });
    }
    const last = [...loan.payments].reverse().find((x) => x.settle) || loan.payments[loan.payments.length - 1];
    if (!last) throw new LoanError("Nothing is recorded as paid.");
    return this.removePayment(id, last.id, by);
  }

  /**
   * New terms. A changed rate, EMI or EMI day goes to the unpaid rows of the running month onwards (and every row still to
   * be made); paid rows and earlier months keep what they were. The total and the starting outstanding recount at once.
   */
  update(id, input, by = "") {
    const loan = this._find(id);
    if (isCash(loan)) {
      const next = cleanCash(input, this.now());
      const differs = Object.keys(next).filter((k) => next[k] !== loan[k]);
      if (!differs.length) return loan.id;
      if (next.totalAmount < paidBackOf(loan) - 0.005) throw new LoanError("The amount cannot be less than what is already paid back.");
      if ((loan.payments || []).some((x) => x.date < next.openingDate)) throw new LoanError("A repayment is dated before that day.");
      Object.assign(loan, next);
      const say = { name: "who it is from", openingDate: "date", totalAmount: "amount", remarks: "remarks" };
      this._save(loan, `Changed: ${differs.map((k) => say[k]).join(", ")}`, by);
      return loan.id;
    }
    const planned = Boolean(loan.plan);
    const terms = cleanLoan(planned && !(input && input.method) ? { ...input, method: loan.method } : input, this.now());
    if (terms.method === "schedule" && !planned) throw new LoanError("Upload the lender’s repayment schedule to use it.");
    // the lender's schedule fixes where its months begin and what was owed then
    if (terms.method === "schedule") Object.assign(terms, { firstEmiDate: loan.plan.rows[0].date, startBalance: loan.plan.amount });
    const ym = istDate(this.now()).slice(0, 7);
    const start = terms.firstEmiDate.slice(0, 7);
    if (loan.months.some((x) => x.month < start && (x.paid || x.extra > 0 || x.bankBalance !== null))) throw new LoanError("Months before that first EMI are marked paid (or carry a payment): untick them first.");
    const changed = Object.keys(terms).filter((k) => terms[k] !== loan[k]);
    if (!changed.length) return loan.id;
    const at = new Date(this.now()).toISOString();
    Object.assign(loan, terms);
    loan.months = loan.months.filter((x) => x.month >= start);
    for (const row of loan.months) {
      // on the lender's schedule the months' figures are the lender's: new terms do not rewrite them
      if (row.paid || row.month < ym || loan.method === "schedule") continue;
      if (changed.includes("rate")) row.rate = terms.rate;
      if (changed.includes("emiAmount")) row.emi = terms.emiAmount;
      if (changed.includes("emiDay")) row.date = dateIn(row.month, terms.emiDay);
      row.updatedAt = at;
    }
    if (changed.includes("method") && terms.method === "schedule") {
      const plan = new Map(planByMonth(loan.plan.rows).map((x) => [x.month, x]));
      for (const row of loan.months) {
        const x = plan.get(row.month);
        if (x) Object.assign(row, { emi: row.paid ? row.emi : x.emi, principal: x.principal, interest: x.interest });
      }
    }
    if (changed.includes("firstEmiDate")) {
      const first = loan.months.find((x) => x.month === start);
      if (first && !first.paid) first.date = terms.firstEmiDate;
    }
    this._fill(loan);
    const words = { name: "name", kind: "type", openingDate: "opening date", totalAmount: "total amount", rate: "interest rate", emiAmount: "EMI amount", firstEmiDate: "first EMI date", emiDay: "EMI day", startBalance: "starting outstanding", method: "how EMIs reduce it", remarks: "remarks" };
    this._save(loan, `Changed: ${changed.map((k) => words[k] || k).join(", ")}`, by);
    return loan.id;
  }

  /** One month's row: Is paid?, its EMI, date and rate, a part-payment, the bank's balance, remarks. Only what is sent changes. */
  setMonth(id, month, input, by = "") {
    const loan = this._find(id);
    if (isCash(loan)) throw new LoanError("A cash loan has no monthly EMIs: enter its repayments instead.");
    this._fill(loan);
    const row = loan.months.find((x) => x.month === String(month || ""));
    if (!row) throw new LoanError("There is no row for that month.", "not_found", 404);
    const b = input && typeof input === "object" ? input : {};
    const at = new Date(this.now()).toISOString();
    const what = [];
    if (b.emi !== undefined) {
      const emi = money(b.emi, "the EMI amount", { max: loan.totalAmount * 2 });
      if (emi !== row.emi) {
        what.push("EMI amount");
        // on a lender's schedule the interest stands: the change is principal (unless the parts are given too)
        if (loan.method === "schedule" && b.principal === undefined && typeof row.interest === "number") row.principal = r2(Math.max(0, emi - row.interest));
      }
      row.emi = emi;
    }
    for (const [k, word] of [["principal", "principal part"], ["interest", "interest part"]]) {
      if (b[k] === undefined || b[k] === "" || loan.method !== "schedule") continue;
      const v = money(b[k], `the ${word}`, { max: loan.totalAmount * 2 });
      if (v !== row[k]) what.push(word);
      row[k] = v;
    }
    if (b.date !== undefined) {
      if (!realDate(b.date) || String(b.date).slice(0, 7) !== row.month) throw new LoanError(`The EMI date must be a day in ${monthWord(row.month)}.`);
      if (b.date !== row.date) what.push("EMI date");
      row.date = String(b.date);
    }
    if (b.rate !== undefined) {
      const rate = rateOf(b.rate);
      if (rate !== row.rate) what.push("interest rate");
      row.rate = rate;
    }
    if (b.extra !== undefined) {
      const extra = money(b.extra === "" ? 0 : b.extra, "the part-payment", { max: loan.totalAmount * 1.5 });
      if (extra !== row.extra) what.push("part-payment");
      row.extra = extra;
    }
    if (b.bankBalance !== undefined) {
      const bank = money(b.bankBalance, "the bank’s outstanding", { max: loan.totalAmount * 2, optional: true });
      if (bank !== row.bankBalance) what.push(bank === null ? "bank’s balance cleared" : "bank’s balance");
      row.bankBalance = bank;
    }
    if (b.remarks !== undefined) {
      const remarks = text(b.remarks, 300);
      if (remarks !== row.remarks) what.push("remarks");
      row.remarks = remarks;
    }
    if (b.paid !== undefined) {
      if (typeof b.paid !== "boolean") throw new LoanError("Is paid? is yes or no.");
      if (b.paid !== row.paid) {
        what.unshift(b.paid ? "EMI marked paid" : "EMI marked not paid");
        row.paid = b.paid;
        row.paidAt = b.paid ? at : null;
        row.paidBy = b.paid ? by : "";
      }
    }
    if (!what.length) return loan.id;
    row.updatedAt = at;
    this._fill(loan); // a month untied from "paid off" may owe rows again
    this._save(loan, `${monthWord(row.month)}: ${what.join(", ")}`, by);
    return loan.id;
  }

  /** Every unpaid row up to and including `month` marked paid: for a loan brought into the book part-way through. */
  paidUpTo(id, month, by = "") {
    const loan = this._find(id);
    if (isCash(loan)) throw new LoanError("A cash loan has no monthly EMIs.");
    this._fill(loan);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ""))) throw new LoanError("Choose the month.");
    const at = new Date(this.now()).toISOString();
    let n = 0;
    for (const row of loan.months) {
      if (row.month > month || row.paid) continue;
      Object.assign(row, { paid: true, paidAt: at, paidBy: by, updatedAt: at });
      n += 1;
    }
    if (!n) throw new LoanError("Every EMI up to that month is already marked paid.");
    this._save(loan, `${n} EMI${n === 1 ? "" : "s"} marked paid, up to ${monthWord(month)}`, by);
    return n;
  }

  /** Taken off the page, kept in the database: it can be brought back. */
  remove(id, by = "") {
    const loan = this._find(id);
    loan.deletedAt = new Date(this.now()).toISOString();
    this._save(loan, "Loan removed", by);
    return loan.id;
  }

  restore(id, by = "") {
    const loan = this._find(id, { deleted: true });
    loan.deletedAt = null;
    this._fill(loan);
    this._save(loan, "Loan brought back", by);
    return loan.id;
  }
}

/** The routes. Superadmins only. Every change answers with the whole book, so the page shows one consistent state. */
function mountLoans(app, { loans, requireSuper, limiter }) {
  const wrap = (fn, status = 200) => async (req, res) => {
    try {
      res.status(status).json(await fn(req));
    } catch (err) {
      if (err instanceof LoanError) return res.status(err.status).json({ error: err.code, message: err.message });
      console.error("[loans]", err && err.message ? err.message : err);
      res.status(500).json({ error: "loans_failed", message: "The loan book could not be saved." });
    }
  };
  const by = (req) => (req.user && req.user.email) || "";
  const writes = limiter(900, 15 * 60 * 1000);
  const after = (result) => ({ ...loans.view(), ...result });
  app.get("/api/admin/loans", requireSuper, wrap(async () => loans.view()));
  app.post("/api/admin/loans", requireSuper, writes, wrap(async (req) => after({ id: loans.add(req.body, by(req)) }), 201));
  app.put("/api/admin/loans/:id", requireSuper, writes, wrap(async (req) => after({ id: loans.update(String(req.params.id), req.body, by(req)) })));
  app.put("/api/admin/loans/:id/months/:month", requireSuper, writes, wrap(async (req) => after({ id: loans.setMonth(String(req.params.id), String(req.params.month), req.body, by(req)) })));
  app.post("/api/admin/loans/:id/paid-upto", requireSuper, writes, wrap(async (req) => after({ marked: loans.paidUpTo(String(req.params.id), String((req.body || {}).month || ""), by(req)) })));
  app.delete("/api/admin/loans/:id", requireSuper, writes, wrap(async (req) => after({ id: loans.remove(String(req.params.id), by(req)) })));
  app.post("/api/admin/loans/:id/restore", requireSuper, writes, wrap(async (req) => after({ id: loans.restore(String(req.params.id), by(req)) })));
  // cash loans: repayments by hand
  app.post("/api/admin/loans/:id/payments", requireSuper, writes, wrap(async (req) => after({ payment: loans.addPayment(String(req.params.id), req.body, by(req)) }), 201));
  app.put("/api/admin/loans/:id/payments/:pid", requireSuper, writes, wrap(async (req) => after({ payment: loans.updatePayment(String(req.params.id), String(req.params.pid), req.body, by(req)) })));
  app.delete("/api/admin/loans/:id/payments/:pid", requireSuper, writes, wrap(async (req) => after({ payment: loans.removePayment(String(req.params.id), String(req.params.pid), by(req)) })));
  app.post("/api/admin/loans/:id/settle", requireSuper, writes, wrap(async (req) => {
    loans.settle(String(req.params.id), Boolean((req.body || {}).settled), by(req));
    return after({ id: String(req.params.id) });
  }));
}

module.exports = { Loans, LoanError, mountLoans, simulate, cleanLoan, cleanCash, cleanPlan, planByMonth, usualEmi, schedule, payoff, viewOf, totalsOf, dateIn, nextMonth, KINDS, METHODS, NAME, INSIGHT, AUTO };
