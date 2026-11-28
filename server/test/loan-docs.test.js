"use strict";
// The loan book's documents (28 Nov 2026): reading repayment schedules into principal and interest (with and without the
// lender's split), the details found in a document's words, identity numbers blanked before any AI sees text, password-
// protected PDFs, the review-then-save flow, cash loans from people, and an AI that is NVIDIA's free models and nothing else.
// Everything here is made up. The PDFs in fixtures/loans were made with PyMuPDF (password 01011990).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { FileDocs, COLD } = require("../docs");
const { Loans, LoanError, simulate } = require("../loans");
const { LoanIntake, STORE } = require("../loan-intake");
const { parseSchedule, rateFor } = require("../loan-schedule");
const { fieldsOf, docTypeOf, redact } = require("../loan-fields");
const { readLoanFile, LoanFileError } = require("../loan-files");
const { LoanDesk, VISION } = require("../ai/loandesk");
const { AiError } = require("../ai/client");

const AT = Date.parse("2026-11-28T10:00:00+05:30");
const fixture = (n) => fs.readFileSync(path.join(__dirname, "fixtures", "loans", n));
const r2 = (x) => Math.round(x * 100) / 100;

/** A made-up reducing-balance loan as a table of cells in a chosen layout. */
function table(layout, { P = 300000, rate = 12, n = 24 } = {}) {
  const r = rate / 1200;
  const emi = r2((P * r * (1 + r) ** n) / ((1 + r) ** n - 1));
  let bal = P;
  const rows = [["Sample lender"], ["Instalment Date", "columns"]];
  for (let k = 0; k < n; k += 1) {
    const i = r2(bal * r);
    const p = k === n - 1 ? bal : r2(emi - i);
    const e = r2(p + i);
    const open = bal;
    bal = r2(bal - p);
    const date = `07/${String((k % 12) + 1).padStart(2, "0")}/${2025 + Math.floor(k / 12)}`;
    const v = { open: String(open), emi: String(e), p: String(p), i: String(i), bal: String(bal) };
    rows.push([String(k + 1), date, ...layout.map((c) => v[c])]);
  }
  return rows;
}

test("a schedule is read whatever its columns: the sums say which is principal and which is interest", () => {
  for (const [layout, how] of [
    [["open", "emi", "p", "i", "bal"], "lender"],
    [["emi", "i", "p", "bal"], "lender"], // interest before principal
    [["p", "i", "bal"], "lender"],
    [["emi", "p", "bal"], "lender"],
    [["emi", "i"], "lender"],
    [["emi", "bal"], "balance"], // not split: worked out from the balance
  ]) {
    const s = parseSchedule(table(layout), { hint: { amount: 300000 } });
    assert.equal(s.found, true, layout.join());
    assert.equal(s.how, how, layout.join());
    assert.deepEqual([s.rows.length, s.rows[0].interest, s.rows[0].principal, s.rows[23].closing, s.amount], [24, 3000, r2(s.rows[0].emi - 3000), 0, 300000], layout.join());
    assert.equal(s.checks.addUp, 24, layout.join());
    assert.ok(Math.abs(s.totals.principal - 300000) < 1, layout.join());
  }
});

test("instalments alone are split from the loan amount or the rate, and say what they still need", () => {
  const bare = parseSchedule(table(["emi"]));
  assert.deepEqual([bare.found, bare.how, bare.needs, bare.rows[0].principal], [true, "computed", ["amount", "rate"], null]);
  for (const hint of [{ amount: 300000 }, { rate: 12 }]) {
    const s = parseSchedule(table(["emi"]), { hint });
    assert.deepEqual([s.how, s.needs.length, Math.round(s.amount), s.rate, s.rows[0].interest, s.rows[23].closing], ["computed", 0, 300000, 12, 3000, 0], JSON.stringify(hint));
  }
  assert.equal(rateFor(300000, Array(24).fill(1000)), null, "instalments that never repay it give no rate");
  assert.equal(parseSchedule([["no table here"], ["Date 01/01/2026", "100"]]).found, false);
});

test("the details are found in the document's own words, and identity numbers are blanked for the AI", () => {
  const letter = ["SAMPLE BANK LIMITED", "Sanction Letter", "Dear Mr Test Person,", "Name: Test Person", "Loan Amount Sanctioned : Rs. 25,00,000/-", "Rate of Interest : 8.65% per annum (floating)", "Tenure : 20 years", "EMI Amount : Rs. 21,935", "First EMI Date : 05/05/2025", "Processing Fee : Rs. 5,000", "Foreclosure charges : Nil on floating rate home loan", "Loan Account Number : 123456789012", "PAN ABCDE1234F  Mobile 9876543210  someone@example.com", "Aadhaar 1234 5678 9012"].join("\n");
  const x = fieldsOf(letter);
  const v = Object.fromEntries(Object.entries(x.fields).map(([k, f]) => [k, f.value]));
  assert.deepEqual([v.loanAmount, v.rate, v.rateType, v.tenureMonths, v.emiAmount, v.firstEmiDate, v.processingFee, v.kind], [2500000, 8.65, "floating", 240, 21935, "2025-05-05", 5000, "home"]);
  assert.equal(x.accountLast4, "9012", "only the last four digits are kept");
  assert.ok(x.terms.some((t) => t.title === "Foreclosure / pre-payment"));
  assert.equal(docTypeOf(letter).id, "sanction");
  const hidden = redact(letter).text;
  for (const secret of ["123456789012", "ABCDE1234F", "9876543210", "someone@example.com", "1234 5678 9012", "Test Person"]) assert.equal(hidden.includes(secret), false, secret);
  assert.match(hidden, /Rs\. 25,00,000/, "the money stays");
});

test("a password-protected PDF opens only with its password: RC4, AES-128 and AES-256", () => {
  for (const name of ["loan-open.pdf", "loan-rc4.pdf", "loan-aes128.pdf", "loan-aes256.pdf"]) {
    const buf = fixture(name);
    const locked = name !== "loan-open.pdf";
    if (locked) {
      for (const password of ["", "wrong"]) assert.throws(() => readLoanFile(name, buf, { password }), (e) => e instanceof LoanFileError && e.code === "password", `${name} ${password}`);
    }
    const f = readLoanFile(name, buf, { password: "01011990" });
    const s = parseSchedule(f.rows);
    assert.deepEqual([f.locked, s.found, s.how, s.rows.length, s.amount, s.rows[0].interest, s.rows[11].closing], [locked, true, "lender", 12, 120000, 1200, 0], name);
    assert.equal(readLoanFile(name, buf, { password: "owner-secret-1" }).rows.length, f.rows.length, "the owner password opens it too");
  }
});

/* ------------------------------------------------------------------ upload, review, save */
const make = (desk) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpt-loandocs-"));
  const docs = new FileDocs(dir);
  const loans = new Loans({ docs, now: () => AT, log: { error() {} } });
  return { docs, loans, intake: new LoanIntake({ loans, desk, docs, now: () => AT }) };
};

test("a schedule is shown for review, then saved: months follow it, and a tick takes off principal and interest", async () => {
  const { docs, loans, intake } = make(null);
  const seen = intake.read("me", "schedule.pdf", fixture("loan-aes256.pdf"), { password: "01011990" });
  assert.deepEqual([seen.schedule.found, seen.schedule.count, seen.docType.id, seen.values.totalAmount.value, seen.values.rate.value, seen.values.emiAmount.from], [true, 12, "schedule", 120000, 12, "schedule"]);
  assert.equal(loans.view().loans.length, 0, "nothing is saved by reading");
  const done = await intake.apply("me", seen.token, { loan: { name: "Test loan", kind: "personal", openingDate: "2025-12-20" }, useSchedule: true, paidUpTo: "2026-02" }, "me");
  assert.equal(done.marked, 2);
  let l = loans.view().loans[0];
  assert.deepEqual([l.method, l.plan.instalments, l.rows.length, l.upcoming.length, l.emiAmount], ["schedule", 12, 11, 1, l.rows[0].emi]);
  const [jan, feb, mar] = l.rows;
  assert.deepEqual([jan.interest, jan.principal, jan.paid], [1200, r2(jan.emi - 1200), true]);
  assert.equal(l.summary.outstanding, r2(120000 - jan.principal - feb.principal), "principal remaining");
  const interestAll = r2([...l.rows, ...l.upcoming].reduce((a, x) => a + x.interest, 0));
  assert.equal(l.summary.interestRemaining, r2(interestAll - jan.interest - feb.interest), "interest remaining");
  assert.equal(l.summary.totalToPay, r2(l.summary.outstanding + l.summary.interestRemaining));
  loans.setMonth(l.id, mar.month, { paid: true }, "me");
  const after = loans.view();
  l = after.loans[0];
  assert.equal(r2(after.totals.outstanding + mar.principal), r2(120000 - jan.principal - feb.principal), "principal falls by the principal part");
  assert.equal(after.totals.interestRemaining, r2(interestAll - jan.interest - feb.interest - mar.interest), "interest falls by the interest part");
  assert.deepEqual([after.totals.paidPrincipal, after.totals.paidInterest], [r2(jan.principal + feb.principal + mar.principal), r2(jan.interest + feb.interest + mar.interest)]);
  // the file is kept apart in the database, downloadable, and listed on the loan
  assert.ok(COLD.includes(STORE));
  assert.equal(l.documents.length, 1);
  const file = await intake.file(l.id, l.documents[0].id);
  assert.ok(file.data.equals(fixture("loan-aes256.pdf")), "the file itself, as uploaded");
  assert.equal(JSON.stringify(docs.items("loans")).includes("01011990"), false, "the password is not kept");
  await intake.removeDocument(l.id, l.documents[0].id, "me");
  assert.equal(await docs.coldGet(STORE, l.documents[0].id), null);
  assert.throws(() => intake.view("x", intake._get("nope", "me")), LoanError);
});

test("a schedule applied to a loan already in the book keeps its ticks and remarks", async () => {
  const { loans, intake } = make(null);
  const id = loans.add({ name: "Existing", kind: "personal", openingDate: "2025-12-20", totalAmount: 120000, rate: 11, emiAmount: 11000, firstEmiDate: "2026-01-05" }, "me");
  loans.setMonth(id, "2026-01", { paid: true, remarks: "auto debit" }, "me");
  const seen = intake.read("me", "schedule.pdf", fixture("loan-open.pdf"), { loanId: id });
  await intake.apply("me", seen.token, { loanId: id, useSchedule: true }, "me");
  const l = loans.view().loans[0];
  assert.deepEqual([l.method, l.rate, l.rows[0].paid, l.rows[0].remarks, l.rows[0].interest], ["schedule", 12, true, "auto debit", 1200]);
  loans.update(id, { ...l, name: "Existing (renamed)", emiAmount: 99999, method: undefined }, "me");
  assert.equal(loans.view().loans[0].rows[0].emi, l.rows[0].emi, "the lender's months are not rewritten by new terms");
  assert.throws(() => intake.read("someone-else", "x.pdf", fixture("loan-open.pdf"), { loanId: "missing" }), /no longer there/);
});

test("cash from a person: only who, when, how much and a note; repayments by hand; settle and undo", () => {
  const { loans, intake } = make(null);
  const id = loans.add({ type: "cash", name: "A friend", openingDate: "2026-03-01", totalAmount: "50,000", remarks: "for repairs", rate: 99, emiAmount: 5 }, "me");
  let l = loans.view().loans[0];
  assert.deepEqual([l.type, l.rate, l.emiAmount, l.rows.length, l.summary.outstanding], ["cash", undefined, undefined, 0, 50000], "no rate, EMI or monthly rows");
  const p1 = loans.addPayment(id, { date: "2026-05-01", amount: 20000, note: "UPI" }, "me");
  assert.throws(() => loans.addPayment(id, { date: "2026-05-02", amount: 40000 }, "me"), /more than is still owed/);
  assert.throws(() => loans.addPayment(id, { date: "2026-02-01", amount: 10 }, "me"), /before the day/);
  loans.updatePayment(id, p1, { date: "2026-05-03", amount: 25000, note: "cash" }, "me");
  loans.settle(id, true, "me");
  l = loans.view().loans[0];
  assert.deepEqual([l.summary.outstanding, l.summary.closed, l.payments.map((x) => x.outstanding)], [0, true, [25000, 0]]);
  loans.settle(id, false, "me");
  loans.update(id, { name: "A friend", openingDate: "2026-03-01", totalAmount: 60000 }, "me");
  const v = loans.view();
  assert.deepEqual([v.loans[0].summary.outstanding, v.totals.cash.outstanding, v.totals.outstanding, v.totals.emiPerMonth], [35000, 35000, 35000, 0]);
  assert.throws(() => loans.setMonth(id, "2026-05", { paid: true }, "me"), /no monthly EMIs/);
  assert.throws(() => intake.read("me", "x.pdf", fixture("loan-open.pdf"), { loanId: id }), /no documents to read/);
});

/* ------------------------------------------------------------------ the AI: NVIDIA's free models only */
function fakeAi({ key = "nvapi-test", fail = false, data = {} } = {}) {
  const used = [];
  return {
    used,
    _key: (id) => (id === "nvidia" ? key : "sk-paid-key"),
    _modelOf: () => "meta/llama-3.3-70b-instruct",
    _settings: () => ({ aiFreeBackup: "qwen/qwen3-next-80b-a3b-instruct" }),
    validModel: () => true,
    modelsFor: () => [{ id: "meta/llama-3.3-70b-instruct", name: "Llama 3.3 70B" }],
    engine: {
      client: (spec, opts) => ({
        ask: async (req) => {
          used.push({ provider: spec.providerId, model: spec.model, brains: opts.brains, sent: req });
          if (fail) throw new AiError("busy", "rate_limited", 429);
          return { data: typeof data === "function" ? data(req) : data };
        },
      }),
    },
  };
}

test("the loan AI asks NVIDIA's free models and nothing else — never a paid company, even when they fail", async () => {
  const bad = fakeAi({ fail: true });
  await assert.rejects(new LoanDesk({ ai: bad }).readDocument("text"), /NVIDIA’s free AI could not answer/);
  assert.deepEqual(bad.used.map((u) => u.provider), ["nvidia", "nvidia"], "the chosen free model, then the second free one");
  await assert.rejects(new LoanDesk({ ai: bad }).readPicture({ mediaType: "image/jpeg", data: "x" }));
  assert.deepEqual(bad.used.slice(2).map((u) => [u.provider, u.model]), VISION.map((m) => ["nvidia", m]));
  assert.ok(bad.used.every((u) => u.brains === false), "no trading rules go with a loan request");
  const none = fakeAi({ key: "" });
  assert.equal(new LoanDesk({ ai: none }).status().ready, false, "a paid key does not make it ready");
  await assert.rejects(new LoanDesk({ ai: none }).insights({}), /free NVIDIA key/);
  assert.equal(none.used.length, 0);
});

test("what the AI reads is blanked on the way out, checked against the document, and saved only after review", async () => {
  const letter = ["SAMPLE BANK LIMITED", "Sanction letter", "Name: Test Person", "Loan Account Number : 123456789012", "Your home loan of 2500000 is approved.", "Disbursed on the 12th of March 2025.", "Prepayment: no charge is levied on floating rate loans."].join("\n");
  const ai = fakeAi({ data: { docType: "sanction", lender: "Sample Bank", loanType: "home", openingDate: "2025-03-12", loanAmount: "2500000", interestRate: "9.9", tenureMonths: "", emiAmount: "", firstEmiDate: "", processingFee: "", outstanding: "", summary: "A sanction letter.", terms: [{ title: "Prepayment", detail: "Free.", quote: "Prepayment: no charge is levied on floating rate loans." }, { title: "Made up", detail: "x", quote: "this line is not in the letter" }], watch: ["Check the rate."] } });
  const { loans, intake } = make(new LoanDesk({ ai }));
  const first = intake.read("me", "letter.txt", Buffer.from(letter));
  const seen = await intake.readWithAi("me", first.token);
  assert.equal(seen.ai.done, true);
  const sent = ai.used[0].sent.user;
  assert.equal(sent.includes("123456789012") || sent.includes("Test Person"), false, "blanked before it left");
  assert.deepEqual([seen.values.rate.from, seen.values.rate.value, seen.values.rate.checked], ["ai", 9.9, false], "a figure that is not in the document is marked");
  assert.equal(seen.values.totalAmount.checked !== false, true);
  assert.deepEqual([seen.values.openingDate.value, seen.values.openingDate.from], ["2025-03-12", "document"], "the words gave it: the AI is not needed for it");
  assert.deepEqual(seen.terms.filter((t) => t.from === "ai").map((t) => [t.title, t.checked]), [["Made up", false]], "the clause the words already gave is not repeated; the invented one is marked");
  assert.ok(seen.terms.some((t) => t.from === "document" && /no charge is levied/.test(t.quote)));
  assert.equal(loans.view().loans.length, 0);
});

test("the analysis never names a person, and the what-if is a reducing-balance estimate", async () => {
  let given = null;
  const ai = fakeAi({ data: (req) => ((given = req.user), { summary: "Fine.", points: [], questions: [] }) });
  const { loans, intake } = make(new LoanDesk({ ai }));
  loans.add({ type: "cash", name: "Secret Person Name", openingDate: "2026-01-01", totalAmount: 1000 }, "me");
  loans.add({ name: "Car loan", kind: "car", openingDate: "2026-05-01", totalAmount: 600000, rate: 9, emiAmount: 12500, firstEmiDate: "2026-06-05" }, "me");
  await intake.insights("", "me");
  assert.equal(given.includes("Secret Person Name"), false);
  assert.match(given, /Cash from person 1/);
  assert.match(given, /interestSavedAbout/);
  assert.equal(loans.view().insight.book.summary, "Fine.");
  const plain = simulate(500000, 12, 12000);
  const sooner = simulate(500000, 12, 12000, { lump: 100000 });
  const lower = simulate(500000, 12, 12000, { lump: 100000, mode: "emi" });
  assert.ok(sooner.months < plain.months && sooner.interest < plain.interest);
  assert.ok(lower.emi < 12000 && Math.abs(lower.months - plain.months) <= 1 && sooner.interest < lower.interest);
});

test("a packed stream whose last byte looks like a line end is read whole (the file's own /Length is used)", () => {
  const zlib = require("node:zlib");
  const { pdfRows } = require("../pdf-text");
  // find a packed piece of page text that ends in a line-end byte: trimming it would cut the data and lose the words
  let packed = null;
  let n = 0;
  while (!packed && n < 20000) {
    n += 1;
    const z = zlib.deflateSync(Buffer.from(`BT /F1 10 Tf 50 700 Td (Instalment ${n}) Tj ET`));
    if (z[z.length - 1] === 0x0a || z[z.length - 1] === 0x0d) packed = z;
  }
  assert.ok(packed, "such a stream exists");
  const head = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n";
  for (const length of [`/Length ${packed.length}`, "/Length 6 0 R"]) {
    const pdf = Buffer.concat([Buffer.from(`${head}6 0 obj\n${packed.length}\nendobj\n4 0 obj\n<< ${length} /Filter /FlateDecode >>\nstream\n`, "latin1"), packed, Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1")]);
    assert.equal(pdfRows(pdf).text, `Instalment ${n}`, length);
  }
});

test("every uploaded paper can be kept and shown again: also a locked one left closed, and a sheet as its rows", async () => {
  const { loans, intake } = make(null);
  const id = loans.add({ name: "Kept loan", kind: "personal", openingDate: "2025-12-20", totalAmount: 120000, rate: 12, emiAmount: 10662, firstEmiDate: "2026-01-05" }, "me");
  assert.throws(() => intake.read("me", "locked.pdf", fixture("loan-aes256.pdf"), { loanId: id }), (e) => e.code === "password");
  const locked = intake.read("me", "locked.pdf", fixture("loan-aes256.pdf"), { loanId: id, keep: true });
  assert.deepEqual([locked.file.locked, locked.schedule.found, /kept locked/.test(locked.file.unread), locked.ai.ready], [true, false, true, false]);
  await intake.apply("me", locked.token, { loanId: id }, "me");
  const old = intake.read("me", "old-statement.xls", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]), { loanId: id });
  assert.match(old.file.unread, /old Office file/);
  await intake.apply("me", old.token, { loanId: id }, "me");
  const csv = intake.read("me", "payments.csv", Buffer.from("Date,Amount\n05-01-2026,10662\n"), { loanId: id });
  await intake.apply("me", csv.token, { loanId: id }, "me");
  assert.throws(() => intake.read("me", "run.exe", Buffer.from("MZ\u0000\u0001\u0002\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000", "latin1"), { loanId: id, keep: true }), LoanFileError, "a program is never kept");
  const docs = loans.view().loans[0].documents;
  assert.deepEqual(docs.map((d) => d.name), ["locked.pdf", "old-statement.xls", "payments.csv"]);
  const shown = [];
  for (const d of docs) shown.push(await intake.preview(id, d.id));
  assert.deepEqual(shown.map((x) => x.show), ["pdf", "none", "table"]);
  assert.deepEqual(shown[2].rows, [["Date", "Amount"], ["05-01-2026", "10662"]]);
  for (const d of docs) assert.ok((await intake.file(id, d.id)).data.length > 0, d.name);
});

test("the suggested name is short and readable: no “Limited”, no shouting capitals", () => {
  const { intake } = make(null);
  const name = (first) => intake.read("me", "x.txt", Buffer.from(`${first}\nLoan Amount : Rs. 5,00,000\nHome Loan sanction\n`)).values.name.value;
  assert.equal(name("SAMPLE FINANCE LIMITED"), "Sample Finance home loan");
  assert.equal(name("HDFC Bank Ltd."), "HDFC Bank home loan");
});
