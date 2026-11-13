// The live AI co-pilot card: a short second reading of the stock that is open, from
// a language model shown the same live numbers as the rule engine — the call and its
// score, the 1-minute tape, the order book, the market around it.
//
// It never gives prices to trade at and never makes the call; it says whether the
// call deserves trust right now and what to watch. Each "up" or "down" is scored
// against the price ten minutes later, and that record is printed under it.

import React from "react";
import { adminPath } from "../../paths";
import { inr, num } from "./format";
import { REASON_LABEL } from "./copilotTriggers";

const BIAS = { up: "▲ UP", down: "▼ DOWN", unclear: "◆ UNCLEAR" };
const AGREES = { yes: "agrees with the engine", partly: "partly agrees with the engine", no: "disagrees with the engine" };
const OUTCOME = { right: "right", wrong: "wrong", flat: "flat", unscored: "not scored" };

const ago = (ms) => {
  if (ms === null) return "";
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s} s ago`;
  const m = Math.round(s / 60);
  return m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

function Outcome({ o }) {
  if (!o) return null;
  if (o.status === "unscored") return <span className="cp__score is-flat">not scored — {o.note}</span>;
  return (
    <span className={`cp__score is-${o.status}`}>
      {OUTCOME[o.status]} · {o.movePct > 0 ? "+" : ""}
      {num(o.movePct)}% by {o.at}
    </span>
  );
}

export default function Copilot({ symbol, co }) {
  const { view, on, toggle, askNow, busy, note, live, ageMs } = co;

  if (!view) {
    return note.text ? (
      <div className="cp cp--off">
        <p className="vd-live__k">AI co-pilot</p>
        <p className="vd-note">{note.text}</p>
      </div>
    ) : null;
  }
  if (!view.configured) {
    return (
      <div className="cp cp--off">
        <p className="vd-live__k">AI co-pilot · off</p>
        <p className="vd-note">
          No AI API key is set, so there is no AI reading. Everything above works without it. <a href={adminPath("/ai")}>Set it up</a> to have a model read the live call, the
          1-minute tape and the order book with you.
        </p>
      </div>
    );
  }

  const s = view.settings;
  const u = view.usage;
  const rec = view.record;
  const r = view.reads[0] || null;
  const older = view.reads.slice(1, 9);
  const today = rec.today;

  return (
    <div className={`cp ${r ? `cp--${r.bias}` : ""} ${on ? "is-on" : ""}`}>
      <div className="cp__top">
        <p className="vd-live__k">
          <i className={`cp__dot ${on && live ? "is-on" : ""}`} aria-hidden="true" /> AI co-pilot
        </p>
        <div className="cp__ctl">
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm cp__switch" aria-pressed={on} onClick={toggle}>
            {on ? "Live · on" : "Go live"}
          </button>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={askNow} disabled={busy || !live}>
            {busy ? "Reading…" : "Ask now"}
          </button>
        </div>
      </div>

      {!live && <p className="vd-note">The co-pilot reads the live session only: it is available while the market is open and Zerodha is connected.</p>}

      {r ? (
        <>
          <p className="cp__head">
            <span className={`cp__bias is-${r.bias}`}>{BIAS[r.bias]}</span>
            {r.headline}
          </p>
          <p className="cp__meta">
            next 10–15 min · {r.confidence} confidence · {AGREES[r.agrees]} · {r.time} IST{ageMs !== null ? ` · ${ago(ageMs)}` : ""} · at {inr(r.price)} · {REASON_LABEL[r.reason] || r.reason}
          </p>
          <p className="cp__read">{r.reading}</p>
          {r.whatChanged && (
            <p className="cp__read">
              <b>What changed:</b> {r.whatChanged}
            </p>
          )}
          {r.watch.length > 0 && (
            <ul className="cp__watch">
              {r.watch.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {r.caution && (
            <p className="cp__caution">
              <b>Could be wrong because:</b> {r.caution}
            </p>
          )}
          {(!r.sawOrderBook || !r.sawOneMinute) && (
            <p className="vd-note">
              This reading was made without {!r.sawOrderBook && !r.sawOneMinute ? "the order book and the 1-minute tape" : !r.sawOrderBook ? "the order book" : "the 1-minute tape"} — they were not
              available at that moment.
            </p>
          )}
          {r.outcome && (
            <p className="vd-note">
              Scored: <Outcome o={r.outcome} />
            </p>
          )}
        </>
      ) : (
        <p className="vd-note">
          No reading for {symbol} yet. {live ? "Press “Ask now” for one, or “Go live” to have it read again whenever something changes." : ""}
        </p>
      )}

      {note.text && <p className={`adm-alert adm-alert--${note.kind === "error" ? "error" : "info"}`}>{note.text}</p>}

      <p className="cp__foot">
        {on ? (
          <>
            <b>Live:</b> it reads again when the call changes, a level breaks or an early warning appears
            {s.refreshMin > 0 ? `, and after ${s.refreshMin} quiet minute${s.refreshMin === 1 ? "" : "s"}` : ""} — at most once every {s.minGapSec} s, only while this tab is in front.{" "}
          </>
        ) : (
          <>
            <b>Off:</b> nothing is asked unless you press “Ask now”.{" "}
          </>
        )}
        Today {u.used} of {u.cap} readings · {num(u.inputTokens + u.outputTokens, 0)} tokens.
      </p>
      <p className="cp__foot">
        <b>Its record:</b>{" "}
        {today.scored > 0 ? `today ${today.right} right, ${today.wrong} wrong, ${today.flat} flat of ${today.scored} scored` : "nothing scored yet today"}
        {today.pending > 0 ? ` · ${today.pending} waiting to be scored` : ""}
        {today.unclear > 0 ? ` · ${today.unclear} “unclear”` : ""}
        {rec.allTime.scored > today.scored ? ` · since ${rec.allTime.since}: ${rec.allTime.right} right, ${rec.allTime.wrong} wrong of ${rec.allTime.scored}` : ""}.{" "}
        {rec.allTime.scored < 30 ? "Too few to tell skill from luck." : ""}
      </p>

      {older.length > 0 && (
        <details className="cp__hist">
          <summary>Earlier readings today ({view.reads.length - 1})</summary>
          <ol>
            {older.map((x) => (
              <li key={x.id}>
                <time>{x.time}</time>
                <span className={`cp__bias cp__bias--sm is-${x.bias}`}>{BIAS[x.bias]}</span>
                <span className="cp__histtext">
                  {x.headline}
                  <small>
                    {" "}
                    at {inr(x.price)} · <Outcome o={x.outcome} />
                    {!x.outcome && x.bias !== "unclear" ? "waiting to be scored" : ""}
                  </small>
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}

      <p className="ob__fine">
        A language model’s reading of the same numbers shown on this page, plus two web-search summaries if you made them. It sees no news beyond those, it can be confidently
        wrong, and it is not investment advice. {rec.rule}
      </p>
    </div>
  );
}
