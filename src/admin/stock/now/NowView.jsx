// Now — the command screen: everything the desk is watching, on one page, live.
//   THE MARKET     the NIFTY tide, India VIX, GIFT NIFTY, the sectors
//   YOUR POSITIONS each with its P&L at the streamed price and the evidence for its next 15 minutes: with you or against you
//   THE BOARD      every followed stock: its price as it ticks, the call for 5 and 15 minutes, how many readings lean each
//                  way, any early call (a reversal warned, momentum building) — strongest proven leans first
//   THE CHECKS     how the calls have done so far, counted by the server
//   THE SYSTEMS    what every automatic system is doing right now
// Prices come down the tick stream; everything else is re-read the moment the server says it changed (the live channel)
// and every 20 seconds as a safety net. Nothing here places an order. Read 58% as 58%.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, peek } from "../../api";
import { everyVisible } from "../../visible";
import { useLive } from "../../live";
import { useLiveTicks } from "../analyzer/liveTicks";
import { useLiveBook } from "../trade/liveBook";
import { PositionEvidence, usePositionEvidence } from "../analyzer/EvidenceCard";
import { isNum } from "../analyzer/format";
import "../analyzer/evidence.css";
import "./now.css";

const URL = "/api/admin/market/now";
const TOPICS = ["evidence", "horizon", "ahead", "market", "automation", "trading", "health"];
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
const pc = (x) => (isNum(x) ? `${Math.round(x * 100)}%` : "—");
const sgn = (x, d = 2) => (isNum(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(d)}%` : "—");
const px = (x) => (isNum(x) ? x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
const money = (x) => (isNum(x) ? `${x < 0 ? "−" : "+"}₹${Math.abs(Math.round(x)).toLocaleString("en-IN")}` : "—");
const LEAN = { up: "UP", down: "DOWN", none: "—" };
const STATE = { on: "On", learning: "Learning", "standing-by": "Standing by", "needs-zerodha": "Needs Zerodha", "needs-you": "Needs you", "click-only": "Click only", off: "Off", unknown: "Unknown", attention: "Needs you" };
const LIVE_WORD = { live: "Live — every change shows at once", connecting: "Connecting…", reconnecting: "Reconnecting…", offline: "Offline — showing the last reading", idle: "Starting…" };

/** A price that shows it has just moved: a short flash, green up, red down (off when you have turned motion off). */
function LivePrice({ value }) {
  const prev = useRef(value);
  const dir = isNum(value) && isNum(prev.current) && value !== prev.current ? (value > prev.current ? "up" : "down") : "";
  useEffect(() => {
    prev.current = value;
  }, [value]);
  return (
    <span key={dir ? value : "same"} className={`nw-px ${dir ? `is-${dir}` : ""}`}>
      {px(value)}
    </span>
  );
}

/** One horizon's call as a chip: the side, the chance, and whether a lean of that firmness is proven. */
function Lean({ c }) {
  if (!c) return <span className="nw-lean nw-lean--none">—</span>;
  if (c.lean === "none")
    return (
      <span className="nw-lean nw-lean--none" data-tip={`No clear lean: a rise ${pc(c.pUp)} (usual ${pc(c.usualUp)}), a fall ${pc(c.pDown)} (usual ${pc(c.usualDown)}).`}>
        no lean
      </span>
    );
  return (
    <span className={`nw-lean nw-lean--${c.lean} ${c.proven ? "is-proven" : ""}`} data-tip={`The evidence ${c.tier === "strong" ? "points" : c.tier === "clear" ? "leans" : "leans slightly"} ${LEAN[c.lean]} by ${clock(c.at)}: ${pc(c.p)} against a usual ${pc(c.lean === "up" ? c.usualUp : c.usualDown)}. ${c.proven ? "A lean this firm is proven on unseen sessions." : "A lean this firm is not yet proven: read it with care."}`}>
      <b>
        {c.lean === "up" ? "▲" : "▽"} {LEAN[c.lean]} {pc(c.p)}
      </b>
      <small>{c.proven ? "proven" : c.tier}</small>
    </span>
  );
}

/** How many readings lean each way, as two bars from the middle. */
function Split({ up, down }) {
  const total = Math.max(1, up + down);
  return (
    <span className="nw-split" data-tip={`${up} readings lean up, ${down} lean down (techniques and live readings together).`}>
      <span className="nw-split__n is-up">{up}</span>
      <span className="nw-split__bar" aria-hidden="true">
        <i className="is-up" style={{ width: `${Math.round((up / total) * 100)}%` }} />
        <i className="is-down" style={{ width: `${Math.round((down / total) * 100)}%` }} />
      </span>
      <span className="nw-split__n is-down">{down}</span>
    </span>
  );
}

const EARLY = { warn: "turn?", up: "carry on ▲", down: "carry on ▽", alert: "momentum building", quiet: "going quiet" };

/** How strongly a row asks to be looked at: a proven lean first, then any lean, then a warning; no reading last. */
const weight = (r) => {
  if (!r.available) return -1;
  const c = r.calls && r.calls[15];
  const edge = c && c.lean !== "none" ? Math.abs(c.p - (c.lean === "up" ? c.usualUp : c.usualDown)) : 0;
  return (c && c.lean !== "none" ? (c.proven ? 2 : 1) : 0) + edge + (r.early && r.early.tone === "warn" ? 0.05 : 0);
};

export default function NowView({ onOpen }) {
  const [s, setS] = useState(() => {
    const seen = peek(URL, 60000);
    return seen ? { loading: false, d: seen, error: "" } : { loading: true, d: null, error: "" };
  });
  const [show, setShow] = useState("all");
  useEffect(() => {
    let alive = true;
    const read = () =>
      api(URL)
        .then((d) => alive && setS({ loading: false, d, error: "" }))
        .catch((e) => alive && setS((p) => ({ loading: false, d: p.d, error: e.message })));
    read();
    const stop = everyVisible(read, 20000, { topics: TOPICS });
    return () => {
      alive = false;
      if (stop) stop();
    };
  }, []);
  const conn = useLive();
  const d = s.d;
  const key = d ? d.rows.map((r) => r.symbol).join(",") : "";
  const symbols = useMemo(() => (key ? key.split(",") : []), [key]);
  const ticks = useLiveTicks(symbols, symbols.length > 0);
  const book = useLiveBook();
  const held = useMemo(() => (book && book.available && Array.isArray(book.positions) ? book.positions.filter((p) => p.quantity !== 0 && p.exchange === "NSE") : []), [book]);
  const heldEv = usePositionEvidence(held.map((p) => ({ symbol: p.symbol, side: p.quantity > 0 ? "long" : "short" })));

  if (!d)
    return (
      <section className="nw" aria-label="Now">
        <header className="nw-head">
          <h2>Now</h2>
        </header>
        {s.error ? <p className="adm-alert adm-alert--info">{s.error}</p> : <p className="nw-dim">Reading the market, the followed stocks and the systems…</p>}
      </section>
    );

  const rows = [...d.rows].sort((a, b) => weight(b) - weight(a));
  const c15 = (r) => (r.available && r.calls ? r.calls[15] : null);
  const count = {
    all: rows.length,
    up: rows.filter((r) => c15(r) && c15(r).lean === "up").length,
    down: rows.filter((r) => c15(r) && c15(r).lean === "down").length,
    warn: rows.filter((r) => r.early && (r.early.tone === "warn" || r.early.tone === "alert")).length,
  };
  const shown = rows.filter((r) => (show === "all" ? true : show === "warn" ? r.early && (r.early.tone === "warn" || r.early.tone === "alert") : c15(r) && c15(r).lean === show));
  const m = d.market || {};
  const t15 = d.liveCalls && d.liveCalls[3];
  const f15 = d.checks && d.checks.forecaster && d.checks.forecaster[3];
  const lastOf = (r) => (ticks.slow[r.symbol] && isNum(ticks.slow[r.symbol].last) ? ticks.slow[r.symbol].last : r.last);
  const dayPct = (r) => {
    const t = ticks.slow[r.symbol];
    return t && isNum(t.last) && isNum(t.prevClose) && t.prevClose > 0 ? ((t.last - t.prevClose) / t.prevClose) * 100 : r.changePct;
  };
  const working = (d.systems || []).filter((x) => x.state === "on").length;

  return (
    <section className="nw" aria-label="Now: everything the desk is watching">
      <header className="nw-head">
        <div>
          <h2>Now</h2>
          <p className="nw-dim">Everything the desk is watching, on one page. Prices tick; the calls, the checks and the systems refresh the moment they change.</p>
        </div>
        <span className={`nw-conn is-${conn.status}`} role="status">
          <i aria-hidden="true" /> {LIVE_WORD[conn.status] || conn.status}
          {d.at ? <small> · read {clock(d.at)}</small> : null}
        </span>
      </header>
      {s.error && <p className="adm-alert adm-alert--info">{s.error}</p>}

      <div className="nw-tiles" aria-label="The market now">
        {m.available ? (
          <>
            <div className={`nw-tile nw-tile--${m.tide && m.tide.label === "Rising" ? "up" : m.tide && m.tide.label === "Falling" ? "down" : "flat"}`} data-tip={m.tide ? m.tide.summary : ""}>
              <small>NIFTY tide</small>
              <b>{m.tide ? m.tide.label : "—"}</b>
              <span>NIFTY {sgn(m.nifty && m.nifty.changePct)}</span>
            </div>
            <div className="nw-tile" data-tip="India VIX: the market's own measure of expected swings. A jump goes with selling.">
              <small>India VIX</small>
              <b>{m.vix && isNum(m.vix.last) ? m.vix.last.toFixed(2) : "—"}</b>
              <span>{sgn(m.vix && m.vix.changePct)} today</span>
            </div>
            <div className="nw-tile" data-tip="GIFT NIFTY: NIFTY futures on the international exchange, set against NIFTY itself.">
              <small>GIFT NIFTY</small>
              <b>{m.gift ? sgn(m.gift.changePct) : "—"}</b>
              <span>{m.gift && m.nifty && isNum(m.nifty.changePct) ? `${sgn(m.gift.changePct - m.nifty.changePct)} vs NIFTY` : "not read"}</span>
            </div>
            <div className="nw-tile" data-tip={(m.sectors || []).map((x) => `${x.name} ${sgn(x.changePct)}`).join(" · ")}>
              <small>Sectors</small>
              <b>{m.breadth ? `${m.breadth.up} up · ${m.breadth.down} down` : "—"}</b>
              <span>{m.sectors && m.sectors.length ? `best ${m.sectors[0].name} ${sgn(m.sectors[0].changePct)}` : ""}</span>
            </div>
          </>
        ) : (
          <div className="nw-tile nw-tile--wide">
            <small>The market</small>
            <b>Not read</b>
            <span>{m.reason || "Connect Zerodha to read NIFTY, the sectors, India VIX and GIFT NIFTY."}</span>
          </div>
        )}
        <div className="nw-tile" data-tip="Of the stocks on the board, how many the evidence leans up, down, or carries an early call for, over the next 15 minutes.">
          <small>The board, next 15 min</small>
          <b>
            <span className="is-up">▲ {count.up}</span> <span className="is-down">▽ {count.down}</span>
          </b>
          <span>
            {count.warn} early call{count.warn === 1 ? "" : "s"} · {count.all} followed
          </span>
        </div>
        <div className="nw-tile" data-tip="Every call is kept and checked 15 minutes later. A lean counts as right when the price ended on the side it named. These are the live checks on this desk, not a promise.">
          <small>Checked so far, 15 min</small>
          <b>{t15 && t15.n ? `${pc(t15.ok / t15.n)} of ${t15.n.toLocaleString("en-IN")}` : "none yet"}</b>
          <span>{f15 && f15.n ? `forecaster ${pc(f15.ok / f15.n)} of ${f15.n.toLocaleString("en-IN")}` : "the forecaster has no checks yet"}</span>
        </div>
        <div className="nw-tile" data-tip="The AI is asked about a stock you open only when its readings are undecided, within the daily limit (AI page).">
          <small>AI reads today</small>
          <b>
            {d.ai ? d.ai.usedToday : 0} of {d.ai ? d.ai.perDay : 0}
          </b>
          <span>{d.ai && d.ai.record && d.ai.record.n ? `right ${pc(d.ai.record.right)} of ${d.ai.record.n} checked` : d.ai && d.ai.mode === "off" ? "switched off" : "none checked yet"}</span>
        </div>
      </div>

      {held.length > 0 && (
        <div className="nw-card" aria-label="Your open positions">
          <h3>
            Your positions <small>{held.length} open · P&amp;L at the streamed price</small>
          </h3>
          <ul className="nw-pos">
            {held.map((p) => {
              const side = p.quantity > 0 ? "long" : "short";
              return (
                <li key={`${p.symbol}:${p.product}`}>
                  <button type="button" className="nw-sym" onClick={() => onOpen && onOpen(p.symbol)} data-tip="Open this stock on the Desk">
                    {p.symbol}
                  </button>
                  <span className={`nw-side is-${side}`}>
                    {side === "long" ? "▲ LONG" : "▼ SHORT"} {Math.abs(p.quantity)}
                  </span>
                  <span className="nw-dim">
                    avg {px(p.average)} · now <LivePrice value={p.last} />
                  </span>
                  <b className={p.pnl >= 0 ? "is-up" : "is-down"}>{money(p.pnl)}</b>
                  <PositionEvidence reading={heldEv[`${p.symbol}|${side}`]} />
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="nw-card" aria-label="The board">
        <div className="nw-bar">
          <h3>
            The board <small>strongest proven leans first</small>
          </h3>
          <div className="nw-filter" role="group" aria-label="Show">
            {[
              ["all", `All ${count.all}`],
              ["up", `Leaning up ${count.up}`],
              ["down", `Leaning down ${count.down}`],
              ["warn", `Early calls ${count.warn}`],
            ].map(([id, label]) => (
              <button key={id} type="button" className={`nw-chip ${show === id ? "is-on" : ""}`} aria-pressed={show === id} onClick={() => setShow(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {!d.trained && <p className="nw-note">The evidence desk has not learned yet: it trains by itself once the 15-minute forecaster is ready, and the calls appear then. Prices, the market and the systems on this page are live now.</p>}
        {rows.length === 0 ? (
          <p className="nw-dim">No stock is followed yet. Add stocks to the watchlist on the Desk: each one appears here with its calls.</p>
        ) : shown.length === 0 ? (
          <p className="nw-dim">Nothing on the board matches that filter right now.</p>
        ) : (
          <div className="nw-scroll">
            <table className="nw-table">
              <thead>
                <tr>
                  <th scope="col">Stock</th>
                  <th scope="col" className="is-num">Price</th>
                  <th scope="col">Next 15 min</th>
                  <th scope="col">Next 5 min</th>
                  <th scope="col">Readings</th>
                  <th scope="col">Early call</th>
                  <th scope="col" className="is-num">vs VWAP</th>
                  <th scope="col" className="is-num">Volume</th>
                  <th scope="col">
                    <span className="adm-sr">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const day = dayPct(r);
                  return (
                    <tr key={r.symbol} className={r.available ? "" : "is-off"}>
                      <th scope="row">
                        <button type="button" className="nw-sym" onClick={() => onOpen && onOpen(r.symbol)} data-tip="Open this stock on the Desk: the chart, the whole evidence board and the order book">
                          {r.symbol}
                        </button>
                        {r.available && r.top && r.top.length > 0 && <small className="nw-top">{r.top.map((x) => `${x.state > 0 ? "▲" : "▽"} ${x.name}`).join(" · ")}</small>}
                        {!r.available && <small className="nw-top">{r.reason}</small>}
                      </th>
                      <td className="is-num">
                        <LivePrice value={lastOf(r)} />
                        <small className={isNum(day) ? (day >= 0 ? "is-up" : "is-down") : ""}>{sgn(day)}</small>
                      </td>
                      <td>{r.available ? <Lean c={r.calls[15]} /> : null}</td>
                      <td>{r.available ? <Lean c={r.calls[5]} /> : null}</td>
                      <td>{r.available ? <Split up={r.up} down={r.down} /> : null}</td>
                      <td>
                        {r.available && r.early && EARLY[r.early.tone] ? (
                          <span className={`nw-early nw-early--${r.early.tone}`} data-tip={r.early.read}>
                            {EARLY[r.early.tone]}
                          </span>
                        ) : (
                          <span className="nw-dim">{r.available ? "nothing unusual" : ""}</span>
                        )}
                      </td>
                      <td className={`is-num ${isNum(r.vsVwapPct) ? (r.vsVwapPct >= 0 ? "is-up" : "is-down") : ""}`}>{r.available ? sgn(r.vsVwapPct) : ""}</td>
                      <td className="is-num">{r.available && isNum(r.volumeX) ? `${r.volumeX}×` : ""}</td>
                      <td>
                        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => onOpen && onOpen(r.symbol)}>
                          Desk
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="nw-card" aria-label="The automatic systems">
        <h3>
          The automatic systems <small>{working} of {(d.systems || []).length} running</small>
        </h3>
        <ul className="nw-sys">
          {(d.systems || []).map((x) => (
            <li key={x.id} className={`is-${x.state}`} data-tip={x.detail}>
              <i aria-hidden="true" />
              <b>{x.name}</b>
              <span className="nw-sys__state">{STATE[x.state] || x.state}</span>
              <small>{x.detail}</small>
            </li>
          ))}
        </ul>
      </div>
      <p className="nw-foot">A call is a measured chance, never a promise: most leans are a few points over the usual rate, and each is checked 15 minutes later. Nothing on this page places an order.</p>
    </section>
  );
}
