// The home of the private area, laid out as Zerodha Kite lays out its dashboard (fourth design, 27 Nov 2026, the owner: "more
// elegant, more breathing space, enterprise grade as per Zerodha Kite"; look in home-kite.css):
//   AT THE TOP   an open header — who you are and the date, the hide-amounts switch, and the three ways in (the trading terminal,
//                on the workspace you chose, first) — then the page's sections as a row of underline tabs that stays on screen
//   THE PAGE     one wide column of open sections divided by hairlines: the next trading day, the live status row, today at a
//                glance, the workspaces, the tools, learning, Zerodha accounts, Customize, Settings & system, and the owner's
//                Personal things last
// What you hid under Customize is not drawn; a workspace you may not open never is. Every link into the terminal opens it in its
// own tab.

import "./home.css";
import "./home-kite.css";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "./api";
import { useAuth } from "./auth";
import { adminPath } from "./paths";
import Shell from "./Shell";
import { useAiStatus } from "./aiStatus";
import SystemRow from "./SystemRow";
import { IconArrow, IconChart, IconKey, IconMail, IconShield, IconUsers } from "./icons";
import { everyVisible } from "./visible";
import { usePrefs } from "./prefs";
import { mayOpen } from "./workspaces";
import PageJumps from "./stock/terminal/PageJumps";
import CustomizeCard from "./CustomizeCard";
import LearningCard from "./LearningCard";
import { PrivacyToggle } from "./privacy";
import LoginIconTile from "./LoginIconTile";
import ZerodhaAccounts from "./ZerodhaAccounts";
import DrishtiLogo from "./DrishtiLogo";
import NextSession, { sessionCard, useNextSession } from "./NextSession";
import { exchangeNow, useExchangeNow } from "./clock/exchangeClock";

const WORKSPACES = [
  { view: "", label: "Desk", text: "Chart, live call, order book, 5- and 15-minute forecast" },
  { view: "now", label: "Now", text: "Every followed stock, your positions, the market and the systems, live" },
  { view: "research", label: "Research", text: "Pre- and post-market, autopilot" },
  { view: "advisor", label: "Advisor", text: "Measured odds for the watchlist" },
  { view: "screener", label: "Screener", text: "Top gainers, losers, RSI" },
  { view: "account", label: "Positions", text: "Positions, orders, funds", superOnly: true, traderOk: true },
  { view: "indices", label: "Indices", text: "NIFTY & SENSEX by month and year, projected" },
  { view: "analysis", label: "Trade Analysis", text: "Every day: profit, loss, taxes", superOnly: true },
  { view: "calendar", label: "Calendar", text: "Expiries, holidays and time zones" },
  { view: "journal", label: "Journal", text: "Every trade, scored", superOnly: true },
  { view: "paper", label: "Paper trading", text: "Play money, live and history" },
  { view: "debrief", label: "Debrief", text: "Today’s calls, replayed" },
  { view: "engine", label: "AI Engine", text: "Every AI rule, and the AI brains" },
  { view: "document", label: "Document", text: "The complete guide, in plain English" },
];
/* a small line icon for each workspace (24×24, drawn with the current text colour) */
const ICONS = {
  Desk: "M3 5h18v11H3zM8 20h8M12 16v4",
  Advisor: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12.5l2.7 2.7L16 9.5",
  Positions: "M3 8h18v11H3zM9 8V5h6v3M3 13h18",
  Journal: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11",
  "Paper trading": "M7 3h8l4 4v14H7zM15 3v4h4M10 13h6M10 17h6",
  Research: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
  Screener: "M4 5h16l-6 7v6l-4 2v-8z",
  Debrief: "M4 12a8 8 0 1 0 3-6.2M4 4v4h4M12 8v4l3 2",
  Calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  "Trade Analysis": "M4 20V10M10 20V4M16 20v-7M22 20H2",
  Indices: "M3 17l5-6 4 3 8-9M15 5h5v5",
  "AI Engine": "M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4",
  Document: "M6 3h9l4 4v14H6zM9 12h7M9 16h7M9 8h3",
  TradeAI: "M4 5h16v11H9l-5 4zM8 9h8M8 12h5",
  Social: "M4 11a8 8 0 0 1 16 0M4 11v6M20 11v6M8 21h8M12 3v2",
};
const GROUPS = [
  { id: "trade", name: "Trade", note: "while the market is open", labels: ["Desk", "Research", "Advisor", "Screener", "Positions", "Paper trading"] },
  { id: "analyse", name: "Analyse", note: "before and after", labels: ["Indices", "Trade Analysis", "Calendar", "Journal", "Debrief"] },
  { id: "learn", name: "Learn", note: "how it thinks", labels: ["AI Engine", "Document"] },
];
const WsIcon = ({ label }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={ICONS[label] || ICONS.Desk} />
  </svg>
);
const terminal = (view) => `${adminPath("/stock-report")}${view ? `?view=${view}` : ""}`;

function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Good night";
}
/** The greeting by the hour in India (NSE's clock), wherever this computer is. */
function greetingIst(ms = exchangeNow()) {
  const h = new Date(ms + 5.5 * 3600000).getUTCHours();
  return greeting({ getHours: () => h });
}
function firstName(user) {
  const raw = (user.name || "").trim().split(/\s+/)[0] || "there";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const span = (min) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60 ? `${min % 60} min` : ""}`.trim() : `${min} min`);

/** NSE's session by the clock, and what comes next (holidays are on the Calendar). */
function nseState(now = new Date()) {
  const d = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 5.5 * 3600000);
  const m = d.getHours() * 60 + d.getMinutes();
  const day = d.getDay();
  const wk = day >= 1 && day <= 5;
  if (wk && m >= 555 && m < 930) return { id: "open", label: "Open", sub: `closes in ${span(930 - m)} · 3:30 PM IST` };
  if (wk && m >= 540 && m < 555) return { id: "pre", label: "Pre-open", sub: `opens in ${span(555 - m)} · 9:15 AM IST` };
  if (wk && m < 540) return { id: "closed", label: "Closed", sub: "opens today at 9:15 AM IST" };
  const next = day === 5 || day === 6 || day === 0 ? "Monday" : "tomorrow";
  return { id: "closed", label: "Closed", sub: wk ? `opens ${next} at 9:15 AM IST` : `opens ${DAYS[1]} at 9:15 AM IST` };
}

const money = (x) => `${x > 0 ? "+" : x < 0 ? "−" : ""}₹${Math.abs(x).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

/** One status card. `to` makes it a link (in-app), `href` opens the terminal in a new tab. */
function Pc({ tone = "off", k, v, sub, tip, to, href, valueTone }) {
  const body = (
    <>
      <span className="hm-pc__k">
        <i aria-hidden="true" />
        {k}
      </span>
      <b className={`hm-pc__v ${valueTone || ""}`}>{v}</b>
      {sub && <small>{sub}</small>}
    </>
  );
  return (
    <li className={`hm-pc is-${tone}`} data-tip={tip}>
      {to ? (
        <Link to={to}>{body}</Link>
      ) : href ? (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {body}
        </a>
      ) : (
        <div>{body}</div>
      )}
    </li>
  );
}

/** The live status row. Re-read every 30 seconds while the tab is in front, and at once when you return to it. */
function Pulse({ isSuper, ns }) {
  const [d, setD] = useState({});
  const [, tick] = useState(0);
  useEffect(() => {
    let alive = true;
    const put = (k) => (v) => alive && setD((x) => ({ ...x, [k]: v }));
    const load = () => {
      tick((n) => n + 1); // the session line moves with the clock
      api("/api/admin/market/status").then(put("market")).catch(() => {});
      api("/api/admin/market/edge").then(put("board")).catch(() => {});
      api("/api/admin/market/horizon").then(put("horizon")).catch(() => {});
      api("/api/admin/ai/spend").then(put("spend")).catch(() => {});
      if (isSuper) {
        api("/api/admin/trading/status")
          .then((t) => {
            if (!alive) return;
            setD((x) => ({ ...x, trade: t }));
            if (t && t.connected)
              api("/api/admin/trading/positions")
                .then((p) => alive && setD((x) => ({ ...x, pnl: (p.net || []).reduce((a, r) => a + (Number(r.pnl) || 0), 0) })))
                .catch(() => {});
          })
          .catch(() => {});
      }
    };
    load();
    const stop = everyVisible(load, 30000, { topics: ["market", "trading", "horizon", "ai", "health", "open"] });
    return () => {
      alive = false;
      stop();
    };
  }, [isSuper]);
  const { market, board, horizon, spend, trade, pnl } = d;
  // by NSE's calendar (holidays included) when the server has answered; by the clock alone until then — NSE's clock
  // either way (clock/exchangeClock.js), turning over on the exchange's minute
  const nowMs = useExchangeNow(60000);
  const nse = sessionCard(ns, nowMs) || nseState(new Date(nowMs));
  const kite = market && market.mode === "kite";
  const counts = { A: 0, B: 0 };
  if (board) for (const r of board.rows || []) if (r.available && r.best && counts[r.best.grade] !== undefined) counts[r.best.grade] += 1;
  const h15 = horizon && horizon.validation ? (horizon.validation.horizons || []).find((x) => x.h === 3) : null;
  return (
    <ul className="hm-pulse" aria-label="Status">
      <Pc tone={nse.id === "open" ? "ok" : nse.id === "pre" ? "warn" : "off"} k="NSE session" v={nse.label} sub={nse.sub} tip="The exchange's session (9:15 AM – 3:30 PM IST) by NSE's trading calendar: weekends and NSE's own holiday list are counted, so after a close before a holiday it names the day after. The full list is on the Calendar." />
      <Pc
        tone={kite ? "ok" : market && market.mode === "demo" ? "warn" : "off"}
        k="Zerodha"
        v={market ? (kite ? "Connected" : market.mode === "demo" ? "Demo data" : "Not connected") : "…"}
        sub={kite ? "live prices and account" : "log in once each trading morning"}
        href={terminal("")}
        tip="Whether Zerodha is connected for live prices. The session ends at 6 AM each day. Opens the Desk, where you log in."
      />
      {isSuper && (
        <Pc tone={trade && trade.enabled ? "live" : "off"} k="Trading switch" v={trade ? (trade.enabled ? "ON" : "OFF") : "…"} sub={trade && trade.enabled ? "orders can be sent" : "no orders can be sent"} href={terminal("account")} tip="The master switch for orders from this site. It is changed on the Positions page." />
      )}
      {isSuper && pnl !== undefined && <Pc tone="off" k="Positions · Total P&L" v={money(pnl)} valueTone={pnl > 0 ? "is-up" : pnl < 0 ? "is-down" : ""} sub="all positions, open and closed" href={terminal("account")} tip="Today’s P&L on all positions, as Zerodha reports it." />}
      {board && <Pc tone="off" k="Advisor odds" v={`A ${counts.A} · B ${counts.B}`} sub="favourable today, forward-tested" href={terminal("advisor")} tip="Watchlist stocks whose measured odds are favourable today and backed by the forward test (grade A or B)." />}
      {horizon && (
        <Pc
          tone={horizon.trained ? "ok" : "warn"}
          k="15-min forecast"
          v={horizon.trained ? (h15 && h15.dirAcc != null ? `${(h15.dirAcc * 100).toFixed(1)}%` : "Learned") : horizon.job && !horizon.job.finishedAt ? "Learning…" : "Not trained"}
          sub={horizon.trained ? `direction right, tested · learned to ${horizon.learning.lastDate}` : "learns from the stored NIFTY 100 history"}
          href={terminal("research")}
          tip="The 15-minute price forecast on the Desk: how often its direction was right on sessions it had not seen. It keeps learning each evening."
        />
      )}
      {spend && (
        <Pc
          tone={spend.auto ? "warn" : "ok"}
          k="AI credit"
          v={spend.auto ? "Runs by itself" : "Click only"}
          sub={spend.auto ? "the AI may spend without a click" : `protected${spend.blockedToday ? ` · ${spend.blockedToday} held back today` : ""}`}
          to={adminPath("/ai")}
          tip="AI credit is spent only when you press an AI button, unless you lift that on the AI page."
        />
      )}
    </ul>
  );
}

/** The day at a glance for the owner: the paper robot, the month's return, the autopilot, tomorrow's likely trenders. */
function TodayCard({ isSuper }) {
  const [d, setD] = useState({});
  useEffect(() => {
    if (!isSuper) return undefined;
    let alive = true;
    const put = (k) => (v) => alive && setD((x) => ({ ...x, [k]: v }));
    const load = () => {
      api("/api/admin/robot").then(put("robot")).catch(() => {});
      api("/api/admin/trading/journal/periods").then(put("periods")).catch(() => {});
      api("/api/admin/robot/predictor").then(put("pred")).catch(() => {});
      api("/api/admin/autopilot").then(put("auto")).catch(() => {});
    };
    load();
    const stop = everyVisible(load, 60000, { topics: ["robot", "paper", "trading", "autopilot", "analysis"] });
    return () => {
      alive = false;
      stop();
    };
  }, [isSuper]);
  if (!isSuper) return null;
  const robot = d.robot && d.robot.day ? d.robot : null;
  const month = d.periods && Array.isArray(d.periods.rows) ? d.periods.rows.find((r) => r.id === "month") : null;
  const pred = d.pred && d.pred.available ? d.pred : null;
  const waiting = d.auto && Array.isArray(d.auto.proposals) ? d.auto.proposals.filter((p) => p.status === "new").length : null;
  const pct = (x) => (typeof x === "number" ? `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(2)}%` : null);
  const tone = (x) => (typeof x === "number" ? (x > 0 ? "is-up" : x < 0 ? "is-down" : "") : "");
  return (
    <section className="hm-card hm-today" aria-labelledby="hm-today-h" data-jump="Today">
      <h2 id="hm-today-h" className="hm-h">
        Today at a glance
      </h2>
      <ul>
        <li>
          <a href={terminal("analysis")} target="_blank" rel="noopener noreferrer" data-tip="The AI paper trader: today's play-money result. Open Trade Analysis → Robot.">
            <span className="hm-row__k">Paper robot</span>
            <b className={tone(robot && robot.day.net)}>{robot ? money(robot.day.net) : "—"}</b>
            <small>{robot ? `${robot.open.length} open · ${robot.day.trades} trade${robot.day.trades === 1 ? "" : "s"} today · ${robot.settings.on ? "on" : "off"}` : "play money, runs by itself"}</small>
          </a>
        </li>
        <li>
          <a href={terminal("journal")} target="_blank" rel="noopener noreferrer" data-tip="This month's result in the Journal, with the return on your principal when your capital is recorded.">
            <span className="hm-row__k">This month</span>
            <b className={tone(month && month.net)}>{month && month.trades ? money(month.net) : "—"}</b>
            <small>{month && month.trades ? `${pct(month.pct) ? `${pct(month.pct)} on your principal · ` : ""}${month.trades} trades, ${Math.round(month.winRate)}% won` : "your real trades, from Zerodha"}</small>
          </a>
        </li>
        <li>
          <a href={terminal("research")} target="_blank" rel="noopener noreferrer" data-tip="Order proposals the autopilot has prepared and checked against your limits. It never sends an order: you press Review.">
            <span className="hm-row__k">Autopilot</span>
            <b>{waiting === null ? "—" : waiting === 0 ? "No proposals waiting" : `${waiting} proposal${waiting === 1 ? "" : "s"} waiting`}</b>
            <small>prepared and risk-checked; you decide</small>
          </a>
        </li>
        <li>
          <a href={terminal("analysis")} target="_blank" rel="noopener noreferrer" data-tip="The stocks the day-trading predictor ranks highest for the next session (a measured frequency from a year of sessions, not advice).">
            <span className="hm-row__k">Next session’s likely trenders</span>
            {pred ? (
              <span className="hm-chips">
                {pred.picks.slice(0, 4).map((p) => (
                  <span key={p.symbol} className={`hm-chip ${p.side === "long" ? "is-up" : p.side === "short" ? "is-down" : ""}`}>
                    {p.symbol} <small>{Math.round(p.p * 100)}%</small>
                  </span>
                ))}
              </span>
            ) : (
              <b>—</b>
            )}
            <small>{pred ? `${pred.summary.state === "graduated" ? "ranking with evidence" : "still learning"} · learned from ${pred.history && pred.history.sessions ? pred.history.sessions : "a year of"} sessions` : "learned by itself from a year of the NIFTY 100"}</small>
          </a>
        </li>
      </ul>
    </section>
  );
}

function Setting({ to, href, external, icon, title, text, status, tip }) {
  const body = (
    <>
      <span className="hm-set__ico">{icon}</span>
      <span className="hm-set__body">
        <b>{title}</b>
        <small>{text}</small>
      </span>
      {status && <span className={`hm-set__s ${status.on ? "is-on" : ""}`}>{status.label}</span>}
    </>
  );
  return external ? (
    <a className="hm-set" href={href} target="_blank" rel="noopener noreferrer" data-tip={tip}>
      {body}
    </a>
  ) : (
    <Link className="hm-set" to={to} data-tip={tip}>
      {body}
    </Link>
  );
}

/** A feature tile in the rail: an icon, what it is, one live line, and the way in. */
function Feat({ tone, icon, kicker, title, text, live, go, href, tip }) {
  return (
    <section className={`hm-feat hm-feat--${tone}`} aria-label={title}>
      <a href={href} target="_blank" rel="noopener noreferrer" data-tip={tip}>
        <span className="hm-feat__ico">
          <WsIcon label={icon} />
        </span>
        <span className="hm-feat__body">
          <span className="hm-feat__k">{kicker}</span>
          <span className="hm-feat__t">{title}</span>
          <span className="hm-feat__d">{text}</span>
          {live}
        </span>
        <span className="hm-feat__go">
          {go} <IconArrow />
        </span>
      </a>
    </section>
  );
}

/** Paper trading at a glance: the auto switch's state and how the current setup has done on paper. */
function PaperFeat() {
  const [p, setP] = useState(null);
  useEffect(() => {
    api("/api/admin/paper")
      .then((d) => setP(d && d.tested ? d : null))
      .catch(() => {});
  }, []);
  const t = p && p.tested;
  const rupees = (x) => (typeof x === "number" ? `${x < 0 ? "−" : x > 0 ? "+" : ""}₹${Math.abs(Math.round(x)).toLocaleString("en-IN")}` : "—");
  return (
    <Feat
      tone="paper"
      icon="Paper trading"
      kicker="Play money only"
      title="Paper Trading Testing"
      text="The desk’s own live call followed with paper money — today, on past sessions, and in an auto mode. Never a real order."
      live={
        <span className="hm-live">
          <span className={`hm-live__pill ${p && p.auto ? "is-on" : ""}`}>Auto {p ? (p.auto ? "ON" : "OFF") : "…"}</span>
          <span>
            <b>{t ? t.total.toLocaleString("en-IN") : "—"}</b> paper trades
          </span>
          <span>
            Net <b>{t ? rupees(t.live.pnl) : "—"}</b>
          </span>
          <span>
            History <b>{t && t.history.finished ? `${t.history.winPct}% won` : "—"}</b>
          </span>
        </span>
      }
      go="Open paper trading"
      href={terminal("paper")}
      tip="Open paper trading in a new tab."
    />
  );
}

function TradeAiFeat() {
  return (
    <Feat
      tone="ai"
      icon="TradeAI"
      kicker="AI · your trading analyst"
      title="TradeAI"
      text="Ask about the market, a stock, your positions or your results. It reads the desk’s live calls, levels, habits and your history, and answers in plain English — only when you press send."
      live={
        <span className="hm-live" aria-hidden="true">
          <span>Your positions</span>
          <span>Live calls</span>
          <span>Forecasts</span>
          <span>Chats saved</span>
        </span>
      }
      go="Open TradeAI"
      href={adminPath("/tradeai")}
      tip="Open TradeAI in a new tab."
    />
  );
}

/** The Social Media tile: the news mood and the stocks being talked about, opening the page in a new tab. */
function SocialFeat() {
  const [d, setD] = useState(null);
  useEffect(() => {
    let on = true;
    const load = () =>
      api("/api/admin/social/digest?hours=24")
        .then((x) => on && setD(x))
        .catch(() => {});
    load();
    const id = everyVisible(load, 60000, { topics: ["social"] });
    return () => {
      on = false;
      id();
    };
  }, []);
  const t = d && d.mood ? (d.mood.score >= 20 ? "up" : d.mood.score <= -20 ? "down" : "flat") : "flat";
  return (
    <Feat
      tone="social"
      icon="Social"
      kicker="Live · news & social"
      title="Social Media"
      text="News sites, Google News, X, Reddit, YouTube and NSE announcements in one live feed, organised for trading and fed to the forecasts."
      live={
        d && d.items > 0 ? (
          <span className="hm-live">
            <span className={`hm-live__mood is-${t}`}>
              {t === "up" ? "▲" : t === "down" ? "▼" : "●"} {d.mood.label} mood
            </span>
            <span>{d.items} items · 24 h</span>
            {d.radar.slice(0, 4).map((r) => (
              <span key={r.symbol} className="hm-live__sym">
                {r.symbol}
              </span>
            ))}
          </span>
        ) : (
          <span className="hm-live" aria-hidden="true">
            <span>Live feed</span>
            <span>AI brief</span>
            <span>Stock radar</span>
            <span>Your sources</span>
          </span>
        )
      }
      go="Open Social Media"
      href={adminPath("/social")}
      tip="Open Social Media in a new tab."
    />
  );
}

/** The workspaces, in three groups, with a finder (press / to jump to it). */
function Workspaces({ user, hidden = [] }) {
  const [q, setQ] = useState("");
  const box = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      e.preventDefault();
      if (box.current) box.current.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // what you may open (your role; your own Zerodha account opens Positions), less what you hid under Customize
  const hide = hidden.join(",");
  const visible = useMemo(() => WORKSPACES.filter((w) => mayOpen(w, user) && !hide.split(",").includes(w.view || "analyzer")), [user, hide]);
  const needle = q.trim().toLowerCase();
  const hit = (w) => !needle || `${w.label} ${w.text}`.toLowerCase().includes(needle);
  const groups = GROUPS.map((g) => ({ ...g, items: g.labels.map((l) => visible.find((w) => w.label === l)).filter((w) => w && hit(w)) })).filter((g) => g.items.length);
  const known = new Set(GROUPS.flatMap((g) => g.labels));
  const rest = visible.filter((w) => !known.has(w.label) && hit(w));
  if (rest.length) groups.push({ id: "more", name: "More", note: "", items: rest });
  return (
    <nav className="hm-card hm-ws" aria-label="Open a workspace" data-jump="Workspaces">
      <div className="hm-ws__head">
        <h2 className="hm-h">Workspaces</h2>
        <label className="hm-find">
          <span className="adm-sr">Find a workspace</span>
          <input ref={box} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a workspace…" aria-label="Find a workspace" />
          <kbd aria-hidden="true">/</kbd>
        </label>
      </div>
      {groups.map((g) => (
        <div key={g.id || g.name} className="hm-grp" data-g={g.id}>
          <h3>
            <i aria-hidden="true" />
            {g.name}
            {g.note ? <small> · {g.note}</small> : null}
          </h3>
          <div className="hm-grp__tiles">
            {g.items.map((w) => (
              <a key={w.label} className="hm-tile" href={terminal(w.view)} target="_blank" rel="noopener noreferrer" title={w.text}>
                <span className="hm-tile__ico">
                  <WsIcon label={w.label} />
                </span>
                <span className="hm-tile__txt">
                  <b>{w.label}</b>
                  <small>{w.text}</small>
                </span>
              </a>
            ))}
          </div>
        </div>
      ))}
      {!groups.length && <p className="hm-find__none">No workspace matches “{q}”.</p>}
    </nav>
  );
}

export default function Dashboard() {
  const { user, emailReady } = useAuth();
  const [s, setS] = useState(null);
  const ai = useAiStatus();
  useEffect(() => {
    api("/api/admin/settings").then(setS).catch(() => {});
  }, []);
  const isSuper = user.role === "superadmin";
  const { prefs } = usePrefs();
  // the date and greeting by NSE's clock (IST), not this computer's
  const dayNow = new Date(useExchangeNow(60000));
  const today = dayNow.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  // "Open the terminal" goes to the workspace you chose under Customize (the Desk unless you chose another)
  const start = WORKSPACES.find((w) => (w.view || "analyzer") === prefs.start && mayOpen(w, user) && !prefs.nav.hidden.includes(prefs.start));
  const startView = start ? start.view : "";
  // the next trading day by NSE's calendar: one answer for the strip (drawn at the top for every screen) and the status row
  const ns = useNextSession();

  return (
    <Shell wide>
      <div className="hm hm--kite">
        <header className="hm-me hm-top" aria-labelledby="hm-hero-h">
          <DrishtiLogo className="hm-me__art" size={56} />
          <div className="hm-top__who">
            <p className="hm-hero__k">
              {greetingIst(dayNow.getTime())} · {today}
            </p>
            <h1 id="hm-hero-h">Namaste, {firstName(user)}</h1>
            <p className="hm-me__role">
              {isSuper ? (user.owner === false ? "Superadmin" : "Owner") : user.trader ? "Member · own Zerodha account" : "Member"}
            </p>
          </div>
          {/* hide every amount with ***** on every page (privacy.jsx) — also in the account menu */}
          <PrivacyToggle />
          {/* the three ways in (24 Nov 2026): one framed action each — its icon in a soft disc, its name, a line on what is
              there, and the arrow that says it opens in a new tab. The terminal is the filled one. */}
          <div className="hm-me__cta">
            <a className="hm-btn hm-btn--go hm-cta" href={terminal(startView)} target="_blank" rel="noopener noreferrer" data-tip={`Open the trading terminal in a new tab${start && startView ? `, on ${start.label}` : ""}. Choose where it opens under Customize.`}>
              <span className="hm-cta__ico" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <rect x="3" y="4" width="18" height="13" rx="2" />
                  <path d="M7 13l3-3 2.5 2L17 8M8 21h8M12 17v4" />
                </svg>
              </span>
              <span className="hm-cta__txt">
                <b>Open the terminal</b>
                <small>Desk, live calls, positions</small>
              </span>
              <IconArrow />
            </a>
            <a className="hm-btn hm-cta" href={terminal("research")} target="_blank" rel="noopener noreferrer" data-tip="Research, the autopilot and the 15-minute forecaster.">
              <span className="hm-cta__ico" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <circle cx="10.5" cy="10.5" r="6.5" />
                  <path d="M20 20l-4.6-4.6M7.5 12l2-2 1.6 1.4L13.5 9" />
                </svg>
              </span>
              <span className="hm-cta__txt">
                <b>Research &amp; forecasts</b>
                <small>Top 10, autopilot, 15-min forecast</small>
              </span>
              <IconArrow />
            </a>
            <a className="hm-btn hm-cta" href={adminPath("/tradeai")} target="_blank" rel="noopener noreferrer" data-tip="Ask TradeAI about the market, a stock or your positions.">
              <span className="hm-cta__ico" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M4 5h16v11H9l-5 4z" />
                  <path d="M12 8.2l.8 1.8 1.8.8-1.8.8-.8 1.8-.8-1.8-1.8-.8 1.8-.8z" />
                </svg>
              </span>
              <span className="hm-cta__txt">
                <b>Ask TradeAI</b>
                <small>Your AI market assistant</small>
              </span>
              <IconArrow />
            </a>
          </div>
        </header>
        {/* the sections as Kite's underline tabs, staying on screen as the page scrolls */}
        <PageJumps stuck within=".hm" select="[data-jump]" min={2} label="The sections of this page" />

        <div className="hm-main">
        {/* the next trading day by NSE's calendar, at the top of the page on wide screens */}
        <NextSession ns={ns} place="main" />

        {prefs.home.status && (
          <section className="hm-now" aria-labelledby="hm-now-h" data-jump="Overview">
            <h2 id="hm-now-h" className="hm-h">
              Market &amp; desk
            </h2>
            <Pulse isSuper={isSuper} ns={ns} />
          </section>
        )}

        {prefs.home.today && <TodayCard isSuper={isSuper} />}

        {prefs.home.workspaces && <Workspaces user={user} hidden={prefs.nav.hidden} />}

        <div className="hm-feats" aria-label="TradeAI, paper trading and Social Media" data-jump="Tools">
          <TradeAiFeat />
          <PaperFeat />
          <SocialFeat />
        </div>

        {/* outside resources for learning, technical and fundamental analysis — each opens in a new tab */}
        <LearningCard />

        <ZerodhaAccounts />

        <CustomizeCard />

        <section className="hm-sets" aria-labelledby="hm-sets-h" data-jump="Settings & system">
          <div className="hm-sets__head">
            <h2 id="hm-sets-h" className="hm-h">
              Settings &amp; system
            </h2>
            <p>Sign-in, the AI model, who may enter, and the health of every part of the site.</p>
          </div>
          <div className="hm-sets__grid">
            <Setting
              to={adminPath("/google")}
              icon={<IconKey />}
              title="Google sign-in"
              text="The credentials behind the sign-in button."
              tip="Enter or replace the Google credentials that the sign-in button uses."
              status={s && { on: s.googleSecretSet, label: s.googleSecretSet ? "Connected" : "Not set up" }}
            />
            <Setting to={adminPath("/account")} icon={<IconShield />} title="Your account" text="Password, devices and recent activity." tip="Choose or change your password, sign out of every device, and see the recent sign-ins on your account." status={user && { on: Boolean(user.hasPassword), label: user.hasPassword ? "Password set" : "Google only" }} />
            {isSuper && <Setting to={adminPath("/email")} icon={<IconMail />} title="Email & sign-in" text="Mail server, ways to sign in, sign-in trail." tip="Set the mail server (SMTP) that sends sign-in links and codes, choose which ways of signing in are open, and read the trail of recent sign-ins. Superadmin only." status={{ on: Boolean(emailReady), label: emailReady ? "Email ready" : "Not set up" }} />}
            {isSuper && <Setting to={adminPath("/admins")} icon={<IconUsers />} title="Admin users" text="Who may sign in here." tip="Choose which Google accounts may sign in here. Superadmin only." />}
            <Setting
              to={adminPath("/ai")}
              icon={<IconChart />}
              title="AI model"
              text={ai && ai.configured ? `${ai.providerName} · ${ai.modelName}` : "Any AI company and model; advice only."}
              tip="The default AI model every feature uses (Claude Sonnet 5.5 unless you pick another: Anthropic, OpenAI, Gemini, DeepSeek or Kimi), its key, the fallback, the AI credit protection and the live co-pilot’s limits."
              status={ai && { on: ai.configured, label: ai.configured ? "On" : "Off" }}
            />
          </div>
          <SystemRow isSuper={isSuper} />
        </section>

        {/* Personal: what is the owner's own — his Kundali and his expenses — last on the page. For superadmins only; the server
            refuses everyone else as well. */}
        {isSuper && (
          <section className="hm-about" aria-labelledby="hm-about-h" data-jump="Personal">
            <h2 id="hm-about-h" className="hm-h">
              Personal
            </h2>
            <div className="hm-about__grid">
              <a
                className="hm-kundali"
                href={adminPath("/kundali")}
                target="_blank"
                rel="noopener noreferrer"
                lang="hi"
                data-tip="The birth chart, in Hindi: the charts, the dasha running today, the reading, the colours and remedies, and the stored horoscope to read or download. Superadmins only. Opens in a new tab."
              >
                <span className="hm-kundali__mark" aria-hidden="true">
                  ॐ
                </span>
                <span className="hm-kundali__text">
                  <b>जन्म कुंडली</b>
                  <small>लग्न, ग्रह, दशा, योग, शुभ रंग और उपाय · पत्रिका की प्रति</small>
                </span>
                <IconArrow />
              </a>
              <a
                className="hm-kundali hm-kundali--expenses"
                href={adminPath("/expenses")}
                target="_blank"
                rel="noopener noreferrer"
                data-tip="Your expense tracker: add what you spend with its date, then see it by day, month, year, group and category, search and sort it, and save it as a file. Superadmins only. Opens in a new tab."
              >
                <span className="hm-kundali__mark" aria-hidden="true">
                  ₹
                </span>
                <span className="hm-kundali__text">
                  <b>Expenses</b>
                  <small>Track what you spend: by day, month, year and category</small>
                </span>
                <IconArrow />
              </a>
              {/* the switch for the person icon in the public website's navbar (it hides the icon only; /me always opens) */}
              <LoginIconTile />
            </div>
          </section>
        )}
        </div>
      </div>
    </Shell>
  );
}
