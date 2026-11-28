// Positions & orders: your Zerodha account on this site — positions with live P&L, holdings,
// the order book and trades, funds and margins — and the trading switch that decides whether
// any of it can be changed from here.
//
// Built as a fallback for days when the Kite app or website is down but Zerodha's API still
// answers: from here you can exit a position, sell a holding, cancel or change an order, or
// square off everything at once. While the switch is OFF every such button is greyed out
// and the server refuses the request anyway.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { Alert, Loading } from "../../ui";
import { useAiStatus } from "../../aiStatus";
import { clock, inr, isNum, num, pct, tone, when } from "../analyzer/format";
import { TickContext, useLiveTicks } from "../analyzer/liveTicks";
import { useTrade, TradeButtons } from "./TradeContext";
import RiskGuard from "./RiskGuard";
import { DailyGoalCard } from "./DailyGoal";
import { CASH, LIVE_STATUSES, holdingNumbers, newRef, positionDayChange, positionPnl, totals } from "./tradeMath";
import { useLiveBook } from "./liveBook";
import { everyVisible } from "../../visible";
import { useExchangeNow } from "../../clock/exchangeClock";
import { PositionEvidence, usePositionEvidence } from "../analyzer/EvidenceCard";
import { FigureBand, PageBar, PageHead, SectionHead } from "../../ux/PageKit";
import { Attention, HoldingGlance, MarginBar, OrderStats, PositionGlance, PositionMonitor, useDayQuotes, useExitCoach } from "./PositionDesk";
import { attention, bookNumbers, holdingInsights, marginUse, minutesTo, orderAway, orderStats, posKey, roomToday } from "./positionMath";
import "./trade.css";
import "./account-page.css";

// The Journal's anatomy (23 Nov 2026): a head card, the sticky bar with the headline figures and this page's own
// section tabs (the same state, the same remembered tab and the same one-section-at-a-time view as before), and
// Console's band of figures. The Desk's dock (compact) keeps its own tab row and none of the frames. Layout only:
// the switch, the limits, every order form and every confirmation are exactly as they were.
const TABS = [
  { id: "positions", label: "Positions" },
  { id: "holdings", label: "Holdings" },
  { id: "orders", label: "Orders" },
  { id: "funds", label: "Funds" },
];
const TAB_KEY = "vpt.trade.tab";
const ACTION = { hold: "Hold", tighten_stop: "Tighten stop", trim: "Trim", exit: "Exit", add: "Add", wait: "Wait", review: "Review" };

const storedTab = () => {
  try {
    const v = window.localStorage.getItem(TAB_KEY);
    return TABS.some((t) => t.id === v) ? v : "positions";
  } catch (_) {
    return "positions";
  }
};
const money = (x) => (isNum(x) ? `${x < 0 ? "−" : ""}₹${num(Math.abs(x))}` : "—");
const signedMoney = (x) => (isNum(x) ? `${x > 0 ? "+" : x < 0 ? "−" : ""}₹${num(Math.abs(x))}` : "—");
const time = (s) => (s ? String(s).slice(11, 19) || String(s) : "—");

/* ------------------------------------------------------------- the switch */
function SwitchBar({ trade, status, onExitAll }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [limits, setLimits] = useState(null);
  const on = Boolean(status && status.enabled);

  const flip = async (next) => {
    setBusy(true);
    setErr("");
    try {
      await trade.setSwitch(next);
      setAsking(false);
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };
  const saveLimits = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      await api("/api/admin/trading/limits", { method: "PUT", body: limits });
      await trade.refresh();
      setLimits(null);
      trade.say("Order limits saved.", "ok");
    } catch (x) {
      setErr(x.message);
    }
  };

  return (
    <section className={`tr-switchbar ${on ? "is-on" : "is-off"}`} aria-label="Trading switch">
      <div className="tr-switchbar__main">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          className="tr-switch"
          disabled={busy}
          onClick={() => (on ? flip(false) : setAsking(true))}
          data-tip="The master switch for trading from this site. OFF: Buy, Sell, Exit, Modify and Cancel are greyed out and the server refuses them. ON: they send real orders to your Zerodha account."
        >
          <i aria-hidden="true" />
          <span>Trading {on ? "ON" : "OFF"}</span>
        </button>
        <p>
          {on ? (
            <>
              <b>Orders go to your Zerodha account.</b> Turned on {status.changedAt ? when(status.changedAt) : ""}. Turn it off when you are done.
            </>
          ) : (
            <>Buy and sell buttons are disabled. Your positions, holdings, orders and funds can still be viewed.</>
          )}
        </p>
        <div className="tr-switchbar__actions">
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setLimits(limits ? null : { maxQty: status ? status.limits.maxQty : 5000, maxValue: status ? status.limits.maxValue : 500000 })} data-tip="A guard against a fat finger: an order above these is refused, unless it only closes something you already hold.">
            Order limits{status ? `: ${num(status.limits.maxQty, 0)} qty · ₹${num(status.limits.maxValue, 0)}` : ""}
          </button>
          <button type="button" className="tr-btn tr-btn--danger" disabled={!on || !(status && status.connected)} onClick={onExitAll} data-tip="Emergency square-off: exits every open position at market (with market protection), and can cancel all pending orders first.">
            Exit all positions
          </button>
        </div>
      </div>
      {asking && (
        <div className="tr-ask" role="alertdialog" aria-label="Turn trading on?">
          <p>
            <b>Turn trading on?</b> From now until you turn it off, the Buy, Sell, Exit, Modify and Cancel buttons on this site send <b>real orders</b> to your Zerodha account.
          </p>
          <span>
            <button type="button" className="tr-btn tr-btn--danger" disabled={busy} onClick={() => flip(true)}>
              Yes, turn trading on
            </button>
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setAsking(false)}>
              Keep it off
            </button>
          </span>
        </div>
      )}
      {limits && (
        <form className="tr-limits" onSubmit={saveLimits}>
          <label className="tr-field">
            <span>Max quantity per order</span>
            <input type="number" min="1" step="1" value={limits.maxQty} onChange={(e) => setLimits((l) => ({ ...l, maxQty: e.target.value }))} />
          </label>
          <label className="tr-field">
            <span>Max value per order (₹)</span>
            <input type="number" min="1000" step="1000" value={limits.maxValue} onChange={(e) => setLimits((l) => ({ ...l, maxValue: e.target.value }))} />
          </label>
          <button type="submit" className="adm-btn adm-btn--solid adm-btn--sm">
            Save limits
          </button>
        </form>
      )}
      <Alert>{err}</Alert>
    </section>
  );
}

/* ------------------------------------------------------- small dialogs */
function Dialog({ title, children, onClose }) {
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="tr-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="tr-dialog">
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function ExitDialog({ pos, last, onClose, onDone }) {
  const max = Math.abs(pos.quantity);
  const [qty, setQty] = useState(String(max));
  const [type, setType] = useState("MARKET");
  const [price, setPrice] = useState(isNum(last) ? String(last) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ref] = useState(newRef);
  const side = pos.quantity > 0 ? "SELL" : "BUY";
  const go = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await api("/api/admin/trading/exit", { method: "POST", body: { exchange: pos.exchange, symbol: pos.symbol, product: pos.product, quantity: Number(qty), type, price: type === "LIMIT" ? Number(price) : undefined, confirm: true, clientRef: ref } });
      onDone(`Exit sent: ${r.side} ${r.quantity} ${pos.symbol} (order ${r.orderId}).`);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };
  return (
    <Dialog title={`Exit ${pos.symbol} · ${pos.product}`} onClose={onClose}>
      <p>
        You hold <b>{pos.quantity > 0 ? `${max} long` : `${max} short`}</b> at an average of {inr(pos.average)}. Exiting places a <b>{side}</b> order.
      </p>
      <div className="tr-grid">
        <label className="tr-field">
          <span>Quantity (max {max})</span>
          <input type="number" min="1" max={max} step="1" value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label className="tr-field">
          <span>Order type</span>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="MARKET">Market (with protection)</option>
            <option value="LIMIT">Limit</option>
          </select>
        </label>
        {type === "LIMIT" && (
          <label className="tr-field">
            <span>Price</span>
            <input type="number" step="0.05" value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
        )}
      </div>
      <Alert>{err}</Alert>
      <footer className="tr-dialog__foot">
        <button type="button" className={`tr-btn tr-btn--${side === "BUY" ? "buy" : "sell"} tr-btn--lg`} disabled={busy || !(Number(qty) >= 1 && Number(qty) <= max)} onClick={go}>
          {busy ? "Sending…" : `Yes, ${side.toLowerCase()} ${qty} to exit`}
        </button>
        <button type="button" className="adm-btn adm-btn--ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </footer>
    </Dialog>
  );
}

function ModifyDialog({ order, onClose, onDone }) {
  const [f, setF] = useState({ quantity: String(order.quantity), price: order.price ? String(order.price) : "", trigger: order.trigger ? String(order.trigger) : "", type: order.type });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ref] = useState(newRef);
  const go = async () => {
    setBusy(true);
    setErr("");
    try {
      const body = { type: f.type, quantity: f.quantity, confirm: true, clientRef: ref };
      if (f.type === "LIMIT" || f.type === "SL") body.price = f.price;
      if (f.type === "SL" || f.type === "SL-M") body.trigger = f.trigger;
      await api(`/api/admin/trading/orders/${order.variety}/${order.id}`, { method: "PUT", body });
      onDone(`Change sent for order ${order.id}.`);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };
  return (
    <Dialog title={`Modify ${order.side} ${order.symbol}`} onClose={onClose}>
      <div className="tr-grid">
        <label className="tr-field">
          <span>Quantity</span>
          <input type="number" min="1" step="1" value={f.quantity} onChange={(e) => setF((x) => ({ ...x, quantity: e.target.value }))} />
        </label>
        <label className="tr-field">
          <span>Order type</span>
          <select value={f.type} onChange={(e) => setF((x) => ({ ...x, type: e.target.value }))}>
            {["LIMIT", "MARKET", "SL", "SL-M"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label className="tr-field">
          <span>Price</span>
          <input type="number" step="0.05" value={f.price} disabled={!(f.type === "LIMIT" || f.type === "SL")} onChange={(e) => setF((x) => ({ ...x, price: e.target.value }))} />
        </label>
        <label className="tr-field">
          <span>Trigger price</span>
          <input type="number" step="0.05" value={f.trigger} disabled={!(f.type === "SL" || f.type === "SL-M")} onChange={(e) => setF((x) => ({ ...x, trigger: e.target.value }))} />
        </label>
      </div>
      <Alert>{err}</Alert>
      <footer className="tr-dialog__foot">
        <button type="button" className="adm-btn adm-btn--solid" disabled={busy} onClick={go}>
          {busy ? "Sending…" : "Yes, modify order"}
        </button>
        <button type="button" className="adm-btn adm-btn--ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </footer>
    </Dialog>
  );
}

function ExitAllDialog({ positions, openOrders, onClose, onDone }) {
  const [words, setWords] = useState("");
  const [cancelOpen, setCancelOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);
  const [ref] = useState(newRef);
  const go = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await api("/api/admin/trading/exit-all", { method: "POST", body: { confirm: words.trim().toUpperCase(), cancelOpen, clientRef: ref } });
      setResult(r);
      onDone();
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };
  return (
    <Dialog title="Exit all positions" onClose={onClose}>
      {result ? (
        <>
          <ul className="tr-results">
            {result.results.map((r, i) => (
              <li key={i} className={r.ok ? "is-ok" : "is-bad"}>
                {r.kind === "cancel" ? "Cancel" : `${r.side || "Exit"} ${r.quantity}`} {r.symbol} {r.product ? `· ${r.product}` : ""} — {r.ok ? `sent (order ${r.orderId})` : r.error}
              </li>
            ))}
            {result.results.length === 0 && <li>Nothing was open.</li>}
          </ul>
          <p className="tr-note is-warn">Sent is not filled. Check the Orders and Positions tabs.</p>
          <footer className="tr-dialog__foot">
            <button type="button" className="adm-btn adm-btn--solid" onClick={onClose}>
              Close
            </button>
          </footer>
        </>
      ) : (
        <>
          <p>
            This sends a <b>market order with protection</b> to close each of your <b>{positions.length}</b> open position{positions.length === 1 ? "" : "s"}: {positions.map((p) => `${p.symbol} (${p.quantity > 0 ? "+" : ""}${p.quantity})`).join(", ") || "none"}.
          </p>
          <label className="tr-check">
            <input type="checkbox" checked={cancelOpen} onChange={(e) => setCancelOpen(e.target.checked)} /> First cancel the {openOrders} pending order{openOrders === 1 ? "" : "s"} (stop-losses and limits too)
          </label>
          <label className="tr-field tr-field--wide">
            <span>Type EXIT ALL to confirm</span>
            <input value={words} onChange={(e) => setWords(e.target.value)} autoComplete="off" />
          </label>
          <Alert>{err}</Alert>
          <footer className="tr-dialog__foot">
            <button type="button" className="tr-btn tr-btn--danger tr-btn--lg" disabled={busy || words.trim().toUpperCase() !== "EXIT ALL"} onClick={go}>
              {busy ? "Sending…" : "Exit everything now"}
            </button>
            <button type="button" className="adm-btn adm-btn--ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          </footer>
        </>
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------ the coach */
function CoachPanel({ canExit, onExit, positions }) {
  const [state0, setState] = useState({ configured: false, readings: [] });
  const aiNow = useAiStatus();
  const state = { ...state0, configured: aiNow ? aiNow.configured : state0.configured };
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    api("/api/admin/trading/coach").then(setState).catch(() => {});
  }, []);
  const ask = async () => {
    setBusy(true);
    setErr("");
    try {
      const d = await api("/api/admin/trading/coach", { method: "POST", body: { holdings: true } });
      setState({ configured: d.configured, readings: d.readings });
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };
  const r = state.readings[0];
  return (
    <section className="an-card tr-coach">
      <header className="an-card__head">
        <div>
          <h3>AI position coach</h3>
          <p>The model reads your positions and holdings — quantity, average, live price, P&amp;L, product, funds — next to the desk’s live call and levels for each stock, and says what it would do. It advises only; any order is yours to place.</p>
        </div>
        <button type="button" className="adm-btn adm-btn--solid adm-btn--sm" onClick={ask} disabled={busy || !state.configured} data-tip="Ask the AI to read your book now. It uses your AI company's tokens, and runs only when you press it.">
          {busy ? "Reading your book…" : "Ask the coach"}
        </button>
      </header>
      {!state.configured && <p className="adm-alert adm-alert--info">Add an AI API key in the AI settings to use the coach.</p>}
      <Alert>{err}</Alert>
      {r && (
        <div className="tr-coach__out">
          <p className="tr-coach__meta">
            {when(r.at)} · {r.model} · {r.counts.positions} position{r.counts.positions === 1 ? "" : "s"}, {r.counts.holdings} holding{r.counts.holdings === 1 ? "" : "s"}
          </p>
          <p>{r.overview}</p>
          <ul className="tr-advice">
            {r.positions.map((a, i) => {
              const p = positions.find((x) => x.symbol === a.symbol && x.product === a.product && x.quantity !== 0);
              return (
                <li key={i} className={`is-${a.action}`}>
                  <header>
                    <b>{a.symbol}</b> <small>{a.product}</small>
                    <span className={`tr-act tr-act--${a.action}`}>{ACTION[a.action] || a.action}</span>
                    <small>
                      {a.urgency === "now" ? "act now" : a.urgency === "today" ? "today" : "watch"} · {a.confidence} confidence
                    </small>
                  </header>
                  <p>{a.reasoning}</p>
                  <p className="tr-advice__lv">
                    {a.stop ? <>Stop {inr(a.stop)} · </> : null}
                    {a.target ? <>Target {inr(a.target)} · </> : null}
                    <span>Changes if: {a.invalidation}</span>
                  </p>
                  {a.notes.map((n) => (
                    <p key={n} className="tr-note is-warn">
                      {n}
                    </p>
                  ))}
                  {p && (a.action === "exit" || a.action === "trim") && (
                    <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={!canExit} onClick={() => onExit(p)} data-tip={canExit ? "Open the exit form for this position. You choose the quantity and confirm." : "Turn trading on to exit from here."}>
                      Open exit form
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {r.holdings.length > 0 && (
            <>
              <h4>Holdings</h4>
              <ul className="tr-advice tr-advice--hold">
                {r.holdings.map((h, i) => (
                  <li key={i}>
                    <b>{h.symbol}</b> <span className={`tr-act tr-act--${h.action}`}>{ACTION[h.action] || h.action}</span> {h.reasoning}
                  </li>
                ))}
              </ul>
            </>
          )}
          {r.risk && <p className="tr-note">{r.risk}</p>}
          <p className="vd-note">{r.caveat} This is not investment advice, and nothing here has been placed as an order.</p>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- the view */
/**
 * @param compact  the Desk's dock: the tables only — no switch bar, tiles, coach or activity log
 */
export default function Account({ compact = false, onOpen }) {
  const trade = useTrade();
  const [tab, setTabState] = useState(storedTab);
  const [state, setState] = useState({ loading: true, data: null, error: "" });
  const [dialog, setDialog] = useState(null); // { kind, item }
  const [audit, setAudit] = useState(null);
  const [cancelling, setCancelling] = useState("");
  const version = trade ? trade.version : 0;
  const setTab = (id) => {
    setTabState(id);
    try {
      window.localStorage.setItem(TAB_KEY, id);
    } catch (_) {
      /* the tab is remembered for this visit only */
    }
  };

  const hasTrade = Boolean(trade);
  const load = useCallback(() => {
    if (!hasTrade) return undefined;
    let alive = true;
    api("/api/admin/trading/summary")
      .then((d) => alive && setState({ loading: false, data: d, error: "" }))
      .catch((e) => alive && setState((s) => ({ loading: false, data: e.code === "not_connected" ? null : s.data, error: e.message, code: e.code })));
    return () => {
      alive = false;
    };
  }, [hasTrade]);
  useEffect(() => load(), [load, version]);
  // orders, holdings and funds: read again every 10 s while the page is in view (and at once when it is
  // shown again, or when an order changes). The positions and their P&L come live from the book below.
  useEffect(() => everyVisible(load, 10000, { topics: ["trading", "market"] }), [load]);

  const d = state.data;
  const status = (trade && trade.status) || (d && d.status) || null;
  // the positions at streamed prices (the live book, pushed by the server on every price or fill);
  // the summary's own copy only until the first push arrives
  const book = useLiveBook();
  const bookOn = Boolean(book && book.available && Array.isArray(book.positions));
  const positions = useMemo(() => (bookOn ? book.positions : d && d.positions ? d.positions.net : []), [bookOn, book, d]);
  const holdings = useMemo(() => (d && d.holdings) || [], [d]);
  const orders = useMemo(() => (d && d.orders) || [], [d]);
  const trades = useMemo(() => (d && d.trades) || [], [d]);
  const openOrders = orders.filter((o) => LIVE_STATUSES.has(o.status));
  const doneOrders = orders.filter((o) => !LIVE_STATUSES.has(o.status));

  // live prices for NSE stocks held or open (and, on the full page, those with an order waiting: how far it is from the market)
  const watched = !compact ? openOrders.filter((o) => o.exchange === "NSE").map((o) => o.symbol).join(",") : "";
  const symbols = useMemo(() => [...new Set([...positions.filter((p) => p.exchange === "NSE").map((p) => p.symbol), ...holdings.map((h) => h.symbol), ...(watched ? watched.split(",") : [])])].sort().slice(0, 60), [positions, holdings, watched]);
  const live = useLiveTicks(symbols, Boolean(status && status.connected));
  const liveOf = useCallback(
    (x) => (bookOn && x.key ? x.last : x.exchange === "NSE" || CASH.has(x.exchange) ? (live.slow[x.symbol] && isNum(live.slow[x.symbol].last) ? live.slow[x.symbol].last : null) : null),
    [live.slow, bookOn]
  );
  // the evidence desk's reading of the next 15 minutes for each open NSE position, and whether it is with it or against it
  const evList = useMemo(() => positions.filter((p) => p.exchange === "NSE" && p.quantity !== 0).map((p) => ({ symbol: p.symbol, side: p.quantity > 0 ? "long" : "short" })), [positions]);
  const evRows = usePositionEvidence(evList);
  const tot = totals({ positions, holdings }, liveOf);
  // today's figure, the same one the top bar and the dock show (Zerodha's day M2M, live)
  const dayPnl = bookOn ? book.day : tot.posPnl;
  const canTrade = Boolean(status && status.enabled && status.connected);

  // what the first-sight panels read besides the account (28 Nov 2026; the full page only, never the Desk's dock):
  // the day's quote of each stock with an open position or a waiting order, and the owner's exit coach
  const quoteList = useMemo(() => (compact ? [] : [...new Set([...positions.filter((p) => p.exchange === "NSE" && p.quantity !== 0).map((p) => p.symbol), ...(watched ? watched.split(",") : [])])].sort().slice(0, 40)), [compact, positions, watched]);
  const quotes = useDayQuotes(quoteList, Boolean(status && status.connected));
  const coachRows = useExitCoach(Boolean(!compact && trade && trade.owner && status && status.connected));
  const nseNow = useExchangeNow(15000); // the square-off countdown runs on NSE’s clock
  const quoteOf = (symbol) => (quotes[symbol] || live.slow[symbol] ? { ...quotes[symbol], ...live.slow[symbol] } : null);
  const priceOf = (p) => liveOf(p) ?? p.last;
  const orderLtp = (o) => {
    if (o.exchange !== "NSE") {
      const p = positions.find((x) => x.symbol === o.symbol && x.exchange === o.exchange);
      return p ? priceOf(p) : null;
    }
    const q = quoteOf(o.symbol);
    return q && isNum(q.last) ? q.last : null;
  };
  const done = (msg) => {
    setDialog(null);
    if (msg && trade) trade.say(msg, "ok");
    load();
  };

  const cancel = async (o) => {
    if (cancelling !== o.id) {
      setCancelling(o.id);
      setTimeout(() => setCancelling((c) => (c === o.id ? "" : c)), 4000);
      return;
    }
    setCancelling("");
    try {
      await api(`/api/admin/trading/orders/${o.variety}/${o.id}`, { method: "DELETE", body: { clientRef: newRef() } });
      trade.say(`Cancel sent for order ${o.id}.`, "ok");
      load();
    } catch (e) {
      trade.say(e.message, "error");
    }
  };

  if (!trade) return <p className="adm-alert adm-alert--info">Positions and orders are shown to the account owner (the superadmin) only.</p>;

  const tradingOn = Boolean(status && status.enabled);
  const equity = d && d.funds && d.funds.equity ? d.funds.equity : null;
  // the first-sight figures, from what is already on the page
  const numbers = bookNumbers(positions, orders, priceOf);
  const margin = marginUse(equity);
  const room = roomToday({ rules: status && status.risk, lock: status && status.riskLock, dayPnl, orders, positions });
  const stats = orderStats(orders, trades);
  const squareOff = (d && d.squareOff) || {};
  const mis = positions
    .filter((p) => p.product === "MIS" && p.quantity !== 0 && squareOff[p.symbol])
    .map((p) => ({ symbol: p.symbol, ...squareOff[p.symbol], left: minutesTo(squareOff[p.symbol].min, nseNow) }))
    .sort((a, b) => a.min - b.min);
  const coachNow = positions.filter((p) => p.quantity !== 0 && coachRows[posKey(p)] && coachRows[posKey(p)].advice).map((p) => ({ symbol: p.symbol, state: coachRows[posKey(p)].advice.state, price: coachRows[posKey(p)].advice.exit ? coachRows[posKey(p)].advice.exit.price : null }));
  const needs = d && !compact ? attention({ numbers, room, margin, stats, mis, coach: coachNow }) : [];
  // how the P&L is kept current (the note the tab row carried; the dock's tab row still does)
  const liveNote = d ? (bookOn ? (book.live && book.streaming ? "P&L live with every price" : `P&L as Zerodha reported at ${clock(book.baseAt)}`) : live.state === "live" ? "prices streaming" : "prices every 10 s") : "";

  return (
    <TickContext.Provider value={live.store}>
      {!compact && (
        <>
          <PageHead
            title="Positions & orders"
            text="Your Zerodha account on this site: positions with live P&L, holdings, orders and trades, funds and margins. Buy, sell, exit, change or cancel from here only while the trading switch is ON; while it is OFF those buttons are greyed out and the server refuses them."
          />
          <PageBar
            label={status ? (status.connected ? "Connected" : "Not connected") : "—"}
            labelTitle="Zerodha"
            kpis={[
              { label: "Total P&L", value: d ? signedMoney(dayPnl) : null, tone: d ? tone(dayPnl) : "", tip: "Today’s profit or loss on all positions, open and closed (the day’s M2M, by Zerodha’s own formula) — the same figure as the top bar and the dock." },
              { label: "Open positions", value: d ? tot.open : null },
              { label: "Margin available", value: equity ? money(equity.net) : null, tip: "Equity margin available for new trades, as Zerodha reports it." },
              { label: "Trading", value: status ? (tradingOn ? "ON" : "OFF") : null, tone: tradingOn ? "warn" : "", tip: tradingOn ? "The trading switch is ON: Buy, Sell, Exit, Modify and Cancel send real orders to your Zerodha account." : "The trading switch is OFF: Buy, Sell, Exit, Modify and Cancel are greyed out and the server refuses them." },
              { label: "Open orders", value: d ? openOrders.length : null, more: true },
            ]}
            tabs={d ? TABS.map((x) => ({ ...x, count: x.id === "positions" ? tot.open : x.id === "holdings" ? holdings.length : x.id === "orders" ? openOrders.length : 0 })) : null}
            tab={tab}
            onTab={setTab}
            updatedAt={d ? d.at : null}
              atSeconds
            onRefresh={() => {
              load();
            }}
            loading={state.loading}
            tools={liveNote ? <small className="acc-live">{liveNote}</small> : null}
            tabsLabel="Account sections"
          />
        </>
      )}
      <div className={`tr ${compact ? "tr--compact" : ""}`}>
        {!compact && <SwitchBar trade={trade} status={status} onExitAll={() => setDialog({ kind: "exit-all" })} />}

        {state.loading && !d && <Loading label="Reading your account from Zerodha…" />}
        {state.error && (
          <p className={`adm-alert ${state.code === "not_connected" ? "adm-alert--info" : ""}`}>
            {state.error}
            {state.code === "not_connected" && " Open the Trading desk tab and log in to Kite; then come back here."}
          </p>
        )}

        {d && (
          <>
            {!compact && (
              <>
                <PositionGlance numbers={numbers} dayPnl={dayPnl} margin={margin} room={room} goal={trade.goal} mis={mis} />
                <Attention items={needs} open={numbers.open > 0} />
              </>
            )}

            {/* the page's sections are the bar's tabs (above); the Desk's dock has no bar, so it keeps this row */}
            {compact && (
            <div className="sv__tabs tr-tabs" role="tablist" aria-label="Account sections">
              {TABS.map((x) => (
                <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)}>
                  {x.label}
                  {x.id === "positions" && tot.open > 0 && <i>{tot.open}</i>}
                  {x.id === "holdings" && holdings.length > 0 && <i>{holdings.length}</i>}
                  {x.id === "orders" && openOrders.length > 0 && <i>{openOrders.length}</i>}
                </button>
              ))}
              <span className="tr-tabs__at">
                updated {clock(d.at)} · {liveNote}
              </span>
            </div>
            )}

            {Object.keys(d.errors || {}).length > 0 && <p className="adm-alert">Some parts could not be read: {Object.entries(d.errors).map(([k, v]) => `${k} (${v})`).join("; ")}</p>}

            {tab === "positions" && (
              <>
                {!compact && (
                  <PositionMonitor
                    positions={positions}
                    orders={orders}
                    priceOf={priceOf}
                    quoteOf={quoteOf}
                    coach={coachRows}
                    evidence={evRows}
                    squareOff={squareOff}
                    canTrade={canTrade}
                    trade={trade}
                    onExit={(p, ltp) => setDialog({ kind: "exit", item: p, last: ltp })}
                    onOpen={onOpen}
                  />
                )}
                <section className="an-card tr-card">
                  {!compact && positions.length > 0 && <SectionHead title="All positions today" sub="Open and closed, in Kite’s columns" />}
                  {positions.length === 0 ? (
                    <p className="tr-empty">No positions today.</p>
                  ) : (
                    <div className="bt__scroll">
                      <table className="an-table tr-table tr-table--pos">
                        <thead>
                          <tr>
                            <th scope="col">Product</th>
                            <th scope="col">Instrument</th>
                            <th scope="col" className="is-num">Qty.</th>
                            <th scope="col" className="is-num">Avg.</th>
                            <th scope="col" className="is-num">LTP</th>
                            <th scope="col" className="is-num">P&amp;L</th>
                            <th scope="col" className="is-num">Chg.</th>
                            <th scope="col">
                              <span className="adm-sr">Actions</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {positions.map((p) => {
                            const ltp = liveOf(p) ?? p.last;
                            const pnl = positionPnl(p, ltp);
                            const closed = p.quantity === 0;
                            return (
                              <tr key={`${p.exchange}:${p.symbol}:${p.product}`} className={closed ? "is-closed" : ""}>
                                <td>
                                  <span className={`tr-prod tr-prod--${p.product}`}>{p.product}</span>
                                </td>
                                <th scope="row">
                                  {p.symbol} <small>{p.exchange}</small>
                                  {/* on a phone the product column is dropped and its tag rides here */}
                                  <small className={`tr-prod tr-prod--${p.product} tr-prod--in`}>{p.product}</small>
                                  {compact && !closed && p.exchange === "NSE" && evRows[`${p.symbol}|${p.quantity > 0 ? "long" : "short"}`] && (
                                    <div className="tr-ev">
                                      <PositionEvidence reading={evRows[`${p.symbol}|${p.quantity > 0 ? "long" : "short"}`]} />
                                    </div>
                                  )}
                                </th>
                                <td className={`is-num is-${tone(p.quantity)}`}>{p.quantity}</td>
                                <td className="is-num">{closed ? "—" : num(p.average)}</td>
                                <td className="is-num">{num(ltp)}</td>
                                <td className={`is-num is-${tone(pnl)}`}>{signedMoney(pnl)}</td>
                                <td className={`is-num is-${tone(positionDayChange(p, ltp))}`}>{pct(positionDayChange(p, ltp))}</td>
                                <td className="tr-actions">
                                  {!closed && (
                                    <button type="button" className="tr-btn tr-btn--exit" disabled={!canTrade} onClick={() => setDialog({ kind: "exit", item: p, last: ltp })} data-tip={canTrade ? `Close this position with a ${p.quantity > 0 ? "sell" : "buy"} order. You pick the quantity and confirm.` : "Turn trading on to exit from here."}>
                                      Exit
                                    </button>
                                  )}
                                  <TradeButtons symbol={p.symbol} exchange={p.exchange} product={p.product} small />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td colSpan={5}>Total</td>
                            <td className={`is-num is-${tone(tot.posPnl)}`}>{signedMoney(tot.posPnl)}</td>
                            <td colSpan={2} />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </section>
                {/* the AI coach reads the owner's account with the owner's AI credit: it is the owner's only */}
                {!compact && trade.owner && <CoachPanel positions={positions} canExit={canTrade} onExit={(p) => setDialog({ kind: "exit", item: p, last: liveOf(p) ?? p.last })} />}
              </>
            )}

            {tab === "holdings" && !compact && <HoldingGlance x={holdingInsights(holdings, (h) => liveOf(h) ?? h.last)} />}
            {tab === "holdings" && (
              <section className="an-card tr-card">
                <p className="tr-note">
                  Selling delivery shares needs DDPI (or the day’s CDSL TPIN authorisation) on your Zerodha account. Without it Zerodha rejects the sell — set it up before you need it.
                </p>
                {holdings.length === 0 ? (
                  <p className="tr-empty">No holdings.</p>
                ) : (
                  <div className="bt__scroll">
                    <table className="an-table tr-table">
                      <thead>
                        <tr>
                          <th scope="col">Instrument</th>
                          <th scope="col" className="is-num">Qty.</th>
                          <th scope="col" className="is-num">Avg. cost</th>
                          <th scope="col" className="is-num">LTP</th>
                          <th scope="col" className="is-num">Cur. val</th>
                          <th scope="col" className="is-num">P&amp;L</th>
                          <th scope="col" className="is-num">Net chg.</th>
                          <th scope="col" className="is-num">Day chg.</th>
                          <th scope="col">
                            <span className="adm-sr">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {holdings.map((h) => {
                          const ltp = liveOf(h) ?? h.last;
                          const n = holdingNumbers(h, ltp);
                          return (
                            <tr key={`${h.exchange}:${h.symbol}`}>
                              <th scope="row">
                                {h.symbol} {h.t1 > 0 && <small data-tip="Shares bought recently that have not reached your demat account yet (T1). They can be sold.">T1: {h.t1}</small>}
                              </th>
                              <td className="is-num">{n.qty}</td>
                              <td className="is-num">{num(h.average)}</td>
                              <td className="is-num">{num(ltp)}</td>
                              <td className="is-num">{num(n.current)}</td>
                              <td className={`is-num is-${tone(n.pnl)}`}>{signedMoney(n.pnl)}</td>
                              <td className={`is-num is-${tone(n.pnlPct)}`}>{pct(n.pnlPct)}</td>
                              <td className={`is-num is-${tone(n.dayPct)}`}>{pct(n.dayPct)}</td>
                              <td className="tr-actions">
                                <TradeButtons symbol={h.symbol} exchange={h.exchange === "BSE" ? "BSE" : "NSE"} product="CNC" quantity={n.qty} small />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={4}>Total</td>
                          <td className="is-num">{num(tot.current)}</td>
                          <td className={`is-num is-${tone(tot.holdPnl)}`}>{signedMoney(tot.holdPnl)}</td>
                          <td className={`is-num is-${tone(tot.holdPnlPct)}`}>{pct(tot.holdPnlPct)}</td>
                          <td colSpan={2} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </section>
            )}

            {tab === "orders" && (
              <>
                {!compact && <OrderStats stats={stats} />}
                <section className="an-card tr-card">
                  <SectionHead title={`Open orders (${openOrders.length})`} actions={<TradeButtons symbol="" exchange="NSE" />} />
                  {openOrders.length === 0 ? (
                    <p className="tr-empty">No open orders.</p>
                  ) : (
                    <div className="bt__scroll">
                      <table className="an-table tr-table">
                        <thead>
                          <tr>
                            <th scope="col">Time</th>
                            <th scope="col">Type</th>
                            <th scope="col">Instrument</th>
                            <th scope="col">Product</th>
                            <th scope="col" className="is-num">Qty.</th>
                            <th scope="col" className="is-num">Price</th>
                            {!compact && (
                              <th scope="col" className="is-num" data-tip="How far the order’s trigger (or limit price) is from the last price now">
                                From LTP
                              </th>
                            )}
                            <th scope="col">Status</th>
                            <th scope="col">
                              <span className="adm-sr">Actions</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {openOrders.map((o) => (
                            <tr key={o.id}>
                              <td>{time(o.placedAt)}</td>
                              <td>
                                <span className={`tr-side-tag tr-side-tag--${o.side === "BUY" ? "buy" : "sell"}`}>{o.side}</span> <small>{o.type}</small>
                              </td>
                              <th scope="row">
                                {o.symbol} <small>{o.exchange}</small>
                              </th>
                              <td>{o.product}</td>
                              <td className="is-num">
                                {o.filled} / {o.quantity}
                              </td>
                              <td className="is-num">
                                {o.price ? num(o.price) : "Market"}
                                {o.trigger ? <small> trg {num(o.trigger)}</small> : null}
                              </td>
                              {!compact && (
                                <td className="is-num">
                                  {isNum(orderAway(o, orderLtp(o))) ? (
                                    <>
                                      {pct(orderAway(o, orderLtp(o)))} <small>LTP {num(orderLtp(o))}</small>
                                    </>
                                  ) : (
                                    "—"
                                  )}
                                </td>
                              )}
                              <td>
                                <span className="tr-status">{o.status}</span>
                              </td>
                              <td className="tr-actions">
                                <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={!canTrade} onClick={() => setDialog({ kind: "modify", item: o })} data-tip={canTrade ? "Change this order’s quantity, price, trigger or type." : "Turn trading on to change orders from here."}>
                                  Modify
                                </button>
                                <button type="button" className={`adm-btn adm-btn--sm ${cancelling === o.id ? "tr-btn--danger" : "adm-btn--ghost"}`} disabled={!canTrade} onClick={() => cancel(o)} data-tip={canTrade ? "Cancel this order. Press twice: the first press asks, the second sends." : "Turn trading on to cancel orders from here."}>
                                  {cancelling === o.id ? "Confirm cancel" : "Cancel"}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
                <section className="an-card tr-card">
                  <SectionHead title={`Executed orders (${doneOrders.length})`} />
                  {doneOrders.length === 0 ? (
                    <p className="tr-empty">None yet today.</p>
                  ) : (
                    <div className="bt__scroll">
                      <table className="an-table tr-table">
                        <thead>
                          <tr>
                            <th scope="col">Time</th>
                            <th scope="col">Type</th>
                            <th scope="col">Instrument</th>
                            <th scope="col">Product</th>
                            <th scope="col" className="is-num">Qty.</th>
                            <th scope="col" className="is-num">Avg. price</th>
                            <th scope="col">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {doneOrders.map((o) => (
                            <tr key={o.id}>
                              <td>{time(o.placedAt)}</td>
                              <td>
                                <span className={`tr-side-tag tr-side-tag--${o.side === "BUY" ? "buy" : "sell"}`}>{o.side}</span> <small>{o.type}</small>
                              </td>
                              <th scope="row">
                                {o.symbol} <small>{o.exchange}</small>
                              </th>
                              <td>{o.product}</td>
                              <td className="is-num">
                                {o.filled} / {o.quantity}
                              </td>
                              <td className="is-num">{o.average ? num(o.average) : o.price ? num(o.price) : "—"}</td>
                              <td>
                                <span className={`tr-status tr-status--${o.status.toLowerCase().replace(/\s+/g, "-")}`}>{o.status}</span>
                                {o.status === "REJECTED" && o.message && <small className="tr-why">{o.message}</small>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
                <section className="an-card tr-card">
                  <SectionHead title={`Trades (${trades.length})`} />
                  {trades.length === 0 ? (
                    <p className="tr-empty">No trades today.</p>
                  ) : (
                    <div className="bt__scroll">
                      <table className="an-table tr-table">
                        <thead>
                          <tr>
                            <th scope="col">Time</th>
                            <th scope="col">Type</th>
                            <th scope="col">Instrument</th>
                            <th scope="col">Product</th>
                            <th scope="col" className="is-num">Qty.</th>
                            <th scope="col" className="is-num">Price</th>
                            <th scope="col">Order</th>
                          </tr>
                        </thead>
                        <tbody>
                          {trades.map((x) => (
                            <tr key={x.id}>
                              <td>{time(x.at)}</td>
                              <td>
                                <span className={`tr-side-tag tr-side-tag--${x.side === "BUY" ? "buy" : "sell"}`}>{x.side}</span>
                              </td>
                              <th scope="row">{x.symbol}</th>
                              <td>{x.product}</td>
                              <td className="is-num">{x.quantity}</td>
                              <td className="is-num">{num(x.price)}</td>
                              <td>
                                <small>{x.orderId}</small>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </>
            )}

            {tab === "funds" && !compact && <MarginBar margin={margin} equity={equity} />}
            {tab === "funds" && (
              <section className="tr-funds">
                {["equity", "commodity"].map((seg) => {
                  const f = d.funds && d.funds[seg];
                  if (!f || !f.enabled) return null;
                  const rows = [
                    ["Available margin", f.net, "What you can use for new trades now."],
                    ["Used margin", f.used.debits, "Margin blocked by open positions and orders."],
                    ["Available cash", f.available.cash, "Cash in the account, before today’s blocks."],
                    ["Opening balance", f.available.opening, "Cash at the start of the day."],
                    ["Payin", f.available.payin, "Money added today."],
                    ["SPAN", f.used.span, "F&O margin required by the exchange."],
                    ["Delivery margin", f.used.delivery, "Margin for delivery trades."],
                    ["Exposure", f.used.exposure, "Additional F&O margin."],
                    ["Options premium", f.used.optionPremium, "Premium paid for options bought today."],
                    ["Total collateral", f.available.collateral, "Margin from pledged holdings."],
                    ["Realised P&L", f.used.m2mRealised, "Profit or loss booked today (the day's realised M2M)."],
                    ["Unrealised P&L", f.used.m2mUnrealised, "Profit or loss on open positions (the day's unrealised M2M)."],
                  ];
                  return (
                    <div key={seg} className="an-card tr-card">
                      <SectionHead title={seg === "equity" ? "Equity" : "Commodity"} />
                      <dl className="tr-fundlist">
                        {rows.map(([k, v, tip]) => (
                          <div key={k} data-tip={tip}>
                            <dt>{k}</dt>
                            <dd>{money(v)}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  );
                })}
                {!d.funds && <p className="adm-alert">{d.errors.funds || "Funds could not be read."}</p>}
              </section>
            )}

            {!compact && (
              <FigureBand
                label="Positions, holdings and margin"
                items={[
                  {
                    label: "Positions · Total P&L",
                    value: signedMoney(dayPnl),
                    tone: tone(dayPnl),
                    tip: "Today’s profit or loss on all positions, open and closed (the day’s M2M, by Zerodha’s own formula) — the same figure as the top bar and the dock, live with every streamed price.",
                    sub: `${tot.open} open · ${positions.length - tot.open} closed today${bookOn && Math.abs(book.pnl - book.day) >= 1 ? ` · ${signedMoney(book.pnl)} since entry` : ""}`,
                  },
                  { label: "Holdings · Total P&L", value: signedMoney(tot.holdPnl), tone: tone(tot.holdPnl), tip: "Profit or loss on your delivery holdings against what you paid for them.", sub: `${pct(tot.holdPnlPct)} on ${money(tot.invested)}` },
                  { label: "Holdings · Day’s P&L", value: signedMoney(tot.holdDay), tone: tone(tot.holdDay), tip: "How much your holdings have moved since yesterday’s close.", sub: `current value ${money(tot.current)}` },
                  { label: "Margin available", value: equity ? money(equity.net) : "—", tip: "Equity margin available for new trades, as Zerodha reports it.", sub: equity ? `Margins used ${money(equity.used.debits)}` : d.errors.funds || "" },
                ]}
              />
            )}

            {!compact && (
            <details className="tr-audit" onToggle={(e) => e.currentTarget.open && api("/api/admin/trading/audit").then((x) => setAudit(x.audit)).catch(() => setAudit([]))}>
              <summary>
                <b>Activity on this site</b> — every switch change and every order sent from here
              </summary>
              {!audit ? (
                <Loading />
              ) : audit.length === 0 ? (
                <p className="tr-empty">Nothing yet.</p>
              ) : (
                <ul>
                  {audit.map((a, i) => (
                    <li key={i} className={a.result && a.result.ok === false ? "is-bad" : ""}>
                      <time>{when(a.at)}</time> <b>{a.action}</b> {a.input && a.input.tradingsymbol ? `${a.input.transaction_type || ""} ${a.input.quantity || ""} ${a.input.tradingsymbol} ${a.input.order_type || ""}` : a.input && a.input.id ? `order ${a.input.id}` : ""} — {a.result && a.result.ok ? (a.result.orderId ? `sent (${a.result.orderId})` : "done") : a.result ? a.result.error : ""}
                    </li>
                  ))}
                </ul>
              )}
            </details>
            )}
          </>
        )}

        {!compact && trade.goal && <DailyGoalCard goal={trade.goal} onSaved={trade.reloadGoal} />}
        {!compact && <RiskGuard trade={trade} version={version} />}

        {!compact && (
        <p className="vd-note tr-foot">
          Orders from here go through Zerodha’s Kite Connect API: they help when the Kite app or website is down, not when Zerodha’s own order system is. Zerodha accepts API orders only from the static IP registered on your Kite Connect app. If the API is down too, call Zerodha’s dealing desk to square off.
        </p>
        )}
      </div>

      {dialog && dialog.kind === "exit" && <ExitDialog pos={dialog.item} last={dialog.last} onClose={() => setDialog(null)} onDone={done} />}
      {dialog && dialog.kind === "modify" && <ModifyDialog order={dialog.item} onClose={() => setDialog(null)} onDone={done} />}
      {dialog && dialog.kind === "exit-all" && <ExitAllDialog positions={positions.filter((p) => p.quantity !== 0)} openOrders={openOrders.length} onClose={() => setDialog(null)} onDone={() => load()} />}
    </TickContext.Provider>
  );
}
