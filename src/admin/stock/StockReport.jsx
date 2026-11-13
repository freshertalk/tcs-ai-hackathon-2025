// The Stock Report as one trading terminal: a top bar with the state of everything, and
// one workspace at a time beneath it — the Desk (watchlist, chart, live call, order book,
// co-pilot, with your positions docked along the bottom), Positions & orders, Research,
// Screener, Debrief and Calendar. Keyboard: / search, B / S buy or sell the open stock,
// 1–7 workspaces, D dock, T theme, ? the list.
//
// Opens in its own tab from the dashboard; the session cookie is shared, so it is signed in.

import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import WorldClock from "./WorldClock";
import HolidayCalendar from "./HolidayCalendar";
import Analyzer from "./analyzer/Analyzer";
import Screener from "./analyzer/Screener";
import Debrief from "./analyzer/Debrief";
import ErrorBoundary from "./analyzer/ErrorBoundary";
import Account from "./trade/Account";
import Research from "./trade/Research";
import Journal from "./trade/Journal";
import { TradeProvider, useTrade } from "./trade/TradeContext";
import { useDeskTheme } from "./analyzer/theme";
import { useAuth } from "../auth";
import TopBar from "./terminal/TopBar";
import { keyAction, SHORTCUTS } from "./terminal/shortcuts";
import "./terminal/terminal.css";

const VIEWS = [
  { id: "analyzer", label: "Desk", tip: "Watchlist, chart, the live call, order book and co-pilot for one stock, with your positions docked below." },
  { id: "account", label: "Positions", superOnly: true, tip: "Positions, holdings, orders, funds, the trading switch and the AI coach." },
  { id: "journal", label: "Journal", superOnly: true, tip: "Every round trip you made: win rate, profit factor, expectancy, drawdown, P&L calendar, MAE/MFE, tags and an AI review." },
  { id: "research", label: "Research", tip: "Pre-market and post-market research for your watchlist." },
  { id: "screener", label: "Screener", tip: "Every NSE stock by RSI." },
  { id: "debrief", label: "Debrief", tip: "What the desk’s calls would have done today, replayed and scored." },
  { id: "calendar", label: "Calendar", tip: "World clock and upcoming exchange holidays." },
];
const DOCK_KEY = "vpt.terminal.dock";
const storedDock = () => {
  try {
    return window.localStorage.getItem(DOCK_KEY) !== "closed";
  } catch (_) {
    return true;
  }
};

function ShortcutsDialog({ onClose }) {
  return (
    <div className="tr-modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="tr-dialog tm-keys">
        <h3>Keyboard shortcuts</h3>
        <dl>
          {SHORTCUTS.map((s) => (
            <div key={s.action}>
              <dt>
                {s.keys.map((k) => (k === "…" ? <span key={k}>–</span> : <kbd key={k}>{k}</kbd>))}
              </dt>
              <dd>{s.text}</dd>
            </div>
          ))}
        </dl>
        <p className="vd-note">Shortcuts do nothing while you are typing in a field. Buy and Sell only open the order ticket — nothing is sent until you confirm, and only while the trading switch is on.</p>
        <footer className="tr-dialog__foot">
          <button type="button" className="adm-btn adm-btn--solid" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Positions along the bottom of the Desk: open for a glance, closed out of the way. */
function Dock({ open, onToggle }) {
  const trade = useTrade();
  if (!trade) return null;
  const p = trade.pulse;
  return (
    <section className={`tm-dock ${open ? "is-open" : ""}`} aria-label="Positions dock">
      <button type="button" className="tm-dock__bar" aria-expanded={open} onClick={onToggle} data-tip="Show or hide your positions, holdings and orders here on the Desk. Shortcut: D.">
        <span className="tm-dock__chev" aria-hidden="true">
          {open ? "▾" : "▴"}
        </span>
        <b>Positions &amp; orders</b>
        {p ? (
          <span className={p.pnl > 0 ? "is-up" : p.pnl < 0 ? "is-down" : ""}>
            P&amp;L {`${p.pnl > 0 ? "+" : p.pnl < 0 ? "−" : ""}₹${Math.abs(p.pnl).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`} · {p.open} open
          </span>
        ) : (
          <span>{trade.connected ? "reading…" : "Zerodha not connected"}</span>
        )}
        <span className={`tm-dock__sw ${trade.enabled ? "is-on" : ""}`}>Trading {trade.enabled ? "ON" : "OFF"}</span>
      </button>
      {open && (
        <div className="tm-dock__body">
          <Account compact />
        </div>
      )}
    </section>
  );
}

function Terminal() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const trade = useTrade();
  const isSuper = Boolean(user && user.role === "superadmin");
  const views = VIEWS.filter((v) => !v.superOnly || isSuper);
  const asked = params.get("view");
  const view = views.some((v) => v.id === asked) ? asked : "analyzer";
  const [theme, toggleTheme] = useDeskTheme();
  const [help, setHelp] = useState(false);
  const [dock, setDock] = useState(storedDock);
  const showDock = view === "analyzer" && Boolean(trade);

  const go = useCallback(
    (id) => {
      const next = new URLSearchParams(params);
      if (id === "analyzer") next.delete("view");
      else next.set("view", id);
      setParams(next, { replace: true });
      window.scrollTo(0, 0);
    },
    [params, setParams]
  );
  // a stock picked in the screener, research or debrief opens on the Desk
  const openStock = (symbol) => {
    const next = new URLSearchParams(params);
    next.delete("view");
    next.set("s", symbol);
    setParams(next);
  };
  const toggleDock = useCallback(() => {
    setDock((d) => {
      try {
        window.localStorage.setItem(DOCK_KEY, d ? "closed" : "open");
      } catch (_) {
        /* remembered for this visit only */
      }
      return !d;
    });
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      const a = keyAction(e);
      if (!a) return;
      if (a.action === "close") {
        setHelp(false);
        return;
      }
      e.preventDefault();
      if (a.action === "help") setHelp(true);
      else if (a.action === "theme") toggleTheme();
      else if (a.action === "dock") showDock && toggleDock();
      else if (a.action === "view") views[a.view - 1] && go(views[a.view - 1].id);
      else if (a.action === "search") {
        if (view !== "analyzer") go("analyzer");
        setTimeout(() => {
          const el = document.getElementById("desk-q");
          if (el) el.focus();
        }, 50);
      } else if (a.action === "buy" || a.action === "sell") {
        const s = params.get("s");
        if (!trade) return;
        if (!trade.enabled || !trade.connected) {
          trade.say(!trade.connected ? "Zerodha is not connected." : "Trading is OFF. Turn it on in Positions to use B and S.", "info");
          return;
        }
        if (view === "analyzer" && s) trade.openTicket({ symbol: s, exchange: "NSE", side: a.action === "buy" ? "BUY" : "SELL" });
        else trade.openTicket({ symbol: "", exchange: "NSE", side: a.action === "buy" ? "BUY" : "SELL" });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [views, view, go, params, trade, toggleTheme, toggleDock, showDock]);

  return (
    <div className={`tm tm--${view} ${showDock ? `has-dock ${dock ? "dock-open" : ""}` : ""}`}>
      <TopBar views={views} view={view} onView={go} theme={theme} onTheme={toggleTheme} onHelp={() => setHelp(true)} />
      <main className="tm-work" id="tm-main">
        {/* one failing workspace never blanks the terminal: the top bar and the others stay usable */}
        <ErrorBoundary key={view} title={(views.find((v) => v.id === view) || {}).label}>
        {view === "analyzer" ? (
          <Analyzer />
        ) : (
          <div className="tm-page">
            {view === "account" ? (
              <Account />
            ) : view === "journal" ? (
              <Journal />
            ) : view === "research" ? (
              <Research onOpen={openStock} />
            ) : view === "screener" ? (
              <Screener onOpen={openStock} />
            ) : view === "debrief" ? (
              <Debrief onOpen={openStock} />
            ) : (
              <>
                <WorldClock />
                <div className="sr-two">
                  <HolidayCalendar market="india" />
                  <HolidayCalendar market="nasdaq" />
                </div>
              </>
            )}
          </div>
        )}
        </ErrorBoundary>
      </main>
      {showDock && <Dock open={dock} onToggle={toggleDock} />}
      {help && <ShortcutsDialog onClose={() => setHelp(false)} />}
    </div>
  );
}

export default function StockReport() {
  return (
    <TradeProvider>
      <Terminal />
    </TradeProvider>
  );
}
