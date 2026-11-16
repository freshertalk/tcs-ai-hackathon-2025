// Live prices in the browser.
//
// The server pushes ticks over a long-lived connection (Server-Sent Events) as Zerodha
// streams them. They land in a tiny store, and each price label subscribes to its own
// symbol — so a tick redraws that one label at once, not the whole page. Everything else on
// the page reads a snapshot refreshed once a second.
//
// ONE connection serves the whole page. Every part that wants live prices (the desk, the
// positions dock, the advisor…) tells the hub which symbols it needs, and the hub keeps a
// single stream open for all of them. Each part used to open its own; with the order stream
// that made three connections that never close, and a browser allows only about six per site
// over HTTP/1.1 — every other request on the page had to queue behind them.

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";

export function createStore() {
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

const OFF = { state: "off", reason: "" };
const NONE = {};

/**
 * The page's one stream.
 * @param open  (url) → an EventSource-like object; null when the browser has none
 * @param wait  milliseconds to gather requests before (re)connecting
 */
export function createHub(open, wait = 60) {
  const store = createStore();
  const wants = new Map(); // who → { symbols, focus, scan, events }
  const listeners = new Set();
  // named events the server sends on the same connection (a price alert changed, the live scanner):
  // the newest of each is kept, so a part of the page that starts listening late still has it
  const EVENTS = ["alert", "scan"];
  const evSubs = new Map(EVENTS.map((t) => [t, new Set()]));
  const evLast = new Map();
  let status = OFF;
  let es = null;
  let carried = { symbols: new Set(), focus: "", scan: false };
  let timer = null;
  let seq = 0;

  const say = (next) => {
    if (next.state === status.state && next.reason === status.reason) return;
    status = next;
    listeners.forEach((fn) => fn());
  };
  const drop = () => {
    if (es) es.close();
    es = null;
    carried = { symbols: new Set(), focus: "", scan: false };
  };

  // a named event from this connection (and not one already replaced) goes to everyone listening for it
  const listen = (source, type) =>
    source.addEventListener(type, (e) => {
      if (es !== source) return;
      try {
        const d = JSON.parse(e.data);
        evLast.set(type, d);
        evSubs.get(type).forEach((fn) => fn(d));
      } catch (_) {
        /* a malformed event is skipped; the next one replaces it */
      }
    });

  const connect = (symbols, focus, scan = false) => {
    if (es) es.close();
    const source = open(`/api/admin/market/stream?symbols=${encodeURIComponent([...symbols].join(","))}${focus ? `&focus=${encodeURIComponent(focus)}` : ""}${scan ? "&scan=1" : ""}`);
    if (!source) {
      drop();
      say(OFF);
      return;
    }
    es = source;
    carried = { symbols, focus, scan };
    EVENTS.forEach((type) => listen(source, type));
    // widening a stream that is already live takes a moment: the prices on screen stay until it answers
    if (status.state !== "live") say({ state: "connecting", reason: "" });
    source.addEventListener("tick", (e) => {
      if (es !== source) return;
      try {
        const d = JSON.parse(e.data);
        if (d && d.s) store.set(d.s, d);
      } catch (_) {
        /* a malformed event is skipped; the next one replaces it */
      }
    });
    source.addEventListener("status", (e) => {
      if (es !== source) return;
      try {
        const d = JSON.parse(e.data);
        // a price is only shown as live while the stream is: otherwise the polled quote takes over
        if (d.state !== "live") store.clear();
        if (d.state === "off" || d.state === "denied") drop(); // the next request for prices tries again
        say({ state: d.state, reason: d.reason || "" });
      } catch (_) {
        /* ignore */
      }
    });
    source.onerror = () => {
      if (es !== source) return;
      // the browser reconnects by itself; until it is back, prices come from polling
      store.clear();
      say(status.state === "off" || status.state === "denied" ? status : { state: "connecting", reason: "" });
    };
  };

  const sync = () => {
    timer = null;
    const symbols = new Set();
    let focus = "";
    let scan = false;
    let events = false;
    for (const w of wants.values()) {
      for (const s of w.symbols) symbols.add(s);
      if (w.focus) focus = w.focus;
      if (w.scan) scan = true;
      if (w.events) events = true;
    }
    if (symbols.size === 0 && !scan && !events) {
      drop();
      store.clear();
      say(OFF);
      return;
    }
    // an open stream that already carries everything asked for is left alone
    if (es && carried.focus === focus && (carried.scan || !scan) && [...symbols].every((s) => carried.symbols.has(s))) return;
    connect(symbols, focus, scan);
  };

  return {
    store,
    status: () => status,
    onStatus(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /**
     * Say which symbols a part of the page needs; an empty list (and no flags) withdraws the request.
     * @param extra { scan: the live scanner's updates, events: the connection for the named events alone }
     */
    want(who, symbols, focus = "", extra = {}) {
      const scan = Boolean(extra && extra.scan);
      const events = Boolean(extra && extra.events);
      if ((symbols && symbols.length) || scan || events) wants.set(who, { symbols: symbols || [], focus, scan, events });
      else wants.delete(who);
      if (!timer) timer = setTimeout(sync, wait);
    },
    newId: () => (seq += 1),
    /** Listen to a named event ("alert", "scan"); returns the function that stops listening. */
    on(type, fn) {
      const set = evSubs.get(type);
      if (!set) return () => {};
      set.add(fn);
      return () => set.delete(fn);
    },
    last: (type) => evLast.get(type) || null,
  };
}

const hub = createHub((url) => (typeof EventSource === "undefined" ? null : new EventSource(url)));

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
 * Ask for live prices for these symbols while `enabled`. Several parts of the page may ask
 * at once: they share one connection and one store.
 * @param focus  the one stock that is open: its ticks also carry the order book (`depth`)
 *               and the order-flow reading (`flow`)
 * @returns { store, state, reason, slow }
 *   state: "off" | "connecting" | "live" | "down" | "denied" | "idle"
 *   slow:  { SYMBOL: tick } — the same data, refreshed once a second, for the parts of the
 *          page that do not need to move on every tick
 */
export function useLiveTicks(symbols, enabled, focus = "") {
  const who = useRef(0);
  if (!who.current) who.current = hub.newId();
  const key = symbols.join(",");
  const on = Boolean(enabled && key);
  const status = useSyncExternalStore(hub.onStatus, hub.status);
  const [slow, setSlow] = useState(NONE);

  useEffect(() => {
    hub.want(who.current, on ? key.split(",") : [], focus);
  }, [key, on, focus]);

  useEffect(() => {
    const id = who.current;
    return () => hub.want(id, []);
  }, []);

  useEffect(() => {
    if (!on) {
      setSlow(NONE);
      return undefined;
    }
    let seen = -1;
    const id = setInterval(() => {
      const v = hub.store.version();
      if (v !== seen) {
        seen = v;
        setSlow(hub.store.snapshot());
      }
    }, 1000);
    return () => clearInterval(id);
  }, [on]);

  return { store: hub.store, state: on ? status.state : "off", reason: on ? status.reason : "", slow };
}

/** The page's stream state ("off" | "connecting" | "live" | "down" | "denied" | "idle"), for status pills. */
export function useStreamState() {
  return useSyncExternalStore(hub.onStatus, hub.status);
}

/**
 * The newest named event the server sent on the stream ("alert" when a price alert is set, fired or
 * removed; "scan" for the live scanner), or null. Optionally keeps the connection open for it.
 * @param keepOpen  ask the hub for the connection even when nothing else on the page wants prices
 */
export function useHubEvent(type, keepOpen = false) {
  const who = useRef(0);
  if (!who.current) who.current = hub.newId();
  useEffect(() => {
    if (!keepOpen) return undefined;
    const id = who.current;
    hub.want(id, [], "", type === "scan" ? { scan: true } : { events: true });
    return () => hub.want(id, []);
  }, [keepOpen, type]);
  return useSyncExternalStore(
    (cb) => hub.on(type, cb),
    () => hub.last(type)
  );
}

/** The live NIFTY 100 scanner, pushed on the stream while `enabled` (null until the first update). */
export function useScanFeed(enabled = true) {
  return useHubEvent("scan", enabled);
}
