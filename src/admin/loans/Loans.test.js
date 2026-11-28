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
  expect(screen.getByRole("button", { name: "Upload a repayment schedule" })).toBeTruthy();
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

test("an upload is read, shown for review with each detail's source, and saved only on Save", async () => {
  const preview = { token: "t1", loanId: "", matchId: "", file: { name: "schedule.pdf", size: 10, kind: "pdf", pages: 1, locked: false, note: "", unread: "" }, docType: { id: "schedule", label: "Repayment schedule" }, schedule: { found: true, how: "balance", needs: [], checks: { lines: 2, split: 2, addUp: 2, carry: 1, carryOf: 1, cleared: true }, warnings: [], totals: { emi: 24000, principal: 23000, interest: 1000 }, amount: 23000, rate: 9, count: 2, first: "2026-11-05", last: "2026-12-05", rows: [{ no: 1, date: "2026-11-05", emi: 12000, principal: 11400, interest: 600, closing: 11600 }, { no: 2, date: "2026-12-05", emi: 12000, principal: 11600, interest: 400, closing: 0 }] }, values: { name: { label: "Loan name", value: "Sample loan", from: "suggested" }, kind: { label: "Type", value: "personal", from: "document" }, openingDate: { label: "Opening date", value: "2026-10-01", from: "document" }, totalAmount: { label: "Total amount", value: 23000, from: "schedule" }, rate: { label: "Interest rate", value: 9.9, from: "ai", checked: false }, emiAmount: { label: "EMI amount", value: 12000, from: "schedule" }, firstEmiDate: { label: "First EMI date", value: "2026-11-05", from: "schedule" } }, terms: [], watch: [], summary: "", ai: { ready: false, done: false, picture: false, blanked: 0, error: "" } };
  window.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(preview) }));
  await show({ ...book(), loans: [] });
  fireEvent.click(screen.getByRole("button", { name: "Upload a repayment schedule" }));
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Choose the loan document"), { target: { files: [new File(["x"], "schedule.pdf", { type: "application/pdf" })] } });
  });
  expect(window.fetch.mock.calls[0][0]).toBe("/api/admin/loans/documents/read?name=schedule.pdf");
  const panel = screen.getByRole("region", { name: "Upload a loan document" });
  expect(panel.textContent).toMatch(/Not split by the lender: worked out from its balance/);
  expect(panel.textContent).toMatch(/EMI = principal \+ interest on 2 of 2 lines/);
  expect(panel.textContent).toMatch(/free AI · not in the document: check it/);
  expect(api).toHaveBeenCalledTimes(1); // only the page's own read: nothing saved yet
  api.mockResolvedValue({ ...book(), applied: { id: "l1", marked: 0, dropped: [] } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save to the loan book" }));
  });
  expect(api).toHaveBeenLastCalledWith("/api/admin/loans/documents/t1/apply", { method: "POST", body: { loanId: "", useSchedule: true, paidUpTo: "", loan: expect.objectContaining({ name: "Sample loan", totalAmount: "23000", firstEmiDate: "2026-11-05" }) } });
});
