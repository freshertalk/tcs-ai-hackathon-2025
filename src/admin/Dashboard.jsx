// The home of the private area: one glance at the market and the account, one large way into
// the trading terminal (and straight into any of its workspaces), and the site's settings
// in a compact grid below. Every link into the terminal opens it in its own tab.

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "./api";
import { useAuth } from "./auth";
import { adminPath } from "./paths";
import Shell from "./Shell";
import { IconArrow, IconChart, IconGlobe, IconKey, IconUsers } from "./icons";

const WORKSPACES = [
  { view: "", label: "Desk", text: "Chart, live call, order book" },
  { view: "advisor", label: "Advisor", text: "Measured odds for the watchlist" },
  { view: "account", label: "Positions", text: "Positions, orders, funds", superOnly: true },
  { view: "journal", label: "Journal", text: "Every trade, scored", superOnly: true },
  { view: "research", label: "Research", text: "Pre- and post-market" },
  { view: "screener", label: "Screener", text: "NSE top 100 by RSI" },
  { view: "debrief", label: "Debrief", text: "Today’s calls, replayed" },
  { view: "calendar", label: "Calendar", text: "Holidays and time zones" },
];
const terminal = (view) => `${adminPath("/stock-report")}${view ? `?view=${view}` : ""}`;

function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Good night";
}
function firstName(user) {
  const raw = (user.name || "").trim().split(/\s+/)[0] || "there";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** NSE's session by the clock (holidays are on the Calendar). */
function nseState(now = new Date()) {
  const d = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 5.5 * 3600000);
  const m = d.getHours() * 60 + d.getMinutes();
  const wk = d.getDay() >= 1 && d.getDay() <= 5;
  if (wk && m >= 555 && m < 930) return { id: "open", label: "NSE open" };
  if (wk && m >= 540 && m < 555) return { id: "pre", label: "NSE pre-open" };
  return { id: "closed", label: "NSE closed" };
}

const money = (x) => `${x > 0 ? "+" : x < 0 ? "−" : ""}₹${Math.abs(x).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

function Pulse({ isSuper }) {
  const [market, setMarket] = useState(null);
  const [trade, setTrade] = useState(null);
  const [pnl, setPnl] = useState(null);
  const [board, setBoard] = useState(null);
  useEffect(() => {
    let alive = true;
    api("/api/admin/market/status").then((d) => alive && setMarket(d)).catch(() => {});
    api("/api/admin/market/edge").then((d) => alive && setBoard(d)).catch(() => {});
    if (isSuper) {
      api("/api/admin/trading/status")
        .then((d) => {
          if (!alive) return;
          setTrade(d);
          if (d && d.connected)
            api("/api/admin/trading/positions")
              .then((p) => alive && setPnl((p.net || []).reduce((a, x) => a + (Number(x.pnl) || 0), 0)))
              .catch(() => {});
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [isSuper]);
  const nse = nseState();
  const kite = market && market.mode === "kite";
  const counts = { A: 0, B: 0 };
  if (board) for (const r of board.rows || []) if (r.available && r.best && counts[r.best.grade] !== undefined) counts[r.best.grade] += 1;
  return (
    <ul className="hub-pulse" aria-label="Status">
      <li className={`is-${nse.id === "open" ? "ok" : nse.id === "pre" ? "warn" : "off"}`}>
        <i aria-hidden="true" />
        {nse.label}
      </li>
      <li className={kite ? "is-ok" : market && market.mode === "demo" ? "is-warn" : "is-off"} data-tip="Whether Zerodha is connected for live prices. The session ends at 6 AM each day.">
        <i aria-hidden="true" />
        {market ? (kite ? "Zerodha connected" : market.mode === "demo" ? "Demo data" : "Zerodha not connected") : "Zerodha …"}
      </li>
      {isSuper && (
        <li className={trade && trade.enabled ? "is-live" : "is-off"} data-tip="The master switch for orders from this site. It is changed on the Positions page.">
          <i aria-hidden="true" />
          Trading {trade ? (trade.enabled ? "ON" : "OFF") : "…"}
        </li>
      )}
      {isSuper && pnl !== null && (
        <li className={pnl > 0 ? "is-up" : pnl < 0 ? "is-down" : ""} data-tip="Today’s P&L on all positions, as Zerodha reports it.">
          P&amp;L <b>{money(pnl)}</b>
        </li>
      )}
      {board && (
        <li data-tip="Watchlist stocks whose measured odds are favourable today and backed by the forward test (grade A or B).">
          Advisor <b>{counts.A}</b> A · <b>{counts.B}</b> B
        </li>
      )}
    </ul>
  );
}

function Setting({ to, href, external, icon, title, text, status, tip }) {
  const body = (
    <>
      <span className="hub-set__ico">{icon}</span>
      <span className="hub-set__body">
        <b>{title}</b>
        <small>{text}</small>
      </span>
      {status && <span className={`hub-set__s ${status.on ? "is-on" : ""}`}>{status.label}</span>}
    </>
  );
  return external ? (
    <a className="hub-set" href={href} target="_blank" rel="noopener noreferrer" data-tip={tip}>
      {body}
    </a>
  ) : (
    <Link className="hub-set" to={to} data-tip={tip}>
      {body}
    </Link>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [s, setS] = useState(null);
  const [ai, setAi] = useState(null);
  useEffect(() => {
    api("/api/admin/settings").then(setS).catch(() => {});
    api("/api/admin/ai/status").then(setAi).catch(() => {});
  }, []);
  const isSuper = user.role === "superadmin";
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <Shell wide>
      <div className="hub">
        <header className="hub-head">
          <div>
            <p className="hub-head__k">
              {greeting()} · {today}
            </p>
            <h1>Namaste, {firstName(user)}</h1>
          </div>
          <Pulse isSuper={isSuper} />
        </header>

        <section className="hub-hero" aria-labelledby="hub-sr">
          <a className="hub-hero__main" href={terminal("")} target="_blank" rel="noopener noreferrer" data-tip="Open the trading terminal in a new tab.">
            <span className="hub-hero__k">Markets · trading terminal</span>
            <span className="hub-hero__t" id="hub-sr">
              Stock Report
            </span>
            <span className="hub-hero__d">Live desk, measured odds, positions and orders, research, screener, debrief and the market calendar — in one terminal.</span>
            <span className="hub-hero__go">
              Open the terminal <IconArrow />
            </span>
          </a>
          <nav className="hub-ws" aria-label="Open a workspace">
            {WORKSPACES.filter((w) => !w.superOnly || isSuper).map((w) => (
              <a key={w.label} href={terminal(w.view)} target="_blank" rel="noopener noreferrer">
                <b>{w.label}</b>
                <small>{w.text}</small>
              </a>
            ))}
          </nav>
        </section>

        <section className="hub-sets" aria-labelledby="hub-sets-h">
          <h2 id="hub-sets-h">Settings</h2>
          <div className="hub-sets__grid">
            <Setting
              to={adminPath("/google")}
              icon={<IconKey />}
              title="Google sign-in"
              text="The credentials behind the sign-in button."
              tip="Enter or replace the Google credentials that the sign-in button uses."
              status={s && { on: s.googleSecretSet, label: s.googleSecretSet ? "Connected" : "Not set up" }}
            />
            {isSuper && <Setting to={adminPath("/admins")} icon={<IconUsers />} title="Admin users" text="Who may sign in here." tip="Choose which Google accounts may sign in here. Superadmin only." />}
            <Setting
              to={adminPath("/ai")}
              icon={<IconChart />}
              title="AI strategist"
              text="Anthropic key and model; advice only."
              tip="Set the Anthropic API key, choose the model, and set the live co-pilot’s limits."
              status={ai && { on: ai.configured, label: ai.configured ? "On" : "Off" }}
            />
            <Setting
              to={adminPath("/analytics")}
              icon={<IconChart />}
              title="Google Analytics"
              text="Visit counting on the public site."
              tip="Turn visit counting on or off for the public website."
              status={s && { on: Boolean(s.gaMeasurementId), label: s.gaMeasurementId ? "On" : "Off" }}
            />
            <Setting external href="/" icon={<IconGlobe />} title="Public website" text="vinaytiwari.org, as visitors see it." tip="See the public website as a visitor does." />
          </div>
        </section>
      </div>
    </Shell>
  );
}
