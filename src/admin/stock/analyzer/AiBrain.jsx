// AI Brain: the two buttons on the Desk — "AI Live" (the next 15–30 minutes of the open stock) and
// "AI Research" (the next trading session) — and, beside them, the Intraday plan for the next session
// (IntradayPlan.jsx: arithmetic only), which is what the card shows first while the market is shut.
//
// Underneath, the desk's own arithmetic (the Live Pulse and the Next-Session Outlook) is ALWAYS shown
// and kept fresh by itself: it needs no AI and no key. A press of a button brings in the analysts —
// the free NVIDIA-hosted models, and one optional paid lead that does the web search — which read the
// same numbers in parallel; the result is weighed with the desk's arithmetic, so if every model fails
// the page simply keeps the arithmetic. Nothing here runs an AI by itself: only the button does.
// Nothing here can place an order.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { inr, isNum, num } from "./format";
import IntradayPlan, { KIND, useIntradayPlan } from "./IntradayPlan";
import OptionChain, { biasTone, useOptionChain } from "./OptionChain";
import "./brain.css";

const enc = encodeURIComponent;
const WORD = { long: "LONG", short: "SHORT", wait: "WAIT", "long-bias": "LEANS UP", "short-bias": "LEANS DOWN", neutral: "NO CLEAR LEAN" };
const toneOf = (call, lean) => (call === "long" || call === "long-bias" ? "up" : call === "short" || call === "short-bias" ? "down" : lean === "up" ? "up-soft" : lean === "down" ? "down-soft" : "flat");
const BIAS = { up: "Up", down: "Down", sideways: "Sideways" };
const ago = (iso) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const tok = (u) => (u ? (u.inputTokens + u.outputTokens).toLocaleString("en-IN") : "0");

/** One AI run for one stock: start it, follow it, and keep the last finished one for next time. */
function useRun(kind, symbol, enabled = true) {
  const [job, setJob] = useState(null);
  const [last, setLast] = useState(null);
  const [err, setErr] = useState("");
  const timer = useRef(null);
  useEffect(() => {
    let alive = true;
    setJob(null);
    setLast(null);
    setErr("");
    if (enabled)
      api(`/api/admin/ai/ensemble/${kind}/${enc(symbol)}`)
        .then((d) => alive && setLast(d.last))
        .catch(() => {});
    return () => {
      alive = false;
      clearTimeout(timer.current);
    };
  }, [kind, symbol, enabled]);
  const poll = useCallback((id) => {
    api(`/api/admin/ai/ensemble/job/${id}`)
      .then((j) => {
        setJob(j);
        if (!j.finishedAt) timer.current = setTimeout(() => poll(id), 1200);
        else if (j.result) setLast(j.result);
      })
      .catch((e) => setErr(e.message));
  }, []);
  const start = useCallback(async () => {
    setErr("");
    clearTimeout(timer.current);
    try {
      const j = await api(`/api/admin/ai/ensemble/${kind}/${enc(symbol)}`, { method: "POST" });
      setJob(j);
      timer.current = setTimeout(() => poll(j.id), 700);
    } catch (e) {
      setErr(e.message);
    }
  }, [kind, symbol, poll]);
  return { job, last, err, start, running: Boolean(job && !job.finishedAt) };
}

/** The desk's arithmetic for this stock, kept fresh without any AI. */
function useFloor(kind, symbol, active, enabled = true) {
  const [d, setD] = useState({ loading: true, data: null, error: "" });
  useEffect(() => {
    let alive = true;
    setD({ loading: enabled, data: null, error: "" });
    if (!enabled) return undefined;
    const read = () =>
      api(`/api/admin/ai/${kind === "live" ? "pulse" : "outlook"}/${enc(symbol)}`)
        .then((x) => alive && setD({ loading: false, data: x, error: "" }))
        .catch((e) => alive && setD((p) => ({ loading: false, data: p.data, error: e.message })));
    read();
    // the live window moves every few minutes; the next-session outlook only when the day's bars change
    const id = setInterval(() => active && document.visibilityState !== "hidden" && read(), kind === "live" ? 20000 : 300000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [kind, symbol, active, enabled]);
  return d;
}

function ScoreBar({ score, label }) {
  const at = Math.max(0, Math.min(100, (score + 100) / 2));
  return (
    <div className="ab-score" role="img" aria-label={`${label}: ${score > 0 ? "+" : ""}${score} on a scale from −100 (down) to +100 (up)`}>
      <span className="ab-score__zone ab-score__zone--down" />
      <span className="ab-score__zone ab-score__zone--mid" />
      <span className="ab-score__zone ab-score__zone--up" />
      <i style={{ left: `${at}%` }} />
      <small className="ab-score__l">DOWN</small>
      <small className="ab-score__r">UP</small>
    </div>
  );
}

function Plan({ side, p, called, sizing }) {
  if (!p) return null;
  const rejected = p.checkStatus === "rejected";
  return (
    <div className={`ab-plan ab-plan--${side} ${called ? "is-called" : ""} ${rejected ? "is-rejected" : ""}`}>
      <header>
        <b>{side === "long" ? "Long" : "Short"}</b>
        {called && <em>called</em>}
        {rejected && <em className="is-bad" data-tip={(p.checks || []).filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join(" · ")}>fails checks</em>}
        {p.source && <small>{p.source === "consensus" ? `median of ${p.n + 1} reads` : "desk’s arithmetic"}</small>}
      </header>
      <dl>
        <div>
          <dt>{p.trigger ? "Trigger" : "Entry"}</dt>
          <dd>{inr(p.entry)}</dd>
        </div>
        <div>
          <dt>Stop</dt>
          <dd className="is-down">{inr(p.stop)}</dd>
        </div>
        <div>
          <dt>Target 1 · 2</dt>
          <dd className="is-up">
            {inr((p.targets || [])[0])} · {inr((p.targets || [])[1])}
          </dd>
        </div>
        <div>
          <dt>Risk / share</dt>
          <dd>
            {inr(p.riskPerShare)} <small>({num(p.riskPct, 2)}%)</small>
          </dd>
        </div>
        {sizing && (
          <div className="ab-plan__wide">
            <dt>Size by your risk</dt>
            <dd>
              {num(sizing.qty, 0)} shares <small>(risk ₹{num(sizing.riskRs, 0)} at {sizing.riskPct}% of available cash)</small>
            </dd>
          </div>
        )}
      </dl>
      {p.trigger && <p className="ab-plan__note">{p.trigger}</p>}
    </div>
  );
}

function Evidence({ items }) {
  if (!items || !items.length) return null;
  return (
    <ul className="ab-ev">
      {items.map((c) => (
        <li key={c.id}>
          <span className="ab-ev__name" data-tip={`Weight ${c.weight}`}>
            {c.label}
          </span>
          <span className="ab-ev__bar" aria-hidden="true">
            <i className={c.vote >= 0 ? "is-up" : "is-down"} style={{ width: `${Math.abs(c.vote) * 50}%`, [c.vote >= 0 ? "left" : "right"]: "50%" }} />
          </span>
          <span className="ab-ev__why">{c.why}</span>
        </li>
      ))}
    </ul>
  );
}

function Analysts({ rows, running }) {
  const [open, setOpen] = useState(null);
  if (!rows || !rows.length) return null;
  return (
    <div className="ab-an">
      <h5>
        Analysts <small>{rows.filter((r) => r.status === "answered").length} of {rows.length} answered</small>
      </h5>
      <ul>
        {rows.map((r) => (
          <li key={r.id} className={`is-${r.status}`}>
            <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id} disabled={r.status !== "answered" && r.status !== "failed"}>
              <span className="ab-an__name">
                {r.name}
                <small>
                  {r.company}
                  {r.free ? " · free" : r.lead ? " · paid, with web search" : ""}
                </small>
              </span>
              {r.status === "answered" ? (
                <span className={`ab-chip ab-chip--${r.bias}`}>
                  {BIAS[r.bias]} · {r.confidence}
                </span>
              ) : r.status === "failed" ? (
                <span className="ab-chip ab-chip--bad" data-tip={r.error}>
                  no answer
                </span>
              ) : (
                <span className="ab-chip ab-chip--wait">{running ? "reading…" : "waiting"}</span>
              )}
              <span className="ab-an__ms">{r.ms ? `${(r.ms / 1000).toFixed(0)} s` : ""}</span>
            </button>
            {open === r.id && (
              <div className="ab-an__more">
                {r.status === "failed" ? (
                  <p>{r.error}</p>
                ) : (
                  <>
                    <p>{r.summary}</p>
                    {isNum(r.low) && isNum(r.high) && (
                      <p className="ab-dim">
                        Expects {inr(r.low)} – {inr(r.high)}.
                      </p>
                    )}
                    {r.reasons && r.reasons.length > 0 && (
                      <ul>
                        {r.reasons.map((x) => (
                          <li key={x}>{x}</li>
                        ))}
                      </ul>
                    )}
                    {r.risks && r.risks.length > 0 && (
                      <p className="ab-dim">
                        <b>Risks:</b> {r.risks.join(" · ")}
                      </p>
                    )}
                    {r.change && r.change.length > 0 && (
                      <p className="ab-dim">
                        <b>Would change its mind:</b> {r.change.join(" · ")}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Steps({ steps }) {
  if (!steps || !steps.length) return null;
  return (
    <ol className="ab-steps">
      {steps.map((s) => (
        <li key={s.id} className={`is-${s.status}`}>
          <i aria-hidden="true" />
          <span>
            {s.label}
            {s.note && <small> — {s.note}</small>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Pane({ kind, floor, run, symbol }) {
  const det = floor.data && floor.data.available ? floor.data : null;
  const r = (run.job && run.job.result) || run.last;
  const final = r && r.final ? r.final : null;
  const base = (run.job && run.job.det) || det;
  const live = kind === "live";
  const stale = r && live && Date.now() - Date.parse(r.at) > 30 * 60000;
  const shown = final || (det ? { call: det.call, lean: det.lean, score: det.score, agreement: det.agreement, headline: det.headline, gates: det.gates, plans: det.plans, mode: "engine-only", expected: live ? { low: det.window.low, high: det.window.high } : { low: det.range.low, high: det.range.high } } : null);
  const you = det && det.you ? det.you : null;
  if (!det && floor.loading && !run.job) return <p className="ab-dim">Reading the numbers…</p>;
  return (
    <div className="ab-pane">
      {!det && !run.job && <p className="adm-alert adm-alert--info">{(floor.data && floor.data.reason) || floor.error || "Not available right now."}</p>}
      {run.err && <p className="adm-alert adm-alert--error">{run.err}</p>}
      {run.job && run.job.error && <p className="adm-alert adm-alert--error">{run.job.error}</p>}
      {run.job && !run.job.finishedAt && <Steps steps={run.job.steps} />}
      {shown && (
        <>
          <div className={`ab-call ab-call--${toneOf(shown.call, shown.lean)}`}>
            <div className="ab-call__main">
              <span className="ab-call__word">{WORD[shown.call] || shown.call}</span>
              <span className="ab-call__head">{shown.headline}</span>
            </div>
            <ScoreBar score={shown.score} label="Weighted lean" />
            <div className="ab-call__meta">
              <span data-tip="How much of the weight sits on the winning side. Agreement is not a probability of profit.">
                <b>{shown.agreement}%</b> agree
              </span>
              <span>
                lean <b>{shown.score > 0 ? "+" : ""}{shown.score}</b>
              </span>
              <span className={`ab-src ${final && final.mode === "ensemble" ? "is-ai" : ""}`}>
                {final && final.mode === "ensemble" ? `Engine + ${r.analysts.filter((a) => a.status === "answered").length} AI analysts` : "Desk’s own arithmetic — no AI"}
              </span>
              {r && <span className={`ab-dim ${stale ? "is-warn" : ""}`}>AI run {ago(r.at)}{stale ? " — a while ago; run again" : ""}</span>}
            </div>
          </div>
          {shown.gates && shown.gates.length > 0 && (
            <ul className="ab-gates">
              {shown.gates.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          )}
          {final && final.notes && final.notes.length > 0 && (
            <ul className="ab-notes">
              {final.notes.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          )}
          {you && you.hasPosition && (
            <p className={`ab-you ab-you--${you.advice}`}>
              <b>
                You hold {you.side} {you.quantity} {symbol} @ {inr(you.average)}
              </b>{" "}
              · P&amp;L <span className={you.pnl >= 0 ? "is-up" : "is-down"}>{inr(you.pnl)}</span> · {you.why}
            </p>
          )}
          <div className="ab-grid">
            <div className="ab-plans">
              <Plan side="long" p={shown.plans && shown.plans.long} called={shown.call === "long" || shown.call === "long-bias"} sizing={live && you && you.sizing && shown.call === "long" ? you.sizing : null} />
              <Plan side="short" p={shown.plans && shown.plans.short} called={shown.call === "short" || shown.call === "short-bias"} sizing={live && you && you.sizing && shown.call === "short" ? you.sizing : null} />
              <p className="ab-dim ab-plans__note">Both sides are always shown. A short in the cash market is intraday-only and must be bought back before the 3:15 PM square-off. Open the order ticket to trade — nothing here places an order.</p>
            </div>
            <div className="ab-side">
              {shown.expected && isNum(shown.expected.low) && (
                <p className="ab-window">
                  <span>{live ? "Next 30 minutes" : "Next session"} — range to expect</span>
                  <b>
                    {inr(shown.expected.low)} – {inr(shown.expected.high)}
                  </b>
                  <small>{live ? det && det.window && det.window.basis : det && det.range && det.range.basis}</small>
                </p>
              )}
              {!live && det && det.pivots && (
                <p className="ab-pivots">
                  <span>Pivots</span> S3 {num(det.pivots.s3, 2)} · S2 {num(det.pivots.s2, 2)} · S1 {num(det.pivots.s1, 2)} · <b>P {num(det.pivots.p, 2)}</b> · R1 {num(det.pivots.r1, 2)} · R2 {num(det.pivots.r2, 2)} · R3 {num(det.pivots.r3, 2)}
                </p>
              )}
              {!live && det && det.gap && <p className="ab-dim">{det.gap.note}</p>}
              {!live && det && det.scenarios && (
                <ul className="ab-scen">
                  {det.scenarios.map((s) => (
                    <li key={s.if}>
                      <b>If</b> {s.if} <b>then</b> {s.then}
                    </li>
                  ))}
                </ul>
              )}
              {final && final.dissent && final.dissent.length > 0 && (
                <p className="ab-dim">
                  <b>Disagree:</b> {final.dissent.join(", ")}
                </p>
              )}
            </div>
          </div>
        </>
      )}
      {(run.job && run.job.analysts && run.job.analysts.length > 0) || (r && r.analysts) ? <Analysts rows={run.job && run.job.analysts && run.job.analysts.length ? run.job.analysts : r.analysts} running={run.running} /> : null}
      {base && base.components && (
        <details className="ab-why">
          <summary>
            The desk’s arithmetic — {base.components.length} pieces of evidence <small>(works without AI)</small>
          </summary>
          <Evidence items={base.components} />
          <p className="ab-dim">{base.rule}</p>
        </details>
      )}
      {r && (
        <details className="ab-foot">
          <summary>
            Tokens used: free models {tok(r.usage && r.usage.free)} · paid {tok(r.usage && r.usage.paid)}
            {r.web && r.web.used ? " · web research by the paid model" : ""} <small>— about this read</small>
          </summary>
          <p>{r.disclaimer}</p>
        </details>
      )}
    </div>
  );
}

/** Which analysts run, how the paid lead is used, and how each has done so far. */
function Settings({ onClose }) {
  const [s, setS] = useState(null);
  const [err, setErr] = useState("");
  const load = () =>
    api("/api/admin/ai/ensemble/status")
      .then(setS)
      .catch((e) => setErr(e.message));
  useEffect(() => {
    load();
  }, []);
  const save = (patch) =>
    api("/api/admin/ai/ensemble/settings", { method: "PUT", body: patch })
      .then((d) => setS((x) => ({ ...x, ...d })))
      .catch((e) => setErr(e.message));
  if (!s) return <div className="ab-set">{err ? <p className="adm-alert adm-alert--error">{err}</p> : <p className="ab-dim">Loading…</p>}</div>;
  const set = s.settings;
  const picked = set.freeModels || s.catalogue.map((a) => a.id);
  const toggle = (id) => {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    save({ freeModels: next.length === s.catalogue.length ? null : next });
  };
  return (
    <div className="ab-set">
      <header>
        <b>Who reads the numbers</b>
        <button type="button" className="ab-x" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      {err && <p className="adm-alert adm-alert--error">{err}</p>}
      <label className="ab-chk">
        <input type="checkbox" checked={set.useFree} onChange={(e) => save({ useFree: e.target.checked })} /> The free NVIDIA-hosted models
      </label>
      <ul className="ab-set__list">
        {s.catalogue.map((a) => (
          <li key={a.id}>
            <label className="ab-chk" data-tip={a.ready ? "" : "Save the NVIDIA key on the AI page to use this one."}>
              <input type="checkbox" disabled={!set.useFree || !a.ready} checked={a.ready && picked.includes(a.id)} onChange={() => toggle(a.id)} /> {a.name} <small>{a.company}{a.ready ? "" : " · no key"}</small>
            </label>
          </li>
        ))}
      </ul>
      <label className="ab-chk" data-tip="The paid model does the web search (company news, world markets) and analyses like the others. It is used only when you press a button, and its search is kept 30 minutes.">
        <input type="checkbox" checked={set.usePaid} disabled={!s.roster.lead && !set.usePaid} onChange={(e) => save({ usePaid: e.target.checked })} /> The paid model with web search{" "}
        <small>{s.roster.lead ? `${s.roster.lead.name} (${s.roster.lead.company}) — chosen on the AI page` : "no paid key saved"}</small>
      </label>
      <div className="ab-set__nums">
        <label>
          <span>Paid runs a day, at most</span>
          <input type="number" min="0" max="500" value={set.paidDailyCap} onChange={(e) => save({ paidDailyCap: Number(e.target.value) })} />
        </label>
        <label>
          <span>Wait for each model (seconds)</span>
          <input type="number" min="20" max="180" value={set.deadlineSec} onChange={(e) => save({ deadlineSec: Number(e.target.value) })} />
        </label>
      </div>
      <p className="ab-dim">Paid runs today: {s.paidRunsToday}. Free models cost nothing. Nothing runs until you press AI Live or AI Research.</p>
      {s.record && s.record.rows.length > 0 && (
        <>
          <h5>Track record — scored against real prices</h5>
          <div className="ab-rec">
            <table className="an-table">
              <thead>
                <tr>
                  <th scope="col">Analyst</th>
                  <th scope="col" className="is-num">Right</th>
                  <th scope="col" className="is-num">Wrong</th>
                  <th scope="col" className="is-num">Flat</th>
                  <th scope="col" className="is-num">Accuracy</th>
                  <th scope="col" className="is-num">Weight</th>
                </tr>
              </thead>
              <tbody>
                {s.record.rows.map((r) => (
                  <tr key={r.id}>
                    <th scope="row">{r.name}</th>
                    <td className="is-num">{r.right}</td>
                    <td className="is-num">{r.wrong}</td>
                    <td className="is-num">{r.flat}</td>
                    <td className="is-num">{r.accuracyPct === null ? "—" : `${r.accuracyPct}%`}</td>
                    <td className="is-num">{r.counted ? r.weight : "1 (too few)"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ab-dim">
            A live call is scored against the price 30 minutes later, a next-session call against that session’s close. An analyst’s say in the weighing rises or falls with its own record once it
            has {s.record.minDecided} decided calls — until then every analyst counts the same. A flat outcome counts neither way.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * @param only  "research": just AI Research (inside the Research workspace's stock cards)
 */
export default function AiBrain({ symbol, live, marketHours, only = null }) {
  const wantLive = only !== "research";
  const wantIntra = only === null;
  const first = () => only || (live && marketHours ? "live" : wantIntra ? "intraday" : "research");
  const [view, setView] = useState(first);
  const [settings, setSettings] = useState(false);
  const liveRun = useRun("live", symbol, wantLive);
  const resRun = useRun("research", symbol);
  const liveFloor = useFloor("live", symbol, Boolean(live && marketHours), wantLive);
  const resFloor = useFloor("research", symbol, true);
  const intra = useIntradayPlan(symbol, wantIntra);
  const chain = useOptionChain(symbol, wantIntra);
  const hasChain = Boolean(chain.data && chain.data.available);
  useEffect(() => {
    setView(first());
  }, [symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  const press = (kind) => {
    setView(kind);
    (kind === "live" ? liveRun : resRun).start();
  };
  const liveOk = liveFloor.data && liveFloor.data.available;
  const chip = (floor, run, kind) => {
    const r = (run.job && run.job.result) || run.last;
    const f = r && r.final;
    const d = floor.data && floor.data.available ? floor.data : null;
    const s = f || d;
    if (!s) return null;
    return (
      <span className={`ab-mini ab-mini--${toneOf(s.call, s.lean)}`}>
        <small>{kind === "live" ? "Next 30 min" : "Next session"}</small>
        <b>{WORD[s.call] || s.call}</b>
        <small>{s.agreement}%</small>
      </span>
    );
  };

  return (
    <section className="ab" aria-label="AI Live and AI Research">
      <div className="ab-bar">
        <div className="ab-btns" role="group" aria-label="Run the AI">
          {wantLive && <button type="button" className={`ab-btn ab-btn--live ${view === "live" ? "is-on" : ""}`} onClick={() => press("live")} disabled={liveRun.running || !live} data-tip={live ? (liveOk ? "Ask every analyst to read this stock's live numbers now: the next 15–30 minutes." : "The live session is not available (market closed or no data yet) — AI Live needs a trading market.") : "AI Live needs the Zerodha connection and the market open."}>
            <span className="ab-btn__t">{liveRun.running ? "AI Live · reading…" : "AI Live"}</span>
            <small>next 15–30 min</small>
          </button>}
          <button type="button" className={`ab-btn ab-btn--res ${view === "research" ? "is-on" : ""}`} onClick={() => press("research")} disabled={resRun.running} data-tip="Ask every analyst to prepare this stock for the next trading session, from the earlier data.">
            <span className="ab-btn__t">{resRun.running ? "AI Research · reading…" : "AI Research"}</span>
            <small>next trading day</small>
          </button>
        </div>
        <div className="ab-minis">
          {wantLive && (
            <button type="button" className="ab-mini-btn" onClick={() => setView("live")} aria-pressed={view === "live"} aria-label="Show the live read">
              {chip(liveFloor, liveRun, "live") || <span className="ab-mini ab-mini--flat"><small>Next 30 min</small><b>—</b></span>}
            </button>
          )}
          <button type="button" className="ab-mini-btn" onClick={() => setView("research")} aria-pressed={view === "research"} aria-label="Show the next-session read">
            {chip(resFloor, resRun, "research") || <span className="ab-mini ab-mini--flat"><small>Next session</small><b>—</b></span>}
          </button>
          {wantIntra && (
            <button type="button" className="ab-mini-btn" onClick={() => setView("intraday")} aria-pressed={view === "intraday"} aria-label="Show the intraday plan for the next session">
              {intra.data && intra.data.available ? (
                <span className={`ab-mini ab-mini--${{ up: "up", down: "down" }[(KIND[intra.data.decision.kind] || KIND.wait).tone] || "flat"}`}>
                  <small>Intraday plan</small>
                  <b>{(KIND[intra.data.decision.kind] || KIND.wait).word}</b>
                  <small>{intra.data.decision.strength != null ? `strength ${intra.data.decision.strength}` : intra.data.decision.kind === "avoid" ? "skip it" : "no trade"}</small>
                </span>
              ) : (
                <span className="ab-mini ab-mini--flat">
                  <small>Intraday plan</small>
                  <b>{intra.loading ? "…" : "—"}</b>
                </span>
              )}
            </button>
          )}
          {wantIntra && hasChain && (
            <button type="button" className="ab-mini-btn" onClick={() => setView("options")} aria-pressed={view === "options"} aria-label="Show the option chain">
              <span className={`ab-mini ab-mini--${biasTone(chain.data.bias.score)}`}>
                <small>Options</small>
                <b>{chain.data.bias.label.toUpperCase()}</b>
                <small>PCR {chain.data.pcr ?? "—"}</small>
              </span>
            </button>
          )}
        </div>
        <button type="button" className="ab-gear" onClick={() => setSettings((v) => !v)} aria-expanded={settings} aria-label="Choose the analysts" data-tip="Which analysts run, the paid lead, limits and the track record.">
          ⚙
        </button>
      </div>
      {settings && <Settings onClose={() => setSettings(false)} />}
      {view === "options" && wantIntra ? (
        <OptionChain symbol={symbol} data={chain.data} />
      ) : view === "intraday" && wantIntra ? (
        intra.data ? (
          <IntradayPlan symbol={symbol} data={intra.data} />
        ) : (
          <p className={intra.error ? "adm-alert adm-alert--info" : "ab-dim"}>{intra.loading ? "Building the intraday plan…" : intra.error || "The intraday plan is not available."}</p>
        )
      ) : view === "live" ? (
        <Pane kind="live" floor={liveFloor} run={liveRun} symbol={symbol} />
      ) : (
        <Pane kind="research" floor={resFloor} run={resRun} symbol={symbol} />
      )}
    </section>
  );
}

