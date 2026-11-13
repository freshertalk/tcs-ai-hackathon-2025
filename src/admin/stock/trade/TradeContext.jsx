// Trading for the whole Stock Report: the switch's state, the order ticket (one, shared by
// every Buy / Sell button), and order updates from Zerodha as they arrive.
//
// Only the superadmin gets any of it — it is their Zerodha account. For anyone else the
// context is null and no Buy / Sell button is drawn.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { useAuth } from "../../auth";
import OrderTicket from "./OrderTicket";
import "./trade.css";

const TradeContext = createContext(null);

/** null when this user cannot trade (not the superadmin), else the trading controls. */
export const useTrade = () => useContext(TradeContext);

export function TradeProvider({ children }) {
  const { user } = useAuth();
  const allowed = Boolean(user && user.role === "superadmin");
  const [status, setStatus] = useState(null);
  const [ticket, setTicket] = useState(null); // the prefill of the open ticket, or null
  const [version, setVersion] = useState(0); // goes up whenever the account may have changed
  const [toast, setToast] = useState(null);
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
    const id = setInterval(refresh, 20000);
    return () => clearInterval(id);
  }, [allowed, refresh]);

  // order updates, straight from Zerodha's stream
  useEffect(() => {
    if (!allowed || typeof EventSource === "undefined") return undefined;
    const es = new EventSource("/api/admin/trading/stream");
    es.addEventListener("order", (e) => {
      try {
        const { update: u } = JSON.parse(e.data);
        if (!u) return;
        setVersion((v) => v + 1);
        if (["COMPLETE", "REJECTED", "CANCELLED"].includes(u.status)) {
          const what = `${u.side} ${u.quantity} ${u.symbol}`;
          say(u.status === "COMPLETE" ? `Filled: ${what}${u.average ? ` at ₹${u.average}` : ""}` : u.status === "REJECTED" ? `Rejected: ${what}${u.message ? ` — ${u.message}` : ""}` : `Cancelled: ${what}`, u.status === "COMPLETE" ? "ok" : u.status === "REJECTED" ? "error" : "info");
        }
      } catch (_) {
        /* a malformed update is skipped; the next poll catches up */
      }
    });
    return () => es.close();
  }, [allowed, say]);

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
            openTicket: (prefill) => setTicket({ ...prefill, key: Date.now() }),
          }
        : null,
    [allowed, status, refresh, setSwitch, version, say]
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
          onPlaced={(r, t) => {
            setTicket(null);
            setVersion((v) => v + 1);
            say(`Order sent to Zerodha: ${t.side} ${t.quantity} ${t.symbol} (order ${r.orderId}). Check the Orders tab for its status.`, "ok");
          }}
        />
      )}
      {value && toast && (
        <div className={`tr-toast tr-toast--${toast.kind}`} role="status" aria-live="polite">
          <p>{toast.text}</p>
          <button type="button" aria-label="Dismiss" onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      )}
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
