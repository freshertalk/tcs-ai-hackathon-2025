// The Journal's page anatomy, for every workspace (23 Nov 2026) — the owner: "redesign all the pages … like the Journal".
//
//   PageHead    the head card: the page's name, one plain line on what it is for, its actions on the right, and any
//               chips or filters under it (the Journal's "Trading journal" card).
//   PageBar     the strip that stays under the top bar while the page scrolls: what is shown ("View"), the page's
//               headline figures in small capitals, refresh and when it was read, and the page's sections as underline
//               tabs (the Journal's command bar).
//   SectionHead a section's title and its muted one-line explanation (the Journal's "Your money over time").
//   FigureBand  Zerodha Console's band of big figures (the Journal's "Realised P&L · Charges · Net …").
//   usePageTab  which section is open, remembered per page for the visit (and the address's ?part= wins).
//
// Pure presentation: the pages keep every piece of their own logic and data; they only arrange it in these frames.
// Styles: pagekit.css (the Journal's journal-pro.css command bar and trade.css heads, under wk- names so a page
// outside the terminal wears them too). Times shown are NSE's (clock/exchangeClock.js).

import "./pagekit.css";
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const toneClass = (t) => (t === "up" ? "is-up" : t === "down" ? "is-down" : t === "warn" ? "is-warn" : "");

/**
 * The head card. `title` (text), `text` (one plain line), `actions` (buttons, right), children (chips, filters, notes).
 * `as`: the title's heading level — "h3" inside the terminal (under its workspace bar), "h1" for a page of its own.
 */
export function PageHead({ title, text, actions, children, className = "", id, as = "h3" }) {
  const H = as;
  return (
    <section className={`an-card wk-head ${className}`.trim()} id={id}>
      <header className="an-card__head">
        <div className="wk-head__titles">
          <H className={as === "h1" ? "wk-head__h1" : undefined}>{title}</H>
          {text ? <p>{text}</p> : null}
        </div>
        {actions ? <span className="wk-head__act">{actions}</span> : null}
      </header>
      {children}
    </section>
  );
}

/**
 * The sticky strip.
 * @param label      what is shown ("Today", "NIFTY 100", "This FY") — the first, bold item
 * @param labelTitle its small-caps title (default "View")
 * @param kpis       [{ label, value, tone: "up"|"down"|"warn"|"", more: true (hidden on a phone), tip }]
 * @param tabs       [{ id, label, count, tip }] — the page's sections (omit for a page that is one section)
 * @param tab/onTab  the open section and how to change it
 * @param updatedAt  when the page's data was read (ms or ISO) — shown as an IST clock (`atSeconds` adds the seconds, for
 *                   a page that re-reads every few seconds)
 * @param onRefresh  read again now (omit when the page refreshes only by itself)
 * @param tools      anything else for the right end (a chip, a link)
 */
export function PageBar({ label, labelTitle = "View", kpis = [], tabs = null, tab, onTab, updatedAt, atSeconds = false, loading = false, onRefresh, refreshTip = "Read this page's data again now (it also keeps itself up to date).", tools, ariaLabel = "This page at a glance", tabsLabel = "Sections of this page", onLabel }) {
  const at = updatedAt ? new Date(typeof updatedAt === "number" ? updatedAt : Date.parse(updatedAt)) : null;
  const Label = onLabel ? "button" : "div";
  const ref = useRef(null);
  // the bar's height, for what else stays on screen under it (a sticky side rail adds var(--wk-bar-h))
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof document === "undefined") return undefined;
    const put = () => document.documentElement.style.setProperty("--wk-bar-h", `${Math.ceil(el.offsetHeight || 0) + 10}px`);
    put();
    window.addEventListener("resize", put);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(put) : null;
    if (ro) ro.observe(el);
    return () => {
      window.removeEventListener("resize", put);
      if (ro) ro.disconnect();
      document.documentElement.style.removeProperty("--wk-bar-h");
    };
  }, []);
  return (
    <div className="wk-bar" role="region" aria-label={ariaLabel} ref={ref}>
      <div className="wk-bar__row">
        {label !== undefined && (
          <Label className="wk-bar__label" {...(onLabel ? { type: "button", onClick: onLabel, "data-tip": "Back to the top of the page." } : {})}>
            <small>{labelTitle}</small>
            <b>{label || "—"}</b>
          </Label>
        )}
        {kpis.length > 0 && (
          <dl className="wk-bar__kpis">
            {kpis.map((k) => (
              <div key={k.label} className={`${toneClass(k.tone)} ${k.more ? "wk-bar__more" : ""}`.trim()} data-tip={k.tip}>
                <dt>{k.label}</dt>
                <dd>{k.value === undefined || k.value === null || k.value === "" ? "—" : k.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {(tools || onRefresh || at) && (
          <div className="wk-bar__tools">
            {tools}
            {onRefresh && (
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={onRefresh} disabled={loading} aria-label="Read again now" data-tip={refreshTip}>
                {loading ? "Reading…" : "↻"}
              </button>
            )}
            {at && !Number.isNaN(at.getTime()) && (
              <small className="wk-bar__at" data-tip="When this page's data was last read (IST)">
                {at.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", ...(atSeconds ? { second: "2-digit" } : {}) })}
              </small>
            )}
          </div>
        )}
      </div>
      {tabs && tabs.length > 0 && (
        <nav className="wk-tabs" role="tablist" aria-label={tabsLabel}>
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => onTab && onTab(t.id)} data-tip={t.tip}>
              {t.label}
              {t.count ? <small>{t.count}</small> : null}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

/**
 * One section of a page with tabs: shown when its tab is open, otherwise hidden — but kept mounted, so whatever it is
 * doing (a live list, a portal another part fills, a running job) carries on exactly as it did before there were tabs.
 */
export function PagePart({ id, tab, children, className = "", all = "" }) {
  // `all`: the id of an "everything" tab (a checklist page shows every part under it as well as under its own tab)
  const shown = tab === id || (all && tab === all);
  return (
    <div className={`wk-part ${className}`.trim()} role="tabpanel" aria-label={id} hidden={!shown} data-part={id}>
      {children}
    </div>
  );
}

/** A section's title, its muted one-line explanation, and anything on the right. */
export function SectionHead({ title, sub, actions, as = "h3" }) {
  const H = as;
  return (
    <header className="wk-sec">
      <div>
        <H className="wk-sec__t">{title}</H>
        {sub ? <small className="wk-sec__s">{sub}</small> : null}
      </div>
      {actions ? <span className="wk-sec__act">{actions}</span> : null}
    </header>
  );
}

/** Zerodha Console's band of big figures: [{ label, value, tone, sub }]. */
export function FigureBand({ items = [], label = "Key figures" }) {
  return (
    <section className="wk-band" aria-label={label}>
      <dl className="wk-band__row">
        {items.map((f) => (
          <div key={f.label} className={`wk-fig ${toneClass(f.tone)}`.trim()} data-tip={f.tip}>
            <dt>{f.label}</dt>
            <dd>{f.value === undefined || f.value === null || f.value === "" ? "—" : f.value}</dd>
            {f.sub ? <small>{f.sub}</small> : null}
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * Which section is open. `page` names the page (the memory is per page, for this visit); `ids` are the allowed
 * sections, the first is the default. The address's ?part=<id> opens that one (a link can point at a section).
 */
export function usePageTab(page, ids, fallback) {
  const key = `wk-tab:${page}`;
  const first = fallback || ids[0];
  const read = () => {
    try {
      const fromUrl = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("part") : null;
      if (fromUrl && ids.includes(fromUrl)) return fromUrl;
      const saved = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(key) : null;
      if (saved && ids.includes(saved)) return saved;
    } catch (_) {
      /* storage blocked: the default */
    }
    return first;
  };
  const [tab, setTabState] = useState(read);
  const setTab = useCallback(
    (id) => {
      if (!ids.includes(id)) return;
      setTabState(id);
      try {
        sessionStorage.setItem(key, id);
      } catch (_) {
        /* storage blocked: kept for this view only */
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, ids.join(",")]
  );
  // a section that disappeared (a page whose sections depend on the role): back to the first
  useEffect(() => {
    if (!ids.includes(tab)) setTabState(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(","), tab, first]);
  return [tab, setTab];
}
