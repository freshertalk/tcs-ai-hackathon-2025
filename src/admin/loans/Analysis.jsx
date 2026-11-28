// Analysis: where the money goes (principal and interest), by April–March year, what prepaying would change, and — on a
// press, with NVIDIA's free AI only — a plain-English reading of the figures and answers to questions about them.
import React, { useMemo, useState } from "react";
import { Alert } from "../ui";
import { SectionHead } from "../ux/PageKit";
import { bankLoans, byYear, prepayRank, rupees, rateText, shortMonth, simulate } from "./loanData";
import { SplitBar, URL_, useHidden, when } from "./shared";

function Where({ data }) {
  const t = data.totals;
  const open = bankLoans(data).filter((l) => !l.summary.closed);
  const ranked = useMemo(() => prepayRank(data), [data]);
  const money = (x) => rupees(x, false);
  return (
    <section className="lo-card">
      <SectionHead title="Principal and interest" sub="Principal is what you borrowed; interest is its price" />
      <div className="lo-two">
        <div>
          <h4>Still to pay</h4>
          <SplitBar principal={t.bankOutstanding} interest={t.interestRemaining} label="Still to pay on EMI loans" format={money} />
        </div>
        <div>
          <h4>Paid so far, as ticked</h4>
          {t.paidPrincipal + t.paidInterest > 0 ? <SplitBar principal={t.paidPrincipal} interest={t.paidInterest} label="Paid so far" format={money} /> : <p className="lo-note">Nothing ticked paid yet.</p>}
        </div>
      </div>
      {open.length > 0 && (
        <div className="lo-scroll">
          <table className="lo-plain">
            <caption className="adm-sr">Each loan’s principal and interest still to pay</caption>
            <thead>
              <tr>
                <th scope="col">Loan</th>
                <th scope="col" className="is-num">Rate</th>
                <th scope="col" className="is-num">Principal left</th>
                <th scope="col" className="is-num">Interest left</th>
                <th scope="col" className="is-num">Interest in every ₹100 left</th>
                <th scope="col" className="is-num">If ₹1 lakh is prepaid now</th>
              </tr>
            </thead>
            <tbody>
              {[...ranked.map((r) => r.loan), ...open.filter((l) => !ranked.some((r) => r.loan.id === l.id))].map((l) => {
                const s = l.summary;
                const r = ranked.find((x) => x.loan.id === l.id);
                return (
                  <tr key={l.id}>
                    <th scope="row">{l.name}</th>
                    <td data-label="Rate" className="is-num">{rateText(l.rate)}</td>
                    <td data-label="Principal left" className="is-num">{rupees(s.outstanding)}</td>
                    <td data-label="Interest left" className="is-num">{rupees(s.interestRemaining)}</td>
                    <td data-label="Interest in every ₹100 left" className="is-num">{s.totalToPay > 0 ? Math.round((s.interestRemaining / s.totalToPay) * 100) : "—"}</td>
                    <td data-label="If ₹1 lakh is prepaid now" className="is-num">
                      {r ? (
                        <>
                          saves about {rupees(r.saved, false)}
                          <small>
                            {r.sooner} month{r.sooner === 1 ? "" : "s"} sooner
                          </small>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="lo-note">Loans are listed with the one where each prepaid rupee saves the most interest first. Estimates on a reducing balance, before any prepayment charge — check your lender’s terms. A calculation, not advice.</p>
    </section>
  );
}

function Years({ data }) {
  const years = useMemo(() => byYear(data.loans), [data]);
  if (!years.length) return null;
  const nowFy = byYear([{ type: "bank", summary: { split: true }, rows: [{ month: data.today.slice(0, 7) }], upcoming: [] }])[0].fy;
  return (
    <section className="lo-card">
      <SectionHead title="By financial year (April to March)" sub="All instalments of the year, past and to come, and the part you have ticked paid" />
      <div className="lo-scroll">
        <table className="lo-plain">
          <caption className="adm-sr">Principal and interest by financial year</caption>
          <thead>
            <tr>
              <th scope="col">Year</th>
              <th scope="col" className="is-num">Principal</th>
              <th scope="col" className="is-num">Interest</th>
              <th scope="col" className="is-num">Principal paid</th>
              <th scope="col" className="is-num">Interest paid</th>
            </tr>
          </thead>
          <tbody>
            {years.map((y) => (
              <tr key={y.fy} className={y.fy === nowFy ? "is-now" : ""}>
                <th scope="row">
                  FY {y.fy}
                  {y.fy === nowFy ? <small> this year</small> : null}
                </th>
                <td data-label="Principal" className="is-num">{rupees(y.principal)}</td>
                <td data-label="Interest" className="is-num">{rupees(y.interest)}</td>
                <td data-label="Principal paid" className="is-num">{rupees(y.paidPrincipal)}</td>
                <td data-label="Interest paid" className="is-num">{rupees(y.paidInterest)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="lo-note">Only the months in this book (months before a schedule or the first EMI kept here are not counted). For tax, use the lender’s interest certificate.</p>
    </section>
  );
}

function WhatIf({ data }) {
  const open = bankLoans(data).filter((l) => !l.summary.closed && l.rate >= 0);
  const [id, setId] = useState("");
  const [lump, setLump] = useState("100000");
  const [extra, setExtra] = useState("");
  const [mode, setMode] = useState("tenure");
  const h = useHidden();
  if (!open.length) return null;
  const l = open.find((x) => x.id === id) || open[0];
  const n = (v) => Math.max(0, Number(String(v).replace(/[₹,\s]/g, "")) || 0);
  const now = simulate(l.summary.outstanding, l.rate, l.emiAmount);
  const then = simulate(l.summary.outstanding, l.rate, l.emiAmount, { lump: Math.min(n(lump), l.summary.outstanding), extra: mode === "tenure" ? n(extra) : 0, mode });
  return (
    <section className="lo-card" aria-label="What if I prepay">
      <SectionHead title="What if I prepay?" sub="Try a sum now, or a little extra every month. Nothing is saved." />
      <div className="lo-fields">
        <label className="lo-field">
          <span>Loan</span>
          <select value={l.id} onChange={(e) => setId(e.target.value)}>
            {open.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="lo-field">
          <span>Pay now, once (₹)</span>
          <input inputMode="decimal" value={lump} onChange={(e) => setLump(e.target.value)} />
        </label>
        <label className="lo-field">
          <span>After that</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="tenure">Keep the EMI: finish sooner</option>
            <option value="emi">Keep the months: smaller EMI</option>
          </select>
        </label>
        {mode === "tenure" && (
          <label className="lo-field">
            <span>Extra every month (₹)</span>
            <input inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="none" />
          </label>
        )}
      </div>
      {now && then ? (
        <dl className="lo-strip lo-strip--dl">
          <div>
            <dt>Interest saved</dt>
            <dd className="is-up">{rupees(Math.max(0, now.interest - then.interest), false)}</dd>
            <span>
              {rupees(now.interest, false)} → {rupees(then.interest, false)}
            </span>
          </div>
          <div>
            <dt>Months left</dt>
            <dd>{then.months}</dd>
            <span>
              instead of {now.months}
              {now.months > then.months ? ` (${now.months - then.months} sooner)` : ""}
            </span>
          </div>
          <div>
            <dt>EMI after</dt>
            <dd>{rupees(then.emi)}</dd>
            <span>{h(mode === "tenure" && n(extra) > 0 ? `plus ${rupees(n(extra), false)} extra each month` : `now ${rupees(l.emiAmount)}`)}</span>
          </div>
        </dl>
      ) : (
        <p className="lo-note">At {rateText(l.rate)} the EMI does not cover the interest, so this cannot be worked out.</p>
      )}
      <p className="lo-note">An estimate on a reducing balance from what is owed today ({h(rupees(l.summary.outstanding))}), before any prepayment charge. After a real part-payment, enter it on the month (“Change”) or upload the lender’s new schedule.</p>
    </section>
  );
}

function FreeAi({ data, send }) {
  const [scope, setScope] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const h = useHidden();
  const ai = data.ai || { ready: false };
  const kept = scope ? data.insight.byLoan[scope] : data.insight.book;
  const asked = data.insight.asked.filter((a) => (scope ? a.loanId === scope : true)).slice(0, 5);
  const run = async (what, url, body) => {
    setBusy(what);
    setErr("");
    try {
      await send(url, { method: "POST", body });
      if (what === "ask") setQ("");
    } catch (e) {
      setErr(e.message);
    }
    setBusy("");
  };
  return (
    <section className="lo-card" aria-label="Free AI analysis">
      <SectionHead title="AI analysis (NVIDIA, free)" sub={ai.ready ? `${ai.model} · runs only when you press · no paid AI is ever used for your loans` : "Needs your free NVIDIA key"} />
      {!ai.ready ? (
        <p className="lo-note">
          {ai.setup} <a href="/me/ai">Open the AI page</a>
        </p>
      ) : (
        <>
          <div className="lo-airow">
            <label className="lo-field">
              <span>About</span>
              <select value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="">All my loans</option>
                {data.loans.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" disabled={Boolean(busy)} onClick={() => run("insights", `${URL_}/ai/insights`, { loanId: scope })}>
              {busy === "insights" ? "The free AI is reading… (up to a minute or two)" : kept ? "Analyse again" : "Analyse with free AI"}
            </button>
          </div>
          {kept && (
            <div className="lo-insight">
              <p>{h(kept.summary)}</p>
              <ul>
                {kept.points.map((x, i) => (
                  <li key={i}>
                    <b>{h(x.title)}</b>
                    <span>{h(x.detail)}</span>
                  </li>
                ))}
              </ul>
              {kept.questions.length > 0 && (
                <>
                  <h4>Worth asking the lender</h4>
                  <ul className="lo-questions">
                    {kept.questions.map((x) => (
                      <li key={x}>{h(x)}</li>
                    ))}
                  </ul>
                </>
              )}
              <p className="lo-note">
                Written {when(kept.at)} by {kept.model} from the figures as they were then. An AI can be wrong: check against the figures on this page. Information, not financial or tax advice.
              </p>
            </div>
          )}
          <form
            className="lo-ask"
            onSubmit={(e) => {
              e.preventDefault();
              run("ask", `${URL_}/ai/ask`, { loanId: scope, question: q });
            }}
          >
            <label className="lo-field">
              <span>Ask about {scope ? "this loan and its documents" : "your loans"}</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={600} placeholder={scope ? "e.g. Is there a charge if I close it early?" : "e.g. How much interest will I still pay?"} />
            </label>
            <button type="submit" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={Boolean(busy) || q.trim().length < 4}>
              {busy === "ask" ? "Asking…" : "Ask"}
            </button>
          </form>
          {asked.length > 0 && (
            <ul className="lo-answers" aria-label="Questions and answers">
              {asked.map((a) => (
                <li key={a.at}>
                  <b>{h(a.question)}</b>
                  <p>{h(a.answer)}</p>
                  {a.quotes.map((x) => (
                    <q key={x}>{h(x)}</q>
                  ))}
                  <small className="lo-note">
                    {when(a.at)} · {a.model}
                    {a.found ? "" : " · the book and documents do not say"}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <Alert>{err}</Alert>
    </section>
  );
}

export default function Analysis({ data, send }) {
  const ends = bankLoans(data).filter((l) => !l.summary.closed && l.summary.endMonth);
  return (
    <>
      <Where data={data} />
      <Years data={data} />
      <WhatIf data={data} />
      <FreeAi data={data} send={send} />
      {ends.length > 1 && (
        <p className="lo-note">
          Last EMIs: {ends.sort((a, b) => (a.summary.endMonth < b.summary.endMonth ? -1 : 1)).map((l) => `${l.name} ${shortMonth(l.summary.endMonth)}`).join(" · ")}
        </p>
      )}
    </>
  );
}
