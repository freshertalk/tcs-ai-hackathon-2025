// Everything a loan's papers say beyond its terms (28 Nov 2026): the rate type, charges, sanction and disbursement, the
// lender's latest figures, security and insurance. The same editable boxes in the review of an upload and on the saved loan;
// the list of details comes from the server (loan-details.js), so there is one list.
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../api";
import { SectionHead } from "../ux/PageKit";
import { DateField } from "../DatePicker";
import { dayName, rateText, rupees } from "./loanData";
import { URL_, useHidden } from "./shared";

export function showDetail(def, value) {
  if (value === "" || value === null || value === undefined) return "";
  if (!def) return String(value);
  if (def.type === "money") return rupees(Number(value));
  if (def.type === "percent") return rateText(Number(value));
  if (def.type === "date") return dayName(String(value));
  return String(value);
}

/** A box that grows with its words, so nothing in it is ever cut off. */
export function GrowText({ value, onChange, ...rest }) {
  const box = useRef(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const fit = () => {
      el.style.height = "auto";
      if (el.scrollHeight) el.style.height = `${el.scrollHeight + 2}px`;
    };
    fit();
    if (typeof ResizeObserver === "undefined") return undefined;
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth;
        fit();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [value]);
  return <textarea ref={box} rows={1} className="lo-grow" maxLength={300} value={value} onChange={onChange} {...rest} />;
}

/**
 * The boxes, group by group.
 * @param values { key: text }   @param shown which keys have a box   @param note (def) → what is said under a box
 */
export function DetailBoxes({ defs, groups, values, shown, onChange, note, idPrefix }) {
  return groups.map(([group, title]) => {
    const mine = defs.filter((d) => d.group === group && shown.has(d.key));
    if (!mine.length) return null;
    return (
      <fieldset key={group} className="lo-group">
        <legend>{title}</legend>
        <div className="lo-fields">
          {mine.map((d) => {
            const v = values[d.key] === undefined ? "" : values[d.key];
            const id = `${idPrefix}-${d.key}`;
            return (
              <div key={d.key} className="lo-field">
                {d.type === "date" ? (
                  <DateField label={d.label} value={v} onChange={(x) => onChange(d.key, x)} id={id} />
                ) : (
                  <>
                    <label htmlFor={id}>{d.label}</label>
                    {d.type === "text" ? <GrowText id={id} value={v} onChange={(e) => onChange(d.key, e.target.value)} /> : <input id={id} inputMode="decimal" value={v} onChange={(e) => onChange(d.key, e.target.value)} />}
                  </>
                )}
                {note ? note(d) : null}
              </div>
            );
          })}
        </div>
      </fieldset>
    );
  });
}

const SOURCE_OF = { typed: "typed by you", ai: "read by the free AI", scan: "read from a scan", schedule: "from the schedule", document: "from the document" };

/** A saved loan's details: read at a glance, changed when needed. */
export default function LoanDetails({ loan, data, onSaved }) {
  const h = useHidden();
  const defs = data.detailDefs || [];
  const groups = data.detailGroups || [];
  const had = loan.details || {};
  const have = defs.filter((d) => had[d.key]);
  const [edit, setEdit] = useState(null); // { key: text } while being changed
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  if (!defs.length) return null;

  const save = async (e) => {
    e.preventDefault();
    const changed = {};
    for (const d of defs) {
      const was = had[d.key] ? String(had[d.key].value) : "";
      if (edit[d.key] !== was) changed[d.key] = edit[d.key];
    }
    if (!Object.keys(changed).length) {
      setEdit(null);
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const out = await api(`${URL_}/${loan.id}/details`, { method: "PUT", body: { details: changed } });
      onSaved(out);
      if (alive.current) setEdit(null);
    } catch (x) {
      if (alive.current) setErr(x.message);
    }
    if (alive.current) setBusy(false);
  };

  return (
    <section className="lo-card" aria-label={`Details of ${loan.name}`}>
      <SectionHead
        title="Loan details"
        sub={have.length ? `${have.length} detail${have.length === 1 ? "" : "s"} kept: from your documents, or typed by you` : "Upload the sanction letter, agreement or a statement and these fill themselves"}
        actions={
          !edit && (
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setEdit(Object.fromEntries(defs.map((d) => [d.key, had[d.key] ? String(had[d.key].value) : ""])))}>
              {have.length ? "Edit details" : "Add details by hand"}
            </button>
          )
        }
      />
      {edit ? (
        <form onSubmit={save} className="lo-detailform" aria-label={`Edit the details of ${loan.name}`}>
          <DetailBoxes defs={defs} groups={groups} values={edit} shown={new Set(defs.map((d) => d.key))} onChange={(k, v) => setEdit((x) => ({ ...x, [k]: v }))} idPrefix={`lo-d-${loan.id}`} />
          <p className="lo-note">Empty a box to take that detail out.</p>
          {err && (
            <p className="lo-src is-warn" role="alert">
              {err}
            </p>
          )}
          <div className="lo-acts">
            <button type="submit" className="adm-btn adm-btn--solid adm-btn--sm" disabled={busy}>
              {busy ? "Saving…" : "Save the details"}
            </button>
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setEdit(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        groups.map(([group, title]) => {
          const mine = have.filter((d) => d.group === group);
          if (!mine.length) return null;
          return (
            <div key={group} className="lo-detailgroup">
              <h4>{title}</h4>
              <dl className="lo-details">
                {mine.map((d) => (
                  <div key={d.key}>
                    <dt>{d.label.replace(/ \(₹\)$/, "")}</dt>
                    <dd>
                      <b>{h(showDetail(d, had[d.key].value))}</b>
                      <small>
                        {SOURCE_OF[had[d.key].from] || had[d.key].from}
                        {had[d.key].file ? ` · ${had[d.key].file}` : ""}
                      </small>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })
      )}
    </section>
  );
}
