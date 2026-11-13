// Price alerts for the whole terminal: "tell me when SBIN reaches 800".
//
// The alerts live in the database, so they survive a reload and show on every device. This
// page watches the prices — live ticks when the stream is on, a light poll otherwise — and
// when a level is reached it reports it to the server (so the alert fires once, whichever
// tab saw it), sounds a tone, shows a note here and, if you allowed them, a notification.
// An alert never places an order.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { useLiveTicks } from "../analyzer/liveTicks";
import { beep, notify } from "../analyzer/useVerdict";
import { alertText, due } from "./alerts";

const Ctx = createContext(null);
/** { alerts, waiting, add(input), remove(id), error, reload } */
export const useAlerts = () => useContext(Ctx);

export function AlertsProvider({ children }) {
  const [alerts, setAlerts] = useState([]);
  const [note, setNote] = useState(null);
  const firing = useRef(new Set());
  const noteTimer = useRef(null);

  const reload = useCallback(
    () =>
      api("/api/admin/market/alerts")
        .then((d) => setAlerts(d.alerts || []))
        .catch(() => {}),
    []
  );
  useEffect(() => {
    reload();
    const id = setInterval(reload, 60000); // an alert set on another device shows up here too
    return () => clearInterval(id);
  }, [reload]);
  useEffect(() => () => clearTimeout(noteTimer.current), []);

  const waiting = useMemo(() => alerts.filter((a) => !a.firedAt), [alerts]);
  const symbolKey = [...new Set(waiting.map((a) => a.symbol))].sort().join(",");
  const symbols = useMemo(() => (symbolKey ? symbolKey.split(",") : []), [symbolKey]);
  const live = useLiveTicks(symbols, symbols.length > 0);
  const streaming = live.state === "live";

  const say = useCallback((text) => {
    setNote({ text, at: Date.now() });
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), 15000);
  }, []);

  const check = useCallback(
    (priceOf) => {
      for (const a of due(waiting, priceOf)) {
        if (firing.current.has(a.id)) continue;
        firing.current.add(a.id);
        const at = priceOf(a.symbol);
        api(`/api/admin/market/alerts/${encodeURIComponent(a.id)}/fired`, { method: "POST", body: { price: at } })
          .then((d) => {
            setAlerts(d.alerts || []);
            if (!d.first) return; // another tab or device already told you
            beep();
            const text = `${alertText(a)} — now ₹${at}${a.note ? ` · ${a.note}` : ""}`;
            notify(`Price alert: ${a.symbol}`, text);
            say(text);
          })
          .catch(() => firing.current.delete(a.id)); // tried again on the next price
      }
    },
    [waiting, say]
  );

  // live ticks: checked once a second from the stream's snapshot
  useEffect(() => {
    if (!streaming || !waiting.length) return;
    check((s) => (live.slow[s] && typeof live.slow[s].last === "number" ? live.slow[s].last : null));
  }, [streaming, live.slow, waiting, check]);

  // no stream (not connected, demo data, or it dropped): a light poll of the same prices
  useEffect(() => {
    if (streaming || !symbolKey) return undefined;
    let alive = true;
    const read = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      api(`/api/admin/market/quotes?symbols=${encodeURIComponent(symbolKey)}`)
        .then((d) => alive && check((s) => (d.quotes && d.quotes[s] && typeof d.quotes[s].last === "number" ? d.quotes[s].last : null)))
        .catch(() => {});
    };
    read();
    const id = setInterval(read, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [streaming, symbolKey, check]);

  const add = useCallback(async (input) => {
    const d = await api("/api/admin/market/alerts", { method: "POST", body: input });
    setAlerts(d.alerts || []);
    return d.alert;
  }, []);
  const remove = useCallback(async (id) => {
    const d = await api(`/api/admin/market/alerts/${encodeURIComponent(id)}`, { method: "DELETE" });
    setAlerts(d.alerts || []);
  }, []);

  const value = useMemo(() => ({ alerts, waiting, add, remove, reload, streaming, prices: live.slow }), [alerts, waiting, add, remove, reload, streaming, live.slow]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {note && (
        <div className="tr-toast tr-toast--warn tm-alert-note" role="alert">
          <p>
            <b>Price alert</b>
            <br />
            {note.text}
          </p>
          <button type="button" aria-label="Dismiss" onClick={() => setNote(null)}>
            ×
          </button>
        </div>
      )}
    </Ctx.Provider>
  );
}
