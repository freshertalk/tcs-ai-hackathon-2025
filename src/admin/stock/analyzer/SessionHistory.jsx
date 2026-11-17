import React, { useEffect, useMemo, useState } from "react";
import { api, peek } from "../../api";
import { Alert, Loading } from "../../ui";
import { compact, day, inr, isNum, num, pct, signed, tone } from "./format";
import { everyVisible } from "../../visible";
import { rollUp, sessionRows, summary, toCsv, weekday } from "./sessionRows";
import "./deskhist.css";

const enc = encodeURIComponent;
const PAGE = 100;
const istToday = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

const Cell = ({ v, d = 2 }) => <td className="dh-n">{isNum(v) ? num(v, d) : "—"}</td>;
const Move = ({ v, f = pct, d }) => <td className={`dh-n is-${tone(v)}`}>{f(v, d)}</td>;

/** One row per session. `forming` marks today's bar while the market is open. */
function SessionTable({ rows, forming, label }) {
  return (
    <div className="dh-scroll" tabIndex={0} role="region" aria-label={label}>
      <table className="dh-table">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Day</th>
            <th scope="col" className="dh-n">Open</th>
            <th scope="col" className="dh-n">High</th>
            <th scope="col" className="dh-n">Low</th>
            <th scope="col" className="dh-n">Close</th>
            <th scope="col" className="dh-n">Change</th>
            <th scope="col" className="dh-n">Chg %</th>
            <th scope="col" className="dh-n" title="Open against the previous close">Gap %</th>
            <th scope="col" className="dh-n" title="High minus low, as a % of the low">Range %</th>
            <th scope="col" className="dh-n" title="Where the close sat between the low (0%) and the high (100%)">Close in range</th>
            <th scope="col" className="dh-n">Volume</th>
            <th scope="col" className="dh-n" title="Volume against the average of the 20 sessions before">× avg vol</th>
            <th scope="col" className="dh-n" title="An estimate: shares traded × the day’s typical price">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.t} className={forming === r.t ? "is-forming" : undefined}>
              <th scope="row">
                {day(r.t, { day: "2-digit", month: "short", year: "numeric" })}
                {forming === r.t && <em>live</em>}
              </th>
              <td className="dh-wd">{weekday(r.t)}</td>
              <Cell v={r.o} />
              <Cell v={r.h} />
              <Cell v={r.l} />
              <td className="dh-n dh-close">{isNum(r.c) ? num(r.c) : "—"}</td>
              <Move v={r.chg} f={signed} />
              <Move v={r.chgPct} />
              <Move v={r.gapPct} />
              <Cell v={r.rangePct} />
              <td className="dh-n">
                {isNum(r.closeAt) ? (
                  <span className="dh-at" role="img" aria-label={`closed ${Math.round(r.closeAt)}% of the way up the day’s range`}>
                    <i style={{ left: `${r.closeAt}%` }} />
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="dh-n">{compact(r.v)}</td>
              <td className="dh-n">{isNum(r.volX) ? `${num(r.volX, 1)}×` : "—"}</td>
              <td className="dh-n">{isNum(r.value) ? compact(r.value) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Months or years: what the stock did over each. */
function PeriodTable({ rows, by, label }) {
  return (
    <div className="dh-scroll" tabIndex={0} role="region" aria-label={label}>
      <table className="dh-table">
        <thead>
          <tr>
            <th scope="col">{by === "year" ? "Year" : "Month"}</th>
            <th scope="col" className="dh-n">Sessions</th>
            <th scope="col" className="dh-n">Open</th>
            <th scope="col" className="dh-n">High</th>
            <th scope="col" className="dh-n">Low</th>
            <th scope="col" className="dh-n">Close</th>
            <th scope="col" className="dh-n">Change</th>
            <th scope="col" className="dh-n">Chg %</th>
            <th scope="col" className="dh-n" title="High minus low, as a % of the low">Range %</th>
            <th scope="col" className="dh-n" title="Sessions that closed above the one before">Up days</th>
            <th scope="col" className="dh-n">Volume</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.key}>
              <th scope="row">{by === "year" ? g.key : day(`${g.key}-01`, { month: "short", year: "numeric" })}</th>
              <td className="dh-n">{g.sessions}</td>
              <Cell v={g.o} />
              <Cell v={g.h} />
              <Cell v={g.l} />
              <td className="dh-n dh-close">{num(g.c)}</td>
              <Move v={g.chg} f={signed} />
              <Move v={g.chgPct} />
              <Cell v={g.rangePct} />
              <td className="dh-n">
                {g.up}
                <small> / {g.sessions}</small>
              </td>
              <td className="dh-n">{compact(g.v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The Desk's history, at the bottom of the page: the last 30 sessions of the open stock, and under them every daily bar the
 * desk holds for it (up to ten years), as sessions, months or years. Read-only; the bars are the ones the analysis already uses.
 */
export default function SessionHistory({ symbol, live = false, marketHours = false }) {
  const url = `/api/admin/market/candles/${enc(symbol)}?interval=day`;
  const [state, setState] = useState(() => {
    const seen = peek(url, 10 * 60 * 1000);
    return seen ? { loading: false, data: seen } : { loading: true };
  });
  const [view, setView] = useState("day"); // day | month | year
  const [year, setYear] = useState("all");
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    let alive = true;
    const seen = peek(url, 10 * 60 * 1000);
    setState(seen ? { loading: false, data: seen } : { loading: true });
    setYear("all");
    setShown(PAGE);
    const load = (quiet) =>
      api(url)
        .then((d) => alive && setState({ loading: false, data: d }))
        .catch((e) => alive && setState((s) => (quiet && s.data ? s : { loading: false, error: e.message })));
    load(false);
    // while the market is open, today's bar is still being written
    const stop = live && marketHours ? everyVisible(() => load(true), 60000) : null;
    return () => {
      alive = false;
      if (stop) stop();
    };
  }, [url, live, marketHours]);

  const all = useMemo(() => sessionRows(state.data && state.data.candles), [state.data]);
  const last30 = useMemo(() => all.slice(-30).reverse(), [all]);
  const sum = useMemo(() => summary(all, 30), [all]);
  const years = useMemo(() => [...new Set(all.map((r) => r.t.slice(0, 4)))].reverse(), [all]);
  const filtered = useMemo(() => (year === "all" ? all : all.filter((r) => r.t.startsWith(year))), [all, year]);
  const newestFirst = useMemo(() => [...filtered].reverse(), [filtered]);
  const months = useMemo(() => (view === "month" ? rollUp(filtered, "month").reverse() : []), [view, filtered]);
  const yearsRows = useMemo(() => (view === "year" ? rollUp(all, "year").reverse() : []), [view, all]);
  const forming = marketHours && all.length && all[all.length - 1].t === istToday() ? all[all.length - 1].t : "";

  const download = () => {
    const blob = new Blob([toCsv(filtered)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${symbol}-daily-history${year === "all" ? "" : `-${year}`}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  if (state.loading) return <Loading label={`Loading ${symbol}’s history…`} />;
  if (state.error && !all.length) {
    return (
      <section className="an-card dh" aria-label="History">
        <Alert>{state.error}</Alert>
      </section>
    );
  }
  if (!all.length) return null;

  const firstT = all[0].t;
  const lastT = all[all.length - 1].t;

  return (
    <div className="dh-wrap">
      <section className="an-card dh" aria-labelledby="dh-30">
        <header className="an-card__head">
          <h3 id="dh-30">{symbol} · last {last30.length} sessions</h3>
          <p>
            {day(sum.from)} to {day(sum.to)}, newest first. Gap is the open against the previous close; the × average volume compares each day with the 20 sessions before it.
          </p>
        </header>
        <ul className="dh-sum" aria-label="The last sessions in short">
          <li>
            <span>{sum.n}-session return</span>
            <b className={`is-${tone(sum.returnPct)}`}>{pct(sum.returnPct)}</b>
          </li>
          <li>
            <span>High</span>
            <b>{inr(sum.high)}</b>
          </li>
          <li>
            <span>Low</span>
            <b>{inr(sum.low)}</b>
          </li>
          <li>
            <span>Up / down days</span>
            <b>
              <i className="is-up">{sum.up}</i> / <i className="is-down">{sum.down}</i>
            </b>
          </li>
          <li>
            <span>Average volume</span>
            <b>{compact(sum.avgVolume)}</b>
          </li>
          <li>
            <span>Average range</span>
            <b>{isNum(sum.avgRangePct) ? `${num(sum.avgRangePct)}%` : "—"}</b>
          </li>
          {sum.best && (
            <li>
              <span>Best day</span>
              <b className="is-up">
                {pct(sum.best.chgPct)} <small>{day(sum.best.t, { day: "numeric", month: "short" })}</small>
              </b>
            </li>
          )}
          {sum.worst && (
            <li>
              <span>Worst day</span>
              <b className="is-down">
                {pct(sum.worst.chgPct)} <small>{day(sum.worst.t, { day: "numeric", month: "short" })}</small>
              </b>
            </li>
          )}
        </ul>
        <SessionTable rows={last30} forming={forming} label={`${symbol}: the last ${last30.length} sessions`} />
      </section>

      <section className="an-card dh" aria-labelledby="dh-all">
        <header className="an-card__head">
          <h3 id="dh-all">{symbol} · all history</h3>
          <p>
            {all.length.toLocaleString("en-IN")} daily bars, {day(firstT)} to {day(lastT)}
            {state.data && state.data.stale ? " · saved copy, not refreshed just now" : ""}. These are the daily bars the analysis above is built on; dividends are not included.
          </p>
        </header>
        <div className="dh-bar">
          <div className="sv__ranges" role="group" aria-label="Group the history by">
            {[
              ["day", "Sessions"],
              ["month", "Months"],
              ["year", "Years"],
            ].map(([id, label]) => (
              <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}>
                {label}
              </button>
            ))}
          </div>
          {view !== "year" && (
            <label className="dh-year">
              <span>Year</span>
              <select
                value={year}
                onChange={(e) => {
                  setYear(e.target.value);
                  setShown(PAGE);
                }}
              >
                <option value="all">All ({years.length})</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={download} data-tip="Download the sessions shown as a spreadsheet file (CSV), newest first.">
            Download CSV
          </button>
        </div>

        {view === "day" && (
          <>
            <SessionTable rows={newestFirst.slice(0, shown)} forming={forming} label={`${symbol}: every session`} />
            <div className="dh-more">
              <small>
                Showing {Math.min(shown, newestFirst.length).toLocaleString("en-IN")} of {newestFirst.length.toLocaleString("en-IN")} sessions
              </small>
              {shown < newestFirst.length && (
                <>
                  <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setShown((n) => n + PAGE)}>
                    Show {Math.min(PAGE, newestFirst.length - shown)} more
                  </button>
                  <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setShown(newestFirst.length)}>
                    Show all
                  </button>
                </>
              )}
            </div>
          </>
        )}
        {view === "month" && <PeriodTable rows={months} by="month" label={`${symbol}: month by month`} />}
        {view === "year" && <PeriodTable rows={yearsRows} by="year" label={`${symbol}: year by year`} />}
      </section>
    </div>
  );
}
