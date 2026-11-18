// The Live board — the Execution Lab's plane board. Every open position, watched tick by tick by the
// server's exit coach (server/flight.js, server/trading/exitcoach.js): one word — HOLD, TIGHTEN, BOOK
// PART, EXIT NOW — an exit pressure, the price to exit at, the stop, the next target, the reasons on
// both sides, the order book, the forecast for the next 15–30 minutes, the market around it, and the
// AI Engine's second opinion and the exit levels it researched (chosen from the desk's own level map
// and checked against it before they are shown). The server pushes every look (a live stream), so the board moves with
// the price; everything shown is also recorded (the day's "CCTV") for the replay after the close.
//
// The board never trades. "Exit…" opens the order ticket, filled in, for you to confirm.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { Alert, GearButton, Loading } from "../../ui";
import { useTrade } from "../trade/TradeContext";
import { chime } from "../trade/DailyGoal";
import { rsSigned, tone } from "./charts";
import "./flight.css";
import { everyVisible } from "../../visible";

const MUTE_KEY = "vpt.flight.mute";
const WORD = { hold: "HOLD", tighten: "TIGHTEN", "book-part": "BOOK PART", "exit-now": "EXIT NOW" };
const ICON = { hold: "●", tighten: "▲", "book-part": "◆", "exit-now": "■" };
const AI_WORD = { hold: "HOLD", tighten: "TIGHTEN", "book-part": "BOOK PART", "exit-now": "EXIT NOW" };
const px = (x) => (typeof x === "number" ? x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
const pc = (x) => (typeof x === "number" ? `${x > 0 ? "+" : ""}${x.toFixed(2)}%` : "—");
const istClock = (ms) => (typeof ms === "number" ? new Date(ms + 5.5 * 3600 * 1000).toISOString().slice(11, 16) : "");
const same = (a, b) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 0.011;
/** The AI's set of levels when it has something to show. */
const liveSet = (p) => (p.levels && !p.levels.failed ? p.levels : null);
const read = (k) => {
  try {
    return window.localStorage.getItem(k);
  } catch (_) {
    return null;
  }
};

/** A board as the page uses it: every list present, whatever the server sent. */
const norm = (d) => (d && typeof d === "object" ? { ...d, positions: Array.isArray(d.positions) ? d.positions : [], landed: Array.isArray(d.landed) ? d.landed : [], other: Array.isArray(d.other) ? d.other : [], market: d.market || {}, settings: d.settings || null } : null);

/** The price since the entry, with the entry, the stop, the target and the AI's levels drawn across it. */
function Path({ p }) {
  const a = p.advice;
  const pts = (p.path || []).slice();
  if (a && a.metrics && typeof a.metrics.last === "number") pts.push([p.at || Date.now(), a.metrics.last]);
  if (pts.length < 2) return <div className="fb-path fb-path--empty">The path is drawn as the minutes come in.</div>;
  const W = 560;
  const H = 150;
  const set = liveSet(p);
  const ai = set ? set.targets.filter((t) => t.status === "open").map((t) => ({ v: t.level, label: `AI target ${t.n}` })) : [];
  const coachTarget = a && !ai.some((x) => same(x.v, a.target)) ? a.target : null; // the coach's target is often the AI's first level: one line, not two
  const lines = [p.avg, a && a.stop, coachTarget, ...ai.map((x) => x.v)].filter((v) => typeof v === "number");
  const lo = Math.min(...pts.map((x) => x[1]), ...lines);
  const hi = Math.max(...pts.map((x) => x[1]), ...lines);
  const pad = (hi - lo) * 0.08 || 1;
  const t0 = pts[0][0];
  const t1 = pts[pts.length - 1][0];
  const X = (t) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const Y = (v) => H - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * H;
  const d = pts.map((x, i) => `${i ? "L" : "M"}${X(x[0]).toFixed(1)},${Y(x[1]).toFixed(1)}`).join(" ");
  const up = a ? a.metrics.pnl >= 0 : true;
  const hline = (v, cls, label, left) =>
    typeof v === "number" ? (
      <g key={label} className={cls}>
        <line x1="0" x2={W} y1={Y(v)} y2={Y(v)} />
        <text x={left ? 4 : W - 4} y={Y(v) - 3} textAnchor={left ? "start" : "end"}>
          {label} {px(v)}
        </text>
      </g>
    ) : null;
  const ex = X(Math.max(t0, p.entryAt));
  return (
    <svg className="fb-path" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Price since the entry: entry ${px(p.avg)}, now ${a ? px(a.metrics.last) : "—"}${a ? `, stop ${px(a.stop)}, target ${px(a.target)}` : ""}${ai.length ? `; the AI's levels ${ai.map((x) => px(x.v)).join(" and ")}` : ""}`}>
      {hline(coachTarget, "fb-l fb-l--target", "target")}
      {ai.map((x) => hline(x.v, "fb-l fb-l--ai", x.label, true))}
      {hline(p.avg, "fb-l fb-l--entry", "entry")}
      {hline(a && a.stop, "fb-l fb-l--stop", "stop")}
      <line className="fb-l--in" x1={ex} x2={ex} y1="0" y2={H} />
      <path d={d} className={`fb-line ${up ? "is-up" : "is-down"}`} />
      <circle cx={X(t1)} cy={Y(pts[pts.length - 1][1])} r="4" className={`fb-dot ${up ? "is-up" : "is-down"}`} />
    </svg>
  );
}

/** The exit pressure over the flight: one thin band, coloured by the signal at each frame. */
function PressureBand({ frames }) {
  if (!frames || frames.length < 2) return null;
  const cls = ["is-hold", "is-tighten", "is-book", "is-exit"];
  return (
    <div className="fb-band" role="img" aria-label="The exit pressure since the entry">
      {frames.slice(-120).map((f) => (
        <i key={f[0]} className={cls[f[2]] || "is-hold"} style={{ height: `${Math.max(8, f[1])}%` }} />
      ))}
    </div>
  );
}

function Gauge({ label, children, tip }) {
  return (
    <div className="fb-g" data-tip={tip}>
      <span>{label}</span>
      <b>{children}</b>
    </div>
  );
}

const OUTLOOK = { with: "the wider market is with the trade", against: "the wider market is against the trade", mixed: "the wider market is mixed" };

/**
 * Exit levels: the desk's level map around the price as a ladder (every level a real price from the
 * desk's data), with the levels the AI chose from it marked — after the desk's check.
 */
function ExitLevels({ p, onResearch, busy, aiReady, record }) {
  const a = p.advice;
  const m = a.metrics;
  const long = p.side === "long";
  const set = p.levels || null;
  const shown = liveSet(p);
  const anchors = (p.map && p.map.anchors) || [];
  const rows = anchors.map((x) => ({ price: x.price, label: x.label, touchPct: x.touchPct, strength: x.strength, held: x.held || null, awayPct: typeof m.last === "number" ? ((x.price - m.last) / m.last) * 100 : x.awayPct }));
  const tagged = (price, patch) => {
    const r = rows.find((x) => same(x.price, price));
    if (r) Object.assign(r, patch);
    else rows.push({ price, awayPct: ((price - m.last) / m.last) * 100, touchPct: null, strength: null, ...patch });
  };
  if (shown) {
    for (const t of shown.targets) tagged(t.level, { tag: `T${t.n}`, kind: "target", label: t.label, why: t.why, status: t.status, at: t.reachedAt, r: t.r, limit: t.price, touchPct: t.touchPct, reach: t.reach, ...(t.held ? { held: t.held } : {}) });
    if (shown.reversal && !shown.targets.some((t) => same(t.level, shown.reversal.price))) tagged(shown.reversal.price, { tag: "TURN", kind: "turn", label: shown.reversal.label, why: shown.reversal.sign });
  }
  const st = set && set.stop ? set.stop : null;
  if (st) tagged(st.price, { tag: "STOP", kind: "stop", label: st.anchor === "coach" || st.clamped ? "The coach's stop" : `Just beyond ${st.label}`, why: st.note || st.why, status: st.status, at: st.hitAt });
  rows.push({ now: true, price: m.last });
  rows.sort((x, y) => y.price - x.price || (x.now ? 1 : -1));
  const turn = shown && shown.reversal ? shown.reversal : null;
  const done = shown && shown.targets.length > 0 && shown.targets.every((t) => t.status !== "open");
  return (
    <section className="fb-lv" aria-label={`Exit levels for ${p.symbol}`}>
      <header className="fb-lv__h">
        <h5>Exit levels</h5>
        <small>
          {set
            ? `AI-researched at ${set.clock} by ${set.by} · ${set.checks.passed} of ${set.checks.asked} of its choices passed the desk's check · confidence ${set.confidence} · ${OUTLOOK[set.outlook] || OUTLOOK.mixed}`
            : "The desk's own level map. The AI has not researched this position yet."}
        </small>
        <span className="fb-grow" />
        <button
          type="button"
          className="adm-btn adm-btn--ghost adm-btn--sm"
          onClick={() => onResearch(p.key)}
          disabled={busy || p.levelsBusy || !aiReady}
          data-tip={aiReady ? "The AI model chooses the exit levels from the desk's level map; the desk checks every one before it is shown (one paid request)." : "No AI key is saved (AI page)."}
        >
          {busy || p.levelsBusy ? "Researching…" : set ? "Research again" : "Research levels (AI)"}
        </button>
      </header>
      {set && set.failed && (
        <p className="fb-lv__note is-warn">
          None of the AI&rsquo;s targets passed the desk&rsquo;s check at {set.clock}
          {set.rejected[0] ? `: ${set.rejected[0].why}` : "."} The coach&rsquo;s own target and stop stand.
        </p>
      )}
      {shown && shown.summary && <p className="fb-lv__sum">{shown.summary}</p>}
      <div className="lab-scroll">
        <table className="fb-lv__t">
          <caption className="fb-sr">The levels around the price, from the highest down; the AI&rsquo;s choices are marked T1, T2, STOP and TURN.</caption>
          <thead>
            <tr>
              <th scope="col">Level</th>
              <th scope="col" className="is-num">
                Price
              </th>
              <th scope="col">What it is</th>
              <th scope="col" className="is-num">
                Away
              </th>
              <th scope="col" data-tip="The odds of a touch before 3:15 PM with no trend assumed, from today's one-minute moves. A yardstick for reach, not a forecast.">
                Reach
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) =>
              r.now ? (
                <tr key="now" className="is-now">
                  <th scope="row">NOW</th>
                  <td className="is-num">
                    ₹{px(r.price)}
                  </td>
                  <td colSpan="3">
                    {long ? "long" : "short"} from ₹{px(p.avg)} · <span className={tone(m.pnl)}>{pc(m.gainPct)}</span>
                  </td>
                </tr>
              ) : (
                <tr key={`${r.price}${r.tag || ""}`} className={r.kind ? `is-${r.kind}${r.status && r.status !== "open" ? " is-done" : ""}` : ""}>
                  <th scope="row">{r.tag ? <span className={`fb-tag is-${r.kind}`}>{r.tag}</span> : <span className="fb-dim">·</span>}</th>
                  <td className="is-num">
                    <b>₹{px(r.price)}</b>
                  </td>
                  <td>
                    {r.label}
                    {r.kind === "target" && (
                      <small>
                        {r.status === "reached" ? ` — reached ${istClock(r.at)}` : r.status === "after-stop" ? ` — reached ${istClock(r.at)}, after the stop` : ` — limit ₹${px(r.limit)}${typeof r.r === "number" ? ` · ${r.r}R to the stop` : ""}${r.reach ? ` · ${r.reach}` : ""}`}
                      </small>
                    )}
                    {r.kind === "stop" && r.status === "hit" && <small> — broken {istClock(r.at)}</small>}
                    {r.held && (
                      <small className="fb-lv__held" data-tip="Counted by the desk after every close: how often a level of this kind held when the price tested it (it fell back one step before closing beyond).">
                        {" "}
                        · levels like it held {r.held.pct}% of {r.held.n} tests{r.held.scope === "this stock" ? " on this stock" : ""}
                        {r.held.hour ? ` (${r.held.hour.name}, all stocks: ${r.held.hour.pct}% of ${r.held.hour.n})` : ""}
                      </small>
                    )}
                    {r.why && <small className="fb-lv__why">{r.why}</small>}
                    <small className="fb-lv__m">
                      {pc(r.awayPct)} away{typeof r.touchPct === "number" ? ` · reach ${r.touchPct}%` : ""}
                    </small>
                  </td>
                  <td className="is-num">{pc(r.awayPct)}</td>
                  <td>
                    {typeof r.touchPct === "number" ? (
                      <span className="fb-odds" role="img" aria-label={`${r.touchPct}% odds of a touch before the square-off, no trend assumed`}>
                        <i style={{ width: `${r.touchPct}%` }} />
                        <em>{r.touchPct}%</em>
                      </span>
                    ) : (
                      <span className="fb-dim">—</span>
                    )}
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
      {turn && (
        <p className="fb-lv__note">
          <b>Watch for a turn at ₹{px(turn.price)}</b> ({turn.label}){turn.sign ? `: ${turn.sign}` : "."}
        </p>
      )}
      {done && <p className="fb-lv__note">The AI&rsquo;s targets are reached. It is asked again for the rest of the trade within a few minutes (or press Research again).</p>}
      {set && set.rejected.length > 0 && !set.failed && (
        <details className="fb-lv__out" data-tip="Choices of the AI that failed the check: not on the desk’s map, a wrong price, the wrong side, closer than the costs, or out of reach today.">
          <summary>Left out by the desk&rsquo;s check ({set.rejected.length})</summary>
          <ul>
            {set.rejected.map((x) => (
              <li key={`${x.what}${x.price}${x.why}`}>{x.why}</li>
            ))}
          </ul>
        </details>
      )}
      <p className="fb-dim fb-lv__rec">
        {record && record.judged > 0 ? `The AI's levels so far, scored after each close: ${record.text}` : "Every level is a price from the desk's own data; the AI only chooses among them. Each set is scored after the close — which came first, its target or its stop — and the record is shown here."}
      </p>
    </section>
  );
}

function Strip({ p, trade, onAsk, asking, aiReady, onResearch, researching, record }) {
  const a = p.advice;
  if (!a) {
    return (
      <article className="fb-strip">
        <header className="fb-strip__h">
          <b>{p.symbol}</b> <span>reading…</span>
        </header>
      </article>
    );
  }
  const m = a.metrics;
  const long = p.side === "long";
  const book = m.book;
  const can = trade && trade.connected && trade.enabled;
  const exit = () => trade && trade.openTicket({ symbol: p.symbol, exchange: p.exchange, side: long ? "SELL" : "BUY", product: p.product, quantity: a.exit && a.state === "book-part" ? a.exit.qty : p.qty });
  return (
    <article className={`fb-strip is-${a.state}`} aria-label={`${p.symbol} ${p.side}: ${WORD[a.state]}`}>
      <header className="fb-strip__h">
        <span className={`fb-side ${long ? "is-long" : "is-short"}`}>{long ? "▲ LONG" : "▼ SHORT"}</span>
        <b className="fb-sym">{p.symbol}</b>
        <span className="fb-dim">
          {p.qty} @ ₹{px(p.avg)} · in since {p.entryClock} ({m.minutesIn} min){typeof m.minutesToSquareOff === "number" && m.minutesToSquareOff > 0 ? ` · ${m.minutesToSquareOff} min to square-off` : ""}
        </span>
        <span className="fb-grow" />
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => onAsk(p.key)} disabled={asking || !aiReady} data-tip={aiReady ? "A second opinion from the AI model on this position now (one paid request)." : "No AI key is saved (AI page)."}>
          {asking ? "Asking…" : "Ask the AI"}
        </button>
        <button type="button" className={`adm-btn adm-btn--sm ${a.state === "exit-now" ? "adm-btn--danger" : "adm-btn--solid"}`} onClick={exit} disabled={!can} data-tip={can ? "Opens the order ticket, filled in. Nothing is sent until you confirm." : "Trading is switched off or Zerodha is not connected: exit from Kite."}>
          {a.state === "book-part" ? `Book ${a.exit.qty}…` : "Exit…"}
        </button>
      </header>

      <div className="fb-top">
        <div className="fb-now">
          <span className="fb-k">Last</span>
          <b className="fb-last">₹{px(m.last)}</b>
          <span className={`fb-pnl ${tone(m.pnl)}`}>
            {rsSigned(m.pnl)} <small>{pc(m.gainPct)}</small>
          </span>
          <small className="fb-dim">
            best {rsSigned(m.peak.pnl)} at {m.peak.clock}
            {typeof m.givebackPct === "number" ? ` · given back ${m.givebackPct}%` : ""}
          </small>
        </div>

        <div className={`fb-signal is-${a.state}`} role="status" aria-live="polite" data-tip="Exit pressure, 0–100: everything that speaks for leaving now, added up — the gain given back, the tape, the order book, the levels, the forecasts, the clock. EXIT NOW from 70 in profit, from 55 at a loss.">
          <span className="fb-word">
            <i aria-hidden="true">{ICON[a.state]}</i> {WORD[a.state]}
          </span>
          <span className="fb-meter" role="img" aria-label={`Exit pressure ${a.pressure} of 100`}>
            <i style={{ width: `${a.pressure}%` }} />
          </span>
          <small>exit pressure {a.pressure} / 100</small>
        </div>

        <div className="fb-prices">
          <div className="fb-price is-exit" data-tip={a.exit.note}>
            <span>{a.state === "exit-now" ? "Exit now at" : a.state === "book-part" ? `Book ${a.exit.qty} at` : "Take profit at"}</span>
            <b>₹{px(a.exit.price)}</b>
            <small>{a.exit.how === "market" ? "at market" : a.exit.limit ? `limit ₹${px(a.exit.limit)}` : "limit"}</small>
          </div>
          <div className="fb-price is-stop">
            <span>Stop</span>
            <b>₹{px(a.stop)}</b>
            <small>{a.stopKind}</small>
          </div>
          <div className="fb-price is-target">
            <span>Next target</span>
            <b>₹{px(a.target)}</b>
            <small>{pc(((a.target - m.last) / m.last) * 100 * (long ? 1 : -1))} away</small>
          </div>
        </div>
      </div>

      <p className="fb-headline">{a.headline}</p>

      <div className="fb-mid">
        <div className="fb-chart">
          <Path p={p} />
          <PressureBand frames={p.frames} />
        </div>
        <div className="fb-gauges">
          <Gauge label="Order book" tip="Who holds more of the five best bids and offers, and the order-flow pressure (−100 sellers … +100 buyers).">
            {book ? (
              <>
                <span className="fb-book" aria-hidden="true">
                  <i style={{ width: `${book.buyersPct}%` }} />
                </span>
                buyers {book.buyersPct}% · {book.label}
              </>
            ) : (
              "waiting for the depth"
            )}
          </Gauge>
          <Gauge label="Next 30 seconds" tip="The order-flow model's lean for the next 30 seconds, learned on this stock today.">
            {book && book.lean ? (book.lean === "learning" ? "learning…" : book.lean === "none" ? "no lean" : book.lean.toUpperCase()) : "—"}
          </Gauge>
          <Gauge label="Next 15–30 min" tip="The desk's Live Pulse: its lean and the range it expects.">
            {m.pulse ? `${String(m.pulse.lean || "").toUpperCase()} (${m.pulse.score > 0 ? "+" : ""}${m.pulse.score})${typeof m.pulse.low === "number" ? ` · ₹${px(m.pulse.low)}–${px(m.pulse.high)}` : ""}` : "—"}
          </Gauge>
          <Gauge label="VWAP">{typeof m.vwap === "number" ? `₹${px(m.vwap)} (${pc(m.vsVwapPct)})` : "—"}</Gauge>
          <Gauge label="Last 3 minutes" tip="The move over the last three minutes, in your direction (+) or against you (−).">
            <span className={tone(m.move3Pct)}>{pc(m.move3Pct)}</span> · RSI {typeof m.rsi1 === "number" ? Math.round(m.rsi1) : "—"}
          </Gauge>
          <Gauge label="Bid / offer">{typeof m.bid === "number" ? `₹${px(m.bid)} / ₹${px(m.ask)}` : "—"}</Gauge>
          {p.news && (
            <Gauge label="News on it" tip={p.news.title || ""}>
              {p.news.mentions} item{p.news.mentions === 1 ? "" : "s"}, {p.news.tone}
            </Gauge>
          )}
        </div>
      </div>

      <ExitLevels p={p} onResearch={onResearch} busy={researching} aiReady={aiReady} record={record} />

      <div className="fb-why">
        <div>
          <h5>Why leave</h5>
          {a.reasons.exit.length ? (
            <ul>
              {a.reasons.exit.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : (
            <p className="fb-dim">Nothing is pressing against the position.</p>
          )}
        </div>
        <div>
          <h5>Why stay</h5>
          {a.reasons.hold.length ? (
            <ul>
              {a.reasons.hold.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : (
            <p className="fb-dim">No reason to stay shows on the tape.</p>
          )}
        </div>
      </div>

      {p.ai && (
        <p className={`fb-ai ${p.ai.agrees ? "is-same" : "is-diff"}`}>
          <b>AI ({p.ai.by}) · {p.ai.clock}:</b> <span className="fb-ai__word">{AI_WORD[p.ai.action] || p.ai.action}</span>
          {typeof p.ai.exitPrice === "number" ? ` at ₹${px(p.ai.exitPrice)}` : ""}
          {typeof p.ai.stop === "number" ? `, stop ₹${px(p.ai.stop)}` : ""} — {p.ai.reason} <small>{p.ai.agrees ? "It agrees with the desk." : `The desk said ${WORD[p.ai.deskSaid] || p.ai.deskSaid}.`}{p.ai.watch ? ` Watch: ${p.ai.watch}` : ""}</small>
        </p>
      )}

      {p.events && p.events.length > 0 && (
        <details className="fb-log">
          <summary>
            The flight so far ({p.events.length}) — latest: {p.events[p.events.length - 1].clock} {p.events[p.events.length - 1].kind === "signal" ? WORD[p.events[p.events.length - 1].state] : p.events[p.events.length - 1].kind}
          </summary>
          <ol>
            {p.events
              .slice()
              .reverse()
              .map((e) => (
                <li key={`${e.at}${e.kind}`} className={e.kind === "signal" ? `is-${e.state}` : ""}>
                  <time>{e.clock}</time> {e.text}
                </li>
              ))}
          </ol>
        </details>
      )}
    </article>
  );
}

function Settings({ s, onSave }) {
  if (!s) return null;
  return (
    <div className="fb-set">
      <label>
        <span>The AI on the board (second opinion, exit levels)</span>
        <select value={s.aiMode} onChange={(e) => onSave({ aiMode: e.target.value })}>
          <option value="change">By itself, when it is needed (recommended)</option>
          <option value="ask">Only when I ask</option>
          <option value="off">Never</option>
        </select>
      </label>
      <label>
        <span>AI requests a day, at most</span>
        <input type="number" min="0" max="300" defaultValue={s.aiDailyCap} onBlur={(e) => Number(e.target.value) !== s.aiDailyCap && onSave({ aiDailyCap: Number(e.target.value) })} />
      </label>
      <label className="fb-set__chk">
        <input type="checkbox" checked={s.notify} onChange={(e) => onSave({ notify: e.target.checked })} /> Send EXIT NOW to Telegram / WhatsApp
      </label>
      <p className="fb-dim">
        The desk&rsquo;s own coach reads every tick for free, and the level map is the desk&rsquo;s own arithmetic. The AI ({s.aiReady ? s.model : "no key saved"}) is asked for a second opinion when the signal steps up (at most once per position every five minutes) and for the exit levels only when they are needed — when a position opens, when a target is reached, when they go stale. {s.aiToday} of {s.aiDailyCap} requests used today.
      </p>
    </div>
  );
}

export default function LiveBoard({ onReplay }) {
  const trade = useTrade();
  const [b, setB] = useState(null);
  const [live, setLive] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [asking, setAsking] = useState("");
  const [researching, setResearching] = useState("");
  const [showSet, setShowSet] = useState(false);
  const [mute, setMute] = useState(() => read(MUTE_KEY) === "1");
  const liveRef = useRef(false);
  const states = useRef(new Map());
  const reached = useRef(new Set());
  const muteRef = useRef(mute);
  muteRef.current = mute;

  useEffect(() => {
    let on = true;
    let es = null;
    const load = () =>
      api("/api/admin/flight")
        .then((d) => on && setB(norm(d)))
        .catch((e) => on && setErr(e.message));
    load();
    if (typeof window !== "undefined" && typeof window.EventSource === "function") {
      try {
        es = new window.EventSource("/api/admin/flight/stream");
        es.addEventListener("board", (e) => {
          liveRef.current = true;
          setLive(true);
          setErr("");
          setB(norm(JSON.parse(e.data)));
        });
        es.addEventListener("pos", (e) => {
          const v = JSON.parse(e.data);
          setB((cur) => (cur ? { ...cur, positions: cur.positions.map((p) => (p.key === v.key ? { ...p, ...v } : p)) } : cur));
        });
        es.onerror = () => {
          liveRef.current = false;
          setLive(false);
        };
      } catch (_) {
        es = null;
      }
    }
    // without the stream the board still moves: it is read every two seconds
    const poll = everyVisible(() => !liveRef.current && load(), 2000, { topics: ["trading", "robot"] });
    return () => {
      on = false;
      if (es) es.close();
      poll();
    };
  }, []);

  // a sound the moment a position turns to EXIT NOW (and a softer one for BOOK PART)
  useEffect(() => {
    if (!b) return;
    for (const p of b.positions) {
      const now = p.advice ? p.advice.state : null;
      const was = states.current.get(p.key);
      if (was && now && now !== was && !muteRef.current) {
        if (now === "exit-now") chime("danger");
        else if (now === "book-part") chime("warning");
      }
      states.current.set(p.key, now);
      // and one when the price reaches a level the AI chose
      for (const t of (p.levels && p.levels.targets) || []) {
        const id = `${p.levels.id}:${t.n}`;
        if (t.status === "reached" && !reached.current.has(id)) {
          if (was && !muteRef.current) chime("success");
          reached.current.add(id);
        }
      }
    }
  }, [b]);

  const ask = async (key) => {
    setAsking(key);
    setMsg("");
    try {
      const r = await api("/api/admin/flight/ai", { method: "POST", body: { key } });
      setB((cur) => (cur ? { ...cur, settings: r.settings, positions: cur.positions.map((p) => (p.key === key ? { ...p, ai: r.opinion } : p)) } : cur));
    } catch (e) {
      setMsg(e.message);
    }
    setAsking("");
  };
  const research = async (key) => {
    setResearching(key);
    setMsg("");
    try {
      const r = await api("/api/admin/flight/levels", { method: "POST", body: { key } });
      setB((cur) => (cur ? { ...cur, settings: r.settings, levelsRecord: r.record, positions: cur.positions.map((p) => (p.key === key ? { ...p, levels: r.levels } : p)) } : cur));
    } catch (e) {
      setMsg(e.message);
    }
    setResearching("");
  };
  const save = async (patch) => {
    try {
      const s = await api("/api/admin/flight/settings", { method: "PUT", body: patch });
      setB((cur) => (cur ? { ...cur, settings: s } : cur));
    } catch (e) {
      setMsg(e.message);
    }
  };
  const toggleMute = () => {
    const next = !mute;
    setMute(next);
    try {
      window.localStorage.setItem(MUTE_KEY, next ? "1" : "0");
    } catch (_) {
      /* remembered for this visit only */
    }
  };

  const totals = useMemo(() => {
    if (!b) return null;
    const open = b.positions.reduce((a, p) => a + ((p.advice && p.advice.metrics.pnl) || 0), 0);
    const closed = (b.landed || []).reduce((a, f) => a + (f.pnl || 0), 0);
    const worst = b.positions.reduce((m, p) => Math.max(m, p.advice ? p.advice.pressure : 0), 0);
    return { open, closed, worst };
  }, [b]);

  if (!b && !err) return <Loading label="Opening the Live board…" />;
  if (!b) return <Alert>{err}</Alert>;
  const mk = b.market || {};
  return (
    <div className="fb">
      <div className="fb-tower" role="status">
        <span className={`fb-chip ${b.marketOpen ? "is-on" : ""}`}>
          <i aria-hidden="true" /> {b.marketOpen ? "Market LIVE" : "Market closed"}
        </span>
        <span className={`fb-chip ${live ? "is-on" : ""}`} data-tip={live ? "The server pushes every look as it happens." : "The live stream is not connected: the board is read every two seconds."}>
          <i aria-hidden="true" /> {live ? "live stream" : "every 2 s"}
        </span>
        {!b.connected && <span className="fb-chip is-bad">Zerodha not connected</span>}
        {b.connected && !b.streaming && b.marketOpen && <span className="fb-chip" data-tip="The price stream is not live, so the coach looks with a quote every two seconds and has no order book.">quotes only</span>}
        {b.marketOpen && b.minutesToSquareOff > 0 && <span className="fb-chip">{b.minutesToSquareOff} min to 3:15</span>}
        {mk.tide && (
          <span className="fb-chip" data-tip={mk.tide.summary || ""}>
            Tide {mk.tide.score > 0 ? "+" : ""}
            {mk.tide.score} · {mk.tide.label}
          </span>
        )}
        {mk.forecast && (
          <span className="fb-chip" data-tip={mk.forecast.headline || ""}>
            NSE leans {mk.forecast.word}
          </span>
        )}
        {mk.mood && <span className="fb-chip">News {mk.mood.label.toLowerCase()}</span>}
        {totals && b.positions.length > 0 && (
          <span className={`fb-chip fb-chip--pnl ${tone(totals.open)}`}>
            Open {rsSigned(totals.open)}
          </span>
        )}
        <span className="fb-grow" />
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={toggleMute} aria-pressed={!mute} data-tip="A sound when a position turns to EXIT NOW or BOOK PART, and when the price reaches a level the AI chose.">
          {mute ? "🔕 Sound off" : "🔔 Sound on"}
        </button>
        <GearButton label="Settings" tip="Settings: how the Live board reads and warns about your open positions." open={showSet} onClick={() => setShowSet((x) => !x)} />
      </div>
      {showSet && <Settings s={b.settings} onSave={save} />}
      <Alert>{msg || (b.watch && b.connected ? b.watch.error : "")}</Alert>

      {b.positions.length === 0 ? (
        <section className="ta-card fb-empty">
          <h3>{b.connected ? "No open position" : "Zerodha is not connected"}</h3>
          <p>
            {b.connected
              ? b.marketOpen
                ? "The board wakes the moment you enter a trade — long or short — and stays on it to the exit: the word (HOLD, TIGHTEN, BOOK PART, EXIT NOW), the price to exit at, the stop, the target and the reasons, on every tick."
                : "The market is closed. Tomorrow the board wakes with your first position. The replay of the last trading day is under “A day”, and what to change is under “Coach”."
              : "Log in to Kite on the Desk: the board reads your open positions from Zerodha and follows each one tick by tick."}
          </p>
          {onReplay && (
            <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" onClick={onReplay}>
              Open the day&rsquo;s replay
            </button>
          )}
        </section>
      ) : (
        b.positions.map((p) => <Strip key={p.key} p={p} trade={trade} onAsk={ask} asking={asking === p.key} aiReady={b.settings && b.settings.aiReady} onResearch={research} researching={researching === p.key} record={b.levelsRecord} />)
      )}

      {b.other && b.other.length > 0 && (
        <p className="fb-dim">
          Not coached (derivatives): {b.other.map((o) => `${o.symbol} ${o.quantity} (${rsSigned(o.pnl)})`).join(" · ")}. The coach flies NSE and BSE cash positions.
        </p>
      )}

      {b.landed && b.landed.length > 0 && (
        <section className="ta-card">
          <header className="ta-card__h">
            <h3>Landed today</h3>
            <small>
              {b.landed.length} closed · {totals ? rsSigned(totals.closed) : ""} before charges
            </small>
          </header>
          <div className="lab-scroll">
            <table className="ta-table lab-table">
              <thead>
                <tr>
                  <th scope="col">Trade</th>
                  <th scope="col" className="is-num">
                    P&amp;L
                  </th>
                  <th scope="col">Best while in</th>
                  <th scope="col">The coach said EXIT</th>
                  <th scope="col">You left</th>
                </tr>
              </thead>
              <tbody>
                {b.landed.map((f) => (
                  <tr key={f.id}>
                    <th scope="row">
                      {f.side === "long" ? "▲" : "▼"} {f.symbol}{" "}
                      <small>
                        {f.qty} @ ₹{px(f.avg)} · {f.entryClock}
                      </small>
                    </th>
                    <td className={`is-num ${tone(f.pnl)}`}>{rsSigned(f.pnl)}</td>
                    <td>{f.peak ? `${rsSigned(f.peak.pnl)} at ${f.peak.clock}${typeof f.givebackPct === "number" ? ` · gave back ${f.givebackPct}%` : ""}` : "—"}</td>
                    <td>{f.coachExit ? `${f.coachExit.clock} at ₹${px(f.coachExit.price)}` : "it never did"}</td>
                    <td>
                      {f.exitClock} at ₹{px(f.exitAvg)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {onReplay && (
            <p className="fb-dim">
              The full replay — the best moment to have left each trade, with its time — is under{" "}
              <button type="button" className="fb-link" onClick={onReplay}>
                A day
              </button>
              . Exact prices and charges come from the journal.
            </p>
          )}
        </section>
      )}
      <p className="ta-dim ta-foot">
        The coach reads the tape, the order book, the levels and the forecasts; it does not know the future and it never trades. A reading to act on or to ignore — the decision and the order are yours.
      </p>
    </div>
  );
}
