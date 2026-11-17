// The playbook of the stock that is open on the Desk: what kind of day it is likely to be, what usually happens when,
// and for every situation that can arise a trigger, an action, a size, a stop and a way out — with where each one stands
// right now. The autopilot makes it every morning (server/autopilot.js); this only shows it.

import React from "react";
import { inr, isNum, pct } from "../analyzer/format";
import { ProposalList } from "./Proposals";
import "./autopilot.css";

const STATE = {
  waiting: { word: "Not yet", tone: "flat", tip: "Its time window has not opened (nothing before 9:30)." },
  armed: { word: "Armed", tone: "warn", tip: "Watching: the price has not reached the trigger." },
  breaking: { word: "Breaking", tone: "warn", tip: "Through the trigger, waiting for it to hold." },
  triggered: { word: "Fired", tone: "up", tip: "It held: a proposal was made (or refused with its reasons)." },
  late: { word: "Too late", tone: "down", tip: "The price ran past the trigger: no chasing." },
  invalid: { word: "Spoiled", tone: "down", tip: "The setup no longer works today." },
  expired: { word: "Over", tone: "flat", tip: "Past its last time for new entries." },
};

const CHIP = { "trending-up": "up", "trending-down": "down", squeeze: "warn", volatile: "warn", range: "flat" };

/** The strip's chip: the day's regime and how many scenarios are armed or fired. */
export function PlaybookChip({ pb, pressed, onShow }) {
  const d = pb.data;
  const has = d && d.available;
  const entries = has ? d.scenarios.filter((s) => s.kind === "entry") : [];
  const armed = entries.filter((s) => s.status && ["armed", "breaking"].includes(s.status.state)).length;
  const fired = (has ? d.proposals : []).filter((p) => p.status === "new").length;
  return (
    <button type="button" className="ab-mini-btn" onClick={onShow} aria-pressed={pressed} aria-label="Show the playbook for this stock" data-tip={has ? `${d.regime ? d.regime.word : "Playbook"}: ${entries.length} setups with triggers${armed ? `, ${armed} armed now` : ""}${fired ? `, ${fired} proposal${fired > 1 ? "s" : ""}` : ""}. Press for what happens when, and what to do.` : (d && d.reason) || "What kind of day, what happens when, what to do if."}>
      <span className={`ab-mini ab-mini--${has && d.regime ? CHIP[d.regime.kind] || "flat" : "flat"}`}>
        <small>Playbook</small>
        <b>{has ? (d.regime ? d.regime.word : "Ready") : pb.loading ? "…" : "—"}</b>
        <small>{has ? (fired ? `${fired} proposal${fired > 1 ? "s" : ""}` : armed ? `${armed} armed` : `${entries.length} setups`) : "if this, then that"}</small>
      </span>
    </button>
  );
}

function Scenario({ s }) {
  const st = s.status ? STATE[s.status.state] || STATE.waiting : null;
  return (
    <li className={`apx-sc apx-sc--${s.kind}`}>
      <div className="apx-sc__head">
        <b>{s.label}</b>
        {st && (
          <span className={`apx-badge is-${st.tone}`} data-tip={st.tip}>
            {st.word}
          </span>
        )}
        {s.learned && s.learned.paused && <span className="apx-badge is-down">Paused</span>}
      </div>
      {s.status && s.status.note && <p className="apx-dim">{s.status.note}</p>}
      {s.kind === "entry" && s.plan && (
        <p className="apx-sc__nums">
          Enter {inr(s.plan.entry)} · stop {inr(s.plan.stop)} · targets {inr(s.plan.targets[0])}, {inr(s.plan.targets[1])} · risk {inr(s.plan.riskPerShare)}/share ({pct(s.plan.riskPct, 1)}) · {s.plan.rewardToRisk}× · size ×{s.sizeFactor}
        </p>
      )}
      {s.kind === "entry" && !s.plan && <p className="apx-sc__nums">The levels are the 9:15–9:30 range: the plan is made when it is known · size ×{s.sizeFactor}</p>}
      {s.sizeNotes && s.sizeNotes.length > 0 && <p className="apx-dim">Size: {s.sizeNotes.join("; ")}.</p>}
      <p>{s.why}</p>
      {s.then && (
        <ul className="apx-then">
          {s.then.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}
      {s.measured && <p className="apx-dim">{s.measured}</p>}
      {s.learned && s.learned.n > 0 && (
        <p className="apx-dim">
          Autopilot's own record for this setup: {s.learned.n} proposals, {s.learned.winRate}% won, average {s.learned.avgR}R after costs.
        </p>
      )}
      {s.cancels && s.cancels.length > 0 && (
        <details>
          <summary>What cancels it</summary>
          <ul className="apx-then">
            {s.cancels.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

/** The whole playbook. */
export function PlaybookPane({ symbol, pb, onChanged }) {
  const d = pb.data;
  if (!d) return <p className={pb.error ? "adm-alert adm-alert--info" : "ab-dim"}>{pb.loading ? "Writing the playbook…" : pb.error || "The playbook is not available."}</p>;
  if (!d.available) return <p className="adm-alert adm-alert--info">{d.reason}</p>;
  const entries = d.scenarios.filter((s) => s.kind === "entry");
  const advice = d.scenarios.filter((s) => s.kind !== "entry");
  const sz = d.sizing;
  const today = d.events.today;
  return (
    <div className="apx" aria-label={`Playbook for ${symbol}`}>
      <div className="apx-top">
        <div className="apx-card">
          <small>The kind of day</small>
          <b>{d.regime ? d.regime.word : "Not enough history"}</b>
          {d.regime && (
            <span className="apx-dim">
              efficiency {d.regime.er} · average range {d.regime.atrPct}% (higher than {d.regime.atrRank}% of its last 120 days) · Bollinger width {d.regime.bbRank}th percentile
            </span>
          )}
          {d.regime && (
            <ul className="apx-then">
              {d.regime.doThis.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="apx-card">
          <small>The lean, and how reliable it has been</small>
          <b>
            {d.lean.call === "long-bias" ? "Leans up" : d.lean.call === "short-bias" ? "Leans down" : "No clear lean"} ({d.lean.score > 0 ? "+" : ""}
            {d.lean.score}, {d.lean.agreement}% agree)
          </b>
          <span>{d.lean.reliability || "The record of past outlooks is graded after each close; it is not ready yet."}</span>
        </div>
        {today && today.events.length > 0 && (
          <div className="apx-card apx-card--ev">
            <small>
              On this day{today.sizeFactor < 1 ? ` · size ×${today.sizeFactor}` : ""}
              {today.noOvernight ? " · no overnight positions" : ""}
              {today.avoidNew ? " · no new trades around the announcement" : ""}
            </small>
            <ul className="apx-then">
              {today.events.map((e) => (
                <li key={e.id}>
                  <b>{e.title}</b> — {e.advice}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {d.proposals.length > 0 && (
        <section className="apx-sec">
          <h4>Proposals today</h4>
          <ProposalList items={d.proposals} onChanged={onChanged} />
        </section>
      )}

      {sz && (
        <section className="apx-sec">
          <h4>If you took the lean's setup now</h4>
          <p className={sz.allowed ? "apx-ok" : "apx-no"}>
            <b>{sz.label}</b> — {sz.allowed ? `${sz.qty} shares, risking ${inr(sz.riskRs, 0)} (${sz.riskOfCapitalPct}% of capital), a position of ${inr(sz.valueRs, 0)} (${sz.capitalPct}%).` : "refused by the risk gate."}
          </p>
          <ul className="apx-reasons">
            {sz.reasons.map((r, i) => (
              <li key={i} className={`is-${r.level}`}>
                {r.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="apx-sec">
        <h4>If this happens, do that — the setups the autopilot is watching</h4>
        <ul className="apx-scs">{entries.map((s) => <Scenario key={s.id} s={s} />)}</ul>
      </section>

      <section className="apx-sec">
        <h4>Situations to be ready for</h4>
        <ul className="apx-scs">{advice.map((s) => <Scenario key={s.id} s={s} />)}</ul>
      </section>

      <section className="apx-sec">
        <h4>The day, window by window</h4>
        <div className="apx-scroll">
          <table className="apx-table">
            <thead>
              <tr>
                <th scope="col">When (IST)</th>
                <th scope="col">What usually happens</th>
                <th scope="col">What to do</th>
              </tr>
            </thead>
            <tbody>
              {d.script.map((w) => (
                <tr key={w.title}>
                  <th scope="row">
                    {w.title}
                    <small>
                      {w.from}–{w.to}
                    </small>
                  </th>
                  <td>{w.happens}</td>
                  <td>{w.do}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {d.events.upcoming.length > 0 && (
        <section className="apx-sec">
          <h4>Coming up for this stock</h4>
          <ul className="apx-then">
            {d.events.upcoming.slice(0, 8).map((e) => (
              <li key={e.id}>
                <b>{e.date}</b> ({e.daysAway === 0 ? "today" : `in ${e.daysAway} day${e.daysAway > 1 ? "s" : ""}`}) — {e.title}
                {e.impact === "high" ? " · high impact" : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="ab-foot">
        <summary>How this works</summary>
        <p className="ab-dim">{d.rule}</p>
        <p className="ab-dim">{d.watching ? "The autopilot is watching these triggers every 30 seconds from 9:30 to 2:45 PM." : "The autopilot's watch is not running on this server."}</p>
      </details>
    </div>
  );
}

export { isNum };
