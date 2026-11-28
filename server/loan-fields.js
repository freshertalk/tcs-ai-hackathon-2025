"use strict";
// What a loan document says, found in its own words (28 Nov 2026): the lender, the amount, the rate, the tenure, the EMI,
// the dates, fees and the charges worth knowing. Pure pattern reading — no AI, no network. Every value comes with the line it
// was read from. Also here: the blanking of identity numbers, applied before any text goes to an AI model.

const { findDate } = require("./loan-schedule");

const LENDERS = ["State Bank of India", "SBI Card", "SBI", "HDFC Bank", "HDFC", "ICICI Bank", "ICICI", "Axis Bank", "Kotak Mahindra", "Kotak", "Bajaj Housing Finance", "Bajaj Finserv", "Bajaj Finance", "Punjab National Bank", "PNB Housing", "Bank of Baroda", "Canara Bank", "Union Bank of India", "IDFC First", "IndusInd Bank", "Yes Bank", "LIC Housing Finance", "Tata Capital", "L&T Finance", "Muthoot Finance", "Manappuram", "Federal Bank", "IDBI Bank", "Indian Bank", "Bank of India", "Central Bank of India", "AU Small Finance Bank", "RBL Bank", "Standard Chartered", "HSBC", "Citibank", "DBS Bank", "Aditya Birla", "Cholamandalam", "Shriram Finance", "Mahindra Finance", "Piramal", "Godrej Housing", "Hero FinCorp", "TVS Credit", "Fullerton", "SMFG India Credit", "Home Credit", "Poonawalla Fincorp", "UCO Bank", "Indian Overseas Bank", "Bank of Maharashtra", "Karnataka Bank", "South Indian Bank", "Bandhan Bank"];

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
const toNumber = (s, unit = "") => {
  const v = Number(String(s).replace(/,/g, ""));
  if (!Number.isFinite(v)) return null;
  const u = String(unit || "").toLowerCase();
  return Math.round(v * (/^(lakh|lac)/.test(u) ? 1e5 : /^(crore|cr$)/.test(u) ? 1e7 : 1) * 100) / 100;
};
const MONEY = "(?:rs\\.?|inr|₹)?\\s*([\\d,]+(?:\\.\\d+)?)\\s*(?:\\/-)?\\s*(lakhs?|lacs?|crores?|cr\\b)?";
const SEP = "\\s*(?:\\([^)]{0,30}\\)\\s*)?[:\\-–=|]?\\s*";
const money = (labels) => new RegExp(`(?:${labels})${SEP}${MONEY}`, "i");

const PATTERNS = {
  loanAmount: money("loan amount(?: sanctioned| disbursed)?|amount of (?:the )?loan|sanctioned (?:loan )?amount|amount sanctioned|amount financed|finance amount|disbursed amount|disbursement amount|loan sanctioned"),
  emiAmount: money("emi amount|emi \\(rs\\.?\\)|equated monthly instal?l?ments?(?: amount)?|monthly instal?l?ment(?: amount)?|instal?l?ment amount|\\bemi\\b"),
  processingFee: money("processing (?:fee|charges?)"),
  outstanding: money("principal outstanding|outstanding principal|outstanding loan (?:amount|balance)|total outstanding|outstanding balance"),
};
const RATE = /(?:rate of interest|interest rate|\broi\b|applicable rate|lending rate)[^\d%]{0,50}?(\d{1,2}(?:\.\d{1,3})?)\s*(?:%|percent|per cent)/i;
const APR = /(?:annual percentage rate|\bapr\b)[^\d%]{0,50}?(\d{1,2}(?:\.\d{1,3})?)\s*(?:%|percent|per cent)/i;
const TENURE = /(?:tenure|tenor|repayment period|loan (?:period|term)|term of (?:the )?loan|(?:no\.?|number) of (?:emis?|instal?l?ments?)\b(?!\s*(?:paid|received|cleared|collected|balance|remaining|pending|outstanding|overdue|due|bounced)))[^\d]{0,30}?(\d{1,3})\s*(months?|mths?|years?|yrs?)?/i;
// what is left of a tenure, or already paid of it, is not the loan's tenure
const NOT_TENURE = /(?:balance|remaining|residual|pending|elapsed|completed)\s+(?:loan\s+)?(?:tenure|tenor|term)/i;

/* ------------------------------------------------------------ the other details (loan-details.js) */
const MORE_MONEY = {
  sanctionAmount: money("sanctioned (?:loan )?amount|amount sanctioned|loan amount sanctioned|loan sanctioned|sanction amount"),
  disbursedAmount: money("(?:total |net )?disbursed amount|disbursement amount|amount disbursed|loan amount disbursed"),
  insurancePremium: money("insurance premium(?: amount)?"),
  totalInterest: money("total interest (?:amount |charge[sd]? )?(?:payable|chargeable)(?: during the (?:entire )?(?:tenure|term)(?: of the loan)?)?|total interest charge[sd]?(?: during the (?:entire )?(?:tenure|term)(?: of the loan)?)?"),
  totalPayable: money("total (?:amount )?(?:to be (?:re)?paid|payable|repayable)(?: by the borrower)?(?: amount)?"),
  principalPaid: money("(?:total )?principal (?:amount )?(?:paid|repaid|received|collected)(?: till date| so far)?"),
  interestPaid: money("(?:total )?interest (?:amount )?(?:paid|received|collected)(?: till date| so far)?"),
  overdueAmount: money("(?:total )?overdue amount|amount overdue"),
};
const MORE_DATES = {
  sanctionDate: /(?:sanction(?:ed)? date|date of sanction|sanctioned on)\s*[:\-–=|]?\s*(.{0,28})/i,
  disbursementDate: /(?:disbursement date|disbursal date|date of (?:first )?disbursement|disbursed on)\s*[:\-–=|]?\s*(.{0,28})/i,
  maturityDate: /(?:maturity date|loan end date|last emi(?: due)? date|last instal?l?ment(?: due)? date|date of (?:the )?(?:last|final) (?:emi|instal?l?ment))\s*[:\-–=|]?\s*(.{0,28})/i,
  asOnDate: /(?:statement (?:date|as on)|position as on|outstanding as on|balance as on|as on date|as on|as at|as of)\s*[:\-–=|]?\s*(.{0,28})/i,
};
const MORE_COUNTS = {
  emisPaid: /(?:(?:no\.?|number) of (?:emis?|instal?l?ments?) (?:paid|received|cleared|collected)|\bemis? paid|instal?l?ments? paid|paid emis?)\s*(?:till date|so far)?\s*[:\-–=|]?\s*(\d{1,3})\b(?![\/.,\-]\d)/i,
  emisLeft: /(?:(?:balance|remaining|pending|future|residual) (?:tenure|emis?|instal?l?ments?)|(?:no\.?|number) of (?:emis?|instal?l?ments?) (?:balance|remaining|pending|left))\s*(?:\(months\))?\s*[:\-–=|]?\s*(\d{1,3})\b(?![\/.,\-]\d)/i,
};
/** "Label : what the paper says" — the words after the label, on a line that has a clear gap or a mark between them. */
const says = (labels) => new RegExp(`(?:^|[\\s|(])(?:${labels})(?:\\s*\\([^)]{0,40}\\))?(?:\\s+(?:charges?|fees?))?(?:\\s*\\([^)]{0,40}\\))?(?:\\s*[:|]|\\s+[\\-–]\\s|\\s{2,})\\s*(\\S.{1,200})`, "i");
const MORE_WORDS = {
  benchmark: says("benchmark(?: rate)?(?: and spread)?|reference (?:benchmark )?rate|rate linked to"),
  moratorium: says("moratorium(?: period)?"),
  repaymentMode: says("repayment mode|mode of (?:re)?payment"),
  foreclosureCharge: says("fore[\\s-]?closure|pre[\\s-]?closure|full pre[\\s-]?payment|pre[\\s-]?payment"),
  partPaymentCharge: says("part[\\s-]?(?:pre[\\s-]?)?payment"),
  penalCharge: says("penal (?:interest|charges?)|late payment (?:interest|fee|charges?)|overdue (?:interest|charges?)|default interest"),
  // "return" and "dishonour" name a charge only when the words say charge or fee: "NACH return" alone is something that happened
  bounceCharge: says("(?:(?:cheque|check|ecs|nach|emi|mandate)(?:\\s*\\/\\s*(?:ecs|nach|cheque))?\\s+)?bounce|(?:cheque|check|ecs|nach|emi|mandate)(?:\\s*\\/\\s*(?:ecs|nach|cheque))?\\s+(?:return|dishonou?r)(?=\\s+(?:charges?|fees?))"),
  lockIn: says("lock[\\s-]?in(?: period)?"),
  otherCharges: says("documentation|stamp duty|conversion|statement|switching|legal and technical"),
  security: says("(?:primary |collateral )?security(?: offered| details)?|collateral|hypothecation(?: of)?"),
  insurance: says("insurance(?: cover(?:age)?| policy| requirement)?"),
};
const DATES = {
  openingDate: /(?:disbursement date|date of (?:first )?disbursement|disbursal date|disbursed on|loan date|date of (?:the )?loan|loan start date|agreement date|date of agreement|sanction date|date of sanction|account open(?:ing)? date)\s*[:\-–=|]?\s*(.{0,28})/i,
  firstEmiDate: /(?:first emi(?: due)? date|emi start(?:ing)? date|first instal?l?ment(?: due)? date|date of (?:the )?first (?:emi|instal?l?ment)|repayment (?:start|commencement) date|first emi on)\s*[:\-–=|]?\s*(.{0,28})/i,
};
const EMI_DAY = /(?:emi(?: due)? (?:date|day)|due date of (?:the )?emi)[^\d]{0,30}?(\d{1,2})(?:st|nd|rd|th)?\s*(?:day )?(?:of )?(?:every|each|the) month/i;
const ACCOUNT = /(?:loan (?:account|a\/c|agreement|application)\s*(?:no\.?|number|#)?|\blan\b|loan no\.?)\s*[:\-–#|]?\s*([A-Z]{0,8}[\-\/]?\d[A-Z0-9\-\/]{4,24})/i;

const TERMS = [
  ["Foreclosure / pre-payment", /fore[\s-]?clos|pre[\s-]?closure|pre[\s-]?payment|part[\s-]?payment/i],
  ["Penal charges", /penal|default interest|late (?:payment )?(?:fee|charges?)|overdue (?:interest|charges?)/i],
  ["Bounce charges", /bounce|cheque return|ecs return|nach return|dishono/i],
  ["Lock-in", /lock[\s-]?in/i],
  ["Insurance", /insurance|premium financed/i],
  ["Rate changes", /reset|repo rate|\brllr\b|\bmclr\b|\beblr\b|benchmark rate|floating rate/i],
  ["Other charges", /processing fee|conversion fee|switch(?:ing)? fee|documentation charge|stamp duty|statement charge/i],
];

const DOC_TYPES = [
  ["schedule", "Repayment schedule", /repayment schedule|amorti[sz]ation|instal?l?ment schedule|emi schedule|repayment chart/i],
  ["certificate", "Interest certificate", /interest certificate|certificate of interest|provisional certificate/i],
  ["foreclosure", "Foreclosure letter", /foreclosure (?:letter|statement|quotation)|pre[\s-]?closure statement/i],
  ["kfs", "Key facts statement", /key facts? statement/i],
  ["sanction", "Sanction letter", /sanction letter|letter of sanction|pleased to (?:inform|sanction)|in-?principle sanction/i],
  ["statement", "Loan statement", /statement of account|loan (?:account )?statement|account statement/i],
  ["agreement", "Loan agreement", /loan agreement|agreement for (?:loan|finance)|hypothecation agreement/i],
  ["noc", "No-dues letter", /no[\s-]?dues|no objection certificate|loan closure letter/i],
  ["insurance", "Insurance document", /insurance policy|certificate of insurance/i],
];
const KINDS = [
  ["home", /home loan|housing loan|loan against property|mortgage/i],
  ["car", /car loan|auto loan|vehicle loan|two[\s-]?wheeler/i],
  ["education", /education loan|student loan/i],
  ["gold", /gold loan/i],
  ["business", /business loan|msme|working capital|term loan to/i],
  ["card", /credit card/i],
  ["personal", /personal loan|consumer (?:durable )?loan/i],
];

/** The document's type, from its words. A table of instalments wins when one was found. */
function docTypeOf(text, hasSchedule = false) {
  const head = String(text || "").slice(0, 4000);
  const hit = DOC_TYPES.find(([, , re]) => re.test(head));
  if (hit) return { id: hit[0], label: hit[1] };
  if (hasSchedule) return { id: "schedule", label: "Repayment schedule" };
  return { id: "other", label: "Loan document" };
}

/**
 * @returns { fields: { name: { value, line } }, terms: [{ title, quote }], accountLast4 }
 */
function fieldsOf(text) {
  const lines = String(text || "").split(/\r?\n/).map(clean).filter(Boolean).slice(0, 8000);
  const fields = {};
  const put = (k, value, line) => {
    if (value !== null && value !== undefined && value !== "" && !fields[k]) fields[k] = { value, line: redact(line).text.slice(0, 220) };
  };
  const top = lines.slice(0, 60).join(" \n ");
  const known = LENDERS.map((n) => ({ n, at: top.search(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\&]/g, "\\$&")}\\b`, "i")) })).filter((x) => x.at >= 0).sort((a, b) => a.at - b.at || b.n.length - a.n.length)[0];
  if (known) put("lender", known.n, lines.find((l) => new RegExp(known.n.replace(/[.*+?^${}()|[\]\\&]/g, "\\$&"), "i").test(l)) || known.n);
  else {
    const named = lines.slice(0, 12).find((l) => /\b(bank|finance|financial|capital|housing|finserv|credit)\b/i.test(l) && l.length < 90);
    if (named) put("lender", named.replace(/\s*[-–|(].*$/, "").slice(0, 60), named);
  }
  // the details written as words: from the lines as they are, where a wide gap still shows between a label and its value
  for (const rawLine of String(text || "").split(/\r?\n/).slice(0, 8000)) {
    // a line that begins with a date is a transaction in a statement, not a statement of terms
    const dated = findDate(rawLine);
    if (rawLine.length > 400 || (dated && dated.at < 8)) continue;
    for (const [k, re] of Object.entries(MORE_WORDS)) {
      if (fields[k]) continue;
      const m = re.exec(rawLine);
      if (!m) continue;
      const value = redact(clean(m[1]).replace(/^[:\-–|\s]+/, "").replace(/[|\s]+$/, "")).text.slice(0, 200);
      if (value.length >= 2 && /[A-Za-z0-9]/.test(value)) put(k, value, clean(rawLine));
    }
  }
  // a label at the end of a line takes its value from the next one (a two-column page read row by row)
  const joined = lines.map((l, i) => (/[:\-–]\s*$/.test(l) && lines[i + 1] ? `${l} ${lines[i + 1]}` : l));
  for (const line of joined) {
    for (const [k, re] of Object.entries(PATTERNS)) {
      const m = re.exec(line);
      if (!m) continue;
      const v = toNumber(m[1], m[2]);
      const floor = k === "loanAmount" || k === "outstanding" ? 1000 : k === "emiAmount" ? 100 : 1;
      if (v !== null && v >= floor && v <= 1e10) put(k, v, line);
    }
    const rm = RATE.exec(line);
    if (rm && Number(rm[1]) > 0 && Number(rm[1]) <= 60) {
      put("rate", Number(rm[1]), line);
      const t = /floating|variable|repo|rllr|mclr|eblr/i.test(line) ? "floating" : /fixed/i.test(line) ? "fixed" : "";
      if (t) put("rateType", t, line);
    }
    for (const [k, re] of Object.entries(MORE_MONEY)) {
      const m = re.exec(line);
      const v = m && toNumber(m[1], m[2]);
      if (typeof v === "number" && v >= (k === "overdueAmount" ? 0 : 1) && v <= 1e10) put(k, v, line);
    }
    for (const [k, re] of Object.entries(MORE_DATES)) {
      const m = re.exec(line);
      const d = m && findDate(m[1]);
      if (d && d.at <= 6) put(k, d.date, line);
    }
    for (const [k, re] of Object.entries(MORE_COUNTS)) {
      const m = re.exec(line);
      if (m && Number(m[1]) <= 600) put(k, Number(m[1]), line);
    }
    const am = APR.exec(line);
    if (am && Number(am[1]) > 0 && Number(am[1]) <= 60) put("apr", Number(am[1]), line);
    const tm = NOT_TENURE.test(line) ? null : TENURE.exec(line);
    if (tm) {
      const n = Number(tm[1]) * (/^y/i.test(tm[2] || "") ? 12 : 1);
      if (n >= 1 && n <= 600) put("tenureMonths", n, line);
    }
    for (const [k, re] of Object.entries(DATES)) {
      const m = re.exec(line);
      const d = m && findDate(m[1]);
      if (d && d.at <= 6) put(k, d.date, line);
    }
    const dm = EMI_DAY.exec(line);
    if (dm && Number(dm[1]) >= 1 && Number(dm[1]) <= 31) put("emiDay", Number(dm[1]), line);
  }
  if (!fields.rate && fields.apr) fields.rate = fields.apr; // only an APR is written: it stands in, as before
  const acct = joined.map((l) => ACCOUNT.exec(l)).find(Boolean);
  const accountLast4 = acct ? acct[1].replace(/[^A-Z0-9]/gi, "").slice(-4) : "";
  const kind = KINDS.find(([, re]) => re.test(top)) || KINDS.find(([, re]) => re.test(String(text).slice(0, 8000)));
  if (kind) put("kind", kind[0], lines.find((l) => kind[1].test(l)) || "");
  const terms = [];
  const seen = new Set();
  for (const line of lines) {
    if (line.length < 14 || findDate(line)) continue;
    const hit = TERMS.find(([, re]) => re.test(line));
    if (!hit || terms.filter((t) => t.title === hit[0]).length >= 3) continue;
    const quote = redact(line).text.slice(0, 260);
    if (seen.has(quote)) continue;
    seen.add(quote);
    terms.push({ title: hit[0], quote });
    if (terms.length >= 14) break;
  }
  return { fields, terms, accountLast4 };
}

/* ------------------------------------------------------------ the payments a statement shows */
const PAID_WORDS = /received|receipt|re-?paid|repayment|payment|\bpaid\b|cleared|realis|realiz|credit(?!\s*card)|\bcr\b|auto[\s-]?debit/i;
const UNDONE_WORDS = /bounce|returned|\breturn\b|dishono|revers|reject|\bunpaid\b|not (?:paid|received|cleared)/i;
const NOT_AN_EMI = /\bdue\b|charge|penal|\bfee|disburs|part[\s-]?(?:pre[\s-]?)?pay|pre[\s-]?pay|pre[\s-]?clos|foreclos|insurance|processing|opening balance|closing balance/i;

/**
 * Lines of a loan statement that record money received (or a receipt undone): their date and the amounts on them. Which of
 * them is an EMI is decided against the EMI amount, when the documents are joined.
 */
function receiptsOf(text) {
  const out = [];
  for (const line of String(text || "").split(/\r?\n/).slice(0, 8000)) {
    if (line.length > 300) continue;
    const undone = UNDONE_WORDS.test(line);
    if (!undone && (!PAID_WORDS.test(line) || NOT_AN_EMI.test(line))) continue;
    const d = findDate(line);
    if (!d) continue;
    const rest = `${line.slice(0, d.at)} ${line.slice(d.at + d.length)}`;
    const amounts = (rest.match(/(?<![\w.\/\-])(?:\d{1,3}(?:,\d{2,3})+|\d{3,9})(?:\.\d{1,2})?(?![\w\/\-]|\.\d)/g) || []).map((x) => Number(x.replace(/,/g, ""))).filter((x) => x >= 100);
    if (amounts.length) out.push({ date: d.date, amounts: amounts.slice(0, 6), undone });
    if (out.length >= 700) break;
  }
  return out;
}

/* ---------------------------------------------------------------- blanking who it is about */
const BLANKS = [
  ["email", /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]"],
  ["pan", /\b[A-Z]{5}\d{4}[A-Z]\b/g, "[PAN]"],
  ["ifsc", /\b[A-Z]{4}0[A-Z0-9]{6}\b/g, "[IFSC]"],
  ["aadhaar", /\b\d{4}[ -]\d{4}[ -]\d{4}\b/g, "[ID number]"],
  ["masked", /\b(?:[X*]{4,}[ -]?)+\d{2,6}\b/gi, "[number]"],
  ["reference", /\b(?=[A-Z0-9\-\/]*\d{5})[A-Z]{2,}[A-Z0-9\-\/]{4,}\b/g, "[number]"],
  // eight or more digits in a row (an account, a phone): amounts are written with commas, paise or fewer digits
  ["digits", /(?<![\d,.])(?:\+?91[ -]?)?\d{8,}(?![\d,]|\.\d)/g, "[number]"],
];
const LABELLED = /\b(customer name|borrower(?:'s)? name|name of (?:the )?(?:borrower|customer|applicant)|co[\s-]?(?:borrower|applicant)(?: name)?|borrowers?|applicant(?: name)?|guarantor(?: name)?|name|father(?:'s)? name|nominee(?: name)?|address|communication address|property address|date of birth|dob|mobile(?: no\.?)?|phone(?: no\.?)?|contact(?: no\.?)?)\s*[:\-–]\s*(.+?)(?=\s{2,}|\s*\|\s*|$)/gi;

/**
 * Identity numbers, contacts and the values after name and address labels, blanked. Names written elsewhere in running text
 * can remain: the page says so.
 * @returns { text, count }
 */
function redact(text) {
  let count = 0;
  let out = String(text || "")
    .split(/\r?\n/)
    .map((line, i, all) => {
      let l = line.replace(LABELLED, (m, label) => {
        count += 1;
        return `${label}: [removed]`;
      });
      // "Dear Mr Somebody," names the person too
      l = l.replace(/\b(Dear)\s+(?:(?:Mr|Mrs|Ms|Shri|Smt|Dr)\.?\s+)?[A-Z][A-Za-z.]*(?:\s+[A-Z][A-Za-z.]*){0,3}\s*,/g, (m, d) => {
        count += 1;
        return `${d} Customer,`;
      });
      // the lines under an "Address" label carry on the address until a pin code or an empty line
      if (i > 0 && /\baddress\s*[:\-–]/i.test(all[i - 1]) && !/[:%]/.test(line) && line.length < 80) {
        count += 1;
        return "[removed]";
      }
      return l;
    })
    .join("\n");
  for (const [, re, to] of BLANKS) {
    out = out.replace(re, () => {
      count += 1;
      return to;
    });
  }
  return { text: out, count };
}

module.exports = { fieldsOf, docTypeOf, redact, receiptsOf, LENDERS };
