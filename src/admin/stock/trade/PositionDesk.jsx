// The Positions page's first sight (28 Nov 2026, the owner: "redesign Positions & orders page … all details required for stock
// analysis must be displayed on front … keep all first sight information upfront"). Added above the tables that were there:
//
//   PositionGlance    today's P&L (booked and open), exposure, stop-loss cover, margin, today's limits, MIS square-off
//   Attention         what needs a look now, the most urgent first
//   PositionMonitor   one panel for each open position: the money, the stop and target in today's order book, the exit
//                     coach (the owner's), the day's tape for the stock and the next 15 minutes
//   OrderStats, HoldingGlance, MarginBar   the same for the other tabs
//
// It reads and shows. The only buttons that lead to an order open the same forms as before (the exit form, the order ticket),
// which the trader confirms; with the trading switch OFF they are greyed out.

import React, { useEffect, useState } from "react";
import { api } from "../../api";
import { everyVisible } from "../../visible";
import { useExchangeNow } from "../../clock/exchangeClock";
import { inr, isNum, num, pct, tone } from "../analyzer/format";
import { PositionEvidence } from "../analyzer/EvidenceCard";
import { TradeButtons } from "./TradeContext";
import { positionDayChange, positionPnl } from "./tradeMath";
import { awayPct, minutesTo, openPnl, openPnlPct, posKey, protection } from "./positionMath";
import "./positions-kite.css";

const rupees = (x, d = 0) => (isNum(x) ? `${x < 0 ? "−" : ""}₹${num(Math.abs(x), d)}` : "—");
const signed = (x, d = 2) => (isNum(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}₹${num(Math.abs(x), d)}` : "—");
const share = (x) => `${Math.round(x)}%`;
const qtyText = (x) => num(Math.abs(x), 0);
const cls = (x) => (isNum(x) && x !== 0 ? `is-${tone(x)}` : "");

/* ------------------------------------------------------------ what the page reads besides the account */

/** The day's quote for each NSE stock shown: range, VWAP, volume, the waiting buyers and sellers, the circuit limits. */
export function useDayQuotes(symbols, enabled) {
  const key = symbols.join(",");
  const [quotes, setQuotes] = useState({});
  useEffect(() => {
    let alive = true;
    if (!enabled || !key) {
      setQuotes({});
      return undefined;
    }
    const read = () =>
      api(`/api/admin/market/quotes?symbols=${encodeURIComponent(key)}`)
        .then((d) => alive && setQuotes((d && d.quotes) || {}))
        .catch(() => {});
    read();
    const stop = everyVisible(read, 10000, { topics: ["market"] });
    return () => {
      alive = false;
      if (stop) stop();
    };
  }, [key, enabled]);
  return quotes;
}

/** The exit coach's newest look at each open position (the Live board's, the owner's only), keyed exchange:symbol:product. */
export function useExitCoach(enabled) {
  const [rows, setRows] = useState({});
  useEffect(() => {
    let alive = true;
    if (!enabled) {
      setRows({});
      return undefined;
    }
    const read = () =>
      api("/api/admin/flight")
        .then((b) => alive && setRows(Object.fromEntries(((b && b.positions) || []).filter((p) => p.advice).map((p) => [p.key, p]))))
        .catch(() => {});
    read();
    const stop = everyVisible(read, 5000, { topics: ["trading"] });
    return () => {
      alive = false;
      if (stop) stop();
    };
  }, [enabled]);
  return rows;
}

/* ------------------------------------------------------------ the first-sight panel */
function Cell({ title, value, valueClass = "", children, tip, className = "" }) {
  return (
    <div className={`pd-g ${className}`.trim()} data-tip={tip}>
      <small>{title}</small>
      <b className={valueClass}>{value}</b>
      {children}
    </div>
  );
}

function Meter({ value, level = "", label }) {
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <span className={`pd-meter ${level}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} aria-label={label}>
      <i style={{ width: `${v}%` }} />
    </span>
  );
}

export function PositionGlance({ numbers: n, dayPnl, margin, room, goal, mis }) {
  const now = useExchangeNow(15000);
  const first = mis[0] || null; // the earliest square-off among the open MIS positions
  const left = first ? minutesTo(first.min, now) : null;
  return (
    <section className={`pd-glance ${dayPnl > 0 ? "is-up" : dayPnl < 0 ? "is-down" : ""}`} aria-label="Positions at a glance">
      <Cell title="Today’s P&L" value={signed(dayPnl)} valueClass={cls(dayPnl)} tip="Today’s profit or loss on every position, open and closed (the day’s M2M, by Zerodha’s own formula). Before brokerage and charges." className="pd-g--main">
        <span className="pd-pairs">
          <em>Booked</em> <strong className={cls(n.booked)}>{signed(n.booked)}</strong>
          <em>Open</em> <strong className={cls(n.unrealised)}>{signed(n.unrealised)}</strong>
        </span>
        <span className="pd-note">before charges</span>
      </Cell>

      <Cell title="Open positions" value={n.open} tip="Open now, how they lean, and their value at the live price.">
        <span>
          {n.longs} long · {n.shorts} short{n.open ? ` · ${n.winners} in profit, ${n.losers} in loss` : ""}
        </span>
        {n.open > 0 && (
          <span className="pd-pairs">
            <em>Long value</em> <strong>{rupees(n.longValue)}</strong>
            <em>Short value</em> <strong>{rupees(n.shortValue)}</strong>
          </span>
        )}
        <span className="pd-note">
          {Object.entries(n.byProduct)
            .map(([k, v]) => `${k} ${v}`)
            .join(" · ") || "nothing open"}
          {n.closed ? ` · ${n.closed} closed today` : ""}
        </span>
      </Cell>

      <Cell
        title="Stop-loss cover"
        value={n.open ? `${n.covered} of ${n.open}` : "—"}
        valueClass={n.noStop.length ? "is-down" : n.partStop.length ? "is-warn" : n.open ? "is-up" : ""}
        tip="How many open positions have a stop-loss order (SL or SL-M) for their full quantity waiting in today’s order book. GTT triggers are not part of the order book, so they are not counted."
      >
        <span>{!n.open ? "no open position" : n.noStop.length ? `No stop: ${n.noStop.join(", ")}` : n.partStop.length ? `Part only: ${n.partStop.join(", ")}` : "every position has a stop order"}</span>
        {n.open > 0 && n.giveBack > 0 && (
          <span className="pd-pairs">
            <em>If the stops fill</em> <strong className="is-down">−{rupees(n.giveBack)}</strong>
          </span>
        )}
        <span className="pd-note">order book only, not GTT</span>
      </Cell>

      <Cell title="Margin available" value={margin ? rupees(margin.free) : "—"} tip="Equity margin free for new trades, and how much of it is in use, as Zerodha reports them.">
        {margin ? (
          <>
            <Meter value={margin.pct} level={margin.pct >= 80 ? "is-danger" : margin.pct >= 60 ? "is-warn" : ""} label="Share of the equity margin in use" />
            <span>
              {rupees(margin.used)} used · {share(margin.pct)}
            </span>
          </>
        ) : (
          <span>not read</span>
        )}
      </Cell>

      <Cell
        title="Today’s limits"
        value={room.locked ? "Locked" : room.on ? (isNum(room.loss) ? rupees(room.loss) : "Guard on") : "Guard off"}
        valueClass={room.locked ? "is-down" : isNum(room.lossUsedPct) && room.lossUsedPct >= 75 ? "is-warn" : ""}
        tip="Room left under your risk guard’s rules (set below), and today’s goal. The server enforces the rules."
      >
        {room.locked ? (
          <span>new trades refused; exits work</span>
        ) : (
          <>
            {room.on && isNum(room.loss) && (
              <>
                <Meter value={room.lossUsedPct} level={room.lossUsedPct >= 75 ? "is-danger" : ""} label="Share of today’s loss limit used" />
                <span>loss room left before the day locks</span>
              </>
            )}
            <span>
              {[isNum(room.orders) ? `${room.orders} orders left` : `${room.done} orders done`, isNum(room.open) ? `${room.open} new symbols left` : ""].filter(Boolean).join(" · ")}
            </span>
          </>
        )}
        {goal && goal.available && goal.enabled !== false && goal.target > 0 && (
          <span className="pd-note">
            goal {rupees(goal.target)} · {isNum(goal.progressPct) ? share(goal.progressPct) : "—"} reached
          </span>
        )}
      </Cell>

      <Cell
        title="MIS square-off"
        value={first ? first.clock : "—"}
        valueClass={isNum(left) && left > 0 && left <= 30 ? "is-down" : ""}
        tip={first ? first.note : "When Zerodha closes intraday (MIS) positions by itself. Shown when one is open."}
        className="pd-g--sq"
      >
        {first ? (
          <>
            <span>{!isNum(left) ? "next trading day" : left > 0 ? (left > 90 ? `in ${Math.floor(left / 60)} h ${left % 60} min` : `in ${left} min`) : "passed for today"}</span>
            <span className="pd-note">{mis.map((m) => (m.clock === first.clock ? m.symbol : `${m.symbol} ${m.clock}`)).join(", ")}</span>
          </>
        ) : (
          <span>no MIS stock position open</span>
        )}
      </Cell>
    </section>
  );
}

export function Attention({ items, open }) {
  if (!items.length)
    return open ? (
      <p className="pd-calm" role="status">
        Nothing needs attention right now.
      </p>
    ) : null;
  return (
    <section className="pd-attn" aria-label="Needs attention">
      <h3>
        Needs attention <span>{items.length}</span>
      </h3>
      <ul>
        {items.map((a) => (
          <li key={a.id} className={`is-${a.level}`}>
            <i aria-hidden="true">{a.level === "danger" ? "!" : "•"}</i>
            <span>{a.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------ one panel a position */

/** The stop, the entry, the price now and the target on one line, with their figures under it. */
function Ladder({ p, ltp, stop, target }) {
  const points = [stop && stop.price, p.average, ltp, target && target.price].filter((x) => isNum(x) && x > 0);
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const pad = (hi - lo) * 0.06 || hi * 0.002 || 1;
  const at = (v) => ((v - (lo - pad)) / (hi - lo + 2 * pad)) * 100;
  const mark = (v, kind) => (isNum(v) && v > 0 ? <span className={`pd-lad__mark is-${kind}`} style={{ left: `${at(v)}%` }} /> : null);
  const gain = openPnl(p, ltp);
  const fig = (label, level, note, kind) => (
    <div className={`is-${kind}`}>
      <dt>{label}</dt>
      <dd>{level ? num(level) : "—"}</dd>
      <small>{note}</small>
    </div>
  );
  const away = (v) => {
    const a = awayPct(v, ltp);
    return isNum(a) ? `${Math.abs(a).toFixed(2)}% ${a >= 0 ? "above" : "below"}` : "";
  };
  return (
    <div className="pd-lad">
      <div className="pd-lad__track" aria-hidden="true">
        {isNum(ltp) && p.average > 0 && <i className={gain >= 0 ? "is-up" : "is-down"} style={{ left: `${Math.min(at(p.average), at(ltp))}%`, width: `${Math.abs(at(ltp) - at(p.average))}%` }} />}
        {mark(stop && stop.price, "stop")}
        {mark(target && target.price, "target")}
        {mark(p.average, "entry")}
        {mark(ltp, gain >= 0 ? "now-up" : "now-down")}
      </div>
      <dl className="pd-lad__keys">
        {fig(stop && stop.from === "coach" ? "Coach stop" : "Stop-loss", stop && stop.price, stop ? `${away(stop.price)}${stop.from === "coach" ? " · no order" : " · order in book"}` : "no stop order", "stop")}
        {fig("Entry (avg)", p.average, away(p.average), "entry")}
        {fig("Now", ltp, isNum(positionDayChange(p, ltp)) ? `${pct(positionDayChange(p, ltp))} today` : "", "now")}
        {fig(target && target.from === "coach" ? "Coach target" : "Target", target && target.price, target ? `${away(target.price)}${target.from === "coach" ? " · no order" : " · order in book"}` : "no target order", "target")}
      </dl>
    </div>
  );
}

/** The stock's own day: where the price is between the low and the high, against VWAP, with the waiting orders. */
function Tape({ ltp, q }) {
  if (!q) return null;
  const range = isNum(q.low) && isNum(q.high) && q.high > q.low;
  const at = (v) => Math.max(0, Math.min(100, ((v - q.low) / (q.high - q.low)) * 100));
  const waiting = (q.buyQty || 0) + (q.sellQty || 0);
  const buyers = waiting > 0 ? (q.buyQty / waiting) * 100 : null;
  const vsVwap = awayPct(ltp, q.avgPrice);
  return (
    <div className="pd-box">
      <h4>The stock today</h4>
      {range && (
        <div className="pd-range" role="img" aria-label={`Day range ${num(q.low)} to ${num(q.high)}, now ${num(ltp)}`}>
          <div className="pd-range__track">
            {isNum(q.avgPrice) && q.avgPrice > 0 && <span style={{ left: `${at(q.avgPrice)}%` }} />}
            <b style={{ left: `${at(ltp)}%` }} />
          </div>
          <div className="pd-range__ends">
            <em>L {num(q.low)}</em>
            <em>H {num(q.high)}</em>
          </div>
        </div>
      )}
      <dl className="pd-facts">
        <dt>VWAP</dt>
        <dd>
          {isNum(q.avgPrice) && q.avgPrice > 0 ? num(q.avgPrice) : "—"}
          {isNum(vsVwap) && <small className={cls(vsVwap)}> price {pct(vsVwap)}</small>}
        </dd>
        <dt>Open · prev close</dt>
        <dd>
          {isNum(q.open) && q.open > 0 ? num(q.open) : "—"} · {isNum(q.prevClose) && q.prevClose > 0 ? num(q.prevClose) : "—"}
        </dd>
        <dt>Volume</dt>
        <dd>{isNum(q.volume) ? (q.volume >= 1e7 ? `${(q.volume / 1e7).toFixed(2)} Cr` : q.volume >= 1e5 ? `${(q.volume / 1e5).toFixed(2)} L` : num(q.volume, 0)) : "—"}</dd>
        {isNum(buyers) && (
          <>
            <dt>Waiting buy / sell</dt>
            <dd>
              <span className="is-up">{share(buyers)}</span> / <span className="is-down">{share(100 - buyers)}</span>
            </dd>
          </>
        )}
        {isNum(q.lowerCircuit) && isNum(q.upperCircuit) && q.upperCircuit > 0 && (
          <>
            <dt>Circuit limits</dt>
            <dd>
              {num(q.lowerCircuit)} – {num(q.upperCircuit)}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

function CoachStrip({ coach }) {
  const a = coach.advice;
  const why = a.state === "hold" ? a.reasons.hold : a.reasons.exit;
  return (
    <div className={`pd-coach is-${a.state}`}>
      <span className="pd-coach__word">{a.word}</span>
      <p>
        <b>{a.headline}</b>
        {why && why[1] ? <small>{why[1]}</small> : null}
        {a.state !== "hold" && a.reasons.hold && a.reasons.hold[0] ? <small>For staying: {a.reasons.hold[0]}</small> : null}
        {a.state === "hold" && a.reasons.exit && a.reasons.exit[0] ? <small>For leaving: {a.reasons.exit[0]}</small> : null}
      </p>
      <span className="pd-coach__press" data-tip="Exit pressure, 0 to 100: how much of the evidence the exit coach reads is on the side of leaving now. A reading, not advice; nothing is ever traded by itself.">
        <small>Exit pressure {Math.round(a.pressure)}</small>
        <Meter value={a.pressure} level={a.pressure >= 70 ? "is-danger" : a.pressure >= 45 ? "is-warn" : ""} label="Exit pressure" />
      </span>
    </div>
  );
}

function Trade({ coach, reading }) {
  const m = coach ? coach.advice.metrics : null;
  const hasReading = reading && reading.available;
  if (!m && !hasReading) return null;
  return (
    <div className="pd-box">
      <h4>This trade · next 15 minutes</h4>
      {hasReading && (
        <div className="pd-ev">
          <PositionEvidence reading={reading} />
        </div>
      )}
      {m && (
        <dl className="pd-facts">
          {m.peak && (
            <>
              <dt>Best so far</dt>
              <dd>
                <span className={cls(m.peak.pnl)}>{signed(m.peak.pnl)}</span> <small>at {m.peak.clock}</small>
              </dd>
            </>
          )}
          {isNum(m.givebackPct) && (
            <>
              <dt>Of it given back</dt>
              <dd className={m.givebackPct >= 40 ? "is-down" : ""}>{share(m.givebackPct)}</dd>
            </>
          )}
          {isNum(m.minutesIn) && (
            <>
              <dt>In the trade</dt>
              <dd>{m.minutesIn >= 90 ? `${Math.floor(m.minutesIn / 60)} h ${m.minutesIn % 60} min` : `${m.minutesIn} min`}</dd>
            </>
          )}
          {isNum(m.rsi1) && (
            <>
              <dt>RSI (1 min)</dt>
              <dd>{num(m.rsi1, 1)}</dd>
            </>
          )}
          {m.book && (
            <>
              <dt>Order book</dt>
              <dd>
                {m.book.label} <small>buyers {share(m.book.buyersPct)}</small>
              </dd>
            </>
          )}
          {m.pulse && m.pulse.lean && (
            <>
              <dt>Live Pulse</dt>
              <dd>
                {m.pulse.lean}
                {isNum(m.pulse.low) && isNum(m.pulse.high) ? <small> {num(m.pulse.low)} – {num(m.pulse.high)}</small> : null}
              </dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

function PositionPanel({ p, ltp, quote, orders, coach, reading, squareOff, canTrade, trade, onExit, onOpen }) {
  const long = p.quantity > 0;
  const guard = protection(p, orders);
  const pnl = positionPnl(p, ltp);
  const open = openPnl(p, ltp);
  const openPct = openPnlPct(p, ltp);
  const advice = coach ? coach.advice : null;
  // the order in the book leads; with none, the exit coach's level is shown and named as having no order behind it
  const stop = guard.stop ? { price: guard.stop.price, from: "order" } : advice && advice.stop ? { price: advice.stop, from: "coach" } : null;
  const target = guard.target ? { price: guard.target.price, from: "order" } : advice && advice.target ? { price: advice.target, from: "coach" } : null;
  const uncovered = Math.max(0, Math.abs(p.quantity) - guard.stopQty);
  // the coach's stop is nearer the market than the order in the book (by more than a tick or two): said beside it
  const coachTighter = Boolean(guard.stop && advice && advice.stop > 0 && (advice.stop - guard.stop.price) * Math.sign(p.quantity) > guard.stop.price * 0.001 && (ltp - advice.stop) * Math.sign(p.quantity) > 0);
  const stopTrigger = stop && stop.from === "coach" ? stop.price : "";
  const draftStop = () =>
    trade.openTicket({
      symbol: p.symbol,
      exchange: p.exchange,
      side: long ? "SELL" : "BUY",
      product: p.product,
      type: "SL-M",
      quantity: uncovered,
      trigger: stopTrigger,
      ltp,
      note: `Stop-loss for your ${long ? "long" : "short"} of ${Math.abs(p.quantity)} ${p.symbol}. A stop order lasts for today only. Nothing is sent until you confirm.`,
    });
  const nse = p.exchange === "NSE";
  return (
    <article className={`pd-pos ${open > 0 ? "is-up" : open < 0 ? "is-down" : ""}`} aria-label={`${p.symbol} ${long ? "long" : "short"} ${p.product}`}>
      <header className="pd-pos__head">
        <div className="pd-pos__id">
          <span className={`pd-side ${long ? "is-long" : "is-short"}`}>{long ? "LONG" : "SHORT"}</span>
          <h3>
            {nse && onOpen ? (
              <button type="button" onClick={() => onOpen(p.symbol)} data-tip={`Open ${p.symbol} on the Desk: chart, levels and every reading`}>
                {p.symbol}
              </button>
            ) : (
              p.symbol
            )}
          </h3>
          <small>
            {p.exchange} · <span className={`tr-prod tr-prod--${p.product}`}>{p.product}</span>
            {squareOff ? ` · squared off ${squareOff.clock}` : ""}
          </small>
          <span className="pd-pos__qty">
            {qtyText(p.quantity)} @ {num(p.average)}
          </span>
        </div>
        <div className="pd-pos__px">
          <small>LTP</small>
          <b>{num(ltp)}</b>
          <span className={cls(positionDayChange(p, ltp))}>{pct(positionDayChange(p, ltp))}</span>
        </div>
        <div className="pd-pos__pl">
          <small>P&amp;L</small>
          <b className={cls(pnl)}>{signed(pnl)}</b>
          <span className={cls(open)}>
            {isNum(openPct) ? `${pct(openPct)} on entry` : ""}
            {Math.abs(pnl - open) >= 1 ? ` · ${signed(pnl - open)} booked` : ""}
          </span>
        </div>
        <div className="pd-pos__act">
          <button type="button" className="tr-btn tr-btn--exit" disabled={!canTrade} onClick={() => onExit(p, ltp)} aria-label={`Exit ${p.symbol}`} data-tip={canTrade ? `Close this position with a ${long ? "sell" : "buy"} order. You pick the quantity and confirm.` : "Turn trading on to exit from here."}>
            Exit
          </button>
          <TradeButtons symbol={p.symbol} exchange={p.exchange} product={p.product} small />
        </div>
      </header>

      {coach && <CoachStrip coach={coach} />}

      <div className="pd-pos__grid">
        <div className="pd-box pd-box--levels">
          <h4>
            Protection
            <span className={`pd-guard is-${guard.state}`}>{guard.state === "covered" ? "Stop order in place" : guard.state === "partial" ? `Stop covers ${guard.stopQty} of ${Math.abs(p.quantity)}` : "No stop-loss order"}</span>
          </h4>
          <Ladder p={p} ltp={ltp} stop={stop} target={target} />
          <p className="pd-risk">
            {guard.stop ? (
              <>
                If the stop fills at {num(guard.stop.price)}, this position’s P&amp;L would be <b className={cls(positionPnl(p, guard.stop.price))}>{signed(positionPnl(p, guard.stop.price))}</b>
                {guard.state === "partial" ? " (as if for the whole quantity; only part is covered)" : ""}. Slippage and charges come on top.
              </>
            ) : (
              <>
                Nothing in today’s order book closes this position if the price turns. A GTT, if you set one in Kite, is not read here.
                {advice && advice.stop ? ` At the coach’s stop the P&L would be ${signed(positionPnl(p, advice.stop))}.` : ""}
              </>
            )}
          </p>
          {coachTighter && (
            <p className="pd-risk">
              The exit coach would keep the stop closer, at <b>{num(advice.stop)}</b>: P&amp;L there <b className={cls(positionPnl(p, advice.stop))}>{signed(positionPnl(p, advice.stop))}</b>. Moving it is your choice (Orders tab, Modify).
            </p>
          )}
          {uncovered > 0 && trade && (
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm pd-draft" disabled={!canTrade} onClick={draftStop} data-tip={canTrade ? "Open a stop-market order ticket for the uncovered quantity. You set or check the trigger and confirm; nothing is sent by itself." : "Turn trading on to place a stop from here."}>
              Draft a stop order…
            </button>
          )}
        </div>
        <Tape ltp={ltp} q={quote} />
        <Trade coach={coach} reading={reading} />
      </div>
    </article>
  );
}

export function PositionMonitor({ positions, orders, priceOf, quoteOf, coach, evidence, squareOff, canTrade, trade, onExit, onOpen }) {
  const open = positions.filter((p) => p.quantity !== 0);
  if (!open.length) return null;
  // the largest swing in money first: what matters most is on top
  const sorted = [...open].sort((a, b) => Math.abs(openPnl(b, priceOf(b))) - Math.abs(openPnl(a, priceOf(a))));
  return (
    <section className="pd-monitor" aria-label="Open positions, one panel each">
      {sorted.map((p) => (
        <PositionPanel
          key={posKey(p)}
          p={p}
          ltp={priceOf(p)}
          quote={p.exchange === "NSE" ? quoteOf(p.symbol) : null}
          orders={orders}
          coach={coach[posKey(p)] || null}
          reading={p.exchange === "NSE" ? evidence[`${p.symbol}|${p.quantity > 0 ? "long" : "short"}`] : null}
          squareOff={p.product === "MIS" ? squareOff[p.symbol] || null : null}
          canTrade={canTrade}
          trade={trade}
          onExit={onExit}
          onOpen={onOpen}
        />
      ))}
    </section>
  );
}

/* ------------------------------------------------------------ the other tabs */
function Strip({ label, items }) {
  return (
    <section className="pd-strip" aria-label={label}>
      {items
        .filter(Boolean)
        .map(([k, v, note, t]) => (
          <div key={k}>
            <small>{k}</small>
            <b className={t || ""}>{v}</b>
            {note ? <span>{note}</span> : null}
          </div>
        ))}
    </section>
  );
}

export function OrderStats({ stats }) {
  return (
    <Strip
      label="Orders today at a glance"
      items={[
        ["Waiting", stats.waiting, "open or trigger pending"],
        ["Completed", stats.complete, `${stats.fills} fill${stats.fills === 1 ? "" : "s"}`],
        ["Rejected", stats.rejected, stats.rejected ? "reason below" : "none", stats.rejected ? "is-down" : ""],
        ["Cancelled", stats.cancelled, ""],
        ["Bought", rupees(stats.buy), "value filled"],
        ["Sold", rupees(stats.sell), "value filled"],
        ["Turnover", rupees(stats.turnover), "buys + sells"],
      ]}
    />
  );
}

export function HoldingGlance({ x }) {
  if (!x) return null;
  const stock = (r, f) => (r ? [r.symbol, pct(r[f]), cls(r[f])] : ["—", "", ""]);
  const item = (title, r, f) => {
    const [name, note, t] = stock(r, f);
    return [title, name, note, t];
  };
  return (
    <Strip
      label="Holdings at a glance"
      items={[
        ["Stocks", x.count, `${x.inProfit} in profit · ${x.inLoss} in loss`],
        item("Best today", x.bestToday, "dayPct"),
        x.worstToday && item("Worst today", x.worstToday, "dayPct"),
        item("Best since bought", x.best, "pnlPct"),
        x.worst && item("Worst since bought", x.worst, "pnlPct"),
        x.biggest && ["Largest holding", x.biggest.symbol, `${share(x.biggest.share)} of the portfolio’s value`, x.biggest.share >= 40 ? "is-warn" : ""],
      ]}
    />
  );
}

export function MarginBar({ margin, equity }) {
  if (!margin || !equity) return null;
  return (
    <section className="pd-margin" aria-label="Equity margin in use">
      <div>
        <small>Equity margin in use</small>
        <b>{share(margin.pct)}</b>
      </div>
      <Meter value={margin.pct} level={margin.pct >= 80 ? "is-danger" : margin.pct >= 60 ? "is-warn" : ""} label="Equity margin in use" />
      <span>
        {inr(margin.used)} used · {inr(margin.free)} free · cash {inr(equity.available.cash)} · opening {inr(equity.available.opening)}
      </span>
    </section>
  );
}
