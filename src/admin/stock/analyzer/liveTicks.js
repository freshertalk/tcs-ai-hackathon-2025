// Live prices in the browser.
//
// The server pushes ticks over one long-lived connection (Server-Sent Events) as
// Zerodha streams them. They land in a tiny store, and each price label subscribes
// to its own symbol — so a tick redraws that one label at once, not the whole page.
// Everything else on the page reads a snapshot refreshed once a second.

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";

function createStore() {
  const ticks = new Map();
  const subs = new Map();
  let version = 0;
  const tell = (symbol) => {
    const s = subs.get(symbol);
    if (s) s.forEach((fn) => fn());
  };
  return {
    set(symbol, tick) {
      ticks.set(symbol, tick);
      version += 1;
      tell(symbol);
    },
    clear() {
      if (ticks.size === 0) return;
      const had = [...ticks.keys()];
      ticks.clear();
      version += 1;
      had.forEach(tell);
    },
    get: (symbol) => ticks.get(symbol) || null,
    subscribe(symbol, fn) {
      let s = subs.get(symbol);
      if (!s) subs.set(symbol, (s = new Set()));
      s.add(fn);
      return () => s.delete(fn);
    },
    snapshot: () => Object.fromEntries(ticks),
    version: () => version,
  };
}

export const TickContext = createContext(null);
const noop = () => () => {};

/** The newest streamed tick for one symbol, or null when the stream is not live for it. */
export function useTick(symbol) {
  const store = useContext(TickContext);
  return useSyncExternalStore(
    store && symbol ? (cb) => store.subscribe(symbol, cb) : noop,
    () => (store && symbol ? store.get(symbol) : null)
  );
}

/**
 * Open the stream for these symbols while `enabled`.
 * @param focus  the one stock that is open: its ticks also carry the order book (`depth`)
 *               and the order-flow reading (`flow`)
 * @returns { store, state, reason, slow }
 *   state: "off" | "connecting" | "live" | "down" | "denied" | "idle"
 *   slow:  { SYMBOL: tick } — the same data, refreshed once a second, for the parts of the
 *          page that do not need to move on every tick
 */
export function useLiveTicks(symbols, enabled, focus = "") {
  const ref = useRef(null);
  if (!ref.current) ref.current = createStore();
  const store = ref.current;
  const [status, setStatus] = useState({ state: "off", reason: "" });
  const [slow, setSlow] = useState({});
  const key = symbols.join(",");

  useEffect(() => {
    if (!enabled || !key || typeof EventSource === "undefined") {
      store.clear();
      setStatus({ state: "off", reason: "" });
      return undefined;
    }
    setStatus({ state: "connecting", reason: "" });
    const es = new EventSource(`/api/admin/market/stream?symbols=${encodeURIComponent(key)}${focus ? `&focus=${encodeURIComponent(focus)}` : ""}`);
    es.addEventListener("tick", (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d && d.s) store.set(d.s, d);
      } catch (_) {
        /* a malformed event is skipped; the next one replaces it */
      }
    });
    es.addEventListener("status", (e) => {
      try {
        const d = JSON.parse(e.data);
        setStatus({ state: d.state, reason: d.reason || "" });
        // a price is only shown as live while the stream is: otherwise the polled quote takes over
        if (d.state !== "live") store.clear();
        if (d.state === "off" || d.state === "denied") es.close();
      } catch (_) {
        /* ignore */
      }
    });
    es.onerror = () => {
      // the browser reconnects by itself; until it is back, prices come from polling
      store.clear();
      setStatus((s) => (s.state === "off" || s.state === "denied" ? s : { state: "connecting", reason: "" }));
    };
    return () => es.close();
  }, [key, enabled, store, focus]);

  useEffect(() => {
    let seen = -1;
    const id = setInterval(() => {
      const v = store.version();
      if (v !== seen) {
        seen = v;
        setSlow(store.snapshot());
      }
    }, 1000);
    return () => clearInterval(id);
  }, [store]);

  return { store, state: status.state, reason: status.reason, slow };
}
