// The parts of an upload's review (28 Nov 2026): the list of documents with what each gave, where each figure came from
// (and what the other documents say), the repayment schedule with its checks, and which months are already paid.
import React, { useState } from "react";
import { dayName, rateText, rupees, shortMonth } from "./loanData";
import { useHidden } from "./shared";

const HOW = {
  lender: ["Principal and interest are the lender’s own", "good"],
  balance: ["Not split by the lender: worked out from its balance", "note"],
  computed: ["Not split by the lender: worked out from the loan amount and rate", "note"],
  "ai-columns": ["Columns named by the free AI, sums checked by the desk", "note"],
};
const SOURCE = { schedule: "from the schedule", document: "found in the document", suggested: "suggested name", scan: "read from a scan by the free AI: check it" };

const shownCore = (k, v) => (k === "totalAmount" || k === "emiAmount" ? rupees(Number(v)) : k === "rate" ? rateText(Number(v)) : /Date$/.test(k) ? dayName(String(v)) : String(v));

/** Under a box: where its value came from, and what the other documents say, to be picked instead. */
export function Source({ v, name, many, show = shownCore, onUse }) {
  const h = useHidden();
  if (!v) return <small className="lo-src is-none">not found: type it</small>;
  const file = many && v.file ? ` · ${v.file}` : "";
  const first =
    v.from === "ai" ? (
      <small className={`lo-src ${v.checked === false ? "is-warn" : ""}`}>
        free AI{v.checked === true ? " · it is in the document" : v.checked === false ? " · not in the document: check it" : " · from the picture: check it"}
        {file}
      </small>
    ) : (
      <small className={`lo-src ${v.from === "scan" ? "is-warn" : ""}`} data-tip={v.line ? h(v.line) : undefined}>
        {SOURCE[v.from] || v.from}
        {file}
        {v.agree > 1 ? ` · ${v.agree} documents agree` : ""}
        {v.aiSays ? ` · the AI reads ${h(String(v.aiSays.value))}${v.aiSays.checked === false ? " (not in the document)" : ""}` : ""}
      </small>
    );
  return (
    <>
      {first}
      {(v.others || []).map((o) => (
        <span key={`${o.file}-${o.value}`} className="lo-other">
          <small>
            {o.file} says {h(show(name, o.value))}
          </small>
          {onUse && (
            <button type="button" className="lo-link" onClick={() => onUse(name, String(o.value))} aria-label={`Use ${o.value} from ${o.file}`}>
              Use this
            </button>
          )}
        </span>
      ))}
    </>
  );
}

export function ScheduleCard({ s, use, onUse, onHint, busy }) {
  const [all, setAll] = useState(false);
  const [hint, setHint] = useState({ amount: "", rate: "" });
  const h = useHidden();
  if (!s.found) return <p className="lo-note">No repayment schedule in these documents{s.reason ? ` (${s.reason.replace(/\.$/, "")})` : ""}. Their details and clauses are kept with the loan.</p>;
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
            onHint(s.token, hint);
          }}
        >
          <p>This schedule shows only the instalments. Give the {s.needs.length === 2 ? "loan amount or the yearly rate (either will do)" : s.needs[0] === "amount" ? "loan amount" : "yearly rate"}, and the principal and interest are worked out. A sanction letter or agreement uploaded with it says them too.</p>
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

const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** What one document has given, in a few words. */
function gave(info) {
  if (!info) return "";
  const parts = [];
  if (info.file.unread) parts.push(info.scan.pages.some((p) => p.ok) ? "a scan: its pages are read by the free AI" : "kept as it is, not read");
  else {
    const n = Object.keys(info.values).filter((k) => k !== "name").length;
    parts.push(`${n} detail${n === 1 ? "" : "s"} found`);
  }
  if (info.schedule.found) parts.push(`schedule of ${info.schedule.count}`);
  const pictured = info.scan.pages.filter((p) => p.ok).length;
  if (pictured) parts.push(`${info.scan.read.length} of ${pictured} scanned page${pictured === 1 ? "" : "s"} read`);
  if (info.ai.done) parts.push("read by the free AI");
  if (info.file.locked) parts.push("opened with your password");
  return parts.join(" · ");
}

/** The pages of a scan that cannot be turned into pictures here, and why. */
const cannot = (info) => {
  const bad = info ? info.scan.pages.filter((p) => !p.ok) : [];
  return bad.length ? `${bad.length === 1 ? `Page ${bad[0].page} is` : `${bad.length} pages are`} not read (${bad[0].why}). Upload screenshots of ${bad.length === 1 ? "it" : "them"} to have ${bad.length === 1 ? "it" : "them"} read.` : "";
};

/** Every chosen file, what is happening to it, and what it gave. */
export function FileList({ files, infos, onInclude, onRemove, onPassword, onKeep, busy }) {
  const h = useHidden();
  const [passwords, setPasswords] = useState({});
  return (
    <ul className="lo-files" aria-label="Documents chosen">
      {files.map((f) => {
        const info = f.token ? infos[f.token] : null;
        return (
          <li key={f.id} className={f.include ? "" : "is-out"}>
            <div className="lo-files__main">
              <p>
                {info ? <span className="lo-chip">{info.docType.label}</span> : null}
                <b>{f.name}</b>
                <small>
                  {size(f.size)}
                  {info && info.file.pages ? ` · ${info.file.pages} page${info.file.pages === 1 ? "" : "s"}` : ""}
                </small>
              </p>
              <small className={`lo-src ${f.status === "error" || f.status === "password" ? "is-warn" : ""}`} role="status">
                {f.status === "waiting" ? "Waiting its turn" : f.status === "reading" ? "Reading…" : f.status === "error" || f.status === "password" ? f.error : gave(info)}
                {f.doing ? ` · ${f.doing}` : ""}
              </small>
              {info && info.file.unread && !info.scan.pages.some((p) => p.ok) && <small className="lo-src">{info.file.unread.replace(`${info.file.name}: `, "")}</small>}
              {cannot(info) && <small className="lo-src is-warn">{cannot(info)}</small>}
              {info && info.ai.error && <small className="lo-src is-warn">{h(info.ai.error)}</small>}
              {f.status === "password" && (
                <form
                  className="lo-need"
                  onSubmit={(e) => {
                    e.preventDefault();
                    onPassword(f, passwords[f.id] || "");
                    setPasswords((x) => ({ ...x, [f.id]: "" }));
                  }}
                >
                  <label className="lo-field">
                    <span>Password of {f.name}</span>
                    <input type="password" value={passwords[f.id] || ""} onChange={(e) => setPasswords((x) => ({ ...x, [f.id]: e.target.value }))} autoComplete="off" />
                    <small>Used to open the file this once; it is not kept.</small>
                  </label>
                  <button type="submit" className="adm-btn adm-btn--solid adm-btn--sm" disabled={!passwords[f.id]}>
                    Open
                  </button>
                  <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => onKeep(f)} data-tip="Save the file with the loan exactly as it is, without reading it. You can view or download it later.">
                    Keep it without opening
                  </button>
                </form>
              )}
            </div>
            <span className="lo-files__acts">
              {info && files.length > 1 && (
                <label className="lo-check">
                  <input type="checkbox" checked={f.include} onChange={(e) => onInclude(f, e.target.checked)} aria-label={`Save ${f.name} with this loan`} />
                  <span>Part of this loan</span>
                </label>
              )}
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => onRemove(f)} disabled={busy || f.status === "reading"} aria-label={`Take ${f.name} off the list`}>
                Take off
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Which EMIs are ticked paid on saving: those a statement shows, up to a month, or none. */
export function PaidChoice({ paid, months, value, onChange, check }) {
  const h = useHidden();
  if (!paid.months.length && !months.length) return null;
  const span = paid.months.length ? `${shortMonth(paid.months[0])} to ${shortMonth(paid.months[paid.months.length - 1])}` : "";
  return (
    <div className="lo-paid">
      <label className="lo-field">
        <span>EMIs already paid</span>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Tick none for now</option>
          {paid.months.length > 0 && (
            <option value="statement">
              {paid.how === "lines" ? `${paid.months.length} seen in the statement` : `First ${paid.months.length} EMIs`}
            </option>
          )}
          {[...months].reverse().map((m) => (
            <option key={m} value={m}>
              All up to {shortMonth(m)}
            </option>
          ))}
        </select>
        <small>Only what you have really paid: an unticked EMI past its date shows as overdue.</small>
      </label>
      {value === "statement" && paid.how === "count" && <p className="lo-note">{`The statement says ${paid.months.length} EMIs are paid (${span}); it does not list them. Check them against your bank account.`}</p>}
      {value === "statement" && paid.how === "lines" && (
        <p className="lo-note">
          Ticks the {paid.months.length} months shown as received between {span}, from the payments listed in {paid.file}
          {paid.bounced ? `. ${paid.bounced} that bounced or ${paid.bounced === 1 ? "was" : "were"} returned ${paid.bounced === 1 ? "is" : "are"} left unticked` : ""}. Check them against your bank account.
        </p>
      )}
      {check && (
        <p className={`lo-preview ${check.ok ? "" : "is-short"}`} role="status">
          {h(check.text)}
        </p>
      )}
    </div>
  );
}
