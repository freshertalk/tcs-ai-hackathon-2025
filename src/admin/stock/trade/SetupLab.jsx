// The set-up lab on the Research tab: every classic intraday set-up measured on the NIFTY 100's recent
// sessions after costs (server/setuplab.js), and the desk's knowledge base (server/market/knowledge.js)
// that describes them. What has paid here weighs each set-up in the live scanner; what has lost argues
// against it. A record of the past, not a promise.

import React, { useEffect, useState } from "react";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { everyVisible } from "../../visible";
import { when } from "../analyzer/format";
import "./scanner.css";
import { KnowledgeBase } from "../engine/KnowledgeBase";

const sg = (x) => (typeof x === "number" ? `${x > 0 ? "+" : ""}${x}R` : "—");

export function SetupLab() {
  const { user } = useAuth();
  const owner = Boolean(user && user.role === "superadmin");
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [kb, setKb] = useState(false);
  const running = Boolean(d && d.lab && d.lab.running);

  useEffect(() => {
    let alive = true;
    const read = () =>
      api("/api/admin/setups")
        .then((x) => alive && (setD(x), setErr("")))
        .catch((e) => alive && setErr(e.message));
    read();
    // while a run is going its progress is followed; otherwise the record changes once a day
    const stop = everyVisible(read, running ? 3000 : 5 * 60000);
    return () => {
      alive = false;
      stop();
    };
  }, [running]);

  const runNow = async () => {
    setErr("");
    try {
      const r = await api("/api/admin/setups/run", { method: "POST" });
      setD((x) => ({ ...(x || {}), lab: r.lab }));
    } catch (e) {
      setErr(e.message);
    }
  };

  const lab = d && d.lab;
  const rows = lab && lab.available && lab.summary ? lab.summary.rows : [];
  const job = lab && lab.job;
  return (
    <section className="an-card sx sx-lab" aria-label="Set-ups measured on this desk">
      <header className="sx-head">
        <div className="sx-head__title">
          <h3 className="sx-title">Set-ups measured on this desk</h3>
          {lab && lab.available && (
            <small className="sx-dim">
              {when(lab.at)} · {lab.sessions} sessions · {lab.stocks} stocks · {lab.trades} trades
            </small>
          )}
        </div>
        {owner && (
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={runNow} disabled={running} data-tip="Measure every set-up again now on the NIFTY 100's last ~30 sessions (about a minute; it reads Zerodha's history one stock at a time). It also runs by itself each weekday evening.">
            {running ? `Measuring… ${job ? `${job.done}/${job.total}` : ""}` : "Run now"}
          </button>
        )}
      </header>
      {err && <p className="adm-alert">{err}</p>}
      {running && job && (
        <div className="rs-progress" role="status">
          <div className="rs-progress__bar">
            <i style={{ width: `${Math.round((job.done / Math.max(1, job.total)) * 100)}%` }} />
          </div>
          <small>
            {job.done} of {job.total}
            {job.current ? ` · ${job.current}` : ""}
          </small>
        </div>
      )}
      {lab && !lab.available && <p className="sx-dim">{lab.reason}</p>}
      {lab && lab.available && rows.length === 0 && (
        <p className="sx-dim">
          No set-up fired by its rules on these {lab.sessions} sessions of {lab.stocks} stocks, so there is nothing to measure yet. The lab runs again this evening.
        </p>
      )}
      {job && job.error && <p className="adm-alert">The last run stopped: {job.error}</p>}
      {rows.length > 0 && (
        <div className="bt__scroll">
          <table className="an-table sx-labtable">
            <thead>
              <tr>
                <th scope="col">Set-up</th>
                <th scope="col">Side</th>
                <th scope="col" className="is-num">
                  Trades
                </th>
                <th scope="col" className="is-num">
                  Won
                </th>
                <th scope="col" className="is-num" data-tip="The average result per trade in R (1R = the money at risk), after intraday charges.">
                  Avg after costs
                </th>
                <th scope="col" className="is-num sx-hide-sm" data-tip="What the charges took from each trade, in R.">
                  Costs
                </th>
                <th scope="col" className="sx-hide-sm">
                  Best time
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const best = (r.hours || []).filter((h) => h.n >= 10).sort((a, z) => z.avgR - a.avgR)[0];
                const few = r.n < 30;
                return (
                  <tr key={r.key} className={few ? "is-few" : ""}>
                    <th scope="row">{r.name}</th>
                    <td className={r.side === "long" ? "is-up" : "is-down"}>{r.side === "long" ? "▲ long" : "▼ short"}</td>
                    <td className="is-num">
                      {r.n}
                      {few && <small> too few</small>}
                    </td>
                    <td className="is-num">{r.winPct}%</td>
                    <td className={`is-num ${few ? "" : r.avgR > 0 ? "is-up" : r.avgR < 0 ? "is-down" : ""}`}>
                      <b>{sg(r.avgR)}</b>
                    </td>
                    <td className="is-num sx-hide-sm">{sg(r.avgCostR)}</td>
                    <td className="sx-hide-sm">{best ? `${best.label} (${sg(best.avgR)})` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {lab && lab.available && <p className="sx-foot">How it is measured: {lab.basis}. A set-up needs 30 trades before its record counts in the live scanner; what has paid adds weight its way, what has lost argues against it. Thirty sessions is a short history: a record of the recent past, not a promise.</p>}

      <button type="button" className="sx-more" aria-expanded={kb} onClick={() => setKb((v) => !v)}>
        {kb ? "Hide the desk's knowledge base" : `The desk's knowledge base — what the AI is taught${d && d.knowledge && d.knowledge.count ? ` (${d.knowledge.count} topics)` : ""}`}
      </button>
      {kb && <KnowledgeBase />}
    </section>
  );
}

export default SetupLab;
