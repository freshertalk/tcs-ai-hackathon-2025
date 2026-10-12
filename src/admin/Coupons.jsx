// src/admin/Coupons.jsx
// Discount codes: make them, limit them (how long, how many times, for whom),
// pause them, and see every use.
//
// What the collector enforces, whatever this screen shows:
//   • the price a code is applied to (the collector's own price table)
//   • how many times a code, and a person, may use it
//   • the window it is valid in, the book it is for, who is eligible
//   • that only an admin can make or change one

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { call, explain } from "../api/collector";
import { BOOK } from "../data/books";
import { Card, Chip, Empty, Failure, Loading } from "./ui";
import { download, fmtAgo, fmtN, fmtWhen, rupees, toCsv } from "./format";
import { IconCopy, IconPause, IconPlay, IconPlus, IconRefresh, IconTag, IconDownload } from "../components/ui/icons";

const TYPES = [
  { id: "percent", label: "Percent off", unit: "%", hint: "e.g. 20 → 20% off the selling price" },
  { id: "flat", label: "Flat amount off", unit: "₹", hint: "e.g. 15 → ₹15 off" },
  { id: "fixed", label: "Fixed price", unit: "₹", hint: "e.g. 49 → the book costs ₹49" },
];

const BLANK = {
  code: "",
  type: "percent",
  value: 20,
  maxUses: 0,
  perUser: 1,
  from: "",
  to: "",
  audience: "",
  book: "",
  note: "",
  active: true,
};

const STATUS = {
  live: { label: "Live", tone: "ok" },
  scheduled: { label: "Scheduled", tone: "info" },
  expired: { label: "Expired", tone: "muted" },
  exhausted: { label: "Used up", tone: "warn" },
  paused: { label: "Paused", tone: "muted" },
};

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode() {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return "CHAI" + Array.from(b, (x) => ALPHABET[x % ALPHABET.length]).join("");
}

// ISO <-> <input type="datetime-local">
const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : "");

function priceAfter(type, value, selling) {
  const v = Number(value) || 0;
  let f = selling;
  if (type === "percent") f = Math.round(selling * (1 - Math.min(100, Math.max(0, v)) / 100));
  else if (type === "flat") f = selling - v;
  else if (type === "fixed") f = Math.min(selling, v);
  return Math.max(0, Math.round(f));
}

const offerText = (c) =>
  c.type === "percent" ? `${c.value}% off` : c.type === "flat" ? `${rupees(c.value)} off` : `Fixed ${rupees(c.value)}`;

function inDays(n) {
  return new Date(Date.now() + n * 86400000).toISOString();
}

const PRESETS = [
  { label: "Festival week · 20%", make: () => ({ type: "percent", value: 20, perUser: 1, maxUses: 0, from: new Date().toISOString(), to: inDays(7), audience: "", note: "Festival offer" }) },
  { label: "College group · 30%", make: () => ({ type: "percent", value: 30, perUser: 1, maxUses: 0, from: "", to: inDays(30), audience: "@college.edu", note: "Group discount — replace the domain" }) },
  { label: "Friends price · ₹49", make: () => ({ type: "fixed", value: 49, perUser: 1, maxUses: 25, from: "", to: "", audience: "", note: "First 25 friends" }) },
  { label: "Free copies · 10", make: () => ({ type: "percent", value: 100, perUser: 1, maxUses: 10, from: "", to: "", audience: "", note: "Gifted copies" }) },
];

export default function Coupons() {
  const [list, setList] = useState({ status: "loading", rows: [], error: null });
  const [form, setForm] = useState(BLANK);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const [used, setUsed] = useState(null); // { code, rows }
  const selling = BOOK.price.selling;

  const load = useCallback(async () => {
    setList((s) => ({ ...s, status: "loading", error: null }));
    try {
      const d = await call("coupon_list");
      setList({ status: "ready", rows: d.rows || [], error: null });
    } catch (e) {
      setList((s) => ({ ...s, status: "error", error: e }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const preview = useMemo(() => priceAfter(form.type, form.value, selling), [form.type, form.value, selling]);
  const type = TYPES.find((t) => t.id === form.type);

  const edit = (c) => {
    setEditing(true);
    setMsg(null);
    setForm({
      code: c.code,
      type: c.type,
      value: c.value,
      maxUses: c.maxUses,
      perUser: c.perUser,
      from: toLocalInput(c.from),
      to: toLocalInput(c.to),
      audience: c.audience,
      book: c.book,
      note: c.note,
      active: c.active,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const fresh = () => {
    setEditing(false);
    setMsg(null);
    setForm({ ...BLANK, code: genCode() });
  };

  const applyPreset = (p) => {
    const v = p.make();
    setForm((f) => ({
      ...f,
      ...v,
      from: toLocalInput(v.from),
      to: toLocalInput(v.to),
      code: f.code || genCode(),
    }));
    setEditing(false);
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy("save");
    setMsg(null);
    try {
      const d = await call("coupon_save", {
        code: form.code.trim().toUpperCase(),
        type: form.type,
        value: Number(form.value),
        maxUses: Number(form.maxUses) || 0,
        perUser: Number(form.perUser) || 0,
        from: fromLocalInput(form.from),
        to: fromLocalInput(form.to),
        audience: form.audience,
        book: form.book,
        note: form.note,
        active: form.active,
      });
      setMsg({ ok: true, text: d.created ? `Coupon ${d.code} created.` : `Coupon ${d.code} updated.` });
      setEditing(false);
      setForm({ ...BLANK, code: genCode() });
      load();
    } catch (err) {
      const why = err && err.why ? { code: "the code (3–24 letters or digits, at least one letter)", value: "the amount (percent 1–100)", dates: "the dates (the end must be after the start)", type: "the type", book: "the book" }[err.why] : "";
      setMsg({ ok: false, text: why ? `Please check ${why}.` : explain(err) });
    }
    setBusy("");
  };

  const toggle = async (c) => {
    setBusy(c.code);
    try {
      await call("coupon_toggle", { code: c.code, active: !c.active });
      await load();
    } catch (err) {
      setMsg({ ok: false, text: explain(err) });
    }
    setBusy("");
  };

  const showUses = async (c) => {
    if (used && used.code === c.code) {
      setUsed(null);
      return;
    }
    setBusy(`u${c.code}`);
    try {
      const d = await call("coupon_redemptions", { code: c.code });
      setUsed({ code: c.code, rows: d.rows || [] });
    } catch (err) {
      setMsg({ ok: false, text: explain(err) });
    }
    setBusy("");
  };

  const copy = async (c) => {
    const until = c.to ? ` Valid till ${fmtWhen(c.to).split(",")[0]}.` : "";
    const text = `Use code ${c.code} and get ${BOOK.title} for ${rupees(c.sample)} (usually ${rupees(selling)}).${until}`;
    try {
      await navigator.clipboard.writeText(text);
      setMsg({ ok: true, text: `Copied: “${text}”` });
    } catch {
      setMsg({ ok: false, text: text });
    }
  };

  return (
    <div className="cp">
      <Card
        title={editing ? `Edit coupon ${form.code}` : "Create a coupon"}
        sub="The book sells for the amount below; the collector applies the code to that price."
        action={
          <button type="button" className="db db--ghost db--sm" onClick={fresh}>
            <IconPlus size={15} /> New
          </button>
        }
      >
        <div className="chips-row" aria-label="Quick starts">
          {PRESETS.map((p) => (
            <button key={p.label} type="button" className="dpill" onClick={() => applyPreset(p)}>
              {p.label}
            </button>
          ))}
        </div>

        <form className="cpf" onSubmit={save}>
          <label className="fld">
            <span>Code</span>
            <div className="fld__row">
              <input value={form.code} onChange={set("code")} placeholder="e.g. DIWALI20" maxLength={24} required disabled={editing} spellCheck="false" autoCapitalize="characters" />
              {!editing && (
                <button type="button" className="db db--ghost db--sm" onClick={() => setForm((f) => ({ ...f, code: genCode() }))}>
                  Generate
                </button>
              )}
            </div>
          </label>

          <label className="fld">
            <span>Type</span>
            <select value={form.type} onChange={set("type")}>
              {TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <small>{type.hint}</small>
          </label>

          <label className="fld">
            <span>Amount ({type.unit})</span>
            <input type="number" min="0" max={form.type === "percent" ? 100 : 100000} value={form.value} onChange={set("value")} required />
            <small>
              {rupees(selling)} → <b>{rupees(preview)}</b>
              {preview === 0 ? " (free)" : ""}
            </small>
          </label>

          <label className="fld">
            <span>Total uses allowed</span>
            <input type="number" min="0" value={form.maxUses} onChange={set("maxUses")} />
            <small>0 = unlimited</small>
          </label>

          <label className="fld">
            <span>Uses per person</span>
            <input type="number" min="0" value={form.perUser} onChange={set("perUser")} />
            <small>0 = unlimited</small>
          </label>

          <label className="fld">
            <span>Valid from</span>
            <input type="datetime-local" value={form.from} onChange={set("from")} />
            <small>empty = from now</small>
          </label>

          <label className="fld">
            <span>Valid until</span>
            <input type="datetime-local" value={form.to} onChange={set("to")} />
            <small>empty = no end</small>
          </label>

          <label className="fld">
            <span>For</span>
            <select value={form.book} onChange={set("book")}>
              <option value="">Every book</option>
              <option value={BOOK.slug}>{BOOK.title}</option>
            </select>
          </label>

          <label className="fld fld--wide">
            <span>Who can use it (a group)</span>
            <textarea rows={2} value={form.audience} onChange={set("audience")} placeholder="Leave empty for everyone. Or: @college.edu, friend@gmail.com" />
            <small>Comma-separated e-mail addresses, or a whole domain written as @domain.edu</small>
          </label>

          <label className="fld fld--wide">
            <span>Note (only you see it)</span>
            <input value={form.note} onChange={set("note")} maxLength={140} placeholder="What this code is for" />
          </label>

          <label className="sw fld--wide">
            <input type="checkbox" checked={form.active} onChange={set("active")} />
            <span className="sw__t" aria-hidden="true" />
            <span>{form.active ? "Active" : "Paused"}</span>
          </label>

          <div className="cpf__act fld--wide">
            <button type="submit" className="db db--solid" disabled={busy === "save"}>
              <IconTag size={17} /> {busy === "save" ? "Saving…" : editing ? "Save changes" : "Create coupon"}
            </button>
            {msg && (
              <span className={`note ${msg.ok ? "is-ok" : "is-bad"}`} role="status">
                {msg.text}
              </span>
            )}
          </div>
        </form>
      </Card>

      <Card
        pad={false}
        title="Coupons"
        sub={`${list.rows.length} in all`}
        action={
          <button type="button" className="db db--ghost db--sm" onClick={load}>
            <IconRefresh size={15} /> Refresh
          </button>
        }
      >
        {list.status === "loading" && !list.rows.length && <Loading label="Loading coupons…" />}
        {list.status === "error" && <Failure error={list.error} text={explain(list.error)} onRetry={load} />}
        {list.status === "ready" && !list.rows.length && <Empty>No coupons yet. Create the first one above.</Empty>}

        {list.rows.length > 0 && (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Offer</th>
                  <th>Valid</th>
                  <th>For</th>
                  <th className="num">Used</th>
                  <th>Status</th>
                  <th className="num">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((c) => {
                  const st = STATUS[c.status] || STATUS.live;
                  return (
                    <tr key={c.code}>
                      <td>
                        <b className="dmono">{c.code}</b>
                        {c.note ? <small className="sub">{c.note}</small> : null}
                      </td>
                      <td>
                        {offerText(c)}
                        <small className="sub">
                          {rupees(selling)} → {rupees(c.sample)}
                        </small>
                      </td>
                      <td>
                        <small className="sub sub--on">{c.from ? `from ${fmtWhen(c.from)}` : "from creation"}</small>
                        <small className="sub sub--on">{c.to ? `to ${fmtWhen(c.to)}` : "no end"}</small>
                      </td>
                      <td>
                        {c.audience ? <span className="clip" title={c.audience}>{c.audience}</span> : "Everyone"}
                        <small className="sub">
                          {c.perUser ? `${c.perUser} per person` : "no per-person limit"}
                          {c.book ? ` · ${c.book}` : ""}
                        </small>
                      </td>
                      <td className="num">
                        <button type="button" className="lnk" onClick={() => showUses(c)} disabled={busy === `u${c.code}`}>
                          {fmtN(c.used)}
                          {c.maxUses ? ` / ${fmtN(c.maxUses)}` : ""}
                        </button>
                        {c.lastUsed ? <small className="sub">{fmtAgo(c.lastUsed)}</small> : null}
                      </td>
                      <td>
                        <Chip tone={st.tone}>{st.label}</Chip>
                      </td>
                      <td className="num">
                        <div className="acts">
                          <button type="button" className="ib" title="Edit" aria-label={`Edit ${c.code}`} onClick={() => edit(c)}>
                            <IconTag size={16} />
                          </button>
                          <button type="button" className="ib" title={c.active ? "Pause" : "Resume"} aria-label={`${c.active ? "Pause" : "Resume"} ${c.code}`} disabled={busy === c.code} onClick={() => toggle(c)}>
                            {c.active ? <IconPause size={16} /> : <IconPlay size={16} />}
                          </button>
                          <button type="button" className="ib" title="Copy an announcement" aria-label={`Copy announcement for ${c.code}`} onClick={() => copy(c)}>
                            <IconCopy size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {used && (
        <Card
          pad={false}
          title={`Uses of ${used.code}`}
          sub={`${used.rows.length} redemption${used.rows.length === 1 ? "" : "s"}`}
          action={
            <button
              type="button"
              className="db db--ghost db--sm"
              disabled={!used.rows.length}
              onClick={() =>
                download(
                  `redemptions-${used.code}.csv`,
                  toCsv(used.rows, [
                    { label: "When", key: "at" },
                    { label: "Reader", key: "email" },
                    { label: "Book", key: "book" },
                    { label: "List price", key: "list" },
                    { label: "Discount", key: "discount" },
                    { label: "Final price", key: "final" },
                    { label: "Reference", key: "reference" },
                  ])
                )
              }
            >
              <IconDownload size={15} /> CSV
            </button>
          }
        >
          {used.rows.length ? (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Reader</th>
                    <th className="num">Price</th>
                    <th className="num">Discount</th>
                    <th className="num">To pay</th>
                    <th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {used.rows.map((r) => (
                    <tr key={r.reference}>
                      <td>{fmtWhen(r.at)}</td>
                      <td>{r.email}</td>
                      <td className="num">{rupees(r.list)}</td>
                      <td className="num">−{rupees(r.discount)}</td>
                      <td className="num">
                        <b>{rupees(r.final)}</b>
                      </td>
                      <td className="dmono">{r.reference}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>Nobody has used this code yet.</Empty>
          )}
        </Card>
      )}
    </div>
  );
}
