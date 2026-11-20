// The autopilot's page in the Research workspace: what it is doing, its order proposals, how good the research has been
// (graded on history and on its own proposals), the event calendar (with your own events), and your limits.
// It prepares, watches, proposes and grades by itself; it never sends an order.

import React, { useState } from "react";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { Alert } from "../../ui";
import { inr, when } from "../analyzer/format";
import { ProposalList, stateOf } from "./Proposals";
import { useAutopilotBoard } from "./useAutopilot";
import "./autopilot.css";

const KINDS = { results: "Company results", rbi: "RBI policy", fed: "US Fed", budget: "Budget", policy: "Policy / data release", other: "Other" };
const IMPACT = { high: "high", medium: "medium", low: "low" };
const FIELDS = [
  ["capital", "Trading capital (₹)", "The money the sizes are worked out from. Nothing is proposed until it is set.", 1000],
  ["riskPct", "Risk per trade (% of capital)", "What one stop-out costs: 0.5 means ₹5,000 on ₹10 lakh. Never above 2.", 0.05],
  ["maxPositionPct", "Largest position (% of capital)", "No single trade is bigger than this.", 1],
  ["maxSectorPct", "Largest sector (% of capital)", "Banks, IT and the rest are counted together.", 1],
  ["maxGrossPct", "Total exposure (% of capital)", "All open positions added up.", 1],
  ["minRR", "Smallest reward-to-risk", "The first target must pay at least this many times the risk.", 0.1],
  ["maxProposals", "Proposals a day", "A quota keeps the day selective.", 1],
];

function Settings({ board, onSaved }) {
  const s = board.settings;
  const [f, setF] = useState(() => ({ ...s, exclude: (s.exclude || []).join(", ") }));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg({ kind: "", text: "" });
    try {
      await api("/api/admin/autopilot/settings", { method: "PUT", body: { ...f, exclude: String(f.exclude || "").split(/[\s,]+/).filter(Boolean) } });
      setMsg({ kind: "ok", text: "Saved. Playbooks are made again with the new limits." });
      if (onSaved) onSaved();
    } catch (err) {
      setMsg({ kind: "error", text: err.message });
    }
    setBusy(false);
  };
  return (
    <form className="apx-form" onSubmit={save}>
      <label className="apx-switch">
        <input type="checkbox" checked={Boolean(f.on)} onChange={(e) => setF({ ...f, on: e.target.checked })} /> <b>Autopilot on</b> <span className="apx-dim">prepares from 8:45, watches 9:30–2:45, proposes and grades</span>
      </label>
      <label className="apx-switch">
        <input type="checkbox" checked={Boolean(f.notify)} onChange={(e) => setF({ ...f, notify: e.target.checked })} /> <b>Tell me on Telegram</b> <span className="apx-dim">when a proposal is made (the Telegram card on the AI page)</span>
      </label>
      <div className="apx-grid">
        {FIELDS.map(([k, label, hint, step]) => (
          <div key={k} className="apx-field">
            <label htmlFor={`ap-${k}`}>{label}</label>
            <input id={`ap-${k}`} type="number" step={step} min="0" value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
            <small>{hint}</small>
          </div>
        ))}
      </div>
      <div className="apx-field">
        <label htmlFor="ap-excl">Stocks never to propose</label>
        <input id="ap-excl" value={f.exclude} onChange={(e) => setF({ ...f, exclude: e.target.value })} placeholder="e.g. YESBANK, SUZLON" spellCheck="false" />
      </div>
      <Alert kind={msg.kind === "ok" ? "ok" : "error"}>{msg.text}</Alert>
      <div>
        <button className="adm-btn adm-btn--solid" disabled={busy}>
          {busy ? "Saving…" : "Save limits"}
        </button>
      </div>
    </form>
  );
}

function Events({ board, canEdit, onChanged }) {
  const [f, setF] = useState({ date: "", kind: "results", symbols: "", time: "", title: "", note: "" });
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [busy, setBusy] = useState(false);
  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg({ kind: "", text: "" });
    try {
      await api("/api/admin/autopilot/events", { method: "POST", body: f });
      setF({ date: "", kind: f.kind, symbols: "", time: "", title: "", note: "" });
      setMsg({ kind: "ok", text: "Added. Every playbook it affects is made again." });
      onChanged();
    } catch (err) {
      setMsg({ kind: "error", text: err.message });
    }
    setBusy(false);
  };
  const del = async (id) => {
    try {
      await api(`/api/admin/autopilot/events/${encodeURIComponent(id)}`, { method: "DELETE" });
      onChanged();
    } catch (err) {
      setMsg({ kind: "error", text: err.message });
    }
  };
  const mine = new Set((board.custom || []).map((c) => c.id));
  return (
    <div>
      <ul className="apx-evs">
        {board.events.slice(0, 40).map((e) => (
          <li key={e.id} className={`apx-ev is-${e.impact}`}>
            <div>
              <b>{e.date}</b> <span className="apx-dim">{e.daysAway === 0 ? "today" : `in ${e.daysAway} d`}</span> · {e.title}
              {e.scope && e.scope.symbols ? <span className="apx-dim"> · {e.scope.symbols.join(", ")}</span> : null}
              <span className={`apx-badge is-${e.impact === "high" ? "down" : e.impact === "medium" ? "warn" : "flat"}`}>{IMPACT[e.impact]}</span>
              {e.sizeFactor < 1 ? <span className="apx-dim"> · size ×{e.sizeFactor}</span> : null}
              {e.noOvernight ? <span className="apx-dim"> · no overnight</span> : null}
            </div>
            <p className="apx-dim">{e.advice}</p>
            {canEdit && mine.has(e.id) && (
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => del(e.id)}>
                Remove
              </button>
            )}
          </li>
        ))}
        {!board.events.length && <li className="ab-dim">Nothing is coming up in the next three weeks.</li>}
      </ul>
      {canEdit && (
        <form className="apx-form" onSubmit={add}>
          <h4>Add an event of your own</h4>
          <p className="apx-dim">Zerodha has no results calendar: when a company announces its date, enter it, and the playbook for that stock gets smaller, stays out of the announcement and does not hold overnight.</p>
          <div className="apx-grid">
            <div className="apx-field">
              <label htmlFor="ev-date">Date</label>
              <input id="ev-date" type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
            </div>
            <div className="apx-field">
              <label htmlFor="ev-kind">What</label>
              <select id="ev-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                {Object.entries(KINDS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="apx-field">
              <label htmlFor="ev-sym">Stocks (blank = the whole market)</label>
              <input id="ev-sym" value={f.symbols} onChange={(e) => setF({ ...f, symbols: e.target.value })} placeholder="SBIN, TCS" spellCheck="false" />
            </div>
            <div className="apx-field">
              <label htmlFor="ev-time">Time, IST (optional)</label>
              <input id="ev-time" type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />
            </div>
          </div>
          <div className="apx-field">
            <label htmlFor="ev-title">Title (optional)</label>
            <input id="ev-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={100} />
          </div>
          <div className="apx-field">
            <label htmlFor="ev-note">Note (optional)</label>
            <input id="ev-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={240} />
          </div>
          <Alert kind={msg.kind === "ok" ? "ok" : "error"}>{msg.text}</Alert>
          <div>
            <button className="adm-btn adm-btn--solid" disabled={busy}>
              {busy ? "Adding…" : "Add event"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function Scorecard({ board, canEdit, onChanged }) {
  const L = board.learned || {};
  const cal = board.calibration;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const study = async () => {
    setBusy(true);
    setErr("");
    try {
      await api("/api/admin/autopilot/recalibrate", { method: "POST", body: {} });
      onChanged();
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };
  const o = L.overall;
  return (
    <div className="apx-score">
      <h4>Its own proposals, graded on the minute bars (whether or not you took them)</h4>
      {o ? (
        <>
          <p>
            <b>{o.n}</b> graded · <b>{o.winRate}%</b> won · average <b>{o.avgR}R</b> after costs · total {o.totalR}R{o.profitFactor ? ` · profit factor ${o.profitFactor}` : ""} · {o.how.target} to target, {o.how.stop} to the stop, {o.how.time} out at the square-off.
          </p>
          <div className="apx-scroll">
            <table className="apx-table">
              <thead>
                <tr>
                  <th scope="col">Setup</th>
                  <th scope="col">Proposals</th>
                  <th scope="col">Won</th>
                  <th scope="col">Average R</th>
                  <th scope="col">Total R</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(L.byScenario).map(([id, s]) => (
                  <tr key={id}>
                    <th scope="row">{id}</th>
                    <td>{s.n}</td>
                    <td>{s.winRate}%</td>
                    <td className={s.avgR > 0 ? "is-up" : s.avgR < 0 ? "is-down" : ""}>{s.avgR}</td>
                    <td>{s.totalR}</td>
                    <td>{s.paused ? "Paused: its last proposals lost" : s.n >= 12 ? "Running" : "Too few to judge"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="ab-dim">Nothing graded yet. The first proposals are graded as soon as they reach their stop, their first target or the square-off.</p>
      )}

      <h4>The research itself, graded on a year of history</h4>
      {cal && cal.available ? (
        <>
          <p>
            {cal.overall.stocks} stocks, {cal.overall.n} past sessions ({cal.from} to {cal.to}). The outlook called a direction (lean ±22 or more) {cal.overall.called} times and was right <b>{cal.overall.hitPct}%</b> of them; any next session closes higher {cal.overall.baseUpPct}% of the time. Average move in the direction called: {cal.overall.avgCalledPct}%{cal.overall.t !== null ? ` (t = ${cal.overall.t})` : ""}.
          </p>
          <div className="apx-scroll">
            <table className="apx-table">
              <thead>
                <tr>
                  <th scope="col">When the lean was</th>
                  <th scope="col">Sessions</th>
                  <th scope="col">Next close higher</th>
                  <th scope="col">Average move</th>
                </tr>
              </thead>
              <tbody>
                {cal.buckets.map((b) => (
                  <tr key={b.id}>
                    <th scope="row">{b.label}</th>
                    <td>{b.n}</td>
                    <td>{b.upPct === null ? "—" : `${b.upPct}%`}</td>
                    <td className={b.avgPct > 0 ? "is-up" : b.avgPct < 0 ? "is-down" : ""}>{b.avgPct === null ? "—" : `${b.avgPct > 0 ? "+" : ""}${b.avgPct}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="apx-scroll">
            <table className="apx-table">
              <thead>
                <tr>
                  <th scope="col">Voice of the outlook</th>
                  <th scope="col">Active</th>
                  <th scope="col">Right</th>
                  <th scope="col">Average move with it</th>
                  <th scope="col">Verdict</th>
                  <th scope="col">Suggested weight</th>
                </tr>
              </thead>
              <tbody>
                {cal.voices.map((v) => (
                  <tr key={v.id}>
                    <th scope="row">{v.id}</th>
                    <td>{v.n}</td>
                    <td>{v.hitPct === null ? "—" : `${v.hitPct}%`}</td>
                    <td className={v.avgPct > 0 ? "is-up" : v.avgPct < 0 ? "is-down" : ""}>{v.avgPct === null ? "—" : `${v.avgPct > 0 ? "+" : ""}${v.avgPct}%`}</td>
                    <td>{v.verdict}</td>
                    <td>×{v.multiplier}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ab-dim">{cal.rule}</p>
          <p className="ab-dim">Graded {when(cal.at)}.</p>
        </>
      ) : (
        <p className="ab-dim">{cal && cal.reason ? cal.reason : "It is graded after the close each day, or press Study now."}</p>
      )}
      {canEdit && (
        <p>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={study} disabled={busy} data-tip="Grade the outlook on a year of history again and read the proposals' results now.">
            {busy ? "Studying…" : "Study now"}
          </button>
        </p>
      )}
      {err && <p className="adm-alert adm-alert--error">{err}</p>}
      {board.lessons && board.lessons.length > 0 && (
        <>
          <h4>Written into the file every AI feature reads</h4>
          <ul className="apx-then">
            {board.lessons.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const TABS = [
  ["proposals", "Proposals"],
  ["score", "Scorecard"],
  ["events", "Events"],
  ["limits", "Limits"],
];

export default function AutopilotPanel() {
  const { user } = useAuth();
  const owner = Boolean(user && user.role === "superadmin");
  const b = useAutopilotBoard();
  const [tab, setTab] = useState("proposals");
  const [open, setOpen] = useState(true);
  const d = b.data;
  if (!d) return <section className="an-card apx-panel">{b.error ? <Alert>{b.error}</Alert> : <p className="ab-dim">Loading the autopilot…</p>}</section>;
  const fresh = d.proposals.filter((p) => stateOf(p).id === "new");
  const waiting = d.proposals.filter((p) => ["new", "opened"].includes(stateOf(p).id));
  const rest = d.proposals.filter((p) => !["new", "opened"].includes(stateOf(p).id) && p.status !== "blocked");
  const refused = d.proposals.filter((p) => p.status === "blocked");
  return (
    <section className="an-card apx-panel" aria-label="Autopilot">
      <header className="apx-head">
        <div>
          <h3>Autopilot</h3>
          <p className="apx-dim">
            {d.on ? (d.watching ? `Watching ${d.universe.length} stock${d.universe.length === 1 ? "" : "s"}` : "Switched on, but not running on this server") : "Switched off"}
            {d.lastTick ? ` · last pass ${when(d.lastTick)}` : ""}
            {d.today.holiday ? ` · today is a market holiday (${d.today.holiday})` : !d.today.tradingDay ? " · the market is closed today" : ""}
            {!d.today.known ? " · this year's holiday list is not loaded: weekdays are assumed open" : ""}
          </p>
        </div>
        <div className="apx-head__r">
          {fresh.length > 0 && <span className="apx-badge is-up">{fresh.length} new proposal{fresh.length > 1 ? "s" : ""}</span>}
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Hide" : "Show"}
          </button>
        </div>
      </header>
      {d.error && <p className="adm-alert adm-alert--info">The last pass failed: {d.error}</p>}
      {open && (
        <>
          <p className="apx-intro">It prepares a playbook for every stock you follow before the open, watches the triggers all session, and when one fires and the risk gate allows it, makes an <b>order proposal</b>. You press Review and the order ticket opens ready-filled; it never sends an order itself. Every proposal is graded afterwards.</p>
          <div className="sv__ranges apx-tabs" role="group" aria-label="Autopilot sections">
            {TABS.filter(([id]) => owner || id === "events" || id === "score").map(([id, label]) => (
              <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>
                {label}
                {id === "proposals" && waiting.length ? ` (${waiting.length})` : ""}
              </button>
            ))}
          </div>
          {tab === "proposals" && owner && (
            <div>
              {!d.settings.capital && <p className="adm-alert adm-alert--info">Set your trading capital under Limits: until then every proposal is refused, because a safe size cannot be worked out.</p>}
              <h4>Waiting for you</h4>
              <ProposalList items={waiting} onChanged={b.reload} empty="No proposals right now. When a watched setup fires and passes the risk gate, it appears here and on Telegram." />
              {rest.length > 0 && (
                <>
                  <h4>Earlier</h4>
                  <ProposalList items={rest.slice(0, 15)} onChanged={b.reload} />
                </>
              )}
              {refused.length > 0 && (
                <details>
                  <summary>{refused.length} refused by the risk gate (with the reason)</summary>
                  <ProposalList items={refused.slice(0, 15)} onChanged={b.reload} />
                </details>
              )}
            </div>
          )}
          {tab === "score" && <Scorecard board={d} canEdit={owner} onChanged={b.reload} />}
          {tab === "events" && <Events board={d} canEdit={owner} onChanged={b.reload} />}
          {tab === "limits" && owner && <Settings board={d} onSaved={b.reload} />}
        </>
      )}
    </section>
  );
}

export { inr };
