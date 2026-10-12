// src/admin/ui.jsx
// The few pieces the account and admin screens share.

import React from "react";
import { IconAlert, IconArrowDown, IconArrowUp, IconRefresh } from "../components/ui/icons";
import { delta } from "./format";

export function Card({ title, sub, action, children, className = "", pad = true }) {
  return (
    <section className={`dc ${pad ? "" : "dc--flush"} ${className}`}>
      {(title || action) && (
        <header className="dc__h">
          <div>
            {title ? <h3 className="dc__t">{title}</h3> : null}
            {sub ? <p className="dc__s">{sub}</p> : null}
          </div>
          {action ? <div className="dc__a">{action}</div> : null}
        </header>
      )}
      {children}
    </section>
  );
}

/** One headline number, with its change against the period before. */
export function Kpi({ label, value, hint, now, before, icon, tone = "" }) {
  const d = before === undefined ? null : delta(now, before);
  return (
    <div className={`kpi ${tone ? `kpi--${tone}` : ""}`}>
      <div className="kpi__top">
        <span className="kpi__l">{label}</span>
        {icon ? <span className="kpi__i">{icon}</span> : null}
      </div>
      <div className="kpi__v">{value}</div>
      <div className="kpi__f">
        {d ? (
          <span className={`kpi__d ${d.up ? "is-up" : "is-down"}`} title="Compared with the period before">
            {d.up ? <IconArrowUp size={13} strokeWidth={2.4} /> : <IconArrowDown size={13} strokeWidth={2.4} />}
            {d.fresh ? "new" : `${Math.abs(d.pct)}%`}
          </span>
        ) : null}
        {hint ? <span className="kpi__h">{hint}</span> : null}
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange, label = "Sections" }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          className={`tabs__b ${value === t.id ? "is-on" : ""}`}
          onClick={() => onChange(t.id)}
        >
          {t.icon ? <span className="tabs__i">{t.icon}</span> : null}
          {t.label}
          {t.badge ? <b className="tabs__n">{t.badge}</b> : null}
        </button>
      ))}
    </div>
  );
}

export function Chip({ tone = "", children }) {
  return <span className={`dchip ${tone ? `dchip--${tone}` : ""}`}>{children}</span>;
}

export function Loading({ label = "Loading…" }) {
  return (
    <div className="ld" role="status">
      <span className="ld__ring" />
      <span>{label}</span>
    </div>
  );
}

export function Failure({ error, onRetry, text }) {
  return (
    <div className="fl" role="alert">
      <IconAlert size={22} />
      <p>{text || "This could not be loaded."}</p>
      {onRetry ? (
        <button type="button" className="db db--ghost db--sm" onClick={onRetry}>
          <IconRefresh size={15} /> Try again
        </button>
      ) : null}
      {error && error.code ? <small>{error.code}</small> : null}
    </div>
  );
}

export function Empty({ children }) {
  return <p className="em">{children}</p>;
}

/** A skeleton row block while numbers load. */
export function Skeleton({ h = 18, w = "100%" }) {
  return <span className="sk" style={{ height: h, width: w }} />;
}
