// Trade Analysis — the Execution Lab, in four parts:
//   Live board  every open position watched tick by tick by the exit coach (LiveBoard.jsx)
//   A day       every closed intraday trade replayed on that day's 1-minute bars (server/analysis/
//               lab.js): how far it went for you and against you, the share of the best move you
//               kept, the best moment to have left with its time, when the coach would have said
//               EXIT, where you came in, what other exits would have made, the habits that cost money
//   Snapshots   the day as a timeline with a timestamp on every moment — the best moment of each trade and
//               what you did about it, the day's own profit curve (Snapshots.jsx)
//   Outcomes    every trade of every recorded day and what became of its best moment (Snapshots.jsx)
//   Do not repeat  the register of learnings: each costly habit with its price, its rule and your status
//   Robot       the AI paper trader: takes the advisor's calls with play money, flight-records them, is compared
//               with your day, corrects its own mistakes, studies the NIFTY 100's levels (Robot.jsx)
//   Coach       the day against your own history: what to prevent, what to keep (LabExtras.jsx)
//   A period    the days added up, with the lessons in plain words
//
// The daily profit-and-loss reports now live in the Journal's Day book. Everything here is worked out
// by the server by itself (the hourly sweep replays every recent day with trades) — no AI, no
// typing, no orders.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { useTopics } from "../../live";
import { Alert, Loading } from "../../ui";
import { DateField } from "../../DatePicker";
import { HBars, Spark, dayLong, rs, rsSigned, tone } from "./charts";
import LiveBoard from "./LiveBoard";
import { CoachView, ExitTiming, TradeChart, aiLevelsOf, flightOf, useFlightDay } from "./LabExtras";
import { DaySnapshot, Learnings, Outcomes } from "./Snapshots";
import Robot from "./Robot";
import { PageBar, PageHead } from "../../ux/PageKit";
import "./analysis.css";

const IST = 5.5 * 3600 * 1000;
const todayIst = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const PERIODS = [
  { id: "7", label: "7 days", days: 7 },
  { id: "30", label: "30 days", days: 30 },
  { id: "60", label: "60 days", days: 60 },
];
const MODE_KEY = "vpt.lab.mode";
/** Today, or the Friday before it at a weekend. */
const lastWeekday = () => {
  let d = todayIst();
  for (let i = 0; i < 3; i += 1) {
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) break;
    d = addDays(d, -1);
  }
  return d;
};
const pc = (x) => (typeof x === "number" ? `${x > 0 ? "+" : ""}${x.toFixed(2)}%` : "—");
/** "Fri, 13 Nov" — a day in the page bar. */
const dayShort = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const read = (k, d) => {
  try {
    return window.localStorage.getItem(k) || d;
  } catch (_) {
    return d;
  }
};
const keep = (k, v) => {
  try {
    window.localStorage.setItem(k, v);
  } catch (_) {
    /* remembered for this visit only */
  }
};

function Kpi({ label, value, cls = "", sub, tip }) {
  return (
    <div className="ta-kpi" data-tip={tip}>
      <span className="ta-kpi__l">{label}</span>
      <b className={`ta-kpi__v ${cls}`}>{value}</b>
      {sub && <small className="ta-kpi__s">{sub}</small>}
    </div>
  );
}

function ScoreKpi({ score, label }) {
  const cls = typeof score !== "number" ? "" : score >= 75 ? "is-up" : score >= 50 ? "is-warn" : "is-down";
  return <Kpi label="Execution score" value={typeof score === "number" ? `${score} / 100` : "—"} cls={cls} sub={label} tip="70 to start; the share of the move you kept adds or takes up to 20; each costly habit takes 8, each minor one 3; costs over 40% of the gross take 10." />;
}

/** The exit rules replayed on your own entries, against your exits. */
function Rules({ rules, best }) {
  return (
    <section className="ta-card">
      <header className="ta-card__h">
        <h3>Other exits on the same entries</h3>
        <small>after the same charges · a stop and a target in one minute counts as the stop</small>
      </header>
      <div className="lab-scroll">
        <table className="ta-table lab-table">
          <thead>
            <tr>
              <th scope="col">Exit rule</th>
              <th scope="col" className="is-num">
                Trades
              </th>
              <th scope="col" className="is-num">
                Net
              </th>
              <th scope="col" className="is-num">
                Against yours
              </th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className={best && best.id === r.id ? "is-best" : r.id === "actual" ? "is-yours" : ""}>
                <th scope="row">
                  {r.name}
                  {best && best.id === r.id ? <small> · best</small> : null}
                </th>
                <td className="is-num">{r.trades}</td>
                <td className={`is-num ${tone(r.net)}`}>{rsSigned(r.net)}</td>
                <td className={`is-num ${r.id === "actual" ? "" : tone(r.vsActual)}`}>{r.id === "actual" ? "—" : rsSigned(r.vsActual)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Habits({ flags, empty }) {
  return (
    <section className="ta-card">
      <header className="ta-card__h">
        <h3>Habits that showed</h3>
        <small>trades flagged · their net</small>
      </header>
      {!flags.length ? (
        <p className="ta-empty">{empty}</p>
      ) : (
        <ul className="lab-flags">
          {flags.map((f) => (
            <li key={f.id} className={f.major ? "is-major" : ""}>
              <span className="lab-flag__n">
                <b>{f.name}</b> <small>× {f.count}</small>
              </span>
              <span className={`lab-flag__v ${tone(f.net)}`}>{rsSigned(f.net)}</span>
              <small className="lab-flag__t">{f.text}</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A trade's run: how far against (left, red) and for (right, green) it went, and where it closed. */
function RunBar({ t }) {
  const r = t.read;
  if (!r || typeof r.mfePct !== "number") return <span className="ta-dim">—</span>;
  const span = Math.max(0.5, r.mfePct, -r.maePct);
  const closePct = (t.side === "long" ? t.exitAvg - t.entryAvg : t.entryAvg - t.exitAvg) / t.entryAvg * 100;
  const pos = (x) => `${50 + (Math.max(-span, Math.min(span, x)) / span) * 50}%`;
  return (
    <span className="lab-run" role="img" aria-label={`Went ${r.maePct}% against and ${r.mfePct}% for; closed ${pc(closePct)}`} title={`Against ${r.maePct}% · for +${r.mfePct}% · closed ${pc(closePct)}`}>
      <i className="lab-run__adv" style={{ left: pos(r.maePct), right: "50%" }} />
      <i className="lab-run__fav" style={{ left: "50%", right: `${100 - parseFloat(pos(r.mfePct))}%` }} />
      <i className="lab-run__x" style={{ left: pos(closePct) }} />
    </span>
  );
}

const FLAG_SHORT = { revenge: "revenge", afterStop: "after stop", afterTarget: "after target", overtrading: "over-trading", heldLoser: "held loser", cutWinner: "cut winner", firstMinutes: "first 5 min", late: "late", againstVwap: "vs VWAP", chased: "chased", costs: "costs" };

function Trades({ trades, flights = [] }) {
  const [open, setOpen] = useState("");
  return (
    <section className="ta-card ta-wide">
      <header className="ta-card__h">
        <h3>Every trade, replayed</h3>
        <small>bar: how far it went against you (red) and for you (green); the mark is where you closed</small>
      </header>
      <div className="lab-scroll">
        <table className="ta-table lab-table">
          <thead>
            <tr>
              <th scope="col">Trade</th>
              <th scope="col" className="is-num">
                Net
              </th>
              <th scope="col">Run</th>
              <th scope="col" className="is-num" data-tip="Your profit as a share of the best move while you were in (MFE).">
                Kept
              </th>
              <th scope="col" className="is-num" data-tip="How much further the price went your way after you left, up to the square-off.">
                Ran on
              </th>
              <th scope="col">Entry</th>
              <th scope="col">Habits</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => (
              <React.Fragment key={t.key}>
                <tr className={open === t.key ? "is-open" : ""}>
                  <th scope="row">
                    <button type="button" className="lab-trade" onClick={() => setOpen(open === t.key ? "" : t.key)} aria-expanded={open === t.key}>
                      <b>
                        {t.side === "long" ? "▲" : "▼"} {t.symbol}
                      </b>
                      <small>
                        {t.entryClock}–{t.exitClock} · {t.qty} @ {t.entryAvg} → {t.exitAvg}
                      </small>
                    </button>
                  </th>
                  <td className={`is-num ${tone(t.net)}`}>{rsSigned(t.net)}</td>
                  <td>
                    <RunBar t={t} />
                  </td>
                  <td className="is-num">{t.read && typeof t.read.capture === "number" ? `${t.read.capture}%` : "—"}</td>
                  <td className="is-num">{t.read && typeof t.read.ranOn === "number" ? rs(t.read.ranOn) : "—"}</td>
                  <td>
                    {t.read ? (
                      <small className="lab-ctx">
                        {typeof t.read.vsVwapPct === "number" ? `${pc(t.read.vsVwapPct)} vs VWAP` : ""}
                        {t.read.opening ? ` · ${t.read.opening}` : ""}
                        {typeof t.read.rangePos === "number" ? ` · at ${t.read.rangePos}% of the day's range` : ""}
                      </small>
                    ) : (
                      <small className="ta-dim">{t.intraday ? "no bars" : "held overnight"}</small>
                    )}
                  </td>
                  <td>
                    <span className="lab-chips">
                      {t.flags.map((f) => (
                        <span key={f} className="lab-chip">
                          {FLAG_SHORT[f] || f}
                        </span>
                      ))}
                    </span>
                  </td>
                </tr>
                {open === t.key && (
                  <tr className="lab-more">
                    <td colSpan={7}>
                      {t.read && <TradeChart t={t} flight={flightOf(flights, t)} />}
                      {Object.keys(t.whatIf || {}).length ? (
                        <ul className="lab-whatif">
                          {Object.entries(t.whatIf).map(([id, w]) => (
                            <li key={id}>
                              <b>{{ fixed: "Stop 0.5% · target 1%", trail: "Trailing 0.5%", breakeven: "Break-even stop", close: "Hold to the square-off", coach: "The exit coach" }[id] || id}</b> — out at {w.exit} ({w.how}) · <span className={tone(w.net)}>{rsSigned(w.net)}</span>
                              <small> ({rsSigned(w.net - t.net)} against yours)</small>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="ta-dim">No replay for this trade.</p>
                      )}
                      {t.read && typeof t.read.mfe === "number" && (
                        <p className="ta-dim">
                          Best while in: {rsSigned(t.read.mfe)} ({pc(t.read.mfePct)}) · worst: {rsSigned(t.read.mae)} ({pc(t.read.maePct)}) · held {t.holdMin} min{typeof t.read.avoided === "number" && t.read.avoided > 0 ? ` · leaving spared you up to ${rs(t.read.avoided)}` : ""}
                        </p>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DayLab({ date, setDate }) {
  const [st, setSt] = useState({ loading: true, lab: null, error: "" });
  const load = useCallback(
    (refresh = false, quiet = false) => {
      if (!quiet) setSt((s) => ({ ...s, loading: true, error: "" }));
      return api(`/api/admin/analysis/lab/${date}${refresh ? "?refresh=1" : ""}`)
        .then((lab) => setSt({ loading: false, lab, error: "" }))
        .catch((e) => setSt((s) => (quiet ? { ...s, loading: false } : { loading: false, lab: null, error: e.message })));
    },
    [date]
  );
  useEffect(() => {
    load();
  }, [load]);
  // a trade filled, a position closed or a report saved anywhere: the day is read again at once, quietly
  useTopics(["analysis", "trading"], () => load(false, true));
  const l = st.lab;
  const { flights, record } = useFlightDay(date);
  const ai = aiLevelsOf(flights);
  return (
    <>
      <div className="lab-bar">
        <DateField value={date} max={todayIst()} onChange={setDate} label="Day" />
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={st.loading} onClick={() => load(true)} data-tip="Replay the day again from Zerodha's 1-minute bars (it is kept once worked out).">
          {st.loading ? "Replaying…" : "↻ Replay again"}
        </button>
      </div>
      {st.loading && !l && <Loading label="Replaying the day…" />}
      <Alert>{st.error}</Alert>
      {l && !l.available && <p className="ta-empty">{l.reason}</p>}
      {l && l.available && (
        <>
          <p className="ta-dim">{dayLong(l.date)}</p>
          <div className="ta-kpis">
            <ScoreKpi score={l.summary.score} label={l.summary.label} />
            <Kpi label="Net after charges" value={rsSigned(l.summary.net)} cls={tone(l.summary.net)} sub={`${l.summary.trades} trade${l.summary.trades === 1 ? "" : "s"} · gross ${rsSigned(l.summary.gross)} · charges ${rs(l.summary.charges)}`} />
            <Kpi label="Share of the move kept" value={typeof l.summary.capture === "number" ? `${l.summary.capture}%` : "—"} sub="your profit ÷ the best move while in" tip="All replayed trades together: the profit you took against the most the price offered while you were in (MFE)." />
            <Kpi label="Ran on after your exits" value={rs(l.summary.ranOn)} sub={`leaving spared you up to ${rs(l.summary.avoided)}`} tip="How much further the price went your way after each exit, up to the square-off — and how far it went against you (what leaving spared you)." />
            <Kpi label="Best other exit" value={l.best ? rsSigned(l.best.vsActual) : "—"} cls={l.best ? tone(l.best.vsActual) : ""} sub={l.best ? l.best.name : "no replay"} />
            <Kpi label="Exit efficiency" value={typeof l.summary.efficiency === "number" ? `${l.summary.efficiency}%` : "—"} sub={typeof l.summary.bestPossible === "number" ? `of ${rs(l.summary.bestPossible)} on offer · ${rs(l.summary.leftOnTable)} left` : "no replay"} tip="Your profit as a share of the most that was on offer while you were in each trade (hindsight's ceiling)." />
            <Kpi label="Exit timing" value={`${l.summary.late || 0} late · ${l.summary.onTime || 0} on time`} sub={typeof l.summary.avgGapMin === "number" ? `on average ${l.summary.avgGapMin} min after the best moment${l.summary.early ? ` · ${l.summary.early} left before a bigger move` : ""}` : ""} tip="Late: you stayed more than two minutes past the trade's best moment." />
            <Kpi label="The coach against you" value={typeof l.summary.coachVsYours === "number" ? rsSigned(l.summary.coachVsYours) : "—"} cls={tone(l.summary.coachVsYours)} sub="the same entries closed at the coach's EXIT NOW" tip="What the day would have made had every trade been closed where the exit coach, replayed on the bars, first said EXIT NOW (or at the square-off)." />
            {ai.given > 0 && <Kpi label="The AI's exit levels" value={ai.sets ? `${ai.reached} of ${ai.sets} reached` : "not scored yet"} sub={ai.sets ? `first target before the stop · the stop came first on ${ai.stopped}` : "scored after the close, on the day's bars"} tip={record && record.judged ? `All days: ${record.text}` : "Each set of levels the AI researched live is scored after the close on the day's 1-minute bars: which came first, its first target or its stop."} />}
          </div>
          <ExitTiming trades={l.trades} />
          <div className="lab-grid">
            <Rules rules={l.rules} best={l.best} />
            <Habits flags={l.flags} empty="No costly habit showed on this day." />
          </div>
          <Trades trades={l.trades} flights={flights} />
          {flights.length > 0 && <p className="ta-dim">The flight deck recorded {flights.length} position{flights.length === 1 ? "" : "s"} on this day (a frame every 15 seconds, every signal and alert): open a trade to see the signals as they were given live.</p>}
          {l.limits && (
            <p className="ta-dim">
              The day&rsquo;s limits from your daily goal: stop {rs(l.limits.stop)}, target {rs(l.limits.target)}.
            </p>
          )}
          {(l.notes || []).map((n) => (
            <p key={n} className="ta-dim">
              {n}
            </p>
          ))}
        </>
      )}
    </>
  );
}

function PeriodLab() {
  const [p, setP] = useState(() => read("vpt.lab.period", "30"));
  const [st, setSt] = useState({ loading: true, r: null, error: "" });
  const bounds = useMemo(() => {
    const per = PERIODS.find((x) => x.id === p) || PERIODS[1];
    return { from: addDays(todayIst(), -(per.days - 1)), to: todayIst() };
  }, [p]);
  useEffect(() => {
    setSt((s) => ({ ...s, loading: true }));
    api(`/api/admin/analysis/lab?from=${bounds.from}&to=${bounds.to}`)
      .then((r) => setSt({ loading: false, r, error: "" }))
      .catch((e) => setSt({ loading: false, r: null, error: e.message }));
  }, [bounds]);
  const r = st.r;
  return (
    <>
      <div className="lab-bar">
        <div className="ta-seg" role="group" aria-label="Period">
          {PERIODS.map((x) => (
            <button
              key={x.id}
              type="button"
              aria-pressed={p === x.id}
              onClick={() => {
                setP(x.id);
                keep("vpt.lab.period", x.id);
              }}
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>
      {st.loading && !r && <Loading label="Adding up the days…" />}
      <Alert>{st.error}</Alert>
      {r && !r.days && <p className="ta-empty">No day in this period has been replayed yet. The server replays every recent day with trades by itself within the hour; or open a day above.</p>}
      {r && r.days > 0 && (
        <>
          <div className="ta-kpis">
            <ScoreKpi score={r.summary.score} label={`average of ${r.days} day${r.days === 1 ? "" : "s"}`} />
            <Kpi label="Net after charges" value={rsSigned(r.summary.net)} cls={tone(r.summary.net)} sub={`${r.summary.trades} trades · charges ${rs(r.summary.charges)}`} />
            <Kpi label="Share of the move kept" value={typeof r.summary.capture === "number" ? `${r.summary.capture}%` : "—"} sub={`${r.summary.replayed} trades replayed`} />
            <Kpi label="Ran on after your exits" value={rs(r.summary.ranOn)} sub={`spared up to ${rs(r.summary.avoided)}`} />
            <Kpi label="Exit efficiency" value={typeof r.summary.efficiency === "number" ? `${r.summary.efficiency}%` : "—"} sub={typeof r.summary.leftOnTable === "number" ? `${rs(r.summary.leftOnTable)} left on the table · ${r.summary.late || 0} exits late` : ""} tip="Your profit as a share of the most that was on offer while you were in each trade." />
            <Kpi label="The coach against you" value={typeof r.summary.coachVsYours === "number" ? rsSigned(r.summary.coachVsYours) : "—"} cls={tone(r.summary.coachVsYours)} sub="the same entries closed at the coach's EXIT NOW" />
            <div className="ta-kpi">
              <span className="ta-kpi__l">Score, day by day</span>
              <Spark values={r.trend.map((x) => x.score)} c="b" />
            </div>
            <div className="ta-kpi">
              <span className="ta-kpi__l">Exit efficiency, day by day</span>
              <Spark values={r.trend.map((x) => x.efficiency)} c="a" />
            </div>
          </div>
          {r.lessons.length > 0 && (
            <section className="ta-card lab-lessons">
              <header className="ta-card__h">
                <h3>What your own trades say</h3>
                <small>measured on your fills and Zerodha&rsquo;s bars — no AI</small>
              </header>
              <ul>
                {r.lessons.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </section>
          )}
          <div className="lab-grid">
            <Rules rules={r.rules} best={r.best} />
            <Habits flags={r.flags} empty="No costly habit showed in this period." />
          </div>
          <div className="lab-grid">
            <section className="ta-card">
              <header className="ta-card__h">
                <h3>Net by the hour you came in</h3>
              </header>
              <HBars rows={r.byHour.map((h) => ({ label: `${h.label} · ${h.trades}`, value: h.net }))} />
            </section>
            <section className="ta-card">
              <header className="ta-card__h">
                <h3>Net by how you came in</h3>
              </header>
              <HBars rows={r.context.map((c) => ({ label: `${c.name} · ${c.trades}`, value: c.net }))} />
            </section>
          </div>
        </>
      )}
    </>
  );
}

/** NSE hours on a weekday (IST): the Live board is the first thing shown while the market is open. */
const marketOpenNow = () => {
  const d = new Date(Date.now() + IST);
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  return d.getUTCDay() >= 1 && d.getUTCDay() <= 5 && m >= 555 && m <= 930;
};
const PARTS = [
  { id: "live", label: "Live board", tip: "Every open position, tick by tick: HOLD, TIGHTEN, BOOK PART or EXIT NOW, with the price." },
  { id: "day", label: "A day", tip: "The day replayed: the best moment to have left each trade, with its time." },
  { id: "snap", label: "Snapshots", tip: "The day as a timeline: the time of each trade's best moment, whether you booked it, and the day's own profit curve." },
  { id: "outcomes", label: "Outcomes", tip: "Every trade, every day, and what became of its best moment: booked, given back, left early, never paid." },
  { id: "learn", label: "Don't repeat", tip: "The register of costly habits: how often, what each cost, the rule to follow, and your own status on each." },
  { id: "robot", label: "Robot", tip: "The AI paper trader: it takes the advisor's calls with play money, records every frame, is compared with your day after the close, corrects its own mistakes and learns the NIFTY 100's levels." },
  { id: "coach", label: "Coach", tip: "The day against your own history: what to prevent and what to keep." },
  { id: "period", label: "A period", tip: "The days added up, with the lessons." },
];

export default function TradeAnalysis() {
  const [mode, setMode] = useState(() => {
    if (marketOpenNow()) return "live";
    const m = read(MODE_KEY, "live");
    return PARTS.some((p) => p.id === m) ? m : "live";
  });
  const [date, setDate] = useState(null);
  // the last 60 days as read on opening (to find the day to open on): also the page bar's headline figures
  const [recent, setRecent] = useState(null);
  // open on the latest day with trades: the newest replayed day or the Day book's newest day, else the last weekday
  useEffect(() => {
    let on = true;
    const from = addDays(todayIst(), -59);
    Promise.all([api(`/api/admin/analysis/lab?from=${from}&to=${todayIst()}`).catch(() => null), api("/api/admin/analysis/days").catch(() => null)]).then(([lab, days]) => {
      if (!on) return;
      const a = lab && lab.trend && lab.trend.length ? lab.trend[lab.trend.length - 1].date : "";
      const b = days && days.days && days.days[0] ? days.days[0].date : "";
      setDate([a, b].filter(Boolean).sort().pop() || lastWeekday());
      if (lab && typeof lab.days === "number") setRecent({ at: Date.now(), lab });
    });
    return () => {
      on = false;
    };
  }, []);
  const pick = (m) => {
    setMode(m);
    keep(MODE_KEY, m);
  };
  // the page bar (the eight parts of the lab and the headline figures) stays on screen; the part's own bar (its day,
  // its filters) stays right under it, so the bar's height is written where the layout can read it (--ta-head-h) —
  // on opening, on a new part, when the figures arrive and on a resize
  const root = useRef(null);
  useEffect(() => {
    const set = () => {
      const el = root.current;
      const bar = el ? Array.from(el.children).find((c) => c.classList.contains("wk-bar")) : null;
      if (bar) el.style.setProperty("--ta-head-h", `${Math.round(bar.offsetHeight)}px`);
    };
    set();
    const t = setTimeout(set, 400);
    window.addEventListener("resize", set);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", set);
    };
  }, [mode, recent]);
  // a trade or a learning opens its day's snapshot
  const openDay = (d) => {
    setDate(d);
    pick("snap");
  };
  const shown = PARTS.find((p) => p.id === mode) || PARTS[0];
  const r60 = recent ? recent.lab : null;
  const s60 = r60 && r60.days > 0 && r60.summary ? r60.summary : null;
  const score = s60 && typeof s60.score === "number" ? s60.score : null;
  return (
    <div className="ta lab" ref={root}>
      {/* the head keeps its ta-head name so the row of jumps still leaves it out (StockReport's PAGE_JUMPS) */}
      <PageHead
        className="ta-head"
        title="Trade Analysis — Execution Lab"
        text={
          <>
            Your trading&rsquo;s flight recorder. While you are in a trade the <b>Live board</b> says when to leave, tick by tick; after the close every trade is replayed on Zerodha&rsquo;s 1-minute bars — the best moment to have left with its time, where you came in, the habits that cost money — and
            the <b>Coach</b> sets the day against your own history. <b>Snapshots</b> keep each day as a timeline with a timestamp on every moment, <b>Outcomes</b> tabulate what became of every best moment, and <b>Don&rsquo;t repeat</b> counts the habits that cost you. Daily profit-and-loss reports are in the Journal&rsquo;s <b>Day book</b>.
          </>
        }
      />
      <PageBar
        label={shown.label}
        labelTitle="Part"
        kpis={[
          { label: "Lab day", value: date ? dayShort(date) : "—", tip: "The day A day, Snapshots and the Coach open on: the newest day with trades (pick another in the part)." },
          { label: "Score · 60 days", value: score !== null ? `${score}/100` : "—", tone: score === null ? "" : score >= 75 ? "up" : score >= 50 ? "warn" : "down", tip: r60 ? `The average execution score of the ${r60.days} day${r60.days === 1 ? "" : "s"} replayed in the last 60 days (A period → 60 days).` : "No day of the last 60 has been replayed yet." },
          { label: "Net · 60 days", value: s60 ? rsSigned(s60.net) : "—", tone: s60 ? (s60.net > 0 ? "up" : s60.net < 0 ? "down" : "") : "", tip: s60 ? `${s60.trades} trade${s60.trades === 1 ? "" : "s"}, after ${rs(s60.charges)} of charges.` : undefined },
          { label: "Exit efficiency", value: s60 && typeof s60.efficiency === "number" ? `${s60.efficiency}%` : "—", more: true, tip: "Your profit as a share of the most that was on offer while you were in each trade, over the last 60 days." },
          { label: "Days replayed", value: r60 ? String(r60.days) : "—", more: true, tip: "Days with trades in the last 60 that the server has replayed on 1-minute bars (it does so by itself within the hour)." },
        ]}
        tabs={PARTS}
        tab={mode}
        onTab={pick}
        updatedAt={recent ? recent.at : null}
        tabsLabel="Execution Lab"
      />
      {mode === "live" && <LiveBoard onReplay={() => pick("day")} />}
      {mode === "day" && (date ? <DayLab key={date} date={date} setDate={setDate} /> : <Loading label="Opening the lab…" />)}
      {mode === "snap" && (date ? <DaySnapshot key={date} date={date} setDate={setDate} /> : <Loading label="Opening the snapshots…" />)}
      {mode === "outcomes" && <Outcomes onOpenDay={openDay} />}
      {mode === "learn" && <Learnings onOpenDay={openDay} />}
      {mode === "robot" && <Robot />}
      {mode === "coach" &&
        (date ? (
          <>
            <div className="lab-bar">
              <DateField value={date} max={todayIst()} onChange={setDate} label="Day" />
            </div>
            <CoachView key={date} date={date} />
          </>
        ) : (
          <Loading label="Opening the coach…" />
        ))}
      {mode === "period" && <PeriodLab />}
      <p className="ta-dim ta-foot">A replay of the past on 1-minute bars (Zerodha keeps about 60 days of them): it measures how trades were handled; it does not predict the next one and is not advice. Charges are the journal&rsquo;s estimate.</p>
    </div>
  );
}
