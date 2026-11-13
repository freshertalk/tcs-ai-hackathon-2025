// The direction for one stock, as the research report shows it: one clear call, how sure the
// desk is, the plan in prices, and the lenses behind it — each with its evidence. A summary
// of evidence, not a forecast and not advice.

import React, { useEffect, useState } from "react";
import { api } from "../../api";
import { inr, num } from "../analyzer/format";

const TONE = { buy: "up", watch: "up-soft", "no-trade": "flat", caution: "down-soft", avoid: "down" };
const VIEW = { bullish: "▲", bearish: "▼", neutral: "■" };

export function DirectionCard({ d }) {
  const [open, setOpen] = useState(false);
  if (!d || !d.available) return null;
  return (
    <section className={`dir dir--${TONE[d.call] || "flat"}`} aria-label="Direction">
      <header className="dir__top">
        <span className="dir__call">{d.label}</span>
        <span className="dir__meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={d.confidence} aria-label={`Confidence ${d.confidence} out of 100`} data-tip="How firmly the evidence points one way: the weighted lenses, how many agree, less any risk that makes the stock hard to trade. Not a probability of profit.">
          <i style={{ width: `${d.confidence}%` }} />
        </span>
        <small>
          confidence {d.confidence} · {d.agreement}% of lenses agree
        </small>
      </header>
      <p className="dir__why">{d.why}</p>
      {d.plan && (
        <dl className="dir__plan">
          <div>
            <dt>Entry</dt>
            <dd>
              {inr(d.plan.entry)}
              <small>{d.plan.how}</small>
            </dd>
          </div>
          <div>
            <dt>Stop</dt>
            <dd className="is-down">{inr(d.plan.stop)}</dd>
          </div>
          <div>
            <dt>Targets</dt>
            <dd className="is-up">{d.plan.targets.map((t) => num(t)).join(" · ")}</dd>
          </div>
          <div>
            <dt>Reward : risk</dt>
            <dd>{d.plan.rewardToRisk}</dd>
          </div>
        </dl>
      )}
      {d.plan && <p className="dir__inv">Cancelled by {d.plan.invalidation.charAt(0).toLowerCase() + d.plan.invalidation.slice(1)}</p>}
      <ul className="dir__lenses">
        {d.lenses.map((l) => (
          <li key={l.id} className={`is-${l.available ? l.view : "na"}`}>
            <button type="button" aria-expanded={open === l.id} onClick={() => setOpen(open === l.id ? false : l.id)}>
              <span aria-hidden="true">{l.available ? VIEW[l.view] : "–"}</span>
              <b>{l.name}</b>
              <small>{l.available ? l.view : "n/a"}</small>
            </button>
            {open === l.id && (
              <ul className="dir__ev">
                {l.evidence.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {d.conflicts.length > 0 && (
        <p className="dir__conf">
          <b>Against it:</b> {d.conflicts.join(" ")}
        </p>
      )}
    </section>
  );
}

/** The automatic runs: before the open and after the close, with or without AI notes. */
export function AutoResearch({ canChange }) {
  const [s, setS] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api("/api/admin/research/auto")
      .then(setS)
      .catch((e) => setErr(e.message));
  }, []);
  const set = async (patch) => {
    setErr("");
    try {
      setS(await api("/api/admin/research/auto", { method: "PUT", body: patch }));
    } catch (e) {
      setErr(e.message);
    }
  };
  if (!s) return err ? <p className="vd-note">{err}</p> : null;
  return (
    <div className="dir-auto" role="group" aria-label="Automatic research">
      <label className="tr-check" data-tip={`Runs by itself on weekdays at ${s.times.pre} (pre-market) and ${s.times.post} IST (post-market) for the watchlist, while Zerodha is connected. The report is waiting when you open this page.`}>
        <input type="checkbox" checked={s.enabled} disabled={!canChange} onChange={(e) => set({ enabled: e.target.checked })} /> Automatic at {s.times.pre} and {s.times.post} IST
      </label>
      <label className="tr-check" data-tip="The automatic runs also check company news and world markets and have the AI write a note per stock. Uses your AI company's tokens twice a day.">
        <input type="checkbox" checked={s.withAi && s.aiConfigured} disabled={!canChange || !s.enabled || !s.aiConfigured} onChange={(e) => set({ withAi: e.target.checked })} /> with AI notes and news
      </label>
      {s.history[0] && (
        <small>
          last automatic run: {new Date(s.history[0].at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} ({s.history[0].phase}-market)
        </small>
      )}
      {err && <small className="is-bad">{err}</small>}
    </div>
  );
}
