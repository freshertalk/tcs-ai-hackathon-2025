// Behaviour & AI: how this stock has actually behaved over the past year — measured and kept
// in the database, one snapshot a day — and an AI decision that weighs today's live data
// against those habits. Additional to every other tab; it changes none of them.

import React, { useCallback, useEffect, useState } from "react";
import { api, peek } from "../../api";
import { Alert, Loading } from "../../ui";
import { inr, isNum, num, pct, when } from "./format";
import EdgeCard from "../advisor/EdgeCard";

const STATE = { uptrend: "Uptrend", downtrend: "Downtrend", sideways: "Sideways", unknown: "—" };
const DEC = { buy: "Buy", sell: "Sell", hold: "Hold", wait: "Wait", avoid: "Avoid" };
const tone = (x) => (!isNum(x) || x === 0 ? "" : x > 0 ? "is-up" : "is-down");

function Stat({ k, v, sub, t, tip }) {
  return (
    <div className={t || ""} data-tip={tip}>
      <dt>{k}</dt>
      <dd>{v}</dd>
      {sub && <small>{sub}</small>}
    </div>
  );
}

/** The year as trend phases: one coloured segment per phase, its width its length. */
function Phases({ phases }) {
  if (!phases || !phases.length) return null;
  const total = phases.reduce((a, p) => a + p.days, 0);
  return (
    <div className="bh-phases">
      <div className="bh-phases__bar" role="img" aria-label={phases.map((p) => `${STATE[p.state]} ${p.days} days from ${p.from}`).join("; ")}>
        {phases.map((p, i) => (
          <i key={i} className={`is-${p.state}`} style={{ flexGrow: p.days }} title={`${STATE[p.state]}: ${p.from} → ${p.to} (${p.days} sessions)`} />
        ))}
      </div>
      <div className="bh-phases__ends">
        <span>{phases[0].from}</span>
        <span>{total} sessions in these phases</span>
        <span>{phases[phases.length - 1].to}</span>
      </div>
    </div>
  );
}

function DecisionCard({ symbol }) {
  const [st, setSt] = useState({ configured: false, decisions: [] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    api(`/api/admin/ai/decision/${encodeURIComponent(symbol)}`)
      .then((d) => alive && setSt(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [symbol]);
  const run = async () => {
    setBusy(true);
    setErr("");
    try {
      const d = await api(`/api/admin/ai/decision/${encodeURIComponent(symbol)}`, { method: "POST", body: {} });
      setSt({ configured: d.configured, decisions: d.decisions });
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };
  const d = st.decisions[0];
  return (
    <section className="an-card bh-dec">
      <header className="an-card__head">
        <div>
          <h3>AI decision</h3>
          <p>Today’s live price, volume, tape, indicators and levels, weighed against this stock’s habits from the past year and its measured odds. A plan’s prices are checked by arithmetic; nothing is ever placed as an order.</p>
        </div>
        <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" onClick={run} disabled={busy || !st.configured} data-tip="Ask for a decision now. It uses your Anthropic API tokens, and runs only when you press it.">
          {busy ? "Weighing today against its habits…" : d ? "Decide again" : "Get AI decision"}
        </button>
      </header>
      {!st.configured && <p className="adm-alert adm-alert--info">Add an Anthropic API key in the AI settings for AI decisions. The behaviour profile below works without one.</p>}
      <Alert>{err}</Alert>
      {d && (
        <div className="bh-dec__out">
          <div className="bh-dec__top">
            <span className={`bh-chip bh-chip--${d.decision}`}>{DEC[d.decision]}</span>
            <span>
              heading <b className={d.heading === "up" ? "is-up" : d.heading === "down" ? "is-down" : ""}>{d.heading}</b> · {d.horizon} · {d.confidence} confidence
            </span>
            <small>
              {when(d.at)} · at {inr(d.priceAt)} · {d.model}
            </small>
          </div>
          <p>{d.thesis}</p>
          {d.plan && (
            <dl className={`bh-plan ${d.plan.checkStatus === "rejected" ? "is-bad" : ""}`}>
              <div>
                <dt>{d.plan.side === "long" ? "Buy at" : "Sell at"}</dt>
                <dd>{inr(d.plan.entry)}</dd>
              </div>
              <div>
                <dt>Stop</dt>
                <dd>{inr(d.plan.stop)}</dd>
              </div>
              <div>
                <dt>Targets</dt>
                <dd>{d.plan.targets.map((t) => num(t)).join(" · ") || "—"}</dd>
              </div>
              <div data-tip="The same arithmetic checks as the strategist's plans: stop on the right side, distance against ATR, inside the circuit limits.">
                <dt>Checks</dt>
                <dd>{d.plan.checkStatus === "rejected" ? "Failed — do not use" : d.plan.checkStatus === "passed" ? "Passed" : d.plan.checkStatus}</dd>
              </div>
            </dl>
          )}
          {d.plan && d.plan.checks.filter((c) => !c.ok).map((c) => <p key={c.name} className="tr-note is-bad">{c.name}: {c.detail}</p>)}
          {d.levelNotes && <p className="vd-note">{d.levelNotes}</p>}
          <div className="rs-cols">
            <div>
              <h4>Today says</h4>
              <ul>
                {d.liveEvidence.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
            <div>
              <h4>Its habits say</h4>
              <ul>
                {d.habitEvidence.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          </div>
          {d.oddsEvidence && d.oddsEvidence.length > 0 && (
            <div className="bh-odds">
              <h4>The measured odds say</h4>
              <ul>
                {d.oddsEvidence.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          )}
          {d.conflicts.length > 0 && (
            <p className="tr-note is-warn">
              <b>Where they disagree:</b> {d.conflicts.join(" ")}
            </p>
          )}
          <p>
            <b>Cancelled if:</b> {d.invalidation}
          </p>
          {d.watch.length > 0 && (
            <p className="vd-note">
              <b>Watch:</b> {d.watch.join(" · ")}
            </p>
          )}
          {st.decisions.length > 1 && (
            <details className="bh-hist">
              <summary>
                <b>Earlier decisions</b> ({st.decisions.length - 1})
              </summary>
              <ul>
                {st.decisions.slice(1).map((x) => (
                  <li key={x.id}>
                    {when(x.at)} · <span className={`bh-chip bh-chip--${x.decision}`}>{DEC[x.decision]}</span> at {inr(x.priceAt)} · heading {x.heading} · {x.confidence}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="vd-note">A decision is an opinion from the data shown, not advice and not a forecast you can rely on.</p>
        </div>
      )}
    </section>
  );
}

export default function Behaviour({ symbol }) {
  const [s, setS] = useState(() => ({ loading: true, p: peek(`/api/admin/market/behaviour/${encodeURIComponent(symbol)}`, 30 * 60 * 1000), error: "" }));
  const [learn, setLearn] = useState("");
  const load = useCallback(
    (refresh = false) => {
      setS((x) => ({ ...x, loading: true, error: "" }));
      api(`/api/admin/market/behaviour/${encodeURIComponent(symbol)}${refresh ? "?refresh=1" : ""}`)
        .then((p) => setS({ loading: false, p, error: "" }))
        .catch((e) => setS((x) => ({ loading: false, p: x.p, error: e.message })));
    },
    [symbol]
  );
  useEffect(() => load(false), [load]);
  const learnAll = async () => {
    setLearn("Learning the watchlist…");
    try {
      const d = await api("/api/admin/market/behaviour/learn", { method: "POST", body: {} });
      const bad = d.learned.filter((x) => !x.ok);
      setLearn(`Learned ${d.learned.length - bad.length} of ${d.learned.length} watchlist stocks${bad.length ? ` (not: ${bad.map((x) => x.symbol).join(", ")})` : ""}.`);
    } catch (e) {
      setLearn(e.message);
    }
  };

  const p = s.p;
  if (s.loading && !p) return <Loading label="Reading a year of daily bars…" />;
  if (!p) return <Alert>{s.error}</Alert>;
  if (!p.available)
    return (
      <div className="bh">
        <p className="adm-alert adm-alert--info">{p.reason}</p>
        <EdgeCard symbol={symbol} />
      </div>
    );
  const c = p.price.changePct;

  return (
    <div className="bh">
      <section className="an-card">
        <header className="an-card__head">
          <div>
            <h3>How {symbol} behaves</h3>
            <p>
              Measured from {p.days} sessions of daily bars ({p.from} → {p.asOf}) and kept in the database with a snapshot each day ({(p.history || []).length} so far). Habits, not forecasts.
            </p>
          </div>
          <span className="bh-act">
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => load(true)} disabled={s.loading} data-tip="Measure again from the latest daily bars.">
              {s.loading ? "Measuring…" : "Refresh"}
            </button>
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={learnAll} data-tip="Measure and store the behaviour of every watchlist stock now. It also happens by itself once a day while the desk is open.">
              Learn whole watchlist
            </button>
          </span>
        </header>
        {learn && <p className="vd-note">{learn}</p>}
        <Alert>{s.error}</Alert>

        <dl className="bh-stats">
          <Stat k="Trend now" v={STATE[p.trend.now]} sub={`${p.trend.sessions} sessions · 50-day slope ${pct(p.trend.slope50Pct, 1)}`} t={p.trend.now === "uptrend" ? "is-up" : p.trend.now === "downtrend" ? "is-down" : ""} tip="From the close against the 50-day average and that average's slope over 10 sessions." />
          <Stat k="Swings" v={p.structure.pattern.replace(" (range or transition)", "")} tip="The last three confirmed swing highs and lows." />
          <Stat k="52-week position" v={`${num(p.price.pos52Pct, 0)}%`} sub={`${num(p.price.low52)} – ${num(p.price.high52)}`} tip="Where the last close sits between the year's low (0%) and high (100%)." />
          <Stat k="Volatility" v={`${num(p.volatility.atrPct)}%`} sub={`normal ${num(p.volatility.atrAvgPct)}% · ${p.volatility.regime}`} t={p.volatility.regime === "high" ? "is-down" : ""} tip="ATR as a share of price now, against its own one-year average." />
          <Stat k="Drawdown" v={pct(p.drawdown.currentPct, 1)} sub={`worst in the year ${pct(p.drawdown.maxPct, 1)}`} t="is-down" tip="How far the last close is below the year's highest close, and the deepest fall of the year." />
          <Stat k="Up days" v={`${num(p.returns.upDaysPct, 0)}%`} sub={`avg up ${pct(p.returns.avgUpPct)} · down ${pct(p.returns.avgDownPct)}`} />
        </dl>

        <div className="bh-chg">
          {[["1D", c.d1], ["1W", c.w1], ["1M", c.m1], ["3M", c.m3], ["6M", c.m6], ["1Y", c.y1]].map(([k, v]) => (
            <span key={k}>
              {k} <b className={tone(v)}>{pct(v, 1)}</b>
            </span>
          ))}
        </div>

        <h4 className="bh-h">Trend phases</h4>
        <Phases phases={p.trend.phases} />

        <h4 className="bh-h">Its habits</h4>
        <ul className="bh-facts">
          {p.facts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </section>

      <EdgeCard symbol={symbol} />

      <DecisionCard symbol={symbol} />

      <div className="bh-two">
        <section className="an-card">
          <h4 className="bh-h">Levels from its swings</h4>
          <div className="rs-levels">
            {p.levels.resistances
              .slice()
              .reverse()
              .map((x) => (
                <span key={`r${x.price}`} className="is-r" title={`${x.touches} touches`}>
                  R {num(x.price)} <small>×{x.touches}</small>
                </span>
              ))}
            <span className="is-p">Last {num(p.price.last)}</span>
            {p.levels.supports.map((x) => (
              <span key={`s${x.price}`} className="is-s" title={`${x.touches} touches`}>
                S {num(x.price)} <small>×{x.touches}</small>
              </span>
            ))}
          </div>
          <h4 className="bh-h">By weekday</h4>
          <table className="an-table bh-wk">
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col" className="is-num">
                  Avg
                </th>
                <th scope="col" className="is-num">
                  Up %
                </th>
                <th scope="col" className="is-num">
                  Days
                </th>
              </tr>
            </thead>
            <tbody>
              {p.weekday.map((w) => (
                <tr key={w.day}>
                  <th scope="row">{w.day}</th>
                  <td className={`is-num ${tone(w.avgPct)}`}>{pct(w.avgPct)}</td>
                  <td className="is-num">{num(w.upPct, 0)}%</td>
                  <td className="is-num">{w.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="an-card">
          <h4 className="bh-h">Notable days</h4>
          <ul className="bh-log">
            {p.log
              .slice(-14)
              .reverse()
              .map((x) => (
                <li key={x.t}>
                  <time>{x.t}</time> <b className={tone(x.retPct)}>{pct(x.retPct, 1)}</b> {x.events.join(" · ")}
                </li>
              ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
