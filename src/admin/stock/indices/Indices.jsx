// Indices — NIFTY 50 and SENSEX year by year and month by month, and where they may close this month
// and this year. The history comes from Zerodha's daily candles (server/index-history.js); the tables,
// the seasonality, the patterns, the desk's projection and its walk-forward record are arithmetic
// (server/market/indices.js); the AI's projection is checked against the index's own volatility and
// scored with the desk's in one ledger, so both are backtested side by side.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { useTopics } from "../../live";
import { useAuth } from "../../auth";
import { Alert, Loading } from "../../ui";
import { Fan, MonthBars, PairBars, SeasonalPath, YearBars, dayLabel, lvl, pct, pts } from "./IndexCharts";
import "./indices.css";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TABS = [
  { id: "NIFTY", label: "NIFTY 50" },
  { id: "SENSEX", label: "SENSEX" },
  { id: "compare", label: "Side by side" },
];
const LEAN = { up: { word: "Leans up", icon: "▲", cls: "is-up" }, down: { word: "Leans down", icon: "▼", cls: "is-down" }, none: { word: "No firm lean", icon: "●", cls: "" } };
const num = (x) => typeof x === "number" && Number.isFinite(x);
const read = (k, d) => {
  try {
    return window.localStorage.getItem(k) || d;
  } catch (_) {
    return d;
  }
};
const write = (k, v) => {
  try {
    window.localStorage.setItem(k, v);
  } catch (_) {
    /* remembered for this visit only */
  }
};
/** A cell's colour: green or red, deeper with the size of the move (capped), on the card's surface. */
const heatBg = (x, cap) => {
  if (!num(x) || x === 0) return undefined;
  const k = Math.round(10 + 38 * Math.min(1, Math.abs(x) / cap));
  return `color-mix(in srgb, var(${x > 0 ? "--up" : "--down"}) ${k}%, var(--surface))`;
};
const tone = (x) => (num(x) ? (x > 0 ? "is-up" : x < 0 ? "is-down" : "") : "");
const yes = (b) => (b === true ? "✓" : b === false ? "✗" : "—");

function Kpi({ k, v, sub, cls = "", tip }) {
  return (
    <div className="ix-kpi" data-tip={tip}>
      <span>{k}</span>
      <b className={cls}>{v}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}

function Seg({ value, onChange, options, label }) {
  return (
    <div className="ix-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------------- the projections */
function ProjectionCard({ v, horizon, isOwner, onAsk, asking }) {
  const p = v.projections[horizon];
  const live = p.live;
  const start = p.start;
  const y = Number(v.to.slice(0, 4));
  const m = Number(v.to.slice(5, 7));
  const periodStart = horizon === "month" ? `${v.to.slice(0, 7)}-01` : `${y}-01-01`;
  const periodEnd = horizon === "month" ? new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) : `${y}-12-31`;
  const ai = (v.ledger.items || []).find((x) => x.kind === "ai" && x.horizon === horizon && live && x.period === live.period && x.status !== "refused") || null;
  const refused = (v.ledger.items || []).find((x) => x.kind === "ai" && x.horizon === horizon && live && x.period === live.period && x.status === "refused") || null;
  const L = live && live.available ? LEAN[live.lean] || LEAN.none : LEAN.none;
  return (
    <section className="an-card ix-proj" aria-label={`${horizon === "month" ? "This month" : "This year"}: projection`}>
      <header className="ix-proj__h">
        <h3>
          {horizon === "month" ? "This month" : "This year"} · {live && live.label}
        </h3>
        {live && live.available && (
          <>
            <span className={`ix-lean ${L.cls}`}>
              <i aria-hidden="true">{L.icon}</i> {L.word}
            </span>
            <span className="ix-dim" data-tip="From the history when the period began, carried forward with the move so far and the sessions left.">
              chance it ends up: <b>{live.probUp}%</b>
            </span>
          </>
        )}
      </header>
      {live && live.available ? (
        <>
          <Fan path={v.path[horizon]} live={live} start={start} ai={ai} periodStart={periodStart} periodEnd={periodEnd} />
          <dl className="ix-proj__nums">
            <div>
              <dt>Expected close</dt>
              <dd>
                <b>{lvl(live.mid)}</b> <small className={tone(live.expPct)}>{pct(live.expPct)} on the {horizon}</small>
              </dd>
            </div>
            <div>
              <dt>68% range</dt>
              <dd>
                {lvl(live.low68, 0)} – {lvl(live.high68, 0)}
              </dd>
            </div>
            <div>
              <dt>90% range</dt>
              <dd>
                {lvl(live.low90, 0)} – {lvl(live.high90, 0)}
              </dd>
            </div>
            <div>
              <dt>Sessions left</dt>
              <dd>
                {live.daysLeft} of {live.daysTotal} · one standard move ±{live.sigmaPct}%
              </dd>
            </div>
          </dl>
          {start && start.available && (
            <p className="ix-dim">
              At the start of the {horizon} the desk projected <b>{lvl(start.mid)}</b> (68%: {lvl(start.low68, 0)}–{lvl(start.high68, 0)}, {start.probUp}% chance up) from {lvl(start.base0)}. It is in the ledger below and is scored when the {horizon} ends.
            </p>
          )}
          <ul className="ix-reasons">
            {live.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <div className="ix-ai">
            {ai ? (
              <>
                <p>
                  <b>
                    The AI ({ai.by}, {dayLabel(ai.madeAt.slice(0, 10))}):
                  </b>{" "}
                  {LEAN[ai.lean] ? LEAN[ai.lean].word.toLowerCase() : ai.lean}, close <b>{lvl(ai.mid)}</b>
                  {num(ai.low68) ? ` (range ${lvl(ai.low68, 0)}–${lvl(ai.high68, 0)})` : ""}
                  {num(ai.probUp) ? `, ${ai.probUp}% chance up` : ""} · confidence {ai.confidence}. {ai.demo ? "On demo data: not scored." : ""}
                </p>
                {ai.reasons && ai.reasons.length > 0 && <p className="ix-dim">{ai.reasons.join(" ")}</p>}
                {ai.risks && ai.risks.length > 0 && <p className="ix-dim">Would be wrong if: {ai.risks.join(" ")}</p>}
                {ai.check && ai.check.notes.length > 0 && <p className="ix-check">Desk&rsquo;s check: {ai.check.notes.join(" ")}</p>}
              </>
            ) : (
              <p className="ix-dim">
                No AI projection for {live.label} yet.{" "}
                {v.settings && v.settings.aiAuto && !v.demo ? (horizon === "month" ? "It is asked by itself in the first week of each month." : "It is asked by itself in January.") : ""}
              </p>
            )}
            {refused && !ai && <p className="ix-check">The AI&rsquo;s last answer was refused by the desk&rsquo;s check: {refused.check.notes.join(" ")}</p>}
            {isOwner && (
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => onAsk(horizon)} disabled={asking || !v.ai.ready} data-tip={v.ai.ready ? "The AI model gives its own projection from the desk's numbers; the desk checks it against the index's volatility and keeps it in the ledger to be scored (one paid request)." : "No AI key is saved (AI page)."}>
                {asking ? "Asking…" : ai ? "Ask the AI again" : "Ask the AI for its projection"}
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="ix-dim">{live ? live.reason : "No projection yet."}</p>
      )}
    </section>
  );
}

/* --------------------------------------------------------------------- the backtest */
function Score({ s, label, ai = false }) {
  if (!s || !s.n) return <p className="ix-dim">{label}: nothing scored yet.</p>;
  return (
    <div className="ix-score">
      <Kpi k="Lean right" v={s.leaned ? `${s.hitRate}%` : "—"} sub={`of ${s.leaned} leaned · “it rises” ${s.upShare}%`} cls={num(s.hitRate) && num(s.upShare) ? (s.hitRate > s.upShare ? "is-up" : s.hitRate < s.upShare ? "is-down" : "") : ""} tip="How often the lean (up or down) was right, against the base rate of simply saying 'it rises' every time." />
      <Kpi k={ai ? "Inside its range" : "Inside the 68% range"} v={`${s.in68Rate}%`} sub={ai ? "its own range" : "a fair range holds about 68%"} tip="How often the actual close fell inside the projected range. Far above 68%: the range is too wide; far below: too narrow." />
      {!ai && num(s.in90Rate) && <Kpi k="Inside the 90% range" v={`${s.in90Rate}%`} sub="a fair range holds about 90%" />}
      <Kpi k="Average error" v={pct(s.maePct).replace(/^\+/, "")} sub={`“no change” ${pct(s.maeNaivePct).replace(/^\+/, "")} · skill ${num(s.skillPct) ? `${s.skillPct}%` : "—"}`} cls={num(s.skillPct) ? (s.skillPct > 0 ? "is-up" : s.skillPct < 0 ? "is-down" : "") : ""} tip="The average distance between the projected and the actual close, against simply expecting no change. Skill above 0 beats 'no change'." />
      <Kpi k="Scored" v={s.n} sub={label} />
    </div>
  );
}

function Backtest({ v, isOwner, onSettings }) {
  const [h, setH] = useState(() => read("vpt.ix.bt", "month"));
  const [open, setOpen] = useState(false);
  const bt = v.backtest[h];
  const rows = bt.rows.slice().reverse();
  const ledger = (v.ledger.items || []).filter((x) => x.horizon === h);
  return (
    <section className="an-card" aria-label="Backtest">
      <header className="ix-card__h">
        <h3>Backtest — projections against what happened</h3>
        <Seg
          value={h}
          onChange={(x) => {
            setH(x);
            write("vpt.ix.bt", x);
          }}
          options={[
            { id: "month", label: "Months" },
            { id: "year", label: "Years" },
          ]}
          label="Backtest period"
        />
      </header>
      <div className="ix-bt">
        <div>
          <h4>The desk&rsquo;s model, walk-forward ({bt.summary.n || 0} {h === "month" ? "months" : "years"})</h4>
          <p className="ix-dim">Each past {h} projected again with only the data that existed before it began — no look-ahead.</p>
          <Score s={bt.summary} label="walk-forward" />
        </div>
        <div>
          <h4>The live ledger — frozen when made</h4>
          <p className="ix-dim">Projections recorded as the {h}s came, scored when they ended. The desk&rsquo;s and the AI&rsquo;s side by side.</p>
          <Score s={v.ledger.desk[h]} label="the desk, live" />
          <Score s={v.ledger.ai[h]} label="the AI, live" ai />
          {isOwner && (
            <label className="ix-check-row">
              <input type="checkbox" checked={Boolean(v.settings && v.settings.aiAuto)} onChange={(e) => onSettings({ aiAuto: e.target.checked })} /> Ask the AI by itself: the month in its first week, the year in January ({v.settings ? v.settings.aiToday : 0} AI projections today)
            </label>
          )}
        </div>
      </div>

      <h4>The ledger ({ledger.length})</h4>
      {ledger.length === 0 ? (
        <p className="ix-dim">{v.demo ? "Demo data is not recorded in the ledger." : "Nothing recorded yet: the desk's projection is recorded the first time a period is seen."}</p>
      ) : (
        <div className="ix-scroll">
          <table className="ix-table">
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th scope="col">By</th>
                <th scope="col">Made</th>
                <th scope="col" className="is-num">
                  Start
                </th>
                <th scope="col" className="is-num">
                  Projected
                </th>
                <th scope="col">Range</th>
                <th scope="col">Lean</th>
                <th scope="col" className="is-num">
                  Close
                </th>
                <th scope="col" className="is-num">
                  Move
                </th>
                <th scope="col">Lean right</th>
                <th scope="col">In range</th>
                <th scope="col" className="is-num">
                  Error
                </th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((x) => (
                <tr key={x.id} className={x.status === "refused" ? "is-refused" : ""}>
                  <th scope="row">{x.label}</th>
                  <td>
                    {x.kind === "ai" ? `AI · ${x.by}` : "Desk"}
                    {x.status === "refused" && <small> refused</small>}
                  </td>
                  <td>{dayLabel(x.madeAt.slice(0, 10))}</td>
                  <td className="is-num">{lvl(x.startLevel, 0)}</td>
                  <td className="is-num">
                    <b>{lvl(x.mid, 0)}</b>
                  </td>
                  <td>{num(x.low68) ? `${lvl(x.low68, 0)}–${lvl(x.high68, 0)}` : "—"}</td>
                  <td>{(LEAN[x.lean] || LEAN.none).icon}</td>
                  <td className="is-num">{x.status === "settled" ? lvl(x.actual, 0) : <small>{x.status === "refused" ? "—" : "open"}</small>}</td>
                  <td className={`is-num ${tone(x.actualPct)}`}>{x.status === "settled" ? pct(x.actualPct) : ""}</td>
                  <td>{x.status === "settled" ? yes(x.dirHit) : ""}</td>
                  <td>{x.status === "settled" ? yes(x.in68) : ""}</td>
                  <td className="is-num">{x.status === "settled" ? pct(x.errPct) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details className="ix-more" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>
          Walk-forward, {h === "month" ? `the last ${rows.length} months` : `all ${rows.length} years`}
        </summary>
        {open && (
          <div className="ix-scroll">
            <table className="ix-table">
              <thead>
                <tr>
                  <th scope="col">Period</th>
                  <th scope="col" className="is-num">
                    Start
                  </th>
                  <th scope="col" className="is-num">
                    Projected
                  </th>
                  <th scope="col">68% range</th>
                  <th scope="col">Lean</th>
                  <th scope="col" className="is-num">
                    Chance up
                  </th>
                  <th scope="col" className="is-num">
                    Close
                  </th>
                  <th scope="col" className="is-num">
                    Move
                  </th>
                  <th scope="col">Lean right</th>
                  <th scope="col">In 68%</th>
                  <th scope="col">In 90%</th>
                  <th scope="col" className="is-num">
                    Error
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.period}>
                    <th scope="row">{r.label}</th>
                    <td className="is-num">{lvl(r.base, 0)}</td>
                    <td className="is-num">{lvl(r.mid, 0)}</td>
                    <td>
                      {lvl(r.low68, 0)}–{lvl(r.high68, 0)}
                    </td>
                    <td>{(LEAN[r.lean] || LEAN.none).icon}</td>
                    <td className="is-num">{r.probUp}%</td>
                    <td className="is-num">{lvl(r.actual, 0)}</td>
                    <td className={`is-num ${tone(r.actualPct)}`}>{pct(r.actualPct)}</td>
                    <td>{yes(r.dirHit)}</td>
                    <td>{yes(r.in68)}</td>
                    <td>{yes(r.in90)}</td>
                    <td className="is-num">{pct(r.errPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
      <p className="ix-dim">Model {bt.model}: the long-run drift, the calendar month&rsquo;s own record and the trend regime (above or below the 10-month average), each shrunk towards the long-run average by how few cases it rests on, and a range from the index&rsquo;s own volatility. A measured record, not a promise.</p>
    </section>
  );
}

/* ----------------------------------------------------------- the table of years × months */
function Heat({ v, unit }) {
  const ms = v.monthStats;
  const cell = (c, cap) => {
    if (!c) return <td className="ix-h__none">—</td>;
    const x = unit === "pts" ? c.chg : c.pct;
    return (
      <td className={`ix-h__c ${c.partial ? "is-partial" : ""}`} style={{ background: heatBg(c.pct, cap) }} title={`${pct(c.pct)} · ${pts(c.chg, 2)} points · close ${lvl(c.close)}${c.partial ? " · so far" : ""}`}>
        {unit === "pts" ? pts(x) : pct(x, 1)}
      </td>
    );
  };
  return (
    <section className="an-card" aria-label="Every year, every month">
      <header className="ix-card__h">
        <h3>Every year, every month</h3>
        <span className="ix-dim">{unit === "pts" ? "points from the previous month's close" : "percent from the previous month's close"} · darker = a bigger move · dashed = in progress</span>
      </header>
      <div className="ix-scroll">
        <table className="ix-table ix-h">
          <caption className="ix-sr">Monthly and yearly moves of {v.index.name}</caption>
          <thead>
            <tr>
              <th scope="col">Year</th>
              {MON.map((m) => (
                <th key={m} scope="col" className="is-num">
                  {m}
                </th>
              ))}
              <th scope="col" className="is-num">
                Year
              </th>
            </tr>
          </thead>
          <tbody>
            {v.heat.map((r) => (
              <tr key={r.y}>
                <th scope="row">
                  {r.y}
                  {(v.patterns.elections.years || []).some((e) => e.y === r.y) && (
                    <small className="ix-tag" title="A general-election year">
                      E
                    </small>
                  )}
                </th>
                {r.cells.map((c, i) => (
                  <React.Fragment key={i}>{cell(c, 8)}</React.Fragment>
                ))}
                {r.year ? cell(r.year, 30) : <td className="ix-h__none">—</td>}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Average</th>
              {ms.map((m) => (
                <td key={m.m} className={`is-num ${tone(m.avgPct)}`}>
                  {m.n ? (unit === "pts" ? pts(m.avgPts) : pct(m.avgPct, 1)) : "—"}
                </td>
              ))}
              <td className={`is-num ${tone(v.overall.years.avgPct)}`}>{unit === "pts" ? pts(v.overall.years.avgPts) : pct(v.overall.years.avgPct, 1)}</td>
            </tr>
            <tr>
              <th scope="row">Median</th>
              {ms.map((m) => (
                <td key={m.m} className="is-num">
                  {m.n ? (unit === "pts" ? pts(m.medianPts) : pct(m.medianPct, 1)) : "—"}
                </td>
              ))}
              <td className="is-num">{pct(v.overall.years.medianPct, 1)}</td>
            </tr>
            <tr>
              <th scope="row">Rose</th>
              {ms.map((m) => (
                <td key={m.m} className="is-num">
                  {m.n ? `${m.up}/${m.n}` : "—"}
                </td>
              ))}
              <td className="is-num">
                {v.overall.years.up}/{v.overall.years.n}
              </td>
            </tr>
            <tr>
              <th scope="row">Best</th>
              {ms.map((m) => (
                <td key={m.m} className="is-num" title={m.n ? `${m.best.y}` : ""}>
                  {m.n ? (unit === "pts" ? pts(m.best.chg) : pct(m.best.pct, 1)) : "—"}
                </td>
              ))}
              <td className="is-num">{v.overall.years.best ? pct(v.overall.years.best.pct, 1) : "—"}</td>
            </tr>
            <tr>
              <th scope="row">Worst</th>
              {ms.map((m) => (
                <td key={m.m} className="is-num" title={m.n ? `${m.worst.y}` : ""}>
                  {m.n ? (unit === "pts" ? pts(m.worst.chg) : pct(m.worst.pct, 1)) : "—"}
                </td>
              ))}
              <td className="is-num">{v.overall.years.worst ? pct(v.overall.years.worst.pct, 1) : "—"}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ each calendar month */
function MonthTable({ v, unit }) {
  const cur = Number(v.to.slice(5, 7));
  return (
    <section className="an-card" aria-label="Each calendar month over the years">
      <header className="ix-card__h">
        <h3>Each calendar month over the years</h3>
        <span className="ix-dim">the best and worst point inside the month are measured from the previous month&rsquo;s close</span>
      </header>
      <div className="ix-scroll">
        <table className="ix-table">
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col" className="is-num">
                Years
              </th>
              <th scope="col" className="is-num">
                Rose
              </th>
              <th scope="col" className="is-num">
                Average
              </th>
              <th scope="col" className="is-num">
                Median
              </th>
              <th scope="col" className="is-num">
                Spread
              </th>
              <th scope="col">Best</th>
              <th scope="col">Worst</th>
              <th scope="col" className="is-num" data-tip="The average of the highest point each month reached above the previous month's close.">
                Avg best point
              </th>
              <th scope="col" className="is-num" data-tip="The average of the lowest point each month reached below the previous month's close.">
                Avg worst point
              </th>
              <th scope="col" className="is-num">
                Avg day range
              </th>
              <th scope="col">Last 10 years</th>
            </tr>
          </thead>
          <tbody>
            {v.monthStats.map((m) =>
              m.n ? (
                <tr key={m.m} className={m.m === cur ? "is-now" : ""}>
                  <th scope="row">{m.name}</th>
                  <td className="is-num">{m.n}</td>
                  <td className="is-num">
                    {m.up} <small>({m.winRate}%)</small>
                  </td>
                  <td className={`is-num ${tone(m.avgPct)}`}>{unit === "pts" ? pts(m.avgPts) : pct(m.avgPct)}</td>
                  <td className={`is-num ${tone(m.medianPct)}`}>{unit === "pts" ? pts(m.medianPts) : pct(m.medianPct)}</td>
                  <td className="is-num">±{num(m.stdPct) ? m.stdPct.toFixed(2) : "—"}%</td>
                  <td>
                    <span className="is-up">{unit === "pts" ? pts(m.best.chg) : pct(m.best.pct)}</span> <small>{m.best.y}</small>
                  </td>
                  <td>
                    <span className="is-down">{unit === "pts" ? pts(m.worst.chg) : pct(m.worst.pct)}</span> <small>{m.worst.y}</small>
                  </td>
                  <td className="is-num">{pct(m.avgUpExcPct)}</td>
                  <td className="is-num">{pct(m.avgDownExcPct)}</td>
                  <td className="is-num">{num(m.avgDayRangePct) ? `${m.avgDayRangePct.toFixed(2)}%` : "—"}</td>
                  <td>{m.last10 ? `rose ${m.last10.winRate}%, avg ${pct(m.last10.avgPct)}` : "—"}</td>
                </tr>
              ) : (
                <tr key={m.m}>
                  <th scope="row">{m.name}</th>
                  <td colSpan={11} className="ix-dim">
                    no complete month yet
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------------- every year */
function YearTable({ v, unit }) {
  return (
    <section className="an-card" aria-label="Every year">
      <header className="ix-card__h">
        <h3>Every year</h3>
        <span className="ix-dim">deepest fall = from a high inside the year to a later low</span>
      </header>
      <YearBars years={v.years} unit={unit} />
      <div className="ix-scroll">
        <table className="ix-table">
          <thead>
            <tr>
              <th scope="col">Year</th>
              <th scope="col" className="is-num">
                Open
              </th>
              <th scope="col" className="is-num">
                High
              </th>
              <th scope="col" className="is-num">
                Low
              </th>
              <th scope="col" className="is-num">
                Close
              </th>
              <th scope="col" className="is-num">
                Points
              </th>
              <th scope="col" className="is-num">
                Change
              </th>
              <th scope="col" className="is-num">
                Up / down months
              </th>
              <th scope="col">Best month</th>
              <th scope="col">Worst month</th>
              <th scope="col" className="is-num">
                Deepest fall
              </th>
              <th scope="col" className="is-num">
                Range
              </th>
            </tr>
          </thead>
          <tbody>
            {v.years
              .slice()
              .reverse()
              .map((y) => (
                <tr key={y.y} className={y.partial ? "is-now" : ""}>
                  <th scope="row">
                    {y.y}
                    {y.partial ? <small> so far</small> : null}
                    {y.election && (
                      <small className="ix-tag" title="A general-election year">
                        E
                      </small>
                    )}
                  </th>
                  <td className="is-num">{lvl(y.open, 0)}</td>
                  <td className="is-num">{lvl(y.high, 0)}</td>
                  <td className="is-num">{lvl(y.low, 0)}</td>
                  <td className="is-num">
                    <b>{lvl(y.close, 0)}</b>
                  </td>
                  <td className={`is-num ${tone(y.chg)}`}>{num(y.prevClose) ? pts(y.chg) : "—"}</td>
                  <td className={`is-num ${tone(y.pct)}`}>{num(y.prevClose) ? pct(y.pct) : "—"}</td>
                  <td className="is-num">
                    {y.upMonths} / {y.downMonths}
                  </td>
                  <td>{y.bestMonth ? `${MON[y.bestMonth.m - 1]} ${pct(y.bestMonth.pct)}` : "—"}</td>
                  <td>{y.worstMonth ? `${MON[y.worstMonth.m - 1]} ${pct(y.worstMonth.pct)}` : "—"}</td>
                  <td className="is-num is-down">{pct(y.maxDdPct)}</td>
                  <td className="is-num">{num(y.rangePct) ? `${y.rangePct.toFixed(1)}%` : "—"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------- patterns */
function Patterns({ v }) {
  const p = v.patterns;
  const dd = p.drawdowns;
  const am = p.afterMonths;
  const el = p.elections;
  const tm = p.turnOfMonth;
  return (
    <div className="ix-pats">
      <section className="an-card">
        <h3>Day of the week</h3>
        <table className="ix-table ix-mini">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col" className="is-num">
                Average
              </th>
              <th scope="col" className="is-num">
                Rose
              </th>
            </tr>
          </thead>
          <tbody>
            {p.dayOfWeek.map((d) => (
              <tr key={d.name}>
                <th scope="row">{d.name}</th>
                <td className={`is-num ${tone(d.avgPct)}`}>{pct(d.avgPct, 3)}</td>
                <td className="is-num">{d.winRate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="ix-dim">Close to close, {p.dayOfWeek.reduce((a, d) => a + d.n, 0).toLocaleString("en-IN")} sessions.</p>
      </section>
      <section className="an-card">
        <h3>The turn of the month</h3>
        <dl className="ix-dl">
          <div>
            <dt>Last 3 + first 3 sessions</dt>
            <dd>
              <b className={tone(tm.turn.avgPct)}>{pct(tm.turn.avgPct, 3)}</b> a day · rose {tm.turn.winRate}%
            </dd>
          </div>
          <div>
            <dt>Every other day</dt>
            <dd>
              <b className={tone(tm.rest.avgPct)}>{pct(tm.rest.avgPct, 3)}</b> a day · rose {tm.rest.winRate}%
            </dd>
          </div>
          <div>
            <dt>The first session of a month</dt>
            <dd>
              <b className={tone(tm.firstDay.avgPct)}>{pct(tm.firstDay.avgPct, 3)}</b> · rose {tm.firstDay.winRate}%
            </dd>
          </div>
        </dl>
      </section>
      <section className="an-card">
        <h3>What followed a month</h3>
        <dl className="ix-dl">
          <div>
            <dt>After a big up month ({pct(am.threshold.upPct, 1)} or more)</dt>
            <dd>
              next month avg <b className={tone(am.afterBigUp.avgPct)}>{pct(am.afterBigUp.avgPct)}</b>, rose {am.afterBigUp.winRate ?? "—"}% <small>({am.afterBigUp.n})</small>
            </dd>
          </div>
          <div>
            <dt>After an up month</dt>
            <dd>
              avg <b className={tone(am.afterUp.avgPct)}>{pct(am.afterUp.avgPct)}</b>, rose {am.afterUp.winRate}% <small>({am.afterUp.n})</small>
            </dd>
          </div>
          <div>
            <dt>After a down month</dt>
            <dd>
              avg <b className={tone(am.afterDown.avgPct)}>{pct(am.afterDown.avgPct)}</b>, rose {am.afterDown.winRate}% <small>({am.afterDown.n})</small>
            </dd>
          </div>
          <div>
            <dt>After a big down month ({pct(am.threshold.downPct, 1)} or less)</dt>
            <dd>
              avg <b className={tone(am.afterBigDown.avgPct)}>{pct(am.afterBigDown.avgPct)}</b>, rose {am.afterBigDown.winRate ?? "—"}% <small>({am.afterBigDown.n})</small>
            </dd>
          </div>
        </dl>
      </section>
      <section className="an-card">
        <h3>Streaks</h3>
        <dl className="ix-dl">
          <div>
            <dt>Longest run of up months</dt>
            <dd>{p.streaks.longestUp ? `${p.streaks.longestUp.n} · ${p.streaks.longestUp.from} – ${p.streaks.longestUp.to}` : "—"}</dd>
          </div>
          <div>
            <dt>Longest run of down months</dt>
            <dd>{p.streaks.longestDown ? `${p.streaks.longestDown.n} · ${p.streaks.longestDown.from} – ${p.streaks.longestDown.to}` : "—"}</dd>
          </div>
          <div>
            <dt>Now</dt>
            <dd>{p.streaks.now ? `${p.streaks.now.n} ${p.streaks.now.dir} month${p.streaks.now.n === 1 ? "" : "s"} in a row, from ${p.streaks.now.from}` : "—"}</dd>
          </div>
        </dl>
      </section>
      <section className="an-card ix-wide">
        <h3>Falls from the high</h3>
        {dd && (
          <>
            <p>
              All-time high <b>{lvl(dd.ath.close)}</b> on {dayLabel(dd.ath.d)} · now <b className={tone(dd.now.pct)}>{pct(dd.now.pct)}</b> from it ({dd.now.sessions} sessions since).
            </p>
            {dd.episodes.length > 0 ? (
              <div className="ix-scroll">
                <table className="ix-table ix-mini">
                  <thead>
                    <tr>
                      <th scope="col">High</th>
                      <th scope="col">Low</th>
                      <th scope="col" className="is-num">
                        Fall
                      </th>
                      <th scope="col">Back to the high</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dd.episodes.map((e) => (
                      <tr key={e.peak}>
                        <th scope="row">
                          {dayLabel(e.peak)} <small>{lvl(e.peakClose, 0)}</small>
                        </th>
                        <td>
                          {dayLabel(e.trough)} <small>{lvl(e.troughClose, 0)}</small>
                        </td>
                        <td className="is-num is-down">{pct(e.pct, 1)}</td>
                        <td>{e.recovered ? dayLabel(e.recovered) : <b>not yet</b>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="ix-dim">No fall of 10% or more on record.</p>
            )}
          </>
        )}
      </section>
      <section className="an-card">
        <h3>General-election years</h3>
        {el.election.n ? (
          <>
            <p>
              Election years averaged <b className={tone(el.election.avgPct)}>{pct(el.election.avgPct)}</b> (rose {el.election.up} of {el.election.n}); other years <b className={tone(el.others.avgPct)}>{pct(el.others.avgPct)}</b> (rose {el.others.up} of {el.others.n}).
            </p>
            <p className="ix-dim">{el.years.map((y) => `${y.y}: ${pct(y.pct, 1)}`).join(" · ")}</p>
            <p className="ix-dim">Lok Sabha elections. Few cases: a curiosity, not a rule.</p>
          </>
        ) : (
          <p className="ix-dim">No complete election year in the history.</p>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------------ one index */
function IndexView({ v, unit, isOwner, onAsk, asking, onSettings }) {
  const tm = v.thisMonth || {};
  const deskM = v.projections.month.live;
  const aiM = (v.ledger.items || []).find((x) => x.kind === "ai" && x.horizon === "month" && deskM && x.period === deskM.period && x.status !== "refused");
  const dd = v.patterns.drawdowns;
  return (
    <>
      <section className="ix-kpis" aria-label="Now">
        <Kpi k={`Last close · ${dayLabel(v.last.d)}`} v={lvl(v.last.close)} sub={`${pts(v.last.chg, 2)} (${pct(v.last.pct)}) on the day`} cls={tone(v.last.chg)} />
        <Kpi k={`Month to date · ${v.mtd ? v.mtd.label : ""}`} v={v.mtd ? pct(v.mtd.pct) : "—"} sub={v.mtd ? `${pts(v.mtd.chg, 2)} points · range ${pct(v.mtd.downExcPct, 1)} to ${pct(v.mtd.upExcPct, 1)}` : ""} cls={v.mtd ? tone(v.mtd.pct) : ""} />
        <Kpi k={`Year to date · ${v.ytd ? v.ytd.y : ""}`} v={v.ytd ? pct(v.ytd.pct) : "—"} sub={v.ytd ? `${pts(v.ytd.chg, 2)} points · deepest fall ${pct(v.ytd.maxDdPct, 1)}` : ""} cls={v.ytd ? tone(v.ytd.pct) : ""} />
        <Kpi k="From the all-time high" v={dd ? pct(dd.now.pct) : "—"} sub={dd ? `high ${lvl(dd.ath.close, 0)} on ${dayLabel(dd.ath.d)}` : ""} cls={dd && dd.now.pct < 0 ? "is-down" : ""} />
        <Kpi k={`${tm.name || "This month"} in history`} v={tm.n ? `rose ${tm.up} of ${tm.n}` : "—"} sub={tm.n ? `average ${pct(tm.avgPct)} · median ${pct(tm.medianPct)}` : ""} tip="How this calendar month has done in every year on record." />
        <Kpi k="Desk: month-end" v={deskM && deskM.available ? lvl(deskM.mid, 0) : "—"} sub={deskM && deskM.available ? `68%: ${lvl(deskM.low68, 0)}–${lvl(deskM.high68, 0)} · ${deskM.probUp}% up` : ""} />
        <Kpi k="AI: month-end" v={aiM ? lvl(aiM.mid, 0) : "—"} sub={aiM ? `${aiM.by} · ${dayLabel(aiM.madeAt.slice(0, 10))}` : "not asked yet"} />
      </section>

      <div className="ix-two">
        <ProjectionCard v={v} horizon="month" isOwner={isOwner} onAsk={onAsk} asking={asking === "month"} />
        <ProjectionCard v={v} horizon="year" isOwner={isOwner} onAsk={onAsk} asking={asking === "year"} />
      </div>

      <Backtest v={v} isOwner={isOwner} onSettings={onSettings} />

      <Heat v={v} unit={unit} />

      <div className="ix-two">
        <section className="an-card">
          <header className="ix-card__h">
            <h3>The average month</h3>
          </header>
          <MonthBars stats={v.monthStats} unit={unit} current={Number(v.to.slice(5, 7))} />
        </section>
        <section className="an-card">
          <header className="ix-card__h">
            <h3>The average year, and this one</h3>
          </header>
          <SeasonalPath seasonal={v.seasonal} />
        </section>
      </div>

      <MonthTable v={v} unit={unit} />
      <YearTable v={v} unit={unit} />
      <Patterns v={v} />
    </>
  );
}

/* ------------------------------------------------------------------------ side by side */
function Compare({ c, unit }) {
  const years = c.rows.map((r) => r.y);
  const [y, setY] = useState(years[0]);
  const row = c.rows.find((r) => r.y === y) || c.rows[0];
  const A = c.a.name;
  const B = c.b.name;
  const val = (x) => (unit === "pts" ? pts(x.chg) : pct(x.pct));
  return (
    <>
      <section className="ix-kpis" aria-label="How closely they move">
        <Kpi k="Correlation of monthly moves" v={num(c.months.corr) ? c.months.corr.toFixed(2) : "—"} sub={`${c.months.n} months in common`} tip="1.00 = they move exactly together; 0 = unrelated." />
        <Kpi k="Same direction" v={`${c.months.sameDirPct}%`} sub="of months both rose or both fell" />
        <Kpi k={`${A} did better`} v={`${c.months.aBetter} months`} sub={`${c.years.aBetter} of ${c.years.n} years`} />
        <Kpi k={`${B} did better`} v={`${c.months.bBetter} months`} sub={`${c.years.bBetter} of ${c.years.n} years`} />
        <Kpi k="Average monthly gap" v={`${num(c.months.avgAbsDiffPct) ? c.months.avgAbsDiffPct.toFixed(2) : "—"}%`} sub={`on average ${A} ${pct(c.months.avgDiffPct)} against ${B}`} />
      </section>
      <section className="an-card">
        <header className="ix-card__h">
          <h3>Year by year</h3>
        </header>
        <PairBars rows={c.rows} a={A} b={B} />
      </section>
      <div className="ix-two">
        <section className="an-card">
          <header className="ix-card__h">
            <h3>Month by month in</h3>
            <div className="ix-years" role="group" aria-label="Year">
              {years.slice(0, 30).map((yy) => (
                <button key={yy} type="button" aria-pressed={yy === y} onClick={() => setY(yy)}>
                  {yy}
                </button>
              ))}
            </div>
          </header>
          <div className="ix-scroll">
            <table className="ix-table">
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col" className="is-num">
                    {A} close
                  </th>
                  <th scope="col" className="is-num">
                    {A}
                  </th>
                  <th scope="col" className="is-num">
                    {B} close
                  </th>
                  <th scope="col" className="is-num">
                    {B}
                  </th>
                  <th scope="col" className="is-num">
                    Gap
                  </th>
                </tr>
              </thead>
              <tbody>
                {row.months.map((m, i) =>
                  m ? (
                    <tr key={i} className={m.a.partial ? "is-now" : ""}>
                      <th scope="row">
                        {MON[i]}
                        {m.a.partial ? <small> so far</small> : null}
                      </th>
                      <td className="is-num">{lvl(m.a.close, 0)}</td>
                      <td className={`is-num ${tone(m.a.pct)}`}>{val(m.a)}</td>
                      <td className="is-num">{lvl(m.b.close, 0)}</td>
                      <td className={`is-num ${tone(m.b.pct)}`}>{val(m.b)}</td>
                      <td className={`is-num ${tone(m.a.pct - m.b.pct)}`}>{pct(m.a.pct - m.b.pct)}</td>
                    </tr>
                  ) : null
                )}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">{row.y}</th>
                  <td className="is-num">{lvl(row.a.close, 0)}</td>
                  <td className={`is-num ${tone(row.a.pct)}`}>{val(row.a)}</td>
                  <td className="is-num">{lvl(row.b.close, 0)}</td>
                  <td className={`is-num ${tone(row.b.pct)}`}>{val(row.b)}</td>
                  <td className={`is-num ${tone(row.a.pct - row.b.pct)}`}>{pct(row.a.pct - row.b.pct)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
        <section className="an-card">
          <header className="ix-card__h">
            <h3>Where they parted most</h3>
          </header>
          <table className="ix-table ix-mini">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col" className="is-num">
                  {A}
                </th>
                <th scope="col" className="is-num">
                  {B}
                </th>
                <th scope="col" className="is-num">
                  Gap
                </th>
              </tr>
            </thead>
            <tbody>
              {c.largestGaps.map((g) => (
                <tr key={g.key}>
                  <th scope="row">{g.label}</th>
                  <td className={`is-num ${tone(g.a)}`}>{pct(g.a)}</td>
                  <td className={`is-num ${tone(g.b)}`}>{pct(g.b)}</td>
                  <td className="is-num">{pct(g.diff)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      <section className="an-card">
        <header className="ix-card__h">
          <h3>Every year side by side</h3>
        </header>
        <div className="ix-scroll">
          <table className="ix-table ix-pair">
            <thead>
              <tr>
                <th scope="col" rowSpan={2}>
                  Year
                </th>
                {MON.map((m) => (
                  <th key={m} scope="col" className="is-num">
                    {m}
                  </th>
                ))}
                <th scope="col" className="is-num">
                  Year
                </th>
              </tr>
            </thead>
            <tbody>
              {c.rows.map((r) => (
                <tr key={r.y}>
                  <th scope="row">
                    {r.y}
                    <small className="ix-pair__k">
                      <i className="is-a" />
                      {A}
                      <br />
                      <i className="is-b" />
                      {B}
                    </small>
                  </th>
                  {r.months.map((m, i) => (
                    <td key={i} className="is-num">
                      {m ? (
                        <>
                          <span className={tone(m.a.pct)}>{unit === "pts" ? pts(m.a.chg) : pct(m.a.pct, 1)}</span>
                          <br />
                          <span className={tone(m.b.pct)}>{unit === "pts" ? pts(m.b.chg) : pct(m.b.pct, 1)}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  ))}
                  <td className="is-num">
                    <b className={tone(r.a.pct)}>{unit === "pts" ? pts(r.a.chg) : pct(r.a.pct, 1)}</b>
                    <br />
                    <b className={tone(r.b.pct)}>{unit === "pts" ? pts(r.b.chg) : pct(r.b.pct, 1)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------------------ page */
export default function Indices() {
  const { user } = useAuth() || {};
  const isOwner = Boolean(user && user.role === "superadmin");
  const [tab, setTabState] = useState(() => read("vpt.ix.tab", "NIFTY"));
  const [unit, setUnitState] = useState(() => read("vpt.ix.unit", "pct"));
  const [views, setViews] = useState({});
  const [cmp, setCmp] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState("");
  const setTab = (t) => {
    setTabState(t);
    setMsg("");
    write("vpt.ix.tab", t);
  };
  const setUnit = (u) => {
    setUnitState(u);
    write("vpt.ix.unit", u);
  };
  const load = useCallback(
    async (id, { refresh = false } = {}) => {
      setErr("");
      try {
        if (id === "compare") setCmp(await api("/api/admin/indices/compare"));
        else {
          const v = refresh ? await api("/api/admin/indices/refresh", { method: "POST", body: { index: id } }) : await api(`/api/admin/indices?index=${id}`);
          setViews((cur) => ({ ...cur, [id]: v }));
        }
      } catch (e) {
        setErr(e.message);
      }
    },
    []
  );
  useEffect(() => {
    if (tab === "compare" ? !cmp : !views[tab]) load(tab);
  }, [tab, load, cmp, views]);
  // a refresh, a projection checked or an AI answer anywhere: the tab in view is read again at once
  useTopics(["indices"], () => load(tab));
  const v = tab !== "compare" ? views[tab] : null;
  const ask = async (horizon) => {
    setAsking(horizon);
    setMsg("");
    try {
      const r = await api("/api/admin/indices/ai", { method: "POST", body: { index: tab, horizon } });
      setMsg(r.entry.status === "refused" ? `The desk refused the AI's ${horizon} projection: ${r.entry.check.notes.join(" ")}` : `The AI's ${horizon} projection is in the ledger: ${lvl(r.entry.mid)}${r.entry.check.notes.length ? ` — ${r.entry.check.notes.join(" ")}` : ""}`);
      await load(tab);
    } catch (e) {
      setMsg(e.message);
    }
    setAsking("");
  };
  const saveSettings = async (patch) => {
    try {
      const s = await api("/api/admin/indices/settings", { method: "PUT", body: patch });
      setViews((cur) => Object.fromEntries(Object.entries(cur).map(([k, x]) => [k, { ...x, settings: s }])));
    } catch (e) {
      setMsg(e.message);
    }
  };
  const refresh = async () => {
    setBusy(true);
    await load(tab, { refresh: true });
    setBusy(false);
  };
  const head = useMemo(() => {
    if (tab === "compare") return cmp && cmp.available ? `${cmp.a.name} ${cmp.a.from.slice(0, 4)}–${cmp.a.to.slice(0, 4)} and ${cmp.b.name} ${cmp.b.from.slice(0, 4)}–${cmp.b.to.slice(0, 4)}` : "";
    return v && v.available ? `Daily history from ${v.demo ? "a demo generator" : "Zerodha"}: ${dayLabel(v.from)} to ${dayLabel(v.to)} · ${v.yearsCovered} complete years · ${v.sessions.toLocaleString("en-IN")} sessions` : "";
  }, [tab, v, cmp]);

  return (
    <div className="ix">
      <header className="an-card ix-head">
        <div className="ix-head__t">
          <h2>Indices — NIFTY 50 and SENSEX, month by month</h2>
          <p className="ix-dim">{head || "Every month and every year: the move in points and percent, how each calendar month behaves, the patterns traders watch, and projections for this month and this year — kept beside what actually happened."}</p>
        </div>
        <div className="ix-head__c">
          <Seg value={tab} onChange={setTab} options={TABS} label="Index" />
          <Seg
            value={unit}
            onChange={setUnit}
            options={[
              { id: "pct", label: "%" },
              { id: "pts", label: "Points" },
            ]}
            label="Show moves in"
          />
          {tab !== "compare" && (
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={refresh} disabled={busy} data-tip="Read the latest daily candles from Zerodha now (they are also topped up by themselves).">
              {busy ? "Reading…" : "↻ Refresh"}
            </button>
          )}
        </div>
      </header>
      {err && <Alert>{err}</Alert>}
      {msg && <p className="adm-alert adm-alert--info">{msg}</p>}
      {tab === "compare" ? (
        !cmp ? (
          !err && <Loading label="Reading both indices…" />
        ) : cmp.available ? (
          <>
            {cmp.demo && <p className="adm-alert adm-alert--info">Demo data: two synthetic series stand in for NIFTY 50 and SENSEX. Connect Zerodha for the real history.</p>}
            <Compare c={cmp} unit={unit} />
          </>
        ) : (
          <p className="adm-alert adm-alert--info">{cmp.reason}</p>
        )
      ) : !v ? (
        !err && <Loading label="Reading the index history…" />
      ) : !v.available ? (
        <p className="adm-alert adm-alert--info">{v.reason}</p>
      ) : (
        <>
          {v.demo && <p className="adm-alert adm-alert--info">Demo data: “{v.index.name}” is a synthetic series standing in for {tab === "SENSEX" ? "SENSEX" : "NIFTY 50"} — not the real index. Connect Zerodha for the real history; demo projections are not recorded in the ledger.</p>}
          {v.stale && <p className="adm-alert adm-alert--info">{v.staleReason}</p>}
          <IndexView v={v} unit={unit} isOwner={isOwner} onAsk={ask} asking={asking} onSettings={saveSettings} />
        </>
      )}
      <p className="ix-dim ix-foot">History and statistics describe what happened; projections are readings of that history with a measured record, never a promise. No method wins every month.</p>
    </div>
  );
}
