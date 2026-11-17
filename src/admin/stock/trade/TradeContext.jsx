// Trading for the whole Stock Report: the switch's state, the order ticket (one, shared by
// every Buy / Sell button), and order updates from Zerodha as they arrive.
//
// Only the superadmin gets any of it — it is their Zerodha account. For anyone else the
// context is null and no Buy / Sell button is drawn.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { useAuth } from "../../auth";
import OrderTicket from "./OrderTicket";
import SoftToast from "../../SoftToast";
import { chime, useDailyGoal } from "./DailyGoal";
import { stopTicket } from "./tradeMath";
import { bookStore, pulseOf } from "./liveBook";
import { everyVisible } from "../../visible";
import "./trade.css";

export const TradeContext = createContext(null);

/** null when this user cannot trade (not the superadmin), else the trading controls. */
export const useTrade = () => useContext(TradeContext);

export function TradeProvider({ children }) {
  const { user } = useAuth();
  const allowed = Boolean(user && user.role === "superadmin");
  const [status, setStatus] = useState(null);
  const [ticket, setTicket] = useState(null); // the prefill of the open ticket, or null
  const [version, setVersion] = useState(0); // goes up whenever the account may have changed
  const [toast, setToast] = useState(null);
  const [pulse, setPulse] = useState(null); // { pnl, open, at } — the day's positions, for the top bar
  // an entry placed with a planned stop: once it fills, the stop-loss order is OFFERED here —
  // a ticket to confirm, never an order sent by itself
  const [follow, setFollow] = useState(null);
  const toastTimer = useRef(null);

  const say = useCallback((text, kind = "info") => {
    setToast({ text, kind, at: Date.now() });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const refresh = useCallback(() => {
    if (!allowed) return Promise.resolve(null);
    return api("/api/admin/trading/status")
      .then((s) => {
        setStatus(s);
        return s;
      })
      .catch(() => null);
  }, [allowed]);

  useEffect(() => {
    if (!allowed) return undefined;
    refresh();
    return everyVisible(refresh, 20000);
  }, [allowed, refresh]);

  // The live book (liveBook.js): the positions at streamed prices, pushed by the server over the order
  // stream below on every price or position change. Read here once when the page opens and whenever
  // an order changes, and again only if the stream has gone quiet for a while.
  const connectedNow = Boolean(status && status.connected);
  const bookAt = useRef(0);
  const takeBook = useCallback((b) => {
    if (!b) return;
    bookAt.current = Date.now();
    bookStore.set(b);
    // the context's own copy (trade.pulse) is only the fallback for a screen without the book: it
    // changes when the open count does, so the whole page is not redrawn on every price
    setPulse((p) => {
      const n = pulseOf(b);
      if (!n) return null;
      return p && p.open === n.open ? p : n;
    });
  }, []);
  useEffect(() => {
    if (!allowed || !connectedNow) {
      setPulse(null);
      bookStore.set(null);
      return undefined;
    }
    let alive = true;
    const read = (force) => {
      if (!force && Date.now() - bookAt.current < 20000) return; // the stream is bringing it
      api("/api/admin/trading/live")
        .then((b) => alive && takeBook(b))
        .catch(() => {});
    };
    read(true);
    const stop = everyVisible(() => read(false), 15000);
    return () => {
      alive = false;
      stop();
    };
  }, [allowed, connectedNow, version, takeBook]);

  // the daily goal (target, stop, profit protection): pushed by the server as it is worked out (every
  // 5 s in market hours), with a slow read as the fallback; a new reminder is also a toast
  const { goal, reload: reloadGoal, push: pushGoal } = useDailyGoal(allowed && connectedNow, (e) => say(`${e.title} — ${e.text}`, e.level === "danger" ? "error" : e.level === "success" ? "ok" : "warn"));

  // order updates, straight from Zerodha's stream
  useEffect(() => {
    if (!allowed || typeof EventSource === "undefined") return undefined;
    const es = new EventSource("/api/admin/trading/stream");
    // the live book and the goal's standing ride on the same connection as the order updates
    es.addEventListener("book", (e) => {
      try {
        takeBook(JSON.parse(e.data));
      } catch (_) {
        /* the next push replaces it */
      }
    });
    es.addEventListener("goal", (e) => {
      try {
        pushGoal(JSON.parse(e.data));
      } catch (_) {
        /* the next push replaces it */
      }
    });
    // the switch, the Zerodha session or the guard changed (here, in another tab, on WhatsApp): at once
    es.addEventListener("status", (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d && d.status) setStatus(d.status);
      } catch (_) {
        /* the next status read catches up */
      }
    });
    // a note for every page: the exit coach stepping up on an open position (TIGHTEN, BOOK PART, EXIT NOW)
    es.addEventListener("notice", (e) => {
      try {
        const n = (JSON.parse(e.data) || {}).notice;
        if (!n) return;
        say(`${n.title}${n.text ? ` — ${n.text}` : ""}`, n.level === "danger" ? "error" : n.level === "warn" ? "warn" : n.level === "ok" ? "ok" : "info");
        let muted = false;
        try {
          muted = JSON.parse(window.localStorage.getItem("vpt.goal.mute") || "false");
        } catch (_) {
          muted = false;
        }
        if (n.level === "danger" && !muted) chime("danger");
      } catch (_) {
        /* a malformed note is skipped */
      }
    });
    // (re)connected: the switch and connection state as the server has them now
    es.addEventListener("hello", (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d && d.status) setStatus(d.status);
      } catch (_) {
        /* the next status read catches up */
      }
    });
    es.addEventListener("order", (e) => {
      try {
        const { update: u } = JSON.parse(e.data);
        if (!u) return;
        setVersion((v) => v + 1);
        setFollow((f) => (f && u.id && f.orderId === u.id ? (u.status === "COMPLETE" ? { ...f, filled: true } : u.status === "REJECTED" || u.status === "CANCELLED" ? null : f) : f));
        if (["COMPLETE", "REJECTED", "CANCELLED"].includes(u.status)) {
          const what = `${u.side} ${u.quantity} ${u.symbol}`;
          say(u.status === "COMPLETE" ? `Filled: ${what}${u.average ? ` at ₹${u.average}` : ""}` : u.status === "REJECTED" ? `Rejected: ${what}${u.message ? ` — ${u.message}` : ""}` : `Cancelled: ${what}`, u.status === "COMPLETE" ? "ok" : u.status === "REJECTED" ? "error" : "info");
        }
      } catch (_) {
        /* a malformed update is skipped; the next poll catches up */
      }
    });
    return () => es.close();
  }, [allowed, say, takeBook, pushGoal]);

  const setSwitch = useCallback(
    async (on) => {
      const s = await api("/api/admin/trading/switch", { method: "PUT", body: { on } });
      setStatus(s);
      say(on ? "Trading is ON. Orders go to your Zerodha account." : "Trading is OFF. Buy and Sell are disabled.", on ? "warn" : "info");
      return s;
    },
    [say]
  );

  const value = useMemo(
    () =>
      allowed
        ? {
            status,
            enabled: Boolean(status && status.enabled),
            connected: Boolean(status && status.connected),
            refresh,
            setSwitch,
            version,
            bump: () => setVersion((v) => v + 1),
            say,
            pulse,
            goal,
            reloadGoal,
            openTicket: (prefill) => setTicket({ ...prefill, key: Date.now() }),
          }
        : null,
    [allowed, status, refresh, setSwitch, version, say, pulse, goal, reloadGoal]
  );

  return (
    <TradeContext.Provider value={value}>
      {children}
      {value && ticket && (
        <OrderTicket
          key={ticket.key}
          prefill={ticket}
          enabled={value.enabled}
          connected={value.connected}
          limits={status ? status.limits : null}
          onClose={() => setTicket(null)}
          onPlaced={(r, t, plan) => {
            setTicket(null);
            setVersion((v) => v + 1);
            say(`Order sent to Zerodha: ${t.side} ${t.quantity} ${t.symbol} (order ${r.orderId}). Check the Orders tab for its status.`, "ok");
            if (plan && plan.stop) setFollow({ orderId: String(r.orderId || ""), entry: { symbol: t.symbol, exchange: t.exchange, side: t.side, product: t.product, quantity: Number(t.quantity) }, stop: plan.stop, target: plan.target, filled: false });
          }}
        />
      )}
      {value && follow && !ticket && (
        <div className="tr-follow" role="status" aria-live="polite">
          <p>
            <b>{follow.filled ? "Entry filled." : "Entry sent."}</b> Your plan has a stop at ₹{follow.stop}
            {follow.target ? ` and a target at ₹${follow.target}` : ""}: {follow.entry.side === "BUY" ? "sell" : "buy"} {follow.entry.quantity} {follow.entry.symbol}, stop-market.
            {!follow.filled && <small>Waiting for the fill — a stop placed before the entry fills can open a position the other way.</small>}
          </p>
          <span>
            <button
              type="button"
              className="tr-btn tr-btn--exit"
              disabled={!follow.filled}
              onClick={() => {
                setTicket({ ...stopTicket(follow.entry, follow.stop), note: `Stop-loss for your ${follow.entry.side === "BUY" ? "buy" : "sell"} of ${follow.entry.quantity} ${follow.entry.symbol}. A stop order lasts for today only.`, key: Date.now() });
                setFollow(null);
              }}
              data-tip="Open the stop-loss order as a ticket. Nothing is sent until you confirm it."
            >
              Place the stop…
            </button>
            {!follow.filled && (
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => setFollow((f) => f && { ...f, filled: true })} data-tip="Use this if the Orders tab shows the entry as COMPLETE and this bar has not caught up.">
                It has filled
              </button>
            )}
            <button type="button" className="tr-follow__x" aria-label="Dismiss" onClick={() => setFollow(null)}>
              ×
            </button>
          </span>
        </div>
      )}
      <SoftToast show={Boolean(value && toast)} kind={toast ? toast.kind : "ok"} onClose={() => setToast(null)}>
        <p>{toast ? toast.text : ""}</p>
      </SoftToast>
    </TradeContext.Provider>
  );
}

/** Buy and Sell buttons for one instrument. Greyed out and inert while trading is off. */
export function TradeButtons({ symbol, exchange = "NSE", product, quantity, price, small = false }) {
  const t = useTrade();
  if (!t) return null;
  const off = !t.enabled || !t.connected;
  const what = symbol || "any instrument";
  const why = !t.connected ? "Zerodha is not connected. Log in to Kite first." : !t.enabled ? "Trading is switched OFF. Turn it on in Positions & orders." : "";
  const open = (side) => !off && t.openTicket({ symbol, exchange, side, product, quantity, price });
  return (
    <span className={`tr-bs ${small ? "tr-bs--sm" : ""}`}>
      <button type="button" className="tr-btn tr-btn--buy" disabled={off} aria-disabled={off} onClick={() => open("BUY")} data-tip={why || `Open an order ticket to buy ${what}. You confirm before anything is sent.`}>
        {small ? "B" : "Buy"}
      </button>
      <button type="button" className="tr-btn tr-btn--sell" disabled={off} aria-disabled={off} onClick={() => open("SELL")} data-tip={why || `Open an order ticket to sell ${what}. You confirm before anything is sent.`}>
        {small ? "S" : "Sell"}
      </button>
    </span>
  );
}
