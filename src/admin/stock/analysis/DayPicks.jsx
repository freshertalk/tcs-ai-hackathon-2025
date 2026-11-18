// Trade Analysis → Robot → Day picks: the day-trading predictor (server/robot/predict.js) and the year of
// history it learns from (server/robot/history.js). Everything here is learned and kept current by the
// server by itself: a year of the NIFTY 100's 5-minute bars is read into the database as soon as Zerodha is
// connected, topped up after every close, and the predictor, its out-of-sample record and its learning points
// are rebuilt from it. Nothing has to be pressed. Measured frequencies from past sessions — never advice.

import React, { useEffect, useState } from "react";
import { api } from "../../api";
import { everyVisible } from "../../visible";
import { Alert, Loading } from "../../ui";
import { LineChart } from "./charts";
import { Chip, Tile } from "./Snapshots";

const shortDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const longDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
const pc = (x) => (typeof x === "number" ? `${Math.round(x * 100)}%` : "—");
const price = (x) => (typeof x === "number" ? x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
const sgR = (x) => (typeof x === "number" ? `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(2)}R` : "—");
const SIDE = { long: "leans up", short: "leans down", either: "either way" };

function useLoad(url, every = 0) {
  const [st, setSt] = useState({ loading: true, data: null, error: "" });
  useEffect(() => {
    let on = true;
    const load = () => api(url).then((data) => on && setSt({ loading: false, data, error: "" })).catch((e) => on && setSt((s) => ({ loading: false, data: s.data, error: e.message })));
    load();
    if (!every) return () => (on = false);
    const t = everyVisible(load, every, { topics: ["robot", "analysis"] });
    return () => {
      on = false;
      t();
    };
  }, [url, every]);
  return st;
}

/** The year of history in the database: how much, how current, and whether it is being read right now. */
export function HistoryCard({ h }) {
  if (!h) return null;
  if (h.available === false) return <p className="ta-dim">{h.reason}</p>;
  const job = h.job && !h.job.finishedAt ? h.job : null;
  return (
    <section className="ta-card rbt-hist">
      <header className="ta-card__h">
        <h3>A year of the NIFTY 100 in the database</h3>
        <Chip tone={h.upToDate ? "good" : job ? "warn" : "flat"}>{h.upToDate ? "Up to date" : job ? "Reading…" : h.connected ? "Catching up" : "Waiting for Zerodha"}</Chip>
      </header>
      <ul className="rbt-hist__facts">
        <li>
          <b>{h.stocks}</b> of {h.expected} stocks stored
        </li>
        <li>
          <b>{h.sessions}</b> sessions{h.from ? <> · {shortDay(h.from)} {String(h.from).slice(0, 4)} to {shortDay(h.to)} {String(h.to).slice(0, 4)}</> : null}
        </li>
        <li>
          <b>{(h.bars || 0).toLocaleString("en-IN")}</b> five-minute bars · {h.kb ? `${(h.kb / 1024).toFixed(1)} MB` : "—"} packed
        </li>
        <li>
          <b>{h.current}</b> of {h.expected} current to {shortDay(h.asOf)}
        </li>
      </ul>
      {job && (
        <p className="ta-dim">
          Reading {job.done} of {job.total}{job.current ? ` (${job.current})` : ""}… each stock is saved as soon as it is read, so nothing is lost if this stops.
        </p>
      )}
      <p className="ta-dim">
        It reads, learns and updates <b>by itself</b>: a year when a stock is new, the last ten days after every close, never in the half hour before the open. Nothing to press.
        {h.learned ? ` Last learned ${new Date(h.learned.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}, from history to ${shortDay(h.learned.to)}.` : ""}
        {h.error ? ` Last problem: ${h.error}` : ""}
      </p>
    </section>
  );
}

/** Rolling 20-session means of the top ten's clean-day rate and of the average stock's. */
function rolling(series) {
  return series.map((_, i) => {
    const w = series.slice(Math.max(0, i - 19), i + 1);
    const m = (k) => w.reduce((a, x) => a + x[k], 0) / w.length;
    return { date: series[i].date, top: Math.round(m("top") * 100), base: Math.round(m("base") * 100) };
  });
}

const STATE = { new: "New", stronger: "Stronger", weaker: "Weaker", steady: "" };
const KIND = { market: "What the whole NIFTY 100 does", stock: "Stocks that stand out", timing: "When the day's high and low come" };

export default function DayPicks() {
  const st = useLoad("/api/admin/robot/predictor", 15000);
  const [busy, setBusy] = useState(false);
  const d = st.data;
  if (st.loading && !d) return <Loading label="Opening the predictor…" />;
  if (!d) return <Alert>{st.error}</Alert>;
  const kick = async () => {
    setBusy(true);
    try {
      await api("/api/admin/robot/learn", { method: "POST", body: {} });
    } catch (_) {
      /* the page shows the state on its next look */
    } finally {
      setBusy(false);
    }
  };
  if (!d.available) {
    return (
      <>
        <p className="ta-empty">{d.reason}</p>
        <HistoryCard h={d.history} />
      </>
    );
  }
  const s = d.summary;
  const roll = rolling(d.series || []);
  const groups = ["market", "stock", "timing"].map((k) => ({ k, list: d.points.filter((p) => p.kind === k) })).filter((g) => g.list.length);
  return (
    <>
      <section className={`ta-card rbt-grad rbt-grad--${s.state}`}>
        <header className="ta-card__h">
          <h3>Which stocks will trend tomorrow — learned from {d.samples.toLocaleString("en-IN")} stock-sessions</h3>
          <Chip tone={s.state === "graduated" ? "good" : s.state === "not-yet" ? "warn" : "flat"}>{s.state === "graduated" ? "Ranking with evidence" : s.state === "not-yet" ? "Not yet proven" : "Learning"}</Chip>
        </header>
        <p>{s.text}</p>
        <p className="ta-dim">
          A <b>clean directional day</b> is a move of 0.6 times the stock&rsquo;s own average daily range, from the 9:30 price, before 0.3 times against it. The ranking is a count of what past sessions did after the same kind of day before, checked on sessions it had not seen — never a forecast, never advice.
        </p>
      </section>
      <div className="ta-kpis">
        <Tile label="For the session of" value={shortDay(d.nextDate)} sub={`${longDay(d.nextDate).split(",")[0]} · history to ${shortDay(d.lastDate)}`} />
        <Tile label="An average stock" value={pc(s.baseRate)} sub="gives a clean day (out of sample)" tip="Over the sessions marked out of sample: the share of all stocks that gave a clean directional day." />
        <Tile label="Its top ten" value={pc(s.topRate)} cls={s.topRate > s.baseRate ? "is-up" : ""} sub={`over ${s.evaluated} sessions marked`} tip="The ten highest-ranked stocks each session, marked against what really happened — the session was not in the counts that ranked it." />
        <Tile label="Which way it leaned" value={s.dirHitPct === null ? "—" : `${s.dirHitPct}%`} sub={`right on ${s.dirCalls} calls that named a side`} tip="Among the top ten's clean days where it named a side (up or down), how often the side was right." />
      </div>
      {roll.length > 1 && (
        <section className="ta-card ta-wide">
          <header className="ta-card__h">
            <h3>Does the ranking beat the average stock?</h3>
            <small>share of clean directional days, rolling 20 sessions, out of sample</small>
          </header>
          <LineChart xs={roll.map((x) => x.date)} series={[{ label: "Its top ten", values: roll.map((x) => x.top), c: "up" }, { label: "The average stock", values: roll.map((x) => x.base), c: "b", dashed: true }]} valueFmt={(v) => `${Math.round(v)}%`} fmt={(v) => `${Math.round(v)}%`} label="% clean days" height={200} zero={false} />
        </section>
      )}
      <section className="ta-card ta-wide">
        <header className="ta-card__h">
          <h3>The stocks most likely to trend in the next session</h3>
          <small>chance of a clean directional day, with the best levels the Level Book has for each{s.state === "graduated" ? "" : " — provisional until the ranking has proved itself"}</small>
        </header>
        <div className="lab-scroll">
          <table className="ta-table lab-table snp-table">
            <thead>
              <tr>
                <th scope="col">Stock</th>
                <th scope="col" className="is-num">Chance</th>
                <th scope="col">Why</th>
                <th scope="col">Best levels</th>
              </tr>
            </thead>
            <tbody>
              {d.picks.slice(0, 15).map((p) => (
                <tr key={p.symbol}>
                  <th scope="row">
                    <b>
                      {p.rank}. {p.symbol}
                    </b>
                    <small className="snp-sub">
                      <Chip tone={p.side === "either" ? "flat" : "warn"}>{SIDE[p.side]}</Chip> {p.side !== "either" ? `${Math.round((p.side === "long" ? p.pUp : 1 - p.pUp) * 100)}%` : ""}
                    </small>
                  </th>
                  <td className="is-num">
                    <b className="is-up">{pc(p.p)}</b>
                    <small className="snp-sub">vs {pc(p.base)} average</small>
                    <small className="snp-sub">its own {pc(p.stockRate)} of {p.stockN}</small>
                  </td>
                  <td className="snp-what">
                    {p.why.length ? p.why.map((w) => <small key={w}>{w}</small>) : <small>its own record over {p.stockN} sessions</small>}
                    <small>
                      usually ranges {p.avgRangePct}% a day; a clean day is a {p.targetPct}% move
                    </small>
                  </td>
                  <td className="snp-what">
                    {p.levels && p.levels.length ? (
                      p.levels.map((l) => (
                        <small key={l.key}>
                          {l.kindName} {price(l.level)} — {l.play === "bounce" ? "holds" : "breaks"} ({l.side}): in {price(l.entry)}, stop {price(l.stop)}, target {price(l.target)} · {sgR(l.ev)}, {l.hit}% won
                        </small>
                      ))
                    ) : (
                      <small className="ta-dim">none above zero in the book yet</small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="ta-card ta-wide">
        <header className="ta-card__h">
          <h3>What it has learned</h3>
          <small>saved and rewritten each day from the whole year · {d.points.filter((p) => p.state === "new").length} new today</small>
        </header>
        {groups.map((g) => (
          <div key={g.k} className="rbt-points">
            <h4>{KIND[g.k]}</h4>
            <ul>
              {g.list.slice(0, g.k === "stock" ? 10 : 8).map((p) => (
                <li key={p.id}>
                  <span>{p.text}</span>
                  {STATE[p.state] ? <Chip tone={p.state === "new" ? "warn" : "flat"}>{STATE[p.state]}</Chip> : null}
                  <small> since {shortDay(p.firstSeen || d.lastDate)}</small>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {d.gone && d.gone.length > 0 && <p className="ta-dim">{d.gone.length} earlier point{d.gone.length === 1 ? "" : "s"} no longer stand out and were dropped.</p>}
      </section>
      <HistoryCard h={d.history} />
      <div className="lab-bar">
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={busy} onClick={kick} data-tip="It checks every half minute by itself; this only asks it to look right now.">
          Check now
        </button>
        <small className="ta-dim">Learned {new Date(d.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · measured frequencies from past sessions, not advice.</small>
      </div>
    </>
  );
}
