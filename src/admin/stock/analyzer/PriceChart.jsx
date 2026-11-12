import React, { useEffect, useMemo, useRef, useState } from "react";
import { compact, day, isNum, num } from "./format";

// A dependency-free SVG chart: candles, moving averages, Bollinger Bands,
// Supertrend, setup markers, volume and RSI — with a crosshair read-out.

// The SVG is drawn at the container's real pixel width (1 unit = 1 CSS pixel), so
// axis text is the same readable size on a phone as on a wide monitor.
const PAD = { l: 6, r: 58, t: 10 };
const GAP = 12;
// …and the price pane grows with the window, so a tall monitor is not left half empty
const sizes = (w, vh) => (w < 560 ? { price: 230, vol: 46, rsi: 64 } : { price: Math.max(340, Math.min(620, vh - 500)), vol: 64, rsi: 86 });

const OVERLAYS = [
  { id: "ema", label: "EMA 20 / 50 / 200" },
  { id: "bb", label: "Bollinger" },
  { id: "st", label: "Supertrend" },
  { id: "marks", label: "Setups" },
];

function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

/** Break a series into drawable segments at nulls. */
function path(values, x, y) {
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (!isNum(v)) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
    pen = true;
  });
  return d;
}

export default function PriceChart({ chart, levels }) {
  const [on, setOn] = useState({ ema: true, bb: false, st: false, marks: true });
  const [hover, setHover] = useState(null);
  const svg = useRef(null);
  const box = useRef(null);
  const [W, setW] = useState(900);
  const [vh, setVh] = useState(() => (typeof window !== "undefined" ? window.innerHeight : 800));
  const n = chart.t.length;

  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const fit = () => setW(Math.max(280, Math.round(el.clientWidth)));
    const tall = () => setVh(window.innerHeight);
    fit();
    window.addEventListener("resize", tall);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    if (ro) ro.observe(el);
    return () => {
      window.removeEventListener("resize", tall);
      if (ro) ro.disconnect();
    };
  }, []);

  const { price: H_PRICE, vol: H_VOL, rsi: H_RSI } = sizes(W, vh);
  const H = PAD.t + H_PRICE + GAP + H_VOL + GAP + H_RSI + 22;

  const g = useMemo(() => {
    const plotW = W - PAD.l - PAD.r;
    const step = plotW / n;
    const x = (i) => PAD.l + step * (i + 0.5);

    let lo = Math.min(...chart.l);
    let hi = Math.max(...chart.h);
    const stretch = (arr) =>
      arr.forEach((v) => {
        if (isNum(v)) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      });
    if (on.ema) [chart.ema20, chart.ema50, chart.ema200].forEach(stretch);
    if (on.bb) [chart.bbUpper, chart.bbLower].forEach(stretch);
    const pad = (hi - lo) * 0.04 || 1;
    lo -= pad;
    hi += pad;
    const y = (v) => PAD.t + ((hi - v) / (hi - lo)) * H_PRICE;

    const volTop = PAD.t + H_PRICE + GAP;
    const vMax = Math.max(...chart.v, 1);
    const yVol = (v) => volTop + H_VOL - (v / vMax) * H_VOL;

    const rsiTop = volTop + H_VOL + GAP;
    const yRsi = (v) => rsiTop + ((100 - v) / 100) * H_RSI;

    return { x, y, yVol, yRsi, step, lo, hi, volTop, rsiTop, plotW };
  }, [chart, n, on.ema, on.bb, W, H_PRICE, H_VOL, H_RSI]);

  const bodyW = Math.max(1, Math.min(12, g.step * 0.7));
  const ticks = niceTicks(g.lo, g.hi, W < 560 ? 4 : 5);

  // month labels along the bottom
  const months = [];
  chart.t.forEach((t, i) => {
    if (i === 0 || t.slice(0, 7) !== chart.t[i - 1].slice(0, 7)) months.push({ i, label: day(t, { month: "short", year: t.slice(5, 7) === "01" ? "2-digit" : undefined }) });
  });
  const everyNth = Math.ceil(months.length / Math.max(3, Math.floor(W / 80)));

  const markSet = new Map();
  if (on.marks) chart.markers.forEach((m) => markSet.set(m.t, [...(markSet.get(m.t) || []), m.name]));

  const onMove = (e) => {
    const r = svg.current.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = Math.max(0, Math.min(n - 1, Math.floor((px - PAD.l) / g.step)));
    setHover(i);
  };

  const i = hover ?? n - 1;
  const up = chart.c[i] >= chart.o[i];
  const last = chart.c[n - 1];

  return (
    <div className="pc" ref={box}>
      <div className="pc__bar">
        <div className="pc__read" aria-live="off">
          <b>{day(chart.t[i])}</b>
          <span>O {num(chart.o[i])}</span>
          <span>H {num(chart.h[i])}</span>
          <span>L {num(chart.l[i])}</span>
          <span className={up ? "is-up" : "is-down"}>C {num(chart.c[i])}</span>
          <span>Vol {compact(chart.v[i])}</span>
          {isNum(chart.rsi[i]) && <span>RSI {chart.rsi[i]}</span>}
          {markSet.has(chart.t[i]) && <span className="pc__mark">▲ {markSet.get(chart.t[i]).join(" · ")}</span>}
        </div>
        <div className="pc__toggles" role="group" aria-label="Chart overlays">
          {OVERLAYS.map((o) => (
            <button key={o.id} type="button" aria-pressed={on[o.id]} onClick={() => setOn({ ...on, [o.id]: !on[o.id] })}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <svg
        ref={svg}
        className="pc__svg"
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label={`Price chart, ${day(chart.t[0])} to ${day(chart.t[n - 1])}. Last close ${num(last)}.`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {/* price grid + axis */}
        {ticks.map((v) => (
          <g key={v}>
            <line className="pc__grid" x1={PAD.l} x2={W - PAD.r} y1={g.y(v)} y2={g.y(v)} />
            <text className="pc__axis" x={W - PAD.r + 6} y={g.y(v) + 4}>
              {num(v, v >= 1000 ? 0 : 2)}
            </text>
          </g>
        ))}
        {months.filter((_, k) => k % everyNth === 0).map((m) => (
          <text key={m.i} className="pc__axis" x={g.x(m.i)} y={H - 6} textAnchor="middle">
            {m.label}
          </text>
        ))}

        {/* support / resistance from the levels panel */}
        {levels &&
          [...levels.supports.slice(0, 2).map((s) => ({ ...s, k: "s" })), ...levels.resistances.slice(0, 2).map((s) => ({ ...s, k: "r" }))]
            .filter((s) => s.price > g.lo && s.price < g.hi)
            .map((s) => (
              <line key={`${s.k}${s.price}`} className={`pc__sr pc__sr--${s.k}`} x1={PAD.l} x2={W - PAD.r} y1={g.y(s.price)} y2={g.y(s.price)} />
            ))}

        {on.bb && (
          <>
            <path className="pc__bb" d={path(chart.bbUpper, g.x, g.y)} />
            <path className="pc__bb" d={path(chart.bbLower, g.x, g.y)} />
          </>
        )}

        {/* candles */}
        {chart.t.map((t, k) => {
          const rise = chart.c[k] >= chart.o[k];
          const top = g.y(Math.max(chart.o[k], chart.c[k]));
          const bot = g.y(Math.min(chart.o[k], chart.c[k]));
          return (
            <g key={t} className={rise ? "pc__up" : "pc__down"}>
              <line x1={g.x(k)} x2={g.x(k)} y1={g.y(chart.h[k])} y2={g.y(chart.l[k])} />
              <rect x={g.x(k) - bodyW / 2} y={top} width={bodyW} height={Math.max(1, bot - top)} />
            </g>
          );
        })}

        {on.ema && (
          <>
            <path className="pc__ema pc__ema--200" d={path(chart.ema200, g.x, g.y)} />
            <path className="pc__ema pc__ema--50" d={path(chart.ema50, g.x, g.y)} />
            <path className="pc__ema pc__ema--20" d={path(chart.ema20, g.x, g.y)} />
          </>
        )}

        {on.st &&
          chart.supertrend.map((v, k) =>
            isNum(v) && k > 0 && isNum(chart.supertrend[k - 1]) && chart.supertrendDir[k] === chart.supertrendDir[k - 1] ? (
              <line
                key={k}
                className={chart.supertrendDir[k] === 1 ? "pc__st pc__st--up" : "pc__st pc__st--down"}
                x1={g.x(k - 1)}
                x2={g.x(k)}
                y1={g.y(chart.supertrend[k - 1])}
                y2={g.y(v)}
              />
            ) : null
          )}

        {/* setup markers under the bar */}
        {on.marks &&
          chart.t.map((t, k) =>
            markSet.has(t) ? (
              <path key={t} className="pc__marker" d={`M${g.x(k)} ${g.y(chart.l[k]) + 5} l5 9 h-10 z`}>
                <title>{`${day(t)} — ${markSet.get(t).join(", ")}`}</title>
              </path>
            ) : null
          )}

        {/* last price */}
        <line className="pc__last" x1={PAD.l} x2={W - PAD.r} y1={g.y(last)} y2={g.y(last)} />
        <rect className="pc__lastTag" x={W - PAD.r + 2} y={g.y(last) - 9} width={PAD.r - 4} height={18} rx={4} />
        <text className="pc__lastTxt" x={W - PAD.r + 6} y={g.y(last) + 4}>
          {num(last, last >= 1000 ? 1 : 2)}
        </text>

        {/* volume */}
        {chart.v.map((v, k) => (
          <rect
            key={chart.t[k]}
            className={chart.c[k] >= chart.o[k] ? "pc__vol pc__vol--up" : "pc__vol pc__vol--down"}
            x={g.x(k) - bodyW / 2}
            y={g.yVol(v)}
            width={bodyW}
            height={Math.max(0, g.volTop + H_VOL - g.yVol(v))}
          />
        ))}
        <text className="pc__axis" x={W - PAD.r + 6} y={g.volTop + 10}>
          Volume
        </text>

        {/* RSI */}
        <rect className="pc__rsiBand" x={PAD.l} width={g.plotW} y={g.yRsi(70)} height={g.yRsi(30) - g.yRsi(70)} />
        {[30, 50, 70].map((v) => (
          <g key={v}>
            <line className="pc__grid" x1={PAD.l} x2={W - PAD.r} y1={g.yRsi(v)} y2={g.yRsi(v)} />
            <text className="pc__axis" x={W - PAD.r + 6} y={g.yRsi(v) + 4}>
              {v === 50 ? "RSI 50" : v}
            </text>
          </g>
        ))}
        <path className="pc__rsi" d={path(chart.rsi, g.x, g.yRsi)} />

        {/* crosshair */}
        {hover !== null && <line className="pc__cross" x1={g.x(hover)} x2={g.x(hover)} y1={PAD.t} y2={g.rsiTop + H_RSI} />}
      </svg>

      <ul className="pc__legend">
        {on.ema && (
          <>
            <li className="k20">EMA 20</li>
            <li className="k50">EMA 50</li>
            <li className="k200">EMA 200</li>
          </>
        )}
        <li className="ks">Support</li>
        <li className="kr">Resistance</li>
        {on.marks && <li className="km">▲ a setup triggered on that day’s close</li>}
      </ul>
    </div>
  );
}
