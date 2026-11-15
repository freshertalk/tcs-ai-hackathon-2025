// The Execution Lab's replay extras:
//   ExitTiming   for every trade of a day — when you left, the best moment to have left while you were
//                in (the least loss when it never paid), the best up to 3:15 PM, and when the exit
//                coach would have said EXIT NOW, each with its time, price and P&L
//   TradeChart   one trade's price path with those moments marked, and the coach's signals in order
//                (from the day's recording when the flight deck was watching, else replayed on bars),
//                and the exit levels the AI researched for it, scored on the day's 1-minute bars
//   CoachView    the day against your own history: what to prevent, what to keep, the days and the
//                trades most like it
// Everything comes from the server's arithmetic (analysis/lab.js, analysis/compare.js, flight.js): no AI
// is asked here — the AI's levels were given live and are only read back, with their score.

import React, { useEffect, useState } from "react";
import { api } from "../../api";
import { Alert, Loading } from "../../ui";
import { rs, rsSigned, tone } from "./charts";
import "./flight.css";

const px = (x) => (typeof x === "number" ? x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
const WORD = { hold: "HOLD", tighten: "TIGHTEN", "book-part": "BOOK PART", "exit-now": "EXIT NOW" };
const clockOf = (ms) => new Date(ms + 5.5 * 3600 * 1000).toISOString().slice(11, 16);

function When({ x, label }) {
  if (!x) return <span className="ta-dim">—</span>;
  return (
    <span className="lx-when">
      <b>{x.clock}</b> · ₹{px(x.price)}
      <small className={tone(x.pnl)}>
        {rsSigned(x.pnl)}
        {label ? ` · ${label}` : ""}
      </small>
    </span>
  );
}

/** When you left, against the best moment and the coach — for every trade of the day. */
export function ExitTiming({ trades }) {
  const rows = trades.filter((t) => t.read && t.read.bestExit);
  if (!rows.length) return null;
  return (
    <section className="ta-card ta-wide">
      <header className="ta-card__h">
        <h3>The best time to have left — trade by trade</h3>
        <small>from 1-minute bars; before charges; “best” is hindsight — the ceiling, not a target</small>
      </header>
      <div className="lab-scroll">
        <table className="ta-table lab-table">
          <thead>
            <tr>
              <th scope="col">Trade</th>
              <th scope="col">You left</th>
              <th scope="col" data-tip="The moment the position was worth most while you held it. When the trade never paid, this is where the loss was smallest.">
                Best while you were in
              </th>
              <th scope="col" data-tip="Minutes you stayed after the best moment.">
                Gap
              </th>
              <th scope="col" data-tip="The best moment from your entry to 3:15 PM, had you stayed.">
                Best up to 3:15
              </th>
              <th scope="col" data-tip="When the desk's exit coach, replayed on the same bars, first said EXIT NOW.">
                The coach said EXIT
              </th>
              <th scope="col" className="is-num" data-tip="Your profit as a share of the best that was on offer while you were in.">
                Efficiency
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const r = t.read;
              const gap = r.timing.gapMin;
              return (
                <tr key={t.key}>
                  <th scope="row">
                    {t.side === "long" ? "▲" : "▼"} {t.symbol}
                    <small>
                      {" "}
                      in {t.entryClock} · {t.qty} @ ₹{px(t.entryAvg)}
                    </small>
                  </th>
                  <td>
                    <When x={{ clock: t.exitClock, price: t.exitAvg, pnl: t.pnl }} />
                  </td>
                  <td>
                    <When x={r.bestExit} label={r.bestExit.kind === "least-loss" ? "the least loss" : ""} />
                  </td>
                  <td>
                    <span className={`lx-gap ${gap > 2 ? "is-late" : "is-ok"}`}>{gap > 2 ? `${gap} min late` : "on time"}</span>
                    {r.timing.leftOnTable > 0 && <small className="ta-dim"> · {rs(r.timing.leftOnTable)} left</small>}
                  </td>
                  <td>
                    <When x={r.bestExitDay} />
                  </td>
                  <td>{r.coach ? <When x={r.coach.exit} label={r.coach.exit.said ? `${rsSigned(r.coach.vsYours)} against yours` : "no EXIT before 3:15"} /> : <span className="ta-dim">—</span>}</td>
                  <td className="is-num">{typeof r.timing.efficiency === "number" ? `${r.timing.efficiency}%` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** One trade's path with the entry, your exit, the best moment and the coach's exit marked. */
export function TradeChart({ t, flight }) {
  const r = t.read;
  const pts = (r && r.path) || [];
  if (pts.length < 2) return null;
  const W = 640;
  const H = 180;
  const lo = Math.min(...pts.map((p) => p[1]), t.entryAvg);
  const hi = Math.max(...pts.map((p) => p[1]), t.entryAvg);
  const pad = (hi - lo) * 0.1 || 1;
  const t0 = pts[0][0];
  const t1 = pts[pts.length - 1][0];
  const X = (ms) => (Math.max(0, Math.min(1, (ms - t0) / Math.max(1, t1 - t0)))) * W;
  const Y = (v) => H - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * H;
  const d = pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ");
  const mark = (ms, cls, label, row) => (
    <g key={cls} className={`lx-mark lx-mark--${cls}`}>
      <line x1={X(ms)} x2={X(ms)} y1="0" y2={H} />
      <text x={Math.min(W - 4, X(ms) + 4)} y={12 + row * 12}>
        {label}
      </text>
    </g>
  );
  const coach = r.coach && r.coach.exit && r.coach.exit.said ? r.coach.exit : null;
  const aiSet = flight && flight.levels ? flight.levels.filter((x) => !x.failed && x.targets.length)[0] : null;
  const aiLine = aiSet && aiSet.targets[0].level >= lo - pad && aiSet.targets[0].level <= hi + pad ? aiSet.targets[0].level : null;
  const signals = flight && flight.events ? flight.events.filter((e) => e.kind === "signal") : r.coach ? r.coach.changes.map((c) => ({ ...c, at: c.at, clock: c.clock, state: c.state, text: c.why })) : [];
  return (
    <div>
      <svg className="lx-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${t.symbol}: in ${t.entryClock} at ${px(t.entryAvg)}, out ${t.exitClock} at ${px(t.exitAvg)}; best moment ${r.bestExit ? r.bestExit.clock : "—"}${coach ? `; the coach's exit ${coach.clock}` : ""}`}>
        <rect className="lx-held" x={X(t.entryAt)} y="0" width={Math.max(1, X(t.exitAt) - X(t.entryAt))} height={H} />
        <line className="lx-entryline" x1="0" x2={W} y1={Y(t.entryAvg)} y2={Y(t.entryAvg)} />
        <path className="lx-line" d={d} />
        {mark(t.entryAt, "in", "IN", 0)}
        {mark(t.exitAt, "out", "YOU", 1)}
        {r.bestExit && mark(r.bestExit.at, "best", "BEST", 2)}
        {coach && mark(coach.at, "coach", "COACH", 3)}
        {aiLine !== null && (
          <g className="lx-mark lx-mark--ai">
            <line x1="0" x2={W} y1={Y(aiLine)} y2={Y(aiLine)} />
            <text x="4" y={Y(aiLine) - 3}>
              AI target {px(aiLine)}
            </text>
          </g>
        )}
      </svg>
      <ul className="lx-legend">
        <li className="is-in">
          <i />
          In <b>{t.entryClock}</b> at ₹{px(t.entryAvg)}
        </li>
        <li className="is-out">
          <i />
          You left <b>{t.exitClock}</b> at ₹{px(t.exitAvg)} ({rsSigned(t.pnl)})
        </li>
        {r.bestExit && (
          <li className="is-best">
            <i />
            {r.bestExit.kind === "least-loss" ? "Least loss" : "Best"} <b>{r.bestExit.clock}</b> at ₹{px(r.bestExit.price)} ({rsSigned(r.bestExit.pnl)})
          </li>
        )}
        {coach && (
          <li className="is-coach">
            <i />
            Coach&rsquo;s EXIT <b>{coach.clock}</b> at ₹{px(coach.price)} ({rsSigned(coach.pnl)})
          </li>
        )}
        {r.bestExitDay && r.bestExitDay.at > t.exitAt && (
          <li>
            Up to 3:15 the best was <b>{r.bestExitDay.clock}</b> at ₹{px(r.bestExitDay.price)} ({rsSigned(r.bestExitDay.pnl)})
          </li>
        )}
        {r.worst && (
          <li>
            Worst while in <b>{r.worst.clock}</b> ({rsSigned(r.worst.pnl)})
          </li>
        )}
      </ul>
      {signals.length > 0 && (
        <>
          <p className="ta-dim" style={{ margin: "8px 0 0" }}>
            {flight ? "The coach's signals as recorded live:" : "The coach's signals, replayed on the bars (no order book in the past):"}
          </p>
          <ol className="lx-signals">
            {signals.slice(0, 14).map((s) => (
              <li key={`${s.at}${s.state}`} className={`is-${s.state}`} title={s.text || ""}>
                {s.clock || clockOf(s.at)} {WORD[s.state] || s.state}
              </li>
            ))}
          </ol>
        </>
      )}
      <AiLevels flight={flight} t={t} />
    </div>
  );
}

/** How one set of the AI's levels turned out on the day's bars, in words. */
function outcomeOf(set, t) {
  const o = set.outcome;
  if (!o) return "not scored yet (each set is scored after the close)";
  const after = (ms) => (typeof ms === "number" && ms > t.exitAt ? ` — ${Math.round((ms - t.exitAt) / 60000)} min after you left` : "");
  const one = (n, word, clock, ms) => (word === "reached" ? `target ${n} reached at ${clock}${after(ms)}` : word === "stopped" ? `target ${n} not reached before the stop` : word === "neither" ? `target ${n} not reached by the close` : "");
  const parts = [one(1, o.t1, o.t1Clock, o.t1At), one(2, o.t2, o.t2Clock, o.t2At)].filter(Boolean);
  if (o.stop === "hit") parts.push(`its stop was broken at ${o.stopClock}`);
  return parts.join("; ") || "nothing to score";
}

/** The exit levels the AI researched for one recorded trade, with what became of each set. */
function AiLevels({ flight, t }) {
  const sets = (flight && flight.levels) || [];
  if (!sets.length) return null;
  return (
    <>
      <p className="ta-dim" style={{ margin: "8px 0 0" }}>
        The AI&rsquo;s exit levels as given live (each one chosen from the desk&rsquo;s level map and checked against it), scored on the day&rsquo;s 1-minute bars:
      </p>
      <ul className="lx-ai">
        {sets.slice(-6).map((x) => (
          <li key={x.id} className={x.outcome ? (x.outcome.t1 === "reached" ? "is-reached" : x.outcome.t1 === "stopped" ? "is-stopped" : "") : ""}>
            <b>{x.clock}</b> {x.by}:{" "}
            {x.failed
              ? "none of its targets passed the desk's check."
              : `${x.targets.map((g) => `target ${g.n} ₹${px(g.level)} (${g.label})`).join(", ")}${x.stop ? `, stop ₹${px(x.stop.price)}` : ""} — ${outcomeOf(x, t)}.`}
          </li>
        ))}
      </ul>
    </>
  );
}

/** The recorded flights of a day (the CCTV), keyed for matching to the journal's trades. */
export function useFlightDay(date) {
  const [st, setSt] = useState({ flights: [], record: null });
  useEffect(() => {
    let on = true;
    setSt({ flights: [], record: null });
    if (!date) return undefined;
    api(`/api/admin/flight/day/${date}`)
      .then((d) => on && setSt({ flights: d && d.available ? d.flights : [], record: (d && d.levelsRecord) || null }))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [date]);
  return st;
}
export const useFlights = (date) => useFlightDay(date).flights;
/** The day's sets of AI levels that have been scored: how many first targets came before the stop. */
export function aiLevelsOf(flights) {
  const sets = flights.flatMap((f) => (f.levels || []).filter((x) => x && !x.failed && x.outcome && x.outcome.t1));
  return { sets: sets.length, reached: sets.filter((x) => x.outcome.t1 === "reached").length, stopped: sets.filter((x) => x.outcome.t1 === "stopped").length, given: flights.reduce((a, f) => a + (f.levels || []).length, 0) };
}
/** The recording of one trade: the same stock, entered within three minutes. */
export const flightOf = (flights, t) => flights.find((f) => f.symbol === t.symbol && f.side === t.side && Math.abs(f.entryAt - t.entryAt) <= 3 * 60000) || null;

const fmt = (v, unit) => (typeof v !== "number" ? "—" : unit === "₹" ? rsSigned(v) : `${Math.round(v * 10) / 10}${unit}`);

/** The day against your own history. */
export function CoachView({ date }) {
  const [st, setSt] = useState({ loading: true, c: null, error: "" });
  useEffect(() => {
    let on = true;
    setSt({ loading: true, c: null, error: "" });
    api(`/api/admin/analysis/compare/${date}`)
      .then((c) => on && setSt({ loading: false, c, error: "" }))
      .catch((e) => on && setSt({ loading: false, c: null, error: e.message }));
    return () => {
      on = false;
    };
  }, [date]);
  const c = st.c;
  if (st.loading) return <Loading label="Comparing with your earlier days…" />;
  if (st.error) return <Alert>{st.error}</Alert>;
  if (!c || !c.available) return <p className="ta-empty">{(c && c.reason) || "Nothing to compare on this day."}</p>;
  return (
    <>
      <section className="ta-card">
        <p className="cx-head">{c.headline}</p>
        {!c.enough && <p className="ta-dim">Every trading day is replayed by itself; the comparison fills in as the days add up.</p>}
      </section>

      <div className="lab-grid">
        <section className="ta-card">
          <header className="ta-card__h">
            <h3>To prevent</h3>
            <small>habits that cost money — seen today, or coming back</small>
          </header>
          {c.prevent.length === 0 ? (
            <p className="ta-empty">No costly habit today, and none that keeps coming back.</p>
          ) : (
            <ul className="cx-cards">
              {c.prevent.map((p) => (
                <li key={p.id} className={`cx-card ${p.major ? "is-major" : ""}`}>
                  <h4>
                    {p.habit}
                    <span className={`cx-tag is-${p.kind}`}>{p.kind === "again" ? "again today" : p.kind === "new" ? "new today" : "keeps coming back"}</span>
                    {p.today && (
                      <small>
                        today × {p.today.count}: <span className={tone(p.today.net)}>{rsSigned(p.today.net)}</span>
                      </small>
                    )}
                  </h4>
                  <p>
                    {p.what} {p.evidence}
                  </p>
                  <p className="cx-rule">→ {p.action}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="ta-card">
          <header className="ta-card__h">
            <h3>To keep doing</h3>
            <small>what works for you, in your own numbers</small>
          </header>
          {c.keep.length === 0 ? (
            <p className="ta-empty">Nothing stands out yet. It shows as the days add up.</p>
          ) : (
            <ul className="cx-cards">
              {c.keep.map((k) => (
                <li key={k.id} className="cx-card is-keep">
                  <p>✓ {k.text}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="ta-card">
        <header className="ta-card__h">
          <h3>Today against your usual</h3>
          <small>{c.baseline.days} earlier trading day{c.baseline.days === 1 ? "" : "s"} on record · a gap is called only when it is real</small>
        </header>
        <div className="lab-scroll">
          <table className="ta-table lab-table">
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th scope="col" className="is-num">
                  Today
                </th>
                <th scope="col" className="is-num">
                  Your usual
                </th>
                <th scope="col">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {c.versus.map((v) => (
                <tr key={v.id}>
                  <th scope="row">{v.name}</th>
                  <td className="is-num">{fmt(v.today, v.unit)}</td>
                  <td className="is-num">{fmt(v.usual, v.unit)}</td>
                  <td>{v.better === true ? <span className="cx-better">▲ better than usual</span> : v.better === false ? <span className="cx-worse">▼ worse than usual</span> : <span className="ta-dim">{c.enough ? "about the same" : "too little history"}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="lab-grid">
        <section className="ta-card">
          <header className="ta-card__h">
            <h3>Days like this one</h3>
            <small>by trades, timing, habits and the result</small>
          </header>
          {c.similarDays.length === 0 ? (
            <p className="ta-empty">No earlier day is close enough to this one yet.</p>
          ) : (
            <ul className="cx-cards">
              {c.similarDays.map((d) => (
                <li key={d.date} className={`cx-card ${d.net >= 0 ? "is-keep" : "is-major"}`}>
                  <p>{d.text}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="ta-card">
          <header className="ta-card__h">
            <h3>Trades taken the same way before</h3>
            <small>same side, hour, VWAP side and opening-range break</small>
          </header>
          {c.similarTrades.length === 0 ? (
            <p className="ta-empty">Fewer than four earlier trades were taken the way today&rsquo;s were.</p>
          ) : (
            <ul className="cx-cards">
              {c.similarTrades.map((s) => (
                <li key={s.key} className={`cx-card ${s.good ? "is-keep" : "is-major"}`}>
                  <p>{s.text}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <p className="ta-dim">Counts and sums of your own past trades, with their sample sizes — evidence about habits, not a forecast of the next trade.</p>
    </>
  );
}
