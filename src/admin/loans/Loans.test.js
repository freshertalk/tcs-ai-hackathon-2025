import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import Loans from "./Loans";
import { api } from "../api";
import { attentionOf, byYear, exportSet, financialYear, interestLeftAfter, previewOf, prepayRank, registerFor, simulate } from "./loanData";
import { drawPdf, pdfSafe, toCsv, toXlsx } from "./exports";

const mockSnack = jest.fn();
jest.mock("../api", () => ({ api: jest.fn(), peek: () => null }));
jest.mock("../visible", () => ({ everyVisible: () => () => {} }));
jest.mock("../live", () => ({ useTopics: () => {}, useLive: () => ({ status: "live" }) }));
jest.mock("../ux/snack", () => ({ snack: (...a) => mockSnack(...a) }));
jest.mock("../dialog/DialogProvider", () => ({ useDialog: () => () => Promise.resolve(true) }));

// made-up figures
const row = (month, paid, outstanding, extra = {}) => ({ month, date: `${month}-05`, rate: 9, emi: 12000, principal: month === "2026-10" ? 8250 : 8340, interest: month === "2026-10" ? 3750 : 3660, paid, paidAt: paid ? `${month}-05T04:30:00.000Z` : null, extra: 0, bankBalance: null, remarks: "", updatedAt: "2026-11-27T04:30:00.000Z", reduced: paid ? 12000 : 0, outstanding, state: paid ? "paid" : month < "2026-11" ? "overdue" : "overdue", ...extra });
const book = (novPaid = false) => {
  const out = novPaid ? 476000 : 488000;
  const loan = {
    id: "l1", type: "bank", name: "Test car loan", documents: [], upcoming: [{ month: "2026-12", date: "2026-12-05", emi: 12000, principal: 8400, interest: 3600, closing: 463000 }], kind: "car", openingDate: "2026-08-20", totalAmount: 500000, rate: 9, emiAmount: 12000, firstEmiDate: "2026-10-05", emiDay: 5, startBalance: 500000, method: "emi", remarks: "", updatedAt: "2026-11-27T04:30:00.000Z",
    rows: [row("2026-10", true, 488000), row("2026-11", novPaid, out)],
    summary: { split: true, interestRemaining: novPaid ? 94340 : 98000, totalToPay: out + (novPaid ? 94340 : 98000), paidPrincipal: novPaid ? 16590 : 8250, paidInterest: novPaid ? 7410 : 3750, outstanding: out, closed: false, repaidPct: ((500000 - out) / 500000) * 100, paidCount: novPaid ? 2 : 1, paidAmount: novPaid ? 24000 : 12000, extraPaid: 0, overdueCount: novPaid ? 0 : 1, overdueAmount: novPaid ? 0 : 12000, next: { month: "2026-11", date: "2026-11-05", amount: 12000, principal: 8340, interest: 3660, inDays: -23 }, interestThisMonth: 3660, emisLeft: 41, endMonth: "2030-04", atRate: { count: 49, interest: 98000 }, coversInterest: true },
  };
  return {
    at: "2026-11-28T04:30:00.000Z", today: "2026-11-28", loans: [loan], removed: [],
    ai: { ready: false, model: "", setup: "Add your free NVIDIA key on the AI page." }, insight: { book: null, byLoan: {}, asked: [] },
    totals: { cash: { count: 0, open: 0, borrowed: 0, outstanding: 0 }, bankOutstanding: out, cashOutstanding: 0, interestRemaining: novPaid ? 94340 : 98000, interestUnknown: 0, totalToPay: out + (novPaid ? 94340 : 98000), paidPrincipal: 8250, paidInterest: 3750, loans: 1, active: 1, closed: 0, borrowed: 500000, outstanding: out, repaidPct: loan.summary.repaidPct, emiPerMonth: 12000, avgRate: 9, interestThisMonth: 3660, month: { month: "2026-11", count: 1, amount: 12000, principal: 8340, interest: 3660, paidCount: novPaid ? 1 : 0, paidAmount: novPaid ? 12000 : 0, leftAmount: novPaid ? 0 : 12000 }, overdueCount: loan.summary.overdueCount, overdueAmount: loan.summary.overdueAmount, next: { loanId: "l1", name: loan.name, ...loan.summary.next }, debtFree: "2030-04" },
    saved: { last: { at: "2026-11-27T04:30:00.000Z", by: "owner@example.com", name: "Test car loan", what: novPaid ? "Nov 2026: EMI marked paid" : "Loan added with 2 monthly rows" }, byPerson: null, autoAt: "2026-11-01T00:00:00.000Z", store: "mongo" },
    history: [], kinds: [{ id: "car", label: "Car / vehicle loan" }], methods: [{ id: "emi", label: "The whole EMI comes off the outstanding" }],
  };
};

beforeEach(() => {
  api.mockReset();
  mockSnack.mockReset();
  window.sessionStorage.clear();
});

const show = async (data = book()) => {
  api.mockResolvedValue(data);
  const view = render(<div className="adm"><Loans /></div>);
  await act(async () => Promise.resolve());
  return view;
};

test("the register carries the owner's columns, first-sight figures and when it was last saved", async () => {
  await show();
  const table = screen.getAllByRole("table")[0];
  const heads = within(table).getAllByRole("columnheader").map((h) => h.textContent);
  expect(heads).toEqual(["Sr. No.", "Loan", "Opening Date", "Total Amount", "Interest Rate", "EMI Date", "EMI Amount", "Outstanding Loan Amount", "Is Paid?", "Remarks"]);
  expect(table.textContent).toMatch(/1Test car loan20 Aug 2026₹5,00,000\.009%05 Nov 2026Overdue by 23 days/);
  const glance = screen.getByRole("region", { name: "Loans at a glance" });
  expect(glance.textContent).toMatch(/Principal remaining₹4,88,000\.00/);
  expect(glance.textContent).toMatch(/Interest remaining₹98,000\.00/);
  expect(table.textContent).toMatch(/₹12,000\.00Principal ₹8,340\.00Interest ₹3,660\.00/);
  expect(table.textContent).toMatch(/Principal₹4,88,000\.00Interest ₹98,000\.00Total ₹5,86,000\.00/);
  expect(glance.textContent).toMatch(/Overdue₹12,000\.00/);
  expect(glance.textContent).toMatch(/Last loan endsApr 2030/);
  const foot = screen.getByRole("contentinfo", { name: "Last saved" });
  expect(foot.textContent).toMatch(/Last saved27 Nov 2026, 10:00:00 am IST by owner@example\.com — Test car loan: Loan added with 2 monthly rows/i);
  expect(foot.textContent).toMatch(/Saved in the database \(MongoDB\)/);
});

test("ticking Is paid? saves it, shows the server's new outstanding and offers Undo", async () => {
  await show();
  api.mockResolvedValue(book(true));
  await act(async () => {
    fireEvent.click(screen.getByRole("checkbox", { name: /Is paid: Test car loan, Nov 2026/ }));
  });
  expect(api).toHaveBeenLastCalledWith("/api/admin/loans/l1/months/2026-11", { method: "PUT", body: { paid: true } });
  expect(screen.getByRole("region", { name: "Loans at a glance" }).textContent).toMatch(/Principal remaining₹4,76,000\.00/);
  expect(screen.getByRole("region", { name: "Loans at a glance" }).textContent).toMatch(/Interest remaining₹94,340\.00/);
  expect(mockSnack).toHaveBeenCalledWith(expect.stringMatching(/marked paid\. Outstanding now ₹4,76,000\.00/), expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }));
});

test("a remark is saved when the box is left, only if it changed", async () => {
  await show();
  const box = screen.getByRole("textbox", { name: "Remarks for Test car loan, Nov 2026" });
  fireEvent.blur(box);
  expect(api).toHaveBeenCalledTimes(1);
  fireEvent.change(box, { target: { value: "paid by UPI" } });
  await act(async () => {
    fireEvent.blur(box);
  });
  expect(api).toHaveBeenLastCalledWith("/api/admin/loans/l1/months/2026-11", { method: "PUT", body: { remarks: "paid by UPI" } });
});

test("an empty book says how to begin, and the form says what will happen before anything is saved", async () => {
  await show({ ...book(), loans: [] });
  expect(screen.getByRole("button", { name: "Upload your loan documents" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Add your first loan" }));
  expect(screen.getByRole("form", { name: "Add a loan" })).toBeTruthy();
  expect(previewOf({ totalAmount: "5,00,000", rate: "9", emiAmount: "12000", firstEmiDate: "2026-09-05", startBalance: "" }, "2026-11-28")).toEqual({ rows: 3, interest: 3750, principal: 8250, short: false });
  expect(previewOf({ totalAmount: "100000", rate: "24", emiAmount: "1500", firstEmiDate: "2026-11-05" }, "2026-11-28").short).toBe(true);
});

test("the downloads: the same figures in CSV, a real workbook and a PDF; a formula in a remark stays text", () => {
  const data = book();
  data.loans[0].rows[1].remarks = '=HYPERLINK("x"), ₹';
  expect(registerFor(data, "2026-11").totals).toMatchObject({ emi: 12000, principal: 8340, interest: 3660, outstanding: 488000, interestLeft: 98000, paid: 0, count: 1 });
  expect(attentionOf(data)[0].text).toMatch(/was due on 05 Nov 2026 and is not ticked paid/);
  const set = exportSet(data, "month", { month: "2026-11" });
  const csv = toCsv(set.detail, ["Generated now"]);
  expect(csv).toMatch(/^﻿Sr\. No\.,Loan,Opening Date,Total Amount,Interest Rate \(% a year\),EMI Date,EMI Amount,Principal in EMI,Interest in EMI,Outstanding Loan Amount \(principal\),Interest Remaining,Total Still To Pay,Is Paid\?,Remarks/);
  expect(csv).toContain(`1,Test car loan,2026-08-20,500000,9,2026-11-05,12000,8340,3660,488000,98000,586000,No,"'=HYPERLINK(""x""), ₹"`);
  const all = exportSet(data, "all", {});
  expect(all.tables.map((t) => t.name)).toEqual(["Summary", "All EMIs"]);
  const bytes = toXlsx(all.tables, ["Generated now"]);
  expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  const text = String.fromCharCode(...bytes);
  expect(text).toContain('<sheet name="Summary" sheetId="1"');
  expect(text).toContain('t="inlineStr"><is><t xml:space="preserve">=HYPERLINK(&quot;x&quot;)');
  expect(text).not.toContain("<f>"); // no formula anywhere in the book
  const one = exportSet(data, "loan", { loanId: "l1" }).detail;
  expect(one.rows.map((r) => r.paid)).toEqual(["Yes", "No", "To come"]);
  expect(pdfSafe("₹5 — बैंक")).toBe("Rs 5 - ????");
  // the PDF is drawn with the library's calls: a stand-in records what would be written
  const written = [];
  const noop = () => {};
  function Fake() {
    return { internal: { pageSize: { getWidth: () => 297, getHeight: () => 210 } }, setFont: noop, setFontSize: noop, setTextColor: noop, setFillColor: noop, setDrawColor: noop, rect: noop, line: noop, addPage: noop, setPage: noop, getNumberOfPages: () => 1, splitTextToSize: (s) => [s], text: (s) => written.push(s) };
  }
  drawPdf(Fake, set, { stamp: ["Generated now"] });
  expect(written).toEqual(expect.arrayContaining(["Loan register: November 2026", "Interest Remaining", "4,88,000.00", "3,660.00", "05-11-2026", "Page 1 of 1"]));
});

/* ------------------------------------------------------------------ cash, schedules and documents */
const cashLoan = { id: "c1", type: "cash", name: "A friend", openingDate: "2026-03-15", totalAmount: 80000, remarks: "no interest", documents: [], rows: [], upcoming: [], updatedAt: "2026-11-27T04:30:00.000Z", payments: [{ id: "p1", date: "2026-06-02", amount: 25000, note: "UPI", outstanding: 55000 }], summary: { outstanding: 55000, closed: false, repaidPct: 31.25, paidAmount: 25000, lastPaid: "2026-06-02" } };
const withCash = () => {
  const d = book();
  d.loans.push(cashLoan);
  d.totals.cash = { count: 1, open: 1, borrowed: 80000, outstanding: 55000 };
  return d;
};

test("cash from a person has only its own few things: no rate, no EMI, no months", async () => {
  await show(withCash());
  const cash = screen.getByRole("region", { name: "Money from people" });
  const heads = within(cash).getAllByRole("columnheader").map((h) => h.textContent);
  expect(heads).toEqual(["Sr. No.", "From", "Date Taken", "Total Amount", "Paid Back", "Outstanding Loan Amount", "Is Paid?", "Remarks"]);
  expect(cash.textContent).not.toMatch(/Interest|EMI/);
  fireEvent.click(screen.getByRole("button", { name: "Add a loan" }));
  fireEvent.click(screen.getByRole("button", { name: /Cash from a person/ }));
  const form = screen.getByRole("form", { name: "Add a loan" });
  expect(form.textContent).toMatch(/From whom/);
  expect(form.textContent).not.toMatch(/Interest rate|EMI amount|EMI day|First EMI|schedule/);
  fireEvent.change(within(form).getByRole("textbox", { name: /From whom/ }), { target: { value: "Neighbour" } });
  fireEvent.change(within(form).getByRole("textbox", { name: /Amount/ }), { target: { value: "5000" } });
  api.mockResolvedValue({ ...withCash(), id: "c2" });
  await act(async () => {
    fireEvent.submit(form);
  });
  expect(api).toHaveBeenLastCalledWith("/api/admin/loans", { method: "POST", body: { type: "cash", name: "Neighbour", openingDate: "", totalAmount: "5000", remarks: "" } });
});

test("the split by financial year, and where prepaying saves the most", () => {
  const data = book();
  expect(financialYear("2027-03")).toBe("2026-27");
  expect(financialYear("2027-04")).toBe("2027-28");
  expect(byYear(data.loans)).toEqual([{ fy: "2026-27", principal: 24990, interest: 11010, paidPrincipal: 8250, paidInterest: 3750 }]);
  expect(interestLeftAfter(data.loans[0], data.loans[0].rows[0])).toBe(98000);
  expect(simulate(488000, 9, 12000, { lump: 100000 }).months).toBeLessThan(simulate(488000, 9, 12000).months);
  expect(prepayRank(data)[0].saved).toBeGreaterThan(0);
});

test("a saved document can be viewed (a sheet as its rows) and downloaded", async () => {
  const data = book();
  data.loans[0].documents = [{ id: "d1", name: "statement.csv", kind: "csv", docLabel: "Loan statement", uploadedAt: "2026-11-27T04:30:00.000Z", terms: [], values: {} }];
  await show(data);
  fireEvent.click(screen.getByRole("tab", { name: "Schedules" }));
  expect(screen.getByRole("link", { name: "Download statement.csv" }).getAttribute("href")).toBe("/api/admin/loans/l1/documents/d1");
  api.mockImplementation((url) => Promise.resolve(url.endsWith("/view") ? { show: "table", rows: [["Date", "Amount"], ["05-01-2026", "12000"]], name: "statement.csv" } : data));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "View statement.csv" }));
  });
  const dialog = screen.getByRole("dialog", { name: "Document: statement.csv" });
  expect(dialog.textContent).toMatch(/DateAmount05-01-202612000/);
  expect(api).toHaveBeenCalledWith("/api/admin/loans/l1/documents/d1/view");
});

/* ------------------------------------------------------------------ several documents, one review */
const defs = {
  detailDefs: [
    { key: "processingFee", label: "Processing fee (₹)", type: "money", group: "amounts" },
    { key: "foreclosureCharge", label: "Foreclosure charge", type: "text", group: "charges" },
    { key: "outstanding", label: "Principal outstanding stated (₹)", type: "money", group: "latest" },
    { key: "lockIn", label: "Lock-in", type: "text", group: "charges" },
  ],
  detailGroups: [["amounts", "Amounts and dates"], ["charges", "Charges and conditions"], ["latest", "Lender’s latest figures"]],
};
const schedule = { found: true, how: "balance", needs: [], checks: { lines: 2, split: 2, addUp: 2, carry: 1, carryOf: 1, cleared: true }, warnings: [], totals: { emi: 24000, principal: 23000, interest: 1000 }, amount: 23000, rate: 9, count: 2, first: "2026-10-05", last: "2026-11-05", rows: [{ no: 1, date: "2026-10-05", emi: 12000, principal: 11400, interest: 600, closing: 11600 }, { no: 2, date: "2026-11-05", emi: 12000, principal: 11600, interest: 400, closing: 0 }] };
const one = (token, name, label, extra = {}) => ({ token, file: { name, size: 10, kind: "pdf", pages: 1, locked: false, note: "", unread: "" }, docType: { id: token, label }, values: { name: { label: "Loan name", value: "x", from: "suggested" } }, schedule: { found: false, reason: "" }, terms: [], watch: [], summary: "", ai: { ready: false, done: false, picture: false, blanked: 0, error: "" }, scan: { pages: [], read: [] }, words: true, ...extra });
const from = (value, file, more = {}) => ({ value, from: "document", file, token: file, others: [], agree: 1, ...more });
const reviewOf = (infos) => ({
  loanId: "", matchId: "", today: "2026-11-28",
  files: infos.map((i) => ({ token: i.token, file: i.file, docType: i.docType, accountLast4: "", found: 3, schedule: i.schedule, ai: i.ai, scan: i.scan, words: i.words })),
  values: { name: { label: "Loan name", value: "Sample loan", from: "suggested", others: [] }, kind: from("personal", "sanction.pdf"), openingDate: from("2026-09-01", "statement.pdf"), totalAmount: { ...from(23000, "schedule.pdf"), from: "schedule" }, rate: from(9, "sanction.pdf", { others: [{ value: 9.9, file: "statement.pdf", from: "document" }] }), emiAmount: from(12000, "schedule.pdf"), firstEmiDate: from("2026-10-05", "schedule.pdf") },
  details: { processingFee: { ...from(2500, "sanction.pdf"), label: "Processing fee (₹)", group: "amounts", type: "money" }, foreclosureCharge: { ...from("3% of the balance", "sanction.pdf"), label: "Foreclosure charge", group: "charges", type: "text" }, outstanding: { ...from(11600, "statement.pdf"), label: "Principal outstanding stated (₹)", group: "latest", type: "money" } },
  schedule: { ...schedule, token: "t1", file: "schedule.pdf" }, schedules: [{ token: "t1", file: "schedule.pdf", count: 2, how: "balance", first: "2026-10-05", last: "2026-11-05" }],
  paid: { months: ["2026-10"], how: "lines", file: "statement.pdf", asOn: "2026-10-20", bounced: 0 }, warnings: [], terms: [], watch: [], summaries: [], accountLast4: "",
});
const respond = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
const choose = async (...names) => {
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Choose the loan documents"), { target: { files: names.map((n) => new File(["x"], n, { type: "application/pdf" })) } });
  });
  for (let i = 0; i < 12; i += 1) await act(async () => Promise.resolve());
};

test("several documents are read into one review: every detail editable with its source, paid months from the statement, saved only on Save", async () => {
  const infos = [one("t1", "schedule.pdf", "Repayment schedule", { schedule: { found: true, count: 2, how: "balance", needs: [] } }), one("t2", "sanction.pdf", "Sanction letter"), one("t3", "statement.pdf", "Loan statement")];
  let n = 0;
  window.fetch = jest.fn(() => respond(infos[n++]));
  await show({ ...book(), ...defs, loans: [] });
  api.mockImplementation((url, opts) => Promise.resolve(url.endsWith("/combine") ? reviewOf(infos.filter((i) => opts.body.tokens.includes(i.token))) : { ...book(), ...defs, applied: { id: "l1", docIds: ["d1", "d2", "d3"], marked: 1, dropped: [] } }));
  fireEvent.click(screen.getByRole("button", { name: "Upload your loan documents" }));
  await choose("schedule.pdf", "sanction.pdf", "statement.pdf");
  expect(window.fetch.mock.calls.map((c) => c[0])).toEqual(["schedule.pdf", "sanction.pdf", "statement.pdf"].map((f) => `/api/admin/loans/documents/read?name=${f}`));
  const panel = screen.getByRole("region", { name: "Upload a loan document" });
  expect(within(panel).getByRole("list", { name: "Documents chosen" }).textContent).toContain("0 details found");
  expect(within(panel).getByRole("list", { name: "Documents chosen" }).textContent).toMatch(/Repayment scheduleschedule\.pdf.*Sanction lettersanction\.pdf.*Loan statementstatement\.pdf/);
  expect(panel.textContent).toMatch(/Not split by the lender: worked out from its balance/);
  expect(panel.textContent).toMatch(/All the details found \(3\)/);
  expect(within(panel).getByRole("textbox", { name: "Foreclosure charge" }).value).toBe("3% of the balance");
  expect(panel.textContent).toMatch(/found in the document · sanction\.pdf/);
  expect(panel.textContent).toMatch(/statement\.pdf says 9\.9%/);
  expect(within(panel).getByRole("combobox", { name: /EMIs already paid/ }).value).toBe("statement");
  expect(panel.textContent).toMatch(/With these ticked, ₹11,600\.00 of principal is left: the same as statement\.pdf/);
  expect(api.mock.calls.every((c) => !c[0].endsWith("/apply-all"))).toBe(true); // nothing saved yet

  // review and edit: pick the other rate, correct a charge, add one that was not found, clear one
  fireEvent.click(within(panel).getByRole("button", { name: "Use 9.9 from statement.pdf" }));
  fireEvent.change(within(panel).getByRole("textbox", { name: "Foreclosure charge" }), { target: { value: "2% of the balance" } });
  fireEvent.click(within(panel).getByRole("button", { name: "Add other details" }));
  fireEvent.change(within(panel).getByRole("textbox", { name: "Lock-in" }), { target: { value: "6 months" } });
  fireEvent.change(within(panel).getByRole("textbox", { name: "Processing fee (₹)" }), { target: { value: "" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save to the loan book" }));
  });
  expect(api).toHaveBeenLastCalledWith("/api/admin/loans/documents/apply-all", {
    method: "POST",
    body: { tokens: ["t1", "t2", "t3"], loanId: "", scheduleToken: "t1", useSchedule: true, paidUpTo: "", paidMonths: ["2026-10"], details: { processingFee: "", foreclosureCharge: "2% of the balance", outstanding: "11600", lockIn: "6 months" }, loan: expect.objectContaining({ name: "Sample loan", totalAmount: "23000", rate: "9.9", firstEmiDate: "2026-10-05" }) },
  });
  expect(mockSnack).toHaveBeenCalledWith(expect.stringMatching(/Saved to the loan book · 3 documents kept · 1 EMIs ticked paid/), expect.anything());
});

test("a document left out is not saved; the free AI then reads each file's words by itself", async () => {
  const ready = { ready: true, done: false, picture: false, blanked: 2, error: "" };
  const infos = [one("t1", "a.pdf", "Sanction letter", { ai: ready }), one("t2", "b.pdf", "Loan agreement", { ai: ready })];
  let n = 0;
  window.fetch = jest.fn(() => respond(infos[n++]));
  await show({ ...book(), ...defs, loans: [], ai: { ready: true, model: "free", setup: "" } });
  api.mockImplementation((url, opts) => {
    if (url.endsWith("/combine")) return Promise.resolve(reviewOf(infos.filter((i) => opts.body.tokens.includes(i.token))));
    const ai = /documents\/(t\d)\/ai$/.exec(url);
    if (ai) return Promise.resolve({ ...infos.find((i) => i.token === ai[1]), ai: { ...ready, done: true, model: "free" } });
    return Promise.resolve({ ...book(), ...defs, applied: { id: "l1", docIds: ["d1"], marked: 0, dropped: [] } });
  });
  fireEvent.click(screen.getByRole("button", { name: "Upload your loan documents" }));
  expect(screen.getByRole("region", { name: "Upload a loan document" }).textContent).toMatch(/Read scanned pages and photos too\. A picture has no words to blank/);
  await choose("a.pdf", "b.pdf");
  expect(api.mock.calls.map((c) => c[0]).filter((u) => u.endsWith("/ai"))).toEqual(["/api/admin/loans/documents/t1/ai", "/api/admin/loans/documents/t2/ai"]);
  await act(async () => {
    fireEvent.click(screen.getByRole("checkbox", { name: "Save b.pdf with this loan" }));
  });
  expect(screen.getByRole("region", { name: "Upload a loan document" }).textContent).toMatch(/1 file is not part of this save and will not be kept/);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save to the loan book" }));
  });
  const saved = api.mock.calls.find((c) => c[0].endsWith("/apply-all"))[1].body;
  expect(saved.tokens).toEqual(["t1"]);
  expect(api).toHaveBeenCalledWith("/api/admin/loans/documents/t2", { method: "DELETE" });
});

test("a saved loan shows its details with where each came from, and they can be changed", async () => {
  const data = { ...book(), ...defs };
  data.loans[0].details = { processingFee: { value: 2500, from: "document", file: "sanction.pdf" }, lockIn: { value: "6 months", from: "typed" } };
  await show(data);
  fireEvent.click(screen.getByRole("tab", { name: "Schedules" }));
  const panel = screen.getByRole("region", { name: "Details of Test car loan" });
  expect(panel.textContent).toMatch(/Processing fee₹2,500\.00from the document · sanction\.pdf/);
  expect(panel.textContent).toMatch(/Lock-in6 monthstyped by you/);
  fireEvent.click(within(panel).getByRole("button", { name: "Edit details" }));
  fireEvent.change(within(panel).getByRole("textbox", { name: "Foreclosure charge" }), { target: { value: "Nil" } });
  fireEvent.change(within(panel).getByRole("textbox", { name: "Lock-in" }), { target: { value: "" } });
  await act(async () => {
    fireEvent.submit(within(panel).getByRole("form", { name: "Edit the details of Test car loan" }));
  });
  expect(api).toHaveBeenLastCalledWith("/api/admin/loans/l1/details", { method: "PUT", body: { details: { foreclosureCharge: "Nil", lockIn: "" } } });
  const set = exportSet(data, "loan", { loanId: "l1" });
  expect(set.tables.map((x) => x.name)).toEqual(["Schedule", "Loan details"]);
  expect(set.tables[1].rows.map((r) => [r.what, r.value, r.source])).toEqual([["Processing fee (₹)", "2500", "sanction.pdf"], ["Lock-in", "6 months", "typed by you"]]);
});
