// The charts of Trade Analysis, drawn as SVG — no chart library, so nothing to load and every
// colour follows the desk's light / dark theme through CSS variables. Each has a hover read-out,
// works with the arrow keys, and is described for a screen reader; the daily table beside them
// carries the same numbers.

import React, { useEffect, useMemo, useRef, useState } from "react";

const isNum = (x) => typeof x === "number" && Number.isFinite(x);

/** ₹ amounts, Indian grouping. */
export const rs = (x, d = 0) => (isNum(x) ? `${x < 0 ? "−" : ""}₹${Math.abs(x).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d })}` : "—");
export const rsSigned = (x, d = 0) => (isNum(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}₹${Math.abs(x).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d })}` : "—");
/** Axis labels: 1.2K, 3.4L, 1.1Cr. */
export const short = (x) => {
  const a = Math.abs(x);
  const s = x < 0 ? "−" : "";
  if (a >= 1e7) return `${s}${+(a / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `${s}${+(a / 1e5).toFixed(2)}L`;
  if (a >= 1e3) return `${s}${+(a / 1e3).toFixed(1)}K`;
  return `${s}${Math.round(a)}`;
};
export const dayLabel = (d) => {
  const t = new Date(`${d}T12:00:00Z`);
  return `${t.getUTCDate()} ${t.toLocaleString("en-IN", { month: "short", timeZone: "UTC" })}`;
};
export const dayLong = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const tone = (x) => (isNum(x) ? (x > 0 ? "is-up" : x < 0 ? "is-down" : "") : "");

function useWidth(ref, fallback = 640) {
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const set = () => setW(Math.max(240, Math.round(el.getBoundingClientRect().width)));
    set();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** A tidy scale: rounded ends and ticks a person would choose. */
export function niceScale(min, max, n = 4) {
  if (!isNum(min) || !isNum(max)) return { lo: 0, hi: 1, ticks: [0, 1] };
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const step0 = (max - min) / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const norm = step0 / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step * 1e-6; v += step) ticks.push(Math.round(v / step) * step);
  return { lo, hi, ticks };
}

/** Plot area shared by the line and bar charts: width, margins, axis, hover and the tooltip. */
function Plot({ xs, height = 240, yMin, yMax, fmt = short, children, rows, label, zero = true }) {
  const box = useRef(null);
  const w = useWidth(box);
  const [hover, setHover] = useState(null);
  const m = { l: 46, r: 10, t: 10, b: 24 };
  const iw = Math.max(40, w - m.l - m.r);
  const ih = height - m.t - m.b;
  const n = xs.length;
  const sc = useMemo(() => niceScale(yMin, yMax), [yMin, yMax]);
  const x = (i) => (n <= 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v) => ih - ((v - sc.lo) / (sc.hi - sc.lo || 1)) * ih;
  const pick = (clientX) => {
    const r = box.current.getBoundingClientRect();
    const px = clientX - r.left - m.l;
    const i = n <= 1 ? 0 : Math.round((px / iw) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 70))));
  const key = (e) => {
    if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h === null ? -1 : h) + 1));
    else if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h === null ? n : h) - 1));
    else if (e.key === "Escape") setHover(null);
    else return;
    e.preventDefault();
  };
  const tipLeft = hover === null ? 0 : m.l + x(hover);
  return (
    <div className="ta-plot" ref={box} style={{ height }}>
      <svg width={w} height={height} role="img" aria-label={label} tabIndex={0} onKeyDown={key} onBlur={() => setHover(null)} onPointerMove={(e) => pick(e.clientX)} onPointerLeave={() => setHover(null)} onPointerDown={(e) => pick(e.clientX)}>
        <g transform={`translate(${m.l},${m.t})`}>
          {sc.ticks.map((t) => (
            <g key={t}>
              <line className={`ta-grid ${t === 0 && zero ? "is-zero" : ""}`} x1="0" x2={iw} y1={y(t)} y2={y(t)} />
              <text className="ta-axis" x="-6" y={y(t)} dy="0.32em" textAnchor="end">
                {fmt(t)}
              </text>
            </g>
          ))}
          {xs.map((d, i) =>
            i % every === 0 ? (
              <text key={d} className="ta-axis" x={x(i)} y={ih + 16} textAnchor={i === 0 ? "start" : "middle"}>
                {dayLabel(d)}
              </text>
            ) : null
          )}
          {children({ x, y, iw, ih, n })}
          {hover !== null && <line className="ta-cross" x1={x(hover)} x2={x(hover)} y1="0" y2={ih} />}
        </g>
      </svg>
      {hover !== null && (
        <div className="ta-tip" style={{ left: Math.min(Math.max(8, tipLeft + 10), w - 190) }} role="status">
          <b>{dayLong(xs[hover])}</b>
          {rows(hover).map((r) => (
            <span key={r.label}>
              <i className={`ta-sw ta-sw--${r.c}`} />
              {r.label}
              <em>{r.value}</em>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const COLOR = { a: "var(--accent)", b: "var(--ink-3)", up: "var(--up)", down: "var(--down)", warn: "var(--warn, #d29922)" };

/** Lines (and one optional soft area) over dates. series: [{ label, values, c: "a"|"b"|"up"|"down"|"warn", dashed, area }] */
export function LineChart({ xs, series, height = 240, fmt = short, valueFmt = rsSigned, label, zero = true }) {
  const all = series.flatMap((s) => s.values).filter(isNum);
  const lo = Math.min(...all, zero ? 0 : Infinity);
  const hi = Math.max(...all, zero ? 0 : -Infinity);
  if (!xs.length || !all.length) return <p className="ta-empty">Nothing to draw for this period yet.</p>;
  return (
    <Plot xs={xs} height={height} yMin={lo} yMax={hi} fmt={fmt} label={label} zero={zero} rows={(i) => series.map((s) => ({ label: s.label, c: s.c, value: isNum(s.values[i]) ? valueFmt(s.values[i]) : "—" }))}>
      {({ x, y, ih }) => (
        <>
          {series.map((s) => {
            const pts = s.values.map((v, i) => (isNum(v) ? [x(i), y(v)] : null)).filter(Boolean);
            if (!pts.length) return null;
            const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
            const base = y(Math.max(0, Math.min(...all)));
            return (
              <g key={s.label}>
                {s.area && <path className={`ta-area ta-area--${s.c}`} d={`${d} L${pts[pts.length - 1][0].toFixed(1)} ${Math.min(ih, Math.max(0, base)).toFixed(1)} L${pts[0][0].toFixed(1)} ${Math.min(ih, Math.max(0, base)).toFixed(1)} Z`} />}
                <path className={`ta-line ta-line--${s.c} ${s.dashed ? "is-dashed" : ""}`} d={d} />
                {pts.length === 1 && <circle className={`ta-dot ta-dot--${s.c}`} cx={pts[0][0]} cy={pts[0][1]} r="3.5" />}
              </g>
            );
          })}
        </>
      )}
    </Plot>
  );
}

/** Daily profit (up) and loss (down) as bars, with the net as a dot. days: [{ date, grossProfit, grossLoss, net, charges }] */
export function DailyBars({ days, height = 240 }) {
  const xs = days.map((d) => d.date);
  const hi = Math.max(0, ...days.map((d) => d.grossProfit));
  const lo = Math.min(0, ...days.map((d) => -d.grossLoss), ...days.map((d) => d.net));
  if (!xs.length) return <p className="ta-empty">Nothing to draw for this period yet.</p>;
  return (
    <Plot xs={xs} height={height} yMin={lo} yMax={hi} label="Daily profit, loss and net" rows={(i) => [{ label: "Profit", c: "up", value: rs(days[i].grossProfit) }, { label: "Loss", c: "down", value: rs(-days[i].grossLoss) }, { label: "Charges & taxes", c: "warn", value: rs(-days[i].charges) }, { label: "Net", c: "a", value: rsSigned(days[i].net) }]}>
      {({ x, y, iw, n }) => {
        const bw = Math.max(2, Math.min(24, (iw / Math.max(1, n)) * 0.68));
        return (
          <>
            {days.map((d, i) => (
              <g key={d.date}>
                {d.grossProfit > 0 && <rect className="ta-bar ta-bar--up" x={x(i) - bw / 2} width={bw} y={y(d.grossProfit)} height={Math.max(1, y(0) - y(d.grossProfit))} rx="2" />}
                {d.grossLoss > 0 && <rect className="ta-bar ta-bar--down" x={x(i) - bw / 2} width={bw} y={y(0)} height={Math.max(1, y(-d.grossLoss) - y(0))} rx="2" />}
                <circle className="ta-net" cx={x(i)} cy={y(d.net)} r={Math.min(4, bw / 2 + 1)} />
              </g>
            ))}
          </>
        );
      }}
    </Plot>
  );
}

/** Rows of signed bars from a centre line: weekdays, hours, stocks. rows: [{ label, value, sub }] */
export function HBars({ rows, fmt = rsSigned, empty = "Nothing to show yet." }) {
  if (!rows.length) return <p className="ta-empty">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <ul className="ta-hb">
      {rows.map((r) => (
        <li key={r.label}>
          <span className="ta-hb__l" title={r.label}>
            {r.label}
          </span>
          <span className="ta-hb__bar" aria-hidden="true">
            <i className={r.value >= 0 ? "is-up" : "is-down"} style={{ width: `${(Math.abs(r.value) / max) * 50}%`, [r.value >= 0 ? "left" : "right"]: "50%" }} />
          </span>
          <span className={`ta-hb__v ${tone(r.value)}`}>{fmt(r.value)}</span>
          {r.sub && <small className="ta-hb__s">{r.sub}</small>}
        </li>
      ))}
    </ul>
  );
}

/** Where the money went: profit, loss, charges and what is left, as one comparison. */
export function Waterfall({ profit, loss, charges, net, other = 0 }) {
  const max = Math.max(1, profit, loss + charges + Math.max(0, -other));
  const rows = [
    { label: "Total profit", v: profit, c: "up", sign: "+" },
    { label: "Total loss", v: loss, c: "down", sign: "−" },
    { label: "Charges & taxes", v: charges, c: "warn", sign: "−" },
    // ledger lines that are not trades (AMC, interest, dividends…): part of Console's Net realised P&L
    ...(other ? [{ label: "Other credits & debits", v: Math.abs(other), c: other > 0 ? "up" : "down", sign: other > 0 ? "+" : "−" }] : []),
    { label: "Net", v: Math.abs(net), c: net >= 0 ? "up" : "down", sign: net >= 0 ? "+" : "−", strong: true },
  ];
  return (
    <ul className="ta-wf" aria-label="Profit, loss, charges and net">
      {rows.map((r) => (
        <li key={r.label} className={r.strong ? "is-net" : ""}>
          <span>{r.label}</span>
          <span className="ta-wf__bar" aria-hidden="true">
            <i className={`ta-sw--${r.c}`} style={{ width: `${Math.max(1, (r.v / max) * 100)}%` }} />
          </span>
          <b className={r.c === "up" ? "is-up" : r.c === "down" ? "is-down" : ""}>
            {r.sign}
            {rs(r.v)}
          </b>
        </li>
      ))}
    </ul>
  );
}

/** A ring: shares of a whole. parts: [{ label, value, c }] */
export function Donut({ parts, center, size = 150 }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return <p className="ta-empty">No charges yet.</p>;
  const r = size / 2 - 14;
  const C = 2 * Math.PI * r;
  let off = 0;
  return (
    <svg className="ta-donut" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={parts.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join(", ")}>
      <circle cx={size / 2} cy={size / 2} r={r} className="ta-donut__bg" />
      {parts.map((p) => {
        const len = (p.value / total) * C;
        const seg = (
          <circle key={p.label} cx={size / 2} cy={size / 2} r={r} className={`ta-donut__seg ta-sw--${p.c}`} strokeDasharray={`${Math.max(0, len - 2)} ${C - Math.max(0, len - 2)}`} strokeDashoffset={-off} transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            <title>{`${p.label}: ${Math.round((p.value / total) * 100)}%`}</title>
          </circle>
        );
        off += len;
        return seg;
      })}
      <text x="50%" y="46%" textAnchor="middle" className="ta-donut__t">
        {center[0]}
      </text>
      <text x="50%" y="60%" textAnchor="middle" className="ta-donut__s">
        {center[1]}
      </text>
    </svg>
  );
}

/** One square per trading day, a column per week — green for a profitable day, red for a loss. */
export function Calendar({ days, onPick, selected }) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const dates = days.map((d) => d.date).sort();
  if (!dates.length) return <p className="ta-empty">No days saved in this period.</p>;
  const first = new Date(`${dates[0]}T12:00:00Z`);
  const last = new Date(`${dates[dates.length - 1]}T12:00:00Z`);
  // start on the Monday of the first week
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const weeks = [];
  for (let w = new Date(start); w <= last; w.setUTCDate(w.getUTCDate() + 7)) {
    const col = [];
    for (let k = 0; k < 5; k += 1) {
      const d = new Date(w);
      d.setUTCDate(d.getUTCDate() + k);
      col.push(d.toISOString().slice(0, 10));
    }
    weeks.push(col);
  }
  const maxAbs = Math.max(1, ...days.map((d) => Math.abs(d.summary.net)));
  const cell = 16;
  const gap = 3;
  const W = weeks.length * (cell + gap) + 30;
  const H = 5 * (cell + gap) + 18;
  return (
    <div className="ta-cal">
      <svg width={W} height={H} role="img" aria-label="Net profit or loss for each trading day">
        {["M", "T", "W", "T", "F"].map((l, i) => (
          <text key={i} className="ta-axis" x="0" y={18 + i * (cell + gap) + cell / 2} dy="0.32em">
            {l}
          </text>
        ))}
        {weeks.map((col, wi) => (
          <g key={col[0]} transform={`translate(${20 + wi * (cell + gap)},0)`}>
            {(wi === 0 || new Date(`${col[0]}T12:00:00Z`).getUTCDate() <= 7) && (
              <text className="ta-axis" x="0" y="9">
                {new Date(`${col[0]}T12:00:00Z`).toLocaleString("en-IN", { month: "short", timeZone: "UTC" })}
              </text>
            )}
            {col.map((d, k) => {
              const rec = byDate.get(d);
              const inRange = d >= dates[0] && d <= dates[dates.length - 1];
              if (!inRange) return null;
              const a = rec ? 0.28 + 0.72 * (Math.abs(rec.summary.net) / maxAbs) : 0;
              return (
                <rect key={d} x="0" y={14 + k * (cell + gap)} width={cell} height={cell} rx="3" className={`ta-cell ${rec ? (rec.summary.net >= 0 ? "ta-cell--up" : "ta-cell--down") : "ta-cell--none"} ${selected === d ? "is-sel" : ""}`} style={rec ? { fillOpacity: a } : undefined} tabIndex={rec ? 0 : -1} role={rec ? "button" : undefined} aria-label={rec ? `${dayLong(d)}: net ${rsSigned(rec.summary.net)}, ${rec.summary.trades} trades` : undefined} onClick={() => rec && onPick(d)} onKeyDown={(e) => rec && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPick(d))}>
                  <title>{rec ? `${dayLong(d)} · net ${rsSigned(rec.summary.net)} · ${rec.summary.trades} trades` : `${dayLong(d)} · no report`}</title>
                </rect>
              );
            })}
          </g>
        ))}
      </svg>
      <p className="ta-cal__key">
        <i className="ta-sw ta-sw--down" /> loss day <i className="ta-sw ta-sw--up" /> profit day · darker = larger · click a day to open it
      </p>
    </div>
  );
}

/** A small line for a card: the shape of a number over the period. */
export function Spark({ values, c = "a" }) {
  const v = values.filter(isNum);
  if (v.length < 2) return null;
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const W = 90;
  const H = 26;
  const pts = v.map((x, i) => `${((i / (v.length - 1)) * W).toFixed(1)},${(H - 2 - ((x - lo) / (hi - lo || 1)) * (H - 4)).toFixed(1)}`);
  return (
    <svg className="ta-spark" width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline className={`ta-line ta-line--${c}`} points={pts.join(" ")} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export { COLOR };
