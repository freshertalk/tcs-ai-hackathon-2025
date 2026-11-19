// The 5- and 15-minute forecast on the Desk and in Research: the price, the high and the low the stock is expected to
// reach, the chance it is higher, the levels it is likely to touch — and, beside them, THE CHECK: whether each forecast
// already made turned out correct or wrong (by one stated rule), how many of the last twenty were, and what the last
// check taught. The server forecasts, checks and learns (server/horizon.js, server/market/horizon.js); this only shows it.

import React, { useEffect, useState } from "react";
import { api, peek } from "../../api";
import { everyVisible } from "../../visible";
import { useAuth } from "../../auth";
import { inr, isNum, num } from "./format";
import "./horizon.css";

const enc = encodeURIComponent;
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
const day = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—");
const pc = (x, d = 0) => (isNum(x) ? `${(x * 100).toFixed(d)}%` : "—");
const sgn = (x, d = 2) => (isNum(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(d)}%` : "—");
const tone = (x) => (!isNum(x) || x === 0 ? "flat" : x > 0 ? "up" : "down");

/** The forecast for a stock, re-read every 30 seconds while the page is visible (the server keeps one per finished 5-minute bar). */
export function useHorizon(symbol, enabled = true) {
  const url = `/api/admin/market/horizon/${enc(symbol || "")}`;
  const [s, setS] = useState(() => {
    const seen = enabled && symbol ? peek(url, 60000) : null;
    return seen ? { loading: false, data: seen, error: "" } : { loading: Boolean(enabled && symbol), data: null, error: "" };
  });
  useEffect(() => {
    let alive = true;
    if (!enabled || !symbol) return undefined;
    const seen = peek(url, 60000);
    setS(seen ? { loading: false, data: seen, error: "" } : { loading: true, data: null, error: "" });
    const read = () =>
      api(url)
        .then((d) => alive && setS({ loading: false, data: d, error: "" }))
        .catch((e) => alive && setS((p) => ({ loading: false, data: p.data, error: e.message })));
    read();
    const stop = everyVisible(read, 30000, { topics: ["horizon"] });
    return () => {
      alive = false;
      if (stop) stop();
    };
  }, [url, symbol, enabled]);
  return s;
}

/** The price path: now, 5, 10, 15, 20 and 30 minutes, the band around it, and the headline marked. */
function Path({ d }) {
  const anchor = d.anchor.price;
  const pts = [{ m: 0, price: anchor, low: anchor, high: anchor }, ...d.horizons.map((h) => ({ m: h.minutes, price: h.price, low: h.low, high: h.high }))];
  const W = 300;
  const Hh = 78;
  const pad = 6;
  const lo = Math.min(...pts.map((p) => p.low), ...(d.reach || []).map((r) => r.down.price));
  const hi = Math.max(...pts.map((p) => p.high), ...(d.reach || []).map((r) => r.up.price));
  const span = hi - lo || 1;
  const x = (m) => pad + (m / 30) * (W - 2 * pad);
  const y = (v) => Hh - pad - ((v - lo) / span) * (Hh - 2 * pad);
  const band = [...pts.map((p) => `${x(p.m)},${y(p.high)}`), ...[...pts].reverse().map((p) => `${x(p.m)},${y(p.low)}`)].join(" ");
  const line = pts.map((p) => `${x(p.m)},${y(p.price)}`).join(" ");
  const head = d.headline;
  return (
    <svg className="hz-path" viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label="The expected price over the next 30 minutes, with its band">
      <line className="hz-path__base" x1={pad} x2={W - pad} y1={y(anchor)} y2={y(anchor)} />
      <polygon className="hz-path__band" points={band} />
      <polyline className={`hz-path__line hz-path__line--${tone(head ? head.pct : 0)}`} points={line} />
      {pts.map((p) => (
        <circle
          key={p.m}
          className={`hz-path__dot ${head && p.m === head.h * 5 ? "is-head" : ""}`}
          cx={x(p.m)}
          cy={y(p.price)}
          r={head && p.m === head.h * 5 ? 4 : 2.4}
        />
      ))}
      {[0, 15, 30].map((m) => (
        <text key={m} className="hz-path__t" x={x(m)} y={Hh - 0.5} textAnchor={m === 0 ? "start" : m === 30 ? "end" : "middle"}>
          {m === 0 ? "now" : `+${m}m`}
        </text>
      ))}
    </svg>
  );
}

function Accuracy({ d }) {
  const l = d.learning || {};
  const live = d.live || {};
  const own = d.own || {};
  const g = d.headline && d.headline.grade;
  return (
    <div className="hz-acc">
      {g && <p className="hz-acc__grade">{g.text}</p>}
      <ul className="hz-acc__list">
        {live.n > 0 && (
          <li data-tip="Forecasts the desk really made while the market was open, scored 30 minutes later, for every stock followed.">
            <b>Live record</b>
            <span>
              {live.n.toLocaleString("en-IN")} forecasts · direction {pc(live.dirAcc)}
              {live.strongN ? ` · strong calls ${pc(live.strongAcc)} (${live.strongN})` : ""} · band held {pc(live.coverage)} · miss {num(live.missPct, 3)}% vs{" "}
              {num(live.naivePct, 3)}% if nothing moved
            </span>
          </li>
        )}
        {own.n > 0 && (
          <li>
            <b>This stock</b>
            <span>
              {own.n} forecasts · direction {pc(own.dirAcc)} · band held {pc(own.coverage)}
            </span>
          </li>
        )}
        {d.stock && d.stock.n > 0 && (
          <li data-tip="The model's forecasts for this stock on sessions it learned from afterwards: tested before it learned each day.">
            <b>Tested on its history</b>
            <span>
              {d.stock.n.toLocaleString("en-IN")} examples · direction {pc(d.stock.dirAcc)} · miss {num(d.stock.missPct, 3)}% vs {num(d.stock.naivePct, 3)}%
            </span>
          </li>
        )}
        {l.trained && (
          <li>
            <b>Learning</b>
            <span>
              {l.examples ? `${l.examples.toLocaleString("en-IN")} examples` : ""} · {l.stocks || "?"} stocks · history to {day(l.lastDate)} · {l.daysLearned}{" "}
              evening{l.daysLearned === 1 ? "" : "s"} learned since training{l.live && l.live.n ? ` · ${l.live.n} live forecasts taught it` : ""}
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}

/** Correct or wrong, as a small badge (or "not yet" while the forecast's time has not come). */
function Verdict({ v }) {
  if (!v) return <span className="hz-v hz-v--wait">not yet</span>;
  return (
    <span className={`hz-v hz-v--${v.ok ? "ok" : "no"}`} data-tip={v.basis === "direction" ? "It leaned one way, so it is judged on the direction the price took." : "It had no lean, so it is judged on whether the price ended inside its band."}>
      {v.ok ? "✓ Correct" : "✗ Wrong"}
    </span>
  );
}

const said = (v) => (v.side ? `${v.side === "up" ? "UP" : "DOWN"} (${pc(v.p)})` : "no clear lean");

/** One horizon of the check: the last forecast that has been checked, and the count of the last twenty. */
function CheckSide({ s, compact }) {
  const v = s.last;
  return (
    <li>
      <b>{s.minutes} min</b>
      <Verdict v={v} />
      {v ? (
        !compact && (
          <span>
            at {clock(v.made)} it said {said(v)}: {num(v.from)} → {num(v.forecast)} by {clock(v.for)}. It was {num(v.actual)} ({sgn(v.movePct)}), {v.inBand ? "inside" : "outside"} its band {num(v.low)}–{num(v.high)}
          </span>
        )
      ) : (
        <span>no forecast of this stock has reached its time yet</span>
      )}
      {s.n > 0 && (
        <i>
          last {s.n}: {s.ok} correct ({pc(s.pct)})
        </i>
      )}
      {s.all && s.all.n > s.n && (
        <i data-tip="Every forecast kept for every stock followed, over the last 45 days.">
          every stock: {s.all.ok.toLocaleString("en-IN")} of {s.all.n.toLocaleString("en-IN")} ({pc(s.all.pct)})
        </i>
      )}
    </li>
  );
}

/** The check: every forecast kept is confirmed correct or wrong when its time comes — and learned from either way. */
function Checks({ c, compact }) {
  if (!c || !c.h5 || !c.h15) return null;
  return (
    <div className="hz-check" role="group" aria-label="The check: was each forecast correct?">
      <h4 data-tip={c.rule}>The check: was it correct?</h4>
      <ul>
        <CheckSide s={c.h5} compact={compact} />
        <CheckSide s={c.h15} compact={compact} />
      </ul>
      {!compact && c.learned && <p className="hz-check__learn">{c.learned.text}</p>}
      {!compact && <p className="hz-check__rule">{c.rule}</p>}
    </div>
  );
}

function Details({ d }) {
  return (
    <div className="hz-more">
      <div className="hz-scroll">
        <table className="hz-table">
          <thead>
            <tr>
              <th>Time</th>
              <th className="hz-n">Price</th>
              <th className="hz-n">Move</th>
              <th className="hz-n">70% band</th>
              <th className="hz-n">Chance up</th>
            </tr>
          </thead>
          <tbody>
            {d.horizons.map((h) => (
              <tr key={h.minutes}>
                <th scope="row">
                  {clock(h.at)} <small>+{h.minutes} min</small>
                </th>
                <td className="hz-n">{inr(h.price)}</td>
                <td className={`hz-n is-${tone(h.pct)}`}>{sgn(h.pct)}</td>
                <td className="hz-n">
                  {num(h.low)} – {num(h.high)}
                </td>
                <td className="hz-n">{pc(h.pUp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {d.levels && d.levels.length > 0 && (
        <>
          <h4>Levels: the chance the price touches them</h4>
          <div className="hz-scroll">
            <table className="hz-table">
              <thead>
                <tr>
                  <th>Level</th>
                  <th className="hz-n">Price</th>
                  <th className="hz-n">From now</th>
                  <th className="hz-n">In 15 min</th>
                  <th className="hz-n">In 30 min</th>
                </tr>
              </thead>
              <tbody>
                {d.levels.map((l) => (
                  <tr key={`${l.name}${l.price}`}>
                    <th scope="row">{l.name}</th>
                    <td className="hz-n">{inr(l.price)}</td>
                    <td className={`hz-n is-${tone(l.distPct)}`}>{sgn(l.distPct)}</td>
                    <td className="hz-n">{pc(l.p15)}</td>
                    <td className="hz-n">{pc(l.p30)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {d.history && d.history.length > 0 && (
        <>
          <h4>The last forecasts for {d.symbol}, and what happened</h4>
          <div className="hz-scroll">
            <table className="hz-table">
              <thead>
                <tr>
                  <th>Made</th>
                  <th className="hz-n">Price then</th>
                  <th className="hz-n">5 min: forecast → actual</th>
                  <th>Check</th>
                  <th className="hz-n">15 min: forecast → actual</th>
                  <th className="hz-n">Miss</th>
                  <th>Check</th>
                </tr>
              </thead>
              <tbody>
                {d.history.map((r) => (
                  <tr key={r.at}>
                    <th scope="row">{clock(r.at)}</th>
                    <td className="hz-n">{num(r.price)}</td>
                    <td className="hz-n">{r.v5 ? `${num(r.v5.forecast)} → ${num(r.v5.actual)}` : "—"}</td>
                    <td>
                      <Verdict v={r.v5} />
                    </td>
                    <td className="hz-n">
                      {num(r.forecast)} → {num(r.actual)}
                    </td>
                    <td className="hz-n">{sgn(r.missPct, 3)}</td>
                    <td>
                      <Verdict v={r.v15 || (r.right === true || r.right === false ? { ok: r.right, basis: "direction" } : null)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="hz-rule">{d.rule}</p>
    </div>
  );
}

/** The card. `compact` is the Research row's version (no path, details folded). */
export default function HorizonCard({ symbol, enabled = true, compact = false }) {
  const h = useHorizon(symbol, enabled);
  const [more, setMore] = useState(false);
  const d = h.data;
  if (!enabled || !symbol) return null;
  if (!d)
    return (
      <section className="hz hz--wait">
        {h.error ? (
          <p className="adm-alert adm-alert--info">The 15-minute forecast is not available: {h.error}</p>
        ) : (
          <p className="hz-dim">Reading the 15-minute forecast…</p>
        )}
      </section>
    );
  const head = d.available ? d.headline : null;
  const call = head ? head.call : null;
  const head5 = d.available ? d.headline5 || null : null;
  const call5 = head5 ? head5.call : null;
  const t = tone(head ? head.pct : 0);
  return (
    <section className={`hz hz--${call && call.side ? call.side : "flat"} ${compact ? "hz--compact" : ""}`} aria-label={`The next 15 minutes for ${symbol}`}>
      <header className="hz-head">
        <h3>Next 5 and 15 minutes</h3>
        {call5 && (
          <span className={`hz-call hz-call--${call5.side || "flat"}`} data-tip={`The 5-minute call: for ${clock(head5.at)}, ${head5.minutesAhead} min ahead. Which way the model leans and the chance it gives that side.`}>
            <small>5 min</small>
            {call5.word}
            {call5.p ? <b> {pc(call5.p)}</b> : null}
          </span>
        )}
        {call && (
          <span
            className={`hz-call hz-call--${call.side || "flat"}`}
            data-tip="Which way the model leans, and the chance it gives that side. Measured: the table below says how often such calls were right."
          >
            {head5 && <small>15 min</small>}
            {call.word}
            {call.p ? <b> {pc(call.p)}</b> : null}
          </span>
        )}
        {head && (
          <small className="hz-when">
            for {clock(head.at)} · from the bar that closed at {clock(d.anchor.at)} · {head.minutesAhead} min ahead
          </small>
        )}
        {d.available && (
          <button type="button" className="hz-more-btn" onClick={() => setMore((v) => !v)} aria-expanded={more}>
            {more ? "Hide details" : "Details"}
          </button>
        )}
      </header>

      {!d.available ? (
        <p className="hz-dim" role="status">
          {d.reason || "No forecast right now."}
        </p>
      ) : (
        <>
          <div className="hz-body">
            <div className="hz-left">
              <div className="hz-grid">
                <div className={`hz-box hz-box--main is-${t}`} data-tip="The most probable price at that time.">
                  <small>Price at {clock(head.at)}</small>
                  <b>{inr(head.price)}</b>
                  <span>{sgn(head.pct)}</span>
                </div>
                <div className="hz-box" data-tip="About 70% of outcomes should land inside this band.">
                  <small>70% band</small>
                  <b>
                    {num(head.low)} – {num(head.high)}
                  </b>
                  <span>±{num(head.sdPct, 2)}% typical miss</span>
                </div>
                <div className="hz-box is-up" data-tip="How high the price is expected to reach before then.">
                  <small>Expected high</small>
                  <b>{head.reach ? inr(head.reach.up.price) : "—"}</b>
                  <span>{head.reach ? sgn(head.reach.up.pct) : ""}</span>
                </div>
                <div className="hz-box is-down" data-tip="How low the price is expected to go before then.">
                  <small>Expected low</small>
                  <b>{head.reach ? inr(head.reach.down.price) : "—"}</b>
                  <span>{head.reach ? sgn(head.reach.down.pct) : ""}</span>
                </div>
                <div className="hz-box" data-tip="The model's chance that the price is higher at that time than now.">
                  <small>Chance higher</small>
                  <b>{pc(head.pUp)}</b>
                  <span>{call && call.grade !== "none" ? `grade ${call.grade}` : "no edge"}</span>
                </div>
              </div>
              {head5 && (
                <p className={`hz-five is-${tone(head5.pct)}`} aria-label="The 5-minute forecast">
                  <b>In 5 minutes</b>
                  <span>
                    {inr(head5.price)} <em>{sgn(head5.pct)}</em> at {clock(head5.at)} ({head5.minutesAhead} min ahead)
                  </span>
                  <span>
                    band {num(head5.low)} – {num(head5.high)}
                  </span>
                  <span>chance higher {pc(head5.pUp)}</span>
                  <span>{call5 && call5.grade !== "none" ? `grade ${call5.grade}` : "no edge"}</span>
                </p>
              )}
              {d.levels && d.levels.length > 0 && (
                <ul className="hz-levels" aria-label="Levels and the chance of touching them within 15 minutes">
                  {d.levels
                    .filter((l) => isNum(l.p15))
                    .slice(0, 6)
                    .map((l) => (
                      <li
                        key={`${l.name}${l.price}`}
                        className={`is-${l.side === "above" ? "up" : "down"}`}
                        data-tip={`${l.name} ${inr(l.price)}, ${sgn(l.distPct)} from now: ${pc(l.p15)} chance of touching it within 15 minutes, ${pc(l.p30)} within 30.`}
                      >
                        <span>{l.name}</span> <b>{num(l.price)}</b> <i>{pc(l.p15)}</i>
                      </li>
                    ))}
                </ul>
              )}
              {d.why && d.why.length > 0 && (
                <p className="hz-why">
                  <b>Why (15 min):</b> {d.why.map((w) => `${w.text} ${w.side === "up" ? "↑" : "↓"}`).join(" · ")}.
                </p>
              )}
              {d.flow && (
                <p
                  className="hz-why hz-flow"
                  data-tip="Read by the market recorder at the close of the last 5-minute bar: the whole order book's quantity on each side, and the near-month future's open interest. They are added to the forecast only while they are proven, on sessions not seen before, to reduce its miss."
                >
                  <b>Order book at {d.flow.at}:</b> {isNum(d.flow.buyShare) ? `${Math.round(d.flow.buyShare * 100)}% of the quantity waiting is on the buy side` : "not read"}
                  {isNum(d.flow.oi15Pct) ? ` · futures open interest ${sgn(d.flow.oi15Pct)} in 15 min${d.flow.position ? ` (${d.flow.position})` : ""}` : ""} ·{" "}
                  {d.flow.inUse ? "counted in this forecast (proven on unseen sessions)" : `shown only: not yet proven to improve the forecast (${Number(d.flow.scored || 0).toLocaleString("en-IN")} forecasts scored so far)`}.
                </p>
              )}
            </div>
            {!compact && <Path d={d} />}
          </div>
        </>
      )}
      <Checks c={d.checks} compact={compact} />
      <Accuracy d={d} />
      {more && d.available && <Details d={d} />}
    </section>
  );
}

const MINUTES = [5, 10, 15, 20, 30];

/** What the forecaster has measured about itself, and the two buttons that make it learn. */
export function HorizonBoard() {
  const { user } = useAuth() || {};
  const owner = Boolean(user && user.role === "superadmin");
  const [s, setS] = useState({ loading: true, data: null, error: "" });
  const [msg, setMsg] = useState("");
  const read = () =>
    api("/api/admin/market/horizon")
      .then((d) => setS({ loading: false, data: d, error: "" }))
      .catch((e) => setS((p) => ({ loading: false, data: p.data, error: e.message })));
  useEffect(() => {
    read();
    const stop = everyVisible(read, 20000, { topics: ["horizon"] });
    return () => stop && stop();
  }, []);
  const run = async (path) => {
    setMsg("");
    try {
      setS({ loading: false, data: await api(path, { method: "POST" }), error: "" });
    } catch (e) {
      setMsg(e.message);
    }
  };
  const d = s.data;
  if (!d)
    return (
      <section className="hz hz--board">
        {s.error ? <p className="adm-alert adm-alert--info">{s.error}</p> : <p className="hz-dim">Reading the forecaster’s record…</p>}
      </section>
    );
  const v = d.validation;
  const busy = d.job && !d.job.finishedAt;
  return (
    <section className="hz hz--board" aria-label="How the 15-minute forecaster has done">
      <header className="hz-head">
        <h3>15-minute forecaster · what it has learned</h3>
        {d.trained ? (
          <small className="hz-when">
            learned from {d.learning.examples.toLocaleString("en-IN")} examples · to {day(d.learning.lastDate)}
          </small>
        ) : (
          <small className="hz-when">not trained yet</small>
        )}
        {owner && (
          <span className="hz-btns">
            <button
              type="button"
              className="adm-btn adm-btn--ghost adm-btn--sm"
              disabled={busy}
              onClick={() => run("/api/admin/market/horizon/train")}
              data-tip="Learn again from every stored session of the NIFTY 100 (about a year of 5-minute bars). It runs in the background and takes a few minutes."
            >
              Learn from all history
            </button>
            <button
              type="button"
              className="adm-btn adm-btn--ghost adm-btn--sm"
              disabled={busy || !d.trained}
              onClick={() => run("/api/admin/market/horizon/learn")}
              data-tip="Forecast and then learn every session newer than the last one learned. It also happens by itself at 3:40 PM."
            >
              Learn new sessions
            </button>
          </span>
        )}
      </header>
      {busy && (
        <p className="hz-job" role="status">
          {d.job.kind === "train" ? "Learning from the stored history" : "Learning the new sessions"}: {d.job.phase} — {d.job.done} of {d.job.total} stocks ·{" "}
          {d.job.rows.toLocaleString("en-IN")} examples
        </p>
      )}
      {(msg || (d.job && d.job.error)) && <p className="adm-alert adm-alert--error">{msg || d.job.error}</p>}
      {!d.trained ? (
        <p className="hz-dim">
          It learns from the NIFTY 100’s stored 5-minute history
          {d.history ? ` (${d.history.stocks} of ${d.history.expected} stocks stored, ${d.history.sessions} sessions)` : ""}. When enough is stored it trains by
          itself; the owner can also start it above. No forecast is shown until it has been tested.
        </p>
      ) : (
        <>
          {v && (
            <>
              <h4>
                Tested on sessions it had not seen ({day(v.from)} – {day(v.to)}, {v.examples.toLocaleString("en-IN")} examples, {v.stocks} stocks)
              </h4>
              <div className="hz-scroll">
                <table className="hz-table">
                  <thead>
                    <tr>
                      <th>Ahead</th>
                      <th className="hz-n">Direction right</th>
                      <th className="hz-n">When it leaned 70%+</th>
                      <th className="hz-n">Miss</th>
                      <th className="hz-n">If nothing moved</th>
                      <th className="hz-n">70% band held</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.horizons.map((x) => {
                      const strong = (x.bins || []).filter((b) => b.lo >= 0.7);
                      const calls = strong.reduce((a, b) => a + b.calls, 0);
                      const right = strong.reduce((a, b) => a + b.right, 0);
                      return (
                        <tr key={x.h}>
                          <th scope="row">{MINUTES[["1", "2", "3", "4", "6"].indexOf(String(x.h))] || x.minutes} min</th>
                          <td className="hz-n">{pc(x.dirAcc, 1)}</td>
                          <td className="hz-n">{calls ? `${pc(right / calls, 1)} (${calls.toLocaleString("en-IN")})` : "—"}</td>
                          <td className="hz-n">{num(x.missPct, 3)}%</td>
                          <td className="hz-n">{num(x.naivePct, 3)}%</td>
                          <td className="hz-n">{pc(x.coverage, 0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {d.days.length > 0 && (
            <>
              <h4>Each evening: the whole day forecast before it was learned</h4>
              <div className="hz-scroll">
                <table className="hz-table">
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th className="hz-n">Examples</th>
                      <th className="hz-n">Direction right (15 min)</th>
                      <th className="hz-n">Miss vs no move</th>
                      <th className="hz-n">Band held</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.days.slice(0, 15).map((x) => (
                      <tr key={x.date}>
                        <th scope="row">{day(x.date)}</th>
                        <td className="hz-n">{x.rows.toLocaleString("en-IN")}</td>
                        <td className="hz-n">{x.h15 ? pc(x.h15.dirAcc, 1) : "—"}</td>
                        <td className="hz-n">{x.h15 ? `${num(x.h15.missPct, 3)}% vs ${num(x.h15.naivePct, 3)}%` : "—"}</td>
                        <td className="hz-n">{x.h15 ? pc(x.h15.coverage, 0) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {d.live && d.live.n > 0 && (
            <p className="hz-why">
              <b>Live record:</b> {d.live.n.toLocaleString("en-IN")} forecasts made while the market was open · direction {pc(d.live.dirAcc, 1)}
              {d.live.strongN ? ` · calls of 70%+ right ${pc(d.live.strongAcc, 1)} (${d.live.strongN})` : ""} · band held {pc(d.live.coverage)}.
            </p>
          )}
          {d.learning.experts && (
            <p className="hz-why" data-tip="Beside the one model for the whole day there is a model for the opening hour, the middle of the day and the last ninety minutes. They are blended in only as far as they beat the single model on sessions neither had seen, and that is counted again every evening.">
              <b>Time-of-day experts:</b>{" "}
              {d.learning.experts.horizons.some((x) => x.weight > 0)
                ? d.learning.experts.horizons
                    .filter((x) => x.weight > 0)
                    .map((x) => `${x.minutes} min — weight ${Math.round(x.weight * 100)}%, error cut by ${x.gainPct}%`)
                    .join(" · ")
                : "not in use — on unseen sessions they did not beat the single model, so it stands alone"}
              . Re-judged every evening on {d.learning.experts.examples.toLocaleString("en-IN")} examples.
            </p>
          )}
          {d.learning.contest && (
            <p className="hz-why" data-tip="Several models are fitted from the same examples and judged on sessions none of them has seen. The one that missed least is used; the others keep learning, and the choice is counted again every evening. It changes only when another model is clearly ahead.">
              <b>Model in use:</b> {d.learning.contest.name}
              {d.learning.contest.candidates.filter((c) => !c.inUse && c.moreErrorPct != null).length > 0 &&
                ` — the others on the same unseen examples: ${d.learning.contest.candidates
                  .filter((c) => !c.inUse && c.moreErrorPct != null)
                  .map((c) => `${c.name} ${c.moreErrorPct >= 0 ? "+" : ""}${c.moreErrorPct}% error`)
                  .join(", ")}`}
              .{d.learning.stockScales ? ` Each stock's own scale: ${d.learning.stockScales.on ? `in use for ${d.learning.stockScales.stocks} stocks` : "not in use (it did not make the forecasts miss less)"}.` : ""}
            </p>
          )}
          {d.learning.lessons && d.learning.lessons.length > 0 && (
            <details className="hz-lessons">
              <summary>What it has learned so far ({d.learning.lessons.length} findings — also written into the AI’s skills file)</summary>
              <ul>
                {d.learning.lessons.map((l) => (
                  <li key={l.slice(0, 48)}>{l}</li>
                ))}
              </ul>
            </details>
          )}
          <p className="hz-rule">
            Direction on 5-minute to 30-minute moves is hard: a hit rate well above half is rare and valuable, and it is shown as measured, never rounded up.
            The forecaster learns from its misses every evening, calibrates its stated chances, and widens or narrows its bands to hold 70% of outcomes.
          </p>
        </>
      )}
    </section>
  );
}
