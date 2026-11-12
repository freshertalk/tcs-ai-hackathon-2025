// The Day debrief's three pictures:
//   RunningTotal  every finished call of the day, in the order it ended, as one stepped
//                 line in R (1 R = the amount risked on one call)
//   NetBar        one stock's result after costs, drawn left (lost) or right (made) of zero
//   ReplayStrip   one stock's day: its price, with the side the engine was on underneath
//
// Gain and loss are never told by colour alone — green and red are the hardest pair for
// a colour-blind reader. Direction carries it too: up or down on the line, right or left
// of zero on the bars, the upper or lower lane on the strip, and a sign on every number.

import React, { useEffect, useRef, useState } from "react";
import { num } from "./format";
import { CLOSE_MIN, OPEN_MIN, minOf, timeLabels } from "./tapeAxis";
import { CALL, fmtR, lanes, nearest, rAxis, stepLine, WHY } from "./debriefMath";

function useWidth(min = 260) {
  const ref = useRef(null);
  const [w, setW] = useState(720);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => setW(Math.max(min, Math.round(el.clientWidth)));
    fit();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    if (ro) ro.observe(el);
    return () => {
      if (ro) ro.disconnect();
    };
  }, [min]);
  return [ref, w];
}

/** A small readout that follows the pointer or the keyboard focus, and stays inside the chart. */
function Tip({ x, y, W, children }) {
  const flip = x > W - 200;
  return (
    <div className="db-tip" style={{ top: Math.max(0, y), ...(flip ? { right: Math.max(0, W - x + 12) } : { left: x + 12 }) }}>
      {children}
    </div>
  );
}

const tickText = (v) => (v === 0 ? "0" : `${v > 0 ? "+" : "−"}${Math.abs(v)}`);
const sideWord = (s) => (s === "long" ? "Long" : "Short");

/* ------------------------------------------------------------ running total */

export function RunningTotal({ curve }) {
  const [box, W] = useWidth();
  const [hot, setHot] = useState(null);
  if (!curve || curve.length === 0) {
    return (
      <div ref={box}>
        <p className="vd-note">No call has finished in this session, so there is no running total to draw.</p>
      </div>
    );
  }
  const narrow = W < 520;
  const PAD = { l: 34, r: 70, t: 12, b: 24 };
  const H = narrow ? 190 : 220;
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const x = (min) => PAD.l + ((min - OPEN_MIN) / (CLOSE_MIN - OPEN_MIN)) * plotW;
  const ax = rAxis(curve.map((p) => p.total));
  const y = (v) => PAD.t + ((ax.hi - v) / (ax.hi - ax.lo)) * plotH;
  const pts = stepLine(curve, OPEN_MIN);
  let d = `M${x(pts[0].min).toFixed(1)} ${y(0).toFixed(1)}`;
  for (let i = 1; i < pts.length; i += 1) d += ` H${x(pts[i].min).toFixed(1)} V${y(pts[i].total).toFixed(1)}`;
  d += ` H${x(CLOSE_MIN).toFixed(1)}`; // the day ends where the last call left it
  const end = curve[curve.length - 1];
  const marks = pts.slice(1);
  const h = hot !== null && marks[hot] ? marks[hot] : null;

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const min = OPEN_MIN + ((e.clientX - r.left - PAD.l) / plotW) * (CLOSE_MIN - OPEN_MIN);
    setHot(nearest(marks, min));
  };

  return (
    <div className="db-chart" ref={box}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Running total of ${curve.length} finished calls, ending at ${fmtR(end.total)}`} onPointerMove={onMove} onPointerLeave={() => setHot(null)}>
        {ax.ticks.map((v) => (
          <g key={v}>
            <line className={v === 0 ? "db-zero" : "db-grid"} x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} />
            <text className="db-axis" x={PAD.l - 6} y={y(v) + 3.5} textAnchor="end">
              {tickText(v)}
            </text>
          </g>
        ))}
        {timeLabels(OPEN_MIN, CLOSE_MIN, narrow).map((l, k, all) => (
          <text key={l.min} className="db-axis" x={x(l.min)} y={H - 6} textAnchor={k === 0 ? "start" : k === all.length - 1 ? "end" : "middle"}>
            {l.label}
          </text>
        ))}
        {h && <line className="db-cross" x1={x(h.min)} x2={x(h.min)} y1={PAD.t} y2={PAD.t + plotH} />}
        <path className="db-line" d={d} />
        {marks.map((p, i) => (
          <g
            key={`${p.call.symbol}${p.call.t}${i}`}
            className={`db-mark ${hot === i ? "is-hot" : ""}`}
            tabIndex={0}
            role="img"
            aria-label={`${p.call.t}, ${p.call.symbol}, ${sideWord(p.call.side).toLowerCase()}: ${WHY[p.call.why].text}, ${fmtR(p.call.netR)}; running total ${fmtR(p.total)}`}
            onFocus={() => setHot(i)}
            onBlur={() => setHot(null)}
          >
            <circle className="db-hit" cx={x(p.min)} cy={y(p.total)} r={12} />
            <circle className="db-dot" cx={x(p.min)} cy={y(p.total)} r={4.5} />
          </g>
        ))}
        {/* the one number the chart leads to */}
        <text className="db-end" x={x(CLOSE_MIN) + 8} y={y(end.total) + 4}>
          {fmtR(end.total)}
        </text>
      </svg>
      {h && (
        <Tip x={x(h.min)} y={y(h.total) - 8} W={W}>
          <b>{fmtR(h.call.netR)}</b>
          <span>
            {h.call.symbol} · {sideWord(h.call.side)} · {WHY[h.call.why].mark} {WHY[h.call.why].text}
          </span>
          <span>
            {h.call.t} · running total <strong>{fmtR(h.total)}</strong>
          </span>
        </Tip>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- net R bar */

/**
 * One stock's result after costs: a bar that grows left of zero for a loss and right of
 * zero for a gain, on the same scale in every row.
 * @param max  the largest absolute value among all rows
 */
export function NetBar({ value, max, label }) {
  const share = max > 0 ? Math.min(1, Math.abs(value) / max) : 0;
  const w = share * 50;
  const pos = value >= 0;
  return (
    <div className="db-bar" role="img" aria-label={`${label}: ${fmtR(value)} after costs`} title={`${label}: ${fmtR(value)} after costs`}>
      <div className="db-bar__track">
        {value !== 0 && <i className={`db-bar__fill ${pos ? "is-pos" : "is-neg"}`} style={pos ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} />}
        <span className="db-bar__zero" />
        <b className="db-bar__val" style={pos ? { left: `calc(50% + ${w}% + 6px)` } : { right: `calc(50% + ${w}% + 6px)` }}>
          {fmtR(value)}
        </b>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- replay strip */

export function ReplayStrip({ row }) {
  const [box, W] = useWidth();
  const [hot, setHot] = useState(null);
  const steps = row.steps || [];
  if (steps.length === 0) return <div ref={box} />;

  const narrow = W < 520;
  const PAD = { l: 8, r: 62, t: 12, b: 22 };
  const H_PRICE = narrow ? 90 : 120;
  const LANE = 8;
  const GAP = 2;
  const bandTop = PAD.t + H_PRICE + 10;
  const H = bandTop + LANE * 2 + GAP + PAD.b;
  const plotW = W - PAD.l - PAD.r;
  const x = (min) => PAD.l + ((min - OPEN_MIN) / (CLOSE_MIN - OPEN_MIN)) * plotW;
  const pts = steps.map((s) => ({ min: minOf(s.t), ...s }));
  const prices = [...pts.map((p) => p.price), ...row.trades.flatMap((t) => [t.entry, t.exit].filter((v) => typeof v === "number"))];
  let lo = Math.min(...prices);
  let hi = Math.max(...prices);
  const pad = (hi - lo) * 0.08 || hi * 0.002;
  lo -= pad;
  hi += pad;
  const y = (v) => PAD.t + ((hi - v) / (hi - lo)) * H_PRICE;
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p.min).toFixed(1)} ${y(p.price).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const laneY = (side) => (side === "long" ? bandTop : bandTop + LANE + GAP);
  const h = hot !== null && pts[hot] ? pts[hot] : null;

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const min = OPEN_MIN + ((e.clientX - r.left - PAD.l) / plotW) * (CLOSE_MIN - OPEN_MIN);
    setHot(nearest(pts, min));
  };
  // A stop or a target is touched somewhere inside a bar: its mark sits mid-bar, at the price it
  // was touched, so it can stand a little off the line of closes. Other exits happen on the clock.
  const exitMin = (t) => minOf(t.exitAt) + (t.why === "stop" || t.why === "target" ? 2.5 : 0);
  // an upward triangle for a long entry, a downward one for a short
  const tri = (cx, cy, up) => (up ? `${cx},${cy - 6} ${cx - 5.5},${cy + 4} ${cx + 5.5},${cy + 4}` : `${cx},${cy + 6} ${cx - 5.5},${cy - 4} ${cx + 5.5},${cy - 4}`);

  return (
    <div className="db-chart db-strip" ref={box}>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${row.symbol}: price through the session with the side the engine was on, ${row.trades.length} call${row.trades.length === 1 ? "" : "s"}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHot(null)}
      >
        <line className="db-grid" x1={PAD.l} x2={W - PAD.r} y1={bandTop - 5} y2={bandTop - 5} />
        {timeLabels(OPEN_MIN, CLOSE_MIN, narrow).map((l, k, all) => (
          <text key={l.min} className="db-axis" x={x(l.min)} y={H - 6} textAnchor={k === 0 ? "start" : k === all.length - 1 ? "end" : "middle"}>
            {l.label}
          </text>
        ))}
        {/* the side the engine was on: longs in the upper lane, shorts in the lower; solid while in play, faint while waiting */}
        {lanes(steps).map((s) => (
          <rect key={`${s.side}${s.from}`} className={`db-lane is-${s.side} is-${s.kind}`} x={x(s.from) + 1} y={laneY(s.side)} width={Math.max(1, x(s.to) - x(s.from) - 2)} height={LANE} rx={2} />
        ))}
        {h && <line className="db-cross" x1={x(h.min)} x2={x(h.min)} y1={PAD.t} y2={bandTop + LANE * 2 + GAP} />}
        <path className="db-price" d={d} />
        {row.trades.map((t) => (
          <g key={`${t.at}${t.side}`}>
            {t.why !== "open" && <circle className="db-exit" cx={x(exitMin(t))} cy={y(t.exit)} r={4.5} />}
            <polygon className={`db-entry is-${t.side}`} points={tri(x(minOf(t.at)), y(t.entry), t.side === "long")} />
          </g>
        ))}
        <text className="db-end" x={x(last.min) + 8 > W - PAD.r + 6 ? W - PAD.r + 6 : x(last.min) + 8} y={y(last.price) + 4}>
          {num(last.price)}
        </text>
        <text className="db-axis" x={W - PAD.r + 6} y={bandTop + 7}>
          long
        </text>
        <text className="db-axis" x={W - PAD.r + 6} y={bandTop + LANE + GAP + 7}>
          short
        </text>
      </svg>
      {h && (
        <Tip x={x(h.min)} y={y(h.price) - 8} W={W}>
          <b>{num(h.price)}</b>
          <span>
            {h.t} · {CALL[h.state] || h.state}
          </span>
          {typeof h.score === "number" && (
            <span>
              engine score {h.score > 0 ? "+" : h.score < 0 ? "−" : ""}
              {Math.abs(h.score)}
            </span>
          )}
        </Tip>
      )}
      <ul className="db-legend">
        <li>
          <i className="db-key db-key--price" /> Price at each 5-minute close
        </li>
        <li>
          <i className="db-key db-key--long" /> Long in play (upper lane)
        </li>
        <li>
          <i className="db-key db-key--short" /> Short in play (lower lane)
        </li>
        <li>
          <i className="db-key db-key--wait" /> Faint: waiting on that side
        </li>
        <li>▲ ▼ a call starts · ● it ends</li>
      </ul>
    </div>
  );
}
