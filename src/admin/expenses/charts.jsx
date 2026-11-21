// The charts of the Expenses page, in the manner of Google Analytics: a line with a crosshair that finds the day, the
// period before as a dashed line beside it, a donut with its legend, ranked bars, columns and sparklines.
//
// Rules they keep (see the dataviz notes in expenses.css):
//   · a group's colour is the group's, never its rank's; text is written in ink, a swatch beside it carries the colour
//   · lines 2px, an area is a 10% wash, gridlines are solid hairlines, a bar is at most 24px thick, rounded at its end
//   · every value a hover shows can also be read without hovering (a legend with figures, a list, or a table)
// Plots are SVG drawn on a 1000-unit width and stretched to the card (strokes keep their width); text, dots and the
// tooltip are HTML laid over the plot, so nothing is squashed and nothing needs measuring.
import React, { useMemo, useState } from "react";
import { compact, money, niceScale } from "./ledger";

const W = 1000;
const pctText = (x) => `${Math.round(x * 100)}%`;

/** A tiny trend for a scorecard: the line, a wash under it, the last point marked. */
export function Sparkline({ values, tone = "accent", label }) {
  const v = (values || []).map((x) => (Number.isFinite(x) ? x : 0));
  if (v.length < 2 || v.every((x) => x === 0)) return <span className="ex-spark ex-spark--empty" aria-hidden="true" />;
  const max = Math.max(...v) || 1;
  const pts = v.map((x, i) => [(i / (v.length - 1)) * W, 30 - (x / max) * 26]);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <span className={`ex-spark ex-spark--${tone}`} role="img" aria-label={label}>
      <svg viewBox={`0 0 ${W} 32`} preserveAspectRatio="none" aria-hidden="true">
        <path className="ex-spark__area" d={`${d} L${W} 32 L0 32 Z`} />
        <path className="ex-spark__line" d={d} vectorEffect="non-scaling-stroke" />
      </svg>
      <i className="ex-spark__dot" style={{ left: "100%", top: `${(pts[pts.length - 1][1] / 32) * 100}%` }} aria-hidden="true" />
    </span>
  );
}

/**
 * Spending over time as a line, with the period before as a dashed line. One crosshair finds the nearest day (or
 * month); the tooltip lists both lines; a click opens that day or month.
 * @param rows  [{ key, label, long, total, count }]
 * @param prev  [number|null] the period before, bar for bar (or null for no comparison)
 */
export function TrendLine({ rows, prev = null, prevLabel = "Previous period", onPick, height = 240, upTo = "" }) {
  const [at, setAt] = useState(-1);
  const n = rows.length;
  const showPrev = Array.isArray(prev) && prev.some((x) => Number.isFinite(x) && x > 0);
  const scale = useMemo(() => niceScale(Math.max(0, ...rows.map((r) => r.total), ...(showPrev ? prev.filter(Number.isFinite) : []))), [rows, prev, showPrev]);
  const x = (i) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v) => height - (v / scale.max) * height;
  const path = (vals) =>
    vals
      .map((v, i) => (Number.isFinite(v) ? `${i && Number.isFinite(vals[i - 1]) ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}` : ""))
      .join(" ")
      .trim();
  // a day (or month) still to come is not a zero: the line stops at today, as on a Google Analytics report
  const cur = rows.map((r) => (upTo && r.from > upTo ? null : r.total));
  const last = cur.reduce((k, v, i) => (Number.isFinite(v) ? i : k), -1);
  const line = path(cur);
  const area = last >= 0 ? `${path(cur.slice(0, last + 1))} L${x(last)} ${height} L${x(0)} ${height} Z` : "";
  const every = n > 40 ? 7 : n > 24 ? 5 : n > 14 ? 3 : n > 9 ? 2 : 1;
  const hover = at >= 0 ? rows[at] : null;
  const left = (i) => `${(x(i) / W) * 100}%`;
  return (
    <div className="ex-line" onPointerLeave={() => setAt(-1)}>
      <div className="ex-line__body">
        <div className="ex-axis-y" style={{ height }} aria-hidden="true">
          {scale.ticks.map((t) => (
            <span key={t} style={{ bottom: `${(t / scale.max) * 100}%` }}>
              {compact(t)}
            </span>
          ))}
        </div>
        <div className="ex-line__plot" style={{ height }}>
          {scale.ticks.map((t) => (
            <i key={t} className="ex-gl" style={{ bottom: `${(t / scale.max) * 100}%` }} aria-hidden="true" />
          ))}
          <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" aria-hidden="true">
            <path className="ex-line__area" d={area} />
            {showPrev && <path className="ex-line__prev" d={path(prev)} vectorEffect="non-scaling-stroke" />}
            <path className="ex-line__cur" d={line} vectorEffect="non-scaling-stroke" />
          </svg>
          {hover && (
            <>
              <i className="ex-line__cross" style={{ left: left(at) }} aria-hidden="true" />
              {showPrev && Number.isFinite(prev[at]) && <i className="ex-line__dot ex-line__dot--prev" style={{ left: left(at), top: `${(y(prev[at]) / height) * 100}%` }} aria-hidden="true" />}
              {Number.isFinite(cur[at]) && <i className="ex-line__dot" style={{ left: left(at), top: `${(y(hover.total) / height) * 100}%` }} aria-hidden="true" />}
              <div className={`ex-tip${at > n / 2 ? " is-left" : ""}`} style={{ left: left(at) }} role="status">
                <span>{hover.long}</span>
                <span className="ex-tip__row">
                  <i className="ex-key ex-key--cur" aria-hidden="true" />
                  <b>{Number.isFinite(cur[at]) ? money(hover.total) : "—"}</b> {Number.isFinite(cur[at]) ? "spent" : "still to come"}
                  {hover.count ? ` · ${hover.count} ${hover.count === 1 ? "entry" : "entries"}` : ""}
                </span>
                {showPrev && (
                  <span className="ex-tip__row">
                    <i className="ex-key ex-key--prev" aria-hidden="true" />
                    <b>{Number.isFinite(prev[at]) ? money(prev[at]) : "—"}</b> {prevLabel.toLowerCase()}
                  </span>
                )}
              </div>
            </>
          )}
          <div className="ex-line__hits">
            {rows.map((r, i) => (
              <button
                type="button"
                key={r.key}
                onPointerEnter={() => setAt(i)}
                onFocus={() => setAt(i)}
                onBlur={() => setAt(-1)}
                onClick={() => onPick && onPick(r)}
                aria-label={`${r.long}: ${money(r.total)}${showPrev && Number.isFinite(prev[i]) ? `, ${money(prev[i])} in the period before` : ""}. Press to open it.`}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="ex-axis-x" aria-hidden="true">
        {rows.map((r, i) => (
          <span key={r.key} style={{ left: left(i) }}>
            {i % every === 0 || i === n - 1 ? r.label : ""}
          </span>
        ))}
      </div>
      <ul className="ex-legend" aria-label="Lines">
        <li>
          <i className="ex-key ex-key--cur" aria-hidden="true" />
          This period
        </li>
        {showPrev && (
          <li>
            <i className="ex-key ex-key--prev" aria-hidden="true" />
            {prevLabel}
          </li>
        )}
      </ul>
    </div>
  );
}

/** One bar a day, month or year, stacked by group; a bar can be pressed. */
export function StackBars({ rows, unit, groups, onPick, height = 240 }) {
  const [at, setAt] = useState(-1);
  const scale = useMemo(() => niceScale(Math.max(0, ...rows.map((r) => r.total))), [rows]);
  const present = groups.filter((g) => rows.some((r) => r.parts[g.id]));
  const tallest = rows.reduce((best, r, i) => (r.total > (best < 0 ? 0 : rows[best].total) ? i : best), -1);
  const every = unit === "day" ? 5 : rows.length > 24 ? 3 : rows.length > 14 ? 2 : 1;
  const showLabel = (r, i) => (unit === "day" ? i === 0 || Number(r.label) % every === 0 : i % every === 0);
  const hover = at >= 0 ? rows[at] : null;
  return (
    <div className="ex-chart" onPointerLeave={() => setAt(-1)}>
      <div className="ex-chart__body">
        <div className="ex-axis-y" style={{ height }} aria-hidden="true">
          {scale.ticks.map((t) => (
            <span key={t} style={{ bottom: `${(t / scale.max) * 100}%` }}>
              {compact(t)}
            </span>
          ))}
        </div>
        <div className="ex-chart__plot" style={{ height }}>
          {scale.ticks.map((t) => (
            <i key={t} className="ex-gl" style={{ bottom: `${(t / scale.max) * 100}%` }} aria-hidden="true" />
          ))}
          <div className="ex-chart__cols">
            {rows.map((r, i) => {
              const segs = groups.filter((g) => r.parts[g.id] > 0);
              const gap = segs.length > 1 ? (2 * (segs.length - 1)) / segs.length : 0;
              return (
                <button
                  type="button"
                  key={r.key}
                  className={`ex-col${i === at ? " is-on" : ""}`}
                  onPointerEnter={() => setAt(i)}
                  onFocus={() => setAt(i)}
                  onBlur={() => setAt(-1)}
                  onClick={() => onPick(r)}
                  aria-label={`${r.long}: ${money(r.total)}${r.count ? ` in ${r.count} ${r.count === 1 ? "entry" : "entries"}` : ""}. Press to open it.`}
                >
                  {i === tallest && r.total > 0 && <span className="ex-col__cap">{compact(r.total)}</span>}
                  <span className="ex-col__bar">
                    {segs.map((g, k) => (
                      <i key={g.id} className={`ex-g--${g.id}${k === segs.length - 1 ? " is-top" : ""}`} style={{ height: Math.max(1, (r.parts[g.id] / scale.max) * height - gap) }} />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
          {hover && (
            <div className={`ex-tip${at > rows.length / 2 ? " is-left" : ""}`} style={{ left: `${((at + 0.5) / rows.length) * 100}%` }} role="status">
              <span>{hover.long}</span>
              <b className="ex-tip__big">{money(hover.total)}</b>
              {groups
                .filter((g) => hover.parts[g.id] > 0)
                .map((g) => (
                  <span className="ex-tip__row" key={g.id}>
                    <i className={`ex-key ex-g--${g.id}`} aria-hidden="true" />
                    <b>{money(hover.parts[g.id])}</b> {g.label}
                  </span>
                ))}
              {!hover.count && <span>Nothing spent</span>}
            </div>
          )}
        </div>
      </div>
      <div className="ex-chart__x" aria-hidden="true">
        {rows.map((r, i) => (
          <span key={r.key}>{showLabel(r, i) ? r.label : ""}</span>
        ))}
      </div>
      {present.length > 1 && (
        <ul className="ex-legend" aria-label="Groups">
          {present.map((g) => (
            <li key={g.id}>
              <i className={`ex-sw ex-g--${g.id}`} aria-hidden="true" />
              {g.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The split as a donut, its legend beside it with every figure (so nothing hides behind the hover). The selected
 * group stays in colour and the rest turn grey; pressing a group in the legend selects it, pressing it again clears.
 * @param parts  [{ id, label, total, share }] largest first
 */
export function Donut({ parts, whole, selected = "", onPick, title = "Where it went" }) {
  const [hover, setHover] = useState("");
  const R = 80;
  const C = 2 * Math.PI * R;
  const gap = parts.length > 1 ? 3 : 0;
  let run = 0;
  const arcs = parts.map((p) => {
    const len = Math.max(0, p.share * C - gap);
    const arc = { ...p, dash: `${len} ${C - len}`, offset: -run };
    run += p.share * C;
    return arc;
  });
  const focus = parts.find((p) => p.id === (hover || selected));
  return (
    <div className="ex-donut">
      <div className="ex-donut__ring">
        <svg viewBox="0 0 200 200" role="img" aria-label={`${title}: ${parts.map((p) => `${p.label} ${pctText(p.share)}`).join(", ")}`}>
          <circle className="ex-donut__track" cx="100" cy="100" r={R} />
          {arcs.map((a) => (
            <circle
              key={a.id}
              className={`ex-donut__arc ex-g--${a.id}${selected && selected !== a.id ? " is-dim" : ""}${hover === a.id ? " is-hover" : ""}`}
              cx="100"
              cy="100"
              r={R}
              strokeDasharray={a.dash}
              strokeDashoffset={a.offset}
              transform="rotate(-90 100 100)"
              onPointerEnter={() => setHover(a.id)}
              onPointerLeave={() => setHover("")}
              onClick={() => onPick && onPick(a.id)}
            />
          ))}
        </svg>
        <div className="ex-donut__mid" aria-hidden="true">
          <span>{focus ? focus.label : "Total"}</span>
          <b>{compact(focus ? focus.total : whole)}</b>
          <small>{focus ? pctText(focus.share) : `${parts.length} group${parts.length === 1 ? "" : "s"}`}</small>
        </div>
      </div>
      <ul className="ex-donut__legend">
        {parts.map((p) => (
          <li key={p.id} className={`${selected === p.id ? "is-on" : ""}${selected && selected !== p.id ? " is-dim" : ""}`}>
            <button type="button" onClick={() => onPick && onPick(p.id)} onPointerEnter={() => setHover(p.id)} onPointerLeave={() => setHover("")} onFocus={() => setHover(p.id)} onBlur={() => setHover("")} aria-pressed={selected === p.id}>
              <i className={`ex-sw ex-g--${p.id}`} aria-hidden="true" />
              <span className="ex-donut__name">{p.label}</span>
              <b>{money(p.total)}</b>
              <small>{pctText(p.share)}</small>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Ranked bars in one colour: a name, a bar, a figure and a share on each row.
 * @param rows  [{ id, label, total, share, count, sub }]
 */
export function RankBars({ rows, limit = 10, tone = "accent", onPick, empty = "Nothing here yet." }) {
  if (!rows.length) return <p className="ex-empty">{empty}</p>;
  const top = rows[0].total || 1;
  const shown = rows.slice(0, limit);
  return (
    <ul className={`ex-rank ex-rank--${tone}`}>
      {shown.map((r) => {
        const Row = onPick ? "button" : "div";
        return (
          <li key={r.id}>
            <Row {...(onPick ? { type: "button", onClick: () => onPick(r) } : {})} className="ex-rank__row">
              <span className="ex-rank__name">
                {r.group && <i className={`ex-sw ex-g--${r.group}`} aria-hidden="true" />}
                <span>{r.label}</span>
              </span>
              <span className="ex-rank__bar" aria-hidden="true">
                <i style={{ width: `${Math.max(1.5, (r.total / top) * 100)}%` }} />
              </span>
              <b>{money(r.total)}</b>
              <small>{r.sub !== undefined ? r.sub : pctText(r.share)}</small>
            </Row>
          </li>
        );
      })}
      {rows.length > limit && <li className="ex-rank__more">and {rows.length - limit} more</li>}
    </ul>
  );
}

/** Columns for a small fixed set (the days of the week): the tallest carries its figure, every one says it on hover. */
export function Columns({ rows, height = 150 }) {
  const [at, setAt] = useState(-1);
  const max = Math.max(1, ...rows.map((r) => r.total));
  const tallest = rows.reduce((b, r, i) => (r.total > rows[b].total ? i : b), 0);
  return (
    <div className="ex-colset" onPointerLeave={() => setAt(-1)}>
      <div className="ex-colset__plot" style={{ height }}>
        {rows.map((r, i) => (
          <div key={r.key} className={`ex-colset__c${i === at ? " is-on" : ""}`} tabIndex={0} onPointerEnter={() => setAt(i)} onFocus={() => setAt(i)} onBlur={() => setAt(-1)} aria-label={`${r.label}: ${money(r.total)} in ${r.count} ${r.count === 1 ? "entry" : "entries"}`}>
            {(i === tallest || i === at) && r.total > 0 && <span className="ex-colset__v">{compact(r.total)}</span>}
            <i style={{ height: `${Math.max(r.total > 0 ? 2 : 0, (r.total / max) * (height - 22))}px` }} />
          </div>
        ))}
      </div>
      <div className="ex-colset__x" aria-hidden="true">
        {rows.map((r) => (
          <span key={r.key}>{r.short}</span>
        ))}
      </div>
    </div>
  );
}
