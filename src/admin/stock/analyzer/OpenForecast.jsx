// The opening-price forecast on the Desk: two blocks in the AI strip — the most probable opening price (made
// before the market opens, final at 9:00) and, beside it, the real opening price once it is known — and the
// working behind them. The server makes, keeps, scores and learns (server/open-forecast.js); this only shows it.

import React, { useEffect, useState } from "react";
import { api } from "../../api";
import { inr, isNum, pct, when } from "./format";
import "./openfc.css";
import { everyVisible } from "../../visible";

const enc = encodeURIComponent;
const dayLabel = (date) => {
  if (!date) return "";
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
};
const signed = (x, d = 2) => (isNum(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(d)}` : "—");
const NAMES = { flat: "Opens at the previous close", index: "Index gap × this stock's sensitivity", pattern: "Yesterday's behaviour + the index gap", signals: "…plus chart, AI research, options, news" };
const SOFT = { chart: "Chart lean", research: "AI research", options: "Option chain (OI)", news: "News mood" };

/** The forecast for the stock that is open, re-read every minute (it moves before the open; the real open arrives at 9:16). */
export function useOpenForecast(symbol, enabled = true) {
  const [s, setS] = useState({ loading: Boolean(enabled), data: null, error: "" });
  useEffect(() => {
    let alive = true;
    setS({ loading: Boolean(enabled), data: null, error: "" });
    if (!enabled || !symbol) return undefined;
    const read = () =>
      api(`/api/admin/market/open-forecast/${enc(symbol)}`)
        .then((d) => alive && setS({ loading: false, data: d, error: "" }))
        .catch((e) => alive && setS((p) => ({ loading: false, data: p.data, error: e.message })));
    read();
    const id = everyVisible(read, 60000, { topics: ["open"] });
    return () => {
      alive = false;
      id();
    };
  }, [symbol, enabled]);
  return s;
}

/** How the forecast did, in a few words. */
export function verdictOf(c) {
  if (!c || !c.actual) return null;
  const off = Math.abs(c.errRs);
  const dir = c.errRs > 0 ? "high" : c.errRs < 0 ? "low" : "";
  return { inside: Boolean(c.inBand), text: off < 0.005 ? "exact" : `${inr(off)} ${dir}`, pctText: `${signed(c.errPct)}%` };
}

/** The two blocks in the strip. Pressing either shows the working. */
export function OpenChips({ fc, pressed, onShow }) {
  const d = fc.data;
  const c = d && d.current;
  const v = verdictOf(c);
  const lastV = d && d.last ? verdictOf(d.last) : null;
  const tone = c && isNum(c.gapPct) ? (c.gapPct >= 0.1 ? "up" : c.gapPct <= -0.1 ? "down" : "flat") : "flat";
  const state = !d ? "" : d.phase === "next" ? dayLabel(d.target) : d.phase === "pre" ? "today · updating" : "today · final";
  return (
    <>
      <button type="button" className="ab-mini-btn" onClick={onShow} aria-pressed={pressed} aria-label="Show the opening-price forecast" data-tip={c ? `The most probable opening price on ${dayLabel(c.date)}: ${inr(c.predicted)} (${pct(c.gapPct)} from the last close ${inr(c.prevClose)}). About 70% of opens should fall between ${inr(c.band.low)} and ${inr(c.band.high)}. Final at 9:00, when the opening auction starts. Press for the working.` : (d && d.reason) || "The opening-price forecast for this stock."}>
        <span className={`ab-mini ab-mini--${tone} of-mini`}>
          <small>Predicted open{state ? ` · ${state}` : ""}</small>
          <b>{c ? inr(c.predicted) : fc.loading ? "…" : "—"}</b>
          <small>{c ? `${pct(c.gapPct)} · band ${inr(c.band.low, 2)}–${inr(c.band.high, 2)}` : fc.error ? "not available" : d && !d.available ? "no forecast" : "from the last close"}</small>
        </span>
      </button>
      <button type="button" className="ab-mini-btn" onClick={onShow} aria-pressed={pressed} aria-label="Show the actual opening price beside the forecast" data-tip={v ? `The real opening price was ${inr(c.actual.open)}: the forecast was ${v.text} (${v.pctText} of the price), ${v.inside ? "inside" : "outside"} its band. This is kept and learned from.` : "The real opening price is written here from 9:16 on the day, beside the forecast, and kept so the forecast can learn."}>
        <span className={`ab-mini of-mini ${v ? (v.inside ? "of-mini--hit" : "of-mini--miss") : "ab-mini--flat"}`}>
          <small>Actual open{c && c.actual ? "" : d && d.phase === "auction" ? " · auction on" : ""}</small>
          <b>{c && c.actual ? inr(c.actual.open) : d && isNum(d.todayOpen) ? inr(d.todayOpen) : d && d.preopen ? `≈ ${inr(d.preopen.price)}` : "at 9:15"}</b>
          <small>
            {v
              ? `${v.text === "exact" ? "exact" : `forecast ${v.text}`} · ${v.inside ? "in band ✓" : "outside band"}`
              : d && d.preopen
                ? "indicative, not yet the open"
                : lastV
                  ? `last ${dayLabel(d.last.date)}: ${lastV.text === "exact" ? "exact" : `${lastV.text}`}`
                  : "to compare"}
          </small>
        </span>
      </button>
    </>
  );
}

/** The working: how the forecast was made, how it did, this stock's record, and what has been learned. */
export function OpenForecastPane({ symbol, fc }) {
  const d = fc.data;
  if (!d) return <p className={fc.error ? "adm-alert adm-alert--info" : "ab-dim"}>{fc.loading ? "Working out the opening price…" : fc.error || "The opening-price forecast is not available."}</p>;
  const c = d.current;
  const v = verdictOf(c);
  const L = d.learning || {};
  const st = L.stats;
  return (
    <div className="of" aria-label={`Opening-price forecast for ${symbol}`}>
      {!c && <p className="adm-alert adm-alert--info">{d.reason}</p>}
      {c && (
        <div className="of-top">
          <div className={`of-card of-card--${c.gapPct >= 0.1 ? "up" : c.gapPct <= -0.1 ? "down" : "flat"}`}>
            <small>
              Most probable open · {dayLabel(c.date)} {d.final ? "· final" : "· still updating until 9:00"}
            </small>
            <b>{inr(c.predicted)}</b>
            <span>
              {pct(c.gapPct)} from the last close {inr(c.prevClose)} ({dayLabel(c.prevDate)})
            </span>
            <span>
              About 70% of opens: {inr(c.band.low)} – {inr(c.band.high)} · usual miss ±{isNum(c.usualMissPct) ? c.usualMissPct.toFixed(2) : "—"}%
            </span>
            <span className="of-dim">
              Made {when(c.madeAt)}
              {c.revisions > 1 ? ` · revised ${c.revisions - 1}× (first: ${inr(c.first.predicted)})` : ""}
              {c.stale ? " · on saved prices: Zerodha was not connected" : ""}
            </span>
          </div>
          <div className={`of-card ${v ? (v.inside ? "of-card--hit" : "of-card--miss") : ""}`}>
            <small>Actual open {c.actual ? `· ${dayLabel(c.date)}` : ""}</small>
            <b>{c.actual ? inr(c.actual.open) : isNum(d.todayOpen) ? inr(d.todayOpen) : d.preopen ? `≈ ${inr(d.preopen.price)}` : "at 9:15"}</b>
            {v ? (
              <>
                <span>
                  The forecast was {v.text === "exact" ? "exact" : v.text} ({v.pctText} of the price) — {v.inside ? "inside its band" : "outside its band"}.
                </span>
                <span>It opened {pct(c.actual.gapPct)} from the last close; the forecast said {pct(c.gapPct)}.</span>
                <span className="of-dim">Kept, and learned from: the next forecast uses it.</span>
              </>
            ) : d.preopen ? (
              <span>The auction's indicative price right now. The real open is written here at 9:16.</span>
            ) : (
              <span>Written here from 9:16 on the day, beside the forecast, and kept so the forecast can correct itself.</span>
            )}
            {!v && d.last && (
              <span className="of-dim">
                Last time ({dayLabel(d.last.date)}): forecast {inr(d.last.predicted)}, opened {inr(d.last.actual.open)} — {verdictOf(d.last).text}, {d.last.inBand ? "in band" : "outside band"}.
              </span>
            )}
          </div>
        </div>
      )}

      {c && (
        <section className="of-sec">
          <h4>How it was made</h4>
          <div className="of-scroll">
            <table className="of-table">
              <thead>
                <tr>
                  <th scope="col">Estimate</th>
                  <th scope="col">Open</th>
                  <th scope="col">Gap</th>
                  <th scope="col">Weight</th>
                  {c.actual && <th scope="col">Missed by</th>}
                </tr>
              </thead>
              <tbody>
                {Object.entries(c.experts).map(([k, e]) => (
                  <tr key={k}>
                    <th scope="row">{NAMES[k] || k}</th>
                    <td>{inr(e.price)}</td>
                    <td className={e.gapPct > 0 ? "is-up" : e.gapPct < 0 ? "is-down" : ""}>{pct(e.gapPct)}</td>
                    <td>{e.weight}%</td>
                    {c.actual && <td>{isNum(e.missPct) ? `${e.missPct.toFixed(2)}%` : "—"}</td>}
                  </tr>
                ))}
                <tr className="of-total">
                  <th scope="row">Blended{c.bias ? `, with this stock's own bias (${signed(c.bias)}%)` : ""}</th>
                  <td>{inr(c.predicted)}</td>
                  <td className={c.gapPct > 0 ? "is-up" : c.gapPct < 0 ? "is-down" : ""}>{pct(c.gapPct)}</td>
                  <td>100%</td>
                  {c.actual && <td>{isNum(c.missPct) ? `${c.missPct.toFixed(2)}%` : "—"}</td>}
                </tr>
              </tbody>
            </table>
          </div>
          <ul className="of-notes">
            <li>
              <b>Index cue:</b>{" "}
              {c.cue && isNum(c.cue.gapPct)
                ? `the Nifty is expected to open ${pct(c.cue.gapPct)}${isNum(c.cue.usedPct) && c.cue.usedPct !== c.cue.gapPct ? ` (used as ${pct(c.cue.usedPct)}: the cue's own measured bias is taken out)` : ""}. ${c.cue.basis || ""}`
                : "none yet (Zerodha not connected, or no GIFT Nifty reading): the band is this stock's whole normal spread of opens."}
            </li>
            {c.fit && (
              <li>
                <b>This stock:</b> its opens have moved about {c.fit.beta}× the Nifty's opening gap, measured on {c.fit.sessions} sessions{c.fit.pattern ? "; yesterday's return, where it closed in its range and yesterday's own gap are weighed too" : ""}.
              </li>
            )}
            {c.tilt && c.tilt.parts.length > 0 && (
              <li>
                <b>Softer evidence</b> (a tilt only, worth what it has earned):{" "}
                {c.tilt.parts.map((p) => (
                  <span key={p.name} className={`of-chip ${p.score > 15 ? "is-up" : p.score < -15 ? "is-down" : ""}`}>
                    {SOFT[p.name] || p.name} {signed(p.score, 0)}
                  </span>
                ))}
              </li>
            )}
          </ul>
        </section>
      )}

      {d.history.length > 0 && (
        <section className="of-sec">
          <h4>
            This stock's record
            {L.own ? ` · ${L.own.n} scored · usual miss ${L.own.missPct}%${Math.abs(L.own.biasPct) >= 0.03 ? ` · tends to open ${L.own.biasPct > 0 ? "above" : "below"} its forecast by ${Math.abs(L.own.biasPct)}% (now allowed for)` : ""}` : ""}
          </h4>
          <div className="of-scroll">
            <table className="of-table">
              <thead>
                <tr>
                  <th scope="col">Session</th>
                  <th scope="col">Predicted</th>
                  <th scope="col">Actual</th>
                  <th scope="col">Forecast was</th>
                  <th scope="col">Band</th>
                </tr>
              </thead>
              <tbody>
                {d.history.map((h) => (
                  <tr key={h.date}>
                    <th scope="row">{dayLabel(h.date)}</th>
                    <td>{inr(h.predicted)}</td>
                    <td>{inr(h.open)}</td>
                    <td>{signed(h.errPct)}%</td>
                    <td className={h.inBand ? "is-up" : "is-down"}>{h.inBand ? "inside ✓" : "outside"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="of-sec">
        <h4>What it has learned</h4>
        {st ? (
          <ul className="of-notes">
            <li>
              <b>{st.n}</b> forecasts scored over <b>{st.days}</b> sessions, all stocks: average miss <b>{st.maePct}%</b> of the price — assuming “it opens at the previous close” would have missed by {st.flatMaePct}%
              {st.betterPct > 0 ? ` (${st.betterPct}% better)` : ""}. {st.insidePct}% of opens fell inside the band (the aim is about 70%).
            </li>
            {isNum(st.directionPct) && st.directionN >= 5 && (
              <li>
                When it called a gap of 0.1% or more, the open went that way <b>{st.directionPct}%</b> of the time ({st.directionN} cases).
              </li>
            )}
            {L.cue && L.cue.n >= 3 && (
              <li>
                The index cue has missed the Nifty's real opening gap by {L.cue.missPct}% on average{Math.abs(L.cue.biasPct) >= 0.03 ? `, reading ${L.cue.biasPct > 0 ? "too high" : "too low"} by ${Math.abs(L.cue.biasPct)}% — now taken out` : ""}.
              </li>
            )}
            {st.trend && (
              <li>
                Getting better? Its miss was {st.trend.earlierMaePct}% in the older half of the record and <b>{st.trend.laterMaePct}%</b> in the newer half.
              </li>
            )}
            <li className="of-dim">Weights now: {Object.entries(L.weights || {}).map(([k, w]) => `${k} ${Math.round(w * 100)}%`).join(" · ")} · band ×{L.bandScale} · soft evidence ×{L.softWorth}. Updated {when(L.updatedAt)}.</li>
          </ul>
        ) : (
          <p className="ab-dim">Nothing has been scored yet. The first forecasts are scored at 9:16 on the next trading day; from then on every open adjusts the weights, this stock's own bias, the index cue's bias and the width of the band.</p>
        )}
        {d.backtest && (
          <p className="ab-dim">
            On this stock's last {d.backtest.sessions} sessions, forecasting each from only the sessions before it and given the Nifty's real gap: average miss {d.backtest.maePct}% against {d.backtest.flatMaePct}% for “opens at the previous close”; {d.backtest.insidePct}% inside the band{isNum(d.backtest.directionPct) ? `; the gap's direction right ${d.backtest.directionPct}% of the time` : ""}. (The index's gap itself has to be forecast too, so live results are less exact.)
          </p>
        )}
      </section>

      <details className="ab-foot">
        <summary>How this works</summary>
        <p className="ab-dim">{d.rule}</p>
      </details>
    </div>
  );
}
