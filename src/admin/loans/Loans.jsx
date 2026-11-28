// Loans (28 Nov 2026) — the workspace beside "Now": every loan, its instalments month by month, what is paid and what is
// still owed. For superadmins only; the server (server/loans.js) keeps the book in the database, makes each new month's
// rows by itself and works out the outstanding from the "Is paid?" ticks — this page never works it out for itself.
//
// Upload a loan's repayment schedule once (and any other loan paper): Upload.jsx shows what was read, you check and save.
// Each month then shows its principal and interest, and a tick takes them off "principal remaining" and "interest
// remaining". Money from a person (cash) keeps only who, when, how much, what is paid back and remarks (CashLoans.jsx).
//
// First sight: principal and interest still to pay, this month's EMIs, what is overdue, the next one due and the month the
// last loan ends; then what needs a tick. The tabs: This month (the register), Schedules (one loan, every month), Loans
// (add, change, remove), Analysis (Analysis.jsx) and History (who changed what). Under everything: when the book was last saved, and by whom.
// Downloads (PDF, CSV, Excel) are made in the browser from the figures on the page (exports.js).

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, peek } from "../api";
import { Alert } from "../ui";
import { DateField } from "../DatePicker";
import { useDialog } from "../dialog/DialogProvider";
import { everyVisible } from "../visible";
import { snack } from "../ux/snack";
import Skeleton from "../ux/Skeleton";
import { PageBar, PageHead, PagePart, SectionHead, usePageTab } from "../ux/PageKit";
import { attentionOf, bankLoans, cashLoans, dayName, exportSet, firstMonth, interestLeftAfter, monthName, previewOf, rateText, registerFor, rupees, shiftMonth, shortMonth, stampLines, stateText } from "./loanData";
import { Bar, RemarksBox, SplitBar, URL_, useHidden, when } from "./shared";
import Upload from "./Upload";
import LoanDetails from "./DetailsPanel";
import CashLoans from "./CashLoans";
import Analysis from "./Analysis";
import DocViewer from "./DocViewer";
import { download, pdfSafe } from "./exports";
import "./loans.css";

const TABS = [
  { id: "month", label: "This month", tip: "Every loan’s instalment for a month: tick it when you have paid it." },
  { id: "schedule", label: "Schedules", tip: "One loan, every month from its first EMI." },
  { id: "loans", label: "Loans", tip: "Add a loan, change its terms or remove it." },
  { id: "analysis", label: "Analysis", tip: "Principal and interest, by year, what prepaying changes, and the free AI’s reading." },
  { id: "history", label: "History", tip: "Every change, who made it and when." },
];
const TAB_IDS = TABS.map((t) => t.id);
const BLANK = { id: "", type: "bank", name: "", kind: "home", openingDate: "", totalAmount: "", rate: "", emiAmount: "", firstEmiDate: "", emiDay: "", startBalance: "", method: "principal", remarks: "" };

/* ------------------------------------------------------------------ first sight */
function Glance({ t, today }) {
  const m = t.month;
  const n = t.next;
  const h = useHidden();
  return (
    <section className={`lo-glance ${t.overdueCount ? "is-late" : ""}`} aria-label="Loans at a glance">
      <div className="lo-g lo-g--main">
        <small>Principal remaining</small>
        <b>{rupees(t.outstanding)}</b>
        <Bar pct={t.repaidPct} label="Share of the borrowed amount no longer owed" tone="is-good" />
        <span>
          {rateText(Math.round(t.repaidPct * 10) / 10)} of {rupees(t.borrowed, false)} repaid
        </span>
        <span className="lo-note">
          {t.active} active{t.closed ? ` · ${t.closed} closed` : ""}
          {t.cash.outstanding > 0 ? h(` · ${rupees(t.cash.outstanding, false)} of it cash from people`) : ""}
        </span>
      </div>
      <div className="lo-g">
        <small>Interest remaining</small>
        <b>{rupees(t.interestRemaining)}</b>
        <span>{h(`total still to pay ${rupees(t.totalToPay, false)}`)}</span>
        <span className="lo-note">
          {h(`interest paid so far ${rupees(t.paidInterest, false)}`)}
          {t.interestUnknown ? ` · ${t.interestUnknown} loan(s) without a split are not in it` : ""}
        </span>
      </div>
      <div className="lo-g">
        <small>{monthName(m.month)}</small>
        <b>{rupees(m.leftAmount)}</b>
        <span>{m.count ? (m.leftAmount > 0 ? "still to pay this month" : "all of this month’s EMIs are paid") : "no EMI this month"}</span>
        {m.count > 0 && (
          <>
            <Bar pct={m.amount > 0 ? (m.paidAmount / m.amount) * 100 : 0} label="Share of this month’s EMIs paid" tone="is-good" />
            <span className="lo-note">
              {h(`${m.paidCount} of ${m.count} paid · EMIs ${rupees(m.amount, false)} = principal ${rupees(m.principal, false)} + interest ${rupees(m.interest, false)}`)}
            </span>
          </>
        )}
      </div>
      <div className="lo-g">
        <small>Overdue</small>
        <b className={t.overdueCount ? "is-down" : "is-up"}>{t.overdueCount ? rupees(t.overdueAmount) : "Nothing"}</b>
        <span>{t.overdueCount ? `${t.overdueCount} EMI${t.overdueCount === 1 ? "" : "s"} past the date and not ticked` : "every past EMI is ticked paid"}</span>
      </div>
      <div className="lo-g">
        <small>Next EMI to pay</small>
        <b>{n ? rupees(n.amount) : "—"}</b>
        {n ? (
          <>
            <span className={n.inDays < 0 ? "is-down" : n.inDays <= 7 ? "is-warn" : ""}>{stateText({ date: n.date, paid: false }, today)}</span>
            <span className="lo-note">
              {dayName(n.date)} · {n.name}
              {n.principal !== null && n.principal !== undefined ? h(` · principal ${rupees(n.principal, false)} + interest ${rupees(n.interest, false)}`) : ""}
            </span>
          </>
        ) : (
          <span>nothing left to pay</span>
        )}
      </div>
      <div className="lo-g">
        <small>Last loan ends</small>
        <b>{t.debtFree ? shortMonth(t.debtFree) : t.emiPerMonth > 0 ? "Not known" : "—"}</b>
        <span>{h(t.emiPerMonth > 0 ? `EMIs ${rupees(t.emiPerMonth, false)} a month` : "no EMI loan running")}</span>
        <span className="lo-note">
          {t.avgRate === null ? "" : `average rate ${rateText(t.avgRate)} · `}an estimate, if every EMI is paid on time
        </span>
      </div>
    </section>
  );
}

function Attention({ items, onPaid, busy }) {
  const [all, setAll] = useState(false);
  const h = useHidden();
  if (!items.length) return null;
  const list = all ? items : items.slice(0, 5);
  return (
    <section className="lo-attn" aria-label="Needs attention">
      <h3>
        Needs attention <span>{items.length}</span>
      </h3>
      <ul>
        {list.map((a) => (
          <li key={a.id} className={`is-${a.level}`}>
            <i aria-hidden="true">{a.level === "danger" ? "!" : "•"}</i>
            <span>{h(a.text)}</span>
            {a.row && (
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={busy === `${a.loan.id}:${a.row.month}`} onClick={() => onPaid(a.loan, a.row, true)} aria-label={`Mark ${a.loan.name} ${shortMonth(a.row.month)} paid`}>
                Mark paid
              </button>
            )}
          </li>
        ))}
      </ul>
      {items.length > 5 && (
        <button type="button" className="lo-link" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ downloads */
const inRs = (x) => x.toLocaleString("en-IN", { maximumFractionDigits: 2 });
/** Do the names or remarks hold letters the PDF's built-in fonts cannot draw? */
const beyondPdf = (data) => data.loans.some((l) => [l.name, l.remarks, ...l.rows.map((r) => r.remarks)].some((x) => pdfSafe(x).split("?").length > String(x || "").split("?").length));
function Downloads({ data, month, loanId, scope, onScope }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const loan = data.loans.find((l) => l.id === loanId);
  const chosen = scope === "loan" && !loan ? "month" : scope;
  const go = async (kind) => {
    setBusy(kind);
    setErr("");
    try {
      const set = exportSet(data, chosen, { month, loanId });
      const t = data.totals;
      await download(kind, set, { stamp: stampLines(data), summary: [`Principal remaining Rs ${inRs(t.outstanding)} of Rs ${inRs(t.borrowed)} borrowed · interest remaining Rs ${inRs(t.interestRemaining)} · EMIs a month Rs ${inRs(t.emiPerMonth)} · overdue Rs ${inRs(t.overdueAmount)}`] });
      snack(`${kind === "xlsx" ? "Excel" : kind.toUpperCase()} file made: ${set.file}.${kind}`, { tone: "ok", key: "loan-download", ms: 5000 });
    } catch (e) {
      setErr(`The file could not be made: ${e.message}`);
    }
    setBusy("");
  };
  return (
    <div className="lo-dl" role="group" aria-label="Download">
      <label>
        <span>Download</span>
        <select value={chosen} onChange={(e) => onScope(e.target.value)}>
          <option value="month">{shortMonth(month)} register</option>
          {loan && <option value="loan">{loan.name}: all months</option>}
          <option value="all">Everything (all loans, all months)</option>
        </select>
      </label>
      {[
        ["pdf", "PDF"],
        ["csv", "CSV"],
        ["xlsx", "Excel"],
      ].map(([k, label]) => (
        <button key={k} type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={Boolean(busy)} onClick={() => go(k)} aria-label={`Download ${label}`}>
          {busy === k ? "Making…" : label}
        </button>
      ))}
      {beyondPdf(data) && <small className="lo-note">The PDF cannot draw Hindi or other scripts (they show as “?”); the CSV and Excel files keep them.</small>}
      <Alert>{err}</Alert>
    </div>
  );
}

/* ------------------------------------------------------------------ the rows */
/** The sheet of rows, in the owner's columns. `mode` "month": one row a loan; "loan": one row a month. */
function Rows({ mode, items, totals, today, busy, onPaid, onSave, onEdit, onOpen, currentMonth }) {
  return (
    <div className="lo-scroll">
      <table className="lo-table">
        <caption className="adm-sr">{mode === "month" ? "This month’s instalments" : "Every month of this loan"}</caption>
        <thead>
          <tr>
            <th scope="col">Sr. No.</th>
            <th scope="col">{mode === "month" ? "Loan" : "Month"}</th>
            <th scope="col">Opening Date</th>
            <th scope="col" className="is-num">Total Amount</th>
            <th scope="col" className="is-num">Interest Rate</th>
            <th scope="col">EMI Date</th>
            <th scope="col" className="is-num">EMI Amount</th>
            <th scope="col" className="is-num">Outstanding Loan Amount</th>
            <th scope="col">Is Paid?</th>
            <th scope="col">Remarks</th>
          </tr>
        </thead>
        <tbody>
          {items.map(({ sr, loan, row }) => {
            const key = `${loan.id}:${row.month}`;
            return (
              <tr key={key} className={`is-${row.state} ${mode === "loan" && row.month === currentMonth ? "is-now" : ""}`}>
                <td data-label="Sr. No.">{sr}</td>
                <th scope="row" data-label={mode === "month" ? "Loan" : "Month"} className="lo-name">
                  {mode === "month" ? (
                    <button type="button" className="lo-link" onClick={() => onOpen(loan.id)} data-tip={`Every month of ${loan.name}`}>
                      {loan.name}
                    </button>
                  ) : (
                    shortMonth(row.month)
                  )}
                </th>
                <td data-label="Opening Date">{dayName(loan.openingDate)}</td>
                <td data-label="Total Amount" className="is-num">{rupees(loan.totalAmount)}</td>
                <td data-label="Interest Rate" className="is-num">{rateText(row.rate)}</td>
                <td data-label="EMI Date">
                  {dayName(row.date)}
                  <small className={`lo-state is-${row.state}`}>{stateText(row, today)}</small>
                </td>
                <td data-label="EMI Amount" className="is-num">
                  {rupees(row.emi)}
                  {row.principal !== null && row.principal !== undefined && (
                    <small className="lo-parts">
                      <span className="is-p">Principal {rupees(row.principal)}</span>
                      <span className="is-i">Interest {rupees(row.interest)}</span>
                    </small>
                  )}
                  <button type="button" className="lo-link lo-edit" onClick={() => onEdit(loan, row)} aria-label={`Change ${loan.name} ${shortMonth(row.month)}`} data-tip="Change this month’s EMI amount, date or rate, add a part-payment, or type the bank’s outstanding.">
                    Change
                  </button>
                </td>
                <td data-label="Outstanding" className="is-num lo-out">
                  <small className="lo-out__k">Principal</small>
                  <b>{rupees(row.outstanding)}</b>
                  {interestLeftAfter(loan, row) !== null && (
                    <small className="lo-parts">
                      <span className="is-i">Interest {rupees(interestLeftAfter(loan, row))}</span>
                      <span>Total {rupees(row.outstanding + interestLeftAfter(loan, row))}</span>
                    </small>
                  )}
                  {row.reduced > 0 && <small className="is-up">principal −{rupees(row.reduced)} this month</small>}
                  {row.bankBalance !== null && row.bankBalance !== undefined && <small>bank’s figure</small>}
                  {row.extra > 0 && <small>includes part-payment {rupees(row.extra)}</small>}
                </td>
                <td data-label="Is Paid?">
                  <label className="lo-tick">
                    <input type="checkbox" checked={row.paid} disabled={busy === key} onChange={(e) => onPaid(loan, row, e.target.checked)} aria-label={`Is paid: ${loan.name}, ${shortMonth(row.month)} EMI of ${rupees(row.emi)}`} />
                    <span>{busy === key ? "Saving…" : row.paid ? "Paid" : "Not paid"}</span>
                  </label>
                </td>
                <td data-label="Remarks" className="lo-rem">
                  <RemarksBox value={row.remarks} label={`Remarks for ${loan.name}, ${shortMonth(row.month)}`} onSave={(v) => onSave(loan, row, { remarks: v })} />
                  <small data-tip="When this row was last saved">saved {new Date(row.updatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" })}</small>
                </td>
              </tr>
            );
          })}
        </tbody>
        {totals && (
          <tfoot>
            <tr>
              <td colSpan={3} data-label="">Total</td>
              <td className="is-num" data-label="Total Amount">{rupees(totals.total)}</td>
              <td colSpan={2} data-label="" />
              <td className="is-num" data-label="EMI Amount">
                {rupees(totals.emi)}
                <small className="lo-parts">
                  <span className="is-p">Principal {rupees(totals.principal)}</span>
                  <span className="is-i">Interest {rupees(totals.interest)}</span>
                </small>
              </td>
              <td className="is-num" data-label="Outstanding">
                <small className="lo-out__k">Principal</small>
                {rupees(totals.outstanding)}
                <small className="lo-parts">
                  <span className="is-i">Interest {rupees(totals.interestLeft)}</span>
                  <span>Total {rupees(totals.outstanding + totals.interestLeft)}</span>
                </small>
              </td>
              <td data-label="Is Paid?">
                {totals.paid} of {totals.count} paid
              </td>
              <td data-label="" />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ one month's row, in full */
function MonthDialog({ loan, row, onClose, onSave }) {
  const planned = loan.method === "schedule";
  const [f, setF] = useState({ emi: String(row.emi), principal: planned && row.principal !== null ? String(row.principal) : "", interest: planned && row.interest !== null ? String(row.interest) : "", date: row.date, rate: String(row.rate), extra: row.extra ? String(row.extra) : "", bankBalance: row.bankBalance === null || row.bankBalance === undefined ? "" : String(row.bankBalance), remarks: row.remarks });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e && e.target ? e.target.value : e }));
  useEffect(() => {
    const key = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    const t = setTimeout(() => box.current && box.current.focus(), 30);
    return () => {
      document.removeEventListener("keydown", key);
      clearTimeout(t);
    };
  }, [onClose]);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const fields = { ...f };
      // the parts go only when they were changed here: otherwise a new EMI keeps the interest and moves the principal
      if (!planned || fields.principal === String(row.principal)) delete fields.principal;
      if (!planned || fields.interest === String(row.interest)) delete fields.interest;
      await onSave(loan, row, fields, { throwing: true });
      onClose();
    } catch (x) {
      setErr(x.message);
      setBusy(false);
    }
  };
  const node = (
    <div className="tr-modal lo-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form ref={box} tabIndex={-1} className="tr-dialog lo-dialog" role="dialog" aria-modal="true" aria-label={`${loan.name}, ${monthName(row.month)}`} onSubmit={submit}>
        <h3>
          {loan.name} · {monthName(row.month)}
        </h3>
        <p className="lo-note">Only this month changes. To change the loan’s rate or EMI from now on, edit the loan on the Loans tab.</p>
        <div className="lo-fields">
          <label className="lo-field">
            <span>EMI amount (₹)</span>
            <input inputMode="decimal" value={f.emi} onChange={set("emi")} />
          </label>
          <div className="lo-field">
            <DateField label="EMI date" value={f.date} onChange={set("date")} id="lo-m-date" />
          </div>
          {planned && (
            <>
              <label className="lo-field">
                <span>Principal part (₹)</span>
                <input inputMode="decimal" value={f.principal} onChange={set("principal")} />
              </label>
              <label className="lo-field">
                <span>Interest part (₹)</span>
                <input inputMode="decimal" value={f.interest} onChange={set("interest")} />
              </label>
            </>
          )}
          <label className="lo-field">
            <span>Interest rate (% a year)</span>
            <input inputMode="decimal" value={f.rate} onChange={set("rate")} />
          </label>
          <label className="lo-field">
            <span>Part-payment this month (₹)</span>
            <input inputMode="decimal" value={f.extra} onChange={set("extra")} placeholder="none" />
          </label>
          <label className="lo-field lo-field--wide">
            <span>Bank’s outstanding after this month (₹)</span>
            <input inputMode="decimal" value={f.bankBalance} onChange={set("bankBalance")} placeholder="leave empty to work it out" />
            <small>From your statement. It replaces the worked-out figure here, and the months after carry on from it.</small>
          </label>
          <label className="lo-field lo-field--wide">
            <span>Remarks</span>
            <input value={f.remarks} maxLength={300} onChange={set("remarks")} />
          </label>
        </div>
        <Alert>{err}</Alert>
        <footer className="tr-dialog__foot">
          <button type="submit" className="adm-btn adm-btn--solid" disabled={busy}>
            {busy ? "Saving…" : "Save this month"}
          </button>
          <button type="button" className="adm-btn adm-btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </footer>
      </form>
    </div>
  );
  const root = typeof document !== "undefined" ? document.querySelector(".adm") : null;
  return root ? createPortal(node, root) : node;
}

/* ------------------------------------------------------------------ add or change a loan */
function LoanForm({ initial, data, onCancel, onSubmit }) {
  const [f, setF] = useState(initial);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && ref.current.scrollIntoView) ref.current.scrollIntoView({ block: "nearest" });
  }, []);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e && e.target ? e.target.value : e }));
  const cash = f.type === "cash";
  const p = previewOf(f, data.today);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await onSubmit(f);
    } catch (x) {
      setErr(x.message);
      setBusy(false);
    }
  };
  const input = (k, label, { hint, decimal, placeholder, wide, required } = {}) => (
    <label className={`lo-field ${wide ? "lo-field--wide" : ""}`}>
      <span>
        {label}
        {required ? <em aria-hidden="true"> *</em> : null}
      </span>
      <input inputMode={decimal ? "decimal" : undefined} value={f[k]} onChange={set(k)} placeholder={placeholder} autoComplete="off" aria-required={required || undefined} />
      {hint ? <small>{hint}</small> : null}
    </label>
  );
  const chooser = !f.id && (
    <div className="lo-types" role="group" aria-label="What kind of loan">
      {[
        ["bank", "Bank or finance company", "Monthly EMIs"],
        ["cash", "Cash from a person", "No EMI: you enter what you pay back"],
      ].map(([id, title, note]) => (
        <button key={id} type="button" className={f.type === id ? "is-on" : ""} aria-pressed={f.type === id} onClick={() => setF((x) => ({ ...x, type: id }))}>
          <b>{title}</b>
          <small>{note}</small>
        </button>
      ))}
    </div>
  );
  if (cash)
    return (
      <form className="lo-card lo-form" ref={ref} onSubmit={submit} aria-label={f.id ? "Change the cash loan" : "Add a loan"}>
        <SectionHead title={f.id ? "Change the cash loan" : "Add a loan"} sub="Only who, when and how much. Enter each repayment as you make it." />
        {chooser}
        <div className="lo-fields">
          {input("name", "From whom", { placeholder: "the person’s name", required: true })}
          <div className="lo-field">
            <DateField label="Date taken *" value={f.openingDate} onChange={set("openingDate")} max={data.today} id="lo-cash-date" />
          </div>
          {input("totalAmount", "Amount (₹)", { decimal: true, required: true })}
          {input("remarks", "Remarks", { wide: true })}
        </div>
        <Alert>{err}</Alert>
        <div className="lo-acts">
          <button type="submit" className="adm-btn adm-btn--solid" disabled={busy}>
            {busy ? "Saving…" : f.id ? "Save changes" : "Add the cash loan"}
          </button>
          <button type="button" className="adm-btn adm-btn--ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    );
  const planned = f.method === "schedule";
  return (
    <form className="lo-card lo-form" ref={ref} onSubmit={submit} aria-label={f.id ? "Change the loan" : "Add a loan"}>
      <SectionHead title={f.id ? "Change the loan" : "Add a loan"} sub={f.id ? "A new rate, EMI or EMI day applies to unpaid months from this month on; paid months keep what they were." : "The monthly rows are made by themselves, from the first EMI up to this month. Have the repayment schedule? Upload it instead, and nothing needs typing."} />
      {chooser}
      <div className="lo-fields">
        {input("name", "Loan name", { placeholder: "e.g. SBI home loan", required: true })}
        <label className="lo-field">
          <span>Type</span>
          <select value={f.kind} onChange={set("kind")}>
            {data.kinds.filter((k) => k.id !== "family" || f.kind === "family").map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <div className="lo-field">
          <DateField label="Opening date *" value={f.openingDate} onChange={set("openingDate")} id="lo-open" />
        </div>
        {input("totalAmount", "Total amount (₹)", { decimal: true, required: true })}
        {input("rate", "Interest rate (% a year)", { decimal: true, required: true })}
        {input("emiAmount", "EMI amount (₹)", { decimal: true, required: true })}
        <div className="lo-field">
          <DateField label="First EMI to keep here *" value={f.firstEmiDate} onChange={set("firstEmiDate")} min={f.openingDate || undefined} id="lo-first" />
          <small>For a running loan this can be a later month.</small>
        </div>
        {input("emiDay", "EMI day of the month", { decimal: true, placeholder: f.firstEmiDate ? String(Number(f.firstEmiDate.slice(8))) : "from the first EMI", hint: "31 means the month’s last day in shorter months." })}
        {input("startBalance", "Owed before that first EMI (₹)", { decimal: true, placeholder: "the total amount", hint: "Leave empty for a new loan." })}
        <label className="lo-field lo-field--wide">
          <span>When an EMI is ticked paid</span>
          <select value={f.method} onChange={set("method")}>
            {data.methods.filter((m) => m.id !== "schedule" || f.hasPlan).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <small>
            {f.method === "emi"
              ? "The whole EMI comes off the outstanding, with no split. A bank takes interest first, so its figure will be higher."
              : planned
                ? "Each month’s principal and interest come from the schedule you uploaded. A new schedule can be uploaded any time."
                : "An estimate of the bank’s reducing balance: interest is the outstanding × rate ÷ 12; the rest of the EMI is principal. Upload the lender’s schedule for its exact figures."}
          </small>
        </label>
        {input("remarks", "Remarks", { wide: true })}
      </div>
      {(p.rows !== null || p.interest !== null) && (
        <p className={`lo-preview ${p.short ? "is-short" : ""}`} role="status">
          {p.rows !== null && !f.id && (p.rows > 0 ? `${p.rows} monthly row${p.rows === 1 ? "" : "s"} will be made now. ` : "The first row is made when that month begins. ")}
          {p.interest !== null && (p.short ? `A month’s interest at this rate is about ${rupees(p.interest)}: the EMI does not cover it, so a bank would never clear this loan. Check the rate and the EMI.` : `Of the first EMI, about ${rupees(p.interest)} is a month’s interest and ${rupees(p.principal)} is principal.`)}
        </p>
      )}
      <Alert>{err}</Alert>
      <div className="lo-acts">
        <button type="submit" className="adm-btn adm-btn--solid" disabled={busy}>
          {busy ? "Saving…" : f.id ? "Save changes" : "Add the loan"}
        </button>
        <button type="button" className="adm-btn adm-btn--ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ one loan's months */
const SHOWN = 24;
const HOW_WORDS = { lender: "the lender’s own principal and interest", balance: "split worked out from the lender’s balance", computed: "split worked out from the amount and rate", "ai-columns": "columns named by the free AI, sums checked" };

function Documents({ loan, onUpload, onRemoveDoc }) {
  const h = useHidden();
  const [viewing, setViewing] = useState("");
  const shown = (loan.documents || []).find((d) => d.id === viewing);
  const docs = loan.documents || [];
  return (
    <section className="lo-card" aria-label={`Documents of ${loan.name}`}>
      <SectionHead
        title="Documents"
        sub={docs.length ? "Kept in the database with this loan: view or download any time" : "Upload this loan’s agreement, sanction letter, statements and repayment schedule, several at once"}
        actions={
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => onUpload(loan.id)}>
            Upload documents
          </button>
        }
      />
      {docs.length > 0 && (
        <ul className="lo-docs">
          {[...docs].reverse().map((d) => (
            <li key={d.id}>
              <div>
                <span className="lo-chip">{d.docLabel}</span> <b>{d.name}</b>
                <small className="lo-note">
                  {when(d.uploadedAt)}
                  {d.usedSchedule ? " · its schedule is in use" : ""}
                  {d.unread ? " · kept as it is (not read)" : ""}
                  {d.pagesPictured ? ` · ${d.pagesRead} of ${d.pagesPictured} scanned page${d.pagesPictured === 1 ? "" : "s"} read` : ""}
                  {d.aiModel ? " · read with the free AI too" : ""}
                </small>
                {d.summary ? <p>{h(d.summary)}</p> : null}
                {d.terms && d.terms.length > 0 && (
                  <details className="lo-terms">
                    <summary>{d.terms.length === 1 ? "1 clause or charge" : `${d.terms.length} clauses and charges`}</summary>
                    <ul>
                      {d.terms.map((t, i) => (
                        <li key={i}>
                          <b>{t.title}</b>
                          {t.detail ? <span>{h(t.detail)}</span> : null}
                          <q>{h(t.quote)}</q>
                          {t.from === "ai" && t.checked === false && <small className="lo-src is-warn">from the free AI · these exact words are not in the document</small>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {d.values && Object.keys(d.values).length > 0 && (
                  <details className="lo-terms">
                    <summary>Details read from it</summary>
                    <dl className="lo-values">
                      {Object.values(d.values).map((v) => (
                        <div key={v.label}>
                          <dt>{v.label}</dt>
                          <dd>{h(String(v.value))}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                )}
              </div>
              <span className="lo-acts">
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setViewing(d.id)} aria-label={`View ${d.name}`}>
                  View
                </button>
                <a className="adm-btn adm-btn--ghost adm-btn--sm" href={`${URL_}/${loan.id}/documents/${d.id}`} download aria-label={`Download ${d.name}`}>
                  Download
                </a>
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => onRemoveDoc(loan, d)} aria-label={`Remove the document ${d.name}`}>
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {shown && <DocViewer key={shown.id} loan={loan} doc={shown} onClose={() => setViewing("")} />}
    </section>
  );
}

function ComingMonths({ loan }) {
  const [open, setOpen] = useState(false);
  const rows = loan.upcoming || [];
  if (!rows.length) return null;
  return (
    <details className="lo-terms" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <b>The {rows.length} months to come</b> ({loan.method === "schedule" ? "from the lender’s schedule" : "projected at today’s rate and EMI"})
      </summary>
      {open && (
        <div className="lo-scroll">
          <table className="lo-preview-table lo-coming">
            <caption className="adm-sr">Months to come</caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col" className="is-num">EMI</th>
                <th scope="col" className="is-num">Principal</th>
                <th scope="col" className="is-num">Interest</th>
                <th scope="col" className="is-num">Principal left after</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.month}>
                  <td>{shortMonth(x.month)}</td>
                  <td className="is-num">{rupees(x.emi)}</td>
                  <td className="is-num">{rupees(x.principal)}</td>
                  <td className="is-num">{rupees(x.interest)}</td>
                  <td className="is-num">{rupees(x.closing)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

function Schedule({ loan, data, busy, onPaid, onSave, onEdit, onUpTo, onUpload, onRemoveDoc, onData }) {
  const [all, setAll] = useState(false);
  const h = useHidden();
  const unpaid = loan.rows.filter((r) => !r.paid);
  const [upto, setUpto] = useState("");
  const upTo = unpaid.some((r) => r.month === upto) ? upto : "";
  const s = loan.summary;
  const items = loan.rows.map((row, i) => ({ sr: i + 1, loan, row }));
  const visible = all ? items : items.slice(-SHOWN);
  const method = loan.method === "schedule" ? (loan.plan ? HOW_WORDS[loan.plan.how] : "lender’s schedule") : loan.method === "emi" ? "whole EMI comes off" : "split worked out from the rate";
  const facts = [
    ["Principal remaining", rupees(s.outstanding), `${rateText(Math.round(s.repaidPct * 10) / 10)} of ${rupees(loan.totalAmount, false)} repaid`],
    ["Interest remaining", s.split ? rupees(s.interestRemaining) : "Not split", s.totalToPay !== null ? `total still to pay ${rupees(s.totalToPay, false)}` : method],
    ["Paid so far", `${s.paidCount} EMI${s.paidCount === 1 ? "" : "s"}`, s.split ? `principal ${rupees(s.paidPrincipal, false)} + interest ${rupees(s.paidInterest, false)}${s.extraPaid ? ` + ${rupees(s.extraPaid, false)} part-paid` : ""}` : rupees(s.paidAmount, false)],
    ["Overdue", s.overdueCount ? rupees(s.overdueAmount) : "Nothing", s.overdueCount ? `${s.overdueCount} not ticked` : "", s.overdueCount ? "is-down" : ""],
    ["EMIs left", s.closed ? "Closed" : s.emisLeft === null ? "Never clears" : String(s.emisLeft), s.endMonth ? `ends ${shortMonth(s.endMonth)} · ${method}` : method, s.emisLeft === null ? "is-down" : ""],
    ["This month’s interest", rupees(s.interestThisMonth), `at ${rateText(loan.rate)} a year`],
  ];
  return (
    <>
      <section className="lo-strip" aria-label={`${loan.name} at a glance`}>
        {facts.map(([k, v, note, tone]) => (
          <div key={k}>
            <small>{k}</small>
            <b className={tone || ""}>{v}</b>
            {note ? <span>{h(note)}</span> : null}
          </div>
        ))}
      </section>
      {s.split && !s.closed && s.totalToPay > 0 && <SplitBar principal={s.outstanding} interest={s.interestRemaining} label={`${loan.name}: still to pay`} format={(x) => h(rupees(x, false))} />}
      <section className="lo-card">
        <SectionHead
          title={`${loan.name}: month by month`}
          sub={h(`Opened ${dayName(loan.openingDate)} · ${rupees(loan.totalAmount)} · first EMI here ${dayName(loan.firstEmiDate)}${loan.startBalance !== loan.totalAmount ? ` · ${rupees(loan.startBalance)} owed then` : ""}${loan.remarks ? ` · ${loan.remarks}` : ""}`)}
          actions={
            unpaid.length > 1 ? (
              <span className="lo-upto">
                <select value={upTo} onChange={(e) => setUpto(e.target.value)} aria-label="Mark every EMI paid up to">
                  <option value="">Paid up to…</option>
                  {unpaid.map((r) => (
                    <option key={r.month} value={r.month}>
                      {shortMonth(r.month)}
                    </option>
                  ))}
                </select>
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={!upTo} onClick={() => onUpTo(loan, upTo)}>
                  Mark paid
                </button>
              </span>
            ) : null
          }
        />
        {items.length ? (
          <>
            {items.length > SHOWN && (
              <button type="button" className="lo-link" onClick={() => setAll(!all)}>
                {all ? `Show the last ${SHOWN} months` : `Show all ${items.length} months (${items.length - SHOWN} earlier)`}
              </button>
            )}
            <Rows mode="loan" items={visible} today={data.today} busy={busy} onPaid={onPaid} onSave={onSave} onEdit={onEdit} currentMonth={data.today.slice(0, 7)} />
          </>
        ) : (
          <p className="lo-empty">The first row is made when {monthName(loan.firstEmiDate.slice(0, 7))} begins.</p>
        )}
        <ComingMonths key={loan.id} loan={loan} />
      </section>
      <LoanDetails key={`details-${loan.id}`} loan={loan} data={data} onSaved={onData} />
      <Documents loan={loan} onUpload={onUpload} onRemoveDoc={onRemoveDoc} />
    </>
  );
}

/* ------------------------------------------------------------------ the foot: when it was last saved */
function SavedFoot({ data, readAt }) {
  const { last, autoAt, store, byPerson } = data.saved;
  return (
    <footer className="lo-saved" aria-label="Last saved">
      <dl>
        <div>
          <dt>Last saved</dt>
          <dd>
            {last ? (
              <>
                <b>{when(last.at)}</b> by {last.by} — {last.name}: {last.what}
              </>
            ) : (
              "nothing saved yet"
            )}
          </dd>
        </div>
        {byPerson && last && byPerson.at !== last.at && (
          <div>
            <dt>Last change by a person</dt>
            <dd>
              <b>{when(byPerson.at)}</b> by {byPerson.by} — {byPerson.name}: {byPerson.what}
            </dd>
          </div>
        )}
        <div>
          <dt>Monthly rows last added by the desk</dt>
          <dd>{autoAt ? <b>{when(autoAt)}</b> : "not yet"}</dd>
        </div>
        <div>
          <dt>Figures on this page read</dt>
          <dd>{when(readAt)}</dd>
        </div>
      </dl>
      <p>
        Saved in the database{store === "mongo" ? " (MongoDB)" : ""} the moment you change anything, and kept in the daily backup. This book records what you tick: it does not talk to a bank or move any money.
      </p>
    </footer>
  );
}

/* ------------------------------------------------------------------ the page */
export default function Loans() {
  const [state, setState] = useState(() => ({ data: peek(URL_, 60000), error: "" }));
  const [tab, setTab] = usePageTab("loans", TAB_IDS);
  const [month, setMonth] = useState("");
  const [loanId, setLoanId] = useState("");
  const [form, setForm] = useState(null);
  const [editing, setEditing] = useState(null); // { loanId, month }
  const [busy, setBusy] = useState("");
  const [scope, setScope] = useState("month");
  const [upload, setUpload] = useState(null); // { loanId } while a document is being uploaded and reviewed
  const ask = useDialog();
  const h = useHidden();
  const alive = useRef(true);

  const load = useCallback(
    () =>
      api(URL_)
        .then((d) => alive.current && setState({ data: d, error: "" }))
        .catch((e) => alive.current && setState((s) => ({ data: s.data, error: e.message }))),
    []
  );
  useEffect(() => {
    alive.current = true;
    load();
    // another tab, another device, or the desk adding a new month's rows: shown at once
    const stop = everyVisible(load, 60000, { topics: ["loans"] });
    return () => {
      alive.current = false;
      if (stop) stop();
    };
  }, [load]);

  /** Send a change; the server answers with the whole book. */
  const send = useCallback(async (url, options) => {
    const d = await api(url, options);
    if (alive.current) setState({ data: d, error: "" });
    return d;
  }, []);

  const data = state.data && state.data.loans ? state.data : null;
  const nowMonth = data ? data.today.slice(0, 7) : "";
  const first = data ? firstMonth(data) : "";
  const shownMonth = month && month >= first && month <= nowMonth ? month : nowMonth;
  const register = useMemo(() => (data ? registerFor(data, shownMonth) : null), [data, shownMonth]);
  const needs = useMemo(() => attentionOf(data), [data]);

  const saveRow = useCallback(
    async (loan, row, fields, { throwing = false } = {}) => {
      try {
        await send(`${URL_}/${loan.id}/months/${row.month}`, { method: "PUT", body: fields });
        snack(`Saved: ${loan.name}, ${shortMonth(row.month)}.`, { tone: "ok", key: "loan-saved", ms: 4000 });
      } catch (e) {
        if (throwing) throw e;
        snack(e.message, { tone: "error", key: "loan-saved" });
      }
    },
    [send]
  );

  const setPaid = useCallback(
    async (loan, row, paid) => {
      const key = `${loan.id}:${row.month}`;
      setBusy(key);
      const put = (v) => send(`${URL_}/${loan.id}/months/${row.month}`, { method: "PUT", body: { paid: v } });
      try {
        const d = await put(paid);
        const now = d.loans.find((l) => l.id === loan.id);
        snack(h(`${loan.name}, ${shortMonth(row.month)} marked ${paid ? "paid" : "not paid"}. Outstanding now ${rupees(now.summary.outstanding)}.`), { tone: "ok", key: `loan-${key}`, ms: 8000, action: { label: "Undo", onClick: () => put(!paid).catch((e) => snack(e.message, { tone: "error" })) } });
      } catch (e) {
        snack(e.message, { tone: "error", key: `loan-${key}` });
      }
      if (alive.current) setBusy("");
    },
    [send, h]
  );

  const submitLoan = async (f) => {
    // a cash loan carries only what it has; a bank loan its terms
    const body = f.type === "cash" ? { type: "cash", name: f.name, openingDate: f.openingDate, totalAmount: f.totalAmount, remarks: f.remarks } : { ...f };
    delete body.id;
    delete body.hasPlan;
    const d = await send(f.id ? `${URL_}/${f.id}` : URL_, { method: f.id ? "PUT" : "POST", body });
    setForm(null);
    setLoanId(d.id);
    snack(f.id ? "The loan’s changes are saved." : f.type === "cash" ? "The cash loan is added." : "The loan is added, with its monthly rows.", { tone: "ok", key: "loan-form" });
  };

  const editLoan = (l) => {
    if (l.type === "cash") {
      setForm({ ...BLANK, type: "cash", id: l.id, name: l.name, openingDate: l.openingDate, totalAmount: String(l.totalAmount), remarks: l.remarks });
      return;
    }
    setForm({ ...BLANK, hasPlan: Boolean(l.plan), id: l.id, name: l.name, kind: l.kind, openingDate: l.openingDate, totalAmount: String(l.totalAmount), rate: String(l.rate), emiAmount: String(l.emiAmount), firstEmiDate: l.firstEmiDate, emiDay: String(l.emiDay), startBalance: l.startBalance === l.totalAmount ? "" : String(l.startBalance), method: l.method, remarks: l.remarks });
  };

  const removeLoan = async (l) => {
    const kept = l.type === "cash" ? `Its ${l.payments.length} repayment${l.payments.length === 1 ? "" : "s"} stay` : `Its ${l.rows.length} monthly row${l.rows.length === 1 ? "" : "s"} stay`;
    const yes = await ask({ tone: "danger", title: `Remove ${l.name}?`, body: `It leaves the page and the totals. ${kept} in the database, and you can bring it back from the foot of the Loans tab.`, confirmText: "Remove it", cancelText: "Keep it" });
    if (!yes) return;
    try {
      await send(`${URL_}/${l.id}`, { method: "DELETE" });
      snack(`${l.name} removed.`, { tone: "ok", key: "loan-removed", ms: 8000, action: { label: "Undo", onClick: () => send(`${URL_}/${l.id}/restore`, { method: "POST" }).catch((e) => snack(e.message, { tone: "error" })) } });
    } catch (e) {
      snack(e.message, { tone: "error" });
    }
  };

  const markUpTo = async (l, upto) => {
    const n = l.rows.filter((r) => !r.paid && r.month <= upto).length;
    const yes = await ask({ title: `Mark ${n} EMI${n === 1 ? "" : "s"} paid?`, body: `Every unpaid EMI of ${l.name} up to ${monthName(upto)} is ticked paid, and comes off the outstanding by this loan’s rule. Each can be unticked again.`, confirmText: "Mark them paid", cancelText: "Not now" });
    if (!yes) return;
    try {
      const d = await send(`${URL_}/${l.id}/paid-upto`, { method: "POST", body: { month: upto } });
      snack(`${d.marked} EMI${d.marked === 1 ? "" : "s"} marked paid.`, { tone: "ok", key: "loan-upto" });
    } catch (e) {
      snack(e.message, { tone: "error" });
    }
  };

  const settle = async (l, paid) => {
    if (paid) {
      const yes = await ask({ title: `Mark ${l.name} paid in full?`, body: `${rupees(l.summary.outstanding)} is recorded as paid back today. You can untick it again.`, confirmText: "Mark it paid", cancelText: "Not now" });
      if (!yes) return;
    }
    setBusy(`${l.id}:cash`);
    try {
      await send(`${URL_}/${l.id}/settle`, { method: "POST", body: { settled: paid } });
      snack(paid ? "Marked paid in full." : "The last full payment is taken out again.", { tone: "ok", key: "loan-cash" });
    } catch (e) {
      snack(e.message, { tone: "error" });
    }
    if (alive.current) setBusy("");
  };

  const removeDocument = async (l, d) => {
    const yes = await ask({ tone: "danger", title: "Remove this document?", body: `${d.name} is deleted from the database for good. The loan’s months stay as they are, also those taken from a schedule in it.`, confirmText: "Delete it", cancelText: "Keep it" });
    if (!yes) return;
    try {
      await send(`${URL_}/${l.id}/documents/${d.id}`, { method: "DELETE" });
      snack("Document removed.", { tone: "ok" });
    } catch (e) {
      snack(e.message, { tone: "error" });
    }
  };

  const openUpload = (id = "") => {
    setForm(null);
    setUpload({ loanId: id, n: Date.now() });
  };

  const uploaded = (d) => {
    setState({ data: d, error: "" });
    setUpload(null);
    const done = d.applied || {};
    setLoanId(done.id);
    setScope("loan");
    setTab("schedule");
    const files = (done.docIds || []).length;
    snack(`Saved to the loan book${files > 1 ? ` · ${files} documents kept` : ""}${done.marked ? ` · ${done.marked} EMIs ticked paid` : ""}${done.dropped && done.dropped.length ? ` · ${done.dropped.length} ticked month(s) outside the schedule were replaced by it` : ""}.`, { tone: "ok", key: "loan-upload", ms: 7000 });
  };

  const openSchedule = (id) => {
    setLoanId(id);
    setScope("loan");
    setTab("schedule");
  };

  if (!data)
    return (
      <section className="lo-card">
        <h2 className="adm-sr">Loans</h2>
        {state.error ? <p className="adm-alert">{state.error}</p> : <Skeleton label="Reading the loan book…" tiles={4} lines={4} />}
      </section>
    );

  const t = data.totals;
  const picked = data.loans.find((l) => l.id === loanId) || data.loans[0] || null;
  const banks = bankLoans(data);
  const people = cashLoans(data);
  const editLoanRow = editing ? data.loans.find((l) => l.id === editing.loanId) : null;
  const editRow = editLoanRow ? editLoanRow.rows.find((r) => r.month === editing.month) : null;
  const onEdit = (l, r) => setEditing({ loanId: l.id, month: r.month });
  const removed = data.removed || [];

  return (
    <div className="lo">
      <PageHead
        title="Loans"
        text="Upload each loan’s documents together: they are read and filled in for you. Every month then shows its principal and interest, and a tick on “Is paid?” takes them off what remains. Cash from people is kept simply, by hand."
        actions={
          <>
            <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" onClick={() => openUpload()}>
              Upload loan documents
            </button>
            <button
              type="button"
              className="adm-btn adm-btn--ghost adm-btn--sm"
              onClick={() => {
                setUpload(null);
                setForm({ ...BLANK });
              }}
            >
              Add a loan
            </button>
          </>
        }
      />
      <PageBar
        label={data.loans.length ? `${t.active} active` : "No loan yet"}
        labelTitle="Loan book"
        kpis={[
          { label: "Principal left", value: rupees(t.outstanding, false) },
          { label: "Interest left", value: rupees(t.interestRemaining, false) },
          { label: "Due this month", value: rupees(t.month.leftAmount, false), more: true },
          { label: "Overdue", value: t.overdueCount ? rupees(t.overdueAmount, false) : "0", tone: t.overdueCount ? "down" : "", more: true },
        ]}
        tabs={TABS.map((x) => ({ ...x, count: x.id === "loans" ? data.loans.length : 0 }))}
        tab={tab}
        onTab={(id) => {
          setTab(id);
          if (id === "schedule") setScope("loan");
          else if (id === "month") setScope("month");
        }}
        updatedAt={data.at}
        onRefresh={load}
        tabsLabel="Loan book sections"
      />
      {state.error && <p className="adm-alert">Could not read the newest figures: {state.error}</p>}

      {form && <LoanForm key={form.id || "new"} initial={form} data={data} onCancel={() => setForm(null)} onSubmit={submitLoan} />}
      {upload && <Upload key={upload.n} data={data} loanId={upload.loanId} onClose={() => setUpload(null)} onSaved={uploaded} />}

      {data.loans.length === 0 && !form && !upload ? (
        <section className="lo-card lo-start">
          <h3>No loan in the book yet</h3>
          <p>Upload a loan’s documents together (agreement, sanction letter, account statement, repayment schedule): the details are read and filled in for you, and each month shows its principal and interest. A loan without papers, or cash from a person, can be typed in.</p>
          <span className="lo-acts">
            <button type="button" className="adm-btn adm-btn--solid" onClick={() => openUpload()}>
              Upload your loan documents
            </button>
            <button type="button" className="adm-btn adm-btn--ghost" onClick={() => setForm({ ...BLANK })}>
              Add your first loan
            </button>
          </span>
        </section>
      ) : null}

      {data.loans.length > 0 && (
        <>
          <Glance t={t} today={data.today} />
          <Attention items={needs} onPaid={setPaid} busy={busy} />
          <Downloads data={data} month={shownMonth} loanId={picked ? picked.id : ""} scope={scope} onScope={setScope} />
        </>
      )}

      <PagePart id="month" tab={tab}>
        {banks.length > 0 && (
          <section className="lo-card">
            <SectionHead
              title={`Register · ${monthName(shownMonth)}`}
              sub={register.rows.length ? h(`${register.totals.paid} of ${register.totals.count} paid · ${rupees(register.totals.paidAmount)} of ${rupees(register.totals.emi)}`) : "No loan has an EMI in this month."}
              actions={
                <span className="lo-months" role="group" aria-label="Month">
                  <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setMonth(shiftMonth(shownMonth, -1))} disabled={shownMonth <= first} aria-label="Previous month">
                    ‹
                  </button>
                  <select value={shownMonth} onChange={(e) => setMonth(e.target.value)} aria-label="Choose the month">
                    {(() => {
                      const list = [];
                      for (let m = nowMonth, i = 0; m >= first && i < 600; m = shiftMonth(m, -1), i += 1) list.push(m);
                      return list.map((m) => (
                        <option key={m} value={m}>
                          {monthName(m)}
                        </option>
                      ));
                    })()}
                  </select>
                  <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setMonth(shiftMonth(shownMonth, 1))} disabled={shownMonth >= nowMonth} aria-label="Next month">
                    ›
                  </button>
                  {shownMonth !== nowMonth && (
                    <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setMonth("")}>
                      This month
                    </button>
                  )}
                </span>
              }
            />
            {register.rows.length > 0 && <Rows mode="month" items={register.rows} totals={register.totals} today={data.today} busy={busy} onPaid={setPaid} onSave={saveRow} onEdit={onEdit} onOpen={openSchedule} />}
          </section>
        )}
        {tab === "month" && people.length > 0 && <CashLoans data={data} send={send} busy={busy} onPaid={settle} onEdit={editLoan} onRemove={removeLoan} onAdd={() => setForm({ ...BLANK, type: "cash" })} onError={(e) => snack(e.message, { tone: "error" })} />}
      </PagePart>

      <PagePart id="schedule" tab={tab}>
        {picked ? (
          <>
            <div className="lo-pick" role="group" aria-label="Which loan">
              {data.loans.map((l) => (
                <button key={l.id} type="button" className={`xp-chip ${picked.id === l.id ? "is-on" : ""}`} aria-pressed={picked.id === l.id} onClick={() => openSchedule(l.id)}>
                  {l.name}
                </button>
              ))}
            </div>
            {picked.type === "cash" ? (
              tab === "schedule" && <CashLoans key={picked.id} data={data} only={picked.id} send={send} busy={busy} onPaid={settle} onEdit={editLoan} onRemove={removeLoan} onError={(e) => snack(e.message, { tone: "error" })} />
            ) : (
              <Schedule key={picked.id} loan={picked} data={data} busy={busy} onPaid={setPaid} onSave={saveRow} onEdit={onEdit} onUpTo={markUpTo} onUpload={openUpload} onRemoveDoc={removeDocument} onData={(d) => setState({ data: d, error: "" })} />
            )}
          </>
        ) : null}
      </PagePart>

      <PagePart id="loans" tab={tab}>
        <div className="lo-list">
          {people.map((l) => (
            <article key={l.id} className={`lo-card lo-loan ${l.summary.closed ? "is-closed" : ""}`} aria-label={l.name}>
              <header>
                <div>
                  <h3>{l.name}</h3>
                  <small>
                    Cash from a person · taken {dayName(l.openingDate)}
                    {l.summary.closed ? " · paid in full" : ""}
                  </small>
                </div>
                <span className="lo-acts">
                  <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => openSchedule(l.id)}>
                    Repayments
                  </button>
                  <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => editLoan(l)} aria-label={`Edit ${l.name}`}>
                    Edit
                  </button>
                  <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => removeLoan(l)} aria-label={`Remove ${l.name}`}>
                    Remove
                  </button>
                </span>
              </header>
              <dl>
                <div>
                  <dt>Outstanding</dt>
                  <dd>{rupees(l.summary.outstanding)}</dd>
                </div>
                <div>
                  <dt>Amount</dt>
                  <dd>{rupees(l.totalAmount)}</dd>
                </div>
                <div>
                  <dt>Paid back</dt>
                  <dd>{rupees(l.summary.paidAmount)}</dd>
                </div>
              </dl>
              <Bar pct={l.summary.repaidPct} label={`${l.name}: share repaid`} tone="is-good" />
              <p className="lo-note">
                {l.remarks ? `${l.remarks} · ` : ""}saved {when(l.updatedAt)}
              </p>
            </article>
          ))}
          {banks.map((l) => (
            <article key={l.id} className={`lo-card lo-loan ${l.summary.closed ? "is-closed" : ""}`} aria-label={l.name}>
              <header>
                <div>
                  <h3>{l.name}</h3>
                  <small>
                    {(data.kinds.find((k) => k.id === l.kind) || {}).label} · opened {dayName(l.openingDate)}
                    {l.summary.closed ? " · closed" : ""}
                  </small>
                </div>
                <span className="lo-acts">
                  <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => openSchedule(l.id)}>
                    Schedule
                  </button>
                  {(l.documents || []).length > 0 && (
                    <button
                      type="button"
                      className="adm-btn adm-btn--ghost adm-btn--sm"
                      onClick={() => {
                        openSchedule(l.id);
                        setTimeout(() => {
                          const el = document.querySelector(`[aria-label="Documents of ${l.name.replace(/["\\]/g, "")}"]`);
                          if (el && el.scrollIntoView) el.scrollIntoView({ block: "start" });
                        }, 60);
                      }}
                      aria-label={`Documents of ${l.name}: view or download`}
                    >
                      Documents ({l.documents.length})
                    </button>
                  )}
                  <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => openUpload(l.id)} aria-label={`Upload a document for ${l.name}`}>
                    Upload
                  </button>
                  <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => editLoan(l)} aria-label={`Edit ${l.name}`}>
                    Edit
                  </button>
                  <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => removeLoan(l)} aria-label={`Remove ${l.name}`}>
                    Remove
                  </button>
                </span>
              </header>
              <dl>
                <div>
                  <dt>Principal remaining</dt>
                  <dd>{rupees(l.summary.outstanding)}</dd>
                </div>
                <div>
                  <dt>Interest remaining</dt>
                  <dd>{l.summary.interestRemaining === null ? "not split" : rupees(l.summary.interestRemaining)}</dd>
                </div>
                <div>
                  <dt>Total amount</dt>
                  <dd>{rupees(l.totalAmount)}</dd>
                </div>
                <div>
                  <dt>Interest rate</dt>
                  <dd>{rateText(l.rate)}</dd>
                </div>
                <div>
                  <dt>EMI amount</dt>
                  <dd>
                    {rupees(l.emiAmount)} <small>on day {l.emiDay}</small>
                  </dd>
                </div>
                <div>
                  <dt>Next EMI</dt>
                  <dd>{l.summary.next ? dayName(l.summary.next.date) : "—"}</dd>
                </div>
                <div>
                  <dt>Ends about</dt>
                  <dd>{l.summary.closed ? "closed" : shortMonth(l.summary.endMonth)}</dd>
                </div>
              </dl>
              <Bar pct={l.summary.repaidPct} label={`${l.name}: share repaid`} tone="is-good" />
              <p className="lo-note">
                {rateText(Math.round(l.summary.repaidPct * 10) / 10)} repaid · {l.method === "schedule" ? "on the lender’s schedule" : l.method === "emi" ? "the whole EMI comes off" : "split worked out from the rate"}
                {(l.documents || []).length ? ` · ${l.documents.length} document${l.documents.length === 1 ? "" : "s"}` : ""}
                {l.remarks ? ` · ${l.remarks}` : ""} · saved {when(l.updatedAt)}
              </p>
            </article>
          ))}
        </div>
        {removed.length > 0 && (
          <section className="lo-card">
            <SectionHead title="Removed loans" sub="Off the page and the totals, still in the database" />
            <ul className="lo-removed">
              {removed.map((r) => (
                <li key={r.id}>
                  <span>
                    {r.name} <small>removed {when(r.deletedAt)}</small>
                  </span>
                  <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => send(`${URL_}/${r.id}/restore`, { method: "POST" }).then(() => snack(`${r.name} is back.`, { tone: "ok" })).catch((e) => snack(e.message, { tone: "error" }))} aria-label={`Bring back ${r.name}`}>
                    Bring back
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </PagePart>

      <PagePart id="analysis" tab={tab}>{tab === "analysis" && data.loans.length > 0 && <Analysis data={data} send={send} />}</PagePart>

      <PagePart id="history" tab={tab}>
        <section className="lo-card">
          <SectionHead title="History" sub="The last 100 changes, newest first" />
          {data.history.length ? (
            <ol className="lo-history">
              {data.history.map((h, i) => (
                <li key={`${h.at}-${h.loanId}-${i}`}>
                  <time dateTime={h.at}>{when(h.at)}</time>
                  <span>
                    <b>{h.name}</b>: {h.what}
                  </span>
                  <small>by {h.by}</small>
                </li>
              ))}
            </ol>
          ) : (
            <p className="lo-empty">Nothing has changed yet.</p>
          )}
        </section>
      </PagePart>

      <SavedFoot data={data} readAt={data.at} />

      {editRow && <MonthDialog loan={editLoanRow} row={editRow} onClose={() => setEditing(null)} onSave={saveRow} />}
    </div>
  );
}
