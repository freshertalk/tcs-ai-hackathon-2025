// Early calls on the Desk and in Research: said 5 and 15 minutes BEFORE it happens —
//   TREND      up, down or sideways (the 15-minute forecaster's own call)
//   REVERSAL   while a move is on: how likely it is to turn, beside how often moves turn anyway
//   CARRY ON   …or to keep going
//   MOMENTUM   building (a large move is more likely than usual), fading (a quiet stretch is), or steady
// and THE CHECK beside them: every call kept is checked 5 and 15 minutes later, and the screen says how often a warned
// reversal (or a called large move) really came. The server calls, checks and learns (server/ahead.js,
// server/market/ahead.js); this only shows it. A number here is a measured frequency, never a promise.

import React, { useEffect, useState } from "react";
import { api, peek } from "../../api";
import { everyVisible } from "../../visible";
import { useAuth } from "../../auth";
import { isNum } from "./format";
import "./horizon.css";
import "./ahead.css";

const enc = encodeURIComponent;
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
const day = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—");
const pc = (x) => (isNum(x) ? `${Math.round(x * 100)}%` : "—");
const sgn = (x, d = 2) => (isNum(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(d)}%` : "—");
const TIER = { likely: "LIKELY", raised: "RAISED", low: "LOW", usual: "usual" };
const KIND = { turn: "Reversal", go: "Carry on", big: "Large move", calm: "Quiet stretch" };

/** The early calls for a stock, re-read every 30 seconds while the page is visible (the server keeps one set per finished 5-minute bar). */
export function useAhead(symbol, enabled = true) {
  const url = `/api/admin/market/ahead/${enc(symbol || "")}`;
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
    const stop = everyVisible(read, 30000, { topics: ["ahead", "horizon"] });
    return () => {
      alive = false;
      if (stop) stop();
    };
  }, [url, symbol, enabled]);
  return s;
}

/** A probability against its usual rate: a bar filled to the call, with a tick where "usual" is. */
function Meter({ p, usual, tone }) {
  if (!isNum(p)) return null;
  const at = (x) => Math.round(Math.max(0, Math.min(100, x * 100)) * 10) / 10; // a share as a width, to a tenth of a percent
  const w = Math.max(2, at(p));
  return (
    <span className={`ah-meter ah-meter--${tone}`} aria-hidden="true">
      <i style={{ width: `${w}%` }} />
      {isNum(usual) && <u style={{ left: `${at(usual)}%` }} />}
    </span>
  );
}

/** One call: its name, what it is called, the measured chance and the usual rate. */
function Line({ label, call, tone, tip, word }) {
  if (!call) return null;
  const quietCall = call.tier === "usual";
  // only a warning (raised or likely) wears the colour; "low" and "usual" stay plain
  const t = call.tier === "raised" || call.tier === "likely" ? tone : "flat";
  return (
    <div className={`ah-line ah-line--${t}`} data-tip={`${tip}${call.proven ? "" : " This call has not yet beaten “always the usual rate” on sessions it had not seen, so it is not used: read it as the usual rate."}`}>
      <span className="ah-line__k">{label}</span>
      <span className={`ah-tier ah-tier--${quietCall ? "usual" : call.tier}`}>{word || TIER[call.tier]}</span>
      <span className="ah-line__v">
        <b>{pc(call.p)}</b>
        <small>usual {pc(call.usual)}</small>
      </span>
      <Meter p={call.p} usual={call.usual} tone={t} />
      {!call.proven && <small className="ah-unproven">not proven yet</small>}
    </div>
  );
}

function Horizon({ h, dir }) {
  const m = h.momentum;
  const state = m.state;
  const moveTone = dir === "up" ? "up" : "down";
  return (
    <div className={`ah-col ah-col--${h.tone}`}>
      <header className="ah-col__head">
        <b>Next {h.key} minutes</b>
        <small>
          for {clock(h.at)} · {h.minutesAhead} min ahead
        </small>
      </header>
      {h.trend && (
        <div className={`ah-line ah-line--${h.trend.side || "flat"}`} data-tip="The 15-minute forecaster's own call for this time: which way it leans and the chance it gives that side.">
          <span className="ah-line__k">Trend</span>
          <span className={`ah-tier ah-tier--${h.trend.side || "usual"}`}>{h.trend.word}</span>
          <span className="ah-line__v">
            {h.trend.p ? <b>{pc(h.trend.p)}</b> : <b>—</b>}
            <small>{sgn(h.trend.pct)} expected</small>
          </span>
        </div>
      )}
      {h.reversal ? (
        <>
          <Line label="Reversal" call={h.reversal} tone="warn" tip={`The chance that the ${dir}-move turns — gives back at least half a usual move — within these minutes, measured on sessions the model had not seen.`} />
          <Line label="Carry on" call={h.follow} tone={moveTone} tip={`The chance that the ${dir}-move adds at least half a usual move the same way within these minutes.`} />
        </>
      ) : (
        <div className="ah-line ah-line--flat" data-tip="A reversal is only spoken of while a move is on: the last 15 minutes must have covered most of a usual 15-minute move.">
          <span className="ah-line__k">Reversal</span>
          <span className="ah-tier ah-tier--usual">no move on</span>
          <span className="ah-line__v">
            <small>nothing to turn</small>
          </span>
        </div>
      )}
      <Line
        label="Momentum"
        word={state === "building" ? "BUILDING" : state === "fading" ? "FADING" : "steady"}
        call={state === "fading" ? m.calm : m.big}
        tone={state === "building" ? "accent" : "quiet"}
        tip={state === "fading" ? "The chance that the price stays quiet (under 0.4 of a usual move) over these minutes." : "The chance of a large move (a whole usual move or more, either way) over these minutes."}
      />
      <p className="ah-read">{h.read}</p>
      {(h.why.reversal.length > 0 || h.why.momentum.length > 0) && (
        <p className="ah-why">
          <b>Why:</b>{" "}
          {[...h.why.reversal.map((w) => ({ ...w, of: "a turn" })), ...h.why.momentum.map((w) => ({ ...w, of: state === "fading" ? "a quiet stretch" : "a large move" }))]
            .slice(0, 4)
            .map((w, i) => (
              <span key={`${w.key}-${w.of}`}>
                {i > 0 ? "; " : ""}
                {w.text} <i>({w.side === "for" ? "raises" : "lowers"} {w.of})</i>
              </span>
            ))}
          .
        </p>
      )}
    </div>
  );
}

/** One line of the check: how many times it was said, how often the thing then came, against the usual rate. */
function CheckLine({ label, x, came = "came" }) {
  if (!x || !x.said) return null;
  const rate = x.came / x.said;
  return (
    <li>
      <b>{label}</b> said {x.said} time{x.said === 1 ? "" : "s"}: it {came} <b>{x.came}</b> ({pc(rate)}
      {isNum(x.usual) ? `; usual ${pc(x.usual)}` : ""})
    </li>
  );
}

function Check({ record, symbol, single = false }) {
  const own = record.own;
  const all = record.all;
  const any = (t) => t && t.calls > 0;
  const lines = (t, key) => [
    <CheckLine key={`t${key}`} label={`Reversal warning, ${key} min:`} x={t[key].turn} came="turned" />,
    <CheckLine key={`g${key}`} label={`Carry-on call, ${key} min:`} x={t[key].go} came="carried on" />,
    <CheckLine key={`b${key}`} label={`Momentum building, ${key} min:`} x={t[key].big} came="made a large move" />,
    <CheckLine key={`c${key}`} label={`Momentum fading, ${key} min:`} x={t[key].calm} came="stayed quiet" />,
  ];
  return (
    <div className="ah-check">
      <h4>The check — was each call right?</h4>
      {!any(all) ? (
        <p className="hz-dim">No call has been checked yet. Each one is checked 5 and 15 minutes after it is made, while the market is open.</p>
      ) : (
        <div className="ah-check__cols">
          {!single && (
            <div>
              <small>
                {symbol}: {own.calls} call{own.calls === 1 ? "" : "s"} checked
              </small>
              <ul>{any(own) ? [...lines(own, 5), ...lines(own, 15)] : <li>None of this stock’s calls has been checked yet.</li>}</ul>
            </div>
          )}
          <div>
            <small>
              Every stock followed: {all.calls} call{all.calls === 1 ? "" : "s"} checked
            </small>
            <ul>{[...lines(all, 5), ...lines(all, 15)]}</ul>
          </div>
        </div>
      )}
      {record.trend && record.trend[3] && record.trend[3].n > 0 && (
        <p className="hz-dim">
          Trend calls (the forecaster’s): {record.trend[1].ok} of {record.trend[1].n} correct at 5 minutes, {record.trend[3].ok} of {record.trend[3].n} at 15.
        </p>
      )}
    </div>
  );
}

/** The measured record on sessions the model had not seen: one row per call. */
function Proof({ learning }) {
  if (!learning || !learning.trained) return null;
  return (
    <div className="hz-scroll">
      <table className="hz-table ah-table">
        <caption>Measured on sessions the model had not seen (to {day(learning.lastDate)}; {learning.days} evening{learning.days === 1 ? "" : "s"} learned since training)</caption>
        <thead>
          <tr>
            <th scope="col">Call</th>
            <th scope="col">Ahead</th>
            <th scope="col">Usual rate</th>
            <th scope="col">When warned, it came</th>
            <th scope="col">When called unlikely, it came</th>
            <th scope="col">Examples</th>
            <th scope="col">Used?</th>
          </tr>
        </thead>
        <tbody>
          {learning.targets.map((t) => (
            <tr key={t.target}>
              <th scope="row">{KIND[t.kind]}</th>
              <td>{t.minutes} min</td>
              <td>{pc(t.usual)}</td>
              <td>
                {t.said ? (
                  <>
                    <b>{pc(t.saidRate)}</b> <small>of {t.said.toLocaleString("en-IN")}</small>
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td>
                {t.low ? (
                  <>
                    <b>{pc(t.lowRate)}</b> <small>of {t.low.toLocaleString("en-IN")}</small>
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td>{t.n.toLocaleString("en-IN")}</td>
              <td>
                <span className={`hz-v ${t.proven ? "hz-v--ok" : "hz-v--wait"}`} data-tip={t.proven ? "It has beaten “always the usual rate” on unseen sessions, so its calls are named." : "It has not beaten “always the usual rate” on unseen sessions (or has too few examples), so it is shown at the usual rate only."}>
                  {t.proven ? "Proven" : "Not yet"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Last({ rows }) {
  if (!rows || !rows.length) return null;
  const cell = (list) =>
    list.length ? (
      list.map((s) => (
        <span key={s.kind} className={`hz-v ${s.ok === null ? "hz-v--wait" : s.ok ? "hz-v--ok" : "hz-v--no"}`} data-tip={`${KIND[s.kind]} was ${s.said === "warned" ? `called ${TIER[s.tier].toLowerCase()} (${pc(s.p)}, usual ${pc(s.usual)})` : `called unlikely (${pc(s.p)}, usual ${pc(s.usual)})`}; it ${s.happened ? "happened" : "did not happen"}.`}>
          {KIND[s.kind]} {s.said === "warned" ? "↑" : "↓"} {s.ok === null ? "…" : s.ok ? "✓" : "✗"}
        </span>
      ))
    ) : (
      <small className="hz-dim">no call</small>
    );
  return (
    <div className="hz-scroll">
      <table className="hz-table ah-table">
        <caption>The last calls checked for this stock (↑ warned, ↓ called unlikely)</caption>
        <thead>
          <tr>
            <th scope="col">Made</th>
            <th scope="col">Move on</th>
            <th scope="col">5 min later</th>
            <th scope="col">Calls, 5 min</th>
            <th scope="col">15 min later</th>
            <th scope="col">Calls, 15 min</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.at}>
              <th scope="row">{clock(r.at)}</th>
              <td>{r.run ? r.dir : "none"}</td>
              <td>{sgn(r.move5)}</td>
              <td className="ah-cells">{cell(r.c5)}</td>
              <td>{sgn(r.move15)}</td>
              <td className="ah-cells">{cell(r.c15)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AheadCard({ symbol, enabled = true, compact = false, state = null }) {
  const own = useAhead(symbol, enabled && !state);
  const s = state || own;
  const [more, setMore] = useState(false);
  const d = s.data;
  if (!enabled || !symbol) return null;
  if (!d)
    return (
      <section className="hz hz--wait ah">
        {s.error ? <p className="adm-alert adm-alert--info">The early calls are not available: {s.error}</p> : <p className="hz-dim">Reading the early calls…</p>}
      </section>
    );
  const mv = d.available ? d.move : null;
  const lead = d.available ? d.horizons[d.horizons.length - 1] : null;
  return (
    <section className={`hz ah ah--${lead ? lead.tone : "none"} ${compact ? "hz--compact" : ""}`} aria-label={`Early calls for ${symbol}: trend, reversal and momentum, 5 and 15 minutes ahead`}>
      <header className="hz-head">
        <h3>Early calls — trend, reversal, momentum</h3>
        {mv && (
          <span className={`hz-call hz-call--${mv.on ? mv.dir : "flat"}`} data-tip={`The last 15 minutes: ${sgn(mv.pct15)} (a usual 15-minute move for this stock is about ${isNum(mv.usual15Pct) ? mv.usual15Pct.toFixed(2) : "—"}%). A move is “on” when most of a usual move has been covered.`}>
            {mv.on ? `${mv.dir === "up" ? "UP" : "DOWN"}-MOVE ON` : "NO MOVE ON"} <b>{sgn(mv.pct15)}</b>
          </span>
        )}
        {d.available && (
          <small className="hz-when">
            from the bar that closed at {clock(d.anchor.at)}
            {mv && mv.on && mv.bars > 1 ? ` · ${mv.bars} bars in a row the same way` : ""}
          </small>
        )}
        <button type="button" className="hz-more-btn" onClick={() => setMore((v) => !v)} aria-expanded={more}>
          {more ? "Hide details" : "Details"}
        </button>
      </header>

      {!d.available ? (
        <p className="hz-dim" role="status">
          {d.reason || "No early call right now."}
        </p>
      ) : (
        <div className="ah-cols">
          {d.horizons.map((h) => (
            <Horizon key={h.key} h={h} dir={mv.dir} />
          ))}
        </div>
      )}

      <Check record={d.record} symbol={symbol} />

      {more && (
        <div className="hz-more">
          <Proof learning={d.learning} />
          <Last rows={d.record.last} />
          <p className="hz-check__rule">{d.checkRule}</p>
          <p className="hz-check__rule">{d.rule}</p>
        </div>
      )}
      {!d.trained && d.learning && d.learning.job && !d.learning.job.finishedAt && (
        <p className="hz-dim" role="status">
          Learning now: {d.learning.job.phase} ({(d.learning.job.rows || 0).toLocaleString("en-IN")} bars read).
        </p>
      )}
    </section>
  );
}

/** In Research: what the early calls have learned and how they have done, day by day, on sessions they had not seen. */
export function AheadBoard() {
  const { user } = useAuth() || {};
  const owner = Boolean(user && user.role === "superadmin");
  const [s, setS] = useState({ loading: true, data: null, error: "" });
  const [msg, setMsg] = useState("");
  const read = () =>
    api("/api/admin/market/ahead")
      .then((d) => setS({ loading: false, data: d, error: "" }))
      .catch((e) => setS((p) => ({ loading: false, data: p.data, error: e.message })));
  useEffect(() => {
    read();
    const stop = everyVisible(read, 20000, { topics: ["ahead"] });
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
        {s.error ? <p className="adm-alert adm-alert--info">{s.error}</p> : <p className="hz-dim">Reading the early calls’ record…</p>}
      </section>
    );
  const busy = d.job && !d.job.finishedAt;
  const rate = (t) => (t && t.said ? `${pc(t.saidRate)} of ${t.said.toLocaleString("en-IN")}` : "—");
  return (
    <section className="hz hz--board" aria-label="How the early calls have done">
      <header className="hz-head">
        <h3>Early calls · what they have learned</h3>
        {d.trained ? (
          <small className="hz-when">
            learned from {d.learning.rows.all.toLocaleString("en-IN")} bars ({d.learning.rows.run.toLocaleString("en-IN")} with a move on) · to {day(d.learning.lastDate)}
          </small>
        ) : (
          <small className="hz-when">not trained yet — they train by themselves right after the 15-minute forecaster</small>
        )}
        {owner && (
          <span className="hz-btns">
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={busy} onClick={() => run("/api/admin/market/ahead/train")} data-tip="Learn again from every stored session of the NIFTY 100. It runs in the background and takes a few minutes. No AI is used.">
              Learn from all history
            </button>
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={busy || !d.trained} onClick={() => run("/api/admin/market/ahead/learn")} data-tip="Call, check and then learn every session newer than the last one learned. It also happens by itself at 3:45 PM.">
              Learn new sessions
            </button>
          </span>
        )}
      </header>
      {msg && <p className="adm-alert adm-alert--info">{msg}</p>}
      {busy && (
        <p className="hz-job" role="status">
          {d.job.kind === "train" ? "Training" : "Learning"}: {d.job.phase} · {(d.job.rows || 0).toLocaleString("en-IN")} bars read
        </p>
      )}
      {d.error && !busy && <p className="hz-dim">Last problem: {d.error}</p>}
      <Proof learning={d.learning} />
      {d.days.length > 0 && (
        <div className="hz-scroll">
          <table className="hz-table ah-table">
            <caption>Each evening’s unseen day, called before it was learned: how often the thing came after it was called (15 minutes ahead)</caption>
            <thead>
              <tr>
                <th scope="col">Session</th>
                <th scope="col">Reversal warned → turned</th>
                <th scope="col">usual</th>
                <th scope="col">Carry-on called → carried on</th>
                <th scope="col">usual</th>
                <th scope="col">Large move called → came</th>
                <th scope="col">usual</th>
                <th scope="col">Quiet called → stayed quiet</th>
                <th scope="col">usual</th>
              </tr>
            </thead>
            <tbody>
              {d.days.map((x) => (
                <tr key={x.date}>
                  <th scope="row">{day(x.date)}</th>
                  <td>{rate(x.turn15)}</td>
                  <td>{pc(x.turn15 && x.turn15.usual)}</td>
                  <td>{rate(x.go15)}</td>
                  <td>{pc(x.go15 && x.go15.usual)}</td>
                  <td>{rate(x.big15)}</td>
                  <td>{pc(x.big15 && x.big15.usual)}</td>
                  <td>{rate(x.calm15)}</td>
                  <td>{pc(x.calm15 && x.calm15.usual)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Check record={{ own: d.live, all: d.live, trend: d.trend }} symbol="" single />
      <p className="hz-check__rule">{d.checkRule}</p>
      <p className="hz-check__rule">{d.rule}</p>
    </section>
  );
}
