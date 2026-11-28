"use strict";
// Several papers of one loan, read as one (28 Nov 2026) — the owner: "allow multiple documents together like Loan Agreement,
// Sanction Letter, Loan Account Statement etc and you must extract all details and fill it by yourself and also allow users
// to review and edit".
//
//   WHICH VALUE   for every figure the best source wins, and the others stay in view to be picked instead. Best: the
//                 repayment schedule's arithmetic, then a paper's own words, then the free AI where the words are in the
//                 paper, then what was read from a scan, then the rest of the AI's. Between equals, the kind of paper that
//                 is the authority on that figure (a sanction letter on what was sanctioned, a statement on what is paid).
//   SAME LOAN     papers that name different account numbers, or very different amounts, are said to be so.
//   PAID          the months a statement shows an EMI as received (a bounced one is taken back out), or else the count of
//                 EMIs it says are paid. Offered ticked for review; nothing is saved without Save.
// Pure: no files, no network, no AI.

const { DETAILS, BY_KEY, cleanValue } = require("./loan-details");

const CORE = ["lender", "kind", "openingDate", "totalAmount", "rate", "emiAmount", "firstEmiDate"];

const AGREED = ["agreement", "kfs", "sanction", "schedule", "statement", "certificate", "foreclosure", "insurance", "noc", "other"];
const ORDERS = {
  totalAmount: ["schedule", "statement", "kfs", "agreement", "sanction", "certificate", "foreclosure", "insurance", "noc", "other"],
  rate: ["schedule", "statement", "kfs", "agreement", "sanction", "certificate", "foreclosure", "other"],
  emiAmount: ["schedule", "statement", "kfs", "agreement", "sanction", "certificate", "other"],
  openingDate: ["statement", "schedule", "certificate", "kfs", "agreement", "sanction", "other"],
  firstEmiDate: ["schedule", "statement", "kfs", "agreement", "sanction", "other"],
  sanctionAmount: ["sanction", "kfs", "agreement"],
  sanctionDate: ["sanction", "kfs", "agreement"],
  disbursedAmount: ["statement", "certificate", "schedule"],
  disbursementDate: ["statement", "certificate", "schedule"],
  latest: ["foreclosure", "statement", "certificate", "schedule"],
};
const LATEST = new Set(DETAILS.filter((d) => d.group === "latest").map((d) => d.key));

const tierOf = (v) => (v.from === "schedule" ? 0 : v.from === "document" ? 1 : v.from === "ai" && v.checked === true ? 2 : v.from === "scan" ? 3 : v.from === "suggested" ? 5 : 4);
const placeOf = (key, type) => {
  const order = ORDERS[key] || (LATEST.has(key) ? ORDERS.latest : AGREED);
  const at = order.indexOf(type);
  return at >= 0 ? at : order.length + AGREED.indexOf(type) + 1;
};
const same = (a, b) => (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 0.005 : String(a).toLowerCase().replace(/[^a-z0-9.]+/g, "") === String(b).toLowerCase().replace(/[^a-z0-9.]+/g, ""));

/**
 * @param candidates [{ value, from, line, checked, token, docType, docLabel, file, asOn }]
 * @returns the winner, with `others`: the different values the other papers give
 */
function choose(key, candidates) {
  const list = [...candidates].sort((a, b) => {
    const t = tierOf(a) - tierOf(b);
    if (t) return t;
    // the lender's latest figures: the paper with the later date speaks
    if (LATEST.has(key) && (a.asOn || b.asOn) && a.asOn !== b.asOn) return String(b.asOn || "").localeCompare(String(a.asOn || ""));
    return placeOf(key, a.docType) - placeOf(key, b.docType);
  });
  const best = list[0];
  const others = [];
  const agree = [best.file];
  for (const c of list.slice(1)) {
    if (same(c.value, best.value)) {
      if (!agree.includes(c.file)) agree.push(c.file);
    } else if (!others.some((o) => same(o.value, c.value))) others.push({ value: c.value, from: c.from, token: c.token, file: c.file, docLabel: c.docLabel });
  }
  return { ...best, agree: agree.length, others: others.slice(0, 4) };
}

/** The schedule to use among the files: a paper that is a schedule, with the lender's own split, complete, the longest. */
function chooseSchedule(views) {
  const score = (v) => (v.docType.id === "schedule" ? 1000 : 0) + (v.schedule.how === "lender" ? 300 : v.schedule.how === "balance" ? 200 : 100) + (v.schedule.needs.length ? 0 : 50) + Math.min(49, v.schedule.count / 10);
  return views.filter((v) => v.schedule.found).sort((a, b) => score(b) - score(a));
}

/** Words for each file that does not look like it is about the same loan as the first ones. */
function differentLoans(views) {
  const out = [];
  const numbered = views.filter((v) => v.accountLast4);
  if (numbered.length) {
    const count = new Map();
    for (const v of numbered) count.set(v.accountLast4, (count.get(v.accountLast4) || 0) + 1);
    const usual = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
    for (const v of numbered) if (v.accountLast4 !== usual) out.push({ token: v.token, why: `${v.file.name} shows a loan number ending ${v.accountLast4}; the other papers show ${usual}.` });
  }
  const amounts = views.filter((v) => v.values.totalAmount && !["statement", "certificate", "foreclosure", "insurance", "noc"].includes(v.docType.id) && v.values.totalAmount.from !== "ai");
  if (amounts.length > 1) {
    // measured against what most of the papers agree on (not against whichever came first); between equals, a paper
    // whose loan number is the usual one, then the one with the schedule's arithmetic
    const near = (a, b) => Math.abs(a - b) <= b * 0.15;
    const odd = new Set(out.map((x) => x.token));
    const weight = (v) => amounts.filter((o) => near(o.values.totalAmount.value, v.values.totalAmount.value)).length * 100 + (odd.has(v.token) ? 0 : 10) + (v.values.totalAmount.from === "schedule" ? 1 : 0);
    const usual = [...amounts].sort((a, b) => weight(b) - weight(a))[0];
    const base = usual.values.totalAmount.value;
    for (const v of amounts) {
      const a = v.values.totalAmount.value;
      if (!odd.has(v.token) && !near(a, base)) out.push({ token: v.token, why: `${v.file.name} is for ₹${a.toLocaleString("en-IN")}; ${usual.file.name} is for ₹${base.toLocaleString("en-IN")}.` });
    }
  }
  return out;
}

const monthOf = (d) => d.slice(0, 7);
const days = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
const addMonth = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const len = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, len))).toISOString().slice(0, 10);
};

/** The instalments to match payments against: the schedule's, else one a month from the first EMI at the EMI amount. */
function instalmentsOf({ rows, emi, firstEmiDate, today }) {
  if (rows && rows.length) {
    const byMonth = new Map();
    for (const r of rows) {
      const k = monthOf(r.date);
      const had = byMonth.get(k);
      byMonth.set(k, had ? { ...had, emi: had.emi + r.emi, parts: [...had.parts, r.emi] } : { month: k, date: r.date, emi: r.emi, parts: [r.emi] });
    }
    return [...byMonth.values()];
  }
  if (!emi || !firstEmiDate) return [];
  const out = [];
  for (let k = 0; k < 600; k += 1) {
    const date = addMonth(firstEmiDate, k);
    if (monthOf(date) > monthOf(addMonth(today, 1))) break;
    out.push({ month: monthOf(date), date, emi, parts: [emi] });
  }
  return out;
}

const fits = (amount, inst) => [inst.emi, ...inst.parts].some((e) => Math.abs(amount - e) <= Math.max(2, e * 0.005));

/**
 * The months the statements show as paid.
 * @returns { months, how: "lines" | "count" | "", file, asOn, bounced }
 */
function paidMonths({ receipts, count, instalments, today }) {
  const none = { months: [], how: "", file: "", asOn: "", bounced: 0 };
  if (!instalments.length) return none;
  const byMonth = new Map(); // month → the receipt matched to it
  const seen = new Set();
  const sorted = [...receipts].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : Number(a.undone) - Number(b.undone)));
  let bounced = 0;
  let file = "";
  for (const r of sorted) {
    // the same line in two statements of overlapping periods counts once
    const key = `${r.date}|${r.amounts.join(",")}|${r.undone}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (r.undone) {
      const hit = [...byMonth.entries()].reverse().find(([, x]) => days(r.date, x.date) >= 0 && days(r.date, x.date) <= 12 && r.amounts.some((a) => fits(a, x.inst)));
      if (hit) {
        byMonth.delete(hit[0]);
        bounced += 1;
      }
      continue;
    }
    const free = instalments.filter((i) => !byMonth.has(i.month) && r.amounts.some((a) => fits(a, i)));
    // its own month; else one it pays late (up to two months); else the next one, paid a few days early
    const pick = free.find((i) => i.month === monthOf(r.date)) || [...free].reverse().find((i) => days(r.date, i.date) > 0 && days(r.date, i.date) <= 62) || free.find((i) => days(i.date, r.date) >= 0 && days(i.date, r.date) <= 10);
    if (pick) {
      byMonth.set(pick.month, { date: r.date, inst: pick });
      file = file || r.file;
    }
  }
  const now = monthOf(today);
  const months = [...byMonth.keys()].filter((m) => m <= now).sort();
  if (months.length) return { months, how: "lines", file, asOn: sorted.length ? sorted[sorted.length - 1].date : "", bounced };
  if (count && count.value > 0) {
    const due = instalments.filter((i) => i.date <= today).slice(0, count.value);
    return { months: due.map((i) => i.month), how: due.length ? "count" : "", file: count.file || "", asOn: count.asOn || "", bounced };
  }
  return { ...none, bounced };
}

/**
 * @param views what each file gave (LoanIntake.view), each with `receipts` and `rows` of its own
 * @returns { values, details, paidEvidence input, warnings, terms, watch, summaries }
 */
function combine(views) {
  const values = {};
  const details = {};
  const candidates = new Map();
  const add = (key, v, view) => {
    if (!candidates.has(key)) candidates.set(key, []);
    const asOn = view.values.asOnDate ? view.values.asOnDate.value : "";
    candidates.get(key).push({ value: v.value, from: v.from, line: v.line || "", checked: v.checked, token: view.token, docType: view.docType.id, docLabel: view.docType.label, file: view.file.name, asOn });
  };
  for (const view of views) {
    for (const [k, v] of Object.entries(view.values)) {
      if (k === "name") continue;
      add(k, v, view);
    }
  }
  for (const key of CORE) {
    if (candidates.has(key)) values[key] = choose(key, candidates.get(key));
  }
  // the day money was paid out is the day the loan opened; what was paid out is the loan, when no schedule says otherwise
  const disbursed = candidates.get("disbursementDate");
  if (disbursed) {
    const d = choose("disbursementDate", disbursed);
    if (!values.openingDate || !same(values.openingDate.value, d.value)) values.openingDate = { ...d, others: values.openingDate ? [{ value: values.openingDate.value, from: values.openingDate.from, token: values.openingDate.token, file: values.openingDate.file, docLabel: values.openingDate.docLabel }, ...values.openingDate.others.filter((o) => !same(o.value, d.value))].slice(0, 4) : d.others };
  }
  const paidOut = candidates.get("disbursedAmount");
  if (paidOut && (!values.totalAmount || values.totalAmount.from !== "schedule")) {
    const d = choose("disbursedAmount", paidOut);
    if (!values.totalAmount || (!same(values.totalAmount.value, d.value) && tierOf(d) <= tierOf(values.totalAmount))) values.totalAmount = { ...d, others: values.totalAmount ? [{ value: values.totalAmount.value, from: values.totalAmount.from, token: values.totalAmount.token, file: values.totalAmount.file, docLabel: values.totalAmount.docLabel }, ...values.totalAmount.others.filter((o) => !same(o.value, d.value))].slice(0, 4) : d.others };
  }
  for (const d of DETAILS) {
    if (!candidates.has(d.key)) continue;
    const fit = candidates.get(d.key).map((c) => ({ ...c, value: cleanValue(d.key, c.value) })).filter((c) => c.value !== null);
    if (fit.length) details[d.key] = { label: d.label, group: d.group, type: d.type, ...choose(d.key, fit) };
  }
  const terms = [];
  for (const view of views) for (const t of view.terms) if (!terms.some((x) => x.quote === t.quote)) terms.push({ ...t, file: view.file.name });
  return {
    values,
    details,
    warnings: differentLoans(views),
    terms: terms.slice(0, 40),
    watch: [...new Set(views.flatMap((v) => v.watch))].slice(0, 10),
    summaries: views.filter((v) => v.summary).map((v) => ({ token: v.token, file: v.file.name, text: v.summary })),
  };
}

module.exports = { combine, choose, chooseSchedule, paidMonths, instalmentsOf, differentLoans, CORE, BY_KEY };
