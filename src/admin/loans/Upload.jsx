// Upload a loan's document and review what was found (28 Nov 2026) — nothing is saved until "Save to the loan book".
//
//   1. choose the file (a repayment schedule, sanction letter, statement, certificate… PDF, Excel, CSV, Word or a picture;
//      a locked PDF asks for its password)
//   2. the desk reads it by itself at once; NVIDIA's free AI then fills the gaps and lists the clauses (on by default;
//      identity numbers are blanked first). A picture goes to the AI only when asked: it cannot be blanked.
//   3. review: the schedule with its sums checked, each detail with where it came from, the loan it belongs to, and which
//      months are already paid
//   4. Save

import React, { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Alert } from "../ui";
import { DateField } from "../DatePicker";
import { bankLoans, dayName, rateText, rupees, shortMonth } from "./loanData";
import { URL_, useHidden } from "./shared";

export const ACCEPT = ".pdf,.xlsx,.xls,.csv,.tsv,.docx,.doc,.txt,image/png,image/jpeg,image/webp";
const MAX = 7 * 1024 * 1024;
const PICTURE_MAX = 130 * 1024; // the free vision models take small pictures

/** A picture made small enough for the free AI, kept as readable as that allows. */
export async function shrinkPicture(file, limit = PICTURE_MAX) {
  if (file.size <= limit || typeof createImageBitmap !== "function") return file;
  try {
    const bmp = await createImageBitmap(file);
    for (const [side, quality] of [[1600, 0.8], [1400, 0.75], [1200, 0.72], [1100, 0.65], [1000, 0.6], [850, 0.55], [700, 0.5]]) {
      const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(bmp.width * k));
      c.height = Math.max(1, Math.round(bmp.height * k));
      const g = c.getContext("2d");
      if (!g) return file;
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", quality));
      if (blob && blob.size <= limit) return new File([blob], `${file.name.replace(/\.\w+$/, "")}.jpg`, { type: "image/jpeg" });
    }
  } catch (_) {
    /* the original goes, and the AI says if it is too large */
  }
  return file;
}

/** Send the file's bytes. The password travels in a header, never in the address. */
export async function sendFile(file, { loanId = "", password = "", keep = false } = {}) {
  const res = await fetch(`${URL_}/documents/read?name=${encodeURIComponent(file.name)}${loanId ? `&loanId=${encodeURIComponent(loanId)}` : ""}${keep ? "&keep=1" : ""}`, { method: "POST", credentials: "same-origin", headers: { "X-Requested-With": "vpt", "Content-Type": "application/octet-stream", Accept: "application/json", ...(password ? { "X-Doc-Password": encodeURIComponent(password) } : {}) }, body: file });
  const d = await res.json().catch(() => null);
  if (!res.ok) {
    const e = new Error((d && d.message) || `The file could not be read (${res.status}).`);
    e.code = d && d.error;
    throw e;
  }
  return d;
}

const HOW = {
  lender: ["Principal and interest are the lender’s own", "good"],
  balance: ["Not split by the lender: worked out from its balance", "note"],
  computed: ["Not split by the lender: worked out from the loan amount and rate", "note"],
  "ai-columns": ["Columns named by the free AI, sums checked by the desk", "note"],
};
const SOURCE = { schedule: "from the schedule", document: "found in the document", suggested: "suggested name" };

function Source({ v }) {
  const h = useHidden();
  if (!v) return <small className="lo-src is-none">not found: type it</small>;
  if (v.from === "ai") {
    return (
      <small className={`lo-src ${v.checked === false ? "is-warn" : ""}`}>
        free AI{v.checked === true ? " · it is in the document" : v.checked === false ? " · not in the document: check it" : " · from the picture: check it"}
      </small>
    );
  }
  return (
    <small className="lo-src" data-tip={v.line ? h(v.line) : undefined}>
      {SOURCE[v.from] || v.from}
      {v.aiSays ? ` · the AI reads ${h(String(v.aiSays.value))}${v.aiSays.checked === false ? " (not in the document)" : ""}` : ""}
    </small>
  );
}

function ScheduleCard({ s, token, use, onUse, onHint, busy }) {
  const [all, setAll] = useState(false);
  const [hint, setHint] = useState({ amount: "", rate: "" });
  const h = useHidden();
  if (!s.found) return <p className="lo-note">No repayment schedule in this file{s.reason ? ` (${s.reason.replace(/\.$/, "")})` : ""}. Its details and clauses are kept with the loan.</p>;
  const [how, tone] = HOW[s.how] || HOW.lender;
  const c = s.checks;
  const shown = all || s.rows.length <= 9 ? s.rows : [...s.rows.slice(0, 6), null, ...s.rows.slice(-2)];
  return (
    <section className="lo-found" aria-label="Repayment schedule found">
      <header>
        <h4>
          Repayment schedule: {s.count} instalments, {dayName(s.first)} to {dayName(s.last)}
        </h4>
        <span className={`lo-chip is-${tone}`}>{how}</span>
      </header>
      {s.totals.principal !== null && (
        <p className="lo-found__totals">
          {h(`To be paid ${rupees(s.totals.emi)} = principal ${rupees(s.totals.principal)} + interest ${rupees(s.totals.interest)}`)}
          {s.rate !== null ? ` · ${rateText(s.rate)} a year` : ""}
        </p>
      )}
      <ul className="lo-checks" aria-label="Checks on the schedule">
        {c.split > 0 && <li className={c.addUp === c.split ? "is-ok" : "is-warn"}>EMI = principal + interest on {c.addUp} of {c.split} lines</li>}
        {c.carryOf > 0 && <li className={c.carry === c.carryOf ? "is-ok" : "is-warn"}>Balance carries on, line to line: {c.carry} of {c.carryOf}</li>}
        {c.split > 0 && <li className={c.cleared ? "is-ok" : "is-warn"}>{c.cleared ? "Runs down to zero" : "Does not run down to zero"}</li>}
      </ul>
      {s.warnings.length > 0 && (
        <ul className="lo-warns">
          {s.warnings.map((w) => (
            <li key={w}>{h(w)}</li>
          ))}
        </ul>
      )}
      {s.needs.length > 0 && (
        <form
          className="lo-need"
          onSubmit={(e) => {
            e.preventDefault();
            onHint(token, hint);
          }}
        >
          <p>This schedule shows only the instalments. Give the {s.needs.length === 2 ? "loan amount or the yearly rate (either will do)" : s.needs[0] === "amount" ? "loan amount" : "yearly rate"}, and the principal and interest are worked out.</p>
          <label className="lo-field">
            <span>Loan amount (₹)</span>
            <input inputMode="decimal" value={hint.amount} onChange={(e) => setHint({ ...hint, amount: e.target.value })} />
          </label>
          <label className="lo-field">
            <span>Interest rate (% a year)</span>
            <input inputMode="decimal" value={hint.rate} onChange={(e) => setHint({ ...hint, rate: e.target.value })} />
          </label>
          <button type="submit" className="adm-btn adm-btn--solid adm-btn--sm" disabled={busy || (!hint.amount && !hint.rate)}>
            Work it out
          </button>
        </form>
      )}
      <div className="lo-scroll">
        <table className="lo-preview-table">
          <caption className="adm-sr">The instalments as read</caption>
          <thead>
            <tr>
              <th scope="col">No.</th>
              <th scope="col">Date</th>
              <th scope="col" className="is-num">EMI</th>
              <th scope="col" className="is-num">Principal</th>
              <th scope="col" className="is-num">Interest</th>
              <th scope="col" className="is-num">Balance after</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) =>
              r ? (
                <tr key={`${r.no}-${r.date}`}>
                  <td>{r.no}</td>
                  <td>{dayName(r.date)}</td>
                  <td className="is-num">{rupees(r.emi)}</td>
                  <td className="is-num">{rupees(r.principal)}</td>
                  <td className="is-num">{rupees(r.interest)}</td>
                  <td className="is-num">{rupees(r.closing)}</td>
                </tr>
              ) : (
                <tr key={`gap-${i}`} className="lo-gap">
                  <td colSpan={6}>
                    <button type="button" className="lo-link" onClick={() => setAll(true)}>
                      Show all {s.rows.length} lines
                    </button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
      <label className="lo-check">
        <input type="checkbox" checked={use} disabled={s.needs.length > 0} onChange={(e) => onUse(e.target.checked)} />
        <span>
          <b>Use this schedule</b>: each month takes its EMI, principal and interest from it.
        </span>
      </label>
    </section>
  );
}

const FIELDS = [
  ["name", "Loan name", "text"],
  ["kind", "Type", "kind"],
  ["openingDate", "Opening date", "date"],
  ["totalAmount", "Total amount (₹)", "money"],
  ["rate", "Interest rate (% a year)", "money"],
  ["emiAmount", "EMI amount (₹)", "money"],
  ["firstEmiDate", "First EMI date", "date"],
];
const formFrom = (preview, old = {}) => {
  const out = {};
  for (const [k] of FIELDS) {
    const v = preview.values[k] ? String(preview.values[k].value) : "";
    // what you have typed stays; what you have not touched follows the newest reading
    out[k] = old.touched && old.touched[k] ? old[k] : v;
  }
  if (!out.kind) out.kind = "other";
  return { ...out, remarks: old.remarks || "", touched: old.touched || {} };
};

export default function Upload({ data, loanId = "", onClose, onSaved }) {
  const [preview, setPreview] = useState(null);
  const [file, setFile] = useState(null);
  const [password, setPassword] = useState("");
  const [needPassword, setNeedPassword] = useState(false);
  const [useAi, setUseAi] = useState(true);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [target, setTarget] = useState(loanId);
  const [form, setForm] = useState(null);
  const [use, setUse] = useState(true);
  const [upto, setUpto] = useState("");
  const [over, setOver] = useState(false);
  const ref = useRef(null);
  const alive = useRef(true);
  const token = useRef("");
  const h = useHidden();
  const ai = data.ai || { ready: false, setup: "" };
  useEffect(() => {
    alive.current = true;
    if (ref.current && ref.current.scrollIntoView) ref.current.scrollIntoView({ block: "nearest" });
    return () => {
      alive.current = false;
    };
  }, []);

  const take = (p, first = false) => {
    if (!alive.current) return;
    token.current = p.token;
    setPreview(p);
    setForm((old) => formFrom(p, first || !old ? {} : old));
    if (first) {
      setTarget(loanId || p.matchId || "");
      setUse(p.schedule.found && !p.schedule.needs.length);
      setUpto("");
    }
  };

  const askAi = async (t) => {
    setBusy("ai");
    try {
      const p = await api(`${URL_}/documents/${t}/ai`, { method: "POST" });
      take(p);
      if (p.schedule.found && !p.schedule.needs.length) setUse(true);
    } catch (e) {
      if (alive.current) setErr(e.message);
    }
    if (alive.current) setBusy("");
  };

  const read = async (chosen, pw = "", keep = false) => {
    setErr("");
    if (!chosen) return;
    if (chosen.size > MAX && !/^image\//.test(chosen.type)) {
      setErr("The file is larger than 7 MB. Upload a smaller one, or only the pages that matter.");
      return;
    }
    setFile(chosen);
    setBusy("read");
    try {
      const body = /^image\//.test(chosen.type) ? await shrinkPicture(chosen) : chosen;
      const p = await sendFile(body, { loanId: target, password: pw, keep });
      setNeedPassword(false);
      setPassword("");
      take(p, true);
      setBusy("");
      // the free AI follows by itself for a document's (blanked) words; a picture waits to be asked
      if (useAi && p.ai.ready && !p.ai.picture) askAi(p.token);
    } catch (e) {
      if (!alive.current) return;
      setBusy("");
      if (e.code === "password") setNeedPassword(true);
      setErr(e.message);
    }
  };

  const hint = async (t, values) => {
    setErr("");
    setBusy("hint");
    try {
      const p = await api(`${URL_}/documents/${t}/hint`, { method: "POST", body: values });
      take(p);
      setUse(p.schedule.found && !p.schedule.needs.length);
    } catch (e) {
      setErr(e.message);
    }
    setBusy("");
  };

  const close = () => {
    if (token.current) api(`${URL_}/documents/${token.current}`, { method: "DELETE" }).catch(() => {});
    token.current = "";
    onClose();
  };

  const save = async () => {
    setErr("");
    setBusy("save");
    try {
      const body = { loanId: target, useSchedule: use && preview.schedule.found, paidUpTo: upto };
      if (!target) {
        const { touched, ...fields } = form;
        void touched;
        body.loan = { ...fields, firstEmiDate: body.useSchedule ? preview.schedule.first : fields.firstEmiDate };
      }
      const d = await api(`${URL_}/documents/${preview.token}/apply`, { method: "POST", body });
      token.current = "";
      onSaved(d);
    } catch (e) {
      setErr(e.message);
      setBusy("");
    }
  };

  const set = (k) => (e) => {
    const v = e && e.target ? e.target.value : e;
    setForm((f) => ({ ...f, [k]: v, touched: { ...f.touched, [k]: true } }));
  };
  const banks = bankLoans(data);
  const loan = banks.find((l) => l.id === target);
  const s = preview ? preview.schedule : null;
  const nowMonth = data.today.slice(0, 7);
  const months = s && s.found && use ? [...new Set(s.rows.map((r) => r.date.slice(0, 7)))].filter((m) => m <= nowMonth) : [];
  const differs = loan && preview ? [["totalAmount", loan.totalAmount, rupees], ["rate", loan.rate, rateText], ["emiAmount", loan.emiAmount, rupees], ["openingDate", loan.openingDate, dayName]].filter(([k, mine]) => preview.values[k] && String(preview.values[k].value) !== String(mine)) : [];

  return (
    <section className="lo-card lo-upload" ref={ref} aria-label="Upload a loan document">
      <header className="lo-upload__head">
        <div>
          <h3>{preview ? "Check what was found, then save" : "Upload a loan document"}</h3>
          <p className="lo-note">{preview ? "Nothing is in your loan book yet. Save keeps the file too, to view or download any time." : "The repayment schedule (once for each loan), a sanction letter, agreement, statement, interest certificate or any loan paper. The details are read for you."}</p>
        </div>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={close} disabled={busy === "save"}>
          Close
        </button>
      </header>

      {!preview && (
        <>
          {banks.length > 0 && (
            <label className="lo-field">
              <span>For which loan?</span>
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Let the document say (a new loan, or the one it matches)</option>
                {banks.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label
            className={`lo-drop ${over ? "is-over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              read(e.dataTransfer.files && e.dataTransfer.files[0]);
            }}
          >
            <input
              type="file"
              accept={ACCEPT}
              aria-label="Choose the loan document"
              onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                e.target.value = "";
                setNeedPassword(false);
                read(f);
              }}
            />
            <b>{busy === "read" ? "Reading…" : "Choose a file, or drop it here"}</b>
            <span>PDF (also password-protected), Excel, CSV, Word, or a photo / screenshot · up to 7 MB</span>
          </label>
          {needPassword && file && (
            <form
              className="lo-need"
              onSubmit={(e) => {
                e.preventDefault();
                read(file, password);
              }}
            >
              <label className="lo-field">
                <span>Password of {file.name}</span>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
                <small>Used to open the file this once; it is not kept.</small>
              </label>
              <button type="submit" className="adm-btn adm-btn--solid adm-btn--sm" disabled={!password || Boolean(busy)}>
                Open
              </button>
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={Boolean(busy)} onClick={() => read(file, "", true)} data-tip="Save the file with the loan exactly as it is, without reading it. You can view or download it later.">
                Keep it without opening
              </button>
            </form>
          )}
          {ai.ready ? (
            <label className="lo-check">
              <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
              <span>
                <b>Also read it with NVIDIA’s free AI</b> ({ai.model}) — no paid AI is ever used here. The document’s words go to NVIDIA with account numbers, PAN, Aadhaar, phone, email and labelled names and addresses blanked; a name written elsewhere can remain.
              </span>
            </label>
          ) : (
            <p className="lo-note">
              The desk reads the file by itself. For the free AI too: {ai.setup} <a href="/me/ai">Open the AI page</a>.
            </p>
          )}
        </>
      )}

      {preview && form && (
        <>
          <p className="lo-filebar">
            <span className="lo-chip">{preview.docType.label}</span>
            <b>{preview.file.name}</b>
            <span className="lo-note">
              {preview.file.pages ? `${preview.file.pages} page${preview.file.pages === 1 ? "" : "s"}` : preview.file.kind}
              {preview.file.locked ? " · opened with your password" : ""}
              {preview.file.note ? ` · ${preview.file.note}` : ""}
            </span>
          </p>
          <div className="lo-ai" role="status">
            {busy === "ai" ? (
              <span>NVIDIA’s free AI is reading it… this can take a minute. What the desk read is below.</span>
            ) : preview.ai.done ? (
              <span>
                Also read by the free AI ({preview.ai.model}){preview.ai.blanked ? ` · ${preview.ai.blanked} identity items blanked before sending` : ""}.
              </span>
            ) : preview.ai.picture ? (
              <span>A picture has no text to take out: only the AI can read it. The whole picture goes to NVIDIA — nothing in it can be blanked.</span>
            ) : (
              <span>{preview.ai.error || "Read by the desk itself."}</span>
            )}
            {busy !== "ai" && !preview.ai.done && preview.ai.ready && (
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => askAi(preview.token)} disabled={Boolean(busy)}>
                {preview.ai.picture ? "Read the picture with free AI" : "Read with free AI"}
              </button>
            )}
            {!preview.ai.ready && preview.ai.picture && <a href="/me/ai">Add the free NVIDIA key on the AI page</a>}
          </div>
          {preview.summary && <p className="lo-summary">{h(preview.summary)}</p>}

          {preview.file.unread ? (
            <p className="lo-preview is-short" role="status">
              The file can be kept, but its details could not be read: {preview.file.unread.replace(`${preview.file.name}: `, "")} Choose its loan below (or type a new one), and save.
            </p>
          ) : (
            <ScheduleCard s={s} token={preview.token} use={use} onUse={setUse} onHint={hint} busy={Boolean(busy)} />
          )}

          <label className="lo-field">
            <span>Save it to</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">A new loan</option>
              {banks.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.id === preview.matchId ? " (looks like this one)" : ""}
                </option>
              ))}
            </select>
          </label>

          {!target ? (
            <div className="lo-fields">
              {FIELDS.map(([k, label, type]) => {
                const fromSchedule = k === "firstEmiDate" && use && s.found;
                return (
                  <label key={k} className="lo-field">
                    {type !== "date" && <span>{label}</span>}
                    {type === "kind" ? (
                      <select value={form.kind} onChange={set("kind")}>
                        {data.kinds.filter((x) => x.id !== "family").map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.label}
                          </option>
                        ))}
                      </select>
                    ) : type === "date" ? (
                      <DateField label={label} value={fromSchedule ? s.first : form[k]} onChange={set(k)} disabled={fromSchedule} id={`lo-up-${k}`} />
                    ) : (
                      <input inputMode={type === "money" ? "decimal" : undefined} value={form[k]} onChange={set(k)} />
                    )}
                    <Source v={preview.values[k]} />
                  </label>
                );
              })}
              <label className="lo-field lo-field--wide">
                <span>Remarks</span>
                <input value={form.remarks} onChange={set("remarks")} maxLength={500} />
              </label>
            </div>
          ) : (
            <div className="lo-existing">
              <p>
                The file is kept with <b>{loan ? loan.name : "the loan"}</b>
                {use && s.found ? ", and its months take the schedule’s figures (ticks and remarks stay)." : "."}
              </p>
              {differs.length > 0 && (
                <ul className="lo-warns">
                  {differs.map(([k, mine, fmt]) => (
                    <li key={k}>
                      {preview.values[k].label}: the document says {h(String(fmt(preview.values[k].value)))}, the book has {h(String(fmt(mine)))}. {use && s.found && k !== "openingDate" ? "The schedule’s figure is used." : "The book is not changed; edit the loan if the document is right."}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {months.length > 0 && (
            <label className="lo-field">
              <span>EMIs already paid</span>
              <select value={upto} onChange={(e) => setUpto(e.target.value)}>
                <option value="">Do not tick any (I will tick them myself)</option>
                {[...months].reverse().map((m) => (
                  <option key={m} value={m}>
                    Tick every EMI up to {shortMonth(m)} as paid
                  </option>
                ))}
              </select>
              <small>Only what you have really paid: an unticked EMI past its date shows as overdue.</small>
            </label>
          )}

          {(preview.terms.length > 0 || preview.watch.length > 0) && (
            <details className="lo-terms">
              <summary>
                <b>Clauses and charges found</b> ({preview.terms.length})
              </summary>
              {preview.watch.length > 0 && (
                <ul className="lo-warns">
                  {preview.watch.map((w) => (
                    <li key={w}>{h(w)}</li>
                  ))}
                </ul>
              )}
              <ul>
                {preview.terms.map((t, i) => (
                  <li key={i}>
                    <b>{t.title}</b>
                    {t.detail ? <span>{h(t.detail)}</span> : null}
                    <q>{h(t.quote)}</q>
                    {t.from === "ai" && <small className={`lo-src ${t.checked ? "" : "is-warn"}`}>{t.checked ? "found by the free AI · the words are in the document" : "from the free AI · these exact words are not in the document"}</small>}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="lo-acts">
            <button type="button" className="adm-btn adm-btn--solid" onClick={save} disabled={Boolean(busy) && busy !== "ai"}>
              {busy === "save" ? "Saving…" : "Save to the loan book"}
            </button>
            <button type="button" className="adm-btn adm-btn--ghost" onClick={close} disabled={busy === "save"}>
              Discard
            </button>
          </div>
        </>
      )}
      <Alert>{err}</Alert>
    </section>
  );
}
