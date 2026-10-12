// src/admin/Sales.jsx
// Orders and money: what has sold, what is waiting, who owns the book — and the
// handful of things that must be set before the first real sale (the gateway
// keys, an address and GSTIN for the receipts, permission to send mail).
//
// Refunds and grants are done here and checked again by the collector; a
// refund goes to Razorpay and takes the reader's copy away with it.

import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { call, explain } from "../api/collector";
import { shopMessage } from "../shop/api";
import { inr } from "../shop/format";
import { Card, Chip, Empty, Failure, Kpi, Loading } from "./ui";
import { download, fmtN, fmtWhen, tzMinutes, toCsv } from "./format";
import { IconAlert, IconCheck, IconDownload, IconReceipt, IconRefresh, IconSearch, IconTag, IconUsers } from "../components/ui/icons";
import { BOOK } from "../data/books";

const TONE = { paid: "ok", free: "ok", created: "warn", refunded: "muted", duplicate: "warn", pending: "warn" };
const LABEL = { paid: "paid", free: "free", created: "awaiting payment", refunded: "refunded", duplicate: "duplicate — refund by hand", pending: "to confirm" };

function Setup({ p }) {
  if (!p) return null;
  const upi = p.provider === "upi";
  const items = [
    upi
      ? {
          ok: p.ready,
          text: p.ready
            ? "Payment is by UPI / Google Pay to your UPI ID. Each order waits for you to confirm it below once the money is in your account."
            : "Your UPI ID is not set. In the script set UPI.vpa (or the script property UPI_ID).",
        }
      : {
          ok: p.ready,
          text: p.ready
            ? `Razorpay keys are set (${p.mode} mode)${p.mode === "test" ? " — no real money moves. Replace the key id/secret with the live ones when you are ready." : "."}`
            : "Razorpay keys are missing. In the script: Project Settings → Script properties → add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.",
        },
    {
      ok: p.mail !== false,
      text:
        p.mail !== false
          ? "The script may send mail, so receipts will go out."
          : "The script has not been given permission to send mail yet. In the script editor run setupPayments once and accept the permission.",
    },
    {
      ok: p.paywall,
      text: p.paywall ? "Paywall is on: only owners (and the admin team) are given the book key." : "PAYWALL is off in the script — any signed-in reader can read. Set PAYWALL = true to sell.",
    },
    {
      ok: p.address,
      text: p.address ? "Seller address is set — it is printed on every receipt." : "SELLER.address is empty in the script — receipts print without an address.",
    },
    {
      ok: !p.gst || p.gstin,
      text: !p.gst
        ? "GST is off: receipts say GST is not applicable. Right if you are not registered."
        : p.gstin
        ? "GST is on, with your GSTIN on every invoice."
        : "GST is on but SELLER.gstin is empty. Add your GSTIN — or set GST.enabled = false if you are not registered.",
    },
  ];
  return (
    <Card title="Ready to sell?" sub="What the script reports about itself">
      <ul className="sales__setup">
        {items.map((i, n) => (
          <li key={n} className={i.ok ? "is-ok" : "is-bad"}>
            {i.ok ? <IconCheck size={18} strokeWidth={2.4} /> : <IconAlert size={18} />}
            <span>{i.text}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function Sales() {
  const [state, setState] = useState({ status: "loading", data: null, error: null });
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState(null);
  const [grant, setGrant] = useState("");

  const load = useCallback(async (term, st) => {
    setState((s) => ({ ...s, status: "loading", error: null }));
    try {
      const d = await call("orders_list", { q: term || "", status: st || "", tzMin: tzMinutes(), limit: 300 });
      setState({ status: "ready", data: d, error: null });
    } catch (e) {
      setState((s) => ({ ...s, status: "error", error: e }));
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(q, status), q ? 350 : 0);
    return () => clearTimeout(t);
  }, [q, status, load]);

  const d = state.data;
  const k = d && d.kpi;

  const confirmPay = async (o) => {
    if (!window.confirm(`Confirm ${inr(o.total)} from ${o.email}?\n\nUPI transaction number: ${o.utr}\n\nOnly confirm once this amount is in your account. The reader gets the book and the receipt at once.`)) return;
    setBusy(o.id);
    setNote(null);
    try {
      await call("order_confirm", { orderId: o.id });
      setNote({ ok: true, text: `Confirmed. ${o.email} now has the book and the receipt is on its way.` });
      load(q, status);
    } catch (e) {
      setNote({ ok: false, text: e && e.code === "duplicate" ? "They already own this book — refund that UPI payment by hand." : shopMessage(e) });
      load(q, status);
    }
    setBusy("");
  };

  const rejectPay = async (o) => {
    const reason = window.prompt("Why is it not confirmed? (the reader is e-mailed this)", "यह लेन-देन संख्या हमारे खाते में नहीं मिली।");
    if (reason === null) return;
    setBusy(o.id);
    setNote(null);
    try {
      await call("order_reject", { orderId: o.id, reason });
      setNote({ ok: true, text: "The reader has been told and may enter the number again." });
      load(q, status);
    } catch (e) {
      setNote({ ok: false, text: shopMessage(e) });
    }
    setBusy("");
  };

  const refund = async (o) => {
    if (!window.confirm(`Refund ${inr(o.total)} to ${o.email} and take the book away from that account?\n\nOrder ${o.id}`)) return;
    setBusy(o.id);
    setNote(null);
    try {
      await call("order_refund", { orderId: o.id });
      setNote({ ok: true, text: `Order ${o.id} refunded.` });
      load(q, status);
    } catch (e) {
      setNote({ ok: false, text: e && e.why ? `${shopMessage(e)} (${e.why})` : shopMessage(e) });
    }
    setBusy("");
  };

  const resend = async (o) => {
    setBusy(o.id);
    setNote(null);
    try {
      const r = await call("shop_resend", { orderId: o.id });
      setNote({ ok: r.mailed === "sent", text: r.mailed === "sent" ? `Receipt sent to ${o.email}.` : `Mail not sent (${r.mailed}).` });
      load(q, status);
    } catch (e) {
      setNote({ ok: false, text: shopMessage(e) });
    }
    setBusy("");
  };

  const give = async (e) => {
    e.preventDefault();
    const email = grant.trim().toLowerCase();
    if (!email) return;
    setBusy("grant");
    setNote(null);
    try {
      const r = await call("order_grant", { email, slug: BOOK.slug, note: "granted from the dashboard" });
      setNote({ ok: true, text: r.granted ? `${email} can now read the book.` : `${email} already has the book.` });
      setGrant("");
      load(q, status);
    } catch (err) {
      setNote({ ok: false, text: explain(err) });
    }
    setBusy("");
  };

  const exportCsv = () =>
    download(
      `orders-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(d.rows, [
        { label: "Order", key: "id" },
        { label: "Invoice", key: "invoice" },
        { label: "Status", key: "status" },
        { label: "Placed", key: "at" },
        { label: "Paid", key: "paidAt" },
        { label: "Name", key: "name" },
        { label: "E-mail", key: "email" },
        { label: "Coupon", key: "coupon" },
        { label: "MRP", key: "mrp" },
        { label: "Price", key: "list" },
        { label: "Discount", key: "discount" },
        { label: "GST", key: "tax" },
        { label: "Total", key: "total" },
        { label: "Method", key: "method" },
        { label: "Receipt mail", key: "mailed" },
      ])
    );

  return (
    <div className="dsh__body">
      {state.status === "error" && !d && <Failure error={state.error} text={explain(state.error)} onRetry={() => load(q, status)} />}
      {state.status === "loading" && !d && <Loading label="Loading orders…" />}

      {d && (
        <>
          <Setup p={d.payments} />

          <div className="kpis kpis--4">
            <Kpi label="Revenue · all time" icon={<IconReceipt size={18} />} value={inr(k.revenue)} hint={`${fmtN(k.paid)} paid · ${fmtN(k.free)} free`} />
            <Kpi label="Today" value={inr(k.today)} hint={`${fmtN(k.todayCount)} order${k.todayCount === 1 ? "" : "s"}`} />
            <Kpi label="Last 7 days" value={inr(k.week)} hint={`${fmtN(k.weekCount)} orders`} />
            <Kpi label="Last 30 days" value={inr(k.month)} hint={`${fmtN(k.monthCount)} orders`} />
          </div>
          <div className="kpis kpis--4">
            <Kpi label="GST in paid orders" value={inr(k.tax)} hint="included in revenue" />
            <Kpi label="Discounts given" icon={<IconTag size={18} />} value={inr(k.discount)} hint="coupons, paid + free" />
            <Kpi label="Awaiting payment" value={fmtN(k.open)} hint="orders not yet paid" tone={k.open ? "warn" : ""} />
            <Kpi label="Owners of the book" icon={<IconUsers size={18} />} value={fmtN(d.owners)} hint={`${fmtN(k.refunded)} refunded`} />
          </div>

          {d.rows.some((o) => o.status === "pending") && (
            <Card title="Waiting for your confirmation" sub="Paid by UPI — check your account, then confirm. The book opens only when you do.">
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Reader</th>
                      <th className="num">Amount</th>
                      <th>UPI transaction number</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows
                      .filter((o) => o.status === "pending")
                      .map((o) => (
                        <tr key={o.id}>
                          <td>
                            <b>{o.name || "—"}</b>
                            <small className="sub">{o.email}</small>
                          </td>
                          <td className="num">
                            <b>{inr(o.total)}</b>
                            <small className="sub">{fmtWhen(o.claimedAt || o.at)}</small>
                          </td>
                          <td>
                            <span className="dmono">{o.utr}</span>
                            <small className="sub">{o.id}</small>
                          </td>
                          <td className="num">
                            <div className="row">
                              <button type="button" className="db db--solid db--sm" onClick={() => confirmPay(o)} disabled={busy === o.id}>
                                Confirm
                              </button>
                              <button type="button" className="db db--ghost db--sm" onClick={() => rejectPay(o)} disabled={busy === o.id}>
                                Not found
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card title="Give someone the book" sub="A reviewer's copy, a gift, or a reader who paid another way. They need only sign in with this e-mail.">
            <form className="sales__grant" onSubmit={give}>
              <input type="email" value={grant} onChange={(e) => setGrant(e.target.value)} placeholder="reader@example.com" aria-label="E-mail" required />
              <button type="submit" className="db db--solid" disabled={busy === "grant"}>
                {busy === "grant" ? "Granting…" : "Give access"}
              </button>
            </form>
          </Card>

          {note && (
            <p className={`note ${note.ok ? "is-ok" : "is-bad"}`} role="status">
              {note.text}
            </p>
          )}

          <Card
            pad={false}
            title="Orders"
            sub={`${fmtN(d.total)} order${d.total === 1 ? "" : "s"}`}
            action={
              <div className="row">
                <label className="srch">
                  <IconSearch size={16} />
                  <input type="search" placeholder="E-mail, order, invoice, code" value={q} onChange={(e) => setQ(e.target.value)} />
                </label>
                <select className="sel" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
                  <option value="">All</option>
                  <option value="paid">Paid</option>
                  <option value="free">Free</option>
                  <option value="pending">To confirm (UPI)</option>
                  <option value="created">Awaiting payment</option>
                  <option value="refunded">Refunded</option>
                  <option value="duplicate">Duplicate (needs refund)</option>
                </select>
                <button type="button" className="db db--ghost db--sm" onClick={() => load(q, status)}>
                  <IconRefresh size={15} /> Refresh
                </button>
                <button type="button" className="db db--ghost db--sm" onClick={exportCsv} disabled={!d.rows.length}>
                  <IconDownload size={15} /> CSV
                </button>
              </div>
            }
          >
            {!d.rows.length ? (
              <Empty>No orders{q || status ? " for this filter" : " yet"}.</Empty>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Buyer</th>
                      <th>Coupon</th>
                      <th className="num">Total</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <b className="dmono">{o.invoice || o.id}</b>
                          <small className="sub">
                            {fmtWhen(o.paidAt || o.at)}
                            {o.invoice ? ` · ${o.id}` : ""}
                          </small>
                        </td>
                        <td>
                          <b>{o.name || "—"}</b>
                          <small className="sub">{o.email}</small>
                        </td>
                        <td>{o.coupon ? <span className="dmono">{o.coupon}</span> : "—"}</td>
                        <td className="num">
                          <b>{inr(o.total)}</b>
                          <small className="sub">{o.method || ""}</small>
                        </td>
                        <td>
                          <Chip tone={TONE[o.status] || "muted"}>{LABEL[o.status] || o.status}</Chip>
                          {o.mailed && o.mailed !== "sent" && (o.status === "paid" || o.status === "free") ? <Chip tone="warn">mail {o.mailed}</Chip> : null}
                        </td>
                        <td className="num">
                          <div className="row">
                            <Link className="db db--ghost db--sm" to={`/receipt/${encodeURIComponent(o.id)}`}>
                              Receipt
                            </Link>
                            {(o.status === "paid" || o.status === "free") && (
                              <>
                                <button type="button" className="db db--ghost db--sm" onClick={() => resend(o)} disabled={busy === o.id}>
                                  Resend
                                </button>
                                <button type="button" className="db db--danger db--sm" onClick={() => refund(o)} disabled={busy === o.id}>
                                  Refund
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
