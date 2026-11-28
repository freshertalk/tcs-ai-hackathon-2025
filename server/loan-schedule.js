"use strict";
// Reading a lender's repayment (amortisation) schedule (28 Nov 2026) — from the rows of a PDF, an Excel sheet or a CSV —
// into one line an instalment: date, EMI, principal, interest, balance. Pure arithmetic: no AI, no network.
//
//   WHICH COLUMN IS WHICH is decided by the sums, not by the headings (every lender words them differently):
//     · three amounts where one is the other two added: the EMI, and its principal and interest
//     · a balance that falls by one of them each line: that one is the principal (the balance may be before or after)
//     · principal and interest told apart, when there is no balance, by which grows: in a reducing loan, principal does
//   WHEN THE LENDER DOES NOT SPLIT IT, the desk works the split out and says so:
//     · from the balance: principal = the fall in the balance, interest = the EMI less that
//     · from the EMI alone: from the loan amount and the yearly rate (month by month on the reducing balance); a rate
//       not given is found from the amount and the instalments themselves
//   EVERY SCHEDULE IS CHECKED line by line (EMI = principal + interest, the balance carries on) and the result of the check
//   is shown before anything is saved.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const r2 = (x) => Math.round(x * 100) / 100;
const MAX_ROWS = 600;

/* ---------------------------------------------------------------- dates */
const yearOf = (y) => (y < 100 ? (y < 70 ? 2000 + y : 1900 + y) : y);
const iso = (y, m, d) => {
  if (!(y >= 1980 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > last) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};
const MON = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*";
// the order matters: the fuller forms first
const DATE_FORMS = [
  { re: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, to: (m) => iso(+m[1], +m[2], +m[3]) },
  { re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of\\b)?[\\s\\-\\/.]*${MON}\\.?[\\s\\-\\/.,']*(\\d{4}|\\d{2})\\b`, "i"), to: (m) => iso(yearOf(+m[3]), monthNo(m[2]), +m[1]) },
  { re: new RegExp(`\\b${MON}\\.?[\\s\\-]+(\\d{1,2})(?:st|nd|rd|th)?,?[\\s\\-]+(\\d{4})\\b`, "i"), to: (m) => iso(+m[3], monthNo(m[1]), +m[2]) },
  { re: /\b(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4}|\d{2})\b/, to: (m) => iso(yearOf(+m[3]), +m[2], +m[1]) || iso(yearOf(+m[3]), +m[1], +m[2]) },
  { re: new RegExp(`\\b${MON}\\.?[\\s\\-\\/.']*(\\d{4}|\\d{2})\\b`, "i"), to: (m) => iso(yearOf(+m[2]), monthNo(m[1]), 1), monthOnly: true },
];
function monthNo(word) {
  return MONTHS.indexOf(String(word).slice(0, 3).toLowerCase()) + 1;
}
/** The first date in a piece of text: { date, at, length, monthOnly } or null. */
function findDate(text) {
  let best = null;
  for (const f of DATE_FORMS) {
    const m = f.re.exec(text);
    if (!m) continue;
    const date = f.to(m);
    if (!date) continue;
    if (!best || m.index < best.at) best = { date, at: m.index, length: m[0].length, monthOnly: Boolean(f.monthOnly) };
  }
  return best;
}

/* ---------------------------------------------------------------- one line */
const NUMBER = /^[(\-+]?(?:₹|rs\.?|inr)?\s?(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d+)?\)?(?:\s?%|\s?(?:cr|dr))?[)]?$/i;
/** "15,00,000.00" → 1500000; "(1,234)" → -1234; "8.5%" → { pct }. */
function numberOf(token) {
  const t = String(token).trim();
  if (!NUMBER.test(t)) return null;
  const pct = /%$/.test(t);
  const neg = /^\(.*\)$/.test(t) || /^-/.test(t);
  const v = Number(t.replace(/₹|rs\.?|inr|cr|dr|[(),%+\s-]/gi, ""));
  if (!Number.isFinite(v)) return null;
  return { v: neg ? -v : v, pct, whole: !/\./.test(t) };
}

/**
 * One row of cells → { date, monthOnly, nums } when it looks like an instalment line (one date, one or more numbers).
 * Words between them ("Paid", "EMI") are passed over; a line that is mostly words is not one.
 */
function lineOf(cells) {
  const text = cells.join("   ").replace(/\s*\|\s*/g, "   ");
  const first = findDate(text);
  if (!first) return null;
  // the first date is the instalment's; any other (a value date, a payment date) is taken out too
  let rest = `${text.slice(0, first.at)} \u0001 ${text.slice(first.at + first.length)}`;
  for (let i = 0; i < 4; i += 1) {
    const more = findDate(rest);
    if (!more) break;
    rest = `${rest.slice(0, more.at)} ${rest.slice(more.at + more.length)}`;
  }
  rest = rest.replace(/(₹|\bRs\.?|\bINR)\s+(?=\d)/gi, "");
  const parts = rest.split(/\s+/).filter(Boolean);
  const nums = [];
  let words = 0;
  let seen = false;
  for (const p of parts) {
    if (p === "\u0001") {
      seen = true;
      continue;
    }
    const n = numberOf(p);
    if (n) nums.push({ ...n, beforeDate: !seen });
    else if (/[a-z]{3,}/i.test(p)) words += 1;
  }
  if (!nums.length || words > 4) return null;
  return { date: first.date, monthOnly: first.monthOnly, nums };
}

/* ---------------------------------------------------------------- Excel */
/** Excel keeps a date as a number: columns of rising day numbers become dates, long decimals become paise. */
function fromSheet(rows) {
  const serial = (c) => /^\d{5}(\.\d+)?$/.test(c) && Number(c) >= 29221 && Number(c) <= 73051; // 1980 … 2100
  const width = Math.max(0, ...rows.map((r) => r.length));
  const dateCols = new Set();
  for (let c = 0; c < width; c += 1) {
    const values = rows.map((r) => String(r[c] === undefined ? "" : r[c]).trim()).filter(serial).map(Number);
    if (values.length < 2) continue;
    // instalment dates rise by about a month each line
    let steps = 0;
    for (let i = 1; i < values.length; i += 1) {
      const d = values[i] - values[i - 1];
      if (d >= 1 && d <= 95) steps += 1;
    }
    const wholes = values.filter((v) => Number.isInteger(v)).length;
    if (steps >= (values.length - 1) * 0.8 && wholes >= values.length * 0.9) dateCols.add(c);
  }
  return rows.map((r) =>
    r.map((cell, c) => {
      const s = String(cell === undefined || cell === null ? "" : cell).trim();
      if (dateCols.has(c) && serial(s)) {
        const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000).toISOString().slice(0, 10);
        return `${d.slice(8)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
      }
      if (/^-?\d+\.\d{3,}(e-?\d+)?$/i.test(s)) {
        const v = Number(s);
        // a rate kept as a fraction (0.0925) stays as it is; money is rounded to paise
        return Math.abs(v) < 1 ? s : String(r2(v));
      }
      return s;
    })
  );
}

/* ---------------------------------------------------------------- the columns */
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const share = (list, ok) => (list.length ? list.filter(ok).length / list.length : 0);
const tolOf = (v) => Math.max(1.5, Math.abs(v) * 0.0005);
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? tolOf(Math.max(Math.abs(a), Math.abs(b))) : tol);

/** Take out the columns that are not money: the instalment number, a count of days, the rate. */
function classify(lines, k) {
  const cols = Array.from({ length: k }, (_, c) => lines.map((l) => l.nums[c]));
  const out = { amounts: [], rate: -1, number: -1 };
  cols.forEach((col, c) => {
    const v = col.map((x) => x.v);
    const whole = share(col, (x) => x.whole && !x.pct);
    if (whole === 1 && v.length > 1 && share(v.slice(1).map((x, i) => x - v[i]), (d) => d === 1) >= 0.85 && Math.max(...v) <= 1000) {
      if (out.number < 0) out.number = c;
      return;
    }
    if (whole === 1 && v.length === 1 && v[0] <= 600 && col[0].beforeDate) {
      out.number = c;
      return;
    }
    const pct = share(col, (x) => x.pct) > 0.8;
    const small = share(v, (x) => x > 0 && x < 50) > 0.95;
    if (pct || (small && new Set(v).size <= Math.max(3, v.length * 0.1) && k > 2)) {
      out.rate = c;
      return;
    }
    // a count of days between instalments: small whole numbers
    if (whole === 1 && share(v, (x) => x >= 0 && x <= 95) === 1 && k > 2) return;
    out.amounts.push(c);
  });
  return out;
}

/** The balance column that falls by column `p`: { col, type: "closing" | "opening", score } or null. */
function balanceFor(M, p, taken) {
  let best = null;
  const n = M.length;
  if (n < 2) return null;
  for (let b = 0; b < M[0].length; b += 1) {
    if (b === p || taken.includes(b)) continue;
    const pairs = Array.from({ length: n - 1 }, (_, i) => i + 1);
    // after the instalment: balance[i-1] − principal[i] = balance[i]
    const closing = share(pairs, (i) => near(M[i - 1][b] - M[i][p], M[i][b]));
    // before the instalment: balance[i] − principal[i] = balance[i+1]
    const opening = share(pairs, (i) => near(M[i - 1][b] - M[i - 1][p], M[i][b]));
    const type = closing >= opening ? "closing" : "opening";
    const score = Math.max(closing, opening);
    if (score >= 0.8 && (!best || score > best.score)) best = { col: b, type, score };
  }
  return best;
}

const falling = (v) => share(v.slice(1).map((x, i) => x - v[i]), (d) => d <= 0.01) >= 0.9 && v[0] > v[v.length - 1];
const rising = (v) => share(v.slice(1).map((x, i) => x - v[i]), (d) => d >= -0.01) >= 0.85 && v[v.length - 1] > v[0];
const steady = (v) => {
  const m = median(v);
  return m > 0 && share(v, (x) => near(x, m, Math.max(2, m * 0.01))) >= 0.75;
};

/**
 * Decide the columns of the money matrix M (rows × columns).
 * @returns { emi, principal, interest, balance, balanceType, how } with -1 for a column not there, or null
 */
function rolesOf(M) {
  const m = M[0].length;
  const col = (c) => M.map((r) => r[c]);
  // 1) an amount that is two others added, on nearly every line
  const triples = [];
  for (let e = 0; e < m; e += 1) {
    for (let a = 0; a < m; a += 1) {
      for (let b = a + 1; b < m; b += 1) {
        if (e === a || e === b) continue;
        const score = share(M, (r) => near(r[e], r[a] + r[b]) && r[a] >= -0.01 && r[b] >= -0.01);
        if (score >= 0.85 && share(M, (r) => r[a] > 0 || r[b] > 0) > 0.9) triples.push({ e, a, b, score });
      }
    }
  }
  if (triples.length) {
    // an opening balance = principal + closing balance is also "two added": the true triple is the one whose parts are a
    // principal a balance falls by, or whose total stays level like an EMI
    const judged = triples.map((t) => {
      const viaA = balanceFor(M, t.a, [t.e, t.b]);
      const viaB = balanceFor(M, t.b, [t.e, t.a]);
      const bal = viaA && (!viaB || viaA.score >= viaB.score) ? { ...viaA, principal: t.a, interest: t.b } : viaB ? { ...viaB, principal: t.b, interest: t.a } : null;
      return { ...t, bal, rank: t.score + (steady(col(t.e)) ? 2 : 0) + (bal ? 1 + bal.score : 0) };
    });
    judged.sort((x, y) => y.rank - x.rank);
    const t = judged[0];
    let principal;
    let interest;
    if (t.bal) {
      principal = t.bal.principal;
      interest = t.bal.interest;
    } else {
      const aUp = rising(col(t.a));
      principal = aUp || falling(col(t.b)) ? t.a : t.b;
      interest = principal === t.a ? t.b : t.a;
    }
    return { emi: t.e, principal, interest, balance: t.bal ? t.bal.col : -1, balanceType: t.bal ? t.bal.type : "none", how: "lender" };
  }
  // 2) a balance that falls by one column: that is the principal; beside it the interest or the EMI
  let found = null;
  for (let p = 0; p < m; p += 1) {
    const bal = balanceFor(M, p, []);
    if (bal && (!found || bal.score > found.bal.score) && share(M, (r) => r[p] >= 0 && r[p] < r[bal.col] + r[p] + 1) > 0.9 && median(col(p)) < median(col(bal.col))) found = { p, bal };
  }
  if (found) {
    const rest = Array.from({ length: m }, (_, c) => c).filter((c) => c !== found.p && c !== found.bal.col);
    const emi = rest.find((c) => steady(col(c)) && share(M, (r) => r[c] + 1.5 >= r[found.p]) > 0.9);
    if (emi !== undefined) return { emi, principal: found.p, interest: -1, balance: found.bal.col, balanceType: found.bal.type, how: "lender" };
    const interest = rest.find((c) => share(M, (r) => r[c] >= 0 && r[c] < r[found.bal.col] + 1) > 0.9);
    return { emi: -1, principal: found.p, interest: interest === undefined ? -1 : interest, balance: found.bal.col, balanceType: found.bal.type, how: "lender" };
  }
  // 3) principal and interest side by side with nothing to add them to: one grows, one shrinks, the sum is level
  for (let a = 0; a < m; a += 1) {
    for (let b = 0; b < m; b += 1) {
      if (a === b) continue;
      if (rising(col(a)) && falling(col(b)) && steady(M.map((r) => r[a] + r[b]))) return { emi: -1, principal: a, interest: b, balance: -1, balanceType: "none", how: "lender" };
    }
  }
  // 3b) a level instalment with ONE of its parts beside it (interest falls, principal grows): the other is the rest
  for (let e = 0; e < m; e += 1) {
    if (!steady(col(e))) continue;
    for (let o = 0; o < m; o += 1) {
      if (o === e || steady(col(o)) || median(col(o)) >= median(col(e)) || share(M, (r) => r[o] >= -0.01 && r[o] <= r[e] + 1.5) < 0.95) continue;
      if (falling(col(o))) return { emi: e, principal: -1, interest: o, balance: -1, balanceType: "none", how: "lender" };
      if (rising(col(o))) return { emi: e, principal: o, interest: -1, balance: -1, balanceType: "none", how: "lender" };
    }
  }
  // 4) a level instalment, and perhaps a falling balance beside it
  const level = Array.from({ length: m }, (_, c) => c).filter((c) => steady(col(c)));
  const balances = Array.from({ length: m }, (_, c) => c).filter((c) => falling(col(c)) && !steady(col(c)));
  const bal = balances.sort((a, b) => median(col(b)) - median(col(a)))[0];
  const emi = level.filter((c) => c !== bal).sort((a, b) => median(col(a)) - median(col(b)))[0];
  if (emi !== undefined && bal !== undefined && median(col(bal)) > median(col(emi))) {
    // before or after the instalment: an "after" balance ends at nothing
    const lastBal = col(bal)[M.length - 1];
    return { emi, principal: -1, interest: -1, balance: bal, balanceType: lastBal < median(col(emi)) * 0.5 ? "closing" : "opening", how: "balance" };
  }
  if (emi !== undefined) return { emi, principal: -1, interest: -1, balance: -1, balanceType: "none", how: "computed" };
  if (m === 1) return { emi: 0, principal: -1, interest: -1, balance: -1, balanceType: "none", how: "computed" };
  return null;
}

/* ---------------------------------------------------------------- working the split out */
/**
 * The yearly rate at which `emis` repay `amount` exactly (month by month on the reducing balance), by halving.
 * @returns percent, or null when no rate from 0 to 100 % does
 */
function rateFor(amount, emis) {
  const left = (annual) => {
    let b = amount;
    for (const e of emis) b = b + (b * annual) / 1200 - e;
    return b;
  };
  const tol = Math.max(1, amount * 0.002);
  if (left(0) > tol) return null; // even with no interest the instalments do not repay it: the schedule is not the whole loan
  if (left(100) < -tol) return null;
  let lo = 0;
  let hi = 100;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (left(mid) > 0) hi = mid;
    else lo = mid;
  }
  return Math.round(lo * 100) / 100;
}
/** The loan amount that `emis` repay at `annual` percent: what the instalments are worth today. */
function amountFor(annual, emis) {
  let v = 0;
  for (let i = emis.length - 1; i >= 0; i -= 1) v = (v + emis[i]) / (1 + annual / 1200);
  return r2(v);
}

/**
 * Principal and interest for instalments that come without them: month by month on the reducing balance.
 * The last line takes up the paise left over when it all but clears the loan.
 */
function splitByRate(list, amount, annual) {
  let bal = amount;
  return list.map((x, i) => {
    const interest = r2(Math.min(x.emi, (bal * annual) / 1200));
    let principal = r2(Math.min(bal, Math.max(0, x.emi - interest)));
    const last = i === list.length - 1;
    if (last && bal - principal > 0 && bal - principal <= Math.max(50, x.emi * 0.05)) principal = r2(bal);
    bal = r2(bal - principal);
    return { ...x, principal, interest: r2(Math.max(0, x.emi - principal)), closing: bal };
  });
}

/* ---------------------------------------------------------------- the whole reading */
const HEADINGS = { principal: /princip|prin\.|\bpri\b/i, interest: /interest|\bint\b|int\./i };

/**
 * @param rows  rows of cells (strings), in the document's order
 * @param hint  { amount, rate } from the loan or the document's words, used only where the schedule needs them
 * @param roles forced columns (from the AI's reading of the headings), checked like any other
 * @returns { found: false, reason, candidates } or
 *          { found: true, how: "lender" | "balance" | "computed", rows: [{ no, date, emi, principal, interest, closing }],
 *            amount, rate, needs: [] , checks: { lines, addUp, carry, cleared }, warnings, columns, sample }
 */
function parseSchedule(rows, { hint = {}, roles: forced = null } = {}) {
  const lines = [];
  for (const cells of rows) {
    const l = lineOf(cells);
    if (l) lines.push(l);
    if (lines.length > 4000) break;
  }
  if (lines.length < 2) return { found: false, reason: "No instalment lines (a date and amounts) were found.", candidates: lines.length };
  // the schedule is the largest family of lines with the same number of figures
  const families = new Map();
  for (const l of lines) families.set(l.nums.length, [...(families.get(l.nums.length) || []), l]);
  const weight = ([k, list]) => list.length * Math.min(k + 1, 4);
  const ranked = [...families.entries()].sort((a, b) => weight(b) - weight(a));
  for (const [k, list] of ranked.slice(0, 4)) {
    const out = readFamily(rows, lines, k, list, hint, forced);
    if (out) return out;
  }
  return { found: false, reason: "The lines with dates and amounts do not add up like a repayment schedule.", candidates: lines.length };
}

function readFamily(rows, allLines, k, family, hint, forced) {
  // dates must run forward: a stray dated line (a statement's own date) is left out
  const ordered = [];
  for (const l of family) {
    const prev = ordered[ordered.length - 1];
    if (!prev || l.date >= prev.date) ordered.push(l);
    else if (ordered.length === 1) ordered[0] = l;
  }
  if (ordered.length < 2) return null;
  const span = (Date.parse(ordered[ordered.length - 1].date) - Date.parse(ordered[0].date)) / 86400000;
  if (span < 20) return null;
  const kinds = classify(ordered, k);
  if (!kinds.amounts.length) return null;
  const M = ordered.map((l) => kinds.amounts.map((c) => l.nums[c].v));
  const roles = forced || rolesOf(M);
  if (!roles) return null;
  const at = (i, c) => (c >= 0 && c < M[i].length ? M[i][c] : null);
  const warnings = [];
  let list = ordered.map((l, i) => {
    let emi = at(i, roles.emi);
    const principal = at(i, roles.principal);
    const interest = at(i, roles.interest);
    const balance = at(i, roles.balance);
    if (emi === null && principal !== null && interest !== null) emi = r2(principal + interest);
    return { no: kinds.number >= 0 ? l.nums[kinds.number].v : i + 1, date: l.date, monthOnly: l.monthOnly, emi, principal, interest, balance, rate: kinds.rate >= 0 ? l.nums[kinds.rate].v : null };
  });
  // a line with nothing due (a disbursement, an opening line) is not an instalment
  const opening = list.find((x) => !(x.emi > 0) && x.balance > 0);
  list = list.filter((x) => (x.emi || 0) > 0 || (x.principal || 0) > 0 || (x.interest || 0) > 0);
  if (list.length < 2) return null;

  let amount = null;
  let rate = Number.isFinite(hint.rate) ? hint.rate : null;
  const sheetRate = list.map((x) => x.rate).filter((v) => v > 0);
  if (sheetRate.length) rate = sheetRate[0] < 1 ? r2(sheetRate[0] * 100) : sheetRate[0];
  let how = roles.how;
  const needs = [];

  if (roles.principal < 0 && roles.interest >= 0 && roles.emi >= 0) list = list.map((x) => ({ ...x, principal: r2(Math.max(0, x.emi - x.interest)) }));
  if (roles.principal >= 0 || (roles.interest >= 0 && roles.emi >= 0)) {
    list = list.map((x) => {
      const interest = x.interest !== null ? x.interest : x.emi !== null ? r2(Math.max(0, x.emi - x.principal)) : 0;
      return { ...x, interest, emi: x.emi !== null ? x.emi : r2(x.principal + interest) };
    });
    if (roles.balance >= 0) {
      amount = roles.balanceType === "opening" ? list[0].balance : r2(list[0].balance + list[0].principal);
      list = list.map((x) => ({ ...x, closing: roles.balanceType === "opening" ? r2(x.balance - x.principal) : x.balance }));
    } else {
      const total = r2(list.reduce((a, x) => a + x.principal, 0));
      // the loan amount when the document says it and the principal lines fit inside it; else what the lines add up to
      amount = Number.isFinite(hint.amount) && hint.amount >= total - 1 ? hint.amount : total;
      let bal = amount;
      list = list.map((x) => {
        bal = r2(bal - x.principal);
        return { ...x, closing: Math.max(0, bal) };
      });
      warnings.push("The schedule shows no balance: it is counted down from the loan amount.");
    }
  } else if (roles.balance >= 0) {
    // the split from the fall of the balance
    how = "balance";
    let before;
    if (roles.balanceType === "opening") before = list.map((x) => x.balance);
    else {
      const startGuess = opening ? opening.balance : Number.isFinite(hint.amount) && hint.amount > list[0].balance && hint.amount - list[0].balance <= list[0].emi + 1 ? hint.amount : null;
      const r = rate !== null ? rate : null;
      // without the opening figure: the second line's interest is a month on the first balance, which gives the monthly rate,
      // and the opening is what that rate turns into the first balance and the first instalment
      const i2 = list.length > 1 ? list[1].emi - (list[0].balance - list[1].balance) : 0;
      const monthly = r !== null ? r / 1200 : list[0].balance > 0 && i2 > 0 && i2 < list[0].balance * 0.05 ? i2 / list[0].balance : 0;
      const start = startGuess !== null ? startGuess : r2((list[0].balance + list[0].emi) / (1 + monthly));
      before = list.map((x, i) => (i === 0 ? start : list[i - 1].balance));
    }
    amount = before[0];
    list = list.map((x, i) => {
      const after = roles.balanceType === "closing" ? x.balance : i + 1 < list.length ? list[i + 1].balance : Math.max(0, r2(x.balance - (x.emi - (x.balance * (rate || 0)) / 1200)));
      const principal = r2(Math.max(0, Math.min(x.emi, before[i] - after)));
      return { ...x, principal, interest: r2(Math.max(0, x.emi - principal)), closing: r2(after) };
    });
    if (rate === null && list.length > 1) {
      const rates = list.slice(1).map((x, i) => (x.interest / list[i].closing) * 1200).filter((v) => v > 0 && v < 60);
      if (rates.length) rate = r2(median(rates));
    }
  } else {
    // only the instalments: the loan amount and the rate make the split
    how = "computed";
    const emis = list.map((x) => x.emi);
    amount = Number.isFinite(hint.amount) ? hint.amount : null;
    if (amount !== null && rate === null) rate = rateFor(amount, emis);
    if (amount === null && rate !== null) amount = amountFor(rate, emis);
    if (amount === null || rate === null) {
      if (amount === null) needs.push("amount");
      if (rate === null) needs.push("rate");
      list = list.map((x) => ({ ...x, principal: null, interest: null, closing: null }));
    } else list = splitByRate(list, amount, rate);
  }
  if (rate === null && list[0].interest > 0 && amount > 0) {
    const est = r2((list[1] && list[0].closing > 0 ? list[1].interest / list[0].closing : list[0].interest / amount) * 1200);
    if (est > 0 && est < 60) rate = est;
  }

  const clean = list.slice(0, MAX_ROWS).map((x, i) => ({ no: Number.isFinite(x.no) ? x.no : i + 1, date: x.date, emi: r2(x.emi), principal: x.principal === null ? null : r2(x.principal), interest: x.interest === null ? null : r2(x.interest), closing: x.closing === null || x.closing === undefined ? null : r2(Math.max(0, x.closing)), rate: x.rate && x.rate >= 1 ? x.rate : null }));
  if (list.length > MAX_ROWS) warnings.push(`Only the first ${MAX_ROWS} instalments were kept.`);
  if (list.some((x) => x.monthOnly)) warnings.push("The schedule gives months without days: the 1st is used until you set the EMI day.");
  const withSplit = clean.filter((x) => x.principal !== null);
  const addUp = withSplit.filter((x) => near(x.emi, x.principal + x.interest)).length;
  const carry = withSplit.slice(1).filter((x, i) => near(withSplit[i].closing - x.principal, x.closing)).length;
  const cleared = withSplit.length ? withSplit[withSplit.length - 1].closing <= Math.max(5, clean[0].emi * 0.05) : false;
  if (withSplit.length && addUp < withSplit.length) warnings.push(`${withSplit.length - addUp} line(s) where principal + interest is not the EMI: check them before saving.`);
  if (withSplit.length > 1 && carry < withSplit.length - 1) warnings.push(`${withSplit.length - 1 - carry} line(s) where the balance does not carry on (a part-payment, a rate change, or a line that was not read).`);
  if (withSplit.length && !cleared) warnings.push("The schedule does not run down to zero: it may be only part of the loan, or a page was not read.");
  // months must follow one another; a gap often means a page was missed
  let gaps = 0;
  for (let i = 1; i < clean.length; i += 1) if (Date.parse(clean[i].date) - Date.parse(clean[i - 1].date) > 75 * 86400000) gaps += 1;
  if (gaps) warnings.push(`${gaps} gap(s) of more than two months between instalments.`);
  if (allLines.length - ordered.length > Math.max(6, ordered.length * 0.2)) warnings.push(`${allLines.length - ordered.length} other dated lines were not part of the table.`);
  const totals = { emi: r2(clean.reduce((a, x) => a + x.emi, 0)), principal: withSplit.length ? r2(withSplit.reduce((a, x) => a + x.principal, 0)) : null, interest: withSplit.length ? r2(withSplit.reduce((a, x) => a + x.interest, 0)) : null };
  return {
    found: true,
    how,
    needs,
    rows: clean,
    amount: amount === null ? null : r2(amount),
    rate: rate === null ? null : Math.round(rate * 1000) / 1000,
    totals,
    checks: { lines: clean.length, split: withSplit.length, addUp, carry, carryOf: Math.max(0, withSplit.length - 1), cleared },
    warnings,
    columns: { count: M[0].length, ...roles },
    sample: ordered.slice(0, 8).map((l, i) => ({ date: l.date, values: M[i] })),
  };
}

module.exports = { parseSchedule, findDate, numberOf, lineOf, fromSheet, rolesOf, rateFor, amountFor, splitByRate, MAX_ROWS };
