// The way around the terminal on a phone or a tablet: the workspaces sit along the bottom
// edge, under the thumb, instead of in a row of tabs at the top. A phone shows the first
// four and keeps the rest under "More"; a tablet has room for all of them. "More" also holds
// what the slim top bar had to drop: the market clock, the Zerodha connection, the theme.

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminPath } from "../../paths";
import { useTrade } from "../trade/TradeContext";
import { useClock, useKite } from "./TopBar";
import { useMedia } from "./useMedia";

const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" };
const ICONS = {
  analyzer: <path {...P} d="M3 20h18M4 16l5-6 4 3 7-9" />,
  advisor: (
    <>
      <circle {...P} cx="12" cy="12" r="9" />
      <path {...P} d="M8.2 12.4l2.6 2.6 5-6" />
    </>
  ),
  account: (
    <>
      <rect {...P} x="3" y="7" width="18" height="13" rx="2" />
      <path {...P} d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7M3 13h18" />
    </>
  ),
  journal: <path {...P} d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11M9 8h6" />,
  research: (
    <>
      <circle {...P} cx="11" cy="11" r="6.5" />
      <path {...P} d="M20 20l-4.3-4.3" />
    </>
  ),
  screener: <path {...P} d="M3 5h18l-7 8.5V19l-4-2v-3.5z" />,
  debrief: (
    <>
      <circle {...P} cx="12" cy="12" r="9" />
      <path {...P} d="M12 7v5l3.2 2" />
    </>
  ),
  calendar: (
    <>
      <rect {...P} x="3" y="5" width="18" height="16" rx="2" />
      <path {...P} d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.7" fill="currentColor" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" />
      <circle cx="19" cy="12" r="1.7" fill="currentColor" />
    </>
  ),
};
const Icon = ({ id }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    {ICONS[id] || ICONS.more}
  </svg>
);

function MoreSheet({ rest, view, onView, theme, onTheme, onAlerts, onClose }) {
  const clock = useClock();
  const kite = useKite();
  const trade = useTrade();
  const connected = Boolean(kite && kite.mode === "kite");
  useEffect(() => {
    const esc = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  const go = (id) => {
    onView(id);
    onClose();
  };
  return (
    <div className="tm-sheet" role="dialog" aria-modal="true" aria-label="More" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="tm-sheet__box">
        <i className="tm-sheet__grip" aria-hidden="true" />
        {rest.length > 0 && (
          <div className="tm-sheet__views">
            {rest.map((v) => (
              <button key={v.id} type="button" aria-current={view === v.id ? "page" : undefined} onClick={() => go(v.id)}>
                <Icon id={v.id} />
                <b>{v.label}</b>
                <small>{v.tip}</small>
              </button>
            ))}
          </div>
        )}
        <ul className="tm-sheet__status">
          <li>
            <i className={`is-${clock.state === "open" ? "ok" : clock.state === "pre-open" ? "warn" : "off"}`} aria-hidden="true" />
            <span>
              NSE {clock.state} · <b>{clock.time}</b> IST
            </span>
          </li>
          <li>
            <i className={`is-${connected ? "ok" : kite && kite.mode === "demo" ? "warn" : "off"}`} aria-hidden="true" />
            <span>{connected ? `Zerodha connected${kite.user ? ` · ${kite.user}` : ""}` : kite && kite.mode === "demo" ? "Demo data — Zerodha is not connected" : "Zerodha is not connected"}</span>
            {!connected && (
              <button type="button" onClick={() => go("analyzer")}>
                Connect
              </button>
            )}
          </li>
          {trade && (
            <li>
              <i className={`is-${trade.enabled ? "live" : "off"}`} aria-hidden="true" />
              <span>Trading is {trade.enabled ? "ON — orders go to your Zerodha account" : "OFF"}</span>
              <button type="button" onClick={() => go("account")}>
                {trade.enabled ? "Switch" : "Open"}
              </button>
            </li>
          )}
          {trade && trade.status && trade.status.riskLock && (
            <li>
              <i className="is-live" aria-hidden="true" />
              <span>Risk guard: {trade.status.riskLock.reason}</span>
            </li>
          )}
        </ul>
        <div className="tm-sheet__acts">
          <button
            type="button"
            onClick={() => {
              onAlerts();
              onClose();
            }}
          >
            Price alerts
          </button>
          <button type="button" onClick={onTheme}>
            {theme === "dark" ? "Light theme" : "Dark theme"}
          </button>
          <Link to={adminPath()} onClick={onClose}>
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function BottomNav({ views, view, onView, theme, onTheme, onAlerts }) {
  const [more, setMore] = useState(false);
  const roomy = useMedia("(min-width: 700px)"); // a tablet: every workspace fits in the bar
  const shown = roomy ? views : views.slice(0, 4);
  const rest = roomy ? [] : views.slice(4);
  return (
    <>
      <nav className="tm-bnav" aria-label="Workspaces">
        {shown.map((v) => (
          <button key={v.id} type="button" aria-current={view === v.id ? "page" : undefined} onClick={() => onView(v.id)}>
            <Icon id={v.id} />
            <span>{v.label}</span>
          </button>
        ))}
        <button type="button" className={rest.some((v) => v.id === view) ? "is-on" : ""} aria-expanded={more} aria-haspopup="dialog" onClick={() => setMore(true)}>
          <Icon id="more" />
          <span>More</span>
        </button>
      </nav>
      {more && <MoreSheet rest={rest} view={view} onView={onView} theme={theme} onTheme={onTheme} onAlerts={onAlerts} onClose={() => setMore(false)} />}
    </>
  );
}
