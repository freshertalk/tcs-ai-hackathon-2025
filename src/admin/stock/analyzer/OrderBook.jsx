// The order book for the open stock, live: the five best bids and offers with their
// quantities and the number of orders behind them, what the book and the stream of
// trades add up to (one "pressure" number), and the desk's own small model's lean
// for the next thirty seconds — shown together with how often that lean has
// actually been right today, so it can be believed exactly as much as it deserves.
//
// It redraws on every tick by itself; the rest of the page does not.

import React, { useEffect, useRef } from "react";
import { compact, inr, isNum, num } from "./format";
import { useTick } from "./liveTicks";

const HISTORY = 180; // one pressure sample a second, three minutes
const signedQty = (x) => (isNum(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}${compact(Math.abs(x))}` : "—");
const signedPct = (x) => (isNum(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x)}%` : "—");
const toneOf = (x, by = 0) => (!isNum(x) || Math.abs(x) <= by ? "flat" : x > 0 ? "up" : "down");

function Side({ rows, side, max }) {
  const cells = [];
  for (let k = 0; k < 5; k += 1) {
    const r = rows[k];
    cells.push(
      <li key={k} className={`ob__row ob__row--${side}`}>
        {r ? (
          <>
            <i className="ob__bar" style={{ width: `${Math.max(2, Math.round((r[1] / max) * 100))}%` }} aria-hidden="true" />
            <span className="ob__n">{r[2] > 0 ? r[2] : "—"}</span>
            <span className="ob__q">{num(r[1], 0)}</span>
            <b className="ob__p">{num(r[0])}</b>
          </>
        ) : (
          <span className="ob__none">—</span>
        )}
      </li>
    );
  }
  return (
    <ol className={`ob__side ob__side--${side}`} aria-label={side === "bid" ? "Bids, best first" : "Offers, best first"}>
      <li className="ob__row ob__row--head" aria-hidden="true">
        <span className="ob__n">
          <span className="ob__long">Orders</span>
          <span className="ob__short">Ord</span>
        </span>
        <span className="ob__q">Qty</span>
        <b className="ob__p">{side === "bid" ? "Bid" : "Offer"}</b>
      </li>
      {cells}
    </ol>
  );
}

/** −100 … +100 as a bar that grows from the middle. */
function Gauge({ value }) {
  const v = Math.max(-100, Math.min(100, value));
  const style = v >= 0 ? { left: "50%", width: `${v / 2}%` } : { right: "50%", width: `${-v / 2}%` };
  return (
    <div className="ob__gauge" role="img" aria-label={`Pressure ${v > 0 ? "+" : ""}${v} on a scale from minus 100, sellers, to plus 100, buyers`}>
      <i className={`ob__fill is-${toneOf(v, 29)}`} style={style} />
      <span className="ob__zero" />
    </div>
  );
}

function Spark({ points }) {
  if (points.length < 2) return <div className="ob__spark ob__spark--empty">the last three minutes will draw here</div>;
  const n = points.length;
  const x = (i) => HISTORY - n + i;
  const y = (v) => 17 - (Math.max(-100, Math.min(100, v)) / 100) * 15;
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i)} ${y(p).toFixed(1)}`).join(" ");
  return (
    <svg className="ob__spark" viewBox={`0 0 ${HISTORY} 34`} preserveAspectRatio="none" role="img" aria-label="Pressure over the last three minutes">
      <line x1="0" x2={HISTORY} y1="17" y2="17" />
      <path d={d} />
    </svg>
  );
}

function Lean({ lean }) {
  if (!lean) return null;
  const record =
    lean.calls > 0
      ? `Measured today: right ${lean.hitRatePct}% of ${lean.calls} calls${isNum(lean.recentRatePct) ? ` · latest ${Math.min(60, lean.calls)}: ${lean.recentRatePct}%` : ""}.`
      : "No call has been scored yet.";
  let head;
  let sub;
  let t = "flat";
  if (lean.dir === "learning") {
    head = "Learning this stock’s book";
    sub = `${lean.samples} of ${lean.needed} examples scored. No lean is offered until it has seen enough of today’s tape.`;
  } else if (lean.dir === "none") {
    head = "No lean";
    sub = `${lean.upPct}% up — too close to call. ${record}`;
  } else {
    t = lean.dir;
    head = `${lean.dir === "up" ? "▲ Leaning up" : "▼ Leaning down"} · ${lean.dir === "up" ? lean.upPct : 100 - lean.upPct}%`;
    sub = record;
  }
  const verdict =
    lean.dir === "learning"
      ? null
      : lean.reliable
        ? { cls: "ok", text: "Holding up today" }
        : lean.calls >= 20
          ? { cls: "no", text: "No better than a coin today — ignore it" }
          : { cls: "wait", text: "Too few scored calls to trust yet" };
  return (
    <div className={`ob__lean is-${t}`}>
      <p className="ob__k">Next {lean.horizonSec} seconds · the desk’s own model</p>
      <p className="ob__leanhead">
        {head}
        {verdict && <span className={`ob__chip ob__chip--${verdict.cls}`}>{verdict.text}</span>}
      </p>
      <p className="ob__sub">{sub}</p>
    </div>
  );
}

export default function OrderBook({ symbol, streaming, marketHours }) {
  const tick = useTick(symbol);
  const depth = tick && tick.depth ? tick.depth : null;
  const flow = tick && tick.flow && tick.flow.available ? tick.flow : null;

  // pressure, sampled once a second, for the three-minute line
  const hist = useRef({ symbol, at: 0, points: [] });
  if (hist.current.symbol !== symbol) hist.current = { symbol, at: 0, points: [] };
  const stamp = flow ? flow.at : 0;
  useEffect(() => {
    if (!flow) return;
    const h = hist.current;
    const now = Date.now();
    if (now - h.at < 1000) return;
    h.at = now;
    h.points.push(flow.pressure);
    if (h.points.length > HISTORY) h.points.shift();
  }, [stamp]); // eslint-disable-line react-hooks/exhaustive-deps

  const head = (
    <div className="ob__top">
      <h4>
        <i className={`ob__dot ${depth ? "is-on" : ""}`} aria-hidden="true" /> Order book · live
      </h4>
      {flow && isNum(flow.spread) && (
        <span className="ob__spread">
          spread {inr(flow.spread)} · {flow.spreadTicks} tick{flow.spreadTicks === 1 ? "" : "s"}
        </span>
      )}
    </div>
  );

  if (!depth || (depth.b.length === 0 && depth.a.length === 0)) {
    return (
      <div className="ob ob--off">
        {head}
        <p className="vd-note">
          {!streaming
            ? marketHours
              ? "The order book arrives with the live stream. It appears here as soon as the stream connects."
              : "The order book is live data: it appears here while the market is open and Zerodha is streaming."
            : "Waiting for the first tick that carries market depth. (Indices have no order book.)"}
        </p>
      </div>
    );
  }

  const max = Math.max(1, ...depth.b.map((r) => r[1]), ...depth.a.map((r) => r[1]));
  const sum = (rows) => rows.reduce((s, r) => s + r[1], 0);
  const wall = flow && flow.wall;

  return (
    <div className="ob">
      {head}
      <div className="ob__ladder">
        <Side rows={depth.b} side="bid" max={max} />
        <Side rows={depth.a} side="ask" max={max} />
      </div>
      <p className="ob__totals">
        <span>
          5 best: <b className="is-up">{num(sum(depth.b), 0)}</b> bid · <b className="is-down">{num(sum(depth.a), 0)}</b> offered
        </span>
        {isNum(tick.buyQty) && isNum(tick.sellQty) && (
          <span>
            whole book: <b className="is-up">{compact(tick.buyQty)}</b> · <b className="is-down">{compact(tick.sellQty)}</b>
          </span>
        )}
      </p>
      {flow && flow.oneSided && <p className="ob__alert">One side of the book is empty: {flow.oneSided}. This is what a stock locked at its circuit limit looks like.</p>}

      {flow && (
        <>
          <div className="ob__press">
            <p className="ob__k">Pressure · book and trades together</p>
            <p className={`ob__pressnum is-${toneOf(flow.pressure, 29)}`}>
              <b>
                {flow.pressure > 0 ? "+" : ""}
                {flow.pressure}
              </b>
              <span>{flow.label}</span>
            </p>
            <Gauge value={flow.pressure} />
            <div className="ob__ends">
              <small>−100 sellers</small>
              <small>buyers +100</small>
            </div>
            <Spark points={hist.current.points} />
          </div>

          <dl className="vd-tiles ob__tiles">
            <div className={`is-${toneOf(flow.imbalancePct, 9)}`}>
              <dt>Near the price</dt>
              <dd>{signedPct(flow.imbalancePct)}</dd>
              <small>bids against offers, nearest levels weigh most</small>
            </div>
            <div className={`is-${toneOf(flow.imbalanceTotalPct, 9)}`}>
              <dt>Whole book</dt>
              <dd>{signedPct(flow.imbalanceTotalPct)}</dd>
              <small>every pending buy against every pending sell</small>
            </div>
            <div className={`is-${toneOf(flow.delta30)}`}>
              <dt>Traded · 30 s</dt>
              <dd>{signedQty(flow.delta30)}</dd>
              <small>bought at the offer minus sold at the bid</small>
            </div>
            <div className={`is-${toneOf(flow.delta60)}`}>
              <dt>Traded · 60 s</dt>
              <dd>{signedQty(flow.delta60)}</dd>
              <small>of {compact(flow.volume60)} shares</small>
            </div>
            <div className={`is-${toneOf(flow.delta300)}`}>
              <dt>Traded · 5 min</dt>
              <dd>{signedQty(flow.delta300)}</dd>
            </div>
            <div>
              <dt>Average order</dt>
              <dd>
                {isNum(flow.avgBid) ? num(flow.avgBid, 0) : "—"} · {isNum(flow.avgAsk) ? num(flow.avgAsk, 0) : "—"}
              </dd>
              <small>shares per bid · per offer</small>
            </div>
          </dl>

          {wall && (
            <p className="ob__alert">
              A large {wall.side === "bid" ? "bid" : "offer"} at <b>{inr(wall.price)}</b>: {num(wall.qty, 0)} shares, {num(wall.times, 1)}× the other levels on its side. A wall can hold a
              price — or be pulled the moment price reaches it.
            </p>
          )}

          <Lean lean={flow.lean} />
        </>
      )}
      {!flow && <p className="vd-note">The flow reading starts with the next tick.</p>}

      <p className="ob__fine">
        Five best levels only, a few snapshots a second — not every order. Resting quantity can be placed to mislead and cancelled before it trades, and a thirty-second lean is
        too short to trade on once costs are counted. Use it to time what the call above already says; it does not make the call.
      </p>
    </div>
  );
}
