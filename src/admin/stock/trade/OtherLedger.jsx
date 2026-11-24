// Other credits & debits (24 Nov 2026) — Zerodha Console's P&L report has a line for the money that is neither a trade nor a
// trading charge: DP charges billed separately, the annual maintenance charge, interest, dividends, call-and-trade fees,
// penalties. Zerodha's API gives no ledger, so this panel takes them from Zerodha's own LEDGER file (Console → Funds →
// Statement, .csv or .xlsx) or by hand, lists every entry, and the total goes into Net realised P&L, as in Console.
// A DP charge on a day whose trades already carry an estimated DP charge is listed but not counted twice.
import React, { useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { Alert } from "../../ui";
import { useDialog } from "../../dialog/DialogProvider";
import { DateField } from "../../DatePicker";
import { isNum, num } from "../analyzer/format";
import "./other-ledger.css";

const IST = 5.5 * 3600 * 1000;
const today = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const sMoney = (x) => (isNum(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}₹${num(Math.abs(x))}` : "—");
const tone = (x) => (!isNum(x) || x === 0 ? "" : x > 0 ? "is-up" : "is-down");
const dayText = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || "");
  return m ? `${Number(m[3])} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m[2]) - 1]} ${m[1]}` : d || "";
};
const SHOWN = 12;

/** What the ledger file's import said, in words. Pure, for the tests. */
export function importSaid(r) {
  if (!r) return "";
  const left = Object.entries(r.left || {}).filter(([, n]) => n > 0);
  const skipped = left.length ? ` Left out, as they are not “other”: ${left.map(([k, n]) => `${n} ${k}`).join(", ")}.` : "";
  if (!r.added) return `${r.name ? `${r.name}: ` : ""}nothing new — ${r.read ? "the entries in it are already here" : "it holds no other credits or debits"}.${skipped}`;
  return `${r.name ? `${r.name}: ` : ""}${r.added} new entr${r.added === 1 ? "y" : "ies"} added.${skipped}`;
}

export default function OtherLedger({ other, label = "", onChanged = () => {} }) {
  const ask = useDialog();
  const file = useRef(null);
  const [form, setForm] = useState({ date: today(), kind: "other", side: "debit", amount: "", note: "" });
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [all, setAll] = useState(false);
  const list = useMemo(() => (other && other.entries ? [...other.entries].reverse() : []), [other]);
  const kinds = (other && other.kinds) || { other: "Other" };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e && e.target ? e.target.value : e }));
  const fail = (e) => setMsg({ kind: "error", text: e.message || String(e) });

  const add = async (e) => {
    e.preventDefault();
    const n = Number(String(form.amount).replace(/,/g, ""));
    if (!(n > 0)) return setMsg({ kind: "error", text: "Give the amount as a plain number (the debit or credit sign is the choice beside it)." });
    setBusy("add");
    try {
      await api("/api/admin/trading/journal/other", { method: "POST", body: { date: form.date, kind: form.kind, amount: form.side === "debit" ? -n : n, note: form.note } });
      setForm((f) => ({ ...f, amount: "", note: "" }));
      setMsg({ kind: "ok", text: "Added. It is part of Net realised P&L now." });
      onChanged();
    } catch (err) {
      fail(err);
    }
    setBusy("");
  };
  const remove = async (en) => {
    const yes = await ask({ tone: "danger", title: "Remove this entry?", body: `${dayText(en.date)} · ${en.note || kinds[en.kind] || "Other"} · ${sMoney(en.amount)}. Net realised P&L changes by the same amount.`, confirmText: "Remove it", cancelText: "Keep it" });
    if (!yes) return;
    setBusy(en.id);
    try {
      await api(`/api/admin/trading/journal/other/${encodeURIComponent(en.id)}`, { method: "DELETE" });
      setMsg({ kind: "ok", text: "Removed." });
      onChanged();
    } catch (err) {
      fail(err);
    }
    setBusy("");
  };
  const readFile = async (f) => {
    if (!f) return;
    if (!/\.(csv|xlsx|txt)$/i.test(f.name)) return setMsg({ kind: "error", text: "Only a .csv or .xlsx ledger from Console (Funds → Statement) can be read." });
    setBusy("file");
    setMsg({ kind: "", text: "" });
    try {
      const st = await api("/api/admin/trading/journal/upload", { method: "POST", body: { name: f.name, size: f.size } });
      for (let i = 0, k = 0; i < f.size; i += st.partSize, k += 1) {
        const res = await fetch(`/api/admin/trading/journal/upload/${st.id}/${k}`, { method: "PUT", credentials: "same-origin", headers: { "X-Requested-With": "vpt", "Content-Type": "application/octet-stream", Accept: "application/json" }, body: f.slice(i, i + st.partSize) });
        if (!res.ok) {
          const d = await res.json().catch(() => null);
          throw new Error((d && d.message) || `The upload failed (${res.status}).`);
        }
      }
      const r = await api(`/api/admin/trading/journal/upload/${st.id}/finish-ledger`, { method: "POST", body: {} });
      setMsg({ kind: "ok", text: importSaid(r) });
      onChanged();
    } catch (err) {
      fail(err);
    }
    if (file.current) file.current.value = "";
    setBusy("");
  };

  const total = other ? other.total : null;
  const shown = all ? list : list.slice(0, SHOWN);
  return (
    <section className="an-card ol" aria-labelledby="ol-h" data-jump="Other credits &amp; debits">
      <header className="ol-head">
        <div>
          <h3 id="ol-h" className="jr-h">
            Other credits &amp; debits
          </h3>
          <p>
            Money in Zerodha’s ledger that is not a trade or a trading charge{label ? ` · ${label}` : ""}: DP charges billed separately, the annual maintenance charge, interest, dividends. Zerodha’s API does not give them, so read them from your Console ledger or enter them — the total is part of Net realised P&amp;L, as in Console.
          </p>
        </div>
        <div className="ol-act">
          <input ref={file} type="file" accept=".csv,.xlsx,.txt" hidden onChange={(e) => readFile(e.target.files && e.target.files[0])} />
          <button type="button" className="adm-btn adm-btn--sm" disabled={busy === "file"} onClick={() => file.current && file.current.click()} data-tip="Console → Funds → Statement (ledger) → download the .csv or .xlsx for the period, and read it here. Trade settlements and fund transfers in it are left out; lines already here are skipped.">
            {busy === "file" ? "Reading the ledger…" : "Read Console ledger"}
          </button>
        </div>
      </header>

      <dl className="ol-kpis">
        <div>
          <dt>Credits</dt>
          <dd className={tone(other && other.credits)}>{other ? sMoney(other.credits) : "—"}</dd>
        </div>
        <div>
          <dt>Debits</dt>
          <dd className={tone(other && other.debits)}>{other ? sMoney(other.debits) : "—"}</dd>
        </div>
        <div>
          <dt>Total counted</dt>
          <dd className={tone(total)}>{other && other.count ? sMoney(total) : "—"}</dd>
        </div>
      </dl>

      <Alert kind={msg.kind === "ok" ? "ok" : "error"}>{msg.text}</Alert>

      {list.length === 0 ? (
        <p className="ol-empty">Nothing recorded for {label || "this period"}. If Console’s P&amp;L report shows a figure under “Other credits &amp; debits”, read your ledger or enter it below, and Net realised P&amp;L will match.</p>
      ) : (
        <div className="ol-wrap">
          <table className="ol-table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Kind</th>
                <th scope="col">Detail</th>
                <th scope="col" className="is-num">
                  Amount
                </th>
                <th scope="col">
                  <span className="ol-sr">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((en) => (
                <tr key={en.id} className={en.covered ? "is-covered" : ""}>
                  <td>{dayText(en.date)}</td>
                  <td>{kinds[en.kind] || "Other"}</td>
                  <td>
                    {en.note || "—"}
                    {en.source === "console" && <span className="ol-tag">ledger</span>}
                    {en.covered && <span className="ol-tag" data-tip="This day’s trades already carry an estimated DP charge in Charges & taxes, so this entry is listed but not counted again.">already in charges</span>}
                  </td>
                  <td className={`is-num ${en.covered ? "" : tone(en.amount)}`}>{sMoney(en.amount)}</td>
                  <td className="is-act">
                    <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={busy === en.id} onClick={() => remove(en)} aria-label={`Remove the entry of ${dayText(en.date)}`}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length > SHOWN && (
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" data-ico="none" onClick={() => setAll((v) => !v)}>
              {all ? "Show the latest only" : `Show all ${list.length} entries`}
            </button>
          )}
        </div>
      )}

      <form className="ol-form" onSubmit={add} aria-label="Add an entry by hand">
        <label>
          <span>Date</span>
          <DateField value={form.date} onChange={set("date")} max={today()} label="Date of the entry" />
        </label>
        <label>
          <span>Kind</span>
          <select value={form.kind} onChange={set("kind")}>
            {Object.entries(kinds).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Credit or debit</span>
          <select value={form.side} onChange={set("side")}>
            <option value="debit">Debit (money out)</option>
            <option value="credit">Credit (money in)</option>
          </select>
        </label>
        <label>
          <span>Amount (₹)</span>
          <input inputMode="decimal" value={form.amount} onChange={set("amount")} placeholder="e.g. 354" autoComplete="off" />
        </label>
        <label className="ol-note">
          <span>Detail (optional)</span>
          <input value={form.note} onChange={set("note")} maxLength={120} placeholder="e.g. AMC for 2026" autoComplete="off" />
        </label>
        <button type="submit" className="adm-btn adm-btn--primary" disabled={busy === "add"}>
          Add entry
        </button>
      </form>
    </section>
  );
}
