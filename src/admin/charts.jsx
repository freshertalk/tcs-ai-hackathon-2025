// src/admin/charts.jsx
// A small chart kit, in plain SVG: no chart library on a site whose pages
// should stay light. Every chart reads its own size from a fixed viewBox and
// scales with its container; every chart has a text equivalent nearby (the
// numbers are in the cards and tables around it).

import React, { useMemo, useState } from "react";

const niceMax = (v) => {
  if (v <= 0) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return n * p;
};

/* ------------------------------------------------------------------ lines */
/**
 * data   [{ d, label?, <key>: number }]
 * series [{ key, label, color, area? }]
 */
export function LineChart({ data, series, height = 230, fmt = (n) => String(n), label = (r) => r.d }) {
  const W = 720;
  const L = 46;
  const R = 14;
  const T = 14;
  const B = 28;
  const [hover, setHover] = useState(null);

  const n = data.length;
  const max = useMemo(
    () => niceMax(Math.max(0, ...data.flatMap((r) => series.map((s) => Number(r[s.key]) || 0)))),
    [data, series]
  );
  const iw = W - L - R;
  const ih = height - T - B;
  const x = (i) => L + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => T + ih - (Math.min(v, max) / max) * ih;

  const grid = [0, 0.25, 0.5, 0.75, 1];
  const every = Math.max(1, Math.ceil(n / 7));

  const path = (key) => data.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(Number(r[key]) || 0).toFixed(1)}`).join(" ");

  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - L) / iw) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  if (!n) return <div className="ch ch--empty">No data for this period</div>;

  return (
    <div className="ch" style={{ "--ch-h": `${height}px` }}>
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={series.map((s) => s.label).join(", ")} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {grid.map((g) => (
          <g key={g}>
            <line x1={L} x2={W - R} y1={T + ih - g * ih} y2={T + ih - g * ih} className="ch__grid" />
            <text x={L - 8} y={T + ih - g * ih + 4} className="ch__tick" textAnchor="end">
              {fmt(max * g)}
            </text>
          </g>
        ))}
        {data.map((r, i) =>
          i % every === 0 ? (
            <text key={r.d} x={x(i)} y={height - 8} className="ch__tick" textAnchor="middle">
              {label(r)}
            </text>
          ) : null
        )}

        {series.map((s) =>
          s.area ? (
            <path
              key={`a${s.key}`}
              d={`${path(s.key)} L${x(n - 1).toFixed(1)} ${T + ih} L${x(0).toFixed(1)} ${T + ih} Z`}
              fill={s.color}
              opacity="0.12"
            />
          ) : null
        )}
        {series.map((s) => (
          <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {n <= 40 &&
          series.map((s) =>
            data.map((r, i) => <circle key={`${s.key}${i}`} cx={x(i)} cy={y(Number(r[s.key]) || 0)} r="2.6" fill={s.color} />)
          )}

        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={T + ih} className="ch__cursor" />
            {series.map((s) => (
              <circle key={s.key} cx={x(hover)} cy={y(Number(data[hover][s.key]) || 0)} r="4.5" fill="#fff" stroke={s.color} strokeWidth="2.4" />
            ))}
          </g>
        )}
      </svg>

      {hover != null && (
        <div className="ch__tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <b>{label(data[hover])}</b>
          {series.map((s) => (
            <span key={s.key}>
              <i style={{ background: s.color }} />
              {s.label}: {fmt(Number(data[hover][s.key]) || 0)}
            </span>
          ))}
        </div>
      )}

      <ul className="ch__legend">
        {series.map((s) => (
          <li key={s.key}>
            <i style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------- bars */
export function BarChart({ data, valueKey, color = "#7b2b2b", height = 200, fmt = (n) => String(n), label = (r) => r.d }) {
  const W = 720;
  const L = 46;
  const R = 10;
  const T = 12;
  const B = 28;
  const [hover, setHover] = useState(null);
  const n = data.length;
  const max = niceMax(Math.max(0, ...data.map((r) => Number(r[valueKey]) || 0)));
  const iw = W - L - R;
  const ih = height - T - B;
  const step = n ? iw / n : iw;
  const bw = Math.max(2, Math.min(34, step * 0.66));
  const every = Math.max(1, Math.ceil(n / 8));

  if (!n) return <div className="ch ch--empty">No data for this period</div>;

  return (
    <div className="ch" style={{ "--ch-h": `${height}px` }}>
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={valueKey} onPointerLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((g) => (
          <g key={g}>
            <line x1={L} x2={W - R} y1={T + ih - g * ih} y2={T + ih - g * ih} className="ch__grid" />
            <text x={L - 8} y={T + ih - g * ih + 4} className="ch__tick" textAnchor="end">
              {fmt(max * g)}
            </text>
          </g>
        ))}
        {data.map((r, i) => {
          const v = Number(r[valueKey]) || 0;
          const h = (v / max) * ih;
          const cx = L + step * i + step / 2;
          return (
            <g key={`${r.d}${i}`} onPointerEnter={() => setHover(i)}>
              <rect x={cx - step / 2} y={T} width={step} height={ih} fill="transparent" />
              <rect x={cx - bw / 2} y={T + ih - h} width={bw} height={Math.max(h, v ? 1.5 : 0)} rx="3" fill={color} opacity={hover == null || hover === i ? 1 : 0.45} />
              {i % every === 0 && (
                <text x={cx} y={height - 8} className="ch__tick" textAnchor="middle">
                  {label(r)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div className="ch__tip" style={{ left: `${((L + step * hover + step / 2) / W) * 100}%` }}>
          <b>{label(data[hover])}</b>
          <span>
            <i style={{ background: color }} />
            {fmt(Number(data[hover][valueKey]) || 0)}
          </span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- horizontal */
export function HBars({ rows, color = "#7b2b2b", fmt = (n) => String(n), empty = "Nothing yet" }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="ch__none">{empty}</p>;
  return (
    <ul className="hb">
      {rows.map((r) => (
        <li key={r.label}>
          <span className="hb__l" title={r.label}>
            {r.label}
          </span>
          <span className="hb__bar">
            <i style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: r.color || color }} />
          </span>
          <span className="hb__v">
            {fmt(r.value)}
            {r.sub ? <small>{r.sub}</small> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ donut */
export function Donut({ parts, size = 150, center }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const r = 52;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="dn">
      <svg width={size} height={size} viewBox="0 0 140 140" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(", ")}>
        <circle cx="70" cy="70" r={r} fill="none" stroke="rgba(31,22,17,0.07)" strokeWidth="18" />
        {total > 0 &&
          parts.map((p) => {
            const len = (p.value / total) * c;
            const el = (
              <circle
                key={p.label}
                cx="70"
                cy="70"
                r={r}
                fill="none"
                stroke={p.color}
                strokeWidth="18"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-acc}
                transform="rotate(-90 70 70)"
              />
            );
            acc += len;
            return el;
          })}
        <text x="70" y="75" textAnchor="middle" className="dn__c">
          {center != null ? center : total}
        </text>
      </svg>
      <ul className="dn__legend">
        {parts.map((p) => (
          <li key={p.label}>
            <i style={{ background: p.color }} />
            <span>{p.label}</span>
            <b>{total ? Math.round((p.value / total) * 100) : 0}%</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ spark */
export function Spark({ values, color = "#7b2b2b", width = 96, height = 30 }) {
  const n = values.length;
  if (n < 2) return <span className="spark spark--none" />;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${((i / (n - 1)) * (width - 2) + 1).toFixed(1)},${(height - 3 - (v / max) * (height - 6)).toFixed(1)}`);
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
