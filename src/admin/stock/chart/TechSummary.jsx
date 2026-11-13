// The technical summary under the chart: moving averages and oscillators each vote buy,
// sell or neutral on the latest bar of the interval on screen, and the votes are tallied
// into one reading — the way the big market sites summarise a chart. A mechanical count of
// indicators, not a forecast and not advice.

import React, { useMemo, useState } from "react";
import { technicalSummary } from "./studies";

const TONE = { "Strong buy": "up", Buy: "up-soft", Neutral: "flat", Sell: "down-soft", "Strong sell": "down" };
const fmt = (x) => (typeof x === "number" && Number.isFinite(x) ? x.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—");

function Gauge({ t, title }) {
  // −1 (all sell) … +1 (all buy) → a needle from left to right
  const angle = -90 + ((t.score + 1) / 2) * 180;
  return (
    <div className={`ts__g ts__g--${TONE[t.label]}`}>
      <svg viewBox="0 0 120 66" role="img" aria-label={`${title}: ${t.label}`}>
        <path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke="var(--line-2)" strokeWidth="8" strokeLinecap="round" />
        <path d="M10 60 A50 50 0 0 1 35 17" fill="none" stroke="var(--down)" strokeWidth="8" strokeLinecap="round" opacity="0.8" />
        <path d="M85 17 A50 50 0 0 1 110 60" fill="none" stroke="var(--up)" strokeWidth="8" strokeLinecap="round" opacity="0.8" />
        <line x1="60" y1="60" x2="60" y2="18" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" transform={`rotate(${angle} 60 60)`} />
        <circle cx="60" cy="60" r="5" fill="var(--ink)" />
      </svg>
      <small>{title}</small>
      <b>{t.label}</b>
      <span>
        Buy {t.buy} · Neutral {t.neutral} · Sell {t.sell}
      </span>
    </div>
  );
}

export default function TechSummary({ bars, interval }) {
  const s = useMemo(() => technicalSummary(bars), [bars]);
  const [open, setOpen] = useState(false);
  if (!s) return null;
  return (
    <div className="ts">
      <div className="ts__head">
        <h4>Technical summary · {interval}</h4>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide details" : "Details"}
        </button>
      </div>
      <div className="ts__gauges">
        <Gauge t={s.mas} title="Moving averages" />
        <Gauge t={s.overall} title="Summary" />
        <Gauge t={s.oscillators} title="Oscillators" />
      </div>
      {open && (
        <div className="ts__tables">
          {[
            ["Moving averages", s.mas.list],
            ["Oscillators", s.oscillators.list],
          ].map(([title, list]) => (
            <table key={title} className="an-table">
              <thead>
                <tr>
                  <th scope="col">{title}</th>
                  <th scope="col" className="is-num">
                    Value
                  </th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {list.map((x) => (
                  <tr key={x.name}>
                    <th scope="row">{x.name}</th>
                    <td className="is-num">{fmt(x.value)}</td>
                    <td className={`ts__a ts__a--${x.action}`}>{x.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      )}
      <p className="vd-note">A count of indicator readings on the latest bar of this interval — not a forecast and not advice.</p>
    </div>
  );
}
