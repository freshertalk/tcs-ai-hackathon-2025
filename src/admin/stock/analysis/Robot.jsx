// Trade Analysis → Robot: the AI-powered paper trader (server/robot). Four views:
//   Today        the robot's board — open positions, finished trades, what it looked at and skipped — and the
//                flight recorder of any day: every frame and event of every trade
//   Robot vs you after the close, its day against your real one: the stocks you both traded, the advisor's calls
//                you skipped, your trades it did not take (and why), your habits and the rule that answers each
//   Learning     its mistakes, the corrections it made to its own rulebook and how each fared, its curve, and the
//                Level Book's out-of-sample skill over its first fifteen sessions
//   Level book   the best levels for the next session on the NIFTY 100, with the record each rests on
// Play money only: it cannot place an order, and nothing here is advice.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { Alert, Loading } from "../../ui";
import { LineChart, dayLong, rs, rsSigned, tone } from "./charts";
import { Chip, Tile } from "./Snapshots";
import "./robot.css";

const shortDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const sgR = (x) => (typeof x === "number" ? `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(2)}R` : "—");
const price = (x) => (typeof x === "number" ? x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
const WHY = { stop: "stop", "break-even": "break-even stop", trail: "trailing stop", target: "second target", target1: "first target", giveback: "gave back", flip: "advisor flipped", "square-off": "3:15 square-off", time: "held too long" };
const KIND = { entry: "In", target: "Target", stop: "Stop", exit: "Out" };

function useLoad(url, deps = [], every = 0) {
  const [st, setSt] = useState({ loading: true, data: null, error: "" });
  const load = useCallback(() => (url ? api(url).then((data) => setSt({ loading: false, data, error: "" })).catch((e) => setSt((s) => ({ loading: false, data: s.data, error: e.message }))) : Promise.resolve()), [url]);
  useEffect(() => {
    if (!url) {
      setSt({ loading: false, data: null, error: "" });
      return undefined;
    }
    setSt((s) => ({ ...s, loading: true }));
    load();
    if (!every) return undefined;
    const t = setInterval(load, every);
    return () => clearInterval(t);
  }, [load, every, url, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return [st, load];
}

/* ----------------------------------------------------------------------------------- today */

/** One trade's price through the session, with its entry, stop and targets: the flight recorder's frames. */
function FrameChart({ t }) {
  const f = t.frames || [];
  if (f.length < 2) return <p className="ta-dim">Too few frames recorded for a chart (a frame every 15 seconds while it is open).</p>;
  const W = 640;
  const H = 170;
  const t0 = f[0][0];
  const t1 = Math.max(f[f.length - 1][0], t.exitAt || 0);
  const vals = f.map((x) => x[1]).concat([t.entryAvg, t.stop0, t.t1, t.peak ? t.peak.price : t.entryAvg]);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * 0.1 || 1;
  const X = (ms) => ((ms - t0) / Math.max(1, t1 - t0)) * W;
  const Y = (v) => H - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * H;
  const d = f.map((x, i) => `${i ? "L" : "M"}${X(x[0]).toFixed(1)},${Y(x[1]).toFixed(1)}`).join(" ");
  const line = (v, cls, label) => (
    <g key={cls} className={`rbt-ln rbt-ln--${cls}`}>
      <line x1="0" x2={W} y1={Y(v)} y2={Y(v)} />
      <text x="4" y={Y(v) - 3}>
        {label} {price(v)}
      </text>
    </g>
  );
  return (
    <div className="rbt-chartwrap">
      <svg className="rbt-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${t.symbol} from ${t.entryClock}: entry ${price(t.entryAvg)}, best ${t.peak ? price(t.peak.price) : "—"} at ${t.peak ? t.peak.clock : "—"}`}>
        {line(t.entryAvg, "in", "entry")}
        {line(t.stop0, "stop", "stop")}
        {line(t.t1, "t", "target 1")}
        <path className="rbt-path" d={d} />
        {t.peak && (
          <g className="rbt-peak">
            <circle cx={X(t.peak.at)} cy={Y(t.peak.price)} r="4" />
            <text x={Math.min(W - 70, X(t.peak.at) + 6)} y={Math.max(11, Y(t.peak.price) - 6)}>{`best ${t.peak.clock}`}</text>
          </g>
        )}
        {t.exitAt && <line className="rbt-out" x1={X(t.exitAt)} x2={X(t.exitAt)} y1="0" y2={H} />}
      </svg>
    </div>
  );
}

function Flight({ days }) {
  const [date, setDate] = useState("");
  const [open, setOpen] = useState("");
  useEffect(() => {
    if (!date && days.length) setDate(days[0].date);
  }, [days, date]);
  const [st] = useLoad(date ? `/api/admin/robot/day/${date}` : "", [date]);
  const d = st.data;
  if (!days.length) return <p className="ta-empty">Nothing has been recorded yet: the robot records while Zerodha is connected in market hours.</p>;
  return (
    <section className="ta-card ta-wide">
      <header className="ta-card__h">
        <h3>The flight recorder</h3>
        <small>every frame, event and decision of a day</small>
      </header>
      <div className="lab-bar">
        <label className="rbt-pick">
          <span>Day</span>
          <select value={date} onChange={(e) => { setDate(e.target.value); setOpen(""); }} aria-label="Day to replay">
            {days.map((x) => (
              <option key={x.date} value={x.date}>
                {shortDay(x.date)} — {x.trades + (x.open || 0)} trade{x.trades + (x.open || 0) === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </label>
      </div>
      {st.loading && !d && <Loading label="Opening the recording…" />}
      <Alert>{st.error}</Alert>
      {d && !d.available && <p className="ta-empty">{d.reason}</p>}
      {d && d.available && (
        <>
          {!d.trades.length && <p className="ta-dim">No trade was taken that day.</p>}
          <ul className="rbt-flights">
            {d.trades.map((t) => (
              <li key={t.id} className={open === t.id ? "is-open" : ""}>
                <button type="button" onClick={() => setOpen(open === t.id ? "" : t.id)} aria-expanded={open === t.id}>
                  <b>
                    {t.side === "long" ? "▲" : "▼"} {t.symbol}
                  </b>
                  <span>
                    {t.entryClock}
                    {t.exitClock ? `–${t.exitClock}` : " · open"} · {t.qty0} @ {price(t.entryAvg)}
                  </span>
                  {typeof t.net === "number" ? <i className={tone(t.net)}>{rsSigned(t.net)}</i> : <i>open</i>}
                  {t.outcome && <Chip tone={t.outcome.tone}>{t.outcome.name}</Chip>}
                </button>
                {open === t.id && (
                  <div className="rbt-flight">
                    <FrameChart t={t} />
                    <p className="ta-dim">
                      {t.frames.length} frames · score {t.score}, {t.agree}% agree{t.level ? ` · entered at ${t.level.name}${typeof t.level.ev === "number" ? ` (the Level Book: ${sgR(t.level.ev)}, ${t.level.hit}% won)` : ""}` : ""}
                      {t.peak ? ` · best moment ${t.peak.clock} (${sgR(t.peakR)})` : ""}
                    </p>
                    {t.outcome && <p className="rbt-outcome">{t.outcome.text}</p>}
                    <ol className="snp-timeline">
                      {(t.events || []).map((e, i) => (
                        <li key={`${e.at}-${i}`} className={`snp-m snp-m--${e.kind === "target" ? "peak" : e.kind === "exit" ? "exit" : e.kind === "stop" ? "worst" : "entry"}`}>
                          <time className="snp-m__t">{e.clock}</time>
                          <span className="snp-m__k">{KIND[e.kind] || e.kind}</span>
                          <span className="snp-m__x">{e.text}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {d.decisions.length > 0 && (
            <details className="rbt-dec">
              <summary>What it looked at and skipped ({d.decisions.length})</summary>
              <ul>
                {d.decisions.map((x, i) => (
                  <li key={`${x.at}-${i}`} className={x.action === "enter" ? "is-in" : ""}>
                    <time>{x.clock}</time> <b>{x.symbol}</b> {x.side} · {x.action === "enter" ? "taken" : "skipped"} — {x.why}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

function Today({ days }) {
  const [st, load] = useLoad("/api/admin/robot", [], 5000);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const b = st.data;
  const toggle = async (patch) => {
    setBusy(true);
    setErr("");
    try {
      await api("/api/admin/robot/settings", { method: "PUT", body: patch });
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (st.loading && !b) return <Loading label="Opening the robot…" />;
  if (!b) return <Alert>{st.error}</Alert>;
  return (
    <>
      <section className="ta-card rbt-head">
        <div>
          <h3>
            The paper robot is <b className={b.settings.on ? "is-up" : "is-down"}>{b.settings.on ? "on" : "off"}</b>
            {!b.live && <small> · waiting for the live feed (Zerodha connected, the scanner live, NSE hours)</small>}
          </h3>
          <p className="ta-dim">
            It takes the advisor&rsquo;s eligible calls on the NIFTY 100 with <b>play money</b> — {rs(b.settings.capital)} of capital, {b.settings.riskPct}% risked a trade — runs each by its rulebook, and records every frame and decision. It cannot place an order, and the real trading switch is not touched.
          </p>
        </div>
        <div className="rbt-switch">
          <button type="button" className={`adm-btn adm-btn--sm ${b.settings.on ? "adm-btn--ghost" : ""}`} disabled={busy} onClick={() => toggle({ on: !b.settings.on })}>
            {b.settings.on ? "Switch off" : "Switch on"}
          </button>
          <label className="snp-toggle" data-tip={b.settings.aiReady ? "After the close the AI reads the robot's day and may veto a proposed correction." : "Save an AI key to let the AI review the robot's day."}>
            <input type="checkbox" checked={b.settings.withAi} disabled={busy || !b.settings.aiReady} onChange={(e) => toggle({ withAi: e.target.checked })} /> AI review after the close
          </label>
        </div>
      </section>
      <Alert>{err}</Alert>
      <div className="ta-kpis">
        <Tile label="Today's paper P&L" value={rsSigned(b.day.net)} cls={tone(b.day.net)} sub={`${b.day.netPct > 0 ? "+" : ""}${b.day.netPct}% of the capital`} tip="Finished trades after charges, plus the open ones at the last price." />
        <Tile label="Trades today" value={b.day.trades} sub={`${b.open.length} open · ${b.closed.length} finished`} />
        <Tile label="Won" value={b.day.winPct === null ? "—" : `${b.day.winPct}%`} sub={`${b.day.wins} of ${b.closed.length} finished`} />
      </div>
      <section className="ta-card ta-wide">
        <header className="ta-card__h">
          <h3>Open positions</h3>
          <small>stop, targets and the best gain so far</small>
        </header>
        {!b.open.length ? (
          <p className="ta-empty">Nothing open. It enters when an eligible call passes its gate.</p>
        ) : (
          <div className="lab-scroll">
            <table className="ta-table lab-table snp-table">
              <thead>
                <tr>
                  <th scope="col">Position</th>
                  <th scope="col" className="is-num">P&amp;L</th>
                  <th scope="col">Stop · targets</th>
                  <th scope="col">Best so far</th>
                  <th scope="col">Why it was taken</th>
                </tr>
              </thead>
              <tbody>
                {b.open.map((p) => (
                  <tr key={p.id}>
                    <th scope="row">
                      <b>
                        {p.side === "long" ? "▲" : "▼"} {p.symbol}
                      </b>
                      <small className="snp-sub">
                        {p.entryClock} · {p.qty0} @ {price(p.entryAvg)} · now {price(p.last)}
                      </small>
                    </th>
                    <td className={`is-num ${tone(p.pnl)}`}>
                      {rsSigned(p.pnl)}
                      <small className="snp-sub">{sgR(p.r)}</small>
                    </td>
                    <td>
                      {price(p.stop)}
                      <small className="snp-sub">
                        {price(p.t1)} · {price(p.t2)}
                        {p.t1Hit ? " · first booked" : ""}
                      </small>
                    </td>
                    <td>
                      {sgR(p.peakR)}
                      <small className="snp-sub">at {p.peak.clock}</small>
                    </td>
                    <td className="snp-what">
                      <small>
                        score {p.score}, {p.agree}% agree{p.level ? ` · at ${p.level.name}` : ""}
                      </small>
                      <small>{(p.why || [])[0] || ""}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="ta-card ta-wide">
        <header className="ta-card__h">
          <h3>Finished today</h3>
          <small>with what became of each best moment</small>
        </header>
        {!b.closed.length ? (
          <p className="ta-empty">No finished trade yet today.</p>
        ) : (
          <div className="lab-scroll">
            <table className="ta-table lab-table snp-table">
              <thead>
                <tr>
                  <th scope="col">Trade</th>
                  <th scope="col" className="is-num">Net</th>
                  <th scope="col">Left on</th>
                  <th scope="col">What became of its best moment</th>
                </tr>
              </thead>
              <tbody>
                {b.closed.map((t) => (
                  <tr key={t.id}>
                    <th scope="row">
                      <b>
                        {t.side === "long" ? "▲" : "▼"} {t.symbol}
                      </b>
                      <small className="snp-sub">
                        {t.entryClock}–{t.exitClock} · {t.qty} @ {price(t.entryAvg)} → {price(t.exitAvg)}
                      </small>
                    </th>
                    <td className={`is-num ${tone(t.net)}`}>
                      {rsSigned(t.net)}
                      <small className="snp-sub">{sgR(t.netR)}</small>
                    </td>
                    <td>{WHY[t.why] || t.why}</td>
                    <td className="snp-what">
                      <Chip tone={t.outcome.tone}>{t.outcome.name}</Chip>
                      <small>{t.outcome.text}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {b.decisions.length > 0 && (
        <details className="rbt-dec ta-card">
          <summary>What it looked at just now ({b.decisions.length})</summary>
          <ul>
            {b.decisions.map((x, i) => (
              <li key={`${x.at}-${i}`} className={x.action === "enter" ? "is-in" : ""}>
                <time>{x.clock}</time> <b>{x.symbol}</b> {x.side} · {x.action === "enter" ? "taken" : "skipped"} — {x.why}
              </li>
            ))}
          </ul>
        </details>
      )}
      <Flight days={days} />
      {b.log.length > 0 && (
        <p className="ta-dim">
          Latest: {b.log[0].text}
        </p>
      )}
    </>
  );
}

/* ------------------------------------------------------------------------------- robot vs you */

function VersusYou({ days, summary }) {
  const [date, setDate] = useState("");
  useEffect(() => {
    if (!date && days.length) setDate(days[0].date);
  }, [days, date]);
  const [refresh, setRefresh] = useState(0);
  const [st] = useLoad(date ? `/api/admin/robot/compare/${date}${refresh ? "?refresh=1" : ""}` : "", [date, refresh]);
  const c = st.data;
  if (!days.length) return <p className="ta-empty">No session has been recorded yet. After the close, the robot&rsquo;s day is set against yours here.</p>;
  return (
    <>
      <div className="lab-bar">
        <label className="rbt-pick">
          <span>Day</span>
          <select value={date} onChange={(e) => setDate(e.target.value)} aria-label="Day to compare">
            {days.map((x) => (
              <option key={x.date} value={x.date}>
                {shortDay(x.date)} — robot {rsSigned(x.net)}
                {typeof x.you === "number" ? ` · you ${rsSigned(x.you)}` : ""}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={st.loading} onClick={() => setRefresh((n) => n + 1)} data-tip="Compare again with your trades as they are now (the journal may have been updated).">
          ↻ Compare again
        </button>
      </div>
      {summary && summary.days > 1 && (
        <p className="ta-dim">
          Over {summary.days} compared days the robot made {rsSigned(summary.robotNet)} and you {rsSigned(summary.youNet)}; the robot was ahead on {summary.robotAhead} and you on {summary.youAhead}.
        </p>
      )}
      {st.loading && !c && <Loading label="Setting the days side by side…" />}
      <Alert>{st.error}</Alert>
      {c && c.available && (
        <>
          <p className="ta-dim">{dayLong(c.date)}</p>
          <div className="ta-kpis">
            <Tile label="The robot" value={rsSigned(c.robot.net)} cls={tone(c.robot.net)} sub={`${c.robot.trades} trades · ${c.robot.winPct === null ? "—" : `${c.robot.winPct}% won`}`} />
            <Tile label="You" value={rsSigned(c.you.net)} cls={tone(c.you.net)} sub={`${c.you.trades} trades · ${c.you.winPct === null ? "—" : `${c.you.winPct}% won`}`} />
            <Tile label="The gap" value={rsSigned(c.gap)} cls={tone(c.gap)} sub={c.gap >= 0 ? "the robot made more" : "you made more"} />
            <Tile label="Best moments kept" value={`${c.you.efficiency ?? "—"}% · ${c.robot.efficiency ?? "—"}%`} sub="you · the robot" tip="The share of each trade's best moment that was booked, on average." />
          </div>
          <section className="ta-card lab-lessons">
            <header className="ta-card__h">
              <h3>What happened</h3>
              <small>arithmetic on the two days — no AI</small>
            </header>
            <ul>
              {c.lessons.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </section>
          {c.pairs.length > 0 && (
            <section className="ta-card ta-wide">
              <header className="ta-card__h">
                <h3>The stocks you both traded</h3>
                <small>the same side, while the other was in it</small>
              </header>
              <div className="lab-scroll">
                <table className="ta-table lab-table snp-table">
                  <thead>
                    <tr>
                      <th scope="col">Stock</th>
                      <th scope="col">In</th>
                      <th scope="col">Out</th>
                      <th scope="col" className="is-num">You</th>
                      <th scope="col" className="is-num">Robot</th>
                      <th scope="col">Who did better</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.pairs.map((p) => (
                      <tr key={`${p.you.key}`}>
                        <th scope="row">
                          <b>
                            {p.side === "long" ? "▲" : "▼"} {p.symbol}
                          </b>
                        </th>
                        <td>
                          you {p.you.entryClock}
                          <small className="snp-sub">
                            robot {p.robot.entryClock} · you {p.youLaterMin >= 0 ? `${p.youLaterMin} min later` : `${-p.youLaterMin} min earlier`}, {Math.abs(p.entryEdgePct)}% {p.entryEdgePct >= 0 ? "better" : "worse"}
                          </small>
                        </td>
                        <td>
                          you {p.you.exitClock}
                          <small className="snp-sub">
                            robot {p.robot.exitClock} · you {Math.abs(p.exitEdgePct)}% {p.exitEdgePct >= 0 ? "better" : "worse"}
                          </small>
                        </td>
                        <td className={`is-num ${tone(p.you.net)}`}>{rsSigned(p.you.net)}</td>
                        <td className={`is-num ${tone(p.robot.net)}`}>{rsSigned(p.robot.net)}</td>
                        <td>
                          <Chip tone={p.better === "robot" ? "warn" : p.better === "you" ? "good" : "flat"}>{p.better === "same" ? "about the same" : p.better === "you" ? "you" : "the robot"}</Chip>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <div className="lab-grid">
            <section className="ta-card">
              <header className="ta-card__h">
                <h3>Advisor calls you did not take</h3>
                <small>taken by the robot</small>
              </header>
              {!c.robotOnly.length ? (
                <p className="ta-empty">{c.robot.trades ? "None: you took every call the robot took." : "The robot took no trade on this day."}</p>
              ) : (
                <ul className="rbt-list">
                  {c.robotOnly.map((t) => (
                    <li key={t.key}>
                      <b>
                        {t.side === "long" ? "▲" : "▼"} {t.symbol}
                      </b>{" "}
                      {t.entryClock}–{t.exitClock} <span className={tone(t.net)}>{rsSigned(t.net)}</span>
                      {t.outcome && <small> · {t.outcome.name}</small>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="ta-card">
              <header className="ta-card__h">
                <h3>Your trades the robot did not take</h3>
                <small>and why not</small>
              </header>
              {!c.youOnly.length ? (
                <p className="ta-empty">{c.you.trades ? "None: the robot traded everything you did." : "You took no trade on this day."}</p>
              ) : (
                <ul className="rbt-list">
                  {c.youOnly.map((t) => (
                    <li key={t.key}>
                      <b>
                        {t.side === "long" ? "▲" : "▼"} {t.symbol}
                      </b>{" "}
                      {t.entryClock}–{t.exitClock} <span className={tone(t.net)}>{rsSigned(t.net)}</span>
                      <small> · the robot: {t.reason}</small>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          {c.habits.length > 0 && (
            <section className="ta-card">
              <header className="ta-card__h">
                <h3>Your habits of the day, and the rule that answers each</h3>
              </header>
              <ul className="rbt-list">
                {c.habits.map((h) => (
                  <li key={h.id}>
                    <b>{h.name}</b> ×{h.count} <span className={tone(h.net)}>{rsSigned(h.net)}</span>
                    <small> · {h.answer}</small>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="ta-dim">{c.sample}</p>
        </>
      )}
    </>
  );
}

/* --------------------------------------------------------------------------------- learning */

const STATE = { open: "Open", corrected: "Corrected", fixed: "Fixed", relapse: "Back after its fix", reverted: "Fix undone", quiet: "Quiet" };
const STATE_TONE = { open: "warn", corrected: "flat", fixed: "good", relapse: "bad", reverted: "bad", quiet: "good" };
const COR = { active: "Being measured", kept: "Measured: kept", reverted: "Measured: undone", vetoed: "Vetoed by the AI" };
const COR_TONE = { active: "warn", kept: "good", reverted: "bad", vetoed: "flat" };

function Graduation({ g }) {
  const pct = Math.min(100, Math.round((g.studied / g.target) * 100));
  return (
    <section className={`ta-card rbt-grad rbt-grad--${g.state}`}>
      <header className="ta-card__h">
        <h3>
          Learning the NIFTY 100&rsquo;s levels: session {Math.min(g.studied, g.target)} of {g.target}
        </h3>
        <Chip tone={g.state === "graduated" ? "good" : g.state === "not-yet" ? "warn" : "flat"}>{g.state === "graduated" ? "Suggesting with evidence" : g.state === "not-yet" ? "Still learning" : "Learning"}</Chip>
      </header>
      <div className="rbt-bar" role="progressbar" aria-valuemin="0" aria-valuemax={g.target} aria-valuenow={Math.min(g.studied, g.target)} aria-label="Sessions studied">
        <i style={{ width: `${pct}%` }} />
      </div>
      <p>{g.text}</p>
      <p className="ta-dim">It counts as intelligent only when the levels it would have suggested, chosen from the sessions before each one, beat the average level on the session itself. Sessions read from history count as studied, and are labelled so.</p>
    </section>
  );
}

export function Learning() {
  const [st, load] = useLoad("/api/admin/robot/learning", [], 8000);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const l = st.data;
  const run = async (what, url, body) => {
    setBusy(what);
    setErr("");
    try {
      await api(url, { method: "POST", body: body || {} });
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  };
  if (st.loading && !l) return <Loading label="Opening what the robot has learned…" />;
  if (!l) return <Alert>{st.error}</Alert>;
  const job = l.job && !l.job.finishedAt ? l.job : null;
  const last = l.curve.length ? l.curve[l.curve.length - 1].date : null;
  const sk = l.skill;
  const evald = sk.series.filter((x) => x.evaluated && typeof x.avgR === "number");
  return (
    <>
      <Alert>{err}</Alert>
      <Graduation g={sk.graduation} />
      <div className="lab-bar">
        <button type="button" className="adm-btn adm-btn--sm" disabled={Boolean(job) || busy === "study"} onClick={() => run("study", "/api/admin/robot/study")}>
          {job ? `Studying… ${job.done} of ${job.total}${job.current ? ` (${job.current})` : ""}` : "Study the NIFTY 100 now"}
        </button>
        {last && (
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={busy === "improve"} onClick={() => run("improve", "/api/admin/robot/improve", { date: last })} data-tip="Count the mistakes and correct the rulebook where the evidence calls for it (it does this by itself after every close).">
            Review {shortDay(last)} again
          </button>
        )}
        <small className="ta-dim">
          {sk.studied} sessions studied ({sk.live} live, {sk.backfilled} read from history){sk.from ? ` · ${sk.from} to ${sk.to}` : ""}
        </small>
      </div>
      {evald.length > 1 && (
        <section className="ta-card ta-wide">
          <header className="ta-card__h">
            <h3>Are its suggested levels better than the average level?</h3>
            <small>average R a test, out of sample, session by session</small>
          </header>
          <LineChart xs={evald.map((x) => x.date)} series={[{ label: "Its suggested levels", values: evald.map((x) => x.avgR), c: "up" }, { label: "The average level", values: evald.map((x) => x.allAvgR), c: "b", dashed: true }]} valueFmt={(v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}R`} label="R a test" height={200} />
        </section>
      )}
      {l.curve.length > 1 && (
        <section className="ta-card ta-wide">
          <header className="ta-card__h">
            <h3>Is the robot improving?</h3>
            <small>its own trades: cumulative paper P&amp;L and the share of mistakes (rolling five sessions)</small>
          </header>
          <div className="lab-grid">
            <LineChart xs={l.curve.map((x) => x.date)} series={[{ label: "Cumulative paper P&L", values: l.curve.map((x) => x.cum), c: "a", area: true }]} height={180} label="₹" />
            <LineChart xs={l.curve.map((x) => x.date)} series={[{ label: "Share of mistakes %", values: l.curve.map((x) => x.rollBad), c: "down" }]} valueFmt={(v) => `${Math.round(v)}%`} height={180} label="%" zero={false} />
          </div>
        </section>
      )}
      <section className="ta-card ta-wide">
        <header className="ta-card__h">
          <h3>Mistakes it has made</h3>
          <small>{l.trades} finished trades over {l.sessions} sessions</small>
        </header>
        {!l.mistakes.length ? (
          <p className="ta-empty">No mistake recorded yet.</p>
        ) : (
          <div className="lab-scroll">
            <table className="ta-table lab-table snp-table">
              <thead>
                <tr>
                  <th scope="col">Mistake</th>
                  <th scope="col">Seen</th>
                  <th scope="col" className="is-num">Cost</th>
                  <th scope="col">Now</th>
                  <th scope="col">Its correction</th>
                </tr>
              </thead>
              <tbody>
                {l.mistakes.map((m) => (
                  <tr key={m.id} className={m.state === "relapse" ? "snp-l is-relapse" : ""}>
                    <th scope="row">
                      <b>{m.title}</b>
                      <small className="snp-sub">{m.text}</small>
                    </th>
                    <td>
                      <b>{m.count}×</b>
                      <small className="snp-sub">{m.recent} in the last 15 sessions{m.lastSeen ? ` · last ${shortDay(m.lastSeen)}` : ""}</small>
                    </td>
                    <td className="is-num">{rs(m.cost)}</td>
                    <td>
                      <Chip tone={STATE_TONE[m.state]}>{STATE[m.state] || m.state}</Chip>
                    </td>
                    <td className="snp-what">
                      <small>{m.correction ? `${m.correction.summary} (${shortDay(m.correction.date)})` : "none yet"}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="ta-card ta-wide">
        <header className="ta-card__h">
          <h3>Corrections it has made to its own rulebook</h3>
          <small>one change at a time, each measured five sessions later</small>
        </header>
        {!l.corrections.length ? (
          <p className="ta-empty">None yet. A mistake has to happen at least three times in 15 sessions, and on a fifth of the trades, before the robot changes a rule.</p>
        ) : (
          <ul className="rbt-cors">
            {l.corrections.map((c) => (
              <li key={c.id}>
                <span className="rbt-cors__d">{shortDay(c.date)}</span>
                <Chip tone={COR_TONE[c.status]}>{COR[c.status] || c.status}</Chip>
                <span>
                  <b>{c.title}.</b> {c.summary}. <small>{c.vetoWhy ? `The AI: ${c.vetoWhy}` : c.why}</small>
                  {c.result && (
                    <small className="rbt-cors__r">
                      {" "}
                      Since: {c.result.n} trades averaged {sgR(c.result.avgR)} against {sgR(c.result.baseline)} before{c.result.note ? ` (${c.result.note})` : ""}.
                    </small>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {l.notes.length > 0 && (
        <section className="ta-card lab-lessons">
          <header className="ta-card__h">
            <h3>The AI coach&rsquo;s latest read of the robot&rsquo;s day</h3>
            <small>{shortDay(l.notes[0].date)}</small>
          </header>
          <p>{l.notes[0].review}</p>
          {(l.notes[0].lessons || []).length > 0 && (
            <ul>
              {l.notes[0].lessons.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
        </section>
      )}
      <details className="rbt-dec ta-card">
        <summary>The rulebook it trades by now ({l.rules.rows.filter((r) => r.changed).length} changed from its start)</summary>
        <table className="ta-table lab-table snp-table">
          <thead>
            <tr>
              <th scope="col">Rule</th>
              <th scope="col">Now</th>
              <th scope="col">Started at</th>
            </tr>
          </thead>
          <tbody>
            {l.rules.rows.map((r) => (
              <tr key={r.param} className={r.changed ? "is-yours" : ""}>
                <th scope="row">{r.param}</th>
                <td>{Array.isArray(r.value) ? r.value.join(", ") || "—" : String(r.value)}</td>
                <td>{r.start === null ? "—" : Array.isArray(r.start) ? r.start.join(", ") || "—" : String(r.start)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}

/* -------------------------------------------------------------------------------- level book */

export function LevelBook() {
  const [symbol, setSymbol] = useState("");
  const [st] = useLoad(`/api/admin/robot/levels${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ""}`, [symbol], 0);
  const d = st.data;
  const symbols = useMemo(() => (d && d.symbols ? d.symbols : []), [d]);
  if (st.loading && !d) return <Loading label="Opening the Level Book…" />;
  if (!d) return <Alert>{st.error}</Alert>;
  if (!d.available) return <p className="ta-empty">{d.reason}</p>;
  const g = d.graduation;
  return (
    <>
      <Graduation g={g} />
      <div className="lab-bar">
        <label className="rbt-pick">
          <span>Stock</span>
          <input list="rbt-symbols" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="all NIFTY 100" aria-label="Stock" />
          <datalist id="rbt-symbols">
            {symbols.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <small className="ta-dim">
          Built on {d.sessions} sessions ({d.from} to {d.to}) · levels for the session after {shortDay(d.basedOn)}
        </small>
      </div>
      <section className="ta-card ta-wide">
        <header className="ta-card__h">
          <h3>{symbol ? `Best levels for ${symbol}` : "Best levels for the next session"}</h3>
          <small>expected R a test after costs, from the book — evidence, not a promise{g.state === "graduated" ? "" : "; it has not yet shown skill out of sample"}</small>
        </header>
        {d.gated ? (
          <p className="ta-empty">The book has studied only {d.sessions} session{d.sessions === 1 ? "" : "s"}. It shows its suggestions from {d.minSessions} sessions on: fewer tests are not worth trusting, so the robot does not consult it yet either.</p>
        ) : !d.rows.length ? (
          <p className="ta-empty">{symbol ? `No level of ${symbol} has an expected result above zero in the book yet.` : "No level has an expected result above zero in the book yet."}</p>
        ) : (
          <div className="lab-scroll">
            <table className="ta-table lab-table snp-table">
              <thead>
                <tr>
                  <th scope="col">Stock · level</th>
                  <th scope="col">Play</th>
                  <th scope="col">Entry · stop · target</th>
                  <th scope="col" className="is-num">Expected</th>
                  <th scope="col">Rests on</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={`${r.symbol}-${r.key}`}>
                    <th scope="row">
                      <b>
                        {r.side === "long" ? "▲" : "▼"} {r.symbol}
                      </b>
                      <small className="snp-sub">
                        {r.kindName} {price(r.level)}
                      </small>
                    </th>
                    <td>
                      {r.play === "bounce" ? "Holds" : "Breaks"} · {r.side} {d.provisional && <Chip tone="warn">provisional</Chip>}
                      <small className="snp-sub">{r.trigger}</small>
                    </td>
                    <td>
                      {price(r.entry)}
                      <small className="snp-sub">
                        {price(r.stop)} · {price(r.target)} ({r.riskPct}% risk)
                      </small>
                    </td>
                    <td className="is-num">
                      <b className={tone(r.ev)}>{sgR(r.ev)}</b>
                      <small className="snp-sub">{r.hit}% won</small>
                    </td>
                    <td>
                      <small className="snp-sub">
                        {r.own ? `${r.n} of its own tests` : "pooled record"} · {r.pooledN} across the NIFTY 100 ({r.pooledHit}% won, {sgR(r.pooledEv)})
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {symbol && d.stock && d.stock.records.length > 0 && (
        <section className="ta-card">
          <header className="ta-card__h">
            <h3>{symbol}&rsquo;s own record</h3>
            <small>every kind of level it has tested</small>
          </header>
          <ul className="rbt-list">
            {d.stock.records.slice(0, 12).map((r) => (
              <li key={r.key}>
                {r.key.split("|")[0].toUpperCase()} {r.key.split("|")[1] === "bounce" ? "holds" : "breaks"} ({r.key.split("|")[2]}): {r.n} tests, {r.hitPct}% won, <span className={tone(r.avgR)}>{sgR(r.avgR)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="ta-card ta-wide">
        <header className="ta-card__h">
          <h3>What each kind of level has done</h3>
          <small>all NIFTY 100 stocks, after costs</small>
        </header>
        <div className="lab-scroll">
          <table className="ta-table lab-table snp-table">
            <thead>
              <tr>
                <th scope="col">Level and play</th>
                <th scope="col" className="is-num">Tests</th>
                <th scope="col" className="is-num">Won</th>
                <th scope="col" className="is-num">R a test</th>
              </tr>
            </thead>
            <tbody>
              {d.kinds.map((k) => (
                <tr key={k.key}>
                  <th scope="row">
                    {k.name} {k.play === "bounce" ? "holds" : "breaks"} <small>({k.side})</small>
                  </th>
                  <td className="is-num">{k.n}</td>
                  <td className="is-num">{k.hitPct}%</td>
                  <td className={`is-num ${tone(k.avgR)}`}>{sgR(k.avgR)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="ta-dim">Each test is the level&rsquo;s first touch of a session traded on 5-minute bars: entered at the level (holds) or after a close 0.2 ATR beyond it (breaks), stop 0.6 ATR, target 1.5R, out after two hours or at 3:15 PM, charges taken off. It is a measurement of the past and not advice.</p>
    </>
  );
}

/* ------------------------------------------------------------------------------------ the part */

const VIEWS = [
  { id: "today", label: "Today" },
  { id: "versus", label: "Robot vs you" },
  { id: "learning", label: "Learning" },
  { id: "levels", label: "Level book" },
];

export default function Robot() {
  const [view, setView] = useState(() => {
    try {
      const v = window.localStorage.getItem("vpt.robot.view");
      return VIEWS.some((x) => x.id === v) ? v : "today";
    } catch (_) {
      return "today";
    }
  });
  const [days] = useLoad("/api/admin/robot/days", [], 30000);
  const list = days.data ? days.data.days.filter((x) => x.trades > 0 || x.open > 0 || x.compared) : [];
  const pick = (v) => {
    setView(v);
    try {
      window.localStorage.setItem("vpt.robot.view", v);
    } catch (_) {
      /* remembered for this visit only */
    }
  };
  return (
    <>
      <div className="lab-bar rbt-views">
        <div className="ta-seg" role="group" aria-label="The paper robot">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" aria-pressed={view === v.id} onClick={() => pick(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
        <small className="ta-dim">play money · cannot place an order</small>
      </div>
      {view === "today" && <Today days={list} />}
      {view === "versus" && <VersusYou days={list} summary={days.data ? days.data.summary : null} />}
      {view === "learning" && <Learning />}
      {view === "levels" && <LevelBook />}
    </>
  );
}
