// The terminal's top bar: where you are (workspaces), what state everything is in (market
// open, Zerodha connected, trading switch, the day's P&L) and the few controls that apply
// everywhere (theme, shortcuts, hover help, sign out).

import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { adminPath } from "../../paths";
import { setTipsEnabled, useTipsEnabled } from "../../help/TipLayer";
import { useTrade } from "../trade/TradeContext";
import { num } from "../analyzer/format";

const IST = 5.5 * 3600 * 1000;
function istNow() {
  const d = new Date(Date.now() + IST);
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  const dow = d.getUTCDay();
  const open = dow >= 1 && dow <= 5 && m >= 9 * 60 + 15 && m < 15 * 60 + 30;
  const pre = dow >= 1 && dow <= 5 && m >= 9 * 60 && m < 9 * 60 + 15;
  return { time: d.toISOString().slice(11, 19), state: open ? "open" : pre ? "pre-open" : "closed" };
}

function useClock() {
  const [now, setNow] = useState(istNow);
  useEffect(() => {
    const id = setInterval(() => setNow(istNow()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Whether Zerodha is connected, re-read every minute (the session dies at 6 AM). */
function useKite() {
  const [k, setK] = useState(null);
  useEffect(() => {
    let alive = true;
    const read = () =>
      api("/api/admin/market/status")
        .then((s) => alive && setK({ mode: s.mode, user: s.kite && s.kite.user, expiresAt: s.kite && s.kite.expiresAt }))
        .catch(() => alive && setK(null));
    read();
    const id = setInterval(read, 60000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return k;
}

function UserMenu() {
  const { user } = useAuth();
  const tips = useTipsEnabled();
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const off = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [open]);
  if (!user) return null;
  const logout = async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign(adminPath());
    }
  };
  return (
    <div className="tm-user" ref={box}>
      <button type="button" className="tm-user__btn" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)} data-tip="Your account, hover help and sign out.">
        {user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" width="28" height="28" /> : <span aria-hidden="true">{(user.name || user.email).slice(0, 1).toUpperCase()}</span>}
        <span className="adm-sr">Account menu</span>
      </button>
      {open && (
        <div className="tm-menu" role="menu">
          <p className="tm-menu__who">
            <b>{user.name || user.email}</b>
            <small>
              {user.email} · {user.role === "superadmin" ? "Superadmin" : "Admin"}
            </small>
          </p>
          <Link role="menuitem" to={adminPath()} onClick={() => setOpen(false)}>
            Dashboard
          </Link>
          <button type="button" role="menuitemcheckbox" aria-checked={tips} onClick={() => setTipsEnabled(!tips)}>
            Hover help: {tips ? "on" : "off"}
          </button>
          <button type="button" role="menuitem" onClick={logout}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function TopBar({ views, view, onView, theme, onTheme, onHelp }) {
  const clock = useClock();
  const kite = useKite();
  const trade = useTrade();
  const pulse = trade && trade.pulse;
  const connected = Boolean(kite && kite.mode === "kite");
  return (
    <header className="tm-top">
      <Link to={adminPath()} className="tm-brand" data-tip="Back to the dashboard.">
        <span className="tm-brand__mark" aria-hidden="true">
          ▲
        </span>
        <span className="tm-brand__name">Control room</span>
      </Link>

      <nav className="tm-tabs" role="tablist" aria-label="Workspaces">
        {views.map((v, i) => (
          <button key={v.id} type="button" role="tab" aria-selected={view === v.id} onClick={() => onView(v.id)} data-tip={`${v.tip} Shortcut: ${i + 1}.`}>
            {v.label}
            <kbd aria-hidden="true">{i + 1}</kbd>
          </button>
        ))}
      </nav>

      <div className="tm-status">
        <span className={`tm-pill tm-pill--${clock.state}`} data-tip="NSE’s session by the clock (9:15 AM – 3:30 PM IST, Monday to Friday). Exchange holidays are listed under Calendar.">
          <i aria-hidden="true" />
          NSE {clock.state} · <b>{clock.time}</b> IST
        </span>
        <button
          type="button"
          className={`tm-pill tm-pill--btn ${connected ? "tm-pill--ok" : kite && kite.mode === "demo" ? "tm-pill--warn" : "tm-pill--off"}`}
          onClick={() => onView("analyzer")}
          data-tip={connected ? `Zerodha is connected${kite.expiresAt ? ` until ${new Date(kite.expiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : ""}. Live prices and the account come from it.` : "Zerodha is not connected. Open the Desk to log in to Kite (once each trading morning)."}
        >
          <i aria-hidden="true" />
          {connected ? `Kite${kite.user ? ` · ${kite.user}` : ""}` : kite && kite.mode === "demo" ? "Demo data" : "Kite offline"}
        </button>
        {trade && trade.status && trade.status.riskLock && (
          <button type="button" className="tm-pill tm-pill--btn tm-pill--locked" onClick={() => onView("account")} data-tip={`Risk guard: ${trade.status.riskLock.reason} New trades are refused until tomorrow; exits still work.`}>
            <i aria-hidden="true" />
            Risk locked
          </button>
        )}
        {trade && (
          <button type="button" className={`tm-pill tm-pill--btn ${trade.enabled ? "tm-pill--live" : "tm-pill--off"}`} onClick={() => onView("account")} data-tip={trade.enabled ? "Trading is ON: Buy, Sell, Exit and Cancel send real orders. Open Positions to turn it off." : "Trading is OFF: Buy and Sell are disabled. Open Positions to turn it on."}>
            <i aria-hidden="true" />
            Trading {trade.enabled ? "ON" : "OFF"}
          </button>
        )}
        {trade && pulse && (
          <button type="button" className={`tm-pill tm-pill--btn tm-pnl ${pulse.pnl > 0 ? "is-up" : pulse.pnl < 0 ? "is-down" : ""}`} onClick={() => onView("account")} data-tip="Today’s P&L on all positions, open and closed, as Zerodha reports it (refreshed every 15 seconds).">
            P&amp;L <b>{`${pulse.pnl > 0 ? "+" : pulse.pnl < 0 ? "−" : ""}₹${num(Math.abs(pulse.pnl))}`}</b>
            <small>{pulse.open} open</small>
          </button>
        )}
        <button type="button" className="tm-icon" onClick={onTheme} aria-label={theme === "dark" ? "Light theme" : "Dark theme"} data-tip="Switch between dark and light. Shortcut: T.">
          {theme === "dark" ? "☀" : "☾"}
        </button>
        <button type="button" className="tm-icon" onClick={onHelp} aria-label="Keyboard shortcuts" data-tip="Keyboard shortcuts. Shortcut: ?">
          ?
        </button>
        <UserMenu />
      </div>
    </header>
  );
}
