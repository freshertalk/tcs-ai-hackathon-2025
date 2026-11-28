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
//   TOGETHER several papers of one loan are read as one (loan-merge.js): the best source of each figure, every other
//            detail (loan-details.js), the months a statement shows as paid. One Save keeps them all.
//   SCANS    a scanned page is a picture (pdf-pictures.js): the page shrinks it and the free AI reads it, one at a time.
// A password typed for a protected file is used for that reading only, and is not kept.

const crypto = require("node:crypto");
const { readLoanFile, readOrKeep, cleanName, LoanFileError } = require("./loan-files");
const { parseSchedule, findDate } = require("./loan-schedule");
const { fieldsOf, docTypeOf, redact, receiptsOf } = require("./loan-fields");
const { LoanError, INSIGHT, simulate, usualEmi } = require("./loans");
const { DETAILS, BY_KEY, cleanValue } = require("./loan-details");
const { combine, chooseSchedule, paidMonths, instalmentsOf } = require("./loan-merge");
const { pictureOf } = require("./pdf-pictures");
const { sniff } = require("./ai/attach");

const STORE = "loan_docs";
const TTL = 60 * 60 * 1000;
const MAX_PENDING = 24;
const MAX_PENDING_BYTES = 80 * 1024 * 1024; // files wait in memory for their Save: the oldest go first
const MAX_BATCH = 12; // documents reviewed and saved together
const MAX_DOCS = 40; // a loan
const TEXT_KEPT = 200000;
const AI_PART = 22000; // characters of a long document sent at a time
const AI_PARTS = 6;
const PAGE_PICTURE_MAX = 220 * 1024; // a page as the page shrinks it for the free vision models

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

const LABELS = { ...Object.fromEntries(DETAILS.map((d) => [d.key, d.label])), lender: "Lender", kind: "Type", name: "Loan name", openingDate: "Opening date", totalAmount: "Total amount", rate: "Interest rate (% a year)", emiAmount: "EMI amount", firstEmiDate: "First EMI date", tenureMonths: "Tenure (months)", processingFee: "Processing fee", outstanding: "Outstanding stated" };
const KIND_WORDS = { home: "home loan", car: "car loan", personal: "personal loan", education: "education loan", gold: "gold loan", business: "business loan", card: "card EMI", other: "loan" };
const AI_KEYS = { ...Object.fromEntries(DETAILS.map((d) => [d.key, d.key])), lender: "lender", loanType: "kind", openingDate: "openingDate", loanAmount: "totalAmount", interestRate: "rate", tenureMonths: "tenureMonths", emiAmount: "emiAmount", firstEmiDate: "firstEmiDate", processingFee: "processingFee", outstanding: "outstanding" };

const SHORT_FORMS = /^(SBI|HDFC|ICICI|PNB|LIC|IDFC|IDBI|RBL|HSBC|DBS|AU|UCO|TVS|SMFG|L&T)$/;
/** The text of a long document in pieces the free models take, cut at line ends. */
function partsOf(text, size = AI_PART, most = AI_PARTS) {
  const parts = [];
  let part = "";
  for (const line of String(text).split("\n")) {
    if (part && part.length + line.length + 1 > size) {
      parts.push(part);
      part = "";
      if (parts.length === most) return parts;
    }
    part += `${part ? "\n" : ""}${line.slice(0, size)}`;
  }
  if (part.trim()) parts.push(part);
  return parts;
}

/** The model's answer as the desk's own fields: only what is in the shape each field asks for. */
function aiFields(d) {
  const values = {};
  for (const [from, to] of Object.entries(AI_KEYS)) {
    const text = String(d[from] === undefined || d[from] === null ? "" : d[from]).trim();
    if (!text || values[to] !== undefined) continue;
    const def = BY_KEY.get(to);
    if (to === "openingDate" || to === "firstEmiDate" || (def && def.type === "date")) {
      const day = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : (findDate(text) || {}).date;
      if (day) values[to] = day;
    } else if (to === "lender") values[to] = text.slice(0, 60);
    else if (to === "kind") {
      if (KIND_WORDS[text.toLowerCase()]) values[to] = text.toLowerCase();
    } else if (def && def.type === "text") {
      if (!/^(n\/?a|nil stated|not (stated|mentioned|specified|applicable|available)|none stated|unknown|-+)$/i.test(text)) values[to] = redact(text).text.slice(0, 300);
    } else {
      const n = num(text);
      if (n !== null && n > 0 && n <= 1e10 && !((to === "rate" || to === "apr") && n > 60) && !(def && cleanValue(to, n) === null)) values[to] = n;
    }
  }
  const terms = (Array.isArray(d.terms) ? d.terms : []).slice(0, 12);
  return { values, terms, summary: String(d.summary || "").slice(0, 700), watch: (Array.isArray(d.watch) ? d.watch : []).slice(0, 5).map((x) => String(x).slice(0, 240)) };
}

/** Everything a file has given as words: its own, then those read from its scanned pages. */
const textOf = (p) => [p.file.kind === "image" ? "" : p.file.text, p.pictureText || ""].filter(Boolean).join("\n");

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
    const held = () => [...this.pending.values()].reduce((a, p) => a + p.buf.length, 0);
    while (this.pending.size > MAX_PENDING || (this.pending.size > 1 && held() > MAX_PENDING_BYTES)) this.pending.delete(this.pending.keys().next().value);
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
    const scans = file.kind === "image" ? [{ page: 1, picture: { ok: true } }] : file.scans || [];
    const p = { owner, at: this.now(), loanId: loan ? loan.id : "", file, buf, ai: { done: false, model: "", error: "" }, hint: {}, crossHint: {}, aiValues: {}, aiTerms: [], aiSummary: "", aiWatch: [], forced: null, pictureRows: null, pictureText: "", textAi: null, scans, pageReads: new Map(), receipts: [] };
    this._parse(p);
    const token = crypto.randomBytes(12).toString("hex");
    this.pending.set(token, p);
    this._sweep();
    return this.view(token, p);
  }

  /** What the words and the table give, again (after a hint from the owner, another paper or a reading from the AI). */
  _parse(p) {
    const loan = p.loanId ? this.loans.get(p.loanId) : null;
    const text = textOf(p);
    p.found = fieldsOf(text);
    const f = p.found.fields;
    // what the schedule is told: your own figures first, then this paper's, then the papers uploaded with it, then the book's
    const first = (...all) => all.find((v) => v !== undefined && v !== null);
    const hint = {
      amount: first(p.hint.amount, f.loanAmount && f.loanAmount.value, p.crossHint.amount, loan ? loan.totalAmount : undefined),
      rate: first(p.hint.rate, f.rate && f.rate.value, p.crossHint.rate, loan ? loan.rate : undefined),
    };
    const rows = [...(p.file.kind === "image" ? [] : p.file.rows || []), ...(p.pictureRows || [])];
    p.schedule = rows.length ? parseSchedule(rows, { hint }) : { found: false, reason: "No table was read." };
    if (p.forced) {
      const again = parseSchedule(rows, { hint, roles: p.forced });
      const good = again.found && again.checks.split > 0 && again.checks.addUp >= again.checks.split * 0.9 && again.checks.carry >= again.checks.carryOf * 0.9;
      if (good) p.schedule = { ...again, how: "ai-columns", warnings: ["The free AI said which column is which; the sums then checked out.", ...again.warnings] };
    }
    p.docType = docTypeOf(text, p.schedule.found && p.schedule.checks.lines >= 6);
    // a document that is not a schedule may still hold a few dated amounts (a statement): not offered as one
    if (p.schedule.found && ["sanction", "certificate", "noc", "insurance", "kfs"].includes(p.docType.id) && p.schedule.checks.lines < 6) p.schedule = { found: false, reason: "A few dated amounts, not a repayment schedule." };
    // a statement lists what has happened: its lines are not the months to come, so they must not replace them
    if (p.schedule.found && p.docType.id === "statement" && (p.schedule.how === "computed" || p.schedule.rows[p.schedule.rows.length - 1].date <= new Date(this.now() + 5.5 * 3600000).toISOString().slice(0, 10))) p.schedule = { found: false, reason: "The payments a statement lists, not a repayment schedule." };
    p.receipts = p.docType.id === "statement" ? receiptsOf(text) : [];
  }

  /** The values the loan form would be filled with, each with where it came from. */
  _values(p) {
    const s = p.schedule.found ? p.schedule : null;
    const out = {};
    const put = (k, value, from, extra = {}) => {
      if (value === null || value === undefined || value === "") return;
      if (!out[k]) out[k] = { label: LABELS[k], value, from, ...extra };
    };
    const f = p.found.fields;
    const own = p.file.kind === "image" ? "" : p.file.text; // the file's own words (a scan has none)
    // words read off a scanned page by the free AI are not the file's own: they are said to be from the scan
    const doc = (k, as = k) => {
      if (!f[k]) return;
      const scanned = Boolean(p.pictureText) && !(own && inText(as, f[k].value, own));
      put(as, f[k].value, scanned ? "scan" : "document", { line: f[k].line });
    };
    // the document's words first, then the schedule's arithmetic, then the AI
    for (const [k, as] of [["lender"], ["kind"], ["openingDate"], ["loanAmount", "totalAmount"], ["rate"]]) doc(k, as || k);
    if (s) {
      const how = p.pictureRows ? " (read from a scan; the sums are checked)" : "";
      put("emiAmount", usualEmi(s.rows), "schedule", { line: `The instalment that repeats in the schedule${how}` });
      put("firstEmiDate", s.rows[0].date, "schedule", { line: `The schedule’s first instalment${how}` });
      put("totalAmount", s.amount, "schedule", { line: `What was owed before the schedule’s first instalment${how}` });
      put("rate", s.rate, "schedule", { line: `From the schedule’s interest and balance${how}` });
      put("tenureMonths", s.rows.length, "schedule", { line: `Instalments in the schedule${how}` });
    }
    doc("emiAmount");
    doc("firstEmiDate");
    for (const d of DETAILS) doc(d.key);
    for (const [k, v] of Object.entries(p.aiValues)) {
      // checked against the file's own words; what only a picture showed cannot be checked against anything
      const found = own ? inText(k, v, own) : false;
      const checked = found ? true : p.pictureText ? null : false;
      if (!out[k]) put(k, v, "ai", { checked });
      else if (String(out[k].value).toLowerCase() !== String(v).toLowerCase() && k !== "lender" && k !== "kind" && !(BY_KEY.get(k) && BY_KEY.get(k).type === "text")) out[k] = { ...out[k], aiSays: { value: v, checked } };
    }
    put("name", this._name(out.lender && out.lender.value, out.kind && out.kind.value, p.found.accountLast4, p.file.name), "suggested");
    return out;
  }

  /** A short, readable name: a lender written in capitals is set in ordinary case, "Limited" left off. */
  _name(lenderIn, kind, last4, fileName) {
    const lender = lenderIn ? shortName(lenderIn) : "";
    return `${lender || cleanName(fileName).replace(/\.[a-z0-9]+$/i, "")}${lender ? ` ${KIND_WORDS[kind || "other"] || "loan"}` : ""}${last4 ? ` ··${last4}` : ""}`.slice(0, 80);
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
    const text = textOf(p);
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
      // nothing to give the AI from a file that could not be opened (a picture or a scanned page it can still look at)
      ai: { ...p.ai, ready: Boolean(status.ready) && (!p.file.unread || Boolean(p.file.image) || p.scans.some((x) => x.picture.ok)), name: status.model || "", picture: p.file.kind === "image", blanked: p.file.kind === "image" ? 0 : redact(text).count },
      // the pages that are pictures: which can be read, which have been
      scan: { pages: p.scans.map((x) => ({ page: x.page, ok: Boolean(x.picture.ok), why: x.picture.why || "" })), read: [...p.pageReads.keys()].sort((a, b) => a - b) },
      words: p.file.kind === "image" ? false : Boolean(p.file.text),
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
  _ready() {
    if (!this.desk || !this.desk.status().ready) throw new LoanError(this.desk ? this.desk.status().setup : "The free AI is not set up.", "no_free_ai", 409);
  }

  /** What the AI has read of the words and of the pages, together: the first to state a figure keeps it. */
  _joinAi(p) {
    const pages = [...p.pageReads.keys()].sort((a, b) => a - b).map((n) => p.pageReads.get(n));
    p.pictureText = pages.map((x) => x.text).filter(Boolean).join("\n");
    const lines = pages.flatMap((x) => x.lines);
    p.pictureRows = lines.length >= 2 ? lines : null;
    const parts = [...(p.textAi ? [p.textAi] : []), ...pages];
    p.aiValues = {};
    for (const part of parts) for (const [k, v] of Object.entries(part.values)) if (p.aiValues[k] === undefined) p.aiValues[k] = v;
    const squash = (x) => String(x).toLowerCase().replace(/\s+/g, " ").trim();
    const own = squash(textOf(p));
    const seen = new Set();
    p.aiTerms = [];
    for (const t of parts.flatMap((x) => x.terms)) {
      const quote = String(t.quote || "").replace(/\s+/g, " ").trim().slice(0, 260);
      const key = quote || String(t.detail || "");
      if (!key || seen.has(key) || p.aiTerms.length >= 18) continue;
      seen.add(key);
      p.aiTerms.push({ title: String(t.title || "Term").slice(0, 80), detail: String(t.detail || "").slice(0, 300), quote, from: "ai", checked: Boolean(quote) && own.includes(squash(quote)) });
    }
    p.aiSummary = (parts.find((x) => x.summary) || {}).summary || "";
    p.aiWatch = [...new Set(parts.flatMap((x) => x.watch))].slice(0, 6);
    // a scan whose pages have now been read is no longer unread
    if (p.pictureText && p.file.unread) {
      p.file = { ...p.file, unread: "" };
    }
  }

  async readWithAi(owner, token) {
    const p = this._get(token, owner);
    this._ready();
    const picture = p.file.kind === "image";
    try {
      if (picture) {
        await this._lookAt(p, 1, p.file.image);
      } else {
        if (!p.file.text) throw new LoanError(p.scans.some((x) => x.picture.ok) ? "This is a scan: its pages are read as pictures." : "There are no words in this file for the AI to read.");
        const parts = partsOf(redact(p.file.text).text);
        const read = [];
        let failed = null;
        for (const part of parts) {
          try {
            const r = await this.desk.readDocument(part);
            read.push({ ...aiFields(r.data || {}), model: r.model });
          } catch (err) {
            failed = err;
            break;
          }
        }
        if (!read.length) throw failed || new Error("The free AI could not answer.");
        const gather = { values: {}, terms: [], summary: "", watch: [] };
        for (const x of read) {
          for (const [k, v] of Object.entries(x.values)) if (gather.values[k] === undefined) gather.values[k] = v;
          gather.terms.push(...x.terms);
          gather.watch.push(...x.watch);
          gather.summary = gather.summary || x.summary;
        }
        p.textAi = gather;
        this._joinAi(p);
        p.ai = { done: true, model: read[0].model, error: failed ? `Only ${read.length} of ${parts.length} parts of this long document were read by the free AI; try again for the rest. The desk read all of it itself.` : "" };
      }
      this._parse(p);
      // the table could not be made out by its sums: ask which column is which, and check the sums again
      if (!picture && p.file.text && (!p.schedule.found || p.schedule.checks.split === 0) && !(p.schedule.needs || []).length && p.docType.id !== "statement") {
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

  /** One page picture, read by a free model that can see. */
  async _lookAt(p, page, image) {
    const r = await this.desk.readPicture(image);
    const d = r.data || {};
    const lines = (Array.isArray(d.lines) ? d.lines : []).slice(0, 80).map((l) => String(l).split(/\s{1,}|\t|\|/).filter(Boolean));
    p.pageReads.set(page, { ...aiFields(d), text: String(d.text || "").slice(0, 12000), lines });
    this._joinAi(p);
    p.ai = { done: true, model: r.model, error: "" };
  }

  /** The picture of one scanned page, for the browser to make small enough for the free AI. */
  pageImage(owner, token, page) {
    const p = this._get(token, owner);
    const found = p.scans.find((x) => x.page === Number(page));
    if (p.file.kind === "image" && found) return { mime: p.file.mime, data: p.buf };
    const picture = found && pictureOf(found.picture);
    if (!picture) throw new LoanError((found && found.picture.why) || "That page has no picture to read.", "no_picture", 404);
    return picture;
  }

  /** A scanned page (or a photo), made small by the page, is read by the free AI and joins what the file has given. */
  async readPage(owner, token, page, buf) {
    const p = this._get(token, owner);
    this._ready();
    const n = Number(page);
    if (!p.scans.some((x) => x.page === n && x.picture.ok)) throw new LoanError("That page is not a picture that can be read.");
    const mime = Buffer.isBuffer(buf) && buf.length ? sniff(buf) : "";
    if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw new LoanError("Send the page as a JPEG, PNG or WebP picture.");
    if (buf.length > PAGE_PICTURE_MAX) throw new LoanError("That page picture is too large for the free AI.", "too_large", 413);
    try {
      await this._lookAt(p, n, { mediaType: mime, data: buf.toString("base64") });
      this._parse(p);
    } catch (err) {
      if (err instanceof LoanError) throw err;
      p.ai = { done: p.pageReads.size > 0 || Boolean(p.textAi), model: p.ai.model, error: `Page ${n}: ${String((err && err.message) || "the free AI could not answer.")}`.slice(0, 300) };
    }
    return this.view(String(token), p);
  }

  discard(owner, token) {
    this._get(token, owner);
    this.pending.delete(String(token));
  }

  /* ------------------------------------------------------------------ several documents as one */
  _batch(owner, tokens) {
    const list = [...new Set((Array.isArray(tokens) ? tokens : []).map(String))];
    if (!list.length) throw new LoanError("Choose at least one document.");
    if (list.length > MAX_BATCH) throw new LoanError(`At most ${MAX_BATCH} documents are reviewed together: save these, then add the rest.`);
    return list.map((t) => ({ token: t, p: this._get(t, owner) }));
  }

  /**
   * Everything the documents give, as one review. @param input { tokens, loanId, scheduleToken }
   * Nothing is saved.
   */
  combine(owner, input) {
    const b = input && typeof input === "object" ? input : {};
    const batch = this._batch(owner, b.tokens);
    const loanId = String(b.loanId || "");
    const loan = loanId ? this.loans.get(loanId) : null;
    if (loan && loan.type === "cash") throw new LoanError("A cash loan from a person takes no documents.");
    let views = batch.map(({ token, p }) => this.view(token, p));
    const pick = () => {
      const all = chooseSchedule(views);
      return { all, chosen: all.find((v) => v.token === String(b.scheduleToken || "")) || all[0] || null };
    };
    let { all, chosen } = pick();
    // a bare schedule needs the amount or the rate: the other papers may well say them
    if (chosen) {
      const rest = combine(views.filter((v) => v.token !== chosen.token));
      const target = batch.find((x) => x.token === chosen.token);
      const cross = {};
      if (rest.values.totalAmount && !["ai", "scan"].includes(rest.values.totalAmount.from)) cross.amount = rest.values.totalAmount.value;
      if (rest.values.rate && !["ai", "scan"].includes(rest.values.rate.from)) cross.rate = rest.values.rate.value;
      if (JSON.stringify(cross) !== JSON.stringify(target.p.crossHint)) {
        target.p.crossHint = cross;
        this._parse(target.p);
        views = batch.map(({ token, p }) => this.view(token, p));
        ({ all, chosen } = pick());
      }
    }
    const merged = combine(views);
    const last4 = (views.find((v) => v.accountLast4) || {}).accountLast4 || "";
    const matchId = loanId || (views.find((v) => v.matchId) || {}).matchId || "";
    const nameValue = this._name(merged.values.lender && merged.values.lender.value, merged.values.kind && merged.values.kind.value, last4, views[0].file.name);
    merged.values.name = { label: LABELS.name, value: nameValue, from: "suggested", others: [] };
    // the months the statements show as paid, matched against the schedule in hand, else the loan's own months
    const book = matchId ? this.loans.view().loans.find((l) => l.id === matchId) : null;
    const rows = chosen && !chosen.schedule.needs.length ? chosen.schedule.rows : book ? [...(book.rows || []), ...(book.upcoming || [])] : null;
    const today = this.loans.view().today;
    const emi = merged.values.emiAmount ? merged.values.emiAmount.value : book ? book.emiAmount : 0;
    const firstEmiDate = merged.values.firstEmiDate ? merged.values.firstEmiDate.value : book ? book.firstEmiDate : "";
    const count = merged.details.emisPaid;
    const paid = paidMonths({
      receipts: batch.flatMap(({ p }) => p.receipts.map((r) => ({ ...r, file: p.file.name }))),
      count: count ? { value: count.value, file: count.file, asOn: merged.details.asOnDate ? merged.details.asOnDate.value : "" } : null,
      instalments: instalmentsOf({ rows, emi, firstEmiDate, today }),
      today,
    });
    return {
      loanId,
      matchId,
      today,
      files: views.map((v) => ({
        token: v.token,
        file: v.file,
        docType: v.docType,
        accountLast4: v.accountLast4,
        found: Object.keys(v.values).filter((k) => k !== "name").length,
        schedule: v.schedule.found ? { found: true, count: v.schedule.count, how: v.schedule.how, needs: v.schedule.needs } : { found: false, reason: v.schedule.reason },
        ai: v.ai,
        scan: v.scan,
        words: v.words,
      })),
      values: merged.values,
      details: merged.details,
      schedule: chosen ? { ...chosen.schedule, token: chosen.token, file: chosen.file.name } : { found: false, reason: (views.find((v) => v.schedule.reason) || { schedule: {} }).schedule.reason || "" },
      schedules: all.map((v) => ({ token: v.token, file: v.file.name, count: v.schedule.count, how: v.schedule.how, first: v.schedule.first, last: v.schedule.last })),
      paid,
      warnings: merged.warnings,
      terms: merged.terms,
      watch: merged.watch,
      summaries: merged.summaries,
      accountLast4: last4,
    };
  }

  /* ------------------------------------------------------------------ saving */
  /**
   * The owner pressed Save on one document. @param input { loanId, loan, details, useSchedule, paidUpTo, paidMonths }
   * @returns { id, docId, dropped, marked }
   */
  async apply(owner, token, input, by = "") {
    const done = await this.applyAll(owner, { ...(input && typeof input === "object" ? input : {}), tokens: [String(token || "")], scheduleToken: String(token || "") }, by);
    return { id: done.id, docId: done.docIds[0], dropped: done.dropped, marked: done.marked };
  }

  /** What each reviewed detail is saved as: the value, and the paper it came from — or "typed", if it is the owner's. */
  _reviewed(merged, given, had, tokenDocs) {
    const entries = {};
    const stamp = (d, hit) => ({ value: hit.value, from: hit.from, file: hit.file || d.file, docId: tokenDocs.get(hit.token) || "" });
    if (!given || typeof given !== "object") {
      // nothing was reviewed field by field: what the papers say fills what the loan does not yet have
      for (const [key, d] of Object.entries(merged)) if (!had[key] || BY_KEY.get(key).group === "latest") entries[key] = stamp(d, d);
      return entries;
    }
    for (const [key, raw] of Object.entries(given)) {
      const def = BY_KEY.get(key);
      if (!def) continue;
      if (String(raw === null || raw === undefined ? "" : raw).trim() === "") {
        if (had[key]) entries[key] = null;
        continue;
      }
      const value = cleanValue(key, raw);
      if (value === null) throw new LoanError(`Check “${def.label}”: ${def.type === "date" ? "choose a date" : def.type === "text" ? "type some words" : "type a number"}.`);
      if (had[key] && had[key].value === value) continue;
      const d = merged[key];
      const hit = d && (d.value === value ? d : d.others.find((o) => o.value === value));
      entries[key] = hit ? stamp(d, hit) : { value, from: "typed" };
    }
    return entries;
  }

  /**
   * The owner pressed Save on the review of one or more documents.
   * @param input { tokens, loanId, scheduleToken, useSchedule, loan: the form's fields, details: { key: value | "" },
   *                paidMonths: ["YYYY-MM"], paidUpTo: "YYYY-MM" | "" }
   * @returns { id, docIds, dropped, marked, details }
   */
  async applyAll(owner, input, by = "") {
    const b = input && typeof input === "object" ? input : {};
    const batch = this._batch(owner, b.tokens);
    const loanId = String(b.loanId || "");
    const reviewed = this.combine(owner, { tokens: b.tokens, loanId, scheduleToken: b.scheduleToken });
    const source = reviewed.schedule.found ? batch.find((x) => x.token === reviewed.schedule.token) : null;
    const s = source ? source.p.schedule : null;
    const use = Boolean(b.useSchedule) && Boolean(s);
    if (use && s.rows.some((x) => x.principal === null)) throw new LoanError("This schedule does not say the principal: give the loan amount or the rate first, so it can be worked out.");
    const plan = use ? { rows: s.rows, how: s.how, amount: s.amount, rate: s.rate } : null;
    const tokenDocs = new Map(batch.map((x) => [x.token, `d${crypto.randomBytes(8).toString("hex")}`]));
    if (plan) plan.docId = tokenDocs.get(source.token);
    // everything is checked before anything is written
    const before = loanId ? this.loans.get(loanId) : null;
    if (before) {
      if (before.type === "cash") throw new LoanError("A cash loan from a person takes no documents.");
      if ((before.documents || []).length + batch.length > MAX_DOCS) throw new LoanError(`A loan keeps at most ${MAX_DOCS} documents. Remove some first.`);
    }
    const entries = this._reviewed(reviewed.details, b.details, (before && before.details) || {}, tokenDocs);
    let id = loanId;
    let dropped = [];
    if (loanId) {
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
    for (const { token, p } of batch) {
      const docId = tokenDocs.get(token);
      const view = this.view(token, p);
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
        usedSchedule: use && source.token === token,
        pagesRead: p.pageReads.size,
        pagesPictured: p.file.kind === "image" ? 0 : p.scans.length,
        values: Object.fromEntries(Object.entries(view.values).filter(([k]) => k !== "name").map(([k, v]) => [k, { label: v.label, value: v.value, from: v.from }])),
        terms: view.terms,
        summary: p.aiSummary,
        watch: p.aiWatch,
        aiModel: p.ai.done ? p.ai.model : "",
        uploadedAt: new Date(this.now()).toISOString(),
        by,
      };
      await this.docs.coldPut(STORE, docId, { loanId: id, name: p.file.name, mime: p.file.mime, data: p.buf.toString("base64"), text: redact(textOf(p)).text.slice(0, TEXT_KEPT) });
      this.loans.attachDocument(id, meta, by);
      this.pending.delete(token);
    }
    const saved = this.loans.setDetails(id, entries, by);
    let marked = 0;
    const upto = String(b.paidUpTo || "");
    if (Array.isArray(b.paidMonths) && b.paidMonths.length) marked = this.loans.markPaid(id, b.paidMonths.slice(0, 600), by);
    else if (upto) {
      try {
        marked = this.loans.paidUpTo(id, upto, by);
      } catch (err) {
        if (!(err instanceof LoanError) || !/already marked paid/.test(err.message)) throw err;
      }
    }
    return { id, docIds: batch.map((x) => tokenDocs.get(x.token)), dropped, marked, details: saved };
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
        base.details = Object.fromEntries(Object.entries(l.details || {}).filter(([k]) => BY_KEY.has(k)).map(([k, d]) => [BY_KEY.get(k).label, typeof d.value === "string" ? redact(d.value).text : d.value]));
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
  const uploads = limiter(150, 15 * 60 * 1000);
  const pages = limiter(400, 15 * 60 * 1000); // a long scan is read page by page
  const after = (result) => ({ ...loans.view(), ...result });
  const raw = express.raw({ type: () => true, limit: "8mb" });
  const smallRaw = express.raw({ type: () => true, limit: "300kb" });

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
  app.post("/api/admin/loans/documents/combine", requireSuper, writes, wrap(async (req) => intake.combine(by(req), req.body)));
  app.post("/api/admin/loans/documents/apply-all", requireSuper, writes, wrap(async (req) => after({ applied: await intake.applyAll(by(req), req.body, by(req)) }), 201));
  app.get("/api/admin/loans/documents/:token/page/:page", requireSuper, pages, wrap(async (req, res) => {
    const picture = intake.pageImage(by(req), req.params.token, req.params.page);
    res.setHeader("Content-Type", picture.mime);
    res.setHeader("Content-Disposition", "attachment");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.end(picture.data);
    return undefined;
  }));
  app.post("/api/admin/loans/documents/:token/page/:page", requireSuper, pages, smallRaw, wrap(async (req) => intake.readPage(by(req), req.params.token, req.params.page, req.body)));
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

module.exports = { LoanIntake, mountLoanIntake, inText, partsOf, STORE, MAX_BATCH };
