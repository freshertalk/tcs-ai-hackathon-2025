"use strict";
// Several loan documents together (28 Nov 2026): one review from a sanction letter, a bare schedule and a statement — every
// detail extracted, the gaps of one paper filled by another, the EMIs a statement shows as paid (a bounced one left out),
// one Save keeping every file; long documents read by the free AI in parts; scanned pages read as pictures. All made up.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");

const { FileDocs } = require("../docs");
const { Loans, LoanError } = require("../loans");
const { LoanIntake, STORE, partsOf, MAX_BATCH } = require("../loan-intake");
const { fieldsOf, receiptsOf } = require("../loan-fields");
const { combine, paidMonths, instalmentsOf, differentLoans } = require("../loan-merge");
const { cleanValue } = require("../loan-details");
const { readOrKeep } = require("../loan-files");
const { pictureOf, crc32 } = require("../pdf-pictures");

const AT = Date.parse("2026-11-28T10:00:00+05:30");
const r2 = (x) => Math.round(x * 100) / 100;
const make = (desk) => {
  const docs = new FileDocs(fs.mkdtempSync(path.join(os.tmpdir(), "vpt-loanbatch-")));
  const loans = new Loans({ docs, now: () => AT, log: { error() {} } });
  return { docs, loans, intake: new LoanIntake({ loans, desk, docs, now: () => AT }) };
};

/* ------------------------------------------------------------------ made-up papers: ₹3,00,000 at 12% for 24 months */
const P = 300000;
const EMI = r2((P * 0.01 * 1.01 ** 24) / (1.01 ** 24 - 1));
const dayOf = (k) => `05/${String((k % 12) + 1).padStart(2, "0")}/${2026 + Math.floor(k / 12)}`;
const bareSchedule = ["Repayment Schedule", "Loan Account Number : 000011112222", "No  Date  EMI", ...Array.from({ length: 24 }, (_, k) => `${k + 1}  ${dayOf(k)}  ${EMI}`)].join("\n");
const sanction = ["SAMPLE BANK LIMITED", "Sanction Letter", "Dear Mr Test Person,", "Sanctioned Amount : Rs. 3,00,000", "Loan Amount : Rs. 3,00,000", "Rate of Interest : 12% per annum (fixed)", "Tenure : 24 months", "Sanction Date : 10/12/2025", "Processing Fee : Rs. 2,500", "Foreclosure charges : 3% of the principal outstanding", "Cheque Bounce Charges : Rs. 500 each time", "Loan Account Number : 000011112222", "Personal Loan"].join("\n");
const received = [1, 2, 3, 4, 6, 7, 8, 9, 10]; // May was missed; November not yet paid in this statement
const statement = [
  "SAMPLE BANK LIMITED",
  "Loan Account Statement",
  "Loan Account Number : 000011112222",
  "Statement as on : 20/10/2026",
  "Disbursement Date : 18/12/2025",
  "Number of EMIs paid : 9",
  "Principal Outstanding : 1,95,000.00",
  "Overdue Amount : 0.00",
  ...received.map((m) => `${`05/${String(m).padStart(2, "0")}/2026`}  NACH payment received  ${EMI}`),
  `05/05/2026  EMI payment received  ${EMI}`,
  `07/05/2026  NACH return - insufficient funds  ${EMI}`,
].join("\n");
const file = (text) => Buffer.from(text, "utf8");

test("the other details are read from a document's words; a count of EMIs paid is not the tenure", () => {
  const v = Object.fromEntries(Object.entries(fieldsOf(sanction).fields).map(([k, f]) => [k, f.value]));
  assert.deepEqual([v.sanctionAmount, v.sanctionDate, v.foreclosureCharge, v.bounceCharge, v.processingFee, v.tenureMonths], [300000, "2025-12-10", "3% of the principal outstanding", "Rs. 500 each time", 2500, 24]);
  const s = Object.fromEntries(Object.entries(fieldsOf(statement).fields).map(([k, f]) => [k, f.value]));
  assert.deepEqual([s.disbursementDate, s.asOnDate, s.emisPaid, s.outstanding, s.overdueAmount, s.tenureMonths], ["2025-12-18", "2026-10-20", 9, 195000, 0, undefined]);
  assert.equal(s.bounceCharge, undefined, "a bounced payment listed in a statement is not the bounce charge");
  assert.equal(fieldsOf("NACH return - insufficient funds 31,320.00").fields.bounceCharge, undefined);
  assert.equal(fieldsOf("ECS return charges : Rs. 450").fields.bounceCharge.value, "Rs. 450");
  const apr = fieldsOf("Annual Percentage Rate (APR) : 13.4%\nRate of Interest : 12% p.a.").fields;
  assert.deepEqual([apr.rate.value, apr.apr.value], [12, 13.4], "an APR is not the interest rate");
  assert.equal(fieldsOf("APR : 13.4%").fields.rate.value, 13.4, "unless it is all the paper says");
  assert.deepEqual([cleanValue("emiDay", "40"), cleanValue("sanctionDate", "2026-02-30"), cleanValue("sanctionAmount", "₹3,00,000"), cleanValue("lockIn", "  six   months "), cleanValue("nothing", "x")], [null, null, 300000, "six months", null]);
});

test("a statement's receipts become paid months: a bounced one is taken out, the same line twice counts once", () => {
  const instalments = instalmentsOf({ emi: EMI, firstEmiDate: "2026-01-05", today: "2026-11-28" });
  const receipts = receiptsOf(statement).map((r) => ({ ...r, file: "statement.txt" }));
  const paid = paidMonths({ receipts: [...receipts, ...receipts], count: null, instalments, today: "2026-11-28" });
  assert.equal(paid.how, "lines");
  assert.equal(paid.bounced, 1);
  assert.deepEqual(paid.months, received.map((m) => `2026-${String(m).padStart(2, "0")}`), "May bounced: not ticked, and June is not moved into it");
  const counted = paidMonths({ receipts: [], count: { value: 3, file: "s" }, instalments, today: "2026-11-28" });
  assert.deepEqual([counted.how, counted.months], ["count", ["2026-01", "2026-02", "2026-03"]]);
  assert.deepEqual(paidMonths({ receipts: [{ date: "2026-02-05", amounts: [999], undone: false }], count: null, instalments, today: "2026-11-28" }).months, [], "an amount that is not the EMI is not an EMI");
});

test("three papers make one review: the sanction letter gives the schedule its amount and rate; one Save keeps all three", async () => {
  const { docs, loans, intake } = make(null);
  const a = intake.read("me", "schedule.txt", file(bareSchedule));
  assert.deepEqual([a.schedule.how, a.schedule.needs], ["computed", ["amount", "rate"]], "alone, the bare schedule cannot be split");
  const b = intake.read("me", "sanction.txt", file(sanction));
  const c = intake.read("me", "statement.txt", file(statement));
  assert.equal(c.schedule.found, false, "a statement's payments are not a repayment schedule");
  const tokens = [a.token, b.token, c.token];
  const review = intake.combine("me", { tokens });
  assert.equal(loans.view().loans.length, 0, "nothing is saved by reviewing");
  assert.deepEqual([review.schedule.needs, review.schedule.amount, review.schedule.rate, review.schedule.rows[0].interest, review.schedule.rows[23].closing], [[], 300000, 12, 3000, 0]);
  assert.deepEqual([review.values.lender.value, review.values.totalAmount.value, review.values.rate.value, review.values.openingDate.value, review.values.openingDate.file, review.values.emiAmount.value, review.values.name.value], ["SAMPLE BANK LIMITED", 300000, 12, "2025-12-18", "statement.txt", EMI, "Sample Bank personal loan ··2222"]);
  assert.deepEqual([review.details.foreclosureCharge.value, review.details.foreclosureCharge.file, review.details.outstanding.value, review.details.asOnDate.value, review.details.sanctionDate.value], ["3% of the principal outstanding", "sanction.txt", 195000, "2026-10-20", "2025-12-10"]);
  assert.deepEqual([review.paid.how, review.paid.months.length, review.paid.bounced, review.paid.file], ["lines", 9, 1, "statement.txt"]);
  assert.deepEqual(review.warnings, []);
  assert.equal(review.files.length, 3);

  const form = { name: review.values.name.value, kind: "personal", openingDate: review.values.openingDate.value, totalAmount: "300000", rate: "12", emiAmount: String(EMI), firstEmiDate: "2026-01-05" };
  const details = Object.fromEntries(Object.entries(review.details).map(([k, d]) => [k, String(d.value)]));
  details.lockIn = "None"; // typed by the owner
  details.processingFee = "2,950"; // corrected by the owner
  await assert.rejects(intake.applyAll("me", { tokens, loan: form, useSchedule: true, details: { ...details, sanctionDate: "soon" } }, "me"), /Check “Sanction date”/);
  assert.equal(loans.view().loans.length, 0, "a bad field saves nothing at all");
  const done = await intake.applyAll("me", { tokens, scheduleToken: review.schedule.token, loan: form, useSchedule: true, details, paidMonths: review.paid.months }, "me");
  assert.deepEqual([done.docIds.length, done.marked], [3, 9]);
  const l = loans.view().loans[0];
  assert.deepEqual(l.rows.filter((x) => x.paid).map((x) => x.month), review.paid.months);
  assert.equal(l.rows.find((x) => x.month === "2026-05").state, "overdue", "the bounced month shows as overdue");
  assert.deepEqual(l.documents.map((d) => [d.name, d.usedSchedule]), [["schedule.txt", true], ["sanction.txt", false], ["statement.txt", false]]);
  assert.deepEqual([l.details.foreclosureCharge.from, l.details.foreclosureCharge.file, l.details.foreclosureCharge.docId], ["document", "sanction.txt", l.documents[1].id]);
  assert.deepEqual([l.details.lockIn.from, l.details.lockIn.value, l.details.processingFee.from, l.details.processingFee.value], ["typed", "None", "typed", 2950]);
  for (const d of l.documents) assert.ok((await docs.coldGet(STORE, d.id)).data, d.name);
  assert.equal((await docs.coldGet(STORE, l.documents[1].id)).text.includes("Test Person"), false);
  assert.throws(() => intake.combine("me", { tokens }), /no longer waiting/, "saved uploads are not kept waiting");
  assert.match(JSON.stringify(intake.figures(l.id).loans[0].details), /Foreclosure charge/);

  // edited later by hand; an unchanged value keeps its source, an emptied one is taken out
  loans.editDetails(l.id, { foreclosureCharge: "3% of the principal outstanding", bounceCharge: "", moratorium: "None" }, "me");
  const after = loans.view().loans[0].details;
  assert.deepEqual([after.foreclosureCharge.from, after.bounceCharge, after.moratorium.from], ["document", undefined, "typed"]);
  assert.throws(() => loans.editDetails(l.id, { apr: "lots" }, "me"), LoanError);

  // later papers for the same loan: matched by its number; they fill gaps and never overwrite unasked
  const d = intake.read("me", "newer-sanction.txt", file(sanction.replace("2,500", "9,999")));
  const again = intake.combine("me", { tokens: [d.token] });
  assert.equal(again.matchId, l.id);
  await intake.applyAll("me", { tokens: [d.token], loanId: l.id }, "me");
  assert.equal(loans.view().loans[0].details.processingFee.value, 2950, "your correction stays");
  assert.equal(loans.view().loans[0].documents.length, 4);
});

test("papers that look like two different loans are said to be; a batch is limited", () => {
  const { intake } = make(null);
  const a = intake.read("me", "one.txt", file(sanction));
  const b = intake.read("me", "two.txt", file(sanction.replace(/000011112222/g, "999988887777").replace(/3,00,000/g, "9,00,000")));
  const review = intake.combine("me", { tokens: [a.token, b.token] });
  assert.equal(review.warnings.length, 1);
  assert.match(review.warnings[0].why, /two\.txt shows a loan number ending 7777/);
  assert.deepEqual(review.values.totalAmount.others.map((o) => o.value), [900000], "the other figure stays in view to pick");
  // the odd one is named even when it was uploaded first
  const paper = (token, amount, from = "document") => ({ token, file: { name: `${token}.pdf` }, docType: { id: "agreement" }, accountLast4: "", values: { totalAmount: { value: amount, from } } });
  assert.deepEqual(differentLoans([paper("odd", 2500000), paper("a", 1500000), paper("b", 1500000, "schedule"), paper("c", 1480000)]).map((x) => x.token), ["odd"]);
  assert.throws(() => intake.combine("me", { tokens: [] }), /at least one/);
  assert.throws(() => intake.combine("me", { tokens: Array.from({ length: MAX_BATCH + 1 }, (_, i) => `t${i}`) }), /At most 12/);
  assert.throws(() => intake.combine("someone-else", { tokens: [a.token] }), /no longer waiting/);
  assert.equal(combine([]).warnings.length, 0);
});

/* ------------------------------------------------------------------ long documents and scans */
const desk = (answers) => {
  const asked = { words: [], pictures: [] };
  return {
    asked,
    status: () => ({ ready: true, model: "free model", setup: "" }),
    readDocument: async (text) => {
      asked.words.push(text);
      return { model: "free model", data: answers.words(asked.words.length, text) };
    },
    readPicture: async (image) => {
      asked.pictures.push(image);
      return { model: "free eyes", data: answers.picture(asked.pictures.length) };
    },
    readColumns: async () => ({ data: {} }),
  };
};

test("a long document is read by the free AI in parts, so nothing at the end is missed", async () => {
  const long = ["SAMPLE BANK", "Loan Agreement", ...Array.from({ length: 900 }, (_, i) => `Clause ${i}: the borrower agrees to the general conditions of this made-up agreement.`), "The security is a hypothecation of the vehicle."].join("\n");
  assert.ok(partsOf(long).length >= 3);
  assert.ok(partsOf(long).every((x) => x.length <= 22000));
  const free = desk({ words: (n, text) => (text.includes("hypothecation of the vehicle") ? { security: "Hypothecation of the vehicle", summary: "end" } : { summary: n === 1 ? "A made-up agreement" : "", rateType: "N/A" }), picture: () => ({}) });
  const { intake } = make(free);
  const a = intake.read("me", "agreement.txt", file(long));
  const seen = await intake.readWithAi("me", a.token);
  assert.equal(free.asked.words.length, partsOf(long).length);
  assert.deepEqual([seen.values.security.value, seen.summary, seen.values.rateType], ["Hypothecation of the vehicle", "A made-up agreement", undefined], "“N/A” is not a detail");
});

/** A PDF whose only page is one picture: a packed grey bitmap, as some scanners write. */
function scannedPdf() {
  const w = 800;
  const h = 1100;
  const raw = Buffer.alloc(w * h, 0xff);
  raw.fill(0, 0, w * 40);
  const image = zlib.deflateSync(raw);
  const draw = Buffer.from("q 595 0 0 842 0 0 cm /Im1 Do Q");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>",
    [`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.length} >>`, image],
    [`<< /Length ${draw.length} >>`, draw],
  ];
  const parts = [Buffer.from("%PDF-1.5\n")];
  objs.forEach((o, i) => {
    if (typeof o === "string") parts.push(Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`));
    else parts.push(Buffer.from(`${i + 1} 0 obj\n${o[0]}\nstream\n`), o[1], Buffer.from("\nendstream\nendobj\n"));
  });
  parts.push(Buffer.from("trailer\n<< /Root 1 0 R >>\n%%EOF\n"));
  return Buffer.concat(parts);
}

test("a scanned PDF gives its page picture; the free AI reads it, and what it read is marked as from the scan", async () => {
  const pdf = scannedPdf();
  const kept = readOrKeep("scan.pdf", pdf);
  assert.ok(kept.unread);
  assert.deepEqual(kept.scans.map((x) => [x.page, x.picture.ok]), [[1, true]]);
  const picture = pictureOf(kept.scans[0].picture);
  assert.equal(picture.mime, "image/png");
  assert.deepEqual([picture.data.readUInt32BE(16), picture.data.readUInt32BE(20)], [800, 1100]);
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);

  const free = desk({ words: () => ({}), picture: () => ({ text: "SAMPLE BANK Sanction Letter\nLoan Amount : Rs. 3,00,000\nRate of Interest : 12% per annum", lines: [], securityDeposit: "x", security: "None", loanAmount: "300000", terms: [] }) });
  const { loans, intake } = make(free);
  const a = intake.read("me", "scan.pdf", pdf);
  assert.deepEqual([a.scan.pages, a.scan.read, a.ai.ready, a.words], [[{ page: 1, ok: true, why: "" }], [], true, false]);
  await assert.rejects(intake.readWithAi("me", a.token), /read as pictures/);
  assert.equal(intake.pageImage("me", a.token, 1).mime, "image/png");
  assert.throws(() => intake.pageImage("me", a.token, 2), /no picture/);
  await assert.rejects(intake.readPage("me", a.token, 1, Buffer.from("<svg/>")), /JPEG, PNG or WebP/);
  await assert.rejects(intake.readPage("me", a.token, 1, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(300 * 1024)])), /too large/);
  const seen = await intake.readPage("me", a.token, 1, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1000)]));
  assert.equal(free.asked.pictures.length, 1);
  assert.deepEqual([seen.file.unread, seen.docType.id, seen.scan.read, seen.values.totalAmount.value, seen.values.totalAmount.from, seen.values.rate.from, seen.values.security.from, seen.values.security.checked], ["", "sanction", [1], 300000, "scan", "scan", "ai", null], "read off the scan: to be checked by eye");
  const done = await intake.applyAll("me", { tokens: [a.token], loan: { name: "From a scan", kind: "other", openingDate: "2026-01-01", totalAmount: "300000", rate: "12", emiAmount: "15000", firstEmiDate: "2026-11-05" } }, "me");
  const l = loans.view().loans[0];
  assert.deepEqual([l.documents[0].pagesRead, l.documents[0].pagesPictured, l.documents[0].unread, l.details.security.from], [1, 1, "", "ai"]);
  assert.ok((await intake.file(done.id, done.docIds[0])).data.equals(pdf), "the scan is kept as uploaded");
});
