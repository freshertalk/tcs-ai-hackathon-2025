// The terminal's top bar: where you are (workspaces), what state everything is in (market
// open, Zerodha connected, trading switch, the day's P&L) and the few controls that apply
// everywhere (theme, shortcuts, hover help, sign out).

import "./brandmark.css";
import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { adminPath } from "../../paths";
import LiveBadge from "../../LiveBadge";
import BrandMark from "../../BrandMark";
import { setTipsEnabled, useTipsEnabled } from "../../help/TipLayer";
import { useTrade } from "../trade/TradeContext";
import { num } from "../analyzer/format";
import { useAlerts } from "./AlertsContext";
import { TempleButton } from "../../temple/Temple";
import AlertsPanel from "./AlertsPanel";
import ResearchButton from "./ResearchPanel";
import { GoalPill } from "../trade/DailyGoal";
import { pulseOf, useLiveBook } from "../trade/liveBook";
import { useStreamState } from "../analyzer/liveTicks";
import { everyVisible } from "../../visible";
import { onTopics } from "../../live";
import { exchangeNow, startExchangeClock, clockStatus } from "../../clock/exchangeClock";

const IST = 5.5 * 3600 * 1000;

// NSE's trading calendar for today (23 Nov 2026): the clock alone would call a holiday "open" at 9:15. Today's entry comes
// from the server's next-session answer (market/nse-holidays.js, which reads NSE's own holiday list) — the same answer
// as the /me strip and the Calendar page. Shared by every clock on the page; asked at most once a minute.
let calToday = null; // { date, trading, holiday, special }
let calAsked = 0;
const calListeners = new Set();
function askCalendar(force = false) {
  if (!force && Date.now() - calAsked < 60000) return;
  calAsked = Date.now();
  api("/api/admin/market/next-session")
    .then((d) => {
      if (!d || !d.today || !d.today.date) return;
      calToday = { date: d.today.date, trading: Boolean(d.today.trading), holiday: d.today.holiday || "", special: d.today.special || "" };
      calListeners.forEach((f) => f());
    })
    .catch(() => {});
}

function istNow() {
  // NSE's time, not this computer's (clock/exchangeClock.js: measured against the server's time-server-checked clock)
  const d = new Date(exchangeNow() + IST);
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  const dow = d.getUTCDay();
  const open = dow >= 1 && dow <= 5 && m >= 9 * 60 + 15 && m < 15 * 60 + 30;
  const pre = dow >= 1 && dow <= 5 && m >= 9 * 60 && m < 9 * 60 + 15;
  const time = d.toISOString().slice(11, 19);
  // by NSE's calendar when the server has said what today is: shut on a holiday, open on a special weekend session
  const cal = calToday && calToday.date === d.toISOString().slice(0, 10) ? calToday : null;
  if (cal && !cal.trading) return { time, state: "closed", holiday: cal.holiday || (dow === 0 || dow === 6 ? "" : "Market holiday") };
  if (cal && cal.trading && cal.special) {
    const sOpen = m >= 9 * 60 + 15 && m < 15 * 60 + 30;
    const sPre = m >= 9 * 60 && m < 9 * 60 + 15;
    return { time, state: sOpen ? "open" : sPre ? "pre-open" : "closed", special: cal.special };
  }
  return { time, state: open ? "open" : pre ? "pre-open" : "closed" };
}

export function useClock() {
  const [now, setNow] = useState(istNow);
  useEffect(() => {
    startExchangeClock();
    let timer = null;
    let alive = true;
    // turn over on the exact edge of NSE's second, not on a free-running timer that lags by up to a second
    const tick = () => {
      if (!alive) return;
      setNow(istNow());
      // a new IST day: ask what it is (holiday or not) — once; the server's "holidays" event covers any change
      if (!calToday || calToday.date !== new Date(exchangeNow() + IST).toISOString().slice(0, 10)) askCalendar();
      timer = setTimeout(tick, 1000 - (exchangeNow() % 1000) + 2);
    };
    tick();
    const onCal = () => setNow(istNow());
    calListeners.add(onCal);
    askCalendar();
    // NSE's list changing at the source reaches the clock at once (no polling: the live channel says when)
    const unlive = onTopics(["holidays"], () => askCalendar(true));
    return () => {
      alive = false;
      clearTimeout(timer);
      calListeners.delete(onCal);
      unlive();
    };
  }, []);
  return now;
}

/**
 * Whether Zerodha is connected: re-read every minute (the session dies at 6 AM), and at once whenever the
 * live stream changes state (the session ended, the stream came back) or the account says it changed.
 */
export function useKite() {
  const [k, setK] = useState(null);
  const stream = useStreamState();
  const trade = useTrade();
  const tradeConnected = trade ? Boolean(trade.connected) : null;
  useEffect(() => {
    let alive = true;
    const read = () =>
      api("/api/admin/market/status")
        .then((s) => alive && setK({ mode: s.mode, user: s.kite && s.kite.user, expiresAt: s.kite && s.kite.expiresAt }))
        .catch(() => alive && setK(null));
    read();
    const stop = everyVisible(read, 60000, { topics: ["market", "trading", "health"] });
    return () => {
      alive = false;
      stop();
    };
  }, [stream.state, tradeConnected]);
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
        {user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" width="28" height="28" /> : <span aria-hidden="true">{(user.name || "·").slice(0, 1).toUpperCase()}</span>}
        <span className="adm-sr">Account menu</span>
      </button>
      {open && (
        <div className="tm-menu" role="menu">
          <p className="tm-menu__who">
            <b>{user.name || "Signed in"}</b>
            <small>
              {user.role === "superadmin" ? "Superadmin" : "Admin"}
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

export default function TopBar({ views, view, onView, theme, onTheme, onHelp, onPalette, symbol, alertsOpen, onAlerts }) {
  const alerts = useAlerts();
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");
  const clock = useClock();
  const kite = useKite();
  const trade = useTrade();
  // today's P&L from the live book: it moves with every streamed tick (liveBook.js)
  const book = useLiveBook();
  const pulse = trade ? pulseOf(book) || trade.pulse : null;
  const connected = Boolean(kite && kite.mode === "kite");
  return (
    <header className="tm-top">
      <Link to={adminPath()} className="tm-brand" data-tip="Back to the dashboard.">
        <BrandMark size="sm" />
      </Link>

      <nav className="tm-tabs" role="tablist" aria-label="Workspaces">
        {views.map((v, i) => (
          <button key={v.id} type="button" role="tab" aria-selected={view === v.id} onClick={() => onView(v.id)} data-tip={i < 9 ? `${v.tip} Shortcut: ${i + 1}.` : v.tip}>
            {v.label}
            <kbd aria-hidden="true">{i + 1}</kbd>
          </button>
        ))}
      </nav>

      <button type="button" className="tm-cmd" onClick={onPalette} data-tip="Search any stock, jump to a workspace, or type a command: “buy sbin 10” opens the order ticket, “alert infy 1500” sets a price alert. Nothing typed here is ever sent as an order without the ticket’s own confirmation.">
        <span aria-hidden="true">⌕</span>
        <span className="tm-cmd__text">
          Search<span className="tm-x"> or command</span>
        </span>
        <kbd>{mac ? "⌘" : "Ctrl"} K</kbd>
      </button>


      <div className="tm-status">
        <LiveBadge />
        <span
          className={`tm-pill tm-pill--clock tm-pill--${clock.state}`}
          data-tip={`NSE’s session (9:15 AM – 3:30 PM IST) by NSE’s trading calendar: weekends and NSE’s own holiday list are counted.${clock.holiday ? ` Today is a market holiday: ${clock.holiday}.` : ""}${clock.special ? ` Today: ${clock.special}.` : ""} The clock is NSE’s time (IST), kept in step with India’s time servers${clockStatus().synced && clockStatus().accuracy != null ? ` to within ±${clockStatus().accuracy} ms` : ""}, not this computer’s. The full list and the next trading day are on the Calendar and on /me.`}
        >
          <i aria-hidden="true" />
          <span className="tm-x">NSE </span>
          {clock.holiday ? "holiday" : clock.state}
          <span className="tm-x"> ·</span> <b>{clock.time}</b>
          <span className="tm-x"> IST</span>
        </span>
        <button
          type="button"
          className={`tm-pill tm-pill--btn tm-pill--kite ${connected ? "tm-pill--ok" : kite && kite.mode === "demo" ? "tm-pill--warn" : "tm-pill--off"}`}
          onClick={() => onView("analyzer")}
          data-tip={connected ? `Zerodha is connected${kite.expiresAt ? ` until ${new Date(kite.expiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : ""}. Live prices and the account come from it.` : "Zerodha is not connected. Open the Desk to log in to Kite (once each trading morning)."}
        >
          <i aria-hidden="true" />
          {connected ? (
            <>
              Kite<span className="tm-x">{kite.user ? ` · ${kite.user}` : ""}</span>
            </>
          ) : kite && kite.mode === "demo" ? (
            <>
              Demo<span className="tm-x"> data</span>
            </>
          ) : (
            <>
              <span className="tm-x">Kite </span>offline
            </>
          )}
        </button>
        {trade && trade.status && trade.status.riskLock && (
          <button type="button" className="tm-pill tm-pill--btn tm-pill--locked" onClick={() => onView("account")} data-tip={`Risk guard: ${trade.status.riskLock.reason} New trades are refused until tomorrow; exits still work.`}>
            <i aria-hidden="true" />
            <span className="tm-x">Risk </span>locked
          </button>
        )}
        {trade && (
          <button type="button" className={`tm-pill tm-pill--btn ${trade.enabled ? "tm-pill--live" : "tm-pill--off"}`} onClick={() => onView("account")} data-tip={trade.enabled ? "Trading is ON: Buy, Sell, Exit and Cancel send real orders. Open Positions to turn it off." : "Trading is OFF: Buy and Sell are disabled. Open Positions to turn it on."}>
            <i aria-hidden="true" />
            <span className="tm-x">Trading </span>
            {trade.enabled ? "ON" : "OFF"}
          </button>
        )}
        {trade && pulse && (
          <button type="button" className={`tm-pill tm-pill--btn tm-pnl ${pulse.pnl > 0 ? "is-up" : pulse.pnl < 0 ? "is-down" : ""}`} onClick={() => onView("account")} data-tip={`Today’s P&L on all positions, open and closed (the day’s M2M, by Zerodha’s own formula)${pulse.live ? ", live: it moves with every streamed price" : ", as Zerodha last reported it"}.`}>
            <span className="tm-x">P&amp;L </span>
            <b>{`${pulse.pnl > 0 ? "+" : pulse.pnl < 0 ? "−" : ""}₹${num(Math.abs(pulse.pnl))}`}</b>
            <small className="tm-x">{pulse.open} open</small>
          </button>
        )}
        {trade && trade.goal && <GoalPill goal={trade.goal} onClick={() => onView("account")} />}
        {alerts && (
          <span className="tm-bell">
            <button type="button" className={`tm-icon ${alerts.waiting.length ? "has-some" : ""}`} data-alerts-toggle aria-expanded={alertsOpen} aria-label={`Price alerts: ${alerts.waiting.length} waiting`} onClick={() => onAlerts(!alertsOpen)} data-tip="Price alerts: be told when a stock reaches a level. Kept in the database, checked while this terminal is open.">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8" />
                <path d="M10 20a2 2 0 0 0 4 0" />
              </svg>
              {alerts.waiting.length > 0 && <b>{alerts.waiting.length}</b>}
            </button>
            {alertsOpen && <AlertsPanel symbol={symbol} onClose={() => onAlerts(false)} />}
          </span>
        )}
        <ResearchButton symbol={symbol} />
        <TempleButton />
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
