// The live connection of the private area: tells every page, at once, that what it shows has changed.
//
//   ONE CONNECTION PER BROWSER. Many tabs may be open and a browser allows only a handful of connections to one site, so the
//   tabs elect a leader (the Web Locks API: whoever holds the lock; if that tab closes, another takes over at once). The
//   leader holds the Server-Sent Events connection to /api/admin/live and relays every event to the other tabs over a
//   BroadcastChannel. Where those two APIs are missing, each tab simply connects for itself.
//   WHAT COMES DOWN is only "topic X changed" (never data). A page that shows topic X re-reads what it shows through its
//   normal API (see everyVisible in visible.js: `{ topics: ["horizon"] }`), so permissions are never bypassed.
//   NEVER STALE. If the connection drops it reconnects with growing pauses and says the last event number it saw, so it is
//   sent what it missed; if too much was missed, or the server restarted, every subscriber re-reads at once ("resync"). The
//   same happens when the network comes back or a tab is shown again after a long absence. Pages also keep their own slow
//   polling as a safety net, so a dead connection can only make things slower, never wrong.

import { useEffect, useRef, useSyncExternalStore } from "react";

const URL_PATH = "/api/admin/live";
const CHANNEL = "vpt-live";
const LOCK = "vpt-live-leader";

const subs = new Set(); // { topics: Set | null (all), fn }
const watchers = new Set(); // status listeners
let state = { status: "idle", at: 0, leader: false, last: 0 };
let es = null;
let timer = null;
let backoff = 1000;
let fails = 0;
let lastSeq = 0;
let boot = "";
let started = false;
let channel = null;

const setState = (patch) => {
  state = { ...state, ...patch };
  watchers.forEach((f) => f());
};

function dispatch(topic, meta = {}) {
  setState({ last: Date.now() });
  for (const s of [...subs]) {
    if (!s.topics || s.topics.has(topic) || topic === "*") {
      try {
        s.fn(topic, meta);
      } catch (_) {
        /* one page's failure does not stop the others */
      }
    }
  }
}

/** Every subscriber re-reads (after a gap in the events, a restart, a return to the network). */
export function resync(reason = "resync") {
  dispatch("*", { reason });
}

/** Call `fn(topic)` when any of `topics` changes (all topics when none are given). Returns the function that stops it. */
export function onTopics(topics, fn) {
  const s = { topics: topics && topics.length ? new Set(topics) : null, fn };
  subs.add(s);
  start();
  return () => subs.delete(s);
}

/** Make a change known to every tab at once (used after this tab's own action, before the server's event comes back). */
export function announce(topic) {
  dispatch(topic, { via: "local" });
  if (channel) channel.postMessage({ t: "change", topic, via: "local" });
}

/* ------------------------------------------------------------------------------------- the connection (leader only) */
function connect() {
  if (typeof EventSource === "undefined") return;
  if (es) es.close();
  clearTimeout(timer);
  const q = new URLSearchParams();
  if (lastSeq) q.set("last", String(lastSeq));
  if (boot) q.set("boot", boot);
  es = new EventSource(`${URL_PATH}${q.toString() ? `?${q}` : ""}`);
  es.addEventListener("hello", (e) => {
    let d = {};
    try {
      d = JSON.parse(e.data);
    } catch (_) {
      /* ignore */
    }
    const restarted = boot && d.boot && d.boot !== boot;
    if (d.boot) boot = d.boot;
    if (!lastSeq && d.seq) lastSeq = d.seq;
    backoff = 1000;
    fails = 0;
    relayStatus("live");
    if (restarted) relay({ t: "resync", reason: "restarted" }, true);
  });
  es.addEventListener("change", (e) => {
    let d = {};
    try {
      d = JSON.parse(e.data);
    } catch (_) {
      return;
    }
    if (e.lastEventId) lastSeq = Number(e.lastEventId) || lastSeq;
    relay({ t: "change", topic: d.topic, via: d.via }, true);
  });
  es.addEventListener("resync", (e) => {
    let d = {};
    try {
      d = JSON.parse(e.data);
    } catch (_) {
      /* ignore */
    }
    relay({ t: "resync", reason: d.reason || "resync" }, true);
  });
  es.onopen = () => relayStatus("live");
  es.onerror = () => {
    es.close();
    es = null;
    fails += 1;
    relayStatus(fails >= 3 ? "offline" : "reconnecting");
    timer = setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 15000);
  };
}

function relayStatus(status) {
  setState({ status, at: Date.now() });
  if (channel) channel.postMessage({ t: "status", status });
}

/** Deliver an event here and to the other tabs. */
function relay(msg, here) {
  if (here) {
    if (msg.t === "change") dispatch(msg.topic, { via: msg.via });
    else if (msg.t === "resync") resync(msg.reason);
  }
  if (channel) channel.postMessage(msg);
}

function becomeLeader() {
  setState({ leader: true });
  connect();
}

/* ------------------------------------------------------------------------------------------------------ start-up */
function start() {
  if (started || typeof window === "undefined" || typeof EventSource === "undefined") return;
  started = true;
  setState({ status: "connecting", at: Date.now() });
  try {
    channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : null;
  } catch (_) {
    channel = null;
  }
  if (channel) {
    channel.onmessage = (e) => {
      const m = e.data || {};
      // a tab that has just opened asks how the connection is; the leader answers
      if (m.t === "who") {
        if (state.leader) channel.postMessage({ t: "status", status: state.status });
        return;
      }
      if (state.leader) return; // the leader already delivered it here
      if (m.t === "change") dispatch(m.topic, { via: m.via });
      else if (m.t === "resync") resync(m.reason);
      else if (m.t === "status") setState({ status: m.status, at: Date.now() });
    };
  }
  if (channel) channel.postMessage({ t: "who" });
  if (channel && typeof navigator !== "undefined" && navigator.locks && navigator.locks.request) {
    // whoever holds the lock holds the connection; it is released when that tab closes, and the next tab takes over
    navigator.locks.request(LOCK, () => {
      becomeLeader();
      return new Promise(() => {});
    });
  } else {
    becomeLeader();
  }
  window.addEventListener("online", () => {
    if (state.leader) {
      backoff = 1000;
      fails = 0;
      connect();
    }
    resync("online");
  });
  window.addEventListener("offline", () => relayStatus("offline"));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    // shown again: if the connection is not live, try now; after a long absence everything re-reads
    if (state.leader && state.status !== "live") {
      backoff = 1000;
      connect();
    }
    if (Date.now() - state.last > 120000) resync("returned");
  });
}

/* ----------------------------------------------------------------------------------------------- for components */
const subscribe = (f) => {
  watchers.add(f);
  start();
  return () => watchers.delete(f);
};
const snapshot = () => state;

/** Is the live connection up right now? */
export const isLive = () => state.status === "live";

/** { status: "live" | "connecting" | "reconnecting" | "offline" | "idle", leader, last } — re-renders when it changes. */
export function useLive() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * Run `fn` the moment the server says one of `topics` changed — for a screen that reads once and has no timer of its own
 * (a report, a list, a settings card). At most about once a second; a burst of changes becomes one run; a tab in the
 * background runs it when it is shown again. `fn` should re-read quietly (no "loading" flash): the data is already on screen.
 */
export function useTopics(topics, fn, { gap = 1000 } = {}) {
  const ref = useRef(fn);
  ref.current = fn;
  const key = (topics || []).join(",");
  useEffect(() => {
    if (!key) return undefined;
    let last = 0;
    let trail = null;
    let dirty = false;
    const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
    const run = () => {
      last = Date.now();
      dirty = false;
      ref.current();
    };
    const poke = () => {
      if (hidden()) {
        dirty = true;
        return;
      }
      const wait = gap - (Date.now() - last);
      if (wait <= 0) run();
      else if (!trail) {
        trail = setTimeout(() => {
          trail = null;
          if (hidden()) dirty = true;
          else run();
        }, wait);
      }
    };
    const off = onTopics(key.split(","), poke);
    const onShow = () => {
      if (!hidden() && dirty) run();
    };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onShow);
    return () => {
      off();
      clearTimeout(trail);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onShow);
    };
  }, [key, gap]);
}

/** For tests. */
export function __reset() {
  if (es) es.close();
  clearTimeout(timer);
  es = null;
  timer = null;
  subs.clear();
  watchers.clear();
  started = false;
  channel = null;
  backoff = 1000;
  fails = 0;
  lastSeq = 0;
  boot = "";
  state = { status: "idle", at: 0, leader: false, last: 0 };
}
