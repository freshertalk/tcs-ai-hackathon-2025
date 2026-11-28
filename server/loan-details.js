"use strict";
// Everything a loan's papers say beyond the loan's own terms (28 Nov 2026) — the owner: "scan and read all documents …
// extract all the required information and store here", with review and editing. One list, used by the reading of
// documents, the joining of several of them, the saved loan and the AI.

const GROUPS = [
  ["terms", "Terms"],
  ["amounts", "Amounts and dates"],
  ["charges", "Charges and conditions"],
  ["latest", "Lender’s latest figures"],
  ["cover", "Security and insurance"],
];

/** key, label, type (text | money | percent | count | date), group */
const DETAILS = [
  ["rateType", "Rate type", "text", "terms"],
  ["benchmark", "Benchmark and spread", "text", "terms"],
  ["apr", "Annual percentage rate (APR)", "percent", "terms"],
  ["tenureMonths", "Tenure (months)", "count", "terms"],
  ["emiDay", "EMI due day of the month", "count", "terms"],
  ["maturityDate", "Last EMI / maturity date", "date", "terms"],
  ["moratorium", "Moratorium", "text", "terms"],
  ["repaymentMode", "How it is repaid", "text", "terms"],
  ["sanctionAmount", "Sanctioned amount (₹)", "money", "amounts"],
  ["sanctionDate", "Sanction date", "date", "amounts"],
  ["disbursedAmount", "Disbursed amount (₹)", "money", "amounts"],
  ["disbursementDate", "Disbursement date", "date", "amounts"],
  ["processingFee", "Processing fee (₹)", "money", "amounts"],
  ["insurancePremium", "Insurance premium (₹)", "money", "amounts"],
  ["totalInterest", "Total interest over the tenure (₹)", "money", "amounts"],
  ["totalPayable", "Total to be repaid (₹)", "money", "amounts"],
  ["foreclosureCharge", "Foreclosure charge", "text", "charges"],
  ["partPaymentCharge", "Part-payment charge", "text", "charges"],
  ["penalCharge", "Penal / late payment charge", "text", "charges"],
  ["bounceCharge", "Bounce charge", "text", "charges"],
  ["lockIn", "Lock-in", "text", "charges"],
  ["otherCharges", "Other charges", "text", "charges"],
  ["asOnDate", "Figures as on", "date", "latest"],
  ["outstanding", "Principal outstanding stated (₹)", "money", "latest"],
  ["principalPaid", "Principal paid so far (₹)", "money", "latest"],
  ["interestPaid", "Interest paid so far (₹)", "money", "latest"],
  ["emisPaid", "EMIs paid", "count", "latest"],
  ["emisLeft", "EMIs left", "count", "latest"],
  ["overdueAmount", "Overdue amount (₹)", "money", "latest"],
  ["security", "Security / collateral", "text", "cover"],
  ["insurance", "Insurance cover", "text", "cover"],
].map(([key, label, type, group]) => ({ key, label, type, group }));

const BY_KEY = new Map(DETAILS.map((d) => [d.key, d]));
const TEXT_MAX = 300;

/** One value in the shape its type asks for, or null when it is not one. */
function cleanValue(key, raw) {
  const d = BY_KEY.get(key);
  if (!d || raw === undefined || raw === null) return null;
  const s = String(raw).replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (d.type === "text") return s.slice(0, TEXT_MAX);
  if (d.type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const t = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s && s >= "1970-01-01" && s <= "2100-12-31" ? s : null;
  }
  const n = Number(s.replace(/[₹,%\s]|rs\.?|inr/gi, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  if (d.type === "percent") return n <= 100 ? n : null;
  if (d.type === "count") return Number.isInteger(n) && n <= 1000 && !(key === "emiDay" && (n < 1 || n > 31)) ? n : null;
  return n <= 1e10 ? Math.round(n * 100) / 100 : null;
}

module.exports = { DETAILS, GROUPS, BY_KEY, cleanValue };
