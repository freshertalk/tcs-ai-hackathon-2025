// Money from people (cash) — only what such a loan has: who, the date, the amount, what is paid back, what is left, "Is
// paid?" and remarks. No rate, no EMI, no months, no documents. Repayments are typed by hand and can be changed or removed.
import React, { useState } from "react";
import { Alert } from "../ui";
import { DateField } from "../DatePicker";
import { SectionHead } from "../ux/PageKit";
import { cashLoans, dayName, rupees } from "./loanData";
import { RemarksBox, URL_ } from "./shared";

function PaymentForm({ loan, today, payment, onSubmit, onCancel }) {
  const [f, setF] = useState({ date: payment ? payment.date : today, amount: payment ? String(payment.amount) : "", note: payment ? payment.note : "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
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
  return (
    <form className="lo-pay" onSubmit={submit} aria-label={payment ? "Change a repayment" : `Add a repayment to ${loan.name}`}>
      <div className="lo-field">
        <DateField label="Paid on" value={f.date} onChange={(v) => setF({ ...f, date: v })} min={loan.openingDate} max={today} id={`lo-pay-${loan.id}`} />
      </div>
      <label className="lo-field">
        <span>Amount paid (₹)</span>
        <input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
      </label>
      <label className="lo-field">
        <span>Note</span>
        <input value={f.note} maxLength={200} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="cash, UPI…" />
      </label>
      <span className="lo-acts">
        <button type="submit" className="adm-btn adm-btn--solid adm-btn--sm" disabled={busy}>
          {busy ? "Saving…" : payment ? "Save" : "Add repayment"}
        </button>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={onCancel}>
          Cancel
        </button>
      </span>
      <Alert>{err}</Alert>
    </form>
  );
}

/**
 * @param only  show just this cash loan, with its repayments open (the Schedules tab)
 * @param send  (url, options) → the whole book, as every change answers
 */
export default function CashLoans({ data, only = "", send, onPaid, onEdit, onRemove, onAdd, onError, busy }) {
  const loans = only ? cashLoans(data).filter((l) => l.id === only) : cashLoans(data);
  const [open, setOpen] = useState(only);
  const [paying, setPaying] = useState(null); // { loanId, paymentId }
  if (!loans.length) return null;
  const t = data.totals.cash;
  const saveRemark = (l, remarks) => send(`${URL_}/${l.id}`, { method: "PUT", body: { name: l.name, openingDate: l.openingDate, totalAmount: l.totalAmount, remarks } }).catch(onError);
  const submit = (l, p) => async (f) => {
    await send(p ? `${URL_}/${l.id}/payments/${p.id}` : `${URL_}/${l.id}/payments`, { method: p ? "PUT" : "POST", body: f });
    setPaying(null);
    setOpen(l.id);
  };
  return (
    <section className="lo-card lo-cash" aria-label="Money from people">
      <SectionHead
        title="Money from people (cash)"
        sub={only ? "What you have paid back, one entry at a time" : `${t.open} not paid in full · ${rupees(t.outstanding)} left of ${rupees(t.borrowed)}`}
        actions={
          onAdd ? (
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={onAdd}>
              Add cash taken
            </button>
          ) : null
        }
      />
      <div className="lo-scroll">
        <table className="lo-table lo-table--cash">
          <caption className="adm-sr">Money taken from people</caption>
          <thead>
            <tr>
              <th scope="col">Sr. No.</th>
              <th scope="col">From</th>
              <th scope="col">Date Taken</th>
              <th scope="col" className="is-num">Total Amount</th>
              <th scope="col" className="is-num">Paid Back</th>
              <th scope="col" className="is-num">Outstanding Loan Amount</th>
              <th scope="col">Is Paid?</th>
              <th scope="col">Remarks</th>
            </tr>
          </thead>
          {loans.map((l, i) => {
            const s = l.summary;
            const isOpen = open === l.id;
            const adding = paying && paying.loanId === l.id;
            return (
              <tbody key={l.id}>
                <tr className={s.closed ? "is-paid" : ""}>
                  <td data-label="Sr. No.">{i + 1}</td>
                  <th scope="row" data-label="From" className="lo-name">
                    {l.name}
                    <span className="lo-rowacts">
                      <button type="button" className="lo-link" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? "" : l.id)}>
                        {isOpen ? "Hide repayments" : `Repayments (${l.payments.length})`}
                      </button>
                      <button type="button" className="lo-link" onClick={() => onEdit(l)} aria-label={`Edit ${l.name}`}>
                        Edit
                      </button>
                      <button type="button" className="lo-link" onClick={() => onRemove(l)} aria-label={`Remove ${l.name}`}>
                        Remove
                      </button>
                    </span>
                  </th>
                  <td data-label="Date Taken">{dayName(l.openingDate)}</td>
                  <td data-label="Total Amount" className="is-num">{rupees(l.totalAmount)}</td>
                  <td data-label="Paid Back" className="is-num">
                    {rupees(s.paidAmount)}
                    {!s.closed && (
                      <button type="button" className="lo-link lo-edit" onClick={() => setPaying({ loanId: l.id, paymentId: "" })} aria-label={`Add a repayment to ${l.name}`}>
                        + Add repayment
                      </button>
                    )}
                  </td>
                  <td data-label="Outstanding" className="is-num lo-out">
                    <b>{rupees(s.outstanding)}</b>
                    {s.lastPaid && <small>last paid {dayName(s.lastPaid)}</small>}
                  </td>
                  <td data-label="Is Paid?">
                    <label className="lo-tick">
                      <input type="checkbox" checked={s.closed} disabled={busy === `${l.id}:cash`} onChange={(e) => onPaid(l, e.target.checked)} aria-label={`Is paid in full: ${l.name}`} />
                      <span>{s.closed ? "Paid" : "Not paid"}</span>
                    </label>
                  </td>
                  <td data-label="Remarks" className="lo-rem">
                    <RemarksBox value={l.remarks} label={`Remarks for ${l.name}`} onSave={(v) => saveRemark(l, v)} />
                  </td>
                </tr>
                {(isOpen || adding) && (
                  <tr className="lo-payrow">
                    <td colSpan={8} data-label="">
                      {l.payments.length > 0 ? (
                        <ul className="lo-payments" aria-label={`Repayments to ${l.name}`}>
                          {l.payments.map((p) => (
                            <li key={p.id}>
                              <span>{dayName(p.date)}</span>
                              <b>{rupees(p.amount)}</b>
                              <span className="lo-note">{p.note}</span>
                              <span className="lo-note">left {rupees(p.outstanding)}</span>
                              <span className="lo-rowacts">
                                <button type="button" className="lo-link" onClick={() => setPaying({ loanId: l.id, paymentId: p.id })} aria-label={`Change the repayment of ${dayName(p.date)}`}>
                                  Change
                                </button>
                                <button type="button" className="lo-link" onClick={() => send(`${URL_}/${l.id}/payments/${p.id}`, { method: "DELETE" }).catch(onError)} aria-label={`Remove the repayment of ${dayName(p.date)}`}>
                                  Remove
                                </button>
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="lo-note">Nothing paid back yet.</p>
                      )}
                      {adding ? (
                        <PaymentForm key={paying.paymentId || "new"} loan={l} today={data.today} payment={l.payments.find((p) => p.id === paying.paymentId) || null} onSubmit={submit(l, l.payments.find((p) => p.id === paying.paymentId) || null)} onCancel={() => setPaying(null)} />
                      ) : !s.closed ? (
                        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setPaying({ loanId: l.id, paymentId: "" })}>
                          Add a repayment
                        </button>
                      ) : null}
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
        </table>
      </div>
    </section>
  );
}
