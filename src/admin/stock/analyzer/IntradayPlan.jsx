// The Intraday Plan for the next session: what the desk expects tomorrow for one stock and whether —
// and how — it is worth trading intraday. Shown on the Desk while the market is shut, and for every
// stock in Research → Intraday research.
//
// Everything comes from GET /api/admin/ai/intraday/:symbol — the server's arithmetic
// (server/market/intraplan.js): the Next-Session Outlook, the stock's measured intraday habits and the
// plan's own rules replayed on its past sessions. No AI is called and nothing here places an order:
// the trader decides, and opens the order ticket themself.

import React, { useEffect, useState } from "react";
import { api } from "../../api";
import { addDays, indiaHolidays, isWeekend, formatDate } from "../holidays";
import { inr, isNum, num, pct } from "./format";
import "./intraplan.css";

const enc = encodeURIComponent;

export const KIND = {
  long: { word: "LONG", tone: "up", label: "Long on the trigger" },
  short: { word: "SHORT", tone: "down", label: "Short on the trigger (intraday only)" },
  orb: { word: "RANGE BREAK", tone: "orb", label: "Trade the opening-range break" },
  wait: { word: "WAIT", tone: "flat", label: "No trade planned" },
  avoid: { word: "AVOID", tone: "avoid", label: "Avoid intraday" },
};
const LEAN = { up: "Up", down: "Down", flat: "Sideways" };

/** The next NSE trading day after a date, skipping weekends and the exchange holidays on file. */
const isShut = (d) => indiaHolidays(Number(d.slice(0, 4))).some((h) => h.kind === "closed" && h.date === d);

export function nextTradingDay(date) {
  if (!date) return null;
  let d = addDays(date, 1);
  for (let i = 0; i < 14 && (isWeekend(d) || isShut(d)); i += 1) d = addDays(d, 1);
  return d;
}

/** The date the plan is for: today while the session trades, else the next trading day after the last bar. */
export const sessionOf = (p) => (p ? (p.marketOpen ? p.nextSession : nextTradingDay(p.asOf)) : null);

/** Fetch one stock's plan, refreshed every quarter hour while shown (the GIFT Nifty cue moves overnight). */
export function useIntradayPlan(symbol, enabled = true) {
  const [s, setS] = useState({ loading: enabled, data: null, error: "" });
  useEffect(() => {
    let alive = true;
    if (!enabled || !symbol) return undefined;
    setS({ loading: true, data: null, error: "" });
    const read = () =>
      api(`/api/admin/ai/intraday/${enc(symbol)}`)
        .then((d) => alive && setS({ loading: false, data: d, error: "" }))
        .catch((e) => alive && setS((p) => ({ loading: false, data: p.data, error: e.message })));
    read();
    const id = setInterval(() => document.visibilityState !== "hidden" && read(), 15 * 60000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [symbol, enabled]);
  return s;
}

function Strength({ value }) {
  if (!isNum(value)) return null;
  return (
    <div className="ip-strength" role="img" aria-label={`Plan strength ${value} out of 100`} data-tip="Blends how much of the outlook's evidence agrees with how these exact rules did on this stock in the past. Not a probability of profit.">
      <span>Plan strength</span>
      <div className="ip-strength__bar">
        <i style={{ width: `${Math.max(4, Math.min(100, value))}%` }} />
      </div>
      <b>{value}</b>
    </div>
  );
}

/** Where tomorrow may trade: the wide day, the normal day, the expected open and both triggers on one line. */
function RangeBar({ p }) {
  const lo = Math.min(p.range.wideLow, p.plans.short.entry);
  const hi = Math.max(p.range.wideHigh, p.plans.long.entry);
  if (!(hi > lo)) return null;
  const at = (x) => `${Math.max(0, Math.min(100, ((x - lo) / (hi - lo)) * 100))}%`;
  const marks = [
    { k: "short", x: p.plans.short.entry, t: "Short trigger" },
    { k: "open", x: p.open.expected, t: "Expected open" },
    { k: "long", x: p.plans.long.entry, t: "Long trigger" },
  ];
  return (
    <div className="ip-rbar" aria-hidden="true">
      <div className="ip-rbar__track">
        <span className="ip-rbar__wide" style={{ left: at(p.range.wideLow), width: `calc(${at(p.range.wideHigh)} - ${at(p.range.wideLow)})` }} />
        <span className="ip-rbar__norm" style={{ left: at(p.range.low), width: `calc(${at(p.range.high)} - ${at(p.range.low)})` }} />
        {marks.map((m) => (
          <i key={m.k} className={`ip-rbar__m ip-rbar__m--${m.k}`} style={{ left: at(m.x) }} title={`${m.t} ${inr(m.x)}`} />
        ))}
      </div>
      <div className="ip-rbar__legend">
        <span>
          <i className="ip-key ip-key--short" /> Short {inr(p.plans.short.entry)}
        </span>
        <span>
          <i className="ip-key ip-key--open" /> Open {inr(p.open.expected)}
        </span>
        <span>
          <i className="ip-key ip-key--long" /> Long {inr(p.plans.long.entry)}
        </span>
      </div>
    </div>
  );
}

function PlanCard({ side, plan, called }) {
  return (
    <div className={`ip-plan ip-plan--${side} ${called ? "is-called" : ""}`}>
      <header>
        <b>{side === "long" ? "Long" : "Short"}</b>
        {called ? <em>the plan</em> : <small>{side === "long" ? "if it breaks up instead" : "if it breaks down instead"}</small>}
      </header>
      <dl>
        <div>
          <dt>Trigger</dt>
          <dd>
            {side === "long" ? "above" : "below"} {inr(plan.entry)}
          </dd>
        </div>
        <div>
          <dt>Stop</dt>
          <dd className="is-down">{inr(plan.stop)}</dd>
        </div>
        <div>
          <dt>Target 1 · 2</dt>
          <dd className="is-up">
            {inr(plan.targets[0])} · {inr(plan.targets[1])}
          </dd>
        </div>
        <div>
          <dt>Risk / share</dt>
          <dd>
            {inr(plan.riskPerShare)} <small>({num(plan.riskPct, 2)}%)</small>
          </dd>
        </div>
      </dl>
    </div>
  );
}

const verdictTone = (v) => (v === "held up" ? "up" : v === "did not pay" ? "down" : "flat");

function RecordTable({ rec }) {
  const rows = [
    ["Followed the lean — longs", rec.lean.long],
    ["Followed the lean — shorts", rec.lean.short],
    ["Either side, first to trigger", rec.both],
    ["Opening-range break", rec.orb],
  ];
  return (
    <div className="ip-tablewrap">
      <table className="ip-table">
        <thead>
          <tr>
            <th scope="col">Rules</th>
            <th scope="col">Trades</th>
            <th scope="col">Won</th>
            <th scope="col">Avg R</th>
            <th scope="col">Total R</th>
            <th scope="col">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, s]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{s.trades}</td>
              <td>{s.trades ? `${s.winRate}%` : "—"}</td>
              <td className={s.avgR > 0 ? "is-up" : s.avgR < 0 ? "is-down" : ""}>{s.trades ? `${s.avgR > 0 ? "+" : ""}${num(s.avgR, 2)}` : "—"}</td>
              <td>{s.trades ? `${s.totalR > 0 ? "+" : ""}${num(s.totalR, 1)}` : "—"}</td>
              <td>
                <span className={`ip-verdict ip-verdict--${verdictTone(s.verdict)}`}>{s.verdict}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Habits({ h }) {
  const o = h.openingRange;
  const items = [
    ["A normal day", `${num(h.rangePct.median, 2)}% high to low`, `One day in five spans ${num(h.rangePct.high, 2)}% or more; a quiet one ${num(h.rangePct.low, 2)}% or less.`],
    ["Opening range (9:15–9:30)", `${num(o.medianPct, 2)}% tall`, o.note],
    ["First break held", isNum(o.heldPct) ? `${o.heldPct}%` : "—", "Of the days the opening range broke, how often the first break was still beyond it at the close."],
    ["High or low in the first hour", `${h.firstHourExtremePct}%`, "How often the day's high or its low was set before 10:15."],
    ["Trend days", `${h.trendDayPct}%`, "Days that closed in the top or bottom fifth of their range — days that kept going one way."],
    ["VWAP side held", isNum(h.vwapHoldPct) ? `${h.vwapHoldPct}%` : "—", "How often the side of VWAP at 10:15 was the side at the close."],
    ["Gaps filled", isNum(h.gapFillPct) ? `${h.gapFillPct}%` : "—", `Of ${h.gaps} opens 0.3% or more from the last close, how often the day came back to that close.`],
    ["Open drive", `${h.openDrivePct}%`, "How often the first fifteen minutes pointed the same way as the whole day."],
  ];
  return (
    <div className="ip-habits">
      {items.map(([k, v, tip]) => (
        <div key={k} className="ip-habit" data-tip={tip}>
          <span>{k}</span>
          <b>{v}</b>
        </div>
      ))}
    </div>
  );
}

/**
 * One stock's intraday plan.
 * @param data    the plan, when the caller already has it (Research); otherwise it is fetched
 * @param onOpen  "Open on desk" (Research only)
 */
export default function IntradayPlan({ symbol, data = null, onOpen = null }) {
  const fetched = useIntradayPlan(symbol, !data);
  const p = data || fetched.data;
  const [ticked, setTicked] = useState(() => new Set());
  useEffect(() => setTicked(new Set()), [symbol]);
  if (!p && fetched.loading) return <p className="ab-dim">Building the intraday plan…</p>;
  if (!p) return <p className="adm-alert adm-alert--info">{fetched.error || "The intraday plan is not available."}</p>;
  if (!p.available) return <p className="adm-alert adm-alert--info">{p.reason || "The intraday plan is not available for this stock."}</p>;
  const d = p.decision;
  const K = KIND[d.kind] || KIND.wait;
  const session = sessionOf(p);
  const odds = p.odds && p.odds[p.odds.now];
  const rec = p.record;
  // the record of the plan shown; with no trade planned, the record of taking either side
  const sideRec = !rec ? null : d.kind === "long" || d.kind === "short" ? rec.lean[d.kind] : d.kind === "orb" ? rec.orb : rec.both;
  const recLabel = d.kind === "wait" || d.kind === "avoid" ? "Either side's record" : "This plan's record";
  const tick = (i) =>
    setTicked((t) => {
      const n = new Set(t);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  return (
    <div className="ip">
      <div className={`ip-call ip-call--${K.tone}`}>
        <div className="ip-call__top">
          <span className="ip-call__word">{K.word}</span>
          <div className="ip-call__titles">
            <span className="ip-call__for">
              Intraday plan · {symbol} · for {session ? formatDate(session, { weekday: "short", day: "numeric", month: "short" }) : "the next session"}
              {p.marketOpen ? " (in progress)" : ""}
            </span>
            <span className="ip-call__head">{d.headline}</span>
            <span className="ip-call__why">Because {d.why}.</span>
          </div>
          {onOpen && (
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => onOpen(symbol)} data-tip="Open this stock on the trading desk.">
              Open on desk
            </button>
          )}
        </div>
        <Strength value={d.strength} />
      </div>

      <div className="ip-tiles">
        <div className="ip-tile">
          <span>Expected open</span>
          <b>{inr(p.open.expected)}</b>
          <small>
            {inr(p.open.low)} – {inr(p.open.high)}
            {isNum(p.open.gapPct) && p.open.gapPct !== 0 ? ` · ${pct(p.open.gapPct)}` : ""}
          </small>
          <small className="ip-tile__basis" data-tip={p.open.basis}>
            {isNum(p.open.cue) ? `GIFT Nifty ${pct(p.open.cue)}${isNum(p.open.beta) ? ` × β ${num(p.open.beta, 2)}` : ""}` : p.marketOpen ? "the session is trading" : "no overnight cue"}
          </small>
        </div>
        <div className="ip-tile">
          <span>Expected range</span>
          <b>
            {inr(p.range.low)} – {inr(p.range.high)}
          </b>
          <small>
            a wide day {inr(p.range.wideLow)} – {inr(p.range.wideHigh)}
          </small>
          <small className="ip-tile__basis" data-tip={p.range.basis}>
            normal day {num(p.range.typicalPct, 2)}% high to low
          </small>
        </div>
        <div className={`ip-tile ip-tile--${p.lean.chartBucket === "up" ? "up" : p.lean.chartBucket === "down" ? "down" : "flat"}`}>
          <span>Direction</span>
          <b>{LEAN[p.odds.now] || "Sideways"}</b>
          <small>{p.lean.headline || "No outlook"}</small>
          {odds && odds.sessions >= 20 && (
            <small className="ip-tile__basis" data-tip="Of the past sessions after a chart that read the same way, how many closed above the day before. A count of the past, not a forecast.">
              after days like this: closed up {odds.closedUpPct}% of {odds.sessions}
            </small>
          )}
        </div>
        <div className={`ip-tile ip-tile--${sideRec ? verdictTone(sideRec.verdict) : "flat"}`}>
          <span>{recLabel}</span>
          <b>{sideRec && sideRec.trades ? `${sideRec.winRate}% won` : "—"}</b>
          <small>{sideRec && sideRec.trades ? `${sideRec.trades} trades · ${sideRec.avgR > 0 ? "+" : ""}${num(sideRec.avgR, 2)}R each after costs` : rec ? "no past trades under these rules" : "needs 5-minute history"}</small>
          {sideRec && <small className="ip-tile__basis">{sideRec.verdict}</small>}
        </div>
      </div>

      {p.options && (
        <p className="ip-opt">
          <b>Options ({Math.round(p.options.daysToExpiry) < 1 ? "expiry today" : `${Math.round(p.options.daysToExpiry)} days to expiry`}):</b> {p.options.label} · PCR {p.options.pcr ?? "—"} · max pain {inr(p.options.maxPain, 0)} · call wall {inr(p.options.resistance, 0)} · put wall {inr(p.options.support, 0)}
          {isNum(p.options.atmIv) ? ` · ATM IV ${num(p.options.atmIv, 1)}%` : ""}
          {isNum(p.options.dayMove) ? ` · expected ±${inr(p.options.dayMove)} a day` : ""}
        </p>
      )}

      <RangeBar p={p} />

      <div className="ip-grid">
        <div className="ip-col">
          {d.kind === "orb" ? (
            <div className="ip-plan ip-plan--orb is-called">
              <header>
                <b>Opening-range break</b>
                <em>the plan</em>
              </header>
              <p>{p.plans.orb.rule}</p>
              {isNum(p.plans.orb.typicalRangePct) && <p className="ab-dim">The 9:15–9:30 range is usually about {num(p.plans.orb.typicalRangePct, 2)}% tall for this stock.</p>}
            </div>
          ) : null}
          <PlanCard side="long" plan={p.plans.long} called={d.kind === "long"} />
          <PlanCard side="short" plan={p.plans.short} called={d.kind === "short"} />
          <p className="ab-dim">Both sides are shown. Entries only after 9:30 and before 3:00 PM; everything out by 3:15 PM. A cash-market short is intraday only. Open the order ticket to trade — nothing here places an order.</p>
        </div>
        <div className="ip-col">
          <h4 className="ip-h">Levels for the day</h4>
          <ol className="ip-ladder">
            {p.ladder.map((l) => (
              <li key={`${l.label}-${l.price}`} className={`ip-lv ip-lv--${l.kind}`}>
                <span>{l.label}</span>
                <b>{inr(l.price)}</b>
                <small>{isNum(l.away) ? pct(l.away, 1) : ""}</small>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="ip-grid">
        <div className="ip-col">
          <h4 className="ip-h">For</h4>
          <ul className="ip-list ip-list--for">
            {d.for.length ? d.for.map((x) => <li key={x}>{x}</li>) : <li>Nothing stands out in favour.</li>}
          </ul>
          <h4 className="ip-h">Against</h4>
          <ul className="ip-list ip-list--against">
            {d.against.length ? d.against.map((x) => <li key={x}>{x}</li>) : <li>Nothing stands out against.</li>}
          </ul>
        </div>
        <div className="ip-col">
          <h4 className="ip-h">Before you trade it</h4>
          <ul className="ip-check">
            {d.checklist.map((x, i) => (
              <li key={x}>
                <label>
                  <input type="checkbox" checked={ticked.has(i)} onChange={() => tick(i)} />
                  <span>{x}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {p.habits ? (
        <details className="ip-more">
          <summary>
            <b>How {symbol} trades inside a day</b>
            <small>
              {p.habits.sessions} sessions, {formatDate(p.habits.from, { day: "numeric", month: "short" })} – {formatDate(p.habits.to, { day: "numeric", month: "short" })}
            </small>
          </summary>
          <Habits h={p.habits} />
        </details>
      ) : null}
      {rec ? (
        <details className="ip-more">
          <summary>
            <b>The plan's rules, replayed on past sessions</b>
            <small>
              {rec.sessions} sessions · after a {rec.costPct}% cost
            </small>
          </summary>
          <RecordTable rec={rec} />
          {rec.recent.length > 0 && (
            <div className="ip-tablewrap">
              <table className="ip-table ip-table--recent">
                <caption>Latest trades ({rec.recentPolicy === "lean" ? "followed the lean" : "either side"})</caption>
                <thead>
                  <tr>
                    <th scope="col">Day</th>
                    <th scope="col">Side</th>
                    <th scope="col">In</th>
                    <th scope="col">Entry</th>
                    <th scope="col">Exit</th>
                    <th scope="col">How</th>
                    <th scope="col">R</th>
                  </tr>
                </thead>
                <tbody>
                  {rec.recent.map((t) => (
                    <tr key={`${t.date}-${t.side}`}>
                      <td>{formatDate(t.date, { day: "numeric", month: "short" })}</td>
                      <td>{t.side}</td>
                      <td>{t.at}</td>
                      <td>{inr(t.entry)}</td>
                      <td>{inr(t.exit)}</td>
                      <td>{t.how}</td>
                      <td className={t.r > 0 ? "is-up" : t.r < 0 ? "is-down" : ""}>
                        {t.r > 0 ? "+" : ""}
                        {num(t.r, 2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="ab-dim">{rec.rule}</p>
        </details>
      ) : (
        <p className="adm-alert adm-alert--info">{p.reason}</p>
      )}
      <p className="ab-dim ip-foot">
        From the bars up to {formatDate(p.asOf, { day: "numeric", month: "short", year: "numeric" })}
        {p.stale ? " (saved data)" : ""} · lean from the Next-Session Outlook ({p.outlookBasis}) · no AI. A measurement of this stock's past — not a promise, and not advice.
      </p>
    </div>
  );
}
