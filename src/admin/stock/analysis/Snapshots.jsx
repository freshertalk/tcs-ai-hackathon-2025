// Trade Analysis's memory, in three parts (server/analysis/snapshot.js):
//   Snapshots   one day as a timeline with a timestamp on every moment — each entry, the best moment of each
//               trade and what you did about it (booked it, stayed past it, left before the bigger move),
//               the day's own profit-and-loss curve with its peak and trough, the daily stop and target
//   Outcomes    a table of every trade, from every recorded day: what became of its peak
//   Don't repeat  the register of learnings: each costly habit counted, what it cost, when it last
//               happened, the one rule to follow, and your own status on it
// Everything is worked out by the server from your fills and Zerodha's bars — no AI, no typing of figures.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { useTopics } from "../../live";
import { Alert, Loading } from "../../ui";
import { DateField } from "../../DatePicker";
import { dayLong, rs, rsSigned, tone } from "./charts";
import "./snapshots.css";

const IST = 5.5 * 3600 * 1000;
const todayIst = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const shortDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

function Tile({ label, value, cls = "", sub, tip }) {
  return (
    <div className="ta-kpi" data-tip={tip}>
      <span className="ta-kpi__l">{label}</span>
      <b className={`ta-kpi__v ${cls}`}>{value}</b>
      {sub && <small className="ta-kpi__s">{sub}</small>}
    </div>
  );
}

const Chip = ({ tone: t, children }) => <span className={`snp-chip snp-chip--${t || "flat"}`}>{children}</span>;
export { Tile, Chip };

/* --------------------------------------------------------------------------------- snapshots */

const KIND = { entry: "In", peak: "Peak", worst: "Low", coach: "Coach", exit: "Out", after: "After", signal: "Signal", level: "Level", alert: "Alert", ai: "AI", "day-peak": "Day high", "day-trough": "Day low", target: "Target", stop: "Stop" };
const LIVE = new Set(["signal", "level", "alert", "ai"]);

/** The day's profit-and-loss through the session, with its peak and trough, and each trade's span under it. */
function DayCurve({ day, trades }) {
  const pts = day && day.measured ? day.curve : [];
  if (pts.length < 2) return null;
  const W = 640;
  const H = 190;
  const B = 42; // the strip of trades and the hour labels under the curve
  const t0 = pts[0][0];
  const t1 = pts[pts.length - 1][0];
  const vals = pts.map((p) => p[1]);
  const lo = Math.min(...vals, 0);
  const hi = Math.max(...vals, 0);
  const pad = (hi - lo) * 0.12 || 1;
  const X = (ms) => ((ms - t0) / Math.max(1, t1 - t0)) * W;
  const Y = (v) => (H - B) - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (H - B);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ");
  const clock = (ms) => new Date(ms + IST).toISOString().slice(11, 16);
  const hours = [10, 11, 12, 13, 14, 15].map((h) => ({ h, ms: Date.parse(`${new Date(t0 + IST).toISOString().slice(0, 10)}T${String(h).padStart(2, "0")}:00:00+05:30`) }));
  return (
    <section className="ta-card ta-wide">
      <header className="ta-card__h">
        <h3>The day&rsquo;s profit and loss, minute by minute</h3>
        <small>open trades at the minute&rsquo;s close · the strip shows when each trade was open</small>
      </header>
      <div className="snp-curvewrap">
      <svg className="snp-curve" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`The day's profit peaked at ${rsSigned(day.peak.pnl)} at ${day.peak.clock} and closed at ${rsSigned(day.close)}`}>
        <line className="snp-zero" x1="0" x2={W} y1={Y(0)} y2={Y(0)} />
        {hours.map((x) => (
          <g key={x.h} className="snp-hour">
            <line x1={X(x.ms)} x2={X(x.ms)} y1="0" y2={H - 16} />
            <text x={X(x.ms) + 3} y={H - 4}>
              {x.h > 12 ? x.h - 12 : x.h}
              {x.h >= 12 ? "pm" : "am"}
            </text>
          </g>
        ))}
        <path className="snp-line" d={d} />
        <g className="snp-pk">
          <circle cx={X(day.peak.at)} cy={Y(day.peak.pnl)} r="4" />
          <text x={Math.min(W - 96, Math.max(4, X(day.peak.at) - 40))} y={Math.max(11, Y(day.peak.pnl) - 7)}>
            {`peak ${rsSigned(day.peak.pnl)} ${day.peak.clock}`}
          </text>
        </g>
        {day.trough.pnl < 0 && day.trough.at !== day.peak.at && (
          <g className="snp-lo">
            <circle cx={X(day.trough.at)} cy={Y(day.trough.pnl)} r="4" />
            <text x={Math.min(W - 100, Math.max(4, X(day.trough.at) - 40))} y={Math.min(H - B - 14, Y(day.trough.pnl) + 15)}>
              {`low ${rsSigned(day.trough.pnl)} ${day.trough.clock}`}
            </text>
          </g>
        )}
        {trades.map((t, i) => (
          <g key={t.key} className={`snp-span snp-span--${t.outcome.tone}`}>
            <title>{`${t.symbol} ${t.entryClock}–${t.exitClock}: ${t.outcome.name}`}</title>
            <rect x={X(Math.max(t0, t.entryAt))} y={H - B + 3 + (i % 3) * 7} width={Math.max(2, X(Math.min(t1, t.exitAt)) - X(Math.max(t0, t.entryAt)))} height="5" rx="2" />
          </g>
        ))}
      </svg>
      </div>
      <p className="ta-dim">
        {clock(t0)} to {clock(t1)} · peak {rsSigned(day.peak.pnl)} at {day.peak.clock}
        {day.peak.holding.length ? ` (open: ${day.peak.holding.join(", ")})` : ""} · lowest {rsSigned(day.trough.pnl)} at {day.trough.clock} · closed {rsSigned(day.close)}
        {day.givenBack > 0 ? ` · ${rs(day.givenBack)} of the peak given back` : ""}
      </p>
    </section>
  );
}

function PeakTable({ trades }) {
  return (
    <section className="ta-card ta-wide">
      <header className="ta-card__h">
        <h3>What became of each trade&rsquo;s best moment</h3>
        <small>the time the position was worth most while you were in it, and what you did</small>
      </header>
      <div className="lab-scroll">
        <table className="ta-table lab-table snp-table">
          <thead>
            <tr>
              <th scope="col">Trade</th>
              <th scope="col">Best moment</th>
              <th scope="col">You left</th>
              <th scope="col" className="is-num">
                Left on the table
              </th>
              <th scope="col">What became of it</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => (
              <tr key={t.key}>
                <th scope="row">
                  <b>
                    {t.side === "long" ? "▲" : "▼"} {t.symbol}
                  </b>
                  <small className="snp-sub">
                    in {t.entryClock} · {t.qty} @ {t.entryAvg}
                  </small>
                </th>
                <td>
                  {t.peak ? (
                    <>
                      <b className={tone(t.peak.pnl)}>{t.peak.clock}</b>
                      <small className="snp-sub">
                        {rsSigned(t.peak.pnl)}
                        {typeof t.peak.pct === "number" ? ` · ${t.peak.pct}%` : ""}
                      </small>
                    </>
                  ) : (
                    <span className="ta-dim">—</span>
                  )}
                </td>
                <td>
                  <b>{t.exitClock}</b>
                  <small className={`snp-sub ${tone(t.net)}`}>
                    {rsSigned(t.net)}
                    {typeof t.gapMin === "number" && t.peak && t.peak.pnl > 0 ? ` · ${t.gapMin <= 2 ? "at the peak" : `${t.gapMin} min after`}` : ""}
                  </small>
                </td>
                <td className={`is-num ${t.leftOnTable > 0 ? "is-down" : ""}`}>{typeof t.leftOnTable === "number" ? rs(t.leftOnTable) : "—"}</td>
                <td className="snp-what">
                  <Chip tone={t.outcome.tone}>{t.outcome.name}</Chip>
                  <small>{t.outcome.text}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Timeline({ moments }) {
  const live = moments.filter((m) => LIVE.has(m.kind)).length;
  const [signals, setSignals] = useState(false);
  const shown = signals ? moments : moments.filter((m) => !LIVE.has(m.kind));
  return (
    <section className="ta-card ta-wide">
      <header className="ta-card__h">
        <h3>The day, moment by moment</h3>
        {live > 0 && (
          <label className="snp-toggle">
            <input type="checkbox" checked={signals} onChange={(e) => setSignals(e.target.checked)} /> live-board signals ({live})
          </label>
        )}
      </header>
      <ol className="snp-timeline">
        {shown.map((m, i) => (
          <li key={`${m.at}-${m.kind}-${m.key || ""}-${i}`} className={`snp-m snp-m--${m.kind}`}>
            <time className="snp-m__t">{m.clock}</time>
            <span className="snp-m__k">{KIND[m.kind] || m.kind}</span>
            <span className="snp-m__x">{m.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function DaySnapshot({ date, setDate }) {
  const [st, setSt] = useState({ loading: true, s: null, error: "" });
  const load = useCallback(
    (refresh = false, quiet = false) => {
      if (!quiet) setSt((x) => ({ ...x, loading: true, error: "" }));
      return api(`/api/admin/analysis/snapshot/${date}${refresh ? "?refresh=1" : ""}`)
        .then((s) => setSt({ loading: false, s, error: "" }))
        .catch((e) => setSt((x) => (quiet ? { ...x, loading: false } : { loading: false, s: null, error: e.message })));
    },
    [date]
  );
  useEffect(() => {
    load();
  }, [load]);
  useTopics(["analysis", "trading"], () => load(false, true));
  const s = st.s;
  return (
    <>
      <div className="lab-bar">
        <DateField value={date} max={todayIst()} onChange={setDate} label="Day" />
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={st.loading} onClick={() => load(true)} data-tip="Build the day's snapshot again from Zerodha's 1-minute bars (it is kept for good once built).">
          {st.loading ? "Building…" : "↻ Build again"}
        </button>
      </div>
      {st.loading && !s && <Loading label="Opening the snapshot…" />}
      <Alert>{st.error}</Alert>
      {s && !s.available && <p className="ta-empty">{s.reason}</p>}
      {s && s.available && (
        <>
          <p className="ta-dim">
            {dayLong(s.date)} · recorded for good: the 1-minute bars it was built from are gone from Zerodha after about 60 days, the snapshot is not.
          </p>
          <div className="ta-kpis">
            <Tile label="The day's peak" value={s.summary.peak ? rsSigned(s.summary.peak.pnl) : "—"} cls={s.summary.peak ? tone(s.summary.peak.pnl) : ""} sub={s.summary.peak ? `at ${s.summary.peak.clock}${s.summary.peak.holding.length ? ` · open: ${s.summary.peak.holding.join(", ")}` : ""}` : "needs the day's bars"} tip="The most the whole day's profit and loss stood at, on the 1-minute closes, with the positions that were open." />
            <Tile label="The day closed" value={rsSigned(s.summary.net)} cls={tone(s.summary.net)} sub={`${s.summary.trades} trade${s.summary.trades === 1 ? "" : "s"} · after charges`} />
            <Tile label="Given back from the peak" value={typeof s.summary.givenBack === "number" ? rs(s.summary.givenBack) : "—"} cls={s.summary.givenBack > 0 ? "is-down" : ""} sub="the day's peak less where it closed" />
            <Tile label="Left on the table" value={rs(s.summary.leftOnTable)} cls={s.summary.leftOnTable > 0 ? "is-down" : ""} sub="each trade's best moment less what you took" tip="Added up trade by trade: the best moment while you were in it, less what you booked." />
            <Tile label="Booked at the best" value={`${s.summary.booked} of ${s.summary.trades}`} sub={`${s.summary.gaveBack} gave it back · ${s.summary.leftEarly} left early · ${s.summary.neverPaid} never paid`} tip="Trades closed within minutes of the best moment, or with most of the move in hand." />
          </div>
          {s.headline.length > 0 && (
            <section className="ta-card lab-lessons">
              <header className="ta-card__h">
                <h3>The day at a glance</h3>
                <small>measured on your fills and the day&rsquo;s bars</small>
              </header>
              <ul>
                {s.headline.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </section>
          )}
          <DayCurve day={s.day} trades={s.trades} />
          <PeakTable trades={s.trades} />
          <Timeline moments={s.moments} />
          {(s.notes || []).map((n) => (
            <p key={n} className="ta-dim">
              {n}
            </p>
          ))}
        </>
      )}
    </>
  );
}

/* ---------------------------------------------------------------------------------- outcomes */

const OPERIODS = [
  { id: "7", label: "7 days", days: 7 },
  { id: "30", label: "30 days", days: 30 },
  { id: "90", label: "90 days", days: 90 },
  { id: "all", label: "All" },
];
const readKey = (k, d) => {
  try {
    return window.localStorage.getItem(k) || d;
  } catch (_) {
    return d;
  }
};

export function Outcomes({ onOpenDay }) {
  const [p, setP] = useState(() => readKey("vpt.outcomes.period", "30"));
  const [only, setOnly] = useState("");
  const [sort, setSort] = useState("date");
  const [st, setSt] = useState({ loading: true, r: null, error: "" });
  const range = useMemo(() => {
    const per = OPERIODS.find((x) => x.id === p) || OPERIODS[1];
    return per.days ? `?from=${addDays(todayIst(), -(per.days - 1))}&to=${todayIst()}` : "";
  }, [p]);
  useEffect(() => {
    setSt((x) => ({ ...x, loading: true }));
    api(`/api/admin/analysis/outcomes${range}`)
      .then((r) => setSt({ loading: false, r, error: "" }))
      .catch((e) => setSt({ loading: false, r: null, error: e.message }));
  }, [range]);
  const r = st.r;
  const names = useMemo(() => Object.fromEntries(((r && r.outcomes) || []).map((o) => [o.id, o])), [r]);
  const rows = useMemo(() => {
    if (!r) return [];
    const list = only ? r.rows.filter((x) => x.outcome === only) : r.rows.slice();
    if (sort === "net") list.sort((a, b) => a.net - b.net);
    else if (sort === "left") list.sort((a, b) => (b.leftOnTable || 0) - (a.leftOnTable || 0));
    return list;
  }, [r, only, sort]);
  const sm = r && r.summary;
  return (
    <>
      <div className="lab-bar">
        <div className="ta-seg" role="group" aria-label="Period">
          {OPERIODS.map((x) => (
            <button
              key={x.id}
              type="button"
              aria-pressed={p === x.id}
              onClick={() => {
                setP(x.id);
                try {
                  window.localStorage.setItem("vpt.outcomes.period", x.id);
                } catch (_) {
                  /* remembered for this visit only */
                }
              }}
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>
      {st.loading && !r && <Loading label="Adding up the outcomes…" />}
      <Alert>{st.error}</Alert>
      {r && !r.summary.trades && <p className="ta-empty">No trade in this period has been recorded yet. The server records every recent day with trades by itself within the hour; or open a day under Snapshots.</p>}
      {r && r.summary.trades > 0 && (
        <>
          <div className="ta-kpis">
            <Tile label="Trades recorded" value={sm.trades} sub={`${r.days} day${r.days === 1 ? "" : "s"} · net ${rsSigned(sm.net)}`} />
            <Tile label="Best moments on offer" value={rs(sm.peakOnOffer)} sub={`you took ${rs(sm.took)} of it`} tip="Trades that were meaningfully in profit at some point: the best moment of each, added up, against what each closed with." />
            <Tile label="Left on the table" value={rs(sm.leftOnTable)} cls={sm.leftOnTable > 0 ? "is-down" : ""} sub="best moments not booked" />
            <Tile label="Ran on after you left" value={rs(sm.missedAfter)} cls={sm.missedAfter > 0 ? "is-down" : ""} sub="bigger moves within 45 min of an exit" />
          </div>
          <section className="ta-card">
            <header className="ta-card__h">
              <h3>What became of the best moments</h3>
              <small>press one to filter the table</small>
            </header>
            <ul className="snp-outs">
              {sm.byOutcome
                .filter((o) => o.count)
                .map((o) => (
                  <li key={o.id}>
                    <button type="button" className={`snp-out snp-out--${o.tone}`} aria-pressed={only === o.id} onClick={() => setOnly(only === o.id ? "" : o.id)}>
                      <b>{o.name}</b>
                      <span>
                        {o.count} trade{o.count === 1 ? "" : "s"} · <i className={tone(o.net)}>{rsSigned(o.net)}</i>
                        {o.left > 0 ? ` · ${rs(o.left)} left` : ""}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </section>
          <section className="ta-card ta-wide">
            <header className="ta-card__h">
              <h3>Every trade and what became of it</h3>
              <small>
                {only ? `${names[only] ? names[only].name : only}: ` : ""}
                {rows.length} of {r.total}
                {r.total > r.rows.length ? " (the newest are shown)" : ""} · open a day to see its timeline
              </small>
            </header>
            <div className="lab-scroll">
              <table className="ta-table lab-table snp-table snp-table--out">
                <thead>
                  <tr>
                    <th scope="col">
                      <button type="button" className="snp-sort" aria-pressed={sort === "date"} onClick={() => setSort("date")}>
                        Trade
                      </button>
                    </th>
                    <th scope="col">Best moment</th>
                    <th scope="col" className="is-num">
                      <button type="button" className="snp-sort" aria-pressed={sort === "net"} onClick={() => setSort("net")}>
                        Net
                      </button>
                    </th>
                    <th scope="col" className="is-num">
                      <button type="button" className="snp-sort" aria-pressed={sort === "left"} onClick={() => setSort("left")}>
                        Left
                      </button>
                    </th>
                    <th scope="col">What became of it</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((x) => (
                    <tr key={x.id}>
                      <th scope="row">
                        <button type="button" className="lab-trade" onClick={() => onOpenDay && onOpenDay(x.date)} data-tip="Open this day's snapshot.">
                          <b>
                            {x.side === "long" ? "▲" : "▼"} {x.symbol}
                          </b>
                          <small>
                            {shortDay(x.date)} · {x.entryClock}–{x.exitClock}
                          </small>
                        </button>
                      </th>
                      <td>
                        {x.peakClock ? (
                          <>
                            <b>{x.peakClock}</b>
                            <small className="snp-sub">{rsSigned(x.peakPnl)}</small>
                          </>
                        ) : (
                          <span className="ta-dim">—</span>
                        )}
                      </td>
                      <td className={`is-num ${tone(x.net)}`}>{rsSigned(x.net)}</td>
                      <td className="is-num">{x.leftOnTable > 0 ? rs(x.leftOnTable) : "—"}</td>
                      <td className="snp-what">
                        <Chip tone={x.tone}>{(names[x.outcome] || {}).name || x.outcome}</Chip>
                        <small>{x.text}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}

/* --------------------------------------------------------------------------------- learnings */

const STATE = { repeating: "Repeating", new: "New", easing: "Easing", quiet: "Quiet", strength: "Strength", own: "Yours" };
const STATUS = { open: "Open", working: "Working on it", mastered: "Mastered", ignored: "Set aside" };

function since(l) {
  if (!l.lastSeen) return l.source === "own" ? "your own rule" : "—";
  const d = l.daysSince;
  return `${shortDay(l.lastSeen)}${typeof d === "number" ? (d === 0 ? " · latest day" : ` · ${d} recorded day${d === 1 ? "" : "s"} ago`) : ""}`;
}

function LearningRow({ l, busy, onSave, onRemove, onOpenDay }) {
  const [note, setNote] = useState(l.note || "");
  const [open, setOpen] = useState(false);
  useEffect(() => setNote(l.note || ""), [l.note]);
  return (
    <>
      <tr className={`snp-l ${l.relapse ? "is-relapse" : ""} ${l.status === "ignored" ? "is-aside" : ""}`}>
        <th scope="row">
          <button type="button" className="snp-lbtn" onClick={() => setOpen(!open)} aria-expanded={open} disabled={!l.recent.length && !l.rule}>
            <b>{l.title}</b>
          </button>
          <small className="snp-sub">{l.text}</small>
          {l.rule ? (
            <small className="snp-rule">
              <b>{l.kind === "keep" ? "Keep doing: " : "Do instead: "}</b>
              {l.rule}
            </small>
          ) : null}
          {l.relapse && <small className="snp-relapse">Back after you marked it mastered — seen again on {shortDay(l.lastSeen)}.</small>}
        </th>
        <td>
          {typeof l.count === "number" ? (
            <>
              <b>{l.count}×</b>
              <small className="snp-sub">
                on {l.days} day{l.days === 1 ? "" : "s"}
                {l.kind === "avoid" && l.wins ? ` · ${l.wins} still won` : ""}
              </small>
            </>
          ) : (
            <span className="ta-dim">—</span>
          )}
        </td>
        <td className="is-num">
          {typeof l.cost === "number" ? (
            <>
              <b className={l.kind === "keep" ? "is-up" : l.cost > 0 ? "is-down" : ""}>{rs(l.cost)}</b>
              <small className="snp-sub">{l.kind === "keep" ? (l.id === "k:loss-cut" ? "spared" : "made") : "cost"}</small>
            </>
          ) : (
            <span className="ta-dim">—</span>
          )}
        </td>
        <td>
          <Chip tone={l.state === "repeating" ? "bad" : l.state === "strength" ? "good" : l.state === "new" ? "warn" : "flat"}>{STATE[l.state] || l.state}</Chip>
          <small className="snp-sub">{since(l)}</small>
        </td>
        <td>
          <select className="snp-sel" aria-label={`Your status on: ${l.title}`} value={l.status} disabled={busy} onChange={(e) => onSave(l.id, { status: e.target.value })}>
            {Object.entries(STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <input className="snp-note" type="text" maxLength={600} placeholder="your note" aria-label={`Your note on: ${l.title}`} value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (l.note || "") && onSave(l.id, { note })} />
          {l.source === "own" && (
            <button type="button" className="snp-x" disabled={busy} onClick={() => onRemove(l.id)} aria-label={`Remove: ${l.title}`}>
              Remove
            </button>
          )}
        </td>
      </tr>
      {open && l.recent.length > 0 && (
        <tr className="lab-more">
          <td colSpan={5}>
            <p className="ta-dim">The latest times:</p>
            <ul className="snp-recent">
              {l.recent.map((x) => (
                <li key={x.id}>
                  <button type="button" className="snp-link" onClick={() => onOpenDay && onOpenDay(x.date)}>
                    {shortDay(x.date)} {x.clock} · {x.symbol}
                  </button>{" "}
                  <span className={tone(x.net)}>{rsSigned(x.net)}</span>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

function LearningTable({ title, sub, rows, empty, ...rest }) {
  return (
    <section className="ta-card ta-wide">
      <header className="ta-card__h">
        <h3>{title}</h3>
        <small>{sub}</small>
      </header>
      {!rows.length ? (
        <p className="ta-empty">{empty}</p>
      ) : (
        <div className="lab-scroll">
          <table className="ta-table lab-table snp-table snp-table--learn">
            <thead>
              <tr>
                <th scope="col">Learning</th>
                <th scope="col">Seen</th>
                <th scope="col" className="is-num">
                  Cost
                </th>
                <th scope="col">Now</th>
                <th scope="col">Yours</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <LearningRow key={l.id} l={l} {...rest} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function Learnings({ onOpenDay }) {
  const [st, setSt] = useState({ loading: true, r: null, error: "" });
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [rule, setRule] = useState("");
  useEffect(() => {
    api("/api/admin/analysis/learnings")
      .then((r) => setSt({ loading: false, r, error: "" }))
      .catch((e) => setSt({ loading: false, r: null, error: e.message }));
  }, []);
  const act = async (fn) => {
    setBusy(true);
    try {
      const r = await fn();
      setSt({ loading: false, r, error: "" });
      return true;
    } catch (e) {
      setSt((s) => ({ ...s, error: e.message }));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const save = (id, body) => act(() => api(`/api/admin/analysis/learnings/${encodeURIComponent(id)}`, { method: "PUT", body }));
  const remove = (id) => act(() => api(`/api/admin/analysis/learnings/${encodeURIComponent(id)}`, { method: "DELETE" }));
  const add = async (e) => {
    e.preventDefault();
    if (await act(() => api("/api/admin/analysis/learnings", { method: "POST", body: { text, rule } }))) {
      setText("");
      setRule("");
    }
  };
  const r = st.r;
  const avoid = r ? r.learnings.filter((l) => l.kind !== "keep") : [];
  const keep = r ? r.learnings.filter((l) => l.kind === "keep") : [];
  const back = avoid.filter((l) => l.relapse);
  return (
    <>
      {st.loading && !r && <Loading label="Opening the register…" />}
      <Alert>{st.error}</Alert>
      {r && (
        <>
          <p className="ta-dim">
            Counted from {r.trades} recorded trade{r.trades === 1 ? "" : "s"} over {r.days} day{r.days === 1 ? "" : "s"}. Each time a habit costs you, it is counted here with its price and the one rule to follow instead. Mark one <b>Mastered</b> and the desk flags it if it comes back.
          </p>
          {back.length > 0 && (
            <p className="snp-back" role="status">
              <b>Back after you marked it mastered:</b> {back.map((l) => l.title).join(" · ")}
            </p>
          )}
          <LearningTable title="Do not repeat" sub="your costly habits, worst first · yours at the end" rows={avoid} empty="Nothing costly has been recorded yet — the register fills from each day's replay." busy={busy} onSave={save} onRemove={remove} onOpenDay={onOpenDay} />
          <section className="ta-card">
            <header className="ta-card__h">
              <h3>Add a lesson of your own</h3>
              <small>in your words — it sits in the list above</small>
            </header>
            <form className="snp-add" onSubmit={add}>
              <label>
                <span>What I will not repeat</span>
                <input type="text" value={text} maxLength={600} onChange={(e) => setText(e.target.value)} placeholder="e.g. adding to a losing trade after 2 PM" required />
              </label>
              <label>
                <span>What I will do instead (optional)</span>
                <input type="text" value={rule} maxLength={600} onChange={(e) => setRule(e.target.value)} placeholder="e.g. close it at the stop and stop trading for the day" />
              </label>
              <button type="submit" className="adm-btn adm-btn--sm" disabled={busy || text.trim().length < 4}>
                Add lesson
              </button>
            </form>
          </section>
          <LearningTable title="Keep doing" sub="what has been working, counted the same way" rows={keep} empty="Nothing to keep yet: it fills when trades are booked near their best moment or losses are cut in time." busy={busy} onSave={save} onRemove={remove} onOpenDay={onOpenDay} />
        </>
      )}
    </>
  );
}
