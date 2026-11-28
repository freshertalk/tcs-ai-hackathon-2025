"use strict";
// Uploading a loan's documents (28 Nov 2026) — the owner: "upload whole repayment schedule of each loan one time … identify
// for which month how much is principal and how much is interest … other loan docs … the software should fetch all required
// details and no need to put me individually".
//
//   READ     the file is read here (loan-files.js): a repayment schedule into months of principal and interest
//            (loan-schedule.js), the loan's details from the document's own words (loan-fields.js). Nothing is saved.
//   AI       NVIDIA's FREE models fill what the words alone did not give, read pictures, and point out clauses
//            (ai/loandesk.js). They get blanked text; every figure they give is checked against the document.
//   REVIEW   the page shows what was found, where each figure came from, and the schedule's own checks.
//   SAVE     only when the owner presses Save: a new loan, or an existing one; the schedule if they keep it; the file
//            itself kept in the database (collection "loan_docs", read only when asked for, part of the backup).
// A password typed for a protected file is used for that reading only, and is not kept.

const crypto = require("node:crypto");
const { readLoanFile, readOrKeep, cleanName, LoanFileError } = require("./loan-files");
const { parseSchedule, findDate } = require("./loan-schedule");
const { fieldsOf, docTypeOf, redact } = require("./loan-fields");
const { LoanError, INSIGHT, simulate, usualEmi } = require("./loans");

const STORE = "loan_docs";
const TTL = 60 * 60 * 1000;
const MAX_PENDING = 8;
const MAX_DOCS = 40; // a loan
const TEXT_KEPT = 40000;

const r2 = (x) => Math.round(x * 100) / 100;
const num = (v) => {
  const n = Number(String(v === undefined || v === null ? "" : v).replace(/[₹,%\s]|rs\.?|inr/gi, ""));
  return String(v === undefined || v === null ? "" : v).trim() !== "" && Number.isFinite(n) ? n : null;
};

/** Does the document's own text hold this figure, date or name? What an AI read is only as good as this. */
function inText(key, value, text) {
  const flat = String(text).replace(/(\d),(?=\d)/g, "$1");
  if (key === "openingDate" || key === "firstEmiDate") {
    let rest = String(text);
    for (let i = 0; i < 400; i += 1) {
      const d = findDate(rest);
      if (!d) return false;
      if (d.date === value) return true;
      rest = rest.slice(d.at + d.length);
    }
    return false;
  }
  if (typeof value === "number") {
    const whole = Math.trunc(value);
    const re = value === whole ? new RegExp(`(?<![\\d.])${whole}(?:\\.0+)?(?![\\d])`) : new RegExp(`(?<![\\d.])${String(value).replace(".", "\\.")}0*(?![\\d])`);
    return re.test(flat);
  }
  const squash = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();
  return squash(text).includes(squash(value));
}

const LABELS = { lender: "Lender", kind: "Type", name: "Loan name", openingDate: "Opening date", totalAmount: "Total amount", rate: "Interest rate (% a year)", emiAmount: "EMI amount", firstEmiDate: "First EMI date", tenureMonths: "Tenure (months)", processingFee: "Processing fee", outstanding: "Outstanding stated" };
const KIND_WORDS = { home: "home loan", car: "car loan", personal: "personal loan", education: "education loan", gold: "gold loan", business: "business loan", card: "card EMI", other: "loan" };
const AI_KEYS = { lender: "lender", loanType: "kind", openingDate: "openingDate", loanAmount: "totalAmount", interestRate: "rate", tenureMonths: "tenureMonths", emiAmount: "emiAmount", firstEmiDate: "firstEmiDate", processingFee: "processingFee", outstanding: "outstanding" };

const SHORT_FORMS = /^(SBI|HDFC|ICICI|PNB|LIC|IDFC|IDBI|RBL|HSBC|DBS|AU|UCO|TVS|SMFG|L&T)$/;
function shortName(lender) {
  const s = String(lender || "").replace(/\b(private|pvt\.?|limited|ltd\.?)(?=\s|$|\.)/gi, "").replace(/[.,]+$/g, "").replace(/\s+/g, " ").trim();
  if (s !== s.toUpperCase()) return s;
  return s.split(" ").map((w) => (SHORT_FORMS.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase())).join(" ");
}

class LoanIntake {
  constructor({ loans, desk, docs, now = () => Date.now(), log = console }) {
    this.loans = loans;
    this.desk = desk;
    this.docs = docs;
    this.now = now;
    this.log = log;
    this.pending = new Map(); // token → what was read, waiting for the owner's Save
    if (loans) loans.aiStatus = () => (desk ? desk.status() : { ready: false, model: "", setup: "" });
  }

  _sweep() {
    for (const [k, p] of this.pending) if (this.now() - p.at > TTL) this.pending.delete(k);
    while (this.pending.size > MAX_PENDING) this.pending.delete(this.pending.keys().next().value);
  }

  _get(token, owner) {
    this._sweep();
    const p = this.pending.get(String(token || ""));
    if (!p || p.owner !== owner) throw new LoanError("That upload is no longer waiting (they are kept for an hour). Upload the file again.", "gone", 404);
    return p;
  }

  /* ------------------------------------------------------------------ reading */
  read(owner, name, buf, { password = "", loanId = "", keep = false } = {}) {
    const loan = loanId ? this.loans.get(loanId) : null;
    if (loan && loan.type === "cash") throw new LoanError("A cash loan from a person has no documents to read: enter its repayments by hand.");
    const file = readOrKeep(name, buf, { password, keep });
    const p = { owner, at: this.now(), loanId: loan ? loan.id : "", file, buf, ai: { done: false, model: "", error: "" }, hint: {}, aiValues: {}, aiTerms: [], aiSummary: "", aiWatch: [], forced: null, pictureRows: null };
    this._parse(p);
    const token = crypto.randomBytes(12).toString("hex");
    this.pending.set(token, p);
    this._sweep();
    return this.view(token, p);
  }

  /** What the words and the table give, again (after a hint from the owner or a reading from the AI). */
  _parse(p) {
    const loan = p.loanId ? this.loans.get(p.loanId) : null;
    const text = p.file.kind === "image" ? p.pictureText || "" : p.file.text;
    p.found = fieldsOf(text);
    const f = p.found.fields;
    const hint = {
      amount: p.hint.amount !== undefined && p.hint.amount !== null ? p.hint.amount : f.loanAmount ? f.loanAmount.value : loan ? loan.totalAmount : undefined,
      rate: p.hint.rate !== undefined && p.hint.rate !== null ? p.hint.rate : f.rate ? f.rate.value : loan ? loan.rate : undefined,
    };
    const rows = p.pictureRows || p.file.rows;
    p.schedule = rows && rows.length ? parseSchedule(rows, { hint }) : { found: false, reason: "No table was read." };
    if (p.forced) {
      const again = parseSchedule(rows, { hint, roles: p.forced });
      const good = again.found && again.checks.split > 0 && again.checks.addUp >= again.checks.split * 0.9 && again.checks.carry >= again.checks.carryOf * 0.9;
      if (good) p.schedule = { ...again, how: "ai-columns", warnings: ["The free AI said which column is which; the sums then checked out.", ...again.warnings] };
    }
    p.docType = docTypeOf(text, p.schedule.found && p.schedule.checks.lines >= 6);
    // a document that is not a schedule may still hold a few dated amounts (a statement): not offered as one
    if (p.schedule.found && ["sanction", "certificate", "noc", "insurance", "kfs"].includes(p.docType.id) && p.schedule.checks.lines < 6) p.schedule = { found: false, reason: "A few dated amounts, not a repayment schedule." };
  }

  /** The values the loan form would be filled with, each with where it came from. */
  _values(p) {
    const text = p.file.kind === "image" ? p.pictureText || "" : p.file.text;
    const s = p.schedule.found ? p.schedule : null;
    const out = {};
    const put = (k, value, from, extra = {}) => {
      if (value === null || value === undefined || value === "") return;
      if (!out[k]) out[k] = { label: LABELS[k], value, from, ...extra };
    };
    const f = p.found.fields;
    // the document's words first, then the schedule's arithmetic, then the AI
    put("lender", f.lender && f.lender.value, "document", { line: f.lender && f.lender.line });
    put("kind", f.kind && f.kind.value, "document", { line: f.kind && f.kind.line });
    put("openingDate", f.openingDate && f.openingDate.value, "document", { line: f.openingDate && f.openingDate.line });
    put("totalAmount", f.loanAmount && f.loanAmount.value, "document", { line: f.loanAmount && f.loanAmount.line });
    put("rate", f.rate && f.rate.value, "document", { line: f.rate && f.rate.line });
    if (s) {
      put("emiAmount", usualEmi(s.rows), "schedule", { line: "The instalment that repeats in the schedule" });
      put("firstEmiDate", s.rows[0].date, "schedule", { line: "The schedule’s first instalment" });
      put("totalAmount", s.amount, "schedule", { line: "What was owed before the schedule’s first instalment" });
      put("rate", s.rate, "schedule", { line: "From the schedule’s interest and balance" });
      put("tenureMonths", s.rows.length, "schedule", { line: "Instalments in the schedule" });
    }
    put("emiAmount", f.emiAmount && f.emiAmount.value, "document", { line: f.emiAmount && f.emiAmount.line });
    put("firstEmiDate", f.firstEmiDate && f.firstEmiDate.value, "document", { line: f.firstEmiDate && f.firstEmiDate.line });
    put("tenureMonths", f.tenureMonths && f.tenureMonths.value, "document", { line: f.tenureMonths && f.tenureMonths.line });
    put("processingFee", f.processingFee && f.processingFee.value, "document", { line: f.processingFee && f.processingFee.line });
    put("outstanding", f.outstanding && f.outstanding.value, "document", { line: f.outstanding && f.outstanding.line });
    for (const [k, v] of Object.entries(p.aiValues)) {
      const checked = p.file.kind === "image" ? null : inText(k, v, text);
      if (!out[k]) put(k, v, "ai", { checked });
      else if (String(out[k].value).toLowerCase() !== String(v).toLowerCase() && k !== "lender" && k !== "kind") out[k] = { ...out[k], aiSays: { value: v, checked } };
    }
    // a short, readable name: a lender written in capitals is set in ordinary case, "Limited" left off
    const lender = out.lender ? shortName(out.lender.value) : "";
    const kind = out.kind ? out.kind.value : "other";
    put("name", `${lender || cleanName(p.file.name).replace(/\.[a-z0-9]+$/i, "")}${lender ? ` ${KIND_WORDS[kind] || "loan"}` : ""}${p.found.accountLast4 ? ` ··${p.found.accountLast4}` : ""}`.slice(0, 80), "suggested");
    return out;
  }

  /** A loan already in the book that this file looks like it belongs to. */
  _match(p, values) {
    if (p.loanId) return p.loanId;
    const last4 = p.found.accountLast4;
    const all = this.loans.view().loans.filter((l) => l.type !== "cash");
    if (last4) {
      const byNumber = all.find((l) => l.accountLast4 === last4 || (l.documents || []).some((d) => d.accountLast4 === last4) || l.name.includes(`··${last4}`));
      if (byNumber) return byNumber.id;
    }
    const total = values.totalAmount ? values.totalAmount.value : null;
    const word = values.lender ? String(values.lender.value).split(" ")[0].toLowerCase() : "";
    const same = all.filter((l) => total && Math.abs(l.totalAmount - total) < 1 && (!word || l.name.toLowerCase().includes(word)));
    return same.length === 1 ? same[0].id : "";
  }

  view(token, p) {
    const values = this._values(p);
    const s = p.schedule;
    const text = p.file.kind === "image" ? p.pictureText || "" : p.file.text;
    const terms = [...p.found.terms.map((t) => ({ ...t, from: "document" }))];
    for (const t of p.aiTerms) if (!terms.some((x) => x.quote === t.quote)) terms.push(t);
    const status = this.desk ? this.desk.status() : { ready: false };
    return {
      token,
      loanId: p.loanId,
      matchId: this._match(p, values),
      file: { name: p.file.name, size: p.file.size, kind: p.file.kind, pages: p.file.pages, locked: p.file.locked, note: p.file.note, unread: p.file.unread || "" },
      docType: p.docType,
      schedule: s.found
        ? {
            found: true,
            how: s.how,
            needs: s.needs,
            checks: s.checks,
            warnings: s.warnings,
            totals: s.totals,
            amount: s.amount,
            rate: s.rate,
            count: s.rows.length,
            first: s.rows[0].date,
            last: s.rows[s.rows.length - 1].date,
            rows: s.rows,
          }
        : { found: false, reason: s.reason },
      values,
      accountLast4: p.found.accountLast4,
      terms: terms.slice(0, 18),
      summary: p.aiSummary,
      watch: p.aiWatch,
      // nothing to give the AI from a file that could not be opened (a picture it can still look at, when asked)
      ai: { ...p.ai, ready: Boolean(status.ready) && (!p.file.unread || Boolean(p.file.image)), name: status.model || "", picture: p.file.kind === "image", blanked: p.file.kind === "image" ? 0 : redact(text).count },
    };
  }

  /** The owner gives the loan amount or the rate a bare schedule needs: it is worked out again. */
  hint(owner, token, input) {
    const p = this._get(token, owner);
    const amount = num((input || {}).amount);
    const rate = num((input || {}).rate);
    if (amount !== null && !(amount > 0)) throw new LoanError("Enter the loan amount, above zero.");
    if (rate !== null && (rate < 0 || rate > 100)) throw new LoanError("Enter the yearly rate, from 0 to 100.");
    if (amount !== null) p.hint.amount = amount;
    if (rate !== null) p.hint.rate = rate;
    this._parse(p);
    return this.view(String(token), p);
  }

  /* ------------------------------------------------------------------ the free AI */
  async readWithAi(owner, token) {
    const p = this._get(token, owner);
    if (!this.desk || !this.desk.status().ready) throw new LoanError(this.desk ? this.desk.status().setup : "The free AI is not set up.", "no_free_ai", 409);
    const picture = p.file.kind === "image";
    try {
      const r = picture ? await this.desk.readPicture(p.file.image) : await this.desk.readDocument(redact(p.file.text).text);
      const d = r.data || {};
      if (picture) {
        p.pictureText = String(d.text || "");
        const lines = (Array.isArray(d.lines) ? d.lines : []).slice(0, 80).map((l) => String(l).split(/\s{1,}|\t|\|/).filter(Boolean));
        p.pictureRows = lines.length >= 2 ? lines : null;
      }
      const values = {};
      for (const [from, to] of Object.entries(AI_KEYS)) {
        const raw = String(d[from] === undefined || d[from] === null ? "" : d[from]).trim();
        if (!raw) continue;
        if (to === "openingDate" || to === "firstEmiDate") {
          const day = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : (findDate(raw) || {}).date;
          if (day) values[to] = day;
        } else if (to === "lender") values[to] = raw.slice(0, 60);
        else if (to === "kind") {
          if (KIND_WORDS[raw.toLowerCase()]) values[to] = raw.toLowerCase();
        } else {
          const n = num(raw);
          if (n !== null && n > 0 && n <= 1e10 && !(to === "rate" && n > 60)) values[to] = n;
        }
      }
      p.aiValues = values;
      const source = picture ? p.pictureText : p.file.text;
      const squash = (x) => String(x).toLowerCase().replace(/\s+/g, " ").trim();
      p.aiTerms = (Array.isArray(d.terms) ? d.terms : []).slice(0, 12).map((t) => {
        const quote = String(t.quote || "").replace(/\s+/g, " ").trim().slice(0, 260);
        return { title: String(t.title || "Term").slice(0, 80), detail: String(t.detail || "").slice(0, 300), quote, from: "ai", checked: Boolean(quote) && squash(source).includes(squash(quote)) };
      });
      p.aiSummary = String(d.summary || "").slice(0, 700);
      p.aiWatch = (Array.isArray(d.watch) ? d.watch : []).slice(0, 5).map((x) => String(x).slice(0, 240));
      p.ai = { done: true, model: r.model, error: "" };
      this._parse(p);
      // the table could not be made out by its sums: ask which column is which, and check the sums again
      if (!picture && (!p.schedule.found || p.schedule.checks.split === 0) && !(p.schedule.needs || []).length) {
        const loose = parseSchedule(p.file.rows, { roles: { emi: 0, principal: -1, interest: -1, balance: -1, balanceType: "none", how: "computed" } });
        if (loose.found && loose.sample && loose.sample[0].values.length > 1 && loose.checks.lines >= 6) {
          const headings = p.file.rows.filter((row) => row.some((c) => /princip|interest|balance|emi|instal/i.test(c))).slice(0, 6).map((row) => row.join(" | ")).join("\n");
          const c = (await this.desk.readColumns(redact(headings).text, loose.sample)).data || {};
          const at = (x) => (Number.isInteger(x) && x >= 0 && x < loose.sample[0].values.length ? x : -1);
          p.forced = { emi: at(c.emi), principal: at(c.principal), interest: at(c.interest), balance: at(c.balance), balanceType: at(c.balance) >= 0 && c.balanceType !== "none" ? c.balanceType : "none", how: at(c.principal) >= 0 || at(c.interest) >= 0 ? "lender" : at(c.balance) >= 0 ? "balance" : "computed" };
          this._parse(p);
        }
      }
    } catch (err) {
      if (err instanceof LoanError) throw err;
      p.ai = { done: false, model: "", error: String((err && err.message) || "The free AI could not answer.").slice(0, 300) };
    }
    return this.view(String(token), p);
  }

  discard(owner, token) {
    this._get(token, owner);
    this.pending.delete(String(token));
  }

  /* ------------------------------------------------------------------ saving */
  /**
   * The owner pressed Save. @param input { loanId, loan: the form's fields, useSchedule, paidUpTo: "YYYY-MM" | "" }
   * @returns { id, docId, dropped, marked }
   */
  async apply(owner, token, input, by = "") {
    const p = this._get(token, owner);
    const b = input && typeof input === "object" ? input : {};
    const loanId = String(b.loanId || "");
    const s = p.schedule.found ? p.schedule : null;
    const use = Boolean(b.useSchedule) && Boolean(s);
    if (use && s.rows.some((x) => x.principal === null)) throw new LoanError("This schedule does not say the principal: give the loan amount or the rate first, so it can be worked out.");
    const plan = use ? { rows: s.rows, how: s.how, amount: s.amount, rate: s.rate } : null;
    const values = this._values(p);
    const docId = `d${crypto.randomBytes(8).toString("hex")}`;
    if (plan) plan.docId = docId;
    let id = loanId;
    let dropped = [];
    if (loanId) {
      const loan = this.loans.get(loanId);
      if (loan.type === "cash") throw new LoanError("A cash loan from a person takes no documents.");
      if ((loan.documents || []).length >= MAX_DOCS) throw new LoanError(`A loan keeps at most ${MAX_DOCS} documents. Remove one first.`);
      if (plan) ({ dropped } = this.loans.applyPlan(loanId, plan, by));
    } else {
      const form = { ...(b.loan || {}) };
      if (plan) {
        form.firstEmiDate = form.firstEmiDate || s.rows[0].date;
        form.emiAmount = form.emiAmount || usualEmi(s.rows);
        form.totalAmount = form.totalAmount || s.amount;
        if (form.rate === "" || form.rate === undefined) form.rate = s.rate === null ? 0 : s.rate;
        form.startBalance = "";
      }
      id = this.loans.add(form, by, { plan });
    }
    const text = p.file.kind === "image" ? p.pictureText || "" : p.file.text;
    const meta = {
      id: docId,
      name: p.file.name,
      kind: p.file.kind,
      mime: p.file.mime,
      size: p.file.size,
      docType: p.docType.id,
      docLabel: p.docType.label,
      locked: p.file.locked,
      unread: p.file.unread || "",
      accountLast4: p.found.accountLast4,
      usedSchedule: use,
      values: Object.fromEntries(Object.entries(values).filter(([k]) => k !== "name").map(([k, v]) => [k, { label: v.label, value: v.value, from: v.from }])),
      terms: this.view(String(token), p).terms,
      summary: p.aiSummary,
      watch: p.aiWatch,
      aiModel: p.ai.done ? p.ai.model : "",
      uploadedAt: new Date(this.now()).toISOString(),
      by,
    };
    await this.docs.coldPut(STORE, docId, { loanId: id, name: p.file.name, mime: p.file.mime, data: p.buf.toString("base64"), text: redact(text).text.slice(0, TEXT_KEPT) });
    this.loans.attachDocument(id, meta, by);
    let marked = 0;
    const upto = String(b.paidUpTo || "");
    if (upto) {
      try {
        marked = this.loans.paidUpTo(id, upto, by);
      } catch (err) {
        if (!(err instanceof LoanError) || !/already marked paid/.test(err.message)) throw err;
      }
    }
    this.pending.delete(String(token));
    return { id, docId, dropped, marked };
  }

  /* ------------------------------------------------------------------ the kept files */
  _meta(loanId, docId) {
    const loan = this.loans.get(loanId);
    const meta = (loan.documents || []).find((x) => x.id === String(docId || ""));
    if (!meta) throw new LoanError("That document is no longer there.", "not_found", 404);
    return meta;
  }

  async file(loanId, docId) {
    const meta = this._meta(loanId, docId);
    const kept = await this.docs.coldGet(STORE, meta.id);
    if (!kept) throw new LoanError("The file is no longer in the database.", "not_found", 404);
    return { name: meta.name, mime: meta.mime, data: Buffer.from(kept.data, "base64") };
  }

  /**
   * What the page shows of a kept file: a PDF and a picture are shown as they are (the page fetches the file); a sheet, a
   * Word or a text file is shown as its rows or words, read again from the file itself.
   */
  async preview(loanId, docId) {
    const f = await this.file(loanId, docId);
    const meta = this._meta(loanId, docId);
    const base = { name: meta.name, kind: meta.kind, mime: meta.mime, locked: Boolean(meta.locked) };
    if (meta.kind === "pdf") return { ...base, show: "pdf" };
    if (meta.kind === "image") return { ...base, show: "image" };
    if (meta.unread) return { ...base, show: "none", why: meta.unread };
    let read;
    try {
      read = readLoanFile(meta.name, f.data);
    } catch (err) {
      return { ...base, show: "none", why: err.message };
    }
    if (read.kind === "xlsx" || read.kind === "csv") {
      const rows = read.rows.filter((r) => r.some((c) => String(c || "").trim()));
      return { ...base, show: "table", rows: rows.slice(0, 800).map((r) => r.slice(0, 20).map((c) => String(c === undefined || c === null ? "" : c))), more: Math.max(0, rows.length - 800) };
    }
    return { ...base, show: "text", text: read.text.slice(0, 60000) };
  }

  async removeDocument(loanId, docId, by = "") {
    const meta = this.loans.removeDocument(loanId, docId, by);
    await this.docs.coldRemove(STORE, [meta.id]);
    return meta;
  }

  /* ------------------------------------------------------------------ the AI's analysis and questions */
  /** The figures the AI is given: the loan book's own sums, with a person's name never in them. */
  figures(loanId = "") {
    const v = this.loans.view();
    let person = 0;
    const one = (l) => {
      if (l.type === "cash") {
        person += 1;
        return { loan: `Cash from person ${person}`, type: "cash from a person", taken: l.openingDate, amount: l.totalAmount, paidBack: l.summary.paidAmount, owed: l.summary.outstanding };
      }
      const s = l.summary;
      const base = { loan: redact(l.name).text, type: KIND_WORDS[l.kind] || "loan", opened: l.openingDate, amount: l.totalAmount, yearlyRatePct: l.rate, emi: l.emiAmount, split: l.method === "schedule" ? "lender's schedule" : l.method === "principal" ? "worked out from the rate" : "not split", principalOwed: s.outstanding, interestStillToPay: s.interestRemaining, totalStillToPay: s.totalToPay, principalPaid: s.paidPrincipal, interestPaid: s.paidInterest, emisPaid: s.paidCount, emisLeft: s.emisLeft, lastMonth: s.endMonth, overdueEmis: s.overdueCount, overdueAmount: s.overdueAmount, nextEmi: s.next ? { date: s.next.date, amount: s.next.amount, principal: s.next.principal, interest: s.next.interest } : null, closed: s.closed };
      if (!s.closed && l.rate > 0) {
        const plain = simulate(s.outstanding, l.rate, l.emiAmount);
        const lump = Math.min(100000, s.outstanding);
        const with1 = simulate(s.outstanding, l.rate, l.emiAmount, { lump });
        if (plain && with1) base.ifPrepaidNow = { amount: lump, interestSavedAbout: r2(plain.interest - with1.interest), monthsSooner: plain.months - with1.months, note: "estimate on a reducing balance, before any prepayment charge" };
      }
      if (loanId) {
        base.clauses = (l.documents || []).flatMap((d) => (d.terms || []).map((t) => t.quote)).slice(0, 14);
        base.nextMonths = [...l.rows.filter((x) => !x.paid), ...l.upcoming].slice(0, 12).map((x) => ({ month: x.month, emi: x.emi, principal: x.principal, interest: x.interest }));
      }
      return base;
    };
    const picked = loanId ? v.loans.filter((l) => l.id === loanId) : v.loans;
    if (loanId && !picked.length) throw new LoanError("That loan is no longer there.", "not_found", 404);
    const t = v.totals;
    return { asOf: v.today, totals: loanId ? undefined : { principalOwed: t.outstanding, interestStillToPay: t.interestRemaining, emisAMonth: t.emiPerMonth, thisMonth: t.month, overdue: t.overdueAmount, averageRatePct: t.avgRate, cashFromPeople: t.cash.outstanding }, loans: picked.map(one) };
  }

  _kept() {
    const k = this.docs.read(INSIGHT, null) || {};
    return { book: k.book || null, byLoan: k.byLoan || {}, asked: Array.isArray(k.asked) ? k.asked : [] };
  }

  async insights(loanId = "", by = "") {
    const figures = this.figures(loanId);
    if (!figures.loans.length) throw new LoanError("Add a loan first.");
    const r = await this.desk.insights(figures);
    const d = r.data || {};
    const item = {
      at: new Date(this.now()).toISOString(),
      by,
      model: r.model,
      summary: String(d.summary || "").slice(0, 1200),
      points: (Array.isArray(d.points) ? d.points : []).slice(0, 8).map((x) => ({ title: String(x.title || "").slice(0, 120), detail: String(x.detail || "").slice(0, 600) })),
      questions: (Array.isArray(d.questions) ? d.questions : []).slice(0, 4).map((x) => String(x).slice(0, 240)),
    };
    const kept = this._kept();
    if (loanId) kept.byLoan[loanId] = item;
    else kept.book = item;
    this.docs.write(INSIGHT, kept);
    return item;
  }

  async ask(loanId, question, by = "") {
    const q = String(question || "").replace(/\s+/g, " ").trim().slice(0, 600);
    if (q.length < 4) throw new LoanError("Type your question.");
    const figures = this.figures(loanId || "");
    let docText = "";
    if (loanId) {
      const metas = (this.loans.get(loanId).documents || []).slice(-6).reverse();
      for (const m of metas) {
        const kept = await this.docs.coldGet(STORE, m.id);
        if (kept && kept.text) docText += `=== ${m.docLabel} ===\n${kept.text.slice(0, 8000)}\n`;
        if (docText.length > 15000) break;
      }
    }
    const r = await this.desk.answer(redact(q).text, figures, docText);
    const d = r.data || {};
    const squash = (x) => String(x).toLowerCase().replace(/\s+/g, " ").trim();
    const item = { at: new Date(this.now()).toISOString(), by, model: r.model, loanId: loanId || "", question: q, answer: String(d.answer || "").slice(0, 3000), found: d.found !== false, quotes: (Array.isArray(d.quotes) ? d.quotes : []).map((x) => String(x).slice(0, 300)).filter((x) => x && squash(docText).includes(squash(x))).slice(0, 4) };
    const kept = this._kept();
    kept.asked = [item, ...kept.asked].slice(0, 20);
    this.docs.write(INSIGHT, kept);
    return item;
  }
}

/** The routes: superadmins only, like the rest of the loan book. A file comes as raw bytes. */
function mountLoanIntake(app, { intake, loans, requireSuper, limiter }) {
  const express = require("express");
  const { AiError } = require("./ai/client");
  const wrap = (fn, status = 200) => async (req, res) => {
    try {
      const out = await fn(req, res);
      if (out !== undefined) res.status(status).json(out);
    } catch (err) {
      if (err instanceof LoanError || err instanceof LoanFileError || err instanceof AiError) return res.status(err.status || 400).json({ error: err.code, message: err.message });
      console.error("[loans] intake:", err && err.message ? err.message : err);
      res.status(500).json({ error: "loans_failed", message: "The document could not be handled." });
    }
  };
  const by = (req) => (req.user && req.user.email) || "";
  const writes = limiter(300, 15 * 60 * 1000);
  const uploads = limiter(60, 15 * 60 * 1000);
  const after = (result) => ({ ...loans.view(), ...result });
  const raw = express.raw({ type: () => true, limit: "8mb" });

  app.post("/api/admin/loans/documents/read", requireSuper, uploads, raw, wrap(async (req) => {
    // the password travels in a header, never in the address (addresses are written to logs)
    let password = "";
    try {
      password = decodeURIComponent(String(req.get("x-doc-password") || "")).slice(0, 128);
    } catch (_) {
      password = "";
    }
    return intake.read(by(req), String(req.query.name || "document"), Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), { password, loanId: String(req.query.loanId || ""), keep: req.query.keep === "1" });
  }));
  app.post("/api/admin/loans/documents/:token/hint", requireSuper, writes, wrap(async (req) => intake.hint(by(req), req.params.token, req.body)));
  app.post("/api/admin/loans/documents/:token/ai", requireSuper, uploads, wrap(async (req) => intake.readWithAi(by(req), req.params.token)));
  app.post("/api/admin/loans/documents/:token/apply", requireSuper, writes, wrap(async (req) => after({ applied: await intake.apply(by(req), req.params.token, req.body, by(req)) }), 201));
  app.delete("/api/admin/loans/documents/:token", requireSuper, writes, wrap(async (req) => {
    intake.discard(by(req), req.params.token);
    return { ok: true };
  }));
  app.get("/api/admin/loans/:id/documents/:docId", requireSuper, wrap(async (req, res) => {
    const f = await intake.file(String(req.params.id), String(req.params.docId));
    // always a download, never shown inside the site's own pages
    res.setHeader("Content-Type", f.mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${f.name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.end(f.data);
    return undefined;
  }));
  app.get("/api/admin/loans/:id/documents/:docId/view", requireSuper, wrap(async (req) => intake.preview(String(req.params.id), String(req.params.docId))));
  app.delete("/api/admin/loans/:id/documents/:docId", requireSuper, writes, wrap(async (req) => {
    await intake.removeDocument(String(req.params.id), String(req.params.docId), by(req));
    return after({});
  }));
  app.post("/api/admin/loans/ai/insights", requireSuper, uploads, wrap(async (req) => {
    if (!intake.desk.status().ready) throw new LoanError(intake.desk.status().setup, "no_free_ai", 409);
    await intake.insights(String((req.body || {}).loanId || ""), by(req));
    return after({});
  }));
  app.post("/api/admin/loans/ai/ask", requireSuper, uploads, wrap(async (req) => {
    if (!intake.desk.status().ready) throw new LoanError(intake.desk.status().setup, "no_free_ai", 409);
    const answered = await intake.ask(String((req.body || {}).loanId || ""), (req.body || {}).question, by(req));
    return after({ answered });
  }));
}

module.exports = { LoanIntake, mountLoanIntake, inText, STORE };
