// The Indices page's charts, in plain SVG sized to their box: the projection fan, the average by month,
// the average year against this one, the yearly moves, and two indices year by year. Every chart has
// a hover readout; the numbers are also in the tables on the page.

import React, { useEffect, useRef, useState } from "react";
import { niceScale } from "../analysis/charts";

const num = (x) => typeof x === "number" && Number.isFinite(x);
export const lvl = (x, d = 2) => (num(x) ? x.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—");
export const pct = (x, d = 2) => (num(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(d)}%` : "—");
export const pts = (x, d = 0) => (num(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d })}` : "—");
export const dayLabel = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The width of a box, followed as it changes. */
export function useWidth(fallback = 640) {
  const ref = useRef(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const set = () => setW(Math.max(260, Math.round(el.getBoundingClientRect().width)));
    set();
    if (typeof ResizeObserver !== "function") return undefined;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function Readout({ at, children }) {
  if (!at) return null;
  return (
    <div className="ixc-tip" style={{ left: at.x, top: at.y }} role="status">
      {children}
    </div>
  );
}

/** Rounded ticks and the domain they span (niceScale gives lo/hi). */
const ticksOf = (lo, hi, n = 4) => {
  const s = niceScale(lo, hi, n);
  return s && s.ticks ? { min: s.lo, max: s.hi, ticks: s.ticks } : { min: lo, max: hi, ticks: [lo, hi] };
};

/* ------------------------------------------------------------------- the projection fan */
/**
 * The period so far and the desk's projection from today to its end (68% and 90%), with the AI's
 * projection and the desk's start-of-period projection at the end.
 */
export function Fan({ path = [], live, start, ai, periodStart, periodEnd, height = 230 }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState(null);
  if (!live || !live.available) return <div ref={ref} className="ixc-empty">{live ? live.reason : "No projection yet."}</div>;
  const H = height;
  const L = 58;
  const R = 92;
  const T = 12;
  const B = 24;
  const t0 = Date.parse(`${periodStart}T00:00:00Z`);
  const t1 = Date.parse(`${periodEnd}T00:00:00Z`);
  const pts0 = [[periodStart, live.base0], ...path.filter((p) => p[0] >= periodStart)];
  const from = live.asOf ? Date.parse(`${live.asOf}T00:00:00Z`) : t0;
  const base = live.base;
  const c = Math.log(live.mid / base);
  const s = (live.sigmaPct || 0) / 100;
  const steps = 28;
  const fan = [];
  for (let i = 0; i <= steps; i += 1) {
    const f = i / steps;
    const t = from + f * (t1 - from);
    const at = (z) => base * Math.exp(c * f + z * s * Math.sqrt(f));
    fan.push({ t, lo90: at(-1.645), lo68: at(-1), mid: base * Math.exp(c * f), hi68: at(1), hi90: at(1.645) });
  }
  const vals = [...pts0.map((p) => p[1]), live.low90, live.high90, live.base0];
  if (ai && num(ai.low68)) vals.push(ai.low68, ai.high68, ai.mid);
  if (start && start.available) vals.push(start.low68, start.high68);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const sc = ticksOf(lo - (hi - lo) * 0.04, hi + (hi - lo) * 0.04);
  const X = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const Y = (v) => T + (1 - (v - sc.min) / (sc.max - sc.min)) * (H - T - B);
  const poly = (a, b) => [...fan.map((p) => `${X(p.t).toFixed(1)},${Y(p[a]).toFixed(1)}`), ...fan.slice().reverse().map((p) => `${X(p.t).toFixed(1)},${Y(p[b]).toFixed(1)}`)].join(" ");
  const line = pts0.map((p, i) => `${i ? "L" : "M"}${X(Date.parse(`${p[0]}T00:00:00Z`)).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ");
  const midLine = fan.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p.mid).toFixed(1)}`).join(" ");
  const xEnd = X(t1);
  const lastPt = pts0[pts0.length - 1];
  const move = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - box.left;
    let best = null;
    for (const p of pts0) {
      const px = X(Date.parse(`${p[0]}T00:00:00Z`));
      if (!best || Math.abs(px - x) < Math.abs(best.px - x)) best = { px, p };
    }
    if (best && x <= X(from) + 12) setHover({ x: best.px, y: Y(best.p[1]), d: best.p[0], v: best.p[1] });
    else {
      const f = Math.max(0, Math.min(1, (x - X(from)) / Math.max(1, xEnd - X(from))));
      const q = fan[Math.round(f * steps)];
      setHover({ x: X(q.t), y: Y(q.mid), fan: q });
    }
  };
  const label = `${live.label}: started at ${lvl(live.base0)}, now ${lvl(live.base)}; the desk expects ${lvl(live.mid)} at the end (68% range ${lvl(live.low68)}–${lvl(live.high68)})${ai && num(ai.mid) ? `; the AI expects ${lvl(ai.mid)}` : ""}.`;
  return (
    <div ref={ref} className="ixc">
      <svg width={W} height={H} role="img" aria-label={label} onMouseMove={move} onMouseLeave={() => setHover(null)}>
        {sc.ticks.map((v) => (
          <g key={v} className="ixc-grid">
            <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} />
            <text x={L - 6} y={Y(v) + 4} textAnchor="end">
              {lvl(v, 0)}
            </text>
          </g>
        ))}
        <text className="ixc-axis" x={L} y={H - 6}>
          {dayLabel(periodStart).replace(/ \d{4}$/, "")}
        </text>
        <text className="ixc-axis" x={xEnd} y={H - 6} textAnchor="end">
          {dayLabel(periodEnd).replace(/ \d{4}$/, "")}
        </text>
        <line className="ixc-start" x1={L} x2={xEnd} y1={Y(live.base0)} y2={Y(live.base0)} />
        <text className="ixc-note" x={L + 4} y={Y(live.base0) - 5}>
          start {lvl(live.base0, 0)}
        </text>
        <polygon className="ixc-b90" points={poly("hi90", "lo90")} />
        <polygon className="ixc-b68" points={poly("hi68", "lo68")} />
        <path className="ixc-mid" d={midLine} />
        <path className="ixc-line" d={line} />
        <circle className="ixc-now" cx={X(Date.parse(`${lastPt[0]}T00:00:00Z`))} cy={Y(lastPt[1])} r="4" />
        {start && start.available && (
          <g className="ixc-was">
            <line x1={xEnd - 10} x2={xEnd - 10} y1={Y(start.low68)} y2={Y(start.high68)} />
            <line x1={xEnd - 14} x2={xEnd - 6} y1={Y(start.mid)} y2={Y(start.mid)} />
          </g>
        )}
        {ai && num(ai.mid) && (
          <g className="ixc-ai">
            {num(ai.low68) && num(ai.high68) && <line x1={xEnd + 2} x2={xEnd + 2} y1={Y(ai.low68)} y2={Y(ai.high68)} />}
            <circle cx={xEnd + 2} cy={Y(ai.mid)} r="5" />
          </g>
        )}
        <text className="ixc-end" x={xEnd + 10} y={Y(live.mid) + 4}>
          {lvl(live.mid, 0)}
        </text>
        {hover && <line className="ixc-cross" x1={hover.x} x2={hover.x} y1={T} y2={H - B} />}
      </svg>
      <Readout at={hover ? { x: Math.min(hover.x + 12, W - 190), y: 8 } : null}>
        {hover && hover.fan ? (
          <>
            <b>{dayLabel(new Date(hover.fan.t).toISOString().slice(0, 10))}</b> · desk expects {lvl(hover.fan.mid, 0)}
            <br />
            68%: {lvl(hover.fan.lo68, 0)}–{lvl(hover.fan.hi68, 0)} · 90%: {lvl(hover.fan.lo90, 0)}–{lvl(hover.fan.hi90, 0)}
          </>
        ) : hover ? (
          <>
            <b>{dayLabel(hover.d)}</b> · {lvl(hover.v)} ({pct(((hover.v - live.base0) / live.base0) * 100)} on the period)
          </>
        ) : null}
      </Readout>
      <ul className="ixc-legend">
        <li>
          <i className="is-line" /> {live.horizon === "month" ? "This month so far" : "This year so far"}
        </li>
        <li>
          <i className="is-band" /> Desk projection: 68% and 90% ranges, dashed = expected
        </li>
        {start && start.available && (
          <li>
            <i className="is-was" /> What the desk projected at the start
          </li>
        )}
        {ai && num(ai.mid) && (
          <li>
            <i className="is-ai" /> The AI&rsquo;s projection ({ai.by}, {dayLabel(ai.madeAt.slice(0, 10))})
          </li>
        )}
      </ul>
    </div>
  );
}

/* --------------------------------------------------------------- the average by month */
export function MonthBars({ stats, unit = "pct", current }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState(null);
  const rows = stats.filter((m) => m.n);
  if (!rows.length) return <div ref={ref} className="ixc-empty">Not enough history.</div>;
  const H = 230;
  const L = 46;
  const R = 8;
  const T = 12;
  const B = 44;
  const v = (m) => (unit === "pts" ? m.avgPts : m.avgPct);
  const vs = rows.map(v).filter(num);
  const sc = ticksOf(Math.min(0, ...vs), Math.max(0, ...vs));
  const bw = (W - L - R) / 12;
  const X = (i) => L + i * bw;
  const Y = (x) => T + (1 - (x - sc.min) / (sc.max - sc.min)) * (H - T - B);
  return (
    <div ref={ref} className="ixc">
      <svg width={W} height={H} role="img" aria-label={`Average move by calendar month: ${rows.map((m) => `${m.short} ${unit === "pts" ? pts(m.avgPts) : pct(m.avgPct)}, rose ${m.winRate}%`).join("; ")}`} onMouseLeave={() => setHover(null)}>
        {sc.ticks.map((t) => (
          <g key={t} className="ixc-grid">
            <line x1={L} x2={W - R} y1={Y(t)} y2={Y(t)} />
            <text x={L - 6} y={Y(t) + 4} textAnchor="end">
              {unit === "pts" ? pts(t) : pct(t, 1)}
            </text>
          </g>
        ))}
        <line className="ixc-zero" x1={L} x2={W - R} y1={Y(0)} y2={Y(0)} />
        {stats.map((m, i) => {
          if (!m.n || !num(v(m))) return null;
          const y0 = Y(0);
          const y1 = Y(v(m));
          const h = Math.max(1, Math.abs(y1 - y0));
          return (
            <g key={m.m} onMouseEnter={() => setHover({ i, m })}>
              <rect className="ixc-hit" x={X(i)} y={T} width={bw} height={H - T - B} />
              <rect className={`ixc-bar ${v(m) >= 0 ? "is-up" : "is-down"} ${current === m.m ? "is-now" : ""}`} x={X(i) + bw * 0.2} y={Math.min(y0, y1)} width={Math.max(2, bw * 0.6 - 2)} height={h} rx="3" />
              <text className="ixc-axis" x={X(i) + bw / 2} y={H - B + 16} textAnchor="middle">
                {m.short}
              </text>
              <text className="ixc-sub" x={X(i) + bw / 2} y={H - B + 32} textAnchor="middle">
                {m.winRate}%
              </text>
            </g>
          );
        })}
      </svg>
      <Readout at={hover ? { x: Math.min(X(hover.i) + bw, W - 210), y: 8 } : null}>
        {hover && (
          <>
            <b>{hover.m.name}</b> · {hover.m.n} years · rose {hover.m.up} ({hover.m.winRate}%)
            <br />
            average {pct(hover.m.avgPct)} ({pts(hover.m.avgPts)}) · median {pct(hover.m.medianPct)}
            <br />
            best {pct(hover.m.best.pct)} in {hover.m.best.y} · worst {pct(hover.m.worst.pct)} in {hover.m.worst.y}
          </>
        )}
      </Readout>
      <p className="ixc-foot">Bars: the average {unit === "pts" ? "move in points" : "move in percent"} of each calendar month. Under each month: how often it rose.</p>
    </div>
  );
}

/* -------------------------------------------------------------- the average year */
export function SeasonalPath({ seasonal }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState(null);
  if (!seasonal || !seasonal.years) return <div ref={ref} className="ixc-empty">A complete year is needed.</div>;
  const H = 230;
  const L = 46;
  const R = 12;
  const T = 12;
  const B = 26;
  const rows = [{ m: 0, short: "", avg: 0, p25: 0, p75: 0 }, ...seasonal.rows];
  const cur = seasonal.current ? [{ m: 0, ytd: 0 }, ...seasonal.current.path] : [];
  const vals = [...rows.flatMap((r) => [r.p25, r.p75, r.avg]), ...cur.map((x) => x.ytd)].filter(num);
  const sc = ticksOf(Math.min(0, ...vals), Math.max(0, ...vals));
  const X = (m) => L + (m / 12) * (W - L - R);
  const Y = (x) => T + (1 - (x - sc.min) / (sc.max - sc.min)) * (H - T - B);
  const band = [...rows.map((r) => `${X(r.m)},${Y(r.p75)}`), ...rows.slice().reverse().map((r) => `${X(r.m)},${Y(r.p25)}`)].join(" ");
  const avg = rows.map((r, i) => `${i ? "L" : "M"}${X(r.m)},${Y(r.avg)}`).join(" ");
  const now = cur.map((r, i) => `${i ? "L" : "M"}${X(r.m)},${Y(r.ytd)}`).join(" ");
  const move = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const m = Math.max(1, Math.min(12, Math.round(((e.clientX - box.left - L) / (W - L - R)) * 12)));
    setHover({ m, r: seasonal.rows[m - 1], c: cur.find((x) => x.m === m) });
  };
  return (
    <div ref={ref} className="ixc">
      <svg width={W} height={H} role="img" aria-label={`The average year over ${seasonal.years} complete years against ${seasonal.current ? seasonal.current.y : "this year"}`} onMouseMove={move} onMouseLeave={() => setHover(null)}>
        {sc.ticks.map((t) => (
          <g key={t} className="ixc-grid">
            <line x1={L} x2={W - R} y1={Y(t)} y2={Y(t)} />
            <text x={L - 6} y={Y(t) + 4} textAnchor="end">
              {pct(t, 0)}
            </text>
          </g>
        ))}
        <line className="ixc-zero" x1={L} x2={W - R} y1={Y(0)} y2={Y(0)} />
        <polygon className="ixc-iqr" points={band} />
        <path className="ixc-avg" d={avg} />
        {cur.length > 1 && <path className="ixc-cur" d={now} />}
        {cur.slice(1).map((r) => (
          <circle key={r.m} className="ixc-cur-dot" cx={X(r.m)} cy={Y(r.ytd)} r="3.5" />
        ))}
        {MON.map((mm, i) => (
          <text key={mm} className="ixc-axis" x={X(i + 1)} y={H - 8} textAnchor="middle">
            {mm}
          </text>
        ))}
        {hover && <line className="ixc-cross" x1={X(hover.m)} x2={X(hover.m)} y1={T} y2={H - B} />}
      </svg>
      <Readout at={hover ? { x: Math.min(X(hover.m) + 10, W - 200), y: 8 } : null}>
        {hover && (
          <>
            <b>End of {MON[hover.m - 1]}</b> · average year {pct(hover.r.avg)}
            <br />
            middle half of the years {pct(hover.r.p25)} to {pct(hover.r.p75)}
            {hover.c ? (
              <>
                <br />
                {seasonal.current.y}: {pct(hover.c.ytd)}
                {hover.c.partial ? " (so far)" : ""}
              </>
            ) : null}
          </>
        )}
      </Readout>
      <ul className="ixc-legend">
        <li>
          <i className="is-avg" /> The average year ({seasonal.years} complete years)
        </li>
        <li>
          <i className="is-iqr" /> The middle half of the years
        </li>
        {seasonal.current && (
          <li>
            <i className="is-cur" /> {seasonal.current.y} so far
          </li>
        )}
      </ul>
    </div>
  );
}

/* ---------------------------------------------------------------- the yearly moves */
export function YearBars({ years, unit = "pct" }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState(null);
  const rows = years.filter((y) => num(y.pct) && num(y.prevClose));
  if (!rows.length) return <div ref={ref} className="ixc-empty">A complete year is needed.</div>;
  const H = 220;
  const L = 52;
  const R = 8;
  const T = 12;
  const B = 26;
  const v = (y) => (unit === "pts" ? y.chg : y.pct);
  const sc = ticksOf(Math.min(0, ...rows.map(v)), Math.max(0, ...rows.map(v)));
  const bw = (W - L - R) / rows.length;
  const X = (i) => L + i * bw;
  const Y = (x) => T + (1 - (x - sc.min) / (sc.max - sc.min)) * (H - T - B);
  const every = Math.max(1, Math.ceil(rows.length / Math.max(4, Math.floor((W - L) / 44))));
  return (
    <div ref={ref} className="ixc">
      <svg width={W} height={H} role="img" aria-label={`The move of each year: ${rows.map((y) => `${y.y} ${pct(y.pct)}`).join(", ")}`} onMouseLeave={() => setHover(null)}>
        {sc.ticks.map((t) => (
          <g key={t} className="ixc-grid">
            <line x1={L} x2={W - R} y1={Y(t)} y2={Y(t)} />
            <text x={L - 6} y={Y(t) + 4} textAnchor="end">
              {unit === "pts" ? pts(t) : pct(t, 0)}
            </text>
          </g>
        ))}
        <line className="ixc-zero" x1={L} x2={W - R} y1={Y(0)} y2={Y(0)} />
        {rows.map((y, i) => {
          const y0 = Y(0);
          const y1 = Y(v(y));
          return (
            <g key={y.y} onMouseEnter={() => setHover({ i, y })}>
              <rect className="ixc-hit" x={X(i)} y={T} width={bw} height={H - T - B} />
              <rect className={`ixc-bar ${v(y) >= 0 ? "is-up" : "is-down"} ${y.partial ? "is-partial" : ""}`} x={X(i) + Math.min(2, bw * 0.1)} y={Math.min(y0, y1)} width={Math.max(2, bw - Math.min(4, bw * 0.2) - 2)} height={Math.max(1, Math.abs(y1 - y0))} rx="3" />
              {i % every === 0 && (
                <text className="ixc-axis" x={X(i) + bw / 2} y={H - 8} textAnchor="middle">
                  {bw >= 34 ? y.y : `’${String(y.y).slice(2)}`}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <Readout at={hover ? { x: Math.min(X(hover.i) + bw, W - 200), y: 8 } : null}>
        {hover && (
          <>
            <b>
              {hover.y.y}
              {hover.y.partial ? " (so far)" : ""}
            </b>{" "}
            · {pct(hover.y.pct)} ({pts(hover.y.chg)} points)
            <br />
            {lvl(hover.y.prevClose, 0)} → {lvl(hover.y.close, 0)} · deepest fall {pct(hover.y.maxDdPct)}
            <br />
            up months {hover.y.upMonths}, down {hover.y.downMonths}
          </>
        )}
      </Readout>
    </div>
  );
}

/* -------------------------------------------------------- two indices year by year */
export function PairBars({ rows, a, b }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState(null);
  const list = rows.filter((r) => r.a && r.b && num(r.a.pct) && num(r.b.pct)).slice().reverse();
  if (!list.length) return <div ref={ref} className="ixc-empty">No year in common.</div>;
  const H = 230;
  const L = 48;
  const R = 8;
  const T = 12;
  const B = 26;
  const vals = list.flatMap((r) => [r.a.pct, r.b.pct]);
  const sc = ticksOf(Math.min(0, ...vals), Math.max(0, ...vals));
  const bw = (W - L - R) / list.length;
  const X = (i) => L + i * bw;
  const Y = (x) => T + (1 - (x - sc.min) / (sc.max - sc.min)) * (H - T - B);
  const every = Math.max(1, Math.ceil(list.length / Math.max(4, Math.floor((W - L) / 44))));
  const half = Math.max(1.5, (bw - 6) / 2);
  return (
    <div ref={ref} className="ixc">
      <svg width={W} height={H} role="img" aria-label={`${a} and ${b} year by year`} onMouseLeave={() => setHover(null)}>
        {sc.ticks.map((t) => (
          <g key={t} className="ixc-grid">
            <line x1={L} x2={W - R} y1={Y(t)} y2={Y(t)} />
            <text x={L - 6} y={Y(t) + 4} textAnchor="end">
              {pct(t, 0)}
            </text>
          </g>
        ))}
        <line className="ixc-zero" x1={L} x2={W - R} y1={Y(0)} y2={Y(0)} />
        {list.map((r, i) => {
          const y0 = Y(0);
          return (
            <g key={r.y} onMouseEnter={() => setHover({ i, r })}>
              <rect className="ixc-hit" x={X(i)} y={T} width={bw} height={H - T - B} />
              <rect className="ixc-pa" x={X(i) + 2} y={Math.min(y0, Y(r.a.pct))} width={half} height={Math.max(1, Math.abs(Y(r.a.pct) - y0))} rx="2" />
              <rect className="ixc-pb" x={X(i) + 4 + half} y={Math.min(y0, Y(r.b.pct))} width={half} height={Math.max(1, Math.abs(Y(r.b.pct) - y0))} rx="2" />
              {i % every === 0 && (
                <text className="ixc-axis" x={X(i) + bw / 2} y={H - 8} textAnchor="middle">
                  {bw >= 34 ? r.y : `’${String(r.y).slice(2)}`}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <Readout at={hover ? { x: Math.min(X(hover.i) + bw, W - 190), y: 8 } : null}>
        {hover && (
          <>
            <b>
              {hover.r.y}
              {hover.r.a.partial ? " (so far)" : ""}
            </b>
            <br />
            {a}: {pct(hover.r.a.pct)} · {b}: {pct(hover.r.b.pct)}
            <br />
            gap {pct(hover.r.a.pct - hover.r.b.pct)}
          </>
        )}
      </Readout>
      <ul className="ixc-legend">
        <li>
          <i className="is-a" /> {a}
        </li>
        <li>
          <i className="is-b" /> {b}
        </li>
      </ul>
    </div>
  );
}
