// The morning call on the Desk (server/morning.js): from the evening before to 9:45 AM, where the stock is likely to open, to be
// at 9:45 and 15 minutes on, and its half-hour's and day's high and low — made again at the auction's price (9:08) and at every
// 5-minute mark from 9:15. From 9:45 the live call leads and a line here says how the morning call did. It also carries the
// notice of when Zerodha squares off intraday (MIS) positions in this stock.

import React, { useEffect, useState } from "react";
import { api, peek } from "../../api";
import { useAuth } from "../../auth";
import { everyVisible } from "../../visible";
import { useExchangeNow } from "../../clock/exchangeClock";
import { inr, isNum, num, pct } from "./format";

const enc = encodeURIComponent;
const STAGE = {
  next: "Next session",
  pre: "Pre-market",
  preopen: "Pre-open 9:00",
  auction: "Auction price set",
  opening: "Opening",
  handover: "Morning call",
};
const pc = (p) => (isNum(p) ? `${Math.round(p * 100)}%` : "—");

/** The morning call for a stock, kept fresh: every 20 seconds and the moment a call is kept or scored. */
export function useMorning(symbol, enabled = true) {
  const url = `/api/admin/market/morning/${enc(symbol || "")}`;
  const [m, setM] = useState(() => (enabled && symbol ? peek(url, 60000) : null));
  useEffect(() => {
    let alive = true;
    if (!enabled || !symbol) return undefined;
    setM(peek(url, 60000));
    const read = () =>
      api(url)
        .then((d) => alive && setM(d))
        .catch(() => {});
    read();
    const stop = everyVisible(read, 20000, { topics: ["morning"] });
    return () => {
      alive = false;
      if (stop) stop();
    };
  }, [url, symbol, enabled]);
  return m;
}

/** "MIS auto square-off 3:12 PM", with a countdown in the last hour. */
export function MisChip({ sq, className = "" }) {
  const now = useExchangeNow(15000);
  if (!sq || !sq.clock) return null;
  const d = new Date(now + 5.5 * 3600 * 1000);
  const min = d.getUTCHours() * 60 + d.getUTCMinutes();
  const wk = d.getUTCDay() >= 1 && d.getUTCDay() <= 5;
  const left = isNum(sq.min) ? sq.min - min : null;
  const soon = wk && isNum(left) && left > 0 && left <= 60;
  const past = wk && isNum(left) && left <= 0 && min < 15 * 60 + 30;
  return (
    <span className={`mc-mis ${soon ? "is-soon" : ""} ${past ? "is-past" : ""} ${className}`.trim()} data-tip={sq.note}>
      <span aria-hidden="true">⏱</span> MIS auto square-off <b>{sq.clock}</b>
      {soon && <em> · in {left} min</em>}
      {past && <em> · done for today</em>}
    </span>
  );
}

function Fig({ k, v, note, t, tip }) {
  return (
    <div className="mc-fig" data-tip={tip}>
      <dt>{k}</dt>
      <dd>
        <b className={t ? `is-${t}` : undefined}>{v}</b>
        {note ? <small>{note}</small> : null}
      </dd>
    </div>
  );
}

/** The model's test and the desk's own record, in a few lines. */
function Record({ m, onLearn, learning, learnMsg, isOwner }) {
  const card = m.model || {};
  const rec = (m.record || []).filter((g) => g.calls > 0);
  return (
    <div className="mc-record">
      <h4>How far to trust it</h4>
      {card.trained ? (
        <ul>
          <li>
            Learned from {num(card.sessions, 0)} sessions of {card.stocks} NIFTY 100 stocks (to {card.trainedTo}); tested on the newest {card.testSessions} it never saw.
          </li>
          {(card.checks || []).map((c) => (
            <li key={c.k}>
              Call at {c.clock}: direction to 9:45 right on <b>{pc(c.dir45 && c.dir45.rate)}</b> of {c.dir45 ? num(c.dir45.called, 0) : 0} test calls that leaned; half-hour high {skill(c.skill.high30)}, low {skill(c.skill.low30)}; day high {skill(c.skill.dayHigh)}, low {skill(c.skill.dayLow)}.
            </li>
          ))}
          {card.soft && card.soft.c45 && <li>Live readings (futures build-up, auction imbalance, setup and world leans, order book): {card.soft.c45.on ? "in use" : "not in use yet"} — {card.soft.c45.why}.</li>}
        </ul>
      ) : (
        <p>
          {card.why}
          {card.error ? ` Last try: ${card.error}` : ""}
        </p>
      )}
      {rec.length > 0 && (
        <ul>
          {rec.map((g) => (
            <li key={g.group}>
              Live, {g.label.toLowerCase()}: {g.called ? `direction right on ${g.right} of ${g.called} (${pc(g.rate)})` : "no leaning call scored yet"} over {g.sessions} session{g.sessions === 1 ? "" : "s"}
              {isNum(g.inBand) ? `; the 9:45 price fell inside the band ${pc(g.inBand)} of the time` : ""}.
            </li>
          ))}
        </ul>
      )}
      {isOwner && !card.trained && (
        <p>
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={onLearn} disabled={learning || card.busy}>
            {learning || card.busy ? "Learning…" : "Learn from the stored history now"}
          </button>
          {learnMsg ? <span className="mc-learnmsg"> {learnMsg}</span> : null}
        </p>
      )}
    </div>
  );
}
const skill = (s) => (isNum(s) ? (s > 0 ? `${Math.round(s * 100)}% closer than the usual range` : "no better than the usual range") : "—");

/** One line, from 9:45 to the close: how the latest morning call did. */
export function MorningRecap({ m }) {
  if (!m || !m.today || !m.today.length) return null;
  const c = m.today.find((t) => t.result) || null;
  if (!c) return null;
  const r = c.result;
  const moved = isNum(r.at945) && isNum(c.from) ? ((r.at945 - c.from) / c.from) * 100 : null;
  return (
    <p className="mc-recap" role="status">
      <b>Morning call {new Date(c.madeAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })}:</b> {c.side === "up" ? "leaned up" : c.side === "down" ? "leaned down" : "no lean"}
      {isNum(c.p45) ? ` (${pc(c.p45)})` : ""} — 9:45 was {inr(r.at945)} ({pct(moved)}){c.side !== "none" && r.right !== null && r.right !== undefined ? (r.right ? " · right" : " · wrong") : ""}; half-hour {num(r.low30)} – {num(r.high30)} (called {num(c.levels.low30)} – {num(c.levels.high30)})
      {c.day ? `; day ${num(c.day.low)} – ${num(c.day.high)} (called ${num(c.levels.dayLow)} – ${num(c.levels.dayHigh)})` : ""}.
    </p>
  );
}

/**
 * The strip at the top of the Desk's first-sight panel while the morning call leads (the evening before to 9:45).
 * @param m       useMorning(symbol)
 * @param day     the live call (verdict.day), for its state during the opening minutes
 */
export default function MorningStrip({ m, day = null }) {
  const [open, setOpen] = useState(false);
  const [learning, setLearning] = useState(false);
  const [learnMsg, setLearnMsg] = useState("");
  const { user } = useAuth() || {};
  const isOwner = Boolean(user && user.role === "superadmin");
  if (!m || !m.show) return null;
  const c = m.call;
  const learn = () => {
    setLearning(true);
    setLearnMsg("");
    api("/api/admin/market/morning/learn", { method: "POST" })
      .then((r) => setLearnMsg(r && r.ok ? "Learned. The next call uses the model." : (r && r.reason) || ""))
      .catch((e) => setLearnMsg(e.message))
      .finally(() => setLearning(false));
  };
  if (!m.available || !c) {
    return (
      <section className="mc" aria-label="Morning call">
        <p className="mc-head">
          <span className="mc-badge">{STAGE[m.stage] || "Morning call"}</span>
          <span>Morning call — {m.reason || "not available right now."}</span>
        </p>
        {m.squareOff && <MisChip sq={m.squareOff} />}
      </section>
    );
  }
  const lv = c.levels;
  const p45 = c.chances && c.chances.up45 ? c.chances.up45.p : null;
  const side = c.side === "up" ? "up" : c.side === "down" ? "down" : "flat";
  const lean =
    c.side === "none"
      ? "no clear lean"
      : `leans ${c.side.toUpperCase()}${c.engine === "model" && isNum(p45) ? ` · ${pc(c.side === "up" ? p45 : 1 - p45)} of similar test sessions went that way by 9:45` : " (fixed rules: no record yet)"}`;
  const openFig =
    c.stage === "opening"
      ? { k: "Opened", v: inr(c.open.price), note: `gap ${pct(c.open.gapPct)}` }
      : c.stage === "auction"
        ? { k: "Auction price (9:08)", v: inr(c.open.price), note: `gap ${pct(c.open.gapPct)}`, tip: "The opening price set by the pre-open auction (9:00 – 9:08): the stock opens here at 9:15." }
        : { k: "Expected open", v: inr(c.open.price), note: c.open.band ? `${num(c.open.band[0])} – ${num(c.open.band[1])}` : `gap ${pct(c.open.gapPct)}`, tip: `From ${c.open.source}.${isNum(c.open.indicative) ? ` The auction's indicative price now: ₹${num(c.open.indicative)}.` : ""}` };
  return (
    <section className={`mc is-${side}`} aria-label="Morning call">
      <p className="mc-head">
        <span className="mc-badge">
          {STAGE[c.stage] || "Morning call"}
          {c.stage === "opening" ? ` · ${c.at}` : ""}
        </span>
        <span className="mc-lean">
          Morning call — <b>{lean}</b>
        </span>
        <button type="button" className="dg-link" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Less" : "Why · record"}
        </button>
      </p>
      <dl className="mc-figs">
        <Fig {...openFig} />
        {isNum(c.open.indicative) && c.stage === "preopen" && <Fig k="Indicative now" v={inr(c.open.indicative)} tip="The pre-open auction's indicative price while it collects orders (9:00 – 9:08). It settles at 9:08." />}
        <Fig k={`Next 15 min · ${lv.next15.at}`} v={inr(lv.next15.price)} note={pct(lv.next15.changePct)} t={lv.next15.changePct > 0 ? "up" : lv.next15.changePct < 0 ? "down" : ""} />
        <Fig k="At 9:45" v={inr(lv.at945.price)} note={lv.at945.band ? `${num(lv.at945.band[0])} – ${num(lv.at945.band[1])}` : pct(lv.at945.changePct)} t={lv.at945.changePct > 0 ? "up" : lv.at945.changePct < 0 ? "down" : ""} tip="Where the price is expected at 9:45; the band held 70% of the 9:45 prices in the test sessions." />
        <Fig k="First 30 min" v={`${num(lv.first30.low)} – ${num(lv.first30.high)}`} tip="The expected low and high from 9:15 to 9:45 (what has already traded is included)." />
        <Fig k="Day range" v={`${num(lv.day.low)} – ${num(lv.day.high)}`} note={`close ~${num(lv.day.close)}`} tip="The expected low and high for the whole session, and the close." />
      </dl>
      <p className="mc-plan">{c.plan}</p>
      <p className="mc-foot">
        {c.stage === "opening" && day && day.available && day.session && day.session.phase === "opening" && <span>Live call: no entries before 9:30 (the 9:15 – 9:30 range is forming); these are predictions.</span>}
      </p>
      {open && (
        <div className="mc-more">
          <div>
            <h4>{c.engine === "model" ? "What moved this call most" : "The votes (fixed rules)"}</h4>
            {c.engine === "model" ? (
              <ul>
                {c.drivers.map((d) => (
                  <li key={d.name}>
                    <span className={`mc-push is-${d.side}`}>{d.side === "up" ? "▲" : "▼"}</span> {d.label}
                  </li>
                ))}
              </ul>
            ) : (
              <ul>
                {(c.lean ? c.lean.votes : []).map((v) => (
                  <li key={v.name}>
                    <span className={`mc-push is-${v.vote > 0 ? "up" : "down"}`}>{v.vote > 0 ? "▲" : "▼"}</span> {v.name} <small>({v.why})</small>
                  </li>
                ))}
              </ul>
            )}
            <h4>Readings</h4>
            <ul className="mc-readings">
              <li>Gap {pct(c.open.gapPct)} · market {pct(c.market.gapPct)} <small>({c.market.source})</small></li>
              {isNum(c.soft.oi) && <li>Futures build-up {c.soft.oi > 0 ? "supportive" : "weak"} ({c.soft.oi > 0 ? "+" : ""}{c.soft.oi})</li>}
              {isNum(c.soft.preImb) && <li>Pre-open orders: {Math.round(((1 + c.soft.preImb) / 2) * 100)}% buy / {Math.round(((1 - c.soft.preImb) / 2) * 100)}% sell</li>}
              {isNum(c.soft.book) && <li>Order book: {Math.round(((1 + c.soft.book) / 2) * 100)}% of waiting shares to buy</li>}
              {isNum(c.soft.world) && <li>World lean {c.soft.world > 0 ? "+" : ""}{Math.round(c.soft.world * 100)}</li>}
              {isNum(c.soft.setup) && <li>Trade setup lean {c.soft.setup > 0 ? "+" : ""}{Math.round(c.soft.setup * 100)}</li>}
            </ul>
          </div>
          <Record m={m} onLearn={learn} learning={learning} learnMsg={learnMsg} isOwner={isOwner} />
          {m.today && m.today.length > 0 && (
            <div>
              <h4>Today's calls</h4>
              <ul>
                {m.today.slice(0, 8).map((t) => (
                  <li key={t.stage}>
                    {t.stage === "pre" ? "Pre-market" : t.stage === "auction" ? "Auction" : `${new Date(t.madeAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })}`}: {t.side === "none" ? "no lean" : `leaned ${t.side}`}, 9:45 {num(t.levels.at945)}
                    {t.result ? ` → was ${num(t.result.at945)}${t.result.right === true ? " ✓" : t.result.right === false ? " ✗" : ""}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mc-rule">{m.rule}</p>
        </div>
      )}
    </section>
  );
}
